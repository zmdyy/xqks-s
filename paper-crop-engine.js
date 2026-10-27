/* Geometry adapters and deterministic candidate ownership. No network or DOM. */
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
function number(text){const t=String(text||'').replace(/<[^>]+>/g,'').replace(/\$|\\(?:textbf|mathrm)\{|[{}]/g,'').trim();const m=t.match(/^(?:第\s*)?(\d{1,3})\s*(?:[.．、:：)](?!\d)|题)/);return m?String(Number(m[1])):null;}
function major(value){let s=String(value||'').replace(/\s+/g,'');if(s.includes('卷'))s=s.slice(s.lastIndexOf('卷')+1);s=s.replace(/^(?:(?:物理|化学|科学|数学|语文|英语|单选题|单选|多选题|多选|选择题|计算题|计算|填空题|填空|实验题|实验|第))+/,'');return s.match(/^(\d{1,3})(?:题|[（(.．、-]|$)/)?.[1]?.replace(/^0+(?=\d)/,'')||null;}

function textOf(b){if(typeof b==='string')return b;if(!b)return '';if(Array.isArray(b))return b.map(textOf).join('');if(b.text)return textOf(b.text);if(b.content)return textOf(b.content);if(b.lines)return b.lines.map(l=>textOf(l.spans||l)).join('\n');return '';}
function normalize(payload){
 const warnings=[],blocks=[];let data=payload?.data||payload;if(!data)return {blocks,warnings:['没有可用 MinerU 坐标，将使用本地 PDF 文字层解析。']};
 function add(b,page,w,h,scale){if(!Number.isInteger(page)||page<0){warnings.push("页码无效，未使用坐标");return;}const box=b.bbox||b.normalized_bbox;if(!Array.isArray(box)||box.length!==4){return;}let vals=box.map(Number);if(!vals.every(Number.isFinite))return;let sx=w,sy=h;if(b.normalized_bbox||scale==='normalized'){sx=sy=1;}if(scale==='1000'){sx=sy=1000;}if(!(sx>0&&sy>0)){warnings.push('第'+(page+1)+'页缺少尺寸，未使用其坐标');return;}let [x,y,r,d]=vals.map((v,i)=>v/(i%2?sy:sx));if(x<-.005||y<-.005||r>1.005||d>1.005||r<=x||d<=y){warnings.push('第'+(page+1)+'页存在越界坐标');return;}blocks.push({page:page+1,x:Math.max(0,x),y:Math.max(0,y),w:Math.min(1,r)-Math.max(0,x),h:Math.min(1,d)-Math.max(0,y),text:textOf(b),type:b.type||'text',order:blocks.length});}
 if(data.pdf_info){data.pdf_info.forEach((p,i)=>{let size=p.page_size||[];let bs=p.para_blocks?.length?p.para_blocks:(p.preproc_blocks||[]);bs.forEach(b=>add(b,Number(p.page_idx??i),size[0],size[1]));});}
 else if(data.pages){const sizes=data.extensions?.docvortex_layout?.pages||[];data.pages.forEach((p,i)=>{const idx=Number(p.page_idx??i),sz=sizes.find(s=>s.page_idx===idx)||{};let w=p.width_pt||p.width||p.page_size?.[0]||sz.width_pt,h=p.height_pt||p.height||p.page_size?.[1]||sz.height_pt;(p.blocks||[]).forEach(b=>add(b,idx,w,h,payload.coordinate_system));});}
 else if(Array.isArray(data)){const scale=payload.coordinate_system||'1000';data.forEach((b,i)=>{if(Array.isArray(b))b.forEach(x=>add(x,Number(x.page_idx??i),0,0,scale));else add(b,Number(b.page_idx??0),0,0,scale);});}
 else warnings.push('未识别的 MinerU JSON 格式');
 if(!blocks.length)warnings.push('结果中没有可用版面坐标');return {blocks,warnings:[...new Set(warnings)]};
}
function groupNativeBlocks(input){
 const out=[];input.slice().sort((a,b)=>a.page-b.page||Math.round((a.y+a.h)*200)-Math.round((b.y+b.h)*200)||a.x-b.x).forEach(b=>{
   const line=out.length?out[out.length-1]:null;
   if(line&&line.page===b.page&&Math.abs(line.y+line.h-b.y-b.h)<.008&&b.x>=line.x&&b.x-(line.x+line.w)<.035){const right=Math.max(line.x+line.w,b.x+b.w),bottom=Math.max(line.y+line.h,b.y+b.h);line.text+=b.text;line.y=Math.min(line.y,b.y);line.w=right-line.x;line.h=bottom-line.y;}
   else out.push({...b});
 });return out;
}
function candidates(input,questions,source){
 const wanted=new Set(questions.map(q=>String(q.major))),result={},warnings=[];const blocks=input.filter(b=>b.w>0&&b.h>0&&b.y<.97&&!/header|footer|page_number/.test(b.type||'')&&!(b.y<.1&&/姓名|班级|学校|考号|第.{0,4}页|共.{0,4}页/.test(b.text||''))).map(b=>({...b,major:number(b.text)}));
 const pageIds=[...new Set(blocks.map(b=>b.page))].sort((a,b)=>a-b);let ordered=[];
 pageIds.forEach(page=>{const bs=blocks.filter(b=>b.page===page);const ms=bs.filter(b=>b.major);const left=ms.filter(b=>b.x<.45),right=ms.filter(b=>b.x>=.45);const two=left.length>=1&&right.length>=1&&!bs.some(b=>b.w>.8&&b.y>.15&&b.type==='text');bs.forEach(b=>b.col=two?(b.x+b.w/2<.5?0:1):0);bs.sort((a,b)=>a.col-b.col||a.y-b.y||a.x-b.x);ordered.push(...bs);});
 const counts={};ordered.forEach(b=>{if(b.major)counts[b.major]=(counts[b.major]||0)+1;});let owner=null;
 ordered.forEach(b=>{if(b.major){owner=b.major;if(counts[owner]>1)warnings.push('题号 '+owner+' 重复出现，需人工定位');}if(!owner||!wanted.has(owner)||counts[owner]!==1)return;const q=result[owner]||(result[owner]={regions:[],confirmed:false,source:source||'MinerU',warnings:[]});let r=q.regions.find(r=>r.page===b.page&&r.column===b.col);const pad=.004;if(!r){r={page:b.page,column:b.col,x:Math.max(0,b.x-pad),y:Math.max(0,b.y-pad),w:Math.min(1,b.x+b.w+pad)-Math.max(0,b.x-pad),h:Math.min(1,b.y+b.h+pad)-Math.max(0,b.y-pad)};q.regions.push(r);}else{const right=Math.max(r.x+r.w,Math.min(1,b.x+b.w+pad)),bottom=Math.max(r.y+r.h,Math.min(1,b.y+b.h+pad));r.x=Math.min(r.x,Math.max(0,b.x-pad));r.y=Math.min(r.y,Math.max(0,b.y-pad));r.w=right-r.x;r.h=bottom-r.y;}});
 if(source==='PDF 文字层'){
   // Text extraction has no figure boxes: preserve the column space between anchors.
   const scopes=[];ordered.forEach(b=>{const k=b.page+':'+b.col;if(!scopes.some(s=>s.key===k))scopes.push({key:k,page:b.page,column:b.col,two:ordered.some(x=>x.page===b.page&&x.col===1)});});
   const starts=ordered.filter(b=>b.major);
   Object.keys(result).forEach(major=>{const start=starts.find(b=>b.major===major),idx=starts.indexOf(start),next=starts[idx+1],from=scopes.findIndex(s=>s.page===start.page&&s.column===start.col),to=next?scopes.findIndex(s=>s.page===next.page&&s.column===next.col):from;
     result[major].regions=[];
     for(let i=from;i<=to;i++){const s=scopes[i];let top=i===from?Math.max(.01,start.y-.006):.04,bottom=next&&i===to?Math.max(.01,next.y-.006):.96;if(bottom<=top+.005)continue;result[major].regions.push({page:s.page,column:s.column,x:s.two?(s.column===0?.02:.51):.02,y:top,w:s.two?.47:.96,h:bottom-top});}
     result[major].warnings.push('文字层候选按题号间区域保留题图，请检查边界');
   });
 }
 Object.values(result).forEach(q=>{if(q.regions.length>1)q.warnings.push('跨页或跨栏，请检查片段归属');});return {records:result,warnings};
}
function overlaps(records){
 const entries=Object.entries(records),found=[];
 entries.forEach(([a,r],i)=>entries.slice(i+1).forEach(([b,s])=>{
   const pages=new Set();(r.regions||[]).forEach(x=>(s.regions||[]).forEach(y=>{if(x.page!==y.page)return;const area=Math.max(0,Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x))*Math.max(0,Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y));if(area>Math.min(x.w*x.h,y.w*y.h)*.25)pages.add(x.page);}));
   if(!pages.size)return;const pair=[a,b].sort((x,y)=>Number(x)-Number(y)),signature=JSON.stringify(pair.map(k=>[k,records[k].regions]));
   const approval=(r.overlapApprovals||[]).find(p=>p.signature===signature&&p.reason);
   found.push({a,b,pages:[...pages],signature,approved:!!approval,reason:approval?.reason||''});
 }));return found;
}
function validate(records,questions,pages){const issues=[];questions.forEach(q=>{let r=records[q.major];if(!r?.regions?.length)issues.push('第'+q.major+'题未定位');else{if(!r.confirmed)issues.push('第'+q.major+'题未确认');r.regions.forEach(b=>{if(!(Number.isInteger(b.page)&&b.page>=1&&b.page<=pages&&Number.isFinite(b.x)&&Number.isFinite(b.y)&&b.x>=0&&b.y>=0&&b.w>0&&b.h>0&&b.x+b.w<=1.001&&b.y+b.h<=1.001))issues.push('第'+q.major+'题区域无效');});}});return [...new Set(issues)];}
root.PaperCropEngine={number,major,normalize,groupNativeBlocks,candidates,overlaps,validate,copy};
})(typeof window==='undefined'?globalThis:window);
