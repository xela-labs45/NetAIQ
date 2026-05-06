# NetAIQ Production Readiness — Bug Audit

## P0 — Blockers (fix before any production deploy)

1. **Default admin password printed to logs** — [server/db/seed.js:19](server/db/seed.js#L19)
   `console.log('Admin user created: username=admin / Admin@1234')` runs on every fresh `npm start`. Docker logs / stdout aggregators will persist the literal default password. Drop the password from the log line — the `must_change_password=1` flag already forces a change on first login, but that flag doesn't help if the secret is in CI/log retention.

2. **JWT_SECRET strength is not enforced** — [server/server.js:12-17](server/server.js#L12)
   The boot check only verifies *presence*, so a deploy with `JWT_SECRET=replace_with_a_random_64_character_string` (the literal `.env.example` placeholder) boots happily and signs tokens that anyone can forge. Reject obviously weak/placeholder values: minimum length (≥32), and refuse if the value matches the example.

3. **No graceful shutdown** — [server/server.js:91-199](server/server.js#L91)
   No `SIGTERM` / `SIGINT` handler. On Docker stop, in-flight HTTP requests are dropped, the cron jobs and `setInterval`s aren't cleared, and the SQLite connection isn't closed (risk of leaving a `-wal`/`-shm` in a half-flushed state). Add: `process.on('SIGTERM', async () => { await fastify.close(); db.close(); process.exit(0); })`.

4. **`scan_running` lock is unrecoverable across crashes** — [server/services/scanService.js:9-15, 86-88](server/services/scanService.js#L9)
   The lock is only cleared in `finally`. An OOM kill, container restart mid-scan, or unhandled exception leaves the row in `settings` forever, and every future scan returns "A scan is already in progress." Add a startup-time cleaner in `database.js` (or before `scanJob.start`) that deletes any stale `scan_running` row, or store a timestamp and treat locks older than N minutes as stale.

5. **Settings endpoints accept arbitrary keys** — [server/routes/settings.js:59-123](server/routes/settings.js#L59)
   `PUT /unifi`, `/email`, `/ai`, `/polling`, `/telegram` all do `saveSettings(request.body)` without an allowlist. An authenticated user can write *any* key — including `scan_running` (DoS the scanner), `ping_history_retention_days=0` (force the 02:00 cleanup to wipe the table), or arbitrary `ai_*` keys. `/general` is the one route that does it right (`GENERAL_ALLOWED` set). Add per-route allowlists matching `/general`'s pattern.

## P1 — High risk

6. **Login lockout state is in-memory only** — [server/routes/auth.js:5-30](server/routes/auth.js#L5)
   `loginAttempts` Map resets on every restart, so an attacker who triggers a lockout can crash/restart the process (or simply wait for a deploy) to reset the counter. The `@fastify/rate-limit` 10-per-15m guard partially offsets this, but the *account* lockout is the stronger protection and it's not durable. Persist `failed_attempts` and `locked_until` on the `users` row.

7. **`/api/v1/settings/password` has no rate limit** — [server/routes/settings.js:241](server/routes/settings.js#L241)
   The endpoint requires the current password — so an attacker with a stolen session cookie can brute-force the *current* password unthrottled. Add a `config.rateLimit` block similar to `/login`.

8. **Background work registered without crash containment** — [server/server.js:154-190](server/server.js#L154)
   The OUI auto-fetch IIFE, `backfillVendors`, and `checkDiscoveryCapability` are fired but their failures only log. More importantly, `execSync` on line 161 blocks the event loop for ~10 s on first boot — every incoming request stalls. Move `execSync` to a worker, or use `spawn` with `await`.

9. **Implicit `ANTHROPIC_API_KEY` env fallback** — [server/services/aiService.js:172](server/services/aiService.js#L172)
   The settings UI is the documented configuration surface, but the code silently falls back to `process.env.ANTHROPIC_API_KEY`. If a key leaks into the container env (CI, docker-compose override, host env), AI features run unauthorized with no audit trail. Decide: either document the env var as a supported override, or remove the fallback.

10. **Cleanup jobs use `console.log`/`console.error`, not `fastify.log`** — [server/jobs/cleanupJob.js:43, 45, 76, 78](server/jobs/cleanupJob.js#L43)
    Output bypasses Fastify's pino formatter, so structured-log consumers (ELK, Loki, journald JSON) lose these events. Same pattern in `seed.js` and `backfillService.js`. Pass `fastify` in or use a shared logger module.

11. **`reply.send(err)` from JWT verifier swallows status semantics** — [server/server.js:44-50](server/server.js#L44)
    On JWT failure, `reply.send(err)` returns the error object but doesn't set a 401. Clients see a 500. Replace with `reply.code(401).send({ error: true, message: 'Unauthorized' })`.

12. **Polling endpoint restarts jobs by *requiring* the module again** — [server/routes/settings.js:117-122](server/routes/settings.js#L117)
    `require('./jobs/criticalPingJob').start(fastify)` is called every time settings are saved. Node's require cache means it's the same module — so unless `start()` properly tears down the previous interval/cron, you accumulate handlers. Verify each `start()` clears its previous timer (the agent flagged this as a likely leak; worth a 5-min audit of all three job modules).

13. **Nodemailer transporter rebuilt per email** — [server/services/alertService.js](server/services/alertService.js) (verify the create call site)
    On an alert storm, this can exhaust SMTP connections / trip the provider's connection-rate limit. Cache the transporter at module scope and recreate only when SMTP settings change.

14. **CORS in production is `origin: false`** — [server/server.js:21, 98](server/server.js#L21)
    This works *only* if frontend and API are served from the exact same origin (which Caddy seems to ensure). If anyone deploys without the reverse proxy, every browser call breaks with no clear error. Either document the constraint loudly or read an allowed-origin from env.

## P2 — Worth tracking, not blockers

15. **`cleanup` cron has no overlap guard.** Two firings can't really overlap (24h gap, single-row deletes are fast), but if retention is misconfigured to delete millions of rows it could. Low risk for SMB scale.

16. **`callClaude` and `callOpenRouter` log full error message via `console.error`** — [aiService.js:186](server/services/aiService.js#L186). Anthropic/OpenRouter errors can include request IDs and partial keys in some failure paths. Use `fastify.log.error` and scrub.

17. **No `VACUUM` after big cleanup deletes** — disk doesn't shrink. Run `PRAGMA optimize; VACUUM;` after the weekly alert cleanup.

18. **`Caddyfile` / `docker-compose.yml` not reviewed in this pass.** Worth a separate look for HTTPS-redirect, header policy (HSTS, CSP), and exposed dev ports.