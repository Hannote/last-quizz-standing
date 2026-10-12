"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const timeline = require("../public_2/liste-intro-timeline");

test("chronologie : noir, trois secondes silencieuses, frontières et maintien final", () => {
  assert.equal(timeline.audioStartMs, 3300);
  assert.equal(timeline.durationMs, 16000);
  assert.equal(timeline.position(0).frame, -1);
  assert.equal(timeline.position(299).frame, -1);
  assert.equal(timeline.position(300).frame, 0);
  assert.equal(timeline.position(3299).frame, 0);
  assert.equal(timeline.position(300).nextMs, 3300);
  assert.equal(timeline.position(3300).frame, 0);
  assert.equal(timeline.position(4258).frame, 0);
  for (let i = 0; i < timeline.frameStartsMs.length; i++) {
    const start = 3300 + timeline.frameStartsMs[i];
    assert.equal(timeline.position(start).frame, i);
    assert.equal(timeline.position(start - 1).frame, i === 0 ? 0 : i - 1);
  }
  for (const ms of [9967, 13300, 15999, 16000]) {
    assert.equal(timeline.position(ms).frame, 11);
  }
  assert.equal(timeline.frameUrls.length, 12);
  assert.equal(timeline.frameUrls[6], "/animation_liste/d%C3%A9but/frame%206%20.png");
  assert.equal(timeline.audioUrl, "/animation_liste/d%C3%A9but/animation_liste_debut.mp3");
});

const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const from = source.indexOf("let listeIntroImages =");
const to = source.indexOf("function clearIntroLayer()", from);
assert.ok(from >= 0 && to > from);

function client(elapsedMs = 0) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const howls = [];
  const nodes = [];
  const listeners = {};
  class Element {
    constructor(tag) { this.tag = tag; this._src = ""; this.hidden = false; this.children = []; }
    set src(value) { this._src = new URL(value, "http://localhost:3000/").href; }
    get src() { return this._src; }
    appendChild(child) { this.children.push(child); }
    setAttribute() {}
    remove() { this.removed = true; }
  }
  class Image { set src(url) { this.url = url; } }
  class Howl {
    constructor(options) { this.options = options; this.plays = []; this.seeks = []; this.stops = []; howls.push(this); }
    play() { this.plays.push(7); return 7; }
    seek(seconds, id) { this.seeks.push({ seconds, id }); }
    stop(id) { this.stops.push(id); }
  }
  const document = {
    body: { appendChild: (node) => nodes.push(node) },
    createElement: (tag) => new Element(tag),
    addEventListener: (name, fn) => { listeners[name] = fn; },
    visibilityState: "visible"
  };
  const c = {
    ListeIntroTimeline: timeline, Image, Howl, document, URL,
    location: { href: "http://localhost:3000/" },
    console: { warn: assert.fail },
    performance: { now: () => now },
    currentRoom: { roomCode: "ABCD", gameMode: "liste", listeTournament: { tournamentId: "tour" } },
    currentGameState: { phase: "listeIntro" },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(source.slice(from, to) +
    "\nglobalThis.api = { preloadListeIntro, syncListeIntro, stopListeIntro };", c);
  function sync(elapsed = elapsedMs) {
    c.api.syncListeIntro({ listeIntro: { gameMode: "liste", tournamentId: "tour", elapsedMs: elapsed } });
  }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = end;
  }
  return { c, sync, advance, howls, nodes, timers, listeners };
}

test("client : reconnexion silencieuse puis lecture à 3 300 ms, position audio conservée", () => {
  const black = client(150);
  black.sync();
  assert.equal(black.nodes[0].children[0].hidden, true);
  assert.equal(black.howls[0].plays.length, 0);
  black.advance(150);
  assert.equal(black.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[0]);
  assert.equal(black.howls[0].plays.length, 0);
  black.sync(300);
  black.advance(2999);
  assert.equal(black.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[0]);
  assert.equal(black.howls[0].plays.length, 0);
  black.advance(1);
  assert.equal(black.howls[0].plays.length, 1);
  assert.equal(black.howls[0].seeks.at(-1).seconds, 0);

  const silent = client(2000);
  silent.sync();
  assert.equal(silent.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[0]);
  assert.equal(silent.howls[0].plays.length, 0);

  const resumed = client(3300 + 4000);
  resumed.sync();
  assert.equal(resumed.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[5]);
  assert.equal(resumed.howls[0].seeks.at(-1).seconds, 4);
  resumed.advance(334);
  assert.equal(resumed.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[6]);
});

test("client : veille, fin de phase et ancien callback ne touchent pas une autre salle", () => {
  const h = client(3300);
  h.sync();
  const stale = [...h.timers.values()][0].fn;
  h.advance(5000);
  h.listeners.visibilitychange();
  assert.equal(h.nodes[0].children[0].src, "http://localhost:3000" + timeline.frameUrls[6]);
  h.c.api.stopListeIntro();
  assert.equal(h.howls[0].stops.length, 1);
  assert.equal(h.nodes[0].removed, true);
  h.c.currentRoom = { roomCode: "NEW", gameMode: "battle_royale" };
  stale();
  h.howls[0].options.onplay.call(h.howls[0], 7);
  assert.equal(h.nodes.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.howls[0].stops.length, 2, "Un son chargé tardivement est arrêté");
});
