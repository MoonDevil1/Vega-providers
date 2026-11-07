
import { Post, ProviderContext } from "../types";
import { getBaseUrl } from "../getBaseUrl";
import { throwProviderError } from "../providerErrors";

// ─── Headers (mobile browser) ──────────────────────────────────────────
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
};

// ─── Helpers ────────────────────────────────────────────────────────────
function resolveUrl(href: string | undefined, baseUrl: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return "";
  }
}

function getPosterSrc(imgElement: any): string {
  if (!imgElement || !imgElement.length) return "";
  const src =
    imgElement.attr("src") ||
    imgElement.attr("data-src") ||
    imgElement.attr("data-lazy-src") ||
    "";
  return String(src).trim();
}

function isContentLink(link: string): boolean {
  if (!link) return false;
  if (link.includes("#")) return false;
  if (link.includes("/genre/")) return false;
  if (link.includes("/category/")) return false;
  if (link.includes("/tag/")) return false;
  if (link.includes("/provider/")) return false;
  if (link.includes("/collection/")) return false;
  if (link.includes("/watchlist")) return false;
  if (link.includes("/contact")) return false;
  if (link.includes("/dmca")) return false;
  if (link.includes("/privacy")) return false;
  return true;
}

function normaliseTitle(t: string): string {
  return String(t || "").replace(/\s+/g, " ").replace("Download", "").trim();
}

function normaliseContentLink(link: string): string {
  try {
    const url = new URL(link);
    url.hash = "";
    // Ignore tracking parameters, but preserve meaningful parameters such as season/episode.
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_.+|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return link.trim();
  }
}

// =====================================================================
//  getPosts (catalog / browse)
// =====================================================================
export async function getPosts({
  filter,
  page = 1,
  signal,
  providerValue,
  providerContext,
}: {
  filter?: string;
  page?: number;
  signal?: AbortSignal;
  providerValue?: string;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const { axios, cheerio } = providerContext;

  
  const baseUrl = (await getBaseUrl("multi", axios, cheerio)).replace(/\/+$/, "");

  const route = (filter || "featured").replace(/^\/+/, "").replace(/\/+$/, "");
  const urlObject = new URL(`${baseUrl}/catalog`);

  // These routes match the current MultiMovies site instead of mapping
  // every catalog category to a generic genre query.
  if (route === "latest-movies") {
    urlObject.searchParams.set("type", "movie");
    urlObject.searchParams.set("sort", "latest");
  } else if (route === "latest-series") {
    urlObject.searchParams.set("type", "tv");
    urlObject.searchParams.set("sort", "latest");
  } else if (route === "most-watched") {
    urlObject.searchParams.set("sort", "views");
  } else if (route === "top-rated") {
    urlObject.searchParams.set("sort", "rating");
  } else if (route === "featured") {
    urlObject.searchParams.set("featured", "1");
  } else if (route === "movies") {
    urlObject.pathname = "/movies";
  } else if (route === "series") {
    urlObject.pathname = "/series";
  } else if (route === "top-imdb-movies") {
    urlObject.pathname = "/movies";
    urlObject.searchParams.set("sort", "imdb");
    urlObject.searchParams.set("top", "1");
  } else if (route === "top-imdb-series") {
    urlObject.pathname = "/series";
    urlObject.searchParams.set("sort", "imdb");
    urlObject.searchParams.set("top", "1");
  } else if (route.startsWith("genre/")) {
    urlObject.pathname = "/" + route;
  } else if (route === "trending") {
    urlObject.pathname = "/trending";
  } else {
    urlObject.pathname = "/" + route.replace(/^\/+/, "");
  }
  urlObject.searchParams.set("page", String(Math.max(1, page)));
  const url = urlObject.href;
  console.log(`[MultiMovies] Fetching: ${url}`);

  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, Referer: baseUrl },
      signal,
      timeout: 15000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(res.data);
    const posts: Post[] = [];
    
    // The /episodes listing uses .episode-preview anchors instead of poster cards.
    // Parse it explicitly so Desktop does not stay on empty poster skeletons.
    if (route === "episodes") {
      $("a.episode-preview[href*='/season/'][href*='/episode/']").each((_i: number, node: any) => {
        const card = $(node);
        const rawHref = String(card.attr("href") || "").trim();
        if (!rawHref) return;
        const link = resolveUrl(rawHref, baseUrl);
        if (!link || posts.some((post) => normaliseContentLink(post.link) === normaliseContentLink(link))) return;
        const showTitle = normaliseTitle(card.find("h3").first().text());
        const episodeNumber = card.find("span").first().text().replace(/\s+/g, " ").trim();
        const episodeTitle = normaliseTitle(card.find("p").first().text());
        const title = [showTitle, episodeNumber, episodeTitle].filter(Boolean).join(" - ");
        const image = resolveUrl(getPosterSrc(card.find("img").first()), baseUrl);
        if (title) posts.push({ title, link, image });
      });
    }

    // ── Primary: poster-card grid ──
    $("article.poster-card").each((_: number, element: any) => {
      const card = $(element);
      const linkA = card.find("a.poster-art").first();
      const captionA = card.find(".poster-caption a").first();

      const rawHref = linkA.attr("href") || captionA.attr("href");
      if (!rawHref || !isContentLink(rawHref)) return;

      const link = resolveUrl(rawHref, baseUrl);
      if (!link || posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;

      const img = card.find("img").first();
      const title = normaliseTitle(
        captionA.text() || img.attr("alt") || "",
      );
      if (!title) return;

      const image = resolveUrl(getPosterSrc(img), baseUrl);
      posts.push({ title, link, image });
    });

    // ── Fallback 1: hero slides ──
    if (posts.length === 0) {
      console.log("[MultiMovies] No poster-card found, trying hero slides...");
      $("article.cinema-slide").each((_: number, element: any) => {
        const slide = $(element);
        const linkA = slide.find("a.button-light, a.button-glass").first();
        const rawHref = linkA.attr("href");
        if (!rawHref || !isContentLink(rawHref)) return;

        const link = resolveUrl(rawHref, baseUrl);
        if (!link || posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;

        const img = slide.find("img.cinema-backdrop").first();
        const title = normaliseTitle(
          slide.find("h1").first().text() || img.attr("alt") || "",
        );
        if (!title) return;

        const image = resolveUrl(getPosterSrc(img), baseUrl);
        posts.push({ title, link, image });
      });
    }

    // ── Fallback 2: generic selector ──
    if (posts.length === 0) {
      console.log("[MultiMovies] Trying generic fallback selector...");
      $("article, .poster-card, .item").each((_: number, element: any) => {
        const card = $(element);
        const rawHref = card.find("a[href]").first().attr("href");
        if (!rawHref || !isContentLink(rawHref)) return;

        const link = resolveUrl(rawHref, baseUrl);
        if (!link || posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;

        const img = card.find("img").first();
        const title = normaliseTitle(
          card.find("h1, h2, h3, .poster-caption a").first().text() ||
            img.attr("alt") ||
            "",
        );
        if (!title) return;

        const image = resolveUrl(getPosterSrc(img), baseUrl);
        posts.push({ title, link, image });
      });
    }

    if (posts.length === 0) {
      $("a[href*='/movie/'], a[href*='/series/']").each((_i: number, node: any) => {
        const anchor = $(node);
        const rawHref = String(anchor.attr("href") || "");
        const link = resolveUrl(rawHref, baseUrl);
        if (!rawHref || !link || !/\/(movie|series)\//i.test(new URL(link).pathname)) return;
        if (posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;
        const card = anchor.closest("article, li, .item, .card, .poster, div");
        const img = anchor.find("img").first().length ? anchor.find("img").first() : card.find("img").first();
        const title = normaliseTitle(anchor.attr("title") || anchor.text() || img.attr("alt") || "");
        if (title) posts.push({ title, link, image: resolveUrl(getPosterSrc(img), baseUrl) });
      });
    }
    if (posts.length === 0) {
      const fallback = new URL(urlObject.href);
      try {
        const retry = await axios.get(fallback.href, { headers: { ...HEADERS, Referer: baseUrl }, signal, timeout: 12000, maxRedirects: 5 });
        const $fallback = cheerio.load(retry.data);
        $fallback("a[href*='/movie/'], a[href*='/series/']").each((_i: number, node: any) => {
          const anchor = $fallback(node);
          const rawHref = String(anchor.attr("href") || "");
          const link = resolveUrl(rawHref, baseUrl);
          if (!rawHref || !link || !/\/(movie|series)\//i.test(new URL(link).pathname)) return;
          if (posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;
          const card = anchor.closest("article, li, .item, .card, .poster, div");
          const img = anchor.find("img").first().length ? anchor.find("img").first() : card.find("img").first();
          const title = normaliseTitle(anchor.attr("title") || anchor.text() || img.attr("alt") || "");
          if (title) posts.push({ title, link, image: resolveUrl(getPosterSrc(img), baseUrl) });
        });
      } catch (error: any) { console.warn("[MultiMovies] listing fallback failed:", error?.message || error); }
    }

    console.log(`[MultiMovies] Found ${posts.length} posts for ${route}`);
    return posts.slice(0, 100);
  } catch (error) {
    throwProviderError("MultiMovies", "posts", error);
  }
}

// =====================================================================
//  getSearchPosts
// =====================================================================
export async function getSearchPosts({
  searchQuery,
  page = 1,
  signal,
  providerValue,
  providerContext,
}: {
  searchQuery: string;
  page?: number;
  signal?: AbortSignal;
  providerValue?: string;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const { axios, cheerio } = providerContext;

  const baseUrl = (await getBaseUrl("multi", axios, cheerio)).replace(/\/+$/, "");

  // The live site paginates search through /catalog with q + sort + page.
  // Use the canonical endpoint on every page to avoid later pages falling
  // back to the first page.
  const searchUrl = new URL(`${baseUrl}/catalog`);
  searchUrl.searchParams.set("q", searchQuery.trim());
  searchUrl.searchParams.set("sort", "latest");
  searchUrl.searchParams.set("page", String(Math.max(1, page)));
  const url = searchUrl.href;

  console.log(`[MultiMovies] Searching: ${url}`);

  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, Referer: baseUrl },
      signal,
      timeout: 15000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(res.data);
    const posts: Post[] = [];

    // ── Primary: poster-card ──
    $("article.poster-card").each((_: number, element: any) => {
      const card = $(element);
      const linkA = card.find("a.poster-art").first();
      const captionA = card.find(".poster-caption a").first();

      const rawHref = linkA.attr("href") || captionA.attr("href");
      if (!rawHref || !isContentLink(rawHref)) return;

      const link = resolveUrl(rawHref, baseUrl);
      if (!link || posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;

      const img = card.find("img").first();
      const title = normaliseTitle(
        captionA.text() || img.attr("alt") || "",
      );
      if (!title) return;

      const image = resolveUrl(getPosterSrc(img), baseUrl);
      posts.push({ title, link, image });
    });

    // ── Fallback ──
    if (posts.length === 0) {
      console.log("[MultiMovies] No poster-card in search, trying fallback...");
      $("article, .result-item, .item").each((_: number, element: any) => {
        const card = $(element);
        const rawHref = card.find("a[href]").first().attr("href");
        if (!rawHref || !isContentLink(rawHref)) return;

        const link = resolveUrl(rawHref, baseUrl);
        if (!link || posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;

        const img = card.find("img").first();
        const title = normaliseTitle(
          card.find("h1, h2, h3, .poster-caption a, .title a").first().text() ||
            img.attr("alt") ||
            "",
        );
        if (!title) return;

        const image = resolveUrl(getPosterSrc(img), baseUrl);
        posts.push({ title, link, image });
      });
    }

    if (posts.length === 0) {
      const fallback = new URL(baseUrl + "/search");
      fallback.searchParams.set("q", String(searchQuery || "").trim());
      fallback.searchParams.set("page", String(Math.max(1, page)));
      try {
        const retry = await axios.get(fallback.href, { headers: { ...HEADERS, Referer: baseUrl }, signal, timeout: 12000, maxRedirects: 5 });
        const $fallback = cheerio.load(retry.data);
        $fallback("article, .result-item, .item, a[href*='/movie/'], a[href*='/series/']").each((_i: number, node: any) => {
          const card = $fallback(node);
          const anchor = card.is("a") ? card : card.find("a[href*='/movie/'], a[href*='/series/']").first();
          const rawHref = String(anchor.attr("href") || "");
          const link = resolveUrl(rawHref, baseUrl);
          if (!rawHref || !link || !/\/(movie|series)\//i.test(new URL(link).pathname)) return;
          if (posts.some((p) => normaliseContentLink(p.link) === normaliseContentLink(link))) return;
          const img = anchor.find("img").first().length ? anchor.find("img").first() : card.find("img").first();
          const title = normaliseTitle(anchor.attr("title") || card.find("h1, h2, h3, .title").first().text() || anchor.text() || img.attr("alt") || "");
          if (title) posts.push({ title, link, image: resolveUrl(getPosterSrc(img), baseUrl) });
        });
      } catch (error: any) { console.warn("[MultiMovies] /search fallback failed:", error?.message || error); }
    }

    console.log(
      `[MultiMovies] Search found ${posts.length} results for "${searchQuery}"`,
    );
    return posts.slice(0, 100);
  } catch (error) {
    throwProviderError("MultiMovies", "search posts", error);
  }
}