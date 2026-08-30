import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sites", label: "Sites", icon: Globe },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/vps", label: "VPS Health", icon: Server },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

interface MeResponse {
  user: { id: number; email: string; role: string };
}

/** Application chrome plus the client-side auth gate (the API enforces auth server-side). */
export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const me = useQuery({ queryKey: ["me"], queryFn: () => apiGet<MeResponse>("/auth/me"), retry: false });

  useEffect(() => {
    if (me.isError) void navigate({ to: "/login" });
  }, [me.isError, navigate]);

  const logout = useMutation({
    mutationFn: () => apiPost("/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Activity className="mr-2 size-4 animate-pulse" /> Loading console…
      </div>
    );
  }
  if (!me.data) return null;

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 border-r border-border bg-surface transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Activity className="size-5 text-primary" />
          <div className="text-sm font-semibold leading-tight">
            ClickCraft
            <div className="text-[11px] font-normal text-muted-foreground">Site Monitor</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-border p-3 text-xs">
          <div className="truncate text-muted-foreground">{me.data.user.email}</div>
          <button
            className="mt-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
