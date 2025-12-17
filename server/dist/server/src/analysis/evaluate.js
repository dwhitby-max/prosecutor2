import { extractPdfImages, extractPdfText } from './pdf.js';
import { detectCitations } from './citations.js';
import { getOcrProviderFromEnv, ocrPngPage } from './ocr.js';
import { lookupUtahCode, lookupWvcCode } from './statutes.js';
import { parseUtahCriminalHistory } from './priors.js';
import { getDb } from '../storage/db.js';
import { id } from '../storage/ids.js';
export async function runAnalysis(args) {
    const provider = getOcrProviderFromEnv(process.env);
    let mergedText = '';
    const docSummaries = [];
    for (const pdfBytes of args.pdfBuffers) {
        const t = await extractPdfText(pdfBytes);
        const imgs = await extractPdfImages(pdfBytes);
        let ocrAppend = '';
        if (provider.kind !== 'none') {
            const candidates = imgs.images.slice(0, 8);
            for (const c of candidates) {
                if (c.mimeType !== 'image/png')
                    continue;
                const o = await ocrPngPage({ pngBytes: c.bytes, pageIndex1Based: c.page }, provider);
                if (o.ok)
                    ocrAppend += `\n\n[OCR_PAGE_${c.page ?? 0}]\n${o.text}\n`;
            }
        }
        mergedText += `\n\n[DOC]\n${t.text}\n${ocrAppend}\n`;
        docSummaries.push({ pageCount: t.pageCount, textLength: t.text.length, imageCount: imgs.images.length });
    }
    const citations = detectCitations(mergedText);
    const narrative = extractOfficerNarrative(mergedText);
    const statutes = [];
    const elements = [];
    for (const c of citations) {
        if (c.jurisdiction === 'UT') {
            const st = await cachedStatute('UT', c.normalizedKey, () => lookupUtahCode(c.normalizedKey));
            if (st) {
                statutes.push(st);
                elements.push({ jurisdiction: 'UT', code: c.normalizedKey, result: evaluateElements(narrative, st.text) });
            }
        }
        else if (c.jurisdiction === 'WVC') {
            const st = await cachedStatute('WVC', c.normalizedKey, () => lookupWvcCode(c.normalizedKey));
            if (st) {
                statutes.push(st);
                elements.push({ jurisdiction: 'WVC', code: c.normalizedKey, result: evaluateElements(narrative, st.text) });
            }
        }
    }
    const priors = parseUtahCriminalHistory(mergedText);
    return {
        documents: docSummaries,
        citations,
        narrative,
        statutes,
        elements,
        priors,
    };
}
function extractOfficerNarrative(text) {
    const patterns = [
        /OFFICER(?:'S)?\s+NARRATIVE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
        /PROBABLE\s+CAUSE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
        /NARRATIVE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m && typeof m[1] === 'string')
            return m[1].trim();
    }
    return text.slice(0, 12000).trim();
}
function evaluateElements(narrative, statuteText) {
    const elements = buildElementsFromStatuteText(statuteText);
    const checks = elements.map((el) => {
        const keys = keywordize(el);
        const evidence = findEvidence(narrative, keys);
        const status = keys.length >= 2 && evidence.length > 0 ? 'met' : 'unclear';
        return { element: el, status, evidenceSnippets: evidence };
    });
    const metCount = checks.filter((c) => c.status === 'met').length;
    const overall = metCount >= Math.max(1, Math.floor(checks.length * 0.6)) ? 'met' : 'unclear';
    return { overall, elements: checks, notes: ['Screening-only: based on narrative keyword evidence vs statute text.'] };
}
function buildElementsFromStatuteText(text) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 15 && l.length <= 500);
    const triggers = ['commits', 'is guilty', 'shall', 'may not', 'unlawful', 'a person', 'must'];
    const out = [];
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (triggers.some((t) => lower.includes(t)))
            out.push(line);
        if (out.length >= 12)
            break;
    }
    return out.length > 0 ? out : lines.slice(0, 8);
}
function keywordize(s) {
    const stop = new Set(['the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'without', 'by', 'from', 'is', 'are', 'was', 'were', 'shall', 'may', 'must', 'not', 'person', 'a', 'an']);
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 4 && !stop.has(w));
    const seen = new Set();
    const out = [];
    for (const w of words) {
        if (seen.has(w))
            continue;
        seen.add(w);
        out.push(w);
    }
    return out.slice(0, 8);
}
function findEvidence(narrative, keywords) {
    const lower = narrative.toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k));
    const snippets = [];
    for (const k of hits.slice(0, 3)) {
        const idx = lower.indexOf(k);
        if (idx < 0)
            continue;
        const start = Math.max(0, idx - 80);
        const end = Math.min(narrative.length, idx + 140);
        snippets.push(narrative.slice(start, end).trim());
    }
    return snippets;
}
async function cachedStatute(jurisdiction, code, fetcher) {
    const db = getDb();
    const row = db.prepare('SELECT content_json as contentJson FROM code_cache WHERE jurisdiction = ? AND normalized_key = ?').get(jurisdiction, code);
    if (typeof row === 'object' && row !== null && 'contentJson' in row) {
        const cj = row.contentJson;
        if (typeof cj === 'string' && cj.length > 0) {
            try {
                const parsed = JSON.parse(cj);
                if (typeof parsed === 'object' && parsed !== null) {
                    const rec = parsed;
                    const text = typeof rec.text === 'string' ? rec.text : null;
                    const url = typeof rec.url === 'string' ? rec.url : null;
                    const title = typeof rec.title === 'string' ? rec.title : null;
                    const fetchedAtIso = typeof rec.fetchedAtIso === 'string' ? rec.fetchedAtIso : null;
                    if (text && url && fetchedAtIso)
                        return { jurisdiction, code, title, text, url, fetchedAtIso };
                }
            }
            catch { /* ignore */ }
        }
    }
    const res = await fetcher();
    if (!('ok' in res) || res.ok !== true)
        return null;
    const obj = { title: res.title, text: res.text, url: res.url, fetchedAtIso: res.fetchedAtIso };
    db.prepare('INSERT OR REPLACE INTO code_cache (id, jurisdiction, normalized_key, content_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
        .run(id(), jurisdiction, code, JSON.stringify(obj), new Date().toISOString());
    return { jurisdiction, code, title: res.title, text: res.text, url: res.url, fetchedAtIso: res.fetchedAtIso };
}
