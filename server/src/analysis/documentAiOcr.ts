import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { PDFDocument } from "pdf-lib";

const MAX_PAGES_PER_REQUEST = 30;

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(`Missing env: ${k}`);
  return v.trim();
}

async function getPageCount(pdfBytes: Buffer): Promise<number> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    return pdfDoc.getPageCount();
  } catch {
    return 1;
  }
}

async function splitPdf(pdfBytes: Buffer, startPage: number, endPage: number): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  
  const pageIndices = [];
  for (let i = startPage; i <= endPage && i < srcDoc.getPageCount(); i++) {
    pageIndices.push(i);
  }
  
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }
  
  const newPdfBytes = await newDoc.save();
  return Buffer.from(newPdfBytes);
}

async function processChunk(client: DocumentProcessorServiceClient, processorName: string, pdfBytes: Buffer): Promise<string> {
  const [res] = await client.processDocument({
    name: processorName,
    rawDocument: { content: pdfBytes, mimeType: "application/pdf" }
  });
  return (res.document?.text || "").trim();
}

export async function ocrPdfWithDocumentAI(pdfBytes: Buffer): Promise<string> {
  const credentials = JSON.parse(mustEnv("DOCUMENT_AI_SERVICE_ACCOUNT_JSON"));
  const client = new DocumentProcessorServiceClient({ credentials });

  const projectId = mustEnv("DOCUMENT_AI_PROJECT_ID");
  const location = mustEnv("DOCUMENT_AI_LOCATION");
  const processorId = mustEnv("DOCUMENT_AI_PROCESSOR_ID");
  const processorName = client.processorPath(projectId, location, processorId);

  const pageCount = await getPageCount(pdfBytes);
  console.log(`[Document AI] Processing PDF with ${pageCount} pages`);

  if (pageCount <= MAX_PAGES_PER_REQUEST) {
    return await processChunk(client, processorName, pdfBytes);
  }

  console.log(`[Document AI] PDF exceeds ${MAX_PAGES_PER_REQUEST} pages, splitting into chunks...`);
  const allText: string[] = [];
  
  for (let startPage = 0; startPage < pageCount; startPage += MAX_PAGES_PER_REQUEST) {
    const endPage = Math.min(startPage + MAX_PAGES_PER_REQUEST - 1, pageCount - 1);
    const chunkNum = Math.floor(startPage / MAX_PAGES_PER_REQUEST) + 1;
    const totalChunks = Math.ceil(pageCount / MAX_PAGES_PER_REQUEST);
    
    console.log(`[Document AI] Processing chunk ${chunkNum}/${totalChunks} (pages ${startPage + 1}-${endPage + 1})`);
    
    const chunkPdf = await splitPdf(pdfBytes, startPage, endPage);
    const chunkText = await processChunk(client, processorName, chunkPdf);
    
    if (chunkText) {
      allText.push(chunkText);
    }
  }

  console.log(`[Document AI] Completed processing all ${Math.ceil(pageCount / MAX_PAGES_PER_REQUEST)} chunks`);
  return allText.join("\n\n--- Page Break ---\n\n");
}
