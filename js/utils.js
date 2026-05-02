// 📄 utils.js
// دوال مساعدة مشتركة
// Common utility functions

// utils.js
export function makeKey(r1, c1, r2, c2) {
  // تأكد إن الترتيب دايمًا موحّد
  if (r1 > r2 || (r1 === r2 && c1 > c2)) {
    [r1, c1, r2, c2] = [r2, c2, r1, c1];
  }
  return `${r1},${c1}-${r2},${c2}`;
}
