// The brain: a folder of markdown notes in three parts.
//
//   raw/       quick notes as they come in (written by the agent, tidied later)
//   wiki/      tidy pages, one topic each      <- answers come from here
//   projects/  one page per project            <- and here
//
// Why plain files and a word search (no vector database): the notes are small,
// people already keep them in folders, and anyone can open the brain in an
// editor and see exactly what the agent sees.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { BrainFolders } from "../config/index.ts";

export type { BrainFolders };

/**
 * The real folder names of the three parts. An existing notes folder can keep
 * its own names (config `brainFolders`, mapped by the setup wizard), e.g.
 * `{ raw: "_inbox", wiki: "03 Notes", projects: "Work" }`.
 */
export const DEFAULT_FOLDERS: BrainFolders = { raw: "raw", wiki: "wiki", projects: "projects" };

/** The parts answers come from. `raw` is left out on purpose: it is untidy, unchecked input. */
export const ANSWER_PARTS = ["wiki", "projects"] as const;

/** The real folders answers come from, for this brain's mapping. */
export function answerFolders(folders: BrainFolders = DEFAULT_FOLDERS): string[] {
  return ANSWER_PARTS.map((part) => folders[part]);
}

export interface Note {
  /** Path inside the brain, always with forward slashes, e.g. `wiki/sourdough-starter.md`. */
  path: string;
  content: string;
}

/** Where the brain lives: the config's `brainPath`, relative paths starting in `workDir`. */
export function brainRoot(brainPath: string, workDir = process.cwd()): string {
  return resolve(workDir, brainPath);
}

// Folders that are never notes: packages, git, build output, scratch. A real brain
// (a repo like EricOS) has code projects inside it, and their READMEs must not answer.
const NEVER = new Set(["node_modules", "dist", "build", "out", "vendor", "coverage", "target", "_tmp", "tmp", "__pycache__"]);

/** Plain folder names in the brain's own .gitignore (`coverage/`, `cache`): cheap to honour; globs are skipped. */
async function ignoredNames(root: string): Promise<Set<string>> {
  try {
    const lines = (await readFile(join(root, ".gitignore"), "utf8")).split(/\r?\n/);
    return new Set(lines.map((l) => l.trim().replace(/^\/|\/$/g, "")).filter((l) => l && !l.startsWith("#") && /^[^*?[\]!/]+$/.test(l)));
  } catch {
    return new Set();
  }
}

/** Every `.md` file under `dir`, skipping dot folders (.git, .obsidian), NEVER and ignored names. */
async function walkMarkdown(dir: string, ignored: Set<string>): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // a missing folder is just empty
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NEVER.has(entry.name)) out.push(...(await walkMarkdown(full, ignored)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Every `.md` note under the wiki and projects folders. A missing folder is just empty. */
export async function listNotes(root: string, folders: BrainFolders = DEFAULT_FOLDERS): Promise<Note[]> {
  const notes: Note[] = [];
  const ignored = await ignoredNames(root);
  for (const folder of answerFolders(folders)) {
    const files = (await walkMarkdown(join(root, folder), ignored)).map((full) => relative(root, full).split(sep).join("/")).sort();
    for (const path of files) notes.push({ path, content: await readFile(join(root, path), "utf8") });
  }
  return notes;
}

// Little words that match every note and say nothing about the question.
const STOP = new Set(
  "the and for are was what when where which who why how does did do you your my me our can about with from that this have has into".split(" "),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * The notes that best match a question, best first (at most `limit`).
 * Score: how many of the question's words a note contains, with words in the
 * note's file name counting extra (a note named after the topic is the best bet).
 * Notes scoring under half the best score are dropped.
 */
export async function searchBrain(
  root: string,
  query: string,
  limit = 3,
  folders: BrainFolders = DEFAULT_FOLDERS,
): Promise<Note[]> {
  const terms = [...new Set(words(query))];
  const scored = (await listNotes(root, folders)).map((note) => {
    const name = new Set(words(note.path));
    const body = new Set(words(note.content));
    let score = 0;
    for (const t of terms) score += (name.has(t) ? 2 : 0) + (body.has(t) ? 1 : 0);
    return { note, score };
  });
  // Keep only strong matches: a note that shares one stray word with the
  // question ("feed") should not be listed as a note the answer used.
  const best = Math.max(0, ...scored.map((s) => s.score));
  return scored
    .filter((s) => s.score > 0 && s.score * 2 >= best)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.note);
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export interface RawNote {
  /** A few words; becomes the heading and the file name (`2026-11-13-gate-code.md`). */
  title: string;
  /** The note itself, markdown. */
  text: string;
  /** The note's date (local time). Default: now. */
  date?: Date;
}

/**
 * Write a new dated note into the raw folder and return its path inside the brain
 * (e.g. `raw/2026-11-13-chat.md`, or `_inbox/...` when raw is mapped to `_inbox`).
 *
 * Never overwrites: if the name is taken it tries `-2`, `-3`, ... The
 * exclusive-create flag makes that safe even if two notes land at once.
 */
export async function saveRawNote(root: string, note: RawNote, folders: BrainFolders = DEFAULT_FOLDERS): Promise<string> {
  const date = note.date ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const slug = words(note.title).slice(0, 6).join("-") || "note";
  const content = `# ${note.title.trim() || "Note"}, ${date.getDate()} ${MONTHS[date.getMonth()]}\n\n${note.text.trim()}\n`;
  const raw = folders.raw;
  await mkdir(join(root, raw), { recursive: true });
  for (let n = 1; ; n++) {
    const name = `${day}-${slug}${n === 1 ? "" : `-${n}`}.md`;
    try {
      await writeFile(join(root, raw, name), content, { flag: "wx" });
      return `${raw}/${name}`;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
}
