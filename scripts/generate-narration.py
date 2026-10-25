import argparse
import json
from pathlib import Path

import lameenc
import numpy as np
import spacy
import torch
from kokoro import KPipeline


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORIES_PATH = PROJECT_ROOT / "src" / "data" / "stories.json"
OUTPUT_DIRECTORY = PROJECT_ROOT / "public" / "audio" / "narration"
MANIFEST_PATH = PROJECT_ROOT / "src" / "data" / "narration-manifest.json"
SAMPLE_RATE = 24_000
PAUSE_SECONDS = 0.22
MODEL_ID = "hexgrad/Kokoro-82M"

# Keep the model's POS tagger, but use spaCy's built-in English tokenizer.
# Some Windows spaCy wheels overflow when loading the serialized tokenizer rules.
_spacy_load = spacy.load


def load_spacy_without_serialized_tokenizer(name, *args, **kwargs):
    if str(name) in ("en_core_web_sm", "en_core_web_trf"):
        kwargs["exclude"] = list(kwargs.get("exclude", [])) + ["tokenizer"]
    return _spacy_load(name, *args, **kwargs)


spacy.load = load_spacy_without_serialized_tokenizer


def mp3_bytes(waveform: np.ndarray) -> bytes:
    peak = float(np.max(np.abs(waveform))) if waveform.size else 0.0
    if peak == 0.0:
        raise ValueError("Kokoro returned an empty or silent narration clip.")
    normalized = waveform * min(0.89 / peak, 1.0)
    pcm = np.round(np.clip(normalized, -1.0, 1.0) * 32767).astype(np.int16)

    encoder = lameenc.Encoder()
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_bit_rate(64)
    encoder.set_quality(2)
    return encoder.encode(pcm.tobytes()) + encoder.flush()


def narration_path(story_id: int, page_number: int) -> Path:
    return OUTPUT_DIRECTORY / f"story-{story_id:02d}-page-{page_number:02d}.mp3"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate offline Kokoro narration for the storybook.")
    parser.add_argument("--voice", default="af_heart", help="Kokoro American English voice (default: af_heart)")
    parser.add_argument("--speed", type=float, default=0.96, help="Generation pace before the reader's playback control")
    parser.add_argument("--limit", type=int, default=0, help="Generate only the first N missing pages, for a quick sample")
    parser.add_argument("--force", action="store_true", help="Regenerate existing page audio")
    args = parser.parse_args()

    if not 0.6 <= args.speed <= 1.4:
        parser.error("--speed must be between 0.6 and 1.4")

    stories = json.loads(STORIES_PATH.read_text(encoding="utf-8"))
    pages = [(story, page) for story in stories for page in story["pages"]]
    if len(stories) != 10 or len(pages) != 100:
        raise ValueError(f"Expected 10 stories and 100 pages, found {len(stories)} stories and {len(pages)} pages.")

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    missing = [
        (story, page)
        for story, page in pages
        if args.force or not narration_path(story["id"], page["number"]).is_file()
    ]
    if args.limit:
        missing = missing[:args.limit]

    if missing:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading {MODEL_ID} with voice {args.voice} on {device}; generating {len(missing)} page clips.", flush=True)
        pipeline = KPipeline(lang_code="a", device=device)
        pause = np.zeros(round(SAMPLE_RATE * PAUSE_SECONDS), dtype=np.float32)
        total = len(missing)

        for index, (story, page) in enumerate(missing, start=1):
            chunks = []
            for _, _, audio in pipeline(page["text"], voice=args.voice, speed=args.speed):
                if audio is not None:
                    if hasattr(audio, "detach"):
                        audio = audio.detach().cpu().numpy()
                    chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
                    chunks.append(pause)

            if not chunks:
                raise RuntimeError(f"Kokoro returned no audio for story {story['id']}, page {page['number']}.")
            waveform = np.concatenate(chunks[:-1])
            output_path = narration_path(story["id"], page["number"])
            output_path.write_bytes(mp3_bytes(waveform))
            print(
                f"[{index:03d}/{total:03d}] Story {story['id']:02d}, page {page['number']:02d}: "
                f"{output_path.stat().st_size / 1024:.0f} KB",
                flush=True,
            )

    manifest = {
        "model": MODEL_ID,
        "license": "Apache-2.0",
        "voice": args.voice,
        "speed": args.speed,
        "pages": {},
    }
    for story, page in pages:
        clip_path = narration_path(story["id"], page["number"])
        if clip_path.is_file():
            manifest["pages"].setdefault(str(story["id"]), {})[str(page["number"])] = (
                f"/audio/narration/{clip_path.name}"
            )

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {MANIFEST_PATH.relative_to(PROJECT_ROOT)} with {sum(map(len, manifest['pages'].values()))}/100 clips.")


if __name__ == "__main__":
    main()
