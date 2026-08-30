import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { verifyPassword } from "../../auth/passwords.js";
import { createSession, destroySession, loadUser, requireAuth } from "../../auth/session.js";
import { config } from "../../config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("api.auth");
export const authRouter: Router = Router();

const attempts = new Map<string, { count: number; first: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > config.auth.loginRateLimitWindowMs) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  entry.count += 1;
  return entry.count > config.auth.loginRateLimitMax;
}

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(512),
});

authRouter.post("/login", async (req, res) => {
  const key = req.ip ?? "unknown";
  if (rateLimited(key)) {
    log.warn("login rate limited", { ip: key });
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const { email, password } = parsed.data;
  const result = await query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  const user = result.rows[0];
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok || !user) {
    log.warn("failed login attempt", { email });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  attempts.delete(key);
  await createSession(res, user.id);
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  log.info("login successful", { userId: user.id });
  res.json({ user: { id: user.id, email } });
});

authRouter.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  const user = await loadUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user });
});

authRouter.get("/setup-status", async (_req, res) => {
  const result = await query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  res.json({ administratorConfigured: Number(result.rows[0]?.count ?? 0) > 0 });
});

authRouter.get("/protected-ping", requireAuth, (_req, res) => res.json({ ok: true }));
