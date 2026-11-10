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

function attribute(line: string, key: string): string {
  const match = line.match(new RegExp("(?:^|\\s)" + key + '="([^"]*)"', "i"));
  return match ? match[1].trim() : "";
}

function mediaType(rawUrl: string): LiveChannel["type"] | null {
  try {
    const url = new URL(rawUrl);
    const path = (url.pathname + url.search).toLowerCase();
    if (/\.m3u8(?:$|[?&])/.test(path) || /[?&](?:type|format)=m3u8(?:&|$)/.test(path)) return "m3u8";
    if (/\.mpd(?:$|[?&])/.test(path) || /[?&](?:type|format)=mpd(?:&|$)/.test(path)) return "mpd";
    if (/\.(mp4|m4v)(?:$|[?&])/.test(path)) return "mp4";
  } catch {}
  return null;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const key = name.trim();
  const content = value.trim();
  if (!key || !content || /[\\r\\n]/.test(key + content)) return;
  const existing = Object.keys(headers).find((item) => item.toLowerCase() === key.toLowerCase());
  headers[existing || key] = content;
}

function parseHeaderPayload(raw: string, headers: Record<string, string>): void {
  const value = raw.trim();
  if (!value) return;
  try {
    const parsed = JSON.parse(value);
    const source = parsed && typeof parsed === "object" && parsed.headers && typeof parsed.headers === "object"
      ? parsed.headers
      : parsed;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key, item] of Object.entries(source)) {
        if (typeof item === "string" || typeof item === "number") setHeader(headers, key, String(item));
      }
      return;
    }
  } catch {}
  for (const pair of value.split(/[&;\\n]/)) {
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
      const name = option.endsWith("user-agent") ? "User-Agent"
        : option.endsWith("referrer") ? "Referer"
        : option.endsWith("origin") ? "Origin"
        : option.endsWith("cookie") ? "Cookie" : "Authorization";
      setHeader(headers, name, line.slice(index + 1));
    }
  }
  return headers;
}

export function parsePlaylist(source: string): LiveChannel[] {
  const channels: LiveChannel[] = [];
  let current: { info: string; extras: string[]; url?: string } | null = null;

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
    const id = (tvgId || name) + "|" + name;
    const requiresDrm = current.extras.some((line) =>
      /^#KODIPROP:.*(?:license_(?:type|key)|drm)/i.test(line)
    );
    const requiresAuthorization = current.extras.some((line) =>
      /cookie|authorization/i.test(line)
    ) || Object.keys(headers).some((key) => /^(cookie|authorization)$/i.test(key));

    channels.push({
      id,
      name,
      logo,
      group,
      url: current.url,
      type,
      headers,
      description: name,
      requiresDrm,
      requiresAuthorization,
    });
    current = null;
  };

  for (const rawLine of String(source || "").split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      finish();
      current = { info: line, extras: [] };
    } else if (current && line.startsWith("#")) {
      current.extras.push(line);
    } else if (current && /^https?:\\/\\//i.test(line)) {
      current.url = line;
      finish();
    }
  }
  finish();
  return channels;
}

export async function loadChannels(ctx: ProviderContext): Promise<LiveChannel[]> {
  const response = await ctx.axios.get(PLAYLIST_URL, {
    headers: {
      Accept: "audio/x-mpegurl, application/x-mpegURL, text/plain, */*",
      "Cache-Control": "no-cache",
      "User-Agent": "Vega-LiveTGTV/1.0",
    },
    timeout: 30000,
    maxRedirects: 5,
  });
  const source = typeof response.data === "string"
    ? response.data
    : String(response.data ?? "");
  if (!/^\\s*#EXTM3U/m.test(source)) {
    throw new Error("LiveTGTV did not return a valid M3U playlist");
  }
  return parsePlaylist(source);
}

export function channelLink(id: string): string {
  return "livetgtv://channel/" + encodeURIComponent(id);
}

export function channelId(link: string): string {
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "livetgtv:" || parsed.hostname !== "channel") return "";
    return decodeURIComponent(parsed.pathname.replace(/^\\//, ""));
  } catch {
    return "";
  }
}
