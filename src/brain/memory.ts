// What Jett remembers: one line per fact `remember` saved, with Forget.
//
//   await addFact(brain, { text, path });   // remember: the raw note it wrote
//   await forgetFact(brain, "gym");          // forget: by id or by its words
//
// Why a list beside the notes: `remember` writes a raw note, which reads as a file, not as
// "what Jett knows about me". `.memory.json` (at the brain's root, a dot file, never read as
// a note) keeps one line per fact for the Brain tab. Forget drops the line and deletes the
// raw note it wrote, so it is gone from the brain too. A wiki page the tidy job already
// wrote from it is left alone: that is the user's own page now.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface Fact {
  id: string;
  text: string;
  /** The raw note it was saved as (path inside the brain). */
  path?: string;
  at: string;
}

export const MEMORY_FILE = ".memory.json";
const file = (brain: string) => join(brain, MEMORY_FILE);

export async function listFacts(brain: string): Promise<Fact[]> {
  try {
    const parsed = JSON.parse(await readFile(file(brain), "utf8"));
    return Array.isArray(parsed) ? (parsed as Fact[]) : [];
  } catch {
    return [];
  }
}

async function save(brain: string, facts: Fact[]) {
  await mkdir(dirname(file(brain)), { recursive: true });
  const tmp = `${file(brain)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(facts, null, 2)}\n`);
  await rename(tmp, file(brain));
}

let counter = 0;
export async function addFact(brain: string, fact: { text: string; path?: string }, now = new Date()): Promise<Fact> {
  const facts = await listFacts(brain);
  const added: Fact = { id: `m${now.getTime().toString(36)}${(counter++ % 36).toString(36)}`, text: fact.text.trim(), ...(fact.path ? { path: fact.path } : {}), at: now.toISOString() };
  facts.push(added);
  await save(brain, facts);
  return added;
}

/** Forget one fact, by id or by words that pick out a single fact. Deletes its raw note. */
export async function forgetFact(brain: string, key: string): Promise<Fact> {
  const facts = await listFacts(brain);
  const k = key.trim().toLowerCase();
  const byId = facts.find((f) => f.id === key.trim());
  const hits = byId ? [byId] : facts.filter((f) => f.text.toLowerCase().includes(k));
  if (!k || !hits.length) throw new Error(`nothing remembered matches "${key}"`);
  if (hits.length > 1) throw new Error(`"${key}" matches ${hits.length} facts: ${hits.map((f) => `${f.id} "${f.text.slice(0, 60)}"`).join(", ")}. Use the id.`);
  const gone = hits[0]!;
  await save(brain, facts.filter((f) => f !== gone));
  if (gone.path) {
    // Only ever a file inside the brain (the path came from remember, but check anyway).
    const root = resolve(brain);
    const full = resolve(root, gone.path);
    if (full.startsWith(root + sep)) await rm(full, { force: true });
  }
  return gone;
}
