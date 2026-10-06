/* Chess core logic — pure, no DOM.
   Works both in the browser (window.Chess) and in Node (module.exports).

   Board encoding: Int8Array(64), index 0 = a8 … 63 = h1 (row 0 = rank 8).
   A square holds 0 when empty, otherwise `type | (color << 3)` where
   type is 1..6 (P N B R Q K) and color is 0 = white, 1 = black. */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var WHITE = 0, BLACK = 1;

  /* move flags */
  var FLAG_NONE = 0;
  var FLAG_DOUBLE = 1;
  var FLAG_EP = 2;
  var FLAG_CASTLE_K = 3;
  var FLAG_CASTLE_Q = 4;

  /* castling rights bitmask: 1 = white O-O, 2 = white O-O-O, 4/8 = black */
  var CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

  var FILES = 'abcdefgh';
  var LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];
  var JA = ['', 'ポーン', 'ナイト', 'ビショップ', 'ルーク', 'クイーン', 'キング'];

  var VAL = [0, 100, 320, 330, 500, 900, 0];
  var PHASE = [0, 0, 1, 1, 2, 4, 0];
  var PHASE_MAX = 24;
  var MATE = 100000;

  var KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var KING_D = ORTHO.concat(DIAG);

  /* Piece-square tables, rank 8 first so index 0 (a8) maps directly.
     Black pieces read the vertically mirrored square. */
  var PST_PAWN = [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0
  ];
  var PST_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ];
  var PST_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ];
  var PST_ROOK = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
  ];
  var PST_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ];
  var PST_KING_MG = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ];
  var PST_KING_EG = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
  ];

  var PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING_MG];

  /* Zobrist-style keys so repetition can be checked without building strings.
     The tables are seeded deterministically: a key only has to match other
     keys produced from the same tables (browser and Node use the same seed,
     which lets a Worker history be compared against the main thread's). */
  var HASH_PIECE = new Int32Array(64 * 16);
  var HASH_SIDE = 0;
  var HASH_CASTLE = new Int32Array(16);
  var HASH_EP = new Int32Array(65);
  (function initHash() {
    var r = 0x1a2b3c4d | 0;
    function next() {
      r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r |= 0;
      return r;
    }
    for (var i = 0; i < HASH_PIECE.length; i++) HASH_PIECE[i] = next();
    HASH_SIDE = next();
    for (var c = 0; c < 16; c++) HASH_CASTLE[c] = next();
    for (var e = 0; e < 65; e++) HASH_EP[e] = next();
  })();

  /* ---------- small helpers ---------- */

  function colorOf(p) { return p >> 3; }
  function typeOf(p) { return p & 7; }
  function piece(type, color) { return type | (color << 3); }

  function squareName(i) { return FILES[i & 7] + (8 - ((i / 8) | 0)); }

  function squareIndex(name) {
    var f = FILES.indexOf(name[0]);
    var r = Number(name[1]);
    if (f < 0 || !(r >= 1 && r <= 8)) return -1;
    return (8 - r) * 8 + f;
  }

  function mirrorIndex(i) { return (7 - ((i / 8) | 0)) * 8 + (i & 7); }

  function describe(sq, board) {
    var p = board[sq];
    if (!p) return squareName(sq);
    return squareName(sq) + 'の' + (colorOf(p) === WHITE ? '白' : '黒') + JA[typeOf(p)];
  }

  /* ---------- attack detection ---------- */

  function slide(board, f, r, dirs, by, role) {
    for (var d = 0; d < dirs.length; d++) {
      var nf = f + dirs[d][0];
      var nr = r + dirs[d][1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        var p = board[nr * 8 + nf];
        if (p) {
          if (colorOf(p) === by && (typeOf(p) === role || typeOf(p) === QUEEN)) return true;
          break;
        }
        nf += dirs[d][0];
        nr += dirs[d][1];
      }
    }
    return false;
  }

  /* Is `sq` attacked by any piece of colour `by`? */
  function isAttacked(board, sq, by) {
    var f = sq & 7;
    var r = (sq / 8) | 0;
    var i, nf, nr, p;

    /* pawns attack towards the far rank: a white pawn sits one row below */
    var pr = by === WHITE ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      for (i = -1; i <= 1; i += 2) {
        nf = f + i;
        if (nf < 0 || nf > 7) continue;
        p = board[pr * 8 + nf];
        if (p && colorOf(p) === by && typeOf(p) === PAWN) return true;
      }
    }

    for (i = 0; i < 8; i++) {
      nf = f + KNIGHT_D[i][0];
      nr = r + KNIGHT_D[i][1];
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      p = board[nr * 8 + nf];
      if (p && colorOf(p) === by && typeOf(p) === KNIGHT) return true;
    }

    for (i = 0; i < 8; i++) {
      nf = f + KING_D[i][0];
      nr = r + KING_D[i][1];
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      p = board[nr * 8 + nf];
      if (p && colorOf(p) === by && typeOf(p) === KING) return true;
    }

    if (slide(board, f, r, ORTHO, by, ROOK)) return true;
    if (slide(board, f, r, DIAG, by, BISHOP)) return true;
    return false;
  }

  /* ---------- move generation ---------- */

  function pushMove(list, from, to, captured, promo, flag) {
    list.push({
      from: from,
      to: to,
      piece: 0,          /* filled in by generateMoves */
      captured: captured || 0,
      promo: promo || 0,
      flag: flag || FLAG_NONE
    });
  }

  function addPawnTarget(out, from, to, captured, promoRow) {
    if (((to / 8) | 0) === promoRow) {
      pushMove(out, from, to, captured, QUEEN, FLAG_NONE);
      pushMove(out, from, to, captured, ROOK, FLAG_NONE);
      pushMove(out, from, to, captured, BISHOP, FLAG_NONE);
      pushMove(out, from, to, captured, KNIGHT, FLAG_NONE);
    } else {
      pushMove(out, from, to, captured, 0, FLAG_NONE);
    }
  }

  function genPawn(b, state, i, turn, out) {
    var dir = turn === WHITE ? -8 : 8;
    var startRow = turn === WHITE ? 6 : 1;
    var promoRow = turn === WHITE ? 0 : 7;
    var row = (i / 8) | 0;
    var one = i + dir;

    if (one >= 0 && one < 64 && b[one] === EMPTY) {
      addPawnTarget(out, i, one, 0, promoRow);
      if (row === startRow && b[i + 2 * dir] === EMPTY) {
        pushMove(out, i, i + 2 * dir, 0, 0, FLAG_DOUBLE);
      }
    }

    var f = i & 7;
    for (var d = -1; d <= 1; d += 2) {
      var nf = f + d;
      if (nf < 0 || nf > 7) continue;
      var t = i + dir + d;
      if (t < 0 || t > 63) continue;
      var q = b[t];
      if (q && colorOf(q) !== turn) {
        addPawnTarget(out, i, t, q, promoRow);
      } else if (q === EMPTY && t === state.ep) {
        var victim = turn === WHITE ? t + 8 : t - 8;
        pushMove(out, i, t, b[victim], 0, FLAG_EP);
      }
    }
  }

  function genStep(b, from, turn, t, out) {
    var f = from & 7;
    var r = (from / 8) | 0;
    var dirs = t === KNIGHT ? KNIGHT_D : KING_D;
    for (var d = 0; d < dirs.length; d++) {
      var nf = f + dirs[d][0];
      var nr = r + dirs[d][1];
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      var to = nr * 8 + nf;
      var q = b[to];
      if (!q || colorOf(q) !== turn) pushMove(out, from, to, q, 0, FLAG_NONE);
    }
  }

  function genSlide(b, from, turn, t, out) {
    var dirs = (t === BISHOP) ? DIAG : (t === ROOK) ? ORTHO : KING_D;
    var f = from & 7;
    var r = (from / 8) | 0;
    for (var d = 0; d < dirs.length; d++) {
      var nf = f + dirs[d][0];
      var nr = r + dirs[d][1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        var to = nr * 8 + nf;
        var q = b[to];
        if (q) {
          if (colorOf(q) !== turn) pushMove(out, from, to, q, 0, FLAG_NONE);
          break;
        }
        pushMove(out, from, to, 0, 0, FLAG_NONE);
        nf += dirs[d][0];
        nr += dirs[d][1];
      }
    }
  }

  function genCastle(state, out) {
    var b = state.board;
    var turn = state.turn;
    var opp = 1 - turn;
    var home = turn === WHITE ? 60 : 4;
    if (b[home] !== piece(KING, turn)) return;

    var kBit = turn === WHITE ? CASTLE_WK : CASTLE_BK;
    if ((state.castling & kBit) &&
        !isAttacked(b, home, opp) &&
        b[home + 1] === EMPTY && b[home + 2] === EMPTY &&
        !isAttacked(b, home + 1, opp) && !isAttacked(b, home + 2, opp) &&
        b[home + 3] === piece(ROOK, turn)) {
      pushMove(out, home, home + 2, 0, 0, FLAG_CASTLE_K);
    }

    var qBit = turn === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if ((state.castling & qBit) &&
        !isAttacked(b, home, opp) &&
        b[home - 1] === EMPTY && b[home - 2] === EMPTY && b[home - 3] === EMPTY &&
        !isAttacked(b, home - 1, opp) && !isAttacked(b, home - 2, opp) &&
        b[home - 4] === piece(ROOK, turn)) {
      pushMove(out, home, home - 2, 0, 0, FLAG_CASTLE_Q);
    }
  }

  function generateMoves(state) {
    var b = state.board;
    var turn = state.turn;
    var out = [];

    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p || colorOf(p) !== turn) continue;
      var t = typeOf(p);
      if (t === PAWN) genPawn(b, state, i, turn, out);
      else if (t === KNIGHT || t === KING) genStep(b, i, turn, t, out);
      else genSlide(b, i, turn, t, out);
    }

    genCastle(state, out);

    for (var k = 0; k < out.length; k++) out[k].piece = b[out[k].from];
    return out;
  }

  /* ---------- making moves ---------- */

  function makeMove(state, m) {
    var b = state.board.slice();
    var turn = state.turn;
    var castling = state.castling;
    var ep = -1;
    var p = b[m.from];
    var t = typeOf(p);

    b[m.to] = m.promo ? piece(m.promo, turn) : p;
    b[m.from] = EMPTY;

    if (m.flag === FLAG_EP) {
      b[turn === WHITE ? m.to + 8 : m.to - 8] = EMPTY;
    } else if (m.flag === FLAG_CASTLE_K) {
      b[m.to - 1] = b[m.to + 1];
      b[m.to + 1] = EMPTY;
    } else if (m.flag === FLAG_CASTLE_Q) {
      b[m.to + 1] = b[m.to - 2];
      b[m.to - 2] = EMPTY;
    }

    if (t === KING) castling &= turn === WHITE ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ);
    if (m.from === 63 || m.to === 63) castling &= ~CASTLE_WK;
    if (m.from === 56 || m.to === 56) castling &= ~CASTLE_WQ;
    if (m.from === 7 || m.to === 7) castling &= ~CASTLE_BK;
    if (m.from === 0 || m.to === 0) castling &= ~CASTLE_BQ;
    castling &= 15;

    if (t === PAWN && m.flag === FLAG_DOUBLE) ep = (m.from + m.to) >> 1;

    var next = {
      board: b,
      turn: 1 - turn,
      castling: castling,
      ep: ep,
      halfmove: (t === PAWN || m.captured) ? 0 : state.halfmove + 1,
      fullmove: state.fullmove + (turn === BLACK ? 1 : 0)
    };

    if (state.hash !== undefined) {
      var h = state.hash ^ HASH_SIDE;
      h ^= HASH_CASTLE[state.castling] ^ HASH_CASTLE[castling];
      h ^= HASH_EP[state.ep + 1] ^ HASH_EP[ep + 1];
      h ^= HASH_PIECE[m.from * 16 + p];
      h ^= HASH_PIECE[m.to * 16 + (m.promo ? piece(m.promo, turn) : p)];
      if (m.captured) {
        if (m.flag === FLAG_EP) {
          h ^= HASH_PIECE[(turn === WHITE ? m.to + 8 : m.to - 8) * 16 + m.captured];
        } else {
          h ^= HASH_PIECE[m.to * 16 + m.captured];
        }
      }
      if (m.flag === FLAG_CASTLE_K) {
        h ^= HASH_PIECE[(m.to + 1) * 16 + piece(ROOK, turn)] ^
             HASH_PIECE[(m.to - 1) * 16 + piece(ROOK, turn)];
      } else if (m.flag === FLAG_CASTLE_Q) {
        h ^= HASH_PIECE[(m.to - 2) * 16 + piece(ROOK, turn)] ^
             HASH_PIECE[(m.to + 1) * 16 + piece(ROOK, turn)];
      }
      next.hash = h | 0;
    }
    return next;
  }

  function kingSquare(board, color) {
    var k = piece(KING, color);
    for (var i = 0; i < 64; i++) if (board[i] === k) return i;
    return -1;
  }

  function inCheck(state, color) {
    var ks = kingSquare(state.board, color);
    if (ks < 0) return false;
    return isAttacked(state.board, ks, 1 - color);
  }

  /* pseudo-legal moves paired with the state each one produces */
  function legalPairs(state) {
    var pseudo = generateMoves(state);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var next = makeMove(state, pseudo[i]);
      if (!inCheck(next, state.turn)) out.push({ m: pseudo[i], s: next });
    }
    return out;
  }

  function legalMoves(state) {
    return legalPairs(state).map(function (x) { return x.m; });
  }

  /* ---------- position helpers ---------- */

  function positionKey(state) {
    var s = '';
    for (var i = 0; i < 64; i++) s += state.board[i];
    return s + '|' + state.turn + '|' + state.castling + '|' + state.ep;
  }

  function computeHash(state) {
    var h = 0;
    for (var i = 0; i < 64; i++) {
      var p = state.board[i];
      if (p) h ^= HASH_PIECE[i * 16 + p];
    }
    if (state.turn === BLACK) h ^= HASH_SIDE;
    h ^= HASH_CASTLE[state.castling];
    h ^= HASH_EP[state.ep + 1];
    return h | 0;
  }

  /* Repetition key for the position; computed once and then kept up to date
     incrementally by makeMove. Returns a 32-bit int (collisions are rare
     enough to only ever matter inside the search, never for the actual
     game result, which uses positionKey's exact strings). */
  function positionHash(state) {
    if (state.hash === undefined) state.hash = computeHash(state);
    return state.hash;
  }

  function insufficientMaterial(board) {
    var minors = 0;
    var bishops = 0;
    var squareColor = -1;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (!p) continue;
      var t = typeOf(p);
      if (t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) {
        /* a lone knight draws; a knight plus anything else never does */
        if (minors > 1) return false;
        bishops = -1;
      } else {
        var c = (((i / 8) | 0) + (i & 7)) & 1;
        if (squareColor < 0) squareColor = c;
        else if (c !== squareColor) return false;
        bishops++;
      }
    }
    if (minors === 0) return true;
    if (bishops === -1) return minors === 1;
    return bishops > 0 && minors === bishops;
  }

  /* ---------- game status ---------- */

  function status(state) {
    var moves = legalMoves(state);
    var check = inCheck(state, state.turn);

    if (moves.length === 0) {
      if (check) {
        return {
          over: true, check: true, moves: moves,
          result: state.turn === WHITE ? 'black' : 'white',
          reason: 'checkmate'
        };
      }
      return { over: true, check: false, moves: moves, result: 'draw', reason: 'stalemate' };
    }
    if (state.halfmove >= 100) {
      return { over: true, check: check, moves: moves, result: 'draw', reason: 'fifty' };
    }
    if (insufficientMaterial(state.board)) {
      return { over: true, check: check, moves: moves, result: 'draw', reason: 'material' };
    }
    return { over: false, check: check, moves: moves, result: null, reason: null };
  }

  /* ---------- SAN notation ---------- */

  function moveToSan(state, move, legal) {
    var type = typeOf(state.board[move.from]);
    var base;

    if (move.flag === FLAG_CASTLE_K) {
      base = 'O-O';
    } else if (move.flag === FLAG_CASTLE_Q) {
      base = 'O-O-O';
    } else if (type === PAWN) {
      base = (move.captured ? FILES[move.from & 7] + 'x' : '') + squareName(move.to);
      if (move.promo) base += '=' + LETTER[move.promo];
    } else {
      var file = FILES[move.from & 7];
      var rank = 8 - ((move.from / 8) | 0);
      var clash = (legal || []).filter(function (m) {
        return m.from !== move.from && m.to === move.to &&
               typeOf(state.board[m.from]) === type;
      });
      var dis = '';
      if (clash.length) {
        var sameFile = clash.some(function (m) { return (m.from & 7) === (move.from & 7); });
        var sameRank = clash.some(function (m) { return ((m.from / 8) | 0) === ((move.from / 8) | 0); });
        if (!sameFile) dis = file;
        else if (!sameRank) dis = String(rank);
        else dis = file + rank;
      }
      base = LETTER[type] + dis + (move.captured ? 'x' : '') + squareName(move.to);
    }

    var next = makeMove(state, move);
    if (inCheck(next, next.turn)) base += legalMoves(next).length ? '+' : '#';
    return base;
  }

  /* ---------- setup ---------- */

  function createGame() {
    var b = new Int8Array(64);
    var back = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
    for (var f = 0; f < 8; f++) {
      b[f] = piece(back[f], BLACK);
      b[8 + f] = piece(PAWN, BLACK);
      b[48 + f] = piece(PAWN, WHITE);
      b[56 + f] = piece(back[f], WHITE);
    }
    return { board: b, turn: WHITE, castling: 15, ep: -1, halfmove: 0, fullmove: 1 };
  }

  function fromFen(fen) {
    var parts = String(fen).trim().split(/\s+/);
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('invalid FEN rank count');

    var board = new Int8Array(64);
    for (var r = 0; r < 8; r++) {
      var f = 0;
      for (var k = 0; k < rows[r].length; k++) {
        var ch = rows[r][k];
        if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
        var color = ch === ch.toUpperCase() ? WHITE : BLACK;
        var type = 'pnbrqk'.indexOf(ch.toLowerCase());
        if (type < 0 || f > 7) throw new Error('invalid FEN piece: ' + ch);
        board[r * 8 + f] = (type + 1) | (color << 3);
        f++;
      }
      if (f !== 8) throw new Error('invalid FEN rank ' + (r + 1));
    }

    var castling = 0;
    var c = parts[2] || '-';
    if (c.indexOf('K') >= 0) castling |= CASTLE_WK;
    if (c.indexOf('Q') >= 0) castling |= CASTLE_WQ;
    if (c.indexOf('k') >= 0) castling |= CASTLE_BK;
    if (c.indexOf('q') >= 0) castling |= CASTLE_BQ;

    return {
      board: board,
      turn: parts[1] === 'b' ? BLACK : WHITE,
      castling: castling,
      ep: (parts[3] && parts[3] !== '-') ? squareIndex(parts[3]) : -1,
      halfmove: Number(parts[4] || 0),
      fullmove: Number(parts[5] || 1)
    };
  }

  function toFen(state) {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var row = '';
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = state.board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        var ch = 'pnbrqk'[typeOf(p) - 1];
        row += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    var c = '';
    if (state.castling & CASTLE_WK) c += 'K';
    if (state.castling & CASTLE_WQ) c += 'Q';
    if (state.castling & CASTLE_BK) c += 'k';
    if (state.castling & CASTLE_BQ) c += 'q';
    return rows.join('/') + ' ' + (state.turn === WHITE ? 'w' : 'b') + ' ' +
      (c || '-') + ' ' + (state.ep >= 0 ? squareName(state.ep) : '-') + ' ' +
      state.halfmove + ' ' + state.fullmove;
  }

  /* pieces each side has lost, strongest first */
  function captured(board) {
    var start = [0, 8, 2, 2, 2, 1, 0];
    var have = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p) have[colorOf(p)][typeOf(p)]++;
    }
    function lost(color) {
      var list = [];
      for (var t = QUEEN; t >= PAWN; t--) {
        var n = start[t] - have[color][t];
        for (var k = 0; k < n; k++) list.push(t);
      }
      return list;
    }
    return { white: lost(WHITE), black: lost(BLACK) };
  }

  /* ---------- evaluation ---------- */

  /* scratch for evaluate — it runs sequentially, never re-entrant */
  var _pawnCount = new Int8Array(16);   /* [color * 8 + file] */
  var _rookCount = new Int8Array(16);
  var _wMaxRow = new Int8Array(8);      /* most advanced white pawn per file */
  var _bMinRow = new Int8Array(8);      /* most advanced black pawn per file */
  var PASSED_BONUS = [0, 6, 12, 24, 48, 90];

  function evaluate(state) {
    var b = state.board;
    var score = 0;
    var phase = 0;
    var wB = 0, bB = 0;
    var wKing = -1, bKing = -1;
    var z, i, p, t, c;

    for (z = 0; z < 16; z++) { _pawnCount[z] = 0; _rookCount[z] = 0; }
    for (z = 0; z < 8; z++) { _wMaxRow[z] = -1; _bMinRow[z] = 8; }

    for (i = 0; i < 64; i++) {
      p = b[i];
      if (!p) continue;
      t = p & 7;
      c = p >> 3;
      var v = VAL[t] + PST[t][c === WHITE ? i : mirrorIndex(i)];

      if (t === KING) {
        if (c === WHITE) wKing = i; else bKing = i;
      } else {
        phase += PHASE[t];
        if (t === BISHOP) { if (c === WHITE) wB++; else bB++; }
        var f = i & 7;
        var row = (i / 8) | 0;
        if (t === PAWN) {
          _pawnCount[c * 8 + f]++;
          if (c === WHITE) { if (row > _wMaxRow[f]) _wMaxRow[f] = row; }
          else { if (row < _bMinRow[f]) _bMinRow[f] = row; }
        } else if (t === ROOK) {
          _rookCount[c * 8 + f]++;
        }
      }

      if (c === WHITE) score += v; else score -= v;
    }

    /* pawn structure and rook placement */
    for (c = 0; c < 2; c++) {
      var sgn = c === WHITE ? 1 : -1;
      for (var f = 0; f < 8; f++) {
        var n = _pawnCount[c * 8 + f];
        if (n > 1) score -= sgn * 12 * (n - 1);                  /* doubled */
        if (n > 0) {
          var adj = (f > 0 ? _pawnCount[c * 8 + f - 1] : 0) +
                    (f < 7 ? _pawnCount[c * 8 + f + 1] : 0);
          if (adj === 0) score -= sgn * 14 * n;                  /* isolated */
        }
        if (_rookCount[c * 8 + f] && n === 0) {
          score += sgn * (_pawnCount[(1 - c) * 8 + f] === 0 ? 18 : 9);  /* open / half-open */
        }
      }
    }

    /* passed pawns: no enemy pawn on this or an adjacent file ahead of it */
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (!p || (p & 7) !== PAWN) continue;
      c = p >> 3;
      var pr = (i / 8) | 0;
      var adv = c === WHITE ? (6 - pr) : (pr - 1);
      if (adv < 0 || adv > 5) continue;
      var f0 = i & 7;
      var passed = true;
      for (var df = -1; df <= 1 && passed; df++) {
        var ff = f0 + df;
        if (ff < 0 || ff > 7) continue;
        if (c === WHITE) { if (_bMinRow[ff] < pr) passed = false; }
        else { if (_wMaxRow[ff] > pr) passed = false; }
      }
      if (passed) score += (c === WHITE ? 1 : -1) * PASSED_BONUS[adv];
    }

    if (phase > PHASE_MAX) phase = PHASE_MAX;
    if (wKing >= 0) {
      var wm = PST_KING_MG[wKing];
      score += (phase * wm + (PHASE_MAX - phase) * PST_KING_EG[wKing]) / PHASE_MAX - wm;
    }
    if (bKing >= 0) {
      var bi = mirrorIndex(bKing);
      var bm = PST_KING_MG[bi];
      score -= (phase * bm + (PHASE_MAX - phase) * PST_KING_EG[bi]) / PHASE_MAX - bm;
    }

    if (wB >= 2) score += 30;
    if (bB >= 2) score -= 30;

    return state.turn === WHITE ? score : -score;
  }

  /* ---------- search ---------- */

  /* Captures and promotions first (MVV-LVA), then killer moves from this
     ply, then the history heuristic — this is what lets a fixed budget
     actually see a meaningful number of plies. */
  function orderScore(m, ply, ctx) {
    var s = 0;
    if (m.captured) s = 10100 + 10 * VAL[typeOf(m.captured)] - VAL[typeOf(m.piece)];
    if (m.promo) s += (m.captured ? 0 : 8000) + VAL[m.promo];
    if (m.flag === FLAG_CASTLE_K || m.flag === FLAG_CASTLE_Q) s += 50;
    if (!m.captured) {
      var enc = m.from * 64 + m.to;
      if (ply < 128 && (ctx.killers[ply * 2] === enc || ctx.killers[ply * 2 + 1] === enc)) s += 6000;
      var hv = ctx.heur[enc];
      if (hv > 3800) hv = 3800;
      s += hv;
    }
    return s;
  }

  function sortPairs(pairs, ply, ctx) {
    for (var i = 0; i < pairs.length; i++) pairs[i].order = orderScore(pairs[i].m, ply, ctx);
    pairs.sort(function (a, b) { return b.order - a.order; });
    return pairs;
  }

  function tick(ctx) {
    if ((ctx.nodes++ & 1023) === 0 && Date.now() > ctx.deadline) ctx.aborted = true;
    return ctx.aborted;
  }

  /* value of a draw seen from the side to move at `ply`;
     ctx.draw is the root side's opinion of a draw (contempt) */
  function drawScore(ctx, ply) {
    return (ply & 1) ? -ctx.draw : ctx.draw;
  }

  function isRepeated(state, ctx) {
    var h = state.hash;
    if (h === undefined) return false;
    return ctx.seen.has(h) || ctx.path.indexOf(h) >= 0;
  }

  function recordCutoff(ctx, pairs, i, ply, depth) {
    var m = pairs[i].m;
    var enc = m.from * 64 + m.to;
    if (ply < 128 && !m.captured) {
      var k = ply * 2;
      if (ctx.killers[k] !== enc) {
        ctx.killers[k + 1] = ctx.killers[k];
        ctx.killers[k] = enc;
      }
    }
    var bump = depth * depth;
    for (var j = 0; j <= i; j++) {
      var mm = pairs[j].m;
      var e = mm.from * 64 + mm.to;
      ctx.heur[e] += bump;
      if (ctx.heur[e] > 4000) ctx.heur[e] = 4000;
    }
  }

  function search(state, depth, alpha, beta, ply, ctx) {
    if (tick(ctx)) return 0;

    var check = inCheck(state, state.turn);

    /* repetition against the game history or this very line: a side that is
       ahead avoids it (draw below), a side that is behind steers into it */
    if (state.halfmove >= 4 && isRepeated(state, ctx)) return drawScore(ctx, ply);

    ctx.path.push(state.hash);
    var pairs = sortPairs(legalPairs(state), ply, ctx);

    var result;
    if (pairs.length === 0) {
      /* checkmate or stalemate decides before any draw claim can */
      result = check ? -(MATE - ply) : drawScore(ctx, ply);
    } else if (state.halfmove >= 100) {
      result = drawScore(ctx, ply);
    } else {
      /* checks are searched one ply deeper so tactics do not drop off the
         horizon; the ply cap keeps perpetual-check chains from running away */
      if (check && ply < 12) depth++;

      if (depth <= 0) {
        result = quiesce(state, pairs, check, alpha, beta, ply, 0, ctx);
      } else {
        var best = -Infinity;
        for (var i = 0; i < pairs.length; i++) {
          var score = -search(pairs[i].s, depth - 1, -beta, -alpha, ply + 1, ctx);
          if (ctx.aborted) break;
          if (score > best) best = score;
          if (best > alpha) alpha = best;
          if (alpha >= beta) { recordCutoff(ctx, pairs, i, ply, depth); break; }
        }
        result = ctx.aborted ? 0 : best;
      }
    }
    ctx.path.pop();
    return result;
  }

  function quiesce(state, pairs, check, alpha, beta, ply, qply, ctx) {
    if (tick(ctx)) return 0;

    var stand = evaluate(state);
    if (!check) {
      /* standing pat is only legal when not in check — otherwise the king
         must move and the static score is not an option at all */
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qply >= 4) return alpha;
    }
    /* hard bound; stand (finite) rather than alpha, which may still be
       the untouched -Infinity of an outer null window */
    if (qply >= 8) return check ? stand : alpha;

    var caps = [];
    for (var i = 0; i < pairs.length; i++) {
      var m = pairs[i].m;
      if (check || m.captured || m.promo) caps.push(pairs[i]);
    }
    if (caps.length === 0) return check ? stand : alpha;
    caps.sort(function (a, b) { return b.order - a.order; });

    var best = check ? -Infinity : stand;
    for (var k = 0; k < caps.length; k++) {
      var s = caps[k].s;
      var child = sortPairs(legalPairs(s), ply + 1, ctx);
      var score;
      if (child.length === 0) {
        /* nobody can move: a capture just delivered mate (wonderful for the
           mover) or it is stalemate (a draw, scored with the contempt) */
        score = inCheck(s, s.turn) ? (MATE - ply - 1) : drawScore(ctx, ply + 1);
      } else {
        score = -quiesce(s, child, inCheck(s, s.turn), -beta, -alpha, ply + 1, qply + 1, ctx);
      }
      if (ctx.aborted) return 0;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /* ---------- choosing a move ---------- */

  var LEVELS = {
    easy:   { depth: 1, budget: 300,  random: 0.45, slack: 140, contempt: 0 },
    normal: { depth: 3, budget: 800,  random: 0,    slack: 25,  contempt: 25 },
    hard:   { depth: 5, budget: 1500, random: 0,    slack: 5,   contempt: 45 }
  };

  function levelConfig(level) {
    var cfg = LEVELS[level];
    if (!cfg) return null;
    var copy = {};
    for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) copy[k] = cfg[k];
    return copy;
  }

  function configureLevel(level, patch) {
    var cfg = LEVELS[level];
    if (!cfg || !patch) return;
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(cfg, k)) cfg[k] = patch[k];
    }
  }

  /* history: position hashes of the game so far (the current position is
     added automatically). Used to value repetition inside the search. */
  function chooseMove(state, level, history) {
    var cfg = LEVELS[level] || LEVELS.normal;
    var pairs = legalPairs(state);
    if (pairs.length === 0) return null;
    if (pairs.length === 1) return pairs[0].m;

    if (cfg.random > 0 && Math.random() < cfg.random) {
      return pairs[(Math.random() * pairs.length) | 0].m;
    }

    positionHash(state);

    var ctx = {
      nodes: 0, deadline: 0, aborted: false,
      draw: 0,
      seen: new Set(history || []),
      path: [],
      killers: new Int32Array(256).fill(-1),
      heur: new Int32Array(4096)
    };
    ctx.seen.add(state.hash);

    /* one deadline for the whole search; depth 1 is always allowed to finish
       so there is always a fallback answer */
    var totalDeadline = Date.now() + cfg.budget;
    var results = null;
    var i, score;

    /* contempt: when clearly ahead a draw is bad news, when clearly behind
       it is a rescue — updated after every completed iteration */
    var e0 = evaluate(state);
    ctx.draw = e0 > 120 ? -cfg.contempt : (e0 < -120 ? cfg.contempt : 0);

    sortPairs(pairs, 0, ctx);

    for (var depth = 1; depth <= cfg.depth; depth++) {
      ctx.deadline = depth === 1 ? Infinity : totalDeadline;
      ctx.aborted = false;
      ctx.nodes = 0;

      var alpha = -Infinity;
      var iteration = [];
      var localBest = -Infinity;
      var best = null;

      for (i = 0; i < pairs.length; i++) pairs[i].done = false;

      for (i = 0; i < pairs.length; i++) {
        /* A child cut off by the window only produces a bound, not the
           move's real value, so those scores must not enter the pool —
           otherwise the near-best tie-break picks hopeless moves. */
        var bound = alpha;
        score = -search(pairs[i].s, depth - 1, -Infinity, -alpha, 1, ctx);
        if (ctx.aborted) break;
        if (score > bound) {
          iteration.push({ m: pairs[i].m, score: score });
          pairs[i].done = true;
          alpha = score;
          localBest = score;
          best = pairs[i].m;
        }
      }

      if (ctx.aborted || !best) break;

      /* Second pass: fail-low moves are worth probing when they could still
         land within `slack` of the top — that is the pool easy/normal draw
         their variety from, and it used to be almost always a single move. */
      if (cfg.slack > 0) {
        var cut = alpha - cfg.slack;
        for (i = 0; i < pairs.length; i++) {
          if (pairs[i].done) continue;
          score = -search(pairs[i].s, depth - 1, -Infinity, -(cut - 0.001), 1, ctx);
          if (ctx.aborted) break;
          if (score > cut - 0.001) {
            iteration.push({ m: pairs[i].m, score: score });
            pairs[i].done = true;
          }
        }
      }

      results = iteration;
      if (Math.abs(localBest) >= MATE - 100) break;   /* forced mate found */

      ctx.draw = localBest > 150 ? -cfg.contempt : (localBest < -150 ? cfg.contempt : 0);

      /* re-order for the next iteration */
      pairs.sort(function (a, b) {
        return scoreOf(iteration, b.m) - scoreOf(iteration, a.m);
      });
    }

    if (!results) return pairs[0].m;

    results.sort(function (a, b) { return b.score - a.score; });
    var top = results[0].score;
    var pool = results.filter(function (r) { return r.score >= top - cfg.slack; });
    return pool[(Math.random() * pool.length) | 0].m;
  }

  function scoreOf(iteration, m) {
    for (var i = 0; i < iteration.length; i++) {
      var e = iteration[i].m;
      if (e.from === m.from && e.to === m.to && e.promo === m.promo) return iteration[i].score;
    }
    return -Infinity;
  }

  /* ---------- perft (move-generation verification) ---------- */

  function perft(state, depth) {
    if (depth <= 0) return 1;
    var pairs = legalPairs(state);
    if (depth === 1) return pairs.length;
    var total = 0;
    for (var i = 0; i < pairs.length; i++) total += perft(pairs[i].s, depth - 1);
    return total;
  }

  var api = {
    EMPTY: EMPTY,
    PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    WHITE: WHITE, BLACK: BLACK,
    FLAG_NONE: FLAG_NONE, FLAG_DOUBLE: FLAG_DOUBLE, FLAG_EP: FLAG_EP,
    FLAG_CASTLE_K: FLAG_CASTLE_K, FLAG_CASTLE_Q: FLAG_CASTLE_Q,
    LETTER: LETTER,
    colorOf: colorOf,
    typeOf: typeOf,
    piece: piece,
    squareName: squareName,
    squareIndex: squareIndex,
    describe: describe,
    isAttacked: isAttacked,
    kingSquare: kingSquare,
    generateMoves: generateMoves,
    makeMove: makeMove,
    inCheck: inCheck,
    legalMoves: legalMoves,
    status: status,
    moveToSan: moveToSan,
    createGame: createGame,
    fromFen: fromFen,
    toFen: toFen,
    positionKey: positionKey,
    positionHash: positionHash,
    insufficientMaterial: insufficientMaterial,
    captured: captured,
    evaluate: evaluate,
    chooseMove: chooseMove,
    levelConfig: levelConfig,
    configureLevel: configureLevel,
    perft: perft
  };

  /* Loaded inside a Worker (the UI does this so a long think never freezes
     the board): answer move requests instead of exporting to a global. */
  if (typeof importScripts === 'function' && typeof self !== 'undefined') {
    self.onmessage = function (e) {
      var d = e.data || {};
      if (d.type !== 'move') return;
      var move = null;
      try {
        move = chooseMove(fromFen(d.fen), d.level, d.history);
      } catch (err) { move = null; }
      self.postMessage({ type: 'move', seq: d.seq, kind: d.kind, move: move });
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Chess = api;
})(typeof window !== 'undefined' ? window : globalThis);
