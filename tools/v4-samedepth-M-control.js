const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const cfg={name:'M',order:M};for(const seed of[740000,760000,780000,800000,820000,840000])console.log('M CONTROL',seed,test(cfg,100,seed));
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
