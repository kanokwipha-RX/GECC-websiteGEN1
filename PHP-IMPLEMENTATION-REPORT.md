# PHP/MariaDB implementation report — 28 October 2026

Target confirmed by owner: Apache, PHP 8.3.36, MariaDB 10.6.28.
No production host login, upload, database mutation or cutover was performed.

## Delivered

- PHP/PDO backend implements the existing session/password/state/summary/workflow/
  files/accounts/audit/import/admin-reset contracts. The shared frontend URL
  adapter selects PHP query routes; no Node daemon or Apache proxy is required.
- Seven MariaDB/InnoDB tables use explicit utf8mb4. Existing database/global
  utf8mb3 settings remain untouched. SQL, CLI installer, guarded one-time web
  installer and a package builder are available in source.
- Argon2id password hashes, resource-scoped roles, revocable hashed session
  tokens, HttpOnly/Secure/SameSite cookies, exact-Origin/CSRF checks, first-password
  change and persistent login throttling are enforced in PHP.
- Missing-account provisioning generates 54 named, scoped accounts with distinct
  temporary passwords. Repeat installation preserves existing accounts, passwords
  and records. DDL is additive initialization; account insertion is transactional.
- Private configuration, credentials and files are outside public output.
  Uploaded binaries have signature/size checks and permission-checked downloads.
  Deployment directories/ZIPs receive restrictive Windows ACLs when built there.
- Audit dates are ISO UTC Z for correct Thai-time formatting. A defect's existing
  group ownership is checked before reassignment in PHP and the alternative Node
  backend, with regression tests against cross-group hijacking.
- Existing font, imagery, pages and scoring remain. Native list buttons and
  semantic status colors fix populated-dashboard accessibility findings.

## Executed checks

- Official PHP Windows build 8.3.36-1 (reports PHP 8.3.36) and MariaDB 10.6.28
  binaries used in isolated local tests. Download SHA-256 values matched their
  official release metadata/checksum files.
- PHP scoring/completion/readiness compared against JavaScript on 300 generated
  records plus fourteen award-boundary/physical-gate records.
- PHP/MariaDB integration: 17 scenario groups, 52 axe states, zero violations and
  zero JavaScript exceptions. Report: artifacts/php-report.json (local/ignored).
- All 54 generated identities authenticated with expected scopes and mandatory
  password changes. Covered CSRF/origin denial, stale revisions, score forgery,
  Unicode/emoji persistence, review locks/reopen, defect permissions, account
  reset/disable, attachment isolation/size/signatures and persistent throttling.
- Browser tests cover public pages, coordinator pages and eight assessment tabs
  in both themes/mobile/desktop, first-password UI, failed-save draft retention,
  missing-file reupload during binary backup restore, SHA-256 and print PDF.
- Alternative runtime regression: npm test passed 36 tests; focused Node browser
  flows passed with zero axe findings. PHP and JavaScript syntax checks and
  git diff --check passed. Release ZIP generation was exercised on Windows.
- Independent bounded review checked private/public separation, client URL
  coverage, setup response/token behavior, audit timestamps and defect ownership.

## Deployment boundary

Actual Apache/LVE behavior, configured HTTPS flag/cookies, PHP extensions,
filesystem ownership, host request/time limits and the agency's backup/restore
must still be verified on staging. Local tests use MariaDB 10.6.28 community
Windows binaries; the host's cll/LVE package and Unix-socket deployment are not
identical operating environments.

No claim of complete WCAG certification, cross-browser coverage, antivirus
scanning, tamper-proof DBA audit or automatic orphan-file retention is made.
The v1 schema does not ALTER incompatible existing tables or merge populated
source databases. PHP-DEPLOYMENT-TH.md is the current deployment guide; older
Node/Docker documents remain alternative-runtime history.
