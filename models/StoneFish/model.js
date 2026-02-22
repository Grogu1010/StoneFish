(function attachStoneFishModel(global) {
  const model = {
    id: "StoneFish-v1",
    displayName: "StoneFish v1",
    description: "A chaotic chess engine that picks a random legal move.",
    chooseMove(game) {
      const legalMoves = game.moves();
      if (!legalMoves.length) {
        return null;
      }

      const randomIndex = Math.floor(Math.random() * legalMoves.length);
      return legalMoves[randomIndex];
    },
  };

  global.StoneFishModel = model;
})(window);
