const assert = require("node:assert/strict");
const { getStream, getServers, resolveServer } = require("../dist/multi/stream.js");

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
  const discoveredServers = await getServers({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: { axios, cheerio: null },
  });
  assert.equal(discoveredServers.length, 3, "discovery must return every advertised server, including unresolved ones");
  assert.ok(discoveredServers.some((server) => server.name === "Nexus"),
    "an unresolved server must remain visible in the discovery result");
  const selectedGdStreams = await resolveServer({
    server: discoveredServers[0],
    type: "tv",
    signal: new AbortController().signal,
    providerContext: { axios, cheerio: null },
  });
  assert.ok(selectedGdStreams.some((stream) => stream.link === mediaUrl),
    "selected-server resolution must resolve only the chosen GD Mirror entry");

  assert.ok(streams.length > 0, "expected a playable stream");
  assert.ok(streams[0].server.toLowerCase().includes("gd mirror"),
    "GD Mirror must be listed first when its stream resolves");
  assert.ok(streams.some((stream) => stream.link === mediaUrl && stream.type === "m3u8"),
    "expected the current GD mirror data-link chain to resolve to HLS");
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
        if (url === "https://hanerix.com/e/demo") {
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


  // Desktop's provider bridge has a limited pending-operation budget. Keep
  // the provider's own resolver fan-out bounded so a page with many healthy
  // server buttons does not start every timeout/request simultaneously.
  const fanoutServers = Array.from({ length: 6 }, (_, index) => ({
    name: "Mirror " + index,
    url: "https://mirror" + index + ".example.test/embed",
  }));
  const fanoutHtml = '<div>' + fanoutServers.map((server, index) =>
    '<button data-id="mirror-' + index + '" data-server-index="' + index +
    '" data-url="' + server.url + '"><span class="server-name">' +
    server.name + '</span></button>'
  ).join("") + '</div>';
  let activeMirrorRequests = 0;
  let maxActiveMirrorRequests = 0;
  const fanoutContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: fanoutHtml, status: 200, headers: {} };
        if (url.indexOf("https://mirror") === 0 && url.endsWith("/embed")) {
          activeMirrorRequests++;
          maxActiveMirrorRequests = Math.max(maxActiveMirrorRequests, activeMirrorRequests);
          await new Promise((resolve) => setTimeout(resolve, 30));
          activeMirrorRequests--;
          const id = url.match(/mirror(\d+)/)[1];
          return {
            data: '<script>var source="https://cdn.example.test/mirror' + id + '.m3u8";</script>',
            status: 200,
            headers: {},
          };
        }
        throw new Error("Unexpected fan-out test URL: " + url);
      },
    },
    cheerio: null,
  };
  const fanoutStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: fanoutContext,
  });
  assert.equal(fanoutStreams.length, 6, "all healthy mirrors must still resolve");
  assert.ok(maxActiveMirrorRequests <= 1,
    "server resolvers must stay within the single-server concurrency limit");


  // Numeric movie IDs are treated as TMDB IDs and use title-specific VIDOUT endpoints.
  const vidoutMovieUrl = "https://vidout.pages.dev/movie/12345";
  const vidoutMovieHtml = '<button data-id="vidout-movie" data-server-index="0" data-url="' + vidoutMovieUrl +
    '"><span class="server-name">VIDOUT</span></button>';
  const vidoutMovieContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: vidoutMovieHtml, status: 200, headers: {} };
        if (url === "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/hls/movie/12345") {
          return { data: vidoutMediaUrl, status: 200, headers: {} };
        }
        if (url === "https://raw.githubusercontent.com/Watchout2025/api/refs/heads/main/movie/12345") {
          return { data: "", status: 200, headers: {} };
        }
        throw new Error("Unexpected VIDOUT movie URL: " + url);
      },
    },
    cheerio: null,
  };
  const vidoutMovieStreams = await getStream({
    link: episodeUrl,
    type: "movie",
    signal: new AbortController().signal,
    providerContext: vidoutMovieContext,
  });
  assert.ok(vidoutMovieStreams.some((stream) => stream.link === vidoutMediaUrl),
    "numeric TMDB movie IDs must still resolve through VIDOUT");

  // VIDOUT TV embeds are not supported by the current dedicated resolver.
  // A generic playlist found in the page must never be mislabeled as the
  // requested episode's media.
  const vidoutTvUrl = "https://vidout.pages.dev/tv/12345/1/1";
  const vidoutTvHtml = '<button data-id="vidout-tv" data-server-index="0" data-url="' + vidoutTvUrl +
    '"><span class="server-name">VIDOUT</span></button>';
  let vidoutTvFallbackRequested = false;
  const vidoutTvContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: vidoutTvHtml, status: 200, headers: {} };
        if (url === vidoutTvUrl) {
          vidoutTvFallbackRequested = true;
          return { data: '<script>var source="https://cdn.example.test/default-sample.m3u8";</script>', status: 200, headers: {} };
        }
        throw new Error("Unexpected VIDOUT TV URL: " + url);
      },
    },
    cheerio: null,
  };
  const vidoutTvStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: vidoutTvContext,
  });
  assert.equal(vidoutTvStreams.length, 0, "unsupported VIDOUT TV embeds must not produce a guessed stream");
  assert.ok(!vidoutTvFallbackRequested, "unsupported VIDOUT TV URLs must not be scraped for generic fallback playlists");

  // An IMDb tt-id is not a TMDB id. Without an explicit TMDB mapping, VIDOUT
  // must not query guessed IDs or accept a generic page playlist.
  const vidoutImdbUrl = "https://vidout.pages.dev/movie/tt1234567";
  const vidoutImdbHtml = '<button data-id="vidout-imdb" data-server-index="0" data-url="' + vidoutImdbUrl +
    '"><span class="server-name">VIDOUT</span></button>';
  let vidoutImdbLookupCount = 0;
  const vidoutImdbContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: vidoutImdbHtml, status: 200, headers: {} };
        if (url.indexOf("raw.githubusercontent.com/Watchout2025/api/") === 0) {
          vidoutImdbLookupCount++;
          return { data: "https://cdn.example.test/wrong-default.m3u8", status: 200, headers: {} };
        }
        if (url === vidoutImdbUrl) {
          return { data: '<script>var source="https://cdn.example.test/default-sample.m3u8";</script>', status: 200, headers: {} };
        }
        throw new Error("Unexpected VIDOUT IMDb URL: " + url);
      },
    },
    cheerio: null,
  };
  const vidoutImdbStreams = await getStream({
    link: episodeUrl,
    type: "movie",
    signal: new AbortController().signal,
    providerContext: vidoutImdbContext,
  });
  assert.equal(vidoutImdbStreams.length, 0, "IMDb IDs without a TMDB mapping must not resolve to a guessed media URL");
  assert.equal(vidoutImdbLookupCount, 0, "VIDOUT must not query its movie endpoint with an IMDb ID");


  // Bingr/StreamHG may use a blob video element while the actual HLS transport
  // is exposed through a relative stream_proxy.php URL in player JavaScript.
  const relayCineverseUrl = "https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=76479&s=1&e=1";
  const relayMirrorUrl = "https://bingr.example.test/proxy.php?id=abc";
  const relayUrl = "https://bingr.example.test/stream_proxy.php?url=https%3A%2F%2Fcdn.example.test%2Fmaster.m3u8&seg=direct";
  const relayContext = {
    axios: {
      async get(url) {
        if (url === episodeUrl) return { data: '<button data-url="' + relayCineverseUrl + '"><span class="server-name">Cineverse HD</span></button>', status: 200, headers: {} };
        if (url === relayCineverseUrl) return { data: '<div class="srv-item" data-url="' + relayMirrorUrl + '" data-platform="bingr" data-pname="Bingr"></div>', status: 200, headers: {} };
        if (url === relayMirrorUrl) return {
          data: '<video src="blob:https://bingr.example.test/player-id"></video><script>const stream = "/stream_proxy.php?url=https%3A%2F%2Fcdn.example.test%2Fmaster.m3u8";</script>',
          status: 200, headers: {},
        };
        throw new Error("Unexpected relay test URL: " + url);
      },
    },
    cheerio: null,
  };
  const relayStreams = await getStream({
    link: episodeUrl,
    type: "tv",
    signal: new AbortController().signal,
    providerContext: relayContext,
  });
  assert.ok(relayStreams.some((stream) => stream.link === relayUrl && stream.type === "m3u8"),
    "relative stream_proxy.php relay must be returned instead of the browser-only blob URL");

  console.log("MultiMovies playable-media-only regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
