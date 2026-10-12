// La frame 0 précède l'audio de 3 s ; les autres timings restent relatifs
// au démarrage du son. La dernière image reste visible jusqu'au tirage serveur.
const ListeIntroTimeline = (() => {
  const blackMs = 300;
  const audioStartMs = 3300;
  const durationMs = 16000;
  const frameStartsMs = Object.freeze([0, 959, 1544, 3210, 3543, 3960,
    4334, 5078, 5495, 6368, 6542, 6667]);
  const frameNames = Object.freeze(Array.from({ length: frameStartsMs.length }, (_, i) =>
    i === 6 ? "frame 6 .png" : `frame ${i}.png`));
  const baseUrl = "/animation_liste/" + encodeURIComponent("début") + "/";
  const frameUrls = Object.freeze(frameNames.map((name) => baseUrl + encodeURIComponent(name)));
  const audioUrl = baseUrl + encodeURIComponent("animation_liste_debut.mp3");

  function position(elapsedMs) {
    const elapsed = Math.max(0, Math.min(durationMs, elapsedMs));
    if (elapsed < blackMs) return { frame: -1, nextMs: blackMs };
    if (elapsed < audioStartMs) return { frame: 0, nextMs: audioStartMs };
    const audioElapsed = elapsed - audioStartMs;
    let frame = frameStartsMs.length - 1;
    for (let i = 0; i < frameStartsMs.length - 1; i++) {
      if (audioElapsed < frameStartsMs[i + 1]) {
        frame = i;
        break;
      }
    }
    return {
      frame,
      nextMs: frame < frameStartsMs.length - 1
        ? audioStartMs + frameStartsMs[frame + 1] : null
    };
  }

  return Object.freeze({ blackMs, audioStartMs, durationMs, frameStartsMs, frameUrls, audioUrl, position });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ListeIntroTimeline;
