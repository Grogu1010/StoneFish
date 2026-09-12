// UI registration for Stonefish_v5 Pro.
const v5ProLogic = [
  'Blend opening, attack, defence, conversion, endgame, and pawn-race priorities instead of using one fixed set of weights',
  'Score pins, skewers, loose pieces, overloaded defenders, king-zone pressure, and piece coordination',
  'Reward initiative and multi-purpose threats while actively suppressing the opponent’s checks, promotions, captures, and mobility',
  'Convert advantages by simplifying safely, reducing counterplay, and giving advanced passed pawns much more urgency',
  'Adjust confidence and heritage influence to the position instead of trusting old move patterns equally everywhere',
  'Search five plies selectively — exactly two plies deeper than Stonefish_v5 — with alpha-beta pruning and move ordering'
];

models.v5pro = {
  name: 'Stonefish_v5 Pro',
  trait: 'Adaptive five-ply points engine',
  subtitle: 'Stonefish_v5’s unified scoring upgraded with adaptive context, threat geometry, conversion intelligence, and a selective five-ply search.',
  logic: v5ProLogic,
  getMove: getStonefishV5ProMove
};

selectedModel = 'v5pro';
modelSelect.value = 'v5pro';
updateModelUI();
resetGame();
