const UPSTREAM = ROOT.Sources;
const MH_DOMAIN = "https://mangahub.io";
const MH_API_DOMAIN = `${MH_DOMAIN}/graphql`;
const MH_LEGACY_API_DOMAIN = "https://api.mghcdn.com/graphql";
const MH_CDN_DOMAIN = "https://imgx.mghcdn.com";
const SEARCH_TAGS_STATE = "search_tags";
const SEARCH_TAGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CHAPTER_PAGES_CACHE_TTL_MS = 60_000;
const CHAPTER_PAGES_CACHE_LIMIT = 16;
const CHAPTER_LANGUAGE = "\u{1F1EC}\u{1F1E7}";
const REQUESTS_PER_SECOND = 10;
const CDN_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", "a.jpg", "b.jpg", "c.jpg", "d.jpg", ".avif"];
const CDN_REQUESTS_PER_SECOND = 500;
const CDN_PAGE_PROBE_WINDOW_SIZE = 8;
const CDN_PROBE_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

function parseJson(data) {
  try {
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }
}

function parseResponse(response, label) {
  const body = typeof response.data === "string" ? response.data : "";
  if (/cf-chl-|cf challenge|cloudflare.*(?:challenge|verification)|<title>Just a moment/i.test(body)) {
    throw new Error(`${label}: MangaHub requires Cloudflare verification. Open the source's Cloudflare bypass and try again.`);
  }
  if (response.status === 429) {
    throw new Error(`${label}: MangaHub rate limit reached. Try again later.`);
  }
  if (response.status >= 400) {
    throw new Error(`${label}: MangaHub returned HTTP ${response.status}. Try again later.`);
  }
  const result = parseJson(response.data);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${label}: MangaHub returned an invalid response. Try again later.`);
  }
  if (result.errors?.length || !result.data) {
    throw new Error(`${label}: MangaHub could not complete the request. Try again later.`);
  }
  return result;
}

class Mangahub extends UPSTREAM.Mangahub {
  constructor() {
    super();
    this.pendingRequests = new Map();
    this.chapterPagesCache = new Map();
    this.mangaSlugs = new Map();
    this.requestManager = App.createRequestManager({
      requestsPerSecond: REQUESTS_PER_SECOND,
      requestTimeout: REQUEST_TIMEOUT_MS,
      interceptor: {
        interceptRequest: (request) => this.prepareMangaHubRequest(request),
        interceptResponse: async (response) => response
      }
    });
    this.cdnRequestManager = App.createRequestManager({
      requestsPerSecond: CDN_REQUESTS_PER_SECOND,
      requestTimeout: CDN_PROBE_TIMEOUT_MS,
      interceptor: {
        interceptRequest: async (request) => {
          request.headers = {
            ...request.headers ?? {},
            Referer: `${MH_DOMAIN}/`,
            Origin: MH_DOMAIN,
            "User-Agent": await this.requestManager.getDefaultUserAgent()
          };
          return request;
        },
        interceptResponse: async (response) => response
      }
    });
  }

  async prepareMangaHubRequest(request) {
    if (request.url === MH_LEGACY_API_DOMAIN) request.url = MH_API_DOMAIN;
    request.headers = {
      ...request.headers ?? {},
      Referer: `${MH_DOMAIN}/`,
      Origin: MH_DOMAIN,
      "User-Agent": await this.requestManager.getDefaultUserAgent()
    };
    return request;
  }

  async requestAPI(query, label) {
    const request = App.createRequest({
      url: MH_API_DOMAIN,
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      data: { query }
    });
    return parseResponse(await this.requestManager.schedule(request, 1), label);
  }

  getSearchTags() {
    return this.shareRequest(SEARCH_TAGS_STATE, async () => {
      const cached = await this.stateManager.retrieve(SEARCH_TAGS_STATE);
      let tags = Array.isArray(cached?.tags) ? cached.tags.filter((tag) =>
        typeof tag?.id === "string" && typeof tag?.label === "string"
      ) : [];
      if (!tags.length || !(cached.expiresAt > Date.now())) {
        try {
          const result = await this.requestAPI("query { genres { slug title } }", "Search filters unavailable");
          const genres = result.data.genres;
          if (!Array.isArray(genres) || !genres.length) throw new Error("Search filters unavailable");
          const fresh = genres.filter((genre) => typeof genre?.slug === "string" && typeof genre?.title === "string")
            .map((genre) => ({ id: genre.slug, label: genre.title }));
          if (!fresh.length) throw new Error("Search filters unavailable");
          tags = fresh;
          await this.stateManager.store(SEARCH_TAGS_STATE, { tags, expiresAt: Date.now() + SEARCH_TAGS_CACHE_TTL_MS });
        } catch {}
      }
      return tags.length ? [App.createTagSection({ id: "0", label: "genres", tags: tags.map((tag) => App.createTag(tag)) })] : [];
    });
  }

  getSearchResults(query, metadata) {
    return super.getSearchResults({ ...query, includedTags: query?.includedTags ?? [] }, metadata);
  }

  shareRequest(key, load) {
    if (!this.pendingRequests.has(key)) {
      const pending = Promise.resolve().then(load).finally(() => {
        if (this.pendingRequests.get(key) === pending) this.pendingRequests.delete(key);
      });
      this.pendingRequests.set(key, pending);
    }
    return this.pendingRequests.get(key);
  }

  getMangaDetails(mangaId) {
    return this.shareRequest(JSON.stringify(["manga", mangaId]), () => super.getMangaDetails(mangaId));
  }

  getChapters(mangaId) {
    return this.shareRequest(JSON.stringify(["chapters", mangaId]), async () => {
      const result = await this.requestAPI(
        `query { manga(x: m01, slug: ${JSON.stringify(mangaId)}) { mainSlug chapters { number title date } } }`,
        "Chapters unavailable"
      );
      const manga = result.data?.manga;
      if (manga?.mainSlug) {
        this.mangaSlugs.set(mangaId, manga.mainSlug);
        await this.stateManager.store(`slug_${mangaId}`, manga.mainSlug);
      }
      const chapters = manga?.chapters;
      if (!Array.isArray(chapters) || !chapters.length) throw new Error(`Couldn't find any chapters for mangaId: ${mangaId}!`);
      return chapters.map((chapter) => App.createChapter({
        id: String(chapter.number),
        name: chapter.title || `Chapter ${chapter.number}`,
        langCode: CHAPTER_LANGUAGE,
        chapNum: chapter.number,
        time: new Date(chapter.date)
      }));
    });
  }

  async getMainSlug(mangaId) {
    const cached = this.mangaSlugs.get(mangaId) || await this.stateManager.retrieve(`slug_${mangaId}`);
    if (typeof cached === "string" && cached) return cached;
    try {
      const result = await this.requestAPI(
        `query { manga(x: m01, slug: ${JSON.stringify(mangaId)}) { mainSlug } }`,
        "Manga mainSlug unavailable"
      );
      const mainSlug = result.data?.manga?.mainSlug;
      if (typeof mainSlug === "string" && mainSlug) {
        this.mangaSlugs.set(mangaId, mainSlug);
        await this.stateManager.store(`slug_${mangaId}`, mainSlug);
        return mainSlug;
      }
    } catch {}
    return decodeURIComponent(mangaId);
  }

  async getChapterDetails(mangaId, chapterId) {
    const number = Number(chapterId);
    if (!Number.isFinite(number)) throw new Error("Invalid MangaHub chapter number");
    const slug = await this.getMainSlug(mangaId);
    const cacheKey = JSON.stringify(["pages", slug, number]);
    const cached = this.chapterPagesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.chapterPagesCache.delete(cacheKey);
      this.chapterPagesCache.set(cacheKey, cached);
      return App.createChapterDetails({ id: chapterId, mangaId, pages: cached.pages.slice() });
    }
    this.chapterPagesCache.delete(cacheKey);
    const pages = await this.shareRequest(cacheKey, async () => {
      const pages = await this.probeChapterPages(slug, number);
      this.chapterPagesCache.set(cacheKey, { pages, expiresAt: Date.now() + CHAPTER_PAGES_CACHE_TTL_MS });
      while (this.chapterPagesCache.size > CHAPTER_PAGES_CACHE_LIMIT) {
        this.chapterPagesCache.delete(this.chapterPagesCache.keys().next().value);
      }
      return pages;
    });
    return App.createChapterDetails({ id: chapterId, mangaId, pages: pages.slice() });
  }

  async checkPage(slug, number, page, ext) {
    try {
      const response = await this.cdnRequestManager.schedule(App.createRequest({
        url: `${MH_CDN_DOMAIN}/${slug}/${number}/${page}${ext}`,
        method: "HEAD"
      }), 1);
      this.lastCheckStatus += ` ${ext}:${response.status}`;
      if (response.status === 404 || response.status === 410) return false;
      const contentType = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1];
      if ((response.status === 200 || response.status === 206) && (!contentType || /^image\//i.test(String(contentType)))) return true;
      return null;
    } catch (err) {
      this.lastCheckError += ` ${ext}:${err?.message || err}`;
      return null;
    }
  }

  async scanExtensions(slug, number, page, candidates) {
    return new Promise((resolve) => {
      let remaining = candidates.length;
      let inconclusive = false;
      if (!remaining) resolve({ ext: null, inconclusive });
      for (const candidate of candidates) {
        this.checkPage(slug, number, page, candidate).then((result) => {
          remaining -= 1;
          if (result === true) {
            resolve({ ext: candidate, inconclusive: false });
            return;
          }
          if (result === null) inconclusive = true;
          if (remaining !== 0) return;
          resolve({ ext: null, inconclusive });
        });
      }
    });
  }

  async resolveExt(slug, number, page, detectedExtensions, probe = null) {
    const candidates = probe?.extensions ?? (detectedExtensions.length ? detectedExtensions.slice() : CDN_EXTENSIONS.slice());
    const result = await (probe?.check ?? this.scanExtensions(slug, number, page, candidates));
    const fallback = result.ext ? null : await this.scanExtensions(slug, number, page, CDN_EXTENSIONS.filter((candidate) => !candidates.includes(candidate)));
    const ext = result.ext || fallback?.ext;
    if (ext) {
      if (!detectedExtensions.includes(ext)) detectedExtensions.push(ext);
      return ext;
    }
    if (result.inconclusive || fallback?.inconclusive) throw new Error("MangaHub image probes timed out or were blocked. Reload this chapter.");
    return null;
  }

  async probeChapterPages(slug, number) {
    this.lastCheckStatus = "";
    this.lastCheckError = "";
    const detectedExtensions = [];
    let startPage = 1;
    let ext1 = await this.resolveExt(slug, number, 1, detectedExtensions);
    if (!ext1) {
      ext1 = await this.resolveExt(slug, number, 0, detectedExtensions);
      if (ext1) startPage = 0;
    }
    if (!ext1) throw new Error(`CDN probe failed [status=${this.lastCheckStatus || "none"}, err=${this.lastCheckError || "none"}] on ${MH_CDN_DOMAIN}/${slug}/${number}/1.*`);

    const pages = [`${MH_CDN_DOMAIN}/${slug}/${number}/${startPage}${ext1}`];
    let nextPage = startPage + 1;
    const pending = new Map();
    const queueNextPage = () => {
      const page = nextPage++;
      const extensions = detectedExtensions.slice();
      pending.set(page, { extensions, check: this.scanExtensions(slug, number, page, extensions) });
    };
    for (let offset = 0; offset < CDN_PAGE_PROBE_WINDOW_SIZE; offset++) queueNextPage();
    for (let page = startPage + 1; ; page++) {
      const probe = pending.get(page);
      const ext = await this.resolveExt(slug, number, page, detectedExtensions, probe);
      pending.delete(page);
      if (!ext) return pages;
      pages.push(`${MH_CDN_DOMAIN}/${slug}/${number}/${page}${ext}`);
      queueNextPage();
    }
  }
}

const MangahubInfo = {
  ...UPSTREAM.MangahubInfo,
  version: SOURCE_INFO.version,
  author: SOURCE_INFO.author,
  authorWebsite: SOURCE_INFO.website,
  description: SOURCE_INFO.desc,
  sourceTags: SOURCE_INFO.tags,
  intents: SOURCE_INFO.intents
};

_Sources = { Mangahub, MangahubInfo };
ROOT.Sources = _Sources;
if (typeof exports === "object" && typeof module !== "undefined") module.exports.Sources = _Sources;
