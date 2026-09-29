"""
Blur every banned name that is readable in a role's screenshots.

    py -3.14 "documents/app documents/blur_words.py" --role all

Runs ocr-screenshots.ps1 (Windows built-in OCR) over screenshots/<role>/,
finds each word matching a name in verify_manual.BANNED, and blurs its box in
place, padded a few pixels so no letter edge survives. Run it again after
adding captures; a clean folder is left untouched.
"""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
OCR = HERE / "ocr-screenshots.ps1"
PAD = 6

from build_manual import ROLES, paths  # noqa: E402
from verify_manual import BANNED  # noqa: E402


def ocr_words(folder: Path) -> list[tuple[str, str, int, int, int, int]]:
    """(file, word, x, y, w, h) for every word OCR can read in the folder."""
    out = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", str(OCR), "-Folder", str(folder)],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    words = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 6:
            name, word, *box = parts
            words.append((name, word, *map(int, box)))
    return words


def banned_pattern() -> re.Pattern:
    # OCR returns one word at a time, so each banned name is matched by its
    # words individually; "Van Sale" is caught by "Van" next to "Sale" below.
    single = [b for b in BANNED if " " not in b]
    return re.compile(r"(?<![A-Za-z])(" + "|".join(map(re.escape, single)) + r")(?![A-Za-z])", re.I)


def hits(words) -> list[tuple[str, str, int, int, int, int]]:
    pat = banned_pattern()
    found = [w for w in words if pat.search(w[1])]
    # Multi-word names: flag both halves when they appear side by side.
    for name in (b for b in BANNED if " " in b):
        first, second = name.lower().split()[0], name.lower().split()[-1]
        for a, b in zip(words, words[1:]):
            if a[0] == b[0] and a[1].lower().strip(".,") == first and b[1].lower().strip(".,") == second:
                found += [a, b]
    return found


def blur(role: str) -> int:
    folder = paths(role)["shots"]
    found = hits(ocr_words(folder))
    by_file: dict[str, list] = {}
    for name, word, x, y, w, h in found:
        by_file.setdefault(name, []).append((word, x, y, w, h))

    for name, boxes in by_file.items():
        path = folder / name
        im = Image.open(path).convert("RGB")
        for word, x, y, w, h in boxes:
            box = (max(0, x - PAD), max(0, y - PAD), min(im.width, x + w + PAD), min(im.height, y + h + PAD))
            im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(9)), box[:2])
            print(f"  {role}/{name}: blurred '{word}' at {box}")
        im.save(path)
    return len(found)


def main():
    ap = argparse.ArgumentParser(description="Blur banned names readable in the screenshots.")
    ap.add_argument("--role", choices=ROLES + ("all",), default="all")
    args = ap.parse_args()
    total = sum(blur(r) for r in (ROLES if args.role == "all" else (args.role,)))
    print(f"{total} word(s) blurred")


if __name__ == "__main__":
    main()
