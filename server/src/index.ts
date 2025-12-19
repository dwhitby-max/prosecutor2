import { statutesRouter } from "./routes/statutes";
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { storage } from '../storage.js';
import { extractPdfText } from './analysis/pdf.js';
import { runAnalysis, extractCaseSynopsis } from './analysis/evaluate.js';
import { lookupUtahCode, lookupWvcCode, isValidStatuteTextAny } from './analysis/statutes.js';

interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Request timing middleware for performance monitoring (Development Principles compliance)
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = duration > 2000 ? 'WARN' : 'INFO';
    if (req.path.startsWith('/api')) {
      console.log(`[${logLevel}] ${req.method} ${req.path} completed in ${duration}ms (status: ${res.statusCode})`);
    }
  });
  next();
});

const uploadsDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const upload = multer({ dest: path.join(uploadsDir, 'tmp') });

function getUploadDir(): string {
  const dir = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Format name as "Last Name, First Name"
function formatDefendantName(firstName: string, lastName: string): string {
  return `${lastName.trim()}, ${firstName.trim()}`;
}

function parseIdentity(text: string): { caseNumber: string | null; defendantName: string | null; bookedIntoJail: boolean | null } {
  // Look for case number - "Case #: XXXX-XXXXX" is primary format
  let caseNumber: string | null = null;
  const casePatterns = [
    // "Case #: XXXX-XXXXX" or "Case #:XXXX-XXXXX" - primary format from Patrol Screening Sheet
    /Case\s*#\s*:?\s*(\d{4}[\-]\d{5})/i,
    /Case\s*#\s*:?\s*(\d{2}[\-]\d{5})/i,
    // "Case XXXX-XXXXX" - without hash
    /Case\s+(\d{4}[\-]\d{5})/i,
    /Case\s+(\d{2}[\-]\d{5})/i,
    // "Police Case" format
    /Police\s+Case[:\s#]*(\d{2,4}[\-\/]\d+)/i,
    // "Case No." or "Case Number" with number
    /Case\s*(?:No\.?|Number)[:\s]*(\d{2,4}[\-\/]\d+)/i,
    // Standalone case number pattern XXXX-XXXXX
    /(\d{4}[\-]\d{5})/,
  ];
  
  for (const pattern of casePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length >= 6) {
      caseNumber = match[1].trim();
      break;
    }
  }

  // Parse defendant name - try multiple formats, output as "Last, First"
  // Support letters, hyphens, apostrophes, periods (for initials), and spaces
  let defendantName: string | null = null;
  
  // Try "Last, First" or "Last, First Middle" format (already in correct format)
  // Matches: "Doe, John", "Doe, John A.", "Doe, John Andrew Jr."
  const lastFirstMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.]+),\s*([A-Z][a-zA-Z\-'\.\s]+)/i);
  if (lastFirstMatch) {
    const lastName = lastFirstMatch[1].trim();
    const firstName = lastFirstMatch[2].trim();
    defendantName = `${lastName}, ${firstName}`;
  } else {
    // Try "First Last" or "First Middle Last" format - need to swap
    // Capture everything after "Defendant:" that looks like a name
    const nameBlockMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.\s]+?)(?=\s*(?:DOB|Date|Address|Case|\n|$))/i);
    if (nameBlockMatch && nameBlockMatch[1]) {
      const namePart = nameBlockMatch[1].trim();
      
      // If already has comma, assume "Last, First" format
      if (namePart.includes(',')) {
        defendantName = namePart;
      } else {
        // Split by spaces and identify suffixes
        const parts = namePart.split(/\s+/).filter(p => p.length > 0);
        const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'II', 'III', 'IV'];
        
        if (parts.length >= 2) {
          // Check if last part is a suffix
          let suffix = '';
          let lastNameIdx = parts.length - 1;
          if (suffixes.includes(parts[lastNameIdx]) || suffixes.includes(parts[lastNameIdx] + '.')) {
            suffix = ' ' + parts[lastNameIdx];
            lastNameIdx--;
          }
          
          if (lastNameIdx >= 1) {
            const lastName = parts[lastNameIdx];
            const firstName = parts.slice(0, lastNameIdx).join(' ');
            defendantName = `${lastName}, ${firstName}${suffix}`;
          }
        }
      }
    }
  }

  // Extract "Booked Into Jail" field
  let bookedIntoJail: boolean | null = null;
  const bookedMatch = text.match(/Booked\s+Into\s+Jail[:\s]*(Yes|No|Y|N)/i);
  if (bookedMatch) {
    bookedIntoJail = bookedMatch[1].toLowerCase().startsWith('y');
  }

  return { caseNumber, defendantName, bookedIntoJail };
}

// More robust parsing for OCR text which may have different formatting
function parseIdentityFromText(text: string): { caseNumber: string | null; defendantName: string | null; bookedIntoJail: boolean | null } {
  let defendantName: string | null = null;
  let caseNumber: string | null = null;
  const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'II', 'III', 'IV'];
  
  // Words that indicate we've gone past the name into narrative
  const stopWords = ['and', 'the', 'is', 'are', 'was', 'were', 'his', 'her', 'their', 'with', 'also', 'known', 'staying', 'in', 'on', 'at', 'for', 'to', 'from', 'by', 'but', 'or', 'property', 'windows', 'officers', 'car', 'vehicle', 'booked', 'into', 'jail'];
  
  // Helper to clean name (remove newlines, extra spaces, and trailing junk)
  const cleanName = (name: string): string => {
    return name
      .split(/[\n\r]/)[0]  // Take only first line
      .replace(/\s+/g, ' ')  // Normalize spaces
      .replace(/[^a-zA-Z\s,.\-']/g, '')  // Remove special chars
      .trim();
  };
  
  // Helper to validate a name (should be 2-4 words, no stop words)
  const isValidName = (name: string): boolean => {
    const cleaned = cleanName(name);
    const parts = cleaned.split(/[\s,]+/).filter(p => p.length > 0);
    if (parts.length < 2 || parts.length > 5) return false;
    // Check if any part is a stop word (indicates narrative, not name)
    for (const part of parts) {
      if (stopWords.includes(part.toLowerCase())) return false;
    }
    // Check that all parts look like name parts (capitalized or short)
    for (const part of parts) {
      if (part.length > 15) return false; // Names shouldn't be super long
    }
    return true;
  };
  
  // Try multiple patterns for defendant name - output as "Last, First"
  // Be VERY restrictive to avoid capturing narrative text
  const namePatterns = [
    // "Last, First" or "Last, First Middle" - most reliable
    { pattern: /Defendant[:\s]+([A-Z][a-z]+),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)?)/i, format: 'last_first' },
    { pattern: /Name[:\s]+([A-Z][a-z]+),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)?)/i, format: 'last_first' },
    // "First Last" after "also" pattern (e.g., "also Dave McKay White")
    { pattern: /also\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i, format: 'first_middle_last' },
    // "D and his dad (also Dave McKay White" - extract from parenthetical
    { pattern: /\(also\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\)/i, format: 'name_block' },
    // vs. pattern for court cases
    { pattern: /vs?\.?\s+([A-Z][a-z]+),?\s+([A-Z][a-z]+)/i, format: 'first_last' },
    { pattern: /STATE\s+(?:OF\s+)?UTAH\s+v\.?\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i, format: 'first_last' },
  ];
  
  for (const { pattern, format } of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let candidateName: string | null = null;
      
      if (format === 'last_first' && match[2]) {
        candidateName = `${match[1].trim()}, ${match[2].trim()}`;
      } else if (format === 'first_last' && match[2]) {
        candidateName = `${match[2].trim()}, ${match[1].trim()}`;
      } else if (format === 'first_middle_last' && match[2] && match[3]) {
        candidateName = `${match[3].trim()}, ${match[1].trim()} ${match[2].trim()}`;
      } else if (format === 'name_block') {
        const namePart = match[1].trim();
        if (namePart.includes(',')) {
          candidateName = namePart;
        } else {
          const parts = namePart.split(/\s+/).filter(p => p.length > 0);
          if (parts.length >= 2 && parts.length <= 4) {
            let suffix = '';
            let lastNameIdx = parts.length - 1;
            if (suffixes.includes(parts[lastNameIdx]) || suffixes.includes(parts[lastNameIdx] + '.')) {
              suffix = ' ' + parts[lastNameIdx];
              lastNameIdx--;
            }
            if (lastNameIdx >= 1) {
              candidateName = `${parts[lastNameIdx]}, ${parts.slice(0, lastNameIdx).join(' ')}${suffix}`;
            }
          }
        }
      }
      
      // Validate the name before accepting it
      if (candidateName && isValidName(candidateName)) {
        defendantName = cleanName(candidateName);
        break;
      }
    }
  }
  
  // Additional OCR-specific patterns for names that appear on separate lines
  // Look for "LAST, FIRST" format in all caps (common in OCR)
  if (!defendantName) {
    const ocrNamePatterns = [
      // "WHITE, DAVE" - all caps with comma
      /([A-Z]{2,15}),\s*([A-Z]{2,15}(?:\s+[A-Z]{1,15})?)\s/,
      // Defendant name in table format
      /Defendant\s*[:\s]\s*([A-Z][a-zA-Z\-']+)[,\s]+([A-Z][a-zA-Z\-']+)/i,
    ];
    
    for (const pattern of ocrNamePatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[2]) {
        const lastName = match[1].trim();
        const firstName = match[2].trim().split(/[\n\r]/)[0].trim();
        const candidateName = `${lastName}, ${firstName}`;
        if (isValidName(candidateName)) {
          defendantName = cleanName(candidateName);
          break;
        }
      }
    }
  }
  
  // Try multiple patterns for case number
  // Priority: "Case #: WV25-XXXXX" or "Case #: XXXX-XXXXX" format from Patrol Screening Sheet
  const casePatterns = [
    // "Case #: WV25-95709" - West Valley City format with letters
    /Case\s*#\s*:?\s*([A-Z]{2,4}\d{2}[\-]\d{4,6})/i,
    // "Case #: XXXX-XXXXX" or "Case #:XXXX-XXXXX" - numeric format
    /Case\s*#\s*:?\s*(\d{4}[\-]\d{5})/i,
    /Case\s*#\s*:?\s*(\d{2}[\-]\d{5})/i,
    // "Case WV25-95709" or "Case XXXX-XXXXX" - without hash
    /Case\s+([A-Z]{2,4}\d{2}[\-]\d{4,6})/i,
    /Case\s+(\d{4}[\-]\d{5})/i,
    /Case\s+(\d{2}[\-]\d{5})/i,
    // "Police Case" format
    /Police\s+Case[:\s#]*([A-Z]{0,4}\d{2,4}[\-\/]\d+)/i,
    // "Case No." or "Case Number" with number
    /Case\s*(?:No\.?|Number)[:\s]*([A-Z]{0,4}\d{2,4}[\-\/]\d+)/i,
    // Standalone case number pattern WV25-XXXXX
    /([A-Z]{2,4}\d{2}[\-]\d{4,6})/,
    // Standalone case number pattern XXXX-XXXXX
    /(\d{4}[\-]\d{5})/,
    // Other patterns
    /(?:Criminal|Civil)\s+(?:No\.?|Case)[:\s]*([A-Za-z0-9\-]+)/i,
    /Docket[:\s]*([A-Za-z0-9\-]+)/i,
  ];
  
  for (const pattern of casePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      caseNumber = match[1].trim();
      if (caseNumber.length >= 6 && caseNumber.length < 20) break;
    }
  }
  
  // Extract "Booked Into Jail" field - try multiple patterns
  let bookedIntoJail: boolean | null = null;
  const bookedPatterns = [
    /Booked\s+Into\s+Jail[:\s]*(Yes|No|Y|N)/i,
    /Booked[:\s]*(Yes|No|Y|N)/i,
    /Jail[:\s]*(Yes|No|Y|N)/i,
  ];
  for (const pattern of bookedPatterns) {
    const match = text.match(pattern);
    if (match) {
      bookedIntoJail = match[1].toLowerCase().startsWith('y');
      break;
    }
  }
  
  return { caseNumber, defendantName, bookedIntoJail };
}

// Extract charges from Patrol Screening Sheet - only current case charges, not criminal history
// Handles OCR that merges example header and real charges onto same line
function extractChargesFromScreeningSheet(text: string): Array<{ code: string; chargeName: string; chargeClass: string | null }> {
  const charges: Array<{ code: string; chargeName: string; chargeClass: string | null }> = [];
  const seenCodes = new Set<string>();
  
  // OCR error corrections - common misreads
  const ocrCorrections: Record<string, string> = {
    '57-37A': '58-37A',  // OCR often misreads 58 as 57 for drug paraphernalia statute
    '57-37a': '58-37A',
    '57-37A-5': '58-37A-5',
    '57-37a-5': '58-37A-5',
  };
  
  // Map of known charge codes to their names
  const knownCharges: Record<string, string> = {
    '58-37-8': 'Possession of Controlled Substance',
    '58-37A-5': 'Possession of Drug Paraphernalia',
    '58-37a-5': 'Possession of Drug Paraphernalia',
    '76-5-109': 'Child Abuse',
    '76-10-508': 'Discharge of Firearm',
    '76-6-506.3': 'Financial Transaction Card Offenses',
    '76-6-602': 'Retail Theft',
    '76-8-306': 'Obstructing Justice',
    '76-6-408': 'Receiving Stolen Property',
    '76-6-404': 'Theft',
    '76-8-305': 'Interference with Arrest',
    '76-9-702': 'Disorderly Conduct',
    '41-6a-502': 'DUI',
    '41-6a-501': 'Driving Under Influence',
  };
  
  // Common charge abbreviations from screening sheets
  const chargeAbbreviations: Record<string, string> = {
    'POCS': 'Possession of Controlled Substance',
    'PODP': 'Possession of Drug Paraphernalia',
    'DUI': 'Driving Under Influence',
    'DV': 'Domestic Violence',
  };
  
  // Class abbreviation mapping
  const classMap: Record<string, string> = {
    'MA': 'Misdemeanor A',
    'MB': 'Misdemeanor B',
    'MC': 'Misdemeanor C',
    'F1': '1st Degree Felony',
    'F2': '2nd Degree Felony',
    'F3': '3rd Degree Felony',
  };
  
  // Find the start of "Offense Information" section
  const offenseInfoMatch = text.match(/Offense\s+Information/i);
  if (!offenseInfoMatch) {
    console.log('No "Offense Information" section found - returning empty charges');
    return charges;
  }
  
  const startIndex = offenseInfoMatch.index! + offenseInfoMatch[0].length;
  console.log('Found "Offense Information" at index', offenseInfoMatch.index, '- starting scan from', startIndex);
  
  // Get text after "Offense Information" - limit to first 500 chars to stay in charge section
  let chargeText = text.slice(startIndex, startIndex + 500);
  
  // Find where the next section starts (Criminal History, Narrative, etc.)
  const sectionBoundaries = [
    /Criminal\s+History/i,
    /\bBCI\b/i,
    /\bNCIC\b/i,
    /Prior\s+(arrests|record)/i,
    /Narrative/i,
    /Synopsis/i,
    /Arresting\s+Officer/i,
    /Victim\s+Information/i,
  ];
  
  for (const boundary of sectionBoundaries) {
    const boundaryMatch = chargeText.match(boundary);
    if (boundaryMatch && boundaryMatch.index) {
      chargeText = chargeText.slice(0, boundaryMatch.index);
      console.log('Trimmed charge text at boundary:', boundary.source);
      break;
    }
  }
  
  console.log('=== RAW CHARGE TEXT ===');
  console.log(chargeText);
  console.log('=== END RAW CHARGE TEXT ===');
  
  // The OCR often merges example header and real charges on same line
  // Pattern: "CODE (example: CHARGE (example: Assault) 76-6-102) 58-37-8 POCS 57-37a-5 PODP"
  // Strategy: Find ALL codes in the section, skip the FIRST one (the example), process the rest
  
  // First, collect all codes with their context
  const codePattern = /\b(\d{2})-(\d{1,3}[aA]?)-(\d{1,4}(?:\.\d+)?)\b\s*([A-Z]{2,6})?/gi;
  const allCodes: Array<{ fullMatch: string; title: string; chapter: string; section: string; suffix: string; index: number }> = [];
  let match;
  
  while ((match = codePattern.exec(chargeText)) !== null) {
    allCodes.push({
      fullMatch: match[0],
      title: match[1],
      chapter: match[2].toUpperCase(),
      section: match[3],
      suffix: match[4]?.toUpperCase() || '',
      index: match.index,
    });
  }
  
  console.log('Found', allCodes.length, 'codes in charge section:', allCodes.map(c => `${c.title}-${c.chapter}-${c.section}`).join(', '));
  
  // If the text contains "example", skip the FIRST code (it's the example code like 76-6-102)
  const hasExampleText = chargeText.toLowerCase().includes('example');
  const codesToProcess = hasExampleText && allCodes.length > 1 ? allCodes.slice(1) : allCodes;
  
  if (hasExampleText && allCodes.length > 0) {
    console.log('Skipping example code:', `${allCodes[0].title}-${allCodes[0].chapter}-${allCodes[0].section}`);
  }
  
  // Process the remaining codes as real charges
  for (const codeInfo of codesToProcess) {
    let { title, chapter, section, suffix } = codeInfo;
    
    // Build the full code
    let fullCode = `${title}-${chapter}-${section}`;
    
    // Apply OCR corrections
    if (ocrCorrections[fullCode]) {
      console.log(`OCR correction: ${fullCode} -> ${ocrCorrections[fullCode]}`);
      fullCode = ocrCorrections[fullCode];
    } else if (ocrCorrections[`${title}-${chapter}`]) {
      const corrected = ocrCorrections[`${title}-${chapter}`].split('-');
      fullCode = `${corrected[0]}-${corrected[1]}-${section}`;
      console.log(`OCR correction (partial): ${title}-${chapter} -> ${corrected[0]}-${corrected[1]}`);
    }
    
    // Normalize the code
    const normalizedCode = fullCode.toUpperCase();
    
    // Skip if already seen
    if (seenCodes.has(normalizedCode)) continue;
    seenCodes.add(normalizedCode);
    
    // Determine charge class from suffix
    let chargeClass: string | null = null;
    if (classMap[suffix]) {
      chargeClass = classMap[suffix];
    }
    
    // Get charge name from abbreviation, known list, or default
    let chargeName = chargeAbbreviations[suffix] || 
                     knownCharges[fullCode] || 
                     knownCharges[fullCode.toLowerCase()] ||
                     `Utah Code ${fullCode}`;
    
    charges.push({ code: fullCode, chargeName, chargeClass });
    console.log('Found CURRENT charge:', fullCode, chargeName, chargeClass || '(no class)', 'suffix:', suffix);
  }
  
  console.log('Total screening sheet charges found:', charges.length, charges.map(c => c.code).join(', ') || 'none');
  
  return charges;
}

// Helper to extract last name from "Last, First" format
function getLastName(defendantName: string): string {
  const parts = defendantName.split(',');
  return (parts[0] || defendantName).trim().toLowerCase();
}

// Get all cases (active by default) - sorted alphabetically by last name
app.get('/api/cases', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const filter = req.query.filter as string || 'active';
    let caseList;
    if (filter === 'completed') {
      caseList = await storage.getCompletedCases();
    } else if (filter === 'all') {
      caseList = await storage.getAllCases();
    } else {
      caseList = await storage.getActiveCases();
    }
    
    // Sort alphabetically by last name (first part before comma)
    caseList.sort((a, b) => {
      const lastA = getLastName(a.defendantName);
      const lastB = getLastName(b.defendantName);
      return lastA.localeCompare(lastB);
    });
    
    console.log('Returning', caseList.length, filter, 'cases');
    res.json({ ok: true, cases: caseList });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Error getting cases:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

// Debug endpoint to test Document AI connection
app.get('/api/debug/document-ai', async (req, res) => {
  try {
    const { ocrPdfWithDocumentAI } = await import('./analysis/documentAiOcr.js');
    
    // Check environment variables first
    const requiredEnvVars = [
      'DOCUMENT_AI_PROJECT_ID',
      'DOCUMENT_AI_LOCATION', 
      'DOCUMENT_AI_PROCESSOR_ID',
      'DOCUMENT_AI_SERVICE_ACCOUNT_JSON'
    ];
    
    const envStatus: Record<string, string> = {};
    for (const key of requiredEnvVars) {
      const value = process.env[key];
      if (!value || !value.trim()) {
        envStatus[key] = 'MISSING';
      } else if (key === 'DOCUMENT_AI_SERVICE_ACCOUNT_JSON') {
        try {
          const parsed = JSON.parse(value);
          envStatus[key] = `OK (project: ${parsed.project_id || 'unknown'})`;
        } catch {
          envStatus[key] = 'INVALID JSON';
        }
      } else {
        envStatus[key] = `OK (${value.slice(0, 20)}...)`;
      }
    }
    
    const ocrProvider = process.env.OCR_PROVIDER || 'document_ai';
    
    // Create a minimal test PDF (just text "TEST")
    const testPdfBase64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovQ29udGVudHMgNCAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PAovRjEgNSAwIFIKPj4KPj4KPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjEwMCA3MDAgVGQKKFRFU1QpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxNDggMDAwMDAgbiAKMDAwMDAwMDI4NyAwMDAwMCBuIAowMDAwMDAwMzgzIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDYyCiUlRU9G';
    const testPdfBytes = Buffer.from(testPdfBase64, 'base64');
    
    console.log('[DEBUG] Testing Document AI connection...');
    const startTime = Date.now();
    const extractedText = await ocrPdfWithDocumentAI(testPdfBytes);
    const duration = Date.now() - startTime;
    
    console.log(`[DEBUG] Document AI test successful in ${duration}ms, extracted: "${extractedText}"`);
    
    res.json({
      ok: true,
      message: 'Document AI connection successful!',
      ocrProvider,
      envStatus,
      testResult: {
        extractedText: extractedText || '(empty)',
        duration: `${duration}ms`
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[DEBUG] Document AI test failed:', msg);
    res.status(500).json({
      ok: false,
      error: msg,
      ocrProvider: process.env.OCR_PROVIDER || 'document_ai',
      hint: 'Check that all DOCUMENT_AI_* environment variables are set correctly'
    });
  }
});

// Delete multiple cases
app.delete('/api/cases', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'No case IDs provided' });
    }
    await storage.deleteCases(ids);
    console.log('Deleted', ids.length, 'cases');
    res.json({ ok: true, deletedCount: ids.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Mark case complete/active
app.patch('/api/cases/:id/complete', async (req, res) => {
  try {
    const { isComplete } = req.body;
    await storage.markCaseComplete(req.params.id, isComplete === true);
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Reprocess a stuck case (re-run analysis on existing documents)
app.post('/api/cases/:id/reprocess', async (req, res) => {
  try {
    const caseId = req.params.id;
    const caseData = await storage.getCaseWithDetails(caseId);
    
    if (!caseData) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }
    
    if (caseData.documents.length === 0) {
      return res.status(400).json({ ok: false, error: 'No documents to reprocess' });
    }
    
    // Mark as processing
    await storage.updateCaseStatus(caseId, 'processing');
    
    // Read PDF files and rerun analysis
    const pdfBuffers: Buffer[] = [];
    for (const doc of caseData.documents) {
      const pdfPath = path.join(process.cwd(), (doc.uploadPath || '').replace(/^\//, ''));
      if (fs.existsSync(pdfPath)) {
        pdfBuffers.push(fs.readFileSync(pdfPath));
      }
    }
    
    if (pdfBuffers.length === 0) {
      await storage.updateCaseStatus(caseId, 'flagged');
      return res.status(400).json({ ok: false, error: 'PDF files not found on disk' });
    }
    
    res.json({ ok: true, message: 'Reprocessing started' });
    
    // Run analysis in background (same logic as upload)
    runAnalysis({ persist: true, pdfBuffers })
      .then(async (analysis) => {
        if (analysis && typeof analysis === 'object') {
          const analysisObj = analysis as any;
          console.log('Reprocess analysis completed');
          
          const sanitize = (s: string): string => 
            (s || '').replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();
          
          const rawNarrative = analysisObj.narrative || '';
          const narrative = sanitize(rawNarrative);
          const docSummaries = analysisObj.documents as any[] || [];
          
          const readableChars = narrative.replace(/[^a-zA-Z0-9\s.,!?;:'"()-]/g, '').length;
          const isReadable = narrative.length > 0 && (readableChars / narrative.length) > 0.5;
          
          let summary: string;
          if (isReadable && narrative.length > 50) {
            summary = sanitize(narrative.slice(0, 500)) + (narrative.length > 500 ? '...' : '');
          } else if (docSummaries.length > 0) {
            const totalPages = docSummaries.reduce((acc: number, d: any) => acc + (d.pageCount || 0), 0);
            const totalChars = docSummaries.reduce((acc: number, d: any) => acc + (d.textLength || 0), 0);
            summary = `Analyzed ${docSummaries.length} document(s) with ${totalPages} page(s), ${totalChars} characters extracted.`;
          } else {
            summary = 'Document analysis complete. Awaiting manual review.';
          }
          
          const priors = analysisObj.priors;
          let criminalHistorySummary = 'No prior offenses found in documents.';
          if (priors && typeof priors === 'object' && 'incidents' in priors) {
            const priorsObj = priors as any;
            if (priorsObj.chargeCount > 0) {
              const summaryParts: string[] = [];
              for (const incident of (priorsObj.incidents || []).slice(0, 3)) {
                for (const charge of (incident.charges || []).slice(0, 2)) {
                  summaryParts.push(`${sanitize(charge.dateOfArrest || 'Unknown')}: ${sanitize(charge.chargeText?.slice(0, 60) || 'Unknown')}`);
                  if (summaryParts.length >= 3) break;
                }
                if (summaryParts.length >= 3) break;
              }
              criminalHistorySummary = summaryParts.join('; ');
            }
          }
          
          await storage.updateCaseSummary(caseId, sanitize(summary), sanitize(criminalHistorySummary));
          
          // Update identity - search full text first (includes case number header), then narrative
          const fullText = sanitize(analysisObj.fullText || '');
          const textsToSearch = fullText.length > 100 ? [fullText, narrative] : [narrative];
          
          for (const textToSearch of textsToSearch) {
            if (textToSearch.length < 50) continue;
            const extractedIdentity = parseIdentityFromText(textToSearch);
            
            if (extractedIdentity.defendantName || extractedIdentity.caseNumber) {
              await storage.updateCaseIdentity(caseId, extractedIdentity.defendantName, extractedIdentity.caseNumber);
              if (extractedIdentity.bookedIntoJail !== null) {
                await storage.updateCaseBookedIntoJail(caseId, extractedIdentity.bookedIntoJail);
              }
              break; // Stop after first successful extraction
            }
          }
          
          // Delete existing violations and recreate from fresh analysis
          await storage.deleteViolationsForCase(caseId);
          
          // Extract charges from full text (includes OCR output with charge section)
          const screeningCharges = extractChargesFromScreeningSheet(fullText);
          console.log('Extracted charges from reprocess:', screeningCharges);
          
          if (screeningCharges.length > 0) {
            // Look up statute text for each charge
            const violationsToCreate = await Promise.all(screeningCharges.map(async charge => {
              const isUtahCode = charge.code.startsWith('76') || charge.code.match(/^\d{2}-\d/);
              const source = isUtahCode ? 'Utah State Code' as const : 'West Valley City Code' as const;
              
              // Fetch statute text
              let statuteText: string | null = null;
              let statuteUrl: string | null = null;
              try {
                const lookup = isUtahCode 
                  ? await lookupUtahCode(charge.code)
                  : await lookupWvcCode(charge.code);
                if (lookup.ok) {
                  // Trim to first 2000 chars for storage
                  const newStatuteText = lookup.text.slice(0, 2000);
                  // Secondary validation: reject navigation HTML that somehow slipped through
                  // Use jurisdiction-aware validation (WVC statutes may be shorter)
                  const jurisdiction = isUtahCode ? 'UT' : 'WVC';
                  if (!isValidStatuteTextAny(newStatuteText, jurisdiction)) {
                    console.log(`[WARN] Statute text for ${charge.code} (${jurisdiction}) failed secondary validation - not storing`);
                  } else if (statuteText && statuteText !== newStatuteText) {
                    console.log(`[WARN] statuteText for ${charge.code} would be overwritten - keeping original`);
                  } else {
                    statuteText = newStatuteText;
                    statuteUrl = lookup.url;
                    console.log(`[INFO] statuteText SET for ${charge.code}: ${statuteText.slice(0, 80)}... (${statuteText.length} chars)`);
                  }
                } else {
                  console.log(`[WARN] Statute lookup failed for ${charge.code}: ${lookup.reason}`);
                }
              } catch (err) {
                console.error(`Error fetching statute for ${charge.code}:`, err);
              }
              
              return {
                caseId,
                code: charge.code,
                chargeName: charge.chargeName,
                chargeClass: charge.chargeClass,
                chargeType: 'current' as const,
                source,
                description: 'Charge extracted from screening sheet',
                statuteText,
                statuteUrl,
                criteria: ['Manual review required'],
                isViolated: false,
                confidence: 0.5,
                reasoning: 'Review case synopsis against statute elements',
                evidence: 'See case synopsis',
              };
            }));
            await storage.createViolations(violationsToCreate);
            console.log(`Created ${violationsToCreate.length} violations for case ${caseId}`);
          }
          
          await storage.updateCaseStatus(caseId, 'completed');
          console.log(`Case ${caseId} reprocessing completed`);
        } else {
          await storage.updateCaseSummary(caseId, 'Reprocessing complete - no structured data found.', 'No criminal history detected.');
          await storage.updateCaseStatus(caseId, 'completed');
        }
      })
      .catch((err) => {
        console.error('Reprocess analysis failed:', err);
        storage.updateCaseSummary(caseId, `Reprocess error: ${err instanceof Error ? err.message : 'Unknown'}`, '')
          .then(() => storage.updateCaseStatus(caseId, 'flagged'))
          .catch(console.error);
      });
      
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Shared handler for statute lookup
async function handleStatuteLookup(citation: string, jurisdiction: string, res: Response) {
  console.log(`[INFO] Statute lookup requested: citation=${citation}, jurisdiction=${jurisdiction}`);
  
  // Look up statute based on jurisdiction
  const isUtahCode = jurisdiction.toLowerCase() === 'ut' || jurisdiction.toLowerCase() === 'utah' || citation.match(/^\d{2,3}[a-z]?-\d/i);
  const lookup = isUtahCode 
    ? await lookupUtahCode(citation)
    : await lookupWvcCode(citation);
  
  if (!lookup.ok) {
    console.log(`[WARN] Statute lookup failed: citation=${citation}, reason=${lookup.reason}`);
    return res.status(404).json({ 
      ok: false, 
      error: `Statute not found: ${lookup.details}`,
      citation,
      reason: lookup.reason
    });
  }
  
  console.log(`[INFO] Statute lookup success: citation=${citation}, ${lookup.text.length} chars`);
  
  // Return clean statute data - never raw HTML
  // TEMPORARY: Add proof marker to verify UI is using API data
  res.json({
    ok: true,
    citation: lookup.citation,
    title: lookup.title,
    statuteText: `__STATUTE_API_PROOF__ ${lookup.citation}\n\n${lookup.text}`,
    sourceUrl: lookup.url,
    source: lookup.source,
    fetchedAt: lookup.fetchedAtIso,
    cached: lookup.cached || false
  });
}

// Get statute text by citation - path-based endpoint: /api/statutes/ut/58-37-8
app.get('/api/statutes/:jurisdiction/:citation', async (req, res) => {
  try {
    const citation = req.params.citation;
    const jurisdiction = req.params.jurisdiction;
    
    if (!citation) {
      return res.status(400).json({ ok: false, error: 'Citation parameter required' });
    }
    
    await handleStatuteLookup(citation, jurisdiction, res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.log(`[ERROR] Statute lookup exception: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

// Get statute text by citation - query-based endpoint (legacy): /api/statutes?citation=58-37-8
app.get('/api/statutes', async (req, res) => {
  try {
    const citation = req.query.citation as string;
    const jurisdiction = (req.query.jurisdiction as string) || 'utah';
    
    if (!citation) {
      return res.status(400).json({ ok: false, error: 'Citation parameter required' });
    }
    
    await handleStatuteLookup(citation, jurisdiction, res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.log(`[ERROR] Statute lookup exception: ${msg}`);
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

    // Log statute text status for each violation
    console.log(`[API] GET /api/cases/${caseId} - violations=${caseData.violations.length}`);
    caseData.violations.forEach((v, i) => {
      const hasText = !!v.statuteText;
      const hasUrl = !!v.statuteUrl;
      const preview = v.statuteText ? v.statuteText.slice(0, 50) : 'NULL';
      console.log(`  [V${i}] ${v.code}: hasStatuteText=${hasText}, hasStatuteUrl=${hasUrl}, preview="${preview}..."`);
    });

    res.json({ ok: true, case: caseData });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Upload and analyze PDFs
app.post('/api/cases/upload', upload.array('pdfs', 10) as unknown as RequestHandler, async (req: Request, res: Response) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, error: 'No PDFs uploaded.' });
    }

    const createdCaseIds: string[] = [];

    for (const f of files) {
      const pdfBytes = fs.readFileSync(f.path);
      const { text } = await extractPdfText(pdfBytes);

      const parsed = parseIdentity(text);
      
      // Try to extract defendant name from filename if not found in text
      // Filename format: "Last, First.pdf" or "Last, First3.pdf"
      let defendantNameFromFile: string | null = null;
      if (!parsed.defendantName) {
        const filenameWithoutExt = f.originalname.replace(/\.pdf$/i, '');
        // Remove trailing numbers (like "White, Dave3" -> "White, Dave")
        const cleanedName = filenameWithoutExt.replace(/\d+$/, '').trim();
        // Check if it looks like a name (contains comma for "Last, First" format)
        if (cleanedName.includes(',') && cleanedName.length > 3) {
          defendantNameFromFile = cleanedName;
          console.log(`Extracted defendant name from filename: ${defendantNameFromFile}`);
        }
      }
      
      // Explicitly set all fields to avoid relying on database defaults
      const caseData = {
        caseNumber: parsed.caseNumber || 'Unknown',
        defendantName: parsed.defendantName || defendantNameFromFile || 'Unknown',
        defendantDOB: null,
        status: 'processing' as const,
        summary: null,
        criminalHistorySummary: null,
        isMarkedComplete: false,
        bookedIntoJail: parsed.bookedIntoJail ?? null,
      };
      
      console.log('[UPLOAD] Creating case with explicit values:', JSON.stringify(caseData));
      
      const newCase = await storage.createCase(caseData);
      
      console.log('Case created successfully:', newCase.id);

      createdCaseIds.push(newCase.id);

      const caseDir = path.join(getUploadDir(), 'cases', newCase.id);
      fs.mkdirSync(caseDir, { recursive: true });

      const storedName = `${newCase.id}.pdf`;
      const storedPath = path.join(caseDir, storedName);
      fs.copyFileSync(f.path, storedPath);

      console.log('Creating document for case:', newCase.id);
      try {
        // Sanitize extracted text - remove null bytes and non-printable characters
        const sanitizedText = (text || '')
          .replace(/\x00/g, '')  // Remove null bytes
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove non-printable control chars
        
        await storage.createDocument({
          caseId: newCase.id,
          filename: f.originalname,
          uploadPath: `/uploads/cases/${newCase.id}/${storedName}`,
          extractedText: sanitizedText,
        });
        console.log('Document created successfully');
      } catch (docErr) {
        console.error('Document creation failed:', docErr);
        throw docErr;
      }

      // Run analysis in background
      runAnalysis({ persist: true, pdfBuffers: [pdfBytes] })
        .then(async (analysis) => {
          if (analysis && typeof analysis === 'object') {
            const analysisObj = analysis as any;
            console.log('Analysis completed:', JSON.stringify(analysisObj, null, 2).slice(0, 1000));

            // Sanitize function to remove null bytes and non-printable chars
            const sanitize = (s: string): string => 
              (s || '').replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();
            
            // Build summary from Case Synopsis or Officer's Actions section ONLY
            const rawNarrative = analysisObj.narrative || '';
            const narrative = sanitize(rawNarrative);
            const docSummaries = analysisObj.documents as any[] || [];
            const fullText = sanitize(analysisObj.fullText || '');
            
            // Check if narrative is mostly readable text (not binary garbage)
            const readableChars = narrative.replace(/[^a-zA-Z0-9\s.,!?;:'"()-]/g, '').length;
            const isReadable = narrative.length > 0 && (readableChars / narrative.length) > 0.5;
            
            // Extract proper Case Synopsis or Officer's Actions section
            let summary: string;
            const extractedSynopsis = extractCaseSynopsis(fullText);
            
            if (extractedSynopsis) {
              summary = sanitize(extractedSynopsis);
            } else if (isReadable && narrative.length > 50) {
              // Fallback: use narrative but strip criminal history mentions
              const cleanedNarrative = narrative
                .replace(/Criminal\s+history\s*[-–:].*/gi, '')
                .replace(/\d+\s+arrests?\.?\s*Convictions?:.*/gi, '')
                .trim();
              summary = sanitize(cleanedNarrative.slice(0, 500)) + (cleanedNarrative.length > 500 ? '...' : '');
            } else if (docSummaries.length > 0) {
              const totalPages = docSummaries.reduce((acc: number, d: any) => acc + (d.pageCount || 0), 0);
              const totalChars = docSummaries.reduce((acc: number, d: any) => acc + (d.textLength || 0), 0);
              
              // Check if text extraction failed (scanned PDF without OCR)
              if (!isReadable && totalChars > 1000) {
                summary = `This appears to be a scanned PDF (${totalPages} pages). OCR is required to extract text from scanned documents. Please configure OCR or upload a text-based PDF.`;
              } else {
                summary = `Analyzed ${docSummaries.length} document(s) with ${totalPages} page(s), ${totalChars} characters extracted.`;
              }
            } else {
              summary = 'Document analysis complete. Awaiting manual review.';
            }

            // Criminal history summary will be built from clean structured records later
            // (after recordsToCreate is populated) - not from raw priors object
            const priors = analysisObj.priors;
            let criminalHistorySummaryDefault = !isReadable 
              ? 'Unable to extract criminal history from scanned document. OCR required.'
              : 'No prior offenses found in documents.';

            // Always try to extract defendant name, case number, and booked into jail from text
            // Try fullText first (includes case number header), then narrative
            // (fullText was already defined above for synopsis extraction)
            const textsToTry = fullText.length > 100 ? [fullText, narrative] : [narrative];
            
            for (const textToSearch of textsToTry) {
              if (textToSearch.length < 50) continue;
              const extractedIdentity = parseIdentityFromText(textToSearch);
              console.log('Extracted identity from text:', extractedIdentity, 'text length:', textToSearch.length);
              
              if (extractedIdentity.defendantName || extractedIdentity.caseNumber) {
                console.log('Updating case identity from analysis:', extractedIdentity);
                await storage.updateCaseIdentity(
                  newCase.id, 
                  extractedIdentity.defendantName, 
                  extractedIdentity.caseNumber
                );
              }
              // Update booked into jail field
              if (extractedIdentity.bookedIntoJail !== null) {
                await storage.updateCaseBookedIntoJail(newCase.id, extractedIdentity.bookedIntoJail);
              }
              // If we found anything useful, stop trying more texts
              if (extractedIdentity.defendantName || extractedIdentity.caseNumber || extractedIdentity.bookedIntoJail !== null) {
                break;
              }
            }

            // Extract charges from Patrol Screening Sheet - use fullText which contains the screening section
            const screeningCharges = extractChargesFromScreeningSheet(fullText);
            console.log('Extracted screening charges:', screeningCharges.length, 'charges from fullText');
            
            // Map citations to violations with statute text
            const citations = analysisObj.citations as any[] || [];
            const elements = analysisObj.elements as any[] || [];
            const statutes = analysisObj.statutes as any[] || [];
            const violationsToCreate: any[] = [];
            
            // Create a map of code to statute for quick lookup
            const statuteMap = new Map<string, string>();
            const statuteUrlMap = new Map<string, string>();
            const statuteTitleMap = new Map<string, string>();
            for (const st of statutes) {
              if (st && st.code && st.text) {
                statuteMap.set(st.code, st.text);
              }
              if (st && st.code && st.url) {
                statuteUrlMap.set(st.code, st.url);
              }
              if (st && st.code && st.title) {
                statuteTitleMap.set(st.code, st.title);
              }
            }
            
            // Match screening charges with statute analysis
            for (const charge of screeningCharges) {
              const matchingElement = elements.find((el: any) => 
                el.code && (el.code === charge.code || el.code.includes(charge.code) || charge.code.includes(el.code))
              );
              
              const statuteText = statuteMap.get(charge.code) || null;
              const statuteUrlVal = statuteUrlMap.get(charge.code) || null;
              const result = matchingElement?.result || {};
              const elems = result.elements || [];
              const overallMet = result.overall === 'met';
              
              violationsToCreate.push({
                caseId: newCase.id,
                code: charge.code,
                chargeName: charge.chargeName,
                chargeClass: charge.chargeClass,
                chargeType: 'current' as const,
                source: charge.code.startsWith('76') || charge.code.match(/^\d{2}-\d/) ? 'Utah State Code' as const : 'West Valley City Code' as const,
                description: matchingElement ? 'Automated element analysis' : 'Charge extracted from screening sheet',
                statuteText: statuteText ? sanitize(statuteText.slice(0, 2000)) : null,
                statuteUrl: statuteUrlVal,
                criteria: elems.length > 0 ? elems.map((e: any) => e.element || 'Element').slice(0, 5) : ['Manual review required'],
                isViolated: overallMet,
                confidence: overallMet ? 0.8 : (matchingElement ? 0.5 : 0.3),
                reasoning: result.notes?.join(' ') || 'Review case synopsis against statute elements',
                evidence: elems.slice(0, 2).map((e: any) => e.evidenceSnippets?.join(' ') || '').join(' | ') || 'See case synopsis',
              });
            }
            
            // If no screening charges found, fall back to element-level analysis
            // Note: These may include criminal history citations, so mark as historical since we can't reliably distinguish
            if (violationsToCreate.length === 0 && elements.length > 0) {
              for (const el of elements) {
                const result = el.result || {};
                const elems = result.elements || [];
                const statuteText = statuteMap.get(el.code) || null;
                const statuteUrlEl = statuteUrlMap.get(el.code) || null;
                const statuteTitle = statuteTitleMap.get(el.code) || null;
                
                violationsToCreate.push({
                  caseId: newCase.id,
                  code: el.code || 'Unknown',
                  chargeName: statuteTitle,
                  chargeClass: null,
                  chargeType: 'historical' as const,
                  source: el.jurisdiction === 'WVC' ? 'West Valley City Code' as const : 'Utah State Code' as const,
                  description: 'Element analysis (fallback - no charge table found)',
                  statuteText: statuteText ? sanitize(statuteText.slice(0, 2000)) : null,
                  statuteUrl: statuteUrlEl,
                  criteria: elems.length > 0 ? elems.map((e: any) => e.element).slice(0, 5) : ['Requires manual review'],
                  isViolated: result.overall === 'met',
                  confidence: result.overall === 'met' ? 0.8 : 0.4,
                  reasoning: result.notes?.join(' ') || 'Automated screening analysis - manual review recommended',
                  evidence: elems.slice(0, 2).map((e: any) => e.evidenceSnippets?.join(' ') || '').join(' | ') || 'See original document for details',
                });
              }
            }
            
            // If still no violations but citations found, create from citations
            // Note: These are fallback citations which may be from criminal history, so mark as historical
            if (violationsToCreate.length === 0 && citations.length > 0) {
              for (const c of citations) {
                const statuteText = statuteMap.get(c.normalizedKey) || null;
                const statuteUrlCit = statuteUrlMap.get(c.normalizedKey) || null;
                const statuteTitleCit = statuteTitleMap.get(c.normalizedKey) || null;
                violationsToCreate.push({
                  caseId: newCase.id,
                  code: c.normalizedKey || c.raw || 'Unknown',
                  chargeName: statuteTitleCit,
                  chargeClass: null,
                  chargeType: 'historical' as const,
                  source: c.jurisdiction === 'WVC' ? 'West Valley City Code' as const : 'Utah State Code' as const,
                  description: `Code citation detected: ${c.raw || c.normalizedKey}`,
                  statuteText: statuteText ? sanitize(statuteText.slice(0, 2000)) : null,
                  statuteUrl: statuteUrlCit,
                  criteria: ['Citation found in document - manual review required'],
                  isViolated: false,
                  confidence: 0.5,
                  reasoning: 'Citation detected in document, requires manual review to assess applicability',
                  evidence: `Found in extracted text: ${c.raw || c.normalizedKey}`,
                });
              }
            }
            
            if (violationsToCreate.length > 0) {
              await storage.createViolations(violationsToCreate);
            }

            // Map priors to criminal records - priors is a PriorsSummary object, not an array
            const recordsToCreate: Array<{
              caseId: string;
              date: string;
              offense: string;
              disposition: string;
              jurisdiction: string;
            }> = [];
            
            if (priors && typeof priors === 'object' && 'incidents' in priors) {
              const priorsObj = priors as { incidents: Array<{ incidentLabel: string; charges: Array<{ dateOfArrest: string | null; chargeText: string; offenseTrackingNumber: string | null }> }> };
              for (const incident of priorsObj.incidents || []) {
                for (const charge of incident.charges || []) {
                  recordsToCreate.push({
                    caseId: newCase.id,
                    date: charge.dateOfArrest || 'Unknown',
                    offense: charge.chargeText || 'Unknown',
                    disposition: 'See record',
                    jurisdiction: 'Utah',
                  });
                }
              }
            } else if (Array.isArray(priors)) {
              // Fallback for array format
              for (const p of priors) {
                recordsToCreate.push({
                  caseId: newCase.id,
                  date: p.date || p.dateOfArrest || 'Unknown',
                  offense: p.offense || p.charge || p.chargeText || 'Unknown',
                  disposition: p.disposition || 'See record',
                  jurisdiction: p.jurisdiction || p.court || 'Utah',
                });
              }
            }

            // Build criminal history summary from structured records (clean data)
            let finalCriminalHistorySummary = criminalHistorySummaryDefault;
            
            if (recordsToCreate.length > 0) {
              await storage.createCriminalRecords(recordsToCreate);
              console.log(`Created ${recordsToCreate.length} criminal records for case ${newCase.id}`);
              
              // Build clean summary from structured records
              const cleanSummaryParts: string[] = [];
              for (const record of recordsToCreate.slice(0, 3)) {
                const date = record.date !== 'Unknown' ? record.date : '';
                const offense = record.offense.slice(0, 60);
                cleanSummaryParts.push(date ? `${date}: ${offense}` : offense);
              }
              const remainingCount = recordsToCreate.length - cleanSummaryParts.length;
              finalCriminalHistorySummary = cleanSummaryParts.join('; ') + 
                (remainingCount > 0 ? ` (+${remainingCount} more records)` : '');
            }
            
            // Single update with clean summary and criminal history
            await storage.updateCaseSummary(newCase.id, sanitize(summary), sanitize(finalCriminalHistorySummary));

            // Save extracted images from PDFs
            const extractedImages = analysisObj.extractedImages as Array<{ mimeType: string; imageData: string; pageNumber: number | null }> || [];
            if (extractedImages.length > 0) {
              const imagesToCreate = extractedImages.slice(0, 20).map((img, idx) => ({
                caseId: newCase.id,
                documentId: null,
                filename: `extracted-image-${idx + 1}.${img.mimeType === 'image/png' ? 'png' : 'jpg'}`,
                mimeType: img.mimeType,
                imageData: img.imageData,
                pageNumber: img.pageNumber,
              }));
              await storage.createCaseImages(imagesToCreate);
              console.log(`Saved ${imagesToCreate.length} extracted images for case ${newCase.id}`);
            }

            // Always update status to completed after processing
            await storage.updateCaseStatus(newCase.id, 'completed');
            console.log(`Case ${newCase.id} analysis saved with ${violationsToCreate.length} violations, ${recordsToCreate.length} criminal records`);
          } else {
            // Even if analysis returns nothing useful, mark completed
            await storage.updateCaseSummary(newCase.id, 'Analysis complete - no structured data found.', 'No criminal history detected.');
            await storage.updateCaseStatus(newCase.id, 'completed');
          }
        })
        .catch((err) => {
          console.error('Analysis failed:', err);
          // Mark as completed with error note rather than flagged
          storage.updateCaseSummary(newCase.id, `Analysis error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'Unable to analyze criminal history.')
            .then(() => storage.updateCaseStatus(newCase.id, 'flagged'))
            .catch(console.error);
        });

      fs.unlinkSync(f.path);
    }

    res.json({ ok: true, caseIds: createdCaseIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Serve client build if present
const clientDist = path.join(process.cwd(), '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
}

const port = Number(process.env.PORT ?? '5000');
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on ${port}`);
});
