const MH_DOMAIN = "https://mangahub.io";
const MH_API_DOMAIN = "https://api.mghcdn.com/graphql";
const MH_CDN_DOMAIN = "https://imgx.mghcdn.com";
const CHAPTER_CRYPTO_PATH = "/api/chapter-crypto";
const ENCRYPTED_PAGES_PREFIX = "enc:v1:";
const KEY_EXPIRY_SAFETY_MARGIN_MS = 30_000;
const DEFAULT_KEY_TTL_MS = 5 * 60_000;
const AES_KEY_BITS = 256;
const GCM_IV_BITS = 96;
const GCM_TAG_BITS = 128;
const ACCESS_KEY_STATE = "mhub_key";
const ACCESS_COOKIE_NAME = "mhub_access";
const ACCESS_KEY_REFRESH_PATH = "/chapter/the-last-human/chapter-1?reloadKey=1";
const MAX_CHAPTER_ATTEMPTS = 2;
const RETRYABLE_API_ERROR = /rate\s*limit|api\s*key|encryption unavailable|unauth|access.*(?:invalid|expired)/i;

function parseResponse(response, label) {
  if (response.status === 403 || response.status === 503) {
    throw new Error(`${label}: MangaHub is unavailable or requires Cloudflare verification. Open the source's Cloudflare bypass and try again.`);
  }
  if (response.status >= 400) {
    throw new Error(`${label}: MangaHub returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.data);
  } catch {
    throw new Error(`${label}: MangaHub returned an invalid response. Try the source's Cloudflare bypass.`);
  }
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.replace(/=+$/, "").length % 4 === 1) {
    throw new Error("Invalid chapter encryption data");
  }
  return sjcl.codec.base64url.toBits(value);
}

function parseEncryptedPagesEnvelope(encoded) {
  const parts = encoded.split(":");
  if (!encoded.startsWith(ENCRYPTED_PAGES_PREFIX) || parts.length !== 6 || parts.some((part) => !part)) {
    throw new Error("Unrecognized chapter pages encoding");
  }
  const keyId = parts[2];
  const iv = decodeBase64Url(parts[3]);
  const authTag = decodeBase64Url(parts[4]);
  const ciphertext = decodeBase64Url(parts[5]);
  if (sjcl.bitArray.bitLength(iv) !== GCM_IV_BITS || sjcl.bitArray.bitLength(authTag) !== GCM_TAG_BITS) {
    throw new Error("Invalid chapter encryption nonce or authentication tag");
  }
  return { keyId, iv, authTag, ciphertext };
}

function parsePageUrls(pagesJson) {
  const payload = JSON.parse(pagesJson);
  if (!payload || typeof payload.p !== "string" || !Array.isArray(payload.i) || !payload.i.length || payload.i.some((image) => typeof image !== "string" || !image)) {
    throw new Error("MangaHub returned an invalid or empty chapter page list");
  }
  return payload.i.map((image) => `${MH_CDN_DOMAIN}/${payload.p}${image}`);
}

class ChapterKeyMismatchError extends Error {
  constructor() {
    super("MangaHub rotated its chapter encryption key. Please reload this chapter.");
  }
}

class ChapterCrypto {
  constructor(requestManager) {
    this.requestManager = requestManager;
    this.key = null;
    this.pendingKey = null;
  }

  async fetchKey() {
    const request = App.createRequest({
      url: `${MH_DOMAIN}${CHAPTER_CRYPTO_PATH}`,
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" }
    });
    const response = await this.requestManager.schedule(request, 1);
    const data = parseResponse(response, "Chapter decryption key unavailable");
    if (typeof data?.keyId !== "string" || !data.keyId || typeof data.key !== "string") {
      throw new Error("Chapter decryption key unavailable");
    }
    const keyBits = decodeBase64Url(data.key);
    if (sjcl.bitArray.bitLength(keyBits) !== AES_KEY_BITS) {
      throw new Error("MangaHub returned an invalid chapter decryption key");
    }
    return {
      keyId: data.keyId,
      cipher: new sjcl.cipher.aes(keyBits),
      expiresAt: typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)
        ? data.expiresAt
        : Date.now() + DEFAULT_KEY_TTL_MS
    };
  }

  async getKey(keyId) {
    if (this.key?.keyId === keyId && this.key.expiresAt > Date.now() + KEY_EXPIRY_SAFETY_MARGIN_MS) {
      return this.key;
    }
    if (!this.pendingKey) {
      this.pendingKey = this.fetchKey().then((key) => {
        this.key = key;
        return key;
      }).finally(() => {
        this.pendingKey = null;
      });
    }
    return this.pendingKey;
  }

  async resolvePageUrls(pagesField) {
    if (typeof pagesField !== "string" || !pagesField) {
      throw new Error("MangaHub returned no chapter pages");
    }
    if (!pagesField.startsWith("enc:")) return parsePageUrls(pagesField);
    const envelope = parseEncryptedPagesEnvelope(pagesField);
    const key = await this.getKey(envelope.keyId);
    if (key.keyId !== envelope.keyId) throw new ChapterKeyMismatchError();
    const combined = sjcl.bitArray.concat(envelope.ciphertext, envelope.authTag);
    const plaintext = (() => {
      try {
        return sjcl.mode.gcm.decrypt(key.cipher, combined, envelope.iv, [], GCM_TAG_BITS);
      } catch {
        this.key = null;
        throw new Error("Chapter page authentication failed. Please reload this chapter.");
      }
    })();
    return parsePageUrls(sjcl.codec.utf8String.fromBits(plaintext));
  }
}
