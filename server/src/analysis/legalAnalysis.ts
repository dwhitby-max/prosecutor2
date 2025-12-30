import { GoogleGenAI } from "@google/genai";

const SLOW_AI_THRESHOLD_MS = 30000;

function logAI(operation: string, duration: number, context?: Record<string, unknown>): void {
  const level = duration > SLOW_AI_THRESHOLD_MS ? 'WARN' : 'INFO';
  console.log(`[${level}] AI ${operation} completed in ${duration}ms`, context ? JSON.stringify(context) : '');
}

export interface ChargeAnalysis {
  code: string;
  chargeName: string;
  statuteText: string;
  analysis: string;
  conclusion: 'SUPPORTED' | 'QUESTIONABLE' | 'INSUFFICIENT_EVIDENCE';
}

export interface LegalAnalysisResult {
  caseSummaryNarrative: string;
  chargeAnalyses: ChargeAnalysis[];
  overallAnalysis: string;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  
  if (!apiKey) {
    console.log('Gemini not configured for legal analysis - no API key');
    return null;
  }
  
  // If we have a custom base URL (Replit integration), use it
  if (baseUrl) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl,
      },
    });
  }
  
  // Otherwise use default Google Gemini API
  return new GoogleGenAI({ apiKey });
}

export async function generateCaseSummaryNarrative(
  caseData: {
    caseNumber: string;
    defendantName: string;
    extractedText: string;
    synopsis?: string | null;
    violations?: Array<{
      code: string;
      chargeName?: string | null;
      statuteText?: string | null;
    }>;
  }
): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) {
    return "AI summary not available - Gemini not configured.";
  }

  const startTime = Date.now();
  try {
    // Build charges section if violations are provided
    let chargesSection = '';
    if (caseData.violations && caseData.violations.length > 0) {
      chargesSection = `
CHARGES FILED:
${caseData.violations.map(v => `- ${v.code}${v.chargeName ? `: ${v.chargeName}` : ''}`).join('\n')}
`;
    }

    const prompt = `You are a legal analyst reviewing a case file. Generate a clear, professional NARRATIVE SUMMARY of the entire case based on the following information.

CASE NUMBER: ${caseData.caseNumber}
DEFENDANT: ${caseData.defendantName}
${chargesSection}
EXTRACTED TEXT FROM CASE DOCUMENTS:
${caseData.extractedText.slice(0, 25000)}

${caseData.synopsis ? `OFFICER'S SYNOPSIS:\n${caseData.synopsis}` : ''}

Write a comprehensive narrative summary (4-6 paragraphs) that covers:
1. What incident occurred and when/where it happened
2. Who was involved (defendant, officers, witnesses, victims if any)
3. What the officers observed and what actions they took
4. What evidence was collected or observed
5. **For each charge listed above**: Provide a DETAILED explanation of how the defendant violated that specific code, including:
   - The specific items, substances, or property involved (with exact descriptions like "air freshener", "figurine", etc.)
   - Dollar values, quantities, or amounts (e.g., "$90", "total value of $150")
   - Specific actions the defendant took that constitute the violation
   - Names of witnesses or victims who observed the violation
6. The outcome of the encounter (arrest, citation, booking, etc.)

CRITICAL RULES:
- CAREFULLY READ the entire extracted text above. The item details, values, and evidence ARE in the document - find them.
- Do NOT say information is missing if it appears anywhere in the text above.
- Use professional, objective legal language. Focus on FACTS, not opinions.
- Do NOT include any legal conclusions about guilt or innocence.
- Do NOT repeat full statute text - just explain how the facts match the violation.
- Do NOT include ANY criminal history information (prior arrests, prior convictions, past offenses).
- Do NOT mention the defendant's criminal record or history in any way.
- Focus ONLY on THIS incident and what happened during THIS encounter.
- For each charge, you MUST extract and include specific details from the document: item descriptions, dollar amounts, quantities, witness names, and exact actions taken.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const result = response.text?.trim() || "Unable to generate case summary.";
    logAI('generateCaseSummaryNarrative', Date.now() - startTime, { caseNumber: caseData.caseNumber, resultLength: result.length });
    return result;
  } catch (error) {
    logAI('generateCaseSummaryNarrative', Date.now() - startTime, { caseNumber: caseData.caseNumber, error: true });
    console.error('Error generating case summary:', error instanceof Error ? error.message : String(error));
    return "Error generating case summary.";
  }
}

export async function generateLegalAnalysis(
  caseData: {
    caseNumber: string;
    defendantName: string;
    extractedText: string;
    synopsis?: string | null;
    violations: Array<{
      code: string;
      chargeName?: string | null;
      statuteText?: string | null;
      source: string;
    }>;
  }
): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) {
    return "AI legal analysis not available - Gemini not configured.";
  }

  if (!caseData.violations || caseData.violations.length === 0) {
    return "No charges found to analyze.";
  }

  const startTime = Date.now();
  try {
    const chargesDescription = caseData.violations.map((v, i) => {
      return `
CHARGE ${i + 1}: ${v.code}${v.chargeName ? `: ${v.chargeName}` : ''}
Source: ${v.source}
${v.statuteText ? `STATUTE TEXT:\n${v.statuteText.slice(0, 2000)}` : 'Statute text not available.'}
`;
    }).join('\n---\n');

    const prompt = `You are an experienced legal analyst. Review this case and analyze whether each charge is supported by the facts and officer observations.

CASE NUMBER: ${caseData.caseNumber}
DEFENDANT: ${caseData.defendantName}

CASE FACTS (from documents):
${caseData.extractedText.slice(0, 10000)}

${caseData.synopsis ? `OFFICER'S OBSERVATIONS:\n${caseData.synopsis}` : ''}

CHARGES TO ANALYZE:
${chargesDescription}

For EACH charge, provide:

1. **Statutory Elements**: What does this law require to be proven?
2. **Evidence Analysis**: What facts from the case support or undermine each element?
3. **Officer Actions**: Did the officer's observations and actions align with enforcing this statute?
4. **Conclusion**: Is this charge:
   - SUPPORTED: Clear evidence exists for all elements
   - QUESTIONABLE: Some elements lack strong evidence
   - INSUFFICIENT EVIDENCE: Key elements not supported by facts

Format your response as:

## CHARGE: [Code] - [Name]

**Statutory Requirements:**
[List the elements that must be proven]

**Evidence Analysis:**
[Compare case facts to each element]

**Officer's Observations:**
[How did officer actions/observations support this charge?]

**Conclusion:** [SUPPORTED/QUESTIONABLE/INSUFFICIENT EVIDENCE]
[Brief explanation of conclusion]

---

Repeat for each charge, then provide:

## OVERALL CASE ASSESSMENT
[Summary of whether the charges as a whole are supported by the evidence]

Be objective and analytical. Do not make final guilt/innocence determinations - only assess whether the evidence supports the charges.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const result = response.text?.trim() || "Unable to generate legal analysis.";
    logAI('generateLegalAnalysis', Date.now() - startTime, { caseNumber: caseData.caseNumber, chargeCount: caseData.violations.length, resultLength: result.length });
    return result;
  } catch (error) {
    logAI('generateLegalAnalysis', Date.now() - startTime, { caseNumber: caseData.caseNumber, error: true });
    console.error('Error generating legal analysis:', error instanceof Error ? error.message : String(error));
    return "Error generating legal analysis.";
  }
}

export async function generateFullLegalAnalysis(
  caseData: {
    caseNumber: string;
    defendantName: string;
    extractedText: string;
    synopsis?: string | null;
    violations: Array<{
      code: string;
      chargeName?: string | null;
      statuteText?: string | null;
      source: string;
    }>;
  }
): Promise<{ caseSummaryNarrative: string; legalAnalysis: string }> {
  const [caseSummaryNarrative, legalAnalysis] = await Promise.all([
    generateCaseSummaryNarrative(caseData),
    generateLegalAnalysis(caseData)
  ]);

  return { caseSummaryNarrative, legalAnalysis };
}

/**
 * Summarize the officer's actions from the General Offense Hardcopy section.
 * Takes the raw extracted officer's actions text and creates a concise summary.
 */
export async function summarizeOfficerActions(
  rawOfficerActions: string,
  caseNumber: string
): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) {
    return rawOfficerActions.slice(0, 300) + (rawOfficerActions.length > 300 ? '...' : '');
  }

  const startTime = Date.now();
  try {
    const prompt = `Summarize the following officer's actions from a police report in 2-3 concise sentences. Focus on:
- What the officer observed or responded to
- Key actions taken by the officer
- The outcome (arrest, citation, etc.)

Do NOT include any criminal history information.
Do NOT include any legal conclusions or opinions.
Write in past tense, professional language.

OFFICER'S ACTIONS TEXT:
${rawOfficerActions.slice(0, 4000)}

SUMMARY:`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const result = response.text?.trim() || rawOfficerActions.slice(0, 300);
    logAI('summarizeOfficerActions', Date.now() - startTime, { caseNumber, resultLength: result.length });
    return result;
  } catch (error) {
    logAI('summarizeOfficerActions', Date.now() - startTime, { caseNumber, error: true });
    console.error('Error summarizing officer actions:', error instanceof Error ? error.message : String(error));
    return rawOfficerActions.slice(0, 300) + (rawOfficerActions.length > 300 ? '...' : '');
  }
}
