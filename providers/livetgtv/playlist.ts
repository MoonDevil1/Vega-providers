import { ProviderContext } from "../types";

export const PLAYLIST_URL = "https://livetgtv.lovable.app/api/public/playlist.m3u";

export interface LiveChannel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  type: "m3u8" | "mpd" | "mp4";
  headers: Record<string, string>;
  description: string;
  requiresDrm: boolean;
  requiresAuthorization: boolean;
}

export interface LivePlaylist {
  channels: LiveChannel[];
  epgUrl: string;
}

function attribute(line: string, key: string): string {
  const match = line.match(new RegExp("(?:^|\\s)" + key + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s,]+))", "i"));
  return match ? String(match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
}

function mediaType(rawUrl: string): LiveChannel["type"] | null {
  try {
    const parsed = new URL(rawUrl);
    // LiveTGTV wraps the actual HLS URL in ?url=...&liveid=...&embed=1.
    // Inspect both the outer URL and its nested source, including URL-encoded sources.
    const candidates = [rawUrl, parsed.searchParams.get("url") || ""];
    for (const candidate of candidates) {
      const value = candidate.toLowerCase();
      if (/\.m3u8(?:$|[?#&])/.test(value) || /[?&](?:type|format)=m3u8(?:&|$)/.test(value)) return "m3u8";
      if (/\.mpd(?:$|[?#&])/.test(value) || /[?&](?:type|format)=mpd(?:&|$)/.test(value)) return "mpd";
      if (/\.(mp4|m4v)(?:$|[?#&])/.test(value)) return "mp4";
    }
  } catch {}
  return null;
}

function channelIdentity(rawUrl: string, tvgId: string, name: string): string {
  try {
    const liveId = new URL(rawUrl).searchParams.get("liveid");
    if (liveId) return "liveid:" + liveId;
  } catch {}
  return tvgId ? "tvg:" + tvgId : "name:" + name;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const rawKey = name.trim();
  const key = ({ "user-agent": "User-Agent", referer: "Referer", referrer: "Referer", origin: "Origin", cookie: "Cookie", authorization: "Authorization" } as Record<string, string>)[rawKey.toLowerCase()] || rawKey;
  const content = value.trim();
  if (!key || !content || key.includes("\r") || key.includes("\n") || content.includes("\r") || content.includes("\n")) return;
  const existing = Object.keys(headers).find((item) => item.toLowerCase() === key.toLowerCase());
  headers[existing || key] = content;
}

function parseHeaderPayload(raw: string, headers: Record<string, string>): void {
  const value = raw.trim();
  if (!value) return;
  try {
    const parsed = JSON.parse(value);
    const source = parsed && typeof parsed === "object" && parsed.headers && typeof parsed.headers === "object" ? parsed.headers : parsed;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key, item] of Object.entries(source)) {
        if (typeof item === "string" || typeof item === "number") setHeader(headers, key, String(item));
      }
      return;
    }
  } catch {}
  for (const pair of value.split(/[&;]/)) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    try {
      setHeader(headers, decodeURIComponent(pair.slice(0, index).trim()), decodeURIComponent(pair.slice(index + 1).trim()));
    } catch {}
  }
}

function parseEntryHeaders(extras: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of extras) {
    if (/^#EXTHTTP:/i.test(line)) {
      parseHeaderPayload(line.slice(line.indexOf(":") + 1), headers);
    } else if (/^#KODIPROP:inputstream\.adaptive\.stream_headers=/i.test(line)) {
      parseHeaderPayload(line.slice(line.indexOf("=") + 1), headers);
    } else if (/^#EXTVLCOPT:http-(?:user-agent|referrer|origin|cookie|authorization)=/i.test(line)) {
      const index = line.indexOf("=");
      const option = line.slice(0, index).toLowerCase();
      const name = option.endsWith("user-agent") ? "User-Agent" : option.endsWith("referrer") ? "Referer" : option.endsWith("origin") ? "Origin" : option.endsWith("cookie") ? "Cookie" : "Authorization";
      setHeader(headers, name, line.slice(index + 1));
    }
  }
  return headers;
}

export function parsePlaylistDocument(source: string): LivePlaylist {
  const channels: LiveChannel[] = [];
  let current: { info: string; extras: string[]; url?: string } | null = null;
  const normalized = String(source || "").replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  const header = lines.find((line) => /^#EXTM3U\b/i.test(line.trim())) || "";
  const epgUrl = attribute(header, "url-tvg") || attribute(header, "x-tvg-url");

  const finish = () => {
    if (!current || !current.url) {
      current = null;
      return;
    }
    const type = mediaType(current.url);
    if (!type) {
      current = null;
      return;
    }
    const comma = current.info.indexOf(",");
    const displayTitle = comma >= 0 ? current.info.slice(comma + 1).trim() : "";
    const name = attribute(current.info, "tvg-name") || displayTitle;
    if (!name) {
      current = null;
      return;
    }

    const headers = parseEntryHeaders(current.extras);
    const tvgId = attribute(current.info, "tvg-id");
    const group = attribute(current.info, "group-title") || "Other";
    const logo = attribute(current.info, "tvg-logo");
    const id = channelIdentity(current.url, tvgId, name);
    const requiresDrm = current.extras.some((line) => /^#KODIPROP:.*(?:license_(?:type|key)|drm)/i.test(line));
    const requiresAuthorization = current.extras.some((line) => /cookie|authorization/i.test(line)) ||
      Object.keys(headers).some((key) => /^(cookie|authorization)$/i.test(key));

    channels.push({ id, name, logo, group, url: current.url, type, headers, description: name, requiresDrm, requiresAuthorization });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      finish();
      current = { info: line, extras: [] };
    } else if (current && line.startsWith("#")) {
      current.extras.push(line);
    } else if (current && /^https?:\/\//i.test(line)) {
      current.url = line;
      finish();
    }
  }
  finish();
  return { channels, epgUrl };
}

export function parsePlaylist(source: string): LiveChannel[] {
  return parsePlaylistDocument(source).channels;
}

export async function loadPlaylist(ctx: ProviderContext): Promise<LivePlaylist> {
  const response = await ctx.axios.get(PLAYLIST_URL, {
    headers: {
      Accept: "audio/x-mpegurl, application/x-mpegURL, text/plain, */*",
      "Cache-Control": "no-cache",
      "User-Agent": "Vega-LiveTGTV/1.0",
    },
    timeout: 30000,
    maxRedirects: 5,
  });
  const source = (typeof response.data === "string" ? response.data : String(response.data ?? "")).replace(/^\uFEFF/, "");
  if (!source.trimStart().startsWith("#EXTM3U")) throw new Error("LiveTGTV did not return a valid M3U playlist");
  const playlist = parsePlaylistDocument(source);
  if (!playlist.channels.length) throw new Error("LiveTGTV playlist contains no supported channel streams");
  return playlist;
}

export async function loadChannels(ctx: ProviderContext): Promise<LiveChannel[]> {
  return (await loadPlaylist(ctx)).channels;
}

export function channelLink(id: string): string {
  return "livetgtv://channel/" + encodeURIComponent(id);
}

export function channelId(link: string): string {
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "livetgtv:" || parsed.hostname !== "channel") return "";
    return decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    return "";
  }
}
