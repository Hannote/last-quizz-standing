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
  browser=await chromium.launch({executablePath:process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,args:["--no-sandbox"]});
  try {
    const host=await newPlayer("ench-host","HoteEncheres");
    const guest=await newPlayer("ench-guest","InviteEncheres");
    await host.page.locator("#createRoomBtn").click();
    await host.page.waitForFunction(()=>currentRoom?.roomCode);
    const code=(await snapshot(host.page)).roomCode;
    await join(guest,code);
    await host.page.locator("#sandboxToggle").check();
    await host.page.locator("#sandboxMiniGameSelect").selectOption("les_encheres");
    await host.page.locator("#startGameBtn").click();
    await phase(host.page,"rules",90000);
    await host.page.locator("#readyBtn").click();
    await guest.page.locator("#readyBtn").click();
    await phase(host.page,"playing",30000);
    await host.page.locator("#encheresThemesList .encheres-theme-btn").first().waitFor({state:"visible",timeout:10000});
    const themes=await host.page.locator("#encheresThemesList .encheres-theme-btn").evaluateAll(buttons=>buttons.map(b=>({id:b.dataset.themeId,name:b.textContent,disabled:b.disabled})));
    const selected=themes.filter(x=>!x.disabled).at(-1);
    assert(selected);
    await host.page.screenshot({path:path.join(captureDir,"encheres-themes-375.png")});
    await host.page.locator('#encheresThemesList .encheres-theme-btn[data-theme-id="'+selected.id+'"]').click();
    await guest.page.locator('#encheresThemesList .encheres-theme-btn[data-theme-id="'+selected.id+'"]').click();
    await host.page.waitForFunction(()=>window.__auditEvents.some(e=>e.name==="encheresStartBidding"),null,{timeout:15000});
    log("Enchères thèmes affichés sélectionnables", "réussi","Edge/Playwright, bac à sable réservé à ce mini-jeu",{themes,selected});
    await host.page.locator("#encheresBidInput").fill("4");
    await host.page.locator("#encheresBidBtn").click();
    await host.page.waitForFunction(()=>window.__auditEvents.some(e=>e.name==="encheresNewBid"),null,{timeout:5000});
    await guest.page.locator("#encheresBidInput").fill("50");
    await guest.page.locator("#encheresBidBtn").click();
    await guest.page.waitForFunction(()=>window.__auditEvents.filter(e=>e.name==="encheresNewBid").length>=2,null,{timeout:5000});
    const bidDisplay=await host.page.locator("#encheresCurrentBid").textContent().catch(()=>null);
    await host.page.screenshot({path:path.join(captureDir,"encheres-bids-375.png")});
    log("Enchères mise normale puis 50", "réussi","Edge/Playwright, formulaire et boutons",{bidDisplay});
    await guest.page.waitForFunction(()=>window.__auditEvents.some(e=>e.name==="encheresStartCollection"),null,{timeout:105000});
    await guest.page.locator("#encheresAnswerInput").waitFor({state:"visible",timeout:15000});
    await guest.page.locator("#encheresAnswerInput").fill("Réponse alpha");
    await guest.page.locator("#encheresAnswerBtn").click();
    await guest.page.waitForFunction(()=>document.querySelectorAll(".enchere-delete-btn").length>=1,null,{timeout:5000});
    await guest.page.locator("#encheresAnswerInput").fill("Réponse beta");
    await guest.page.locator("#encheresAnswerBtn").click();
    await guest.page.waitForFunction(()=>document.querySelectorAll(".enchere-delete-btn").length>=2,null,{timeout:5000});
    await guest.page.screenshot({path:path.join(captureDir,"encheres-answers-375.png")});
    await guest.page.locator(".enchere-delete-btn").first().click();
    await guest.page.waitForFunction(()=>document.querySelectorAll(".enchere-delete-btn").length===1,null,{timeout:5000});
    log("Enchères envoi et suppression de réponses", "réussi","Edge/Playwright, champ et boutons",{remaining:await guest.page.locator(".enchere-delete-btn").count()});
    await host.page.locator("#encheresCorrectionContainer").waitFor({state:"visible",timeout:110000});
    await host.page.locator("#encheresCorrectionList .btn-ok").first().click();
    await host.page.waitForFunction(()=>document.querySelector("#encheresCorrectionList .btn-ok.active"),null,{timeout:5000});
    await host.page.screenshot({path:path.join(captureDir,"encheres-correction-375.png")});
    await host.page.locator("#encheresValidateGameBtn").click();
    await host.page.waitForFunction(()=>window.__auditEvents.some(e=>e.name==="encheresVictory")||window.__auditEvents.some(e=>e.name==="encheresDefeat"),null,{timeout:15000});
    log("Enchères correction et finalisation", "réussi","Edge/Playwright, contrôles hôte");
    const measures=await portrait(host.page,"encheres-result");
    log("portrait Enchères résultat 320/375/430",measures.every(m=>m.scrollWidth<=m.width&&m.quitVisible)?"réussi":"échec","Edge/Playwright",{measurements:measures});
    report.audio.push({label:"encheres-host",...(await host.page.evaluate(()=>({howls:window.Howler?._howls?.length??null,contextState:window.Howler?.ctx?.state??null})))});
  } catch(error) {
    log("Parcours Enchères","échec","Edge/Playwright",{error:error.message,stack:error.stack?.slice(0,1200)});
  } finally {
    await browser.close();
    if (report.scenarios.some((item) => item.status === "échec")) process.exitCode = 1;
    fs.writeFileSync(path.join(captureDir,"encheres-report.json"),JSON.stringify(report,null,2));
    console.log("ERRORS",JSON.stringify({console:report.consoleErrors.length,page:report.pageErrors.length,requests:report.failedRequests.length,http:report.httpErrors.length}));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});

