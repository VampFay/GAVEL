// GAVEL Deployment Plan — main assembly (3-section: cover / front matter / body)
const {
  Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber,
  AlignmentType, HeadingLevel, SectionType, NumberFormat, PageBreak,
  TableOfContents,
} = require("docx");
const fs = require("fs");
const { P, buildCoverR1 } = require("./helpers");
const content1 = require("./content1");
const content2 = require("./content2");
const content3 = require("./content3");

const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

// ── header (body sections): abbreviated title ──
function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: 240, after: 0 },
      children: [new TextRun({ text: "GAVEL Production Readiness and Deployment Plan",
        size: 18, color: "808080", font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
    })],
  });
}

// ── footer: bare current page number only (no totals) ──
function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: 240, after: 0 },
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080",
        font: { ascii: "Times New Roman" } })],
    })],
  });
}

// ── front matter: TOC ──
const frontMatter = [
  // TOC title — MUST NOT use HeadingLevel (would index itself)
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 360, line: 372, lineRule: "atLeast" },
    children: [new TextRun({ text: "Table of Contents", bold: true, size: 32,
      color: P.headingColor, font: { eastAsia: "SimHei", ascii: "Times New Roman" } })],
  }),
  new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-3",
  }),
  // MANDATORY refresh hint (between TOC element and PageBreak)
  new Paragraph({
    spacing: { before: 200, line: 276 },
    children: [new TextRun({
      text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
      italics: true, size: 18, color: "888888",
      font: { ascii: "Times New Roman", eastAsia: "SimSun" },
    })],
  }),
  // MANDATORY PageBreak after TOC
  new Paragraph({ children: [new PageBreak()] }),
];

// ── document ──
const doc = new Document({
  creator: "GAVEL Engineering",
  title: "GAVEL Production Readiness and Deployment Plan",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 32, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 400, after: 200, line: 372 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 28, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 280, after: 140, line: 348 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 24, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 220, after: 110, line: 324 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    // ── Section 1: Cover — margin 0, no page numbers, no header/footer ──
    {
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "GAVEL Production Readiness and Deployment Plan",
        subtitle: "Eliminating every blocker between the sandbox and real organisational deployments",
        englishLabel: "FORENSIC RECONCILIATION PLATFORM",
        metaLines: [
          "Scope: All seven deployment blockers, with architecture-level remediation plans",
          "Topology: Hybrid - single-tenant pilots, multi-tenant-ready schema",
          "Sequencing: Dependency-ordered phases P0-P3, no calendar commitments",
          "Compliance: DPDP (India) primary; GDPR and SOC 2 foundations mapped",
          "Audience: Founder and engineering team",
        ],
        footerLeft: "GAVEL ENGINEERING",
        footerRight: "CONFIDENTIAL - INTERNAL PLANNING DOCUMENT",
        palette: P,
      }),
    },
    // ── Section 2: Front matter (TOC) — Roman numerals ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: pgSize, margin: pgMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter() },
      children: frontMatter,
    },
    // ── Section 3: Body — Arabic, restart at 1 ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: pgSize, margin: pgMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter() },
      children: [...content1, ...content2, ...content3],
    },
  ],
});

const OUT = "/home/z/my-project/download/GAVEL-Production-Readiness-and-Deployment-Plan.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE", OUT, buf.length, "bytes");
});
