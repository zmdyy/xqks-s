'use strict';
// Real SVG rasterization verifies pixel dimensions and the exported full chart.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const html=fs.readFileSync('index.html','utf8');
function source(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(html);assert(m,name);const text=html.slice(m.index);for(let end=text.indexOf('\n');end>=0;end=text.indexOf('\n',end+1)){const code=text.slice(0,end);try{new vm.Script(code);return code;}catch{}}throw Error(name);}
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(match[1]))new vm.Script(match[2]);
let width=800,height=400,downloads=[],errors=[],toasts=[],canvases=[],fontReady;
const urls=new Map(),pngButton={disabled:false},svgButton={disabled:false};
const chart={getWidth:()=>width,getHeight:()=>height,getDataURL:()=> 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="600" y="100" width="40" height="40" fill="#2563eb"/><text x="700" y="70" font-size="18">第17题 85%</text></svg>`)};
const chartEl={__chart:chart,clientWidth:300};
const elements={collectiveHeatmapChart:chartEl,collectiveHeatmapExportPngBtn:pngButton,collectiveHeatmapExportSvgBtn:svgButton,collectiveHeatmapMode:{value:'rate'},collectiveClassFilter:{value:'801'},collectiveHeatmapOnlyAbnormal:{checked:false}};
class ExportImage{set src(url){(async()=>{try{this.native=await loadImage(Buffer.from(await urls.get(url).text()));this.onload();}catch(e){this.onerror(e);}})();}}
const context={console,Blob,Image:ExportImage,URL:{createObjectURL(blob){const id='blob:'+urls.size;urls.set(id,blob);return id;},revokeObjectURL:id=>urls.delete(id)},setTimeout,
 document:{fonts:{ready:Promise.resolve()},getElementById:id=>elements[id],createElement(tag){assert.equal(tag,'canvas');const canvas=createCanvas(1,1),ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(img,...args)=>draw(img.native,...args);canvas.toBlob=(cb,type)=>{assert.equal(type,'image/png');cb(new Blob([canvas.toBuffer('image/png')],{type}));};canvases.push(canvas);return canvas;}},
 collectiveHeatmapContext:{subjectName:'物理',questions:[{}]},showToast:(...args)=>toasts.push(args),showAlert:text=>errors.push(text),downloadCollectiveHeatmapBlob:(blob,filename)=>downloads.push({blob,filename})};
vm.createContext(context);vm.runInContext(source('setCollectiveHeatmapExportEnabled'),context);vm.runInContext(source('exportCollectiveHeatmap'),context);
(async()=>{
 context.document.fonts.ready=new Promise(resolve=>{fontReady=resolve;});
 const task=context.exportCollectiveHeatmap('png');assert.equal(pngButton.disabled,true);assert.equal(svgButton.disabled,true);assert.equal(downloads.length,0);fontReady();await task;
 assert.equal(errors.length,0);assert.equal(canvases[0].width,3200);assert.equal(canvases[0].height,1600);assert.equal(downloads[0].blob.type,'image/png');assert.match(downloads[0].filename,/\.png$/);
 const png=await loadImage(Buffer.from(await downloads[0].blob.arrayBuffer()));assert.equal(png.width,3200);assert.equal(png.height,1600);assert.equal(urls.size,0);assert.equal(svgButton.disabled,false);
 // Rectangle outside the 300px visible viewport still appears in exported pixels.
 const pixel=canvases[0].getContext('2d').getImageData(2440,440,1,1).data;assert.ok(pixel[2]>pixel[0],'full chart, including horizontally scrolled area, is exported');
 await context.exportCollectiveHeatmap('svg');assert.equal(canvases.length,1,'SVG stays vector and does not rasterize');assert.match(downloads[1].filename,/\.svg$/);const svg=await downloads[1].blob.text();assert.match(svg,/第17题 85%/);assert.match(svg,/fill="#ffffff"/);
 // Never silently shrink a large chart below 2x. SVG remains available.
 width=10000;height=1200;await context.exportCollectiveHeatmap('png');assert.equal(downloads.length,2);assert.match(errors.at(-1),/矢量 SVG/);assert.equal(pngButton.disabled,false);await context.exportCollectiveHeatmap('svg');assert.equal(downloads.length,3);assert.match(await downloads.at(-1).blob.text(),/width="10000"/);
 // Student mode retains filename/filter semantics and pixel scaling.
 width=600;height=600;elements.collectiveHeatmapMode.value='student';elements.collectiveHeatmapOnlyAbnormal.checked=true;await context.exportCollectiveHeatmap('png');assert.match(downloads.at(-1).filename,/学生×小题_仅异常题/);assert.equal(canvases.at(-1).width,2400);
 chart.getDataURL=()=> 'data:image/png;base64,invalid';await context.exportCollectiveHeatmap('png');assert.match(errors.at(-1),/未获得完整图像/);assert.equal(urls.size,0);assert.equal(pngButton.disabled,false);assert.equal(svgButton.disabled,false);
 context.collectiveHeatmapContext=null;await context.exportCollectiveHeatmap('svg');assert.equal(toasts.length,1);
 assert.match(html,/id="collectiveHeatmapExportSvgBtn"/);assert.match(html,/exportCollectiveHeatmap\('svg'\)/);
 console.log('PASS heatmap export: real 4x PNG, full width, vector text, font readiness, large-chart protection, filters and failure cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
