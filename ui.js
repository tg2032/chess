/* Chess UI: DOM wiring, tap/drag input, turn flow, AI scheduling. */
(function () {
  'use strict';

  var C = window.Chess;
  var WHITE = C.WHITE;
  var BLACK = C.BLACK;
  var FILES = 'abcdefgh';

  var GLYPH = ['', '\u265F', '\u265E', '\u265D', '\u265C', '\u265B', '\u265A'];
  var VALUE = [0, 100, 320, 330, 500, 900, 0];
  var JA_TYPE = ['', 'ポーン', 'ナイト', 'ビショップ', 'ルーク', 'クイーン', 'キング'];

  var AI_THINK = 330;      /* pause so "CPU is thinking" gets painted first */
  var DRAG_SLOP = 9;       /* px before a press turns into a drag */

  var el = {
    board: document.getElementById('board'),
    status: document.getElementById('status'),
    sound: document.getElementById('soundBtn'),
    level: document.getElementById('levelSelect'),
    levelWrap: document.getElementById('levelWrap'),
    side: document.getElementById('sideSelect'),
    sideWrap: document.getElementById('sideWrap'),
    undo: document.getElementById('undoBtn'),
    hint: document.getElementById('hintBtn'),
    resign: document.getElementById('resignBtn'),
    fresh: document.getElementById('newBtn'),
    modes: [].slice.call(document.querySelectorAll('[data-mode]')),
    footnote: document.getElementById('footnote'),
    toast: document.getElementById('toast'),
    moveList: document.getElementById('moveList'),
    playerTop: document.getElementById('playerTop'),
    playerBottom: document.getElementById('playerBottom'),
    topName: document.getElementById('topName'),
    bottomName: document.getElementById('bottomName'),
    topBadge: document.getElementById('topBadge'),
    bottomBadge: document.getElementById('bottomBadge'),
    topCaptured: document.getElementById('topCaptured'),
    bottomCaptured: document.getElementById('bottomCaptured'),
    topEdge: document.getElementById('topEdge'),
    bottomEdge: document.getElementById('bottomEdge'),
    overlay: document.getElementById('overlay'),
    again: document.getElementById('againBtn'),
    resultTitle: document.getElementById('resultTitle'),
    resultText: document.getElementById('resultText'),
    resultLine: document.getElementById('resultLine'),
    promoOverlay: document.getElementById('promoOverlay'),
    promoChoices: document.getElementById('promoChoices'),
    ghost: document.getElementById('dragGhost')
  };

  /* ---------- board cells ---------- */

  var cells = new Array(64);
  var pieceEls = new Array(64);
  var rankEls = new Array(64);
  var fileEls = new Array(64);

  function buildCells() {
    var frag = document.createDocumentFragment();
    for (var sq = 0; sq < 64; sq++) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.sq = String(sq);

      var rank = document.createElement('i');
      rank.className = 'lbl rank';
      rank.setAttribute('aria-hidden', 'true');   /* square name is in the cell's aria-label */
      var file = document.createElement('i');
      file.className = 'lbl file';
      file.setAttribute('aria-hidden', 'true');
      var piece = document.createElement('span');
      piece.className = 'piece';
      piece.setAttribute('aria-hidden', 'true');  /* piece name is in the cell's aria-label */

      cell.appendChild(rank);
      cell.appendChild(file);
      cell.appendChild(piece);
      frag.appendChild(cell);

      cells[sq] = cell;
      rankEls[sq] = rank;
      fileEls[sq] = file;
      pieceEls[sq] = piece;
    }
    el.board.appendChild(frag);
  }

  /* ---------- state ---------- */

  var state = null;
  var sans = [];          /* SAN strings shown in the move list */
  var history = [];       /* { state, san, prevMove } — one entry per ply */
  var keys = [];          /* position keys, for threefold repetition */
  var hashes = [];        /* position hashes, handed to the AI for the same */
  var lastMove = null;

  var mode = 'ai';        /* 'ai' | 'pvp' */
  var level = 'normal';
  var humanSide = WHITE;
  var flipped = false;

  var over = false;
  var thinking = false;
  var promoOpen = false;
  var selected = -1;
  var hints = {};         /* from square -> [moves] */
  var statusNow = null;
  var soundOn = true;

  var aiTimer = null;
  var endTimer = null;
  var toastTimer = null;
  var hintTimer = null;
  var resignTimer = null;

  var hinting = false;    /* a hint request is in flight (board stays live) */
  var hintPly = 0;        /* history length when the pending hint was requested */
  var hintMove = null;    /* { from, to } squares highlighted as a hint */
  var resignArmed = false;

  function colorName(color) { return color === WHITE ? '白' : '黒'; }

  function playerName(color) {
    if (mode === 'ai') return color === humanSide ? 'あなた' : 'CPU';
    return colorName(color);
  }

  function isCpuTurn() { return mode === 'ai' && state.turn !== humanSide; }
  function humanTurn() { return mode === 'pvp' || state.turn === humanSide; }

  function inputAllowed() {
    return !over && !thinking && !promoOpen && humanTurn();
  }

  /* ---------- persisted settings ---------- */

  var SETTINGS_KEY = 'chess-settings-v1';

  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d) return;
      if (d.mode === 'ai' || d.mode === 'pvp') mode = d.mode;
      if (d.level === 'easy' || d.level === 'normal' || d.level === 'hard') level = d.level;
      if (d.side === 0 || d.side === 1) humanSide = Number(d.side);
      if (typeof d.sound === 'boolean') soundOn = d.sound;
    } catch (e) { /* private mode etc: just play with defaults */ }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mode: mode, level: level, side: humanSide, sound: soundOn
      }));
    } catch (e) { /* ignore */ }
  }

  function syncSettingsUI() {
    el.modes.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.mode === mode);
    });
    el.level.value = level;
    el.side.value = String(humanSide);
    el.levelWrap.hidden = mode !== 'ai';
    el.sideWrap.hidden = mode !== 'ai';
    el.sound.textContent = soundOn ? '🔊' : '🔇';
    el.sound.classList.toggle('off', !soundOn);
    el.sound.setAttribute('aria-pressed', String(soundOn));
  }

  /* ---------- sound ---------- */

  var audioCtx = null;

  var TONES = {
    select:  { wave: 'sine',     from: 760, to: 900, gain: 0.06, len: 0.07 },
    move:    { wave: 'triangle', from: 420, to: 250, gain: 0.14, len: 0.13 },
    capture: { wave: 'square',   from: 260, to: 130, gain: 0.10, len: 0.16 },
    check:   { wave: 'sine',     from: 880, to: 520, gain: 0.12, len: 0.20 },
    end:     { wave: 'triangle', from: 520, to: 780, gain: 0.14, len: 0.30 }
  };

  function beep(kind) {
    if (!soundOn) return;
    var t = TONES[kind] || TONES.move;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = t.wave;
      osc.frequency.setValueAtTime(t.from, now);
      osc.frequency.exponentialRampToValueAtTime(t.to, now + t.len);
      gain.gain.setValueAtTime(t.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.len + 0.05);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + t.len + 0.08);
    } catch (e) { /* audio is a nicety, never break the game for it */ }
  }

  /* ---------- status ---------- */

  function refresh() {
    statusNow = C.status(state);
    if (!statusNow.over) {
      var key = C.positionKey(state);
      var seen = 0;
      for (var i = 0; i < keys.length; i++) if (keys[i] === key) seen++;
      if (seen >= 3) {
        statusNow = {
          over: true, check: statusNow.check, moves: [],
          result: 'draw', reason: 'threefold'
        };
      }
    }
    over = statusNow.over;
  }

  function updateStatus() {
    var text;
    if (over) text = '対局終了';
    else if (thinking) text = 'CPUが考え中…';
    else text = playerName(state.turn) + 'の番';

    el.status.textContent = statusNow && statusNow.check && !over ? text + '（チェック）' : text;
    el.status.classList.toggle('check', !!(statusNow && statusNow.check && !over));
    el.status.classList.toggle('thinking', thinking && !over);
    /* undo stays available while the CPU thinks: clearTimers() invalidates
       the in-flight worker reply, so a stale answer can never land */
    el.undo.disabled = history.length === 0;
    el.hint.disabled = !inputAllowed() || hinting;
    el.hint.textContent = hinting ? '…' : 'ヒント';
    el.resign.disabled = over;
  }

  var toastEl = el.toast;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 1700);
  }

  /* ---------- rendering ---------- */

  function displayPos(sq) {
    var row = (sq / 8) | 0;
    var col = sq & 7;
    return flipped ? [(7 - row), (7 - col)] : [row, col];
  }

  function materialEdge() {
    var w = 0;
    var b = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (!p) continue;
      if (C.colorOf(p) === WHITE) w += VALUE[C.typeOf(p)];
      else b += VALUE[C.typeOf(p)];
    }
    return w - b;
  }

  function capturedHtml(list, color) {
    var cls = color === WHITE ? 'cw' : 'cb';
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<span class="' + cls + '">' + GLYPH[list[i]] + '</span>';
    }
    return html;
  }

  function renderPlayers() {
    var topSide = flipped ? WHITE : BLACK;
    var bottomSide = flipped ? BLACK : WHITE;
    var cap = C.captured(state.board);
    var edge = materialEdge();

    var rows = [
      { side: topSide, box: el.playerTop, name: el.topName, badge: el.topBadge,
        captured: el.topCaptured, edgeEl: el.topEdge },
      { side: bottomSide, box: el.playerBottom, name: el.bottomName, badge: el.bottomBadge,
        captured: el.bottomCaptured, edgeEl: el.bottomEdge }
    ];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      r.name.textContent = playerName(r.side);
      r.badge.textContent = colorName(r.side);
      r.badge.className = 'side-badge ' + (r.side === WHITE ? 'white' : 'black');
      r.box.classList.toggle('active', !over && state.turn === r.side);
      /* a player's captures are the opponent's losses */
      r.captured.innerHTML = capturedHtml(r.side === WHITE ? cap.black : cap.white,
        r.side === WHITE ? BLACK : WHITE);
      var adv = r.side === WHITE ? edge : -edge;
      r.edgeEl.textContent = adv > 0 ? '+' + Math.round(adv / 100) : '';
    }
  }

  function mvHtml(san) {
    /* SAN only ever contains [A-Za-z0-9xO=+#-], so no escaping is needed */
    var cls = /[+#]$/.test(san) ? 'mv check' : 'mv';
    return '<span class="' + cls + '">' + san + '</span>';
  }

  function renderMoveList() {
    if (!sans.length) {
      el.moveList.innerHTML = '<li class="empty">まだ一手も指されていません</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < sans.length; i += 2) {
      html += '<li><span class="num">' + (i / 2 + 1) + '.</span>' +
        mvHtml(sans[i]) +
        (sans[i + 1] ? mvHtml(sans[i + 1]) : '<span class="mv"></span>') +
        '</li>';
    }
    el.moveList.innerHTML = html;
    el.moveList.scrollTop = el.moveList.scrollHeight;
  }

  function render(anim) {
    var legal = over ? [] : statusNow.moves;
    hints = {};
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      (hints[m.from] = hints[m.from] || []).push(m);
    }

    var interactive = inputAllowed();
    var checkSq = statusNow.check ? C.kingSquare(state.board, state.turn) : -1;
    var targets = {};
    if (interactive && selected >= 0 && hints[selected]) {
      for (var t = 0; t < hints[selected].length; t++) {
        targets[hints[selected][t].to] = hints[selected][t];
      }
    }

    for (var sq = 0; sq < 64; sq++) {
      var cell = cells[sq];
      var row = (sq / 8) | 0;
      var col = sq & 7;
      var d = displayPos(sq);

      cell.style.order = String(d[0] * 8 + d[1]);
      cell.dataset.tone = ((row + col) % 2 === 0) ? 'light' : 'dark';
      rankEls[sq].textContent = d[1] === 0 ? String(8 - row) : '';
      fileEls[sq].textContent = d[0] === 7 ? FILES[col] : '';

      var p = state.board[sq];
      var glyph = p ? GLYPH[C.typeOf(p)] : '';
      var pe = pieceEls[sq];
      if (pe.textContent !== glyph) pe.textContent = glyph;
      var wantClass = p ? ('piece ' + (C.colorOf(p) === WHITE ? 'w' : 'b')) : 'piece';
      if (pe.className !== wantClass) pe.className = wantClass;

      cell.classList.toggle('sel', sq === selected);
      cell.classList.toggle('last', !!lastMove && (sq === lastMove.from || sq === lastMove.to));
      cell.classList.toggle('check', sq === checkSq);
      cell.classList.toggle('hintmove', !!hintMove &&
        (sq === hintMove.from || sq === hintMove.to));

      var target = targets[sq];
      var isHint = !!target;
      cell.classList.toggle('hint', isHint);
      cell.classList.toggle('cap', isHint && !!target.captured);

      cell.disabled = !interactive;
      cell.setAttribute('aria-label', C.describe(sq, state.board) +
        (isHint ? ' に移動できます' : ''));

      if (anim && anim.moved === sq) {
        cell.classList.remove('pop');
        void cell.offsetWidth;   /* restart the animation */
        cell.classList.add('pop');
      } else {
        cell.classList.remove('pop');
      }
    }

    renderPlayers();
    renderMoveList();
    updateStatus();
    updateFootnote();
  }

  function updateFootnote() {
    var text;
    if (mode === 'ai') {
      text = humanSide === WHITE
        ? 'あなたは白（先手）です。駒をタップしてから行き先をタップするか、ドラッグで動かします。'
        : 'あなたは黒（後手）です。CPUが先に指します。駒をタップ→行き先タップ、またはドラッグ。';
    } else {
      text = '白が先手です。交互に1手ずつ、駒をタップ→行き先タップ（またはドラッグ）で動かします。';
    }
    el.footnote.textContent = text;
  }

  /* ---------- turn flow ---------- */

  function targetMove(sq) {
    if (selected < 0 || !hints[selected]) return null;
    for (var i = 0; i < hints[selected].length; i++) {
      if (hints[selected][i].to === sq) return hints[selected][i];
    }
    return null;
  }

  function attempt(move) {
    if (move.promo) {
      var opts = [];
      var list = hints[move.from] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].to === move.to && list[i].promo) opts.push(list[i]);
      }
      showPromo(opts.length ? opts : [move]);
      return;
    }
    applyMove(move);
  }

  function showPromo(options) {
    promoOpen = true;
    var color = state.turn;
    var html = '';
    for (var i = 0; i < options.length; i++) {
      html += '<button type="button" data-i="' + i + '" aria-label="' +
        (color === WHITE ? '白' : '黒') + C.LETTER[options[i].promo] + 'にプロモート">' +
        '<span class="glyph ' + (color === WHITE ? 'w' : 'b') + '">' +
        GLYPH[options[i].promo] + '</span></button>';
    }
    el.promoChoices.innerHTML = html;
    el.promoOverlay.hidden = false;

    var buttons = [].slice.call(el.promoChoices.querySelectorAll('button'));
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var move = options[Number(btn.dataset.i)];
        closePromo();
        applyMove(move);
      }, { once: true });
    });
    if (buttons[0]) buttons[0].focus();
  }

  function closePromo() {
    promoOpen = false;
    el.promoOverlay.hidden = true;
  }

  function applyMove(move) {
    var san = C.moveToSan(state, move, statusNow.moves);
    history.push({ state: state, san: san, prevMove: lastMove });

    var wasCapture = !!move.captured;
    state = C.makeMove(state, move);
    keys.push(C.positionKey(state));
    hashes.push(C.positionHash(state));
    sans.push(san);
    if (hinting) cancelEngine();
    hinting = false;   /* a played move voids any in-flight hint request */
    hintMove = null;   /* a played move consumes any shown hint */
    lastMove = { from: move.from, to: move.to };
    selected = -1;

    refresh();
    render({ moved: move.to });
    beep(wasCapture ? 'capture' : 'move');
    if (statusNow.check && !over) setTimeout(function () { beep('check'); }, 130);

    if (over) {
      clearTimeout(endTimer);
      endTimer = setTimeout(endGame, 480);
      return;
    }
    if (isCpuTurn()) scheduleCpu();
  }

  function scheduleCpu() {
    thinking = true;
    updateStatus();
    clearTimeout(aiTimer);
    aiTimer = null;

    var worker = ensureWorker();
    if (!worker) {
      /* no Worker here (notably file:// in some browsers): think inline */
      aiTimer = setTimeout(function () {
        aiTimer = null;
        onCpuMove(C.chooseMove(state, level, hashes.slice()));
      }, AI_THINK);
      return;
    }
    cancelEngine();
    worker = ensureWorker();
    if (!worker) {
      aiTimer = setTimeout(function () {
        aiTimer = null;
        onCpuMove(C.chooseMove(state, level, hashes.slice()));
      }, AI_THINK);
      return;
    }
    aiPending = ++aiSeq;
    aiKind = 'play';
    worker.postMessage({
      type: 'move',
      seq: aiPending,
      fen: C.toFen(state),
      level: level,
      history: hashes.slice()
    });
  }

  /* A move arrived from the engine (Worker or inline fallback). The board may
     have moved on while we thought (new game / undo), so re-validate against
     the current legal moves and drop anything stale. */
  function onCpuMove(move) {
    clearTimeout(aiTimer);
    aiTimer = null;
    thinking = false;
    if (!move || over || !isCpuTurn()) { refresh(); render(); return; }
    var canonical = null;
    var legal = statusNow.moves;
    for (var i = 0; i < legal.length; i++) {
      var lm = legal[i];
      if (lm.from === move.from && lm.to === move.to && lm.promo === move.promo) {
        canonical = lm;
        break;
      }
    }
    if (!canonical) { render(); return; }
    applyMove(canonical);
  }

  /* ---------- engine worker ---------- */

  var aiWorker = null;
  var aiSeq = 0;
  var aiPending = 0;   /* seq we are waiting for; 0 = none outstanding */
  var aiKind = null;   /* 'play' | 'hint' — what the pending reply is for */

  /* Drop whatever the engine is working on. Terminating the Worker frees the
     CPU at once (a stale search would otherwise delay the next answer by up
     to its whole budget); ensureWorker() makes a fresh one on demand. */
  function cancelEngine() {
    if (aiPending && aiWorker) {
      try { aiWorker.terminate(); } catch (err) { /* ignore */ }
      aiWorker = null;
    }
    aiPending = 0;
    aiKind = null;
  }

  function ensureWorker() {
    if (aiWorker || typeof window.Worker !== 'function') return aiWorker;
    try {
      aiWorker = new Worker('game.js');
    } catch (err) {
      aiWorker = null;
      return null;
    }
    aiWorker.onmessage = function (e) {
      var d = e.data || {};
      if (d.type !== 'move' || d.seq !== aiPending) return;   /* stale */
      var kind = aiKind;
      aiPending = 0;
      aiKind = null;
      if (kind === 'hint') onHintMove(d.move);
      else onCpuMove(d.move);
    };
    aiWorker.onerror = function () {
      /* worker broken (or game.js unreachable): fall back to inline search */
      try { aiWorker.terminate(); } catch (err) { /* ignore */ }
      aiWorker = null;
      if (aiPending) {
        var kind = aiKind;
        aiPending = 0;
        aiKind = null;
        var fallback = C.chooseMove(state, kind === 'hint' ? 'hard' : level, hashes.slice());
        if (kind === 'hint') onHintMove(fallback);
        else onCpuMove(fallback);
      }
    };
    return aiWorker;
  }

  /* ---------- hint ---------- */

  function requestHint() {
    if (!inputAllowed() || hinting) return;
    hintMove = null;
    hintPly = history.length;
    var worker = ensureWorker();
    if (!worker) {
      /* hints always search at full strength, never at the game level
         (on easy a hint could otherwise be one of the random moves) */
      onHintMove(C.chooseMove(state, 'hard', hashes.slice()));
      return;
    }
    hinting = true;
    updateStatus();
    aiPending = ++aiSeq;
    aiKind = 'hint';
    worker.postMessage({
      type: 'move',
      seq: aiPending,
      kind: 'hint',
      fen: C.toFen(state),
      level: 'hard',
      history: hashes.slice()
    });
  }

  /* A hint arrived. The board stayed interactive while it computed, so the
     position may have moved on — re-validate and drop anything stale. */
  function onHintMove(move) {
    hinting = false;
    /* a move was played (or undone) since the request: the hint was for another position */
    if (hintPly !== history.length) { render(); return; }
    if (!move || over || !humanTurn()) { render(); return; }
    var canonical = null;
    var legal = statusNow.moves;
    for (var i = 0; i < legal.length; i++) {
      var lm = legal[i];
      if (lm.from === move.from && lm.to === move.to && lm.promo === move.promo) {
        canonical = lm;
        break;
      }
    }
    if (!canonical) { render(); return; }
    hintMove = { from: canonical.from, to: canonical.to };
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hintTimer = null;
      hintMove = null;
      render();
    }, 4000);
    render();
    showToast('ヒント：' + C.moveToSan(state, canonical, statusNow.moves));
    beep('select');
  }

  /* ---------- resign ---------- */

  function disarmResign() {
    resignArmed = false;
    clearTimeout(resignTimer);
    resignTimer = null;
    el.resign.textContent = '投了';
    el.resign.classList.remove('armed');
  }

  function resign() {
    if (over) return;
    if (!resignArmed) {
      resignArmed = true;
      el.resign.textContent = '本当に投了？';
      el.resign.classList.add('armed');
      showToast('もう一度押すと投了します');
      clearTimeout(resignTimer);
      resignTimer = setTimeout(disarmResign, 3000);
      return;
    }
    disarmResign();
    clearTimers();
    closePromo();
    var loser = mode === 'ai' ? humanSide : state.turn;
    var winner = 1 - loser;
    statusNow = {
      over: true, check: C.inCheck(state, state.turn), moves: [],
      result: winner === WHITE ? 'white' : 'black', reason: 'resign'
    };
    over = true;
    thinking = false;
    selected = -1;
    render();
    clearTimeout(endTimer);
    endTimer = setTimeout(endGame, 480);
  }

  function endGame() {
    over = true;
    thinking = false;
    promoOpen = false;
    clearTimeout(aiTimer);
    clearTimeout(endTimer);
    aiTimer = null;
    endTimer = null;

    var titles = {
      checkmate: 'チェックメイト',
      stalemate: 'ステイルメイト',
      threefold: '千日手',
      fifty: '50手ルール',
      material: '駒不足による引き分け',
      resign: '投了'
    };
    var title = '対局終了';
    var text = titles[statusNow.reason] || '対局終了';
    var line;

    if (statusNow.reason === 'checkmate') {
      var winner = statusNow.result;
      if (mode === 'ai') {
        title = winner === humanSide ? 'あなたの勝ち！' : 'CPUの勝ち';
        text = winner === humanSide ? 'お見事です。' : '次は負けません。';
      } else {
        title = colorName(winner) + 'の勝ち！';
        text = 'チェックメイト。';
      }
      line = '<span class="num">' + sans.length + '</span> 手で決着';
    } else if (statusNow.reason === 'resign') {
      var winner = statusNow.result === 'white' ? WHITE : BLACK;
      if (mode === 'ai') {
        title = winner === humanSide ? 'あなたの勝ち！' : 'CPUの勝ち';
        text = winner === humanSide ? 'CPUが投了しました。' : '投了しました。お疲れさまでした。';
      } else {
        title = colorName(winner) + 'の勝ち！';
        text = '投了。';
      }
      line = '<span class="num">' + sans.length + '</span> 手';
    } else {
      line = '<span class="num">' + sans.length + '</span> 手';
    }

    el.resultTitle.textContent = title;
    el.resultText.textContent = text;
    el.resultLine.innerHTML = line;
    el.overlay.hidden = false;
    beep('end');
    render();
  }

  /* ---------- controls ---------- */

  function clearTimers() {
    clearTimeout(aiTimer);
    clearTimeout(endTimer);
    aiTimer = null;
    endTimer = null;
    cancelEngine();  /* any in-flight worker answer is now stale */
    hinting = false;
    hintMove = null;
    clearTimeout(hintTimer);
    hintTimer = null;
  }

  function newGame() {
    clearTimers();
    disarmResign();
    el.overlay.hidden = true;
    closePromo();

    state = C.createGame();
    sans = [];
    history = [];
    keys = [C.positionKey(state)];
    hashes = [C.positionHash(state)];
    lastMove = null;
    selected = -1;
    over = false;
    thinking = false;

    flipped = (mode === 'ai' && humanSide === BLACK);

    refresh();
    render();
    if (isCpuTurn()) scheduleCpu();
  }

  function restoreLast() {
    var entry = history.pop();
    state = entry.state;
    sans.pop();
    keys.pop();
    hashes.pop();
    lastMove = entry.prevMove;
  }

  function undo() {
    if (!history.length) return;
    clearTimers();
    disarmResign();
    el.overlay.hidden = true;
    closePromo();
    over = false;
    thinking = false;

    restoreLast();
    /* in a CPU game rewind the full round so it is your turn again */
    while (mode === 'ai' && history.length && state.turn !== humanSide) restoreLast();

    selected = -1;
    refresh();
    render();
    if (isCpuTurn()) scheduleCpu();
  }

  /* restarting throws away a game in progress, so ask first */
  function confirmReset() {
    if (over || !history.length) return true;
    return window.confirm('進行中の対局は破棄されます。よろしいですか？');
  }

  function setMode(next) {
    if (next === mode) return;
    if (!confirmReset()) return;
    mode = next;
    saveSettings();
    el.modes.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.mode === mode);
    });
    el.levelWrap.hidden = mode !== 'ai';
    el.sideWrap.hidden = mode !== 'ai';
    newGame();
    showToast(mode === 'ai' ? 'CPU戦を開始' : '2人対戦を開始');
  }

  /* ---------- pointer input ---------- */

  function squareAt(clientX, clientY) {
    var rect = el.board.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right ||
        clientY < rect.top || clientY >= rect.bottom) return -1;
    var col = Math.floor((clientX - rect.left) / (rect.width / 8));
    var row = Math.floor((clientY - rect.top) / (rect.height / 8));
    col = Math.max(0, Math.min(7, col));
    row = Math.max(0, Math.min(7, row));
    var logicalRow = flipped ? 7 - row : row;
    var logicalCol = flipped ? 7 - col : col;
    return logicalRow * 8 + logicalCol;
  }

  var pending = null;   /* { sq, x, y } */
  var drag = null;      /* { sq } once the finger has moved far enough */
  var justSelected = false;   /* pointerdown already selected this tap */
  var lastPointerUp = 0;

  function selectSquare(sq) {
    selected = sq;
    beep('select');
    render();
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!inputAllowed()) return;
    var sq = squareAt(e.clientX, e.clientY);
    if (sq < 0) return;

    pending = { sq: sq, x: e.clientX, y: e.clientY };
    drag = null;
    justSelected = false;

    /* pressing your own piece selects it straight away so a tap-tap works */
    var p = state.board[sq];
    if (p && C.colorOf(p) === state.turn && hints[sq] && hints[sq].length &&
        selected !== sq && !(selected >= 0 && targetMove(sq))) {
      selectSquare(sq);
      justSelected = true;
    }

    if (el.board.setPointerCapture) {
      try { el.board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onPointerMove(e) {
    if (!pending) return;
    if (drag) {
      positionGhost(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    var dx = e.clientX - pending.x;
    var dy = e.clientY - pending.y;
    if (dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP) return;

    var p = state.board[pending.sq];
    if (!p || C.colorOf(p) !== state.turn || !hints[pending.sq]) { pending = null; return; }

    drag = { sq: pending.sq };
    cells[pending.sq].classList.add('drag-src');
    el.ghost.hidden = false;
    el.ghost.textContent = GLYPH[C.typeOf(p)];
    el.ghost.className = 'drag-ghost ' + (C.colorOf(p) === WHITE ? 'w' : 'b');
    var size = el.board.getBoundingClientRect().width / 8;
    el.ghost.style.fontSize = (size * 0.86) + 'px';
    positionGhost(e.clientX, e.clientY);
    e.preventDefault();
  }

  function positionGhost(x, y) {
    el.ghost.style.left = x + 'px';
    el.ghost.style.top = y + 'px';
  }

  function endDrag() {
    if (drag) {
      cells[drag.sq].classList.remove('drag-src');
      el.ghost.hidden = true;
    }
    drag = null;
    pending = null;
    justSelected = false;
  }

  function onPointerUp(e) {
    lastPointerUp = Date.now();
    if (!pending && !drag) { justSelected = false; return; }

    var sq = squareAt(e.clientX, e.clientY);
    var wasDrag = !!drag;
    var from = pending ? pending.sq : -1;
    var tapped = justSelected && !wasDrag;
    endDrag();
    if (sq < 0) return;

    if (wasDrag) {
      if (selected !== from) selectSquare(from);
      var mv = targetMove(sq);
      if (mv) { attempt(mv); return; }
      render();
      if (from !== sq) showToast('ここには移動できません');
      return;
    }

    /* a tap that selected on the way down must not toggle back off here;
       the second tap on the same square still deselects via onSquareTap */
    if (tapped && sq === selected) return;
    onSquareTap(sq);
  }

  function onPointerCancel() {
    endDrag();
  }

  function onSquareTap(sq) {
    if (!inputAllowed()) return;

    if (selected >= 0) {
      var mv = targetMove(sq);
      if (mv) { attempt(mv); return; }
    }

    var p = state.board[sq];
    if (p && C.colorOf(p) === state.turn) {
      if (selected === sq) { selected = -1; render(); return; }
      if (hints[sq] && hints[sq].length) { selectSquare(sq); return; }
      showToast('この' + JA_TYPE[C.typeOf(p)] + 'は今は動かせません');
      return;
    }

    if (selected >= 0) {
      selected = -1;
      render();
    }
  }

  /* keyboard activation of a cell (Enter/Space) */
  el.board.addEventListener('click', function (event) {
    if (Date.now() - lastPointerUp < 600) return;
    var cell = event.target.closest ? event.target.closest('.cell') : null;
    if (cell) onSquareTap(Number(cell.dataset.sq));
  });

  el.board.addEventListener('pointerdown', onPointerDown);
  el.board.addEventListener('pointermove', onPointerMove);
  el.board.addEventListener('pointerup', onPointerUp);
  el.board.addEventListener('pointercancel', onPointerCancel);
  el.board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- wiring ---------- */

  buildCells();

  el.undo.addEventListener('click', undo);
  el.hint.addEventListener('click', requestHint);
  el.resign.addEventListener('click', resign);
  el.fresh.addEventListener('click', newGame);
  el.again.addEventListener('click', newGame);

  el.modes.forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
  });

  el.level.addEventListener('change', function () {
    /* the level only affects the CPU's next search, so no restart is needed */
    level = el.level.value;
    saveSettings();
    showToast('難易度：' + el.level.options[el.level.selectedIndex].text);
  });

  el.side.addEventListener('change', function () {
    if (!confirmReset()) { el.side.value = String(humanSide); return; }
    humanSide = Number(el.side.value);
    saveSettings();
    newGame();
    showToast('あなたは' + colorName(humanSide) + 'で対局します');
  });

  el.sound.addEventListener('click', function () {
    soundOn = !soundOn;
    saveSettings();
    el.sound.textContent = soundOn ? '🔊' : '🔇';
    el.sound.classList.toggle('off', !soundOn);
    el.sound.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) beep('select');
  });

  el.promoOverlay.addEventListener('click', function (e) {
    if (e.target === el.promoOverlay) { closePromo(); selected = -1; render(); }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (promoOpen) {
        closePromo();
        selected = -1;
        render();
      } else if (selected >= 0) {
        selected = -1;
        render();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key.indexOf('Arrow') === 0) {
      var active = document.activeElement;
      var sq = active && active.classList && active.classList.contains('cell') ?
        Number(active.dataset.sq) : -1;
      if (sq < 0) return;
      event.preventDefault();
      /* move in display coordinates so Up is always visually up */
      var d = displayPos(sq);
      if (event.key === 'ArrowUp') d[0]--;
      else if (event.key === 'ArrowDown') d[0]++;
      else if (event.key === 'ArrowLeft') d[1]--;
      else d[1]++;
      if (d[0] < 0 || d[0] > 7 || d[1] < 0 || d[1] > 7) return;
      var row = flipped ? 7 - d[0] : d[0];
      var col = flipped ? 7 - d[1] : d[1];
      cells[row * 8 + col].focus();
    }
  });

  window.addEventListener('resize', function () {
    if (!el.ghost.hidden) el.ghost.hidden = true;
    endDrag();
  });

  loadSettings();
  syncSettingsUI();

  newGame();
})();
