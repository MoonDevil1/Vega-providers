// Rebuild marker: regenerate the published Desktop bundle from this source.

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
  Cineverse: 22000,
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

  // Collect all matching selectors; do not stop at the first active-server subset.
  for (let i = 0; i < selectors.length; i++) {
    try {
      const nodes = $(selectors[i]);
      if (!nodes || nodes.length === 0) continue;
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
    } catch {}
  }
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
  // initialServers may contain only the initially selected mirror. Merge it
  // with every server button in the rendered page and the raw HTML fallback.
  const list = [
    ...parseWatchConfigServers(html),
    ...parseServersCheerio(html, cheerio),
    ...parseServersRegex(html),
  ];
  const seen: Record<string, boolean> = {};
  const deduped: ServerEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s.url || seen[s.url]) continue;
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
  mediaType: MediaType,
  signal: AbortSignal,
  ctx: ProviderContext,
): Promise<Stream[]> {
  const out: Stream[] = [];
  const RAW = "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main";

  // The current VIDOUT resolver only has a confirmed movie lookup contract.
  // Do not treat a TV episode URL as a movie, and never scrape its generic
  // player page for a default/sample playlist.
  if (mediaType !== "movie") return out;

  const idMatch = url.match(/\/movie\/([^/?#]+)/i);
  if (!idMatch) return out;

  // VIDOUT's API is keyed by TMDB for reliable movie matching. An IMDb
  // tt-id is not interchangeable with a TMDB id; require an explicit TMDB
  // mapping instead of probing an IMDb id and potentially accepting a
  // unrelated fallback playlist.
  let tmdbId = "";
  try {
    const parsed = new URL(url);
    tmdbId = String(parsed.searchParams.get("tmdb") || parsed.searchParams.get("tmdb_id") || "").trim();
  } catch {}
  if (!tmdbId && /^\d+$/.test(idMatch[1])) tmdbId = idMatch[1];
  if (!/^\d+$/.test(tmdbId)) {
    console.warn("[stream] VIDOUT skipped: a numeric TMDB movie ID is required");
    return out;
  }

  // Only request title-specific endpoints. Generic /hls and / routes may
  // return a provider's default playlist rather than this requested title.
  const paths = ["/hls/movie/", "/movie/"];
  for (const path of paths) {
    const href = RAW + path + encodeURIComponent(tmdbId);
    try {
      const response = await ctx.axios.get(href, {
        headers: Object.assign({}, BASE_HEADERS, { Referer: "https://vidout.pages.dev/" }),
        signal,
      });
      const body = String(response.data || "").trim();
      let hlsUrl = "";
      if (/^https?:\/\//i.test(body)) {
        hlsUrl = body.split(/\s+/)[0];
      } else if (body.charAt(0) === "{") {
        try {
          const obj = JSON.parse(body);
          hlsUrl = String(obj.url || obj.hls || obj.link || "");
        } catch {}
      }
      if (hlsUrl && /^https?:\/\//i.test(hlsUrl) && /\.m3u8(?:[?#]|$)/i.test(hlsUrl)) {
        out.push({ server: "VIDOUT", link: hlsUrl, type: "m3u8" });
        break;
      }
    } catch {
      // Try the next title-specific endpoint only.
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
    // VIDOUT's generic embed scraper can pick up a default/sample playlist
    // unrelated to the requested title. Only return a stream when the
    // dedicated VIDOUT resolver confirms the requested movie ID.
    return resolveVidout(url, mediaType, signal, ctx);
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
  // Accept HLS, DASH and direct MP4 sources, including signed query strings.
  const mediaRe = /(?:https?:)?\/\/[^"'\\\s<>]+?\.(?:m3u8|mpd|mp4|m4v)(?:\?[^"'\\\s<>]*)?/gi;
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
/* User preference: prioritize the selected server while preserving all fallbacks. */
function serverPreferenceMatches(server: string, preference: string): boolean {
  if (!preference || preference === "auto") return false;
  const name = String(server || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = preference.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (wanted === "gdmirror") return name.includes("gdmirror") || name.includes("googledrive") || name === "gd";
  return name.includes(wanted);
}
function serverPriorityRank(server: string, preferredServer: string): number {
  if (serverPreferenceMatches(server, "gdmirror")) return 0;
  if (serverPreferenceMatches(server, "cineverse")) return 1;
  if (preferredServer && preferredServer !== "auto" &&
      preferredServer !== "gdmirror" && preferredServer !== "cineverse" &&
      serverPreferenceMatches(server, preferredServer)) return 2;
  return 3;
}

function orderPreferredStreams(streams: StreamEx[], preferredServer: string): StreamEx[] {
  return streams.map((stream, index) => ({ stream, index })).sort((a, b) =>
    serverPriorityRank(a.stream.server, preferredServer) -
    serverPriorityRank(b.stream.server, preferredServer) || a.index - b.index
  ).map((item) => item.stream);
}

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
/*  Public server discovery + selected-server resolution API            */
/*  New clients can list all advertised servers before resolving one.   */
/*  The legacy getStream() API remains available below for older apps.  */
/* ================================================================== */

export interface MultiMoviesServer {
  id: string;
  name: string;
  url: string;
  index: number;
  pageUrl: string;
}

export async function getServers({
  link,
  type,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<MultiMoviesServer[]> {
  const { axios, cheerio } = providerContext;
  let html = "";
  try {
    const referer = (() => { try { return new URL(link).origin + "/"; } catch { return REFERER; } })();
    const response = await axios.get(link, {
      headers: { ...BASE_HEADERS, ...(providerContext.commonHeaders || {}), Referer: referer },
      signal,
      timeout: 18000,
      maxRedirects: 5,
    });
    html = String(response.data || "");
  } catch (error: any) {
    console.warn("[stream] server discovery page load failed:", error?.message || error);
    return [];
  }

  let pageUrl = link;
  let servers = parseServers(html, cheerio);
  if (!servers.length) {
    const candidates: string[] = [];
    const addCandidate = (raw: string) => {
      try {
        const candidate = new URL(raw, link).toString();
        if (/\/watch\/(?:movie|tv|series)\//i.test(candidate) && !candidates.includes(candidate)) {
          candidates.push(candidate);
        }
      } catch {}
    };
    try {
      const $ = cheerio.load(html);
      $("[href], [data-href], [data-url], iframe[src]").each((_i: number, node: any) => {
        const el = $(node);
        addCandidate(String(el.attr("href") || el.attr("data-href") || el.attr("data-url") || el.attr("src") || "").trim());
      });
    } catch {}
    const rawPaths = html.match(/(?:https?:\\?\/\\?\/[^"'\\s<>]+)?\/watch\/(?:movie|tv|series)\/[^"'\\s<>]+/gi) || [];
    for (const raw of rawPaths) addCandidate(raw.replace(/\\\//g, "/"));
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
          servers = parsed;
          break;
        }
      } catch (error: any) {
        console.warn("[stream] watch page discovery failed:", error?.message || error);
      }
    }
  }

  return servers.map((server) => ({ ...server, pageUrl }));
}

export async function resolveServer({
  server,
  type,
  signal,
  providerContext,
}: {
  server: MultiMoviesServer;
  type: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Stream[]> {
  if (!server || !/^https?:\/\//i.test(server.url)) return [];
  const mediaType = detectMediaType(type, server.pageUrl || server.url, "");
  const budget = /streams\.iqsmartgames\.com\/embed\//i.test(server.url)
    ? TIMEOUTS.IQST
    : (CINEVERSE_RE.test(server.url) || /cineverse/i.test(server.name))
      ? TIMEOUTS.Cineverse
      : (/vidout/i.test(server.name) || VIDOUT_RE.test(server.url))
        ? TIMEOUTS.VIDOUT
        : (TIMEOUTS[server.name] || TIMEOUTS.default);

  try {
    const resolved = await raceWithAbort(
      (innerSignal) => {
        const direct = directMediaStream(server.url, server.name);
        return direct.length
          ? Promise.resolve(direct)
          : routeServer(server.url, mediaType, innerSignal, providerContext, server.pageUrl || REFERER);
      },
      budget,
      server.name,
    );
    return resolved.filter((item) =>
      !!item?.link && String(item.type || "").toLowerCase() !== "iframe" &&
      /^(m3u8|mpd|mp4)$/i.test(String(item.type || directMediaType(item.link) || "")),
    ).map((item) => ({
      ...item,
      server: server.name + " / " + (item.server || "stream"),
    }));
  } catch (error: any) {
    console.warn("[stream] selected server failed: " + server.name + ": " + (error?.message || error));
    return [];
  }
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

  let preferredServer = "gdmirror";
  try {
    preferredServer = String(await providerContext.kvStore.get("multi_preferredServer") || "gdmirror");
    // Upgrade the old default so existing installations also prefer GD Mirror.
    if (preferredServer === "auto") preferredServer = "gdmirror";
  } catch (error) {
    console.warn("[stream] preferences unavailable:", error);
  }
  if (preferredServer !== "auto") {
    servers = servers.slice().sort((a, b) =>
      serverPriorityRank(a.name, preferredServer) -
      serverPriorityRank(b.name, preferredServer) || a.index - b.index
    );
  }

  const mediaType = detectMediaType(type, pageUrl, html);
  console.log("[stream] media type=" + mediaType + "  starting parallel run");

  // 3) Resolve servers with bounded concurrency. Vega Desktop's provider
  // bridge has a small pending-operation budget; starting every resolver at
  // once creates one timeout plus several requests per server and can exhaust
  // that budget before otherwise healthy mirrors finish.
  const settled: Array<{ server: ServerEntry; streams: Stream[] }> = [];
  let nextServer = 0;
  const worker = async () => {
    while (nextServer < servers.length) {
      if (signal.aborted) return;
      const index = nextServer++;
      const server = servers[index];
      const budget = /streams\.iqsmartgames\.com\/embed\//i.test(server.url)
        ? TIMEOUTS.IQST
        : (CINEVERSE_RE.test(server.url) || /cineverse/i.test(server.name))
          ? TIMEOUTS.Cineverse
          : (TIMEOUTS[server.name] || TIMEOUTS.default);
      const startedAt = Date.now();
      try {
        const streams = await raceWithAbort(
          (innerSignal) => {
            const direct = directMediaStream(server.url, server.name);
            return direct.length > 0
              ? Promise.resolve(direct)
              : routeServer(server.url, mediaType, innerSignal, providerContext, pageUrl);
          },
          budget,
          server.name,
        );
        console.log("[stream] <- " + server.name + ": " + streams.length + " in " + (Date.now() - startedAt) + "ms");
        settled[index] = { server, streams };
      } catch (error: any) {
        console.warn("[stream] x " + server.name + " (" + (Date.now() - startedAt) + "ms): " + (error?.message || error));
        settled[index] = { server, streams: [] };
      }
    }
  };
  const SERVER_CONCURRENCY = 1;
  await Promise.all(
    Array.from({ length: Math.min(SERVER_CONCURRENCY, servers.length) }, () => worker()),
  );
  const completedServers = settled.filter(Boolean);

  // 4) Merge
  const streamLinks: StreamEx[] = [];
  for (let i = 0; i < completedServers.length; i++) {
    const { server, streams } = completedServers[i];
    if (streams.length === 0) continue;
    for (let j = 0; j < streams.length; j++) {
      const ex = streams[j] as StreamEx;
      // An iframe is an embed page, not media. Never pass it to Vega's
      // native player as though it were a playable stream.
      if (!ex.link || String(ex.type || "").toLowerCase() === "iframe") continue;
      const merged: StreamEx = {
        server: server.name + " / " + (ex.server || "stream"),
        link: ex.link,
        type: ex.type || directMediaType(ex.link) || "m3u8",
      };
      if (ex.headers) merged.headers = ex.headers;
      if (ex.quality) merged.quality = ex.quality;
      if (ex.subtitles) merged.subtitles = ex.subtitles;
      streamLinks.push(merged);
    }
  }

  console.log(
    "[stream] DONE " + streamLinks.length + " playable media stream(s) in " +
    (Date.now() - t0) + "ms",
  );

  // Return only resolved media. Unresolved embeds are deliberately omitted;
  // this keeps both Mobile and Desktop server lists free of non-playable URLs.
  if (streamLinks.length === 0) return [];
  return orderPreferredStreams(streamLinks, preferredServer) as Stream[];
}