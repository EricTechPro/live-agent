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

export { detectParts, normName, PART_WORDS, PARTS, type Part, type PartMap } from "./parts.ts";

export interface FolderTree {
  /** The folder's own name, e.g. `notes`. */
  name: string;
  /** Its full path. */
  path: string;
  /**
   * Every top-level folder, by name, with how many files are inside (counted two
   * levels deep). `capped`: its count stopped at its share of the cap, so it is a floor.
   */
  folders: { name: string; files: number; capped?: boolean }[];
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

  // Count files under `dir`, spending at most `budget` entries. Returns [files, entries used].
  async function count(dir: string, depth: number, budget: number): Promise<[number, number]> {
    let files = 0;
    let used = 0;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [0, 0]; // unreadable (permissions): counts as empty
    }
    for (const entry of entries) {
      if (skipped(entry.name)) continue;
      if (used >= budget) {
        tree.capped = true;
        break;
      }
      used++;
      if (entry.isFile()) {
        files++;
        if (/\.md$/i.test(entry.name)) tree.notes++;
      } else if (entry.isDirectory() && depth < maxDepth) {
        const [inside, spent] = await count(`${dir}/${entry.name}`, depth + 1, budget - used);
        files += inside;
        used += spent;
      }
    }
    return [files, used];
  }

  // Every top-level folder is listed, whatever its size: the map needs all the names.
  // The budget is shared, so one huge folder (assets, a photo library) cannot starve the rest.
  const top = (await readdir(path, { withFileTypes: true })).filter((e) => !skipped(e.name));
  const dirs = top.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const file of top.filter((e) => e.isFile())) if (/\.md$/i.test(file.name)) tree.notes++;
  const share = Math.max(1, Math.floor((maxEntries - top.length) / Math.max(1, dirs.length)));
  for (const dir of dirs) {
    const before = tree.capped;
    tree.capped = false;
    const [files] = await count(`${path}/${dir.name}`, 1, share);
    tree.folders.push({ name: dir.name, files, ...(tree.capped ? { capped: true } : {}) });
    tree.capped ||= before;
  }
  tree.folders.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

/**
 * Shows the folder picker (opening at `startAt` when given) and resolves with
 * the chosen path, or null when cancelled.
 */
export type FolderPicker = (startAt?: string) => Promise<string | null>;

/** The native macOS folder picker, via osascript. Cancel resolves null. */
export const pickFolder: FolderPicker = (startAt) =>
  new Promise((resolve, reject) => {
    // `activate` first: run from the app's background core, the dialog would
    // otherwise open behind the window. The start folder goes in as an argument
    // (`item 1 of argv`), never pasted into the script.
    const script = [
      "on run argv",
      "tell current application to activate",
      startAt
        ? 'return POSIX path of (choose folder with prompt "Pick a folder in your notes" default location (POSIX file (item 1 of argv)))'
        : 'return POSIX path of (choose folder with prompt "Pick your notes folder")',
      "end run",
    ];
    const args = [...script.flatMap((line) => ["-e", line]), ...(startAt ? [startAt] : [])];
    const child = spawn("osascript", args, { stdio: ["ignore", "pipe", "pipe"] });
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
