/* Margin —— 背单词 */
(function () {
  'use strict';

  // ================= 词库定义 =================

  // bit 对应 tools/build_words.py 里 TAGS 的顺序
  const EXAM_BOOKS = [
    { id: 'toefl', name: '托福 TOEFL', bit: 6 },
    { id: 'ielts', name: '雅思 IELTS', bit: 5 },
    { id: 'gre', name: 'GRE', bit: 7 },
  ];

  // subject 对应 data/finance/*.tsv
  const FINANCE_BOOKS = [
    { id: 'fin', name: 'Finance · 全部', subject: '' },
    { id: 'fin-econ', name: 'Finance · 经济学', subject: 'econ' },
    { id: 'fin-fin', name: 'Finance · 金融学', subject: 'fin' },
    { id: 'fin-mgmt', name: 'Finance · 管理学', subject: 'mgmt' },
    { id: 'fin-acct', name: 'Finance · 会计学', subject: 'acct' },
  ];

  const BASIC_MASK = (1 << 0) | (1 << 1); // 中考、高考

  const WRONG_BOOK = '__wrong';

  const MODES = {
    en2zh: { name: '英 → 中', desc: '看英文，写中文意思', key: '1' },
    zh2en: { name: '中 → 英', desc: '看中文，拼写英文', key: '2' },
    listen: { name: '听 → 写', desc: '听发音，拼写英文', key: '3' },
  };

  const CJK_RE = /[㐀-鿿豈-﫿]/;

  // ================= 内置数据 =================

  const EXAM_WORDS = []; // { w, p, m, mask }
  const FINANCE_WORDS = []; // { w, p, m, s, t }
  const LOOKUP = new Map(); // 小写单词 -> 词条，导入时自动补释义用

  (function loadBuiltin() {
    const exam = window.MARGIN_DICT || '';
    if (exam) {
      for (const line of exam.split('\n')) {
        const [w, p, m, mask] = line.split('\t');
        const e = { w, p, m, mask: +mask };
        EXAM_WORDS.push(e);
        if (!LOOKUP.has(w.toLowerCase())) LOOKUP.set(w.toLowerCase(), e);
      }
    }
    const fin = window.MARGIN_FINANCE || '';
    if (fin) {
      for (const line of fin.split('\n')) {
        const [w, p, m, s, t] = line.split('\t');
        const e = { w, p, m, s, t };
        FINANCE_WORDS.push(e);
        if (!LOOKUP.has(w.toLowerCase())) LOOKUP.set(w.toLowerCase(), e);
      }
    }
  })();

  const bookCache = {};

  // ================= 存储 =================

  const STORE_KEY = 'margin.v1';
  const FIRST_BOOK = FINANCE_WORDS.length ? 'fin' : EXAM_WORDS.length ? 'toefl' : WRONG_BOOK;
  const DEFAULT_SETTINGS = {
    mode: 'en2zh',
    book: FIRST_BOOK,
    size: 20,
    order: 'new',
    accent: 'us',
    voice: 'auto',
    autoSpeak: true,
    letterHint: true,
    senses: 3,
    theme: 'auto',
  };

  function freshState() {
    return { v: 1, settings: Object.assign({}, DEFAULT_SETTINGS), books: {}, stats: {}, wrong: {}, log: {} };
  }

  function normalizeState(saved) {
    const s = freshState();
    if (!saved || typeof saved !== 'object') return s;
    for (const k of ['books', 'stats', 'wrong', 'log']) {
      if (saved[k] && typeof saved[k] === 'object') s[k] = saved[k];
    }
    Object.assign(s.settings, saved.settings || {});
    return s;
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
    } catch (e) {
      return freshState();
    }
  }

  let state = loadState();
  let saveFailed = false;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      saveFailed = false;
    } catch (e) {
      if (!saveFailed) toast('进度没能保存（浏览器存储不可用或已满），请到「设置」里导出备份');
      saveFailed = true;
    }
  }

  // ================= 小工具 =================

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  const keyOf = (w) => String(w).trim().toLowerCase();

  function meaningLines(m) {
    return String(m || '').split(/\s*[|\n]\s*/).filter(Boolean);
  }

  // 「n. 环境, 状况」拆成词性和释义
  function splitPos(line) {
    const mt = line.match(/^((?:[a-z]{1,6}\.\s*(?:&\s*)?)+)\s*(.*)$/i);
    return mt ? [mt[1].trim(), mt[2]] : ['', line];
  }

  // 按逗号、分号、顿号拆成一个个词语（括号里的不拆）
  function splitTerms(text) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
      if ('(（[［【'.includes(ch)) depth++;
      else if (')）]］】'.includes(ch)) depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,，;；、]/.test(ch)) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  const POS_SPLIT_RE = /\s+(?=(?:n|v|vt|vi|adj|adv|a|ad|prep|conj|pron|num|art|int|interj|aux|abbr)\.\s)/i;

  function senseGroups(m) {
    const groups = [];
    for (const ln of meaningLines(m)) {
      // 一行里夹着几个词性，比如「v. 放弃；抛弃 n. 放纵」
      for (const part of ln.split(POS_SPLIT_RE)) {
        const [pos, text] = splitPos(part.trim());
        const terms = splitTerms(text);
        if (terms.length) groups.push({ pos, terms });
      }
    }
    return groups;
  }

  // 挑出最多 max 个词语：每个词性轮流取第一个、第二个……，这样不会只显示一种词性
  function topSenses(m, max) {
    const groups = senseGroups(m);
    const picked = [];
    const seen = new Set();
    for (let round = 0; picked.length < max; round++) {
      let any = false;
      for (let g = 0; g < groups.length && picked.length < max; g++) {
        const t = groups[g].terms[round];
        if (t === undefined) continue;
        any = true;
        if (seen.has(t)) continue;
        seen.add(t);
        picked.push({ g, round, pos: groups[g].pos, t });
      }
      if (!any) break;
    }
    // 显示时同一词性的排在一起
    return picked.sort((a, b) => a.g - b.g || a.round - b.round);
  }

  function shortMeaning(m) {
    const top = topSenses(m, 1)[0];
    return top ? top.t : '';
  }

  // 中文意思竖着排，一行一个词语
  function meaningHtml(m, mask) {
    const list = topSenses(m, state.settings.senses || 3);
    if (!list.length) return '';
    let lastG = -1;
    return (
      '<div class="senses">' +
      list
        .map((x) => {
          const pos = x.g !== lastG ? x.pos : '';
          lastG = x.g;
          return '<span class="pos">' + esc(pos) + '</span><span class="t">' + esc(mask ? maskWord(x.t, mask) : x.t) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  // 中→英 题目里，释义可能直接带着答案（比如「X射线的」），遮住它
  function maskWord(text, w) {
    const k = String(w).trim();
    if (!k) return text;
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return text.replace(re, '＿＿');
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const ICON_OK =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const ICON_BAD =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  const ICON_SPEAK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/></svg>';

  // ================= 词库 =================

  function findExam(id) {
    return EXAM_BOOKS.find((b) => b.id === id);
  }
  function findFinance(id) {
    return FINANCE_BOOKS.find((b) => b.id === id);
  }

  function bookEntries(id) {
    if (id === WRONG_BOOK) return Object.values(state.wrong);
    const ex = findExam(id);
    if (ex) {
      if (!bookCache[id]) {
        // 中考、高考词表里也有的基础词排到最后，「新词优先」时先背更难的词
        const list = EXAM_WORDS.filter((e) => e.mask & (1 << ex.bit));
        const basic = (e) => (e.mask & BASIC_MASK ? 1 : 0);
        bookCache[id] = list.map((e, i) => [e, i]).sort((a, b) => basic(a[0]) - basic(b[0]) || a[1] - b[1]).map((x) => x[0]);
      }
      return bookCache[id];
    }
    const fi = findFinance(id);
    if (fi) return bookCache[id] || (bookCache[id] = fi.subject ? FINANCE_WORDS.filter((e) => e.s === fi.subject) : FINANCE_WORDS);
    const c = state.books[id];
    return c ? c.words : [];
  }

  function bookName(id) {
    if (id === WRONG_BOOK) return '错题本';
    const b = findExam(id) || findFinance(id);
    if (b) return b.name;
    return state.books[id] ? state.books[id].name : '';
  }

  function bookExists(id) {
    if (id === WRONG_BOOK) return true;
    if (findExam(id)) return EXAM_WORDS.length > 0;
    if (findFinance(id)) return FINANCE_WORDS.length > 0;
    return !!state.books[id];
  }

  function isBuiltin(id) {
    return !!(findExam(id) || findFinance(id));
  }

  function usable(entries, mode) {
    return entries.filter((e) => e.w && (mode === 'listen' || e.m));
  }

  // ================= 统计 =================

  function stat(w, mode) {
    const s = state.stats[keyOf(w)];
    return s && s[mode];
  }

  function seenCount(entries, mode) {
    let n = 0;
    for (const e of entries) {
      const s = state.stats[keyOf(e.w)];
      if (s && (mode ? s[mode] : true)) n++;
    }
    return n;
  }

  function accuracy(e, mode) {
    const s = stat(e.w, mode);
    if (!s) return 1;
    return s[0] / Math.max(1, s[0] + s[1]);
  }

  // sign = +1 记一次，-1 撤销一次（改判时用）
  function bump(entry, mode, ok, sign) {
    const k = keyOf(entry.w);
    const s = state.stats[k] || (state.stats[k] = {});
    const m = s[mode] || (s[mode] = [0, 0, 0]);
    const i = ok ? 0 : 1;
    m[i] = Math.max(0, m[i] + sign);
    m[2] = Math.floor(Date.now() / 1000);
    const day = state.log[todayKey()] || (state.log[todayKey()] = { n: 0, r: 0 });
    day.n = Math.max(0, day.n + sign);
    if (ok) day.r = Math.max(0, day.r + sign);
  }

  // 错题本：答错就进；连续答对 2 次自动移出
  function markWrong(entry) {
    const k = keyOf(entry.w);
    const was = state.wrong[k];
    state.wrong[k] = { w: entry.w, p: entry.p || '', m: entry.m || '', n: (was ? was.n : 0) + 1, s: 0, t: was ? was.t : Date.now() };
  }

  function markRight(entry) {
    const k = keyOf(entry.w);
    const wr = state.wrong[k];
    if (!wr) return;
    wr.s = (wr.s || 0) + 1;
    if (wr.s >= 2) delete state.wrong[k];
  }

  function snapshotWrong(entry) {
    const wr = state.wrong[keyOf(entry.w)];
    return wr ? Object.assign({}, wr) : null;
  }

  function restoreWrong(entry, snap) {
    const k = keyOf(entry.w);
    if (snap) state.wrong[k] = Object.assign({}, snap);
    else delete state.wrong[k];
  }

  // ================= 判分 =================

  function zhTerms(text) {
    return String(text || '')
      .replace(/[（(［\[【〔<《][^）)］\]】〕>》]*[）)］\]】〕>》]/g, ' ')
      .replace(/(^|[^a-z])(?:[a-z]{1,6}\.)+/gi, '$1 ')
      .split(/[\s,，;；、\/|。.!！?？:：'"“”‘’…·\-—–~～=]+/)
      .map((t) => t.replace(/[^㐀-鿿豈-﫿A-Za-z0-9]/g, '').toLowerCase())
      .map((t) => (t.length > 1 ? t.replace(/[的地得]$/, '') : t))
      .filter(Boolean);
  }

  function commonLen(a, b) {
    let best = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) best = prev[j];
        diag = tmp;
      }
    }
    return best;
  }

  // 宽松判中文：意思里任何一项和你写的有足够重合就算对
  function zhMatch(answer, meaning) {
    const us = zhTerms(answer);
    const rs = zhTerms(meaning);
    for (const u of us) {
      for (const r of rs) {
        if (u === r) return true;
        if (u.length >= 2 && r.includes(u)) return true;
        if (u.includes(r)) return true;
        if (u.length >= 2 && r.length >= 2 && commonLen(u, r) >= 2) return true;
      }
    }
    return false;
  }

  // 拼写：忽略大小写、空格、连字符和撇号
  function normEn(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function enMatch(answer, word) {
    const a = normEn(answer);
    return !!a && String(word).split('/').some((w) => normEn(w) === a);
  }

  function judge(mode, entry, answer) {
    if (!answer.trim()) return false;
    return mode === 'en2zh' ? zhMatch(answer, entry.m) : enMatch(answer, entry.w);
  }

  // ================= 发音 =================

  let speakToken = 0;
  let currentAudio = null;

  function stopSpeech() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function speak(word) {
    if (!word) return;
    const token = ++speakToken;
    stopSpeech();
    const s = state.settings;
    if (s.voice === 'browser' || navigator.onLine === false) {
      tts(word);
      return;
    }
    const a = new Audio('https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + (s.accent === 'uk' ? 1 : 2));
    currentAudio = a;
    let settled = false;
    const fallback = () => {
      if (settled || token !== speakToken) return;
      settled = true;
      a.pause();
      tts(word);
    };
    a.addEventListener('playing', () => {
      settled = true;
    });
    a.addEventListener('error', fallback);
    setTimeout(fallback, 2500);
    a.play().catch(fallback);
  }

  function pickVoice(lang) {
    const voices = window.speechSynthesis.getVoices();
    const norm = (l) => String(l).replace('_', '-').toLowerCase();
    const same = voices.filter((v) => norm(v.lang) === lang.toLowerCase());
    const pool = same.length ? same : voices.filter((v) => norm(v.lang).startsWith('en'));
    const prefer = ['Google', 'Samantha', 'Daniel', 'Aria', 'Jenny', 'Sonia', 'Natural', 'Microsoft'];
    for (const p of prefer) {
      const v = pool.find((x) => x.name.includes(p));
      if (v) return v;
    }
    return pool[0] || null;
  }

  function tts(word) {
    if (!('speechSynthesis' in window)) {
      toast('这个浏览器不支持朗读，建议用 Chrome 或 Edge');
      return;
    }
    const synth = window.speechSynthesis;
    const lang = state.settings.accent === 'uk' ? 'en-GB' : 'en-US';
    const u = new SpeechSynthesisUtterance(word);
    u.lang = lang;
    u.rate = 0.9;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    synth.cancel();
    setTimeout(() => synth.speak(u), 30);
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // ================= 导入解析 =================

  const POS_TAIL_RE = /(?:^|\s)((?:(?:n|v|vt|vi|adj|adv|a|ad|prep|conj|pron|num|art|int|interj|aux|abbr|pl|phr)\.\s*(?:&\s*)?)+)\s*$/i;

  function parseLine(raw) {
    let line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) return null;
    line = line.replace(/^\d+\s*[.、)）:：]\s*/, '');
    let w = '';
    let p = '';
    let m = '';
    if (line.includes('\t')) {
      const parts = line.split('\t').map((s) => s.trim()).filter(Boolean);
      w = parts.shift() || '';
      if (parts.length > 1 && /^[\/\[].*[\/\]]$/.test(parts[0])) p = parts.shift().slice(1, -1);
      m = parts.join('；');
    } else {
      line = line.replace(/"/g, '');
      const i = line.search(CJK_RE);
      let head = i >= 0 ? line.slice(0, i) : line;
      m = i >= 0 ? line.slice(i).trim() : '';
      const pm = head.match(/[\/\[]([^\/\]]+)[\/\]]/);
      if (pm) {
        p = pm[1].trim();
        head = head.replace(pm[0], ' ');
      }
      const pos = head.match(POS_TAIL_RE);
      if (pos) {
        m = (pos[1].trim() + ' ' + m).trim();
        head = head.slice(0, pos.index);
      }
      head = head.replace(/[\s,，;；:：=|\-—–]+$/, '').trim();
      if (i < 0) {
        // 没有中文：可能是「word, english meaning」，也可能只有单词
        const sep = head.match(/\s*[,，;；:：=|\t]\s*|\s+[-—–]\s+/);
        if (sep) {
          m = head.slice(sep.index + sep[0].length).trim();
          head = head.slice(0, sep.index).trim();
        }
      }
      w = head;
    }
    w = w.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]/.test(w) || w.length > 80) return { bad: raw.trim() };
    return { w, p, m };
  }

  function parseImport(text) {
    const words = [];
    const seen = new Map();
    let filled = 0;
    const bad = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const r = parseLine(raw);
      if (!r) continue;
      if (r.bad) {
        bad.push(r.bad);
        continue;
      }
      const hit = LOOKUP.get(r.w.toLowerCase());
      if (hit) {
        if (!r.m) {
          r.m = hit.m;
          filled++;
        }
        if (!r.p) r.p = hit.p || '';
      }
      const k = keyOf(r.w);
      if (seen.has(k)) {
        const old = seen.get(k);
        if (!old.m && r.m) old.m = r.m;
        continue;
      }
      const e = { w: r.w, p: r.p, m: r.m };
      seen.set(k, e);
      words.push(e);
    }
    const missing = words.filter((e) => !e.m);
    return { words, filled, missing, bad };
  }

  function decodeFile(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      // Excel 在中文 Windows 上另存的 CSV 通常是 GBK 编码
      try {
        return new TextDecoder('gbk').decode(buf);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
  }

  // ================= 界面状态 =================

  const app = document.getElementById('app');
  const ui = {
    view: 'home',
    session: null,
    book: { id: null, q: '', limit: 200 },
    draft: null,
  };

  function go(view) {
    if (ui.view === 'practice' && view !== 'practice') stopSpeech();
    ui.view = view;
    render();
    window.scrollTo(0, 0);
  }

  // ================= 背诵流程 =================

  function pickItems(entries, mode, size, order) {
    const pool = usable(entries, mode);
    if (order === 'random') return shuffle(pool.slice()).slice(0, size);
    const fresh = [];
    const seen = [];
    for (const e of pool) (stat(e.w, mode) ? seen : fresh).push(e);
    let picked = fresh.slice(0, size);
    if (picked.length < size) {
      // 新词背完了：补上正确率最低的旧词
      seen.sort((a, b) => accuracy(a, mode) - accuracy(b, mode));
      picked = picked.concat(seen.slice(0, size - picked.length));
    }
    return shuffle(picked);
  }

  function startFromSettings() {
    const s = state.settings;
    if (!bookExists(s.book)) s.book = FIRST_BOOK;
    const entries = bookEntries(s.book);
    const items = s.book === WRONG_BOOK ? shuffle(usable(entries, s.mode)).slice(0, s.size) : pickItems(entries, s.mode, s.size, s.order);
    if (!items.length) {
      if (s.book === WRONG_BOOK) toast('错题本是空的，先去背几个词吧');
      else if (entries.length) toast('这个词表的词都没有中文意思，只能用「听 → 写」');
      else toast('这个词表还没有词');
      return;
    }
    startSession(items, s.mode, s.book);
  }

  function startSession(items, mode, bookId) {
    ui.session = { mode, bookId, items, idx: 0, results: [], pending: null, ended: false };
    go('practice');
    onPromptShown();
  }

  function current() {
    const ss = ui.session;
    return ss && ss.items[ss.idx];
  }

  function onPromptShown() {
    const ss = ui.session;
    const e = current();
    if (!e) return;
    if (ss.mode === 'listen' || (ss.mode === 'en2zh' && state.settings.autoSpeak)) speak(e.w);
  }

  function submitAnswer() {
    const ss = ui.session;
    if (!ss) return;
    if (ss.pending) {
      finishPending();
      return;
    }
    const entry = current();
    const input = document.getElementById('answer');
    const raw = input ? input.value : '';
    const ok = judge(ss.mode, entry, raw);
    const result = { entry, answer: raw.trim(), ok, prevWrong: snapshotWrong(entry), flipped: false };
    bump(entry, ss.mode, ok, 1);
    if (ok) markRight(entry);
    else markWrong(entry);
    save();
    if (ok) {
      ss.results.push(result);
      if (ss.mode === 'zh2en' && state.settings.autoSpeak) speak(entry.w);
      advance();
    } else {
      ss.pending = result;
      render();
      if (ss.mode === 'listen' || (ss.mode === 'zh2en' && state.settings.autoSpeak)) speak(entry.w);
    }
  }

  function finishPending() {
    const ss = ui.session;
    ss.results.push(ss.pending);
    ss.pending = null;
    advance();
  }

  function flipResult(r) {
    const mode = ui.session.mode;
    bump(r.entry, mode, r.ok, -1);
    restoreWrong(r.entry, r.prevWrong);
    r.ok = !r.ok;
    r.flipped = !r.flipped;
    bump(r.entry, mode, r.ok, 1);
    if (r.ok) markRight(r.entry);
    else markWrong(r.entry);
    save();
  }

  function advance() {
    const ss = ui.session;
    ss.idx++;
    if (ss.idx >= ss.items.length) {
      go('result');
      return;
    }
    render();
    onPromptShown();
  }

  function quitSession() {
    const ss = ui.session;
    if (!ss) return go('home');
    if (ss.pending) {
      ss.results.push(ss.pending);
      ss.pending = null;
    }
    if (!ss.results.length) {
      ui.session = null;
      return go('home');
    }
    ss.ended = true;
    go('result');
  }

  // ================= 渲染：框架 =================

  function render() {
    const html = header() + (VIEWS[ui.view] || VIEWS.home)();
    app.innerHTML = html;
    AFTER[ui.view] && AFTER[ui.view]();
  }

  function header() {
    const wrongN = Object.keys(state.wrong).length;
    const nav = [
      ['home', '背诵'],
      ['books', '词库'],
      ['wrong', '错题本' + (wrongN ? '<sup>' + wrongN + '</sup>' : '')],
      ['settings', '设置'],
    ];
    const active = { practice: 'home', result: 'home', book: 'books', import: 'books' }[ui.view] || ui.view;
    return (
      '<header class="top"><button class="brand" data-act="nav" data-view="home">Margin</button><nav class="nav">' +
      nav.map(([v, label]) => '<button data-act="nav" data-view="' + v + '" class="' + (active === v ? 'on' : '') + '">' + label + '</button>').join('') +
      '</nav></header>'
    );
  }

  function bookOptionsHtml(selected, mode) {
    const opt = (id, label) => '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    const info = (id) => {
      const list = bookEntries(id);
      return bookName(id) + ' · ' + fmt(list.length) + ' 词 · 已背 ' + fmt(seenCount(list, mode));
    };
    let html = '';
    if (FINANCE_WORDS.length) html += '<optgroup label="Finance">' + FINANCE_BOOKS.map((b) => opt(b.id, info(b.id))).join('') + '</optgroup>';
    if (EXAM_WORDS.length) html += '<optgroup label="留学考试">' + EXAM_BOOKS.map((b) => opt(b.id, info(b.id))).join('') + '</optgroup>';
    const mine = Object.values(state.books).sort((a, b) => a.t - b.t);
    if (mine.length) html += '<optgroup label="我的词表">' + mine.map((b) => opt(b.id, info(b.id))).join('') + '</optgroup>';
    html += '<optgroup label="复习">' + opt(WRONG_BOOK, '错题本 · ' + Object.keys(state.wrong).length + ' 词') + '</optgroup>';
    return html;
  }

  // ================= 渲染：各页面 =================

  const VIEWS = {};
  const AFTER = {};

  VIEWS.home = function () {
    const s = state.settings;
    if (!bookExists(s.book)) s.book = FIRST_BOOK;
    const day = state.log[todayKey()] || { n: 0, r: 0 };
    const total = Object.keys(state.stats).length;
    const d = new Date();
    const week = '日一二三四五六'[d.getDay()];
    const modes = Object.keys(MODES)
      .map((k) => {
        const m = MODES[k];
        return (
          '<button class="mode' + (s.mode === k ? ' on' : '') + '" data-act="setMode" data-mode="' + k + '"><span class="key">' + m.key + '</span>' +
          '<div class="name">' + m.name + '</div><div class="desc">' + m.desc + '</div></button>'
        );
      })
      .join('');
    const sizes = [10, 20, 50, 100].map((n) => '<button class="chip' + (s.size === n ? ' on' : '') + '" data-act="setSize" data-size="' + n + '">' + n + '</button>').join('');
    const orders = [
      ['new', '新词优先'],
      ['random', '随机'],
    ]
      .map(([k, label]) => '<button class="chip' + (s.order === k ? ' on' : '') + '" data-act="setOrder" data-order="' + k + '"' + (s.book === WRONG_BOOK ? ' disabled' : '') + '>' + label + '</button>')
      .join('');
    return (
      '<main class="page">' +
      '<p class="label">' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week + '</p>' +
      '<div class="today">' +
      '<div><div class="num">' + fmt(day.n) + '</div><div class="cap">今天答题</div></div>' +
      '<div><div class="num">' + (day.n ? Math.round((day.r / day.n) * 100) + '%' : '—') + '</div><div class="cap">今天正确率</div></div>' +
      '<div><div class="num">' + fmt(total) + '</div><div class="cap">累计背过的词</div></div>' +
      '</div>' +
      '<p class="label">题型</p><div class="modes">' + modes + '</div>' +
      '<div class="section"><p class="label">词库</p><label class="select"><select data-act="setBook" aria-label="词库">' + bookOptionsHtml(s.book, s.mode) + '</select></label></div>' +
      '<div class="section grid2">' +
      '<div><p class="label">每轮词数</p><div class="chips">' + sizes + '</div></div>' +
      '<div><p class="label">取词方式</p><div class="chips">' + orders + '</div></div>' +
      '</div>' +
      '<div class="start-row"><button class="btn" data-act="start">开始 <kbd>Enter</kbd></button>' +
      '<span class="muted">按 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 切换题型</span></div>' +
      '</main>'
    );
  };

  function slotsHtml(w) {
    if (!state.settings.letterHint) return '';
    let letters = 0;
    const s = Array.from(w)
      .map((c) => {
        if (/[A-Za-z0-9]/.test(c)) {
          letters++;
          return '_';
        }
        return c === ' ' ? '&nbsp;&nbsp;' : esc(c);
      })
      .join('');
    return '<div class="slots" aria-label="' + letters + ' 个字母">' + s + '<span class="n">' + letters + '</span></div>';
  }

  function historyHtml(ss) {
    return ss.results
      .map((r, i) => {
        const fresh = i === ss.results.length - 1 && ss.animRow !== ss.results.length ? ' fresh' : '';
        const yours = r.ok ? '' : r.answer ? '<span class="yours">' + esc(r.answer) + '</span>' : '<span class="yours none">没答</span>';
        return (
          '<div class="h-row ' + (r.ok ? 'ok' : 'bad') + (r.flipped ? ' flipped' : '') + fresh + '">' +
          '<span class="h-no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<button class="h-mark" data-act="flip" data-i="' + i + '" title="判错了？点这里改判" aria-label="' + (r.ok ? '答对' : '答错') + '，点击改判">' + (r.ok ? ICON_OK : ICON_BAD) + '</button>' +
          '<button class="h-word" data-act="speakWord" data-w="' + esc(r.entry.w) + '" title="朗读">' + esc(r.entry.w) + '</button>' +
          '<span class="h-mean" title="' + esc(meaningLines(r.entry.m).join('\n')) + '">' + yours + esc(shortMeaning(r.entry.m)) + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function promptHtml(ss, e) {
    if (ss.mode === 'en2zh') {
      return (
        '<div class="prompt-word">' + esc(e.w) + '</div>' +
        '<div class="prompt-phon">' + (e.p ? '/' + esc(e.p) + '/' : '') + '<button class="icon-btn" data-act="speakCurrent" title="朗读（Tab）">' + ICON_SPEAK + '</button></div>'
      );
    }
    if (ss.mode === 'zh2en') {
      return '<div class="prompt-mean">' + meaningHtml(e.m, e.w) + '</div>' + slotsHtml(e.w);
    }
    return '<button class="speak-big" data-act="speakCurrent" title="再听一遍（Tab）">' + ICON_SPEAK + '</button>' + slotsHtml(e.w);
  }

  function feedbackHtml(ss, r) {
    const e = r.entry;
    let body;
    if (ss.mode === 'en2zh') {
      body = '<div class="fb-label">参考释义</div><div class="fb-mean">' + meaningHtml(e.m) + '</div>';
    } else {
      body =
        '<div class="fb-label">正确拼写</div><div class="fb-word">' + esc(e.w) + '</div>' +
        (e.p ? '<div class="fb-phon">/' + esc(e.p) + '/</div>' : '') +
        (ss.mode === 'listen' ? '<div class="fb-mean">' + meaningHtml(e.m) + '</div>' : ''); // 中→英 的题目本身就是中文意思，不再重复
    }
    return (
      '<div class="feedback">' + body +
      '<div class="actions"><button class="btn small ghost" data-act="accept">算我对</button><button class="btn small" data-act="next">继续 <kbd>Enter</kbd></button></div>' +
      '</div>'
    );
  }

  VIEWS.practice = function () {
    const ss = ui.session;
    if (!ss) return VIEWS.home();
    const e = current();
    const m = MODES[ss.mode];
    const done = ss.results.length + (ss.pending ? 1 : 0);
    const pct = (done / ss.items.length) * 100;
    const pend = ss.pending;
    const isEn = ss.mode !== 'en2zh';
    const placeholder = ss.mode === 'en2zh' ? '写中文意思' : '拼写英文';
    const anim = ss.animIdx !== ss.idx ? ' anim' : '';
    const history = ss.results.length ? historyHtml(ss) : '<div class="h-empty">答过的词会一行一行留在这里</div>';
    return (
      '<main class="practice">' +
      '<div class="p-top"><span>' + m.name + ' · ' + esc(bookName(ss.bookId)) + '</span>' +
      '<span class="right"><span>' + (ss.idx + 1) + ' / ' + ss.items.length + '</span><button class="link" data-act="quit">结束 Esc</button></span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="history' + (ss.results.length ? '' : ' empty') + '" id="history">' + history + '</div>' +
      '<section class="card"><div class="inner' + anim + '">' + promptHtml(ss, e) +
      '<input id="answer" class="answer' + (isEn ? ' en' : '') + (pend ? ' wrong' : '') + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="' + placeholder + '"' +
      (pend ? ' readonly value="' + esc(pend.answer) + '"' : '') + '>' +
      (pend ? feedbackHtml(ss, pend) : '<div class="hint"><span><kbd>Enter</kbd> 提交</span><span>空着按 <kbd>Enter</kbd> = 不会</span><span><kbd>Tab</kbd> 朗读</span><span>点对错标记可改判</span></div>') +
      '</div></section>' +
      '</main>'
    );
  };

  AFTER.practice = function () {
    const ss = ui.session;
    if (ss) {
      ss.animIdx = ss.idx;
      ss.animRow = ss.results.length;
    }
    const h = document.getElementById('history');
    if (h) h.scrollTop = h.scrollHeight;
    const input = document.getElementById('answer');
    if (input) input.focus();
  };

  VIEWS.result = function () {
    const ss = ui.session;
    if (!ss) return VIEWS.home();
    const total = ss.results.length;
    const right = ss.results.filter((r) => r.ok).length;
    const wrong = ss.results.filter((r) => !r.ok);
    const list = wrong.length
      ? '<div class="section"><p class="label">答错的词 · ' + wrong.length + '</p>' +
        wrong
          .map(
            (r) =>
              '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(r.entry.w) + '">' + esc(r.entry.w) + (r.entry.p ? '<small>/' + esc(r.entry.p) + '/</small>' : '') + '</button>' +
              '<span class="m">' + meaningHtml(r.entry.m) + '</span><span class="side">' + (r.answer ? '你写：' + esc(r.answer) : '没答') + '</span></div>'
          )
          .join('') +
        '</div>'
      : '<div class="section"><p class="muted">全对，漂亮。</p></div>';
    return (
      '<main class="page">' +
      '<p class="label">' + (ss.ended ? '提前结束' : '本轮结束') + ' · ' + MODES[ss.mode].name + ' · ' + esc(bookName(ss.bookId)) + '</p>' +
      '<div class="score">' + right + '<small> / ' + total + '</small></div>' +
      '<p class="muted">正确率 ' + (total ? Math.round((right / total) * 100) : 0) + '%</p>' +
      '<div class="actions" style="margin-top:32px">' +
      (wrong.length ? '<button class="btn" data-act="retryWrong">再练错的 ' + wrong.length + ' 个 <kbd>R</kbd></button>' : '') +
      '<button class="btn ' + (wrong.length ? 'ghost' : '') + '" data-act="nextGroup">下一组 <kbd>Enter</kbd></button>' +
      '<button class="link" data-act="nav" data-view="home">回首页</button>' +
      '</div>' + list +
      '</main>'
    );
  };

  function bookRowHtml(id, extra) {
    const list = bookEntries(id);
    const seen = seenCount(list);
    const pct = list.length ? (seen / list.length) * 100 : 0;
    return (
      '<div class="book-row"><div><div class="name">' + esc(bookName(id)) + '</div>' +
      '<div class="meta"><span>' + fmt(list.length) + ' 词</span><span>已背 ' + fmt(seen) + '</span><span class="prog"><i style="width:' + pct + '%"></i></span></div></div>' +
      '<div class="side">' + (extra || '') + '<button class="link" data-act="viewBook" data-id="' + esc(id) + '">查看</button><button class="btn small ghost" data-act="useBook" data-id="' + esc(id) + '">背这个</button></div></div>'
    );
  }

  VIEWS.books = function () {
    const mine = Object.values(state.books).sort((a, b) => a.t - b.t);
    return (
      '<main class="page">' +
      '<h1 class="h1">词库</h1><p class="sub">Finance 专业词汇、留学考试词汇，以及你自己导入的词表。</p>' +
      (FINANCE_WORDS.length
        ? '<div class="section"><div class="head-row"><p class="label">Finance · 经济 金融 管理 会计</p></div>' + FINANCE_BOOKS.map((b) => bookRowHtml(b.id)).join('') + '</div>'
        : '') +
      (EXAM_WORDS.length ? '<div class="section"><div class="head-row"><p class="label">留学考试</p></div>' + EXAM_BOOKS.map((b) => bookRowHtml(b.id)).join('') + '</div>' : '') +
      '<div class="section"><div class="head-row"><p class="label">我的词表</p><button class="btn small" data-act="newImport">＋ 导入新词表</button></div>' +
      (mine.length
        ? mine.map((b) => bookRowHtml(b.id, '<button class="link" data-act="deleteBook" data-id="' + esc(b.id) + '">删除</button>')).join('')
        : '<div class="empty">还没有自己的词表。点「导入新词表」，把单词粘贴进来就行。</div>') +
      '</div>' +
      '</main>'
    );
  };

  function bookRowsHtml() {
    const id = ui.book.id;
    const all = bookEntries(id);
    const q = ui.book.q.trim().toLowerCase();
    const list = q ? all.filter((e) => e.w.toLowerCase().includes(q) || String(e.m).includes(q)) : all;
    const custom = !isBuiltin(id) && id !== WRONG_BOOK;
    const shown = list.slice(0, ui.book.limit);
    if (!list.length) return '<div class="empty">' + (q ? '没有找到「' + esc(q) + '」' : '这个词表还没有词') + '</div>';
    return (
      shown
        .map((e) => {
          const s = state.stats[keyOf(e.w)];
          const tag = e.t ? '<span>' + esc(e.t) + '</span>' : '';
          return (
            '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(e.w) + '">' + esc(e.w) + (e.p ? '<small>/' + esc(e.p) + '/</small>' : '') + '</button>' +
            '<span class="m">' + (meaningHtml(e.m) || '（没有释义）') + '</span>' +
            '<span class="side">' + tag + (s ? '<span>已背</span>' : '') + (custom ? '<button class="link" data-act="deleteWord" data-w="' + esc(e.w) + '">删除</button>' : '') + '</span></div>'
          );
        })
        .join('') +
      (list.length > shown.length ? '<div class="actions" style="margin-top:20px"><button class="btn small ghost" data-act="moreRows">再显示 200 个（还有 ' + fmt(list.length - shown.length) + ' 个）</button></div>' : '')
    );
  }

  VIEWS.book = function () {
    const id = ui.book.id;
    if (!bookExists(id)) return VIEWS.books();
    const custom = !isBuiltin(id);
    return (
      '<main class="page">' +
      '<p class="label"><button class="link" data-act="nav" data-view="books">← 词库</button></p>' +
      '<h1 class="h1">' + esc(bookName(id)) + '</h1>' +
      '<p class="sub">' + fmt(bookEntries(id).length) + ' 词 · 点单词可以听发音</p>' +
      '<div class="actions"><button class="btn small" data-act="useBook" data-id="' + esc(id) + '">背这个词表</button>' +
      (custom ? '<button class="btn small ghost" data-act="appendImport" data-id="' + esc(id) + '">添加单词</button><button class="link" data-act="renameBook" data-id="' + esc(id) + '">改名</button>' : '') +
      '</div>' +
      '<div class="section"><input class="field" id="book-q" placeholder="搜索单词或中文" value="' + esc(ui.book.q) + '" autocomplete="off"></div>' +
      '<div class="section" id="book-rows">' + bookRowsHtml() + '</div>' +
      '</main>'
    );
  };

  function previewHtml() {
    const d = ui.draft;
    if (!d || !d.text.trim()) return '<span class="muted">粘贴后这里会显示识别结果。</span>';
    const r = parseImport(d.text);
    let s = '识别到 <b>' + r.words.length + '</b> 个词';
    if (r.filled) s += '，其中 ' + r.filled + ' 个自动补上了中文意思';
    s += '。';
    if (r.missing.length) {
      s += '<br><span class="muted">' + r.missing.length + ' 个词没有中文意思，也没查到（' + esc(r.missing.slice(0, 5).map((e) => e.w).join('、')) + (r.missing.length > 5 ? ' 等' : '') + '），这些词只能用「听 → 写」练。</span>';
    }
    if (r.bad.length) s += '<br><span class="muted">' + r.bad.length + ' 行看不出英文单词，已跳过（' + esc(r.bad.slice(0, 3).join('、')) + '）。</span>';
    return s;
  }

  VIEWS.import = function () {
    const d = ui.draft;
    const target = d.target && state.books[d.target];
    return (
      '<main class="page">' +
      '<p class="label"><button class="link" data-act="nav" data-view="books">← 词库</button></p>' +
      '<h1 class="h1">' + (target ? '添加到「' + esc(target.name) + '」' : '导入新词表') + '</h1>' +
      '<p class="sub">把单词粘贴到下面，一行一个。只写英文也行，常见词会自动补上中文意思。</p>' +
      (target ? '' : '<div class="section" style="margin-top:0"><p class="label">词表名称</p><input class="field" id="draft-name" value="' + esc(d.name) + '" autocomplete="off"></div>') +
      '<div class="section grid2" style="grid-template-columns: 1.6fr 1fr">' +
      '<div><p class="label">单词</p><textarea class="paste" id="draft-text" placeholder="abandon 放弃&#10;benefit n. 好处；利益&#10;candidate&#10;moral hazard 道德风险">' + esc(d.text) + '</textarea>' +
      '<div class="preview" id="draft-preview">' + previewHtml() + '</div></div>' +
      '<div><p class="label">支持的格式</p><div class="formats">' +
      '<b>abandon 放弃</b><br><b>abandon	v. 放弃</b><br>从 Excel 复制两列也行<br><br>' +
      '<b>abandon /əˈbændən/ v. 放弃</b><br>带音标、词性<br><br>' +
      '<b>abandon</b><br>只写单词，自动查意思<br><br>' +
      '<b>moral hazard 道德风险</b><br>词组也可以' +
      '</div>' +
      '<p style="margin-top:20px"><label class="file-pick link">或者选一个 .txt / .csv 文件<input type="file" id="draft-file" accept=".txt,.csv,.tsv,text/plain,text/csv"></label></p>' +
      '</div></div>' +
      '<div class="actions" style="margin-top:40px"><button class="btn" data-act="saveImport">保存</button><button class="link" data-act="nav" data-view="books">取消</button></div>' +
      '</main>'
    );
  };

  AFTER.import = function () {
    const t = document.getElementById('draft-text');
    if (t && !ui.draft.text) t.focus();
  };

  VIEWS.wrong = function () {
    const list = Object.values(state.wrong).sort((a, b) => b.n - a.n || b.t - a.t);
    return (
      '<main class="page">' +
      '<h1 class="h1">错题本</h1><p class="sub">答错的词会自动记在这里；之后连续答对 2 次就自动移出。</p>' +
      (list.length
        ? '<div class="actions"><button class="btn" data-act="practiceWrong">练习错题本 · ' + list.length + ' 词</button><button class="link" data-act="clearWrong">清空错题本</button></div>' +
          '<div class="section">' +
          list
            .map(
              (e) =>
                '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(e.w) + '">' + esc(e.w) + (e.p ? '<small>/' + esc(e.p) + '/</small>' : '') + '</button>' +
                '<span class="m">' + meaningHtml(e.m) + '</span>' +
                '<span class="side"><span>错 ' + e.n + ' 次</span><button class="link" data-act="removeWrong" data-w="' + esc(e.w) + '">移出</button></span></div>'
            )
            .join('') +
          '</div>'
        : '<div class="empty">错题本是空的。</div>') +
      '</main>'
    );
  };

  function chipsHtml(key, options) {
    const cur = state.settings[key];
    return (
      '<div class="chips">' +
      options.map(([val, label]) => '<button class="chip' + (cur === val ? ' on' : '') + '" data-act="setting" data-key="' + key + '" data-val="' + esc(JSON.stringify(val)) + '">' + label + '</button>').join('') +
      '</div>'
    );
  }

  VIEWS.settings = function () {
    return (
      '<main class="page">' +
      '<h1 class="h1">设置</h1><p class="sub">改动会自动保存。</p>' +
      '<div class="section">' +
      '<div class="set-row"><div><div class="t">发音口音</div></div><div>' + chipsHtml('accent', [['us', '美式'], ['uk', '英式']]) + '</div></div>' +
      '<div class="set-row"><div><div class="t">发音来源</div></div><div>' +
      chipsHtml('voice', [['auto', '真人发音'], ['browser', '电脑语音']]) +
      '<div class="d">真人发音来自有道词典，需要联网；连不上时会自动改用电脑自带的语音。电脑语音不用联网，但效果取决于你的系统。</div>' +
      '<div class="actions" style="margin-top:12px"><button class="btn small ghost" data-act="testVoice">试听</button></div></div></div>' +
      '<div class="set-row"><div><div class="t">自动朗读</div></div><div>' + chipsHtml('autoSpeak', [[true, '开'], [false, '关']]) +
      '<div class="d">「英 → 中」出题时读单词，「中 → 英」答完后读单词。「听 → 写」总会朗读。</div></div></div>' +
      '<div class="set-row"><div><div class="t">中文意思显示几个</div></div><div>' + chipsHtml('senses', [[1, '1 个'], [2, '2 个'], [3, '3 个'], [5, '5 个']]) +
      '<div class="d">中文意思竖着排，一行一个词语，只显示最常用的几个。判分时仍然参考全部意思，写对任何一个都算对。</div></div></div>' +
      '<div class="set-row"><div><div class="t">字母个数提示</div></div><div>' + chipsHtml('letterHint', [[true, '显示'], [false, '不显示']]) +
      '<div class="d">拼写题下面显示 _ _ _ _，提示单词有几个字母。</div></div></div>' +
      '<div class="set-row"><div><div class="t">外观</div></div><div>' + chipsHtml('theme', [['auto', '跟随系统'], ['light', '白底'], ['dark', '黑底']]) + '</div></div>' +
      '<div class="set-row"><div><div class="t">数据备份</div><div class="d">进度只保存在这台电脑的这个浏览器里。</div></div><div>' +
      '<div class="actions"><button class="btn small" data-act="exportData">导出备份</button>' +
      '<label class="btn small ghost file-pick">导入备份<input type="file" id="backup-file" accept=".json,application/json"></label>' +
      '<button class="link" data-act="resetAll">清空所有数据</button></div>' +
      '<div class="d">换电脑、换浏览器或清理浏览器数据之前，先导出备份；到新地方打开 Margin 后再导入。</div></div></div>' +
      '<div class="set-row"><div><div class="t">关于</div></div><div class="d" style="margin-top:0">Margin · 给自己的背单词本。<br>托福、雅思、GRE 词库与音标来自开源词典 ECDICT（MIT 许可证）。</div></div>' +
      '</div>' +
      '</main>'
    );
  };

  // ================= 交互 =================

  const ACTIONS = {
    nav(t) {
      if (ui.view === 'practice') quitSession();
      go(t.dataset.view);
    },
    setMode(t) {
      state.settings.mode = t.dataset.mode;
      save();
      render();
    },
    setSize(t) {
      state.settings.size = +t.dataset.size;
      save();
      render();
    },
    setOrder(t) {
      state.settings.order = t.dataset.order;
      save();
      render();
    },
    start() {
      startFromSettings();
    },
    speakCurrent() {
      const e = current();
      if (e) speak(e.w);
      const input = document.getElementById('answer');
      if (input) input.focus();
    },
    speakWord(t) {
      speak(t.dataset.w);
    },
    flip(t) {
      const r = ui.session.results[+t.dataset.i];
      if (!r) return;
      flipResult(r);
      render();
    },
    accept() {
      const ss = ui.session;
      if (!ss.pending) return;
      flipResult(ss.pending);
      finishPending();
    },
    next() {
      submitAnswer();
    },
    quit() {
      quitSession();
    },
    retryWrong() {
      const ss = ui.session;
      const items = shuffle(ss.results.filter((r) => !r.ok).map((r) => r.entry));
      if (items.length) startSession(items, ss.mode, ss.bookId);
    },
    nextGroup() {
      const ss = ui.session;
      if (ss) {
        state.settings.mode = ss.mode;
        state.settings.book = ss.bookId;
      }
      startFromSettings();
    },
    viewBook(t) {
      ui.book = { id: t.dataset.id, q: '', limit: 200 };
      go('book');
    },
    useBook(t) {
      state.settings.book = t.dataset.id;
      save();
      go('home');
    },
    moreRows() {
      ui.book.limit += 200;
      document.getElementById('book-rows').innerHTML = bookRowsHtml();
    },
    deleteBook(t) {
      const b = state.books[t.dataset.id];
      if (!b || !confirm('删除词表「' + b.name + '」？背诵记录和错题本不受影响。')) return;
      delete state.books[b.id];
      if (state.settings.book === b.id) state.settings.book = FIRST_BOOK;
      save();
      render();
    },
    renameBook(t) {
      const b = state.books[t.dataset.id];
      if (!b) return;
      const name = prompt('新的词表名称', b.name);
      if (name && name.trim()) {
        b.name = name.trim();
        save();
        render();
      }
    },
    deleteWord(t) {
      const b = state.books[ui.book.id];
      if (!b) return;
      const k = keyOf(t.dataset.w);
      b.words = b.words.filter((e) => keyOf(e.w) !== k);
      save();
      render();
    },
    newImport() {
      const n = Object.keys(state.books).length + 1;
      ui.draft = { target: null, name: '我的词表 ' + n, text: '' };
      go('import');
    },
    appendImport(t) {
      ui.draft = { target: t.dataset.id, name: '', text: '' };
      go('import');
    },
    saveImport() {
      const d = ui.draft;
      const r = parseImport(d.text);
      if (!r.words.length) {
        toast('还没有识别到单词');
        return;
      }
      let book = d.target && state.books[d.target];
      let added = r.words.length;
      if (book) {
        const have = new Map(book.words.map((e) => [keyOf(e.w), e]));
        added = 0;
        for (const e of r.words) {
          const old = have.get(keyOf(e.w));
          if (old) {
            if (e.m) old.m = e.m;
            if (e.p) old.p = e.p;
          } else {
            book.words.push(e);
            added++;
          }
        }
      } else {
        const id = 'u' + Date.now().toString(36);
        book = { id, name: (d.name || '').trim() || '我的词表', words: r.words, t: Date.now() };
        state.books[id] = book;
      }
      state.settings.book = book.id;
      save();
      ui.draft = null;
      ui.book = { id: book.id, q: '', limit: 200 };
      go('book');
      toast('已导入 ' + added + ' 个词');
    },
    practiceWrong() {
      state.settings.book = WRONG_BOOK;
      save();
      startFromSettings();
    },
    removeWrong(t) {
      delete state.wrong[keyOf(t.dataset.w)];
      save();
      render();
    },
    clearWrong() {
      if (!confirm('清空错题本？')) return;
      state.wrong = {};
      save();
      render();
    },
    setting(t) {
      state.settings[t.dataset.key] = JSON.parse(t.dataset.val);
      save();
      applyTheme();
      render();
    },
    testVoice() {
      speak('Margin');
    },
    exportData() {
      const blob = new Blob([JSON.stringify({ app: 'Margin', v: 1, exported: new Date().toISOString(), data: state }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'margin-backup-' + todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('备份已下载');
    },
    resetAll() {
      if (!confirm('清空所有数据？自己导入的词表、背诵记录、错题本都会删除，无法恢复。')) return;
      state = freshState();
      save();
      applyTheme();
      render();
      toast('已清空');
    },
  };

  app.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t || t.tagName === 'SELECT') return;
    const fn = ACTIONS[t.dataset.act];
    if (fn) fn(t, ev);
  });

  app.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.act === 'setBook') {
      state.settings.book = t.value;
      save();
      render();
    } else if (t.id === 'draft-file' && t.files[0]) {
      t.files[0].arrayBuffer().then((buf) => {
        const text = decodeFile(buf);
        ui.draft.text = ui.draft.text.trim() ? ui.draft.text.trim() + '\n' + text : text;
        if (!ui.draft.target && /^我的词表 \d+$/.test(ui.draft.name)) ui.draft.name = t.files[0].name.replace(/\.[^.]+$/, '');
        render();
      });
    } else if (t.id === 'backup-file' && t.files[0]) {
      t.files[0].text().then((text) => {
        try {
          const obj = JSON.parse(text);
          if (!obj || obj.app !== 'Margin' || !obj.data) throw new Error('bad');
          if (!confirm('用这个备份覆盖现在的数据？')) return;
          state = normalizeState(obj.data);
          save();
          applyTheme();
          render();
          toast('备份已导入');
        } catch (e) {
          toast('这个文件不是 Margin 的备份');
        }
      });
    }
  });

  let previewTimer = null;
  app.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'draft-text') {
      ui.draft.text = t.value;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const el = document.getElementById('draft-preview');
        if (el) el.innerHTML = previewHtml();
      }, 200);
    } else if (t.id === 'draft-name') {
      ui.draft.name = t.value;
    } else if (t.id === 'book-q') {
      ui.book.q = t.value;
      ui.book.limit = 200;
      document.getElementById('book-rows').innerHTML = bookRowsHtml();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; // 中文输入法正在选字
    const tag = ev.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    if (ui.view === 'practice') {
      if (ev.key === 'Enter' && (ev.target.id === 'answer' || !typing)) {
        ev.preventDefault();
        submitAnswer();
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        ACTIONS.speakCurrent();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        quitSession();
      }
      return;
    }
    if (typing) return;
    if (ui.view === 'home') {
      const mode = Object.keys(MODES).find((k) => MODES[k].key === ev.key);
      if (mode) {
        state.settings.mode = mode;
        save();
        render();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        startFromSettings();
      }
    } else if (ui.view === 'result') {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ACTIONS.nextGroup();
      } else if (ev.key === 'r' || ev.key === 'R') {
        ACTIONS.retryWrong();
      } else if (ev.key === 'Escape') {
        go('home');
      }
    }
  });

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  // 其他标签页改了数据（比如同时开了两个 Margin），这里跟着更新
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORE_KEY && ui.view !== 'practice') {
      state = loadState();
      applyTheme();
      render();
    }
  });

  applyTheme();
  render();
})();
