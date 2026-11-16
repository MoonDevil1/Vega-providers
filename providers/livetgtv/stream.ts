import { Stream, StreamDrm, ProviderContext } from "../types";
import { channelId, loadChannels } from "./playlist";

const CHANNEL_API_URL = "https://livetgtv.lovable.app/api/public/channels";

type ChannelDetails = {
  sources?: unknown;
  drm?: {
    type?: string;
    keyId?: string;
    key?: string;
    clearKeys?: Record<string, string>;
    licenseServer?: string;
    licenseUrl?: string;
    headers?: Record<string, string>;
    multiDrm?: boolean;
    contentId?: string;
    certificateUrl?: string;
    base64Certificate?: boolean;
  } | null;
  headers?: Record<string, string>;
};

function apiChannelId(id: string): string {
  return id.replace(/^(?:liveid|tvg):/, "");
}

function streamType(url: string, fallback: string): string {
  const value = url.toLowerCase();
  if (/\.mpd(?:$|[?#])/.test(value)) return "mpd";
  if (/\.m3u8(?:$|[?#])/.test(value)) return "m3u8";
  if (/\.(?:mp4|m4v)(?:$|[?#])/.test(value)) return "mp4";
  return fallback;
}

function normalizeDrm(value: ChannelDetails["drm"]): StreamDrm | undefined {
  if (!value || typeof value !== "object") return undefined;
  const type = String(value.type || "").toLowerCase();
  if (!["widevine", "playready", "clearkey", "fairplay"].includes(type)) return undefined;

  if (type === "clearkey") {
    const keys: Record<string, string> = {};
    if (value.clearKeys && typeof value.clearKeys === "object") {
      for (const [kid, key] of Object.entries(value.clearKeys)) {
        if (/^[a-f\d]{32}$/i.test(kid) && /^[a-f\d]{32}$/i.test(String(key))) {
          keys[kid.toLowerCase()] = String(key).toLowerCase();
        }
      }
    } else if (value.keyId && value.key) {
      if (/^[a-f\d]{32}$/i.test(value.keyId) && /^[a-f\d]{32}$/i.test(value.key)) {
        keys[value.keyId.toLowerCase()] = value.key.toLowerCase();
      }
    }
    return Object.keys(keys).length ? { type: "clearkey", clearKeys: keys } : undefined;
  }

  const licenseServer = value.licenseServer || value.licenseUrl;
  if (!licenseServer) return undefined;
  return {
    type: type as StreamDrm["type"],
    licenseServer,
    ...(value.headers && typeof value.headers === "object" ? { headers: value.headers } : {}),
    ...(value.multiDrm ? { multiDrm: true } : {}),
    ...(value.contentId ? { contentId: value.contentId } : {}),
    ...(value.certificateUrl ? { certificateUrl: value.certificateUrl } : {}),
    ...(value.base64Certificate ? { base64Certificate: true } : {}),
  };
}

function parseDetails(data: unknown): ChannelDetails | null {
  if (data && typeof data === "object") return data as ChannelDetails;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as ChannelDetails;
    } catch {}
  }
  return null;
}

export async function getStream({
  link,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const id = channelId(link);
  if (!id) return [];

  // The playlist provides the channel list; the detail API supplies fresh signed
  // media URLs and the ClearKey/license data needed by Vega's native player.
  const channel = (await loadChannels(providerContext)).find((item) => item.id === id);
  if (!channel) return [];

  const hasAuthHeader = Object.keys(channel.headers).some((key) =>
    /^(cookie|authorization)$/i.test(key)
  );
  if (channel.requiresAuthorization && !hasAuthHeader) return [];

  let details: ChannelDetails | null = null;
  const apiId = apiChannelId(id);
  if (apiId && !apiId.startsWith("name:")) {
    try {
      const response = await providerContext.axios.get(
        `${CHANNEL_API_URL}/${encodeURIComponent(apiId)}`,
        {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
            "User-Agent": "Vega-LiveTGTV/1.0",
          },
          timeout: 15000,
          ...(signal ? { signal } : {}),
        },
      );
      details = parseDetails(response.data);
    } catch {
      // Keep the existing non-DRM playlist fallback when the detail endpoint is unavailable.
    }
  }

  const drm = normalizeDrm(details?.drm);
  if (channel.requiresDrm && !drm) return [];

  const apiSources = Array.isArray(details?.sources)
    ? details!.sources.filter((source): source is string =>
        typeof source === "string" && /^https?:\/\//i.test(source.trim())
      ).map((source) => source.trim())
    : [];
  const sources = apiSources.length ? apiSources : (!channel.requiresDrm ? [channel.url] : []);
  if (!sources.length) return [];

  const headers = {
    ...channel.headers,
    ...(details?.headers && typeof details.headers === "object" ? details.headers : {}),
  };

  return sources.map((source, index) => ({
    server: sources.length > 1 ? `LiveTGTV ${index + 1}` : "LiveTGTV",
    link: source,
    type: streamType(source, channel.type),
    quality: "Auto",
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(drm ? { drm } : {}),
  }));
}
