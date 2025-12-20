import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { Users, Clock, FileText, Calendar, TrendingUp, Loader2 } from "lucide-react";

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
  id: number;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [processingReport, setProcessingReport] = useState<ProcessingReport | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, reportRes, usersRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/processing-report"),
          fetch("/api/admin/users"),
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
          setUsers(result.data?.users || []);
        }
      } catch (err) {
        console.error("Failed to load admin data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Admin Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
              <FileText className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalCases ?? 0}</div>
              <p className="text-xs text-muted-foreground">
                All time processed cases
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalUsers ?? 0}</div>
              <p className="text-xs text-muted-foreground">
                Registered users
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg. Processing Time</CardTitle>
              <Clock className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatDuration(stats?.avgProcessingTimeMs ?? null)}
              </div>
              <p className="text-xs text-muted-foreground">
                Per case average
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cases Today</CardTitle>
              <Calendar className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.casesProcessedToday ?? 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.casesProcessedThisWeek ?? 0} this week
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                Processing Time Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {processingReport ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-500">Average</p>
                      <p className="text-lg font-semibold">
                        {formatDuration(processingReport.averageTimeMs)}
                      </p>
                    </div>
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-500">Fastest</p>
                      <p className="text-lg font-semibold text-green-600">
                        {formatDuration(processingReport.minTimeMs)}
                      </p>
                    </div>
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-500">Slowest</p>
                      <p className="text-lg font-semibold text-orange-600">
                        {formatDuration(processingReport.maxTimeMs)}
                      </p>
                    </div>
                  </div>

                  {processingReport.casesByDay.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Cases by Day</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {processingReport.casesByDay.slice(-10).map((day) => (
                          <div
                            key={day.date}
                            className="flex items-center justify-between p-2 bg-slate-50 rounded"
                          >
                            <span className="text-sm">{formatDate(day.date)}</span>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-medium">{day.count} cases</span>
                              <span className="text-xs text-slate-500">
                                avg: {formatDuration(day.avgTimeMs)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500">No processing data available</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-green-500" />
                Users ({users.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {users.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{user.displayName}</p>
                        <p className="text-sm text-slate-500">@{user.username}</p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {user.role}
                        </span>
                        <p className="text-xs text-slate-400 mt-1">
                          {formatDate(user.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">No users found</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600">This Month</p>
                <p className="text-3xl font-bold text-blue-700">
                  {stats?.casesProcessedThisMonth ?? 0}
                </p>
                <p className="text-xs text-blue-500">cases processed</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600">This Week</p>
                <p className="text-3xl font-bold text-green-700">
                  {stats?.casesProcessedThisWeek ?? 0}
                </p>
                <p className="text-xs text-green-500">cases processed</p>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <p className="text-sm text-purple-600">Today</p>
                <p className="text-3xl font-bold text-purple-700">
                  {stats?.casesProcessedToday ?? 0}
                </p>
                <p className="text-xs text-purple-500">cases processed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
