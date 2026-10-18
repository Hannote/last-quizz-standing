"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public_2/index.html"), "utf8");
const start = source.indexOf("const LISTE_FINALE_FRAMES =");
const end = source.indexOf("function cleanUpBehindScenes()", start);
assert.ok(start >= 0 && end > start);

function harness(elapsedMs = 0, winners = [{ playerId: "p1", pseudo: "Alice" }]) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const elements = new Map();
  for (const id of ["liste-finale-overlay", "listeFinaleFrame", "listeFinaleLabel", "listeFinaleNames"]) {
    const classes = new Set();
    elements.set(id, { textContent: "", src: "", dataset: {}, classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    } });
  }
  const images = [];
  class Image {
    set src(url) { this.url = url; images.push(url); }
    decode() { return Promise.resolve(); }
  }
  const sounds = [];
  class Howl {
    constructor(options) { this.options = options; this.plays = []; this.seeks = []; this.stops = []; sounds.push(this); }
    duration() { return 30; }
    play() { const id = ++nextId; this.plays.push({ id, at: now }); this.options.onplay.call(this, id); return id; }
    seek(seconds, id) { this.seeks.push({ seconds, id }); }
    stop(id) { this.stops.push({ id, at: now }); }
    once() {}
  }
  const c = {
    Image, Howl, Promise, console: { warn: assert.fail }, isQuitting: false,
    currentRoom: { roomCode: "ABCD", gameMode: "liste", listeTournament: { tournamentId: "tour" } },
    currentGameState: { phase: "listeFinished", roundNumber: 1 },
    performance: { now: () => now },
    document: { getElementById: (id) => elements.get(id) },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(source.slice(start, end) +
    "\nglobalThis.api = { listeFinaleFrameAt, preloadListeFinale, syncListeFinale, stopListeFinale };", c);
  const info = { gameMode: "liste", tournamentId: "tour", roundNumber: 1, startedAt: 1000,
    durationMs: 20000, elapsedMs, winners };
  function advance(ms) {
    const endAt = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > endAt) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = endAt;
  }
  return { c, info, images, sounds, elements, timers, advance, ...c.api };
}

test("poses Liste : va et vient sans extrémité répétée, 150 ms, arrêt exact à 20 s", () => {
  const h = harness();
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => h.listeFinaleFrameAt(i * 150)),
    [0, 1, 2, 3, 4, 3, 2, 1, 0, 1]);
  assert.equal(h.listeFinaleFrameAt(19999), 3);
  assert.equal(h.listeFinaleFrameAt(20000), 3);
});

test("images décodées, son et première pose ensemble ; événement répété, arrêt et nettoyage", async () => {
  const h = harness();
  h.syncListeFinale({ listeFinale: h.info });
  assert.deepEqual(h.images, Array.from({ length: 5 }, (_, i) => `/animation_liste/fin/fin_${i}.png`));
  assert.equal(h.sounds[0].options.src[0], "/animation_liste/fin/fin_son.mp3");
  assert.equal(h.sounds[0].options.loop, false);
  assert.equal(h.sounds[0].plays.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.elements.get("listeFinaleFrame").src, "/animation_liste/fin/fin_0.png");
  assert.equal(h.sounds[0].plays.length, 1);
  h.syncListeFinale({ listeFinale: { ...h.info, elapsedMs: 0 } });
  assert.equal(h.sounds[0].plays.length, 1);
  h.advance(150);
  assert.equal(h.elements.get("listeFinaleFrame").src, "/animation_liste/fin/fin_1.png");
  h.advance(19850);
  assert.equal(h.elements.get("listeFinaleFrame").src, "/animation_liste/fin/fin_3.png");
  assert.equal(h.sounds[0].stops.length, 1);
  assert.equal(h.timers.size, 0);
  h.stopListeFinale();
  assert.equal(h.elements.get("liste-finale-overlay").classList.contains("active"), false);
});

test("reconnexion en cours et après 20 s, vainqueurs serveur et texte sûr", async () => {
  const h = harness(3600, [{ playerId: "a", pseudo: "<b>Long pseudonyme</b>" },
    { playerId: "b", pseudo: "Béa" }]);
  h.syncListeFinale({ listeFinale: h.info });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.elements.get("listeFinaleFrame").src, "/animation_liste/fin/fin_0.png");
  assert.equal(h.sounds[0].seeks[0].seconds, 3.6);
  assert.equal(h.elements.get("listeFinaleLabel").textContent, "VAINQUEURS EX ÆQUO");
  assert.equal(h.elements.get("listeFinaleNames").textContent, "<b>Long pseudonyme</b> · Béa");
  h.info.winners = [];
  h.syncListeFinale({ listeFinale: h.info });
  assert.equal(h.elements.get("listeFinaleLabel").textContent, "Tournoi terminé");
  assert.equal(h.elements.get("listeFinaleNames").textContent, "");
  const late = harness(20000);
  late.syncListeFinale({ listeFinale: late.info });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(late.elements.get("listeFinaleFrame").src, "/animation_liste/fin/fin_3.png");
  assert.equal(late.sounds[0].plays.length, 0);
  assert.equal(late.timers.size, 0);
});

test("styles Liste isolés et bouton Quitter au-dessus de la finale", () => {
  assert.match(html, /#liste-finale-overlay\s*\{\s*display:\s*none/);
  assert.match(html, /body\.mode-liste #liste-finale-overlay\.active/);
  assert.match(html, /\.global-controls\s*\{[^}]*z-index:\s*20005/s);
});
