import { Stream, ProviderContext } from "../types";

const API_BASE = "https://livetgtv.lovable.app/api/public/channels/";

type LiveTgTvDrm = {
  type: "clearkey";
  keyId: string;
  key: string;
};

function channelIdFromLink(link: string): string {
  const match = String(link || "").match(/^livetgtv:\/\/channel\/([^/?#]+)/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function cleanHex(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^0x/i, "").toLowerCase() : "";
}

function isHexKey(value: string): boolean {
  return Boolean(value && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value));
}

export const getStream = async function ({
  link,
  providerContext,
  signal,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const id = channelIdFromLink(link);
  if (!id) throw new Error("Invalid LiveTGTV channel link");

  // Resolve a new detail response for every playback attempt; signed URLs expire.
  const response = await providerContext.axios.get(API_BASE + encodeURIComponent(id), {
    signal,
    timeout: 20000,
    headers: { ...providerContext.commonHeaders, Accept: "application/json" },
  });

  const data = response.data?.channel || response.data?.data || response.data;
  const sources = Array.isArray(data?.sources)
    ? data.sources
    : typeof data?.source === "string"
      ? [data.source]
      : [];

  if (!sources.length) throw new Error("LiveTGTV V1 did not return any playable sources");

  let drm: LiveTgTvDrm | undefined;
  const drmData = data?.drm;
  if (drmData && String(drmData.type || "").toLowerCase() === "clearkey") {
    const keyId = cleanHex(drmData.keyId || drmData.key_id);
    const key = cleanHex(drmData.key);
    if (isHexKey(keyId) && isHexKey(key) && keyId.length === key.length) {
      drm = { type: "clearkey", keyId, key };
    } else {
      throw new Error("LiveTGTV returned incomplete or invalid ClearKey data");
    }
  }

  return sources
    .filter((source: unknown): source is string => typeof source === "string" && /^https?:\/\//i.test(source))
    .map((source: string, index: number) => {
      const stream: any = {
        server: String(data?.name || "LiveTGTV") + (sources.length > 1 ? " • " + (index + 1) : ""),
        link: source,
        type: /\.mpd(?:$|[?#])/i.test(source) ? "mpd" : "m3u8",
        quality: "Auto",
        tag: drm ? "ClearKey" : "LIVE",
      };
      // Vega's current Stream interface/player does not consume this extension yet.
      // It is included as a structured handoff for the Shaka-capable player integration.
      if (drm) stream.drm = drm;
      return stream as Stream;
    });
};