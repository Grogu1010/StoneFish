// Run the existing v5.5 range harness with one experimental Full ARMX override
// appended after ARMX/ARMX.js. This preserves the production file and the frozen
// current-v5.5 control while exercising the candidate logic on the Full side.
const fs=require('fs');
const path=require('path');

const originalReadFileSync=fs.readFileSync.bind(fs);
const overridePath=path.join(__dirname,'..','ARMX','ARMX-causal-horizon-experiment.js');
const overrideSource=originalReadFileSync(overridePath,'utf8');

fs.readFileSync=function patchedReadFileSync(file,options){
  const value=originalReadFileSync(file,options);
  const normalized=String(file).replace(/\\/g,'/');
  if(!normalized.endsWith('ARMX/ARMX.js'))return value;
  if(typeof value==='string')return value+'\n\n'+overrideSource+'\n';
  return Buffer.concat([value,Buffer.from('\n\n'+overrideSource+'\n')]);
};

require('./v5_5_range.js');
