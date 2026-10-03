"use strict";

// Mélange uniforme sans modifier la banque (ni les objets qu'elle contient).
function shuffleCopy(items, random = Math.random) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = { shuffleCopy };
