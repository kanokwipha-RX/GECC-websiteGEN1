export function basePath(value = "") {
  if (!value || value === "/") return "";
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value))
    throw new Error("BASE_PATH must be a path such as /sskgecc");
  return value.replace(/\/$/, "");
}

export function configuration(env = process.env) {
  const origin = env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is required");
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password)
    throw new Error("APP_ORIGIN must contain only the origin; use BASE_PATH for /sskgecc");
  if (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))
    throw new Error("HTTPS is required outside localhost");
  const secure = env.COOKIE_SECURE === "true";
  if (parsed.protocol === "https:" && !secure)
    throw new Error("HTTPS requires COOKIE_SECURE=true");
  return { origin, secure, basePath: basePath(env.BASE_PATH) };
}
