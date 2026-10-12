"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const timeline = require("../public_2/liste-intro-timeline");

test("chronologie : noir, trois secondes silencieuses, frontières et maintien final", () => {
  assert.equal(timeline.audioStartMs, 3300);
  assert.equal(timeline.audioEndMs, 16000);
  assert.equal(timeline.durationMs, 17000);
  assert.equal(timeline.position(0).frame, -1);
  assert.equal(timeline.position(299).frame, -1);
  assert.equal(timeline.position(300).frame, 0);
  assert.equal(timeline.position(300).scale, 1);
  assert.equal(timeline.position(300).offsetXPercent, 0);
  assert.equal(timeline.position(3299).frame, 0);
  assert.equal(timeline.position(300).nextMs, 3300);
  assert.equal(timeline.position(3300).frame, 0);
  assert.equal(timeline.position(3300).scale, 1.025);
  assert.equal(timeline.position(3300).offsetXPercent, 0.4);
  assert.equal(timeline.position(4258).frame, 0);
  assert.equal(timeline.position(4258).scale, 1.025);
  assert.equal(timeline.position(4258).offsetXPercent, 0.4);
  assert.equal(timeline.position(4259).scale, 1);
  for (let i = 0; i < timeline.frameStartsMs.length; i++) {
    const start = 3300 + timeline.frameStartsMs[i];
    assert.equal(timeline.position(start).frame, i);
    assert.equal(timeline.position(start - 1).frame, i === 0 ? 0 : i - 1);
  }
  for (const ms of [9967, 12999]) {
    assert.equal(timeline.position(ms).frame, 11);
  }
  assert.equal(timeline.position(13000).frame, 11);
  assert.equal(timeline.position(13060).opacity, 0.5);
  assert.equal(timeline.position(13119).frame, 11);
  assert.equal(timeline.position(13120).frame, 12);
  assert.equal(timeline.position(13120).opacity, 0);
  assert.equal(timeline.position(13200).opacity, 1);
  for (const [ms, frame] of [[13439, 12], [13440, 13], [13779, 13], [13780, 14],
    [13959, 14], [13960, 15], [14099, 15], [14100, 16],
    [15999, 16], [16000, 16], [16999, 16], [17000, 16]]) {
    assert.equal(timeline.position(ms).frame, frame);
  }
  assert.equal(timeline.position(15999).nextMs, 16000);
  assert.equal(timeline.position(16000).nextMs, null);
  assert.equal(timeline.frameUrls.length, 17);
  assert.equal(timeline.frameUrls[6], "/animation_liste/d%C3%A9but/frame%206%20.png");
  assert.equal(timeline.frameUrls[16], "/animation_liste/d%C3%A9but/frame%2016.png");
  assert.equal(timeline.audioUrl, "/animation_liste/d%C3%A9but/animation_liste_debut.mp3");
});

test("frame 0 : travelling fluide borné et stabilisé avant la frame 1", () => {
  const first = timeline.position(300);
  const middle = timeline.position(1800);
  const last = timeline.position(3299);
  const settled = timeline.position(3300);
  assert.equal(middle.scale, 1.0125);
  assert.equal(middle.offsetXPercent, 0.2);
  assert.ok(first.scale < middle.scale && middle.scale < last.scale && last.scale <= 1.025);
  assert.ok(first.offsetXPercent < middle.offsetXPercent &&
    middle.offsetXPercent < last.offsetXPercent && last.offsetXPercent < 1);
  assert.ok(settled.scale - last.scale < 0.000001);
  assert.ok(settled.offsetXPercent - last.offsetXPercent < 0.00001);
  assert.equal(timeline.position(3300).animating, false);
  assert.equal(timeline.position(4259).offsetXPercent, undefined);
});

test("logo : largeur continue aux changements d'image et arrivée ralentie", () => {
  const widths = timeline.logoWidthsPx;
  const visibleWidth = (ms) => {
    const state = timeline.position(ms);
    return widths[state.frame - 12] * state.scale;
  };
  for (const boundary of [13440, 13780, 13960, 14100]) {
    assert.ok(Math.abs(visibleWidth(boundary) - visibleWidth(boundary - 1)) < 5,
      `Saut de largeur à ${boundary} ms`);
  }
  assert.equal(timeline.position(14100).scale, 1);
  assert.equal(timeline.position(15999).scale, 1);
  assert.equal(timeline.position(15999).opacity, 1);
  assert.equal(timeline.position(16999).scale, 1);
  assert.equal(timeline.position(16999).opacity, 1);
  assert.ok(visibleWidth(13780) - visibleWidth(13700) < visibleWidth(13700) - visibleWidth(13620));
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
    constructor(tag) { this.tag = tag; this._src = ""; this.hidden = false; this.children = []; this.style = {}; }
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
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { const id = ++nextTimer; timers.set(id, { fn, at: now + 16 }); return id; },
    cancelAnimationFrame: (id) => timers.delete(id)
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
  assert.equal(silent.nodes[0].children[0].style.transform,
    `translateX(${timeline.position(2000).offsetXPercent}%) scale(${timeline.position(2000).scale})`);
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
  assert.equal(h.nodes[0].children[0].style.transform, "");
  h.c.currentRoom = { roomCode: "NEW", gameMode: "battle_royale" };
  stale();
  h.howls[0].options.onplay.call(h.howls[0], 7);
  assert.equal(h.nodes.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.howls[0].stops.length, 2, "Un son chargé tardivement est arrêté");
});

test("client : reconnexion pendant le travelling reprend sa position et la frame 1 remet le cadrage normal", () => {
  const h = client(2300);
  h.sync();
  const image = h.nodes[0].children[0];
  const position = timeline.position(2300);
  assert.equal(image.style.transform,
    `translateX(${position.offsetXPercent}%) scale(${position.scale})`);
  assert.equal(h.howls[0].plays.length, 0);
  h.advance(1000);
  assert.equal(image.style.transform, "translateX(0.4%) scale(1.025)");
  assert.equal(h.howls[0].plays.length, 1);
  h.advance(959);
  assert.equal(image.src, "http://localhost:3000" + timeline.frameUrls[1]);
  assert.equal(image.style.transform, "scale(1)");
  h.c.api.stopListeIntro();
  assert.equal(image.style.transform, "");
  assert.equal(h.timers.size, 0);
});

test("client : reconnexion pendant l'approche et frame 16 maintenue sans rejouer l'audio", () => {
  const h = client(13500);
  h.sync();
  const image = h.nodes[0].children[0];
  assert.equal(image.src, "http://localhost:3000" + timeline.frameUrls[13]);
  assert.equal(image.style.transform, `scale(${timeline.position(13500).scale})`);
  assert.equal(h.howls[0].seeks.at(-1).seconds, 10.2);
  h.advance(160);
  assert.equal(image.style.transform, `scale(${timeline.position(13660).scale})`);
  h.sync(15000);
  assert.equal(image.src, "http://localhost:3000" + timeline.frameUrls[16]);
  assert.equal(image.style.transform, "scale(1)");
  assert.equal(h.howls[0].plays.length, 1);
  h.c.api.stopListeIntro();
  assert.equal(h.timers.size, 0);
});

test("client : frame 16 reste stable de 16 à 17 s, sans prolonger l'audio", () => {
  const h = client(15900);
  h.sync();
  const image = h.nodes[0].children[0];
  assert.equal(image.src, "http://localhost:3000" + timeline.frameUrls[16]);
  assert.equal(h.howls[0].plays.length, 1);
  h.advance(100);
  assert.equal(h.howls[0].stops.length, 1);
  assert.equal(image.src, "http://localhost:3000" + timeline.frameUrls[16]);
  h.advance(999);
  assert.equal(image.style.transform, "scale(1)");
  assert.equal(image.style.opacity, "1");
  assert.equal(h.howls[0].plays.length, 1);
  assert.equal(h.timers.size, 0);

  const reconnected = client(16500);
  reconnected.sync();
  assert.equal(reconnected.nodes[0].children[0].src,
    "http://localhost:3000" + timeline.frameUrls[16]);
  assert.equal(reconnected.howls[0].plays.length, 0);
});
