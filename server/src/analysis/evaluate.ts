import { extractPdfImages, extractPdfText, isScannedDocument } from './pdf.js';
import { detectCitations } from './citations.js';
import { getOcrProviderFromEnv } from './ocr.js';
import { lookupUtahCode, lookupWvcCode, isValidStatuteTextAny } from './statutes.js';
import { parseUtahCriminalHistory } from './priors.js';
import { getDb } from '../storage/db.js';
import { id } from '../storage/ids.js';
import { GoogleGenAI } from "@google/genai";
import { ocrPdfWithDocumentAI } from "./documentAiOcr";

/**
 * Strip repeating page headers from document text.
 * Page headers typically repeat on every page and include things like case numbers, dates, page numbers.
 */
function stripPageHeaders(text: string): string {
  // Split into lines
  const lines = text.split('\n');
  
  // Common header patterns to remove
  const headerPatterns = [
    /^Page\s+\d+\s+of\s+\d+/i,
    /^\d+\s+of\s+\d+$/,
    /^Page\s+\d+$/i,
    /^West Valley City Police Department$/i,
    /^General Offense Hardcopy$/i,
    /^General Offense Harcopy$/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/,  // Date/time stamps
    /^Case\s*#?\s*:\s*\d+/i,
    /^Printed:\s*/i,
  ];
  
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // Keep empty lines for structure
    
    // Check against header patterns
    for (const pattern of headerPatterns) {
      if (pattern.test(trimmed)) return false;
    }
    
    return true;
  });
  
  return filteredLines.join('\n');
}

/**
 * Remove all criminal history content from text.
 * This function removes criminal history sections and references while preserving
 * the officer's actions narrative that comes before them.
 */
export function stripCriminalHistory(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // Remove "Criminal History:" section up to next major section header or end
  // This stops at common section headers to avoid removing officer's actions
  result = result.replace(
    /Criminal\s+History\s*[:]\s*[\s\S]*?(?=(?:OFFICER[''\u2019]?S\s+ACTIONS|EVIDENCE|WITNESSES|ADDITIONAL\s+INFO|PROPERTY|VEHICLES?|SUSPECTS?|VICTIMS?|NARRATIVE|CASE\s+STATUS|$))/gi, 
    ''
  );
  
  // Remove inline criminal history references (single line only)
  result = result.replace(/^.*Criminal\s+History\s*[-–:].*$/gim, '');
  
  // Remove arrest/conviction count patterns (single line only)
  result = result.replace(/^\s*\d+\s+arrests?\.?\s*Convictions?:.*$/gim, '');
  result = result.replace(/^\s*\d+\s+prior\s+(?:offenses?|records?|convictions?).*$/gim, '');
  
  // Remove "(+N more records)" patterns
  result = result.replace(/\(\+\d+\s+more\s+records?\)/gi, '');
  
  // Remove Utah BCI section (up to next section header or end, not everything)
  result = result.replace(
    /Utah\s+BCI[\s\S]*?(?=(?:OFFICER[''\u2019]?S\s+ACTIONS|EVIDENCE|WITNESSES|NARRATIVE|$))/gi, 
    ''
  );
  
  // Remove NCIC section similarly
  result = result.replace(
    /NCIC[\s\S]*?(?=(?:OFFICER[''\u2019]?S\s+ACTIONS|EVIDENCE|WITNESSES|NARRATIVE|$))/gi, 
    ''
  );
  
  // Remove lines that look like criminal record entries (DATE: OFFENSE pattern)
  result = result.replace(/^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*:\s*[A-Z][A-Z\s\/]+;?\s*$/gim, '');
  
  // Remove common prior offense keywords at start of lines
  result = result.replace(/^\s*(?:Prior\s+(?:offenses?|arrests?|convictions?)|Past\s+criminal|Criminal\s+record).*$/gim, '');
  
  // Clean up multiple blank lines left behind
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}

/**
 * Extract the Officer's Actions section from the "General Offense Hardcopy" section.
 * This is the only text that should appear in the Analysis Summary.
 */
export function extractCaseSynopsis(fullText: string): string | null {
  // First, strip page headers from the text
  const cleanedText = stripPageHeaders(fullText);
  
  // Look for the "General Offense Hardcopy" or "General Offense Harcopy" section
  // Then find "Officer's Actions" within it
  const hardcopyPatterns = [
    /General\s+Offense\s+Har[dc]copy([\s\S]*?)(?=Criminal\s+History|Utah\s+BCI|$)/i,
    /General\s+Offense\s+Har[dc]copy([\s\S]*)/i,
  ];
  
  let hardcopySection = cleanedText;
  
  for (const pattern of hardcopyPatterns) {
    const match = cleanedText.match(pattern);
    if (match && match[1]) {
      hardcopySection = match[1];
      break;
    }
  }
  
  // Now find "Officer's Actions" within the hardcopy section
  // Handle both straight and curly apostrophes (',' and ')
  const officerActionsPatterns = [
    /OFFICER[''\u2019]?S\s+ACTIONS[:\s]*\n?([\s\S]+?)(?=\n\s*(?:EVIDENCE|WITNESSES|ADDITIONAL\s+INFO|PROPERTY|VEHICLES?|SUSPECTS?|VICTIMS?|NARRATIVE|CASE\s+STATUS)\s*[:\n]|$)/i,
    /OFFICER[''\u2019]?S\s+ACTIONS[:\s]*\n?([\s\S]+?)(?=\n\s*[A-Z]{4,}\s*[:\n]|$)/i,
  ];
  
  for (const pattern of officerActionsPatterns) {
    const match = hardcopySection.match(pattern);
    if (match && match[1]) {
      let actions = match[1].trim();
      
      // Strip out any remaining page headers that might have slipped through
      actions = stripPageHeaders(actions);
      
      // Remove any criminal history mentions that might have slipped in
      actions = stripCriminalHistory(actions);
      
      if (actions.length > 20 && actions.length < 5000) {
        return actions.slice(0, 800) + (actions.length > 800 ? '...' : '');
      }
    }
  }
  
  // Fallback: try to find "Officer's Actions" anywhere in the document
  for (const pattern of officerActionsPatterns) {
    const match = cleanedText.match(pattern);
    if (match && match[1]) {
      let actions = match[1].trim();
      actions = stripPageHeaders(actions);
      actions = stripCriminalHistory(actions);
      
      if (actions.length > 20 && actions.length < 5000) {
        return actions.slice(0, 800) + (actions.length > 800 ? '...' : '');
      }
    }
  }
  
  return null;
}

function looksGarbledPrefix(text: string): boolean {
  if (!text) return true;
  const head = text.slice(0, 1200);
  const cleaned = head.replace(/\u0000/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  // remove whitespace to measure symbol density even when spaced out
  const compact = cleaned.replace(/\s+/g, "");
  if (compact.length < 80) return true;

  const letters = (compact.match(/[A-Za-z]/g) || []).length;
  const digits = (compact.match(/[0-9]/g) || []).length;
  const alnum = letters + digits;
  const symbols = Math.max(0, compact.length - alnum);
  const symbolRatio = symbols / compact.length;

  // Your junk prefix has very high symbol ratio
  if (symbolRatio > 0.45) return true;

  // Also catch many punctuation characters overall
  const punct = (compact.match(/[!"#$%&'()*+,\-./:;<=>?@$begin:math:display$\$end:math:display$\\^_\`{|}~]/g) || []).length;
  if (punct / compact.length > 0.35) return true;

  return false;
}


export type RunAnalysisArgs = {
  persist: boolean;
  pdfBuffers: Buffer[];
};

export type ElementsResult = {
  overall: 'met' | 'unclear';
  elements: Array<{ element: string; status: 'met' | 'unclear'; evidenceSnippets: string[] }>;
  notes: string[];
};

// OCR entire PDF using Gemini (for scanned documents)
async function ocrPdfWithGemini(pdfBytes: Buffer): Promise<string> {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey || !baseUrl) {
    console.log('Gemini not configured for OCR');
    return '';
  }
  
  // Check PDF size - Gemini has 8MB limit for inline data
  const pdfSizeMB = pdfBytes.length / (1024 * 1024);
  console.log(`PDF size: ${pdfSizeMB.toFixed(2)} MB`);
  
  if (pdfSizeMB > 7) {
    console.log('PDF too large for Gemini inline processing, skipping OCR');
    return '';
  }
  
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl,
      },
    });

    console.log('Running Gemini OCR on scanned PDF...');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { 
            text: `Extract ALL text from this legal document PDF. Focus on:
- Case number (format: "Case #: XXXX-XXXXX" or "Case XXXX-XXXXX") - IMPORTANT: Extract this from the first page header
- Defendant name (format: "Last, First" or "First Last")
- Criminal charges and code citations (Utah Code XX-X-XXX, West Valley City Code)
- Criminal history sections with prior arrests/convictions
- Officer narratives
- "Booked Into Jail: Yes/No" field

Return ONLY the extracted text, preserving the case number and defendant name exactly as they appear.` 
          },
          { 
            inlineData: { 
              mimeType: 'application/pdf', 
              data: pdfBytes.toString('base64') 
            } 
          }
        ]
      }]
    });

    const text = response.text || '';
    console.log(`Gemini OCR extracted ${text.length} characters`);
    return text;
  } catch (error) {
    console.error('Gemini OCR error:', error instanceof Error ? error.message : String(error));
    return '';
  }
}

export async function runAnalysis(args: RunAnalysisArgs): Promise<unknown> {
  const provider = getOcrProviderFromEnv(process.env);
    console.log("DEBUG_OCR_PROVIDER", provider.kind);
  let mergedText = '';
  const docSummaries: Array<{ pageCount: number | null; textLength: number; imageCount: number; ocrUsed: boolean }> = [];
  const extractedImages: Array<{ mimeType: string; imageData: string; pageNumber: number | null }> = [];

  for (const pdfBytes of args.pdfBuffers) {
    const t = await extractPdfText(pdfBytes);
    const imgs = await extractPdfImages(pdfBytes);
    
    let ocrText = '';
    let ocrUsed = false;
    
    // Check if text extraction produced garbage (scanned document)
    if ((isScannedDocument(t.text) || looksGarbledPrefix(t.text)) && provider.kind !== 'none') {
      console.log('Detected scanned document, running OCR...');
      if (provider.kind === "document_ai") {
        console.log("DEBUG_OCR_PATH document_ai");
        ocrText = await ocrPdfWithDocumentAI(pdfBytes);
      } else {
        console.log("DEBUG_OCR_PATH gemini");
        ocrText = await ocrPdfWithGemini(pdfBytes);
      }
      ocrUsed = ocrText.length > 0;
    }

    // Use OCR text if available, otherwise use extracted text
    const sanitizeText = (s: string) =>
      (s || "")
        .replace(/\u0000/g, "")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

// Prefer OCR text whenever extraction is garbled AND OCR produced something usable
const extracted = sanitizeText(t.text);
const ocrClean = sanitizeText(ocrText);

let finalText = extracted;
if ((isScannedDocument(t.text) || looksGarbledPrefix(t.text)) && ocrClean.length > 200) {
  finalText = ocrClean;
  console.log("✅ Using OCR text (Document AI/Gemini) because extracted text was garbled.");
} else if (ocrClean.length > 200 && extracted.length < 200) {
  finalText = ocrClean;
  console.log("✅ Using OCR text (extracted text too short).");
} else {
  console.log("ℹ️ Using extracted text (OCR not needed or not available).");
}
    mergedText += `\n\n${finalText}\n`;
    docSummaries.push({ 
      pageCount: t.pageCount, 
      textLength: finalText.length, 
      imageCount: imgs.images.length,
      ocrUsed 
    });
    
    for (const img of imgs.images) {
      extractedImages.push({
        mimeType: img.mimeType,
        imageData: img.bytes.toString('base64'),
        pageNumber: img.page
      });
    }
  }

  const citations = detectCitations(mergedText);
  const narrative = extractOfficerNarrative(mergedText);

  const statutes: unknown[] = [];
  const elements: unknown[] = [];

  for (const c of citations) {
    if (c.jurisdiction === 'UT') {
      const st = await cachedStatute('UT', c.normalizedKey, () => lookupUtahCode(c.normalizedKey));
      if (st) {
        statutes.push(st);
        elements.push({ jurisdiction: 'UT', code: c.normalizedKey, result: evaluateElements(narrative, st.text) });
      }
    } else if (c.jurisdiction === 'WVC') {
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
    fullText: mergedText,
    statutes,
    elements,
    priors,
    extractedImages,
  };
}

function extractOfficerNarrative(text: string): string {
  const patterns: RegExp[] = [
    /OFFICER(?:'S)?\s+NARRATIVE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
    /PROBABLE\s+CAUSE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
    /NARRATIVE[\s\S]{0,80}\n([\s\S]{200,12000})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && typeof m[1] === 'string') return m[1].trim();
  }
  return text.slice(0, 12000).trim();
}

function evaluateElements(narrative: string, statuteText: string): ElementsResult {
  const elements = buildElementsFromStatuteText(statuteText);
  const checks = elements.map((el) => {
    const keys = keywordize(el);
    const evidence = findEvidence(narrative, keys);
    const status: 'met' | 'unclear' = keys.length >= 2 && evidence.length > 0 ? 'met' : 'unclear';
    return { element: el, status, evidenceSnippets: evidence };
  });
  const metCount = checks.filter((c) => c.status === 'met').length;
  const overall: 'met' | 'unclear' = metCount >= Math.max(1, Math.floor(checks.length * 0.6)) ? 'met' : 'unclear';
  return { overall, elements: checks, notes: ['Screening-only: based on narrative keyword evidence vs statute text.'] };
}

function buildElementsFromStatuteText(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 15 && l.length <= 500);
  const triggers = ['commits', 'is guilty', 'shall', 'may not', 'unlawful', 'a person', 'must'];
  const out: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (triggers.some((t) => lower.includes(t))) out.push(line);
    if (out.length >= 12) break;
  }
  return out.length > 0 ? out : lines.slice(0, 8);
}

function keywordize(s: string): string[] {
  const stop = new Set(['the','and','or','of','to','in','on','for','with','without','by','from','is','are','was','were','shall','may','must','not','person','a','an']);
  const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 4 && !stop.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, 8);
}

function findEvidence(narrative: string, keywords: string[]): string[] {
  const lower = narrative.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k));
  const snippets: string[] = [];
  for (const k of hits.slice(0, 3)) {
    const idx = lower.indexOf(k);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 80);
    const end = Math.min(narrative.length, idx + 140);
    snippets.push(narrative.slice(start, end).trim());
  }
  return snippets;
}

type CachedStatute = { jurisdiction: 'UT' | 'WVC'; code: string; title: string | null; text: string; url: string; fetchedAtIso: string };

async function cachedStatute(
  jurisdiction: 'UT' | 'WVC',
  code: string,
  fetcher: () => Promise<{ ok: true; title: string | null; text: string; url: string; fetchedAtIso: string } | { ok: false }>,
): Promise<CachedStatute | null> {
  // Try cache first, but don't fail if SQLite is unavailable
  try {
    const db = getDb();
    const row: unknown = db.prepare('SELECT content_json as contentJson FROM code_cache WHERE jurisdiction = ? AND normalized_key = ?').get(jurisdiction, code);
    if (typeof row === 'object' && row !== null && 'contentJson' in row) {
      const cj = (row as Record<string, unknown>).contentJson;
      if (typeof cj === 'string' && cj.length > 0) {
        try {
          const parsed: unknown = JSON.parse(cj);
          if (typeof parsed === 'object' && parsed !== null) {
            const rec = parsed as Record<string, unknown>;
            const text = typeof rec.text === 'string' ? rec.text : null;
            const url = typeof rec.url === 'string' ? rec.url : null;
            const title = typeof rec.title === 'string' ? rec.title : null;
            const fetchedAtIso = typeof rec.fetchedAtIso === 'string' ? rec.fetchedAtIso : null;
            // Validate cached content - reject navigation HTML that was incorrectly cached
            // Use jurisdiction-aware validation (WVC statutes may be shorter and lack subsection markers)
            if (text && url && fetchedAtIso) {
              if (!isValidStatuteTextAny(text, jurisdiction)) {
                console.log(`[WARN] SQLite cached statute for ${code} (${jurisdiction}) failed validation, refetching...`);
                // Delete the bad cache entry
                try {
                  db.prepare('DELETE FROM code_cache WHERE jurisdiction = ? AND normalized_key = ?').run(jurisdiction, code);
                } catch { /* ignore delete error */ }
              } else {
                return { jurisdiction, code, title, text, url, fetchedAtIso };
              }
            }
          }
        } catch { /* ignore parse error */ }
      }
    }
  } catch (dbErr) {
    console.warn('SQLite cache unavailable, fetching directly:', dbErr instanceof Error ? dbErr.message : 'unknown');
  }

  const res = await fetcher();
  if (!('ok' in res) || res.ok !== true) return null;

  // Validate fetched content before caching - reject navigation HTML
  // Use jurisdiction-aware validation (WVC statutes may be shorter and lack subsection markers)
  if (!isValidStatuteTextAny(res.text, jurisdiction)) {
    console.log(`[WARN] Fetched statute for ${code} (${jurisdiction}) failed validation, not caching or returning`);
    return null;
  }

  // Try to cache, but don't fail if SQLite is unavailable
  try {
    const db = getDb();
    const obj = { title: res.title, text: res.text, url: res.url, fetchedAtIso: res.fetchedAtIso };
    db.prepare('INSERT OR REPLACE INTO code_cache (id, jurisdiction, normalized_key, content_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .run(id(), jurisdiction, code, JSON.stringify(obj), new Date().toISOString());
  } catch { /* ignore cache write error */ }

  return { jurisdiction, code, title: res.title, text: res.text, url: res.url, fetchedAtIso: res.fetchedAtIso };
}
