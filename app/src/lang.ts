// The window's own words follow the language the user last spoke (ticket 37). Pure.
// Only English and Chinese for now: any Han character in what you said means Chinese.
export type Lang = "en" | "zh";

const HAN = /\p{Script=Han}/u;
const LATIN_WORD = /[A-Za-z]{2,}/;

/** The language of a line you said, or undefined when it says nothing either way (numbers, "ok"). */
export function spokenLang(text: string): Lang | undefined {
  if (HAN.test(text)) return "zh";
  if (LATIN_WORD.test(text)) return "en";
  return undefined;
}

/** A few lines the window says itself (the greeting, new chat). */
export const WORDS: Record<Lang, { hi: string; newChat: string }> = {
  en: { hi: "Hi! I'm Jett.", newChat: "New chat" },
  zh: { hi: "嗨！我是 Jett。", newChat: "新对话" },
};
