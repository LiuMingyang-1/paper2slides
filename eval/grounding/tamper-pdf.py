"""Replace targeted glyphs in a local evaluation PDF, retaining its layout."""
import hashlib
import json
from pathlib import Path
import re
import sys

import pymupdf as pdf


def lines(page):
    for block in page.get_text("rawdict", flags=pdf.TEXTFLAGS_RAWDICT & ~pdf.TEXT_PRESERVE_IMAGES)["blocks"]:
        for line in block.get("lines", []):
            chars = [(char, span) for span in line["spans"] for char in span["chars"]]
            yield line["bbox"][:2], "".join(char["c"] for char, _ in chars), chars


def edits_for_page(page, rules, counts):
    for (x, y), text, chars in lines(page):
        for index, rule in enumerate(rules):
            if rule.get("page", page.number + 1) != page.number + 1:
                continue
            if any(not bounds[0] <= value <= bounds[1]
                   for key, value in (("x", x), ("y", y)) if (bounds := rule.get(key))):
                continue
            for match in re.finditer(rule["pattern"], text):
                start, end = match.span(match.lastgroup)
                selected = chars[start:end]
                char, span = selected[0]
                left, top, right, bottom = selected[0][0]["bbox"]
                for glyph, _ in selected[1:]:
                    _, _, glyph_right, _ = glyph["bbox"]
                    right = max(right, glyph_right)
                # A narrow band removes the selected glyphs without touching adjoining lines.
                middle = (top + bottom) / 2
                rect = pdf.Rect(left + 0.05, middle - 0.1, right - 0.05, middle + 0.1)
                family = "he" if "Helvetica" in span["font"] else "ti"
                variant = ("bi" if span["flags"] & 2 else "bo") if span["flags"] & 16 else (
                    "it" if span["flags"] & 2 else "ro")
                font = {"hero": "helv", "hebo": "hebo", "heit": "heit", "hebi": "hebi"}.get(
                    family + variant, family + variant)
                replacement = rule["to"]
                size = span["size"]
                scale = (right - left) / pdf.get_text_length(replacement, font, size)
                counts[index] += 1
                yield rect, char["origin"], replacement, font, size, scale


def main():
    source, spec, output = map(Path, sys.argv[1:])
    config = json.loads(spec.read_text(encoding="utf-8"))
    if hashlib.sha256(source.read_bytes()).hexdigest() != config["sourceSha256"]:
        raise SystemExit("PDF SHA-256 does not match the replacement table")
    rules = config["rules"]
    counts = [0] * len(rules)
    pdf.TOOLS.set_small_glyph_heights(True)
    with pdf.open(source) as document:
        for page in document:
            edits = list(edits_for_page(page, rules, counts))
            if not edits:
                continue
            for rect, *_ in edits:
                page.add_redact_annot(rect, fill=False, cross_out=False)
            page.apply_redactions(images=0, graphics=0, text=0)
            for _, origin, replacement, font, size, scale in edits:
                page.insert_text(origin, replacement, fontname=font, fontsize=size,
                                 morph=(pdf.Point(origin), pdf.Matrix(scale, 1)))
        errors = [f"{rule['fact']} ({count}/{rule['count']})"
                  for rule, count in zip(rules, counts) if count != rule["count"]]
        if errors:
            raise SystemExit("Replacement counts differ: " + ", ".join(errors))
        document.save(output, garbage=4, deflate=True, no_new_id=True)
    print(f"Replaced {sum(counts)} spans in {output.name}")


if __name__ == "__main__":
    main()
