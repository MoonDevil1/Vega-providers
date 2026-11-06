import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "multi_preferredServer",
      type: "select",
      label: "Preferred Streaming Server",
      description:
        "GD Mirror is tried first, Cineverse second, then other servers as automatic fallbacks.",
      options: [
        { label: "GD Mirror", value: "gdmirror" },
        { label: "Cineverse", value: "cineverse" },
        { label: "IQST", value: "iqst" },
        { label: "VidBolt", value: "vidbolt" },
        { label: "VIDOUT", value: "vidout" },
        { label: "Filmu", value: "filmu" },
      ],
      defaultValue: "gdmirror",
    },
  ];
};
