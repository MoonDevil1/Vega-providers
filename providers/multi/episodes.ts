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

function parseEpisodeAnchorsFromHtml(html: string, pageUrl: string): EpisodeLink[] {
  const decode = (value: string) => String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .trim();

  const episodes: EpisodeLink[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi));

  // Read title anchors before thumbnail anchors. The thumbnail badge often
  // contains only "E1", while the adjacent name anchor has the real title.
  for (const preferredClass of ["cinejoy-ep-name", "cinejoy-ep-thumb-link", "episode-link"]) {
    for (const match of anchors) {
      const attrs = match[1] || "";
      const inner = match[2] || "";
      const className = attrs.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
      if (!new RegExp("(?:^|\\s)" + preferredClass + "(?:\\s|$)", "i").test(className)) continue;

      const rawHref = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
      const hrefText = decode(rawHref);
      if (!hrefText || !/\/season\/\d+\/episode\/\d+/i.test(hrefText)) continue;

      let href = "";
      try { href = new URL(hrefText, pageUrl).toString(); } catch { continue; }
      if (seen.has(href)) continue;

      const rawTitle =
        attrs.match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2] ||
        inner.match(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1/i)?.[2] ||
        inner.replace(/<[^>]*>/g, " ");
      const title = decode(rawTitle).replace(/\s+/g, " ").trim() || "Episode " + (episodes.length + 1);
      seen.add(href);
      episodes.push({ title, link: href });
    }
  }

  return episodes;
}

function filterEpisodesForSeason(episodes: EpisodeLink[], season: string): EpisodeLink[] {
  const selectedSeason = String(season || "").match(/\\d+/)?.[0] || "";
  if (!selectedSeason) return episodes;
  return episodes.filter((episode) => {
    try {
      const match = new URL(episode.link).pathname.match(/\\/season\\/(\\d+)\\/episode\\/\\d+/i);
      // Older download-only episode entries do not carry canonical season paths.
      // Keep those entries; filter only links that explicitly identify a season.
      return !match || match[1] === selectedSeason;
    } catch {
      return true;
    }
  });
}

function parseEpisodes(html: string, pageUrl: string, season: string, cheerio: any): EpisodeLink[] {
  const rawCardEpisodes = parseEpisodeAnchorsFromHtml(html, pageUrl);
  if (rawCardEpisodes.length) return filterEpisodesForSeason(rawCardEpisodes, season);

  const $ = cheerio.load(html);
  let grid = season ? $(`#cinejoy-season-${season}`) : $(".cinejoy-season-grid.active").first();
  if (!grid.length) grid = $(".cinejoy-season-grid.active").first();
  if (!grid.length) grid = $(".cinejoy-season-grid").first();

  const episodes: EpisodeLink[] = [];
  const seen = new Set<string>();

  // Current MultiMovies pages use .episode-card > a[href] rather than the
  // legacy .cinejoy-ep-card markup. Parse this structure explicitly first.
  $(".episode-card").each((_index: number, card: any) => {
    const el = $(card);
    const anchor = el.find("a[href*='/episode/']").first().length
      ? el.find("a[href*='/episode/']").first()
      : el.find("a[href]").first();
    const rawHref = anchor.attr("href") || "";
    if (!rawHref) return;
    let href = "";
    try { href = new URL(rawHref, pageUrl).toString(); } catch { return; }
    if (!/\/season\/\d+\/episode\/\d+/i.test(new URL(href).pathname) || seen.has(href)) return;
    const title = clean(
      anchor.attr("title") ||
      anchor.text() ||
      el.find("img").first().attr("alt") ||
      "",
    );
    if (!title) return;
    seen.add(href);
    episodes.push({ title, link: href });
  });

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

  // Last-resort parser for Desktop/QuickJS. Read href attributes directly:
  // the live site can return the right HTML while a lightweight DOM selector
  // implementation fails to expose nested episode cards consistently.
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
      if (!decodedHref || !/\/season\/\d+\/episode\/\d+/i.test(decodedHref)) return;
      let href = "";
      try { href = new URL(decodedHref, pageUrl).toString(); } catch { return; }
      if (seen.has(href)) return;
      const title = decodeHtml(rawTitle.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim() || `Episode ${episodes.length + 1}`;
      seen.add(href);
      episodes.push({ title, link: href });
    };

    // Match opening anchors independently of their closing markup. This is
    // deliberately tolerant of nested/rewritten HTML from the site.
    const anchors = /<a\b([^>]*)>/gi;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchors.exec(html))) {
      const attrs = anchorMatch[1] || "";
      const href = attrs.match(/\b(?:href|data-href|data-url|data-episode-url)\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
      const title =
        attrs.match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
      addCandidate(href, title);
    }

    const dataUrls = /<[^>]+\bdata-episode-url\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    let dataMatch: RegExpExecArray | null;
    while ((dataMatch = dataUrls.exec(html))) {
      const title = dataMatch[0].match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
      addCandidate(dataMatch[2], title);
    }
  }
  return filterEpisodesForSeason(episodes, season);
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

    // Parse the HTML returned for the selected season first. Never discard
    // these episodes just because an optional later range request fails.
    const firstPageEpisodes = parseEpisodes(
      initialHtml,
      inputUrl.toString(),
      selectedSeason,
      cheerio,
    );
    const all: EpisodeLink[] = [];
    const seen = new Set<string>();
    const addEpisodes = (batch: EpisodeLink[]) => {
      for (const episode of batch) {
        if (!episode?.link || seen.has(episode.link)) continue;
        seen.add(episode.link);
        all.push(episode);
      }
    };
    addEpisodes(firstPageEpisodes);

    // The live site paginates long seasons with #episodeRangeSelect and
    // ?season=N&ep_range=FIRST_EP&ep_order=oldest. Fetch remaining ranges
    // sequentially: Desktop's sandbox has a strict RPC budget, and one failed
    // secondary range must not turn a valid first page into an empty season.
    const ranges: string[] = [];
    $("#episodeRange option, #episodeRangeSelect option").each((_index: number, option: any) => {
      const value = clean($(option).attr("value"));
      if (/^\d+$/.test(value) && !ranges.includes(value)) ranges.push(value);
    });
    const initialRange =
      inputUrl.searchParams.get("ep_range") ||
      clean($("#episodeRange option[selected], #episodeRangeSelect option[selected]").first().attr("value")) ||
      clean($("#episodeRange, #episodeRangeSelect").first().val()) ||
      ranges[0] ||
      "";

    for (const range of ranges) {
      if (range === initialRange) continue;
      try {
        const pageUrl = buildRangeUrl(inputUrl, selectedSeason, range, order);
        const pageResponse = await axios.get(pageUrl, {
          headers: requestHeaders,
          timeout: 15000,
          maxRedirects: 5,
        });
        const rangeEpisodes = parseEpisodes(
          String(pageResponse.data || ""),
          pageUrl,
          selectedSeason,
          cheerio,
        );
        addEpisodes(rangeEpisodes);
      } catch (error) {
        console.warn("[MultiMovies] optional episode range failed; keeping episodes already parsed:", range, error);
      }
    }

    const sorted = all.sort((a, b) => getEpisodeNumber(a) - getEpisodeNumber(b));
    if (sorted.length) return sorted;

    const markers = {
      cinejoyGrid: initialHtml.includes("cinejoy-season-grid"),
      cinejoyCards: initialHtml.includes("cinejoy-ep-card"),
      episodeLinks: /\/season\/\d+\/episode\/\d+/i.test(initialHtml),
      challengePage: /cloudflare|checking your browser|verify you are human|access denied/i.test(initialHtml),
    };
    throw new Error(
      `No episodes parsed for ${inputUrl.toString()} (HTTP ${response.status || "unknown"}, HTML ${initialHtml.length} chars, markers ${JSON.stringify(markers)})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[MultiMovies] getEpisodes failed:", message);
    throw new Error(`MultiMovies episodes: ${message}`);
  }
};
