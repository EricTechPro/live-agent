// Live smoke for the setup chat (ticket 12): real Gemini Live runs the setup
// from typed answers and writes a config that passes the schema, to a temp path.
//
//   bun run smoke
//
// Skips cleanly without GEMINI_API_KEY (or GOOGLE_API_KEY).
import { geminiApiKey } from "../src/gemini-key.ts";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";
import { runSetupChat } from "../src/setup/chat.ts";

const apiKey = geminiApiKey();
const dir = mkdtempSync(join(tmpdir(), "live-agent-setup-smoke-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.skipIf(!apiKey)(
  "real Gemini runs the setup chat from typed answers and writes a valid config",
  async () => {
    const configPath = join(dir, "live-agent.config.json");
    // One answer per question, in order, then nudges in case the model checks back before saving.
    async function* answers() {
      for (const line of [
        "My notes are in the folder my-notes.",
        "Ask me mode, please.",
        "Turn on the Gemini CLI helper.",
        "Two at once.",
        "Yes, that's everything. Please save it.",
        "Yes, save it now.",
      ]) {
        console.log("  you:  ", line);
        yield line;
      }
    }

    const saved = await runSetupChat({
      model: geminiLiveModel({ apiKey: apiKey! }),
      configPath,
      answers: answers(),
      print: (line) => console.log("  agent:", line),
    });

    expect(saved?.type).toBe("setup.saved");
    const config = loadConfig(configPath); // throws if the file breaks the schema
    console.log("  saved:", JSON.stringify(config));
    expect(config.brainPath).toContain("my-notes");
    expect(config.safety.mode).toBe("ask-me");
    expect(config.helpers).toEqual({ geminiCli: true, codex: false, claudeCode: false, maxAtOnce: 2 });
  },
  120_000,
);
