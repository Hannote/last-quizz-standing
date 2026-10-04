"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.LQS_TEST_BASE;
if (!BASE) throw new Error("LQS_TEST_BASE doit pointer vers la copie temporaire isolée.");
const URL = process.env.LQS_TEST_URL || "http://127.0.0.1:3000/";
const captureDir = path.join(BASE, "captures");
fs.mkdirSync(captureDir, { recursive: true });
const report = { scenarios: [], consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], audio: [] };
let browser;

function log(name, status, method, detail = {}) {
  const row = { name, status, method, ...detail };
  report.scenarios.push(row);
  console.log("SCENARIO", JSON.stringify(row));
}
function watch(page, label) {
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push({ label, text: message.text() }); });
  page.on("pageerror", (error) => report.pageErrors.push({ label, text: error.message }));
  page.on("requestfailed", (request) => report.failedRequests.push({ label, url: request.url(), error: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) report.httpErrors.push({ label, status: response.status(), url: response.url() }); });
}
async function instrument(page) {
  await page.evaluate(() => {
    window.__auditEvents = [];
    socket.onAny((name, payload) => window.__auditEvents.push({
      name, at: Date.now(), index: payload?.index, total: payload?.total,
      phase: payload?.phase, roomCode: payload?.roomCode
    }));
  });
}
async function newPlayer(label, pseudo, width = 375) {
  const context = await browser.newContext({ viewport: { width, height: 812 } });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator("#btn-enter-game").click();
  await page.locator("#pseudoInput").fill(pseudo);
  await instrument(page);
  return { context, page, label };
}
async function join(player, code) {
  await player.page.locator("#roomCodeInput").fill(code);
  await player.page.locator("#joinRoomBtn").click();
  await player.page.waitForFunction((expected) => currentRoom?.roomCode === expected, code, { timeout: 10000 });
}
async function phase(page, expected, timeout = 20000) {
  await page.waitForFunction((value) => currentGameState?.phase === value, expected, { timeout });
}
async function snapshot(page) {
  return page.evaluate(() => ({
    roomCode: currentRoom?.roomCode, mode: currentRoom?.gameMode,
    playerCount: currentRoom?.players?.length, hostId: currentRoom?.hostId,
    playerId, phase: currentGameState?.phase, mini: currentGameState?.currentMiniGame
  }));
}
async function count(page, event) {
  return page.evaluate((name) => window.__auditEvents?.filter((item) => item.name === name).length || 0, event);
}
async function replacement(player, code, label) {
  const old = player.page;
  const fresh = await player.context.newPage();
  watch(fresh, label);
  await fresh.goto(URL, { waitUntil: "domcontentloaded" });
  await fresh.waitForFunction((expected) => currentRoom?.roomCode === expected && currentGameState?.phase === "playing", code, { timeout: 15000 });
  await instrument(fresh);
  const oldBefore = await count(old, "roomUpdate");
  const freshBefore = await count(fresh, "roomUpdate");
  await old.evaluate(() => socket.emit("requestRoomState"));
  await fresh.evaluate(() => socket.emit("requestRoomState"));
  await fresh.waitForFunction((n) => window.__auditEvents?.filter((item) => item.name === "roomUpdate").length > n, freshBefore);
  await old.waitForTimeout(300);
  const oldAfter = await count(old, "roomUpdate");
  assert.equal(oldAfter, oldBefore, "ancien socket a reçu un état");
  return { old, fresh, oldBefore, oldAfter, freshBefore, freshAfter: await count(fresh, "roomUpdate") };
}
async function portrait(page, prefix) {
  const measurements = [];
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(120);
    const value = await page.evaluate(() => {
      const button = document.querySelector("#leaveRoomBtn");
      const rect = button.getBoundingClientRect();
      return {
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        quitVisible: getComputedStyle(button).display !== "none" && rect.top >= 0 &&
          rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
        quitRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    });
    measurements.push(value);
    await page.screenshot({ path: path.join(captureDir, prefix + "-" + width + ".png") });
  }
  return measurements;
}
async function main() {
  browser = await chromium.launch({
    executablePath: process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true, args: ["--no-sandbox"]
  });
  try {
    const host = await newPlayer("br-host", "HoteBR");
    const guestA = await newPlayer("br-guest-a", "A".repeat(32));
    const guestB = await newPlayer("br-guest-b", "B".repeat(33));
    await host.page.locator("#createRoomBtn").click();
    await host.page.waitForFunction(() => currentRoom?.roomCode);
    const code = (await snapshot(host.page)).roomCode;
    await guestA.page.locator("#pseudoInput").evaluate((input) => input.maxLength = 40); await guestA.page.locator("#pseudoInput").fill("A".repeat(32));
    await join(guestA, code);
    assert.equal((await snapshot(guestA.page)).playerCount, 2);
    log("pseudo 32", "réussi", "Edge/Playwright, limite HTML relevée uniquement pour ce cas ciblé", { code });
    await guestB.page.locator("#pseudoInput").evaluate((input) => input.maxLength = 40); await guestB.page.locator("#pseudoInput").fill("B".repeat(33));
    await guestB.page.locator("#roomCodeInput").fill(code);
    await guestB.page.locator("#joinRoomBtn").click();
    await guestB.page.waitForTimeout(1200);
    const rejection = await guestB.page.locator("#errorLobby").innerText();
    assert.match(rejection, /Message invalide/);
    assert.equal((await snapshot(guestB.page)).roomCode, undefined);
    await guestB.page.locator("#pseudoInput").fill("InviteB");
    await guestB.page.locator("#joinRoomBtn").click();
    await guestB.page.waitForFunction((expected) => currentRoom?.roomCode === expected, code);
    assert.equal((await snapshot(host.page)).playerCount, 3);
    log("pseudo 33 puis correction", "réussi", "Edge/Playwright, limite HTML relevée uniquement pour ce cas ciblé", { rejection });
    const measures = await portrait(guestA.page, "br-lobby");
    log("portrait lobby 320/375/430", measures.every((m) => m.scrollWidth <= m.width && m.quitVisible) ? "réussi" : "échec", "Edge/Playwright", { measurements: measures });
    await host.page.locator("#sandboxToggle").isChecked().then((checked) => assert.equal(checked, false));
    await host.page.locator("#startGameBtn").click();
    await phase(host.page, "intro", 10000);
    await phase(host.page, "rules", 90000);
    log("Battle Royale normal à trois joueurs", "réussi", "Edge/Playwright, interface sans bac à sable", { code, players: (await snapshot(host.page)).playerCount });
    for (const p of [host, guestA, guestB]) await p.page.locator("#readyBtn").click();
    await phase(host.page, "playing", 30000);
    const playing = await snapshot(host.page);
    await host.page.screenshot({ path: path.join(captureDir, "br-question-375.png") });
    const hostReplacement = await replacement(host, code, "br-host-replacement");
    const guestReplacement = await replacement(guestA, code, "br-guest-replacement");
    log("reconnexions hôte et invité pendant question BR", "réussi", "Edge/Playwright, nouveaux onglets partageant chacun le stockage du joueur ; requête d'état ciblée", {
      mini: playing.mini, hostOldIgnored: hostReplacement.oldAfter === hostReplacement.oldBefore,
      guestOldIgnored: guestReplacement.oldAfter === guestReplacement.oldBefore
    });
    const audio = await hostReplacement.fresh.evaluate(() => ({
      howls: window.Howler?._howls?.length ?? null,
      contextState: window.Howler?.ctx?.state ?? null
    }));
    report.audio.push({ label: "br-host-replacement", ...audio });
  } catch (error) {
    log("parcours Battle Royale et lobby", "échec", "Edge/Playwright", { error: error.message });
  } finally {
    await browser.close();
    if (report.scenarios.some((item) => item.status === "échec")) process.exitCode = 1;
    fs.writeFileSync(path.join(BASE, "captures", "browser-report.json"), JSON.stringify(report, null, 2));
    console.log("ERRORS", JSON.stringify({ console: report.consoleErrors.length, page: report.pageErrors.length, requests: report.failedRequests.length, http: report.httpErrors.length }));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });





