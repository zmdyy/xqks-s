/* Selected-exam academic metrics and append-only seating records. */
(function(root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./app-core.js') : root.AppCore, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SeatingData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(core, root) {
    'use strict';
    const keyOf = s => core.studentKey(s);
    const numeric = value => { const n = core.number(value); return n === '' ? null : n; };
    const rankInfo = value => {
        const parts=core.text(value).split('/'),rank=numeric(parts[0]),population=parts.length===2?numeric(parts[1]):null;
        return {rank:Number.isInteger(rank)&&rank>0?rank:null,population:Number.isInteger(population)&&population>0?population:null};
    };
    const positiveRank = value => rankInfo(value).rank;
    const englishNames=['英语','英语合','英语合并','英语总分'];
    function normalizeExamSubjects(batches) {
        const valid=sd=>sd && (!core.hasValue(sd.score) || numeric(sd.score)!==null) && (numeric(sd.score)!==null || positiveRank(sd.gradeRank) || positiveRank(sd.classRank) || positiveRank(sd.schoolRank));
        const hasEnglish=batches.some(b=>(b.combinedStudentData || []).some(s=>englishNames.some(sn=>valid(s.subjects?.[sn]))));
        if(!hasEnglish)return batches;
        return batches.map(b=>Object.assign({},b,{
            combinedStudentData:(b.combinedStudentData || []).map(s=>{
                const subjects=Object.assign({},s.subjects),chosen=englishNames.find(sn=>valid(subjects[sn]));
                englishNames.forEach(sn=>delete subjects[sn]);
                delete subjects['英语听说'];delete subjects['英语笔试'];
                subjects['英语']=chosen?s.subjects[chosen]:{};
                return Object.assign({},s,{subjects});
            }),
            allSubjectHeaders:(b.allSubjectHeaders || []).filter(h=>!englishNames.includes(h.name) && !['英语听说','英语笔试'].includes(h.name)).concat({name:'英语'})
        }));
    }
    const layer = value => Number.isFinite(value)?Math.max(1,Math.min(8,Math.ceil(value/12.5-1e-10))):0;
    function rankMetrics(students, valueOf, descending, source) {
        const values = students.map(s => ({key:keyOf(s), value:valueOf(s)})).filter(x => Number.isFinite(x.value));
        values.sort((a,b) => descending ? b.value-a.value : a.value-b.value);
        const result = new Map(), population = values.length;
        for (let start=0; start<population;) {
            let end=start+1;
            while (end<population && values[end].value===values[start].value) end++;
            const percentile = population>1 ? (start+1)/population*100 : null;
            for(let i=start;i<end;i++) result.set(values[i].key,{rank:start+1,population,percentile,source,value:values[i].value});
            start=end;
        }
        return result;
    }
    function subjectMetrics(students, subject) {
        const data = s => (s.subjects || {})[subject] || {};
        if (students.some(s => numeric(data(s).score)!==null)) return rankMetrics(students,s=>numeric(data(s).score),true,'本次班内得分');
        // Choose one ranking source for the whole subject; never mix populations.
        for(const field of ['classRank','gradeRank','schoolRank']) {
            const value=s=>core.text(data(s).score) && numeric(data(s).score)===null ? null : positiveRank(data(s)[field]);
            if(students.some(s=>value(s)!==null)) return rankMetrics(students,value,false,'本次班内排序（'+{classRank:'原班级名次',gradeRank:'原年级名次',schoolRank:'原学校名次'}[field]+'）');
        }
        return new Map();
    }
    function examSources(data,headers,totalSubject,batches,options) {
        options=options || {};const current={id:'@current',label:'当前成绩',combinedStudentData:data || [],allSubjectHeaders:headers || []};
        function resolve(id) {
            if(!id || id==='@current')return current;
            const batch=(batches || []).find(b=>b.id===id);
            if(!batch)return null;
            return id===options.currentBatchId?Object.assign({},batch,{combinedStudentData:data,allSubjectHeaders:headers}):batch;
        }
        const first=resolve(options.currentExam || '@current'),second=options.compareExam?resolve(options.compareExam):null;
        const selected=[first,second].filter(Boolean),seen=new Set();
        return normalizeExamSubjects(selected.filter(b=>{const identity=b.id==='@current'?(options.currentBatchId || '@current'):b.id;if(seen.has(identity))return false;seen.add(identity);return true;}))
            .map(b=>Object.assign({},b,{totalName:(b.allSubjectHeaders || []).map(h=>h.name).find(n=>String(n).includes('总分')) || totalSubject}));
    }
    function hasGradeBasis(batch,options) {
        const population=(options.populations || {})[batch.id] || {},data=batch.combinedStudentData || [];
        if(Object.values(population).some(v=>positiveRank(v)))return true;
        if(data.some(s=>Object.values(s.subjects || {}).some(sd=>rankInfo(sd.gradeRank).population)))return true;
        const classes=new Set(data.map(s=>core.classKey(s.class)).filter(Boolean));
        const ranks=data.flatMap(s=>Object.values(s.subjects || {}).map(sd=>positiveRank(sd.gradeRank))).filter(Number.isFinite);
        return !!options.completeGrades?.[batch.id] && classes.size>1 && (!ranks.length || Math.max(...ranks)<=data.length);
    }
    function examMetrics(batch,subject,className,scope,options) {
        const all=batch.combinedStudentData || [],students=scope==='class'?all.filter(s=>core.classKey(s.class)===core.classKey(className)):all;
        if(scope==='class')return subjectMetrics(students,subject);
        const sd=s=>(s.subjects || {})[subject] || {},usable=s=>!core.hasValue(sd(s).score) || numeric(sd(s).score)!==null;
        const ranks=students.filter(s=>usable(s)&&positiveRank(sd(s).gradeRank));
        const inputs=(options.populations || {})[batch.id] || {},configured=positiveRank(inputs[subject] || (subject==='英语'?englishNames.map(sn=>inputs[sn]).find(Boolean):null) || inputs['*']);
        const denominators=new Set(ranks.map(s=>rankInfo(sd(s).gradeRank).population).filter(Number.isFinite));
        const importedMultipleClasses=!!options.completeGrades?.[batch.id] && new Set(all.map(s=>core.classKey(s.class)).filter(Boolean)).size>1;
        if(ranks.length) {
            const population=configured || (denominators.size===1?Array.from(denominators)[0]:importedMultipleClasses?students.filter(usable).filter(s=>numeric(sd(s).score)!==null || positiveRank(sd(s).gradeRank)).length:0);
            if(!population || denominators.size>1&&!configured || ranks.some(s=>positiveRank(sd(s).gradeRank)>population))return new Map();
            return new Map(ranks.map(s=>[keyOf(s),{rank:positiveRank(sd(s).gradeRank),population,percentile:positiveRank(sd(s).gradeRank)/population*100,source:'年级名次 / 年级有效人数'}]));
        }
        // A partial class cannot be ranked as a whole grade merely by entering its size.
        if(!importedMultipleClasses || configured && configured!==students.filter(s=>numeric(sd(s).score)!==null).length)return new Map();
        return rankMetrics(students,s=>numeric(sd(s).score),true,'已导入多班得分排序（须覆盖全年级）');
    }
    function buildProfiles(data, headers, className, totalSubject, batches, excludedSubjects, options) {
        options=options || {};const sources=examSources(data,headers,totalSubject,batches,options);
        let students=(data || []).filter(s=>core.classKey(s.class)===core.classKey(className));
        if(!students.length && sources[0])students=sources[0].combinedStudentData.filter(s=>core.classKey(s.class)===core.classKey(className));
        if(!students.length)return [];
        const basis=sources.map(b=>hasGradeBasis(b,options)),gradeScope=options.scope==='grade' || options.scope!=='class'&&basis.length>0&&basis.every(Boolean);
        const scope=gradeScope?'grade':'class',scopeLabel=gradeScope?'年级位置':'班内预实验位置';
        const subjects=Array.from(new Set(sources.flatMap(b=>(b.combinedStudentData || []).flatMap(s=>Object.keys(s.subjects || {}))))).filter(sn=>!sources.some(b=>b.totalName===sn) && !(excludedSubjects || []).includes(sn)).sort();
        const exams=sources.map(b=>({batch:b,total:examMetrics(b,b.totalName,className,scope,options),subjects:new Map(subjects.map(sn=>[sn,examMetrics(b,sn,className,scope,options)]))}));
        function average(id,subject) {
            const samples=exams.map(e=>Object.assign({examId:e.batch.id,label:e.batch.label || '当前成绩'},(subject?e.subjects.get(subject):e.total)?.get(id) || {rank:null,population:0,percentile:null,source:'数据不足'}));
            const valid=samples.filter(s=>Number.isFinite(s.percentile)),first=samples[0] || {};
            return {rank:first.rank ?? null,population:first.population || 0,percentile:valid.length?valid.reduce((sum,v)=>sum+v.percentile,0)/valid.length:null,
                sampleCount:valid.length,samples,scope,source:scopeLabel+' · '+(valid.length===2?'两次平均':valid.length===1?'单次有效':'数据不足')};
        }
        return students.map(s=>{
            const id=keyOf(s),overall=average(id),subjectStats={},leads=[],weaks=[];
            subjects.forEach(sn=>{
                const m=average(id,sn),original=(sources[0]?.combinedStudentData.find(x=>keyOf(x)===id)?.subjects || {})[sn] || {};
                subjectStats[sn]=Object.assign({},m,{score:numeric(original.score),grade:core.grade(original.grade),gradeRank:positiveRank(original.gradeRank),layer:layer(m.percentile),trend:m.samples.map(x=>x.rank ?? '-')});
                if(Number.isFinite(m.percentile)){if(m.percentile<=20)leads.push(sn);if(m.percentile>=75)weaks.push(sn);}
            });
            const original=(sources[0]?.combinedStudentData.find(x=>keyOf(x)===id)?.subjects || {})[sources[0]?.totalName] || {},pct=overall.percentile;
            return {id,name:core.text(s.name),className:core.classLabel(s.class),totalRank:overall.rank,totalPopulation:overall.population,totalPercentile:pct,totalSamples:overall.samples,sampleCount:overall.sampleCount,
                academicScope:scope,scopeLabel,examLabels:sources.map(b=>b.label || '当前成绩'),gradeRank:positiveRank(original.gradeRank),totalScore:numeric(original.score),totalSource:overall.source,
                subjects:subjectStats,leads,weaks,biased:leads.length>0&&weaks.length>0,tier:Number.isFinite(pct)?'L'+layer(pct):'数据不足',totalTrendRanks:overall.samples.map(x=>x.rank ?? '-')};
        }).sort((a,b)=>(a.totalPercentile ?? Infinity)-(b.totalPercentile ?? Infinity) || a.name.localeCompare(b.name,'zh-CN'));
    }
    function complementDetails(a,b) {
        const details=[];
        Object.keys(a.subjects || {}).forEach(subject=>{
            const first=a.subjects[subject],second=(b.subjects || {})[subject];
            if(!second || !Number.isFinite(first.percentile) || !Number.isFinite(second.percentile)) return;
            const gap=Math.abs(first.percentile-second.percentile),layerGap=Math.abs(layer(first.percentile)-layer(second.percentile));
            if(layerGap>=1 && gap>=10-1e-8)details.push({subject,helper:first.percentile<second.percentile?a.name:b.name,recipient:first.percentile<second.percentile?b.name:a.name,layerGap,positionGap:gap,urgency:Math.min(3,layerGap)});
        });
        return details;
    }
    function reconcile(profiles, saved) {
        const previous=saved?.students || [], byId=new Map(previous.filter(s=>s.id).map(s=>[s.id,s]));
        const students=profiles.map(p=>{
            const old=byId.get(p.id) || previous.find(s=>!s.id && s.name===p.name);
            return {id:p.id,name:p.name,className:p.className,status:old?.status==='fixed'?'fixed':old?.status==='special'?'special':'normal',
                tags:Array.isArray(old?.tags)?old.tags.slice():[],gradient:layer(p.totalPercentile),
                compositeRank:p.totalPercentile,latestTotalRank:p.totalRank,totalPopulation:p.totalPopulation,
                gradeRank:p.gradeRank,totalScore:p.totalScore,totalSource:p.totalSource,totalTrend:p.totalTrendRanks || [],
                subjects:core.clone(p.subjects || {}),totalSamples:core.clone(p.totalSamples || []),sampleCount:p.sampleCount || 0,academicScope:p.academicScope,scopeLabel:p.scopeLabel,examLabels:p.examLabels || [],leadingSubjects:(p.leads || []).join(', '),weakSubjects:(p.weaks || []).join(', '),isSpecial:p.biased,level:p.tier};
        });
        const nameChanges=new Map(previous.map(s=>[s.name,byId.has(s.id)?profiles.find(p=>p.id===s.id)?.name:s.name]));
        students.forEach(s=>{s.tags=s.tags.map(tag=>tag.replace(/^(关系不和|爱说话):(.+)$/,(_,kind,name)=>kind+':'+(nameChanges.get(name) || name)));});
        const names=new Set(students.map(s=>s.name)),seen=new Set();
        let seatMap=(saved?.seatMap || []).map(name=>{
            if(name==='🚫') return name;
            name=nameChanges.get(name) || name;
            if(!names.has(name) || seen.has(name)) return null;
            seen.add(name);return name;
        });
        const oldIds=new Set(previous.map(s=>s.id || s.name));
        const joined=students.filter(s=>!seen.has(s.name) && !oldIds.has(s.id) && !oldIds.has(s.name));
        const seatIds=layoutIds(seatMap,saved?.seatIds);
        const free=seatMap.filter((name,i)=>name===null && seatIds[i]!==null).length;
        const paddedCapacity=Math.max(8,Math.ceil(seatMap.length/8)*8);
        const available=free+paddedCapacity-seatMap.length;
        const capacity=paddedCapacity+Math.ceil(Math.max(0,joined.length-available)/8)*8;
        while(seatMap.length<capacity) seatMap.push(null);
        while(seatIds.length<capacity)seatIds.push(newSeatId());
        // Newly joined students fill available seats; old deliberately unseated students stay there.
        joined.forEach(s=>{const i=seatMap.findIndex((n,i)=>n===null && seatIds[i]!==null);if(i>=0){seatMap[i]=s.name;seen.add(s.name)}});
        return {students,seatMap,seatIds};
    }
    function repairMap(map, students, original) {
        const roster=new Set(students.map(s=>s.name)),names=new Set(original.filter(n=>roster.has(n))),fixed=new Set(students.filter(s=>s.status==='fixed').map(s=>s.name)),seen=new Set();
        const result=Array.from({length:original.length},(_,i)=>{
            const n=original[i];if(n==='🚫') return n;
            if(fixed.has(n)){seen.add(n);return n;}return null;
        });
        map.forEach((name,i)=>{if(i<result.length && result[i]===null && names.has(name) && !fixed.has(name) && !seen.has(name)){result[i]=name;seen.add(name)}});
        const expected=Array.from(new Set(original.filter(n=>names.has(n))));
        expected.filter(n=>!seen.has(n)).forEach(n=>{const i=result.indexOf(null);if(i>=0){result[i]=n;seen.add(n)}});
        return result;
    }
    function validMap(map, students, original, seatIds) {
        if(!Array.isArray(map) || map.length!==original.length) return false;
        if(!validSeatLayout(map,seatIds))return false;
        const roster=new Set(students.map(s=>s.name)),names=new Set(original.filter(n=>roster.has(n))),seen=new Set(),fixed=new Set(students.filter(s=>s.status==='fixed').map(s=>s.name));
        for(let i=0;i<map.length;i++) {
            const n=map[i];if(original[i]==='🚫' && n!=='🚫') return false;
            if(fixed.has(original[i]) && n!==original[i]) return false;
            if(n && n!=='🚫'){if(!names.has(n)||seen.has(n))return false;seen.add(n)}
        }
        return original.filter(n=>names.has(n)).every(n=>seen.has(n));
    }
    const newSeatId=()=> 'seat-'+(root.crypto?.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    function validSeatLayout(map,ids) {
        if(ids==null)return true; // Migrate older snapshots without layout metadata.
        if(!Array.isArray(ids) || ids.length!==map.length)return false;
        const seen=new Set();
        return ids.every((id,i)=>{if(id===null)return map[i]===null;if(typeof id!=='string'||!id||seen.has(id))return false;seen.add(id);return true;});
    }
    function layoutIds(map,ids) {
        if(!validSeatLayout(map,ids))throw new Error('座位布局编号重复、缺失或占用了不存在的位置');
        return ids?ids.slice():map.map((_,i)=>'legacy-seat-'+i);
    }
    function addSeats(map,ids,options) {
        const seatMap=map.slice(),seatIds=layoutIds(map,ids);
        if(options.index!=null) {
            const i=options.index;
            if(!Number.isInteger(i)||i<0||i>=map.length||seatIds[i]!==null)throw new Error('此位置已存在');
            seatIds[i]=newSeatId();
        } else {
            if(!['top','bottom'].includes(options.side)||!options.whole&&(!Number.isInteger(options.col)||options.col<0||options.col>7))throw new Error('新增座位位置无效');
            const row=Array(8).fill(null),rowIds=row.map((_,i)=>options.whole||i===options.col?newSeatId():null);
            if(options.side==='top'){seatMap.unshift(...row);seatIds.unshift(...rowIds);}
            else {seatMap.push(...row);seatIds.push(...rowIds);}
        }
        return {seatMap,seatIds};
    }
    function fillUnseated(students,map,ids) {
        let layout={seatMap:map.slice(),seatIds:layoutIds(map,ids)};
        const present=new Set(map.filter(Boolean)),waiting=students.filter(s=>!present.has(s.name));
        const free=layout.seatMap.flatMap((name,i)=>name===null && layout.seatIds[i]!==null?[i]:[]);
        // An explicit reload seats the whole roster, while keeping existing positions and holes.
        while(free.length<waiting.length) {
            const start=layout.seatMap.length;
            layout=addSeats(layout.seatMap,layout.seatIds,{side:'bottom',whole:true});
            for(let i=start;i<layout.seatMap.length;i++)free.push(i);
        }
        waiting.forEach((s,i)=>{layout.seatMap[free[i]]=s.name;});
        return Object.assign(layout,{placed:waiting.length});
    }
    function groups(map,size,seatIds) {
        const groups=[],rows=Math.ceil(map.length/8);size=Math.max(2,Math.min(12,Number(size)||4));size+=size%2;
        for(let col=0;col<8;col+=2) {
            let indices=[],desks=0;
            for(let row=0;row<rows;row++) {
                const desk=[row*8+col,row*8+col+1].filter(i=>i<map.length && (!seatIds || seatIds[i]!==null));
                if(!desk.length)continue;
                indices.push(...desk);desks++;
                if(desks===size/2){groups.push(indices);indices=[];desks=0;}
            }
            if(indices.length)groups.push(indices);
        }
        return groups;
    }
    function createStore(storage, local, namespace) {
        const prefix=namespace ? encodeURIComponent(namespace)+':' : '';
        const registry=prefix+'seating_classes_v3',remembered=prefix+'seating_last_class_v3';
        const journalKey=cls=>prefix+'seating_journal_v3:'+core.classKey(cls),stateKey=cls=>prefix+'seating_class_v3:'+core.classKey(cls);
        let queue=Promise.resolve();
        const getLocal=key=>{try{return JSON.parse(local.getItem(key)||'null')}catch(_){return null}};
        function register(cls) {
            const list=getLocal(registry) || [];if(!list.includes(cls))list.push(cls);
            try{local.setItem(registry,JSON.stringify(list))}catch(_){}
            return list;
        }
        function save(cls,snapshot,history) {
            const key=journalKey(cls),previous=getLocal(key), pending=previous?.pending || [];
            const record={version:3,className:cls,latest:core.clone(snapshot),history:core.clone(history)};
            const journal={state:record,pending:pending.concat(core.clone(snapshot))};
            let localSaved=true;try{local.setItem(key,JSON.stringify(journal))}catch(_){localSaved=false}
            const classes=register(cls);
            const task=queue.catch(()=>{}).then(async()=>{
                // A single class state points only at snapshots already committed.
                for(const snap of journal.pending) await storage.write('seating_snapshot_v3:'+snap.id,snap);
                await storage.write(stateKey(cls),record);
                const storedClasses=await storage.read(registry) || [];
                await storage.write(registry,Array.from(new Set([...storedClasses,...classes])));
                const current=getLocal(key);
                if(current){const committed=new Set(journal.pending.map(s=>s.id));current.pending=current.pending.filter(s=>!committed.has(s.id));try{local.setItem(key,JSON.stringify(current))}catch(_){}}
                return true;
            });
            queue=task;return {localSaved,promise:task};
        }
        async function load(cls) {
            const localRecord=getLocal(journalKey(cls));let record;
            try{record=await storage.read(stateKey(cls))}catch(error){if(!localRecord)throw error}
            if(localRecord?.state && (!record || localRecord.state.history.length>=record.history.length)) record=localRecord.state;
            if(localRecord?.pending?.length) {
                const snap=localRecord.state.latest;
                // Replay a synchronous journal left by closing the browser during a write.
                save(cls,snap,localRecord.state.history).promise.catch(()=>{});
            }
            return record || null;
        }
        async function snapshot(cls,entry) {
            const pending=getLocal(journalKey(cls))?.pending || [];
            const found=pending.find(s=>s.id===entry.id);if(found)return core.clone(found);
            return entry.students ? core.clone(entry) : storage.read('seating_snapshot_v3:'+entry.id);
        }
        async function classes() {
            let stored=[];try{stored=await storage.read(registry) || []}catch(_){}
            return Array.from(new Set([...(getLocal(registry) || []),...stored]));
        }
        return {save,load,snapshot,classes,flush:()=>queue,peek:cls=>getLocal(journalKey(cls))?.state || null,
            remember(cls){try{local.setItem(remembered,cls)}catch(_){}},lastClass(){try{return local.getItem(remembered)}catch(_){return null}}};
    }
    return {numeric,positiveRank,rankInfo,layer,rankMetrics,subjectMetrics,examSources,examMetrics,buildProfiles,complementDetails,reconcile,repairMap,validMap,validSeatLayout,layoutIds,addSeats,fillUnseated,groups,createStore};
});
