'use strict';

const { parentPort } = require('node:worker_threads');
const StoneFish = require('./stonefish-node.cjs');

parentPort.on('message', request => {
  try {
    if (!request || typeof request !== 'object') throw new Error('Invalid search request.');
    const moves = Array.isArray(request.moves) ? request.moves : [];
    const game = StoneFish.createGame(moves);
    const actualFen = game.fen();

    if (typeof request.fen !== 'string' || actualFen !== request.fen) {
      throw new Error('Authoritative FEN does not match the supplied move history.');
    }

    const choice = StoneFish.getMove(request.modelId, game);
    const uci = choice && choice.move && choice.move.uci;
    if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
      throw new Error('StoneFish did not return a valid UCI move.');
    }

    const played = StoneFish.playMove(game, uci);
    if (!played.move || played.move.uci !== uci) throw new Error('Selected move failed local legality validation.');

    parentPort.postMessage({
      requestId: request.requestId,
      gameId: request.gameId,
      ply: request.ply,
      move: uci,
      elapsedMs: Date.now() - request.startedAt
    });
  } catch (error) {
    parentPort.postMessage({
      requestId: request && request.requestId,
      gameId: request && request.gameId,
      ply: request && request.ply,
      error: error && error.message ? error.message : String(error)
    });
  }
});
