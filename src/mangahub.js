const UPSTREAM = ROOT.Sources;

class Mangahub extends UPSTREAM.Mangahub {
  constructor() {
    super();
    this.chapterCrypto = new ChapterCrypto(this.requestManager);
    this.pendingAccessKey = null;
    this.getMhubAccess = async () => {
      const stored = await this.stateManager.retrieve(ACCESS_KEY_STATE);
      if (typeof stored !== "string") return "";
      const cookie = /(?:^|;\s*)mhub_access=([^;]*)/.exec(stored);
      return cookie ? cookie[1] : stored;
    };
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
  }

  async getChapterDetails(mangaId, chapterId) {
    const number = Number(chapterId);
    if (!Number.isFinite(number)) throw new Error("Invalid MangaHub chapter number");
    if (!await this.getMhubAccess()) await this.refreshAPIKey();
    for (let attempt = 0; attempt < MAX_CHAPTER_ATTEMPTS; attempt++) {
      const request = App.createRequest({
        url: MH_API_DOMAIN,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        data: {
          query: `query { chapter(x: m01, slug: ${JSON.stringify(mangaId)}, number: ${number}) { pages } }`
        }
      });
      const response = await this.requestManager.schedule(request, 1);
      const result = parseResponse(response, "Chapter unavailable");
      const errors = result.errors?.map((error) => error.message || "Unknown API error").join(" ");
      if (errors) {
        if (attempt + 1 < MAX_CHAPTER_ATTEMPTS && RETRYABLE_API_ERROR.test(errors)) {
          await this.refreshAPIKey();
          continue;
        }
        throw new Error(`MangaHub: ${errors}`);
      }
      try {
        const pages = await this.chapterCrypto.resolvePageUrls(result.data?.chapter?.pages);
        return App.createChapterDetails({ id: chapterId, mangaId, pages });
      } catch (error) {
        if (error instanceof ChapterKeyMismatchError && attempt + 1 < MAX_CHAPTER_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new Error("MangaHub could not load this chapter. Please try again.");
  }
}

const MangahubInfo = {
  ...UPSTREAM.MangahubInfo,
  version: SOURCE_INFO.version,
  author: SOURCE_INFO.author,
  authorWebsite: SOURCE_INFO.website,
  description: SOURCE_INFO.desc,
  sourceTags: SOURCE_INFO.tags
};

_Sources = { Mangahub, MangahubInfo };
ROOT.Sources = _Sources;
if (typeof exports === "object" && typeof module !== "undefined") module.exports.Sources = _Sources;
