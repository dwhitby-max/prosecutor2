import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { ShieldAlert, FileText, Clock, Loader2, Trash2, CheckSquare, Square, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type CaseListItem = {
  id: string;
  caseNumber: string;
  defendantName: string;
  uploadDate: string;
  status: string;
  isMarkedComplete: boolean;
};

export default function Dashboard() {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [completedCases, setCompletedCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [selectedActiveForDelete, setSelectedActiveForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteSource, setDeleteSource] = useState<'active' | 'completed'>('completed');

  const fetchCases = async () => {
    try {
      const [activeRes, completedRes] = await Promise.all([
        fetch('/api/cases?filter=active'),
        fetch('/api/cases?filter=completed')
      ]);
      
      if (activeRes.ok) {
        const activeResult = await activeRes.json();
        setCases(activeResult.cases || []);
      }
      if (completedRes.ok) {
        const completedResult = await completedRes.json();
        setCompletedCases(completedResult.cases || []);
      }
    } catch (err) {
      console.error('Failed to load cases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const toggleSelect = (id: string, isActive: boolean) => {
    if (isActive) {
      const newSelected = new Set(selectedActiveForDelete);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedActiveForDelete(newSelected);
    } else {
      const newSelected = new Set(selectedForDelete);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedForDelete(newSelected);
    }
  };

  const selectAllActive = () => {
    if (selectedActiveForDelete.size === cases.length) {
      setSelectedActiveForDelete(new Set());
    } else {
      setSelectedActiveForDelete(new Set(cases.map(c => c.id)));
    }
  };

  const selectAllCompleted = () => {
    if (selectedForDelete.size === completedCases.length) {
      setSelectedForDelete(new Set());
    } else {
      setSelectedForDelete(new Set(completedCases.map(c => c.id)));
    }
  };

  const openDeleteDialog = (source: 'active' | 'completed') => {
    setDeleteSource(source);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    const idsToDelete = deleteSource === 'active' 
      ? Array.from(selectedActiveForDelete) 
      : Array.from(selectedForDelete);
    
    if (idsToDelete.length === 0) return;
    
    setDeleting(true);
    try {
      const response = await fetch('/api/cases', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete })
      });
      
      if (response.ok) {
        if (deleteSource === 'active') {
          setSelectedActiveForDelete(new Set());
        } else {
          setSelectedForDelete(new Set());
        }
        await fetchCases();
      }
    } catch (err) {
      console.error('Failed to delete cases:', err);
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const processingCases = cases.filter(c => c.status === 'processing');
  const readyCases = cases.filter(c => c.status === 'completed' || c.status === 'flagged');

  const renderCaseRow = (caseItem: CaseListItem, i: number, showCheckbox = false, isActive = false) => {
    const initials = caseItem.defendantName
      .split(/[,\s]+/)
      .filter(n => n.length > 0)
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    
    const uploadDate = new Date(caseItem.uploadDate);
    const now = new Date();
    const diffMs = now.getTime() - uploadDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const timeAgo = diffHours < 1 ? 'Just now' :
                   diffHours < 24 ? `${diffHours}h ago` :
                   `${Math.floor(diffHours / 24)}d ago`;

    const isSelected = isActive 
      ? selectedActiveForDelete.has(caseItem.id) 
      : selectedForDelete.has(caseItem.id);

    return (
      <div 
        key={caseItem.id} 
        className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
        data-testid={`case-item-${caseItem.id}`}
      >
        <div className="flex items-center gap-4">
          {showCheckbox && (
            <button
              onClick={() => toggleSelect(caseItem.id, isActive)}
              className="p-1 hover:bg-muted rounded"
              data-testid={`checkbox-case-${caseItem.id}`}
            >
              {isSelected ? (
                <CheckSquare className="h-5 w-5 text-primary" />
              ) : (
                <Square className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          )}
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
            {initials || '??'}
          </div>
          <div>
            <p className="font-medium text-sm" data-testid={`text-defendant-${caseItem.id}`}>
              {caseItem.defendantName === 'Unknown' ? 'Unknown Defendant' : caseItem.defendantName}
            </p>
            <p className="text-xs text-muted-foreground">{caseItem.caseNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right hidden md:block">
            <p className="text-sm font-medium capitalize">{caseItem.status}</p>
            <p className="text-xs text-muted-foreground">{timeAgo}</p>
          </div>
          <Link href={`/analysis/${caseItem.id}`}>
            <button 
              className="text-sm border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 rounded-md transition-colors cursor-pointer"
              data-testid={`button-view-case-${caseItem.id}`}
            >
              View Report
            </button>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-serif text-primary" data-testid="heading-dashboard">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Overview of recent case screenings and analysis.</p>
          </div>
          <Link href="/upload">
            <button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium shadow-sm transition-colors cursor-pointer" data-testid="button-new-case">
              + New Case Analysis
            </button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Cases</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total-cases">{cases.length}</div>
              <p className="text-xs text-muted-foreground">Cases in review</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <ShieldAlert className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-completed">{completedCases.length}</div>
              <p className="text-xs text-muted-foreground">Marked complete</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processing</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-processing">{processingCases.length}</div>
              <p className="text-xs text-muted-foreground">In progress</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="active" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="active" data-testid="tab-active-cases">Active Cases ({cases.length})</TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed-cases">Completed ({completedCases.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {loading ? (
              <Card>
                <CardContent className="p-12 flex items-center justify-center">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Loading cases...</p>
                  </div>
                </CardContent>
              </Card>
            ) : cases.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">No active cases</h3>
                  <p className="text-sm text-muted-foreground mb-4">Upload your first case to get started</p>
                  <Link href="/upload">
                    <button className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium shadow-sm transition-colors cursor-pointer">
                      Upload Case Documents
                    </button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={selectAllActive}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                      data-testid="button-select-all-active"
                    >
                      {selectedActiveForDelete.size === cases.length && cases.length > 0 ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      {selectedActiveForDelete.size === cases.length && cases.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                    {selectedActiveForDelete.size > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {selectedActiveForDelete.size} selected
                      </span>
                    )}
                  </div>
                  {selectedActiveForDelete.size > 0 && (
                    <button
                      onClick={() => openDeleteDialog('active')}
                      disabled={deleting}
                      className="flex items-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                      data-testid="button-delete-active"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Selected
                    </button>
                  )}
                </div>
                <Card className="overflow-hidden">
                  <div className="divide-y divide-border">
                    {cases.map((caseItem, i) => renderCaseRow(caseItem, i, true, true))}
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {completedCases.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <ShieldAlert className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">No completed cases</h3>
                  <p className="text-sm text-muted-foreground">Cases will appear here once marked as complete</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={selectAllCompleted}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                      data-testid="button-select-all"
                    >
                      {selectedForDelete.size === completedCases.length && completedCases.length > 0 ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      {selectedForDelete.size === completedCases.length && completedCases.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                    {selectedForDelete.size > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {selectedForDelete.size} selected
                      </span>
                    )}
                  </div>
                  {selectedForDelete.size > 0 && (
                    <button
                      onClick={() => openDeleteDialog('completed')}
                      disabled={deleting}
                      className="flex items-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                      data-testid="button-delete-selected"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Selected
                    </button>
                  )}
                </div>
                <Card className="overflow-hidden">
                  <div className="divide-y divide-border">
                    {completedCases.map((caseItem, i) => renderCaseRow(caseItem, i, true, false))}
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteSource === 'active' ? selectedActiveForDelete.size : selectedForDelete.size} case(s)? 
              This action cannot be undone. All associated documents, violations, criminal records, and images will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Cases
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
