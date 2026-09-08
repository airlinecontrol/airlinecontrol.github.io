const assert=require('node:assert/strict');

global.window=global;
require('../js/operational-workflows.js');

const workflows=global.AeroOperationalWorkflows;
const assertRecordedAuthorityOptions=task=>{
  for(const option of task.strategyOptions||[]){
    if(option.id==='cancel') continue;
    assert.match(option.label,/^Record /, `${task.key} option ${option.id} should be framed as recording a flight-deck plan`);
  }
};
assert.deepEqual(Object.keys(workflows.DEPARTMENTS),['dispatch','crew','maintenance','station']);
assert.deepEqual(Object.keys(workflows.WORKFLOWS),[
  'crew_sick','mel_defect','atc_restriction','night_curfew_conflict','arrival_curfew_coordination','gate_conflict','destination_closure','destination_closure_ground',
  'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect',
  'crew_misconnect','crew_misposition_after_diversion','crew_report_delayed','crew_duty_risk','crew_fatigue_report','crew_fatigue_mid_rotation','crew_duty_extension',
  'no_legal_crew','baggage_loading_issue','fueling_issue','fuel_supplier_outage','deicing_required','deicing_capacity_collapse',
  'holdover_expired','airport_capacity_reduction','atc_ground_stop','performance_limited',
  'destination_handling_unavailable','security_screening','bird_strike','onboard_medical',
  'inflight_technical_fault','fuel_margin_low','atc_holding_fuel_conflict','airborne_atc_reroute',
  'unruly_passenger','destination_weather_deterioration','destination_below_minima',
  'diversion_airport_unavailable','lightning_strike','pressurization_issue'
]);

const tasks=workflows.tasksForIncident({id:'INC9',type:'destination_closure',flightId:'AS9',aircraftId:'AC9',detectedAt:1000});
assert.equal(tasks.length,4);
assert.equal(tasks[0].status,'available');
assert.equal(tasks[1].status,'blocked');
assert.equal(tasks[0].kind,'flight_watch_assessment');
assert.equal(tasks[1].kind,'authority_decision');
assert.deepEqual(tasks[1].strategyOptions.map(option=>option.id),['alternate','return_origin']);
assertRecordedAuthorityOptions(tasks[1]);
assert.equal(tasks.some(task=>task.kind==='dispatch_release'),false);
assert.equal(tasks.some(task=>task.kind==='flight_cancellation'),false);

const groundClosureTasks=workflows.tasksForIncident({id:'INC9B',type:'destination_closure_ground',flightId:'AS9B',aircraftId:'AC9B',detectedAt:1000});
assert.equal(groundClosureTasks.length,3);
assert.deepEqual(groundClosureTasks.find(task=>task.key==='dispatch-ground-destination-strategy').strategyOptions.map(option=>option.id),['delay_reopen','alternate_destination','cancel']);
assert.equal(groundClosureTasks.find(task=>task.key==='dispatch-destination-hold').kind,'inbound_wait');
assert.equal(groundClosureTasks.find(task=>task.key==='dispatch-alternate').branch,'alternate_destination');

const melTasks=workflows.tasksForIncident({id:'INC10',type:'mel_defect',flightId:'AS10',aircraftId:'AC10',detectedAt:1000});
assert.equal(melTasks.length,5);
assert.equal(melTasks.find(task=>task.key==='mx-strategy').kind,'recovery_strategy');
assert.equal(melTasks.find(task=>task.key==='mx-strategy').dependsOn[0],'INC10:mx-inspect');
assert.deepEqual(melTasks.find(task=>task.key==='mx-strategy').strategyOptions.map(option=>option.id),['defer','repair','substitute','cancel']);
assert.equal(melTasks.find(task=>task.kind==='aircraft_substitution').branch,'substitute');
assert.equal(melTasks.some(task=>task.kind==='flight_cancellation'),false);
assert.equal(melTasks.some(task=>task.kind==='dispatch_release'),false);

const atcTasks=workflows.tasksForIncident({id:'INC11',type:'atc_restriction',flightId:'AS11',aircraftId:'AC11',detectedAt:1000});
assert.deepEqual(atcTasks.find(task=>task.key==='dispatch-flow-strategy').strategyOptions.map(option=>option.id),['accept','priority','cancel']);
assert.equal(atcTasks.length,1);

const nightTasks=workflows.tasksForIncident({id:'INC11B',type:'night_curfew_conflict',flightId:'AS11B',aircraftId:'AC11B',detectedAt:1000});
assert.deepEqual(nightTasks.find(task=>task.key==='dispatch-night-curfew-strategy').strategyOptions.map(option=>option.id),['change_departure','cancel']);
assert.equal(nightTasks.find(task=>task.key==='dispatch-night-departure-change').kind,'manual_departure_change_required');

const gateTasks=workflows.tasksForIncident({id:'INC12',type:'gate_conflict',flightId:'AS12',aircraftId:'AC12',detectedAt:1000});
assert.deepEqual(gateTasks.find(task=>task.key==='station-stand-strategy').strategyOptions.map(option=>option.id),['remote','tow','wait_gate','cancel']);
assert.equal(gateTasks.length,1);

const crewTasks=workflows.tasksForIncident({id:'INC13',type:'crew_sick',flightId:'AS13',aircraftId:'AC13',detectedAt:1000});
assert.equal(crewTasks.find(task=>task.key==='crew-strategy').kind,'recovery_strategy');
assert.equal(crewTasks.find(task=>task.key==='crew-allocate').branch,'replace');

assert.equal(workflows.tasksForIncident({id:'INC14',type:'aircraft_late_inbound',flightId:'AS14',aircraftId:'AC14',detectedAt:1000}).length,0);

const positionTasks=workflows.tasksForIncident({id:'INC14B',type:'aircraft_out_of_position',flightId:'AS14B',aircraftId:'AC14B',detectedAt:1000});
assert.deepEqual(positionTasks.find(task=>task.key==='dispatch-position-strategy').strategyOptions.map(option=>option.id),['position_ferry','substitute','cancel']);
assert.equal(positionTasks.find(task=>task.key==='dispatch-plan-ferry').kind,'manual_ferry_required');
assert.equal(positionTasks.find(task=>task.key==='dispatch-plan-ferry').branch,'position_ferry');
assert.equal(positionTasks.find(task=>task.kind==='aircraft_substitution').branch,'substitute');

const diversionPositionTasks=workflows.tasksForIncident({id:'INC14BD',type:'aircraft_misposition_after_diversion',flightId:'AS14BD',aircraftId:'AC14BD',detectedAt:1000});
assert.deepEqual(diversionPositionTasks.find(task=>task.key==='dispatch-position-strategy').strategyOptions.map(option=>option.id),['position_ferry','substitute','cancel']);
assert.equal(diversionPositionTasks.find(task=>task.key==='dispatch-plan-ferry').kind,'manual_ferry_required');

const postflightTasks=workflows.tasksForIncident({id:'INC14C',type:'postflight_technical_defect',flightId:'AS14C',aircraftId:'AC14C',detectedAt:1000});
assert.deepEqual(postflightTasks.find(task=>task.key==='mx-postflight-strategy').strategyOptions.map(option=>option.id),['defer','repair','substitute','cancel']);
assert.equal(postflightTasks.find(task=>task.kind==='aircraft_substitution').branch,'substitute');

const misconnectTasks=workflows.tasksForIncident({id:'INC14D',type:'crew_misconnect',flightId:'AS14D',aircraftId:'AC14D',detectedAt:1000});
assert.deepEqual(misconnectTasks.find(task=>task.key==='crew-misconnect-strategy').strategyOptions.map(option=>option.id),['wait_crew','replace','cancel']);
assert.equal(misconnectTasks.find(task=>task.key==='crew-wait-connect').kind,'inbound_wait');

const diversionCrewTasks=workflows.tasksForIncident({id:'INC14E',type:'crew_misposition_after_diversion',flightId:'AS14E',aircraftId:'AC14E',detectedAt:1000});
assert.deepEqual(diversionCrewTasks.find(task=>task.key==='crew-diversion-strategy').strategyOptions.map(option=>option.id),['move_crew','replace','wait_crew','cancel']);
assert.equal(diversionCrewTasks.find(task=>task.key==='crew-move-diverted').kind,'manual_crew_move_required');

const crewReportDelayTasks=workflows.tasksForIncident({id:'INC14F',type:'crew_report_delayed',flightId:'AS14F',aircraftId:'AC14F',detectedAt:1000});
assert.deepEqual(crewReportDelayTasks.find(task=>task.key==='crew-report-delay-strategy').strategyOptions.map(option=>option.id),['wait_crew','replace','move_reserve','cancel']);
assert.equal(crewReportDelayTasks.find(task=>task.key==='crew-move-reserve').kind,'manual_crew_move_required');

const dutyTasks=workflows.tasksForIncident({id:'INC15',type:'crew_duty_risk',flightId:'AS15',aircraftId:'AC15',detectedAt:1000});
assert.deepEqual(dutyTasks.find(task=>task.key==='crew-duty-strategy').strategyOptions.map(option=>option.id),['augment','replace','cancel']);
assert.equal(dutyTasks.find(task=>task.kind==='crew_augmentation').branch,'augment');

const extensionTasks=workflows.tasksForIncident({id:'INC15A',type:'crew_duty_extension',flightId:'AS15A',aircraftId:'AC15A',detectedAt:1000});
assert.deepEqual(extensionTasks.find(task=>task.key==='crew-extension-strategy').strategyOptions.map(option=>option.id),['record_extension','priority','protect_next']);
assert.equal(extensionTasks.find(task=>task.key==='dispatch-extension-priority').kind,'reroute_coordination');
assert.equal(extensionTasks.find(task=>task.key==='crew-next-sector-replacement').kind,'crew_next_sector_replacement');
assert.equal(extensionTasks.some(task=>task.kind==='flight_cancellation'),false);

const legalCrewTasks=workflows.tasksForIncident({id:'INC15B',type:'no_legal_crew',flightId:'AS15B',aircraftId:'AC15B',detectedAt:1000});
assert.deepEqual(legalCrewTasks.find(task=>task.key==='crew-legal-strategy').strategyOptions.map(option=>option.id),['confirm','cancel']);

assert.equal(workflows.tasksForIncident({id:'INC16',type:'slot_miss_risk',flightId:'AS16',aircraftId:'AC16',detectedAt:1000}).length,0);

const deicingTasks=workflows.tasksForIncident({id:'INC16B',type:'deicing_required',flightId:'AS16B',aircraftId:'AC16B',detectedAt:1000});
assert.deepEqual(deicingTasks.find(task=>task.key==='station-deicing-strategy').strategyOptions.map(option=>option.id),['deice','priority_deice','wait_weather','cancel']);

const fuelOutageTasks=workflows.tasksForIncident({id:'INC16BA',type:'fuel_supplier_outage',flightId:'AS16BA',aircraftId:'AC16BA',detectedAt:1000});
assert.deepEqual(fuelOutageTasks.find(task=>task.key==='station-fuel-outage-strategy').strategyOptions.map(option=>option.id),['priority','wait_supply','minimum_uplift','substitute','cancel']);
assert.equal(fuelOutageTasks.find(task=>task.key==='dispatch-substitute').kind,'aircraft_substitution');

const deicingCollapseTasks=workflows.tasksForIncident({id:'INC16BB',type:'deicing_capacity_collapse',flightId:'AS16BB',aircraftId:'AC16BB',detectedAt:1000});
assert.deepEqual(deicingCollapseTasks.find(task=>task.key==='station-deicing-collapse-strategy').strategyOptions.map(option=>option.id),['join_queue','priority_deice','wait_weather','cancel']);
assert.equal(deicingCollapseTasks.find(task=>task.key==='station-deice-queue').kind,'station_recovery');

const capacityTasks=workflows.tasksForIncident({id:'INC16C',type:'airport_capacity_reduction',flightId:'AS16C',aircraftId:'AC16C',detectedAt:1000});
assert.deepEqual(capacityTasks.find(task=>task.key==='dispatch-capacity-strategy').strategyOptions.map(option=>option.id),['accept','priority','cancel']);
assert.equal(capacityTasks.length,1);

const groundStopTasks=workflows.tasksForIncident({id:'INC16D',type:'atc_ground_stop',flightId:'AS16D',aircraftId:'AC16D',detectedAt:1000});
assert.deepEqual(groundStopTasks.find(task=>task.key==='dispatch-groundstop-strategy').strategyOptions.map(option=>option.id),['hold_ground','priority','cancel']);
assert.equal(groundStopTasks.length,1);

const performanceTasks=workflows.tasksForIncident({id:'INC16E',type:'performance_limited',flightId:'AS16E',aircraftId:'AC16E',detectedAt:1000});
assert.deepEqual(performanceTasks.find(task=>task.key==='dispatch-performance-strategy').strategyOptions.map(option=>option.id),['payload_reduce','delay_conditions','substitute','cancel']);
assert.equal(performanceTasks.find(task=>task.kind==='performance_coordination').branch,'payload_reduce');

const handlingTasks=workflows.tasksForIncident({id:'INC16F',type:'destination_handling_unavailable',flightId:'AS16F',aircraftId:'AC16F',detectedAt:1000});
assert.deepEqual(handlingTasks.find(task=>task.key==='station-destination-handling-strategy').strategyOptions.map(option=>option.id),['request_handling','delay_departure','prepare_alternate','cancel']);
assert.equal(handlingTasks.find(task=>task.kind==='destination_handling').branch,'request_handling');
assert.equal(handlingTasks.some(task=>task.kind==='flightdeck_recommendation'),false);
assert.equal(handlingTasks.some(task=>task.kind==='diversion_clearance'),false);
assert.equal(handlingTasks.some(task=>task.kind==='alternate_handling'),false);

const medicalTasks=workflows.tasksForIncident({id:'INC17',type:'onboard_medical',flightId:'AS17',aircraftId:'AC17',detectedAt:1000});
assert.equal(medicalTasks.find(task=>task.key==='dispatch-medical-decision').kind,'authority_decision');
assert.deepEqual(medicalTasks.find(task=>task.key==='dispatch-medical-decision').strategyOptions.map(option=>option.id),['continue','divert']);
assertRecordedAuthorityOptions(medicalTasks.find(task=>task.key==='dispatch-medical-decision'));
assert.equal(medicalTasks.some(task=>task.kind==='flight_cancellation'),false);

const inflightTechTasks=workflows.tasksForIncident({id:'INC18',type:'inflight_technical_fault',flightId:'AS18',aircraftId:'AC18',detectedAt:1000});
assert.equal(inflightTechTasks.find(task=>task.key==='dispatch-tech-decision').kind,'authority_decision');
assert.deepEqual(inflightTechTasks.find(task=>task.key==='dispatch-tech-decision').strategyOptions.map(option=>option.id),['continue','divert']);
assertRecordedAuthorityOptions(inflightTechTasks.find(task=>task.key==='dispatch-tech-decision'));
assert.equal(inflightTechTasks.find(task=>task.key==='dispatch-alternate').branch,'divert');
assert.equal(inflightTechTasks.some(task=>task.kind==='flight_cancellation'),false);

const fuelTasks=workflows.tasksForIncident({id:'INC19',type:'fuel_margin_low',flightId:'AS19',aircraftId:'AC19',detectedAt:1000});
assert.equal(fuelTasks.find(task=>task.key==='dispatch-fuel-decision').kind,'authority_decision');
assert.deepEqual(fuelTasks.find(task=>task.key==='dispatch-fuel-decision').strategyOptions.map(option=>option.id),['conserve','direct','divert','return_origin']);
assertRecordedAuthorityOptions(fuelTasks.find(task=>task.key==='dispatch-fuel-decision'));
assert.equal(fuelTasks.find(task=>task.key==='dispatch-fuel-direct').kind,'reroute_coordination');
assert.equal(fuelTasks.find(task=>task.key==='dispatch-return-origin').kind,'return_origin_selection');

const holdingFuelTasks=workflows.tasksForIncident({id:'INC19B',type:'atc_holding_fuel_conflict',flightId:'AS19B',aircraftId:'AC19B',detectedAt:1000});
assert.equal(holdingFuelTasks.find(task=>task.key==='dispatch-holding-fuel-decision').kind,'authority_decision');
assert.deepEqual(holdingFuelTasks.find(task=>task.key==='dispatch-holding-fuel-decision').strategyOptions.map(option=>option.id),['direct','divert']);
assertRecordedAuthorityOptions(holdingFuelTasks.find(task=>task.key==='dispatch-holding-fuel-decision'));

const rerouteTasks=workflows.tasksForIncident({id:'INC20',type:'airborne_atc_reroute',flightId:'AS20',aircraftId:'AC20',detectedAt:1000});
assert.deepEqual(rerouteTasks.find(task=>task.key==='dispatch-reroute-strategy').strategyOptions.map(option=>option.id),['accept','direct']);

const cabinTasks=workflows.tasksForIncident({id:'INC21',type:'unruly_passenger',flightId:'AS21',aircraftId:'AC21',detectedAt:1000});
assert.equal(cabinTasks.find(task=>task.key==='dispatch-cabin-decision').kind,'authority_decision');
assert.deepEqual(cabinTasks.find(task=>task.key==='dispatch-cabin-decision').strategyOptions.map(option=>option.id),['continue','divert']);
assertRecordedAuthorityOptions(cabinTasks.find(task=>task.key==='dispatch-cabin-decision'));

const weatherTasks=workflows.tasksForIncident({id:'INC22',type:'destination_weather_deterioration',flightId:'AS22',aircraftId:'AC22',detectedAt:1000});
assert.equal(weatherTasks.find(task=>task.key==='dispatch-weather-decision').kind,'authority_decision');
assert.deepEqual(weatherTasks.find(task=>task.key==='dispatch-weather-decision').strategyOptions.map(option=>option.id),['monitor','hold','divert']);
assertRecordedAuthorityOptions(weatherTasks.find(task=>task.key==='dispatch-weather-decision'));

const minimaTasks=workflows.tasksForIncident({id:'INC22B',type:'destination_below_minima',flightId:'AS22B',aircraftId:'AC22B',detectedAt:1000});
assert.equal(minimaTasks.find(task=>task.key==='dispatch-minima-decision').kind,'authority_decision');
assert.deepEqual(minimaTasks.find(task=>task.key==='dispatch-minima-decision').strategyOptions.map(option=>option.id),['hold','divert','return_origin']);
assertRecordedAuthorityOptions(minimaTasks.find(task=>task.key==='dispatch-minima-decision'));

const diversionAirportTasks=workflows.tasksForIncident({id:'INC22D',type:'diversion_airport_unavailable',flightId:'AS22D',aircraftId:'AC22D',detectedAt:1000});
assert.equal(diversionAirportTasks.find(task=>task.key==='dispatch-diversion-airport-decision').kind,'authority_decision');
assert.deepEqual(diversionAirportTasks.find(task=>task.key==='dispatch-diversion-airport-decision').strategyOptions.map(option=>option.id),['reselect','hold','return_origin']);
assertRecordedAuthorityOptions(diversionAirportTasks.find(task=>task.key==='dispatch-diversion-airport-decision'));

const lightningTasks=workflows.tasksForIncident({id:'INC23',type:'lightning_strike',flightId:'AS23',aircraftId:'AC23',detectedAt:1000});
assert.equal(lightningTasks.find(task=>task.key==='dispatch-lightning-decision').kind,'authority_decision');
assert.deepEqual(lightningTasks.find(task=>task.key==='dispatch-lightning-decision').strategyOptions.map(option=>option.id),['continue','divert']);
assertRecordedAuthorityOptions(lightningTasks.find(task=>task.key==='dispatch-lightning-decision'));
assert.equal(lightningTasks.find(task=>task.kind==='arrival_maintenance_check').branch,'continue');

const birdTasks=workflows.tasksForIncident({id:'INC23B',type:'bird_strike',flightId:'AS23B',aircraftId:'AC23B',detectedAt:1000});
assert.equal(birdTasks.find(task=>task.key==='dispatch-bird-decision').kind,'authority_decision');
assert.deepEqual(birdTasks.find(task=>task.key==='dispatch-bird-decision').strategyOptions.map(option=>option.id),['continue','divert','return_origin']);
assertRecordedAuthorityOptions(birdTasks.find(task=>task.key==='dispatch-bird-decision'));
assert.equal(birdTasks.some(task=>task.kind==='maintenance_inspection'),false);
assert.equal(birdTasks.find(task=>task.kind==='arrival_maintenance_check').branch,'continue');

const pressureTasks=workflows.tasksForIncident({id:'INC24',type:'pressurization_issue',flightId:'AS24',aircraftId:'AC24',detectedAt:1000});
assert.equal(pressureTasks.find(task=>task.key==='dispatch-pressure-decision').kind,'authority_decision');
assert.deepEqual(pressureTasks.find(task=>task.key==='dispatch-pressure-decision').strategyOptions.map(option=>option.id),['continue_low','divert']);
assertRecordedAuthorityOptions(pressureTasks.find(task=>task.key==='dispatch-pressure-decision'));

assert.equal(workflows.progress({status:'in_progress',startedAt:1000,completesAt:2000},1500),.5);
assert.equal(workflows.progress({status:'completed'},1500),1);

console.log('operational workflow smoke tests passed');
