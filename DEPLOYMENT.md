# Agency server runbook — deployment requires owner approval

Target-host correction: owner confirmed Apache/PHP 8.3.36 only. This Node/Docker
runbook is an alternative architecture, not the approved installation path for
that host. The confirmed database is MariaDB 10.6.28. Use PHP-DEPLOYMENT-TH.md
for the implemented PHP package/installer. Existing Node tests do not certify a PHP deployment.

Repeatable Linux/Docker setup: `bash deploy/production.sh check`, then
`bash deploy/production.sh init --apply`. See RUN-ON-SERVER-TH.md for Git handoff,
secret handling, Apache cutover and rerun/backup constraints. Docker installation
and Apache reload are intentionally owned by the host administrator.

For the actual `/sskgecc/` hosting path and generated account bundle, follow
[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) and the Apache proxy snippet.
`APP_ORIGIN` is the origin only; `BASE_PATH=/sskgecc` carries the path separately.

## Two separate modes

`npm ci && npm run dev`: browser-only preview at http://127.0.0.1:8080. Existing
localStorage/IndexedDB and PIN demonstration remain compatible. This mode is not
authentication for real data. It never connects to the agency server.

`npm start`: PostgreSQL-backed mode. Requires DATABASE_URL and APP_ORIGIN; reads no
browser records, creates no sample assessments and ignores demo login hashes.
Requires Node 24+, PostgreSQL 17+, and writable private FILE_ROOT. Only `pg` is a
production npm dependency. Browser/API tests use embedded PostgreSQL (PGlite), not
the agency database. Docker/daemon PostgreSQL verification remains a release gate.

## Local backend with an existing local PostgreSQL

Copy .env.example to .env and set values locally (never commit). Load it with
`node --env-file=.env server/manage.js migrate`. This initializes only a missing
state record from the official roster, with empty assessments and stable internal
organization codes 000001–000028. Existing state is never overwritten by migrate.

Provision the first coordinator using `GECC_NEW_PASSWORD` set temporarily in the
shell environment, then `node --env-file=.env server/manage.js account admin "ชื่อผู้ประสานงาน" coord`.
Remove GECC_NEW_PASSWORD from the shell immediately afterward. Never put a password
in command arguments. A 12–128 character temporary password is required and must
be changed on first login. No default production credentials are shipped.

Run `node --env-file=.env server/index.js`. Organization accounts can then be
created through coordinator Settings, using the assigned six-digit username.
MENTOR accounts are individual and assigned exactly one group. Coordinators can
disable accounts or reset temporary passwords; both revoke their sessions.

## Ubuntu / Compose preparation

Confirm Docker availability, disk quota, domain, TLS termination, backup owner,
retention policy and allowed attachment types/size before importing real data.
Do not upgrade or restart the agency host implicitly.

Set POSTGRES_PASSWORD to a strong URL-safe random value and APP_ORIGIN to the exact
HTTPS origin in a protected .env. Then, after deployment approval:

1. `docker compose build` and `docker compose up -d db`.
2. `docker compose run --rm web node server/manage.js migrate`.
3. Provision coordinator with GECC_NEW_PASSWORD via protected environment (not a
   committed file, shell history literal or shared terminal recording).
4. `docker compose up -d web`.
5. Configure the agency reverse proxy to 127.0.0.1:8080 with HTTPS, preserve Host,
   limit request bodies to 12 MB and request timeouts to 30 seconds. File API accepts
   PDF/JPEG/PNG/WebP up to 10 MB. Application checks the exact Origin on mutations.
6. Verify /api/health, cookies (Secure/HttpOnly/SameSite), every role and restart
   persistence on staging before traffic cutover. No database port is published.

Accounts, sessions, file metadata and append-only application audit events are
relational. The incumbent assessment aggregate is retained as versioned JSONB to
avoid a risky scoring/data rewrite. Updates serialize through a PostgreSQL row
lock and optimistic revision; unrelated simultaneous writes may need reload.
Scoping is enforced in the API, not by browser filtering. The DB role is private
to the service; application audit does not protect against a database administrator.

## Migration and restore

From each original browser, coordinator Settings -> “ส่งออกพร้อมไฟล์แนบ”. The
archive includes record JSON, binary file data, SHA-256 digests and missing-file
IDs. Ordinary JSON export still excludes attachments. Keep these backups private.

Server Settings accepts archive/JSON imports with a preview, then explicit
confirmation; target assessments must be empty and every referenced file must
exist. Unknown organization IDs and nonempty target datasets stop import. Original
browser data is not deleted. Sample-flagged mixed data must first be classified
by the owner; it is never silently treated as real.

For large archives use `node --env-file=.env server/manage.js import backup.json`
(dry run), then `--apply-empty` only after reviewing counts, missing files, score
parity and organization mapping. `--include-sample` is an explicit classification
override for owner-reviewed mixed source data, not permission to import demo data.
Combining multiple nonempty browser datasets requires an owner-reviewed merge;
the tools refuse automatic replacement. Never import old PINs as passwords.

Take a consistent backup of PostgreSQL plus the private files volume while writes
are paused. Store encrypted off-host under the agency retention policy. Test a
restore into an isolated staging database/files volume and compare counts,
attachment hashes and scores before accepting a backup procedure. Application
bundle exports omit accounts/session/password hashes and do not replace DB backups.

## Rollback and operational limits

Keep previous image, database and files backup together. If cutover fails, stop
writes and restore that consistent pair; do not point an old static app at new
server data. Uploaded but unreferenced files are retained for recovery; no automatic
purge is enabled pending the agency retention decision. Files use signature/type
checks and sandboxed download responses; malware scanning is not bundled.

Logs omit credentials and data bodies. /api/audit returns the most recent 100
events to coordinators. /api/health checks database connectivity. External Google
Drive link sharing remains managed in Drive, outside application authorization.
