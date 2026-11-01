
import { Stream, ProviderContext } from "../types";
import { iqstExtractor } from "../extractors/iqst";
import { vidboltExtractor } from "../extractors/vidbolt";
import { cineverseExtractor } from "../extractors/cineverse";


const REFERER = "https://m1.multimovies.courses/";

const BASE_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: REFERER,
};

const CINEVERSE_RE = /rozgarlelo\.modiplay\.xyz\/embed\//i;
const IQST_RE      = /streams\.iqsmartgames\.com\/embed\//i;
const VIDBOLT_RE   = /vidbolt\.xyz\//i;
const VIDOUT_RE    = /vidout\.pages\.dev\//i;
const FILMU_RE     = /embed\.filmu\.in\//i;

/* Per-server timeouts (ms). Fast ones get short budgets. */
const TIMEOUTS: Record<string, number> = {
  Cineverse: 16000,
  IQST: 22000,
  "GD mirror": 22000,
  VIDOUT: 10000,
  Filmu: 12000,
  VidBolt: 12000,
  default: 12000,
};


type MediaType = "movie" | "tv";

type StreamEx = Stream & {
  headers?: Record<string, string>;
  quality?: string;
  subtitles?: any[];
};

interface ServerEntry {
  id: string;
  name: string;
  url: string;
  index: number;
}

/* ================================================================== */
/*  Real abort-on-timeout helper                                       */
/*  Wraps a promise + an outer signal. On timeout, aborts the inner    */
/*  controller so axios actually cancels the network request.          */
/* ================================================================== */
function raceWithAbort<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctrl = new AbortController();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ctrl.abort(); } catch {}
      reject(new Error(label + " timeout " + ms + "ms"));
    }, ms);

    run(ctrl.signal).then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/* ================================================================== */
/*  Server chip parsing (unchanged)                                    */
/* ================================================================== */
function parseServersCheerio(html: string, cheerio: any): ServerEntry[] {
  const out: ServerEntry[] = [];
  let $: any;
  try {
    $ = cheerio.load(html, { decodeEntities: false }, false);
  } catch (e: any) {
    console.warn("[stream] cheerio.load failed: " + (e && e.message));
    return out;
  }

  const selectors = [
    "button.server-chip[data-url]",
    "#playerServerGrid button[data-url]",
    ".server-grid button[data-url]",
    "[data-url][data-server-index]",
    "button[data-url]",
  ];

  let nodes: any = null;
  for (let i = 0; i < selectors.length; i++) {
    try {
      const found = $(selectors[i]);
      if (found && found.length > 0) { nodes = found; break; }
    } catch {}
  }
  if (!nodes) return out;

  nodes.each(function (this: any, _i: number, el: any) {
    try {
      const $el = $(el);
      const url = String($el.attr("data-url") || "").trim();
      if (!url) return;
      const id = String($el.attr("data-id") || "");
      const index = parseInt(String($el.attr("data-server-index") || "0"), 10) || 0;
      let name = "";
      try { name = String($el.find(".server-name").text() || "").trim(); } catch {}
      if (!name) name = id || "Server";
      out.push({ id, name, url, index });
    } catch {}
  });
  return out;
}

function parseServersRegex(html: string): ServerEntry[] {
  const out: ServerEntry[] = [];
  const re = /<button\b[^>]*\bdata-url\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const full = m[0];
    const url = String(m[1] || "").trim();
    const inner = m[2] || "";
    if (!url) continue;
    const idM = full.match(/\bdata-id\s*=\s*"([^"]*)"/i);
    const idxM = full.match(/\bdata-server-index\s*=\s*"([^"]*)"/i);
    const nameM = inner.match(/class\s*=\s*"server-name"[^>]*>([^<]*)</i);
    const id = idM ? idM[1] : "";
    let name = nameM ? String(nameM[1]).trim() : "";
    if (!name) name = id || "Server";
    out.push({
      id,
      name,
      url,
      index: idxM ? parseInt(idxM[1], 10) || 0 : 0,
    });
  }
  return out;
}

function extractAssignedObject(html: string, variable: string): any {
  const startMatch = new RegExp("(?:const|let|var)\\s+" + variable + "\\s*=\\s*", "m").exec(html);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  const open = html.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0, quote = "", escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(open, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function parseWatchConfigServers(html: string): ServerEntry[] {
  const config = extractAssignedObject(html, "watchConfig");
  const raw = Array.isArray(config?.initialServers) ? config.initialServers : [];
  return raw.map((item: any, index: number) => ({
    id: String(item?.id ?? index),
    name: String(item?.name || item?.server || item?.id || "Server").trim(),
    url: String(item?.url || item?.link || "").trim(),
    index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
  })).filter((item: ServerEntry) => /^https?:\/\//i.test(item.url))
    .filter((item: ServerEntry, index: number, all: ServerEntry[]) =>
      all.findIndex((other) => other.url === item.url) === index);
}

function parseServers(html: string, cheerio: any): ServerEntry[] {
  const configured = parseWatchConfigServers(html);
  if (configured.length) return configured;
  let list = parseServersCheerio(html, cheerio);
  if (list.length === 0) list = parseServersRegex(html);

  const seen: Record<string, boolean> = {};
  const deduped: ServerEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (seen[s.url]) continue;
    seen[s.url] = true;
    deduped.push(s);
  }
  deduped.sort((a, b) => a.index - b.index);
  return deduped;
}

/* ================================================================== */
/*  Inline resolvers (VIDOUT, Filmu)                                   */
/* ================================================================== */

/* VIDOUT: try both IMDB (tt…) and TMDB numeric. Try /movie/ and /hls/movie/. */
async function resolveVidout(
  url: string,
  _mediaType: MediaType,
  signal: AbortSignal,
  ctx: ProviderContext,
): Promise<Stream[]> {
  const out: Stream[] = [];
  const RAW = "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main";

  // mediaId as it appears in the URL: tt3495030 / 1269325
  const idMatch = url.match(/\/movie\/([^/?#]+)/);
  if (!idMatch) return out;
  const primaryId = idMatch[1];

  // Candidate id set: primary, and any ?tmdb= query override
  const candidates: string[] = [primaryId];
  try {
    const u = new URL(url);
    const t = u.searchParams.get("tmdb");
    if (t && candidates.indexOf(t) < 0) candidates.push(t);
  } catch {}

  const paths = [
    "/hls/movie/",
    "/movie/",
    "/hls/",
    "/",
  ];

  outer:
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    for (let j = 0; j < paths.length; j++) {
      const href = RAW + paths[j] + id;
      try {
        const r = await ctx.axios.get(href, {
          headers: Object.assign({}, BASE_HEADERS, {
            Referer: "https://vidout.pages.dev/",
          }),
          signal,
        });
        const body = String(r.data || "").trim();
        // Expect raw text: either a URL, or a JSON object with a url field
        let hlsUrl = "";
        if (body.indexOf("http") === 0) {
          hlsUrl = body.split(/\s+/)[0];
        } else if (body.charAt(0) === "{") {
          try {
            const obj = JSON.parse(body);
            hlsUrl = String(obj.url || obj.hls || obj.link || "");
          } catch {}
        }
        if (hlsUrl && hlsUrl.indexOf("http") === 0) {
          out.push({ server: "VIDOUT", link: hlsUrl, type: "m3u8" });
          break outer;
        }
      } catch {
        // try next path/id
      }
    }
  }
  return out;
}

async function resolveFilmu(
  url: string,
  mediaType: MediaType,
  signal: AbortSignal,
  ctx: ProviderContext,
): Promise<Stream[]> {
  const out: Stream[] = [];
  const HOST = "https://embed.filmu.in";

  const idMatch = url.match(/\/(?:movie|tv)\/(\d+)/);
  if (!idMatch) return out;
  const tmdbId = idMatch[1];

  const apiPath =
    mediaType === "tv"
      ? HOST + "/api/singularity-tv?tmdb=" + tmdbId
      : HOST + "/api/singularity-movie?id=" + tmdbId;

  try {
    const r = await ctx.axios.get(apiPath, {
      headers: Object.assign({}, BASE_HEADERS, {
        Referer: HOST + "/" + mediaType + "/" + tmdbId,
      }),
      signal,
    });
    const root = r.data || {};
    const base = root._base || "";
    const sources = Array.isArray(root.sources) ? root.sources : [];

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i] || {};
      let u = String(src.url || "");
      if (!u) continue;
      if (u.indexOf("http") !== 0 && base) {
        try { u = new URL(u, base).toString(); } catch {}
      }
      if (u.indexOf("http") !== 0) continue;
      out.push({
        server: "Filmu " + (src.quality || "1080p"),
        link: u,
        type: "m3u8",
      });
    }

    if (out.length === 0) {
      let single = String(root.url || "");
      if (!single && root.multilingual) single = String(root.multilingual_url || "");
      if (single.indexOf("http") === 0) {
        out.push({
          server: "Filmu " + (root.quality || "1080p"),
          link: single,
          type: "m3u8",
        });
      } else if (root.m3u8_path && base) {
        try {
          out.push({
            server: "Filmu " + (root.quality || "1080p"),
            link: new URL(root.m3u8_path, base).toString(),
            type: "m3u8",
          });
        } catch {}
      }
    }
  } catch (e: any) {
    console.warn("[stream] filmu: " + (e && e.message));
  }
  return out;
}

/* ================================================================== */
/*  Route dispatcher — passes inner signal so timeout actually cancels */
/* ================================================================== */
/* Direct media URLs need no embed resolver. Keep this generic and only
 * classify explicit media-file URLs; unknown embed pages remain fallbacks. */
function directMediaType(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const path = parsed.pathname.toLowerCase();
    if (/\.m3u8$/.test(path)) return "m3u8";
    if (/\.mpd$/.test(path)) return "mpd";
    if (/\.(mp4|m4v)$/.test(path)) return "mp4";
  } catch {}
  return null;
}

function directMediaStream(url: string, server: string): Stream[] {
  const mediaType = directMediaType(url);
  return mediaType ? [{ server, link: url, type: mediaType }] : [];
}

async function routeServer(
  url: string,
  mediaType: MediaType,
  signal: AbortSignal,
  ctx: ProviderContext,
  parentPageUrl: string,
): Promise<Stream[]> {
  let parentReferer = BASE_HEADERS.Referer;
  try { parentReferer = new URL(parentPageUrl).origin + "/"; } catch {}
  const h = { ...BASE_HEADERS, Referer: parentReferer };

  if (CINEVERSE_RE.test(url)) {
    return cineverseExtractor(url, signal, ctx.axios, ctx.cheerio, h, ctx);
  }
  if (IQST_RE.test(url)) {
    return iqstExtractor(url, signal, ctx.axios, ctx.cheerio, h, ctx);
  }
  if (VIDBOLT_RE.test(url)) {
    return vidboltExtractor(url, signal, ctx.axios, ctx.cheerio, h, ctx);
  }
  if (VIDOUT_RE.test(url)) {
    const resolved = await resolveVidout(url, mediaType, signal, ctx);
    return resolved.length ? resolved : resolvePublicEmbed(url, signal, ctx);
  }
  if (FILMU_RE.test(url)) {
    return resolveFilmu(url, mediaType, signal, ctx);
  }
  return resolvePublicEmbed(url, signal, ctx);
}

/* ================================================================== */
/* Resolve plain, non-DRM media URLs exposed in embed HTML or nested iframes.
 * Fallback for new MultiMovies hosts; this does not decrypt DRM. */
async function resolvePublicEmbed(
  url: string, signal: AbortSignal, ctx: ProviderContext,
  depth: number = 0, seen: Set<string> = new Set<string>(),
): Promise<Stream[]> {
  if (depth > 3 || seen.has(url)) return [];
  seen.add(url);
  const direct = directMediaStream(url, "Direct media");
  if (direct.length) return direct;
  let html = "";
  try {
    const origin = new URL(url).origin;
    const r = await ctx.axios.get(url, {
      headers: { ...BASE_HEADERS, Referer: origin + "/" },
      signal, timeout: 10000, maxRedirects: 4,
    });
    html = typeof r.data === "string" ? r.data : JSON.stringify(r.data || "");
  } catch { return []; }

  const decoded = html.replace(/\\u0026/g, "&").replace(/\\u003d/g, "=")
    .replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const candidates: string[] = [];
  const mediaRe = /(?:https?:)?\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|m4v)(?:\?[^"'\\\s<>]*)?/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaRe.exec(decoded)) !== null) {
    let candidate = match[0];
    if (candidate.startsWith("//")) candidate = "https:" + candidate;
    if (/^https?:\/\//i.test(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    const media = directMediaStream(candidate, "Resolved media");
    if (media.length) return media;
  }
  if (depth < 3) {
    const iframeRe = /<(?:iframe|source|a|button|div|li)\b[^>]*\b(?:src|data-src|data-link|data-url|data-href|href)\s*=\s*["']([^"']+)["']/gi;
    const nested: string[] = [];
    while ((match = iframeRe.exec(html)) !== null) {
      try {
        const candidate = new URL(match[1].replace(/&amp;/g, "&"), url).toString();
        if (/^https?:/i.test(candidate) && !seen.has(candidate) && !nested.includes(candidate)) nested.push(candidate);
      } catch {}
    }
    for (const candidate of nested.slice(0, 4)) {
      const resolved = await resolvePublicEmbed(candidate, signal, ctx, depth + 1, seen);
      if (resolved.length) return resolved;
    }
  }
  return [];
}

/*  Media type detection                                               */
/* ================================================================== */
function detectMediaType(type: string, link: string, html: string): MediaType {
  const t = (type || "").toLowerCase();
  if (t.indexOf("tv") >= 0 || t.indexOf("series") >= 0 || t.indexOf("show") >= 0)
    return "tv";
  if (t.indexOf("movie") >= 0 || t.indexOf("film") >= 0) return "movie";
  if (/\/tv\//i.test(link) || /\/series\//i.test(link)) return "tv";
  if (/\/movie\//i.test(link) || /\/film\//i.test(link)) return "movie";
  if (/\/tv\//i.test(html)) return "tv";
  return "movie";
}

/* ================================================================== */
/*  MAIN — parallel resolution                                         */
/* ================================================================== */
export async function getStream({
  link,
  type,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Stream[]> {
  const axios = providerContext.axios;
  const cheerio = providerContext.cheerio;
  const t0 = Date.now();
  // Direct media URLs should go straight to Vega's existing player.
  const inputMedia = directMediaStream(link, "Direct media");
  if (inputMedia.length > 0) return inputMedia;

  // 1) Load page
  let html = "";
  try {
    let pageReferer = REFERER;
  try { pageReferer = new URL(link).origin + "/"; } catch {}
  const requestHeaders = {
    ...BASE_HEADERS,
    ...(providerContext.commonHeaders || {}),
    Referer: pageReferer,
  };
  const res = await axios.get(link, {
    headers: requestHeaders,
    signal,
    timeout: 18000,
    maxRedirects: 5,
  });
    html = res.data;
  } catch (e: any) {
    console.error("[stream] page load failed: " + (e && e.message));
    return [];
  }

  // 2) Parse the server configuration. Some title pages only link to a
  // dedicated /watch/movie/<id> or /watch/tv/<id> page where watchConfig lives.
  let pageUrl = link;
  let servers = parseServers(html, cheerio);
  if (servers.length === 0) {
    const candidates: string[] = [];
    try {
      const $ = cheerio.load(html);
      $("[href], [data-href], [data-url], iframe[src]").each((_i: number, node: any) => {
        const el = $(node);
        const raw = String(el.attr("href") || el.attr("data-href") || el.attr("data-url") || el.attr("src") || "").trim();
        if (!raw) return;
        try {
          const absolute = new URL(raw, link).toString();
          if (/\/watch\/(?:movie|tv|series)\//i.test(absolute) && !candidates.includes(absolute)) candidates.push(absolute);
        } catch {}
      });
    } catch {}
    const rawWatchPaths = html.match(/(?:https?:\\?\/\\?\/[^"'\\s<>]+)?\/watch\/(?:movie|tv|series)\/[^"'\\s<>]+/gi) || [];
    for (const raw of rawWatchPaths) {
      try {
        const candidate = new URL(raw.replace(/\\\//g, "/"), link).toString();
        if (!candidates.includes(candidate)) candidates.push(candidate);
      } catch {}
    }
    for (const candidate of candidates.slice(0, 3)) {
      try {
        const response = await axios.get(candidate, {
          headers: { ...BASE_HEADERS, Referer: link },
          signal,
          timeout: 10000,
          maxRedirects: 4,
        });
        const candidateHtml = String(response.data || "");
        const parsed = parseServers(candidateHtml, cheerio);
        if (parsed.length) {
          pageUrl = candidate;
          html = candidateHtml;
          servers = parsed;
          break;
        }
      } catch (error: any) {
        console.warn("[stream] watch page lookup failed:", error?.message || error);
      }
    }
  }
  console.log("[stream] " + servers.length + " server(s) parsed");

  if (servers.length === 0) return [];

  const mediaType = detectMediaType(type, pageUrl, html);
  console.log("[stream] media type=" + mediaType + "  starting parallel run");

  // 3) Fire ALL servers in parallel with per-server timeouts
  const jobs = servers.map((server) => {
    const budget = /streams\.iqsmartgames\.com\/embed\//i.test(server.url)
      ? TIMEOUTS.IQST
      : (TIMEOUTS[server.name] || TIMEOUTS.default);
    const t = Date.now();

    return raceWithAbort(
      (innerSignal) => {
        const direct = directMediaStream(server.url, server.name);
        return direct.length > 0
          ? Promise.resolve(direct)
          : routeServer(server.url, mediaType, innerSignal, providerContext, pageUrl);
      },
      budget,
      server.name,
    ).then(
      (streams) => {
        const dt = Date.now() - t;
        console.log("[stream] <- " + server.name + ": " + streams.length + " in " + dt + "ms");
        return { server, streams };
      },
      (e: any) => {
        const dt = Date.now() - t;
        console.warn("[stream] x " + server.name + " (" + dt + "ms): " + (e && e.message));
        return { server, streams: [] as Stream[] };
      },
    );
  });

  // Do not make a fast mirror wait for every slow mirror. Collect results as
  // they finish and cap this lookup; unresolved slow servers can be tried on
  // the next play attempt instead of blocking all playback.
  const completed: Array<{ server: ServerEntry; streams: Stream[] }> = [];
  let completedCount = 0;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const trackedJobs = jobs.map((job) => job.then((result) => {
    completed.push(result);
    completedCount++;
    return result;
  }));
  await Promise.race([
    Promise.all(trackedJobs),
    new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, 24000);
    }),
  ]);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  const settled = completed;
  if (completedCount < jobs.length) {
    console.warn("[stream] returning partial results after 24000ms (" + completedCount + "/" + jobs.length + " servers finished)");
  }

  // 4) Merge
  const streamLinks: StreamEx[] = [];
  const fallbacks: Stream[] = [];
  for (let i = 0; i < settled.length; i++) {
    const { server, streams } = settled[i];
    if (streams.length === 0) {
      if (/rozgarlelo\.modiplay\.xyz\/embed\//i.test(server.url) || /streams\.iqsmartgames\.com\/embed\//i.test(server.url)) continue;
      fallbacks.push({
        server: server.name + " (embed)",
        link: server.url,
        type: "iframe",
      });
      continue;
    }
    for (let j = 0; j < streams.length; j++) {
      const ex = streams[j] as StreamEx;
      const merged: StreamEx = {
        server: server.name + " / " + (ex.server || "stream"),
        link: ex.link,
        type: ex.type || "m3u8",
      };
      if (ex.headers) merged.headers = ex.headers;
      if (ex.quality) merged.quality = ex.quality;
      if (ex.subtitles) merged.subtitles = ex.subtitles;
      streamLinks.push(merged);
    }
  }

  console.log(
    "[stream] DONE " + streamLinks.length + " real + " +
    fallbacks.length + " iframe in " + (Date.now() - t0) + "ms",
  );

  if (streamLinks.length === 0 && fallbacks.length > 0) return fallbacks;
  return streamLinks as Stream[];
}