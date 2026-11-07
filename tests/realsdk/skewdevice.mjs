// جهاز ساعته مختلفة عن الخادم (3.3ج-2، مراجعة L1) — عملية منفصلة لأن الساعة للجهاز كله: الحزمة تقيس فرقها عن الخادم
// (.info/serverTimeOffset) بساعة الجهاز نفسها، فتغيير ساعة friends.js وحده لا يحاكي جهازاً حقيقياً.
//   node skewdevice.mjs <ملف friends.js المولَّد> <الإزاحة بالملّي ثانية> <receiver|sender> [المستقبل] [المدة]
// يطبع سطور JSON: {ev:"reqs", uids} لكل لقطة طلبات واردة، {ev:"sent", keys} لكل لقطة طلباتي، {ev:"done"|"error"}
const [, , modPath, skewArg, mode, target = '', msArg = '3000'] = process.argv;
const skew = Number(skewArg) || 0;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [RealDate.now() + skew])); }
  static now() { return RealDate.now() + skew; }
};
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const F = await import(modPath);
  if (mode === 'receiver') F.listenFriendRequests(reqs => out({ ev: 'reqs', uids: reqs.map(r => r.uid) }));
  F.listenSentRequests(keys => out({ ev: 'sent', keys }));
  await wait(600);
  if (mode === 'sender') { await F.sendFriendRequest(target); out({ ev: 'sentOk' }); }
  await wait(Number(msArg));
  out({ ev: 'done' });
} catch (e) { out({ ev: 'error', msg: String(e && (e.code || e.message || e)) }); }
process.exit(0);
