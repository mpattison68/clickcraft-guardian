# ClickCraft Site Monitor

Self-hosted website and VPS monitoring console for ClickCraft infrastructure.
It runs entirely on your own Hostinger VPS with Docker Compose — no external
platform, SaaS backend or managed cloud service is required.

- **Frontend** — React 19 + TypeScript SPA (TanStack Router, Tailwind CSS v4)
- **Backend/API** — Node.js 22 + TypeScript (Express), session auth, PostgreSQL
- **Monitoring worker** — independent Node process: HTTP, SSL/TLS, DNS,
  content, security headers, VPS metrics, Docker status, incidents, alerts
- **Database** — PostgreSQL 16 with a persistent Docker volume

Monitoring runs server-side and continues whether or not anyone is signed in.

---

## 1. Architecture

```
Internet → DNS → Nginx Proxy Manager (TLS)
                    │  shared external Docker network ("proxy")
                    ▼
              app container (clickcraft-monitor-app:4000)
                    │  private internal Docker network ("monitor")
                    ├── /api/*  Express API
                    └── /*      built SPA (static)

worker container ── HTTP / SSL / DNS / content / header checks
                 ── host metrics (/proc, /), Docker status (optional)
                 ── incident engine → Telegram + SMTP alerts
                            │
                     PostgreSQL (private "monitor" network only,
                     no published port, NOT on the proxy network)
```

Both `app` and `worker` are built from the same image and share the database.
The worker resumes automatically after a container or VPS restart because all
state lives in PostgreSQL.

Only the `app` service joins the shared proxy network that Nginx Proxy Manager
uses. `db` and `worker` stay on the private internal network and are never
reachable from the proxy network.

### Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React SPA (routes, components, API client) |
| `server/src/api.ts` | Express API + static SPA hosting |
| `server/src/worker.ts` | Scheduler: checks, metrics, reminders, retention |
| `server/src/checks/` | HTTP, SSL, DNS, security-header, SSRF-guard logic |
| `server/src/monitor/` | Check engine, incidents, retention |
| `server/src/notify/` | Telegram and SMTP channels + dedupe dispatcher |
| `server/src/db/migrations/` | SQL migrations (applied automatically on boot) |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Deployment |

Future modules (external watchdog, synthetic journeys, backup monitoring,
Docker remediation, multiple VPS agents, domain expiry) slot in as additional
worker loops, tables and routes without restructuring.

---

## 2. Local development

Requirements: Node.js 22+, Docker (for PostgreSQL), a `.env` file.

```bash
cp .env.example .env      # then edit values for local development

# 1. Database only
docker compose up -d db

# 2. Backend API (port 4000) — applies migrations and creates the admin user
cd server && npm install && npm run dev

# 3. Monitoring worker (separate terminal)
cd server && npm run dev:worker

# 4. Frontend dev server on http://localhost:5173 (proxies /api to localhost:4000)
npm install && npm run dev:spa
```

`npm run dev:spa` runs the same single-page build that ships in the Docker image.
Override the backend it talks to with `API_PROXY_TARGET=http://host:port npm run dev:spa`.

Set `SEED_DEMO_SITES=true` before first start to create a few example sites.
They are ordinary rows monitored for real, and can be deleted in the UI.

---

## 3. Production deployment (Ubuntu 24.04 + Docker Compose)

```bash
# 1. Clone
cd /opt
git clone <your-repository-url> clickcraft-site-monitor
cd clickcraft-site-monitor

# 2. Create the shared proxy network shared with Nginx Proxy Manager (once)
docker network create npm-proxy
# If NPM is already running, make sure its compose stack is attached to the
# same network (see section 4 below).

# 3. Create the local configuration (never committed)
cp .env.example .env
nano .env
chmod 600 .env
# If your NPM network has a different name, set PROXY_NETWORK_NAME accordingly.

# 4. Build and start
docker compose up -d --build

# 5. Confirm health
docker compose ps
curl -s http://127.0.0.1:4000/api/health
```

### Settings that must be configured before first start

| Variable | Notes |
| --- | --- |
| `APP_PUBLIC_URL` | e.g. `https://monitor.clickcraft.tech` |
| `APP_TIMEZONE` | defaults to `Africa/Johannesburg` |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | database credentials |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | initial administrator (min. 12 characters), created on first start only |
| `PROXY_NETWORK_NAME` | external Docker network shared with Nginx Proxy Manager (default `npm-proxy`) |
| `HOST_BIND_ADDRESS` / `HOST_PORT` | optional localhost binding for direct health checks (default `127.0.0.1:4000`); not needed for NPM |

Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SMTP_*`, `ALERT_EMAIL_TO`,
`DOCKER_SOCKET_PATH`, `ALLOW_PRIVATE_TARGETS`.

Change the administrator password afterwards by updating the DB, or delete the
users row and restart with new `ADMIN_*` values. Credentials are never stored in
the repository, the frontend bundle or any API response.

---

## 4. Nginx Proxy Manager

Nginx Proxy Manager itself runs in Docker, so it cannot reach `127.0.0.1:4000`
on the VPS. Instead, both stacks share an **external Docker network** and NPM
proxies to the app by its container hostname.

### 4.1 Create and attach the shared network

```bash
# Create once on the VPS (name must match PROXY_NETWORK_NAME in .env)
docker network create npm-proxy
```

Attach NPM's compose stack to the same network — add this to NPM's
`docker-compose.yml`:

```yaml
networks:
  default:
  npm-proxy:
    external: true

services:
  app:                      # the Nginx Proxy Manager service
    networks:
      - default
      - npm-proxy
```

Then `docker compose up -d` in NPM's directory. If NPM was already running,
`docker network connect npm-proxy <npm-container-name>` works too.

This app's `docker-compose.yml` already attaches **only the `app` service** to
the shared network. The `db` and `worker` services stay on the private
`monitor` network — PostgreSQL is never reachable from the proxy network.

### 4.2 Create the Proxy Host in NPM

- **Domain Names**: `monitor.clickcraft.tech`
- **Scheme**: `http`
- **Forward Hostname / IP**: `clickcraft-monitor-app`
  (the stable container name / DNS hostname on the shared network)
- **Forward Port**: `4000` (the container's internal `APP_PORT`)
- **Cache Assets**: off
- **Block Common Exploits**: on
- **Websockets Support**: not required (the console uses polling); enabling it
  is harmless
- **SSL tab**: request a new Let's Encrypt certificate, then enable
  **Force SSL** and **HTTP/2 Support**

The application does not manage certificates itself; NPM terminates TLS.
`TRUST_PROXY=true` makes the app honour `X-Forwarded-For` / `X-Forwarded-Proto`,
so secure cookies and client IP rate limiting behave correctly.

The optional `127.0.0.1:4000` host port binding is only for direct health
checks and debugging on the VPS (`curl http://127.0.0.1:4000/api/health`). You
can remove the `ports:` section of the `app` service entirely once NPM works.

---

## 5. Host metrics and Docker monitoring

VPS metrics use read-only mounts already present in `docker-compose.yml`:

```yaml
- /proc:/host/proc:ro
- /:/host/root:ro
```

Docker container monitoring is **off by default**. To enable it:

1. Uncomment the socket mount in the `worker` service:
   `- /var/run/docker.sock:/var/run/docker.sock:ro`
2. Set `DOCKER_SOCKET_PATH=/var/run/docker.sock` in `.env`
3. `docker compose up -d`

Security note: mounting the Docker socket grants the worker read access to the
Docker API. All interaction stays server-side and read-only (list + inspect);
no Docker control endpoint is exposed through the web API, and V1 never
restarts or modifies containers.

---

## 6. Updating

```bash
cd /opt/clickcraft-site-monitor
git pull
docker compose up -d --build
docker compose logs -f --tail=100
```

Database migrations run automatically at start-up; historical data is preserved
in the `monitor_db_data` volume across rebuilds and restarts.

---

## 7. Backup and restore

The PostgreSQL volume `monitor_db_data` holds all monitoring history.

```bash
# Dump
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > monitor-$(date +%F).sql.gz

# Restore
gunzip -c monitor-2026-01-01.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Back up `.env` separately and securely (encrypted, off the repository) — it is
excluded from Git and is not recoverable from the image.

---

## 8. Troubleshooting

```bash
docker compose ps                      # container state and health
docker compose logs --tail=200 app     # API logs (structured JSON)
docker compose logs --tail=200 worker  # monitoring worker logs
docker compose restart app worker      # restart the application
curl -s http://127.0.0.1:4000/api/health

# Database connectivity
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\dt'

# Worker status (heartbeat updated every tick)
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select * from worker_heartbeats;'

# Notification failures
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select created_at, channel, success, error_message from notification_events order by created_at desc limit 20;'
```

`/api/health` returns `{"status","database","worker","timestamp"}` and nothing
else — no credentials, environment values or host details. Point a future
external watchdog at `https://monitor.clickcraft.tech/api/health`; complete VPS
outage detection must come from outside this server.

---

## 9. Security notes

- Passwords hashed with scrypt; sessions are signed, HTTP-only, `Secure` in
  production, and rate-limited on login (no public registration).
- All queries are parameterised; request bodies validated with Zod.
- Mutating API calls require a custom header, blocking cross-site form posts.
- **SSRF protection**: monitored URLs are validated and every hostname is
  re-resolved before each request (including redirects). Loopback, link-local,
  cloud-metadata and private ranges are rejected unless explicitly permitted via
  `ALLOW_PRIVATE_TARGETS` / `PRIVATE_TARGET_ALLOWLIST`.
- PostgreSQL has no published port; only the app port is exposed, bound to
  localhost by default.
- Secrets exist only in `.env` on the VPS — never in the repository, the
  frontend bundle or API responses. Logs redact sensitive keys.

## 10. Not included in V1

Automated container restarts or VPS remediation, browser-based synthetic
journeys, vulnerability/malware scanning, remote SSH execution, automated
backups, automatic DNS or proxy changes, log analytics, multi-tenancy and
billing are intentionally out of scope.
