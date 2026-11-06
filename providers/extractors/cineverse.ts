// extractors/cineverse.ts
import { Stream } from "../types";
import { iqstExtractor } from "./iqst";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */
const HUB = "https://rozgarlelo.modiplay.xyz";
const REFERER_HUB = "https://m1.multimovies.courses/";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

/* ================================================================== */
/*  Headers                                                            */
/* ================================================================== */
function buildHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
    "User-Agent": MOBILE_UA,
    Referer: HUB + "/",
  };
}

function buildPlaybackHeaders(): Record<string, string> {
  return {
    "User-Agent": MOBILE_UA,
    Accept: "*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
    Origin: HUB,
    Referer: HUB + "/",
  };
}

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */
type StreamOut = Stream & {
  headers?: Record<string, string>;
};

interface ServerItem {
  platform: string;
  name: string;
  code: string;
  url?: string;
}

/* ================================================================== */
/*  De-escape: \/ -> /, \\/ -> /, \uXXXX -> char, &amp; -> &           */
/* ================================================================== */
function deEscape(s: string): string {
  return String(s)
    .replace(/\\+u([0-9a-fA-F]{4})/g, function (_m, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/\\+\//g, "/")
    .replace(/&amp;/g, "&");
}

/* ================================================================== */
/*  Extract m3u8 from proxy page HTML                                  */
/*    var directSrc="https://CDN/master.m3u8?..."  -> use as-is        */
/*    var src="/stream_proxy.php?url=..."          -> HUB + path       */
/*    any absolute https://...master.m3u8          -> use as-is        */
/*    /hls/.../master.m3u8                         -> HUB + path       */
/* ================================================================== */
function extractM3u8(html: string, baseUrl: string = HUB + "/"): string | null {
  const decoded = deEscape(html).replace(/\\u0026/g, "&").replace(/\\u003d/g, "=");
  const candidates: string[] = [];
  const add = (raw: string) => {
    let value = String(raw || "").trim().replace(/&amp;/g, "&");
    if (!value) return;
    try { value = new URL(value, baseUrl).toString(); } catch { return; }
    if (!/^https?:\/\//i.test(value)) return;
    if (!/\.m3u8(?:[?#]|$)/i.test(value) && !/stream_proxy\.php\?[^"'<>]*url=/i.test(value)) return;
    if (/stream_proxy\.php/i.test(value) && !/[?&]seg=/.test(value)) value += "&seg=direct";
    if (!candidates.includes(value)) candidates.push(value);
  };
  // Prefer a real master playlist so Vega can enumerate all resolutions.
  const preferred = /["']([^"'\s<>]*master\.m3u8[^"'\s<>]*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = preferred.exec(decoded)) !== null) add(m[1]);
  // Prefer an actual playlist URL before the proxy relay. A relay may expose
  // only one rendition, while the master playlist lets mpv enumerate quality.
  const direct = /(?:var\s+directSrc\s*=\s*)?["'](https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*)["']/gi;
  while ((m = direct.exec(decoded)) !== null) add(m[1]);
  const bare = /https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*/gi;
  while ((m = bare.exec(decoded)) !== null) add(m[0]);
  const relay = /["']((?:\/|https?:\/\/)[^"'\s<>]*stream_proxy\.php\?url=[^"'\s<>]+)["']/gi;
  while ((m = relay.exec(decoded)) !== null) add(m[1]);
  const relative = /["'](\/hls\/[^"'\s]+master\.m3u8[^"'\s]*)["']/gi;
  while ((m = relative.exec(decoded)) !== null) add(m[1]);
  return candidates[0] || null;
}

function extractSubtitles(html: string, pageUrl: string): NonNullable<Stream["subtitles"]> {
  const decoded = deEscape(html).replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
  const out: NonNullable<Stream["subtitles"]> = [];
  const seen = new Set<string>();
  const add = (raw: string, title: string, language: string) => {
    let uri = String(raw || "").trim().replace(/\\\//g, "/");
    if (!uri || /^(data:|blob:|javascript:)/i.test(uri)) return;
    try { uri = new URL(uri, pageUrl).toString(); } catch { return; }
    if (!/^https?:\/\//i.test(uri) || seen.has(uri)) return;
    const ext = (uri.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    if (!["vtt", "srt", "ttml", "xml"].includes(ext)) return;
    const lang = language || "und";
    const type = ext === "srt" ? "application/x-subrip" : ext === "ttml" || ext === "xml" ? "application/ttml+xml" : "text/vtt";
    out.push({ title: title || lang, language: lang, type, uri });
    seen.add(uri);
  };
  let m: RegExpExecArray | null;
  const trackRe = /<track\b([^>]+)>/gi;
  while ((m = trackRe.exec(decoded)) !== null) {
    const attrs = m[1];
    add(attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "",
      attrs.match(/\blabel\s*=\s*["']([^"']+)["']/i)?.[1] || "",
      attrs.match(/\bsrclang\s*=\s*["']([^"']+)["']/i)?.[1] || "");
  }
  // Some players store captions in JSON/JS config instead of HTML <track> tags.
  const urlRe = /["']([^"'\s<>]+?\.(?:vtt|srt|ttml|xml)(?:\?[^"'\s<>]*)?)["']/gi;
  while ((m = urlRe.exec(decoded)) !== null) {
    const before = decoded.slice(Math.max(0, m.index - 180), m.index);
    const after = decoded.slice(m.index, Math.min(decoded.length, m.index + 180));
    const context = before + after;
    if (!/(subtitle|captions?|tracks?|srclang|label|texttrack)/i.test(context)) continue;
    const language = context.match(/(?:srclang|language|lang)\s*["']?\s*[:=]\s*["']?([a-z]{2,3}(?:-[a-z]{2})?)/i)?.[1] || "";
    const title = context.match(/(?:label|title)\s*["']?\s*[:=]\s*["']([^"']+)/i)?.[1] || "";
    add(m[1], title, language);
  }
  return out;
}

function parseServers(html: string): ServerItem[] {
  const out: ServerItem[] = [];
  const seen: Record<string, boolean> = {};

  const re = /switchServer\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const platform = m[2];
    if (!platform || seen[platform]) continue;
    seen[platform] = true;
    out.push({ platform: platform, name: m[3], code: m[4] });
  }
  return out;
}

/* ================================================================== */
/*  Fetch one proxy page and return the m3u8                           */
/* ================================================================== */
async function resolveProxyPage(
  server: ServerItem,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ url: string; subtitles?: NonNullable<Stream["subtitles"]> } | null> {
  const proxyUrl =
    HUB + "/proxy.php?p=" + encodeURIComponent(server.platform) +
    "&c=" + encodeURIComponent(server.code) +
    "&title=" + encodeURIComponent("") +
    "&site_ref=" + encodeURIComponent(REFERER_HUB) +
    "&noredirect=1";

  console.log("[cineverse] proxy " + server.platform + " (" + server.code + ")");

  let resp: any;
  try {
    resp = await axios.get(proxyUrl, {
      headers: headers,
      signal: signal,
      timeout: 6000,
      maxRedirects: 0,
      validateStatus: function () { return true; },
    });
  } catch (e: any) {
    console.warn("[cineverse] " + server.platform + " failed: " + (e && e.message));
    return null;
  }

  const html: string = typeof resp.data === "string" ? resp.data : String(resp.data || "");
  console.log("[cineverse] " + server.platform + " -> " + resp.status + " (" + html.length + ")");

  if (resp.status >= 300 && resp.status < 400) {
    const loc = (resp.headers && (resp.headers.location || resp.headers["Location"])) || "";
    if (loc && /\.m3u8/i.test(loc)) return { url: loc };
    return null;
  }

  const m3u8 = extractM3u8(html);
  if (!m3u8) {
    console.log("[cineverse] " + server.platform + " -> no m3u8");
    return null;
  }

  const subtitles = extractSubtitles(html, proxyUrl);
  console.log("[cineverse] " + server.platform + " -> " + m3u8 + " (subtitles=" + subtitles.length + ")");
  return { url: m3u8, ...(subtitles.length ? { subtitles } : {}) };
}

/* ================================================================== */
/*  CINEVERSE EXTRACTOR                                                */
/* ================================================================== */
function parseModernServers(html: string, cheerio: any): ServerItem[] {
  const out: ServerItem[] = [];
  const seen = new Set<string>();
  const add = (rawValue: string, platformValue: string, codeValue: string, nameValue: string) => {
    const raw = String(rawValue || "").replace(/&amp;/g, "&").trim();
    const platform = String(platformValue || "").trim();
    const code = String(codeValue || "").trim();
    const name = String(nameValue || platform || "Mirror").replace(/\s+/g, " ").trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(raw)) {
      if (raw.startsWith("/")) url = HUB + raw;
      else if (platform && code) url = HUB + "/proxy.php?p=" + encodeURIComponent(platform) + "&c=" + encodeURIComponent(code) + "&title=&site_ref=" + encodeURIComponent(REFERER_HUB) + "&noredirect=1";
      else return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ platform: platform || name.toLowerCase().replace(/\W+/g, ""), name, code: code || raw, url });
  };
  try {
    const $ = cheerio.load(html);
    $(".srv-item[data-url]").each((_i: number, node: any) => {
      const el = $(node);
      add(String(el.attr("data-url") || ""), String(el.attr("data-platform") || ""),
        String(el.attr("data-code") || ""), String(el.attr("data-pname") || el.text() || ""));
    });
  } catch {}
  // Nested HTML documents inside placeholder divs may be flattened by
  // lightweight HTML parsers. Read server attributes directly as a fallback.
  const tags = html.match(/<[^>]*\bclass\s*=\s*["'][^"']*\bsrv-item\b[^"']*["'][^>]*>/gi) || [];
  const getAttr = (tag: string, key: string) => {
    const match = tag.match(new RegExp("\\b" + key + "\\s*=\\s*(['\"])(.*?)\\1", "i"));
    return match ? match[2] : "";
  };
  for (const tag of tags) {
    add(getAttr(tag, "data-url"), getAttr(tag, "data-platform"),
      getAttr(tag, "data-code"), getAttr(tag, "data-pname"));
  }
  return out;
}
function extractDirectMedia(html: string, pageUrl: string): { url: string; type: string }[] {
  const decoded = deEscape(html).replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const out: { url: string; type: string }[] = []; const seen = new Set<string>();
  const add = (raw: string) => {
    let url = String(raw || "").trim().replace(/^['"]|['"]$/g, ""); if (!url || /^(blob:|data:|javascript:)/i.test(url)) return;
    try { url = new URL(url, pageUrl).toString(); } catch { return; }
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    const path = url.split(/[?#]/)[0].toLowerCase();
    const type = /\.m3u8$/.test(path) ? "m3u8" : /\.(mp4|m4v)$/.test(path) ? "mp4" : "";
    if (type) { seen.add(url); out.push({ url, type }); }
  };
  const patterns = [
    /(?:file|src|source|hls|streaming_url|m3u8_path|directSrc)\s*[:=]\s*["']([^"']+)["']/gi,
    /["'](https?:\/\/[^"'\s<>]+?\.(?:m3u8|mp4|m4v)(?:\?[^"'\s<>]*)?)["']/gi,
    /(?:https?:)?\/\/[^"'\s<>]+?\.(?:m3u8|mp4|m4v)(?:\?[^"'\s<>]*)?/gi,
  ];
  for (const re of patterns) { let m: RegExpExecArray | null; while ((m = re.exec(decoded)) !== null) add(m[1] || m[0]); }
  return out;
}
async function resolveModernMirror(server: ServerItem, axios: any, headers: Record<string, string>, signal?: AbortSignal, cheerio?: any, providerContext?: any): Promise<StreamOut[]> {
  const startUrl = server.url || "";
  if (!startUrl) return [];
  const visited = new Set<string>();
  const maxDepth = 4;

  async function inspect(pageUrl: string, parentUrl: string, depth: number): Promise<StreamOut[]> {
    if (depth > maxDepth || visited.has(pageUrl)) return [];
    visited.add(pageUrl);
    try {
      const response = await axios.get(pageUrl, {
        headers: { ...headers, Referer: parentUrl || HUB + "/" },
        signal,
        timeout: depth === 0 ? 6500 : 4500,
        maxRedirects: 4,
        validateStatus: (status: number) => status < 500,
      });
      const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data || {});
      const media = extractDirectMedia(body, pageUrl);
      // StreamHG/Bingr can expose a browser-only blob video while the actual
      // transport is a stream_proxy.php relay assembled in the page script.
      const proxyMedia = extractM3u8(body, pageUrl);
      if (proxyMedia && !media.some((item) => item.url === proxyMedia)) {
        media.push({ url: proxyMedia, type: "m3u8" });
      }
      if (media.length) {
        let origin = HUB;
        try { origin = new URL(pageUrl).origin; } catch {}
        const tracks = extractSubtitles(body, pageUrl);
        return media.map((item) => ({
          server: server.name,
          link: item.url,
          type: item.type,
          headers: { "User-Agent": MOBILE_UA, Referer: pageUrl, Origin: origin },
          ...(tracks.length ? { subtitles: tracks } : {}),
        }));
      }

      // Follow nested player frames and server links; the iframe URL itself is not the media URL.
      const candidates: string[] = [];
      const addCandidate = (value: string) => {
        let raw = String(value || "").replace(/&amp;/g, "&").replace(/\\\//g, "/").trim();
        if (!raw || /^(javascript:|mailto:|#|blob:|data:)/i.test(raw)) return;
        try { raw = new URL(raw, pageUrl).toString(); } catch { return; }
        if (!/^https?:\/\//i.test(raw) || visited.has(raw) || candidates.indexOf(raw) >= 0) return;
        candidates.push(raw);
      };
      // GD links can be embedded in inline JS/JSON rather than iframe tags.
      const gdRe = /https?:\\?\/\\?\/streams\.iqsmartgames\.com\\?\/embed\\?\/[^"'\\s<>\\]+/gi;
      let match: RegExpExecArray | null;
      while ((match = gdRe.exec(body)) !== null) addCandidate(match[0]);
      const re = /<(?:iframe|source|a|button|div)\b[^>]*?(?:\b(?:src|data-src|data-link|href|data-url)\s*=\s*["']([^"']+)["'])[^>]*>/gi;
      while ((match = re.exec(body)) !== null) addCandidate(match[1]);
      for (const candidate of candidates.slice(0, 8)) {
        // GD / IQSmart embeds require their dedicated API resolver; a generic iframe walk
        // only returns another embed URL and never reaches the actual HLS manifest.
        if (/streams\.iqsmartgames\.com\/embed\//i.test(candidate)) {
          try {
            const gdStreams = await iqstExtractor(candidate, signal as AbortSignal, axios, cheerio, {
              ...headers,
              Referer: pageUrl,
            }, providerContext);
            const playable = (gdStreams || []).filter((item: any) =>
              item && /^https?:\/\//i.test(String(item.link || "")) &&
              /\.(m3u8|mp4|m4v)(?:[?#]|$)/i.test(String(item.link || "")));
            if (playable.length) return playable.map((item: any) => ({
              ...item,
              server: server.name + " / GD mirror" + (item.server ? " / " + item.server : ""),
            }));
          } catch (error: any) {
            console.warn("[cineverse] GD mirror resolver failed: " + (error?.message || error));
          }
          continue;
        }
        const found = await inspect(candidate, pageUrl, depth + 1);
        if (found.length) return found;
      }
    } catch (error: any) {
      console.warn("[cineverse] mirror " + server.name + " depth " + depth + " failed: " + (error?.message || error));
    }
    return [];
  }

  const resolved = await inspect(startUrl, HUB + "/", 0);
  if (resolved.length) return resolved;
  return [{ server: server.name + " (embed)", link: startUrl, type: "iframe" }];
}

export async function cineverseExtractor(
  link: string,
  signal: AbortSignal,
  axios: any,
  _cheerio: any,
  _headers: Record<string, string>,
  _providerContext?: any,
): Promise<Stream[]> {
  const streamLinks: StreamOut[] = [];
  const t0 = Date.now();
  const headers = buildHeaders();

  console.log("[cineverse] -> " + link);

  // 1) Fetch embed page
  let html = "";
  try {
    const r = await axios.get(link, {
      headers: Object.assign({}, headers, { Referer: REFERER_HUB }),
      signal: signal,
      timeout: 6000,
      validateStatus: function () { return true; },
    });
    html = typeof r.data === "string" ? r.data : String(r.data || "");
    console.log("[cineverse] embed -> " + r.status + " (" + html.length + ")");
  } catch (e: any) {
    console.error("[cineverse] embed: " + (e && e.message));
    return streamLinks;
  }

  // Match the official Vega Multi flow first: switchServer -> proxy.php -> extractM3u8.
  // Modern .srv-item entries still carry platform/code on current pages; prefer the
  // hub's proxy resolver over returning the raw server embed URL.
  const subtitles = extractSubtitles(html, link);
  const legacyServers = parseServers(html);
  const modernServers = parseModernServers(html, _cheerio);
  const servers = legacyServers.length ? legacyServers : modernServers;
  // Only the legacy switchServer() markup uses proxy.php. Modern .srv-item entries
  // already expose the actual mirror URL in data-url; rebuilding those URLs as
  // proxy.php?p=...&c=... silently discards the supplied mirror and breaks playback.
  const useProxyFlow = legacyServers.length > 0;
  console.log("[cineverse] servers=" + servers.length + (legacyServers.length ? " (switchServer)" : modernServers.length ? " (modern via proxy)" : ""));
  let dropped = 0;
  if (!servers.length) {
    for (const item of extractDirectMedia(html, link)) streamLinks.push({ server: "Cineverse direct", link: item.url, type: item.type, headers: buildPlaybackHeaders() });
    return streamLinks;
  }
  if (useProxyFlow) {
    const results = await Promise.allSettled(servers.map((server) => resolveProxyPage(server, axios, headers, signal)));
    const seen = new Set<string>(); const playbackHeaders = buildPlaybackHeaders();
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== "fulfilled" || !result.value?.url || seen.has(result.value.url)) continue;
      seen.add(result.value.url);
      const mirrorSubtitles = result.value.subtitles?.length ? result.value.subtitles : subtitles;
      streamLinks.push({ server: "Cineverse " + servers[i].name, link: result.value.url, type: "m3u8", headers: playbackHeaders, ...(mirrorSubtitles.length ? { subtitles: mirrorSubtitles } : {}) });
    }
  } else {
    const results = await Promise.allSettled(servers.map((server) => resolveModernMirror(server, axios, headers, signal, _cheerio, _providerContext)));
    const seen = new Set<string>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) { if (!item.link || seen.has(item.link)) continue; seen.add(item.link); streamLinks.push(item); }
    }
  }

  if (dropped > 0) {
    console.log("[cineverse] dropped " + dropped + " duplicate link(s)");
  }

  console.log(
    "[cineverse] " + streamLinks.length + " streams in " + (Date.now() - t0) + "ms",
  );
  // Carry subtitle tracks found on the outer player page to resolved mirror streams.
  if (subtitles.length) {
    for (const item of streamLinks) {
      if (!item.subtitles || item.subtitles.length === 0) item.subtitles = subtitles;
    }
  }
  return streamLinks as Stream[];
}

/* ================================================================== */
/*  Aliases                                                            */
/* ================================================================== */
export const getCineverseStream = cineverseExtractor;