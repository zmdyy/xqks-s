/* Blank-paper question regions shared by all students in an exam. */
(function () {
  function key(subject, major) { return JSON.stringify([subject, String(major)]); }
  function findBatch(id) { return DataPool.batches.find(function(b){return String(b.id)===String(id);}); }
  function mappingValid(rec, major) {
    if (!rec || !Array.isArray(rec.scoreColumns) || !rec.scoreColumns.length) return false;
    return rec.scoreColumns.every(function(name){
      if (typeof getCanonicalQuestionRefInfo !== 'function') return true;
      var info=getCanonicalQuestionRefInfo(name);
      return String(info.major)===String(major) || info.kind==='major-list' && info.majors.map(String).includes(String(major));
    });
  }
  function getRecord(item) {
    var batch=findBatch(item.batchId), major=notebookMajorFromItem(item.lookupItemName || item.itemName);
    var rec=batch && batch.notebookCropReviews && batch.notebookCropReviews[key(item.subjectName,major)];
    return mappingValid(rec,major) ? rec : null;
  }
  window.notebookReviewStatus = function(item){
    var batch=findBatch(item.batchId),rec=getRecord(item);
    if(!rec || !rec.confirmed || !rec.regions || !rec.regions.length) return false;
    return !!(batch.uploadedPdfs||[]).find(function(p){return p.id===rec.fileId && p.fileName===rec.fileName && notebookPdfBytes(p);});
  };
  window.notebookReviewedSnapshots = async function(item) {
    var batch=findBatch(item.batchId), rec=getRecord(item);
    if(!batch || !rec || !rec.confirmed || !rec.regions || !rec.regions.length) return null;
    var pdf=(batch.uploadedPdfs||[]).find(function(p){return p.id===rec.fileId && p.fileName===rec.fileName;});
    if(!pdf) return null;
    var bytes=notebookPdfBytes(pdf); if(!bytes) return null;
    var doc=await pdfjsLib.getDocument({data:bytes.slice(),disableWorker:true}).promise, output=[];
    try {
    for(var i=0;i<rec.regions.length;i++){
      var r=rec.regions[i], page=await doc.getPage(r.page), vp=page.getViewport({scale:2});
      var full=document.createElement('canvas');full.width=Math.ceil(vp.width);full.height=Math.ceil(vp.height);
      await page.render({canvasContext:full.getContext('2d'),viewport:vp}).promise;
      var x=Math.floor(r.x*full.width),y=Math.floor(r.y*full.height),w=Math.max(1,Math.min(full.width-x,Math.ceil(r.w*full.width))),h=Math.max(1,Math.min(full.height-y,Math.ceil(r.h*full.height)));
      var out=document.createElement('canvas');out.width=w;out.height=h;var ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(full,x,y,w,h,0,0,w,h);output.push(out.toDataURL('image/png'));
    }
    return output;
    } finally { if (doc.destroy) await doc.destroy(); }
  };
  // Use all visible question anchors to set boundaries, even when a question has no score column.
  function buildTextCandidates(pages, questions) {
    var anchors=[], hits={}, result={};
    pages.forEach(function(page){ (page.lines || []).forEach(function(line){
      var number=notebookLineMajor(line.text);
      if (!number || !(page.height > 0)) return;
      var hit={major:String(Number(number)), page:page.page, top:Math.max(0,Math.min(1,(page.height-line.y-line.h-8)/page.height))};
      anchors.push(hit); (hits[hit.major] || (hits[hit.major]=[])).push(hit);
    }); });
    questions.forEach(function(q){
      var found=hits[String(q.major)]; if(!found || found.length!==1) return;
      var start=found[0], following=anchors.filter(function(a){return a.page===start.page && a.top>start.top+.01;}).map(function(a){return a.top;});
      var bottom=following.length ? Math.min.apply(null,following) : 0.98;
      if(bottom-start.top<.02)return;
      result[q.major]={regions:[{page:start.page,x:.02,y:start.top,w:.96,h:bottom-start.top}],confirmed:false};
    });
    return result;
  }
  window.buildPaperTextCandidates=buildTextCandidates;
  function listQuestions(batch, subject){
    var groups={};
    (batch.combinedStudentData||[]).forEach(function(stu){var subj=stu.subjects && stu.subjects[subject];Object.keys(subj && subj.subScores || {}).forEach(function(name){var info=typeof getCanonicalQuestionRefInfo==='function'?getCanonicalQuestionRefInfo(name):null;if(info && info.kind==='unknown') return;var majors=info&&info.kind==='major-list'?info.majors.map(String):[notebookMajorFromItem(name)];majors.filter(Boolean).forEach(function(major){if(!groups[major])groups[major]=[];if(groups[major].indexOf(name)<0)groups[major].push(name);});});});
    return Object.keys(groups).sort(function(a,b){return Number(a)-Number(b);}).map(function(major){return {major:major,columns:groups[major]};});
  }
  window.openPaperCropWorkspace = async function(){
    const E=window.PaperCropEngine, batch=DataPool.getCurrentBatch();
    if(!batch){await showAlert('请先保存考试批次。');return;}
    const pdfs=(batch.uploadedPdfs||[]).filter(p=>/\.pdf$/i.test(p.fileName||'')&&notebookPdfBytes(p));
    const subjects=[...new Set((batch.combinedStudentData||[]).flatMap(s=>Object.keys(s.subjects||{}).filter(n=>Object.keys(s.subjects[n].subScores||{}).length)))].sort();
    if(!pdfs.length||!subjects.length){await showAlert('请先保存空白 PDF 和小题分数据。');return;}
    const root=document.createElement('div'); root.id='paperCropWorkspace';root.style.cssText='position:fixed;inset:0;z-index:12000;background:#f1f5f9;color:#0f172a;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;font-size:14px';
    root.innerHTML=`<style>#paperCropWorkspace button,#paperCropWorkspace select{padding:7px;border:1px solid #cbd5e1;border-radius:5px;background:white;color:#0f172a;cursor:pointer}#paperCropWorkspace button:disabled{opacity:.45;cursor:default}#paperCropWorkspace [data-questions] button{display:block;text-align:left;width:100%;margin:5px 0}#paperCropWorkspace [data-preview] canvas{display:block;max-width:100%;height:auto;margin:8px 0;border:1px solid #cbd5e1}#paperCropWorkspace [data-regions]>div{padding:6px 0;border-bottom:1px solid #ddd}</style>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><strong>空白原卷 · 整卷切题复核</strong><label>科目 <select data-subject></select></label><label>原卷 <select data-pdf></select></label><button data-a="load">打开试卷</button><button data-a="auto">重新生成候选建议</button><button data-a="import">导入 MinerU JSON</button><input type="file" accept=".json" data-json hidden><button data-a="backup">备份复核</button><button data-a="restore">恢复复核</button><input type="file" accept=".json" data-backup hidden><button data-a="close">关闭</button></div>
      <div data-message role="status" style="padding:8px 0;min-height:20px">根据小题分建立公共题目清单，复核一次，所有学生共用。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button data-a="prev">上一页定位</button><span data-page></span><button data-a="next">下一页定位</button><select data-mode aria-label="编辑模式"><option value="adjust">调整已有框</option><option value="new">新增区域</option></select><button data-a="undo">撤销</button><button data-a="redo">重做</button><button data-a="draft">仅保存修改</button><button data-a="confirm">确认并下一题</button><button data-a="finish">整卷检查并完成</button><span data-progress></span></div>
      <div style="display:flex;flex:1;min-height:0;gap:12px;margin-top:10px"><div data-scroll style="flex:1;overflow:auto;overflow-anchor:none;background:#cbd5e1;text-align:center"><div data-pages style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:12px"></div></div><aside style="width:350px;max-width:38%;overflow:auto;background:white;padding:10px"><select data-filter aria-label="题目状态"><option value="all">全部题目</option><option value="pending">未完成</option><option value="missing">未定位</option><option value="confirmed">已确认</option></select><div data-overlaps style="font-size:12px;margin:6px 0"></div><div data-questions></div><hr><strong data-title></strong><p data-columns></p><p data-source></p><label>重新绑定到 <select data-target></select></label><button data-a="rebind">移动区域</button><div data-regions></div><p>即时预览（按下面顺序导出）</p><div data-preview></div></aside></div>`;
    document.body.appendChild(root);
    const $=s=>root.querySelector(s), msg=t=>$('[data-message]').textContent=t;
    const option=(label,value)=>{const o=document.createElement('option');o.textContent=label;o.value=value;return o;};
    subjects.forEach(n=>{const o=option(n,n);$('[data-subject]').add(o);});pdfs.forEach(p=>$('[data-pdf]').add(option(p.fileName,p.id)));$('[data-subject]').value=subjects.find(n=>pdfs.some(p=>p.detectedSubject===n))||subjects[0];$('[data-pdf]').value=(pdfs.find(p=>p.detectedSubject===$('[data-subject]').value)||pdfs[0]).id;
    const prior=Object.entries(batch.paperReviewStates||{}).sort((a,b)=>String(b[1].updatedAt||'').localeCompare(String(a[1].updatedAt||''))).map(([k])=>{try{return JSON.parse(k);}catch(e){return [];}}).find(([s,id])=>subjects.includes(s)&&pdfs.some(p=>p.id===id));
    if(prior){$('[data-subject]').value=prior[0];$('[data-pdf]').value=prior[1];}
    let doc=null,pdf=null,subject='',questions=[],records={},selected='',pageNo=1,active=-1,drag=null,undo=[],redo=[],baseline='',busy=false,closed=false,renderTask=null,renderVersion=0,previewVersion=0;
    let canvas=null,draw=null,pageObserver=null;const pageCache=new Map(),pagePending=new Map(),pageSlots=new Map();
    const state=()=>JSON.stringify(records), dirty=()=>state()!==baseline;
    const current=()=>records[selected]||(records[selected]={regions:[],confirmed:false,source:'人工'});
    function checkpoint(){undo.push(state());if(undo.length>60)undo.shift();redo=[];}
    function changed(){current().confirmed=false;current().source='人工调整';paint();}
    function status(r){return !r?.regions?.length?'未定位':r.confirmed?'已确认':'待复核';}
    function refreshList(){
      const filter=$('[data-filter]').value,box=$('[data-questions]');box.innerHTML='';let confirmed=0;
      questions.forEach(q=>{const r=records[q.major],st=status(r);if(st==='已确认')confirmed++;if(filter==='pending'&&st==='已确认'||filter==='missing'&&st!=='未定位'||filter==='confirmed'&&st!=='已确认')return;const b=document.createElement('button');b.dataset.question=q.major;b.textContent='第'+q.major+'题 · '+st;b.style.background=selected===q.major?'#dbeafe':'';b.onclick=()=>select(q.major);box.appendChild(b);});
      $('[data-progress]').textContent=confirmed+' / '+questions.length+' 已确认'+(dirty()?' · 有未保存修改':'');
      $('[data-a="undo"]').disabled=!undo.length;$('[data-a="redo"]').disabled=!redo.length;
    }
    function stroke(r,color,fill){const slot=pageSlots.get(r.page);if(!slot?.rendered)return;const c=slot.draw.getContext('2d'),d=slot.draw;c.strokeStyle=color;c.fillStyle=fill;c.lineWidth=2;c.fillRect(r.x*d.width,r.y*d.height,r.w*d.width,r.h*d.height);c.strokeRect(r.x*d.width,r.y*d.height,r.w*d.width,r.h*d.height);}
    function drawLabel(r,major,other){const slot=pageSlots.get(r.page);if(!slot?.rendered)return;const ctx=slot.draw.getContext('2d'),text='第'+major+'题',x=r.x*slot.draw.width,y=Math.max(18,r.y*slot.draw.height);ctx.font='bold 15px sans-serif';ctx.fillStyle=other?'#64748b':'#1d4ed8';ctx.fillRect(x,y-18,Math.max(60,ctx.measureText(text).width+10),18);ctx.fillStyle='#fff';ctx.fillText(text,x+4,y-4);}
    function repaintCanvas(temp){
      pageSlots.forEach(slot=>{if(slot.rendered)slot.draw.getContext('2d').clearRect(0,0,slot.draw.width,slot.draw.height);});
      Object.keys(records).filter(k=>k!==selected).forEach(k=>records[k].regions.forEach(r=>{stroke(r,'#94a3b8','rgba(148,163,184,.08)');drawLabel(r,k,true);}));
      const r=selected?current():{regions:[]};r.regions.forEach((b,i)=>{stroke(b,i===active?'#dc2626':'#2563eb','rgba(37,99,235,.12)');drawLabel(b,selected,false);const slot=pageSlots.get(b.page);if(slot?.rendered&&i===active){const ctx=slot.draw.getContext('2d');ctx.fillStyle='#dc2626';ctx.fillRect((b.x+b.w)*slot.draw.width-6,(b.y+b.h)*slot.draw.height-6,12,12);}});if(temp)stroke(temp,'#dc2626','rgba(220,38,38,.1)');
    }
    function paint(temp){
      repaintCanvas(temp);
      const r=selected?current():{regions:[]};
      refreshList();$('[data-title]').textContent=selected?'第'+selected+'题':'';$('[data-columns]').textContent='对应小题分列：'+(questions.find(q=>q.major===selected)?.columns||[]).join('、');$('[data-source]').textContent=(r.source?'来源：'+r.source+'；':'')+(r.warnings||[]).join('；');
      const list=$('[data-regions]');list.innerHTML='';r.regions.forEach((b,i)=>{const row=document.createElement('div');row.textContent='片段 '+(i+1)+' · 第'+b.page+'页 ';[['定位',()=>{active=i;pageNo=b.page;return render(true,b);}],['↑',()=>{if(i){checkpoint();[r.regions[i-1],r.regions[i]]=[r.regions[i],r.regions[i-1]];changed();}}],['↓',()=>{if(i+1<r.regions.length){checkpoint();[r.regions[i+1],r.regions[i]]=[r.regions[i],r.regions[i+1]];changed();}}],['删除',()=>{checkpoint();r.regions.splice(i,1);active=-1;changed();}]].forEach(([label,fn])=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;row.appendChild(b);});list.appendChild(row);});
      refreshOverlaps();preview();
    }
    function refreshOverlaps(){
      const list=$('[data-overlaps]');list.innerHTML='';const found=E.overlaps(records);if(!found.length)return;
      const heading=document.createElement('p');heading.textContent='重叠提醒：可调整为多个独立区域；共享材料可人工确认。';list.appendChild(heading);
      found.forEach(issue=>{const row=document.createElement('div');row.style.cssText='background:#fff7ed;padding:6px;margin:4px 0';const text=document.createElement('span');text.textContent='第'+issue.a+'、'+issue.b+'题 · 第'+issue.pages.join('、')+'页'+(issue.approved?' · 已允许：'+issue.reason:' · 待检查');row.appendChild(text);
        [issue.a,issue.b].forEach(major=>{const b=document.createElement('button');b.textContent='查看第'+major+'题';b.onclick=()=>select(major);row.appendChild(b);});
        if(!issue.approved){const b=document.createElement('button');b.textContent='允许此处重叠';b.onclick=()=>{const reason=window.prompt('请先核对原卷。可将题干和各自图片框成独立片段。若确需保留重叠，请填写原因：','共享材料，已人工核对');if(!reason?.trim())return;checkpoint();const note={signature:issue.signature,reason:reason.trim()};[issue.a,issue.b].forEach(k=>{records[k].overlapApprovals=(records[k].overlapApprovals||[]).filter(p=>p.signature!==issue.signature);records[k].overlapApprovals.push(note);});paint();};row.appendChild(b);}list.appendChild(row);
      });
    }
    async function pageCanvas(n){
      if(pageCache.has(n))return pageCache.get(n);if(pagePending.has(n))return pagePending.get(n);
      const sourceDoc=doc,promise=(async()=>{const p=await sourceDoc.getPage(n),v=p.getViewport({scale:1.3}),c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;if(sourceDoc===doc){pageCache.set(n,c);while(pageCache.size>6)pageCache.delete(pageCache.keys().next().value);}return c;})();pagePending.set(n,promise);try{return await promise;}finally{if(pagePending.get(n)===promise)pagePending.delete(n);}
    }
    async function ensurePage(n){const slot=pageSlots.get(n);if(!slot)return;if(slot.rendered)return;if(slot.pending)return slot.pending;const sourceDoc=doc;slot.pending=(async()=>{const full=await pageCanvas(n);if(closed||sourceDoc!==doc||pageSlots.get(n)!==slot)return;slot.canvas.width=slot.draw.width=full.width;slot.canvas.height=slot.draw.height=full.height;slot.canvas.getContext('2d').drawImage(full,0,0);slot.rendered=true;repaintCanvas();})();try{await slot.pending;}finally{slot.pending=null;}}
    async function mountPages(){
      if(pageObserver)pageObserver.disconnect();pageSlots.clear();$('[data-pages]').innerHTML='';const sourceDoc=doc;
      for(let n=1;n<=doc.numPages;n++){const p=await sourceDoc.getPage(n),v=p.getViewport({scale:1.3});if(sourceDoc!==doc||closed)return;const wrap=document.createElement('section');wrap.dataset.paperPage=n;wrap.style.cssText='width:100%;max-width:'+Math.ceil(v.width)+'px;flex:none;';const title=document.createElement('div');title.textContent='第 '+n+' 页';title.style.cssText='padding:5px;background:#e2e8f0;color:#475569';const surface=document.createElement('div');surface.style.cssText='position:relative;background:white;line-height:0;aspect-ratio:'+v.width+'/'+v.height+';';const base=document.createElement('canvas'),layer=document.createElement('canvas');base.dataset.canvas=n;layer.dataset.draw=n;base.style.cssText='display:block;width:100%;height:100%;position:absolute;inset:0';layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair';surface.append(base,layer);wrap.append(title,surface);$('[data-pages]').appendChild(wrap);const slot={page:n,wrap,surface,canvas:base,draw:layer,rendered:false};pageSlots.set(n,slot);
        layer.onpointerdown=e=>{if(!slot.rendered)return;pageNo=n;canvas=base;draw=layer;$('[data-page]').textContent=pageNo+' / '+doc.numPages;pointerDown(e);};layer.onpointermove=e=>{if(draw===layer)pointerMove(e);};layer.onpointerup=e=>{if(draw===layer)endDrag(e);};layer.onpointercancel=()=>{if(draw===layer)cancelDrag();};
      }
      if(typeof IntersectionObserver!=='undefined'){pageObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting)ensurePage(Number(entry.target.dataset.paperPage)).catch(e=>msg('页面加载失败：'+e.message));});},{root:$('[data-scroll]'),rootMargin:'700px'});pageSlots.forEach(s=>pageObserver.observe(s.wrap));}
      else {for(const n of pageSlots.keys())await ensurePage(n);}
    }
    async function preview(){const version=++previewVersion,list=$('[data-preview]'),regions=E.copy(selected?current().regions:[]);list.innerHTML='';try{for(const r of regions){const full=await pageCanvas(r.page);if(version!==previewVersion||closed)return;const out=document.createElement('canvas');out.width=Math.max(1,Math.round(r.w*full.width));out.height=Math.max(1,Math.round(r.h*full.height));out.getContext('2d').drawImage(full,r.x*full.width,r.y*full.height,r.w*full.width,r.h*full.height,0,0,out.width,out.height);list.appendChild(out);}}catch(e){if(version===previewVersion)list.textContent='预览失败：'+e.message;}}
    async function render(scroll=false,region=null){if(!doc)return;const version=++renderVersion,n=pageNo;try{await ensurePage(n);if(version!==renderVersion||closed)return;const slot=pageSlots.get(n);canvas=slot.canvas;draw=slot.draw;$('[data-page]').textContent=n+' / '+doc.numPages;root.dataset.currentPage=n;paint();if(scroll){const scroller=$('[data-scroll]'),a=slot.surface.getBoundingClientRect(),b=scroller.getBoundingClientRect();scroller.scrollTo({top:Math.max(0,scroller.scrollTop+a.top-b.top+(region?region.y*a.height:0)-16),behavior:'auto'});}}catch(e){msg('页面显示失败：'+e.message);}}
    function select(major){selected=major;active=-1;const first=current().regions[0];if(first)pageNo=first.page;return render(true,first);}
    function pos(e){const b=draw.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};}
    function box(a,b){return{page:pageNo,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
    const pointerDown=e=>{if(!doc||busy||!selected)return;const p=pos(e);active=-1;if($('[data-mode]').value==='adjust'){const rs=current().regions;for(let i=rs.length-1;i>=0;i--){const r=rs[i];if(r.page===pageNo&&p.x>=r.x-.01&&p.x<=r.x+r.w+.01&&p.y>=r.y-.01&&p.y<=r.y+r.h+.01){active=i;break;}}if(active<0){msg('请点击已有框，或切换到「新增区域」。');return;}}
      checkpoint();drag={start:p,action:active<0?'new':'move',original:active<0?null:E.copy(current().regions[active])};if(active>=0&&Math.abs(p.x-drag.original.x-drag.original.w)<.025&&Math.abs(p.y-drag.original.y-drag.original.h)<.025)drag.action='resize';draw.setPointerCapture(e.pointerId);
    };
    const pointerMove=e=>{if(!drag)return;const p=pos(e),o=drag.original;if(drag.action==='new'){repaintCanvas(box(drag.start,p));return;}const r=current().regions[active];if(drag.action==='move'){r.x=Math.max(0,Math.min(1-o.w,o.x+p.x-drag.start.x));r.y=Math.max(0,Math.min(1-o.h,o.y+p.y-drag.start.y));}else{r.w=Math.max(.01,Math.min(1-o.x,o.w+p.x-drag.start.x));r.h=Math.max(.01,Math.min(1-o.y,o.h+p.y-drag.start.y));}current().confirmed=false;repaintCanvas();};
    function endDrag(e){if(!drag)return;if(drag.action==='new'){const r=box(drag.start,pos(e));if(r.w>.005&&r.h>.005)current().regions.push(r);}drag=null;changed();}const cancelDrag=()=>{if(drag){records=JSON.parse(undo.pop());drag=null;paint();}};
    function analysisIssues(){return E.validate(records,questions,doc.numPages);}
    async function save(confirm,finish){if(!doc||busy)return false;if(confirm&&!current().regions.length){msg('请先定位当前题。');return false;}busy=true;const previous=E.copy(batch.notebookCropReviews||{}),oldStates=E.copy(batch.paperReviewStates||{}),oldRecords=state();if(confirm)current().confirmed=true;
      const issues=analysisIssues();if(issues.some(x=>/区域无效/.test(x))){records=JSON.parse(oldRecords);busy=false;msg('存在无效区域，请先修正再保存。');return false;}if(finish&&issues.length){busy=false;msg('尚未完成：'+issues.join('；'));return false;}if(finish){const pending=E.overlaps(records).filter(x=>!x.approved);if(pending.length){busy=false;paint();msg('存在 '+pending.length+' 处重叠提醒。请在右侧调整区域，或核对后点击「允许此处重叠」并记录原因。');return false;}}
      batch.notebookCropReviews=batch.notebookCropReviews||{};Object.keys(records).forEach(major=>{batch.notebookCropReviews[key(subject,major)]={...E.copy(records[major]),fileId:pdf.id,fileName:pdf.fileName,scoreColumns:questions.find(q=>q.major===major)?.columns||[],updatedAt:new Date().toISOString()};});
      batch.paperReviewStates=batch.paperReviewStates||{};batch.paperReviewStates[key(subject,pdf.id)]={completed:!!finish,updatedAt:new Date().toISOString()};
      let ok=false;try{ok=await persistBatches();}catch(e){msg('保存失败：'+e.message);}if(ok && DataPool.currentBatchId===batch.id && typeof uploadedPdfs!=='undefined'){var loaded=uploadedPdfs.find(p=>p.id===pdf.id);if(loaded && pdf.mineruLayout)loaded.mineruLayout=E.copy(pdf.mineruLayout);}
      if(!ok){batch.notebookCropReviews=previous;batch.paperReviewStates=oldStates;records=JSON.parse(oldRecords);msg('保存失败，修改仍保留在当前窗口，请重试。');}else{baseline=state();msg(finish?'整卷复核完成，学生错题本将自动应用。':confirm?'已确认并保存。':'修改已保存；未确认的题目不会作为已复核结果使用。');}busy=false;paint();return ok;}
    async function generate(){if(!doc||busy)return;busy=true;try{let normalized=E.normalize(pdf.mineruLayout),analysis;if(normalized.blocks.length){analysis=E.candidates(normalized.blocks,questions,'MinerU 版面');}else{const bs=[];for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),v=p.getViewport({scale:1}),tc=await p.getTextContent();(tc.items||[]).forEach(it=>{if(!String(it.str||'').trim())return;const [x,y]=v.convertToViewportPoint(it.transform[4],it.transform[5]);const h=Math.abs(it.height||it.transform[3]||10);bs.push({page:n,x:Math.max(0,x/v.width),y:Math.max(0,(y-h)/v.height),w:Math.max(.001,Math.min(1-x/v.width,(it.width||10)/v.width)),h:h/v.height,text:it.str,type:'text'});});}analysis=E.candidates(E.groupNativeBlocks(bs),questions,'PDF 文字层');}
        const count=Object.keys(analysis.records).length;let added=0;checkpoint();Object.entries(analysis.records).forEach(([major,r])=>{if(!records[major]?.regions?.length){records[major]=r;added++;}});msg('自动识别 '+count+' 题，补入 '+added+' 题；已有区域均保留。'+(normalized.blocks.length?'已使用 MinerU 坐标。':normalized.warnings.join('；')+' 已尝试文字层。')+(analysis.warnings||[]).join('；'));paint();
      }catch(e){msg('生成候选失败：'+e.message);}finally{busy=false;}}
    async function load(){if(busy)return;if(doc&&dirty()&&!window.confirm('存在未保存修改，是否放弃并切换试卷？'))return;busy=true;try{const next=pdfs.find(p=>p.id===$('[data-pdf]').value),sub=$('[data-subject]').value,qs=listQuestions(batch,sub);if(!qs.length)throw Error('没有可对应的题号');const nextDoc=await pdfjsLib.getDocument({data:notebookPdfBytes(next).slice(),disableWorker:true}).promise;doc=nextDoc;pdf=next;subject=sub;questions=qs;records={};questions.forEach(q=>{const r=batch.notebookCropReviews?.[key(subject,q.major)];if(r&&r.fileId===pdf.id&&r.fileName===pdf.fileName){if(mappingValid(r,q.major)){records[q.major]=E.copy(r);}else{records[q.major]={regions:[],confirmed:false,source:'旧映射已失效',warnings:['旧结果的分数列与当前题号不一致，已停止复用旧框，请重新定位']};}}});undo=[];redo=[];baseline=state();selected=questions[0].major;active=-1;pageNo=1;pageCache.clear();pagePending.clear();await mountPages();$('[data-target]').innerHTML='';questions.forEach(q=>$('[data-target]').add(option('第'+q.major+'题',q.major)));await render();msg('已打开 '+batch.label+' · '+subject+'，共有 '+questions.length+' 道大题。');}catch(e){msg('打开失败：'+e.message);}finally{busy=false;}if(doc)await generate();}
    const actions={backup:()=>{if(!doc)return;const data={format:'PaperCropReviewV1',examLabel:batch.label,subject,sourcePdf:{id:pdf.id,fileName:pdf.fileName,fileDataB64:pdfBytesToBase64(notebookPdfBytes(pdf))},questions,records:E.copy(records)};const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.href=url;a.download='试卷复核-'+subject+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},restore:()=>$('[data-backup]').click(),load,auto:generate,prev:()=>{if(doc&&pageNo>1){pageNo--;return render(true);}},next:()=>{if(doc&&pageNo<doc.numPages){pageNo++;return render(true);}},undo:()=>{if(!undo.length)return;redo.push(state());records=JSON.parse(undo.pop());active=-1;paint();},redo:()=>{if(!redo.length)return;undo.push(state());records=JSON.parse(redo.pop());active=-1;paint();},draft:()=>save(false,false),confirm:async()=>{if(await save(true,false)){const next=questions.find(q=>q.major!==selected&&!records[q.major]?.confirmed);if(next)await select(next.major);}},finish:()=>save(false,true),rebind:()=>{if(!doc)return;const target=$('[data-target]').value;if(target===selected)return;if(records[target]?.regions?.length&&!window.confirm('目标题已有区域，是否合并当前题区域到目标题？'))return;checkpoint();records[target]=records[target]||{regions:[],confirmed:false,source:'人工绑定'};records[target].regions.push(...E.copy(current().regions));records[target].confirmed=false;current().regions=[];current().confirmed=false;select(target);},import:()=>$('[data-json]').click(),close:()=>{if(busy)return;if(dirty()&&!window.confirm('有未保存修改，是否放弃并关闭？'))return;closed=true;if(pageObserver)pageObserver.disconnect();window.removeEventListener('beforeunload',unload);root.remove();}};
    Object.entries(actions).forEach(([name,fn])=>$('[data-a="'+name+'"]').onclick=fn);
    $('[data-json]').onchange=async e=>{if(!pdf)return;try{const data=JSON.parse(await e.target.files[0].text()),normalized=E.normalize(data);if(!normalized.blocks.length)throw Error(normalized.warnings.join('；'));pdf.mineruLayout=data;await generate();}catch(err){msg('导入失败：'+err.message);}e.target.value='';};
    $('[data-backup]').onchange=async e=>{try{if(!doc)throw Error('请先打开相同科目和原卷');const b=JSON.parse(await e.target.files[0].text());if(b.format!=='PaperCropReviewV1'||b.subject!==subject||!b.sourcePdf||b.sourcePdf.fileDataB64!==pdfBytesToBase64(notebookPdfBytes(pdf)))throw Error('备份的科目或原卷内容与当前选择不同');const oldColumns=JSON.stringify(b.questions),newColumns=JSON.stringify(questions);if(oldColumns!==newColumns)throw Error('小题分列已变化，请先核对题号，不能直接恢复');if(!window.confirm('将恢复备份中的区域，替换当前编辑内容，是否继续？'))return;const issues=E.validate(b.records,questions,doc.numPages).filter(x=>/区域无效/.test(x));if(issues.length)throw Error(issues.join('；'));checkpoint();records=E.copy(b.records);Object.values(records).forEach(r=>{r.fileId=pdf.id;r.fileName=pdf.fileName;});paint();msg('已恢复备份，请检查后保存。');}catch(err){msg('恢复失败：'+err.message);}e.target.value='';};
    $('[data-filter]').onchange=refreshList;
    let scrollFrame=false;$('[data-scroll]').onscroll=()=>{if(scrollFrame||drag)return;scrollFrame=true;requestAnimationFrame(()=>{scrollFrame=false;if(!doc||drag)return;const top=$('[data-scroll]').getBoundingClientRect().top;let best=null,distance=Infinity;pageSlots.forEach(slot=>{const r=slot.surface.getBoundingClientRect();if(r.bottom>top){const d=Math.abs(r.top-top);if(d<distance){distance=d;best=slot;}}});if(best){pageNo=best.page;canvas=best.canvas;draw=best.draw;root.dataset.currentPage=pageNo;$('[data-page]').textContent=pageNo+' / '+doc.numPages;}});};
    function unload(e){if(dirty()){e.preventDefault();e.returnValue='';}}window.addEventListener('beforeunload',unload);
    $('[data-subject]').onchange=async()=>{var matching=pdfs.find(p=>p.detectedSubject===$('[data-subject]').value);if(matching)$('[data-pdf]').value=matching.id;await load();};
    $('[data-pdf]').onchange=load;
    await load();
  };
  window.printPersonalErrorNotebook = async function(){
    const payload=window.lastErrorNotebookExport;
    if(!payload?.subjects?.length){await showAlert('请先打开个人错题本。');return;}
    const items=payload.subjects.flatMap(s=>s.items.map(it=>({...it,subjectName:it.subjectName||s.name})));
    const missing=items.filter(it=>!window.notebookReviewStatus(it));
    if(missing.length&&!window.confirm('有 '+missing.length+' 道题未完成原卷复核，将在打印页中标明且不使用猜测截图。仍要继续吗？'))return;
    const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:800px;height:1000px';document.body.appendChild(frame);
    try{const d=frame.contentDocument;d.open();d.write('<!doctype html><html><head><meta charset="utf-8"><title>个人错题本</title><style>@page{size:A4;margin:16mm}body{font:14px sans-serif;color:#111}section{margin:20px 0}h2{font-size:16px}img{display:block;max-width:100%;max-height:240mm;object-fit:contain;margin:8px 0;break-inside:avoid}p{margin:5px 0}</style></head><body></body></html>');d.close();const title=d.createElement('h1');title.textContent=payload.studentName+' 个人错题本';d.body.appendChild(title);
      for(const it of items){const section=d.createElement('section'),h=d.createElement('h2');h.textContent=it.subjectName+' · '+(it.batchLabel||'')+' · '+it.itemName;section.appendChild(h);const p=d.createElement('p');p.textContent='需订正：'+(it.detailItemNames||[it.itemName]).join('、')+'；失分项得分：'+it.score+'/'+it.maxScore;section.appendChild(p);const shots=await window.notebookReviewedSnapshots(it);if(shots?.length){for(const src of shots){const img=d.createElement('img');img.src=src;section.appendChild(img);}}else{const note=d.createElement('p');note.textContent='原卷未复核，请返回上传管理完成试卷切题复核。';section.appendChild(note);}d.body.appendChild(section);}
      await Promise.all(Array.from(d.images).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;})));frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.focus();frame.contentWindow.print();
    }catch(e){frame.remove();await showAlert('打印准备失败：'+e.message);}
  };

})();
