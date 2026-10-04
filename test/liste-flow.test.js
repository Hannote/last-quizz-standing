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
  const credentials = new Map();
  const sockets = new Map();
  const io = {
    on: (name, fn) => { if (name === "connection") connection = fn; },
    to: (target) => ({ emit: (name, data) => events.push({ target, name, data }) }),
    in: () => ({ disconnectSockets() {} }),
    sockets: { sockets }
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
    __dirname: root, Buffer, process: { env: {} }, console: { log() {}, error: assert.fail },
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
    const joinedRooms = new Set();
    let middleware;
    const sock = {
      id: `socket-${++id}`, handlers, joinedRooms,
      on: (event, fn) => { handlers[event] = fn; }, use: (fn) => { middleware = fn; },
      emit: (name, data) => {
        if (name === "reconnectCredential") {
          credentials.set(`${data.roomCode}:${data.playerId}`, data.reconnectSecret);
        }
        events.push({ target: sock.id, name, data });
      },
      join(roomCode) { joinedRooms.add(roomCode); },
      leave(roomCode) { joinedRooms.delete(roomCode); },
      send(event, payload, token) {
        if (event === "joinRoom" && payload && !Object.hasOwn(payload, "reconnectSecret")) {
          payload = { ...payload, reconnectSecret: credentials.get(`${payload.roomCode}:${payload.playerId}`) };
        }
        const room = api.rooms[sock.roomCode];
        const metadata = token === undefined && room ? api.getListeContext(room) : token;
        middleware([event, payload, metadata], () => handlers[event]?.(payload));
      }
    };
    connection(sock);
    sockets.set(sock.id, sock);
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
  return { api, events, timers, allTimers, socket, advance, create, configure, credentials };
}

function playRound(h, room, clients, finishPetitBacWithButton = false) {
  const host = () => clients.find((s) => s.playerId === room.hostId);
  host().send("drawingFinished");
  h.advance(9300);
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
        host().send(finishPetitBacWithButton && type === "petit_bac"
          ? "endPetitBacCorrection" : "correctionNextQuestion");
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
  const logoEvent = type === "le_faux_du_vrai" ? "fauxVraiEnd"
    : type === "qui_veut_gagner_des_leugtas" ? "leugtasEnd" : "leBonOrdreExit";
  if (!["le_faux_du_vrai", "qui_veut_gagner_des_leugtas"].includes(type)) {
    const count = () => h.events.filter((e) => e.target === room.roomCode && e.name === logoEvent).length;
    const before = count();
    h.advance(4999);
    assert.equal(count(), before, "Les 5 s précédant le logo sont conservées");
    h.advance(1);
    assert.equal(count(), before + 1);
  }
  assert.ok(h.events.some((e) => e.target === room.roomCode && e.name === logoEvent));
  h.advance(3499);
  assert.equal(room.gameState.phase, "listeRoundEnd", "Ne pas couper le logo");
  h.advance(1);
  assert.equal(room.gameState.phase, "listeLeaderboard", "Classement dès la fin des 3,5 s du logo");
  h.advance(7999);
  assert.equal(room.gameState.phase, "listeLeaderboard", "Conserver les 8 s de classement");
  h.advance(1);
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

for (const game of ["le_faux_du_vrai", "qui_veut_gagner_des_leugtas", "le_bon_ordre", "petit_bac"]) {
  test(`fin ${game} : logo 3,5 s puis classement 8 s, sans attente noire`, () => {
    const h = harness();
    const { room, clients } = h.create();
    h.configure(room, clients[0], "manual", [game]);
    clients[0].send("hostStartGame", {});
    playRound(h, room, clients, true);
    assert.equal(room.gameState.phase, "listeFinished");
  });
}

for (const game of ["qui_suis_je", "blind_test", "le_tour_du_monde", "le_bon_ordre",
  "petit_bac", "qui_veut_gagner_des_leugtas", "le_faux_du_vrai"]) {
  test(`classement ${game} : toutes les émissions scoreUpdate fournissent les places serveur`, () => {
    const h = harness();
    const { room, clients } = h.create();
    h.configure(room, clients[0], "manual", [game]);
    clients[0].send("hostStartGame", {});
    playRound(h, room, clients, true);
    const scores = h.events.filter((e) => e.target === room.roomCode && e.name === "scoreUpdate");
    assert.ok(scores.length > 0);
    for (const { data } of scores) {
      assert.equal(data.gameMode, "liste");
      assert.ok(data.players.every((p) => Number.isInteger(p.place) && p.place >= 1));
      for (let i = 1; i < data.players.length; i++) {
        const previous = data.players[i - 1];
        const current = data.players[i];
        assert.ok(previous.score > current.score ||
          (previous.score === current.score && previous.time <= current.time));
        assert.equal(current.place, previous.score === current.score && previous.time === current.time
          ? previous.place : i + 1);
      }
    }
    assert.deepEqual(Array.from(scores.at(-1).data.players, (p) => p.place), [1, 1, 1]);
    room.players.forEach((p) => assert.equal(p.tournamentPoints, 3));
    assert.equal(room.listeTournament.roundResults.length, 1);
  });
}

test("abandon pendant le classement de mini-jeu : snapshot actualisé et aucun point attribué", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  h.advance(9300);
  clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
  h.advance(2500);
  clients.forEach((s) => s.send("petitBacAnswer", { roomCode: room.roomCode, answers: {} }));
  h.advance(3000);
  for (let i = 0; i < 3; i++) {
    clients[0].send("correctionNavigate", { direction: i === 0 ? -99 : 1 });
    clients[0].send("hostGradePlayer", { points: 0, details: {} });
  }
  clients[0].send("endPetitBacCorrection");
  assert.equal(room.gameState.phase, "listeRoundEnd");
  clients[2].send("leaveRoom");
  const score = h.events.filter((e) => e.name === "scoreUpdate").at(-1).data;
  assert.equal(score.refreshLeaderboard, true);
  assert.deepEqual(Array.from(score.players, (p) => p.id), ["p0", "p1"]);
  assert.deepEqual(Array.from(score.players, (p) => p.place), [1, 1]);
  room.players.forEach((p) => assert.equal(p.tournamentPoints, 0));
  assert.equal(room.listeTournament.roundResults.length, 0);
  h.advance(8500);
  assert.equal(room.listeTournament.roundResults.length, 1);
  assert.deepEqual(Array.from(room.listeTournament.roundResults[0].placements, (p) => p.points), [3, 3]);
});

test("classement Liste : snapshot serveur, reconnexion pendant l'affichage et transition après 8 s", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac", "qui_suis_je"]);
  clients[0].send("hostStartGame", {});
  room.gameState.phase = "listeRoundEnd";
  room.players[0].roundScore = 2;
  room.players[0].roundTime = 5;
  room.players[1].roundScore = 2;
  room.players[1].roundTime = 5;
  room.players[2].roundScore = 1;
  room.players[2].roundTime = 2;

  h.api.endMiniGame(room.roomCode);
  assert.equal(room.gameState.phase, "listeLeaderboard");
  const snapshot = h.events.filter((event) => event.name === "gameStateUpdate").at(-1).data;
  const rankedSnapshot = JSON.parse(JSON.stringify(snapshot.listeLeaderboard.ranking.map(
    ({ playerId, place, tournamentPoints, tournamentTime }) => ({ playerId, place, tournamentPoints, tournamentTime })
  )));
  assert.deepEqual(rankedSnapshot, [
    { playerId: "p0", place: 1, tournamentPoints: 3, tournamentTime: 5 },
    { playerId: "p1", place: 1, tournamentPoints: 3, tournamentTime: 5 },
    { playerId: "p2", place: 3, tournamentPoints: 1, tournamentTime: 2 }
  ]);

  clients[2].send("disconnect");
  const reconnected = h.socket("p2");
  reconnected.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Retour" });
  const restored = h.events.filter((event) => event.target === reconnected.id && event.name === "gameStateUpdate").at(-1).data;
  assert.equal(restored.phase, "listeLeaderboard");
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.listeLeaderboard.ranking.map(
      ({ playerId, place, tournamentPoints, tournamentTime }) => ({ playerId, place, tournamentPoints, tournamentTime })
    ))),
    rankedSnapshot
  );

  h.advance(7999);
  assert.equal(room.gameState.phase, "listeLeaderboard");
  h.advance(1);
  assert.equal(room.gameState.phase, "drawingGame");
  assert.equal(room.gameState.roundNumber, 2);
});

test("fin Liste : classement final et co-vainqueurs viennent du serveur", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  room.gameState.phase = "listeRoundEnd";
  room.players.forEach((player) => { player.roundScore = 1; player.roundTime = 10; });

  h.api.endMiniGame(room.roomCode);
  assert.equal(room.gameState.phase, "listeLeaderboard");
  h.advance(8000);
  assert.equal(room.gameState.phase, "listeFinished");
  assert.deepEqual(JSON.parse(JSON.stringify(room.listeTournament.winners)), ["p0", "p1", "p2"]);
  const finalState = h.events.filter((event) => event.name === "gameStateUpdate").at(-1).data;
  assert.equal(finalState.listeLeaderboard.isFinal, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(finalState.listeLeaderboard.winners)),
    JSON.parse(JSON.stringify(room.listeTournament.winners))
  );
});

test("sons Liste : un tirage par classement, par salle, sans répétition ni son final", () => {
  const h = harness();
  const first = h.create();
  const second = h.create();
  for (const { room, clients } of [first, second]) {
    h.configure(room, clients[0], "manual", ["petit_bac"]);
    clients[0].send("hostStartGame", {});
  }
  const room = first.room;
  room.listeTournament.sequence = Array(16).fill("petit_bac");
  for (let round = 1; round <= 16; round++) {
    room.gameState.phase = "listeRoundEnd";
    h.api.endMiniGame(room.roomCode);
    const snapshot = h.events.filter((event) => event.target === room.roomCode &&
      event.name === "gameStateUpdate").at(-1).data;
    const chosen = snapshot.listeLeaderboard.sound;
    assert.equal(snapshot.phase, "listeLeaderboard");
    if (round <= 15) {
      assert.equal(chosen.roundNumber, round);
      assert.equal(chosen.tournamentId, room.listeTournament.tournamentId);
      assert.equal(chosen.elapsedMs, 0);
      assert.match(chosen.url, /^\/sons\/classement_general_(?:[1-9]|1[0-5])\.mp3$/);
    } else assert.equal(chosen, null);
    const before = room.listeTournament.leaderboardSoundsUsed.length;
    h.api.endMiniGame(room.roomCode);
    first.clients[1].send("requestRoomState");
    first.clients[2].send("requestRoomState");
    assert.equal(room.listeTournament.leaderboardSoundsUsed.length, before);
    for (const client of first.clients.slice(1)) {
      const received = h.events.filter((event) => event.target === client.id &&
        event.name === "gameStateUpdate").at(-1).data;
      assert.equal(received.listeLeaderboard.sound?.url || null, chosen?.url || null);
    }
    if (round === 1) {
      const other = second.room;
      other.gameState.phase = "listeRoundEnd";
      h.api.endMiniGame(other.roomCode);
      assert.equal(other.listeTournament.leaderboardSoundsUsed.length, 1);
      assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
      const reconnected = h.socket("p1");
      reconnected.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retour" });
      first.clients[1] = reconnected;
      const restored = h.events.filter((event) => event.target === reconnected.id &&
        event.name === "gameStateUpdate").at(-1).data;
      assert.equal(restored.listeLeaderboard.sound.url, chosen.url);
      assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
      first.clients[0].send("disconnect"); // Transfert d'hôte sans nouveau tirage.
      assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
      h.advance(3000);
      reconnected.send("requestRoomState");
      const midRound = h.events.filter((event) => event.target === reconnected.id &&
        event.name === "gameStateUpdate").at(-1).data;
      assert.equal(midRound.listeLeaderboard.sound.url, chosen.url);
      assert.equal(midRound.listeLeaderboard.sound.elapsedMs, 3000);
      assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
      h.advance(5000);
    } else {
      h.advance(8000);
    }
  }
  assert.equal(new Set(room.listeTournament.leaderboardSoundsUsed).size, 15);
  const final = h.events.filter((event) => event.target === room.roomCode &&
    event.name === "gameStateUpdate").at(-1).data;
  assert.equal(final.phase, "listeFinished");
  assert.equal(final.listeLeaderboard.sound, null);
  assert.equal(second.room.listeTournament.leaderboardSoundsUsed.length, 1);
  const fresh = h.create();
  h.configure(fresh.room, fresh.clients[0], "manual", ["petit_bac"]);
  fresh.clients[0].send("hostStartGame", {});
  assert.equal(fresh.room.listeTournament.leaderboardSoundsUsed.length, 0);
  const battle = h.create();
  battle.clients[0].send("hostStartGame", { forcedMiniGame: "les_encheres" });
  assert.equal(battle.room.listeTournament.leaderboardSoundsUsed.length, 0);
});

test("son Liste : abandon pendant le classement ne consomme aucun second son", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  room.gameState.phase = "listeRoundEnd";
  h.api.endMiniGame(room.roomCode);
  const sound = room.listeTournament.leaderboardSound.url;
  clients[2].send("leaveRoom");
  assert.equal(room.gameState.phase, "listeLeaderboard");
  assert.equal(room.listeTournament.leaderboardSound.url, sound);
  assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
  clients[1].send("requestRoomState");
  const refreshed = h.events.filter((event) => event.target === clients[1].id &&
    event.name === "gameStateUpdate").at(-1).data;
  assert.equal(refreshed.listeLeaderboard.sound.url, sound);
  assert.equal(room.listeTournament.leaderboardSoundsUsed.length, 1);
});

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
  assert.equal(room.gameState.phase, "listeLeaderboard");
  clients[1].send("leaveRoom");
  assert.equal(room.hostId, "p0");
  const withdrawn = h.socket("p1");
  withdrawn.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retiré" });
  assert.equal(room.players.find((p) => p.playerId === "p1").withdrawn, true);
  h.advance(8000);
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
    h.advance(9300);
    clients[0].send("playerSetReady", { isReady: true });
    h.advance(600000);
    const mini = room.gameState.currentMiniGameState;
    if (mini && Number.isInteger(mini.correctionIndex)) {
      const total = mini.questions.length;
      for (let i = 0; i < total; i++) {
        clients[0].send("hostGradePlayer", { points: 0, details: {} });
        clients[0].send("correctionNextQuestion");
      }
      h.advance(20000);
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
  h.advance(9300);
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
  h.advance(20000);
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
  h.advance(9300);
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

// Compléments de l'étape 7 : vrais handlers, reconnexions et échéances serveur.
for (const [game, event, questionEvent] of [
  ["qui_suis_je", "quiSuisJeAnswer", "quiSuisJeQuestion"],
  ["blind_test", "blindTestAnswer", "blindTestQuestion"],
  ["le_tour_du_monde", "leTourDuMondeAnswer", "leTourDuMondeQuestion"],
  ["le_bon_ordre", "leBonOrdreAnswer", "leBonOrdreQuestion"],
  ["petit_bac", "petitBacAnswer", "petitBacStart"],
  ["qui_veut_gagner_des_leugtas", "leugtasAnswer", "leugtasQuestion"],
  ["le_faux_du_vrai", "fauxVraiAnswer", "fauxVraiQuestion"]
]) {
  test(`étape 7 : reconnexion en question ${game}, réponse et temps conservés`, () => {
    const h = harness();
    const { room, clients } = h.create();
    h.configure(room, clients[0], "manual", [game]);
    clients[0].send("hostStartGame", {});
    h.advance(9300);
    clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
    h.advance(6500);
    const mini = room.gameState.currentMiniGameState || room.mini;
    const payload = game === "le_faux_du_vrai" ? 1
      : game === "qui_veut_gagner_des_leugtas"
        ? { roomCode: room.roomCode, playerId: "p0", answerId: mini.questions[0].correct_answer_id }
        : game === "petit_bac" ? { roomCode: room.roomCode, answers: { 0: "Paris" } }
          : { roomCode: room.roomCode, answer: "Paris" };
    clients[0].send(event, payload);
    const saved = () => JSON.stringify({
      answer: (mini.playerAnswers || mini.answers).p0,
      time: mini.responseTimes?.p0 ?? mini.answerTimes?.p0 ?? mini.playerAnswers?.p0?.timeTaken,
      history: mini.history?.p0, responseHistory: mini.responseTimesByQuestion?.[0]?.p0,
      score: room.players[0].roundScore, roundTime: room.players[0].roundTime
    });
    const original = saved();
    assert.notEqual((mini.playerAnswers || mini.answers).p0, undefined);
    assert.equal(mini.responseTimes?.p0 ?? mini.answerTimes?.p0 ?? mini.playerAnswers?.p0?.timeTaken, 4);
    clients[0].send("disconnect");
    assert.equal(room.hostId, "p1");
    h.advance(1000);
    const returned = h.socket("p0");
    returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    assert.ok(h.events.some((e) => e.target === returned.id && e.name === questionEvent));
    const question = h.events.filter((e) => e.target === returned.id && e.name === questionEvent).at(-1).data;
    if (game === "petit_bac") {
      assert.equal(question.hasAnswered, true);
      assert.equal(question.savedAnswers[0], "Paris");
    } else if (game === "le_faux_du_vrai") {
      assert.equal(question.hasAnswered, true);
      assert.equal(question.selectedAnswerIndex, 1);
    }
    assert.equal(room.players[0].withdrawn, false);
    assert.equal(room.listeTournament.initialParticipantCount, 3);
    returned.send(event, payload);
    clients[0].send(event, payload);
    clients[0].send("leaveRoom");
    clients[0].send("disconnect");
    assert.equal(saved(), original);
    assert.equal(room.players[0].socketId, returned.id);
    assert.equal(room.players[0].isConnected, true);
    assert.equal(room.players[0].withdrawn, false);
    assert.equal(room.gameState.phase, "playing");
  });
}

test("étape 7 : reconnexion en correction, transfert d'hôte et vainqueur unique", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  h.advance(9300);
  clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
  h.advance(6500);
  clients.forEach((s) => s.send("petitBacAnswer", { roomCode: room.roomCode, answers: { 0: "Paris" } }));
  h.advance(3000);
  const mini = room.gameState.currentMiniGameState;
  clients[0].send("hostGradePlayer", { points: 1, details: { 0: 1 } });
  const savedStats = JSON.stringify(room.players.map((p) => [p.roundScore, p.roundTime]));
  const savedGrades = JSON.stringify(mini.scoresGiven);
  const cursor = [mini.correctionIndex, mini.gradingPlayerIndex];
  clients[0].send("disconnect");
  assert.equal(room.hostId, "p1");
  const returned = h.socket("p0");
  returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
  const correction = h.events.filter((e) => e.target === returned.id && e.name === "correctionUpdate").at(-1).data;
  assert.equal(correction.currentGrade, 1);
  assert.equal(correction.petitBacData.answers[0], "Paris");
  assert.deepEqual([mini.correctionIndex, mini.gradingPlayerIndex], cursor);
  clients[0].send("hostGradePlayer", { points: 0, details: {} });
  clients[0].send("correctionNavigate", { direction: 1 });
  assert.equal(JSON.stringify(mini.scoresGiven), savedGrades);
  clients[1].send("hostGradePlayer", { points: 1, details: { 0: 1 } });
  assert.equal(JSON.stringify(room.players.map((p) => [p.roundScore, p.roundTime])), savedStats);
  for (let i = 0; i < 2; i++) {
    clients[1].send("correctionNavigate", { direction: 1 });
    clients[1].send("hostGradePlayer", { points: 0, details: {} });
  }
  const token = h.api.getListeContext(room);
  clients[1].send("endPetitBacCorrection");
  clients[1].send("endPetitBacCorrection", null, token);
  h.advance(16500);
  assert.equal(room.gameState.phase, "listeFinished");
  assert.deepEqual(Array.from(room.listeTournament.winners), ["p0"]);
  assert.equal(room.listeTournament.roundResults.length, 1);
  assert.equal(room.players[0].tournamentTime, 4);
});

test("étape 7 : reconnexion et abandon à mi-classement sans décaler les 8 secondes", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac", "qui_suis_je"]);
  clients[0].send("hostStartGame", {});
  room.gameState.phase = "listeRoundEnd";
  room.players.forEach((p) => { p.roundScore = 1; p.roundTime = 5; });
  h.api.endMiniGame(room.roomCode);
  h.advance(3500);
  clients[2].send("disconnect");
  const returned = h.socket("p2");
  returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Retour" });
  assert.equal(h.events.filter((e) => e.target === returned.id && e.name === "gameStateUpdate").at(-1).data.phase,
    "listeLeaderboard");
  clients[0].send("leaveRoom");
  assert.equal(room.hostId, "p1");
  const snapshot = h.events.filter((e) => e.name === "gameStateUpdate").at(-1).data;
  assert.deepEqual(Array.from(snapshot.listeLeaderboard.ranking, (p) => p.playerId), ["p1", "p2"]);
  const withdrawn = h.socket("p0");
  withdrawn.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retiré" });
  const late = h.socket("late");
  late.send("joinRoom", { roomCode: room.roomCode, playerId: "late", pseudo: "Tardif" });
  assert.equal(late.roomCode, null);
  h.advance(4499);
  assert.equal(room.gameState.phase, "listeLeaderboard");
  h.advance(1);
  assert.equal(room.gameState.phase, "drawingGame");
  assert.equal(room.gameState.roundNumber, 2);
  h.advance(9300);
  clients[1].send("playerSetReady", { isReady: true });
  returned.send("playerSetReady", { isReady: true });
  h.advance(2500);
  const mini = room.gameState.currentMiniGameState;
  const event = mini.type === "petit_bac" ? "petitBacAnswer" : "quiSuisJeAnswer";
  withdrawn.send(event, { roomCode: room.roomCode, answer: "Interdit", answers: {} });
  assert.equal(mini.playerAnswers.p0, undefined);
  assert.equal(room.players[0].withdrawn, true);
  assert.equal(room.listeTournament.initialParticipantCount, 3);
});

test("étape 7 : reconnexion tardive au tirage ne décale pas son échéance serveur", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  h.advance(8500);
  clients[0].send("disconnect");
  const returned = h.socket("p0");
  returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
  assert.equal(h.events.filter((e) => e.target === returned.id && e.name === "gameStateUpdate").at(-1).data.phase,
    "drawingGame");
  h.advance(799);
  assert.equal(room.gameState.phase, "drawingGame");
  h.advance(1);
  assert.equal(room.gameState.phase, "rules");
  clients[1].send("playerSetReady", { isReady: true });
  clients[2].send("playerSetReady", { isReady: true });
  returned.send("playerSetReady", { isReady: true });
  assert.equal(room.gameState.phase, "playing");
});

test("étape 7 : classement final permanent, co-vainqueurs puis aucun participant admissible", () => {
  const h = harness();
  const { room, clients } = h.create();
  h.configure(room, clients[0], "manual", ["petit_bac"]);
  clients[0].send("hostStartGame", {});
  room.gameState.phase = "listeRoundEnd";
  room.players.forEach((p) => { p.roundScore = 1; p.roundTime = 5; });
  h.api.endMiniGame(room.roomCode);
  h.advance(608000);
  assert.equal(room.gameState.phase, "listeFinished");
  assert.deepEqual(Array.from(room.listeTournament.winners), ["p0", "p1", "p2"]);
  clients[2].send("disconnect");
  const returned = h.socket("p2");
  returned.send("joinRoom", { roomCode: room.roomCode, playerId: "p2", pseudo: "Retour" });
  const final = h.events.filter((e) => e.target === returned.id && e.name === "gameStateUpdate").at(-1).data;
  assert.equal(final.listeLeaderboard.isFinal, true);
  assert.deepEqual(Array.from(final.listeLeaderboard.winners), ["p0", "p1", "p2"]);
  clients[0].send("leaveRoom");
  clients[1].send("leaveRoom");
  returned.send("leaveRoom");
  assert.equal(room.hostId, null);
  assert.equal(room.listeTournament.initialParticipantCount, 3);
  assert.equal(room.listeTournament.generalRanking.length, 0);
  assert.equal(room.listeTournament.winners.length, 0);
  assert.equal(h.timers.size, 0);
  const count = h.events.length;
  h.allTimers.forEach((t) => t.fn());
  assert.equal(h.events.length, count);
});

test("étape 7 : Battle Royale de la correction réelle jusqu'à la victoire Enchères", () => {
  const h = harness();
  const { room, clients } = h.create();
  clients[0].send("hostStartGame", { forcedMiniGame: "petit_bac" });
  h.advance(32500);
  clients[0].send("drawingFinished");
  clients.forEach((s) => s.send("playerSetReady", { isReady: true }));
  h.advance(6500);
  clients.forEach((s) => s.send("petitBacAnswer", { roomCode: room.roomCode, answers: {} }));
  h.advance(3000);
  for (let i = 0; i < 3; i++) {
    clients[0].send("correctionNavigate", { direction: i === 0 ? -99 : 1 });
    const points = 2 - i;
    clients[0].send("hostGradePlayer", { points,
      details: Object.fromEntries(Array.from({ length: points }, (_, n) => [n, 1])), soundValue: 1 });
  }
  clients[0].send("correctionNextQuestion");
  const scores = h.events.filter((e) => e.name === "scoreUpdate");
  assert.equal(scores.length, 4);
  scores.forEach(({ data }) => {
    assert.equal(data.gameMode, undefined);
    assert.deepEqual(Array.from(data.players, (p) => p.id), ["p0", "p1", "p2"]);
    assert.ok(data.players.every((p) => p.place === undefined));
  });
  assert.deepEqual(Array.from(scores.at(-1).data.players, (p) => p.score), [2, 1, 0]);
  assert.deepEqual(Array.from(scores.at(-1).data.players, (p) => p.time), [4, 4, 4]);
  assert.equal(h.events.filter((e) => e.name === "playGradeSound").length, 3);
  h.advance(11999);
  assert.equal(room.players[2].eliminated, false);
  h.advance(1);
  assert.equal(room.players[2].eliminated, true);
  assert.ok(h.events.some((e) => e.name === "playerEliminated" && e.data.playerId === "p2"));
  assert.ok(h.events.some((e) => e.name === "playFinaleAnimation"));
  h.advance(23000);
  assert.equal(room.gameState.currentMiniGame, "les_encheres");
  clients.slice(0, 2).forEach((s) => s.send("playerSetReady", { isReady: true }));
  const mini = room.gameState.currentMiniGameState;
  const themes = h.events.filter((e) => e.name === "encheresSetup").at(-1).data.themes;
  const theme = themes.find((t) => !t.outOfStock).id;
  clients.slice(0, 2).forEach((s) => s.send("encheresVoteTheme", theme));
  h.advance(3500);
  assert.equal(mini.subPhase, "bidding");
  clients[0].send("encheresPlaceBid", 1);
  h.advance(69000);
  assert.equal(mini.subPhase, "collecting");
  clients[0].send("encheresSendAnswer", "Test");
  h.advance(90000);
  assert.equal(mini.subPhase, "correction");
  clients[0].send("encheresToggleCorrection", { index: 0, status: true });
  clients[0].send("encheresFinalizeGame");
  assert.ok(h.events.some((e) => e.name === "encheresVictory" && e.data.winnerPseudo === "Hôte"));
  assert.equal(h.events.some((e) => e.name === "gameOver"), false);
  h.advance(2499);
  assert.equal(h.events.some((e) => e.name === "gameOver"), false);
  h.advance(1);
  assert.ok(h.events.some((e) => e.name === "gameOver" && e.data.winner === "Hôte"));
  assert.equal(room.listeTournament.started, false);
  assert.equal(room.listeTournament.roundResults.length, 0);
});

// Sécurité des identités : le transport et la persistance restent simulés en mémoire.
function securityRoom(h, mode) {
  const { room, clients } = h.create(3);
  if (mode === "liste") h.configure(room, clients[0], "manual", ["petit_bac"]);
  return { room, clients };
}

function securityLeugtasQuestion(room) {
  room.gameState.phase = "playing";
  room.gameState.currentMiniGame = "qui_veut_gagner_des_leugtas";
  room.gameState.currentMiniGameState = {
    type: "qui_veut_gagner_des_leugtas", questionIndex: 0,
    questions: [{ correct_answer_id: "good" }], playerAnswers: {},
    leugtasTimer: { running: true, totalSeconds: 20, remainingSeconds: 15 }
  };
}

for (const mode of ["battle_royale", "liste"]) {
  test(`sécurité ${mode} : un playerId public ne reprend ni l'hôte ni un invité`, () => {
    const h = harness();
    const { room, clients } = securityRoom(h, mode);
    for (const target of [clients[0], clients[1]]) {
      const player = room.players.find((p) => p.playerId === target.identity);
      const originalSocket = player.socketId;
      const originalPseudo = player.pseudo;
      for (const reconnectSecret of [null, "0".repeat(64)]) {
        const attacker = h.socket(target.identity);
        attacker.send("joinRoom", {
          roomCode: room.roomCode, playerId: target.identity, pseudo: "Usurpateur", reconnectSecret
        });
        assert.equal(attacker.roomCode, null);
        assert.equal(player.socketId, originalSocket);
        assert.equal(player.pseudo, originalPseudo);
        assert.equal(target.joinedRooms.has(room.roomCode), true);
        assert.ok(h.events.some((e) => e.target === attacker.id && e.name === "errorMessage"));
        assert.equal(h.events.some((e) => e.target === attacker.id && e.name === "reconnectCredential"), false);
      }
    }
    assert.equal(room.hostId, "p0");
  });

  test(`sécurité ${mode} : reprise légitime, secret privé et ancien socket révoqué`, () => {
    const h = harness();
    const { room, clients } = securityRoom(h, mode);
    if (mode === "liste") clients[0].send("hostStartGame", {});
    const host = room.players[0];
    host.score = 7;
    host.totalTime = 12;
    host.tournamentPoints = 4;
    const secret = h.credentials.get(`${room.roomCode}:p0`);
    assert.match(secret, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(h.api.serializeRoom(room)).includes(secret), false);
    assert.equal(h.events.filter((e) => e.target === room.roomCode)
      .some((e) => JSON.stringify(e.data).includes(secret)), false);
    const replacement = h.socket("p0");
    replacement.send("joinRoom", { roomCode: room.roomCode, playerId: "p0", pseudo: "Retour" });
    assert.equal(host.socketId, replacement.id);
    assert.equal(host.score, 7);
    assert.equal(host.totalTime, 12);
    assert.equal(host.tournamentPoints, 4);
    assert.equal(room.hostId, "p0");
    assert.equal(clients[0].joinedRooms.has(room.roomCode), false);
    assert.equal(clients[0].roomCode, null);
    assert.equal(replacement.joinedRooms.has(room.roomCode), true);
    const before = h.events.length;
    clients[0].send("requestRoomState");
    clients[0].send("leaveRoom");
    clients[0].send("hostStartGame", {});
    clients[0].send("disconnect");
    assert.equal(h.events.length, before);
    assert.equal(host.socketId, replacement.id);
    assert.equal(host.isConnected, true);
    assert.equal(room.hostId, "p0");
    if (mode === "liste") {
      assert.equal(room.gameState.phase, "drawingGame");
      replacement.send("drawingFinished");
      h.advance(9300);
      assert.equal(room.gameState.phase, "rules");
    } else {
      replacement.send("hostStartGame", {});
      assert.equal(room.gameState.phase, "intro");
      h.advance(32500);
      assert.equal(room.gameState.phase, "drawingGame");
    }
    securityLeugtasQuestion(room);
    clients[0].send("leugtasAnswer", { roomCode: room.roomCode, playerId: "p0", answerId: "good" });
    assert.equal(host.score, 7);
    assert.equal(room.gameState.currentMiniGameState.playerAnswers.p0, undefined);
    replacement.send("leugtasAnswer", { roomCode: room.roomCode, playerId: "p0", answerId: "good" });
    assert.equal(host.score, 8);
  });

  test(`sécurité ${mode} : secret d'un autre joueur ou d'une autre salle refusé`, () => {
    const h = harness();
    const first = securityRoom(h, mode);
    const second = securityRoom(h, mode);
    const target = first.room.players[1];
    for (const wrongSecret of [
      h.credentials.get(`${first.room.roomCode}:p0`),
      h.credentials.get(`${second.room.roomCode}:p1`)
    ]) {
      const attacker = h.socket("p1");
      attacker.send("joinRoom", {
        roomCode: first.room.roomCode, playerId: "p1", pseudo: "Faux", reconnectSecret: wrongSecret
      });
      assert.equal(attacker.roomCode, null);
      assert.equal(target.socketId, first.clients[1].id);
      assert.equal(target.pseudo, "p1");
    }
  });

  test(`sécurité ${mode} : un invité reconnecté garde son état sans obtenir les droits hôte`, () => {
    const h = harness();
    const { room, clients } = securityRoom(h, mode);
    const guest = room.players[1];
    guest.score = 3;
    guest.roundTime = 9;
    const replacement = h.socket("p1");
    replacement.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retour" });
    assert.equal(guest.socketId, replacement.id);
    assert.equal(guest.score, 3);
    assert.equal(guest.roundTime, 9);
    assert.equal(room.hostId, "p0");
    replacement.send("hostStartGame", {});
    assert.equal(room.gameState.phase, "idle");
    clients[0].send("hostStartGame", {});
    assert.equal(room.gameState.phase, mode === "liste" ? "drawingGame" : "intro");
  });

  test(`sécurité ${mode} : roomCode et playerId fournis ne dirigent pas une réponse dans une autre salle`, () => {
    const h = harness();
    const first = securityRoom(h, mode);
    const second = securityRoom(h, mode);
    if (mode === "liste") {
      first.clients[0].send("hostStartGame", {});
      second.clients[0].send("hostStartGame", {});
    }
    for (const { room } of [first, second]) securityLeugtasQuestion(room);
    const target = second.room.players[1];
    first.clients[1].send("leugtasAnswer", {
      roomCode: second.room.roomCode, playerId: target.playerId, answerId: "good"
    });
    assert.equal(target.score, 0);
    assert.equal(second.room.gameState.currentMiniGameState.playerAnswers.p1, undefined);
    assert.equal(first.room.players[1].score, 1);
    assert.equal(first.room.gameState.currentMiniGameState.playerAnswers.p1.answerId, "good");
  });

  test(`sécurité ${mode} : la correction reste réservée à l'hôte de la salle`, () => {
    const h = harness();
    const first = securityRoom(h, mode);
    const second = securityRoom(h, mode);
    if (mode === "liste") {
      first.clients[0].send("hostStartGame", {});
      second.clients[0].send("hostStartGame", {});
    }
    for (const { room } of [first, second]) {
      room.gameState.phase = "playing";
      room.gameState.currentMiniGame = "qui_suis_je";
      room.gameState.currentMiniGameState = {
        type: "qui_suis_je", finished: true, correctionIndex: 0,
        gradingPlayerIndex: 1, questions: [{}], scoresGiven: {}, history: {}
      };
      room.activePlayersList = room.players;
    }
    const target = first.room.players[1];
    first.clients[1].send("hostGradePlayer", { points: 1, roomCode: second.room.roomCode, playerId: "p1" });
    assert.equal(target.score, 0);
    first.clients[0].send("hostGradePlayer", { points: 1, roomCode: second.room.roomCode, playerId: "p1" });
    assert.equal(target.score, 1);
    assert.equal(second.room.players[1].score, 0);
  });
}

test("sécurité Battle Royale : transfert d'hôte après départ volontaire", () => {
  const h = harness();
  const { room, clients } = h.create(4);
  clients[0].send("leaveRoom");
  assert.equal(room.hostId, "p1");
  clients[0].send("hostStartGame", {});
  assert.equal(room.gameState.phase, "idle");
  clients[1].send("hostStartGame", {});
  assert.equal(room.gameState.phase, "intro");
  h.advance(32500);
  assert.equal(room.gameState.phase, "drawingGame");
});

test("sécurité : un ancien playerId crée ou rejoint une nouvelle salle sans ancien secret", () => {
  const h = harness();
  const original = h.socket("known-id");
  original.send("createRoom", { playerId: "known-id", pseudo: "Ancien" });
  const first = h.api.rooms[original.roomCode];
  const newHost = h.socket("new-host");
  newHost.send("createRoom", { playerId: "new-host", pseudo: "Nouveau" });
  const second = h.api.rooms[newHost.roomCode];
  const returning = h.socket("known-id");
  returning.send("joinRoom", {
    roomCode: second.roomCode, playerId: "known-id", pseudo: "Ancien", reconnectSecret: null
  });
  assert.equal(returning.roomCode, second.roomCode);
  assert.equal(second.players.find((p) => p.playerId === "known-id").socketId, returning.id);
  assert.equal(first.players[0].socketId, original.id);
  assert.notEqual(h.credentials.get(`${first.roomCode}:known-id`),
    h.credentials.get(`${second.roomCode}:known-id`));
});

test("sécurité Liste : transfert d'hôte et retrait définitif après reconnexion", () => {
  const h = harness();
  const { room, clients } = securityRoom(h, "liste");
  clients[0].send("hostStartGame", {});
  const count = room.listeTournament.initialParticipantCount;
  clients[1].send("leaveRoom");
  const withdrawn = room.players[1];
  assert.equal(withdrawn.withdrawn, true);
  const returning = h.socket("p1");
  returning.send("joinRoom", { roomCode: room.roomCode, playerId: "p1", pseudo: "Retour" });
  assert.equal(withdrawn.socketId, returning.id);
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(room.listeTournament.initialParticipantCount, count);
  clients[0].send("disconnect");
  assert.equal(room.hostId, "p2");
  returning.send("drawingFinished");
  assert.equal(room.gameState.phase, "drawingGame");
  clients[2].send("drawingFinished");
  h.advance(9300);
  assert.equal(room.gameState.phase, "rules");
  returning.send("playerSetReady", { isReady: true });
  assert.equal(room.gameState.readyPlayers.p1, undefined);
});
