import { Post, ProviderContext } from "../types";

const STREAMS_URL = "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u";
const CACHE_KEY = "iptv-org-in-hindi-v6";
const CACHE_TTL = 5 * 60 * 1000;

const CATEGORY_IDS: Record<string, Set<string>> = {
  movies: new Set(["b4umovies.in", "goldmines.in", "goldmines2.in", "goldminesaction.in", "goldminesbollywood.in", "goldminesmovies.in", "zeecinema.in", "colorscineplex.in"]),
  kids: new Set(["wowkidz.in", "epickids.in", "nickelodeon.in", "superhungama.in", "sonyyay.in", "disneychannel.in", "hungamatv.in", "disneyjunior.in", "pogo.in", "cartoonnetwork.in", "cartoonnetworkhdplus.in", "discoverykids.in", "greengoldtv.in"]),
  serials: new Set(["dangaltv.in", "dangal2.in", "ddnational.in", "epictv.in", "pasandtv.in", "shemarooumang.in", "sonyentertainmenttelevision.in", "colors.in", "sonysab.in", "anmoltv.in"]),
};

const LOGOS: Record<string, string> = {
  "anmoltv.in": "https://dvdh7g0f0hwck.cloudfront.net/assets/images/channel/AnmolTV_Transparent_6e1b4782-0685-4ccd-bac0-436a0c0ea947.png",
  "b4umovies.in": "https://dtil.tmsimg.com/assets/s140063_ld_h9_aa.png?lock=720x540",
  "cartoonnetwork.in": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Cartoon_Network_2010_logo.svg/960px-Cartoon_Network_2010_logo.svg.png",
  "cartoonnetworkhdplus.in": "https://xstreamcp-assets-msp.streamready.in/assets/LIVETV/LIVECHANNEL/LIVETV_LIVETVCHANNEL_CARTOON_NETWORK_HDSYMPLUS/images/LOGO_HD/image.png",
  "colors.in": "https://dvdh7g0f0hwck.cloudfront.net/assets/images/channel/Colors_Transparent_16069908-8494-4eb4-bd40-5afca3969088.png",
  "colorscineplex.in": "https://img10.hotstar.com/image/upload/f_auto/sources/r1/cms/prod/3042/1782291173042-h.jpg",
  "dangal2.in": "https://i.imgur.com/BEr1r7L.png",
  "dangaltv.in": "https://dtil.tmsimg.com/assets/s142771_ld_h9_aa.png?lock=720x540",
  "ddnational.in": "https://dtil.tmsimg.com/assets/s158252_ld_h9_aa.png?lock=720x540",
  "discoverykids.in": "https://ltsk-cdn.s3.eu-west-1.amazonaws.com/jumpstart/Temp_Live/cdn/HLS/Channel/transparentImages/Discovery%20Kids.png",
  "disneychannel.in": "https://upload.wikimedia.org/wikipedia/commons/f/ff/2024_Disney_Channel_text_logo.svg",
  "disneyjunior.in": "https://xstreamcp-assets-msp.streamready.in/assets/LIVETV/LIVECHANNEL/LIVETV_LIVETVCHANNEL_DISNEY_JUNIOR/images/LOGO_HD/image.png",
  "epickids.in": "https://upload.wikimedia.org/wikipedia/en/1/19/Epic-Kids.png",
  "epictv.in": "https://ltsk-cdn.s3.eu-west-1.amazonaws.com/jumpstart/Temp_Live/cdn/HLS/Channel/transparentImages/Epic-LOGO_2000_X_1125_transpharent.png",
  "goldmines.in": "https://dtil.tmsimg.com/assets/s143087_ld_h15_aa.png?lock=720x540",
  "goldmines2.in": "https://upload.wikimedia.org/wikipedia/commons/7/7b/Goldmines_logo.png",
  "goldminesaction.in": "https://yt3.googleusercontent.com/_X6U6bMLF-pTu5wBMFwsSI6aubGrXk2B0kUKdGiLIMqFLyDIne4Ot4ro76BS1S8fX3pWcCwS=s900-c-k-c0x00ffffff-no-rj",
  "goldminesbollywood.in": "https://i.imgur.com/6mNQ9mM.png",
  "goldminesmovies.in": "https://dvdh7g0f0hwck.cloudfront.net/assets/images/channel/GoldminesMovies_Transparent_9b7db248-999e-4200-a459-6cc594650f3d.png",
  "greengoldtv.in": "https://i.ibb.co/TDPsPVkT/Greengoldtv.png",
  "hungamatv.in": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Hungama_TV.svg/960px-Hungama_TV.svg.png",
  "nickelodeon.in": "https://img10.hotstar.com/image/upload/f_auto/sources/r1/cms/prod/6807/1784039246807-h.jpg",
  "pasandtv.in": "https://ltsk-cdn.s3.eu-west-1.amazonaws.com/jumpstart/Temp_Live/cdn/HLS/Channel/transparentImages/Pasand-Logo--transparent.png",
  "pogo.in": "https://ltsk-cdn.s3.eu-west-1.amazonaws.com/jumpstart/Temp_Live/cdn/HLS/Channel/transparentImages/Pogo.png",
  "shemarooumang.in": "https://dtil.tmsimg.com/assets/s143779_ld_h15_aa.png?lock=720x540",
  "sonyentertainmenttelevision.in": "https://dtil.tmsimg.com/assets/s157589_ld_h15_aa.png?lock=720x540",
  "sonysab.in": "https://dtil.tmsimg.com/assets/s159125_ld_h15_aa.png?lock=720x540",
  "sonyyay.in": "https://dtil.tmsimg.com/assets/s159100_ld_h15_aa.png?lock=720x540",
  "superhungama.in": "https://plain-apac-prod-public.komododecks.com/202609/07/lNjbGo0Rcgz3vhfoyTN7/image.png",
  "wowkidz.in": "https://d229kpbsb5jevy.cloudfront.net/yupptvnew/content/common/channel/logos/mjvezt.png",
  "zeecinema.in": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Zee_Cinema_2025.svg/960px-Zee_Cinema_2025.svg.png",
};

type ChannelEntry = { id: string; feed: string; name: string; logo: string; url: string; headers: Record<string, string> };

function attr(line: string, key: string): string {
  const match = line.match(new RegExp("(?:^|\\s)" + key + "=(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return match ? String(match[1] || match[2] || "").trim() : "";
}
function canonicalId(id: string): string { return String(id || "").trim().split("@")[0].toLowerCase(); }
function parseHeaderOptions(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    if (line.startsWith("#EXTVLCOPT:")) {
      const option = line.slice("#EXTVLCOPT:".length);
      const split = option.indexOf("=");
      if (split < 1) continue;
      const key = option.slice(0, split).toLowerCase();
      const value = option.slice(split + 1).replace(/^#EXTVLCOPT:[^=]+=+/i, "").trim();
      if (!value) continue;
      if (key === "http-user-agent") headers["User-Agent"] = value;
      else if (key === "http-referrer" || key === "http-referer") headers["Referer"] = value;
      else if (key === "http-origin") headers["Origin"] = value;
      else if (key === "http-cookie") headers["Cookie"] = value;
    } else if (line.startsWith("#EXTHTTP:")) {
      try {
        const parsed = JSON.parse(line.slice("#EXTHTTP:".length));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) if (typeof value === "string" && value.trim()) headers[key] = value;
        }
      } catch {}
    }
  }
  return headers;
}
function parsePlaylist(text: string): ChannelEntry[] {
  const entries: ChannelEntry[] = [];
  const seenUrls = new Set<string>();
  const regionalFeeds = new Set(["tamil", "telugu", "kannada", "malayalam", "marathi", "bangla", "bengali", "gujarati", "punjabi", "bhojpuri", "odia", "assamese", "nepali"]);
  let infoLine = "";
  let optionLines: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) { infoLine = line; optionLines = []; continue; }
    if (line.startsWith("#EXTVLCOPT:") || line.startsWith("#EXTHTTP:")) { if (infoLine) optionLines.push(line); continue; }
    if (line.startsWith("#") || !/^https?:\/\//i.test(line) || !infoLine) continue;

    const comma = infoLine.lastIndexOf(",");
    const playlistName = (comma >= 0 ? infoLine.slice(comma + 1) : "").trim();
    const rawId = attr(infoLine, "tvg-id");
    const id = canonicalId(rawId);
    const feed = String(rawId.split("@")[1] || "").toLowerCase();
    const rawName = attr(infoLine, "tvg-name") || playlistName;
    const name = String(rawName).replace(/\s*\[[^\]]*(?:geo-blocked|not 24\/7)[^\]]*\]/ig, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+\d{3,4}p$/i, "").trim();
    const url = line;
    const headers = parseHeaderOptions(optionLines);
    const blocked = /\[(?:geo-blocked|not 24\/7)\]/i.test(infoLine);
    const regionExcluded = regionalFeeds.has(feed);
    if (id && name && !blocked && !regionExcluded && CATEGORY_IDS_LOOKUP.has(id) && !seenUrls.has(id + "|" + url)) {
      entries.push({ id, feed, name, logo: attr(infoLine, "tvg-logo") || LOGOS[id] || "", url, headers });
      seenUrls.add(id + "|" + url);
    }
    infoLine = "";
    optionLines = [];
  }
  return entries;
}
const CATEGORY_IDS_LOOKUP = new Set(Object.values(CATEGORY_IDS).flatMap((ids) => Array.from(ids)));

async function loadEntries(providerContext: ProviderContext): Promise<ChannelEntry[]> {
  const { axios, kvStore, commonHeaders = {} } = providerContext;
  try {
    const cached = await kvStore.get<{ savedAt: number; entries: ChannelEntry[] }>(CACHE_KEY);
    if (cached && Date.now() - cached.savedAt < CACHE_TTL && Array.isArray(cached.entries) && cached.entries.length) return cached.entries;
  } catch {}
  const response = await axios.get(STREAMS_URL, { headers: { ...commonHeaders, Accept: "text/plain,*/*", "User-Agent": commonHeaders["User-Agent"] || "Mozilla/5.0 Vega-IPTV/1.4" }, timeout: 30000, responseType: "text" });
  const playlist = String(response.data || "");
  if (!playlist.trim().startsWith("#EXTM3U")) throw new Error("IPTV source did not return an M3U playlist");
  const entries = parsePlaylist(playlist);
  if (!entries.length) throw new Error("No curated Hindi movie, kids, or serial channels were found in the India playlist");
  try { await kvStore.set(CACHE_KEY, { savedAt: Date.now(), entries }); } catch {}
  return entries;
}
function encodeStreamUrl(url: string, headers: Record<string, string>): string {
  return Object.keys(headers).length ? url + "#vega_headers=" + encodeURIComponent(JSON.stringify(headers)) : url;
}
function toPost(entry: ChannelEntry): Post {
  const stream = encodeStreamUrl(entry.url, entry.headers);
  return { title: entry.name, link: "iptv://channel/" + encodeURIComponent(entry.id) + "?stream=" + encodeURIComponent(stream), image: entry.logo, provider: "iptv", tag: "LIVE", cornerTag: "LIVE" };
}
export const getPosts = async function ({ filter, providerContext }: { filter: string; page?: number; providerValue?: string; signal?: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  const allowed = CATEGORY_IDS[String(filter || "").toLowerCase()];
  if (!allowed) return [];
  const entries = await loadEntries(providerContext);
  const seen = new Set<string>();
  return entries.filter((entry) => { if (!allowed.has(entry.id) || seen.has(entry.id)) return false; seen.add(entry.id); return true; }).map(toPost);
};
export const getSearchPosts = async function ({ searchQuery, providerContext }: { searchQuery: string; page?: number; providerValue?: string; signal?: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> {
  const query = String(searchQuery || "").trim().toLowerCase();
  if (!query) return [];
  const entries = await loadEntries(providerContext);
  const seen = new Set<string>();
  return entries.filter((entry) => CATEGORY_IDS_LOOKUP.has(entry.id) && entry.name.toLowerCase().includes(query))
    .filter((entry) => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; }).map(toPost);
};
