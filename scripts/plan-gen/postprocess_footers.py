#!/usr/bin/env python3
"""Post-process GAVEL plan docx per toc.md WPS compatibility rules:
1. Patch footer PAGE fields with explicit format switches:
   - Roman-numeral section footer  -> PAGE \\* ROMAN \\* MERGEFORMAT
   - Arabic-numeral section footer -> PAGE \\* arabic \\* MERGEFORMAT
2. Remove empty <w:pgNumType/> from any section (docx-js emits it even
   when no pageNumbers is set - confuses WPS).
Identifies which footer belongs to which section by reading document.xml
section order and footer relationship ids.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

DOC = Path("/home/z/my-project/download/GAVEL-Production-Readiness-and-Deployment-Plan.docx")
TMP = Path("/home/z/my-project/scripts/plan-gen/_docx_tmp")

def main():
    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)
    with zipfile.ZipFile(DOC) as z:
        z.extractall(TMP)

    doc_xml = (TMP / "word" / "document.xml").read_text(encoding="utf-8")

    # 2. remove empty pgNumType (self-closing with no attributes)
    before = doc_xml.count("<w:pgNumType/>")
    doc_xml = doc_xml.replace("<w:pgNumType/>", "")
    print(f"removed {before} empty <w:pgNumType/>")

    # map: footer rId -> position order of sectPr that references it
    # find all sectPr blocks in order
    sect_prs = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc_xml, flags=re.S)
    print(f"found {len(sect_prs)} sectPr blocks")

    # section index -> footer rIds (default footer only)
    sec_footers = []  # list of (section_idx, rid)
    for i, sp in enumerate(sect_prs):
        for m in re.finditer(r'<w:footerReference w:type="default" r:id="(rId\d+)"', sp):
            sec_footers.append((i, m.group(1)))
    print("footer refs by section:", sec_footers)

    # pgNumType fmt per section (attribute on w:pgNumType)
    sec_fmt = []
    for sp in sect_prs:
        m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', sp)
        sec_fmt.append(m.group(1) if m else None)
    print("page number formats by section:", sec_fmt)

    # resolve rId -> footer file via document.xml.rels
    rels = (TMP / "word" / "_rels" / "document.xml.rels").read_text(encoding="utf-8")
    rid_to_target = dict(re.findall(r'<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))

    # patch each footer file: ROMAN for upperRoman sections, arabic otherwise
    for sec_idx, rid in sec_footers:
        target = rid_to_target.get(rid)
        if not target:
            continue
        fmt = sec_fmt[sec_idx] if sec_idx < len(sec_fmt) else None
        switch = "ROMAN" if fmt == "upperRoman" else "arabic"
        fpath = TMP / "word" / target
        xml = fpath.read_text(encoding="utf-8")
        patched, n = re.subn(
            r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
            rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2",
            xml,
        )
        if n:
            fpath.write_text(patched, encoding="utf-8")
        print(f"footer {target} (section {sec_idx}, fmt={fmt}): patched {n} PAGE field(s) -> \\* {switch}")

    (TMP / "word" / "document.xml").write_text(doc_xml, encoding="utf-8")

    # rezip preserving structure
    out = DOC.with_suffix(".docx")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(TMP.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(TMP).as_posix())
    print(f"REWROTE {out} ({out.stat().st_size} bytes)")

if __name__ == "__main__":
    sys.exit(main())
