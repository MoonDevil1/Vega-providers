import { Post, ProviderContext } from "../types";

const API_BASE = "https://livetgtv.lovable.app/api/public/channels";
const CACHE_KEY = "livetgtv-v1-channel-list";
const CACHE_TTL = 2 * 60 * 1000;

type LiveChannel = {
  id: string;
  name: string;
  category: string;
  logo: string;
};

function cleanString(value: unknown): string {
  if (typeof value !== "string") return "";
  const valueText = value.trim();
  // Some copied API examples wrap URLs as Markdown links: [url](url).
  const markdown = valueText.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i);
  return markdown ? markdown[2] : valueText;
}

function normalizeChannel(value: any): LiveChannel | null {
  if (!value || value.id == null || !value.name) return null;
  return {
    id: String(value.id).trim(),
    name: String(value.name).trim(),
    category: String(value.category || "Other").trim(),
    logo: cleanString(value.logo),
  };
}

function unwrapChannels(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.channels)) return payload.channels;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && payload.data && Array.isArray(payload.data.channels)) return payload.data.channels;
  throw new Error("LiveTGTV V1 returned an unsupported channel-list response");
}

export async function loadChannels(
  providerContext: ProviderContext,
  signal?: AbortSignal,
): Promise<LiveChannel[]> {
  const { axios, kvStore, commonHeaders = {} } = providerContext;

  try {
    const cached = await kvStore.get<{ savedAt: number; channels: LiveChannel[] }>(CACHE_KEY);
    if (cached && Date.now() - cached.savedAt < CACHE_TTL && Array.isArray(cached.channels)) {
      return cached.channels;
    }
  } catch {}

  const response = await axios.get(API_BASE, {
    signal,
    timeout: 20000,
    headers: { ...commonHeaders, Accept: "application/json" },
  });

  const channels = unwrapChannels(response.data)
    .map(normalizeChannel)
    .filter((channel: LiveChannel | null): channel is LiveChannel => Boolean(channel && channel.id && channel.name));

  if (!channels.length) throw new Error("LiveTGTV V1 returned no usable channels");

  try {
    await kvStore.set(CACHE_KEY, { savedAt: Date.now(), channels });
  } catch {}

  return channels;
}

function toPost(channel: LiveChannel): Post {
  return {
    title: channel.name,
    link: "livetgtv://channel/" + encodeURIComponent(channel.id),
    image: channel.logo,
    provider: "livetgtv",
    tag: "LIVE",
    cornerTag: "LIVE",
  };
}

export const getPosts = async function ({
  filter,
  providerContext,
  signal,
}: {
  filter: string;
  page?: number;
  providerValue?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const channels = await loadChannels(providerContext, signal);
  const selected = String(filter || "all").trim().toLowerCase();

  return channels
    .filter((channel) => {
      if (!selected || selected === "all") return true;
      const category = channel.category.toLowerCase();
      if (selected === "regional") {
        return !["sports", "entertainment", "news", "movies", "kids", "music", "english", "hindi"].includes(category);
      }
      return category === selected || category.includes(selected);
    })
    .map(toPost);
};

export const getSearchPosts = async function ({
  searchQuery,
  providerContext,
  signal,
}: {
  searchQuery: string;
  page?: number;
  providerValue?: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = String(searchQuery || "").trim().toLowerCase();
  if (!query) return [];

  const channels = await loadChannels(providerContext, signal);
  return channels
    .filter((channel) =>
      channel.name.toLowerCase().includes(query) ||
      channel.category.toLowerCase().includes(query)
    )
    .map(toPost);
};