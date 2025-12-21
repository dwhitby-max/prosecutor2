import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { Users, Clock, FileText, Calendar, TrendingUp, Loader2, Building2, Shield, Plus, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

type AdminStats = {
  totalCases: number;
  totalUsers: number;
  avgProcessingTimeMs: number | null;
  casesProcessedToday: number;
  casesProcessedThisWeek: number;
  casesProcessedThisMonth: number;
};

type ProcessingReport = {
  averageTimeMs: number | null;
  minTimeMs: number | null;
  maxTimeMs: number | null;
  totalCases: number;
  casesByDay: Array<{ date: string; count: number; avgTimeMs: number | null }>;
};

type User = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  companyId: string | null;
  companyName: string | null;
  createdAt: string | null;
};

type Company = {
  id: string;
  name: string;
  status: string;
  createdAt: string | null;
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
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Admin() {
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [processingReport, setProcessingReport] = useState<ProcessingReport | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    
    if (!currentUser || currentUser.role !== "admin") {
      setLocation("/");
      return;
    }

    async function fetchData() {
      try {
        const [statsRes, reportRes, usersRes, companiesRes] = await Promise.all([
          fetch("/api/admin/stats", { credentials: "include" }),
          fetch("/api/admin/processing-report", { credentials: "include" }),
          fetch("/api/admin/users", { credentials: "include" }),
          fetch("/api/admin/companies", { credentials: "include" }),
        ]);

        if (statsRes.ok) {
          const result = await statsRes.json();
          setStats(result.data);
        }
        if (reportRes.ok) {
          const result = await reportRes.json();
          setProcessingReport(result.data);
        }
        if (usersRes.ok) {
          const result = await usersRes.json();
          setUsers(result.users || []);
        }
        if (companiesRes.ok) {
          const result = await companiesRes.json();
          setCompanies(result.companies || []);
        }
      } catch (err) {
        console.error("Failed to load admin data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [currentUser, authLoading, setLocation]);

  const updateUserRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      }
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const updateUserStatus = async (userId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const updateUserCompany = async (userId: string, companyId: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/company`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: companyId || null }),
      });
      if (res.ok) {
        const company = companies.find(c => c.id === companyId);
        setUsers(prev => prev.map(u => 
          u.id === userId ? { ...u, companyId, companyName: company?.name || null } : u
        ));
      }
    } catch (err) {
      console.error("Failed to update company:", err);
    }
  };

  const createCompany = async () => {
    if (!newCompanyName.trim()) return;
    setIsCreatingCompany(true);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newCompanyName }),
      });
      if (res.ok) {
        const result = await res.json();
        setCompanies(prev => [...prev, result.company]);
        setNewCompanyName("");
        setCompanyDialogOpen(false);
      }
    } catch (err) {
      console.error("Failed to create company:", err);
    } finally {
      setIsCreatingCompany(false);
    }
  };

  const getDisplayName = (u: User) => {
    if (u.firstName && u.lastName) {
      return `${u.firstName} ${u.lastName}`;
    }
    return u.email || "Unknown User";
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

  if (!currentUser || currentUser.role !== "admin") {
    return null;
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold font-serif text-primary">Admin Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
              <FileText className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalCases ?? 0}</div>
              <p className="text-xs text-muted-foreground">All time processed cases</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users.length}</div>
              <p className="text-xs text-muted-foreground">Registered users</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Companies</CardTitle>
              <Building2 className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{companies.length}</div>
              <p className="text-xs text-muted-foreground">Active organizations</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cases Today</CardTitle>
              <Calendar className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.casesProcessedToday ?? 0}</div>
              <p className="text-xs text-muted-foreground">{stats?.casesProcessedThisWeek ?? 0} this week</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" />
                Companies ({companies.length})
              </CardTitle>
              <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" /> Add Company
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Company</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="company-name">Company Name</Label>
                      <Input
                        id="company-name"
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="Enter company name"
                      />
                    </div>
                    <Button onClick={createCompany} disabled={isCreatingCompany || !newCompanyName.trim()}>
                      {isCreatingCompany && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create Company
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {companies.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {companies.map((company) => (
                    <div key={company.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{company.name}</p>
                        <p className="text-xs text-muted-foreground">Created {formatDate(company.createdAt)}</p>
                      </div>
                      <Badge className={statusColors[company.status]}>{company.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No companies created yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Processing Time Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {processingReport ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Average</p>
                      <p className="text-lg font-semibold">{formatDuration(processingReport.averageTimeMs)}</p>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Fastest</p>
                      <p className="text-lg font-semibold text-green-600">{formatDuration(processingReport.minTimeMs)}</p>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Slowest</p>
                      <p className="text-lg font-semibold text-orange-600">{formatDuration(processingReport.maxTimeMs)}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No processing data available</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-green-500" />
              User Management ({users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {users.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium text-sm">User</th>
                      <th className="text-left p-2 font-medium text-sm">Role</th>
                      <th className="text-left p-2 font-medium text-sm">Status</th>
                      <th className="text-left p-2 font-medium text-sm">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="p-2">
                          <div>
                            <p className="font-medium">{getDisplayName(u)}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </td>
                        <td className="p-2">
                          <Select value={u.role} onValueChange={(v) => updateUserRole(u.id, v)}>
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="services">Services</SelectItem>
                              <SelectItem value="company">Company Admin</SelectItem>
                              <SelectItem value="admin">Administrator</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Select value={u.status} onValueChange={(v) => updateUserStatus(u.id, v)}>
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Select value={u.companyId || ""} onValueChange={(v) => updateUserCompany(u.id, v)}>
                            <SelectTrigger className="w-40">
                              <SelectValue placeholder="No company" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">No company</SelectItem>
                              {companies.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground">No users found</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
