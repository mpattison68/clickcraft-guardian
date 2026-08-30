import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — ClickCraft Site Monitor" },
      { name: "description", content: "Administrator sign in for the ClickCraft Site Monitor operations console." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Sign in — ClickCraft Site Monitor" },
      { property: "og:description", content: "Administrator sign in for the ClickCraft monitoring console." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<{ user: unknown }>("/auth/me"),
    retry: false,
  });
  const setup = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiGet<{ administratorConfigured: boolean }>("/auth/setup-status"),
    retry: false,
  });

  useEffect(() => {
    if (me.data) void navigate({ to: "/" });
  }, [me.data, navigate]);

  const login = useMutation({
    mutationFn: () => apiPost("/auth/login", { email, password }),
    onSuccess: () => {
      void me.refetch().then(() => navigate({ to: "/" }));
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="size-6 text-primary" />
          <div>
            <div className="text-base font-semibold">ClickCraft Site Monitor</div>
            <div className="text-xs text-muted-foreground">Private operations console</div>
          </div>
        </div>

        <form
          className="panel space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {login.isError ? (
            <p className="rounded-md bg-critical-soft/40 px-3 py-2 text-xs text-critical">
              {(login.error as Error).message}
            </p>
          ) : null}

          {setup.data && !setup.data.administratorConfigured ? (
            <p className="rounded-md bg-warning-soft/40 px-3 py-2 text-xs text-warning">
              No administrator exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server .env file
              and restart the containers.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={login.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Lock className="size-4" />
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Access is restricted. There is no public registration.
        </p>
      </div>
    </div>
  );
}
