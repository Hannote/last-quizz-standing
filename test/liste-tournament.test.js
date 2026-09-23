"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateGradeRevision,
  getQuestionResponseTime,
  rankMiniGameResults,
  rankTournamentPlayers,
  recordQuestionResponseTime,
  settleListeRound,
  validateManualGrade
} = require("../liste-tournament");

function player(playerId, overrides = {}) {
  return {
    playerId,
    pseudo: playerId,
    withdrawn: false,
    roundScore: 0,
    roundTime: 0,
    tournamentPoints: 0,
    tournamentTime: 0,
    tournamentPlacements: [],
    ...overrides
  };
}

test("classe un mini-jeu par score décroissant puis temps croissant", () => {
  const ranking = rankMiniGameResults([
    { playerId: "lent", score: 3, time: 20 },
    { playerId: "score-bas", score: 2, time: 1 },
    { playerId: "rapide", score: 3, time: 10 }
  ], 3);

  assert.deepEqual(ranking.map(({ playerId, place, points }) => ({ playerId, place, points })), [
    { playerId: "rapide", place: 1, points: 3 },
    { playerId: "lent", place: 2, points: 2 },
    { playerId: "score-bas", place: 3, points: 1 }
  ]);
});

test("partage les places sur une égalité parfaite et saute la place suivante", () => {
  const ranking = rankMiniGameResults([
    { playerId: "a", score: 4, time: 8 },
    { playerId: "b", score: 4, time: 8 },
    { playerId: "c", score: 3, time: 2 }
  ], 3);

  assert.deepEqual(ranking.map(({ place, points }) => ({ place, points })), [
    { place: 1, points: 3 },
    { place: 1, points: 3 },
    { place: 3, points: 1 }
  ]);
});

test("conserve N après un abandon et exclut le joueur retiré de la manche", () => {
  const settlement = settleListeRound({
    roundKey: "2:blind_test",
    roundNumber: 2,
    miniGame: "blind_test",
    initialParticipantCount: 4,
    players: [
      player("a", { roundScore: 3, roundTime: 5 }),
      player("b", { roundScore: 2, roundTime: 7 }),
      player("c", { withdrawn: true, roundScore: 99, roundTime: 1 }),
      player("d", { roundScore: 1, roundTime: 9 })
    ]
  });

  assert.equal(settlement.roundResult.initialParticipantCount, 4);
  assert.deepEqual(settlement.roundResult.placements.map(({ playerId, points }) => ({ playerId, points })), [
    { playerId: "a", points: 4 },
    { playerId: "b", points: 3 },
    { playerId: "d", points: 2 }
  ]);
  assert.equal(settlement.playerUpdates.some(({ playerId }) => playerId === "c"), false);
});

test("refuse une seconde attribution de points pour la même manche", () => {
  const first = settleListeRound({
    roundKey: "1:qui_suis_je",
    roundNumber: 1,
    miniGame: "qui_suis_je",
    initialParticipantCount: 1,
    players: [player("a", { roundScore: 2, roundTime: 4 })]
  });
  const second = settleListeRound({
    roundKey: "1:qui_suis_je",
    roundNumber: 1,
    miniGame: "qui_suis_je",
    initialParticipantCount: 1,
    players: [player("a", { roundScore: 9, roundTime: 1 })],
    previousRoundResults: [first.roundResult]
  });

  assert.equal(first.applied, true);
  assert.equal(Object.isFrozen(first.roundResult), true);
  assert.equal(Object.isFrozen(first.roundResult.placements), true);
  assert.equal(second.applied, false);
  assert.deepEqual(second.playerUpdates, []);
  assert.strictEqual(second.roundResult, first.roundResult);
});

test("classe le tournoi par points puis temps et accepte des co-vainqueurs", () => {
  const ranking = rankTournamentPlayers([
    player("a", { tournamentPoints: 8, tournamentTime: 20 }),
    player("b", { tournamentPoints: 8, tournamentTime: 15 }),
    player("c", { tournamentPoints: 8, tournamentTime: 15 }),
    player("retire", { withdrawn: true, tournamentPoints: 99, tournamentTime: 1 })
  ]);

  assert.deepEqual(ranking.map(({ playerId, place }) => ({ playerId, place })), [
    { playerId: "b", place: 1 },
    { playerId: "c", place: 1 },
    { playerId: "a", place: 3 }
  ]);
});

test("historise les temps par question et révise une correction sans double comptage", () => {
  let history = recordQuestionResponseTime({}, 0, "a", 4);
  history = recordQuestionResponseTime(history, 1, "a", 11);

  assert.equal(getQuestionResponseTime(history, 0, "a", 40), 4);
  assert.equal(getQuestionResponseTime(history, 1, "a", 40), 11);

  const firstGrade = calculateGradeRevision({
    previousScore: 0,
    previousTime: 0,
    newScore: 1,
    responseTime: 4,
    maxDuration: 40
  });
  const revisedGrade = calculateGradeRevision({
    previousScore: 1,
    previousTime: firstGrade.appliedTime,
    newScore: 0.5,
    responseTime: 4,
    maxDuration: 40
  });

  assert.deepEqual(firstGrade, { scoreDelta: 1, timeDelta: 4, appliedTime: 4 });
  assert.deepEqual(revisedGrade, { scoreDelta: -0.5, timeDelta: 0, appliedTime: 4 });
});

test("valide strictement les notes manuelles et le détail du Petit Bac", () => {
  assert.deepEqual(validateManualGrade({ miniGameType: "blind_test", points: 0.5 }), { value: 0.5 });
  assert.match(validateManualGrade({ miniGameType: "blind_test", points: "1" }).error, /nombre fini/);
  assert.match(validateManualGrade({ miniGameType: "blind_test", points: 0.25 }).error, /0,5/);
  assert.deepEqual(validateManualGrade({
    miniGameType: "petit_bac",
    points: 1.5,
    details: { 0: 1, 1: 0.5 },
    categoryCount: 9
  }), { value: 1.5, details: { 0: 1, 1: 0.5 } });
  assert.match(validateManualGrade({
    miniGameType: "petit_bac",
    points: 2,
    details: { 0: 1, 1: 0.5 },
    categoryCount: 9
  }).error, /total/);
});
