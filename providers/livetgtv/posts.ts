import { Post, ProviderContext } from "../types";
import { channelLink, loadChannels } from "./playlist";

export async function getPosts({
  filter,
  page = 1,
  providerContext,
}: {
  filter?: string;
  page?: number;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const channels = await loadChannels(providerContext);
  const route = String(filter || "all");
  const selected = route.startsWith("group:")
    ? channels.filter((channel) => channel.group === route.slice(6))
    : channels;
  const start = (Math.max(1, page) - 1) * 60;
  return selected.slice(start, start + 60).map((channel) => ({
    title: channel.name,
    link: channelLink(channel.id),
    image: channel.logo,
    tag: channel.group,
    cornerTag: channel.requiresDrm ? "DRM" : channel.requiresAuthorization ? "Login" : "LIVE",
  }));
}

export async function getSearchPosts({
  searchQuery,
  page = 1,
  providerContext,
}: {
  searchQuery: string;
  page?: number;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = String(searchQuery || "").trim().toLowerCase();
  if (!query) return [];
  const channels = await loadChannels(providerContext);
  const matched = channels.filter((channel) =>
    channel.name.toLowerCase().includes(query) ||
    channel.group.toLowerCase().includes(query)
  );
  const start = (Math.max(1, page) - 1) * 60;
  return matched.slice(start, start + 60).map((channel) => ({
    title: channel.name,
    link: channelLink(channel.id),
    image: channel.logo,
    tag: channel.group,
  }));
}
