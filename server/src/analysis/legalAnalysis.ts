import { GoogleGenAI } from "@google/genai";

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
  
  if (!apiKey || !baseUrl) {
    console.log('Gemini not configured for legal analysis');
    return null;
  }
  
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "",
      baseUrl,
    },
  });
}

export async function generateCaseSummaryNarrative(
  caseData: {
    caseNumber: string;
    defendantName: string;
    extractedText: string;
    synopsis?: string | null;
  }
): Promise<string> {
  const ai = getGeminiClient();
  if (!ai) {
    return "AI summary not available - Gemini not configured.";
  }

  try {
    const prompt = `You are a legal analyst reviewing a case file. Generate a clear, professional NARRATIVE SUMMARY of the entire case based on the following information.

CASE NUMBER: ${caseData.caseNumber}
DEFENDANT: ${caseData.defendantName}

EXTRACTED TEXT FROM CASE DOCUMENTS:
${caseData.extractedText.slice(0, 12000)}

${caseData.synopsis ? `OFFICER'S SYNOPSIS:\n${caseData.synopsis}` : ''}

Write a comprehensive narrative summary (3-5 paragraphs) that covers:
1. What incident occurred and when/where it happened
2. Who was involved (defendant, officers, witnesses, victims if any)
3. What the officers observed and what actions they took
4. What evidence was collected or observed
5. The outcome of the encounter (arrest, citation, booking, etc.)

Use professional, objective legal language. Focus on FACTS, not opinions.
Do NOT include any legal conclusions about guilt or innocence.
Do NOT repeat statute text or legal codes - just summarize what happened.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    return response.text?.trim() || "Unable to generate case summary.";
  } catch (error) {
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

  try {
    const chargesDescription = caseData.violations.map((v, i) => {
      return `
CHARGE ${i + 1}: ${v.code}${v.chargeName ? ` - ${v.chargeName}` : ''}
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

    return response.text?.trim() || "Unable to generate legal analysis.";
  } catch (error) {
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
