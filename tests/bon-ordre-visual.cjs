"use strict";

// Données fictives strictement réservées au navigateur de test. Aucun tirage consommé.
// Utilise le serveur existant et un Edge déjà lancé avec --remote-debugging-port=9225.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const port = process.env.LQS_CDP_PORT || "9225";
  const baseUrl = process.env.LQS_HTTP_URL || "http://127.0.0.1:3000";
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  const livePeers = [];
  let nextId = 0;
  ws.onmessage = ({ data }) => {
    const packet = JSON.parse(String(data));
    if (packet.method === "Runtime.exceptionThrown") errors.push({ type: "exception", message: packet.params.exceptionDetails.text });
    if (packet.method === "Log.entryAdded" && packet.params.entry.level === "error") {
      errors.push({ type: "resource", message: `${packet.params.entry.text} ${packet.params.entry.url || ""}` });
    }
    if (pending.has(packet.id)) {
      const { resolve, reject } = pending.get(packet.id);
      pending.delete(packet.id);
      if (packet.error) reject(new Error(packet.error.message));
      else resolve(packet.result);
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const output = path.resolve(process.env.LQS_VISUAL_DIR || ".test-run/captures");
  fs.mkdirSync(output, { recursive: true });
  const screenshot = async name => {
    const size = await evaluate("({ width: innerWidth, height: document.documentElement.scrollHeight })");
    const shot = await call("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
    });
    fs.writeFileSync(path.join(output, name), Buffer.from(shot.data, "base64"));
  };
  try {
    await call("Runtime.enable");
    await call("Log.enable");
    await call("Page.enable");
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source: "if(location.search==='?bon-ordre-visual-test')localStorage.removeItem('lqs_room_code')"
    });
    await call("Page.navigate", { url: `${baseUrl}/?bon-ordre-visual-test` });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("typeof showLeBonOrdreQuestion === 'function' && document.readyState === 'complete'")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await evaluate("typeof showLeBonOrdreQuestion"), "function");
    assert.equal((await fetch(`${baseUrl}/le_bon_ordre/images/adele.jpeg`)).status, 200);
    await evaluate(`(() => {
      socket.disconnect();
      window.lboVisualTest = {
        sent: [], dispatch(event, data) { socket.listeners(event).forEach(listener => listener(data)); },
        question(mode, instanceId, extra = {}) {
          return { roomCode: 'VIZU', gameMode: mode, roundNumber: 1, instanceId,
            questionId: 'visual-theme', questionIndex: 0, index: 1, total: 7,
            themeName: 'Un thème de test', isReload: true, subPhase: 'answering',
            durationMs: 45000, remainingMs: 30000,
            question: { id: 'visual-theme', nom: 'Un thème de test',
              question: 'Classe ces cinq éléments du plus grand au plus petit. Rang 1 = la plus grande valeur.',
              cards: [
                { id: 'a', nom: 'Carte textuelle avec un nom particulièrement long pour vérifier le retour à la ligne', image: null },
                { id: 'b', nom: 'Carte illustrée', image: 'le_bon_ordre/images/adele.jpeg' },
                { id: 'c', nom: 'Troisième carte textuelle', image: null },
                { id: 'd', nom: 'Une autre illustration avec un nom long', image: 'le_bon_ordre/images/adele.jpeg' },
                { id: 'e', nom: 'Dernière carte', image: null }
              ] }, timer: { remaining: 30, total: 45, active: true }, ...extra };
        },
        setup(mode, instanceId, spectator = false) {
          clearBonOrdrePhaseDisplay();
          bonOrdrePhaseSnapshot = null;
          bonOrdreState = null;
          bonOrdreCorrectionContext = null;
          closeBonOrdreRankSelector();
          currentRoom = { roomCode: 'VIZU', gameMode: mode, hostId: playerId,
            listeTournament: { started: true, tournamentId: 'visual-tour', initialParticipantIds: [playerId, 'other'] },
            players: [{ playerId, pseudo: 'Hôte de test', isSpectator: spectator, eliminated: false },
              { playerId: 'other', pseudo: 'Participant au pseudonyme particulièrement long sur téléphone', isSpectator: false, eliminated: false }] };
          currentGameState = { phase: 'playing', gameMode: mode, currentMiniGame: 'le_bon_ordre',
            roundNumber: 1, readyPlayerIds: [], leBonOrdreInstanceId: instanceId, leBonOrdrePhase: 'answering' };
          this.phase('answering',30000);
          document.body.classList.add('playing-mode', 'bon-ordre-active');
          document.body.classList.toggle('mode-liste', mode === 'liste');
          showScreen('room');
          this.dispatch('leBonOrdreQuestion', this.question(mode, instanceId));
          window.scrollTo(0, 0);
        },
        phase(subPhase,remainingMs=15000,questionIndex=currentGameState.leBonOrdreState?.questionIndex || 0,questionId=currentGameState.leBonOrdreState?.questionId || 'visual-theme') {
          const state={roomCode:currentRoom.roomCode,gameMode:currentRoom.gameMode,roundNumber:1,
            instanceId:currentGameState.leBonOrdreInstanceId,questionId,questionIndex,subPhase,remainingMs,
            durationMs:subPhase==='correction'?15000:subPhase==='leaderboard'?3000:45000};
          currentGameState.leBonOrdrePhase=subPhase;
          currentGameState.leBonOrdreState=state;
          listeActionContext={tournamentId:'visual-tour',roundNumber:1,phase:'playing',miniGame:'le_bon_ordre',question:questionIndex};
          syncBonOrdrePhase(currentGameState);
        },
        context() { const {roomCode, gameMode, roundNumber, instanceId, questionId, questionIndex,subPhase} = currentGameState.leBonOrdreState;
          return {roomCode, gameMode, roundNumber, instanceId, questionId, questionIndex,subPhase}; },
        assign(index, rank) {
          document.querySelectorAll('.bon-ordre-card')[index].click();
          document.querySelectorAll('.bon-ordre-rank-choices button')[rank - 1].click();
        },
        correction(status = 'answered',remainingMs=15000) {
          const cards = bonOrdreState.cards;
          const expected = cards.map((card, index) => ({ ...card, valeur: 68000000 - index * 10000000, rank: index + 1 }));
          const positions = [1, 0, 2, 3, 4].map((cardIndex, index) => ({ ...expected[cardIndex],
            rank: index + 1, correct: cardIndex === index, correctRanks: [cardIndex + 1] }));
          this.phase('correction',remainingMs);
          this.dispatch('leBonOrdreCorrection', { ...this.context(),
            miniGameType: 'le_bon_ordre', questionText: 'Classement attendu et proposition distincts',
            playerPseudo: status==='spectator'?null:'Participant au pseudonyme particulièrement long sur téléphone',
            currentQIndex: currentGameState.leBonOrdreState.questionIndex+1, totalQ: 7,
            isParticipant:status!=='spectator',durationMs:15000,remainingMs,
            bonOrdreData: { ...this.context(), expected, positions: status === 'answered' ? positions : [],
              correctCount: status === 'spectator'?null:status === 'answered' ? 3 : 0,
              grade: status === 'spectator'?null:status === 'answered' ? 0.5 : 0, status } });
        },
        leaderboard(remainingMs=3000,isLastQuestion=false) {
          this.phase('leaderboard',remainingMs);
          const previousPlayers=[{id:playerId,nickname:'Alice',score:0,time:0,place:1},{id:'other',nickname:'Bob au pseudonyme particulièrement long sur téléphone',score:0,time:0,place:1}];
          const players=[{id:'other',nickname:'Bob au pseudonyme particulièrement long sur téléphone',score:1,time:4,place:1},{id:playerId,nickname:'Alice',score:0.5,time:6,place:2}];
          this.dispatch('leBonOrdreLeaderboard',{...this.context(),previousPlayers,players,
            startedAt:1000,endsAt:1000+(isLastQuestion?4500:3000),durationMs:isLastQuestion?4500:3000,remainingMs,isLastQuestion});
        }
      };
      emitGameAction = (event, payload) => window.lboVisualTest.sent.push({ event, payload });
    })()`);
    const initialResourceErrors = errors.splice(0);
    for (const mode of ["liste", "battle_royale"]) {
      for (const width of [320, 375, 430, 1024]) {
        await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        const instanceId = `visual-${mode}-${width}`;
        await evaluate(`lboVisualTest.setup(${JSON.stringify(mode)}, ${JSON.stringify(instanceId)})`);
        await new Promise(resolve => setTimeout(resolve, 120));
        const report = await evaluate(`(() => {
          const rect = element => element.getBoundingClientRect().toJSON();
          return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
            cards: [...document.querySelectorAll('.bon-ordre-card')].map(rect),
            namesFit: [...document.querySelectorAll('.bon-ordre-card-name')].every(element => element.scrollWidth <= element.clientWidth + 1),
            images: [...document.querySelectorAll('#lboCards img')].map(image => ({ complete: image.complete, width: image.naturalWidth })),
            quit: rect(document.getElementById('leaveRoomBtn')), disabled: lboValidateBtn.disabled,
            ranks: Object.values(bonOrdreState.ranks) };
        })()`);
        assert(report.pageWidth <= width, `${mode} ${width}: horizontal overflow ${JSON.stringify(report)}`);
        assert(report.namesFit && report.cards.length === 5 && report.images.every(image => image.complete && image.width > 0));
        assert(report.cards.every(card => card.width >= 44 && card.left >= 0 && card.right <= width));
        assert(Math.max(...report.cards.map(card => card.height)) - Math.min(...report.cards.map(card => card.height)) < 2);
        assert(report.quit.width >= 44 && report.quit.left >= 0 && report.quit.right <= width);
        assert(report.disabled && report.ranks.length === 0);
        await screenshot(`bon-ordre-${mode}-cards-${width}.png`);
        // Un rang utilisé devient indisponible sur une autre carte, sans échange.
        const ranks = await evaluate(`(() => {
          lboVisualTest.assign(0, 1);
          document.querySelectorAll('.bon-ordre-card')[1].click();
          const disabled = document.querySelector('.bon-ordre-rank-choices button').disabled;
          document.querySelector('.bon-ordre-rank-choices button').click();
          const unchanged = bonOrdreState.ranks.a === 1 && !bonOrdreState.ranks.b;
          const pop = bonOrdrePopover.getBoundingClientRect().toJSON();
          return { disabled, unchanged, pop, viewportHeight: innerHeight,
            buttons: [...bonOrdrePopover.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()) };
        })()`);
        assert(ranks.disabled && ranks.unchanged);
        assert(ranks.pop.left >= 0 && ranks.pop.right <= width && ranks.pop.top >= 0 && ranks.pop.bottom <= ranks.viewportHeight);
        assert(ranks.buttons.every(button => button.width >= 44 && button.height >= 44));
        await screenshot(`bon-ordre-${mode}-popover-${width}.png`);
        await evaluate("closeBonOrdreRankSelector(); lboVisualTest.correction()");
        const correction = await evaluate(`(() => ({
          pageWidth: document.documentElement.scrollWidth,
          expected: document.querySelectorAll('#bonOrdreExpectedCards .bon-ordre-correction-card').length,
          proposed: document.querySelectorAll('#bonOrdreProposalCards .bon-ordre-correction-card').length,
          good: document.querySelectorAll('#bonOrdreProposalCards .bon-ordre-correct').length,
          bad: document.querySelectorAll('#bonOrdreProposalCards .bon-ordre-incorrect').length,
          text: document.getElementById('bonOrdreCorrectionContainer').textContent,
          expectedValue: document.querySelector('.bon-ordre-value').textContent,
          noControls: document.querySelectorAll('#bonOrdreCorrectionContainer button').length===0,
          countdown: document.getElementById('bonOrdreCorrectionCountdown').textContent,
          standardHidden: document.getElementById('correctionContainer').classList.contains('hidden'),
          quit: document.getElementById('leaveRoomBtn').getBoundingClientRect().toJSON()
        }))()`);
        assert(correction.pageWidth <= width && correction.expected === 5 && correction.proposed === 5);
        assert(correction.good === 3 && correction.bad === 2 && correction.text.includes('Points : 0,5') && correction.text.includes('Bonne place'));
        assert(correction.expectedValue.replace(/\s/g, '') === '68000000');
        assert(correction.noControls && correction.countdown.includes('15 s') && correction.standardHidden && correction.quit.right <= width);
        await screenshot(`bon-ordre-${mode}-correction-${width}.png`);
        await evaluate("lboVisualTest.leaderboard()");
        const ranking = await evaluate(`(() => ({
          visible:document.getElementById('leaderboard-overlay').classList.contains('active'),
          correctionHidden:document.getElementById('bonOrdreCorrectionContainer').classList.contains('hidden'),
          pageWidth:document.documentElement.scrollWidth,text:document.getElementById('leaderboard-content').textContent,
          previous:bonOrdreLeaderboardSnapshot.previousPlayers[0].score,
          current:bonOrdreLeaderboardSnapshot.players[0].score
        }))()`);
        assert(ranking.visible && ranking.correctionHidden && ranking.pageWidth<=width && ranking.text.includes('Bob') && ranking.previous===0 && ranking.current===1);
        await new Promise(resolve=>setTimeout(resolve,450));
        await screenshot(`bon-ordre-${mode}-ranking-${width}.png`);
        console.log(`${mode} ${width}px: cartes texte/images, noms longs, sélecteur et correction sans débordement`);
      }
    }
    await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
    const interactions = await evaluate(`(() => {
      lboVisualTest.setup('liste', 'keyboard');
      const card = document.querySelector('.bon-ordre-card'); card.click();
      const first = document.activeElement.textContent;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
      const second = document.activeElement.textContent;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
      const escaped = !bonOrdrePopover && document.activeElement === card;
      card.click();
      document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      const outsideClosed = !bonOrdrePopover;
      lboVisualTest.assign(0, 1);
      document.querySelector('.bon-ordre-clear-rank').click();
      const cleared = !bonOrdreState.ranks.a && !document.querySelector('.bon-ordre-rank-badge');
      lboVisualTest.assign(0, 1); lboVisualTest.assign(1, 2);
      const snapshot = lboVisualTest.question('liste', 'keyboard');
      bonOrdreState = null;
      lboVisualTest.dispatch('leBonOrdreQuestion', snapshot);
      const draftRestored = bonOrdreState.ranks.a === 1 && bonOrdreState.ranks.b === 2 && !bonOrdreState.submitted;
      lboVisualTest.assign(2, 3); lboVisualTest.assign(3, 4); lboVisualTest.assign(4, 5);
      const validationEnabled = !lboValidateBtn.disabled;
      lboVisualTest.sent = []; lboValidateBtn.click();
      const sent = lboVisualTest.sent.at(-1);
      const context = lboVisualTest.context();
      lboVisualTest.dispatch('leBonOrdreAnswerAck', {...context, savedAnswer:{orderedIds:['a','b','c','d','e'],pass:false}});
      const locked = bonOrdreState.submitted && [...document.querySelectorAll('.bon-ordre-card')].every(button=>button.disabled);
      const ackReceived = lboFeedback.textContent.includes('reçue');
      bonOrdreState = null;
      lboVisualTest.dispatch('leBonOrdreQuestion', {...snapshot, hasAnswered:true, savedAnswer:{orderedIds:['a','b','c','d','e'],pass:false}});
      const reloadLocked = bonOrdreState.submitted && lboValidateBtn.disabled && bonOrdreState.ranks.e === 5;
      lboVisualTest.setup('liste', 'new-instance');
      const cleanInstance = Object.keys(bonOrdreState.ranks).length === 0 && !bonOrdreState.submitted;
      lboVisualTest.assign(0,1); lboVisualTest.sent=[];
      lboVisualTest.dispatch('leBonOrdreTimerUpdate',{...lboVisualTest.context(),remaining:0,total:45,active:false});
      const noAutoAnswer = lboVisualTest.sent.length === 0 && !bonOrdreState.submitted && lboValidateBtn.disabled;
      lboVisualTest.setup('battle_royale', 'pass'); lboVisualTest.sent=[];
      lboPassBtn.click(); const passSent = lboVisualTest.sent.at(-1);
      lboVisualTest.dispatch('leBonOrdreAnswerAck',{...lboVisualTest.context(),savedAnswer:{orderedIds:null,pass:true}});
      const passAck = bonOrdreState.submitted && bonOrdreState.pass && lboFeedback.textContent.includes('passé');
      return {first,second,escaped,outsideClosed,cleared,draftRestored,validationEnabled,sent,locked,ackReceived,
        reloadLocked,cleanInstance,noAutoAnswer,passSent,passAck};
    })()`);
    assert.equal(interactions.first, '1'); assert.equal(interactions.second, '2');
    for (const key of ['escaped','outsideClosed','cleared','draftRestored','validationEnabled','locked','ackReceived','reloadLocked','cleanInstance','noAutoAnswer','passAck']) {
      assert(interactions[key], `Interaction échouée: ${key}`);
    }
    assert.equal(interactions.sent.event, 'leBonOrdreAnswer');
    assert.deepEqual(interactions.sent.payload.orderedIds, ['a','b','c','d','e']);
    assert.deepEqual(Object.keys(interactions.sent.payload).sort(),
      ['gameMode','roundNumber','instanceId','questionId','questionIndex','orderedIds','pass'].sort());
    assert.equal(interactions.passSent.payload.pass, true); assert.equal(interactions.passSent.payload.orderedIds, null);
    const edge = await evaluate(`(() => {
      lboVisualTest.setup('liste','popover-bottom-edge');
      const last=document.querySelectorAll('.bon-ordre-card')[4];
      last.scrollIntoView({block:'end'}); last.click();
      const rect=bonOrdrePopover.getBoundingClientRect();
      const fits=rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight;
      closeBonOrdreRankSelector(); window.scrollTo(0,0); return fits;
    })()`);
    assert(edge, 'Sélecteur au bord inférieur du téléphone');
    await evaluate("lboVisualTest.setup('liste','native-input')");
    const tapPoint = await evaluate("(() => { const rect=document.querySelector('.bon-ordre-card').getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()");
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tapPoint] });
    await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await evaluate("!!bonOrdrePopover"), true, 'Ouverture tactile native');
    await evaluate("closeBonOrdreRankSelector()");
    await call("Emulation.setTouchEmulationEnabled", { enabled: false });
    await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...tapPoint });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...tapPoint });
    assert.equal(await evaluate("!!bonOrdrePopover"), true, 'Ouverture souris native');
    await evaluate("closeBonOrdreRankSelector()");
    const spectatorAndCorrection = await evaluate(`(() => {
      lboVisualTest.setup('liste','spectator',true);
      const readOnly = [...document.querySelectorAll('.bon-ordre-card')].every(button=>button.disabled) && lboValidateBtn.hidden && lboPassBtn.hidden;
      currentRoom.hostId = 'other';
      lboVisualTest.correction('spectator');
      const spectatorOnlyExpected = document.getElementById('bonOrdrePersonalSection').hidden &&
        document.getElementById('bonOrdreCorrectionPlayer').textContent==='' &&
        document.getElementById('bonOrdreProposalCards').children.length===0 &&
        document.getElementById('bonOrdreExpectedCards').children.length===5;
      lboVisualTest.setup('liste','pass-correction');
      lboVisualTest.correction('pass');
      const pass = document.getElementById('bonOrdreCorrectionStatus').textContent === 'Je passe';
      const noNavigation = document.querySelectorAll('#bonOrdreCorrectionContainer button').length===0;
      lboVisualTest.correction('missing');
      const missing = document.getElementById('bonOrdreCorrectionStatus').textContent.includes('Aucune réponse');
      lboVisualTest.setup('battle_royale','host-correction');
      lboVisualTest.correction(); lboVisualTest.sent=[];
      submitGrade(1);
      lboVisualTest.dispatch('correctionUpdate',{miniGameType:'le_bon_ordre',playerPseudo:'Autre joueur interdit'});
      const legacyIgnored=!document.getElementById('bonOrdreCorrectionContainer').textContent.includes('Autre joueur interdit');
      return {readOnly,pass,missing,noNavigation,spectatorOnlyExpected,legacyIgnored,actions:lboVisualTest.sent.map(action=>action.event)};
    })()`);
    assert(spectatorAndCorrection.readOnly && spectatorAndCorrection.pass && spectatorAndCorrection.missing && spectatorAndCorrection.noNavigation && spectatorAndCorrection.spectatorOnlyExpected && spectatorAndCorrection.legacyIgnored);
    assert.deepEqual(spectatorAndCorrection.actions, []);
    const recoveredClock = await evaluate(`(() => {
      lboVisualTest.setup('liste','correction-reconnect'); lboVisualTest.correction('answered',5000);
      return document.getElementById('bonOrdreCorrectionCountdown').textContent;
    })()`);
    assert(recoveredClock.includes('5 s'));
    await evaluate("lboVisualTest.phase('answering',30000); lboVisualTest.correction('answered',100); lboVisualTest.sent=[]");
    await new Promise(resolve=>setTimeout(resolve,350));
    assert.equal(await evaluate("currentGameState.leBonOrdrePhase==='correction' && !document.getElementById('bonOrdreCorrectionContainer').classList.contains('hidden') && lboVisualTest.sent.length===0"),true);
    await evaluate("lboVisualTest.leaderboard(100)");
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate("currentGameState.leBonOrdrePhase==='leaderboard' && lboVisualTest.sent.length===0"),true);
    await evaluate("lboVisualTest.phase('leaderboard',4500,6,'last'); lboVisualTest.leaderboard(4500,true)");
    assert.equal(await evaluate("bonOrdreLeaderboardSnapshot.context.durationMs===4500 && document.getElementById('leaderboardTitle').textContent==='CLASSEMENT' && !document.getElementById('leaderboard-content').textContent.includes('💀')"),true);
    const stale = await evaluate(`(() => {
      lboVisualTest.setup('liste', 'stale');
      lboVisualTest.assign(0,1);
      lboVisualTest.dispatch('leBonOrdreQuestion',lboVisualTest.question('liste','stale',{subPhase:'theme',timer:{remaining:45,total:45,active:false}}));
      const stalePhaseIgnored=bonOrdreState.active && bonOrdreState.ranks.a===1;
      lboVisualTest.phase('answering',30000,1,'second');
      lboVisualTest.dispatch('leBonOrdreQuestion', lboVisualTest.question('liste','stale',{questionIndex:1,questionId:'second'}));
      lboVisualTest.dispatch('leBonOrdreQuestion', lboVisualTest.question('liste','stale'));
      return stalePhaseIgnored && bonOrdreState.questionIndex === 1;
    })()`);
    assert(stale);
    const ending = await evaluate(`(() => {
      lboVisualTest.setup('battle_royale','ending-reconnect');
      lboVisualTest.phase('ending',2500,6,'last-question');
      const data={...lboVisualTest.context(),durationMs:7000,remainingMs:2500,
        players:[{nickname:'Alice',score:5,time:12},{nickname:'Bob',score:3,time:20}],isReload:true};
      lboVisualTest.dispatch('leBonOrdreExit',data);
      const snapshot=bonOrdreEndingSnapshot;
      const resumed=!document.getElementById('leugtasEndOverlay').classList.contains('hidden') &&
        parseFloat(document.getElementById('leugtasEndLogo').style.animationDelay)<=-1000 && palierOverlay.classList.contains('hidden');
      lboVisualTest.dispatch('leBonOrdreExit',data);
      const unique=bonOrdreEndingSnapshot===snapshot;
      lboVisualTest.setup('liste','new-after-ending');
      lboVisualTest.dispatch('leBonOrdreExit',data);
      return resumed && unique && document.getElementById('leugtasEndOverlay').classList.contains('hidden') &&
        document.getElementById('leugtasEndLogo').style.animationDelay==='';
    })()`);
    assert(ending,'Reconnexion de fin, unicité et nettoyage des callbacks périmés');
    const legacyExit = await evaluate(`(() => {
      currentGameState={phase:'playing',gameMode:'liste',currentMiniGame:'petit_bac',roundNumber:2,readyPlayerIds:[]};
      syncBonOrdrePhase(currentGameState);
      const overlay=document.getElementById('leugtasEndOverlay'); overlay.classList.add('hidden');
      lboVisualTest.dispatch('leBonOrdreExit',{instanceId:'old-bon-ordre'});
      const staleIgnored=overlay.classList.contains('hidden');
      lboVisualTest.dispatch('leBonOrdreExit',undefined);
      const genericVisible=!overlay.classList.contains('hidden') && document.getElementById('leugtasEndLogo').getAttribute('src')==='titres/le_petit_bac.png';
      overlay.classList.add('hidden'); return {staleIgnored,genericVisible};
    })()`);
    assert(legacyExit.staleIgnored && legacyExit.genericVisible, 'Fin historique Petit Bac conservée et ancienne fin Bon Ordre ignorée');
    console.log('Souris/toucher natifs, clavier, bords écran, clic extérieur, annulation, brouillon/reconnexion, nouvelle instance, expiration sans envoi, passage et spectateur: OK');
    console.log('Correction personnelle sans commandes, spectateur commun, reprise du compteur, classement existant 3/4,5 s et aucune progression locale: OK');
    assert.deepEqual(errors.filter(error => error.type === 'exception'), []);
    const resourceErrors = [...initialResourceErrors, ...errors].filter(error => error.type === 'resource');
    console.log(`Console: aucune exception de jeu; erreurs de ressources (${resourceErrors.length}) consignées séparément.`);
    fs.writeFileSync(path.join(output, 'bon-ordre-browser-errors.json'), JSON.stringify(resourceErrors, null, 2));
    if (process.env.LQS_VISUAL_LIVE === "1") {
      // Ce parcours utilise de vrais Socket.IO et les contrôles du navigateur.
      // Il démarre une partie réelle sur le serveur existant : réserver à une mémoire de test.
      await evaluate("localStorage.removeItem('lqs_room_code')");
      await call("Page.navigate", { url: `${baseUrl}/?bon-ordre-live-browser-test` });
      const until = async (expression, label, timeout = 40000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await evaluate(expression)) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`${label}: ${JSON.stringify(await evaluate("({phase:currentGameState?.phase,game:currentGameState?.currentMiniGame,room:currentRoom?.roomCode,error:errorRoom?.textContent,events:window.bonOrdreLiveEvents})"))}`);
      };
      await until("typeof showLeBonOrdreQuestion === 'function' && socket.connected", "Client connecté");
      await evaluate(`(() => {
        window.bonOrdreLiveEvents=[];
        socket.onAny((event,payload)=>window.bonOrdreLiveEvents.push({event,phase:payload?.phase,context:payload?.listeContext,questionIndex:payload?.questionIndex}));
        pseudoInput.value='Hôte navigateur réel';
        createRoomBtn.click();
      })()`);
      await until("currentRoom?.roomCode && currentRoom.hostId === playerId", "Salle réelle créée");
      process.env.LQS_TEST_URL = baseUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
      const { connect } = require('./penave-live.cjs');
      const roomCode = await evaluate('currentRoom.roomCode');
      const peerNames = ['Bob navigateur', 'Carol navigateur'];
      const stamp = Date.now();
      const latestContext = peer => peer.events.reduce((context, entry) => entry.event === 'listeContext'
        ? entry.payload : entry.event === 'gameStateUpdate' && entry.payload.listeContext ? entry.payload.listeContext : context, null);
      for (let index = 0; index < 2; index++) {
        const peer = await connect();
        livePeers.push(peer);
        peer.emit('joinRoom', { roomCode, playerId: `browser-peer-${stamp}-${index}`, pseudo: peerNames[index] });
        await peer.wait('roomJoined');
      }
      await until("currentRoom?.players.length === 3", "Trois participants réels");
      await evaluate("document.querySelector('[data-game-mode=liste]').click()");
      await until("currentRoom?.gameMode === 'liste'", "Mode Liste réel");
      await evaluate("void socket.emit('hostValidateListeConfig',{gameCount:1,selectionMethod:'manual',selectedMiniGames:['le_bon_ordre']})");
      await until("currentRoom?.listeConfig?.isValid", "Configuration réelle validée");
      await evaluate("startGameBtn.click()");
      await until("currentGameState.phase === 'rules'", "Règles reçues dans le navigateur", 50000);
      await Promise.all(livePeers.map(peer=>peer.wait('gameStateUpdate',state=>state.phase==='rules')));
      await evaluate('readyBtn.click()');
      for (const peer of livePeers) peer.emit('playerSetReady', {isReady:true}, latestContext(peer));
      await until("bonOrdreState?.instanceId && bonOrdreState.active && document.querySelectorAll('.bon-ordre-card').length === 5", "Premières cartes réelles actives", 15000);
      const real = await evaluate(`(() => ({phase:currentGameState.phase,instance:bonOrdreState.instanceId,
        question:bonOrdreState.questionId,remaining:bonOrdreState.remaining,
        disabled:lboPassBtn.disabled,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
        valuesLeaked:bonOrdreState.cards.some(card=>'valeur' in card)}))()`);
      assert(real.phase === 'playing' && real.instance && real.remaining > 0 && !real.disabled && !real.valuesLeaked && real.pageWidth <= real.viewport);
      await screenshot('bon-ordre-live-liste-first-question-375.png');
      const question = await evaluate(`(() => ({
        instanceId:bonOrdreState.instanceId,questionId:bonOrdreState.questionId,questionIndex:bonOrdreState.questionIndex,
        orderedIds:bonOrdreState.cards.map(card=>card.id),pass:false
      }))()`);
      const spectator = await connect();
      livePeers.push(spectator);
      spectator.emit('joinRoom', {roomCode,playerId:`browser-spectator-${stamp}`,pseudo:'Spectateur navigateur'});
      await spectator.wait('roomJoined');
      await evaluate(`(() => {
        for(let index=0;index<5;index++) {
          document.querySelectorAll('.bon-ordre-card')[index].click();
          document.querySelectorAll('.bon-ordre-rank-choices button')[index].click();
        }
        lboValidateBtn.click();
      })()`);
      await until('bonOrdreState?.submitted', 'Ack classement réel', 5000);
      livePeers[0].emit('leBonOrdreAnswer', {...question,orderedIds:[...question.orderedIds].reverse()},latestContext(livePeers[0]));
      livePeers[1].emit('leBonOrdreAnswer', {...question,orderedIds:null,pass:true},latestContext(livePeers[1]));
      await until("currentGameState.leBonOrdrePhase==='correction' && bonOrdreCorrectionContext?.questionIndex===0", 'Correction personnelle réelle',5000);
      const correctionReceivedAt = Date.now();
      const alice = await evaluate('bonOrdreCorrectionContext');
      const [bob, carol, viewer] = await Promise.all(livePeers.map(peer=>peer.wait('leBonOrdreCorrection')));
      assert.deepEqual(alice.bonOrdreData.positions.map(card=>card.id),question.orderedIds);
      assert.deepEqual(bob.bonOrdreData.positions.map(card=>card.id),[...question.orderedIds].reverse());
      assert.equal(alice.playerPseudo,'Hôte navigateur réel'); assert.equal(bob.playerPseudo,peerNames[0]);
      assert.equal(carol.bonOrdreData.status,'pass');
      assert.equal(viewer.isParticipant,false); assert.equal(viewer.playerPseudo,null);
      assert.equal(viewer.bonOrdreData.status,'spectator'); assert.deepEqual(viewer.bonOrdreData.positions,[]);
      assert.equal(alice.correctionEndsAt-alice.correctionStartedAt,15000);
      assert.equal(bob.correctionEndsAt,alice.correctionEndsAt); assert.equal(viewer.correctionEndsAt,alice.correctionEndsAt);
      await screenshot('bon-ordre-live-alice-correction-375.png');
      await new Promise(resolve=>setTimeout(resolve,1800));
      await call("Page.reload");
      await until("typeof bonOrdreCorrectionContext !== 'undefined' && currentGameState.leBonOrdrePhase==='correction' && bonOrdreCorrectionContext?.questionIndex===0", "Reconnexion dans sa correction",10000);
      const resumed = await evaluate('({context:bonOrdreCorrectionContext,clock:document.getElementById("bonOrdreCorrectionCountdown").textContent})');
      assert.deepEqual(resumed.context.bonOrdreData.positions,alice.bonOrdreData.positions);
      assert.equal(resumed.context.correctionEndsAt,alice.correctionEndsAt); assert(resumed.context.remainingMs<14000);
      await screenshot('bon-ordre-live-alice-correction-reconnected-375.png');
      await until("currentGameState.leBonOrdrePhase==='leaderboard' && document.getElementById('leaderboard-overlay').classList.contains('active')",'Classement après quinze secondes',17000);
      assert(Date.now()-correctionReceivedAt>=13500);
      const ranking = await livePeers[0].wait('leBonOrdreLeaderboard');
      assert.equal(ranking.startedAt,alice.correctionEndsAt); assert.equal(ranking.durationMs,3000);
      assert.equal(ranking.players.length,3);
      await new Promise(resolve=>setTimeout(resolve,450));
      await screenshot('bon-ordre-live-ranking-after-correction-375.png');
      await call('Page.reload');
      await until("typeof bonOrdreLeaderboardSnapshot !== 'undefined' && currentGameState.leBonOrdrePhase==='leaderboard' && bonOrdreLeaderboardSnapshot?.context.questionIndex===0",'Reconnexion dans le classement',5000);
      await until("currentGameState.leBonOrdrePhase==='theme' && currentGameState.leBonOrdreState?.questionIndex===1",'Thème suivant après classement',6000);
      assert.equal(await evaluate("document.getElementById('bonOrdreCorrectionContainer').classList.contains('hidden') && !document.getElementById('leaderboard-overlay').classList.contains('active')"),true);
      await until("bonOrdreState?.questionIndex===1 && bonOrdreState.active && currentGameState.leBonOrdrePhase==='answering'",'Question deux après thème',5000);
      assert.equal(await evaluate("Object.keys(bonOrdreState.ranks).length===0 && !bonOrdreState.cards.some(card=>'valeur'in card)"),true);
      await screenshot('bon-ordre-live-question-two-375.png');
      await evaluate("socket.emit('leaveRoom'); localStorage.removeItem('lqs_room_code')");
      assert.deepEqual(errors.filter(error => error.type === 'exception'), []);
      fs.writeFileSync(path.join(output, 'bon-ordre-live-browser-errors.json'),
        JSON.stringify(errors.filter(error => error.type === 'resource'), null, 2));
      console.log('Navigateur réel Liste: trois participants + spectateur, propositions privées distinctes, correction quinze secondes, reconnexion personnelle, classement trois secondes et question deux: OK');
    }
  } finally {
    for (const peer of livePeers) peer.close();
    ws.close();
    // L'onglet appartient exclusivement à ce script ; sa fermeture libère aussi les pairs.
    await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
