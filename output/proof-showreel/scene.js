/* Proof / Says who? — 15 seconds, 128 BPM, 1920 × 1080. */
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', {alpha:false});
const W=1920,H=1080,B=60/128,TAU=Math.PI*2;
const C={ink:'#132e24',green:'#245c48',paper:'#f6f7ed',mint:'#c8efb7',sage:'#96b8a3',line:'#aec4ad',orange:'#eb9b72'};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const out=t=>1-Math.pow(1-clamp(t),4);
const io=t=>{t=clamp(t);return t<.5?8*t*t*t*t:1-Math.pow(-2*t+2,4)/2;};
const back=t=>{t=clamp(t)-1;return 1+2.2*t*t*t+1.2*t*t;};
const wave=(t,k=1)=>Math.sin(t*k);
const smooth=(t,a,d=.6)=>out((t-a)/d);
let g=ctx;
function rect(x,y,w,h,c){g.fillStyle=c;g.fillRect(x,y,w,h);}
function line(x,y,xx,yy,c,w=2){g.beginPath();g.moveTo(x,y);g.lineTo(xx,yy);g.strokeStyle=c;g.lineWidth=w;g.stroke();}
function circle(x,y,r,c,stroke=false,w=2){g.beginPath();g.arc(x,y,Math.max(.01,r),0,TAU);g[stroke?'strokeStyle':'fillStyle']=c;g.lineWidth=w;g[stroke?'stroke':'fill']();}
function text(s,x,y,size=60,c=C.paper,opts={}){
 g.font=`${opts.italic?'italic ':''}${opts.weight||500} ${size}px ${opts.serif?'Newsreader':'DM Sans'}`;
 g.textAlign=opts.align||'left';g.textBaseline='alphabetic';g.fillStyle=c;
 if(opts.outline){g.strokeStyle=c;g.lineWidth=opts.outline;g.strokeText(s,x,y);}else g.fillText(s,x,y);
}
function label(s,x,y,c=C.sage,align='left'){g.save();g.letterSpacing='3px';text(s,x,y,20,c,{weight:500,align});g.restore();}
function reveal(s,x,y,size,c,p,opts={}){
 g.save();g.beginPath();g.rect(x-12,y-size*1.2,1700,size*1.45);g.clip();
 g.translate(0,(1-out(p))*size*1.35);text(s,x,y,size,c,opts);g.restore();
}
function tracked(s,x,y,size,c,t,start=0,opts={}){
 g.save();g.font=`${opts.italic?'italic ':''}${opts.weight||700} ${size}px ${opts.serif?'Newsreader':'DM Sans'}`;
 const widths=[...s].map(ch=>g.measureText(ch).width);let xx=x;
 [...s].forEach((ch,i)=>{const p=out((t-start-i*.035)/.52);g.save();g.translate(xx,y+(1-p)*170);g.rotate((1-p)*-.14);g.globalAlpha=p;text(ch,0,0,size,c,opts);g.restore();xx+=widths[i]-(opts.tight||0);});g.restore();
}
function cornerMark(t,dark=true){
 const col=dark?C.sage:C.green;g.save();g.globalAlpha=.65;
 [[64,64,1,1],[1856,64,-1,1],[64,1016,1,-1],[1856,1016,-1,-1]].forEach(([x,y,dx,dy])=>{line(x,y,x+20*dx,y,col,1);line(x,y,x,y+20*dy,col,1);});
 g.restore();label('proof.',88,97,dark?C.paper:C.ink);label('SAYS WHO?',1832,97,col,'right');
 label('A STUDY IN EVIDENCE',88,990,col);label(`${String(Math.floor(t*60)).padStart(3,'0')} / 900`,1832,990,col,'right');
}
const noise=document.createElement('canvas');noise.width=256;noise.height=256;
const ng=noise.getContext('2d'),ndata=ng.createImageData(256,256);let seed=917;
function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<ndata.data.length;i+=4){let a=rand()*255;ndata.data.set([a,a,a,22],i);}ng.putImageData(ndata,0,0);
function grain(t){g.save();g.globalAlpha=.17;g.globalCompositeOperation='soft-light';g.translate(-((t*13)%60),-((t*7)%60));g.fillStyle=g.createPattern(noise,'repeat');g.fillRect(0,0,W+60,H+60);g.restore();}
function bg(dark=true){rect(0,0,W,H,dark?C.ink:C.paper);}
function halo(x,y,r,color,alpha=.15){g.save();g.globalAlpha=alpha;let grad=g.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,color);grad.addColorStop(1,'transparent');g.fillStyle=grad;g.fillRect(x-r,y-r,2*r,2*r);g.restore();}
function bezier(points,c,width=3,p=1){g.save();g.beginPath();g.moveTo(...points[0]);g.bezierCurveTo(...points[1],...points[2],...points[3]);g.strokeStyle=c;g.lineWidth=width;g.lineCap='round';g.setLineDash([2200*p,3000]);g.stroke();g.restore();}
// Paper textures are vector-drawn, then projected through a curved perspective mesh.
const papers=[],backs=[];
function createPaper(i){
 let c=document.createElement('canvas');c.width=640;c.height=850;let save=g;g=c.getContext('2d');
 rect(0,0,640,850,i%3===0?'#dcebd8':C.paper);rect(0,0,8,850,C.green);
 label('SOURCE '+String(i+1).padStart(2,'0'),44,62,C.green);label('[ '+(i+1)+' ]',594,62,C.green,'right');line(44,90,596,90,C.line,2);
 text(i%2?'The evidence':'Read the source.',44,159,53,C.ink,{serif:true});
 text(i%2?'in context.':'In context.',44,213,53,C.ink,{serif:true,italic:true});
 text('Abstract',44,280,24,C.green,{weight:700});
 for(let n=0;n<19;n++){
   let y=320+n*21;let len=450+Math.sin(n*8+i)*55;
   if(n===4||n===5)rect(42,y-9,len+5,17,C.mint);
   rect(44,y,len,3,n<7?'#668173':'#a5b9aa');
 }
 line(44,755,596,755,C.line,1);text('SOURCE TEXT / PASSAGE 01',44,792,16,C.green);text(String(i+1).padStart(2,'0'),595,792,18,C.green,{align:'right'});
 g=save;return c;
}
function point3(x,y,z,rx,ry,rz,cx,cy,d=1600){
 let y1=y*Math.cos(rx)-z*Math.sin(rx),z1=y*Math.sin(rx)+z*Math.cos(rx);
 let x2=x*Math.cos(ry)+z1*Math.sin(ry),z2=-x*Math.sin(ry)+z1*Math.cos(ry);
 let x3=x2*Math.cos(rz)-y1*Math.sin(rz),y3=x2*Math.sin(rz)+y1*Math.cos(rz);
 let s=d/(d+z2);return {x:cx+x3*s,y:cy+y3*s};
}
function tri(img,s0,s1,s2,d0,d1,d2){
 g.save();g.beginPath();g.moveTo(d0.x,d0.y);g.lineTo(d1.x,d1.y);g.lineTo(d2.x,d2.y);g.closePath();g.clip();
 const den=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
 const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/den;
 const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/den;
 const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/den;
 const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/den;
 const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/den;
 const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/den;
 g.transform(a,b,c,d,e,f);g.drawImage(img,0,0);g.restore();
}
function paper(cx,cy,w,h,rx,ry,rz,bend,idx,alpha=1){
 g.save();g.globalAlpha*=alpha;let img=(Math.cos(ry)<0?backs:papers)[idx%papers.length];const nx=12,ny=5,pts=[];
 for(let j=0;j<=ny;j++){pts[j]=[];for(let i=0;i<=nx;i++){
  let u=i/nx,v=j/ny;pts[j][i]=point3((u-.5)*w,(v-.5)*h,Math.sin(u*Math.PI)*bend,rx,ry,rz,cx,cy);
 }}
 g.beginPath();[pts[0][0],pts[0][nx],pts[ny][nx],pts[ny][0]].forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();
 g.fillStyle='#061b131b';g.shadowColor='#061b1344';g.shadowBlur=26;g.shadowOffsetY=18;g.fill();g.shadowBlur=0;g.shadowOffsetY=0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
 let a={x:i/nx*640,y:j/ny*850},b={x:(i+1)/nx*640,y:j/ny*850},c={x:(i+1)/nx*640,y:(j+1)/ny*850},d={x:i/nx*640,y:(j+1)/ny*850};
 tri(img,a,b,c,pts[j][i],pts[j][i+1],pts[j+1][i+1]);tri(img,a,c,d,pts[j][i],pts[j+1][i+1],pts[j+1][i]);
 }g.restore();
}
function scene0(t){
 bg();halo(1090,530,820,C.green,.65);
 const grow=out(t/.55),leave=io((t-1.62)/.255);
 g.save();g.translate(960,550);g.scale(1+leave*.55,1+leave*.55);g.rotate(-leave*.1);g.translate(-960,-550);
 g.save();g.globalAlpha=.16;for(let i=0;i<4;i++){circle(960,530,270+i*100+grow*70,C.sage,true,1);}
 for(let i=0;i<48;i++){let a=i/48*TAU+t*.15;let r=500;line(960+Math.cos(a)*r,530+Math.sin(a)*r,960+Math.cos(a)*(r+14),530+Math.sin(a)*(r+14),C.sage,2);}g.restore();
 tracked('SAYS',520,468,246,C.paper,t,.07,{weight:800,tight:10});
 tracked('who?',553,786,343,C.mint,t,.26,{serif:true,italic:true,weight:500,tight:10});
 bezier([[545,834],[780,782],[1140,896],[1392,790]],C.mint,8,smooth(t,.63,.55));
 for(let i=0;i<6;i++){let a=i*TAU/6+t*.24,r=650;g.save();g.translate(960+Math.cos(a)*r,540+Math.sin(a)*r*.54);g.rotate(a+.3);g.globalAlpha=.65*smooth(t,.2+i*.06);text('['+(i+1)+']',0,0,42,C.sage,{serif:true,italic:true});g.restore();}
 g.restore();cornerMark(t);
}
function scene1(t,global){
 bg(false);const arrive=out(t/.6),end=io((t-2.48)/.3325);halo(1440,540,760,C.sage,.35);
 // A twelve-page sculpture rotates in depth around a shared spine.
 const cards=[];for(let i=0;i<12;i++){
 let a=i/12*TAU+t*.56;cards.push({i,a,z:Math.sin(a)});
 }cards.sort((a,b)=>a.z-b.z);g.save();g.translate(-end*430,end*60);g.scale(1+end*.95,1+end*.95);
 cards.forEach(({i,a,z})=>{
  let radius=245*arrive,xx=1410+Math.cos(a)*radius,yy=545+Math.sin(a)*70;
  let s=.82+z*.16;paper(xx+(1-arrive)*600,yy,315*s,475*s,.13*Math.sin(a),a+.35,-.17+Math.sin(a)*.1,48,i,1);
 });g.restore();
 g.save();g.translate(-end*1200,0);reveal('Follow',115,459,193,C.ink,t/.5,{serif:true,italic:true});
 reveal('the source.',115,635,145,C.ink,(t-.14)/.5,{weight:700});
 label('THERE IS A PAPER TRAIL.',125,748,C.green);line(125,779,125+455*smooth(t,.6),779,C.green,3);g.restore();
 cornerMark(global,false);
}
function scene2(t,global){
 bg();halo(1400,540,850,C.green,.68);let p=out(t/.65),exit=io((t-2.48)/.3325);
 g.save();g.translate(-exit*190,0);reveal('Look',108,431,226,C.paper,t/.55,{weight:700});reveal('closer.',106,657,230,C.mint,(t-.12)/.55,{serif:true,italic:true});
 label('CLAIM → CITATION → SOURCE',119,769,C.sage);g.restore();
 let x=1288+(1-p)*580,y=535;g.save();g.translate(exit*1100,0);
 paper(x,y,535,728,-.05+.035*Math.sin(t),-.12-(1-p)*1.2,.08,55*Math.sin(t*.7),2);
 let ly=410+Math.sin(t*1.65)*85,lx=1290+Math.sin(t*1.1)*95;
 let size=155*back((t-.3)/.55);g.save();circle(lx,ly,size,C.mint);g.clip();rect(lx-size,ly-size,size*2,size*2,C.paper);
 rect(lx-200,ly-33,400,66,C.mint);text('evidence',lx,ly+23,69,C.ink,{serif:true,italic:true,align:'center'});
 for(let i=0;i<8;i++){if(i===3||i===4)continue;line(lx-180,ly-140+i*39,lx+180,ly-140+i*39,C.line,3);}g.restore();
 circle(lx,ly,size,C.mint,true,6);circle(lx,ly,size+13,'#c8efb744',true,1);line(lx+size*.72,ly+size*.72,lx+size*1.26,ly+size*1.26,C.mint,18);
 let scan=clamp((t-.6)/1.45);line(1020,240+scan*585,1570,240+scan*585,C.mint,2);
 [0,1,2].forEach(i=>{circle(1020+i*25,888,4,i*B<t?C.mint:C.green);});g.restore();
 cornerMark(global);
}
function card(x,y,w,h){g.save();g.shadowColor='#132e2414';g.shadowBlur=50;g.shadowOffsetY=16;rect(x,y,w,h,'#ffffff');g.restore();}
function scene3(t,global){
 bg(false);let p=out(t/.62);reveal('Context changes everything.',104,239,105,C.ink,t/.65,{serif:true,italic:true});
 const yl=350+(1-p)*250,yr=350+(1-smooth(t,.12,.65))*250;
 card(105,yl,770,385);card(1045,yr,770,385);
 label('THE CLAIM',147,yl+54,C.green);label('THE SOURCE',1087,yr+54,C.green);
 text('Works for',146,yl+173,79,C.ink,{weight:600});text('everyone.',146,yl+274,93,C.ink,{serif:true,italic:true});
 let highlight=smooth(t,.62,.5);rect(1084,yr+197,660*highlight,89,C.mint);
 text('Adults',1085,yr+173,87,C.ink,{serif:true});text('aged 18–35.',1085,yr+269,87,C.ink,{serif:true});
 circle(960,542,40,C.green);line(941,542,979,542,C.mint,3);line(969,532,979,542,C.mint,3);line(969,552,979,542,C.mint,3);
 if(t>.95){let s=back((t-.95)/.45);g.save();g.translate(768,673);g.rotate(-.15);g.scale(s,s);circle(0,0,49,C.orange);line(-17,-17,17,17,C.ink,5);line(17,-17,-17,17,C.ink,5);g.restore();}
 line(148,yl+286,148+440*smooth(t,1.03,.5),yl+286,C.orange,5);
 g.save();g.globalAlpha=smooth(t,1.2,.4);text('A real citation. An overreaching claim.',106,850,43,C.green,{weight:500});label('ILLUSTRATIVE EXAMPLE',1815,850,C.green,'right');g.restore();
 cornerMark(global,false);
}
function scene4(t,global){
 const ix=Math.min(2,Math.floor(t/B/.999));const words=['READ.','TRACE.','QUESTION.'];
 const dark=ix!==1;bg(dark);let tt=t-ix*B;
 let s=1+.07*(1-out(tt/.25));g.save();g.translate(960,545);g.scale(s,s);g.rotate((1-out(tt/.24))*(ix%2?.025:-.025));
 const size=ix===2?207:302;const col=dark?C.mint:C.ink;
 g.save();g.globalAlpha=.12;for(let i=-2;i<=2;i++){if(i===0)continue;text(words[ix],0,i*252+95,size,col,{weight:800,align:'center',outline:2});}g.restore();
 text(words[ix],0,95,size,col,{weight:800,align:'center'});g.restore();
 let pulse=1-out(tt/.38);g.save();g.globalAlpha=pulse*.7;rect(0,0,W,10,col);rect(0,H-10,W,10,col);g.restore();cornerMark(global,dark);
}
function bookDraw(x,y,size,p){
 g.save();g.translate(x,y);g.scale(size/200,size/200);g.lineWidth=5;g.strokeStyle=C.mint;g.lineJoin='round';g.lineCap='round';
 const open=out(p);g.scale(.2+.8*open,1);g.beginPath();g.moveTo(0,65);g.bezierCurveTo(-35,40,-62,40,-91,49);g.lineTo(-91,-62);g.bezierCurveTo(-55,-71,-29,-65,0,-42);g.bezierCurveTo(29,-65,55,-71,91,-62);g.lineTo(91,49);g.bezierCurveTo(62,40,35,40,0,65);g.lineTo(0,-42);g.stroke();
 let k=smooth(p,.25,.5);g.beginPath();g.moveTo(26,0);g.lineTo(41,18);g.lineTo(70,-21);g.setLineDash([110*k,150]);g.stroke();g.restore();
}
function scene5(t,global){
 bg();halo(960,550,880,C.green,.55);const settle=out(t/.8);
 g.save();g.globalAlpha=.18;for(let i=0;i<9;i++){
  let r=280+i*65+(1-settle)*800;g.save();g.translate(960,530);g.rotate(-.2+t*.055+i*.018);g.strokeStyle=C.sage;g.lineWidth=1;g.strokeRect(-r,-r*.64,r*2,r*1.28);g.restore();
 }g.restore();
 g.save();g.translate(0,(1-settle)*90);bookDraw(960,288,120,smooth(t,.02,.8));
 text('proof',894,647,320,C.paper,{serif:true,weight:500,align:'center'});
 let drop=back((t-.28)/.65);circle(1308,620-(1-drop)*180,21,C.mint);
 g.save();g.globalAlpha=smooth(t,.5,.65);text('Make every claim count.',960,762,54,C.mint,{align:'center',weight:400});g.restore();
 g.save();g.globalAlpha=smooth(t,.9,.55);label('CHECK THE CLAIM. READ THE EVIDENCE.',960,864,C.sage,'center');g.restore();g.restore();
 cornerMark(global);
}
function draw(t){
 t=clamp(t,0,14.999);g=ctx;g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';
 if(t<4*B)scene0(t);else if(t<10*B)scene1(t-4*B,t);else if(t<16*B)scene2(t-10*B,t);else if(t<22*B)scene3(t-16*B,t);else if(t<26*B)scene4(t-22*B,t);else scene5(t-26*B,t);
 // Paper slashes bridge the first two cuts; they have their own acceleration.
 [4*B,10*B].forEach(cut=>{let dt=t-cut;if(dt>-.14&&dt<.21){let p=(dt+.14)/.35;let xx=-1100+p*4100;g.save();g.translate(xx,540);g.rotate(-.2);rect(-290,-900,580,1800,C.mint);rect(-300,-900,10,1800,C.green);g.restore();}});
 grain(t);
}
window.ready=(async()=>{
 await Promise.all([document.fonts.load('500 100px "DM Sans"'),document.fonts.load('700 100px "DM Sans"'),document.fonts.load('500 100px Newsreader'),document.fonts.load('italic 500 100px Newsreader')]);
 await document.fonts.ready;for(let i=0;i<6;i++){
  papers.push(createPaper(i));let c=document.createElement('canvas');c.width=640;c.height=850;let b=c.getContext('2d');
  b.fillStyle=i%3===0?'#dcebd8':C.paper;b.fillRect(0,0,640,850);b.globalAlpha=.035;b.translate(640,0);b.scale(-1,1);b.drawImage(papers[i],0,0);backs.push(c);
 }draw(0);window.draw=draw;
 const accumulation=document.createElement('canvas');accumulation.width=W;accumulation.height=H;const ag=accumulation.getContext('2d');
 window.renderFrame=t=>{
  ag.globalAlpha=1;draw(t-1/300);ag.drawImage(canvas,0,0);ag.globalAlpha=.5;draw(t+1/300);ag.drawImage(canvas,0,0);ctx.drawImage(accumulation,0,0);
 };
})();
