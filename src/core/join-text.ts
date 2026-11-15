// Joining the model's text pieces (ticket 30). The model's words arrive in pieces:
// streamed chunks inside a sentence, and whole segments before and after a tool
// call. Chunks carry their own spaces; segments don't, so "Claude Code." and
// "May I start it?" came out as "Claude Code.May I start it?".
//
// Rule: a piece ending a sentence (. ! ? or …, maybe with a closing quote or
// bracket) followed by a piece starting with a capital letter gets one space.
// Anything else joins as it is, so chunks inside a word or a sentence never
// gain a space ("notes." + "md" stays "notes.md").
const SENTENCE_END = /[.!?…]["'”’)\]]?$/;
const NEW_SENTENCE = /^\p{Lu}/u;

export function joinText(before: string, next: string): string {
  return SENTENCE_END.test(before) && NEW_SENTENCE.test(next) ? `${before} ${next}` : before + next;
}
