import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "@/server/snapshot";
import { POST as diagnostics } from "./ai/diagnostics/route";
import { GET as aiLogRoute } from "./ai/log/route";
import { POST as clock } from "./sandbox/clock/route";
import { POST as reset } from "./sandbox/reset/route";
import { POST as tick } from "./tick/route";

const BASE = "http://localhost:3000";

function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "198.51.100.1" });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

describe("API routes", () => {
  let cookie = "";

  beforeAll(() => {
    process.env.PGLITE_DIR = "memory://";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DATABASE_URL;
  });

  it("creates a world on first contact and sets its cookie", async () => {
    const res = await tick(request("/api/tick"));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/tms_sandbox=[0-9a-f-]{36}/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    cookie = setCookie.split(";")[0];
    const body = (await res.json()) as Snapshot;
    expect(body.counts).toEqual({ vehicles: 14, activeOrders: 11 });
    expect(body.ai).toEqual({ mode: "fallback", reason: "no_api_key" });
    expect(body.speed).toBe(10);
  });

  it("keeps the same world for the same cookie without setting it again", async () => {
    const res = await tick(request("/api/tick", { cookie }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an unknown clock action with 400", async () => {
    const res = await clock(request("/api/sandbox/clock", { cookie, body: { action: "rewind" } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Niepoprawne dane");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await clock(request("/api/sandbox/clock", { cookie, body: "{nope" }));
    expect(res.status).toBe(400);
  });

  it("changes speed and pauses", async () => {
    const fast = (await (await clock(request("/api/sandbox/clock", { cookie, body: { action: "speed", speed: 60 } }))).json()) as Snapshot;
    expect(fast.speed).toBe(60);
    const paused = (await (await clock(request("/api/sandbox/clock", { cookie, body: { action: "pause" } }))).json()) as Snapshot;
    expect(paused.running).toBe(false);
    const again = (await (await tick(request("/api/tick", { cookie }))).json()) as Snapshot;
    expect(again.simNow).toBe(paused.simNow);
  });

  it("resets the world back to the scenario start", async () => {
    const res = await reset(request("/api/sandbox/reset", { cookie, body: {} }));
    const body = (await res.json()) as Snapshot;
    expect(body.running).toBe(true);
    expect(body.speed).toBe(10);
    expect(new Date(body.simNow).getTime() - new Date(body.simOrigin).getTime()).toBeLessThan(60_000);
  });

  it("runs diagnostics in fallback mode and lists it in the AI log", async () => {
    const diag = await diagnostics(request("/api/ai/diagnostics", { cookie }));
    expect(await diag.json()).toMatchObject({ hasKey: false, sample: { source: "fallback", reason: "no_api_key" } });
    const log = await aiLogRoute(request("/api/ai/log?limit=5", { method: "GET", cookie }));
    const { entries } = (await log.json()) as { entries: { fn: string; fallbackUsed: boolean }[] };
    expect(entries[0]).toMatchObject({ fn: "diagnostics", fallbackUsed: true });
  });
});
