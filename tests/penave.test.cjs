"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestionBank, rankPenaveResults } = require("../penave-ou-nachave");
const { settleListeRound, rankMiniGameResults } = require("../liste-tournament");

test("la banque réelle possède des identifiants stables et des thèmes connus", () => {
  const bank = validateQuestionBank(require("../public_2/penave_ou_nachave/penave_ou_nachave.json"));
  assert.equal(bank.questions.length, 57);
  assert.throws(() => validateQuestionBank({ themes: [{ id: "x", name: "X" }],
    questions: [{ id: 1, theme_id: "x", question: "a" }, { id: 1, theme_id: "x", question: "b" }] }));
});

test("échec collectif au tour 4 : 32 secondes gagnent face à 35", () => {
  const players = [{ playerId: "a", pseudo: "A" }, { playerId: "b", pseudo: "B" }];
  const mini = { tieOrder: ["b", "a"], stats: {
    a: { correct: 3, timeMs: 32000, eliminatedRound: 4 },
    b: { correct: 3, timeMs: 35000, eliminatedRound: 4 }
  } };
  const ranking = rankPenaveResults(players, mini, 2);
  assert.deepEqual(ranking.map((entry) => [entry.playerId, entry.time, entry.points]),
    [["a", 32, 2], ["b", 35, 1]]);
});

test("l'élimination tardive prime sur le temps, puis un ordre de tirage figé départage", () => {
  const players = ["a", "b", "c", "d"].map((playerId) => ({ playerId, pseudo: playerId }));
  const mini = { tieOrder: ["d", "b", "c", "a"], stats: {
    a: { correct: 2, timeMs: 9000, eliminatedRound: null },
    b: { correct: 1, timeMs: 20000, eliminatedRound: 2 },
    c: { correct: 0, timeMs: 1000, eliminatedRound: 1 },
    d: { correct: 1, timeMs: 20000, eliminatedRound: 2 }
  } };
  const ranking = rankPenaveResults(players, mini, 4);
  assert.deepEqual(ranking.map((entry) => entry.playerId), ["a", "d", "b", "c"]);
  const sameFirstTurn = { tieOrder: ["c", "a", "b"], stats: Object.fromEntries(
    ["a", "b", "c"].map((id) => [id, { correct: 0, timeMs: 20000, eliminatedRound: 1 }])) };
  assert.deepEqual(rankPenaveResults(players.slice(0, 3), sameFirstTurn, 3)
    .map((entry) => entry.playerId), ["c", "a", "b"]);
});

test("les places figées servent aux points une seule fois sans changer les autres jeux", () => {
  const players = ["a", "b", "c"].map((playerId) => ({
    playerId, pseudo: playerId, roundScore: 0, roundTime: 20,
    tournamentPoints: 0, tournamentTime: 0, tournamentPlacements: []
  }));
  const fixedPlacements = ["c", "a", "b"].map((playerId, index) => ({
    playerId, pseudo: playerId, score: 0, time: 20, place: index + 1, points: 3 - index
  }));
  const args = { roundKey: "t:1", roundNumber: 1, miniGame: "penave_ou_nachave",
    initialParticipantCount: 3, players, fixedPlacements };
  const first = settleListeRound(args);
  assert.equal(first.applied, true);
  assert.deepEqual(first.roundResult.placements.map((p) => p.playerId), ["c", "a", "b"]);
  assert.deepEqual(first.playerUpdates.map((p) => p.tournamentPoints), [3, 2, 1]);
  const again = settleListeRound({ ...args, previousRoundResults: [first.roundResult] });
  assert.equal(again.applied, false);
  assert.deepEqual(again.playerUpdates, []);
  assert.deepEqual(rankMiniGameResults(players.map((p) => ({
    playerId: p.playerId, pseudo: p.pseudo, score: 0, time: 20
  })), 3).map((p) => p.place), [1, 1, 1]);
});
