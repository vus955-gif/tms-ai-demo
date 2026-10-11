import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeAiClient } from "@/test/fake-ai";
import { cmrModel } from "./read-cmr";

describe("CMR model choice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Haiku when it accepts images", async () => {
    expect(await cmrModel(fakeAiClient([], { imageInput: true, structuredOutputs: true }))).toBe("claude-haiku-5-5");
  });

  it("falls back to Sonnet when Haiku takes no images", async () => {
    expect(await cmrModel(fakeAiClient([], { imageInput: false, structuredOutputs: true }))).toBe("claude-sonnet-5-5");
  });

  it("lets AI_CMR_MODEL override the choice", async () => {
    vi.stubEnv("AI_CMR_MODEL", "claude-opus-5-5");
    expect(await cmrModel(fakeAiClient([]))).toBe("claude-opus-5-5");
  });
});
