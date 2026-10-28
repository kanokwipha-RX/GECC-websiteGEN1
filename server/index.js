import { database } from "./store.js";
import { createApp } from "./app.js";
import { configuration } from "./config.js";
import { readState } from "./store.js";
const config = configuration();
const pool = database();
await readState(pool);
const server = createApp({
  pool,
  ...config,
  fileRoot: process.env.FILE_ROOT,
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(
  +(process.env.PORT || 8080),
  process.env.HOST || "127.0.0.1",
  () => console.log("GECC server ready"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
