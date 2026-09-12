// Parity gate for the UI known-legal-move fast path.
//
// The browser can reuse raw moves already produced by fastMoves()/the selected
// StoneFish model instead of asking Chess.move() to generate every legal move a
// second time. This test proves the shortcut returns identical public move/SAN,
// reaches identical state, updates repetition/history identically, and undoes
// identically across ordinary and special-rule positions.

const fs = require('fs');
const vm = require('vm');

const source = [
  fs.readFileSync('StonefishChess.js', 'utf8'),
  fs.readFileSync('Stonefish_runtime_speed_patch.js', 'utf8'),
  `
  function uiParityClone(source) {
    const game = new Chess();
    game.boardState = new Int8Array(source.boardState);
    game.side = source.side;
    game.castling = source.castling;
    game.ep = source.ep;
    game.halfmove = source.halfmove;
    game.fullmove = source.fullmove;
    game.kingSq = { 1: source.kingSq[1], '-1': source.kingSq[-1] };
    game.historyStack = source.historyStack.slice();
    game.positionCounts = new Map(source.positionCounts);
    game._stonefishRuntimePositionKey = null;
    game._stonefishRuntimeMemo = null;
    game._stonefishRuntimeCacheStack = [];
    return game;
  }

  function uiParityCommitKnownRaw(game, raw) {
    const publicBefore = game._publicMove(raw, false);
    game._applyRaw(raw, true);
    const check = game.in_check();
    const mate = check && !game.fastHasLegalMove();
    return { ...publicBefore, san: game._notation(raw, check, mate) };
  }

  function uiParityState(game) {
    const key = game.fastPositionKey();
    return JSON.stringify({
      fen: game.fen(),
      key,
      side: game.side,
      castling: game.castling,
      ep: game.ep,
      halfmove: game.halfmove,
      fullmove: game.fullmove,
      kingWhite: game.kingSq[1],
      kingBlack: game.kingSq[-1],
      history: game.historyStack.length,
      currentCount: game.positionCounts.get(key) || 0,
      board: Array.from(game.boardState)
    });
  }

  function uiParityPlay(game, uci) {
    const promotion = uci.length > 4 ? uci[4] : 'q';
    const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion });
    if (!move) throw new Error('Illegal setup move: ' + uci + ' in ' + game.fen());
  }

  function uiParityCustom(entries, side = 1, castling = 0, ep = -1) {
    const game = new Chess();
    game.boardState.fill(0);
    const types = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
    for (const [square, symbol] of entries) {
      const lower = symbol.toLowerCase();
      const value = types[lower] * (symbol === lower ? -1 : 1);
      const sq = game._sq(square);
      game.boardState[sq] = value;
      if (Math.abs(value) === 6) game.kingSq[value > 0 ? 1 : -1] = sq;
    }
    game.side = side;
    game.castling = castling;
    game.ep = ep;
    game.halfmove = 0;
    game.fullmove = 1;
    game.historyStack = [];
    game._stonefishRuntimePositionKey = null;
    game._stonefishRuntimeMemo = null;
    game._stonefishRuntimeCacheStack = [];
    game.positionCounts = new Map();
    game.positionCounts.set(game.fastPositionKey(), 1);
    return game;
  }

  function uiParityCheckPosition(position, label) {
    const legal = position.fastMoves();
    for (let i = 0; i < legal.length; i += 1) {
      const raw = legal[i];
      const officialGame = uiParityClone(position);
      const fastGame = uiParityClone(position);
      const before = uiParityState(officialGame);
      const promotion = raw.promotion ? officialGame._typeChar(raw.promotion) : 'q';

      const official = officialGame.move({
        from: officialGame._alg(raw.from),
        to: officialGame._alg(raw.to),
        promotion
      });
      const fast = uiParityCommitKnownRaw(fastGame, raw);

      if (JSON.stringify(official) !== JSON.stringify(fast)) {
        throw new Error(label + ' move object mismatch for ' + position._alg(raw.from) + position._alg(raw.to)
          + '\\nofficial=' + JSON.stringify(official) + '\\nfast=' + JSON.stringify(fast));
      }
      if (uiParityState(officialGame) !== uiParityState(fastGame)) {
        throw new Error(label + ' resulting state mismatch for ' + position._alg(raw.from) + position._alg(raw.to));
      }

      officialGame.undo();
      fastGame.undo();
      if (uiParityState(officialGame) !== before || uiParityState(fastGame) !== before) {
        throw new Error(label + ' undo mismatch for ' + position._alg(raw.from) + position._alg(raw.to));
      }
    }
    return legal.length;
  }

  const positions = [];
  const rolling = new Chess();
  for (let ply = 0; ply < 90; ply += 1) {
    positions.push(uiParityClone(rolling));
    const legal = rolling.fastMoves();
    if (!legal.length) {
      rolling.reset();
      continue;
    }
    const raw = legal[(ply * 17 + 11) % legal.length];
    const promotion = raw.promotion ? rolling._typeChar(raw.promotion) : 'q';
    const played = rolling.move({ from: rolling._alg(raw.from), to: rolling._alg(raw.to), promotion });
    if (!played) throw new Error('Failed deterministic rolling move');
  }

  const castle = new Chess();
  for (const move of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1e2', 'g8f6']) uiParityPlay(castle, move);
  positions.push(castle);

  const enPassant = new Chess();
  for (const move of ['e2e4', 'a7a6', 'e4e5', 'd7d5']) uiParityPlay(enPassant, move);
  positions.push(enPassant);

  positions.push(uiParityCustom([
    ['e1', 'K'], ['h8', 'k'], ['a7', 'P'], ['b8', 'r']
  ], 1));

  positions.push(uiParityCustom([
    ['f6', 'K'], ['g6', 'Q'], ['h8', 'k']
  ], 1));

  positions.push(uiParityCustom([
    ['e1', 'K'], ['a8', 'k'], ['e8', 'r']
  ], 1));

  let checkedMoves = 0;
  for (let i = 0; i < positions.length; i += 1) {
    checkedMoves += uiParityCheckPosition(positions[i], 'position ' + i);
  }

  console.log(JSON.stringify({
    type: 'STONEFISH_UI_MOVE_APPLY_PARITY',
    positions: positions.length,
    moves: checkedMoves,
    status: 'PASS'
  }));
  `
].join('\n\n');

const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: 'stonefish-ui-move-apply-parity-bundle.js' });
