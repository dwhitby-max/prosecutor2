export type PriorCharge = {
  offenseTrackingNumber: string | null;
  dateOfArrest: string | null;
  chargeText: string;
};

export type PriorIncident = {
  incidentLabel: string;
  charges: PriorCharge[];
};

export type PriorsSummary = {
  incidentCount: number;
  chargeCount: number;
  incidents: PriorIncident[];
};

/**
 * Extract criminal history ONLY from specific Criminal History sections in the document.
 * CRITICAL: Only extract from clearly marked Criminal History sections like:
 * - "Criminal History Summary"
 * - "Adult Criminal History"  
 * - "Utah BCI"
 * - "UTAH CRIMINAL HISTORY RECORD"
 * Do NOT extract from other document sections like Officer's Actions, Patrol Screening, etc.
 */
export function parseUtahCriminalHistory(text: string): PriorsSummary | null {
  console.log('[parseUtahCriminalHistory] Starting extraction, text length:', text.length);
  
  // First, try to extract only the Criminal History section using bounded patterns
  // These patterns capture from the section header until the next major section
  const sectionPatterns = [
    // Utah Criminal History Record section - ends at next major section
    /UTAH\s+CRIMINAL\s+HISTORY\s+RECORD\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE|END\s+OF\s+REPORT)\s*|\n\s*={3,}|\s*$)/i,
    // Criminal History Summary section - common in police reports
    /Criminal\s+History\s+Summary\s*[:\-–]?\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE|END\s+OF\s+REPORT)\s*|\s*$)/i,
    // Adult Criminal History section 
    /Adult\s+Criminal\s+History\s*(?:\(Utah\s+BCI\))?\s*[:\-–]?\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE|END\s+OF\s+REPORT)\s*|\s*$)/i,
    // Utah BCI section
    /Utah\s+BCI\s*[:\-–]?\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE|END\s+OF\s+REPORT)\s*|\s*$)/i,
    // NCIC section (must be clearly labeled)
    /\bNCIC\s+(?:Record|History|Criminal)\s*[:\-–]?\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE)\s*|\s*$)/i,
    // Criminal History with colon/dash - common inline format
    /Criminal\s+[Hh]istory\s*[-–:]\s*([\s\S]*?)(?=\n\s*(?:General\s+Offense|Patrol\s+Screening|Officer[''\u2019]?s?\s+Actions?|EVIDENCE|WITNESSES|NARRATIVE|Involved\s+Persons?|Location|Synopsis)\s*|\n\n\n|\s*$)/i,
  ];
  
  let section: string | null = null;
  
  for (const pattern of sectionPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 20) {
      section = match[1].trim();
      console.log('[parseUtahCriminalHistory] Found criminal history section, length:', section.length);
      break;
    }
  }
  
  // If no bounded section found, return null - do NOT fall back to searching entire document
  if (!section) {
    console.log('[parseUtahCriminalHistory] Could not find dedicated Criminal History section');
    return null;
  }

  // Try structured incident parsing first (for detailed BCI records)
  const incidentRegex = /Incident\s+(\d+)\s+of\s+(\d+)/gi;
  const matches = Array.from(section.matchAll(incidentRegex));

  const incidents: PriorIncident[] = [];

  if (matches.length > 0) {
    console.log('[parseUtahCriminalHistory] Found', matches.length, 'structured incidents');
    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? section.length) : section.length;
      const block = section.slice(start, end);
      const label = `Incident ${matches[i][1]} of ${matches[i][2]}`;

      const charges = parseChargesFromIncidentBlock(block);
      incidents.push({ incidentLabel: label, charges });
    }
  } else {
    // Fallback: parse inline criminal history format like:
    // "Criminal history - 16 arrests. Convictions: '22 MB RT WVC - 221701631, ..."
    const inlineCharges = parseInlineCriminalHistory(section);
    if (inlineCharges.length > 0) {
      console.log('[parseUtahCriminalHistory] Found', inlineCharges.length, 'inline charges');
      incidents.push({
        incidentLabel: 'Criminal History Summary',
        charges: inlineCharges,
      });
    }
  }

  const chargeCount = incidents.reduce((n, it) => n + it.charges.length, 0);
  console.log('[parseUtahCriminalHistory] Total charges found:', chargeCount);
  return chargeCount > 0 ? { incidentCount: incidents.length, chargeCount, incidents } : null;
}

function parseInlineCriminalHistory(text: string): PriorCharge[] {
  const charges: PriorCharge[] = [];
  
  // Pattern for entries like: '22 MB RT WVC - 221701631
  // or: '22 MA obstruction of justice
  // or: 22 Midvale MB RT 181001034
  const entryPatterns = [
    // 'YY offense - case#
    /'(\d{2})\s+([A-Z]{2,}(?:\s+[A-Z]+)*)\s*[-–]?\s*([A-Za-z\s]+)?\s*[-–]?\s*(\d{6,})?/g,
    // 'YY City offense - case#
    /'(\d{2})\s+([A-Za-z\s]+?)\s*[-–]\s*(\d{6,})/g,
  ];
  
  // Also look for case numbers as identifiers
  const caseNumbers = text.match(/\d{9,}/g) || [];
  const offensePatterns = [
    /MB\s+RT/gi,
    /MB\s+theft/gi,
    /MA\s+obstruction/gi,
    /MA\s+POCS/gi,
    /POCS/gi,
    /possession/gi,
    /theft/gi,
    /retail\s+theft/gi,
    /obstruction/gi,
  ];
  
  // Extract year and offense pairs
  const yearOffenseRegex = /'(\d{2})\s+([A-Z]{2,}[A-Za-z\s]*?)(?:[-–]|\s+(?:WVC|WJ|Midvale|Salt Lake|Utah))/gi;
  let match;
  
  while ((match = yearOffenseRegex.exec(text)) !== null) {
    const year = `20${match[1]}`;
    const offense = match[2].trim();
    charges.push({
      offenseTrackingNumber: null,
      dateOfArrest: year,
      chargeText: offense,
    });
  }
  
  // If no structured matches, try to extract general offense mentions
  if (charges.length === 0) {
    // Look for "X arrests" pattern
    const arrestMatch = text.match(/(\d+)\s+arrests?/i);
    if (arrestMatch) {
      const count = parseInt(arrestMatch[1], 10);
      // Extract any mentioned offenses
      for (const pattern of offensePatterns) {
        const offenseMatches = text.match(pattern);
        if (offenseMatches) {
          for (const o of offenseMatches) {
            charges.push({
              offenseTrackingNumber: null,
              dateOfArrest: 'Unknown',
              chargeText: o.trim(),
            });
          }
        }
      }
      
      // If still no charges but we know there are arrests
      if (charges.length === 0 && count > 0) {
        charges.push({
          offenseTrackingNumber: null,
          dateOfArrest: 'Unknown',
          chargeText: `${count} prior arrests on record`,
        });
      }
    }
  }
  
  // Look for conviction entries with case numbers
  const convictionRegex = /Convictions?[:\s]+(.+?)(?:\n|$)/gi;
  const convictionMatch = text.match(convictionRegex);
  if (convictionMatch) {
    for (const conv of convictionMatch) {
      // Split by commas
      const parts = conv.replace(/Convictions?[:\s]+/i, '').split(/,/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 3) {
          // Check if already added
          if (!charges.some(c => c.chargeText.includes(trimmed.slice(0, 10)))) {
            charges.push({
              offenseTrackingNumber: null,
              dateOfArrest: 'Unknown',
              chargeText: trimmed.slice(0, 100),
            });
          }
        }
      }
    }
  }
  
  return charges;
}

function parseChargesFromIncidentBlock(block: string): PriorCharge[] {
  const out: PriorCharge[] = [];
  
  // Look for DATE OF ARREST to get the date
  const dateMatch = block.match(/DATE\s+OF\s+ARREST[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const dateOfArrest = dateMatch ? dateMatch[1] : null;
  
  // Look for OFFENSE TRACKING # to get the tracking number
  const trackingMatch = block.match(/OFFENSE\s+TRACKING\s*#\s*\(OTN\)[:\s]+([A-Z0-9]+)/i);
  const offenseTracking = trackingMatch ? trackingMatch[1] : null;
  
  // Look for OFFENSE LITERAL entries - these contain the clean offense text
  const offenseLiteralRegex = /OFFENSE\s+LITERAL[:\s]+([A-Z][A-Z\s\/\-()]+?)(?=\s+STATUTE[:\s]|\s+NCIC|\s+JURISDICTION|\s*$)/gi;
  let match;
  const seenOffenses = new Set<string>();
  
  while ((match = offenseLiteralRegex.exec(block)) !== null) {
    const offenseText = match[1].trim().slice(0, 80);
    // Dedupe - only add if we haven't seen this offense
    if (offenseText.length > 3 && !seenOffenses.has(offenseText.toLowerCase())) {
      seenOffenses.add(offenseText.toLowerCase());
      out.push({
        offenseTrackingNumber: offenseTracking,
        dateOfArrest,
        chargeText: offenseText,
      });
    }
  }
  
  // If no OFFENSE LITERAL found, try ARRESTING CHARGE pattern
  if (out.length === 0) {
    const arrestingChargeRegex = /ARRESTING\s+CHARGE[:\s]+([A-Z][A-Z\s\/\-()]+?)(?=\s+STATUTE|\s+OFFENSE|\s*$)/gi;
    while ((match = arrestingChargeRegex.exec(block)) !== null) {
      const offenseText = match[1].trim().slice(0, 80);
      if (offenseText.length > 3 && !seenOffenses.has(offenseText.toLowerCase())) {
        seenOffenses.add(offenseText.toLowerCase());
        out.push({
          offenseTrackingNumber: offenseTracking,
          dateOfArrest,
          chargeText: offenseText,
        });
      }
    }
  }
  
  return out;
}
