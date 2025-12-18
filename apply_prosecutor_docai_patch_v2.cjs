/**
 * apply_prosecutor_docai_patch_v2.cjs
 * Fixes:
 * - Document AI dependency + module
 * - Keeps extractPdfImages(pdfBytes)->{images:[]}
 * - Adds required imports in pdf.ts
 * - Adds Document AI as OCR provider and uses it for scanned docs
 * - Replaces local evaluateElements() with async smart wrapper (Gemini optional)
 */

const fs = require("fs");
const path = require("path");

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, "utf8"); }
function backup(p) { const b = `${p}.bak.${Date.now()}`; fs.copyFileSync(p, b); return b; }

function replaceOrThrow(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`❌ ${label} not found in ${file}`);
  const out = src.replace(re, replacement);
  backup(file);
  write(file, out);
  console.log(`✅ Patched ${label}: ${file}`);
}

function main() {
  const serverPkg = "server/package.json";
  const pdfTs = "server/src/analysis/pdf.ts";
  const ocrTs = "server/src/analysis/ocr.ts";
  const evalTs = "server/src/analysis/evaluate.ts";

  for (const p of [serverPkg, pdfTs, ocrTs, evalTs]) {
    if (!fs.existsSync(p)) throw new Error(`Run from repo root. Missing: ${p}`);
  }

  // ---------------------------------------------------------------------------
  // 1) Add @google-cloud/documentai dependency to server/package.json
  // ---------------------------------------------------------------------------
  {
    const pkg = JSON.parse(read(serverPkg));
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies["@google-cloud/documentai"]) {
      pkg.dependencies["@google-cloud/documentai"] = "^9.6.0";
      backup(serverPkg);
      write(serverPkg, JSON.stringify(pkg, null, 2) + "\n");
      console.log("✅ Added server dependency: @google-cloud/documentai");
    } else {
      console.log("ℹ️ server already has @google-cloud/documentai");
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Add Document AI OCR module (ESM TS)
  // ---------------------------------------------------------------------------
  const docAiFile = "server/src/analysis/documentAiOcr.ts";
  write(docAiFile, `
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(\`Missing env: \${k}\`);
  return v.trim();
}

export async function ocrPdfWithDocumentAI(pdfBytes: Buffer): Promise<string> {
  const json = mustEnv("DOCUMENT_AI_SERVICE_ACCOUNT_JSON");
  const credentials = JSON.parse(json);

  const client = new DocumentProcessorServiceClient({ credentials });

  const projectId = mustEnv("DOCUMENT_AI_PROJECT_ID");
  const location = mustEnv("DOCUMENT_AI_LOCATION");
  const processorId = mustEnv("DOCUMENT_AI_PROCESSOR_ID");

  const name = client.processorPath(projectId, location, processorId);

  const [res] = await client.processDocument({
    name,
    rawDocument: { content: pdfBytes, mimeType: "application/pdf" },
  });

  return res.document?.text?.trim() || "";
}
`.trim() + "\n");
  console.log("✅ Wrote Document AI OCR module");

  // ---------------------------------------------------------------------------
  // 3) Fix pdf.ts:
  //   - add imports fs/path/cp
  //   - implement extractPdfImages(pdfBytes)->{images:ExtractedImage[]}
  //     using pdfimages by writing a temp PDF to disk
  // ---------------------------------------------------------------------------

  // a) ensure imports exist
  {
    const src = read(pdfTs);
    if (!src.includes("import fs from 'fs'")) {
      const insertion =
`import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';\n`;
      // insert after existing imports
      const out = src.replace(/^(import .*?\nimport .*?\n)/, `$1${insertion}`);
      backup(pdfTs);
      write(pdfTs, out);
      console.log("✅ Added fs/path/execSync imports to pdf.ts");
    } else {
      console.log("ℹ️ pdf.ts already has fs imports");
    }
  }

  // b) replace extractPdfImages implementation (keep signature and return type)
  replaceOrThrow(
    pdfTs,
    /export async function extractPdfImages\([\s\S]*?\)\: Promise<PdfImagesResult> \{[\s\S]*?\n\}/m,
`export async function extractPdfImages(pdfBytes: Buffer): Promise<PdfImagesResult> {
  // Best-effort extraction of embedded images using Poppler's pdfimages.
  // If pdfimages is unavailable in the runtime, we gracefully return no images.
  const tmpRoot = path.join(process.cwd(), 'uploads', 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmpPdf = path.join(tmpRoot, \`imgsrc-\${Date.now()}-\${Math.random().toString(16).slice(2)}.pdf\`);
  const outDir = path.join(tmpRoot, \`imgs-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    fs.writeFileSync(tmpPdf, pdfBytes);
    // -all extracts png/jpg/ppm depending on embedded types
    execSync(\`pdfimages -all "\${tmpPdf}" "\${path.join(outDir, 'img')}"\`, { stdio: 'ignore' });

    const files = fs.readdirSync(outDir).filter(f => /\\.(png|jpg|jpeg|ppm|pbm|pgm)$/i.test(f));
    const images: ExtractedImage[] = [];
    let idx = 0;

    for (const f of files) {
      const fp = path.join(outDir, f);
      const bytes = fs.readFileSync(fp);
      const lower = f.toLowerCase();
      const mimeType =
        lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? ('image/jpeg' as const)
          : ('image/png' as const);

      images.push({ index: idx++, page: null, mimeType, bytes });
    }

    return { images };
  } catch {
    return { images: [] };
  } finally {
    // cleanup
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpPdf, { force: true }); } catch {}
  }
}`,
    "extractPdfImages(pdfBytes) implementation"
  );

  // ---------------------------------------------------------------------------
  // 4) Extend ocr.ts provider to include document_ai
  // ---------------------------------------------------------------------------
  replaceOrThrow(
    ocrTs,
    /export type OcrProvider[\s\S]*?;\n\nexport type OcrRequest/m,
`export type OcrProvider =
  | { kind: 'none' }
  | { kind: 'google_vision'; apiKey: string }
  | { kind: 'gemini' }
  | { kind: 'document_ai' };

export type OcrRequest`,
    "OcrProvider union"
  );

  replaceOrThrow(
    ocrTs,
    /export function getOcrProviderFromEnv[\s\S]*?\n\}/m,
`export function getOcrProviderFromEnv(env: NodeJS.ProcessEnv): OcrProvider {
  // Document AI explicitly selected
  const prov = (env.OCR_PROVIDER || '').trim().toLowerCase();
  if (prov === 'document_ai') {
    // require key envs to consider configured
    if (env.DOCUMENT_AI_PROJECT_ID && env.DOCUMENT_AI_LOCATION && env.DOCUMENT_AI_PROCESSOR_ID && env.DOCUMENT_AI_SERVICE_ACCOUNT_JSON) {
      return { kind: 'document_ai' };
    }
  }

  // Gemini AI Integrations (used for image OCR in ocrPngPage)
  if (env.AI_INTEGRATIONS_GEMINI_API_KEY && env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    return { kind: 'gemini' };
  }

  // Google Vision API fallback
  if (prov === 'google_vision') {
    const key = env.GOOGLE_VISION_API_KEY;
    if (typeof key === 'string' && key.trim().length > 0) {
      return { kind: 'google_vision', apiKey: key.trim() };
    }
  }

  return { kind: 'none' };
}`,
    "getOcrProviderFromEnv"
  );

  // ---------------------------------------------------------------------------
  // 5) Patch evaluate.ts:
  //   - Use Document AI OCR for scanned PDFs when OCR_PROVIDER=document_ai
  //   - Replace local evaluateElements() with async wrapper that can use Gemini for element matching
  // ---------------------------------------------------------------------------

  // a) add import for docai OCR
  {
    const src = read(evalTs);
    if (!src.includes("ocrPdfWithDocumentAI")) {
      const out = src.replace(
        /import \{ GoogleGenAI \} from "@google\/genai";\n/,
        `import { GoogleGenAI } from "@google/genai";
import { ocrPdfWithDocumentAI } from './documentAiOcr.js';\n`
      );
      backup(evalTs);
      write(evalTs, out);
      console.log("✅ Added ocrPdfWithDocumentAI import to evaluate.ts");
    } else {
      console.log("ℹ️ evaluate.ts already imports docai");
    }
  }

  // b) Replace the OCR section in runAnalysis loop to use docai when selected
  replaceOrThrow(
    evalTs,
    /\/\/ Check if text extraction produced garbage[\s\S]*?const finalText = ocrUsed \? ocrText : t\.text;/m,
`// Check if text extraction produced garbage (scanned/garbled document)
    if (isScannedDocument(t.text) && provider.kind !== 'none') {
      console.log('Detected scanned/garbled document, running OCR...');
      if (provider.kind === 'document_ai') {
        ocrText = await ocrPdfWithDocumentAI(pdfBytes);
      } else {
        // existing Gemini OCR (kept for compatibility)
        ocrText = await ocrPdfWithGemini(pdfBytes);
      }
      ocrUsed = ocrText.length > 0;
    }

    // Use OCR text if available, otherwise use extracted text
    const finalText = ocrUsed ? ocrText : t.text;`,
    "runAnalysis OCR selection"
  );

  // c) Replace local evaluateElements() with async smart evaluator (keeps return shape)
  // Find the existing function signature "function evaluateElements(narrative: string, statuteText: string): ElementsResult {"
  replaceOrThrow(
    evalTs,
    /function evaluateElements\(narrative: string, statuteText: string\): ElementsResult \{[\s\S]*?\n\}/m,
`async function evaluateElementsSmart(narrative: string, statuteText: string): Promise<ElementsResult> {
  // If Gemini is configured, ask it to do element-style matching and missing elements.
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

  if (apiKey && baseUrl) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "", baseUrl },
      });

      const prompt = \`You are screening whether a police narrative meets the elements of a statute.

Return JSON ONLY with shape:
{
  "overall":"met"|"unclear",
  "elements":[{"element":string,"status":"met"|"unclear","evidenceSnippets":[string]}],
  "notes":[string]
}

Narrative:
\${narrative}

Statute text:
\${statuteText}\`;

      const resp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const raw = (resp.text || "").trim();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
        if (parsed && parsed.overall && parsed.elements && parsed.notes) {
          return parsed as ElementsResult;
        }
      }
    } catch (e) {
      // fall through to keyword method
    }
  }

  // Keyword fallback (your existing behavior)
  const elements = buildElementsFromStatuteText(statuteText);
  const checks = elements.map((el) => {
    const keys = keywordize(el);
    const evidence = findEvidence(narrative, keys);
    const status: 'met' | 'unclear' = keys.length >= 2 && evidence.length > 0 ? 'met' : 'unclear';
    return { element: el, status, evidenceSnippets: evidence };
  });
  const metCount = checks.filter((c) => c.status === 'met').length;
  const overall: 'met' | 'unclear' = metCount >= Math.max(1, Math.floor(checks.length * 0.6)) ? 'met' : 'unclear';
  return { overall, elements: checks, notes: ['Screening-only: keyword evidence vs statute text.'] };
}`,
    "evaluateElementsSmart()"
  );

  // d) Update callers that currently do: result: evaluateElements(...)
  replaceOrThrow(
    evalTs,
    /result: evaluateElements\(narrative, st\.text\)/g,
    "result: await evaluateElementsSmart(narrative, st.text)",
    "call sites to await evaluateElementsSmart"
  );

  console.log("\n✅ Patch v2 applied successfully.");
  console.log("NEXT: run installs + build (commands below).");
}

main();