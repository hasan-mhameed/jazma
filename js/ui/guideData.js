// 📄 ui/guideData.js
// بيانات دليل الأدوات — كل عنصر وقدرة مع وصفه الكامل
// تُعرض في دليل اللعبة (زر ؟ جنب المخزون)

import { FISH_SVG, GEM_SVG, TIME_EXTEND_SVG, TIME_REDUCE_SVG } from "./powerIcons.js?v=1784404579";

// قائمة كل العناصر/الأدوات في اللعبة
export const GUIDE_ITEMS = [
  {
    key: 'water',
    svg: FISH_SVG,
    name: 'السمكة',
    kind: 'قدرة',
    kindColor: '#ef4444',
    how: 'أكمل مربعاً يحتوي على سمكة',
    desc: 'تُضاف إلى مخزونك. فعّلها في دورك لترسم خطاً إضافياً مجاناً (تلعب مرتين).',
  },
  {
    key: 'gem',
    svg: GEM_SVG,
    name: 'الجوهرة',
    kind: 'عملة',
    kindColor: '#fbbf24',
    how: 'أكمل مربعاً يحتوي على جوهرة',
    desc: 'تكسب 3 عملات تُضاف لمحفظتك الدائمة. تتراكم بين المباريات.',
  },
  {
    key: 'time_extend',
    svg: TIME_EXTEND_SVG,
    name: 'تمديد الوقت',
    kind: 'شراء',
    kindColor: '#a78bfa',
    how: 'اشترِها بـ 5 جواهر (مع المؤقّت المفعّل)',
    desc: 'تضيف 5 ثوانٍ لوقت دورك الحالي. مفيدة لمّا يضيق الوقت.',
  },
  {
    key: 'time_reduce',
    svg: TIME_REDUCE_SVG,
    name: 'تقصير وقت الخصم',
    kind: 'شراء',
    kindColor: '#f87171',
    how: 'اشترِها بـ 8 جواهر (مع المؤقّت المفعّل)',
    desc: 'تُخزَّن في مخزونك. فعّلها وقت ما تريد لتقصّ 5 ثوانٍ من دور خصمك التالي (لمرة واحدة).',
  },
];
