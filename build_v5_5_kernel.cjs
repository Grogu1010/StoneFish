// Rebuild the embedded helper module with portable Zig 0.14.1 (or compatible
// Clang through Zig). Set ZIG to the compiler executable; no npm dependencies.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=__dirname,source=path.join(root,'native','v5_5_helpers.c');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'stonefish-kernel-'));
try {
 const output=path.join(temporary,'helpers.wasm');
 const exports=['board_ptr','config_ptr','moves_ptr','evaluate','in_check','generate'];
 execFileSync(process.env.ZIG||'zig',['cc','-target','wasm32-freestanding','-O3','-nostdlib',
  '-Wl,--no-entry',...exports.map(name=>'-Wl,--export='+name),'-Wl,--export-memory',source,'-o',output],{stdio:'inherit'});
 const bytes=fs.readFileSync(output),module=new WebAssembly.Module(bytes);
 if(WebAssembly.Module.imports(module).length)throw Error('Kernel must have no imports');
 const hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const lines=[];for(let i=0;i<bytes.length;i+=64)lines.push('  '+[...bytes.subarray(i,i+64)].join(','));
 const block='// BEGIN GENERATED V55 WASM\n// Zig 0.14.1; SHA-256 '+hash+'\n'
  +'const SF55C_WASM_BYTES=new Uint8Array([\n'+lines.join(',\n')+'\n]);\n// END GENERATED V55 WASM';
 const target=path.join(root,'Stonefish_v5_5_native.js'),before=fs.readFileSync(target,'utf8');
 const after=before.replace(/\/\/ BEGIN GENERATED V55 WASM[\s\S]*?\/\/ END GENERATED V55 WASM/,block);
 if(after===before&&!before.includes(hash))throw Error('Generated marker missing');
 fs.writeFileSync(target,after);
 console.log(JSON.stringify({bytes:bytes.length,sha256:hash}));
} finally {
 // mkdtemp creates this exact task-owned directory under the OS temp root.
 if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir()))throw Error('Unsafe temporary path');
 fs.rmSync(temporary,{recursive:true,force:true});
}
