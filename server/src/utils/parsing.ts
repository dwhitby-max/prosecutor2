import * as path from 'node:path';
import * as fs from 'node:fs';

export interface IdentityResult {
  caseNumber: string | null;
  defendantName: string | null;
  bookedIntoJail: boolean | null;
}

export interface ChargeInfo {
  code: string;
  chargeName: string;
  chargeClass: string | null;
}

export function getUploadDir(): string {
  const dir = path.join(process.cwd(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function formatDefendantName(firstName: string, lastName: string): string {
  return `${lastName.trim()}, ${firstName.trim()}`;
}

export function parseIdentity(text: string): IdentityResult {
  let caseNumber: string | null = null;
  const casePatterns = [
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
    if (match && match[1] && match[1].length >= 6) {
      caseNumber = match[1].trim();
      break;
    }
  }

  let defendantName: string | null = null;
  
  const lastFirstMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.]+),\s*([A-Z][a-zA-Z\-'\.\s]+)/i);
  if (lastFirstMatch) {
    const lastName = lastFirstMatch[1].trim();
    const firstName = lastFirstMatch[2].trim();
    defendantName = `${lastName}, ${firstName}`;
  } else {
    const nameBlockMatch = text.match(/Defendant\s*[:\-]?\s*([A-Z][a-zA-Z\-'\.\s]+?)(?=\s*(?:DOB|Date|Address|Case|\n|$))/i);
    if (nameBlockMatch && nameBlockMatch[1]) {
      const namePart = nameBlockMatch[1].trim();
      
      if (namePart.includes(',')) {
        defendantName = namePart;
      } else {
        const parts = namePart.split(/\s+/).filter(p => p.length > 0);
        const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'II', 'III', 'IV'];
        
        if (parts.length >= 2) {
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

  let bookedIntoJail: boolean | null = null;
  const bookedMatch = text.match(/Booked\s+Into\s+Jail[:\s]*(Yes|No|Y|N)/i);
  if (bookedMatch) {
    bookedIntoJail = bookedMatch[1].toLowerCase().startsWith('y');
  }

  return { caseNumber, defendantName, bookedIntoJail };
}

export function parseIdentityFromText(text: string): IdentityResult {
  let defendantName: string | null = null;
  let caseNumber: string | null = null;
  const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'II', 'III', 'IV'];
  
  const stopWords = ['and', 'the', 'is', 'are', 'was', 'were', 'his', 'her', 'their', 'with', 'also', 'known', 'staying', 'in', 'on', 'at', 'for', 'to', 'from', 'by', 'but', 'or', 'property', 'windows', 'officers', 'car', 'vehicle', 'booked', 'into', 'jail'];
  
  const cleanName = (name: string): string => {
    return name
      .split(/[\n\r]/)[0]
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z\s,.\-']/g, '')
      .trim();
  };
  
  const isValidName = (name: string): boolean => {
    const cleaned = cleanName(name);
    const parts = cleaned.split(/[\s,]+/).filter(p => p.length > 0);
    if (parts.length < 2 || parts.length > 5) return false;
    for (const part of parts) {
      if (stopWords.includes(part.toLowerCase())) return false;
    }
    for (const part of parts) {
      if (part.length > 15) return false;
    }
    return true;
  };
  
  const namePatterns = [
    { pattern: /Defendant[:\s]+([A-Z][a-z]+),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)?)/i, format: 'last_first' },
    { pattern: /Name[:\s]+([A-Z][a-z]+),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)?)/i, format: 'last_first' },
    { pattern: /also\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i, format: 'first_middle_last' },
    { pattern: /\(also\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\)/i, format: 'name_block' },
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
      
      if (candidateName && isValidName(candidateName)) {
        defendantName = cleanName(candidateName);
        break;
      }
    }
  }
  
  if (!defendantName) {
    const ocrNamePatterns = [
      /([A-Z]{2,15}),\s*([A-Z]{2,15}(?:\s+[A-Z]{1,15})?)\s/,
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
  
  const casePatterns = [
    /Case\s*#\s*:?\s*([A-Z]{2,4}\d{2}[\-]\d{4,6})/i,
    /Case\s*#\s*:?\s*(\d{4}[\-]\d{5})/i,
    /Case\s*#\s*:?\s*(\d{2}[\-]\d{5})/i,
    /Case\s+([A-Z]{2,4}\d{2}[\-]\d{4,6})/i,
    /Case\s+(\d{4}[\-]\d{5})/i,
    /Case\s+(\d{2}[\-]\d{5})/i,
    /Police\s+Case[:\s#]*([A-Z]{0,4}\d{2,4}[\-\/]\d+)/i,
    /Case\s*(?:No\.?|Number)[:\s]*([A-Z]{0,4}\d{2,4}[\-\/]\d+)/i,
    /([A-Z]{2,4}\d{2}[\-]\d{4,6})/,
    /(\d{4}[\-]\d{5})/,
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

export function extractChargesFromScreeningSheet(text: string): ChargeInfo[] {
  const charges: ChargeInfo[] = [];
  const seenCodes = new Set<string>();
  
  const ocrCorrections: Record<string, string> = {
    '57-37A': '58-37A',
    '57-37a': '58-37A',
    '57-37A-5': '58-37A-5',
    '57-37a-5': '58-37A-5',
  };
  
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
  
  const chargeAbbreviations: Record<string, string> = {
    'POCS': 'Possession of Controlled Substance',
    'PODP': 'Possession of Drug Paraphernalia',
    'DUI': 'Driving Under Influence',
    'DV': 'Domestic Violence',
  };
  
  const classMap: Record<string, string> = {
    'MA': 'Misdemeanor A',
    'MB': 'Misdemeanor B',
    'MC': 'Misdemeanor C',
    'F1': '1st Degree Felony',
    'F2': '2nd Degree Felony',
    'F3': '3rd Degree Felony',
  };
  
  const offenseInfoMatch = text.match(/Offense\s+Information/i);
  if (!offenseInfoMatch) {
    console.log('No "Offense Information" section found - returning empty charges');
    return charges;
  }
  
  const startIndex = offenseInfoMatch.index! + offenseInfoMatch[0].length;
  console.log('Found "Offense Information" at index', offenseInfoMatch.index, '- starting scan from', startIndex);
  
  let chargeText = text.slice(startIndex, startIndex + 500);
  
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
  
  const hasExampleText = chargeText.toLowerCase().includes('example');
  const codesToProcess = hasExampleText && allCodes.length > 1 ? allCodes.slice(1) : allCodes;
  
  if (hasExampleText && allCodes.length > 0) {
    console.log('Skipping example code:', `${allCodes[0].title}-${allCodes[0].chapter}-${allCodes[0].section}`);
  }
  
  for (const codeInfo of codesToProcess) {
    let { title, chapter, section, suffix } = codeInfo;
    
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

export function getLastName(defendantName: string): string {
  const parts = defendantName.split(',');
  return (parts[0] || defendantName).trim().toLowerCase();
}

export function sanitizeText(s: string): string {
  return (s || '').replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();
}
