import { Info, Link, ProviderContext } from "../types";

const headers = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Cache-Control": "no-store",
  "Accept-Language": "en-US,en;q=0.9",
  DNT: "1",
  "sec-ch-ua":
    '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
};

function extractAssignedObject(html: string, variable: string): any {
  const match = new RegExp("(?:const|let|var)\\s+" + variable + "\\s*=\\s*", "m").exec(html);
  if (!match) return null;
  const start = html.indexOf("{", match.index + match[0].length);
  if (start < 0) return null;
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { axios, cheerio } = providerContext;
  const url = link;
  const baseUrl = url.split("/").slice(0, 3).join("/");

  const emptyResult: Info = {
    title: "",
    synopsis: "",
    image: "",
    imdbId: "",
    type: "movie",
    linkList: [],
  };

  try {
    const response = await axios.get(url, {
      headers: { ...headers, Referer: baseUrl },
    });

    const $ = cheerio.load(response.data);

    const result: Info = {
      title: "",
      synopsis: "",
      image: "",
      imdbId: "",
      type: "movie",
      linkList: [],
    };

    // Parse nested inline configuration safely; a non-greedy object regex
    // truncates JSON at the first nested closing brace.
    const pageHtml = String(response.data || "");
    const watchItem = extractAssignedObject(pageHtml, "watchItem");
    const watchConfig = extractAssignedObject(pageHtml, "watchConfig");

    // Title
    result.title =
      watchItem?.title?.toString().trim() ||
      $(".cinejoy-detail-title").first().text().trim() ||
      $(".watch-details-summary").first().text().trim() ||
      "Unknown Title";

    // Poster image
    result.image =
      watchItem?.poster ||
      $(".watch-bg img").first().attr("src") ||
      $(".cinejoy-detail-poster img").first().attr("src") ||
      "";

    // Synopsis
    result.synopsis =
      $("#cinejoyOverview").first().text().trim() ||
      $(".cinejoy-detail-overview").first().text().trim() ||
      "";

    // Current pages use .episode-card; older pages used Cinejoy markup.
    // The canonical route and visible TV Series label are reliable fallbacks
    // when inline watchItem metadata is absent or has changed shape.
    const hasEpisodeCards = $(".episode-card, .cinejoy-ep-card, a[href*='/season/'][href*='/episode/']").length > 0;
    const isSeriesRoute = /\/series\//i.test(new URL(url).pathname);
    const statusText = $(".cinejoy-spec-box, .watch-details, .cinejoy-detail-stage").text();
    const hasSeriesStatus = /TV\s*Series|Series/i.test(statusText);
    const itemType = String(watchItem?.type || watchConfig?.type || "").toLowerCase();
    const hasCinejoyEpisodes = $(".cinejoy-episodes-section").length > 0;
    result.type =
      itemType === "tv" || itemType === "series" || hasCinejoyEpisodes ||
      hasEpisodeCards || isSeriesRoute || hasSeriesStatus ? "series" : "movie";

    // IMDb ID (not exposed in this HTML)
    result.imdbId = "";

    // Build linkList
    const linkList: Link[] = [];

    if (result.type === "series" || hasCinejoyEpisodes) {
      // Strip any query string and trailing slashes to get the canonical series URL
      // e.g. https://site.com/series/the-boys-1560?season=2 -> https://site.com/series/the-boys-1560
      const seriesBase = url
        .split("?")[0]
        .replace(/\/$/, "")
        .replace(/\/season\/\d+(\/episode\/\d+)?$/i, "")
        .replace(/\/episode\/\d+$/i, "");

      const seasonMap = new Map<
        string,
        { title: string; episodesLink: string }
      >();

      // Support the legacy Cinejoy dropdown and current season selectors.
      // Option values may be numeric or labels such as "Season 1".
      const seasonSelectors = [
        ".cinejoy-season-pill-dropdown select[aria-label='Season'] option",
        "select[aria-label='Season'] option",
        "select[name='season'] option",
        "#seasonSelect option",
        ".season-selector option",
      ];
      seasonSelectors.forEach((selector) => {
        $(selector).each((_, opt) => {
          const value = ($(opt).attr("value") || "").trim();
          const label = $(opt).text().replace(/\s+/g, " ").trim();
          const season = value.match(/\d+/)?.[0] || label.match(/season\s*(\d+)/i)?.[1];
          if (!season) return;
          seasonMap.set(season, {
            title: label || \`Season \${season}\`,
            episodesLink: \`\${seriesBase}?season=\${season}\`,
          });
        });
      });

      // 2) Season grids (fallback)
      $(".cinejoy-season-grid").each((_, grid) => {
        const id = $(grid).attr("id") || "";
        const m = id.match(/cinejoy-season-(\d+)/);
        if (!m) return;

        const season = m[1];
        if (seasonMap.has(season)) return;

        seasonMap.set(season, {
          title: `Season ${season}`,
          episodesLink: `${seriesBase}?season=${season}`,
        });
      });

      if (seasonMap.size > 0) {
        seasonMap.forEach((value) => {
          linkList.push({
            title: value.title,
            quality: "",
            episodesLink: value.episodesLink,
            directLinks: [],
          });
        });
      } else {
        // Infer seasons from canonical episode URLs when no season dropdown exists.
        const seasonNumbers = new Set<string>();
        $("a[href*='/season/'], [data-season]").each((_, node) => {
          const href = String($(node).attr("href") || "");
          const season = href.match(/\/season\/(\d+)/i)?.[1] ||
            String($(node).attr("data-season") || "").match(/\d+/)?.[0];
          if (season) seasonNumbers.add(season);
        });
        if (seasonNumbers.size) {
          Array.from(seasonNumbers).sort((a, b) => Number(a) - Number(b)).forEach((season) => {
            linkList.push({
              title: \`Season \${season}\`,
              quality: "",
              episodesLink: \`\${seriesBase}?season=\${season}\`,
              directLinks: [],
            });
          });
        } else {
          linkList.push({
            title: "Season 1",
            quality: "",
            episodesLink: \`\${seriesBase}?season=1\`,
            directLinks: [],
          });
        }
      }
    } else {
      // Movie / single‑link behaviour
      linkList.push({
        title: result.title,
        quality: "",
        episodesLink: url,
        directLinks: [
          {
            title: result.title,
            link: url,
            type: "movie",
          },
        ],
      });
    }

    result.linkList = linkList;

    return result;
  } catch (err) {
    console.log("getMeta error:", err);
    return emptyResult;
  }
};