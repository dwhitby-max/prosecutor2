import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { id } from '../storage/ids.js';
import { getDb } from '../storage/db.js';
import { extractPdfImages, extractPdfText } from '../analysis/pdf.js';
import { runAnalysis } from '../analysis/evaluate.js';
export const router = express.Router();
const upload = multer({ dest: path.join(process.cwd(), 'uploads', 'tmp') });
function getUploadDir() {
    const dir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
router.get('/', (req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT id, case_number as caseNumber, defendant_name as defendantName, created_at as createdAt FROM cases ORDER BY created_at DESC').all();
    const out = [];
    for (const r of rows) {
        if (typeof r !== 'object' || r === null)
            continue;
        const rec = r;
        const idv = typeof rec.id === 'string' ? rec.id : null;
        const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt : null;
        if (!idv || !createdAt)
            continue;
        out.push({
            id: idv,
            createdAt,
            caseNumber: typeof rec.caseNumber === 'string' ? rec.caseNumber : null,
            defendantName: typeof rec.defendantName === 'string' ? rec.defendantName : null,
        });
    }
    res.json({ ok: true, cases: out });
});
router.get('/:id', (req, res) => {
    const db = getDb();
    const cid = req.params.id;
    const row = db.prepare('SELECT id, case_number as caseNumber, defendant_name as defendantName, created_at as createdAt, analysis_json as analysisJson FROM cases WHERE id = ?').get(cid);
    if (typeof row !== 'object' || row === null)
        return res.status(404).json({ ok: false, error: 'Not found' });
    const rec = row;
    const analysisJson = typeof rec.analysisJson === 'string' ? safeJsonParse(rec.analysisJson) : null;
    const docs = db.prepare('SELECT id, filename, upload_path as uploadPath FROM documents WHERE case_id = ?').all(cid);
    const outDocs = [];
    for (const d of docs) {
        if (typeof d !== 'object' || d === null)
            continue;
        const dr = d;
        const did = typeof dr.id === 'string' ? dr.id : null;
        const fn = typeof dr.filename === 'string' ? dr.filename : null;
        if (!did || !fn)
            continue;
        outDocs.push({ id: did, filename: fn, uploadPath: typeof dr.uploadPath === 'string' ? dr.uploadPath : null });
    }
    res.json({
        ok: true,
        case: {
            id: typeof rec.id === 'string' ? rec.id : cid,
            caseNumber: typeof rec.caseNumber === 'string' ? rec.caseNumber : null,
            defendantName: typeof rec.defendantName === 'string' ? rec.defendantName : null,
            createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
            analysisJson,
            documents: outDocs,
        },
    });
});
router.post('/preview', upload.array('pdfs', 10), async (req, res) => {
    try {
        const files = (req.files ?? []);
        if (files.length === 0)
            return res.status(400).json({ ok: false, error: 'No PDFs uploaded.' });
        const previewId = id();
        const uploadDir = path.join(getUploadDir(), 'previews', previewId);
        fs.mkdirSync(uploadDir, { recursive: true });
        const docs = [];
        const buffers = [];
        for (const f of files) {
            const pdfBytes = fs.readFileSync(f.path);
            buffers.push(pdfBytes);
            const { text, pageCount } = await extractPdfText(pdfBytes);
            const imgRes = await extractPdfImages(pdfBytes);
            const imageUrls = [];
            let saved = 0;
            for (const img of imgRes.images) {
                if (saved >= 8)
                    break;
                const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
                const name = `${path.basename(f.filename)}_p${img.page ?? 'x'}_${img.index}.${ext}`;
                const fp = path.join(uploadDir, name);
                fs.writeFileSync(fp, img.bytes);
                imageUrls.push(`/uploads/previews/${previewId}/${name}`);
                saved += 1;
            }
            docs.push({ filename: f.originalname, pageCount, textLength: text.length, imageCount: imgRes.images.length, imageUrls });
        }
        const analysis = await runAnalysis({ persist: false, pdfBuffers: buffers });
        res.json({ ok: true, previewId, documents: docs, analysis });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        res.status(500).json({ ok: false, error: msg });
    }
});
router.post('/upload', upload.array('pdfs', 10), async (req, res) => {
    try {
        const files = (req.files ?? []);
        if (files.length === 0)
            return res.status(400).json({ ok: false, error: 'No PDFs uploaded.' });
        const db = getDb();
        for (const f of files) {
            const pdfBytes = fs.readFileSync(f.path);
            const { text } = await extractPdfText(pdfBytes);
            const parsed = parseIdentity(text);
            const caseId = id();
            const caseDir = path.join(getUploadDir(), 'cases', caseId);
            fs.mkdirSync(caseDir, { recursive: true });
            const storedName = `${caseId}.pdf`;
            const storedPath = path.join(caseDir, storedName);
            fs.copyFileSync(f.path, storedPath);
            const analysis = await runAnalysis({ persist: true, pdfBuffers: [pdfBytes] });
            db.prepare('INSERT INTO cases (id, case_number, defendant_name, created_at, analysis_json) VALUES (?, ?, ?, ?, ?)')
                .run(caseId, parsed.caseNumber, parsed.defendantName, new Date().toISOString(), JSON.stringify(analysis));
            db.prepare('INSERT INTO documents (id, case_id, filename, upload_path, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id(), caseId, f.originalname, `/uploads/cases/${caseId}/${storedName}`, new Date().toISOString());
        }
        res.json({ ok: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        res.status(500).json({ ok: false, error: msg });
    }
});
function safeJsonParse(s) {
    try {
        const u = JSON.parse(s);
        return u;
    }
    catch {
        return null;
    }
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
