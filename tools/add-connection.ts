// add_connection: save an app connection (an MCP server) in the config, so every
// helper job from now on can use that app (src/helpers/mcp.ts).
// Risk class "edit": it writes the config file.
// "Connect my Linear": a helper first finds the official server (tone.ts), then this saves it.
import { defineTool } from "../src/core/tool.ts";

type Args = { name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string };

export default defineTool<Args>({
  name: "add_connection",
  description:
    "Save an app connection (MCP server) so every helper can use that app. Use it after a helper found the app's " +
    "official MCP server. Give a local server's command, args and env, or a remote server's url. Never put a key " +
    "in it: write env values as ${NAME} and tell the user to add NAME to their .env file.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short name, letters, digits, - or _ (\"linear\")." },
      command: { type: "string", description: "Local server: the program to run (\"npx\")." },
      args: { type: "array", items: { type: "string" }, description: "Local server: its arguments." },
      env: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Local server: environment, keys as ${NAME} (\"LINEAR_API_KEY\": \"${LINEAR_API_KEY}\").",
      },
      url: { type: "string", description: "Remote server: its address (\"https://mcp.linear.app/mcp\")." },
    },
    required: ["name"],
  },
  run({ name, command, args, env, url }, { connections }) {
    if (!connections) throw new Error("app connections are not available in this session");
    if (!command && !url) throw new Error("A connection needs a command or a url.");
    const server = url ? { url } : { command, ...(args?.length ? { args } : {}), ...(env && Object.keys(env).length ? { env } : {}) };
    connections.add(name, server);
    // Keys the user still has to put in .env.
    const wanted = [...JSON.stringify(server).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]!);
    return { saved: name, missingKeys: [...new Set(wanted)].filter((k) => !process.env[k]) };
  },
});
