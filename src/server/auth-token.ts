export const AUTH_COOKIE = "tms_auth";

/** Opaque cookie value derived from the demo password (Web Crypto, works in any runtime). */
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`tms-ai-demo:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
