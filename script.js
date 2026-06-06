(() => {
  "use strict";

  const STORAGE_KEY = "game-yacht-state-v1";
  const HISTORY_KEY = "game-yacht-results-v1";
  const VERSION = 1;
  const MAX_HISTORY = 50;
  const MAX_RESULTS = 20;
  const SCORE_KEYS = ["1", "2", "3", "4", "5", "6", "CH", "4D", "FH", "SS", "BS", "YT"];
  const HELP = [
    ["基本操作", "手入力では、上段の1から6のダイスをタップして5個の出目を作ります。選んだダイスは下の枠に入り、もう一度タップすると解除できます。5個そろうと、スコア欄に各役の得点が表示されます。入れたい役をタップすると、その役のスコアが確定します。"],
    ["Roll", "ダイス見出し右のRollをオンにすると、アプリ内でサイコロを振れます。Rollは1ターン最大3回です。残したいダイスをタップしてKeep状態にすると、次のRollでもその出目を残せます。Keep中のダイスをもう一度タップすると解除できます。"],
    ["スコア確定", "スコア欄の数字は、現在の5個のダイスでその役に入れた場合の得点です。確定済みの役はピンクで表示され、同じ役にはもう入れられません。役を確定するとダイスは空になり、次のターンへ進みます。"],
    ["Undo / Redo", "Undoは直前に確定した役、Reset、Newの状態を戻します。ダイスを1個選ぶ、外す、KeepするだけではUndo履歴に入りません。RedoはUndoで戻した状態をもう一度適用します。"],
    ["Reset / New", "ResetとNewは確認後に現在のゲームを初期状態へ戻します。実行直前のゲーム状態はUndoで戻せます。過去の結果履歴は、履歴削除を押した場合だけ削除されます。"],
    ["自動保存", "ゲーム状態、Undo / Redo履歴、過去の結果はこの端末のブラウザ内に自動保存されます。リロードやタブを閉じたあとでも復元できます。通信や外部保存は行いません。"],
    ["1-6合計 / Bonus", "1から6の役に入れた点の合計が1-6合計です。1-6合計が63点以上になるとBonusとして35点が加算されます。"],
    ["1 / 2 / 3 / 4 / 5 / 6", "その目だけを合計します。たとえば3が2個あれば、3のスコアは6点です。"],
    ["CH", "チョイス。出目に関係なく、5個のダイス合計を得点にできます。"],
    ["4D", "フォーダイス。同じ目が4個以上ある場合、5個のダイス合計を得点にできます。"],
    ["FH", "フルハウス。3個組と2個組がある場合、5個のダイス合計を得点にできます。"],
    ["SS", "スモールストレート。4個以上の連続した目がある場合、15点です。"],
    ["BS", "ビッグストレート。5個の連続した目がある場合、30点です。"],
    ["YT", "ヨット。5個すべてが同じ目の場合、50点です。"]
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    totalScore: $("totalScore"),
    filledCount: $("filledCount"),
    upperScore: $("upperScore"),
    bonusScore: $("bonusScore"),
    gameMode: $("gameMode"),
    rollControls: $("rollControls"),
    rollButton: $("rollButton"),
    manualDice: $("manualDice"),
    selectedDice: $("selectedDice"),
    diceCount: $("diceCount"),
    diceHint: $("diceHint"),
    scoreList: $("scoreList"),
    undoButton: $("undoButton"),
    redoButton: $("redoButton"),
    resetButton: $("resetButton"),
    newGameButton: $("newGameButton"),
    helpButton: $("helpButton"),
    helpDialog: $("helpDialog"),
    helpList: $("helpList"),
    toast: $("toast"),
    rollToast: $("rollToast"),
    rollToastDice: $("rollToastDice"),
    rollCanvas: $("rollCanvas"),
    finishCelebration: $("finishCelebration"),
    celebrationKicker: $("celebrationKicker"),
    celebrationScore: $("celebrationScore"),
    celebrationMessage: $("celebrationMessage"),
    celebrationClose: $("celebrationClose"),
    historySummary: $("historySummary"),
    historyList: $("historyList"),
    clearHistoryButton: $("clearHistoryButton")
  };

  let state = initialState();
  let undoStack = [];
  let redoStack = [];
  let resultHistory = loadResults();
  let toastTimer = 0;
  let rollToastTimer = 0;
  let rollAnimationFrame = 0;
  let celebrationTimer = 0;

  function initialState(mode = "manual") {
    return {
      mode,
      dice: [],
      held: [false, false, false, false, false],
      rollCount: 0,
      scores: Object.fromEntries(SCORE_KEYS.map((key) => [key, null])),
      finishedSaved: false
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshot() {
    return clone(state);
  }

  function commit(mutator, message) {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    mutator();
    normalizeState();
    persist();
    render();
    if (message) showToast(message, "notice");
  }

  function updateState(mutator, options = {}) {
    if (options.clearRedo) redoStack = [];
    mutator();
    normalizeState();
    persist();
    render();
    if (options.message) showToast(options.message);
  }

  function normalizeState() {
    state.dice = state.dice.slice(0, 5).map((n) => Math.min(6, Math.max(1, Number(n) || 1)));
    state.held = [0, 1, 2, 3, 4].map((i) => Boolean(state.held[i] && state.dice[i]));
    state.rollCount = Math.min(3, Math.max(0, Number(state.rollCount) || 0));
    state.mode = state.mode === "roll" ? "roll" : "manual";
    for (const key of SCORE_KEYS) {
      state.scores[key] = state.scores[key] === null ? null : Number(state.scores[key]) || 0;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        savedAt: Date.now(),
        currentState: state,
        undoStack,
        redoStack
      }));
    } catch (_) {
      showToast("端末内への保存に失敗しました");
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.version !== VERSION || !data.currentState) throw new Error("unsupported");
      state = clone(data.currentState);
      undoStack = Array.isArray(data.undoStack) ? data.undoStack.slice(-MAX_HISTORY) : [];
      redoStack = Array.isArray(data.redoStack) ? data.redoStack.slice(-MAX_HISTORY) : [];
      normalizeState();
      showToast("前回のゲームを復元しました");
    } catch (_) {
      state = initialState();
      undoStack = [];
      redoStack = [];
      persist();
      showToast("保存データを読み込めなかったため初期状態に戻しました");
    }
  }

  function loadResults() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(data) ? data.slice(0, MAX_RESULTS) : [];
    } catch (_) {
      return [];
    }
  }

  function saveResults() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(resultHistory.slice(0, MAX_RESULTS)));
  }

  function counts() {
    return state.dice.reduce((acc, n) => {
      acc[n] = (acc[n] || 0) + 1;
      return acc;
    }, {});
  }

  function diceSum() {
    return state.dice.reduce((sum, n) => sum + n, 0);
  }

  function upperSum() {
    return ["1", "2", "3", "4", "5", "6"].reduce((sum, key) => sum + (state.scores[key] || 0), 0);
  }

  function bonus() {
    return upperSum() >= 63 ? 35 : 0;
  }

  function total() {
    return SCORE_KEYS.reduce((sum, key) => sum + (state.scores[key] || 0), 0) + bonus();
  }

  function scoreFor(key) {
    const c = counts();
    const sum = diceSum();
    const unique = [...new Set(state.dice)].sort().join("");
    if (/^[1-6]$/.test(key)) return (c[Number(key)] || 0) * Number(key);
    if (key === "CH") return sum;
    if (key === "4D") return Object.values(c).some((v) => v >= 4) ? sum : 0;
    if (key === "FH") return Object.values(c).includes(3) && Object.values(c).includes(2) ? sum : 0;
    if (key === "SS") return /1234|2345|3456/.test(unique) ? 15 : 0;
    if (key === "BS") return /12345|23456/.test(unique) ? 30 : 0;
    if (key === "YT") return Object.values(c).some((v) => v === 5) ? 50 : 0;
    return 0;
  }

  function labelFor(key) {
    return {
      "1": "エース", "2": "ツー", "3": "スリー", "4": "フォー", "5": "ファイブ", "6": "シックス",
      CH: "チョイス", "4D": "フォーダイス", FH: "フルハウス", SS: "S.ストレート", BS: "B.ストレート", YT: "ヨット"
    }[key];
  }

  function render() {
    const filled = SCORE_KEYS.filter((key) => state.scores[key] !== null).length;
    if (filled === SCORE_KEYS.length && !state.finishedSaved) {
      finishGame();
    }
    els.totalScore.textContent = total();
    els.filledCount.textContent = filled;
    els.gameMode.checked = state.mode === "roll";
    els.rollControls.hidden = state.mode !== "roll";
    els.manualDice.hidden = state.mode === "roll";
    els.rollButton.textContent = `Roll ${state.rollCount}/3`;
    els.rollButton.disabled = state.rollCount >= 3;
    els.diceCount.textContent = `${state.dice.length}/5`;
    els.diceHint.textContent = state.mode === "roll"
      ? "タップで Keep / 解除"
      : "タップで解除";
    renderDice();
    renderScores();
    renderHistory();
    els.undoButton.disabled = undoStack.length === 0;
    els.redoButton.disabled = redoStack.length === 0;
  }

  function renderDice() {
    els.selectedDice.innerHTML = "";
    for (let index = 0; index < 5; index += 1) {
      const value = state.dice[index];
      const button = document.createElement("button");
      button.type = "button";
      if (value) {
        button.className = `die${state.held[index] ? " held" : ""}`;
        button.dataset.value = value;
        button.dataset.index = index;
        button.textContent = value;
        button.setAttribute("aria-label", state.mode === "roll" ? `${value} ${state.held[index] ? "Keep解除" : "Keep"}` : `${value}を解除`);
      } else {
        button.className = "die die-empty";
        button.disabled = true;
        button.textContent = "-";
        button.setAttribute("aria-label", "未選択");
      }
      els.selectedDice.append(button);
    }
  }

  function renderScores() {
    els.scoreList.innerHTML = "";
    for (const key of SCORE_KEYS) {
      const fixed = state.scores[key] !== null;
      const hasDice = state.dice.length > 0;
      const candidate = hasDice ? scoreFor(key) : 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `score-row ${fixed ? "filled" : hasDice ? "candidate" : "disabled"}`;
      button.dataset.score = key;
      button.disabled = fixed || !hasDice;
      button.innerHTML = `<strong>${key}</strong><span>${labelFor(key)}</span><span class="state">${fixed ? `${state.scores[key]}点` : hasDice ? `${candidate}点` : "-"}</span>`;
      els.scoreList.append(button);
      if (key === "6") {
        els.scoreList.append(summaryCard("1-6合計", `${upperSum()}/63`));
        els.scoreList.append(summaryCard("Bonus", bonus()));
      }
    }
  }

  function summaryCard(label, value) {
    const div = document.createElement("div");
    div.className = "score-row summary";
    div.innerHTML = `<strong>${label}</strong><span></span><span class="state">${value}</span>`;
    return div;
  }

  function renderHistory() {
    const count = resultHistory.length;
    const best = count ? Math.max(...resultHistory.map((r) => r.totalScore)) : 0;
    const average = count ? Math.round(resultHistory.reduce((s, r) => s + r.totalScore, 0) / count) : 0;
    els.historySummary.innerHTML = `<div><span class="label">回数</span><strong>${count}</strong></div><div><span class="label">最高</span><strong>${best}</strong></div><div><span class="label">平均</span><strong>${average}</strong></div>`;
    els.historyList.innerHTML = count ? "" : "<p class=\"hint\">まだ結果はありません。</p>";
    for (const item of resultHistory) {
      const div = document.createElement("div");
      div.className = "history-item";
      const scores = SCORE_KEYS.map((key) => `${key}:${item.scores[key] ?? "-"}`).join(" ");
      div.innerHTML = `<strong>${item.totalScore}点</strong> <span class="label">${new Date(item.playedAt).toLocaleString("ja-JP")} / ${item.mode === "roll" ? "Roll" : "手入力"}</span><br>${scores}`;
      els.historyList.append(div);
    }
  }

  function finishGame() {
    state.finishedSaved = true;
    resultHistory.unshift({
      playedAt: Date.now(),
      totalScore: total(),
      mode: state.mode,
      scores: clone(state.scores)
    });
    resultHistory = resultHistory.slice(0, MAX_RESULTS);
    saveResults();
    persist();
    scheduleFinishCelebration(total());
  }

  function scheduleFinishCelebration(score) {
    clearTimeout(celebrationTimer);
    celebrationTimer = setTimeout(() => {
      showFinishCelebration(score);
    }, 3100);
  }

  function scoreTier(score) {
    if (score < 50) return "tier-poor";
    if (score < 100) return "tier-low";
    if (score < 150) return "tier-mid";
    if (score < 200) return "tier-high";
    if (score < 250) return "tier-jackpot";
    return "tier-legend";
  }

  function showFinishCelebration(score) {
    const tier = scoreTier(score);
    const messages = {
      "tier-poor": ["しょんぼり終了", "小銭スコア"],
      "tier-low": ["FINISH", "まだまだいける"],
      "tier-mid": ["GOOD GAME", "いい感じ"],
      "tier-high": ["BIG SCORE", "かなり強い"],
      "tier-jackpot": ["大当たり", "超 Yacht Rush"],
      "tier-legend": ["超大当たり", "LEGEND Yacht"]
    };
    const [kicker, message] = messages[tier];
    els.finishCelebration.className = `finish-celebration ${tier}`;
    els.celebrationKicker.textContent = kicker;
    els.celebrationScore.textContent = `${score}点`;
    els.celebrationMessage.textContent = message;
    els.finishCelebration.hidden = false;
    requestAnimationFrame(() => els.finishCelebration.classList.add("show"));
  }

  function hideFinishCelebration() {
    els.finishCelebration.classList.remove("show");
    setTimeout(() => {
      els.finishCelebration.hidden = true;
    }, 250);
  }

  function showToast(text, variant = "default") {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.toggle("toast--notice", variant === "notice");
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show", "toast--notice");
    }, variant === "notice" ? 2600 : 2200);
  }

  function showRollToast(values) {
    clearTimeout(rollToastTimer);
    cancelAnimationFrame(rollAnimationFrame);
    els.rollToastDice.innerHTML = "";
    els.rollToast.hidden = false;
    if (!values.length) {
      els.rollToastDice.textContent = "すべて Keep";
      els.rollCanvas.hidden = true;
    } else {
      els.rollCanvas.hidden = false;
      startCanvasRoll(values);
    }
    els.rollToast.classList.remove("show");
    requestAnimationFrame(() => els.rollToast.classList.add("show"));
    rollToastTimer = setTimeout(() => {
      els.rollToast.classList.remove("show");
      setTimeout(() => {
        els.rollToast.hidden = true;
      }, 180);
    }, 3000);
  }

  function startCanvasRoll(values) {
    const canvas = els.rollCanvas;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const spacing = width / (values.length + 1);
    const floorY = height - 62;
    const sparks = [];
    const dice = values.map((value, index) => ({
      value,
      index,
      ...finalAnglesForValue(value),
      x: spacing * (index + 1) + (Math.random() - 0.5) * 72,
      y: -95 - Math.random() * 95 - index * 10,
      vx: (Math.random() - 0.5) * 5.2,
      vy: 1.2 + Math.random() * 1.6,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      rz: Math.random() * Math.PI * 2,
      avx: (Math.random() - 0.5) * 0.28,
      avy: (Math.random() - 0.5) * 0.28,
      avz: (Math.random() - 0.5) * 0.2,
      targetX: spacing * (index + 1),
      radius: 26,
      delay: index * 55
    }));
    const start = performance.now();
    let last = start;

    function frame(now) {
      const elapsed = now - start;
      const dt = Math.min(2, (now - last) / 16.67);
      last = now;
      ctx.clearRect(0, 0, width, height);
      drawRollStage(ctx, width, height);
      stepRollPhysics(dice, sparks, width, floorY, dt, elapsed);
      dice.forEach((die) => {
        drawRollingDie(ctx, die);
      });
      drawSparks(ctx, sparks, dt);
      if (elapsed < 3000) {
        rollAnimationFrame = requestAnimationFrame(frame);
      }
    }
    rollAnimationFrame = requestAnimationFrame(frame);
  }

  function stepRollPhysics(dice, sparks, width, floorY, dt, elapsed) {
    const gravity = 0.56;
    dice.forEach((die) => {
      if (elapsed < die.delay) return;
      die.vy += gravity * dt;
      die.x += die.vx * dt;
      die.y += die.vy * dt;
      die.rx += die.avx * dt;
      die.ry += die.avy * dt;
      die.rz += die.avz * dt;

      if (die.x < die.radius) {
        die.x = die.radius;
        die.vx = Math.abs(die.vx) * 0.68;
        die.avz += 0.07;
      }
      if (die.x > width - die.radius) {
        die.x = width - die.radius;
        die.vx = -Math.abs(die.vx) * 0.68;
        die.avz -= 0.07;
      }
      if (die.y > floorY) {
        die.y = floorY;
        if (Math.abs(die.vy) > 1.2) {
          sparks.push({ x: die.x, y: floorY + 20, life: 1, power: Math.min(1, Math.abs(die.vy) / 15) });
        }
        if (Math.abs(die.vy) < 1.35) {
          die.vy = 0;
        } else {
          die.vy = -Math.abs(die.vy) * 0.42;
        }
        die.vx *= 0.78;
        die.avx *= 0.72;
        die.avy *= 0.72;
        die.avz *= 0.72;
      }
      die.vx += (die.targetX - die.x) * 0.0018 * dt;
      if (die.y >= floorY - 0.5) {
        die.vx *= 0.96;
      }
      const settle = Math.max(0, Math.min((elapsed - 1100) / 1600, 1));
      const orientEase = settle * settle * 0.045 * dt;
      die.rx += angleDelta(die.rx, die.rxTarget) * orientEase;
      die.ry += angleDelta(die.ry, die.ryTarget) * orientEase;
      die.rz += angleDelta(die.rz, die.rzTarget) * orientEase;
      const spinDamp = 1 - settle * 0.055 * dt;
      die.avx *= spinDamp;
      die.avy *= spinDamp;
      die.avz *= spinDamp;
      if (elapsed > 2500) {
        die.y += (floorY - die.y) * 0.08 * dt;
        die.vy *= 0.72;
        die.vx *= 0.86;
      }
    });

    for (let i = 0; i < dice.length; i += 1) {
      for (let j = i + 1; j < dice.length; j += 1) {
        const a = dice[i];
        const b = dice[j];
        if (elapsed < a.delay || elapsed < b.delay) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const minDist = (a.radius + b.radius) * 0.78;
        if (dist >= minDist) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const impact = rvx * nx + rvy * ny;
        if (impact < 0) {
          const impulse = -impact * 0.58;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
          a.avz -= impulse * 0.022;
          b.avz += impulse * 0.022;
          sparks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, life: 1, power: Math.min(1, impulse / 7) });
        }
      }
    }
  }

  function drawRollStage(ctx, width, height) {
    const floorY = height - 42;
    const grad = ctx.createLinearGradient(0, floorY - 70, 0, floorY + 18);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(155,124,246,0.12)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(43,38,48,0.08)";
    ctx.beginPath();
    ctx.ellipse(width / 2, floorY + 8, width * 0.38, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRollingDie(ctx, die) {
    const size = 27;
    drawCube(ctx, die.x, die.y, size, die.rx, die.ry, die.rz);
  }

  function drawSparks(ctx, sparks, dt) {
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= 0.08 * dt;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.strokeStyle = `rgba(155, 124, 246, ${spark.life * 0.18})`;
      ctx.lineWidth = 1 + spark.power * 0.7;
      for (let ray = 0; ray < 5; ray += 1) {
        const a = -Math.PI / 2 + ray * Math.PI / 4;
        const len = 4 + spark.power * 8 * spark.life;
        ctx.beginPath();
        ctx.moveTo(spark.x + Math.cos(a) * 2, spark.y + Math.sin(a) * 2);
        ctx.lineTo(spark.x + Math.cos(a) * len, spark.y + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function angleDelta(current, target) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
  }

  function finalAnglesForValue(value) {
    return {
      1: { rxTarget: -0.38, ryTarget: 0.44, rzTarget: -0.08 },
      2: { rxTarget: -0.32, ryTarget: -Math.PI / 2 + 0.38, rzTarget: 0.06 },
      3: { rxTarget: -Math.PI / 2 + 0.36, ryTarget: 0.38, rzTarget: -0.04 },
      4: { rxTarget: Math.PI / 2 - 0.36, ryTarget: 0.38, rzTarget: 0.04 },
      5: { rxTarget: -0.32, ryTarget: Math.PI / 2 - 0.38, rzTarget: -0.06 },
      6: { rxTarget: -0.38, ryTarget: Math.PI - 0.44, rzTarget: 0.08 }
    }[value];
  }

  function drawCube(ctx, cx, cy, size, rx, ry, rz) {
    const vertices = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ].map(([x, y, z]) => rotatePoint({ x: x * size, y: y * size, z: z * size }, rx, ry, rz));
    const faces = [
      { value: 6, points: [0, 1, 2, 3], shade: 0.82 },
      { value: 1, points: [4, 5, 6, 7], shade: 1.04 },
      { value: 2, points: [1, 5, 6, 2], shade: 0.9 },
      { value: 5, points: [0, 4, 7, 3], shade: 0.78 },
      { value: 3, points: [0, 1, 5, 4], shade: 1.0 },
      { value: 4, points: [3, 2, 6, 7], shade: 0.86 }
    ].map((face) => {
      const pts3 = face.points.map((i) => vertices[i]);
      const avgZ = pts3.reduce((sum, p) => sum + p.z, 0) / pts3.length;
      return { ...face, pts3, avgZ, pts2: pts3.map((p) => projectPoint(p, cx, cy)) };
    }).sort((a, b) => a.avgZ - b.avgZ);

    ctx.fillStyle = `rgba(43,38,48,${0.10 + 0.14 * Math.min(1, cy / 160)})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 1.45, size * 1.05, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    faces.forEach((face) => drawFace(ctx, face));
  }

  function rotatePoint(p, rx, ry, rz) {
    let { x, y, z } = p;
    let cy = Math.cos(rx), sy = Math.sin(rx);
    [y, z] = [y * cy - z * sy, y * sy + z * cy];
    cy = Math.cos(ry); sy = Math.sin(ry);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    cy = Math.cos(rz); sy = Math.sin(rz);
    [x, y] = [x * cy - y * sy, x * sy + y * cy];
    return { x, y, z };
  }

  function projectPoint(p, cx, cy) {
    const distance = 360;
    const scale = distance / (distance - p.z);
    return { x: cx + p.x * scale, y: cy + p.y * scale };
  }

  function drawFace(ctx, face) {
    const pts = face.pts2;
    roundedPolygon(ctx, pts, 5);
    const base = Math.round(245 * face.shade);
    const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
    grad.addColorStop(0, `rgb(${Math.min(base + 18, 255)}, ${Math.min(base + 14, 255)}, ${Math.min(base + 22, 255)})`);
    grad.addColorStop(1, `rgb(${Math.max(base - 14, 150)}, ${Math.max(base - 18, 150)}, ${Math.max(base - 8, 150)})`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(65,48,70,0.58)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    drawPips(ctx, pts, face.value);
  }

  function roundedPolygon(ctx, pts, radius) {
    ctx.beginPath();
    pts.forEach((point, index) => {
      const prev = pts[(index + pts.length - 1) % pts.length];
      const next = pts[(index + 1) % pts.length];
      const p1 = pointAlong(point, prev, radius);
      const p2 = pointAlong(point, next, radius);
      if (index === 0) ctx.moveTo(p1.x, p1.y);
      else ctx.lineTo(p1.x, p1.y);
      ctx.quadraticCurveTo(point.x, point.y, p2.x, p2.y);
    });
    ctx.closePath();
  }

  function pointAlong(from, to, distance) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const t = Math.min(0.42, distance / len);
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  function drawPips(ctx, pts, value) {
    const positions = {
      1: [[0.5, 0.5, true]],
      2: [[0.3, 0.3], [0.7, 0.7]],
      3: [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]],
      4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
      5: [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]],
      6: [[0.3, 0.24], [0.7, 0.24], [0.3, 0.5], [0.7, 0.5], [0.3, 0.76], [0.7, 0.76]]
    }[value];
    positions.forEach(([u, v, red]) => {
      const p = bilinear(pts, u, v);
      ctx.fillStyle = red ? "#ff4f7f" : "#111";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function bilinear(pts, u, v) {
    const top = lerpPoint(pts[0], pts[1], u);
    const bottom = lerpPoint(pts[3], pts[2], u);
    return lerpPoint(top, bottom, v);
  }

  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function addDie(value) {
    if (state.dice.length >= 5) return showToast("ダイスは5個までです");
    updateState(() => {
      state.dice.push(value);
      state.held[state.dice.length - 1] = false;
    }, { clearRedo: true });
  }

  function rollDice() {
    if (state.rollCount >= 3) return;
    const rolledValues = [];
    updateState(() => {
      const next = [];
      const held = [];
      for (let i = 0; i < 5; i += 1) {
        if (state.dice[i] && state.held[i]) {
          next[i] = state.dice[i];
          held[i] = true;
        } else {
          next[i] = Math.floor(Math.random() * 6) + 1;
          rolledValues.push(next[i]);
          held[i] = false;
        }
      }
      state.dice = next;
      state.held = held;
      state.rollCount += 1;
    }, { clearRedo: true });
    showRollToast(rolledValues);
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  els.manualDice.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-die]");
    if (button) addDie(Number(button.dataset.addDie));
  });

  els.selectedDice.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (!button) return;
    const index = Number(button.dataset.index);
    updateState(() => {
      if (state.mode === "roll") {
        state.held[index] = !state.held[index];
      } else {
        state.dice.splice(index, 1);
        state.held.splice(index, 1);
      }
    }, { clearRedo: true });
  });

  els.scoreList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-score]");
    if (!button || button.disabled) return;
    const key = button.dataset.score;
    const isFinalTurn = SCORE_KEYS.filter((scoreKey) => state.scores[scoreKey] === null).length === 1;
    commit(() => {
      state.scores[key] = scoreFor(key);
      state.dice = [];
      state.held = [false, false, false, false, false];
      state.rollCount = 0;
      state.finishedSaved = false;
    }, `${key} を確定しました`);
  });

  els.gameMode.addEventListener("change", () => {
    updateState(() => {
      state.mode = els.gameMode.checked ? "roll" : "manual";
      state.dice = [];
      state.held = [false, false, false, false, false];
      state.rollCount = 0;
    }, { clearRedo: true, message: state.mode === "roll" ? "Roll モードに切り替えました" : "手入力モードに切り替えました" });
  });

  els.rollButton.addEventListener("click", rollDice);

  els.undoButton.addEventListener("click", () => {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    state = undoStack.pop();
    normalizeState();
    persist();
    render();
  });

  els.redoButton.addEventListener("click", () => {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    state = redoStack.pop();
    normalizeState();
    persist();
    render();
  });

  els.resetButton.addEventListener("click", () => {
    if (!confirmAction("現在のゲームを初期状態に戻します。Undo で元に戻せます。")) return;
    commit(() => {
      state = initialState(state.mode);
    }, "リセットしました");
  });

  els.newGameButton.addEventListener("click", () => {
    if (!confirmAction("新しいゲームを開始します。Undo で直前の状態へ戻せます。")) return;
    commit(() => {
      state = initialState(state.mode);
    }, "新しいゲームを開始しました");
  });

  els.clearHistoryButton.addEventListener("click", () => {
    if (!confirmAction("過去の結果履歴を削除します。この操作は Undo できません。")) return;
    resultHistory = [];
    saveResults();
    renderHistory();
    showToast("結果履歴を削除しました");
  });

  els.helpButton.addEventListener("click", () => els.helpDialog.showModal());
  els.celebrationClose.addEventListener("click", hideFinishCelebration);
  els.finishCelebration.addEventListener("click", (event) => {
    if (event.target === els.finishCelebration) hideFinishCelebration();
  });

  function initHelp() {
    els.helpList.innerHTML = "";
    HELP.forEach(([title, text]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = title;
      dd.textContent = text;
      els.helpList.append(dt, dd);
    });
  }

  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persist();
  });

  initHelp();
  restore();
  render();
})();
