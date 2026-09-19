#!/usr/bin/env python3
"""Post-process the GAVEL change-log docx for WPS compatibility.

1. Removes empty <w:pgNumType/> from the cover section (docx-js emits it
   even when no pageNumbers is set; WPS misreads it).
2. Patches footer PAGE fields with explicit format switches:
   - footer referenced by a sectPr with fmt="upperRoman" -> PAGE \\* ROMAN \\* MERGEFORMAT
   - footer referenced by a sectPr with fmt="decimal"    -> PAGE \\* arabic \\* MERGEFORMAT
"""
import re
import sys
import shutil
import zipfile
import tempfile
import os

DOCX = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/download/GAVEL-Change-Log-English.docx"


def main():
    tmpdir = tempfile.mkdtemp()
    with zipfile.ZipFile(DOCX, "r") as z:
        names = z.namelist()
        z.extractall(tmpdir)

    doc_path = os.path.join(tmpdir, "word", "document.xml")
    rels_path = os.path.join(tmpdir, "word", "_rels", "document.xml.rels")
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()
    with open(rels_path, encoding="utf-8") as f:
        rels = f.read()

    # 1. Remove empty pgNumType (no attributes)
    doc, n_removed = re.subn(r"<w:pgNumType/>", "", doc)

    # 2. Map rId -> footer target
    rid_map = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))

    # 3. For each sectPr, find footerReference + pgNumType fmt
    fmt_for_footer = {}  # footer file name -> "ROMAN" | "arabic"
    for sect in re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, flags=re.S):
        fmt_m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', sect)
        if not fmt_m:
            continue
        fmt = fmt_m.group(1)
        for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', sect):
            target = rid_map.get(rid, "")
            fname = os.path.basename(target)
            if fmt == "upperRoman":
                fmt_for_footer[fname] = "ROMAN"
            elif fmt == "decimal":
                fmt_for_footer[fname] = "arabic"

    patched = []
    for fname, fmt in fmt_for_footer.items():
        fpath = os.path.join(tmpdir, "word", fname)
        if not os.path.exists(fpath):
            continue
        with open(fpath, encoding="utf-8") as f:
            xml = f.read()
        new_xml, n = re.subn(
            r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
            r"\g<1> PAGE \\* " + fmt + r" \\* MERGEFORMAT \g<2>",
            xml,
        )
        if n:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(new_xml)
            patched.append((fname, fmt, n))

    # 4. Write back document.xml
    with open(doc_path, "w", encoding="utf-8") as f:
        f.write(doc)

    # 5. Re-zip
    tmp_docx = DOCX + ".tmp"
    with zipfile.ZipFile(tmp_docx, "w", zipfile.ZIP_DEFLATED) as z:
        for name in names:
            z.write(os.path.join(tmpdir, name), name)
    shutil.move(tmp_docx, DOCX)
    shutil.rmtree(tmpdir)

    print(f"pgNumType removed: {n_removed}")
    for fname, fmt, n in patched:
        print(f"footer {fname}: PAGE -> PAGE \\* {fmt} \\* MERGEFORMAT ({n} field(s))")
    print("OK")


if __name__ == "__main__":
    main()
