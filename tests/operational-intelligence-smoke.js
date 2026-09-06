const assert=require('node:assert/strict');

global.window=global;
require('../js/operational-intelligence.js');

const MIN=60_000,HOUR=60*MIN;
const now=new Date('2026-09-02T08:00:00Z').getTime();

const supply=AeroOperationalIntelligence.resourceAvailability({kind:'aircraft',key:'A320neo',location:'FRA',current:99,now});
assert.equal(supply.available,0);
assert.ok(supply.leadMin>=180);

const legal=AeroOperationalIntelligence.crewDutyAssessment({departure:now,arrival:now+8*HOUR,sectors:2});
const illegal=AeroOperationalIntelligence.crewDutyAssessment({departure:now,arrival:now+14*HOUR,sectors:4});
const augmented=AeroOperationalIntelligence.crewDutyAssessment({departure:now,arrival:now+14*HOUR,sectors:1,augmented:true});
assert.equal(legal.legal,true);
assert.equal(illegal.legal,false);
assert.equal(augmented.legal,true);
assert.ok(augmented.maxHours>legal.maxHours);

const flight={id:'AS1',to:'LHR',arrival:now+2*HOUR,pax:160};
const onward=[{id:'AS2',from:'LHR',to:'JFK',departure:now+2*HOUR+70*MIN}];
const connections=AeroOperationalIntelligence.connectionManifest({flight,onwardFlights:onward,actualArrival:now+2*HOUR+20*MIN,now:now+2*HOUR+25*MIN});
assert.ok(connections.total>0);
assert.equal(connections.critical,connections.total);
assert.equal(connections.missed,0);
const departedConnection=AeroOperationalIntelligence.connectionManifest({flight,onwardFlights:onward.map(item=>({...item,departureLogged:true})),actualArrival:now+2*HOUR+20*MIN,now:now+2*HOUR+75*MIN});
assert.equal(departedConnection.missed,departedConnection.total);
const tooFar=AeroOperationalIntelligence.connectionManifest({flight,onwardFlights:[{id:'AS9',from:'LHR',to:'JFK',departure:now+2*HOUR+4*HOUR}],actualArrival:now+2*HOUR});
assert.equal(tooFar.total,0);
const turnbackFlight={id:'AS10',aircraftId:'AC1',from:'FRA',to:'LHR',arrival:now+2*HOUR,pax:160};
const turnbackOnward=[
  {id:'AS11',aircraftId:'AC1',from:'LHR',to:'JFK',departure:now+2*HOUR+75*MIN},
  {id:'AS12',aircraftId:'AC2',from:'LHR',to:'FRA',departure:now+2*HOUR+75*MIN}
];
const noOwnNetworkConnection=AeroOperationalIntelligence.connectionManifest({flight:turnbackFlight,onwardFlights:turnbackOnward,actualArrival:now+2*HOUR+25*MIN});
assert.equal(noOwnNetworkConnection.total,0);
const ownNetworkConnection=AeroOperationalIntelligence.connectionManifest({
  flight:turnbackFlight,
  onwardFlights:turnbackOnward.concat({id:'AS13',aircraftId:'AC3',from:'LHR',to:'MAD',departure:now+2*HOUR+75*MIN}),
  actualArrival:now+2*HOUR+25*MIN
});
assert.ok(ownNetworkConnection.total>0);
assert.equal(ownNetworkConnection.connections[0].ownNetwork,true);

const mel=AeroOperationalIntelligence.melFinding('INC42',now);
assert.match(mel.code,/\d{2}-\d{2}/);
assert.ok(mel.expiresAt>now);

const recovery=AeroOperationalIntelligence.recoveryOptions({
  flight:{...flight,departure:now,actualDeparture:now+35*MIN,handlingDelayMin:30},
  downstreamFlights:[{departure:now+4*HOUR,actualDeparture:now+4*HOUR+20*MIN}],
  connections:{total:20,atRisk:5,missed:10},spareAvailable:true
});
assert.ok(recovery.some(plan=>plan.id==='expedite'));
assert.ok(!recovery.some(plan=>plan.id==='protect-connections'));
assert.ok(recovery.some(plan=>plan.id==='use-spare'));
assert.ok(recovery.some(plan=>plan.id==='accept-impact'));
assert.ok(!recovery.some(plan=>plan.id==='hold'||plan.id==='monitor'));
assert.ok(recovery[0].risk<=recovery.at(-1).risk);
assert.deepEqual(AeroOperationalIntelligence.recoveryOptions({
  flight:{...flight,departure:now,actualDeparture:now},downstreamFlights:[],connections:{total:0,atRisk:0,missed:0},spareAvailable:false
}),[]);

const dispatch=AeroOperationalIntelligence.dispatchBriefing({
  flight:{departure:now},crew:illegal,departureWeather:{level:'normal'},arrivalWeather:{level:'normal'},
  airport:{delayMin:0},airspace:{delayMin:0},melItems:[],incidents:[],fuelReady:true,alternate:'CDG'
});
assert.equal(dispatch.status,'hold');
assert.ok(dispatch.blocks.includes('Crew duty limit'));

const score=AeroOperationalIntelligence.scenarioScore({
  completed:[{arrival:now,actualArrival:now+10*MIN}],cancelled:[],openIncidents:[],missedConnections:0,expiredMel:0
});
assert.ok(score.score>=95);
assert.ok(score.objectives.every(item=>item.met));

console.log('operational intelligence smoke tests passed');
