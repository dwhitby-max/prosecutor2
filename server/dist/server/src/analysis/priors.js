export function parseUtahCriminalHistory(text) {
    const idx = text.toUpperCase().indexOf('UTAH CRIMINAL HISTORY RECORD');
    if (idx < 0)
        return null;
    const section = text.slice(idx);
    const incidentRegex = /Incident\s+(\d+)\s+of\s+(\d+)/gi;
    const matches = Array.from(section.matchAll(incidentRegex));
    const incidents = [];
    for (let i = 0; i < matches.length; i += 1) {
        const start = matches[i].index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? section.length) : section.length;
        const block = section.slice(start, end);
        const label = `Incident ${matches[i][1]} of ${matches[i][2]}`;
        const charges = parseChargesFromIncidentBlock(block);
        incidents.push({ incidentLabel: label, charges });
    }
    const chargeCount = incidents.reduce((n, it) => n + it.charges.length, 0);
    return { incidentCount: incidents.length, chargeCount, incidents };
}
function parseChargesFromIncidentBlock(block) {
    const lines = block.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
    const out = [];
    let currentCharge = [];
    let dateOfArrest = null;
    let offenseTracking = null;
    for (const line of lines) {
        const doa = line.match(/Date\s+of\s+Arrest\s*[:\-]?\s*(.+)$/i);
        if (doa && typeof doa[1] === 'string')
            dateOfArrest = doa[1].trim();
        const ot = line.match(/Offense\s+Tracking\s*#\s*[:\-]?\s*(.+)$/i);
        if (ot && typeof ot[1] === 'string')
            offenseTracking = ot[1].trim();
        const looksLikeCharge = line.toUpperCase().startsWith('CHARGE') || line.toUpperCase().includes('CHARGE:');
        if (looksLikeCharge) {
            if (currentCharge.length > 0) {
                out.push({
                    offenseTrackingNumber: offenseTracking,
                    dateOfArrest,
                    chargeText: currentCharge.join(' ').trim(),
                });
                currentCharge = [];
                dateOfArrest = null;
                offenseTracking = null;
            }
            currentCharge.push(line);
            continue;
        }
        if (currentCharge.length > 0)
            currentCharge.push(line);
    }
    if (currentCharge.length > 0) {
        out.push({
            offenseTrackingNumber: offenseTracking,
            dateOfArrest,
            chargeText: currentCharge.join(' ').trim(),
        });
    }
    return out;
}
