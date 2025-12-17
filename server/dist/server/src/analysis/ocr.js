export function getOcrProviderFromEnv(env) {
    const prov = env.OCR_PROVIDER;
    if (typeof prov !== 'string' || prov.trim().length === 0)
        return { kind: 'none' };
    const p = prov.trim().toLowerCase();
    if (p !== 'google_vision')
        return { kind: 'none' };
    const key = env.GOOGLE_VISION_API_KEY;
    if (typeof key !== 'string' || key.trim().length === 0)
        return { kind: 'none' };
    return { kind: 'google_vision', apiKey: key.trim() };
}
export async function ocrPngPage(req, provider) {
    if (provider.kind === 'none') {
        return { ok: false, provider: 'none', reason: 'not_configured', details: 'OCR not configured.' };
    }
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(provider.apiKey)}`;
    const body = {
        requests: [
            { image: { content: req.pngBytes.toString('base64') }, features: [{ type: 'TEXT_DETECTION' }] },
        ],
    };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.status === 429)
        return { ok: false, provider: 'google_vision', reason: 'rate_limited', details: 'Rate limited.' };
    if (!res.ok)
        return { ok: false, provider: 'google_vision', reason: 'provider_error', details: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    const parsed = safeJsonParse(text);
    const extracted = extractGoogleVisionText(parsed);
    if (!extracted)
        return { ok: false, provider: 'google_vision', reason: 'provider_error', details: 'No OCR text returned.' };
    return { ok: true, provider: 'google_vision', text: extracted, confidence: null };
}
function safeJsonParse(text) {
    try {
        const u = JSON.parse(text);
        return u;
    }
    catch {
        return null;
    }
}
function extractGoogleVisionText(json) {
    if (typeof json !== 'object' || json === null)
        return null;
    const root = json;
    const responses = root.responses;
    if (!Array.isArray(responses) || responses.length < 1)
        return null;
    const r0 = responses[0];
    if (typeof r0 !== 'object' || r0 === null)
        return null;
    const rec = r0;
    const fta = rec.fullTextAnnotation;
    if (typeof fta === 'object' && fta !== null) {
        const t = fta.text;
        if (typeof t === 'string' && t.trim().length > 0)
            return t.trim();
    }
    const ta = rec.textAnnotations;
    if (Array.isArray(ta) && ta.length > 0) {
        const a0 = ta[0];
        if (typeof a0 === 'object' && a0 !== null) {
            const d = a0.description;
            if (typeof d === 'string' && d.trim().length > 0)
                return d.trim();
        }
    }
    return null;
}
