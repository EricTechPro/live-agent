// App connections (config `mcpServers`), in each helper CLI's own words.
//
//   codex exec ...codexMcpArgs(servers).args          // -c mcp_servers.<name>.<key>=<toml>
//   claude -p ... --mcp-config <file of claudeMcpConfig(servers)>
//   <gemini home>/.gemini/settings.json { mcpServers: geminiMcpServers(servers) }
//
// Values may use ${VAR}: keys live in .env (loaded into process.env, src/home.ts),
// never in the config file. Where the secrets go:
// - Codex: argv is visible to `ps`, so the filled-in env values go in Codex's own
//   environment and `env_vars` lets them through to the server.
// - Claude Code: a private temp file (mode 600) for the job's lifetime.
// - Gemini CLI: left as ${VAR}; Gemini CLI fills settings.json values from its environment.
import type { McpServer } from "../config/index.ts";

export type McpServers = Record<string, McpServer>;
type Env = Record<string, string | undefined>;

/** Fill in ${VAR} from the environment; a missing one becomes "". */
export function expandEnv(value: string, env: Env = process.env): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => env[name] ?? "");
}

const filled = (vars: Record<string, string> | undefined, env: Env) =>
  Object.fromEntries(Object.entries(vars ?? {}).map(([k, v]) => [k, expandEnv(v, env)]));

/** Codex `-c` overrides (values are TOML; a JSON string or string list is valid TOML) and the env they need. */
export function codexMcpArgs(servers: McpServers = {}, env: Env = process.env): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const childEnv: Record<string, string> = {};
  for (const [name, s] of Object.entries(servers)) {
    const key = `mcp_servers.${name}`;
    if (s.url) {
      args.push("-c", `${key}.url=${JSON.stringify(expandEnv(s.url, env))}`);
      continue;
    }
    if (!s.command) continue;
    args.push("-c", `${key}.command=${JSON.stringify(s.command)}`);
    if (s.args?.length) args.push("-c", `${key}.args=${JSON.stringify(s.args.map((a) => expandEnv(a, env)))}`);
    const vars = filled(s.env, env);
    if (Object.keys(vars).length) {
      args.push("-c", `${key}.env_vars=${JSON.stringify(Object.keys(vars))}`);
      Object.assign(childEnv, vars);
    }
  }
  return { args, env: childEnv };
}

/** The JSON for Claude Code's --mcp-config, values filled in. */
export function claudeMcpConfig(servers: McpServers = {}, env: Env = process.env): string {
  const out: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.url) out[name] = { type: "http", url: expandEnv(s.url, env) };
    else if (s.command) out[name] = { command: s.command, args: (s.args ?? []).map((a) => expandEnv(a, env)), env: filled(s.env, env) };
  }
  return JSON.stringify({ mcpServers: out });
}

/** Gemini CLI's settings.json `mcpServers` (it fills ${VAR} itself). */
export function geminiMcpServers(servers: McpServers = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.url) out[name] = { httpUrl: s.url };
    else if (s.command) out[name] = { command: s.command, args: s.args ?? [], env: s.env ?? {} };
  }
  return out;
}
