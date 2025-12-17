import { useState } from 'react';

type PreviewDoc = { filename: string; pageCount: number | null; textLength: number; imageCount: number; imageUrls: string[] };
type PreviewResp =
  | { ok: true; previewId: string; documents: PreviewDoc[]; analysis: unknown }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function getString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function PreviewUpload() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [resp, setResp] = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState(false);

  async function runPreview() {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('pdfs', f);
    setLoading(true);
    setResp(null);
    try {
      const r = await fetch('/api/cases/preview', { method: 'POST', body: fd });
      const j: unknown = await r.json();
      if (isObj(j) && j.ok === true) setResp(j as PreviewResp);
      else setResp({ ok: false, error: isObj(j) ? (getString(j.error) ?? 'Error') : 'Error' });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Error';
      setResp({ ok: false, error: m });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Preview (no case created)</h2>
      <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles(e.target.files)} />
      <div style={{ marginTop: 12 }}>
        <button onClick={runPreview} disabled={loading || !files || files.length === 0}>
          {loading ? 'Analyzing…' : 'Run Preview'}
        </button>
      </div>

      {resp && !resp.ok && <div style={{ marginTop: 16, color: 'crimson' }}>{resp.error}</div>}

      {resp && resp.ok && (
        <div style={{ marginTop: 16 }}>
          <h3>Documents</h3>
          {resp.documents.map((d, idx) => (
            <div key={idx} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <div><strong>{d.filename}</strong></div>
              <div>Pages: {d.pageCount ?? 'Unknown'} · Text length: {d.textLength} · Images: {d.imageCount}</div>
              {d.imageUrls.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {d.imageUrls.map((u) => <img key={u} src={u} style={{ width: 160, border: '1px solid #eee' }} />)}
                </div>
              )}
            </div>
          ))}

          <h3>Raw Analysis JSON</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 12, borderRadius: 8 }}>
            {JSON.stringify(resp.analysis, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
