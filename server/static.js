import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};
export async function staticFile(req, res, serverMode = true) {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const rel = path === "/" ? "index.html" : path.slice(1);
    if (rel.split("/").some((segment) => segment === ".." || segment === "."))
      throw Error();
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !/^(index\.html|assets\/[\w./-]+|shared\/criteria\.js|sisaket-gecc-2570-units-28\.json)$/.test(
        rel,
      )
    )
      throw Error();
    const file = resolve(root, rel);
    if (!file.startsWith(root + sep)) throw Error();
    let bytes = await readFile(file);
    if (rel === "index.html" && !serverMode)
      bytes = Buffer.from(
        bytes
          .toString()
          .replace("<head>", "<head><script>window.GECC_PREVIEW=true;</script>"),
      );
    res.writeHead(200, {
      "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
