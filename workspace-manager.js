/* Grade/year workspace selector and management UI. */
(function(root){
'use strict';
const core=root.AppCore;
let overlay=null;
function style(){
 if(document.getElementById('workspace-ui-style'))return;
 const s=document.createElement('style');s.id='workspace-ui-style';s.textContent=
 '.workspace-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:-8px 0 18px;padding:12px 14px;background:#fff;border:1px solid #e3e8ef;border-radius:12px;box-shadow:0 2px 8px rgba(25,45,70,.04)}'+
 '.workspace-current{display:flex;align-items:center;gap:10px;min-width:0}.workspace-current-label{font-size:11px;color:#718096}.workspace-current-name{font-size:15px;font-weight:700;color:#1c3d5c}.workspace-current-meta{font-size:12px;color:#718096}.workspace-actions{display:flex;gap:8px;flex-wrap:wrap}.workspace-actions button,.workspace-dialog button{border:1px solid #d6dee8;border-radius:8px;background:#fff;color:#23415f;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}.workspace-actions button.primary,.workspace-dialog button.primary{background:#1c3d5c;border-color:#1c3d5c;color:#fff}.workspace-dialog-backdrop{position:fixed;inset:0;z-index:20000;background:rgba(15,28,42,.48);display:flex;align-items:center;justify-content:center;padding:20px}.workspace-dialog{width:min(680px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.22);color:#1a2b3c}.workspace-dialog h2{font-size:20px;margin:0 0 6px;color:#1c3d5c}.workspace-dialog p{font-size:13px;color:#65758a;line-height:1.65;margin:0 0 14px}.workspace-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:14px 0}.workspace-card{border:1px solid #e1e7ef;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}.workspace-card strong{font-size:14px}.workspace-card small{font-size:12px;color:#718096}.workspace-card-actions{display:flex;gap:6px;flex-wrap:wrap}.workspace-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;padding:14px;background:#f6f8fb;border-radius:10px}.workspace-form label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#4b5c70}.workspace-form input,.workspace-form select{width:100%;height:36px;border:1px solid #ccd6e2;border-radius:7px;padding:6px 9px;background:#fff;font:inherit;font-size:13px}.workspace-form .wide{grid-column:1/-1}.workspace-dialog-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.workspace-empty{padding:18px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;color:#718096;font-size:13px}.workspace-archive-note{padding:10px 12px;border-radius:8px;background:#fff8e8;color:#805b16;font-size:12px;line-height:1.6}.workspace-lock-note{padding:12px;border-radius:9px;background:#fff3f0;color:#9c3428;font-size:13px;line-height:1.7}@media(max-width:640px){.workspace-form{grid-template-columns:1fr}.workspace-form .wide{grid-column:auto}.workspace-toolbar{align-items:flex-start}}';
 document.head.appendChild(s);
}
function el(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n;}
function close(){if(overlay){overlay.remove();overlay=null;}}
function shell(title,description){
 style();close();
 overlay=el('div','workspace-dialog-backdrop');
 const panel=el('section','workspace-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
 panel.appendChild(el('h2','',title));if(description)panel.appendChild(el('p','',description));
 overlay.appendChild(panel);document.body.appendChild(overlay);return panel;
}
function defaultYear(){const now=new Date(),y=now.getFullYear(),start=now.getMonth()>=7?y:y-1;return start+'—'+(start+1);}
function makeForm(parent,onSubmit,defaults){
 defaults=defaults||{};
 const form=el('div','workspace-form');
 const yearLabel=el('label','','学年');const year=document.createElement('input');year.value=defaults.academicYear||defaultYear();year.placeholder='例如：2026—2027';yearLabel.appendChild(year);
 const gradeLabel=el('label','','年级');const grade=document.createElement('select');
 [['七年级','七年级'],['八年级','八年级'],['九年级','九年级'],['待整理','待整理'],['其他','其他']].forEach(([v,t])=>{const o=el('option','',t);o.value=v;grade.appendChild(o);});
 grade.value=defaults.grade||'八年级';gradeLabel.appendChild(grade);
 const nameLabel=el('label','wide','工作区名称（可选，默认按学年和年级生成）');const name=document.createElement('input');name.value=defaults.name||'';name.placeholder='例如：2026—2027学年 · 八年级';nameLabel.appendChild(name);
 form.append(yearLabel,gradeLabel,nameLabel);parent.appendChild(form);
 return ()=>({academicYear:year.value.trim(),grade:grade.value,name:name.value.trim()});
}
function urlFor(id){return core.workspaces.urlFor?core.workspaces.urlFor(id):(()=>{const u=new URL(root.location.href);u.searchParams.set('workspace',id);return u.href;})();}
async function activate(id,replace){
 await core.storage.setWorkspace(id);
 const acquired=await core.storage.acquireLease();
 if(!acquired)return null;
 const ws=await core.workspaces.get(id);
 if(replace)root.history.replaceState(null,'',urlFor(id));
 close();mountHeader(ws);return ws;
}
function renderWorkspaceCards(parent,items,mode,currentId){
 const list=el('div','workspace-list');
 if(!items.length)list.appendChild(el('div','workspace-empty','还没有工作区，请在下方创建第一个工作区。'));
 items.forEach(ws=>{
  const card=el('div','workspace-card');
  const name=el('strong','',ws.name||'未命名工作区');card.appendChild(name);
  card.appendChild(el('small','',[ws.academicYear,ws.grade].filter(Boolean).join(' · ')||'学年或年级尚未指定'));
  if(ws.legacyArchive)card.appendChild(el('div','workspace-archive-note','这是从旧版共享数据库复制的历史副本，尚未按年级拆分。原数据库仍保留，请勿把它当作已核实的年级数据。'));
  const actions=el('div','workspace-card-actions');
  const enter=el('button','',mode==='manage'?(ws.id===currentId?'当前工作区':'切换到此工作区'):'进入工作区');
  enter.disabled=ws.id===currentId;
   enter.onclick=()=>root.location.assign(urlFor(ws.id));
  actions.appendChild(enter);
  if(mode==='manage'){
   const rename=el('button','','重命名');rename.onclick=async()=>{const value=root.prompt('请输入新的工作区名称',ws.name||'');if(!value||!value.trim())return;try{await core.workspaces.update(ws.id,{name:value.trim()});openManager();}catch(e){root.alert(e.message);}};actions.appendChild(rename);
   const del=el('button','','删除');del.onclick=async()=>{if(ws.id===currentId){root.alert('不能删除当前工作区，请先切换到其他工作区。');return;}if(!root.confirm('确定删除工作区“'+ws.name+'”及其独立数据吗？此操作不可撤销。'))return;try{await core.workspaces.remove(ws.id);openManager();}catch(e){root.alert(e.message);}};actions.appendChild(del);
  }
  card.appendChild(actions);list.appendChild(card);
 });
 parent.appendChild(list);
}
function createWorkspaceForm(parent,onCreated,defaults){
 const form=makeForm(parent, null, defaults);
 const footer=el('div','workspace-dialog-footer');
 const create=el('button','primary','创建工作区');
 create.onclick=async()=>{const meta=form();if(!meta.academicYear||!meta.grade){root.alert('请填写学年并选择年级。');return;}try{const ws=await core.workspaces.create(meta);onCreated(ws);}catch(e){root.alert('创建失败：'+e.message);}};
 footer.appendChild(create);parent.appendChild(footer);
}
async function showDuplicate(resolveAgain,ws){
 const panel=shell('工作区已在其他页面打开','为避免两个标签页同时保存同一份成绩数据，系统已阻止本页面进入编辑状态。');
 const note=el('div','workspace-lock-note','当前工作区：'+(ws&&ws.name||'未命名工作区')+'。请关闭正在使用它的另一个页面，或返回工作区列表，选择其他年级。');panel.appendChild(note);
 const footer=el('div','workspace-dialog-footer');
 const retry=el('button','','关闭此提示并重试');retry.onclick=()=>root.location.reload();
 const choose=el('button','primary','选择其他工作区');choose.onclick=()=>{const u=new URL(root.location.href);u.searchParams.delete('workspace');root.history.replaceState(null,'',u.href);renderChooser(resolveAgain);};
 footer.append(retry,choose);panel.appendChild(footer);
}
function renderChooser(resolve){
 core.workspaces.list().then(items=>{
  const panel=shell('选择工作区','每个工作区对应一个学年和年级。不同工作区使用独立数据库，可以在同一台电脑的不同浏览器标签页同时工作。');
  const list=el('div','workspace-list');panel.appendChild(list);
  if(!items.length)list.appendChild(el('div','workspace-empty','尚未创建工作区。请在下方创建，例如“2026—2027学年 · 八年级”。'));
  items.forEach(ws=>{
   const card=el('div','workspace-card');card.appendChild(el('strong','',ws.name));card.appendChild(el('small','',[ws.academicYear,ws.grade].filter(Boolean).join(' · ')||'学年或年级待指定'));
   if(ws.legacyArchive)card.appendChild(el('div','workspace-archive-note','旧版历史数据副本。它可能已经混合多个年级，系统不会自动拆分。'));
   const button=el('button','primary','进入工作区');button.onclick=async()=>{try{const chosen=await activate(ws.id,true);if(chosen)resolve(chosen);else showDuplicate(resolve,ws);}catch(e){root.alert(e.message);}};card.appendChild(button);list.appendChild(card);
  });
  const section=el('div','');section.appendChild(el('strong','','新建工作区'));panel.appendChild(section);
  createWorkspaceForm(panel,async ws=>{try{const chosen=await activate(ws.id,true);if(chosen)resolve(chosen);else showDuplicate(resolve,ws);}catch(e){root.alert(e.message);}});
 }).catch(error=>{const panel=shell('无法读取工作区','工作区目录读取失败：'+error.message+'。请确认浏览器允许本站使用 IndexedDB。');});
}
async function resolve(){
 const id=core.storage.workspaceId();
 if(!id)await core.workspaces.ensureLegacyArchive();
 if(id){
  let ws=await core.workspaces.get(id);
  if(!ws)ws=await core.workspaces.ensure(id,{name:'未命名工作区',grade:'待指定'});
  await core.storage.setWorkspace(id);
  if(!await core.storage.acquireLease())return new Promise(resolvePromise=>showDuplicate(resolvePromise,ws));
  mountHeader(ws);return ws;
 }
 return new Promise(resolvePromise=>renderChooser(resolvePromise));
}
function openPicker(){
 core.workspaces.list().then(items=>{
  const panel=shell('切换工作区','切换时页面会重新加载，未保存的操作请先完成。');
  renderWorkspaceCards(panel,items,'switch',core.storage.workspaceId());
  const footer=el('div','workspace-dialog-footer');const closeBtn=el('button','','取消');closeBtn.onclick=close;footer.appendChild(closeBtn);panel.appendChild(footer);
 }).catch(e=>root.alert(e.message));
}
function openManager(){
 core.workspaces.list().then(items=>{
  const panel=shell('工作区管理','重命名不会改变数据归属。删除工作区会同时删除该工作区的成绩、原卷和座位快照；原版共享数据库不会被删除。');
  renderWorkspaceCards(panel,items,'manage',core.storage.workspaceId());
  createWorkspaceForm(panel,ws=>root.location.assign(urlFor(ws.id)));
  const footer=el('div','workspace-dialog-footer');const done=el('button','','完成');done.onclick=close;footer.appendChild(done);panel.appendChild(footer);
 }).catch(e=>root.alert(e.message));
}
function mountHeader(ws){
 if(!ws)return;
 style();
 let bar=document.getElementById('workspaceToolbar');
 if(!bar){bar=el('div','workspace-toolbar');bar.id='workspaceToolbar';const h1=document.querySelector('.container h1');if(h1)h1.insertAdjacentElement('afterend',bar);}
 bar.innerHTML='';
 const current=el('div','workspace-current');const info=el('div','');
 info.appendChild(el('div','workspace-current-label','当前工作区'));
 info.appendChild(el('div','workspace-current-name',ws.name||'未命名工作区'));
 info.appendChild(el('div','workspace-current-meta',[ws.academicYear,ws.grade].filter(Boolean).join(' · ')||'待指定学年与年级'));
 current.appendChild(info);bar.appendChild(current);
 const actions=el('div','workspace-actions');
 const sw=el('button','','切换工作区');sw.onclick=openPicker;
 const manage=el('button','','管理工作区');manage.onclick=openManager;
 const add=el('button','primary','＋ 新建工作区');add.onclick=()=>{const panel=shell('新建工作区','新工作区会使用独立数据库，不会复制或覆盖当前工作区。');createWorkspaceForm(panel,newWs=>root.location.assign(urlFor(newWs.id)));};
 actions.append(sw,manage,add);bar.appendChild(actions);
 if(ws.legacyArchive){const note=el('div','workspace-archive-note','当前是旧版历史数据副本。请先核对数据，再分别建立正式年级工作区并恢复对应备份。');note.style.flexBasis='100%';bar.appendChild(note);}
}
function requestWorkspaceMeta(defaults){
 return new Promise(resolve=>{
  const panel=shell('指定备份归属','这是旧版备份，文件中没有学年和年级信息。请指定归属；系统会把它恢复到一个新工作区，不会覆盖当前工作区。');
  const form=makeForm(panel,null,defaults||{grade:'待整理'});
  const footer=el('div','workspace-dialog-footer');
  const cancel=el('button','','取消');cancel.onclick=()=>{close();resolve(null);};
  const confirm=el('button','primary','继续');confirm.onclick=()=>{const meta=form();if(!meta.academicYear||!meta.grade){root.alert('请填写学年并选择年级。');return;}close();resolve(meta);};
  footer.append(cancel,confirm);panel.appendChild(footer);
 });
}
root.WorkspaceUI={resolve,mountHeader,openManager,openPicker,requestWorkspaceMeta};
})(window);
