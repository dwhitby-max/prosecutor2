/**
 * apply_prosecutor_docai_patch_v9.cjs
 *
 * Fixes:
 * - server/src/analysis/ocr.ts: remove duplicate prov, support document_ai correctly, fix provider narrowing for apiKey
 * - server/src/analysis/evaluate.ts: ensure OCR triggers when looksGarbledPrefix OR isScannedDocument, and uses docai when provider.kind=document_ai
 */

const fs = require("fs");
const path = require("path");

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

function main(){
  const ocrTs = "server/src/analysis/ocr.ts";
  const evalTs = "server/src/analysis/evaluate.ts";
  if (!fs.existsSync(ocrTs)) throw new Error(`Missing ${ocrTs}`);
  if (!fs.existsSync(evalTs)) throw new Error(`Missing ${evalTs}`);

  // -----------------------
  // 1) ocr.ts: rewrite getOcrProviderFromEnv safely (remove duplicate prov)
  // -----------------------
  replaceOrThrow(
    ocrTs,
    /export function getOcrProviderFromEnv\([\s\S]*?\n\}/m,
`export function getOcrProviderFromEnv(env: NodeJS.ProcessEnv): OcrProvider {
  const prov = (env.OCR_PROVIDER || '').trim().toLowerCase();

  // Document AI OCR
  if (prov === 'document_ai') {
    if (env.DOCUMENT_AI_PROJECT_ID && env.DOCUMENT_AI_LOCATION && env.DOCUMENT_AI_PROCESSOR_ID && env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON) {
      return { kind: 'document_ai' };
    }
  }

  // Gemini (used in this project for OCR fallback / reasoning if configured)
  if (env.AI_INTEGRATIONS_GEMINI_API_KEY && env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    return { kind: 'gemini' };
  }

  // Google Vision OCR
  if (prov === 'google_vision') {
    const key = env.GOOGLE_VISION_API_KEY;
    if (typeof key === 'string' && key.trim().length > 0) {
      return { kind: 'google_vision', apiKey: key.trim() };
    }
  }

  return { kind: 'none' };
}`,
    "getOcrProviderFromEnv() rewrite"
  );

  // -----------------------
  // 2) ocr.ts: fix apiKey access by narrowing provider.kind
  // This fixes TS2339: apiKey missing on document_ai.
  // -----------------------
  // Replace any usage of provider.apiKey in a Vision URL with a narrowed version.
  const ocrSrc = read(ocrTs);
  if (ocrSrc.includes("provider.apiKey")) {
    backup(ocrTs);
    write(
      ocrTs,
      ocrSrc.replace(
        /encodeURIComponent\(provider\.apiKey\)/g,
        `encodeURIComponent(provider.kind === 'google_vision' ? provider.apiKey : '')`
      )
    );
    console.log("✅ Patched provider.apiKey narrowing in ocr.ts");
  } else {
    console.log("ℹ️ No provider.apiKey usage found in ocr.ts");
  }

  // -----------------------
  // 3) evaluate.ts: ensure OCR trigger uses looksGarbledPrefix OR isScannedDocument
  // We patch near the actual ocrPdfWithGemini callsite(s).
  // -----------------------
  let e = read(evalTs);

  // Ensure provider.kind type includes document_ai in evaluate.ts context by using string literal comparison (already OK).
  // Patch the OCR trigger condition by widening any `isScannedDocument(t.text)`-based if to include looksGarbledPrefix
  // We do a loose replace: "if (isScannedDocument(t.text)" -> "if ((isScannedDocument(t.text) || looksGarbledPrefix(t.text))"
  const before = e;
  e = e.replace(
    /if\s*\(\s*isScannedDocument\(t\.text\)\s*/g,
    "if ((isScannedDocument(t.text) || looksGarbledPrefix(t.text)) "
  );

  // Now ensure the OCR callsite prefers Document AI when provider.kind === 'document_ai'
  // Replace any direct ocrPdfWithGemini(pdfBytes) assignment with our switch (if not already switched)
  e = e.replace(
    /ocrText\s*=\s*await\s*ocrPdfWithGemini\s*\(\s*pdfBytes\s*\)\s*;/g,
`if (provider.kind === "document_ai") {
        console.log("DEBUG_OCR_PATH document_ai");
        ocrText = await ocrPdfWithDocumentAI(pdfBytes);
      } else {
        console.log("DEBUG_OCR_PATH gemini");
        ocrText = await ocrPdfWithGemini(pdfBytes);
      }`
  );

  if (e !== before) {
    backup(evalTs);
    write(evalTs, e);
    console.log("✅ Patched OCR trigger + OCR callsite in evaluate.ts");
  } else {
    console.log("ℹ️ evaluate.ts did not change (may already be patched).");
  }

  console.log("\n✅ Patch v9 complete.");
  console.log("Now run:");
  console.log("  npm --prefix server run build");
}

main();