const task=await taskSpace(23);
console.log({finishedAt:new Date().toISOString(),result:await task.finish({keep:[]})});
