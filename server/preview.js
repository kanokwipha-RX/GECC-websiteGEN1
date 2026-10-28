import { createServer } from "node:http";
import { staticFile } from "./static.js";
createServer((req, res) => staticFile(req, res, false)).listen(
  8080,
  "127.0.0.1",
  () => console.log("Local browser-storage preview: http://127.0.0.1:8080"),
);
