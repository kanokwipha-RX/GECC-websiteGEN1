# GECC production cutover — 28 October 2026

**Hosting correction:** Apache/PHP 8.3.36 only, confirmed by the hosting team.
The Node/PostgreSQL work below remains development evidence, not a deployable
backend for that host. Current PHP migration plan: PHP-HOSTING-PLAN-TH.md.

## Observed deployment

Read-only checks of https://www.osscsskfda.org/sskgecc/ found Apache serving
the HTML without backend mode. `/sskgecc/api/health`, `/api/session` and
`/api/state` all returned 404 under that prefix. `.env` returned 403 (denied).
Uploading the HTML/assets alone does not start the Node/PostgreSQL service.
Deleting the browser-storage banner cannot turn the demo into production.

## Prepared changes

- Production is now the default, including plain static hosting. Only the local
  preview server injects `GECC_PREVIEW=true`. No API means a visible error and no
  demo scores, PIN login or browser-storage fallback.
- `BASE_PATH=/sskgecc` routes HTML/assets, API and attachments through the existing
  Apache site. Secure cookies are scoped to `/sskgecc/`, with a prefix-specific
  cookie name. Origin remains `https://www.osscsskfda.org`, without a path.
- Startup checks the database/state before accepting traffic. The private-file
  whitelist still rejects source, environment, account bundles and database files.
- Countdown compact styling no longer collides with `.mini` score bars (the
  clipped navy rectangle in the supplied screenshot).
- Official roster yields 54 accounts: 28 six-digit organization accounts,
  24 named MENTOR accounts (`mentor-01-01` etc.), two named coordinators
  (`coord-01`, `coord-02`). Each gets an independent random 24-character temporary
  password, stored hashed on insertion, with required first-login password change.

## Private account handoff

The local `var/private/accounts.json` contains generated credentials, not test
accounts. It is excluded from Git and Docker build context and cannot be served
by the Node application. Do not place it in Apache's document root, upload it
with public assets, paste it into chat, email it broadly or commit it.
Keep its access limited to the administrator; distribute each account only to
its intended recipient using the agency's approved private channel.

`npm run accounts:prepare` generates this file exclusively; existing files are
never overwritten. Preparation changes no database. Back up that original file
privately before moving it to the agency server. Do not regenerate a different
file on each installation attempt.

On the target host, after migration:

```sh
node --env-file=.env server/accounts.js check var/private/accounts.json
node --env-file=.env server/accounts.js apply var/private/accounts.json
```

`check` validates every name/role/scope against the target roster and reports
counts only. `apply` inserts missing accounts in one transaction, records audit
events and never resets passwords or re-enables existing users. If the target
roster has changed or a username belongs to another identity, it stops. Existing
accounts are reported as `skipped`; their passwords are NOT those in this bundle.
Dry-run and reviewed apply should use the same bundle. No assessment records,
scores, evidence, calendars or existing accounts are replaced.

For Compose, move the file via a private path and run (no secret in arguments):

```sh
docker compose run --rm -v "$PWD/var/private:/run/gecc-private:ro" web node server/accounts.js check /run/gecc-private/accounts.json
docker compose run --rm -v "$PWD/var/private:/run/gecc-private:ro" web node server/accounts.js apply /run/gecc-private/accounts.json
```

On Linux set the private directory mode to 700 and account file to 600, owned by
the UID used to run this command (the image uses the `node` user, UID 1000).
Do not make the file world-readable to work around ownership. Remove temporary
distribution copies after handoff under the agency's retention policy.

## Target configuration and cutover

This requires Node 24+, PostgreSQL 17+, writable private attachment storage and
Apache reverse proxy support. PHP-only hosting cannot run this backend.
Confirm host capabilities before installing or restarting services.

The owner reports seeing phpMyAdmin. This indicates MySQL administration is
available, but does not establish whether Node/Docker/PostgreSQL are supported.
Ask the hosting team to run `sh deploy/check-host.sh` through their existing SSH
access and return its capability report (no passwords or connection strings).
The script makes no changes. If the host supports PHP/MySQL only, stop this
cutover: the existing Node/PostgreSQL backend needs a supported runtime or a
separately reviewed PHP/MySQL implementation; SQL dialects are not interchangeable.

1. Back up current browser data WITH attachments from every browser holding real
   records. Back up any existing PostgreSQL/files volume. Keep originals intact.
2. Set protected environment values:

   ```dotenv
   APP_ORIGIN=https://www.osscsskfda.org
   BASE_PATH=/sskgecc
   COOKIE_SECURE=true
   # DATABASE_URL and POSTGRES_PASSWORD are private values supplied on the host.
   ```

3. Build/start the database using DEPLOYMENT.md; migrate. A missing state is
   initialized with the official 28 organizations and no demo assessments.
4. Check/apply the private account bundle as above. Validate all three roles in
   staging, including forced password change, permission denial and save/reload.
5. Start the web service. Reverse proxy the entire `/sskgecc/` path, preserving
   the prefix on BOTH sides; use `deploy/apache-sskgecc.conf` inside the existing
   HTTPS VirtualHost. Preserve unrelated sites/routes. Test Apache configuration
   before reload. Never expose database port or private file/account directories.
6. Run `npm run check:production -- https://www.osscsskfda.org/sskgecc/`.
   This is read-only and checks runtime, readiness, anonymous session, scoped
   public aggregates and private configuration denial. A green smoke check alone
   does not certify all authenticated behavior or backup recovery.
7. Import only owner-reviewed real source archives. Mixed/sample-flagged records
   require classification. A populated target is never automatically replaced.
8. Verify HTTPS cookie flags, browser requests under `/sskgecc/api/`, restart
   persistence, attachment hashes and an isolated backup restore before accepting
   the live system. Use staged traffic cutover and retain the prior consistent
   database/files/image pair for rollback.

## Verification boundary

Local results on 28 October 2026:

- `npm test`: 31 passed, including actual creation/login of all 54 generated
  account identities in an isolated database; scoped state and mandatory password
  change verified for every account. This does not insert live accounts.
- Full Chromium suite under `/sskgecc/`: 18 scenario groups, 58 axe states,
  zero violations and zero JavaScript exceptions. Saved report:
  `artifacts/browser-subdirectory-report.json` (local, ignored by Git).
- Public screens checked at 360/390/768/1024/1440px; all coordinator screens at
  390/1440px in both themes; all assessment tabs, keyboard tabs/dialogs,
  reduced motion, dirty-draft failure/recovery, binary backup/import and print.
- All three role sessions, first-login password change, mismatch focus/error
  association, show/hide password, account create/disable/enable/reset and missing
  runtime fail-closed behavior exercised through the browser.
- Independent checker confirmed countdown, mobile menu labels, surface fixes and
  missing-runtime behavior; one busy-button selector issue was corrected and a
  held-request assertion added for that control.
- `npm audit --omit=dev`: zero vulnerabilities. JavaScript syntax and
  `git diff --check` passed. Thai encoding corruption markers not found in the
  application sources/roster; official names still require owner validation.
- Strict premium static audit reports TWO `affordance.actionless-button` flags
  for the delegated account disable/reset controls. Their handlers and browser
  actions are verified; independent review identifies these as analyzer false
  positives. The strict static command consequently exits 1, not a clean pass.

Root-path backend coverage is retained in API tests and a separate focused
browser run (`artifacts/browser-root-report.json`). Browser audits wait for finite
entrance animations before measuring the final text/background contrast.

Automated tests use isolated embedded PostgreSQL (PGlite) and Chromium, never the
live database. They cover scoring, roles, CSRF, first-password rules, scoped
files, save/reload, stale writes, failed saves, import/backup and responsive/axe
checks. Additional coverage verifies subdirectory routing, cookie scope,
provisioning dry-run/idempotence/atomicity and countdown geometry.

Docker and daemon PostgreSQL are not installed on this workstation. Live host
configuration, account insertion, real-data import, TLS termination, restart and
off-host restore require verification on the agency staging/production host.
No live server changes or production database writes were performed here.
