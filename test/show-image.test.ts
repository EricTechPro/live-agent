// show_image: a real picture in an image card, through the agent core's event stream.
// The model calls show_image (find a photo on Wikimedia Commons, or generate one with a
// Gemini image model); a loading card opens at once, then the picture arrives as a
// data: URL in a canvas.edit. Fake HTTP only: no network here.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { bundledTools } from "../src/core/bundled-tools.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { createImages, IMAGE_MODEL, MAX_IMAGE_BYTES, USER_AGENT, type Images } from "../src/images.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

type Call = { url: string; init?: RequestInit };
/** A fake fetch: answers by URL, and keeps every request. */
function fakeFetch(route: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return route(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const page = (index: number, title: string, info: Record<string, unknown>) => ({
  index,
  title,
  imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/${index}.jpg`, mime: "image/jpeg", width: 2000, height: 1500, ...info }],
});
const commons = (pages: unknown[]) => (url: string) =>
  url.startsWith("https://commons.wikimedia.org/")
    ? json({ query: { pages } })
    : new Response(JPEG, { headers: { "content-type": "image/jpeg", "content-length": String(JPEG.length) } });

const imageCall = (args: Record<string, unknown>): ModelEvent => ({ type: "tool.call", id: "i1", name: "show_image", args });

async function oneCall(args: Record<string, unknown>, images?: Images) {
  const s = await startSession({ model: scriptedModel([[imageCall(args)], [{ type: "text", text: "There." }]]), tools, images, chatEndNote: false });
  const events = await s.sendText("Show me a picture");
  await s.close();
  return events;
}
const resultOf = (events: AgentEvent[]) => events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "i1")!;
const canvasEvents = (events: AgentEvent[]) => events.filter((e) => e.type.startsWith("canvas."));

test("show_image is a read tool, bundled, with a flat schema", () => {
  const tool = tools.find((t) => t.name === "show_image")!;
  expect(tool.risk).toBe("read");
  expect(bundledTools.some((t) => t.name === "show_image")).toBe(true);
  expect(JSON.stringify(tool.parameters)).not.toMatch(/anyOf|oneOf|allOf|"const"|\$ref/);
  expect(tool.parameters).toMatchObject({ required: ["mode", "query"] });
});

test("find: a loading card opens, then the Wikimedia photo arrives as a data: URL with its credit", async () => {
  const http = fakeFetch(
    commons([
      page(1, "File:Bryum leaf cells.jpg", {}),
      page(2, "File:Animal cell diagram.svg.png", { mime: "image/png", width: 100 }), // too small
      page(3, "File:Animal cell.jpg", { extmetadata: { Artist: { value: '<a href="x">Jane Doe</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" } } }),
    ]),
  );
  const events = await oneCall({ mode: "find", query: "animal cell", title: "Animal cell" }, createImages({ fetch: http.fetch, apiKey: () => undefined }));

  const [open, filled] = canvasEvents(events) as [EventOf<"canvas.beat">, EventOf<"canvas.edit">];
  expect(open.type).toBe("canvas.beat");
  expect(open.marks).toEqual([expect.objectContaining({ kind: "image", id: "p1", title: "Animal cell" })]);
  expect((open.marks[0] as { src?: string }).src).toBeUndefined();
  expect(filled.type).toBe("canvas.edit");
  expect(filled.mark).toMatchObject({
    kind: "image",
    id: "p1",
    src: `data:image/jpeg;base64,${b64(JPEG)}`,
    credit: "Wikimedia Commons · Jane Doe · CC BY-SA 4.0",
  });

  // The search asks for bitmaps at ~1024 px with a generic User-Agent; the photo
  // whose name has the asked words wins over search order.
  const search = new URL(http.calls[0]!.url);
  expect(search.searchParams.get("gsrsearch")).toBe("animal cell filetype:bitmap");
  expect(search.searchParams.get("iiurlwidth")).toBe("1024");
  expect(new Headers(http.calls[0]!.init?.headers).get("user-agent")).toBe(USER_AGENT);
  expect(http.calls[1]!.url).toBe("https://upload.wikimedia.org/thumb/3.jpg");

  // The model hears what was shown, never the bytes.
  const result = resultOf(events);
  expect(result.status).toBe("ok");
  expect(result.output).toMatchObject({ shown: true, id: "p1", credit: "Wikimedia Commons · Jane Doe · CC BY-SA 4.0" });
  expect(JSON.stringify(result.output)).not.toContain("base64");
});

test("find: nothing found is a short spoken error and the loading card goes", async () => {
  const http = fakeFetch(commons([]));
  const events = await oneCall({ mode: "find", query: "zzqx" }, createImages({ fetch: http.fetch, apiKey: () => undefined }));
  expect(resultOf(events)).toMatchObject({ status: "error", error: expect.stringContaining("couldn't find a photo of zzqx") });
  expect(canvasEvents(events).map((e) => e.type)).toEqual(["canvas.beat", "canvas.erase"]);
});

test("find: a photo over the size cap is refused", async () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  const http = fakeFetch((url) =>
    url.startsWith("https://commons") ? json({ query: { pages: [page(1, "File:Cell.jpg", {})] } }) : new Response(big, { headers: { "content-type": "image/jpeg" } }),
  );
  const events = await oneCall({ mode: "find", query: "cell" }, createImages({ fetch: http.fetch, apiKey: () => undefined }));
  expect(resultOf(events)).toMatchObject({ status: "error", error: expect.stringContaining("too big") });
});

test("generate: the Gemini image model's picture fills the card, captioned generated", async () => {
  const http = fakeFetch(() =>
    json({ id: "x", status: "completed", steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: "Here" }, { type: "image", data: b64(JPEG), mime_type: "image/jpeg" }] }] }),
  );
  const events = await oneCall({ mode: "generate", query: "a cartoon animal cell" }, createImages({ fetch: http.fetch, apiKey: () => "test-key" }));
  const filled = canvasEvents(events).find((e): e is EventOf<"canvas.edit"> => e.type === "canvas.edit")!;
  expect(filled.mark).toMatchObject({ kind: "image", src: `data:image/jpeg;base64,${b64(JPEG)}`, caption: "generated" });

  const { url, init } = http.calls[0]!;
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  expect(url).not.toContain("test-key"); // the key rides in a header
  expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
  expect(JSON.parse(String(init?.body))).toEqual({ model: IMAGE_MODEL, input: [{ type: "text", text: "a cartoon animal cell" }] });
  expect(resultOf(events)).toMatchObject({ status: "ok", output: { shown: true, caption: "generated" } });
});

test("generate: no key, quota and a safety block are each one short line", async () => {
  const cases: [Images, string][] = [
    [createImages({ fetch: fakeFetch(() => json({})).fetch, apiKey: () => undefined }), "need a Gemini key"],
    [createImages({ fetch: fakeFetch(() => json({ error: { code: 429 } }, 429)).fetch, apiKey: () => "k" }), "quota"],
    [createImages({ fetch: fakeFetch(() => json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "No." }] }] })).fetch, apiKey: () => "k" }), "wouldn't make that picture"],
  ];
  for (const [images, words] of cases) {
    const events = await oneCall({ mode: "generate", query: "x" }, images);
    expect(resultOf(events)).toMatchObject({ status: "error", error: expect.stringContaining(words) });
    expect(canvasEvents(events).at(-1)?.type).toBe("canvas.erase");
  }
});

test("a session with no pictures says so", async () => {
  const events = await oneCall({ mode: "find", query: "cat" });
  expect(resultOf(events)).toMatchObject({ status: "error", error: expect.stringContaining("Pictures") });
  expect(canvasEvents(events)).toEqual([]);
});

test("draw cannot make image cards: show_image does", async () => {
  const s = await startSession({
    model: scriptedModel([[{ type: "tool.call", id: "d1", name: "draw", args: { beats: [{ say: "Look.", marks: [{ kind: "image", id: "p1", src: "data:image/png;base64,AAAA" }] }] } }], [{ type: "text", text: "ok" }]]),
    tools,
    chatEndNote: false,
  });
  const events = await s.sendText("draw");
  await s.close();
  expect(events.find((e) => e.type === "tool.result")).toMatchObject({ status: "error", error: expect.stringContaining("show_image") });
});

test("the prompt sends real things to find, imaginary ones to generate, and diagrams only for structures", () => {
  const text = systemInstruction("short");
  expect(text).toContain("show_image");
  expect(text).toMatch(/photo or diagram\?/i);
  expect(text).toMatch(/mode find/);
  expect(text).toMatch(/mode generate/);
});
