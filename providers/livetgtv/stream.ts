import { Stream, ProviderContext } from "../types";
import { channelId, loadChannels } from "./playlist";

export async function getStream({
  link,
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

  // Resolve against the latest playlist at playback time so signed media URLs
  // are refreshed instead of being stored in the provider or Git history.
  const channel = (await loadChannels(providerContext)).find((item) => item.id === id);
  if (!channel) return [];

  const headers: Record<string, string> = {};
  if (channel.userAgent) headers["User-Agent"] = channel.userAgent;

  return [{
    server: "LiveTGTV",
    link: channel.url,
    type: channel.type,
    quality: "Auto",
    ...(Object.keys(headers).length ? { headers } : {}),
  }];
}
