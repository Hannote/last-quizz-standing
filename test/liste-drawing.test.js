"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../public_2/client.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

// Vraies fonctions client ; seuls DOM, sons et horloge sont simulés.
function client(gameMode = "liste") {
  function element() {
    const classes = new Set();
    return { style: {}, classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    } };
  }
  let now = 0;
  let id = 0;
  const timers = new Map();
  const frames = [];
  const emitted = [];
  const sound = { play() {}, stop() {} };
  const c = {
    currentRoom: { gameMode, hostId: "p", players: [],
      listeOptions: { miniGames: [{ id: "qui_suis_je" }] } },
    currentGameState: {}, lastPhase: "idle", playerId: "p", iAmReady: false,
    listeActionContext: {}, drawAnimationInterval: null, drawAnimationTimeout: null,
    drawAnimationFinalTimeout: null, cancelListeDrawAnimation: null,
    body: element(), drawLogo: element(), drawGameLabel: element(),
    mainDrawing: element(), mainRules: element(), roomUpper: element(),
    gamePhaseText: element(), currentMiniGameText: element(),
    rulesGameLogo: element(), rulesGameTitle: element(), rulesRoundInfo: element(),
    rulesGameText: element(), readyBtn: null,
    POSSIBLE_MINI_GAMES: ["qui_suis_je"], sfxTirage: sound,
    sfxTheme: sound, sfxRuleQuiSuisJe: sound,
    updateGameModeUI() {}, clearIntroLayer() {}, hideListeLeaderboard() {},
    invalidateMiniGameLeaderboard() {}, // Le mécanisme du classement est testé séparément.
    stopRuleSounds() {}, updateReadyPlayersListUI() {},
    miniGameCodeToLabel: (code) => code, miniGameCodeToLogoPath: (code) => code,
    rulesTextForMiniGame: () => "Règles", phaseToText: (phase) => phase,
    emitGameAction: (...args) => emitted.push(args),
    requestAnimationFrame: (fn) => frames.push(fn),
    clearTimeout: (key) => timers.delete(key), clearInterval: (key) => timers.delete(key),
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    showMainZone(mode) {
      c.mainDrawing.classList[mode === "drawing" ? "remove" : "add"]("hidden");
      c.mainRules.classList[mode === "rules" ? "remove" : "add"]("hidden");
    }
  };
  c.document = { body: c.body };
  function schedule(fn, delay, repeat) {
    timers.set(++id, { fn, delay, repeat, at: now + delay });
    return id;
  }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, timer] = next;
      now = timer.at;
      if (timer.repeat) timer.at += timer.delay;
      else timers.delete(key);
      timer.fn();
    }
    now = end;
  }
  vm.runInNewContext(["stopDrawAnimation", "startDrawAnimation", "updateGameStateUI"].map(functionSource).join("\n"), c);
  return { c, advance, timers, emitted, flush: () => frames.splice(0).forEach((fn) => fn()),
    phase: (phase) => c.updateGameStateUI({
      gameMode, phase, roundNumber: 1, currentMiniGame: "qui_suis_je", readyPlayerIds: []
    }) };
}

for (const elapsed of [500, 6400, 9000]) {
  test(`Liste : règles après ${elapsed} ms client, avant le callback final`, () => {
    const h = client();
    h.phase("drawingGame");
    h.advance(elapsed);
    if (elapsed !== 6400) h.flush(); // À 6400 ms, le zoom est encore en attente.
    h.phase("rules");
    assert.equal(h.c.body.classList.contains("drawing-active"), false);
    assert.equal(h.c.drawLogo.classList.contains("draw-logo-fullscreen"), false);
    h.flush();
    h.advance(10000);
    assert.equal(h.c.drawLogo.classList.contains("draw-logo-fullscreen"), false);
    assert.equal(h.c.mainRules.classList.contains("hidden"), false);
    assert.equal(h.c.mainDrawing.classList.contains("hidden"), true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.emitted.length, 0);
    h.phase("rules"); // Nettoyage idempotent.
  });
}

test("Liste : reconnexion tardive, nouvelle animation locale interrompue par les règles", () => {
  const original = client();
  original.phase("drawingGame");
  original.advance(8500);
  const reconnected = client(); // Nouvelle page recevant le snapshot drawingGame à t=8500.
  reconnected.phase("drawingGame");
  for (const h of [original, reconnected]) {
    h.advance(800);
    h.phase("rules"); // Même échéance serveur, animations locales d'âges différents.
    h.flush();
    assert.equal(h.c.body.classList.contains("drawing-active"), false);
    assert.equal(h.c.drawLogo.classList.contains("draw-logo-fullscreen"), false);
    assert.equal(h.c.mainRules.classList.contains("hidden"), false);
    assert.equal(h.timers.size, 0);
  }
});

test("Battle Royale : callback et durée de tirage historiques conservés", () => {
  const h = client("battle_royale");
  h.phase("drawingGame");
  h.advance(6400);
  h.flush();
  assert.equal(h.c.drawLogo.classList.contains("draw-logo-fullscreen"), true);
  h.advance(2899);
  assert.equal(h.emitted.length, 0);
  h.advance(1);
  assert.equal(h.emitted[0][0], "drawingFinished");
  assert.equal(h.c.body.classList.contains("drawing-active"), false);
  h.phase("rules");
  assert.equal(h.c.mainRules.classList.contains("hidden"), false);
});
