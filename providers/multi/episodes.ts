import { EpisodeLink, ProviderContext } from "../types";
function clean(value: string): string { return String(value || "").replace(/\s+/g, " ").trim(); }
function decodeHtml(value: string): string {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
}
function stripMarkup(value: string): string {
  return decodeHtml(String(value || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function attribute(attributes: string, name: string): string {
  const match = String(attributes || "").match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return decodeHtml(match ? match[1] || match[2] || match[3] || "" : "");
}
function resolveUrl(raw: string, baseUrl: string): string {
  const value = decodeHtml(raw).trim();
  if (!value) return "";
  try { const resolved = new URL(value, baseUrl); return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : ""; } catch { return ""; }
}
function getEpisodeNumber(episode: EpisodeLink): number {
  try { const match = new URL(episode.link).pathname.match(/\/episode\/(\d+)/i); if (match) return Number(match[1]); } catch {}
  const match = String(episode.title || "").match(/(?:episode|ep|e)\s*0*(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
function selectedSeason(html: string, inputUrl: URL): string {
  const query = inputUrl.searchParams.get("season");
  if (query && /^\d+$/.test(query)) return query;
  const path = inputUrl.pathname.match(/\/season\/(\d+)/i)?.[1];
  if (path) return path;
  const selects = /<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi;
  let select: RegExpExecArray | null;
  while ((select = selects.exec(html))) {
    if (!/^season$/i.test(attribute(select[1], "aria-label"))) continue;
    const options = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi;
    let option: RegExpExecArray | null; let first = "";
    while ((option = options.exec(select[2]))) {
      const value = attribute(option[1], "value");
      if (!first && value) first = value;
      if (/\bselected\b/i.test(option[1]) && value) return value;
    }
    if (first) return first;
  }
  return "1";
}
function episodeRanges(html: string): { values: string[]; selected: string } {
  const selects = /<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi;
  let select: RegExpExecArray | null;
  while ((select = selects.exec(html))) {
    if (attribute(select[1], "id") !== "episodeRangeSelect") continue;
    const values: string[] = []; let selected = "";
    const options = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi;
    let option: RegExpExecArray | null;
    while ((option = options.exec(select[2]))) {
      const value = attribute(option[1], "value");
      if (!/^\d+$/.test(value) || values.includes(value)) continue;
      values.push(value); if (/\bselected\b/i.test(option[1])) selected = value;
    }
    return { values, selected };
  }
  return { values: [], selected: "" };
}
/** Parse server-rendered HTML directly; no DOM/Cheerio dependency in QuickJS. */
function parseEpisodes(html: string, pageUrl: string, season: string): EpisodeLink[] {
  const found = new Map<string, { episode: EpisodeLink; score: number }>();
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(html))) {
    const attrs = match[1] || "";
    const rawHref = attribute(attrs, "href") || attribute(attrs, "data-href") || attribute(attrs, "data-url") || attribute(attrs, "data-episode-url");
    if (!rawHref || !/\/episode\//i.test(rawHref)) continue;
    const link = resolveUrl(rawHref, pageUrl); if (!link) continue;
    let episodeSeason = "";
    try { episodeSeason = new URL(link).pathname.match(/\/season\/(\d+)/i)?.[1] || ""; } catch {}
    if (season && episodeSeason && episodeSeason !== season) continue;
    const inner = match[2] || "";
    const isName = /\bcinejoy-ep-name\b/i.test(attribute(attrs, "class"));
    const img = inner.match(/<img\b([^>]*)>/i);
    const rawTitle = attribute(attrs, "title") || attribute(attrs, "aria-label") || (img ? attribute(img[1], "alt") : "") || stripMarkup(inner);
    const cardMarker = html.lastIndexOf("cinejoy-ep-card", match.index);
    const nextCard = html.indexOf("cinejoy-ep-card", match.index + match[0].length);
    const cardHtml = cardMarker >= 0 ? html.slice(Math.max(0, cardMarker - 100), nextCard >= 0 ? nextCard : Math.min(html.length, cardMarker + 9000)) : inner;
    const badgeMatch = cardHtml.match(/<span\b[^>]*class=["'][^"']*\bcinejoy-ep-badge-num\b[^"']*["'][^>]*>([\s\S]*?)<\/span\s*>/i);
    const badge = badgeMatch ? stripMarkup(badgeMatch[1]) : "";
    const title = clean(badge && rawTitle && !rawTitle.startsWith(badge) ? badge + " " + rawTitle : rawTitle || badge || "Episode");
    const current = found.get(link);
    const score = (isName ? 4 : 0) + (attribute(attrs, "title") ? 2 : 0) + (title ? 1 : 0);
    if (!current || score > current.score) found.set(link, { episode: { title, link }, score });
  }
  if (found.size) return Array.from(found.values()).map((entry) => entry.episode);
  // Legacy pages list episode headings followed by HubCloud links.
  const headings = /<h5\b[^>]*>([\s\S]*?)<\/h5\s*>/gi;
  let heading: RegExpExecArray | null;
  while ((heading = headings.exec(html))) {
    const title = stripMarkup(heading[1]); if (!title) continue;
    const start = headings.lastIndex; const nextHeading = html.indexOf("<h5", start);
    const section = html.slice(start, nextHeading >= 0 ? nextHeading : start + 5000);
    const links = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi; let anchor: RegExpExecArray | null;
    while ((anchor = links.exec(section))) {
      const attrs = anchor[1] || ""; const href = attribute(attrs, "href");
      const label = clean(stripMarkup(anchor[2]) + " " + attribute(attrs, "title") + " " + href);
      const style = attribute(attrs, "style").toLowerCase().replace(/\s+/g, "");
      if (!href || (!/hub.?cloud/i.test(label) && !style.includes("linear-gradient(135deg,#e629d0,#007bff)"))) continue;
      const link = resolveUrl(href, pageUrl);
      if (link && !found.has(link)) found.set(link, { episode: { title, link }, score: 1 });
      break;
    }
  }
  return Array.from(found.values()).map((entry) => entry.episode);
}
function buildRangeUrl(inputUrl: URL, season: string, range: string, order: string): string {
  const page = new URL(inputUrl.toString());
  page.pathname = page.pathname.replace(/\/season\/\d+\/episode\/\d+\/?$/i, "").replace(/\/episode\/\d+\/?$/i, "");
  page.search = ""; page.searchParams.set("season", season); page.searchParams.set("ep_range", range); page.searchParams.set("ep_order", order); page.hash = "episodes";
  return page.toString();
}
export const getEpisodes = async function ({ url, providerContext, signal }: { url: string; providerContext: ProviderContext; signal?: AbortSignal }): Promise<EpisodeLink[]> {
  const { axios, commonHeaders } = providerContext;
  try {
    const inputUrl = new URL(url); const baseUrl = inputUrl.origin;
    const requestHeaders = { ...commonHeaders, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", Referer: baseUrl + "/" };
    const response = await axios.get(inputUrl.toString(), { headers: requestHeaders, signal, timeout: 15000, maxRedirects: 5 });
    const initialHtml = String(response.data || "");
    const season = selectedSeason(initialHtml, inputUrl); const rangeInfo = episodeRanges(initialHtml);
    const initialRange = inputUrl.searchParams.get("ep_range") || rangeInfo.selected || rangeInfo.values[0] || "";
    const order = inputUrl.searchParams.get("ep_order") || "oldest";
    const all: EpisodeLink[] = []; const seen = new Set<string>();
    const ranges = rangeInfo.values.length ? rangeInfo.values : [initialRange];
    // Sequential range requests stay below Desktop's 16-outstanding-RPC limit.
    for (const range of ranges) {
      let html = initialHtml; let pageUrl = inputUrl.toString();
      if (range && range !== initialRange) {
        pageUrl = buildRangeUrl(inputUrl, season, range, order);
        try {
          const pageResponse = await axios.get(pageUrl, { headers: requestHeaders, signal, timeout: 15000, maxRedirects: 5 });
          html = String(pageResponse.data || "");
        } catch (error) { console.warn("[MultiMovies] episode range request failed:", pageUrl, error); continue; }
      }
      for (const episode of parseEpisodes(html, pageUrl, season)) {
        if (seen.has(episode.link)) continue; seen.add(episode.link); all.push(episode);
      }
    }
    return all.sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b));
  } catch (error) {
    console.error("[MultiMovies] getEpisodes failed:", error);
    return [];
  }
};
