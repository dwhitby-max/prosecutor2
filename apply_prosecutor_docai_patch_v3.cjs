/**
 * apply_prosecutor_docai_patch_v3.cjs
 *
 * Fixes:
 * - Restore extractPdfImages signature expected by evaluate.ts: extractPdfImages(pdfBytes)->{images:[]}
 * - Remove cp.execSync usage; use execSync
 * - Make Document AI dependency installable without pinning a bad version
 * - Add TS shim for @google-cloud/documentai so tsc can pass if install is delayed
 */

const fs = require("fs");
const path = require("path");

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, "utf8"); }
function backup(p) { const b = `${p}.bak.${Date.now()}`; fs.copyFileSync(p, b); return b; }

function replaceOrThrow(file, re, replacement, label) {
  const src = read(file);
  if (!re.test(src)) throw new Error(`❌ ${label} not found in ${file}`);
  backup(file);
  write(file, src.replace(re, replacement));
  console.log(`✅ Patched ${label}: ${file}`);
}

function ensureImport(file, importLine) {
  const src = read(file);
  if (src.includes(importLine)) return;
  const out = importLine + "\n" + src;
  backup(file);
  write(file, out);
  console.log(`✅ Added import to ${file}: ${importLine}`);
}

function upsertDocumentAiDependency() {
  const serverPkg = "server/package.json";
  const pkg = JSON.parse(read(serverPkg));
  pkg.dependencies = pkg.dependencies || {};

  // Remove any pinned bad version
  if (pkg.dependencies["@google-cloud/documentai"]) {
    pkg.dependencies["@google-cloud/documentai"] = "latest";
  } else {
    pkg.dependencies["@google-cloud/documentai"] = "latest";
  }

  backup(serverPkg);
  write(serverPkg, JSON.stringify(pkg, null, 2) + "\n");
  console.log("✅ Set server dependency @google-cloud/documentai to 'latest'");
}

function writeDocumentAiModule() {
  const docAiFile = "server/src/analysis/documentAiOcr.ts";
  write(docAiFile, `
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(\`Missing env: \${k}\`);
  return v.trim();
}

export async function ocrPdfWithDocumentAI(pdfBytes: Buffer): Promise<string> {
  const credentials = JSON.parse(mustEnv("DOCUMENT_AI_SERVICE_ACCOUNT_JSON"));
  const client = new DocumentProcessorServiceClient({ credentials });

  const projectId = mustEnv("DOCUMENT_AI_PROJECT_ID");
  const location = mustEnv("DOCUMENT_AI_LOCATION");
  const processorId = mustEnv("DOCUMENT_AI_PROCESSOR_ID");

  const name = client.processorPath(projectId, location, processorId);

  const [res] = await client.processDocument({
    name,
    rawDocument: { content: pdfBytes, mimeType: "application/pdf" }
  });

  return (res.document?.text || "").trim();
}
`.trim() + "\n");
  console.log("✅ Wrote server/src/analysis/documentAiOcr.ts");
}

function writeTypeShim() {
  // If npm install is temporarily failing, this prevents tsc from hard-failing on missing types.
  const shim = "server/src/types/documentai-shim.d.ts";
  write(shim, `
declare module "@google-cloud/documentai" {
  export class DocumentProcessorServiceClient {
    constructor(opts?: any);
    processorPath(projectId: string, location: string, processorId: string): string;
    processDocument(req: any): Promise<any>;
  }
}
`.trim() + "\n");
  console.log("✅ Wrote TS shim: server/src/types/documentai-shim.d.ts");
}

function patchPdfImagesToExpectedSignature() {
  const pdfTs = "server/src/analysis/pdf.ts";
  if (!fs.existsSync(pdfTs)) throw new Error(`Missing ${pdfTs}`);

  // Ensure required imports exist (safe if duplicated check)
  const src = read(pdfTs);

  // Make sure fs/path and execSync are available; but do NOT rely on cp.*
  if (!src.includes("import fs")) {
    ensureImport(pdfTs, `import fs from "fs";`);
  }
  if (!read(pdfTs).includes("import path")) {
    ensureImport(pdfTs, `import path from "path";`);
  }
  if (!read(pdfTs).includes('from "child_process"') && !read(pdfTs).includes("from 'child_process'")) {
    ensureImport(pdfTs, `import { execSync } from "child_process";`);
  }

  // Replace ANY existing extractPdfImages(...) function regardless of signature/return
  // This catches the v1 version (pdfPath,outDir)->string[] and any other variant.
  replaceOrThrow(
    pdfTs,
    /export\s+async\s+function\s+extractPdfImages\s*\([\s\S]*?\)\s*:\s*Promise<[\s\S]*?>\s*\{[\s\S]*?\n\}/m,
`export async function extractPdfImages(pdfBytes: Buffer): Promise<PdfImagesResult> {
  // Best-effort embedded image extraction using Poppler's pdfimages.
  // If pdfimages is unavailable, returns { images: [] } without crashing.
  const tmpRoot = path.join(process.cwd(), "uploads", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });

  const tmpPdf = path.join(tmpRoot, \`imgsrc-\${Date.now()}-\${Math.random().toString(16).slice(2)}.pdf\`);
  const outDir = path.join(tmpRoot, \`imgs-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    fs.writeFileSync(tmpPdf, pdfBytes);
    execSync(\`pdfimages -all "\${tmpPdf}" "\${path.join(outDir, "img")}"\`, { stdio: "ignore" });

    const files = fs.readdirSync(outDir).filter(f => /\\.(png|jpe?g|ppm|pbm|pgm)$/i.test(f));
    const images: ExtractedImage[] = [];
    let idx = 0;

    for (const f of files) {
      const fp = path.join(outDir, f);
      const bytes = fs.readFileSync(fp);
      const lower = f.toLowerCase();
      const mimeType =
        lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? ("image/jpeg" as const)
          : ("image/png" as const);

      images.push({ index: idx++, page: null, mimeType, bytes });
    }

    return { images };
  } catch {
    return { images: [] };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpPdf, { force: true }); } catch {}
  }
}`,
    "extractPdfImages restore"
  );

  // Also fix any lingering cp.execSync usage elsewhere in pdf.ts
  const after = read(pdfTs);
  if (after.includes("cp.execSync")) {
    backup(pdfTs);
    write(pdfTs, after.replace(/cp\.execSync/g, "execSync"));
    console.log("✅ Replaced cp.execSync -> execSync in pdf.ts");
  }
}

function main() {
  upsertDocumentAiDependency();
  writeDocumentAiModule();
  writeTypeShim();
  patchPdfImagesToExpectedSignature();

  console.log("\n✅ Patch v3 complete.");
  console.log("\nRun these commands:");
  console.log("  npm --prefix server install");
  console.log("  npm --prefix server run build");
}

main();