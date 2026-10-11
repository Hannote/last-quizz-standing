"use strict";
const assert = require("node:assert/strict");
const { chromium } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");

const url = process.env.LQS_TEST_URL || "http://127.0.0.1:3000/";
const pseudo = "<svg onload=window.__inj=1>";
const answer = '<img src=x onerror="window.__inj=1"> Café & été';

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--no-sandbox"]
  });
  const errors = [];
  const consoleErrors = [];
  const httpErrors = [];
  try {
    const host = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const guest = await browser.newPage({ viewport: { width: 320, height: 812 } });
    for (const page of [host, guest]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url });
      });
      page.on("response", (response) => {
        if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => { window.__inj = 0; });
      await page.locator("#btn-enter-game").click();
    }
    await host.locator("#pseudoInput").evaluate((input) => { input.maxLength = 32; });
    await host.locator("#pseudoInput").fill(pseudo);
    await host.locator("#createRoomBtn").click();
    await host.waitForFunction(() => currentRoom?.roomCode);
    const code = await host.evaluate(() => currentRoom.roomCode);
    await guest.locator("#pseudoInput").fill("Invité");
    await guest.locator("#roomCodeInput").fill(code);
    await guest.locator("#joinRoomBtn").click();
    await guest.waitForFunction((expected) => currentRoom?.roomCode === expected && currentRoom.players.length === 2, code);
    for (const page of [host, guest]) {
      assert.equal(await page.locator("#playersList").locator("svg").count(), 0);
      assert.ok((await page.locator("#playersList").innerText()).includes(pseudo));
      assert.equal(await page.evaluate(() => window.__inj), 0);
    }
    await host.setViewportSize({ width: 430, height: 812 });
    const result = await host.evaluate(async ({ pseudo, answer }) => {
      const fire = (name, data) => socket.listeners(name).forEach((handler) => handler(data));
      const noInjection = (selector) => {
        const node = document.querySelector(selector);
        return { text: node.textContent, injected: node.querySelector("svg,img[onerror]")?.outerHTML || null, flag: window.__inj };
      };
      document.getElementById("showPlayersBtn").click();
      const modal = noInjection("#modalPlayersList");
      fire("errorMessage", answer);
      const error = noInjection("#errorRoom");
      currentGameState = { phase: "playing", roundNumber: 1, currentMiniGame: "petit_bac" };
      handleInterimLeaderboard([{ nickname: pseudo, score: 3, time: 1 }, { nickname: "Invité", score: 1, time: 2 }], null, 4000, "CLASSEMENT FINAL");
      const interim = noInjection("#leaderboard-content");
      renderListeLeaderboard({ isFinal: true, winners: ["p1"], ranking: [
        { playerId: "p1", pseudo, place: 1, tournamentPoints: 2, tournamentTime: 1 }
      ] });
      const liste = noInjection("#liste-leaderboard-overlay");
      handlePetitBacCorrection({ playerPseudo: pseudo, petitBacData: {
        letter: "C", categories: ["Catégorie"], answers: { 0: answer }, savedDetails: {}
      } }, document.getElementById("petitBacCorrectionContainer"));
      const pb = noInjection("#pbCorrList");
      const emitted = [];
      const originalEmit = socket.emit;
      socket.emit = function (name, ...args) { emitted.push(name); return originalEmit.call(this, name, ...args); };
      document.querySelector("#pbCorrList .pb-1").click();
      const pbButton = document.querySelector("#pbCorrList .pb-1").classList.contains("active");
      fire("encheresNewBid", { playerId: currentRoom.hostId, amount: 5 });
      const bids = noInjection("#encheresHistory");
      fire("encheresLiveAnswerUpdate", { answers: [answer] });
      const live = noInjection("#encheresLiveAnswersList");
      fire("encheresStartCorrection", { answers: [answer], target: 1 });
      const correction = noInjection("#encheresCorrectionList");
      document.querySelector("#encheresCorrectionList .btn-ok").click();
      const correctionButton = !!document.querySelector("#encheresCorrectionList .btn-ok");
      socket.emit = originalEmit;
      runEliminationSequence([{ nickname: pseudo, score: 0, time: 1 }], () => {});
      const elimination = noInjection("#palierOverlayText");
      const typed = document.createElement("div");
      document.body.appendChild(typed);
      const typedPromise = typeText(pseudo, typed, 0);
      runGlobalVictoryAnim(pseudo);
      const victory = noInjection(".victory-overlay");
      runFinaleAnimation(pseudo, pseudo);
      await typedPromise;
      return { modal, error, interim, liste, pb, pbButton, bids, live, correction, correctionButton, emitted,
        elimination, victory, typed: { text: typed.textContent, html: typed.querySelector("svg")?.outerHTML || null, flag: window.__inj } };
    }, { pseudo, answer });
    const typed = result.typed;
    for (const item of [result.modal, result.error, result.interim, result.liste, result.pb, result.bids,
      result.live, result.correction, result.elimination, result.victory]) {
      assert.equal(item.injected, null);
      assert.equal(item.flag, 0);
    }
    assert.ok(result.modal.text.includes(pseudo));
    assert.ok(result.error.text.includes(answer));
    assert.ok(result.interim.text.includes(pseudo));
    assert.ok(result.liste.text.includes(pseudo));
    assert.ok(result.pb.text.includes(answer));
    assert.ok(result.bids.text.includes(pseudo));
    assert.ok(result.live.text.includes(answer));
    assert.ok(result.correction.text.includes(answer));
    assert.ok(result.elimination.text.includes("EST À TERRE"));
    assert.ok(result.victory.text.includes(pseudo));
    assert.equal(result.pbButton, true);
    assert.equal(result.correctionButton, true);
    assert.ok(result.emitted.includes("hostGradePlayer"));
    assert.ok(result.emitted.includes("encheresToggleCorrection"));
    assert.equal(typed.html, null);
    assert.equal(typed.flag, 0);
    assert.equal(typed.text, pseudo);
    await host.waitForFunction((value) => document.querySelector(".yugi-dialogue-text")?.textContent.includes(value), pseudo, { timeout: 10000 });
    assert.deepEqual(await host.evaluate(() => ({
      text: document.querySelector(".yugi-dialogue-text").textContent,
      injected: document.querySelector(".yugi-dialogue-text svg")?.outerHTML || null,
      flag: window.__inj
    })).then((value) => ({ injected: value.injected, flag: value.flag })), { injected: null, flag: 0 });
    assert.deepEqual(errors, []);
    console.log("Edge/Playwright : lobby multiclient, classements, Petit Bac, Enchères et animations sûrs.");
    console.log("Console navigateur :", JSON.stringify(consoleErrors));
    console.log("Réponses HTTP en erreur :", JSON.stringify(httpErrors));
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
