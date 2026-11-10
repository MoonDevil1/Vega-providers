import { ProviderContext } from "../types";

export const PLAYLIST_URL = "https://livetgtv.lovable.app/api/public/playlist.m3u";

export interface LiveChannel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  type: "m3u8" | "mpd" | "mp4";
  userAgent: string;
  description: string;
}

function attribute(line: string, key: string): string {
  const match = line.match(new RegExp("(?:^|\\s)" + key + '="([^"]*)"', "i"));
  return match ? match[1].trim() : "";
}

function mediaType(rawUrl: string): LiveChannel["type"] | null {
  try {
    const path = new URL(rawUrl).pathname.toLowerCase();
    if (path.endsWith(".m3u8")) return "m3u8";
    if (path.endsWith(".mpd")) return "mpd";
    if (/\.(mp4|m4v)$/i.test(path)) return "mp4";
  } catch {}
  return null;
}

function safeEntry(extras: string[]): boolean {
  // Never import DRM license data, cookies, or per-entry authorization headers.
  return !extras.some((line) =>
    /^#KODIPROP:/i.test(line) ||
    /^#EXTHTTP:/i.test(line) ||
    /license_(?:type|key)|drm|cookie|authorization/i.test(line)
  );
}

export function parsePlaylist(source: string): LiveChannel[] {
  const channels: LiveChannel[] = [];
  let current: { info: string; extras: string[]; url?: string } | null = null;

  const finish = () => {
    if (!current || !current.url || !safeEntry(current.extras)) {
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

    const userAgentLine = current.extras.find((line) =>
      /^#EXTVLCOPT:http-user-agent=/i.test(line)
    );
    const userAgent = userAgentLine
      ? userAgentLine.slice(userAgentLine.indexOf("=") + 1).trim()
      : "";
    const tvgId = attribute(current.info, "tvg-id");
    const group = attribute(current.info, "group-title") || "Other";
    const logo = attribute(current.info, "tvg-logo");
    const description = attribute(current.info, "tvg-name");

    // Include the channel name in the key because playlists may reuse tvg-id
    // for HD/SD variants. This is an identifier, not a stream credential.
    const id = (tvgId || name) + "|" + name;
    channels.push({
      id,
      name,
      logo,
      group,
      url: current.url,
      type,
      userAgent,
      description,
    });
    current = null;
  };

  for (const rawLine of String(source || "").split(/\r?\n/)) {
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
  if (!/^\s*#EXTM3U/m.test(source)) {
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
    return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}
