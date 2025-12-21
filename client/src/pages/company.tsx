import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { Users, FileText, Building2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Link } from "wouter";

type CompanyUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
};

type Case = {
  id: string;
  caseNumber: string;
  defendantName: string;
  status: string;
  uploadDate: string;
  assignedToUserId: string | null;
};

const roleLabels: Record<string, string> = {
  user: "User",
  services: "Services",
  company: "Company Admin",
  admin: "Administrator",
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-yellow-100 text-yellow-800",
  inactive: "bg-gray-100 text-gray-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  flagged: "bg-red-100 text-red-800",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CompanyDashboard() {
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    
    if (!currentUser || (currentUser.role !== "company" && currentUser.role !== "admin")) {
      setLocation("/");
      return;
    }

    async function fetchData() {
      try {
        const usersRes = await fetch("/api/users/assignable", { credentials: "include" });
        if (usersRes.ok) {
          const result = await usersRes.json();
          setUsers(result.users || []);
        }

        const casesRes = await fetch("/api/cases", { credentials: "include" });
        if (casesRes.ok) {
          const result = await casesRes.json();
          setCases(result.cases || []);
        }
      } catch (err) {
        console.error("Failed to load company data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [currentUser, authLoading, setLocation]);

  const getDisplayName = (u: CompanyUser) => {
    if (u.firstName && u.lastName) {
      return `${u.firstName} ${u.lastName}`;
    }
    return u.email || "Unknown User";
  };

  const getAssigneeName = (assignedToUserId: string | null) => {
    if (!assignedToUserId) return "Unassigned";
    const user = users.find(u => u.id === assignedToUserId);
    return user ? getDisplayName(user) : "Unknown";
  };

  if (authLoading || loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!currentUser || (currentUser.role !== "company" && currentUser.role !== "admin")) {
    return null;
  }

  const activeUsers = users.filter(u => u.status === "active").length;
  const activeCases = cases.filter(c => c.status !== "completed").length;
  const completedCases = cases.filter(c => c.status === "completed").length;

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold font-serif text-primary">Company Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Team Members</CardTitle>
              <Users className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users.length}</div>
              <p className="text-xs text-muted-foreground">{activeUsers} active</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Cases</CardTitle>
              <FileText className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeCases}</div>
              <p className="text-xs text-muted-foreground">In progress</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed Cases</CardTitle>
              <Building2 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completedCases}</div>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-green-500" />
                Team Members ({users.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {users.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{getDisplayName(u)}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{roleLabels[u.role] || u.role}</Badge>
                        <Badge className={statusColors[u.status]}>{u.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No team members found</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-500" />
                Recent Cases ({cases.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cases.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {cases.slice(0, 10).map((c) => (
                    <Link key={c.id} href={`/analysis/${c.id}`}>
                      <a className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors">
                        <div>
                          <p className="font-medium">{c.defendantName}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.caseNumber} - {formatDate(c.uploadDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge className={statusColors[c.status]}>{c.status}</Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {getAssigneeName(c.assignedToUserId)}
                          </p>
                        </div>
                      </a>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No cases found</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
