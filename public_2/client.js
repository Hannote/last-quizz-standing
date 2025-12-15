// client.js

// Tirage animation + écran de rÃ¨gles + systÃ¨me prÃªt/pas prÃªt

// + mini-jeu simple "Qui veut gagner des leugtas" (1 question locale)



const socket = io();

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
const sfx45s = new Howl({ src: ['sons/45s.mp3'], volume: 0.5 });
const sfx2min = new Howl({ src: ['sons/2min.mp3'], volume: 0.5 });
const sfxLeugtasQuestion = new Howl({ src: ['sons/question_leugta.mp3'], volume: 0.5 });
const sfxEnchereReady = new Howl({ src: ['sons/enchere_ready.mp3'], volume: 0.5 });

// Utilitaire pour savoir si je suis spectateur (éliminé ou spectateur pur)
function amISpectator() {
  if (!currentRoom) return false;
  const me = currentRoom.players.find((p) => p.playerId === playerId);
  return me && (me.eliminated || me.isSpectator);
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



// Liste locale de tous les mini-jeux (pour l'animation)

const ALL_MINI_GAMES = [

  "qui_suis_je",

  "blind_test",

  "le_tour_du_monde",

  "le_bon_ordre",

  "le_petit_bac",

  "qui_veut_gagner_des_leugtas",

  "le_faux_du_vrai",

  "les_encheres"

];



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

const lboMainImage = document.getElementById("lboMainImage");

const lboQuestion = document.getElementById("lboQuestion");

const lboTimerNumber = document.getElementById("lboTimerNumber");

const lboTimerFill = document.getElementById("lboTimerFill");

const lboQuestionNumber = document.getElementById("lboQuestionNumber");

const lboInput = document.getElementById("lboInput");

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

  if (socket) {

    // On envoie 'soundValue' pour dire au serveur quel son jouer
    socket.emit("hostGradePlayer", { points, soundValue: points });

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



// ===============================

//         FONCTIONS UI

// ===============================



function showScreen(screenName) {

  screenLobby.classList.remove("active");

  screenRoom.classList.remove("active");



  if (screenName === "lobby") {

    screenLobby.classList.add("active");

  } else if (screenName === "room") {

    screenRoom.classList.add("active");

  }



  if (globalControls) {

    if (screenName === "room") {

      globalControls.classList.remove("hidden");

    } else {

      globalControls.classList.add("hidden");

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

    qui_veut_gagner_des_leugtas: "Qui veut gagner des leugtas ?",

    le_faux_du_vrai: "Le faux du vrai",

    les_encheres: "Les enchères"

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

        "Des extraits audios tirés de la télévision ou de musiques vont être joués. " +

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

    default:

      return "Règles en cours d'écriture pour ce mini-jeu.";

  }

}



// ----- Animation tirage -----



function stopDrawAnimation() {

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
  stopDrawAnimation();

  if (mainDrawing) mainDrawing.classList.remove("hidden");
  // CORRECTIF : On cache explicitement les règles pour éviter le conflit
  if (mainRules) mainRules.classList.add("hidden");
  if (mainPlaying) mainPlaying.classList.add("hidden");

  if (!mainDrawing || !drawLogo || !drawGameLabel) return;

  const list = [...ALL_MINI_GAMES];
  let index = 0;

  drawAnimationInterval = setInterval(() => {
    const code = list[index % list.length];
    index++;
    drawLogo.src = miniGameCodeToLogoPath(code);
    drawGameLabel.textContent = miniGameCodeToLabel(code);
  }, 140);

  drawAnimationTimeout = setTimeout(() => {
    clearInterval(drawAnimationInterval);
    drawAnimationInterval = null;

    drawLogo.src = miniGameCodeToLogoPath(finalCode);
    drawGameLabel.textContent = miniGameCodeToLabel(finalCode);

    drawAnimationFinalTimeout = setTimeout(() => {
      if (isHost) {
        socket.emit("drawingFinished");
      }
    }, 1000);
  }, 2500);
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

  if (mainPlaying) mainPlaying.classList.add("hidden");

  

  // Cache les anciens jeux

  if (fauxVraiContainer) fauxVraiContainer.classList.add("hidden");

  if (leBonOrdreContainer) leBonOrdreContainer.classList.add("hidden");

  if (quiSuisJeContainer) quiSuisJeContainer.classList.add("hidden");

  if (tourMondeContainer) tourMondeContainer.classList.add("hidden");

  if (blindTestContainer) blindTestContainer.classList.add("hidden");

  if (petitBacContainer) petitBacContainer.classList.add("hidden");



  // Cache les corrections

  if (correctionContainer) correctionContainer.classList.add("hidden");

  const pbContainer = document.getElementById("petitBacCorrectionContainer");

  if (pbContainer) pbContainer.classList.add("hidden");



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



function showFauxVraiQuestion(data) {
  sfx40s.play(); // Remplacement : joue 40s
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
          socket.emit("fauxVraiAnswer", index);

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
  }
}
function showLeBonOrdreQuestion(data) {
  sfx45s.play(); // Utilise la nouvelle boucle 45s
  hideAllMiniGames();
  if (mainDefault) mainDefault.classList.add("hidden");
  if (mainDrawing) mainDrawing.classList.add("hidden");
  if (mainRules) mainRules.classList.add("hidden");
  if (mainPlaying) mainPlaying.classList.add("hidden");

  if (leBonOrdreContainer) leBonOrdreContainer.classList.remove("hidden");

  const isLboSpectator = amISpectator();

  if (lboInput) {
    lboInput.value = "";
    lboInput.disabled = isLboSpectator;
    lboInput.style.display = isLboSpectator ? "none" : "block";
    if (!isLboSpectator) {
      lboInput.focus();
      lboInput.removeAttribute("disabled");
    }
  }

  const btns = [lboValidateBtn, lboPassBtn];
  btns.forEach((btn) => {
    if (btn) {
      btn.style.display = isLboSpectator ? "none" : "inline-block";
      btn.disabled = isLboSpectator;
      if (!isLboSpectator) {
        btn.removeAttribute("disabled");
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        btn.style.filter = "none";
      }
    }
  });

  if (lboFeedback) {
    lboFeedback.textContent = isLboSpectator ? "Vous regardez la manche..." : "";
    lboFeedback.style.color = "";
  }

  if (lboQuestion) lboQuestion.textContent = data.question.question;
  if (lboMainImage) lboMainImage.src = data.question.image_question;
  if (lboQuestionNumber)
    lboQuestionNumber.textContent = `Question ${data.index} / ${data.total}`;

  if (lboTimerNumber) lboTimerNumber.textContent = "45";
  if (lboTimerFill) {
    lboTimerFill.style.width = "100%";
    lboTimerFill.style.background = "#ffcc00";
  }
if (!isLboSpectator) {
    if (lboInput) lboInput.disabled = true;
    if (lboValidateBtn) {
      lboValidateBtn.disabled = true;
      lboValidateBtn.classList.add("btn-locked-intro");
    }
  }
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
  if (mainDefault) mainDefault.classList.add("hidden");

  if (mainRules) mainRules.classList.add("hidden");

  if (mainDrawing) mainDrawing.classList.add("hidden");

  if (mainPlaying) mainPlaying.classList.add("hidden");

  hideAllMiniGames();



  if (palierOverlay && palierOverlayText) {
    sfxTheme.play();
    palierOverlayText.textContent = data.themeName || "Thème";

    palierOverlay.classList.remove("hidden");

    if (leBonOrdreContainer) leBonOrdreContainer.classList.add("hidden");



    setTimeout(() => {

      showLeBonOrdreQuestion(data);

      setTimeout(() => {

        palierOverlay.classList.add("hidden");

      }, 100);

    }, 1500);

  } else {

    showLeBonOrdreQuestion(data);

  }

});


socket.on("leBonOrdreTimerUpdate", ({ remaining, total }) => {
  if (!amISpectator()) {
    if (lboInput && lboInput.disabled && !lboInput.value.includes("JE PASSE")) {
      lboInput.disabled = false;
    }
    const btn = document.getElementById("lboValidateBtn");
    if (btn && btn.classList.contains("btn-locked-intro")) {
      btn.disabled = false;
      btn.classList.remove("btn-locked-intro");
      if (lboInput) lboInput.focus();
    }
  }

  if (!lboTimerNumber || !lboTimerFill) return;

  lboTimerNumber.textContent = remaining;

  const ratio = total ? remaining / total : 0;

  lboTimerFill.style.width = (ratio * 100) + "%";



  if (remaining <= 5) {

    lboTimerFill.style.background = "#ff3b30";

    lboTimerNumber.style.color = "#ff3b30";

  } else {

    lboTimerFill.style.background = "#ffcc00";

    lboTimerNumber.style.color = "white";

  }

  if (remaining <= 0) {
    sfx45s.stop();
  }

});


socket.on("leBonOrdreAnswerAck", () => {
  if (lboFeedback) {
    lboFeedback.textContent = "Réponse envoyée ! En attente des autres...";
    lboFeedback.style.color = "#2ecc71";
  }
  if (lboInput) lboInput.disabled = true;

  if (lboValidateBtn) {
    lboValidateBtn.disabled = true;
    lboValidateBtn.style.opacity = "0.5";
    lboValidateBtn.style.cursor = "default";
  }
  if (lboPassBtn) {
    lboPassBtn.disabled = true;
    lboPassBtn.style.opacity = "0.5";
    lboPassBtn.style.cursor = "default";
  }
});


socket.on("leBonOrdreEnd", () => {

  if (lboFeedback) lboFeedback.textContent = "Fin de la manche !";

});



socket.on("quiSuisJeQuestion", (data) => {
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

  if (qsjFeedback) qsjFeedback.textContent = "Fin du jeu !";

});



socket.on("leTourDuMondeQuestion", (data) => {

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



  if (palierOverlay && palierOverlayText) {
    sfxTheme.play();

    palierOverlayText.textContent = "Lettre " + data.letter;

    palierOverlay.classList.remove("hidden");

    setTimeout(() => {
      palierOverlay.classList.add("hidden");
      sfx2min.play(); // Relance le son longue durée après l'animation
    }, 2000);

  }

});



socket.on("petitBacTimerUpdate", ({ remaining, total }) => {

  if (pbTimerNumber) pbTimerNumber.textContent = remaining;

  if (pbTimerFill) pbTimerFill.style.width = (remaining / total) * 100 + "%";

  if (remaining <= 0) {
    sfx2min.stop();
  }

});



socket.on("petitBacAnswerAck", () => {

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

    pbFormZone.querySelectorAll("input").forEach((i) => (i.disabled = true));

  }

});



socket.on("petitBacEnd", () => {

  if (pbFeedback) {

    pbFeedback.textContent = "Manche terminée !";

    pbFeedback.style.color = "#ffcc00";

  }

  if (pbValidateBtn) pbValidateBtn.disabled = true;

});



if (lboValidateBtn) {

  lboValidateBtn.addEventListener("click", () => {
    if (
      lboValidateBtn.disabled ||
      lboValidateBtn.classList.contains("btn-locked-intro")
    )
      return;

    sfx45s.stop();

    sfxBubbleClick.play();

    const val = lboInput ? lboInput.value.trim() : "";

    if (!val) return;

    socket.emit("leBonOrdreAnswer", {

      roomCode: currentRoom.roomCode,

      answer: val

    });

  });

}



if (lboPassBtn) {

  lboPassBtn.addEventListener("click", () => {
    if (lboPassBtn.disabled) return;

    sfx45s.stop();

    sfxBubbleClick.play();

    socket.emit("leBonOrdreAnswer", {

      roomCode: currentRoom.roomCode,

      answer: "JE PASSE"

    });

    if (lboInput) lboInput.value = "JE PASSE";

  });

}



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

    socket.emit("quiSuisJeAnswer", {

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

    socket.emit("quiSuisJeAnswer", {

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

    socket.emit("leTourDuMondeAnswer", {

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

    socket.emit("leTourDuMondeAnswer", {

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

    socket.emit("blindTestAnswer", {

      roomCode: currentRoom.roomCode,

      answer: val

    });

  });

}



if (pbValidateBtn) {

  pbValidateBtn.addEventListener("click", () => {
    if (pbValidateBtn.disabled) return;

    sfx2min.stop();

    sfxBubbleClick.play();

    if (!currentRoom || !pbFormZone) return;

    const inputs = pbFormZone.querySelectorAll("input");

    const answers = {};

    inputs.forEach((inp, idx) => {

      answers[idx] = inp.value.trim();

    });

    socket.emit("petitBacAnswer", {

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

    socket.emit("blindTestAnswer", {

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

function handleInterimLeaderboard(players, callback, duration = 4000, customTitle = "Classement") {

  const overlay = document.getElementById("leaderboard-overlay");

  const content = document.getElementById("leaderboard-content");

  const titleEl = document.getElementById("leaderboardTitle");



    if (!overlay || !content) {

      if (callback) callback();

      return;

    }



  if (titleEl) {

    titleEl.textContent = customTitle;

  }



  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeA = parseFloat(a.time) || 0;
    const timeB = parseFloat(b.time) || 0;
    return timeA - timeB;
  });



    content.innerHTML = sorted

        .map((p, i) => {

          const color =

            i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "white";

          const timeDisplay =

            p.time !== undefined ? parseFloat(p.time).toFixed(1) + "s" : "";

          return `

            <div class="player-row ${i === 0 ? "rank-1" : ""}">

              <div class="rank-num" style="color:${color}">#${i + 1}</div>

              <div class="p-name">${p.nickname}</div>

              <div class="p-score">${p.score} pts</div>

              <div class="p-time">${timeDisplay}</div>

              <div class="p-meta"></div>

            </div>

          `;

        })

        .join("");



    overlay.classList.add("active");



    setTimeout(() => {

      overlay.classList.remove("active");

      if (callback) callback();

    }, duration);

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

        socket.emit("leugtasAnswer", {
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



function updateGameStateUI(gs) {

  const previousPhase = lastPhase;



  currentGameState = gs || currentGameState;

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
        const isSpectator = me && (me.eliminated || me.isSpectator);

        if (isSpectator) {
          readyBtn.disabled = true;
          readyBtn.textContent = "Mode Spectateur";
          readyBtn.classList.remove("btn-outline");
          readyBtn.style.opacity = "0.5";
          readyBtn.style.cursor = "default";

          if (iAmReady) {
            socket.emit("playerSetReady", { isReady: false });
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

        if (leBonOrdreContainer) leBonOrdreContainer.classList.remove("hidden");

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



function updateRoomUI(room) {

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



    if (!player.isConnected) {

      statusSpan.textContent = "déconnecté";

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



  if (sandboxControls) {

    const isHost = room.hostId === myId;

    sandboxControls.style.display = isHost ? "block" : "none";

  }



  setRoomError("");

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

  socket.emit("joinRoom", { pseudo, roomCode, playerId });

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

// 3. Clic sur "OUI" -> Exécute la déconnexion
if (confirmQuitBtn) {
  confirmQuitBtn.addEventListener("click", () => {
    if (quitConfirmOverlay) quitConfirmOverlay.classList.add("hidden");

    localStorage.removeItem("lqs_room_code");
    localStorage.removeItem("lqs_pseudo");

    socket.emit("leaveRoom");

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
  });
}

// clic sur "Je suis prÃªtÂ�e"

if (readyBtn) {

  readyBtn.addEventListener("click", () => {

    sfxReady.play();

    if (!currentRoom) return;

    const newReady = !iAmReady;

    socket.emit("playerSetReady", { isReady: newReady });

  });

}



// L'hÃ´te lance la partie

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

  updateGameStateUI(gs);

});

socket.on("gameOver", (data) => {
  // 1. On cache tous les mini-jeux en cours pour nettoyer l'écran
  hideAllMiniGames();
  
  // 2. On utilise l'overlay de résultat des enchères car il est générique (Victoire)
  const overlay = document.getElementById("encheresResultOverlay");
  
  // Mise à jour des textes
  const nameEl = document.getElementById("encheresVictorName");
  const reasonEl = overlay ? overlay.querySelector("div:last-child") : null; // Le sous-texte
  
  if (nameEl) nameEl.textContent = data.winner;
  
  // --- MODIFICATION ICI ---
  if (reasonEl) reasonEl.textContent = "remporte les enchères !"; 
  // ------------------------
  
  // Affichage de l'overlay avec animation
  if (overlay) {
      overlay.classList.remove("hidden");
      overlay.style.display = "flex";
      overlay.style.animation = "fadeIn 0.8s ease-out";
  }
  
  console.log("Victoire par forfait. Vainqueur : " + data.winner);
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

  // Masquage immédiat du jeu
  hideAllMiniGames();
  if (mainPlaying) mainPlaying.classList.add("hidden");

  if (!leugtasEndOverlay) return;
  leugtasEndOverlay.classList.remove("hidden");

  setTimeout(() => {
    leugtasEndOverlay.classList.add("hidden");
  }, 3500);
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

    data.players

      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (parseFloat(a.time) || 0) - (parseFloat(b.time) || 0);
      })

      .forEach((p) => {

        const line = document.createElement("div");

        line.textContent = p.nickname + " : " + p.score + " point(s)";

        scoreboard.appendChild(line);

      });

  }

});



socket.on("leugtasReveal", (data) => {
  if (!currentRoom) return;

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
    if (!currentRoom) return;

    const duration = isLastQuestion ? 4500 : 999999;
    const title = isLastQuestion ? "CLASSEMENT FINAL" : "CLASSEMENT";

    handleInterimLeaderboard(
      currentPlayersData,
      () => {
        if (!skipAnimation) resetTimerBarVisuals();
      },
      duration,
      title
    );

    setTimeout(() => {
      if (!currentRoom) return;
      if (!isLastQuestion) cleanUpBehindScenes();
    }, 500);
  }, revealDelay);
});



socket.on("fauxVraiQuestion", (data) => {

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
    sfx40s.stop();
  }

});



socket.on("fauxVraiReveal", ({ indexFausse, playerChoice, isLastQuestion }) => {

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

    const duration = isLastQuestion ? 8000 : 999999;

    const title = isLastQuestion ? "CLASSEMENT FINAL" : "CLASSEMENT";



    sfxFauxVraiWin.stop();
    sfxFauxVraiLose.stop();

    handleInterimLeaderboard(

      currentPlayersData,

      () => {},

      duration,

      title

    );



    setTimeout(() => {

      cleanUpFauxVraiScenes();

    }, 500);

  }, 2500);

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

  stopBlindTestAudio(); // On coupe le son avant tout

  hideAllMiniGames();   // On cache tout (jeux, lobby, etc)

  

  const stdContainer = document.getElementById("correctionContainer");

  const pbContainer = document.getElementById("petitBacCorrectionContainer");

  

  if (stdContainer) stdContainer.classList.add("hidden");

  if (pbContainer) pbContainer.classList.add("hidden");



  if (data.miniGameType === "petit_bac") {

    handlePetitBacCorrection(data, pbContainer);

  } else {

    handleStandardCorrection(data, stdContainer);

  }

});



// --- FONCTION 1 : CORRECTION STANDARD (RestaurÃ©e) ---

// --- FONCTION 1 : CORRECTION STANDARD (CorrigÃ©e) ---

function handleStandardCorrection(data, container) {

  if (!container) return;

  container.classList.remove("hidden");



  // RÃ©fÃ©rences DOM

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



  // 1. Infos gÃ©nÃ©rales

  if (qInfo) qInfo.textContent = `Question ${data.currentQIndex} / ${data.totalQ}`;

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



      // Affichage de la rÃ©ponse

      if (data.answerImage && imgA) {

          imgA.src = data.answerImage;

          imgA.style.display = "block";

      }

      

      if (txtA) txtA.textContent = data.answerText;

  }



  // 4. ContrÃ´les HÃ´te

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

  

  // Navigation Questions (Suivante / PrÃ©cÃ©dente)

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



// --- FONCTION 2 : CORRECTION PETIT BAC (IsolÃ©e) ---

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

        <div class="pb-corr-cat">${cat}</div>

        <div class="pb-corr-ans">${ans}</div>

        <div class="pb-corr-btns">${btnsHtml}</div>

      `;

      list.appendChild(row);

    });

  }

}



if (btnPrevPlayer) {

  btnPrevPlayer.onclick = () => socket.emit("correctionNavigate", { direction: -1 });

}

if (btnNextPlayer) {

  btnNextPlayer.onclick = () => socket.emit("correctionNavigate", { direction: 1 });

}



if (btnPrevCorrectionQ) {

  btnPrevCorrectionQ.addEventListener("click", () => {

    socket.emit("correctionPrevQuestion");

  });

}



// --- AJOUT MANQUANT ---

if (btnNextCorrectionQ) {

  btnNextCorrectionQ.addEventListener("click", () => {

    socket.emit("correctionNextQuestion");

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

    socket.emit("hostGradePlayer", {

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

    socket.emit("hostGradePlayer", {

      points: total,

      details: window.pbScoresMap

    });

    socket.emit("correctionNavigate", { direction: 1 });

  };

}



if (pbFinishGameBtn) {

  pbFinishGameBtn.addEventListener("click", () => {

    socket.emit("endPetitBacCorrection");

  });

}

socket.on("leBonOrdreExit", () => {
  // Masquage immédiat du jeu pour tous les jeux à correction
  hideAllMiniGames();
  if (mainPlaying) mainPlaying.classList.add("hidden");

  if (leugtasEndOverlay) {
    const logo = document.getElementById("leugtasEndLogo");
    if (logo) {
      let gameName = currentGameState.currentMiniGame || "le_bon_ordre";
      if (gameName === "petit_bac" || gameName === "le_petit_bac") {
        gameName = "le_petit_bac";
      }
      logo.src = `titres/${gameName}.png`;
    }

    leugtasEndOverlay.classList.remove("hidden");
    setTimeout(() => {
      leugtasEndOverlay.classList.add("hidden");
    }, 3000);
  }
});



socket.on("fauxVraiEnd", () => {
  // Masquage immédiat du jeu
  hideAllMiniGames();
  if (mainPlaying) mainPlaying.classList.add("hidden");
  if (fauxVraiContainer) fauxVraiContainer.classList.add("hidden");

  if (fauxVraiEndOverlay) {
    fauxVraiEndOverlay.classList.remove("hidden");

    setTimeout(() => {
      fauxVraiEndOverlay.classList.add("hidden");
    }, 3500);
  }
});



// ==========================================

//        CLIENT : LES ENCHÃ¨RES

// ==========================================



const encheresSetup = document.getElementById("encheresSetupContainer");

const encheresGame = document.getElementById("encheresGameContainer");

const encheresCorrection = document.getElementById("encheresCorrectionContainer");



// 1. SETUP & VOTE

socket.on("encheresSetup", (data) => {

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

      btn.textContent = theme.nom || theme.name || "ThËme";


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

      list.appendChild(btn);

    });

  }

});


socket.on("encheresThemeAnim", (data) => {

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

  div.innerHTML = `
    <span>${pseudo}</span>
    <span class="enchere-val">${bid.amount}</span>
  `;

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

          html += `<div class="enchere-live-answer-item">${item.txt}</div>`;

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



    let html = `<span class="enchere-corr-text">${ans}</span>`;



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
  const overlay = document.getElementById("leugtasEndOverlay");
  
  if (overlay) {
    if (data.playerId === playerId) {
        alert("VOUS AVEZ ÉTÉ ÉLIMINÉ !\n" + data.reason);
        // ON A SUPPRIMÉ LA LIGNE GRAYSCALE ICI
    } else {
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
        notif.innerText = `ÉLIMINATION : ${data.pseudo}`;
        document.body.appendChild(notif);
        
        setTimeout(() => notif.remove(), 4000);
    }
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
        textEl.textContent = "À VOUS !";
      }
    }, 1000);

    setTimeout(() => {
      overlay.classList.add("hidden");
      textEl.style.animation = "";
      textEl.style.transform = "";
      textEl.style.fontSize = "";
    }, 4000);
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
      playerId: playerId
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
      playerId: playerId
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

      const isOnline = p.isConnected;
      const statusColorClass = isOnline ? "online" : "offline";
      const statusText = isOnline ? "Connecté" : "Déconnecté";

      let extraInfo = "";
      if (p.eliminated) extraInfo = " <span style='color:#e74c3c; font-size:0.8em; margin-left:5px;'>(Éliminé)</span>";
      else if (p.isSpectator) extraInfo = " <span style='color:#aaa; font-size:0.8em; margin-left:5px;'>(Spectateur)</span>";
      if (p.playerId === currentRoom.hostId) extraInfo += " <span style='color:#ffcc00; font-size:0.8em; margin-left:5px;'>★ Hôte</span>";

      li.innerHTML = `
        <div style="text-align:left;">
          <span style="font-weight:bold;">${p.pseudo}</span>${extraInfo}
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
