// extractors/iqst.ts
import { Stream } from "../types";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */
const API     = "https://streams.iqsmartgames.com";
const PLAYER  = "https://pro.iqsmartgames.com";
const REFERER = "https://m1.multimovies.courses/";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const KNOWN_XVID_HOSTS: Record<string, boolean> = {
  "hanerix.com": true,
  "morencius.com": true,
  "vibuxer.com": true,
  "n1mwq.org": true,
};

/* ================================================================== */
/*  Base headers                                                       */
/* ================================================================== */
function buildHeaders(): Record<string, string> {
  return {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": UA,
    Referer: REFERER,
  };
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
function deEscape(s: string): string {
  return String(s)
    .replace(/\\\//g, "/")
    .replace(/\\u([0-9a-fA-F]{4})/g, function (_m, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
}

function b64urlDecode(s: string): string {
  const input = String(s || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  try {
    return atob(input + pad);
  } catch {
    return "";
  }
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

function absUrl(base: string, rel: string): string {
  try {
    return new URL(rel, base).toString();
  } catch {
    return "";
  }
}

/* ================================================================== */
/*  Parse response that may be string OR already-parsed object         */
/* ================================================================== */
function parseMaybeJson(input: any): any {
  if (input == null) return null;
  if (typeof input === "object") return input;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/* ================================================================== */
/*  Dean Edwards JS unpacker                                           */
/* ================================================================== */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function baseN(num: number, b: number): string {
  if (num === 0) return "0";
  let out = "";
  while (num > 0) {
    out = DIGITS[num % b] + out;
    num = Math.floor(num / b);
  }
  return out;
}

function unpackJs(source: string): string | null {
  const m = source.match(
    /\}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\s*\.split\('\|'\)/s,
  );
  if (!m) return null;

  let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const a = parseInt(m[2], 10);
  let c = parseInt(m[3], 10);
  const k = m[4].split("|");

  while (c-- > 0) {
    if (c < k.length && k[c]) {
      const token = baseN(c, a);
      p = p.replace(new RegExp("\\b" + token + "\\b", "g"), function () {
        return k[c];
      });
    }
  }
  return p;
}

/* ================================================================== */
/*  Stage 1+2 : embed page -> file slugs                               */
/* ================================================================== */
interface FileEntry {
  slug: string;
  name: string;
  size: string;
}

function extractFileList(root: any): any[] {
  if (!root) return [];
  // Try every possible envelope
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.result)) return root.result;
  if (Array.isArray(root.files)) return root.files;
  if (Array.isArray(root.filelist)) return root.filelist;
  if (Array.isArray(root.sources)) return root.sources;
  if (root.data && Array.isArray(root.data.files)) return root.data.files;
  if (root.result && Array.isArray(root.result.files)) return root.result.files;
  if (Array.isArray(root)) return root;
  return [];
}

async function fetchFiles(
  embedUrl: string,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  const res = await axios.get(embedUrl, { headers, signal, timeout: 7000 });
  const html: string = res.data;

  console.log("[iqst] embed bytes: " + html.length);
    if (/data-link\s*=\s*["']https?:\/\/pro\.iqsmartgames\.com\/evid\//i.test(html)) {
      console.log("[iqst] current evid server list detected; skip legacy file API");
      return [];
    }

  const varOf = function (name: string): string {
    const re = new RegExp(
      '(?:var|let|const)\\s+' + name + '\\s*=\\s*["\\\']([^"\\\']*)["\\\']',
    );
    const m = html.match(re);
    return m ? m[1] : "";
  };

  const finalId = varOf("FinalID");
  const idType  = varOf("idType");
  const key     = varOf("myKey");
  const season  = varOf("season");
  const epname  = varOf("epname");

  console.log(
    "[iqst] FinalID=" + (finalId || "(miss)") +
    " idType=" + (idType || "(miss)") +
    " key=" + (key ? "yes" : "(miss)"),
  );

  if (!finalId || !key) return [];

  // Build candidate API URLs — try each until one returns data
  const paths: string[] = [];
  if (season && epname) {
    paths.push(
      API + "/myseriesapi?" + idType + "=" + encodeURIComponent(finalId) +
        "&season=" + season + "&epname=" + encodeURIComponent(epname) + "&key=" + key,
      API + "/myseriesapi?id=" + encodeURIComponent(finalId) +
        "&season=" + season + "&epname=" + encodeURIComponent(epname) + "&key=" + key,
      API + "/myseriesapi?imdbid=" + encodeURIComponent(finalId) +
        "&season=" + season + "&epname=" + encodeURIComponent(epname) + "&key=" + key,
    );
  } else {
    paths.push(
      API + "/mymovieapi?" + idType + "=" + encodeURIComponent(finalId) + "&key=" + key,
      API + "/mymovieapi?id=" + encodeURIComponent(finalId) + "&key=" + key,
      API + "/mymovieapi?imdbid=" + encodeURIComponent(finalId) + "&key=" + key,
      API + "/mymovieapi?tmdbid=" + encodeURIComponent(finalId) + "&key=" + key,
      API + "/mymovieapi?type=imdbid&id=" + encodeURIComponent(finalId) + "&key=" + key,
    );
  }

  for (let pi = 0; pi < paths.length; pi++) {
    const apiPath = paths[pi];
    try {
      const apiRes = await axios.get(apiPath, {
        headers: Object.assign({}, headers, { Referer: API + "/" }),
        signal,
        timeout: 7000,
        // Force axios to return raw text so we control parsing
        transformResponse: [(data: any) => data],
      });

      // API may return string OR already-parsed object
      const parsed = parseMaybeJson(apiRes.data);
      if (!parsed) {
        console.log(
          "[iqst] " + apiPath + " -> unparseable (" +
          typeof apiRes.data + "): " +
          String(apiRes.data).slice(0, 200),
        );
        continue;
      }

      // Log the top-level keys so we can see the real shape
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        console.log("[iqst] response keys: " + Object.keys(parsed).join(","));
      }

      const list = extractFileList(parsed);
      if (list.length === 0) {
        console.log("[iqst] " + apiPath + " -> 0 files");
        continue;
      }

      console.log("[iqst] " + apiPath + " -> " + list.length + " file(s)");

      const out: FileEntry[] = [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        const slug = String(
          item.fileslug || item.slug || item.file_slug || item.id || "",
        ).trim();
        if (!slug) continue;
        out.push({
          slug,
          name: item.filename || item.name || item.title || "",
          size: item.fsize || item.size || "",
        });
      }
      if (out.length > 0) return out;
    } catch (e: any) {
      console.log("[iqst] " + apiPath + " failed: " + (e && e.message));
    }
  }

  return [];
}

/* ================================================================== */
/*  Stage 3 : slug -> mirrors                                          */
/* ================================================================== */
interface MirrorLink {
  siteUrl: string;
  friendlyName: string;
  code: string;
}

async function fetchMirrors(
  slug: string,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<MirrorLink[]> {
  const body = new URLSearchParams({
    sid: slug,
    UserFavSite: "",
    currentDomain: '["streams.iqsmartgames.com","pro.iqsmartgames.com"]',
  }).toString();

  const res = await axios.post(PLAYER + "/embedhelper2.php", body, {
    headers: Object.assign({}, headers, {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: PLAYER + "/",
    }),
    signal,
    timeout: 7000,
    transformResponse: [(data: any) => data],
  });

  const root = parseMaybeJson(res.data);
  if (!root || typeof root !== "object") {
    console.log("[iqst] mirrors: unparseable response");
    return [];
  }

  const sources = root.sources || {};
  let codes: Record<string, string> = {};

  // mresult can be: base64 string, JSON string, or already an object
  const mresult = root.mresult;
  if (mresult) {
    if (typeof mresult === "object") {
      codes = mresult;
    } else if (typeof mresult === "string") {
      // Try direct JSON first
      const direct = parseMaybeJson(mresult);
      if (direct && typeof direct === "object") {
        codes = direct;
      } else {
        // Fall back to base64 decode
        const decoded = b64urlDecode(mresult);
        const parsed = parseMaybeJson(decoded);
        if (parsed && typeof parsed === "object") codes = parsed;
      }
    }
  }

  const out: MirrorLink[] = [];
  const keys = Object.keys(codes);
  console.log("[iqst] mirrors: " + keys.length + " code(s)");

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const src = sources[k];
    if (!src) continue;
    const siteUrl = String(src.siteUrl || "").trim();
    const code = String(codes[k] || "").trim();
    if (!siteUrl || !code) continue;
    out.push({
      siteUrl: siteUrl,
      friendlyName: src.friendlyName || "",
      code: code,
    });
  }
  return out;
}

/* ================================================================== */
/*  Stage 4 : mirror page -> m3u8 links                                */
/* ================================================================== */
interface RawLink {
  url: string;
  headers: Record<string, string>;
}

function extractLinks(unpacked: string, base: string): string[] {
  const absolute: string[] = [];
  const relative: string[] = [];
  const seenA: Record<string, boolean> = {};
  const seenR: Record<string, boolean> = {};

  const kvRe = /"(?:hls\d|file|mp4)"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(unpacked)) !== null) {
    const u = deEscape(m[1]);
    if (!u) continue;
    if (/^https?:\/\//i.test(u)) {
      if (!seenA[u]) {
        seenA[u] = true;
        absolute.push(u);
      }
    } else {
      const full = absUrl(base + "/", u);
      if (full && !seenR[full]) {
        seenR[full] = true;
        relative.push(full);
      }
    }
  }

  const rawRe = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g;
  while ((m = rawRe.exec(unpacked)) !== null) {
    const u = deEscape(m[0]);
    if (!seenA[u]) {
      seenA[u] = true;
      absolute.push(u);
    }
  }

  return absolute.concat(relative);
}

async function resolveXvidStyle(
  pageUrl: string,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RawLink[]> {
  const u = new URL(pageUrl);
  const base = u.protocol + "//" + u.host;

  const res = await axios.get(pageUrl, {
    headers: Object.assign({}, headers, { Referer: PLAYER + "/" }),
    signal,
    timeout: 7000,
  });

  const unpacked = unpackJs(res.data) || "";
  if (!unpacked) return [];

  const links = extractLinks(unpacked, base);
  const out: RawLink[] = [];
  for (let i = 0; i < links.length; i++) {
    out.push({ url: links[i], headers: { Referer: base + "/" } });
  }
  return out;
}

async function resolveGeneric(
  pageUrl: string,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RawLink[]> {
  const res = await axios.get(pageUrl, { headers, signal, timeout: 7000 });
  const html: string = res.data;

  const seen: Record<string, boolean> = {};
  const out: RawLink[] = [];
  const re = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = deEscape(m[0]);
    if (!seen[u]) {
      seen[u] = true;
      out.push({ url: u, headers: {} });
    }
  }
  return out;
}

async function dispatchMirror(
  mirror: MirrorLink,
  axios: any,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RawLink[]> {
  const pageUrl = absUrl(mirror.siteUrl, mirror.code);
  if (!pageUrl) return [];
  const host = hostOf(pageUrl);
  if (KNOWN_XVID_HOSTS[host]) return resolveXvidStyle(pageUrl, axios, headers, signal);
  return resolveGeneric(pageUrl, axios, headers, signal);
}

/* ================================================================== */
/*  IQST EXTRACTOR                                                     */
/* ================================================================== */

function extractSubtitleTracks(html: string, pageUrl: string): NonNullable<Stream["subtitles"]> {
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
    out.push({ title: title || lang, language: lang, type, uri }); seen.add(uri);
  };
  let m: RegExpExecArray | null;
  const re = /<track\b([^>]+)>/gi;
  while ((m = re.exec(deEscape(html).replace(/&amp;/g, "&"))) !== null) {
    const attrs = m[1];
    add(attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "",
      attrs.match(/\blabel\s*=\s*["']([^"']+)["']/i)?.[1] || "",
      attrs.match(/\bsrclang\s*=\s*["']([^"']+)["']/i)?.[1] || "");
  }
  const decoded = deEscape(html).replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
  const urlRe = /["']([^"'\s<>]+?\.(?:vtt|srt|ttml|xml)(?:\?[^"'\s<>]*)?)["']/gi;
  while ((m = urlRe.exec(decoded)) !== null) {
    const context = decoded.slice(Math.max(0, m.index - 180), Math.min(decoded.length, m.index + 180));
    if (!/(subtitle|captions?|tracks?|srclang|label|texttrack)/i.test(context)) continue;
    const language = context.match(/(?:srclang|language|lang)\s*["']?\s*[:=]\s*["']?([a-z]{2,3}(?:-[a-z]{2})?)/i)?.[1] || "";
    const title = context.match(/(?:label|title)\s*["']?\s*[:=]\s*["']([^"']+)/i)?.[1] || "";
    add(m[1], title, language);
  }
  return out;
}

/* Resolve publicly exposed, non-DRM media URLs from newer embed pages. */
async function resolveEmbedMedia(
  pageUrl: string, axios: any, headers: Record<string, string>,
  signal?: AbortSignal, depth: number = 0, seen: Record<string, boolean> = {},
): Promise<Stream[]> {
  if (depth > 4 || seen[pageUrl]) return [];
  seen[pageUrl] = true;
  let html = "";
  try {
    const origin = new URL(pageUrl).origin;
    const response = await axios.get(pageUrl, {
      headers: Object.assign({}, headers, { Referer: origin + "/" }),
      signal, timeout: 5000, maxRedirects: 4,
    });
    html = typeof response.data === "string" ? response.data : JSON.stringify(response.data || "");
  } catch (e: any) {
    console.log("[iqst] embed fallback fetch failed: " + (e && e.message));
    return [];
  }

  const decoded = deEscape(html).replace(/&amp;/g, "&")
    .replace(/\\u0026/g, "&").replace(/\\u003d/g, "=");
  const subtitles = extractSubtitleTracks(html, pageUrl);
  const found: Stream[] = [];
  const mediaSeen: Record<string, boolean> = {};
  const addMedia = (raw: string, referer: string) => {
    const mediaUrl = deEscape(String(raw || "").trim()).replace(/\\/g, "");
    if (!/^https?:\/\//i.test(mediaUrl) || mediaSeen[mediaUrl]) return;
    if (!/\.(?:m3u8|mp4|m4v)(?:[?#]|$)/i.test(mediaUrl)) return;
    mediaSeen[mediaUrl] = true;
    found.push({
      server: "IQSmart " + host,
      link: mediaUrl,
      type: /\.(?:mp4|m4v)(?:[?#]|$)/i.test(mediaUrl) ? "mp4" : "m3u8",
      headers: { "User-Agent": headers["User-Agent"] || UA, Referer: referer },
      ...(subtitles.length ? { subtitles } : {}),
    });
  };

  // Some GD mirror pages are packed with Dean Edwards' JS rather than
  // exposing a literal HLS URL in the document.
  const host = hostOf(pageUrl);
  if (KNOWN_XVID_HOSTS[host]) {
    const unpacked = unpackJs(decoded) || "";
    if (unpacked) {
      const links = extractLinks(unpacked, new URL(pageUrl).origin);
      for (const link of links) addMedia(link, new URL(pageUrl).origin + "/");
      if (found.length) return found;
    }
  }

  const mediaRe = /https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4|m4v)(?:\?[^"'\s<>\\]*)?/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaRe.exec(decoded)) !== null) addMedia(match[0], new URL(pageUrl).origin + "/");
  if (found.length) return found;
  if (depth >= 4) return [];

  // Collect every relevant URL attribute independently. The live IQSmart
  // player uses anchors with both href="#" and data-link="/evid/...", so a
  // single alternation incorrectly captures only href and skips the evid page.
  const tagRe = /<(?:iframe|source|a|button|div|li)\\b[^>]*>/gi;
  const attrRe = /\\b(?:src|data-src|data-link|data-url|href)\\s*=\\s*(["'])(.*?)\\1/gi;
  const frames: string[] = [];
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(decoded)) !== null) {
    attrRe.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(tagMatch[0])) !== null) {
      try {
        const frameUrl = new URL(attrMatch[2].replace(/&amp;/g, "&"), pageUrl).toString();
        const normalized = new URL(frameUrl);
        normalized.hash = "";
        const current = new URL(pageUrl);
        current.hash = "";
        const frameHost = hostOf(frameUrl);
        if (/^https?:/i.test(frameUrl) && normalized.toString() !== current.toString() &&
            !seen[normalized.toString()] &&
            (KNOWN_XVID_HOSTS[frameHost] || /iqsmartgames|rpmhub|p2pplay|uns\\.bio|hanerix|morencius|vibuxer|n1mwq/i.test(frameHost) ||
             /\\/evid\\//i.test(frameUrl)) &&
            frames.indexOf(frameUrl) < 0) frames.push(frameUrl);
      } catch {}
    }
  }

  // Resolve nested mirrors together and retain every playable result. Returning
  // only the first mirror made GD Mirror lose its automatic inner-server
  // fallback even when another advertised mirror exposed a working playlist.
  const nestedResults = await Promise.all(
    frames.slice(0, 8).map((frameUrl) =>
      resolveEmbedMedia(frameUrl, axios, headers, signal, depth + 1, seen)
        .catch(() => [] as Stream[]),
    ),
  );
  const merged: Stream[] = [];
  const mergedSeen = new Set<string>();
  for (const nested of nestedResults) {
    for (const stream of nested) {
      if (!stream?.link || mergedSeen.has(stream.link)) continue;
      mergedSeen.add(stream.link);
      merged.push(stream);
    }
  }
  return merged;
}

export async function iqstExtractor(
  link: string,
  signal: AbortSignal,
  axios: any,
  _cheerio: any,
  _headers: Record<string, string>,
  _providerContext?: any,
): Promise<Stream[]> {
  const streamLinks: Stream[] = [];
  const t0 = Date.now();

  try {
    console.log("[iqst] -> " + link);

    const headers = Object.assign({}, buildHeaders(), _headers || {});

    /* 1. File slugs */
    const files = await fetchFiles(link, axios, headers, signal);
    if (files.length === 0) {
      console.log("[iqst] legacy file API unavailable; trying embed media extraction");
      const direct = await resolveEmbedMedia(link, axios, headers, signal);
      console.log("[iqst] embed fallback returned " + direct.length + " media URL(s)");
      return direct;
    }

    /* 2. Fetch mirrors for all files in parallel */
    const mirrorJobs = files.map(function (f) {
      return fetchMirrors(f.slug, axios, headers, signal).then(
        function (mirrors) {
          return { file: f, mirrors };
        },
        function (e: any) {
          console.warn("[iqst] mirrors " + f.slug + ": " + (e && e.message));
          return { file: f, mirrors: [] as MirrorLink[] };
        },
      );
    });

    const fileMirrors = await Promise.all(mirrorJobs);

    /* 3. Dispatch all mirrors in parallel */
    const linkJobs: Promise<RawLink[]>[] = [];
    const linkLabels: string[] = [];

    for (let i = 0; i < fileMirrors.length; i++) {
      const fm = fileMirrors[i];
      for (let j = 0; j < fm.mirrors.length; j++) {
        const mirror = fm.mirrors[j];
        linkLabels.push(mirror.friendlyName || "Mirror");
        linkJobs.push(
          dispatchMirror(mirror, axios, headers, signal).catch(function (e: any) {
            console.warn(
              "[iqst] mirror " + mirror.friendlyName + ": " + (e && e.message),
            );
            return [] as RawLink[];
          }),
        );
      }
    }

    const linkResults = await Promise.all(linkJobs);

    /* 4. Merge */
    for (let i = 0; i < linkResults.length; i++) {
      const links = linkResults[i];
      const label = linkLabels[i];
      for (let k = 0; k < links.length; k++) {
        const entry = links[k];
        const stream: Stream & { headers?: Record<string, string> } = {
          server: "iqst (" + label + ")",
          link: entry.url,
          type: "m3u8",
        };
        if (entry.headers && Object.keys(entry.headers).length > 0) {
          stream.headers = entry.headers;
        }
        streamLinks.push(stream);
      }
    }

    console.log(
      "[iqst] " + streamLinks.length + " streams in " + (Date.now() - t0) + "ms",
    );
    if (streamLinks.length === 0) {
      console.log("[iqst] legacy mirror API returned no playable links; trying current embedded server list");
      const fallback = await resolveEmbedMedia(link, axios, headers, signal);
      if (fallback.length) {
        console.log("[iqst] current embed fallback returned " + fallback.length + " playable link(s)");
        return fallback;
      }
    }
    return streamLinks;
  } catch (err: any) {
    console.error("[iqst] error: " + (err && err.message));
    return [];
  }
}

/* ================================================================== */
/*  Aliases                                                            */
/* ================================================================== */
export const getIqstStream = iqstExtractor;