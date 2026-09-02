const assert=require('node:assert/strict');

global.window=global;
require('../js/operational-workflows.js');

const workflows=global.AeroOperationalWorkflows;
assert.deepEqual(Object.keys(workflows.DEPARTMENTS),['dispatch','crew','maintenance','station']);
assert.deepEqual(Object.keys(workflows.WORKFLOWS),[
  'crew_sick','mel_defect','atc_restriction','gate_conflict','destination_closure'
]);

const tasks=workflows.tasksForIncident({id:'INC9',type:'destination_closure',flightId:'AS9',aircraftId:'AC9',detectedAt:1000});
assert.equal(tasks.length,5);
assert.equal(tasks[0].status,'available');
assert.equal(tasks[1].status,'blocked');
assert.deepEqual(tasks.at(-1).dependsOn,['INC9:dispatch-atc','INC9:station-alternate']);
assert.equal(workflows.progress({status:'in_progress',startedAt:1000,completesAt:2000},1500),.5);
assert.equal(workflows.progress({status:'completed'},1500),1);

console.log('operational workflow smoke tests passed');
