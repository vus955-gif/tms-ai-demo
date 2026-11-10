import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, mapOrigins, securityHeaders } from "./security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("security headers", () => {
  it("allows the default map host and nothing else outside the app", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "production" });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org");
    expect(directive(csp, "img-src")).toContain("https://tiles.openfreemap.org");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("keeps eval and the hot-reload socket out of production", () => {
    const prod = contentSecurityPolicy({ NODE_ENV: "production" });
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toContain("ws:");
    const dev = contentSecurityPolicy({ NODE_ENV: "development" });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });

  it("follows configured map styles and extra origins, ignoring junk", () => {
    const origins = mapOrigins({
      NEXT_PUBLIC_MAP_STYLE_URL: "https://maps.example.com/styles/light.json?key=abc",
      NEXT_PUBLIC_MAP_STYLE_DARK_URL: "https://maps.example.com/styles/dark.json",
      NEXT_PUBLIC_MAP_STYLE_FALLBACK_URL: "",
      CSP_EXTRA_ORIGINS: "https://tiles.example.net, nie-adres javascript:alert(1)",
    });
    expect(origins).toEqual(["https://maps.example.com", "https://tiles.example.net"]);
  });

  it("sends HSTS only in production", () => {
    const keys = (env: string) => securityHeaders({ NODE_ENV: env }).map((h) => h.key);
    expect(keys("production")).toContain("Strict-Transport-Security");
    expect(keys("development")).not.toContain("Strict-Transport-Security");
    expect(keys("production")).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]));
  });
});
