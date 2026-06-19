// 📄 core/powers.js
// منطق القدرات — مخزون لكل لاعب + تعريف القدرات

// تعريف القدرات (مرتبطة بالعناصر)
export const POWERS = {
  water: {
    icon: '🐟', name: 'سمكة',
    desc: 'ارسم خطاً إضافياً مجاناً',
    type: 'free_line',
  },
};

// مخزون لكل لاعب: { 1: { water: 2, gem: 1 }, 2: {...} }
let _inventory = {};
// تأثيرات مفعّلة مؤقتاً لكل لاعب: { 1: { triple_points: true } }
let _activeEffects = {};

export function resetPowers(players = 2) {
  _inventory = {};
  _activeEffects = {};
  for (let i = 1; i <= players; i++) { _inventory[i] = {}; _activeEffects[i] = {}; }
}

export function addPower(player, elementType) {
  if (!POWERS[elementType]) return;
  if (!_inventory[player]) _inventory[player] = {};
  _inventory[player][elementType] = (_inventory[player][elementType] || 0) + 1;
}

export function getInventory(player) {
  return _inventory[player] || {};
}

export function hasPower(player, elementType) {
  return (_inventory[player]?.[elementType] || 0) > 0;
}

export function consumePower(player, elementType) {
  if (!hasPower(player, elementType)) return false;
  _inventory[player][elementType]--;
  if (_inventory[player][elementType] <= 0) delete _inventory[player][elementType];
  return true;
}

// التأثيرات المؤقتة (مثل triple_points للمربع القادم)
export function setEffect(player, effect, value = true) {
  if (!_activeEffects[player]) _activeEffects[player] = {};
  _activeEffects[player][effect] = value;
}
export function getEffect(player, effect) {
  return _activeEffects[player]?.[effect];
}
export function clearEffect(player, effect) {
  if (_activeEffects[player]) delete _activeEffects[player][effect];
}
