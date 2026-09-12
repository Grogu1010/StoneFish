// Load the candidate-only endgame layer immediately after the existing
// geometry patch without changing the released-reference VM bundle.
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) throw new Error('Usage: node run_with_endgame_patch.js <benchmark.js>');

const originalRead = fs.readFileSync.bind(fs);
fs.readFileSync = function(file, options) {
  const value = originalRead(file, options);
  if (path.basename(String(file)) !== 'Stonefish_v5_pro_geometry_patch.js') return value;
  const patchPath = path.join(path.dirname(String(file)), 'Stonefish_v5_pro_endgame_patch.js');
  if (!fs.existsSync(patchPath)) return value;
  const extra = originalRead(patchPath, 'utf8');
  if (Buffer.isBuffer(value)) return Buffer.concat([value, Buffer.from('\n\n' + extra)]);
  return String(value) + '\n\n' + extra;
};

require(path.resolve(target));
