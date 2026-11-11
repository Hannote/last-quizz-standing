"use strict";

const { BlockList, isIP } = require("node:net");

function normalizeAddress(value) {
  if (typeof value !== "string" || value.length > 128) return null;
  const address = value.trim();
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6 || address.includes("%")) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/i.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function createSourceResolver(trustedProxySetting = "") {
  const trusted = new BlockList();
  for (const entry of trustedProxySetting.split(",").map(value => value.trim()).filter(Boolean)) {
    const parts = entry.split("/");
    const address = normalizeAddress(parts[0]);
    if (!address || parts.length > 2) throw new Error(`LQS_TRUSTED_PROXIES : adresse invalide (${entry}).`);
    const family = isIP(address) === 4 ? "ipv4" : "ipv6";
    if (parts.length === 1) trusted.addAddress(address, family);
    else {
      let prefix = /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
      if (isIP(parts[0]) === 6 && family === "ipv4") prefix -= 96;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === "ipv4" ? 32 : 128)) {
        throw new Error(`LQS_TRUSTED_PROXIES : réseau invalide (${entry}).`);
      }
      trusted.addSubnet(address, prefix, family);
    }
  }
  const isTrusted = address => trusted.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  return socket => {
    const peer = normalizeAddress(socket.request?.socket?.remoteAddress || socket.conn?.remoteAddress || socket.handshake?.address);
    if (!peer) return "unknown";
    if (!isTrusted(peer)) return peer;
    const header = socket.request?.headers?.["x-forwarded-for"] ?? socket.handshake?.headers?.["x-forwarded-for"];
    if (typeof header !== "string" || header.length > 2048) return peer;
    const chain = header.split(",").map(normalizeAddress);
    if (!chain.length || chain.some(address => !address)) return peer;
    let source = peer;
    // Remonter uniquement les relais explicitement approuvés, de droite à gauche.
    for (let index = chain.length - 1; index >= 0 && isTrusted(source); index--) source = chain[index];
    return source;
  };
}

function createRoomCreationQuota({ windowMs, limit, maxSources }) {
  const sources = new Map();
  function prune(now) {
    for (const [source, timestamps] of sources) {
      while (timestamps.length && now - timestamps[0] >= windowMs) timestamps.shift();
      if (!timestamps.length) sources.delete(source);
    }
  }
  return {
    get sourceCount() { return sources.size; },
    check(source, now = Date.now()) {
      prune(now);
      const timestamps = sources.get(source);
      if (timestamps?.length >= limit) return "Trop de salles créées récemment depuis votre connexion. Réessayez après expiration du délai.";
      // Ne pas évincer une source active : cela permettrait de remettre son quota à zéro.
      if (!timestamps && sources.size >= maxSources) return "Suivi des créations de salles saturé. Réessayez plus tard.";
      return null;
    },
    record(source, now = Date.now()) {
      if (!sources.has(source)) sources.set(source, []);
      sources.get(source).push(now);
    }
  };
}

module.exports = { createSourceResolver, createRoomCreationQuota };
