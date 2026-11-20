// Card kinds and limits for the drawing (drawing v2), with no Zod, so the window
// (app/src/layout.ts) can import them without bundling the validator. canvas.ts re-exports them.

export const CARD_KINDS = ["timeline", "list", "flow", "bars", "table", "diagram", "image"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
/** Cards on screen at once; the window closes the oldest to make room. */
export const MAX_CARDS = 4;
export const isCard = (m: { kind: string }): boolean => (CARD_KINDS as readonly string[]).includes(m.kind);
