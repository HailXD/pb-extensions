const UPSTREAM = ROOT.Sources;
const CHAPTER_PAGES_CACHE_TTL_MS = 60_000;
const CHAPTER_PAGES_CACHE_LIMIT = 16;
const CHAPTER_LANGUAGE = "\u{1F1EC}\u{1F1E7}";
const REQUESTS_PER_SECOND = 10;
const CDN_EXTENSIONS = [".jpg", ".png", ".webp", ".jpeg"];
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_ERROR = /(?:rate|api)[\s_-]*limit|too[\s_-]*many[\s_-]*requests|quota.*(?:exceed|exhaust)/i;

class MangaHubRateLimitError extends Error {}

function parseJson(data) {
  try {
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }
}

class Mangahub extends UPSTREAM.Mangahub {
  constructor() {
    super();
    this.pendingAccessKey = null;
    this.pendingRequests = new Map();
    this.chapterPagesCache = new Map();
    this.mangaSlugs = new Map();
    this.requestManager = App.createRequestManager({
      requestsPerSecond: REQUESTS_PER_SECOND,
      requestTimeout: REQUEST_TIMEOUT_MS,
      interceptor: {
        interceptRequest: (request) => this.prepareMangaHubRequest(request),
        interceptResponse: async (response) => {
          await this.handleRateLimit(response);
          return response;
        }
      }
    });
    this.getMhubAccess = () => this.shareRequest(ACCESS_KEY_STATE, async () => {
      const stored = await this.stateManager.retrieve(ACCESS_KEY_STATE);
      if (typeof stored !== "string") return "";
      const cookie = /(?:^|;\s*)mhub_access=([^;]*)/.exec(stored);
      return cookie ? cookie[1] : stored;
    });
  }

  async prepareMangaHubRequest(request) {
    const [userAgent, access] = await Promise.all([
      this.requestManager.getDefaultUserAgent(),
      this.getMhubAccess()
    ]);
    request.headers = {
      ...request.headers ?? {},
      Referer: `${MH_DOMAIN}/`,
      Origin: MH_DOMAIN,
      "User-Agent": userAgent,
      "x-mhub-access": access
    };
    return request;
  }

  async handleRateLimit(response) {
    const result = parseJson(response.data);
    const limited = (Array.isArray(result?.errors) && result.errors.some((error) =>
      RATE_LIMIT_ERROR.test(typeof error === "string" ? error : error?.message ?? "") || RATE_LIMIT_ERROR.test(error?.extensions?.code ?? "")
    )) || [result?.message, result?.error, result?.detail].some((value) => typeof value === "string" && RATE_LIMIT_ERROR.test(value));
    if (response.status !== 429 && !limited) return;
    throw new MangaHubRateLimitError("MangaHub rate limit reached");
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
      const request = App.createRequest({
        url: MH_API_DOMAIN,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        data: {
          query: `query { manga(x: m01, slug: ${JSON.stringify(mangaId)}) { mainSlug chapters { number title date } } }`
        }
      });
      const response = await this.requestManager.schedule(request, 1);
      await this.handleRateLimit(response);
      const result = parseResponse(response, "Chapters unavailable");
      if (result.errors?.length) {
        throw new Error("Chapters unavailable");
      }
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

  async refreshAPIKey() {
    if (!this.pendingAccessKey) {
      this.pendingAccessKey = this.fetchAccessKey().finally(() => {
        this.pendingAccessKey = null;
      });
    }
    return this.pendingAccessKey;
  }

  async fetchAccessKey() {
    await this.stateManager.store(ACCESS_KEY_STATE, "");
    this.pendingRequests.delete(ACCESS_KEY_STATE);
    const cookieStore = this.requestManager.cookieStore;
    for (const cookie of cookieStore?.getAllCookies() ?? []) {
      if (cookie.name === ACCESS_COOKIE_NAME) cookieStore.removeCookie(cookie);
    }
    const request = App.createRequest({
      url: `${MH_DOMAIN}${ACCESS_KEY_REFRESH_PATH}`,
      method: "GET",
      headers: { Cookie: `${ACCESS_COOKIE_NAME}=; Path=/` }
    });
    const response = await this.requestManager.schedule(request, 1);
    if (response.status >= 400) {
      throw new Error("MangaHub access key unavailable. Open the source's Cloudflare bypass and try again.");
    }
    const header = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "set-cookie")?.[1];
    const cookieHeader = Array.isArray(header) ? header.join(";") : String(header ?? "");
    const headerKey = /mhub_access=([^;\s,]+)/.exec(cookieHeader)?.[1];
    const cookieKey = cookieStore?.getAllCookies().find((cookie) => cookie.name === ACCESS_COOKIE_NAME && cookie.value)?.value;
    const key = headerKey || cookieKey;
    if (!key) {
      throw new Error("MangaHub did not provide an access key. Open the source's Cloudflare bypass and try again.");
    }
    await this.stateManager.store(ACCESS_KEY_STATE, key);
    this.pendingRequests.delete(ACCESS_KEY_STATE);
  }

  async getMainSlug(mangaId) {
    const cached = this.mangaSlugs.get(mangaId) || await this.stateManager.retrieve(`slug_${mangaId}`);
    if (typeof cached === "string" && cached) return cached;
    try {
      const request = App.createRequest({
        url: MH_API_DOMAIN,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        data: { query: `query { manga(x: m01, slug: ${JSON.stringify(mangaId)}) { mainSlug } }` }
      });
      const response = await this.requestManager.schedule(request, 1);
      const result = parseResponse(response, "Manga mainSlug unavailable");
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
      const pages = await this.loadChapterPages(slug, number);
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
      const response = await this.requestManager.schedule(App.createRequest({
        url: `${MH_CDN_DOMAIN}/${slug}/${number}/${page}${ext}`,
        method: "HEAD"
      }), 1);
      this.lastCheckStatus += ` ${ext}:${response.status}`;
      return response.status < 400;
    } catch (err) {
      this.lastCheckError += ` ${ext}:${err?.message || err}`;
      return false;
    }
  }

  async resolveExt(slug, number, page) {
    for (const candidate of CDN_EXTENSIONS) {
      if (await this.checkPage(slug, number, page, candidate)) return candidate;
    }
    return null;
  }

  async loadChapterPages(slug, number) {
    this.lastCheckStatus = "";
    this.lastCheckError = "";
    let startPage = 1;
    let ext1 = await this.resolveExt(slug, number, 1);
    if (!ext1) {
      ext1 = await this.resolveExt(slug, number, 0);
      if (ext1) startPage = 0;
    }
    if (!ext1) throw new Error(`CDN probe failed [status=${this.lastCheckStatus || "none"}, err=${this.lastCheckError || "none"}] on ${MH_CDN_DOMAIN}/${slug}/${number}/1.*`);

    const secondPage = startPage + 1;
    let mainExt = ext1;
    if (!(await this.checkPage(slug, number, secondPage, ext1))) {
      const ext2 = await this.resolveExt(slug, number, secondPage);
      if (ext2) mainExt = ext2;
    }

    let low = secondPage;
    if (mainExt !== ext1 || (await this.checkPage(slug, number, secondPage, mainExt))) {
      let high = 16;
      while (await this.checkPage(slug, number, high, mainExt)) {
        low = high;
        high *= 2;
      }
      while (low < high - 1) {
        const mid = Math.floor((low + high) / 2);
        if (await this.checkPage(slug, number, mid, mainExt)) {
          low = mid;
        } else {
          high = mid;
        }
      }
    } else {
      low = startPage;
    }

    const trailingExt = await this.resolveExt(slug, number, low + 1);
    const pages = [];
    for (let i = startPage; i <= low; i++) {
      pages.push(`${MH_CDN_DOMAIN}/${slug}/${number}/${i}${i === startPage ? ext1 : mainExt}`);
    }
    if (trailingExt) {
      pages.push(`${MH_CDN_DOMAIN}/${slug}/${number}/${low + 1}${trailingExt}`);
    }
    return pages;
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
