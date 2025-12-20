import { useEffect, useState } from 'react';
import { PreviewUpload } from './PreviewUpload';

type CaseRow = { id: string; caseNumber: string | null; defendantName: string | null; uploadDate: string };

type CasesResp =
  | { ok: true; cases: CaseRow[] }
  | { ok: false; error: string };

type ViolationType = {
  id: string;
  code: string;
  chargeName: string | null;
  chargeClass: string | null;
  source: string;
  description: string;
  isViolated: boolean;
  confidence: number;
  reasoning: string;
  evidence: string;
  statuteText: string | null;
};

type CriminalRecordType = {
  id: string;
  date: string;
  offense: string;
  disposition: string;
  jurisdiction: string;
};

type CaseDetail = {
  id: string;
  caseNumber: string | null;
  defendantName: string | null;
  uploadDate: string;
  status: string;
  summary: string | null;
  rawOfficerActions: string | null;
  criminalHistorySummary: string | null;
  documents: Array<{ id: string; filename: string; uploadPath: string | null }>;
  violations: ViolationType[];
  criminalRecords: CriminalRecordType[];
};

type CaseDetailResp =
  | { ok: true; case: CaseDetail }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function App() {
  const [view, setView] = useState<'cases' | 'preview'>('cases');
  const [folder, setFolder] = useState<'active' | 'completed'>('active');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetailResp | null>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showFullOfficerActions, setShowFullOfficerActions] = useState(false);

  async function loadCases(filter: 'active' | 'completed' = folder) {
    const r = await fetch(`/api/cases?filter=${filter}`);
    const j: unknown = await r.json();
    if (!isObj(j) || j.ok !== true || !Array.isArray(j.cases)) return;
    const rows: CaseRow[] = [];
    for (const row of j.cases) {
      if (!isObj(row)) continue;
      const id = getString(row.id);
      const uploadDate = getString(row.uploadDate);
      if (!id || !uploadDate) continue;
      rows.push({
        id,
        uploadDate,
        caseNumber: getString(row.caseNumber),
        defendantName: getString(row.defendantName),
      });
    }
    setCases(rows);
  }

  useEffect(() => { void loadCases(folder); }, [folder]);

  async function markComplete(caseId: string, isComplete: boolean) {
    await fetch(`/api/cases/${caseId}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isComplete }),
    });
    setDetail(null);
    setSelected(null);
    void loadCases(folder);
  }

  async function openCase(id: string) {
    setSelected(id);
    const r = await fetch(`/api/cases/${encodeURIComponent(id)}`);
    const j: unknown = await r.json();
    if (!isObj(j)) return;
    if (j.ok === true) setDetail(j as CaseDetailResp);
    else setDetail({ ok: false, error: getString(j.error) ?? 'Unknown error' });
  }

  function toggleSelectForDelete(id: string) {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedForDelete.size === cases.length) {
      setSelectedForDelete(new Set());
    } else {
      setSelectedForDelete(new Set(cases.map((c) => c.id)));
    }
  }

  async function deleteSelectedCases() {
    if (selectedForDelete.size === 0) return;
    if (!confirm(`Delete ${selectedForDelete.size} case(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const r = await fetch('/api/cases', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedForDelete) }),
      });
      const j: unknown = await r.json();
      if (isObj(j) && j.ok === true) {
        setSelectedForDelete(new Set());
        setSelected(null);
        setDetail(null);
        void loadCases(folder);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }} data-testid="app-container">
      <div style={{ display: 'flex', gap: 8, padding: 12, borderBottom: '1px solid #eee' }} data-testid="nav-header">
        <button data-testid="button-view-cases" onClick={() => setView('cases')} disabled={view === 'cases'}>Cases</button>
        <button data-testid="button-view-preview" onClick={() => setView('preview')} disabled={view === 'preview'}>Preview</button>
        <button data-testid="button-refresh" onClick={() => { void loadCases(folder); }}>Refresh</button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            data-testid="button-filter-active"
            onClick={() => { setFolder('active'); setSelectedForDelete(new Set()); }}
            style={{ background: folder === 'active' ? '#007bff' : '#e9ecef', color: folder === 'active' ? '#fff' : '#000', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Active Cases
          </button>
          <button
            data-testid="button-filter-completed"
            onClick={() => { setFolder('completed'); setSelectedForDelete(new Set()); }}
            style={{ background: folder === 'completed' ? '#28a745' : '#e9ecef', color: folder === 'completed' ? '#fff' : '#000', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Completed Cases
          </button>
        </span>
      </div>

      {view === 'preview' ? (
        <PreviewUpload />
      ) : (
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }} data-testid="cases-layout">
          <div data-testid="cases-sidebar">
            <h2 data-testid="text-folder-title">{folder === 'active' ? 'Active Cases' : 'Completed Cases'}</h2>
            {folder === 'active' && <UploadCreate onCreated={() => { void loadCases(folder); }} />}
            {cases.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, padding: 8, background: '#f8f9fa', borderRadius: 6 }} data-testid="delete-controls">
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    data-testid="checkbox-select-all"
                    checked={selectedForDelete.size === cases.length && cases.length > 0}
                    onChange={toggleSelectAll}
                  />
                  <span style={{ fontSize: 13 }}>Select All</span>
                </label>
                <button
                  data-testid="button-delete-selected"
                  onClick={() => void deleteSelectedCases()}
                  disabled={selectedForDelete.size === 0 || deleting}
                  style={{
                    marginLeft: 'auto',
                    background: selectedForDelete.size > 0 ? '#dc3545' : '#ccc',
                    color: '#fff',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: 4,
                    cursor: selectedForDelete.size > 0 ? 'pointer' : 'not-allowed',
                    fontSize: 13,
                  }}
                >
                  {deleting ? 'Deleting...' : `Delete (${selectedForDelete.size})`}
                </button>
              </div>
            )}
            <div style={{ marginTop: 12 }} data-testid="cases-list">
              {cases.map((c) => (
                <div key={c.id} data-testid={`card-case-${c.id}`} style={{ padding: 10, border: '1px solid #ddd', borderRadius: 8, marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    data-testid={`checkbox-case-${c.id}`}
                    checked={selectedForDelete.has(c.id)}
                    onChange={() => toggleSelectForDelete(c.id)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div data-testid={`text-defendant-${c.id}`}><strong>{c.defendantName ?? 'Unknown Defendant'}</strong></div>
                    <div style={{ fontSize: 12, color: '#555' }} data-testid={`text-case-info-${c.id}`}>
                      Case: {c.caseNumber ?? 'Unknown'} · {new Date(c.uploadDate).toLocaleString()}
                    </div>
                    <button data-testid={`button-open-case-${c.id}`} style={{ marginTop: 8 }} onClick={() => void openCase(c.id)} disabled={selected === c.id}>
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div data-testid="case-detail-panel">
            <h2>Case Detail</h2>
            {!detail && <div data-testid="text-select-prompt">Select a case.</div>}
            {detail && detail.ok === false && <div data-testid="text-error" style={{ color: 'crimson' }}>{detail.error}</div>}
            {detail && detail.ok === true && (
              <div data-testid="case-detail-content">
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div data-testid="text-detail-defendant"><strong>{detail.case.defendantName ?? 'Unknown Defendant'}</strong></div>
                    <div data-testid="text-detail-case-number">Case #: {detail.case.caseNumber ?? 'Unknown'}</div>
                  </div>
                  {folder === 'active' ? (
                    <button
                      data-testid="button-mark-complete"
                      onClick={() => void markComplete(detail.case.id, true)}
                      style={{ background: '#28a745', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Mark Complete
                    </button>
                  ) : (
                    <button
                      data-testid="button-move-to-active"
                      onClick={() => void markComplete(detail.case.id, false)}
                      style={{ background: '#6c757d', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Move to Active
                    </button>
                  )}
                </div>

                <h3>Documents</h3>
                {detail.case.documents.map((d) => (
                  <div key={d.id} style={{ marginBottom: 8 }}>
                    {d.uploadPath ? <a href={d.uploadPath} target="_blank">{d.filename}</a> : d.filename}
                  </div>
                ))}

                <h3>Analysis Summary</h3>
                <div style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  <div><strong>Status:</strong> {detail.case.status}</div>
                  {detail.case.summary && (
                    <div style={{ marginTop: 8 }}>
                      <strong>AI-Generated Summary:</strong>
                      <p style={{ margin: '4px 0' }}>{detail.case.summary}</p>
                    </div>
                  )}
                  {detail.case.rawOfficerActions && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #ddd' }}>
                      <button
                        onClick={() => setShowFullOfficerActions(!showFullOfficerActions)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#007bff',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {showFullOfficerActions ? 'Hide' : 'View'} Full Officer's Actions
                        <span style={{ transform: showFullOfficerActions ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                      </button>
                      {showFullOfficerActions && (
                        <div style={{ marginTop: 12, padding: 12, background: '#e9ecef', borderRadius: 6 }}>
                          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
                            Officer's Actions from General Offense Hardcopy
                          </div>
                          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {detail.case.rawOfficerActions}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {detail.case.criminalHistorySummary && (
                    <div style={{ marginTop: 8 }}>
                      <strong>Criminal History:</strong> {detail.case.criminalHistorySummary}
                    </div>
                  )}
                </div>

                <h3>Current Case Charges ({detail.case.violations?.length ?? 0})</h3>
                {(!detail.case.violations || detail.case.violations.length === 0) ? (
                  <div style={{ color: '#666', fontStyle: 'italic' }}>No charges detected</div>
                ) : (
                  detail.case.violations.map((v) => (
                    <div key={v.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong style={{ fontSize: 14 }}>{v.code}</strong>
                          {v.chargeClass && (
                            <span style={{ marginLeft: 8, background: '#e9ecef', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
                              {v.chargeClass}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: '#666' }}>{v.source}</span>
                      </div>
                      {v.chargeName && (
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#333', marginTop: 4 }}>
                          {v.chargeName}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: v.isViolated ? 'green' : 'orange', marginTop: 6 }}>
                        {v.isViolated ? 'Evidence Found' : 'Review Required'} - Confidence: {Math.round(v.confidence * 100)}%
                      </div>
                      {v.evidence && v.evidence !== 'See case synopsis' && (
                        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                          <strong>Evidence:</strong> {v.evidence.slice(0, 200)}{v.evidence.length > 200 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {/* Applicable Statutes Section */}
                {detail.case.violations?.some((v) => v.statuteText) && (
                  <>
                    <h3 data-testid="section-statutes">Applicable Utah State Code</h3>
                    <div style={{ background: '#f5f8fa', border: '1px solid #d1d9e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      {detail.case.violations.filter((v) => v.statuteText).map((v) => (
                        <div key={`statute-${v.id}`} data-testid={`statute-${v.id}`} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #e0e6eb' }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a5276', marginBottom: 8 }}>
                            {v.code} - {v.description}
                          </div>
                          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>
                            {v.statuteText?.replace(/\n{3,}/g, '\n\n').trim().split('\n\n').map((para, i) => (
                              <p key={i} style={{ margin: '0 0 8px 0' }}>{para.replace(/\n/g, ' ').trim()}</p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <h3>Criminal Records ({detail.case.criminalRecords?.length ?? 0})</h3>
                {(!detail.case.criminalRecords || detail.case.criminalRecords.length === 0) ? (
                  <div style={{ color: '#666', fontStyle: 'italic' }}>No criminal records found</div>
                ) : (
                  detail.case.criminalRecords.map((r) => (
                    <div key={r.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div><strong>{r.offense}</strong></div>
                      <div style={{ fontSize: 12, color: '#555' }}>
                        {r.date} | {r.jurisdiction} | {r.disposition}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadCreate(props: { onCreated: () => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('pdfs', f);
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cases/upload', { method: 'POST', body: fd });
      const j: unknown = await r.json();
      if (isObj(j) && j.ok === true) {
        setMsg('Created.');
        props.onCreated();
      } else {
        setMsg(isObj(j) ? (getString(j.error) ?? 'Error') : 'Error');
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Error';
      setMsg(m);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }} data-testid="upload-section">
      <div><strong>Upload PDFs (creates cases)</strong></div>
      <input data-testid="input-file-upload" type="file" accept="application/pdf" multiple onChange={(e) => setFiles(e.target.files)} />
      <div style={{ marginTop: 8 }}>
        <button data-testid="button-upload" onClick={submit} disabled={loading || !files || files.length === 0}>{loading ? 'Working…' : 'Upload'}</button>
        {msg && <span data-testid="text-upload-message" style={{ marginLeft: 8 }}>{msg}</span>}
      </div>
    </div>
  );
}
