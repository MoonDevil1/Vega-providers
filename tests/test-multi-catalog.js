const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { catalog } = require("../dist/multi/catalog.js");
const { getPosts, getSearchPosts } = require("../dist/multi/posts.js");

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

  console.log("MultiMovies catalog regression tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
