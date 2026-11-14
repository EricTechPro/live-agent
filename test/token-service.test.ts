// The token service: short-lived LiveKit tokens for the window, and single-use
// Gemini tokens for the core's own Live session. The real secrets stay inside.
import { describe, expect, test } from "bun:test";
import { TokenVerifier } from "livekit-server-sdk";
import { createTokenService } from "../src/voice/token-service.ts";

const livekit = { url: "ws://127.0.0.1:7999", apiKey: "live-agent", apiSecret: "s3cret-".repeat(6) };

describe("token service", () => {
  test("a LiveKit token lets one identity join one room, and expires in minutes", async () => {
    const tokens = createTokenService({ livekit, room: "live-agent" });

    const { token, expiresAt } = await tokens.livekitToken("user");
    const claims = await new TokenVerifier(livekit.apiKey, livekit.apiSecret).verify(token);

    expect(claims.sub).toBe("user");
    expect(claims.video?.room).toBe("live-agent");
    expect(claims.video?.roomJoin).toBe(true);
    const lifetimeS = claims.exp! - Math.floor(Date.now() / 1000);
    expect(lifetimeS).toBeGreaterThan(60);
    expect(lifetimeS).toBeLessThanOrEqual(10 * 60);
    expect(Math.abs(Date.parse(expiresAt) / 1000 - claims.exp!)).toBeLessThanOrEqual(1);
  });

  test("a Gemini token is minted single-use and short-lived, from the real key", async () => {
    const asked: unknown[] = [];
    const tokens = createTokenService({
      livekit,
      room: "live-agent",
      gemini: {
        apiKey: "AIza-real-key",
        model: "gemini-3.8-live",
        // Stand-in for Google's authTokens.create: no network in fast tests.
        create: async (apiKey, config) => {
          asked.push({ apiKey, config });
          return { name: "auth_tokens/ephemeral-abc" };
        },
      },
    });

    expect(await tokens.geminiToken()).toBe("auth_tokens/ephemeral-abc");
    const [{ apiKey, config }] = asked as [{ apiKey: string; config: any }];
    expect(apiKey).toBe("AIza-real-key");
    expect(config.uses).toBe(1);
    expect(config.liveConnectConstraints.model).toBe("gemini-3.8-live");
    expect(Date.parse(config.newSessionExpireTime) - Date.now()).toBeLessThanOrEqual(2 * 60_000);
    expect(Date.parse(config.expireTime) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
  });
});
