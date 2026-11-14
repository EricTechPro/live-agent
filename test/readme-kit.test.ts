// The README and the kit are part of the product: the doctor and the helper
// point people at README anchors, and the prompts/ and skills/ folders promise
// a one-line description for every file. These checks keep those promises true.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const README = read("README.md");

// GitHub's heading anchor: lowercase, drop punctuation, spaces become dashes.
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const anchors = new Set(
  README.split("\n")
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => slug(line.replace(/^#+\s*/, ""))),
);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("README anchors the code points to", () => {
  // Every `README.md#anchor` written in the code (doctor, helper fixes, installer).
  const sources = [...filesUnder(join(ROOT, "src")), ...filesUnder(join(ROOT, "tools")), join(ROOT, "get.sh")];
  const used = new Set<string>();
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(/README\.md#([\w-]+)/g)) used.add(match[1]!);
  }

  test("the code links to the key guide", () => {
    expect(used).toContain("get-your-gemini-key");
  });

  for (const anchor of used) {
    test(`README.md#${anchor} exists`, () => {
      expect(anchors).toContain(anchor);
    });
  }

  test("links inside the README go to real headings", () => {
    for (const match of README.matchAll(/\]\(#([\w-]+)\)|href="#([\w-]+)"/g)) {
      expect(anchors).toContain(match[1] ?? match[2]!);
    }
  });
});

describe("README links to files", () => {
  const targets = [...README.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)|src="([^"]+)"/g)]
    .map((m) => (m[1] ?? m[2])!)
    .filter((t) => !/^[a-z]+:/i.test(t));

  test("the key guide has its screenshot slots", () => {
    expect(targets.filter((t) => t.startsWith("docs/images/key-guide/")).length).toBeGreaterThanOrEqual(4);
  });

  test("every other linked file exists", () => {
    // The key-guide screenshots are taken by a person with a Google account (ticket 14 comments).
    const missing = targets.filter((t) => !t.startsWith("docs/images/key-guide/") && !existsSync(join(ROOT, t)));
    expect(missing).toEqual([]);
  });
});

describe("the kit lists every file with a one-line description", () => {
  for (const folder of ["prompts", "skills"]) {
    const index = read(`${folder}/README.md`);
    const files = filesUnder(join(ROOT, folder))
      .map((f) => relative(join(ROOT, folder), f))
      .filter((f) => f !== "README.md");

    test(`${folder}/ has files`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      test(`${folder}/README.md describes ${file}`, () => {
        // A table row: | [`file`](file) | a description of a few words |
        const row = index.split("\n").find((line) => line.startsWith("|") && line.includes(`(${file})`));
        expect(row).toBeDefined();
        const description = row!.split("|")[2]?.trim() ?? "";
        expect(description.split(/\s+/).length).toBeGreaterThanOrEqual(4);
      });
    }

    test(`the main README points to ${folder}/`, () => {
      expect(README).toContain(`(${folder}/README.md)`);
    });
  }
});
