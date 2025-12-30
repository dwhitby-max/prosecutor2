import express, { Request, Response, RequestHandler } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { storage } from '../../storage.js';
import { extractPdfText } from '../analysis/pdf.js';
import { runAnalysis, extractCaseSynopsis, stripCriminalHistory } from '../analysis/evaluate.js';
import { generateFullLegalAnalysis, summarizeOfficerActions } from '../analysis/legalAnalysis.js';
import { isAuthenticated, getCurrentUser } from '../../replit_integrations/auth/index.js';
import { User as AppUser } from '../../../shared/schema.js';

interface CaseListItem {
  id: string;
  caseNumber: string;
  defendantName: string;
  status: string;
  uploadDate: Date;
  isMarkedComplete: boolean;
  companyId: string | null;
  uploadedByUserId: string | null;
  assignedToUserId: string | null;
}

interface AuthenticatedRequest extends Request {
  currentUser?: AppUser;
}
import type { 
  AnalysisCitation, 
  AnalysisElement, 
  AnalysisElementResult,
  AnalysisStatute, 
  AnalysisDocumentSummary,
  ViolationToCreate,
  AnalysisResult,
  PriorsSummary,
  ExtractedImage
} from '../../../shared/schema.js';

export const casesRouter = express.Router();

const serverUploadsDir = path.join(process.cwd(), 'server', 'uploads');
const rootUploadsDir = path.join(process.cwd(), 'uploads');
const uploadsDir = fs.existsSync(path.join(serverUploadsDir, 'cases')) ? serverUploadsDir : rootUploadsDir;
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(uploadsDir, 'cases'), { recursive: true });

const upload = multer({ dest: path.join(uploadsDir, 'tmp') });

function getUploadDir(): string {
  return uploadsDir;
}

function getLastName(defendantName: string): string {
  const parts = defendantName.split(',');
  return (parts[0] || defendantName).trim().toLowerCase();
}

function formatDefendantName(firstName: string, lastName: string): string {
  return `${lastName.trim()}, ${firstName.trim()}`;
}

function parseIdentity(text: string): { caseNumber: string | null; defendantName: string | null; bookedIntoJail: boolean | null } {
  let caseNumber: string | null = null;
  const casePatterns = [
    /\bWV\d{2}[-]\d{5,6}\b/i,
    /Case\s*#\s*:?\s*(WV\d{2}[-]\d{5,6})/i,
    /Case\s*#\s*:?\s*(\d{4}[\-]\d{5})/i,
    /Case\s*#\s*:?\s*(\d{2}[\-]\d{5})/i,
    /Case\s+(\d{4}[\-]\d{5})/i,
    /Case\s+(\d{2}[\-]\d{5})/i,
    /Police\s+Case[:\s#]*(\d{2,4}[\-\/]\d+)/i,
    /Case\s*(?:No\.?|Number)[:\s]*(\d{2,4}[\-\/]\d+)/i,
    /(\d{4}[\-]\d{5})/,
  ];
  
  for (const pattern of casePatterns) {
    const match = text.match(pattern);
    if (match) {
      const captured = match[1] || match[0];
      if (captured && captured.length >= 6) {
        caseNumber = captured.trim();
        break;
      }
    }
  }

  let defendantName: string | null = null;
  const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'II', 'III', 'IV'];
  
  const nameStopwords = ['AUTHORIZED', 'PERSON', 'OFFICER', 'ADDRESS', 'PHONE', 'DOB', 'DATE', 'CASE', 'CHARGE', 'AGENCY', 'LAW', 'THE', 'AND', 'FOR', 'WITH', 'FROM', 'INTO', 'UPON', 'HORIZED', 'IZED'];
  
  const cleanName = (name: string): string => {
    let cleaned = name
      .split(/[\n\r]/)[0]
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z\s,.\-']/g, '')
      .trim();
    
    for (const stopword of nameStopwords) {
      const stopIdx = cleaned.toUpperCase().indexOf(stopword);
      if (stopIdx > 0) {
        cleaned = cleaned.substring(0, stopIdx).trim();
      }
    }
    
    cleaned = cleaned.replace(/\s+$/, '').replace(/,\s*$/, '');
    
    return cleaned;
  };
  
  const formatAsLastFirst = (name: string): string | null => {
    const cleaned = cleanName(name);
    if (!cleaned || cleaned.length < 3) return null;
    
    if (cleaned.includes(',')) {
      return cleaned;
    }
    
    const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
    if (parts.length < 2) return null;
    
    let suffix = '';
    let lastNameIdx = parts.length - 1;
    if (suffixes.includes(parts[lastNameIdx]) || suffixes.includes(parts[lastNameIdx] + '.')) {
      suffix = ' ' + parts[lastNameIdx];
      lastNameIdx--;
    }
    
    if (lastNameIdx >= 1) {
      const lastName = parts[lastNameIdx];
      const firstName = parts.slice(0, lastNameIdx).join(' ');
      return `${lastName}, ${firstName}${suffix}`;
    }
    return null;
  };
  
  const utahNamePatterns = [
    /NAME\s+USED\s+AT\s+ARREST[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:AGENCY|CHARGE|DATE|\n|$))/i,
    /NAME\s+USED\s+AT\s+COURT[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:LAW|AGENCY|DATE|\n|$))/i,
    /(?:TRUE\s+NAME|FULL\s+NAME|LEGAL\s+NAME)[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:DOB|DATE|ALIAS|\n|$))/i,
    /ARRESTEE[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:DOB|DATE|ADDRESS|AGE|\n|$))/i,
    /(?:^|\n)SUBJECT[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:DOB|DATE|ADDRESS|AGE|\n|$))/i,
    /SUSPECT\s+NAME[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:DOB|DATE|ADDRESS|AGE|\n|$))/i,
    /DEFENDANT[:\s]+([A-Za-z][A-Za-z\-'\.\s,]+?)(?=\s*(?:DOB|DATE|ADDRESS|CASE|\n|$))/i,
  ];
  
  const isOfficerRelatedName = (matchContext: string): boolean => {
    const officerPatterns = [
      /OFFICER\s*NAME/i,
      /ARRESTING\s+OFFICER/i,
      /OFFICER[:\s]/i,
      /DEPUTY\s+NAME/i,
      /DEPUTY[:\s]/i,
      /REPORTING\s+OFFICER/i,
      /INVESTIGATING\s+OFFICER/i,
    ];
    return officerPatterns.some(p => p.test(matchContext));
  };
  
  for (const pattern of utahNamePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const matchIndex = match.index || 0;
      const contextStart = Math.max(0, matchIndex - 30);
      const contextEnd = Math.min(text.length, matchIndex + 30);
      const matchContext = text.substring(contextStart, contextEnd);
      
      if (isOfficerRelatedName(matchContext)) {
        console.log(`[parseIdentity] Skipping officer-related match: ${match[1]}`);
        continue;
      }
      
      const formatted = formatAsLastFirst(match[1]);
      if (formatted && formatted.length >= 5) {
        defendantName = formatted;
        console.log(`[parseIdentity] Found defendant name using Utah pattern: ${defendantName}`);
        break;
      }
    }
  }
  
  if (!defendantName) {
    const lastFirstMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.]+),\s*([A-Z][a-zA-Z\-'\.\s]+)/i);
    if (lastFirstMatch) {
      const lastName = lastFirstMatch[1].trim();
      const firstName = lastFirstMatch[2].trim();
      defendantName = `${lastName}, ${firstName}`;
    } else {
      const nameBlockMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.\s]+?)(?=\s*(?:DOB|Date|Address|Case|\n|$))/i);
      if (nameBlockMatch && nameBlockMatch[1]) {
        const formatted = formatAsLastFirst(nameBlockMatch[1]);
        if (formatted) {
          defendantName = formatted;
        }
      }
    }
  }
  
  let bookedIntoJail: boolean | null = null;
  const yesPatterns = [
    /BOOKED\s+INTO\s+JAIL[:\s]*(?:\[?X\]?|YES)/i,
    /\[X\]\s*BOOKED\s+INTO\s+JAIL/i,
    /JAIL[:\s]*YES/i,
  ];
  const noPatterns = [
    /BOOKED\s+INTO\s+JAIL[:\s]*(?:\[\s*\]|NO)/i,
    /\[\s*\]\s*BOOKED\s+INTO\s+JAIL/i,
    /JAIL[:\s]*NO/i,
  ];
  
  for (const pattern of yesPatterns) {
    if (pattern.test(text)) {
      bookedIntoJail = true;
      break;
    }
  }
  if (bookedIntoJail === null) {
    for (const pattern of noPatterns) {
      if (pattern.test(text)) {
        bookedIntoJail = false;
        break;
      }
    }
  }
  
  return { caseNumber, defendantName, bookedIntoJail };
}

function parseIdentityFromText(text: string): { caseNumber: string | null; defendantName: string | null; bookedIntoJail: boolean | null } {
  return parseIdentity(text);
}

const ocrCorrections: Record<string, string> = {
  '57-37A': '58-37A',
  '57-37a': '58-37a',
  '57-37': '58-37',
};

const knownCharges: Record<string, string> = {
  '58-37-8': 'Prohibited Acts - Controlled Substances',
  '58-37a-5': 'Drug Paraphernalia',
  '76-6-602': 'Retail Theft',
  '76-6-404': 'Theft',
  '76-6-206': 'Criminal Trespass',
  '76-8-305': 'Interference with Arresting Officer',
  '76-9-702': 'Disorderly Conduct',
  '76-10-503': 'Carrying a Concealed Dangerous Weapon',
  '76-5-102': 'Assault',
  '76-5-103': 'Aggravated Assault',
  '41-6a-502': 'DUI',
  '41-6a-517': 'Open Container',
  '41-6a-401.3': 'Failure to Remain at Accident Scene',
  '41-6a-401': 'Duty to Stop at Accident',
  '53-3-217': 'No Valid License in Possession',
  '53-3-227': 'Driving on Suspended License',
  '76-6-408': 'Receiving Stolen Property',
  '76-5-109': 'Child Abuse',
  '76-10-508': 'Discharge of Firearm',
  '41-12a-302': 'No Proof of Insurance',
  '41-1a-1303': 'Driving Without Registration',
  '77-7-21': 'Failure to Appear on Citation',
  '64-13-29': 'Parole Violation',
};

const chargeAbbreviations: Record<string, string> = {
  'RT': 'Retail Theft',
  'PACS': 'Prohibited Acts - Controlled Substances',
  'DP': 'Drug Paraphernalia',
  'DUI': 'Driving Under the Influence',
  'CM': 'Criminal Mischief',
  'DC': 'Disorderly Conduct',
};

const classMap: Record<string, string> = {
  'MB': 'Class B Misdemeanor',
  'MA': 'Class A Misdemeanor',
  'MC': 'Class C Misdemeanor',
  'F3': 'Third Degree Felony',
  'F2': 'Second Degree Felony',
  'F1': 'First Degree Felony',
  'IN': 'Infraction',
};

interface ExtractedCharge {
  code: string;
  chargeName: string;
  chargeClass: string | null;
}

const VALID_UTAH_TITLES = new Set([
  '7', '9', '10', '13', '17', '24', '26', '31A', '32B', '34', '41', '53', '58', '59', 
  '62A', '63', '64', '72', '76', '77', '78A', '78B'
]);

const VALID_SUFFIXES = new Set([
  'MB', 'MA', 'MC', 'F1', 'F2', 'F3', 'IN', 'RT', 'PACS', 'DP', 'DUI', 'CM', 'DC', 
  'RE', 'FA', 'NC', 'PO', 'LI', 'JU', 'NO', 'UT',
  'RETA', 'FAIL', 'NCIC', 'JURI', 'SIGN', 'POSS', 'RECE', 'OPER', 'DRIV', 'REFU',
  'ASSA', 'DISO', 'CRIM', 'BURG', 'ROBB', 'DRUG', 'PARA', 'THEF', 'FORG', 'FRAU'
]);

function isValidChargeCode(title: string, chapter: string, section: string, suffix: string): boolean {
  const titleNum = parseInt(title.replace(/[a-z]/gi, ''), 10);
  const chapterNum = parseInt(chapter.replace(/[a-z]/gi, ''), 10);
  const sectionNum = parseInt(section.replace(/\.\d+$/, ''), 10);
  
  if (chapterNum >= 1 && chapterNum <= 12 && sectionNum >= 1 && sectionNum <= 31) {
    if (sectionNum >= 1900 && sectionNum <= 2099) {
      console.log(`Rejecting date-like code: ${title}-${chapter}-${section}`);
      return false;
    }
  }
  
  if (titleNum >= 100 || (title.length === 3 && !title.match(/\d{2}[a-z]/i))) {
    console.log(`Rejecting invalid title: ${title}-${chapter}-${section}`);
    return false;
  }
  
  const normalizedTitle = title.replace(/^0+/, '').toUpperCase();
  if (!VALID_UTAH_TITLES.has(normalizedTitle) && titleNum < 41) {
    if (titleNum < 7 || (titleNum > 34 && titleNum < 41)) {
      console.log(`Rejecting non-Utah title: ${title}-${chapter}-${section}`);
      return false;
    }
  }
  
  if (chapterNum > 500 || sectionNum > 2000) {
    console.log(`Rejecting phone/invalid number: ${title}-${chapter}-${section}`);
    return false;
  }
  
  if (!VALID_SUFFIXES.has(suffix.toUpperCase())) {
    console.log(`Rejecting unknown suffix: ${title}-${chapter}-${section} (${suffix})`);
    return false;
  }
  
  return true;
}

function extractChargesFromScreeningSheet(text: string): ExtractedCharge[] {
  const charges: ExtractedCharge[] = [];
  const seenCodes = new Set<string>();
  
  const chargeTablePattern = /(\d{2,3}[a-z]?)\s*[-–]\s*(\d{1,4}[a-z]?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*[\(\[]?\s*([A-Z]{2,4})\s*[\)\]]?/gi;
  
  let match;
  while ((match = chargeTablePattern.exec(text)) !== null) {
    let [, title, chapter, section, suffix] = match;
    
    if (!isValidChargeCode(title, chapter, section, suffix)) {
      continue;
    }
    
    let fullCode = `${title}-${chapter}-${section}`;
    
    if (ocrCorrections[fullCode]) {
      console.log(`OCR correction: ${fullCode} -> ${ocrCorrections[fullCode]}`);
      fullCode = ocrCorrections[fullCode];
    } else if (ocrCorrections[`${title}-${chapter}`]) {
      const corrected = ocrCorrections[`${title}-${chapter}`].split('-');
      fullCode = `${corrected[0]}-${corrected[1]}-${section}`;
      console.log(`OCR correction (partial): ${title}-${chapter} -> ${corrected[0]}-${corrected[1]}`);
    }
    
    const normalizedCode = fullCode.toUpperCase();
    
    if (seenCodes.has(normalizedCode)) continue;
    seenCodes.add(normalizedCode);
    
    let chargeClass: string | null = null;
    if (classMap[suffix]) {
      chargeClass = classMap[suffix];
    }
    
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

casesRouter.get('/', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    const filter = (req.query.filter as string) || 'active';
    const authReq = req as AuthenticatedRequest;
    const user = authReq.currentUser;
    
    if (!user) {
      return res.status(401).json({ ok: false, error: 'User not found' });
    }
    
    let caseList: CaseListItem[];
    if (filter === 'completed') {
      caseList = await storage.getCompletedCases();
    } else if (filter === 'all') {
      caseList = await storage.getAllCases();
    } else {
      caseList = await storage.getActiveCases();
    }
    
    if (user.role === 'admin') {
    } else if (user.role === 'company' || user.role === 'services') {
      if (user.companyId) {
        caseList = caseList.filter((c: CaseListItem) => c.companyId === user.companyId);
      } else {
        caseList = caseList.filter((c: CaseListItem) => 
          c.uploadedByUserId === user.id || c.assignedToUserId === user.id
        );
      }
    } else {
      caseList = caseList.filter((c: CaseListItem) => 
        c.assignedToUserId === user.id || c.uploadedByUserId === user.id
      );
    }
    
    caseList.sort((a: CaseListItem, b: CaseListItem) => {
      const lastA = getLastName(a.defendantName);
      const lastB = getLastName(b.defendantName);
      return lastA.localeCompare(lastB);
    });
    
    console.log('Returning', caseList.length, filter, 'cases for user', user.id, 'role:', user.role);
    res.json({ ok: true, cases: caseList });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('Error getting cases:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

casesRouter.delete('/', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
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

casesRouter.patch('/:id/complete', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
  try {
    const { isComplete } = req.body;
    await storage.markCaseComplete(req.params.id, isComplete === true);
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

casesRouter.patch('/:id/assign', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
  try {
    const { assignedToUserId } = req.body;
    const caseId = req.params.id;
    
    const caseRecord = await storage.getCase(caseId);
    if (!caseRecord) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }
    
    await storage.assignCaseToUser(caseId, assignedToUserId || null);
    res.json({ ok: true, message: 'Case assigned successfully' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

casesRouter.post('/:id/reprocess', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
  try {
    const caseId = req.params.id;
    const caseData = await storage.getCaseWithDetails(caseId);
    
    if (!caseData) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }
    
    if (caseData.documents.length === 0) {
      return res.status(400).json({ ok: false, error: 'No documents to reprocess' });
    }
    
    await storage.updateCaseStatus(caseId, 'processing');
    
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
    
    runAnalysis({ persist: true, pdfBuffers })
      .then(async () => {
        await storage.updateCaseStatus(caseId, 'completed');
        console.log(`Reprocessing complete for case ${caseId}`);
      })
      .catch(async (err) => {
        console.error('Reprocessing failed:', err);
        await storage.updateCaseStatus(caseId, 'flagged');
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

casesRouter.get('/:id', isAuthenticated, getCurrentUser, async (req: Request, res: Response) => {
  try {
    const caseId = req.params.id;
    const authReq = req as AuthenticatedRequest;
    const user = authReq.currentUser;
    
    if (!user) {
      return res.status(401).json({ ok: false, error: 'User not found' });
    }
    
    const caseData = await storage.getCaseWithDetails(caseId);
    
    if (!caseData) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }
    
    const hasAccess = 
      user.role === 'admin' ||
      (user.role === 'company' && user.companyId && caseData.companyId === user.companyId) ||
      (user.role === 'services' && user.companyId && caseData.companyId === user.companyId) ||
      caseData.assignedToUserId === user.id ||
      caseData.uploadedByUserId === user.id;
    
    if (!hasAccess) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }

    console.log(`[API] GET /api/cases/${caseId} - violations=${caseData.violations.length}`);
    caseData.violations.forEach((v, i) => {
      const hasText = !!v.statuteText;
      const hasUrl = !!v.statuteUrl;
      const preview = v.statuteText ? v.statuteText.slice(0, 50) : 'NULL';
      console.log(`  [V${i}] ${v.code}: hasStatuteText=${hasText}, hasStatuteUrl=${hasUrl}, preview="${preview}..."`);
    });

    const cleanedCaseData = {
      ...caseData,
      summary: caseData.summary ? stripCriminalHistory(caseData.summary) : caseData.summary,
      caseSummaryNarrative: caseData.caseSummaryNarrative ? stripCriminalHistory(caseData.caseSummaryNarrative) : caseData.caseSummaryNarrative,
      rawOfficerActions: caseData.rawOfficerActions ? stripCriminalHistory(caseData.rawOfficerActions) : caseData.rawOfficerActions,
    };

    res.json({ ok: true, case: cleanedCaseData });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

casesRouter.post('/upload', isAuthenticated, getCurrentUser, upload.array('pdfs', 10) as unknown as RequestHandler, async (req: Request, res: Response) => {
  try {
    console.log('[UPLOAD] Starting upload request');
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      console.log('[UPLOAD] No files in request');
      return res.status(400).json({ ok: false, error: 'No PDFs uploaded.' });
    }
    console.log('[UPLOAD] Files received:', files.length);

    const authReq = req as AuthenticatedRequest;
    const user = authReq.currentUser;
    const assignedToUserId = req.body?.assignedToUserId || null;
    const uploadedByUserId = user?.id || null;
    const companyId = req.body?.companyId || user?.companyId || null;
    
    console.log('[UPLOAD] User:', uploadedByUserId, 'Company:', companyId, 'AssignTo:', assignedToUserId);

    const createdCaseIds: string[] = [];

    for (const f of files) {
      const pdfBytes = fs.readFileSync(f.path);
      const { text } = await extractPdfText(pdfBytes);

      const parsed = parseIdentity(text);
      
      let defendantNameFromFile: string | null = null;
      if (!parsed.defendantName) {
        const filenameWithoutExt = f.originalname.replace(/\.pdf$/i, '');
        const cleanedName = filenameWithoutExt.replace(/\d+$/, '').trim();
        if (cleanedName.includes(',') && cleanedName.length > 3) {
          defendantNameFromFile = cleanedName;
          console.log(`Extracted defendant name from filename: ${defendantNameFromFile}`);
        }
      }
      
      const caseData = {
        caseNumber: parsed.caseNumber || 'Unknown',
        defendantName: parsed.defendantName || defendantNameFromFile || 'Unknown',
        defendantDOB: null,
        status: 'processing' as const,
        summary: null,
        criminalHistorySummary: null,
        isMarkedComplete: false,
        bookedIntoJail: parsed.bookedIntoJail ?? null,
        uploadedByUserId,
        assignedToUserId,
        companyId,
      };
      
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
        const sanitizedText = (text || '')
          .replace(/\x00/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        
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

      processCase(newCase.id, newCase.caseNumber, pdfBytes);

      fs.unlinkSync(f.path);
    }

    res.json({ ok: true, caseIds: createdCaseIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ ok: false, error: msg });
  }
});

async function processCase(caseId: string, caseNumber: string, pdfBytes: Buffer): Promise<void> {
  const sanitize = (s: string): string => 
    (s || '').replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();

  try {
    const analysis = await runAnalysis({ persist: true, pdfBuffers: [pdfBytes] });
    
    if (analysis && typeof analysis === 'object') {
      const analysisObj = analysis as AnalysisResult;
      console.log('Analysis completed:', JSON.stringify(analysisObj, null, 2).slice(0, 1000));
      
      const rawNarrative = analysisObj.narrative || '';
      const narrative = sanitize(rawNarrative);
      const docSummaries: AnalysisDocumentSummary[] = analysisObj.documents || [];
      const fullText = sanitize(analysisObj.fullText || '');
      
      const readableChars = narrative.replace(/[^a-zA-Z0-9\s.,!?;:'"()-]/g, '').length;
      const isReadable = narrative.length > 0 && (readableChars / narrative.length) > 0.5;
      
      let summary: string;
      let rawOfficerActions: string | null = null;
      const extractedSynopsis = extractCaseSynopsis(fullText);
      
      if (extractedSynopsis) {
        rawOfficerActions = stripCriminalHistory(sanitize(extractedSynopsis));
        try {
          summary = await summarizeOfficerActions(rawOfficerActions, caseNumber);
        } catch (err) {
          console.error('Failed to summarize officer actions:', err);
          summary = rawOfficerActions.slice(0, 300) + (rawOfficerActions.length > 300 ? '...' : '');
        }
      } else if (isReadable && narrative.length > 50) {
        rawOfficerActions = stripCriminalHistory(sanitize(narrative));
        try {
          summary = await summarizeOfficerActions(rawOfficerActions, caseNumber);
        } catch (err) {
          console.error('Failed to summarize officer actions:', err);
          summary = rawOfficerActions.slice(0, 300) + (rawOfficerActions.length > 300 ? '...' : '');
        }
      } else if (docSummaries.length > 0) {
        const totalPages = docSummaries.reduce((acc: number, d: AnalysisDocumentSummary) => acc + (d.pageCount || 0), 0);
        const totalChars = docSummaries.reduce((acc: number, d: AnalysisDocumentSummary) => acc + (d.textLength || 0), 0);
        
        if (!isReadable && totalChars > 1000) {
          summary = `This appears to be a scanned PDF (${totalPages} pages). OCR is required to extract text from scanned documents. Please configure OCR or upload a text-based PDF.`;
        } else {
          summary = `Analyzed ${docSummaries.length} document(s) with ${totalPages} page(s), ${totalChars} characters extracted.`;
        }
      } else {
        summary = 'Document analysis complete. Awaiting manual review.';
      }

      const priors: PriorsSummary | null = analysisObj.priors;
      let criminalHistorySummaryDefault = !isReadable 
        ? 'Unable to extract criminal history from scanned document. OCR required.'
        : 'No prior offenses found in documents.';

      const textsToTry = fullText.length > 100 ? [fullText, narrative] : [narrative];
      
      for (const textToSearch of textsToTry) {
        if (textToSearch.length < 50) continue;
        const extractedIdentity = parseIdentityFromText(textToSearch);
        console.log('Extracted identity from text:', extractedIdentity, 'text length:', textToSearch.length);
        
        if (extractedIdentity.defendantName || extractedIdentity.caseNumber) {
          console.log('Updating case identity from analysis:', extractedIdentity);
          await storage.updateCaseIdentity(
            caseId, 
            extractedIdentity.defendantName, 
            extractedIdentity.caseNumber
          );
        }
        if (extractedIdentity.bookedIntoJail !== null) {
          await storage.updateCaseBookedIntoJail(caseId, extractedIdentity.bookedIntoJail);
        }
        if (extractedIdentity.defendantName || extractedIdentity.caseNumber || extractedIdentity.bookedIntoJail !== null) {
          break;
        }
      }

      const screeningCharges = extractChargesFromScreeningSheet(fullText);
      console.log('Extracted screening charges:', screeningCharges.length, 'charges from fullText');
      
      const citations: AnalysisCitation[] = analysisObj.citations || [];
      const elements: AnalysisElement[] = analysisObj.elements || [];
      const statutes: AnalysisStatute[] = analysisObj.statutes || [];
      const violationsToCreate: ViolationToCreate[] = [];
      
      const statuteMap = new Map<string, string>();
      const statuteUrlMap = new Map<string, string | null>();
      const statuteTitleMap = new Map<string, string | null>();
      for (const st of statutes) {
        const normalizedCode = st.code?.toLowerCase();
        if (normalizedCode && st.text) {
          statuteMap.set(normalizedCode, st.text);
        }
        if (normalizedCode && st.url) {
          statuteUrlMap.set(normalizedCode, st.url);
        }
        if (normalizedCode && st.title) {
          statuteTitleMap.set(normalizedCode, st.title);
        }
      }
      
      for (const charge of screeningCharges) {
        const normalizedChargeCode = charge.code.toLowerCase();
        const matchingElement = elements.find((el: AnalysisElement) => 
          el.code && (el.code.toLowerCase() === normalizedChargeCode || el.code.toLowerCase().includes(normalizedChargeCode) || normalizedChargeCode.includes(el.code.toLowerCase()))
        );
        
        const statuteText = statuteMap.get(normalizedChargeCode) || null;
        const statuteUrlVal = statuteUrlMap.get(normalizedChargeCode) || null;
        const result = matchingElement?.result;
        const elems: AnalysisElementResult[] = result?.elements || [];
        const overallMet = result?.overall === 'met';
        
        violationsToCreate.push({
          caseId: caseId,
          code: charge.code,
          chargeName: charge.chargeName,
          chargeClass: charge.chargeClass,
          chargeType: 'current' as const,
          source: charge.code.startsWith('76') || charge.code.match(/^\d{2}-\d/) ? 'Utah State Code' as const : 'West Valley City Code' as const,
          description: matchingElement ? 'Automated element analysis' : 'Charge extracted from screening sheet',
          statuteText: statuteText ? sanitize(statuteText.slice(0, 2000)) : null,
          statuteUrl: statuteUrlVal,
          criteria: elems.length > 0 ? elems.map((e: AnalysisElementResult) => e.element || 'Element').slice(0, 5) : ['Manual review required'],
          isViolated: overallMet,
          confidence: overallMet ? 0.8 : (matchingElement ? 0.5 : 0.3),
          reasoning: result?.notes?.join(' ') || 'Review case synopsis against statute elements',
          evidence: elems.slice(0, 2).map((e: AnalysisElementResult) => e.evidenceSnippets?.join(' ') || '').join(' | ') || 'See case synopsis',
        });
      }
      
      if (violationsToCreate.length === 0 && elements.length > 0) {
        for (const el of elements) {
          const result = el.result;
          const elems: AnalysisElementResult[] = result?.elements || [];
          const normalizedElCode = el.code?.toLowerCase() || '';
          const statuteText = statuteMap.get(normalizedElCode) || null;
          const statuteUrlEl = statuteUrlMap.get(normalizedElCode) || null;
          const statuteTitle = statuteTitleMap.get(normalizedElCode) || null;
          
          violationsToCreate.push({
            caseId: caseId,
            code: el.code || 'Unknown',
            chargeName: statuteTitle,
            chargeClass: null,
            chargeType: 'historical' as const,
            source: el.jurisdiction === 'WVC' ? 'West Valley City Code' as const : 'Utah State Code' as const,
            description: 'Element analysis (fallback - no charge table found)',
            statuteText: statuteText ? sanitize(statuteText.slice(0, 2000)) : null,
            statuteUrl: statuteUrlEl,
            criteria: elems.length > 0 ? elems.map((e: AnalysisElementResult) => e.element).slice(0, 5) : ['Requires manual review'],
            isViolated: result?.overall === 'met',
            confidence: result?.overall === 'met' ? 0.8 : 0.4,
            reasoning: result?.notes?.join(' ') || 'Automated screening analysis - manual review recommended',
            evidence: elems.slice(0, 2).map((e: AnalysisElementResult) => e.evidenceSnippets?.join(' ') || '').join(' | ') || 'See original document for details',
          });
        }
      }
      
      if (violationsToCreate.length === 0 && citations.length > 0) {
        for (const c of citations) {
          const normalizedCitCode = c.normalizedKey?.toLowerCase() || '';
          const statuteText = statuteMap.get(normalizedCitCode) || null;
          const statuteUrlCit = statuteUrlMap.get(normalizedCitCode) || null;
          const statuteTitleCit = statuteTitleMap.get(normalizedCitCode) || null;
          violationsToCreate.push({
            caseId: caseId,
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

      const recordsToCreate: Array<{
        caseId: string;
        date: string;
        offense: string;
        disposition: string;
        jurisdiction: string;
      }> = [];
      
      if (priors && priors.incidents) {
        for (const incident of priors.incidents) {
          for (const charge of incident.charges || []) {
            recordsToCreate.push({
              caseId: caseId,
              date: charge.dateOfArrest || 'Unknown',
              offense: charge.chargeText || 'Unknown',
              disposition: 'See record',
              jurisdiction: 'Utah',
            });
          }
        }
      }

      let finalCriminalHistorySummary = criminalHistorySummaryDefault;
      
      if (recordsToCreate.length > 0) {
        await storage.createCriminalRecords(recordsToCreate);
        console.log(`Created ${recordsToCreate.length} criminal records for case ${caseId}`);
        
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
      
      await storage.updateCaseSummary(caseId, sanitize(summary), sanitize(finalCriminalHistorySummary), rawOfficerActions || undefined);

      const extractedImages: ExtractedImage[] = analysisObj.extractedImages || [];
      if (extractedImages.length > 0) {
        const imagesToCreate = extractedImages.slice(0, 20).map((img, idx) => ({
          caseId: caseId,
          documentId: null,
          filename: `extracted-image-${idx + 1}.${img.mimeType === 'image/png' ? 'png' : 'jpg'}`,
          mimeType: img.mimeType,
          imageData: img.imageData,
          pageNumber: img.pageNumber,
        }));
        await storage.createCaseImages(imagesToCreate);
        console.log(`Saved ${imagesToCreate.length} extracted images for case ${caseId}`);
      }

      try {
        console.log(`Generating AI legal analysis for case ${caseId}...`);
        const caseRecord = await storage.getCase(caseId);
        const aiAnalysis = await generateFullLegalAnalysis({
          caseNumber: caseNumber,
          defendantName: caseRecord?.defendantName || 'Unknown',
          extractedText: fullText,
          synopsis: summary,
          violations: violationsToCreate.map(v => ({
            code: v.code,
            chargeName: v.chargeName,
            statuteText: v.statuteText,
            source: v.source,
          })),
        });
        await storage.updateCaseLegalAnalysis(caseId, aiAnalysis.caseSummaryNarrative, aiAnalysis.legalAnalysis);
        console.log(`AI legal analysis saved for case ${caseId}`);
      } catch (aiError) {
        console.error('AI legal analysis error:', aiError instanceof Error ? aiError.message : String(aiError));
      }

      await storage.updateCaseStatus(caseId, 'completed');
      console.log(`Case ${caseId} analysis saved with ${violationsToCreate.length} violations, ${recordsToCreate.length} criminal records`);
    } else {
      await storage.updateCaseSummary(caseId, 'Analysis complete - no structured data found.', 'No criminal history detected.');
      await storage.updateCaseStatus(caseId, 'completed');
    }
  } catch (err) {
    console.error('Analysis failed:', err);
    await storage.updateCaseSummary(caseId, `Analysis error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'Unable to analyze criminal history.');
    await storage.updateCaseStatus(caseId, 'flagged');
  }
}

export { getUploadDir };
