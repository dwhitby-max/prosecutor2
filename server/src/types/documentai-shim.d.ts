declare module "@google-cloud/documentai" {
  export class DocumentProcessorServiceClient {
    constructor(opts?: any);
    processorPath(projectId: string, location: string, processorId: string): string;
    processDocument(req: any): Promise<any>;
  }
}
