// save_setup: the setup chat's answers go into the config file (ticket 12).
//
// Risk class "edit": it writes one local file, the user's own config. But the
// core does not use the mode table for it. During a setup chat (started by the
// user: first launch, `live-agent setup`, or the window's Setup button) it is
// allowed in every mode, so Ask me never asks "may I save what you just told
// me?", and the first run is never stuck behind the gate. Outside a setup chat
// it is blocked in every mode, even Bypass: a sentence in a brain note must
// never be able to talk the model into rewriting its own safety mode.
// A per-tool override in the config still wins, as for every tool.
import { defineTool } from "../src/core/tool.ts";
import { saveSetup, SETUP_TOOL, type SetupAnswers } from "../src/setup/index.ts";

export default defineTool<SetupAnswers>({
  name: SETUP_TOOL,
  description:
    "Save the setup chat's answers to the live-agent config file. Only call it during the setup chat, once, " +
    "after asking every setup question. Pass only the answers the user gave; leave out any question they skipped.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      brainPath: { type: "string", description: "The folder where the user's notes live, as they said it." },
      safetyMode: { type: "string", enum: ["ask-me", "auto-edits", "bypass"], description: "The safety mode." },
      helpers: {
        type: "object",
        description: "Turn the Gemini CLI helper on (true) or off (false). Leave it out if the user did not say.",
        properties: {
          geminiCli: { type: "boolean" },
        },
      },
      maxAtOnce: { type: "integer", minimum: 1, description: "The most helpers running at the same time." },
    },
  },
  run(answers, { setup }) {
    if (!setup) throw new Error("setup is not available in this session");
    const { config, warning } = saveSetup(setup.configPath, answers);
    setup.saved(config);
    return {
      saved: setup.configPath,
      config,
      ...(warning ? { warning } : {}),
      note: "The new settings are in use now.",
    };
  },
});
