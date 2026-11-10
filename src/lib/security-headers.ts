/**
 * HTTP security headers sent with every response (wired up in next.config.ts).
 *
 * The Content-Security-Policy has no nonces on purpose: nonces force every page to render per request, which
 * Cache Components / partial prerendering cannot do. So inline scripts stay allowed (the theme script and the
 * framework's own bootstrap need them) and the policy earns its keep elsewhere: no plugins, no framing, no foreign
 * script hosts, and the browser may only talk to this app and the map tile host.
 */

const DEFAULT_MAP_STYLES = ["https://tiles.openfreemap.org/styles/positron", "https://tiles.openfreemap.org/styles/dark"];

type Env = Record<string, string | undefined>;

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Hosts the map may load its style, tiles, fonts and icons from: the configured style URLs plus CSP_EXTRA_ORIGINS. */
export function mapOrigins(env: Env): string[] {
  const styles = [env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_MAP_STYLES[0], env.NEXT_PUBLIC_MAP_STYLE_DARK_URL || DEFAULT_MAP_STYLES[1], env.NEXT_PUBLIC_MAP_STYLE_FALLBACK_URL];
  const extra = (env.CSP_EXTRA_ORIGINS ?? "").split(/[\s,]+/);
  const origins = [...styles, ...extra].map(origin).filter((o): o is string => o !== null);
  return [...new Set(origins)];
}

export function contentSecurityPolicy(env: Env): string {
  const dev = env.NODE_ENV === "development";
  const map = mapOrigins(env).join(" ");
  const directives = [
    "default-src 'self'",
    // React's dev tooling needs eval; production does not.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${map}`,
    "font-src 'self' data:",
    // In development the hot-reload socket also goes through connect-src.
    `connect-src 'self' ${map}${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export function securityHeaders(env: Env): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // Client tracking links carry a token in the path — other sites must never see more than the origin.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  // Browsers ignore HSTS over plain http, but there is no reason to send it from a local server.
  if (env.NODE_ENV === "production") headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
