/**
 * apply_prosecutor_docai_patch_v7.cjs
 * Ensures server/src/analysis/evaluate.ts actually uses Document AI OCR.
 *
 * - Adds import: ocrPdfWithDocumentAI
 * - Replaces any "ocrPdfWithGemini(pdfBytes)" call with provider-based switch
 */

const fs = require("fs");

const FILE = "server/src/analysis/evaluate.ts";

function backup(p) {
  const b = `${p}.bak.${Date.now()}`;
  fs.copyFileSync(p, b);
  return b;
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Missing:", FILE);
    process.exit(1);
  }

  let src = fs.readFileSync(FILE, "utf8");

  // 1) Add import if missing
  if (!src.includes("ocrPdfWithDocumentAI")) {
    // Insert near other imports (after last import line)
    const importLine = `import { ocrPdfWithDocumentAI } from "./documentAiOcr";\n`;
    const m = src.match(/^(import[^\n]*\n)+/m);
    if (m) {
      const importsBlock = m[0];
      if (!importsBlock.includes(importLine.trim())) {
        src = src.replace(importsBlock, importsBlock + importLine);
      }
    } else {
      src = importLine + src;
    }
    console.log("✅ Added ocrPdfWithDocumentAI import");
  } else {
    console.log("ℹ️ ocrPdfWithDocumentAI import already present");
  }

  // 2) Replace OCR call site(s)
  // Find occurrences of: ocrText = await ocrPdfWithGemini(pdfBytes);
  // Replace with provider switch.
  const re = /ocrText\s*=\s*await\s*ocrPdfWithGemini\s*\(\s*pdfBytes\s*\)\s*;\s*/g;

  if (!re.test(src)) {
    console.error("❌ Could not find 'ocrPdfWithGemini(pdfBytes)' in evaluate.ts.");
    console.error("Run this and paste output:");
    console.error(`  grep -n "ocrPdfWith" server/src/analysis/evaluate.ts | head -n 50`);
    process.exit(1);
  }

  src = src.replace(
    re,
    `if (provider.kind === "document_ai") {
        ocrText = await ocrPdfWithDocumentAI(pdfBytes);
      } else {
        ocrText = await ocrPdfWithGemini(pdfBytes);
      }
`
  );

  // 3) Add a log line so you can SEE which OCR path ran
  if (!src.includes("DEBUG_OCR_PATH")) {
    src = src.replace(
      /if\s*\(\s*provider\.kind\s*===\s*["']document_ai["']\s*\)\s*\{\s*\n\s*ocrText\s*=\s*await\s*ocrPdfWithDocumentAI/,
      `if (provider.kind === "document_ai") {
        console.log("DEBUG_OCR_PATH document_ai");
        ocrText = await ocrPdfWithDocumentAI`
    );
    src = src.replace(
      /else\s*\{\s*\n\s*ocrText\s*=\s*await\s*ocrPdfWithGemini/,
      `else {
        console.log("DEBUG_OCR_PATH gemini");
        ocrText = await ocrPdfWithGemini`
    );
  }

  backup(FILE);
  fs.writeFileSync(FILE, src, "utf8");
  console.log("✅ Patched evaluate.ts OCR call to use Document AI when selected");
}

main();