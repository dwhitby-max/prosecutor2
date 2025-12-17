export function detectCitations(text) {
    const out = [];
    const seen = new Set();
    const utah = /\b(\d{1,3})-(\d{1,4}[a-z]?)-(\d{1,4}(?:\.\d+)?)\b/gi;
    const wvc = /\b(\d{1,2})-(\d{1,3})-(\d{1,4})\b/gi;
    for (const m of text.matchAll(utah)) {
        const raw = m[0];
        const key = raw.replace(/\s+/g, '').replace(/–/g, '-').replace(/—/g, '-');
        const k = `UT:${key}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push({ raw, normalizedKey: key, jurisdiction: 'UT' });
    }
    for (const m of text.matchAll(wvc)) {
        const raw = m[0];
        const key = raw.replace(/\s+/g, '').replace(/–/g, '-').replace(/—/g, '-');
        const k = `WVC:${key}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        // Heuristic: if nearby text says WVC or West Valley, treat as WVC; otherwise UNKNOWN.
        const idx = m.index ?? -1;
        const window = idx >= 0 ? text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + 80)).toLowerCase() : '';
        const jur = window.includes('west valley') || window.includes('wvc') ? 'WVC' : 'UNKNOWN';
        out.push({ raw, normalizedKey: key, jurisdiction: jur });
    }
    return out;
}
