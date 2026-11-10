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
  assert.equal(all.length, 4, "all playlist channels should be listed, including protected entries");
  assert.equal(all[0].title, "Free News");
  assert.equal(all[0].tag, "News");
  assert.equal(all[0].image, "https://example.com/news.png");
  assert.equal(all[2].title, "Protected Channel");
  assert.equal(all[2].cornerTag, "DRM");
  assert.equal(all[3].title, "Cookie Channel");
  assert.equal(all[3].cornerTag, "Login");

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

  const protectedStreams = await getStream({
    link: all[2].link,
    type: "movie",
    providerContext,
  });
  assert.equal(protectedStreams.length, 0, "DRM entries remain listed but are not played without player/license support");

  const cookieStreams = await getStream({
    link: all[3].link,
    type: "movie",
    providerContext,
  });
  assert.equal(cookieStreams.length, 0, "cookie-auth entries remain listed but are not played without secure auth support");

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
