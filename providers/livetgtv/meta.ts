import { Info, ProviderContext } from "../types";

const CACHE_KEY = "livetgtv-v1-channel-list";

type CachedChannel = { id: string; name: string; category: string; logo: string };

function channelIdFromLink(link: string): string {
  const match = String(link || "").match(/^livetgtv:\/\/channel\/([^/?#]+)/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  provider?: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const id = channelIdFromLink(link);
  if (!id) throw new Error("Invalid LiveTGTV channel link");

  let channel: CachedChannel | undefined;
  try {
    const cached = await providerContext.kvStore.get<{ channels: CachedChannel[] }>(CACHE_KEY);
    channel = cached?.channels?.find((item) => String(item.id) === id);
  } catch {}

  const title = channel?.name || "LiveTGTV Channel " + id;
  const image = channel?.logo || "";

  return {
    title,
    synopsis: "Live channel • " + (channel?.category || "V1"),
    image,
    imdbId: "",
    type: "movie",
    linkList: [{
      title: "Live",
      quality: "Auto",
      directLinks: [{ title: "Play Live", link: "livetgtv://channel/" + encodeURIComponent(id), type: "movie" }],
    }],
  };
};