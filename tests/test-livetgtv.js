const assert = require("node:assert/strict");
const { getPosts, getSearchPosts } = require("../dist/livetgtv/posts");
const { getMeta } = require("../dist/livetgtv/meta");
const { getStream } = require("../dist/livetgtv/stream");

const fixture = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="free-1" tvg-name="Free News" tvg-logo="https://example.com/news.png" group-title="News",Free News',
  '#EXTVLCOPT:http-user-agent=TestPlayer/1.0',
  'https://example.com/news.m3u8?token=temporary',
  '#EXTINF:-1 tvg-id="free-2" tvg-name="Public TV" group-title="Entertainment",Public TV',
  'https://example.com/public.mpd',
  '#EXTINF:-1 tvg-id="drm-1" tvg-name="Protected Channel" group-title="Sports",Protected Channel',
  '#KODIPROP:inputstream.adaptive.license_type=clearkey',
  '#KODIPROP:inputstream.adaptive.license_key=must-not-be-used',
  'https://example.com/protected.mpd',
  '#EXTINF:-1 tvg-id="cookie-1" tvg-name="Cookie Channel" group-title="News",Cookie Channel',
  '#EXTHTTP:{"cookie":"private-session"}',
  'https://example.com/cookie.m3u8',
].join("\n");

const providerContext = {
  axios: {
    get: async () => ({ data: fixture }),
  },
};

(async () => {
  const all = await getPosts({ filter: "all", page: 1, providerContext });
  assert.equal(all.length, 2, "only non-DRM, non-cookie streams should be listed");
  assert.equal(all[0].title, "Free News");
  assert.equal(all[0].tag, "News");
  assert.equal(all[0].image, "https://example.com/news.png");

  const news = await getPosts({ filter: "group:News", page: 1, providerContext });
  assert.equal(news.length, 1);
  assert.equal(news[0].title, "Free News");

  const search = await getSearchPosts({
    searchQuery: "public",
    page: 1,
    providerContext,
  });
  assert.equal(search.length, 1);
  assert.equal(search[0].title, "Public TV");

  const meta = await getMeta({ link: all[0].link, providerContext });
  assert.equal(meta.title, "Free News");
  assert.equal(meta.linkList[0].directLinks[0].link, all[0].link);

  const streams = await getStream({
    link: all[0].link,
    type: "movie",
    providerContext,
  });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "m3u8");
  assert.equal(streams[0].link, "https://example.com/news.m3u8?token=temporary");
  assert.equal(streams[0].headers["User-Agent"], "TestPlayer/1.0");

  console.log("LiveTGTV M3U regression tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
