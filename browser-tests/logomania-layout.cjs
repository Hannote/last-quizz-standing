"use strict";
// Contre le serveur local existant : classement Logomania simule, sans consommer de questions.
const fs=require('fs');
const assert=require('assert/strict');
const {chromium}=require(process.env.LQS_PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LQS_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const results=[];
 try {
  const page=await browser.newPage({viewport:{width:320,height:812}});
  fs.mkdirSync('.test-run/logomania', {recursive:true});
  await page.goto(process.env.LQS_HTTP_URL || 'http://127.0.0.1:3000/');
  await page.waitForFunction(()=>typeof showLogomaniaLeaderboard==='function');
  for(const mode of ['battle_royale','liste']){
   await page.evaluate(mode=>{
    socket.disconnect();
    stopLogomaniaDisplay();
    currentRoom={roomCode:'TEST',gameMode:mode,players:[]};
    currentGameState={currentMiniGame:'logomania',logomaniaInstanceId:'visual-'+mode,logomaniaPhase:'leaderboard',logomaniaQuestionIndex:7,roundNumber:1,phase:'playing'};
    showScreen('room');
    document.body.classList.add('playing-mode','logomania-active');
    document.body.classList.toggle('mode-liste',mode==='liste');
    showLogomaniaLeaderboard({roomCode:'TEST',gameMode:mode,instanceId:'visual-'+mode,subPhase:'leaderboard',questionIndex:7,roundNumber:1,remainingMs:60000,
      players:Array.from({length:12},(_,i)=>({id:'p'+i,nickname:'JoueurAvecUnPseudonymeTresLong'+i,score:8-i*.5,time:120+i*10,place:i+1}))});
   },mode);
   await page.waitForFunction(()=>getComputedStyle(document.getElementById('leaderboard-overlay')).opacity==='1');
   for(const width of [320,375,430]){
    await page.setViewportSize({width,height:812});
    const result=await page.evaluate(()=>{
     const content=document.getElementById('leaderboard-content');
     const rows=[...content.querySelectorAll('.player-row')];
     const names=rows.map(row=>{const a=row.querySelector('.p-name').getBoundingClientRect(),b=row.querySelector('.p-score').getBoundingClientRect();return a.right<=b.left+1;});
     const quit=document.getElementById('leaveRoomBtn').getBoundingClientRect();
     return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,namesSeparated:names.every(Boolean),internalScroll:content.scrollHeight>content.clientHeight,quitVisible:quit.top>=0&&quit.right<=innerWidth&&quit.height>0};
    });
    assert(result.scrollWidth<=result.width&&result.namesSeparated&&result.internalScroll&&result.quitVisible,JSON.stringify(result));
    results.push({mode,...result});
    if(width===320) await page.screenshot({path:'.test-run/logomania/'+mode+'-leaderboard-longnames-320.png'});
   }
  }
  fs.writeFileSync('.test-run/logomania/leaderboard-report.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
