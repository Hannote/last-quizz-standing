// server.js
// Last Quizz Standing - Tirage au sort animé + règles + prêts
// + mini-jeu Leugtas phase 2.4 (envoi question au client).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const leBonOrdreData = require(
  path.join(__dirname, "public_2", "le_bon_ordre", "le_bon_ordre.json")
);
const LE_BON_ORDRE_QUESTIONS = leBonOrdreData.questions || [];
const LE_BON_ORDRE_THEMES = leBonOrdreData.themes || [];

const blindTestData = require(
  path.join(__dirname, "public_2", "blind_test", "blind_test.json")
);
const BLIND_TEST_QUESTIONS = blindTestData.questions || [];
const BLIND_TEST_THEMES = blindTestData.themes || [];

const leTourDuMondeData = require(
  path.join(__dirname, "public_2", "le_tour_du_monde", "le_tour_du_monde.json")
);
const TOUR_MONDE_QUESTIONS = leTourDuMondeData.questions || [];
const TOUR_MONDE_THEMES = leTourDuMondeData.themes || [];
const PETIT_BAC_CATEGORIES = [
  "Sportif en activité (hors foot)",
  "Entraineur de foot",
  "Club de foot",
  "Acteur ou Actrice",
  "Dessin animé / Manga",
  "Jeu vidéo",
  "Métier",
  "Pays",
  "Plat"
];

const quiSuisJeData = require(
  path.join(__dirname, "public_2", "qui_suis_je", "qui_suis_je.json")
);
const QUI_SUIS_JE_QUESTIONS = quiSuisJeData.questions || [];

// --- AJOUTER EN HAUT AVEC LES REQUIRE ---
// Charge le JSON des enchères (structure supposée public_2/les_encheres/les_encheres.json)
// Si le dossier n'existe pas, vérifie le chemin exact.
const lesEncheresData = require(
  path.join(__dirname, "public_2", "les_encheres", "les_encheres.json")
);
const ENCHERES_QUESTIONS = lesEncheresData.questions || [];
const ENCHERES_THEMES = lesEncheresData.themes || [];

// ===============================
//   CHARGEMENT JSON LEUGTAS
// ===============================
const leugtasData = require(
  path.join(
    __dirname,
    "public_2",
    "qui_veut_gagner_des_leugtas",
    "qui_veut_gagner_des_leugtas.json"
  )
);

const LEUGTAS_QUESTIONS = leugtasData.questions || [];

const fauxVraiRaw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "public_2", "le_faux_du_vrai", "le_faux_du_vrai.json"),
    "utf8"
  )
);
const fauxVraiThemes = fauxVraiRaw.themes || [];
const fauxVraiQuestions = fauxVraiRaw.questions || [];

function pickLeugtasQuestionsByPaliers() {
  const result = [];

  for (let p = 1; p <= 8; p++) {
    const theme = "palier_" + p;
    const pool = LEUGTAS_QUESTIONS.filter((q) => q.theme_id === theme);

    if (!pool.length) {
      console.error("Aucune question trouvée pour", theme);
      return null;
    }

    const index = Math.floor(Math.random() * pool.length);
    result.push(pool[index]);
  }

  return result;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// On sert le dossier public_2
app.use(express.static(path.join(__dirname, "public_2")));

// ===============================
//   GESTION DES ROOMS
// ===============================

const rooms = {};

const POSSIBLE_MINI_GAMES = [
  "qui_suis_je",
  "blind_test",
  "le_tour_du_monde",
  "le_bon_ordre",
  "petit_bac",
  "qui_veut_gagner_des_leugtas",
  "le_faux_du_vrai",
  "les_encheres" // <--- AJOUT
];
const LEUGTAS_TIMER_DURATION_SECONDS = 30;
const FAUX_VRAI_TIMER_DURATION = 40;
const LE_BON_ORDRE_DURATION = 45;

// ===============================
//      GAME STATE HELPERS
// ===============================
function createInitialGameState() {
  return {
    phase: "idle", // idle | drawingGame | rules | playing
    roundNumber: 0,
    currentMiniGame: null,
    miniGamesAlreadyPlayed: [],
    // MODIFICATION : On filtre "les_encheres" pour qu'il ne soit jamais tiré au sort automatiquement
    // (Il sera lancé manuellement par la logique de finale ou le bac à sable)
    possibleMiniGames: POSSIBLE_MINI_GAMES.filter(g => g !== "les_encheres"),
    readyPlayers: {},

    // Mini-jeu spécifique
    currentMiniGameState: null,
    leugtasAskedQuestionIds: []
  };
}

function getGameStateSummary(room) {
  const gs = room.gameState || createInitialGameState();
  return {
    phase: gs.phase,
    roundNumber: gs.roundNumber,
    currentMiniGame: gs.currentMiniGame,
    readyPlayerIds: Object.keys(gs.readyPlayers || {})
  };
}

function startLeugtasTimer(room) {
  const roomCode = room.roomCode;
  const gs = room.gameState;
  const total = LEUGTAS_TIMER_DURATION_SECONDS;

  if (!gs.currentMiniGameState) {
    gs.currentMiniGameState = {};
  }

  gs.currentMiniGameState.leugtasTimer = {
    totalSeconds: total,
    remainingSeconds: total,
    running: true
  };

  // On envoie tout de suite la valeur initiale
  io.to(roomCode).emit("leugtasTimerUpdate", {
    remainingSeconds: total,
    totalSeconds: total
  });

  // On nettoie un ancien timer si besoin
  if (room.leugtasTimerInterval) {
    clearInterval(room.leugtasTimerInterval);
  }

  room.leugtasTimerInterval = setInterval(() => {
    const timer =
      gs.currentMiniGameState && gs.currentMiniGameState.leugtasTimer;
    if (!timer || !timer.running) {
      clearInterval(room.leugtasTimerInterval);
      room.leugtasTimerInterval = null;
      return;
    }

    timer.remainingSeconds -= 1;
    if (timer.remainingSeconds < 0) timer.remainingSeconds = 0;

    io.to(roomCode).emit("leugtasTimerUpdate", {
      remainingSeconds: timer.remainingSeconds,
      totalSeconds: timer.totalSeconds
    });

    if (timer.remainingSeconds <= 0) {
      timer.running = false;
      console.log(`Salle ${roomCode} : fin du timer Leugtas`);
      endLeugtasQuestion(roomCode, gs.currentMiniGameState);
    }
  }, 1000);
}

function startFauxVrai(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const QUESTIONS_PER_GAME = 7;

  const shuffled = [...fauxVraiQuestions].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(
    0,
    Math.min(QUESTIONS_PER_GAME, shuffled.length)
  );

  room.mini = {
    type: "faux_vrai",
    list: selected,
    index: 0,
    answers: {},
    timer: null
  };

  sendFauxVraiQuestion(roomCode);
}

function sendFauxVraiQuestion(roomCode) {
  const room = rooms[roomCode];
  const game = room?.mini;
  if (!room || !game) return;

  const q = game.list[game.index];
  if (!q) return;

  io.to(roomCode).emit("fauxVraiQuestion", {
    question: q.question,
    affirmations: q.affirmations,
    themeId: q.themeId,
    indexFausse: q.indexFausse,
    duration: FAUX_VRAI_TIMER_DURATION,
    index: game.index + 1,
    total: game.list.length
  });

  // CORRECTION AUDIT : Passage de 2000ms à 3000ms
  // Pour synchroniser avec l'overlay client de 2.5s
  setTimeout(() => {
    startFauxVraiTimer(roomCode);
  }, 2500);
}

function startFauxVraiTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const game = room.mini;
  if (!game || game.type !== "faux_vrai") return;

  const total = FAUX_VRAI_TIMER_DURATION;
  let remaining = total;

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  io.to(roomCode).emit("fauxVraiTimerUpdate", {
    remaining,
    total
  });

  game.startTime = Date.now();

  game.timer = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) {
      remaining = 0;
    }

    io.to(roomCode).emit("fauxVraiTimerUpdate", {
      remaining,
      total
    });

    if (remaining <= 0) {
      clearInterval(game.timer);
      game.timer = null;
      revealFauxVrai(roomCode);
    }
  }, 1000);
}

function revealFauxVrai(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const game = room.mini;
  if (!game || game.type !== "faux_vrai") return;

  const q = game.list[game.index];
  if (!q) return;

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  const indexFausse = q.indexFausse;
  const maxDuration = FAUX_VRAI_TIMER_DURATION;

  room.players.forEach((player) => {
    if (player.eliminated || player.isSpectator) return;

    const socketId = player.socketId;
    const answerIndex = game.answers[socketId];
    const isCorrect =
      typeof answerIndex === "number" && answerIndex === indexFausse;

    if (isCorrect) {
      player.score = (player.score || 0) + 1;
      player.roundScore += 1;
    }

    let realTime =
      game.answerTimes && game.answerTimes[socketId]
        ? game.answerTimes[socketId]
        : maxDuration;
    const timeTaken = isCorrect ? realTime : maxDuration;
    registerPlayerTime(player, timeTaken, isCorrect, maxDuration);
  });

  const isLastQuestion = game.index >= game.list.length - 1;

  room.players.forEach((player) => {
    const socketId = player.socketId;
    const answerIndex = game.answers[socketId];

    io.to(socketId).emit("fauxVraiReveal", {
      indexFausse,
      playerChoice:
        typeof answerIndex === "number" ? answerIndex : null,
      isLastQuestion
    });
  });

  io.to(roomCode).emit("scoreUpdate", {
    players: room.players
      .filter((p) => !p.eliminated && !p.isSpectator)
      .map((p) => ({
        id: p.playerId,
        nickname: p.pseudo,
        score: p.roundScore || 0,
        time: p.roundTime || 0
      }))
  });

  const waitTime = isLastQuestion ? 8500 : 5500;

  setTimeout(() => {
    nextFauxVrai(roomCode);
  }, waitTime);
}

function nextFauxVrai(roomCode) {
  const room = rooms[roomCode];
  const game = room?.mini;
  if (!room || !game) return;

  game.index++;

  if (game.index >= game.list.length) {
    io.to(roomCode).emit("fauxVraiEnd");

    setTimeout(() => {
      endMiniGame(roomCode);
    }, 2800);

    return;
  }

  game.answers = {};
  sendFauxVraiQuestion(roomCode);
}

function endMiniGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // --- S�CURIT� ANTI DOUBLE-APPEL ---
  if (room.isEnding) return;
  room.isEnding = true;
  setTimeout(() => {
    if (room) room.isEnding = false;
  }, 3000);
  // ----------------------------------

  const gs = room.gameState;
  if (!gs) return;

  // 1. Sauvegarder que ce jeu a �t� jou�
  const currentMini = gs.currentMiniGame;
  if (currentMini && !gs.miniGamesAlreadyPlayed.includes(currentMini)) {
    gs.miniGamesAlreadyPlayed.push(currentMini);
  }

  // 2. LOGIQUE D'�LIMINATION (Sauf si on �tait d�j� en finale)
  if (currentMini !== "les_encheres") {
    performElimination(room);
    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
  }

  // 3. V�rifier les survivants
  const activePlayers = room.players.filter(p => !p.eliminated && !p.isSpectator);
  
  console.log(`Fin du jeu. Survivants: ${activePlayers.length}`);

  if (activePlayers.length <= 1) {
    // VICTOIRE
    const winner = activePlayers[0] || { pseudo: "Personne" };
    io.to(roomCode).emit("gameOver", { winner: winner.pseudo });
    return;
  }

  if (activePlayers.length === 2) {
    // --- FINALE ---
    console.log(`Salle ${roomCode} : Place � la finale (Les Ench�res) !`);
    gs.phase = "rules";
    gs.currentMiniGame = "les_encheres";
    gs.roundNumber += 1;
    gs.readyPlayers = {};
    room.mini = null;

    resetRoundStats(room);

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
    io.to(roomCode).emit("showRules", {
      miniGameCode: "les_encheres",
      roundNumber: gs.roundNumber,
      isFinale: true
    });

  } else {
    // --- NOUVEAU ROUND (Cycle normal) ---
    console.log(`Salle ${roomCode} : Nouveau round (encore ${activePlayers.length} joueurs)`);
    gs.phase = "drawingGame";
    gs.currentMiniGame = pickRandomMiniGame(room);
    gs.roundNumber += 1;
    gs.readyPlayers = {};
    room.mini = null;

    resetRoundStats(room);

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  }
}
function performElimination(room) {
  // 1. Vérifier si un joueur a quitté (abandonné) durant ce round
  const quitters = room.players.filter(p => p.hasQuitDuringRound);

  if (quitters.length > 0) {
    console.log(`Elimination standard annulée : ${quitters.length} joueur(s) ont abandonné.`);
    
    // On nettoie le flag et on s'assure qu'ils sont marqués éliminés
    quitters.forEach(p => {
      p.hasQuitDuringRound = false; 
      p.eliminated = true; 
    });

    // IMPORTANT : On s'arrête ici. Personne d'autre ne sera éliminé ce tour-ci.
    return;
  }

  // --- LOGIQUE STANDARD (Si personne n'a quitté) ---
  const activePlayers = room.players.filter(p => !p.eliminated && !p.isSpectator);
  
  // Il faut au moins 2 joueurs pour en éliminer un
  if (activePlayers.length < 2) return;

  activePlayers.sort((a, b) => {
    // Le plus petit score est éliminé
    if (a.roundScore !== b.roundScore) {
      return a.roundScore - b.roundScore; 
    }
    // En cas d'égalité, le plus lent (temps le plus grand) est éliminé
    return b.roundTime - a.roundTime; 
  });

  const loser = activePlayers[0];
  loser.eliminated = true;

  console.log(`ELIMINATION : ${loser.pseudo} (Score: ${loser.roundScore})`);

  io.to(room.roomCode).emit("playerEliminated", {
    playerId: loser.playerId,
    pseudo: loser.pseudo,
    reason: `Score: ${loser.roundScore} pts | Temps: ${loser.roundTime.toFixed(1)}s`
  });
}
async function endLeugtasQuestion(roomCode, mini) {
  const room = rooms[roomCode];
  const gs = room?.gameState;
  if (!room || !gs || !mini) return;
  if (mini.isRevealing) return;

  mini.isRevealing = true;
  mini.finished = true;

  // Arrêt du timer
  if (mini.leugtasTimer) {
    mini.leugtasTimer.running = false;
  }
  if (room.leugtasTimerInterval) {
    clearInterval(room.leugtasTimerInterval);
    room.leugtasTimerInterval = null;
  }
  mini.leugtasTimer = null;

  const currentIndex = mini.questionIndex || 0;
  const q = mini.questions?.[currentIndex];
  if (!q) return;

  mini.playerAnswers = mini.playerAnswers || {};
  const answeredIds = new Set(Object.keys(mini.playerAnswers));

  // On attribue "Faux" à ceux qui n'ont pas répondu
  room.players.forEach((player) => {
    // Si pas de réponse, on force une entrée incorrecte
    if (!answeredIds.has(player.playerId)) {
      mini.playerAnswers[player.playerId] = {
        answerId: null,
        isCorrect: false,
        timeTaken: LEUGTAS_TIMER_DURATION_SECONDS
      };
      // Pénalité de temps max pour ceux qui ne répondent pas
      registerPlayerTime(
        player,
        LEUGTAS_TIMER_DURATION_SECONDS,
        false,
        LEUGTAS_TIMER_DURATION_SECONDS
      );
    }
  });

  // Scoreboard émis après chaque question
  io.to(roomCode).emit("scoreUpdate", {
    players: room.players
      .filter((pl) => !pl.eliminated && !pl.isSpectator)
      .map((pl) => ({
        id: pl.playerId,
        nickname: pl.pseudo,
        score: pl.roundScore || 0,
        time: pl.roundTime || 0
      }))
  });

  // Reveal de la bonne réponse
  const isLastQuestion = mini.questionIndex >= mini.questions.length - 1;

  io.to(roomCode).emit("leugtasReveal", {
    correctAnswerId: q.correct_answer_id,
    playerAnswers: mini.playerAnswers,
    isLastQuestion
  });

  const continueToNextQuestion = () => {
    const activeMini = gs.currentMiniGameState;
    if (!activeMini) return;

    if (activeMini.questionIndex < activeMini.questions.length - 1) {
      activeMini.questionIndex++;
      activeMini.playerAnswers = {};
      activeMini.finished = false;
      activeMini.isRevealing = false;

      io.to(roomCode).emit("leugtasQuestion", {
        question: activeMini.questions[activeMini.questionIndex],
        index: activeMini.questionIndex + 1,
        total: activeMini.questions.length
      });

      setTimeout(() => {
        startLeugtasTimer(room);
      }, 2500);
      return;
    }

    io.to(roomCode).emit("leugtasEnd");

    setTimeout(() => {
      activeMini.isRevealing = false;
      activeMini.finished = false;

      endMiniGame(roomCode);
    }, 2000);
  };

  const waitTime = isLastQuestion ? 8500 : 5500;

  if (mini.allAnsweredEarly) {
    await new Promise((res) => setTimeout(res, waitTime));
    mini.allAnsweredEarly = false;
    continueToNextQuestion();
    return;
  }

  setTimeout(() => {
    continueToNextQuestion();
  }, waitTime);
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  if (rooms[code]) return generateRoomCode();
  return code;
}

function serializeRoom(room) {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      playerId: p.playerId,
      pseudo: p.pseudo,
      isConnected: p.isConnected,
      eliminated: p.eliminated,
      isSpectator: p.isSpectator
    }))
  };
}

function pickRandomMiniGame(room) {
  const gs = room.gameState;
  let candidates = gs.possibleMiniGames.filter(
    (g) => !gs.miniGamesAlreadyPlayed.includes(g)
  );

  if (candidates.length === 0) {
    gs.miniGamesAlreadyPlayed = [];
    candidates = [...gs.possibleMiniGames];
  }

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

// ===============================
//   MINI-JEU LEUGTAS
// ===============================
function pickRandomLeugtasQuestion(options = {}) {
  const { themeId = null, excludeIds = [] } = options;

  let pool = LEUGTAS_QUESTIONS;

  if (themeId) {
    pool = pool.filter((q) => q.theme_id === themeId);
  }

  if (excludeIds.length > 0) {
    const ex = new Set(excludeIds);
    pool = pool.filter((q) => !ex.has(q.id));
  }

  if (pool.length === 0) return null;

  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

function pickLeBonOrdreQuestions() {
  const selectedQuestions = [];
  LE_BON_ORDRE_THEMES.forEach((theme) => {
    const pool = LE_BON_ORDRE_QUESTIONS.filter((q) => q.theme_id === theme.id);
    if (pool.length > 0) {
      const randomQ = pool[Math.floor(Math.random() * pool.length)];
      randomQ.themeName = theme.name;
      selectedQuestions.push(randomQ);
    }
  });
  return selectedQuestions.sort(() => Math.random() - 0.5);
}

function sendLeBonOrdreQuestion(roomCode) {
  const room = rooms[roomCode];
  const gs = room.gameState;
  const mini = gs.currentMiniGameState;
  if (!mini) return;

  const q = mini.questions[mini.questionIndex];

  io.to(roomCode).emit("leBonOrdreQuestion", {
    question: q,
    themeName: q.themeName,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  setTimeout(() => {
    startLeBonOrdreTimer(room);
  }, 2500);
}

function startLeBonOrdreTimer(room) {
  const roomCode = room.roomCode;
  const gs = room.gameState;
  const activeMini = gs.currentMiniGameState;
  if (!activeMini) return;

  activeMini.startTime = Date.now();

  const total = LE_BON_ORDRE_DURATION;
  activeMini.timer = {
    totalSeconds: total,
    remainingSeconds: total,
    running: true
  };

  io.to(roomCode).emit("leBonOrdreTimerUpdate", {
    remaining: total,
    total: total
  });

  if (room.leBonOrdreInterval) clearInterval(room.leBonOrdreInterval);

  room.leBonOrdreInterval = setInterval(() => {
    const timer = activeMini.timer;
    if (!timer || !timer.running) {
      clearInterval(room.leBonOrdreInterval);
      return;
    }
    timer.remainingSeconds -= 1;

    io.to(roomCode).emit("leBonOrdreTimerUpdate", {
      remaining: timer.remainingSeconds,
      total: timer.totalSeconds
    });

    if (timer.remainingSeconds <= 0) {
      endLeBonOrdreQuestion(roomCode);
    }
  }, 1000);
}

function endLeBonOrdreQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  const mini = gs.currentMiniGameState;
  if (!mini || mini.finished) return;

  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.leBonOrdreInterval) clearInterval(room.leBonOrdreInterval);

  room.players.forEach((p) => {
    const ans = mini.playerAnswers[p.playerId] || "RIEN";
    if (!mini.history[p.playerId]) mini.history[p.playerId] = {};
    mini.history[p.playerId][mini.questionIndex] = ans;
  });

  if (mini.questionIndex < mini.questions.length - 1) {
    mini.questionIndex++;
    mini.playerAnswers = {};
    mini.finished = false;

    sendLeBonOrdreQuestion(roomCode);
  } else {
    io.to(roomCode).emit("leBonOrdreEnd");
    setTimeout(() => {
      startCorrectionPhase(roomCode);
    }, 3000);
  }
}

function startCorrectionPhase(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  const mini = gs.currentMiniGameState;

  mini.correctionIndex = 0;
  mini.gradingPlayerIndex = 0;
  mini.scoresGiven = {};
  room.activePlayersList = room.players.filter(
    (p) => !p.eliminated && !p.isSpectator
  );

  sendCorrectionData(roomCode);
}

function sendCorrectionData(roomCode, targetSocket = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  if (!gs) return;
  const mini = gs.currentMiniGameState;

  // Sécurité : si pas de joueurs actifs ou pas de mini-jeu
  if (!mini || !room.activePlayersList || room.activePlayersList.length === 0) return;

  // Sécurité Index
  if (
    typeof mini.gradingPlayerIndex !== "number" ||
    mini.gradingPlayerIndex < 0 ||
    mini.gradingPlayerIndex >= room.activePlayersList.length
  ) {
    mini.gradingPlayerIndex = 0;
  }

  const playerToCheck = room.activePlayersList[mini.gradingPlayerIndex];

  let petitBacData = null;
  if (mini.type === "petit_bac") {
    const answers = mini.playerAnswers[playerToCheck.playerId] || {};
    const savedDetails = mini.gradingDetails
      ? mini.gradingDetails[playerToCheck.playerId]
      : {};
    petitBacData = {
      letter: mini.letter,
      categories: mini.categories,
      answers,
      savedDetails
    };
  }

  const q = mini.questions[mini.correctionIndex];
  const history = mini.history[playerToCheck.playerId] || {};
  const answer =
    mini.type === "petit_bac"
      ? "Voir fiche"
      : history[mini.correctionIndex] || "Pas de réponse";

  let currentGrade = null;
  if (
    mini.scoresGiven[mini.correctionIndex] &&
    mini.scoresGiven[mini.correctionIndex][playerToCheck.playerId] !== undefined
  ) {
    currentGrade =
      mini.scoresGiven[mini.correctionIndex][playerToCheck.playerId];
  }

  const emitCorrectionUpdate = (payload) => {
    if (targetSocket) {
      targetSocket.emit("correctionUpdate", payload);
    } else {
      io.to(roomCode).emit("correctionUpdate", payload);
    }
  };

  emitCorrectionUpdate({
    miniGameType: mini.type,
    questionImage: q.image_question || q.image,
    questionText: q.question || q.text,
    answerImage: q.image_reponse || null,
    answerText: q.reponse || q.answer || "",
    audio: q.audio || null,
    playerPseudo: playerToCheck.pseudo,
    playerAnswer: answer,
    currentQIndex: mini.correctionIndex + 1,
    totalQ: mini.questions.length,
    currentGrade: currentGrade,
    petitBacData
  });
}

// --- BLIND TEST HELPERS ---
function pickBlindTestQuestions() {
  const tvPool = BLIND_TEST_QUESTIONS.filter(
    (q) => q.theme_id === "television" || q.theme_id === "television_g"
  );
  const musicPool = BLIND_TEST_QUESTIONS.filter(
    (q) => q.theme_id === "musique" || q.theme_id === "music"
  );

  const selectedTV = tvPool.sort(() => 0.5 - Math.random()).slice(0, 2);
  const selectedMusic = musicPool.sort(() => 0.5 - Math.random()).slice(0, 6);
  
  const rawGameSet = [...selectedTV, ...selectedMusic].sort(() => 0.5 - Math.random());

  return rawGameSet.map(q => {
    const theme = BLIND_TEST_THEMES.find((th) => th.id === q.theme_id);
    return {
      ...q,
      themeName: theme ? theme.name : "Thème inconnu",
      text: q.question,               
      audio: q.audio_question,        // Mappe audio_question vers audio
      reponse: q.reponse_texte,       // Mappe reponse_texte vers reponse
      answer: q.reponse_texte,        // Sécurité pour le client
      image: q.image_reponse
    };
  });
}

function sendBlindTestQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room.gameState.currentMiniGameState;
  const q = mini.questions[mini.questionIndex];

  io.to(roomCode).emit("blindTestQuestion", {
    question: q,
    themeName: q.themeName,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  setTimeout(() => {
    startBlindTestTimer(room);
  }, 2500);
}

function startBlindTestTimer(room) {
  const roomCode = room.roomCode;
  const mini = room.gameState.currentMiniGameState;
  if (!mini) return;

  mini.startTime = Date.now();

  const total = 40;
  mini.timer = { totalSeconds: total, remainingSeconds: total, running: true };

  io.to(roomCode).emit("blindTestTimerUpdate", {
    remaining: total,
    total: total
  });

  if (room.blindTestInterval) clearInterval(room.blindTestInterval);

  room.blindTestInterval = setInterval(() => {
    if (!mini.timer || !mini.timer.running) {
      clearInterval(room.blindTestInterval);
      return;
    }

    mini.timer.remainingSeconds -= 1;
    io.to(roomCode).emit("blindTestTimerUpdate", {
      remaining: mini.timer.remainingSeconds,
      total: mini.timer.totalSeconds
    });

    if (mini.timer.remainingSeconds <= 0) {
      endBlindTestQuestion(roomCode);
    }
  }, 1000);
}

function endBlindTestQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const mini = room.gameState.currentMiniGameState;
  if (!mini || mini.finished) return;

  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.blindTestInterval) clearInterval(room.blindTestInterval);

  room.players.forEach((p) => {
    const ans = mini.playerAnswers[p.playerId] || "RIEN";
    if (!mini.history[p.playerId]) mini.history[p.playerId] = {};
    mini.history[p.playerId][mini.questionIndex] = ans;
  });

  if (mini.questionIndex < mini.questions.length - 1) {
    mini.questionIndex++;
    mini.playerAnswers = {};
    mini.finished = false;
    sendBlindTestQuestion(roomCode);
  } else {
    io.to(roomCode).emit("blindTestEnd");
    setTimeout(() => {
      startCorrectionPhase(roomCode);
    }, 3000);
  }
}

// --- LE TOUR DU MONDE HELPERS ---
function pickLeTourDuMondeQuestions() {
  const selectedQuestions = [];
  TOUR_MONDE_THEMES.forEach((theme) => {
    const pool = TOUR_MONDE_QUESTIONS.filter((q) => q.themeId === theme.id);
    if (pool.length > 0) {
      const randomQ = pool[Math.floor(Math.random() * pool.length)];
      randomQ.themeName = theme.nom;
      selectedQuestions.push(randomQ);
    }
  });
  return selectedQuestions.sort(() => Math.random() - 0.5);
}

function sendLeTourDuMondeQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room.gameState.currentMiniGameState;
  const q = mini.questions[mini.questionIndex];

  io.to(roomCode).emit("leTourDuMondeQuestion", {
    question: q,
    themeName: q.themeName,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  setTimeout(() => {
    startLeTourDuMondeTimer(room);
  }, 2500);
}

function startLeTourDuMondeTimer(room) {
  const roomCode = room.roomCode;
  const mini = room.gameState.currentMiniGameState;
  if (!mini) return;

  mini.startTime = Date.now();

  const total = 40;
  mini.timer = { totalSeconds: total, remainingSeconds: total, running: true };

  io.to(roomCode).emit("leTourDuMondeTimerUpdate", {
    remaining: total,
    total: total
  });

  if (room.leTourDuMondeInterval) clearInterval(room.leTourDuMondeInterval);

  room.leTourDuMondeInterval = setInterval(() => {
    if (!mini.timer || !mini.timer.running) {
      clearInterval(room.leTourDuMondeInterval);
      return;
    }
    mini.timer.remainingSeconds -= 1;

    io.to(roomCode).emit("leTourDuMondeTimerUpdate", {
      remaining: mini.timer.remainingSeconds,
      total: mini.timer.totalSeconds
    });

    if (mini.timer.remainingSeconds <= 0) {
      endLeTourDuMondeQuestion(roomCode);
    }
  }, 1000);
}

function endLeTourDuMondeQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const mini = room.gameState.currentMiniGameState;
  if (!mini || mini.finished) return;

  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.leTourDuMondeInterval) clearInterval(room.leTourDuMondeInterval);

  room.players.forEach((p) => {
    const ans = mini.playerAnswers[p.playerId] || "RIEN";
    if (!mini.history[p.playerId]) mini.history[p.playerId] = {};
    mini.history[p.playerId][mini.questionIndex] = ans;
  });

  if (mini.questionIndex < mini.questions.length - 1) {
    mini.questionIndex++;
    mini.playerAnswers = {};
    mini.finished = false;
    sendLeTourDuMondeQuestion(roomCode);
  } else {
    io.to(roomCode).emit("leTourDuMondeEnd");
    setTimeout(() => {
      startCorrectionPhase(roomCode);
    }, 3000);
  }
}

// --- QUI SUIS-JE HELPERS ---
function pickQuiSuisJeQuestions() {
  const shuffled = [...QUI_SUIS_JE_QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 8);
}

function sendQuiSuisJeQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room.gameState.currentMiniGameState;
  const q = mini.questions[mini.questionIndex];

  io.to(roomCode).emit("quiSuisJeQuestion", {
    question: q,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  setTimeout(() => {
    startQuiSuisJeTimer(room);
  }, 2500);
}

function startQuiSuisJeTimer(room) {
  const roomCode = room.roomCode;
  const mini = room.gameState.currentMiniGameState;
  if (!mini) return;

  mini.startTime = Date.now();

  const total = 40;
  mini.timer = { totalSeconds: total, remainingSeconds: total, running: true };

  io.to(roomCode).emit("quiSuisJeTimerUpdate", {
    remaining: total,
    total: total
  });

  if (room.quiSuisJeInterval) clearInterval(room.quiSuisJeInterval);

  room.quiSuisJeInterval = setInterval(() => {
    if (!mini.timer || !mini.timer.running) {
      clearInterval(room.quiSuisJeInterval);
      return;
    }
    mini.timer.remainingSeconds -= 1;
    io.to(roomCode).emit("quiSuisJeTimerUpdate", {
      remaining: mini.timer.remainingSeconds,
      total: mini.timer.totalSeconds
    });

    if (mini.timer.remainingSeconds <= 0) {
      endQuiSuisJeQuestion(roomCode);
    }
  }, 1000);
}

function endQuiSuisJeQuestion(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const mini = room.gameState.currentMiniGameState;
  if (!mini || mini.finished) return;

  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.quiSuisJeInterval) clearInterval(room.quiSuisJeInterval);

  room.players.forEach((p) => {
    const ans = mini.playerAnswers[p.playerId] || "RIEN";
    if (!mini.history[p.playerId]) mini.history[p.playerId] = {};
    mini.history[p.playerId][mini.questionIndex] = ans;
  });

  if (mini.questionIndex < mini.questions.length - 1) {
    mini.questionIndex++;
    mini.playerAnswers = {};
    mini.finished = false;
    sendQuiSuisJeQuestion(roomCode);
  } else {
    io.to(roomCode).emit("quiSuisJeEnd");
    setTimeout(() => {
      startCorrectionPhase(roomCode);
    }, 3000);
  }
}

function startPetitBac(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const letter = alphabet[Math.floor(Math.random() * alphabet.length)];

  gs.currentMiniGameState = {
    type: "petit_bac",
    letter,
    categories: PETIT_BAC_CATEGORIES,
    playerAnswers: {},
    finished: false,
    timer: null,
    questions: [{ text: "Grille Petit Bac" }],
    questionIndex: 0,
    history: {},
    scoresGiven: {},
    gradingDetails: {}
  };

  // 1. On envoie l'info (déclenche l'animation lettre chez le client)
  io.to(roomCode).emit("petitBacStart", {
    letter,
    categories: PETIT_BAC_CATEGORIES,
    duration: 120
  });

  // 2. On attend 2.5 secondes (fin de l'animation) AVANT de lancer le timer
  setTimeout(() => {
    startPetitBacTimer(room);
  }, 2500);
}

function startPetitBacTimer(room) {
  const roomCode = room.roomCode;
  const mini = room.gameState.currentMiniGameState;
  if (!mini) return;

  let remaining = 120;
  mini.timer = { totalSeconds: 120, remainingSeconds: 120, running: true };
  mini.startTime = Date.now();

  io.to(roomCode).emit("petitBacTimerUpdate", { remaining, total: 120 });

  if (room.petitBacInterval) clearInterval(room.petitBacInterval);

  room.petitBacInterval = setInterval(() => {
    if (!mini.timer || !mini.timer.running) {
      clearInterval(room.petitBacInterval);
      return;
    }
    remaining--;
    mini.timer.remainingSeconds = remaining;
    io.to(roomCode).emit("petitBacTimerUpdate", { remaining, total: 120 });

    if (remaining <= 0) {
      endPetitBacRound(roomCode);
    }
  }, 1000);
}

function endPetitBacRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const mini = room.gameState.currentMiniGameState;
  if (!mini || mini.finished) return;

  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.petitBacInterval) clearInterval(room.petitBacInterval);

  io.to(roomCode).emit("petitBacEnd");

  setTimeout(() => {
    startCorrectionPhase(roomCode);
  }, 3000);
}

// ===============================
//   SOCKET.IO
// ===============================
io.on("connection", (socket) => {
  console.log("Client connecté :", socket.id);
  socket.emit("fauxVraiThemes", fauxVraiThemes);

  socket.playerId = null;
  socket.roomCode = null;
  socket.room = null;

  // -----------------------------------
  //            CREATE ROOM
  // -----------------------------------
  socket.on("createRoom", (data) => {
    const pseudo = (data?.pseudo || "").trim();
    const playerId = (data?.playerId || "").trim();

    if (!pseudo) return socket.emit("errorMessage", "Merci d'entrer un pseudo.");
    if (!playerId) return socket.emit("errorMessage", "playerId manquant.");

    const roomCode = generateRoomCode();
    const room = {
      roomCode,
      hostId: playerId,
      players: [],
      gameState: createInitialGameState(),
      createdAt: Date.now()
    };

    const player = {
      playerId,
      id: socket.id,
      pseudo,
      socketId: socket.id,
      isConnected: true,
      eliminated: false,
      isSpectator: false,
      
      // --- NOUVELLES STATS BATTLE ROYALE ---
      score: 0,           // Score global (Cosmétique / Classement général)
      roundScore: 0,      // Score du mini-jeu en cours (Pour l'élimination)
      totalTime: 0,       // Temps cumulé global (Départage)
      roundTime: 0,       // Temps cumulé sur le mini-jeu en cours
      // -------------------------------------
    };

    room.players.push(player);
    rooms[roomCode] = room;

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;
    socket.room = roomCode;

    console.log(`Salle ${roomCode} créée par ${pseudo}`);

    socket.emit("roomJoined", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    syncPlayerWithGame(socket, room);
  });

  // -----------------------------------
  //            JOIN ROOM
  // -----------------------------------
  socket.on("joinRoom", (data) => {
    const playerId = (data?.playerId || "").trim();
    const pseudo = (data?.pseudo || "").trim();
    const roomCode = (data?.roomCode || "").trim().toUpperCase();

    if (!pseudo) return socket.emit("errorMessage", "Merci d'entrer un pseudo.");
    if (!roomCode)
      return socket.emit("errorMessage", "Merci d'entrer un code de salle.");
    if (!playerId) return socket.emit("errorMessage", "playerId manquant.");

    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMessage", "Cette salle n'existe pas.");

    let player = room.players.find((p) => p.playerId === playerId);

    if (player) {
      player.socketId = socket.id;
      player.id = socket.id;
      player.isConnected = true;
      player.pseudo = pseudo;
    } else {
      player = {
        playerId,
        id: socket.id,
        pseudo,
        socketId: socket.id,
        isConnected: true,
        eliminated: false,
        isSpectator: false,
        
        // --- NOUVELLES STATS BATTLE ROYALE ---
        score: 0,           // Score global (Cosmétique / Classement général)
        roundScore: 0,      // Score du mini-jeu en cours (Pour l'élimination)
        totalTime: 0,       // Temps cumulé global (Départage)
        roundTime: 0,       // Temps cumulé sur le mini-jeu en cours
        // -------------------------------------
      };
      room.players.push(player);
    }

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;
    socket.room = roomCode;

    socket.emit("roomJoined", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    syncPlayerWithGame(socket, room);
  });

  // -----------------------------------
  //         HOST START GAME
  // -----------------------------------
  socket.on("hostStartGame", (data) => {
    const roomCode = socket.roomCode;
    const playerId = socket.playerId;

    if (!roomCode || !playerId) return;

    const room = rooms[roomCode];
    if (!room || room.hostId !== playerId) return;

    const gs = room.gameState;

    const forcedMiniGame = POSSIBLE_MINI_GAMES.includes(data?.forcedMiniGame)
      ? data.forcedMiniGame
      : null;

    const activePlayers = room.players.filter((p) => !p.eliminated);
    if (!forcedMiniGame && activePlayers.length < 3) {
      return socket.emit(
        "errorMessage",
        "Il faut au moins 3 joueurs pour lancer une partie."
      );
    }

    gs.roundNumber += 1;
    gs.currentMiniGame = forcedMiniGame || pickRandomMiniGame(room);
    gs.miniGamesAlreadyPlayed.push(gs.currentMiniGame);
    gs.phase = "drawingGame";
    gs.readyPlayers = {};

    console.log(
      `Salle ${roomCode} : round ${gs.roundNumber}, mini-jeu = ${gs.currentMiniGame}`
    );

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  });

  // -----------------------------------
  //         FIN ANIMATION TIRAGE
  // -----------------------------------
  // -----------------------------------
  //         FIN ANIMATION TIRAGE
  // -----------------------------------
  socket.on("drawingFinished", () => {
    const roomCode = socket.roomCode;
    const playerId = socket.playerId;

    const room = rooms[roomCode];
    if (!room) return;

    // Seul l'hôte peut signaler la fin de l'animation pour changer de phase
    if (room.hostId !== playerId) return;

    const gs = room.gameState;
    if (gs.phase !== "drawingGame") return;

    gs.phase = "rules";
    gs.readyPlayers = {};

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  });

  // -----------------------------------
  //         READY / NOT READY
  // -----------------------------------
  socket.on("playerSetReady", (data) => {
    const roomCode = socket.roomCode;
    const playerId = socket.playerId;

    const room = rooms[roomCode];
    if (!room) return;

    const gs = room.gameState;
    if (gs.phase !== "rules") return;

    const isReady = !!data?.isReady;
    if (isReady) gs.readyPlayers[playerId] = true;
    else delete gs.readyPlayers[playerId];

    const activePlayers = room.players.filter(
      (p) => !p.eliminated && !p.isSpectator
    );
    const allReady = activePlayers.every((p) => gs.readyPlayers[p.playerId]);

    if (allReady && activePlayers.length > 0) {
      gs.phase = "playing";
      console.log(
        `Salle ${roomCode} : tous les joueurs sont prêts → phase playing (mini-jeu ${gs.currentMiniGame})`
      );
      // plus tard : on démarrera ici le vrai mini-jeu

      // ------- LEUGTAS ----------
      if (gs.currentMiniGame === "qui_veut_gagner_des_leugtas") {
        // Début d'une question Leugtas : on sélectionne un lot de questions.
        const leugtasQuestions = pickLeugtasQuestionsByPaliers();
        if (!leugtasQuestions) {
          return;
        }

        gs.currentMiniGameState = {
          type: "qui_veut_gagner_des_leugtas",
          questions: leugtasQuestions,
          questionIndex: 0,
          playerAnswers: {},
          finished: false,
          leugtasTimer: null,
          isRevealing: false,
          allAnsweredEarly: false
        };

        const firstQuestion = leugtasQuestions[0];

        io.to(roomCode).emit("leugtasQuestion", {
          question: firstQuestion,
          index: 1,
          total: leugtasQuestions.length
        });

        setTimeout(() => {
          startLeugtasTimer(room);
        }, 2500); // Augmenté pour laisser le temps à l'intro client

        leugtasQuestions.forEach((q) => {
          if (q) gs.leugtasAskedQuestionIds.push(q.id);
        });

        console.log(
          `Salle ${roomCode} : Leugtas question id = ${
            firstQuestion ? firstQuestion.id : "AUCUNE"
          }`
        );
      }
      // ------- LE FAUX DU VRAI ----------
      else if (gs.currentMiniGame === "le_faux_du_vrai") {
        gs.currentMiniGameState = null;
        startFauxVrai(roomCode);
      }
      // ------- QUI SUIS-JE ----------
      else if (gs.currentMiniGame === "qui_suis_je") {
        const questions = pickQuiSuisJeQuestions();
        if (questions && questions.length > 0) {
          gs.currentMiniGameState = {
            type: "qui_suis_je",
            questions,
            questionIndex: 0,
            playerAnswers: {},
            history: {},
            finished: false,
            timer: null,
            scoresGiven: {}
          };
          sendQuiSuisJeQuestion(roomCode);
        }
      }
      // ------- LE BON ORDRE ----------
      else if (gs.currentMiniGame === "le_bon_ordre") {
        const questions = pickLeBonOrdreQuestions();
        if (questions && questions.length > 0) {
          gs.currentMiniGameState = {
            type: "le_bon_ordre",
            questions,
            questionIndex: 0,
            playerAnswers: {},
            history: {},
            finished: false,
            timer: null
          };

          sendLeBonOrdreQuestion(roomCode);
        }
      }
      // ------- LE TOUR DU MONDE ----------
      else if (gs.currentMiniGame === "le_tour_du_monde") {
        const questions = pickLeTourDuMondeQuestions();
        if (questions && questions.length > 0) {
          gs.currentMiniGameState = {
            type: "le_tour_du_monde",
            questions,
            questionIndex: 0,
            playerAnswers: {},
            history: {},
            finished: false,
            timer: null,
            scoresGiven: {}
          };

          sendLeTourDuMondeQuestion(roomCode);
        }
      }
      // ------- BLIND TEST ----------
      else if (gs.currentMiniGame === "blind_test") {
        const questions = pickBlindTestQuestions();
        if (questions && questions.length > 0) {
          gs.currentMiniGameState = {
            type: "blind_test",
            questions,
            questionIndex: 0,
            playerAnswers: {},
            history: {},
            finished: false,
            timer: null,
            scoresGiven: {}
          };

          sendBlindTestQuestion(roomCode);
        }
      }
      // ------- PETIT BAC ----------
      else if (gs.currentMiniGame === "petit_bac") {
        startPetitBac(roomCode);
      }
      // ------- LES ENCHÈRES ----------
      else if (gs.currentMiniGame === "les_encheres") {
        startLesEncheres(roomCode);
      }
      // ------- AUTRES MINI-JEUX ----------
      else {
        gs.currentMiniGameState = null;
      }
    }

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  });

  // Réception des réponses Leugtas
  socket.on("leugtasAnswer", ({ roomCode, playerId, answerId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // 1. Définition UNIQUE de player (Sécurité Spectateur)
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || player.eliminated || player.isSpectator) return;

    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

    if (!mini || gs.currentMiniGame !== "qui_veut_gagner_des_leugtas") return;

    // Bloquer la réponse si le timer n'est pas encore lancé
    if (!mini.leugtasTimer || !mini.leugtasTimer.running) return;

    const q = mini.questions[mini.questionIndex];
    if (!q) return;

    if (mini.finished) return;

    if (!mini.playerAnswers) mini.playerAnswers = {};
    if (mini.playerAnswers[playerId]) return;

    let timeTaken = LEUGTAS_TIMER_DURATION_SECONDS;
    if (mini.leugtasTimer && mini.leugtasTimer.running) {
      timeTaken =
        mini.leugtasTimer.totalSeconds - mini.leugtasTimer.remainingSeconds;
    }

    const isCorrect = answerId === q.correct_answer_id;

    mini.playerAnswers[playerId] = {
      answerId,
      isCorrect,
      timeTaken
    };

    // 2. Mise à jour des scores (On utilise la variable 'player' définie plus haut)
    if (isCorrect) {
       player.roundScore += 1;
      player.score += 1;
    }
    registerPlayerTime(player, timeTaken, isCorrect, LEUGTAS_TIMER_DURATION_SECONDS);

    if (player.socketId) {
      io.to(player.socketId).emit("leugtasFeedback", {
        status: isCorrect ? "good" : "bad"
      });
    }

    const activePlayers = room.players.filter(
      (p) => !p.eliminated && !p.isSpectator
    );

    const allAnswered = activePlayers.every(
      (player) =>
        mini.playerAnswers[player.playerId] &&
        mini.playerAnswers[player.playerId].answerId !== null
    );

    if (allAnswered) {
      mini.allAnsweredEarly = true;
      endLeugtasQuestion(roomCode, mini);
    }
  });
  socket.on("fauxVraiAnswer", (index) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player || player.eliminated || player.isSpectator) return;

    const game = room.mini;
    // Bloquer la réponse si le timer n'est pas encore lancé
    if (!game || !game.timer) return;
    if (!game || game.type !== "faux_vrai") return;

    if (!game.answerTimes) game.answerTimes = {};
    const timeTaken = (Date.now() - (game.startTime || Date.now())) / 10**3;
    game.answerTimes[socket.id] = timeTaken;

    game.answers[socket.id] = index;

    // CORRECTIF : On compte uniquement les joueurs ACTIFS pour la fin anticipée
    const activePlayers = room.players.filter(
      (p) => !p.eliminated && !p.isSpectator
    );
    const answersCount = activePlayers.reduce((count, p) => {
      return count + (game.answers[p.socketId] !== undefined ? 1 : 0);
    }, 0);

    if (answersCount >= activePlayers.length) {
      if (game.timer) {
        clearInterval(game.timer);
        game.timer = null;
      }
      revealFauxVrai(socket.roomCode);
    }
  });

  socket.on("quiSuisJeAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    const mini = room.gameState.currentMiniGameState;

    if (!mini || mini.type !== "qui_suis_je" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("quiSuisJeAnswerAck");

      const activePlayers = room.players.filter(
        (p) => !p.eliminated && !p.isSpectator
      );
      const allAnswered = activePlayers.every(
        (p) => mini.playerAnswers[p.playerId]
      );

      if (allAnswered) {
        endQuiSuisJeQuestion(roomCode);
      }
    }
  });

  // -----------------------------------
  //         LEAVE ROOM
  // -----------------------------------
  socket.on("leaveRoom", () => {
    const roomCode = socket.roomCode;
    const playerId = socket.playerId;

    if (!roomCode || !playerId) return;

    const room = rooms[roomCode];
    if (!room) return;

    const playerIdx = room.players.findIndex((p) => p.playerId === playerId);
    if (playerIdx === -1) return;

    const player = room.players[playerIdx];
    const gs = room.gameState;

    // --- LOGIQUE D'ABANDON ---
    if (gs && gs.phase === "playing" && !player.eliminated && !player.isSpectator) {
      console.log(`Joueur ${player.pseudo} a quitté en plein jeu -> Disqualification.`);
      
      player.isConnected = false;
      player.eliminated = true;
      player.score = 0;
      player.roundScore = -999;
      player.hasQuitDuringRound = true;

      io.to(roomCode).emit("playerEliminated", {
        playerId: player.playerId,
        pseudo: player.pseudo,
        reason: "Abandon de la partie (Disqualification)"
      });

      const activePlayers = room.players.filter(
        (p) => !p.eliminated && !p.isSpectator && p.isConnected
      );
      if (activePlayers.length === 1) {
        io.to(roomCode).emit("gameOver", { winner: activePlayers[0].pseudo });
      }
    } else {
      // Sinon (Lobby ou entre deux jeux), on supprime proprement le joueur de la liste
      room.players.splice(playerIdx, 1);

      // --- AJOUT : GESTION DU PASSAGE FORCÉ EN FINALE ---
      if (gs) {
        const activePlayers = room.players.filter(
          (p) => !p.eliminated && !p.isSpectator
        );

        if (
          activePlayers.length === 2 &&
          gs.currentMiniGame !== "les_encheres" &&
          gs.phase !== "idle"
        ) {
          console.log(
            `Salle ${roomCode} : Un joueur a quitté entre deux jeux -> Passage forcé en Finale.`
          );

          // On annule le jeu prévu et on force les enchères
          gs.phase = "rules";
          gs.currentMiniGame = "les_encheres";
          gs.readyPlayers = {};

          // On s'assure que les stats sont clean pour la finale
          resetRoundStats(room);

          // On informe immédiatement les clients du changement radical
          io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));

          io.to(roomCode).emit("showRules", {
            miniGameCode: "les_encheres",
            roundNumber: gs.roundNumber,
            isFinale: true
          });
        }
      }
      // --------------------------------------------------
    }

    if (room.players.length === 0) {
      delete rooms[roomCode];
      socket.leave(roomCode);
      return;
    }

    if (room.hostId === playerId) {
      const newHost = room.players.find((p) => p.isConnected) || room.players[0];
      room.hostId = newHost ? newHost.playerId : null;
    }
    
    socket.leave(roomCode);

    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    if (!gs || gs.phase !== "playing") {
      io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
    }
  });

  // -----------------------------------
  //        REQUEST ROOM STATE
  // -----------------------------------
  socket.on("requestRoomState", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;

    const room = rooms[roomCode];
    if (!room) return;

    socket.emit("roomUpdate", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
  });

    // -----------------------------------
    //           DISCONNECT
  // -----------------------------------
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    const playerId = socket.playerId;

    if (!roomCode || !playerId) return;

    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.playerId === playerId);
    if (player) {
      player.isConnected = false;
      player.socketId = null;
    }

    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
  });

  // -----------------------------------
  //        LE BON ORDRE - RÉPONSE
  // -----------------------------------
  socket.on("leBonOrdreAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

  if (!mini || mini.type !== "le_bon_ordre" || mini.finished) return;

    // Vérification : Le timer doit tourner
    if (!mini.timer || !mini.timer.running) return;

  if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("leBonOrdreAnswerAck");

      const activePlayers = room.players.filter(
        (p) => !p.eliminated && !p.isSpectator
      );
      const allAnswered = activePlayers.every(
        (p) => mini.playerAnswers && mini.playerAnswers[p.playerId]
      );

      if (allAnswered) {
        endLeBonOrdreQuestion(roomCode);
      }
    }
  });

  socket.on("leTourDuMondeAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

    if (!mini || mini.type !== "le_tour_du_monde" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("leTourDuMondeAnswerAck");

      const activePlayers = room.players.filter(
        (p) => !p.eliminated && !p.isSpectator
      );
      const allAnswered = activePlayers.every(
        (p) => mini.playerAnswers[p.playerId]
      );

      if (allAnswered) {
        endLeTourDuMondeQuestion(roomCode);
      }
    }
  });

  socket.on("blindTestAnswer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

    if (!mini || mini.type !== "blind_test" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("blindTestAnswerAck");

      const activePlayers = room.players.filter(
        (p) => !p.eliminated && !p.isSpectator
      );
      const allAnswered = activePlayers.every(
        (p) => mini.playerAnswers[p.playerId]
      );

      if (allAnswered) {
        endBlindTestQuestion(roomCode);
      }
    }
  });

  socket.on("petitBacAnswer", ({ roomCode, answers }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    const mini = room.gameState.currentMiniGameState;

    if (!mini || mini.type !== "petit_bac" || mini.finished) return;

    if (!mini.responseTimes) mini.responseTimes = {};
    const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
    mini.responseTimes[socket.playerId] = timeTaken;
    mini.playerAnswers[socket.playerId] = answers;
    mini.history[socket.playerId] = { 0: answers };
    socket.emit("petitBacAnswerAck");

    const activePlayers = room.players.filter((p) => !p.eliminated && !p.isSpectator);
    const allAnswered = activePlayers.every((p) => mini.playerAnswers[p.playerId]);

    if (allAnswered) {
      endPetitBacRound(roomCode);
    }
  });

  // -----------------------------------
  //      CORRECTION (LE JUGE)
  // -----------------------------------
  socket.on("correctionNavigate", ({ direction }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;
    const mini = room.gameState.currentMiniGameState;

    // Joue le son de flèche pour tout le monde
    io.to(socket.roomCode).emit("playCorrectionArrow");

    let newIndex = mini.gradingPlayerIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= room.activePlayersList.length) {
      newIndex = room.activePlayersList.length - 1;
    }

    mini.gradingPlayerIndex = newIndex;
    sendCorrectionData(socket.roomCode);
  });

  socket.on("hostGradePlayer", function (data = {}) {
    const { points, details } = data;
    const soundVal =
      typeof data === "object" && data !== null ? data.soundValue : null;
    if (soundVal !== undefined && soundVal !== null) {
      io.to(socket.roomCode).emit("playGradeSound", soundVal);
    }
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.playerId) return;

    const gs = room.gameState;
    const mini = gs.currentMiniGameState;
    if (!mini || !room.activePlayersList) return;

    const player = room.activePlayersList[mini.gradingPlayerIndex];

    if (!mini.scoresGiven) mini.scoresGiven = {};
    if (!mini.scoresGiven[mini.correctionIndex]) mini.scoresGiven[mini.correctionIndex] = {};
    
    if (!mini.timesApplied) mini.timesApplied = {};
    if (!mini.timesApplied[mini.correctionIndex]) mini.timesApplied[mini.correctionIndex] = {};

    const oldScore = mini.scoresGiven[mini.correctionIndex][player.playerId] || 0;
    const newScore = parseFloat(points);

    player.score = player.score - oldScore + newScore;
    player.roundScore = player.roundScore - oldScore + newScore;
    mini.scoresGiven[mini.correctionIndex][player.playerId] = newScore;

    let maxDuration = 40; // Valeur par défaut (Qui suis-je, Tour du monde, Blind test)
    if (mini.type === "petit_bac") {
      maxDuration = 120;
    } else if (mini.type === "le_bon_ordre") {
      maxDuration = LE_BON_ORDRE_DURATION;
    }
    const realTime = (mini.responseTimes && mini.responseTimes[player.playerId])
      ? mini.responseTimes[player.playerId]
      : maxDuration;

    let timeToApply;
    if (newScore > 0) {
      timeToApply = realTime;
    } else {
      timeToApply = maxDuration;
    }

    const oldTime = mini.timesApplied[mini.correctionIndex][player.playerId] || 0;
    player.roundTime = player.roundTime - oldTime + timeToApply;
    player.totalTime = player.totalTime - oldTime + timeToApply;
    mini.timesApplied[mini.correctionIndex][player.playerId] = timeToApply;

    if (mini.type === "petit_bac" && details) {
      if (!mini.gradingDetails) mini.gradingDetails = {};
      mini.gradingDetails[player.playerId] = details;
    }

    io.to(roomCode).emit("scoreUpdate", {
      players: room.players
        .filter((p) => !p.eliminated && !p.isSpectator)
        .map((p) => ({
          id: p.playerId,
          nickname: p.pseudo,
          score: p.roundScore || 0,
          time: p.roundTime || 0
        }))
    });

    sendCorrectionData(roomCode);
  });

  socket.on("correctionPrevQuestion", () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;
    const mini = room.gameState.currentMiniGameState;

    if (mini && mini.correctionIndex > 0) {
      mini.correctionIndex--;
      mini.gradingPlayerIndex = 0;
      sendCorrectionData(socket.roomCode);
    }
  });

  socket.on("correctionNextQuestion", () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;
    const mini = room.gameState.currentMiniGameState;

    const currentQuestionGrades = mini.scoresGiven[mini.correctionIndex] || {};
    const missingPlayer = room.activePlayersList.find(
      (p) => currentQuestionGrades[p.playerId] === undefined
    );

    if (missingPlayer) {
      socket.emit(
        "errorMessage",
        `Attention : Vous n'avez pas corrig� ${missingPlayer.pseudo} !`
      );
      return;
    }

    mini.correctionIndex++;
    mini.gradingPlayerIndex = 0;

    if (mini.correctionIndex >= mini.questions.length) {
    io.to(socket.roomCode).emit("scoreUpdate", {
      players: room.players
        .filter((p) => !p.eliminated && !p.isSpectator)
        .map((p) => ({
          id: p.playerId,
          nickname: p.pseudo,
          score: p.roundScore || 0,
          time: p.roundTime || 0
        }))
    });

      io.to(socket.roomCode).emit("leugtasReveal", {
        isLastQuestion: true,
        correctAnswerId: null,
        playerAnswers: null,
        skipAnimation: true
      });

      setTimeout(() => {
        io.to(socket.roomCode).emit("leBonOrdreExit");
        setTimeout(() => {
          endMiniGame(socket.roomCode);
        }, 3000);
      }, 5000);
    } else {
      sendCorrectionData(socket.roomCode);
    }
  });

  socket.on("endPetitBacCorrection", () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;

    io.to(socket.roomCode).emit("leugtasReveal", {
      isLastQuestion: true,
      correctAnswerId: null,
      playerAnswers: null,
      skipAnimation: true
    });

    setTimeout(() => {
      io.to(socket.roomCode).emit("leBonOrdreExit");
      setTimeout(() => {
        endMiniGame(socket.roomCode);
      }, 3000);
    }, 4500);
  });

  // ==========================================
  //        LOGIQUE : LES ENCHÈRES
  // ==========================================

  function finalizeThemeSelection(room) {
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;
    if (!mini || mini.subPhase !== "theme_selection") return;

    if (room.encheresInterval) {
      clearInterval(room.encheresInterval);
      room.encheresInterval = null;
    }
    if (mini.timer) mini.timer.running = false;

    const activePlayers = room.players.filter((p) => !p.eliminated && !p.isSpectator);
    activePlayers.forEach((p) => {
      if (!mini.playerVotes[p.playerId]) {
        const randomTheme = mini.themesAvailable[Math.floor(Math.random() * mini.themesAvailable.length)];
        mini.playerVotes[p.playerId] = randomTheme.id;
      }
    });

    const votes = Object.values(mini.playerVotes);
    let selectedThemeId = votes[0];
    if (votes.length > 1 && votes[0] !== votes[1]) {
      selectedThemeId = votes[Math.floor(Math.random() * votes.length)];
    }

    const pool = ENCHERES_QUESTIONS.filter((q) => q.theme_id === selectedThemeId);
    const question = pool[Math.floor(Math.random() * pool.length)] || ENCHERES_QUESTIONS[0];
    mini.question = question;

    io.to(room.roomCode).emit("encheresThemeAnim", {
      chosenThemeId: selectedThemeId,
      candidates: votes
    });

    setTimeout(() => {
      mini.subPhase = "bidding";
      io.to(room.roomCode).emit("encheresStartBidding", {
        themeId: selectedThemeId,
        questionText: question.question,
        duration: 60
      });

      startEncheresTimer(room.roomCode, 60, () => {
        let winnerId = mini.currentBidder;
        let winningBid = mini.currentMaxBid;
        if (!winnerId) {
          const active = room.players.filter((p) => !p.eliminated && !p.isSpectator);
          if (active.length > 0) {
            winnerId = active[0].playerId;
            winningBid = 1;
            mini.currentBidder = winnerId;
            mini.currentMaxBid = winningBid;
          }
        }

        io.to(room.roomCode).emit("encheresBidResult", {
          winnerId,
          amount: winningBid
        });

        setTimeout(() => {
          startEncheresCollection(room.roomCode);
        }, 4000);
      });
    }, 3500);
  }

  function startLesEncheres(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.gameState.currentMiniGameState = {
      type: "les_encheres",
      subPhase: "theme_selection",
      themesAvailable: ENCHERES_THEMES.slice(0, 3),
      playerVotes: {},
      question: null,
      bids: [],
      timer: null,
      currentBidder: null,
      currentMaxBid: 0,
      activePlayerId: null,
      targetScore: 0,
      answersGiven: [],
      validatedStatus: []
    };

    io.to(roomCode).emit("encheresSetup", {
      themes: ENCHERES_THEMES
    });

    // TIMER SÉLECTION (30s) -> Si fin, on finalise automatiquement
    startEncheresTimer(roomCode, 30, () => {
      finalizeThemeSelection(room);
    });
  }

  function startEncheresTimer(roomCode, duration, callback) {
    const room = rooms[roomCode];
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini) return;

    let remaining = duration;
    mini.timer = { total: duration, remaining: duration, running: true };

    if (room.encheresInterval) clearInterval(room.encheresInterval);

    room.encheresInterval = setInterval(() => {
      if (!mini.timer.running) {
        clearInterval(room.encheresInterval);
        return;
      }
      remaining--;
      io.to(roomCode).emit("encheresTimerUpdate", { remaining, total: duration });
      if (remaining <= 0) {
        clearInterval(room.encheresInterval);
        if (callback) callback();
      }
    }, 1000);
  }

  function startEncheresCollection(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini) return;

    mini.subPhase = "collecting";
    mini.activePlayerId = mini.currentBidder;

    io.to(roomCode).emit("encheresStartCollection", {
      activePlayerId: mini.activePlayerId,
      target: mini.currentMaxBid,
      duration: 60
    });

    startEncheresTimer(roomCode, 60, () => {
      mini.subPhase = "correction";
      io.to(roomCode).emit("encheresStartCorrection", {
        answers: mini.answersGiven,
        target: mini.currentMaxBid
      });
    });
  }

  function getOpponentId(room, playerId) {
    const active = room.players.filter((p) => !p.eliminated && !p.isSpectator);
    const opp = active.find((p) => p.playerId !== playerId);
    return opp ? opp.playerId : null;
  }

  socket.on("encheresVoteTheme", (themeId) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    
    // --- SÉCURITÉ AJOUTÉE ---
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    // ------------------------

    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.subPhase !== "theme_selection") return;

    mini.playerVotes[socket.playerId] = themeId;

    const activePlayers = room.players.filter(
      (p) => !p.eliminated && !p.isSpectator
    );

    if (activePlayers.every((p) => mini.playerVotes[p.playerId])) {
      finalizeThemeSelection(room);
    }
  });

  socket.on("encheresPlaceBid", (amount) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;

    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.subPhase !== "bidding") return;

    const val = parseInt(amount);
    if (val > mini.currentMaxBid) {
      // Vérifie si ce joueur a DÉJÀ enchéri auparavant dans ce round
      const hasBidBefore = mini.bids.some((b) => b.playerId === socket.playerId);

      let soundFile = null;

      // Si c'est sa PREMIÈRE enchère -> son "calme" (ex: calme_4.mp3)
      if (!hasBidBefore) {
        soundFile = `calme_${val}.mp3`;
      } else {
        // Si c'est une SURENCHÈRE -> son standard (ex: 4.mp3)
        soundFile = `${val}.mp3`;
      }

      mini.currentMaxBid = val;
      mini.currentBidder = socket.playerId;

      const bidData = {
        playerId: socket.playerId,
        amount: val,
        sound: soundFile // On envoie le nom du fichier au client
      };

      mini.bids.push(bidData);
      io.to(socket.roomCode).emit("encheresNewBid", bidData);
    }
  });

  socket.on("encheresSendAnswer", (text) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;

    const mini = room.gameState.currentMiniGameState;
    if (
      !mini ||
      mini.subPhase !== "collecting" ||
      socket.playerId !== mini.activePlayerId
    )
      return;

    const limit = mini.currentMaxBid + 1;
    if (mini.answersGiven.length >= limit) {
      return;
    }

    mini.answersGiven.push(text);
    mini.validatedStatus.push(null);

    io.to(socket.roomCode).emit("encheresLiveAnswerUpdate", {
      answers: mini.answersGiven,
      playSound: true // AJOUT : Déclenche le son chez tout le monde
    });
  });

  socket.on("encheresDeleteAnswer", (index) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (
      !mini ||
      mini.subPhase !== "collecting" ||
      socket.playerId !== mini.activePlayerId
    )
      return;

    if (typeof index === "number" && index >= 0 && index < mini.answersGiven.length) {
      mini.answersGiven.splice(index, 1);
      mini.validatedStatus.splice(index, 1);

      io.to(socket.roomCode).emit("encheresLiveAnswerUpdate", {
        answers: mini.answersGiven
      });
    }
  });

  socket.on("encheresToggleCorrection", ({ index, status }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.validatedStatus[index] === undefined) return;

    mini.validatedStatus[index] = status;

    // 1 = Vrai (correction_1point), 0 = Faux (correction_0point)
    const soundVal = status === true ? 1 : 0;

    io.to(socket.roomCode).emit("encheresCorrectionRefresh", {
      answers: mini.answersGiven,
      status: mini.validatedStatus,
      soundToPlay: soundVal // AJOUT : On dit aux clients quel son jouer
    });
  });

  socket.on("encheresFinalizeGame", () => {
    const room = rooms[socket.roomCode];
    if (!room || room.hostId !== socket.playerId) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini) return;

    const errors = mini.validatedStatus.filter((s) => s === false).length;
    const valids = mini.validatedStatus.filter((s) => s === true).length;
    const target = mini.currentMaxBid;

    const winnerId =
      valids >= target && errors <= 1
        ? mini.activePlayerId
        : getOpponentId(room, mini.activePlayerId);

    const winner = room.players.find((p) => p.playerId === winnerId);
    const winnerPseudo = winner ? winner.pseudo : "Inconnu";

    io.to(socket.roomCode).emit("encheresVictory", {
      winnerPseudo: winnerPseudo
    });

    setTimeout(() => {
      io.to(socket.roomCode).emit("gameOver", { winner: winnerPseudo });
    }, 6000);
  });
}); // <--- ICI : C'est la fermeture cruciale de io.on("connection")

function syncPlayerWithGame(socket, room) {
  if (!room || !room.gameState) return;
  const gs = room.gameState;
  // CORRECTIF : On regarde currentMiniGameState OU room.mini (pour le cas spécifique du Faux du Vrai)
  const mini = gs.currentMiniGameState || room.mini;

  if (gs.phase !== "playing" || !mini) return;

  // === GESTION DE LA CORRECTION (Si le jeu est fini) ===
  if (
    mini.finished &&
    ["qui_suis_je", "le_bon_ordre", "le_tour_du_monde", "blind_test", "petit_bac", "les_encheres"].includes(mini.type)
  ) {
    if (typeof mini.correctionIndex !== "undefined") {
      sendCorrectionData(room.roomCode, socket);
    } else {
      // Écrans de fin d'attente
      if (mini.type === "petit_bac") socket.emit("petitBacEnd");
      else if (mini.type === "blind_test") socket.emit("blindTestEnd");
      else if (mini.type === "le_tour_du_monde") socket.emit("leTourDuMondeEnd");
      else if (mini.type === "le_bon_ordre") socket.emit("leBonOrdreEnd");
      else if (mini.type === "qui_suis_je") socket.emit("quiSuisJeEnd");
    }
    return;
  }

  // === GESTION EN JEU (Classique) ===
  // 1. QUI SUIS-JE
  if (mini.type === "qui_suis_je") {
    const q = mini.questions[mini.questionIndex];
    if (q) {
      const safeQ = { ...q, image_question: q.image_question || q.image };
      socket.emit("quiSuisJeQuestion", { question: safeQ, index: mini.questionIndex + 1, total: mini.questions.length });
    }
    if (mini.timer && mini.timer.running) {
      socket.emit("quiSuisJeTimerUpdate", { remaining: mini.timer.remainingSeconds, total: mini.timer.totalSeconds });
    }
  }
  // 2. LE BON ORDRE
  else if (mini.type === "le_bon_ordre") {
    const q = mini.questions[mini.questionIndex];
    if (q) {
      const safeQ = { ...q, image_question: q.image_question || q.image };
      socket.emit("leBonOrdreQuestion", { question: safeQ, themeName: q.themeName, index: mini.questionIndex + 1, total: mini.questions.length });
    }
    if (mini.timer && mini.timer.running) {
      socket.emit("leBonOrdreTimerUpdate", { remaining: mini.timer.remainingSeconds, total: mini.timer.totalSeconds });
    }
  }
  // 3. LE TOUR DU MONDE
  else if (mini.type === "le_tour_du_monde") {
    const q = mini.questions[mini.questionIndex];
    if (q) {
      const safeQ = { ...q, image_question: q.image_question || q.image };
      socket.emit("leTourDuMondeQuestion", { question: safeQ, themeName: q.themeName, index: mini.questionIndex + 1, total: mini.questions.length });
    }
    if (mini.timer && mini.timer.running) {
      socket.emit("leTourDuMondeTimerUpdate", { remaining: mini.timer.remainingSeconds, total: mini.timer.totalSeconds });
    }
  }
  // 4. BLIND TEST
  else if (mini.type === "blind_test") {
    const q = mini.questions[mini.questionIndex];
    if (q) {
      socket.emit("blindTestQuestion", { question: q, themeName: q.themeName, index: mini.questionIndex + 1, total: mini.questions.length });
    }
    if (mini.timer && mini.timer.running) {
      socket.emit("blindTestTimerUpdate", { remaining: mini.timer.remainingSeconds, total: mini.timer.totalSeconds });
    }
  }
  // 5. LE FAUX DU VRAI
  else if (mini.type === "faux_vrai") {
    const q = mini.list ? mini.list[mini.index] : null;
    if (q) {
      socket.emit("fauxVraiQuestion", { 
        question: q.question, affirmations: q.affirmations, themeId: q.themeId, 
        indexFausse: q.indexFausse, duration: 40, index: mini.index + 1, total: mini.list.length, 
        isReload: true // FLAG IMPORTANT
      });
    }
  }
  // 6. QUI VEUT GAGNER DES LEUGTAS
  else if (mini.type === "qui_veut_gagner_des_leugtas") {
    const q = mini.questions[mini.questionIndex];
    socket.emit("leugtasQuestion", { 
      question: q, index: mini.questionIndex + 1, total: mini.questions.length, 
      isReload: true // FLAG IMPORTANT
    });
    if (mini.leugtasTimer && mini.leugtasTimer.running) {
      socket.emit("leugtasTimerUpdate", { remainingSeconds: mini.leugtasTimer.remainingSeconds, totalSeconds: mini.leugtasTimer.totalSeconds });
    }
  }
  // 7. PETIT BAC
  else if (mini.type === "petit_bac") {
    socket.emit("petitBacStart", { letter: mini.letter, categories: mini.categories, duration: 120 });
    if (mini.timer && mini.timer.running) {
      socket.emit("petitBacTimerUpdate", { remaining: mini.timer.remainingSeconds, total: 120 });
    }
  }
  // 8. LES ENCHERES
  else if (mini.type === "les_encheres") {
    if (mini.subPhase === "theme_selection") {
       const myVote = mini.playerVotes ? mini.playerVotes[socket.playerId] : null;
       socket.emit("encheresSetup", { themes: ENCHERES_THEMES, currentVote: myVote });
       if (mini.timer && mini.timer.running) {
         socket.emit("encheresTimerUpdate", { remaining: mini.timer.remainingSeconds || mini.timer.remaining, total: mini.timer.total || mini.timer.totalSeconds });
       }
    }
    else if (mini.subPhase === "bidding") {
      socket.emit("encheresStartBidding", { questionText: mini.question ? mini.question.question : "...", duration: 60 });
      mini.bids.forEach((bid) => socket.emit("encheresNewBid", bid));
    } else if (mini.subPhase === "collecting") {
      socket.emit("encheresStartCollection", { activePlayerId: mini.activePlayerId, target: mini.currentMaxBid, duration: 60 });
      socket.emit("encheresLiveAnswerUpdate", { answers: mini.answersGiven });
    } else if (mini.subPhase === "correction") {
      socket.emit("encheresStartCorrection", { answers: mini.answersGiven, target: mini.currentMaxBid });
      socket.emit("encheresCorrectionRefresh", { answers: mini.answersGiven, status: mini.validatedStatus });
    }
  }
}

// ===============================
//     START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Serveur lanc� sur le port", PORT);
});
/**
 * Enregistre le temps de r�ponse d'un joueur.
 * @param {Object} player - L'objet joueur
 * @param {Number} timeTaken - Temps mis (en secondes)
 * @param {Boolean} isCorrect - Si la r�ponse est bonne
 * @param {Number} maxDuration - Dur�e max du timer (p�nalit� si faux)
 */
function registerPlayerTime(player, timeTaken, isCorrect, maxDuration) {
  // R�gle : Bonne r�ponse = temps r�el. Mauvaise r�ponse = Max Duration.
  const finalTime = isCorrect ? timeTaken : maxDuration;
  
  player.roundTime += finalTime;
  player.totalTime += finalTime;
}

/**
 * R�initialise les stats du round pour tous les joueurs actifs.
 * � appeler au d�but de chaque mini-jeu.
 */
function resetRoundStats(room) {
  room.players.forEach(p => {
    p.roundScore = 0;
    p.roundTime = 0;
  });
}
