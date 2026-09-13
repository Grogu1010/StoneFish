// Pass-9 experiment: generate the final legal move list directly in the exact
// released pseudo-move order, avoiding the intermediate pseudo array and second walk.
Chess.prototype.fastMoves = function() {
  const b = this.boardState;
  const us = this.side;
  const safety = stonefishRuntimeKingSafety(this);
  const legal = [];

  const emit = (from, to, promotion = 0, flags = 0, pieceType = Math.abs(b[from])) => {
    let captured = b[to];
    if (flags & 2) captured = -us;
    const move = {
      from,
      to,
      promotion,
      flags,
      piece: pieceType,
      captured: captured ? Math.abs(captured) : 0
    };
    if (
      !safety.inCheck &&
      pieceType !== 6 &&
      !(flags & 2) &&
      !stonefishRuntimeIsPinned(safety, from)
    ) {
      legal.push(move);
      return;
    }
    if (this._testLegalRaw(move)) legal.push(move);
  };

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
          emit(from, one, 5, 0, type);
          emit(from, one, 4, 0, type);
          emit(from, one, 3, 0, type);
          emit(from, one, 2, 0, type);
        } else {
          emit(from, one, 0, 0, type);
          const two = from + step * 2;
          if (rank === startRank && !b[two]) emit(from, two, 0, 1, type);
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
            emit(from, to, 5, 0, type);
            emit(from, to, 4, 0, type);
            emit(from, to, 3, 0, type);
            emit(from, to, 2, 0, type);
          } else emit(from, to, 0, 0, type);
        } else if (to === this.ep) {
          emit(from, to, 0, 2, type);
        }
      }
      continue;
    }

    if (type === 2) {
      for (let i = 0; i < 8; i += 1) {
        const f = file + SF_KNIGHT_DF[i];
        const r = rank + SF_KNIGHT_DR[i];
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const to = r * 8 + f;
        const target = b[to];
        if (!target || (target > 0 ? 1 : -1) === -us) emit(from, to, 0, 0, type);
      }
      continue;
    }

    const dirs = type === 3 ? SF_DIAG_DIRS : type === 4 ? SF_ORTH_DIRS : SF_ALL_DIRS;
    for (let i = 0; i < dirs.length; i += 2) {
      const df = dirs[i];
      const dr = dirs[i + 1];
      let f = file + df;
      let r = rank + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const to = r * 8 + f;
        const target = b[to];
        if (!target) emit(from, to, 0, 0, type);
        else {
          if ((target > 0 ? 1 : -1) === -us) emit(from, to, 0, 0, type);
          break;
        }
        if (type === 6) break;
        f += df;
        r += dr;
      }
    }

    if (type === 6) {
      if (us === 1 && from === 4) {
        if ((this.castling & 1) && b[7] === 4 && !b[5] && !b[6] && !this._isAttacked(4,-1) && !this._isAttacked(5,-1) && !this._isAttacked(6,-1)) emit(4, 6, 0, 4, type);
        if ((this.castling & 2) && b[0] === 4 && !b[1] && !b[2] && !b[3] && !this._isAttacked(4,-1) && !this._isAttacked(3,-1) && !this._isAttacked(2,-1)) emit(4, 2, 0, 8, type);
      } else if (us === -1 && from === 60) {
        if ((this.castling & 4) && b[63] === -4 && !b[61] && !b[62] && !this._isAttacked(60,1) && !this._isAttacked(61,1) && !this._isAttacked(62,1)) emit(60, 62, 0, 4, type);
        if ((this.castling & 8) && b[56] === -4 && !b[57] && !b[58] && !b[59] && !this._isAttacked(60,1) && !this._isAttacked(59,1) && !this._isAttacked(58,1)) emit(60, 58, 0, 8, type);
      }
    }
  }
  return legal;
};
