// UI registration kept separate so v5 can land without rewriting the existing lab shell.
const v5Logic = [
  'Score every legal move on one unified points scale instead of eliminating moves through a tie-break chain',
  'Evaluate three-ply tactical safety for every root move, not just a pre-filtered candidate set',
  'Blend material, development, mobility, centre control, king safety, pawn structure, rook activity, board control, and piece safety at the same time',
  'Suppress opponent checking chances and mobility from move one as weighted inverse-pressure signals',
  'Use the v4.5 opening repertoire and named mating patterns as weighted knowledge, never as unconditional overrides',
  'Prefer immediate mate over repeated mating threats and strongly reject repetition when a fresh winning route exists'
];

models.v5 = {
  name: 'Stonefish_v5',
  trait: 'Unified points engine',
  subtitle: 'A new architecture: every legal move competes on one combined tactical, positional, knowledge, inverse-pressure, and conversion score.',
  logic: v5Logic,
  getMove: getStonefishV5Move
};

selectedModel = 'v5';
modelSelect.value = 'v5';
updateModelUI();
resetGame();
