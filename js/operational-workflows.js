/* Pure workflow definitions for persistent OCC case coordination. */
(function(global){
  const DEPARTMENTS={
    dispatch:{label:'Dispatch & Flight Watch',widget:'dispatch-control'},
    crew:{label:'Crew Control',widget:'crew-control'},
    maintenance:{label:'Maintenance Control',widget:'maintenance-control'},
    station:{label:'Station Operations',widget:'station-operations'}
  };

  const CANCEL_OPTION={
    id:'cancel',
    label:'Cancel flight',
    detail:'Cancel the affected flight before departure when recovery is not acceptable.'
  };
  function withCancellation(steps){
    const index=steps.findIndex(step=>['recovery_strategy','technical_strategy','authority_decision'].includes(step.kind));
    if(index<0) return steps;
    return steps.map((step,stepIndex)=>stepIndex===index
      ? {...step,options:[...(step.options||[]),{...CANCEL_OPTION}]}
      : step);
  }

  const KIND_META={
    aircraft_substitution:{eligibility:{phase:'pre_departure_unfueled'},resources:[{type:'aircraft',mode:'replacement'}]},
    crew_allocation:{resources:[{type:'crew_pool',location:'origin'}]},
    crew_augmentation:{resources:[{type:'augmented_crew',location:'origin'}]},
    stand_request:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    station_coordination:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    turnaround_expedite:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    station_recovery:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    fuel_recovery:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    security_coordination:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1},{type:'personnel',role:'customerService',location:'origin',amount:1}]},
    alternate_selection:{resources:[{type:'alternate',mode:'operational'}]},
    return_origin_selection:{resources:[{type:'alternate',mode:'return_origin'}]},
    alternate_handling:{resources:[{type:'personnel',role:'groundHandling',location:'selectedAlternate',amount:1}]},
    inbound_wait:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    authority_decision:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    flightdeck_recommendation:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    diversion_clearance:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    medical_assessment:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    medical_coordination:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    flight_watch_assessment:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    flight_watch_coordination:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    fuel_monitoring:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    performance_coordination:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    reroute_coordination:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    cabin_security_coordination:{resources:[{type:'personnel',role:'operations',location:'origin',amount:1}]},
    arrival_maintenance_check:{resources:[{type:'personnel',role:'groundHandling',location:'destination',amount:1}]},
    destination_handling:{resources:[{type:'personnel',role:'groundHandling',location:'destination',amount:1}]}
  };

  function metadataForStep(step){
    const meta=KIND_META[step.kind]||{};
    return {
      eligibility:step.eligibility||meta.eligibility||null,
      resources:step.resources||meta.resources||[]
    };
  }

  const WORKFLOWS={
    crew_sick:{classification:'incident',steps:withCancellation([
      {key:'crew-strategy',department:'crew',kind:'recovery_strategy',label:'Choose crew recovery',detail:'Select the viable crew recovery path for this duty.',options:[
        {id:'replace',label:'Use local replacement crew',detail:'Reserve a legal, qualified crew member already at the operating airport.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must travel, report, and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    mel_defect:{classification:'incident',steps:withCancellation([
      {key:'mx-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect reported defect',detail:'Assign an engineering inspection before choosing a technical disposition.'},
      {key:'mx-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose ground technical recovery',detail:'Select whether to defer under MEL, repair, or substitute aircraft.',dependsOn:['mx-inspect'],options:[
        {id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},
        {id:'repair',label:'Repair aircraft',detail:'Ground the aircraft for engineering sign-off.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-defer',department:'maintenance',kind:'maintenance_defer',label:'Defer defect under MEL',detail:'Document restrictions and confirm the aircraft can continue under MEL.',dependsOn:['mx-strategy'],branch:'defer'},
      {key:'mx-repair',department:'maintenance',kind:'maintenance_repair',label:'Repair aircraft',detail:'Ground the aircraft while engineering completes the repair and signs it off.',dependsOn:['mx-strategy'],branch:'repair'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare at origin or position one in before departure.',dependsOn:['mx-strategy'],branch:'substitute'},
    ])},
    atc_restriction:{classification:'constraint',steps:withCancellation([
      {key:'dispatch-flow-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose ATC recovery',detail:'Select whether to accept the regulation or request an earlier opportunity.',options:[
        {id:'accept',label:'Accept assigned CTOT',detail:'Use the regulated departure slot and plan the delay.'},
        {id:'priority',label:'Request earlier opportunity',detail:'Ask flow management for a better regulated slot.'}
      ]},
    ])},
    night_curfew_conflict:{classification:'derived',steps:withCancellation([
      {key:'dispatch-night-curfew-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose night-curfew recovery',detail:'A delay now conflicts with an airport night curfew. Decide whether to protect the flight after reopening or cancel before departure.',options:[
        {id:'reschedule_after_curfew',label:'Reschedule after curfew',detail:'Publish the first feasible departure after the airport reopens.'}
      ]},
    ])},
    gate_conflict:{classification:'constraint',steps:withCancellation([
      {key:'station-stand-strategy',department:'station',kind:'recovery_strategy',label:'Choose stand recovery',detail:'Select the practical stand or gate recovery path.',options:[
        {id:'remote',label:'Use remote stand',detail:'Accept remote parking and passenger bussing.'},
        {id:'tow',label:'Tow to replacement gate',detail:'Use another gate with a towing movement.'},
        {id:'wait_gate',label:'Wait for planned gate',detail:'Hold until the planned gate is released.'}
      ]},
    ])},
    destination_closure:{classification:'incident',steps:[
      {key:'dispatch-diversion-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess destination closure',detail:'Build the fuel, weather, alternate, and return-to-origin picture for the flight deck.'},
      {key:'dispatch-flightdeck-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck diversion plan',detail:'After OCC provides the operating picture, record the captain/ATC plan and coordinate the required support.',dependsOn:['dispatch-diversion-assess'],action:'flightdeck',options:[
        {id:'alternate',label:'Record alternate request',detail:'Flight deck requests an alternate; OCC chooses and coordinates a suitable airport.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, weather, ATC, and handling for origin.'}
      ]},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate operational alternate',detail:'Choose a suitable alternate using fuel, weather, distance, and handling information.',dependsOn:['dispatch-flightdeck-decision'],branch:'alternate'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-flightdeck-decision'],branch:'return_origin'},
    ]},
    destination_closure_ground:{classification:'incident',steps:withCancellation([
      {key:'dispatch-ground-destination-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose destination-closure recovery',detail:'The aircraft is still on the ground, so OCC decides whether to wait, retime, use another destination, or cancel.',options:[
        {id:'delay_reopen',label:'Delay until destination reopens',detail:'Hold the departure until the destination can accept the flight.'},
        {id:'alternate_destination',label:'Use alternate destination',detail:'Operate to a suitable alternate destination if the commercial and operational plan allows it.'}
      ]},
      {key:'dispatch-destination-hold',department:'dispatch',kind:'inbound_wait',label:'Publish destination-closure delay',detail:'Retain the flight on the ground until destination availability is expected to recover.',dependsOn:['dispatch-ground-destination-strategy'],branch:'delay_reopen',action:'wait_destination_reopen'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate alternate destination',detail:'Choose a suitable airport with range, weather, and handling resources before departure.',dependsOn:['dispatch-ground-destination-strategy'],branch:'alternate_destination'},
    ])},
    aircraft_out_of_position:{classification:'derived',steps:withCancellation([
      {key:'dispatch-position-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose aircraft positioning recovery',detail:'Select whether to create a positioning ferry or protect the flight with another aircraft.',options:[
        {id:'position_ferry',label:'Create positioning ferry',detail:'Manually schedule a ferry / positioning leg that brings the assigned aircraft to the planned origin.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft at the operating airport.'}
      ]},
      {key:'dispatch-plan-ferry',department:'dispatch',kind:'manual_ferry_required',label:'Plan positioning ferry',detail:'Create the ferry movement in Dispatch & slots, then return here to confirm the aircraft is projected at origin.',dependsOn:['dispatch-position-strategy'],branch:'position_ferry',action:'check_ferry'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before the disrupted departure.',dependsOn:['dispatch-position-strategy'],branch:'substitute'},
    ])},
    postflight_technical_defect:{classification:'derived',steps:withCancellation([
      {key:'mx-postflight-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect inbound aircraft',detail:'Engineering checks the aircraft after the previous sector before releasing it for the next departure.'},
      {key:'mx-postflight-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose post-flight technical recovery',detail:'Select whether to defer the finding, repair the aircraft, or substitute aircraft.',dependsOn:['mx-postflight-inspect'],options:[
        {id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions if the finding is deferrable.'},
        {id:'repair',label:'Repair before departure',detail:'Hold the aircraft for engineering repair and sign-off.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-postflight-defer',department:'maintenance',kind:'maintenance_defer',label:'Defer post-flight finding',detail:'Document restrictions and confirm the aircraft can operate the next sector.',dependsOn:['mx-postflight-strategy'],branch:'defer'},
      {key:'mx-postflight-repair',department:'maintenance',kind:'maintenance_repair',label:'Repair inbound aircraft',detail:'Hold the aircraft while engineering completes the repair.',dependsOn:['mx-postflight-strategy'],branch:'repair'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before departure.',dependsOn:['mx-postflight-strategy'],branch:'substitute'},
    ])},
    crew_misconnect:{classification:'derived',steps:withCancellation([
      {key:'crew-misconnect-strategy',department:'crew',kind:'recovery_strategy',label:'Choose crew misconnect recovery',detail:'Select whether to wait for the positioned crew or use local replacement crew.',options:[
        {id:'wait_crew',label:'Wait for connecting crew',detail:'Accept the crew transfer ETA and publish the revised departure.'},
        {id:'replace',label:'Use local replacement crew',detail:'Allocate a legal qualified crew member already at the departure station.'}
      ]},
      {key:'crew-wait-connect',department:'crew',kind:'inbound_wait',label:'Accept crew connection ETA',detail:'Use the crew transfer arrival and reporting time as the operating plan.',dependsOn:['crew-misconnect-strategy'],branch:'wait_crew',action:'wait_crew'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal qualified local pool and reserve it for the duty.',dependsOn:['crew-misconnect-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    crew_duty_risk:{classification:'derived',steps:withCancellation([
      {key:'crew-duty-strategy',department:'crew',kind:'recovery_strategy',label:'Choose duty recovery',detail:'Select a legal crew recovery before the duty limit is exceeded.',options:[
        {id:'augment',label:'Assign augmented crew',detail:'Add a relief crew set if local qualified personnel are available.'},
        {id:'replace',label:'Use local replacement crew',detail:'Replace the duty with a legal qualified crew at the operating airport.'}
      ]},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Assign augmented crew',detail:'Reserve additional flight and cabin crew to extend the legal duty envelope.',dependsOn:['crew-duty-strategy'],branch:'augment'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-duty-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must travel, report, and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    crew_fatigue_report:{classification:'incident',steps:withCancellation([
      {key:'crew-fatigue-strategy',department:'crew',kind:'recovery_strategy',label:'Choose fatigue recovery',detail:'Select a crew-control response to a fatigue report before departure.',options:[
        {id:'replace',label:'Replace reporting crew member',detail:'Reserve a legal qualified crew member already at the operating airport.'},
        {id:'augment',label:'Assign augmented crew',detail:'Add extra crew where the duty can remain legal with augmentation.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-fatigue-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Assign augmented crew',detail:'Reserve additional flight and cabin crew for this sector.',dependsOn:['crew-fatigue-strategy'],branch:'augment'},
    ])},
    crew_fatigue_mid_rotation:{classification:'derived',steps:withCancellation([
      {key:'crew-fatigue-strategy',department:'crew',kind:'recovery_strategy',label:'Choose mid-rotation fatigue recovery',detail:'Select a crew-control response when the current duty margin is too thin for the remaining sector.',options:[
        {id:'replace',label:'Swap crew for next sector',detail:'Replace the operating crew at the departure station before continuing the rotation.'},
        {id:'augment',label:'Assign augmented crew',detail:'Add extra crew where the duty can remain legal with augmentation.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.',dependsOn:['crew-fatigue-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Assign augmented crew',detail:'Reserve additional flight and cabin crew for this sector.',dependsOn:['crew-fatigue-strategy'],branch:'augment'},
    ])},
    no_legal_crew:{classification:'derived',steps:withCancellation([
      {key:'crew-legal-strategy',department:'crew',kind:'recovery_strategy',label:'Choose legal crew recovery',detail:'Select how to recover the flight when no complete legal qualified crew is locally available.',options:[
        {id:'confirm',label:'Confirm legal crew available',detail:'Use this after the required crew has been moved or requested into the departure station.'}
      ]},
    ])},
    baggage_loading_issue:{classification:'station',steps:withCancellation([
      {key:'station-baggage-strategy',department:'station',kind:'recovery_strategy',label:'Choose load-control recovery',detail:'Select a station plan only when baggage trouble affects load closeout or departure readiness.',options:[
        {id:'expedite',label:'Expedite load closeout',detail:'Assign priority ramp resources and accept a small closeout delay.'},
        {id:'reload',label:'Reload and reissue loadsheet',detail:'Rebuild the load plan when baggage reconciliation affects weight and balance.'},
        {id:'offload',label:'Offload affected bags',detail:'Depart with selected bags offloaded and protect the passenger operation.'}
      ]},
      {key:'station-baggage-expedite',department:'station',kind:'station_recovery',label:'Expedite load closeout',detail:'Prioritize ramp staff, loading equipment, and load-control closeout.',dependsOn:['station-baggage-strategy'],branch:'expedite',action:'baggage_expedite'},
      {key:'station-baggage-reload',department:'station',kind:'station_recovery',label:'Reload and reissue loadsheet',detail:'Pause closeout while baggage is reconciled and the loadsheet is reissued.',dependsOn:['station-baggage-strategy'],branch:'reload',action:'baggage_reload'},
      {key:'station-baggage-offload',department:'station',kind:'station_recovery',label:'Offload affected bags',detail:'Coordinate offload and passenger-service follow-up.',dependsOn:['station-baggage-strategy'],branch:'offload',action:'baggage_offload'},
    ])},
    fueling_issue:{classification:'incident',steps:withCancellation([
      {key:'station-fuel-strategy',department:'station',kind:'recovery_strategy',label:'Choose fuel uplift recovery',detail:'Select how to recover a fuel supply or uplift constraint.',options:[
        {id:'priority',label:'Request priority fueling',detail:'Ask the fuel provider for priority service.'},
        {id:'wait_truck',label:'Wait for assigned truck',detail:'Accept the provider delay and update the departure plan.'},
        {id:'minimum_uplift',label:'Use minimum compliant uplift',detail:'Use the compliant dispatch fuel plan when fuel supply is constrained.'}
      ]},
      {key:'station-fuel-priority',department:'station',kind:'fuel_recovery',label:'Request priority fueling',detail:'Coordinate priority fuel-truck dispatch.',dependsOn:['station-fuel-strategy'],branch:'priority',action:'priority'},
      {key:'station-fuel-wait',department:'station',kind:'fuel_recovery',label:'Wait for assigned fuel truck',detail:'Accept the supplier queue and revised fuel completion time.',dependsOn:['station-fuel-strategy'],branch:'wait_truck',action:'wait_truck'},
      {key:'station-fuel-minimum',department:'station',kind:'fuel_recovery',label:'Confirm minimum compliant uplift',detail:'Use planned trip fuel plus reserve without discretionary uplift.',dependsOn:['station-fuel-strategy'],branch:'minimum_uplift',action:'minimum_uplift'},
    ])},
    deicing_required:{classification:'derived',steps:withCancellation([
      {key:'station-deicing-strategy',department:'station',kind:'recovery_strategy',label:'Choose deicing recovery',detail:'Select the departure-station response when snow or ice requires treatment before departure.',options:[
        {id:'deice',label:'Request deicing',detail:'Enter the deicing queue and treat the aircraft before departure.'},
        {id:'priority_deice',label:'Request priority deicing',detail:'Ask station/ramp control for an earlier deicing slot.'},
        {id:'wait_weather',label:'Wait for condition improvement',detail:'Hold the flight until deicing demand or precipitation eases.'}
      ]},
      {key:'station-deice',department:'station',kind:'station_recovery',label:'Request deicing',detail:'Coordinate deicing truck, stand access, and post-treatment release.',dependsOn:['station-deicing-strategy'],branch:'deice',action:'deice'},
      {key:'station-priority-deice',department:'station',kind:'station_recovery',label:'Request priority deicing',detail:'Coordinate an earlier deicing sequence with station and ramp control.',dependsOn:['station-deicing-strategy'],branch:'priority_deice',action:'priority_deice'},
      {key:'station-wait-weather',department:'station',kind:'station_recovery',label:'Hold for weather improvement',detail:'Keep the departure held until snow or ice exposure decreases.',dependsOn:['station-deicing-strategy'],branch:'wait_weather',action:'wait_weather'},
    ])},
    holdover_expired:{classification:'derived',steps:withCancellation([
      {key:'station-holdover-strategy',department:'station',kind:'recovery_strategy',label:'Choose holdover recovery',detail:'Select the recovery when the previous deicing holdover window has expired before takeoff.',options:[
        {id:'redeice',label:'Repeat deicing',detail:'Return to treatment before departure.'},
        {id:'wait_deice_slot',label:'Wait for deicing slot',detail:'Hold until station can repeat treatment.'}
      ]},
      {key:'station-redeice',department:'station',kind:'station_recovery',label:'Repeat deicing',detail:'Coordinate repeat treatment and a new holdover window.',dependsOn:['station-holdover-strategy'],branch:'redeice',action:'redeice'},
      {key:'station-wait-deice-slot',department:'station',kind:'station_recovery',label:'Wait for deicing slot',detail:'Accept station queueing until repeat treatment is available.',dependsOn:['station-holdover-strategy'],branch:'wait_deice_slot',action:'wait_deice_slot'},
    ])},
    airport_capacity_reduction:{classification:'derived',steps:withCancellation([
      {key:'dispatch-capacity-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose airport flow recovery',detail:'Select how to handle a temporary airport capacity reduction affecting this departure.',options:[
        {id:'accept',label:'Accept flow delay',detail:'Use the current airport sequence and plan the delay.'},
        {id:'priority',label:'Request earlier opportunity',detail:'Ask airport/flow control for a better departure opportunity.'}
      ]},
    ])},
    atc_ground_stop:{classification:'derived',steps:withCancellation([
      {key:'dispatch-groundstop-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose ground-stop recovery',detail:'Select how to handle a destination or airspace ground stop before departure.',options:[
        {id:'hold_ground',label:'Hold on ground',detail:'Keep the aircraft at the gate/stand until the ground stop releases.'},
        {id:'priority',label:'Request exemption or earlier release',detail:'Ask flow control for an earlier opportunity if the flight qualifies.'}
      ]},
    ])},
    performance_limited:{classification:'derived',steps:withCancellation([
      {key:'dispatch-performance-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose performance recovery',detail:'Select an operational plan when route, fuel, weather, or MEL limits erode dispatch performance margin.',options:[
        {id:'payload_reduce',label:'Reduce payload',detail:'Offload payload/passengers to bring the flight back inside performance margin.'},
        {id:'delay_conditions',label:'Delay for better conditions',detail:'Hold the departure until weather or runway performance improves.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign an aircraft with enough performance margin for the route.'}
      ]},
      {key:'dispatch-payload-reduce',department:'dispatch',kind:'performance_coordination',label:'Coordinate payload reduction',detail:'Coordinate payload limits with load control, station, and flight crew.',dependsOn:['dispatch-performance-strategy'],branch:'payload_reduce',action:'payload_reduce'},
      {key:'dispatch-delay-performance',department:'dispatch',kind:'performance_coordination',label:'Delay for performance window',detail:'Retain the flight until forecast operating conditions improve enough for dispatch.',dependsOn:['dispatch-performance-strategy'],branch:'delay_conditions',action:'delay_conditions'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign performance-suitable aircraft',detail:'Use a serviceable spare or borrowed aircraft with enough range/performance margin.',dependsOn:['dispatch-performance-strategy'],branch:'substitute'},
    ])},
    destination_handling_unavailable:{classification:'derived',steps:withCancellation([
      {key:'station-destination-handling-strategy',department:'station',kind:'recovery_strategy',label:'Choose destination handling recovery',detail:'Select how to protect arrival when destination station handling is unavailable.',options:[
        {id:'request_handling',label:'Request destination handling',detail:'Secure destination handling acceptance before the flight arrives.'},
        {id:'delay_departure',label:'Delay until handling is available',detail:'Hold the departure until the destination station can accept the aircraft.'},
        {id:'prepare_alternate',label:'Prepare arrival alternate',detail:'For airborne flights, prepare an alternate if destination handling cannot accept.'}
      ]},
      {key:'station-destination-handling',department:'station',kind:'destination_handling',label:'Secure destination handling',detail:'Request stand, ramp, and passenger handling acceptance at the destination.',dependsOn:['station-destination-handling-strategy'],branch:'request_handling',action:'request_handling'},
      {key:'dispatch-destination-wait',department:'dispatch',kind:'inbound_wait',label:'Publish destination-handling hold',detail:'Delay departure until destination handling can accept the aircraft.',dependsOn:['station-destination-handling-strategy'],branch:'delay_departure',action:'wait_destination_handling',eligibility:{phase:'pre_departure'}},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate handling alternate',detail:'Choose a suitable airport with handling capacity for the airborne arrival.',dependsOn:['station-destination-handling-strategy'],branch:'prepare_alternate'},
    ])},
    security_screening:{classification:'incident',steps:withCancellation([
      {key:'station-security-strategy',department:'station',kind:'recovery_strategy',label:'Choose manifest recovery',detail:'Select a response when a security irregularity affects the passenger, baggage, or manifest closeout.',options:[
        {id:'hold_screening',label:'Hold for rescreening',detail:'Keep the flight open while airport security completes checks.'},
        {id:'offload_passenger',label:'Offload affected passenger',detail:'Remove the affected passenger and baggage, then depart.'}
      ]},
      {key:'station-security-hold',department:'station',kind:'security_coordination',label:'Coordinate rescreening hold',detail:'Hold boarding and coordinate completion of security checks.',dependsOn:['station-security-strategy'],branch:'hold_screening',action:'hold_screening'},
      {key:'station-security-offload',department:'station',kind:'security_coordination',label:'Offload passenger and baggage',detail:'Coordinate passenger offload, baggage removal, and document closeout.',dependsOn:['station-security-strategy'],branch:'offload_passenger',action:'offload_passenger'},
    ])},
    bird_strike:{classification:'incident',steps:[
      {key:'dispatch-bird-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess suspected bird strike',detail:'Coordinate with the flight deck and maintenance control for aircraft status and inspection needs.'},
      {key:'dispatch-bird-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck bird-strike plan',detail:'The captain decides continuation, diversion, or return after aircraft status checks; OCC coordinates maintenance and station support.',dependsOn:['dispatch-bird-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record continuation with inspection',detail:'Flight deck continues; OCC arranges arrival inspection if systems remain normal.'},
        {id:'divert',label:'Record inspection diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport for immediate inspection.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, and handling at the departure airport.'}
      ]},
      {key:'mx-arrival-check',department:'maintenance',kind:'arrival_maintenance_check',label:'Arrange arrival inspection',detail:'Ensure receiving station can inspect the aircraft after landing.',dependsOn:['dispatch-bird-decision'],branch:'continue',action:'arrival_check'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate inspection diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-bird-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-bird-decision'],branch:'return_origin'},
    ]},
    onboard_medical:{classification:'incident',steps:[
      {key:'dispatch-medical-assess',department:'dispatch',kind:'medical_assessment',label:'Assess onboard medical case',detail:'Coordinate with the flight deck and medical advisory service.'},
      {key:'dispatch-medical-decision',department:'dispatch',kind:'authority_decision',label:'Record medical / flight deck plan',detail:'Medical advisory and the captain determine the operating plan; OCC records it and coordinates support.',dependsOn:['dispatch-medical-assess'],action:'medical',options:[
        {id:'continue',label:'Record destination continuation',detail:'Flight deck continues; OCC arranges medical assistance at planned arrival.'},
        {id:'divert',label:'Record medical diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport and medical reception.'}
      ]},
      {key:'dispatch-medical-continue',department:'dispatch',kind:'medical_coordination',label:'Coordinate destination medical meet',detail:'Arrange medical assistance on arrival and update the flight deck.',dependsOn:['dispatch-medical-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate medical diversion airport',detail:'Choose a suitable airport with fuel, weather, and handling support.',dependsOn:['dispatch-medical-decision'],branch:'divert'},
    ]},
    inflight_technical_fault:{classification:'incident',steps:[
      {key:'dispatch-tech-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess inflight technical fault',detail:'Coordinate with the flight deck and maintenance control to classify the fault.'},
      {key:'dispatch-tech-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck technical plan',detail:'The captain decides continuation or diversion after maintenance-control guidance; OCC records and supports the plan.',dependsOn:['dispatch-tech-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record monitored continuation',detail:'Flight deck continues; OCC maintains flight watch and prepares arrival maintenance.'},
        {id:'divert',label:'Record technical diversion request',detail:'Flight deck requests diversion; OCC prepares engineering and passenger handling.'}
      ]},
      {key:'dispatch-tech-monitor',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate continued flight watch',detail:'Confirm abnormal checklist status, arrival priority, and maintenance readiness at destination.',dependsOn:['dispatch-tech-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate technical diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-tech-decision'],branch:'divert'},
    ]},
    fuel_margin_low:{classification:'derived',steps:[
      {key:'dispatch-fuel-assess',department:'dispatch',kind:'fuel_monitoring',label:'Assess fuel margin',detail:'Compare projected landing fuel against dispatch reserve and current delay exposure.'},
      {key:'dispatch-fuel-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck fuel plan',detail:'The flight deck declares the fuel plan after OCC and ATC provide options; OCC coordinates the selected support.',dependsOn:['dispatch-fuel-assess'],action:'flightdeck',options:[
        {id:'conserve',label:'Record conservation plan',detail:'Flight deck accepts conservation; OCC monitors profile and landing-fuel estimate.'},
        {id:'direct',label:'Record priority / shortcut request',detail:'Flight deck requests priority or direct routing; OCC coordinates with ATC via the crew.'},
        {id:'divert',label:'Record fuel diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable fuel-protection alternate.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, weather, and handling at origin.'}
      ]},
      {key:'dispatch-fuel-conserve',department:'dispatch',kind:'fuel_monitoring',label:'Coordinate fuel-conservation profile',detail:'Coordinate a conservative speed/level plan with flight crew monitoring.',dependsOn:['dispatch-fuel-decision'],branch:'conserve',action:'conserve'},
      {key:'dispatch-fuel-direct',department:'dispatch',kind:'reroute_coordination',label:'Request ATC shortcut or priority',detail:'Coordinate a shorter route, direct routing, or arrival priority with ATC via the flight deck.',dependsOn:['dispatch-fuel-decision'],branch:'direct',action:'direct'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate fuel diversion airport',detail:'Choose a suitable airport using fuel, weather, range, and handling resources.',dependsOn:['dispatch-fuel-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-fuel-decision'],branch:'return_origin'},
    ]},
    atc_holding_fuel_conflict:{classification:'derived',steps:[
      {key:'dispatch-holding-fuel-assess',department:'dispatch',kind:'fuel_monitoring',label:'Assess holding fuel exposure',detail:'Compare assigned airborne holding against projected landing fuel and reserve.'},
      {key:'dispatch-holding-fuel-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck holding-fuel plan',detail:'The flight deck decides whether priority handling is enough or diversion is required; OCC coordinates the plan.',dependsOn:['dispatch-holding-fuel-assess'],action:'flightdeck',options:[
        {id:'direct',label:'Record priority / shortcut request',detail:'Flight deck requests priority sequencing, reduced holding, or direct routing.'},
        {id:'divert',label:'Record fuel diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable fuel-protection alternate.'}
      ]},
      {key:'dispatch-holding-fuel-direct',department:'dispatch',kind:'reroute_coordination',label:'Request priority or shortcut',detail:'Coordinate priority sequencing, reduced holding, or a direct route with ATC via the flight deck.',dependsOn:['dispatch-holding-fuel-decision'],branch:'direct',action:'direct'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate fuel-protection diversion',detail:'Choose a suitable airport using fuel, weather, range, and handling resources.',dependsOn:['dispatch-holding-fuel-decision'],branch:'divert'},
    ]},
    airborne_atc_reroute:{classification:'derived',steps:[
      {key:'dispatch-reroute-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose reroute coordination',detail:'Select the OCC response to an ATC-amended airborne route.',options:[
        {id:'accept',label:'Record amended route',detail:'Record the ATC-assigned reroute and publish the revised arrival estimate.'},
        {id:'direct',label:'Coordinate shorter-route request',detail:'Coordinate an ATC request for direct or less delay-heavy routing via the flight crew.'}
      ]},
      {key:'dispatch-reroute-accept',department:'dispatch',kind:'reroute_coordination',label:'Accept amended route',detail:'Record the reroute and update arrival and downstream planning.',dependsOn:['dispatch-reroute-strategy'],branch:'accept',action:'accept'},
      {key:'dispatch-reroute-direct',department:'dispatch',kind:'reroute_coordination',label:'Request shorter routing',detail:'Coordinate an ATC request for a shorter route or priority.',dependsOn:['dispatch-reroute-strategy'],branch:'direct',action:'direct'},
    ]},
    unruly_passenger:{classification:'incident',steps:[
      {key:'dispatch-cabin-assess',department:'dispatch',kind:'cabin_security_coordination',label:'Assess cabin security report',detail:'Coordinate with the flight deck, cabin lead, and destination security support.'},
      {key:'dispatch-cabin-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck security plan',detail:'The captain decides whether the situation is contained or requires diversion; OCC coordinates security support.',dependsOn:['dispatch-cabin-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record destination continuation',detail:'Flight deck continues; OCC arranges police/security reception at destination.'},
        {id:'divert',label:'Record security diversion request',detail:'Flight deck requests diversion; OCC prepares an airport for immediate security handover.'}
      ]},
      {key:'dispatch-cabin-continue',department:'dispatch',kind:'cabin_security_coordination',label:'Coordinate arrival security meet',detail:'Arrange destination security/law enforcement and update the flight deck.',dependsOn:['dispatch-cabin-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate security diversion airport',detail:'Choose a suitable airport with handling and security support.',dependsOn:['dispatch-cabin-decision'],branch:'divert'},
    ]},
    destination_weather_deterioration:{classification:'derived',steps:[
      {key:'dispatch-weather-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess destination weather trend',detail:'Review live weather, fuel margin, alternate suitability, and expected approach availability.'},
      {key:'dispatch-weather-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck weather plan',detail:'The captain and ATC determine whether to monitor, hold, or divert; OCC records the plan and coordinates support.',dependsOn:['dispatch-weather-assess'],action:'flightdeck',options:[
        {id:'monitor',label:'Record monitored continuation',detail:'Flight deck continues monitoring; OCC watches destination trend and updates the crew.'},
        {id:'hold',label:'Record holding plan',detail:'Flight deck/ATC plan to hold; OCC monitors fuel exposure and diversion triggers.'},
        {id:'divert',label:'Record weather diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable weather alternate.'}
      ]},
      {key:'dispatch-weather-monitor',department:'dispatch',kind:'flight_watch_coordination',label:'Monitor destination weather trend',detail:'Track destination METAR/TAF trend and approach availability.',dependsOn:['dispatch-weather-decision'],branch:'monitor',action:'monitor'},
      {key:'dispatch-weather-hold',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate destination holding plan',detail:'Coordinate holding fuel, ATC sequencing, and diversion trigger point.',dependsOn:['dispatch-weather-decision'],branch:'hold',action:'hold'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate weather alternate',detail:'Choose a suitable alternate using fuel, weather, range, and handling resources.',dependsOn:['dispatch-weather-decision'],branch:'divert'},
    ]},
    destination_below_minima:{classification:'derived',steps:[
      {key:'dispatch-minima-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess landing-minima picture',detail:'Review destination minima, fuel state, alternates, and return-to-origin feasibility.'},
      {key:'dispatch-minima-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck minima plan',detail:'The captain decides the missed-approach, holding, diversion, or return plan with ATC; OCC coordinates the result.',dependsOn:['dispatch-minima-assess'],action:'flightdeck',options:[
        {id:'hold',label:'Record holding plan',detail:'Flight deck/ATC plan to hold; OCC monitors fuel exposure and weather trend.'},
        {id:'divert',label:'Record weather diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable weather alternate.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, weather, ATC, and handling for origin.'}
      ]},
      {key:'dispatch-minima-hold',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate minima hold',detail:'Coordinate holding fuel, approach minima trend, and diversion trigger point.',dependsOn:['dispatch-minima-decision'],branch:'hold',action:'hold'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate weather alternate',detail:'Choose a suitable alternate using fuel, weather, range, and handling resources.',dependsOn:['dispatch-minima-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-minima-decision'],branch:'return_origin'},
    ]},
    alternate_unsuitable:{classification:'derived',steps:[
      {key:'dispatch-alternate-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess alternate suitability',detail:'Review destination trend, current alternate status, fuel state, and replacement alternate options.'},
      {key:'dispatch-alternate-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck alternate plan',detail:'The captain confirms whether continued flight watch is acceptable or a new plan is required.',dependsOn:['dispatch-alternate-assess'],action:'flightdeck',options:[
        {id:'reselect',label:'Record new-alternate request',detail:'Flight deck requests a new alternate; OCC chooses another suitable airport.'},
        {id:'monitor',label:'Record monitored continuation',detail:'Flight deck accepts continued monitoring; OCC keeps destination and alternate trend under watch.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, weather, ATC, and handling for origin.'}
      ]},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate new alternate',detail:'Choose a suitable alternate using fuel, weather, range, and handling resources.',dependsOn:['dispatch-alternate-decision'],branch:'reselect'},
      {key:'dispatch-alternate-monitor',department:'dispatch',kind:'flight_watch_coordination',label:'Monitor alternate picture',detail:'Track destination and alternate suitability with the flight deck.',dependsOn:['dispatch-alternate-decision'],branch:'monitor',action:'monitor'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-alternate-decision'],branch:'return_origin'},
    ]},
    diversion_airport_unavailable:{classification:'derived',steps:[
      {key:'dispatch-diversion-airport-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess diversion-airport failure',detail:'Review why the planned diversion airport is unusable and prepare updated fuel/alternate choices.'},
      {key:'dispatch-diversion-airport-decision',department:'dispatch',kind:'authority_decision',label:'Record amended diversion plan',detail:'The captain and ATC decide whether to hold, reselect, or return after OCC updates the picture.',dependsOn:['dispatch-diversion-airport-assess'],action:'flightdeck',options:[
        {id:'reselect',label:'Record new-diversion request',detail:'Flight deck requests a new diversion airport; OCC chooses another suitable airport.'},
        {id:'hold',label:'Record holding plan',detail:'Flight deck/ATC plan to hold; OCC monitors fuel and airport acceptance trend.'},
        {id:'return_origin',label:'Record return request',detail:'Flight deck requests return; OCC confirms fuel, weather, ATC, and handling for origin.'}
      ]},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate new diversion airport',detail:'Choose a suitable airport using fuel, weather, range, and handling resources.',dependsOn:['dispatch-diversion-airport-decision'],branch:'reselect'},
      {key:'dispatch-diversion-hold',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate diversion-airport hold',detail:'Coordinate holding fuel, airport acceptance trend, and next diversion trigger point.',dependsOn:['dispatch-diversion-airport-decision'],branch:'hold',action:'hold'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, and handling for a return to the departure airport.',dependsOn:['dispatch-diversion-airport-decision'],branch:'return_origin'},
    ]},
    lightning_strike:{classification:'derived',steps:[
      {key:'dispatch-lightning-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess reported lightning strike',detail:'Coordinate with flight deck and maintenance control for systems status.'},
      {key:'dispatch-lightning-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck lightning plan',detail:'The captain decides continued flight or diversion after aircraft status checks; OCC coordinates inspection support.',dependsOn:['dispatch-lightning-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record continuation with inspection',detail:'Flight deck continues; OCC arranges arrival inspection if systems remain normal.'},
        {id:'divert',label:'Record inspection diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport for immediate inspection.'}
      ]},
      {key:'mx-arrival-check',department:'maintenance',kind:'arrival_maintenance_check',label:'Arrange arrival inspection',detail:'Ensure receiving station can inspect the aircraft after landing.',dependsOn:['dispatch-lightning-decision'],branch:'continue',action:'arrival_check'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate inspection diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-lightning-decision'],branch:'divert'},
    ]},
    pressurization_issue:{classification:'incident',steps:[
      {key:'dispatch-pressure-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess pressurization issue',detail:'Coordinate with the flight deck after abnormal pressurization indications.'},
      {key:'dispatch-pressure-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck pressurization plan',detail:'The captain decides low-altitude continuation or diversion after checklist actions; OCC coordinates fuel and support.',dependsOn:['dispatch-pressure-assess'],action:'flightdeck',options:[
        {id:'continue_low',label:'Record lower-altitude continuation',detail:'Flight deck continues at lower altitude; OCC monitors fuel burn and prepares destination support.'},
        {id:'divert',label:'Record technical diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport for technical inspection.'}
      ]},
      {key:'dispatch-pressure-continue',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate lower-altitude profile',detail:'Coordinate fuel burn, ATC clearance, and arrival support for continued flight.',dependsOn:['dispatch-pressure-decision'],branch:'continue_low',action:'continue_low'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate pressurization diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-pressure-decision'],branch:'divert'},
    ]}
  };

  function taskId(incidentId,key){ return `${incidentId}:${key}`; }
  function tasksForIncident(incident){
    const workflow=WORKFLOWS[incident.type];
    if(!workflow) return [];
    return workflow.steps.map(step=>{
      const meta=metadataForStep(step);
      return {
      id:taskId(incident.id,step.key),incidentId:incident.id,flightId:incident.flightId,
      aircraftId:incident.aircraftId,department:step.department,kind:step.kind,key:step.key,
      label:step.label,detail:step.detail,dependsOn:(step.dependsOn||[]).map(key=>taskId(incident.id,key)),
      branch:step.branch||'',strategies:step.strategies||null,
      action:step.action||'',strategyOptions:step.options||null,
      eligibility:meta.eligibility,resources:meta.resources,
      automatic:Boolean(step.automatic),required:!step.optional,status:step.dependsOn?.length?'blocked':'available',
      createdAt:incident.detectedAt,startedAt:0,completesAt:0,completedAt:0,selection:null,outcome:''
    };});
  }
  function progress(task,now){
    if(task.status==='completed') return 1;
    if(!['in_progress','waiting_external'].includes(task.status)||!task.startedAt||!task.completesAt) return 0;
    return Math.max(0,Math.min(1,(now-task.startedAt)/(task.completesAt-task.startedAt)));
  }

  global.AeroOperationalWorkflows={DEPARTMENTS,WORKFLOWS,taskId,tasksForIncident,progress,KIND_META};
})(window);
