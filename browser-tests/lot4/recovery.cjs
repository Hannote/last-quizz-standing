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
  browser=await chromium.launch({executablePath:process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,args:["--no-sandbox"]});
  try {
    const q=await makeListe("qui_suis_je","recover");
    for(let index=1;index<=8;index++){
      if(index>1) await q.host.page.waitForFunction(i=>window.__auditEvents.some(e=>e.name==="quiSuisJeQuestion"&&e.index===i),index,{timeout:20000});
      for(const p of [q.host,q.guestA,q.guestB]) await answerQ(p.page,"Réponse "+index);
    }
    await q.host.page.locator("#correctionContainer").waitFor({state:"visible",timeout:20000});
    const hostReconnect=await replacement(q.host,q.code,"host-correction-new-tab");
    q.host.page=hostReconnect.fresh;
    const guestReconnect=await replacement(q.guestA,q.code,"guest-correction-new-tab");
    q.guestA.page=guestReconnect.fresh;
    log("Reconnexion hôte et invité pendant correction","réussi","Edge/Playwright, nouvel onglet même contexte ; requestRoomState forgé pour vérifier l'ancien socket",{hostOldIgnored:hostReconnect.oldAfter===hostReconnect.oldBefore,guestOldIgnored:guestReconnect.oldAfter===guestReconnect.oldBefore});
    for(let index=1;index<=8;index++){
      await q.host.page.waitForFunction(i=>document.querySelector("#correctionQuestionInfo")?.textContent.includes("Question "+i+" /"),index,{timeout:10000});
      for(let j=0;j<3;j++){
        await q.host.page.locator(j===0?".grade-1":j===1?".grade-05":".grade-0").click();
        await q.host.page.waitForTimeout(70);
        if(j<2){
          const prev=await q.host.page.locator("#gradingPlayerName").innerText();
          const box=await q.host.page.locator("#btnNextPlayer").boundingBox();
          await q.host.page.locator("#btnNextPlayer").click({position:{x:box.width-4,y:box.height/2}});
          await q.host.page.waitForFunction(name=>document.querySelector("#gradingPlayerName")?.textContent!==name,prev,{timeout:5000});
        }
      }
      await q.host.page.locator("#btnNextCorrectionQ").click();
    }
    await phase(q.host.page,"listeLeaderboard",20000);
    const leaderboardPage=await q.guestB.context.newPage();
    watch(leaderboardPage,"guest-leaderboard-new-tab");
    await leaderboardPage.goto(URL,{waitUntil:"domcontentloaded"});
    await phase(leaderboardPage,"listeLeaderboard",8000);
    log("Reconnexion pendant classement","réussi","Edge/Playwright, nouvel onglet même contexte",{code:q.code});
    await phase(q.host.page,"listeFinished",30000);
    const finalPortrait=await portrait(q.host.page,"lot4-liste-final");
    log("Classement final portrait 320/375/430","réussi","Edge/Playwright",{measurements:finalPortrait});

    const w=await makeListe("qui_suis_je","withdraw");
    await w.guestA.page.locator("#leaveRoomBtn").click();
    await w.guestA.page.locator("#confirmQuitBtn").click();
    const withdrawnPage=await w.guestA.context.newPage();
    watch(withdrawnPage,"withdrawn-return");
    await withdrawnPage.goto(URL,{waitUntil:"domcontentloaded"});
    await withdrawnPage.locator("#btn-enter-game").click();
    await withdrawnPage.locator("#pseudoInput").fill("AliceReturn");
    await withdrawnPage.locator("#roomCodeInput").fill(w.code);
    await withdrawnPage.locator("#joinRoomBtn").click();
    await withdrawnPage.waitForFunction(c=>currentRoom?.roomCode===c,w.code);
    const withdrawal=await withdrawnPage.evaluate(()=>({N:currentRoom.listeTournament.initialParticipantCount,withdrawn:currentRoom.players.find(p=>p.playerId===playerId)?.withdrawn}));
    assert.equal(withdrawal.N,3);
    assert.equal(withdrawal.withdrawn,true);
    log("Abandon puis reconnexion Liste","réussi","Edge/Playwright, Quitter et Rejoindre",withdrawal);

    await w.host.page.locator("#leaveRoomBtn").click();
    await w.host.page.locator("#confirmQuitBtn").click();
    await w.guestB.page.waitForFunction(()=>currentRoom?.hostId===playerId);
    log("Transfert d'hôte après Quitter","réussi","Edge/Playwright, bouton Quitter",{newHost:w.guestB.name});
    await w.host.page.waitForFunction(()=>socket.connected&&!currentRoom);
    await w.host.page.locator("#createRoomBtn").click();
    await w.host.page.waitForFunction(c=>currentRoom?.roomCode&&currentRoom.roomCode!==c,w.code);
    const newCode=(await snapshot(w.host.page)).roomCode;
    await w.host.page.waitForTimeout(11000);
    const oldBoard=await w.host.page.evaluate(()=>document.querySelector("#liste-leaderboard-overlay")?.classList.contains("active")||false);
    assert.equal(oldBoard,false);
    log("Quitter puis nouvelle salle sans ancien classement","réussi","Edge/Playwright, interface",{oldCode:w.code,newCode});

    await w.host.page.locator('[data-game-mode="liste"]').click();
    await w.host.page.locator("#listeGameCount").selectOption("7");
    await w.host.page.locator("#listeSelectionMethod").selectOption("random");
    await w.host.page.locator("#listeConfigSubmit").click();
    await w.host.page.waitForFunction(()=>currentRoom?.listeConfig?.selectionMethod==="random");
    const random=await w.host.page.evaluate(()=>currentRoom.listeConfig);
    assert.equal(random.gameCount,7);
    await w.host.page.locator("#listeGameCount").selectOption("2");
    await w.host.page.locator("#listeSelectionMethod").selectOption("manual");
    for(const game of ["petit_bac","qui_suis_je"]) await w.host.page.locator(`#listeGameChoices input[value="${game}"]`).check();
    await w.host.page.locator("#listeConfigSubmit").click();
    await w.host.page.waitForFunction(()=>currentRoom?.listeConfig?.selectionMethod==="manual");
    const manual=await w.host.page.evaluate(()=>currentRoom.listeConfig);
    assert.deepEqual([...manual.selectedMiniGames].sort(),["petit_bac","qui_suis_je"]);
    log("Configurations aléatoire et manuelle conservées","réussi","Edge/Playwright, contrôles du lobby",{random,manual});
  } catch(error) {
    log("Reconnexions et configuration Liste","échec","Edge/Playwright",{error:error.message,stack:error.stack?.slice(0,1200)});
  } finally {
    await browser.close();
    if (report.scenarios.some((item) => item.status === "échec")) process.exitCode = 1;fs.writeFileSync(path.join(captureDir,"lot4-recovery-report.json"),JSON.stringify(report,null,2));
    console.log("ERRORS",JSON.stringify({console:report.consoleErrors.length,page:report.pageErrors.length,requests:report.failedRequests.length,http:report.httpErrors.length}));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});

