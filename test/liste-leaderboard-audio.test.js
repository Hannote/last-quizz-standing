"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
const start = source.indexOf("const listeLeaderboardHowls =");
const end = source.indexOf("function renderListeLeaderboard(", start);
assert.ok(start >= 0 && end > start);

function harness({ mode = "liste", elapsedMs = 0, duration = 10, loaded = true } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const howls = [];
  class Howl {
    constructor(options) {
      this.options = options;
      this.url = options.src[0];
      this.status = loaded ? "loaded" : "loading";
      this.callbacks = {};
      this.plays = [];
      this.seeks = [];
      this.stops = [];
      howls.push(this);
    }
    state() { return this.status; }
    duration() { return duration; }
    once(event, fn) { this.callbacks[event] = fn; }
    play() { const id = ++nextId; this.plays.push(id); return id; }
    seek(position, id) { this.seeks.push({ position, id }); }
    stop(id) { this.stops.push(id); }
    finishLoad() { this.status = "loaded"; this.callbacks.load?.(); }
  }
  const sound = { url: "/sons/classement_general_4.mp3", tournamentId: "tour", roundNumber: 2, elapsedMs };
  const c = {
    Howl, console: { warn: assert.fail }, isQuitting: false,
    currentRoom: { roomCode: "ABCD", gameMode: mode, listeTournament: { tournamentId: "tour" } },
    currentGameState: { phase: "listeLeaderboard", roundNumber: 2,
      listeLeaderboard: { sound } },
    Date: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(source.slice(start, end) +
    "\nglobalThis.audioApi = { preloadListeLeaderboardSounds, stopListeLeaderboardSound, syncListeLeaderboardSound };", c);
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  }
  return { c, sound, howls, timers, advance, ...c.audioApi };
}

test("précharge les 15 URL Express exactes sans boucle et sans recréer les Howl", () => {
  const h = harness();
  h.preloadListeLeaderboardSounds();
  h.preloadListeLeaderboardSounds();
  assert.equal(h.howls.length, 15);
  assert.deepEqual(h.howls.map((howl) => howl.url),
    Array.from({ length: 15 }, (_, i) => `/sons/classement_general_${i + 1}.mp3`));
  assert.ok(h.howls.every((howl) => howl.options.preload === true &&
    howl.options.loop === false && howl.options.volume === 0.5));
});

test("rafraîchissement et événement répété ne relancent pas la lecture ; fermeture l'arrête", () => {
  const h = harness();
  h.preloadListeLeaderboardSounds();
  h.syncListeLeaderboardSound(h.sound);
  const howl = h.howls[3];
  assert.equal(howl.plays.length, 1);
  h.advance(3000);
  h.syncListeLeaderboardSound({ ...h.sound, elapsedMs: 3000 });
  assert.equal(howl.plays.length, 1);
  assert.equal(howl.stops.length, 0);
  h.advance(5000);
  assert.equal(howl.stops.length, 1);
  h.c.currentGameState.phase = "drawingGame";
  h.stopListeLeaderboardSound();
  assert.equal(howl.stops.length, 1);
});

test("reconnexion reprend à la position écoulée et reste silencieuse après la durée du fichier", () => {
  const h = harness({ elapsedMs: 5000 });
  h.preloadListeLeaderboardSounds();
  h.syncListeLeaderboardSound(h.sound);
  assert.equal(h.howls[3].plays.length, 1);
  assert.equal(h.howls[3].seeks[0].position, 5);
  h.advance(3000);
  assert.equal(h.howls[3].stops.length, 1);
  const ended = harness({ elapsedMs: 5000, duration: 4 });
  ended.preloadListeLeaderboardSounds();
  ended.syncListeLeaderboardSound(ended.sound);
  assert.equal(ended.howls[3].plays.length, 0);
});

test("chargement tardif après Quitter ou changement de tournoi ne démarre aucun ancien son", () => {
  for (const leave of ["quit", "newTournament", "final"]) {
    const h = harness({ loaded: false });
    h.preloadListeLeaderboardSounds();
    h.syncListeLeaderboardSound(h.sound);
    const howl = h.howls[3];
    if (leave === "quit") h.c.isQuitting = true;
    if (leave === "newTournament") h.c.currentRoom.listeTournament.tournamentId = "new";
    if (leave === "final") h.c.currentGameState.phase = "listeFinished";
    h.stopListeLeaderboardSound();
    howl.finishLoad();
    assert.equal(howl.plays.length, 0, leave);
  }
});

test("classement final et Battle Royale restent silencieux", () => {
  const h = harness();
  h.preloadListeLeaderboardSounds();
  h.syncListeLeaderboardSound(h.sound);
  h.c.currentGameState.phase = "listeFinished";
  h.syncListeLeaderboardSound(null);
  assert.equal(h.howls[3].stops.length, 1);
  const battle = harness({ mode: "battle_royale" });
  battle.preloadListeLeaderboardSounds();
  battle.syncListeLeaderboardSound(battle.sound);
  assert.equal(battle.howls[3].plays.length, 0);
});
