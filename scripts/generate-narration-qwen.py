import argparse
import json
import os
import tempfile
import time
from pathlib import Path

import lameenc
import numpy as np
import torch
from qwen_tts import Qwen3TTSModel

from narration_lines import MOOD_DELIVERY, split_sentences


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORIES_PATH = PROJECT_ROOT / "src" / "data" / "stories.json"
DIRECTIONS_PATH = PROJECT_ROOT / "scripts" / "narration-emotion-directions.json"
LINE_MOODS_PATH = PROJECT_ROOT / "scripts" / "narration-line-moods.json"
OUTPUT_DIRECTORY = PROJECT_ROOT / "public" / "audio" / "narration"
MANIFEST_PATH = PROJECT_ROOT / "src" / "data" / "narration-manifest.json"
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_LICENSE = "Apache-2.0"
SPEAKER = "Serena"
STYLE_VERSION = "lanternberry-serena-line-expression-v2"
BASE_INSTRUCTION = (
    "Read this English storybook line as a warm, gentle female narrator for children "
    "ages four to eight. Speak clearly at an easy storytime pace. Keep the same Serena "
    "voice, with natural, expressive pitch and a small breath at the end. Color dialogue "
    "lightly. Never shout, sing, sound scary, or become cartoonish."
)


def output_path(directory: Path, story_id: int, page_number: int) -> Path:
    return directory / f"story-{story_id:02d}-page-{page_number:02d}.mp3"


def load_directions() -> dict[tuple[int, int], dict[str, str]]:
    raw = json.loads(DIRECTIONS_PATH.read_text(encoding="utf-8"))
    directions = {}
    for story_id, pages in raw.items():
        if not isinstance(pages, list) or len(pages) != 10:
            raise ValueError(f"Story {story_id} must have exactly 10 page directions.")
        for page_number, page in enumerate(pages, start=1):
            if not page.get("emotion") or not page.get("direction"):
                raise ValueError(f"Missing mood or delivery direction for story {story_id}, page {page_number}.")
            key = (int(story_id), page_number)
            if key in directions:
                raise ValueError(f"Duplicate emotion direction for story {story_id}, page {page_number}.")
            directions[key] = page
    if len(directions) != 100:
        raise ValueError(f"Expected 100 page directions, found {len(directions)}.")
    return directions


def encode_mp3(waveform: np.ndarray, sample_rate: int) -> bytes:
    audio = np.asarray(waveform, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        raise ValueError("Qwen returned an empty narration clip.")
    peak = float(np.max(np.abs(audio)))
    if not np.isfinite(peak) or peak < 1e-5:
        raise ValueError("Qwen returned a silent or invalid narration clip.")
    audio = audio * min(0.94 / peak, 1.0)
    pcm = np.round(np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)

    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_bit_rate(64)
    encoder.set_quality(2)
    return encoder.encode(pcm.tobytes()) + encoder.flush()


def read_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as temporary:
        json.dump(manifest, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def load_line_moods(stories: list[dict]) -> dict[tuple[int, int], list[str]]:
    raw = json.loads(LINE_MOODS_PATH.read_text(encoding="utf-8"))
    if set(raw) != {str(story["id"]) for story in stories}:
        raise ValueError("Sentence mood map must cover exactly the ten story IDs.")
    mapped = {}
    for story in stories:
        story_id = story["id"]
        planned_pages = raw[str(story_id)]
        if len(planned_pages) != len(story["pages"]):
            raise ValueError(f"Story {story_id} has an incorrect number of planned pages.")
        for page, moods in zip(story["pages"], planned_pages):
            lines = split_sentences(page["text"])
            if not lines or len(lines) != len(moods):
                raise ValueError(
                    f"Story {story_id} page {page['number']}: {len(lines)} lines, {len(moods)} planned moods. "
                    "Update the sentence mood map after changing story text."
                )
            unknown = set(moods) - MOOD_DELIVERY.keys()
            if unknown:
                raise ValueError(f"Story {story_id} page {page['number']}: unknown moods {sorted(unknown)}.")
            mapped[(story_id, page["number"])] = moods
    if len(mapped) != 100:
        raise ValueError(f"Expected 100 sentence mood plans, found {len(mapped)}.")
    return mapped


def trim_silence(waveform: np.ndarray, sample_rate: int) -> np.ndarray:
    """Remove long generated edge silence while keeping breaths and soft consonants."""
    audio = np.asarray(waveform, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        raise ValueError("Qwen returned an empty narration line.")
    audible = np.flatnonzero(np.abs(audio) > 0.002)
    if not audible.size:
        raise ValueError("Qwen returned a silent narration line.")
    padding = int(0.09 * sample_rate)
    return audio[max(0, int(audible[0]) - padding):min(len(audio), int(audible[-1]) + padding + 1)]


def join_lines(waveforms: list[np.ndarray], lines: list[str], moods: list[str], sample_rate: int):
    pieces = []
    positions = []
    sample_count = 0
    for index, (waveform, line, mood) in enumerate(zip(waveforms, lines, moods)):
        audio = trim_silence(waveform, sample_rate)
        start = sample_count / sample_rate
        pieces.append(audio)
        sample_count += len(audio)
        positions.append({
            "text": line,
            "mood": mood,
            "start_seconds": round(start, 3),
            "end_seconds": round(sample_count / sample_rate, 3),
        })
        if index < len(lines) - 1:
            ending = line.rstrip(chr(34) + chr(39) + chr(0x201d) + chr(0x2019))
            gap = 0.28 if ending.endswith(("?", "!", chr(0x2026))) else 0.20
            silence = np.zeros(int(gap * sample_rate), dtype=np.float32)
            pieces.append(silence)
            sample_count += len(silence)
    return np.concatenate(pieces), positions


def manifest_for(speaker: str, device: str, batch_size: int, pages: dict, emotions: dict, line_emotions: dict) -> dict:
    return {
        "model": MODEL_ID,
        "model_license": MODEL_LICENSE,
        "speaker": speaker,
        "language": "English",
        "device_used_for_generation": device,
        "batch_size": batch_size,
        "style_version": STYLE_VERSION,
        "style": "Warm female storytime narration with curated sentence-level emotion, pitch, timing, and dialogue delivery.",
        "sample_rate": 24000,
        "format": "MP3, mono, 64 kbps",
        "pages": pages,
        "emotions": emotions,
        "line_emotions": line_emotions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate expressive offline Qwen narration for all 100 story pages.")
    parser.add_argument("--model-path", default=os.environ.get("LANTERNBERRY_QWEN_MODEL", MODEL_ID))
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIRECTORY)
    parser.add_argument("--manifest-output", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--threads", type=int, default=min(8, os.cpu_count() or 8))
    parser.add_argument("--batch-size", type=int, default=0, help="Maximum sentence lines per generation call; auto uses 8 on CUDA and 4 on CPU.")
    parser.add_argument("--speaker", default=SPEAKER)
    parser.add_argument("--limit", type=int, default=0, help="Generate only the first N missing pages.")
    parser.add_argument("--force", action="store_true", help="Regenerate every clip, even if matching clips exist.")
    args = parser.parse_args()

    if args.threads < 1:
        parser.error("--threads must be at least 1")
    if args.batch_size < 0:
        parser.error("--batch-size cannot be negative")
    if args.limit < 0:
        parser.error("--limit cannot be negative")

    stories = json.loads(STORIES_PATH.read_text(encoding="utf-8"))
    pages = [(story, page) for story in stories for page in story["pages"]]
    if len(stories) != 10 or len(pages) != 100:
        raise ValueError(f"Expected 10 stories and 100 pages; found {len(stories)} stories and {len(pages)} pages.")
    directions = load_directions()
    line_moods = load_line_moods(stories)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    existing_manifest = read_manifest(args.manifest_output)
    may_resume = (
        existing_manifest.get("model") == MODEL_ID
        and existing_manifest.get("speaker") == args.speaker
        and existing_manifest.get("style_version") == STYLE_VERSION
    )

    page_manifest = dict(existing_manifest.get("pages", {})) if may_resume else {}
    emotion_manifest = dict(existing_manifest.get("emotions", {})) if may_resume else {}
    line_manifest = dict(existing_manifest.get("line_emotions", {})) if may_resume else {}
    pending = []
    for story, page in pages:
        story_id, page_number = story["id"], page["number"]
        clip = output_path(args.output_dir, story_id, page_number)
        recorded = page_manifest.get(str(story_id), {}).get(str(page_number))
        planned = line_moods[(story_id, page_number)]
        recorded_lines = line_manifest.get(str(story_id), {}).get(str(page_number), [])
        lines_match = (
            len(recorded_lines) == len(planned)
            and all(
                entry.get("text") == line and entry.get("mood") == mood
                for entry, line, mood in zip(recorded_lines, split_sentences(page["text"]), planned)
            )
        )
        if not args.force and may_resume and recorded and lines_match and clip.is_file() and clip.stat().st_size > 1024:
            continue
        pending.append((story, page, clip))
    if args.limit:
        pending = pending[:args.limit]
    if not pending:
        completed = sum(len(story_pages) for story_pages in page_manifest.values())
        print(f"No new clips needed; the matching manifest has {completed}/100 pages.", flush=True)
        return

    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA was requested, but this Python environment cannot see a CUDA-capable PyTorch device.")
    device = "cuda:0" if args.device == "cuda" or (args.device == "auto" and torch.cuda.is_available()) else "cpu"
    batch_size = args.batch_size or (8 if device.startswith("cuda") else 4)
    torch.set_num_threads(args.threads)
    try:
        torch.set_num_interop_threads(min(2, args.threads))
    except RuntimeError:
        pass
    torch.manual_seed(20261025)
    if device.startswith("cuda"):
        torch.cuda.manual_seed_all(20261025)
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32

    print(f"Loading {MODEL_ID} ({args.speaker}) on {device}; {len(pending)} page clips to generate.", flush=True)
    model = Qwen3TTSModel.from_pretrained(
        args.model_path,
        device_map=device,
        dtype=dtype,
        low_cpu_mem_usage=True,
    )

    for page_index, (story, page, clip) in enumerate(pending, start=1):
        started = time.perf_counter()
        story_id, page_number = story["id"], page["number"]
        direction = directions[(story_id, page_number)]
        lines = split_sentences(page["text"])
        moods = line_moods[(story_id, page_number)]
        waveforms = []
        sample_rate = None
        for offset in range(0, len(lines), batch_size):
            texts = lines[offset:offset + batch_size]
            directions_for_lines = [
                f"{BASE_INSTRUCTION} Page feeling: {direction['emotion']}. "
                f"For this line, express {mood}: {MOOD_DELIVERY[mood]}"
                for mood in moods[offset:offset + batch_size]
            ]
            generated, rate = model.generate_custom_voice(
                text=texts,
                language=["English"] * len(texts),
                speaker=[args.speaker] * len(texts),
                instruct=directions_for_lines,
            )
            if len(generated) != len(texts):
                raise RuntimeError(f"Qwen returned {len(generated)} clips for {len(texts)} sentence lines.")
            if rate != 24000 or (sample_rate is not None and rate != sample_rate):
                raise RuntimeError(f"Expected consistent 24 kHz audio, got {rate} Hz.")
            sample_rate = rate
            waveforms.extend(generated)

        joined, positions = join_lines(waveforms, lines, moods, sample_rate)
        encoded = encode_mp3(joined, sample_rate)
        temporary_clip = clip.with_suffix(clip.suffix + ".tmp")
        temporary_clip.write_bytes(encoded)
        temporary_clip.replace(clip)

        page_manifest.setdefault(str(story_id), {})[str(page_number)] = f"/audio/narration/{clip.name}"
        emotion_manifest.setdefault(str(story_id), {})[str(page_number)] = direction["emotion"]
        line_manifest.setdefault(str(story_id), {})[str(page_number)] = positions
        write_manifest(
            args.manifest_output,
            manifest_for(args.speaker, device, batch_size, page_manifest, emotion_manifest, line_manifest),
        )
        print(
            f"[{page_index:03d}/{len(pending):03d}] Story {story_id:02d}, page {page_number:02d}: "
            f"{len(lines)} lines, {direction['emotion']}, "
            f"{len(joined) / sample_rate:.1f}s, {clip.stat().st_size / 1024:.0f} KB "
            f"(rendered in {time.perf_counter() - started:.0f}s)",
            flush=True,
        )

    completed = sum(len(story_pages) for story_pages in page_manifest.values())
    print(f"Narration manifest contains {completed}/100 pages: {args.manifest_output}", flush=True)


if __name__ == "__main__":
    main()
