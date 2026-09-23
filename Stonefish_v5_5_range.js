// Stonefish v5.5 range — Athena, Ares and Artemis.
//
// All three models use the exact same native v5.5 chess engine and Full ARMX.
// Artemis adds no playstyle preference. Athena and Ares add bounded finalist
// style priors only after native search; mate-scale truth and large native score
// gaps remain protected.

const STONEFISH_V5_5_RANGE = Object.freeze({
  technology: 'Full ARMX',
  base: 'Stonefish v5.5 native PVS',
  models: Object.freeze({
    athena: Object.freeze({
      name: 'Stonefish_v5.5 Athena',
      style: 'athena',
      identity: 'extreme-defense',
    }),
    ares: Object.freeze({
      name: 'Stonefish_v5.5 Ares',
      style: 'ares',
      identity: 'extreme-aggression',
    }),
    artemis: Object.freeze({
      name: 'Stonefish_v5.5 Artemis',
      style: 'artemis',
      identity: 'balanced',
    }),
  }),
});

function stonefishV55RangeScoreAllMoves(game, style = 'artemis') {
  const perspective = game.side;
  const policy = armxFullOpponentPolicy(game, perspective);
  const host = stonefishV55HostSearch(game, policy);
  return armxFullRankHost(game, host, style);
}

function getStonefishV55AthenaMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'athena');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55AresMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'ares');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55ArtemisMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'artemis');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_RANGE = STONEFISH_V5_5_RANGE;
  globalThis.stonefishV55RangeScoreAllMoves = stonefishV55RangeScoreAllMoves;
  globalThis.getStonefishV55AthenaMove = getStonefishV55AthenaMove;
  globalThis.getStonefishV55AresMove = getStonefishV55AresMove;
  globalThis.getStonefishV55ArtemisMove = getStonefishV55ArtemisMove;
}
