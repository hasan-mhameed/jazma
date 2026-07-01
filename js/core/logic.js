// 📄 logic.js — v11.8
import { makeKey } from "../utils.js?v=1782862594";
import { state }   from "./state.js?v=1782862594";

// التحقق من اكتمال مربع واحد
export function checkForSquare(r, c) {
  const top    = makeKey(r,   c,   r,   c+1);
  const right  = makeKey(r,   c+1, r+1, c+1);
  const bottom = makeKey(r+1, c,   r+1, c+1);
  const left   = makeKey(r,   c,   r+1, c  );
  return state.lines.has(top) && state.lines.has(right) &&
         state.lines.has(bottom) && state.lines.has(left);
}

// التحقق من المربعات حول الخط — يرجع قائمة المربعات المكتملة فقط
export function checkSquaresAround(r1, c1, r2, c2, cfg) {
  const possible = [];
  if (r1 === r2) {
    const col = Math.min(c1, c2);
    possible.push([r1-1, col], [r1, col]);
  } else {
    const row = Math.min(r1, r2);
    possible.push([row, c1-1], [row, c1]);
  }
  return possible.filter(([r,c]) =>
    r >= 0 && c >= 0 && r < cfg.rows-1 && c < cfg.cols-1 && checkForSquare(r,c)
  );
}
