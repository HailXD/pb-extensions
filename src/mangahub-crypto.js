/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */
/* Adapted from https://github.com/kittycatgit/kitty-extensions-0.8/tree/94f794a5399b55c77fa80965395ef0142acd8350/src/MangaHub/crypto.ts */

// The site encrypts a chapter's page list with AES-256-GCM and hands the key out
// from /api/chapter-crypto. GCM is counter mode under the hood, so the payload is
// read with CTR starting at the second block. The tag is not recomputed: a wrong
// key yields garbage that fails to parse, which is the same outcome. The runtime
// has no WebCrypto, atob or TextDecoder, so all of it lives here.

const SBOX_HEX =
  "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0" +
  "b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275" +
  "09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cf" +
  "d0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2" +
  "cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdb" +
  "e0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08" +
  "ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9e" +
  "e1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16";

const SBOX = (() => {
  const table = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    table[i] = parseInt(SBOX_HEX.substring(i * 2, i * 2 + 2), 16);
  }

  return table;
})();

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
const ROUNDS = 14;

const xtime = (byte) => ((byte << 1) ^ (byte & 0x80 ? 0x1b : 0)) & 0xff;

/** AES-256 key schedule: 15 round keys of 16 bytes. */
function expandKey(key) {
  const words = 8;
  const schedule = new Uint8Array(16 * (ROUNDS + 1));
  schedule.set(key, 0);

  for (let i = words; i < 4 * (ROUNDS + 1); i++) {
    const at = i * 4;
    let a = schedule[at - 4];
    let b = schedule[at - 3];
    let c = schedule[at - 2];
    let d = schedule[at - 1];

    if (i % words === 0) {
      const rotated = [SBOX[b] ^ RCON[i / words], SBOX[c], SBOX[d], SBOX[a]];
      [a, b, c, d] = [rotated[0], rotated[1], rotated[2], rotated[3]];
    } else if (i % words === 4) {
      [a, b, c, d] = [SBOX[a], SBOX[b], SBOX[c], SBOX[d]];
    }

    schedule[at] = schedule[at - words * 4] ^ a;
    schedule[at + 1] = schedule[at - words * 4 + 1] ^ b;
    schedule[at + 2] = schedule[at - words * 4 + 2] ^ c;
    schedule[at + 3] = schedule[at - words * 4 + 3] ^ d;
  }

  return schedule;
}

function encryptBlock(schedule, block) {
  const addRoundKey = (round) => {
    for (let i = 0; i < 16; i++) {
      block[i] ^= schedule[round * 16 + i];
    }
  };

  const subBytes = () => {
    for (let i = 0; i < 16; i++) {
      block[i] = SBOX[block[i]];
    }
  };

  // The state is column major, so byte c * 4 + r holds row r of column c.
  const shiftRows = () => {
    for (let row = 1; row < 4; row++) {
      const current = [block[row], block[4 + row], block[8 + row], block[12 + row]];

      for (let column = 0; column < 4; column++) {
        block[column * 4 + row] = current[(column + row) % 4];
      }
    }
  };

  const mixColumns = () => {
    for (let column = 0; column < 4; column++) {
      const at = column * 4;
      const a0 = block[at];
      const a1 = block[at + 1];
      const a2 = block[at + 2];
      const a3 = block[at + 3];
      const parity = a0 ^ a1 ^ a2 ^ a3;

      block[at] = a0 ^ parity ^ xtime(a0 ^ a1);
      block[at + 1] = a1 ^ parity ^ xtime(a1 ^ a2);
      block[at + 2] = a2 ^ parity ^ xtime(a2 ^ a3);
      block[at + 3] = a3 ^ parity ^ xtime(a3 ^ a0);
    }
  };

  addRoundKey(0);

  for (let round = 1; round < ROUNDS; round++) {
    subBytes();
    shiftRows();
    mixColumns();
    addRoundKey(round);
  }

  subBytes();
  shiftRows();
  addRoundKey(ROUNDS);
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlToBytes(value) {
  const clean = value
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[^A-Za-z0-9\-_]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;

  for (const character of clean) {
    const index = B64URL.indexOf(character);

    if (index < 0) {
      throw new Error("The chapter payload is not valid base64url");
    }

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (buffer >> bits) & 0xff;
    }
  }

  return bytes.subarray(0, written);
}

function utf8Decode(bytes) {
  let out = "";

  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i];
    const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
    let code = width === 1 ? byte : byte & (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07);

    for (let k = 1; k < width; k++) {
      code = (code << 6) | (bytes[i + k] & 0x3f);
    }

    i += width;

    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }

  return out;
}

/**
 * Decrypts an `enc:v1:<keyId>:<nonce>:<tag>:<ciphertext>` chapter payload.
 * @param keys the keys this access token holds, by key id
 */
function decryptEncV1(payload, keys) {
  const parts = payload.split(":");

  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("The chapter payload is not in the enc:v1 format");
  }

  const keyId = parts[2];
  const key = keys[keyId];

  if (!key) {
    throw new Error(`The site encrypted the chapter with a key it did not hand out (${keyId})`);
  }

  const keyBytes = base64UrlToBytes(key);
  const nonce = base64UrlToBytes(parts[3]);

  if (keyBytes.length !== 32 || nonce.length !== 12) {
    throw new Error("The chapter key or nonce is the wrong size");
  }

  const ciphertext = base64UrlToBytes(parts[5]);
  const schedule = expandKey(keyBytes);
  // GCM builds its first counter block from the 96 bit nonce as nonce||1 and
  // encrypts that for the tag, so the page data starts one block later.
  const counter = new Uint8Array(16);
  counter.set(nonce, 0);
  let block = 2;

  const plain = new Uint8Array(ciphertext.length);
  const keystream = new Uint8Array(16);

  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    counter[12] = (block >>> 24) & 0xff;
    counter[13] = (block >>> 16) & 0xff;
    counter[14] = (block >>> 8) & 0xff;
    counter[15] = block & 0xff;
    block++;

    keystream.set(counter);
    encryptBlock(schedule, keystream);

    const span = Math.min(16, ciphertext.length - offset);

    for (let i = 0; i < span; i++) {
      plain[offset + i] = ciphertext[offset + i] ^ keystream[i];
    }
  }

  return utf8Decode(plain);
}
