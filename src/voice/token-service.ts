// The token service: the only place that holds real secrets.
//
//   const tokens = createTokenService({ livekit: lk, room: "live-agent", gemini: { apiKey } });
//   await tokens.livekitToken("user");   // -> { token, expiresAt }: for the window
//   await tokens.geminiToken();          // -> "auth_tokens/...": for the core's Live session
//
// Who gets what:
// - The window (Tauri webview) gets a LiveKit JWT for identity "user", valid
//   10 minutes, for this one room. That is all it ever sees. It never talks to
//   Gemini directly; the core does, over the room.
// - The core's Gemini Live session gets a single-use ephemeral token, so even
//   the Live adapter never holds the real key (it would only leak a token that
//   is already spent).
import { GoogleGenAI, type CreateAuthTokenConfig } from "@google/genai";
import { AccessToken } from "livekit-server-sdk";
import { DEFAULT_LIVE_MODEL } from "../models/gemini-live.ts";

export interface TokenServiceOptions {
  livekit: { url: string; apiKey: string; apiSecret: string };
  room: string;
  gemini?: {
    /** The real key. It never leaves this module. */
    apiKey: string;
    model?: string;
    /** Swap Google's authTokens.create (tests). Returns the token; its `name` IS the token. */
    create?: (apiKey: string, config: CreateAuthTokenConfig) => Promise<{ name?: string }>;
  };
}

export interface TokenService {
  /** A room token for one participant. Short-lived: reconnecting means asking again. */
  livekitToken(identity: string): Promise<{ token: string; expiresAt: string }>;
  /** A single-use Gemini Live token. Must start a session within a minute. */
  geminiToken(): Promise<string>;
}

const LIVEKIT_TTL_S = 10 * 60;

// Ephemeral tokens only exist on v1alpha.
const googleCreate = async (apiKey: string, config: CreateAuthTokenConfig) =>
  new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } }).authTokens.create({ config });

export function createTokenService(options: TokenServiceOptions): TokenService {
  const { livekit, room } = options;
  return {
    async livekitToken(identity) {
      const at = new AccessToken(livekit.apiKey, livekit.apiSecret, { identity, ttl: LIVEKIT_TTL_S });
      at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
      const token = await at.toJwt();
      // Read exp back from the token itself, so the two can never disagree.
      const exp = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).exp as number;
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },
    async geminiToken() {
      const gemini = options.gemini;
      if (!gemini) throw new Error("no Gemini key: set GEMINI_API_KEY (or GOOGLE_API_KEY) in .env");
      const now = Date.now();
      const created = await (gemini.create ?? googleCreate)(gemini.apiKey, {
        uses: 1,
        // The session must start within a minute and end within 30 (Live sessions
        // are short anyway; reconnects mint a new token).
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        // Lock the token to our model. The session config (tools, voice) is left
        // open because tools come from the tools folder at connect time.
        liveConnectConstraints: { model: gemini.model ?? DEFAULT_LIVE_MODEL },
      });
      if (!created.name) throw new Error("Gemini did not return an ephemeral token");
      return created.name;
    },
  };
}
