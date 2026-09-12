// Stonefish v5 / v5 Pro inherited opening capability.
//
// v5 testunit1 was a frozen snapshot of the strong pre-balance v4.5 decision
// architecture. Its opening behavior used profile 0 and treated a compatible
// opening-book continuation as an actual move choice, not merely a few bonus
// points. v5 and v5 Pro keep all of their newer evaluation/search logic after
// book, but while a compatible repertoire line exists they now preserve that
// inherited capability exactly.

const STONEFISH_V5_INHERITED_OPENING_PROFILE = 0;

function stonefishV5InheritedOpeningMove(game) {
  return stonefishV45BookMove(game, STONEFISH_V5_INHERITED_OPENING_PROFILE);
}

const stonefishV5MoveAfterBook = getStonefishV5Move;
getStonefishV5Move = function(game) {
  const book = stonefishV5InheritedOpeningMove(game);
  if (book) return stonefishV3PublicMove(game, book);
  return stonefishV5MoveAfterBook(game);
};

if (typeof getStonefishV5ProMove === 'function') {
  const stonefishV5ProMoveAfterBook = getStonefishV5ProMove;
  getStonefishV5ProMove = function(game) {
    const book = stonefishV5InheritedOpeningMove(game);
    if (book) return stonefishV3PublicMove(game, book);
    return stonefishV5ProMoveAfterBook(game);
  };
}
