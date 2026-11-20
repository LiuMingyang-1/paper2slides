"""Archive a readable copy of a PPTX containing raw PDF control characters."""
from pathlib import Path
import sys
from xml.etree import ElementTree
from zipfile import ZipFile

source, output = map(Path, sys.argv[1:])
invalid_xml_controls = bytes(code for code in range(32) if code not in (9, 10, 13))

with ZipFile(source) as original:
    replacements = {}
    for member in original.infolist():
        if not member.filename.endswith((".xml", ".rels")):
            continue
        data = original.read(member)
        cleaned = data.translate(None, invalid_xml_controls)
        ElementTree.fromstring(cleaned)
        if cleaned != data:
            replacements[member.filename] = cleaned
            print(f"{member.filename}: removed {len(data) - len(cleaned)} control bytes")

    with ZipFile(output, "x") as archive:
        for member in original.infolist():
            data = replacements.get(member.filename)
            archive.writestr(member, original.read(member) if data is None else data)
