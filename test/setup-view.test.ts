// The window shows a setup save (the wizard) as one note line, from the core's setup event.
import { describe, expect, test } from "bun:test";
import { addToTranscript, emptyTranscript } from "../app/src/transcript.ts";
import { defaultConfig } from "../src/config/index.ts";

describe("setup in the transcript", () => {
  test("a wizard save shows as a note", () => {
    const t = addToTranscript(emptyTranscript, { type: "setup.saved", configPath: "/x/live-agent.config.json", config: defaultConfig() });
    expect(t.lines).toEqual([
      { role: "note", text: "Setup saved to /x/live-agent.config.json. The new settings are in use now." },
    ]);
  });
});
