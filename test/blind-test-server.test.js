"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Même serveur, transports et horloge isolés que les tests de tournoi existants.
const harnessFile = path.join(__dirname, "liste-flow.test.js");
const setup = fs.readFileSync(harnessFile, "utf8").split("function startPenaveRound()")[0];
const context = { require: createRequire(harnessFile), __dirname, Buffer, process };
vm.runInNewContext(setup + "\nglobalThis.makeHarness = harness;", context);

function start(mode, h = context.makeHarness(), expectedPhase = "playing") {
  const { room, clients } = h.create(3);
  if (mode === "liste") h.configure(room, clients[0], "manual", ["blind_test"]);
  clients[0].send("hostStartGame", mode === "liste" ? {} : { forcedMiniGame: "blind_test" });
  if (mode === "battle_royale") h.advance(32500);
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach(client => client.send("playerSetReady", { isReady: true }));
  assert.equal(room.gameState.phase, expectedPhase);
  const mini = room.gameState.currentMiniGameState;
  if (expectedPhase === "playing") {
    assert.equal(mini.type, "blind_test");
    assert.equal(mini.questions.length, 9);
  }
  return { h, room, clients, mini };
}

function last(h, name, target) {
  return h.events.filter(e => e.name === name && (!target || e.target === target.id)).at(-1)?.data;
}

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} Blind Test : banque insuffisante, erreur explicite sans partie ni historique consommé`, () => {
    const brokenContext = { require: createRequire(harnessFile), __dirname, Buffer, process };
    const brokenSetup = setup.replace("return realRequire(name);", `
      if (name === path.join(root, "public_2", "blind_test", "blind_test.json")) {
        const bank = realRequire(name);
        return { ...bank, questions: bank.questions.filter(q => q.theme_id !== "musique") };
      }
      return realRequire(name);`).replace("roomCreationTimes, startCorrectionPhase",
        "roomCreationTimes, startCorrectionPhase, getPlayedHistory");
    vm.runInNewContext(brokenSetup + "\nglobalThis.makeHarness = harness;", brokenContext);
    const h = brokenContext.makeHarness();
    const { mini, room } = start(mode, h, "rules");
    assert.equal(mini, null);
    assert.equal(Object.keys(room.gameState.readyPlayers).length, 0);
    assert.match(last(h, "errorMessage"), /Impossible de lancer le Blind Test.*musique.*5 requises/);
    assert.equal(h.events.some(e => e.name === "blindTestQuestion"), false);
    assert.equal(JSON.stringify(h.api.getPlayedHistory()), "{}");
  });

  test(`${mode} Blind Test : neuf réponses, reconnexions, neuf corrections, scores et suite`, () => {
    const { h, room, clients, mini } = start(mode);
    const host = () => clients.find(client => client.playerId === room.hostId);
    for (let q = 0; q < 9; q++) {
      assert.equal(mini.questionIndex, q);
      const payload = last(h, "blindTestQuestion");
      assert.equal(payload.index, q + 1);
      assert.equal(payload.total, 9);
      assert.equal(payload.themeName, mini.questions[q].themeName);
      assert.equal(payload.question.audio, mini.questions[q].audio_question);
      h.advance(2500);
      assert.equal(mini.timer.totalSeconds, 40);
      h.advance(1000 + q * 100);
      clients[0].send("blindTestAnswer", { answer: `Réponse ${q}` });
      const expectedTime = 1 + q / 10;
      assert.equal(mini.responseTimesByQuestion[q].p0, expectedTime);
      if (q === 4) {
        clients[0].send("disconnect");
        const returned = h.socket("p0");
        returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
        clients[0] = returned;
        assert.equal(last(h, "blindTestQuestion", returned).index, 5);
        assert.equal(last(h, "blindTestQuestion", returned).total, 9);
        assert.equal(last(h, "blindTestTimerUpdate", returned).total, 40);
        returned.send("blindTestAnswer", { answer: "Écrasement interdit" });
        assert.equal(mini.playerAnswers.p0, `Réponse ${q}`);
      }
      h.advance(1000);
      clients[1].send("blindTestAnswer", { answer: `Partielle ${q}` });
      h.advance(1000);
      clients[2].send("blindTestAnswer", { answer: "RIEN" });
      assert.equal(mini.history.p0[q], `Réponse ${q}`);
      assert.equal(mini.history.p1[q], `Partielle ${q}`);
      assert.equal(mini.timer.running, false);
    }
    assert.equal(mini.finished, true);
    assert.equal(h.events.filter(e => e.name === "blindTestEnd").length, 1);
    h.advance(3000);
    assert.equal(mini.correctionIndex, 0);
    for (let q = 0; q < 9; q++) {
      assert.equal(mini.correctionIndex, q);
      const payload = last(h, "correctionUpdate");
      assert.equal(payload.currentQIndex, q + 1);
      assert.equal(payload.totalQ, 9);
      assert.equal(payload.audio, mini.questions[q].audio);
      assert.equal(payload.answerImage, mini.questions[q].image);
      if (q === 8) {
        clients[1].send("disconnect");
        const returned = h.socket("p1");
        returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retour correction" });
        clients[1] = returned;
        const restored = last(h, "correctionUpdate", returned);
        assert.equal(restored.currentQIndex, 9);
        assert.equal(restored.totalQ, 9);
        assert.equal(restored.playerAnswer, "Réponse 8");
      }
      for (let p = 0; p < 3; p++) {
        host().send("correctionNavigate", { direction: p === 0 ? -99 : 1 });
        host().send("hostGradePlayer", { points: [1, 0.5, 0][p] });
      }
      // Réviser la même note ne doit pas doubler score ni temps.
      host().send("hostGradePlayer", { points: 0 });
      host().send("correctionNextQuestion");
    }
    assert.deepEqual(Array.from(room.players, p => p.roundScore), [9, 4.5, 0]);
    assert.ok(Math.abs(room.players[0].roundTime - 12.6) < 1e-9);
    assert.ok(Math.abs(room.players[1].roundTime - 21.6) < 1e-9);
    assert.equal(room.players[2].roundTime, 360);
    h.advance(mode === "liste" ? 8500 : 12000);
    if (mode === "liste") {
      assert.equal(room.gameState.phase, "listeLeaderboard");
      assert.equal(room.listeTournament.roundResults.length, 1);
      assert.deepEqual(Array.from(room.players, p => p.tournamentPoints), [3, 2, 1]);
      assert.ok(room.players.every(p => !p.eliminated));
      assert.equal(h.events.some(e => /eliminated|finalists/i.test(e.name)), false);
      h.advance(8000);
      assert.equal(room.gameState.phase, "listeFinished");
    } else {
      assert.equal(room.players.filter(p => p.eliminated).length, 1);
      assert.ok(h.events.some(e => e.name === "playFinaleAnimation"));
      h.advance(23000);
      assert.equal(room.gameState.phase, "rules");
      assert.equal(room.gameState.currentMiniGame, "les_encheres");
    }
  });

  test(`${mode} Blind Test : expiration des neuf chronomètres`, () => {
    const { h, room, mini } = start(mode);
    for (let q = 0; q < 9; q++) {
      assert.equal(mini.questionIndex, q);
      h.advance(2500 + 40000);
      assert.equal(mini.history.p0[q], "RIEN");
    }
    h.advance(3000);
    assert.equal(mini.correctionIndex, 0);
    assert.equal(last(h, "correctionUpdate").totalQ, 9);
    assert.equal(room.players[0].roundScore, 0);
  });

  test(`${mode} Blind Test : callbacks précédents sans effet sur la question suivante`, () => {
    const { h, room, clients, mini } = start(mode);
    const announcement = h.allTimers.at(-1);
    h.advance(2500);
    const interval = h.allTimers.at(-1);
    clients.forEach(client => client.send("blindTestAnswer", { answer: "Test" }));
    assert.equal(mini.questionIndex, 1);
    announcement.fn();
    assert.equal(mini.timer.running, false);
    h.advance(2500);
    const running = room.blindTestInterval;
    interval.fn();
    h.advance(1000);
    assert.equal(room.blindTestInterval, running);
    assert.equal(mini.timer.remainingSeconds, 39);
    assert.equal(mini.questionIndex, 1);
  });
}
