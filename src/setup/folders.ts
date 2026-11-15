// The wizard's notes step: pick a folder, look inside, map it onto the brain's parts.
//
//   const path = await pickFolder();               // the native macOS folder picker (null: cancelled)
//   const tree = await scanFolder(path);           // top-level folders with file counts, .md count
//   const map = detectParts(tree.folders);         // { raw: { folder: "_inbox", found: true }, ... }
//
// Why names only: the scan never opens a file. It lists names (readdir), so a
// big or private folder is quick to look at and nothing in it is read.
// Why a cap: a folder with a node_modules or a photo library inside must not
// stall the window. Two levels deep and about 4000 entries is enough for the map.
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { BrainFolders } from "../config/index.ts";

export type Part = keyof BrainFolders;
export const PARTS: Part[] = ["raw", "wiki", "projects"];

/** Folder names (after `normName`) that mean each part. */
export const PART_WORDS: Record<Part, string[]> = {
  raw: ["raw", "inbox", "sources", "source", "clippings", "clips", "imports", "import", "capture", "captures", "fleeting"],
  wiki: ["wiki", "notes", "context", "knowledge", "kb", "zettel", "zettelkasten", "permanent", "resources"],
  projects: ["projects", "project", "work", "active"],
};

/** A name as the matcher sees it: no case, no leading `_`, `.`, digits or dashes, no inner spaces/dashes/underscores. */
export function normName(name: string): string {
  return name.toLowerCase().replace(/^[\s_.\d-]+/, "").replace(/[\s_-]+/g, "");
}

export interface FolderTree {
  /** The folder's own name, e.g. `notes`. */
  name: string;
  /** Its full path. */
  path: string;
  /** Top-level folders, by name, with how many files are inside (counted two levels deep). */
  folders: { name: string; files: number }[];
  /** How many `.md` files the walk saw. */
  notes: number;
  /** True when the walk stopped at the cap: the counts are a floor. */
  capped: boolean;
}

export interface ScanOptions {
  /** How many folder levels below the top to count into. Default 2. */
  maxDepth?: number;
  /** Stop after this many entries. Default 4000. */
  maxEntries?: number;
}

// Dot folders (.git, .obsidian) and package folders say nothing about notes.
const skipped = (name: string) => name.startsWith(".") || name === "node_modules";

/** Look inside a folder by names only. Throws if `path` is not a folder. */
export async function scanFolder(path: string, options: ScanOptions = {}): Promise<FolderTree> {
  const maxDepth = options.maxDepth ?? 2;
  const maxEntries = options.maxEntries ?? 4000;
  if (!(await stat(path)).isDirectory()) throw new Error(`${path} is not a folder`);
  const tree: FolderTree = { name: basename(path), path, folders: [], notes: 0, capped: false };
  let seen = 0;

  async function count(dir: string, depth: number, top: boolean): Promise<number> {
    let files = 0;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0; // unreadable (permissions): counts as empty
    }
    for (const entry of entries) {
      if (skipped(entry.name)) continue;
      if (++seen > maxEntries) {
        tree.capped = true;
        return files;
      }
      if (entry.isFile()) {
        files++;
        if (/\.md$/i.test(entry.name)) tree.notes++;
      } else if (entry.isDirectory()) {
        const inside = depth < maxDepth ? await count(`${dir}/${entry.name}`, depth + 1, false) : 0;
        files += inside;
        if (top) tree.folders.push({ name: entry.name, files: inside });
      }
    }
    return files;
  }

  await count(path, 0, true);
  tree.folders.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

export type PartMap = Record<Part, { folder: string; found: boolean }>;

/**
 * Map top-level folders onto the brain's parts by name. A folder is used for
 * one part at most; when several match, the one with most files wins.
 * `folder: ""` means no match: setup creates the part's own folder.
 */
export function detectParts(folders: { name: string; files: number }[]): PartMap {
  const used = new Set<string>();
  const map = {} as PartMap;
  for (const part of PARTS) {
    const hit = folders
      .filter((f) => !used.has(f.name) && PART_WORDS[part].includes(normName(f.name)))
      .sort((a, b) => b.files - a.files)[0];
    map[part] = hit ? { folder: hit.name, found: true } : { folder: "", found: false };
    if (hit) used.add(hit.name);
  }
  return map;
}

/** Shows the folder picker and resolves with the chosen path, or null when cancelled. */
export type FolderPicker = () => Promise<string | null>;

// `activate` first: run from the app's background core, the dialog would
// otherwise open behind the window.
const PICK_SCRIPT = [
  "tell current application to activate",
  'POSIX path of (choose folder with prompt "Pick your notes folder")',
];

/** The native macOS folder picker, via osascript. Cancel resolves null. */
export const pickFolder: FolderPicker = () =>
  new Promise((resolve, reject) => {
    const child = spawn("osascript", PICK_SCRIPT.flatMap((line) => ["-e", line]), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && out.trim()) return resolve(out.trim().replace(/(.)\/$/, "$1"));
      // -128: the user pressed Cancel.
      if (/-128|cancel/i.test(err)) return resolve(null);
      reject(new Error(err.trim() || `the folder picker stopped (${code})`));
    });
  });
