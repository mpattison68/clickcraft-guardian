import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { createLogger } from "../logger.js";

const log = createLogger("auth");

function secret(): string {
  if (!config.auth.sessionSecret) {
    if (config.isProd) throw new Error("SESSION_SECRET must be set in production");
    return "development-only-insecure-secret";
  }
  return config.auth.sessionSecret;
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

function pack(id: string): string {
  return `${id}.${sign(id)}`;
}

function unpack(token: string | undefined): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}

export interface SessionUser {
  id: number;
  email: string;
  role: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    sessionId?: string;
  }
}

export async function createSession(res: Response, userId: number): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.auth.sessionTtlHours * 3600_000);
  await query("INSERT INTO sessions(id, user_id, expires_at) VALUES ($1,$2,$3)", [
    id,
    userId,
    expires,
  ]);
  res.cookie(config.auth.cookieName, pack(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    expires,
  });
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const id = unpack(req.cookies?.[config.auth.cookieName]);
  if (id) await query("DELETE FROM sessions WHERE id = $1", [id]).catch(() => undefined);
  res.clearCookie(config.auth.cookieName, { path: "/" });
}

export async function loadUser(req: Request): Promise<SessionUser | null> {
  const id = unpack(req.cookies?.[config.auth.cookieName]);
  if (!id) return null;
  const res = await query<{ id: number; email: string; role: string; expires_at: Date }>(
    `SELECT u.id, u.email, u.role, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query("DELETE FROM sessions WHERE id = $1", [id]).catch(() => undefined);
    return null;
  }
  req.sessionId = id;
  return { id: Number(row.id), email: row.email, role: row.role };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await loadUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = user;
    next();
  } catch (e) {
    log.error("session lookup failed", { error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: "Session error" });
  }
}

/**
 * Same-origin / CSRF protection for cookie-authenticated mutations.
 * The SPA always sends this header; cross-site form posts cannot.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") === "clickcraft-monitor") return next();
  res.status(403).json({ error: "Invalid request origin" });
}

export async function purgeExpiredSessions(): Promise<void> {
  await query("DELETE FROM sessions WHERE expires_at < now()").catch(() => undefined);
}
