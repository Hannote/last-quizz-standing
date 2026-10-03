"use strict";

// Diagnostic seulement : aucune assertion sur des fréquences aléatoires.
const { shuffleCopy } = require("../question-shuffle");
const bank = Array.from({ length: 80 }, (_, id) => id); // 8 blocs voisins de 10
const runs = 20000;

for (const [method, draw] of [
  ["random-sort", (items) => [...items].sort(() => Math.random() - 0.5).slice(0, 8)],
  ["Fisher-Yates", (items) => shuffleCopy(items).slice(0, 8)]
]) {
  const blocks = Array(8).fill(0);
  let sameBlockPairs = 0;
  let firstIdCount = 0;
  for (let run = 0; run < runs; run++) {
    const ids = draw(bank);
    const groups = ids.map((id) => Math.floor(id / 10));
    for (const group of groups) blocks[group]++;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i] === groups[j]) sameBlockPairs++;
      }
    }
    if (ids.includes(0)) firstIdCount++;
  }
  console.log(JSON.stringify({ method, runs, blocks,
    sameBlockPairsPerLot: sameBlockPairs / runs,
    firstIdRate: firstIdCount / runs }));
}
console.log(JSON.stringify({ method: "expected", blocks: Array(8).fill(runs),
  sameBlockPairsPerLot: 28 * 9 / 79, firstIdRate: 8 / 80 }));
