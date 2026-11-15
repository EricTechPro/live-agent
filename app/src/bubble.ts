// The speech bubble over the home orb (ticket 30). Pure, like transcript.ts.
// It shows Jett's latest sentence in full: the bubble wraps to two lines, and
// only a sentence longer than that is cut, at a word, with "…".

/** About two lines of the bubble's dot font at its width. */
export const BUBBLE_MAX = 64;

export function bubbleLine(reply: string, max = BUBBLE_MAX): string {
  const lines = reply.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const sentences = (lines.at(-1) ?? "").split(/(?<=[.!?…])\s+/).filter(Boolean);
  const latest = sentences.at(-1) ?? "";
  if (latest.length <= max) return latest;
  const cut = latest.slice(0, max - 1);
  // The cut falls between words: keep it. Inside a word: drop that word (unless it is the only one).
  const atWord = /\s/.test(latest[cut.length] ?? "") ? cut : cut.replace(/\s+\S*$/, "");
  return `${(atWord || cut).trimEnd()}…`;
}
