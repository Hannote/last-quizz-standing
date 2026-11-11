"use strict";

// Serveur local existant, historiques isolés côté serveur. Firefox Playwright dédié.
// LQS_PLAYWRIGHT_MODULE pointe vers l'installation d'outillage hors dépendances du jeu.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { firefox } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.LQS_TEST_URL || "http://127.0.0.1:3000/";
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname), "Essais réservés au serveur local");
const output = path.resolve(process.env.LQS_TEST_OUTPUT || ".test-run/socket-hardening/firefox");
fs.mkdirSync(output, { recursive: true });
const games = {
  qui_suis_je: { event: "quiSuisJeQuestion", input: "qsjInput", submit: "qsjValidateBtn", image: "qsjMainImage", bank: "qui_suis_je" },
  blind_test: { event: "blindTestQuestion", input: "btInput", submit: "btValidateBtn", bank: "blind_test" },
  le_tour_du_monde: { event: "leTourDuMondeQuestion", input: "tdmInput", submit: "tdmValidateBtn", image: "tdmMainImage", bank: "le_tour_du_monde" },
  qui_veut_gagner_des_leugtas: { event: "leugtasQuestion", reveal: "leugtasReveal", bank: "qui_veut_gagner_des_leugtas" },
  le_faux_du_vrai: { event: "fauxVraiQuestion", reveal: "fauxVraiReveal", bank: "le_faux_du_vrai" }
};
const report = { scenarios: [], pageErrors: [], consoleErrors: [], httpErrors: [], privateFields: [] };
if (process.env.LQS_TEST_RESUME === "1" && fs.existsSync(path.join(output, "report.json"))) {
  Object.assign(report, JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8")));
}
function checkPublic(event, payload) {
  if (!Object.values(games).some(game => game.event === event)) return;
  const forbidden = new Set(["correct_answer_id", "correctAnswerId", "indexFausse", "answer", "reponse", "reponse_texte", "image_reponse", "pool"]);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { assert(!forbidden.has(key), event + ": " + key); visit(child); }
  }
  visit(payload);
  if (event === "leugtasQuestion") {
    assert.deepEqual(Object.keys(payload.question).sort(), ["answers", "question"]);
    payload.question.answers.forEach(choice => assert.deepEqual(Object.keys(choice).sort(), ["id", "text"]));
  }
}
async function untilPacket(client, event, predicate = () => true, after = 0, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = client.packets.slice(after).find(packet => packet.event === event && predicate(packet.payload));
    if (found) return found.payload;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Délai ${event}: ${JSON.stringify(client.packets.slice(-4))}`);
}
async function newClient(browser, pseudo) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const packets = [];
  const record = body => {
    if (typeof body !== "string") return;
    for (const frame of body.split("\x1e")) {
      if (!frame.startsWith("42")) continue;
      const [event, payload] = JSON.parse(frame.slice(2));
      packets.push({ event, payload });
      try { checkPublic(event, payload); } catch (error) { report.privateFields.push(error.message); }
    }
  };
  page.on("websocket", ws => ws.on("framereceived", frame => {
    if (typeof frame.payload !== "string") return;
    // Firefox peut exposer les octets UTF-8 des trames comme une chaîne Latin-1.
    const decoded = Buffer.from(frame.payload, "latin1").toString("utf8");
    record(!decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").toString("latin1") === frame.payload ? decoded : frame.payload);
  }));
  page.on("pageerror", error => report.pageErrors.push({ pseudo, message: error.message }));
  page.on("console", message => { if (message.type() === "error") report.consoleErrors.push({ pseudo, message: message.text() }); });
  page.on("response", async response => {
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
    if (response.url().includes("/socket.io/") && response.url().includes("transport=polling") && response.status() === 200) {
      try { record(await response.text()); } catch { /* Navigation ayant fermé une requête en cours. */ }
    }
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof socket !== "undefined" && socket.connected);
  await page.locator("#btn-enter-game").click();
  await page.locator("#pseudoInput").fill(pseudo);
  return { context, page, packets };
}
async function join(client, code) {
  await client.page.locator("#roomCodeInput").fill(code);
  await client.page.locator("#joinRoomBtn").click();
  return untilPacket(client, "roomJoined", room => room.roomCode === code);
}
async function scenario(browser, mode, gameId) {
  const game = games[gameId];
  const clients = [];
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "../public_2", game.bank, game.bank + ".json"), "utf8")).questions;
  try {
    for (const name of ["Hôte Firefox", "Alice Firefox", "Bob Firefox"]) clients.push(await newClient(browser, name));
    const [host] = clients;
    await host.page.locator("#createRoomBtn").click();
    const room = await untilPacket(host, "roomJoined");
    await Promise.all(clients.slice(1).map(client => join(client, room.roomCode)));
    await host.page.waitForFunction(() => currentRoom.players.length === 3);
    if (mode === "liste") {
      await host.page.locator('[data-game-mode="liste"]').click();
      await host.page.waitForFunction(() => currentRoom.gameMode === "liste");
      await host.page.locator("#listeGameCount").selectOption("1");
      await host.page.locator("#listeSelectionMethod").selectOption("manual");
      await host.page.locator(`#listeGameChoices input[value="${gameId}"]`).check();
      await host.page.locator("#listeConfigSubmit").click();
      await untilPacket(host, "listeConfigResult", result => result.ok);
    } else {
      await host.page.locator("#sandboxToggle").check();
      await host.page.locator("#sandboxMiniGameSelect").selectOption(gameId);
    }
    await host.page.locator("#startGameBtn").click();
    await host.page.waitForFunction(() => currentGameState.phase !== "idle");
    let spectator;
    if (mode === "battle_royale") {
      spectator = await newClient(browser, "Spectateur tardif");
      clients.push(spectator);
      const joined = await join(spectator, room.roomCode);
      const id = await spectator.page.evaluate(() => playerId);
      assert(joined.players.find(player => player.playerId === id).isSpectator);
    }
    await untilPacket(host, "gameStateUpdate", state => state.phase === "rules", 0, 90000);
    await Promise.all(clients.slice(0, 3).map(client => client.page.locator("#readyBtn").click()));
    let question = await untilPacket(host, game.event);
    const count = question.total;
    for (let index = 1; index <= count; index++) {
      question = await untilPacket(host, game.event, q => q.index === index);
      await Promise.all(clients.slice(0, 3).map(client => untilPacket(client, game.event, q => q.index === index)));
      if (index === 1) {
        const previous = host.packets.length;
        const id = await host.page.evaluate(() => playerId);
        await host.page.reload({ waitUntil: "domcontentloaded" });
        await untilPacket(host, "roomJoined", r => r.roomCode === room.roomCode, previous);
        const restored = await untilPacket(host, game.event, q => q.index === index, previous);
        assert.equal(await host.page.evaluate(() => playerId), id);
        assert.deepEqual(restored.question, question.question);
        assert.equal((await host.page.evaluate(() => currentRoom.players.find(player => player.playerId === playerId))).isSpectator, false);
      }
      checkPublic(game.event, question);
      if (game.image) {
        await host.page.waitForFunction(id => { const image = document.getElementById(id); return image?.complete && image.naturalWidth > 0; }, game.image);
      }
      if (gameId === "blind_test") {
        await host.page.waitForFunction(() => { const audio = document.getElementById("btMainAudio"); return audio.currentSrc && audio.readyState >= 2; });
      }
      const q = bank.find(q => gameId === "blind_test" ? q.audio_question === question.question.audio
        : gameId === "le_tour_du_monde" ? q.text === question.question.text && q.image === question.question.image
        : gameId === "qui_suis_je" ? q.image_question === question.question.image_question
        : gameId === "le_faux_du_vrai" ? q.question === question.question && JSON.stringify(q.affirmations) === JSON.stringify(question.affirmations)
        : q.question === question.question.question);
      assert(q, `Question locale introuvable : ${mode} ${gameId} ${JSON.stringify(question)}`);
      const before = host.packets.length;
      await Promise.all(clients.slice(0, 3).map(async (client, playerIndex) => {
        const clientBefore = client.packets.length;
        if (gameId === "qui_veut_gagner_des_leugtas") {
          const answerId = playerIndex ? q.answers.find(a => a.id !== q.correct_answer_id).id : q.correct_answer_id;
          await client.page.locator(`#playingChoices button[data-answer-id="${answerId}"]`).click();
          await untilPacket(client, "leugtasFeedback", feedback => feedback.status === (playerIndex ? "bad" : "good"), clientBefore);
        } else if (gameId === "le_faux_du_vrai") {
          await client.page.locator(".fauxvrai-answer-btn").nth(playerIndex ? (q.indexFausse + 1) % 5 : q.indexFausse).click();
        } else {
          await client.page.locator("#" + game.input).fill(q.reponse || q.answer || q.reponse_texte);
          await client.page.locator("#" + game.submit).click();
        }
      }));
      if (game.reveal) {
        const reveal = await untilPacket(host, game.reveal, () => true, before);
        assert.equal(gameId === "le_faux_du_vrai" ? reveal.indexFausse : reveal.correctAnswerId,
          gameId === "le_faux_du_vrai" ? q.indexFausse : q.correct_answer_id);
      }
      if (index === 1 && spectator) {
        await spectator.page.locator("#leaveRoomBtn").click();
        const checkpoint = host.packets.length;
        await spectator.page.locator("#confirmQuitBtn").click();
        await host.page.waitForFunction(() => !currentRoom.players.some(player => player.pseudo === "Spectateur tardif"));
        assert(!host.packets.slice(checkpoint).some(p => ["playerEliminated", "playFinaleAnimation", "gameOver"].includes(p.event)));
      }
      if (index === 1) await host.page.screenshot({ path: path.join(output, mode + "-" + gameId + "-first.png"), fullPage: true });
    }
    if (!game.reveal) {
      const correction = await untilPacket(host, "correctionUpdate");
      assert(correction.answerText);
      await host.page.locator("#corrTextAnswer").waitFor({ state: "visible" });
      let grader;
      for (const client of clients.slice(0, 3)) {
        if (await client.page.evaluate(() => currentRoom.hostId === playerId)) grader = client;
      }
      assert(grader, "Hôte courant disponible après reconnexion");
      await grader.page.locator("#gradingControls .grade-1").click();
      await untilPacket(host, "scoreUpdate", score => score.players.some(player => player.score === 1));
      const before = host.packets.length;
      await host.page.reload({ waitUntil: "domcontentloaded" });
      const restored = await untilPacket(host, "correctionUpdate", () => true, before);
      assert.equal(restored.answerText, correction.answerText);
      assert.equal(restored.currentGrade, 1);
    } else {
      const score = await untilPacket(host, "scoreUpdate", score => score.players.some(player => player.score === count));
      assert.equal(score.players.length, 3);
    }
    const widths = [];
    for (const width of [320, 375, 430]) {
      await host.page.setViewportSize({ width, height: 812 });
      widths.push(await host.page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })));
    }
    await host.page.screenshot({ path: path.join(output, mode + "-" + gameId + "-correction.png"), fullPage: true });
    const result = { mode, game: gameId, questions: count, participantReconnected: true,
      lateSpectator: mode === "battle_royale", correction: true, widths,
      questionMessages: clients.reduce((count, client) => count + client.packets.filter(p => p.event === game.event).length, 0) };
    report.scenarios.push(result);
    console.log(JSON.stringify(result));
  } finally {
    fs.writeFileSync(path.join(output, mode + "-" + gameId + "-packets.json"), JSON.stringify(clients.map(client => client.packets)));
    await Promise.all(clients.map(client => client.context.close()));
  }
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    for (const game of (process.env.LQS_TEST_GAMES || Object.keys(games).join(",")).split(",")) {
      const modes = (process.env.LQS_TEST_MODES || "battle_royale,liste").split(",")
        .filter(mode => !report.scenarios.some(result => result.mode === mode && result.game === game));
      const results = await Promise.allSettled(modes.map(mode => scenario(browser, mode, game)));
      const failed = results.filter(result => result.status === "rejected");
      if (failed.length) throw new AggregateError(failed.map(result => result.reason));
    }
    assert.deepEqual(report.privateFields, []);
    assert.deepEqual(report.pageErrors, []);
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
