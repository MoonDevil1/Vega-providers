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

  // Refresh signed URLs and per-channel headers immediately before playback.
  const channel = (await loadChannels(providerContext)).find((item) => item.id === id);
  if (!channel || channel.requiresDrm) return [];

  const hasAuthHeader = Object.keys(channel.headers).some((key) =>
    /^(cookie|authorization)$/i.test(key)
  );
  if (channel.requiresAuthorization && !hasAuthHeader) return [];

  return [{
    server: "LiveTGTV",
    link: channel.url,
    type: channel.type,
    quality: "Auto",
    ...(Object.keys(channel.headers).length ? { headers: channel.headers } : {}),
  }];
}
