"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");

const base = process.env.LQS_TEST_BASE;
if (!base) throw new Error("LQS_TEST_BASE requis : copie temporaire isolée.");
const url = process.env.LQS_TEST_URL || "http://127.0.0.1:3000/";
const captures = path.join(base, "captures");
fs.mkdirSync(captures, { recursive: true });
const report = { rounds: [], errors: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(captures, "lot4-full-liste-report.json"), JSON.stringify(report, null, 2));
const games = ["le_faux_du_vrai", "qui_veut_gagner_des_leugtas", "le_bon_ordre", "petit_bac", "qui_suis_je", "blind_test", "le_tour_du_monde"];
let browser;
let activePlayers = [];

async function player(name) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") report.errors.push({ name, kind: "console", text: message.text() }); });
  page.on("pageerror", (error) => report.errors.push({ name, kind: "page", text: error.message }));
  page.on("requestfailed", (request) => report.errors.push({ name, kind: "request", url: request.url(), text: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) report.errors.push({ name, kind: "http", url: response.url(), status: response.status() }); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#btn-enter-game").click();
  await page.locator("#pseudoInput").fill(name);
  await page.evaluate(() => {
    window.__lot4Events = [];
    window.__lot4Actions = [];
    socket.onAny((event, data) => window.__lot4Events.push({ event, data, at: Date.now() }));
    const actions = {
      leugtasQuestion: ["#playingChoices .playing-choice-btn:not([disabled]):not(.btn-locked-intro)", null, 3500],
      fauxVraiQuestion: ["#fauxVraiAnswers .fauxvrai-answer-btn:not(.fv-intro-lock):not(.locked)", null, 3500],
      leBonOrdreQuestion: ["#lboPassBtn:not([disabled]):not(.btn-locked-intro)", null, 3500],
      quiSuisJeQuestion: ["#qsjPassBtn:not([disabled]):not(.btn-locked-intro)", null, 3500],
      leTourDuMondeQuestion: ["#tdmPassBtn:not([disabled]):not(.btn-locked-intro)", null, 3500],
      blindTestQuestion: ["#btPassBtn:not([disabled]):not(.btn-locked-intro)", null, 3500],
      petitBacTimerUpdate: ["#pbValidateBtn:not([disabled])", "pb", 200]
    };
    let petitBacDone = false;
    for (const [event, [selector, special, minimumDelay]] of Object.entries(actions)) {
      socket.on(event, () => {
        if (special === "pb" && petitBacDone) return;
        if (special === "pb") petitBacDone = true;
        const started = Date.now();
        const timer = setInterval(() => {
          if (Date.now() - started > 45000 || currentGameState?.phase !== "playing") { clearInterval(timer); return; }
          if (Date.now() - started < minimumDelay) return;
          const button = document.querySelector(selector);
          if (!button || !button.getClientRects().length) return;
          if (special === "pb") document.querySelector("#pbFormZone input")?.setAttribute("value", "Réponse locale");
          button.click();
          window.__lot4Actions.push({ event, at: Date.now() });
          clearInterval(timer);
        }, 100);
      });
    }
  });
  return { context, page, name };
}

async function state(page) {
  return page.evaluate(() => ({ phase: currentGameState?.phase, mini: currentGameState?.currentMiniGame,
    round: currentGameState?.roundNumber, room: currentRoom?.roomCode,
    players: currentRoom?.players?.map((p) => ({ id: p.playerId, points: p.tournamentPoints, withdrawn: p.withdrawn })) }));
}

async function lastCorrection(page) {
  return page.evaluate(() => window.__lot4Events.filter((e) => e.event === "correctionUpdate").at(-1)?.data);
}

async function correction(page, count) {
  await page.waitForFunction(() => window.__lot4Events.some((e) => e.event === "correctionUpdate"), null, { timeout: 900000 });
  const first = await lastCorrection(page);
  if (first.miniGameType === "petit_bac") {
    for (let p = 0; p < count; p++) {
      const before = await page.evaluate(() => window.__lot4Events.filter((e) => e.event === "correctionUpdate").length);
      await page.locator("#pbCorrList .pb-0").first().waitFor({ state: "visible" });
      for (const button of await page.locator("#pbCorrList .pb-0").all()) await button.click();
      await page.locator("#pbSubmitTotalBtn").click();
      if (p < count - 1) await page.waitForFunction((n) => window.__lot4Events.filter((e) => e.event === "correctionUpdate").length > n + 1, before);
    }
    await page.locator("#pbFinishGameBtn").click();
    return;
  }
  for (let q = 1; q <= first.totalQ; q++) {
    for (let p = 0; p < count; p++) {
      await page.waitForFunction((expected) => window.__lot4Events.filter((e) => e.event === "correctionUpdate").at(-1)?.data?.currentQIndex === expected, q);
      const before = await page.evaluate(() => window.__lot4Events.filter((e) => e.event === "scoreUpdate").length);
      await page.locator("#correctionContainer .grade-0").click();
      await page.waitForFunction((n) => window.__lot4Events.filter((e) => e.event === "scoreUpdate").length > n, before);
      if (p < count - 1) {
        const prior = await lastCorrection(page);
        const box = await page.locator("#btnNextPlayer").boundingBox();
        await page.locator("#btnNextPlayer").click({ position: { x: box.width - 4, y: box.height / 2 } });
        await page.waitForFunction((name) => window.__lot4Events.filter((e) => e.event === "correctionUpdate").at(-1)?.data?.playerPseudo !== name, prior.playerPseudo);
      }
    }
    await page.locator("#btnNextCorrectionQ").click();
    if (q < first.totalQ) await page.waitForFunction((expected) => window.__lot4Events.filter((e) => e.event === "correctionUpdate").at(-1)?.data?.currentQIndex === expected, q + 1);
  }
}

async function main() {
  browser = await chromium.launch({ executablePath: process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--no-sandbox"] });
  try {
    const trio = await Promise.all([player("HoteLot4"), player("AliceLot4"), player("BobLot4")]);
    activePlayers = trio;
    const [host, ...guests] = trio;
    await host.page.locator("#createRoomBtn").click();
    await host.page.waitForFunction(() => currentRoom?.roomCode);
    const code = (await state(host.page)).room;
    for (const guest of guests) {
      await guest.page.locator("#roomCodeInput").fill(code);
      await guest.page.locator("#joinRoomBtn").click();
      await guest.page.waitForFunction((c) => currentRoom?.roomCode === c, code);
    }
    await host.page.locator('[data-game-mode="liste"]').click();
    await host.page.locator("#listeGameCount").selectOption("7");
    await host.page.locator("#listeSelectionMethod").selectOption("manual");
    for (const game of games) await host.page.locator(`#listeGameChoices input[value="${game}"]`).check();
    await host.page.locator("#listeConfigSubmit").click();
    await host.page.waitForFunction(() => currentRoom?.listeConfig?.selectedMiniGames?.length === 7);
    report.config = await host.page.evaluate(() => currentRoom.listeConfig);
    assert.deepEqual([...report.config.selectedMiniGames].sort(), [...games].sort());
    save();
    await host.page.locator("#startGameBtn").click();
    for (let round = 1; round <= 7; round++) {
      await host.page.waitForFunction((n) => currentGameState?.phase === "rules" && currentGameState?.roundNumber === n, round, { timeout: 90000 });
      const start = await state(host.page);
      for (const p of trio) await p.page.evaluate(() => { window.__lot4Events = []; window.__lot4Actions = []; });
      report.active = { round, game: start.mini, at: new Date().toISOString() };
      save();
      console.log("START", JSON.stringify(report.active));
      for (const p of trio) await p.page.locator("#readyBtn").click();
      await host.page.waitForFunction(() => currentGameState?.phase === "playing", null, { timeout: 30000 });
      if (!["le_faux_du_vrai", "qui_veut_gagner_des_leugtas"].includes(start.mini)) await correction(host.page, 3);
      await host.page.waitForFunction(() => currentGameState?.phase === "listeLeaderboard", null, { timeout: 300000 });
      const end = await state(host.page);
      const actionCounts = await Promise.all(trio.map((p) => p.page.evaluate(() => window.__lot4Actions.length)));
      report.rounds.push({ round, game: start.mini, points: end.players, actionCounts });
      save();
      console.log("ROUND", JSON.stringify(report.rounds.at(-1)));
      await host.page.screenshot({ path: path.join(captures, `lot4-liste-round-${round}.png`) });
    }
    await host.page.waitForFunction(() => currentGameState?.phase === "listeFinished", null, { timeout: 30000 });
    report.finished = await state(host.page);
    assert.equal(new Set(report.rounds.map((r) => r.game)).size, 7);
    await host.page.screenshot({ path: path.join(captures, "lot4-liste-final.png") });
    console.log("FINISHED", JSON.stringify(report.finished));
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack?.slice(0, 2000) };
    report.live = await Promise.all(activePlayers.map(async (p) => ({ name: p.name, state: await state(p.page),
      events: await p.page.evaluate(() => window.__lot4Events.slice(-20).map((e) => ({ event: e.event, index: e.data?.index, phase: e.data?.phase }))),
      actions: await p.page.evaluate(() => window.__lot4Actions.slice(-20)) })));
    if (activePlayers[0]) await activePlayers[0].page.screenshot({ path: path.join(captures, "lot4-liste-failure.png") });
    process.exitCode = 1;
    console.error(error);
  } finally {
    report.endedAt = new Date().toISOString();
    save();
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
