import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, AlertTriangle, History, User, CheckCircle2, XCircle, Loader2, Building, Image, Scale, ChevronDown } from "lucide-react";
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
  chargeType: 'current' | 'historical' | null;
  source: string;
  description: string;
  statuteText: string | null;
  statuteUrl: string | null;
  criteria: string[];
  isViolated: boolean;
  confidence: number;
  reasoning: string;
};

type CriminalRecord = {
  id: string;
  date: string;
  offense: string;
  disposition: string;
  jurisdiction: string;
};

type CaseImage = {
  id: string;
  filename: string;
  mimeType: string;
  imageData: string;
  pageNumber: number | null;
};

type CaseDocument = {
  id: string;
  filename: string;
  uploadPath: string | null;
};

type CaseData = {
  id: string;
  caseNumber: string;
  defendantName: string;
  defendantDOB: string | null;
  uploadDate: string;
  status: string;
  summary: string | null;
  rawOfficerActions: string | null;
  criminalHistorySummary: string | null;
  bookedIntoJail: boolean | null;
  caseSummaryNarrative: string | null;
  legalAnalysis: string | null;
  violations: Violation[];
  criminalRecords: CriminalRecord[];
  images: CaseImage[];
  documents: CaseDocument[];
};

export default function AnalysisPage() {
  const [, params] = useRoute("/analysis/:id");
  const caseId = params?.id;
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [showFullOfficerActions, setShowFullOfficerActions] = useState(false);
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

  // Filter to show only current charges (not historical/criminal history citations)
  // Strictly require chargeType === 'current' - null means old data that needs reprocessing
  const currentViolations = (data.violations || []).filter(v => v.chargeType === 'current');
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
                  
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t">
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
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Case Documents</p>
                      {data.documents && data.documents.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {data.documents.map((doc) => (
                            doc.uploadPath ? (
                              <a 
                                key={doc.id}
                                href={doc.uploadPath}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-primary hover:underline flex items-center gap-1"
                              >
                                <FileText className="h-3 w-3" />
                                {doc.filename}
                              </a>
                            ) : (
                              <span key={doc.id} className="text-sm text-muted-foreground">{doc.filename}</span>
                            )
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">No documents</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="case-summary" className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-4">
                  <TabsTrigger value="case-summary" className="gap-2" data-testid="tab-case-summary">
                    <FileText className="h-4 w-4" /> Case Summary
                  </TabsTrigger>
                  <TabsTrigger value="legal-analysis" className="gap-2" data-testid="tab-legal-analysis">
                    <Scale className="h-4 w-4" /> Legal Analysis
                  </TabsTrigger>
                  <TabsTrigger value="state-code" className="gap-2" data-testid="tab-state-code">
                    <Scale className="h-4 w-4" /> State Code
                  </TabsTrigger>
                  <TabsTrigger value="synopsis" className="gap-2" data-testid="tab-synopsis">
                    <User className="h-4 w-4" /> Analysis Summary
                  </TabsTrigger>
                  <TabsTrigger value="images" className="gap-2" data-testid="tab-images">
                    <Image className="h-4 w-4" /> Images
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="case-summary" className="space-y-4">
                  {currentViolations.length > 0 && (
                    <Card>
                      <CardContent className="p-6">
                        <h3 className="text-lg font-serif font-bold text-primary mb-4 flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5" /> Current Case Charges ({currentViolations.length})
                        </h3>
                        <div className="space-y-2">
                          {currentViolations.map((v) => (
                            <div key={v.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-semibold text-primary">{v.code}</span>
                                {v.chargeName && (
                                  <span className="text-sm text-foreground">{v.chargeName}</span>
                                )}
                              </div>
                              {v.chargeClass && (
                                <Badge variant="outline" className="text-xs">
                                  {v.chargeClass}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="text-lg font-serif font-bold text-primary mb-4 flex items-center gap-2">
                        <FileText className="h-5 w-5" /> Case Summary
                      </h3>
                      {data.caseSummaryNarrative ? (
                        <div className="prose prose-sm max-w-none">
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                            {data.caseSummaryNarrative}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {data.status === 'processing' 
                            ? 'Case summary is being generated...' 
                            : 'No case summary available. The AI analysis may not have run for this case.'}
                        </p>
                      )}
                      
                      {data.rawOfficerActions && (
                        <div className="mt-6 pt-4 border-t">
                          <button
                            onClick={() => setShowFullOfficerActions(!showFullOfficerActions)}
                            className="text-sm text-primary hover:text-primary/80 underline flex items-center gap-1 font-medium"
                          >
                            {showFullOfficerActions ? 'Hide' : 'View'} Full Officer's Actions
                            <ChevronDown className={cn("h-4 w-4 transition-transform", showFullOfficerActions && "rotate-180")} />
                          </button>
                          
                          {showFullOfficerActions && (
                            <div className="mt-4 p-4 bg-muted/50 rounded-lg overflow-auto">
                              <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">
                                Officer's Actions from General Offense Hardcopy
                              </p>
                              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                {data.rawOfficerActions}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="legal-analysis" className="space-y-4">
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="text-lg font-serif font-bold text-primary mb-4 flex items-center gap-2">
                        <Scale className="h-5 w-5" /> Legal Analysis
                      </h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        AI-generated analysis comparing case facts against applicable statutes
                      </p>
                      {data.legalAnalysis ? (
                        <div className="prose prose-sm max-w-none">
                          <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed" 
                               dangerouslySetInnerHTML={{ 
                                 __html: data.legalAnalysis
                                   .replace(/^## (.+)$/gm, '<h4 class="text-base font-bold text-primary mt-4 mb-2">$1</h4>')
                                   .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
                                   .replace(/---/g, '<hr class="my-4 border-t border-gray-200" />')
                                   .replace(/\n/g, '<br />')
                               }} 
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {data.status === 'processing' 
                            ? 'Legal analysis is being generated...' 
                            : 'No legal analysis available. The AI analysis may not have run for this case.'}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="state-code" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-serif font-bold text-primary">
                      Applicable Utah State Code
                    </h3>
                  </div>

                  {currentViolations.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        No charges detected. State code will be shown when charges are identified.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {currentViolations.map((violation, idx) => (
                        <Card key={violation.id} className="border-l-4 border-l-blue-500" data-testid={`statute-item-${idx}`}>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-mono">
                                {violation.code}
                              </Badge>
                              {violation.chargeName && (
                                <span className="font-medium text-foreground">{violation.chargeName}</span>
                              )}
                            </div>
                            <div className="overflow-auto">
                              <StatuteDisplay code={violation.code} source={violation.source} />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="synopsis" className="space-y-4">
                  <h3 className="text-lg font-serif font-bold text-primary">Analysis Summary</h3>
                  <Card>
                    <CardContent className="p-6">
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          AI-Generated Summary
                        </p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {data.summary || 'Analysis in progress. Summary will be available soon.'}
                        </p>
                      </div>
                      
                      {data.rawOfficerActions && (
                        <div className="pt-4 border-t">
                          <button
                            onClick={() => setShowFullOfficerActions(!showFullOfficerActions)}
                            className="text-sm text-primary hover:text-primary/80 underline flex items-center gap-1 font-medium"
                          >
                            {showFullOfficerActions ? 'Hide' : 'View'} Full Officer's Actions
                            <ChevronDown className={cn("h-4 w-4 transition-transform", showFullOfficerActions && "rotate-180")} />
                          </button>
                          
                          {showFullOfficerActions && (
                            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                              <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-semibold">
                                Officer's Actions from General Offense Hardcopy
                              </p>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                {data.rawOfficerActions}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="images" className="space-y-4">
                  <h3 className="text-lg font-serif font-bold text-primary">Extracted Images ({data.images?.length || 0})</h3>
                  {data.images && data.images.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {data.images.map((image, idx) => (
                        <Card key={image.id} className="overflow-hidden">
                          <CardContent className="p-2">
                            <img 
                              src={`data:${image.mimeType};base64,${image.imageData}`}
                              alt={image.filename}
                              className="w-full h-auto rounded-md object-contain max-h-64"
                            />
                            <p className="text-xs text-muted-foreground mt-2 truncate">{image.filename}</p>
                            {image.pageNumber && (
                              <Badge variant="secondary" className="text-[10px] mt-1">Page {image.pageNumber}</Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        No images were extracted from this case's documents.
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
              
              {/* Criminal History Section - Dedicated section at the bottom */}
              <div className="mt-8 p-4 bg-amber-50 border-2 border-amber-300 rounded-lg" data-testid="section-criminal-history">
                <h3 className="text-lg font-serif font-bold text-amber-800 mb-4 flex items-center gap-2">
                  <History className="h-5 w-5" /> Criminal History ({data.criminalRecords?.length || 0} Prior Records)
                </h3>
                
                {data.criminalHistorySummary && (
                  <Card className="bg-white border-amber-200 mb-4">
                    <CardContent className="p-4">
                      <p className="text-sm leading-relaxed text-amber-900">{data.criminalHistorySummary}</p>
                    </CardContent>
                  </Card>
                )}

                {data.criminalRecords && data.criminalRecords.length > 0 ? (
                  <div className="space-y-3">
                    {[...data.criminalRecords]
                      .sort((a, b) => {
                        const parseDate = (d: string | undefined) => {
                          if (!d || d === 'Unknown') return 0;
                          const parts = d.split('/');
                          if (parts.length === 3) {
                            return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
                          }
                          return 0;
                        };
                        return parseDate(b.date) - parseDate(a.date);
                      })
                      .slice(0, 15)
                      .map((record, idx) => (
                      <Card key={record.id} className="bg-white border-amber-200" data-testid={`history-record-${idx}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 text-center min-w-[60px]">
                              <div className="text-xs font-bold text-amber-800">{record.date}</div>
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-sm text-foreground">{record.offense}</p>
                              <p className="text-xs text-muted-foreground">{record.disposition} • {record.jurisdiction}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {data.criminalRecords.length > 15 && (
                      <p className="text-xs text-amber-700 text-center">
                        Showing 15 of {data.criminalRecords.length} records.
                      </p>
                    )}
                  </div>
                ) : (
                  <Card className="bg-white border-amber-200">
                    <CardContent className="p-6 text-center text-muted-foreground">
                      No prior criminal records found.
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </AppShell>
  );
}
