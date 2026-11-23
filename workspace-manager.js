/* Workspace entry and management for the score dashboard. */
(function(root){
'use strict';
const core=root.AppCore;
const recentKey='xqks:last-workspace';
let dialog=null;

function el(tag,cls,text){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text)node.textContent=text;
 return node;
}
function button(label,click,className=''){
 const node=el('button',className,label);
 node.type='button';
 if(click)node.onclick=click;
 return node;
}
function closeDialog(){
 if(dialog)dialog.close();
}
function openDialog(title){
 if(!dialog){
  const node=el('dialog','workspace-dialog');
  node.setAttribute('aria-labelledby','workspaceDialogTitle');
  node.addEventListener('close',()=>{
   node.remove();
   if(dialog===node)dialog=null;
  });
  document.body.append(node);
  dialog=node;
 }
 const heading=el('h2','',title);
 heading.id='workspaceDialogTitle';
 heading.tabIndex=-1;
 dialog.replaceChildren(heading);
 if(!dialog.open)dialog.showModal();
 heading.focus();
 return dialog;
}
function footer(panel,...buttons){
 const actions=el('div','workspace-dialog-footer');
 actions.append(...buttons);
 panel.append(actions);
}
function defaultYear(){
 const now=new Date(),year=now.getFullYear(),start=now.getMonth()>=7?year:year-1;
 return start+'—'+(start+1);
}
function makeForm(panel,defaults={}){
 const form=el('div','workspace-form');
 const yearLabel=el('label','','学年'),year=el('input');
 year.value=defaults.academicYear||defaultYear();
 yearLabel.append(year);
 const gradeLabel=el('label','','年级'),grade=el('select');
 const grades=['','七年级','八年级','九年级','待整理','其他'];
 for(const label of grades)grade.add(new Option(label||'选择年级',label));
 grade.value=defaults.grade||'';
 gradeLabel.append(grade);
 const nameLabel=el('label','workspace-form-wide','名称（选填）'),name=el('input');
 name.value=defaults.name||'';
 nameLabel.append(name);
 form.append(yearLabel,gradeLabel,nameLabel);
 panel.append(form);
 return ()=>({academicYear:year.value.trim(),grade:grade.value,name:name.value.trim()});
}
function readForm(getMeta){
 const meta=getMeta();
 if(!meta.academicYear||!meta.grade){
  root.alert('请填写学年并选择年级。');
  return null;
 }
 return meta;
}
function openCreate(returnTo){
 const panel=openDialog('新建年级工作区');
 const getMeta=makeForm(panel);
 const create=button('创建并进入',async()=>{
  const meta=readForm(getMeta);
  if(!meta)return;
  create.disabled=true;
  try{
   const workspace=await core.workspaces.create(meta);
   root.location.assign(core.workspaces.urlFor(workspace.id));
  }catch(error){
   create.disabled=false;
   root.alert(error.message);
  }
 },'primary');
 footer(panel,button('返回',returnTo),create);
 panel.querySelector('select').focus();
}

async function chooseWorkspace(){
 const archived=await core.workspaces.ensureLegacyArchive();
 const workspaces=await core.workspaces.list();
 const last=core.storage.localGet(recentKey);
 return workspaces.find(ws=>ws.id===last)
  ||workspaces.find(ws=>!ws.legacyArchive)
  ||archived
  ||core.workspaces.ensure('default-workspace',{name:'我的工作区'});
}
async function resolve(){
 const id=core.storage.workspaceId();
 const workspace=id
  ?await core.workspaces.ensure(id,{name:'未命名工作区',grade:'待指定'})
  :await chooseWorkspace();
 await core.storage.setWorkspace(workspace.id);
 if(!await core.storage.acquireLease()){
  showDuplicate(workspace);
  // Navigation or reload starts initialization again after the user resolves the conflict.
  return null;
 }
 if(!id)root.history.replaceState(null,'',core.workspaces.urlFor(workspace.id));
 core.storage.localSet(recentKey,workspace.id);
 mountHeader(workspace);
 return workspace;
}
function showDuplicate(workspace){
 const panel=openDialog('此工作区已在另一标签页打开');
 panel.append(el('p','workspace-lock-note',workspace.name+'正在另一标签页使用。关闭那一页后可以重试。'));
 const choose=()=>openPicker({blocked:workspace});
 footer(panel,button('选择其他工作区',choose),button('重试',()=>root.location.reload(),'primary'));
 panel.oncancel=event=>event.preventDefault();
}

function workspaceLabel(workspace){
 const label=el('span','workspace-row-label');
 label.append(el('strong','',workspace.name));
 const yearGrade=[workspace.academicYear,workspace.grade].filter(Boolean).join(' · ');
 if(workspace.legacyArchive)label.append(el('small','','旧版数据，可能包含多个年级'));
 else if(yearGrade&&!workspace.name.includes(yearGrade))label.append(el('small','',yearGrade));
 return label;
}
async function openPicker({manage=false,blocked=null}={}){
 try{
  const items=await core.workspaces.list();
  const currentId=core.storage.workspaceId();
  const panel=openDialog(manage?'管理工作区':'工作区');
  panel.oncancel=blocked?event=>event.preventDefault():null;
  const list=el('div','workspace-list');
  for(const workspace of items){
   const row=el('div','workspace-row');
   const current=workspace.id===currentId;
   const label=workspaceLabel(workspace);
   if(manage||current){
    row.append(label);
    if(current)row.append(el('span','workspace-current-badge',blocked?'使用中':'当前'));
   }else{
    const choose=button('',()=>root.location.assign(core.workspaces.urlFor(workspace.id)),'workspace-choice');
    choose.append(label,el('span','workspace-enter-label','进入'));
    row.append(choose);
   }
   if(manage){
    row.append(button('重命名',async()=>{
     const name=root.prompt('工作区名称',workspace.name)?.trim();
     if(!name||name===workspace.name)return;
     try{
      const renamed=await core.workspaces.update(workspace.id,{name});
      if(current)mountHeader(renamed);
      openPicker({manage:true});
     }catch(error){root.alert(error.message);}
    }));
    if(!current)row.append(button('删除',async()=>{
     if(!root.confirm('删除“'+workspace.name+'”及其中的成绩、试卷和座位记录？此操作不可撤销。'))return;
     try{
      await core.workspaces.remove(workspace.id);
      openPicker({manage:true});
     }catch(error){root.alert(error.message);}
    }));
   }
   list.append(row);
  }
  panel.append(list);
  const back=()=>openPicker({manage,blocked});
  if(manage)footer(panel,button('返回',()=>openPicker()));
  else footer(panel,
   blocked?button('返回',()=>showDuplicate(blocked)):button('关闭',closeDialog),
   ...(!blocked?[button('管理工作区',()=>openPicker({manage:true}))]:[]),
   button('新建年级工作区',()=>openCreate(back),'primary'));
 }catch(error){root.alert(error.message);}
}
function mountHeader(workspace){
 const row=document.getElementById('scoreToolsRow');
 let picker=document.getElementById('workspacePicker');
 if(!picker){
  picker=button('',()=>openPicker(),'workspace-trigger');
  picker.id='workspacePicker';
  picker.setAttribute('aria-haspopup','dialog');
  row.prepend(picker);
 }
 picker.replaceChildren(el('span','',workspace.name),el('span','workspace-chevron'));
 picker.title='切换或管理工作区';
 picker.setAttribute('aria-label',workspace.name+'，切换或管理工作区');
}
function requestWorkspaceMeta(defaults){
 return new Promise(resolve=>{
  const panel=openDialog('为旧版备份指定学年和年级');
  const form=makeForm(panel,defaults);
  let selection=null;
  panel.addEventListener('close',()=>resolve(selection),{once:true});
  footer(panel,button('取消',closeDialog),button('继续',()=>{
   selection=readForm(form);
   if(selection)closeDialog();
  },'primary'));
 });
}
root.WorkspaceUI={resolve,requestWorkspaceMeta};
})(window);
