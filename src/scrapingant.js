const SCRAPINGANT_ENDPOINT = "https://api.scrapingant.com/v2/general";
const SCRAPINGANT_CONFIG_STATE = "scrapingant_config";
const SCRAPINGANT_KEYS_STATE = "scrapingant_keys";
const SCRAPINGANT_KEY_LABELS = ["ScrapingAnt key 1", "ScrapingAnt key 2"];
const SCRAPINGANT_REQUESTS_PER_SECOND = 1;
const SCRAPINGANT_TIMEOUT_SECONDS = 20;
const SCRAPINGANT_REQUEST_TIMEOUT_MS = 30_000;
const SCRAPINGANT_ORIGINAL_HEADER_PREFIX = "ant-original-header-";
const SCRAPINGANT_FORWARDED_HEADERS = ["Accept", "Content-Type", "Referer", "Origin", "User-Agent", "x-mhub-access"];

function scrapingAntHeader(headers, name) {
  const value = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return String(Array.isArray(value) ? value[0] ?? "" : value ?? "");
}

class ScrapingAnt {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.pending = Promise.resolve();
    this.nextKey = 0;
    this.requestManager = App.createRequestManager({
      requestsPerSecond: SCRAPINGANT_REQUESTS_PER_SECOND,
      requestTimeout: SCRAPINGANT_REQUEST_TIMEOUT_MS
    });
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
        retryAt: Number.isFinite(stored?.slots?.[index]?.retryAt) ? stored.slots[index].retryAt : 0
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

  schedule(request, prepareRequest, handleResponse) {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      if (!config.enabled) return null;
      const keys = await this.getKeys();
      if (!keys.some(Boolean)) throw new Error("Add a ScrapingAnt key in MangaHub's source settings, or disable ScrapingAnt.");
      const candidates = keys.map((_, offset) => (this.nextKey + offset) % keys.length)
        .filter((index) => keys[index] && keys.indexOf(keys[index]) === index);
      for (const index of candidates) {
        const slot = config.slots[index];
        if (slot.disabled || slot.retryAt > Date.now()) continue;
        await prepareRequest();
        this.nextKey = (index + 1) % keys.length;
        const headers = { "Content-Type": "application/json" };
        for (const name of SCRAPINGANT_FORWARDED_HEADERS) {
          const value = request.headers[name];
          if (value) headers[`Ant-${name}`] = value;
        }
        const proxyRequest = App.createRequest({
          url: `${SCRAPINGANT_ENDPOINT}?url=${encodeURIComponent(request.url)}&x-api-key=${encodeURIComponent(keys[index])}&browser=false&proxy_type=datacenter&timeout=${SCRAPINGANT_TIMEOUT_SECONDS}`,
          method: request.method,
          headers,
          data: typeof request.data === "string" ? request.data : JSON.stringify(request.data),
          cookies: []
        });
        const response = await this.requestManager.schedule(proxyRequest, 1).catch(() => {
          throw new Error("ScrapingAnt request failed or timed out. Retry the chapter, or disable ScrapingAnt in source settings.");
        });
        const pageStatus = Number(scrapingAntHeader(response.headers, "ant-page-status-code"));
        const targetStatus = Number.isInteger(pageStatus) && pageStatus >= 100 && pageStatus < 600 ? pageStatus : null;
        if (response.status >= 400 && !(targetStatus >= 400)) {
          if (response.status === 403 || response.status === 409 || response.status === 429) {
            slot.disabled = response.status === 403;
            slot.retryAt = slot.disabled ? 0 : Date.now() + rateLimitCooldown(response);
            await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
            continue;
          }
          if (response.status === 423) {
            throw new Error("ScrapingAnt was blocked by MangaHub with browser=false. Disable ScrapingAnt and try the source's Cloudflare bypass.");
          }
          throw new Error(`ScrapingAnt returned HTTP ${response.status}. Retry later or disable ScrapingAnt in source settings.`);
        }
        const targetHeaders = {};
        for (const [name, value] of Object.entries(response.headers ?? {})) {
          const lowerName = name.toLowerCase();
          if (lowerName.startsWith(SCRAPINGANT_ORIGINAL_HEADER_PREFIX)) {
            targetHeaders[lowerName.slice(SCRAPINGANT_ORIGINAL_HEADER_PREFIX.length)] = value;
          }
        }
        const targetResponse = {
          status: targetStatus ?? response.status,
          data: response.data,
          headers: targetHeaders,
          request
        };
        await handleResponse(targetResponse);
        return targetResponse;
      }
      const retryTimes = candidates.filter((index) => !config.slots[index].disabled)
        .map((index) => config.slots[index].retryAt);
      if (retryTimes.length) {
        const seconds = Math.max(1, Math.ceil((Math.min(...retryTimes) - Date.now()) / MILLISECONDS_PER_SECOND));
        throw new Error(`ScrapingAnt keys are temporarily busy or rate-limited. Wait ${seconds} seconds before retrying.`);
      }
      throw new Error("ScrapingAnt keys are invalid or out of credits. Replace them in source settings, or use Reset ScrapingAnt key availability after credits renew. You can also disable ScrapingAnt.");
    });
  }
}

function createScrapingAntMenu(client, onChange) {
  return App.createDUISection({
    id: "scrapingant",
    isHidden: false,
    rows: async () => [
      App.createDUISwitch({
        id: SCRAPINGANT_CONFIG_STATE,
        label: "ScrapingAnt chapter page lists",
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
