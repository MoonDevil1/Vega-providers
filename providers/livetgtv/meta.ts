import { Info, ProviderContext } from "../types";
import { channelId, loadChannels } from "./playlist";

export async function getMeta({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const id = channelId(link);
  const channel = (await loadChannels(providerContext)).find((item) => item.id === id);
  if (!channel) {
    throw new Error("LiveTGTV channel is no longer present in the current playlist");
  }

  return {
    title: channel.name,
    image: channel.logo,
    synopsis: channel.group + " • Live TV",
    imdbId: "",
    type: "movie",
    tags: [channel.group, "Live TV"],
    linkList: [{
      title: "Live",
      directLinks: [{ title: channel.name, link }],
    }],
  };
}
