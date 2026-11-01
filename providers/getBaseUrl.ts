const urlsEndpoint = "https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json";
const fallbackUrl = "https://m1.multimovies.courses";
const cacheTtl = 10 * 60 * 1000;

type ProviderUrls = Record<string, { url: string }>;
type AxiosLike = { get: (url: string, config?: any) => Promise<{ data: any }> };
type CacheState = {
  __vegaProviderBaseUrlCache__?: {
    data?: ProviderUrls;
    expiresAt: number;
    request?: Promise<ProviderUrls>;
  };
};
declare const providerGlobal: CacheState | undefined;

function getCache() {
  const state =
    typeof providerGlobal !== "undefined" && providerGlobal
      ? providerGlobal
      : (globalThis as typeof globalThis & CacheState);
  state.__vegaProviderBaseUrlCache__ ??= { expiresAt: 0 };
  return state.__vegaProviderBaseUrlCache__;
}

function normaliseSiteUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin.replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function discoverMultiMoviesUrl(axios?: AxiosLike, cheerio?: any): Promise<string> {
  try {
    let html = "";
    if (axios) {
      const response = await axios.get("https://multimovies.wtf/", {
        timeout: 12000,
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0" },
      });
      html = String(response.data || "");
    } else {
      const response = await fetch("https://multimovies.wtf/");
      if (!response.ok) throw new Error("Landing page HTTP " + response.status);
      html = await response.text();
    }

    if (cheerio) {
      const $ = cheerio.load(html);
      let found = "";
      $("a[href]").each((_: number, el: any) => {
        if (found) return;
        const label = $(el).text().replace(/\s+/g, " ").trim();
        if (/^(visit\s+(?:multimovies|site)|go\s+to\s+multimovies)$/i.test(label)) {
          found = String($(el).attr("href") || "");
        }
      });
      const resolved = normaliseSiteUrl(found);
      if (resolved && !/multimovies\.wtf$/i.test(new URL(resolved).hostname)) return resolved;
    }

    const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
    for (const anchor of anchors) {
      const label = anchor.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (!/^(visit\s+(?:multimovies|site)|go\s+to\s+multimovies)$/i.test(label)) continue;
      const match = anchor.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      const resolved = normaliseSiteUrl(match?.[1] || "");
      if (resolved && !/multimovies\.wtf$/i.test(new URL(resolved).hostname)) return resolved;
    }
  } catch (error) {
    console.warn("[MultiMovies] Could not discover current domain from landing page", error);
  }
  return "";
}

async function fetchProviderUrls(): Promise<ProviderUrls> {
  const cache = getCache();
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;
  if (cache.request) return cache.request;

  const request = fetch(urlsEndpoint)
    .then(async (response) => {
      if (!response.ok) throw new Error("URL config HTTP " + response.status);
      const data = (await response.json()) as ProviderUrls;
      cache.data = data;
      cache.expiresAt = Date.now() + cacheTtl;
      return data;
    })
    .catch((error) => {
      if (cache.data) return cache.data;
      console.warn("[MultiMovies] URL config fallback unavailable", error);
      return {} as ProviderUrls;
    })
    .finally(() => { cache.request = undefined; });
  cache.request = request;
  return request;
}

export const getBaseUrl = async (
  providerValue: string,
  axios?: AxiosLike,
  cheerio?: any,
): Promise<string> => {
  if (providerValue === "multi") {
    const discovered = await discoverMultiMoviesUrl(axios, cheerio);
    if (discovered) {
      const cache = getCache();
      cache.data = { ...(cache.data || {}), multi: { url: discovered } };
      cache.expiresAt = Date.now() + cacheTtl;
      return discovered;
    }
    // Never fall back to the reference repository's potentially stale domain.
    return "https://multimovies.wtf";
  }

  const urls = await fetchProviderUrls();

  // Multi 2 is a separate implementation of the upstream Multi provider.
  // Keep its upstream domain independent from the MultiMovies provider.
  if (providerValue === "multi2") {
    return normaliseSiteUrl(urls.multi?.url || "") || "https://m1.multimovies.courses";
  }

  const configured = normaliseSiteUrl(urls[providerValue]?.url || "");
  if (configured) return configured;
  return providerValue === "multi" ? "https://multimovies.wtf" : "";
};
