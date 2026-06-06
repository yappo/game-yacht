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

  function addDie(value) {
    if (state.dice.length >= 5) return showToast("ダイスは5個までです");
    updateState(() => {
      state.dice.push(value);
      state.held[state.dice.length - 1] = false;
    }, { clearRedo: true });
  }

  function rollDice() {
    if (state.rollCount >= 3) return;
    updateState(() => {
      const next = [];
      const held = [];
      for (let i = 0; i < 5; i += 1) {
        if (state.dice[i] && state.held[i]) {
          next[i] = state.dice[i];
          held[i] = true;
        } else {
          next[i] = Math.floor(Math.random() * 6) + 1;
          held[i] = false;
        }
      }
      state.dice = next;
      state.held = held;
      state.rollCount += 1;
    }, { clearRedo: true });
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
