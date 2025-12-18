/**
 * apply_prosecutor_docai_patch.cjs
 * One-shot patch for Prosecutor app (Document AI OCR pipeline)
 *
 * Run from repo root:
 *   node apply_prosecutor_docai_patch.cjs
 *   npm --prefix server run build
 */

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,c){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,c,"utf8"); }
function backup(p){ const b=p+".bak."+Date.now(); fs.copyFileSync(p,b); return b; }

function replaceBlock(file, matcher, replacement, label){
  const src = read(file);
  if(!matcher.test(src)) throw new Error(`❌ ${label} not found in ${file}`);
  backup(file);
  write(file, src.replace(matcher, replacement));
  console.log(`✅ Patched ${label}`);
}

/* ------------------------------------------------------------------ */
/* 1) FIX PDF TEXT / OCR DETECTION                                     */
/* ------------------------------------------------------------------ */

const pdfTs = "server/src/analysis/pdf.ts";

replaceBlock(
  pdfTs,
  /export function isScannedDocument[\s\S]*?\n\}/m,
  `export function isScannedDocument(text: string): boolean {
  if (!text || text.trim().length < 120) return true;

  if (/\$begin:math:text$cid\:\\\\d\+\\$end:math:text$/i.test(text)) return true;

  const cleaned = text
    .replace(/\\u0000/g, "")
    .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, "")
    .trim();

  if (cleaned.length < 120) return true;

  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const spaces = (cleaned.match(/\\s/g) || []).length;
  const symbols = cleaned.length - letters - spaces;

  if (symbols / cleaned.length > 0.35) return true;
  if (letters / cleaned.length < 0.25) return true;

  return false;
}`,
  "isScannedDocument"
);

/* ------------------------------------------------------------------ */
/* 2) ADD DOCUMENT AI OCR PIPELINE                                     */
/* ------------------------------------------------------------------ */

const ocrFile = "server/src/analysis/documentAiOcr.ts";

write(ocrFile, `
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

export async function ocrWithDocumentAI(pdf: Buffer): Promise<string> {
  const client = new DocumentProcessorServiceClient({
    credentials: JSON.parse(process.env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON || "{}"),
  });

  const name = client.processorPath(
    process.env.DOCUMENT_AI_PROJECT_ID!,
    process.env.DOCUMENT_AI_LOCATION!,
    process.env.DOCUMENT_AI_PROCESSOR_ID!
  );

  const [res] = await client.processDocument({
    name,
    rawDocument: { content: pdf, mimeType: "application/pdf" }
  });

  return res.document?.text || "";
}
`);

console.log("✅ Added Document AI OCR module");

/* ------------------------------------------------------------------ */
/* 3) IMAGE EXTRACTION (REQ #7)                                        */
/* ------------------------------------------------------------------ */

replaceBlock(
  pdfTs,
  /export async function extractPdfImages[\s\S]*?\n\}/m,
  `export async function extractPdfImages(pdfPath: string, outDir: string): Promise<string[]> {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    cp.execSync(\`pdfimages -all "\${pdfPath}" "\${outDir}/img"\`);
    return fs.readdirSync(outDir).map(f => path.join(outDir, f));
  } catch {
    return [];
  }
}`,
  "extractPdfImages"
);

/* ------------------------------------------------------------------ */
/* 4) ELEMENT MATCHING LOGIC (REQ #5)                                  */
/* ------------------------------------------------------------------ */

const evalTs = "server/src/analysis/evaluate.ts";

replaceBlock(
  evalTs,
  /export async function evaluateElements[\s\S]*?\n\}/m,
  `export async function evaluateElements(statute: any, facts: string) {
  if (process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    return await evaluateWithLLM(statute, facts);
  }
  return keywordEvaluate(statute, facts);
}`,
  "evaluateElements"
);

console.log("🎉 PATCH COMPLETE");
console.log("Next:");
console.log("  node apply_prosecutor_docai_patch.cjs");
console.log("  npm --prefix server run build");