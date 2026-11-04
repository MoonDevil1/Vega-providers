# Vega Providers: MultiMovies

Community provider extension for Vega App. The active manifest exposes **MultiMovies** only.

## MultiMovies

- Browse featured titles, movies, series, Top IMDb movies and Top IMDb series.
- Browse supported genres and network categories.
- Search the MultiMovies catalog.
- Read title metadata and season/episode links in the structure required by Vega Mobile and Vega Desktop.
- Pass supported media tracks into Vega's existing player integration; this provider does not replace the player.

## Install in Vega

1. Open Vega's provider/extension settings.
2. Add repository URL: `https://github.com/MoonDevil1/Vega-providers`.
3. Refresh the provider list after the build workflow finishes.
4. Select **MultiMovies**.

## Development

The active provider source is in `providers/multi/`; shared utilities and extractors are in `providers/`. Build output is generated in `dist/` by `npm run build`.

```sh
npm ci
npm run build
npm test
node tests/test-multi.js
node tests/test-multi-stream.js
node tests/test-multi-catalog.js
```

## Domain discovery

The provider starts at `https://multimovies.wtf/` and follows the landing page's **Visit MultiMovies** link to discover the current catalog domain. A fallback domain is used only when discovery is unavailable.

## Vega Desktop compatibility

For a series, metadata must expose a `linkList` containing seasons with `episodesLink` or `directLinks`. When a season requires a separate request, `getEpisodes` resolves that season's episode list. The provider keeps the movie and series types distinct so Desktop can render episodes rather than treating a show as a movie.

## Notes

- The source website may change its HTML, domains, metadata and player markup.
- The provider does not modify Vega App or replace Vega's player.
- Subtitle tracks can be passed through only when a supported source exposes a usable subtitle URL and label/language.
- The provider does not bypass DRM, authentication, or access controls.
