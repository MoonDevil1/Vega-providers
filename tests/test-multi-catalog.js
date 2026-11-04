const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { catalog } = require("../dist/multi/catalog.js");
const { getPosts, getSearchPosts } = require("../dist/multi/posts.js");
const { getMeta } = require("../dist/multi/meta.js");

const landingPage = '<a href="https://catalog.example.test/">Visit MultiMovies</a>';
const listingPage =
  '<article class="poster-card">' +
  '<a class="poster-art" href="/movie/sample-title"><img src="/poster.jpg" alt="Sample Title"></a>' +
  '<div class="poster-caption"><a href="/movie/sample-title">Sample Title</a></div>' +
  '</article>';

const requests = [];
const providerContext = {
  cheerio,
  axios: {
    get: async (url) => {
      if (url === "https://multimovies.wtf/") return { data: landingPage, status: 200 };
      if (url.endsWith("/movie/og-sample")) {
        return { data: '<html><head>' +
          '<meta property="og:title" content="Sample Movie - MultiMovies 2.0">' +
          '<meta property="og:type" content="video.movie">' +
          '<meta property="og:image" content="https://images.example.test/sample.jpg">' +
          '<meta property="og:description" content="Sample synopsis.">' +
          '</head><body></body></html>', status: 200 };
      }
      if (url.endsWith("/series/og-sample")) {
        return { data: '<html><head>' +
          '<meta property="og:title" content="Sample Series - MultiMovies 2.0">' +
          '<meta property="og:type" content="video.tv_show">' +
          '<meta property="og:image" content="https://images.example.test/series.jpg">' +
          '<meta property="og:description" content="Series synopsis.">' +
          '</head><body></body></html>', status: 200 };
      }
      requests.push(new URL(url));
      return { data: listingPage, status: 200 };
    },
  },
};

(async () => {
  const expectedFilters = [
    "featured",
    "movies",
    "series",
    "top-imdb-movies",
    "top-imdb-series",
  ];
  for (const filter of expectedFilters) {
    assert.ok(catalog.some((item) => item.filter === filter), "catalog must expose " + filter);
  }

  const cases = [
    ["featured", "/catalog", "featured", "1"],
    ["movies", "/movies", null, null],
    ["series", "/series", null, null],
    ["top-imdb-movies", "/movies", "sort", "imdb"],
    ["top-imdb-series", "/series", "sort", "imdb"],
    ["genre/action", "/genre/action", null, null],
  ];

  for (const [filter, pathname, queryKey, queryValue] of cases) {
    requests.length = 0;
    const posts = await getPosts({ filter, page: 2, providerContext });
    assert.equal(posts.length, 1, filter + " should parse the poster card");
    assert.equal(posts[0].title, "Sample Title");
    assert.equal(posts[0].link, "https://catalog.example.test/movie/sample-title");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, pathname);
    assert.equal(requests[0].searchParams.get("page"), "2");
    if (queryKey) assert.equal(requests[0].searchParams.get(queryKey), queryValue);
    if (filter === "top-imdb-movies" || filter === "top-imdb-series") {
      assert.equal(requests[0].searchParams.get("top"), "1");
    }
  }

  requests.length = 0;
  const results = await getSearchPosts({
    searchQuery: "sample title",
    page: 3,
    providerContext,
  });
  assert.equal(results.length, 1);
  assert.equal(requests[0].pathname, "/catalog");
  assert.equal(requests[0].searchParams.get("q"), "sample title");
  assert.equal(requests[0].searchParams.get("page"), "3");

  const movieMeta = await getMeta({
    link: "https://catalog.example.test/movie/og-sample",
    providerContext,
  });
  assert.equal(movieMeta.title, "Sample Movie");
  assert.equal(movieMeta.image, "https://images.example.test/sample.jpg");
  assert.equal(movieMeta.synopsis, "Sample synopsis.");
  assert.equal(movieMeta.type, "movie");

  const seriesMeta = await getMeta({
    link: "https://catalog.example.test/series/og-sample",
    providerContext,
  });
  assert.equal(seriesMeta.title, "Sample Series");
  assert.equal(seriesMeta.type, "series");
  assert.equal(seriesMeta.linkList.length, 1);
  assert.ok(seriesMeta.linkList[0].episodesLink);

  console.log("MultiMovies catalog and Open Graph metadata regression tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
