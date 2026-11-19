// The default helper and the MCP servers every helper job gets (config `defaultHelper`, `mcpServers`).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { pickHelper } from "../src/helpers/index.ts";
import { claudeMcpConfig, codexMcpArgs, expandEnv, geminiMcpServers } from "../src/helpers/mcp.ts";

describe("default helper", () => {
  const allOn = { geminiCli: true, codex: true, claudeCode: true };

  test("with no helper named, the config's default helper is used", () => {
    expect(pickHelper(allOn, undefined, "claude-code").id).toBe("claude-code");
    expect(pickHelper(allOn, undefined, "codex").id).toBe("codex");
  });

  test("a default that is turned off falls back to the first one turned on", () => {
    expect(pickHelper({ ...allOn, codex: false }, undefined, "codex").id).toBe("gemini-cli");
  });

  test("a named helper still wins over the default", () => {
    expect(pickHelper(allOn, "gemini-cli", "codex").id).toBe("gemini-cli");
  });

  test("the config checks the default helper's name", () => {
    expect(checkConfig({ defaultHelper: "claude-code" }).defaultHelper).toBe("claude-code");
    expect(() => checkConfig({ defaultHelper: "gpt" })).toThrow("defaultHelper must be one of");
  });
});

describe("MCP servers in the config", () => {
  test("a command server and a url server load as written", () => {
    const servers = {
      linear: { command: "npx", args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"], env: { TOKEN: "${LINEAR_KEY}" } },
      notion: { url: "https://mcp.notion.com/mcp" },
    };
    expect(checkConfig({ mcpServers: servers }).mcpServers).toEqual(servers);
  });

  test("a bad entry names the field", () => {
    expect(() => checkConfig({ mcpServers: { x: { args: "a b" } } })).toThrow("mcpServers.x.args must be a list");
    expect(() => checkConfig({ mcpServers: { x: { args: [1] } } })).toThrow("mcpServers.x.args.0 must be a string");
    expect(() => checkConfig({ mcpServers: { "bad name": { url: "https://x" } } })).toThrow("mcpServers");
  });

  test("${VAR} in a value is read from the environment (.env is loaded into it)", () => {
    expect(expandEnv("Bearer ${KEY}", { KEY: "abc" })).toBe("Bearer abc");
    expect(expandEnv("${MISSING}", {})).toBe("");
  });
});

describe("add_connection", () => {
  test("saves the server in the config file, keeps the rest, and says which keys .env still needs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-agent-conn-"));
    const configPath = join(dir, "live-agent.config.json");
    writeFileSync(configPath, JSON.stringify({ voice: "Kore" }));
    const call: ModelEvent = {
      type: "tool.call", id: "c1", name: "add_connection",
      args: { name: "linear", command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "${LINEAR_KEY_NOT_SET}" } },
    };
    const s = await startSession({
      model: scriptedModel([[call], [{ type: "text", text: "Added." }]]), tools: await loadTools(), mode: "bypass",
      config: checkConfig({ voice: "Kore" }), configPath, chatEndNote: false,
    });
    const events = await s.sendText("Connect my Linear.");
    await s.close();
    const result = events.find((e) => e.type === "tool.result" && e.id === "c1");
    expect(result).toMatchObject({ status: "ok", output: { saved: "linear", missingKeys: ["LINEAR_KEY_NOT_SET"] } });
    const file = JSON.parse(readFileSync(configPath, "utf8"));
    expect(file.voice).toBe("Kore");
    expect(file.mcpServers.linear).toEqual({ command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "${LINEAR_KEY_NOT_SET}" } });
  });

  test("a server with neither a command nor a url is refused", async () => {
    const tool = (await loadTools()).find((t) => t.name === "add_connection")!;
    expect(tool.risk).toBe("edit");
    await expect(Promise.resolve().then(() => tool.run({ name: "x" }, { connections: { add: () => {} } } as never))).rejects.toThrow(
      "command or a url",
    );
  });
});

describe("MCP servers handed to each helper", () => {
  const servers = {
    linear: { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "${LINEAR_KEY}" } },
    notion: { url: "https://mcp.notion.com/mcp" },
  };
  const env = { LINEAR_KEY: "sekret" };

  test("Codex: -c overrides on the command line; secrets go in its environment, never in argv", () => {
    const { args, env: childEnv } = codexMcpArgs(servers, env);
    expect(args).toEqual([
      "-c", 'mcp_servers.linear.command="npx"',
      "-c", 'mcp_servers.linear.args=["-y","linear-mcp"]',
      "-c", 'mcp_servers.linear.env_vars=["LINEAR_API_KEY"]',
      "-c", 'mcp_servers.notion.url="https://mcp.notion.com/mcp"',
    ]);
    expect(args.join(" ")).not.toContain("sekret");
    expect(childEnv).toEqual({ LINEAR_API_KEY: "sekret" });
  });

  test("Claude Code: one --mcp-config JSON with the values filled in", () => {
    expect(JSON.parse(claudeMcpConfig(servers, env))).toEqual({
      mcpServers: {
        linear: { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "sekret" } },
        notion: { type: "http", url: "https://mcp.notion.com/mcp" },
      },
    });
  });

  test("Gemini CLI: settings.json mcpServers, ${VAR} left for Gemini CLI to fill in", () => {
    expect(geminiMcpServers(servers)).toEqual({
      linear: { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "${LINEAR_KEY}" } },
      notion: { httpUrl: "https://mcp.notion.com/mcp" },
    });
  });
});

test("the system prompt sends live-web questions and 'connect my <app>' to a helper", async () => {
  const { systemInstruction } = await import("../src/core/tone.ts");
  const prompt = systemInstruction("short");
  expect(prompt).toContain("live web");
  expect(prompt).toContain("research task");
  expect(prompt).toContain('"connect my <app>"');
  expect(prompt).toContain("add_connection");
});
