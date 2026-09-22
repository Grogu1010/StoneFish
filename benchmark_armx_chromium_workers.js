const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const root=process.cwd();
const games=Math.max(2,Number.parseInt(process.env.GAMES||'100',10)||100);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const rel=pathname==='/'?'index.html':pathname.replace(/^\//,'');
  const file=path.resolve(root,rel);
  if(!file.startsWith(root)){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end('not found');}
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage();
    await page.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,get:()=>9}));
    await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'load'});
    await page.locator('input[name="test-model"]').uncheck();
    await page.locator('input[name="test-model"][value="v55test1noarmx"]').check();
    await page.locator('input[name="test-model"][value="v55test1"]').check();
    await page.locator('#test-count').fill(String(games));
    await page.locator('#run-test').click();
    await page.waitForFunction(()=>{
      const el=document.querySelector('#test-results .test-progress-heading');
      return el&&/^Final/.test(el.textContent||'');
    },null,{timeout:300000});
    const result=await page.evaluate(()=>{
      const text=document.querySelector('#test-results').innerText;
      const rows=[...document.querySelectorAll('#test-results .result-row')].map(el=>el.innerText);
      const overall=rows.slice(0,2);
      const extract=(row)=>{
        const ms=/(\d+(?:\.\d+)?) ms\/move/.exec(row);
        return ms?Number(ms[1]):null;
      };
      const noRow=overall.find(x=>x.startsWith('5.5(testunit1) (no ARMX)'));
      const armxRow=overall.find(x=>x.startsWith('5.5(testunit1)')&&!x.startsWith('5.5(testunit1) (no ARMX)'));
      const note=[...document.querySelectorAll('#test-results .developer-note')].map(x=>x.innerText).join(' ');
      const workers=/under (\d+) concurrent worker/.exec(note);
      const compiled=/compiled-search moves (\d+)/.exec(armxRow||'');
      const fallback=/fallback\/base moves (\d+)/.exec(armxRow||'');
      const armxMs=extract(armxRow||''),noArmxMs=extract(noRow||'');
      return {games,workers:workers?Number(workers[1]):null,armxMs,noArmxMs,
        ratio:armxMs&&noArmxMs?armxMs/noArmxMs:null,
        compiledMoves:compiled?Number(compiled[1]):null,
        fallbackMoves:fallback?Number(fallback[1]):null,
        overall,text};
    });
    console.log('ARMX_CHROMIUM_WORKERS '+JSON.stringify(result));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
