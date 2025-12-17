import { cases, documents, violations, criminalRecords } from "../shared/schema.js";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
export class DatabaseStorage {
    async createCase(data) {
        const [caseRecord] = await db.insert(cases).values(data).returning();
        return caseRecord;
    }
    async getCase(id) {
        const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id));
        return caseRecord || undefined;
    }
    async getCaseWithDetails(id) {
        const [caseRecord] = await db.select().from(cases).where(eq(cases.id, id));
        if (!caseRecord)
            return undefined;
        const [caseDocuments, caseViolations, caseRecords] = await Promise.all([
            db.select().from(documents).where(eq(documents.caseId, id)),
            db.select().from(violations).where(eq(violations.caseId, id)),
            db.select().from(criminalRecords).where(eq(criminalRecords.caseId, id)),
        ]);
        return {
            ...caseRecord,
            documents: caseDocuments,
            violations: caseViolations,
            criminalRecords: caseRecords,
        };
    }
    async getAllCases() {
        return db.select().from(cases).orderBy(desc(cases.uploadDate));
    }
    async updateCaseStatus(id, status) {
        await db.update(cases).set({ status }).where(eq(cases.id, id));
    }
    async updateCaseSummary(id, summary, criminalHistorySummary) {
        await db.update(cases)
            .set({ summary, criminalHistorySummary })
            .where(eq(cases.id, id));
    }
    async createDocument(data) {
        const [doc] = await db.insert(documents).values(data).returning();
        return doc;
    }
    async getDocumentsByCase(caseId) {
        return db.select().from(documents).where(eq(documents.caseId, caseId));
    }
    async createViolation(data) {
        const [violation] = await db.insert(violations).values(data).returning();
        return violation;
    }
    async createViolations(data) {
        if (data.length === 0)
            return [];
        return db.insert(violations).values(data).returning();
    }
    async getViolationsByCase(caseId) {
        return db.select().from(violations).where(eq(violations.caseId, caseId));
    }
    async createCriminalRecord(data) {
        const [record] = await db.insert(criminalRecords).values(data).returning();
        return record;
    }
    async createCriminalRecords(data) {
        if (data.length === 0)
            return [];
        return db.insert(criminalRecords).values(data).returning();
    }
    async getCriminalRecordsByCase(caseId) {
        return db.select().from(criminalRecords).where(eq(criminalRecords.caseId, caseId));
    }
}
export const storage = new DatabaseStorage();
