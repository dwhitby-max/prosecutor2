/**
 * apply_prosecutor_docai_patch_v8.cjs
 * Fixes:
 * - ocr.ts: add document_ai to provider type + env selection
 * - evaluate.ts: treat spaced symbol-soup as garbled and OCR it
 */

const fs = require("fs");

function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.writeFileSync(p,s,"utf8"); }
function backup(p){ const b=p+`.bak.${Date.now()}`; fs.copyFileSync(p,b); return b; }

function replaceOrThrow(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`❌ Not found: ${label} in ${file}`);
  backup(file);
  write(file, src.replace(re, replacement));
  console.log(`✅ Patched ${label}: ${file}`);
}

function main() {
  const ocrTs = "server/src/analysis/ocr.ts";
  const evalTs = "server/src/analysis/evaluate.ts";

  if (!fs.existsSync(ocrTs)) throw new Error(`Missing ${ocrTs}`);
  if (!fs.existsSync(evalTs)) throw new Error(`Missing ${evalTs}`);

  // ---------------------------
  // 1) ocr.ts: Ensure document_ai is part of OcrProvider union
  // ---------------------------
  // Make union include document_ai (robust replace: insert line if missing)
  {
    const src = read(ocrTs);
    if (!src.includes("'document_ai'")) {
      const out = src.replace(
        /export type OcrProvider\s*=\s*[\s\S]*?;\s*\n/m,
        (m) => {
          // Insert document_ai variant before the ending semicolon
          if (m.includes("kind: 'document_ai'")) return m;
          const trimmed = m.replace(/;\s*\n$/, "\n");
          return trimmed.replace(/\n\s*;\s*$/m, "") +
            `  | { kind: 'document_ai' };\n`;
        }
      );

      // If the above didn’t match (file formatted differently), do a fallback append.
      if (out === src) {
        backup(ocrTs);
        write(ocrTs, src + `\n\n// Added by patch v8\nexport type DocumentAiProvider = { kind: 'document_ai' };\n`);
        console.log("⚠️ Could not rewrite OcrProvider union cleanly; appended DocumentAiProvider type.");
      } else {
        backup(ocrTs);
        write(ocrTs, out);
        console.log("✅ Added document_ai to OcrProvider union");
      }
    } else {
      console.log("ℹ️ ocr.ts already mentions document_ai");
    }
  }

  // Ensure getOcrProviderFromEnv can return document_ai when fully configured
  {
    const src = read(ocrTs);
    if (!src.includes("prov === 'document_ai'") && !src.includes('prov === "document_ai"')) {
      // Insert a document_ai block near top of function
      const re = /export function getOcrProviderFromEnv\([\s\S]*?\)\s*:\s*OcrProvider\s*\{[\s\S]*?\n\}/m;
      if (!re.test(src)) throw new Error("❌ Could not find getOcrProviderFromEnv() to patch in ocr.ts");

      const out = src.replace(re, (fn) => {
        if (fn.includes("DOCUMENT_AI_PROJECT_ID")) return fn;
        return fn.replace(
          /\{\s*\n/,
          `{\n  const prov = (env.OCR_PROVIDER || '').trim().toLowerCase();\n\n  // Document AI OCR\n  if (prov === 'document_ai') {\n    if (env.DOCUMENT_AI_PROJECT_ID && env.DOCUMENT_AI_LOCATION && env.DOCUMENT_AI_PROCESSOR_ID && env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON) {\n      return { kind: 'document_ai' };\n    }\n  }\n\n`
        );
      });

      backup(ocrTs);
      write(ocrTs, out);
      console.log("✅ Patched getOcrProviderFromEnv() for document_ai");
    } else {
      console.log("ℹ️ getOcrProviderFromEnv already handles document_ai");
    }
  }

  // ---------------------------
  // 2) evaluate.ts: Force OCR when the FIRST part of text is symbol-soup (even with spaces)
  // ---------------------------
  // Add helper looksGarbledPrefix() once
  {
    let src = read(evalTs);
    if (!src.includes("function looksGarbledPrefix")) {
      const insertPoint = src.indexOf("function ");
      const helper = `
function looksGarbledPrefix(text: string): boolean {
  if (!text) return true;
  const head = text.slice(0, 1200);
  const cleaned = head.replace(/\\u0000/g, "").replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, " ");
  // remove whitespace to measure symbol density even when spaced out
  const compact = cleaned.replace(/\\s+/g, "");
  if (compact.length < 80) return true;

  const letters = (compact.match(/[A-Za-z]/g) || []).length;
  const digits = (compact.match(/[0-9]/g) || []).length;
  const alnum = letters + digits;
  const symbols = Math.max(0, compact.length - alnum);
  const symbolRatio = symbols / compact.length;

  // Your junk prefix has very high symbol ratio
  if (symbolRatio > 0.45) return true;

  // Also catch many punctuation characters overall
  const punct = (compact.match(/[!"#$%&'()*+,\\-./:;<=>?@\$begin:math:display$\\$end:math:display$\\\\^_\\\`{|}~]/g) || []).length;
  if (punct / compact.length > 0.35) return true;

  return false;
}
`.trim() + "\n\n";

      // Insert near top (after imports)
      const m = src.match(/^(import[^\n]*\n)+/m);
      if (m) src = src.replace(m[0], m[0] + "\n" + helper);
      else src = helper + src;

      backup(evalTs);
      write(evalTs, src);
      console.log("✅ Added looksGarbledPrefix() helper to evaluate.ts");
    } else {
      console.log("ℹ️ looksGarbledPrefix already present");
    }
  }

  // Replace the OCR trigger condition to use looksGarbledPrefix OR isScannedDocument
  replaceOrThrow(
    evalTs,
    /if\s*$begin:math:text$\\s\*isScannedDocument\\\(t\\\.text$end:math:text$\s*&&\s*provider\.kind\s*!==\s*['"]none['"]\s*\)\s*\{[\s\S]*?\n\s*\}/m,
`if ((isScannedDocument(t.text) || looksGarbledPrefix(t.text)) && provider.kind !== 'none') {
      console.log('Detected garbled/scanned document, running OCR...');
      if (provider.kind === 'document_ai') {
        console.log('DEBUG_OCR_PATH document_ai');
        ocrText = await ocrPdfWithDocumentAI(pdfBytes);
      } else {
        console.log('DEBUG_OCR_PATH gemini');
        ocrText = await ocrPdfWithGemini(pdfBytes);
      }
      ocrUsed = ocrText.length > 0;
    }`,
    "OCR trigger condition (garble/scanned) in evaluate.ts"
  );

  console.log("\n✅ Patch v8 complete.");
  console.log("Now run:");
  console.log("  npm --prefix server run build");
}

main();