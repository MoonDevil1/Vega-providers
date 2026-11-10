import { ProviderContext } from "../types";
import { loadChannels } from "./playlist";

export const catalog = [
  { title: "All Live Channels", filter: "all" },
];

export async function genres({ providerContext }: { providerContext: ProviderContext }) {
  const channels = await loadChannels(providerContext);
  return Array.from(new Set(channels.map((channel) => channel.group)))
    .sort((a, b) => a.localeCompare(b))
    .map((group) => ({ title: group, filter: "group:" + group }));
}
