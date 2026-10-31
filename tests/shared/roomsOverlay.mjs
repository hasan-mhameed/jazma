// قواعد غرف تقريبية لفحوص 3.3ب-1 (قبل قفل الغرف الفعلي في 3.3ب-2): "لا يكتب في غرفة قائمة إلا لاعبوها"، ومن ينضم
// يضيف نفسه لغرفة تنتظر (ثنائي) أو لوبي (جماعي) دون أن يغيّر صاحبها، ومن ينشئ غرفة غير موجودة، ومن يحذف لوبي فارغاً.
// الغرض: إثبات أن مسارات الكود الحقيقي (مغادرة اللوبي، رقم مكرّر) تعمل تحت قفل كهذا — لا أنها القواعد النهائية.
export function memberOnlyRooms(baseRules) {
  const R = JSON.parse(JSON.stringify(baseRules || { rules: {} }));
  const member = "(data.child('p1uid').val() === auth.uid || data.child('p2uid').val() === auth.uid || data.child('players').child(auth.uid).exists())";
  const duoJoin = "(data.child('status').val() === 'waiting' && data.child('p2uid').val() === '' && newData.child('p2uid').val() === auth.uid"
    + " && newData.child('p1uid').val() === data.child('p1uid').val())";
  const multiJoin = "(data.child('status').val() === 'lobby' && !data.child('players').child(auth.uid).exists()"
    + " && newData.child('players').child(auth.uid).exists() && newData.child('hostUid').val() === data.child('hostUid').val())";
  const emptyLobbyDelete = "(!newData.exists() && data.child('multi').val() === true && !data.child('players').exists())";
  R.rules.rooms = {
    '.read': 'auth !== null',
    $code: {
      '.write': `auth !== null && (!data.exists() || ${member} || ${duoJoin} || ${multiJoin} || ${emptyLobbyDelete})`,
      spectators: { $uid: { '.write': 'auth !== null && $uid === auth.uid' } },
    },
  };
  return R;
}
