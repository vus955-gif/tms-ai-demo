import { createHash } from "node:crypto";
import { config } from "../config";

export const SANDBOX_COOKIE = "tms_sandbox";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSandboxId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${config.ipSalt}:${ip}`).digest("hex");
}

export function sandboxCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: config.sandboxTtlHours * 3600,
  };
}
