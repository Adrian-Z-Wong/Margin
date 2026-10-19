/* Margin —— 背单词 */
(function () {
  'use strict';

  // ================= 词库定义 =================

  // bit 对应 tools/build_words.py 里 TAGS 的顺序
  // bits：这个词库包含哪些标签的词。四六级、考研按大纲是累加的：
  // 四级包含高考词汇，六级、考研包含四级词汇，宁多勿少
  const EXAM_BOOKS = [
    { id: 'cet4', name: '四级 CET-4', bits: [2, 1] },
    { id: 'cet6', name: '六级 CET-6', bits: [3, 2, 1] },
    { id: 'ky', name: '考研', bits: [4, 2, 1] },
    { id: 'toefl', name: '托福 TOEFL', bits: [6] },
    { id: 'ielts', name: '雅思 IELTS', bits: [5] },
    { id: 'gre', name: 'GRE', bits: [7] },
    { id: 'gmat', name: 'GMAT', bits: [8] },
  ];

  // Finance：经济、金融、会计、管理、公司治理、财务管理、资本市场等专业词汇，合成一个词库
  const FINANCE_BOOKS = [{ id: 'fin', name: 'Finance' }];

  const BASIC_MASK = (1 << 0) | (1 << 1); // 中考、高考

  const WRONG_BOOK = '__wrong';
  const REVIEW_BOOK = '__review';

  // 间隔复习：第 b 盒的词，隔 INTERVALS[b] 天再复习（简化的 Leitner 盒子法）
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];

  const MODES = {
    en2zh: { name: '英 → 中', desc: '看英文，写中文意思' },
    zh2en: { name: '中 → 英', desc: '看中文，拼写英文' },
    listen: { name: '听 → 写', desc: '听发音，拼写英文' },
  };

  // 每轮的三步：同一组词先英→中，再中→英，最后听→写
  const STAGES = ['en2zh', 'zh2en', 'listen'];

  const CJK_RE = /[㐀-鿿豈-﫿]/;

  // ================= 内置数据 =================

  const EXAM_WORDS = []; // { w, p, m, mask }
  const FINANCE_WORDS = []; // { w, p, m, s, t }
  const LOOKUP = new Map(); // 小写单词 -> 词条，导入时自动补释义用

  (function loadBuiltin() {
    const exam = window.MARGIN_DICT || '';
    if (exam) {
      for (const line of exam.split('\n')) {
        const [w, p, m, mask, x] = line.split('\t');
        const e = { w, p, m, mask: +mask, x: x || '' };
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
    goal: 20, // 每天背多少新词
    size: 10, // 每组几个词
    order: 'new',
    accent: 'us',
    voice: 'auto',
    letterHint: true,
    copyWrong: true,
    senses: 3,
    weight: 'normal',
    theme: 'auto',
  };

  function freshState() {
    return { v: 1, settings: Object.assign({}, DEFAULT_SETTINGS), books: {}, stats: {}, wrong: {}, srs: {}, known: {}, log: {} };
  }

  function normalizeState(saved) {
    const s = freshState();
    if (!saved || typeof saved !== 'object') return s;
    for (const k of ['books', 'stats', 'wrong', 'srs', 'known', 'log']) {
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

  // 本地日期的「第几天」，用来算复习日期
  function dayNum(date) {
    const d = date || new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }

  function dayKeyOf(n) {
    const d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  // 桌面版（Tauri）里没有浏览器下载，改成直接存到「下载」文件夹
  const DESKTOP = !!(window.__TAURI__ && window.__TAURI__.core);

  function downloadText(name, text, type) {
    if (DESKTOP) {
      window.__TAURI__.core
        .invoke('save_to_downloads', { name, contents: text })
        .then(() => toast('已保存到「下载」文件夹：' + name))
        .catch((e) => toast('保存失败：' + e));
      return;
    }
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

  // 中文意思竖着排，一行一个词语，前面编号：1. 2. 3.
  function meaningHtml(m, mask) {
    const list = topSenses(m, state.settings.senses || 3);
    if (!list.length) return '';
    let lastG = -1;
    return (
      '<div class="senses">' +
      list
        .map((x, i) => {
          const pos = x.g !== lastG ? x.pos : '';
          lastG = x.g;
          return '<span class="no">' + (i + 1) + '.</span><span class="pos">' + esc(pos) + '</span><span class="t">' + esc(mask ? maskWord(x.t, mask) : x.t) + '</span>';
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

  // 确认框和输入框：桌面版里系统弹窗不可靠，网页版也统一用这个，风格一致
  function modal(message, opts) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML =
        '<div class="modal-card" role="dialog" aria-modal="true"><p class="modal-msg">' + esc(message) + '</p>' +
        (opts.input ? '<input class="field modal-input" autocomplete="off" value="' + esc(opts.value || '') + '">' : '') +
        '<div class="actions"><button class="btn small" data-m="ok">' + esc(opts.ok || '确定') + '</button><button class="btn small ghost" data-m="cancel">取消</button></div></div>';
      document.body.appendChild(wrap);
      const input = wrap.querySelector('.modal-input');
      const onKey = (ev) => {
        if (ev.isComposing || ev.keyCode === 229) return;
        if (ev.key === 'Enter' || ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          done(ev.key === 'Enter');
        }
      };
      function done(ok) {
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
        resolve(input ? (ok ? input.value : null) : ok);
      }
      document.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-m]');
        if (b) done(b.dataset.m === 'ok');
        else if (ev.target === wrap) done(false);
      });
      if (input) {
        input.focus();
        input.select();
      } else wrap.querySelector('[data-m="ok"]').focus();
    });
  }

  const askConfirm = (message, ok) => modal(message, { ok });
  const askText = (message, value) => modal(message, { input: true, value });

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

  // 今天学了多少个新词（第一次答这个词是在今天）
  function learnedToday() {
    const today = dayNum();
    let n = 0;
    for (const k in state.stats) if (state.stats[k].f === today) n++;
    return n;
  }

  // 今日复习：昨天的新词 + 错题本 + 按记忆曲线今天到期的词。今天复习过的不再出现
  function reviewPool() {
    const today = dayNum();
    const done = (state.log[todayKey()] || {}).rv || [];
    const doneSet = new Set(done);
    const pool = new Map();
    for (const k in state.srs) {
      const st = state.stats[k];
      if ((st && st.f === today - 1) || state.srs[k].d <= today) pool.set(k, state.srs[k]);
    }
    for (const k in state.wrong) pool.set(k, state.wrong[k]);
    const remaining = [];
    for (const [k, e] of pool) if (!state.known[k] && !doneSet.has(k)) remaining.push(e);
    return { done: done.length, remaining };
  }

  function markReviewed(entry) {
    const day = todayLog();
    const k = keyOf(entry.w);
    day.rv = day.rv || [];
    if (!day.rv.includes(k)) day.rv.push(k);
  }

  function todayLog() {
    const k = todayKey();
    return state.log[k] || (state.log[k] = { n: 0, r: 0 });
  }

  function bookEntries(id) {
    if (id === WRONG_BOOK) return Object.values(state.wrong);
    if (id === REVIEW_BOOK) return reviewPool().remaining;
    const ex = findExam(id);
    if (ex) {
      if (!bookCache[id]) {
        // 中考、高考词表里也有的基础词排到最后，「新词优先」时先背更难的词
        const want = ex.bits.reduce((m, b) => m | (1 << b), 0);
        const list = EXAM_WORDS.filter((e) => e.mask & want);
        const basic = (e) => (e.mask & BASIC_MASK ? 1 : 0);
        bookCache[id] = list.map((e, i) => [e, i]).sort((a, b) => basic(a[0]) - basic(b[0]) || a[1] - b[1]).map((x) => x[0]);
      }
      return bookCache[id];
    }
    const fi = findFinance(id);
    if (fi) return FINANCE_WORDS;
    const c = state.books[id];
    return c ? c.words : [];
  }

  function bookName(id) {
    if (id === WRONG_BOOK) return '错题本';
    if (id === REVIEW_BOOK) return '今日复习';
    const b = findExam(id) || findFinance(id);
    if (b) return b.name;
    return state.books[id] ? state.books[id].name : '';
  }

  function bookExists(id) {
    if (id === WRONG_BOOK || id === REVIEW_BOOK) return true;
    if (findExam(id)) return bookEntries(id).length > 0;
    if (findFinance(id)) return FINANCE_WORDS.length > 0;
    return !!state.books[id];
  }

  function studyBook() {
    const s = state.settings;
    if (!bookExists(s.book) || s.book === WRONG_BOOK || s.book === REVIEW_BOOK) s.book = FIRST_BOOK;
    return s.book;
  }

  function isBuiltin(id) {
    return !!(findExam(id) || findFinance(id));
  }

  // 还没标记为已掌握的词
  function available(entries) {
    return entries.filter((e) => e.w && !state.known[keyOf(e.w)]);
  }

  // 某一步能用的词：英→中、中→英 需要有中文意思
  function usable(entries, mode) {
    return available(entries).filter((e) => mode === 'listen' || e.m);
  }

  // ================= 统计 =================

  // 背过（或标记为已掌握）的词数
  function seenCount(entries) {
    let n = 0;
    for (const e of entries) {
      const k = keyOf(e.w);
      if (state.stats[k] || state.known[k]) n++;
    }
    return n;
  }

  // 连续打卡天数：从今天（今天还没背就从昨天）往前数
  function streak() {
    let d = dayNum();
    const has = (n) => (state.log[dayKeyOf(n)] || {}).n > 0;
    if (!has(d)) d--;
    let n = 0;
    while (has(d)) {
      n++;
      d--;
    }
    return n;
  }

  function accuracy(e) {
    const s = state.stats[keyOf(e.w)];
    if (!s) return 1;
    let r = 0;
    let x = 0;
    for (const m of STAGES) {
      if (s[m]) {
        r += s[m][0];
        x += s[m][1];
      }
    }
    return r / Math.max(1, r + x);
  }

  // 记一次答题；f 是第一次背这个词的日子，用来算「今天背了几个新词」和「昨天的新词」
  function bump(entry, mode, ok) {
    const k = keyOf(entry.w);
    const s = state.stats[k] || (state.stats[k] = { f: dayNum() });
    const m = s[mode] || (s[mode] = [0, 0, 0]);
    m[ok ? 0 : 1]++;
    m[2] = Math.floor(Date.now() / 1000);
    const day = todayLog();
    day.n++;
    if (ok) day.r++;
  }

  // 错题本：答错就进；之后某一轮里每一步都答对，就自动移出（见 finishSession）
  function markWrong(entry) {
    const k = keyOf(entry.w);
    const was = state.wrong[k];
    state.wrong[k] = { w: entry.w, p: entry.p || '', m: entry.m || '', x: entry.x || '', n: (was ? was.n : 0) + 1, t: was ? was.t : Date.now() };
  }

  // 间隔复习：答错明天再来；答对升一盒，间隔拉长。没到复习日提前答对不升盒
  function srsUpdate(entry, ok) {
    const k = keyOf(entry.w);
    const today = dayNum();
    const cur = state.srs[k];
    const base = { w: entry.w, p: entry.p || '', m: entry.m || '', x: entry.x || '' };
    if (!ok) state.srs[k] = Object.assign(base, { b: 1, d: today + INTERVALS[1] });
    else if (!cur) state.srs[k] = Object.assign(base, { b: 2, d: today + INTERVALS[2] });
    else if (today >= cur.d) {
      const b = Math.min(cur.b + 1, INTERVALS.length - 1);
      state.srs[k] = Object.assign(base, { b, d: today + INTERVALS[b] });
    }
  }

  function applyOutcome(entry, ok) {
    if (!ok) markWrong(entry);
    srsUpdate(entry, ok);
  }

  function markKnown(entry) {
    const k = keyOf(entry.w);
    state.known[k] = { w: entry.w, p: entry.p || '', m: entry.m || '', t: Date.now() };
    delete state.wrong[k];
    delete state.srs[k];
  }

  // ================= 判分 =================

  function zhTerms(text) {
    // 括号里的英文缩写（比如「资本资产定价模型（CAPM）」里的 CAPM）也算一个可以接受的答案
    const acronyms = [];
    String(text || '').replace(/[（(]\s*([A-Za-z][A-Za-z0-9&.\- ]{0,15})\s*[）)]/g, (_, a) => acronyms.push(a.replace(/[^A-Za-z0-9]/g, '').toLowerCase()));
    return String(text || '')
      .replace(/[（(［\[【〔<《][^）)］\]】〕>》]*[）)］\]】〕>》]/g, ' ')
      .replace(/(^|[^a-z])(?:[a-z]{1,6}\.)+/gi, '$1 ')
      .split(/[\s,，;；、\/|。.!！?？:：'"“”‘’…·\-—–~～=]+/)
      .map((t) => t.replace(/[^㐀-鿿豈-﫿A-Za-z0-9]/g, '').toLowerCase())
      .map((t) => (t.length > 1 ? t.replace(/[的地得]$/, '').replace(/^[的地得之]/, '') : t))
      .concat(acronyms)
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

  // ---- 中文词向量（tools/build_vectors.py 生成）----
  // 两个中文词如果经常翻译同一批英文单词，向量就接近；反义词几乎不会翻译同一个英文单词
  const SIM_T = 0.45;
  let VEC = null;
  const vecCache = new Map();

  function loadVectors() {
    if (VEC !== null) return VEC;
    const raw = window.MARGIN_VEC;
    if (!raw || !raw.data) return (VEC = false);
    const bin = atob(raw.data);
    const data = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = (bin.charCodeAt(i) << 24) >> 24;
    const map = new Map();
    raw.words.split('\t').forEach((w, i) => map.set(w, i));
    return (VEC = { dim: raw.dim, map, data });
  }

  // 词表里有就直接用；没有就按最长匹配拆成几个认识的词，向量相加
  function vecOf(term) {
    if (vecCache.has(term)) return vecCache.get(term);
    const V = loadVectors();
    let out = null;
    if (V) {
      const acc = new Float32Array(V.dim);
      const add = (row) => {
        const o = row * V.dim;
        for (let d = 0; d < V.dim; d++) acc[d] += V.data[o + d];
      };
      let n = 0;
      if (V.map.has(term)) {
        add(V.map.get(term));
        n = 1;
      } else {
        for (let i = 0; i < term.length; ) {
          let step = 1;
          for (let L = Math.min(6, term.length - i); L >= 1; L--) {
            const r = V.map.get(term.substr(i, L));
            if (r !== undefined) {
              add(r);
              n++;
              step = L;
              break;
            }
          }
          i += step;
        }
      }
      let norm = 0;
      for (let d = 0; d < V.dim; d++) norm += acc[d] * acc[d];
      if (n && norm) {
        norm = Math.sqrt(norm);
        for (let d = 0; d < V.dim; d++) acc[d] /= norm;
        out = acc;
      }
    }
    vecCache.set(term, out);
    return out;
  }

  function similarity(a, b) {
    const va = vecOf(a);
    const vb = vecOf(b);
    if (!va || !vb) return null;
    let s = 0;
    for (let d = 0; d < va.length; d++) s += va[d] * vb[d];
    return s;
  }

  const NEG_RE = /^[不无非未没]/;

  // 只差一个字、而这两个字意思相反的词（多头 / 空头、进口 / 出口），一律不算对
  const OPPOSITE = new Set(
    '多空 多少 上下 进出 入出 买卖 大小 长短 高低 增减 加减 升降 涨跌 正负 内外 前后 主被 顺逆 优劣 收支 盈亏 输赢 胜败 胜负 早晚 新旧 强弱 左右 东西 南北 好坏 真假 是非 有无 开关 借贷 存取 升贬 褒贬 攻守 动静 明暗 首末 始终 生死 得失 利弊 难易 快慢 轻重 远近 深浅 宽窄 厚薄 粗细 冷热 干湿 软硬 松紧 美丑 善恶 贫富 贵贱 进退 出入 起落 正反 积消 乐悲 顺差 买方'
      .split(' ')
      .filter((x) => x.length === 2)
      .flatMap((x) => [x, x[1] + x[0]])
  );

  function oppositePair(a, b) {
    if (a.length !== b.length || a === b) return false;
    let diff = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (diff >= 0) return false;
        diff = i;
      }
    }
    return OPPOSITE.has(a[diff] + b[diff]);
  }

  // 判中文：写的和任何一个释义意思相同或相近就算对
  function zhMatch(answer, meaning) {
    const us = zhTerms(answer);
    const rs = zhTerms(meaning);
    for (const u of us) {
      for (const r of rs) {
        if (u === r) return true;
        // 一个带「不、无、非」一个不带，或者只差一个反义字，意思多半相反
        if (NEG_RE.test(u) !== NEG_RE.test(r) || oppositePair(u, r)) continue;
        if (u.length >= 2 && r.includes(u)) return true;
        if (r.length >= 2 && u.includes(r)) return true;
        if (r.length === 1 && u.includes(r) && u.length <= 3) return true;
        // 词向量只比较两个字以上的词；单字和「含…的意思」拆出来的碎片意思太泛
        if (u.length < 2 || r.length < 2) continue;
        const sim = similarity(u, r);
        if (sim !== null ? sim >= SIM_T : commonLen(u, r) >= 2) return true;
      }
    }
    return false;
  }

  // 拼写必须完全一样（连字符、空格、撇号都算），只忽略大小写和首尾空格
  function normEn(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/\s+/g, ' ');
  }

  function enMatch(answer, word) {
    const a = normEn(answer);
    return !!a && String(word).split('/').some((w) => normEn(w) === a);
  }

  function judge(mode, entry, answer) {
    if (!answer.trim()) return false;
    return mode === 'en2zh' ? zhMatch(answer, entry.m) : enMatch(answer, entry.w);
  }

  // 英→中 要写几行：和显示的中文意思个数一样
  function zhLineCount(entry) {
    return Math.max(1, topSenses(entry.m, state.settings.senses || 3).length);
  }

  // 英→中 多行判分：每一行都要写，每一行都要对，而且不能重复，才算对
  function judgeZhLines(lines, entry) {
    // 除了显示出来的几个意思，词典里其他的意思写对了也算
    const full = entry.m + (entry.x ? '|' + entry.x : '');
    const seen = new Set();
    const marks = lines.map((t) => {
      const k = t.trim();
      if (!k) return null;
      const ok = !seen.has(k) && zhMatch(k, full);
      seen.add(k);
      return ok;
    });
    return { ok: marks.every((m) => m === true), marks };
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
      m = parts.join('|');
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

  // Qwerty Learner 词库格式：[{"name":"if","trans":["conj. 如果"]}]
  function jsonToLines(text) {
    const t = String(text || '').trim();
    if (!t.startsWith('[')) return text;
    try {
      const arr = JSON.parse(t);
      if (!Array.isArray(arr)) return text;
      return arr
        .map((o) => {
          if (!o || typeof o !== 'object') return '';
          const w = o.name || o.word || o.w || '';
          let m = o.trans || o.translation || o.m || '';
          if (Array.isArray(m)) m = m.join('|');
          return w ? w + '\t' + String(m).replace(/\t/g, ' ') : '';
        })
        .join('\n');
    } catch (e) {
      return text;
    }
  }

  function parseImport(text) {
    text = jsonToLines(text);
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

  // 背新词：从词库里挑还没背过的词，每组 size 个，直到完成今天的目标（之后可以再背）
  function startNew() {
    const s = state.settings;
    const book = studyBook();
    const left = s.goal - learnedToday();
    const n = left > 0 ? Math.min(s.size, left) : s.size;
    const fresh = available(bookEntries(book)).filter((e) => !state.stats[keyOf(e.w)]);
    if (!fresh.length) {
      toast(bookEntries(book).length ? '这个词库的词都背过了，换一个词库吧' : '这个词表还没有词');
      return;
    }
    const words = s.order === 'random' ? shuffle(fresh.slice()).slice(0, n) : shuffle(fresh.slice(0, n));
    startSession(words, book, 'new');
  }

  function startReview() {
    const { remaining } = reviewPool();
    if (!remaining.length) {
      toast('今天的复习做完了');
      return;
    }
    startSession(shuffle(remaining.slice()).slice(0, state.settings.size), REVIEW_BOOK, 'review');
  }

  function startWrong() {
    const list = available(Object.values(state.wrong));
    if (!list.length) {
      toast('错题本是空的');
      return;
    }
    startSession(shuffle(list.slice()).slice(0, state.settings.size), WRONG_BOOK, 'wrong');
  }

  // 一轮：同一组词依次过三步。kind：new 背新词 / review 今日复习 / wrong 错题本 / retry 再练错的
  function startSession(words, bookId, kind) {
    ui.session = { kind, bookId, words, stage: -1, mode: null, items: [], idx: 0, results: [], stageResults: [], pending: null, between: false, ended: false };
    beginStage(0);
  }

  // 一轮结束：这一轮里每一步都答对的词，从错题本移出
  function finishSession() {
    const ss = ui.session;
    if (ss && !ss.finished) {
      ss.finished = true;
      const allOk = new Map();
      for (const r of allResults(ss)) {
        const k = keyOf(r.entry.w);
        allOk.set(k, allOk.get(k) !== false && r.ok);
      }
      for (const [k, ok] of allOk) if (ok) delete state.wrong[k];
      save();
    }
    go('result');
  }

  function beginStage(n) {
    const ss = ui.session;
    // 跳过没有可用词的步骤（比如导入的词没有中文意思，就只练听写）
    while (n < STAGES.length && !usable(ss.words, STAGES[n]).length) n++;
    if (n >= STAGES.length) {
      finishSession();
      return;
    }
    Object.assign(ss, { stage: n, mode: STAGES[n], items: shuffle(usable(ss.words, STAGES[n]).slice()), idx: 0, results: [], pending: null, between: false, animIdx: -1, animRow: 0 });
    go('practice');
    onPromptShown();
  }

  function nextStageIndex(ss) {
    for (let n = ss.stage + 1; n < STAGES.length; n++) if (usable(ss.words, STAGES[n]).length) return n;
    return -1;
  }

  function endStage() {
    const ss = ui.session;
    ss.stageResults[ss.stage] = ss.results;
    if (nextStageIndex(ss) < 0) {
      finishSession();
      return;
    }
    ss.between = true;
    render();
  }

  function continueStage() {
    const ss = ui.session;
    if (ss && ss.between) beginStage(nextStageIndex(ss));
  }

  function current() {
    const ss = ui.session;
    return ss && ss.items[ss.idx];
  }

  function onPromptShown() {
    const ss = ui.session;
    const e = current();
    if (!e) return;
    if (ss.mode !== 'zh2en') speak(e.w);
  }

  function submitAnswer() {
    const ss = ui.session;
    if (!ss) return;
    if (ss.pending) {
      submitPending();
      return;
    }
    const entry = current();
    let ok;
    let answer;
    let lines = null;
    let marks = null;
    if (ss.mode === 'en2zh') {
      lines = [...document.querySelectorAll('.ans')].map((el) => el.value);
      const j = judgeZhLines(lines, entry);
      ok = j.ok;
      marks = j.marks;
      answer = lines.map((t) => t.trim()).filter(Boolean).join('；');
    } else {
      const input = document.getElementById('answer');
      answer = (input ? input.value : '').trim();
      ok = judge(ss.mode, entry, answer);
    }
    const result = { entry, answer, lines, marks, ok };
    bump(entry, ss.mode, ok);
    applyOutcome(entry, ok);
    if (ss.kind === 'review') markReviewed(entry);
    save();
    if (ok) {
      ss.results.push(result);
      advance();
    } else {
      ss.pending = result;
      render();
      if (ss.mode === 'listen') speak(entry.w);
    }
  }

  // 拼写题答错后，照着正确拼写打一遍
  function needsCopy(ss) {
    return ss.mode !== 'en2zh' && state.settings.copyWrong && ss.pending && !ss.pending.ok;
  }

  function submitPending() {
    const ss = ui.session;
    const input = document.getElementById('answer');
    if (needsCopy(ss) && input) {
      const v = input.value;
      if (v.trim() && !enMatch(v, ss.pending.entry.w)) {
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        input.select();
        return;
      }
    }
    finishPending();
  }

  function skipKnown() {
    const ss = ui.session;
    if (!ss || ss.pending) return;
    const e = current();
    markKnown(e);
    ss.words = ss.words.filter((w) => w !== e);
    save();
    toast('「' + e.w + '」标记为已掌握，以后不再出现');
    advance();
  }

  function finishPending() {
    const ss = ui.session;
    ss.results.push(ss.pending);
    ss.pending = null;
    advance();
  }

  function advance() {
    const ss = ui.session;
    ss.idx++;
    if (ss.idx >= ss.items.length) {
      endStage();
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
    if (ss.stage >= 0) ss.stageResults[ss.stage] = ss.results;
    if (!allResults(ss).length) {
      ui.session = null;
      return go('home');
    }
    ss.ended = true;
    finishSession();
  }

  function allResults(ss) {
    return [].concat(...ss.stageResults.filter(Boolean));
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

  // 内置词库，平铺：Finance、四级、六级……
  function allBooks() {
    return FINANCE_BOOKS.concat(EXAM_BOOKS)
      .map((b) => b.id)
      .filter((id) => bookExists(id));
  }

  function bookOptionsHtml(selected) {
    const opt = (id, label) => '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    const info = (id) => {
      const list = bookEntries(id);
      return bookName(id) + ' · ' + fmt(list.length) + ' 词 · 已背 ' + fmt(seenCount(list));
    };
    let html = '';
    html += allBooks().map((id) => opt(id, info(id))).join('');
    const mine = Object.values(state.books).sort((a, b) => a.t - b.t);
    html += mine.map((b) => opt(b.id, info(b.id))).join('');
    return html;
  }

  // ================= 渲染：各页面 =================

  const VIEWS = {};
  const AFTER = {};

  VIEWS.home = function () {
    const s = state.settings;
    const book = studyBook();
    const day = state.log[todayKey()] || { n: 0, r: 0 };
    const learned = learnedToday();
    const rv = reviewPool();
    const rvTotal = rv.done + rv.remaining.length;
    const left = s.goal - learned;
    const d = new Date();
    const week = '日一二三四五六'[d.getDay()];
    const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 100);
    const orders = chipsHtml('order', [
      ['new', '按词表顺序'],
      ['random', '随机'],
    ]);
    return (
      '<main class="page">' +
      '<p class="label">' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week + '</p>' +

      '<div class="section" style="margin-top:24px"><p class="label">词库</p><label class="select"><select data-act="setBook" aria-label="词库">' + bookOptionsHtml(book) + '</select></label></div>' +
      '<div class="section grid2">' +
      '<div><p class="label">每天背多少新词</p>' + chipsHtml('goal', [10, 20, 30, 50, 100].map((n) => [n, String(n)])) + '</div>' +
      '<div><p class="label">新词顺序</p>' + orders + '</div>' +
      '</div>' +      '<h2 class="h1 section">今日任务</h2>' +
      '<div class="tasks">' +
      '<div class="task"><p class="label">新词</p>' +
      '<div class="num">' + fmt(learned) + '<small> / ' + fmt(s.goal) + '</small></div>' +
      '<div class="bar"><i style="width:' + pct(learned, s.goal) + '%"></i></div>' +
      '<p class="muted">' + (left > 0 ? '还差 ' + left + ' 个 · ' + esc(bookName(book)) : '今天的目标完成了') + '</p>' +
      '<button class="btn" data-act="startNew">' + (left > 0 ? '背新词' : '再背一组') + ' <kbd>Enter</kbd></button></div>' +
      '<div class="task"><p class="label">复习</p>' +
      '<div class="num">' + fmt(rv.done) + '<small> / ' + fmt(rvTotal) + '</small></div>' +
      '<div class="bar"><i style="width:' + pct(rv.done, rvTotal) + '%"></i></div>' +
      '<p class="muted">昨天的新词和错题本</p>' +
      '<button class="btn ghost" data-act="startReview"' + (rv.remaining.length ? '' : ' disabled') + '>' + (rv.remaining.length ? '开始复习 <kbd>R</kbd>' : rvTotal ? '复习完了' : '今天没有要复习的词') + '</button></div>' +
      '</div>' +
      '<div class="today three">' +
      '<div><div class="num">' + fmt(day.n) + '</div><div class="cap">今天答题</div></div>' +
      '<div><div class="num">' + (day.n ? Math.round((day.r / day.n) * 100) + '%' : '—') + '</div><div class="cap">今天正确率</div></div>' +
      '<div><div class="num">' + fmt(streak()) + '</div><div class="cap">连续打卡天数</div></div>' +
      '</div>' +
      heatmapHtml() +
      '</main>'
    );
  };

  // 最近一年的打卡热力图：颜色越深，那天答题越多
  function heatmapHtml() {
    const WEEKS = 52;
    const today = dayNum();
    const dow = new Date().getDay();
    const start = today - dow - (WEEKS - 1) * 7;
    let cells = '';
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const n = start + w * 7 + d;
        if (n > today) {
          cells += '<i class="hm-x"></i>';
          continue;
        }
        const key = dayKeyOf(n);
        const rec = state.log[key] || { n: 0, r: 0 };
        const lv = rec.n === 0 ? 0 : rec.n < 10 ? 1 : rec.n < 30 ? 2 : rec.n < 60 ? 3 : 4;
        const tip = key + ' · ' + (rec.n ? '答题 ' + rec.n + '，正确率 ' + Math.round((rec.r / rec.n) * 100) + '%' : '没有背');
        cells += '<i class="hm-' + lv + '" title="' + tip + '"></i>';
      }
    }
    const total = Object.keys(state.stats).length;
    return (
      '<div class="section heat"><div class="head-row"><p class="label">最近一年</p><span class="muted">累计背过 ' + fmt(total) + ' 词 · 已掌握 ' + fmt(Object.keys(state.known).length) + ' 词</span></div>' +
      '<div class="hm" aria-label="最近一年每天的答题量">' + cells + '</div></div>'
    );
  }

  AFTER.home = function () {
    // 窄屏时热力图默认滚到最近几周
    const hm = document.querySelector('.hm');
    if (hm) hm.scrollLeft = hm.scrollWidth;
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
          '<div class="h-row ' + (r.ok ? 'ok' : 'bad') + fresh + '">' +
          '<span class="h-no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="h-mark" aria-label="' + (r.ok ? '答对' : '答错') + '">' + (r.ok ? ICON_OK : ICON_BAD) + '</span>' +
          // 「中 → 英」这一步不出声，答过的词也不能点读
          (ss.mode === 'zh2en' ? '<span class="h-word">' + esc(r.entry.w) + '</span>' : '<button class="h-word" data-act="speakWord" data-w="' + esc(r.entry.w) + '" title="朗读">' + esc(r.entry.w) + '</button>') +
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
    const copy = needsCopy(ss);
    let body;
    if (ss.mode === 'en2zh') {
      body = '<div class="fb-label">参考释义</div><div class="fb-mean">' + meaningHtml(e.m) + '</div>';
    } else {
      body =
        (copy && r.answer ? '<div class="fb-yours">你写的：<s>' + esc(r.answer) + '</s></div>' : '') +
        '<div class="fb-label">正确拼写</div><div class="fb-word">' + esc(e.w) + '</div>' +
        (e.p ? '<div class="fb-phon">/' + esc(e.p) + '/</div>' : '') +
        (ss.mode === 'listen' ? '<div class="fb-mean">' + meaningHtml(e.m) + '</div>' : ''); // 中→英 的题目本身就是中文意思，不再重复
    }
    return (
      '<div class="feedback">' + body +
      '<div class="actions"><button class="btn small" data-act="next">继续 <kbd>Enter</kbd></button></div>' +
      '</div>'
    );
  }

  // 两步之间的小结
  function betweenHtml(ss) {
    const right = ss.results.filter((r) => r.ok).length;
    const next = MODES[STAGES[nextStageIndex(ss)]];
    return (
      '<div class="stage-done">' +
      '<p class="label">第 ' + (ss.stage + 1) + ' 步完成 · ' + MODES[ss.mode].name + '</p>' +
      '<div class="stage-score">' + right + '<small> / ' + ss.results.length + '</small></div>' +
      '<p class="muted">下一步：' + next.name + ' · ' + next.desc + '</p>' +
      '<div class="actions"><button class="btn" data-act="continueStage">继续 <kbd>Enter</kbd></button></div>' +
      '</div>'
    );
  }

  function stepsHtml(ss) {
    return STAGES.map((k, i) => '<span class="step' + (i === ss.stage ? ' on' : i < ss.stage ? ' done' : '') + '">' + (i + 1) + ' ' + MODES[k].name + '</span>').join('');
  }

  VIEWS.practice = function () {
    const ss = ui.session;
    if (!ss) return VIEWS.home();
    const e = current();
    // 进度条按三步加起来算
    const counts = STAGES.map((k) => usable(ss.words, k).length);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const before = counts.slice(0, ss.stage).reduce((a, b) => a + b, 0);
    const done = before + ss.results.length + (ss.pending ? 1 : 0);
    const pct = Math.min(100, (done / total) * 100);
    const pend = ss.pending;
    const copy = needsCopy(ss);
    const placeholder = copy ? '照着打一遍，或直接按 Enter 继续' : ss.mode === 'en2zh' ? '写中文意思' : '拼写英文';
    const anim = ss.animIdx !== ss.idx ? ' anim' : '';
    let inputs;
    if (ss.between) inputs = '';
    else if (ss.mode === 'en2zh') {
      // 英→中：一行写一个中文意思
      const n = pend && pend.lines ? pend.lines.length : zhLineCount(e);
      inputs = '<div class="zh-lines">';
      for (let i = 0; i < n; i++) {
        const mk = pend && pend.marks ? pend.marks[i] : undefined;
        const cls = mk === true ? ' ok' : mk === false ? ' bad' : '';
        inputs +=
          '<div class="zl' + cls + '"><span class="zl-mark">' + (mk === true ? ICON_OK : mk === false ? ICON_BAD : '') + '</span><span class="zl-no">' + (i + 1) + '.</span>' +
          '<input class="answer ans" ' + (i === 0 ? 'id="answer" ' : '') + 'data-line="' + i + '" autocomplete="off" spellcheck="false"' +
          (pend ? ' readonly value="' + esc(pend.lines[i] || '') + '"' : '') + '></div>';
      }
      inputs += '</div>';
    } else {
      inputs =
        '<input id="answer" class="answer en' + (pend && !copy ? ' wrong' : '') + (copy ? ' copy' : '') + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="' + placeholder + '"' +
        (pend && !copy ? ' readonly value="' + esc(pend.answer) + '"' : '') + '>';
    }
    const hint =
      ss.mode === 'en2zh'
        ? '<div class="hint"><span>一行写一个意思，<kbd>Enter</kbd> 换行</span><span>写完最后一行按 <kbd>Enter</kbd> 提交</span><span><kbd>Tab</kbd> 再听一遍</span><button class="link" data-act="skipKnown" title="以后不再出这个词">已掌握，跳过</button></div>'
        : '<div class="hint"><span><kbd>Enter</kbd> 提交</span><span>空着按 <kbd>Enter</kbd> = 不会</span>' + (ss.mode === 'listen' ? '<span><kbd>Tab</kbd> 再听一遍</span>' : '') + '<button class="link" data-act="skipKnown" title="以后不再出这个词">已掌握，跳过</button></div>';
    const history = ss.results.length ? historyHtml(ss) : '<div class="h-empty">答过的词会一行一行留在这里</div>';
    return (
      '<main class="practice">' +
      '<div class="p-top"><span class="steps">' + stepsHtml(ss) + '<span class="book">' + esc(bookName(ss.bookId)) + '</span></span>' +
      '<span class="right"><span>' + (ss.between ? ss.items.length : ss.idx + 1) + ' / ' + ss.items.length + '</span><button class="link" data-act="quit">结束 Esc</button></span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="history' + (ss.results.length ? '' : ' empty') + '" id="history">' + history + '</div>' +
      (ss.between ? '<section class="card"><div class="inner anim">' + betweenHtml(ss) + '</div></section></main>' : '') +
      (ss.between ? '' : '<section class="card"><div class="inner' + anim + '">' + promptHtml(ss, e) +
      inputs +
      (pend ? feedbackHtml(ss, pend) : hint) +
      '</div></section>' +
      '</main>')
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

  // 这一轮里任何一步答错过的词，以及它在三步里各自的对错
  function wrongWords(ss) {
    const map = new Map();
    ss.stageResults.forEach((res, i) => {
      (res || []).forEach((r) => {
        const k = keyOf(r.entry.w);
        if (!map.has(k)) map.set(k, { entry: r.entry, marks: [], bad: false });
        const x = map.get(k);
        x.marks[i] = r.ok;
        if (!r.ok) x.bad = true;
      });
    });
    return [...map.values()].filter((x) => x.bad);
  }

  // 结果页上「下一组」按钮的文字；没有下一组时返回空
  function nextLabel(ss) {
    if (ss.kind === 'new' || ss.kind === 'retry') {
      const left = state.settings.goal - learnedToday();
      return left > 0 ? '下一组新词 · 今天还差 ' + left + ' 个' : '再背一组新词';
    }
    if (ss.kind === 'review') {
      const n = reviewPool().remaining.length;
      return n ? '继续复习 · 还剩 ' + n + ' 个' : '';
    }
    const n = available(Object.values(state.wrong)).length;
    return n ? '继续练错题本 · 还有 ' + n + ' 个' : '';
  }

  VIEWS.result = function () {
    const ss = ui.session;
    if (!ss) return VIEWS.home();
    const all = allResults(ss);
    const total = all.length;
    const right = all.filter((r) => r.ok).length;
    const wrong = wrongWords(ss);
    const stageLine = STAGES.map((k, i) => {
      const res = ss.stageResults[i];
      return '<div><div class="num">' + (res && res.length ? res.filter((r) => r.ok).length + '<small> / ' + res.length + '</small>' : '—') + '</div><div class="cap">' + (i + 1) + ' · ' + MODES[k].name + '</div></div>';
    }).join('');
    const mark = (v, i) => '<span class="mk" title="' + MODES[STAGES[i]].name + '">' + (v === true ? ICON_OK : v === false ? ICON_BAD : '·') + '</span>';
    const list = wrong.length
      ? '<div class="section"><div class="head-row"><p class="label">答错过的词 · ' + wrong.length + '</p><span class="muted">右边三个标记依次是 英→中、中→英、听→写</span></div>' +
        wrong
          .map(
            (x) =>
              '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(x.entry.w) + '">' + esc(x.entry.w) + (x.entry.p ? '<small>/' + esc(x.entry.p) + '/</small>' : '') + '</button>' +
              '<span class="m">' + meaningHtml(x.entry.m) + '</span><span class="side marks">' + [0, 1, 2].map((i) => mark(x.marks[i], i)).join('') + '</span></div>'
          )
          .join('') +
        '</div>'
      : '<div class="section"><p class="muted">全对，漂亮。</p></div>';
    return (
      '<main class="page">' +
      '<p class="label">' + (ss.ended ? '提前结束' : '本轮结束') + ' · ' + esc(bookName(ss.bookId)) + '</p>' +
      '<div class="score">' + right + '<small> / ' + total + '</small></div>' +
      '<p class="muted">正确率 ' + (total ? Math.round((right / total) * 100) : 0) + '%</p>' +
      '<div class="today stage-line">' + stageLine + '</div>' +
      '<div class="actions" style="margin-top:32px">' +
      (wrong.length ? '<button class="btn" data-act="retryWrong">再练错的 ' + wrong.length + ' 个 <kbd>R</kbd></button>' : '') +
      (nextLabel(ss) ? '<button class="btn ' + (wrong.length ? 'ghost' : '') + '" data-act="nextGroup">' + nextLabel(ss) + ' <kbd>Enter</kbd></button>' : '') +
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
      '<div class="head-row"><h1 class="h1">词库</h1><button class="btn small" data-act="newImport">＋ 导入词表</button></div>' +
      '<div class="section">' +
      allBooks().map((id) => bookRowHtml(id)).join('') +
      mine.map((b) => bookRowHtml(b.id, '<button class="link" data-act="deleteBook" data-id="' + esc(b.id) + '">删除</button>')).join('') +
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
          const k = keyOf(e.w);
          const s = state.stats[k];
          const tag = e.t ? '<span>' + esc(e.t) + '</span>' : '';
          const known = state.known[k] ? '<span>已掌握</span>' : '';
          return (
            '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(e.w) + '">' + esc(e.w) + (e.p ? '<small>/' + esc(e.p) + '/</small>' : '') + '</button>' +
            '<span class="m">' + (meaningHtml(e.m) || '（没有释义）') + '</span>' +
            '<span class="side">' + tag + (known || (s ? '<span>已背</span>' : '')) + (custom ? '<button class="link" data-act="deleteWord" data-w="' + esc(e.w) + '">删除</button>' : '') + '</span></div>'
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
      '<button class="link" data-act="exportBook" data-id="' + esc(id) + '">导出为表格</button>' +
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
    const known = Object.values(state.known).sort((a, b) => b.t - a.t);
    const knownHtml =
      '<div class="section"><div class="head-row"><p class="label">已掌握 · ' + known.length + ' 词</p></div>' +
      (known.length
        ? known
            .map(
              (e) =>
                '<div class="list-row"><button class="w" data-act="speakWord" data-w="' + esc(e.w) + '">' + esc(e.w) + '</button>' +
                '<span class="m">' + meaningHtml(e.m) + '</span>' +
                '<span class="side"><button class="link" data-act="unknow" data-w="' + esc(e.w) + '">恢复</button></span></div>'
            )
            .join('')
        : '<div class="empty">背诵时点「已掌握，跳过」，这个词以后就不会再出现，会列在这里。</div>') +
      '</div>';
    return (
      '<main class="page">' +
      '<h1 class="h1">错题本</h1><p class="sub">答错的词会记在这里，每天的复习里都会有；一轮里每一步都答对，就自动移出。</p>' +
      (list.length
        ? '<div class="actions"><button class="btn" data-act="practiceWrong">练习错题本 · ' + list.length + ' 词</button><button class="link" data-act="exportBook" data-id="' + WRONG_BOOK + '">导出为表格</button><button class="link" data-act="clearWrong">清空错题本</button></div>' +
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
      knownHtml +
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
      '<div class="set-row"><div><div class="t">读音</div></div><div class="d" style="margin-top:0">「英 → 中」和「听 → 写」出词时自动朗读，按 Tab 再听一遍；「中 → 英」不出声。</div></div>' +
      '<div class="set-row"><div><div class="t">每组几个词</div></div><div>' + chipsHtml('size', [[5, '5'], [10, '10'], [15, '15'], [20, '20']]) +
      '<div class="d">背新词和复习都按组来，每组依次过三步。</div></div></div>' +
      '<div class="set-row"><div><div class="t">中文意思显示几个</div></div><div>' + chipsHtml('senses', [[1, '1 个'], [2, '2 个'], [3, '3 个'], [5, '5 个']]) +
      '<div class="d">中文意思竖着排，一行一个，前面编号。「英 → 中」显示几个意思，就要写几个意思。</div></div></div>' +
      '<div class="set-row"><div><div class="t">拼错后照打一遍</div></div><div>' + chipsHtml('copyWrong', [[true, '开'], [false, '关']]) +
      '<div class="d">拼写题答错后，照着正确拼写再打一遍，免得记住错的拼法。直接按 Enter 可以跳过。</div></div></div>' +
      '<div class="set-row"><div><div class="t">字母个数提示</div></div><div>' + chipsHtml('letterHint', [[true, '显示'], [false, '不显示']]) +
      '<div class="d">拼写题下面显示 _ _ _ _，提示单词有几个字母。</div></div></div>' +
      '<div class="set-row"><div><div class="t">外观</div></div><div>' + chipsHtml('theme', [['auto', '跟随系统'], ['light', '白底'], ['dark', '黑底']]) + '</div></div>' +
      '<div class="set-row"><div><div class="t">字体粗细</div></div><div>' + chipsHtml('weight', [['light', '细'], ['normal', '标准'], ['bold', '粗']]) +
      '<div class="d">仿宋本身笔画比较细，觉得看不清就选「粗」。</div></div></div>' +
      (!/^https?:$/.test(location.protocol)
        ? ''
        : '<div class="set-row"><div><div class="t">下载到电脑</div></div><div><a class="btn small ghost" href="Margin.html" download="Margin.html">下载 Margin.html</a>' +
          '<div class="d">下载后双击就能打开，不用联网。进度不会自动带过去，需要的话先导出备份，再在下载的版本里导入。</div></div></div>') +
      '<div class="set-row"><div><div class="t">数据备份</div><div class="d">进度只保存在这台电脑的这个浏览器里。</div></div><div>' +
      '<div class="actions"><button class="btn small" data-act="exportData">导出备份</button>' +
      '<label class="btn small ghost file-pick">导入备份<input type="file" id="backup-file" accept=".json,application/json"></label>' +
      '<button class="link" data-act="resetAll">清空所有数据</button></div>' +
      '<div class="d">换电脑、换浏览器或清理浏览器数据之前，先导出备份；到新地方打开 Margin 后再导入。</div></div></div>' +
      '<div class="set-row"><div><div class="t">关于</div></div><div class="d" style="margin-top:0">Margin · 黑白极简的背单词工具。<br>Finance 词库由 Margin 整理，译名参考国内通行教材；发现不准欢迎到 GitHub 反馈。<br>四级、六级、考研、托福、雅思、GRE 词库与音标来自开源词典 ECDICT（MIT 许可证）。</div></div>' +
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
    startNew() {
      startNew();
    },
    startReview() {
      startReview();
    },
    speakCurrent() {
      const e = current();
      if (e && ui.session.mode !== 'zh2en') speak(e.w);
      const input = document.getElementById('answer');
      if (input) input.focus();
    },
    speakWord(t) {
      if (ui.view === 'practice' && ui.session && ui.session.mode === 'zh2en') return;
      speak(t.dataset.w);
    },
    next() {
      submitAnswer();
    },
    quit() {
      quitSession();
    },
    skipKnown() {
      skipKnown();
    },
    unknow(t) {
      delete state.known[keyOf(t.dataset.w)];
      save();
      render();
    },
    exportBook(t) {
      const id = t.dataset.id;
      const lines = bookEntries(id).map((e) => e.w + '\t' + meaningLines(e.m).join('；'));
      // 文件名只用英文：有的浏览器遇到中文文件名会改成 download
      const slug = id === WRONG_BOOK ? 'wrong-words' : id === REVIEW_BOOK ? 'review' : isBuiltin(id) ? id : 'my-list';
      downloadText('margin-' + slug + '-' + todayKey() + '.txt', '\ufeff' + lines.join('\r\n'));
      toast('已导出 ' + lines.length + ' 个词，可以用 Excel 打开，也能导入 Anki');
    },
    retryWrong() {
      const ss = ui.session;
      const words = wrongWords(ss).map((x) => x.entry);
      if (words.length) startSession(shuffle(words), ss.bookId, ss.kind === 'new' ? 'retry' : ss.kind);
    },
    nextGroup() {
      const ss = ui.session;
      if (!ss || ss.kind === 'new' || ss.kind === 'retry') startNew();
      else if (ss.kind === 'review') startReview();
      else startWrong();
    },
    continueStage() {
      continueStage();
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
    async deleteBook(t) {
      const b = state.books[t.dataset.id];
      if (!b || !(await askConfirm('删除词表「' + b.name + '」？背诵记录和错题本不受影响。', '删除'))) return;
      delete state.books[b.id];
      if (state.settings.book === b.id) state.settings.book = FIRST_BOOK;
      save();
      render();
    },
    async renameBook(t) {
      const b = state.books[t.dataset.id];
      if (!b) return;
      const name = await askText('新的词表名称', b.name);
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
      startWrong();
    },
    removeWrong(t) {
      delete state.wrong[keyOf(t.dataset.w)];
      save();
      render();
    },
    async clearWrong() {
      if (!(await askConfirm('清空错题本？', '清空'))) return;
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
      downloadText('margin-backup-' + todayKey() + '.json', JSON.stringify({ app: 'Margin', v: 1, exported: new Date().toISOString(), data: state }), 'application/json');
      toast('备份已下载');
    },
    async resetAll() {
      if (!(await askConfirm('清空所有数据？自己导入的词表、背诵记录、错题本都会删除，无法恢复。', '清空'))) return;
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
      t.files[0].text().then(async (text) => {
        let obj = null;
        try {
          obj = JSON.parse(text);
        } catch (e) {
          obj = null;
        }
        if (!obj || obj.app !== 'Margin' || !obj.data) {
          toast('这个文件不是 Margin 的备份');
          return;
        }
        if (!(await askConfirm('用这个备份覆盖现在的数据？', '覆盖'))) return;
        state = normalizeState(obj.data);
        save();
        applyTheme();
        render();
        toast('备份已导入');
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
    if (document.querySelector('.modal')) return;
    const tag = ev.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    if (ui.view === 'practice') {
      if (ui.session && ui.session.between) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          continueStage();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          quitSession();
        }
        return;
      }
      if (ev.key === 'Enter' && ev.target.classList.contains('ans') && !ui.session.pending) {
        // 这一行写了字、下面还有行：跳到下一行；空行或最后一行：提交
        ev.preventDefault();
        const next = document.querySelector('.ans[data-line="' + (+ev.target.dataset.line + 1) + '"]');
        if (ev.target.value.trim() && next) next.focus();
        else submitAnswer();
      } else if (ev.key === 'Enter' && (ev.target.id === 'answer' || ev.target.classList.contains('ans') || !typing)) {
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
      if (ev.key === 'Enter') {
        ev.preventDefault();
        startNew();
      } else if (ev.key === 'r' || ev.key === 'R') {
        startReview();
      }
    } else if (ui.view === 'result') {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (nextLabel(ui.session)) ACTIONS.nextGroup();
        else go('home');
      } else if (ev.key === 'r' || ev.key === 'R') {
        ACTIONS.retryWrong();
      } else if (ev.key === 'Escape') {
        go('home');
      }
    }
  });

  function applyTheme() {
    const root = document.documentElement;
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    root.setAttribute('data-weight', state.settings.weight || 'normal');
  }

  // 其他标签页改了数据（比如同时开了两个 Margin），这里跟着更新
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORE_KEY && ui.view !== 'practice') {
      state = loadState();
      applyTheme();
      render();
    }
  });

  // 给自动化测试用的入口（只有测试脚本会设置 __MARGIN_TEST）
  if (window.__MARGIN_TEST) window.__margin = { zhMatch, similarity, judgeZhLines };

  applyTheme();
  render();
})();
