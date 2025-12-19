import { 
  type Case, 
  type InsertCase, 
  type Document, 
  type InsertDocument,
  type Violation,
  type InsertViolation,
  type CriminalRecord,
  type InsertCriminalRecord,
  type CaseImage,
  type InsertCaseImage,
  type CaseWithDetails,
  cases,
  documents,
  violations,
  criminalRecords,
  caseImages
} from "../shared/schema.js";
import { db } from "./db";
import { eq, desc, asc, inArray } from "drizzle-orm";

function logQuery(operation: string, table: string, startTime: number, details?: Record<string, unknown>): void {
  const duration = Date.now() - startTime;
  const logLevel = duration > 2000 ? 'WARN' : 'INFO';
  console.log(`[${logLevel}] DB ${operation} on ${table} completed in ${duration}ms`, details ? JSON.stringify(details) : '');
}

export interface IStorage {
  // Cases
  createCase(data: InsertCase): Promise<Case>;
  getCase(id: string): Promise<Case | undefined>;
  getCaseWithDetails(id: string): Promise<CaseWithDetails | undefined>;
  getAllCases(): Promise<Case[]>;
  getActiveCases(): Promise<Case[]>;
  getCompletedCases(): Promise<Case[]>;
  updateCaseStatus(id: string, status: "processing" | "completed" | "flagged"): Promise<void>;
  updateCaseSummary(id: string, summary: string, criminalHistorySummary?: string): Promise<void>;
  updateCaseIdentity(id: string, defendantName: string | null, caseNumber: string | null): Promise<void>;
  updateCaseBookedIntoJail(id: string, bookedIntoJail: boolean | null): Promise<void>;
  updateCaseLegalAnalysis(id: string, caseSummaryNarrative: string, legalAnalysis: string): Promise<void>;
  markCaseComplete(id: string, isComplete: boolean): Promise<void>;
  deleteCases(ids: string[]): Promise<void>;
  
  // Documents
  createDocument(data: InsertDocument): Promise<Document>;
  getDocumentsByCase(caseId: string): Promise<Document[]>;
  
  // Violations
  createViolation(data: InsertViolation): Promise<Violation>;
  createViolations(data: InsertViolation[]): Promise<Violation[]>;
  getViolationsByCase(caseId: string): Promise<Violation[]>;
  deleteViolationsForCase(caseId: string): Promise<void>;
  
  // Criminal Records
  createCriminalRecord(data: InsertCriminalRecord): Promise<CriminalRecord>;
  createCriminalRecords(data: InsertCriminalRecord[]): Promise<CriminalRecord[]>;
  getCriminalRecordsByCase(caseId: string): Promise<CriminalRecord[]>;
  
  // Case Images
  createCaseImage(data: InsertCaseImage): Promise<CaseImage>;
  createCaseImages(data: InsertCaseImage[]): Promise<CaseImage[]>;
  getImagesByCase(caseId: string): Promise<CaseImage[]>;
}

export class DatabaseStorage implements IStorage {
  async createCase(data: InsertCase): Promise<Case> {
    const start = Date.now();
    try {
      console.log('[createCase] Inserting with data:', JSON.stringify(data));
      const [caseRecord] = await db.insert(cases).values(data).returning();
      logQuery('INSERT', 'cases', start, { caseNumber: data.caseNumber });
      return caseRecord;
    } catch (error) {
      console.error('[createCase] Insert failed:', error);
      console.error('[createCase] Data was:', JSON.stringify(data));
      throw error;
    }
  }

  async getCase(id: string): Promise<Case | undefined> {
    const start = Date.now();
    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id));
    logQuery('SELECT', 'cases', start, { id });
    return caseRecord || undefined;
  }

  async getCaseWithDetails(id: string): Promise<CaseWithDetails | undefined> {
    const start = Date.now();
    const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id));
    if (!caseRecord) {
      logQuery('SELECT', 'cases', start, { id, found: false });
      return undefined;
    }

    const [caseDocuments, caseViolations, caseRecords, caseImagesResult] = await Promise.all([
      db.select().from(documents).where(eq(documents.caseId, id)),
      db.select().from(violations).where(eq(violations.caseId, id)),
      db.select().from(criminalRecords).where(eq(criminalRecords.caseId, id)),
      db.select().from(caseImages).where(eq(caseImages.caseId, id)),
    ]);
    logQuery('SELECT', 'cases+related', start, { id, documents: caseDocuments.length, violations: caseViolations.length, records: caseRecords.length, images: caseImagesResult.length });

    return {
      ...caseRecord,
      documents: caseDocuments,
      violations: caseViolations,
      criminalRecords: caseRecords,
      images: caseImagesResult,
    };
  }

  async getAllCases(): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases).orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { count: result.length });
    return result;
  }

  async getActiveCases(): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases).where(eq(cases.isMarkedComplete, false)).orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { filter: 'active', count: result.length });
    return result;
  }

  async getCompletedCases(): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases).where(eq(cases.isMarkedComplete, true)).orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { filter: 'completed', count: result.length });
    return result;
  }

  async markCaseComplete(id: string, isComplete: boolean): Promise<void> {
    const start = Date.now();
    await db.update(cases).set({ isMarkedComplete: isComplete }).where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, isComplete });
  }

  async updateCaseStatus(id: string, status: "processing" | "completed" | "flagged"): Promise<void> {
    const start = Date.now();
    await db.update(cases).set({ status }).where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, status });
  }

  async updateCaseSummary(id: string, summary: string, criminalHistorySummary?: string): Promise<void> {
    const start = Date.now();
    await db.update(cases)
      .set({ summary, criminalHistorySummary })
      .where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, summaryLength: summary?.length });
  }

  async updateCaseIdentity(id: string, defendantName: string | null, caseNumber: string | null): Promise<void> {
    const start = Date.now();
    const updates: Record<string, string | null> = {};
    if (defendantName && defendantName.length > 2) updates.defendantName = defendantName;
    if (caseNumber && caseNumber.length > 2) updates.caseNumber = caseNumber;
    if (Object.keys(updates).length > 0) {
      await db.update(cases).set(updates).where(eq(cases.id, id));
      logQuery('UPDATE', 'cases', start, { id, fields: Object.keys(updates) });
    }
  }

  async updateCaseBookedIntoJail(id: string, bookedIntoJail: boolean | null): Promise<void> {
    const start = Date.now();
    await db.update(cases).set({ bookedIntoJail }).where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, bookedIntoJail });
  }

  async updateCaseLegalAnalysis(id: string, caseSummaryNarrative: string, legalAnalysis: string): Promise<void> {
    const start = Date.now();
    await db.update(cases).set({ caseSummaryNarrative, legalAnalysis }).where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, summaryNarrativeLength: caseSummaryNarrative?.length, legalAnalysisLength: legalAnalysis?.length });
  }

  async deleteCases(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const start = Date.now();
    await db.delete(cases).where(inArray(cases.id, ids));
    logQuery('DELETE', 'cases', start, { count: ids.length });
  }

  async createDocument(data: InsertDocument): Promise<Document> {
    const start = Date.now();
    const [doc] = await db.insert(documents).values(data).returning();
    logQuery('INSERT', 'documents', start, { caseId: data.caseId, filename: data.filename });
    return doc;
  }

  async getDocumentsByCase(caseId: string): Promise<Document[]> {
    const start = Date.now();
    const result = await db.select().from(documents).where(eq(documents.caseId, caseId));
    logQuery('SELECT', 'documents', start, { caseId, count: result.length });
    return result;
  }

  async createViolation(data: InsertViolation): Promise<Violation> {
    const start = Date.now();
    const [violation] = await db.insert(violations).values(data).returning();
    logQuery('INSERT', 'violations', start, { caseId: data.caseId, code: data.code });
    return violation;
  }

  async createViolations(data: InsertViolation[]): Promise<Violation[]> {
    if (data.length === 0) return [];
    const start = Date.now();
    const result = await db.insert(violations).values(data).returning();
    logQuery('INSERT', 'violations', start, { count: data.length, caseId: data[0]?.caseId });
    return result;
  }

  async getViolationsByCase(caseId: string): Promise<Violation[]> {
    const start = Date.now();
    const result = await db.select().from(violations).where(eq(violations.caseId, caseId));
    logQuery('SELECT', 'violations', start, { caseId, count: result.length });
    return result;
  }

  async deleteViolationsForCase(caseId: string): Promise<void> {
    const start = Date.now();
    await db.delete(violations).where(eq(violations.caseId, caseId));
    logQuery('DELETE', 'violations', start, { caseId });
  }

  async createCriminalRecord(data: InsertCriminalRecord): Promise<CriminalRecord> {
    const start = Date.now();
    const [record] = await db.insert(criminalRecords).values(data).returning();
    logQuery('INSERT', 'criminalRecords', start, { caseId: data.caseId });
    return record;
  }

  async createCriminalRecords(data: InsertCriminalRecord[]): Promise<CriminalRecord[]> {
    if (data.length === 0) return [];
    const start = Date.now();
    const result = await db.insert(criminalRecords).values(data).returning();
    logQuery('INSERT', 'criminalRecords', start, { count: data.length, caseId: data[0]?.caseId });
    return result;
  }

  async getCriminalRecordsByCase(caseId: string): Promise<CriminalRecord[]> {
    const start = Date.now();
    const result = await db.select().from(criminalRecords).where(eq(criminalRecords.caseId, caseId));
    logQuery('SELECT', 'criminalRecords', start, { caseId, count: result.length });
    return result;
  }

  async createCaseImage(data: InsertCaseImage): Promise<CaseImage> {
    const start = Date.now();
    const [image] = await db.insert(caseImages).values(data).returning();
    logQuery('INSERT', 'caseImages', start, { caseId: data.caseId, filename: data.filename });
    return image;
  }

  async createCaseImages(data: InsertCaseImage[]): Promise<CaseImage[]> {
    if (data.length === 0) return [];
    const start = Date.now();
    const result = await db.insert(caseImages).values(data).returning();
    logQuery('INSERT', 'caseImages', start, { count: data.length, caseId: data[0]?.caseId });
    return result;
  }

  async getImagesByCase(caseId: string): Promise<CaseImage[]> {
    const start = Date.now();
    const result = await db.select().from(caseImages).where(eq(caseImages.caseId, caseId));
    logQuery('SELECT', 'caseImages', start, { caseId, count: result.length });
    return result;
  }
}

export const storage = new DatabaseStorage();
