// UI registration kept separate so v5 can land without rewriting the existing lab shell.
const v5Logic = [
  'Score every legal move on one unified points scale instead of eliminating moves through a tie-break chain',
  'Search every root move tactically, with deeper alpha-beta search as the position becomes less crowded',
  'Blend material, development, mobility, centre control, king safety, pawn structure, rook activity, board control, and piece safety at the same time',
  'Carry forward v5(testunit1)\'s strongest discovery: suppress opponent checks and mobility from move one',
  'Use the v4.5 opening repertoire and named mating patterns as weighted knowledge, never as unconditional overrides',
  'Penalise repetition strongly when ahead and reward 50-move resets so winning positions are pushed toward conversion'
];

models.v5 = {
  name: 'Stonefish_v5',
  trait: 'Unified scoring + search engine',
  subtitle: 'A new architecture: every legal move is scored together, then tactical search refines the result. It keeps the best v5(testunit1) inverse-pressure ideas without v4/v4.5\'s lexicographic filter chain.',
  logic: v5Logic,
  getMove: getStonefishV5Move
};

selectedModel = 'v5';
modelSelect.value = 'v5';
updateModelUI();
resetGame();
