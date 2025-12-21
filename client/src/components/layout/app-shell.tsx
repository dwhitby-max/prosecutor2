import { Link, useLocation } from "wouter";
import { LayoutDashboard, UploadCloud, FileText, Settings, Scale, Users, LogIn, LogOut, Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const roleLabels: Record<string, string> = {
  user: "User",
  services: "Services",
  company: "Company Admin",
  admin: "Administrator",
};

export function Sidebar() {
  const [location] = useLocation();
  const { user, isLoading, isAuthenticated, logout, isLoggingOut } = useAuth();

  const getNavItems = () => {
    const baseItems = [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/upload", label: "New Analysis", icon: UploadCloud },
      { href: "/cases", label: "Case Archives", icon: FileText },
    ];

    if (!user) return baseItems;

    const items = [...baseItems];
    
    if (user.role === "company" || user.role === "admin") {
      items.push({ href: "/company", label: "Company", icon: Building2 });
    }
    
    if (user.role === "admin") {
      items.push({ href: "/admin", label: "Admin", icon: Users });
    }

    items.push({ href: "/settings", label: "Settings", icon: Settings });

    return items;
  };

  const navItems = getNavItems();

  const getInitials = () => {
    if (!user) return "?";
    if (user.firstName && user.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  const getDisplayName = () => {
    if (!user) return "Guest";
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.email || "User";
  };

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border">
        <Scale className="h-6 w-6 text-sidebar-primary mr-2" />
        <span className="text-xl font-serif font-bold tracking-tight">CaseFlow</span>
      </div>

      <div className="flex-1 overflow-y-auto py-6">
        <nav className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 px-6">
          <h3 className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3">
            System Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center text-xs text-sidebar-foreground/70">
              <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
              Utah Code Database: <span className="ml-auto text-green-500">Online</span>
            </div>
            <div className="flex items-center text-xs text-sidebar-foreground/70">
              <div className="h-2 w-2 rounded-full bg-green-500 mr-2" />
              WVC Code Database: <span className="ml-auto text-green-500">Online</span>
            </div>
            <div className="flex items-center text-xs text-sidebar-foreground/70">
              <div className="h-2 w-2 rounded-full bg-amber-500 mr-2" />
              Criminal History: <span className="ml-auto text-amber-500">Slow</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-sidebar-border p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-sidebar-foreground/50" />
          </div>
        ) : isAuthenticated && user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {user.profileImageUrl ? (
                <img 
                  src={user.profileImageUrl} 
                  alt={getDisplayName()}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold text-xs">
                  {getInitials()}
                </div>
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{getDisplayName()}</span>
                <span className="text-xs text-sidebar-foreground/50">{roleLabels[user.role] || user.role}</span>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={() => logout()}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Sign Out
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button 
              variant="default" 
              size="sm" 
              className="w-full"
              onClick={() => window.location.href = "/api/login"}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign In
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={() => window.location.href = "/api/login"}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign Up
            </Button>
            <p className="text-xs text-center text-sidebar-foreground/50">
              Use Google, GitHub, or email
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background font-sans text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
