/* Cached pair metrics and time-budgeted, lexicographic seating search. */
(function(root,factory){
    const api=factory(typeof module==='object'&&module.exports?require('./seating-data.js'):root.SeatingData);
    if(typeof module==='object'&&module.exports)module.exports=api;else root.SeatingEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(data){
    'use strict';
    const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
    const blocked='🚫';
    function prepare(students,seatMap,settings) {
        settings=settings || {};const n=students.length,names=students.map(s=>s.name),index=new Map(names.map((name,i)=>[name,i]));
        if(index.size!==n)throw new Error('同班姓名重复，请先区分学生姓名');
        if(!data.validSeatLayout(seatMap,settings.seatIds))throw new Error('座位布局无效');
        const original=seatMap.map(name=>name===blocked?-2:name==null?-1:index.has(name)?index.get(name):-3);
        if(original.includes(-3)||new Set(original.filter(i=>i>=0)).size!==original.filter(i=>i>=0).length)throw new Error('当前排位有重复或未知学生，请先修复');
        const allowed=new Uint8Array(n*n),mutual=new Uint8Array(n*n),moderate=new Uint8Array(n*n),balance=new Uint8Array(n*n),urgency=new Uint16Array(n*n),single=new Uint8Array(n*n),behavior=new Int16Array(n*n);
        const pairs=[],details=[],anchors=new Uint8Array(n),validTotals=students.map((s,i)=>({i,p:s.compositeRank})).filter(x=>Number.isFinite(x.p)).sort((a,b)=>a.p-b.p);
        if(validTotals.length){const cut=validTotals[Math.ceil(validTotals.length*.2)-1].p;validTotals.filter(x=>x.p<=cut).forEach(x=>anchors[x.i]=1);}
        for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
            const a=students[i],b=students[j],help=data.complementDetails(a,b),f=help.filter(d=>d.helper===a.name),r=help.filter(d=>d.helper===b.name),g1=data.layer(a.compositeRank),g2=data.layer(b.compositeRank),gap=Math.abs(a.compositeRank-b.compositeRank);
            const conflict=(a.tags || []).includes('关系不和:'+b.name)||(b.tags || []).includes('关系不和:'+a.name);
            const pair={i,j,allowed:!!(g1&&g2&&Math.abs(g1-g2)<=2&&!conflict),mutual:!!(f.length&&r.length),moderate:Number.isFinite(gap)&&gap>10+1e-8&&gap<=25+1e-8,balance:Math.min(f.length,r.length),urgency:Math.min(f.reduce((sum,d)=>sum+d.urgency,0),r.reduce((sum,d)=>sum+d.urgency,0)),single:f.length&&r.length?0:Math.max(f.length,r.length),totalGap:Number.isFinite(gap)?gap:null,layerGap:g1&&g2?Math.abs(g1-g2):null,conflict,help};
            pairs.push(pair);details.push(pair);
            let soft=0;
            if((a.tags || []).includes('爱说话:'+b.name)||(b.tags || []).includes('爱说话:'+a.name))soft-=80;
            if((a.tags || []).includes('性格开朗')!==(b.tags || []).includes('性格开朗'))soft+=10;
            for(const k of [i*n+j,j*n+i]){allowed[k]=+pair.allowed;mutual[k]=+pair.mutual;moderate[k]=+pair.moderate;balance[k]=pair.balance;urgency[k]=pair.urgency;single[k]=pair.single;behavior[k]=soft;}
        }
        const groups=data.groups(seatMap,settings.groupSize || 6,settings.seatIds),seatGroups=new Int16Array(seatMap.length),neighbors=groups.map(()=>[]);
        groups.forEach((g,gi)=>g.forEach(s=>{if(s<seatMap.length)seatGroups[s]=gi;}));
        groups.forEach((g,gi)=>groups.forEach((h,hj)=>{if(gi!==hj&&g.some(a=>h.some(b=>Math.abs(Math.floor(a/8)-Math.floor(b/8))+Math.abs(a%8-b%8)===1)))neighbors[gi].push(hj);}));
        const fixed=original.map(i=>i>=0&&students[i].status==='fixed'),movable=original.map((s,i)=>s>=0&&!fixed[i]?i:-1).filter(i=>i>=0);
        return {n,names,original,allowed,mutual,moderate,balance,urgency,single,behavior,anchors,groups,seatGroups,neighbors,fixed,movable,pairs,details,seatIds:settings.seatIds,studentTags:students.map(s=>s.tags || []),groupSize:settings.groupSize || 6};
    }
    function evaluate(c,map) {
        const m={dual:0,own:0,adjacent:0,moderate:0,balance:0,urgency:0,single:0,behavior:0,desks:0,violations:0,activeGroups:0},coverage=new Uint8Array(c.groups.length),active=new Uint8Array(c.groups.length);
        for(let i=0;i<map.length;i++) {
            const s=map[i];if(s<0)continue;
            const g=c.seatGroups[i];active[g]=1;if(c.anchors[s])coverage[g]=1;
            if(c.studentTags[s].includes('眼疾')||c.studentTags[s].includes('个矮'))m.behavior-=Math.floor(i/8)*2;
        }
        for(let g=0;g<active.length;g++)if(active[g]){m.activeGroups++;if(coverage[g])m.own++;else if(c.neighbors[g].some(h=>coverage[h]))m.adjacent++;}
        for(let i=0;i+1<map.length;i+=2) {
            const a=map[i],b=map[i+1];if(a<0||b<0)continue;const k=a*c.n+b;m.desks++;
            if(!c.allowed[k]){m.violations++;continue;}
            m.behavior+=c.behavior[k];if(c.mutual[k]){m.dual++;m.moderate+=c.moderate[k];m.balance+=c.balance[k];m.urgency+=c.urgency[k];}else m.single+=c.single[k];
        }
        return m;
    }
    function rebase(c,students,map) {
        if(!data.validSeatLayout(map,c.seatIds))throw new Error('座位布局无效');
        const index=new Map(c.names.map((name,i)=>[name,i])),original=map.map(name=>name===blocked?-2:name==null?-1:index.get(name) ?? -3);
        if(original.includes(-3)||new Set(original.filter(i=>i>=0)).size!==original.filter(i=>i>=0).length)throw new Error('当前排位有重复或未知学生');
        const fixed=original.map(i=>i>=0&&students[i].status==='fixed'),movable=original.map((s,i)=>s>=0&&!fixed[i]?i:-1).filter(i=>i>=0);
        return Object.assign({},c,{original,fixed,movable});
    }
    function valid(c,map) {
        if(map.length!==c.original.length)return false;
        const seen=new Uint8Array(c.n);
        for(let i=0;i<map.length;i++) {
            const value=map[i],old=c.original[i];
            if(c.seatIds?.[i]===null && value!==-1)return false;
            if(!Number.isInteger(value)||value< -2)return false;
            if(old<0 && value!==old || old>=0 && value<0 || c.fixed[i]&&value!==old || value>=c.n)return false;
            if(value>=0){if(seen[value])return false;seen[value]=1;}
        }
        for(const s of c.original)if(s>=0&&!seen[s])return false;
        for(let i=0;i+1<map.length;i+=2)if(map[i]>=0&&map[i+1]>=0&&!c.allowed[map[i]*c.n+map[i+1]])return false;
        return true;
    }
    function compare(a,b,mode) {
        if(!b)return 1;
        const order=mode==='behavior'?['behavior','dual','own','adjacent','moderate','balance','urgency','single']:mode==='social'?['own','adjacent','dual','moderate','balance','urgency','single','behavior']:['dual','own','adjacent','moderate','balance','urgency','single','behavior'];
        for(const key of order)if(a[key]!==b[key])return a[key]>b[key]?1:-1;
        return 0;
    }
    function rng(seed) {let x=seed>>>0 || 1;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
    // MRV backtracking repairs infeasible starts without ever accepting an invalid desk.
    function initial(c,random,deadline) {
        const map=c.original.slice(),pool=c.movable.map(i=>map[i]),singleSlots=[],doubleDesks=[],pinned=[];
        c.movable.forEach(i=>map[i]=-1);
        for(let i=0;i+1<map.length;i+=2) {
            const slots=[i,i+1].filter(s=>c.original[s]>=0&&!c.fixed[s]);
            if(slots.length===2)doubleDesks.push(i);
            else if(slots.length===1){const other=slots[0]===i?i+1:i;if(map[other]>=0)pinned.push({slot:slots[0],other:map[other]});else singleSlots.push(slots[0]);}
            else if(map[i]>=0&&map[i+1]>=0&&!c.allowed[map[i]*c.n+map[i+1]])return null;
        }
        let nodes=0;const chosen=[];
        const preference=(a,b)=>{const k=a*c.n+b;return c.mutual[k]*100+c.moderate[k]*8+c.balance[k]+c.urgency[k]*.1-(c.anchors[a]&&c.anchors[b]?5:0)+random()*18;};
        function match(remaining) {
            if(++nodes>12000||now()>deadline)return false;
            if(!remaining.length)return true;
            if(remaining.length<=singleSlots.length){remaining.forEach((s,i)=>map[singleSlots[i]]=s);return true;}
            let selected=-1,partners=[],degree=Infinity;
            for(let i=0;i<remaining.length;i++) {
                const a=remaining[i],candidates=remaining.filter(b=>b!==a&&c.allowed[a*c.n+b]);
                if(candidates.length<degree){degree=candidates.length;selected=a;partners=candidates;}
            }
            partners=partners.map(b=>({b,score:preference(selected,b)})).sort((a,b)=>b.score-a.score).map(x=>x.b);
            for(const b of partners){chosen.push([selected,b]);if(match(remaining.filter(s=>s!==selected&&s!==b)))return true;chosen.pop();}
            if(singleSlots.length){const free=singleSlots.pop();map[free]=selected;if(match(remaining.filter(s=>s!==selected)))return true;map[free]=-1;singleSlots.push(free);}
            return false;
        }
        function fix(k,remaining) {
            if(++nodes>12000||now()>deadline)return false;
            if(k===pinned.length)return match(remaining);
            const {slot,other}=pinned[k],candidates=remaining.filter(s=>c.allowed[other*c.n+s]).map(s=>({s,score:preference(other,s)})).sort((a,b)=>b.score-a.score);
            for(const item of candidates){map[slot]=item.s;if(fix(k+1,remaining.filter(s=>s!==item.s)))return true;}map[slot]=-1;return false;
        }
        if(!fix(0,pool))return null;
        const covered=new Set();map.forEach((s,i)=>{if(s>=0&&c.anchors[s])covered.add(c.seatGroups[i]);});
        const remaining=chosen.slice();
        // Place distinct anchor-containing pairs in uncovered groups first.
        for(const desk of doubleDesks) {
            const g=c.seatGroups[desk];let i=!covered.has(g)?remaining.findIndex(p=>c.anchors[p[0]]||c.anchors[p[1]]):-1;
            if(i<0)i=Math.floor(random()*remaining.length);
            const pair=remaining.splice(i,1)[0];if(!pair)return null;map[desk]=pair[0];map[desk+1]=pair[1];if(c.anchors[pair[0]]||c.anchors[pair[1]])covered.add(g);
        }
        return valid(c,map)?map:null;
    }
    class Search {
        constructor(context,options) {
            this.c=context;this.options=options || {};this.mode=this.options.mode || 'academic';this.random=rng(this.options.seed || Math.floor(Math.random()*4294967295));
            this.started=now();this.deadline=this.started+(this.options.budgetMs ?? 5000);this.evaluations=0;this.attempts=0;this.rejected=0;this.restarts=0;this.best=null;this.bestMetrics=null;this.current=null;this.currentMetrics=null;this.sinceRestart=0;this.done=false;
            if(valid(context,context.original))this.acceptStart(context.original.slice());
            const candidate=initial(context,this.random,Math.min(this.deadline,now()+150));if(candidate)this.acceptStart(candidate);
        }
        acceptStart(map) {
            this.current=map;this.currentMetrics=evaluate(this.c,map);this.evaluations++;this.restarts++;this.sinceRestart=0;
            if(compare(this.currentMetrics,this.bestMetrics,this.mode)>0){this.best=map.slice();this.bestMetrics=this.currentMetrics;}
        }
        step(limit) {
            if(this.done)return false;
            const c=this.c,random=this.random;
            for(let i=0;i<(limit || 1000);i++) {
                if(now()>=this.deadline||this.options.maxEvaluations&&this.evaluations>=this.options.maxEvaluations){this.done=true;break;}
                if(!this.current || this.sinceRestart>=16000) {
                    const start=initial(c,random,Math.min(this.deadline,now()+60));if(start)this.acceptStart(start);else if(this.best)this.acceptStart(this.best.slice());else continue;
                }
                if(c.movable.length<2){this.done=true;break;}
                const map=this.current.slice(),pick=()=>c.movable[Math.floor(random()*c.movable.length)],a=pick(),b=pick();this.attempts++;
                if(a===b)continue;
                const kind=random();
                if(kind<.4) {
                    const da=a-a%2,db=b-b%2;if(da===db||da+1>=map.length||db+1>=map.length||[da,da+1,db,db+1].some(s=>c.original[s]<0||c.fixed[s]))continue;
                    [map[da],map[db]]=[map[db],map[da]];[map[da+1],map[db+1]]=[map[db+1],map[da+1]];
                } else if(kind>.8) {const t=pick();if(t===a||t===b)continue;[map[a],map[b],map[t]]=[map[b],map[t],map[a]];}
                else [map[a],map[b]]=[map[b],map[a]];
                // The move preserves roster, fixed positions and occupied/blocked masks.
                const desks=new Set([a-a%2,b-b%2]);if(kind>.8){for(let s=0;s<map.length;s++)if(map[s]!==this.current[s])desks.add(s-s%2);}
                let feasible=true;for(const desk of desks)if(map[desk]>=0&&map[desk+1]>=0&&!c.allowed[map[desk]*c.n+map[desk+1]]){feasible=false;break;}
                if(!feasible){this.rejected++;continue;}
                const metrics=evaluate(c,map);this.evaluations++;this.sinceRestart++;
                if(compare(metrics,this.bestMetrics,this.mode)>0){this.best=map.slice();this.bestMetrics=metrics;}
                const kick=.018*(1-Math.min(1,(now()-this.started)/(this.deadline-this.started)));
                if(compare(metrics,this.currentMetrics,this.mode)>=0||random()<kick){this.current=map;this.currentMetrics=metrics;}
                if(this.sinceRestart%700===0&&this.best){this.current=this.best.slice();this.currentMetrics=this.bestMetrics;}
            }
            return !this.done;
        }
        result() {
            return {solution:this.best?this.best.map(i=>i===-2?blocked:i<0?null:this.c.names[i]):null,metrics:this.bestMetrics,evaluations:this.evaluations,attempts:this.attempts,rejected:this.rejected,restarts:this.restarts,elapsedMs:now()-this.started,valid:!!this.best&&valid(this.c,this.best),reason:this.best?'':'未找到符合硬约束的排位，请检查总分缺失、固定同桌和关系不和设置'};
        }
    }
    function search(context,options){const run=new Search(context,options);while(run.step(1000)){}return run.result();}
    return {prepare,rebase,evaluate,valid,compare,initial,Search,search};
});
