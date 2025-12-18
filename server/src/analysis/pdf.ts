import { PDFParse } from 'pdf-parse';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export type PdfTextResult = { text: string; pageCount: number | null };

export async function extractPdfText(pdfBytes: Buffer): Promise<PdfTextResult> {
  try {
    const pdfParse = new PDFParse({ data: new Uint8Array(pdfBytes) });
    const result = await pdfParse.getText();
    await pdfParse.destroy();
    return { 
      text: result.text ?? '', 
      pageCount: result.pages?.length || null 
    };
  } catch (err) {
    console.error('PDF text extraction failed:', err);
    return { text: '', pageCount: null };
  }
}

export type ExtractedImage = {
  index: number;
  page: number | null;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Buffer;
};

export type PdfImagesResult = { images: ExtractedImage[] };

export async function extractPdfImages(pdfBytes: Buffer): Promise<PdfImagesResult> {
  // Best-effort embedded image extraction using Poppler's pdfimages.
  // If pdfimages is unavailable, returns { images: [] } without crashing.
  const tmpRoot = path.join(process.cwd(), "uploads", "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });

  const tmpPdf = path.join(tmpRoot, `imgsrc-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  const outDir = path.join(tmpRoot, `imgs-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    fs.writeFileSync(tmpPdf, pdfBytes);
    execSync(`pdfimages -all "${tmpPdf}" "${path.join(outDir, "img")}"`, { stdio: "ignore" });

    const files = fs.readdirSync(outDir).filter(f => /\.(png|jpe?g|ppm|pbm|pgm)$/i.test(f));
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
}

// Convert PDF bytes to PNG images of each page using pdf2pic alternative
// Since we can't easily render PDF pages without complex dependencies,
// we'll create a simple representation for Gemini to analyze
export async function convertPdfToImages(pdfBytes: Buffer, maxPages: number = 10): Promise<ExtractedImage[]> {
  // For scanned PDFs, we need to send the raw PDF data to Gemini
  // Gemini can process PDF documents directly via inline data
  // Create a single "image" entry that represents the entire PDF
  const result = await extractPdfText(pdfBytes);
  const pageCount = result.pageCount || 1;
  
  // Return empty if we got readable text (no OCR needed)
  const readableChars = result.text.replace(/[^a-zA-Z0-9\s.,!?;:'"()-]/g, '').length;
  const isReadable = result.text.length > 100 && (readableChars / result.text.length) > 0.5;
  
  if (isReadable) {
    return [];
  }
  
  // For scanned PDFs, we'll process the PDF directly with Gemini
  // Return a marker that tells the caller to use PDF-based OCR
  return [{
    index: 0,
    page: null, // null indicates entire document
    mimeType: 'image/png' as const, // Will be overridden with application/pdf
    bytes: pdfBytes, // Pass the raw PDF bytes
  }];
}

// Check if extracted text appears to be from a scanned document
export function isScannedDocument(text: string): boolean {
  if (!text || text.trim().length < 120) return true;

  // Common broken font extraction marker
  if (/\(cid:\d+\)/i.test(text)) return true;

  // Strip control chars for evaluation
  const cleaned = text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .trim();

  if (cleaned.length < 120) return true;

  // Long runs of punctuation/symbols (matches your output)
  if (/[!"#$%&'()*+,\-./0-9:;<=>?@$begin:math:display$\$end:math:display$\\^_\`{|}~]{18,}/.test(cleaned)) return true;

  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const spaces = (cleaned.match(/\s/g) || []).length;
  const symbols = Math.max(0, cleaned.length - letters - spaces);

  const letterRatio = letters / cleaned.length;
  const symbolRatio = symbols / cleaned.length;

  if (symbolRatio > 0.33 && letterRatio < 0.22) return true;

  return false;
}
