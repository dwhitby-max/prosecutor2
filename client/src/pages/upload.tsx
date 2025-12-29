import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileText, CheckCircle2, Loader2, ArrowRight, User } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const STEPS = [
  { id: "upload", label: "Uploading Documents" },
  { id: "ocr", label: "Extracting Text (OCR)" },
  { id: "utah", label: "Scanning Utah State Code" },
  { id: "wvc", label: "Scanning West Valley City Code" },
  { id: "history", label: "Analyzing Criminal History" },
  { id: "synthesis", label: "Synthesizing Report" },
];

interface AssignableUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

export default function UploadPage() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (isAuthenticated && (user?.role === "services" || user?.role === "company" || user?.role === "admin")) {
      setLoadingUsers(true);
      fetch("/api/users/assignable", { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            setAssignableUsers(data.users || []);
          }
        })
        .catch(err => console.error("Failed to load assignable users:", err))
        .finally(() => setLoadingUsers(false));
    }
  }, [isAuthenticated, user?.role]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024
  } as any);

  const startAnalysis = async () => {
    if (files.length === 0) return;
    
    setIsAnalyzing(true);
    setProgress(0);
    setCurrentStep(0);
    setError(null);

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('pdfs', file));
      
      if (selectedUserId) {
        formData.append('assignedToUserId', selectedUserId);
      }

      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 2, 95));
      }, 100);

      const stepInterval = setInterval(() => {
        setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
      }, 1500);

      const response = await fetch('/api/cases/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      clearInterval(progressInterval);
      clearInterval(stepInterval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      setProgress(100);
      setCurrentStep(STEPS.length - 1);

      // Always redirect back to dashboard after upload
      setTimeout(() => {
        setLocation('/');
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setIsAnalyzing(false);
    }
  };

  const getDisplayName = (u: AssignableUser) => {
    if (u.firstName && u.lastName) {
      return `${u.firstName} ${u.lastName}`;
    }
    return u.email || "Unknown User";
  };

  const canAssign = user?.role === "services" || user?.role === "company" || user?.role === "admin";

  return (
    <AppShell>
      <div className="flex-1 p-8 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold font-serif text-primary mb-2" data-testid="heading-upload">Upload Case Documents</h1>
            <p className="text-muted-foreground">Upload police reports, citations, or court documents (PDF) for automated screening.</p>
          </div>

          {!isAnalyzing ? (
            <div className="space-y-6">
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer bg-card hover:bg-muted/50",
                  isDragActive ? "border-primary bg-primary/5 ring-4 ring-primary/10" : "border-border",
                  files.length > 0 ? "border-green-500/50 bg-green-50/50" : ""
                )}
                data-testid="dropzone-upload"
              >
                <input {...(getInputProps() as any)} />
                <div className="flex flex-col items-center gap-4">
                  <div className={cn("h-16 w-16 rounded-full flex items-center justify-center transition-colors", files.length > 0 ? "bg-green-100 text-green-600" : "bg-primary/10 text-primary")}>
                    {files.length > 0 ? <CheckCircle2 className="h-8 w-8" /> : <UploadCloud className="h-8 w-8" />}
                  </div>
                  {files.length > 0 ? (
                    <div>
                      <p className="text-lg font-medium text-foreground">{files.length} file(s) selected</p>
                      <p className="text-sm text-muted-foreground mt-1">Click to change or drag more files</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-lg font-medium text-foreground">Drag & drop files here, or click to select</p>
                      <p className="text-sm text-muted-foreground mt-1">Supports PDF (Max 50MB)</p>
                    </div>
                  )}
                </div>
              </div>

              {files.length > 0 && (
                <div className="bg-card border rounded-lg p-4 divide-y">
                  {files.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 first:pt-0 last:pb-0" data-testid={`file-item-${idx}`}>
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium">{file.name}</span>
                        <span className="text-xs text-muted-foreground">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                      </div>
                      <div className="flex items-center text-green-600 text-xs font-medium bg-green-100 px-2 py-1 rounded">
                        Ready
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canAssign && assignableUsers.length > 0 && (
                <div className="bg-card border rounded-lg p-4 space-y-3">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" />
                    Assign to User (Optional)
                  </Label>
                  {loadingUsers ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading users...
                    </div>
                  ) : (
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a user to assign this case..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Unassigned</SelectItem>
                        {assignableUsers.map(u => (
                          <SelectItem key={u.id} value={u.id}>
                            {getDisplayName(u)} ({u.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm" data-testid="error-message">
                  {error}
                </div>
              )}

              <div className="flex justify-center pt-4">
                <button
                  onClick={startAnalysis}
                  disabled={files.length === 0}
                  data-testid="button-start-analysis"
                  className={cn(
                    "px-8 py-3 rounded-lg font-medium text-white shadow-lg transition-all flex items-center gap-2",
                    files.length > 0
                      ? "bg-primary hover:bg-primary/90 hover:scale-[1.02] cursor-pointer"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Start Analysis <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-card border rounded-xl p-8 shadow-sm max-w-xl mx-auto">
              <div className="mb-8 text-center">
                <div className="h-16 w-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
                <h2 className="text-xl font-bold text-foreground" data-testid="status-analyzing">Analyzing Documents</h2>
                <p className="text-sm text-muted-foreground mt-1">Please wait while the system analyzes your case files...</p>
              </div>

              <div className="space-y-6">
                <Progress value={progress} className="h-2" data-testid="progress-bar" />

                <div className="space-y-3">
                  {STEPS.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-3" data-testid={`step-${step.id}`}>
                      <div className={cn(
                        "h-5 w-5 rounded-full flex items-center justify-center text-[10px] border",
                        index < currentStep ? "bg-green-500 border-green-500 text-white" :
                        index === currentStep ? "border-primary text-primary animate-pulse" :
                        "border-muted-foreground/30 text-transparent"
                      )}>
                        {index < currentStep && <CheckCircle2 className="h-3 w-3" />}
                        {index === currentStep && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <span className={cn(
                        "text-sm transition-colors",
                        index <= currentStep ? "text-foreground font-medium" : "text-muted-foreground/50"
                      )}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
