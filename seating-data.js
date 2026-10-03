/* Current-class academic metrics and append-only seating records. */
(function(root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./app-core.js') : root.AppCore, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SeatingData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(core, root) {
    'use strict';
    const keyOf = s => core.studentKey(s);
    const numeric = value => { const n = core.number(value); return n === '' ? null : n; };
    const positiveRank = value => { const n = numeric(value); return Number.isInteger(n) && n > 0 ? n : null; };
    function rankMetrics(students, valueOf, descending, source) {
        const values = students.map(s => ({key:keyOf(s), value:valueOf(s)})).filter(x => Number.isFinite(x.value));
        values.sort((a,b) => descending ? b.value-a.value : a.value-b.value);
        const result = new Map(), population = values.length;
        for (let start=0; start<population;) {
            let end=start+1;
            while (end<population && values[end].value===values[start].value) end++;
            // Midpoint of tied positions: an all-tied class sits at 50%, not 0%.
            const percentile = population>1 ? (start+(end-start-1)/2)/(population-1)*100 : null;
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
    function buildProfiles(data, headers, className, totalSubject, batches, excludedSubjects) {
        const students=(data || []).filter(s=>core.classKey(s.class)===core.classKey(className));
        if(!students.length) return [];
        const subjects=Array.from(new Set(students.flatMap(s=>Object.keys(s.subjects || {}))))
            .filter(sn=>sn!==totalSubject && !(excludedSubjects || []).includes(sn)).sort();
        const metrics=new Map(subjects.map(sn=>[sn,subjectMetrics(students,sn)]));
        let total=totalSubject ? subjectMetrics(students,totalSubject) : new Map(), totalSource='总分';
        if(!total.size) {
            const available=subjects.filter(sn=>metrics.get(sn).size>1);
            total=rankMetrics(students,s=>{
                const values=available.map(sn=>metrics.get(sn).get(keyOf(s))?.percentile);
                return values.length && values.every(Number.isFinite) ? values.reduce((a,b)=>a+b,0)/values.length : null;
            },false,'本次班内各科相对位置平均');
            totalSource='各科相对位置综合';
        }
        const trendCache=(batches || []).slice(-3).map(b=>{
            const classmates=(b.combinedStudentData || []).filter(s=>core.classKey(s.class)===core.classKey(className));
            const totalName=(b.allSubjectHeaders || []).map(h=>h.name).find(sn=>String(sn).includes('总分')) || totalSubject;
            return {total:totalName ? subjectMetrics(classmates,totalName) : new Map(), subjects:new Map(subjects.map(sn=>[sn,subjectMetrics(classmates,sn)]))};
        });
        return students.map(s=>{
            const id=core.studentKey(s), overall=total.get(id), subjectStats={}, leads=[],weaks=[];
            subjects.forEach(sn=>{
                const m=metrics.get(sn).get(id), original=(s.subjects || {})[sn] || {};
                subjectStats[sn]=Object.assign({rank:null,population:0,percentile:null,source:'数据不足'},m || {},{
                    score:numeric(original.score), grade:core.grade(original.grade || ''),
                    gradeRank:positiveRank(original.gradeRank),
                    trend:trendCache.map(t=>t.subjects.get(sn).get(id)?.rank ?? '-')
                });
                if(Number.isFinite(m?.percentile)) {
                    if(m.percentile<=20) leads.push(sn);
                    if(m.percentile>=75) weaks.push(sn);
                }
            });
            const percentile=overall?.percentile ?? null;
            return {id,name:core.text(s.name),className:core.classLabel(s.class),totalRank:overall?.rank ?? null,
                totalPopulation:overall?.population || 0,totalPercentile:percentile,
                gradeRank:positiveRank((s.subjects || {})[totalSubject]?.gradeRank),
                totalScore:numeric((s.subjects || {})[totalSubject]?.score),totalSource,
                subjects:subjectStats,leads,weaks,biased:leads.length>0 && weaks.length>0,
                tier:Number.isFinite(percentile)?(percentile<=20?'领先':percentile<=60?'中上':percentile<75?'临界':'后进'):'数据不足',
                totalTrendRanks:trendCache.map(t=>t.total.get(id)?.rank ?? '-')};
        }).sort((a,b)=>(a.totalPercentile ?? Infinity)-(b.totalPercentile ?? Infinity) || a.name.localeCompare(b.name,'zh-CN'));
    }
    function complementDetails(a,b) {
        const details=[];
        Object.keys(a.subjects || {}).forEach(subject=>{
            const first=a.subjects[subject],second=(b.subjects || {})[subject];
            if(!second || !Number.isFinite(first.percentile) || !Number.isFinite(second.percentile)) return;
            if(first.percentile<=20 && second.percentile>=75) details.push({subject,helper:a.name,recipient:b.name});
            else if(second.percentile<=20 && first.percentile>=75) details.push({subject,helper:b.name,recipient:a.name});
        });
        return details;
    }
    function reconcile(profiles, saved) {
        const previous=saved?.students || [], byId=new Map(previous.filter(s=>s.id).map(s=>[s.id,s]));
        const students=profiles.map(p=>{
            const old=byId.get(p.id) || previous.find(s=>!s.id && s.name===p.name);
            return {id:p.id,name:p.name,className:p.className,status:old?.status==='fixed'?'fixed':old?.status==='special'?'special':'normal',
                tags:Array.isArray(old?.tags)?old.tags.slice():[],gradient:Number.isFinite(p.totalPercentile)?Math.min(8,Math.floor(p.totalPercentile/12.5)+1):0,
                compositeRank:p.totalPercentile,latestTotalRank:p.totalRank,totalPopulation:p.totalPopulation,
                gradeRank:p.gradeRank,totalScore:p.totalScore,totalSource:p.totalSource,totalTrend:p.totalTrendRanks || [],
                subjects:core.clone(p.subjects || {}),leadingSubjects:(p.leads || []).join(', '),weakSubjects:(p.weaks || []).join(', '),isSpecial:p.biased,level:p.tier};
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
        const capacity=Math.max(seatMap.length,Math.ceil((students.length+seatMap.filter(n=>n==='🚫').length)/8)*8,8);
        while(seatMap.length<capacity) seatMap.push(null);
        // Newly joined students fill available seats; old deliberately unseated students stay there.
        const oldIds=new Set(previous.map(s=>s.id || s.name));
        students.filter(s=>!seen.has(s.name) && !oldIds.has(s.id) && !oldIds.has(s.name)).forEach(s=>{const i=seatMap.indexOf(null);if(i>=0){seatMap[i]=s.name;seen.add(s.name)}});
        return {students,seatMap};
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
    function validMap(map, students, original) {
        if(!Array.isArray(map) || map.length!==original.length) return false;
        const roster=new Set(students.map(s=>s.name)),names=new Set(original.filter(n=>roster.has(n))),seen=new Set(),fixed=new Set(students.filter(s=>s.status==='fixed').map(s=>s.name));
        for(let i=0;i<map.length;i++) {
            const n=map[i];if(original[i]==='🚫' && n!=='🚫') return false;
            if(fixed.has(original[i]) && n!==original[i]) return false;
            if(n && n!=='🚫'){if(!names.has(n)||seen.has(n))return false;seen.add(n)}
        }
        return original.filter(n=>names.has(n)).every(n=>seen.has(n));
    }
    function groups(map,size) {
        const groups=[],rows=Math.ceil(map.length/8);size=Math.max(2,Math.min(12,Number(size)||4));
        for(let col=0;col<8;col+=2) {
            const indices=[];for(let row=0;row<rows;row++) indices.push(row*8+col,row*8+col+1);
            for(let i=0;i<indices.length;i+=size) groups.push(indices.slice(i,i+size));
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
    return {numeric,positiveRank,rankMetrics,subjectMetrics,buildProfiles,complementDetails,reconcile,repairMap,validMap,groups,createStore};
});
