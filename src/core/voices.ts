// Jett's voices: Gemini Live prebuilt voice names, with the plain words people use.
//
//   findVoice("Bright")?.id  // "Zephyr"
//   findVoice("kore")?.label // "Firm"
//
// One list for the setup wizard's chips (app/src/wizard-flow.ts) and the set_voice
// tool, so a voice the wizard offers is always one Jett can switch to by voice.
export interface Voice {
  /** The Gemini Live prebuilt voice name: what the config keeps. */
  id: string;
  /** The word on the wizard's chip, and what people say ("switch to Bright"). */
  label: string;
  /** The wizard says this when the chip is picked. */
  line: string;
}

export const VOICES: Voice[] = [
  { id: "Puck", label: "Upbeat", line: "Hey hey!" },
  { id: "Charon", label: "Calm", line: "Hello. Nice to meet you." },
  { id: "Kore", label: "Firm", line: "Ready when you are." },
  { id: "Zephyr", label: "Bright", line: "Hi! This is fun!" },
];

/** A voice by its label or Gemini name, any case. Undefined when it is not one of ours. */
export function findVoice(name: string): Voice | undefined {
  const key = name.trim().toLowerCase();
  return VOICES.find((v) => v.id.toLowerCase() === key || v.label.toLowerCase() === key);
}
