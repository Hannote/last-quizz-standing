// La frame 0 précède l'audio de 3 s ; les autres timings restent relatifs
// au démarrage du son. La dernière image reste visible jusqu'au tirage serveur.
const ListeIntroTimeline = (() => {
  const blackMs = 300;
  const audioStartMs = 3300;
  const audioEndMs = 16000;
  const durationMs = 17000;
  const frameStartsMs = Object.freeze([0, 959, 1544, 3210, 3543, 3960,
    4334, 5078, 5495, 6368, 6542, 6667]);
  const logoStartsMs = Object.freeze([13120, 13440, 13780, 13960, 14100]);
  // Largeur du logo visible dans les PNG 2172 × 724 (bbox des pixels non noirs).
  const logoWidthsPx = Object.freeze([408, 1150, 2029, 2078, 2061]);
  const frameNames = Object.freeze(Array.from({ length: frameStartsMs.length + logoStartsMs.length }, (_, i) =>
    i === 6 ? "frame 6 .png" : `frame ${i}.png`));
  const baseUrl = "/animation_liste/" + encodeURIComponent("début") + "/";
  const frameUrls = Object.freeze(frameNames.map((name) => baseUrl + encodeURIComponent(name)));
  const audioUrl = baseUrl + encodeURIComponent("animation_liste_debut.mp3");

  function smoothWidth(start, end, progress) {
    const eased = progress * progress * (3 - 2 * progress);
    return start + (end - start) * eased;
  }

  function approachWidth(start, end, startSpeed, endSpeed, duration, progress) {
    const t = progress;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * start +
      (t ** 3 - 2 * t ** 2 + t) * duration * startSpeed +
      (-2 * t ** 3 + 3 * t ** 2) * end +
      (t ** 3 - t ** 2) * duration * endSpeed;
  }

  function position(elapsedMs) {
    const elapsed = Math.max(0, Math.min(durationMs, elapsedMs));
    if (elapsed < blackMs) return { frame: -1, nextMs: blackMs, scale: 1, opacity: 1, animating: false };
    if (elapsed < audioStartMs) {
      const progress = (elapsed - blackMs) / (audioStartMs - blackMs);
      const eased = progress * progress * (3 - 2 * progress);
      return { frame: 0, nextMs: audioStartMs, scale: 1 + 0.025 * eased,
        offsetXPercent: 0.4 * eased, opacity: 1, animating: true };
    }
    if (elapsed < audioStartMs + frameStartsMs[1]) {
      return { frame: 0, nextMs: audioStartMs + frameStartsMs[1],
        scale: 1.025, offsetXPercent: 0.4, opacity: 1, animating: false };
    }
    if (elapsed >= 13000 && elapsed < logoStartsMs[0]) {
      return { frame: 11, nextMs: null, scale: 1,
        opacity: 1 - (elapsed - 13000) / 120, animating: true };
    }
    if (elapsed >= logoStartsMs[0]) {
      const [start12, start13, start14, start15, start16] = logoStartsMs;
      if (elapsed < start13) {
        const progress = (elapsed - start12) / (start13 - start12);
        return { frame: 12, nextMs: null,
          scale: approachWidth(logoWidthsPx[0], logoWidthsPx[1], 0, 2.4,
            start13 - start12, progress) / logoWidthsPx[0],
          opacity: Math.min(1, (elapsed - start12) / 80), animating: true };
      }
      if (elapsed < start14) {
        const progress = (elapsed - start13) / (start14 - start13);
        return { frame: 13, nextMs: null,
          scale: approachWidth(logoWidthsPx[1], logoWidthsPx[2], 2.4, 0,
            start14 - start13, progress) / logoWidthsPx[1],
          opacity: 1, animating: true };
      }
      if (elapsed < start15) {
        const progress = (elapsed - start14) / (start15 - start14);
        return { frame: 14, nextMs: null,
          scale: smoothWidth(logoWidthsPx[2], logoWidthsPx[3], progress) / logoWidthsPx[2],
          opacity: 1, animating: true };
      }
      if (elapsed < start16) {
        const progress = (elapsed - start15) / (start16 - start15);
        return { frame: 15, nextMs: null,
          scale: smoothWidth(logoWidthsPx[3], logoWidthsPx[4], progress) / logoWidthsPx[3],
          opacity: 1, animating: true };
      }
      return { frame: 16, nextMs: elapsed < audioEndMs ? audioEndMs : null,
        scale: 1, opacity: 1, animating: false };
    }
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
        ? audioStartMs + frameStartsMs[frame + 1] : 13000,
      scale: 1, opacity: 1, animating: false
    };
  }

  return Object.freeze({ blackMs, audioStartMs, audioEndMs, durationMs, frameStartsMs,
    logoStartsMs, logoWidthsPx, frameUrls, audioUrl, position });
})();

if (typeof module !== "undefined" && module.exports) module.exports = ListeIntroTimeline;
