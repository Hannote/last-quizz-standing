"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public_2/client.js"), "utf8");

function block(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

function client(gameMode = "liste", game = "le_faux_du_vrai") {
  function element() {
    const classes = new Set();
    return { style: {}, innerHTML: "", textContent: "", classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    } };
  }
  let now = 0;
  let nextId = 0;
  let quit;
  const timers = new Map();
  const allTimers = [];
  const handlers = {};
  const elements = Object.fromEntries(["leaderboard-overlay", "leaderboard-content", "leaderboardTitle",
    "liste-leaderboard-overlay"].map((id) => [id, element()]));
  const sound = { plays: 0, stops: 0, play() { this.plays++; }, stop() { this.stops++; } };
  const c = {
    currentRoom: { roomCode: "AAAA", gameMode, players: [], listeTournament: { tournamentId: "tour-1" } },
    currentGameState: { phase: "playing", roundNumber: 1, currentMiniGame: game, readyPlayerIds: [] },
    listeActionContext: { tournamentId: "tour-1", roundNumber: 1, miniGame: game, phase: "playing", question: 0 },
    currentPlayersData: [{ id: "p", nickname: "Joueur", score: 1, time: 4, place: 1 }],
    playerId: "p", isQuitting: false, console: { log() {} },
    document: { getElementById: (id) => elements[id], querySelectorAll: () => [] },
    socket: { emit() {}, disconnect() {}, connect() {}, on: (name, fn) => { handlers[name] = fn; } },
    confirmQuitBtn: { addEventListener: (_, fn) => { quit = fn; } },
    quitConfirmOverlay: null, petitBacContainer: null, pbLetterDisplay: null, pbFormZone: null,
    screenLobby: element(), screenRoom: element(), globalControls: element(),
    localStorage: { removeItem() {}, setItem() {} },
    hideAllMiniGames() {}, stopDrawAnimation() {},
    body: element(), lastPhase: "playing", iAmReady: false, roomUpper: null,
    gamePhaseText: null, currentMiniGameText: null, updateGameModeUI() {}, clearIntroLayer() {},
    roomCodeDisplay: element(), playersList: element(), startGameBtn: null,
    isListePlayerInactive: () => false, setRoomError() {}, updateReadyPlayersListUI() {},
    hideListeLeaderboard() { elements["liste-leaderboard-overlay"].classList.remove("active"); },
    showScreen(screen) { c.screenLobby.classList[screen === "lobby" ? "add" : "remove"]("active"); },
    playingChoices: { ...element(), querySelectorAll: () => [] }, playingQuestion: element(), playingFeedback: element(),
    sfx45s: sound, sfxFauxVraiWin: sound, sfxFauxVraiLose: sound,
    sfxLeugtasQuestion: sound, sfxLeugtasWin: sound, sfxLeugtasLose: sound,
    cleanups: 0, resets: 0,
    cleanUpFauxVraiScenes() { c.cleanups++; }, cleanUpBehindScenes() { c.cleanups++; },
    resetTimerBarVisuals() { c.resets++; },
    setTimeout(fn, delay) {
      const timer = { id: ++nextId, fn, delay, at: now + delay };
      timers.set(timer.id, timer);
      allTimers.push(timer);
      return timer.id;
    }
  };
  vm.createContext(c);
  const helperStart = source.includes("let miniGameLeaderboardVersion =")
    ? "let miniGameLeaderboardVersion =" : "function handleInterimLeaderboard(";
  vm.runInContext(block(helperStart, "// Le mode Liste ne trie"), c);
  for (const name of ["updateRoomUI", "updateGameStateUI"]) {
    vm.runInContext(block(`function ${name}(`, "\n}") + "\n}", c);
  }
  vm.runInContext(block('socket.on("fauxVraiReveal",', "// --- ?COUTEUR INTRO ---"), c);
  vm.runInContext(block('socket.on("leugtasReveal",', 'socket.on("fauxVraiQuestion",'), c);
  vm.runInContext(block('socket.on("roomJoined",', 'socket.on("roomUpdate",'), c);
  vm.runInContext(block("if (confirmQuitBtn) {", "// clic sur"), c);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      now = next.at;
      timers.delete(next.id);
      next.fn();
    }
    now = end;
  }
  return {
    c, elements, handlers, advance, allTimers, sound,
    quit: () => quit(),
    join(mode = gameMode, roomCode = "BBBB") {
      handlers.roomJoined({ roomCode, gameMode: mode, players: [], listeTournament: { tournamentId: "tour-2" } });
      c.currentGameState = { phase: "playing", roundNumber: 1, currentMiniGame: game, readyPlayerIds: [] };
      c.listeActionContext = { tournamentId: "tour-2", roundNumber: 1, miniGame: game, phase: "playing", question: 0 };
    },
    reveal(last = true) {
      if (game === "le_faux_du_vrai") handlers.fauxVraiReveal({ indexFausse: 0, playerChoice: 0, isLastQuestion: last });
      else handlers.leugtasReveal({ correctAnswerId: "a", playerAnswers: null, isLastQuestion: last });
    }
  };
}

for (const game of ["le_faux_du_vrai", "qui_veut_gagner_des_leugtas"]) {
  test(`callbacks ${game} : quitter avant le classement différé`, () => {
    const h = client("liste", game);
    h.reveal();
    h.advance(1000);
    h.quit();
    const stops = h.sound.stops;
    h.advance(10000);
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
    assert.equal(h.sound.stops, stops);
    assert.equal(h.c.cleanups, 0);
    assert.equal(h.c.resets, 0);
  });

  for (const nextMode of ["liste", "battle_royale"]) {
    test(`callbacks ${game} : quitter puis rejoindre ${nextMode}, ancien affichage ignoré`, () => {
      const h = client("liste", game);
      h.reveal();
      h.quit();
      h.join(nextMode);
      const stops = h.sound.stops;
      h.advance(2500);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
      assert.equal(h.sound.stops, stops);
      assert.equal(h.c.cleanups, 0);
    });
  }

  test(`callbacks ${game} : changement de tournoi dans la même salle`, () => {
    const h = client("liste", game);
    h.reveal();
    h.c.listeActionContext.tournamentId = "tour-2";
    h.c.currentRoom.listeTournament.tournamentId = "tour-2";
    h.advance(2500);
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
  });

  test(`callbacks ${game} : changement de question ou de manche`, () => {
    for (const field of ["question", "roundNumber"]) {
      const h = client("liste", game);
      h.reveal();
      if (field === "question") h.c.listeActionContext.question++;
      else h.c.currentGameState.roundNumber++;
      h.advance(2500);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
    }
  });

  for (const mode of ["liste", "battle_royale"]) {
    test(`callbacks ${game} : affichage et fermeture normaux en ${mode}`, () => {
      const h = client(mode, game);
      h.reveal();
      h.advance(2499);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
      if (mode === "liste") {
        h.c.listeActionContext.phase = "listeRoundEnd";
        h.c.listeActionContext.question++; // Dernière question Faux du vrai déjà avancée côté serveur.
      }
      h.advance(1);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), true);
      assert.match(h.elements["leaderboard-content"].innerHTML, /Joueur/);
      const duration = game === "le_faux_du_vrai" ? 4500 : 5000;
      h.advance(duration - 1);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), true);
      h.advance(1);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
      assert.equal(h.c.cleanups, game === "le_faux_du_vrai" ? 1 : 0);
      assert.equal(h.c.resets, game === "qui_veut_gagner_des_leugtas" ? 1 : 0);
    });
  }
}

for (const mode of ["liste", "battle_royale"]) {
  test(`callbacks : ancienne fermeture ne ferme ni ne modifie un nouveau classement ${mode}`, () => {
    const h = client(mode);
    h.c.handleInterimLeaderboard(h.c.currentPlayersData, () => { h.c.resets++; }, 4500, "Ancien");
    const oldClose = h.allTimers.at(-1);
    h.quit();
    h.join(mode);
    h.c.handleInterimLeaderboard(h.c.currentPlayersData, () => {}, 5000, "Nouveau");
    const content = h.elements["leaderboard-content"].innerHTML;
    oldClose.fn(); // Callback déjà mis en file avant l'invalidation.
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), true);
    assert.equal(h.elements["leaderboardTitle"].textContent, "Nouveau");
    assert.equal(h.elements["leaderboard-content"].innerHTML, content);
    assert.equal(h.c.resets, 0);
    h.advance(5000);
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
  });
}

for (const game of ["le_faux_du_vrai", "qui_veut_gagner_des_leugtas"]) {
  test(`callbacks ${game} : classement intermédiaire et nettoyage normaux dans les deux modes`, () => {
    for (const mode of ["liste", "battle_royale"]) {
      const h = client(mode, game);
      h.reveal(false);
      h.advance(2500);
      assert.equal(h.elements["leaderboardTitle"].textContent, "CLASSEMENT");
      assert.equal(h.allTimers.find((timer) => timer.delay === 999999).at, 1002499);
      h.advance(499);
      assert.equal(h.c.cleanups, 0);
      h.advance(1);
      assert.equal(h.c.cleanups, 1);
      assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), true);
    }
  });

  test(`callbacks ${game} : remplacement dans la même manche invalide fermeture et nettoyage précédents`, () => {
    const h = client("liste", game);
    h.reveal(false);
    h.advance(2500);
    const oldClose = h.allTimers.find((timer) => timer.delay === 999999);
    const oldCleanup = h.allTimers.find((timer) => timer.delay === 500);
    h.c.handleInterimLeaderboard(h.c.currentPlayersData, () => {}, 5000, "Nouveau");
    oldClose.fn();
    oldCleanup.fn();
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), true);
    assert.equal(h.elements["leaderboardTitle"].textContent, "Nouveau");
    assert.equal(h.c.cleanups, 0);
  });
}

test("callbacks : changement de contexte d'affichage ou de partie invalide les rappels", () => {
  for (const change of [
    (h) => h.c.updateGameStateUI({ ...h.c.currentGameState, phase: "listeFinished" }),
    (h) => h.c.updateGameStateUI({ ...h.c.currentGameState, phase: "listeLeaderboard" }),
    (h) => h.c.updateGameStateUI({ ...h.c.currentGameState, phase: "rules", roundNumber: 2 }),
    (h) => h.c.updateRoomUI({ ...h.c.currentRoom, listeTournament: { tournamentId: "tour-2" } })
  ]) {
    const h = client();
    h.reveal();
    h.advance(2500);
    change(h);
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
    const stops = h.sound.stops;
    h.advance(10000);
    assert.equal(h.elements["leaderboard-overlay"].classList.contains("active"), false);
    assert.equal(h.c.cleanups, 0);
    assert.equal(h.sound.stops, stops);
  }
});
