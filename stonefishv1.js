(function () {
  const PROMOTIONS = ["Q", "R", "B", "N"];

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  window.StonefishV1 = {
    name: "Stonefish v1",

    chooseMove(game, color) {
      const legalMoves = game.getAllLegalMoves(color);
      if (!legalMoves.length) return null;

      const move = game.cloneMove(randomItem(legalMoves));
      if (game.isPromotionMove(move)) {
        move.promotion = randomItem(PROMOTIONS);
      }
      return move;
    }
  };
})();
