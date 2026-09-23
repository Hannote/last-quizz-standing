"use strict";

const STANDARD_GRADE_VALUES = new Set([0, 0.5, 1]);

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} doit être un nombre fini positif ou nul.`);
  }
}

function validateManualGrade({ miniGameType, points, details, categoryCount = 0 }) {
  if (typeof points !== "number" || !Number.isFinite(points)) {
    return { error: "La note doit être un nombre fini." };
  }

  if (miniGameType !== "petit_bac") {
    return STANDARD_GRADE_VALUES.has(points)
      ? { value: points }
      : { error: "La note doit valoir 0, 0,5 ou 1." };
  }

  if (!Number.isInteger(categoryCount) || categoryCount < 1 ||
      points < 0 || points > categoryCount || !Number.isInteger(points * 2)) {
    return { error: `La note du Petit Bac doit être comprise entre 0 et ${categoryCount}, par pas de 0,5.` };
  }
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return { error: "Le détail des notes du Petit Bac est requis." };
  }

  let total = 0;
  for (const [rawIndex, value] of Object.entries(details)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= categoryCount || !STANDARD_GRADE_VALUES.has(value)) {
      return { error: "Le détail des notes du Petit Bac est invalide." };
    }
    total += value;
  }
  if (total !== points) {
    return { error: "Le total du Petit Bac ne correspond pas au détail des notes." };
  }

  return { value: points, details: { ...details } };
}

function recordQuestionResponseTime(history, questionIndex, playerId, timeTaken) {
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || !playerId) {
    throw new TypeError("Question ou joueur invalide pour l'historique des temps.");
  }
  assertFiniteNonNegative(timeTaken, "Le temps de réponse");
  const questionTimes = { ...(history?.[questionIndex] || {}), [playerId]: timeTaken };
  return { ...(history || {}), [questionIndex]: questionTimes };
}

function getQuestionResponseTime(history, questionIndex, playerId, fallback) {
  const value = history?.[questionIndex]?.[playerId];
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function calculateGradeRevision({ previousScore = 0, previousTime = 0, newScore, responseTime, maxDuration }) {
  assertFiniteNonNegative(previousScore, "L'ancienne note");
  assertFiniteNonNegative(previousTime, "L'ancien temps");
  assertFiniteNonNegative(newScore, "La nouvelle note");
  assertFiniteNonNegative(responseTime, "Le temps de réponse");
  assertFiniteNonNegative(maxDuration, "La durée maximale");

  const appliedTime = newScore > 0 ? responseTime : maxDuration;
  return {
    scoreDelta: newScore - previousScore,
    timeDelta: appliedTime - previousTime,
    appliedTime
  };
}

function compareMiniGameResult(a, b) {
  return b.score - a.score || a.time - b.time || a.playerId.localeCompare(b.playerId);
}

function compareTournamentResult(a, b) {
  return b.tournamentPoints - a.tournamentPoints ||
    a.tournamentTime - b.tournamentTime ||
    a.playerId.localeCompare(b.playerId);
}

function assignCompetitionPlaces(entries, isTie) {
  return entries.map((entry, index) => {
    const previous = entries[index - 1];
    const place = previous && isTie(entry, previous) ? previous.place : index + 1;
    const placed = { ...entry, place };
    entries[index] = placed;
    return placed;
  });
}

function rankMiniGameResults(players, initialParticipantCount) {
  if (!Number.isInteger(initialParticipantCount) || initialParticipantCount < 1) {
    throw new TypeError("Le nombre initial de participants doit être un entier positif.");
  }
  if (!Array.isArray(players) || players.length > initialParticipantCount) {
    throw new TypeError("La liste des résultats est invalide.");
  }

  const seen = new Set();
  const sorted = players.map((player) => {
    if (!player?.playerId || seen.has(player.playerId)) {
      throw new TypeError("Chaque résultat doit appartenir à un joueur unique.");
    }
    seen.add(player.playerId);
    assertFiniteNonNegative(player.score, "Le score");
    assertFiniteNonNegative(player.time, "Le temps");
    return {
      playerId: player.playerId,
      pseudo: player.pseudo || "",
      score: player.score,
      time: player.time
    };
  }).sort(compareMiniGameResult);

  return assignCompetitionPlaces(sorted, (a, b) => a.score === b.score && a.time === b.time)
    .map((entry) => ({
      ...entry,
      points: initialParticipantCount - entry.place + 1
    }));
}

function rankTournamentPlayers(players) {
  if (!Array.isArray(players)) throw new TypeError("La liste des joueurs est invalide.");
  const seen = new Set();
  const sorted = players.filter((player) => !player.withdrawn).map((player) => {
    if (!player?.playerId || seen.has(player.playerId)) {
      throw new TypeError("Chaque classement doit appartenir à un joueur unique.");
    }
    seen.add(player.playerId);
    assertFiniteNonNegative(player.tournamentPoints, "Le total de points");
    assertFiniteNonNegative(player.tournamentTime, "Le temps cumulé");
    return {
      playerId: player.playerId,
      pseudo: player.pseudo || "",
      tournamentPoints: player.tournamentPoints,
      tournamentTime: player.tournamentTime
    };
  }).sort(compareTournamentResult);

  return assignCompetitionPlaces(sorted, (a, b) =>
    a.tournamentPoints === b.tournamentPoints && a.tournamentTime === b.tournamentTime);
}

function freezeRoundResult(result) {
  result.placements.forEach(Object.freeze);
  Object.freeze(result.placements);
  return Object.freeze(result);
}

function settleListeRound({
  roundKey,
  roundNumber,
  miniGame,
  initialParticipantCount,
  players,
  previousRoundResults = []
}) {
  if (!roundKey || !miniGame || !Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new TypeError("L'identité de la manche Liste est invalide.");
  }
  const existing = previousRoundResults.find((result) => result.roundKey === roundKey);
  if (existing) return { applied: false, roundResult: existing, playerUpdates: [] };

  const eligiblePlayers = players.filter((player) => !player.withdrawn);
  const placements = rankMiniGameResults(eligiblePlayers.map((player) => ({
    playerId: player.playerId,
    pseudo: player.pseudo,
    score: player.roundScore,
    time: player.roundTime
  })), initialParticipantCount);

  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const playerUpdates = placements.map((placement) => {
    const player = playersById.get(placement.playerId);
    const tournamentPlacement = Object.freeze({
      roundKey,
      roundNumber,
      miniGame,
      place: placement.place,
      points: placement.points,
      score: placement.score,
      time: placement.time
    });
    return {
      playerId: placement.playerId,
      tournamentPoints: player.tournamentPoints + placement.points,
      tournamentTime: player.tournamentTime + placement.time,
      tournamentPlacements: [...player.tournamentPlacements, tournamentPlacement]
    };
  });

  return {
    applied: true,
    roundResult: freezeRoundResult({
      roundKey,
      roundNumber,
      miniGame,
      initialParticipantCount,
      placements: placements.map((placement) => ({ ...placement }))
    }),
    playerUpdates
  };
}

module.exports = {
  calculateGradeRevision,
  getQuestionResponseTime,
  rankMiniGameResults,
  rankTournamentPlayers,
  recordQuestionResponseTime,
  settleListeRound,
  validateManualGrade
};
