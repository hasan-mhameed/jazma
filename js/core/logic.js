// 📄 logic.js
// وظائف المنطق العامة للّعبة
// General game logic functions

import { makeKey } from "../utils.js";
import { lines } from "../ui/boardRenderer.js";
import { fillSquare } from "../ui/boardRenderer.js";

// التحقق من اكتمال مربع واحد
export function checkForSquare(r, c) {
  const top = makeKey(r, c, r, c + 1);
  const right = makeKey(r, c + 1, r + 1, c + 1);
  const bottom = makeKey(r + 1, c, r + 1, c + 1);
  const left = makeKey(r, c, r + 1, c);

  return (
    lines.has(top) && lines.has(right) && lines.has(bottom) && lines.has(left)
  );
}

// التحقق من المربعات حول الخط
export function checkSquaresAround(r1, c1, r2, c2, cfg) {
  const possibleSquares = [];
  const completed = [];

  if (r1 === r2) {
    // خط أفقي
    const topRow = r1 - 1;
    const col = Math.min(c1, c2);
    possibleSquares.push([topRow, col]);
    possibleSquares.push([r1, col]);
  } else if (c1 === c2) {
    // خط عمودي
    const leftCol = c1 - 1;
    const row = Math.min(r1, r2);
    possibleSquares.push([row, leftCol]);
    possibleSquares.push([row, c1]);
  }

  for (const [r, c] of possibleSquares) {
    if (r >= 0 && c >= 0 && r < cfg.rows - 1 && c < cfg.cols - 1) {
      if (checkForSquare(r, c)) {
        console.log("✅ مربع اكتمل عند:", r, c);
        completed.push([r, c]);

        fillSquare(r, c, cfg); // نلون المربع للاعب 1 (يمكن تعديلها لاحقًا لدعم لاعبين متعددين);
      }
    }
  }
  return completed; // 🆕 الآن ترجع مصفوفة;
}
