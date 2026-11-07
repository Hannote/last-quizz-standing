"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeHarness } = require("./helpers/logomania-harness.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
const last = (h, name, client) => h.events.filter(e => e.name === name && (!client || e.target === client.id)).at(-1)?.data;

function start(mode, h = makeHarness(), game = "logomania") {
  const { room, clients } = h.create(3);
  if (mode === "liste") h.configure(room, clients[0], "manual", [game]);
  clients[0].send("hostStartGame", mode === "liste" ? {} : { forcedMiniGame: game });
  if (mode === "battle_royale") h.advance(32500);
  clients[0].send("drawingFinished");
  h.advance(9300);
  clients.forEach(c => c.send("playerSetReady", { isReady: true }));
  return { h, room, clients, mini: room.gameState.currentMiniGameState };
}

function answer(mini, extra = {}) {
  return { instanceId: mini.instanceId, questionId: mini.questions[mini.questionIndex].id,
    questionIndex: mini.questionIndex, pass: false, answer: "Réponse", ...extra };
}

function correction(room, extra = {}) {
  const mini = room.gameState.currentMiniGameState;
  return { instanceId: mini.instanceId, questionIndex: mini.correctionIndex,
    gradingPlayerId: room.activePlayersList[mini.gradingPlayerIndex].playerId, ...extra };
}

test("Logomania : quotas, identifiants, médias avec casse exacte et brassage final", () => {
  const h = makeHarness();
  const questions = h.api.pickLogomaniaQuestions();
  assert.equal(questions.length, 8);
  assert.equal(new Set(questions.map(q => q.id)).size, 8);
  for (const [theme, count] of Object.entries({ marque: 5, bouffe: 2, football: 1 })) {
    assert.equal(questions.filter(q => q.theme_id === theme).length, count);
  }
  const sequences = new Set(Array.from({ length: 12 }, () => h.api.pickLogomaniaQuestions().map(q => q.theme_id).join(",")));
  assert.ok(sequences.size > 1);
  const bank = h.api.logomaniaData;
  for (const media of ["titres/logomania.png", "sons/logomania.mp3", ...bank.questions.flatMap(q => [q.image_question, q.image_reponse])]) {
    let dir = path.join(__dirname, "../public_2");
    for (const part of media.split("/")) {
      assert.ok(fs.readdirSync(dir).includes(part), `Casse ou média incorrect : ${media}`);
      dir = path.join(dir, part);
    }
  }
});

test("Logomania : fin de cycle marque avec deux inédites, trois compléments et mémoire des autres jeux intacte", () => {
  const h = makeHarness();
  const pools = Object.fromEntries(h.api.logomaniaData.themes.map(t => [t.id, h.api.logomaniaData.questions.filter(q => q.theme_id === t.id)]));
  const seed = { blind_test: ["inchangé"], qui_suis_je: [42], logomania: [...pools.marque.slice(0, -2).map(q => q.id), pools.bouffe[0].id, pools.football[0].id] };
  h.api.savePlayedHistory(seed, true);
  const questions = h.api.pickLogomaniaQuestions();
  const brands = questions.filter(q => q.theme_id === "marque");
  const finalOldIds = pools.marque.slice(-2).map(q => q.id);
  assert.ok(finalOldIds.every(id => brands.some(q => q.id === id)));
  const history = plain(h.api.getPlayedHistory());
  const brandMemory = history.logomania.filter(id => pools.marque.some(q => q.id === id));
  assert.equal(brandMemory.length, 3);
  assert.ok(brandMemory.every(id => !finalOldIds.includes(id)));
  assert.equal(history.logomania.filter(id => pools.bouffe.some(q => q.id === id)).length, 3);
  assert.equal(history.logomania.filter(id => pools.football.some(q => q.id === id)).length, 2);
  assert.deepEqual(history.blind_test, seed.blind_test);
  assert.deepEqual(history.qui_suis_je, seed.qui_suis_je);
  // Recharger dans un serveur neuf reproduit le prochain cycle sans oublier le complément.
  const restarted = makeHarness();
  restarted.api.savePlayedHistory(history, true);
  const next = restarted.api.pickLogomaniaQuestions().filter(q => q.theme_id === "marque");
  assert.ok(next.every(q => !brandMemory.includes(q.id)));
});

test("Logomania : épuiser bouffe ne vide ni marque ni football, aucune répétition avant épuisement", () => {
  const h = makeHarness();
  const bank = h.api.logomaniaData.questions;
  const bouffe = bank.filter(q => q.theme_id === "bouffe");
  const marque = bank.find(q => q.theme_id === "marque").id;
  const foot = bank.find(q => q.theme_id === "football").id;
  h.api.savePlayedHistory({ logomania: [marque, foot, ...bouffe.map(q => q.id)] }, true);
  const first = h.api.pickLogomaniaQuestions();
  const history = h.api.getPlayedHistory().logomania;
  assert.ok(history.includes(marque) && history.includes(foot));
  assert.equal(history.filter(id => bouffe.some(q => q.id === id)).length, 2);
  const next = h.api.pickLogomaniaQuestions();
  assert.ok(next.every(q => !first.some(prev => prev.id === q.id)));
});

test("Logomania : banque invalide, insuffisante ou média absent ne consomment aucun historique", () => {
  for (const damage of [
    bank => { bank.questions = bank.questions.filter(q => q.theme_id !== "football"); },
    bank => { bank.questions[1].id = bank.questions[0].id; },
    bank => { bank.questions[0].image_question = "logomania/introuvable.jpg"; },
    bank => { bank.themes[0].nom = ""; },
    bank => { bank.questions = null; }
  ]) {
    const h = makeHarness();
    h.api.savePlayedHistory({ blind_test: [3] }, true);
    damage(h.api.logomaniaData);
    assert.throws(() => h.api.pickLogomaniaQuestions(), /Logomania/);
    assert.deepEqual(plain(h.api.getPlayedHistory()), { blind_test: [3] });
  }
});

test("Logomania : fichier temporaire relu par un nouveau serveur, sans consommer la mémoire réelle", () => {
  const root = path.resolve(__dirname, "..");
  fs.mkdirSync(path.join(root, ".test-run"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, ".test-run/logomania-memory-"));
  const file = path.join(dir, "history.json");
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const helpers = source.slice(source.indexOf("function getPlayedHistory()"), source.indexOf("// 5. Récupérer")) +
    source.slice(source.indexOf("function pickLogomaniaQuestions()"), source.indexOf("function getLogomaniaContext("));
  const load = () => {
    const ctx = { fs, path, __dirname: root, HISTORY_FILE: file, logomaniaBankError: null,
      logomaniaData: JSON.parse(fs.readFileSync(path.join(root, "public_2/logomania/logomania.json"))),
      LOGOMANIA_QUOTAS: { marque: 5, bouffe: 2, football: 1 }, console,
      shuffleCopy: require("../question-shuffle").shuffleCopy };
    vm.runInNewContext(helpers, ctx);
    return ctx;
  };
  try {
    fs.writeFileSync(file, JSON.stringify({ blind_test: ["préservé"] }));
    const first = load().pickLogomaniaQuestions();
    const second = load().pickLogomaniaQuestions();
    assert.ok(second.every(q => !first.some(p => p.id === q.id)));
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.logomania.length, 16);
    assert.deepEqual(saved.blind_test, ["préservé"]);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

for (const mode of ["battle_royale", "liste"]) {
  test(`${mode} Logomania : sauvegarde impossible, retour aux règles et aucun envoi de question`, () => {
    const { h, room, mini } = start(mode, makeHarness({ TEST_FAIL_SAVE: true }));
    assert.equal(room.gameState.phase, "rules");
    assert.equal(mini, null);
    assert.equal(Object.keys(room.gameState.readyPlayers).length, 0);
    assert.match(last(h, "errorMessage"), /Impossible de lancer Logomania.*écriture/);
    assert.equal(h.events.some(e => e.name === "logomaniaQuestion"), false);
    assert.deepEqual(plain(h.api.getPlayedHistory()), {});
  });

  test(`${mode} Logomania : huit questions, réponses uniques, reconnexion, correction révisable et suite`, () => {
    const { h, room, clients, mini } = start(mode);
    assert.equal(room.gameState.phase, "playing");
    assert.equal(mini.subPhase, "theme");
    assert.ok(h.api.getListeOptions().miniGames.some(g => g.id === "logomania"));
    assert.ok(room.gameState.possibleMiniGames.includes("logomania"));
    const consumed = JSON.stringify(h.api.getPlayedHistory());
    const expectedTimes = [];
    for (let q = 0; q < 8; q++) {
      const data = last(h, "logomaniaQuestion");
      assert.equal(data.index, q + 1);
      assert.equal(data.total, 8);
      assert.equal(data.themeName, mini.questions[q].themeName);
      assert.equal(JSON.stringify(data).includes('"reponse"'), false);
      assert.equal(JSON.stringify(data).includes('image_reponse'), false);
      const action = answer(mini, { answer: `Réponse ${q}` });
      clients[0].send("logomaniaAnswer", action);
      assert.equal(Object.keys(mini.playerAnswers).length, 0, "Annonce non répondable");
      h.advance(2500);
      assert.equal(mini.timer.totalSeconds, 40);
      h.advance(1000 + q * 100);
      expectedTimes.push(1 + q / 10);
      clients[0].send("logomaniaAnswer", action);
      clients[0].send("logomaniaAnswer", answer(mini, { answer: "Écrasement" }));
      assert.equal(mini.playerAnswers.p0.answer, `Réponse ${q}`);
      assert.equal(mini.responseTimesByQuestion[q].p0, expectedTimes[q]);
      if (q === 3) {
        clients[0].send("disconnect");
        const returned = h.socket("p0");
        returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
        clients[0] = returned;
        const restored = last(h, "logomaniaQuestion", returned);
        assert.equal(restored.savedAnswer.answer, `Réponse ${q}`);
        assert.ok(restored.remainingMs < 40000);
      }
      h.advance(500);
      clients[1].send("logomaniaAnswer", answer(mini, { answer: "Partielle" }));
      clients[2].send("logomaniaAnswer", answer(mini, { answer: "", pass: true }));
      assert.equal(mini.history.p2[q], "JE PASSE");
      clients[0].send("logomaniaAnswer", action);
      assert.equal(mini.questionIndex, Math.min(7, q + 1));
    }
    assert.equal(mini.subPhase, "collecting");
    h.advance(3000);
    assert.equal(mini.subPhase, "correction");
    const host = () => clients.find(c => c.playerId === room.hostId);
    let obsolete;
    for (let q = 0; q < 8; q++) {
      const data = last(h, "correctionUpdate");
      assert.equal(data.currentQIndex, q + 1);
      assert.equal(data.answerImage, mini.questions[q].image_reponse);
      assert.equal(data.questionImage, null);
      assert.equal(data.answerText, mini.questions[q].reponse);
      clients.find(c => c.playerId !== room.hostId).send("hostGradePlayer", correction(room, { points: 1 }));
      assert.equal(mini.scoresGiven[q], undefined);
      for (let p = 0; p < 3; p++) {
        host().send("correctionNavigate", correction(room, { direction: p === 0 ? -99 : 1 }));
        host().send("hostGradePlayer", correction(room, { points: 1.5 }));
        assert.equal(mini.scoresGiven[q]?.[`p${p}`], undefined);
        host().send("hostGradePlayer", correction(room, { points: [1, .5, 0][p] }));
      }
      host().send("hostGradePlayer", correction(room, { points: 0 }));
      if (q === 1) {
        host().send("correctionPrevQuestion", correction(room));
        host().send("hostGradePlayer", correction(room, { points: 0.5 }));
        host().send("hostGradePlayer", correction(room, { points: 1 }));
        host().send("correctionNextQuestion", correction(room));
      }
      if (q === 4) {
        host().send("requestRoomState");
        assert.equal(last(h, "correctionUpdate", host()).currentGrade, 0);
        assert.equal(last(h, "correctionUpdate", host()).currentQIndex, 5);
      }
      obsolete = correction(room);
      host().send("correctionNextQuestion", obsolete);
    }
    assert.deepEqual(Array.from(room.players, p => p.roundScore), [8, 4, 0]);
    assert.ok(Math.abs(room.players[0].roundTime - expectedTimes.reduce((a,b) => a+b, 0)) < 1e-8);
    assert.equal(room.players[2].roundTime, 320);
    assert.equal(mini.subPhase, "leaderboard");
    const finishes = h.events.filter(e => e.name === "leugtasReveal").length;
    host().send("correctionNextQuestion", obsolete);
    assert.equal(h.events.filter(e => e.name === "leugtasReveal").length, finishes);
    h.advance(5000);
    assert.equal(mini.subPhase, "ending");
    assert.ok(last(h, "leBonOrdreExit").logomaniaContext);
    h.advance(mode === "liste" ? 3500 : 7000);
    if (mode === "liste") {
      assert.equal(room.gameState.phase, "listeLeaderboard");
      assert.deepEqual(Array.from(room.players, p => p.tournamentPoints), [3, 2, 1]);
      assert.equal(room.listeTournament.roundResults.length, 1);
      assert.ok(room.players.every(p => !p.eliminated));
      h.advance(8000);
      assert.equal(room.gameState.phase, "listeFinished");
    } else assert.equal(room.players.filter(p => p.eliminated).length, 1);
    assert.equal(JSON.stringify(h.api.getPlayedHistory()), consumed);
  });

  test(`${mode} Logomania : délai, spectateurs et anciens callbacks sans effet`, () => {
    const { h, room, clients, mini } = start(mode);
    const themeCallback = h.allTimers.at(-1).fn;
    h.advance(2500);
    const savedAction = answer(mini);
    room.players[2].isSpectator = true;
    clients[2].send("logomaniaAnswer", savedAction);
    assert.equal(mini.playerAnswers.p2, undefined);
    h.advance(40000);
    assert.equal(mini.history.p0[0], "RIEN");
    clients[0].send("logomaniaAnswer", savedAction);
    assert.equal(Object.keys(mini.playerAnswers).length, 0);
    const nextPhase = mini.subPhase;
    themeCallback();
    assert.equal(mini.subPhase, nextPhase);
    h.api.destroyRoom(room);
    assert.equal(h.api.rooms[room.roomCode], undefined);
    themeCallback();
  });
}

test("Liste Logomania : abandon définitif et classement limité aux inscrits restants", () => {
  const { h, room, clients, mini } = start("liste");
  h.advance(2500);
  clients[2].send("leaveRoom");
  assert.equal(room.players[2].withdrawn, true);
  assert.equal(room.players[2].eliminated, false);
  clients[0].send("logomaniaAnswer", answer(mini));
  clients[1].send("logomaniaAnswer", answer(mini));
  assert.equal(mini.questionIndex, 1);
  assert.equal(h.events.some(e => /eliminated|finalists/i.test(e.name)), false);
});

for (const mode of ["battle_royale", "liste"]) {
  for (const [game, event] of [["le_tour_du_monde", "leTourDuMondeAnswer"], ["qui_suis_je", "quiSuisJeAnswer"]]) {
    test(`Non-régression ${mode} ${game} : questions, correction standard et sortie`, () => {
      const { h, room, clients, mini } = start(mode, makeHarness(), game);
      const count = mini.questions.length;
      for (let q = 0; q < count; q++) {
        h.advance(2500);
        h.advance(1000);
        clients.forEach(c => c.send(event, { answer: "Réponse" }));
      }
      h.advance(3000);
      assert.equal(mini.correctionIndex, 0);
      for (let q = 0; q < count; q++) {
        for (let p = 0; p < clients.length; p++) {
          clients[0].send("hostGradePlayer", { points: 1 });
          clients[0].send("hostGradePlayer", { points: 1 });
          if (p < clients.length - 1) clients[0].send("correctionNavigate", { direction: 1 });
        }
        clients[0].send("correctionNextQuestion");
      }
      assert.ok(room.players.every(p => p.roundScore === count && p.roundTime === count));
      h.advance(mode === "liste" ? 8500 : 12000);
      if (mode === "liste") {
        assert.equal(room.gameState.phase, "listeLeaderboard");
        assert.equal(room.listeTournament.roundResults.length, 1);
        assert.ok(room.players.every(p => !p.eliminated));
      } else assert.equal(room.players.filter(p => p.eliminated).length, 1);
    });
  }
}
