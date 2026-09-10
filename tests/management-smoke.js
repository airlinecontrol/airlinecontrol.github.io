'use strict';

const assert=require('node:assert/strict');

global.window={};
require('../js/management.js');
const management=window.AeroManagement;

const now=Date.UTC(2026,8,1,12);
const state={
  aircraft:[{id:'AC1',tail:'D-AS01',model:'A320neo',condition:70,flightHours:620,cycles:120,acquisitionType:'lease',leaseMonthlyFee:400_000,maintenance:{lastCheckHours:0,lastCheckCycles:0,scheduled:null}}],
  flights:[
    {id:'AS1',aircraftId:'AC1',departure:now-4*management.HOUR,arrival:now-2*management.HOUR,actualArrival:now-2*management.HOUR+10*management.MIN,settled:true,cancelled:false,pax:140,load:.8,revenue:35_000,costs:24_000},
    {id:'AS2',aircraftId:'AC1',departure:now-management.HOUR,arrival:now+management.HOUR,settled:false,cancelled:true,cancelledAt:now-2*management.HOUR,pax:130,revenue:30_000,costs:22_000}
  ],
  services:[{id:'SCH1',active:true,aircraftId:'AC1',from:'FRA',to:'LHR'}],
  stats:{},management:{cycleStart:now,reviews:[]}
};

assert.equal(management.ensureState(state,now),true);
assert.equal(state.flights[0].flightType,'passenger');
assert.equal(management.aircraftFamily('A320neo'),'Airbus A320 family');
assert.equal(management.aircraftFamily('Dornier 328-100'),'Dornier 328');
assert.equal(management.aircraftFamily('DHC-8-Q400'),'Dash 8');
assert.equal(management.aircraftFamily('Saab 340B'),'Saab 340');
assert.equal(management.aircraftFamily('747-8'),'Boeing 747');

const weatherA=management.weatherAt('FRA',now);
const weatherB=management.weatherAt('FRA',now+management.HOUR);
assert.deepEqual(weatherA,weatherB,'weather must be stable inside its six-hour period');

const maintenance=management.maintenanceStatus(state.aircraft[0],now);
assert.equal(maintenance.due,true);
const plan=management.maintenancePlan(state.aircraft[0],now,'FRA',180);
const melPlan=management.maintenancePlan(state.aircraft[0],now,'FRA',180,{workType:'mel_rectification',melItems:[{category:'B',code:'32-41'}]});
const repairPlan=management.maintenancePlan(state.aircraft[0],now,'FRA',180,{workType:'urgent_repair',finding:{category:'B'}});
assert.equal(plan.workType,'scheduled_check');
assert.equal(melPlan.workType,'mel_rectification');
assert.equal(repairPlan.workType,'urgent_repair');
assert.ok(melPlan.durationHours<plan.durationHours,'MEL rectification should be shorter than a full check');
assert.ok(repairPlan.durationHours<plan.durationHours,'technical repair should be shorter than a full check');
assert.ok(melPlan.cost<plan.cost,'MEL rectification should cost less than a full check');
const beforeMelHours=state.aircraft[0].maintenance.lastCheckHours;
state.aircraft[0].maintenance.scheduled=melPlan;
assert.equal(management.processMaintenance(state,melPlan.end+1,()=>{}),true);
assert.equal(state.aircraft[0].maintenance.lastCheckHours,beforeMelHours,'MEL rectification must not reset full-check hours');
state.aircraft[0].maintenance.scheduled=plan;
const transactions=[];
assert.equal(management.processMaintenance(state,plan.end+1,(...args)=>transactions.push(args)),true);
assert.equal(transactions.length,1);
assert.equal(state.aircraft[0].maintenance.scheduled,null);
assert.ok(state.aircraft[0].condition>70);

const kpis=management.operationalKpis(state,now,30);
assert.equal(kpis.completed,1);
assert.equal(kpis.cancelled,1);
assert.equal(kpis.onTimePerformance,1);
assert.equal(kpis.completionFactor,.5);
assert.equal(Math.round(kpis.loadFactor*100),80);

const routes=management.buildRoutePortfolio({
  state,now,days:30,monthlyPayroll:100_000,
  projectService:()=>[
    {revenue:50_000,cost:30_000,pax:150,seats:180,blockHours:2},
    {revenue:45_000,cost:30_000,pax:140,seats:180,blockHours:2}
  ]
});
assert.equal(routes.length,1);
assert.equal(routes[0].directContribution,35_000);
assert.equal(routes[0].allocatedPayroll,100_000);
assert.equal(routes[0].allocatedLease,400_000);
assert.equal(routes[0].contribution,-465_000);

console.log('management smoke tests passed');
