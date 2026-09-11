// Small opening-data corrections kept separate from the v4.5 engine logic.
const stonefishV45Vienna = STONEFISH_V45_OPENINGS.find(line => line.id === 'w_vienna');
if (stonefishV45Vienna) {
  stonefishV45Vienna.moves = 'e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4 g1f3 b8c6 d2d3'.split(' ');
}
