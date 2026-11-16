// One line of text for anything that was thrown.
//
// Why a helper: `throw` can throw anything (an Error, a string, an object), and
// the core shows the reason to people and to the model as plain text.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
