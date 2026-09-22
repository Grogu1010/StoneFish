const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');

if(isMainThread){
  const workers=Math.max(1,Number.parseInt(process.env.WORKERS||'8',10)||8);
  const gamesPerWorker=Math.max(2,Number.parseInt(process.env.GAMES_PER_WORKER||'4',10)||4);
  const pending=[];
  for(let i=0;i<workers;i++){
    pending.push(new Promise((resolve,reject)=>{
      const w=new Worker(__filename,{workerData:{workerIndex:i,games:gamesPerWorker}});
      w.once('message',resolve);w.once('error',reject);
      w.once('exit',code=>{if(code!==0)reject(new Error('worker exit '+code));});
    }));
  }
  Promise.all(pending).then(rows=>{
    const total={armxMoves:0,noMoves:0,armxMs:0,noMs:0,w:0,l:0,d:0};
    for(const r of rows)for(const k of Object.keys(total))total[k]+=r[k]||0;
    const result={
      workers,games:workers*gamesPerWorker,win:total.w,loss:total.l,draw:total.d,
      armxMsPerMove:total.armxMs/total.armxMoves,
      noArmxMsPerMove:total.noMs/total.noMoves,
      ratio:(total.armxMs/total.armxMoves)/(total.noMs/total.noMoves),
      armxMoves:total.armxMoves,noArmxMoves:total.noMoves
    };
    console.log('ARMX_PARALLEL_WORKERS '+JSON.stringify(result));
  }).catch(e=>{console.error(e);process.exitCode=1;});
}else{
  const files=[
    'StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
    'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js',
    'Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
    'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js',
    'Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'
  ];
  for(const file of files)vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file});
  function rng(seed){let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  function seeded(seed,fn){const old=Math.random;Math.random=rng(seed);try{return fn();}finally{Math.random=old;}}
  function clean(g,raw){const m=stonefishV3PublicMove(g,raw);return m?{from:m.from,to:m.to,promotion:m.promotion||undefined}:null;}
  function play(g,m){if(m&&m._raw){g._applyRaw(m._raw,true);return true;}return !!(m&&g.move({from:m.from,to:m.to,promotion:m.promotion||'q'}));}
  function opening(index){
    const g=new Chess(),pick=rng((0xA551000+index*977)>>>0),out=[];
    seeded((0xB771000+index*131)>>>0,()=>{for(let p=0;p<10&&!g.game_over();p++){
      const s=stonefishV5ScoreAllMoves(g);if(!s.length)break;const width=Math.min(4,s.length),r=pick();
      const rank=Math.min(width-1,r<.48?0:r<.76?1:r<.93?2:3),m=clean(g,s[rank].raw);
      if(!m||!play(g,m))break;out.push(m);
    }});return out;
  }
  function start(open){const g=new Chess();for(const m of open)if(!play(g,m))throw Error('opening');g.armxObservationStartPly=g.historyStack.length;return g;}
  function draw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
  const t={armxMoves:0,noMoves:0,armxMs:0,noMs:0,w:0,l:0,d:0};
  const base=workerData.workerIndex*workerData.games;
  for(let j=0;j<workerData.games;j++){
    const gi=base+j,pair=gi>>1,armxWhite=!(gi&1),g=start(opening(pair));let plies=g.historyStack.length;
    seeded((0xEE55000+gi*131)>>>0,()=>{while(plies<300&&!g.game_over()&&!draw(g)){
      const isArmx=(g.side===1)===armxWhite,st=performance.now();
      const m=isArmx?getStonefishV55Testunit1Move(g):getStonefishV55Testunit1NoARMXMove(g);
      const dt=performance.now()-st;
      if(isArmx){t.armxMoves++;t.armxMs+=dt;}else{t.noMoves++;t.noMs+=dt;}
      if(!m||!play(g,m))break;plies++;
    }});
    if(g.in_checkmate()){const whiteWon=g.side===-1;(whiteWon===armxWhite?t.w++:t.l++);}else t.d++;
  }
  parentPort.postMessage(t);
}
