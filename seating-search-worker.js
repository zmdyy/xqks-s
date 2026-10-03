importScripts('app-core.js','seating-data.js','seating-engine.js');
self.onmessage=function(event) {
    try {
        const run=new SeatingEngine.Search(event.data.context,event.data.options);let last=0;
        while(run.step(1200))if(performance.now()-last>250){last=performance.now();self.postMessage({progress:true,evaluations:run.evaluations,elapsedMs:performance.now()-run.started});}
        self.postMessage({result:run.result()});
    }catch(error){self.postMessage({error:error.message});}
};
