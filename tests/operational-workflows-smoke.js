const assert=require('node:assert/strict');

global.window=global;
require('../js/operational-workflows.js');

const workflows=global.AeroOperationalWorkflows;
assert.deepEqual(Object.keys(workflows.DEPARTMENTS),['dispatch','crew','maintenance','station']);
assert.deepEqual(Object.keys(workflows.WORKFLOWS),[
  'crew_sick','mel_defect','atc_restriction','gate_conflict','destination_closure',
  'aircraft_late_inbound','crew_duty_risk','crew_fatigue_report','slot_miss_risk','connection_risk',
  'baggage_loading_issue','fueling_issue','security_screening','bird_strike','onboard_medical'
]);

const tasks=workflows.tasksForIncident({id:'INC9',type:'destination_closure',flightId:'AS9',aircraftId:'AC9',detectedAt:1000});
assert.equal(tasks.length,8);
assert.equal(tasks[0].status,'available');
assert.equal(tasks[1].status,'blocked');
assert.equal(tasks[0].kind,'recovery_strategy');
assert.deepEqual(tasks[0].strategyOptions.map(option=>option.id),['alternate','return_origin']);
assert.deepEqual(tasks.find(task=>task.kind==='dispatch_release').dependsOn,['INC9:dispatch-atc','INC9:station-alternate']);
assert.equal(tasks.find(task=>task.kind==='flight_cancellation').required,false);

const melTasks=workflows.tasksForIncident({id:'INC10',type:'mel_defect',flightId:'AS10',aircraftId:'AC10',detectedAt:1000});
assert.equal(melTasks.length,7);
assert.equal(melTasks.find(task=>task.key==='mx-strategy').kind,'recovery_strategy');
assert.equal(melTasks.find(task=>task.key==='mx-strategy').dependsOn[0],'INC10:mx-inspect');
assert.equal(melTasks.find(task=>task.kind==='aircraft_substitution').branch,'substitute');
assert.equal(melTasks.find(task=>task.kind==='flight_cancellation').branch,'');
assert.equal(melTasks.find(task=>task.kind==='flight_cancellation').required,false);
assert.deepEqual(melTasks.find(task=>task.kind==='dispatch_release').strategies,['defer','repair','substitute']);

const atcTasks=workflows.tasksForIncident({id:'INC11',type:'atc_restriction',flightId:'AS11',aircraftId:'AC11',detectedAt:1000});
assert.deepEqual(atcTasks.find(task=>task.key==='dispatch-flow-strategy').strategyOptions.map(option=>option.id),['accept','priority']);
assert.equal(atcTasks.find(task=>task.key==='dispatch-flow-priority').branch,'priority');

const gateTasks=workflows.tasksForIncident({id:'INC12',type:'gate_conflict',flightId:'AS12',aircraftId:'AC12',detectedAt:1000});
assert.deepEqual(gateTasks.find(task=>task.key==='station-stand-strategy').strategyOptions.map(option=>option.id),['remote','tow','wait_gate']);
assert.equal(gateTasks.find(task=>task.key==='station-tow').action,'tow');

const crewTasks=workflows.tasksForIncident({id:'INC13',type:'crew_sick',flightId:'AS13',aircraftId:'AC13',detectedAt:1000});
assert.equal(crewTasks.find(task=>task.key==='crew-strategy').kind,'recovery_strategy');
assert.equal(crewTasks.find(task=>task.key==='crew-allocate').branch,'replace');

const inboundTasks=workflows.tasksForIncident({id:'INC14',type:'aircraft_late_inbound',flightId:'AS14',aircraftId:'AC14',detectedAt:1000});
assert.deepEqual(inboundTasks.find(task=>task.key==='dispatch-inbound-strategy').strategyOptions.map(option=>option.id),['wait_inbound','expedite_turn','substitute']);
assert.equal(inboundTasks.find(task=>task.kind==='aircraft_substitution').branch,'substitute');

const dutyTasks=workflows.tasksForIncident({id:'INC15',type:'crew_duty_risk',flightId:'AS15',aircraftId:'AC15',detectedAt:1000});
assert.deepEqual(dutyTasks.find(task=>task.key==='crew-duty-strategy').strategyOptions.map(option=>option.id),['augment','replace']);
assert.equal(dutyTasks.find(task=>task.kind==='crew_augmentation').branch,'augment');

const slotTasks=workflows.tasksForIncident({id:'INC16',type:'slot_miss_risk',flightId:'AS16',aircraftId:'AC16',detectedAt:1000});
assert.deepEqual(slotTasks.find(task=>task.key==='dispatch-slot-strategy').strategyOptions.map(option=>option.id),['accept_next','priority','expedite_turn']);
assert.equal(slotTasks.find(task=>task.kind==='slot_coordination').action,'accept_next');

const medicalTasks=workflows.tasksForIncident({id:'INC17',type:'onboard_medical',flightId:'AS17',aircraftId:'AC17',detectedAt:1000});
assert.deepEqual(medicalTasks.find(task=>task.key==='dispatch-medical-strategy').strategyOptions.map(option=>option.id),['continue','divert']);
assert.equal(medicalTasks.find(task=>task.kind==='flight_cancellation').required,false);

assert.equal(workflows.progress({status:'in_progress',startedAt:1000,completesAt:2000},1500),.5);
assert.equal(workflows.progress({status:'completed'},1500),1);

console.log('operational workflow smoke tests passed');
