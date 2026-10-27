const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const src=fs.readFileSync('index.html','utf8');
function get(name){const start=src.indexOf('function '+name+'('),end=src.indexOf('\nfunction ',start+1);assert(start>=0);return src.slice(start,end);}
const ctx={DataPool:{batches:[{id:'exam',label:'test',combinedStudentData:[{name:'A',class:'801',subjects:{物理:{subScores:{'14(1)':{score:0,maxScore:2},'14(2)':{score:1,maxScore:2},'14(3)':{score:2,maxScore:2},'15':{score:'',maxScore:3},'16':{score:-1,maxScore:2},'17':{score:3,maxScore:2},'18':{score:'1x',maxScore:2}}}}}]}]}};
vm.createContext(ctx);for(const name of ['parseCompositeQuestionRef','normalizeItemName','getCanonicalQuestionRefInfo','getErrorMajorKey','looksLikeSubQuestionName','mergeSplitErrorItems','collectStudentErrorsFromAllBatches'])vm.runInContext(get(name),ctx);
assert.equal(ctx.getCanonicalQuestionRefInfo('02卷30-1').major,30);
for (const [label,major] of [['01卷物理单选15',15],['0)1卷物理单选16',16],['(02卷物理计算23-1',23],['02卷物理23-45',23],['物理1卷',null],['0)物理1卷',null],['单选题',null]]) assert.equal(ctx.getCanonicalQuestionRefInfo(label).major,major,label);
const sourceColumns=Array.from({length:18},(_,i)=>'0)'+(i+15<23?'1':'2')+'卷物理'+(i+15<23?'单选':'计算')+(i+15));
assert.deepEqual(sourceColumns.map(x=>ctx.getErrorMajorKey(x)),Array.from({length:18},(_,i)=>String(i+15)));
assert.equal(ctx.getErrorMajorKey('0)物理1卷'),null);

const errors=ctx.collectStudentErrorsFromAllBatches('A','801').allErrors;assert.equal(errors.length,2);
const merged=ctx.mergeSplitErrorItems(errors);assert.equal(merged.length,1);assert.equal(merged[0].score,1);assert.equal(merged[0].maxScore,4);assert.equal(merged[0].studentAnswer,'');assert.equal(merged[0].detailItemNames.length,2);
console.log('PASS score semantics: partial/zero, missing and invalid values, paper prefix, merged subquestions without invented answers');
