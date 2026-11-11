"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Réutilise le serveur entier et ses clients Socket.IO simulés, sans écrire l'historique.
const harnessFile = path.join(__dirname, "liste-flow.test.js");
const setup = fs.readFileSync(harnessFile, "utf8").split("function startPenaveRound()")[0]
  .replace("rooms, getListeContext,", "rooms, getPenaveSnapshot, getListeContext,");
const context = { require: createRequire(harnessFile), __dirname, Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);

function start(count = 3) {
  const h = context.makeHarness({}, true, () => .999);
  const { room, clients } = h.create(count);
  room.players.forEach((p, i) => { p.pseudo = ["Alice", "Bob", "Charlie"][i]; });
  h.configure(room, clients[0], "manual", ["penave_ou_nachave", "blind_test"]);
  clients[0].send("hostStartGame", {});
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach(c => c.send("playerSetReady", { isReady: true }));
  return { h, room, clients, mini: room.gameState.currentMiniGameState };
}

function message(mini, data = {}) {
  return { instanceId: mini.instanceId, turnNumber: mini.turnNumber, passageId: mini.passageId, ...data };
}

function answerTurn({ h, room, clients, mini }, accepted, times = {}) {
  const turn = mini.turnNumber;
  while (mini.turnNumber === turn && ["cue", "answer"].includes(mini.subPhase)) {
    if (mini.subPhase === "cue") h.advance(1700);
    const id = mini.activePlayerId;
    h.advance(times[id] || 0);
    clients.find(c => c.playerId === id).send("penaveAnswer",
      message(mini, { answer: "Réponse", pass: !accepted.includes(id) }));
    if (mini.subPhase === "correction") {
      h.advance(850);
      clients.find(c => c.playerId === room.hostId).send("penaveGrade", message(mini, { accepted: true }));
    }
    h.advance(1100);
  }
}

test("Pénave présentation : 1500 ms de thème, 5000 ms de question, puis signal et délai de réponse", () => {
  const { h, room, clients, mini } = start();
  assert.equal(mini.subPhase, "theme");
  h.advance(1500);
  assert.equal(mini.subPhase, "question_intro");
  const end = mini.phaseEndsAt;
  const callback = h.allTimers.at(-1).fn;
  clients.forEach(c => {
    c.send("penaveAnswer", message(mini, { answer: "Trop tôt", pass: false }));
    c.send("penaveCueFinished", message(mini));
  });
  assert.equal(mini.entries.length, 0);
  assert.equal(mini.deadline, null);
  assert.equal(mini.passageId, 0);
  h.advance(2200);
  const reconnect = h.socket("p1");
  reconnect.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Bob" });
  const state = h.events.filter(e => e.target === reconnect.id && e.name === "gameStateUpdate").at(-1).data.penaveState;
  assert.equal(state.subPhase, "question_intro");
  assert.equal(state.phaseDurationMs, 5000);
  assert.equal(state.phaseRemainingMs, 2800);
  assert.equal(state.phaseEndsAt, end);
  h.advance(2799);
  assert.equal(mini.subPhase, "question_intro");
  h.advance(1);
  assert.equal(mini.subPhase, "cue");
  callback(); // Un ancien callback ne doit pas ouvrir un second passage.
  assert.equal(mini.passageId, 1);
  assert.equal(mini.deadline, null);
  h.advance(1700);
  assert.equal(mini.subPhase, "answer");
  assert.equal(h.api.getPenaveSnapshot(room).remainingMs, 20000);
});

test("Pénave présentation : annonce 1500 ms sans éliminé, question présentée une seule fois", () => {
  const s = start();
  s.h.advance(6500);
  answerTurn(s, s.mini.order);
  assert.equal(s.mini.announcement, "Tour 1 terminé");
  assert.equal(s.mini.phaseDurationMs, 1500);
  s.h.advance(1499);
  assert.equal(s.mini.subPhase, "round_summary");
  s.h.advance(1);
  assert.equal(s.mini.subPhase, "cue");
  assert.equal(s.mini.turnNumber, 2);
  assert.equal(s.h.events.filter(e => e.name === "gameStateUpdate" && e.data.penaveState?.subPhase === "question_intro").length, 1);
});

test("Pénave présentation : échec collectif, vainqueur au temps exclu, 4200 ms puis victoire 3000 ms", () => {
  const s = start();
  const { h, mini, room } = s;
  h.advance(6500);
  answerTurn(s, mini.order, { p0: 3000, p1: 500, p2: 2000 });
  h.advance(1500);
  answerTurn(s, []);
  assert.equal(mini.ranking[0].pseudo, "Bob");
  const eliminatedNames = mini.order.filter(id => id !== "p1")
    .map(id => room.players.find(p => p.playerId === id).pseudo);
  assert.equal(mini.announcement, `${eliminatedNames.join(", ")} sont éliminés`);
  assert.deepEqual([...mini.roundEliminatedIds], [...mini.order]);
  assert.deepEqual([...mini.announcementEliminatedIds].sort(), ["p0", "p2"]);
  assert.equal(mini.stats.p1.timeMs, 20500);
  assert.equal(mini.stats.p1.correct, 1);
  assert.equal(mini.phaseDurationMs, 4200);
  h.advance(1000);
  const reconnect = h.socket("p2");
  reconnect.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Charlie" });
  assert.equal(h.api.getPenaveSnapshot(room).phaseRemainingMs, 3200);
  h.advance(3199);
  assert.equal(mini.subPhase, "round_summary");
  h.advance(1);
  assert.equal(mini.subPhase, "victory");
  assert.equal(mini.announcement, "Bob gagne la partie");
  assert.equal(mini.phaseDurationMs, 3000);
  h.advance(2999);
  assert.equal(mini.subPhase, "victory");
  h.advance(1);
  assert.equal(mini.subPhase, "final_ranking");
});

test("Pénave présentation : singulier et liste vide après filtrage", () => {
  const pair = start(2);
  pair.h.advance(6500);
  answerTurn(pair, []);
  assert.match(pair.mini.announcement, /^(Alice|Bob) est éliminé$/);
  assert.ok(!pair.mini.announcement.includes(pair.mini.ranking[0].pseudo));
  const solo = start(1);
  solo.h.advance(6500);
  answerTurn(solo, []);
  assert.equal(solo.mini.announcement, "Tour 1 terminé");
  assert.equal(solo.mini.phaseDurationMs, 1500);
  solo.h.advance(1500);
  assert.equal(solo.mini.subPhase, "victory");
});

test("Pénave présentation : abandon du vainqueur pendant le résumé, annonce recalculée sans redémarrage", () => {
  const s = start();
  s.h.advance(6500);
  answerTurn(s, []);
  const end = s.mini.phaseEndsAt;
  const winner = s.mini.ranking[0].playerId;
  s.clients.find(c => c.playerId === winner).send("leaveRoom");
  assert.equal(s.mini.phaseEndsAt, end);
  assert.ok(!s.mini.announcementEliminatedIds.includes(s.mini.ranking[0].playerId));
  assert.equal(s.mini.announcementEliminatedIds.length, 1);
});

test("Pénave présentation : callback d'introduction périmé après changement de manche", () => {
  const { h, room, mini } = start();
  h.advance(1500);
  const callback = h.allTimers.at(-1).fn;
  room.gameState.currentMiniGameState = { type: "blind_test" };
  room.gameState.currentMiniGame = "blind_test";
  callback();
  h.advance(5000);
  assert.equal(mini.subPhase, "question_intro");
  assert.equal(mini.passageId, 0);
});

function clientHarness(localId = "p0") {
  function element() {
    const classes = new Set(["hidden"]);
    const e = { dataset: {}, children: [], styleWrites: 0, value: "", scrollTop: 0,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }
    };
    e.style = new Proxy({}, { set(target, key, value) { e.styleWrites++; target[key] = value; return true; } });
    Object.defineProperty(e, "firstElementChild", { get: () => e.children[0] ||= element() });
    return e;
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get("penaveTimerFill").parentElement = element();
  function sound(duration = 10) {
    return { plays: 0, stops: 0, seeks: [], play() { return ++this.plays; }, stop() { this.stops++; },
      seek(value) { this.seeks.push(value); }, once() {}, duration: () => duration };
  }
  const c = { document: { body: element(), getElementById: get, createElement: element, querySelector: () => null },
    currentRoom: { gameMode: "liste", players: [{ playerId: "p0" }, { playerId: "p1" }] },
    playerId: localId, isListePlayerInactive: p => p?.withdrawn,
    setInterval: () => 1, clearInterval() {}, invalidateMiniGameLeaderboard() {},
    sfxTheme: sound(1.5), sfxFinJeu: sound(), sfxPenaveVictory: sound(5), sfxPenaveQuestion: sound(),
    sfxPenaveTurn: sound(), sfxPenaveSuspense: sound(), sfxPenaveBoard: sound(),
    sfxPenaveCorrect: sound(), sfxPenaveWrong: sound(), sfxPenaveOut: sound()
  };
  const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
  vm.runInNewContext(source.slice(source.indexOf("let penaveSnapshot ="), source.indexOf('document.getElementById("penaveForm")?.addEventListener')), c);
  const state = (subPhase, duration, remaining = duration) => ({
    instanceId: "mini-1", subPhase, phaseStartedAt: 1000, phaseDurationMs: duration, phaseRemainingMs: remaining,
    theme: "Football", affirmation: "Question", turnNumber: 1, passageId: 0,
    order: ["p0", "p1"], survivorIds: ["p0"], activePlayerId: null, entries: [],
    roundEliminatedIds: ["p1"], announcementEliminatedIds: ["p1"], announcement: "Bob est éliminé",
    durationMs: 20000, remainingMs: 0
  });
  return { c, get, state };
}

test("Pénave client : question seule, sans formulaire, chronomètre ni sons de réponse", () => {
  const { c, get, state } = clientHarness();
  c.renderPenave(state("question_intro", 5000, 2300));
  assert.equal(get("penaveQuestionOverlay").classList.contains("hidden"), false);
  assert.equal(get("penaveContainer").classList.contains("hidden"), true);
  assert.equal(get("penaveForm").classList.contains("hidden"), true);
  assert.equal(get("penaveTimer").classList.contains("hidden"), true);
  assert.equal(get("penaveInput").disabled, true);
  assert.equal(c.sfxPenaveTurn.plays + c.sfxPenaveSuspense.plays, 0);
});

for (const localId of ["p0", "p1"]) {
  test(`Pénave client ${localId} (actif ou éliminé) : sons uniques, animation stable et nettoyage`, () => {
    const { c, get, state } = clientHarness(localId);
    c.renderPenave(state("round_summary", 4200));
    const label = get("penaveAnnouncementOverlay").firstElementChild;
    const writes = label.styleWrites;
    c.renderPenave(state("round_summary", 4200, 2500));
    assert.equal(c.sfxTheme.plays, 0);
    assert.equal(c.sfxPenaveOut.plays, 1);
    assert.equal(label.styleWrites, writes);
    assert.match(label.style.animation, /penaveAnnouncementZoom 4200ms/);
    c.renderPenave(state("victory", 3000));
    c.renderPenave(state("victory", 3000, 1500));
    assert.equal(c.sfxPenaveOut.stops, 1);
    assert.equal(c.sfxPenaveVictory.plays, 1);
    assert.match(label.style.animation, /3000ms/);
    c.stopPenaveDisplay();
    assert.equal(c.sfxPenaveVictory.stops, 1);
    assert.equal(get("penaveAnnouncementOverlay").classList.contains("hidden"), true);
    assert.equal(c.document.body.classList.contains("penave-active"), false);
  });
}

test("Pénave client : reconnexion reprend le son et l'animation au temps écoulé", () => {
  const { c, get, state } = clientHarness();
  c.renderPenave(state("victory", 3000, 900));
  assert.deepEqual(c.sfxPenaveVictory.seeks, [2.1]);
  assert.equal(get("penaveAnnouncementOverlay").firstElementChild.style.animationDelay, "-2100ms");
  c.renderPenave(state("victory", 3000, 500));
  assert.equal(c.sfxPenaveVictory.plays, 1);
  assert.equal(get("penaveAnnouncementOverlay").firstElementChild.style.animationDelay, "-2100ms");
  c.stopPenaveDisplay();
  c.renderPenave(state("round_summary", 1500, 0));
  assert.equal(c.sfxTheme.plays, 0);
  assert.equal(c.sfxPenaveOut.plays, 0);
});

test("Pénave client : annonce sans éliminé conserve le son de thème", () => {
  const { c, state } = clientHarness();
  c.renderPenave({ ...state("round_summary", 1500), announcementEliminatedIds: [] });
  assert.equal(c.sfxTheme.plays, 1);
  assert.equal(c.sfxPenaveOut.plays, 0);
});

test("Pénave client : reconnexion à l'annonce des éliminés et arrêt en quittant", () => {
  const { c, state } = clientHarness();
  c.renderPenave(state("round_summary", 4200, 3200));
  assert.deepEqual(c.sfxPenaveOut.seeks, [1]);
  c.renderPenave(state("round_summary", 4200, 2500));
  assert.equal(c.sfxPenaveOut.plays, 1);
  assert.equal(c.sfxTheme.plays, 0);
  c.stopPenaveDisplay();
  assert.equal(c.sfxPenaveOut.stops, 1);
});
