export async function lookupUtahCode(citation) {
    const norm = normalize(citation);
    const url = buildUtahXcodeUrl(norm);
    if (!url)
        return { ok: false, citation: norm, reason: 'unsupported', details: 'Unsupported Utah citation.', urlTried: null };
    return await fetchHtmlAsText('utah_legislature_xcode', norm, url);
}
export async function lookupWvcCode(citation) {
    const norm = normalize(citation);
    const url = `https://westvalleycity.municipal.codes/Code/${encodeURIComponent(norm)}`;
    return await fetchHtmlAsText('west_valley_city_municipal_codes', norm, url);
}
function normalize(c) {
    return c.trim().replace(/\s+/g, '').replace(/–/g, '-').replace(/—/g, '-');
}
function buildUtahXcodeUrl(citation) {
    const m = citation.match(/^(\d{1,3})-(\d{1,4}[a-z]?)-(.+)$/i);
    if (!m)
        return null;
    const title = m[1];
    const chapter = m[2];
    const section = m[3];
    return `https://le.utah.gov/xcode/Title${title}/Chapter${chapter}/${title}-${chapter}-S${section}.html`;
}
async function fetchHtmlAsText(source, citation, url) {
    try {
        const res = await fetch(url);
        if (res.status === 404)
            return { ok: false, citation, reason: 'not_found', details: 'Not found.', urlTried: url };
        if (res.status === 429)
            return { ok: false, citation, reason: 'rate_limited', details: 'Rate limited.', urlTried: url };
        const html = await res.text();
        if (!res.ok)
            return { ok: false, citation, reason: 'network_error', details: `HTTP ${res.status}`, urlTried: url };
        const parsed = htmlToText(html);
        if (!parsed)
            return { ok: false, citation, reason: 'parse_error', details: 'Failed to parse HTML.', urlTried: url };
        const title = firstLine(parsed);
        return { ok: true, source, citation, title, text: parsed, url, fetchedAtIso: new Date().toISOString() };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Network error';
        return { ok: false, citation, reason: 'network_error', details: msg, urlTried: url };
    }
}
function htmlToText(html) {
    if (html.trim().length === 0)
        return null;
    let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\s*\/p\s*>/gi, '\n');
    t = t.replace(/<[^>]+>/g, ' ');
    t = t
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    t = t.replace(/[ \t]+/g, ' ').replace(/\n\s+\n/g, '\n\n').trim();
    return t.length > 0 ? t : null;
}
function firstLine(text) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.length > 0 ? lines[0].slice(0, 200) : null;
}
