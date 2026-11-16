// The config module: one JSON file that controls live-agent.
//
//   const config = loadConfig();              // $LIVE_AGENT_CONFIG or ./live-agent.config.json
//   const session = await startSession({ model, config });
//
// Why the schema is the source of truth: the defaults live in its `default`
// keywords, so the documented defaults and the real ones can never drift.
import { existsSync, readFileSync } from "node:fs";
import schema from "./config.schema.json" with { type: "json" };

export type SafetyMode = "ask-me" | "auto-edits" | "bypass";
export type Verdict = "allow" | "ask" | "block";
export type Tone = "short" | "casual" | "friendly" | "pro";

/** The folder (one name inside the brain) that plays each part of the brain. */
export interface BrainFolders {
  raw: string;
  wiki: string;
  projects: string;
}

export interface Config {
  brainPath: string;
  safety: { mode: SafetyMode; overrides: Record<string, Verdict> };
  helpers: { geminiCli: boolean; codex: boolean; claudeCode: boolean; maxAtOnce: number };
  worktrees: boolean;
  voice: string;
  tone: Tone;
  brainFolders: BrainFolders;
}

/** Where the config lives unless told otherwise. */
export function defaultConfigPath(): string {
  return process.env.LIVE_AGENT_CONFIG ?? "live-agent.config.json";
}

type SchemaNode = {
  type?: string;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: SchemaNode | false;
  enum?: unknown[];
  minimum?: number;
  minLength?: number;
  pattern?: string;
  /** Ours, not JSON Schema's: the plain words shown when `pattern` does not match. */
  patternMessage?: string;
  default?: unknown;
};

// Walk the schema and collect every `default`. Objects without their own
// default are built from their children's defaults.
function defaultsOf(node: SchemaNode): unknown {
  if (node.default !== undefined) return structuredClone(node.default);
  if (node.type === "object" && node.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const value = defaultsOf(child);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  return undefined;
}

/** The documented defaults, read from the schema. */
export function defaultConfig(): Config {
  return defaultsOf(schema as SchemaNode) as Config;
}

/** Read the config file. A missing file means "use the defaults". */
export function loadConfig(path: string = defaultConfigPath()): Config {
  if (!existsSync(path)) return defaultConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return checkConfig(raw);
  } catch (error) {
    if (error instanceof ConfigError) error.message = `${path}: ${error.message}`;
    throw error;
  }
}

/**
 * Check a config value (the parsed JSON of a file) against the schema and fill
 * in the defaults. Throws ConfigError naming the bad field. The setup chat
 * uses this to check answers before it writes the file.
 */
export function checkConfig(raw: unknown): Config {
  return fill(schema as SchemaNode, raw, "") as Config;
}

/** A config file that cannot be used. The message names the bad field. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

const show = (value: unknown) => JSON.stringify(value);

// Check the file's value against one schema node, then lay it over the
// defaults, so a file that only sets `safety.mode` still gets every other
// default. A tiny hand validator: it covers exactly the keywords our schema
// uses (type, enum, minimum, minLength, pattern, properties, additionalProperties).
function fill(node: SchemaNode, value: unknown, field: string): unknown {
  if (value === undefined) return defaultsOf(node);
  const name = field || "config";

  switch (node.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ConfigError(`${name} must be an object (got ${show(value)})`);
      }
      const given = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const props = node.properties ?? {};
      for (const [key, child] of Object.entries(given)) {
        const path = field ? `${field}.${key}` : key;
        const childNode = props[key] ?? node.additionalProperties;
        if (!childNode) throw new ConfigError(`unknown field ${show(path)}`);
        const filled = fill(childNode, child, path);
        if (key !== "$schema") out[key] = filled;
      }
      // Fill in every field the file left out.
      for (const [key, child] of Object.entries(props)) {
        if (key in given) continue;
        const filled = defaultsOf(child);
        if (filled !== undefined) out[key] = filled;
      }
      return out;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new ConfigError(`${name} must be a boolean (got ${show(value)})`);
      break;
    case "integer":
      if (!Number.isInteger(value)) throw new ConfigError(`${name} must be a whole number (got ${show(value)})`);
      break;
    case "string":
      if (typeof value !== "string") throw new ConfigError(`${name} must be a string (got ${show(value)})`);
      break;
  }
  if (node.enum && !node.enum.includes(value)) {
    throw new ConfigError(`${name} must be one of ${node.enum.map(show).join(", ")} (got ${show(value)})`);
  }
  if (node.minimum !== undefined && (value as number) < node.minimum) {
    throw new ConfigError(`${name} must be at least ${node.minimum} (got ${show(value)})`);
  }
  if (node.minLength !== undefined && (value as string).length < node.minLength) {
    throw new ConfigError(`${name} must not be empty`);
  }
  if (node.pattern !== undefined && !new RegExp(node.pattern).test(value as string)) {
    throw new ConfigError(`${name} ${node.patternMessage ?? `must match ${node.pattern}`} (got ${show(value)})`);
  }
  return value;
}
