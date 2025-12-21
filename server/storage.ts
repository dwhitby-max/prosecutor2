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
  type User,
  type UpsertUser,
  type Company,
  type InsertCompany,
  cases,
  documents,
  violations,
  criminalRecords,
  caseImages,
  users,
  companies
} from "../shared/schema.js";
import { db } from "./db";
import { eq, desc, asc, inArray, sql, gte, lte, and, count, avg } from "drizzle-orm";

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
  updateCaseSummary(id: string, summary: string, criminalHistorySummary?: string, rawOfficerActions?: string): Promise<void>;
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
      const dataWithProcessingStart = {
        ...data,
        processingStartedAt: new Date(),
      };
      const [caseRecord] = await db.insert(cases).values(dataWithProcessingStart).returning();
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
    
    if (status === 'completed') {
      const [caseRecord] = await db.select({ processingStartedAt: cases.processingStartedAt }).from(cases).where(eq(cases.id, id));
      const processingCompletedAt = new Date();
      let processingTimeMs: number | null = null;
      
      if (caseRecord?.processingStartedAt) {
        processingTimeMs = processingCompletedAt.getTime() - new Date(caseRecord.processingStartedAt).getTime();
      }
      
      await db.update(cases).set({ 
        status, 
        processingCompletedAt,
        processingTimeMs 
      }).where(eq(cases.id, id));
      
      logQuery('UPDATE', 'cases', start, { id, status, processingTimeMs });
    } else {
      await db.update(cases).set({ status }).where(eq(cases.id, id));
      logQuery('UPDATE', 'cases', start, { id, status });
    }
  }

  async updateCaseSummary(id: string, summary: string, criminalHistorySummary?: string, rawOfficerActions?: string): Promise<void> {
    const start = Date.now();
    const updates: Record<string, string | undefined> = { summary, criminalHistorySummary };
    if (rawOfficerActions !== undefined) {
      updates.rawOfficerActions = rawOfficerActions;
    }
    await db.update(cases)
      .set(updates)
      .where(eq(cases.id, id));
    logQuery('UPDATE', 'cases', start, { id, summaryLength: summary?.length, hasRawActions: !!rawOfficerActions });
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

  // Admin methods
  async getAllUsers(): Promise<User[]> {
    const start = Date.now();
    const result = await db.select().from(users).orderBy(desc(users.createdAt));
    logQuery('SELECT', 'users', start, { count: result.length });
    return result;
  }

  async upsertUser(data: UpsertUser): Promise<User> {
    const start = Date.now();
    const [user] = await db
      .insert(users)
      .values(data)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      })
      .returning();
    logQuery('UPSERT', 'users', start, { id: data.id, email: data.email });
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const start = Date.now();
    const [user] = await db.select().from(users).where(eq(users.id, id));
    logQuery('SELECT', 'users', start, { id, found: !!user });
    return user;
  }

  async getUsersByCompany(companyId: string): Promise<User[]> {
    const start = Date.now();
    const result = await db.select().from(users).where(eq(users.companyId, companyId));
    logQuery('SELECT', 'users', start, { companyId, count: result.length });
    return result;
  }

  async updateUserRole(id: string, role: 'user' | 'services' | 'company' | 'admin'): Promise<void> {
    const start = Date.now();
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
    logQuery('UPDATE', 'users', start, { id, role });
  }

  async updateUserCompany(id: string, companyId: string | null): Promise<void> {
    const start = Date.now();
    await db.update(users).set({ companyId, updatedAt: new Date() }).where(eq(users.id, id));
    logQuery('UPDATE', 'users', start, { id, companyId });
  }

  async updateUserStatus(id: string, status: 'active' | 'pending' | 'inactive'): Promise<void> {
    const start = Date.now();
    await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, id));
    logQuery('UPDATE', 'users', start, { id, status });
  }

  // Company methods
  async createCompany(data: InsertCompany): Promise<Company> {
    const start = Date.now();
    const [company] = await db.insert(companies).values(data).returning();
    logQuery('INSERT', 'companies', start, { name: data.name });
    return company;
  }

  async getAllCompanies(): Promise<Company[]> {
    const start = Date.now();
    const result = await db.select().from(companies).orderBy(desc(companies.createdAt));
    logQuery('SELECT', 'companies', start, { count: result.length });
    return result;
  }

  async getCompanyById(id: string): Promise<Company | undefined> {
    const start = Date.now();
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    logQuery('SELECT', 'companies', start, { id, found: !!company });
    return company;
  }

  // Case assignment methods
  async assignCaseToUser(caseId: string, userId: string): Promise<void> {
    const start = Date.now();
    await db.update(cases).set({ assignedToUserId: userId }).where(eq(cases.id, caseId));
    logQuery('UPDATE', 'cases', start, { caseId, assignedToUserId: userId });
  }

  async getCasesByAssignedUser(userId: string): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases).where(eq(cases.assignedToUserId, userId)).orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { assignedToUserId: userId, count: result.length });
    return result;
  }

  async getCasesByCompany(companyId: string): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases).where(eq(cases.companyId, companyId)).orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { companyId, count: result.length });
    return result;
  }

  async getAdminStats(): Promise<{
    totalCases: number;
    totalUsers: number;
    avgProcessingTimeMs: number | null;
    casesProcessedToday: number;
    casesProcessedThisWeek: number;
    casesProcessedThisMonth: number;
  }> {
    const start = Date.now();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalCasesResult] = await db.select({ count: count() }).from(cases);
    const [totalUsersResult] = await db.select({ count: count() }).from(users);
    
    const [avgTimeResult] = await db.select({ 
      avgTime: avg(cases.processingTimeMs) 
    }).from(cases).where(sql`${cases.processingTimeMs} IS NOT NULL`);
    
    const [todayResult] = await db.select({ count: count() }).from(cases)
      .where(gte(cases.uploadDate, todayStart));
    
    const [weekResult] = await db.select({ count: count() }).from(cases)
      .where(gte(cases.uploadDate, weekStart));
    
    const [monthResult] = await db.select({ count: count() }).from(cases)
      .where(gte(cases.uploadDate, monthStart));

    logQuery('SELECT', 'admin_stats', start, {});
    
    return {
      totalCases: totalCasesResult?.count || 0,
      totalUsers: totalUsersResult?.count || 0,
      avgProcessingTimeMs: avgTimeResult?.avgTime ? Number(avgTimeResult.avgTime) : null,
      casesProcessedToday: todayResult?.count || 0,
      casesProcessedThisWeek: weekResult?.count || 0,
      casesProcessedThisMonth: monthResult?.count || 0,
    };
  }

  async getCasesByDateRange(startDate: Date, endDate: Date): Promise<Case[]> {
    const start = Date.now();
    const result = await db.select().from(cases)
      .where(and(
        gte(cases.uploadDate, startDate),
        lte(cases.uploadDate, endDate)
      ))
      .orderBy(desc(cases.uploadDate));
    logQuery('SELECT', 'cases', start, { startDate: startDate.toISOString(), endDate: endDate.toISOString(), count: result.length });
    return result;
  }

  async getProcessingTimeReport(startDate?: Date, endDate?: Date): Promise<{
    averageTimeMs: number | null;
    minTimeMs: number | null;
    maxTimeMs: number | null;
    totalCases: number;
    casesByDay: Array<{ date: string; count: number; avgTimeMs: number | null }>;
  }> {
    const start = Date.now();
    
    let query = db.select({
      avgTime: avg(cases.processingTimeMs),
      minTime: sql<number>`MIN(${cases.processingTimeMs})`,
      maxTime: sql<number>`MAX(${cases.processingTimeMs})`,
      totalCount: count(),
    }).from(cases).where(sql`${cases.processingTimeMs} IS NOT NULL`);

    if (startDate && endDate) {
      query = db.select({
        avgTime: avg(cases.processingTimeMs),
        minTime: sql<number>`MIN(${cases.processingTimeMs})`,
        maxTime: sql<number>`MAX(${cases.processingTimeMs})`,
        totalCount: count(),
      }).from(cases).where(and(
        sql`${cases.processingTimeMs} IS NOT NULL`,
        gte(cases.uploadDate, startDate),
        lte(cases.uploadDate, endDate)
      ));
    }

    const [stats] = await query;

    const casesByDayQuery = await db.select({
      date: sql<string>`DATE(${cases.uploadDate})`,
      count: count(),
      avgTimeMs: avg(cases.processingTimeMs),
    }).from(cases)
      .where(startDate && endDate 
        ? and(gte(cases.uploadDate, startDate), lte(cases.uploadDate, endDate))
        : sql`1=1`
      )
      .groupBy(sql`DATE(${cases.uploadDate})`)
      .orderBy(sql`DATE(${cases.uploadDate})`);

    logQuery('SELECT', 'processing_time_report', start, {});

    return {
      averageTimeMs: stats?.avgTime ? Number(stats.avgTime) : null,
      minTimeMs: stats?.minTime || null,
      maxTimeMs: stats?.maxTime || null,
      totalCases: stats?.totalCount || 0,
      casesByDay: casesByDayQuery.map(row => ({
        date: String(row.date),
        count: row.count,
        avgTimeMs: row.avgTimeMs ? Number(row.avgTimeMs) : null,
      })),
    };
  }
}

export const storage = new DatabaseStorage();
