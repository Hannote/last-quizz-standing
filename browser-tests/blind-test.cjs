"use strict";

// Lancer npm start avec LQS_HISTORY_FILE pointant vers un historique temporaire.
// Réutilise Playwright s'il est installé séparément, sans ajouter de dépendance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.LQS_TEST_URL || "http://127.0.0.1:3000/";
const out = path.resolve(".test-run/blind-test");
fs.mkdirSync(out, { recursive: true });
const report = { modes: [], pageErrors: [], consoleErrors: [], httpErrors: [] };
const save = () => fs.writeFileSync(path.join(out, "browser-report.json"), JSON.stringify(report, null, 2));

async function observe(page) {
  await page.evaluate(() => {
    window.btTestEvents = [];
    socket.onAny((name, data) => window.btTestEvents.push({ name, data }));
  });
}

async function last(page, name) {
  return page.evaluate(name => window.btTestEvents.filter(e => e.name === name).at(-1)?.data, name);
}

async function layout(page, label, mode) {
  const measurements = [];
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    const size = await page.evaluate(() => {
      const quit = document.querySelector("#leaveRoomBtn");
      const rect = quit.getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        quitVisible: rect.width > 0 && rect.height > 0 && getComputedStyle(quit).display !== "none" && rect.top >= 0 &&
          rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth };
    });
    measurements.push(size);
    assert.ok(size.scrollWidth <= size.width && (label === "correction" || size.quitVisible),
      `${mode} ${label}: ${JSON.stringify(size)}`);
    if (width === 320) await page.screenshot({ path: path.join(out, `${mode}-${label}-320.png`) });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  return measurements;
}

async function run() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
  try {
    for (const mode of ["battle_royale", "liste"]) {
      const players = [];
      const result = { mode, questions: [], layouts: {}, reconnected: [] };
      report.modes.push(result);
      for (const name of ["HoteBlind", "JoueurDeuxPseudoLong", "JoueurTrois"]) {
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const page = await context.newPage();
        page.on("pageerror", e => report.pageErrors.push({ mode, name, error: e.message }));
        page.on("console", e => { if (e.type() === "error") report.consoleErrors.push({ mode, name,
          error: e.text(), location: e.location() }); });
        page.on("response", r => { if (r.status() >= 400) report.httpErrors.push({ mode, url: r.url(), status: r.status() }); });
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => socket.connected);
        await observe(page);
        await page.locator("#btn-enter-game").click();
        await page.locator("#pseudoInput").fill(name);
        players.push({ context, page });
      }
      const host = players[0].page;
      await host.locator("#createRoomBtn").click();
      await host.waitForFunction(() => currentRoom?.roomCode);
      const code = await host.evaluate(() => currentRoom.roomCode);
      for (const { page } of players.slice(1)) {
        await page.locator("#roomCodeInput").fill(code);
        await page.locator("#joinRoomBtn").click();
        await page.waitForFunction(code => currentRoom?.roomCode === code, code);
      }
      await host.waitForFunction(() => currentRoom.players.length === 3);
      if (mode === "liste") {
        await host.locator('[data-game-mode="liste"]').click();
        await host.waitForFunction(() => currentRoom.gameMode === "liste");
        await host.locator("#listeGameCount").selectOption("1");
        await host.locator("#listeSelectionMethod").selectOption("manual");
        await host.locator('#listeGameChoices input[value="blind_test"]').check();
        await host.locator("#listeConfigSubmit").click();
        await host.waitForFunction(() => currentRoom.listeConfig.selectedMiniGames.includes("blind_test"));
      } else {
        await host.locator("#sandboxToggle").check();
        await host.locator("#sandboxMiniGameSelect").selectOption("blind_test");
      }
      await host.locator("#startGameBtn").click();
      console.log(`${mode}: attente des règles`);
      await host.waitForFunction(() => currentGameState?.phase === "rules", null, { timeout: 90000 });
      assert.match(await host.locator("#rulesGameText").textContent(), /Neuf.*dessins animés/);
      for (const { page } of players) await page.locator("#readyBtn").click();
      for (let q = 1; q <= 9; q++) {
        await host.waitForFunction(q => window.btTestEvents.filter(e => e.name === "blindTestQuestion")
          .at(-1)?.data?.index === q, q);
        await host.waitForFunction(q => document.querySelector("#btQuestionNumber")?.textContent === `Question ${q} / 9` &&
          !document.querySelector("#btInput").disabled, q);
        const data = await last(host, "blindTestQuestion");
        result.questions.push({ id: data.question.id, theme: data.question.theme_id, index: data.index, total: data.total });
        if (q === 1) result.layouts.question = await layout(host, "question", mode);
        for (let p = 0; p < players.length; p++) {
          const page = players[p].page;
          if (q === 5 && p === 2) {
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForFunction(code => socket.connected && currentRoom?.roomCode === code, code);
            await observe(page);
            await page.waitForFunction(() => document.querySelector("#btQuestionNumber")?.textContent === "Question 5 / 9" &&
              !document.querySelector("#btInput").disabled);
            result.reconnected.push("question5");
          }
          await page.waitForFunction(() => document.querySelector("#btMainAudio").readyState >= 2 &&
            !document.querySelector("#btMainAudio").error);
          await page.locator("#btInput").fill(`Réponse ${q} joueur ${p}`);
          await page.locator("#btValidateBtn").click();
        }
        console.log(`${mode}: question ${q}/9 validée`);
        save();
      }
      await host.waitForFunction(() => window.btTestEvents.some(e => e.name === "correctionUpdate"));
      for (let q = 1; q <= 9; q++) {
        await host.waitForFunction(q => window.btTestEvents.filter(e => e.name === "correctionUpdate")
          .at(-1)?.data?.currentQIndex === q, q);
        if (q === 1) result.layouts.correction = await layout(host, "correction", mode);
        if (q === 9) {
          const guest = players[2].page;
          await guest.reload({ waitUntil: "domcontentloaded" });
          await guest.waitForFunction(code => socket.connected && currentRoom?.roomCode === code, code);
          await guest.waitForFunction(() => document.querySelector("#correctionContainer")?.getClientRects().length > 0);
          result.reconnected.push("correction9");
        }
        for (let p = 0; p < players.length; p++) {
          const before = await last(host, "correctionUpdate");
          assert.equal(before.totalQ, 9);
          await host.locator(`#correctionContainer .grade-${p === 0 ? "1" : "0"}`).click();
          await host.waitForFunction(() => window.btTestEvents.filter(e => e.name === "correctionUpdate").at(-1)?.data?.currentGrade !== null);
          if (p < players.length - 1) {
            const box = await host.locator("#btnNextPlayer").boundingBox();
            await host.locator("#btnNextPlayer").click({ position: { x: box.width - 4, y: box.height / 2 } });
            await host.waitForFunction(pseudo => window.btTestEvents.filter(e => e.name === "correctionUpdate")
              .at(-1)?.data?.playerPseudo !== pseudo, before.playerPseudo);
          }
        }
        await host.locator("#btnNextCorrectionQ").click();
      }
      assert.equal(new Set(result.questions.map(q => q.id)).size, 9);
      assert.deepEqual(result.questions.reduce((counts, q) => {
        counts[q.theme] = (counts[q.theme] || 0) + 1; return counts;
      }, {}), { dessin_anime: 3, television: 1, musique: 5 });
      if (mode === "liste") {
        await host.waitForFunction(() => currentGameState?.phase === "listeFinished", null, { timeout: 45000 });
        result.finished = await host.evaluate(() => ({ phase: currentGameState.phase,
          points: currentRoom.players.map(p => p.tournamentPoints), eliminated: currentRoom.players.some(p => p.eliminated) }));
        assert.equal(result.finished.eliminated, false);
        assert.equal(result.finished.points[0], 3);
      } else {
        await host.waitForFunction(() => currentGameState?.currentMiniGame === "les_encheres" &&
          currentGameState.phase === "rules", null, { timeout: 60000 });
        result.finished = { nextGame: "les_encheres" };
      }
      console.log(`${mode}: neuf corrections et transition terminées`);
      for (const { context } of players) await context.close();
      save();
    }
    assert.deepEqual(report.pageErrors, []);
    // L'application existante ne fournit pas de favicon. Garder ces 404 dans
    // le rapport tout en exigeant le chargement de toutes les ressources du jeu.
    const faviconUrl = new URL("/favicon.ico", base).href;
    assert.deepEqual(report.httpErrors.filter(e => e.url !== faviconUrl || e.status !== 404), []);
    assert.deepEqual(report.consoleErrors.filter(e => e.location.url !== faviconUrl || !/404/.test(e.error)), []);
  } finally {
    await browser.close();
    save();
  }
}

run().catch(e => { report.failure = e.stack; save(); console.error(e); process.exitCode = 1; });
