"use strict";

const DURATION_MS = 20000;

function validateQuestionBank(data) {
  if (!Array.isArray(data?.themes) || !Array.isArray(data?.questions) || !data.questions.length) {
    throw new Error("Pénave ou Nachave : thèmes ou questions absents du JSON.");
  }
  const themes = new Map(data.themes.map((theme) => [theme.id, theme.name]));
  if (themes.size !== data.themes.length ||
      data.themes.some((theme) => !String(theme.id || "").trim() || !String(theme.name || "").trim())) {
    throw new Error("Pénave ou Nachave : thèmes invalides ou répétés dans le JSON.");
  }
  const ids = new Set();
  for (const question of data.questions) {
    if ((typeof question.id !== "string" && typeof question.id !== "number") ||
        !String(question.id).trim() || ids.has(question.id) ||
        !themes.has(question.theme_id) || !String(question.question || "").trim()) {
      throw new Error("Pénave ou Nachave : identifiant unique, thème ou affirmation invalide dans le JSON.");
    }
    ids.add(question.id);
  }
  return { themes, questions: data.questions };
}

function rankPenaveResults(players, mini, initialParticipantCount) {
  const ties = new Map(mini.tieOrder.map((id, index) => [id, index]));
  const sorted = players.filter((player) => !player.withdrawn).map((player) => {
    const stat = mini.stats[player.playerId];
    if (!stat || !ties.has(player.playerId)) throw new Error("Résultat Pénave incomplet.");
    return {
      playerId: player.playerId, pseudo: player.pseudo,
      score: stat.correct, time: stat.timeMs / 1000,
      eliminatedRound: stat.eliminatedRound || Infinity
    };
  }).sort((a, b) => b.eliminatedRound - a.eliminatedRound ||
    a.time - b.time || ties.get(a.playerId) - ties.get(b.playerId));
  return sorted.map(({ eliminatedRound, ...entry }, index) => ({
    ...entry, place: index + 1, points: initialParticipantCount - index
  }));
}

module.exports = { DURATION_MS, validateQuestionBank, rankPenaveResults };
