// The pasted-key check (ticket 19): one cheap model lookup, no tokens used.
// Fake fetch standing in for Google; the answers mirror what Google really sends.
import { describe, expect, test } from "bun:test";
import { verifyGeminiKey } from "../src/gemini-key.ts";

const KEY = "AIzaDummyKeyForTheTest_789";

function fakeGoogle(status: number, body: unknown = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return Response.json(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("verifyGeminiKey", () => {
  test("a working key passes; the key goes in a header, never the URL", async () => {
    const google = fakeGoogle(200, { name: "models/gemini-3.8-live" });
    expect(await verifyGeminiKey(KEY, { fetch: google.fetch })).toBeUndefined();
    expect(google.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-live");
    expect(google.calls[0]!.url).not.toContain(KEY);
    expect(google.calls[0]!.headers["x-goog-api-key"]).toBe(KEY);
  });

  test("an invalid key gets a plain sentence that does not repeat the key", async () => {
    const google = fakeGoogle(400, { error: { details: [{ reason: "API_KEY_INVALID" }] } });
    const problem = await verifyGeminiKey(KEY, { fetch: google.fetch });
    expect(problem).toContain("not valid");
    expect(problem).not.toContain(KEY);
  });

  test("a key without Gemini API access, or no internet, says so", async () => {
    expect(await verifyGeminiKey(KEY, { fetch: fakeGoogle(403).fetch })).toContain("AI Studio");
    const offline = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await verifyGeminiKey(KEY, { fetch: offline })).toContain("internet");
  });

  test("over quota still counts as a working key", async () => {
    expect(await verifyGeminiKey(KEY, { fetch: fakeGoogle(429).fetch })).toBeUndefined();
  });
});
