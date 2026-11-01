import { EpisodeLink, ProviderContext } from "../types";

function clean(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getEpisodeNumber(episode: EpisodeLink): number {
  try {
    const match = new URL(episode.link).pathname.match(/\/episode\/(\d+)/i);
    if (match) return Number(match[1]);
  } catch {}
  const match = String(episode.title || "").match(/(?:episode|ep|e)\s*0*(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function parseEpisodes(html: string, pageUrl: string, season: string, cheerio: any): EpisodeLink[] {
  const $ = cheerio.load(html);
  let grid = season ? $(`#cinejoy-season-${season}`) : $(".cinejoy-season-grid.active").first();
  if (!grid.length) grid = $(".cinejoy-season-grid.active").first();
  if (!grid.length) grid = $(".cinejoy-season-grid").first();

  const episodes: EpisodeLink[] = [];
  const seen = new Set<string>();
  grid.find(".cinejoy-ep-card").each((_index: number, card: any) => {
    const el = $(card);
    const anchor = el.find("a.cinejoy-ep-thumb-link").first();
    const rawHref = anchor.attr("href") || el.find("a.cinejoy-ep-name").first().attr("href") || "";
    if (!rawHref) return;

    let href = "";
    try { href = new URL(rawHref, pageUrl).toString(); } catch { return; }
    if (seen.has(href)) return;

    const number = clean(el.find(".cinejoy-ep-badge-num").first().text());
    const name = clean(
      el.find(".cinejoy-ep-name").first().text() ||
      el.find(".cinejoy-ep-name").first().attr("title") ||
      anchor.attr("title") ||
      el.find("img").first().attr("alt") ||
      "",
    );
    const title = [number, name].filter(Boolean).join(" ").trim() || `Episode ${episodes.length + 1}`;
    seen.add(href);
    episodes.push({ title, link: href });
  });

  // Desktop runs providers in QuickJS, where keeping the scraper's DOM
  // assumptions narrow can turn a valid page into an empty episode list.
  // Fall back to any episode URL exposed by the selected page, including
  // lazy-loaded data attributes used by alternate layouts.
  if (!episodes.length) {
    $("a[href*='/episode/'], a[data-href*='/episode/'], a[data-url*='/episode/'], [data-episode-url]").each((_index: number, node: any) => {
      const anchor = $(node);
      const rawHref =
        anchor.attr("href") ||
        anchor.attr("data-href") ||
        anchor.attr("data-url") ||
        anchor.attr("data-episode-url") ||
        anchor.find("a[href]").first().attr("href") ||
        "";
      let href = "";
      try { href = new URL(rawHref, pageUrl).toString(); } catch { return; }
      if (!href || seen.has(href)) return;
      const title = clean(
        anchor.find(".cinejoy-ep-name").first().text() ||
        anchor.attr("title") ||
        anchor.text() ||
        anchor.find("img").first().attr("alt") ||
        anchor.closest(".cinejoy-ep-card, article, li").text() ||
        "",
      );
      if (!title) return;
      seen.add(href);
      episodes.push({ title, link: href });
    });
  }

  // Match the official provider's legacy episode-list fallback.
  // Some MultiMovies pages expose episode titles as h5 + HubCloud buttons
  // instead of Cinejoy episode cards or /episode/ anchors.
  if (!episodes.length) {
    $(".entry-content, .entry-inner, .download-links-div").find("h5").each((_index: number, element: any) => {
      const heading = $(element);
      const title = clean(heading.text());
      if (!title) return;

      const button = heading.next(".downloads-btns-div").find("a[href]").filter((_buttonIndex: number, node: any) => {
        const anchor = $(node);
        const style = String(anchor.attr("style") || "").toLowerCase().replace(/\s+/g, "");
        const label = clean(anchor.text() + " " + (anchor.attr("title") || "") + " " + (anchor.attr("href") || ""));
        return /hub.?cloud/i.test(label) || style.includes("linear-gradient(135deg,#e629d0,#007bff)");
      }).first();

      const rawHref = button.attr("href") || "";
      if (!rawHref) return;

      let href = "";
      try { href = new URL(rawHref, pageUrl).toString(); } catch { return; }
      if (seen.has(href)) return;

      seen.add(href);
      episodes.push({ title, link: href });
    });
  }

  // Last-resort parser for QuickJS/desktop builds where the HTML parser may
  // not expose the same selector tree as the mobile runtime. Read episode URLs
  // directly from anchor attributes instead of depending on a particular card
  // class or nested DOM structure.
  if (!episodes.length) {
    const decodeHtml = (value: string) =>
      String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/&#x2f;/gi, "/")
        .replace(/&#47;/g, "/")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .trim();
    const addCandidate = (rawHref: string, rawTitle: string) => {
      const decodedHref = decodeHtml(rawHref);
      if (!decodedHref || !/\/episode\//i.test(decodedHref)) return;
      let href = "";
      try { href = new URL(decodedHref, pageUrl).toString(); } catch { return; }
      if (seen.has(href)) return;
      const title = decodeHtml(rawTitle.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim() || `Episode ${episodes.length + 1}`;
      seen.add(href);
      episodes.push({ title, link: href });
    };

    const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchors.exec(html))) {
      const attrs = anchorMatch[1] || "";
      const href =
        attrs.match(/\b(?:href|data-href|data-url|data-episode-url)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const title =
        attrs.match(/\b(?:title|aria-label)\s*=\s*["']([^"']+)["']/i)?.[1] ||
        anchorMatch[2] ||
        "";
      addCandidate(href, title);
    }

    // Some themes attach the episode URL to a non-anchor card element.
    const dataUrls = /<[^>]+\bdata-episode-url\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let dataMatch: RegExpExecArray | null;
    while ((dataMatch = dataUrls.exec(html))) {
      const title =
        dataMatch[0].match(/\b(?:title|aria-label)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      addCandidate(dataMatch[1], title);
    }
  }

  return episodes;
}

function buildRangeUrl(inputUrl: URL, season: string, range: string, order: string): string {
  const page = new URL(inputUrl.toString());
  page.pathname = page.pathname
    .replace(/\/season\/\d+\/episode\/\d+\/?$/i, "")
    .replace(/\/episode\/\d+\/?$/i, "");
  page.search = "";
  page.searchParams.set("season", season);
  page.searchParams.set("ep_range", range);
  page.searchParams.set("ep_order", order);
  page.hash = "episodes";
  return page.toString();
}

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  const { axios, cheerio, commonHeaders: headers } = providerContext;

  try {
    const inputUrl = new URL(url);
    const baseUrl = inputUrl.origin;
    // Preserve the platform-specific headers supplied by Vega, as the
    // official provider does. Do not force a desktop User-Agent on mobile.
    const requestHeaders = {
      ...headers,
      Referer: baseUrl,
    };
    const response = await axios.get(inputUrl.toString(), {
      headers: requestHeaders,
      timeout: 15000,
      maxRedirects: 5,
    });
    const initialHtml = String(response.data || "");
    const $ = cheerio.load(initialHtml);

    const seasonFromPath = inputUrl.pathname.match(/\/season\/(\d+)/i)?.[1];
    const selectedSeason = clean(
      inputUrl.searchParams.get("season") ||
      seasonFromPath ||
      $(".cinejoy-season-pill-dropdown select[aria-label='Season'] option[selected]").first().attr("value") ||
      $(".cinejoy-season-pill-dropdown select[aria-label='Season']").first().val() ||
      "1",
    );
    const order = inputUrl.searchParams.get("ep_order") || "oldest";

    // The live site paginates long seasons with #episodeRangeSelect and
    // ?season=N&ep_range=FIRST_EP&ep_order=oldest. Fetch each range so Vega
    // receives one complete season list rather than only the visible batch.
    const ranges: string[] = [];
    $("#episodeRangeSelect option").each((_index: number, option: any) => {
      const value = clean($(option).attr("value"));
      if (/^\d+$/.test(value) && !ranges.includes(value)) ranges.push(value);
    });

    const initialRange =
      inputUrl.searchParams.get("ep_range") ||
      clean($("#episodeRangeSelect option[selected]").first().attr("value")) ||
      clean($("#episodeRangeSelect").first().val()) ||
      ranges[0] ||
      "";

    if (!ranges.length) {
      return parseEpisodes(initialHtml, inputUrl.toString(), selectedSeason, cheerio)
        .sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b));
    }

    const all: EpisodeLink[] = [];
    const seen = new Set<string>();

    // Vega Desktop's isolated provider runtime limits concurrent host RPC
    // requests. Fetch range pages in small batches instead of firing every
    // range at once (long seasons can expose more than 16 ranges).
    const rangeConcurrency = 4;
    for (let start = 0; start < ranges.length; start += rangeConcurrency) {
      const rangeBatch = ranges.slice(start, start + rangeConcurrency);
      const pageJobs = rangeBatch.map(async (range) => {
        if (range === initialRange) {
          return parseEpisodes(initialHtml, inputUrl.toString(), selectedSeason, cheerio);
        }
        const pageUrl = buildRangeUrl(inputUrl, selectedSeason, range, order);
        try {
          const pageResponse = await axios.get(pageUrl, {
            headers: requestHeaders,
            timeout: 15000,
            maxRedirects: 5,
          });
          return parseEpisodes(String(pageResponse.data || ""), pageUrl, selectedSeason, cheerio);
        } catch (error) {
          console.warn("[MultiMovies] episode range request failed:", pageUrl, error);
          return [];
        }
      });

      const batches = await Promise.all(pageJobs);
      for (const batch of batches) {
        for (const episode of batch) {
          if (seen.has(episode.link)) continue;
          seen.add(episode.link);
          all.push(episode);
        }
      }
    }

    return all.sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b));
  } catch (error) {
    console.warn("[MultiMovies] getEpisodes failed:", error);
    return [];
  }
};
