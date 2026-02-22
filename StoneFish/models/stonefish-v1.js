export const stoneFishV1 = {
  id: 'stonefish-v1',
  name: 'StoneFish v1',
  description: 'A chaotic engine that always chooses a random legal move.',
  chooseMove(game) {
    const legalMoves = game.moves({ verbose: true });
    if (!legalMoves.length) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * legalMoves.length);
    return legalMoves[randomIndex];
  },
};
