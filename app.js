(() => {
  "use strict";

  const STORAGE_KEY = "zh-vocab-stats-v1";
  const CHOICE_COUNT = 4;
  const MODE_LABELS = { word: "単語 → 意味", audio: "音声 → 意味", meaning: "意味 → 単語" };

  const $ = (id) => document.getElementById(id);

  // ---------- データ ----------
  // レベル定義（初級のキーは以前の保存データと互換を保つため接頭辞なし）
  // レベル = HSK1〜6級
  const LEVELS = {};
  for (const lv of Object.keys(HSK_WORDS)) LEVELS[lv] = { label: `HSK${lv}級` };
  const CATS = Object.keys(CATEGORY_LABELS);
  // 全単語を {level, cat, zh, py, ja, key} に展開
  const ALL = [];
  for (const [level, cats] of Object.entries(HSK_WORDS)) {
    for (const [cat, list] of Object.entries(cats)) {
      for (const [zh, py, ja] of list) {
        ALL.push({ level, cat, zh, py, ja, key: `hsk${level}:${cat}:${zh}` });
      }
    }
  }
  const wordsOf = (level, cat) =>
    ALL.filter((w) => w.level === level && (cat === "all" || w.cat === cat));

  // ---------- 正解回数の保存 ----------
  let stats = {};
  try {
    stats = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (_) {
    stats = {};
  }
  const saveStats = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (_) { /* 保存できない環境では無視 */ }
  };
  // 旧形式（初級/上級時代）のキー「品詞:漢字」「adv:品詞:漢字」を、同じ漢字のHSK単語へ引き継ぐ
  (() => {
    const byZh = new Map(ALL.map((w) => [w.zh, w]));
    let changed = false;
    for (const oldKey of Object.keys(stats)) {
      if (oldKey.startsWith("hsk")) continue;
      const zh = oldKey.split(":").pop();
      const w = byZh.get(zh);
      if (w) {
        const cur = stats[w.key] || { c: 0, a: 0 };
        stats[w.key] = { c: cur.c + stats[oldKey].c, a: cur.a + stats[oldKey].a };
      }
      delete stats[oldKey];
      changed = true;
    }
    if (changed) saveStats();
  })();
  const statOf = (w) => stats[w.key] || { c: 0, a: 0 };
  const record = (w, correct) => {
    const s = statOf(w);
    s.a += 1;
    if (correct) s.c += 1;
    stats[w.key] = s;
    saveStats();
  };

  // ---------- 音声 ----------
  let zhVoice = null;
  const pickVoice = () => {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => /zh[-_]CN/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null;
  };
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  const speak = (text) => {
    if (!("speechSynthesis" in window)) {
      alert("このブラウザは音声読み上げに対応していません。");
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    if (zhVoice) u.voice = zhVoice;
    u.rate = 0.85;
    speechSynthesis.speak(u);
  };

  // ---------- ユーティリティ ----------
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- 画面切り替え ----------
  const SCREENS = ["menu", "quiz", "result", "list"];
  const show = (name) => {
    SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== name));
    $("homeBtn").classList.toggle("hidden", name === "menu");
    if (name === "menu") renderMenu();
    window.scrollTo(0, 0);
  };

  // ---------- メニュー ----------
  const categoryKeys = ["all", ...CATS];
  const catLabel = (cat) => (cat === "all" ? "すべて" : CATEGORY_LABELS[cat]);

  const renderMenu = () => {
    const box = $("categoryList");
    const checked = box.querySelector("input:checked")?.value || CATS[0];
    const level = selected("level");
    box.innerHTML = "";
    for (const cat of categoryKeys) {
      const words = wordsOf(level, cat);
      const mastered = words.filter((w) => statOf(w).c > 0).length;
      const label = el("label", "option");
      const input = el("input");
      input.type = "radio";
      input.name = "category";
      input.value = cat;
      input.checked = cat === checked;
      const span = el("span", null, catLabel(cat));
      span.appendChild(el("small", null, `${words.length}語 / 正解済 ${mastered}`));
      label.append(input, span);
      box.appendChild(label);
    }
    const totalCorrect = Object.values(stats).reduce((n, s) => n + s.c, 0);
    const totalAnswered = Object.values(stats).reduce((n, s) => n + s.a, 0);
    $("totalStats").textContent = `累計 正解 ${totalCorrect} / 回答 ${totalAnswered}`;
  };

  const selected = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

  // ---------- クイズ ----------
  let quiz = null; // {mode, cat, questions, index, correct, missed, answered}

  const startQuiz = (questions, mode, cat) => {
    if (questions.length === 0) return;
    quiz = { mode, cat, questions, index: 0, correct: 0, missed: [], answered: false };
    show("quiz");
    renderQuestion();
  };

  const startFromMenu = () => {
    const level = selected("level");
    const cat = selected("category");
    const mode = selected("mode");
    const count = Number(selected("count"));
    let pool = shuffle(wordsOf(level, cat));
    if ($("weakFirst").checked) {
      // 正解回数が少ない順（同数はランダムのまま）
      pool.sort((a, b) => statOf(a).c - statOf(b).c);
    }
    if (count > 0) pool = pool.slice(0, count);
    startQuiz(shuffle(pool), mode, cat);
  };

  // ---------- 発音の近さ ----------
  const TONE_MAP = {
    ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
    ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
    ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
    ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
    ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
    ǖ: ["v", 1], ǘ: ["v", 2], ǚ: ["v", 3], ǜ: ["v", 4], ü: ["v", 0],
  };
  // ピンインを「声調なしの綴り」と「声調の並び」に分解（結果はキャッシュ）
  const phonCache = new Map();
  const phonetic = (w) => {
    if (phonCache.has(w.key)) return phonCache.get(w.key);
    let plain = "";
    const tones = [];
    for (const ch of w.py.toLowerCase().replace(/['’\s]/g, "")) {
      const t = TONE_MAP[ch];
      if (t) {
        plain += t[0];
        if (t[1]) tones.push(t[1]);
      } else {
        plain += ch;
      }
    }
    // 聞き間違えやすい音をまとめた綴り（zh/z, ch/c, sh/s, -ng/-n, l/n）
    const loose = plain
      .replace(/zh/g, "z").replace(/ch/g, "c").replace(/sh/g, "s")
      .replace(/ng/g, "n").replace(/l/g, "n");
    const r = { plain, loose, tones: tones.join("") };
    phonCache.set(w.key, r);
    return r;
  };
  const editDistance = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return d[a.length][b.length];
  };
  // 小さいほど発音が近い
  const soundDistance = (a, b) => {
    const pa = phonetic(a);
    const pb = phonetic(b);
    return (
      editDistance(pa.loose, pb.loose) * 3 +
      editDistance(pa.plain, pb.plain) * 2 +
      editDistance(pa.tones, pb.tones) +
      Math.abs([...a.zh].length - [...b.zh].length) * 2
    );
  };
  const samePronunciation = (a, b) => {
    const pa = phonetic(a);
    const pb = phonetic(b);
    return pa.plain === pb.plain && pa.tones === pb.tones;
  };

  const makeChoices = (answer, mode) => {
    const picks = [answer];
    const usable = (w) =>
      !picks.some((p) => p.ja === w.ja || p.zh === w.zh || samePronunciation(p, w));

    if (mode === "audio") {
      // 音声モード：全単語から発音の近いものを上位から少しランダムに選ぶ
      const ranked = shuffle(ALL)
        .filter((w) => w.key !== answer.key)
        .map((w) => ({ w, d: soundDistance(answer, w) }))
        .sort((x, y) => x.d - y.d);
      const top = shuffle(ranked.slice(0, (CHOICE_COUNT - 1) * 2).map((x) => x.w));
      for (const w of [...top, ...ranked.map((x) => x.w)]) {
        if (picks.length >= CHOICE_COUNT) break;
        if (usable(w)) picks.push(w);
      }
      return shuffle(picks);
    }

    // それ以外：同じレベル・品詞から、意味・漢字が重複しないダミーを選ぶ
    // 品詞の語数が足りないとき（HSK1の副詞など）は同じ級の全品詞→全単語の順に広げる
    let pool = wordsOf(answer.level, answer.cat);
    if (pool.length < CHOICE_COUNT * 2) pool = wordsOf(answer.level, "all");
    pool = [...shuffle(pool), ...shuffle(ALL)];
    for (const w of pool) {
      if (picks.length >= CHOICE_COUNT) break;
      if (usable(w)) picks.push(w);
    }
    return shuffle(picks);
  };

  const renderQuestion = () => {
    const q = quiz.questions[quiz.index];
    const { mode } = quiz;
    quiz.answered = false;

    $("progress").textContent = `${LEVELS[q.level].label}・${MODE_LABELS[mode]}　${quiz.index + 1} / ${quiz.questions.length}`;
    $("score").textContent = `正解 ${quiz.correct}`;

    const qEl = $("question");
    qEl.classList.toggle("meaning", mode === "meaning");
    qEl.textContent = mode === "word" ? q.zh : mode === "meaning" ? q.ja : "？";
    $("pinyin").textContent = "";
    $("speakBtn").classList.toggle("hidden", mode === "meaning");
    const s = statOf(q);
    $("wordStat").textContent = `この単語：正解 ${s.c}回 / 回答 ${s.a}回`;
    $("feedback").textContent = "";
    $("feedback").className = "feedback";
    $("nextBtn").classList.add("hidden");

    const box = $("choices");
    box.innerHTML = "";
    for (const w of makeChoices(q, mode)) {
      const b = el("button", "choice");
      if (mode === "meaning") {
        b.classList.add("hanzi");
        b.textContent = w.zh;
      } else {
        b.textContent = w.ja;
      }
      b.dataset.key = w.key;
      b.addEventListener("click", () => answer(w, b));
      box.appendChild(b);
    }

    if (mode === "audio") speak(q.zh);
  };

  const answer = (picked, btn) => {
    if (quiz.answered) return;
    quiz.answered = true;
    const q = quiz.questions[quiz.index];
    const ok = picked.key === q.key;
    record(q, ok);

    if (ok) {
      quiz.correct += 1;
    } else {
      quiz.missed.push(q);
      btn.classList.add("wrong");
    }

    // 正解の表示
    $("choices").querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      const w = ALL.find((x) => x.key === b.dataset.key);
      if (w.key === q.key) b.classList.add("correct");
      if (quiz.mode === "meaning") {
        b.appendChild(el("span", "sub", w.py));
      } else if (quiz.mode === "audio") {
        // 発音の違いが分かるようにピンインも表示
        b.appendChild(el("span", "sub", `${w.zh}  ${w.py}`));
      } else {
        b.appendChild(el("span", "sub", w.zh));
      }
    });

    // 回答後はどのモードでも漢字・ピンイン・意味をまとめて表示
    $("question").textContent = q.zh;
    $("question").classList.remove("meaning");
    $("pinyin").textContent = `${q.py}　${q.ja}`;
    $("speakBtn").classList.remove("hidden");
    const s = statOf(q);
    $("wordStat").textContent = `この単語：正解 ${s.c}回 / 回答 ${s.a}回`;
    $("score").textContent = `正解 ${quiz.correct}`;

    const fb = $("feedback");
    fb.textContent = ok ? "○ 正解！" : "× 不正解";
    fb.className = `feedback ${ok ? "ok" : "ng"}`;

    if (quiz.mode !== "audio") speak(q.zh);

    const next = $("nextBtn");
    next.textContent = quiz.index + 1 < quiz.questions.length ? "次へ" : "結果を見る";
    next.classList.remove("hidden");
    next.focus();
  };

  const nextQuestion = () => {
    quiz.index += 1;
    if (quiz.index < quiz.questions.length) renderQuestion();
    else showResult();
  };

  // ---------- 結果 ----------
  const renderWordItem = (w) => {
    const li = el("li");
    li.append(el("span", "zh", w.zh), el("span", "py", w.py), el("span", null, w.ja));
    return li;
  };

  const showResult = () => {
    const total = quiz.questions.length;
    const pct = Math.round((quiz.correct / total) * 100);
    $("resultScore").textContent = `${quiz.correct} / ${total}（${pct}%）`;
    const ul = $("missedList");
    ul.innerHTML = "";
    if (quiz.missed.length === 0) ul.appendChild(el("li", null, "全問正解です！🎉"));
    quiz.missed.forEach((w) => ul.appendChild(renderWordItem(w)));
    $("retryMissedBtn").disabled = quiz.missed.length === 0;
    show("result");
  };

  // ---------- 単語一覧 ----------
  let listLevel = Object.keys(LEVELS)[0];
  let listCat = CATS[0];
  const renderList = () => {
    const tabs = $("listTabs");
    tabs.innerHTML = "";
    for (const level of Object.keys(LEVELS)) {
      const b = el("button", level === listLevel ? "active" : "", LEVELS[level].label);
      b.addEventListener("click", () => { listLevel = level; renderList(); });
      tabs.appendChild(b);
    }
    tabs.appendChild(el("span", "tab-sep"));
    for (const cat of CATS) {
      const b = el("button", cat === listCat ? "active" : "", CATEGORY_LABELS[cat]);
      b.addEventListener("click", () => { listCat = cat; renderList(); });
      tabs.appendChild(b);
    }
    const body = $("listBody");
    body.innerHTML = "";
    for (const w of wordsOf(listLevel, listCat)) {
      const s = statOf(w);
      const tr = el("tr");
      const play = el("button", "play", "🔊");
      play.title = "音声を再生";
      play.addEventListener("click", () => speak(w.zh));
      const tdPlay = el("td");
      tdPlay.appendChild(play);
      tr.append(
        el("td", "zh", w.zh),
        el("td", null, w.py),
        el("td", null, w.ja),
        el("td", "num", String(s.c)),
        el("td", "num", String(s.a)),
        tdPlay
      );
      body.appendChild(tr);
    }
  };

  // ---------- イベント ----------
  $("startBtn").addEventListener("click", startFromMenu);
  // HSK級の選択肢を生成
  Object.entries(LEVELS).forEach(([lv, { label }], i) => {
    const wrap = el("label", "option");
    const input = el("input");
    input.type = "radio";
    input.name = "level";
    input.value = lv;
    input.checked = i === 0;
    input.addEventListener("change", renderMenu);
    const span = el("span", null, label);
    span.appendChild(el("small", null, `${wordsOf(lv, "all").length}語`));
    wrap.append(input, span);
    $("levelList").appendChild(wrap);
  });
  $("homeBtn").addEventListener("click", () => show("menu"));
  $("speakBtn").addEventListener("click", () => speak(quiz.questions[quiz.index].zh));
  $("nextBtn").addEventListener("click", nextQuestion);
  $("retryBtn").addEventListener("click", () => startQuiz(shuffle(quiz.questions), quiz.mode, quiz.cat));
  $("retryMissedBtn").addEventListener("click", () => startQuiz(shuffle(quiz.missed), quiz.mode, quiz.cat));
  $("listBtn").addEventListener("click", () => { renderList(); show("list"); });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("すべての正解回数をリセットしますか？")) return;
    stats = {};
    saveStats();
    renderList();
  });
  // キーボード操作: 1〜4で選択、Enterで次へ
  document.addEventListener("keydown", (e) => {
    if ($("quiz").classList.contains("hidden")) return;
    if (!quiz.answered && /^[1-4]$/.test(e.key)) {
      $("choices").querySelectorAll(".choice")[Number(e.key) - 1]?.click();
    } else if (quiz.answered && e.key === "Enter" && document.activeElement !== $("nextBtn")) {
      nextQuestion();
    }
  });

  show("menu");
})();
