// Real pictures for image cards (show_image): find a photo, or make one.
//
//   const images = createImages({ apiKey: () => geminiApiKey() });
//   const pic = await images.find("animal cell");        // Wikimedia Commons, no key
//   const art = await images.generate("a cartoon cell"); // a Gemini image model
//   pic.src   // "data:image/jpeg;base64,..." for the card's <img>
//
// Why data: URLs from the core: the window's CSP is `img-src 'self' data:`, so the
// core downloads the bytes and the window never fetches from the web.
// Every error is one short line the voice can say as it is.

/** A picture ready for an image card. */
export interface Picture {
  /** data: URL (png, jpeg or webp). */
  src: string;
  mime: string;
  /** Size of the image file. */
  bytes: number;
  /** Where it came from: author and license for a found photo. */
  credit: string;
  /** The file's own name (found photos), for the voice. */
  name?: string;
}

export interface Images {
  find(query: string): Promise<Picture>;
  generate(prompt: string): Promise<Picture>;
}

/** Image files bigger than this are refused. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Found photos come as Wikimedia thumbnails this wide. */
export const THUMB_WIDTH = 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp"];
/** Wikimedia asks every client for a User-Agent; a generic one, nothing about the user. */
export const USER_AGENT = "live-agent/1.0 (desktop voice assistant)";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

/**
 * The image model and its REST shape, from https://aistudio.google.com/docs/image-generation
 * (ai.google.dev/gemini-api/docs/image-generation redirects there) and the Interactions API
 * reference https://aistudio.google.com/api-reference/interactions-api (checked 2026-11-19):
 * POST v1beta/interactions, `model` + `input` text parts, image bytes back as
 * `steps[].content[]` blocks `{ type: "image", data, mime_type }`.
 */
export const IMAGE_MODEL = "gemini-nano-banana-2.1";
const INTERACTIONS = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

export function createImages({
  fetch: get = fetch,
  apiKey,
  model = IMAGE_MODEL,
}: { fetch?: typeof fetch; apiKey: () => string | undefined; model?: string }): Images {
  return {
    async find(query) {
      const url = new URL(COMMONS);
      Object.entries({
        action: "query", format: "json", formatversion: "2", generator: "search",
        gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "10",
        prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: String(THUMB_WIDTH),
        iiextmetadatafilter: "Artist|LicenseShortName",
      }).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await get(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!res?.ok) throw new Error("I couldn't reach Wikimedia right now.");
      const body: any = await res.json().catch(() => ({}));
      // Search order, but a file named with more of the asked words goes first
      // ("animal cell" should not pick "leaf cells" just because search ranked it higher).
      const asked = words(query);
      const score = (title: string) => asked.filter((w) => words(title).some((t) => t.startsWith(w))).length;
      const hit = [...(body?.query?.pages ?? [])]
        .map((p: any) => ({ title: String(p.title ?? ""), index: Number(p.index ?? 0), info: p.imageinfo?.[0] }))
        .filter(({ info }) => info?.thumburl && MIMES.includes(info.mime) && (info.width ?? 0) >= 300)
        .sort((a, b) => score(b.title) - score(a.title) || a.index - b.index)[0];
      if (!hit) throw new Error(`I couldn't find a photo of ${query}.`);
      const meta = hit.info.extmetadata ?? {};
      const artist = plain(meta.Artist?.value);
      const license = plain(meta.LicenseShortName?.value);
      const pic = await download(get, hit.info.thumburl);
      const credit = ["Wikimedia Commons", artist, license].filter(Boolean).join(" · ");
      return { ...pic, credit: credit.slice(0, 200), name: hit.title.replace(/^File:/, "").replace(/\.\w+$/, "") };
    },

    async generate(prompt) {
      const key = apiKey();
      if (!key) throw new Error("I need a Gemini key to make pictures. Add GEMINI_API_KEY to your .env file.");
      // The key goes in a header, so it never lands in a URL or a log.
      const res = await get(INTERACTIONS, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json", "Api-Revision": API_REVISION },
        body: JSON.stringify({ model, input: [{ type: "text", text: prompt }] }),
        signal: AbortSignal.timeout(90_000),
      }).catch(() => null);
      if (!res) throw new Error("I couldn't reach Google to make the picture.");
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error("The picture quota is used up. Try again later.");
      if (res.status === 401 || res.status === 403 || body?.error?.details?.some?.((d: any) => d?.reason === "API_KEY_INVALID"))
        throw new Error("Google refused the Gemini key for pictures.");
      if (!res.ok) throw new Error(`Making the picture failed (error ${res.status}).`);
      const block = (body?.steps ?? [])
        .flatMap((s: any) => s?.content ?? [])
        .find((c: any) => c?.type === "image" && typeof c.data === "string" && MIMES.includes(c.mime_type ?? "image/png"));
      // No picture back: the safety filter (or the model) said no.
      if (!block) throw new Error("Google wouldn't make that picture. Try asking for it another way.");
      const mime = block.mime_type ?? "image/png";
      const bytes = Math.floor((block.data.length * 3) / 4);
      if (bytes > MAX_IMAGE_BYTES) throw new Error("That picture is too big to show.");
      return { src: `data:${mime};base64,${block.data}`, mime, bytes, credit: "generated" };
    },
  };
}

async function download(get: typeof fetch, url: string): Promise<Omit<Picture, "credit">> {
  const res = await get(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new Error("I found a photo but couldn't download it.");
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!MIMES.includes(mime)) throw new Error("I found a photo but it isn't a kind of picture I can show.");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("That photo is too big to show.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("That photo is too big to show.");
  return { src: `data:${mime};base64,${buf.toString("base64")}`, mime, bytes: buf.length };
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Wikimedia metadata is HTML: just its words. */
function plain(html: unknown): string {
  return typeof html === "string" ? html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, 80) : "";
}
