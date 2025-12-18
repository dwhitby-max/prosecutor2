/**
 * apply_prosecutor_docai_patch_v4.cjs
 *
 * Fixes remaining "[DOC] garbage" by:
 *  - Forcing OCR text to replace extracted text when extraction looks garbled
 *  - Sanitizing text before building display strings
 *  - Removing "[DOC]" prefix concatenations (so you see real text, not wrapped garbage)
 *  - Adding log lines to confirm OCR was used and which text was selected
 */

const fs = require("fs");
const path = require("path");

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, "utf8"); }
function backup(p) { const b = `${p}.bak.${Date.now()}`; fs.copyFileSync(p, b); return b; }

function replaceAll(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) {
    console.log(`ℹ️ Skipped (not found): ${label}`);
    return;
  }
  backup(file);
  write(file, src.replace(re, replacement));
  console.log(`✅ Patched: ${label}`);
}

function replaceOrThrow(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`❌ Not found: ${label} in ${file}`);
  backup(file);
  write(file, src.replace(re, replacement));
  console.log(`✅ Patched: ${label}`);
}

function main() {
  const evalTs = "server/src/analysis/evaluate.ts";
  const pdfTs  = "server/src/analysis/pdf.ts";

  if (!fs.existsSync(evalTs)) throw new Error(`Missing ${evalTs}`);
  if (!fs.existsSync(pdfTs)) throw new Error(`Missing ${pdfTs}`);

  // ---------------------------------------------------------------------------
  // 1) Strengthen garble detection (catch the exact symbol soup you're seeing)
  // ---------------------------------------------------------------------------
  replaceOrThrow(
    pdfTs,
    /export function isScannedDocument\([\s\S]*?\n\}/m,
`export function isScannedDocument(text: string): boolean {
  if (!text || text.trim().length < 120) return true;

  // Common broken font extraction marker
  if (/\\(cid:\\d+\\)/i.test(text)) return true;

  // Strip control chars for evaluation
  const cleaned = text
    .replace(/\\u0000/g, "")
    .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, " ")
    .trim();

  if (cleaned.length < 120) return true;

  // Long runs of punctuation/symbols (matches your output)
  if (/[!"#$%&'()*+,\\-./0-9:;<=>?@\$begin:math:display$\\$end:math:display$\\\\^_\\\`{|}~]{18,}/.test(cleaned)) return true;

  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const spaces = (cleaned.match(/\\s/g) || []).length;
  const symbols = Math.max(0, cleaned.length - letters - spaces);

  const letterRatio = letters / cleaned.length;
  const symbolRatio = symbols / cleaned.length;

  if (symbolRatio > 0.33 && letterRatio < 0.22) return true;

  return false;
}`,
    "isScannedDocument() strengthened"
  );

  // ---------------------------------------------------------------------------
  // 2) Ensure the text that propagates into analysis is OCR text when needed
  //    (This is the key fix.)
  // ---------------------------------------------------------------------------
  // We look for the block where finalText is selected and make it bulletproof.
  replaceOrThrow(
    evalTs,
    /const finalText = ocrUsed \? ocrText : t\.text;/m,
`const sanitizeText = (s: string) =>
      (s || "")
        .replace(/\\u0000/g, "")
        .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim();

// Prefer OCR text whenever extraction is garbled AND OCR produced something usable
const extracted = sanitizeText(t.text);
const ocrClean = sanitizeText(ocrText);

let finalText = extracted;
if (isScannedDocument(t.text) && ocrClean.length > 200) {
  finalText = ocrClean;
  console.log("✅ Using OCR text (Document AI/Gemini) because extracted text was garbled.");
} else if (ocrClean.length > 200 && extracted.length < 200) {
  finalText = ocrClean;
  console.log("✅ Using OCR text (extracted text too short).");
} else {
  console.log("ℹ️ Using extracted text (OCR not needed or not available).");
}`,
    "finalText selection forced to OCR when garbled"
  );

  // ---------------------------------------------------------------------------
  // 3) Remove "[DOC]" prefix concatenations that are leaking garbage into output
  //    (We keep the document separation, but without that prefix.)
  // ---------------------------------------------------------------------------
  replaceAll(
    evalTs,
    /\$begin:math:display$DOC\\$end:math:display$\\s*/g,
    "",
    "Remove literal [DOC] tag in evaluate.ts"
  );

  // Also remove any template/concat that injects "[DOC]" in other ways
  replaceAll(
    evalTs,
    /`\\[DOC\\]\\s*\\$\\{([^}]+)\\}`/g,
    "`$${1}`",
    "Remove [DOC] template wrappers"
  );

  console.log("\n✅ Patch v4 complete.");
  console.log("Now run:");
  console.log("  npm --prefix server run build");
}

main();