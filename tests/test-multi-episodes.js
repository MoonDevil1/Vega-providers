const assert = require("node:assert/strict");
const { getEpisodes } = require("../dist/multi/episodes.js");

const seriesUrl = "https://m1.multimovies.courses/series/the-boys-1560?season=1";
const firstRange = [
  '<select class="cinejoy-season-select" aria-label="Season"><option value="1" selected>Season 1</option><option value="2">Season 2</option></select>',
  '<select id="episodeRangeSelect"><option value="1" selected>Episodes 1-8</option><option value="9">Episodes 9-16</option></select>',
  '<div class="cinejoy-season-grid active" id="cinejoy-season-1">',
  '<div class="cinejoy-ep-card" id="ep-item-1-1"><a href="/series/the-boys-1560/season/1/episode/1" class="cinejoy-ep-thumb-link"><img alt="The Name of the Game"><span class="cinejoy-ep-badge-num">E1</span></a><a href="/series/the-boys-1560/season/1/episode/1" class="cinejoy-ep-name" title="The Name of the Game">The Name of the Game</a></div>',
  '<div class="cinejoy-ep-card" id="ep-item-1-2"><a href="/series/the-boys-1560/season/1/episode/2" class="cinejoy-ep-thumb-link"><img alt="Cherry"><span class="cinejoy-ep-badge-num">E2</span></a><a href="/series/the-boys-1560/season/1/episode/2" class="cinejoy-ep-name" title="Cherry">Cherry</a></div>',
  "</div>",
].join("\n");
const secondRange = '<div class="cinejoy-season-grid active" id="cinejoy-season-1">' +
  '<div class="cinejoy-ep-card" id="ep-item-1-9"><a href="/series/the-boys-1560/season/1/episode/9" class="cinejoy-ep-thumb-link"><img alt="The Innocents"><span class="cinejoy-ep-badge-num">E9</span></a><a href="/series/the-boys-1560/season/1/episode/9" class="cinejoy-ep-name" title="The Innocents">The Innocents</a></div></div>';

async function main() {
  const requests = [];
  const axios = { async get(url) {
    requests.push(url);
    if (url === seriesUrl) return { data: firstRange };
    if (url.includes("ep_range=9")) return { data: secondRange };
    throw new Error("Unexpected URL: " + url);
  }};
  const episodes = await getEpisodes({
    url: seriesUrl,
    providerContext: { axios, cheerio: null, commonHeaders: {} },
  });
  assert.equal(episodes.length, 3);
  assert.deepEqual(episodes.map((episode) => episode.title), [
    "E1 The Name of the Game", "E2 Cherry", "E9 The Innocents",
  ]);
  assert.deepEqual(episodes.map((episode) => episode.link), [
    "https://m1.multimovies.courses/series/the-boys-1560/season/1/episode/1",
    "https://m1.multimovies.courses/series/the-boys-1560/season/1/episode/2",
    "https://m1.multimovies.courses/series/the-boys-1560/season/1/episode/9",
  ]);
  assert.equal(requests.length, 2, "range pages should be fetched sequentially");

  const seasonTwo = await getEpisodes({
    url: "https://m1.multimovies.courses/series/the-boys-1560?season=2",
    providerContext: {
      axios: { get: async () => ({ data: '<a class="cinejoy-ep-name" title="Season Two" href="/series/the-boys-1560/season/2/episode/1">Season Two</a>' }) },
      cheerio: null, commonHeaders: {},
    },
  });
  assert.equal(seasonTwo.length, 1);
  assert.match(seasonTwo[0].link, /\/season\/2\/episode\/1$/);
  console.log("MultiMovies Desktop-compatible episode extraction tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
