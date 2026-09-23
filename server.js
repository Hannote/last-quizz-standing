// server.js
// Last Quizz Standing - Tirage au sort animé + règles + prêts
// + mini-jeu Leugtas phase 2.4 (envoi question au client).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const {
  calculateGradeRevision,
  getQuestionResponseTime,
  rankTournamentPlayers,
  recordQuestionResponseTime,
  settleListeRound,
  validateManualGrade
} = require("./liste-tournament");

// ============================================================
//   SYSTÈME DE MÉMOIRE (PERSISTENCE DES QUESTIONS JOUÉES)
// ============================================================

// 1. Définition intelligente du dossier
// Par défaut, on se met en mode "Local" (sur ton ordi)
let DATA_DIR = path.join(__dirname, "data"); 

// On vérifie si un Volume Railway est monté à la racine "/data"
if (fs.existsSync("/data")) {
    DATA_DIR = "/data";
    console.log("[STORAGE] Mode Railway détecté : Utilisation du volume sécurisé /data");
} else {
    console.log("[STORAGE] Mode Local : Utilisation du dossier ./data");
}

// 2. Création du dossier local si besoin (sur ton ordi uniquement)
if (DATA_DIR !== "/data" && !fs.existsSync(DATA_DIR)){
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch(e) {
        console.log("Info: Impossible de créer le dossier data local.");
    }
}

const HISTORY_FILE = path.join(DATA_DIR, "played_questions_history.json");

// 3. Lire l'historique
function getPlayedHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

// 4. Sauvegarder l'historique
function savePlayedHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error("Erreur sauvegarde historique:", e);
  }
}

// 5. Récupérer les questions NON jouées
function getUnusedQuestions(allQuestions, gameName) {
  const history = getPlayedHistory();
  const playedIds = history[gameName] || [];
  return allQuestions.filter(q => !playedIds.includes(q.id));
}

// 6. Marquer des questions comme jouées
function markQuestionsAsPlayed(questionsObjArray, gameName) {
  const history = getPlayedHistory();
  if (!history[gameName]) history[gameName] = [];

  questionsObjArray.forEach(q => {
    if (q.id && !history[gameName].includes(q.id)) {
      history[gameName].push(q.id);
    }
  });
  savePlayedHistory(history);
}

// 7. Reset forcé d'un jeu spécifique
function resetGameHistory(gameName) {
  const history = getPlayedHistory();
  history[gameName] = [];
  savePlayedHistory(history);
  console.log(`[RESET] Historique vidé pour : ${gameName}`);
}


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
  "Entraineur de foot (connaître au moins un club qu'il a entraîné)",
  "Club de foot",
  "Acteur ou Actrice",
  "Dessin animé / Manga",
  "Jeu vidéo",
  "Métier",
  "Pays",
  "Plat",
  "Fruit ou légume",
  "Animal",
  "Joueur ayant gagné la ligue des champions",
  "Chanteur / Groupe de musique",
  "Ville de France"
];

const quiSuisJeData = require(
  path.join(__dirname, "public_2", "qui_suis_je", "qui_suis_je.json")
);
const QUI_SUIS_JE_QUESTIONS = quiSuisJeData.questions || [];

// --- CHARGEMENT DES DONN?ES MANQUANTES ---

// 1. LES ENCH?RES
const lesEncheresData = require(
  path.join(__dirname, "public_2", "les_encheres", "les_encheres.json")
);
const ENCHERES_QUESTIONS = lesEncheresData.questions || [];
const ENCHERES_THEMES = lesEncheresData.themes || [];

// 2. QUI VEUT GAGNER DES LEUGTAS
const leugtasData = require(
  path.join(
    __dirname,
    "public_2",
    "qui_veut_gagner_des_leugtas",
    "qui_veut_gagner_des_leugtas.json"
  )
);
const LEUGTAS_QUESTIONS = leugtasData.questions || [];

// 3. LE FAUX DU VRAI
const fauxVraiRaw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "public_2", "le_faux_du_vrai", "le_faux_du_vrai.json"),
    "utf8"
  )
);
const fauxVraiThemes = fauxVraiRaw.themes || [];
const fauxVraiQuestions = fauxVraiRaw.questions || [];


function pickLeugtasQuestionsByPaliers() {
  let available = getUnusedQuestions(LEUGTAS_QUESTIONS, "leugtas");
  
  // Vérif: A-t-on au moins une question pour chaque palier (1 à 8) ?
  let missing = false;
  for (let p = 1; p <= 8; p++) {
    if (!available.some(q => q.theme_id === "palier_" + p)) {
      missing = true;
      break;
    }
  }

  if (missing) {
    resetGameHistory("leugtas");
    available = LEUGTAS_QUESTIONS; // On repart sur le full set
  }

  const result = [];
  for (let p = 1; p <= 8; p++) {
    const theme = "palier_" + p;
    const pool = available.filter((q) => q.theme_id === theme);
    if (pool.length === 0) return null; // Sécurité
    
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool[index]);
  }

  markQuestionsAsPlayed(result, "leugtas");
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
const FAUX_VRAI_TIMER_DURATION = 45;
const LE_BON_ORDRE_DURATION = 45;

// Catalogue Liste indépendant du tirage et du bac à sable Battle Royale.
const MINI_GAME_CATALOG = [
  { id: "qui_suis_je", label: "Qui suis-je ?", modes: ["battle_royale", "liste"] },
  { id: "blind_test", label: "Blind test", modes: ["battle_royale", "liste"] },
  { id: "le_tour_du_monde", label: "Le tour du monde", modes: ["battle_royale", "liste"] },
  { id: "le_bon_ordre", label: "Le bon ordre", modes: ["battle_royale", "liste"] },
  { id: "petit_bac", label: "Le petit bac", modes: ["battle_royale", "liste"] },
  { id: "qui_veut_gagner_des_leugtas", label: "Qui veut gagner des leugtas ?", modes: ["battle_royale", "liste"] },
  { id: "le_faux_du_vrai", label: "Le faux du vrai", modes: ["battle_royale", "liste"] },
  { id: "les_encheres", label: "Les Enchères", modes: ["battle_royale"] }
];

function getListeOptions() {
  const miniGames = MINI_GAME_CATALOG.filter((game) => game.modes.includes("liste"));
  return { minGames: 1, maxGames: miniGames.length, miniGames };
}

function validateListeConfig(data) {
  const { minGames, maxGames, miniGames } = getListeOptions();
  if (!Number.isInteger(data?.gameCount) || data.gameCount < minGames || data.gameCount > maxGames) {
    return { error: `Choisissez un nombre entier de mini-jeux entre ${minGames} et ${maxGames}.` };
  }
  if (data.selectionMethod !== "random" && data.selectionMethod !== "manual") {
    return { error: "Choisissez la méthode Aléatoire ou Manuel." };
  }
  const selected = data.selectedMiniGames;
  if (!Array.isArray(selected)) {
    return { error: "La sélection de mini-jeux doit être une liste." };
  }
  const compatibleIds = new Set(miniGames.map((game) => game.id));
  if (selected.some((id) => !compatibleIds.has(id))) {
    return { error: "La sélection contient un mini-jeu inconnu ou incompatible avec Liste." };
  }
  if (new Set(selected).size !== selected.length) {
    return { error: "Un mini-jeu ne peut être sélectionné qu'une seule fois." };
  }
  if (data.selectionMethod === "random" && selected.length !== 0) {
    return { error: "En mode Aléatoire, ne fournissez aucune sélection manuelle." };
  }
  if (data.selectionMethod === "manual" && selected.length !== data.gameCount) {
    return { error: `Sélectionnez exactement ${data.gameCount} mini-jeux.` };
  }
  return {
    config: {
      gameCount: data.gameCount,
      selectionMethod: data.selectionMethod,
      // Ordre du catalogue uniquement : le client ne définit pas l'ordre de passage.
      selectedMiniGames: miniGames.filter((game) => selected.includes(game.id)).map((game) => game.id)
    }
  };
}

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

// Gestion des participants Liste, sans démarrage de mini-jeu ni effet réseau.
function isListeParticipant(room, player) {
  return !!player && !player.withdrawn && !player.isSpectator &&
    (!room.listeTournament.started || room.listeTournament.initialParticipantIds.includes(player.playerId));
}

function canUseMiniGameSocket(room, player, socket) {
  if (room.gameMode !== "liste") return true;
  return isListeParticipant(room, player) && player.socketId === socket.id &&
    player.playerId === socket.playerId && room.roomCode === socket.roomCode;
}

function isActiveMiniGamePlayer(room, player) {
  return room.gameMode === "liste"
    ? isListeParticipant(room, player)
    : !player.eliminated && !player.isSpectator;
}

function createListeTournamentState() {
  return {
    started: false,
    initialParticipantIds: [],
    initialParticipantCount: 0,
    roundResults: []
  };
}

function initializePlayerTournamentStats(player) {
  player.tournamentPoints = 0;
  player.tournamentTime = 0;
  player.tournamentPlacements = [];
}

function ensurePlayerTournamentStats(player) {
  if (!Number.isFinite(player.tournamentPoints)) player.tournamentPoints = 0;
  if (!Number.isFinite(player.tournamentTime)) player.tournamentTime = 0;
  if (!Array.isArray(player.tournamentPlacements)) player.tournamentPlacements = [];
}

function getListeGeneralRanking(room) {
  if (!room.listeTournament.started) return [];
  const initialIds = new Set(room.listeTournament.initialParticipantIds);
  return rankTournamentPlayers(room.players.filter((player) =>
    initialIds.has(player.playerId) && !player.isSpectator));
}

// Prépare et fige le résultat d'une manche. Son appel dans le déroulement Liste
// restera du ressort de l'étape 5, avant toute remise à zéro des stats de manche.
function finalizeListeMiniGameResult(room, roundKey) {
  if (room.gameMode !== "liste" || !room.listeTournament.started) {
    return { error: "Aucun tournoi Liste n'est actif." };
  }
  const gs = room.gameState;
  if (!gs?.currentMiniGame || !Number.isInteger(gs.roundNumber) || gs.roundNumber < 1) {
    return { error: "La manche Liste à finaliser est invalide." };
  }

  const initialIds = new Set(room.listeTournament.initialParticipantIds);
  const participants = room.players.filter((player) => initialIds.has(player.playerId));
  participants.forEach(ensurePlayerTournamentStats);
  const settlement = settleListeRound({
    roundKey,
    roundNumber: gs.roundNumber,
    miniGame: gs.currentMiniGame,
    initialParticipantCount: room.listeTournament.initialParticipantCount,
    players: participants,
    previousRoundResults: room.listeTournament.roundResults
  });

  if (!settlement.applied) return settlement;
  const updatesById = new Map(settlement.playerUpdates.map((update) => [update.playerId, update]));
  participants.forEach((player) => {
    const update = updatesById.get(player.playerId);
    if (!update) return;
    player.tournamentPoints = update.tournamentPoints;
    player.tournamentTime = update.tournamentTime;
    player.tournamentPlacements = update.tournamentPlacements;
  });
  room.listeTournament.roundResults.push(settlement.roundResult);
  return { ...settlement, generalRanking: getListeGeneralRanking(room) };
}

function rememberManualResponseTime(mini, playerId, timeTaken) {
  mini.responseTimesByQuestion = recordQuestionResponseTime(
    mini.responseTimesByQuestion,
    mini.questionIndex || 0,
    playerId,
    timeTaken
  );
}

function initializeListeParticipants(room) {
  if (room.gameMode !== "liste" || room.listeTournament.started) return false;
  const ids = room.players.filter((p) => p.isConnected && isListeParticipant(room, p)).map((p) => p.playerId);
  if (ids.length === 0) return false;
  room.players.filter((player) => ids.includes(player.playerId)).forEach(initializePlayerTournamentStats);
  room.listeTournament = {
    started: true,
    initialParticipantIds: [...new Set(ids)],
    initialParticipantCount: new Set(ids).size,
    roundResults: []
  };
  ensureListeHost(room);
  return true;
}

function canJoinListeRoom(room, playerId) {
  return !room.listeTournament.started ||
    (room.listeTournament.initialParticipantIds.includes(playerId) &&
      room.players.some((p) => p.playerId === playerId));
}

function ensureListeHost(room) {
  const eligible = room.players.filter((p) => p.isConnected && isListeParticipant(room, p));
  if (!eligible.some((p) => p.playerId === room.hostId)) {
    room.hostId = eligible[0]?.playerId || null;
  }
}

function pruneListeCorrectionPlayers(room) {
  if (room.gameMode !== "liste" || !room.activePlayersList) return;
  const mini = room.gameState?.currentMiniGameState;
  const index = mini?.gradingPlayerIndex || 0;
  const currentId = room.activePlayersList[index]?.playerId;
  room.activePlayersList = room.activePlayersList.filter((p) => isListeParticipant(room, p));
  if (mini && Number.isInteger(mini.gradingPlayerIndex)) {
    const preservedIndex = room.activePlayersList.findIndex((p) => p.playerId === currentId);
    mini.gradingPlayerIndex = preservedIndex >= 0 ? preservedIndex
      : Math.max(0, Math.min(index, room.activePlayersList.length - 1));
  }
}

function disconnectListePlayer(room, playerId, socketId) {
  if (room.gameMode !== "liste") return false;
  const player = room.players.find((p) => p.playerId === playerId);
  // Un ancien socket ne doit pas déconnecter une identité déjà reconnectée.
  if (!player || player.socketId !== socketId) return false;
  player.isConnected = false;
  player.socketId = null;
  player.id = null;
  ensureListeHost(room);
  return true;
}

function withdrawListeParticipant(room, playerId, socketId) {
  if (room.gameMode !== "liste" || !room.listeTournament.started) return false;
  const player = room.players.find((p) => p.playerId === playerId);
  if (!player || player.socketId !== socketId || !room.listeTournament.initialParticipantIds.includes(playerId)) return false;
  player.withdrawn = true;
  delete room.gameState?.readyPlayers?.[playerId];
  pruneListeCorrectionPlayers(room);
  disconnectListePlayer(room, playerId, socketId);
  return true;
}

function getGameStateSummary(room) {
  const gs = room.gameState || createInitialGameState();
  return {
    gameMode: room.gameMode,
    phase: gs.phase,
    roundNumber: gs.roundNumber,
    currentMiniGame: gs.currentMiniGame,
    readyPlayerIds: Object.keys(gs.readyPlayers || {}).filter((id) => room.gameMode !== "liste" ||
      isListeParticipant(room, room.players.find((p) => p.playerId === id)))
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

  let available = getUnusedQuestions(fauxVraiQuestions, "faux_vrai");

  // Définition des pools par thème
  const getPool = (list, tid) => list.filter(q => q.themeId === tid);
  const getMixedPool = (list) => list.filter(q => [2, 5, 9].includes(q.themeId));

  // Vérification des Quotas : 2(Id1), 1(Id4), 1(Id6), 2(Id8), 1(Mixte)
  const ok1 = getPool(available, 1).length >= 2;
  const ok4 = getPool(available, 4).length >= 1;
  const ok6 = getPool(available, 6).length >= 1;
  const ok8 = getPool(available, 8).length >= 2;
  const okMix = getMixedPool(available).length >= 1;

  if (!ok1 || !ok4 || !ok6 || !ok8 || !okMix) {
    resetGameHistory("faux_vrai");
    available = fauxVraiQuestions;
  }

  const pickFromPool = (pool, count) => {
    return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  };

  const selected = [
    ...pickFromPool(getPool(available, 1), 2),
    ...pickFromPool(getPool(available, 4), 1),
    ...pickFromPool(getPool(available, 6), 1),
    ...pickFromPool(getPool(available, 8), 2),
    ...pickFromPool(getMixedPool(available), 1)
  ];

  markQuestionsAsPlayed(selected, "faux_vrai");

  const finalQuestions = selected.sort(() => Math.random() - 0.5);

  room.mini = {
    type: "faux_vrai",
    list: finalQuestions,
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
  game.remainingSeconds = total;
  game.totalSeconds = total;

  game.timer = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) {
      remaining = 0;
    }
    game.remainingSeconds = remaining;

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
    if (!isActiveMiniGamePlayer(room, player)) return;

    const socketId = player.socketId;
    const answerIndex = game.answers[player.playerId];
    const isCorrect =
      typeof answerIndex === "number" && answerIndex === indexFausse;

    if (isCorrect) {
      player.score = (player.score || 0) + 1;
      player.roundScore += 1;
    }

    const savedTime = game.answerTimes?.[player.playerId];
    const realTime = Number.isFinite(savedTime) ? savedTime : maxDuration;
    const timeTaken = isCorrect ? realTime : maxDuration;
    registerPlayerTime(player, timeTaken, isCorrect, maxDuration);
  });

  const isLastQuestion = game.index >= game.list.length - 1;

  room.players.forEach((player) => {
    const socketId = player.socketId;
    const answerIndex = game.answers[player.playerId];

    io.to(socketId).emit("fauxVraiReveal", {
      indexFausse,
      playerChoice:
        typeof answerIndex === "number" ? answerIndex : null,
      isLastQuestion
    });
  });

  io.to(roomCode).emit("scoreUpdate", {
    players: room.players
      .filter((p) => isActiveMiniGamePlayer(room, p))
      .map((p) => ({
        id: p.playerId,
        nickname: p.pseudo,
        score: p.roundScore || 0,
        time: p.roundTime || 0
      }))
  });

  // Passage de 8500 à 7000 pour isLastQuestion afin d'aligner avec l'animation client
  const waitTime = isLastQuestion ? 7000 : 5500;

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
    }, 7000); // Augment� � 7s

    return;
  }

  game.answers = {};
  game.answerTimes = {};
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
  const activePlayers = room.players.filter(p => isActiveMiniGamePlayer(room, p));
  
  console.log(`Fin du jeu. Survivants: ${activePlayers.length}`);

  if (activePlayers.length <= 1) {
    // VICTOIRE
    const winner = activePlayers[0] || { pseudo: "Personne" };
    io.to(roomCode).emit("gameOver", { winner: winner.pseudo });

    // FERMETURE AUTOMATIQUE
    setTimeout(() => {
      if (rooms[roomCode]) {
        console.log(`Fermeture auto de la salle ${roomCode}`);
        // Deconnecte proprement tous les sockets de la room
        io.in(roomCode).disconnectSockets();
        // Supprime la room
        delete rooms[roomCode];
      }
    }, 22000); // 20 secondes
    return;
  }

  if (activePlayers.length === 2) {
    console.log(`Salle ${roomCode} : Finale d?tect?e, lancement de l'animation.`);
    
    // On r?cup?re les pseudos des deux finalistes
    const p1 = activePlayers[0].pseudo;
    const p2 = activePlayers[1].pseudo;

    // On envoie le signal aux clients
    io.to(roomCode).emit("playFinaleAnimation", { player1: p1, player2: p2 });

    // On attend 32 secondes (dur?e de l'animation + dialogue) avant de passer aux r?gles
    setTimeout(() => {
        if (!rooms[roomCode]) return;

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
    }, 23000); 

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
  const activePlayers = room.players.filter(p => isActiveMiniGamePlayer(room, p));
  
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

  // En Liste, seuls les participants encore actifs reçoivent la pénalité d'absence.
  room.players.forEach((player) => {
    if (room.gameMode === "liste" && !isListeParticipant(room, player)) return;
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
      .filter((pl) => isActiveMiniGamePlayer(room, pl))
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
    }, 7000); // Augment� � 7s pour laisser l'�limination se faire
  };

  const waitTime = isLastQuestion ? 7700 : 5500;

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
  const roundResults = room.listeTournament.roundResults || [];
  return {
    roomCode: room.roomCode,
    gameMode: room.gameMode,
    listeOptions: getListeOptions(),
    listeTournament: {
      ...room.listeTournament,
      initialParticipantIds: [...room.listeTournament.initialParticipantIds],
      roundResults: roundResults.map((result) => ({
        ...result,
        placements: result.placements.map((placement) => ({ ...placement }))
      })),
      generalRanking: getListeGeneralRanking(room)
    },
    listeConfig: {
      ...room.listeConfig,
      selectedMiniGames: [...room.listeConfig.selectedMiniGames],
      isValid: !validateListeConfig(room.listeConfig).error
    },
    hostId: room.hostId,
    players: room.players.map((p) => ({
      playerId: p.playerId,
      pseudo: p.pseudo,
      isConnected: p.isConnected,
      eliminated: p.eliminated,
      withdrawn: p.withdrawn,
      isSpectator: p.isSpectator,
      tournamentPoints: p.tournamentPoints || 0,
      tournamentTime: p.tournamentTime || 0,
      tournamentPlacements: (p.tournamentPlacements || []).map((placement) => ({ ...placement }))
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
  let available = getUnusedQuestions(LE_BON_ORDRE_QUESTIONS, "le_bon_ordre");

  // Vérif: A-t-on au moins une question dispo pour CHAQUE thème requis ?
  const isDeckComplete = LE_BON_ORDRE_THEMES.every(theme => {
    return available.some(q => q.theme_id === theme.id);
  });

  if (!isDeckComplete) {
    resetGameHistory("le_bon_ordre");
    available = LE_BON_ORDRE_QUESTIONS;
  }

  const selectedQuestions = [];
  LE_BON_ORDRE_THEMES.forEach((theme) => {
    const pool = available.filter((q) => q.theme_id === theme.id);
    if (pool.length > 0) {
      const randomQ = pool[Math.floor(Math.random() * pool.length)];
      const qClone = { ...randomQ, themeName: theme.name };
      selectedQuestions.push(qClone);
    }
  });
  
  markQuestionsAsPlayed(selectedQuestions, "le_bon_ordre");
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
  room.activePlayersList = room.gameMode === "liste"
    ? room.players.filter((p) => isListeParticipant(room, p))
    : room.players.filter((p) => !p.eliminated && !p.isSpectator);

  sendCorrectionData(roomCode);
}

function sendCorrectionData(roomCode, targetSocket = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  if (!gs) return;
  const mini = gs.currentMiniGameState;

  if (room.gameMode === "liste") {
    pruneListeCorrectionPlayers(room);
    if (room.activePlayersList?.length === 0) {
      const target = targetSocket || io.to(roomCode);
      target.emit("correctionUpdate", { gameMode: "liste", roomCode, empty: true });
      return;
    }
  }

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

  // --- FIX : AJOUT DU GARDE-FOU ICI ---
  if (!q) {
      console.log(`[DEBUG] Correction termin�e ou index invalide (${mini.correctionIndex}). Annulation de l'envoi.`);
      return; 
  }
  // ------------------------------------

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
  let available = getUnusedQuestions(BLIND_TEST_QUESTIONS, "blind_test");

  const tvPool = available.filter(q => ["television", "television_g"].includes(q.theme_id));
  const musicPool = available.filter(q => ["musique", "music"].includes(q.theme_id));

  // On veut 2 TV et 6 Musique
  if (tvPool.length < 2 || musicPool.length < 6) {
    resetGameHistory("blind_test");
    // On recharge tout depuis le JSON original
    const allTv = BLIND_TEST_QUESTIONS.filter(q => ["television", "television_g"].includes(q.theme_id));
    const allMusic = BLIND_TEST_QUESTIONS.filter(q => ["musique", "music"].includes(q.theme_id));
    
    var rawGameSet = [
        ...allTv.sort(() => 0.5 - Math.random()).slice(0, 2),
        ...allMusic.sort(() => 0.5 - Math.random()).slice(0, 6)
    ].sort(() => 0.5 - Math.random());
    
    markQuestionsAsPlayed(rawGameSet, "blind_test");
  } else {
    var rawGameSet = [
        ...tvPool.sort(() => 0.5 - Math.random()).slice(0, 2),
        ...musicPool.sort(() => 0.5 - Math.random()).slice(0, 6)
    ].sort(() => 0.5 - Math.random());
    
    markQuestionsAsPlayed(rawGameSet, "blind_test");
  }

  return rawGameSet.map(q => {
    const theme = BLIND_TEST_THEMES.find((th) => th.id === q.theme_id);
    return {
      ...q,
      themeName: theme ? theme.name : "Thème inconnu",
      text: q.question,               
      audio: q.audio_question,        
      reponse: q.reponse_texte,       
      answer: q.reponse_texte,        
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
  let available = getUnusedQuestions(TOUR_MONDE_QUESTIONS, "le_tour_du_monde");

  // Vérif: CHAQUE thème (continent) doit avoir du stock
  const isDeckComplete = TOUR_MONDE_THEMES.every(theme => {
    return available.some(q => q.themeId === theme.id);
  });

  if (!isDeckComplete) {
    resetGameHistory("le_tour_du_monde");
    available = TOUR_MONDE_QUESTIONS;
  }

  const selectedQuestions = [];
  TOUR_MONDE_THEMES.forEach((theme) => {
    const pool = available.filter((q) => q.themeId === theme.id);
    if (pool.length > 0) {
      const randomQ = pool[Math.floor(Math.random() * pool.length)];
      const qClone = { ...randomQ, themeName: theme.nom };
      selectedQuestions.push(qClone);
    }
  });

  markQuestionsAsPlayed(selectedQuestions, "le_tour_du_monde");
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
  let available = getUnusedQuestions(QUI_SUIS_JE_QUESTIONS, "qui_suis_je");

  if (available.length < 8) {
    resetGameHistory("qui_suis_je");
    available = QUI_SUIS_JE_QUESTIONS;
  }

  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 8);

  markQuestionsAsPlayed(selected, "qui_suis_je");
  return selected;
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

  // --- SÉCURITÉ 1 : On tue le timer s'il tourne déjà ---
  if (room.petitBacInterval) {
      clearInterval(room.petitBacInterval);
      room.petitBacInterval = null;
  }

  // --- SÉCURITÉ 2 : On annule tout démarrage en attente (Le CORRECTIF est ici) ---
  if (room.petitBacStartTimeout) {
      clearTimeout(room.petitBacStartTimeout);
      room.petitBacStartTimeout = null;
  }
  // -----------------------------------------------------------------------------

  const gs = room.gameState;
  
  // FILTRAGE DES LETTRES
  const alphabet = "ABCDEFGHIJLMNOPRSTUV"; 
  const history = getPlayedHistory();
  const playedLetters = history["petit_bac"] || [];
  let availableLetters = alphabet.split('').filter(l => !playedLetters.includes(l));
  
  if (availableLetters.length === 0) {
      resetGameHistory("petit_bac");
      availableLetters = alphabet.split('');
  }

  const letter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
  markQuestionsAsPlayed([{id: letter}], "petit_bac");

  const selectedCategories = PETIT_BAC_CATEGORIES
    .sort(() => 0.5 - Math.random())
    .slice(0, 9);

  gs.currentMiniGameState = {
    type: "petit_bac",
    letter,
    categories: selectedCategories,
    playerAnswers: {},
    finished: false,
    timer: null,
    questions: [{ text: "Grille Petit Bac" }],
    questionIndex: 0,
    history: {},
    scoresGiven: {},
    gradingDetails: {}
  };

  io.to(roomCode).emit("petitBacStart", {
    letter,
    categories: selectedCategories,
    duration: 150
  });

  // On stocke le timeout pour pouvoir l'annuler si la fonction est rappelée
  room.petitBacStartTimeout = setTimeout(() => {
    startPetitBacTimer(room);
  }, 2500);
}

function startPetitBacTimer(room) {
  const roomCode = room.roomCode;
  const mini = room.gameState.currentMiniGameState;
  
  // Sécurité : si le jeu a changé ou n'existe plus
  if (!mini || mini.type !== "petit_bac") return;

  const DURATION = 150; 

  let remaining = DURATION;
  
  mini.timer = { 
    totalSeconds: DURATION, 
    remainingSeconds: DURATION, 
    running: true 
  };
  mini.startTime = Date.now();

  io.to(roomCode).emit("petitBacTimerUpdate", { remaining, total: DURATION });

  if (room.petitBacInterval) clearInterval(room.petitBacInterval);

  room.petitBacInterval = setInterval(() => {
    if (!mini.timer || !mini.timer.running) {
      clearInterval(room.petitBacInterval);
      return;
    }

    remaining--;
    mini.timer.remainingSeconds = remaining;

    io.to(roomCode).emit("petitBacTimerUpdate", { remaining, total: DURATION });

    if (remaining <= 0) {
      clearInterval(room.petitBacInterval);
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
      gameMode: "battle_royale",
      listeConfig: { gameCount: null, selectionMethod: null, selectedMiniGames: [] },
      listeTournament: createListeTournamentState(),
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
      withdrawn: false,
      isSpectator: false,
      
      // --- NOUVELLES STATS BATTLE ROYALE ---
      score: 0,           // Score global (Cosmétique / Classement général)
      roundScore: 0,      // Score du mini-jeu en cours (Pour l'élimination)
      totalTime: 0,       // Temps cumulé global (Départage)
      roundTime: 0,       // Temps cumulé sur le mini-jeu en cours
      tournamentPoints: 0,
      tournamentTime: 0,
      tournamentPlacements: [],
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

    if (room.gameMode === "liste" && !canJoinListeRoom(room, playerId)) {
      return socket.emit("errorMessage", "Ce tournoi Liste a déjà commencé. Seuls ses participants initiaux peuvent se reconnecter.");
    }

    let player = room.players.find((p) => p.playerId === playerId);

    if (player) {
      player.socketId = socket.id;
      player.id = socket.id;
      player.isConnected = true;
      player.pseudo = pseudo;
      ensurePlayerTournamentStats(player);
    } else {
      player = {
        playerId,
        id: socket.id,
        pseudo,
        socketId: socket.id,
        isConnected: true,
        eliminated: false,
        withdrawn: false,
        isSpectator: false,
        
        // --- NOUVELLES STATS BATTLE ROYALE ---
        score: 0,           // Score global (Cosmétique / Classement général)
        roundScore: 0,      // Score du mini-jeu en cours (Pour l'élimination)
        totalTime: 0,       // Temps cumulé global (Départage)
        roundTime: 0,       // Temps cumulé sur le mini-jeu en cours
        tournamentPoints: 0,
        tournamentTime: 0,
        tournamentPlacements: [],
        // -------------------------------------
      };
      room.players.push(player);
    }

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;
    socket.room = roomCode;
    if (room.gameMode === "liste") ensureListeHost(room);

    socket.emit("roomJoined", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    syncPlayerWithGame(socket, room);
  });

  // -----------------------------------
  //         HOST SET GAME MODE (LOBBY)
  // -----------------------------------
  socket.on("hostSetGameMode", (data) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const host = room.players.find((p) => p.playerId === room.hostId);
    if (room.hostId !== socket.playerId || host?.socketId !== socket.id) {
      return socket.emit("errorMessage", "Seul l'hôte peut modifier le mode de jeu.");
    }
    if (room.gameState?.phase !== "idle" || room.listeTournament.started) {
      return socket.emit("errorMessage", "Le mode ne peut plus être modifié après le lancement.");
    }
    if (data?.gameMode !== "battle_royale" && data?.gameMode !== "liste") {
      return socket.emit("errorMessage", "Mode de jeu invalide.");
    }

    room.gameMode = data.gameMode;
    io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
    io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  });

  // -----------------------------------
  //         HOST VALIDATE LISTE CONFIG (LOBBY)
  // -----------------------------------
  socket.on("hostValidateListeConfig", (data) => {
    const reject = (message) => socket.emit("listeConfigResult", { gameMode: "liste", roomCode: socket.roomCode, ok: false, message });
    const room = rooms[socket.roomCode];
    if (!room) return reject("La salle n'existe plus. Rejoignez une salle.");
    const host = room.players.find((p) => p.playerId === room.hostId);
    if (room.hostId !== socket.playerId || host?.socketId !== socket.id) {
      return reject("Seul l'hôte connecté peut modifier la configuration Liste.");
    }
    if (room.gameState?.phase !== "idle" || room.listeTournament.started) {
      return reject("La configuration ne peut plus être modifiée après le lancement.");
    }
    if (room.gameMode !== "liste") {
      return reject("Sélectionnez le mode Liste avant de le configurer.");
    }
    const result = validateListeConfig(data);
    if (result.error) return reject(result.error);

    room.listeConfig = result.config;
    io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
    socket.emit("listeConfigResult", { gameMode: "liste", roomCode: room.roomCode, ok: true, message: "Configuration Liste validée." });
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

    if (room.gameMode === "liste") {
      return socket.emit("errorMessage", "Le mode Liste n'est pas encore disponible. Choisissez Battle Royale pour lancer une partie.");
    }

    const gs = room.gameState;
    if (gs.phase !== "idle") return;
    const activePlayers = room.players.filter((p) => !p.eliminated);

    // Vérification du nombre de joueurs (min 3 sauf si forcé)
    if (activePlayers.length < 3 && !data?.forcedMiniGame) {
       return socket.emit("errorMessage", "Il faut au moins 3 joueurs pour lancer une partie.");
    }

    // --- LOGIQUE INTRO ---
    gs.phase = "intro";
    gs.roundNumber = 1;
    gs.currentMiniGame = null;

    const playerCount = activePlayers.length;
    
    // Déclenche l'animation chez les clients avec le nb de joueurs
    io.to(roomCode).emit("playIntroAnimation", { playerCount: playerCount });
    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));

    // Durée de l'animation (29s) avant de lancer le tirage au sort
    const INTRO_DURATION_MS = 32500; 

    setTimeout(() => {
        if (rooms[roomCode] !== room || room.gameState !== gs ||
            room.gameMode !== "battle_royale" || gs.phase !== "intro" || gs.roundNumber !== 1) return;

        const forcedMiniGame = POSSIBLE_MINI_GAMES.includes(data?.forcedMiniGame)
          ? data.forcedMiniGame
          : null;
    
        gs.currentMiniGame = forcedMiniGame || pickRandomMiniGame(room);
        gs.miniGamesAlreadyPlayed.push(gs.currentMiniGame);
        gs.phase = "drawingGame";
        gs.readyPlayers = {};
    
        console.log(`Salle ${roomCode} : Fin intro -> round ${gs.roundNumber}, mini-jeu = ${gs.currentMiniGame}`);
    
        io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
    }, INTRO_DURATION_MS);
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

    if (room.gameMode === "liste") {
      const player = room.players.find((p) => p.playerId === playerId);
      if (!room.listeTournament.started || !isListeParticipant(room, player) || player.socketId !== socket.id) return;
      if (data?.isReady) gs.readyPlayers[playerId] = true;
      else delete gs.readyPlayers[playerId];
      io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
      return; // Le démarrage des mini-jeux Liste sera intégré à l'étape 5.
    }

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
    if (!canUseMiniGameSocket(room, player, socket)) return;

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
      (p) => isActiveMiniGamePlayer(room, p)
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

    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    if (!canUseMiniGameSocket(room, player, socket)) return;

    const game = room.mini;
    // Bloquer la réponse si le timer n'est pas encore lancé
    if (!game || !game.timer) return;
    if (!game || game.type !== "faux_vrai") return;
    if (!Number.isInteger(index) || index < 0 || index >= (game.list?.[game.index]?.affirmations?.length || 0)) return;
    if (Object.prototype.hasOwnProperty.call(game.answers, player.playerId)) return;

    if (!game.answerTimes) game.answerTimes = {};
    const timeTaken = (Date.now() - (game.startTime || Date.now())) / 10**3;
    game.answerTimes[player.playerId] = timeTaken;

    game.answers[player.playerId] = index;

    // CORRECTIF : On compte uniquement les joueurs ACTIFS pour la fin anticipée
    const activePlayers = room.players.filter(
      (p) => isActiveMiniGamePlayer(room, p)
    );
    const answersCount = activePlayers.reduce((count, p) => {
      return count + (Object.prototype.hasOwnProperty.call(game.answers, p.playerId) ? 1 : 0);
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
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const mini = room.gameState.currentMiniGameState;

    if (!mini || mini.type !== "qui_suis_je" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;
      rememberManualResponseTime(mini, socket.playerId, timeTaken);

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("quiSuisJeAnswerAck");

      const activePlayers = room.players.filter(
        (p) => isActiveMiniGamePlayer(room, p)
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

    if (room.gameMode === "liste") {
      if (player.socketId !== socket.id) return;
      if (room.listeTournament.started) {
        if (!withdrawListeParticipant(room, playerId, socket.id)) return;
        socket.leave(roomCode);
        socket.roomCode = null;
        socket.room = null;
        socket.playerId = null;
        io.to(roomCode).emit("roomUpdate", serializeRoom(room));
        io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
        if (room.activePlayersList && Number.isInteger(gs?.currentMiniGameState?.correctionIndex)) {
          sendCorrectionData(roomCode);
        }
        return;
      }
    }

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
      if (room.gameMode === "liste") {
        ensureListeHost(room);
      } else {
        const newHost = room.players.find((p) => p.isConnected) || room.players[0];
        room.hostId = newHost ? newHost.playerId : null;
      }
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

    if (room.gameMode === "liste") {
      if (!disconnectListePlayer(room, playerId, socket.id)) return;
      io.to(roomCode).emit("roomUpdate", serializeRoom(room));
      if (room.activePlayersList && Number.isInteger(room.gameState?.currentMiniGameState?.correctionIndex)) {
        sendCorrectionData(roomCode);
      }
      return;
    }

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
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

  if (!mini || mini.type !== "le_bon_ordre" || mini.finished) return;

    // Vérification : Le timer doit tourner
    if (!mini.timer || !mini.timer.running) return;

  if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;
      rememberManualResponseTime(mini, socket.playerId, timeTaken);

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("leBonOrdreAnswerAck");

      const activePlayers = room.players.filter(
        (p) => isActiveMiniGamePlayer(room, p)
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
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

    if (!mini || mini.type !== "le_tour_du_monde" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;
      rememberManualResponseTime(mini, socket.playerId, timeTaken);

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("leTourDuMondeAnswerAck");

      const activePlayers = room.players.filter(
        (p) => isActiveMiniGamePlayer(room, p)
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
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const gs = room.gameState;
    const mini = gs.currentMiniGameState;

    if (!mini || mini.type !== "blind_test" || mini.finished) return;

    if (!mini.timer || !mini.timer.running) return;

    if (!mini.playerAnswers[socket.playerId]) {
      if (!mini.responseTimes) mini.responseTimes = {};
      const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
      mini.responseTimes[socket.playerId] = timeTaken;
      rememberManualResponseTime(mini, socket.playerId, timeTaken);

      mini.playerAnswers[socket.playerId] = answer;
      socket.emit("blindTestAnswerAck");

      const activePlayers = room.players.filter(
        (p) => isActiveMiniGamePlayer(room, p)
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
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const mini = room.gameState.currentMiniGameState;

    if (!mini || mini.type !== "petit_bac" || mini.finished) return;
    if (Object.prototype.hasOwnProperty.call(mini.playerAnswers, socket.playerId)) {
      return socket.emit("petitBacAnswerAck");
    }

    if (!mini.responseTimes) mini.responseTimes = {};
    const timeTaken = (Date.now() - (mini.startTime || Date.now())) / 1000;
    mini.responseTimes[socket.playerId] = timeTaken;
    rememberManualResponseTime(mini, socket.playerId, timeTaken);
    mini.playerAnswers[socket.playerId] = answers;
    mini.history[socket.playerId] = { 0: answers };
    socket.emit("petitBacAnswerAck");

    const activePlayers = room.players.filter((p) => isActiveMiniGamePlayer(room, p));
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
    if (room.gameMode === "liste") {
      pruneListeCorrectionPlayers(room);
      if (!mini || !room.activePlayersList?.length) return;
    }

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
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];
    const host = room?.players.find((candidate) => candidate.playerId === room.hostId);
    if (!room || room.hostId !== socket.playerId || host?.socketId !== socket.id) return;

    const gs = room.gameState;
    const mini = gs.currentMiniGameState;
    if (!mini || !room.activePlayersList) return;

    const player = room.activePlayersList[mini.gradingPlayerIndex];
    if (!player) return;
    if (room.gameMode === "liste" && !isListeParticipant(room, player)) return;

    const grade = validateManualGrade({
      miniGameType: mini.type,
      points,
      details,
      categoryCount: mini.categories?.length || 0
    });
    if (grade.error) return socket.emit("errorMessage", grade.error);
    const soundVal = data.soundValue;
    if (soundVal !== undefined && soundVal !== null) {
      if (![0, 0.5, 1].includes(soundVal)) {
        return socket.emit("errorMessage", "La valeur sonore de correction est invalide.");
      }
      io.to(roomCode).emit("playGradeSound", soundVal);
    }

    if (!mini.scoresGiven) mini.scoresGiven = {};
    if (!mini.scoresGiven[mini.correctionIndex]) mini.scoresGiven[mini.correctionIndex] = {};
    
    if (!mini.timesApplied) mini.timesApplied = {};
    if (!mini.timesApplied[mini.correctionIndex]) mini.timesApplied[mini.correctionIndex] = {};

    const oldScore = mini.scoresGiven[mini.correctionIndex][player.playerId] || 0;
    const newScore = grade.value;

    let maxDuration = 40; // Valeur par défaut (Qui suis-je, Tour du monde, Blind test)
    if (mini.type === "petit_bac") {
      maxDuration = mini.timer?.totalSeconds ?? 150;
    } else if (mini.type === "le_bon_ordre") {
      maxDuration = LE_BON_ORDRE_DURATION;
    }
    const oldTime = mini.timesApplied[mini.correctionIndex][player.playerId] || 0;
    const legacyTime = Number.isFinite(mini.responseTimes?.[player.playerId])
      ? mini.responseTimes[player.playerId]
      : maxDuration;
    const realTime = getQuestionResponseTime(
      mini.responseTimesByQuestion,
      mini.correctionIndex,
      player.playerId,
      legacyTime
    );
    const revision = calculateGradeRevision({
      previousScore: oldScore,
      previousTime: oldTime,
      newScore,
      responseTime: realTime,
      maxDuration,
      miniGameType: mini.type
    });

    player.score += revision.scoreDelta;
    player.roundScore += revision.scoreDelta;
    player.roundTime += revision.timeDelta;
    player.totalTime += revision.timeDelta;
    mini.scoresGiven[mini.correctionIndex][player.playerId] = newScore;
    mini.timesApplied[mini.correctionIndex][player.playerId] = revision.appliedTime;

    if (mini.type === "petit_bac") {
      if (!mini.gradingDetails) mini.gradingDetails = {};
      mini.gradingDetails[player.playerId] = grade.details;
    }

    io.to(roomCode).emit("scoreUpdate", {
      players: room.players
        .filter((p) => isActiveMiniGamePlayer(room, p))
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
    if (room.gameMode === "liste") {
      pruneListeCorrectionPlayers(room);
      if (!mini || !room.activePlayersList?.length) return;
    }

    const currentQuestionGrades = mini.scoresGiven[mini.correctionIndex] || {};
    const missingPlayer = room.activePlayersList.find(
      (p) => currentQuestionGrades[p.playerId] === undefined
    );

    if (missingPlayer) {
      socket.emit(
        "errorMessage",
        `Attention : Vous n'avez pas corrigé ${missingPlayer.pseudo} !`
      );
      return;
    }

    mini.correctionIndex++;
    mini.gradingPlayerIndex = 0;

    if (mini.correctionIndex >= mini.questions.length) {
    io.to(socket.roomCode).emit("scoreUpdate", {
      players: room.players
        .filter((p) => isActiveMiniGamePlayer(room, p))
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
        // On attend 7s (3s �limination + 3s logo + 1s s�curit�)
        setTimeout(() => {
          endMiniGame(socket.roomCode);
        }, 7000); 
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
      }, 7000); // Augment� � 7s
    }, 5000);
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

    // -- Calcul du thème gagnant --
    const activePlayers = room.players.filter((p) => isActiveMiniGamePlayer(room, p));
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

    // -- GESTION MÉMOIRE ENCHÈRES --
    // On cherche les questions non jouées pour CE thème
    let available = getUnusedQuestions(ENCHERES_QUESTIONS, "les_encheres");
    let pool = available.filter((q) => q.theme_id === selectedThemeId);

    // Si plus de questions pour ce th?me (ne devrait pas arriver gr?ce au gris?, mais s?curit?)
    if (pool.length === 0) {
        // MODIFICATION : On NE reset PAS l'historique global ("les_encheres")
        // On recharge simplement le stock complet pour CE th?me sp?cifique en urgence
        pool = ENCHERES_QUESTIONS.filter((q) => q.theme_id === selectedThemeId);
    }

    // Sélection de la question
    const question = pool[Math.floor(Math.random() * pool.length)] || ENCHERES_QUESTIONS[0];
    
    // On marque la question comme jouée
    markQuestionsAsPlayed([question], "les_encheres");
    // ------------------------------

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
          const active = room.players.filter((p) => isActiveMiniGamePlayer(room, p));
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
          io.to(room.roomCode).emit("encheresCountdown");
          setTimeout(() => {
            startEncheresCollection(room.roomCode);
          }, 4000);
        }, 5000);
      });
    }, 3500);
}

  function startLesEncheres(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // --- MODIFICATION DÉBUT : Calcul du stock par thème ---
    // On crée une liste temporaire qui contient l'info "outOfStock"
    let themesWithStockInfo = ENCHERES_THEMES.map(theme => {
      // On vérifie s'il reste des questions non jouées pour ce thème
      const unusedForTheme = getUnusedQuestions(ENCHERES_QUESTIONS, "les_encheres")
                             .filter(q => q.theme_id === theme.id);
      return {
        ...theme,
        outOfStock: unusedForTheme.length === 0
      };
    });

    // SÉCURITÉ : Si TOUS les thèmes sont vides, on reset tout pour ne pas bloquer le jeu
    const allEmpty = themesWithStockInfo.every(t => t.outOfStock);
    if (allEmpty) {
      resetGameHistory("les_encheres");
      // On remet tout le monde disponible
      themesWithStockInfo.forEach(t => t.outOfStock = false);
    }
    // --- MODIFICATION FIN ---

    room.gameState.currentMiniGameState = {
      type: "les_encheres",
      subPhase: "theme_selection",
      themesAvailable: themesWithStockInfo.slice(0, 3), // (Si tu utilises cette variable ailleurs)
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
      themes: themesWithStockInfo // On envoie la liste enrichie avec outOfStock
    });

    // TIMER SÉLECTION (30s) -> Si fin, on finalise automatiquement
    startEncheresTimer(roomCode, 60, () => {
      finalizeThemeSelection(room);
    });
  }

  function startEncheresTimer(roomCode, duration, callback) {
    const room = rooms[roomCode];
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini) return;

    // MODIFICATION : On stocke tout dans l'objet mini pour pouvoir le modifier ailleurs
    mini.timer = { total: duration, remaining: duration, running: true };

    if (room.encheresInterval) clearInterval(room.encheresInterval);

    room.encheresInterval = setInterval(() => {
      // Sécurité si le timer n'existe plus
      if (!mini.timer || !mini.timer.running) {
        clearInterval(room.encheresInterval);
        return;
      }

      mini.timer.remaining--;

      io.to(roomCode).emit("encheresTimerUpdate", { 
        remaining: mini.timer.remaining, 
        total: mini.timer.total 
      });

      if (mini.timer.remaining <= 0) {
        clearInterval(room.encheresInterval);
        mini.timer.running = false;
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
      duration: 90
    });

    startEncheresTimer(roomCode, 90, () => {
      mini.subPhase = "correction";
      io.to(roomCode).emit("encheresStartCorrection", {
        answers: mini.answersGiven,
        target: mini.currentMaxBid
      });
    });
  }

  function getOpponentId(room, playerId) {
    const active = room.players.filter((p) => isActiveMiniGamePlayer(room, p));
    const opp = active.find((p) => p.playerId !== playerId);
    return opp ? opp.playerId : null;
  }

  socket.on("encheresVoteTheme", (themeId) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    
    // --- SÉCURITÉ AJOUTÉE ---
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    if (!canUseMiniGameSocket(room, player, socket)) return;
    // ------------------------

    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.subPhase !== "theme_selection") return;

    mini.playerVotes[socket.playerId] = themeId;

    const activePlayers = room.players.filter(
      (p) => isActiveMiniGamePlayer(room, p)
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
    if (!canUseMiniGameSocket(room, player, socket)) return;

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
      
      if (mini.timer && mini.timer.running && mini.timer.remaining <= 5) {
          mini.timer.remaining += 10;
          // On force une mise à jour immédiate pour le visuel client
          io.to(socket.roomCode).emit("encheresTimerUpdate", { 
            remaining: mini.timer.remaining, 
            total: mini.timer.total 
          });
      }


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
    if (!canUseMiniGameSocket(room, player, socket)) return;

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
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!canUseMiniGameSocket(room, player, socket)) return;
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
    }, 2500);
  });
}); // <--- ICI : C'est la fermeture cruciale de io.on("connection")

function syncPlayerWithGame(socket, room) {
  if (!room || !room.gameState) return;
  if (room.gameMode === "liste" &&
      !isListeParticipant(room, room.players.find((p) => p.playerId === socket.playerId))) return;
  const gs = room.gameState;
  // CORRECTIF : On regarde currentMiniGameState OU room.mini (pour le cas spécifique du Faux du Vrai)
  const mini = gs.currentMiniGameState || room.mini;

  if (gs.phase !== "playing" || !mini) return;

  // === GESTION DE LA CORRECTION (Si le jeu est fini) ===
  if (
    mini.finished &&
    ["qui_suis_je", "le_bon_ordre", "le_tour_du_monde", "blind_test", "petit_bac", "les_encheres"].includes(mini.type)
  ) {
    // --- FIX : ON AJOUTE LA V�RIFICATION DE L'INDEX ICI ---
    if (typeof mini.correctionIndex !== "undefined" && mini.correctionIndex < mini.questions.length) {
      sendCorrectionData(room.roomCode, socket);
    } else {
      // Si l'index est hors limites, cela signifie que le jeu est fini 
      // et qu'on attend juste la transition (tes 7-8 secondes de battement).
      console.log("[DEBUG] Joueur reconnect� pendant la transition finale. Pas de correction � envoyer.");
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
      const selectedAnswerIndex = mini.answers?.[socket.playerId];
      socket.emit("fauxVraiQuestion", { 
        question: q.question, affirmations: q.affirmations, themeId: q.themeId, 
        indexFausse: q.indexFausse, duration: mini.totalSeconds || FAUX_VRAI_TIMER_DURATION,
        index: mini.index + 1, total: mini.list.length,
        hasAnswered: Number.isInteger(selectedAnswerIndex), selectedAnswerIndex,
        isReload: true // FLAG IMPORTANT
      });
    }
    if (mini.timer) {
      socket.emit("fauxVraiTimerUpdate", {
        remaining: mini.remainingSeconds ?? FAUX_VRAI_TIMER_DURATION,
        total: mini.totalSeconds || FAUX_VRAI_TIMER_DURATION
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
    const duration = mini.timer?.totalSeconds ?? 150;
    const remaining = mini.timer?.remainingSeconds ?? duration;
    const savedAnswers = mini.playerAnswers?.[socket.playerId];
    socket.emit("petitBacStart", {
      letter: mini.letter, categories: mini.categories, duration,
      hasAnswered: savedAnswers !== undefined, savedAnswers: savedAnswers || null
    });
    socket.emit("petitBacTimerUpdate", { remaining, total: duration });
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
// ==========================================
//   ADMINISTRATION & DEBUG (M?MOIRE)
// ==========================================

app.get("/admin/memory/view", (req, res) => {
  const history = getPlayedHistory();
  res.json(history);
});

app.get("/admin/memory/reset-all", (req, res) => {
  savePlayedHistory({});
  res.send("<h1>Succ?s</h1><p>Tout l'historique des questions a ?t? effac?.</p>");
});

app.get("/admin/memory/reset/:game", (req, res) => {
  const game = req.params.game;
  resetGameHistory(game);
  res.send(`<h1>Succ?s</h1><p>Historique effac? pour : <strong>${game}</strong></p>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Serveur lancé sur le port", PORT);
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




