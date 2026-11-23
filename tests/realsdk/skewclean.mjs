// جهاز ساعته مختلفة عن الخادم يشغّل تنظيف الغرف (3.3ج-5ب، مراجعة) — عملية منفصلة لأن الساعة للجهاز كله
//   node skewclean.mjs <ملف firebase.js المولَّد> <الإزاحة بالملّي ثانية>   → يطبع {ev:"done"} أو {ev:"error"}
const [, , modPath, skewArg] = process.argv;
const skew = Number(skewArg) || 0;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [RealDate.now() + skew])); }
  static now() { return RealDate.now() + skew; }
};
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
try {
  const F = await import(modPath);
  await F.cleanupOldRooms();
  await new Promise(r => setTimeout(r, 400));
  out({ ev: 'done' });
} catch (e) { out({ ev: 'error', e: String(e && e.message || e) }); }
process.exit(0);
