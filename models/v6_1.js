// Stonefish_v6.1 — Deep, positionally disciplined typed-array chess engine with ARMX 1.1.
// Features:
// - High-speed internal 64-square board with zero-allocation move stacks, Zobrist TT, PVS,
//   Aspiration Windows, Null-Move Pruning, Improving-gated RFP/Futility/LMR, ProbCut,
//   passed-pawn extensions, dynamic contempt, and MVV-LVA + SEE quiescence searching 8-11+ plies.
// - Opponent-adaptive search planning and bounded deep Multi-PV finalist verification via ARMX 1.1.
// - No opening book: strong opening play emerges from piece development, center control,
//   castling discipline, and explicit central-pawn/bishop anti-blockage evaluation.
// - Preserves and reinforces Stonefish's pawn structure strength (doubled, isolated,
//   backward, connected/phalanx, passed pawns & king-passer race).
// - Absolute & relative pin detection + material-aware trade discipline (avoids equal
//   simplifications when behind, converts cleanly when ahead).
// - Decisive bare-king / winning endgame checkmate engine (K+Q, K+R, K+B+N, etc.) with
//   box restriction, opposition, edge/corner drive, stalemate & repetition avoidance.

(function initStonefishV61(globalScope) {
  'use strict';

  const MAX_PLY = 64;
  const MATE_SCORE = 30000;
  const MATE_BOUND = 29000;
  const INF = 32000;
  const TT_SIZE = 1 << 16;
  const TT_MASK = TT_SIZE - 1;

  const KNIGHT_DF = new Int8Array([1, 2, 2, 1, -1, -2, -2, -1]);
  const KNIGHT_DR = new Int8Array([2, 1, -1, -2, -2, -1, 1, 2]);
  const ALL_DF = new Int8Array([1, 1, -1, -1, 1, -1, 0, 0]);
  const ALL_DR = new Int8Array([1, -1, 1, -1, 0, 0, 1, -1]);

  // Piece values: 0=empty, 1=P, 2=N, 3=B, 4=R, 5=Q, 6=K
  const MG_VAL = new Int32Array([0, 100, 320, 335, 505, 975, 20000]);
  const EG_VAL = new Int32Array([0, 110, 310, 335, 525, 985, 20000]);
  const SEE_VAL = new Int32Array([0, 100, 320, 335, 505, 975, 20000]);
  const PHASE_INC = new Int8Array([0, 0, 1, 1, 2, 4, 0]);

  const PASSED_MG = new Int16Array([0, 0, 10, 18, 36, 68, 115, 0]);
  const PASSED_EG = new Int16Array([0, 0, 16, 34, 68, 125, 215, 0]);

  // Precomputed bitmasks (split into lo/hi 32-bit ints)
  const PASSED_W_LO = new Int32Array(64);
  const PASSED_W_HI = new Int32Array(64);
  const PASSED_B_LO = new Int32Array(64);
  const PASSED_B_HI = new Int32Array(64);
  const ADJ_FILE_LO = new Int32Array(8);
  const ADJ_FILE_HI = new Int32Array(8);
  const FILE_LO = new Int32Array(8);
  const FILE_HI = new Int32Array(8);
  const KNIGHT_ATTACK_LO = new Int32Array(64);
  const KNIGHT_ATTACK_HI = new Int32Array(64);
  const KING_ATTACK_LO = new Int32Array(64);
  const KING_ATTACK_HI = new Int32Array(64);

  // PSTs [type * 64 + sq] (White perspective: sq = r*8 + f)
  const MG_PST = new Int16Array(7 * 64);
  const EG_PST = new Int16Array(7 * 64);
  const LMR_TABLE = new Uint8Array(32 * 64);

  // Zobrist hash keys
  const Z_PIECE_HI = new Uint32Array(13 * 64);
  const Z_PIECE_LO = new Uint32Array(13 * 64);
  const Z_CASTLE_HI = new Uint32Array(16);
  const Z_CASTLE_LO = new Uint32Array(16);
  const Z_EP_HI = new Uint32Array(65);
  const Z_EP_LO = new Uint32Array(65);
  let Z_SIDE_HI = 0;
  let Z_SIDE_LO = 0;

  (function buildTables() {
    let seed = 0x9E3779B9;
    function nextU32() {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    }
    for (let i = 0; i < 13 * 64; i += 1) {
      Z_PIECE_HI[i] = nextU32();
      Z_PIECE_LO[i] = nextU32();
    }
    for (let i = 0; i < 16; i += 1) {
      Z_CASTLE_HI[i] = nextU32();
      Z_CASTLE_LO[i] = nextU32();
    }
    for (let i = 0; i < 65; i += 1) {
      Z_EP_HI[i] = nextU32();
      Z_EP_LO[i] = nextU32();
    }
    Z_SIDE_HI = nextU32();
    Z_SIDE_LO = nextU32();

    for (let f = 0; f < 8; f += 1) {
      let flo = 0;
      let fhi = 0;
      for (let r = 0; r < 8; r += 1) {
        const sq = (r << 3) | f;
        if (sq < 32) flo |= 1 << sq;
        else fhi |= 1 << (sq - 32);
      }
      FILE_LO[f] = flo;
      FILE_HI[f] = fhi;
    }
    for (let f = 0; f < 8; f += 1) {
      if (f > 0) {
        ADJ_FILE_LO[f] |= FILE_LO[f - 1];
        ADJ_FILE_HI[f] |= FILE_HI[f - 1];
      }
      if (f < 7) {
        ADJ_FILE_LO[f] |= FILE_LO[f + 1];
        ADJ_FILE_HI[f] |= FILE_HI[f + 1];
      }
    }

    for (let sq = 0; sq < 64; sq += 1) {
      const f = sq & 7;
      const r = sq >> 3;
      for (let rr = r + 1; rr < 8; rr += 1) {
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff += 1) {
          const tsq = (rr << 3) | ff;
          if (tsq < 32) PASSED_W_LO[sq] |= 1 << tsq;
          else PASSED_W_HI[sq] |= 1 << (tsq - 32);
        }
      }
      for (let rr = r - 1; rr >= 0; rr -= 1) {
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff += 1) {
          const tsq = (rr << 3) | ff;
          if (tsq < 32) PASSED_B_LO[sq] |= 1 << tsq;
          else PASSED_B_HI[sq] |= 1 << (tsq - 32);
        }
      }

      for (let i = 0; i < 8; i += 1) {
        const nf = f + KNIGHT_DF[i];
        const nr = r + KNIGHT_DR[i];
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const tsq = (nr << 3) | nf;
          if (tsq < 32) KNIGHT_ATTACK_LO[sq] |= 1 << tsq;
          else KNIGHT_ATTACK_HI[sq] |= 1 << (tsq - 32);
        }
        const kf = f + ALL_DF[i];
        const kr = r + ALL_DR[i];
        if (kf >= 0 && kf < 8 && kr >= 0 && kr < 8) {
          const ksq = (kr << 3) | kf;
          if (ksq < 32) KING_ATTACK_LO[sq] |= 1 << ksq;
          else KING_ATTACK_HI[sq] |= 1 << (ksq - 32);
        }
      }

      const center = 7 - Math.abs(2 * f - 7) - Math.abs(2 * r - 7); // -7..+5? Wait: max |2*3-7| = 1, 7-2 = 5; min 7-14 = -7 -> map 0..6
      const cScore = 6 - (Math.abs(2 * f - 7) + Math.abs(2 * r - 7)) * 0.5; // 0..5 -> scale carefully
      const fCenter = 7 - Math.abs(2 * f - 7); // 0..6

      // Pawn (1)
      let pMg = r * 6 + fCenter * 3;
      if (r >= 3 && f >= 2 && f <= 5) pMg += 14;
      if (r === 2 && (f === 3 || f === 4)) pMg += 10;
      if (r === 1 && (f === 3 || f === 4)) pMg -= 14; // Encourage pushing d2/e2 pawns out of bishop diagonals
      if (r >= 3 && (f === 0 || f === 7)) pMg -= 8;
      MG_PST[1 * 64 + sq] = pMg;
      EG_PST[1 * 64 + sq] = r * r * 5 + fCenter;

      // Knight (2)
      let nMg = Math.round(center * 4);
      if (r === 0) nMg -= 16;
      if (f === 0 || f === 7) nMg -= 16;
      if (r === 1 && (f === 3 || f === 4)) nMg -= 12; // Avoid Nd2/Ne2 blocking bishops/queen unless forced
      if (r >= 2 && r <= 5 && f >= 2 && f <= 5) nMg += 12;
      if (r === 4 && (f === 2 || f === 3 || f === 4 || f === 5)) nMg += 6;
      MG_PST[2 * 64 + sq] = nMg;
      EG_PST[2 * 64 + sq] = Math.round(cScore * 6) - (f === 0 || f === 7 ? 10 : 0);

      // Bishop (3)
      let bMg = Math.round(center * 4) + r * 2;
      if (r === 0) bMg -= 16;
      if ((f === 1 || f === 6) && r === 1) bMg += 12; // Fianchetto b2/g2
      if ((f === 2 || f === 5) && r === 3) bMg += 12; // Active Bc4/Bf4/c4/f4 diagonals
      if ((f === 1 || f === 6) && r === 4) bMg += 10; // Bb5/Bg5 pins
      MG_PST[3 * 64 + sq] = bMg;
      EG_PST[3 * 64 + sq] = Math.round(cScore * 4);

      // Rook (4)
      let rMg = r === 6 ? 28 : r * 2;
      if (r === 0 && (f === 3 || f === 4 || f === 2 || f === 5)) rMg += 8;
      if (r === 0 && (f === 0 || f === 7)) rMg -= 6;
      MG_PST[4 * 64 + sq] = rMg;
      EG_PST[4 * 64 + sq] = (r === 6 ? 20 : 0) + Math.round(cScore * 2);

      // Queen (5)
      let qMg = Math.round(center * 2);
      if (r > 2) qMg -= 10;
      if (r === 0 && f === 3) qMg += 6;
      if (r === 1 && (f === 3 || f === 4 || f === 2)) qMg += 5;
      MG_PST[5 * 64 + sq] = qMg;
      EG_PST[5 * 64 + sq] = Math.round(cScore * 4);

      // King (6)
      let kMg = -Math.round(center * 5) - r * 14;
      if (r === 0 && (f === 6 || f === 2 || f === 1)) kMg += 46;
      else if (r === 0 && f === 7) kMg += 24;
      else if (r === 0 && (f === 3 || f === 5)) kMg -= 12;
      MG_PST[6 * 64 + sq] = kMg;
      EG_PST[6 * 64 + sq] = Math.round(cScore * 10);
    }

    for (let d = 1; d < 32; d += 1) {
      for (let m = 1; m < 64; m += 1) {
        LMR_TABLE[(d << 6) | m] = (1 + (Math.log(d) * Math.log(m)) / 1.8) | 0;
      }
    }
  })();

  // Persistent engine state (single-threaded per worker / browser tab)
  const board = new Int8Array(64);
  let side = 1;
  let castling = 15;
  let ep = -1;
  let halfmove = 0;
  let wk = 4;
  let bk = 60;
  let hashHi = 0;
  let hashLo = 0;
  // Incremental occupancy bitboards & piece counts
  let wOccLo = 0;
  let wOccHi = 0;
  let bOccLo = 0;
  let bOccHi = 0;
  const pieceCnt = new Int8Array(14); // idx = side > 0 ? type : 7 + type (1..6)

  // Transposition table & move-ordering history
  const ttKeyHi = new Uint32Array(TT_SIZE);
  const ttKeyLo = new Uint32Array(TT_SIZE);
  const ttMove = new Int32Array(TT_SIZE);
  const ttScore = new Int32Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE);
  const ttFlag = new Uint8Array(TT_SIZE);
  const ttAge = new Uint16Array(TT_SIZE);
  // v6.1: exact static-evaluation cache for transpositions and re-searches.
  // Both halves of the Zobrist key are checked; collisions only evict entries.
  const EVAL_CACHE_SIZE = 1 << 18;
  const EVAL_CACHE_MASK = EVAL_CACHE_SIZE - 1;
  const evalCacheKeyHi = new Uint32Array(EVAL_CACHE_SIZE);
  const evalCacheKeyLo = new Uint32Array(EVAL_CACHE_SIZE);
  const evalCacheScore = new Int32Array(EVAL_CACHE_SIZE);
  const evalCacheValid = new Uint8Array(EVAL_CACHE_SIZE);
  let evalCacheHits = 0;
  let evalCacheMisses = 0;
  let evalCacheEnabled = false;
  const killer1 = new Int32Array(MAX_PLY);
  const killer2 = new Int32Array(MAX_PLY);
  const counterMoves = new Int32Array(4096);
  const historyTable = new Int32Array(2 * 4096);
  let searchAge = 0;

  // Search stacks
  const moveBuf = new Int32Array(MAX_PLY * 256);
  const scoreBuf = new Int32Array(MAX_PLY * 256);
  const staticEvalStack = new Int32Array(MAX_PLY);
  const armx11Mode = true;
  let armx11Contempt = 0;
  let rootSide = 1;

  // Undo stacks
  const undoCap = new Int8Array(MAX_PLY);
  const undoCastle = new Uint8Array(MAX_PLY);
  const undoEp = new Int8Array(MAX_PLY);
  const undoHalf = new Int16Array(MAX_PLY);
  const undoWk = new Int8Array(MAX_PLY);
  const undoBk = new Int8Array(MAX_PLY);
  const undoHashHi = new Uint32Array(MAX_PLY);
  const undoHashLo = new Uint32Array(MAX_PLY);
  const repPathHi = new Uint32Array(MAX_PLY + 8);
  const repPathLo = new Uint32Array(MAX_PLY + 8);

  // Root game history counts (for 2-fold/3-fold repetition avoidance)
  const ROOT_HIST_MAX = 512;
  const rootHistHi = new Uint32Array(ROOT_HIST_MAX);
  const rootHistLo = new Uint32Array(ROOT_HIST_MAX);
  const rootHistCount = new Uint8Array(ROOT_HIST_MAX);
  let rootHistLen = 0;
  // v6.1: index root-game history so every search node avoids a full history scan.
  const ROOT_HIST_HASH_SIZE = 2048;
  const ROOT_HIST_HASH_MASK = ROOT_HIST_HASH_SIZE - 1;
  const rootHistHashHi = new Uint32Array(ROOT_HIST_HASH_SIZE);
  const rootHistHashLo = new Uint32Array(ROOT_HIST_HASH_SIZE);
  const rootHistHashValid = new Uint8Array(ROOT_HIST_HASH_SIZE);

  function rootHistoryHashIndex(hi, lo) {
    return (Math.imul((hi ^ (lo >>> 1)) >>> 0, 0x9E3779B1) >>> 0) & ROOT_HIST_HASH_MASK;
  }
  function addRootHistoryHash(hi, lo) {
    let index = rootHistoryHashIndex(hi, lo);
    while (rootHistHashValid[index]) {
      if (rootHistHashHi[index] === hi && rootHistHashLo[index] === lo) return;
      index = (index + 1) & ROOT_HIST_HASH_MASK;
    }
    rootHistHashValid[index] = 1;
    rootHistHashHi[index] = hi;
    rootHistHashLo[index] = lo;
  }
  function hasRootHistoryHash(hi, lo) {
    let index = rootHistoryHashIndex(hi, lo);
    while (rootHistHashValid[index]) {
      if (rootHistHashHi[index] === hi && rootHistHashLo[index] === lo) return true;
      index = (index + 1) & ROOT_HIST_HASH_MASK;
    }
    return false;
  }

  // Control & budget
  let nodeCount = 0;
  let softNodeLimit = 18000;
  let hardNodeLimit = 42000;
  let searchDeadline = 0;
  let abortSearch = false;
  let lastEvalTemp = 0;

  function popcount32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
  }

  function computeFullHash() {
    let hi = 0;
    let lo = 0;
    for (let sq = 0; sq < 64; sq += 1) {
      const p = board[sq];
      if (p) {
        const idx = (p + 6) * 64 + sq;
        hi = (hi ^ Z_PIECE_HI[idx]) >>> 0;
        lo = (lo ^ Z_PIECE_LO[idx]) >>> 0;
      }
    }
    hi = (hi ^ Z_CASTLE_HI[castling]) >>> 0;
    lo = (lo ^ Z_CASTLE_LO[castling]) >>> 0;
    hi = (hi ^ Z_EP_HI[ep + 1]) >>> 0;
    lo = (lo ^ Z_EP_LO[ep + 1]) >>> 0;
    if (side === -1) {
      hi = (hi ^ Z_SIDE_HI) >>> 0;
      lo = (lo ^ Z_SIDE_LO) >>> 0;
    }
    hashHi = hi;
    hashLo = lo;
  }

  function computeHashForPositionArray(arr, s, cast, epSq) {
    let hi = 0;
    let lo = 0;
    for (let sq = 0; sq < 64; sq += 1) {
      const p = arr[sq];
      if (p) {
        const idx = (p + 6) * 64 + sq;
        hi = (hi ^ Z_PIECE_HI[idx]) >>> 0;
        lo = (lo ^ Z_PIECE_LO[idx]) >>> 0;
      }
    }
    hi = (hi ^ Z_CASTLE_HI[cast]) >>> 0;
    lo = (lo ^ Z_CASTLE_LO[cast]) >>> 0;
    hi = (hi ^ Z_EP_HI[epSq + 1]) >>> 0;
    lo = (lo ^ Z_EP_LO[epSq + 1]) >>> 0;
    if (s === -1) {
      hi = (hi ^ Z_SIDE_HI) >>> 0;
      lo = (lo ^ Z_SIDE_LO) >>> 0;
    }
    return [hi, lo];
  }

  function loadFromGame(game) {
    const b = game.boardState;
    wOccLo = 0;
    wOccHi = 0;
    bOccLo = 0;
    bOccHi = 0;
    pieceCnt.fill(0);
    for (let i = 0; i < 64; i += 1) {
      const p = b[i];
      board[i] = p;
      if (p > 0) {
        if (i < 32) wOccLo |= 1 << i; else wOccHi |= 1 << (i - 32);
        pieceCnt[p] += 1;
      } else if (p < 0) {
        if (i < 32) bOccLo |= 1 << i; else bOccHi |= 1 << (i - 32);
        pieceCnt[7 - p] += 1;
      }
    }
    side = game.side;
    castling = game.castling;
    ep = game.ep;
    halfmove = game.halfmove;
    wk = game.kingSq[1];
    bk = game.kingSq[-1];
    computeFullHash();

    // Decide cache policy once per loaded root position, not on every eval call.
    const rootPieceTotal = pieceCnt[1] + pieceCnt[2] + pieceCnt[3] + pieceCnt[4] + pieceCnt[5] + pieceCnt[6]
      + pieceCnt[8] + pieceCnt[9] + pieceCnt[10] + pieceCnt[11] + pieceCnt[12] + pieceCnt[13];
    evalCacheEnabled = rootPieceTotal >= 12 && rootPieceTotal <= 32;

    rootHistLen = 0;
    if (game.positionCounts && game.positionCounts.size > 0) {
      if (game.positionCounts.size >= 8) rootHistHashValid.fill(0);
      const indexRootHistory = game.positionCounts.size >= 8;
      const tmp = new Int8Array(64);
      for (const [key, cnt] of game.positionCounts.entries()) {
        if (!cnt || rootHistLen >= ROOT_HIST_MAX) continue;
        // fastPositionKey format: "w|<64 chars>|castling|ep"
        const sChar = key.charCodeAt(0);
        const s = sChar === 119 ? 1 : -1;
        for (let sq = 0; sq < 64; sq += 1) {
          tmp[sq] = key.charCodeAt(2 + sq) - 70;
        }
        const sep = key.indexOf('|', 67);
        const c = Number(key.slice(67, sep));
        const e = Number(key.slice(sep + 1));
        const [h, l] = computeHashForPositionArray(tmp, s, c, e);
        rootHistHi[rootHistLen] = h;
        rootHistLo[rootHistLen] = l;
        rootHistCount[rootHistLen] = cnt;
        if (indexRootHistory) addRootHistoryHash(h, l);
        rootHistLen += 1;
      }
    }
  }

  function isSquareAttacked(sq, bySide) {
    const file = sq & 7;
    const rank = sq >> 3;
    const baseIdx = bySide === 1 ? 0 : 7;

    // Pawns
    if (pieceCnt[baseIdx + 1] > 0) {
      const pRank = rank - bySide;
      if (pRank >= 0 && pRank < 8) {
        const base = pRank << 3;
        if (file > 0 && board[base + file - 1] === bySide) return true;
        if (file < 7 && board[base + file + 1] === bySide) return true;
      }
    }

    // Knights
    if (pieceCnt[baseIdx + 2] > 0) {
      const kn = bySide * 2;
      for (let i = 0; i < 8; i += 1) {
        const f = file + KNIGHT_DF[i];
        const r = rank + KNIGHT_DR[i];
        if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[(r << 3) | f] === kn) return true;
      }
    }

    // King adjacency (O(1) via king position)
    const oppK = bySide === 1 ? wk : bk;
    const kdf = (oppK & 7) - file;
    const kdr = (oppK >> 3) - rank;
    if (kdf >= -1 && kdf <= 1 && kdr >= -1 && kdr <= 1 && (kdf !== 0 || kdr !== 0)) return true;

    // Diagonal sliders (B=3, Q=5)
    const bs = bySide * 3;
    const qs = bySide * 5;
    if (pieceCnt[baseIdx + 3] + pieceCnt[baseIdx + 5] > 0) {
      for (let d = 0; d < 4; d += 1) {
        const df = ALL_DF[d];
        const dr = ALL_DR[d];
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const p = board[(r << 3) | f];
          if (p) {
            if (p === bs || p === qs) return true;
            break;
          }
          f += df;
          r += dr;
        }
      }
    }

    // Orthogonal sliders (R=4, Q=5)
    const rs = bySide * 4;
    if (pieceCnt[baseIdx + 4] + pieceCnt[baseIdx + 5] > 0) {
      for (let d = 4; d < 8; d += 1) {
        const df = ALL_DF[d];
        const dr = ALL_DR[d];
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const p = board[(r << 3) | f];
          if (p) {
            if (p === rs || p === qs) return true;
            break;
          }
          f += df;
          r += dr;
        }
      }
    }

    return false;
  }

  // Packed move format (25 bits in signed 32-bit int):
  // bits 0..5:   from (0..63)
  // bits 6..11:  to (0..63)
  // bits 12..14: piece (1..6)
  // bits 15..17: captured (0..6)
  // bits 18..20: promotion (0..5)
  // bits 21..24: flags (1=double pawn, 2=ep, 4=K-castle, 8=Q-castle)
  function packMove(from, to, piece, cap, promo, flags) {
    return from | (to << 6) | (piece << 12) | (cap << 15) | (promo << 18) | (flags << 21);
  }

  function generatePseudoMoves(ply, capturesOnly) {
    let idx = ply << 8;
    const startIdx = idx;
    const us = side;
    const promoRank = us === 1 ? 7 : 0;
    const pawnStartRank = us === 1 ? 1 : 6;
    const step = us === 1 ? 8 : -8;

    let lo = us === 1 ? wOccLo : bOccLo;
    let hi = us === 1 ? wOccHi : bOccHi;

    for (let pass = 0; pass < 2; pass += 1) {
      let bits = pass === 0 ? lo : hi;
      const sqBase = pass === 0 ? 0 : 32;
      while (bits !== 0) {
        const lsb = bits & -bits;
        bits ^= lsb;
        const from = sqBase + 31 - Math.clz32(lsb);
        const piece = board[from];
        const type = piece > 0 ? piece : -piece;
        const file = from & 7;
        const rank = from >> 3;

      if (type === 1) {
        const one = from + step;
        if (one >= 0 && one < 64 && !board[one]) {
          if ((one >> 3) === promoRank) {
            moveBuf[idx++] = packMove(from, one, 1, 0, 5, 0);
            moveBuf[idx++] = packMove(from, one, 1, 0, 4, 0);
            moveBuf[idx++] = packMove(from, one, 1, 0, 3, 0);
            moveBuf[idx++] = packMove(from, one, 1, 0, 2, 0);
          } else if (!capturesOnly) {
            moveBuf[idx++] = packMove(from, one, 1, 0, 0, 0);
            if (rank === pawnStartRank) {
              const two = one + step;
              if (!board[two]) moveBuf[idx++] = packMove(from, two, 1, 0, 0, 1);
            }
          }
        }
        if (file > 0) {
          const to = one - 1;
          const t = board[to];
          if (t && (t > 0 ? 1 : -1) === -us) {
            const cap = t > 0 ? t : -t;
            if ((to >> 3) === promoRank) {
              moveBuf[idx++] = packMove(from, to, 1, cap, 5, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 4, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 3, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 2, 0);
            } else {
              moveBuf[idx++] = packMove(from, to, 1, cap, 0, 0);
            }
          } else if (to === ep) {
            moveBuf[idx++] = packMove(from, to, 1, 1, 0, 2);
          }
        }
        if (file < 7) {
          const to = one + 1;
          const t = board[to];
          if (t && (t > 0 ? 1 : -1) === -us) {
            const cap = t > 0 ? t : -t;
            if ((to >> 3) === promoRank) {
              moveBuf[idx++] = packMove(from, to, 1, cap, 5, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 4, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 3, 0);
              moveBuf[idx++] = packMove(from, to, 1, cap, 2, 0);
            } else {
              moveBuf[idx++] = packMove(from, to, 1, cap, 0, 0);
            }
          } else if (to === ep) {
            moveBuf[idx++] = packMove(from, to, 1, 1, 0, 2);
          }
        }
        continue;
      }

      if (type === 2) {
        for (let i = 0; i < 8; i += 1) {
          const f = file + KNIGHT_DF[i];
          const r = rank + KNIGHT_DR[i];
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const to = (r << 3) | f;
          const t = board[to];
          if (!t) {
            if (!capturesOnly) moveBuf[idx++] = packMove(from, to, 2, 0, 0, 0);
          } else if ((t > 0 ? 1 : -1) === -us) {
            moveBuf[idx++] = packMove(from, to, 2, t > 0 ? t : -t, 0, 0);
          }
        }
        continue;
      }

      if (type === 6) {
        for (let i = 0; i < 8; i += 1) {
          const f = file + ALL_DF[i];
          const r = rank + ALL_DR[i];
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const to = (r << 3) | f;
          const t = board[to];
          if (!t) {
            if (!capturesOnly) moveBuf[idx++] = packMove(from, to, 6, 0, 0, 0);
          } else if ((t > 0 ? 1 : -1) === -us) {
            moveBuf[idx++] = packMove(from, to, 6, t > 0 ? t : -t, 0, 0);
          }
        }
        if (!capturesOnly) {
          if (us === 1 && from === 4) {
            if ((castling & 1) && board[7] === 4 && !board[5] && !board[6]
              && !isSquareAttacked(4, -1) && !isSquareAttacked(5, -1) && !isSquareAttacked(6, -1)) {
              moveBuf[idx++] = packMove(4, 6, 6, 0, 0, 4);
            }
            if ((castling & 2) && board[0] === 4 && !board[1] && !board[2] && !board[3]
              && !isSquareAttacked(4, -1) && !isSquareAttacked(3, -1) && !isSquareAttacked(2, -1)) {
              moveBuf[idx++] = packMove(4, 2, 6, 0, 0, 8);
            }
          } else if (us === -1 && from === 60) {
            if ((castling & 4) && board[63] === -4 && !board[61] && !board[62]
              && !isSquareAttacked(60, 1) && !isSquareAttacked(61, 1) && !isSquareAttacked(62, 1)) {
              moveBuf[idx++] = packMove(60, 62, 6, 0, 0, 4);
            }
            if ((castling & 8) && board[56] === -4 && !board[57] && !board[58] && !board[59]
              && !isSquareAttacked(60, 1) && !isSquareAttacked(59, 1) && !isSquareAttacked(58, 1)) {
              moveBuf[idx++] = packMove(60, 58, 6, 0, 0, 8);
            }
          }
        }
        continue;
      }

      const dStart = type === 4 ? 4 : 0;
      const dEnd = type === 3 ? 4 : 8;
      for (let d = dStart; d < dEnd; d += 1) {
        const df = ALL_DF[d];
        const dr = ALL_DR[d];
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const to = (r << 3) | f;
          const t = board[to];
          if (!t) {
            if (!capturesOnly) moveBuf[idx++] = packMove(from, to, type, 0, 0, 0);
          } else {
            if ((t > 0 ? 1 : -1) === -us) {
              moveBuf[idx++] = packMove(from, to, type, t > 0 ? t : -t, 0, 0);
            }
            break;
          }
          f += df;
          r += dr;
        }
      }
      }
    }
    return idx - startIdx;
  }

  function setBoardSquare(sq, p) {
    const old = board[sq];
    if (old > 0) {
      if (sq < 32) wOccLo &= ~(1 << sq); else wOccHi &= ~(1 << (sq - 32));
      pieceCnt[old] -= 1;
    } else if (old < 0) {
      if (sq < 32) bOccLo &= ~(1 << sq); else bOccHi &= ~(1 << (sq - 32));
      pieceCnt[7 - old] -= 1;
    }
    board[sq] = p;
    if (p > 0) {
      if (sq < 32) wOccLo |= 1 << sq; else wOccHi |= 1 << (sq - 32);
      pieceCnt[p] += 1;
    } else if (p < 0) {
      if (sq < 32) bOccLo |= 1 << sq; else bOccHi |= 1 << (sq - 32);
      pieceCnt[7 - p] += 1;
    }
  }

  function makeMove(m, ply, wasInCheck) {
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const piece = (m >>> 12) & 7;
    const promo = (m >>> 18) & 7;
    const flags = (m >>> 21) & 15;
    const us = side;

    undoCastle[ply] = castling;
    undoEp[ply] = ep;
    undoHalf[ply] = halfmove;
    undoWk[ply] = wk;
    undoBk[ply] = bk;
    undoHashHi[ply] = hashHi;
    undoHashLo[ply] = hashLo;

    let hi = hashHi;
    let lo = hashLo;
    hi = (hi ^ Z_CASTLE_HI[castling] ^ Z_EP_HI[ep + 1] ^ Z_SIDE_HI) >>> 0;
    lo = (lo ^ Z_CASTLE_LO[castling] ^ Z_EP_LO[ep + 1] ^ Z_SIDE_LO) >>> 0;

    const moving = board[from];
    const movingIdx = (moving + 6) * 64 + from;
    hi = (hi ^ Z_PIECE_HI[movingIdx]) >>> 0;
    lo = (lo ^ Z_PIECE_LO[movingIdx]) >>> 0;
    setBoardSquare(from, 0);

    let capPiece = board[to];
    if (flags & 2) {
      const epCapSq = to + (us === 1 ? -8 : 8);
      capPiece = board[epCapSq];
      const capIdx = (capPiece + 6) * 64 + epCapSq;
      hi = (hi ^ Z_PIECE_HI[capIdx]) >>> 0;
      lo = (lo ^ Z_PIECE_LO[capIdx]) >>> 0;
      setBoardSquare(epCapSq, 0);
    } else if (capPiece) {
      const capIdx = (capPiece + 6) * 64 + to;
      hi = (hi ^ Z_PIECE_HI[capIdx]) >>> 0;
      lo = (lo ^ Z_PIECE_LO[capIdx]) >>> 0;
    }
    undoCap[ply] = capPiece;

    const placed = promo ? us * promo : moving;
    setBoardSquare(to, placed);
    const placedIdx = (placed + 6) * 64 + to;
    hi = (hi ^ Z_PIECE_HI[placedIdx]) >>> 0;
    lo = (lo ^ Z_PIECE_LO[placedIdx]) >>> 0;

    if (piece === 6) {
      if (us === 1) {
        wk = to;
        castling &= ~3;
      } else {
        bk = to;
        castling &= ~12;
      }
      if (flags & 4) {
        const rf = us === 1 ? 7 : 63;
        const rt = us === 1 ? 5 : 61;
        const rook = board[rf];
        const rFromIdx = (rook + 6) * 64 + rf;
        const rToIdx = (rook + 6) * 64 + rt;
        hi = (hi ^ Z_PIECE_HI[rFromIdx] ^ Z_PIECE_HI[rToIdx]) >>> 0;
        lo = (lo ^ Z_PIECE_LO[rFromIdx] ^ Z_PIECE_LO[rToIdx]) >>> 0;
        setBoardSquare(rt, rook);
        setBoardSquare(rf, 0);
      } else if (flags & 8) {
        const rf = us === 1 ? 0 : 56;
        const rt = us === 1 ? 3 : 59;
        const rook = board[rf];
        const rFromIdx = (rook + 6) * 64 + rf;
        const rToIdx = (rook + 6) * 64 + rt;
        hi = (hi ^ Z_PIECE_HI[rFromIdx] ^ Z_PIECE_HI[rToIdx]) >>> 0;
        lo = (lo ^ Z_PIECE_LO[rFromIdx] ^ Z_PIECE_LO[rToIdx]) >>> 0;
        setBoardSquare(rt, rook);
        setBoardSquare(rf, 0);
      }
    }

    if (from === 0 || to === 0) castling &= ~2;
    if (from === 7 || to === 7) castling &= ~1;
    if (from === 56 || to === 56) castling &= ~8;
    if (from === 63 || to === 63) castling &= ~4;

    ep = (flags & 1) ? ((from + to) >> 1) : -1;
    halfmove = (piece === 1 || capPiece !== 0) ? 0 : halfmove + 1;

    hi = (hi ^ Z_CASTLE_HI[castling] ^ Z_EP_HI[ep + 1]) >>> 0;
    lo = (lo ^ Z_CASTLE_LO[castling] ^ Z_EP_LO[ep + 1]) >>> 0;
    hashHi = hi;
    hashLo = lo;
    side = -us;

    const myKingSq = us === 1 ? wk : bk;
    if (wasInCheck || piece === 6 || (flags & 2)) {
      if (isSquareAttacked(myKingSq, -us)) {
        unmakeMove(m, ply);
        return false;
      }
    } else {
      // Fast ray-alignment filter: if moving piece was not on a rook/bishop ray from own king, it cannot be pinned!
      const kf = myKingSq & 7;
      const kr = myKingSq >> 3;
      const ff = from & 7;
      const fr = from >> 3;
      const df = ff - kf;
      const dr = fr - kr;
      if (df === 0 || dr === 0 || df === dr || df === -dr) {
        if (isSquareAttacked(myKingSq, -us)) {
          unmakeMove(m, ply);
          return false;
        }
      }
    }
    return true;
  }

  function unmakeMove(m, ply) {
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const piece = (m >>> 12) & 7;
    const flags = (m >>> 21) & 15;
    const us = -side;

    side = us;
    castling = undoCastle[ply];
    ep = undoEp[ply];
    halfmove = undoHalf[ply];
    wk = undoWk[ply];
    bk = undoBk[ply];
    hashHi = undoHashHi[ply];
    hashLo = undoHashLo[ply];

    const capPiece = undoCap[ply];
    setBoardSquare(from, us * piece);
    if (flags & 2) {
      setBoardSquare(to, 0);
      setBoardSquare(to + (us === 1 ? -8 : 8), capPiece);
    } else {
      setBoardSquare(to, capPiece);
    }
    if (flags & 4) {
      const rf = us === 1 ? 7 : 63;
      const rt = us === 1 ? 5 : 61;
      setBoardSquare(rf, board[rt]);
      setBoardSquare(rt, 0);
    } else if (flags & 8) {
      const rf = us === 1 ? 0 : 56;
      const rt = us === 1 ? 3 : 59;
      setBoardSquare(rf, board[rt]);
      setBoardSquare(rt, 0);
    }
  }

  function makeNullMove(ply) {
    undoEp[ply] = ep;
    undoHalf[ply] = halfmove;
    undoHashHi[ply] = hashHi;
    undoHashLo[ply] = hashLo;
    let hi = (hashHi ^ Z_EP_HI[ep + 1] ^ Z_SIDE_HI) >>> 0;
    let lo = (hashLo ^ Z_EP_LO[ep + 1] ^ Z_SIDE_LO) >>> 0;
    ep = -1;
    halfmove += 1;
    hi = (hi ^ Z_EP_HI[0]) >>> 0;
    lo = (lo ^ Z_EP_LO[0]) >>> 0;
    hashHi = hi;
    hashLo = lo;
    side = -side;
  }

  function unmakeNullMove(ply) {
    side = -side;
    ep = undoEp[ply];
    halfmove = undoHalf[ply];
    hashHi = undoHashHi[ply];
    hashLo = undoHashLo[ply];
  }

  // Static Exchange Evaluation (SEE) for capture ordering & losing-capture pruning in QSearch.
  const seeGain = new Int32Array(32);
  const seeRemovedSq = new Int8Array(32);
  const seeRemovedPiece = new Int8Array(32);
  function seeCapture(m) {
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const piece = (m >>> 12) & 7;
    const cap = (m >>> 15) & 7;
    const promo = (m >>> 18) & 7;

    let value = cap ? SEE_VAL[cap] : 0;
    if (promo) value += SEE_VAL[promo] - SEE_VAL[1];
    if (!cap && !promo) return 0;

    // Fast path: if victim >= attacker, capture is winning/equal unless promotion sacrifice
    const attackerVal = promo ? SEE_VAL[promo] : SEE_VAL[piece];
    if (value >= attackerVal) return value;

    let remCount = 0;

    seeGain[0] = value;
    let d = 0;
    let curSide = -side;
    let curVal = attackerVal;
    seeRemovedSq[remCount] = from;
    seeRemovedPiece[remCount] = board[from];
    board[from] = 0;
    remCount += 1;

    const tf = to & 7;
    const tr = to >> 3;

    while (d < 30) {
      // Find least valuable attacker of `to` by `curSide`
      let bestSq = -1;
      let bestType = 7;

      // 1. Pawn
      const pRank = tr - curSide;
      if (pRank >= 0 && pRank < 8) {
        const base = pRank << 3;
        if (tf > 0 && board[base + tf - 1] === curSide) {
          bestSq = base + tf - 1;
          bestType = 1;
        } else if (tf < 7 && board[base + tf + 1] === curSide) {
          bestSq = base + tf + 1;
          bestType = 1;
        }
      }

      // 2. Knight
      if (bestType > 2) {
        const kn = curSide * 2;
        for (let i = 0; i < 8; i += 1) {
          const nf = tf + KNIGHT_DF[i];
          const nr = tr + KNIGHT_DR[i];
          if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
            const sq = (nr << 3) | nf;
            if (board[sq] === kn) {
              bestSq = sq;
              bestType = 2;
              break;
            }
          }
        }
      }

      // 3-5. Diagonal & Orthogonal Sliders + King
      if (bestType > 3) {
        const bs = curSide * 3;
        const rs = curSide * 4;
        const qs = curSide * 5;
        const ks = curSide * 6;
        for (let dir = 0; dir < 8; dir += 1) {
          const df = ALL_DF[dir];
          const dr = ALL_DR[dir];
          let f = tf + df;
          let r = tr + dr;
          let step = 0;
          while (f >= 0 && f < 8 && r >= 0 && r < 8) {
            const sq = (r << 3) | f;
            const p = board[sq];
            if (p) {
              if (dir < 4) {
                if (p === bs && 3 < bestType) { bestSq = sq; bestType = 3; }
                else if (p === qs && 5 < bestType) { bestSq = sq; bestType = 5; }
                else if (step === 0 && p === ks && 6 < bestType) { bestSq = sq; bestType = 6; }
              } else {
                if (p === rs && 4 < bestType) { bestSq = sq; bestType = 4; }
                else if (p === qs && 5 < bestType) { bestSq = sq; bestType = 5; }
                else if (step === 0 && p === ks && 6 < bestType) { bestSq = sq; bestType = 6; }
              }
              break;
            }
            f += df;
            r += dr;
            step += 1;
          }
        }
      }

      if (bestSq < 0) break;

      d += 1;
      seeGain[d] = curVal - seeGain[d - 1];
      if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break;
      curVal = SEE_VAL[bestType];
      seeRemovedSq[remCount] = bestSq;
      seeRemovedPiece[remCount] = board[bestSq];
      board[bestSq] = 0;
      remCount += 1;
      curSide = -curSide;
    }

    while (remCount > 0) {
      remCount -= 1;
      board[seeRemovedSq[remCount]] = seeRemovedPiece[remCount];
    }

    while (d > 0) {
      seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
      d -= 1;
    }
    return seeGain[0];
  }

  // Scratch arrays for evaluate() (module-level, zero allocation)
  const evalWFileCount = new Int8Array(8);
  const evalBFileCount = new Int8Array(8);
  const evalWPawnSqs = new Int8Array(8);
  const evalBPawnSqs = new Int8Array(8);
  const evalWPieceSqs = new Int8Array(16);
  const evalWPieceTypes = new Int8Array(16);
  const evalBPieceSqs = new Int8Array(16);
  const evalBPieceTypes = new Int8Array(16);
  const evalPinned = new Int8Array(64); // 1 = absolute pin, 2 = relative pin

  function evaluate() {
    const cacheIndex = (hashHi ^ hashLo) & EVAL_CACHE_MASK;
    if (evalCacheEnabled) {
      if (evalCacheValid[cacheIndex]
        && evalCacheKeyHi[cacheIndex] === hashHi
        && evalCacheKeyLo[cacheIndex] === hashLo) {
        evalCacheHits += 1;
        return evalCacheScore[cacheIndex];
      }
      evalCacheMisses += 1;
    }
    let mg = 0;
    let eg = 0;
    let phase = 0;
    let wPhase = 0;
    let bPhase = 0;
    let wRawMat = 0;
    let bRawMat = 0;
    let wBishops = 0;
    let bBishops = 0;
    let wMinorsHome = 0;
    let bMinorsHome = 0;
    let wQueenSq = -1;
    let bQueenSq = -1;
    let wRookCount = 0;
    let bRookCount = 0;
    let wPawnAttacksLo = 0;
    let wPawnAttacksHi = 0;
    let bPawnAttacksLo = 0;
    let bPawnAttacksHi = 0;
    let wPawnsLo = 0;
    let wPawnsHi = 0;
    let bPawnsLo = 0;
    let bPawnsHi = 0;

    evalWFileCount.fill(0);
    evalBFileCount.fill(0);
    let wpc = 0;
    let bpc = 0;
    let wmc = 0;
    let bmc = 0;

    for (let pass = 0; pass < 2; pass += 1) {
      let bits = pass === 0 ? (wOccLo | bOccLo) : (wOccHi | bOccHi);
      const sqBase = pass === 0 ? 0 : 32;
      while (bits !== 0) {
        const lsb = bits & -bits;
        bits ^= lsb;
        const sq = sqBase + 31 - Math.clz32(lsb);
        const p = board[sq];
        const s = p > 0 ? 1 : -1;
        const t = p > 0 ? p : -p;
        const ps = s > 0 ? sq : (sq ^ 56);
        const f = sq & 7;

        mg += s * (MG_VAL[t] + MG_PST[t * 64 + ps]);
        eg += s * (EG_VAL[t] + EG_PST[t * 64 + ps]);
        const ph = PHASE_INC[t];
        phase += ph;

        if (t === 1) {
          if (s > 0) {
            wRawMat += 100;
            evalWFileCount[f] += 1;
            evalWPawnSqs[wpc++] = sq;
            if (sq < 32) wPawnsLo |= 1 << sq;
            else wPawnsHi |= 1 << (sq - 32);
            if (f > 0) {
              const a = sq + 7;
              if (a < 32) wPawnAttacksLo |= 1 << a; else wPawnAttacksHi |= 1 << (a - 32);
            }
            if (f < 7) {
              const a = sq + 9;
              if (a < 32) wPawnAttacksLo |= 1 << a; else wPawnAttacksHi |= 1 << (a - 32);
            }
          } else {
            bRawMat += 100;
            evalBFileCount[f] += 1;
            evalBPawnSqs[bpc++] = sq;
            if (sq < 32) bPawnsLo |= 1 << sq;
            else bPawnsHi |= 1 << (sq - 32);
            if (f > 0) {
              const a = sq - 9;
              if (a < 32) bPawnAttacksLo |= 1 << a; else bPawnAttacksHi |= 1 << (a - 32);
            }
            if (f < 7) {
              const a = sq - 7;
              if (a < 32) bPawnAttacksLo |= 1 << a; else bPawnAttacksHi |= 1 << (a - 32);
            }
          }
        } else if (t < 6) {
          if (s > 0) {
            wPhase += ph;
            wRawMat += MG_VAL[t];
            evalWPieceSqs[wmc] = sq;
            evalWPieceTypes[wmc] = t;
            wmc += 1;
            if (t === 2 && (sq === 1 || sq === 6)) wMinorsHome += 1;
            if (t === 3) {
              wBishops += 1;
              if (sq === 2 || sq === 5) wMinorsHome += 1;
            }
            if (t === 4) wRookCount += 1;
            if (t === 5) wQueenSq = sq;
          } else {
            bPhase += ph;
            bRawMat += MG_VAL[t];
            evalBPieceSqs[bmc] = sq;
            evalBPieceTypes[bmc] = t;
            bmc += 1;
            if (t === 2 && (sq === 57 || sq === 62)) bMinorsHome += 1;
            if (t === 3) {
              bBishops += 1;
              if (sq === 58 || sq === 61) bMinorsHome += 1;
            }
            if (t === 4) bRookCount += 1;
            if (t === 5) bQueenSq = sq;
          }
        }
      }
    }

    // Check bare-king / extreme mop-up endgame BEFORE anything else dilutes it
    if ((bPhase === 0 && bpc === 0 && (wPhase >= 2 || wpc > 0))
      || (wPhase === 0 && wpc === 0 && (bPhase >= 2 || bpc > 0))) {
      const winner = (bPhase === 0 && bpc === 0) ? 1 : -1;
      const winKing = winner > 0 ? wk : bk;
      const loseKing = winner > 0 ? bk : wk;
      const wf = winKing & 7;
      const wr = winKing >> 3;
      const lf = loseKing & 7;
      const lr = loseKing >> 3;

      const edge = Math.max(Math.abs(2 * lf - 7), Math.abs(2 * lr - 7)); // 0..6
      const corner = Math.abs(2 * lf - 7) + Math.abs(2 * lr - 7); // 0..12
      const kingMan = Math.abs(wf - lf) + Math.abs(wr - lr);
      const kingCheb = Math.max(Math.abs(wf - lf), Math.abs(wr - lr));

      let mop = edge * 42 + corner * 26 + (14 - kingMan) * 26 + (7 - kingCheb) * 22;

      // Box restriction for Rook or Queen
      const winList = winner > 0 ? evalWPieceSqs : evalBPieceSqs;
      const winTypes = winner > 0 ? evalWPieceTypes : evalBPieceTypes;
      const winCount = winner > 0 ? wmc : bmc;
      let hasHeavy = false;
      let bishopSq = -1;
      let hasKnight = false;

      for (let i = 0; i < winCount; i += 1) {
        const pt = winTypes[i];
        const psq = winList[i];
        if (pt === 4 || pt === 5) {
          hasHeavy = true;
          const pf = psq & 7;
          const pr = psq >> 3;
          const bw = pf > lf ? pf : (pf < lf ? 7 - pf : 8);
          const bh = pr > lr ? pr : (pr < lr ? 7 - pr : 8);
          mop += (64 - bw * bh) * (pt === 4 ? 7 : 5);
          // Avoid leaving heavy piece undefended next to enemy king
          const pKingDist = Math.max(Math.abs(pf - lf), Math.abs(pr - lr));
          if (pKingDist === 1 && kingCheb > 2) mop -= 35;
        } else if (pt === 3) {
          bishopSq = psq;
        } else if (pt === 2) {
          hasKnight = true;
        }
      }

      // Direct opposition bonus (crucial for K+R vs K!)
      if (kingCheb === 2 && (wf === lf || wr === lr)) mop += 38;

      // K+B+N vs K: drive loser king toward a corner matching the bishop's square color
      if (!hasHeavy && bishopSq >= 0 && hasKnight && winCount === 2) {
        const bColor = ((bishopSq & 7) + (bishopSq >> 3)) & 1;
        // a1 (0,0) -> sum 0 (even), h8 (7,7) -> sum 14 (even), a8 (0,7) -> sum 7 (odd), h1 (7,0) -> sum 7 (odd)
        const matchingCornerDist = bColor === 0
          ? Math.min(lf + lr, (7 - lf) + (7 - lr))
          : Math.min(lf + (7 - lr), (7 - lf) + lr);
        mop += (14 - matchingCornerDist) * 45;
      }

      // Advance any pawns as fast as possible
      const wP = winner > 0 ? evalWPawnSqs : evalBPawnSqs;
      const wPCnt = winner > 0 ? wpc : bpc;
      for (let i = 0; i < wPCnt; i += 1) {
        const sq = wP[i];
        const r = winner > 0 ? (sq >> 3) : 7 - (sq >> 3);
        mop += r * r * 12;
      }

      const totalScore = winner * (Math.abs(wRawMat - bRawMat) + 500 + mop);
      const value = totalScore * side + 8;
      if (evalCacheEnabled) {
        evalCacheKeyHi[cacheIndex] = hashHi;
        evalCacheKeyLo[cacheIndex] = hashLo;
        evalCacheScore[cacheIndex] = value;
        evalCacheValid[cacheIndex] = 1;
      }
      return value;
    }

    // 1. Pawn Structure Evaluation (Stonefish's core strength: preserved & reinforced)
    for (let i = 0; i < wpc; i += 1) {
      const sq = evalWPawnSqs[i];
      const f = sq & 7;
      const r = sq >> 3;
      if (evalWFileCount[f] > 1) { mg -= 12; eg -= 16; }
      const adjMaskLo = ADJ_FILE_LO[f];
      const adjMaskHi = ADJ_FILE_HI[f];
      if ((wPawnsLo & adjMaskLo) === 0 && (wPawnsHi & adjMaskHi) === 0) {
        mg -= 11;
        eg -= 15;
      } else {
        // Supported by friendly pawn or side-by-side phalanx
        const defended = ((wPawnAttacksLo & (sq < 32 ? 1 << sq : 0)) !== 0)
          || ((wPawnAttacksHi & (sq >= 32 ? 1 << (sq - 32) : 0)) !== 0);
        if (defended) { mg += 6; eg += 8; }
        else {
          const phalanx = (f > 0 && board[sq - 1] === 1) || (f < 7 && board[sq + 1] === 1);
          if (phalanx) { mg += 5; eg += 6; }
          else if (evalBFileCount[f] === 0 || (sq + 8 < 64 && board[sq + 8] !== -1)) {
            // Check simple backward pawn: stop square attacked by black pawn and no friendly pawn on rank <= r on adjacent files
            const stopSq = sq + 8;
            const stopAttacked = ((bPawnAttacksLo & (stopSq < 32 ? 1 << stopSq : 0)) !== 0)
              || ((bPawnAttacksHi & (stopSq >= 32 ? 1 << (stopSq - 32) : 0)) !== 0);
            if (stopAttacked) {
              // Check if any adjacent friendly pawn is behind or equal
              let behindSupport = false;
              for (let rr = 1; rr <= r; rr += 1) {
                if ((f > 0 && board[(rr << 3) | (f - 1)] === 1) || (f < 7 && board[(rr << 3) | (f + 1)] === 1)) {
                  behindSupport = true;
                  break;
                }
              }
              if (!behindSupport) { mg -= 7; eg -= 9; }
            }
          }
        }
      }

      // Passed pawn
      if ((bPawnsLo & PASSED_W_LO[sq]) === 0 && (bPawnsHi & PASSED_W_HI[sq]) === 0) {
        mg += PASSED_MG[r];
        eg += PASSED_EG[r];
        if (r >= 4) {
          const ed = Math.max(Math.abs((bk & 7) - f), Math.abs((bk >> 3) - 7));
          const od = Math.max(Math.abs((wk & 7) - f), Math.abs((wk >> 3) - 7));
          eg += (ed - od) * r * 3;
          if (!board[sq + 8]) eg += r * 4;
        }
        // Connected/protected passed pawn bonus
        const protectedPasser = ((wPawnAttacksLo & (sq < 32 ? 1 << sq : 0)) !== 0)
          || ((wPawnAttacksHi & (sq >= 32 ? 1 << (sq - 32) : 0)) !== 0);
        if (protectedPasser) { mg += 10; eg += 18; }
      }
    }

    for (let i = 0; i < bpc; i += 1) {
      const sq = evalBPawnSqs[i];
      const f = sq & 7;
      const r = 7 - (sq >> 3);
      if (evalBFileCount[f] > 1) { mg += 12; eg += 16; }
      const adjMaskLo = ADJ_FILE_LO[f];
      const adjMaskHi = ADJ_FILE_HI[f];
      if ((bPawnsLo & adjMaskLo) === 0 && (bPawnsHi & adjMaskHi) === 0) {
        mg += 11;
        eg += 15;
      } else {
        const defended = ((bPawnAttacksLo & (sq < 32 ? 1 << sq : 0)) !== 0)
          || ((bPawnAttacksHi & (sq >= 32 ? 1 << (sq - 32) : 0)) !== 0);
        if (defended) { mg -= 6; eg -= 8; }
        else {
          const phalanx = (f > 0 && board[sq - 1] === -1) || (f < 7 && board[sq + 1] === -1);
          if (phalanx) { mg -= 5; eg -= 6; }
          else if (evalWFileCount[f] === 0 || (sq - 8 >= 0 && board[sq - 8] !== 1)) {
            const stopSq = sq - 8;
            const stopAttacked = ((wPawnAttacksLo & (stopSq < 32 ? 1 << stopSq : 0)) !== 0)
              || ((wPawnAttacksHi & (stopSq >= 32 ? 1 << (stopSq - 32) : 0)) !== 0);
            if (stopAttacked) {
              const absR = sq >> 3;
              let behindSupport = false;
              for (let rr = 6; rr >= absR; rr -= 1) {
                if ((f > 0 && board[(rr << 3) | (f - 1)] === -1) || (f < 7 && board[(rr << 3) | (f + 1)] === -1)) {
                  behindSupport = true;
                  break;
                }
              }
              if (!behindSupport) { mg += 7; eg += 9; }
            }
          }
        }
      }

      if ((wPawnsLo & PASSED_B_LO[sq]) === 0 && (wPawnsHi & PASSED_B_HI[sq]) === 0) {
        mg -= PASSED_MG[r];
        eg -= PASSED_EG[r];
        if (r >= 4) {
          const ed = Math.max(Math.abs((wk & 7) - f), Math.abs((wk >> 3) - 0));
          const od = Math.max(Math.abs((bk & 7) - f), Math.abs((bk >> 3) - 0));
          eg -= (ed - od) * r * 3;
          if (!board[sq - 8]) eg -= r * 4;
        }
        const protectedPasser = ((bPawnAttacksLo & (sq < 32 ? 1 << sq : 0)) !== 0)
          || ((bPawnAttacksHi & (sq >= 32 ? 1 << (sq - 32) : 0)) !== 0);
        if (protectedPasser) { mg -= 10; eg -= 18; }
      }
    }

    // 2. Bishop pair
    if (wBishops >= 2) { mg += 32; eg += 48; }
    if (bBishops >= 2) { mg -= 32; eg -= 48; }

    // 3. Opening Development, Anti-Blockage & Castling Discipline (NO opening book)
    if (phase >= 12) {
      // Unmoved minors penalty
      mg -= wMinorsHome * 26 + (wMinorsHome >= 3 ? 24 : 0);
      mg += bMinorsHome * 26 + (bMinorsHome >= 3 ? 24 : 0);

      // Active minor development bonuses
      if (board[18] === 2) mg += 16; // Nc3
      if (board[21] === 2) mg += 16; // Nf3
      if (board[26] === 3) mg += 18; // Bc4
      if (board[29] === 3) mg += 18; // Bf4
      if (board[42] === -2) mg -= 16; // Nc6
      if (board[45] === -2) mg -= 16; // Nf6
      if (board[34] === -3) mg -= 18; // Bc5
      if (board[37] === -3) mg -= 18; // Bf5

      // Early Queen sortie penalty while minors sleep
      if (wQueenSq >= 0 && wQueenSq !== 3 && wMinorsHome >= 2) mg -= 28;
      if (bQueenSq >= 0 && bQueenSq !== 59 && bMinorsHome >= 2) mg += 28;

      // Central Pawn Blockage (own piece on d3/e3 blocking unmoved d2/e2 pawn, or blocking home bishops)
      if (board[11] === 1 && board[19] > 0) mg -= 40; // White piece blocking unmoved d2 pawn
      if (board[12] === 1 && board[20] > 0) mg -= 40; // White piece blocking unmoved e2 pawn
      if (board[11] === 1 && board[2] === 3 && board[9] !== 1) mg -= 16; // Bc1 hemmed behind unmoved d2
      if (board[12] === 1 && board[5] === 3 && board[14] !== 1) mg -= 16; // Bf1 hemmed behind unmoved e2
      if (board[11] > 1 && board[2] === 3) mg -= 18; // Own piece on d2 blocking Bc1 diagonal
      if (board[12] > 1 && board[5] === 3) mg -= 18; // Own piece on e2 blocking Bf1 diagonal
      if (board[10] === 1 && board[18] === 2 && board[28] !== 1) mg -= 14; // Nc3 blocking c2 before e4/c4
      if (board[51] === -1 && board[43] < 0) mg += 40; // Black piece blocking unmoved d7 pawn
      if (board[52] === -1 && board[44] < 0) mg += 40; // Black piece blocking unmoved e7 pawn
      if (board[51] === -1 && board[58] === -3 && board[49] !== -1) mg += 16; // Bc8 hemmed behind d7
      if (board[52] === -1 && board[61] === -3 && board[54] !== -1) mg += 16; // Bf8 hemmed behind e7
      if (board[51] < -1 && board[58] === -3) mg += 18; // Own piece on d7 blocking Bc8
      if (board[52] < -1 && board[61] === -3) mg += 18; // Own piece on e7 blocking Bf8
      if (board[50] === -1 && board[42] === -2 && board[36] !== -1) mg += 14; // Nc6 blocking c7 before e5/c5

      // Center control by pawns (d4=27, e4=28, d5=35, e5=36) + pawn attacks on them
      if (board[27] === 1) mg += 18;
      if (board[28] === 1) mg += 18;
      if (board[35] === -1) mg -= 18;
      if (board[36] === -1) mg -= 18;
      if (wPawnAttacksLo & (1 << 27)) mg += 5;
      if (wPawnAttacksLo & (1 << 28)) mg += 5;
      if (wPawnAttacksHi & (1 << (35 - 32))) mg += 7;
      if (wPawnAttacksHi & (1 << (36 - 32))) mg += 7;
      if (bPawnAttacksLo & (1 << 27)) mg -= 7;
      if (bPawnAttacksLo & (1 << 28)) mg -= 7;
      if (bPawnAttacksHi & (1 << (35 - 32))) mg -= 5;
      if (bPawnAttacksHi & (1 << (36 - 32))) mg -= 5;

      // King stuck uncastled with no castling rights while queens on board
      if ((castling & 3) === 0 && wQueenSq >= 0 && bQueenSq >= 0) {
        const wkf = wk & 7;
        const wkr = wk >> 3;
        if (wkr <= 1 && wkf >= 3 && wkf <= 5) mg -= 34;
      }
      if ((castling & 12) === 0 && wQueenSq >= 0 && bQueenSq >= 0) {
        const bkf = bk & 7;
        const bkr = bk >> 3;
        if (bkr >= 6 && bkf >= 3 && bkf <= 5) mg += 34;
      }
    }

    // 4. Absolute & Relative Pin Awareness (slider-aligned checks only: zero wasted rays)
    evalPinned.fill(0);
    const wkf0 = wk & 7;
    const wkr0 = wk >> 3;
    const bkf0 = bk & 7;
    const bkr0 = bk >> 3;
    const wqf0 = wQueenSq >= 0 ? (wQueenSq & 7) : -99;
    const wqr0 = wQueenSq >= 0 ? (wQueenSq >> 3) : -99;
    const bqf0 = bQueenSq >= 0 ? (bQueenSq & 7) : -99;
    const bqr0 = bQueenSq >= 0 ? (bQueenSq >> 3) : -99;

    // Enemy (Black) sliders pinning White pieces to White King or White Queen
    for (let i = 0; i < bmc; i += 1) {
      const pt = evalBPieceTypes[i];
      if (pt < 3) continue;
      const psq = evalBPieceSqs[i];
      const pf = psq & 7;
      const pr = psq >> 3;

      // Check alignment with White King
      let df = pf - wkf0;
      let dr = pr - wkr0;
      const diagK = df === dr || df === -dr;
      const orthK = df === 0 || dr === 0;
      if ((pt === 5 && (diagK || orthK)) || (pt === 3 && diagK) || (pt === 4 && orthK)) {
        const sf = df > 0 ? 1 : df < 0 ? -1 : 0;
        const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
        let f = wkf0 + sf;
        let r = wkr0 + sr;
        let blockerSq = -1;
        while (f !== pf || r !== pr) {
          const sq = (r << 3) | f;
          const p = board[sq];
          if (p) {
            if (blockerSq < 0 && p > 0) blockerSq = sq;
            else { blockerSq = -2; break; }
          }
          f += sf;
          r += sr;
        }
        if (blockerSq >= 0) {
          evalPinned[blockerSq] = 1;
          const bpt = board[blockerSq];
          const absPen = bpt === 1 ? 14 : bpt === 2 ? 32 : bpt === 3 ? 30 : bpt === 4 ? 48 : 24;
          mg -= absPen;
          eg -= absPen;
          const pawnHit = blockerSq < 32
            ? (bPawnAttacksLo & (1 << blockerSq)) !== 0
            : (bPawnAttacksHi & (1 << (blockerSq - 32))) !== 0;
          if (pawnHit && bpt > 1) { mg -= 42; eg -= 38; }
        }
      }

      // Check alignment with White Queen (relative pin)
      if (wQueenSq >= 0) {
        df = pf - wqf0;
        dr = pr - wqr0;
        const diagQ = df === dr || df === -dr;
        const orthQ = df === 0 || dr === 0;
        if ((pt === 5 && (diagQ || orthQ)) || (pt === 3 && diagQ) || (pt === 4 && orthQ)) {
          const sf = df > 0 ? 1 : df < 0 ? -1 : 0;
          const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
          let f = wqf0 + sf;
          let r = wqr0 + sr;
          let blockerSq = -1;
          while (f !== pf || r !== pr) {
            const sq = (r << 3) | f;
            const p = board[sq];
            if (p) {
              if (blockerSq < 0 && p > 0) blockerSq = sq;
              else { blockerSq = -2; break; }
            }
            f += sf;
            r += sr;
          }
          if (blockerSq >= 0 && !evalPinned[blockerSq]) {
            evalPinned[blockerSq] = 2;
            mg -= 22;
            eg -= 18;
          }
        }
      }
    }

    // White sliders pinning Black pieces to Black King or Black Queen
    for (let i = 0; i < wmc; i += 1) {
      const pt = evalWPieceTypes[i];
      if (pt < 3) continue;
      const psq = evalWPieceSqs[i];
      const pf = psq & 7;
      const pr = psq >> 3;

      let df = pf - bkf0;
      let dr = pr - bkr0;
      const diagK = df === dr || df === -dr;
      const orthK = df === 0 || dr === 0;
      if ((pt === 5 && (diagK || orthK)) || (pt === 3 && diagK) || (pt === 4 && orthK)) {
        const sf = df > 0 ? 1 : df < 0 ? -1 : 0;
        const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
        let f = bkf0 + sf;
        let r = bkr0 + sr;
        let blockerSq = -1;
        while (f !== pf || r !== pr) {
          const sq = (r << 3) | f;
          const p = board[sq];
          if (p) {
            if (blockerSq < 0 && p < 0) blockerSq = sq;
            else { blockerSq = -2; break; }
          }
          f += sf;
          r += sr;
        }
        if (blockerSq >= 0) {
          evalPinned[blockerSq] = 1;
          const bpt = -board[blockerSq];
          const absPen = bpt === 1 ? 14 : bpt === 2 ? 32 : bpt === 3 ? 30 : bpt === 4 ? 48 : 24;
          mg += absPen;
          eg += absPen;
          const pawnHit = blockerSq < 32
            ? (wPawnAttacksLo & (1 << blockerSq)) !== 0
            : (wPawnAttacksHi & (1 << (blockerSq - 32))) !== 0;
          if (pawnHit && bpt > 1) { mg += 42; eg += 38; }
        }
      }

      if (bQueenSq >= 0) {
        df = pf - bqf0;
        dr = pr - bqr0;
        const diagQ = df === dr || df === -dr;
        const orthQ = df === 0 || dr === 0;
        if ((pt === 5 && (diagQ || orthQ)) || (pt === 3 && diagQ) || (pt === 4 && orthQ)) {
          const sf = df > 0 ? 1 : df < 0 ? -1 : 0;
          const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
          let f = bqf0 + sf;
          let r = bqr0 + sr;
          let blockerSq = -1;
          while (f !== pf || r !== pr) {
            const sq = (r << 3) | f;
            const p = board[sq];
            if (p) {
              if (blockerSq < 0 && p < 0) blockerSq = sq;
              else { blockerSq = -2; break; }
            }
            f += sf;
            r += sr;
          }
          if (blockerSq >= 0 && !evalPinned[blockerSq]) {
            evalPinned[blockerSq] = 2;
            mg += 22;
            eg += 18;
          }
        }
      }
    }

    // 5. Piece Mobility, Outposts, Rook Files & Trapped Bishop Detection
    for (let i = 0; i < wmc; i += 1) {
      const sq = evalWPieceSqs[i];
      const t = evalWPieceTypes[i];
      const f = sq & 7;
      const r = sq >> 3;

      if (t === 2) {
        // Outpost on ranks 3..5 defended by pawn and not attacked by black pawn
        if (r >= 3 && r <= 5 && f >= 1 && f <= 6) {
          const sup = sq < 32 ? (wPawnAttacksLo & (1 << sq)) !== 0 : (wPawnAttacksHi & (1 << (sq - 32))) !== 0;
          if (sup) {
            let bPawnThreat = false;
            for (let rr = r + 1; rr <= 6; rr += 1) {
              if ((f > 0 && board[(rr << 3) | (f - 1)] === -1) || (f < 7 && board[(rr << 3) | (f + 1)] === -1)) {
                bPawnThreat = true;
                break;
              }
            }
            if (!bPawnThreat) { mg += 18; eg += 12; }
          }
        }
        // Safe knight mobility
        const mobLo = KNIGHT_ATTACK_LO[sq] & ~bPawnAttacksLo;
        const mobHi = KNIGHT_ATTACK_HI[sq] & ~bPawnAttacksHi;
        const mob = popcount32(mobLo) + popcount32(mobHi);
        const bonus = (mob - 3) * 4;
        mg += bonus;
        eg += bonus;
      } else if (t === 3) {
        let mob = 0;
        let pseudoMob = 0;
        for (let d = 0; d < 4; d += 1) {
          const df = ALL_DF[d];
          const dr = ALL_DR[d];
          let ff = f + df;
          let rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const tsq = (rr << 3) | ff;
            const occ = board[tsq];
            const bHit = tsq < 32 ? (bPawnAttacksLo & (1 << tsq)) !== 0 : (bPawnAttacksHi & (1 << (tsq - 32))) !== 0;
            if (!occ) {
              pseudoMob += 1;
              if (!bHit) mob += 1;
            } else {
              if (occ < 0) {
                pseudoMob += 1;
                if (!bHit) mob += 1;
              }
              break;
            }
            ff += df;
            rr += dr;
          }
        }
        if (pseudoMob <= 1) { mg -= 22; eg -= 16; }
        const bonus = (mob - 5) * 4;
        mg += bonus;
        eg += bonus;
      } else if (t === 4) {
        if (evalWFileCount[f] === 0) {
          if (evalBFileCount[f] === 0) { mg += 28; eg += 16; }
          else { mg += 15; eg += 10; }
        }
        if (r === 6) { mg += 22; eg += 20; }
        let mob = 0;
        for (let d = 4; d < 8; d += 1) {
          const df = ALL_DF[d];
          const dr = ALL_DR[d];
          let ff = f + df;
          let rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const tsq = (rr << 3) | ff;
            const occ = board[tsq];
            if (!occ) mob += 1;
            else {
              if (occ < 0) mob += 1;
              break;
            }
            ff += df;
            rr += dr;
          }
        }
        mg += (mob - 5) * 2;
        eg += (mob - 5) * 3;
      }
    }

    for (let i = 0; i < bmc; i += 1) {
      const sq = evalBPieceSqs[i];
      const t = evalBPieceTypes[i];
      const f = sq & 7;
      const r = sq >> 3;

      if (t === 2) {
        if (r >= 2 && r <= 4 && f >= 1 && f <= 6) {
          const sup = sq < 32 ? (bPawnAttacksLo & (1 << sq)) !== 0 : (bPawnAttacksHi & (1 << (sq - 32))) !== 0;
          if (sup) {
            let wPawnThreat = false;
            for (let rr = r - 1; rr >= 1; rr -= 1) {
              if ((f > 0 && board[(rr << 3) | (f - 1)] === 1) || (f < 7 && board[(rr << 3) | (f + 1)] === 1)) {
                wPawnThreat = true;
                break;
              }
            }
            if (!wPawnThreat) { mg -= 18; eg -= 12; }
          }
        }
        const mobLo = KNIGHT_ATTACK_LO[sq] & ~wPawnAttacksLo;
        const mobHi = KNIGHT_ATTACK_HI[sq] & ~wPawnAttacksHi;
        const mob = popcount32(mobLo) + popcount32(mobHi);
        const bonus = (mob - 3) * 4;
        mg -= bonus;
        eg -= bonus;
      } else if (t === 3) {
        let mob = 0;
        let pseudoMob = 0;
        for (let d = 0; d < 4; d += 1) {
          const df = ALL_DF[d];
          const dr = ALL_DR[d];
          let ff = f + df;
          let rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const tsq = (rr << 3) | ff;
            const occ = board[tsq];
            const wHit = tsq < 32 ? (wPawnAttacksLo & (1 << tsq)) !== 0 : (wPawnAttacksHi & (1 << (tsq - 32))) !== 0;
            if (!occ) {
              pseudoMob += 1;
              if (!wHit) mob += 1;
            } else {
              if (occ > 0) {
                pseudoMob += 1;
                if (!wHit) mob += 1;
              }
              break;
            }
            ff += df;
            rr += dr;
          }
        }
        if (pseudoMob <= 1) { mg += 22; eg += 16; }
        const bonus = (mob - 5) * 4;
        mg -= bonus;
        eg -= bonus;
      } else if (t === 4) {
        if (evalBFileCount[f] === 0) {
          if (evalWFileCount[f] === 0) { mg -= 28; eg -= 16; }
          else { mg -= 15; eg -= 10; }
        }
        if (r === 1) { mg -= 22; eg -= 20; }
        let mob = 0;
        for (let d = 4; d < 8; d += 1) {
          const df = ALL_DF[d];
          const dr = ALL_DR[d];
          let ff = f + df;
          let rr = r + dr;
          while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
            const tsq = (rr << 3) | ff;
            const occ = board[tsq];
            if (!occ) mob += 1;
            else {
              if (occ > 0) mob += 1;
              break;
            }
            ff += df;
            rr += dr;
          }
        }
        mg -= (mob - 5) * 2;
        eg -= (mob - 5) * 3;
      }
    }

    // 6. King Pawn Shield & Open Files Near King
    const wkf = wk & 7;
    const wkr = wk >> 3;
    let wShield = 0;
    if (wkr < 7) {
      for (let df = -1; df <= 1; df += 1) {
        const ff = wkf + df;
        if (ff < 0 || ff > 7) continue;
        const sq1 = ((wkr + 1) << 3) | ff;
        if (board[sq1] === 1) wShield += 14;
        else if (wkr < 6 && board[((wkr + 2) << 3) | ff] === 1) wShield += 6;
        else if (evalWFileCount[ff] === 0 && bQueenSq >= 0) wShield -= 10;
      }
    }
    mg += wShield;

    const bkf = bk & 7;
    const bkr = bk >> 3;
    let bShield = 0;
    if (bkr > 0) {
      for (let df = -1; df <= 1; df += 1) {
        const ff = bkf + df;
        if (ff < 0 || ff > 7) continue;
        const sq1 = ((bkr - 1) << 3) | ff;
        if (board[sq1] === -1) bShield += 14;
        else if (bkr > 1 && board[((bkr - 2) << 3) | ff] === -1) bShield += 6;
        else if (evalBFileCount[ff] === 0 && wQueenSq >= 0) bShield -= 10;
      }
    }
    mg -= bShield;

    // 7. Material-Aware Trade Discipline (avoid equal piece trades when down; simplify when up)
    const rawDiff = wRawMat - bRawMat;
    if (rawDiff >= 120) {
      const scale = Math.min(2.2, (rawDiff - 60) / 180);
      const tradedPhase = 24 - Math.min(24, wPhase + bPhase);
      const bonus = Math.round(tradedPhase * scale * 2.5);
      mg += bonus;
      eg += bonus;
    } else if (rawDiff <= -120) {
      const scale = Math.min(2.2, (-rawDiff - 60) / 180);
      const tradedPhase = 24 - Math.min(24, wPhase + bPhase);
      const penalty = Math.round(tradedPhase * scale * 2.7);
      mg -= penalty;
      eg -= penalty;
    }

    const clampedPhase = phase > 24 ? 24 : phase;
    let score = (mg * clampedPhase + eg * (24 - clampedPhase)) / 24;

    // Mop-up push in heavily won non-bare-king endgames too (e.g. Q vs R or R+2P vs P)
    if (clampedPhase <= 6 && Math.abs(eg) > 450) {
      const winner = eg > 0 ? 1 : -1;
      const winKing = winner > 0 ? wk : bk;
      const loseKing = winner > 0 ? bk : wk;
      const edge = Math.max(Math.abs(2 * (loseKing & 7) - 7), Math.abs(2 * (loseKing >> 3) - 7));
      const prox = 14 - Math.abs((winKing & 7) - (loseKing & 7)) - Math.abs((winKing >> 3) - (loseKing >> 3));
      score += winner * (edge * 14 + prox * 8);
    }

    const value = Math.round(score * side) + 8;
    evalCacheKeyHi[cacheIndex] = hashHi;
    evalCacheKeyLo[cacheIndex] = hashLo;
    evalCacheScore[cacheIndex] = value;
    evalCacheValid[cacheIndex] = 1;
    return value;
  }

  function isRepetitionOrFiftyMove(ply) {
    if (halfmove >= 100) return true;
    if (halfmove < 4) return false;
    // Check search path (step back by 2 plies within halfmove window)
    const minSearchIdx = Math.max(0, ply - halfmove);
    let hits = 0;
    for (let i = ply - 2; i >= minSearchIdx; i -= 2) {
      if (repPathHi[i] === hashHi && repPathLo[i] === hashLo) {
        // Immediate 2-fold inside search is treated as draw score 0 to avoid repetition loops
        return true;
      }
    }
    // For short games, the original tiny linear scan is cheaper. Switch to
    // indexed lookup once the game history is large enough to justify hashing.
    if (rootHistLen < 8) {
      for (let i = 0; i < rootHistLen; i += 1) {
        if (rootHistHi[i] === hashHi && rootHistLo[i] === hashLo) return true;
      }
      return false;
    }
    return hasRootHistoryHash(hashHi, hashLo);
  }

  function hasNonPawnMaterial(s) {
    if (s === 1) return (pieceCnt[2] + pieceCnt[3] + pieceCnt[4] + pieceCnt[5]) > 0;
    return (pieceCnt[9] + pieceCnt[10] + pieceCnt[11] + pieceCnt[12]) > 0;
  }

  function isInsufficientMaterial() {
    if (pieceCnt[1] || pieceCnt[8] || pieceCnt[4] || pieceCnt[11] || pieceCnt[5] || pieceCnt[12]) return false;
    const wm = pieceCnt[2] + pieceCnt[3];
    const bm = pieceCnt[9] + pieceCnt[10];
    if (wm === 0 && bm === 0) return true;
    if (wm + bm === 1) return true;
    if (pieceCnt[2] || pieceCnt[9]) return false;
    // Only bishops remain (>= 2): insufficient only if all bishops share one square color
    let color = -1;
    for (let pass = 0; pass < 2; pass += 1) {
      let bits = pass === 0 ? (wOccLo | bOccLo) : (wOccHi | bOccHi);
      const sqBase = pass === 0 ? 0 : 32;
      while (bits !== 0) {
        const lsb = bits & -bits;
        bits ^= lsb;
        const sq = sqBase + 31 - Math.clz32(lsb);
        const p = board[sq];
        if (p === 3 || p === -3) {
          const c = ((sq & 7) + (sq >> 3)) & 1;
          if (color === -1) color = c;
          else if (color !== c) return false;
        }
      }
    }
    return true;
  }

  function scoreMoves(ply, count, ttBestMove, prevMove, inQ) {
    const base = ply << 8;
    const sideIdx = side === 1 ? 0 : 4096;
    const k1 = killer1[ply];
    const k2 = killer2[ply];
    const cm = prevMove ? counterMoves[((prevMove & 63) << 6) | ((prevMove >>> 6) & 63)] : 0;

    for (let i = 0; i < count; i += 1) {
      const m = moveBuf[base + i];
      if (m === ttBestMove) {
        scoreBuf[base + i] = 100000000;
        continue;
      }
      const promo = (m >>> 18) & 7;
      const cap = (m >>> 15) & 7;
      const piece = (m >>> 12) & 7;
      if (cap || promo) {
        const see = seeCapture(m);
        if (see >= 0) {
          scoreBuf[base + i] = 50000000 + see * 16 + (promo ? MG_VAL[promo] * 4 : 0) + cap * 128 - piece;
        } else if (inQ) {
          scoreBuf[base + i] = -1000000 + see;
        } else {
          scoreBuf[base + i] = -50000 + see;
        }
        continue;
      }
      if (m === k1) scoreBuf[base + i] = 40000000;
      else if (m === k2) scoreBuf[base + i] = 35000000;
      else if (m === cm) scoreBuf[base + i] = 30000000;
      else {
        const from = m & 63;
        const to = (m >>> 6) & 63;
        let h = historyTable[sideIdx + (from << 6) + to];
        const flags = (m >>> 21) & 15;
        if (flags & 12) h += 6000; // Prefer castling early in move ordering
        scoreBuf[base + i] = h;
      }
    }
  }

  function pickNextMove(ply, start, count) {
    const base = ply << 8;
    let bestIdx = start;
    let bestSc = scoreBuf[base + start];
    for (let i = start + 1; i < count; i += 1) {
      const sc = scoreBuf[base + i];
      if (sc > bestSc) {
        bestSc = sc;
        bestIdx = i;
      }
    }
    if (bestIdx !== start) {
      const tm = moveBuf[base + start];
      moveBuf[base + start] = moveBuf[base + bestIdx];
      moveBuf[base + bestIdx] = tm;
      const ts = scoreBuf[base + start];
      scoreBuf[base + start] = scoreBuf[base + bestIdx];
      scoreBuf[base + bestIdx] = ts;
    }
    return moveBuf[base + start];
  }

  function checkTimeBudget() {
    if ((nodeCount & 1023) === 0) {
      if (nodeCount >= hardNodeLimit || (searchDeadline > 0 && performance.now() >= searchDeadline)) {
        abortSearch = true;
      }
    }
  }

  function qsearch(alpha, beta, ply, qDepth) {
    nodeCount += 1;
    checkTimeBudget();
    if (abortSearch) return alpha;

    if (ply >= MAX_PLY - 1) return evaluate();
    if (isRepetitionOrFiftyMove(ply) || isInsufficientMaterial()) return 0;

    const myKing = side === 1 ? wk : bk;
    const inCheck = isSquareAttacked(myKing, -side);

    let standPat = -INF;
    if (!inCheck) {
      // Bare-king / low-material stalemate guard at qsearch leaves
      const nonKings = side === 1
        ? (pieceCnt[1] + pieceCnt[2] + pieceCnt[3] + pieceCnt[4] + pieceCnt[5])
        : (pieceCnt[8] + pieceCnt[9] + pieceCnt[10] + pieceCnt[11] + pieceCnt[12]);
      if (nonKings === 0) {
        const kf = myKing & 7;
        const kr = myKing >> 3;
        let hasKingEscape = false;
        for (let d = 0; d < 8; d += 1) {
          const nf = kf + ALL_DF[d];
          const nr = kr + ALL_DR[d];
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          const nsq = (nr << 3) | nf;
          const occ = board[nsq];
          if (occ && (occ > 0 ? 1 : -1) === side) continue;
          if (!isSquareAttacked(nsq, -side)) { hasKingEscape = true; break; }
        }
        if (!hasKingEscape) return 0; // Stalemate!
      }
      standPat = evaluate();
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (qDepth <= 0) return standPat;
    } else if (qDepth <= -4) {
      return evaluate();
    }

    const count = generatePseudoMoves(ply, !inCheck);
    scoreMoves(ply, count, 0, 0, true);
    const base = ply << 8;
    let legalCount = 0;

    repPathHi[ply] = hashHi;
    repPathLo[ply] = hashLo;

    for (let i = 0; i < count; i += 1) {
      const m = pickNextMove(ply, i, count);
      const sc = scoreBuf[base + i];
      if (!inCheck && sc < 0) continue; // SEE < 0 capture pruning in quiescence!

      const cap = (m >>> 15) & 7;
      const promo = (m >>> 18) & 7;
      if (!inCheck && !promo && standPat + MG_VAL[cap] + 160 < alpha) continue; // Delta pruning

      if (!makeMove(m, ply, inCheck)) continue;
      legalCount += 1;
      const score = -qsearch(-beta, -alpha, ply + 1, qDepth - 1);
      unmakeMove(m, ply);
      if (abortSearch) return alpha;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    if (inCheck && legalCount === 0) return -MATE_SCORE + ply;
    return alpha;
  }

  // Fast geometric pre-check before calling isSquareAttacked on enemy king after a move
  function moveProbablyChecks(m) {
    const oppKing = side === 1 ? wk : bk; // Note: called AFTER makeMove, so `side` is now opponent!
    const okf = oppKing & 7;
    const okr = oppKing >> 3;
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const flags = (m >>> 21) & 15;
    if (flags & 14) return isSquareAttacked(oppKing, -side); // ep or castling: full check
    const promo = (m >>> 18) & 7;
    const pt = promo || ((m >>> 12) & 7);
    const tf = to & 7;
    const tr = to >> 3;
    const dtf = tf - okf;
    const dtr = tr - okr;
    let directPossible = false;
    if (pt === 1) {
      // Opponent pawn attacks oppKing? Mover was `-side`
      directPossible = (dtr === side) && (dtf === 1 || dtf === -1);
    } else if (pt === 2) {
      directPossible = (oppKing < 32 ? (KNIGHT_ATTACK_LO[oppKing] & (to < 32 ? 1 << to : 0)) !== 0
        : (KNIGHT_ATTACK_HI[oppKing] & (to >= 32 ? 1 << (to - 32) : 0)) !== 0)
        || (to < 32 ? (KNIGHT_ATTACK_LO[to] & (oppKing < 32 ? 1 << oppKing : 0)) !== 0
        : (KNIGHT_ATTACK_HI[to] & (oppKing >= 32 ? 1 << (oppKing - 32) : 0)) !== 0);
    } else if (pt === 3) {
      directPossible = dtf === dtr || dtf === -dtr;
    } else if (pt === 4) {
      directPossible = dtf === 0 || dtr === 0;
    } else if (pt === 5) {
      directPossible = dtf === 0 || dtr === 0 || dtf === dtr || dtf === -dtr;
    }
    if (directPossible) return isSquareAttacked(oppKing, -side);
    // Check discovered check alignment from `from` to `oppKing`
    const dff = (from & 7) - okf;
    const dfr = (from >> 3) - okr;
    if (dff === 0 || dfr === 0 || dff === dfr || dff === -dfr) {
      return isSquareAttacked(oppKing, -side);
    }
    return false;
  }

  function alphaBeta(depth, alpha, beta, ply, allowNull, prevMove) {
    if (depth <= 0) return qsearch(alpha, beta, ply, 7);

    nodeCount += 1;
    checkTimeBudget();
    if (abortSearch) return alpha;

    if (ply >= MAX_PLY - 1) return evaluate();
    if (ply > 0 && (isRepetitionOrFiftyMove(ply) || isInsufficientMaterial())) {
      if (armx11Mode && armx11Contempt) {
        return side === rootSide ? -armx11Contempt : armx11Contempt;
      }
      return 0;
    }

    const isPV = (beta - alpha) > 1;
    const origAlpha = alpha;

    // Transposition table probe
    const ttIdx = (hashHi ^ hashLo) & TT_MASK;
    let ttBest = 0;
    if (ttFlag[ttIdx] !== 0 && ttKeyHi[ttIdx] === hashHi && ttKeyLo[ttIdx] === hashLo) {
      ttBest = ttMove[ttIdx];
      if (!isPV && ttDepth[ttIdx] >= depth) {
        let ttVal = ttScore[ttIdx];
        if (ttVal > MATE_BOUND) ttVal -= ply;
        else if (ttVal < -MATE_BOUND) ttVal += ply;
        const flag = ttFlag[ttIdx];
        if (flag === 1) return ttVal;
        if (flag === 2 && ttVal >= beta) return ttVal;
        if (flag === 3 && ttVal <= alpha) return ttVal;
      }
    }

    const myKing = side === 1 ? wk : bk;
    const inCheck = isSquareAttacked(myKing, -side);

    // Check extension (keeps tactical accuracy high at deep plies)
    if (inCheck && ply < 16) depth += 1;
    // Internal Iterative Reduction when no TT move at deep non-check nodes
    if (!inCheck && depth >= 4 && ttBest === 0) depth -= 1;

    let staticEval = 0;
    let improving = false;
    staticEvalStack[ply] = -INF;
    if (!inCheck && !isPV) {
      staticEval = evaluate();
      staticEvalStack[ply] = staticEval;
      improving = armx11Mode && ply >= 2 && staticEvalStack[ply - 2] > -INF && staticEval > staticEvalStack[ply - 2];

      // Reverse Futility Pruning (static null move pruning)
      if (depth <= 4 && Math.abs(beta) < MATE_BOUND) {
        const margin = (armx11Mode && !improving ? 68 : 82) * depth;
        if (staticEval - margin >= beta) return staticEval - margin;
      }

      // Razoring at depth 1
      if (depth === 1 && staticEval + 130 <= alpha && Math.abs(alpha) < MATE_BOUND) {
        return qsearch(alpha, beta, ply, 6);
      }

      // Null Move Pruning
      if (allowNull && depth >= 3 && staticEval >= beta && Math.abs(beta) < MATE_BOUND && hasNonPawnMaterial(side)) {
        const R = (depth >= 6 ? 3 : 2) + (armx11Mode && staticEval - beta >= 240 ? 1 : 0);
        repPathHi[ply] = hashHi;
        repPathLo[ply] = hashLo;
        makeNullMove(ply);
        const nullScore = -alphaBeta(depth - 1 - R, -beta, -beta + 1, ply + 1, false, 0);
        unmakeNullMove(ply);
        if (abortSearch) return alpha;
        if (nullScore >= beta) return beta;
      }

      // ARMX 1.1 ProbCut: verify strong captures at depth >= 5 to prune huge fail-high subtrees
      if (armx11Mode && depth >= 5 && Math.abs(beta) < MATE_BOUND && staticEval + 900 >= beta + 155) {
        const probBeta = beta + 155;
        const pcCount = generatePseudoMoves(ply, true);
        scoreMoves(ply, pcCount, ttBest, prevMove, true);
        const pcBase = ply << 8;
        repPathHi[ply] = hashHi;
        repPathLo[ply] = hashLo;
        for (let pi = 0; pi < pcCount; pi += 1) {
          const pm = pickNextMove(ply, pi, pcCount);
          if (scoreBuf[pcBase + pi] < 50000000) break;
          if (!makeMove(pm, ply, false)) continue;
          let pScore = -qsearch(-probBeta, -probBeta + 1, ply + 1, 5);
          if (pScore >= probBeta && !abortSearch) {
            pScore = -alphaBeta(depth - 4, -probBeta, -probBeta + 1, ply + 1, false, pm);
          }
          unmakeMove(pm, ply);
          if (abortSearch) return alpha;
          if (pScore >= probBeta) return probBeta;
        }
      }
    }

    const count = generatePseudoMoves(ply, false);
    scoreMoves(ply, count, ttBest, prevMove, false);
    const base = ply << 8;

    let legalMoves = 0;
    let bestScore = -INF;
    let bestMove = 0;
    const canFutility = !inCheck && !isPV && depth <= 2 && Math.abs(alpha) < MATE_BOUND
      && (staticEval + (depth === 1 ? (armx11Mode && !improving ? 120 : 140) : (armx11Mode && !improving ? 235 : 270)) <= alpha);
    const lmpLimit = !inCheck && !isPV && depth <= 3
      ? ((armx11Mode && !improving ? 2 : 3) + depth * depth * (armx11Mode && !improving ? 1.5 : 2)) | 0
      : 999;

    repPathHi[ply] = hashHi;
    repPathLo[ply] = hashLo;

    for (let i = 0; i < count; i += 1) {
      const m = pickNextMove(ply, i, count);
      const isCapture = ((m >>> 15) & 7) !== 0;
      const isPromo = ((m >>> 18) & 7) !== 0;
      const isQuiet = !isCapture && !isPromo;

      // SEE capture pruning near leaves for clearly losing captures
      if (!inCheck && !isPV && depth <= 2 && isCapture && !isPromo && legalMoves >= 1 && scoreBuf[base + i] < 0) {
        continue;
      }

      if (!makeMove(m, ply, inCheck)) continue;
      legalMoves += 1;

      const givesCheck = (isQuiet && (canFutility || legalMoves >= 3 || legalMoves > lmpLimit))
        ? moveProbablyChecks(m)
        : false;

      // Late Move & Futility pruning for hopeless quiet moves near leaves
      if ((canFutility || legalMoves > lmpLimit) && legalMoves > 1 && isQuiet && !givesCheck) {
        unmakeMove(m, ply);
        continue;
      }

      // Passed-pawn / 7th-rank push extension under ARMX 1.1
      let ext = 0;
      if (armx11Mode && ply < 16 && ((m >>> 12) & 7) === 1 && !isPromo) {
        const destRank = ((m >>> 6) & 63) >> 3;
        if ((side === -1 && destRank >= 5) || (side === 1 && destRank <= 2)) ext = 1;
      }

      let score;
      if (legalMoves === 1) {
        score = -alphaBeta(depth - 1 + ext, -beta, -alpha, ply + 1, true, m);
      } else {
        // Logarithmic Late Move Reductions (LMR) via lookup table
        let reduction = 0;
        if (depth >= 3 && legalMoves >= 3 && isQuiet && !inCheck && !givesCheck && ext === 0) {
          reduction = LMR_TABLE[((depth < 31 ? depth : 31) << 6) | (legalMoves < 63 ? legalMoves : 63)];
          if (armx11Mode && !improving && legalMoves >= 6) reduction += 1;
          if (m === killer1[ply] || m === killer2[ply]) reduction = Math.max(0, reduction - 1);
          if (reduction >= depth - 1) reduction = depth - 2;
        }

        score = -alphaBeta(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true, m);
        if (reduction > 0 && score > alpha && !abortSearch) {
          score = -alphaBeta(depth - 1, -alpha - 1, -alpha, ply + 1, true, m);
        }
        if (score > alpha && score < beta && !abortSearch) {
          score = -alphaBeta(depth - 1, -beta, -alpha, ply + 1, true, m);
        }
      }

      unmakeMove(m, ply);
      if (abortSearch) return alpha;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (isQuiet) {
              if (killer1[ply] !== m) {
                killer2[ply] = killer1[ply];
                killer1[ply] = m;
              }
              const sIdx = side === 1 ? 0 : 4096;
              const sqIdx = ((m & 63) << 6) | ((m >>> 6) & 63);
              const bonus = depth * depth;
              let hVal = historyTable[sIdx + sqIdx] + bonus;
              if (hVal > 2000000) hVal >>= 1;
              historyTable[sIdx + sqIdx] = hVal;
              if (prevMove) {
                counterMoves[((prevMove & 63) << 6) | ((prevMove >>> 6) & 63)] = m;
              }
            }
            break;
          }
        }
      }
    }

    if (legalMoves === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    // Store in TT
    if (ttAge[ttIdx] !== searchAge || ttDepth[ttIdx] <= depth) {
      let storeVal = bestScore;
      if (storeVal > MATE_BOUND) storeVal += ply;
      else if (storeVal < -MATE_BOUND) storeVal -= ply;
      ttKeyHi[ttIdx] = hashHi;
      ttKeyLo[ttIdx] = hashLo;
      ttMove[ttIdx] = bestMove;
      ttScore[ttIdx] = storeVal;
      ttDepth[ttIdx] = depth;
      ttAge[ttIdx] = searchAge;
      ttFlag[ttIdx] = bestScore <= origAlpha ? 3 : bestScore >= beta ? 2 : 1;
    }

    return bestScore;
  }

  function estimateRemainingPhase() {
    const ph = (pieceCnt[2] + pieceCnt[3] + pieceCnt[9] + pieceCnt[10])
      + 2 * (pieceCnt[4] + pieceCnt[11])
      + 4 * (pieceCnt[5] + pieceCnt[12]);
    let nonKingPieces = 0;
    for (let t = 1; t <= 5; t += 1) nonKingPieces += pieceCnt[t] + pieceCnt[7 + t];
    return { phase: ph > 24 ? 24 : ph, pieces: nonKingPieces };
  }

  function matchRawMove(legalList, m) {
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const promo = (m >>> 18) & 7;
    for (let i = 0; i < legalList.length; i += 1) {
      const r = legalList[i];
      if (r.from === from && r.to === to && (r.promotion || 0) === promo) return r;
    }
    return null;
  }

  function decodeMoveToPublic(game, m) {
    const raw = matchRawMove(game.fastMoves(), m);
    if (raw) {
      return typeof game._publicMove === 'function'
        ? game._publicMove(raw, false)
        : {
          from: game._alg(raw.from),
          to: game._alg(raw.to),
          promotion: raw.promotion ? game._typeChar(raw.promotion) : undefined,
          _raw: raw
        };
    }
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const promo = (m >>> 18) & 7;
    return {
      from: game._alg(from),
      to: game._alg(to),
      promotion: promo ? game._typeChar(promo) : undefined
    };
  }

  function getStonefishV61Move(game, options = null) {
    if (!game) return null;
    const evalHitsBefore = evalCacheHits;
    const evalMissesBefore = evalCacheMisses;
    loadFromGame(game);
    rootSide = side;

    const rootCount = generatePseudoMoves(0, false);
    if (!rootCount) return null;

    const rootInCheck = isSquareAttacked(side === 1 ? wk : bk, -side);

    // Filter strictly legal root moves once
    const rootMoves = [];
    for (let i = 0; i < rootCount; i += 1) {
      const m = moveBuf[i];
      if (makeMove(m, 0, rootInCheck)) {
        unmakeMove(m, 0);
        rootMoves.push(m);
      }
    }
    if (!rootMoves.length) return null;
    if (rootMoves.length === 1) return decodeMoveToPublic(game, rootMoves[0]);

    // Prepare search iteration state
    searchAge = (searchAge + 1) & 0xFFFF;
    if (searchAge === 0) {
      ttFlag.fill(0);
      searchAge = 1;
    }
    killer1.fill(0);
    killer2.fill(0);
    for (let i = 0; i < historyTable.length; i += 1) historyTable[i] >>= 2;

    const phaseInfo = estimateRemainingPhase();
    const { phase, pieces } = phaseInfo;

    let targetDepth = (phase <= 4 || pieces <= 5 ? 11 : phase <= 10 ? 9 : 8);
    let maxTimeMs = (phase <= 4 ? 56 : 48);
    softNodeLimit = 54000;
    hardNodeLimit = 160000;
    armx11Contempt = 0;

    let armx11Plan = null;
    if (typeof armx11PlanSearch === 'function') {
      armx11Plan = armx11PlanSearch(game, phaseInfo);
      targetDepth = armx11Plan.targetDepth;
      maxTimeMs = armx11Plan.maxTimeMs;
      softNodeLimit = armx11Plan.softNodes;
      hardNodeLimit = armx11Plan.hardNodes;
      armx11Contempt = armx11Plan.contempt || 0;
    }

    if (options && options.maxDepth) targetDepth = options.maxDepth;
    if (options && options.maxTimeMs) maxTimeMs = options.maxTimeMs;
    if (options && options.softNodes) softNodeLimit = options.softNodes;
    if (options && options.hardNodes) hardNodeLimit = options.hardNodes;

    const startTime = performance.now();
    searchDeadline = startTime + maxTimeMs;
    nodeCount = 0;
    abortSearch = false;

    // Root static pre-order
    const rootScores = new Int32Array(rootMoves.length);
    for (let i = 0; i < rootMoves.length; i += 1) {
      const m = rootMoves[i];
      const cap = (m >>> 15) & 7;
      const promo = (m >>> 18) & 7;
      const flags = (m >>> 21) & 15;
      let s = 0;
      if (cap || promo) s += seeCapture(m) * 4 + 2000;
      if (flags & 12) s += 300;
      makeMove(m, 0, rootInCheck);
      s += -evaluate();
      unmakeMove(m, 0);
      rootScores[i] = s;
    }
    for (let i = 1; i < rootMoves.length; i += 1) {
      const m = rootMoves[i];
      const sc = rootScores[i];
      let j = i - 1;
      while (j >= 0 && rootScores[j] < sc) {
        rootMoves[j + 1] = rootMoves[j];
        rootScores[j + 1] = rootScores[j];
        j -= 1;
      }
      rootMoves[j + 1] = m;
      rootScores[j + 1] = sc;
    }

    // v6-compatible full-width root search; only the exact best move is
    // promoted between iterations. Null-window fail-low scores are bounds,
    // not reliable ordering scores for all root candidates.
    const rootSearchWidth = rootMoves.length;

    let bestMove = rootMoves[0];
    let prevScore = 0;
    let prevPrevScore = 0;
    let prevBestMove = 0;
    let completedDepth = 0;
    let secondBestGap = 0;

    repPathHi[0] = hashHi;
    repPathLo[0] = hashLo;

    for (let depth = 1; depth <= targetDepth; depth += 1) {
      const breakFrac = depth <= 7 ? 0.88 : 0.82;
      if (depth >= 5 && (nodeCount >= softNodeLimit || performance.now() >= startTime + maxTimeMs * breakFrac)) {
        break;
      }

      // ARMX 1.1 Easy-Move early stop when move 0 dominates cleanly and score is stable
      if (depth >= 7 && completedDepth >= 6 && bestMove === prevBestMove
        && secondBestGap >= 135 && Math.abs(prevScore - prevPrevScore) < 20
        && Math.abs(prevScore) < MATE_BOUND) {
        break;
      }

      let alpha = -INF;
      let beta = INF;
      let delta = 60;
      if (depth >= 4 && Math.abs(prevScore) < MATE_BOUND) {
        alpha = prevScore - delta;
        beta = prevScore + delta;
      }

      let iterBestMove = bestMove;
      let iterBestScore = -INF;
      let iterSecondScore = -INF;
      const searchCount = depth <= 2 ? rootMoves.length : rootSearchWidth;

      while (true) {
        abortSearch = false;
        let curAlpha = alpha;
        iterBestScore = -INF;
        iterSecondScore = -INF;
        iterBestMove = rootMoves[0];

        for (let i = 0; i < searchCount; i += 1) {
          const m = rootMoves[i];
          makeMove(m, 0, rootInCheck);
          let sc;
          if (i === 0) {
            sc = -alphaBeta(depth - 1, -beta, -curAlpha, 1, true, m);
          } else {
            sc = -alphaBeta(depth - 1, -curAlpha - 1, -curAlpha, 1, true, m);
            if (sc > curAlpha && sc < beta && !abortSearch) {
              sc = -alphaBeta(depth - 1, -beta, -curAlpha, 1, true, m);
            }
          }
          unmakeMove(m, 0);
          if (abortSearch) break;
          if (sc > iterBestScore) {
            iterSecondScore = iterBestScore;
            iterBestScore = sc;
            iterBestMove = m;
            if (sc > curAlpha) {
              curAlpha = sc;
              if (curAlpha >= beta) break;
            }
          } else if (sc > iterSecondScore) {
            iterSecondScore = sc;
          }
        }

        if (abortSearch) break;

        if (iterBestScore <= alpha && alpha > -INF) {
          alpha = Math.max(-INF, alpha - delta);
          delta *= 2;
        } else if (iterBestScore >= beta && beta < INF) {
          beta = Math.min(INF, beta + delta);
          delta *= 2;
        } else {
          break;
        }
      }

      if (abortSearch) break;

      prevPrevScore = prevScore;
      prevBestMove = bestMove;
      bestMove = iterBestMove;
      prevScore = iterBestScore;
      completedDepth = depth;
      secondBestGap = iterSecondScore > -INF ? (iterBestScore - iterSecondScore) : 200;

      // Put the exact best move at index 0 for the next iteration.
      const bestIndex = rootMoves.indexOf(bestMove);
      if (bestIndex > 0) {
        rootMoves.splice(bestIndex, 1);
        rootMoves.unshift(bestMove);
      }

      if (Math.abs(prevScore) > MATE_BOUND) break;
    }

    let chosenMove = bestMove;

    // ARMX 1.1 deep finalist integration
    if (!options && rootMoves.length > 1 && Math.abs(prevScore) < MATE_BOUND) {
      if (typeof armx11SelectFinalist === 'function' && completedDepth >= 5) {
        const legalList = game.fastMoves();
        const candCount = Math.min(3, rootMoves.length);
        const reviewDepth = Math.max(1, completedDepth - 1);
        const windowPad = 36;
        const candidates = [];
        const bestRaw = matchRawMove(legalList, bestMove);
        if (bestRaw) {
          candidates.push({ raw: bestRaw, score: prevScore, deep: prevScore, packed: bestMove });
        }

        // Fast bounded verification of runner-up root candidates (give small slack beyond deadline)
        searchDeadline = performance.now() + 8;
        abortSearch = false;
        for (let i = 1; i < candCount; i += 1) {
          const cm = rootMoves[i];
          const raw = matchRawMove(legalList, cm);
          if (!raw) continue;
          makeMove(cm, 0, rootInCheck);
          const sc = -alphaBeta(reviewDepth, -(prevScore + 15), -(prevScore - windowPad), 1, true, cm);
          unmakeMove(cm, 0);
          if (!abortSearch && sc >= prevScore - windowPad) {
            candidates.push({ raw, score: sc, deep: sc, packed: cm });
          }
          abortSearch = false;
        }

        if (candidates.length > 1) {
          candidates.sort((a, b) => b.score - a.score);
          const picked = armx11SelectFinalist(game, candidates, armx11Plan);
          if (picked && picked.packed) chosenMove = picked.packed;
        }
      }
    }

    lastEvalTemp = completedDepth;
    globalScope.SF61_LAST_SEARCH = {
      depth: completedDepth,
      rootWidth: rootSearchWidth,
      nodes: nodeCount,
      score: prevScore,
      ms: performance.now() - startTime,
      evalCacheHits: evalCacheHits - evalHitsBefore,
      evalCacheMisses: evalCacheMisses - evalMissesBefore,
      evalCacheHitRate: (evalCacheHits - evalHitsBefore) / Math.max(1, (evalCacheHits - evalHitsBefore) + (evalCacheMisses - evalMissesBefore))
    };

    return decodeMoveToPublic(game, chosenMove);
  }

  globalScope.getStonefishV61Move = getStonefishV61Move;
  globalScope.stonefishV61EvaluateRaw = function(game) {
    loadFromGame(game);
    return evaluate();
  };
  globalScope.stonefishV61LastDepth = function() {
    return lastEvalTemp;
  };
  globalScope.stonefishV61EvalCacheStats = function() {
    return { hits: evalCacheHits, misses: evalCacheMisses, size: EVAL_CACHE_SIZE };
  };
  globalScope.stonefishV61ClearEvalCache = function() {
    evalCacheValid.fill(0);
    evalCacheHits = 0;
    evalCacheMisses = 0;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
