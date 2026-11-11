"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHarness, start, last } = require("./helpers/socket-hardening-harness.cjs");

function joinSpectator(h, room, id = "spectator") {
  const client = h.socket(id);
  client.send("joinRoom", { roomCode: room.roomCode, playerId: id, pseudo: id });
  assert.equal(client.roomCode, room.roomCode);
  assert.equal(room.players.find(p => p.playerId === id).isSpectator, true);
  return client;
}

test("Battle Royale : participants figés avant l'introduction, arrivées tardives spectatrices dans chaque phase", () => {
  const h = makeHarness();
  const { room, clients } = h.create(3);
  clients[0].send("hostStartGame", { forcedMiniGame: "qui_suis_je" });
  assert.equal(room.gameState.phase, "intro");
  assert.deepEqual(Array.from(room.battleRoyaleParticipantIds), ["p0", "p1", "p2"]);
  joinSpectator(h, room, "during_intro");
  h.advance(32500);
  joinSpectator(h, room, "during_draw");
  clients[0].send("drawingFinished");
  const duringRules = joinSpectator(h, room, "during_rules");
  duringRules.send("playerSetReady", { isReady: true });
  assert.equal(room.gameState.readyPlayers.during_rules, undefined);
  clients.forEach(client => client.send("playerSetReady", { isReady: true }));
  assert.equal(room.gameState.phase, "playing", "Les spectateurs ne bloquent pas les joueurs prêts");
  const spectator = joinSpectator(h, room, "during_play");
  h.advance(2500);
  const mini = room.gameState.currentMiniGameState;
  clients[0].send("quiSuisJeAnswer", { answer: "Premier" });
  clients[1].send("quiSuisJeAnswer", { answer: "Deuxième" });
  spectator.send("quiSuisJeAnswer", { answer: "Interdit" });
  assert.equal(mini.questionIndex, 0);
  assert.equal(mini.playerAnswers.during_play, undefined);
  // Même si un mauvais appel serveur altérait le drapeau, la liste initiale fait autorité.
  room.players.find(p => p.playerId === "during_play").isSpectator = false;
  spectator.send("quiSuisJeAnswer", { answer: "Toujours interdit" });
  assert.equal(mini.playerAnswers.during_play, undefined);
  clients[2].send("quiSuisJeAnswer", { answer: "Troisième" });
  assert.equal(mini.questionIndex, 1, "La dernière réponse d'un participant clôt la question");
  assert.deepEqual(Array.from(h.api.getMiniGameScoreUpdate(room).players, p => p.id).sort(), ["p0", "p1", "p2"]);
  assert.deepEqual(Array.from(room.battleRoyaleParticipantIds), ["p0", "p1", "p2"]);
});

for (const game of ["le_faux_du_vrai", "qui_veut_gagner_des_leugtas", "blind_test", "le_tour_du_monde", "qui_suis_je", "petit_bac", "matrice_football", "le_bon_ordre", "logomania", "les_encheres"]) {
  test(`Battle Royale ${game} : un nouvel arrivant ne peut pas répondre ni recevoir de score`, () => {
    const { h, room, mini } = start("battle_royale", game);
    const spectator = joinSpectator(h, room);
    h.advance(2500);
    const before = JSON.stringify(room.players.map(p => [p.score, p.roundScore, p.roundTime, p.totalTime]));
    const q = mini.questions?.[mini.questionIndex];
    if (game === "le_faux_du_vrai") spectator.send("fauxVraiAnswer", mini.list[mini.index].indexFausse);
    else if (game === "qui_veut_gagner_des_leugtas") spectator.send("leugtasAnswer", { answerId: q.correct_answer_id });
    else if (game === "petit_bac") spectator.send("petitBacAnswer", { answers: { 0: "Test" } });
    else if (game === "le_bon_ordre") spectator.send("leBonOrdreAnswer", { instanceId: mini.instanceId, questionId: q.id, questionIndex: 0, orderedIds: null, pass: true });
    else if (game === "logomania") spectator.send("logomaniaAnswer", { instanceId: mini.instanceId, questionId: q.id, questionIndex: 0, answer: "", pass: true });
    else if (game === "matrice_football") spectator.send("matriceFootballAnswer", { instanceId: mini.instanceId, matrixId: mini.matrix.id,
      roundNumber: room.gameState.roundNumber, answers: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, "Test"])) });
    else if (game === "les_encheres") spectator.send("encheresVoteTheme", mini.themesAvailable[0].id);
    else spectator.send({ blind_test: "blindTestAnswer", qui_suis_je: "quiSuisJeAnswer", le_tour_du_monde: "leTourDuMondeAnswer" }[game], { answer: "Test" });
    assert.equal(JSON.stringify(room.players.map(p => [p.score, p.roundScore, p.roundTime, p.totalTime])), before);
    assert.equal((mini.playerAnswers || mini.answers || mini.playerVotes).spectator, undefined);
    assert.equal(h.api.getMiniGameScoreUpdate(room).players.length, 3);
  });
}

for (const phase of ["intro", "drawingGame", "rules", "playing"]) {
  test(`Battle Royale : départ d'un spectateur en ${phase} sans disqualification ni finale forcée`, () => {
    const { h, room } = start("battle_royale", "qui_suis_je");
    room.players[2].eliminated = true; // Deux survivants : cas qui déclenchait la finale en quittant.
    room.gameState.phase = phase;
    const spectator = joinSpectator(h, room);
    const before = JSON.stringify(room.gameState);
    const eventIndex = h.events.length;
    spectator.send("leaveRoom");
    assert.equal(JSON.stringify(room.gameState), before);
    assert.equal(room.players.some(p => p.playerId === "spectator"), false);
    assert(!h.events.slice(eventIndex).some(e => ["playerEliminated", "gameOver", "playFinaleAnimation", "showRules"].includes(e.name)));
    assert.equal(room.players.filter(p => p.eliminated).length, 1);
  });
}

test("Battle Royale : reconnexion authentifiée conserve état, élimination et place de participant", () => {
  const { h, room, clients } = start("battle_royale", "qui_suis_je");
  const player = room.players[1];
  Object.assign(player, { score: 7, roundScore: 2, roundTime: 11, totalTime: 50, eliminated: true });
  clients[1].send("disconnect");
  const impostor = h.socket("p1");
  impostor.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Intrus", reconnectSecret: "0".repeat(64) });
  assert.match(last(h, "errorMessage", impostor), /identité non vérifiée/);
  const returned = h.socket("p1");
  returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retour" });
  assert.equal(player.socketId, returned.id);
  assert.equal(player.isSpectator, false);
  assert.equal(player.eliminated, true);
  assert.deepEqual([player.score, player.roundScore, player.roundTime, player.totalTime], [7, 2, 11, 50]);
  h.advance(2500);
  returned.send("quiSuisJeAnswer", { answer: "Interdit après élimination" });
  assert.equal(room.gameState.currentMiniGameState.playerAnswers.p1, undefined);
});

test("Battle Royale : aucun temps d'absence pour le spectateur, élimination et finale limitées aux inscrits", async () => {
  const { h, room, clients, mini } = start("battle_royale", "qui_veut_gagner_des_leugtas");
  joinSpectator(h, room);
  h.advance(2500);
  clients.forEach(client => client.send("leugtasAnswer", { answerId: mini.questions[0].correct_answer_id }));
  const spectator = room.players.find(p => p.playerId === "spectator");
  assert.deepEqual([spectator.score, spectator.roundScore, spectator.roundTime, spectator.totalTime], [0, 0, 0, 0]);
  assert.equal(mini.playerAnswers.spectator, undefined);
  spectator.roundScore = -999;
  h.api.endMiniGame(room.roomCode);
  assert.equal(spectator.eliminated, false);
  assert.equal(room.players.filter(p => p.eliminated).length, 1);
  const finale = last(h, "playFinaleAnimation");
  assert(finale && !Object.values(finale).includes("spectator"));
  await Promise.resolve();
});
