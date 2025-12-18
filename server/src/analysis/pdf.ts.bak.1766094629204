import { PDFParse } from 'pdf-parse';
import { PNG } from 'pngjs';

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

export async function extractPdfImages(_pdfBytes: Buffer): Promise<PdfImagesResult> {
  // Image extraction disabled - pdfjs-dist requires Node.js 22+ for Promise.withResolvers
  // Text extraction via pdf-parse is sufficient for analysis
  return { images: [] };
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
  if (!text || text.length < 100) return true;
  
  // Check for null bytes and control characters (definite sign of binary garbage)
  const hasNullBytes = text.includes('\x00') || text.includes('\u0000');
  if (hasNullBytes) return true;
  
  // Count control characters
  const controlChars = (text.match(/[\x00-\x1F]/g) || []).length;
  if (controlChars > text.length * 0.05) return true; // More than 5% control chars
  
  // Check ratio of readable characters (letters, numbers, common punctuation)
  const readableChars = text.replace(/[^a-zA-Z0-9\s.,!?;:'"()\-\/]/g, '').length;
  const ratio = readableChars / text.length;
  
  // If less than 40% readable, likely scanned/garbled
  return ratio < 0.4;
}
