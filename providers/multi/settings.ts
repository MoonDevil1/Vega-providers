import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "multi_preferredQuality",
      type: "select",
      label: "Preferred Video Quality",
      description:
        "Prioritizes streams matching this resolution when the source exposes quality information. Auto keeps the source order.",
      options: [
        { label: "Auto (Source Default)", value: "auto" },
        { label: "4K (2160p)", value: "2160" },
        { label: "1080p", value: "1080" },
        { label: "720p", value: "720" },
        { label: "480p", value: "480" },
        { label: "360p", value: "360" },
      ],
      defaultValue: "auto",
    },
    {
      key: "multi_preferredServer",
      type: "select",
      label: "Preferred Streaming Server",
      description:
        "Prioritizes this server's playable stream. Other working servers remain available as fallbacks.",
      options: [
        { label: "Auto (Recommended)", value: "auto" },
        { label: "GD Mirror", value: "gdmirror" },
        { label: "Cineverse", value: "cineverse" },
        { label: "IQST", value: "iqst" },
        { label: "VidBolt", value: "vidbolt" },
        { label: "VIDOUT", value: "vidout" },
        { label: "Filmu", value: "filmu" },
      ],
      defaultValue: "auto",
    },
  ];
};
