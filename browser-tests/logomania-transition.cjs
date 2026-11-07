"use strict";

// Utilise le serveur existant et des phases simulées : aucune question consommée.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.LQS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.LQS_HTTP_URL || "http://127.0.0.1:3000/";
const out = path.resolve(".test-run/logomania-transition");
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "../public_2/logomania/logomania.json"), "utf8"));
const q = bank.questions[0];
const question = { id: q.id, theme_id: q.theme_id, question: q.question, image_question: q.image_question };

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.LQS_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
  const errors = [], reports = [];
  try {
    const pages = await Promise.all([320, 375, 430].map(async width => {
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
      });
      await page.goto(base);
      await page.waitForFunction(() => typeof renderLogomaniaQuestion === "function");
      return page;
    }));
    for (const mode of ["battle_royale", "liste"]) {
      for (const remainingMs of [2500, 500]) {
        const results = await Promise.all(pages.map(page => page.evaluate(async ({ mode, remainingMs, question }) => {
          socket.disconnect();
          stopLogomaniaDisplay();
          currentRoom = { roomCode: "TEST", gameMode: mode, players: [{ playerId, pseudo: "Joueur" }] };
          currentGameState = { currentMiniGame: "logomania", logomaniaInstanceId: "transition-test", roundNumber: 1,
            logomaniaQuestionIndex: 0, logomaniaPhase: "theme", phase: "playing" };
          showScreen("room");
          document.body.classList.add("playing-mode", "logomania-active");
          document.body.classList.toggle("mode-liste", mode === "liste");
          const state = { roomCode: "TEST", gameMode: mode, roundNumber: 1, instanceId: "transition-test",
            questionIndex: 0, questionId: question.id, question, themeName: "Marque", subPhase: "theme",
            remainingMs, durationMs: 2500, participantIds: [playerId], index: 1, total: 8, savedAnswer: null };
          const start = performance.now();
          let animationEnd, firstQuestion, gapFrames = 0, lockedAtAnimationEnd;
          const container = document.getElementById("logomaniaContainer");
          const input = document.getElementById("logomaniaInput");
          const end = event => {
            if (event.animationName !== "palierZoomFade") return;
            animationEnd = performance.now() - start;
            lockedAtAnimationEnd = input.disabled;
          };
          palierOverlayText.addEventListener("animationend", end);
          renderLogomaniaQuestion(state);
          while (performance.now() - start < remainingMs - 30) {
            await new Promise(requestAnimationFrame);
            const visible = !container.classList.contains("hidden");
            if (visible && firstQuestion === undefined) firstQuestion = performance.now() - start;
            if (animationEnd !== undefined && !visible) gapFrames++;
          }
          palierOverlayText.removeEventListener("animationend", end);
          const lockedBeforeServer = input.disabled;
          currentGameState.logomaniaPhase = "answering";
          renderLogomaniaQuestion({ ...state, subPhase: "answering", durationMs: 40000, remainingMs: 40000 });
          return { mode, width: innerWidth, resumed: remainingMs < 2500, animationEnd, firstQuestion, gapFrames,
            lockedAtAnimationEnd, lockedBeforeServer, enabledAfterServer: !input.disabled,
            overflow: document.documentElement.scrollWidth > innerWidth };
        }, { mode, remainingMs, question })));
        for (const result of results) {
          assert.equal(result.gapFrames, 0, JSON.stringify(result));
          assert.ok(Number.isFinite(result.firstQuestion) && result.firstQuestion < (result.resumed ? 250 : 1800), JSON.stringify(result));
          assert.ok(result.lockedAtAnimationEnd && result.lockedBeforeServer && result.enabledAfterServer, JSON.stringify(result));
          assert.equal(result.overflow, false);
        }
        reports.push(...results);
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "browser-report.json"), JSON.stringify({ reports, errors }, null, 2));
    console.log(JSON.stringify({ scenarios: reports.length, blackFramesAfterTheme: reports.reduce((n, r) => n + r.gapFrames, 0), errors }));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
