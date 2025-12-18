import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(`Missing env: ${k}`);
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
