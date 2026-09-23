"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const clientSource = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Bloc introuvable : ${startMarker}`);
  return source.slice(start, end);
}

function loadSocketHandler(block, context, eventName) {
  let handler;
  context.socket.on = (name, callback) => {
    if (name === eventName) handler = callback;
  };
  vm.runInNewContext(block, context);
  assert.equal(typeof handler, "function");
  return handler;
}

test("Petit Bac conserve le premier formulaire et son temps face à un double envoi", () => {
  const player = { playerId: "p1", socketId: "s1", eliminated: false, isSpectator: false };
  const other = { playerId: "p2", socketId: "s2", eliminated: false, isSpectator: false };
  const mini = {
    type: "petit_bac", finished: false, startTime: 1000,
    playerAnswers: {}, responseTimes: {}, responseTimesByQuestion: {}, history: {}
  };
  const room = { players: [player, other], gameState: { currentMiniGameState: mini } };
  let now = 126000;
  let ackCount = 0;
  const context = {
    rooms: { TEST: room },
    socket: { roomCode: "TEST", playerId: "p1", id: "s1", emit: (name) => {
      if (name === "petitBacAnswerAck") ackCount++;
    } },
    Date: { now: () => now },
    canUseMiniGameSocket: () => true,
    rememberManualResponseTime: (state, playerId, time) => {
      state.responseTimesByQuestion[0] = { [playerId]: time };
    },
    isActiveMiniGamePlayer: () => true,
    endPetitBacRound: () => assert.fail("La manche ne doit pas finir avec un seul répondant")
  };
  const handler = loadSocketHandler(
    extract(serverSource, '  socket.on("petitBacAnswer",', '  socket.on("correctionNavigate",'),
    context,
    "petitBacAnswer"
  );

  const firstAnswers = { 0: "Paris" };
  handler({ roomCode: "TEST", answers: firstAnswers });
  now = 140000;
  handler({ roomCode: "TEST", answers: { 0: "Lyon" } });

  assert.strictEqual(mini.playerAnswers.p1, firstAnswers);
  assert.equal(JSON.stringify(mini.history.p1), JSON.stringify({ 0: firstAnswers }));
  assert.equal(mini.responseTimes.p1, 125);
  assert.equal(mini.responseTimesByQuestion[0].p1, 125);
  assert.equal(ackCount, 2);
});

test("Faux du vrai conserve réponse et temps après double envoi et reconnexion, puis accepte la question suivante", () => {
  const player = { playerId: "p1", socketId: "s1", eliminated: false, isSpectator: false };
  const other = { playerId: "p2", socketId: "s2", eliminated: false, isSpectator: false };
  const game = {
    type: "faux_vrai", index: 0,
    list: [
      { affirmations: ["A", "B", "C"] },
      { affirmations: ["D", "E", "F"] }
    ],
    timer: {}, startTime: 1000, answers: {}, answerTimes: {}
  };
  const room = { players: [player, other], mini: game };
  let now = 11000;
  const socket = { roomCode: "TEST", playerId: "p1", id: "s1" };
  const context = {
    rooms: { TEST: room }, socket,
    Date: { now: () => now },
    canUseMiniGameSocket: (currentRoom, currentPlayer, currentSocket) =>
      currentPlayer.socketId === currentSocket.id,
    isActiveMiniGamePlayer: () => true,
    clearInterval: () => assert.fail("Tous les joueurs n'ont pas répondu"),
    revealFauxVrai: () => assert.fail("Tous les joueurs n'ont pas répondu")
  };
  const handler = loadSocketHandler(
    extract(serverSource, '  socket.on("fauxVraiAnswer",', '  socket.on("quiSuisJeAnswer",'),
    context,
    "fauxVraiAnswer"
  );

  handler(1);
  now = 21000;
  handler(2);
  assert.equal(game.answers.p1, 1);
  assert.equal(game.answerTimes.p1, 10);

  player.socketId = "s1-reconnected";
  socket.id = "s1-reconnected";
  now = 31000;
  handler(0);
  assert.equal(game.answers.p1, 1);
  assert.equal(game.answerTimes.p1, 10);

  game.index = 1;
  game.answers = {};
  game.answerTimes = {};
  game.startTime = 30000;
  now = 35000;
  handler(2);
  assert.equal(game.answers.p1, 2);
  assert.equal(game.answerTimes.p1, 5);
});

test("la reconnexion resynchronise les 150 s du Petit Bac et le choix Faux du vrai déjà envoyé", () => {
  const syncBlock = extract(serverSource, "function syncPlayerWithGame", 'app.get("/admin/memory/view"');
  const emitted = [];
  const socket = {
    playerId: "p1",
    emit: (name, payload) => emitted.push({ name, payload })
  };
  const context = {
    socket,
    isListeParticipant: () => true,
    sendCorrectionData: () => {},
    ENCHERES_THEMES: [],
    FAUX_VRAI_TIMER_DURATION: 45
  };
  vm.runInNewContext(`${syncBlock}; globalThis.sync = syncPlayerWithGame;`, context);

  context.sync(socket, {
    gameMode: "battle_royale", roomCode: "PBAC",
    gameState: {
      phase: "playing",
      currentMiniGameState: {
        type: "petit_bac", letter: "P", categories: ["Pays"],
        playerAnswers: { p1: { 0: "Portugal" } },
        timer: { running: true, remainingSeconds: 37, totalSeconds: 150 }
      }
    }
  });
  assert.deepEqual(emitted.map(({ name }) => name), ["petitBacStart", "petitBacTimerUpdate"]);
  assert.equal(emitted[0].payload.duration, 150);
  assert.equal(emitted[0].payload.hasAnswered, true);
  assert.equal(JSON.stringify(emitted[0].payload.savedAnswers), JSON.stringify({ 0: "Portugal" }));
  assert.equal(JSON.stringify(emitted[1].payload), JSON.stringify({ remaining: 37, total: 150 }));

  emitted.length = 0;
  context.sync(socket, {
    gameMode: "battle_royale", roomCode: "FAUX",
    gameState: { phase: "playing", currentMiniGameState: null },
    mini: {
      type: "faux_vrai", index: 0,
      list: [{ question: "Q", affirmations: ["A", "B"], themeId: 1, indexFausse: 1 }],
      answers: { p1: 1 }, timer: {}, remainingSeconds: 21, totalSeconds: 45
    }
  });
  assert.deepEqual(emitted.map(({ name }) => name), ["fauxVraiQuestion", "fauxVraiTimerUpdate"]);
  assert.equal(emitted[0].payload.hasAnswered, true);
  assert.equal(emitted[0].payload.selectedAnswerIndex, 1);
  assert.equal(JSON.stringify(emitted[1].payload), JSON.stringify({ remaining: 21, total: 45 }));
});

test("le client restaure visuellement le choix Faux du vrai envoyé", () => {
  const block = extract(clientSource, "function lockFauxVraiButtons", "function showFauxVraiQuestion");
  const makeButton = () => ({
    classes: new Set(),
    classList: {
      add(...names) { names.forEach((name) => this.owner.classes.add(name)); },
      remove(...names) { names.forEach((name) => this.owner.classes.delete(name)); },
      owner: null
    }
  });
  const buttons = [makeButton(), makeButton(), makeButton()];
  buttons.forEach((button) => { button.classList.owner = button; });
  const feedback = { textContent: "" };
  const context = {
    document: { querySelectorAll: () => buttons },
    fauxVraiFeedback: feedback
  };
  vm.runInNewContext(`${block}; globalThis.restore = restoreFauxVraiSubmittedState;`, context);
  context.restore(1);

  assert.equal(buttons[1].classes.has("selected"), true);
  assert.equal(buttons[1].classes.has("btn-waiting-selected"), true);
  assert.equal(buttons[0].classes.has("btn-waiting-other"), true);
  assert.equal(buttons.every((button) => button.classes.has("locked")), true);
  assert.match(feedback.textContent, /Réponse envoyée/);
});
