# Vega Providers: MultiMovies, Hindi IPTV and Multi 2

Community provider extension for Vega App.

## MultiMovies
- Browse categories and search titles
- Read title metadata and season/episode links
- Return available playback sources to Vega's existing player integration
- Extract publicly exposed HLS/MP4 URLs and subtitle tracks when the source player exposes them.

## Install in Vega

1. Open Vega's provider/extension settings.
2. Add repository URL: `https://github.com/MoonDevil1/Vega-providers`.
3. Refresh the provider list after the build workflow finishes.
4. Select **MultiMovies**.

## Multi 2

**Multi 2** is a separate provider implementation based on the `multi` provider from [Zenda-Cross/vega-providers](https://github.com/Zenda-Cross/vega-providers/tree/main/providers/multi). Its upstream ISC attribution is retained in `providers/multi2/NOTICE.md`. It uses the separate provider ID `multi2`; the existing MultiMovies provider (`multi`) and Hindi IPTV provider (`iptv`) remain separate.

## Development

Provider source is in `providers/multi/`, `providers/multi2/`, and `providers/iptv/`; shared stream extractors are in `providers/extractors/`. Build output is generated in `dist/` by `npm run build`. GitHub Actions builds and commits the generated bundles after pushes to `main`.

```sh
npm ci
npm run build
npm test
```

## Notes
- The source website may change its HTML, domains, player markup and server configuration.
- The provider does not replace Vega's player.
- A subtitle track is shown only when its URL and language/label can be read from the source player configuration or markup.
- This implementation does not bypass DRM or authentication.

## Vega Desktop compatibility note

This template is designed to work with the Vega desktop runtime, and the desktop app is stricter than the mobile app about series data.

For a series, each season in `meta.ts` must resolve to one of these structures:

```ts
linkList: [
  {
    title: "Season 1",
    episodesLink: "https://example.com/series/slug/season-1",
  },
];
```

or:

```ts
linkList: [
  {
    title: "Season 1",
    directLinks: [
      { title: "Episode 1", link: "https://example.com/episode-1", type: "series" },
      { title: "Episode 2", link: "https://example.com/episode-2", type: "series" },
    ],
  },
];
```

Important rules:
- `type` must be `"series"` for TV shows.
- If a season requires a separate HTTP request, use `episodesLink` and export `getEpisodes` from `episodes.ts`.
- If all episodes are already present on the page, use `directLinks` instead.
- A post/list item alone is not enough; the metadata page must provide a valid `linkList` for the desktop app to render episodes.
- Do not rely on a format that works only in mobile; the same provider must satisfy the desktop contract.

This means the app itself is not the primary issue when a show shows posts but not episodes. The provider must return the proper `linkList` and episode module structure for the desktop runtime.

## Hindi IPTV

The **Hindi IPTV** provider scrapes the public iptv-org India M3U playlist and filters it against curated Hindi entertainment channel IDs.

Categories and current scraped result (31 channel cards / 77 listed stream URLs):
- Hindi Movies — 8 channels, 29 stream URLs
- Hindi Kids — 13 channels, 14 stream URLs
- Hindi Serials — 10 channels, 34 stream URLs

The provider scrapes the live India M3U playlist, parses each EXTINF channel record, language/feed suffix, logo and every listed stream URL, then filters against curated Hindi channel IDs. Explicit regional-language feeds (for example Tamil and Telugu), geo-blocked entries and entries marked not 24/7 are excluded. Playlist entries are cached for five minutes. Logos are mapped locally to the channel IDs, so startup does not need to download the full global channel/logo databases. It also reads EXTHTTP and EXT VlcOpt user-agent, referer, origin and cookie headers and passes them through to Vega's player.

Playback returns the selected original HLS/DASH/MP4 URL to Vega's existing player; it does not embed a replacement player.

Install/refresh the repository URL in Vega:
`https://github.com/MoonDevil1/Vega-providers`

**Availability notice:** community playlist entries can change, go offline, require headers, or be region-restricted. A channel appearing in the filtered list does not guarantee every mirror will play in every country.
