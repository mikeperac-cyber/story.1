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


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORIES_PATH = PROJECT_ROOT / "src" / "data" / "stories.json"
DIRECTIONS_PATH = PROJECT_ROOT / "scripts" / "narration-emotion-directions.json"
OUTPUT_DIRECTORY = PROJECT_ROOT / "public" / "audio" / "narration"
MANIFEST_PATH = PROJECT_ROOT / "src" / "data" / "narration-manifest.json"
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
MODEL_LICENSE = "Apache-2.0"
SPEAKER = "Aiden"
STYLE_VERSION = "lanternberry-kid-storytime-v1"
BASE_INSTRUCTION = (
    "Read this as a gentle, kid-friendly American storybook narrator. Keep one warm, "
    "friendly narrator identity throughout. Speak clearly with careful consonants and "
    "a calm, slightly slower-than-conversation rhythm. Let punctuation create natural "
    "breaths. Use subtle pitch movement to follow the page direction: lift warmly for "
    "wonder, curiosity, questions, and happy discoveries; soften and lower slightly "
    "for worry or tenderness; make brave lines firmer but never loud. Color quoted "
    "dialogue lightly while staying the same narrator. Never shout, sing, use a scary "
    "voice, or become exaggerated or cartoonish. End sentences gently."
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


def manifest_for(speaker: str, device: str, batch_size: int, pages: dict, emotions: dict) -> dict:
    return {
        "model": MODEL_ID,
        "model_license": MODEL_LICENSE,
        "speaker": speaker,
        "language": "English",
        "device_used_for_generation": device,
        "batch_size": batch_size,
        "style_version": STYLE_VERSION,
        "style": "Kid-friendly storytime with page-specific emotion, gentle pitch movement, clear diction, and unhurried pacing.",
        "sample_rate": 24000,
        "format": "MP3, mono, 64 kbps",
        "pages": pages,
        "emotions": emotions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate expressive offline Qwen narration for all 100 story pages.")
    parser.add_argument("--model-path", default=os.environ.get("LANTERNBERRY_QWEN_MODEL", MODEL_ID))
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIRECTORY)
    parser.add_argument("--manifest-output", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--threads", type=int, default=min(8, os.cpu_count() or 8))
    parser.add_argument("--batch-size", type=int, default=0, help="Pages per generation batch; auto uses 4 on CUDA and 1 on CPU.")
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
    pending = []
    for story, page in pages:
        story_id, page_number = story["id"], page["number"]
        clip = output_path(args.output_dir, story_id, page_number)
        recorded = page_manifest.get(str(story_id), {}).get(str(page_number))
        if not args.force and may_resume and recorded and clip.is_file() and clip.stat().st_size > 1024:
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
    batch_size = args.batch_size or (4 if device.startswith("cuda") else 1)
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

    batch_count = (len(pending) + batch_size - 1) // batch_size
    for batch_index, offset in enumerate(range(0, len(pending), batch_size), start=1):
        started = time.perf_counter()
        batch = pending[offset:offset + batch_size]
        instructions = [
            f"{BASE_INSTRUCTION} For this page: {directions[(story['id'], page['number'])]['direction']}"
            for story, page, _ in batch
        ]
        waveforms, sample_rate = model.generate_custom_voice(
            text=[page["text"] for _, page, _ in batch],
            language=["English"] * len(batch),
            speaker=[args.speaker] * len(batch),
            instruct=instructions,
        )
        if len(waveforms) != len(batch):
            raise RuntimeError(f"Qwen returned {len(waveforms)} clips for a batch of {len(batch)} pages.")
        if sample_rate != 24000:
            raise RuntimeError(f"Expected 24 kHz audio, got {sample_rate} Hz for this batch.")
        for (story, page, clip), waveform in zip(batch, waveforms):
            story_id, page_number = story["id"], page["number"]
            direction = directions[(story_id, page_number)]
            encoded = encode_mp3(waveform, sample_rate)
            temporary_clip = clip.with_suffix(clip.suffix + ".tmp")
            temporary_clip.write_bytes(encoded)
            temporary_clip.replace(clip)

            page_manifest.setdefault(str(story_id), {})[str(page_number)] = f"/audio/narration/{clip.name}"
            emotion_manifest.setdefault(str(story_id), {})[str(page_number)] = direction["emotion"]
            write_manifest(
                args.manifest_output,
                manifest_for(args.speaker, device, batch_size, page_manifest, emotion_manifest),
            )
            print(
                f"[{batch_index:03d}/{batch_count:03d}] Story {story_id:02d}, page {page_number:02d}: "
                f"{direction['emotion']} ({clip.stat().st_size / 1024:.0f} KB)",
                flush=True,
            )
        print(f"Batch {batch_index}/{batch_count} completed in {time.perf_counter() - started:.0f}s.", flush=True)

    completed = sum(len(story_pages) for story_pages in page_manifest.values())
    print(f"Narration manifest contains {completed}/100 pages: {args.manifest_output}", flush=True)


if __name__ == "__main__":
    main()
