// FastChess: a minimal chess rules engine for StoneFish bulk testing.
// It intentionally omits SAN/PGN/pretty-history work. The test worker uses raw
// reversible moves so search spends time on chess rules, not presentation.

class FastChess {
  constructor() {
    this.board = new Array(64).fill(null);
    this.side = 'w';
    this.castling = 15; // 1 WK, 2 WQ, 4 BK, 8 BQ
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.historyStack = [];
    this.positionCounts = new Map();
    this.reset();
  }

  reset() {
    const backBlack = ['br','bn','bb','bq','bk','bb','bn','br'];
    const backWhite = ['wr','wn','wb','wq','wk','wb','wn','wr'];
    this.board = [
      ...backBlack,
      ...Array(8).fill('bp'),
      ...Array(32).fill(null),
      ...Array(8).fill('wp'),
      ...backWhite
    ];
    this.side = 'w';
    this.castling = 15;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.historyStack = [];
    this.positionCounts = new Map();
    this._bumpPosition(1);
  }

  turn() { return this.side; }

  _opposite(color) { return color === 'w' ? 'b' : 'w'; }
  _row(sq) { return sq >> 3; }
  _col(sq) { return sq & 7; }
  _inside(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
  _sq(row, col) { return row * 8 + col; }
  _alg(sq) { return 'abcdefgh'[this._col(sq)] + String(8 - this._row(sq)); }
  _fromAlg(text) { return (8 - Number(text[1])) * 8 + 'abcdefgh'.indexOf(text[0]); }

  fastPositionKey() {
    let out = '';
    for (let i = 0; i < 64; i += 1) out += this.board[i] || '--';
    return `${out}|${this.side}|${this.castling}|${this.ep}`;
  }

  fen() {
    const rows = [];
    for (let r = 0; r < 8; r += 1) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c += 1) {
        const piece = this.board[this._sq(r, c)];
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) { row += empty; empty = 0; }
        const letter = piece[1];
        row += piece[0] === 'w' ? letter.toUpperCase() : letter;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let castle = '';
    if (this.castling & 1) castle += 'K';
    if (this.castling & 2) castle += 'Q';
    if (this.castling & 4) castle += 'k';
    if (this.castling & 8) castle += 'q';
    return `${rows.join('/')} ${this.side} ${castle || '-'} ${this.ep < 0 ? '-' : this._alg(this.ep)} ${this.halfmove} ${this.fullmove}`;
  }

  _bumpPosition(delta) {
    const key = this.fastPositionKey();
    const next = (this.positionCounts.get(key) || 0) + delta;
    if (next <= 0) this.positionCounts.delete(key);
    else this.positionCounts.set(key, next);
  }

  _findKing(color) {
    const target = color + 'k';
    for (let i = 0; i < 64; i += 1) if (this.board[i] === target) return i;
    return -1;
  }

  _isSquareAttacked(square, byColor) {
    const tr = this._row(square);
    const tc = this._col(square);

    const pawnRow = tr + (byColor === 'w' ? 1 : -1);
    for (const dc of [-1, 1]) {
      const c = tc + dc;
      if (this._inside(pawnRow, c) && this.board[this._sq(pawnRow, c)] === byColor + 'p') return true;
    }

    const knightOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of knightOffsets) {
      const r = tr + dr, c = tc + dc;
      if (this._inside(r, c) && this.board[this._sq(r, c)] === byColor + 'n') return true;
    }

    const kingOffsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr, dc] of kingOffsets) {
      const r = tr + dr, c = tc + dc;
      if (this._inside(r, c) && this.board[this._sq(r, c)] === byColor + 'k') return true;
    }

    const sliders = [
      [-1,-1,'bq'],[-1,1,'bq'],[1,-1,'bq'],[1,1,'bq'],
      [-1,0,'rq'],[1,0,'rq'],[0,-1,'rq'],[0,1,'rq']
    ];
    for (const [dr, dc, types] of sliders) {
      let r = tr + dr, c = tc + dc;
      while (this._inside(r, c)) {
        const piece = this.board[this._sq(r, c)];
        if (piece) {
          if (piece[0] === byColor && types.includes(piece[1])) return true;
          break;
        }
        r += dr; c += dc;
      }
    }
    return false;
  }

  in_check() {
    const king = this._findKing(this.side);
    return king >= 0 && this._isSquareAttacked(king, this._opposite(this.side));
  }

  _pushMove(moves, from, to, promotion = null, flags = 0) {
    const moving = this.board[from];
    let captured = this.board[to];
    if (flags & 2) captured = this.side === 'w' ? this.board[to + 8] : this.board[to - 8]; // en passant
    moves.push({
      from,
      to,
      piece: moving ? moving[1] : null,
      captured: captured ? captured[1] : null,
      promotion,
      flags
    });
  }

  _pseudoMoves() {
    const moves = [];
    const us = this.side;
    const them = this._opposite(us);

    for (let from = 0; from < 64; from += 1) {
      const piece = this.board[from];
      if (!piece || piece[0] !== us) continue;
      const type = piece[1];
      const r = this._row(from), c = this._col(from);

      if (type === 'p') {
        const dir = us === 'w' ? -1 : 1;
        const startRow = us === 'w' ? 6 : 1;
        const promoRow = us === 'w' ? 0 : 7;
        const oneR = r + dir;
        if (this._inside(oneR, c) && !this.board[this._sq(oneR, c)]) {
          const to = this._sq(oneR, c);
          if (oneR === promoRow) {
            for (const p of ['q','r','b','n']) this._pushMove(moves, from, to, p);
          } else {
            this._pushMove(moves, from, to);
            const twoR = r + dir * 2;
            if (r === startRow && !this.board[this._sq(twoR, c)]) this._pushMove(moves, from, this._sq(twoR, c), null, 1);
          }
        }
        for (const dc of [-1, 1]) {
          const nr = r + dir, nc = c + dc;
          if (!this._inside(nr, nc)) continue;
          const to = this._sq(nr, nc);
          const target = this.board[to];
          if (target && target[0] === them) {
            if (nr === promoRow) for (const p of ['q','r','b','n']) this._pushMove(moves, from, to, p);
            else this._pushMove(moves, from, to);
          } else if (to === this.ep) {
            this._pushMove(moves, from, to, null, 2);
          }
        }
        continue;
      }

      if (type === 'n') {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const nr = r + dr, nc = c + dc;
          if (!this._inside(nr, nc)) continue;
          const to = this._sq(nr, nc), target = this.board[to];
          if (!target || target[0] === them) this._pushMove(moves, from, to);
        }
        continue;
      }

      if (type === 'b' || type === 'r' || type === 'q') {
        const dirs = [];
        if (type === 'b' || type === 'q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
        if (type === 'r' || type === 'q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
        for (const [dr, dc] of dirs) {
          let nr = r + dr, nc = c + dc;
          while (this._inside(nr, nc)) {
            const to = this._sq(nr, nc), target = this.board[to];
            if (!target) this._pushMove(moves, from, to);
            else {
              if (target[0] === them) this._pushMove(moves, from, to);
              break;
            }
            nr += dr; nc += dc;
          }
        }
        continue;
      }

      if (type === 'k') {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const nr = r + dr, nc = c + dc;
          if (!this._inside(nr, nc)) continue;
          const to = this._sq(nr, nc), target = this.board[to];
          if (!target || target[0] === them) this._pushMove(moves, from, to);
        }

        if (us === 'w' && from === 60) {
          if ((this.castling & 1) && !this.board[61] && !this.board[62] && this.board[63] === 'wr' &&
              !this._isSquareAttacked(60, 'b') && !this._isSquareAttacked(61, 'b') && !this._isSquareAttacked(62, 'b')) {
            this._pushMove(moves, 60, 62, null, 4);
          }
          if ((this.castling & 2) && !this.board[59] && !this.board[58] && !this.board[57] && this.board[56] === 'wr' &&
              !this._isSquareAttacked(60, 'b') && !this._isSquareAttacked(59, 'b') && !this._isSquareAttacked(58, 'b')) {
            this._pushMove(moves, 60, 58, null, 8);
          }
        } else if (us === 'b' && from === 4) {
          if ((this.castling & 4) && !this.board[5] && !this.board[6] && this.board[7] === 'br' &&
              !this._isSquareAttacked(4, 'w') && !this._isSquareAttacked(5, 'w') && !this._isSquareAttacked(6, 'w')) {
            this._pushMove(moves, 4, 6, null, 4);
          }
          if ((this.castling & 8) && !this.board[3] && !this.board[2] && !this.board[1] && this.board[0] === 'br' &&
              !this._isSquareAttacked(4, 'w') && !this._isSquareAttacked(3, 'w') && !this._isSquareAttacked(2, 'w')) {
            this._pushMove(moves, 4, 2, null, 8);
          }
        }
      }
    }
    return moves;
  }

  _applyRaw(move, trackPosition) {
    const previousKey = trackPosition ? this.fastPositionKey() : null;
    const moving = this.board[move.from];
    const capturedOnTarget = this.board[move.to];
    const state = {
      move,
      capturedOnTarget,
      side: this.side,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      trackPosition,
      previousKey
    };
    this.historyStack.push(state);

    this.board[move.to] = moving;
    this.board[move.from] = null;

    if (move.flags & 2) {
      const capSq = state.side === 'w' ? move.to + 8 : move.to - 8;
      state.epCaptured = this.board[capSq];
      this.board[capSq] = null;
    }

    if (move.promotion) this.board[move.to] = state.side + move.promotion;

    if (move.flags & 4) {
      const rookFrom = move.to > move.from ? move.to + 1 : move.to - 2;
      const rookTo = move.to > move.from ? move.to - 1 : move.to + 1;
      state.rookFrom = rookFrom; state.rookTo = rookTo;
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }
    if (move.flags & 8) {
      const rookFrom = move.to < move.from ? move.to - 2 : move.to + 1;
      const rookTo = move.to < move.from ? move.to + 1 : move.to - 1;
      state.rookFrom = rookFrom; state.rookTo = rookTo;
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }

    if (moving === 'wk') this.castling &= ~3;
    if (moving === 'bk') this.castling &= ~12;
    if (move.from === 63 || move.to === 63) this.castling &= ~1;
    if (move.from === 56 || move.to === 56) this.castling &= ~2;
    if (move.from === 7 || move.to === 7) this.castling &= ~4;
    if (move.from === 0 || move.to === 0) this.castling &= ~8;

    this.ep = -1;
    if (move.flags & 1) this.ep = state.side === 'w' ? move.to + 8 : move.to - 8;

    if (moving && moving[1] === 'p' || move.captured) this.halfmove = 0;
    else this.halfmove += 1;
    if (state.side === 'b') this.fullmove += 1;
    this.side = this._opposite(state.side);

    if (trackPosition) this._bumpPosition(1);
  }

  fastApply(move) { this._applyRaw(move._raw || move, false); }
  fastCommit(move) { this._applyRaw(move._raw || move, true); }

  fastUndo() {
    const state = this.historyStack.pop();
    if (!state) return null;
    if (state.trackPosition) this._bumpPosition(-1);

    const move = state.move;
    this.side = state.side;
    this.castling = state.castling;
    this.ep = state.ep;
    this.halfmove = state.halfmove;
    this.fullmove = state.fullmove;

    if (state.rookFrom !== undefined) {
      this.board[state.rookFrom] = this.board[state.rookTo];
      this.board[state.rookTo] = null;
    }

    const movedPiece = this.board[move.to];
    this.board[move.from] = move.promotion ? this.side + 'p' : movedPiece;
    this.board[move.to] = state.capturedOnTarget;

    if (move.flags & 2) {
      const capSq = this.side === 'w' ? move.to + 8 : move.to - 8;
      this.board[capSq] = state.epCaptured;
      this.board[move.to] = null;
    }
    return move;
  }

  undo() { return this.fastUndo(); }

  fastMoves() {
    const pseudo = this._pseudoMoves();
    const legal = [];
    const us = this.side;
    for (const move of pseudo) {
      this._applyRaw(move, false);
      const king = this._findKing(us);
      const illegal = king < 0 || this._isSquareAttacked(king, this.side);
      this.fastUndo();
      if (!illegal) legal.push(move);
    }
    return legal;
  }

  fastIsMateMove(move) {
    const raw = move._raw || move;
    this._applyRaw(raw, false);
    const isCheck = this.in_check();
    let mate = false;
    if (isCheck) mate = this.fastMoves().length === 0;
    this.fastUndo();
    return mate;
  }

  moves(options) {
    const raw = this.fastMoves();
    if (!options || !options.verbose) return raw.map(m => this._alg(m.from) + this._alg(m.to) + (m.promotion || ''));
    return raw.map(m => ({
      from: this._alg(m.from),
      to: this._alg(m.to),
      piece: m.piece,
      captured: m.captured || undefined,
      promotion: m.promotion || undefined,
      _raw: m
    }));
  }

  _findLegalPublic(move) {
    const from = typeof move.from === 'number' ? move.from : this._fromAlg(move.from);
    const to = typeof move.to === 'number' ? move.to : this._fromAlg(move.to);
    const promotion = move.promotion || null;
    return this.fastMoves().find(m => m.from === from && m.to === to && (m.promotion || null) === promotion) || null;
  }

  move(move) {
    const raw = move._raw || this._findLegalPublic(move);
    if (!raw) return null;
    this.fastCommit(raw);
    return {
      from: this._alg(raw.from),
      to: this._alg(raw.to),
      piece: raw.piece,
      captured: raw.captured || undefined,
      promotion: raw.promotion || undefined
    };
  }

  in_checkmate() { return this.in_check() && this.fastMoves().length === 0; }
  in_stalemate() { return !this.in_check() && this.fastMoves().length === 0; }

  insufficient_material() {
    const pieces = [];
    const bishopSquares = [];
    for (let i = 0; i < 64; i += 1) {
      const p = this.board[i];
      if (!p || p[1] === 'k') continue;
      pieces.push(p[1]);
      if (p[1] === 'b') bishopSquares.push((this._row(i) + this._col(i)) & 1);
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n')) return true;
    if (pieces.every(p => p === 'b') && bishopSquares.length && bishopSquares.every(x => x === bishopSquares[0])) return true;
    return false;
  }

  in_threefold_repetition() {
    return (this.positionCounts.get(this.fastPositionKey()) || 0) >= 3;
  }

  in_draw() {
    if (this.halfmove >= 100) return true;
    if (this.insufficient_material()) return true;
    if (this.in_threefold_repetition()) return true;
    return this.in_stalemate();
  }

  game_over() {
    if (this.halfmove >= 100 || this.insufficient_material() || this.in_threefold_repetition()) return true;
    return this.fastMoves().length === 0;
  }
}
