const assert = require("node:assert/strict");
const { getStream } = require("../dist/multi/stream.js");

const episodeUrl = "https://m1.multimovies.courses/series/demo/season/1/episode/1";
const iqUrl = "https://streams.iqsmartgames.com/embed/tv/34391/1/1?key=test-key";
const evidUrl = "https://pro.iqsmartgames.com/evid/test-file";
const mirrorUrl = "https://hanerix.com/e/test-mirror";
const mediaUrl = "https://cdn.example.test/video/master.m3u8?token=fixture";

const episodeHtml = '<script>const watchConfig = ' + JSON.stringify({
  titleId: 1,
  season: 1,
  episode: 1,
  initialServers: [{ id: "gd", name: "GD mirror", type: "iframe", url: iqUrl, quality: "HD" }],
}) + ';</script>';

const iqHtml = [
  '<script>let FinalID = "34391"; let idType = "tmdbid"; let myKey = "test-key"; let season = "1"; let epname = "1";</script>',
  '<a data-link="' + evidUrl + '">Open source</a>',
].join("\n");

const evidHtml = '<ul><li class="server-item" data-link="' + mirrorUrl + '">STREAMHG</li></ul>';
const mirrorHtml = '<script>var file = "' + mediaUrl + '";</script>';

const axios = {
  async get(url) {
    if (url === episodeUrl) return { data: episodeHtml, status: 200, headers: {} };
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
  assert.ok(streams.some((stream) => stream.link === mediaUrl && stream.type === "m3u8"),
    "expected the current GD mirror data-link chain to resolve to HLS");
  console.log("MultiMovies current GD mirror fallback test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
