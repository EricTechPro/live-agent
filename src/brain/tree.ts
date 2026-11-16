// The window's view of the brain (ticket 23): a file tree of the three parts,
// and one note read as plain text. Read only.
//
//   await brainTree(root, folders)          // { parts: [{ part, folder, children }], truncated? }
//   await readBrainFile(root, path, folders) // { path, text }, or throws BrainPathError / BrainFileMissing
//
// Safety: a path is only read when it is markdown inside one of the three part
// folders, with no `..`, no dot or junk folder on the way, and its real path
// (symlinks followed) still inside that part. Everything else is refused.
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { DEFAULT_FOLDERS, ignoredNames, JUNK_FOLDERS, type BrainFolders } from "./index.ts";

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

export interface BrainTree {
  parts: { part: keyof BrainFolders; folder: string; children: TreeNode[] }[];
  /** True when the brain had more than MAX_FILES notes and the tree stops there. */
  truncated?: boolean;
}

/** A huge brain still answers fast: the tree lists at most this many notes. */
export const MAX_FILES = 5000;
/** The reader shows at most this much of one note. */
export const MAX_READ_BYTES = 1_000_000;

export class BrainPathError extends Error {}
export class BrainFileMissing extends Error {}

const PARTS = ["raw", "wiki", "projects"] as const;

const skip = (name: string, ignored: Set<string>) => name.startsWith(".") || JUNK_FOLDERS.has(name) || ignored.has(name);

export async function brainTree(root: string, folders: BrainFolders = DEFAULT_FOLDERS): Promise<BrainTree> {
  const ignored = await ignoredNames(root);
  let files = 0;
  let truncated = false;

  // Symlinks are left out (Dirent says neither file nor folder for them): the tree never leads outside.
  async function walk(rel: string): Promise<TreeNode[]> {
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return []; // a missing part folder is just empty
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const dirs: TreeNode[] = [];
    const notes: TreeNode[] = [];
    for (const entry of entries) {
      if (skip(entry.name, ignored)) continue;
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        const children = await walk(path);
        if (children.length) dirs.push({ kind: "dir", name: entry.name, path, children });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (files >= MAX_FILES) {
          truncated = true;
          break;
        }
        files++;
        notes.push({ kind: "file", name: entry.name, path });
      }
    }
    return [...dirs, ...notes];
  }

  const parts: BrainTree["parts"] = [];
  for (const part of PARTS) parts.push({ part, folder: folders[part], children: await walk(folders[part]) });
  return truncated ? { parts, truncated } : { parts };
}

/** One note's text. `path` is inside the brain with forward slashes, e.g. `wiki/sourdough.md`. */
export async function readBrainFile(root: string, path: string, folders: BrainFolders = DEFAULT_FOLDERS) {
  const refuse = () => new BrainPathError(`${path} is not a note in the brain.`);
  if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") || !path.endsWith(".md")) throw refuse();
  const segs = path.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) throw refuse();
  const folder = Object.values(folders).find((f) => path.startsWith(`${f}/`));
  if (!folder) throw refuse();
  const ignored = await ignoredNames(root);
  if (path.slice(folder.length + 1).split("/").some((s) => skip(s, ignored))) throw refuse();

  // The real path, symlinks followed, must still be inside the part's real folder.
  let real: string;
  let partReal: string;
  let rootReal: string;
  try {
    [real, partReal, rootReal] = await Promise.all([realpath(join(root, path)), realpath(join(root, folder)), realpath(root)]);
  } catch {
    throw new BrainFileMissing(`${path} is not there any more.`);
  }
  if (!real.startsWith(partReal + sep) || !real.startsWith(rootReal + sep)) throw refuse();
  const info = await stat(real);
  if (!info.isFile()) throw refuse();
  const text = (await readFile(real)).subarray(0, MAX_READ_BYTES).toString("utf8");
  return { path, text, ...(info.size > MAX_READ_BYTES ? { truncated: true } : {}) };
}
