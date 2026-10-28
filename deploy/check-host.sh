#!/bin/sh
# Read-only capability inventory. No sudo, credentials, installation or restart.
printf 'GECC host capability check\n'
if command -v node >/dev/null 2>&1; then
  node --version
  node -e 'console.log("Node 24+:",Number(process.versions.node.split(".")[0])>=24?"yes":"no")'
else printf 'Node.js: unavailable in this shell\n'; fi
if command -v docker >/dev/null 2>&1; then
  docker --version
  docker compose version 2>/dev/null || printf 'Docker Compose: unavailable\n'
  if docker info >/dev/null 2>&1; then printf 'Docker daemon access: yes\n';
  else printf 'Docker daemon access: unavailable for this user\n'; fi
else printf 'Docker: unavailable in this shell\n'; fi
if command -v psql >/dev/null 2>&1; then psql --version;
else printf 'PostgreSQL client: unavailable (server availability not checked)\n'; fi
if command -v php >/dev/null 2>&1; then
  php -r 'echo "PHP CLI: ",PHP_VERSION,PHP_EOL; echo "PDO drivers: ",class_exists("PDO")?implode(", ",PDO::getAvailableDrivers()):"unavailable",PHP_EOL;'
else printf 'PHP CLI: unavailable (web PHP may still be installed)\n'; fi
printf 'Ask host support: can /sskgecc/ reverse proxy to a persistent Node 24+ service with private PostgreSQL and file storage?\n'
printf 'This report does not test the database, Apache config, backups or public TLS.\n'
