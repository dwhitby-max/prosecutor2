import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { extractPdfText } from "./src/analysis/pdf.js";
import { runAnalysis } from "./src/analysis/evaluate.js";
const upload = multer({ dest: path.join(process.cwd(), 'uploads', 'tmp') });
function getUploadDir() {
    const dir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function parseIdentity(text) {
    const caseMatch = text.match(/Case\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
    const caseNumber = caseMatch && typeof caseMatch[1] === 'string' ? caseMatch[1].trim() : null;
    const nameMatch = text.match(/Defendant\s*[:\-]?\s*([A-Za-z\-']+)\s+([A-Za-z\-']+)/i);
    const defendantName = nameMatch && typeof nameMatch[1] === 'string' && typeof nameMatch[2] === 'string'
        ? `${nameMatch[1].trim()} ${nameMatch[2].trim()}`
        : null;
    return { caseNumber, defendantName };
}
export async function registerRoutes(httpServer, app) {
    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    app.use('/uploads', express.static(uploadsDir));
    // Get all cases
    app.get('/api/cases', async (req, res) => {
        try {
            const cases = await storage.getAllCases();
            res.json({ ok: true, cases });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            res.status(500).json({ ok: false, error: msg });
        }
    });
    // Get single case with full details
    app.get('/api/cases/:id', async (req, res) => {
        try {
            const caseId = req.params.id;
            const caseData = await storage.getCaseWithDetails(caseId);
            if (!caseData) {
                return res.status(404).json({ ok: false, error: 'Case not found' });
            }
            res.json({ ok: true, case: caseData });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            res.status(500).json({ ok: false, error: msg });
        }
    });
    // Upload and analyze PDFs
    app.post('/api/cases/upload', upload.array('pdfs', 10), async (req, res) => {
        try {
            const files = (req.files ?? []);
            if (files.length === 0) {
                return res.status(400).json({ ok: false, error: 'No PDFs uploaded.' });
            }
            const createdCaseIds = [];
            for (const f of files) {
                const pdfBytes = fs.readFileSync(f.path);
                const { text } = await extractPdfText(pdfBytes);
                const parsed = parseIdentity(text);
                // Create case first
                const newCase = await storage.createCase({
                    caseNumber: parsed.caseNumber || 'Unknown',
                    defendantName: parsed.defendantName || 'Unknown',
                    defendantDOB: null,
                    status: 'processing',
                    summary: null,
                    criminalHistorySummary: null,
                });
                createdCaseIds.push(newCase.id);
                // Save PDF to disk
                const caseDir = path.join(getUploadDir(), 'cases', newCase.id);
                fs.mkdirSync(caseDir, { recursive: true });
                const storedName = `${newCase.id}.pdf`;
                const storedPath = path.join(caseDir, storedName);
                fs.copyFileSync(f.path, storedPath);
                // Store document reference
                await storage.createDocument({
                    caseId: newCase.id,
                    filename: f.originalname,
                    uploadPath: `/uploads/cases/${newCase.id}/${storedName}`,
                    extractedText: text,
                });
                // Run analysis in background
                runAnalysis({ persist: true, pdfBuffers: [pdfBytes] })
                    .then(async (analysis) => {
                    // Update case with analysis results
                    if (analysis && typeof analysis === 'object') {
                        const analysisObj = analysis;
                        await storage.updateCaseSummary(newCase.id, analysisObj.summary || '', analysisObj.criminalHistorySummary);
                        if (analysisObj.violations && Array.isArray(analysisObj.violations)) {
                            await storage.createViolations(analysisObj.violations.map(v => ({
                                caseId: newCase.id,
                                ...v,
                            })));
                        }
                        if (analysisObj.criminalHistory && Array.isArray(analysisObj.criminalHistory)) {
                            await storage.createCriminalRecords(analysisObj.criminalHistory.map(r => ({
                                caseId: newCase.id,
                                ...r,
                            })));
                        }
                        await storage.updateCaseStatus(newCase.id, 'completed');
                    }
                })
                    .catch((err) => {
                    console.error('Analysis failed:', err);
                    storage.updateCaseStatus(newCase.id, 'flagged').catch(console.error);
                });
                // Clean up temp file
                fs.unlinkSync(f.path);
            }
            res.json({ ok: true, caseIds: createdCaseIds });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            res.status(500).json({ ok: false, error: msg });
        }
    });
    return httpServer;
}
