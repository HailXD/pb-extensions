const SCRAPINGANT_ENDPOINT = "https://api.scrapingant.com/v2/general";
const SCRAPINGANT_CONFIG_STATE = "scrapingant_config";
const SCRAPINGANT_KEYS_STATE = "scrapingant_keys";
const SCRAPINGANT_KEY_LABELS = ["ScrapingAnt key 1", "ScrapingAnt key 2"];
const SCRAPINGANT_TIMEOUT_SECONDS = 20;
const SCRAPINGANT_ORIGINAL_HEADER_PREFIX = "ant-original-header-";
const SCRAPINGANT_FORWARDED_HEADERS = ["Accept", "Referer", "Origin", "User-Agent"];
const SCRAPINGANT_DEFAULT_COOLDOWN_MS = 60_000;
const MILLISECONDS_PER_SECOND = 1_000;

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
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.pending = Promise.resolve();
    this.nextKey = 0;
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

  prepareImageRequest(request, userAgent) {
    return this.enqueue(async () => {
      const config = await this.getConfig();
      if (!config.enabled) return null;
      const keys = await this.getKeys();
      if (!keys.some(Boolean)) throw new Error("Add a ScrapingAnt key in MangaHub's source settings, or disable ScrapingAnt.");
      const candidates = keys.map((_, index) => index)
        .filter((index) => keys[index] && keys.indexOf(keys[index]) === index);
      const available = candidates.filter((index) => !config.slots[index].disabled && config.slots[index].retryAt <= Date.now());
      if (available.length) {
        const index = available[this.nextKey % available.length];
        this.nextKey = available.length > 1 ? (this.nextKey + 1) % available.length : 0;
        const originalHeaders = {
          ...request.headers ?? {},
          Referer: `${MH_DOMAIN}/`,
          Origin: MH_DOMAIN,
          "User-Agent": userAgent
        };
        const headers = {};
        for (const name of SCRAPINGANT_FORWARDED_HEADERS) {
          const value = scrapingAntHeader(originalHeaders, name.toLowerCase());
          if (value) headers[`Ant-${name}`] = value;
        }
        return App.createRequest({
          url: `${SCRAPINGANT_ENDPOINT}?url=${encodeURIComponent(request.url)}&x-api-key=${encodeURIComponent(keys[index])}&browser=false&proxy_type=datacenter&timeout=${SCRAPINGANT_TIMEOUT_SECONDS}`,
          method: "GET",
          headers,
          cookies: []
        });
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

  async handleImageResponse(response) {
    const pageStatus = Number(scrapingAntHeader(response.headers, "ant-page-status-code"));
    const targetStatus = Number.isInteger(pageStatus) && pageStatus >= 100 && pageStatus < 600 ? pageStatus : null;
    if (response.status >= 400 && !(targetStatus >= 400)) {
      if (response.status === 403 || response.status === 409 || response.status === 429) {
        const key = decodeURIComponent(/[?&]x-api-key=([^&]*)/.exec(response.request.url)?.[1] ?? "");
        await this.enqueue(async () => {
          const config = await this.getConfig();
          const keys = await this.getKeys();
          const index = keys.indexOf(key);
          if (!key || index < 0) return;
          const slot = config.slots[index];
          slot.disabled = response.status === 403;
          slot.retryAt = slot.disabled ? 0 : Date.now() + scrapingAntCooldown(response);
          await this.stateManager.store(SCRAPINGANT_CONFIG_STATE, config);
        });
      }
      throw new Error(`ScrapingAnt returned HTTP ${response.status}. Retry the page later, check key availability, or disable ScrapingAnt in source settings.`);
    }
    const targetHeaders = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith(SCRAPINGANT_ORIGINAL_HEADER_PREFIX)) {
        targetHeaders[lowerName.slice(SCRAPINGANT_ORIGINAL_HEADER_PREFIX.length)] = value;
      }
    }
    return {
      status: targetStatus ?? response.status,
      data: response.data,
      rawData: response.rawData,
      headers: { ...response.headers, ...targetHeaders },
      request: response.request
    };
  }
}

function createScrapingAntMenu(client, onChange) {
  return App.createDUISection({
    id: "scrapingant",
    isHidden: false,
    rows: async () => [
      App.createDUISwitch({
        id: SCRAPINGANT_CONFIG_STATE,
        label: "ScrapingAnt page image downloads",
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
