/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */
/* Search and session handling adapted from https://github.com/kittycatgit/kitty-extensions-0.8/tree/050303d9a3161c51dc5853ef3b8573fa63c28c3e/src/MangaHub */

const UPSTREAM = ROOT.Sources;
const MH_DOMAIN = "https://mangahub.io";
const MH_API_DOMAIN = `${MH_DOMAIN}/graphql`;
const MH_LEGACY_API_DOMAIN = "https://api.mghcdn.com/graphql";
const MH_CDN_DOMAIN = "https://imgx.mghcdn.com";
const MH_HOST = "mangahub.io";
const MH_COVER_CDN = "https://thumb.mghcdn.com";
const MH_ACCESS_COOKIE = "mhub_access";
const MH_SESSION_STATE = "search_session";
const MH_SEARCH_SOURCE = "m01";
const MH_SEARCH_PAGE_SIZE = 30;
const MH_SEARCH_DEFAULT_SORT = "POPULAR";
const MH_SEARCH_LIST_FIELDS = "id,rank,title,slug,status,image,latestChapter,genres,author,isSafe,isLicensed,updatedDate";
const MH_SORT_OPTIONS = [
  { id: "POPULAR", label: "Popular" },
  { id: "LATEST", label: "Latest" },
  { id: "NEW", label: "Newest" },
  { id: "COMPLETED", label: "Completed" },
  { id: "ALPHABET", label: "A – Z" }
];
const MH_EXCLUDE_OPTIONS = [
  { id: "hideNSFW", label: "Hide NSFW" },
  { id: "hideYaoi", label: "Hide Yaoi" },
  { id: "hideLicensed", label: "Hide licensed" }
];
const MH_FILTER_SECTIONS = [
  { id: "sort", label: "Sort", options: MH_SORT_OPTIONS },
  { id: "exclude", label: "Exclude", options: MH_EXCLUDE_OPTIONS }
];
const MH_GENRES = [
  { id: "action", label: "Action" },
  { id: "adventure", label: "Adventure" },
  { id: "comedy", label: "Comedy" },
  { id: "adult", label: "Adult" },
  { id: "drama", label: "Drama" },
  { id: "historical", label: "Historical" },
  { id: "martial-arts", label: "Martial Arts" },
  { id: "romance", label: "Romance" },
  { id: "ecchi", label: "Ecchi" },
  { id: "supernatural", label: "Supernatural" },
  { id: "webtoons", label: "Webtoons" },
  { id: "manhwa", label: "Manhwa" },
  { id: "fantasy", label: "Fantasy" },
  { id: "harem", label: "Harem" },
  { id: "shounen", label: "Shounen" },
  { id: "manhua", label: "Manhua" },
  { id: "mature", label: "Mature" },
  { id: "seinen", label: "Seinen" },
  { id: "sports", label: "Sports" },
  { id: "school-life", label: "School Life" },
  { id: "smut", label: "Smut" },
  { id: "mystery", label: "Mystery" },
  { id: "psychological", label: "Psychological" },
  { id: "shounen-ai", label: "Shounen ai" },
  { id: "slice-of-life", label: "Slice of life" },
  { id: "shoujo-ai", label: "Shoujo ai" },
  { id: "cooking", label: "Cooking" },
  { id: "horror", label: "Horror" },
  { id: "tragedy", label: "Tragedy" },
  { id: "doujinshi", label: "Doujinshi" },
  { id: "sci-fi", label: "Sci-Fi" },
  { id: "yuri", label: "Yuri" },
  { id: "yaoi", label: "Yaoi" },
  { id: "shoujo", label: "Shoujo" },
  { id: "gender-bender", label: "Gender bender" },
  { id: "josei", label: "Josei" },
  { id: "mecha", label: "Mecha" },
  { id: "medical", label: "Medical" },
  { id: "magic", label: "Magic" },
  { id: "4-koma", label: "4-Koma" },
  { id: "music", label: "Music" },
  { id: "webtoon", label: "Webtoon" },
  { id: "isekai", label: "Isekai" },
  { id: "game", label: "Game" },
  { id: "award-winning", label: "Award Winning" },
  { id: "oneshot", label: "Oneshot" },
  { id: "demons", label: "Demons" },
  { id: "military", label: "Military" },
  { id: "police", label: "Police" },
  { id: "super-power", label: "Super Power" },
  { id: "food", label: "Food" },
  { id: "kids", label: "Kids" },
  { id: "magical-girls", label: "Magical Girls" },
  { id: "wuxia", label: "Wuxia" },
  { id: "superhero", label: "Superhero" },
  { id: "thriller", label: "Thriller" },
  { id: "crime", label: "Crime" },
  { id: "philosophical", label: "Philosophical" },
  { id: "adaptation", label: "Adaptation" },
  { id: "full-color", label: "Full Color" },
  { id: "crossdressing", label: "Crossdressing" },
  { id: "reincarnation", label: "Reincarnation" },
  { id: "manga", label: "Manga" },
  { id: "cartoon", label: "Cartoon" },
  { id: "survival", label: "Survival" },
  { id: "comic", label: "Comic" },
  { id: "english", label: "English" },
  { id: "harlequin", label: "Harlequin" },
  { id: "time-travel", label: "Time Travel" },
  { id: "traditional-games", label: "Traditional Games" },
  { id: "reverse-harem", label: "Reverse Harem" },
  { id: "animals", label: "Animals" },
  { id: "aliens", label: "Aliens" },
  { id: "loli", label: "Loli" },
  { id: "video-games", label: "Video Games" },
  { id: "monsters", label: "Monsters" },
  { id: "office-workers", label: "Office Workers" },
  { id: "system", label: "System" },
  { id: "villainess", label: "Villainess" },
  { id: "zombies", label: "Zombies" },
  { id: "vampires", label: "Vampires" },
  { id: "violence", label: "Violence" },
  { id: "monster-girls", label: "Monster Girls" },
  { id: "anthology", label: "Anthology" },
  { id: "ghosts", label: "Ghosts" },
  { id: "delinquents", label: "Delinquents" },
  { id: "post-apocalyptic", label: "Post-Apocalyptic" },
  { id: "xianxia", label: "Xianxia" },
  { id: "xuanhuan", label: "Xuanhuan" },
  { id: "r-18", label: "R-18" },
  { id: "cultivation", label: "Cultivation" },
  { id: "rebirth", label: "Rebirth" },
  { id: "gore", label: "Gore" },
  { id: "russian", label: "Russian" },
  { id: "samurai", label: "Samurai" },
  { id: "ninja", label: "Ninja" },
  { id: "revenge", label: "Revenge" },
  { id: "cheat-systems", label: "Cheat Systems" },
  { id: "dungeons", label: "Dungeons" },
  { id: "overpowered", label: "Overpowered" },
  { id: "royal-family", label: "Royal family" },
  { id: "long-strip", label: "Long Strip" },
  { id: "shota", label: "Shota" },
  { id: "web-comic", label: "Web Comic" },
  { id: "virtual-reality", label: "Virtual Reality" },
  { id: "genderswap", label: "Genderswap" },
  { id: "suggestive", label: "Suggestive" },
  { id: "mafia", label: "Mafia" },
  { id: "murim", label: "Murim" },
  { id: "returner", label: "Returner" },
  { id: "official-colored", label: "Official colored" },
  { id: "sexual-violence", label: "Sexual Violence" },
  { id: "gyaru", label: "Gyaru" },
  { id: "erotica", label: "Erotica" },
  { id: "pornographic", label: "Pornographic" },
  { id: "blood", label: "Blood" },
  { id: "fighting", label: "Fighting" },
  { id: "girls-love", label: "Girls' love" },
  { id: "regression", label: "Regression" },
  { id: "tower-climbing", label: "Tower Climbing" },
  { id: "fan-colored", label: "Fan Colored" },
  { id: "self-published", label: "Self-Published" },
  { id: "safe", label: "Safe" },
  { id: "boys-love", label: "Boys' Love" },
  { id: "incest", label: "Incest" },
  { id: "weak-to-strong", label: "Weak-to-Strong" },
  { id: "ruthless-protagonist", label: "Ruthless Protagonist" },
  { id: "smart-mc", label: "Smart MC" },
  { id: "hunters", label: "Hunters" },
  { id: "mahjong", label: "Mahjong" },
  { id: "hentai", label: "Hentai" },
  { id: "maga", label: "Maga" },
];

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
    this.searchSession = {};
    this.searchSessionLoaded = false;
    this.searchOwnToken = "";
    this.requestManager = App.createRequestManager({
      requestsPerSecond: REQUESTS_PER_SECOND,
      requestTimeout: REQUEST_TIMEOUT_MS,
      interceptor: {
        interceptRequest: (request) => this.prepareMangaHubRequest(request),
        interceptResponse: async (response) => {
          await this.rememberSearchSession(response);
          return response;
        }
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
    await this.loadSearchSession();
    request.headers = {
      ...request.headers ?? {},
      Referer: `${MH_DOMAIN}/`,
      Origin: MH_DOMAIN,
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": await this.requestManager.getDefaultUserAgent()
    };
    if (request.url === MH_DOMAIN || request.url.startsWith(`${MH_DOMAIN}/`)) {
      const carried = Object.entries(this.searchSession).filter(([name]) =>
        name !== MH_ACCESS_COOKIE || !(request.cookies ?? []).some((cookie) => cookie.name === MH_ACCESS_COOKIE)
      );
      request.cookies = [
        ...request.cookies ?? [],
        ...carried.map(([name, value]) => App.createCookie({ name, value, domain: MH_HOST, path: "/" }))
      ];
    }
    return request;
  }

  async loadSearchSession() {
    if (this.searchSessionLoaded) return;
    const stored = await this.stateManager.retrieve(MH_SESSION_STATE);
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      this.searchSession = { ...this.searchSession, ...stored };
    }
    this.searchSessionLoaded = true;
  }

  async rememberSearchSession(response) {
    const headers = response.headers ?? {};
    const key = Object.keys(headers).find((name) => name.toLowerCase() === "set-cookie");
    const raw = key ? headers[key] : undefined;
    const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
    let changed = false;
    for (const line of lines) {
      const pair = /^\s*([^=;\s]+)=([^;]*)/.exec(line);
      const name = pair?.[1];
      const value = (pair?.[2] ?? "").trim();
      if (!name) continue;
      if (value && this.searchSession[name] !== value) {
        this.searchSession[name] = value;
        changed = true;
      } else if (!value && name in this.searchSession) {
        delete this.searchSession[name];
        changed = true;
      }
    }
    if (changed) await this.stateManager.store(MH_SESSION_STATE, { ...this.searchSession });
  }

  async requestSearchAPI(query, label) {
    await this.loadSearchSession();
    if (!this.searchSession[MH_ACCESS_COOKIE] && !this.searchOwnToken) {
      while (this.searchOwnToken.length < 32) this.searchOwnToken += Math.floor(Math.random() * 16).toString(16);
    }
    const token = this.searchSession[MH_ACCESS_COOKIE] || this.searchOwnToken;
    const response = await this.requestManager.schedule(App.createRequest({
      url: MH_API_DOMAIN,
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-mhub-access": token, Origin: MH_DOMAIN },
      cookies: [App.createCookie({ name: MH_ACCESS_COOKIE, value: token, domain: MH_HOST, path: "/" })],
      data: JSON.stringify({ query })
    }), 1);
    const payload = parseJson(response.data);
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      const message = payload.errors.map((error) => error?.message ?? "unknown").join("; ");
      if (/rate limit/i.test(message)) this.searchOwnToken = "";
      throw new Error(`${label}: ${message}`);
    }
    return parseResponse(response, label);
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
          const result = await this.requestSearchAPI("{genres{id,slug,title}}", "Search filters unavailable");
          const genres = result.data.genres;
          if (!Array.isArray(genres) || !genres.length) throw new Error("Search filters unavailable");
          const fresh = genres.filter((genre) => typeof genre?.slug === "string" && typeof genre?.title === "string")
            .map((genre) => ({ id: genre.slug, label: genre.title }))
            .sort((a, b) => a.label.localeCompare(b.label));
          if (!fresh.length) throw new Error("Search filters unavailable");
          tags = fresh;
          await this.stateManager.store(SEARCH_TAGS_STATE, { tags, expiresAt: Date.now() + SEARCH_TAGS_CACHE_TTL_MS });
        } catch {}
      }
      if (!tags.length) tags = MH_GENRES;
      return [
        App.createTagSection({ id: "genres", label: "Genres (any of)", tags: tags.map((tag) => App.createTag(tag)) }),
        ...MH_FILTER_SECTIONS.map((section) => App.createTagSection({
          id: section.id,
          label: section.label,
          tags: section.options.map((option) => App.createTag({ id: `${section.id}:${option.id}`, label: option.label }))
        }))
      ];
    });
  }

  async supportsTagExclusion() {
    return false;
  }

  searchFilters(tags) {
    const genres = [];
    const excluded = [];
    let sort = MH_SEARCH_DEFAULT_SORT;
    for (const tag of tags ?? []) {
      const id = tag.id ?? "";
      const separator = id.indexOf(":");
      const prefix = separator > 0 ? id.slice(0, separator) : "";
      const value = separator > 0 ? id.slice(separator + 1) : "";
      if (prefix === "sort") {
        if (MH_SORT_OPTIONS.some((option) => option.id === value)) sort = value;
      } else if (prefix === "exclude") {
        if (MH_EXCLUDE_OPTIONS.some((option) => option.id === value)) excluded.push(value);
      } else if (id) {
        genres.push(id);
      }
    }
    return {
      sort,
      ...(genres.length ? { genres } : {}),
      ...(excluded.includes("hideNSFW") ? { hideNSFW: true } : {}),
      ...(excluded.includes("hideYaoi") ? { hideYaoi: true } : {}),
      ...(excluded.includes("hideLicensed") ? { hideLicensed: true } : {})
    };
  }

  searchArgs(title, filters, offset) {
    const genre = filters.genres?.length ? filters.genres.join(",") : "all";
    return [
      `x:${MH_SEARCH_SOURCE}`,
      `q:${JSON.stringify(title)}`,
      `genre:${JSON.stringify(genre)}`,
      `mod:${filters.sort ?? MH_SEARCH_DEFAULT_SORT}`,
      ...(filters.hideNSFW ? ["hideNSFW:true"] : []),
      ...(filters.hideYaoi ? ["hideYaoi:true"] : []),
      ...(filters.hideLicensed ? ["hideLicensed:true"] : []),
      `limit:${MH_SEARCH_PAGE_SIZE}`,
      `offset:${offset}`,
      "count:true"
    ].join(",");
  }

  async getSearchResults(query, metadata) {
    const filters = metadata ?? this.searchFilters(query?.includedTags);
    const offset = metadata?.offset ?? 0;
    const result = await this.requestSearchAPI(
      `{search(${this.searchArgs((query?.title ?? "").trim(), filters, offset)}){rows{${MH_SEARCH_LIST_FIELDS}},count}}`,
      "Search unavailable"
    );
    const rows = result.data.search?.rows ?? [];
    const total = result.data.search?.count ?? 0;
    const nextOffset = offset + rows.length;
    return App.createPagedResults({
      results: rows.map((row) => {
        const image = (row.image ?? "").trim();
        return App.createPartialSourceManga({
          mangaId: row.slug,
          title: row.title?.trim() || row.slug,
          image: image ? (/^https?:\/\//i.test(image) ? image : `${MH_COVER_CDN}/${image.replace(/^\/+/, "")}`) : `${MH_COVER_CDN}/no-cover.jpg`,
          ...(typeof row.latestChapter === "number" ? { subtitle: `Chapter ${row.latestChapter}` } : {})
        });
      }),
      metadata: rows.length && nextOffset < total ? { ...filters, offset: nextOffset } : undefined
    });
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
