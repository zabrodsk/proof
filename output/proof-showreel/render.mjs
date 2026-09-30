import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '/Users/dusanzabrodsky/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const font=(family,file,weight,style='normal')=>`@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(path.join(root,'node_modules/@fontsource',file)).toString('base64')}) format('woff2');font-weight:${weight};font-style:${style};}`;
const fonts=[font('DM Sans','dm-sans/files/dm-sans-latin-500-normal.woff2',400),font('DM Sans','dm-sans/files/dm-sans-latin-500-normal.woff2',500),font('DM Sans','dm-sans/files/dm-sans-latin-700-normal.woff2','600 800'),font('Newsreader','newsreader/files/newsreader-latin-500-normal.woff2','400 700'),font('Newsreader','newsreader/files/newsreader-latin-500-italic.woff2','400 700','italic')].join('\n');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proof · Says who? · Motion reel</title><style>${fonts}*{box-sizing:border-box}body{margin:0;background:#0b1913;color:#f6f7ed;font:14px 'DM Sans',sans-serif;min-height:100vh;display:grid;place-content:center}main{width:min(100vw,1500px)}canvas{width:100%;display:block;aspect-ratio:16/9;background:#132e24}footer{display:flex;gap:20px;align-items:center;padding:20px 24px}button,a{border:1px solid #688673;background:transparent;color:inherit;padding:10px 16px;border-radius:0;font:inherit;cursor:pointer;text-decoration:none}input{flex:1;accent-color:#c8efb7;min-width:30px}span{font-variant-numeric:tabular-nums}button:hover,a:hover{background:#245c48}@media(max-width:600px){footer{padding:12px;gap:8px}a{display:none}}</style><main><canvas width="1920" height="1080" aria-label="Proof motion design reel"></canvas><footer><button id="play">Play with sound</button><input id="seek" aria-label="Video position" type="range" min="0" max="15" step="0.001" value="0"><span id="time">0:00 / 0:15</span><a href="proof-showreel.mp4" download>Download MP4</a></footer></main><audio id="audio" src="score.wav" preload="auto"></audio><script>${fs.readFileSync(path.join(dir,'scene.js'),'utf8')}</script><script>let playing=false,started=0,pos=0;const audio=document.querySelector('audio'),play=document.querySelector('#play'),seek=document.querySelector('#seek');function tick(now){if(playing){pos=audio.paused?(now-started)/1000:audio.currentTime;if(pos>=15){playing=false;pos=15;audio.pause();play.textContent='Replay';}window.draw(Math.min(14.999,pos));seek.value=pos;document.querySelector('#time').textContent='0:'+String(Math.floor(pos)).padStart(2,'0')+' / 0:15';}requestAnimationFrame(tick)}window.ready.then(()=>requestAnimationFrame(tick));play.onclick=async()=>{await window.ready;if(pos>=15)pos=0;playing=!playing;if(playing){audio.currentTime=pos;started=performance.now()-pos*1000;audio.play().catch(()=>{});}else audio.pause();play.textContent=playing?'Pause':'Play with sound'};seek.oninput=()=>{pos=Number(seek.value);audio.currentTime=pos;started=performance.now()-pos*1000;draw(Math.min(pos,14.999));};</script></html>`;
fs.writeFileSync(path.join(dir,'preview.html'),html);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--allow-file-access-from-files']});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 page.on('pageerror',e=>console.error(e));
 await page.goto('file://'+path.join(dir,'preview.html'));
 await page.evaluate(()=>window.ready);
 // Load all weights explicitly so the first rendered frame never uses a fallback.
 await page.evaluate(async()=>{await Promise.all([document.fonts.load('500 100px "DM Sans"'),document.fonts.load('700 100px "DM Sans"'),document.fonts.load('500 100px Newsreader'),document.fonts.load('italic 500 100px Newsreader')]);});
 const stills=[.95,2.95,5.9,9.35,10.65,11,11.8,13.95];
 fs.mkdirSync(path.join(dir,'stills'),{recursive:true});
 for(let i=0;i<stills.length;i++){
  const data=await page.evaluate(t=>{draw(t);return document.querySelector('canvas').toDataURL('image/png').split(',')[1]},stills[i]);
  fs.writeFileSync(path.join(dir,'stills',`${String(i+1).padStart(2,'0')}.png`),Buffer.from(data,'base64'));
 }
 if(process.argv.includes('--stills')){console.log('Stills and preview ready.');}
 else{
  const encoder=spawn('/opt/homebrew/bin/ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate','60','-vcodec','mjpeg','-i','pipe:0','-i',path.join(dir,'score.wav'),'-vf','scale=in_range=full:out_range=limited,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-r','60','-c:a','aac','-b:a','320k','-ar','48000','-t','15','-movflags','+faststart','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',path.join(dir,'proof-showreel.mp4')],{stdio:['pipe','inherit','inherit']});
  let error;encoder.on('error',e=>error=e);encoder.stdin.on('error',e=>error=e);
  for(let i=0;i<900;i++){
   if(error)throw error;
   const data=await page.evaluate(t=>{window.renderFrame(t);return document.querySelector('canvas').toDataURL('image/jpeg',.97).split(',')[1]},i/60);
   if(!encoder.stdin.write(Buffer.from(data,'base64')))await once(encoder.stdin,'drain');
   if(i%60===0)console.log(`Rendered ${i}/900 frames`);
  }
  encoder.stdin.end();const [code]=await once(encoder,'exit');if(code!==0)throw Error(`ffmpeg exited ${code}`);console.log('Export complete: proof-showreel.mp4');
 }
}finally{await browser.close();}
