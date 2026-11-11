"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSourceResolver, createRoomCreationQuota } = require("../room-creation-quota");
const { makeHarness, last } = require("./helpers/socket-hardening-harness.cjs");
const socket = (address, forwarded) => ({ request: { socket: { remoteAddress: address }, headers: { "x-forwarded-for": forwarded } } });

test("quota : adresse réseau normalisée, en-têtes ignorés sans proxy approuvé", () => {
  const source = createSourceResolver();
  assert.equal(source(socket("::ffff:192.0.2.5", "198.51.100.1")), "192.0.2.5");
  assert.equal(source(socket("::ffff:c000:205")), "192.0.2.5");
  assert.equal(source(socket("2001:0db8:0000::0001")), source(socket("2001:db8::1")));
  assert.equal(source(socket("192.0.2.5", "different-on-every-tab")), "192.0.2.5");
});

test("quota : chaîne de proxies parcourue depuis le pair, arrêt au premier relais non approuvé", () => {
  const source = createSourceResolver("10.0.0.0/8,::1,2001:db8:1::/48");
  assert.equal(source(socket("10.0.0.1", "192.0.2.2, 10.0.0.2")), "192.0.2.2");
  assert.equal(source(socket("10.0.0.1", "198.51.100.99, 192.0.2.2, 10.0.0.2")), "192.0.2.2");
  assert.equal(source(socket("192.0.2.2", "198.51.100.99")), "192.0.2.2");
  assert.equal(source(socket("2001:db8:1::1", "2001:db8:2::1")), "2001:db8:2::1");
  for (const invalid of ["bad", "192.0.2.2, bad", "1".repeat(2049), ["192.0.2.2"]]) {
    assert.equal(source(socket("10.0.0.1", invalid)), "10.0.0.1");
  }
  for (const invalid of ["true", "10.0.0.0/33", "::1/129", "example.org"]) {
    assert.throws(() => createSourceResolver(invalid), /LQS_TRUSTED_PROXIES/);
  }
});

test("quota : mémoire bornée sans éviction permettant de contourner une limite, nettoyage à expiration", () => {
  const quota = createRoomCreationQuota({ windowMs: 1000, limit: 1, maxSources: 2 });
  for (const source of ["a", "b"]) { assert.equal(quota.check(source, 0), null); quota.record(source, 0); }
  assert.match(quota.check("c", 999), /saturé/);
  assert.match(quota.check("a", 999), /Trop de salles/);
  assert.equal(quota.sourceCount, 2);
  assert.equal(quota.check("c", 1000), null);
  assert.equal(quota.sourceCount, 0);
});

test("createRoom : même source limitée entre identités, onglets et reconnexions ; autre source indépendante", () => {
  const h = makeHarness({ LQS_ROOM_CREATE_LIMIT: "1", LQS_ROOM_CREATE_WINDOW_MS: "1000", LQS_ROOM_LIMIT: "3" });
  const first = h.socket("first", "::ffff:192.0.2.1");
  first.send("createRoom", { playerId: "first", pseudo: "Premier" });
  const code = first.roomCode;
  first.send("disconnect");
  const reconnect = h.socket("first", "192.0.2.1");
  reconnect.send("joinRoom", { roomCode: code, playerId: "first", pseudo: "Retour" });
  assert.equal(reconnect.roomCode, code);
  const tab = h.socket("new-id", "192.0.2.1", { "x-forwarded-for": "198.51.100.9" });
  tab.send("createRoom", { playerId: "new-id", pseudo: "Nouvel onglet" });
  assert.match(last(h, "errorMessage", tab), /Trop de salles.*connexion/);
  const other = h.socket("other", "192.0.2.2");
  other.send("createRoom", { playerId: "other", pseudo: "Autre source" });
  assert.ok(other.roomCode);
  assert.equal(Object.keys(h.api.rooms).length, 2);
  h.advance(1000);
  tab.send("createRoom", { playerId: "new-id", pseudo: "Après délai" });
  assert.ok(tab.roomCode);
  const capped = h.socket("capped", "192.0.2.3");
  capped.send("createRoom", { playerId: "capped", pseudo: "Plafond" });
  assert.match(last(h, "errorMessage", capped), /maximal de salles/);
});

test("createRoom : sources distinctes derrière un proxy configuré et compteur borné côté serveur", () => {
  const h = makeHarness({ LQS_TRUSTED_PROXIES: "10.0.0.0/8", LQS_ROOM_CREATE_LIMIT: "1", LQS_ROOM_CREATE_MAX_SOURCES: "2" });
  const create = (id, forwarded) => {
    const client = h.socket(id, "10.0.0.1", { "x-forwarded-for": forwarded });
    client.send("createRoom", { playerId: id, pseudo: id });
    return client;
  };
  assert.ok(create("first", "192.0.2.1").roomCode);
  assert.match(last(h, "errorMessage", create("spoof", "198.51.100.9, 192.0.2.1")), /Trop de salles/);
  assert.ok(create("second", "192.0.2.2").roomCode);
  assert.match(last(h, "errorMessage", create("third", "192.0.2.3")), /saturé/);
  assert.equal(h.api.roomCreationQuota.sourceCount, 2);
  assert.equal(Object.keys(h.api.rooms).length, 2);
});
