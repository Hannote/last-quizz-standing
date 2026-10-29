// client.js


// Tirage animation + écran de rÃ¨gles + systÃ¨me prÃªt/pas prÃªt


// + mini-jeu simple "Qui veut gagner des leugtas" (1 question locale)


// ==========================================
//    SYSTÈME DE PRÉCHARGEMENT D'IMAGES
// ==========================================

const PRIORITY_IMAGES = [
  "intro_1.png", "intro_2.png", "intro_3.png",
  "host_sheet.png", "host_shout.png",
  "last_quizz_standing.jpeg",
  "titres/blind_test.png",
  "titres/le_bon_ordre.png",
  "titres/le_faux_du_vrai.png",
  "titres/le_petit_bac.png",
  "titres/matrice_football.png",
  "titres/le_tour_du_monde.png",
  "titres/les_encheres.png",
  "titres/penave_ou_nachave.png",
  "titres/qui_suis_je.png",
  "titres/qui_veut_gagner_des_leugtas.png"
];

const FINALE_IMAGES = [
  "yu_gi.png", "yu_gi_0.png", "yu_gi_sheet.png", 
  "yu_gi_sheet_2.png", "lumiere.png", "animateur.png"
];

/**
 * Charge les images de manière séquentielle pour respecter l'ordre
 * et saturer intelligemment la bande passante.
 */
async function preloadImagesSequentially(imageList) {
  for (const src of imageList) {
    try {
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = resolve;
        img.onerror = reject;
      });
      console.log(`%c[Preloader] ${src} chargé`, "color: #2ecc71");
    } catch (e) {
      console.warn(`[Preloader] Erreur sur ${src}`, e);
    }
  }
}

// Lancement immédiat du chargement prioritaire
preloadImagesSequentially(PRIORITY_IMAGES).then(() => {
  console.log("%c[Preloader] Phase 1 (Intro/Jeux) terminée.", "font-weight: bold; color: #ffcc00");
  // Une fois la priorité finie, on lance la finale en arrière-plan
  preloadImagesSequentially(FINALE_IMAGES);
});

const socket = io();
// À utiliser uniquement dans un nœud de texte d'un modèle HTML statique.
function escapeHtmlText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
let listeActionContext = null;
socket.on("listeContext", (context) => { listeActionContext = context; });

function emitGameAction(event, payload, context = listeActionContext) {
  if (currentRoom?.gameMode === "liste") socket.emit(event, payload ?? null, context);
  else if (payload === undefined) socket.emit(event);
  else socket.emit(event, payload);
}

// Conteneur invisible pour forcer le décodage des logos par le GPU
function initGpuLogoCacheOnce() {
  if (!document.body) return;
  if (document.getElementById("gpu-cache-logos")) return;

  const globalCacheContainer = document.createElement('div');
  globalCacheContainer.id = "gpu-cache-logos";
  globalCacheContainer.style.display = 'none';
  POSSIBLE_MINI_GAMES.forEach(code => {
    const img = new Image();
    img.src = miniGameCodeToLogoPath(code);
    globalCacheContainer.appendChild(img);
  });
  document.body.appendChild(globalCacheContainer);
}

Promise.resolve().then(() => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGpuLogoCacheOnce, { once: true });
  } else {
    initGpuLogoCacheOnce();
  }
});

// Variable globale de sécurité (bloque la boucle Quitter -> Game Over)
let isQuitting = false;


// --- AUDIO SETUP (Howler.js) ---


const sfxBubbleClick = new Howl({


  src: ['sons/buble_click.mp3'],


  volume: 0.5,


  preload: true


});


const sfxTheme = new Howl({


  src: ['sons/theme.mp3'],


  volume: 0.5,


  preload: true


});

const sfxElimination = new Howl({


  src: ['sons/elimination.mp3'], 


  volume: 0.8,


  preload: true,


  onload: () => console.log("🔊 Son d'élimination chargé."),


  onloaderror: (id, err) => console.error("⚠️ Erreur audio élimination :", err)


});




const sfxFinJeu = new Howl({


  src: ['sons/fin_jeu.mp3'],


  volume: 0.7,


  preload: true


});

const sfxReady = new Howl({


  src: ['sons/pret.mp3'],


  volume: 0.5,


  preload: true


});


const sfxCorrect1 = new Howl({ src: ['sons/correction_1point.mp3'], volume: 0.5 });


const sfxCorrect0 = new Howl({ src: ['sons/correction_0point.mp3'], volume: 0.5 });


const sfxFauxVraiWin = new Howl({


  src: ['sons/faux_bonne_reponse.mp3'],


  volume: 0.5


});


const sfxFauxVraiLose = new Howl({


  src: ['sons/faux_mauvaise_reponse.mp3'],


  volume: 0.5


});


const sfxEnchereReponse = new Howl({ src: ['sons/enchere_reponse.mp3'], volume: 0.5 });


const sfxLeugtasClick = new Howl({ src: ['sons/leugta_reponse.mp3'], volume: 0.5 });


const sfxLeugtasWin = new Howl({ src: ['sons/leugta_bonne_reponse.mp3'], volume: 0.5 });


const sfxLeugtasLose = new Howl({ src: ['sons/leugta_mauvaise_reponse.mp3'], volume: 0.5 });


const sfxEnchereTheme = new Howl({ src: ['sons/enchere_theme.mp3'], volume: 0.5 });


const sfxAdjugeVendu = new Howl({ src: ['sons/adjuge_vendu.mp3'], volume: 0.5 });


const sfxEnchereChampion = new Howl({ src: ['sons/enchere_champion.mp3'], volume: 0.5 });


const sfxCorrectionArrow = new Howl({ src: ['sons/correction_fleche.mp3'], volume: 0.5 });


const sfxCorrectOther = new Howl({ src: ['sons/correction_autre.mp3'], volume: 0.5 });


const sfx40s = new Howl({ src: ['sons/40s.mp3'], volume: 0.5 });


const sfxVictoire = new Howl({


  src: ['sons/victoire.mp3'],


  volume: 0.6


});


const sfx45s = new Howl({ src: ['sons/45s.mp3'], volume: 0.5 });


const sfx150s = new Howl({ src: ['sons/150s.mp3'], volume: 0.5 });


const sfxEnchere = new Howl({ src: ['sons/enchere.mp3'], volume: 0.5 });


const sfxLeugtasQuestion = new Howl({ src: ['sons/question_leugta.mp3'], volume: 0.5 });


const sfxEnchereReady = new Howl({ src: ['sons/enchere_ready.mp3'], volume: 0.5 });


const sfxRuleQuiSuisJe = new Howl({ src: ['sons/qui_suis_je.mp3'], volume: 0.6 });


const sfxRuleLeugtas = new Howl({ src: ['sons/qui_veut_gagner_des_leugtas.mp3'], volume: 0.6 });


const sfxRuleTourDuMonde = new Howl({ src: ['sons/le_tour_du_monde.mp3'], volume: 0.6 });


const sfxRulePetitBac = new Howl({ src: ['sons/petit_bac.mp3'], volume: 0.6 });
const sfxRuleMatriceFootball = new Howl({ src: ['sons/matrice_football.mp3'], volume: 0.6 });


const sfxRuleBonOrdre = new Howl({ src: ['sons/le_bon_ordre.mp3'], volume: 0.6 });


const sfxRuleBlindTest = new Howl({ src: ['sons/blind_test.mp3'], volume: 0.6 });


const sfxRuleEncheres = new Howl({ src: ['sons/enchere_final.mp3'], volume: 0.6 });


const sfxRuleFauxVrai = new Howl({ src: ['sons/le_faux_du_vrai.mp3'], volume: 0.6 });
const sfxRulePenave = new Howl({ src: ['sons/penave_ou_nachave.mp3'], volume: 0.6 });
const sfxPenaveTurn = new Howl({ src: ['sons/a_toi_de_jouer.mp3'], volume: 0.7, preload: true });
const sfxPenaveSuspense = new Howl({ src: ['sons/40s.mp3'], volume: 0.5, preload: true });
const sfxPenaveBoard = new Howl({ src: ['sons/board.mp3'], volume: 0.6, preload: true });
const sfxPenaveCorrect = new Howl({ src: ['sons/correction_1point.mp3'], volume: 0.5, preload: true });
const sfxPenaveWrong = new Howl({ src: ['sons/correction_0point.mp3'], volume: 0.5, preload: true });
const sfxPenaveOut = new Howl({ src: ['sons/penave_ou_nachave_out.mp3'], volume: 0.7, preload: true });


const sfxTirage = new Howl({


  src: ['sons/tirage.mp3'],


  volume: 0.6,


  preload: true


});

let sfxTirageFinal = null;


const sfxLumiere = new Howl({ src: ['sons/lumiere.mp3'], volume: 1.0 });
const sfxPas = new Howl({ src: ['sons/pas.mp3'], volume: 1.0 });
const sfxDbz = new Howl({ src: ['sons/dbz.mp3'], volume: 0.4 });
const sfxRumble = new Howl({ src: ['sons/rumble.mp3'], volume: 1.0 });
const sfxText = new Howl({ src: ['sons/text.mp3'], volume: 0.5, loop: true });


function stopRuleSounds() {


  sfxRuleQuiSuisJe.stop();


  sfxRuleLeugtas.stop();


  sfxRuleTourDuMonde.stop();


  sfxRulePetitBac.stop();
  sfxRuleMatriceFootball.stop();


  sfxRuleBonOrdre.stop();


  sfxRuleBlindTest.stop();


  sfxRuleEncheres.stop();


  sfxRuleFauxVrai.stop();
  sfxRulePenave.stop();


}


// Utilitaire pour savoir si je suis spectateur (éliminé ou spectateur pur)


function isListePlayerInactive(player) {
  return currentRoom?.gameMode === "liste" && !!player &&
    (player.withdrawn || (currentRoom.listeTournament?.started &&
      !currentRoom.listeTournament.initialParticipantIds.includes(player.playerId)));
}

function amISpectator() {


  if (!currentRoom) return false;


  const me = currentRoom.players.find((p) => p.playerId === playerId);


  return isListePlayerInactive(me) || (me && (me.eliminated || me.isSpectator));


}


// ===============================


//   GESTION PLAYER ID LOCAL


// ===============================


function getOrCreatePlayerId() {


  let playerId = localStorage.getItem("lqs_player_id");


  if (!playerId) {


    playerId = "p_" + Math.random().toString(36).substring(2, 10);


    localStorage.setItem("lqs_player_id", playerId);


  }


  return playerId;


}


const playerId = getOrCreatePlayerId();

function reconnectSecretKey(roomCode) {
  return `lqs_reconnect_${roomCode}_${playerId}`;
}

function getReconnectSecret(roomCode) {
  return localStorage.getItem(reconnectSecretKey(roomCode));
}

socket.on("reconnectCredential", ({ roomCode, playerId: credentialPlayerId, reconnectSecret }) => {
  if (credentialPlayerId !== playerId || typeof roomCode !== "string" ||
      typeof reconnectSecret !== "string") return;
  localStorage.setItem(reconnectSecretKey(roomCode), reconnectSecret);
});


// Liste locale de tous les mini-jeux (pour l'animation)


const ALL_MINI_GAMES = [


  "qui_suis_je",


  "blind_test",


  "le_tour_du_monde",


  "le_bon_ordre",


  "le_petit_bac",
  "matrice_football",


  "qui_veut_gagner_des_leugtas",


  "le_faux_du_vrai",


  "les_encheres"


];

const POSSIBLE_MINI_GAMES = ALL_MINI_GAMES;


// ===============================


//        RÃFÃRENCES DOM


// ===============================


const screenLobby = document.getElementById("screen-lobby");


const screenRoom = document.getElementById("screen-room");


const body = document.body;


const roomUpper = document.getElementById("room-upper");


const globalControls = document.getElementById("globalControls");


const pseudoInput = document.getElementById("pseudoInput");


const roomCodeInput = document.getElementById("roomCodeInput");


const createRoomBtn = document.getElementById("createRoomBtn");


const joinRoomBtn = document.getElementById("joinRoomBtn");


const leaveRoomBtn = document.getElementById("leaveRoomBtn");


const startGameBtn = document.getElementById("startGameBtn");
const gameModeButtons = document.querySelectorAll("[data-game-mode]");
const gameModeHint = document.getElementById("gameModeHint");
const listeConfigForm = document.getElementById("listeConfigForm");
const listeGameCount = document.getElementById("listeGameCount");
const listeSelectionMethod = document.getElementById("listeSelectionMethod");
const listeManualOptions = document.getElementById("listeManualOptions");
const listeGameChoices = document.getElementById("listeGameChoices");
const listeSelectionCount = document.getElementById("listeSelectionCount");
const listeConfigStatus = document.getElementById("listeConfigStatus");
const listeConfigSubmit = document.getElementById("listeConfigSubmit");
let listeConfigKey = null;
let listeConfigDirty = false;


const sandboxControls = document.getElementById("sandboxControls");


const sandboxToggle = document.getElementById("sandboxToggle");


const sandboxMiniGameSelect = document.getElementById("sandboxMiniGameSelect");


const btnEnterGame = document.getElementById("btn-enter-game");


const lobbyForm = document.getElementById("lobby-form");


const errorLobby = document.getElementById("errorLobby");


const errorRoom = document.getElementById("errorRoom");


if (btnEnterGame && lobbyForm) {


  btnEnterGame.addEventListener("click", () => {


    btnEnterGame.classList.add("hidden");


    lobbyForm.classList.remove("hidden");


    if (pseudoInput) {


      pseudoInput.focus();


    }


  });


}


const roomCodeDisplay = document.getElementById("roomCodeDisplay");


const playersList = document.getElementById("playersList");


const gamePhaseText = document.getElementById("gamePhaseText");


const currentMiniGameText = document.getElementById("currentMiniGameText");


// zones principales


const mainDefault = document.getElementById("main-default");


const mainDrawing = document.getElementById("main-drawing");


const mainRules = document.getElementById("main-rules");


const mainPlaying = document.getElementById("main-playing");


// tirage


const drawLogo = document.getElementById("drawLogo");


const drawGameLabel = document.getElementById("drawGameLabel");


// rÃ¨gles


const rulesGameLogo = document.getElementById("rulesGameLogo");


const rulesGameTitle = document.getElementById("rulesGameTitle");


const rulesRoundInfo = document.getElementById("rulesRoundInfo");


const rulesGameText = document.getElementById("rulesGameText");


const readyBtn = document.getElementById("readyBtn");


const readyPlayersList = document.getElementById("readyPlayersList");


// mini-jeu leugtas


const playingTitle = document.getElementById("playingTitle");


const playingQuestion = document.getElementById("playingQuestion");


const playingChoices = document.getElementById("playingChoices");


const playingFeedback = document.getElementById("playingFeedback");


const playingTimer = document.getElementById("playingTimer");


const playingQuestionNumber = document.getElementById("playing-question-number");


const playingTimerBar = document.getElementById("playingTimerBar");


const playingTimerBarFill = document.getElementById("playingTimerBarFill");


// Faux du Vrai


const fauxVraiContainer = document.getElementById("fauxVraiContainer");


const fauxVraiTheme = document.getElementById("fauxVraiTheme");


const fauxVraiQuestion = document.querySelector(".fauxvrai-question");


const fauxVraiTimerNumber = document.getElementById("fauxVraiTimerNumber");


const fauxVraiTimerFill = document.getElementById("fauxVraiTimerFill");


const fauxVraiAnswers = document.getElementById("fauxVraiAnswers");


const fauxVraiEndOverlay = document.getElementById("fauxVraiEndOverlay");


const fauxVraiEndLogo = document.getElementById("fauxVraiEndLogo");


const fauxVraiQuestionNumber = document.getElementById("fauxVraiQuestionNumber");


const scoreboard = document.getElementById("scoreboard");


// Le Bon Ordre


const leBonOrdreContainer = document.getElementById("leBonOrdreContainer");


const lboCards = document.getElementById("lboCards");


const lboQuestion = document.getElementById("lboQuestion");


const lboTimerNumber = document.getElementById("lboTimerNumber");


const lboTimerFill = document.getElementById("lboTimerFill");


const lboQuestionNumber = document.getElementById("lboQuestionNumber");


let bonOrdreState = null;
let bonOrdreDisplayToken = 0;
let bonOrdrePopover = null;
let bonOrdrePopoverAnchor = null;
let bonOrdreCorrectionContext = null;
let bonOrdrePhaseSnapshot = null;
let bonOrdreCorrectionClock = null;
let bonOrdreCorrectionInterval = null;
let bonOrdreLeaderboardSnapshot = null;
let bonOrdreEndingSnapshot = null;


const lboValidateBtn = document.getElementById("lboValidateBtn");


const lboPassBtn = document.getElementById("lboPassBtn");


const lboFeedback = document.getElementById("lboFeedback");


// Qui suis-je


const quiSuisJeContainer = document.getElementById("quiSuisJeContainer");


const qsjMainImage = document.getElementById("qsjMainImage");


const qsjQuestion = document.getElementById("qsjQuestion");


const qsjTimerNumber = document.getElementById("qsjTimerNumber");


const qsjTimerFill = document.getElementById("qsjTimerFill");


const qsjQuestionNumber = document.getElementById("qsjQuestionNumber");


const qsjInput = document.getElementById("qsjInput");


const qsjValidateBtn = document.getElementById("qsjValidateBtn");


const qsjPassBtn = document.getElementById("qsjPassBtn");


const qsjFeedback = document.getElementById("qsjFeedback");


// Le Tour du Monde


const tourMondeContainer = document.getElementById("tourMondeContainer");


const tdmMainImage = document.getElementById("tdmMainImage");


const tdmQuestion = document.getElementById("tdmQuestion");


const tdmTimerNumber = document.getElementById("tdmTimerNumber");


const tdmTimerFill = document.getElementById("tdmTimerFill");


const tdmQuestionNumber = document.getElementById("tdmQuestionNumber");


const tdmInput = document.getElementById("tdmInput");


const tdmValidateBtn = document.getElementById("tdmValidateBtn");


const tdmPassBtn = document.getElementById("tdmPassBtn");


const tdmFeedback = document.getElementById("tdmFeedback");


// Blind Test


const blindTestContainer = document.getElementById("blindTestContainer");


const btMainAudio = document.getElementById("btMainAudio");


const btQuestion = document.getElementById("btQuestion");


const btTimerNumber = document.getElementById("btTimerNumber");


const btTimerFill = document.getElementById("btTimerFill");


const btQuestionNumber = document.getElementById("btQuestionNumber");


const btInput = document.getElementById("btInput");


const btValidateBtn = document.getElementById("btValidateBtn");


const btPassBtn = document.getElementById("btPassBtn");


const btFeedback = document.getElementById("btFeedback");


// Petit Bac


const petitBacContainer = document.getElementById("petitBacContainer");
const matriceFootballContainer = document.getElementById("matriceFootballContainer");
const mfPlayingGrid = document.getElementById("mfPlayingGrid");
const mfValidateBtn = document.getElementById("mfValidateBtn");
const mfFeedback = document.getElementById("mfFeedback");
let currentMatriceFootball = null;
let matriceFootballRoundNumber = null;
let matriceFootballInstanceId = null;
let matriceFootballRoomCode = null;
let matriceFootballSubmitted = false;
let currentMatriceFootballCorrection = null;


const pbLetterDisplay = document.getElementById("pbLetterDisplay");


const pbTimerNumber = document.getElementById("pbTimerNumber");


const pbTimerFill = document.getElementById("pbTimerFill");


const pbFormZone = document.getElementById("pbFormZone");


const pbValidateBtn = document.getElementById("pbValidateBtn");


const pbFeedback = document.getElementById("pbFeedback");


const palierOverlay = document.getElementById("palierOverlay");


const palierOverlayText = document.getElementById("palierOverlayText");


const leugtasEndOverlay = document.getElementById("leugtasEndOverlay");


const leugtasEndLogo = document.getElementById("leugtasEndLogo");


// Correction


const correctionContainer = document.getElementById("correctionContainer");


const corrImgQuestion = document.getElementById("corrImgQuestion");


const corrTextQuestion = document.getElementById("corrTextQuestion");


const corrImgAnswer = document.getElementById("corrImgAnswer");


const corrTextAnswer = document.getElementById("corrTextAnswer");


const correctionQuestionInfo = document.getElementById("correctionQuestionInfo");


const corrAudioPlayer = document.getElementById("corrAudioPlayer");


const corrQuestionBlock = document.getElementById("corrQuestionBlock");


const corrAnswerBlock = document.getElementById("corrAnswerBlock");


const corrAnswerLabel = document.getElementById("corrAnswerLabel");


const pbCorrectionZone = document.getElementById("pbCorrectionZone");


const pbCorrLetter = document.getElementById("pbCorrLetter");


const pbCorrList = document.getElementById("pbCorrList");


const pbSubmitTotalBtn = document.getElementById("pbSubmitTotalBtn");


const pbTotalScoreDisplay = document.getElementById("pbTotalScoreDisplay");


const pbFinishGameBtn = document.getElementById("pbFinishGameBtn");


const gradingPlayerName = document.getElementById("gradingPlayerName");


const gradingPlayerAnswer = document.getElementById("gradingPlayerAnswer");


const gradingControls = document.getElementById("gradingControls");


const btnPrevPlayer = document.getElementById("btnPrevPlayer");


const btnNextPlayer = document.getElementById("btnNextPlayer");


const btnPrevCorrectionQ = document.getElementById("btnPrevCorrectionQ");


const gradingWaitMessage = document.getElementById("gradingWaitMessage");


// correction buttons triggered from HTML


window.submitGrade = function (points) {
  if (currentGameState.currentMiniGame === "le_bon_ordre") return;


  if (socket) {


    // On envoie 'soundValue' pour dire au serveur quel son jouer


    emitGameAction("hostGradePlayer", { points, soundValue: points });


  }


};


// Ã©tats courants


let currentRoom = null;


let currentGameState = {


  phase: "idle",


  roundNumber: 0,


  currentMiniGame: null,


  readyPlayerIds: []


};


let iAmReady = false;


let lastPhase = "idle";


let sandboxEnabled = false;


let sandboxMiniGame = "";


let leugtasHasAnswered = false;


let fauxVraiThemes = [];


let leugtasAnswersShown = false;


let fauxVraiAnswersShown = false;


let currentPlayersData = []; // Ajout : stockage des scores pour le classement


// animation tirage


let drawAnimationInterval = null;


let drawAnimationTimeout = null;


let drawAnimationFinalTimeout = null;
let cancelListeDrawAnimation = null;


// ===============================


//         FONCTIONS UI


// ===============================


function showScreen(screenName) {
  screenLobby.classList.remove("active");
  screenRoom.classList.remove("active");

  if (screenName === "lobby") {
    stopListeIntro();
    hideListeLeaderboard();
    stopListeFinale();
    screenLobby.classList.add("active");
  } else if (screenName === "room") {
    screenRoom.classList.add("active");
  }

  if (globalControls) {
    // Nettoyage impératif : on retire tout style inline (display: flex/none)
    // qui aurait pu être forcé par des animations précédentes (victoire, etc.)
    globalControls.style.zIndex = "";

    if (screenName === "room") {
      // Dans la salle d'attente ou en jeu -> Visible
      globalControls.classList.remove("hidden");
      globalControls.style.display = "flex";
    } else {
      // À l'accueil (Lobby de connexion) -> Caché
      globalControls.classList.add("hidden");
      globalControls.style.display = "none";
    }
  }
}


function setLobbyError(msg) {


  errorLobby.textContent = msg || "";


}


function setRoomError(msg) {


  errorRoom.textContent = msg || "";


}


function phaseToText(phase) {


  switch (phase) {


    case "idle":


      return "En attente que l'hôte lance la partie.";


    case "drawingGame":


      return "Tirage du mini-jeu en cours...";


    case "rules":


      return "Lecture des règles du mini-jeu, chacun se prépare.";


    case "playing":


      return "Mini-jeu en cours.";


    default:


      return "Phase inconnue : " + phase;


  }


}


function miniGameCodeToLabel(code) {


  if (!code) return "Aucun mini-jeu en cours.";


  const map = {


    qui_suis_je: "Qui suis-je ?",


    blind_test: "Blind test",


    le_tour_du_monde: "Le tour du monde",


    le_bon_ordre: "Le bon ordre",


    le_petit_bac: "Le petit bac",
    matrice_football: "La Matrice Football",


    qui_veut_gagner_des_leugtas: "Qui veut gagner des leugtas ?",


    le_faux_du_vrai: "Le faux du vrai",


    les_encheres: "Les enchères",
    penave_ou_nachave: "Pénave ou Nachave"


  };


  return map[code] || code;


}


function miniGameCodeToLogoPath(code) {


  if (!code) return "";


  if (code === "petit_bac" || code === "le_petit_bac") {


    return "titres/le_petit_bac.png";


  }


  return "titres/" + code + ".png";


}


// petit texte de rÃ¨gles simple pour chaque mini-jeu


// (tu avais dÃ©jÃ  personnalisÃ© les textes)


function rulesTextForMiniGame(code) {


  switch (code) {


    case "qui_suis_je":


      return (


        "La carrière d'un joueur va s'afficher sur ton écran. " +


        "A toi de deviner de quel joueur il s'agit !"


      );


    case "blind_test":


      return (


        "Neuf extraits audios vont être joués : 3 dessins animés, 1 programme de télévision et 5 musiques. " +


        "A toi de retrouver le nom du programme ou le chanteur et le titre de la chanson !"


      );


    case "le_tour_du_monde":


      return (


        "Des questions sur des drapeaux, capitales, monuments, gastronomie et autres t'attendent. " +


        "Réponds le plus juste possible pour marquer des points."


      );


    case "le_bon_ordre":


      return (


        "Plusieurs éléments sont donnés dans le désordre. " +


        "A toi de les remettre dans l'ordre demandé."


      );


    case "le_petit_bac":


      return (


        "On te donne une lettre et des catégories. " +


        "Tu dois trouver un mot par catégorie qui commence par cette lettre."


      );
    case "matrice_football":
      return "Trouve un joueur correspondant aux deux critères de chaque case. Remplis les neuf cases puis valide ta grille avant la fin des 150 secondes.";


    case "qui_veut_gagner_des_leugtas":


      return (


        "Réponds à des questions à  choix multiples inspirées de 'Qui veut gagner des millions'. " +


        "Choisis la bonne réponse parmi les propositions pour marquer des points."


      );


    case "le_faux_du_vrai":


      return (


        "Parmi plusieurs affirmations, une seule est fausse. " +


        "A toi de repérer laquelle."


      );


    case "les_encheres":


      return (


        "Tu annonces combien de réponses tu peux donner sur un thème. " +


        "Celui qui annonce le plus doit prouver qu'il peut les trouver !"


      );
    case "penave_ou_nachave":
      return "Une seule affirmation pour toute la partie. Chacun répond à son tour en 20 secondes. L'hôte accepte ou refuse chaque réponse. À la fin de chaque tour, ceux qui ont échoué sont éliminés de ce mini-jeu si au moins un joueur a réussi. Le dernier en lice, ou le plus rapide en cas d'échec collectif, gagne.";


    default:


      return "Règles en cours d'écriture pour ce mini-jeu.";


  }


}


// ----- Animation tirage -----


function stopDrawAnimation() {
  // Le serveur Liste peut terminer le tirage avant le dernier callback local.
  // Invalide aussi les frames déjà programmées avant de nettoyer le visuel.
  if (cancelListeDrawAnimation) {
    cancelListeDrawAnimation();
    cancelListeDrawAnimation = null;
  }


  if (drawAnimationInterval) {


    clearInterval(drawAnimationInterval);


    drawAnimationInterval = null;


  }


  if (drawAnimationTimeout) {


    clearTimeout(drawAnimationTimeout);


    drawAnimationTimeout = null;


  }


  if (drawAnimationFinalTimeout) {


    clearTimeout(drawAnimationFinalTimeout);


    drawAnimationFinalTimeout = null;


  }


}


function startDrawAnimation(finalCode, isHost) {
  const drawingContext = listeActionContext;
  stopDrawAnimation();

  if (sfxTirage) sfxTirage.play(); 

  // Active le centrage pour mobile
  document.body.classList.add("drawing-active");

  if (mainDrawing) mainDrawing.classList.remove("hidden");
  if (drawLogo) {
    drawLogo.classList.remove("draw-logo-fullscreen");
    drawLogo.src = "";
  }
  if (drawGameLabel) drawGameLabel.textContent = "Tirage en cours...";

  const drawPool = currentRoom?.gameMode === "liste"
    ? currentRoom.listeOptions.miniGames.map((game) => game.id)
    : POSSIBLE_MINI_GAMES;
  const list = [...drawPool].sort(() => Math.random() - 0.5);
  let index = 0;
  let isShuffling = true; // Flag pour empêcher les mises à jour après l'arrêt
  let cancelled = false;
  if (currentRoom?.gameMode === "liste") {
    cancelListeDrawAnimation = () => {
      cancelled = true;
      isShuffling = false;
      document.body.classList.remove("drawing-active");
      if (drawLogo) drawLogo.classList.remove("draw-logo-fullscreen");
      if (sfxTirage) sfxTirage.stop();
    };
  }

  // Défilement rapide des logos
  drawAnimationInterval = setInterval(() => {
    if (!isShuffling) return; // Sécurité anti-écrasement du résultat

    const code = list[index % list.length];
    index++;

    requestAnimationFrame(() => {
      if (!isShuffling) return;
      if (drawLogo) drawLogo.src = miniGameCodeToLogoPath(code);
      if (drawGameLabel) drawGameLabel.textContent = miniGameCodeToLabel(code);
    });
  }, 100);

  // Fin de l'animation après 6.4 secondes
  drawAnimationTimeout = setTimeout(() => {
    if (cancelled) return;
    isShuffling = false; // On bloque immédiatement les mises à jour aléatoires

    if (drawAnimationInterval) {
      clearInterval(drawAnimationInterval);
      drawAnimationInterval = null;
    }

    // --- FORCE L'AFFICHAGE DU RÉSULTAT RÉEL ---
    // On synchronise avec le prochain frame pour être sûr que c'est le dernier mot
    requestAnimationFrame(() => {
      if (cancelled) return;
      if (drawLogo) drawLogo.src = miniGameCodeToLogoPath(finalCode);
      if (drawGameLabel) drawGameLabel.textContent = miniGameCodeToLabel(finalCode);

      // On lance le zoom seulement APRÈS avoir affiché le bon logo
      if (drawLogo) drawLogo.classList.add("draw-logo-fullscreen");
    });

    // if (sfxTirage) sfxTirage.stop();
    // if (sfxTirageFinal) sfxTirageFinal.play();

    drawAnimationFinalTimeout = setTimeout(() => {
      if (cancelled) return;
      if (drawLogo) drawLogo.classList.remove("draw-logo-fullscreen");
      document.body.classList.remove("drawing-active");

      if (isHost && currentRoom?.gameMode !== "liste") {
        emitGameAction("drawingFinished", null, drawingContext);
      }
    }, 2900);
  }, 6400);
}


// ----- Gestion de la zone principale -----


function showMainZone(mode) {


  hideAllMiniGames();


  // mode: "default" | "drawing" | "rules" | "playing"


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  if (mode === "default" && mainDefault) mainDefault.classList.remove("hidden");


  if (mode === "drawing" && mainDrawing) mainDrawing.classList.remove("hidden");


  if (mode === "rules" && mainRules) mainRules.classList.remove("hidden");


  if (mode === "playing" && mainPlaying) mainPlaying.classList.remove("hidden");


}


function hideAllMiniGames() {
  closeBonOrdreRankSelector();
  document.getElementById("bonOrdreCorrectionContainer")?.classList.add("hidden");
  document.getElementById("penaveContainer")?.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  // Cache les anciens jeux


  if (fauxVraiContainer) fauxVraiContainer.classList.add("hidden");


  if (leBonOrdreContainer) leBonOrdreContainer.classList.add("hidden");


  if (quiSuisJeContainer) quiSuisJeContainer.classList.add("hidden");


  if (tourMondeContainer) tourMondeContainer.classList.add("hidden");


  if (blindTestContainer) blindTestContainer.classList.add("hidden");


  if (petitBacContainer) petitBacContainer.classList.add("hidden");
  if (matriceFootballContainer) matriceFootballContainer.classList.add("hidden");


  // Cache les corrections


  if (correctionContainer) correctionContainer.classList.add("hidden");


  const pbContainer = document.getElementById("petitBacCorrectionContainer");


  if (pbContainer) pbContainer.classList.add("hidden");
  document.getElementById("matriceFootballCorrectionContainer")?.classList.add("hidden");


  // --- FIX ENCHÃRES ---


  const enchSetup = document.getElementById("encheresSetupContainer");


  const enchGame = document.getElementById("encheresGameContainer");


  const enchCorr = document.getElementById("encheresCorrectionContainer");


  if (enchSetup) enchSetup.classList.add("hidden");


  if (enchGame) {


      enchGame.classList.add("hidden");


      enchGame.style.display = "";


  }


  if (enchCorr) enchCorr.classList.add("hidden");


}


function lockFauxVraiButtons(selectedIndex) {


  document.querySelectorAll(".fauxvrai-answer-btn").forEach((btn, i) => {


    btn.classList.add("locked");


    if (i === selectedIndex) {


      btn.classList.add("selected");


    } else {


      btn.classList.remove("selected");


    }


  });


}


function restoreFauxVraiSubmittedState(selectedIndex) {
  lockFauxVraiButtons(selectedIndex);
  document.querySelectorAll(".fauxvrai-answer-btn").forEach((btn, index) => {
    btn.classList.add("locked");
    if (index === selectedIndex) btn.classList.add("btn-waiting-selected");
    else btn.classList.add("btn-waiting-other");
  });
  if (fauxVraiFeedback) {
    fauxVraiFeedback.textContent = "Réponse envoyée... En attente des autres joueurs.";
  }
}

function showFauxVraiQuestion(data) {


  sfx45s.play(); // Remplacement : joue 45s


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  if (fauxVraiContainer) {


    fauxVraiContainer.classList.remove("hidden");


  }


  if (fauxVraiFeedback) fauxVraiFeedback.textContent = "";


  if (fauxVraiQuestion) fauxVraiQuestion.textContent = data.question || "";


  if (fauxVraiQuestionNumber) {


    if (data.index && data.total) {


      fauxVraiQuestionNumber.textContent =


        "Question " + data.index + " / " + data.total;


    } else {


      fauxVraiQuestionNumber.textContent = "";


    }


  }


  const duration = data.duration || 30;


  if (fauxVraiTimerNumber) fauxVraiTimerNumber.textContent = String(duration);


  if (fauxVraiTimerFill) {


    fauxVraiTimerFill.style.width = "100%";


    fauxVraiTimerFill.style.background = "#ffcc00";


  }


  if (fauxVraiAnswers) {


    fauxVraiAnswers.innerHTML = "";


    const isSpec = amISpectator();


    (data.affirmations || []).forEach((txt, index) => {


      const btn = document.createElement("div");


      btn.classList.add("fauxvrai-answer-btn");


      btn.textContent = txt;


      if (isSpec) {


        btn.style.pointerEvents = "none";


        btn.style.opacity = "0.5";


        btn.classList.add("spectator-disabled");


      } else {


        // Opacité gérée par le CSS / animation


        btn.style.pointerEvents = "none";


        btn.classList.add("fv-intro-lock");


        btn.onclick = () => {


          // SÉCURITÉ : On bloque si le bouton est verrouillé (réponse donnée) OU si l'intro est en cours


          if (btn.classList.contains("locked") || btn.classList.contains("fv-intro-lock"))


            return;


          sfx40s.stop();


          sfxBubbleClick.play();


          lockFauxVraiButtons(index);


          emitGameAction("fauxVraiAnswer", index);


          btn.classList.add("btn-waiting-selected");


          const allBtns = document.querySelectorAll(".fauxvrai-answer-btn");


          allBtns.forEach((b) => {


            b.classList.add("locked");


            if (b !== btn) {


              b.classList.add("btn-waiting-other");


            }


          });


          if (fauxVraiFeedback) {


            fauxVraiFeedback.textContent =


              "Réponse envoyée... En attente des autres joueurs.";


          }


        };


      }


      fauxVraiAnswers.appendChild(btn);


    });

    if (data.hasAnswered && Number.isInteger(data.selectedAnswerIndex)) {
      restoreFauxVraiSubmittedState(data.selectedAnswerIndex);
    }

  }


}


// Les brouillons restent personnels et ne peuvent pas traverser une partie/question.
function bonOrdreDraftKey(state) {
  return `lqs_bon_ordre_${state.roomCode}_${playerId}_${state.instanceId}_${state.questionId}_${state.questionIndex}`;
}

function saveBonOrdreDraft() {
  if (!bonOrdreState || bonOrdreState.submitted || amISpectator()) return;
  try { sessionStorage.setItem(bonOrdreDraftKey(bonOrdreState), JSON.stringify(bonOrdreState.ranks)); }
  catch (_) { /* Le jeu reste utilisable si le stockage personnel est désactivé. */ }
}

function bonOrdreEventMatches(data, phases, compareSubPhase = true) {
  const phase = currentGameState.leBonOrdrePhase;
  const authoritative = currentGameState.leBonOrdreState;
  return !!data && currentRoom?.roomCode === data.roomCode && currentRoom?.gameMode === data.gameMode &&
    currentGameState.currentMiniGame === "le_bon_ordre" &&
    ["playing", "listeRoundEnd"].includes(currentGameState.phase) && phases.includes(phase) &&
    (!compareSubPhase || data.subPhase === undefined || data.subPhase === phase) &&
    data.roundNumber === currentGameState.roundNumber && data.instanceId === currentGameState.leBonOrdreInstanceId &&
    !!authoritative && authoritative.questionIndex === data.questionIndex && authoritative.questionId === data.questionId;
}

function bonOrdreContextMatches(data, state = bonOrdreState) {
  return !!state && bonOrdreEventMatches(data, ["theme", "answering"], false) &&
    data.instanceId === state.instanceId && data.questionId === state.questionId && data.questionIndex === state.questionIndex;
}

function bonOrdreCanEdit() {
  return bonOrdreContextMatches(bonOrdreState) && currentGameState.leBonOrdrePhase === "answering" && bonOrdreState.active &&
    !bonOrdreState.submitted && !bonOrdreState.pending && !amISpectator();
}

function bonOrdreOrderedIds() {
  if (!bonOrdreState || bonOrdreState.cards.length !== 5) return null;
  const entries = bonOrdreState.cards.map(card => ({ id: card.id, rank: bonOrdreState.ranks[card.id] }));
  if (entries.some(entry => !Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > 5) ||
      new Set(entries.map(entry => entry.rank)).size !== 5) return null;
  return entries.sort((left, right) => left.rank - right.rank).map(entry => entry.id);
}

function applyBonOrdreSavedAnswer(savedAnswer) {
  if (!bonOrdreState || !savedAnswer) return;
  bonOrdreState.submitted = true;
  bonOrdreState.pending = false;
  bonOrdreState.pass = savedAnswer.pass === true;
  bonOrdreState.ranks = Object.create(null);
  if (!bonOrdreState.pass && Array.isArray(savedAnswer.orderedIds)) {
    savedAnswer.orderedIds.forEach((id, index) => { bonOrdreState.ranks[id] = index + 1; });
  }
  try { sessionStorage.removeItem(bonOrdreDraftKey(bonOrdreState)); } catch (_) { /* Facultatif. */ }
  closeBonOrdreRankSelector();
}

function updateBonOrdreControls() {
  const spectator = amISpectator();
  const editable = bonOrdreCanEdit();
  if (lboValidateBtn) {
    lboValidateBtn.hidden = !!spectator;
    lboValidateBtn.disabled = !editable || !bonOrdreOrderedIds();
  }
  if (lboPassBtn) {
    lboPassBtn.hidden = !!spectator;
    lboPassBtn.disabled = !editable;
  }
  if (lboFeedback && bonOrdreState) {
    lboFeedback.style.color = bonOrdreState.submitted ? "#2ecc71" : "";
    lboFeedback.textContent = spectator ? "Vous regardez la manche…" :
      bonOrdreState.submitted ? (bonOrdreState.pass ? "Vous avez passé. En attente des autres…" : "Réponse reçue ! En attente des autres…") :
      bonOrdreState.pending ? "Envoi de votre réponse…" :
      bonOrdreState.remaining <= 0 ? "Temps écoulé. Les choix non validés ne sont pas envoyés." :
      !bonOrdreState.active ? "Préparez votre classement…" : "Touchez une carte pour lui attribuer un rang de 1 à 5.";
  }
}

function makeBonOrdreCardContent(card) {
  const content = document.createElement("span");
  content.className = "bon-ordre-card-content";
  if (card.image) {
    const image = document.createElement("img");
    image.src = card.image;
    image.alt = "";
    image.loading = "eager";
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });
    content.appendChild(image);
  }
  const name = document.createElement("span");
  name.className = "bon-ordre-card-name";
  name.textContent = card.nom;
  content.appendChild(name);
  return content;
}

function renderBonOrdreCards() {
  if (!lboCards || !bonOrdreState) return;
  lboCards.replaceChildren();
  const editable = bonOrdreCanEdit();
  bonOrdreState.cards.forEach(card => {
    const wrapper = document.createElement("div");
    wrapper.className = "bon-ordre-card-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bon-ordre-card";
    button.dataset.cardId = card.id;
    button.disabled = !editable;
    button.setAttribute("aria-haspopup", "dialog");
    const rank = bonOrdreState.ranks[card.id];
    button.setAttribute("aria-label", `${card.nom}, ${rank ? `rang ${rank}` : "sans rang"}. Choisir un rang.`);
    button.appendChild(makeBonOrdreCardContent(card));
    button.addEventListener("click", () => {
      if (!bonOrdreCanEdit()) return;
      sfxBubbleClick.play();
      openBonOrdreRankSelector(card.id, button);
    });
    wrapper.appendChild(button);
    if (rank) {
      const rankZone = document.createElement("div");
      rankZone.className = "bon-ordre-rank-zone";
      const badge = document.createElement("span");
      badge.className = "bon-ordre-rank-badge";
      badge.textContent = rank;
      badge.setAttribute("aria-label", `Rang ${rank}`);
      rankZone.appendChild(badge);
      if (editable) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "bon-ordre-clear-rank";
        clear.textContent = "×";
        clear.setAttribute("aria-label", `Annuler le rang de ${card.nom}`);
        clear.addEventListener("click", () => {
          if (!bonOrdreCanEdit()) return;
          sfxBubbleClick.play();
          closeBonOrdreRankSelector();
          delete bonOrdreState.ranks[card.id];
          saveBonOrdreDraft();
          renderBonOrdreCards();
          focusBonOrdreCard(card.id);
        });
        rankZone.appendChild(clear);
      }
      wrapper.appendChild(rankZone);
    }
    lboCards.appendChild(wrapper);
  });
  updateBonOrdreControls();
}

function focusBonOrdreCard(cardId) {
  [...(lboCards?.querySelectorAll(".bon-ordre-card") || [])]
    .find(button => button.dataset.cardId === cardId)?.focus({ preventScroll: true });
}

function closeBonOrdreRankSelector(restoreFocus = false) {
  const cardId = bonOrdrePopoverAnchor?.dataset.cardId;
  bonOrdrePopoverAnchor?.setAttribute("aria-expanded", "false");
  bonOrdrePopover?.remove();
  bonOrdrePopover = null;
  bonOrdrePopoverAnchor = null;
  if (restoreFocus && cardId) focusBonOrdreCard(cardId);
}

function positionBonOrdreRankSelector() {
  if (!bonOrdrePopover || !bonOrdrePopoverAnchor?.isConnected) return;
  const rect = bonOrdrePopoverAnchor.getBoundingClientRect();
  const popoverRect = bonOrdrePopover.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const gap = 8;
  const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - popoverRect.width / 2,
    viewportWidth - popoverRect.width - gap));
  let top = rect.bottom + gap;
  if (top + popoverRect.height > viewportHeight - gap) top = rect.top - popoverRect.height - gap;
  top = Math.max(gap, Math.min(top, viewportHeight - popoverRect.height - gap));
  bonOrdrePopover.style.left = `${left}px`;
  bonOrdrePopover.style.top = `${top}px`;
}

function openBonOrdreRankSelector(cardId, anchor) {
  if (!bonOrdreCanEdit()) return;
  if (bonOrdrePopoverAnchor === anchor) { closeBonOrdreRankSelector(true); return; }
  closeBonOrdreRankSelector();
  const card = bonOrdreState.cards.find(item => item.id === cardId);
  if (!card) return;
  bonOrdrePopoverAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  bonOrdrePopover = document.createElement("div");
  bonOrdrePopover.className = "bon-ordre-rank-popover";
  bonOrdrePopover.setAttribute("role", "dialog");
  bonOrdrePopover.setAttribute("aria-label", `Choisir le rang de ${card.nom}`);
  const label = document.createElement("div");
  label.className = "bon-ordre-rank-label";
  label.textContent = "Choisir un rang";
  bonOrdrePopover.appendChild(label);
  const choices = document.createElement("div");
  choices.className = "bon-ordre-rank-choices";
  for (let rank = 1; rank <= 5; rank += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = rank;
    button.disabled = Object.entries(bonOrdreState.ranks).some(([id, usedRank]) => id !== cardId && usedRank === rank);
    button.setAttribute("aria-label", `Rang ${rank}${button.disabled ? ", déjà attribué" : ""}`);
    button.setAttribute("aria-pressed", String(bonOrdreState.ranks[cardId] === rank));
    button.addEventListener("click", () => {
      if (!bonOrdreCanEdit() || button.disabled) return;
      bonOrdreState.ranks[cardId] = rank;
      sfxBubbleClick.play();
      saveBonOrdreDraft();
      closeBonOrdreRankSelector();
      renderBonOrdreCards();
      focusBonOrdreCard(cardId);
    });
    choices.appendChild(button);
  }
  bonOrdrePopover.appendChild(choices);
  bonOrdrePopover.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeBonOrdreRankSelector(true);
      return;
    }
    const buttons = [...choices.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    let nextIndex = index;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % buttons.length;
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else if (event.key === "Tab") {
      nextIndex = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    } else return;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  });
  document.body.appendChild(bonOrdrePopover);
  positionBonOrdreRankSelector();
  choices.querySelector('button[aria-pressed="true"]:not(:disabled)')?.focus();
  if (!bonOrdrePopover.contains(document.activeElement)) choices.querySelector("button:not(:disabled)")?.focus();
}

document.addEventListener("pointerdown", event => {
  if (bonOrdrePopover && !bonOrdrePopover.contains(event.target) && !bonOrdrePopoverAnchor?.contains(event.target)) {
    closeBonOrdreRankSelector();
  }
});
window.addEventListener("resize", positionBonOrdreRankSelector);
window.addEventListener("scroll", positionBonOrdreRankSelector, true);

function updateBonOrdreTimer(data) {
  if (!bonOrdreState) return;
  const remaining = Math.max(0, Number(data.remaining) || 0);
  const total = Number(data.total) || 45;
  const wasActive = bonOrdreState.active;
  bonOrdreState.remaining = remaining;
  bonOrdreState.active = data.active !== false && remaining > 0;
  if (lboTimerNumber) {
    lboTimerNumber.textContent = Math.ceil(remaining);
    lboTimerNumber.style.color = remaining <= 5 ? "#ff3b30" : "white";
  }
  if (lboTimerFill) {
    lboTimerFill.style.width = `${Math.min(100, remaining / total * 100)}%`;
    lboTimerFill.style.background = remaining <= 5 ? "#ff3b30" : "#ffcc00";
  }
  if (remaining <= 0) {
    closeBonOrdreRankSelector();
    sfx45s.stop();
  }
  if (!wasActive && bonOrdreState.active && !bonOrdreState.submitted &&
      !leBonOrdreContainer?.classList.contains("hidden")) sfx45s.play();
  if (wasActive !== bonOrdreState.active) renderBonOrdreCards();
  else updateBonOrdreControls();
}

function showLeBonOrdreQuestion(data) {
  if (!bonOrdreContextMatches(data)) return;
  hideAllMiniGames();
  [mainDefault, mainDrawing, mainRules, mainPlaying].forEach(element => element?.classList.add("hidden"));
  leBonOrdreContainer?.classList.remove("hidden");
  if (lboQuestion) lboQuestion.textContent = data.question.question;
  if (lboQuestionNumber) lboQuestionNumber.textContent = `Question ${data.index} / ${data.total}`;
  renderBonOrdreCards();
  if (bonOrdreState.active && bonOrdreState.remaining > 0 && !bonOrdreState.submitted) sfx45s.play();
}

function bonOrdrePhaseKey(data, phase = currentGameState.leBonOrdrePhase) {
  return `${data.roomCode}:${data.gameMode}:${data.roundNumber}:${data.instanceId}:${data.questionIndex}:${phase}`;
}

function bonOrdreRemainingMs(data) {
  const fromEvent = Math.max(0, Number(data.remainingMs) || 0);
  if (!bonOrdrePhaseSnapshot || bonOrdrePhaseSnapshot.key !== bonOrdrePhaseKey(data)) return fromEvent;
  return Math.max(0, Math.min(fromEvent,
    bonOrdrePhaseSnapshot.remainingMs - (performance.now() - bonOrdrePhaseSnapshot.receivedAt)));
}

function stopBonOrdreCorrectionClock() {
  clearInterval(bonOrdreCorrectionInterval);
  bonOrdreCorrectionInterval = null;
  bonOrdreCorrectionClock = null;
}

function clearBonOrdrePhaseDisplay() {
  ++bonOrdreDisplayToken;
  closeBonOrdreRankSelector();
  stopBonOrdreCorrectionClock();
  sfx45s.stop();
  if (bonOrdreState) bonOrdreState.active = false;
  leBonOrdreContainer?.classList.add("hidden");
  document.getElementById("bonOrdreCorrectionContainer")?.classList.add("hidden");
  palierOverlay?.classList.add("hidden");
  if (bonOrdreLeaderboardSnapshot) invalidateMiniGameLeaderboard();
  bonOrdreLeaderboardSnapshot = null;
  if (bonOrdreEndingSnapshot) {
    leugtasEndOverlay?.classList.add("hidden");
    const endLogo = document.getElementById("leugtasEndLogo");
    if (endLogo) {
      endLogo.style.animation = "";
      endLogo.style.animationDelay = "";
    }
    if (palierOverlayText) {
      for (const property of ["animation", "color", "textShadow", "webkitTextStroke", "fontSize", "fontWeight"]) {
        palierOverlayText.style[property] = "";
      }
    }
  }
  bonOrdreEndingSnapshot = null;
  bonOrdreCorrectionContext = null;
}

function syncBonOrdrePhase(gs) {
  const state = gs?.leBonOrdreState;
  const active = gs?.currentMiniGame === "le_bon_ordre" &&
    ["playing", "listeRoundEnd"].includes(gs.phase) && !!state;
  if (active) body.classList.add("bon-ordre-active");
  else body.classList.remove("bon-ordre-active");
  if (!active) {
    if (bonOrdrePhaseSnapshot) clearBonOrdrePhaseDisplay();
    bonOrdrePhaseSnapshot = null;
    bonOrdreState = null;
    return;
  }
  const key = bonOrdrePhaseKey(state, state.subPhase);
  const previous = bonOrdrePhaseSnapshot;
  const sameQuestion = previous && previous.instanceId === state.instanceId && previous.questionIndex === state.questionIndex;
  const answerStart = sameQuestion && previous.subPhase === "theme" && state.subPhase === "answering";
  if (previous?.key !== key && !answerStart) clearBonOrdrePhaseDisplay();
  const now = performance.now();
  const remainingMs = Math.max(0, Number(state.remainingMs) || 0);
  bonOrdrePhaseSnapshot = {
    ...state, key, receivedAt: now,
    remainingMs: previous?.key === key
      ? Math.min(remainingMs, Math.max(0, previous.remainingMs - (now - previous.receivedAt))) : remainingMs
  };
  if (bonOrdreState && (bonOrdreState.instanceId !== state.instanceId ||
      bonOrdreState.questionIndex !== state.questionIndex)) bonOrdreState = null;
}

function showQuiSuisJeQuestion(data) {


  sfx40s.play(); // Remplacement : joue 40s


  hideAllMiniGames();


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  if (quiSuisJeContainer) quiSuisJeContainer.classList.remove("hidden");


  const isQsjSpectator = amISpectator();


  if (qsjInput) {


    qsjInput.value = "";


    qsjInput.disabled = isQsjSpectator;


    qsjInput.style.display = isQsjSpectator ? "none" : "block";


    if (!isQsjSpectator) {


      qsjInput.focus();


      qsjInput.removeAttribute("disabled");


    }


  }


  const btns = [qsjValidateBtn, qsjPassBtn];


  btns.forEach((btn) => {


    if (btn) {


      btn.style.display = isQsjSpectator ? "none" : "inline-block";


      btn.disabled = isQsjSpectator;


      if (!isQsjSpectator) {


        btn.removeAttribute("disabled");


        btn.style.opacity = "1";


        btn.style.cursor = "pointer";


        btn.style.filter = "none";


      }


    }


  });


  if (qsjFeedback) {


    qsjFeedback.textContent = isQsjSpectator ? "Vous regardez la manche..." : "";


    qsjFeedback.style.color = "";


  }


  if (qsjQuestion) qsjQuestion.textContent = data.question.question;


  if (qsjMainImage) qsjMainImage.src = data.question.image_question;


  if (qsjQuestionNumber)


    qsjQuestionNumber.textContent = `Question ${data.index} / ${data.total}`;


  if (qsjTimerNumber) qsjTimerNumber.textContent = "40";


  if (qsjTimerFill) {


    qsjTimerFill.style.width = "100%";


    qsjTimerFill.style.background = "#ffcc00";


  }


if (!isQsjSpectator) {


    if (qsjInput) qsjInput.disabled = true;


    if (qsjValidateBtn) {


      qsjValidateBtn.disabled = true;


      qsjValidateBtn.classList.add("btn-locked-intro");


    }


  }


}


function showTourMondeQuestion(data) {


  sfx40s.play(); // Remplacement : joue 40s


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  hideAllMiniGames();


  if (tourMondeContainer) tourMondeContainer.classList.remove("hidden");


  const isTdmSpectator = amISpectator();


  if (tdmInput) {


    tdmInput.value = "";


    tdmInput.disabled = isTdmSpectator;


    if (!isTdmSpectator) tdmInput.focus();


    tdmInput.style.display = isTdmSpectator ? "none" : "block";


  }


  if (tdmValidateBtn) {


    tdmValidateBtn.style.display = isTdmSpectator ? "none" : "inline-block";


    tdmValidateBtn.disabled = isTdmSpectator;


    tdmValidateBtn.style.opacity = "1";


    tdmValidateBtn.style.cursor = "pointer";


  }


  if (tdmPassBtn) {


    tdmPassBtn.style.display = isTdmSpectator ? "none" : "inline-block";


    tdmPassBtn.disabled = isTdmSpectator;


    tdmPassBtn.style.opacity = "1";


    tdmPassBtn.style.cursor = "pointer";


  }


  if (tdmFeedback) {


    tdmFeedback.textContent = isTdmSpectator ? "Vous regardez la manche..." : "";


    tdmFeedback.style.color = "";


  }


  if (tdmQuestion) tdmQuestion.textContent = data.question.text;


  if (tdmMainImage) tdmMainImage.src = data.question.image;


  if (tdmQuestionNumber)


    tdmQuestionNumber.textContent = `Question ${data.index} / ${data.total}`;


  if (tdmTimerNumber) tdmTimerNumber.textContent = "40";


  if (tdmTimerFill) {


    tdmTimerFill.style.width = "100%";


    tdmTimerFill.style.background = "#ffcc00";


  }


if (!isTdmSpectator) {


    if (tdmInput) tdmInput.disabled = true;


    if (tdmValidateBtn) {


      tdmValidateBtn.disabled = true;


      tdmValidateBtn.classList.add("btn-locked-intro");


    }


  }


}


function showBlindTestQuestion(data) {


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  hideAllMiniGames();


  if (blindTestContainer) blindTestContainer.classList.remove("hidden");


  const isBtSpectator = amISpectator();


  if (btInput) {


    btInput.value = "";


    btInput.disabled = isBtSpectator;


    if (!isBtSpectator) btInput.focus();


    btInput.style.display = isBtSpectator ? "none" : "block";


  }


  if (btValidateBtn) {


    btValidateBtn.style.display = isBtSpectator ? "none" : "inline-block";


    btValidateBtn.disabled = isBtSpectator;


    btValidateBtn.style.opacity = isBtSpectator ? "0.5" : "1";


    btValidateBtn.style.cursor = isBtSpectator ? "default" : "pointer";


  }


  if (btPassBtn) {


    btPassBtn.style.display = isBtSpectator ? "none" : "inline-block";


    btPassBtn.disabled = isBtSpectator;


    btPassBtn.style.opacity = isBtSpectator ? "0.5" : "1";


    btPassBtn.style.cursor = isBtSpectator ? "default" : "pointer";


  }


  if (btFeedback) {


    btFeedback.textContent = isBtSpectator ? "Ecoutez l'extrait..." : "";


    btFeedback.style.color = "";


  }


  if (btQuestion) btQuestion.textContent = data.question.text || "";


  if (btQuestionNumber)


    btQuestionNumber.textContent = `Question ${data.index} / ${data.total}`;


  if (btTimerNumber) btTimerNumber.textContent = "40";


  if (btTimerFill) {


    btTimerFill.style.width = "100%";


    btTimerFill.style.background = "#ffcc00";


  }


if (!isBtSpectator) {


    if (btInput) btInput.disabled = true;


    if (btValidateBtn) {


      btValidateBtn.disabled = true;


      btValidateBtn.classList.add("btn-locked-intro");


    }


  }


  if (btMainAudio) {


    btMainAudio.src = data.question.audio || "";


    btMainAudio.load();


    btMainAudio.play().catch(() => {});


  }


}


function restorePetitBacSubmittedState() {
  if (pbFeedback) pbFeedback.textContent = "Réponse enregistrée !";
  if (pbValidateBtn) {
    pbValidateBtn.disabled = true;
    pbValidateBtn.textContent = "Grille Validée";
    pbValidateBtn.style.backgroundColor = "#ffcc00";
    pbValidateBtn.style.color = "#000";
    pbValidateBtn.style.opacity = "1";
    pbValidateBtn.style.border = "2px solid #fff";
  }
  if (pbFormZone) {
    pbFormZone.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  }
}

function setupPetitBacForm(categories) {


  if (!pbFormZone) return;


  pbFormZone.innerHTML = "";


  const isPbSpectator = amISpectator();


  categories.forEach((cat, idx) => {


    const div = document.createElement("div");


    div.className = "pb-input-group";


    if (isPbSpectator) {


      div.innerHTML = `<label>${cat}</label><input type="text" disabled placeholder="Spectateur..." style="opacity:0.5">`;


    } else {


      div.innerHTML = `<label>${cat}</label><input type="text" id="pbInput_${idx}" placeholder="...">`;


    }


    pbFormZone.appendChild(div);


  });


  if (pbValidateBtn) {


    pbValidateBtn.style.display = isPbSpectator ? "none" : "block";


    pbValidateBtn.disabled = isPbSpectator;


  }


  if (pbFeedback) pbFeedback.textContent = isPbSpectator ? "Vous regardez le Petit Bac..." : "";


}


function stopBlindTestAudio() {


  if (btMainAudio) {


    btMainAudio.pause();


    btMainAudio.currentTime = 0;


  }


  if (corrAudioPlayer) {


    corrAudioPlayer.pause();


    corrAudioPlayer.currentTime = 0;


  }


}


socket.on("leBonOrdreQuestion", (data) => {
  if (!bonOrdreEventMatches(data, ["theme", "answering"]) ||
      !data.instanceId || !data.questionId || !Number.isInteger(data.questionIndex) ||
      !Array.isArray(data.question?.cards) || data.question.cards.length !== 5) return;
  if (bonOrdreState?.instanceId === data.instanceId && data.questionIndex < bonOrdreState.questionIndex) return;
  const sameQuestion = bonOrdreState && bonOrdreContextMatches(data);
  const previousRanks = sameQuestion ? bonOrdreState.ranks : null;
  const previousSubmitted = sameQuestion && bonOrdreState.submitted;
  const previousPass = sameQuestion && bonOrdreState.pass;
  bonOrdreState = {
    roomCode: data.roomCode, gameMode: data.gameMode, roundNumber: data.roundNumber,
    instanceId: data.instanceId, questionId: data.questionId, questionIndex: data.questionIndex,
    cards: data.question.cards, ranks: Object.create(null), submitted: false, pending: false,
    active: data.timer?.active === true, remaining: data.timer?.remaining ?? 45
  };
  if (previousRanks) bonOrdreState.ranks = previousRanks;
  else if (!amISpectator()) {
    try {
      const draft = JSON.parse(sessionStorage.getItem(bonOrdreDraftKey(bonOrdreState)) || "null");
      const used = new Set();
      bonOrdreState.cards.forEach(card => {
        const rank = draft?.[card.id];
        if (Number.isInteger(rank) && rank >= 1 && rank <= 5 && !used.has(rank)) {
          bonOrdreState.ranks[card.id] = rank;
          used.add(rank);
        }
      });
    } catch (_) { /* Un brouillon invalide est simplement ignoré. */ }
  }
  if (data.hasAnswered && data.savedAnswer) applyBonOrdreSavedAnswer(data.savedAnswer);
  else if (previousSubmitted) {
    bonOrdreState.submitted = true;
    bonOrdreState.pass = previousPass;
  }
  bonOrdreCorrectionContext = null;
  const displayToken = ++bonOrdreDisplayToken;
  sfx45s.stop();
  hideAllMiniGames();
  [mainDefault, mainRules, mainDrawing, mainPlaying].forEach(element => element?.classList.add("hidden"));
  updateBonOrdreTimer(data.timer || { remaining: 45, total: 45, active: false });
  const themeDelay = currentGameState.leBonOrdrePhase === "theme"
    ? Math.max(0, bonOrdreRemainingMs(data) - 1000) : 0;
  if (themeDelay <= 0 || !palierOverlay || !palierOverlayText) {
    palierOverlay?.classList.add("hidden");
    showLeBonOrdreQuestion(data);
    return;
  }
  if (!data.isReload && !sameQuestion) sfxTheme.play();
  palierOverlayText.textContent = data.themeName || data.question.nom || "Thème";
  palierOverlay.classList.remove("hidden");
  setTimeout(() => {
    if (displayToken !== bonOrdreDisplayToken || !bonOrdreContextMatches(data)) return;
    showLeBonOrdreQuestion(data);
    setTimeout(() => {
      if (displayToken === bonOrdreDisplayToken && bonOrdreContextMatches(data)) palierOverlay.classList.add("hidden");
    }, 100);
  }, themeDelay);
});

socket.on("leBonOrdreTimerUpdate", data => {
  if (bonOrdreEventMatches(data, ["answering"]) && bonOrdreContextMatches(data)) updateBonOrdreTimer(data);
});

socket.on("leBonOrdreAnswerAck", data => {
  if (!bonOrdreEventMatches(data, ["answering"]) || !bonOrdreContextMatches(data) || !data.savedAnswer) return;
  applyBonOrdreSavedAnswer(data.savedAnswer);
  sfx45s.stop();
  renderBonOrdreCards();
});

socket.on("leBonOrdreAnswerRejected", data => {
  if (!bonOrdreEventMatches(data, ["answering"]) || !bonOrdreContextMatches(data)) return;
  bonOrdreState.pending = false;
  renderBonOrdreCards();
  if (lboFeedback) {
    lboFeedback.textContent = data.message || "La réponse n’a pas été acceptée. Réessayez.";
    lboFeedback.style.color = "#ff6b6b";
  }
});

socket.on("leBonOrdreCorrection", data => {
  if (!bonOrdreEventMatches(data, ["correction"])) return;
  handleBonOrdreCorrection(data);
});

socket.on("leBonOrdreLeaderboard", data => {
  if (!bonOrdreEventMatches(data, ["leaderboard"]) || !Array.isArray(data.players)) return;
  const key = bonOrdrePhaseKey(data);
  const updateOnly = bonOrdreLeaderboardSnapshot?.key === key;
  if (!updateOnly) {
    hideAllMiniGames();
    stopBonOrdreCorrectionClock();
    sfx45s.stop();
    palierOverlay?.classList.add("hidden");
  }
  bonOrdreLeaderboardSnapshot = { key, context: data, previousPlayers: data.previousPlayers, players: data.players };
  currentPlayersData = data.players;
  handleInterimLeaderboard(data.players, null, bonOrdreRemainingMs(data), "CLASSEMENT", updateOnly);
});

socket.on("quiSuisJeQuestion", (data) => {


  sfx40s.stop();


  // 1. Nettoyage préventif de l'interface


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  hideAllMiniGames();


  // 2. Gestion de l'Overlay (Animation "Joueur X")


  if (palierOverlay && palierOverlayText) {


    sfxTheme.play(); // <--- Son de thème demandé


    // Construction du texte : "Joueur 1", "Joueur 2"...


    palierOverlayText.textContent = "Joueur " + (data.index || "?");


    palierOverlay.classList.remove("hidden");


    // On s'assure que le conteneur du jeu est caché pendant l'animation


    if (quiSuisJeContainer) quiSuisJeContainer.classList.add("hidden");


    // 3. Délai de 1.5s avant d'afficher la question (fin de l'anim)


    setTimeout(() => {


      showQuiSuisJeQuestion(data); // Affiche la question (et lancera sfx40s)


      // On cache l'overlay juste après l'apparition du jeu


      setTimeout(() => {


        palierOverlay.classList.add("hidden");


      }, 100);


    }, 1500);


  } else {


    // Fallback si l'overlay ne fonctionne pas


    showQuiSuisJeQuestion(data);


  }


});


socket.on("quiSuisJeTimerUpdate", ({ remaining, total }) => {


  if (!amISpectator()) {


    if (qsjInput && qsjInput.disabled && !qsjInput.value.includes("JE PASSE")) {


      qsjInput.disabled = false;


    }


    const btn = document.getElementById("qsjValidateBtn");


    if (btn && btn.classList.contains("btn-locked-intro")) {


      btn.disabled = false;


      btn.classList.remove("btn-locked-intro");


      if (qsjInput) qsjInput.focus();


    }


  }


  if (!qsjTimerNumber || !qsjTimerFill) return;


  qsjTimerNumber.textContent = remaining;


  const ratio = total ? remaining / total : 0;


  qsjTimerFill.style.width = (ratio * 100) + "%";


  if (remaining <= 5) {


    qsjTimerFill.style.background = "#ff3b30";


    qsjTimerNumber.style.color = "#ff3b30";


  } else {


    qsjTimerFill.style.background = "#ffcc00";


    qsjTimerNumber.style.color = "#ffffff";


  }


  if (remaining <= 0) {


    sfx40s.stop();


  }


});


socket.on("quiSuisJeAnswerAck", () => {


  if (qsjFeedback) {


    qsjFeedback.textContent = "Réponse enregistrée !";


    qsjFeedback.style.color = "#2ecc71";


  }


  if (qsjInput) qsjInput.disabled = true;


  if (qsjValidateBtn) {


    qsjValidateBtn.disabled = true;


    qsjValidateBtn.style.opacity = "0.5";


  }


  if (qsjPassBtn) {


    qsjPassBtn.disabled = true;


    qsjPassBtn.style.opacity = "0.5";


  }


});


socket.on("quiSuisJeEnd", () => {


  sfx40s.stop();


  if (qsjFeedback) qsjFeedback.textContent = "Fin du jeu !";


});


socket.on("leTourDuMondeQuestion", (data) => {


  sfx40s.stop();


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  hideAllMiniGames();


  if (palierOverlay && palierOverlayText) {


    sfxTheme.play();


    palierOverlayText.textContent = data.themeName || "Thème";


    palierOverlay.classList.remove("hidden");


    if (tourMondeContainer) tourMondeContainer.classList.add("hidden");


    setTimeout(() => {


      showTourMondeQuestion(data);


      setTimeout(() => {


        palierOverlay.classList.add("hidden");


      }, 100);


    }, 1500);


  } else {


    showTourMondeQuestion(data);


  }


});


socket.on("leTourDuMondeTimerUpdate", ({ remaining, total }) => {


  if (!amISpectator()) {


    if (tdmInput && tdmInput.disabled && !tdmInput.value.includes("JE PASSE")) tdmInput.disabled = false;


    const btn = document.getElementById("tdmValidateBtn");


    if (btn && btn.classList.contains("btn-locked-intro")) {


      btn.disabled = false;


      btn.classList.remove("btn-locked-intro");


      if (tdmInput) tdmInput.focus();


    }


  }


  if (!tdmTimerNumber || !tdmTimerFill) return;


  tdmTimerNumber.textContent = remaining;


  const ratio = total ? remaining / total : 0;


  tdmTimerFill.style.width = (ratio * 100) + "%";


  if (remaining <= 5) tdmTimerFill.style.background = "#ff3b30";


  else tdmTimerFill.style.background = "#ffcc00";


  if (remaining <= 0) {


    sfx40s.stop();


  }


});


socket.on("leTourDuMondeAnswerAck", () => {


  if (tdmFeedback) {


    tdmFeedback.textContent = "Réponse enregistrée ! En attente des autres...";


    tdmFeedback.style.color = "#2ecc71";


  }


  if (tdmInput) tdmInput.disabled = true;


  if (tdmValidateBtn) {


    tdmValidateBtn.disabled = true;


    tdmValidateBtn.style.opacity = "0.5";


    tdmValidateBtn.style.cursor = "default";


  }


  if (tdmPassBtn) {


    tdmPassBtn.disabled = true;


    tdmPassBtn.style.opacity = "0.5";


    tdmPassBtn.style.cursor = "default";


  }


});


socket.on("leTourDuMondeEnd", () => {


  sfx40s.stop();


  if (tdmFeedback) tdmFeedback.textContent = "Fin du jeu !";


});


socket.on("blindTestQuestion", (data) => {


  stopBlindTestAudio();


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  hideAllMiniGames();


  if (palierOverlay && palierOverlayText) {


    sfxTheme.play();


    palierOverlayText.textContent = data.themeName || "Thème";


    palierOverlay.classList.remove("hidden");


    if (blindTestContainer) blindTestContainer.classList.add("hidden");


    setTimeout(() => {


      showBlindTestQuestion(data);


      setTimeout(() => {


        palierOverlay.classList.add("hidden");


      }, 100);


    }, 1500);


  } else {


    showBlindTestQuestion(data);


  }


});


socket.on("blindTestTimerUpdate", ({ remaining, total }) => {


  if (!amISpectator()) {


    if (btInput && btInput.disabled && !btInput.value.includes("JE PASSE")) {


      btInput.disabled = false;


    }


    const btn = document.getElementById("btValidateBtn");


    if (btn && btn.classList.contains("btn-locked-intro")) {


      btn.disabled = false;


      btn.classList.remove("btn-locked-intro");


      if (btInput) btInput.focus();


    }


  }


  if (!btTimerNumber || !btTimerFill) return;


  btTimerNumber.textContent = remaining;


  const ratio = total ? remaining / total : 0;


  btTimerFill.style.width = ratio * 100 + "%";


  btTimerFill.style.background = remaining <= 5 ? "#ff3b30" : "#ffcc00";


});


socket.on("blindTestAnswerAck", () => {


  if (btFeedback) {


    btFeedback.textContent = "Réponse enregistrée ! En attente des autres...";


    btFeedback.style.color = "#2ecc71";


  }


  if (btInput) btInput.disabled = true;


  if (btValidateBtn) {


    btValidateBtn.disabled = true;


    btValidateBtn.style.opacity = "0.5";


    btValidateBtn.style.cursor = "default";


  }


  if (btPassBtn) {


    btPassBtn.disabled = true;


    btPassBtn.style.opacity = "0.5";


    btPassBtn.style.cursor = "default";


  }


});


socket.on("blindTestEnd", () => {


  stopBlindTestAudio();


  if (btFeedback) btFeedback.textContent = "Fin du jeu !";


});


socket.on("petitBacStart", (data) => {
  showMainZone("playing");
  hideAllMiniGames();
  
  if (petitBacContainer) petitBacContainer.classList.remove("hidden");
  if (pbLetterDisplay) pbLetterDisplay.textContent = data.letter;
  setupPetitBacForm(data.categories);
  if (data.savedAnswers && pbFormZone) {
    pbFormZone.querySelectorAll("input").forEach((input, index) => {
      input.value = data.savedAnswers[index] || "";
    });
  }
  if (data.hasAnswered) restorePetitBacSubmittedState();

  // --- AJOUT : On force l'affichage à 150 (ou la durée reçue) tout de suite ---
  if (pbTimerNumber && data.duration) {
      pbTimerNumber.textContent = data.duration;
  }
  if (pbTimerFill) {
      pbTimerFill.style.width = "100%";
      pbTimerFill.style.background = "#ffcc00";
  }
  // --------------------------------------------------------------------------

  if (palierOverlay && palierOverlayText) {
    sfxTheme.play();
    palierOverlayText.textContent = "Lettre " + data.letter;
    palierOverlay.classList.remove("hidden");
    setTimeout(() => {
      palierOverlay.classList.add("hidden");
      sfx150s.play(); 
    }, 2000);
  }
});

function renderMatriceFootballGrid(target, matrix, answers = {}, grades = null, canGrade = false, onGrade = null) {
  if (!target || !matrix || !Array.isArray(matrix.columns) || !Array.isArray(matrix.rows)) return;
  target.replaceChildren();
  const corner = document.createElement("div");
  corner.className = "mf-header";
  target.appendChild(corner);
  const addHeader = (source, label) => {
    const wrap = document.createElement("div");
    wrap.className = "mf-header";
    const img = document.createElement("img");
    img.src = "/" + String(source).replace(/^\/+/, "");
    img.alt = label;
    wrap.appendChild(img);
    target.appendChild(wrap);
  };
  matrix.columns.forEach((source, column) => addHeader(source, `Critère de colonne ${column + 1}`));
  matrix.rows.forEach((source, row) => {
    addHeader(source, `Critère de ligne ${row + 1}`);
    for (let column = 0; column < 3; column++) {
      const index = row * 3 + column;
      const cell = document.createElement("div");
      cell.className = "mf-cell";
      if (grades === null) {
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 120;
        input.dataset.mfIndex = String(index);
        input.setAttribute("aria-label", `Ligne ${row + 1}, colonne ${column + 1}`);
        input.value = answers[index] || "";
        cell.appendChild(input);
      } else {
        const answer = document.createElement("div");
        answer.className = "mf-answer";
        answer.textContent = answers[index] || "—";
        cell.appendChild(answer);
        const buttons = document.createElement("div");
        buttons.className = "mf-grade-buttons";
        for (const [value, label, style] of [[1, "1", "pb-1"], [0.5, "0,5", "pb-05"], [0, "0", "pb-0"]]) {
          const button = document.createElement("button");
          button.className = `pb-btn-small ${style}${grades[index] === value ? " active" : ""}`;
          button.textContent = label;
          button.disabled = !canGrade || !answers[index]?.trim();
          if (canGrade && onGrade) button.addEventListener("click", () => onGrade(index, value));
          buttons.appendChild(button);
        }
        cell.appendChild(buttons);
      }
      target.appendChild(cell);
    }
  });
}

socket.on("matriceFootballStart", (data) => {
  if (currentRoom?.gameMode !== data.gameMode || currentGameState.roundNumber !== data.roundNumber ||
      currentGameState.currentMiniGame !== "matrice_football" ||
      data.roomCode !== currentRoom?.roomCode || !data.instanceId) return;
  const same = matriceFootballRoomCode === data.roomCode &&
    matriceFootballInstanceId === data.instanceId &&
    currentMatriceFootball?.id === data.matrix?.id &&
    matriceFootballRoundNumber === data.roundNumber;
  if (same && currentMatriceFootballCorrection?.instanceId === data.instanceId &&
      !document.getElementById("matriceFootballCorrectionContainer")?.classList.contains("hidden")) return;
  const wasSubmitting = same && !matriceFootballSubmitted && mfValidateBtn?.disabled;
  if (!same || matriceFootballContainer?.classList.contains("hidden")) {
    showMainZone("playing");
    matriceFootballContainer?.classList.remove("hidden");
  }
  if (!same) {
    currentMatriceFootballCorrection = null;
    matriceFootballSubmitted = false;
  }
  currentMatriceFootball = data.matrix;
  matriceFootballRoundNumber = data.roundNumber;
  matriceFootballInstanceId = data.instanceId;
  matriceFootballRoomCode = data.roomCode;
  matriceFootballSubmitted = !!data.hasAnswered || (same && matriceFootballSubmitted);
  document.getElementById("mfQuestion").textContent = data.matrix.question || "";
  if (!same || !mfPlayingGrid?.children.length) {
    renderMatriceFootballGrid(mfPlayingGrid, data.matrix,
      data.hasAnswered ? data.savedAnswers || {} : {});
  } else if (data.hasAnswered) {
    mfPlayingGrid.querySelectorAll("input[data-mf-index]").forEach((input) => {
      input.value = data.savedAnswers?.[input.dataset.mfIndex] || "";
    });
  }
  const locked = matriceFootballSubmitted || amISpectator();
  mfPlayingGrid?.querySelectorAll("input").forEach((input) => { input.disabled = locked; });
  if (mfValidateBtn) {
    mfValidateBtn.style.display = amISpectator() ? "none" : "block";
    mfValidateBtn.disabled = locked || wasSubmitting;
    mfValidateBtn.textContent = matriceFootballSubmitted ? "Grille validée" : "Valider ma grille";
  }
  if (mfFeedback) mfFeedback.textContent = matriceFootballSubmitted ? "Grille enregistrée !" :
    wasSubmitting ? "Validation en cours…" : "";
  document.getElementById("mfTimerNumber").textContent = data.duration;
  document.getElementById("mfTimerFill").style.width = "100%";
  if (!data.isReload) {
    sfxTheme.play();
    sfx150s.play();
  }
});

socket.on("matriceFootballTimerUpdate", ({ remaining, total, roundNumber, instanceId }) => {
  if (currentGameState.currentMiniGame !== "matrice_football" ||
      roundNumber !== matriceFootballRoundNumber || instanceId !== matriceFootballInstanceId) return;
  document.getElementById("mfTimerNumber").textContent = remaining;
  document.getElementById("mfTimerFill").style.width = `${Math.max(0, remaining / total * 100)}%`;
  if (remaining <= 0) sfx150s.stop();
});

mfValidateBtn?.addEventListener("click", () => {
  if (mfValidateBtn.disabled || !currentMatriceFootball || !currentRoom || amISpectator()) return;
  const answers = {};
  mfPlayingGrid.querySelectorAll("input[data-mf-index]").forEach((input) => {
    answers[input.dataset.mfIndex] = input.value.trim();
  });
  mfValidateBtn.disabled = true;
  if (mfFeedback) mfFeedback.textContent = "Validation en cours…";
  sfxBubbleClick.play();
  emitGameAction("matriceFootballAnswer", { answers, roundNumber: matriceFootballRoundNumber,
    matrixId: currentMatriceFootball.id, instanceId: matriceFootballInstanceId });
});

socket.on("matriceFootballAnswerAck", ({ roundNumber, matrixId, instanceId }) => {
  if (roundNumber !== matriceFootballRoundNumber || matrixId !== currentMatriceFootball?.id ||
      instanceId !== matriceFootballInstanceId) return;
  matriceFootballSubmitted = true;
  mfPlayingGrid?.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  if (mfValidateBtn) { mfValidateBtn.disabled = true; mfValidateBtn.textContent = "Grille validée"; }
  if (mfFeedback) mfFeedback.textContent = "Grille enregistrée !";
});

socket.on("matriceFootballEnd", ({ roundNumber, instanceId }) => {
  if (roundNumber !== matriceFootballRoundNumber || instanceId !== matriceFootballInstanceId) return;
  sfx150s.stop();
  mfPlayingGrid?.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  if (mfValidateBtn) mfValidateBtn.disabled = true;
  if (mfFeedback) mfFeedback.textContent = matriceFootballSubmitted ? "Manche terminée !" :
    "Grille non validée dans le temps imparti";
});

socket.on("petitBacTimerUpdate", ({ remaining, total }) => {


  if (pbTimerNumber) pbTimerNumber.textContent = remaining;


  if (pbTimerFill) pbTimerFill.style.width = (remaining / total) * 100 + "%";


  if (remaining <= 0) {


    sfx150s.stop();


  }


});


socket.on("petitBacAnswerAck", () => {
  restorePetitBacSubmittedState();
});


socket.on("petitBacEnd", () => {


  sfx150s.stop();


  if (pbFeedback) {


    pbFeedback.textContent = "Manche terminée !";


    pbFeedback.style.color = "#ffcc00";


  }


  if (pbValidateBtn) pbValidateBtn.disabled = true;


});


function submitBonOrdreAnswer(pass) {
  if (!bonOrdreCanEdit()) return;
  const orderedIds = pass ? null : bonOrdreOrderedIds();
  if (!pass && !orderedIds) return;
  sfxBubbleClick.play();
  closeBonOrdreRankSelector();
  bonOrdreState.pending = true;
  emitGameAction("leBonOrdreAnswer", {
    gameMode: bonOrdreState.gameMode,
    roundNumber: bonOrdreState.roundNumber, instanceId: bonOrdreState.instanceId,
    questionId: bonOrdreState.questionId, questionIndex: bonOrdreState.questionIndex,
    orderedIds, pass
  });
  renderBonOrdreCards();
}

lboValidateBtn?.addEventListener("click", () => submitBonOrdreAnswer(false));
lboPassBtn?.addEventListener("click", () => submitBonOrdreAnswer(true));

if (qsjValidateBtn) {


  qsjValidateBtn.addEventListener("click", () => {


    if (


      qsjValidateBtn.disabled ||


      qsjValidateBtn.classList.contains("btn-locked-intro")


    )


      return;


    sfx40s.stop();


    sfxBubbleClick.play();


    if (!currentRoom || !qsjInput) return;


    const val = qsjInput.value.trim();


    if (!val) return;


    emitGameAction("quiSuisJeAnswer", {


      roomCode: currentRoom.roomCode,


      answer: val


    });


  });


}


if (qsjPassBtn) {


  qsjPassBtn.addEventListener("click", () => {


    if (qsjPassBtn.disabled) return;


    sfx40s.stop();


    sfxBubbleClick.play();


    if (!currentRoom) return;


    emitGameAction("quiSuisJeAnswer", {


      roomCode: currentRoom.roomCode,


      answer: "JE PASSE"


    });


    if (qsjInput) qsjInput.value = "JE PASSE";


  });


}


if (tdmValidateBtn) {


  tdmValidateBtn.addEventListener("click", () => {


    if (


      tdmValidateBtn.disabled ||


      tdmValidateBtn.classList.contains("btn-locked-intro")


    )


      return;


    sfx40s.stop();


    sfxBubbleClick.play();


    if (!currentRoom || !tdmInput) return;


    const val = tdmInput.value.trim();


    if (!val) return;


    emitGameAction("leTourDuMondeAnswer", {


      roomCode: currentRoom.roomCode,


      answer: val


    });


  });


}


if (tdmPassBtn) {


  tdmPassBtn.addEventListener("click", () => {


    if (tdmPassBtn.disabled) return;


    sfx40s.stop();


    sfxBubbleClick.play();


    if (!currentRoom) return;


    emitGameAction("leTourDuMondeAnswer", {


      roomCode: currentRoom.roomCode,


      answer: "JE PASSE"


    });


    if (tdmInput) tdmInput.value = "JE PASSE";


  });


}


if (btValidateBtn) {


  btValidateBtn.addEventListener("click", () => {


    if (


      btValidateBtn.disabled ||


      btValidateBtn.classList.contains("btn-locked-intro")


    )


      return;


    sfxBubbleClick.play();


    if (!currentRoom || !btInput) return;


    const val = btInput.value.trim();


    if (!val) return;


    emitGameAction("blindTestAnswer", {


      roomCode: currentRoom.roomCode,


      answer: val


    });


  });


}


if (pbValidateBtn) {


  pbValidateBtn.addEventListener("click", () => {


    if (pbValidateBtn.disabled) return;


    sfx150s.stop();


    sfxBubbleClick.play();


    if (!currentRoom || !pbFormZone) return;


    const inputs = pbFormZone.querySelectorAll("input");


    const answers = {};


    inputs.forEach((inp, idx) => {


      answers[idx] = inp.value.trim();


    });


    emitGameAction("petitBacAnswer", {


      roomCode: currentRoom.roomCode,


      answers


    });


  });


}


if (btPassBtn) {


  btPassBtn.addEventListener("click", () => {


    if (btPassBtn.disabled) return;


    sfxBubbleClick.play();


    if (!currentRoom) return;


    emitGameAction("blindTestAnswer", {


      roomCode: currentRoom.roomCode,


      answer: "JE PASSE"


    });


    if (btInput) btInput.value = "JE PASSE";


  });


}


  /**


   * Affiche le classement intermÃ©diaire.


   * @param {Array} players - DonnÃ©es joueurs


   * @param {Function} callback - Fonction Ã  exÃ©cuter APRES la fermeture


   * @param {Number} duration - DurÃ©e d'affichage en ms (dÃ©faut 4000)


   */


let miniGameLeaderboardVersion = 0;

function invalidateMiniGameLeaderboard() {
  miniGameLeaderboardVersion++;
  document.getElementById("leaderboard-overlay")?.classList.remove("active");
  document.getElementById("leaderboard-overlay")?.classList.remove("penave-ranking-active");
}

function captureMiniGameLeaderboardContext() {
  const version = miniGameLeaderboardVersion;
  const roomCode = currentRoom?.roomCode;
  const gameMode = currentRoom?.gameMode;
  const tournamentId = currentRoom?.listeTournament?.tournamentId;
  const actionTournamentId = listeActionContext?.tournamentId;
  const actionRound = listeActionContext?.roundNumber;
  const actionMiniGame = listeActionContext?.miniGame;
  const roundNumber = currentGameState.roundNumber;
  const miniGame = currentGameState.currentMiniGame;
  const question = listeActionContext?.question;

  return () => {
    if (!currentRoom || version !== miniGameLeaderboardVersion ||
        currentRoom.roomCode !== roomCode || currentRoom.gameMode !== gameMode ||
        currentGameState.roundNumber !== roundNumber || currentGameState.currentMiniGame !== miniGame) return false;
    if (!["playing", "listeRoundEnd"].includes(currentGameState.phase)) return false;
    if (gameMode === "liste") {
      if (currentRoom.listeTournament?.tournamentId !== tournamentId ||
          listeActionContext?.tournamentId !== actionTournamentId ||
          listeActionContext?.roundNumber !== actionRound || listeActionContext?.miniGame !== actionMiniGame) return false;
      const phase = listeActionContext?.phase || currentGameState.phase;
      if (!["playing", "listeRoundEnd"].includes(phase)) return false;
      // La fin normale peut avancer l'index serveur sans nouvelle question affichée.
      if (phase !== "listeRoundEnd" && listeActionContext?.question !== question) return false;
    }
    return true;
  };
}

function handleInterimLeaderboard(players, callback, duration = 4000, customTitle = "Classement", updateOnly = false) {
  if (!updateOnly) miniGameLeaderboardVersion++;
  const isCurrentDisplay = captureMiniGameLeaderboardContext();
  if (!isCurrentDisplay()) return isCurrentDisplay;


  const overlay = document.getElementById("leaderboard-overlay");


  const content = document.getElementById("leaderboard-content");


  const titleEl = document.getElementById("leaderboardTitle");


  if (!overlay || !content) {


    if (callback) callback();


    return isCurrentDisplay;


  }


  if (titleEl) {


    titleEl.textContent = customTitle;


  }


  const sorted = currentRoom?.gameMode === "liste" ? players : [...players].sort((a, b) => {


    if (b.score !== a.score) {


      return b.score - a.score;


    }


    const timeA = parseFloat(a.time) || 0;


    const timeB = parseFloat(b.time) || 0;


    return timeA - timeB;


  });


  // MODIFICATION : Détection si c'est le classement final pour afficher les émoticones


  const isFinal = customTitle === "CLASSEMENT FINAL";


  content.innerHTML = sorted


    .map((p, i) => {

      const place = currentRoom?.gameMode === "liste" ? p.place : i + 1;


      const color =


        place === 1 ? "#FFD700" : place === 2 ? "#C0C0C0" : place === 3 ? "#CD7F32" : "white";


      const timeDisplay =


        p.time !== undefined ? parseFloat(p.time).toFixed(1) + "s" : "";


      // MODIFICATION : Logique d'affichage (Validé ou Éliminé)


      let statusIcon = "";


      if (isFinal && currentRoom?.gameMode !== "liste") {


        // Si c'est le dernier joueur de la liste triée, il est éliminé


        if (i === sorted.length - 1) {


          statusIcon = "💀"; 


        } else {


          statusIcon = "✅";


        }


      }


      return `


        <div class="player-row ${place === 1 ? "rank-1" : ""}">


          <div class="rank-num" style="color:${color}">#${place}</div>


          <div class="p-name">${escapeHtmlText(p.nickname)}</div>


          <div class="p-score">${p.score} pts</div>


          <div class="p-time">${timeDisplay}</div>


          <div class="p-meta" style="font-size: 1.5rem; text-align: center; min-width: 40px;">${statusIcon}</div>


        </div>


      `;


    })


    .join("");


  overlay.classList.add("active");

  // Un abandon actualise les lignes sans redémarrer le délai de cet écran.
  if (updateOnly) return isCurrentDisplay;


  setTimeout(() => {
    if (!isCurrentDisplay()) return;
    overlay.classList.remove("active");


    if (callback) callback();


  }, duration);
  return isCurrentDisplay;
}


// Le mode Liste ne trie ni ne calcule rien côté client : le classement affiché
// est la copie exacte du snapshot envoyé par le serveur avec gameStateUpdate.
const listeLeaderboardHowls = new Map();
let listeLeaderboardAudio = null;
let listeLeaderboardAudioVersion = 0;

function preloadListeLeaderboardSounds() {
  if (listeLeaderboardHowls.size) return;
  for (let number = 1; number <= 15; number++) {
    const url = `/sons/classement_general_${number}.mp3`;
    try {
      listeLeaderboardHowls.set(url, new Howl({
        src: [url], volume: 0.5, preload: true, loop: false,
        onloaderror: (_id, error) => console.warn(`Son de classement indisponible : ${url}`, error)
      }));
    } catch (error) {
      console.warn(`Son de classement indisponible : ${url}`, error);
    }
  }
}

function stopListeLeaderboardSound() {
  listeLeaderboardAudioVersion++;
  if (!listeLeaderboardAudio) return;
  clearTimeout(listeLeaderboardAudio.timer);
  if (listeLeaderboardAudio.playId !== null) {
    listeLeaderboardAudio.howl.stop(listeLeaderboardAudio.playId);
  }
  listeLeaderboardAudio = null;
}

function syncListeLeaderboardSound(sound) {
  const roomCode = currentRoom?.roomCode;
  const tournamentId = currentRoom?.listeTournament?.tournamentId;
  if (isQuitting || currentRoom?.gameMode !== "liste" ||
      currentGameState?.phase !== "listeLeaderboard" || !sound ||
      sound.tournamentId !== tournamentId ||
      sound.roundNumber !== currentGameState.roundNumber) {
    stopListeLeaderboardSound();
    return;
  }
  const key = `${roomCode}:${tournamentId}:${sound.roundNumber}:${sound.url}`;
  if (listeLeaderboardAudio?.key === key) return;
  stopListeLeaderboardSound();
  const remainingMs = Math.max(0, 8000 - Number(sound.elapsedMs));
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
  const howl = listeLeaderboardHowls.get(sound.url);
  if (!howl) return;
  const version = listeLeaderboardAudioVersion;
  const receivedAt = Date.now();
  const audio = { key, howl, playId: null, timer: null };
  listeLeaderboardAudio = audio;
  const isCurrent = () => listeLeaderboardAudio === audio &&
    listeLeaderboardAudioVersion === version && !isQuitting &&
    currentRoom?.roomCode === roomCode && currentRoom?.gameMode === "liste" &&
    currentRoom?.listeTournament?.tournamentId === tournamentId &&
    currentGameState?.phase === "listeLeaderboard" &&
    currentGameState.roundNumber === sound.roundNumber &&
    currentGameState.listeLeaderboard?.sound?.url === sound.url;
  audio.timer = setTimeout(() => {
    if (isCurrent()) stopListeLeaderboardSound();
  }, remainingMs);
  const start = () => {
    if (!isCurrent()) return;
    const elapsedSeconds = (Number(sound.elapsedMs) + Date.now() - receivedAt) / 1000;
    const duration = howl.duration();
    if (elapsedSeconds >= duration || elapsedSeconds >= 8) return;
    try {
      audio.playId = howl.play();
      howl.seek(elapsedSeconds, audio.playId);
    } catch (error) {
      console.warn(`Lecture du classement impossible : ${sound.url}`, error);
    }
  };
  if (howl.state() === "loaded") start();
  else howl.once("load", start);
}

function renderListeLeaderboard(leaderboard) {
  const overlay = document.getElementById("liste-leaderboard-overlay");
  const title = document.getElementById("listeLeaderboardTitle");
  const winners = document.getElementById("listeLeaderboardWinners");
  const content = document.getElementById("listeLeaderboardContent");
  if (!overlay || !title || !winners || !content) return;

  const ranking = Array.isArray(leaderboard?.ranking) ? leaderboard.ranking : [];
  const winnerIds = new Set(Array.isArray(leaderboard?.winners) ? leaderboard.winners : []);
  const isFinal = leaderboard?.isFinal === true;

  title.textContent = isFinal ? "Classement final" : "Classement général";
  winners.textContent = "";
  winners.classList.toggle("hidden", !isFinal);
  if (isFinal) {
    const winnerNames = ranking
      .filter((entry) => winnerIds.has(entry.playerId))
      .map((entry) => entry.pseudo || "Joueur");
    winners.textContent = winnerNames.length === 0
      ? "Aucun participant admissible ne reste."
      : winnerNames.length === 1
        ? `Vainqueur : ${winnerNames[0]}`
        : `Vainqueurs ex æquo : ${winnerNames.join(" et ")}`;
  }

  content.replaceChildren();
  if (ranking.length === 0) {
    const empty = document.createElement("p");
    empty.className = "liste-leaderboard-empty";
    empty.textContent = "Aucun participant admissible ne reste.";
    content.appendChild(empty);
  } else {
    ranking.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `liste-leaderboard-row${entry.place === 1 ? " liste-leaderboard-first" : ""}`;

      const place = document.createElement("div");
      place.className = "liste-leaderboard-place";
      place.textContent = `${entry.place}.`;

      const pseudo = document.createElement("div");
      pseudo.className = "liste-leaderboard-pseudo";
      pseudo.textContent = entry.pseudo || "Joueur";

      const points = document.createElement("div");
      points.className = "liste-leaderboard-points";
      points.textContent = `${entry.tournamentPoints} pts`;

      const time = document.createElement("div");
      time.className = "liste-leaderboard-time";
      const totalTime = Number.isFinite(entry.tournamentTime) ? entry.tournamentTime : 0;
      time.textContent = `${totalTime.toFixed(1)} s`;

      row.append(place, pseudo, points, time);
      content.appendChild(row);
    });
  }

  overlay.classList.add("active");
}

function hideListeLeaderboard() {
  stopListeLeaderboardSound();
  document.getElementById("liste-leaderboard-overlay")?.classList.remove("active");
}

const LISTE_FINALE_FRAMES = Object.freeze([0, 1, 2, 3, 4, 3, 2, 1]);
const LISTE_FINALE_URLS = Object.freeze(Array.from({ length: 5 }, (_, i) =>
  `/animation_liste/fin/fin_${i}.png`));
const LISTE_FINALE_DURATION_MS = 20000;
let listeFinaleImages = null;
let listeFinaleImagesReady = null;
let listeFinaleSound = null;
let listeFinalePlayback = null;

function listeFinaleFrameAt(elapsedMs) {
  const clamped = Math.max(0, Math.min(LISTE_FINALE_DURATION_MS - 1, elapsedMs));
  return LISTE_FINALE_FRAMES[Math.floor(clamped / 150) % LISTE_FINALE_FRAMES.length];
}

function preloadListeFinale() {
  if (!listeFinaleImages) {
    listeFinaleImages = LISTE_FINALE_URLS.map((url) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    listeFinaleImagesReady = Promise.all(listeFinaleImages.map((image) =>
      typeof image.decode === "function" ? image.decode().catch(() => {}) :
        new Promise((resolve) => {
          if (image.complete) return resolve();
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        })));
  }
  if (!listeFinaleSound && typeof Howl === "function") {
    listeFinaleSound = new Howl({
      src: ["/animation_liste/fin/fin_son.mp3"], preload: true, volume: 1, loop: false,
      onplay(id) {
        const playback = listeFinalePlayback;
        if (!playback || (playback.audioId != null && playback.audioId !== id) ||
            !isCurrentListeFinale(playback)) {
          this.stop(id);
          return;
        }
        const elapsed = listeFinaleElapsed(playback);
        if (elapsed >= LISTE_FINALE_DURATION_MS || elapsed >= this.duration() * 1000) {
          this.stop(id);
          playback.audioId = null;
        } else {
          this.seek(elapsed / 1000, id);
        }
      },
      onplayerror(id, error) {
        console.warn("Son final Liste bloqué", error);
        const playback = listeFinalePlayback;
        if (playback?.audioId !== id) return;
        this.once("unlock", () => {
          if (!isCurrentListeFinale(playback) || listeFinaleElapsed(playback) >= LISTE_FINALE_DURATION_MS) return;
          this.stop(id);
          playback.audioId = null;
          playback.audioStarted = false;
          renderListeFinale(playback);
        });
      },
      onloaderror(_id, error) { console.warn("Son final Liste indisponible", error); }
    });
  }
}

function listeFinaleElapsed(playback) {
  return Math.max(0, playback.anchorElapsed + performance.now() - playback.anchorNow);
}

function isCurrentListeFinale(playback) {
  return listeFinalePlayback === playback && !isQuitting &&
    currentRoom?.roomCode === playback.roomCode && currentRoom?.gameMode === "liste" &&
    currentRoom?.listeTournament?.tournamentId === playback.tournamentId &&
    currentGameState?.phase === "listeFinished" &&
    currentGameState.roundNumber === playback.roundNumber;
}

function stopListeFinale() {
  const playback = listeFinalePlayback;
  listeFinalePlayback = null;
  if (playback?.timer) clearTimeout(playback.timer);
  if (playback?.audioId != null) listeFinaleSound?.stop(playback.audioId);
  document.getElementById("liste-finale-overlay")?.classList.remove("active");
}

function renderListeFinale(playback) {
  if (!isCurrentListeFinale(playback) || !playback.ready) return;
  if (playback.timer) clearTimeout(playback.timer);
  playback.timer = null;
  const elapsed = listeFinaleElapsed(playback);
  const frame = listeFinaleFrameAt(elapsed);
  const url = LISTE_FINALE_URLS[frame];
  if (playback.image.dataset.frame !== String(frame)) {
    playback.image.src = url;
    playback.image.dataset.frame = String(frame);
  }
  playback.overlay.classList.add("active");
  if (elapsed < LISTE_FINALE_DURATION_MS && !playback.audioStarted && listeFinaleSound) {
    playback.audioStarted = true;
    const durationMs = listeFinaleSound.duration() * 1000;
    if (!durationMs || elapsed < durationMs) {
      try { playback.audioId = listeFinaleSound.play(); }
      catch (error) { console.warn("Lecture finale Liste impossible", error); }
    }
  }
  if (elapsed >= LISTE_FINALE_DURATION_MS) {
    if (playback.audioId != null) {
      listeFinaleSound?.stop(playback.audioId);
      playback.audioId = null;
    }
    return;
  }
  const next = Math.min(LISTE_FINALE_DURATION_MS,
    (Math.floor(elapsed / 150) + 1) * 150);
  playback.timer = setTimeout(() => renderListeFinale(playback), Math.max(1, next - elapsed));
}

function syncListeFinale(gs) {
  const info = gs.listeFinale;
  const roomCode = currentRoom?.roomCode;
  if (!info || info.gameMode !== "liste" || !roomCode ||
      info.tournamentId !== currentRoom?.listeTournament?.tournamentId ||
      !Number.isFinite(info.elapsedMs) || info.durationMs !== LISTE_FINALE_DURATION_MS) {
    stopListeFinale();
    return;
  }
  const label = document.getElementById("listeFinaleLabel");
  const names = document.getElementById("listeFinaleNames");
  const winners = Array.isArray(info.winners) ? info.winners : [];
  if (label && names) {
    label.textContent = winners.length === 0 ? "Tournoi terminé" :
      winners.length === 1 ? "VICTOIRE DE" : "VAINQUEURS EX ÆQUO";
    names.textContent = winners.map((winner) => winner.pseudo || "Joueur").join(" · ");
  }
  const key = `${roomCode}:${info.tournamentId}:${info.roundNumber}:${info.startedAt}`;
  if (listeFinalePlayback?.key !== key) {
    stopListeFinale();
    preloadListeFinale();
    const overlay = document.getElementById("liste-finale-overlay");
    const image = document.getElementById("listeFinaleFrame");
    if (!overlay || !image || !label || !names) return;
    listeFinalePlayback = {
      key, roomCode, tournamentId: info.tournamentId, roundNumber: info.roundNumber,
      overlay, image, timer: null, audioId: null, audioStarted: false,
      anchorElapsed: info.elapsedMs, anchorNow: performance.now(), ready: false
    };
    const playback = listeFinalePlayback;
    listeFinaleImagesReady.then(() => {
      if (!isCurrentListeFinale(playback)) return;
      playback.ready = true;
      renderListeFinale(playback);
    });
  } else {
    listeFinalePlayback.anchorElapsed = info.elapsedMs;
    listeFinalePlayback.anchorNow = performance.now();
    renderListeFinale(listeFinalePlayback);
  }
}

function cleanUpBehindScenes() {


  const bar = document.getElementById("playingTimerBarFill");


  const timerTxt = document.getElementById("playingTimer");


    if (bar) {


      bar.classList.add("no-transition");


      bar.style.width = "100%";


      bar.style.backgroundColor = "#ffcc00";


      void bar.offsetWidth;


      bar.classList.remove("no-transition");


    }


    if (timerTxt) timerTxt.textContent = "";


    const choices = document.getElementById("playingChoices");


    if (choices) {


      choices.innerHTML = "";


    }


  const questionTxt = document.getElementById("playingQuestion");


  if (questionTxt) {


    questionTxt.textContent = "";


  }


}


function cleanUpFauxVraiScenes() {


  const bar = document.getElementById("fauxVraiTimerFill");


  const timerTxt = document.getElementById("fauxVraiTimerNumber");


  if (bar) {


    bar.classList.add("no-transition");


    bar.style.width = "100%";


    bar.style.backgroundColor = "#ffcc00";


    void bar.offsetWidth;


    bar.classList.remove("no-transition");


  }


  if (timerTxt) timerTxt.textContent = "30";


  const feedback = document.getElementById("fauxVraiFeedback");


  if (feedback) feedback.textContent = "";


  const answersDiv = document.getElementById("fauxVraiAnswers");


  if (answersDiv) answersDiv.innerHTML = "";


}


function stopBlindTestAudio() {


  if (btMainAudio) {


    btMainAudio.pause();


    btMainAudio.currentTime = 0;


  }


  if (corrAudioPlayer) {


    corrAudioPlayer.pause();


    corrAudioPlayer.currentTime = 0;


  }


}


/**


 * Reset visuel immÃ©diat de la barre de temps (sans animation)


 */


function resetTimerBarVisuals() {


  const bar = document.getElementById("timer-bar");


  if (!bar) return;


  bar.classList.add("no-transition");


  bar.style.width = "100%";


  // Force layout recalculation pour garantir l'update


  void bar.offsetWidth;


  bar.classList.remove("no-transition");


}


// ----- Mini-jeu : Qui veut gagner des leugtas -----


function setupLeugtasQuestion(questionData) {


  if (!questionData) {


    showMainZone("playing");


    playingQuestion.textContent = "Aucune question reçue.";


    playingChoices.innerHTML = "";


    playingFeedback.textContent = "";


    return;


  }


  sfxLeugtasQuestion.play();


  if (playingTimer) {


    playingTimer.textContent = "30";


  }


  showMainZone("playing");


  playingQuestion.classList.remove("fade-in");


  playingChoices.classList.remove("fade-in");


  playingTitle.textContent = "Qui veut gagner des leugtas";


  playingQuestion.textContent = questionData.question;


  if (playingQuestion) {


    playingQuestion.removeAttribute("style");


  }


  if (playingChoices) {


    playingChoices.removeAttribute("style");


  }


  playingFeedback.textContent = "";


  playingFeedback.classList.remove("good", "bad");


  playingChoices.innerHTML = "";


  // sÃ©curitÃ© : enlever les classes d'animation rÃ©siduelles


  if (playingQuestion) {


    playingQuestion.classList.remove("fade-in");


  }


  // dÃ©clenche l'animation d'apparition


  playingQuestion.offsetHeight; // force un reflow


  playingQuestion.classList.add("fade-in");


  playingChoices.classList.add("fade-in");


  const createdButtons = [];


  const isSpec = amISpectator();


  questionData.answers.forEach((answer) => {


    const btn = document.createElement("button");


    btn.className = "playing-choice-btn choice-hidden";


    btn.textContent = answer.text;


    btn.dataset.answerId = answer.id;


    // Désactivé par défaut (attente du timer)


    if (!isSpec) {


      btn.disabled = true;


      btn.classList.add("btn-locked-intro");


    }


    if (isSpec) {


      btn.disabled = true;


      btn.style.cursor = "default";


      btn.style.opacity = "0.7";


    } else {


      btn.addEventListener("click", () => {


        // SÉCURITÉ ANTI-SPAM : Si le bouton a la classe de verrouillage, on stoppe tout.


        if (btn.disabled || btn.classList.contains("btn-locked-intro")) return;


        sfxLeugtasQuestion.stop();


        sfxLeugtasClick.play();


        if (leugtasHasAnswered) return;


        leugtasHasAnswered = true;


        btn.classList.add("btn-waiting-selected");


        const allBtns = playingChoices.querySelectorAll("button");


        allBtns.forEach((b) => {


          b.disabled = true;


          if (b !== btn) {


            b.classList.add("btn-waiting-other");


          }


        });


        playingFeedback.textContent =


          "Réponse envoyée... En attente des autres joueurs.";


        emitGameAction("leugtasAnswer", {


          roomCode: currentRoom.roomCode,


          playerId: playerId,


          answerId: answer.id


        });


      });


    }


    playingChoices.appendChild(btn);


    createdButtons.push(btn);


  });


  // on pourrait plus tard ajouter un fade-in sur la question ici


  // ex: playingQuestion.classList.add("fade-in");


  // TODO: animation sÃ©quentielle des rÃ©ponses


}


function animateChoicesSequentially(buttons) {


  if (!buttons || !buttons.length) return;


  buttons.forEach((btn, index) => {


    const delay = index * 1200;


    setTimeout(() => {


      btn.classList.remove("choice-hidden");


      btn.classList.add("choice-visible");


    }, delay);


  });


}


// ----- Mise Ã  jour UI globale -----


let penaveSnapshot = null;
let penaveClock = null;
let penaveClockInterval = null;
let penaveLastPassageKey = null;
let penaveTurnSoundKey = null;
let penaveThemeSoundKey = null;
let penaveSuspenseKey = null;
let penaveGradeSoundKey = null;
let penaveOutSoundKey = null;
let penaveEndSoundKey = null;
let penaveBoardLastKey = null;
let penaveBoardLastTurnKey = null;
let penaveFlightKey = null;
let penaveFlightAnimation = null;
let penaveFlightElement = null;
let penaveRankingKey = null;
let penaveEndKey = null;
let penaveInitialStateSeen = false;
let penaveCuePlayId = null;
const PENAVE_BOARD_FLIGHT_MS = 850;

function stopPenaveFlight() {
  penaveFlightAnimation?.cancel();
  penaveFlightAnimation = null;
  penaveFlightElement?.remove();
  penaveFlightElement = null;
  document.querySelector("#penaveBoard .penave-answer-arriving")?.classList.remove("penave-answer-arriving");
}

function syncPenaveOverlay(id, visible, text, animation, elapsedMs = 0) {
  const overlay = document.getElementById(id);
  const label = overlay?.firstElementChild;
  if (!overlay || !label) return;
  if (text != null) label.textContent = text;
  overlay.classList.toggle("hidden", !visible);
  if (visible) {
    label.style.animation = `${animation} ${animation === "palierStay" ? 0.6 : 1.5}s ease-out both`;
    label.style.animationDelay = `-${Math.max(0, elapsedMs)}ms`;
  }
}

function stopPenaveDisplay() {
  if (penaveSnapshot?.subPhase === "end_logo") sfxFinJeu.stop();
  if (penaveSnapshot?.subPhase === "theme") sfxTheme.stop();
  stopPenaveFlight();
  penaveSnapshot = null;
  penaveClock = null;
  penaveLastPassageKey = null;
  penaveTurnSoundKey = null;
  penaveThemeSoundKey = null;
  penaveSuspenseKey = null;
  penaveGradeSoundKey = null;
  penaveOutSoundKey = null;
  penaveEndSoundKey = null;
  penaveBoardLastKey = null;
  penaveBoardLastTurnKey = null;
  penaveFlightKey = null;
  penaveRankingKey = null;
  penaveEndKey = null;
  penaveInitialStateSeen = false;
  penaveCuePlayId = null;
  if (penaveClockInterval) clearInterval(penaveClockInterval);
  penaveClockInterval = null;
  sfxPenaveTurn.stop();
  sfxPenaveSuspense.stop();
  sfxPenaveBoard.stop();
  sfxPenaveCorrect.stop();
  sfxPenaveWrong.stop();
  sfxPenaveOut.stop();
  document.getElementById("penaveContainer")?.classList.add("hidden");
  document.getElementById("penaveThemeOverlay")?.classList.add("hidden");
  document.getElementById("penaveAnnouncementOverlay")?.classList.add("hidden");
  document.getElementById("leaderboard-overlay")?.classList.remove("active");
  document.getElementById("leaderboard-overlay")?.classList.remove("penave-ranking-active");
  document.getElementById("penaveEndOverlay")?.classList.add("hidden");
}

function penaveSend(event, payload) {
  const state = penaveSnapshot;
  if (!state || currentRoom?.gameMode !== "liste") return;
  emitGameAction(event, {
    ...payload, instanceId: state.instanceId,
    turnNumber: state.turnNumber, passageId: state.passageId
  });
}

function renderPenaveClock() {
  const timer = document.getElementById("penaveTimer");
  const fill = document.getElementById("penaveTimerFill");
  if (!timer || !fill) return;
  const remaining = penaveClock && penaveSnapshot?.subPhase === "answer"
    ? Math.max(0, penaveClock.remainingMs - (Date.now() - penaveClock.receivedAt)) : 0;
  timer.textContent = penaveSnapshot?.subPhase === "cue" ? "20" :
    penaveSnapshot?.subPhase === "answer" ? String(Math.ceil(remaining / 1000)) : "";
  fill.style.width = `${penaveSnapshot?.subPhase === "cue" ? 100 :
    Math.max(0, Math.min(100, remaining / 200))}%`;
  if (penaveSnapshot?.subPhase === "answer" && remaining <= 0) {
    sfxPenaveSuspense.stop();
    for (const id of ["penaveInput", "penaveValidate", "penavePass"])
      document.getElementById(id).disabled = true;
  }
}

function renderPenave(state) {
  const container = document.getElementById("penaveContainer");
  if (!container || !state) return;
  const previous = penaveSnapshot;
  if (previous && previous.instanceId !== state.instanceId) stopPenaveDisplay();
  penaveSnapshot = state;
  const firstSnapshot = !penaveInitialStateSeen;
  penaveInitialStateSeen = true;
  const themeOnly = state.subPhase === "theme";
  const endLogo = state.subPhase === "end_logo";
  const ranking = state.subPhase === "final_ranking";
  const announcing = ["round_summary", "victory"].includes(state.subPhase);
  const showBoard = !themeOnly && !endLogo && !ranking && !announcing;
  container.classList.toggle("hidden", !showBoard);
  const affirmation = document.getElementById("penaveAffirmation");
  affirmation.textContent = state.affirmation;
  const turn = document.getElementById("penaveTurn");
  turn.textContent = `Tour ${state.turnNumber}`;
  const player = currentRoom?.players?.find((item) => item.playerId === state.activePlayerId);
  const active = state.subPhase === "answer" && state.activePlayerId === playerId &&
    !isListePlayerInactive(currentRoom?.players?.find((item) => item.playerId === playerId));
  const isActor = state.activePlayerId === playerId &&
    !isListePlayerInactive(currentRoom?.players?.find((item) => item.playerId === playerId));
  const actor = document.getElementById("penaveActor");
  actor.textContent = state.subPhase === "correction" ? "Correction par l’hôte" : isActor ? "C’est à vous de jouer" : state.activePlayerId
    ? `C’est au tour de ${player?.pseudo || "ce joueur"}`
    : "";
  const order = document.getElementById("penaveOrder");
  order.replaceChildren();
  for (const id of state.order.filter((id) => state.survivorIds.includes(id))) {
    const chip = document.createElement("span");
    chip.className = `penave-order-player${id === state.activePlayerId ? " active" : ""}`;
    chip.textContent = currentRoom?.players?.find((item) => item.playerId === id)?.pseudo || "Joueur";
    order.appendChild(chip);
  }
  const passageKey = `${state.instanceId}:${state.passageId}`;
  const input = document.getElementById("penaveInput");
  if (penaveLastPassageKey !== passageKey) {
    input.value = "";
    penaveLastPassageKey = passageKey;
  }
  input.disabled = !active;
  document.getElementById("penaveValidate").disabled = !active;
  document.getElementById("penavePass").disabled = !active;
  document.getElementById("penaveForm").classList.toggle("hidden", !["cue", "answer"].includes(state.subPhase) || !isActor);
  if (state.subPhase === "cue" && isActor && penaveTurnSoundKey !== passageKey &&
      Date.now() - state.cueStartedAt < 1050) {
    penaveTurnSoundKey = passageKey;
    penaveCuePlayId = sfxPenaveTurn.play();
    sfxPenaveTurn.once("end", () => {
      if (penaveSnapshot?.subPhase === "cue" &&
          `${penaveSnapshot.instanceId}:${penaveSnapshot.passageId}` === passageKey)
        penaveSend("penaveCueFinished", {});
    }, penaveCuePlayId);
  }
  if (state.subPhase !== "cue" && penaveCuePlayId !== null) {
    sfxPenaveTurn.stop(penaveCuePlayId);
    penaveCuePlayId = null;
  }
  if (state.subPhase === "answer" && penaveSuspenseKey !== passageKey && state.remainingMs > 0) {
    penaveSuspenseKey = passageKey;
    const id = sfxPenaveSuspense.play();
    if (state.remainingMs < state.durationMs) sfxPenaveSuspense.seek((state.durationMs - state.remainingMs) / 1000, id);
  } else if (state.subPhase !== "answer") sfxPenaveSuspense.stop();
  penaveClock = { remainingMs: state.remainingMs, receivedAt: Date.now() };
  renderPenaveClock();
  if (!penaveClockInterval) penaveClockInterval = setInterval(renderPenaveClock, 100);
  document.getElementById("penaveTimer").classList.toggle("hidden", !["cue", "answer"].includes(state.subPhase));
  document.getElementById("penaveTimerFill").parentElement.classList.toggle("hidden", !["cue", "answer"].includes(state.subPhase));
  syncPenaveOverlay("penaveThemeOverlay", themeOnly, state.theme, "palierZoomFade",
    Math.max(0, 1500 - (state.phaseEndsAt - Date.now())));
  if (themeOnly && penaveThemeSoundKey !== state.instanceId && state.phaseEndsAt - Date.now() > 900) {
    penaveThemeSoundKey = state.instanceId;
    sfxTheme.play();
  }
  syncPenaveOverlay("penaveAnnouncementOverlay", announcing && !!state.announcement,
    state.announcement, "palierStay", announcing ? Math.max(0,
      (state.subPhase === "victory" ? 2800 : 3200) - (state.phaseEndsAt - Date.now())) : 0);
  if (state.subPhase === "round_summary" && state.roundEliminatedIds.length &&
      penaveOutSoundKey !== `${state.instanceId}:${state.turnNumber}` &&
      state.phaseEndsAt - Date.now() > 2200) {
    penaveOutSoundKey = `${state.instanceId}:${state.turnNumber}`;
    sfxPenaveOut.play();
  } else if (state.subPhase !== "round_summary") sfxPenaveOut.stop();
  const board = document.getElementById("penaveBoard");
  const boardPreviousScroll = board.scrollTop;
  board.replaceChildren();
  const labels = { pending: "En attente", accepted: "Acceptée", refused: "Refusée", passed: "Passée", withdrawn: "Abandon" };
  const entriesByTurn = new Map();
  for (const entry of state.entries) {
    if (!entriesByTurn.has(entry.turnNumber)) entriesByTurn.set(entry.turnNumber, []);
    entriesByTurn.get(entry.turnNumber).push(entry);
  }
  const visibleTurns = [...new Set([state.turnNumber, ...entriesByTurn.keys()])].sort((a, b) => b - a);
  let arrivingRow = null;
  let latestRow = null;
  const latestEntry = state.entries.at(-1);
  const flightKey = latestEntry?.status === "pending" && state.subPhase === "correction"
    ? `${state.instanceId}:${latestEntry.passageId}` : null;
  const flightElapsed = state.correctionStartedAt ? Date.now() - state.correctionStartedAt : Infinity;
  if (penaveFlightKey && (penaveFlightKey !== flightKey || flightElapsed >= PENAVE_BOARD_FLIGHT_MS)) stopPenaveFlight();
  for (const turnNumber of visibleTurns) {
    const heading = document.createElement("h3");
    heading.textContent = `Tour ${turnNumber}`;
    board.appendChild(heading);
    for (const entry of entriesByTurn.get(turnNumber) || []) {
      const row = document.createElement("div");
      row.className = "penave-row";
      if (flightKey && entry === latestEntry && flightElapsed < PENAVE_BOARD_FLIGHT_MS) {
        row.classList.add("penave-answer-arriving");
        arrivingRow = row;
      }
      for (const [value, css] of [[entry.pseudo, "penave-name"], [entry.answer, "penave-answer"],
        [labels[entry.status] || "", "penave-status"]]) {
        const span = document.createElement("span");
        span.className = css;
        span.textContent = value;
        row.appendChild(span);
      }
      if (entry.status === "pending" && state.subPhase === "correction" &&
          flightElapsed >= PENAVE_BOARD_FLIGHT_MS &&
          entry.passageId === state.passageId && currentRoom?.hostId === playerId) {
        for (const [accepted, label, color] of [[true, "✓", "#2ecc71"], [false, "✗", "#e74c3c"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "penave-grade";
          button.textContent = label;
          button.style.background = color;
          button.setAttribute("aria-label", accepted ? "Accepter la réponse" : "Refuser la réponse");
          button.onclick = () => {
            row.querySelectorAll(".penave-grade").forEach((control) => { control.disabled = true; });
            penaveSend("penaveGrade", { accepted });
          };
          row.appendChild(button);
        }
      }
      board.appendChild(row);
      if (entry === latestEntry) latestRow = row;
    }
  }
  const boardTurnKey = `${state.instanceId}:${state.turnNumber}`;
  const boardKey = latestEntry
    ? `${state.instanceId}:${latestEntry.passageId}:${state.subPhase === "correction" &&
      flightElapsed >= PENAVE_BOARD_FLIGHT_MS ? "grade-ready" : ""}`
    : boardTurnKey;
  if (penaveBoardLastTurnKey !== boardTurnKey) {
    board.scrollTop = 0;
  } else {
    board.scrollTop = boardPreviousScroll;
    if (penaveBoardLastKey !== boardKey && latestRow) {
      const boardBounds = board.getBoundingClientRect();
      const rowBounds = latestRow.getBoundingClientRect();
      if (rowBounds.top < boardBounds.top) board.scrollTop += rowBounds.top - boardBounds.top - 4;
      else if (rowBounds.bottom > boardBounds.bottom) board.scrollTop += rowBounds.bottom - boardBounds.bottom + 4;
    }
  }
  penaveBoardLastTurnKey = boardTurnKey;
  penaveBoardLastKey = boardKey;
  if (flightKey && flightElapsed < PENAVE_BOARD_FLIGHT_MS && penaveFlightKey !== flightKey && arrivingRow) {
    penaveFlightKey = flightKey;
    if (!firstSnapshot || flightElapsed < 250) sfxPenaveBoard.play();
    const target = arrivingRow.querySelector(".penave-answer").getBoundingClientRect();
    const flight = document.createElement("div");
    flight.className = "penave-answer-flight";
    flight.textContent = latestEntry.answer;
    document.body.appendChild(flight);
    penaveFlightElement = flight;
    const originX = (innerWidth - flight.offsetWidth) / 2;
    const originY = Math.max(48, innerHeight * .35);
    const scale = Math.max(.3, Math.min(1, target.width / flight.offsetWidth));
    flight.style.left = `${originX}px`;
    flight.style.top = `${originY}px`;
    penaveFlightAnimation = flight.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${target.left - originX}px, ${target.top - originY}px) scale(${scale})`, opacity: 1 }
    ], { duration: PENAVE_BOARD_FLIGHT_MS, delay: -Math.max(0, flightElapsed), easing: "ease-in", fill: "forwards" });
    penaveFlightAnimation.onfinish = () => {
      if (penaveFlightKey === flightKey) stopPenaveFlight();
    };
  }
  const grade = [...state.entries].reverse().find((entry) => entry.gradedAt &&
    ["accepted", "refused"].includes(entry.status));
  const gradeKey = grade && `${state.instanceId}:${grade.passageId}:${grade.status}`;
  if (gradeKey && penaveGradeSoundKey !== gradeKey && !firstSnapshot &&
      Date.now() - grade.gradedAt < 1300) {
    penaveGradeSoundKey = gradeKey;
    (grade.status === "accepted" ? sfxPenaveCorrect : sfxPenaveWrong).play();
  }
  if (ranking && state.ranking) {
    document.getElementById("leaderboard-overlay")?.classList.add("penave-ranking-active");
    const mapped = state.ranking.map((entry) => ({ ...entry, nickname: entry.pseudo, score: entry.points }));
    handleInterimLeaderboard(mapped, null, Math.max(0, state.phaseEndsAt - Date.now()),
      "Classement Pénave ou Nachave", penaveRankingKey === state.instanceId);
    penaveRankingKey = state.instanceId;
  } else if (penaveRankingKey) {
    invalidateMiniGameLeaderboard();
    document.getElementById("leaderboard-overlay")?.classList.remove("penave-ranking-active");
    penaveRankingKey = null;
  }
  const endOverlay = document.getElementById("penaveEndOverlay");
  endOverlay.classList.toggle("hidden", !endLogo);
  if (endLogo && penaveEndKey !== state.instanceId) {
    penaveEndKey = state.instanceId;
    const logo = endOverlay.querySelector(".leugtas-end-logo");
    logo.style.animation = "none";
    void logo.offsetWidth;
    logo.style.animation = "spinAndShoot 3.5s ease-out forwards";
    logo.style.animationDelay = `-${Math.max(0, 3500 - (state.phaseEndsAt - Date.now()))}ms`;
  }
  if (endLogo && penaveEndSoundKey !== state.instanceId && state.phaseEndsAt - Date.now() > 3200) {
    penaveEndSoundKey = state.instanceId;
    sfxFinJeu.play();
  }
}

document.getElementById("penaveForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("penaveInput");
  const answer = input.value.trim();
  if (!answer || input.disabled) return;
  sfxPenaveSuspense.stop();
  penaveSend("penaveAnswer", { answer, pass: false });
  input.disabled = true;
  document.getElementById("penaveValidate").disabled = true;
  document.getElementById("penavePass").disabled = true;
});
document.getElementById("penavePass")?.addEventListener("click", () => {
  if (document.getElementById("penavePass").disabled) return;
  sfxPenaveSuspense.stop();
  penaveSend("penaveAnswer", { answer: "", pass: true });
  document.getElementById("penaveInput").disabled = true;
  document.getElementById("penaveValidate").disabled = true;
  document.getElementById("penavePass").disabled = true;
});

function updateGameStateUI(gs) {
  if (gs && (!["playing", "listeRoundEnd"].includes(gs.phase) ||
      gs.roundNumber !== currentGameState.roundNumber || gs.currentMiniGame !== currentGameState.currentMiniGame ||
      (gs.gameMode && gs.gameMode !== currentRoom?.gameMode))) invalidateMiniGameLeaderboard();


  const previousPhase = lastPhase;


  currentGameState = gs || currentGameState;
  if (!(currentGameState.gameMode === "liste" &&
      currentGameState.currentMiniGame === "penave_ou_nachave" &&
      ["playing", "listeRoundEnd"].includes(currentGameState.phase))) stopPenaveDisplay();
  if (currentRoom && gs?.gameMode) currentRoom.gameMode = gs.gameMode;
  syncBonOrdrePhase(currentGameState);
  updateGameModeUI();
  if (currentGameState.phase === "listeIntro" && currentGameState.gameMode === "liste") {
    syncListeIntro(currentGameState);
  } else {
    stopListeIntro();
  }


  // Nettoyage de l'intro si la phase n'est plus "intro"


  if (currentGameState.phase !== "intro") {


      clearIntroLayer();


  }


  lastPhase = currentGameState.phase;


  iAmReady = currentGameState.readyPlayerIds.includes(playerId);


  // Mode plateau actif pour toutes les phases sauf "idle"


  if (currentGameState.phase !== "idle") {


    body.classList.add("playing-mode");


  } else {


    body.classList.remove("playing-mode");


  }


  // Affiche ou masque le haut de la salle (code, joueurs, bac Ã  sable)


  if (roomUpper) {


    if (currentGameState.phase === "idle") {


      roomUpper.style.display = "";


    } else {


      roomUpper.style.display = "none";


    }


  }


  if (!gamePhaseText || !currentMiniGameText) return;


  const phaseText = phaseToText(currentGameState.phase);


  const miniGameLabel = miniGameCodeToLabel(currentGameState.currentMiniGame);


  gamePhaseText.textContent = phaseText;
  if (gs.gameMode === "liste" && gs.phase === "listeIntro") {
    stopDrawAnimation();
    hideAllMiniGames();
    showMainZone("default");
    gamePhaseText.textContent = "Introduction du tournoi Liste";
    currentMiniGameText.textContent = "Le premier mini-jeu sera tiré après l'introduction.";
    return;
  }
  if (gs.gameMode === "liste" && gs.phase === "listeFinished") {
    stopDrawAnimation();
    stopRuleSounds();
    hideAllMiniGames();
    showMainZone("default");
    hideListeLeaderboard();
    syncListeFinale(gs);
    gamePhaseText.textContent = "Tournoi terminé";
    currentMiniGameText.textContent = "Vous pouvez quitter la salle.";
    return;
  }
  stopListeFinale();
  if (gs.gameMode === "liste" && gs.phase === "listeLeaderboard") {
    stopDrawAnimation();
    stopRuleSounds();
    hideAllMiniGames();
    showMainZone("default");
    renderListeLeaderboard(gs.listeLeaderboard);
    syncListeLeaderboardSound(gs.listeLeaderboard?.sound);
    gamePhaseText.textContent = "Classement général en cours";
    currentMiniGameText.textContent = "Le prochain mini-jeu sera tiré après le classement.";
    return;
  }
  hideListeLeaderboard();

  if (gs.gameMode === "liste" && gs.currentMiniGame === "penave_ou_nachave" &&
      ["playing", "listeRoundEnd"].includes(gs.phase) && gs.penaveState) {
    stopDrawAnimation();
    stopRuleSounds();
    if (mainDefault) mainDefault.classList.add("hidden");
    if (mainDrawing) mainDrawing.classList.add("hidden");
    if (mainRules) mainRules.classList.add("hidden");
    if (mainPlaying) mainPlaying.classList.add("hidden");
    renderPenave(gs.penaveState);
    return;
  }
  stopPenaveDisplay();

  if (gs.gameMode === "liste" && ["listeRoundEnd", "listeTransition", "listeFinished"].includes(gs.phase)) {
    stopDrawAnimation();
    stopRuleSounds();
    hideAllMiniGames();
    showMainZone("default");
    gamePhaseText.textContent = gs.phase === "listeFinished" ? "Tournoi terminé" : "Manche terminée";
    currentMiniGameText.textContent = gs.phase === "listeFinished"
      ? "Les résultats du tournoi sont enregistrés. Vous pouvez quitter la salle."
      : "Préparation du mini-jeu suivant…";
    return;
  }


  if (!currentGameState.currentMiniGame) {


    currentMiniGameText.textContent = "Aucun mini-jeu en cours.";


  } else {


    currentMiniGameText.textContent =


      "Mini-jeu (round " +


      currentGameState.roundNumber +


      ") : " +


      miniGameLabel;


  }


  const isHost =


    currentRoom && currentRoom.hostId && currentRoom.hostId === playerId;


  // Gestion selon la phase


  if (currentGameState.phase === "drawingGame") {


    showMainZone("drawing");


    if (previousPhase !== "drawingGame" || !drawAnimationInterval) {


      startDrawAnimation(currentGameState.currentMiniGame, isHost);


    }


  } else if (currentGameState.phase === "rules") {


    // AJOUT : Lecture du son des règles (uniquement à l'entrée de la phase)


    if (previousPhase !== "rules") {


        const code = currentGameState.currentMiniGame;


        // Sécurité : on coupe les sons précédents


        if (typeof sfxTirage !== 'undefined') sfxTirage.stop();


        if (typeof sfxTheme !== 'undefined') sfxTheme.stop();


        stopRuleSounds(); // Sécurité supplémentaire


        switch(code) {


            case "qui_suis_je": sfxRuleQuiSuisJe.play(); break;


            case "qui_veut_gagner_des_leugtas": sfxRuleLeugtas.play(); break;


            case "le_tour_du_monde": sfxRuleTourDuMonde.play(); break;


            case "petit_bac": 


            case "le_petit_bac": sfxRulePetitBac.play(); break;
            case "matrice_football": sfxRuleMatriceFootball.play(); break;


            case "le_bon_ordre": sfxRuleBonOrdre.play(); break;


            case "blind_test": sfxRuleBlindTest.play(); break;


            case "les_encheres": sfxRuleEncheres.play(); break;
            case "penave_ou_nachave": sfxRulePenave.play(); break;


            case "le_faux_du_vrai": sfxRuleFauxVrai.play(); break;


        }


    }


    stopDrawAnimation();


    showMainZone("rules");


    const code = currentGameState.currentMiniGame;


    const label = miniGameLabel;


    const logoPath = miniGameCodeToLogoPath(code);


    const rulesText = rulesTextForMiniGame(code);


    if (rulesGameLogo) {


      rulesGameLogo.src = logoPath;


    }


    if (rulesGameTitle) {


      rulesGameTitle.textContent = label;


    }


    if (rulesRoundInfo) {


      rulesRoundInfo.textContent = "Round " + currentGameState.roundNumber;


    }


    if (rulesGameText) {


      rulesGameText.textContent = rulesText;


    }


      if (readyBtn) {


        const me = currentRoom ? currentRoom.players.find(p => p.playerId === playerId) : null;


        const isSpectator = isListePlayerInactive(me) || (me && (me.eliminated || me.isSpectator));


        if (isSpectator) {


          readyBtn.disabled = true;


          readyBtn.textContent = isListePlayerInactive(me)
            ? (me.withdrawn ? "Retiré du tournoi" : "Hors tournoi") : "Mode Spectateur";


          readyBtn.classList.remove("btn-outline");


          readyBtn.style.opacity = "0.5";


          readyBtn.style.cursor = "default";


          if (iAmReady) {


            emitGameAction("playerSetReady", { isReady: false });


            iAmReady = false;


          }


        } else {


          readyBtn.disabled = false;


          readyBtn.classList.add("btn-outline");


          readyBtn.style.opacity = "1";


          readyBtn.style.cursor = "pointer";


          readyBtn.textContent = iAmReady ? "Je ne suis plus prêt" : "Je suis prêt";


        }


      }


    updateReadyPlayersListUI();


  } else {


    if (gs.phase === "playing") {


      stopDrawAnimation();
      stopRuleSounds(); // <--- AJOUT SÉCURITÉ AUDIO : Coupe les règles pour tout le monde (joueurs et spectateurs)


      if (palierOverlay && !palierOverlay.classList.contains("hidden")) {


        return;


      }


      // --- Leugtas ---


      if (gs.currentMiniGame === "qui_veut_gagner_des_leugtas") {


        showMainZone("playing");


        return;


      }


      // --- Le Faux du Vrai ---


      if (gs.currentMiniGame === "le_faux_du_vrai") {


        showMainZone("playing"); // Hack pour cacher les autres


        if (mainRules) mainRules.classList.add("hidden");


        hideAllMiniGames();


        if (fauxVraiContainer) fauxVraiContainer.classList.remove("hidden");


        return;


      }


      // --- Le Tour du Monde ---


      if (gs.currentMiniGame === "le_tour_du_monde") {


        if (mainDefault) mainDefault.classList.add("hidden");


        if (mainDrawing) mainDrawing.classList.add("hidden");


        if (mainRules) mainRules.classList.add("hidden");


        if (mainPlaying) mainPlaying.classList.add("hidden");


        if (tourMondeContainer) tourMondeContainer.classList.remove("hidden");


        return;


      }


      // --- Qui suis-je ---


      if (gs.currentMiniGame === "qui_suis_je") {


        if (mainDefault) mainDefault.classList.add("hidden");


        if (mainDrawing) mainDrawing.classList.add("hidden");


        if (mainRules) mainRules.classList.add("hidden");


        if (mainPlaying) mainPlaying.classList.add("hidden");


        if (quiSuisJeContainer) quiSuisJeContainer.classList.remove("hidden");


        return;


      }


      // --- AJOUT : Le Bon Ordre ---


      if (gs.currentMiniGame === "le_bon_ordre") {


        if (mainDefault) mainDefault.classList.add("hidden");


        if (mainDrawing) mainDrawing.classList.add("hidden");


        if (mainRules) mainRules.classList.add("hidden");


        if (mainPlaying) mainPlaying.classList.add("hidden");


        if (["theme", "answering"].includes(gs.leBonOrdrePhase)) {
          if (leBonOrdreContainer && bonOrdreState) leBonOrdreContainer.classList.remove("hidden");
        } else {
          leBonOrdreContainer?.classList.add("hidden");
        }


        return;


      }


      // --- AJOUT : Les EnchÃ¨res ---


      if (gs.currentMiniGame === "les_encheres") {


        if (mainDefault) mainDefault.classList.add("hidden");


        if (mainDrawing) mainDrawing.classList.add("hidden");


        if (mainRules) mainRules.classList.add("hidden");


        if (mainPlaying) mainPlaying.classList.add("hidden");


        const setup = document.getElementById("encheresSetupContainer");


        const game = document.getElementById("encheresGameContainer");


        const corr = document.getElementById("encheresCorrectionContainer");


        if (


          setup &&


          game &&


          corr &&


          setup.classList.contains("hidden") &&


          game.classList.contains("hidden") &&


          corr.classList.contains("hidden")


        ) {


          game.classList.remove("hidden");


        }


        return;


      }


      // La Matrice est construite par matriceFootballStart. Une mise à jour
      // générale ne doit ni recréer ses champs ni masquer sa correction.
      if (gs.currentMiniGame === "matrice_football") {
        if (mainDefault) mainDefault.classList.add("hidden");
        if (mainDrawing) mainDrawing.classList.add("hidden");
        if (mainRules) mainRules.classList.add("hidden");
        if (mainPlaying) mainPlaying.classList.add("hidden");

        const correction = document.getElementById("matriceFootballCorrectionContainer");
        const sameInstance = gs.matriceFootballInstanceId &&
          matriceFootballInstanceId === gs.matriceFootballInstanceId &&
          matriceFootballRoomCode === currentRoom?.roomCode;
        const sameCorrection = gs.matriceFootballInstanceId &&
          currentMatriceFootballCorrection?.instanceId === gs.matriceFootballInstanceId &&
          currentMatriceFootballCorrection?.roomCode === currentRoom?.roomCode;
        if (sameCorrection && correction && !correction.classList.contains("hidden")) {
          matriceFootballContainer?.classList.add("hidden");
        } else if (sameInstance && currentMatriceFootball && matriceFootballRoundNumber === gs.roundNumber) {
          correction?.classList.add("hidden");
          matriceFootballContainer?.classList.remove("hidden");
        } else {
          correction?.classList.add("hidden");
          matriceFootballContainer?.classList.add("hidden");
        }
        return;
      }


      // --- Autres mini-jeux ---


      showMainZone("default");


      return;


    }


    stopDrawAnimation();


    showMainZone("default");


  }


}


function updateReadyPlayersListUI() {


  if (!readyPlayersList || !currentRoom) return;


  const readyIds = new Set(currentGameState.readyPlayerIds || []);


  readyPlayersList.innerHTML = "";


  currentRoom.players.forEach((p) => {


    if (p.eliminated || p.isSpectator) return;
    if (isListePlayerInactive(p)) return;


    const line = document.createElement("div");


    const nameSpan = document.createElement("span");


    nameSpan.textContent = p.pseudo || "???";


    if (p.playerId === currentRoom.hostId) {


      nameSpan.textContent += " (hôte)";


    }


    if (p.playerId === playerId) {


      nameSpan.textContent += " (toi)";


    }


    const pill = document.createElement("span");


    pill.classList.add("ready-pill");


    if (readyIds.has(p.playerId)) {


      pill.classList.add("ok");


      pill.textContent = "prêt";


    } else {


      pill.classList.add("wait");


      pill.textContent = "en attente";


    }


    line.appendChild(nameSpan);


    line.appendChild(pill);


    readyPlayersList.appendChild(line);


  });


}


function readListeConfigForm() {
  return {
    gameCount: listeGameCount.value === "" ? null : Number(listeGameCount.value),
    selectionMethod: listeSelectionMethod.value || null,
    selectedMiniGames: listeSelectionMethod.value === "manual"
      ? Array.from(listeGameChoices.querySelectorAll("input:checked"), (input) => input.value)
      : []
  };
}

function canEditListeConfig() {
  return socket.connected && currentRoom?.gameMode === "liste" &&
    currentRoom.hostId === playerId && currentGameState.phase === "idle" && !currentRoom.listeTournament?.started;
}

function updateListeConfigControls() {
  const draft = readListeConfigForm();
  const options = currentRoom?.listeOptions;
  const canEdit = canEditListeConfig();
  const manual = draft.selectionMethod === "manual";
  const validCount = Number.isInteger(draft.gameCount) && options &&
    draft.gameCount >= options.minGames && draft.gameCount <= options.maxGames;
  const complete = validCount && (draft.selectionMethod === "random" ||
    (manual && draft.selectedMiniGames.length === draft.gameCount));

  listeGameCount.disabled = !canEdit;
  listeSelectionMethod.disabled = !canEdit;
  listeManualOptions.classList.toggle("hidden", !manual);
  listeGameChoices.querySelectorAll("input").forEach((input) => {
    input.disabled = !canEdit || !validCount ||
      (!input.checked && draft.selectedMiniGames.length >= draft.gameCount);
  });
  const selectedCount = draft.selectedMiniGames.length;
  listeSelectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? "jeu sélectionné" : "jeux sélectionnés"} sur ${draft.gameCount ?? "—"}`;
  listeConfigSubmit.hidden = currentRoom?.hostId !== playerId;
  listeConfigSubmit.disabled = !canEdit || !complete;
}

function updateListeConfigUI() {
  const visible = currentRoom?.gameMode === "liste";
  listeConfigForm.classList.toggle("hidden", !visible);
  if (!visible) {
    listeConfigKey = null;
    return;
  }
  const { listeOptions: options, listeConfig: config } = currentRoom;
  if (!options || !config) return;
  // Une arrivée/déconnexion d'invité ne doit pas effacer les choix en cours de l'hôte.
  const key = JSON.stringify([currentRoom.roomCode, currentRoom.hostId, options, config]);
  if (key !== listeConfigKey) {
    listeConfigKey = key;
    listeConfigDirty = false;
    listeGameCount.replaceChildren(new Option("Choisir le nombre de mini-jeux", ""));
    for (let count = options.minGames; count <= options.maxGames; count++) {
      listeGameCount.add(new Option(String(count), String(count)));
    }
    listeGameCount.value = config.gameCount === null ? "" : String(config.gameCount);
    listeSelectionMethod.value = config.selectionMethod || "";
    listeGameChoices.replaceChildren();
    options.miniGames.forEach((game) => {
      const label = document.createElement("label");
      label.className = "liste-game-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = game.id;
      input.checked = config.selectedMiniGames.includes(game.id);
      const text = document.createElement("span");
      text.textContent = game.label;
      label.append(input, text);
      listeGameChoices.appendChild(label);
    });
    listeConfigStatus.textContent = config.isValid
      ? "Configuration validée par l'hôte."
      : "Aucune configuration validée. L'hôte doit choisir un nombre et une méthode.";
  }
  updateListeConfigControls();
}

function updateGameModeUI() {
  const isListe = currentRoom?.gameMode === "liste";
  if (isListe && typeof Howl === "function") preloadListeLeaderboardSounds();
  if (isListe) preloadListeIntro();
  if (isListe) preloadListeFinale();
  if (!isListe || !currentRoom?.listeTournament?.started) hideListeLeaderboard();
  if (!isListe || !currentRoom?.listeTournament?.started) stopListeFinale();
  const isHost = currentRoom?.hostId === playerId;
  const canChangeMode = isHost && currentGameState.phase === "idle" && !currentRoom?.listeTournament?.started;
  body.classList.toggle("mode-liste", isListe);

  gameModeButtons.forEach((button) => {
    const selected = button.dataset.gameMode === currentRoom?.gameMode;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("btn-primary", selected);
    button.classList.toggle("btn-secondary", !selected);
    button.disabled = !canChangeMode;
  });
  if (gameModeHint) {
    gameModeHint.textContent = isListe
      ? "Validez la configuration pour lancer le tournoi Liste."
      : "";
  }
  if (sandboxControls) {
    sandboxControls.style.display = isHost && !isListe ? "block" : "none";
  }
  updateListeConfigUI();
}

function updateRoomUI(room) {
  if (room?.roomCode !== currentRoom?.roomCode || room?.gameMode !== currentRoom?.gameMode ||
      room?.listeTournament?.tournamentId !== currentRoom?.listeTournament?.tournamentId) {
    invalidateMiniGameLeaderboard();
    stopListeLeaderboardSound();
    stopListeIntro();
    stopListeFinale();
  }


  currentRoom = room;


  if (!room) return;


  const myId = playerId;


  roomCodeDisplay.textContent = room.roomCode || "----";


  playersList.innerHTML = "";


  room.players.forEach((player) => {


    const li = document.createElement("li");


    const nameSpan = document.createElement("span");


    nameSpan.className = "player-name";


    nameSpan.textContent = player.pseudo || "???";


    if (room.hostId === player.playerId) {


      const hostTag = document.createElement("span");


      hostTag.className = "tag-host";


      hostTag.textContent = "Hôte";


      nameSpan.appendChild(hostTag);


    }


    const statusSpan = document.createElement("span");


    statusSpan.className = "player-status";


    if (isListePlayerInactive(player)) {
      statusSpan.textContent = player.withdrawn ? "retiré du tournoi" : "hors tournoi";
    } else if (!player.isConnected) {


      statusSpan.textContent = currentRoom.gameMode === "liste" ? "déconnecté temporairement" : "déconnecté";


    } else if (player.eliminated) {


      statusSpan.textContent = "éliminé";


    } else if (player.isSpectator) {


      statusSpan.textContent = "spectateur";


    } else {


      statusSpan.textContent = "en jeu";


    }


    if (player.playerId === myId) {


      nameSpan.textContent = nameSpan.textContent + " (toi)";


    }


    li.appendChild(nameSpan);


    li.appendChild(statusSpan);


    playersList.appendChild(li);


  });


  if (startGameBtn) {


    const isHost = room.hostId === myId;


    startGameBtn.style.display = isHost ? "block" : "none";


  }


  updateGameModeUI();


  const me = room.players.find((p) => p.playerId === playerId);
  setRoomError(isListePlayerInactive(me)
    ? (me.withdrawn ? "Vous vous êtes retiré du tournoi Liste. Votre retrait est définitif."
      : "Vous ne faites pas partie des participants de ce tournoi Liste.")
    : "");


  updateReadyPlayersListUI();


}


// ===============================


//       ÃVÃNEMENTS BOUTONS


// ===============================


createRoomBtn.addEventListener("click", () => {


  const pseudo = (pseudoInput.value || "").trim();


  setLobbyError("");


  if (!pseudo) {


    setLobbyError("Merci de saisir un pseudo.");


    return;


  }


  localStorage.setItem("lqs_pseudo", pseudo);


  socket.emit("createRoom", { pseudo, playerId });


});


joinRoomBtn.addEventListener("click", () => {


  const pseudo = (pseudoInput.value || "").trim();


  const roomCode = (roomCodeInput.value || "").trim().toUpperCase();


  setLobbyError("");


  if (!pseudo) {


    setLobbyError("Merci de saisir un pseudo.");


    return;


  }


  if (!roomCode) {


    setLobbyError("Merci de saisir un code de salle.");


    return;


  }


  localStorage.setItem("lqs_pseudo", pseudo);


  localStorage.setItem("lqs_room_code", roomCode);


  socket.emit("joinRoom", { pseudo, roomCode, playerId, reconnectSecret: getReconnectSecret(roomCode) });


});


// --- GESTION SÉCURISÉE DU BOUTON QUITTER ---


const quitConfirmOverlay = document.getElementById("quitConfirmOverlay");


const confirmQuitBtn = document.getElementById("confirmQuitBtn");


const cancelQuitBtn = document.getElementById("cancelQuitBtn");


// 1. Clic sur le bouton "Quitter" en haut à droite -> Ouvre l'overlay


if (leaveRoomBtn) {


  leaveRoomBtn.addEventListener("click", () => {


    if (quitConfirmOverlay) {


      quitConfirmOverlay.classList.remove("hidden");


      quitConfirmOverlay.style.animation = "fadeIn 0.3s ease-out";


    }


  });


}


// 2. Clic sur "NON" -> Ferme l'overlay


if (cancelQuitBtn) {


  cancelQuitBtn.addEventListener("click", () => {


    if (quitConfirmOverlay) {


      quitConfirmOverlay.classList.add("hidden");


    }


  });


}


// 3. Clic sur "OUI" -> Exécute la déconnexion PROPRE ET RADICALE


if (confirmQuitBtn) {


  confirmQuitBtn.addEventListener("click", () => {
    isQuitting = true; 
    stopListeIntro();
    invalidateMiniGameLeaderboard();
    hideListeLeaderboard();
    stopListeFinale();

    // 1. COUPURE TOTALE DU SON
    // On arrête tout ce qui joue via Howler (musiques, sfx, voix) d'un coup.
    if (typeof Howler !== 'undefined') {
        Howler.stop();
    }

    // 2. NETTOYAGE UI
    // Arrêt propre de l'animation de victoire si elle est en cours
    const animState = typeof runGlobalVictoryAnim !== 'undefined' ? runGlobalVictoryAnim._state : null;
    if (animState) {
        animState.stop = true;
        const overlay = document.querySelector('.victory-overlay');
        if (overlay) overlay.remove();
    }


    if (quitConfirmOverlay) quitConfirmOverlay.classList.add("hidden");


    // 3. DECONNEXION SOCKET (Le "Mur")
    // On prévient le serveur qu'on part
    socket.emit("leaveRoom");
    
    // IMMÉDIATEMENT APRÈS, on coupe le lien. 
    // Cela empêche tout événement "en transit" (reveal, score, timer) d'arriver au client.
    socket.disconnect();

    // Nettoyage des données locales
    localStorage.removeItem("lqs_room_code");
    localStorage.removeItem("lqs_pseudo");


    hideAllMiniGames();


    if (petitBacContainer) petitBacContainer.classList.add("hidden");


    if (pbLetterDisplay) pbLetterDisplay.textContent = "?";


    if (pbFormZone) pbFormZone.innerHTML = "";


    const enchHist = document.getElementById("encheresHistory");


    if (enchHist) enchHist.innerHTML = "";


    currentRoom = null;


    currentPlayersData = [];


    const lbOverlay = document.getElementById("leaderboard-overlay");


    if (lbOverlay) lbOverlay.classList.remove("active");


    currentGameState = {


      phase: "idle",


      roundNumber: 0,


      currentMiniGame: null,


      readyPlayerIds: []


    };


    iAmReady = false;


    lastPhase = "idle";


    stopDrawAnimation();


    updateGameStateUI(currentGameState);


    showScreen("lobby");


    // 4. RECONNEXION A NEUF
    // On attend un court instant et on reconnecte le socket.
    // Cela génère un nouveau Socket.ID, vierge de toute room précédente.
    setTimeout(() => { 
        socket.connect(); 
        isQuitting = false; 
    }, 500);
  });


}


// clic sur "Je suis prÃªtÂ�e"


if (readyBtn) {


  readyBtn.addEventListener("click", () => {
    if (isListePlayerInactive(currentRoom?.players.find((p) => p.playerId === playerId))) return;


    // AJOUT : On coupe immédiatement le son des règles quand le joueur clique


    stopRuleSounds();


    sfxReady.play();


    if (!currentRoom) return;


    const newReady = !iAmReady;


    emitGameAction("playerSetReady", { isReady: newReady });


  });


}


// L'hÃ´te lance la partie


listeConfigForm.addEventListener("change", (event) => {
  if (!canEditListeConfig()) return;
  sfxBubbleClick.play();
  // Si le nombre diminue, demander une nouvelle sélection, sans choisir à la place de l'hôte.
  if (event.target === listeGameCount &&
      listeGameChoices.querySelectorAll("input:checked").length > Number(listeGameCount.value)) {
    listeGameChoices.querySelectorAll("input").forEach((input) => { input.checked = false; });
  }
  if (event.target === listeSelectionMethod && listeSelectionMethod.value !== "manual") {
    listeGameChoices.querySelectorAll("input").forEach((input) => { input.checked = false; });
  }
  listeConfigDirty = true;
  listeConfigStatus.textContent = "Choix en cours, non validés. Complétez puis validez la configuration.";
  updateListeConfigControls();
});

listeConfigForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!canEditListeConfig() || listeConfigSubmit.disabled) return;
  sfxBubbleClick.play();
  socket.emit("hostValidateListeConfig", readListeConfigForm());
});

socket.on("listeConfigResult", (result) => {
  if (currentRoom?.gameMode !== "liste" || result.roomCode !== currentRoom.roomCode) return;
  if (result.ok) {
    listeConfigKey = null;
    updateListeConfigUI();
    sfxReady.play();
  }
  listeConfigStatus.textContent = result.message;
});

socket.on("disconnect", () => {
  updateListeConfigControls();
  if (listeConfigDirty && currentRoom?.gameMode === "liste") {
    listeConfigStatus.textContent = "Connexion interrompue. Les choix non validés ne sont pas sauvegardés.";
  }
});

gameModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (currentRoom?.hostId !== playerId || currentGameState.phase !== "idle") return;
    sfxBubbleClick.play();
    setRoomError("");
    socket.emit("hostSetGameMode", { gameMode: button.dataset.gameMode });
  });
});

if (startGameBtn) {


  startGameBtn.addEventListener("click", () => {


    setRoomError("");


    const payload = {};


    if (sandboxEnabled && sandboxMiniGame) {


      payload.forcedMiniGame = sandboxMiniGame;


    }


    socket.emit("hostStartGame", payload);


  });


}


if (sandboxToggle) {


  sandboxToggle.addEventListener("change", () => {


    sandboxEnabled = sandboxToggle.checked;


  });


}


if (sandboxMiniGameSelect) {


  sandboxMiniGameSelect.addEventListener("change", () => {


    sandboxMiniGame = sandboxMiniGameSelect.value || "";


  });


}


// ===============================


//      ÃVÃNEMENTS SOCKET.IO


// ===============================


socket.on("leugtasQuestion", (data) => {
  invalidateMiniGameLeaderboard();


  sfxLeugtasWin.stop();


  sfxLeugtasLose.stop();


  console.log("Question Leugtas reçue :", data);


  leugtasAnswersShown = false;


  leugtasHasAnswered = false;


  const lbOverlay = document.getElementById("leaderboard-overlay");


  if (lbOverlay) lbOverlay.classList.remove("active");


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  if (scoreboard) scoreboard.classList.add("hidden");


  if (playingQuestion) playingQuestion.textContent = "";


  if (playingChoices) playingChoices.innerHTML = "";


  if (playingTimer) {


    playingTimer.textContent = "30";


    playingTimer.style.color = "#ffffff";


  }


  if (playingTimerBarFill) {


    playingTimerBarFill.style.width = "100%";


    playingTimerBarFill.style.background = "#ffcc00";


    playingTimerBarFill.style.transition = "none";


  }


  if (playingFeedback) {


    playingFeedback.textContent = "";


    playingFeedback.classList.remove("good", "bad");


  }


  if (playingChoices) {


    const btns = playingChoices.querySelectorAll("button");


    btns.forEach((btn) => {


      btn.style.backgroundColor = "";


      btn.disabled = false;


      btn.style.opacity = "";


      btn.classList.remove("btn-waiting-selected", "btn-waiting-other");


    });


    playingChoices.innerHTML = "";


  }


  if (playingQuestionNumber) {


    if (data.index && data.total) {


      playingQuestionNumber.textContent =


        "Question " + data.index + " / " + data.total;


    } else {


      playingQuestionNumber.textContent = "";


    }


  }


  const revealQuestion = () => {


    setupLeugtasQuestion(data.question);


    if (scoreboard) scoreboard.classList.remove("hidden");


    if (playingTimerBarFill) {


      void playingTimerBarFill.offsetWidth;


      playingTimerBarFill.style.transition = "width 1s linear";


    }


  };


  if (palierOverlayText && palierOverlay && !data.isReload) {


    sfxTheme.play();


    palierOverlayText.textContent = "PALIER " + data.index;


    palierOverlay.classList.remove("hidden");


    setTimeout(() => {


      revealQuestion();


      setTimeout(() => {


        palierOverlay.classList.add("hidden");


      }, 100);


    }, 1500);


  } else {


    revealQuestion();


  }


});


socket.on("roomJoined", (roomData) => {
  stopListeIntro();
  invalidateMiniGameLeaderboard();
  hideListeLeaderboard(); // Le snapshot de partie suivant restaure le classement si nécessaire.
  stopListeFinale();
  listeConfigKey = null; // La reconnexion restaure toujours la configuration serveur.


  console.log("Rejoint la salle :", roomData.roomCode);


  if (roomData && roomData.roomCode) {


    localStorage.setItem("lqs_room_code", roomData.roomCode);


  }


  updateRoomUI(roomData);


  showScreen("room");


});


socket.on("roomUpdate", (room) => {


  if (!room) return;


  updateRoomUI(room);


});


socket.on("gameStateUpdate", (gs) => {
  listeActionContext = gs.listeContext || null;


  updateGameStateUI(gs);


});


socket.on("gameOver", (data) => {
  if (isQuitting) return; // <--- On ignore l'anim si on part

  console.log("Fin de partie. Vainqueur : " + data.winner);

  // 1. On cache d'abord l'interface des enchères si elle est encore là
  hideAllMiniGames();
  
  // 2. Si un overlay "Vainqueur du round" (celui des enchères) est affiché, 
  // on le cache pour laisser place au grand final.
  const encheresOverlay = document.getElementById("encheresResultOverlay");
  if (encheresOverlay) {
    encheresOverlay.classList.add("hidden");
    encheresOverlay.style.display = "none";
  }

  // 3. On s'assure que le bouton Quitter est visible
  if (globalControls) globalControls.classList.remove("hidden");

  // 4. Lancement de l'animation finale
  runGlobalVictoryAnim(data.winner);
});


socket.on("errorMessage", (msg) => {


  if (screenLobby.classList.contains("active")) {


    setLobbyError(msg);


  } else {


    setRoomError(msg);


  }


});


socket.on("connect", () => {


  // plus tard : socket.emit("requestRoomState");


});


socket.on("fauxVraiThemes", (themes) => {


  fauxVraiThemes = Array.isArray(themes) ? themes : [];


});


socket.on("leugtasTimerUpdate", ({ remainingSeconds, totalSeconds }) => {


  // 1. Déverrouillage physique des boutons (si intro finie)


  const lockedBtns = document.querySelectorAll(".btn-locked-intro");


  lockedBtns.forEach((btn) => {


    btn.disabled = false;


    btn.classList.remove("btn-locked-intro");


  });


  const elapsed =


    Math.max(0, (totalSeconds || 0) - (remainingSeconds || 0));


  const hiddenBtns = document.querySelectorAll(


    ".playing-choice-btn.choice-hidden"


  );


  // 2. Lancement de l'animation d'apparition (UNE SEULE FOIS au démarrage)


  if (!leugtasAnswersShown) {


    if (hiddenBtns.length > 0 && elapsed > 3.5) {


      leugtasAnswersShown = true;


      hiddenBtns.forEach((btn) => {


        btn.classList.remove("choice-hidden");


        btn.classList.add("choice-visible");


        btn.style.transition = "none";


      });


    } else if (hiddenBtns.length > 0 && remainingSeconds < totalSeconds) {


      leugtasAnswersShown = true;


      animateChoicesSequentially(Array.from(hiddenBtns));


    }


  }


  if (!playingTimer) return;


  playingTimer.textContent = remainingSeconds;


  if (playingTimerBarFill) {


    const ratio = remainingSeconds / totalSeconds;


    playingTimerBarFill.style.width = (ratio * 100) + "%";


  }


  if (playingTimerBarFill && playingTimer) {


    if (remainingSeconds <= 5) {


      playingTimerBarFill.style.background = "#ff3b30";


      playingTimer.style.color = "#ff3b30";


    } else if (remainingSeconds <= 10) {


      playingTimerBarFill.style.background = "#ff9500";


      playingTimer.style.color = "#ff9500";


    } else {


      playingTimerBarFill.style.background = "#ffcc00";


      playingTimer.style.color = "#ffffff";


    }


  }


  if (remainingSeconds <= 0) {


    sfxLeugtasQuestion.stop();


  }


});


socket.on("leugtasEnd", () => {
  sfxLeugtasWin.stop();
  sfxLeugtasLose.stop();
  sfxLeugtasQuestion.stop();
  hideAllMiniGames();
  if (mainPlaying) mainPlaying.classList.add("hidden");

  runEliminationSequence(currentPlayersData, () => {
      if (!leugtasEndOverlay) return;
      
      // --- D�CLENCHEMENT DU SON ---
      sfxFinJeu.play();
      
      leugtasEndOverlay.classList.remove("hidden");
      setTimeout(() => {
        leugtasEndOverlay.classList.add("hidden");
      }, 3500); 
  });
});
socket.on("leugtasFeedback", () => {


  // ne rien faire : la rÃ©vÃ©lation est 100% gÃ©rÃ©e par le socket "leugtasReveal"


});


socket.on("scoreUpdate", (data) => {


  // 1. IMPORTANT : On sauvegarde les donnÃ©es QUOI QU'IL ARRIVE


  // C'est Ã§a qui nourrit le classement intermÃ©diaire


  currentPlayersData = data.players || [];


  // 2. Si l'ancienne div scoreboard existe encore (optionnel), on la met Ã  jour


  if (scoreboard) {


    scoreboard.innerHTML = "<h3>Scores</h3>";


    const scorePlayers = currentRoom?.gameMode === "liste" ? currentPlayersData : data.players


      .sort((a, b) => {


        if (b.score !== a.score) return b.score - a.score;


        return (parseFloat(a.time) || 0) - (parseFloat(b.time) || 0);


      });

    scorePlayers


      .forEach((p) => {


        const line = document.createElement("div");


        line.textContent = p.nickname + " : " + p.score + " point(s)";


        scoreboard.appendChild(line);


      });


  }

  if (currentRoom?.gameMode === "liste" && data.refreshLeaderboard === true &&
      currentGameState.currentMiniGame !== "le_bon_ordre") {
    const overlay = document.getElementById("leaderboard-overlay");
    if (overlay?.classList.contains("active")) {
      handleInterimLeaderboard(currentPlayersData, null, 0,
        document.getElementById("leaderboardTitle")?.textContent || "Classement", true);
    }
  }


});


socket.on("leugtasReveal", (data) => {
  miniGameLeaderboardVersion++;
  const isCurrentReveal = captureMiniGameLeaderboardContext();
  if (!isCurrentReveal()) return;


  sfxLeugtasQuestion.stop();


  const { correctAnswerId, playerAnswers, isLastQuestion, skipAnimation } = data;


  if (!playingChoices || !playingQuestion || !playingFeedback) return;


  playingFeedback.textContent = "";


  playingFeedback.classList.remove("good", "bad");


  const buttons = playingChoices.querySelectorAll("button");


  const correctId = String(correctAnswerId);


  const me = playerAnswers && playerAnswers[playerId];


  if (me) {


    if (me.isCorrect) {


      sfxLeugtasWin.play();


    } else {


      sfxLeugtasLose.play();


    }


  }


  buttons.forEach((btn) => {


    const btnId = btn.dataset.answerId;


    btn.disabled = true;


    btn.classList.remove("btn-waiting-selected", "btn-waiting-other");


    btn.style.backgroundColor = "";


    btn.style.opacity = "";


    if (btnId === correctId) {


      btn.style.backgroundColor = "#2ecc71";


      btn.style.opacity = "1";


    } else if (


      me &&


      me.answerId !== null &&


      btnId === String(me.answerId) &&


      !me.isCorrect


    ) {


      btn.style.backgroundColor = "#e74c3c";


      btn.style.opacity = "1";


    } else {


      btn.style.opacity = "0.4";


    }


  });


  playingQuestion.classList.remove("reveal-pulse");


  playingChoices.classList.remove("reveal-pulse");


  playingQuestion.offsetHeight;


  playingChoices.offsetHeight;


  playingQuestion.classList.add("reveal-pulse");


  playingChoices.classList.add("reveal-pulse");


  const revealDelay = skipAnimation ? 0 : 2500;


  setTimeout(() => {
    if (!isCurrentReveal()) return;


    const duration = isLastQuestion ? 5000 : 999999;


    const title = isLastQuestion ? "CLASSEMENT FINAL" : "CLASSEMENT";


    const isCurrentDisplay = handleInterimLeaderboard(


      currentPlayersData,


      () => {


        if (!skipAnimation) resetTimerBarVisuals();


      },


      duration,


      title


    );


    setTimeout(() => {
      if (!isCurrentDisplay()) return;


      if (!isLastQuestion) cleanUpBehindScenes();


    }, 500);


  }, revealDelay);


});


socket.on("fauxVraiQuestion", (data) => {
  invalidateMiniGameLeaderboard();


  fauxVraiAnswersShown = false;


  const lbOverlay = document.getElementById("leaderboard-overlay");


  if (lbOverlay) lbOverlay.classList.remove("active");


  if (mainDefault) mainDefault.classList.add("hidden");


  if (mainDrawing) mainDrawing.classList.add("hidden");


  if (mainRules) mainRules.classList.add("hidden");


  if (mainPlaying) mainPlaying.classList.add("hidden");


  if (fauxVraiContainer) fauxVraiContainer.classList.add("hidden");


  if (scoreboard) scoreboard.classList.add("hidden");


  if (fauxVraiQuestion) {


    fauxVraiQuestion.textContent = "";


  }


  if (fauxVraiAnswers) {


    fauxVraiAnswers.innerHTML = "";


  }


  const themeObj = fauxVraiThemes.find((t) => t.id === data.themeId);


  const themeLabel = themeObj ? themeObj.label : "Thème inconnu";


  if (palierOverlayText && palierOverlay && !data.isReload) {


    sfxTheme.play();


    palierOverlayText.textContent = themeLabel;


    palierOverlay.classList.remove("hidden");


    setTimeout(() => {


      showFauxVraiQuestion(data);


      if (scoreboard) scoreboard.classList.remove("hidden");


      setTimeout(() => {


        palierOverlay.classList.add("hidden");


      }, 100);


    }, 1500);


  } else {


    showFauxVraiQuestion(data);


    if (scoreboard) scoreboard.classList.remove("hidden");


  }


});


socket.on("fauxVraiTimerUpdate", ({ remaining, total }) => {


  // 1. Déverrouillage physique


  const lockedFv = document.querySelectorAll(".fv-intro-lock");


  lockedFv.forEach((btn) => {


    btn.style.pointerEvents = "auto";


    btn.classList.remove("fv-intro-lock");


    // Sécurité : on nettoie toute opacité inline qui traînerait


    btn.style.opacity = "";


  });


  const elapsed = Math.max(0, (total || 0) - remaining);


  const fvButtons = document.querySelectorAll(".fauxvrai-answer-btn");


  // 2. Lancement de l'animation (Cascade)


  if (!fauxVraiAnswersShown && fvButtons.length > 0) {


    if (elapsed > 2.5) {


      fauxVraiAnswersShown = true;


      fvButtons.forEach((btn) => {


        btn.classList.add("choice-visible");


        btn.style.opacity = "1";


        btn.style.transition = "none";


      });


    } else if (remaining < total) {


      fauxVraiAnswersShown = true;


      fvButtons.forEach((btn, index) => {


        setTimeout(() => {


          btn.classList.add("choice-visible");


        }, index * 100);


      });


    }


  }


  if (!fauxVraiTimerNumber || !fauxVraiTimerFill) return;


  fauxVraiTimerNumber.textContent = remaining;


  const ratio = total ? remaining / total : 0;


  fauxVraiTimerFill.style.width = ratio * 100 + "%";


  if (remaining <= 5) {


    fauxVraiTimerFill.style.background = "#ff3b30";


    fauxVraiTimerNumber.style.color = "#ff3b30";


  } else {


    fauxVraiTimerFill.style.background = "#ffcc00";


    fauxVraiTimerNumber.style.color = "white";


  }


  if (remaining <= 0) {


    sfx45s.stop();


  }


});


socket.on("fauxVraiReveal", ({ indexFausse, playerChoice, isLastQuestion }) => {
  miniGameLeaderboardVersion++;
  const isCurrentReveal = captureMiniGameLeaderboardContext();
  if (!isCurrentReveal()) return;


  sfx45s.stop();


  const fb = document.getElementById("fauxVraiFeedback");


  if (fb) fb.textContent = "";


  const btns = document.querySelectorAll(".fauxvrai-answer-btn");


  if (playerChoice === indexFausse) {


    sfxFauxVraiWin.play();


  } else {


    sfxFauxVraiLose.play();


  }


  btns.forEach((btn, i) => {


    btn.classList.remove("btn-waiting-selected", "btn-waiting-other");


    btn.classList.add("locked");


    if (i === indexFausse) {


      btn.classList.add("correct", "reveal-pulse");


      btn.style.opacity = "1";


      return;


    }


    if (i === playerChoice && playerChoice !== indexFausse) {


      btn.classList.add("incorrect", "reveal-pulse");


      btn.style.opacity = "1";


      return;


    }


    btn.style.opacity = "0.5";


  });


  setTimeout(() => {
    if (!isCurrentReveal()) return;


    // MODIFICATION : Durée réduite à 4500ms (au lieu de 8000) pour synchronisation


    const duration = isLastQuestion ? 4500 : 999999;


    const title = isLastQuestion ? "CLASSEMENT FINAL" : "CLASSEMENT";


    sfxFauxVraiWin.stop();


    sfxFauxVraiLose.stop();


    const isCurrentDisplay = handleInterimLeaderboard(


      currentPlayersData,


      () => {},


      duration,


      title


    );


    setTimeout(() => {
      if (!isCurrentDisplay()) return;
      cleanUpFauxVraiScenes();


    }, 500);


  }, 2500);


});


// --- ?COUTEUR INTRO ---


socket.on("playIntroAnimation", (data) => {


    // Masque l'interface du lobby/room si elle est visible


    if(roomUpper) roomUpper.style.display = "none";


    // Lance l'animation avec le nombre de joueurs re?u


    runGameIntro(data.playerCount || 4);


});


socket.on("playGradeSound", (value) => {


  const val = parseFloat(value);


  if (val === 1) sfxCorrect1.play();


  else if (val === 0) sfxCorrect0.play();


  else if (val === 0.5) sfxCorrectOther.play();


});


socket.on("playCorrectionArrow", () => {


  sfxCorrectionArrow.play();


});


socket.on("correctionUpdate", (data) => {
  if (data.miniGameType === "le_bon_ordre") return;
  if (data.gameMode === "liste" &&
      (currentRoom?.gameMode !== "liste" || data.roomCode !== currentRoom.roomCode)) return;
  if (data.miniGameType === "matrice_football" &&
      (data.roomCode !== currentRoom?.roomCode ||
       data.matriceFootballData?.instanceId !== currentGameState.matriceFootballInstanceId ||
       (matriceFootballRoomCode === data.roomCode && matriceFootballInstanceId &&
        data.matriceFootballData.instanceId !== matriceFootballInstanceId))) return;


  stopBlindTestAudio(); // On coupe le son avant tout


  hideAllMiniGames();   // On cache tout (jeux, lobby, etc)


  const stdContainer = document.getElementById("correctionContainer");


  const pbContainer = document.getElementById("petitBacCorrectionContainer");


  if (stdContainer) stdContainer.classList.add("hidden");


  if (pbContainer) pbContainer.classList.add("hidden");

  if (currentRoom?.gameMode === "liste" && data.gameMode === "liste" && data.empty) {
    setRoomError("Aucun participant à corriger pour le moment.");
    return;
  }

  if (data.miniGameType === "petit_bac") {


    handlePetitBacCorrection(data, pbContainer);

  } else if (data.miniGameType === "matrice_football") {

    handleMatriceFootballCorrection(data);


  } else {


    handleStandardCorrection(data, stdContainer);


  }


});


// --- FONCTION 1 : CORRECTION STANDARD (RestaurÃ©e) ---


// --- FONCTION 1 : CORRECTION STANDARD (CorrigÃ©e) ---


// --- FONCTION 1 : CORRECTION STANDARD (Corrig�e et Renforc�e) ---
function handleStandardCorrection(data, container) {
  if (!container) return;
  container.classList.remove("hidden");

  // R�f�rences DOM
  const qInfo = document.getElementById("correctionQuestionInfo");
  const imgQ = document.getElementById("corrImgQuestion");
  const txtQ = document.getElementById("corrTextQuestion");
  const imgA = document.getElementById("corrImgAnswer");
  const txtA = document.getElementById("corrTextAnswer");
  const audio = document.getElementById("corrAudioPlayer");
  const blockQ = document.getElementById("corrQuestionBlock");
  const blockA = document.getElementById("corrAnswerBlock");
  const pName = document.getElementById("gradingPlayerName");
  const pAns = document.getElementById("gradingPlayerAnswer");
  const gradControls = document.getElementById("gradingControls");
  const waitMsg = document.getElementById("gradingWaitMessage");
  
  const amIHost = currentRoom && currentRoom.hostId === playerId;

  // 1. Infos g�n�rales (CORRECTIF : On force l'affichage du compteur)
  if (qInfo) {
      qInfo.textContent = `Question ${data.currentQIndex} / ${data.totalQ}`;
      qInfo.style.display = "block";   // Force l'affichage
      qInfo.style.color = "#ffffff";   // Force le blanc
      qInfo.style.opacity = "1";       // Enl�ve la transparence
      qInfo.classList.remove("hidden");
  }

  if (pName) pName.textContent = data.playerPseudo || "Joueur";
  if (pAns) pAns.textContent = data.playerAnswer || "";

  // 2. Reset visuel
  if (blockQ) blockQ.style.display = "none";
  if (imgA) imgA.style.display = "none";
  if (audio) audio.style.display = "none";
  if (txtA) txtA.style.display = "block";

  // 3. Logique par type de jeu
  // --- BLIND TEST ---
  if (data.miniGameType === "blind_test") {
     if (blockA) blockA.style.display = "flex";
     if (data.audio) {
         audio.src = data.audio;
         audio.style.display = "block";
         audio.classList.remove("hidden");
     }
     if (data.answerImage) {
         imgA.src = data.answerImage;
         imgA.style.display = "block";
     }
     if (txtA) txtA.textContent = data.answerText;
  }
  // --- AUTRES JEUX (Tour du Monde, Qui suis-je, Le Bon Ordre) ---
  else {
      if (blockQ) blockQ.style.display = "flex";
      // GESTION IMAGE QUESTION
      if (data.miniGameType === "le_bon_ordre") {
          // Pour le Bon Ordre : JAMAIS d'image question
          if (imgQ) imgQ.style.display = "none";
      } else if (imgQ) {
          // Pour Tour du Monde / Qui suis-je : On affiche si elle existe
          if (data.questionImage) {
              imgQ.src = data.questionImage;
              imgQ.style.display = "block";
          } else {
              imgQ.style.display = "none";
          }
      }

      if (data.questionText && txtQ) {
          txtQ.textContent = data.questionText;
          txtQ.style.display = "block";
      } else if (txtQ) {
          txtQ.style.display = "none";
      }

      // Affichage de la r�ponse
      if (data.answerImage && imgA) {
          imgA.src = data.answerImage;
          imgA.style.display = "block";
      }

      if (txtA) txtA.textContent = data.answerText;
  }

  // 4. Contr�les H�te
  if (gradControls) {
      gradControls.style.display = "flex";
      const btns = gradControls.querySelectorAll("button");
      btns.forEach(btn => {
          btn.classList.remove("selected");
          btn.disabled = !amIHost; 
          btn.style.opacity = amIHost ? "1" : "0.5";
          btn.style.cursor = amIHost ? "pointer" : "default";
      });

      if (data.currentGrade === 1) document.querySelector(".grade-1")?.classList.add("selected");
      else if (data.currentGrade === 0.5) document.querySelector(".grade-05")?.classList.add("selected");
      else if (data.currentGrade === 0) document.querySelector(".grade-0")?.classList.add("selected");
  }

  // Navigation Joueurs
  const navLeft = document.getElementById("btnPrevPlayer");
  const navRight = document.getElementById("btnNextPlayer");
  if (navLeft) navLeft.style.display = amIHost ? "flex" : "none";
  if (navRight) navRight.style.display = amIHost ? "flex" : "none";

  // Navigation Questions (Suivante / Pr�c�dente)
  const nextQBtn = document.getElementById("btnNextCorrectionQ");
  const prevQBtn = document.getElementById("btnPrevCorrectionQ");

  if (nextQBtn) {
      nextQBtn.style.display = amIHost ? "block" : "none";
      nextQBtn.textContent = data.currentQIndex >= data.totalQ ? "Terminer la correction" : "Valider & Suivante >>";
  }

  // Bouton "Revenir" : Visible seulement si Host ET index > 1
  if (prevQBtn) {
      if (amIHost && data.currentQIndex > 1) {
          prevQBtn.style.display = "block";
      } else {
          prevQBtn.style.display = "none";
      }
  }

  // Message spectateur
  if (waitMsg) waitMsg.classList.toggle("hidden", amIHost);
}

function handleBonOrdreCorrection(data) {
  const container = document.getElementById("bonOrdreCorrectionContainer");
  const correction = data.bonOrdreData;
  if (!container || !correction) return;
  const key = bonOrdrePhaseKey(data);
  const now = performance.now();
  const previousRemaining = bonOrdreCorrectionClock?.key === key
    ? Math.max(0, bonOrdreCorrectionClock.remainingMs - (now - bonOrdreCorrectionClock.receivedAt)) : Infinity;
  stopBonOrdreCorrectionClock();
  hideAllMiniGames();
  [mainDefault, mainDrawing, mainRules, mainPlaying, scoreboard].forEach(element => element?.classList.add("hidden"));
  bonOrdreCorrectionContext = data;
  if (bonOrdreState) bonOrdreState.active = false;
  ++bonOrdreDisplayToken;
  sfx45s.stop();
  palierOverlay?.classList.add("hidden");
  container.classList.remove("hidden");
  document.getElementById("bonOrdreCorrectionInfo").textContent = `Question ${data.currentQIndex} / ${data.totalQ}`;
  document.getElementById("bonOrdreCorrectionQuestion").textContent = data.questionText || "";
  const participant = data.isParticipant === true && correction.status !== "spectator";
  document.getElementById("bonOrdrePersonalSection").hidden = !participant;
  document.getElementById("bonOrdreCorrectionPlayer").textContent = participant ? data.playerPseudo || "" : "";
  const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 });
  const makeCard = (card, expected) => {
    const item = document.createElement("div");
    item.className = "bon-ordre-correction-card";
    const rank = document.createElement("span");
    rank.className = "bon-ordre-correction-rank";
    rank.textContent = `Rang ${card.rank}`;
    item.appendChild(rank);
    item.appendChild(makeBonOrdreCardContent(card));
    if (expected) {
      const value = document.createElement("span");
      value.className = "bon-ordre-value";
      value.textContent = numberFormat.format(card.valeur);
      item.appendChild(value);
    } else {
      item.classList.add(card.correct ? "bon-ordre-correct" : "bon-ordre-incorrect");
      const verdict = document.createElement("span");
      verdict.className = "bon-ordre-position-verdict";
      verdict.textContent = card.correct ? "✓ Bien placé" : `✗ Bonne place : ${(card.correctRanks || []).join(" ou ")}`;
      item.appendChild(verdict);
    }
    return item;
  };
  const expected = document.getElementById("bonOrdreExpectedCards");
  expected.replaceChildren(...(correction.expected || []).map(card => makeCard(card, true)));
  const proposal = document.getElementById("bonOrdreProposalCards");
  proposal.replaceChildren(...(participant ? correction.positions || [] : []).map(card => makeCard(card, false)));
  const status = document.getElementById("bonOrdreCorrectionStatus");
  status.textContent = correction.status === "pass" ? "Je passe" :
    correction.status === "missing" ? "Aucune réponse validée" : "";
  status.hidden = correction.status === "answered";
  proposal.hidden = correction.status !== "answered";
  document.getElementById("bonOrdreCorrectionScore").textContent = participant
    ? `${correction.correctCount} / 5 éléments bien placés · Points : ${numberFormat.format(correction.grade)}` : "";
  bonOrdreCorrectionClock = {
    key, context: data, receivedAt: now, remainingMs: Math.min(previousRemaining, bonOrdreRemainingMs(data))
  };
  const renderClock = () => {
    if (!bonOrdreCorrectionClock || !bonOrdreEventMatches(data, ["correction"])) return stopBonOrdreCorrectionClock();
    const remaining = Math.max(0, bonOrdreCorrectionClock.remainingMs - (performance.now() - bonOrdreCorrectionClock.receivedAt));
    document.getElementById("bonOrdreCorrectionCountdown").textContent = remaining > 0
      ? `Classement dans ${Math.ceil(remaining / 1000)} s` : "Le classement va s’afficher…";
  };
  renderClock();
  bonOrdreCorrectionInterval = setInterval(renderClock, 250);
}

function handlePetitBacCorrection(data, container) {


  if (!container) return;


  container.classList.remove("hidden");


  const amIHost = currentRoom && currentRoom.hostId === playerId;


  const letterEl = document.getElementById("pbCorrLetter");


  const pName = document.getElementById("pbGradingPlayerName");


  const list = document.getElementById("pbCorrList");


  const totalDisplay = document.getElementById("pbTotalScoreDisplay");


  const submitBtn = document.getElementById("pbSubmitTotalBtn");


  const finishBtn = document.getElementById("pbFinishGameBtn");


  const navLeft = document.getElementById("btnPrevPlayerPB");


  const navRight = document.getElementById("btnNextPlayerPB");


  if (letterEl && data.petitBacData) letterEl.textContent = data.petitBacData.letter;


  if (pName) pName.textContent = data.playerPseudo;


  if (submitBtn) submitBtn.style.display = amIHost ? "block" : "none";


  if (finishBtn) finishBtn.style.display = amIHost ? "block" : "none";


  if (navLeft) navLeft.style.display = amIHost ? "flex" : "none";


  if (navRight) navRight.style.display = amIHost ? "flex" : "none";


  if (list && data.petitBacData) {


    list.innerHTML = "";


    const savedMap = data.petitBacData.savedDetails || {};


    window.pbScoresMap = savedMap;


    let currentTotal = 0;


    Object.values(savedMap).forEach((v) => (currentTotal += v));


    if (totalDisplay) totalDisplay.textContent = currentTotal;


    data.petitBacData.categories.forEach((cat, idx) => {


      const ans = (data.petitBacData.answers || {})[idx] || "";


      const row = document.createElement("div");


      row.className = "pb-corr-row";


      const score = savedMap[idx];


      const isActive = (val) => (score === val ? "active" : "");


      const pointerStyle = amIHost ? "cursor:pointer;" : "pointer-events: none; opacity: 0.6;";


      const btnsHtml = `


        <button class="pb-btn-small pb-1 ${isActive(1)}" style="${pointerStyle}" onclick="ratePbLine(${idx}, 1, this)">1</button>


        <button class="pb-btn-small pb-05 ${isActive(0.5)}" style="${pointerStyle}" onclick="ratePbLine(${idx}, 0.5, this)">0.5</button>


        <button class="pb-btn-small pb-0 ${isActive(0)}" style="${pointerStyle}" onclick="ratePbLine(${idx}, 0, this)">0</button>


      `;


      row.innerHTML = `


        <div class="pb-corr-cat">${escapeHtmlText(cat)}</div>


        <div class="pb-corr-ans">${escapeHtmlText(ans)}</div>


        <div class="pb-corr-btns">${btnsHtml}</div>


      `;


      list.appendChild(row);


    });


  }


}

function handleMatriceFootballCorrection(data) {
  const container = document.getElementById("matriceFootballCorrectionContainer");
  const matrixData = data.matriceFootballData;
  if (!container || !matrixData || data.roomCode !== currentRoom?.roomCode ||
      matrixData.instanceId !== currentGameState.matriceFootballInstanceId) return;
  currentMatriceFootballCorrection = { ...matrixData, roomCode: data.roomCode };
  container.classList.remove("hidden");
  const host = currentRoom?.hostId === playerId;
  const submitted = matrixData.submitted;
  const answers = matrixData.answers || {};
  const details = { ...matrixData.savedDetails };
  document.getElementById("mfGradingPlayerName").textContent = data.playerPseudo;
  document.getElementById("mfCorrectionStatus").textContent = submitted ? "" :
    "Grille non validée dans le temps imparti";
  const total = Object.values(details).reduce((sum, value) => sum + value, 0);
  document.getElementById("mfTotalScore").textContent = `Total : ${total} / 9`;
  const grid = document.getElementById("mfCorrectionGrid");
  renderMatriceFootballGrid(grid, matrixData.matrix, answers, details, host && submitted,
    (index, value) => {
      if (!host || !submitted || currentGameState.currentMiniGame !== "matrice_football" ||
          matrixData.roundNumber !== currentGameState.roundNumber ||
          matrixData.instanceId !== currentGameState.matriceFootballInstanceId ||
          !answers[index]?.trim()) return;
      details[index] = value;
      const revised = { ...details };
      const points = Object.values(revised).reduce((sum, grade) => sum + grade, 0);
      emitGameAction("hostGradePlayer", { points, details: revised, soundValue: value,
        gradingPlayerId: matrixData.playerId, roundNumber: matrixData.roundNumber,
        matrixId: matrixData.matrix.id, instanceId: matrixData.instanceId });
    });
  for (const id of ["mfPrevPlayer", "mfNextPlayer", "mfFinishCorrection"]) {
    document.getElementById(id).style.display = host ? "block" : "none";
  }
  container.querySelector(".mf-wait-msg").style.display = host ? "none" : "block";
}

function matriceCorrectionActionPayload() {
  const data = currentMatriceFootballCorrection;
  return data ? { roundNumber: data.roundNumber, matrixId: data.matrix.id,
    instanceId: data.instanceId, gradingPlayerId: data.playerId } : null;
}
document.getElementById("mfPrevPlayer")?.addEventListener("click", () => {
  const context = matriceCorrectionActionPayload();
  if (context) emitGameAction("correctionNavigate", { ...context, direction: -1 });
});
document.getElementById("mfNextPlayer")?.addEventListener("click", () => {
  const context = matriceCorrectionActionPayload();
  if (context) emitGameAction("correctionNavigate", { ...context, direction: 1 });
});
document.getElementById("mfFinishCorrection")?.addEventListener("click", () => {
  const context = matriceCorrectionActionPayload();
  if (context) emitGameAction("endMatriceFootballCorrection", context);
});


if (btnPrevPlayer) {


  btnPrevPlayer.onclick = () => emitGameAction("correctionNavigate", { direction: -1 });


}


if (btnNextPlayer) {


  btnNextPlayer.onclick = () => emitGameAction("correctionNavigate", { direction: 1 });


}


if (btnPrevCorrectionQ) {


  btnPrevCorrectionQ.addEventListener("click", () => {


    emitGameAction("correctionPrevQuestion");


  });


}


// --- AJOUT MANQUANT ---


if (btnNextCorrectionQ) {


  btnNextCorrectionQ.addEventListener("click", () => {


    emitGameAction("correctionNextQuestion");


  });


}


window.pbScoresMap = {};


window.ratePbLine = function (lineIdx, points, btnElement) {


  // 1. Mise Ã  jour visuelle locale immÃ©diate (pour l'hÃ´te)


  window.pbScoresMap[lineIdx] = points;


  const parent = btnElement.parentElement;


  parent.querySelectorAll("button").forEach((b) => b.classList.remove("active"));


  btnElement.classList.add("active");


  // 2. Calcul du total provisoire


  let total = 0;


  Object.values(window.pbScoresMap).forEach((v) => (total += v));


  const totalDisplay = document.getElementById("pbTotalScoreDisplay");


  if (totalDisplay) totalDisplay.textContent = total;


  // 3. ENVOI TEMPS RÃEL AU SERVEUR


  // Cela permet aux spectateurs de voir la surbrillance instantanÃ©ment


  if (socket) {


    emitGameAction("hostGradePlayer", {


      points: total, // Met Ã  jour le score global


      details: window.pbScoresMap, // Envoie le dÃ©tail pour allumer les boutons chez les autres


      soundValue: points // AJOUT : note specifique de la ligne (1, 0.5 ou 0)


    });


  }


};


if (pbSubmitTotalBtn) {


  pbSubmitTotalBtn.onclick = function () {


    let total = 0;


    Object.values(window.pbScoresMap).forEach((v) => (total += v));


    emitGameAction("hostGradePlayer", {


      points: total,


      details: window.pbScoresMap


    });


    emitGameAction("correctionNavigate", { direction: 1 });


  };


}


if (pbFinishGameBtn) {


  pbFinishGameBtn.addEventListener("click", () => {


    emitGameAction("endPetitBacCorrection");


  });


}


socket.on("leBonOrdreExit", data => {
  // L'événement historique est aussi utilisé par les autres mini-jeux manuels.
  if (currentGameState.currentMiniGame !== "le_bon_ordre") {
    if (data?.instanceId) return;
    hideAllMiniGames();
    mainPlaying?.classList.add("hidden");
    runEliminationSequence(currentPlayersData, () => {
      if (!leugtasEndOverlay) return;
      sfxFinJeu.play();
      const logo = document.getElementById("leugtasEndLogo");
      if (logo) {
        const gameName = ["petit_bac", "le_petit_bac"].includes(currentGameState.currentMiniGame)
          ? "le_petit_bac" : currentGameState.currentMiniGame;
        logo.src = `titres/${gameName}.png`;
      }
      leugtasEndOverlay.classList.remove("hidden");
      setTimeout(() => leugtasEndOverlay.classList.add("hidden"), 3500);
    });
    return;
  }
  if (!bonOrdreEventMatches(data, ["ending"])) return;
  const key = bonOrdrePhaseKey(data);
  if (bonOrdreEndingSnapshot?.key === key) return;
  hideAllMiniGames();
  invalidateMiniGameLeaderboard();
  stopBonOrdreCorrectionClock();
  sfx45s.stop();
  palierOverlay?.classList.add("hidden");
  [mainDefault, mainDrawing, mainRules, mainPlaying, scoreboard].forEach(element => element?.classList.add("hidden"));
  const remainingMs = bonOrdreRemainingMs(data);
  const durationMs = Math.max(0, Number(data.durationMs) || (data.gameMode === "liste" ? 3500 : 7000));
  const snapshot = { key, context: data, receivedAt: performance.now(), elapsedMs: durationMs - remainingMs };
  bonOrdreEndingSnapshot = snapshot;
  const isCurrent = () => bonOrdreEndingSnapshot === snapshot && bonOrdreEventMatches(data, ["ending"]);
  const showLogo = () => {
    if (!isCurrent() || !leugtasEndOverlay) return;
    const elapsedMs = snapshot.elapsedMs + performance.now() - snapshot.receivedAt;
    const logoElapsedMs = Math.max(0, elapsedMs - (data.gameMode === "liste" ? 0 : 3500));
    if (logoElapsedMs >= 3500) return;
    const logo = document.getElementById("leugtasEndLogo");
    if (logo) {
      logo.src = "titres/le_bon_ordre.png";
      logo.style.animation = "none";
      void logo.offsetWidth;
      logo.style.animation = "spinAndShoot 3.5s ease-out forwards";
      logo.style.animationDelay = `-${logoElapsedMs}ms`;
    }
    if (logoElapsedMs < 300) sfxFinJeu.play();
    leugtasEndOverlay.classList.remove("hidden");
    setTimeout(() => {
      if (isCurrent()) leugtasEndOverlay.classList.add("hidden");
    }, Math.max(0, 3500 - logoElapsedMs));
  };
  runEliminationSequence(data.players || currentPlayersData, showLogo, { isCurrent, elapsedMs: snapshot.elapsedMs });
});

socket.on("fauxVraiEnd", () => {
  hideAllMiniGames();
  if (mainPlaying) mainPlaying.classList.add("hidden");
  if (fauxVraiContainer) fauxVraiContainer.classList.add("hidden");
  if (scoreboard) scoreboard.classList.add("hidden");

  runEliminationSequence(currentPlayersData, () => {
      if (fauxVraiEndOverlay) {
        // --- D�CLENCHEMENT DU SON ---
        sfxFinJeu.play();

        fauxVraiEndOverlay.classList.remove("hidden");
        setTimeout(() => {
          fauxVraiEndOverlay.classList.add("hidden");
        }, 3500);
      }
  });
});
// ==========================================


//        CLIENT : LES ENCHÃ¨RES


// ==========================================


const encheresSetup = document.getElementById("encheresSetupContainer");


const encheresGame = document.getElementById("encheresGameContainer");


const encheresCorrection = document.getElementById("encheresCorrectionContainer");


// 1. SETUP & VOTE


socket.on("encheresSetup", (data) => {


  sfxEnchere.play();


  hideAllMiniGames();


  if (encheresSetup) {


    encheresSetup.classList.remove("hidden");


    const list = document.getElementById("encheresThemesList");


    list.innerHTML = "";


    const isSpec = amISpectator();


    const myVoteId = data.currentVote;


    data.themes.forEach((theme) => {


      const btn = document.createElement("button");


      btn.className = "encheres-theme-btn";


      btn.dataset.themeId = theme.id;


      // --- MODIFICATION D?BUT : Gestion Rupture de Stock ---


      if (theme.outOfStock) {


        // Cas : Rupture de stock -> Bouton bloqu? et gris?


        btn.textContent = (theme.nom || theme.name || "Th?me") + " (Rupture de stock)";


        btn.disabled = true;


        // Style visuel "Interdit"


        btn.style.opacity = "0.4";


        btn.style.backgroundColor = "#444";


        btn.style.cursor = "not-allowed";


        btn.style.border = "1px solid #666";


        btn.style.color = "#aaa";


      } else {


        // Cas : Normal


        btn.textContent = theme.nom || theme.name || "Th?me";


        if (isSpec) {


          btn.disabled = true;


          btn.style.opacity = "0.5";


          btn.style.cursor = "default";


        } else if (myVoteId) {


          btn.disabled = true;


          if (theme.id === myVoteId) {


            btn.classList.add("selected");


            btn.style.opacity = "1";


          } else {


            btn.style.opacity = "0.5";


          }


        } else {


          btn.onclick = () => {


            sfxEnchere.stop();


            sfxBubbleClick.play();


            socket.emit("encheresVoteTheme", theme.id);


            btn.classList.add("selected");


            Array.from(list.children).forEach((sibling) => {


              sibling.disabled = true;


              if (sibling !== btn) {


                sibling.style.opacity = "0.5";


              }


            });


          };


        }


      }


      // --- MODIFICATION FIN ---


      list.appendChild(btn);


    });
  }


});


socket.on("encheresThemeAnim", (data) => {


  sfxEnchere.stop();


  sfxEnchereTheme.play();


  const list = document.getElementById("encheresThemesList");


  if (!list) return;


  const candidates = data.candidates || [];


  const winnerId = data.chosenThemeId;


  const buttons = Array.from(list.children);


  const targetButtons = buttons.filter((btn) =>


    candidates.includes(btn.dataset.themeId)


  );


  if (targetButtons.length === 0) return;


  let toggleCount = 0;


  const maxToggles = 20;


  const animInterval = setInterval(() => {


    targetButtons.forEach((b) => {


      b.classList.remove("selected");


      b.style.opacity = "1";


      b.style.transform = "scale(1)";


    });


    const randBtn = targetButtons[toggleCount % targetButtons.length];


    randBtn.classList.add("selected");


    toggleCount++;


    if (toggleCount > maxToggles) {


      clearInterval(animInterval);


      buttons.forEach((b) => {


        if (b.dataset.themeId === winnerId) {


          b.classList.add("selected");


          b.style.transform = "scale(1.1)";


          b.style.boxShadow = "0 0 20px #ffcc00";


          b.style.opacity = "1";


        } else {


          b.classList.remove("selected");


          b.style.opacity = "0.3";


        }


      });


    }


  }, 100);


});


// 2. DÃ©BUT DES ENCHÃ¨RES


socket.on("encheresStartBidding", (data) => {


  hideAllMiniGames();


  if (encheresSetup) encheresSetup.classList.add("hidden");


  if (encheresGame) {


      encheresGame.classList.remove("hidden");


      encheresGame.style.display = "flex"; 


  }


  const biddingZone = document.getElementById("encheresBiddingZone");


  const playingZone = document.getElementById("encheresPlayingZone");


  if (biddingZone) {


      biddingZone.classList.remove("hidden");


      biddingZone.style.display = "flex";


  }


  if (playingZone) {


      playingZone.classList.add("hidden");


      playingZone.style.display = "none";


  }


  document.getElementById("encheresQuestionText").textContent = data.questionText || "...";


  document.getElementById("encheresPhaseTitle").textContent = "Phase : Enchères";


  const historyDiv = document.getElementById("encheresHistory");


  if (historyDiv) historyDiv.innerHTML = ""; 


  const me = currentRoom ? currentRoom.players.find(p => p.playerId === playerId) : null;


  const isSpectator = me && (me.eliminated || me.isSpectator);


  const bidInputBlock = document.getElementById("encheresBidInputBlock");


  if (bidInputBlock) {


      if (isSpectator) {


          bidInputBlock.style.display = "none";


          let specMsg = document.getElementById("encheresSpecMsgBid");


          if (!specMsg && biddingZone) {


             specMsg = document.createElement("div");


             specMsg.id = "encheresSpecMsgBid";


             specMsg.className = "spectator-msg";


             specMsg.style.marginTop = "20px";


             specMsg.style.fontSize = "1.2rem";


             specMsg.innerText = "Vous regardez la finale...";


             biddingZone.appendChild(specMsg);


          }


          if (specMsg) specMsg.style.display = "block";


      } else {


          bidInputBlock.style.display = "block";


          const msg = document.getElementById("encheresSpecMsgBid");


          if (msg) msg.style.display = "none";


      }


  }


  const bidInput = document.getElementById("encheresBidInput");


  if(bidInput && !isSpectator) {


      bidInput.value = "";


      bidInput.disabled = false;


      bidInput.focus();


  }


  const bidBtn = document.getElementById("encheresBidBtn");


  if(bidBtn) bidBtn.disabled = isSpectator;


  const timerNum = document.getElementById("encheresTimerNumber");


  const timerBar = document.getElementById("encheresTimerFill");


  if(timerNum) timerNum.textContent = "60";


  if(timerBar) {


      timerBar.classList.add("no-transition");


      timerBar.style.width = "100%";


      void timerBar.offsetWidth;


      timerBar.classList.remove("no-transition");


  }


  const overlay = document.getElementById("encheresWinnerOverlay");


  if (overlay) {


      overlay.classList.add("hidden");


      overlay.style.display = "none";


  }


});


// --- FONCTIONS RESTAURÃES (Timer + Affichage EnchÃ¨res) ---


socket.on("encheresTimerUpdate", ({ remaining, total }) => {


  const num = document.getElementById("encheresTimerNumber");


  const bar = document.getElementById("encheresTimerFill");


  if (num) num.textContent = remaining;


  if (bar) bar.style.width = (remaining / total) * 100 + "%";


  const numSetup = document.getElementById("encheresSetupTimerNumber");


  const barSetup = document.getElementById("encheresSetupTimerFill");


  if (numSetup) numSetup.textContent = remaining;


  if (barSetup) barSetup.style.width = (remaining / total) * 100 + "%";


  if (remaining <= 0) {


    sfxEnchere.stop();


  }


});


socket.on("encheresNewBid", (bid) => {


  // Lecture dynamique du son d'enchère si le serveur le demande


  if (bid.sound) {


    const sfxEnchereCalme = new Howl({


      src: [`sons/${bid.sound}`],


      volume: 0.5


    });


    sfxEnchereCalme.play();


  }


  const history = document.getElementById("encheresHistory");


  if (!history) return;


  const player = currentRoom.players.find((p) => p.playerId === bid.playerId);


  const pseudo = player ? player.pseudo : "???";


  // --- LOGIQUE DE COULEUR ROBUSTE (P1 vs P2) ---


  // On ne regarde que les joueurs VIVANTS (les 2 finalistes)


  const activePlayers = currentRoom.players


      .filter(p => !p.eliminated && !p.isSpectator)


      .sort((a, b) => a.playerId.localeCompare(b.playerId)); // Tri stable


  // Si je suis le premier de la liste des vivants -> P1 (Vert), sinon P2 (Violet)


  const isP1 = activePlayers.length > 0 && activePlayers[0].playerId === bid.playerId;


  // ---------------------------------------------


  const div = document.createElement("div");


  div.className = "enchere-item-list";


  div.classList.add(isP1 ? "enchere-fixed-p1" : "enchere-fixed-p2");


  const name = document.createElement("span");
  name.textContent = pseudo;
  const amount = document.createElement("span");
  amount.className = "enchere-val";
  amount.textContent = bid.amount;
  div.append(name, amount);


  history.prepend(div);


});


// NOUVEAU : Animation du vainqueur des enchÃ¨res


socket.on("encheresBidResult", (data) => {


    // 1. Son et Nettoyage visuel


    sfxAdjugeVendu.play();


    hideAllMiniGames(); // Cache le plateau des enchères


    if (scoreboard) scoreboard.classList.add("hidden"); // Cache les scores


    const biddingZone = document.getElementById("encheresBiddingZone");


    if (biddingZone) {


        biddingZone.style.display = "none"; 


        biddingZone.classList.add("hidden");


    }


    const overlay = document.getElementById("encheresWinnerOverlay");


    const nameEl = document.getElementById("encheresWinnerName");


    const bidEl = document.getElementById("encheresWinnerBid");


    const player = currentRoom.players.find(p => p.playerId === data.winnerId);


    const pseudo = player ? player.pseudo : "Inconnu";


    if(nameEl) nameEl.textContent = pseudo;


    if(bidEl) bidEl.textContent = data.amount;


    if(overlay) {


        overlay.classList.remove("hidden");


        overlay.style.display = "flex";


        overlay.style.animation = "fadeIn 0.5s ease-out";


    }


});


// 4. PHASE DE JEU (COLLECTE) - NOUVELLE INTERFACE


socket.on("encheresStartCollection", (data) => {


  // --- CORRECTIF AFFICHAGE ---


  const encheresGame = document.getElementById("encheresGameContainer");


  if (encheresGame) {


      encheresGame.classList.remove("hidden");


      encheresGame.style.display = "flex";


  }


  // ---------------------------


  const overlay = document.getElementById("encheresWinnerOverlay");


  if (overlay) {


      overlay.classList.add("hidden");


      overlay.style.display = "none";


  }


  document.getElementById("encheresPhaseTitle").textContent = "Phase : Jeu";


  const biddingZone = document.getElementById("encheresBiddingZone");


  if (biddingZone) {


      biddingZone.classList.add("hidden");


      biddingZone.style.display = "none";


  }


  const playingZone = document.getElementById("encheresPlayingZone");


  if (playingZone) {


      playingZone.classList.remove("hidden");


      playingZone.style.display = "flex";


  }


  // --- MISE A JOUR COMPTEUR INITIAL ---


  const targetDisplay = document.getElementById("encheresTargetDisplay");


  if (targetDisplay) {


      targetDisplay.dataset.target = data.target;


      targetDisplay.textContent = `Réponses : 0 / ${data.target}`;


      targetDisplay.style.color = "#ffcc00";


  }


  const listDiv = document.getElementById("encheresLiveAnswersList");


  if (listDiv) listDiv.innerHTML = "";


  const isMe = data.activePlayerId === playerId;


  const inputArea = document.getElementById("encheresPlayerInputArea");


  const specMsg = document.getElementById("encheresSpectatorMsg");


  if (isMe) {


    if(inputArea) inputArea.classList.remove("hidden");


    if(specMsg) specMsg.classList.add("hidden");


    const ansInput = document.getElementById("encheresAnswerInput");


    if (ansInput) {


      ansInput.value = "";


      ansInput.disabled = false;


      setTimeout(() => ansInput.focus(), 100);


    }


  } else {


    if(inputArea) inputArea.classList.add("hidden");


    if(specMsg) specMsg.classList.remove("hidden");


  }


});


// MISE A JOUR LISTE RÉPONSES ET COMPTEUR


socket.on("encheresLiveAnswerUpdate", (data) => {


  if (data.playSound) {


    sfxEnchereReponse.play();


  }


  const listDiv = document.getElementById("encheresLiveAnswersList");


  const inputArea = document.getElementById("encheresPlayerInputArea");


  const isMe = inputArea && !inputArea.classList.contains("hidden");


  if (listDiv) {


    const items = data.answers.map((txt, idx) => ({ txt, idx }));


    listDiv.innerHTML = items


      .reverse()


      .map((item) => {


          let html = `<div class="enchere-live-answer-row">`;


          html += `<div class="enchere-live-answer-item">${escapeHtmlText(item.txt)}</div>`;


          if (isMe) {


              html += `<button class="enchere-delete-btn" onclick="deleteEnchereAnswer(${item.idx})">X</button>`;


          }


          html += `</div>`;


          return html;


      })


      .join("");


  }


  const targetDisplay = document.getElementById("encheresTargetDisplay");


  if (targetDisplay) {


      const currentCount = data.answers.length;


      const target = parseInt(targetDisplay.dataset.target || "0");


      targetDisplay.textContent = `Réponses : ${currentCount} / ${target}`;


      if (currentCount >= target) {


          targetDisplay.style.color = "#2ecc71";


      } else {


          targetDisplay.style.color = "#ffcc00";


      }


      const input = document.getElementById("encheresAnswerInput");


      const btn = document.getElementById("encheresAnswerBtn");


      const maxLimit = target + 1;


      if (input && btn) {


          if (currentCount >= maxLimit) {


              input.disabled = true;


              input.placeholder = "Limite atteinte !";


              btn.disabled = true;


              btn.style.opacity = "0.5";


          } else {


              input.disabled = false;


              input.placeholder = "Votre réponse...";


              btn.disabled = false;


              btn.style.opacity = "1";


              if (isMe && document.activeElement !== input) input.focus();


          }


      }


  }


});


window.deleteEnchereAnswer = function(index) {


    socket.emit("encheresDeleteAnswer", index);


};


// FIN DE PARTIE : VICTOIRE ENCHERES


socket.on("encheresVictory", (data) => {


    sfxEnchereChampion.play();


    hideAllMiniGames();


    const overlay = document.getElementById("encheresResultOverlay");


    const nameEl = document.getElementById("encheresVictorName");


    if (nameEl) nameEl.textContent = data.winnerPseudo;


    if (overlay) {


        overlay.classList.remove("hidden");


        overlay.style.display = "flex";


        overlay.style.animation = "fadeIn 0.8s ease-out";


    }


});


// 5. CORRECTION


socket.on("encheresStartCorrection", (data) => {


  hideAllMiniGames();


  if (encheresGame) encheresGame.classList.add("hidden");


  if (encheresCorrection) encheresCorrection.classList.remove("hidden");


  document.getElementById("encheresTargetScore").textContent = data.target || 0;


  renderEncheresCorrectionList(data.answers || [], []);


  const isHost = currentRoom && currentRoom.hostId === playerId;


  if (isHost) {


    document.getElementById("encheresCorrectionControls").classList.remove("hidden-controls");


    document.getElementById("encheresWaitCorrection").classList.add("hidden");


  } else {


    document.getElementById("encheresCorrectionControls").classList.add("hidden-controls");


    document.getElementById("encheresWaitCorrection").classList.remove("hidden");


  }


});


socket.on("encheresCorrectionRefresh", (data) => {


  // --- AJOUT SONORE ---


  if (data.soundToPlay !== undefined) {


    if (data.soundToPlay === 1) sfxCorrect1.play();


    else if (data.soundToPlay === 0) sfxCorrect0.play();


  }


  // --------------------


  renderEncheresCorrectionList(data.answers || [], data.status || []);


  const valids = (data.status || []).filter((s) => s === true).length;


  const errors = (data.status || []).filter((s) => s === false).length;


  document.getElementById("encheresCurrentValid").textContent = valids;


  document.getElementById("encheresCurrentErrors").textContent = errors;


});


function renderEncheresCorrectionList(answers, statuses) {


  const list = document.getElementById("encheresCorrectionList");


  if (!list) return;


  list.innerHTML = "";


  const isHost = currentRoom && currentRoom.hostId === playerId;


  answers.forEach((ans, idx) => {


    const stat = statuses[idx]; // true, false, ou null


    const row = document.createElement("div");


    // Bordure colorÃ©e selon le statut


    row.className =


      "enchere-corr-item " +


      (stat === true ? "valid" : stat === false ? "invalid" : "");


    let html = `<span class="enchere-corr-text">${escapeHtmlText(ans)}</span>`;


    // DÃ©finition des classes d'Ã©tat (AllumÃ© / Ã©teint)


    const activeTrue = stat === true ? "active" : "";


    const activeFalse = stat === false ? "active" : "";


    if (isHost) {


      // HÃTE : Boutons cliquables avec Ã©vÃ©nements


      html += `


        <button class="enchere-toggle-btn btn-ok ${activeTrue}" 


                onclick="socket.emit('encheresToggleCorrection', {index:${idx}, status:true})">VRAI</button>


        <button class="enchere-toggle-btn btn-ko ${activeFalse}" 


                onclick="socket.emit('encheresToggleCorrection', {index:${idx}, status:false})">FAUX</button>


      `;


    } else {


      // SPECTATEURS : Boutons visibles mais inertes (visuel uniquement)


      html += `


        <button class="enchere-toggle-btn btn-ok ${activeTrue}" 


                style="cursor: default; pointer-events: none;">VRAI</button>


        <button class="enchere-toggle-btn btn-ko ${activeFalse}" 


                style="cursor: default; pointer-events: none;">FAUX</button>


      `;


    }


    row.innerHTML = html;


    list.appendChild(row);


  });


}


const btnBid = document.getElementById("encheresBidBtn");


const inputBid = document.getElementById("encheresBidInput");


function sendBid() {


    if (!inputBid) return;


    const val = inputBid.value;


    if (val) {


        socket.emit("encheresPlaceBid", val);


        inputBid.value = "";


        inputBid.focus();


    }


}


if (btnBid) btnBid.onclick = sendBid;


if (inputBid) {


    inputBid.addEventListener("keypress", (e) => {


        if (e.key === "Enter") sendBid();


    });


}


const btnAns = document.getElementById("encheresAnswerBtn");


const inputAns = document.getElementById("encheresAnswerInput");


function sendGameAnswer() {


    if (!inputAns) return;


    if (inputAns.value) {


      socket.emit("encheresSendAnswer", inputAns.value);


      inputAns.value = "";


      inputAns.focus();


    }


}


if (btnAns) btnAns.onclick = sendGameAnswer;


if (inputAns) {


    inputAns.addEventListener("keypress", (e) => {


        if (e.key === "Enter") sendGameAnswer();


    });


}


const btnValidGame = document.getElementById("encheresValidateGameBtn");


if (btnValidGame) {


  btnValidGame.onclick = () => {


    socket.emit("encheresFinalizeGame");


  };


}


socket.on("playerEliminated", (data) => {
  if (currentRoom?.gameMode === "liste") return;
  // 1. Suppression de l'alerte pour le joueur concerné (éliminé ou sortant)
  if (data.playerId === playerId) {
      return; 
  }

  // 2. Filtrage de la notification rouge pour les autres joueurs
  const isAbandon = data.reason && data.reason.includes("Abandon");

  if (isAbandon) {
      const notif = document.createElement("div");
      notif.style.position = "fixed";
      notif.style.top = "20px";
      notif.style.left = "50%";
      notif.style.transform = "translateX(-50%)";
      notif.style.background = "rgba(255, 0, 0, 0.9)";
      notif.style.color = "white";
      notif.style.padding = "20px";
      notif.style.borderRadius = "10px";
      notif.style.zIndex = "10000";
      notif.style.fontWeight = "bold";
      notif.style.fontSize = "1.5rem";
      
      // Message affiché uniquement en cas de départ volontaire
      notif.innerText = `DISQUALIFICATION : ${data.pseudo} a quitté la partie !`;

      document.body.appendChild(notif);
      setTimeout(() => notif.remove(), 4000);
  }
});


socket.on("encheresCountdown", () => {


  // 1. Son


  sfxEnchereReady.play();


  // 2. On cache tout le reste (le board, les jeux, etc.)


  hideAllMiniGames();


  if (scoreboard) scoreboard.classList.add("hidden");


  // 3. On masque l'overlay du vainqueur proprement (avec display: none pour éviter les conflits)


  const winnerOverlay = document.getElementById("encheresWinnerOverlay");


  if (winnerOverlay) {


    winnerOverlay.classList.add("hidden");


    winnerOverlay.style.display = "none"; // FORCE LE MASQUAGE


  }


  const overlay = document.getElementById("palierOverlay");


  const textEl = document.getElementById("palierOverlayText");


  if (overlay && textEl) {


    textEl.style.animation = "none";


    textEl.style.fontSize = "8rem";


    textEl.style.color = "#ffcc00";


    overlay.classList.remove("hidden");


    let count = 3;


    textEl.textContent = count;


    const interval = setInterval(() => {


      count--;


      if (count > 0) {


        textEl.textContent = count;


        textEl.style.transform = "scale(1.2)";


        setTimeout(() => textEl.style.transform = "scale(1)", 100);


      } else {


        clearInterval(interval);


        textEl.textContent = "GO !";


      }


    }, 1000);


    setTimeout(() => {


      overlay.classList.add("hidden");


      textEl.style.animation = "";


      textEl.style.transform = "";


      textEl.style.fontSize = "";


    }, 3500);


  }


});


// ===============================


//   LOGIQUE DE RECONNEXION AUTO


// ===============================


// 1. Au chargement de la page (F5)


window.addEventListener("load", () => {


  const savedRoom = localStorage.getItem("lqs_room_code");


  const savedPseudo = localStorage.getItem("lqs_pseudo");


  if (savedRoom && savedPseudo && !currentRoom) {


    console.log("Tentative de reconnexion auto (Refresh)...");


    socket.emit("joinRoom", {


      pseudo: savedPseudo,


      roomCode: savedRoom,


      playerId: playerId,
      reconnectSecret: getReconnectSecret(savedRoom)


    });


  }


});


// 2. A la reconnexion du socket (Sortie de veille mobile / Micro-coupure)


socket.on("connect", () => {


  const savedRoom = localStorage.getItem("lqs_room_code");


  const savedPseudo = localStorage.getItem("lqs_pseudo");


  if (savedRoom && savedPseudo) {


    console.log("Tentative de reconnexion auto (Socket connect)...");


    socket.emit("joinRoom", {


      pseudo: savedPseudo,


      roomCode: savedRoom,


      playerId: playerId,
      reconnectSecret: getReconnectSecret(savedRoom)


    });


  }


});


// --- GESTION FENÊTRE LISTE DES JOUEURS ---


const showPlayersBtn = document.getElementById("showPlayersBtn");


const playersListOverlay = document.getElementById("playersListOverlay");


const closePlayersBtn = document.getElementById("closePlayersBtn");


const modalPlayersList = document.getElementById("modalPlayersList");


if (showPlayersBtn) {


  showPlayersBtn.addEventListener("click", () => {


    if (!playersListOverlay || !modalPlayersList || !currentRoom) return;


    modalPlayersList.innerHTML = "";


    currentRoom.players.forEach((p) => {


      const li = document.createElement("li");


      li.className = "modal-player-item";
      if (currentRoom.gameMode === "liste") {
        li.style.flexWrap = "wrap";
        li.style.gap = "8px";
        li.style.overflowWrap = "anywhere";
      }


      const isOnline = p.isConnected;


      const statusColorClass = isOnline ? "online" : "offline";


      const statusText = isListePlayerInactive(p)
        ? (p.withdrawn ? "Retiré du tournoi" : "Hors tournoi")
        : (isOnline ? "Connecté" : (currentRoom.gameMode === "liste" ? "Déconnecté temporairement" : "Déconnecté"));


      let extraInfo = "";


      if (isListePlayerInactive(p)) extraInfo = "";
      else if (p.eliminated) extraInfo = " <span style='color:#e74c3c; font-size:0.8em; margin-left:5px;'>(Éliminé)</span>";


      else if (p.isSpectator) extraInfo = " <span style='color:#aaa; font-size:0.8em; margin-left:5px;'>(Spectateur)</span>";


      if (p.playerId === currentRoom.hostId) extraInfo += " <span style='color:#ffcc00; font-size:0.8em; margin-left:5px;'>★ Hôte</span>";


      li.innerHTML = `


        <div style="text-align:left;">


          <span style="font-weight:bold;">${escapeHtmlText(p.pseudo)}</span>${extraInfo}


        </div>


        <div style="display:flex; align-items:center;">


          <span class="status-dot ${statusColorClass}"></span>


          <span style="font-size:0.85rem; opacity:0.7;">${statusText}</span>


        </div>


      `;


      modalPlayersList.appendChild(li);


    });


    playersListOverlay.classList.remove("hidden");


    playersListOverlay.style.display = "flex";


  });


}


if (closePlayersBtn) {


  closePlayersBtn.addEventListener("click", () => {


    if (playersListOverlay) {


      playersListOverlay.classList.add("hidden");


      playersListOverlay.style.display = "none";


    }


  });


}


// ===============================


//      LISEUSE D'IMAGE (FINAL)


// ===============================


// 1. Définition des fonctions en GLOBAL (window) pour accès HTML garanti


window.openImageViewer = function(src) {


  const viewer = document.getElementById("imageViewer");


  const content = document.getElementById("imageViewerContent");


  // On ouvre même si le src semble bizarre, le navigateur gérera l'affichage


  if (viewer && content && src) {


      console.log("Ouverture liseuse :", src); // Debug dans la console


      content.src = src;


      viewer.classList.remove("hidden");


  }


};


window.closeImageViewer = function() {


  const viewer = document.getElementById("imageViewer");


  const content = document.getElementById("imageViewerContent");


  if (viewer) {


      viewer.classList.add("hidden");


      // Petit délai pour nettoyer l'image


      setTimeout(() => { 


        if(content) content.src = ""; 


      }, 200);


  }


};


// 2. Initialisation forcée sur les images


// On attend un tout petit peu que le DOM soit stable


setTimeout(() => {


    const zoomIds = [


      "qsjMainImage", "lboMainImage", "tdmMainImage", "corrImgQuestion", "corrImgAnswer"


    ];


    zoomIds.forEach(id => {


        const el = document.getElementById(id);


        if (el) {


            // Style curseur


            el.style.cursor = "zoom-in";


            // Événement direct : écrase tout autre listener potentiel


            el.onclick = function(e) {


                // Empêche le clic de traverser l'image ou de déclencher autre chose


                e.preventDefault();


                e.stopPropagation();


                // Appel de la fonction globale


                window.openImageViewer(this.src);


            };


        }


    });


}, 500);


// 3. Fermeture avec la touche Echap


document.addEventListener("keydown", (e) => {


  if (e.key === "Escape") {


      window.closeImageViewer();


  }


});

/**
 * Affiche l'animation du joueur éliminé avec le message "EST À TERRE" et déclenche le son.
 */
function runEliminationSequence(players, onFinish, options = {}) {
    const isCurrent = options.isCurrent || (() => true);
    const elapsedMs = Math.max(0, Number(options.elapsedMs) || 0);
    if (!isCurrent()) return;
    if (currentRoom?.gameMode === "liste") {
        if (onFinish) onFinish();
        return;
    }
    if (!players || players.length === 0) {
        if (onFinish) onFinish();
        return;
    }
    if (elapsedMs >= 3500) {
        if (onFinish) onFinish();
        return;
    }

    // 1. Identification du perdant (dernier du classement)
    const sorted = [...players].sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return (parseFloat(b.time) || 0) - (parseFloat(a.time) || 0);
    });
    const loser = sorted[0];

    // 2. Déclenchement du son (Logique identique aux annonces de thèmes)
    if (typeof sfxElimination !== 'undefined' && elapsedMs < 300) {
        sfxElimination.play();
    }

    // 3. Configuration de l'overlay visuel
    const overlay = document.getElementById("palierOverlay");
    const textEl = document.getElementById("palierOverlayText");
    
    if (overlay && textEl) {
        // 1. Animation : On utilise palierStay (0% -> 100%) pour que le texte RESTE fixe
        textEl.style.animation = "palierStay 0.6s ease-out forwards";

        // 2. Style visuel identique aux thèmes (Palier 1, 2, etc.)
        textEl.style.color = "#ffcc00"; // Jaune thématique
        textEl.style.textShadow = "0 0 16px rgba(255, 255, 0, 0.8)"; // Halo lumineux
        textEl.style.webkitTextStroke = "0px"; // On retire le contour noir pour l'effet néon
        
        // Taille fluide adaptée au mobile (clamp)
        textEl.style.fontSize = "clamp(2.5rem, 8vw, 5rem)";
        textEl.style.fontWeight = "900";
        
        // 3. Texte : Pseudo + EST À TERRE
        textEl.textContent = loser.nickname;
        textEl.appendChild(document.createElement("br"));
        const eliminationLabel = document.createElement("span");
        eliminationLabel.style.fontSize = "0.8em";
        eliminationLabel.textContent = "EST À TERRE";
        textEl.appendChild(eliminationLabel);
        
        overlay.classList.remove("hidden");

        // 4. On laisse le message affiché pendant 3.5s avant de passer à la suite
        setTimeout(() => {
            if (!isCurrent()) return;
            overlay.classList.add("hidden");
            
            // RESET des styles pour ne pas impacter les prochains affichages de thèmes
            textEl.style.animation = ""; 
            textEl.style.color = "";
            textEl.style.textShadow = "";
            textEl.style.webkitTextStroke = "";
            textEl.style.fontSize = "";
            
            if (onFinish) onFinish();
        }, Math.max(0, 3500 - elapsedMs));
    } else {
        if (onFinish) onFinish();
    }
}


// ===============================


//       ANIMATION INTRO


// ===============================


const animLayer = document.getElementById('animation-layer');

let listeIntroImages = null;
let listeIntroSound = null;
let listeIntroShrineSound = null;
let listeIntroPlayback = null;

function isCurrentListeIntroPlayback(playback) {
    return listeIntroPlayback === playback && currentRoom?.roomCode === playback.roomCode &&
        currentGameState.phase === "listeIntro" && currentRoom?.gameMode === "liste" &&
        currentRoom?.listeTournament?.tournamentId === playback.tournamentId;
}

function createListeIntroSound(url, startMs, endMs, idKey, startedKey, stopAtNaturalEnd = false) {
    return new Howl({
        src: [url], preload: true, volume: 1, loop: false,
        onplay(id) {
            const playback = listeIntroPlayback;
            const elapsed = playback && playback.anchorElapsed + performance.now() - playback.anchorNow;
            if (playback && playback[idKey] === id && isCurrentListeIntroPlayback(playback) &&
                elapsed >= startMs && elapsed < endMs &&
                (!stopAtNaturalEnd || !this.duration() || elapsed - startMs < this.duration() * 1000)) {
                this.seek(Math.max(0, (elapsed - startMs) / 1000), id);
            } else {
                this.stop(id);
            }
        },
        onloaderror(_id, error) { console.warn("Son intro Liste indisponible", error); },
        onplayerror(id, error) {
            console.warn("Son intro Liste bloqué", error);
            const playback = listeIntroPlayback;
            if (!playback || playback[idKey] !== id || !isCurrentListeIntroPlayback(playback)) return;
            this.once("unlock", () => {
                if (!isCurrentListeIntroPlayback(playback) || playback[idKey] !== id) return;
                this.stop(id);
                playback[idKey] = null;
                const elapsed = playback.anchorElapsed + performance.now() - playback.anchorNow;
                if (elapsed >= startMs && elapsed < endMs) {
                    playback[startedKey] = false;
                    renderListeIntro(playback);
                }
            });
        }
    });
}

function preloadListeIntro() {
    if (!listeIntroImages) {
        listeIntroImages = ListeIntroTimeline.frameUrls.map((url) => {
            const image = new Image();
            image.src = url;
            return image;
        });
    }
    if (!listeIntroSound && typeof Howl === "function") {
        listeIntroSound = createListeIntroSound(ListeIntroTimeline.audioUrl,
            ListeIntroTimeline.audioStartMs, ListeIntroTimeline.audioEndMs, "audioId", "audioStarted");
    }
    if (!listeIntroShrineSound && typeof Howl === "function") {
        listeIntroShrineSound = createListeIntroSound(ListeIntroTimeline.shrineUrl,
            ListeIntroTimeline.shrineStartMs, ListeIntroTimeline.durationMs,
            "shrineId", "shrineStarted", true);
    }
}

function stopListeIntro() {
    const playback = listeIntroPlayback;
    if (!playback) return;
    listeIntroPlayback = null;
    if (playback.timer) clearTimeout(playback.timer);
    if (playback.rafId != null) cancelAnimationFrame(playback.rafId);
    if (playback.audioId != null) listeIntroSound?.stop(playback.audioId);
    if (playback.shrineId != null) listeIntroShrineSound?.stop(playback.shrineId);
    playback.image.style.transform = "";
    playback.overlay.remove();
}

function renderListeIntro(playback) {
    if (!isCurrentListeIntroPlayback(playback)) return;
    if (playback.timer) clearTimeout(playback.timer);
    playback.timer = null;
    if (playback.rafId != null) cancelAnimationFrame(playback.rafId);
    playback.rafId = null;
    const elapsed = Math.max(0, playback.anchorElapsed + performance.now() - playback.anchorNow);
    const { frame, nextMs, scale, offsetXPercent, opacity, animating } = ListeIntroTimeline.position(elapsed);
    if (playback.audioId != null && elapsed >= ListeIntroTimeline.audioEndMs) {
        listeIntroSound?.stop(playback.audioId);
        playback.audioId = null;
    }
    if (playback.shrineId != null && elapsed >= ListeIntroTimeline.durationMs) {
        listeIntroShrineSound?.stop(playback.shrineId);
        playback.shrineId = null;
    }
    if (frame < 0) {
        playback.image.hidden = true;
    } else {
        const url = ListeIntroTimeline.frameUrls[frame];
        if (playback.image.src !== new URL(url, location.href).href) playback.image.src = url;
        playback.image.hidden = false;
        playback.image.style.transform = frame === 0
            ? `translateX(${offsetXPercent}%) scale(${scale})` : `scale(${scale})`;
        playback.image.style.opacity = String(opacity);
        if (!playback.audioStarted && listeIntroSound &&
            elapsed >= ListeIntroTimeline.audioStartMs && elapsed < ListeIntroTimeline.audioEndMs) {
            playback.audioStarted = true;
            try {
                playback.audioId = listeIntroSound.play();
                if (playback.audioId != null) {
                    listeIntroSound.seek(Math.max(0, (elapsed - ListeIntroTimeline.audioStartMs) / 1000), playback.audioId);
                }
            } catch (error) {
                console.warn("Son intro Liste bloqué", error);
            }
        }
        if (!playback.shrineStarted && listeIntroShrineSound &&
            elapsed >= ListeIntroTimeline.shrineStartMs && elapsed < ListeIntroTimeline.durationMs) {
            playback.shrineStarted = true;
            const shrineDurationMs = listeIntroShrineSound.duration() * 1000;
            if (!shrineDurationMs || elapsed - ListeIntroTimeline.shrineStartMs < shrineDurationMs) {
                try {
                    playback.shrineId = listeIntroShrineSound.play();
                    if (playback.shrineId != null) {
                        listeIntroShrineSound.seek(Math.max(0,
                            (elapsed - ListeIntroTimeline.shrineStartMs) / 1000), playback.shrineId);
                    }
                } catch (error) {
                    console.warn("Son intro Liste bloqué", error);
                }
            }
        }
    }
    if (animating) {
        playback.rafId = requestAnimationFrame(() => {
            playback.rafId = null;
            renderListeIntro(playback);
        });
    }
    if (nextMs !== null) {
        playback.timer = setTimeout(() => renderListeIntro(playback), Math.max(1, nextMs - elapsed));
    }
}

function syncListeIntro(gs) {
    const info = gs.listeIntro;
    const roomCode = currentRoom?.roomCode;
    if (!info || info.gameMode !== "liste" || !roomCode ||
        info.tournamentId !== currentRoom?.listeTournament?.tournamentId ||
        !Number.isFinite(info.elapsedMs)) {
        stopListeIntro();
        return;
    }
    const key = `${roomCode}:${info.tournamentId}`;
    if (listeIntroPlayback?.key !== key) {
        stopListeIntro();
        preloadListeIntro();
        const overlay = document.createElement("div");
        overlay.className = "liste-intro-overlay";
        overlay.setAttribute("aria-label", "Introduction du tournoi Liste");
        const image = document.createElement("img");
        image.className = "liste-intro-frame";
        image.alt = "";
        image.hidden = true;
        overlay.appendChild(image);
        document.body.appendChild(overlay);
        listeIntroPlayback = {
            key, roomCode, tournamentId: info.tournamentId, overlay, image,
            audioId: null, audioStarted: false, shrineId: null, shrineStarted: false,
            timer: null, rafId: null,
            anchorElapsed: 0, anchorNow: 0
        };
    }
    listeIntroPlayback.anchorElapsed = info.elapsedMs;
    listeIntroPlayback.anchorNow = performance.now();
    renderListeIntro(listeIntroPlayback);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && listeIntroPlayback) {
        renderListeIntro(listeIntroPlayback);
        if (listeIntroPlayback?.audioId != null) {
            const elapsed = listeIntroPlayback.anchorElapsed + performance.now() - listeIntroPlayback.anchorNow;
            if (elapsed < ListeIntroTimeline.audioEndMs) {
                listeIntroSound?.seek(Math.max(0, (elapsed - ListeIntroTimeline.audioStartMs) / 1000),
                    listeIntroPlayback.audioId);
            }
        }
        if (listeIntroPlayback?.shrineId != null) {
            const elapsed = listeIntroPlayback.anchorElapsed + performance.now() - listeIntroPlayback.anchorNow;
            const shrineDurationMs = listeIntroShrineSound?.duration() * 1000;
            if (elapsed < ListeIntroTimeline.durationMs &&
                (!shrineDurationMs || elapsed - ListeIntroTimeline.shrineStartMs < shrineDurationMs)) {
                listeIntroShrineSound?.seek(Math.max(0,
                    (elapsed - ListeIntroTimeline.shrineStartMs) / 1000), listeIntroPlayback.shrineId);
            }
        }
    }
});


function clearIntroLayer() {


    if (animLayer) animLayer.innerHTML = '';


}


// Utilitaires Animation


const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));


function typeText(text, element, speed = 30) {


    return new Promise(resolve => {


        let i = 0;


        element.classList.add("cursor");


        function type() {


            if (i < text.length) {


                element.append(document.createTextNode(text.charAt(i)));


                i++;


                setTimeout(type, speed);


            } else {


                element.classList.remove("cursor");


                resolve();


            }


        }


        type();


    });


}


function playAudioAndWaitEnd(audioObj) {


    return new Promise(resolve => {


        audioObj.onended = resolve;


        audioObj.onerror = resolve; 


        audioObj.currentTime = 0;


        audioObj.play().catch(e => { console.warn(e); resolve(); });


    });


}


// FONCTION PRINCIPALE DE L'ANIMATION


async function runGameIntro(playerCount) {


    clearIntroLayer();


    // Calcul dynamique : Nb Jeux = Joueurs - 1 (min 1)


    const gamesCount = Math.max(1, playerCount - 1); 


    // Phase 1 : Visuel


    const introBg = document.createElement('div');


    introBg.className = 'intro-container';


    animLayer.appendChild(introBg);


    await wait(1000); 


    const charDiv = document.createElement('div');


    charDiv.className = 'char-common intro-div';


    charDiv.style.backgroundImage = "url('intro_1.png')";


    introBg.appendChild(charDiv);


    sfxLumiere.play();
    await wait(1000); // (Durée approx du son ou ajustée)


    await wait(1000);


    sfxPas.play();


    await wait(3200); 


    charDiv.style.backgroundImage = "url('intro_2.png')";


    await wait(500);


    charDiv.style.backgroundImage = "url('intro_3.png')";


    sfxDbz.play();


    await wait(2000);


    // Phase 2 : Dialogue


    charDiv.style.backgroundImage = ''; 


    charDiv.className = 'char-common host-character paused';


    const box = document.createElement('div');


    box.className = 'dialogue-box';


    const textSpan = document.createElement('span');


    textSpan.className = 'dialogue-text';


    box.appendChild(textSpan);


    introBg.appendChild(box);


    async function sayPhrase(text) {


        sfxText.stop();
        const id = sfxText.play();


        charDiv.classList.remove('paused'); 


        await typeText(text, textSpan, 30);


        sfxText.stop(id); // Ou sfxText.pause(id);


        charDiv.classList.add('paused');


        await wait(1000);


    }


    function addLineBreak() { textSpan.appendChild(document.createElement("br")); }


    textSpan.innerHTML = ""; 


    await sayPhrase("Bonjour et bienvenue dans The Last Quiz Standing.");


    addLineBreak();


    // Texte dynamique


    await sayPhrase(`Vous êtes ${playerCount} joueurs, vous allez donc vous affronter dans ${gamesCount} mini-jeux.`);


    addLineBreak();


    await sayPhrase("Les mini-jeux sont tirés au sort entre chaque épreuve.");


    await wait(1500);


    textSpan.innerHTML = ""; 


    await sayPhrase("Qui saura tirer son épingle du jeu ?");


    addLineBreak();


    await sayPhrase("Qui craquera face à la pression ?");


    addLineBreak();


    await sayPhrase("Il est temps de le découvrir !!");


    // Phase 3 : Final


    charDiv.classList.remove('paused');


    charDiv.classList.add('shouting'); 


    sfxRumble.play();


    textSpan.innerHTML = ""; 


    textSpan.style.cssText = "font-size: 2rem; color: #c0392b; font-weight: bold; line-height: 1.2;";


    introBg.style.transform = "scale(1.02)";


    setTimeout(() => introBg.style.transform = "scale(1)", 100);


    await typeText("LET'S GET READY TO RUMBLE !!!", textSpan, 40);


    await wait(4500); 


    sfxDbz.stop();


    sfxRumble.stop();


}



// ===============================
//    ANIMATION VICTOIRE FINALE
// ===============================
//    ANIMATION VICTOIRE FINALE
// ===============================
//    ANIMATION VICTOIRE FINALE
// ===============================
//    ANIMATION VICTOIRE FINALE
// ===============================
//    ANIMATION VICTOIRE FINALE (VERSION ROBUSTE)
// ===============================
//    ANIMATION VICTOIRE (CORRECTIF DIV vs H1)
// ===============================
//    ANIMATION VICTOIRE (FINAL : MOBILE + DIV FIX)
// ===============================
function runGlobalVictoryAnim(winnerName) {
    const safeWinner = winnerName || "Un joueur";
    console.log("🏆 VICTOIRE : ", safeWinner);

    // 1. Nettoyage préventif
    const prev = runGlobalVictoryAnim._state;
    if (prev) {
        prev.stop = true;
        try { if (prev.rafId) cancelAnimationFrame(prev.rafId); } catch (e) {}

        // CORRECTION HOWLER : On arrête le son Howl proprement
        if (sfxVictoire) sfxVictoire.stop();

        const oldOverlay = document.querySelector('.victory-overlay');
        if (oldOverlay) oldOverlay.remove();
    }

    const state = { stop: false, rafId: null }; // Plus besoin de stocker 'audio' ici pour Howler
    runGlobalVictoryAnim._state = state;

    // 2. Cacher l'interface du jeu
    hideAllMiniGames();
    if (typeof scoreboard !== 'undefined' && scoreboard) scoreboard.classList.add("hidden");
    
    // Bouton Quitter : visible et accessible au doigt
    if (globalControls) {
        globalControls.classList.remove("hidden");
        globalControls.style.display = "flex";
        globalControls.style.zIndex = "200005"; 
    }

    // 3. Création Overlay (Fond Noir)
    const overlay = document.createElement('div');
    overlay.className = 'victory-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'black', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', zIndex: '200000',
        padding: '20px',
        boxSizing: 'border-box',
        overflow: 'hidden'
    });

    // 4. LE TEXTE (DIV pour éviter le bug du H1 invisible)
    const victoryText = document.createElement('div'); 
    victoryText.innerText = `${safeWinner}\nremporte la partie !`;
    
    Object.assign(victoryText.style, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 'clamp(1.8rem, 7vw, 5rem)',
        fontWeight: '900',
        color: '#FFD700',
        textAlign: 'center',
        lineHeight: '1.2',
        margin: '0 0 20px 0', 
        zIndex: '200002',
        textShadow: '0 0 20px rgba(255, 215, 0, 0.8)',
        whiteSpace: 'pre-wrap',
        maxWidth: '100%',
        wordBreak: 'break-word',
        transform: 'scale(1)', 
        opacity: '0' 
    });
    
    overlay.appendChild(victoryText); 

    // 5. L'IMAGE (Ajustée Mobile)
    const img = document.createElement('img');
    img.src = 'animateur.png';
    Object.assign(img.style, {
        maxWidth: '90%', 
        maxHeight: '40vh',
        objectFit: 'contain',
        zIndex: '200001', opacity: '0', transform: 'translateY(50px)'
    });
    overlay.appendChild(img);

    document.body.appendChild(overlay);

    // 6. ANIMATIONS
    
    // A. Image
    img.animate([
        { opacity: 0, transform: 'translateY(50px)' },
        { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 600, fill: 'forwards', easing: 'ease-out' });

    // B. Texte (Pop In)
    const textAnim = victoryText.animate([
        { transform: 'scale(0.5)', opacity: 0 }, 
        { transform: 'scale(1.2)', opacity: 1, offset: 0.8 },
        { transform: 'scale(1)', opacity: 1 }
    ], { duration: 800, fill: 'forwards', easing: 'ease-out', delay: 200 });

    // C. Respiration
    textAnim.onfinish = () => {
        victoryText.style.opacity = '1';
        victoryText.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.05)' },
            { transform: 'scale(1)' }
        ], { duration: 2000, iterations: Infinity, easing: 'ease-in-out' });
    };

    // 7. Audio & Confettis (Optimisés Mobile)
    // CORRECTION HOWLER : On lance le son déclaré globalement
    // Comme l'utilisateur a déjà cliqué plein de fois avant d'arriver là,
    // Howler a déjà débloqué l'AudioContext. Ça marchera direct sur mobile.
    sfxVictoire.play();

    if (window.confetti) {
        const isMobile = window.innerWidth < 600;
        const particleCount = isMobile ? 80 : 150;
        const scalar = isMobile ? 0.8 : 1;

        window.confetti({ 
            particleCount: particleCount, 
            spread: 70, origin: { y: 0.6 }, zIndex: 200010,
            scalar: scalar 
        });

        const duration = 15000;
        const animationEnd = Date.now() + duration;
        (function frame() {
            if (state.stop) return;
            if (Date.now() > animationEnd) return;

            window.confetti({ 
                particleCount: isMobile ? 1 : 2, 
                angle: 60, spread: 55, origin: { x: 0 }, zIndex: 200010,
                scalar: scalar
            });
            window.confetti({ 
                particleCount: isMobile ? 1 : 2, 
                angle: 120, spread: 55, origin: { x: 1 }, zIndex: 200010,
                scalar: scalar
            });
            state.rafId = requestAnimationFrame(frame);
        }());
    }

    // REDIRECTION AUTOMATIQUE VERS LE LOBBY
    setTimeout(() => {
        // On recharge la page pour remettre le jeu à zéro proprement (retour accueil)
        window.location.reload();
    }, 18000); // 18 secondes (Animation 15s + 3s de délai)
}


// --- D?CLENCHEUR ANIMATION FINALE ---
socket.on("playFinaleAnimation", (data) => {
    runFinaleAnimation(data.player1, data.player2);
});

async function runFinaleAnimation(name1, name2) {
    const layer = document.getElementById('animation-layer');
    if (!layer) return;
    layer.innerHTML = '';
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Initialisation des sons via Howl (coh?rent avec votre setup)
    const sfxApparition = new Howl({ src: ['sons/apparition.mp3'], volume: 0.8 });
    const sfxSuspens = new Howl({ src: ['sons/suspens.mp3'], volume: 0.4 });
    const sfxTextYugi = new Howl({ src: ['sons/text.mp3'], volume: 0.5, loop: true });
    const sfxYugiFinal = new Howl({ src: ['sons/yu_gi.mp3'], volume: 1.0 });

    const bg = document.createElement('div');
    bg.className = 'yugi-intro-container'; layer.appendChild(bg); 
    
    // 1. IMAGE DOS
    const charDiv = document.createElement('div');
    charDiv.className = 'yugi-char'; charDiv.style.backgroundImage = "url('yu_gi.png')";
    bg.appendChild(charDiv); 
    sfxApparition.play();
    setTimeout(() => charDiv.classList.add('reveal'), 50);
    await wait(2000);

    // 2. IMAGE FACE
    charDiv.style.transition = "none";
    charDiv.style.backgroundImage = "url('yu_gi_0.png')";
    sfxSuspens.play();
    await wait(1500);

    // 3. DIALOGUE (Utilisation des classes yugi-)
    charDiv.style.backgroundImage = "url('yu_gi_sheet.png')";
    charDiv.style.backgroundSize = "200% 200%";
    charDiv.style.backgroundPosition = "0% 0%";

    const diaBox = document.createElement('div');
    diaBox.className = 'yugi-dialogue-box'; diaBox.style.marginTop = "20px"; 
    const textElem = document.createElement('div');
    textElem.className = 'yugi-dialogue-text'; diaBox.appendChild(textElem);
    bg.appendChild(diaBox); 
    setTimeout(() => diaBox.style.opacity = 1, 50);

    async function sayYugiLine(text) {
        sfxTextYugi.play();
        charDiv.classList.add('yugi-speaking');
        // Appel de votre fonction typeText existante en bas de client.js
        await typeText(text, textElem, 30);
        sfxTextYugi.stop();
        charDiv.classList.remove('yugi-speaking');
        charDiv.style.backgroundPosition = "0% 0%"; 
        await wait(1000);
    }

    textElem.innerHTML = "";
    await sayYugiLine(`${name1}, ${name2}, félicitations pour être parvenu jusqu'ici.`);
    textElem.appendChild(document.createElement("br"));
    await sayYugiLine("Vous avez su tout au long des différentes épreuves tirer votre épingle du jeu.");
    textElem.innerHTML = ""; 
    await sayYugiLine("Mais dans un battle royale il ne peut y avoir qu'un gagnant.");
    textElem.appendChild(document.createElement("br"));
    await sayYugiLine("Vous allez vous affronter dans une ultime épreuve.");
    textElem.appendChild(document.createElement("br"));
    await sayYugiLine("Etes-vous prêt ?");

    // 4. DUEL (Lancement de l'animation)
    await wait(500);
    sfxSuspens.stop();
    textElem.innerHTML = "";
    
    // On définit l'image mais ON NE FORCE PAS la position en JS ici 
    // pour laisser l'animation CSS prendre le contrôle total.
    charDiv.style.backgroundImage = "url('yu_gi_sheet_2.png')";
    charDiv.classList.add('yugi-final-move');
    
    sfxYugiFinal.play();
    textElem.style.textAlign = 'center';

    // Le script attend que le texte finisse de s'écrire. 
    // Pendant ce temps, l'animation CSS se fige sur la Frame 4 (forwards).
    await typeText("C'EST l'HEURE DU DUEEELLLL !!", textElem, 70);

    // 5. SEQUENCE FINALE 
    // Petit temps de pause (200ms) pour que l'œil lise la ponctuation finale
    await wait(200); 

    // Cette ligne supprime TOUT le contenu de 'bg' (Perso + Case de texte) 
    // Ils disparaissent donc exactement au même moment.
    bg.innerHTML = ''; 
    
    const light = document.createElement('img');
    light.src = 'lumiere.png'; 
    light.className = 'yugi-light-full';
    bg.appendChild(light);
    setTimeout(() => light.classList.add('active'), 10);
    
    await wait(500);
    const titre = document.createElement('img');
    titre.src = 'titres/les_encheres.png'; 
    titre.className = 'yugi-title-final';
    bg.appendChild(titre);
    setTimeout(() => titre.classList.add('zoom'), 50);

    await wait(3000); 
    layer.innerHTML = ''; 
}

