// Live smoke test: one real text turn through the agent core and real Gemini Live.
// No microphone needed; text stands in for voice (same idea as live-dj's smoke_live).
//
//   bun run smoke
//
// Needs GEMINI_API_KEY (or GOOGLE_API_KEY, the name AI Studio suggests) in your environment or .env.
// With no key it skips cleanly, so it is safe to run anywhere.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSession } from "../src/core/agent.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) console.log("live smoke: skipped (no GEMINI_API_KEY; copy .env.example to .env)");

test.skipIf(!apiKey)(
  "a real text turn comes back as transcript events",
  async () => {
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }) });
    try {
      const events = await session.sendText("Say hello in five words or fewer.");
      const done = events.find((e) => e.type === "turn.done");

      console.log("  you said:  ", "Say hello in five words or fewer.");
      console.log("  model said:", done?.reply || "(no transcript)");
      const errors = events.filter((e) => e.type === "error");
      if (errors.length) console.log("  errors:    ", errors);

      expect(events.some((e) => e.type === "transcript" && e.role === "model")).toBe(true);
      expect(done?.reply.trim()).not.toBe("");
    } finally {
      await session.close();
    }
  },
  30_000,
);

test.skipIf(!apiKey)(
  "a real model reads a named file through read_file",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-agent-smoke-"));
    writeFileSync(join(dir, "shopping.md"), "The secret word is pineapple.");
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }), workDir: dir });
    try {
      const events = await session.sendText("Read the file shopping.md and tell me the secret word.");
      const done = events.find((e) => e.type === "turn.done");
      console.log("  tool calls:", events.filter((e) => e.type === "tool.call"));
      console.log("  model said:", done?.reply || "(no transcript)");

      expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "read_file" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", status: "ok" }));
      expect(done?.reply.toLowerCase()).toContain("pineapple");
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  45_000,
);
