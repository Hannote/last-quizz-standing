"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Le vrai serveur et son middleware, avec transport, stockage et horloge isolés.
const harnessFile = path.join(__dirname, "liste-flow.test.js");
const setup = fs.readFileSync(harnessFile, "utf8").split("function startPenaveRound()")[0];
const context = { require: createRequire(harnessFile), __dirname, Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);

function start(mode, count = 3) {
  const h = context.makeHarness();
  const { room, clients } = h.create(count);
  if (mode === "liste") h.configure(room, clients[0], "manual", ["le_bon_ordre"]);
  clients[0].send("hostStartGame", mode === "liste" ? {} : { forcedMiniGame: "le_bon_ordre" });
  if (mode === "battle_royale") h.advance(32500);
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach((client) => client.send("playerSetReady", { isReady: true }));
  assert.equal(room.gameState.phase, "playing");
  const mini = room.gameState.currentMiniGameState;
  assert.equal(mini.questions.length, 7);
  assert.equal(mini.subPhase, "theme");
  const firstQuestion = h.events.findIndex((entry) => entry.name === "leBonOrdreQuestion");
  assert.ok(h.events.slice(0, firstQuestion).some((entry) => entry.name === "gameStateUpdate" &&
    entry.data.phase === "playing" && entry.data.leBonOrdreInstanceId === mini.instanceId));
  return { h, room, clients, mini };
}

function answer(mini, extra = {}) {
  const q = mini.questions[mini.questionIndex];
  return {
    instanceId: mini.instanceId, questionId: q.id, questionIndex: mini.questionIndex,
    orderedIds: [...q.cards].sort((a, b) => b.valeur - a.valeur).map((card) => card.id), pass: false, ...extra
  };
}

function lastEvent(h, name, socket) {
  return h.events.filter((entry) => entry.name === name && (!socket || entry.target === socket.id)).at(-1)?.data;
}

function totals(room) {
  return JSON.stringify(room.players.map((player) => [player.playerId, player.score, player.roundScore, player.roundTime, player.totalTime]));
}

function assertPrivate(events) {
  for (const entry of events) {
    assert.doesNotMatch(JSON.stringify(entry.data) || "", /"(?:valeur|expected|pool|correctRanks|correctCount)"\s*:/, entry.name);
  }
}

function closeWithAnswers(state, customize = (payload) => payload) {
  const { h, clients, mini } = state;
  assert.equal(mini.subPhase, "theme");
  h.advance(2500);
  assert.equal(mini.subPhase, "answering");
  clients.forEach((client, index) => client.send("leBonOrdreAnswer", customize(answer(mini), index)));
  assert.equal(mini.subPhase, "correction");
}

test("Bon Ordre : le vrai formulaire client émet une proposition acceptée", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");
  const from = source.indexOf("function submitBonOrdreAnswer(pass)");
  const to = source.indexOf("\nlboValidateBtn?.addEventListener", from);
  assert.ok(from >= 0 && to > from);
  for (const mode of ["battle_royale", "liste"]) {
    const { h, room, clients, mini } = start(mode);
    h.advance(2500);
    const payload = answer(mini);
    let playerIndex = 0;
    const client = {
      bonOrdreState: { ...payload, roomCode: room.roomCode, gameMode: mode, roundNumber: 1 },
      bonOrdreCanEdit: () => true, bonOrdreOrderedIds: () => payload.orderedIds,
      sfxBubbleClick: { play() {} }, closeBonOrdreRankSelector() {}, renderBonOrdreCards() {},
      emitGameAction: (event, data) => clients[playerIndex].send(event, data)
    };
    vm.runInNewContext(source.slice(from, to) + "\nglobalThis.submit = submitBonOrdreAnswer;", client);
    client.submit(false);
    assert.deepEqual(Array.from(mini.playerAnswers.p0.orderedIds), Array.from(payload.orderedIds));
    playerIndex = 1;
    client.submit(true);
    assert.equal(mini.playerAnswers.p1.pass, true);
    assert.equal(mini.playerAnswers.p1.orderedIds, null);
  }
});

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} Bon Ordre : sept corrections de 15 s, classements puis une seule fin`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    const firstPayload = answer(mini);
    clients[0].send("leBonOrdreAnswer", firstPayload);
    assert.equal(Object.keys(mini.playerAnswers).length, 0, "Aucune réponse avant le chrono");
    let previous = new Map(room.players.map((player) => [player.playerId, player.roundScore]));
    for (let questionIndex = 0; questionIndex < 7; questionIndex++) {
      assert.equal(mini.questionIndex, questionIndex);
      assert.equal(mini.subPhase, "theme");
      const beforeAnswer = h.events.length;
      h.advance(2500);
      assert.equal(mini.subPhase, "answering");
      const payload = answer(mini);
      if (!questionIndex) {
        for (const invalid of [
          { ...payload, instanceId: "obsolete" }, { ...payload, questionIndex: 1 },
          { ...payload, questionId: "autre" }, { ...payload, orderedIds: payload.orderedIds.slice(1) },
          { ...payload, orderedIds: Array(5).fill(payload.orderedIds[0]) },
          { ...payload, orderedIds: ["intrus", ...payload.orderedIds.slice(1)] }, { answer: "Ancien fonctionnement" }
        ]) clients[0].send("leBonOrdreAnswer", invalid);
        assert.equal(Object.keys(mini.playerAnswers).length, 0);
      }
      h.advance(1000);
      clients[0].send("leBonOrdreAnswer", payload);
      const saved = JSON.stringify(mini.playerAnswers.p0);
      clients[0].send("leBonOrdreAnswer", { ...payload, pass: true, orderedIds: null });
      assert.equal(JSON.stringify(mini.playerAnswers.p0), saved);
      assert.equal(mini.subPhase, "answering", "La validation personnelle n'ouvre pas la correction");
      assert.equal(room.players[0].roundScore, questionIndex);
      assertPrivate(h.events.slice(beforeAnswer));
      clients[1].send("leBonOrdreAnswer", payload);
      clients[2].send("leBonOrdreAnswer", questionIndex ? payload : { ...payload, pass: true, orderedIds: null });
      assert.equal(mini.subPhase, "correction");
      assert.equal(mini.questionIndex, questionIndex, "La question ne change pas pendant sa correction");
      assert.equal(room.players[0].roundScore, questionIndex + 1);
      assert.equal(room.players[2].roundScore, questionIndex);
      const correction = lastEvent(h, "leBonOrdreCorrection", clients[0]);
      assert.equal(correction.currentQIndex, questionIndex + 1);
      assert.equal(correction.durationMs, 15000);
      assert.equal(correction.remainingMs, 15000);
      assert.equal(correction.bonOrdreData.grade, 1);
      const closedTotals = totals(room);
      for (const event of ["correctionPrevQuestion", "correctionNextQuestion"]) clients[0].send(event);
      clients[0].send("correctionNavigate", { direction: 1 });
      clients[0].send("hostGradePlayer", { points: 0 });
      h.api.startCorrectionPhase(room.roomCode);
      clients[0].send("requestRoomState");
      assert.equal(totals(room), closedTotals);
      assert.equal(mini.subPhase, "correction");
      h.advance(14999);
      assert.equal(mini.subPhase, "correction");
      assert.equal(h.events.slice(beforeAnswer).some((event) => event.name === "scoreUpdate"), false,
        "Le tableau ne reçoit pas le nouveau classement avant son animation");
      h.advance(1);
      assert.equal(mini.subPhase, "leaderboard");
      assert.equal(mini.questionIndex, questionIndex);
      const ranking = lastEvent(h, "leBonOrdreLeaderboard");
      assert.equal(ranking.durationMs, questionIndex === 6 ? 4500 : 3000);
      assert.equal(ranking.isLastQuestion, questionIndex === 6);
      for (const player of ranking.previousPlayers) assert.equal(player.score, previous.get(player.id));
      for (const player of ranking.players) assert.equal(player.score, room.players.find((entry) => entry.playerId === player.id).roundScore);
      previous = new Map(room.players.map((player) => [player.playerId, player.roundScore]));
      assert.equal(totals(room), closedTotals);
      assert.ok(room.players.every((player) => player.tournamentPoints === 0 && !player.eliminated));
      assert.equal(h.events.some((event) => event.name === "correctionUpdate"), false);
      assert.equal(h.events.some((event) => event.name === "leBonOrdreExit"), false);
      h.advance(ranking.durationMs - 1);
      assert.equal(mini.subPhase, "leaderboard");
      h.advance(1);
      assert.equal(mini.subPhase, questionIndex === 6 ? "ending" : "theme");
      assert.equal(totals(room), closedTotals);
    }
    assert.equal(h.events.filter((event) => event.name === "leBonOrdreExit" && event.target === room.roomCode).length, 1);
    assert.equal(h.events.filter((event) => event.name === "leBonOrdreLeaderboard" && event.target === room.roomCode).length, 7);
    assert.equal(h.events.some((event) => event.name === "leBonOrdreEnd" || event.name === "correctionUpdate"), false);
    const exit = lastEvent(h, "leBonOrdreExit");
    assert.equal(exit.durationMs, mode === "liste" ? 3500 : 7000);
    h.advance(exit.durationMs);
    if (mode === "liste") {
      assert.equal(room.gameState.phase, "listeLeaderboard");
      assert.equal(room.listeTournament.roundResults.length, 1);
      assert.equal(room.players[0].tournamentPoints, 3);
      const awarded = JSON.stringify(room.players.map((player) => player.tournamentPoints));
      h.api.endMiniGame(room.roomCode);
      assert.equal(JSON.stringify(room.players.map((player) => player.tournamentPoints)), awarded);
      assert.equal(room.listeTournament.roundResults.length, 1);
    } else {
      assert.equal(room.players.filter((player) => player.eliminated).length, 1);
      assert.equal(h.events.filter((event) => event.name === "playerEliminated").length, 1);
    }
  });

  test(`${mode} Bon Ordre : notes 1, 0,5, 0 et temps appliqués à chaque clôture uniquement`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    for (let questionIndex = 0; questionIndex < 7; questionIndex++) {
      const q = mini.questions[questionIndex];
      q.cards = q.cards.map((card, index) => ({ ...card, valeur: 5 - index }));
      const ids = q.cards.map((card) => card.id);
      const submissions = [ids, [...ids.slice(0, 3), ids[4], ids[3]], [...ids.slice(1), ids[0]]];
      h.advance(2500);
      h.advance(2000);
      clients[0].send("leBonOrdreAnswer", answer(mini, { orderedIds: submissions[0] }));
      h.advance(1000);
      clients[1].send("leBonOrdreAnswer", answer(mini, { orderedIds: submissions[1] }));
      h.advance(1000);
      assert.equal(room.players[0].roundScore, questionIndex);
      clients[2].send("leBonOrdreAnswer", answer(mini, { orderedIds: submissions[2] }));
      assert.equal(mini.subPhase, "correction");
      assert.deepEqual(Array.from(room.players, (player) => player.roundScore), [questionIndex + 1, (questionIndex + 1) / 2, 0]);
      assert.deepEqual(Array.from(room.players, (player) => player.roundTime), [2 * (questionIndex + 1), 3 * (questionIndex + 1), 45 * (questionIndex + 1)]);
      const applied = totals(room);
      h.advance(15000 + (questionIndex === 6 ? 4500 : 3000));
      assert.equal(totals(room), applied);
    }
  });

  test(`${mode} Bon Ordre : corrections privées par socket et spectateur sans proposition`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    const spectator = h.socket("spectator");
    spectator.send("joinRoom", { roomCode: room.roomCode, playerId: "spectator", pseudo: "Spectateur" });
    const q = mini.questions[0];
    q.cards = q.cards.map((card, index) => ({ ...card, valeur: 5 - index }));
    const ids = q.cards.map((card) => card.id);
    const personal = [ids, [...ids].reverse(), null];
    assertPrivate(h.events);
    h.advance(2500);
    clients.forEach((client, index) => client.send("leBonOrdreAnswer", answer(mini,
      index === 2 ? { pass: true, orderedIds: null } : { orderedIds: personal[index] })));
    const corrections = h.events.filter((event) => event.name === "leBonOrdreCorrection");
    assert.equal(corrections.length, 4);
    assert.ok(corrections.every((event) => event.target !== room.roomCode));
    for (let index = 0; index < clients.length; index++) {
      const payload = lastEvent(h, "leBonOrdreCorrection", clients[index]);
      assert.equal(payload.isParticipant, true);
      assert.equal(payload.playerPseudo, room.players[index].pseudo);
      assert.deepEqual(Array.from(payload.bonOrdreData.positions, (card) => card.id), personal[index] || []);
      assert.equal(payload.bonOrdreData.status, index === 2 ? "pass" : "answered");
      assert.deepEqual(new Set(payload.bonOrdreData.expected.map((card) => card.id)), new Set(ids));
      assert.doesNotMatch(JSON.stringify(payload), /"(?:history|automaticResults|pool|playerAnswers)"\s*:/);
    }
    const watched = lastEvent(h, "leBonOrdreCorrection", spectator);
    assert.equal(watched.isParticipant, false);
    assert.equal(watched.playerPseudo, null);
    assert.equal(watched.bonOrdreData.status, "spectator");
    assert.equal(watched.bonOrdreData.grade, null);
    assert.equal(watched.bonOrdreData.correctCount, null);
    assert.equal(watched.bonOrdreData.positions.length, 0);
    assert.equal(watched.bonOrdreData.expected.length, 5);
    spectator.send("leBonOrdreAnswer", answer(mini));
    assert.equal(Object.hasOwn(mini.playerAnswers, "spectator"), false);
  });

  test(`${mode} Bon Ordre : reconnexion restaure correction, classement puis annonce en cours`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    h.advance(2500);
    const own = answer(mini);
    clients[0].send("leBonOrdreAnswer", own);
    clients[0].send("disconnect");
    clients[1].send("leBonOrdreAnswer", answer(mini));
    clients[2].send("leBonOrdreAnswer", answer(mini));
    assert.equal(mini.subPhase, "correction");
    assert.equal(h.events.filter((event) => event.name === "leBonOrdreCorrection" && event.target === clients[0].id).length, 0);
    const original = lastEvent(h, "leBonOrdreCorrection", clients[1]);
    const applied = totals(room);
    h.advance(7000);
    const returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    const restored = lastEvent(h, "leBonOrdreCorrection", returned);
    assert.equal(restored.isParticipant, true, "Un participant déconnecté reste participant");
    assert.equal(restored.remainingMs, 8000);
    assert.equal(restored.correctionStartedAt, original.correctionStartedAt);
    assert.equal(restored.correctionEndsAt, original.correctionEndsAt);
    assert.deepEqual(Array.from(restored.bonOrdreData.positions, (card) => card.id), Array.from(own.orderedIds));
    assert.equal(totals(room), applied);
    h.advance(8000 + 500);
    assert.equal(mini.subPhase, "leaderboard");
    const beforeRank = h.events.length;
    returned.send("requestRoomState");
    assert.equal(h.events.slice(beforeRank).some((event) => event.name === "leBonOrdreCorrection"), false);
    assert.equal(lastEvent(h, "leBonOrdreLeaderboard", returned).remainingMs, 2500);
    h.advance(2500 + 500);
    assert.equal(mini.subPhase, "theme");
    const beforeTheme = h.events.length;
    returned.send("requestRoomState");
    const resumed = h.events.slice(beforeTheme);
    assert.equal(resumed.some((event) => event.name === "leBonOrdreCorrection" || event.name === "leBonOrdreLeaderboard"), false);
    const question = lastEvent(h, "leBonOrdreQuestion", returned);
    assert.equal(question.questionIndex, 1);
    assert.equal(question.timer.active, false);
    assert.equal(totals(room), applied);
    assertPrivate(resumed);
  });

  test(`${mode} Bon Ordre : réponse verrouillée et même tirage restaurés pendant le chrono`, () => {
    const { h, room, clients, mini } = start(mode);
    h.advance(6500);
    const own = answer(mini);
    clients[0].send("leBonOrdreAnswer", own);
    const initialCards = mini.questions[0].cards.map((card) => card.id);
    const responseTime = mini.responseTimesByQuestion[0].p0;
    clients[0].send("disconnect");
    h.advance(1500);
    const returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    const restored = lastEvent(h, "leBonOrdreQuestion", returned);
    assert.equal(restored.hasAnswered, true);
    assert.deepEqual(Array.from(restored.question.cards, (card) => card.id), Array.from(initialCards));
    assert.deepEqual(Array.from(restored.savedAnswer.orderedIds), Array.from(own.orderedIds));
    assert.equal(restored.timer.remaining, 39.5);
    returned.send("leBonOrdreAnswer", { ...own, pass: true, orderedIds: null });
    assert.deepEqual(Array.from(mini.playerAnswers.p0.orderedIds), Array.from(own.orderedIds));
    assert.equal(mini.responseTimesByQuestion[0].p0, responseTime);
    assert.equal(room.players[0].roundScore, 0);
    assertPrivate(h.events);
  });

  test(`${mode} Bon Ordre : expiration produit une absence explicite sans soumission automatique`, () => {
    const state = start(mode);
    const { h, room, clients, mini } = state;
    h.advance(2500);
    clients[0].send("leBonOrdreAnswer", answer(mini));
    clients[1].send("leBonOrdreAnswer", answer(mini, { pass: true, orderedIds: null }));
    h.advance(44999);
    assert.equal(mini.subPhase, "answering");
    assert.equal(room.players[0].roundScore, 0);
    h.advance(1);
    assert.equal(mini.subPhase, "correction");
    assert.equal(lastEvent(h, "leBonOrdreCorrection", clients[2]).bonOrdreData.status, "missing");
    assert.equal(lastEvent(h, "leBonOrdreCorrection", clients[1]).bonOrdreData.status, "pass");
    assert.deepEqual(Array.from(room.players, (player) => player.roundScore), [1, 0, 0]);
    assert.deepEqual(Array.from(room.players, (player) => player.roundTime), [0, 45, 45]);
    assert.equal(mini.questionIndex, 0);
  });
}
