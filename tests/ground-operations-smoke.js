const assert = require('node:assert/strict');

global.window = global;
require('../js/ground-operations.js');

const MIN=60_000;
const now=Date.now();
const aircraft={segment:'Narrowbody'};
const first={id:'AS1',from:'FRA',to:'LHR',departure:now+40*MIN,handlingDelayMin:15,flightType:'passenger'};
const firstPhase=AeroGroundOperations.departurePhase({flight:first,aircraft,minimumTurnMin:40,now});

assert.equal(firstPhase.kind,'preflight');
assert.equal(firstPhase.readyAt,first.departure+15*MIN);
assert.ok(firstPhase.tasks.every(task=>task.progress>=0&&task.progress<=1));
assert.ok(firstPhase.tasks.some(task=>task.delayed));
assert.ok(firstPhase.tasks.every(task=>Array.isArray(task.dependencies)));

const previous={id:'AS0',from:'AMS',to:'FRA',departure:now-2*60*MIN,operationalDestination:'FRA'};
const turn=AeroGroundOperations.departurePhase({
  flight:{...first,id:'AS2',departure:now+30*MIN,handlingDelayMin:0},
  aircraft,previousFlight:previous,previousArrival:now,minimumTurnMin:40,now:now+20*MIN
});
assert.equal(turn.kind,'turnaround');
assert.equal(turn.readyAt,now+40*MIN);
assert.ok(turn.tasks.some(task=>task.id==='deboarding'));
assert.ok(turn.tasks.some(task=>task.id==='baggage-unload'));
const boarding=turn.tasks.find(task=>task.id==='boarding');
const cleaning=turn.tasks.find(task=>task.id==='cleaning');
assert.ok(boarding.startAt>=cleaning.endAt,'boarding must wait for cabin cleaning');

const post=AeroGroundOperations.postflightPhase({flight:first,aircraft,actualArrival:now-10*MIN,now});
assert.equal(post.kind,'postflight');
assert.ok(post.progress>0&&post.progress<1);
assert.ok(post.tasks.some(task=>task.id==='handover'));

console.log('ground operations smoke tests passed');
