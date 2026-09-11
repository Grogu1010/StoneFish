// StonefishChess — lightweight chess rules engine for StoneFish.
// Purpose-built for fast make/undo search. Hypothetical moves never generate SAN.

class Chess {
  constructor() {
    this.reset();
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
    // Fast deterministic key. Search logic only needs board, side, castle, ep.
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

    // Pawns.
    const pawnRank = rank - bySide;
    if (pawnRank >= 0 && pawnRank < 8) {
      if (file > 0 && b[pawnRank * 8 + file - 1] === bySide) return true;
      if (file < 7 && b[pawnRank * 8 + file + 1] === bySide) return true;
    }

    // Knights.
    const knightSteps = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    for (const [df, dr] of knightSteps) {
      const f = file + df, r = rank + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === bySide * 2) return true;
    }

    // Bishops/queens.
    const diag = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [df, dr] of diag) {
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

    // Rooks/queens.
    const orth = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [df, dr] of orth) {
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

    // King.
    for (let df = -1; df <= 1; df += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (!df && !dr) continue;
        const f = file + df, r = rank + dr;
        if (f >= 0 && f < 8 && r >= 0 && r < 8 && b[r * 8 + f] === bySide * 6) return true;
      }
    }
    return false;
  }

  in_check() {
    return this._isAttacked(this.kingSq[this.side], -this.side);
  }

  _pushMove(moves, from, to, promotion = 0, flags = 0) {
    const moving = this.boardState[from];
    let captured = this.boardState[to];
    if (flags & 2) captured = -this.side; // en passant pawn
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
      if (!piece || Math.sign(piece) !== us) continue;
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
            for (const p of [5,4,3,2]) this._pushMove(moves, from, one, p);
          } else {
            this._pushMove(moves, from, one);
            const two = from + step * 2;
            if (rank === startRank && !b[two]) this._pushMove(moves, from, two, 0, 1);
          }
        }
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          const to = from + step + df;
          if (to < 0 || to >= 64) continue;
          if (b[to] && Math.sign(b[to]) === -us) {
            if ((to >> 3) === promoRank) {
              for (const p of [5,4,3,2]) this._pushMove(moves, from, to, p);
            } else this._pushMove(moves, from, to);
          } else if (to === this.ep) {
            this._pushMove(moves, from, to, 0, 2);
          }
        }
        continue;
      }

      if (type === 2) {
        const steps = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
        for (const [df, dr] of steps) {
          const f = file + df, r = rank + dr;
          if (f < 0 || f > 7 || r < 0 || r > 7) continue;
          const to = r * 8 + f;
          if (!b[to] || Math.sign(b[to]) === -us) this._pushMove(moves, from, to);
        }
        continue;
      }

      const dirs = type === 3 ? [[1,1],[1,-1],[-1,1],[-1,-1]]
        : type === 4 ? [[1,0],[-1,0],[0,1],[0,-1]]
        : type === 5 ? [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]
        : [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

      for (const [df, dr] of dirs) {
        let f = file + df, r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const to = r * 8 + f;
          if (!b[to]) this._pushMove(moves, from, to);
          else {
            if (Math.sign(b[to]) === -us) this._pushMove(moves, from, to);
            break;
          }
          if (type === 6) break;
          f += df; r += dr;
        }
      }

      if (type === 6) {
        if (us === 1 && from === 4) {
          if ((this.castling & 1) && !b[5] && !b[6] && !this._isAttacked(4,-1) && !this._isAttacked(5,-1) && !this._isAttacked(6,-1)) this._pushMove(moves,4,6,0,4);
          if ((this.castling & 2) && !b[1] && !b[2] && !b[3] && !this._isAttacked(4,-1) && !this._isAttacked(3,-1) && !this._isAttacked(2,-1)) this._pushMove(moves,4,2,0,8);
        } else if (us === -1 && from === 60) {
          if ((this.castling & 4) && !b[61] && !b[62] && !this._isAttacked(60,1) && !this._isAttacked(61,1) && !this._isAttacked(62,1)) this._pushMove(moves,60,62,0,4);
          if ((this.castling & 8) && !b[57] && !b[58] && !b[59] && !this._isAttacked(60,1) && !this._isAttacked(59,1) && !this._isAttacked(58,1)) this._pushMove(moves,60,58,0,8);
        }
      }
    }
    return moves;
  }

  fastMoves() {
    const pseudo = this._pseudoMoves();
    const legal = [];
    const us = this.side;
    for (const move of pseudo) {
      this._applyRaw(move, false);
      const safe = !this._isAttacked(this.kingSq[us], -us);
      this._undoRaw();
      if (safe) legal.push(move);
    }
    return legal;
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
    const moved = b[move.to];
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
    this.fastApply(move);
    const mate = this.in_check() && this.fastMoves().length === 0;
    this.fastUndo();
    return mate;
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
