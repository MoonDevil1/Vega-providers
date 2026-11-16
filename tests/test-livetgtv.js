const assert = require("node:assert/strict");
const { getPosts, getSearchPosts } = require("../dist/livetgtv/posts");
const { getMeta } = require("../dist/livetgtv/meta");
const { getStream } = require("../dist/livetgtv/stream");
const { genres, parsePlaylistDocument } = require("../dist/livetgtv/catalog");

const fixture = [
  "\uFEFF#EXTM3U url-tvg=\"https://livetgtv.lovable.app/api/public/tv-eps.xml\"",
  '#EXTINF:-1 tvg-id="free-1" tvg-name="Free News" tvg-logo="https://example.com/news.png" group-title="News",Free News',
  "#EXTVLCOPT:http-user-agent=TestPlayer/1.0",
  "#EXTVLCOPT:http-referrer=https://example.com/",
  "https://example.com/news.m3u8?token=temporary",
  "#EXTINF:-1 tvg-id='free-2' tvg-name='Public TV' group-title='Entertainment',Public TV",
  "https://example.com/public.mpd",
  '#EXTINF:-1 tvg-id="drm-1" tvg-name="Protected Channel" group-title="Sports",Protected Channel',
  "#KODIPROP:inputstream.adaptive.license_type=clearkey",
  "#KODIPROP:inputstream.adaptive.license_key=must-not-be-used",
  "https://example.com/protected.mpd",
  '#EXTINF:-1 tvg-id="cookie-1" tvg-name="Cookie Channel" group-title="News",Cookie Channel',
  '#EXTHTTP:{"cookie":"private-session","Referer":"https://example.com/watch"}',
  "https://example.com/cookie.m3u8",
  '#EXTINF:-1 tvg-id="auth-missing" tvg-name="Missing Auth" group-title="Other",Missing Auth',
  "#EXTVLCOPT:http-cookie=",
  "https://example.com/missing-auth.m3u8",
].join("\n");

const calls = [];
const providerContext = {
  axios: {
    get: async (url) => {
      calls.push(url);
      if (url === "https://livetgtv.lovable.app/api/public/playlist.m3u") {
        return { data: fixture };
      }
      if (url === "https://livetgtv.lovable.app/api/public/channels/drm-1") {
        return {
          data: {
            id: "drm-1",
            sources: ["https://cdn.example.com/protected/index.mpd?token=fresh"],
            drm: {
              type: "clearkey",
              keyId: "EB19113C11CE5CFB80C89696765A0187",
              key: "B2797CE5E403EE22D8E36C6D5F2B6630",
            },
          },
        };
      }
      throw new Error("No fixture for " + url);
    },
  },
};

(async () => {
  const parsed = parsePlaylistDocument(fixture);
  assert.equal(parsed.epgUrl, "https://livetgtv.lovable.app/api/public/tv-eps.xml");

  const liveSports = parsePlaylistDocument([
    '#EXTM3U url-tvg="https://example.com/epg.xml"',
    '#EXTINF:-1 tvg-id="" tvg-name="" group-title="Live Sports",Live Sports Match',
    "https://livetgtv.lovable.app/api/public/stream?url=https://cablecastx.com/live/index.m3u8&liveid=ls-12t5xnj&embed=1",
  ].join("\n"));
  assert.equal(liveSports.channels.length, 1, "nested LiveTGTV HLS URLs should be recognized");
  assert.equal(liveSports.channels[0].id, "liveid:ls-12t5xnj", "sports live IDs must remain unique without tvg-id");
  assert.equal(liveSports.channels[0].type, "m3u8");
  assert.match(liveSports.channels[0].url, /liveid=ls-12t5xnj/);

  const groups = await genres({ providerContext });
  assert.deepEqual(groups.map((group) => group.title), ["Entertainment", "News", "Other", "Sports"]);

  const all = await getPosts({ filter: "all", page: 1, providerContext });
  assert.equal(all.length, 5, "all supported playlist channels should be listed");
  assert.equal(all[0].title, "Free News");
  assert.equal(all[0].tag, "News");
  assert.equal(all[0].image, "https://example.com/news.png");
  assert.equal(all[2].title, "Protected Channel");
  assert.equal(all[2].cornerTag, "DRM");
  assert.equal(all[3].title, "Cookie Channel");
  assert.equal(all[3].cornerTag, "Login");

  const news = await getPosts({ filter: "group:News", page: 1, providerContext });
  assert.equal(news.length, 2);
  assert.equal(news[0].title, "Free News");
  assert.equal(news[1].title, "Cookie Channel");

  const search = await getSearchPosts({ searchQuery: "public", page: 1, providerContext });
  assert.equal(search.length, 1);
  assert.equal(search[0].title, "Public TV");
  assert.equal(search[0].tag, "Entertainment", "single-quoted M3U attributes should be parsed");

  const protectedStreams = await getStream({ link: all[2].link, type: "movie", providerContext });
  assert.equal(protectedStreams.length, 1, "ClearKey streams should now be returned to Vega");
  assert.equal(protectedStreams[0].link, "https://cdn.example.com/protected/index.mpd?token=fresh");
  assert.equal(protectedStreams[0].type, "mpd");
  assert.deepEqual(protectedStreams[0].drm, {
    type: "clearkey",
    clearKeys: {
      eb19113c11ce5cfb80c89696765a0187: "b2797ce5e403ee22d8e36c6d5f2b6630",
    },
  });
  assert.ok(calls.includes("https://livetgtv.lovable.app/api/public/channels/drm-1"));

  const missingAuth = await getStream({ link: all[4].link, type: "movie", providerContext });
  assert.equal(missingAuth.length, 0, "auth-required streams without credentials must not be returned");

  const meta = await getMeta({ link: all[0].link, providerContext });
  assert.equal(meta.title, "Free News");
  assert.equal(meta.linkList[0].directLinks[0].link, all[0].link);

  const streams = await getStream({ link: all[0].link, type: "movie", providerContext });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "m3u8");
  assert.equal(streams[0].link, "https://example.com/news.m3u8?token=temporary");
  assert.equal(streams[0].headers["User-Agent"], "TestPlayer/1.0");
  assert.equal(streams[0].headers.Referer, "https://example.com/");

  const cookieStreams = await getStream({ link: all[3].link, type: "movie", providerContext });
  assert.equal(cookieStreams.length, 1, "playlist-provided cookie credentials should be passed to playback");
  assert.equal(cookieStreams[0].headers.Cookie, "private-session");
  assert.equal(cookieStreams[0].headers.Referer, "https://example.com/watch");

  console.log("LiveTGTV playlist and DRM playback regression tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
