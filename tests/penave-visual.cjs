"use strict";

// Exécuter contre un Edge headless déjà ouvert avec --remote-debugging-port=9225.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const port = process.env.LQS_CDP_PORT || "9225";
  const baseUrl = process.env.LQS_HTTP_URL || "http://127.0.0.1:3105";
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = tabs.find((tab) => tab.type === "page" && tab.url.startsWith(baseUrl));
  if (!page) throw new Error("Onglet local introuvable dans Edge headless.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  let id = 0;
  ws.onmessage = ({ data }) => {
    const packet = JSON.parse(String(data));
    if (packet.method === "Runtime.exceptionThrown") errors.push(packet.params.exceptionDetails.text);
    if (packet.method === "Log.entryAdded" && packet.params.entry.level === "error") {
      errors.push(`${packet.params.entry.text} ${packet.params.entry.url || ""}`);
    }
    if (packet.id && pending.has(packet.id)) {
      const { resolve, reject } = pending.get(packet.id);
      pending.delete(packet.id);
      if (packet.error) reject(new Error(packet.error.message));
      else resolve(packet.result);
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  try {
    await call("Runtime.enable");
    await call("Log.enable");
    await call("Page.enable");
    await call("Page.navigate", { url: `${baseUrl}/` });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate("typeof renderPenave === 'function' && document.readyState === 'complete'")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await evaluate("typeof renderPenave"), "function");
    // Le même onglet CDP peut conserver des erreurs Socket.IO de l'arrêt du serveur précédent.
    errors.length = 0;
    const output = process.env.LQS_VISUAL_DIR || path.join(process.cwd(), ".test-captures");
    fs.mkdirSync(output, { recursive: true });
    for (const width of [320, 375, 430, 431, 600, 1024]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width, height: 780, deviceScaleFactor: 1, mobile: true
      });
      const report = await evaluate(`(() => {
        currentRoom = { roomCode: 'TEST', gameMode: 'liste', hostId: playerId,
          listeTournament: { started: true, initialParticipantIds: [playerId, 'other'] },
          players: [
            { playerId, pseudo: 'Hôte', withdrawn: false },
            { playerId: 'other', pseudo: 'Un pseudonyme particulièrement long à afficher sur téléphone', withdrawn: false }
          ] };
        document.body.classList.add('mode-liste', 'playing-mode');
        showScreen('room');
        renderPenave({ gameMode: 'liste', instanceId: 'visual-test', subPhase: 'correction',
          theme: 'Football', affirmation: 'Combien de buteurs ayant marqué plus de 500 buts pouvez-vous citer ?',
          turnNumber: 2, passageId: 3, activePlayerId: 'other', durationMs: 20000,
          remainingMs: 0, correctionStartedAt: Date.now() - 900,
          order: [playerId, 'other'], survivorIds: [playerId, 'other'], entries: [
            { turnNumber: 1, passageId: 1, playerId, pseudo: 'Hôte', answer: 'Réponse validée', status: 'accepted' },
            { turnNumber: 2, passageId: 3, playerId: 'other', pseudo: 'Un pseudonyme particulièrement long à afficher sur téléphone',
              answer: 'Une réponse vraiment très longue qui doit revenir à la ligne sans masquer les boutons de correction', status: 'pending' }
          ], roundEliminatedIds: [], eliminatedIds: [], ranking: null });
        const pendingRow = [...document.querySelectorAll('.penave-row')].at(-1);
        pendingRow.querySelector('.penave-status').textContent =
          'En attente de validation définitive par l’hôte';
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
          boardWidth: document.getElementById('penaveBoard').scrollWidth,
          boardClientWidth: document.getElementById('penaveBoard').clientWidth,
          board: document.getElementById('penaveBoard').getBoundingClientRect().toJSON(),
          buttons: [...document.querySelectorAll('.penave-grade')].map(x => x.getBoundingClientRect().toJSON()),
          textFits: [...pendingRow.querySelectorAll('span')]
            .every((x) => x.scrollWidth <= x.clientWidth + 1),
          quit: document.getElementById('leaveRoomBtn').getBoundingClientRect().toJSON() };
      })()`);
      assert(report.pageWidth <= report.viewport, `Débordement horizontal à ${width}px : ${JSON.stringify(report)}`);
      assert(report.boardWidth <= report.boardClientWidth, `Tableau débordant à ${width}px`);
      assert(report.textFits, `Texte débordant à ${width}px`);
      assert.equal(report.buttons.length, 2);
      assert(report.buttons.every((button) => button.width >= 44 && button.height >= 44 &&
        button.left >= report.board.left && button.right <= report.board.right),
        `Bouton de correction masqué à ${width}px : ${JSON.stringify(report)}`);
      assert(report.buttons[0].right <= report.buttons[1].left,
        `Boutons de correction superposés à ${width}px`);
      assert(report.quit.width > 0 && report.quit.left >= 0 && report.quit.right <= width);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `penave-${width}.png`), Buffer.from(shot.data, "base64"));
      console.log(`${width}px : aucun débordement, correction et Quitter visibles`);
    }
    const gradeActions = await evaluate(`(() => {
      const original = emitGameAction;
      const sent = [];
      emitGameAction = (event, payload) => sent.push({ event, accepted: payload.accepted });
      try {
        document.querySelectorAll('.penave-grade')[0].click();
        renderPenave(penaveSnapshot);
        document.querySelectorAll('.penave-grade')[1].click();
        return sent;
      } finally { emitGameAction = original; }
    })()`);
    assert.deepEqual(gradeActions, [
      { event: "penaveGrade", accepted: true },
      { event: "penaveGrade", accepted: false }
    ]);
    await call("Emulation.setDeviceMetricsOverride", {
      width: 375, height: 780, deviceScaleFactor: 1, mobile: true
    });
    const active = await evaluate(`(() => {
      renderPenave({ gameMode: 'liste', instanceId: 'visual-answer', subPhase: 'answer',
        theme: 'Football', affirmation: 'Combien de buteurs ayant marqué plus de 500 buts pouvez-vous citer ?',
        turnNumber: 1, passageId: 1, activePlayerId: playerId, durationMs: 20000,
        remainingMs: 20000, order: [playerId, 'other'], survivorIds: [playerId, 'other'],
        entries: [], roundEliminatedIds: [], eliminatedIds: [], ranking: null });
      return { disabled: document.getElementById('penaveInput').disabled,
        timer: document.getElementById('penaveTimer').textContent,
        width: document.documentElement.scrollWidth };
    })()`);
    assert.equal(active.disabled, false);
    assert.equal(active.timer, "20");
    assert(active.width <= 375);
    const activeShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, "penave-active-375.png"), Buffer.from(activeShot.data, "base64"));
    const final = await evaluate(`(() => {
      currentGameState = { phase: 'playing', gameMode: 'liste', currentMiniGame: 'penave_ou_nachave', roundNumber: 1 };
      listeActionContext = { tournamentId: undefined, roundNumber: 1, miniGame: 'penave_ou_nachave', phase: 'playing' };
      renderPenave({ gameMode: 'liste', instanceId: 'visual-answer', subPhase: 'final_ranking',
        theme: 'Football', affirmation: 'Combien de buteurs ayant marqué plus de 500 buts pouvez-vous citer ?',
        turnNumber: 3, passageId: 6, activePlayerId: null, durationMs: 20000,
        remainingMs: 0, phaseEndsAt: Date.now() + 5000, order: [playerId, 'other'], survivorIds: [playerId],
        entries: [], roundEliminatedIds: [], eliminatedIds: ['other'],
        ranking: [
          { place: 1, playerId, pseudo: 'Hôte', points: 2, time: 32 },
          { place: 2, playerId: 'other', pseudo: 'Un pseudonyme particulièrement long à afficher sur téléphone', points: 1, time: 35 }
        ] });
      return { width: document.documentElement.scrollWidth,
        text: document.getElementById('leaderboard-content').textContent };
    })()`);
    assert(final.width <= 375 && final.text.includes("32.0s") && final.text.includes("35.0s"));
    await new Promise((resolve) => setTimeout(resolve, 450));
    const finalShot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, "penave-final-375.png"), Buffer.from(finalShot.data, "base64"));
    console.log("375px : passage actif et classement final lisibles");
    const transitions = await evaluate(`(() => {
      const base = { gameMode: 'liste', instanceId: 'visual-overlays', theme: 'Football',
        affirmation: 'Une affirmation', turnNumber: 1, passageId: 0,
        order: [playerId, 'other'], survivorIds: [playerId, 'other'], entries: [],
        roundEliminatedIds: [], eliminatedIds: [], remainingMs: 0, durationMs: 20000 };
      renderPenave({ ...base, subPhase: 'theme', phaseEndsAt: Date.now() + 1500 });
      const theme = !document.getElementById('penaveThemeOverlay').classList.contains('hidden') &&
        document.getElementById('penaveThemeOverlayText').textContent === 'Football';
      renderPenave({ ...base, subPhase: 'round_summary', announcement: 'Hôte est éliminé',
        roundEliminatedIds: [playerId], phaseEndsAt: Date.now() + 3200 });
      const out = !document.getElementById('penaveAnnouncementOverlay').classList.contains('hidden') &&
        document.getElementById('penaveAnnouncementText').textContent === 'Hôte est éliminé';
      renderPenave({ ...base, subPhase: 'end_logo', phaseEndsAt: Date.now() + 2200 });
      const logo = document.querySelector('#penaveEndOverlay .leugtas-end-logo');
      return { theme, out, logo: !document.getElementById('penaveEndOverlay').classList.contains('hidden'),
        animation: logo.style.animation, delay: logo.style.animationDelay,
        boardHidden: document.getElementById('penaveContainer').classList.contains('hidden') };
    })()`);
    assert(transitions.theme && transitions.out && transitions.logo && transitions.boardHidden);
    assert(transitions.animation.includes('spinAndShoot') && transitions.delay.startsWith('-'));
    console.log("Annonces dédiées et reprise du logo spinAndShoot : OK");
    const audioTriggers = await evaluate(`(() => {
      const howls = { turn: sfxPenaveTurn, suspense: sfxPenaveSuspense,
        board: sfxPenaveBoard, accepted: sfxPenaveCorrect, refused: sfxPenaveWrong };
      const originals = Object.fromEntries(Object.entries(howls).map(([key, howl]) =>
        [key, { play: howl.play, once: howl.once, seek: howl.seek, stop: howl.stop }]));
      const counts = { turn: 0, suspense: 0, board: 0, accepted: 0, refused: 0 };
      const seeks = [];
      let suspenseStops = 0;
      for (const [key, howl] of Object.entries(howls)) {
        howl.play = () => { counts[key]++; return 1; };
        howl.once = () => {};
        howl.seek = (position) => { if (key === 'suspense') seeks.push(position); return 0; };
        if (key === 'suspense') howl.stop = () => { suspenseStops++; };
      }
      try {
        const base = { gameMode: 'liste', instanceId: 'audio-test', theme: 'Football',
          affirmation: 'Une affirmation', turnNumber: 1, passageId: 1,
          order: [playerId, 'other'], survivorIds: [playerId, 'other'], entries: [],
          roundEliminatedIds: [], eliminatedIds: [], remainingMs: 0, durationMs: 20000 };
        renderPenave({ ...base, subPhase: 'cue', activePlayerId: 'other',
          cueStartedAt: Date.now(), phaseEndsAt: Date.now() + 1700 });
        const spectatorPrivate = counts.turn + counts.suspense;
        renderPenave({ ...base, subPhase: 'cue', activePlayerId: playerId,
          cueStartedAt: Date.now(), phaseEndsAt: Date.now() + 1700 });
        renderPenave({ ...base, subPhase: 'cue', activePlayerId: playerId,
          cueStartedAt: Date.now(), phaseEndsAt: Date.now() + 1700 });
        renderPenave({ ...base, subPhase: 'answer', activePlayerId: playerId, remainingMs: 20000 });
        renderPenave({ ...base, subPhase: 'answer', activePlayerId: playerId, remainingMs: 19900 });
        const pending = { turnNumber: 1, passageId: 1, playerId, pseudo: 'Hôte',
          answer: 'Réponse animée', status: 'pending' };
        const beforeActorCorrection = suspenseStops;
        renderPenave({ ...base, subPhase: 'correction', activePlayerId: playerId,
          correctionStartedAt: Date.now(), entries: [pending] });
        const stoppedAfterCorrection = suspenseStops > beforeActorCorrection;
        renderPenave({ ...base, subPhase: 'correction', activePlayerId: playerId,
          correctionStartedAt: Date.now(), entries: [pending] });
        renderPenave({ ...base, subPhase: 'between', entries: [{ ...pending,
          status: 'accepted', gradedAt: Date.now() }] });
        renderPenave({ ...base, subPhase: 'between', entries: [{ ...pending,
          status: 'accepted', gradedAt: Date.now() }] });
        renderPenave({ ...base, subPhase: 'between', passageId: 2, entries: [{ ...pending,
          passageId: 2, status: 'refused', gradedAt: Date.now() }] });
        stopPenaveDisplay();
        const survivor = { ...base, instanceId: 'audio-survivor', passageId: 2,
          activePlayerId: 'other', subPhase: 'answer', remainingMs: 20000,
          eliminatedIds: [] };
        renderPenave(survivor);
        renderPenave({ ...survivor, remainingMs: 19900 });
        const survivorPlayedOnce = counts.suspense === 2 && counts.turn === 1;
        const beforePass = suspenseStops;
        renderPenave({ ...survivor, subPhase: 'between', remainingMs: 0,
          entries: [{ ...pending, passageId: 2, status: 'passed' }] });
        const stoppedOnPass = suspenseStops > beforePass;
        stopPenaveDisplay();
        const spectator = { ...base, instanceId: 'audio-spectator', passageId: 3,
          activePlayerId: 'other', subPhase: 'answer', remainingMs: 12000,
          eliminatedIds: [playerId] };
        renderPenave(spectator);
        renderPenave({ ...spectator, remainingMs: 11900 });
        const spectatorPlayedOnce = counts.suspense === 3 && counts.turn === 1;
        const beforeStop = suspenseStops;
        renderPenave({ ...spectator, subPhase: 'correction', correctionStartedAt: Date.now(),
          entries: [{ ...pending, passageId: 3, status: 'pending' }] });
        const stoppedForSpectator = suspenseStops > beforeStop;
        stopPenaveDisplay();
        renderPenave({ ...base, instanceId: 'audio-timeout', passageId: 4,
          activePlayerId: 'other', subPhase: 'answer', remainingMs: 100,
          eliminatedIds: [playerId] });
        const beforeTimeout = suspenseStops;
        penaveClock.receivedAt -= 200;
        renderPenaveClock();
        return { spectatorPrivate, counts, seeks, stoppedAfterCorrection,
          survivorPlayedOnce, stoppedOnPass,
          spectatorPlayedOnce, stoppedForSpectator,
          stoppedAtDeadline: suspenseStops > beforeTimeout &&
            document.getElementById('penaveTimer').textContent === '0' };
      } finally {
        for (const [key, howl] of Object.entries(howls))
          Object.assign(howl, originals[key]);
      }
    })()`);
    assert.equal(audioTriggers.spectatorPrivate, 0);
    assert.deepEqual(audioTriggers.counts, { turn: 1, suspense: 4, board: 2, accepted: 1, refused: 1 });
    assert(audioTriggers.stoppedAfterCorrection && audioTriggers.survivorPlayedOnce &&
      audioTriggers.stoppedOnPass && audioTriggers.spectatorPlayedOnce &&
      audioTriggers.stoppedForSpectator && audioTriggers.stoppedAtDeadline &&
      audioTriggers.seeks.some((position) => position >= 8));
    console.log("Déclenchements Howler : joueur actif, spectateur et éliminé ; sans doublon, reprise à 8 s, arrêt au passage, à la correction et à zéro");
    for (const width of [320, 1024]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width, height: 780, deviceScaleFactor: 1, mobile: true
      });
      const boardReport = await evaluate(`(() => {
        const entries = [
          [1, 1, 'T1-A'], [1, 2, 'T1-B'], [1, 3, 'T1-C'],
          [2, 4, 'T2-A'], [2, 5, 'T2-B'], [2, 6, 'T2-C'],
          [3, 7, 'T3-A'], [3, 8, 'T3-B'], [3, 9, 'T3-C']
        ].map(([turnNumber, passageId, answer]) => ({ turnNumber, passageId,
          playerId: 'other', pseudo: 'Joueur avec un long pseudonyme', answer,
          status: passageId === 9 ? 'pending' : 'accepted' }));
        const base = { gameMode: 'liste', instanceId: 'board-order-' + innerWidth,
          theme: 'Football', affirmation: 'Une affirmation', activePlayerId: 'other',
          order: [playerId, 'other'], survivorIds: [playerId, 'other'],
          roundEliminatedIds: [], eliminatedIds: [], durationMs: 20000, remainingMs: 0 };
        renderPenave({ ...base, subPhase: 'cue', turnNumber: 2, passageId: 6,
          cueStartedAt: Date.now() - 1200, phaseEndsAt: Date.now() + 500, entries: entries.slice(0, 6) });
        const board = document.getElementById('penaveBoard');
        board.scrollTop = board.scrollHeight;
        renderPenave({ ...base, subPhase: 'cue', turnNumber: 3, passageId: 7,
          cueStartedAt: Date.now() - 1200, phaseEndsAt: Date.now() + 500, entries: entries.slice(0, 6) });
        const emptyTop = board.firstElementChild?.textContent === 'Tour 3' && board.scrollTop === 0;
        renderPenave({ ...base, subPhase: 'correction', turnNumber: 3, passageId: 9,
          correctionStartedAt: Date.now() - 900, entries });
        const groups = [];
        for (const child of board.children) {
          if (child.tagName === 'H3') groups.push({ title: child.textContent, answers: [] });
          else groups.at(-1).answers.push(child.querySelector('.penave-answer').textContent);
        }
        const buttons = [...board.querySelectorAll('.penave-grade')].map((button) =>
          button.getBoundingClientRect().toJSON());
        const row = [...board.querySelectorAll('.penave-row')].at(2).getBoundingClientRect();
        const bounds = board.getBoundingClientRect();
        const visible = row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1 &&
          buttons.every((button) => button.top >= bounds.top - 1 && button.bottom <= bounds.bottom + 1);
        const arrivalScroll = board.scrollTop;
        board.scrollTop = Math.min(30, board.scrollHeight - board.clientHeight);
        const scrolled = board.scrollTop;
        renderPenave({ ...base, subPhase: 'correction', turnNumber: 3, passageId: 9,
          correctionStartedAt: Date.now() - 900, entries });
        const preservedScroll = board.scrollTop === scrolled;
        board.scrollTop = arrivalScroll;
        return { emptyTop, groups, visible, buttons,
          preservedScroll,
          pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      })()`);
      assert(boardReport.emptyTop && boardReport.visible && boardReport.preservedScroll);
      assert.deepEqual(boardReport.groups, [
        { title: 'Tour 3', answers: ['T3-A', 'T3-B', 'T3-C'] },
        { title: 'Tour 2', answers: ['T2-A', 'T2-B', 'T2-C'] },
        { title: 'Tour 1', answers: ['T1-A', 'T1-B', 'T1-C'] }
      ]);
      assert.equal(boardReport.buttons.length, 2);
      assert(boardReport.buttons.every((button) => button.width >= 44 && button.height >= 44));
      assert(boardReport.pageWidth <= boardReport.viewport);
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `penave-three-rounds-${width}.png`), Buffer.from(shot.data, "base64"));
      console.log(`${width}px : Tour 3, Tour 2, Tour 1 ; réponses chronologiques et deux boutons visibles`);
    }
    const cleanup = await evaluate(`(() => {
      stopPenaveDisplay();
      const clean = penaveSnapshot === null && penaveFlightElement === null &&
        document.getElementById('penaveEndOverlay').classList.contains('hidden') &&
        document.getElementById('penaveAnnouncementOverlay').classList.contains('hidden') &&
        !document.getElementById('leaderboard-overlay').classList.contains('active');
      renderPenave({ gameMode: 'liste', instanceId: 'second-game', subPhase: 'theme',
        theme: 'Nouveau thème', affirmation: 'Nouvelle affirmation', turnNumber: 1,
        passageId: 0, phaseEndsAt: Date.now() + 1500, activePlayerId: null,
        order: [playerId, 'other'], survivorIds: [playerId, 'other'], entries: [],
        roundEliminatedIds: [], eliminatedIds: [], remainingMs: 0, durationMs: 20000 });
      return clean && penaveSnapshot.instanceId === 'second-game' &&
        document.getElementById('penaveThemeOverlayText').textContent === 'Nouveau thème';
    })()`);
    assert(cleanup);
    console.log("Deuxième partie simulée : overlays et clés audio réinitialisés");
    assert.deepEqual(errors.filter((error) => !error.includes("/favicon.ico")), []);
    console.log("Console navigateur : aucune exception ni erreur de jeu (favicon absent : 404)");
  } finally { ws.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
