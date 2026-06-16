// 📄 aiPlayer.js
// الذكاء الاصطناعي للعب ضد الكمبيوتر
// AI Player with different difficulty levels

import { state } from "../core/state.js?v=1781648746";
import { makeKey } from "../utils.js?v=1781648746";
import { checkForSquare } from "../core/logic.js?v=1781648746";

export class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty; // easy, medium, hard
  }

  // 🎯 اختيار الحركة التالية حسب مستوى الصعوبة
  makeMove(cfg) {
    const availableMoves = this.getAvailableMoves(cfg);
    
    if (availableMoves.length === 0) return null;

    switch (this.difficulty) {
      case 'easy':
        return this.getEasyMove(availableMoves, cfg);
      case 'medium':
        return this.getMediumMove(availableMoves, cfg);
      case 'hard':
      case 'nightmare':
        return this.getNightmareMove(availableMoves, cfg);
      default:
        return this.getMediumMove(availableMoves, cfg);
    }
  }

  // 📊 الحصول على كل الحركات المتاحة
  getAvailableMoves(cfg) {
    const moves = [];
    
    console.log('🔍 Checking available moves. Current lines count:', state.lines.size);
    
    // الخطوط الأفقية
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const key = makeKey(r, c, r, c + 1);
        if (!state.lines.has(key)) {
          moves.push({ r1: r, c1: c, r2: r, c2: c + 1, key });
        }
      }
    }

    // الخطوط العمودية
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const key = makeKey(r, c, r + 1, c);
        if (!state.lines.has(key)) {
          moves.push({ r1: r, c1: c, r2: r + 1, c2: c, key });
        }
      }
    }
    
    console.log('✅ Available moves:', moves.length);

    return moves;
  }

  // 😊 سهل - حركات عشوائية
  getEasyMove(moves, cfg) {
    // 30% احتمال يكمل مربع لو متاح
    const completingMoves = this.getCompletingMoves(moves, cfg);
    
    if (completingMoves.length > 0 && Math.random() < 0.3) {
      return this.randomChoice(completingMoves);
    }
    
    // باقي الوقت: حركة عشوائية
    return this.randomChoice(moves);
  }

  // 🧠 متوسط - يكمل المربعات + يتجنب إعطاء فرص
  getMediumMove(moves, cfg) {
    // أولاً: إذا في مربع يقدر يكمله، يكمله
    const completingMoves = this.getCompletingMoves(moves, cfg);
    if (completingMoves.length > 0) {
      return this.randomChoice(completingMoves);
    }

    // ثانياً: يتجنب الحركات اللي تعطي الخصم فرصة
    const safeMoves = this.getSafeMoves(moves, cfg);
    if (safeMoves.length > 0) {
      return this.randomChoice(safeMoves);
    }

    // إذا كل الحركات خطيرة، يختار أقلها خطورة
    return this.getLeastDangerousMove(moves, cfg);
  }

  // 🔥 صعب - استراتيجية متقدمة مع تحليل عميق
  getHardMove(moves, cfg) {
    // المرحلة 1: ياخذ كل المربعات المتاحة فوراً
    const completingMoves = this.getCompletingMoves(moves, cfg);
    if (completingMoves.length > 0) {
      console.log('🔥 Hard: Taking', completingMoves.length, 'available squares');
      return this.getBestCompletingMove(completingMoves, cfg);
    }

    // المرحلة 2: تجنب الحركات اللي تعطي الخصم فرصة
    const safeMoves = this.getSafeMoves(moves, cfg);
    if (safeMoves.length > 0) {
      console.log('🔥 Hard: Found', safeMoves.length, 'safe moves');
      // من الحركات الآمنة، نختار الأفضل استراتيجياً
      return this.getAdvancedStrategicMove(safeMoves, cfg);
    }

    // المرحلة 3: كل الحركات خطيرة - استراتيجية Double-Cross
    console.log('🔥 Hard: All moves dangerous, using double-cross');
    return this.getDoubleCrossMove(moves, cfg);
  }

  // 🏆 خبير - شبه مستحيل الفوز عليه
  getExpertMove(moves, cfg) {
    console.log('🏆 EXPERT MODE');
    
    // المرحلة 1: ياخذ كل المربعات
    const completingMoves = this.getCompletingMoves(moves, cfg);
    if (completingMoves.length > 0) {
      return this.getBestCompletingMove(completingMoves, cfg);
    }

    // المرحلة 2: Minimax محدود حسب حجم اللوحة
    const boardSize = cfg.rows * cfg.cols;
    let depth = boardSize <= 16 ? 4 : 3; // 4×4 أو أصغر = عمق 4، غير ذلك = 3
    
    const bestMove = this.minimaxSearch(moves, cfg, depth, true);
    if (bestMove) {
      console.log(`🏆 Expert: Minimax depth ${depth}`);
      return bestMove;
    }

    // Fallback
    return this.getHardMove(moves, cfg);
  }

  // 🔴 كابوس - Iterative Deepening مع حد زمني (سريع + قوي)
  getNightmareMove(moves, cfg) {
    // المرحلة 1: ياخذ كل المربعات المتاحة فوراً (بدون تفكير)
    const completingMoves = this.getCompletingMoves(moves, cfg);
    if (completingMoves.length > 0) {
      return this.getBestCompletingMove(completingMoves, cfg);
    }

    // المرحلة 2: Iterative Deepening مع حد زمني 800ms
    const TIME_LIMIT = 800; // ms — يضمن استجابة سريعة دايماً
    this._startTime = performance.now();
    this._timeLimit = TIME_LIMIT;
    this._aborted = false;

    // ترتيب الحركات مرة واحدة بس في البداية (مش في كل node)
    const orderedMoves = this.orderMovesNightmare(moves, cfg);

    let bestMove = orderedMoves[0]; // fallback دايماً عندنا حركة

    // نعمق تدريجياً: 1, 2, 3, 4... حتى ينتهي الوقت
    for (let depth = 1; depth <= 12; depth++) {
      this._aborted = false;
      const result = this.nightmareAlphaBeta(orderedMoves, cfg, depth, -Infinity, Infinity, true);
      
      if (!this._aborted && result.move) {
        bestMove = result.move; // نحفظ أفضل نتيجة من أعمق بحث اكتمل
      }

      // وقفنا؟ يعني الوقت خلص في منتصف هذا العمق
      if (this._aborted || (performance.now() - this._startTime) >= TIME_LIMIT) break;
    }

    return bestMove;
  }

  // 🌳 Alpha-Beta مع Time Check في كل node
  nightmareAlphaBeta(moves, cfg, depth, alpha, beta, isMaximizing) {
    // تحقق من الوقت كل فترة
    if (this._aborted) return { score: 0, move: null };
    if ((performance.now() - this._startTime) >= this._timeLimit) {
      this._aborted = true;
      return { score: 0, move: null };
    }

    if (depth === 0 || moves.length === 0) {
      return { score: this.evaluateNightmare(cfg), move: null };
    }

    // في الـ root نفحص كل الحركات، في العمق الأعمق نقلل
    const movesToCheck = Math.min(moves.length, depth >= 3 ? 8 : moves.length);

    let bestMove = null;
    let bestScore = isMaximizing ? -Infinity : Infinity;

    for (let i = 0; i < movesToCheck; i++) {
      if (this._aborted) break;

      const move = moves[i];
      state.lines.add(move.key);

      // في Dots & Boxes: لو كملت مربع، تلعب مرة ثانية!
      const squaresCompleted = this.countCompletedSquaresWithKey(move.key, cfg);

      let score;
      if (squaresCompleted > 0) {
        // نفس اللاعب يلعب مرة ثانية — نستخدم نفس الـ isMaximizing
        const nextMoves = this.getAvailableMoves(cfg);
        const result = this.nightmareAlphaBeta(nextMoves, cfg, depth - 1, alpha, beta, isMaximizing);
        score = result.score + squaresCompleted * 100;
      } else {
        const nextMoves = this.getAvailableMoves(cfg);
        const result = this.nightmareAlphaBeta(nextMoves, cfg, depth - 1, alpha, beta, !isMaximizing);
        score = result.score;
      }

      state.lines.delete(move.key);

      if (isMaximizing) {
        if (score > bestScore) { bestScore = score; bestMove = move; }
        alpha = Math.max(alpha, score);
      } else {
        if (score < bestScore) { bestScore = score; bestMove = move; }
        beta = Math.min(beta, score);
      }

      if (beta <= alpha) break; // Pruning
    }

    return { score: bestScore, move: bestMove };
  }

  // 📊 تقييم سريع للوحة (O(n) بدون chain tracing)
  evaluateNightmare(cfg) {
    let score = 0;
    let ready = 0, dangerous = 0, safe1 = 0, safe0 = 0;

    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const e = this.countSquareEdges(r, c, cfg);
        if      (e === 3) ready++;
        else if (e === 2) dangerous++;
        else if (e === 1) safe1++;
        else              safe0++;
      }
    }

    score += ready     * 500;   // جاهز للأخذ = ممتاز
    score -= dangerous * 300;   // خطير = نتجنبه
    score += safe1     * 20;    // ضلع واحد = آمن
    score += safe0     * 5;     // فاضي = محايد

    return score;
  }

  // 🔗 تحليل السلاسل في اللوحة الحالية
  analyzeChains(cfg) {
    const chains = [];
    const visited = new Set();

    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const key = `${r},${c}`;
        if (visited.has(key)) continue;

        const edges = this.countSquareEdges(r, c, cfg);
        if (edges >= 2) { // مربع جزء من سلسلة محتملة
          const chain = this.traceChain(r, c, cfg, visited);
          if (chain.length > 0) chains.push(chain);
        }
      }
    }

    return chains;
  }

  // 📏 تتبع سلسلة من مربع معين
  traceChain(startR, startC, cfg, visited) {
    const chain = [];
    const queue = [{ r: startR, c: startC }];

    while (queue.length > 0) {
      const { r, c } = queue.shift();
      const key = `${r},${c}`;
      if (visited.has(key)) continue;

      const edges = this.countSquareEdges(r, c, cfg);
      if (edges < 2) continue; // ليس جزءاً من سلسلة

      visited.add(key);
      chain.push({ r, c, edges });

      // نتحقق من الجيران المتصلين
      const neighbors = [
        { r: r - 1, c },
        { r: r + 1, c },
        { r, c: c - 1 },
        { r, c: c + 1 },
      ];

      for (const n of neighbors) {
        if (n.r >= 0 && n.c >= 0 && n.r < cfg.rows - 1 && n.c < cfg.cols - 1) {
          const nKey = `${n.r},${n.c}`;
          if (!visited.has(nKey)) {
            const nEdges = this.countSquareEdges(n.r, n.c, cfg);
            if (nEdges >= 2) queue.push(n);
          }
        }
      }
    }

    return chain;
  }

  // 🎯 ترتيب الحركات بشكل خفيف (بدون state manipulation مكثف)
  orderMovesNightmare(moves, cfg) {
    return moves.map(move => {
      let priority = 0;

      // أولوية 1: الحركات التي تكمل مربعاً (تحقق سريع بدون state)
      state.lines.add(move.key);
      const completed = this.countCompletedSquaresWithKey(move.key, cfg);
      const danger = this.countDangerousSquares(cfg);
      state.lines.delete(move.key);

      priority += completed * 1000;
      priority -= danger * 200;

      return { move, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .map(x => x.move);
  }

  // 🧠 استراتيجية نظرية السلاسل (fallback)
  getChainTheoryMove(moves, cfg) {
    // أولاً: خذ أي مربع جاهز
    const completingMoves = this.getCompletingMoves(moves, cfg);
    if (completingMoves.length > 0) return this.getBestCompletingMove(completingMoves, cfg);

    // ثانياً: ابحث عن حركة آمنة تماماً
    const safeMoves = this.getSafeMoves(moves, cfg);
    if (safeMoves.length > 0) {
      // من الحركات الآمنة، اختر الأبعد عن إنشاء مربعات بضلعين
      return this.getBestSafeMove(safeMoves, cfg);
    }

    // ثالثاً: استراتيجية Double-Cross المحسّنة
    return this.getNightmareDoubleCross(moves, cfg);
  }

  // 🎲 Double-Cross محسّن للكابوس
  getNightmareDoubleCross(moves, cfg) {
    // اترك سلسلة قصيرة (1-2 مربع) للخصم وأنت تأخذ الباقي
    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (const move of moves) {
      state.lines.add(move.key);

      const chains = this.analyzeChains(cfg);
      let score = 0;

      for (const chain of chains) {
        if (chain.length <= 2) {
          score += 50; // نقبل إعطاء سلاسل قصيرة
        } else {
          score -= chain.length * 100; // نتجنب إعطاء سلاسل طويلة
        }
      }

      // نفضل الحركات التي تبقي عدد السلاسل زوجياً (parity)
      const longChains = chains.filter(c => c.length >= 3).length;
      if (longChains % 2 === 0) score += 200;

      state.lines.delete(move.key);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // 🏅 أفضل حركة آمنة (تقلل المربعات الخطيرة مستقبلاً)
  getBestSafeMove(safeMoves, cfg) {
    let bestMove = safeMoves[0];
    let bestScore = -Infinity;

    for (const move of safeMoves) {
      state.lines.add(move.key);
      const dangerous = this.countSquaresWithEdges(cfg, 2);
      const score = -dangerous * 10 - this.getCenterDistance(move, cfg);
      state.lines.delete(move.key);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  // 🔢 عد المربعات المكتملة بمجرد إضافة مفتاح (بدون حذف)
  countCompletedSquaresWithKey(key, cfg) {
    let count = 0;
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const top    = makeKey(r,   c,   r,   c+1);
        const right  = makeKey(r,   c+1, r+1, c+1);
        const bottom = makeKey(r+1, c,   r+1, c+1);
        const left   = makeKey(r,   c,   r+1, c  );
        if (state.lines.has(top) && state.lines.has(right) &&
            state.lines.has(bottom) && state.lines.has(left)) {
          count++;
        }
      }
    }
    return count;
  }

  // 🧮 Minimax بسيط (Expert mode)
  minimaxSearch(moves, cfg, depth, isMaximizing) {
    if (depth === 0 || moves.length === 0) return null;

    let bestMove = null;
    let bestScore = isMaximizing ? -Infinity : Infinity;

    // نحدد عدد الحركات المفحوصة حسب العمق
    const movesToCheck = Math.min(moves.length, depth >= 4 ? 6 : 10);

    for (const move of moves.slice(0, movesToCheck)) {
      state.lines.add(move.key);
      
      const score = this.evaluateBoardDeep(cfg, depth);
      
      state.lines.delete(move.key);
      
      if (isMaximizing) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestMove = move;
        }
      }
    }

    return bestMove;
  }



  // 📊 تقييم عميق (Expert)
  evaluateBoardDeep(cfg, depth) {
    let score = 0;
    
    // نفس التقييم بس بوزن حسب العمق
    const ready = this.countSquaresWithEdges(cfg, 3);
    score += ready * (500 / depth);
    
    const dangerous = this.countSquaresWithEdges(cfg, 2);
    score -= dangerous * (200 / depth);
    
    const opportunity = this.countSquaresWithEdges(cfg, 1);
    score += opportunity * (50 / depth);
    
    return score;
  }

  // 🎯 أفضل حركة من الحركات الآمنة (تحليل متقدم)
  getAdvancedStrategicMove(safeMoves, cfg) {
    let bestMove = safeMoves[0];
    let bestScore = -Infinity;

    for (const move of safeMoves) {
      state.lines.add(move.key);
      
      let score = 0;
      
      // 1. عدد المربعات بضلع واحد (أفضل للسيطرة المستقبلية)
      score += this.countSquaresWithEdges(cfg, 1) * 5;
      
      // 2. عدد المربعات الفاضية تماماً
      score += this.countSquaresWithEdges(cfg, 0) * 3;
      
      // 3. قرب الحركة من المركز (المركز أفضل استراتيجياً)
      score -= this.getCenterDistance(move, cfg) * 2;
      
      // 4. تجنب إنشاء مربعات بضلعين (خطيرة)
      score -= this.countSquaresWithEdges(cfg, 2) * 10;
      
      state.lines.delete(move.key);
      
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // 🎲 استراتيجية Double-Cross (ضحي بأقل ما يمكن)
  getDoubleCrossMove(moves, cfg) {
    let bestMove = moves[0];
    let minGiveaway = Infinity;
    let maxKeep = -Infinity;

    for (const move of moves) {
      state.lines.add(move.key);
      
      // كم مربع رح يقدر الخصم ياخذ بعد هالحركة؟
      const giveaway = this.countDangerousSquares(cfg);
      
      // بعد ما الخصم ياخذ المربعات، كم رح يبقى للـ AI؟
      const keepForMe = this.estimateRemainingSquares(cfg);
      
      state.lines.delete(move.key);
      
      // نختار الحركة اللي تعطي أقل مربعات للخصم وتخلي أكثر مربعات للـ AI
      if (giveaway < minGiveaway || (giveaway === minGiveaway && keepForMe > maxKeep)) {
        minGiveaway = giveaway;
        maxKeep = keepForMe;
        bestMove = move;
      }
    }

    console.log('🎲 Double-Cross: Giving away', minGiveaway, 'squares, keeping', maxKeep);
    return bestMove;
  }

  // 📈 تقدير المربعات المتبقية بعد ضربة الخصم
  estimateRemainingSquares(cfg) {
    const totalSquares = (cfg.rows - 1) * (cfg.cols - 1);
    const filledSquares = state.lines.size;
    const dangerousNow = this.countDangerousSquares(cfg);
    
    // تقريباً كم رح يبقى بعد ما الخصم ياخذ المربعات الخطرة
    return Math.max(0, totalSquares - filledSquares - dangerousNow);
  }

  // 🔢 عد المربعات حسب عدد الأضلاع
  countSquaresWithEdges(cfg, targetEdges) {
    let count = 0;
    
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const edges = this.countSquareEdges(r, c, cfg);
        if (edges === targetEdges) count++;
      }
    }
    
    return count;
  }

  // 🎯 الحصول على الحركات اللي تكمل مربعات
  getCompletingMoves(moves, cfg) {
    return moves.filter(move => {
      const completedSquares = this.checkCompletedSquares(move, cfg);
      return completedSquares > 0;
    });
  }

  // 🎯 أفضل حركة لإكمال مربعات (تعطي أكبر سلسلة)
  getBestCompletingMove(completingMoves, cfg) {
    let bestMove = completingMoves[0];
    let maxSquares = 0;

    for (const move of completingMoves) {
      const squares = this.checkCompletedSquares(move, cfg);
      if (squares > maxSquares) {
        maxSquares = squares;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // ✅ الحصول على الحركات الآمنة (ما تعطي الخصم فرصة)
  getSafeMoves(moves, cfg) {
    return moves.filter(move => {
      // نجرب الحركة
      state.lines.add(move.key);
      
      // نشوف كم مربع رح يقدر الخصم يكمل بعد هالحركة
      const dangerousSquares = this.countDangerousSquares(cfg);
      
      // نرجع الحالة
      state.lines.delete(move.key);
      
      return dangerousSquares === 0;
    });
  }

  // 🔗 محاولة السيطرة على السلاسل (استراتيجية متقدمة)
  getChainControlMove(moves, cfg) {
    // نحسب عدد الأضلاع المرسومة لكل مربع
    const squareEdges = this.getSquareEdgeCounts(cfg);
    
    // نبحث عن مربعات بضلعين (خطيرة)
    for (const move of moves) {
      state.lines.add(move.key);
      
      // نشوف إذا هالحركة تخلق سلسلة يقدر يسيطر عليها
      const affectedSquares = this.getAffectedSquares(move, cfg);
      let twoEdgeSquares = 0;
      
      affectedSquares.forEach(sq => {
        const edges = this.countSquareEdges(sq.r, sq.c, cfg);
        if (edges === 2) twoEdgeSquares++;
      });
      
      state.lines.delete(move.key);
      
      // إذا ما خلق مربعات بضلعين، حركة جيدة
      if (twoEdgeSquares === 0) {
        return move;
      }
    }
    
    return null;
  }

  // 📊 أفضل حركة استراتيجية
  getBestStrategicMove(moves, cfg) {
    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (const move of moves) {
      // نحسب "قيمة" كل حركة
      const score = this.evaluateMove(move, cfg);
      
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // 💯 تقييم قيمة الحركة
  evaluateMove(move, cfg) {
    let score = 0;
    
    state.lines.add(move.key);
    
    // كم مربع رح نكمل؟
    score += this.checkCompletedSquares(move, cfg) * 100;
    
    // كم مربع رح نعطي الخصم فرصة يكمله؟
    score -= this.countDangerousSquares(cfg) * 50;
    
    // موقع الحركة (الوسط أفضل من الأطراف)
    const centerDistance = this.getCenterDistance(move, cfg);
    score -= centerDistance * 5;
    
    state.lines.delete(move.key);
    
    return score;
  }

  // ⚠️ أقل حركة خطورة (تعطي أقل فرص للخصم)
  getLeastDangerousMove(moves, cfg) {
    let leastDangerous = moves[0];
    let minDanger = Infinity;

    for (const move of moves) {
      state.lines.add(move.key);
      const danger = this.countDangerousSquares(cfg);
      state.lines.delete(move.key);

      if (danger < minDanger) {
        minDanger = danger;
        leastDangerous = move;
      }
    }

    return leastDangerous;
  }

  // 🔢 عد المربعات اللي الخصم يقدر يكملها بحركة واحدة
  countDangerousSquares(cfg) {
    let count = 0;
    
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        const edges = this.countSquareEdges(r, c, cfg);
        if (edges === 3) count++; // مربع ناقص ضلع واحد بس
      }
    }
    
    return count;
  }

  // 📐 عد أضلاع مربع معين
  countSquareEdges(r, c, cfg) {
    let count = 0;
    
    const top = makeKey(r, c, r, c + 1);
    const right = makeKey(r, c + 1, r + 1, c + 1);
    const bottom = makeKey(r + 1, c, r + 1, c + 1);
    const left = makeKey(r, c, r + 1, c);
    
    if (state.lines.has(top)) count++;
    if (state.lines.has(right)) count++;
    if (state.lines.has(bottom)) count++;
    if (state.lines.has(left)) count++;
    
    return count;
  }

  // 📊 جدول عدد الأضلاع لكل مربع
  getSquareEdgeCounts(cfg) {
    const counts = [];
    
    for (let r = 0; r < cfg.rows - 1; r++) {
      for (let c = 0; c < cfg.cols - 1; c++) {
        counts.push({
          r, c,
          edges: this.countSquareEdges(r, c, cfg)
        });
      }
    }
    
    return counts;
  }

  // 🎯 المربعات المتأثرة بحركة معينة
  getAffectedSquares(move, cfg) {
    const squares = [];
    
    if (move.r1 === move.r2) {
      // خط أفقي
      const col = Math.min(move.c1, move.c2);
      if (move.r1 > 0) squares.push({ r: move.r1 - 1, c: col });
      if (move.r1 < cfg.rows - 1) squares.push({ r: move.r1, c: col });
    } else {
      // خط عمودي
      const row = Math.min(move.r1, move.r2);
      if (move.c1 > 0) squares.push({ r: row, c: move.c1 - 1 });
      if (move.c1 < cfg.cols - 1) squares.push({ r: row, c: move.c1 });
    }
    
    return squares;
  }

  // 🔍 عد المربعات المكتملة من حركة
  checkCompletedSquares(move, cfg) {
    let count = 0;
    const squares = this.getAffectedSquares(move, cfg);
    
    state.lines.add(move.key);
    
    squares.forEach(sq => {
      if (sq.r >= 0 && sq.c >= 0 && sq.r < cfg.rows - 1 && sq.c < cfg.cols - 1) {
        if (checkForSquare(sq.r, sq.c)) {
          count++;
        }
      }
    });
    
    state.lines.delete(move.key);
    
    return count;
  }

  // 📍 المسافة من مركز اللوحة
  getCenterDistance(move, cfg) {
    const centerR = (cfg.rows - 1) / 2;
    const centerC = (cfg.cols - 1) / 2;
    
    const avgR = (move.r1 + move.r2) / 2;
    const avgC = (move.c1 + move.c2) / 2;
    
    return Math.abs(avgR - centerR) + Math.abs(avgC - centerC);
  }

  // 🔑 إنشاء مفتاح للخط (نسخة محلية)
  makeKey(r1, c1, r2, c2) {
    return makeKey(r1, c1, r2, c2);
  }

  // 🎲 اختيار عشوائي من مصفوفة
  randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  // 🔧 تغيير مستوى الصعوبة
  setDifficulty(difficulty) {
    this.difficulty = difficulty;
  }
}
