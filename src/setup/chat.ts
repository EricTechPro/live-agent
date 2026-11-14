// `live-agent setup`: the setup chat, typed in a terminal.
//
// Same agent core, same `save_setup` tool, same questions as the window; only
// the input (lines you type) and output (lines printed) differ. The installer
// (ticket 13) can run it, and so can anyone who wants to change their answers.
import { createInterface } from "node:readline";
import { defaultConfigPath } from "../config/index.ts";
import { startSession } from "../core/agent.ts";
import type { AgentEvent } from "../core/events.ts";
import type { Model } from "../core/model.ts";
import { geminiLiveModel } from "../models/gemini-live.ts";
import saveSetup from "../../tools/save-setup.ts";

export interface SetupChatOptions {
  model: Model;
  configPath?: string;
  /** The user's answers, one per line. Ends the chat when it runs out. */
  answers: AsyncIterable<string>;
  /** Where the agent's lines go. */
  print(line: string): void;
}

/** Run one setup chat. Resolves with the saved event, or null if the answers ran out first. */
export async function runSetupChat(options: SetupChatOptions): Promise<AgentEvent | null> {
  // Only save_setup: the setup chat should not wander off into the brain or start helpers.
  // No chat-end note: "what's your brain folder" is not something to remember.
  const session = await startSession({
    model: options.model,
    configPath: options.configPath ?? defaultConfigPath(),
    tools: [saveSetup],
    chatEndNote: false,
  });
  let saved: AgentEvent | null = null;
  const show = (events: AgentEvent[]) => {
    for (const event of events) {
      if (event.type === "turn.done" && event.reply.trim()) options.print(event.reply.trim());
      if (event.type === "error") options.print(`(error: ${event.message})`);
      if (event.type === "setup.saved") saved = event;
    }
  };
  try {
    show(await session.setup.start());
    if (saved) return saved;
    for await (const line of options.answers) {
      show(await session.sendText(line.trim() || "skip"));
      if (saved) break;
    }
    return saved;
  } finally {
    await session.close();
  }
}

/** The `live-agent setup` command. Exit code 0 once the config is saved. */
export async function setupMain(): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("live-agent setup: no Gemini key. Copy .env.example to .env and set GEMINI_API_KEY.");
    return 1;
  }
  const configPath = defaultConfigPath();
  console.log(`live-agent setup: answers go to ${configPath}. Type your answer and press Enter (empty line = skip).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  // Prompt before each line we read, so the user knows it is their turn.
  async function* answers() {
    const lines = rl[Symbol.asyncIterator]();
    for (;;) {
      rl.prompt();
      const next = await lines.next();
      if (next.done) return;
      yield next.value as string;
    }
  }
  try {
    const saved = await runSetupChat({
      model: geminiLiveModel({ apiKey }),
      configPath,
      answers: answers(),
      print: (line) => console.log(line),
    });
    if (!saved) {
      console.error("live-agent setup: stopped before saving. Your config was not changed.");
      return 1;
    }
    console.log(`live-agent setup: saved ${configPath}.`);
    return 0;
  } finally {
    rl.close();
  }
}
