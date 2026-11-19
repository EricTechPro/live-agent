// set_voice: change Jett's own voice and speaking style ("use a calmer voice", "switch to Bright",
// "talk slower", "sound like a radio host").
//
// Saved to the config file the setup wizard writes, so Settings shows the new voice. Gemini
// fixes the voice per connection, so the core moves to a resumed connection: same chat, and
// the line Jett says after this call is in the new voice. Risk class "read": it changes only
// Jett's own voice setting, never the user's files.
import { findVoice, VOICES } from "../src/core/voices.ts";
import { defineTool } from "../src/core/tool.ts";

const NAMES = VOICES.map((v) => `${v.label} (${v.id})`).join(", ");

export default defineTool<{ voice?: string; style?: string }>({
  name: "set_voice",
  description:
    "Change your own voice and / or speaking style. Use it when the user asks for a different voice " +
    `('use a calmer voice', 'switch to Bright') or a way of speaking ('talk slower', 'sound more excited', 'like a radio host'). Voices: ${NAMES}. ` +
    "Calmer means Calm, more energy means Upbeat or Bright, more serious means Firm. " +
    "style is a short note on how to speak; an empty style goes back to normal. " +
    "Before calling, say nothing. After it returns, say one short line in the new voice.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      voice: { type: "string", enum: VOICES.flatMap((v) => [v.label, v.id]), description: "The voice to switch to, by its label or name." },
      style: { type: "string", description: "How to speak, in a few words, e.g. 'slower', 'more excited', 'like a radio host'. Empty: back to normal." },
    },
  },
  async run({ voice, style }, { setVoice }) {
    if (!setVoice) throw new Error("this app cannot change voices");
    const picked = voice ? findVoice(voice) : undefined;
    if (voice && !picked) throw new Error(`unknown voice ${voice}. Voices: ${NAMES}`);
    if (!picked && style === undefined) throw new Error(`say which voice (${NAMES}) or a speaking style`);
    const done = await setVoice({ voice: picked?.id, style });
    const label = findVoice(done.voice)?.label ?? done.voice;
    return {
      voice: label,
      style: done.style || "normal",
      instruction: done.applied
        ? "Your voice has changed. Say one short line in it now, like \"How's this?\"."
        : "Saved, but the new voice starts on the next connection. Say so in one short line.",
    };
  },
});
