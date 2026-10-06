'use strict';
/* Sanity tests for game.js — run with: node test.js */

/* Deterministic RNG: the AI's tie-breaks and the full-game section use
   Math.random, and a flaky suite is worse than no suite. */
(function seedRandom() {
  let a = 0x9e3779b9 | 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const path = require('path');
const C = require(path.join(__dirname, 'game.js'));

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log('  ok  ' + label);
  } else {
    failures++;
    console.log('FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  }
}

const moveBy = (state, from, to, promo) =>
  C.legalMoves(state).find(m =>
    C.squareName(m.from) === from && C.squareName(m.to) === to &&
    (promo ? C.LETTER[m.promo] === promo : !m.promo));

const play = (state, ...coords) => {
  let s = state;
  for (const c of coords) {
    const from = c.slice(0, 2);
    const to = c.slice(2, 4);
    const promo = c[4];
    const m = moveBy(s, from, to, promo);
    if (!m) throw new Error('illegal in test line: ' + c + ' @ ' + C.toFen(s));
    s = C.makeMove(s, m);
  }
  return s;
};

/* SAN for a move, or a loud placeholder so a bad expectation reports instead of crashing */
const sanOf = (state, from, to, promo) => {
  const m = moveBy(state, from, to, promo);
  if (!m) return '<no move ' + from + to + (promo || '') + ' @ ' + C.toFen(state) + '>';
  return C.moveToSan(state, m, C.legalMoves(state));
};

/* ================= 1. initial position ================= */
console.log('\n[initial position]');
const start = C.createGame();
check('white to move', start.turn === C.WHITE);
check('full castling rights', start.castling === 15);
check('start FEN round-trips',
  C.toFen(start) === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  C.toFen(start));
check('white has 20 opening moves', C.legalMoves(start).length === 20,
  C.legalMoves(start).length);
check('no check at start', C.status(start).over === false && C.status(start).check === false);

/* ================= 2. perft ================= */
console.log('\n[perft: move generation vs known values]');

const PERFT_CASES = [
  {
    name: 'start position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depths: [1, 2, 3, 4],
    expect: [20, 400, 8902, 197281]
  },
  {
    name: 'Kiwipete (castling / pins / ep)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depths: [1, 2, 3],
    expect: [48, 2039, 97862]
  },
  {
    name: 'position 3 (ep pins, illegal ep)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depths: [1, 2, 3, 4],
    expect: [14, 191, 2812, 43238]
  },
  {
    name: 'position 4 (promotions, checks)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    depths: [1, 2, 3],
    expect: [6, 264, 9467]
  },
  {
    name: 'position 5 (promotions, castling)',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    depths: [1, 2, 3],
    expect: [44, 1486, 62379]
  }
];

for (const c of PERFT_CASES) {
  const st = C.fromFen(c.fen);
  const t0 = Date.now();
  const got = c.depths.map(d => C.perft(st, d));
  const ms = Date.now() - t0;
  check(c.name + ' ' + got.join('/') + ' (' + ms + 'ms)',
    JSON.stringify(got) === JSON.stringify(c.expect), { got, expect: c.expect });
}

/* FEN round-trip for every perft position */
for (const c of PERFT_CASES) {
  check('FEN round-trip: ' + c.name, C.toFen(C.fromFen(c.fen)) === c.fen, C.toFen(C.fromFen(c.fen)));
}

/* incremental hash must agree with a fresh computation after every kind of move */
{
  let bad = null;
  const walks = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'
  ];
  for (const fen of walks) {
    let hs = C.fromFen(fen);
    C.positionHash(hs);
    for (let i = 0; i < 200 && !bad; i++) {
      const ms = C.legalMoves(hs);
      if (!ms.length) break;
      hs = C.makeMove(hs, ms[(Math.random() * ms.length) | 0]);
      const fresh = C.positionHash(C.fromFen(C.toFen(hs)));
      if (C.positionHash(hs) !== fresh) bad = { fen: C.toFen(hs) };
    }
  }
  check('incremental position hash matches a fresh computation', !bad, bad);
}

/* ================= 3. special moves ================= */
console.log('\n[special moves]');

/* castling both sides, both colours */
let s = C.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
check('white can castle both ways',
  !!moveBy(s, 'e1', 'g1') && !!moveBy(s, 'e1', 'c1'));
s = C.fromFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
check('black can castle both ways',
  !!moveBy(s, 'e8', 'g8') && !!moveBy(s, 'e8', 'c8'));

/* castling is illegal while the king is in check (queen on the e-file) */
s = C.fromFen('r3k2r/8/8/8/8/4q3/8/R3K2R w KQkq - 0 1');
check('no castling out of check', !moveBy(s, 'e1', 'g1') && !moveBy(s, 'e1', 'c1'),
  C.legalMoves(s).filter(m => m.from === 60).map(m => C.squareName(m.to)));

/* castling through an attacked square (queen on a6 hits f1 only) */
s = C.fromFen('r3k2r/8/q7/8/8/8/8/R3K2R w KQkq - 0 1');
check('no castling through check', !moveBy(s, 'e1', 'g1'));
check('queen-side castle still ok', !!moveBy(s, 'e1', 'c1'));
check('white is not actually in check', C.inCheck(s, C.WHITE) === false);

/* rook captured => rights lost */
s = C.fromFen('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1');
s = play(s, 'g2h1');
check('capturing the rook removes white O-O rights', !moveBy(s, 'e1', 'g1'));

/* en passant, black taking */
s = C.fromFen('rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
s = play(s, 'e2e4');                       /* black's d4 pawn may now take e3 */
let ep = moveBy(s, 'd4', 'e3');
check('black may capture en passant', !!ep && ep.flag === C.FLAG_EP, C.toFen(s));
s = C.makeMove(s, ep);
check('captured pawn removed from e4', s.board[C.squareIndex('e4')] === 0, C.toFen(s));
check('capturer landed on e3', C.typeOf(s.board[C.squareIndex('e3')]) === C.PAWN, C.toFen(s));

/* en passant, white taking */
s = C.fromFen('rnbqkbnr/ppp2ppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
ep = moveBy(s, 'e5', 'd6');
check('white may capture en passant', !!ep && ep.flag === C.FLAG_EP, C.toFen(s));
s = C.makeMove(s, ep);
check('captured pawn removed from d5', s.board[C.squareIndex('d5')] === 0, C.toFen(s));

/* ep is only available for one ply */
s = C.fromFen('rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
s = play(s, 'e2e4');
check('ep target recorded', s.ep === C.squareIndex('e3'), s.ep);
s = play(s, 'a7a6');                       /* declining clears the target */
check('ep target expires', s.ep === -1, s.ep);

/* a pinned pawn cannot take en passant (would expose the king) */
s = C.fromFen('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
check('illegal ep rejected (pinned)', !moveBy(s, 'e5', 'd6'), C.toFen(s));

/* promotion, all four pieces */
s = C.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
for (const p of ['Q', 'R', 'B', 'N']) {
  check('promotion to ' + p, !!moveBy(s, 'a7', 'a8', p));
}
const promoted = C.makeMove(s, moveBy(s, 'a7', 'a8', 'N'));
check('knight promotion lands as a knight',
  C.typeOf(promoted.board[C.squareIndex('a8')]) === C.KNIGHT, C.toFen(promoted));
check('underpromotion is not auto-queened', C.toFen(promoted).startsWith('N7/7k'), C.toFen(promoted));

/* ================= 4. check, checkmate, stalemate, draws ================= */
console.log('\n[status]');

/* fool's mate */
s = play(C.createGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
let st = C.status(s);
check("fool's mate is checkmate", st.over && st.reason === 'checkmate' && st.result === 'black',
  st.reason);
check('mating side is black', st.result === 'black');

/* scholar's mate */
s = play(C.createGame(), 'e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7');
st = C.status(s);
check("scholar's mate is checkmate", st.over && st.reason === 'checkmate' && st.result === 'white',
  { reason: st.reason, fen: C.toFen(s) });

/* stalemate */
s = C.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
st = C.status(s);
check('stalemate detected', st.over && st.reason === 'stalemate' && st.result === 'draw', st.reason);
check('stalemate side is not in check', st.check === false);

/* check with legal replies is not game over */
s = C.fromFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
st = C.status(s);
check('plain check continues', !st.over && st.check === true,
  { over: st.over, check: st.check, moves: st.moves.length });

/* the 50-move rule */
s = C.fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
s = play(s, 'a1a2');
st = C.status(s);
check('fifty-move draw', st.over && st.result === 'draw' && st.reason === 'fifty', st.reason);

/* insufficient material */
for (const [fen, label] of [
  ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'K vs K'],
  ['4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', 'KN vs K'],
  ['4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'KB vs K'],
  ['4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1', 'KB vs KB same colour']
]) {
  st = C.status(C.fromFen(fen));
  check('draw by material: ' + label, st.over && st.reason === 'material', st.reason);
}
st = C.status(C.fromFen('4k3/8/8/8/8/8/8/1N2KB2 w - - 0 1'));
check('KN vs KB is NOT a material draw', !st.over, st.reason);
st = C.status(C.fromFen('4k3/8/8/8/8/8/8/2R1K3 w - - 0 1'));
check('KR vs K is NOT a material draw', !st.over, st.reason);

/* ================= 5. SAN notation ================= */
console.log('\n[SAN]');
s = C.createGame();
check('Nf3', sanOf(s, 'g1', 'f3') === 'Nf3', sanOf(s, 'g1', 'f3'));
s = play(s, 'g1f3');
check('d5 (black reply needs no piece letter)', sanOf(s, 'd7', 'd5') === 'd5', sanOf(s, 'd7', 'd5'));

/* pawn capture keeps the originating file */
s = C.fromFen('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1');
check('exd5', sanOf(s, 'e4', 'd5') === 'exd5', sanOf(s, 'e4', 'd5'));

/* disambiguation by file: rooks on a2 and h2 can both reach d2 */
s = C.fromFen('2k5/8/8/8/8/8/R6R/K7 w - - 0 1');
check('rook disambiguation by file (Rad2)', sanOf(s, 'a2', 'd2') === 'Rad2', sanOf(s, 'a2', 'd2'));
check('rook disambiguation by file (Rhd2)', sanOf(s, 'h2', 'd2') === 'Rhd2', sanOf(s, 'h2', 'd2'));

/* disambiguation by rank: rooks on d8 and d2 can both reach d4 */
s = C.fromFen('3R4/8/8/7k/8/8/3R4/K7 w - - 0 1');
check('rook disambiguation by rank (R8d4)', sanOf(s, 'd8', 'd4') === 'R8d4', sanOf(s, 'd8', 'd4'));
check('rook disambiguation by rank (R2d4)', sanOf(s, 'd2', 'd4') === 'R2d4', sanOf(s, 'd2', 'd4'));

/* full disambiguation: queens on b1, f1 and b5 all reach f5 */
s = C.fromFen('7k/8/8/1Q6/8/8/8/1Q3Q2 w - - 0 1');
check('full disambiguation (Qb1f5)', sanOf(s, 'b1', 'f5') === 'Qb1f5', sanOf(s, 'b1', 'f5'));

s = C.fromFen('6k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
check('castle SAN is O-O', sanOf(s, 'e1', 'g1') === 'O-O', sanOf(s, 'e1', 'g1'));
check('castle SAN is O-O-O', sanOf(s, 'e1', 'c1') === 'O-O-O', sanOf(s, 'e1', 'c1'));

s = C.fromFen('8/P1k5/8/8/8/8/8/K7 w - - 0 1');
check('promotion SAN a8=N+', sanOf(s, 'a7', 'a8', 'N') === 'a8=N+', sanOf(s, 'a7', 'a8', 'N'));

/* stop one ply before the mate so the mating move itself can be notated */
s = play(C.createGame(), 'e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6');
check('mate SAN ends with #', sanOf(s, 'h5', 'f7') === 'Qxf7#', sanOf(s, 'h5', 'f7'));

/* a plain checking move gets a single + */
s = C.fromFen('6k1/8/8/8/8/8/8/R5K1 w - - 0 1');
check('check SAN ends with +', sanOf(s, 'a1', 'a8') === 'Ra8+', sanOf(s, 'a1', 'a8'));

/* ================= 6. AI ================= */
const ORIG = {
  easy: C.levelConfig('easy'),
  normal: C.levelConfig('normal'),
  hard: C.levelConfig('hard')
};
const setLevel = (lv, patch) => C.configureLevel(lv, patch);
const restoreLevels = () => { for (const k of ['easy', 'normal', 'hard']) C.configureLevel(k, ORIG[k]); };

console.log('\n[AI legality]');
/* keep the search cheap here: we only care that the move is legal */
setLevel('easy', { budget: 40 });
setLevel('normal', { budget: 100 });
setLevel('hard', { budget: 180, depth: 4 });

for (const level of ['easy', 'normal', 'hard']) {
  let bad = 0;
  let seen = 0;
  for (let t = 0; t < 16; t++) {
    /* a few random legal moves to reach varied middlegames */
    let s0 = C.createGame();
    for (let k = 0; k < (t % 14); k++) {
      const ms = C.legalMoves(s0);
      if (!ms.length) break;
      s0 = C.makeMove(s0, ms[(Math.random() * ms.length) | 0]);
    }
    const legal = C.legalMoves(s0);
    if (!legal.length) continue;
    seen++;
    const mv = C.chooseMove(s0, level);
    if (!mv || !legal.some(m => m.from === mv.from && m.to === mv.to && m.promo === mv.promo)) bad++;
  }
  check(level + ': only legal moves (' + seen + ' positions)', bad === 0, bad);
}
restoreLevels();

console.log('\n[AI: threat recognition and near-best pool]');

/* Black threatens Qxg2# (queen supported by the b7 bishop). At depth 1 the
   mate is only visible through quiescence — delivered mates used to be
   scored as catastrophic losses there, so the engine walked straight in. */
{
  const s = C.fromFen('7k/1b4q1/8/8/Q7/8/6PP/7K w - - 0 1');
  const orig = C.levelConfig('easy');
  C.configureLevel('easy', { random: 0, depth: 1, budget: 80 });
  const mv = C.chooseMove(s, 'easy');
  C.configureLevel('easy', orig);

  let walked = false;
  let played = null;
  if (mv) {
    played = C.squareName(mv.from) + C.squareName(mv.to);
    const s2 = C.makeMove(s, mv);
    const g7 = C.squareIndex('g7');
    const g2 = C.squareIndex('g2');
    const reply = C.legalMoves(s2).find(m => m.from === g7 && m.to === g2);
    if (reply) walked = C.status(C.makeMove(s2, reply)).reason === 'checkmate';
  }
  check('depth 1 does not walk into a mating capture', !!mv && !walked, { played, walked });
}

/* With a wide slack every legal move qualifies, so repeated calls must fan
   out. The root loop used to drop every fail-low move, which made slack
   almost invisible (only prefix-maxima of the generation order survived). */
{
  const s = C.createGame();
  const orig = C.levelConfig('normal');
  C.configureLevel('normal', { depth: 1, budget: 250, slack: 9000, random: 0, contempt: 0 });
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const mv = C.chooseMove(s, 'normal');
    seen.add(mv.from * 64 + mv.to);
  }
  C.configureLevel('normal', orig);
  check('wide slack fans out over the opening moves (' + seen.size + '/20)',
    seen.size >= 12, seen.size);
}

console.log('\n[AI strength]');
function playMatch(whiteLevel, blackLevel, maxPlies) {
  let s = C.createGame();
  let plies = 0;
  const keys = [C.positionKey(s)];
  const hashes = [C.positionHash(s)];
  while (plies < maxPlies) {
    const st0 = C.status(s);
    if (st0.over) break;
    const key = C.positionKey(s);
    if (keys.filter(k => k === key).length >= 3) break;   /* threefold repetition */
    const level = s.turn === C.WHITE ? whiteLevel : blackLevel;
    const mv = C.chooseMove(s, level, hashes);
    if (!mv) break;
    s = C.makeMove(s, mv);
    keys.push(C.positionKey(s));
    hashes.push(C.positionHash(s));
    plies++;
  }
  const st0 = C.status(s);
  if (!st0.over) return 0;
  if (st0.result === 'draw') return 0;
  return st0.result === 'white' ? 1 : -1;
}

/* cheap settings keep the suite quick while still separating the levels */
setLevel('easy', { budget: 40 });
setLevel('hard', { budget: 150, depth: 4 });

let wins = 0, losses = 0, draws = 0;
for (let g = 0; g < 2; g++) {
  const r = playMatch('hard', 'easy', 160);
  if (r > 0) wins++; else if (r < 0) losses++; else draws++;
}
check('hard (白) vs easy (黒): ' + wins + 'W/' + losses + 'L/' + draws + 'D',
  wins > losses, { wins, losses, draws });

wins = 0; losses = 0; draws = 0;
for (let g = 0; g < 2; g++) {
  const r = playMatch('easy', 'hard', 160);
  if (r > 0) wins++; else if (r < 0) losses++; else draws++;
}
check('easy (白) vs hard (黒): ' + wins + 'W/' + losses + 'L/' + draws + 'D',
  losses > wins, { wins, losses, draws });

wins = 0; losses = 0; draws = 0;
setLevel('easy', { budget: 40, random: 0.7 });
setLevel('normal', { budget: 150, depth: 3 });
for (let g = 0; g < 3; g++) {
  const r = g % 2 ? playMatch('easy', 'normal', 140) : playMatch('normal', 'easy', 140);
  if (r > 0) wins++; else if (r < 0) losses++; else draws++;
}
check('normal beats easy: ' + wins + 'W/' + losses + 'L/' + draws + 'D',
  wins > losses, { wins, losses, draws });
restoreLevels();

/* ================= 7. AI speed ================= */
console.log('\n[timing: per-level move cost (browser-safe budgets)]');
{
  let s = C.createGame();
  for (let i = 0; i < 14; i++) {
    const ms = C.legalMoves(s);
    if (!ms.length) break;
    s = C.makeMove(s, ms[(Math.random() * ms.length) | 0]);
  }
  for (const level of ['easy', 'normal', 'hard']) {
    const a = process.hrtime.bigint();
    C.chooseMove(s, level);
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    const budget = C.levelConfig(level).budget;
    console.log('  ' + level.padEnd(7) + ms.toFixed(0) + ' ms (budget ' + budget + ')');
    check(level + ': respects its ' + budget + 'ms budget', ms < budget + 700, ms);
  }
}

/* ================= 8. full games terminate ================= */
console.log('\n[full games]');
{
  /* random: 0 — this section tests that directed play reaches a terminal
     position; aimless random shuffling (easy's default) can dodge threefold
     while pawn pushes reset the fifty-move clock, which tests nothing. */
  setLevel('easy', { budget: 40, random: 0 });
  setLevel('normal', { budget: 60 });
  setLevel('hard', { budget: 60, depth: 3 });

  let finished = 0;
  let maxPlies = 0;
  let reasons = {};
  for (let g = 0; g < 9; g++) {
    let s = C.createGame();
    let plies = 0;
    const keys = [C.positionKey(s)];
    const hashes = [C.positionHash(s)];
    const sansTail = [];
    let reason = null;
    while (plies < 400) {
      const st0 = C.status(s);
      if (st0.over) { reason = st0.reason; break; }
      const key = C.positionKey(s);
      if (keys.filter(k => k === key).length >= 3) { reason = 'threefold'; break; }
      const level = ['easy', 'normal', 'hard'][g % 3];
      const mv = C.chooseMove(s, level, hashes);
      if (!mv) { reason = 'nomove'; break; }
      sansTail.push(C.moveToSan(s, mv, st0.moves));
      if (sansTail.length > 80) sansTail.shift();
      s = C.makeMove(s, mv);
      keys.push(C.positionKey(s));
      hashes.push(C.positionHash(s));
      plies++;
    }
    if (reason) { finished++; reasons[reason] = (reasons[reason] || 0) + 1; }
    maxPlies = Math.max(maxPlies, plies);
    if (!reason) {
      console.log('  STUCK game ' + g + ' tail: ' + sansTail.join(' '));
      console.log('  fen: ' + C.toFen(s) + '  halfmove=' + s.halfmove);
    }
  }
  restoreLevels();
  check('all 9 games reached a terminal position (longest ' + maxPlies + ' plies)',
    finished === 9, { finished, reasons });
  console.log('  endings: ' + JSON.stringify(reasons));
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' FAILURE(S)');
process.exit(failures ? 1 : 0);
