"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.join(__dirname, "..");
const realRequire = createRequire(path.join(root, "server.js"));

// Charge le serveur entier, ses handlers et ses vrais jeux. Seuls les transports,
// l'horloge et les écritures de persistance sont remplacés par des doubles mémoire.
function harness() {
  const events = [];
  const timers = new Map();
  const allTimers = [];
  let now = 1000;
  let id = 0;
  let connection;
  let history = "{}";
  const io = {
    on: (name, fn) => { if (name === "connection") connection = fn; },
    to: (target) => ({ emit: (name, data) => events.push({ target, name, data }) }),
    in: () => ({ disconnectSockets() {} })
  };
  function schedule(fn, delay, repeat) {
    const timer = { id: ++id, fn, delay, repeat, at: now + delay };
    timers.set(timer.id, timer);
    allTimers.push(timer);
    return timer.id;
  }
  const fakeFs = {
    ...fs,
    existsSync: (file) => file === "/data" ? false : file.endsWith("played_questions_history.json") ? true : fs.existsSync(file),
    readFileSync: (file, ...args) => file.endsWith("played_questions_history.json") ? history : fs.readFileSync(file, ...args),
    writeFileSync: (file, data) => {
      assert.ok(file.endsWith("played_questions_history.json"));
      history = data;
    }
  };
  const context = {
    __dirname: root, process: { env: {} }, console: { log() {}, error: assert.fail },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearTimeout: (timer) => timers.delete(timer), clearInterval: (timer) => timers.delete(timer),
    require: (name) => {
      if (name === "fs") return fakeFs;
      if (name === "express") return Object.assign(() => ({ use() {}, get() {} }), { static() {} });
      if (name === "http") return { createServer: () => ({ listen() {} }) };
      if (name === "socket.io") return { Server: function () { return io; } };
      return realRequire(name);
    }
  };
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  vm.runInNewContext(source + `\nglobalThis.api = {
    rooms, getListeContext, prepareListeSequence, getListeOptions,
    endMiniGame, startNextListeRound, roomTimeout, roomInterval,
    revealFauxVrai, syncPlayerWithGame, serializeRoom
  };`, context);
  const api = context.api;
  function socket(playerId) {
    const handlers = {};
    let middleware;
    const sock = {
      id: `socket-${++id}`, handlers,
      on: (event, fn) => { handlers[event] = fn; }, use: (fn) => { middleware = fn; },
      emit: (name, data) => events.push({ target: sock.id, name, data }),
      join() {}, leave() {},
      send(event, payload, token) {
        const room = api.rooms[sock.roomCode];
        const metadata = token === undefined && room ? api.getListeContext(room) : token;
        middleware([event, payload, metadata], () => handlers[event]?.(payload));
      }
    };
    connection(sock);
    sock.identity = playerId;
    return sock;
  }
  function advance(ms) {
    const limit = now + ms;
    let runs = 0;
    for (;;) {
      const next = [...timers.values()].filter((t) => t.at <= limit).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      assert.ok(++runs < 10000, "Boucle de minuterie");
      now = next.at;
      if (next.repeat) next.at += next.delay;
      else timers.delete(next.id);
      next.fn();
    }
    now = limit;
  }
  function create(count = 3) {
    const clients = Array.from({ length: count }, (_, i) => socket(`p${i}`));
    clients[0].send("createRoom", { pseudo: "Hôte", playerId: "p0" });
    const room = api.rooms[clients[0].roomCode];
    clients.slice(1).forEach((s) => s.send("joinRoom", { roomCode: room.roomCode, playerId: s.identity, pseudo: s.identity }));
    return { room, clients };
  }
  function configure(room, host, selectionMethod = "manual", selected = api.getListeOptions().miniGames.map((g) => g.id)) {
    host.send("hostSetGameMode", { gameMode: "liste" });
    host.send("hostValidateListeConfig", {
      gameCount: selected.length, selectionMethod,
      selectedMiniGames: selectionMethod === "manual" ? selected : []
    });
  }
  return { api, events, timers, allTimers, socket, advance, create, configure };
}

function playRound(h, room, clients) {
  const host = () => clients.find((s) => s.playerId === room.hostId);
  host().send("drawingFinished");
  clients.filter((s) => s.roomCode === room.roomCode).forEach((s) => s.send("playerSetReady", { isReady: true }));
  assert.equal(room.gameState.phase, "playing");
  const type = room.gameState.currentMiniGame;
  let questions = 0;
  while (room.gameState.phase === "playing") {
    const mini = room.gameState.currentMiniGameState || room.mini;
    if (Number.isInteger(mini.correctionIndex)) {
      while (room.gameState.phase === "playing") {
        const token = h.api.getListeContext(room);
        for (let i = 0; i < room.activePlayersList.length; i++) {
          host().send("correctionNavigate", { direction: i === 0 ? -99 : 1 });
          const details = mini.type === "petit_bac" ? Object.fromEntries(mini.categories.map((_, n) => [n, 1])) : undefined;
          host().send("hostGradePlayer", { points: details ? mini.categories.length : 1, details });
        }
        const nextToken = h.api.getListeContext(room);
        host().send("correctionNextQuestion");
        const index = mini.correctionIndex;
        host().send("correctionNextQuestion", null, nextToken);
        assert.equal(mini.correctionIndex, index, "Une commande répétée ne saute pas une correction");
        assert.equal(token.roundNumber, room.gameState.roundNumber);
      }
      break;
    }
    assert.ok(++questions <= 10);
    h.advance(2500);
    const staleToken = h.api.getListeContext(room);
    for (const s of clients.filter((s) => s.roomCode === room.roomCode)) {
      if (type === "qui_veut_gagner_des_leugtas") {
        s.send("leugtasAnswer", { roomCode: room.roomCode, playerId: s.playerId, answerId: mini.questions[mini.questionIndex].correct_answer_id });
      } else if (type === "le_faux_du_vrai") {
        s.send("fauxVraiAnswer", mini.list[mini.index].indexFausse);
      } else if (type === "petit_bac") {
        s.send("petitBacAnswer", { roomCode: room.roomCode, answers: { 0: "Test" } });
      } else {
        const event = { qui_suis_je: "quiSuisJeAnswer", le_bon_ordre: "leBonOrdreAnswer", blind_test: "blindTestAnswer", le_tour_du_monde: "leTourDuMondeAnswer" }[type];
        s.send(event, { roomCode: room.roomCode, answer: "Test" });
      }
    }
    if (type === "le_faux_du_vrai") {
      const score = room.players[0].roundScore;
      h.api.revealFauxVrai(room.roomCode);
      assert.equal(room.players[0].roundScore, score, "Révélation unique");
      h.advance(mini.index === mini.list.length - 1 ? 7000 : 5500);
      clients[0].send("fauxVraiAnswer", 0, staleToken);
      if (room.gameState.phase === "playing") assert.equal(Object.keys(mini.answers).length, 0);
    } else if (type === "qui_veut_gagner_des_leugtas") {
      h.advance(mini.questionIndex === mini.questions.length - 1 ? 7700 : 5500);
    } else if (mini.finished) h.advance(3000);
  }
  assert.equal(room.gameState.phase, "listeRoundEnd");
  const oldTimers = h.allTimers.slice();
  h.advance(13000);
  // Rejouer les callbacks d'une ancienne manche ne doit pas relancer la suivante.
  const round = room.gameState.roundNumber;
  const results = room.listeTournament.roundResults.length;
  oldTimers.forEach((t) => t.fn());
  assert.equal(room.gameState.roundNumber, round);
  assert.equal(room.listeTournament.roundResults.length, results);
  h.api.endMiniGame(room.roomCode);
  assert.equal(room.listeTournament.roundResults.length, results);
  return questions;
}

for (const method of ["manual", "random"]) {
  test(`tournoi complet ${method} : sept vrais jeux, corrections, résultats uniques et fin sans élimination`, () => {
    const h = harness();
    const { room, clients } = h.create();
    h.configure(room, clients[0], method);
    clients[1].send("hostStartGame", {});
    assert.equal(room.gameState.phase, "idle");
    clients[0].send("hostStartGame", {});
    const tournamentId = room.listeTournament.tournamentId;
    clients[0].send("hostStartGame", {});
    assert.equal(room.listeTournament.tournamentId, tournamentId);
    assert.equal(room.listeTournament.initialParticipantCount, 3);
    assert.equal(new Set(room.listeTournament.sequence).size, 7);
    assert.ok(!room.listeTournament.sequence.includes("les_encheres"));
    const counts = {};
    while (!room.listeTournament.finished) {
      counts[room.gameState.currentMiniGame] = playRound(h, room, clients);
    }
    assert.equal(Object.keys(counts).length, 7);
    assert.equal(room.listeTournament.roundResults.length, 7);
    assert.equal(room.gameState.phase, "listeFinished");
    assert.equal(room.listeTournament.winners.length, 3, "Égalité parfaite conservée");
    room.players.forEach((p) => {
      assert.equal(p.tournamentPoints, 21);
      assert.equal(p.tournamentPlacements.length, 7);
      assert.equal(p.eliminated, false);
    });
    assert.equal(h.events.some((e) => ["playerEliminated", "playFinaleAnimation", "gameOver", "playIntroAnimation"].includes(e.name)), false);
    assert.equal(h.timers.size, 0);
    // Une nouvelle salle Battle Royale conserve intro et bac à sable.
    const other = h.create();
    other.clients[0].send("hostStartGame", { forcedMiniGame: "les_encheres" });
    assert.equal(other.room.gameState.phase, "intro");
    h.advance(32500);
    other.clients[0].send("drawingFinished");
    other.clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
    assert.equal(other.room.gameState.currentMiniGameState.type, "les_encheres");
  });
}

test("séquence : nombre, maximum dynamique, mélange manuel et refus des Enchères", () => {
  const h = harness();
  const games = Array.from(h.api.getListeOptions().miniGames, (g) => g.id);
  const config = { gameCount: games.length, selectionMethod: "manual", selectedMiniGames: games };
  const sequence = Array.from(h.api.prepareListeSequence(config, () => 0));
  assert.notDeepEqual(sequence, games);
  assert.deepEqual(sequence.slice().sort(), games.slice().sort());
  assert.equal(h.api.prepareListeSequence({ gameCount: 1, selectionMethod: "random", selectedMiniGames: [] }).length, 1);
  assert.throws(() => h.api.prepareListeSequence({ gameCount: 1, selectionMethod: "manual", selectedMiniGames: ["les_encheres"] }));
});

test("lancement : configuration requise et seuls les participants présents fixent N", () => {
  const h = harness();
  const { room, clients } = h.create(3);
  clients[0].send("hostSetGameMode", { gameMode: "liste" });
  clients[0].send("hostStartGame", {});
  assert.equal(room.gameState.phase, "idle");
  assert.equal(room.listeTournament.started, false);
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[2].send("disconnect");
  clients[0].send("hostStartGame", {});
  assert.equal(room.listeTournament.initialParticipantCount, 2);
  assert.deepEqual(Array.from(room.listeTournament.initialParticipantIds), ["p0", "p1"]);
  const late = h.socket("p2");
  late.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Absent au départ" });
  assert.equal(late.roomCode, null);
});

test("abandon pendant transition, reconnexion, N fixe et callbacks d'une autre partie", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac", "qui_suis_je"]);
  clients[0].send("hostStartGame", {});
  const initialId = room.listeTournament.tournamentId;
  const obsolete = h.api.getListeContext(room);
  const late = h.socket("late");
  late.send("joinRoom", { roomCode: room.roomCode, playerId: "late", pseudo: "Tardif" });
  assert.equal(late.roomCode, null);
  clients[0].send("disconnect");
  assert.equal(room.hostId, "p1");
  const reconnected = h.socket("p0");
  reconnected.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
  clients[0] = reconnected;
  assert.equal(room.listeTournament.initialParticipantCount, 3);
  // Simule une fin déjà calculée, juste avant le rappel qui lance la manche suivante.
  room.gameState.phase = "listeRoundEnd";
  room.players.forEach((p) => { p.roundScore = 1; p.roundTime = 10; });
  h.api.endMiniGame(room.roomCode);
  assert.equal(room.gameState.phase, "listeTransition");
  clients[1].send("leaveRoom");
  assert.equal(room.hostId, "p0");
  const withdrawn = h.socket("p1");
  withdrawn.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retiré" });
  assert.equal(room.players.find((p) => p.playerId === "p1").withdrawn, true);
  h.advance(1000);
  assert.equal(room.gameState.roundNumber, 2);
  reconnected.send("drawingFinished", null, obsolete);
  assert.equal(room.gameState.phase, "drawingGame");
  const remainingClients = [reconnected, clients[2]];
  playRound(h, room, remainingClients);
  assert.equal(room.listeTournament.initialParticipantCount, 3);
  assert.equal(room.listeTournament.generalRanking.length, 2);
  assert.equal(room.players.find((p) => p.playerId === "p1").tournamentPoints, 3);
  // Même code de salle, autre objet/partie : tous les anciens rappels sont caducs.
  const before = h.events.length;
  h.api.rooms[room.roomCode] = { ...room, listeTournament: { ...room.listeTournament, tournamentId: "new" } };
  h.allTimers.forEach((t) => t.fn());
  assert.equal(h.events.length, before);
  assert.equal(room.listeTournament.tournamentId, initialId);
});

test("Battle Royale : élimination, finale Enchères et victoire restent sur le chemin existant", () => {
  const h = harness();
  const { room } = h.create();
  room.gameState.phase = "playing";
  room.gameState.currentMiniGame = "qui_suis_je";
  room.players.forEach((p, i) => { p.roundScore = i; });
  h.api.endMiniGame(room.roomCode);
  assert.equal(room.players[0].eliminated, true);
  assert.ok(h.events.some((e) => e.name === "playFinaleAnimation"));
  h.advance(23000);
  assert.equal(room.gameState.currentMiniGame, "les_encheres");
  assert.equal(room.gameState.phase, "rules");
  room.players[1].eliminated = true;
  h.api.endMiniGame(room.roomCode);
  assert.ok(h.events.some((e) => e.name === "gameOver" && e.data.winner === "p2"));
  const next = h.create();
  next.clients[0].send("hostStartGame", {});
  h.advance(32500);
  assert.equal(next.room.gameState.phase, "drawingGame");
  assert.notEqual(next.room.gameState.currentMiniGame, "les_encheres");
  next.clients[0].send("drawingFinished");
  next.clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
  assert.equal(next.room.gameState.phase, "playing");
  assert.ok(next.room.gameState.currentMiniGameState || next.room.mini);
});

test("sept jeux : expiration des minuteries serveur sous horloge simulée, sans réponse", () => {
  const h = harness();
  for (const game of h.api.getListeOptions().miniGames) {
    const { room, clients } = h.create(1);
    h.configure(room, clients[0], "manual", [game.id]);
    clients[0].send("hostStartGame", {});
    clients[0].send("drawingFinished");
    clients[0].send("playerSetReady", { isReady: true });
    h.advance(600000);
    const mini = room.gameState.currentMiniGameState;
    if (mini && Number.isInteger(mini.correctionIndex)) {
      const total = mini.questions.length;
      for (let i = 0; i < total; i++) {
        clients[0].send("hostGradePlayer", { points: 0, details: {} });
        clients[0].send("correctionNextQuestion");
      }
      h.advance(13000);
    }
    assert.equal(room.listeTournament.finished, true, game.id);
    const result = room.listeTournament.roundResults[0].placements[0];
    assert.equal(result.score, 0);
    assert.ok(result.time >= 150, `${game.id} : pénalités de temps enregistrées`);
    assert.equal(result.points, 1);
  }
});

test("commandes client : contexte Liste envoyé et animation d'élimination ignorée uniquement en Liste", () => {
  const source = fs.readFileSync(path.join(root, "public_2/client.js"), "utf8");
  function extract(name, next) {
    return source.slice(source.indexOf(`function ${name}`), source.indexOf(next, source.indexOf(`function ${name}`)));
  }
  const emitted = [];
  const context = {
    currentRoom: { gameMode: "liste" },
    listeActionContext: { tournamentId: "test", roundNumber: 2 },
    socket: { emit: (...args) => emitted.push(args) }
  };
  vm.runInNewContext(extract("emitGameAction", "// Conteneur"), context);
  context.emitGameAction("fauxVraiAnswer", 0);
  assert.equal(emitted[0][2].tournamentId, "test");
  context.currentRoom.gameMode = "battle_royale";
  context.emitGameAction("fauxVraiAnswer", 0);
  assert.deepEqual(emitted[1], ["fauxVraiAnswer", 0]);
  // La branche Liste doit rendre la main avant tout accès au DOM/son d'élimination.
  const start = source.indexOf("function runEliminationSequence");
  const end = source.indexOf("    // 1.", start);
  vm.runInNewContext(source.slice(start, end) + "throw new Error('Battle Royale'); }", context);
  context.currentRoom.gameMode = "liste";
  let finished = false;
  context.runEliminationSequence([{ score: 0 }], () => { finished = true; });
  assert.equal(finished, true);
  context.currentRoom.gameMode = "battle_royale";
  assert.throws(() => context.runEliminationSequence([{ score: 0 }]), /Battle Royale/);
});

test("reconnexion et abandon du dernier joueur corrigé pendant l'animation de fin Petit Bac", () => {
  const h = harness();
  const { room, clients } = h.create(3);
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  clients[0].send("drawingFinished");
  clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
  h.advance(2500);
  clients.forEach((s) => s.send("petitBacAnswer", { roomCode: room.roomCode, answers: {} }));
  h.advance(3000);
  clients[0].send("endPetitBacCorrection");
  assert.equal(room.gameState.phase, "playing", "Fin refusée sans toutes les notes");
  clients[0].send("disconnect");
  assert.equal(room.hostId, "p1");
  for (let i = 0; i < 3; i++) {
    clients[1].send("correctionNavigate", { direction: i === 0 ? -99 : 1 });
    clients[1].send("hostGradePlayer", { points: 0, details: {} });
  }
  clients[1].send("endPetitBacCorrection");
  assert.equal(room.gameState.phase, "listeRoundEnd");
  clients[2].send("leaveRoom");
  const withdrawn = h.socket("p2");
  withdrawn.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Retour retiré" });
  const mini = room.gameState.currentMiniGameState;
  const saved = JSON.stringify(mini.playerAnswers.p2);
  withdrawn.send("petitBacAnswer", { roomCode: room.roomCode, answers: { 0: "Remplacement" } });
  assert.equal(JSON.stringify(mini.playerAnswers.p2), saved);
  h.advance(13000);
  assert.equal(room.listeTournament.finished, true);
  assert.equal(room.listeTournament.roundResults[0].placements.length, 2);
  assert.equal(room.listeTournament.initialParticipantCount, 3);
  assert.equal(room.players[2].tournamentPoints, 0);
});

test("règles : transfert d'hôte, secours du tirage et absence temporaire sans retrait", () => {
  const h = harness();
  const { room, clients } = h.create(3);
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  clients[0].send("disconnect");
  h.advance(15000);
  assert.equal(room.gameState.phase, "rules");
  clients[1].send("playerSetReady", { isReady: true });
  clients[2].send("playerSetReady", { isReady: true });
  assert.equal(room.gameState.phase, "playing");
  assert.equal(room.players[0].withdrawn, false);
  assert.equal(room.listeTournament.initialParticipantCount, 3);
  const reconnected = h.socket("p0");
  reconnected.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
  assert.ok(h.events.some((e) => e.target === reconnected.id && e.name === "petitBacStart"));
  const current = h.api.getListeContext(room);
  clients[0].send("petitBacAnswer", { roomCode: room.roomCode, answers: {} }, current);
  assert.equal(room.gameState.currentMiniGameState.playerAnswers.p0, undefined, "Ancien socket refusé");
  clients[1].send("leaveRoom");
  clients[2].send("leaveRoom");
  reconnected.send("leaveRoom");
  assert.equal(room.listeTournament.finished, true);
  assert.equal(room.listeTournament.winners.length, 0);
  assert.equal(h.timers.size, 0);
});
