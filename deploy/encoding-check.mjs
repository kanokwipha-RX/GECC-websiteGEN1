const decoder = new TextDecoder("windows-874");
const bytesByChar = new Map(Array.from({ length: 256 }, (_, byte) => [decoder.decode(Uint8Array.of(byte)), byte]));
export function hasCorruptThai(text) {
  if (text.includes("\uFFFD")) return true;
  const markers = text.match(/เธ|เน/gu)?.length || 0;
  if (markers < 2 || [...text].some(c => !bytesByChar.has(c))) return false;
  try {
    const fixed = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...text], c => bytesByChar.get(c)));
    return /[ก-๛]/u.test(fixed) && (fixed.match(/เธ|เน/gu)?.length || 0) < markers;
  } catch { return false; }
}
// Detect the reversible Windows-874 corruption observed in the production seed.
export function assertCleanThai(value, path = "data") {
  if (typeof value === "string") {
    if (hasCorruptThai(value))
      throw new Error(`Possible Thai encoding corruption at ${path}; verify the UTF-8 source before deploying.`);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertCleanThai(child, path + "." + key);
  }
}
