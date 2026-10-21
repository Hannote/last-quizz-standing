// server.js
// Last Quizz Standing - Tirage au sort animé + règles + prêts
// + mini-jeu Leugtas phase 2.4 (envoi question au client).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const { randomBytes, randomUUID, timingSafeEqual } = require("crypto");
const { shuffleCopy } = require("./question-shuffle");
const {
  validateBonOrdreBank,
  createBonOrdreStore,
  safeBonOrdreQuestion,
  isValidBonOrdreAnswer,
  gradeBonOrdre
} = require("./le-bon-ordre");
const { DURATION_MS: PENAVE_DURATION_MS, validateQuestionBank, rankPenaveResults } = require("./penave-ou-nachave");
const {
  calculateGradeRevision,
  getQuestionResponseTime,
  rankMiniGameResults,
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

const HISTORY_FILE = process.env.LQS_HISTORY_FILE || path.join(DATA_DIR, "played_questions_history.json");
const BON_ORDRE_MEMORY_FILE = process.env.LQS_BON_ORDRE_MEMORY_FILE ||
  path.join(DATA_DIR, "le_bon_ordre_elements_v1.json");
const bonOrdreStore = createBonOrdreStore(BON_ORDRE_MEMORY_FILE);
let bonOrdreBank;
let bonOrdreBankError = null;
try {
  bonOrdreBank = validateBonOrdreBank(JSON.parse(fs.readFileSync(
    path.join(__dirname, "public_2", "le_bon_ordre", "le_bon_ordre.json"), "utf8")));
} catch (error) {
  bonOrdreBankError = `Le Bon Ordre indisponible : ${error.message}`;
  console.error(bonOrdreBankError);
}
let penaveBank;
let penaveBankError = null;
try {
  penaveBank = validateQuestionBank(JSON.parse(fs.readFileSync(
    path.join(__dirname, "public_2", "penave_ou_nachave", "penave_ou_nachave.json"), "utf8")));
} catch (error) {
  penaveBankError = error.message;
  console.error(penaveBankError);
}

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
const MATRICE_FOOTBALL_QUESTIONS = require(path.join(__dirname, "public_2", "matrice_football", "matrice_football.json")).questions || [];
const MATRICE_FOOTBALL_DURATION_SECONDS = 150;

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

// Les valeurs et les pools du Bon Ordre restent exclusivement côté serveur.
// La résolution utilise le même dossier que le service statique, y compris
// pour les URL encodées, la casse et les séparateurs Windows.
const publicDirectory = path.join(__dirname, "public_2");
const privateBonOrdreFile = path.join(publicDirectory, "le_bon_ordre", "le_bon_ordre.json").toLowerCase();
app.use((req, res, next) => {
  let requestedFile;
  try {
    // Windows ignore les points/espaces finaux et reconnaît les flux NTFS.
    // Ces alias doivent recevoir la même protection que le nom du fichier.
    const normalizedPath = decodeURIComponent(req.path).replace(/\\/g, "/")
      .split("/").map((part) => part === "." || part === ".." ? part :
        part.split(":")[0].replace(/[ .]+$/g, "")).join("/");
    requestedFile = path.resolve(publicDirectory, "." + normalizedPath).toLowerCase();
  }
  catch { return res.status(400).end(); }
  if (requestedFile === privateBonOrdreFile) {
    return res.set("Cache-Control", "no-store").status(404).end();
  }
  next();
});
app.use(express.static(publicDirectory));

// ===============================
//   GESTION DES ROOMS
// ===============================

const rooms = {};
function positiveRoomSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : fallback;
}
const ROOM_CREATE_WINDOW_MS = positiveRoomSetting("LQS_ROOM_CREATE_WINDOW_MS", 60_000);
const ROOM_CREATE_LIMIT = positiveRoomSetting("LQS_ROOM_CREATE_LIMIT", 20);
const ROOM_LIMIT = positiveRoomSetting("LQS_ROOM_LIMIT", 100);
const ROOM_PLAYER_LIMIT = positiveRoomSetting("LQS_ROOM_PLAYER_LIMIT", 16);
const ROOM_ABANDON_MS = positiveRoomSetting("LQS_ROOM_ABANDON_MS", 300_000);
const roomCreationTimes = [];

function pruneRoomCreationTimes(now = Date.now()) {
  while (roomCreationTimes.length && now - roomCreationTimes[0] >= ROOM_CREATE_WINDOW_MS) {
    roomCreationTimes.shift();
  }
}

const MAX_PSEUDO_LENGTH = 32;
const MAX_PLAYER_ID_LENGTH = 64;
const MAX_ANSWER_LENGTH = 120;
const MAX_BID = 50;

function isMessageObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasMessageKeys(value, allowed) {
  return isMessageObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function isText(value, maxLength, allowEmpty = false) {
  return typeof value === "string" && value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0);
}

function isSafePlayerId(value) {
  return isText(value, MAX_PLAYER_ID_LENGTH) && /^[A-Za-z0-9_-]+$/.test(value.trim()) &&
    !Object.hasOwn(Object.prototype, value.trim()) && value.trim() !== "prototype";
}

function isRoomCode(value) {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{4}$/.test(value.trim().toUpperCase());
}

function validHistoricalFields(data) {
  return (data.roomCode === undefined || isText(data.roomCode, 8)) &&
    (data.playerId === undefined || isText(data.playerId, MAX_PLAYER_ID_LENGTH));
}

function currentActionMini(room, type) {
  if (room.gameState?.phase !== "playing") return null;
  if (type === "faux_vrai") {
    return room.gameState.currentMiniGame === "le_faux_du_vrai" && room.mini?.type === type
      ? room.mini : null;
  }
  const mini = room.gameState.currentMiniGameState;
  return room.gameState.currentMiniGame === type && mini?.type === type ? mini : null;
}

function validSocketMessage(event, data, room) {
  const historical = ["roomCode", "playerId"];
  if (event === "createRoom" || event === "joinRoom") {
    const keys = event === "createRoom" ? ["pseudo", "playerId"]
      : ["pseudo", "playerId", "roomCode", "reconnectSecret"];
    if (!hasMessageKeys(data, keys) ||
        !isText(data.pseudo, MAX_PSEUDO_LENGTH) || !isSafePlayerId(data.playerId)) return false;
    if (event === "joinRoom" && !isRoomCode(data.roomCode)) return false;
    return event === "createRoom" || data.reconnectSecret == null ||
      (typeof data.reconnectSecret === "string" && /^[0-9a-f]{64}$/.test(data.reconnectSecret));
  }
  if (["drawingFinished", "leaveRoom", "requestRoomState", "correctionPrevQuestion",
       "correctionNextQuestion", "endPetitBacCorrection", "encheresFinalizeGame"].includes(event)) {
    return data == null;
  }
  if (event === "endMatriceFootballCorrection") {
    return hasMessageKeys(data, ["roundNumber", "matrixId", "instanceId", "gradingPlayerId"]) &&
      Number.isInteger(data.roundNumber) && Number.isInteger(data.matrixId) &&
      isText(data.instanceId, 36) && isSafePlayerId(data.gradingPlayerId);
  }
  if (event === "hostSetGameMode") {
    return hasMessageKeys(data, ["gameMode"]) && ["battle_royale", "liste"].includes(data.gameMode);
  }
  if (event === "hostValidateListeConfig") {
    return hasMessageKeys(data, ["gameCount", "selectionMethod", "selectedMiniGames"]) &&
      Array.isArray(data.selectedMiniGames) && data.selectedMiniGames.length <= getListeOptions().maxGames;
  }
  if (event === "hostStartGame") {
    return hasMessageKeys(data, ["forcedMiniGame"]) &&
      (data.forcedMiniGame === undefined ||
        (typeof data.forcedMiniGame === "string" && POSSIBLE_MINI_GAMES.includes(data.forcedMiniGame)));
  }
  if (event === "playerSetReady") {
    return hasMessageKeys(data, ["isReady"]) && typeof data.isReady === "boolean";
  }
  if (event === "penaveCueFinished") {
    return hasMessageKeys(data, ["instanceId", "turnNumber", "passageId"]) &&
      isText(data.instanceId, 36) && Number.isInteger(data.turnNumber) &&
      Number.isInteger(data.passageId);
  }
  if (event === "penaveAnswer") {
    return hasMessageKeys(data, ["answer", "pass", "instanceId", "turnNumber", "passageId"]) &&
      typeof data.pass === "boolean" && isText(data.answer, MAX_ANSWER_LENGTH, true) &&
      isText(data.instanceId, 36) && Number.isInteger(data.turnNumber) &&
      Number.isInteger(data.passageId);
  }
  if (event === "penaveGrade") {
    return hasMessageKeys(data, ["accepted", "instanceId", "turnNumber", "passageId"]) &&
      typeof data.accepted === "boolean" && isText(data.instanceId, 36) &&
      Number.isInteger(data.turnNumber) && Number.isInteger(data.passageId);
  }
  if (event === "leugtasAnswer") {
    const q = currentActionMini(room, "qui_veut_gagner_des_leugtas")?.questions?.[
      room.gameState.currentMiniGameState.questionIndex];
    return hasMessageKeys(data, ["answerId", ...historical]) && validHistoricalFields(data) &&
      q?.answers?.some((answer) => answer.id === data.answerId) === true;
  }
  if (event === "fauxVraiAnswer") {
    const game = currentActionMini(room, "faux_vrai");
    return Number.isInteger(data) && data >= 0 &&
      data < (game?.list?.[game.index]?.affirmations?.length || 0);
  }
  if (event === "leBonOrdreAnswer") {
    return hasMessageKeys(data, ["instanceId", "questionId", "questionIndex", "orderedIds", "pass", "gameMode", "roundNumber"]) &&
      isText(data.instanceId, 36) && isText(data.questionId, 120) &&
      Number.isInteger(data.questionIndex) && data.questionIndex >= 0 &&
      typeof data.pass === "boolean" &&
      (data.pass ? data.orderedIds === null :
        Array.isArray(data.orderedIds) && data.orderedIds.length === 5 &&
        data.orderedIds.every((id) => typeof id === "string")) &&
      (data.gameMode === undefined || ["battle_royale", "liste"].includes(data.gameMode)) &&
      (data.roundNumber === undefined || Number.isInteger(data.roundNumber));
  }
  const textGames = {
    quiSuisJeAnswer: "qui_suis_je",
    leTourDuMondeAnswer: "le_tour_du_monde", blindTestAnswer: "blind_test"
  };
  if (Object.hasOwn(textGames, event)) {
    return hasMessageKeys(data, ["answer", ...historical]) && validHistoricalFields(data) &&
      isText(data.answer, MAX_ANSWER_LENGTH) &&
      !!currentActionMini(room, textGames[event]);
  }
  if (event === "petitBacAnswer") {
    const mini = currentActionMini(room, "petit_bac");
    const answers = data?.answers;
    if (!hasMessageKeys(data, ["answers", ...historical]) || !validHistoricalFields(data) ||
        !isMessageObject(answers) ||
        !Array.isArray(mini?.categories)) return false;
    const entries = Object.entries(answers);
    return entries.length <= mini.categories.length && entries.every(([key, value]) =>
      /^(0|[1-9]\d*)$/.test(key) && Number(key) < mini.categories.length &&
      isText(value, MAX_ANSWER_LENGTH, true));
  }
  if (event === "matriceFootballAnswer") {
    const answers = data?.answers;
    const mini = currentActionMini(room, "matrice_football");
    return !!mini &&
      hasMessageKeys(data, ["answers", "roundNumber", "matrixId", "instanceId"]) &&
      data.roundNumber === room.gameState.roundNumber &&
      data.matrixId === mini.matrix.id && data.instanceId === mini.instanceId &&
      isMessageObject(answers) && Object.keys(answers).length === 9 &&
      Array.from({ length: 9 }, (_, index) => String(index)).every((key) =>
        Object.hasOwn(answers, key) && isText(answers[key], MAX_ANSWER_LENGTH, true));
  }
  if (event === "correctionNavigate") {
    return hasMessageKeys(data, ["direction", "roundNumber", "matrixId", "instanceId", "gradingPlayerId"]) &&
      Number.isInteger(data.direction) && data.direction !== 0 && Math.abs(data.direction) <= 100 &&
      (data.roundNumber === undefined || Number.isInteger(data.roundNumber)) &&
      (data.matrixId === undefined || Number.isInteger(data.matrixId)) &&
      (data.instanceId === undefined || isText(data.instanceId, 36)) &&
      (data.gradingPlayerId === undefined || isSafePlayerId(data.gradingPlayerId));
  }
  if (event === "hostGradePlayer") {
    const mini = room?.gameState?.currentMiniGameState;
    return hasMessageKeys(data, ["points", "details", "soundValue", "gradingPlayerId", "roundNumber", "matrixId", "instanceId", ...historical]) &&
      validHistoricalFields(data) &&
      Number.isFinite(data.points) &&
      (data.soundValue == null || [0, 0.5, 1].includes(data.soundValue)) &&
       (data.details === undefined || (isMessageObject(data.details) &&
         Object.keys(data.details).length <= (mini?.type === "matrice_football" ? 9 : mini?.categories?.length || 0))) &&
       (data.gradingPlayerId === undefined || isSafePlayerId(data.gradingPlayerId)) &&
       (data.roundNumber === undefined || Number.isInteger(data.roundNumber)) &&
       (data.matrixId === undefined || Number.isInteger(data.matrixId)) &&
       (data.instanceId === undefined || isText(data.instanceId, 36));
  }
  if (event === "encheresVoteTheme") {
    const mini = currentActionMini(room, "les_encheres");
    return typeof data === "string" && !!mini?.themesAvailable?.some((theme) =>
      theme.id === data && !theme.outOfStock);
  }
  if (event === "encheresPlaceBid") {
    const bid = typeof data === "string" && /^(?:[1-9]|[1-4]\d|50)$/.test(data)
      ? Number(data) : data;
    return Number.isSafeInteger(bid) && bid >= 1 && bid <= MAX_BID;
  }
  if (event === "encheresSendAnswer") return isText(data, MAX_ANSWER_LENGTH);
  if (event === "encheresDeleteAnswer") {
    const mini = currentActionMini(room, "les_encheres");
    return Number.isInteger(data) && data >= 0 && data < (mini?.answersGiven?.length || 0);
  }
  if (event === "encheresToggleCorrection") {
    const mini = currentActionMini(room, "les_encheres");
    return hasMessageKeys(data, ["index", "status"]) &&
      Number.isInteger(data.index) && data.index >= 0 &&
      data.index < (mini?.validatedStatus?.length || 0) && typeof data.status === "boolean";
  }
  return true;
}

function validActionPhase(event, room) {
  if (["penaveCueFinished", "penaveAnswer", "penaveGrade"].includes(event)) {
    const mini = getPenaveMini(room);
    return room.gameState.phase === "playing" && mini?.subPhase ===
      (event === "penaveCueFinished" ? "cue" : event === "penaveAnswer" ? "answer" : "correction");
  }
  const types = {
    leugtasAnswer: "qui_veut_gagner_des_leugtas", fauxVraiAnswer: "faux_vrai",
    quiSuisJeAnswer: "qui_suis_je", leBonOrdreAnswer: "le_bon_ordre",
    leTourDuMondeAnswer: "le_tour_du_monde", blindTestAnswer: "blind_test",
    petitBacAnswer: "petit_bac", matriceFootballAnswer: "matrice_football", encheresVoteTheme: "les_encheres",
    encheresPlaceBid: "les_encheres", encheresSendAnswer: "les_encheres",
    encheresDeleteAnswer: "les_encheres", encheresToggleCorrection: "les_encheres",
    encheresFinalizeGame: "les_encheres"
  };
  if (Object.hasOwn(types, event) && !currentActionMini(room, types[event])) return false;
  const answerEvents = ["leugtasAnswer", "fauxVraiAnswer", "quiSuisJeAnswer",
    "leBonOrdreAnswer", "leTourDuMondeAnswer", "blindTestAnswer", "petitBacAnswer", "matriceFootballAnswer"];
  if (answerEvents.includes(event)) {
    const mini = currentActionMini(room, types[event]);
    if (!mini || mini.finished) return false;
    if (event === "fauxVraiAnswer") return !!mini.timer;
    if (event === "leugtasAnswer") return !!mini.leugtasTimer?.running;
    return !!mini.timer?.running;
  }
  if (event === "playerSetReady") return room.gameState?.phase === "rules";
  if (event === "drawingFinished") return room.gameState?.phase === "drawingGame";
  if (["correctionNavigate", "hostGradePlayer", "correctionPrevQuestion",
       "correctionNextQuestion", "endPetitBacCorrection", "endMatriceFootballCorrection"].includes(event)) {
    const mini = room.gameState?.currentMiniGameState;
    if (mini?.type === "le_bon_ordre") return false;
    return room.gameState?.phase === "playing" && !!mini?.finished &&
      room.gameState.currentMiniGame === mini.type && Array.isArray(mini.questions) &&
      Number.isInteger(mini.correctionIndex) && mini.correctionIndex >= 0 &&
      mini.correctionIndex < mini.questions.length && Array.isArray(room.activePlayersList) &&
       (event !== "endPetitBacCorrection" || mini.type === "petit_bac") &&
       (event !== "endMatriceFootballCorrection" || mini.type === "matrice_football");
  }
  const mini = room.gameState?.currentMiniGameState;
  if (event === "encheresVoteTheme") return mini.subPhase === "theme_selection" && !!mini.timer?.running;
  if (event === "encheresPlaceBid") return mini.subPhase === "bidding" && !!mini.timer?.running;
  if (["encheresSendAnswer", "encheresDeleteAnswer"].includes(event)) {
    return mini.subPhase === "collecting" && !!mini.timer?.running;
  }
  if (["encheresToggleCorrection", "encheresFinalizeGame"].includes(event)) {
    return mini.subPhase === "correction" && !mini.finalized;
  }
  return true;
}

function getSocketRoom(socket) {
  const room = rooms[socket.roomCode];
  if (!room || !socket.playerId || room.roomCode !== socket.roomCode) return null;
  const player = room.players.find((candidate) => candidate.playerId === socket.playerId);
  return player?.socketId === socket.id && player.isConnected ? room : null;
}

function getHostRoom(socket) {
  const room = getSocketRoom(socket);
  return room?.hostId === socket.playerId ? room : null;
}

function clearSocketRoom(socket) {
  if (socket.roomCode) socket.leave(socket.roomCode);
  socket.playerId = null;
  socket.roomCode = null;
  socket.room = null;
}

function hasReconnectSecret(player, secret) {
  if (typeof secret !== "string" || !/^[0-9a-f]{64}$/.test(secret) ||
      typeof player.reconnectSecret !== "string") return false;
  const received = Buffer.from(secret, "hex");
  const expected = Buffer.from(player.reconnectSecret, "hex");
  return timingSafeEqual(received, expected);
}

function sendReconnectSecret(socket, room, player) {
  socket.emit("reconnectCredential", {
    roomCode: room.roomCode,
    playerId: player.playerId,
    reconnectSecret: player.reconnectSecret
  });
}

const POSSIBLE_MINI_GAMES = [
  "qui_suis_je",
  "blind_test",
  "le_tour_du_monde",
  "le_bon_ordre",
  "petit_bac",
  "matrice_football",
  "qui_veut_gagner_des_leugtas",
  "le_faux_du_vrai",
  "les_encheres" // <--- AJOUT
];
const LEUGTAS_TIMER_DURATION_SECONDS = 30;
const FAUX_VRAI_TIMER_DURATION = 45;
const LE_BON_ORDRE_DURATION = 45;
// Durée commune et pilotée par le serveur du classement entre deux manches Liste.
// Les animations de fin propres aux mini-jeux restent inchangées et se terminent
// avant l'entrée dans cette phase.
const LISTE_LEADERBOARD_DURATION_MS = 8000;
const LISTE_LEADERBOARD_SOUNDS = Array.from(
  { length: 15 }, (_, index) => `/sons/classement_general_${index + 1}.mp3`
);
// En Liste, aucun écran d'élimination ne précède le logo de fin (3,5 s côté client).
const LISTE_END_LOGO_DURATION_MS = 3500;
// L'animation de tirage Liste existante dure 6,4 s, puis 2,9 s d'affichage
// du logo final. Le serveur avance donc toutes les salles au même instant.
const LISTE_DRAW_DURATION_MS = 9300;
const LISTE_INTRO_DURATION_MS = 16500;

// Catalogue Liste indépendant du tirage et du bac à sable Battle Royale.
const MINI_GAME_CATALOG = [
  { id: "penave_ou_nachave", label: "Pénave ou Nachave", modes: ["liste"] },
  { id: "qui_suis_je", label: "Qui suis-je ?", modes: ["battle_royale", "liste"] },
  { id: "blind_test", label: "Blind test", modes: ["battle_royale", "liste"] },
  { id: "le_tour_du_monde", label: "Le tour du monde", modes: ["battle_royale", "liste"] },
  { id: "le_bon_ordre", label: "Le bon ordre", modes: ["battle_royale", "liste"] },
  { id: "petit_bac", label: "Le petit bac", modes: ["battle_royale", "liste"] },
  { id: "matrice_football", label: "La Matrice Football", modes: ["battle_royale", "liste"] },
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
  if (!player || getSocketRoom(socket) !== room || player.playerId !== socket.playerId) return false;
  return room.gameMode !== "liste" || isListeParticipant(room, player);
}

function isActiveMiniGamePlayer(room, player) {
  return room.gameMode === "liste"
    ? isListeParticipant(room, player)
    : !player.eliminated && !player.isSpectator;
}

// Snapshot d'affichage uniquement : aucune attribution de points de tournoi.
function getMiniGameScoreUpdate(room) {
  const players = room.players.filter((p) => isActiveMiniGamePlayer(room, p));
  if (room.gameMode === "liste") {
    const penave = room.gameState.currentMiniGame === "penave_ou_nachave"
      ? room.gameState.currentMiniGameState : null;
    const ranking = penave?.ranking || rankMiniGameResults(players.map((p) => ({
      playerId: p.playerId, pseudo: p.pseudo,
      score: p.roundScore || 0, time: p.roundTime || 0
    })), room.listeTournament.initialParticipantCount);
    return {
      gameMode: "liste",
      players: ranking.map((p) => ({
        id: p.playerId, nickname: p.pseudo, score: p.score, time: p.time, place: p.place,
        points: p.points
      }))
    };
  }
  return {
    players: players.map((p) => ({
      id: p.playerId, nickname: p.pseudo, score: p.roundScore || 0, time: p.roundTime || 0
    }))
  };
}

function createListeTournamentState() {
  return {
    started: false,
    tournamentId: null,
    sequence: [],
    finished: false,
    winners: [],
    initialParticipantIds: [],
    initialParticipantCount: 0,
    roundResults: [],
    leaderboardSoundsUsed: [],
    leaderboardSound: null,
    introStartedAt: null,
    finaleStartedAt: null
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

// Fige le résultat avant toute remise à zéro des statistiques de manche.
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
    fixedPlacements: gs.currentMiniGame === "penave_ou_nachave"
      ? gs.currentMiniGameState?.ranking : null,
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
    ...createListeTournamentState(),
    started: true,
    tournamentId: randomUUID(),
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
  if (room.listeTournament.started) startReadyMiniGame(room);
  return true;
}

function withdrawListeParticipant(room, playerId, socketId) {
  if (room.gameMode !== "liste" || !room.listeTournament.started) return false;
  const player = room.players.find((p) => p.playerId === playerId);
  if (!player || player.socketId !== socketId || !room.listeTournament.initialParticipantIds.includes(playerId)) return false;
  player.withdrawn = true;
  if (room.gameState.currentMiniGame === "penave_ou_nachave") penaveWithdraw(room, playerId);
  delete room.gameState?.readyPlayers?.[playerId];
  pruneListeCorrectionPlayers(room);
  disconnectListePlayer(room, playerId, socketId);
  maybeEndBonOrdreQuestion(room);
  if (room.listeTournament.finished || (room.gameState.phase !== "listeLeaderboard" &&
      !room.players.some((p) => isListeParticipant(room, p)))) finishListeTournament(room);
  return true;
}

function getGameStateSummary(room) {
  const gs = room.gameState || createInitialGameState();
  return {
    gameMode: room.gameMode,
    listeContext: room.gameMode === "liste" ? getListeContext(room) : null,
    phase: gs.phase,
    roundNumber: gs.roundNumber,
    currentMiniGame: gs.currentMiniGame,
    penaveState: room.gameMode === "liste" && gs.currentMiniGame === "penave_ou_nachave"
      ? getPenaveSnapshot(room) : null,
    matriceFootballInstanceId: gs.currentMiniGame === "matrice_football"
      ? gs.currentMiniGameState?.instanceId ?? null : null,
    leBonOrdreInstanceId: gs.currentMiniGame === "le_bon_ordre"
      ? gs.currentMiniGameState?.instanceId ?? null : null,
    leBonOrdrePhase: gs.currentMiniGame === "le_bon_ordre" &&
      gs.currentMiniGameState?.type === "le_bon_ordre"
      ? gs.currentMiniGameState.subPhase
      : null,
    leBonOrdreState: gs.currentMiniGame === "le_bon_ordre" &&
      gs.currentMiniGameState?.type === "le_bon_ordre"
      ? getBonOrdrePublicState(room, gs.currentMiniGameState) : null,
    listeIntro: room.gameMode === "liste" && gs.phase === "listeIntro"
      ? {
        gameMode: "liste",
        tournamentId: room.listeTournament.tournamentId,
        startedAt: room.listeTournament.introStartedAt,
        elapsedMs: Math.max(0, Math.min(LISTE_INTRO_DURATION_MS,
          Date.now() - room.listeTournament.introStartedAt)),
        durationMs: LISTE_INTRO_DURATION_MS
      } : null,
    listeLeaderboard: room.gameMode === "liste" && gs.phase === "listeLeaderboard"
      ? {
        ranking: getListeGeneralRanking(room),
        sound: room.listeTournament.leaderboardSound
          ? {
            ...room.listeTournament.leaderboardSound,
            elapsedMs: Math.min(LISTE_LEADERBOARD_DURATION_MS,
              Math.max(0, Date.now() - room.listeTournament.leaderboardSound.startedAt))
          }
          : null
      }
      : null,
    listeFinale: room.gameMode === "liste" && gs.phase === "listeFinished"
      ? {
        gameMode: "liste",
        tournamentId: room.listeTournament.tournamentId,
        roundNumber: gs.roundNumber,
        startedAt: room.listeTournament.finaleStartedAt,
        elapsedMs: Math.max(0, Math.min(20000,
          Date.now() - room.listeTournament.finaleStartedAt)),
        durationMs: 20000,
        winners: room.listeTournament.generalRanking
          .filter((entry) => room.listeTournament.winners.includes(entry.playerId))
          .map(({ playerId, pseudo }) => ({ playerId, pseudo }))
      } : null,
    readyPlayerIds: Object.keys(gs.readyPlayers || {}).filter((id) => room.gameMode !== "liste" ||
      isListeParticipant(room, room.players.find((p) => p.playerId === id)))
  };
}

// Contexte transmis avec les commandes Liste : aucun ancien écran ne peut
// agir sur une autre partie, manche, question ou fiche de correction.
function getListeContext(room) {
  const gs = room.gameState;
  const mini = gs.currentMiniGameState || room.mini;
  return {
    gameMode: room.gameMode,
    tournamentId: room.listeTournament.tournamentId,
    roundNumber: gs.roundNumber,
    miniGame: gs.currentMiniGame,
    phase: gs.phase,
    question: mini?.questionIndex ?? mini?.index ?? null,
    correction: mini?.correctionIndex ?? null,
    gradingPlayer: room.activePlayersList?.[mini?.gradingPlayerIndex]?.playerId ?? null,
    instanceId: ["penave_ou_nachave", "le_bon_ordre"].includes(mini?.type) ? mini.instanceId : null,
    turnNumber: mini?.type === "penave_ou_nachave" ? mini.turnNumber : null,
    passageId: mini?.type === "penave_ou_nachave" ? mini.passageId : null,
    subPhase: ["penave_ou_nachave", "le_bon_ordre"].includes(mini?.type) ? mini.subPhase : null
  };
}

function publishListeContext(room, target = io.to(room.roomCode)) {
  if (room.gameMode === "liste") target.emit("listeContext", getListeContext(room));
}

function captureListeCallback(room) {
  const gs = room.gameState;
  const tournament = room.listeTournament;
  const mini = gs.currentMiniGameState || room.mini;
  // Le curseur de correction peut changer lors d'un abandon, sans invalider
  // la transition déjà engagée vers le jeu suivant.
  const callbackContext = () => {
    const { correction, gradingPlayer, ...context } = getListeContext(room);
    return JSON.stringify(context);
  };
  const context = callbackContext();
  const finished = mini?.finished;
  const revealing = mini?.isRevealing;
  return () => rooms[room.roomCode] === room && room.gameState === gs &&
    room.gameMode === "liste" && room.listeTournament === tournament &&
    !tournament.finished && (gs.currentMiniGameState || room.mini) === mini &&
    mini?.finished === finished && mini?.isRevealing === revealing &&
    callbackContext() === context;
}

function roomTimeout(room, callback, delay) {
  const isListe = room.gameMode === "liste";
  const current = isListe ? captureListeCallback(room) : () => rooms[room.roomCode] === room;
  const timers = isListe ? (room.listeTimers ||= new Set()) : (room.pendingTimeouts ||= new Set());
  let fired = false;
  const timer = setTimeout(() => {
    if (fired) return;
    fired = true;
    timers.delete(timer);
    if (current()) callback();
  }, delay);
  timers.add(timer);
  return timer;
}

function cancelRoomTimeout(room, timer) {
  clearTimeout(timer);
  room.pendingTimeouts?.delete(timer);
  room.listeTimers?.delete(timer);
}

function roomInterval(room, callback, delay) {
  const isListe = room.gameMode === "liste";
  const current = isListe ? captureListeCallback(room) : () => rooms[room.roomCode] === room;
  if (isListe) room.listeTimers ||= new Set();
  const timer = setInterval(() => {
    if (current()) callback();
    else {
      clearInterval(timer);
      room.listeTimers?.delete(timer);
    }
  }, delay);
  if (isListe) room.listeTimers.add(timer);
  return timer;
}

function clearListeTimers(room) {
  for (const timer of room.listeTimers || []) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  room.listeTimers?.clear();
}

function cancelRoomAbandon(room) {
  if (room.abandonTimer) clearTimeout(room.abandonTimer);
  room.abandonTimer = null;
}

function destroyRoom(room, disconnectSockets = false) {
  if (rooms[room.roomCode] !== room) return false;
  cancelRoomAbandon(room);
  clearListeTimers(room);
  for (const timer of room.pendingTimeouts || []) clearTimeout(timer);
  room.pendingTimeouts?.clear();
  for (const field of ["leugtasTimerInterval", "leBonOrdreInterval", "blindTestInterval",
    "leTourDuMondeInterval", "quiSuisJeInterval", "petitBacInterval", "petitBacStartTimeout",
    "encheresInterval"]) {
    if (room[field]) {
      clearTimeout(room[field]);
      clearInterval(room[field]);
      room[field] = null;
    }
  }
  if (room.mini?.timer) {
    clearInterval(room.mini.timer);
    room.mini.timer = null;
  }
  const mini = room.gameState?.currentMiniGameState;
  if (mini?.type === "le_bon_ordre") bonOrdreStore.release(mini.instanceId);
  delete rooms[room.roomCode];
  if (disconnectSockets) io.in(room.roomCode).disconnectSockets();
  return true;
}

function scheduleRoomAbandon(room) {
  if (rooms[room.roomCode] !== room) return;
  if (room.players.some((player) => player.isConnected)) {
    cancelRoomAbandon(room);
    return;
  }
  if (room.players.length === 0) {
    destroyRoom(room);
    return;
  }
  if (room.abandonTimer) return;
  room.abandonTimer = setTimeout(() => {
    room.abandonTimer = null;
    if (rooms[room.roomCode] === room && !room.players.some((player) => player.isConnected)) {
      destroyRoom(room);
    }
  }, ROOM_ABANDON_MS);
}

function prepareListeSequence(config, random = Math.random) {
  const validated = validateListeConfig(config);
  if (validated.error) throw new Error(validated.error);
  const pool = config.selectionMethod === "manual"
    ? [...validated.config.selectedMiniGames]
    : getListeOptions().miniGames.map((game) => game.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, config.gameCount);
}

function finishListeTournament(room) {
  if (room.gameMode !== "liste" || rooms[room.roomCode] !== room) return;
  if (room.listeTournament.finished) {
    room.listeTournament.generalRanking = getListeGeneralRanking(room);
    room.listeTournament.winners = room.listeTournament.generalRanking
      .filter((entry) => entry.place === 1).map((entry) => entry.playerId);
    io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
    io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
    return;
  }
  clearListeTimers(room);
  room.listeTournament.finished = true;
  room.listeTournament.leaderboardSound = null;
  room.listeTournament.finaleStartedAt = Date.now();
  room.gameState.phase = "listeFinished";
  room.listeTournament.generalRanking = getListeGeneralRanking(room);
  room.listeTournament.winners = room.listeTournament.generalRanking
    .filter((entry) => entry.place === 1).map((entry) => entry.playerId);
  io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
  io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
}

function startNextListeRound(room) {
  const gs = room.gameState;
  if (room.gameMode !== "liste" || room.listeTournament.finished ||
      !["listeIntro", "listeTransition", "listeLeaderboard"].includes(gs.phase)) return;
  clearListeTimers(room);
  if (gs.roundNumber >= room.listeTournament.sequence.length ||
      !room.players.some((p) => isListeParticipant(room, p))) {
    finishListeTournament(room);
    return;
  }
  gs.currentMiniGame = room.listeTournament.sequence[gs.roundNumber];
  gs.roundNumber++;
  gs.phase = "drawingGame";
  room.listeTournament.leaderboardSound = null;
  gs.readyPlayers = {};
  gs.currentMiniGameState = null;
  room.mini = null;
  room.activePlayersList = null;
  resetRoundStats(room);
  io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
  io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  // Secours si l'hôte se déconnecte pendant le tirage.
  roomTimeout(room, () => {
    gs.phase = "rules";
    io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  }, LISTE_DRAW_DURATION_MS);
}

function endListeMiniGame(room) {
  const gs = room.gameState;
  if (gs.phase !== "listeRoundEnd" || room.listeTournament.finished) return;
  const key = `${room.listeTournament.tournamentId}:${gs.roundNumber}`;
  const result = finalizeListeMiniGameResult(room, key);
  if (!result.applied) return;
  clearListeTimers(room);
  gs.miniGamesAlreadyPlayed.push(gs.currentMiniGame);
  const tournament = room.listeTournament;
  const unusedSounds = LISTE_LEADERBOARD_SOUNDS.filter(
    (sound) => !tournament.leaderboardSoundsUsed.includes(sound)
  );
  const sound = unusedSounds.length ? shuffleCopy(unusedSounds)[0] : null;
  if (sound) tournament.leaderboardSoundsUsed.push(sound);
  tournament.leaderboardSound = sound ? {
    url: sound,
    tournamentId: tournament.tournamentId,
    roundNumber: gs.roundNumber,
    startedAt: Date.now()
  } : null;
  gs.phase = "listeLeaderboard";
  io.to(room.roomCode).emit("roomUpdate", serializeRoom(room));
  io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  roomTimeout(room, () => startNextListeRound(room), LISTE_LEADERBOARD_DURATION_MS);
}

function beginListeRoundEnd(room) {
  if (room.gameMode !== "liste" || room.gameState.phase !== "playing") return;
  clearListeTimers(room);
  room.gameState.phase = "listeRoundEnd";
  publishListeContext(room);
}

const PENAVE_THEME_MS = 1500;
// a_toi_de_jouer.mp3 dure 917 ms ; le navigateur actif confirme sa fin.
const PENAVE_TURN_CUE_MS = 1700;
const PENAVE_BOARD_MS = 850;
const PENAVE_VERDICT_MS = 1100;
const PENAVE_ELIMINATION_MS = 3200;
const PENAVE_VICTORY_MS = 2800;
const PENAVE_RANKING_MS = 5000;

function pickPenaveQuestion() {
  if (penaveBankError || !penaveBank) throw new Error(penaveBankError || "Banque Pénave ou Nachave indisponible.");
  if (fs.existsSync(HISTORY_FILE)) {
    let history;
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); }
    catch { throw new Error("Historique des questions illisible : Pénave ou Nachave ne peut pas démarrer."); }
    if (history?.penave_ou_nachave != null && !Array.isArray(history.penave_ou_nachave)) {
      throw new Error("Historique Pénave ou Nachave invalide : tableau d'identifiants attendu.");
    }
  }
  let available = getUnusedQuestions(penaveBank.questions, "penave_ou_nachave");
  if (!available.length) {
    resetGameHistory("penave_ou_nachave");
    available = getUnusedQuestions(penaveBank.questions, "penave_ou_nachave");
  }
  if (!available.length) throw new Error("Aucune affirmation Pénave ou Nachave disponible.");
  const question = shuffleCopy(available)[0];
  markQuestionsAsPlayed([question], "penave_ou_nachave");
  if (!getPlayedHistory().penave_ou_nachave?.includes(question.id)) {
    throw new Error("Impossible d'enregistrer l'affirmation Pénave ou Nachave dans l'historique.");
  }
  return question;
}

function getPenaveMini(room) {
  const mini = room.gameState?.currentMiniGameState;
  return room.gameMode === "liste" && !room.listeTournament.finished &&
    room.gameState.currentMiniGame === "penave_ou_nachave" &&
    ["playing", "listeRoundEnd"].includes(room.gameState.phase) &&
    mini?.type === "penave_ou_nachave" ? mini : null;
}

function getPenaveSnapshot(room) {
  const mini = getPenaveMini(room);
  if (!mini) return null;
  return {
    gameMode: "liste", instanceId: mini.instanceId, subPhase: mini.subPhase,
    theme: mini.theme, affirmation: mini.question.question,
    order: mini.order,
    survivorIds: mini.survivors.filter((id) =>
      isListeParticipant(room, room.players.find((player) => player.playerId === id))),
    turnNumber: mini.turnNumber, passageId: mini.passageId,
    activePlayerId: mini.activePlayerId, deadline: mini.deadline,
    remainingMs: mini.deadline ? Math.max(0, mini.deadline - Date.now()) : 0,
    correctionElapsedMs: mini.subPhase === "correction"
      ? Date.now() - mini.correctionStartedAt : null,
    gradeElapsedMs: mini.entries.at(-1)?.gradedAt != null
      ? Date.now() - mini.entries.at(-1).gradedAt : null,
    phaseEndsAt: mini.phaseEndsAt || null, announcement: mini.announcement || null,
    correctionStartedAt: mini.correctionStartedAt || null,
    cueStartedAt: mini.cueStartedAt || null,
    entries: mini.entries, eliminatedIds: Object.keys(mini.stats).filter((id) => mini.stats[id].eliminatedRound),
    roundEliminatedIds: mini.roundEliminatedIds || [],
    ranking: mini.ranking || null, durationMs: PENAVE_DURATION_MS
  };
}

function publishPenave(room) {
  io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
}

function startPenave(room) {
  if (room.gameMode !== "liste" || room.gameState.currentMiniGame !== "penave_ou_nachave") return;
  const question = pickPenaveQuestion();
  const players = room.players.filter((player) => isListeParticipant(room, player));
  const order = shuffleCopy(players.map((player) => player.playerId));
  const mini = {
    type: "penave_ou_nachave", instanceId: randomUUID(), question,
    theme: penaveBank.themes.get(question.theme_id), subPhase: "theme",
    order, tieOrder: shuffleCopy(order), survivors: [...order], queue: [],
    turnNumber: 1, passageId: 0, activePlayerId: null, deadline: null,
    phaseEndsAt: Date.now() + PENAVE_THEME_MS, entries: [], stats: {}, ranking: null
  };
  for (const id of order) mini.stats[id] = { correct: 0, timeMs: 0, eliminatedRound: null };
  room.gameState.currentMiniGameState = mini;
  publishPenave(room);
  roomTimeout(room, () => {
    mini.queue = mini.survivors.filter((id) => isListeParticipant(room, room.players.find((p) => p.playerId === id)));
    penaveOpenPassage(room);
  }, PENAVE_THEME_MS);
}

function penaveOpenPassage(room) {
  const mini = getPenaveMini(room);
  if (!mini || mini.subPhase === "end_logo") return;
  mini.queue = mini.queue.filter((id) => isListeParticipant(room, room.players.find((p) => p.playerId === id)));
  if (!mini.queue.length) return penaveCloseTurn(room);
  mini.activePlayerId = mini.queue.shift();
  mini.passageId++;
  mini.subPhase = "cue";
  mini.cueStartedAt = Date.now();
  mini.openedAt = null;
  mini.deadline = null;
  mini.phaseEndsAt = mini.cueStartedAt + PENAVE_TURN_CUE_MS;
  mini.announcement = null;
  publishPenave(room);
  const passageId = mini.passageId;
  const activePlayerId = mini.activePlayerId;
  roomTimeout(room, () => {
    if (mini.passageId === passageId) penaveBeginAnswer(room, activePlayerId);
  }, PENAVE_TURN_CUE_MS);
}

function penaveBeginAnswer(room, playerId) {
  const mini = getPenaveMini(room);
  if (!mini || mini.subPhase !== "cue" || mini.activePlayerId !== playerId) return;
  if (!isListeParticipant(room, room.players.find((player) => player.playerId === playerId))) {
    mini.subPhase = "between";
    return penaveOpenPassage(room);
  }
  mini.subPhase = "answer";
  mini.openedAt = Date.now();
  mini.deadline = mini.openedAt + PENAVE_DURATION_MS;
  mini.phaseEndsAt = null;
  publishPenave(room);
  const passageId = mini.passageId;
  roomTimeout(room, () => {
    if (mini.passageId === passageId) penaveSubmit(room, playerId, "", true);
  }, PENAVE_DURATION_MS);
}

function penaveSubmit(room, playerId, answer, pass = false) {
  const mini = getPenaveMini(room);
  if (!mini || mini.subPhase !== "answer" || mini.activePlayerId !== playerId) return false;
  const now = Date.now();
  if (!pass && now >= mini.deadline) return penaveSubmit(room, playerId, "", true);
  const value = String(answer || "").trim();
  if (!pass && !value) return false;
  const entry = {
    passageId: mini.passageId, turnNumber: mini.turnNumber, playerId,
    pseudo: room.players.find((p) => p.playerId === playerId)?.pseudo || "",
    answer: pass ? "Je passe" : value,
    status: pass ? "passed" : "pending",
    elapsedMs: pass ? PENAVE_DURATION_MS : Math.min(PENAVE_DURATION_MS, now - mini.openedAt)
  };
  mini.entries.push(entry);
  mini.deadline = null;
  if (pass) {
    mini.stats[playerId].timeMs += PENAVE_DURATION_MS;
    mini.subPhase = "between";
    publishPenave(room);
    roomTimeout(room, () => penaveOpenPassage(room), PENAVE_VERDICT_MS);
  } else {
    mini.subPhase = "correction";
    mini.correctionStartedAt = now;
    publishPenave(room);
    const passageId = mini.passageId;
    roomTimeout(room, () => {
      if (mini.subPhase === "correction" && mini.passageId === passageId) publishPenave(room);
    }, PENAVE_BOARD_MS);
  }
  return true;
}

function penaveGrade(room, accepted) {
  const mini = getPenaveMini(room);
  if (!mini || mini.subPhase !== "correction" ||
      Date.now() - mini.correctionStartedAt < PENAVE_BOARD_MS) return false;
  const entry = mini.entries.at(-1);
  if (!entry || entry.status !== "pending" || entry.passageId !== mini.passageId) return false;
  entry.status = accepted ? "accepted" : "refused";
  entry.gradedAt = Date.now();
  mini.stats[entry.playerId].timeMs += accepted ? entry.elapsedMs : PENAVE_DURATION_MS;
  if (accepted) mini.stats[entry.playerId].correct++;
  mini.subPhase = "between";
  publishPenave(room);
  roomTimeout(room, () => penaveOpenPassage(room), PENAVE_VERDICT_MS);
  return true;
}

function penaveFreezeRanking(room) {
  const mini = getPenaveMini(room);
  if (!mini) return;
  mini.ranking = rankPenaveResults(room.players.filter((p) => mini.stats[p.playerId]),
    mini, room.listeTournament.initialParticipantCount);
  for (const entry of mini.ranking) {
    const player = room.players.find((p) => p.playerId === entry.playerId);
    player.roundScore = entry.score;
    player.roundTime = entry.time;
  }
}

function penaveCloseTurn(room) {
  const mini = getPenaveMini(room);
  if (!mini || !["answer", "between", "theme"].includes(mini.subPhase)) return;
  const current = mini.survivors.filter((id) => isListeParticipant(room, room.players.find((p) => p.playerId === id)));
  // Un joueur sorti de Pénave peut encore disputer les manches suivantes du tournoi.
  if (!room.players.some((player) => isListeParticipant(room, player))) return finishListeTournament(room);
  const success = new Set(mini.entries.filter((entry) => entry.turnNumber === mini.turnNumber &&
    entry.status === "accepted").map((entry) => entry.playerId));
  const failed = current.filter((id) => !success.has(id));
  mini.roundEliminatedIds = failed;
  for (const id of failed) mini.stats[id].eliminatedRound = mini.turnNumber;
  mini.survivors = current.filter((id) => success.has(id));
  const final = mini.survivors.length <= 1;
  if (final) penaveFreezeRanking(room);
  const names = failed.map((id) => room.players.find((p) => p.playerId === id)?.pseudo || "");
  mini.announcement = names.length
    ? `${names.join(", ")} ${names.length === 1 ? "est éliminé" : "sont éliminés"}`
    : `Tour ${mini.turnNumber} terminé`;
  mini.subPhase = "round_summary";
  mini.activePlayerId = null;
  mini.phaseEndsAt = Date.now() + (names.length ? PENAVE_ELIMINATION_MS : 1300);
  publishPenave(room);
  roomTimeout(room, () => {
    if (final || mini.survivors.length <= 1) {
      if (!mini.ranking) penaveFreezeRanking(room);
      return penaveVictory(room);
    }
    mini.turnNumber++;
    mini.queue = mini.order.filter((id) => mini.survivors.includes(id) &&
      isListeParticipant(room, room.players.find((p) => p.playerId === id)));
    mini.subPhase = "between";
    penaveOpenPassage(room);
  }, names.length ? PENAVE_ELIMINATION_MS : 1300);
}

function penaveVictory(room) {
  const mini = getPenaveMini(room);
  if (!mini || mini.subPhase !== "round_summary") return;
  if (!mini.ranking?.length) return finishListeTournament(room);
  mini.announcement = `${mini.ranking[0].pseudo} gagne la partie`;
  mini.subPhase = "victory";
  mini.phaseEndsAt = Date.now() + PENAVE_VICTORY_MS;
  publishPenave(room);
  roomTimeout(room, () => {
    mini.subPhase = "final_ranking";
    mini.phaseEndsAt = Date.now() + PENAVE_RANKING_MS;
    publishPenave(room);
    roomTimeout(room, () => {
      mini.subPhase = "end_logo";
      mini.phaseEndsAt = Date.now() + LISTE_END_LOGO_DURATION_MS;
      beginListeRoundEnd(room);
      publishPenave(room);
      roomTimeout(room, () => endListeMiniGame(room), LISTE_END_LOGO_DURATION_MS);
    }, PENAVE_RANKING_MS);
  }, PENAVE_VICTORY_MS);
}

function penaveWithdraw(room, playerId) {
  const mini = getPenaveMini(room);
  if (!mini || !mini.stats[playerId]) return;
  mini.queue = mini.queue.filter((id) => id !== playerId);
  mini.survivors = mini.survivors.filter((id) => id !== playerId);
  if (mini.subPhase === "correction" && mini.activePlayerId === playerId) {
    mini.entries.at(-1).status = "withdrawn";
    mini.subPhase = "between";
    roomTimeout(room, () => penaveOpenPassage(room), 0);
  } else if (["cue", "answer"].includes(mini.subPhase) && mini.activePlayerId === playerId) {
    mini.subPhase = "between";
    mini.deadline = null;
    roomTimeout(room, () => penaveOpenPassage(room), 0);
  }
  if (mini.ranking) penaveFreezeRanking(room);
  if (mini.subPhase === "victory" && mini.ranking?.length) {
    mini.announcement = `${mini.ranking[0].pseudo} gagne la partie`;
  }
  publishPenave(room);
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

  room.leugtasTimerInterval = roomInterval(room, () => {
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
    return shuffleCopy(pool).slice(0, count);
  };

  const selected = [
    ...pickFromPool(getPool(available, 1), 2),
    ...pickFromPool(getPool(available, 4), 1),
    ...pickFromPool(getPool(available, 6), 1),
    ...pickFromPool(getPool(available, 8), 2),
    ...pickFromPool(getMixedPool(available), 1)
  ];

  markQuestionsAsPlayed(selected, "faux_vrai");

  const finalQuestions = shuffleCopy(selected);

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

  publishListeContext(room);
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
  roomTimeout(room, () => {
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

  game.timer = roomInterval(room, () => {
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

  if (room.gameMode === "liste" && game.isRevealing) return;
  game.isRevealing = true;

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

  io.to(roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));

  // Passage de 8500 à 7000 pour isLastQuestion afin d'aligner avec l'animation client
  const waitTime = isLastQuestion ? 7000 : 5500;

  roomTimeout(room, () => {
    nextFauxVrai(roomCode);
  }, waitTime);
}

function nextFauxVrai(roomCode) {
  const room = rooms[roomCode];
  const game = room?.mini;
  if (!room || !game) return;

  game.index++;

  if (game.index >= game.list.length) {
    beginListeRoundEnd(room);
    io.to(roomCode).emit("fauxVraiEnd");

    roomTimeout(room, () => {
      endMiniGame(roomCode);
    }, room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);

    return;
  }

  game.answers = {};
  game.answerTimes = {};
  game.isRevealing = false;
  sendFauxVraiQuestion(roomCode);
}

function endMiniGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.gameState?.currentMiniGameState?.type === "le_bon_ordre") {
    bonOrdreStore.release(room.gameState.currentMiniGameState.instanceId);
  }
  if (room.gameMode === "liste") return endListeMiniGame(room);

  // --- S�CURIT� ANTI DOUBLE-APPEL ---
  if (room.isEnding) return;
  room.isEnding = true;
  roomTimeout(room, () => {
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
    roomTimeout(room, () => {
      if (rooms[roomCode] === room) {
        console.log(`Fermeture auto de la salle ${roomCode}`);
        destroyRoom(room, true);
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
    roomTimeout(room, () => {
        if (rooms[roomCode] !== room || room.gameState !== gs ||
            room.gameMode !== "battle_royale") return;

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
  io.to(roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));

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

      publishListeContext(room);
      io.to(roomCode).emit("leugtasQuestion", {
        question: activeMini.questions[activeMini.questionIndex],
        index: activeMini.questionIndex + 1,
        total: activeMini.questions.length
      });

      roomTimeout(room, () => {
        startLeugtasTimer(room);
      }, 2500);
      return;
    }

    beginListeRoundEnd(room);
    io.to(roomCode).emit("leugtasEnd");

    roomTimeout(room, () => {
      activeMini.isRevealing = false;
      activeMini.finished = false;
      endMiniGame(roomCode);
    }, room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);
  };

  const waitTime = isLastQuestion ? 7700 : 5500;

  if (room.gameMode === "liste") {
    roomTimeout(room, continueToNextQuestion, waitTime);
    return;
  }

  if (mini.allAnsweredEarly) {
    await new Promise((res) => roomTimeout(room, res, waitTime));
    mini.allAnsweredEarly = false;
    continueToNextQuestion();
    return;
  }

  roomTimeout(room, () => {
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

function getBonOrdreContext(room, mini, questionIndex = mini.questionIndex) {
  return {
    roomCode: room.roomCode,
    gameMode: room.gameMode,
    roundNumber: room.gameState.roundNumber,
    instanceId: mini.instanceId,
    questionId: mini.questions[questionIndex]?.id,
    questionIndex,
    subPhase: mini.subPhase
  };
}

function getBonOrdrePublicState(room, mini) {
  return {
    ...getBonOrdreContext(room, mini),
    phaseStartedAt: mini.phaseStartedAt,
    phaseEndsAt: mini.phaseEndsAt,
    durationMs: Math.max(0, mini.phaseEndsAt - mini.phaseStartedAt),
    remainingMs: Math.max(0, mini.phaseEndsAt - Date.now())
  };
}

function publishBonOrdrePhase(room) {
  publishListeContext(room);
  io.to(room.roomCode).emit("gameStateUpdate", getGameStateSummary(room));
}

function rejectBonOrdreAnswer(socket, action, message) {
  const room = rooms[socket.roomCode];
  socket.emit("leBonOrdreAnswerRejected", {
    roomCode: socket.roomCode,
    gameMode: action?.gameMode ?? room?.gameMode,
    roundNumber: action?.roundNumber ?? room?.gameState?.roundNumber,
    instanceId: action?.instanceId,
    questionId: action?.questionId,
    questionIndex: action?.questionIndex,
    message
  });
}

// Chaque délai conserve l'identité du jeu ET celle de la question, dans les
// deux modes. Un ancien intervalle ne peut pas terminer une nouvelle manche.
function captureBonOrdreCallback(room, mini, questionIndex = mini.questionIndex,
  phase = room.gameState.phase) {
  const gs = room.gameState;
  const gameMode = room.gameMode;
  const roundNumber = gs.roundNumber;
  const instanceId = mini.instanceId;
  const subPhase = mini.subPhase;
  return () => rooms[room.roomCode] === room && room.gameState === gs &&
    room.gameMode === gameMode && gs.phase === phase && gs.roundNumber === roundNumber &&
    gs.currentMiniGame === "le_bon_ordre" && gs.currentMiniGameState === mini &&
    mini.instanceId === instanceId && mini.questionIndex === questionIndex && mini.subPhase === subPhase;
}

function getBonOrdreTimer(mini) {
  const total = mini.timer?.totalSeconds ?? LE_BON_ORDRE_DURATION;
  const remaining = mini.timer?.running
    ? Math.max(0, Math.min(total, (mini.timer.endsAt - Date.now()) / 1000))
    : mini.timer?.remainingSeconds ?? total;
  return { remaining, total, active: mini.subPhase === "answering" && !!mini.timer?.running && remaining > 0 };
}

function getBonOrdreQuestionSnapshot(room, mini, playerId = null, isReload = false) {
  const q = mini.questions[mini.questionIndex];
  const saved = playerId && mini.playerAnswers[playerId];
  return {
    ...getBonOrdreContext(room, mini),
    ...getBonOrdrePublicState(room, mini),
    question: safeBonOrdreQuestion(q),
    themeName: q.nom,
    index: mini.questionIndex + 1,
    total: mini.questions.length,
    hasAnswered: !!saved,
    savedAnswer: saved ? { orderedIds: saved.orderedIds?.slice() ?? null, pass: saved.pass } : null,
    timer: getBonOrdreTimer(mini),
    isReload
  };
}

function sendLeBonOrdreQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room?.gameState?.currentMiniGameState;
  if (!mini || mini.type !== "le_bon_ordre" || mini.finished) return;
  mini.timer = null;
  mini.subPhase = "theme";
  mini.phaseStartedAt = Date.now();
  mini.phaseEndsAt = mini.phaseStartedAt + 2500;
  const current = captureBonOrdreCallback(room, mini);
  publishBonOrdrePhase(room);
  io.to(roomCode).emit("leBonOrdreQuestion", getBonOrdreQuestionSnapshot(room, mini));
  roomTimeout(room, () => {
    if (current() && !mini.finished) startLeBonOrdreTimer(room, mini);
  }, 2500);
}

function startLeBonOrdreTimer(room, mini = room.gameState.currentMiniGameState) {
  if (!mini || !captureBonOrdreCallback(room, mini)() || mini.finished ||
      mini.subPhase !== "theme" || mini.timer?.running) return;
  mini.startTime = Date.now();
  mini.subPhase = "answering";
  mini.phaseStartedAt = mini.startTime;
  mini.phaseEndsAt = mini.startTime + LE_BON_ORDRE_DURATION * 1000;
  mini.timer = {
    totalSeconds: LE_BON_ORDRE_DURATION,
    remainingSeconds: LE_BON_ORDRE_DURATION,
    endsAt: mini.startTime + LE_BON_ORDRE_DURATION * 1000,
    running: true
  };
  const emitTimer = () => io.to(room.roomCode).emit("leBonOrdreTimerUpdate", {
    ...getBonOrdreContext(room, mini), ...getBonOrdreTimer(mini)
  });
  const current = captureBonOrdreCallback(room, mini);
  publishBonOrdrePhase(room);
  emitTimer();
  if (room.leBonOrdreInterval) clearInterval(room.leBonOrdreInterval);
  const interval = roomInterval(room, () => {
    if (!current() || mini.finished || !mini.timer?.running) {
      clearInterval(interval);
      return;
    }
    mini.timer.remainingSeconds = getBonOrdreTimer(mini).remaining;
    emitTimer();
    if (mini.timer.remainingSeconds <= 0) endLeBonOrdreQuestion(room.roomCode, mini);
  }, 1000);
  room.leBonOrdreInterval = interval;
}

function endLeBonOrdreQuestion(roomCode, expectedMini = null) {
  const room = rooms[roomCode];
  const mini = room?.gameState?.currentMiniGameState;
  if (!mini || mini.type !== "le_bon_ordre" || mini.finished || mini.subPhase !== "answering" ||
      room.gameState.phase !== "playing" || room.gameState.currentMiniGame !== "le_bon_ordre" ||
      (expectedMini && mini !== expectedMini)) return;
  const previousPlayers = getMiniGameScoreUpdate(room).players.map((player) => ({ ...player }));
  // La mutation de phase ferme immédiatement la question, même si deux causes
  // de clôture (dernière réponse et timer) arrivent dans le même tour de boucle.
  mini.subPhase = "correction";
  mini.phaseStartedAt = Date.now();
  mini.phaseEndsAt = mini.phaseStartedAt + 15_000;
  if (mini.timer) {
    mini.timer.remainingSeconds = getBonOrdreTimer(mini).remaining;
    mini.timer.running = false;
  }
  if (room.leBonOrdreInterval) clearInterval(room.leBonOrdreInterval);
  room.leBonOrdreInterval = null;
  for (const playerId of mini.participantIds) {
    mini.history[playerId] ||= {};
    mini.history[playerId][mini.questionIndex] = mini.playerAnswers[playerId] || null;
  }
  mini.previousPlayers = previousPlayers;
  applyBonOrdreAutomaticResults(room, mini, mini.questionIndex);
  publishBonOrdrePhase(room);
  for (const socket of io.sockets.sockets.values()) {
    if (getSocketRoom(socket) === room) sendBonOrdrePersonalCorrection(socket, room, mini);
  }
  const current = captureBonOrdreCallback(room, mini);
  roomTimeout(room, () => {
    if (current()) startBonOrdreLeaderboard(room, mini);
  }, 15_000);
}

function maybeEndBonOrdreQuestion(room) {
  const mini = currentActionMini(room, "le_bon_ordre");
  if (!mini || mini.finished || mini.subPhase !== "answering" || !mini.timer?.running) return;
  const activePlayers = room.players.filter((p) =>
    mini.participantIds.includes(p.playerId) && isActiveMiniGamePlayer(room, p));
  if (activePlayers.length > 0 && activePlayers.every((p) => Object.hasOwn(mini.playerAnswers, p.playerId))) {
    endLeBonOrdreQuestion(room.roomCode, mini);
  }
}

function applyBonOrdreAutomaticResults(room, mini, questionIndex) {
  mini.scoresGiven ||= {};
  mini.timesApplied ||= {};
  mini.automaticResults ||= {};
  mini.scoresGiven[questionIndex] ||= {};
  mini.timesApplied[questionIndex] ||= {};
  mini.automaticResults[questionIndex] ||= {};
  for (const player of room.players) {
    if (!mini.participantIds.includes(player.playerId) || !isActiveMiniGamePlayer(room, player) ||
        Object.hasOwn(mini.scoresGiven[questionIndex], player.playerId)) continue;
    const saved = mini.history[player.playerId]?.[questionIndex];
    const result = gradeBonOrdre(mini.questions[questionIndex],
      saved?.pass ? "pass" : saved?.orderedIds ?? null);
    const revision = calculateGradeRevision({
      newScore: result.grade,
      responseTime: getQuestionResponseTime(mini.responseTimesByQuestion,
        questionIndex, player.playerId, LE_BON_ORDRE_DURATION),
      maxDuration: LE_BON_ORDRE_DURATION,
      miniGameType: "le_bon_ordre"
    });
    player.score += revision.scoreDelta;
    player.roundScore += revision.scoreDelta;
    player.roundTime += revision.timeDelta;
    player.totalTime += revision.timeDelta;
    mini.automaticResults[questionIndex][player.playerId] = result;
    mini.scoresGiven[questionIndex][player.playerId] = result.grade;
    mini.timesApplied[questionIndex][player.playerId] = revision.appliedTime;
  }
}

function sendBonOrdrePersonalCorrection(socket, room, mini) {
  if (getSocketRoom(socket) !== room || mini.subPhase !== "correction" ||
      room.gameState.currentMiniGameState !== mini || Date.now() >= mini.phaseEndsAt) return;
  const question = mini.questions[mini.questionIndex];
  const player = room.players.find((entry) => entry.playerId === socket.playerId);
  const isParticipant = mini.participantIds.includes(socket.playerId);
  const saved = mini.history[socket.playerId]?.[mini.questionIndex];
  const result = isParticipant
    ? mini.automaticResults[mini.questionIndex]?.[socket.playerId] ||
      gradeBonOrdre(question, saved?.pass ? "pass" : saved?.orderedIds ?? null)
    : { expected: gradeBonOrdre(question, null).expected, positions: [],
      grade: null, correctCount: null, status: "spectator" };
  socket.emit("leBonOrdreCorrection", {
    ...getBonOrdreContext(room, mini),
    questionText: question.question,
    currentQIndex: mini.questionIndex + 1,
    totalQ: mini.questions.length,
    playerPseudo: isParticipant ? player.pseudo : null,
    isParticipant,
    correctionStartedAt: mini.phaseStartedAt,
    correctionEndsAt: mini.phaseEndsAt,
    durationMs: 15_000,
    remainingMs: Math.max(0, mini.phaseEndsAt - Date.now()),
    bonOrdreData: { ...result, ...getBonOrdreContext(room, mini) }
  });
}

function getBonOrdreLeaderboard(room, mini, isReload = false) {
  const activeIds = new Set(room.players.filter((player) =>
    isActiveMiniGamePlayer(room, player)).map((player) => player.playerId));
  return {
    ...getBonOrdreContext(room, mini),
    previousPlayers: mini.previousPlayers.filter((player) => activeIds.has(player.id)),
    players: getMiniGameScoreUpdate(room).players,
    startedAt: mini.phaseStartedAt,
    endsAt: mini.phaseEndsAt,
    durationMs: mini.phaseEndsAt - mini.phaseStartedAt,
    remainingMs: Math.max(0, mini.phaseEndsAt - Date.now()),
    isLastQuestion: mini.questionIndex === mini.questions.length - 1,
    isReload
  };
}

function startBonOrdreLeaderboard(room, mini) {
  if (rooms[room.roomCode] !== room || room.gameState.currentMiniGameState !== mini ||
      room.gameState.phase !== "playing" || mini.subPhase !== "correction") return;
  mini.subPhase = "leaderboard";
  mini.phaseStartedAt = mini.phaseEndsAt;
  const isLastQuestion = mini.questionIndex === mini.questions.length - 1;
  mini.phaseEndsAt = mini.phaseStartedAt + (isLastQuestion ? 4500 : 3000);
  publishBonOrdrePhase(room);
  io.to(room.roomCode).emit("leBonOrdreLeaderboard", getBonOrdreLeaderboard(room, mini));
  const current = captureBonOrdreCallback(room, mini);
  roomTimeout(room, () => {
    if (current()) finishBonOrdreLeaderboard(room, mini);
  }, Math.max(0, mini.phaseEndsAt - Date.now()));
}

function refreshBonOrdreLeaderboard(room) {
  const mini = room.gameState?.currentMiniGameState;
  if (mini?.type === "le_bon_ordre" && mini.subPhase === "leaderboard" && room.gameState.phase === "playing") {
    io.to(room.roomCode).emit("leBonOrdreLeaderboard", getBonOrdreLeaderboard(room, mini, true));
  }
}

function getBonOrdreExit(room, mini, isReload = false) {
  return { ...getBonOrdreContext(room, mini), startedAt: mini.phaseStartedAt,
    endsAt: mini.phaseEndsAt, durationMs: mini.phaseEndsAt - mini.phaseStartedAt,
    remainingMs: Math.max(0, mini.phaseEndsAt - Date.now()),
    players: getMiniGameScoreUpdate(room).players, isReload };
}

function finishBonOrdreLeaderboard(room, mini) {
  if (rooms[room.roomCode] !== room || room.gameState.currentMiniGameState !== mini ||
      room.gameState.phase !== "playing" || mini.subPhase !== "leaderboard") return;
  if (mini.questionIndex < mini.questions.length - 1) {
    mini.questionIndex++;
    mini.playerAnswers = {};
    sendLeBonOrdreQuestion(room.roomCode);
    return;
  }
  mini.subPhase = "ending";
  mini.finished = true;
  mini.phaseStartedAt = Date.now();
  mini.phaseEndsAt = mini.phaseStartedAt + (room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);
  beginListeRoundEnd(room);
  publishBonOrdrePhase(room);
  io.to(room.roomCode).emit("leBonOrdreExit", getBonOrdreExit(room, mini));
  const current = captureBonOrdreCallback(room, mini);
  roomTimeout(room, () => {
    if (current() && !mini.completionDispatched) {
      mini.completionDispatched = true;
      endMiniGame(room.roomCode);
    }
  }, Math.max(0, mini.phaseEndsAt - Date.now()));
}

// Une restauration ne doit jamais réouvrir une phase dont l'échéance est passée,
// même si la boucle d'événements n'a pas encore exécuté son callback de fin.
function advanceBonOrdrePhase(room, mini) {
  if (rooms[room.roomCode] !== room || room.gameState.currentMiniGameState !== mini ||
      room.gameState.currentMiniGame !== "le_bon_ordre") return;
  if (room.gameState.phase === "playing") {
    if (mini.subPhase === "correction" && Date.now() >= mini.phaseEndsAt) startBonOrdreLeaderboard(room, mini);
    if (mini.subPhase === "leaderboard" && Date.now() >= mini.phaseEndsAt) finishBonOrdreLeaderboard(room, mini);
  }
  if (mini.subPhase === "ending" && Date.now() >= mini.phaseEndsAt && !mini.completionDispatched &&
      ["playing", "listeRoundEnd"].includes(room.gameState.phase)) {
    mini.completionDispatched = true;
    endMiniGame(room.roomCode);
  }
}

function startCorrectionPhase(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  const mini = gs.currentMiniGameState;
  if (!mini) return;
  if (mini.type === "le_bon_ordre") return;

  mini.correctionIndex = 0;
  mini.gradingPlayerIndex = 0;
  mini.scoresGiven = {};
  room.activePlayersList = room.gameMode === "liste"
    ? room.players.filter((p) => isListeParticipant(room, p))
    : room.players.filter((p) => !p.eliminated && !p.isSpectator);

  if (mini.type === "matrice_football") {
    mini.gradingDetails = {};
    mini.timesApplied = { 0: {} };
    mini.scoresGiven = { 0: {} };
    for (const player of room.activePlayersList) {
      const answers = mini.playerAnswers[player.playerId];
      const automatic = {};
      for (let index = 0; index < 9; index++) {
        if (!answers || !answers[index]?.trim()) automatic[index] = 0;
      }
      mini.gradingDetails[player.playerId] = automatic;
      if (!answers) {
        mini.scoresGiven[0][player.playerId] = 0;
        mini.timesApplied[0][player.playerId] = MATRICE_FOOTBALL_DURATION_SECONDS;
        player.roundTime += MATRICE_FOOTBALL_DURATION_SECONDS;
        player.totalTime += MATRICE_FOOTBALL_DURATION_SECONDS;
      } else if (Object.keys(automatic).length === 9) {
        mini.scoresGiven[0][player.playerId] = 0;
        const time = mini.responseTimes[player.playerId];
        mini.timesApplied[0][player.playerId] = time;
        player.roundTime += time;
        player.totalTime += time;
      }
    }
  }

  sendCorrectionData(roomCode);
}

function sendCorrectionData(roomCode, targetSocket = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const gs = room.gameState;
  if (!gs) return;
  const mini = gs.currentMiniGameState;
  if (mini?.type === "le_bon_ordre") return;

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
  const matriceFootballData = mini.type === "matrice_football" ? {
    matrix: mini.matrix,
    instanceId: mini.instanceId,
    answers: mini.playerAnswers[playerToCheck.playerId] || {},
    submitted: Object.hasOwn(mini.playerAnswers, playerToCheck.playerId),
    savedDetails: mini.gradingDetails?.[playerToCheck.playerId] || {},
    playerId: playerToCheck.playerId,
    roundNumber: gs.roundNumber
  } : null;

  const q = mini.questions[mini.correctionIndex];

  // --- FIX : AJOUT DU GARDE-FOU ICI ---
  if (!q) {
      console.log(`[DEBUG] Correction termin�e ou index invalide (${mini.correctionIndex}). Annulation de l'envoi.`);
      return; 
  }
  // ------------------------------------

  const history = mini.history[playerToCheck.playerId] || {};
  const answer =
    ["petit_bac", "matrice_football"].includes(mini.type)
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

  publishListeContext(room, targetSocket || io.to(roomCode));
  emitCorrectionUpdate({
    gameMode: room.gameMode,
    roomCode,
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
    petitBacData,
    matriceFootballData
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
        ...shuffleCopy(allTv).slice(0, 2),
        ...shuffleCopy(allMusic).slice(0, 6)
    ];
    rawGameSet = shuffleCopy(rawGameSet);
    
    markQuestionsAsPlayed(rawGameSet, "blind_test");
  } else {
    var rawGameSet = [
        ...shuffleCopy(tvPool).slice(0, 2),
        ...shuffleCopy(musicPool).slice(0, 6)
    ];
    rawGameSet = shuffleCopy(rawGameSet);
    
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

  publishListeContext(room);
  io.to(roomCode).emit("blindTestQuestion", {
    question: q,
    themeName: q.themeName,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  roomTimeout(room, () => {
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

  room.blindTestInterval = roomInterval(room, () => {
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
    roomTimeout(room, () => {
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
  return shuffleCopy(selectedQuestions);
}

function sendLeTourDuMondeQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room.gameState.currentMiniGameState;
  const q = mini.questions[mini.questionIndex];

  publishListeContext(room);
  io.to(roomCode).emit("leTourDuMondeQuestion", {
    question: q,
    themeName: q.themeName,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  roomTimeout(room, () => {
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

  room.leTourDuMondeInterval = roomInterval(room, () => {
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
    roomTimeout(room, () => {
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

  const shuffled = shuffleCopy(available);
  const selected = shuffled.slice(0, 8);

  markQuestionsAsPlayed(selected, "qui_suis_je");
  return selected;
}

function sendQuiSuisJeQuestion(roomCode) {
  const room = rooms[roomCode];
  const mini = room.gameState.currentMiniGameState;
  const q = mini.questions[mini.questionIndex];

  publishListeContext(room);
  io.to(roomCode).emit("quiSuisJeQuestion", {
    question: q,
    index: mini.questionIndex + 1,
    total: mini.questions.length
  });

  roomTimeout(room, () => {
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

  room.quiSuisJeInterval = roomInterval(room, () => {
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
    roomTimeout(room, () => {
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
      cancelRoomTimeout(room, room.petitBacStartTimeout);
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

  const selectedCategories = shuffleCopy(PETIT_BAC_CATEGORIES).slice(0, 9);

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

  publishListeContext(room);
  io.to(roomCode).emit("petitBacStart", {
    letter,
    categories: selectedCategories,
    duration: 150
  });

  // On stocke le timeout pour pouvoir l'annuler si la fonction est rappelée
  room.petitBacStartTimeout = roomTimeout(room, () => {
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

  room.petitBacInterval = roomInterval(room, () => {
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

  roomTimeout(room, () => {
    startCorrectionPhase(roomCode);
  }, 3000);
}

function startMatriceFootball(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.gameState?.phase !== "playing" || room.gameState.currentMiniGame !== "matrice_football") return;
  let available = getUnusedQuestions(MATRICE_FOOTBALL_QUESTIONS, "matrice_football");
  if (available.length === 0) {
    resetGameHistory("matrice_football");
    available = getUnusedQuestions(MATRICE_FOOTBALL_QUESTIONS, "matrice_football");
  }
  if (!available.length) return console.error("Aucune matrice Football disponible.");
  const matrix = available[Math.floor(Math.random() * available.length)];
  markQuestionsAsPlayed([matrix], "matrice_football");
  const mini = room.gameState.currentMiniGameState = {
    type: "matrice_football", instanceId: randomUUID(), matrix, questions: [matrix], questionIndex: 0,
    playerAnswers: {}, responseTimes: {}, history: {}, scoresGiven: {}, gradingDetails: {},
    finished: false, timer: null
  };
  publishListeContext(room);
  io.to(roomCode).emit("matriceFootballStart", { matrix, instanceId: mini.instanceId,
    roomCode, duration: MATRICE_FOOTBALL_DURATION_SECONDS,
    roundNumber: room.gameState.roundNumber, gameMode: room.gameMode });
  roomTimeout(room, () => {
    if (room.gameState.phase !== "playing" || room.gameState.currentMiniGameState !== mini ||
        room.gameState.currentMiniGame !== "matrice_football") return;
    mini.startTime = Date.now();
    mini.timer = { totalSeconds: MATRICE_FOOTBALL_DURATION_SECONDS,
      remainingSeconds: MATRICE_FOOTBALL_DURATION_SECONDS, running: true };
    io.to(roomCode).emit("matriceFootballTimerUpdate", { remaining: MATRICE_FOOTBALL_DURATION_SECONDS,
      total: MATRICE_FOOTBALL_DURATION_SECONDS, roundNumber: room.gameState.roundNumber,
      instanceId: mini.instanceId });
    room.matriceFootballInterval = roomInterval(room, () => {
      if (room.gameState.phase !== "playing" || room.gameState.currentMiniGameState !== mini ||
          room.gameState.currentMiniGame !== "matrice_football" || !mini.timer.running) {
        clearInterval(room.matriceFootballInterval);
        return;
      }
      const remaining = Math.max(0, MATRICE_FOOTBALL_DURATION_SECONDS -
        Math.floor((Date.now() - mini.startTime) / 1000));
      mini.timer.remainingSeconds = remaining;
      io.to(roomCode).emit("matriceFootballTimerUpdate", { remaining,
        total: MATRICE_FOOTBALL_DURATION_SECONDS, roundNumber: room.gameState.roundNumber,
        instanceId: mini.instanceId });
      if (remaining <= 0) endMatriceFootballRound(roomCode);
    }, 1000);
  }, 2500);
}

function endMatriceFootballRound(roomCode) {
  const room = rooms[roomCode];
  const mini = room?.gameState?.currentMiniGameState;
  if (!room || room.gameState.phase !== "playing" || room.gameState.currentMiniGame !== "matrice_football" ||
      mini?.type !== "matrice_football" || mini.finished) return;
  mini.finished = true;
  if (mini.timer) mini.timer.running = false;
  if (room.matriceFootballInterval) clearInterval(room.matriceFootballInterval);
  io.to(roomCode).emit("matriceFootballEnd", { roundNumber: room.gameState.roundNumber,
    instanceId: mini.instanceId });
  roomTimeout(room, () => {
    if (room.gameState.phase === "playing" && room.gameState.currentMiniGameState === mini &&
        room.gameState.currentMiniGame === "matrice_football") startCorrectionPhase(roomCode);
  }, 3000);
}

// ===============================
//   SOCKET.IO
// ===============================

function startReadyMiniGame(room, startEncheres) {
  const roomCode = room.roomCode;
  const gs = room.gameState;
  if (gs.phase !== "rules") return;
  const activePlayers = room.players.filter((p) => room.gameMode === "liste"
    ? isListeParticipant(room, p) && p.isConnected
    : !p.eliminated && !p.isSpectator);
  const allReady = activePlayers.every((p) => gs.readyPlayers[p.playerId]);

  if (allReady && activePlayers.length > 0) {
    gs.phase = "playing";
    console.log(
      `Salle ${roomCode} : tous les joueurs sont prêts → phase playing (mini-jeu ${gs.currentMiniGame})`
    );
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

      publishListeContext(room);
      io.to(roomCode).emit("leugtasQuestion", {
        question: firstQuestion,
        index: 1,
        total: leugtasQuestions.length
      });

      roomTimeout(room, () => {
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
      try {
        if (bonOrdreBankError || !bonOrdreBank) {
          throw new Error(bonOrdreBankError || "La banque Le Bon Ordre est indisponible.");
        }
        const instanceId = randomUUID();
        const questions = bonOrdreStore.consume(bonOrdreBank, instanceId);
        gs.currentMiniGameState = {
          type: "le_bon_ordre",
          instanceId,
          questions,
          participantIds: room.players.filter((p) => isActiveMiniGamePlayer(room, p)).map((p) => p.playerId),
          questionIndex: 0,
          subPhase: "theme",
          phaseStartedAt: Date.now(),
          phaseEndsAt: Date.now() + 2500,
          playerAnswers: {},
          history: {},
          finished: false,
          timer: null,
          scoresGiven: {},
          timesApplied: {},
          automaticResults: {}
        };
        sendLeBonOrdreQuestion(roomCode);
      } catch (error) {
        gs.phase = "rules";
        gs.currentMiniGameState = null;
        gs.readyPlayers = {};
        io.to(roomCode).emit("errorMessage", `Impossible de lancer Le Bon Ordre : ${error.message}`);
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
    else if (gs.currentMiniGame === "matrice_football") {
      startMatriceFootball(roomCode);
    }
    else if (gs.currentMiniGame === "penave_ou_nachave" && room.gameMode === "liste") {
      try { startPenave(room); }
      catch (error) {
        gs.phase = "rules";
        gs.readyPlayers = {};
        io.to(roomCode).emit("errorMessage", error.message);
      }
    }
    // ------- LES ENCHÈRES ----------
    else if (gs.currentMiniGame === "les_encheres") {
      startEncheres(roomCode);
    }
    // ------- AUTRES MINI-JEUX ----------
    else {
      gs.currentMiniGameState = null;
    }
  }

  io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
}

io.on("connection", (socket) => {
  socket.use(([event, payload, context], next) => {
    if (event !== "createRoom" && event !== "joinRoom" && !getSocketRoom(socket)) return;
    const room = getSocketRoom(socket);
    if (!validSocketMessage(event, payload, room)) {
      if (event === "leBonOrdreAnswer") {
        rejectBonOrdreAnswer(socket, payload, "La proposition est invalide.");
        return;
      }
      socket.emit("errorMessage", "Message invalide.");
      return;
    }
    if (room && !validActionPhase(event, room)) {
      if (event === "leBonOrdreAnswer") rejectBonOrdreAnswer(socket, payload, "Cette question n'accepte plus de réponse.");
      return;
    }
    if (!room || room.gameMode !== "liste") return next();
    if (event.startsWith("encheres")) return;
    const phases = {
      drawingFinished: "drawingGame", playerSetReady: "rules",
      leugtasAnswer: "playing", fauxVraiAnswer: "playing",
      quiSuisJeAnswer: "playing", leBonOrdreAnswer: "playing",
      leTourDuMondeAnswer: "playing", blindTestAnswer: "playing", petitBacAnswer: "playing", matriceFootballAnswer: "playing",
      correctionNavigate: "playing", correctionPrevQuestion: "playing",
      correctionNextQuestion: "playing", hostGradePlayer: "playing", endPetitBacCorrection: "playing",
      endMatriceFootballCorrection: "playing",
      penaveCueFinished: "playing", penaveAnswer: "playing", penaveGrade: "playing"
    };
    if (!phases[event]) return next();
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!canUseMiniGameSocket(room, player, socket) || !room.listeTournament.started ||
        room.listeTournament.finished || room.gameState.phase !== phases[event]) {
      if (event === "leBonOrdreAnswer") rejectBonOrdreAnswer(socket, payload, "Vous ne pouvez pas répondre à cette question.");
      return;
    }
    const expected = getListeContext(room);
    if (!context || Object.keys(expected).some((key) => context[key] !== expected[key])) {
      if (event === "leBonOrdreAnswer") rejectBonOrdreAnswer(socket, payload, "Cette proposition appartient à une ancienne question.");
      return;
    }
    if (["penaveCueFinished", "penaveAnswer", "penaveGrade"].includes(event)) {
      const mini = getPenaveMini(room);
      if (!mini || payload.instanceId !== mini.instanceId ||
          payload.turnNumber !== mini.turnNumber || payload.passageId !== mini.passageId ||
          (["penaveCueFinished", "penaveAnswer"].includes(event) && mini.activePlayerId !== socket.playerId) ||
          (event === "penaveGrade" && room.hostId !== socket.playerId)) return;
    }
    if (event === "drawingFinished" || event.startsWith("correction") ||
         event === "hostGradePlayer" || event === "endPetitBacCorrection" || event === "endMatriceFootballCorrection") {
      if (room.hostId !== socket.playerId) return;
    }
    if (event.startsWith("correction") || event === "hostGradePlayer" ||
        event === "endPetitBacCorrection" || event === "endMatriceFootballCorrection") {
      const mini = room.gameState.currentMiniGameState;
      if (!mini?.finished || !Number.isInteger(mini.correctionIndex) ||
          mini.correctionIndex >= mini.questions.length) return;
    }
    if (["petitBacAnswer", "matriceFootballAnswer"].includes(event) &&
        !room.gameState.currentMiniGameState?.timer?.running) return;
    next();
  });
  console.log("Client connecté :", socket.id);
  socket.emit("fauxVraiThemes", fauxVraiThemes);

  socket.playerId = null;
  socket.roomCode = null;
  socket.room = null;

  // -----------------------------------
  //            CREATE ROOM
  // -----------------------------------
  socket.on("createRoom", (data) => {
    if (getSocketRoom(socket)) return socket.emit("errorMessage", "Quittez votre salle avant d'en créer une autre.");
    const pseudo = (data?.pseudo || "").trim();
    const playerId = (data?.playerId || "").trim();

    if (!pseudo) return socket.emit("errorMessage", "Merci d'entrer un pseudo.");
    if (!playerId) return socket.emit("errorMessage", "playerId manquant.");
    const now = Date.now();
    pruneRoomCreationTimes(now);
    if (Object.keys(rooms).length >= ROOM_LIMIT) {
      return socket.emit("errorMessage", "Nombre maximal de salles atteint. Réessayez plus tard.");
    }
    if (roomCreationTimes.length >= ROOM_CREATE_LIMIT) {
      return socket.emit("errorMessage", "Trop de salles créées récemment. Réessayez plus tard.");
    }

    const roomCode = generateRoomCode();
    const room = {
      roomCode,
      gameMode: "battle_royale",
      listeConfig: { gameCount: null, selectionMethod: null, selectedMiniGames: [] },
      listeTournament: createListeTournamentState(),
      hostId: playerId,
      players: [],
      gameState: createInitialGameState(),
      createdAt: now
    };

    const player = {
      playerId,
      id: socket.id,
      pseudo,
      socketId: socket.id,
      reconnectSecret: randomBytes(32).toString("hex"),
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
    roomCreationTimes.push(now);

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;
    socket.room = roomCode;

    console.log(`Salle ${roomCode} créée par ${pseudo}`);

    sendReconnectSecret(socket, room, player);
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

    const currentRoom = getSocketRoom(socket);
    if (currentRoom) {
      if (currentRoom !== room || socket.playerId !== playerId) {
        return socket.emit("errorMessage", "Quittez votre salle avant d'en rejoindre une autre.");
      }
      sendReconnectSecret(socket, room, room.players.find((p) => p.playerId === playerId));
      socket.emit("roomJoined", serializeRoom(room));
      socket.emit("gameStateUpdate", getGameStateSummary(room));
      syncPlayerWithGame(socket, room);
      return;
    }

    const joiningBonOrdreSpectator = room.gameState.phase === "playing" &&
      room.gameState.currentMiniGame === "le_bon_ordre" &&
      !room.gameState.currentMiniGameState?.participantIds?.includes(playerId);
    if (room.gameMode === "liste" && !canJoinListeRoom(room, playerId) && !joiningBonOrdreSpectator) {
      return socket.emit("errorMessage", "Ce tournoi Liste a déjà commencé. Seuls ses participants initiaux peuvent se reconnecter.");
    }

    let player = room.players.find((p) => p.playerId === playerId);

    if (player) {
      if (!hasReconnectSecret(player, data?.reconnectSecret)) {
        return socket.emit("errorMessage", "Reconnexion refusée : identité non vérifiée.");
      }
      const oldSocket = io.sockets?.sockets?.get(player.socketId);
      if (oldSocket && oldSocket !== socket) clearSocketRoom(oldSocket);
      player.socketId = socket.id;
      player.id = socket.id;
      player.isConnected = true;
      player.pseudo = pseudo;
      ensurePlayerTournamentStats(player);
    } else {
      if (room.players.length >= ROOM_PLAYER_LIMIT) {
        return socket.emit("errorMessage", "Cette salle a atteint son nombre maximal de joueurs.");
      }
      player = {
        playerId,
        id: socket.id,
        pseudo,
        socketId: socket.id,
        reconnectSecret: randomBytes(32).toString("hex"),
        isConnected: true,
        eliminated: false,
        withdrawn: false,
        isSpectator: joiningBonOrdreSpectator,
        
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
    cancelRoomAbandon(room);

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;
    socket.room = roomCode;
    if (room.gameMode === "liste") ensureListeHost(room);

    sendReconnectSecret(socket, room, player);
    socket.emit("roomJoined", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    syncPlayerWithGame(socket, room);
  });

  // -----------------------------------
  //         HOST SET GAME MODE (LOBBY)
  // -----------------------------------
  socket.on("hostSetGameMode", (data) => {
    const room = getSocketRoom(socket);
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
    const room = getSocketRoom(socket);
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
    const room = getHostRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

    if (room.gameMode === "liste") {
      const host = room.players.find((p) => p.playerId === playerId);
      if (host?.socketId !== socket.id || !isListeParticipant(room, host) ||
          room.gameState.phase !== "idle" || room.listeTournament.started) return;
      const validation = validateListeConfig(room.listeConfig);
      if (validation.error) return socket.emit("errorMessage", validation.error);
      const sequence = prepareListeSequence(validation.config);
      if (!initializeListeParticipants(room)) return;
      room.listeTournament.sequence = sequence;
      const gs = room.gameState;
      const tournament = room.listeTournament;
      gs.phase = "listeIntro";
      gs.roundNumber = 0;
      gs.currentMiniGame = null;
      tournament.introStartedAt = Date.now();
      io.to(roomCode).emit("roomUpdate", serializeRoom(room));
      io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
      roomTimeout(room, () => {
        if (rooms[roomCode] !== room || room.gameState !== gs ||
            room.listeTournament !== tournament || room.gameMode !== "liste" ||
            gs.phase !== "listeIntro" || gs.roundNumber !== 0) return;
        startNextListeRound(room);
      }, LISTE_INTRO_DURATION_MS);
      return;
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

    roomTimeout(room, () => {
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
    const room = getHostRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

    // Seul l'hôte peut signaler la fin de l'animation pour changer de phase
    if (room.hostId !== playerId) return;

    const gs = room.gameState;
    if (gs.phase !== "drawingGame") return;

    // Le tirage Liste est avancé par son minuteur serveur. Battle Royale
    // conserve ci-dessous le signal historique de l'hôte.
    if (room.gameMode === "liste") return;

    gs.phase = "rules";
    gs.readyPlayers = {};

    io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
  });

  // -----------------------------------
  //         READY / NOT READY
  // -----------------------------------
  socket.on("playerSetReady", (data) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

    const gs = room.gameState;
    if (gs.phase !== "rules") return;

    if (room.gameMode === "liste") {
      const player = room.players.find((p) => p.playerId === playerId);
      if (!room.listeTournament.started || !isListeParticipant(room, player) || player.socketId !== socket.id) return;
      if (data?.isReady) gs.readyPlayers[playerId] = true;
      else delete gs.readyPlayers[playerId];
      io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
      startReadyMiniGame(room);
      return;
    }

    const isReady = !!data?.isReady;
    if (isReady) gs.readyPlayers[playerId] = true;
    else delete gs.readyPlayers[playerId];

    startReadyMiniGame(room, startLesEncheres);
  });

  socket.on("penaveAnswer", (data) => {
    const room = getSocketRoom(socket);
    if (!room || room.gameMode !== "liste") return;
    penaveSubmit(room, socket.playerId, data.answer, data.pass);
  });

  socket.on("penaveCueFinished", () => {
    const room = getSocketRoom(socket);
    const mini = room && getPenaveMini(room);
    if (mini?.subPhase === "cue" && mini.activePlayerId === socket.playerId &&
        Date.now() - mini.cueStartedAt >= 900) penaveBeginAnswer(room, socket.playerId);
  });

  socket.on("penaveGrade", (data) => {
    const room = getHostRoom(socket);
    if (!room || room.gameMode !== "liste") return;
    penaveGrade(room, data.accepted);
  });

  socket.on("leugtasAnswer", ({ answerId } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

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
    const room = getSocketRoom(socket);
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

  socket.on("quiSuisJeAnswer", ({ answer } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
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
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

    const playerIdx = room.players.findIndex((p) => p.playerId === playerId);
    if (playerIdx === -1) return;

    const player = room.players[playerIdx];
    const gs = room.gameState;

    if (player.isSpectator && gs?.currentMiniGame === "le_bon_ordre" && gs.phase === "playing") {
      room.players.splice(playerIdx, 1);
      clearSocketRoom(socket);
      scheduleRoomAbandon(room);
      io.to(roomCode).emit("roomUpdate", serializeRoom(room));
      return;
    }

    if (room.gameMode === "liste") {
      if (player.socketId !== socket.id) return;
      if (room.listeTournament.started) {
        if (player.isSpectator && !room.listeTournament.initialParticipantIds.includes(playerId)) {
          room.players.splice(playerIdx, 1);
          clearSocketRoom(socket);
          scheduleRoomAbandon(room);
          io.to(roomCode).emit("roomUpdate", serializeRoom(room));
          return;
        }
        if (!withdrawListeParticipant(room, playerId, socket.id)) return;
        clearSocketRoom(socket);
        scheduleRoomAbandon(room);
        if (gs.currentMiniGame === "le_bon_ordre") {
          refreshBonOrdreLeaderboard(room);
        } else if (["playing", "listeRoundEnd"].includes(gs.phase)) {
          io.to(roomCode).emit("scoreUpdate", { ...getMiniGameScoreUpdate(room), refreshLeaderboard: true });
        }
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
      destroyRoom(room);
      clearSocketRoom(socket);
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
    
    if (player.socketId === socket.id) {
      player.socketId = null;
      player.id = null;
      player.isConnected = false;
    }
    clearSocketRoom(socket);
    maybeEndBonOrdreQuestion(room);
    refreshBonOrdreLeaderboard(room);
    scheduleRoomAbandon(room);

    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
    if (!gs || gs.phase !== "playing") {
      io.to(roomCode).emit("gameStateUpdate", getGameStateSummary(room));
    }
  });

  // -----------------------------------
  //        REQUEST ROOM STATE
  // -----------------------------------
  socket.on("requestRoomState", () => {
    const room = getSocketRoom(socket);
    if (!room) return;

    socket.emit("roomUpdate", serializeRoom(room));
    socket.emit("gameStateUpdate", getGameStateSummary(room));
    if (["matrice_football", "le_bon_ordre"].includes(room.gameState?.currentMiniGame)) {
      syncPlayerWithGame(socket, room);
    }
  });

    // -----------------------------------
    //           DISCONNECT
  // -----------------------------------
  socket.on("disconnect", () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
    const playerId = socket.playerId;

    if (room.gameMode === "liste") {
      if (!disconnectListePlayer(room, playerId, socket.id)) return;
      scheduleRoomAbandon(room);
      io.to(roomCode).emit("roomUpdate", serializeRoom(room));
      if (room.gameState.currentMiniGame === "penave_ou_nachave") publishPenave(room);
      if (room.activePlayersList && Number.isInteger(room.gameState?.currentMiniGameState?.correctionIndex)) {
        sendCorrectionData(roomCode);
      }
      return;
    }

    const player = room.players.find((p) => p.playerId === playerId);
    player.isConnected = false;
    player.socketId = null;
    player.id = null;
    scheduleRoomAbandon(room);

    io.to(roomCode).emit("roomUpdate", serializeRoom(room));
  });

  // -----------------------------------
  //        LE BON ORDRE - RÉPONSE
  // -----------------------------------
  socket.on("leBonOrdreAnswer", (action) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    const mini = currentActionMini(room, "le_bon_ordre");
    if (!player || !isActiveMiniGamePlayer(room, player) ||
        !canUseMiniGameSocket(room, player, socket) || !mini || mini.finished ||
        mini.subPhase !== "answering" || !mini.participantIds.includes(player.playerId)) {
      return rejectBonOrdreAnswer(socket, action, "Vous ne pouvez pas répondre à cette question.");
    }
    const q = mini.questions[mini.questionIndex];
    if (action.instanceId !== mini.instanceId || action.questionId !== q.id ||
        action.questionIndex !== mini.questionIndex ||
        (action.gameMode !== undefined && action.gameMode !== room.gameMode) ||
        (action.roundNumber !== undefined && action.roundNumber !== room.gameState.roundNumber)) {
      return rejectBonOrdreAnswer(socket, action, "Cette proposition appartient à une ancienne question.");
    }
    if (!mini.timer?.running || Date.now() >= mini.timer.endsAt) {
      return rejectBonOrdreAnswer(socket, action, "Le temps de réponse est écoulé.");
    }
    if (Object.hasOwn(mini.playerAnswers, player.playerId)) {
      return rejectBonOrdreAnswer(socket, action, "Votre réponse a déjà été enregistrée.");
    }
    if (!action.pass && !isValidBonOrdreAnswer(q, action.orderedIds)) {
      return rejectBonOrdreAnswer(socket, action, "Les cinq éléments distincts du tirage sont requis.");
    }
    const savedAnswer = { pass: action.pass, orderedIds: action.pass ? null : action.orderedIds.slice() };
    const timeTaken = Math.max(0, Math.min(LE_BON_ORDRE_DURATION, (Date.now() - mini.startTime) / 1000));
    rememberManualResponseTime(mini, player.playerId, timeTaken);
    mini.playerAnswers[player.playerId] = savedAnswer;
    socket.emit("leBonOrdreAnswerAck", { ...getBonOrdreContext(room, mini), savedAnswer });
    maybeEndBonOrdreQuestion(room);
  });

  socket.on("leTourDuMondeAnswer", ({ answer } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
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

  socket.on("blindTestAnswer", ({ answer } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
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

  socket.on("petitBacAnswer", ({ answers } = {}) => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const roomCode = room.roomCode;
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

  socket.on("matriceFootballAnswer", ({ answers, roundNumber, matrixId, instanceId } = {}) => {
    const room = getSocketRoom(socket);
    const player = room?.players.find((p) => p.playerId === socket.playerId);
    const mini = room?.gameState?.currentMiniGameState;
    if (!room || !player || !isActiveMiniGamePlayer(room, player) ||
        !canUseMiniGameSocket(room, player, socket) || mini?.type !== "matrice_football" ||
        room.gameState.phase !== "playing" || mini.finished || !mini.timer?.running ||
        room.gameState.roundNumber !== roundNumber || mini.matrix.id !== matrixId ||
        mini.instanceId !== instanceId ||
        Date.now() >= mini.startTime + MATRICE_FOOTBALL_DURATION_SECONDS * 1000) return;
    if (Object.hasOwn(mini.playerAnswers, socket.playerId)) {
      socket.emit("matriceFootballAnswerAck", { roundNumber, matrixId, instanceId });
      return;
    }
    const saved = {};
    for (let index = 0; index < 9; index++) saved[index] = answers[index].trim();
    const timeTaken = Math.max(0, (Date.now() - mini.startTime) / 1000);
    mini.playerAnswers[socket.playerId] = saved;
    mini.history[socket.playerId] = { 0: saved };
    mini.responseTimes[socket.playerId] = timeTaken;
    rememberManualResponseTime(mini, socket.playerId, timeTaken);
    socket.emit("matriceFootballAnswerAck", { roundNumber, matrixId, instanceId });
    if (room.players.filter((p) => isActiveMiniGamePlayer(room, p)).every((p) =>
      Object.hasOwn(mini.playerAnswers, p.playerId))) endMatriceFootballRound(room.roomCode);
  });

  // -----------------------------------
  //      CORRECTION (LE JUGE)
  // -----------------------------------
  socket.on("correctionNavigate", (action) => {
    const { direction } = action;
    const room = getHostRoom(socket);
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (mini?.correctionEnding) return;
    if (mini?.type === "matrice_football") {
      if (action?.roundNumber !== room.gameState.roundNumber ||
          action?.matrixId !== mini.matrix.id ||
          action?.instanceId !== mini.instanceId ||
          action?.gradingPlayerId !== room.activePlayersList?.[mini.gradingPlayerIndex]?.playerId) return;
    }
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
    const room = getHostRoom(socket);
    if (!room) return;

    const gs = room.gameState;
    const mini = gs.currentMiniGameState;
    if (!mini || !room.activePlayersList) return;
    if (mini.type === "le_bon_ordre") return;
    if (mini.correctionEnding) return;

    const player = room.activePlayersList[mini.gradingPlayerIndex];
    if (!player) return;
    if (room.gameMode === "liste" && !isListeParticipant(room, player)) return;
    if (mini.type === "matrice_football") {
      if (data.gradingPlayerId !== player.playerId ||
          data.roundNumber !== gs.roundNumber || data.matrixId !== mini.matrix.id ||
          data.instanceId !== mini.instanceId ||
          !Object.hasOwn(mini.playerAnswers, player.playerId)) return;
      for (const [index, value] of Object.entries(details || {})) {
        if (!mini.playerAnswers[player.playerId][index]?.trim() && value !== 0) return;
      }
      for (let index = 0; index < 9; index++) {
        if (!mini.playerAnswers[player.playerId][index]?.trim() && details?.[index] !== 0) return;
      }
    }

    const grade = validateManualGrade({
      miniGameType: mini.type,
      points,
      details,
      categoryCount: mini.type === "matrice_football" ? 9 : mini.categories?.length || 0
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
    if (["petit_bac", "matrice_football"].includes(mini.type)) {
      maxDuration = mini.timer?.totalSeconds ?? 150;
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

    if (["petit_bac", "matrice_football"].includes(mini.type)) {
      if (!mini.gradingDetails) mini.gradingDetails = {};
      mini.gradingDetails[player.playerId] = grade.details;
    }

    io.to(roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));

    sendCorrectionData(roomCode);
  });

  socket.on("correctionPrevQuestion", () => {
    const room = getHostRoom(socket);
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;

    if (mini && mini.correctionIndex > 0) {
      mini.correctionIndex--;
      mini.gradingPlayerIndex = 0;
      sendCorrectionData(socket.roomCode);
    }
  });

  socket.on("correctionNextQuestion", () => {
    const room = getHostRoom(socket);
    if (!room) return;
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
      beginListeRoundEnd(room);
      const bonOrdreCurrent = mini.type === "le_bon_ordre" ? captureBonOrdreCallback(room, mini) : null;
      if (bonOrdreCurrent) mini.correctionEnding = true;
      io.to(room.roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));

      io.to(room.roomCode).emit("leugtasReveal", {
        isLastQuestion: true,
        correctAnswerId: null,
        playerAnswers: null,
        skipAnimation: true
      });

      roomTimeout(room, () => {
        if (bonOrdreCurrent && !bonOrdreCurrent()) return;
        io.to(room.roomCode).emit("leBonOrdreExit",
          bonOrdreCurrent ? getBonOrdreContext(room, mini) : undefined);
        // On attend 7s (3s �limination + 3s logo + 1s s�curit�)
        roomTimeout(room, () => {
          if (bonOrdreCurrent && !bonOrdreCurrent()) return;
          endMiniGame(room.roomCode);
        }, room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);
      }, 5000);
    } else {
      sendCorrectionData(socket.roomCode);
    }
  });

  socket.on("endPetitBacCorrection", () => {
    const room = getHostRoom(socket);
    if (!room) return;
    if (room.gameMode === "liste") {
      const mini = room.gameState.currentMiniGameState;
      if (mini?.type !== "petit_bac") return;
      const grades = mini.scoresGiven?.[0] || {};
      if (room.players.some((p) => isListeParticipant(room, p) && grades[p.playerId] === undefined)) {
        return socket.emit("errorMessage", "Corrigez tous les participants avant de terminer.");
      }
      io.to(room.roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));
    }

    beginListeRoundEnd(room);
    io.to(room.roomCode).emit("leugtasReveal", {
      isLastQuestion: true,
      correctAnswerId: null,
      playerAnswers: null,
      skipAnimation: true
    });

    roomTimeout(room, () => {
      io.to(room.roomCode).emit("leBonOrdreExit");
      roomTimeout(room, () => {
        endMiniGame(room.roomCode);
      }, room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);
    }, 5000);
  });

  socket.on("endMatriceFootballCorrection", (data) => {
    const room = getHostRoom(socket);
    const mini = room?.gameState?.currentMiniGameState;
    if (!room || room.gameState.phase !== "playing" ||
        room.gameState.currentMiniGame !== "matrice_football" ||
        mini?.type !== "matrice_football" || !mini.finished || mini.correctionIndex !== 0 ||
        data.roundNumber !== room.gameState.roundNumber || data.matrixId !== mini.matrix.id ||
        data.instanceId !== mini.instanceId ||
        data.gradingPlayerId !== room.activePlayersList?.[mini.gradingPlayerIndex]?.playerId ||
        mini.correctionEnding) return;
    if (room.gameMode === "liste") pruneListeCorrectionPlayers(room);
    if (room.activePlayersList.some((player) =>
      Object.keys(mini.gradingDetails[player.playerId] || {}).length !== 9 ||
      mini.scoresGiven?.[0]?.[player.playerId] === undefined)) {
      return socket.emit("errorMessage", "Corrigez toutes les grilles avant de terminer.");
    }
    mini.correctionEnding = true;
    beginListeRoundEnd(room);
    io.to(room.roomCode).emit("scoreUpdate", getMiniGameScoreUpdate(room));
    io.to(room.roomCode).emit("leugtasReveal", {
      isLastQuestion: true, correctAnswerId: null, playerAnswers: null, skipAnimation: true
    });
    roomTimeout(room, () => {
      if (room.gameState.currentMiniGameState !== mini ||
          room.gameState.currentMiniGame !== "matrice_football") return;
      io.to(room.roomCode).emit("leBonOrdreExit");
      roomTimeout(room, () => {
        if (room.gameState.currentMiniGameState === mini &&
            room.gameState.currentMiniGame === "matrice_football") endMiniGame(room.roomCode);
      }, room.gameMode === "liste" ? LISTE_END_LOGO_DURATION_MS : 7000);
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
        const availableThemes = mini.themesAvailable.filter((theme) => !theme.outOfStock);
        const randomTheme = availableThemes[Math.floor(Math.random() * availableThemes.length)];
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

    roomTimeout(room, () => {
      if (room.gameState.currentMiniGameState !== mini) return;
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

        roomTimeout(room, () => {
          if (room.gameState.currentMiniGameState !== mini) return;
          io.to(room.roomCode).emit("encheresCountdown");
          roomTimeout(room, () => {
            if (room.gameState.currentMiniGameState !== mini) return;
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
      themesAvailable: themesWithStockInfo,
      playerVotes: {},
      question: null,
      bids: [],
      timer: null,
      currentBidder: null,
      currentMaxBid: 0,
      activePlayerId: null,
      targetScore: 0,
      answersGiven: [],
      validatedStatus: [],
      finalized: false
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

    room.encheresInterval = roomInterval(room, () => {
      if (room.gameState.currentMiniGameState !== mini) {
        clearInterval(room.encheresInterval);
        room.encheresInterval = null;
        return;
      }
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
    const room = getSocketRoom(socket);
    if (!room) return;
    
    // --- SÉCURITÉ AJOUTÉE ---
    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    if (!canUseMiniGameSocket(room, player, socket)) return;
    // ------------------------

    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.type !== "les_encheres" || mini.subPhase !== "theme_selection" ||
        !mini.timer?.running || !mini.themesAvailable.some((theme) => theme.id === themeId && !theme.outOfStock)) return;

    mini.playerVotes[socket.playerId] = themeId;

    const activePlayers = room.players.filter(
      (p) => isActiveMiniGamePlayer(room, p)
    );

    if (activePlayers.every((p) => mini.playerVotes[p.playerId])) {
      finalizeThemeSelection(room);
    }
  });

  socket.on("encheresPlaceBid", (amount) => {
    const room = getSocketRoom(socket);
    if (!room) return;

    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    if (!canUseMiniGameSocket(room, player, socket)) return;

    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.type !== "les_encheres" || mini.subPhase !== "bidding" || !mini.timer?.running) return;

    const val = typeof amount === "string" && /^(?:[1-9]|[1-4]\d|50)$/.test(amount)
      ? Number(amount) : amount;
    if (!Number.isSafeInteger(val) || val < 1 || val > MAX_BID) return;
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
    const room = getSocketRoom(socket);
    if (!room) return;

    const player = room.players.find(p => p.playerId === socket.playerId);
    if (!player || player.eliminated || player.isSpectator) return;
    if (!canUseMiniGameSocket(room, player, socket)) return;

    const mini = room.gameState.currentMiniGameState;
    if (
      !mini || mini.type !== "les_encheres" || !mini.timer?.running ||
      mini.subPhase !== "collecting" ||
      socket.playerId !== mini.activePlayerId
    )
      return;

    if (!isText(text, MAX_ANSWER_LENGTH)) return;
    const limit = Math.min(MAX_BID, mini.currentMaxBid) + 1;
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
    const room = getSocketRoom(socket);
    if (!room) return;
    const player = room.players.find((p) => p.playerId === socket.playerId);
    if (!canUseMiniGameSocket(room, player, socket)) return;
    const mini = room.gameState.currentMiniGameState;
    if (
      !mini || mini.type !== "les_encheres" || !mini.timer?.running ||
      mini.subPhase !== "collecting" ||
      socket.playerId !== mini.activePlayerId
    )
      return;

    if (Number.isInteger(index) && index >= 0 && index < mini.answersGiven.length) {
      mini.answersGiven.splice(index, 1);
      mini.validatedStatus.splice(index, 1);

      io.to(socket.roomCode).emit("encheresLiveAnswerUpdate", {
        answers: mini.answersGiven
      });
    }
  });

  socket.on("encheresToggleCorrection", ({ index, status }) => {
    const room = getHostRoom(socket);
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.type !== "les_encheres" || mini.subPhase !== "correction" || mini.finalized ||
        !Number.isInteger(index) || index < 0 || index >= mini.validatedStatus.length ||
        typeof status !== "boolean") return;

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
    const room = getHostRoom(socket);
    if (!room) return;
    const mini = room.gameState.currentMiniGameState;
    if (!mini || mini.type !== "les_encheres" || mini.subPhase !== "correction" || mini.finalized) return;
    mini.finalized = true;

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

    roomTimeout(room, () => {
      io.to(socket.roomCode).emit("gameOver", { winner: winnerPseudo });
    }, 2500);
  });
}); // <--- ICI : C'est la fermeture cruciale de io.on("connection")

function syncPlayerWithGame(socket, room) {
  if (!room || !room.gameState || getSocketRoom(socket) !== room) return;
  if (room.gameMode === "liste" &&
      !isListeParticipant(room, room.players.find((p) => p.playerId === socket.playerId)) &&
      room.gameState.currentMiniGame !== "le_bon_ordre") return;
  const gs = room.gameState;
  // CORRECTIF : On regarde currentMiniGameState OU room.mini (pour le cas spécifique du Faux du Vrai)
  const mini = gs.currentMiniGameState || room.mini;

  publishListeContext(room, socket);
  if (mini?.type === "le_bon_ordre" && gs.currentMiniGame === "le_bon_ordre") {
    advanceBonOrdrePhase(room, mini);
    if (gs.currentMiniGameState !== mini || gs.currentMiniGame !== "le_bon_ordre" ||
        !["playing", "listeRoundEnd"].includes(gs.phase)) return;
    if (mini.subPhase === "correction") sendBonOrdrePersonalCorrection(socket, room, mini);
    else if (mini.subPhase === "leaderboard") {
      socket.emit("leBonOrdreLeaderboard", getBonOrdreLeaderboard(room, mini, true));
    } else if (mini.subPhase === "ending") {
      if (!mini.completionDispatched) socket.emit("leBonOrdreExit", getBonOrdreExit(room, mini, true));
    } else if (["theme", "answering"].includes(mini.subPhase)) {
      socket.emit("leBonOrdreQuestion", getBonOrdreQuestionSnapshot(room, mini, socket.playerId, true));
      socket.emit("leBonOrdreTimerUpdate", {
        ...getBonOrdreContext(room, mini), ...getBonOrdreTimer(mini)
      });
    }
    return;
  }
  if (gs.phase !== "playing" || !mini) return;

  // === GESTION DE LA CORRECTION (Si le jeu est fini) ===
  if (
    mini.finished &&
    ["qui_suis_je", "le_tour_du_monde", "blind_test", "petit_bac", "matrice_football", "les_encheres"].includes(mini.type)
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
  else if (mini.type === "matrice_football") {
    const duration = MATRICE_FOOTBALL_DURATION_SECONDS;
    const savedAnswers = mini.playerAnswers[socket.playerId];
    socket.emit("matriceFootballStart", { matrix: mini.matrix, instanceId: mini.instanceId,
      roomCode: room.roomCode, duration,
      roundNumber: gs.roundNumber, gameMode: room.gameMode,
      hasAnswered: savedAnswers !== undefined, savedAnswers: savedAnswers || null,
      isReload: true });
    socket.emit("matriceFootballTimerUpdate", {
      remaining: mini.timer?.remainingSeconds ?? duration, total: duration,
      roundNumber: gs.roundNumber, instanceId: mini.instanceId
    });
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

const ADMIN_MEMORY_SECRET = process.env.LQS_ADMIN_MEMORY_SECRET;
const ADMIN_MEMORY_ENABLED = process.env.LQS_ADMIN_MEMORY_ENABLED === "1" &&
  typeof ADMIN_MEMORY_SECRET === "string" && ADMIN_MEMORY_SECRET.length > 0;
const ADMIN_MEMORY_GAMES = new Set(POSSIBLE_MINI_GAMES);

function requireMemoryAdmin(req, res, next) {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (!ADMIN_MEMORY_ENABLED) return res.status(404).json({ error: "Administration désactivée" });
  const supplied = req.get("X-Admin-Secret");
  if (typeof supplied !== "string") return res.status(401).json({ error: "Accès refusé" });
  const expectedBytes = Buffer.from(ADMIN_MEMORY_SECRET);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return res.status(401).json({ error: "Accès refusé" });
  }
  next();
}

app.use("/admin/memory", requireMemoryAdmin);

app.get("/admin/memory/view", (req, res) => {
  const history = getPlayedHistory();
  try { res.json({ ...history, le_bon_ordre_elements_v1: bonOrdreStore.read() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get(["/admin/memory/reset-all", "/admin/memory/reset/", "/admin/memory/reset/:game"], (req, res) => {
  res.status(405).json({ error: "Utiliser POST" });
});

app.post("/admin/memory/reset-all", (req, res) => {
  try {
    bonOrdreStore.reset();
    savePlayedHistory({});
    res.json({ reset: "all" });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/admin/memory/reset/:game", (req, res) => {
  const game = req.params.game;
  if (!ADMIN_MEMORY_GAMES.has(game)) return res.status(400).json({ error: "Jeu inconnu" });
  if (game === "le_bon_ordre") {
    try {
      bonOrdreStore.reset();
      return res.json({ reset: game });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  }
  resetGameHistory(game);
  res.json({ reset: game });
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




