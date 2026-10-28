import { database } from "./store.js";
import { createApp } from "./app.js";
const origin = process.env.APP_ORIGIN;
const secure = process.env.COOKIE_SECURE === "true";
if (!origin) throw new Error("APP_ORIGIN is required");
if (
  !origin.startsWith("https://") &&
  !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
)
  throw new Error("HTTPS is required outside localhost");
if (origin.startsWith("https://") && !secure)
  throw new Error("HTTPS requires COOKIE_SECURE=true");
const pool = database();
const server = createApp({
  pool,
  origin,
  secure,
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
