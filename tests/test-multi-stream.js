const assert = require("node:assert/strict");
const { getStream } = require("../dist/multi/stream.js");

const episodeUrl = "https://m1.multimovies.courses/series/demo/season/1/episode/1";
const iqUrl = "https://streams.iqsmartgames.com/embed/tv/34391/1/1?key=test-key";
const evidUrl = "https://pro.iqsmartgames.com/evid/test-file";
const mirrorUrl = "https://hanerix.com/e/test-mirror";
const mediaUrl = "https://cdn.example.test/video/master.m3u8?token=fixture";
const vidoutUrl = "https://vidout.pages.dev/movie/12345";
const nexusUrl = "https://www.moviesnexus.fun/movie/12345";
const vidoutMediaUrl = "https://cdn.example.test/video/vidout.m3u8";


const episodeHtml = '<script>const watchConfig = ' + JSON.stringify({
  titleId: 1,
  season: 1,
  episode: 1,
  // This config intentionally contains only the selected server. The full
  // rendered server grid below must still be scraped.
  initialServers: [{ id: "gd", name: "GD mirror", type: "iframe", url: iqUrl, quality: "HD" }],
}) + ';</script>' +
  '<div id="playerServerGrid">' +
  '<button class="server-chip" data-id="gd" data-server-index="0" data-url="' + iqUrl + '"><span class="server-name">GD mirror</span></button>' +
  '<button class="server-chip" data-id="vidout" data-server-index="1" data-url="' + vidoutUrl + '"><span class="server-name">VIDOUT</span></button>' +
  '<button class="server-chip" data-id="nexus" data-server-index="2" data-url="' + nexusUrl + '"><span class="server-name">Nexus</span></button>' +
  '</div>';

const iqHtml = [
  '<script>let FinalID = "34391"; let idType = "tmdbid"; let myKey = "test-key"; let season = "1"; let epname = "1";</script>',
  '<a data-link="' + evidUrl + '">Open source</a>',
].join("\n");

const evidHtml = '<ul><li class="server-item" data-link="' + mirrorUrl + '">STREAMHG</li></ul>';
const mirrorHtml = '<script>var file = "' + mediaUrl + '";</script>';

const axios = {
  async get(url) {
    if (url === episodeUrl) return { data: episodeHtml, status: 200, headers: {} };
    if (url === vidoutUrl) return { data: "<html><body>VIDOUT embed</body></html>", status: 200, headers: {} };
    if (url === nexusUrl) return { data: "<html><body>Client-rendered player</body></html>", status: 200, headers: {} };
    if (url === "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/movie/12345") {
      return { data: vidoutMediaUrl, status: 200, headers: {} };
    }
    if (url === iqUrl) return { data: iqHtml, status: 200, headers: {} };
    if (url.startsWith("https://streams.iqsmartgames.com/myseriesapi?")) {
      return { data: "{}", status: 200, headers: {} };
    }
    if (url === evidUrl) return { data: evidHtml, status: 200, headers: {} };
    if (url === mirrorUrl) return { data: mirrorHtml, status: 200, headers: {} };
    throw new Error("Unexpected test URL: " + url);
  },
};

async function main() {
  const controller = new AbortController();
  const streams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: controller.signal,
    providerContext: { axios, cheerio: null },
  });
  assert.ok(streams.length > 0, "expected a playable stream");
  assert.ok(streams[0].server.toLowerCase().includes("gd mirror"),
    "GD Mirror must be listed first when its stream resolves");
  assert.ok(streams.some((stream) => stream.link === mediaUrl && stream.type === "m3u8"),
    "expected the current GD mirror data-link chain to resolve to HLS");
  assert.ok(streams.some((stream) => stream.link === vidoutMediaUrl && stream.server.indexOf("VIDOUT") >= 0),
    "expected VIDOUT to resolve independently");
  assert.ok(!streams.some((stream) => stream.link === nexusUrl || stream.type === "iframe"),
    "unresolved iframe embeds must not be returned as playable streams");
  // Desktop may fail to resolve the GD extractor even when Mobile succeeds.
  // The original embed must remain available instead of disappearing.
  const failingContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: episodeHtml, status: 200, headers: {} };
        if (url === vidoutUrl) return { data: "<html><body>VIDOUT embed</body></html>", status: 200, headers: {} };
        if (url === "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/movie/12345") {
          return { data: vidoutMediaUrl, status: 200, headers: {} };
        }
        throw new Error("Simulated GD Mirror failure: " + url);
      },
    },
    cheerio: null,
  };
  const failedExtractionStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: failingContext,
  });
  assert.ok(
    !failedExtractionStreams.some((stream) => stream.link === iqUrl || stream.type === "iframe"),
    "failed IQST extraction must not expose an iframe as a playable stream",
  );

  // Current pages label the server "Cineverse HD", not exactly "Cineverse".
  // Its resolver needs more than the generic 12s budget to fetch the embed
  // page and resolve the StreamHG mirror.
  const cineverseUrl = "https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=76479&s=1&e=1";
  const cineverseEpisodeHtml =
    '<button data-id="cineverse" data-server-index="0" data-url="' + cineverseUrl + '">' +
    '<span class="server-name">Cineverse HD</span></button>';
  const cineverseEmbedHtml =
    '<div class="srv-item" data-url="https://hanerix.com/e/demo" data-platform="streamhg" data-pname="StreamHG" data-code="demo"></div>';
  const cineverseContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: cineverseEpisodeHtml, status: 200, headers: {} };
        if (url === cineverseUrl) {
          await new Promise((resolve) => setTimeout(resolve, 13000));
          return { data: cineverseEmbedHtml, status: 200, headers: {} };
        }
        if (url.startsWith("https://rozgarlelo.modiplay.xyz/proxy.php?")) {
          return { data: '<script>var directSrc="https://cdn.example.test/cineverse/master.m3u8";</script>', status: 200, headers: {} };
        }
        throw new Error("Unexpected Cineverse test URL: " + url);
      },
    },
    cheerio: null,
  };
  const cineverseStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: cineverseContext,
  });
  assert.ok(
    cineverseStreams.some((stream) => stream.link === "https://cdn.example.test/cineverse/master.m3u8"),
    "Cineverse HD must not be cut off by the generic 12s timeout",
  );


  // Modern Cineverse .srv-item data-url values are real mirror URLs. They must
  // be fetched directly; the legacy proxy.php flow is only for switchServer().
  const modernMirrorUrl = "https://hanerix.com/e/cineverse-modern";
  const modernMediaUrl = "https://cdn.example.test/cineverse-modern/master.m3u8";
  const modernCineverseUrl = "https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=76479&s=1&e=1";
  const modernEpisodeHtml =
    '<button data-id="cineverse" data-server-index="0" data-url="' + modernCineverseUrl + '">' +
    '<span class="server-name">Cineverse HD</span></button>';
  const modernCineverseHtml =
    '<div class="srv-item" data-url="' + modernMirrorUrl + '" data-platform="streamhg" data-code="mirror-1" data-pname="StreamHG"></div>';
  const modernMirrorHtml = '<script>var directSrc="' + modernMediaUrl + '";</script>';
  let modernMirrorRequested = false;
  let legacyProxyRequested = false;
  const modernCineverseContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: modernEpisodeHtml, status: 200, headers: {} };
        if (url === modernCineverseUrl) return { data: modernCineverseHtml, status: 200, headers: {} };
        if (url === modernMirrorUrl) {
          modernMirrorRequested = true;
          return { data: modernMirrorHtml, status: 200, headers: {} };
        }
        if (url.includes("/proxy.php?")) {
          legacyProxyRequested = true;
          throw new Error("Modern mirror must not be sent through legacy proxy.php");
        }
        throw new Error("Unexpected modern Cineverse test URL: " + url);
      },
    },
    cheerio: null,
  };
  const modernCineverseStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: modernCineverseContext,
  });
  assert.ok(modernMirrorRequested, "modern Cineverse data-url mirror must be requested directly");
  assert.ok(!legacyProxyRequested, "modern Cineverse mirrors must not be rebuilt as legacy proxy.php URLs");
  assert.ok(
    modernCineverseStreams.some((stream) => stream.link === modernMediaUrl && stream.type === "m3u8"),
    "modern Cineverse StreamHG mirror must resolve to its playable HLS URL",
  );

  console.log("MultiMovies playable-media-only regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
