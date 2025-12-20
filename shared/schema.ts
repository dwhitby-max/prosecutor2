import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, real, boolean, integer, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cases = pgTable("cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseNumber: text("case_number").notNull(),
  defendantName: text("defendant_name").notNull(),
  defendantDOB: text("defendant_dob"),
  uploadDate: timestamp("upload_date").notNull().defaultNow(),
  status: text("status", { enum: ["processing", "completed", "flagged"] }).notNull().default("processing"),
  summary: text("summary"),
  rawOfficerActions: text("raw_officer_actions"),
  criminalHistorySummary: text("criminal_history_summary"),
  isMarkedComplete: boolean("is_marked_complete").notNull().default(false),
  bookedIntoJail: boolean("booked_into_jail"),
  caseSummaryNarrative: text("case_summary_narrative"),
  legalAnalysis: text("legal_analysis"),
});

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  uploadPath: text("upload_path"),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const violations = pgTable("violations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  chargeName: text("charge_name"),
  chargeClass: text("charge_class"),
  chargeType: text("charge_type", { enum: ["current", "historical"] }).default("current"),
  source: text("source", { enum: ["Utah State Code", "West Valley City Code"] }).notNull(),
  description: text("description").notNull(),
  statuteText: text("statute_text"),
  statuteUrl: text("statute_url"),
  criteria: jsonb("criteria").$type<string[]>().notNull(),
  isViolated: boolean("is_violated").notNull(),
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  evidence: text("evidence").notNull(),
});

export const criminalRecords = pgTable("criminal_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  offense: text("offense").notNull(),
  disposition: text("disposition").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
});

export const statuteCache = pgTable("statute_cache", {
  id: serial("id").primaryKey(),
  citation: text("citation").notNull().unique(),
  source: text("source").notNull(),
  title: text("title"),
  text: text("text").notNull(),
  url: text("url").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

export const caseImages = pgTable("case_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  imageData: text("image_data").notNull(),
  pageNumber: integer("page_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const casesRelations = relations(cases, ({ many }) => ({
  documents: many(documents),
  violations: many(violations),
  criminalRecords: many(criminalRecords),
  images: many(caseImages),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  case: one(cases, {
    fields: [documents.caseId],
    references: [cases.id],
  }),
}));

export const violationsRelations = relations(violations, ({ one }) => ({
  case: one(cases, {
    fields: [violations.caseId],
    references: [cases.id],
  }),
}));

export const criminalRecordsRelations = relations(criminalRecords, ({ one }) => ({
  case: one(cases, {
    fields: [criminalRecords.caseId],
    references: [cases.id],
  }),
}));

export const caseImagesRelations = relations(caseImages, ({ one }) => ({
  case: one(cases, {
    fields: [caseImages.caseId],
    references: [cases.id],
  }),
  document: one(documents, {
    fields: [caseImages.documentId],
    references: [documents.id],
  }),
}));

export const insertCaseSchema = createInsertSchema(cases).omit({
  id: true,
  uploadDate: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertViolationSchema = createInsertSchema(violations).omit({
  id: true,
});

export const insertCriminalRecordSchema = createInsertSchema(criminalRecords).omit({
  id: true,
});

export const insertCaseImageSchema = createInsertSchema(caseImages).omit({
  id: true,
  createdAt: true,
});

export type Case = typeof cases.$inferSelect;
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Violation = typeof violations.$inferSelect;
export type InsertViolation = z.infer<typeof insertViolationSchema>;
export type CriminalRecord = typeof criminalRecords.$inferSelect;
export type InsertCriminalRecord = z.infer<typeof insertCriminalRecordSchema>;
export type CaseImage = typeof caseImages.$inferSelect;
export type InsertCaseImage = z.infer<typeof insertCaseImageSchema>;

export type CaseWithDetails = Case & {
  documents: Document[];
  violations: Violation[];
  criminalRecords: CriminalRecord[];
  images: CaseImage[];
};

export type StatuteCacheEntry = typeof statuteCache.$inferSelect;

// API Response Types for type-safe API responses
export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  data?: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
}

// Specific API response types
export type CasesListResponse = ApiResponse<{ cases: Case[] }>;
export type CaseDetailResponse = ApiResponse<{ case: CaseWithDetails }>;
export type UploadResponse = ApiResponse<{ caseIds: string[] }>;

// Analysis result types for PDF processing (replacing any types)
export interface AnalysisCitation {
  raw: string;
  normalizedKey: string;
  jurisdiction: 'UT' | 'WVC' | 'UNKNOWN';
}

export interface AnalysisElementResult {
  element: string;
  evidenceSnippets: string[];
  status: 'met' | 'not_met' | 'unclear';
}

export interface AnalysisElement {
  code: string;
  jurisdiction: 'UT' | 'WVC' | 'UNKNOWN';
  result: {
    overall: 'met' | 'not_met' | 'partial';
    elements: AnalysisElementResult[];
    notes: string[];
  };
}

export interface AnalysisStatute {
  code: string;
  title: string | null;
  text: string;
  url: string | null;
}

export interface DocumentSummary {
  pageCount: number;
  textLength: number;
  filename: string;
}

export interface ViolationToCreate {
  caseId: string;
  code: string;
  chargeName: string | null;
  chargeClass: string | null;
  chargeType: 'current' | 'historical';
  source: 'Utah State Code' | 'West Valley City Code';
  description: string;
  statuteText: string | null;
  statuteUrl: string | null;
  criteria: string[];
  isViolated: boolean;
  confidence: number;
  reasoning: string;
  evidence: string;
}

export interface PriorsCharge {
  dateOfArrest: string | null;
  chargeText: string;
  offenseTrackingNumber: string | null;
}

export interface PriorsIncident {
  incidentLabel: string;
  charges: PriorsCharge[];
}

export interface PriorsSummary {
  incidents: PriorsIncident[];
  chargeCount: number;
}

export interface ExtractedImage {
  mimeType: string;
  imageData: string;
  pageNumber: number | null;
}

export interface AnalysisDocumentSummary {
  pageCount: number | null;
  textLength: number;
  imageCount: number;
  ocrUsed: boolean;
}

export interface AnalysisResult {
  documents: AnalysisDocumentSummary[];
  citations: AnalysisCitation[];
  narrative: string;
  fullText: string;
  statutes: AnalysisStatute[];
  elements: AnalysisElement[];
  priors: PriorsSummary | null;
  extractedImages: ExtractedImage[];
}
