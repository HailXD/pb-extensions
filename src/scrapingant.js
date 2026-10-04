const SCRAPINGANT_ENDPOINT = "https://api.scrapingant.com/v2/general";
const SCRAPINGANT_CONFIG_STATE = "scrapingant_config";
const SCRAPINGANT_KEYS_STATE = "scrapingant_keys";
const SCRAPINGANT_KEY_LABELS = ["ScrapingAnt key 1", "ScrapingAnt key 2"];
const SCRAPINGANT_TOGGLES = [
  { id: "pageLists", label: "ScrapingAnt page lists" },
  { id: "images", label: "ScrapingAnt images" }
];
const SCRAPINGANT_TIMEOUT_SECONDS = 20;
const SCRAPINGANT_ORIGINAL_HEADER_PREFIX = "ant-original-header-";
const SCRAPINGANT_FORWARDED_HEADERS = ["Accept", "Referer", "Origin", "User-Agent"];
const SCRAPINGANT_API_HEADERS = ["Content-Type"];
const SCRAPINGANT_DEFAULT_COOLDOWN_MS = 60_000;
const SCRAPINGANT_SLOT_TIMEOUT_MS = 60_000;
const SCRAPINGANT_REQUEST_ID_HEADER = "x-mangahub-proxy-request";
const MILLISECONDS_PER_SECOND = 1_000;
const REQUEST_ERROR_DETAIL_LIMIT = 600;
const SCRAPINGANT_ERROR_REASONS = {
  403: "Invalid API key or exhausted credits",
  409: "Concurrent request limit exceeded",
  429: "Provider rate limit exceeded",
  423: "Target anti-bot protection blocked the proxy request"
};

function requestJson(data) {
  try {
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }
}

function scrapingAntParameter(url, name) {
  try {
    return decodeURIComponent(new RegExp(`[?&]${name}=([^&]*)`).exec(url)?.[1] ?? "");
  } catch {
    return "";
  }
}

function mangaHubRequestContext(request) {
  const proxied = request?.url?.startsWith(`${SCRAPINGANT_ENDPOINT}?`) === true;
  const url = proxied ? scrapingAntParameter(request.url, "url") : request?.url ?? "";
  const query = requestJson(request?.data)?.query;
  const pageList = url === MH_API_DOMAIN && typeof query === "string" && /\bchapter\s*\(/.test(query);
  const image = url.startsWith(`${MH_CDN_DOMAIN}/`);
  const accessRefresh = url.startsWith(`${MH_DOMAIN}${ACCESS_KEY_REFRESH_PATH}`);
  const stage = pageList ? "Chapter page list"
    : url.startsWith(MH_API_DOMAIN) ? "MangaHub API"
    : image ? "Chapter image"
    : url.startsWith(`${MH_DOMAIN}${CHAPTER_CRYPTO_PATH}`) ? "Decryption key"
    : accessRefresh ? "Access-token refresh"
    : "MangaHub website";
  return { proxied, pageList, image, accessRefresh, stage, endpoint: url.split(/[?#]/)[0] };
}

function scrapingAntEnabled(config, context) {
  return (context.pageList && config.pageLists) || (context.image && config.images) || (context.accessRefresh && config.pageLists);
}

function scrapingAntHeader(headers, name) {
  const value = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return String(Array.isArray(value) ? value[0] ?? "" : value ?? "");
}

function scrapingAntCooldown(response) {
  const value = scrapingAntHeader(response.headers, "retry-after").trim();
  const delay = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * MILLISECONDS_PER_SECOND
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay)
    ? Math.max(MILLISECONDS_PER_SECOND, delay)
    : SCRAPINGANT_DEFAULT_COOLDOWN_MS;
}

class ScrapingAnt {
  constructor(stateManager, requestTimeout) {
    this.stateManager = stateManager;
    this.requestTimeout = requestTimeout;
    this.pending = Promise.resolve();
    this.activeRequests = new Map();
    this.nextRequestId = 0;
    this.nextKey = 0;
  }

  releaseRequest(id) {
    const slot = [...this.activeRequests.values()].find((slot) => slot.id === id);
    if (!slot) return;
    this.activeRequests.delete(slot.key);
    if (slot.timer !== null && typeof clearTimeout === "function") clearTimeout(slot.timer);
    slot.release();
  }

  recoverRequest() {
    for (const slot of this.activeRequests.values()) {
      if (slot.expiresAt <= Date.now()) this.releaseRequest(slot.id);
    }
  }

  waitForRequest() {
    return { wait: Promise.race([...this.activeRequests.values()].map((slot) => slot.done)) };
  }

  async queueRequest(load) {
    const queuedAt = Date.now();
    while (true) {
      this.recoverRequest();
      const result = await this.enqueue(async () => {
        if (Date.now() - queuedAt >= this.requestTimeout) {
          throw new Error("[ScrapingAnt] Local per-key queue wait timed out. No HTTP request sent; retry the page.");
        }
        const request = await load();
        if (!request) return { request: null };
        if (request.wait) return request;
        const key = scrapingAntParameter(request.url, "x-api-key");
        if (!key) throw new Error("[ScrapingAnt] Proxy request has no API key. No HTTP request sent.");
        const active = this.activeRequests.get(key);
        if (active) return { wait: active.done };
        if (this.activeRequests.size >= SCRAPINGANT_KEY_LABELS.length) return this.waitForRequest();
        const slot = { key, id: String(++this.nextRequestId), release: null, done: null, timer: null, expiresAt: Date.now() + SCRAPINGANT_SLOT_TIMEOUT_MS };
        slot.done = new Promise((resolve) => { slot.release = resolve; });
        this.activeRequests.set(key, slot);
        try {
          if (typeof setTimeout === "function") {
            slot.timer = setTimeout(() => this.releaseRequest(slot.id), SCRAPINGANT_SLOT_TIMEOUT_MS);
          }
          request.headers = { ...request.headers, [SCRAPINGANT_REQUEST_ID_HEADER]: slot.id };
          return { request };
        } catch (error) {
          this.releaseRequest(slot.id);
          throw error;
        }
      });
      if (!result.wait) return result.request;
      await result.wait;
    }
  }

  prepareProxyRequest(request) {
    this.recoverRequest();
    const id = scrapingAntHeader(request.headers, SCRAPINGANT_REQUEST_ID_HEADER);
    const key = scrapingAntParameter(request.url, "x-api-key");
    if (id && this.activeRequests.get(key)?.id === id) return request;
    return this.queueRequest(() => request);
  }

  enqueue(load) {
    const pending = this.pending.then(load);
    this.pending = pending.then(() => {}, () => {});
    return pending;
  }

  async getConfig() {
    const stored = await this.stateManager.retrieve(SCRAPINGANT_CONFIG_STATE);
    return {
      ...Object.fromEntries(SCRAPINGANT_TOGGLES.map(({ id }) => [
        id, typeof stored?.[id] === "boolean" ? stored[id] : stored?.enabled === true
      ])),
      slots: SCRAPINGANT_KEY_LABELS.map((_, index) => ({
        disabled: stored?.slots?.[index]?.disabled === true,
        retryAt: Number.isFinite(stored?.slots?.[index]?.retryAt) ? stored.slots[index].retryAt : 0,
        lastStatus: Number.isInteger(stored?.slots?.[index]?.lastStatus) ? stored.slots[index].lastStatus : 0
      }))
    };
  }

  async getKeys() {
    const stored = await this.stateManager.keychain.retrieve(SCRAPINGANT_KEYS_STATE);
    return SCRAPINGANT_KEY_LABELS.map((_, index) => Array.isArray(stored) && typeof stored[index] === "string" ? stored[index].trim() : "");
  }

  setEnabled(id, enabled) {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      config[id] = enabled === true;
      await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
    });
  }

  setKey(index, value) {
    return this.enqueue(async () => {
      const keys = await this.getKeys();
      keys[index] = typeof value === "string" ? value.trim() : "";
      await this.stateManager.keychain.store(SCRAPINGANT_KEYS_STATE, keys);
      const config = await this.getConfig();
      config.slots[index] = { disabled: false, retryAt: 0 };
      await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
    });
  }

  resetKeys() {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      config.slots = SCRAPINGANT_KEY_LABELS.map(() => ({ disabled: false, retryAt: 0 }));
      await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
    });
  }

  async prepareRequest(request, userAgent) {
    this.recoverRequest();
    if (!scrapingAntEnabled(await this.getConfig(), mangaHubRequestContext(request))) return null;
    return this.queueRequest(() => this.buildRequest(request, userAgent));
  }

  async buildRequest(request, userAgent) {
    const config = await this.getConfig();
    const context = mangaHubRequestContext(request);
    if (!scrapingAntEnabled(config, context)) return null;
    const keys = await this.getKeys();
    if (!keys.some(Boolean)) throw new Error("Add a ScrapingAnt key in MangaHub's source settings, or disable ScrapingAnt.");
    const candidates = keys.map((_, index) => index)
      .filter((index) => keys[index] && keys.indexOf(keys[index]) === index);
    const available = candidates.filter((index) => !config.slots[index].disabled && config.slots[index].retryAt <= Date.now());
    if (available.length) {
      const free = available.filter((index) => !this.activeRequests.has(keys[index]));
      if (!free.length || this.activeRequests.size >= candidates.length) return this.waitForRequest();
      const index = free.find((index) => index >= this.nextKey) ?? free[0];
      this.nextKey = (index + 1) % SCRAPINGANT_KEY_LABELS.length;
      const originalHeaders = {
        ...request.headers ?? {},
        Referer: `${MH_DOMAIN}/`,
        Origin: MH_DOMAIN,
        "User-Agent": userAgent
      };
      const headers = context.pageList ? { "Content-Type": "application/json" } : {};
      const forwardedHeaders = context.pageList
        ? [...SCRAPINGANT_FORWARDED_HEADERS, ...SCRAPINGANT_API_HEADERS]
        : SCRAPINGANT_FORWARDED_HEADERS;
      for (const name of forwardedHeaders) {
        const value = scrapingAntHeader(originalHeaders, name.toLowerCase());
        if (value) headers[`Ant-${name}`] = value;
      }
      return App.createRequest({
        url: `${SCRAPINGANT_ENDPOINT}?url=${encodeURIComponent(request.url)}&x-api-key=${encodeURIComponent(keys[index])}&browser=false&proxy_type=datacenter&timeout=${SCRAPINGANT_TIMEOUT_SECONDS}`,
        method: request.method,
        headers,
        ...(request.data == null ? {} : { data: typeof request.data === "string" ? request.data : JSON.stringify(request.data) }),
        cookies: []
      });
    }
    const reasons = candidates.map((index) => {
      const slot = config.slots[index];
      const reason = SCRAPINGANT_ERROR_REASONS[slot.lastStatus] || "Previously marked unavailable or rate-limited";
      const seconds = Math.max(1, Math.ceil((slot.retryAt - Date.now()) / MILLISECONDS_PER_SECOND));
      return `Key ${index + 1}: ${reason}${slot.lastStatus ? ` (HTTP ${slot.lastStatus})` : ""}. ${slot.disabled ? "Replace the key or reset key availability after credits renew." : `Local cooldown: ${seconds}s remaining.`}`;
    });
    throw new Error(`ScrapingAnt local key availability blocked the request\nRequest: ${context.stage}\nNo HTTP request sent\n${reasons.join("\n")}`);
  }

  async requestError(response, service, fallback) {
    const context = mangaHubRequestContext(response.request);
    const keys = await this.getKeys().catch(() => []);
    const requestKey = context.proxied ? scrapingAntParameter(response.request.url, "x-api-key") : "";
    const index = requestKey ? keys.indexOf(requestKey) : -1;
    const result = requestJson(response.data);
    const messages = Array.isArray(result?.errors)
      ? result.errors.map((error) => typeof error === "string" ? error : [error?.message, error?.extensions?.code].filter((value) => typeof value === "string").join(" / ")).filter(Boolean).join("; ")
      : "";
    const plainText = typeof response.data === "string" && !result && !/<[a-z!]/i.test(response.data) ? response.data.trim() : "";
    const detail = messages || [result?.message, result?.error, result?.detail].find((value) => typeof value === "string" && value) || plainText || fallback;
    const secrets = [...keys, requestKey, ...Object.entries(response.request?.headers ?? {})
      .filter(([name]) => /cookie|authorization|api-key|mhub-access/i.test(name))
      .flatMap(([, value]) => [String(value), ...Array.from(String(value).matchAll(/(?:^|;\s*)[^=;]+=([^;]+)/g), (match) => match[1])])].filter((value) => value && value !== "/");
    const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]"), String(value))
      .replace(/https?:\/\/[^\s"<>]+/gi, (url) => url.split(/[?#]/)[0])
      .replace(/[\r\n]+/g, " ").slice(0, REQUEST_ERROR_DETAIL_LIMIT);
    const retryAfter = scrapingAntHeader(response.headers, context.proxied && service === "MangaHub" ? `${SCRAPINGANT_ORIGINAL_HEADER_PREFIX}retry-after` : "retry-after");
    const route = context.proxied ? `ScrapingAnt${index >= 0 ? ` key ${index + 1}` : ""}` : response.request?.url ? "Direct (local)" : "Unknown route";
    const lines = [
      `[${route}] ${service}: ${redact(detail)}`,
      `Request: ${context.stage}`,
      `Endpoint: ${response.request?.method ?? "GET"} ${context.endpoint}`,
      `HTTP: ${response.status}`,
      ...(retryAfter ? [`Retry-After: ${redact(retryAfter)}`] : [])
    ];
    return new Error(lines.join("\n"));
  }

  async handleResponse(response) {
    const id = scrapingAntHeader(response.request?.headers, SCRAPINGANT_REQUEST_ID_HEADER);
    try {
      return await this.processResponse(response);
    } finally {
      this.releaseRequest(id);
    }
  }

  async processResponse(response) {
    const pageStatus = Number(scrapingAntHeader(response.headers, "ant-page-status-code"));
    const targetStatus = Number.isInteger(pageStatus) && pageStatus >= 100 && pageStatus < 600 ? pageStatus : null;
    if (response.status >= 400 && !(targetStatus >= 400)) {
      if (response.status === 403 || response.status === 409 || response.status === 429) {
        const key = scrapingAntParameter(response.request.url, "x-api-key");
        await this.enqueue(async () => {
          const config = await this.getConfig();
          const keys = await this.getKeys();
          const index = keys.indexOf(key);
          if (!key || index < 0) return;
          const slot = config.slots[index];
          slot.disabled = response.status === 403;
          slot.lastStatus = response.status;
          slot.retryAt = slot.disabled ? 0 : Date.now() + scrapingAntCooldown(response);
          await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
        }).catch(() => {});
      }
      throw await this.requestError(response, "ScrapingAnt", SCRAPINGANT_ERROR_REASONS[response.status] || "The provider did not supply an error reason");
    }
    const targetHeaders = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith(SCRAPINGANT_ORIGINAL_HEADER_PREFIX)) {
        targetHeaders[lowerName.slice(SCRAPINGANT_ORIGINAL_HEADER_PREFIX.length)] = value;
      }
    }
    response.status = targetStatus ?? response.status;
    response.headers = { ...response.headers, ...targetHeaders };
    return response;
  }
}

function createScrapingAntMenu(client, onChange) {
  return App.createDUISection({
    id: "scrapingant",
    isHidden: false,
    rows: async () => [
      ...SCRAPINGANT_TOGGLES.map(({ id, label }) => App.createDUISwitch({
        id: `${SCRAPINGANT_CONFIG_STATE}_${id}`,
        label,
        value: App.createDUIBinding({
          get: async () => (await client.getConfig())[id],
          set: async (value) => {
            await client.setEnabled(id, value);
            onChange();
          }
        })
      })),
      ...SCRAPINGANT_KEY_LABELS.map((label, index) => App.createDUISecureInputField({
        id: `${SCRAPINGANT_KEYS_STATE}_${index}`,
        label,
        value: App.createDUIBinding({
          get: async () => (await client.getKeys())[index],
          set: async (value) => {
            await client.setKey(index, value);
            onChange();
          }
        })
      })),
      App.createDUIButton({
        id: "scrapingant_reset",
        label: "Reset ScrapingAnt key availability",
        onTap: async () => {
          await client.resetKeys();
          onChange();
        }
      })
    ]
  });
}
