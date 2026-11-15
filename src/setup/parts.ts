// Which folder plays which brain part, by name. Pure (no node:), so the window's
// wizard uses the same words to sort its dropdowns as the core uses to detect.
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

/** Does this folder name mean this part? (For a nested path, its last folder counts.) */
export const matchesPart = (part: Part, name: string) => PART_WORDS[part].includes(normName(name.split("/").pop() ?? name));

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
    const hit = folders.filter((f) => !used.has(f.name) && matchesPart(part, f.name)).sort((a, b) => b.files - a.files)[0];
    map[part] = hit ? { folder: hit.name, found: true } : { folder: "", found: false };
    if (hit) used.add(hit.name);
  }
  return map;
}

/** A part's dropdown order: folders whose name means the part first, then the rest, each alphabetical. */
export function sortForPart(part: Part, names: string[]): string[] {
  const byName = (a: string, b: string) => a.localeCompare(b);
  return [...names.filter((n) => matchesPart(part, n)).sort(byName), ...names.filter((n) => !matchesPart(part, n)).sort(byName)];
}

/**
 * A picked folder as a part folder: its path relative to the brain root, with
 * forward slashes. Null when it is the root itself or outside the brain.
 */
export function insideBrain(root: string, picked: string): string | null {
  const clean = (p: string) => p.replace(/\/+$/, "");
  const r = clean(root);
  const p = clean(picked);
  if (!p.startsWith(`${r}/`)) return null;
  const rel = p.slice(r.length + 1);
  return rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..") ? null : rel;
}
