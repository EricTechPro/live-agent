// The window shows the setup chat (ticket 12): a note line when it starts and
// when the config is saved, from the core's setup events.
import { describe, expect, test } from "bun:test";
import { addToTranscript, emptyTranscript } from "../app/src/transcript.ts";
import { defaultConfig } from "../src/config/index.ts";

describe("setup in the transcript", () => {
  test("first-run setup and its save show as notes around the chat", () => {
    let t = addToTranscript(emptyTranscript, { type: "setup.started", configPath: "/x/live-agent.config.json", firstRun: true });
    t = addToTranscript(t, { type: "transcript", role: "model", text: "Where do your notes live?" });
    t = addToTranscript(t, { type: "setup.saved", configPath: "/x/live-agent.config.json", config: defaultConfig() });

    expect(t.lines).toEqual([
      { role: "note", text: "Setup: a few quick questions. Say skip to keep the default." },
      { role: "model", text: "Where do your notes live?" },
      { role: "note", text: "Setup saved to /x/live-agent.config.json. The new settings are in use now." },
    ]);
  });

  test("running setup again says so", () => {
    const t = addToTranscript(emptyTranscript, { type: "setup.started", configPath: "c.json", firstRun: false });
    expect(t.lines).toEqual([{ role: "note", text: "Setup again: change what you like, skip the rest." }]);
  });
});
