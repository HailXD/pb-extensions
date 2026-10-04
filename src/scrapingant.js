const SCRAPINGANT_ENDPOINT = "https://api.scrapingant.com/v2/general";
const SCRAPINGANT_CONFIG_STATE = "scrapingant_config";
const SCRAPINGANT_KEYS_STATE = "scrapingant_keys";
const SCRAPINGANT_KEY_LABELS = ["ScrapingAnt key 1", "ScrapingAnt key 2"];
const SCRAPINGANT_TIMEOUT_SECONDS = 20;
const SCRAPINGANT_ORIGINAL_HEADER_PREFIX = "ant-original-header-";
const SCRAPINGANT_FORWARDED_HEADERS = ["Accept", "Referer", "Origin", "User-Agent"];
const SCRAPINGANT_API_HEADERS = ["Content-Type", "x-mhub-access"];
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
  const stage = pageList ? "Chapter page list"
    : url.startsWith(MH_API_DOMAIN) ? "MangaHub API"
    : url.startsWith(`${MH_CDN_DOMAIN}/`) ? "Chapter image"
    : url.startsWith(`${MH_DOMAIN}${CHAPTER_CRYPTO_PATH}`) ? "Decryption key"
    : url.startsWith(`${MH_DOMAIN}${ACCESS_KEY_REFRESH_PATH}`) ? "Access-token refresh"
    : "MangaHub website";
  return { proxied, pageList, stage, endpoint: url.split(/[?#]/)[0] };
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
    this.networkPending = Promise.resolve();
    this.activeRequest = null;
    this.nextRequestId = 0;
    this.nextKey = 0;
  }

  releaseRequest(id) {
    const slot = this.activeRequest;
    if (!slot || slot.id !== id) return;
    this.activeRequest = null;
    if (slot.timer !== null && typeof clearTimeout === "function") clearTimeout(slot.timer);
    slot.release();
  }

  recoverRequest() {
    if (this.activeRequest && this.activeRequest.expiresAt <= Date.now()) {
      this.releaseRequest(this.activeRequest.id);
    }
  }

  async queueRequest(load) {
    this.recoverRequest();
    const previous = this.networkPending;
    const slot = { id: String(++this.nextRequestId), release: null, timer: null, expiresAt: 0 };
    this.networkPending = new Promise((resolve) => { slot.release = resolve; });
    const queuedAt = Date.now();
    await previous;
    if (Date.now() - queuedAt >= this.requestTimeout) {
      slot.release();
      throw new Error("[ScrapingAnt] Local single-request queue wait timed out. No HTTP request sent; retry the page.");
    }
    this.activeRequest = slot;
    slot.expiresAt = Date.now() + SCRAPINGANT_SLOT_TIMEOUT_MS;
    try {
      if (typeof setTimeout === "function") {
        slot.timer = setTimeout(() => this.releaseRequest(slot.id), SCRAPINGANT_SLOT_TIMEOUT_MS);
      }
      const request = await load();
      if (this.activeRequest !== slot) throw new Error("[ScrapingAnt] Local request slot expired before sending. Retry the page.");
      if (request) {
        request.headers = { ...request.headers, [SCRAPINGANT_REQUEST_ID_HEADER]: slot.id };
      } else {
        this.releaseRequest(slot.id);
      }
      return request;
    } catch (error) {
      this.releaseRequest(slot.id);
      throw error;
    }
  }

  prepareProxyRequest(request) {
    this.recoverRequest();
    const id = scrapingAntHeader(request.headers, SCRAPINGANT_REQUEST_ID_HEADER);
    if (id && this.activeRequest?.id === id) return request;
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
      enabled: stored?.enabled === true,
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

  setEnabled(enabled) {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      config.enabled = enabled === true;
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
    if (!(await this.getConfig()).enabled) return null;
    return this.queueRequest(() => this.buildRequest(request, userAgent));
  }

  buildRequest(request, userAgent) {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      if (!config.enabled) return null;
      const keys = await this.getKeys();
      if (!keys.some(Boolean)) throw new Error("Add a ScrapingAnt key in MangaHub's source settings, or disable ScrapingAnt.");
      const candidates = keys.map((_, index) => index)
        .filter((index) => keys[index] && keys.indexOf(keys[index]) === index);
      const available = candidates.filter((index) => !config.slots[index].disabled && config.slots[index].retryAt <= Date.now());
      const context = mangaHubRequestContext(request);
      if (available.length) {
        const index = available[this.nextKey % available.length];
        this.nextKey = available.length > 1 ? (this.nextKey + 1) % available.length : 0;
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
    });
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
      App.createDUISwitch({
        id: SCRAPINGANT_CONFIG_STATE,
        label: "ScrapingAnt page lists and images",
        value: App.createDUIBinding({
          get: async () => (await client.getConfig()).enabled,
          set: async (value) => {
            await client.setEnabled(value);
            onChange();
          }
        })
      }),
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
