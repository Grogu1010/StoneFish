// StonefishChess — lightweight chess rules engine for StoneFish.
// Purpose-built for fast make/undo search. Hypothetical moves never generate SAN.

const SF_KNIGHT_DF = [1, 2, 2, 1, -1, -2, -2, -1];
const SF_KNIGHT_DR = [2, 1, -1, -2, -2, -1, 1, 2];
const SF_DIAG_DIRS = [1, 1, 1, -1, -1, 1, -1, -1];
const SF_ORTH_DIRS = [1, 0, -1, 0, 0, 1, 0, -1];
const SF_ALL_DIRS = [1, 1, 1, -1, -1, 1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1];

class Chess {
  constructor(fen = null) {
    this.reset();
    if (fen) this.load(fen);
  }

  reset() {
    // a1 = 0 ... h8 = 63. White pieces positive, Black pieces negative.
    this.boardState = new Int8Array(64);
    const back = [4, 2, 3, 5, 6, 3, 2, 4];
    for (let f = 0; f < 8; f += 1) {
      this.boardState[f] = back[f];
      this.boardState[8 + f] = 1;
      this.boardState[48 + f] = -1;
      this.boardState[56 + f] = -back[f];
    }
    this.side = 1;
    this.castling = 15; // 1 WK, 2 WQ, 4 BK, 8 BQ
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = { 1: 4, '-1': 60 };
    this.historyStack = [];
    this.positionCounts = new Map();
    this.positionCounts.set(this.fastPositionKey(), 1);
  }

  load(fen) {
    if (typeof fen !== 'string') throw new Error('FEN must be a string.');
    const fields = fen.trim().split(/\s+/);
    if (fields.length !== 6) throw new Error('FEN must contain 6 space-separated fields.');

    const [placement, active, castlingText, epText, halfmoveText, fullmoveText] = fields;
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('FEN board must contain 8 ranks.');

    const board = new Int8Array(64);
    const pieceMap = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
    const kings = { 1: -1, '-1': -1 };

    for (let fenRank = 0; fenRank < 8; fenRank += 1) {
      const text = ranks[fenRank];
      let file = 0;
      for (const ch of text) {
        if (/^[1-8]$/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const type = pieceMap[ch.toLowerCase()];
        if (!type || file >= 8) throw new Error('FEN contains an invalid board character.');
        const side = ch === ch.toUpperCase() ? 1 : -1;
        const sq = (7 - fenRank) * 8 + file;
        board[sq] = side * type;
        if (type === 6) {
          if (kings[side] !== -1) throw new Error('FEN must contain exactly one king per side.');
          kings[side] = sq;
        }
        file += 1;
      }
      if (file !== 8) throw new Error('Each FEN rank must describe exactly 8 squares.');
    }

    if (kings[1] < 0 || kings[-1] < 0) throw new Error('FEN must contain both kings.');
    if (active !== 'w' && active !== 'b') throw new Error('FEN active color must be w or b.');

    let castling = 0;
    if (castlingText !== '-') {
      if (!/^[KQkq]+$/.test(castlingText) || new Set(castlingText).size !== castlingText.length) {
        throw new Error('Invalid FEN castling rights.');
      }
      if (castlingText.includes('K')) castling |= 1;
      if (castlingText.includes('Q')) castling |= 2;
      if (castlingText.includes('k')) castling |= 4;
      if (castlingText.includes('q')) castling |= 8;
    }

    let ep = -1;
    if (epText !== '-') {
      if (!/^[a-h][36]$/.test(epText)) throw new Error('Invalid FEN en-passant square.');
      ep = this._sq(epText);
    }

    const halfmove = Number.parseInt(halfmoveText, 10);
    const fullmove = Number.parseInt(fullmoveText, 10);
    if (!Number.isInteger(halfmove) || halfmove < 0) throw new Error('Invalid FEN halfmove clock.');
    if (!Number.isInteger(fullmove) || fullmove < 1) throw new Error('Invalid FEN fullmove number.');

    this.boardState = board;
    this.side = active === 'w' ? 1 : -1;
    this.castling = castling;
    this.ep = ep;
    this.halfmove = halfmove;
    this.fullmove = fullmove;
    this.kingSq = kings;
    this.historyStack = [];
    this.positionCounts = new Map();
    this._stonefishRuntimePositionKey = null;
    this._stonefishRuntimeMemo = null;
    this._stonefishRuntimeCacheStack = [];
    this.positionCounts.set(this.fastPositionKey(), 1);
    return true;
  }

  _alg(sq) {
    return 'abcdefgh'[sq & 7] + String((sq >> 3) + 1);
  }

  _sq(name) {
    if (!name || name.length !== 2) return -1;
    const f = name.charCodeAt(0) - 97;
    const r = name.charCodeAt(1) - 49;
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
  }

  _typeChar(absPiece) {
    return ['', 'p', 'n', 'b', 'r', 'q', 'k'][absPiece] || null;
  }

  _pieceObj(piece) {
    if (!piece) return null;
    return { type: this._typeChar(Math.abs(piece)), color: piece > 0 ? 'w' : 'b' };
  }

  get(square) {
    const sq = this._sq(square);
    return sq < 0 ? null : this._pieceObj(this.boardState[sq]);
  }

  turn() {
    return this.side === 1 ? 'w' : 'b';
  }

  fastPositionKey() {
    let s = this.side === 1 ? 'w|' : 'b|';
    for (let i = 0; i < 64; i += 1) s += String.fromCharCode(this.boardState[i] + 70);
    return `${s}|${this.castling}|${this.ep}`;
  }

  fen() {
    let placement = '';
    for (let rank = 7; rank >= 0; rank -= 1) {
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const p = this.boardState[rank * 8 + file];
        if (!p) {
          empty += 1;
          continue;
        }
        if (empty) { placement += empty; empty = 0; }
        const ch = this._typeChar(Math.abs(p));
        placement += p > 0 ? ch.toUpperCase() : ch;
      }
      if (empty) placement += empty;
      if (rank) placement += '/';
    }
    let castle = '';
    if (this.castling & 1) castle += 'K';
    if (this.castling & 2) castle += 'Q';
    if (this.castling & 4) castle += 'k';
    if (this.castling & 8) castle += 'q';
    if (!castle) castle = '-';
    return `${placement} ${this.turn()} ${castle} ${this.ep >= 0 ? this._alg(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  _isAttacked(sq, bySide) {
    const b = this.boardState;
    const file = sq & 7;
    const rank = sq >> 3;

    const pawnRank = rank - bySide;
    if (pawnRank >= 0 && pawnRank < 8) {
      if (file > 0 && b[pawnRank * 8 + file - 1] === bySide) return true;
      if (file < 7 && b[pawnRank * 8 + file + 1] === bySide) return true;
    }

    for (let i = 0; i < 8; i += 1) {
      const f = file + SF_KNIGHT_DF[i];
      const r = rank + SF_KNIGHT_DR[i];
      if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === bySide * 2) return true;
    }

    for (let i = 0; i < SF_DIAG_DIRS.length; i += 2) {
      const df = SF_DIAG_DIRS[i], dr = SF_DIAG_DIRS[i + 1];
      let f = file + df, r = rank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = b[r * 8 + f];
        if (p) {
          if (p === bySide * 3 || p === bySide * 5) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    for (let i = 0; i < SF_ORTH_DIRS.length; i += 2) {
      const df = SF_ORTH_DIRS[i], dr = SF_ORTH_DIRS[i + 1];
      let f = file + df, r = rank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const p = b[r * 8 + f];
        if (p) {
          if (p === bySide * 4 || p === bySide * 5) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    for (let i = 0; i < SF_ALL_DIRS.length; i += 2) {
      const f = file + SF_ALL_DIRS[i], r = rank + SF_ALL_DIRS[i + 1];
      if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === bySide * 6) return true;
    }
    return false;
  }

  in_check() {
    return this._isAttacked(this.kingSq[this.side], -this.side);
  }

  _pushMove(moves, from, to, promotion = 0, flags = 0) {
    const moving = this.boardState[from];
    let captured = this.boardState[to];
    if (flags & 2) captured = -this.side;
    moves.push({
      from,
      to,
      promotion,
      flags,
      piece: Math.abs(moving),
      captured: captured ? Math.abs(captured) : 0
    });
  }

  _pseudoMoves() {
    const moves = [];
    const b = this.boardState;
    const us = this.side;

    for (let from = 0; from < 64; from += 1) {
      const piece = b[from];
      if (!piece || (piece > 0 ? 1 : -1) !== us) continue;
      const type = Math.abs(piece);
      const file = from & 7;
      const rank = from >> 3;

      if (type === 1) {
        const step = us === 1 ? 8 : -8;
        const startRank = us === 1 ? 1 : 6;
        const promoRank = us === 1 ? 7 : 0;
        const one = from + step;
        if (one >= 0 && one < 64 && !b[one]) {
          if ((one >> 3) === promoRank) {
            this._pushMove(moves, from, one, 5);
            this._pushMove(moves, from, one, 4);
            this._pushMove(moves, from, one, 3);
            this._pushMove(moves, from, one, 2);
          } else {
            this._pushMove(moves, from, one);
            const two = from + step * 2;
            if (rank === startRank && !b[two]) this._pushMove(moves, from, two, 0, 1);
          }
        }
        for (let df = -1; df <= 1; df += 2) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          const to = from + step + df;
          if (to < 0 || to >= 64) continue;
          const target = b[to];
          if (target && (target > 0 ? 1 : -1) === -us) {
            if ((to >> 3) === promoRank) {
              this._pushMove(moves, from, to, 5);
              this._pushMove(moves, from, to, 4);
              this._pushMove(moves, from, to, 3);
              this._pushMove(moves, from, to, 2);
            } else this._pushMove(moves, from, to);
          } else if (to === this.ep) {
            this._pushMove(moves, from, to, 0, 2);
          }
        }
        continue;
      }

      if (type === 2) {
        for (let i = 0; i < 8; i += 1) {
          const f = file + SF_KNIGHT_DF[i], r = rank + SF_KNIGHT_DR[i];
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const to = r * 8 + f, target = b[to];
          if (!target || (target > 0 ? 1 : -1) === -us) this._pushMove(moves, from, to);
        }
        continue;
      }

      const dirs = type === 3 ? SF_DIAG_DIRS : type === 4 ? SF_ORTH_DIRS : SF_ALL_DIRS;
      for (let i = 0; i < dirs.length; i += 2) {
        const df = dirs[i], dr = dirs[i + 1];
        let f = file + df, r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const to = r * 8 + f, target = b[to];
          if (!target) this._pushMove(moves, from, to);
          else {
            if ((target > 0 ? 1 : -1) === -us) this._pushMove(moves, from, to);
            break;
          }
          if (type === 6) break;
          f += df; r += dr;
        }
      }

      if (type === 6) {
        if (us === 1 && from === 4) {
          if ((this.castling & 1) && b[7] === 4 && !b[5] && !b[6] && !this._isAttacked(4,-1) && !this._isAttacked(5,-1) && !this._isAttacked(6,-1)) this._pushMove(moves,4,6,0,4);
          if ((this.castling & 2) && b[0] === 4 && !b[1] && !b[2] && !b[3] && !this._isAttacked(4,-1) && !this._isAttacked(3,-1) && !this._isAttacked(2,-1)) this._pushMove(moves,4,2,0,8);
        } else if (us === -1 && from === 60) {
          if ((this.castling & 4) && b[63] === -4 && !b[61] && !b[62] && !this._isAttacked(60,1) && !this._isAttacked(61,1) && !this._isAttacked(62,1)) this._pushMove(moves,60,62,0,4);
          if ((this.castling & 8) && b[56] === -4 && !b[57] && !b[58] && !b[59] && !this._isAttacked(60,1) && !this._isAttacked(59,1) && !this._isAttacked(58,1)) this._pushMove(moves,60,58,0,8);
        }
      }
    }
    return moves;
  }

  _testLegalRaw(move) {
    const b = this.boardState;
    const us = this.side;
    const moving = b[move.from];
    const target = b[move.to];
    let epSq = -1, epPiece = 0;
    let rookFrom = -1, rookTo = -1, rookPiece = 0;

    b[move.from] = 0;
    b[move.to] = move.promotion ? us * move.promotion : moving;

    if (move.flags & 2) {
      epSq = move.to + (us === 1 ? -8 : 8);
      epPiece = b[epSq];
      b[epSq] = 0;
    }
    if (move.flags & 4) {
      rookFrom = us === 1 ? 7 : 63;
      rookTo = us === 1 ? 5 : 61;
      rookPiece = b[rookFrom];
      b[rookTo] = rookPiece;
      b[rookFrom] = 0;
    } else if (move.flags & 8) {
      rookFrom = us === 1 ? 0 : 56;
      rookTo = us === 1 ? 3 : 59;
      rookPiece = b[rookFrom];
      b[rookTo] = rookPiece;
      b[rookFrom] = 0;
    }

    const kingSquare = Math.abs(moving) === 6 ? move.to : this.kingSq[us];
    const safe = !this._isAttacked(kingSquare, -us);

    if (rookFrom >= 0) {
      b[rookFrom] = rookPiece;
      b[rookTo] = 0;
    }
    if (epSq >= 0) b[epSq] = epPiece;
    b[move.from] = moving;
    b[move.to] = target;
    return safe;
  }

  fastMoves() {
    const pseudo = this._pseudoMoves();
    const legal = [];
    for (let i = 0; i < pseudo.length; i += 1) {
      const move = pseudo[i];
      if (this._testLegalRaw(move)) legal.push(move);
    }
    return legal;
  }

  fastGivesCheck(move) {
    const raw = move && move._raw ? move._raw : move;
    const b = this.boardState;
    const us = this.side;
    const moving = b[raw.from];
    const target = b[raw.to];
    let epSq = -1, epPiece = 0;
    let rookFrom = -1, rookTo = -1, rookPiece = 0;

    b[raw.from] = 0;
    b[raw.to] = raw.promotion ? us * raw.promotion : moving;
    if (raw.flags & 2) {
      epSq = raw.to + (us === 1 ? -8 : 8);
      epPiece = b[epSq];
      b[epSq] = 0;
    }
    if (raw.flags & 4) {
      rookFrom = us === 1 ? 7 : 63;
      rookTo = us === 1 ? 5 : 61;
      rookPiece = b[rookFrom];
      b[rookTo] = rookPiece;
      b[rookFrom] = 0;
    } else if (raw.flags & 8) {
      rookFrom = us === 1 ? 0 : 56;
      rookTo = us === 1 ? 3 : 59;
      rookPiece = b[rookFrom];
      b[rookTo] = rookPiece;
      b[rookFrom] = 0;
    }

    const givesCheck = this._isAttacked(this.kingSq[-us], us);

    if (rookFrom >= 0) {
      b[rookFrom] = rookPiece;
      b[rookTo] = 0;
    }
    if (epSq >= 0) b[epSq] = epPiece;
    b[raw.from] = moving;
    b[raw.to] = target;
    return givesCheck;
  }

  _applyRaw(move, trackRepetition) {
    const b = this.boardState;
    const capturedPiece = move.flags & 2 ? b[move.to + (this.side === 1 ? -8 : 8)] : b[move.to];
    const state = {
      move,
      capturedPiece,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      kingW: this.kingSq[1],
      kingB: this.kingSq[-1],
      side: this.side,
      trackRepetition,
      repKey: null
    };
    this.historyStack.push(state);

    const moving = b[move.from];
    b[move.to] = moving;
    b[move.from] = 0;

    if (move.flags & 2) b[move.to + (this.side === 1 ? -8 : 8)] = 0;
    if (move.promotion) b[move.to] = this.side * move.promotion;

    if (Math.abs(moving) === 6) {
      this.kingSq[this.side] = move.to;
      if (this.side === 1) this.castling &= ~3; else this.castling &= ~12;
      if (move.flags & 4) {
        const rf = this.side === 1 ? 7 : 63, rt = this.side === 1 ? 5 : 61;
        b[rt] = b[rf]; b[rf] = 0;
      } else if (move.flags & 8) {
        const rf = this.side === 1 ? 0 : 56, rt = this.side === 1 ? 3 : 59;
        b[rt] = b[rf]; b[rf] = 0;
      }
    }

    if (move.from === 0 || move.to === 0) this.castling &= ~2;
    if (move.from === 7 || move.to === 7) this.castling &= ~1;
    if (move.from === 56 || move.to === 56) this.castling &= ~8;
    if (move.from === 63 || move.to === 63) this.castling &= ~4;

    this.ep = -1;
    if (Math.abs(moving) === 1 && Math.abs(move.to - move.from) === 16) this.ep = (move.from + move.to) >> 1;
    this.halfmove = (Math.abs(moving) === 1 || capturedPiece) ? 0 : this.halfmove + 1;
    if (this.side === -1) this.fullmove += 1;
    this.side = -this.side;

    if (trackRepetition) {
      const key = this.fastPositionKey();
      state.repKey = key;
      this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
    }
    return move;
  }

  _undoRaw() {
    const state = this.historyStack.pop();
    if (!state) return null;
    if (state.trackRepetition && state.repKey) {
      const n = (this.positionCounts.get(state.repKey) || 1) - 1;
      if (n <= 0) this.positionCounts.delete(state.repKey); else this.positionCounts.set(state.repKey, n);
    }

    const { move } = state;
    this.side = state.side;
    this.castling = state.castling;
    this.ep = state.ep;
    this.halfmove = state.halfmove;
    this.fullmove = state.fullmove;
    this.kingSq[1] = state.kingW;
    this.kingSq[-1] = state.kingB;

    const b = this.boardState;
    b[move.from] = this.side * move.piece;
    b[move.to] = state.capturedPiece;

    if (move.flags & 2) {
      b[move.to] = 0;
      b[move.to + (this.side === 1 ? -8 : 8)] = state.capturedPiece;
    }
    if (move.flags & 4) {
      const rf = this.side === 1 ? 7 : 63, rt = this.side === 1 ? 5 : 61;
      b[rf] = b[rt]; b[rt] = 0;
    } else if (move.flags & 8) {
      const rf = this.side === 1 ? 0 : 56, rt = this.side === 1 ? 3 : 59;
      b[rf] = b[rt]; b[rt] = 0;
    }
    return move;
  }

  fastApply(move) {
    const raw = move && move._raw ? move._raw : move;
    return this._applyRaw(raw, false);
  }

  fastUndo() {
    return this._undoRaw();
  }

  fastIsMateMove(move) {
    const raw = move && move._raw ? move._raw : move;
    if (!this.fastGivesCheck(raw)) return false;
    this.fastApply(raw);
    const mate = this.fastMoves().length === 0;
    this.fastUndo();
    return mate;
  }

  fastMobility(side) {
    const oldSide = this.side;
    const oldEp = this.ep;
    this.side = side;
    this.ep = -1;
    const count = this.fastMoves().length;
    this.side = oldSide;
    this.ep = oldEp;
    return count;
  }

  _publicMove(raw, withMate = false) {
    return {
      from: this._alg(raw.from),
      to: this._alg(raw.to),
      promotion: raw.promotion ? this._typeChar(raw.promotion) : undefined,
      captured: raw.captured ? this._typeChar(raw.captured) : undefined,
      piece: this._typeChar(raw.piece),
      mate: withMate ? this.fastIsMateMove(raw) : undefined,
      _raw: raw
    };
  }

  moves(options = {}) {
    let raw = this.fastMoves();
    if (options.square) {
      const sq = this._sq(options.square);
      raw = raw.filter(m => m.from === sq);
    }
    if (options.verbose) return raw.map(m => this._publicMove(m, false));
    return raw.map(m => `${this._alg(m.from)}${this._alg(m.to)}${m.promotion ? this._typeChar(m.promotion) : ''}`);
  }

  _notation(raw, check, mate) {
    const letters = ['', '', 'N', 'B', 'R', 'Q', 'K'];
    let text = letters[raw.piece];
    if (raw.captured) {
      if (raw.piece === 1) text += this._alg(raw.from)[0];
      text += 'x';
    }
    text += this._alg(raw.to);
    if (raw.promotion) text += '=' + letters[raw.promotion];
    if (mate) text += '#'; else if (check) text += '+';
    return text;
  }

  move(move) {
    const from = typeof move.from === 'number' ? move.from : this._sq(move.from);
    const to = typeof move.to === 'number' ? move.to : this._sq(move.to);
    const promoChar = move.promotion || 'q';
    const promoMap = { q: 5, r: 4, b: 3, n: 2 };
    const promotion = typeof promoChar === 'number' ? promoChar : promoMap[promoChar] || 5;
    const legal = this.fastMoves();
    const raw = legal.find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === promotion));
    if (!raw) return null;

    const publicBefore = this._publicMove(raw, false);
    this._applyRaw(raw, true);
    const check = this.in_check();
    const mate = check && this.fastMoves().length === 0;
    return { ...publicBefore, san: this._notation(raw, check, mate) };
  }

  undo() {
    const raw = this._undoRaw();
    return raw ? this._publicMove(raw, false) : null;
  }

  in_checkmate() {
    return this.in_check() && this.fastMoves().length === 0;
  }

  _insufficientMaterial() {
    let bishops = 0, knights = 0, others = 0;
    const bishopColors = [];
    for (let sq = 0; sq < 64; sq += 1) {
      const t = Math.abs(this.boardState[sq]);
      if (!t || t === 6) continue;
      if (t === 3) { bishops += 1; bishopColors.push(((sq & 7) + (sq >> 3)) & 1); }
      else if (t === 2) knights += 1;
      else others += 1;
    }
    if (others) return false;
    if (bishops === 0 && knights === 0) return true;
    if (bishops + knights === 1) return true;
    return knights === 0 && bishopColors.every(c => c === bishopColors[0]);
  }

  in_draw() {
    if (this.halfmove >= 100 || this._insufficientMaterial()) return true;
    if ((this.positionCounts.get(this.fastPositionKey()) || 0) >= 3) return true;
    return !this.in_check() && this.fastMoves().length === 0;
  }

  game_over() {
    return this.in_checkmate() || this.in_draw();
  }
}
