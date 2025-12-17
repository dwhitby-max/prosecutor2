import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, AlertTriangle, History, User, CheckCircle2, XCircle, Loader2, Building } from "lucide-react";
import { cn } from "@/lib/utils";

// STATUTE TEXT SOURCE CONTROL:
// - statuteText is ONLY sourced from /api/statutes endpoint (JSON response, never raw HTML)
// - This component calls /api/statutes/ut/{citation} to fetch clean statute text
// - NO iframe, DOMParser, readability, or HTML preview of source pages

// Component to fetch and display statute text from API
function StatuteDisplay({ code, source }: { code: string; source: string }) {
  const [statuteText, setStatuteText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchStatute = async () => {
      try {
        // Determine jurisdiction from source
        const jurisdiction = source?.toLowerCase().includes('wvc') ? 'wvc' : 'ut';
        const response = await fetch(`/api/statutes/${jurisdiction}/${encodeURIComponent(code)}`);
        const data = await response.json();
        
        if (data.ok && data.statuteText) {
          console.log(`[STATUTE_DISPLAY] Fetched ${code}: ${data.statuteText.length} chars`);
          setStatuteText(data.statuteText);
        } else {
          setError(data.error || 'Statute not found');
        }
      } catch (err) {
        console.error(`[STATUTE_DISPLAY] Error fetching ${code}:`, err);
        setError('Failed to fetch statute');
      } finally {
        setLoading(false);
      }
    };
    
    fetchStatute();
  }, [code, source]);
  
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading statute text...</span>
      </div>
    );
  }
  
  if (error) {
    return <p className="text-sm text-amber-600">({error})</p>;
  }
  
  return (
    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
      {statuteText}
    </p>
  );
}

type Violation = {
  id: string;
  code: string;
  chargeName: string | null;
  chargeClass: string | null;
  source: string;
  description: string;
  statuteText: string | null;
  statuteUrl: string | null;
  criteria: string[];
  isViolated: boolean;
  confidence: number;
  reasoning: string;
  evidence: string;
};

type CriminalRecord = {
  id: string;
  date: string;
  offense: string;
  disposition: string;
  jurisdiction: string;
};

type CaseData = {
  id: string;
  caseNumber: string;
  defendantName: string;
  defendantDOB: string | null;
  uploadDate: string;
  status: string;
  summary: string | null;
  criminalHistorySummary: string | null;
  bookedIntoJail: boolean | null;
  violations: Violation[];
  criminalRecords: CriminalRecord[];
};

export default function AnalysisPage() {
  const [, params] = useRoute("/analysis/:id");
  const caseId = params?.id;
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingComplete, setMarkingComplete] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchSequenceRef = useRef(0);
  const renderCountRef = useRef(0);
  
  // Track all state changes with timestamps
  const logStatuteState = (source: string, violations: Violation[] | undefined) => {
    const ts = new Date().toISOString().slice(11, 23);
    const count = violations?.filter(v => v.statuteText && v.statuteText.length > 100).length || 0;
    const total = violations?.length || 0;
    console.log(`[${ts}] STATUTE_STATE source=${source} withText=${count}/${total}`);
    violations?.forEach((v, i) => {
      const len = v.statuteText?.length || 0;
      const preview = v.statuteText ? v.statuteText.slice(0, 50).replace(/\n/g, ' ') : 'NULL';
      console.log(`  [V${i}] ${v.code}: ${len} chars "${preview}..."`);
    });
  };

  useEffect(() => {
    if (!caseId) return;
    
    const effectId = Math.random().toString(36).slice(2, 8);
    console.log(`[EFFECT ${effectId}] useEffect started for caseId=${caseId}`);
    
    let isMounted = true;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const fetchCase = async (source: string, sequence: number): Promise<CaseData | null> => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      try {
        const response = await fetch(`/api/cases/${caseId}`, {
          signal: abortControllerRef.current.signal
        });
        if (!response.ok) throw new Error('Failed to load case');
        
        const result = await response.json();
        const newData = result.case as CaseData;
        
        console.log(`[FETCH ${source} seq=${sequence}] status=${newData.status}, violations=${newData.violations?.length}`);
        newData.violations?.forEach((v, i) => {
          const hasText = !!v.statuteText;
          const textLen = v.statuteText?.length || 0;
          const preview = v.statuteText ? v.statuteText.slice(0, 60) : 'NULL';
          console.log(`  [V${i}] ${v.code}: hasStatuteText=${hasText} (${textLen} chars), preview="${preview}..."`);
        });
        
        if (!isMounted) {
          console.log(`[FETCH ${source} seq=${sequence}] Discarded - component unmounted`);
          return null;
        }
        
        if (sequence < fetchSequenceRef.current) {
          console.log(`[FETCH ${source} seq=${sequence}] Discarded - stale response (current=${fetchSequenceRef.current})`);
          return null;
        }
        
        return newData;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[FETCH ${source} seq=${sequence}] Aborted`);
          return null;
        }
        throw err;
      }
    };
    
    const updateData = (newData: CaseData, source: string) => {
      setData(prevData => {
        const ts = new Date().toISOString().slice(11, 23);
        
        if (!prevData) {
          console.log(`[${ts}] STATE_UPDATE source=${source} action=INITIAL`);
          logStatuteState(`${source}_INITIAL`, newData.violations);
          return newData;
        }
        
        const prevCount = prevData.violations?.filter(v => v.statuteText && v.statuteText.length > 100).length || 0;
        const newCount = newData.violations?.filter(v => v.statuteText && v.statuteText.length > 100).length || 0;
        
        // CRITICAL: Never allow statute text loss
        if (prevCount > 0 && newCount === 0) {
          console.log(`[${ts}] STATE_UPDATE source=${source} action=BLOCKED prevCount=${prevCount} newCount=${newCount}`);
          console.log(`  BLOCKED: Would lose ${prevCount} violations with statute text`);
          // Only update status, preserve everything else
          return { ...prevData, status: newData.status };
        }
        
        // Protect individual violations - never overwrite valid API-sourced statute text
        // Guard: if prev has proof marker or is >400 chars, never overwrite
        const mergedViolations = newData.violations?.map(newV => {
          const prevV = prevData.violations?.find(pv => pv.id === newV.id || pv.code === newV.code);
          
          // DO NOT OVERWRITE guard: keep prev if it has proof marker or is substantial
          if (prevV?.statuteText) {
            const hasProofMarker = prevV.statuteText.includes('__STATUTE_API_PROOF__');
            const isSubstantial = prevV.statuteText.length > 400;
            
            if (hasProofMarker || isSubstantial) {
              // Only overwrite if new also has proof marker (fresh API data)
              const newHasProofMarker = newV.statuteText?.includes('__STATUTE_API_PROOF__');
              if (!newHasProofMarker) {
                console.log(`  GUARD: Preserving ${newV.code} (hasProof=${hasProofMarker}, len=${prevV.statuteText.length})`);
                return { ...newV, statuteText: prevV.statuteText, statuteUrl: prevV.statuteUrl || newV.statuteUrl };
              }
            }
          }
          return newV;
        });
        
        // Always use guarded violations to ensure proof-marked text is preserved
        console.log(`[${ts}] STATE_UPDATE source=${source} action=GUARDED prevCount=${prevCount} newCount=${newCount}`);
        logStatuteState(`${source}_GUARDED`, mergedViolations);
        return { ...newData, violations: mergedViolations || [] };
      });
    };

    const runPollingCycle = async () => {
      const sequence = ++fetchSequenceRef.current;
      try {
        const newData = await fetchCase('POLL', sequence);
        if (newData && isMounted) {
          updateData(newData, 'POLL');
          
          if (newData.status === 'processing') {
            pollTimeoutId = setTimeout(runPollingCycle, 3000);
          } else {
            console.log(`[POLL] Status=${newData.status}, polling stopped`);
          }
        }
      } catch (err) {
        console.error('[POLL] Error:', err);
        pollTimeoutId = setTimeout(runPollingCycle, 5000);
      }
    };

    const initializeFetch = async () => {
      const sequence = ++fetchSequenceRef.current;
      try {
        const newData = await fetchCase('INITIAL', sequence);
        if (newData && isMounted) {
          updateData(newData, 'INITIAL');
          setLoading(false);
          
          if (newData.status === 'processing') {
            pollTimeoutId = setTimeout(runPollingCycle, 3000);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load case');
          setLoading(false);
        }
      }
    };

    initializeFetch();

    return () => {
      console.log(`[EFFECT ${effectId}] useEffect cleanup for caseId=${caseId}`);
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
    };
  }, [caseId]);

  const markComplete = async (isComplete: boolean) => {
    if (!caseId) return;
    setMarkingComplete(true);
    try {
      await fetch(`/api/cases/${caseId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isComplete })
      });
      // SAFE: Only updates isMarkedComplete, preserves all other data including statuteText
      setData(prev => {
        if (!prev) return null;
        console.log(`[MARK_COMPLETE] Updating isMarkedComplete to ${isComplete}, preserving ${prev.violations?.filter(v => v.statuteText).length} violations with text`);
        return { ...prev, isMarkedComplete: isComplete } as any;
      });
    } catch (err) {
      console.error('Failed to mark complete:', err);
    } finally {
      setMarkingComplete(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading case analysis...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <p className="text-destructive">{error || 'Case not found'}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const currentViolations = data.violations || [];
  const uploadDate = new Date(data.uploadDate).toLocaleDateString();
  
  // Debug: track every render with statute text state
  renderCountRef.current++;
  const statuteCount = currentViolations.filter(v => v.statuteText && v.statuteText.length > 100).length;
  console.log(`[RENDER #${renderCountRef.current}] Violations with statuteText: ${statuteCount}/${currentViolations.length}`);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <h1 className="text-lg font-serif font-bold text-foreground" data-testid="heading-case-title">
                {data.defendantName === 'Unknown' ? 'Unknown Defendant' : data.defendantName}
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span data-testid="text-case-number">{data.caseNumber}</span>
                <span>•</span>
                <span>Uploaded {uploadDate}</span>
              </div>
            </div>
            <Badge variant="outline" className={cn(
              data.status === 'completed' ? "bg-green-50 text-green-700 border-green-200" :
              data.status === 'processing' ? "bg-amber-50 text-amber-700 border-amber-200" :
              "bg-red-50 text-red-700 border-red-200"
            )} data-testid={`badge-status-${data.status}`}>
              {data.status === 'completed' ? 'Analysis Complete' : 
               data.status === 'processing' ? 'Processing...' : 'Flagged'}
            </Badge>
          </div>
          <button
            onClick={() => markComplete(!(data as any).isMarkedComplete)}
            disabled={markingComplete}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              (data as any).isMarkedComplete 
                ? "bg-muted text-muted-foreground hover:bg-muted/80"
                : "bg-green-600 text-white hover:bg-green-700"
            )}
            data-testid="button-mark-complete"
          >
            {markingComplete ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (data as any).isMarkedComplete ? (
              'Return to Active'
            ) : (
              'Mark Complete'
            )}
          </button>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col bg-background">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-8">
              
              <Card className="bg-muted/10 border-none shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold">
                      {data.defendantName.split(/[,\s]+/).filter(n => n.length > 0).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-foreground text-lg" data-testid="text-defendant-name">{data.defendantName}</h3>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        {data.defendantDOB && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" /> DOB: {data.defendantDOB}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <History className="h-3 w-3" /> {data.criminalRecords?.length || 0} Prior Records
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Booked Into Jail</p>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          data.bookedIntoJail === true ? "bg-red-50 text-red-700 border-red-200" :
                          data.bookedIntoJail === false ? "bg-green-50 text-green-700 border-green-200" :
                          "bg-gray-50 text-gray-700 border-gray-200"
                        )}
                        data-testid="badge-booked"
                      >
                        {data.bookedIntoJail === true ? 'Yes' : 
                         data.bookedIntoJail === false ? 'No' : 'Unknown'}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Current Charges</p>
                      <p className="text-sm font-medium">{currentViolations.length} charge(s)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="charges" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                  <TabsTrigger value="charges" className="gap-2" data-testid="tab-charges">
                    <AlertTriangle className="h-4 w-4" /> Current Charges
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-2" data-testid="tab-history">
                    <History className="h-4 w-4" /> Criminal History
                  </TabsTrigger>
                  <TabsTrigger value="summary" className="gap-2" data-testid="tab-summary">
                    <FileText className="h-4 w-4" /> Case Synopsis
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="charges" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-serif font-bold text-primary">
                      Current Case Charges ({currentViolations.length})
                    </h3>
                  </div>

                  {currentViolations.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        No charges detected in this case. Please review the case synopsis for details.
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                    <Accordion type="multiple" className="space-y-3">
                      {currentViolations.map((violation, idx) => (
                        <AccordionItem 
                          key={violation.id} 
                          value={violation.id}
                          className="border rounded-lg px-4 bg-card"
                          data-testid={`charge-item-${idx}`}
                        >
                          <AccordionTrigger className="hover:no-underline py-3">
                            <div className="flex items-start gap-4 flex-1">
                              <div className={cn(
                                "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs",
                                violation.isViolated ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                              )}>
                                {idx + 1}
                              </div>
                              <div className="flex-1 text-left">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="font-bold text-foreground">{violation.code}</span>
                                  {violation.chargeName && (
                                    <span className="text-sm text-muted-foreground">- {violation.chargeName}</span>
                                  )}
                                  {violation.chargeClass && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">
                                      {violation.chargeClass}
                                    </Badge>
                                  )}
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    {violation.source}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge 
                                    variant="outline" 
                                    className={cn(
                                      "text-[10px]",
                                      violation.isViolated 
                                        ? "bg-red-50 text-red-700 border-red-200" 
                                        : "bg-amber-50 text-amber-700 border-amber-200"
                                    )}
                                  >
                                    {violation.isViolated ? 'Burden Met' : 'Needs Review'}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {Math.round(violation.confidence * 100)}% Confidence
                                  </span>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pt-4 pb-4 space-y-4">
                            {violation.statuteText && (
                              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                                <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide flex items-center gap-1 mb-1">
                                  <Building className="h-3 w-3" /> Statute Text
                                </p>
                                <p className="text-sm text-blue-800 whitespace-pre-wrap">{violation.statuteText}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Analysis</p>
                              <p className="text-sm text-foreground">{violation.description}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Elements Evaluated</p>
                              <ul className="space-y-1.5">
                                {violation.criteria.map((criterion, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm">
                                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                                    <span>{criterion}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Reasoning</p>
                              <p className="text-sm text-foreground">{violation.reasoning}</p>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                              <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide mb-1">Evidence from Case</p>
                              <p className="text-sm text-amber-800 italic">"{violation.evidence}"</p>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>

                    {/* Applicable Statutes Section - Fetches from /api/statutes/ut/{citation} */}
                    <div className="mt-8 p-4 bg-blue-100 border-2 border-blue-400 rounded-lg" data-testid="section-statutes">
                      <h3 className="text-lg font-serif font-bold text-blue-800 mb-4 flex items-center gap-2">
                        <Building className="h-5 w-5" /> Applicable Utah State Code / West Valley City Code
                      </h3>
                      <p className="text-sm mb-4">Fetching statute text for {currentViolations.length} violations from API</p>
                      <div className="space-y-4">
                        {currentViolations.map((violation, idx) => (
                          <Card key={violation.id} className="border-l-4 border-l-blue-500 bg-white" data-testid={`statute-item-${idx}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2 flex-wrap mb-3">
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-mono">
                                  {violation.code}
                                </Badge>
                                <span className="font-medium text-foreground">{violation.chargeName}</span>
                                <Badge variant="secondary" className="text-[10px]">
                                  {violation.source}
                                </Badge>
                              </div>
                              <div className="max-h-64 overflow-auto">
                                <StatuteDisplay code={violation.code} source={violation.source} />
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="history" className="space-y-4">
                  <h3 className="text-lg font-serif font-bold text-primary">Criminal Justice Summary</h3>
                  
                  {data.criminalHistorySummary && (
                    <Card className="bg-muted/20 border-none">
                      <CardContent className="p-4">
                        <p className="text-sm leading-relaxed">{data.criminalHistorySummary}</p>
                      </CardContent>
                    </Card>
                  )}

                  {data.criminalRecords && data.criminalRecords.length > 0 ? (
                    <div className="space-y-3">
                      {[...data.criminalRecords]
                        .sort((a, b) => {
                          // Sort by date, most recent first. "Unknown" dates go to the end.
                          const parseDate = (d: string) => {
                            if (!d || d === 'Unknown') return 0;
                            const parts = d.split('/');
                            if (parts.length === 3) {
                              return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
                            }
                            return 0;
                          };
                          return parseDate(b) - parseDate(a);
                        })
                        .map((record, idx) => (
                        <Card key={record.id} data-testid={`record-item-${idx}`}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-4">
                              <div className="flex-shrink-0 text-center min-w-[60px]">
                                <div className="text-sm font-bold text-foreground">{record.date}</div>
                              </div>
                              <div className="flex-1">
                                <p className="font-bold text-foreground">{record.offense}</p>
                                <p className="text-sm text-muted-foreground">{record.disposition}</p>
                                <p className="text-xs text-muted-foreground mt-1">{record.jurisdiction}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        No prior criminal records found in the Criminal Justice Summary.
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="summary" className="space-y-4">
                  <h3 className="text-lg font-serif font-bold text-primary">Case Synopsis</h3>
                  <Card>
                    <CardContent className="p-6">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {data.summary || 'Analysis in progress. Synopsis will be available soon.'}
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        </div>
      </div>
    </AppShell>
  );
}
