// The tidy job: new raw notes in, clean wiki pages out (Karpathy-style raw -> wiki).
//
//   session = await startSession({ model, tidy: geminiTidyModel({ apiKey }) });
//   ...
//   await session.close();   // writes the chat-end note, then queues a "tidy" job
//
// Why a text model call (not the Gemini CLI helper): the tidy only needs to
// read notes and write markdown, so it gets exactly that: a plain function
// from notes to pages. The core writes the pages itself, and only inside
// wiki/, so the model can never touch raw/, projects/ or anything outside the
// brain. The Gemini CLI would need its own sign-in, a yolo approval mode and
// a free run of the brain folder for the same result. A plain function is
// also trivial to fake in fast tests.
//
// "New" raw notes: the brain keeps a small state file, `.tidy-state.json`,
// listing the raw notes already tidied. A note is only marked once its pages
// are written, so a failed or interrupted tidy just tries again after the
// next chat. Raw notes are never deleted or changed.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";
import { listNotes, type Note } from "./index.ts";

/** What the tidy model gets: the raw notes to tidy and the wiki as it is now. */
export interface TidyInput {
  raw: Note[];
  wiki: Note[];
  signal: AbortSignal;
}

/** A wiki page to create or replace (whole content), e.g. `{ path: "wiki/gus.md", content }`. */
export interface WikiPage {
  path: string;
  content: string;
}

/** Turns raw notes into wiki pages. Real: `geminiTidyModel(...)`; tests pass a plain function. */
export type TidyModel = (input: TidyInput) => Promise<WikiPage[]>;

export const TIDY_STATE_FILE = ".tidy-state.json";

// A wiki page path the core will write: wiki/, lowercase words with dashes, .md.
const PAGE_PATH = /^wiki\/([a-z0-9]+(-[a-z0-9]+)*\/)*[a-z0-9]+(-[a-z0-9]+)*\.md$/;

async function readTidied(root: string): Promise<Set<string>> {
  try {
    const state = JSON.parse(await readFile(join(root, TIDY_STATE_FILE), "utf8")) as { tidied?: unknown };
    return new Set(Array.isArray(state.tidied) ? state.tidied.filter((p): p is string => typeof p === "string") : []);
  } catch {
    return new Set(); // no state yet (or unreadable): everything in raw/ is new
  }
}

async function writeTidied(root: string, tidied: Set<string>) {
  // Write then rename, so a crash never leaves half a state file.
  const file = join(root, TIDY_STATE_FILE);
  await writeFile(`${file}.tmp`, JSON.stringify({ tidied: [...tidied].sort() }, null, 2) + "\n");
  await rename(`${file}.tmp`, file);
}

/** Raw notes not yet tidied, oldest name first. */
export async function untidiedNotes(root: string): Promise<Note[]> {
  const tidied = await readTidied(root);
  let files: string[];
  try {
    files = (await readdir(join(root, "raw"))).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const notes: Note[] = [];
  for (const file of files) {
    const path = `raw/${file}`;
    if (!tidied.has(path)) notes.push({ path, content: await readFile(join(root, path), "utf8") });
  }
  return notes;
}

/**
 * Tidy the brain once: new raw notes -> model -> wiki pages, then mark the notes
 * tidied. Returns a one-line summary for the job board. Throws (nothing written,
 * nothing marked) if the model fails or asks for a page outside wiki/.
 */
export async function tidyBrain(root: string, model: TidyModel, signal: AbortSignal): Promise<string> {
  const raw = await untidiedNotes(root);
  if (!raw.length) return "nothing new to tidy";
  const wiki = (await listNotes(root)).filter((n) => n.path.startsWith("wiki/"));
  const pages = await model({ raw, wiki, signal });
  signal.throwIfAborted();

  // Check every page before writing any, so a bad answer changes nothing.
  for (const page of pages) {
    if (!PAGE_PATH.test(page.path)) throw new Error(`the tidy model asked to write "${page.path}", which is not a wiki page`);
    if (typeof page.content !== "string" || !page.content.trim()) throw new Error(`the tidy model gave ${page.path} no content`);
  }
  for (const page of pages) {
    const full = join(root, page.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, page.content.endsWith("\n") ? page.content : `${page.content}\n`);
  }

  const tidied = await readTidied(root);
  for (const note of raw) tidied.add(note.path);
  await writeTidied(root, tidied);

  const n = raw.length;
  const notes = `${n} raw note${n === 1 ? "" : "s"}`;
  if (!pages.length) return `${notes} tidied, no wiki changes`;
  return `${pages.length} wiki page${pages.length === 1 ? "" : "s"} from ${notes}: ${pages.map((p) => p.path).join(", ")}`;
}

// One tidy at a time per brain, across sessions: a tidy still running from the
// last chat finishes before the next one reads the state file.
const running = new Map<string, Promise<unknown>>();

/**
 * Resolves once no tidy is running in this process (never rejects). The app
 * waits on this before exiting, since the tidy outlives the chat's session.
 */
export async function tidiesSettled(): Promise<void> {
  while (running.size) await Promise.allSettled([...running.values()]);
}

/** The tidy as an orchestrator job (kind "tidy"): same states as any helper job. */
export function tidyJob(root: string, model: TidyModel): JobSpec {
  return {
    kind: "tidy",
    title: "tidy raw notes into wiki pages",
    run({ signal }) {
      const before = running.get(root) ?? Promise.resolve();
      const mine = before.catch(() => {}).then(() => tidyBrain(root, model, signal));
      running.set(root, mine);
      void mine.finally(() => running.get(root) === mine && running.delete(root)).catch(() => {});
      return mine;
    },
  };
}
