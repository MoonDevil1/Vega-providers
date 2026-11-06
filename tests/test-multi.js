const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { getMeta } = require("../dist/multi/meta.js");
const { getEpisodes } = require("../dist/multi/episodes.js");

const base = "https://m1.multimovies.courses";
const seriesUrl = base + "/series/test-show";

function episodeCard(number, name) {
  return '<div class="cinejoy-ep-card" id="ep-item-1-' + number + '">' +
    '<a class="cinejoy-ep-thumb-link" href="' + seriesUrl + '/season/1/episode/' + number + '">' +
    '<span class="cinejoy-ep-badge-num">E' + number + '</span></a>' +
    '<a class="cinejoy-ep-name" title="' + name + '" href="' + seriesUrl + '/season/1/episode/' + number + '">' + name + '</a></div>';
}

function seasonPage(options) {
  const season = options.season || 1;
  const episodes = options.episodes || [];
  const ranges = options.ranges || [];
  const rangeSelect = ranges.length
    ? '<select id="episodeRangeSelect" class="cinejoy-season-select episode-range-select">' +
      ranges.map((range) => '<option value="' + range + '"' + (range === (episodes[0] ? episodes[0].number : ranges[0]) ? ' selected=""' : '') + '>Episodes ' + range + '</option>').join("") +
      '</select>'
    : "";
  return '<html><body>' +
    '<div class="cinejoy-detail-title">Test Show</div>' +
    '<div id="cinejoyOverview">A test synopsis.</div>' +
    '<div class="watch-bg"><img src="/poster.jpg"></div>' +
    '<section class="cinejoy-episodes-section">' + rangeSelect +
    '<div class="cinejoy-season-pill-dropdown"><select class="cinejoy-season-select" aria-label="Season">' +
    '<option value="1"' + (season === 1 ? ' selected=""' : '') + '>Season 1 · 3 episodes</option>' +
    '<option value="2"' + (season === 2 ? ' selected=""' : '') + '>Season 2 · 1 episode</option>' +
    '</select></div><div class="cinejoy-season-grid active" id="cinejoy-season-' + season + '">' +
    episodes.map((episode) => episodeCard(episode.number, episode.name)).join("") +
    '</div></section></body></html>';
}

const firstRange = seasonPage({
  season: 1,
  episodes: [{ number: 1, name: "Pilot" }, { number: 2, name: "Second" }],
  ranges: [1, 3],
});
const secondRange = seasonPage({
  season: 1,
  episodes: [{ number: 3, name: "Third" }],
  ranges: [1, 3],
});
const secondSeason = seasonPage({
  season: 2,
  episodes: [{ number: 4, name: "Season Two Premiere" }],
});
const partialRangeSeason = seasonPage({
  season: 5,
  episodes: [{ number: 1, name: "First range must survive" }],
  ranges: [1, 3],
});

const multiSeasonMarkupPage =
  '<html><body><section class="cinejoy-episodes-section">' +
  '<div class="cinejoy-season-grid active" id="cinejoy-season-1">' +
  '<a class="cinejoy-ep-name" href="' + seriesUrl + '/season/1/episode/1">Season One Episode One</a>' +
  '</div><div class="cinejoy-season-grid" id="cinejoy-season-2">' +
  '<a class="cinejoy-ep-name" href="' + seriesUrl + '/season/2/episode/1">Season Two Episode One</a>' +
  '</div><div class="cinejoy-season-grid" id="cinejoy-season-3">' +
  '<a class="cinejoy-ep-name" href="' + seriesUrl + '/season/3/episode/1">Season Three Episode One</a>' +
  '</div></section></body></html>';

const blockedSeasonPage =
  '<html><body><title>Just a moment...</title><h1>Checking your browser</h1></body></html>';

const legacyDownloadLinksPage =
  '<html><body><div class="entry-content">' +
  '<h5>Episode 1: Pilot</h5>' +
  '<div class="downloads-btns-div"><a href="/hubcloud/episode-1" style="background: linear-gradient(135deg,#e629d0,#007bff);">HubCloud</a></div>' +
  '</div></body></html>';

const alternateDesktopMarkupPage =
  '<html><body><section class="episode-list">' +
  '<div class="episode-card" data-episode-url="/series/test-show/season/4/episode/9" title="Episode 9: Alternate markup"></div>' +
  '<a data-url="/series/test-show/season/4/episode/10" aria-label="Episode 10: Data URL">Open</a>' +
  '</section></body></html>';

const movieUrl = base + "/movie/test-movie";
const moviePage =
  '<html><body><h1 class="cinejoy-detail-title">Test Movie</h1>' +
  '<div class="cinejoy-detail-overview">A movie fixture.</div></body></html>';

const singleSeasonNoSelectPage =
  '<html><body>' +
  '<h1 class="cinejoy-detail-title">The Perfect Lie</h1>' +
  '<div class="cinejoy-detail-overview">A live-layout fixture.</div>' +
  '<div class="cinejoy-season-pill">Season 1</div>' +
  '<div class="cinejoy-season-grid active" id="cinejoy-season-1">' +
  '<div class="cinejoy-ep-card" id="ep-item-1-1">' +
  '<a class="cinejoy-ep-thumb-link" href="https://m1.multimovies.courses/series/the-perfect-lie/season/1/episode/1">' +
  '<span class="cinejoy-ep-badge-num">E1</span></a>' +
  '<a class="cinejoy-ep-name" title="Date" href="https://m1.multimovies.courses/series/the-perfect-lie/season/1/episode/1">Date</a>' +
  '</div></div></body></html>';

const episodeRequests = [];
const platformUserAgent = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";

const providerContext = {
  cheerio,
  commonHeaders: { "User-Agent": platformUserAgent },
  axios: {
    get: async (url, config = {}) => {
      episodeRequests.push({ url, headers: config.headers || {} });
      const parsed = new URL(url);
      const season = parsed.searchParams.get("season") || "1";
      const range = parsed.searchParams.get("ep_range");
      if (parsed.pathname === "/series/test-show" && !range && season === "1") return { data: firstRange, status: 200 };
      if (parsed.pathname === "/series/test-show" && range === "1" && season === "1") return { data: firstRange, status: 200 };
      if (parsed.pathname === "/series/test-show" && range === "3" && season === "1") return { data: secondRange, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "2") return { data: secondSeason, status: 200 };
      if (parsed.pathname === "/series/test-show" && ["1", "2", "3"].includes(season)) return { data: multiSeasonMarkupPage, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "3") return { data: legacyDownloadLinksPage, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "4") return { data: alternateDesktopMarkupPage, status: 200 };
      if (parsed.pathname === "/series/the-perfect-lie") return { data: singleSeasonNoSelectPage, status: 200 };
      if (parsed.pathname === "/movie/test-movie") return { data: moviePage, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "6") return { data: blockedSeasonPage, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "5" && !range) return { data: partialRangeSeason, status: 200 };
      if (parsed.pathname === "/series/test-show" && season === "5" && range === "3") throw new Error("Secondary range unavailable in Desktop runtime");
      throw new Error("Unexpected URL: " + url);
    },
  },
};

(async () => {
  const meta = await getMeta({ link: seriesUrl, providerContext });
  assert.equal(meta.title, "Test Show");
  assert.equal(meta.type, "series");
  assert.equal(meta.linkList.length, 2, "episode-range choices must not be reported as seasons");
  assert.deepEqual(meta.linkList.map((entry) => entry.title), [
    "Season 1 · 3 episodes",
    "Season 2 · 1 episode",
  ]);
  assert.ok(meta.linkList.every((entry) => entry.episodesLink));

  const episodeRequestStart = episodeRequests.length;
  const seasonOne = await getEpisodes({ url: seriesUrl + "?season=1", providerContext });
  assert.equal(seasonOne.length, 3, "all episode ranges should be combined into one season");
  const seasonOneRequests = episodeRequests.slice(episodeRequestStart);
  assert.ok(seasonOneRequests.length > 0, "episode requests should be made");
  assert.ok(seasonOneRequests.every(({ headers }) => headers["User-Agent"] === platformUserAgent), "episode requests must preserve Vega platform User-Agent");
  assert.ok(seasonOneRequests.every(({ headers }) => headers.Referer === base), "episode requests must use the provider site as Referer");
  assert.deepEqual(seasonOne.map((episode) => episode.link), [
    seriesUrl + "/season/1/episode/1",
    seriesUrl + "/season/1/episode/2",
    seriesUrl + "/season/1/episode/3",
  ]);

  const seasonTwo = await getEpisodes({ url: seriesUrl + "?season=2", providerContext });
  assert.equal(seasonTwo.length, 1);
  assert.match(seasonTwo[0].title, /Season Two Premiere/);

  const multiSeasonSeven = await getEpisodes({ url: seriesUrl + "?season=2", providerContext });
  assert.deepEqual(multiSeasonSeven.map((episode) => episode.link), [
    seriesUrl + "/season/2/episode/1",
  ], "only episode links explicitly matching the selected season may be returned");
  const multiSeasonEight = await getEpisodes({ url: seriesUrl + "?season=1", providerContext });
  assert.deepEqual(multiSeasonEight.map((episode) => episode.link), [
    seriesUrl + "/season/1/episode/1",
  ], "episode selection must not leak cards from hidden seasons");

  const legacySeason = await getEpisodes({ url: seriesUrl + "?season=3", providerContext });
  assert.equal(legacySeason.length, 1, "legacy h5 + HubCloud episode lists should be supported");
  assert.equal(legacySeason[0].title, "Episode 1: Pilot");
  assert.equal(legacySeason[0].link, base + "/hubcloud/episode-1");

  const alternateMarkupEpisodes = await getEpisodes({ url: seriesUrl + "?season=4", providerContext });
  assert.equal(alternateMarkupEpisodes.length, 2, "episode URLs in alternate card/data attributes should be recovered");
  assert.equal(alternateMarkupEpisodes[0].link, seriesUrl + "/season/4/episode/9");
  assert.match(alternateMarkupEpisodes[0].title, /Episode 9: Alternate markup/);
  assert.equal(alternateMarkupEpisodes[1].link, seriesUrl + "/season/4/episode/10");

  const movieMeta = await getMeta({ link: movieUrl, providerContext });
  assert.equal(movieMeta.type, "movie");
  assert.equal(movieMeta.linkList.length, 1);
  assert.equal(movieMeta.linkList[0].episodesLink, undefined,
    "movie metadata must not be exposed as an episode list");
  assert.equal(movieMeta.linkList[0].directLinks[0].link, movieUrl,
    "movie metadata must expose its direct playback link");

  const liveLayoutMeta = await getMeta({ link: base + "/series/the-perfect-lie", providerContext });
  assert.equal(liveLayoutMeta.title, "The Perfect Lie");
  assert.equal(liveLayoutMeta.type, "series");
  assert.equal(liveLayoutMeta.linkList.length, 1, "single-season pill layout should still expose one season");
  const liveLayoutEpisodes = await getEpisodes({ url: base + "/series/the-perfect-lie?season=1", providerContext });
  assert.equal(liveLayoutEpisodes.length, 1, "current single-season layout without a select must return its episode");
  assert.equal(liveLayoutEpisodes[0].link, base + "/series/the-perfect-lie/season/1/episode/1");

  await assert.rejects(
    getEpisodes({ url: seriesUrl + "?season=6", providerContext }),
    /No episodes parsed.*challengePage.*true/,
    "Desktop should expose a blocked/empty response instead of silently returning an empty list",
  );

  const partialRangeEpisodes = await getEpisodes({ url: seriesUrl + "?season=5", providerContext });
  assert.equal(partialRangeEpisodes.length, 1, "a failed optional range must not discard episodes from the initial page");
  assert.equal(partialRangeEpisodes[0].title, "First range must survive");

  console.log("MultiMovies regression tests passed: season parsing, range pagination, alternate markup, and partial-range resilience.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
