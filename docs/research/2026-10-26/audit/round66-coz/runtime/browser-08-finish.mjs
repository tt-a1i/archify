const task=await taskSpace(19);
console.log({finishedAt:new Date().toISOString(),result:await task.finish({keep:[]})});
