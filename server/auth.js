import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const hashToken = (value) =>
  createHash("sha256").update(value).digest("hex");
export function passwordValid(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export async function hashPassword(value) {
  if (!passwordValid(value)) throw new Error("รหัสผ่านต้องมี 12–128 ตัวอักษร");
  const salt = randomBytes(16).toString("hex");
  const result = await scrypt(value, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${result.toString("hex")}`;
}
export async function verifyPassword(value, hash) {
  if (typeof value !== "string" || value.length > 128) return false;
  const [salt, expected] = hash.split(":");
  const result = await scrypt(value, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const bytes = Buffer.from(expected, "hex");
  return bytes.length === result.length && timingSafeEqual(bytes, result);
}
export const token = () => randomBytes(32).toString("hex");
export const accountView = (a) => ({
  id: a.id,
  username: a.username,
  name: a.name,
  role: a.role,
  unitId: a.unit_id,
  team: a.team,
  mustChange: a.must_change,
});
