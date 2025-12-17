import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, real, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
export const cases = pgTable("cases", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    caseNumber: text("case_number").notNull(),
    defendantName: text("defendant_name").notNull(),
    defendantDOB: text("defendant_dob"),
    uploadDate: timestamp("upload_date").notNull().defaultNow(),
    status: text("status", { enum: ["processing", "completed", "flagged"] }).notNull().default("processing"),
    summary: text("summary"),
    criminalHistorySummary: text("criminal_history_summary"),
});
export const documents = pgTable("documents", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    uploadPath: text("upload_path"),
    extractedText: text("extracted_text"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const violations = pgTable("violations", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    source: text("source", { enum: ["Utah State Code", "West Valley City Code"] }).notNull(),
    description: text("description").notNull(),
    criteria: jsonb("criteria").$type().notNull(),
    isViolated: boolean("is_violated").notNull(),
    confidence: real("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    evidence: text("evidence").notNull(),
});
export const criminalRecords = pgTable("criminal_records", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    offense: text("offense").notNull(),
    disposition: text("disposition").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
});
export const casesRelations = relations(cases, ({ many }) => ({
    documents: many(documents),
    violations: many(violations),
    criminalRecords: many(criminalRecords),
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
