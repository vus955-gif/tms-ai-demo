import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "./app/api/login/route";
import { proxy } from "./proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("password gate", () => {
  afterEach(() => {
    delete process.env.DEMO_PASSWORD;
  });

  it("lets everything through when no password is configured", async () => {
    const res = await proxy(req("/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects pages and rejects API calls without the cookie", async () => {
    process.env.DEMO_PASSWORD = "tajne";
    const page = await proxy(req("/monitoring"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Fmonitoring");
    const api = await proxy(req("/api/tick"));
    expect(api.status).toBe(401);
    const loginPage = await proxy(req("/login"));
    expect(loginPage.headers.get("x-middleware-next")).toBe("1");
  });

  it("accepts the cookie issued after a correct password", async () => {
    process.env.DEMO_PASSWORD = "tajne";
    const wrong = await login(new NextRequest("http://localhost:3000/api/login", { method: "POST", body: JSON.stringify({ password: "zle" }) }));
    expect(wrong.status).toBe(401);
    const right = await login(new NextRequest("http://localhost:3000/api/login", { method: "POST", body: JSON.stringify({ password: "tajne" }) }));
    expect(right.status).toBe(200);
    const cookie = (right.headers.get("set-cookie") ?? "").split(";")[0];
    const res = await proxy(req("/monitoring", cookie));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
