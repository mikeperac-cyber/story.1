from __future__ import annotations

from pathlib import Path

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT.parent / "assets"
PUBLIC = PROJECT / "public" / "images"


def save_webp(source: Path, destination: Path, max_size: int, quality: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        image = original.convert("RGB")
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=quality, method=5)


def main() -> None:
    cover = SOURCE / "covers" / "front-cover-art.png"
    save_webp(cover, PUBLIC / "cover.webp", 900, 86)

    illustrations = SOURCE / "illustrations"
    for source in sorted(illustrations.glob("page-*.png")):
        page_number = int(source.name.split("-")[1])
        save_webp(source, PUBLIC / "pages" / f"page-{page_number:03d}.webp", 1254, 85)

    for story_id in range(1, 11):
        first_book_page = (story_id - 1) * 10 + 1
        source = next(illustrations.glob(f"page-{first_book_page:03d}-*.png"))
        save_webp(source, PUBLIC / "thumbnails" / f"story-{story_id:02d}.webp", 420, 82)

    mark_source = PROJECT / "design" / "lanternberry-mark-original.png"
    mark_path = PUBLIC / "brand" / "lanternberry-mark.png"
    with Image.open(mark_source) as original:
        image = original.convert("RGBA")
        alpha = image.getchannel("A")
        bounds = alpha.getbbox()
        if bounds:
            left, top, right, bottom = bounds
            pad = max(12, int(max(right - left, bottom - top) * 0.08))
            bounds = (
                max(0, left - pad),
                max(0, top - pad),
                min(image.width, right + pad),
                min(image.height, bottom + pad),
            )
            image = image.crop(bounds)
        image.thumbnail((180, 180), Image.Resampling.LANCZOS)
        image.save(mark_path, "PNG", optimize=True)

    total = sum(path.stat().st_size for path in PUBLIC.rglob("*") if path.is_file())
    print(f"Prepared 100 page images and 10 thumbnails; web image payload: {total / 1_000_000:.1f} MB.")


if __name__ == "__main__":
    main()
