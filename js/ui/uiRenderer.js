// 📄 uiRenderer.js
// مسؤول عن نوافذ الواجهة ورسائل المستخدم
// Handles UI dialogs and user messages

// uiRenderer.js - UI components (winner screen, modals)
export function showWinner(winner, details) {
  const winScreen = document.getElementById('winner-screen');
  const winMsg = document.getElementById('winner-message');
  const winDetails = document.getElementById('winner-details');
  if (winMsg) winMsg.textContent = `Player ${winner} Wins!`;
  if (winDetails) winDetails.innerHTML = details || '';
  if (winScreen) winScreen.classList.remove('hidden');
}

export function hideWinner() {
  const winScreen = document.getElementById('winner-screen');
  if (winScreen) winScreen.classList.add('hidden');
}
