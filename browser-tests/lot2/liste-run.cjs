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

async function makeListe(game, tag) {
  const host = await newPlayer(tag + "-host", "Hote" + tag);
  const guestA = await newPlayer(tag + "-guest-a", "Alice" + tag);
  const guestB = await newPlayer(tag + "-guest-b", "Bob" + tag);
  await host.page.locator("#createRoomBtn").click();
  await host.page.waitForFunction(() => currentRoom?.roomCode);
  const code = (await snapshot(host.page)).roomCode;
  await join(guestA, code); await join(guestB, code);
  await host.page.locator('[data-game-mode="liste"]').click();
  await host.page.waitForFunction(() => currentRoom?.gameMode === "liste");
  await host.page.locator("#listeGameCount").selectOption("1");
  await host.page.locator("#listeSelectionMethod").selectOption("manual");
  await host.page.locator('#listeGameChoices input[value="' + game + '"]').check();
  await host.page.locator("#listeConfigSubmit").click();
  await host.page.waitForFunction(() => currentRoom?.listeConfig?.gameCount === 1, null, { timeout: 10000 });
  await host.page.locator("#startGameBtn").click();
  await phase(host.page, "rules", 30000);
  for (const p of [host,guestA,guestB]) await p.page.locator("#readyBtn").click();
  await phase(host.page, "playing", 30000);
  return { host,guestA,guestB,code };
}
async function waitUnblocked(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el && !el.disabled && !el.classList.contains("btn-locked-intro") && getComputedStyle(el).display !== "none";
  }, selector, {timeout: 15000});
}
async function answerQ(page, value) {
  await waitUnblocked(page, "#qsjValidateBtn");
  await page.locator("#qsjInput").fill(value);
  await page.locator("#qsjValidateBtn").click();
}
async function main() {
  browser = await chromium.launch({ executablePath:process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless:true, args:["--no-sandbox"] });
  try {
    const q = await makeListe("qui_suis_je","qsj");
    log("Liste trois joueurs, question normale", "réussi", "Edge/Playwright, interface", {code:q.code, mini:(await snapshot(q.host.page)).mini});
    await q.guestA.page.screenshot({path:path.join(captureDir,"liste-question-375.png")});
    const aBefore = await count(q.guestA.page,"quiSuisJeAnswerAck");
    await answerQ(q.guestA.page,"X".repeat(121));
    await q.guestA.page.waitForTimeout(400);
    const reject = await q.guestA.page.locator("#errorRoom").innerText();
    assert.match(reject,/Message invalide/);
    assert.equal(await count(q.guestA.page,"quiSuisJeAnswerAck"),aBefore);
    await answerQ(q.guestA.page,"X".repeat(120));
    await q.guestA.page.waitForFunction((n)=>window.__auditEvents.filter(e=>e.name==="quiSuisJeAnswerAck").length>n,aBefore);
    log("Réponse libre 121 refusée, 120 acceptée après correction", "réussi", "Edge/Playwright, saisie et bouton", {reject});
    const h = await replacement(q.host,q.code,"qsj-host-new");
    const g = await replacement(q.guestB,q.code,"qsj-guest-new");
    const oldBefore = await count(q.host.page,"quiSuisJeAnswerAck");
    await answerQ(q.host.page,"Ancien");
    await q.host.page.waitForTimeout(350);
    assert.equal(await count(q.host.page,"quiSuisJeAnswerAck"),oldBefore);
    await answerQ(h.fresh,"Nouveau");
    await h.fresh.waitForFunction((n)=>window.__auditEvents.filter(e=>e.name==="quiSuisJeAnswerAck").length>n,0);
    await answerQ(g.fresh,"Invite reconnecte");
    await g.fresh.waitForFunction((n)=>window.__auditEvents.filter(e=>e.name==="quiSuisJeAnswerAck").length>n,0);
    log("Reconnexion hôte/invité Liste, ancien socket inactif", "réussi", "Edge/Playwright, deux pages même stockage et boutons de réponse", {hostOldIgnored:h.oldAfter===h.oldBefore,guestOldIgnored:g.oldAfter===g.oldBefore});
    for (let index = 2; index <= 8; index++) {
      await h.fresh.waitForFunction((i)=>window.__auditEvents.some(e=>e.name==="quiSuisJeQuestion"&&e.index===i),index,{timeout:20000});
      for (const page of [h.fresh,q.guestA.page,g.fresh]) await answerQ(page,"Réponse " + index);
    }
    await h.fresh.locator("#correctionContainer").waitFor({state:"visible",timeout:20000});
    const details = await h.fresh.evaluate(()=>({phase:currentGameState?.phase, score:currentRoom?.players?.map(p=>({pseudo:p.pseudo,score:p.score})), controls:document.querySelector("#gradingControls")?.innerText}));
    console.log("CORRECTION",JSON.stringify(details));
    await h.fresh.screenshot({path:path.join(captureDir,"liste-correction-375.png")});
    await h.fresh.locator(".grade-1").click();
    await h.fresh.waitForTimeout(350);
    const grade1 = await h.fresh.evaluate(()=>({grade:document.querySelector(".grade-1")?.classList.contains("selected"), score:currentRoom?.players?.map(p=>({pseudo:p.pseudo,score:p.score}))}));
    await h.fresh.locator(".grade-05").click();
    await h.fresh.waitForTimeout(350);
    const grade05 = await h.fresh.evaluate(()=>({grade:document.querySelector(".grade-05")?.classList.contains("selected"), score:currentRoom?.players?.map(p=>({pseudo:p.pseudo,score:p.score}))}));
    await h.fresh.locator("#btnNextPlayer").click();
    await h.fresh.waitForTimeout(250);
    await h.fresh.locator("#btnPrevPlayer").click();
    await h.fresh.waitForTimeout(250);
    log("Correction manuelle et révision de note Liste",grade1.grade&&grade05.grade?"réussi":"échec","Edge/Playwright, boutons de correction et navigation",{grade1,grade05});
    report.audio.push({label:"liste-host",...(await h.fresh.evaluate(()=>({howls:window.Howler?._howls?.length??null,contextState:window.Howler?.ctx?.state??null})))});
    const measures = await portrait(h.fresh,"liste-correction");
    log("portrait Liste correction 320/375/430",measures.every(m=>m.scrollWidth<=m.width&&m.quitVisible)?"réussi":"échec","Edge/Playwright",{measurements:measures});
  } catch(error) {
    log("Liste Qui suis-je/correction","échec","Edge/Playwright",{error:error.message,stack:error.stack?.slice(0,1400)});
  }
  try {
    const p = await makeListe("petit_bac","pb");
    await p.guestA.page.waitForFunction(()=>{const x=document.querySelector("#pbFormZone input");return x&&getComputedStyle(x).display!=="none"},null,{timeout:15000});
    await p.guestA.page.waitForFunction(()=>window.__auditEvents.some(e=>e.name==="petitBacTimerUpdate"),null,{timeout:10000});
    const inputCount=await p.guestA.page.locator("#pbFormZone input").count();
    const input=p.guestA.page.locator("#pbFormZone input").first();
    const ackBefore=await count(p.guestA.page,"petitBacAnswerAck");
    await input.fill("Y".repeat(121));
    await p.guestA.page.locator("#pbValidateBtn").click();
    await p.guestA.page.waitForTimeout(400);
    const rejection=await p.guestA.page.locator("#errorRoom").innerText();
    assert.match(rejection,/Message invalide/);
    assert.equal(await count(p.guestA.page,"petitBacAnswerAck"),ackBefore);
    await input.fill("Y".repeat(120));
    await p.guestA.page.locator("#pbValidateBtn").click();
    await p.guestA.page.waitForFunction((n)=>window.__auditEvents.filter(e=>e.name==="petitBacAnswerAck").length>n,ackBefore);
    log("Petit Bac 121 refusée, 120 acceptée après correction", "réussi","Edge/Playwright, formulaire et bouton",{inputCount,rejection});
    await p.guestA.page.screenshot({path:path.join(captureDir,"liste-petit-bac-375.png")});
  } catch(error) {
    log("Liste Petit Bac","échec","Edge/Playwright",{error:error.message,stack:error.stack?.slice(0,1400)});
  } finally {
    await browser.close();
    if (report.scenarios.some((item) => item.status === "échec")) process.exitCode = 1;
    fs.writeFileSync(path.join(captureDir,"liste-report.json"),JSON.stringify(report,null,2));
    console.log("ERRORS",JSON.stringify({console:report.consoleErrors.length,page:report.pageErrors.length,requests:report.failedRequests.length,http:report.httpErrors.length}));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});


