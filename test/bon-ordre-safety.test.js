"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const harnessFile = path.join(__dirname, "liste-flow.test.js");
const setup = fs.readFileSync(harnessFile, "utf8").split("function startPenaveRound()")[0];
const context = { require: createRequire(harnessFile), __dirname, Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);

function start(mode) {
  const h = context.makeHarness();
  const { room, clients } = h.create(3);
  if (mode === "liste") h.configure(room, clients[0], "manual", ["le_bon_ordre"]);
  clients[0].send("hostStartGame", mode === "liste" ? {} : { forcedMiniGame: "le_bon_ordre" });
  if (mode === "battle_royale") h.advance(32500);
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach((client) => client.send("playerSetReady", { isReady: true }));
  return { h, room, clients, mini: room.gameState.currentMiniGameState };
}

function answer(mini, extra = {}) {
  const q = mini.questions[mini.questionIndex];
  return {
    instanceId: mini.instanceId, questionId: q.id, questionIndex: mini.questionIndex,
    orderedIds: [...q.cards].sort((a, b) => b.valeur - a.valeur).map((card) => card.id), pass: false, ...extra
  };
}

function totals(room) {
  return JSON.stringify(room.players.map((player) => [player.playerId, player.score, player.roundScore, player.roundTime, player.totalTime, player.tournamentPoints]));
}

function closeQuestion(state) {
  const { h, clients, mini } = state;
  assert.equal(mini.subPhase, "theme");
  h.advance(2500);
  clients.forEach((client) => client.send("leBonOrdreAnswer", answer(mini)));
  assert.equal(mini.subPhase, "correction");
}

function ending(state) {
  for (let index = 0; index < 7; index++) {
    closeQuestion(state);
    state.h.advance(15000 + (index === 6 ? 4500 : 3000));
  }
  assert.equal(state.mini.subPhase, "ending");
}

function lastTimer(h, delay, repeat = false) {
  const timer = h.allTimers.filter((item) => item.delay === delay && item.repeat === repeat).at(-1);
  assert.ok(timer, `Minuterie ${delay} ms attendue`);
  return timer;
}

function lastEvent(h, name, socket) {
  return h.events.filter((entry) => entry.name === name && (!socket || entry.target === socket.id)).at(-1)?.data;
}

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} Bon Ordre : les callbacks obsolètes respectent salon, mode, manche, question et phase`, () => {
    const changes = {
      mode: ({ room }) => { room.gameMode = mode === "liste" ? "battle_royale" : "liste"; },
      phase: ({ room }) => { room.gameState.phase = "rules"; },
      round: ({ room }) => { room.gameState.roundNumber++; },
      game: ({ room }) => { room.gameState.currentMiniGame = "blind_test"; },
      gameState: ({ room }) => { room.gameState = { ...room.gameState }; },
      instance: ({ room, mini }) => { room.gameState.currentMiniGameState = { ...mini, instanceId: "nouvelle-instance" }; },
      question: ({ mini }) => { mini.questionIndex++; },
      subPhase: ({ mini }) => { mini.subPhase = mini.subPhase === "theme" ? "answering" : "theme"; },
      room: ({ h, room }) => { delete h.api.rooms[room.roomCode]; }
    };
    const stages = [
      { name: "theme", prepare() {}, delay: 2500 },
      { name: "correction", prepare: closeQuestion, delay: 15000 },
      { name: "leaderboard", prepare(state) { closeQuestion(state); state.h.advance(15000); }, delay: 3000 }
    ];
    for (const stage of stages) {
      for (const [label, mutate] of Object.entries(changes)) {
        const state = start(mode);
        stage.prepare(state);
        const timer = lastTimer(state.h, stage.delay);
        mutate(state);
        const beforeEvents = state.h.events.length;
        const beforeTimers = state.h.allTimers.length;
        const beforeTotals = totals(state.room);
        timer.fn();
        assert.equal(state.h.events.length, beforeEvents, `${stage.name}/${label}`);
        assert.equal(state.h.allTimers.length, beforeTimers, `${stage.name}/${label}`);
        assert.equal(totals(state.room), beforeTotals, `${stage.name}/${label}`);
      }
    }
  });

  test(`${mode} Bon Ordre : fin anticipée, intervalle expiré et doublons ne corrigent qu'une fois`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    h.advance(2500);
    const oldInterval = lastTimer(h, 1000, true);
    const snapshot = JSON.stringify(mini.questions);
    const payload = answer(mini);
    clients.forEach((client) => client.send("leBonOrdreAnswer", payload));
    assert.equal(mini.subPhase, "correction");
    assert.equal(mini.questionIndex, 0);
    const before = h.events.length;
    const applied = totals(room);
    oldInterval.fn();
    oldInterval.fn();
    clients[0].send("leBonOrdreAnswer", payload);
    clients[0].send("playerSetReady", { isReady: true });
    h.api.startCorrectionPhase(room.roomCode);
    assert.equal(h.events.slice(before).some((event) => event.name === "leBonOrdreCorrection"), false);
    assert.equal(h.events.filter((event) => event.name === "leBonOrdreCorrection").length, 3);
    assert.equal(totals(room), applied);
    assert.equal(JSON.stringify(mini.questions), snapshot);
    assert.strictEqual(room.gameState.currentMiniGameState, mini);
    assert.equal(mini.subPhase, "correction");
    const oldCorrection = lastTimer(h, 15000);
    h.advance(15000);
    const oldLeaderboard = lastTimer(h, 3000);
    oldCorrection.fn();
    oldCorrection.fn();
    assert.equal(h.events.filter((event) => event.name === "leBonOrdreLeaderboard").length, 1);
    h.advance(3000);
    oldLeaderboard.fn();
    oldLeaderboard.fn();
    assert.equal(mini.questionIndex, 1);
    assert.equal(mini.subPhase, "theme");
    assert.equal(totals(room), applied);
    h.advance(2500);
    clients[0].send("leBonOrdreAnswer", payload);
    assert.equal(Object.hasOwn(mini.playerAnswers, "p0"), false, "Réponse ancienne refusée dans la nouvelle question");
  });

  test(`${mode} Bon Ordre : fin et reconnexion n'ouvrent jamais la correction collective`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    ending(state);
    const endTimer = lastTimer(h, mode === "liste" ? 3500 : 7000);
    const applied = totals(room);
    const before = h.events.length;
    h.advance(500);
    clients[0].send("disconnect");
    const returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    const restored = h.events.slice(before);
    assert.equal(restored.some((event) => event.name === "leBonOrdreCorrection" || event.name === "correctionUpdate"), false);
    assert.equal(lastEvent(h, "leBonOrdreExit", returned).remainingMs, (mode === "liste" ? 3500 : 7000) - 500);
    h.api.startCorrectionPhase(room.roomCode);
    for (const event of ["correctionPrevQuestion", "correctionNextQuestion", "endPetitBacCorrection"]) returned.send(event);
    returned.send("correctionNavigate", { direction: 1 });
    returned.send("hostGradePlayer", { points: 1 });
    assert.equal(totals(room), applied);
    assert.equal(mini.subPhase, "ending");
    room.gameState.currentMiniGameState = { ...mini, instanceId: "nouvelle-manche" };
    const beforeStale = h.events.length;
    endTimer.fn();
    assert.equal(h.events.length, beforeStale);
    assert.equal(room.players.filter((player) => player.eliminated).length, 0);
    assert.equal(room.listeTournament.roundResults.length, 0);
  });

  test(`${mode} Bon Ordre : aucun score/temps client et refus à l'échéance exacte`, () => {
    const { h, room, clients, mini } = start(mode);
    h.advance(2500);
    for (const extra of [{ score: 7 }, { timeTaken: 0 }, { correctCount: 5 }, { grade: 1 }, { valeur: 999 }, { playerId: "p1" }]) {
      clients[0].send("leBonOrdreAnswer", answer(mini, extra));
      assert.equal(Object.hasOwn(mini.playerAnswers, "p0"), false);
    }
    mini.timer.endsAt = mini.startTime;
    clients[0].send("leBonOrdreAnswer", answer(mini));
    assert.equal(Object.hasOwn(mini.playerAnswers, "p0"), false);
    assert.equal(room.players[0].roundScore, 0);
    assert.equal(room.players[0].roundTime, 0);
  });

  test(`${mode} Bon Ordre : restauration après échéance avance sans rouvrir une ancienne phase`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    closeQuestion(state);
    const correctionTimer = lastTimer(h, 15000);
    h.timers.delete(correctionTimer.id); // Simule un callback retardé par la boucle d'événements.
    h.advance(15500);
    const applied = totals(room);
    const before = h.events.length;
    clients[0].send("requestRoomState");
    assert.equal(mini.subPhase, "leaderboard");
    assert.equal(lastEvent(h, "leBonOrdreLeaderboard", clients[0]).remainingMs, 2500);
    assert.equal(h.events.slice(before).some((event) => event.name === "leBonOrdreCorrection"), false);
    const rankTimer = lastTimer(h, 2500);
    h.timers.delete(rankTimer.id);
    h.advance(3000);
    const afterRank = h.events.length;
    clients[0].send("requestRoomState");
    assert.equal(mini.subPhase, "theme");
    assert.equal(mini.questionIndex, 1);
    assert.equal(h.events.slice(afterRank).some((event) => event.name === "leBonOrdreCorrection"), false);
    correctionTimer.fn();
    rankTimer.fn();
    assert.equal(mini.subPhase, "theme");
    assert.equal(mini.questionIndex, 1);
    assert.equal(totals(room), applied);
  });

  test(`${mode} Bon Ordre : restauration de fin et callback différé finalisent une seule fois`, () => {
    const state = start(mode);
    const { h, room, clients } = state;
    ending(state);
    const timer = lastTimer(h, mode === "liste" ? 3500 : 7000);
    h.timers.delete(timer.id);
    h.advance(mode === "liste" ? 3500 : 7000);
    clients[0].send("requestRoomState");
    const first = totals(room);
    const eventCount = h.events.filter((event) => event.name === "playerEliminated").length;
    const roundCount = room.listeTournament.roundResults.length;
    timer.fn();
    timer.fn();
    assert.equal(totals(room), first);
    assert.equal(h.events.filter((event) => event.name === "playerEliminated").length, eventCount);
    assert.equal(room.listeTournament.roundResults.length, roundCount);
    assert.equal(mode === "liste" ? roundCount : eventCount, 1);
  });

  test(`${mode} Bon Ordre : ancien socket et identité fournie ne sélectionnent aucune correction privée`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    closeQuestion(state);
    clients[0].send("disconnect");
    const returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    const beforeOld = h.events.length;
    clients[0].send("requestRoomState");
    assert.equal(h.events.slice(beforeOld).some((event) => event.name === "leBonOrdreCorrection"), false);
    const beforeSpoof = h.events.length;
    returned.send("requestRoomState", { playerId: "p1" });
    for (const event of h.events.slice(beforeSpoof).filter((entry) => entry.name === "leBonOrdreCorrection")) {
      assert.equal(event.target, returned.id);
      assert.equal(event.data.playerPseudo, room.players.find((player) => player.playerId === "p0").pseudo);
    }
    returned.send("requestRoomState");
    assert.equal(lastEvent(h, "leBonOrdreCorrection", returned).isParticipant, true);
    assert.equal(mini.subPhase, "correction");
  });
}

test("Liste Bon Ordre : abandon exclu des corrections suivantes et des points sans élimination", () => {
  const state = start("liste");
  const { h, room, clients, mini } = state;
  h.advance(2500);
  clients[0].send("leBonOrdreAnswer", answer(mini));
  clients[1].send("leBonOrdreAnswer", answer(mini));
  clients[2].send("leaveRoom");
  const withdrawn = room.players.find((player) => player.playerId === "p2");
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(withdrawn.eliminated, false);
  assert.equal(mini.subPhase, "correction", "Le départ clôt la question quand les participants restants ont répondu");
  h.advance(18000);
  for (let index = 1; index < 7; index++) {
    h.advance(2500);
    clients.slice(0, 2).forEach((client) => client.send("leBonOrdreAnswer", answer(mini)));
    assert.equal(mini.subPhase, "correction");
    assert.equal(Object.hasOwn(mini.scoresGiven[index], "p2"), false);
    h.advance(15000 + (index === 6 ? 4500 : 3000));
  }
  assert.equal(withdrawn.roundScore, 0);
  assert.equal(withdrawn.roundTime, 0);
  assert.equal(withdrawn.tournamentPoints, 0);
  assert.equal(h.events.some((event) => event.name === "playerEliminated"), false);
  h.advance(3500);
  assert.equal(room.listeTournament.roundResults.length, 1);
  assert.equal(room.listeTournament.roundResults[0].placements.some((player) => player.playerId === "p2"), false);
});
