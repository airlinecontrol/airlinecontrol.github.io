/* Pure workflow definitions for persistent OCC case coordination. */
(function(global){
  const DEPARTMENTS={
    dispatch:{label:'Dispatch & Flight Watch',widget:'dispatch-control'},
    crew:{label:'Crew Control',widget:'crew-control'},
    maintenance:{label:'Maintenance Control',widget:'maintenance-control'},
    station:{label:'Station Operations',widget:'station-operations'}
  };

  const CANCEL_STEP={
    key:'dispatch-cancel',department:'dispatch',kind:'flight_cancellation',
    label:'Cancel flight',detail:'Cancel the affected flight before departure when recovery is not acceptable.',
    optional:true
  };
  function withCancellation(steps){ return steps.concat({...CANCEL_STEP}); }

  const WORKFLOWS={
    crew_sick:{classification:'incident',steps:withCancellation([
      {key:'crew-strategy',department:'crew',kind:'recovery_strategy',label:'Choose crew recovery',detail:'Select the viable crew recovery path for this duty.',options:[
        {id:'replace',label:'Use local replacement crew',detail:'Reserve a legal, qualified crew member already at the operating airport.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must travel, report, and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Amend operational release',detail:'Verify the replacement crew and issue the amended release.',dependsOn:['crew-report'],strategies:['replace']}
    ])},
    mel_defect:{classification:'incident',steps:withCancellation([
      {key:'mx-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect reported defect',detail:'Assign an engineering inspection before choosing a technical disposition.'},
      {key:'mx-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose technical recovery',detail:'Select whether to defer, repair, or substitute aircraft.',dependsOn:['mx-inspect'],options:[
        {id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},
        {id:'repair',label:'Repair aircraft',detail:'Ground the aircraft for engineering sign-off.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-defer',department:'maintenance',kind:'maintenance_defer',label:'Defer defect under MEL',detail:'Document restrictions and confirm the aircraft can continue under MEL.',dependsOn:['mx-strategy'],branch:'defer'},
      {key:'mx-repair',department:'maintenance',kind:'maintenance_repair',label:'Repair aircraft',detail:'Ground the aircraft while engineering completes the repair and signs it off.',dependsOn:['mx-strategy'],branch:'repair'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare at origin or position one in before departure.',dependsOn:['mx-strategy'],branch:'substitute'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Review technical release',detail:'Confirm that the recovered plan is acceptable for this flight.',dependsOn:['mx-defer','mx-repair','dispatch-substitute'],strategies:['defer','repair','substitute']}
    ])},
    atc_restriction:{classification:'constraint',steps:withCancellation([
      {key:'dispatch-flow-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose ATC recovery',detail:'Select whether to accept the regulation or request an earlier opportunity.',options:[
        {id:'accept',label:'Accept assigned CTOT',detail:'Use the regulated departure slot and plan the delay.'},
        {id:'priority',label:'Request earlier opportunity',detail:'Ask flow management for a better regulated slot.'}
      ]},
      {key:'dispatch-flow-accept',department:'dispatch',kind:'atc_coordination',label:'Accept assigned CTOT',detail:'Accept the regulated departure time from ATC flow management.',dependsOn:['dispatch-flow-strategy'],branch:'accept',action:'accept'},
      {key:'dispatch-flow-priority',department:'dispatch',kind:'atc_coordination',label:'Request priority slot',detail:'Submit a priority request and wait for the returned opportunity.',dependsOn:['dispatch-flow-strategy'],branch:'priority',action:'priority'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Update operational release',detail:'Accept the returned ATC outcome and update the flight plan.',dependsOn:['dispatch-flow-accept','dispatch-flow-priority'],strategies:['accept','priority']}
    ])},
    gate_conflict:{classification:'constraint',steps:withCancellation([
      {key:'station-stand-strategy',department:'station',kind:'recovery_strategy',label:'Choose stand recovery',detail:'Select the practical stand or gate recovery path.',options:[
        {id:'remote',label:'Use remote stand',detail:'Accept remote parking and passenger bussing.'},
        {id:'tow',label:'Tow to replacement gate',detail:'Use another gate with a towing movement.'},
        {id:'wait_gate',label:'Wait for planned gate',detail:'Hold until the planned gate is released.'}
      ]},
      {key:'station-remote',department:'station',kind:'stand_request',label:'Request remote stand',detail:'Request a remote stand and passenger bussing from airport operations.',dependsOn:['station-stand-strategy'],branch:'remote',action:'remote'},
      {key:'station-tow',department:'station',kind:'stand_request',label:'Request tow to replacement gate',detail:'Request a replacement gate and coordinate the required tow.',dependsOn:['station-stand-strategy'],branch:'tow',action:'tow'},
      {key:'station-wait-gate',department:'station',kind:'stand_request',label:'Hold for planned gate',detail:'Keep the planned gate and coordinate a departure hold.',dependsOn:['station-stand-strategy'],branch:'wait_gate',action:'wait_gate'},
      {key:'station-coordinate',department:'station',kind:'station_coordination',label:'Coordinate ground movement',detail:'Arrange buses, towing, equipment, and handling for the allocated stand.',dependsOn:['station-remote','station-tow','station-wait-gate'],strategies:['remote','tow','wait_gate']}
    ])},
    destination_closure:{classification:'incident',steps:withCancellation([
      {key:'dispatch-diversion-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose diversion recovery',detail:'Select whether to continue to an alternate or return to origin.',options:[
        {id:'alternate',label:'Divert to alternate',detail:'Choose the best suitable airport near the destination.'},
        {id:'return_origin',label:'Return to origin',detail:'Return to the departure airport if fuel and handling allow it.'}
      ]},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate operational alternate',detail:'Choose a suitable alternate using fuel, weather, distance, and handling information.',dependsOn:['dispatch-diversion-strategy'],branch:'alternate'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-diversion-strategy'],branch:'return_origin'},
      {key:'dispatch-flightdeck',department:'dispatch',kind:'flightdeck_recommendation',label:'Send recommendation to flight deck',detail:'Transmit the recommendation for the captain’s decision.',dependsOn:['dispatch-alternate','dispatch-return-origin'],strategies:['alternate','return_origin']},
      {key:'dispatch-atc',department:'dispatch',kind:'diversion_clearance',label:'Coordinate flight-crew ATC request',detail:'Relay and monitor the flight crew’s request for diversion clearance.',dependsOn:['dispatch-flightdeck'],strategies:['alternate','return_origin']},
      {key:'station-alternate',department:'station',kind:'alternate_handling',label:'Secure destination handling',detail:'Request a stand and handling acceptance at the selected airport.',dependsOn:['dispatch-alternate','dispatch-return-origin'],strategies:['alternate','return_origin']},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Issue amended operational plan',detail:'Confirm clearance and alternate handling, then issue the amended plan.',dependsOn:['dispatch-atc','station-alternate'],strategies:['alternate','return_origin']}
    ])},
    aircraft_late_inbound:{classification:'derived',steps:withCancellation([
      {key:'dispatch-inbound-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose inbound recovery',detail:'Select whether to absorb the late inbound, recover the turn, or substitute aircraft.',options:[
        {id:'wait_inbound',label:'Wait for inbound aircraft',detail:'Keep the aircraft on the rotation and publish the revised off-block time.'},
        {id:'expedite_turn',label:'Expedite turnaround',detail:'Prioritize ground teams to recover part of the inherited delay.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft to protect the departure.'}
      ]},
      {key:'dispatch-wait-inbound',department:'dispatch',kind:'inbound_wait',label:'Accept revised inbound timing',detail:'Confirm the late arrival and minimum turn as the operating plan.',dependsOn:['dispatch-inbound-strategy'],branch:'wait_inbound',action:'wait_inbound'},
      {key:'station-expedite-turn',department:'station',kind:'turnaround_expedite',label:'Expedite turnaround',detail:'Assign priority ground resources to compress the turn where practical.',dependsOn:['dispatch-inbound-strategy'],branch:'expedite_turn',action:'expedite_turn'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before the disrupted departure.',dependsOn:['dispatch-inbound-strategy'],branch:'substitute'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Publish recovered schedule',detail:'Issue the updated operational plan for the recovered departure.',dependsOn:['dispatch-wait-inbound','station-expedite-turn','dispatch-substitute'],strategies:['wait_inbound','expedite_turn','substitute']}
    ])},
    crew_duty_risk:{classification:'derived',steps:withCancellation([
      {key:'crew-duty-strategy',department:'crew',kind:'recovery_strategy',label:'Choose duty recovery',detail:'Select a legal crew recovery before the duty limit is exceeded.',options:[
        {id:'augment',label:'Assign augmented crew',detail:'Add a relief crew set if local qualified personnel are available.'},
        {id:'replace',label:'Use local replacement crew',detail:'Replace the duty with a legal qualified crew at the operating airport.'}
      ]},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Assign augmented crew',detail:'Reserve additional flight and cabin crew to extend the legal duty envelope.',dependsOn:['crew-duty-strategy'],branch:'augment'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-duty-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must travel, report, and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Amend operational release',detail:'Verify the legal crew solution and issue the amended release.',dependsOn:['crew-augment','crew-report'],strategies:['augment','replace']}
    ])},
    crew_fatigue_report:{classification:'incident',steps:withCancellation([
      {key:'crew-fatigue-strategy',department:'crew',kind:'recovery_strategy',label:'Choose fatigue recovery',detail:'Select a crew-control response to a fatigue report before departure.',options:[
        {id:'replace',label:'Replace reporting crew member',detail:'Reserve a legal qualified crew member already at the operating airport.'},
        {id:'augment',label:'Assign augmented crew',detail:'Add extra crew where the duty can remain legal with augmentation.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-fatigue-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Assign augmented crew',detail:'Reserve additional flight and cabin crew for this sector.',dependsOn:['crew-fatigue-strategy'],branch:'augment'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Amend operational release',detail:'Verify the crew solution and issue the amended release.',dependsOn:['crew-report','crew-augment'],strategies:['replace','augment']}
    ])},
    slot_miss_risk:{classification:'derived',steps:withCancellation([
      {key:'dispatch-slot-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose slot recovery',detail:'Select how to handle the missed departure slot.',options:[
        {id:'accept_next',label:'Accept next slot',detail:'Use the next calculated airport slot and plan the delay.'},
        {id:'priority',label:'Request earlier slot',detail:'Ask flow or airport control for an earlier opportunity.'},
        {id:'expedite_turn',label:'Recover ground readiness',detail:'Prioritize the turn to try to regain part of the missed slot.'}
      ]},
      {key:'dispatch-slot-accept',department:'dispatch',kind:'slot_coordination',label:'Accept next slot',detail:'Accept the reassigned slot and publish the regulated departure.',dependsOn:['dispatch-slot-strategy'],branch:'accept_next',action:'accept_next'},
      {key:'dispatch-slot-priority',department:'dispatch',kind:'slot_coordination',label:'Request earlier slot',detail:'Request a better slot from airport or flow control.',dependsOn:['dispatch-slot-strategy'],branch:'priority',action:'priority'},
      {key:'station-expedite-turn',department:'station',kind:'turnaround_expedite',label:'Expedite ground readiness',detail:'Prioritize ground resources to recover the readiness time.',dependsOn:['dispatch-slot-strategy'],branch:'expedite_turn',action:'expedite_turn'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Update operational release',detail:'Issue the new slot and departure plan.',dependsOn:['dispatch-slot-accept','dispatch-slot-priority','station-expedite-turn'],strategies:['accept_next','priority','expedite_turn']}
    ])},
    connection_risk:{classification:'derived',steps:withCancellation([
      {key:'dispatch-connection-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose connection recovery',detail:'Select whether to protect affected passengers or accept the connection risk.',options:[
        {id:'protect',label:'Protect connections',detail:'Hold onward flights where the protection window remains operationally acceptable.'},
        {id:'accept',label:'Accept misconnect risk',detail:'Keep the current operation and accept the passenger impact.'}
      ]},
      {key:'dispatch-protect-connections',department:'dispatch',kind:'connection_protection',label:'Protect passenger connections',detail:'Hold affected onward flights within the allowed protection window.',dependsOn:['dispatch-connection-strategy'],branch:'protect',action:'protect'},
      {key:'dispatch-accept-connections',department:'dispatch',kind:'connection_protection',label:'Accept connection impact',detail:'Record the connection impact without holding onward departures.',dependsOn:['dispatch-connection-strategy'],branch:'accept',action:'accept'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Publish passenger recovery plan',detail:'Confirm the connection recovery decision.',dependsOn:['dispatch-protect-connections','dispatch-accept-connections'],strategies:['protect','accept']}
    ])},
    baggage_loading_issue:{classification:'station',steps:withCancellation([
      {key:'station-baggage-strategy',department:'station',kind:'recovery_strategy',label:'Choose load-control recovery',detail:'Select a station plan only when baggage trouble affects load closeout or release.',options:[
        {id:'expedite',label:'Expedite load closeout',detail:'Assign priority ramp resources and accept a small closeout delay.'},
        {id:'reload',label:'Reload and reissue loadsheet',detail:'Rebuild the load plan when baggage reconciliation affects weight and balance.'},
        {id:'offload',label:'Offload affected bags',detail:'Depart with selected bags offloaded and protect the passenger operation.'}
      ]},
      {key:'station-baggage-expedite',department:'station',kind:'station_recovery',label:'Expedite load closeout',detail:'Prioritize ramp staff, loading equipment, and load-control closeout.',dependsOn:['station-baggage-strategy'],branch:'expedite',action:'baggage_expedite'},
      {key:'station-baggage-reload',department:'station',kind:'station_recovery',label:'Reload and reissue loadsheet',detail:'Pause closeout while baggage is reconciled and the loadsheet is reissued.',dependsOn:['station-baggage-strategy'],branch:'reload',action:'baggage_reload'},
      {key:'station-baggage-offload',department:'station',kind:'station_recovery',label:'Offload affected bags',detail:'Coordinate offload and passenger-service follow-up.',dependsOn:['station-baggage-strategy'],branch:'offload',action:'baggage_offload'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Update load closeout',detail:'Confirm final load information and issue the amended release.',dependsOn:['station-baggage-expedite','station-baggage-reload','station-baggage-offload'],strategies:['expedite','reload','offload']}
    ])},
    fueling_issue:{classification:'incident',steps:withCancellation([
      {key:'station-fuel-strategy',department:'station',kind:'recovery_strategy',label:'Choose fuel-release recovery',detail:'Select how to recover a fuel supply, uplift, or release constraint.',options:[
        {id:'priority',label:'Request priority fueling',detail:'Ask the fuel provider for priority service.'},
        {id:'wait_truck',label:'Wait for assigned truck',detail:'Accept the provider delay and update the departure plan.'},
        {id:'minimum_uplift',label:'Use minimum compliant uplift',detail:'Use the compliant dispatch fuel plan when fuel supply is constrained.'}
      ]},
      {key:'station-fuel-priority',department:'station',kind:'fuel_recovery',label:'Request priority fueling',detail:'Coordinate priority fuel-truck dispatch.',dependsOn:['station-fuel-strategy'],branch:'priority',action:'priority'},
      {key:'station-fuel-wait',department:'station',kind:'fuel_recovery',label:'Wait for assigned fuel truck',detail:'Accept the supplier queue and revised fuel completion time.',dependsOn:['station-fuel-strategy'],branch:'wait_truck',action:'wait_truck'},
      {key:'station-fuel-minimum',department:'station',kind:'fuel_recovery',label:'Confirm minimum compliant uplift',detail:'Use planned trip fuel plus reserve without discretionary uplift.',dependsOn:['station-fuel-strategy'],branch:'minimum_uplift',action:'minimum_uplift'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Verify fuel release',detail:'Confirm fuel figures and issue the operational release.',dependsOn:['station-fuel-priority','station-fuel-wait','station-fuel-minimum'],strategies:['priority','wait_truck','minimum_uplift']}
    ])},
    security_screening:{classification:'incident',steps:withCancellation([
      {key:'station-security-strategy',department:'station',kind:'recovery_strategy',label:'Choose manifest recovery',detail:'Select a response when a security irregularity affects the passenger, baggage, or manifest closeout.',options:[
        {id:'hold_screening',label:'Hold for rescreening',detail:'Keep the flight open while airport security completes checks.'},
        {id:'offload_passenger',label:'Offload affected passenger',detail:'Remove the affected passenger and baggage, then depart.'}
      ]},
      {key:'station-security-hold',department:'station',kind:'security_coordination',label:'Coordinate rescreening hold',detail:'Hold boarding and coordinate completion of security checks.',dependsOn:['station-security-strategy'],branch:'hold_screening',action:'hold_screening'},
      {key:'station-security-offload',department:'station',kind:'security_coordination',label:'Offload passenger and baggage',detail:'Coordinate passenger offload, baggage removal, and document closeout.',dependsOn:['station-security-strategy'],branch:'offload_passenger',action:'offload_passenger'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Update passenger manifest',detail:'Confirm final passenger and baggage status in the operational release.',dependsOn:['station-security-hold','station-security-offload'],strategies:['hold_screening','offload_passenger']}
    ])},
    bird_strike:{classification:'incident',steps:withCancellation([
      {key:'mx-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect suspected bird strike',detail:'Engineering must inspect impact areas before dispatch.'},
      {key:'mx-bird-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose bird-strike recovery',detail:'Select the technical recovery after inspection.',dependsOn:['mx-inspect'],options:[
        {id:'release',label:'Release aircraft',detail:'No damage found; return the aircraft to service.'},
        {id:'repair',label:'Repair damage',detail:'Hold the aircraft for engineering repair and sign-off.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-clearance',department:'maintenance',kind:'maintenance_clearance',label:'Record no-damage clearance',detail:'Record the engineering sign-off after inspection.',dependsOn:['mx-bird-strategy'],branch:'release',action:'release'},
      {key:'mx-repair',department:'maintenance',kind:'maintenance_repair',label:'Repair aircraft',detail:'Hold the aircraft while engineering repairs strike damage.',dependsOn:['mx-bird-strategy'],branch:'repair'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft.',dependsOn:['mx-bird-strategy'],branch:'substitute'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Review technical release',detail:'Confirm the recovered technical plan and issue the release.',dependsOn:['mx-clearance','mx-repair','dispatch-substitute'],strategies:['release','repair','substitute']}
    ])},
    onboard_medical:{classification:'incident',steps:withCancellation([
      {key:'dispatch-medical-assess',department:'dispatch',kind:'medical_assessment',label:'Assess onboard medical case',detail:'Coordinate with the flight deck and medical advisory service.'},
      {key:'dispatch-medical-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose medical recovery',detail:'Select whether the flight can continue or should divert for medical support.',dependsOn:['dispatch-medical-assess'],options:[
        {id:'continue',label:'Continue with medical support',detail:'Continue to destination with medical advice and arrival assistance.'},
        {id:'divert',label:'Divert for medical support',detail:'Choose a suitable airport for medical handover.'}
      ]},
      {key:'dispatch-medical-continue',department:'dispatch',kind:'medical_coordination',label:'Coordinate destination medical meet',detail:'Arrange medical assistance on arrival and update the flight deck.',dependsOn:['dispatch-medical-strategy'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate medical diversion airport',detail:'Choose a suitable airport with fuel, weather, and handling support.',dependsOn:['dispatch-medical-strategy'],branch:'divert'},
      {key:'dispatch-flightdeck',department:'dispatch',kind:'flightdeck_recommendation',label:'Send diversion recommendation',detail:'Transmit the recommended airport for the captain’s decision.',dependsOn:['dispatch-alternate'],branch:'divert'},
      {key:'dispatch-atc',department:'dispatch',kind:'diversion_clearance',label:'Coordinate ATC request',detail:'Monitor the flight crew’s ATC diversion request.',dependsOn:['dispatch-flightdeck'],branch:'divert'},
      {key:'station-alternate',department:'station',kind:'alternate_handling',label:'Secure medical arrival handling',detail:'Request stand, handling, and medical handover support.',dependsOn:['dispatch-alternate'],branch:'divert'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Record amended flight watch plan',detail:'Confirm the medical coordination outcome.',dependsOn:['dispatch-medical-continue','dispatch-atc','station-alternate'],strategies:['continue','divert']}
    ])}
  };

  function taskId(incidentId,key){ return `${incidentId}:${key}`; }
  function tasksForIncident(incident){
    const workflow=WORKFLOWS[incident.type];
    if(!workflow) return [];
    return workflow.steps.map(step=>({
      id:taskId(incident.id,step.key),incidentId:incident.id,flightId:incident.flightId,
      aircraftId:incident.aircraftId,department:step.department,kind:step.kind,key:step.key,
      label:step.label,detail:step.detail,dependsOn:(step.dependsOn||[]).map(key=>taskId(incident.id,key)),
      branch:step.branch||'',strategies:step.strategies||null,
      action:step.action||'',strategyOptions:step.options||null,
      automatic:Boolean(step.automatic),required:!step.optional,status:step.dependsOn?.length?'blocked':'available',
      createdAt:incident.detectedAt,startedAt:0,completesAt:0,completedAt:0,selection:null,outcome:''
    }));
  }
  function progress(task,now){
    if(task.status==='completed') return 1;
    if(!['in_progress','waiting_external'].includes(task.status)||!task.startedAt||!task.completesAt) return 0;
    return Math.max(0,Math.min(1,(now-task.startedAt)/(task.completesAt-task.startedAt)));
  }

  global.AeroOperationalWorkflows={DEPARTMENTS,WORKFLOWS,taskId,tasksForIncident,progress};
})(window);
