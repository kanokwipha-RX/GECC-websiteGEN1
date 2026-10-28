// Read-only checks. Never submits forms, authenticates or changes live data.
export async function checkProduction(target) {
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password)
    throw new Error("Supply the public application URL without credentials, query or fragment");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const checks = [];
  let transport = "node";
  try {
    const runtime = await fetch(new URL("assets/runtime.js", url), { signal: AbortSignal.timeout(15000) });
    if (runtime.ok && (await runtime.text()).includes('window.GECC_API_STYLE="php"')) transport = "php";
  } catch {}
  const endpoint = path => transport === "php" && path.startsWith("api/")
    ? "api/index.php?route=" + encodeURIComponent(path.slice(4))
    : path;
  async function check(name, path, inspect) {
    let status;
    try {
      const res = await fetch(new URL(endpoint(path), url), { signal: AbortSignal.timeout(15000), redirect: "error" });
      status = res.status;
      checks.push({ name, ok: await inspect(res), status: res.status });
    } catch (error) { checks.push({ name, ok: false, status, error: error.cause?.code || error.name }); }
  }
  await check("production runtime (no preview injection)", "", async r => {
    const html = await r.text();
    return r.ok && html.includes('src="assets/runtime.js"') && !html.includes("window.GECC_PREVIEW=true");
  });
  await check("database readiness", "api/health", async r => r.ok && (await r.json()).ok === true);
  await check("anonymous session", "api/session", async r => r.ok && (await r.json()).user === null);
  await check("public aggregates without assessment records", "api/state", async r => {
    const data = await r.json();
    return r.ok && !data.state?.isSample && data.summary &&
      Array.isArray(data.state?.units) && data.state.units.length === 0 &&
      Object.keys(data.state.assess || {}).length === 0 && !data.state.pins;
  });
  await check("private configuration not served", ".env", async r => [403, 404].includes(r.status));
  return { target: url.href, transport, ok: checks.every(c => c.ok === true), checks };
}

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await checkProduction(process.argv[2] || "https://www.osscsskfda.org/sskgecc/");
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
