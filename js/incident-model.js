/* Central incident model: scope, phase, options, resources, defaults, and timing metadata. */
(function(global){
  'use strict';

  const INCIDENT_TYPE_ORDER=[
    'crew_sick','mel_defect','destination_closure_ground','destination_closure',
    'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect',
    'maintenance_resource_unavailable',
    'crew_misconnect','crew_misposition_after_diversion','crew_report_delayed','no_legal_crew','crew_duty_extension',
    'atc_ground_stop','network_atc_sector_capacity','network_airspace_closure','network_convective_weather',
    'night_curfew_conflict','arrival_curfew_coordination','performance_limited','destination_handling_unavailable',
    'fuel_supplier_outage','deicing_required','deicing_capacity_collapse','security_screening','crew_fatigue_report','bird_strike'
  ];

  const INCIDENT_DEFINITIONS={
    crew_sick:{title:'Crew sick call',severity:'critical',decisionMin:30,summary:'A required operating crew member reported unavailable.'},
    mel_defect:{title:'Ground technical defect',severity:'critical',decisionMin:25,summary:'A pre-departure aircraft defect requires maintenance-control disposition.'},
    atc_restriction:{title:'ATC flow restriction',severity:'warning',decisionMin:35,summary:'Air traffic control issued a regulated departure window.'},
    destination_closure_ground:{title:'Destination closure',severity:'critical',decisionMin:35,summary:'The destination is unavailable before departure and needs an OCC operating decision.'},
    destination_closure:{title:'Destination closure',severity:'critical',decisionMin:20,summary:'The destination airport became unavailable while the flight is airborne.',allowAirborne:true,airborneOnly:true},
    aircraft_out_of_position:{title:'Aircraft out of position',severity:'critical',decisionMin:35,summary:'The assigned aircraft is not projected to be at the planned origin in time.'},
    aircraft_misposition_after_diversion:{title:'Aircraft misposition after diversion',severity:'critical',decisionMin:40,summary:'A previous diversion left the assigned aircraft away from the next planned origin.'},
    postflight_technical_defect:{title:'Post-flight technical defect',severity:'critical',decisionMin:30,summary:'The inbound aircraft needs engineering disposition before the next sector.'},
    maintenance_resource_unavailable:{title:'Maintenance resource unavailable',severity:'critical',decisionMin:45,summary:'Required aircraft maintenance is at an airport without modeled maintenance support.'},
    crew_duty_risk:{title:'Crew duty risk',severity:'critical',decisionMin:40,summary:'The planned duty is projected to exceed the crew duty envelope.'},
    crew_fatigue_report:{title:'Crew fatigue report',severity:'critical',decisionMin:30,summary:'A crew member reported fatigue or fitness concerns before departure.'},
    crew_fatigue_mid_rotation:{title:'Crew fatigue mid-rotation',severity:'critical',decisionMin:30,summary:'The active crew duty has too little margin for the remaining sector.'},
    crew_duty_extension:{title:'Crew duty extension required',severity:'warning',decisionMin:25,summary:'The airborne duty is now projected beyond the crew duty limit; OCC must coordinate support and downstream crew recovery.',allowAirborne:true,airborneOnly:true},
    crew_misconnect:{title:'Crew misconnect',severity:'critical',decisionMin:30,summary:'Positioned crew is projected to miss the report time for this departure.'},
    crew_misposition_after_diversion:{title:'Crew misposition after diversion',severity:'critical',decisionMin:35,summary:'The through crew is away from the next departure station after a diversion.'},
    crew_report_delayed:{title:'Crew report delayed',severity:'warning',decisionMin:30,summary:'The assigned operating crew is not expected to complete report and briefing on time.'},
    no_legal_crew:{title:'No legal crew for departure',severity:'critical',decisionMin:35,summary:'No complete legal qualified crew is available at the departure station.'},
    slot_miss_risk:{title:'Slot miss impact',severity:'warning',decisionMin:25,summary:'The flight is projected to miss its planned airport departure slot.'},
    fuel_supplier_outage:{title:'Fuel supplier outage',severity:'critical',decisionMin:30,summary:'The departure fuel provider has a local outage or truck shortage before departure.'},
    deicing_required:{title:'Deicing required',severity:'warning',decisionMin:35,summary:'Departure weather requires aircraft deicing before takeoff.'},
    deicing_capacity_collapse:{title:'Deicing capacity collapse',severity:'critical',decisionMin:30,summary:'Winter weather and local demand have overwhelmed the departure deicing queue.'},
    holdover_expired:{title:'Deicing holdover expired',severity:'critical',decisionMin:20,summary:'The treated aircraft exceeded its usable holdover window before takeoff.'},
    atc_ground_stop:{title:'ATC ground stop',severity:'critical',decisionMin:25,summary:'A destination or airspace ground stop prevents normal departure release.'},
    network_atc_sector_capacity:{title:'ATC sector capacity reduction',severity:'warning',decisionMin:40,maxAutoLeadMin:1440,summary:'A shared ATC sector regulation affects multiple flights crossing the same route area.',allowAirborne:true},
    network_airspace_closure:{title:'Airspace closure',severity:'critical',decisionMin:30,maxAutoLeadMin:1440,summary:'A restricted or closed airspace polygon blocks planned route corridors.',allowAirborne:true},
    network_convective_weather:{title:'Convective weather corridor',severity:'critical',decisionMin:25,maxAutoLeadMin:1440,summary:'A severe convective weather corridor affects multiple planned or airborne routings.',allowAirborne:true},
    night_curfew_conflict:{title:'Night curfew conflict',severity:'critical',decisionMin:30,summary:'A delay now pushes the flight into an airport night curfew and needs an OCC recovery decision.'},
    arrival_curfew_coordination:{title:'Arrival curfew coordination',severity:'critical',decisionMin:18,summary:'The airborne flight is projected to arrive inside a hard night curfew and needs arrival acceptance coordination.',allowAirborne:true,airborneOnly:true},
    performance_limited:{title:'Performance limited',severity:'critical',decisionMin:35,summary:'Route, fuel, weather, or MEL limits erode dispatch performance margin.'},
    destination_handling_unavailable:{title:'Destination handling unavailable',severity:'warning',decisionMin:35,summary:'The destination station cannot currently accept the arriving aircraft.',allowAirborne:true},
    security_screening:{title:'Security offload / manifest issue',severity:'critical',decisionMin:25,summary:'A security irregularity requires passenger, baggage, manifest, or departure coordination.'},
    bird_strike:{title:'Suspected bird strike',severity:'critical',decisionMin:18,summary:'The flight deck reports a suspected bird strike while airborne.',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true},
    onboard_medical:{title:'Onboard medical case',severity:'critical',decisionMin:20,summary:'The flight deck reports a medical case requiring OCC coordination.',allowAirborne:true,airborneOnly:true},
    inflight_technical_fault:{title:'Inflight technical fault',severity:'critical',decisionMin:20,summary:'The flight deck reports a technical abnormality requiring flight-watch coordination.',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true},
    fuel_margin_low:{title:'Fuel margin low',severity:'critical',decisionMin:18,summary:'Projected landing fuel is below the planned operational margin.',allowAirborne:true,airborneOnly:true},
    atc_holding_fuel_conflict:{title:'ATC holding fuel conflict',severity:'critical',decisionMin:18,summary:'Assigned airborne delay is eroding fuel margin before arrival.',allowAirborne:true,airborneOnly:true},
    airborne_atc_reroute:{title:'Airborne ATC reroute',severity:'warning',decisionMin:25,summary:'The aircraft is assigned an amended airborne route with arrival and fuel impact.',allowAirborne:true,airborneOnly:true},
    unruly_passenger:{title:'Unruly passenger',severity:'critical',decisionMin:20,summary:'Cabin crew report a disruptive passenger requiring flight deck and security coordination.',allowAirborne:true,airborneOnly:true},
    destination_below_minima:{title:'Destination below landing minima',severity:'critical',decisionMin:15,summary:'Forecast arrival weather is below practical landing minima.',allowAirborne:true,airborneOnly:true},
    alternate_unsuitable:{title:'Alternate suitability risk',severity:'warning',decisionMin:25,summary:'The available alternate picture no longer supports the current flight-watch plan.',allowAirborne:true,airborneOnly:true},
    diversion_airport_unavailable:{title:'Diversion airport unavailable',severity:'critical',decisionMin:12,summary:'The selected diversion airport can no longer accept the flight.',allowAirborne:true,airborneOnly:true},
    lightning_strike:{title:'Lightning strike',severity:'critical',decisionMin:18,summary:'The aircraft crossed convective weather and reports a possible lightning strike.',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true},
    pressurization_issue:{title:'Pressurization issue',severity:'critical',decisionMin:15,summary:'The flight deck reports abnormal pressurization requiring immediate flight-watch support.',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true}
  };

  const RETIRED_INCIDENT_TYPES=new Set([
    'slot_miss_risk','aircraft_late_inbound','alternate_unsuitable','destination_weather_deterioration','atc_restriction',
    'gate_conflict','baggage_loading_issue','fueling_issue','airport_capacity_reduction'
  ]);

  const RETIRED_INCIDENT_OUTCOMES={
    aircraft_late_inbound:'Late inbound risk is tracked directly on the schedule instead of as a standalone incident.',
    alternate_unsuitable:'Alternate suitability is tracked as a warning instead of as a standalone incident.',
    destination_weather_deterioration:'Destination weather deterioration is tracked as a warning instead of as a standalone incident.',
    atc_restriction:'ATC flow restrictions are tracked as airport-flow causes instead of standalone incidents.',
    gate_conflict:'Gate and stand pressure is tracked as station-readiness warnings unless it creates a stronger operational disruption.',
    baggage_loading_issue:'Load-control and baggage trouble is tracked as station-readiness delay context unless a security or cancellation decision is required.',
    fueling_issue:'Routine fuel uplift constraints are tracked as station-readiness warnings; supplier outages remain incidents.',
    airport_capacity_reduction:'Airport flow restrictions are tracked as warnings unless they escalate into a ground stop or another OCC decision case.',
    slot_miss_risk:'Slot risk is tracked on the schedule and as linked disruption context instead of as a standalone incident.'
  };

  const INCIDENT_DEFAULT_POLICIES={
    crew_sick:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the affected unflown flight is cancelled so an illegal crew is not dispatched.'},
    mel_defect:{mode:'cancel_after_deadline',label:'cancel',summary:'If Maintenance Control takes no action before the decision deadline, the affected unflown flight is cancelled instead of releasing an unresolved defect.'},
    destination_closure_ground:{mode:'cancel_after_deadline',label:'cancel',summary:'If Dispatch takes no action before the decision deadline, the unflown flight is cancelled instead of being held indefinitely for a closed destination.'},
    destination_closure:{mode:'flightdeck_default',label:'flight deck plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request return or diversion, but OCC must still choose and coordinate the airport before the route changes.'},
    aircraft_out_of_position:{mode:'manual_required_no_auto_fix',label:'manual required',summary:'If Dispatch takes no action, the case remains open and the flight continues to be held. The sim will not create a ferry flight or aircraft resource automatically.'},
    aircraft_misposition_after_diversion:{mode:'manual_required_no_auto_fix',label:'manual required',summary:'If Dispatch takes no action, the case remains open and the flight continues to be held. The sim will not create a recovery ferry automatically.'},
    postflight_technical_defect:{mode:'cancel_after_deadline',label:'cancel',summary:'If Maintenance Control takes no action before the decision deadline, the next unflown flight is cancelled rather than dispatching an uncleared aircraft.'},
    maintenance_resource_unavailable:{mode:'manual_required_no_auto_fix',label:'manual required',summary:'If Maintenance Control takes no action, the aircraft remains unreleased. The sim will not invent engineering support or a ferry movement automatically.'},
    crew_duty_risk:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the affected unflown flight is cancelled so the planned crew duty is not operated illegally.'},
    crew_fatigue_report:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the affected unflown flight is cancelled because the reported crew cannot be assumed fit.'},
    crew_fatigue_mid_rotation:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the remaining unflown sector is cancelled so the fatigued crew is not pushed into another leg.'},
    crew_duty_extension:{mode:'flightdeck_default',label:'record extension',summary:'If OCC does not complete the case before the deadline, the airborne duty extension is recorded for safe completion of the current flight and downstream crew recovery remains visible.'},
    crew_misconnect:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the affected unflown flight is cancelled rather than assuming a missing crew will arrive.'},
    crew_misposition_after_diversion:{mode:'manual_required_no_auto_fix',label:'manual required',summary:'If Crew Control takes no action, the case remains open and the flight continues to be held. The sim will not move crew automatically.'},
    crew_report_delayed:{mode:'accept_delay',label:'accept delay',strategy:'wait_report',delayMin:25,summary:'If Crew Control takes no action before the decision deadline, the reported crew delay is accepted and the departure is retimed to the projected crew-ready time.'},
    no_legal_crew:{mode:'cancel_after_deadline',label:'cancel',summary:'If Crew Control takes no action before the decision deadline, the affected unflown flight is cancelled because no legal crew is available at origin.'},
    fuel_supplier_outage:{mode:'cancel_after_deadline',label:'cancel',summary:'If Station Operations takes no action before the decision deadline, the unflown flight is cancelled instead of waiting indefinitely for local fuel supply recovery.'},
    deicing_required:{mode:'accept_delay',label:'accept delay',strategy:'deice',delayMin:25,summary:'If Station Operations takes no action before the decision deadline, the aircraft enters the normal deicing queue and the treatment delay is accepted.'},
    deicing_capacity_collapse:{mode:'hold_until_resolved',label:'hold',summary:'If Station Operations takes no action before the decision deadline, the flight remains held in the deicing queue. OCC must still choose whether to wait, prioritize, or cancel.'},
    holdover_expired:{mode:'hold_until_resolved',label:'hold',summary:'If Station Operations takes no action before the decision deadline, the flight remains held until repeat treatment is coordinated.'},
    atc_ground_stop:{mode:'hold_until_resolved',label:'hold',summary:'If Dispatch takes no action before the decision deadline, the aircraft remains held at origin until the ground stop is actively handled or cancelled.'},
    network_atc_sector_capacity:{mode:'hold_until_resolved',label:'hold',summary:'If Dispatch takes no network action before the deadline, affected departures remain constrained and airborne flights keep their regulated routing.'},
    network_airspace_closure:{mode:'hold_until_resolved',label:'hold',summary:'If Dispatch takes no network action before the deadline, departures remain held and airborne flights continue tactical ATC coordination without a route revision.'},
    network_convective_weather:{mode:'hold_until_resolved',label:'hold',summary:'If Dispatch takes no network action before the deadline, affected flights stay under tactical weather avoidance and departure holds remain in place.'},
    night_curfew_conflict:{mode:'cancel_after_deadline',label:'cancel',summary:'If Dispatch takes no action before the decision deadline, the affected unflown flight is cancelled rather than being moved across a night restriction automatically.'},
    arrival_curfew_coordination:{mode:'flightdeck_default',label:'coordinate arrival',summary:'If OCC does not complete the case before the deadline, the airborne curfew arrival is recorded as coordinated with airport, ATC, station, and handling acceptance.'},
    performance_limited:{mode:'cancel_after_deadline',label:'cancel',summary:'If Dispatch takes no action before the decision deadline, the affected unflown flight is cancelled because dispatch performance margin is not restored.'},
    destination_handling_unavailable:{mode:'accept_delay',label:'accept delay',strategy:'delay_departure',summary:'If Station Operations takes no action before the decision deadline, an unflown flight is held for destination handling. Airborne cases default to flight-watch coordination.'},
    security_screening:{mode:'cancel_after_deadline',label:'cancel',summary:'If Station Operations takes no action before the decision deadline, the affected unflown flight is cancelled because the manifest/security irregularity remains unresolved.'},
    bird_strike:{mode:'flightdeck_default',label:'flight deck plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request continuation, diversion, or return; OCC must still coordinate airport, ATC, and inspection support.'},
    onboard_medical:{mode:'flightdeck_default',label:'medical plan',summary:'If OCC does not complete the case before the deadline, medical advisory and the captain may request continuation, diversion, or return; OCC must still coordinate the chosen support.'},
    inflight_technical_fault:{mode:'flightdeck_default',label:'flight deck plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request continuation, diversion, or return after maintenance-control guidance; OCC must still coordinate the chosen support.'},
    fuel_margin_low:{mode:'flightdeck_default',label:'fuel plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request fuel conservation, priority routing, diversion, or return; OCC must still coordinate the chosen support.'},
    atc_holding_fuel_conflict:{mode:'flightdeck_default',label:'fuel plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request priority routing or diversion; OCC must still coordinate the chosen support.'},
    airborne_atc_reroute:{mode:'accept_delay',label:'accept reroute',strategy:'accept',summary:'If Dispatch takes no action before the decision deadline, the amended ATC route is accepted and the revised arrival estimate is published.'},
    unruly_passenger:{mode:'flightdeck_default',label:'security plan',summary:'If OCC does not complete the case before the deadline, the captain may request continuation, diversion, or return; OCC must still coordinate security support.'},
    destination_below_minima:{mode:'flightdeck_default',label:'weather plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request hold, diversion, or return using fuel, minima, and alternate information; OCC must still coordinate the chosen support.'},
    diversion_airport_unavailable:{mode:'flightdeck_default',label:'diversion plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request hold, reselect, or return; OCC must still coordinate the updated airport plan.'},
    lightning_strike:{mode:'flightdeck_default',label:'flight deck plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request continuation, diversion, or return after systems checks; OCC must still coordinate inspection support.'},
    pressurization_issue:{mode:'flightdeck_default',label:'flight deck plan',summary:'If OCC does not complete the case before the deadline, the flight deck may request lower-altitude continuation, diversion, or return; OCC must still coordinate fuel and arrival support.'}
  };

  const DERIVED_INCIDENT_TYPES=new Set([
    'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect','maintenance_resource_unavailable','crew_duty_risk',
    'crew_fatigue_mid_rotation','crew_misconnect','crew_misposition_after_diversion','no_legal_crew','crew_duty_extension',
    'deicing_required','deicing_capacity_collapse','holdover_expired','atc_ground_stop',
    'network_atc_sector_capacity','network_airspace_closure','network_convective_weather',
    'night_curfew_conflict','arrival_curfew_coordination','performance_limited',
    'destination_handling_unavailable','fuel_margin_low','atc_holding_fuel_conflict','airborne_atc_reroute',
    'destination_below_minima','diversion_airport_unavailable','lightning_strike'
  ]);

  const INCIDENT_FINALIZER_BY_TYPE={
    crew_sick:'crew_sick',
    mel_defect:'technical_defect',
    postflight_technical_defect:'technical_defect',
    maintenance_resource_unavailable:'maintenance_resource',
    atc_ground_stop:'atc_ground_stop',
    night_curfew_conflict:'night_curfew',
    arrival_curfew_coordination:'arrival_curfew',
    destination_closure:'destination_closure',
    destination_closure_ground:'ground_destination_closure',
    aircraft_out_of_position:'aircraft_position',
    aircraft_misposition_after_diversion:'aircraft_position',
    no_legal_crew:'legal_crew',
    crew_misconnect:'crew_misconnect',
    crew_misposition_after_diversion:'crew_position',
    crew_report_delayed:'crew_position',
    crew_duty_risk:'crew_duty',
    crew_fatigue_report:'crew_duty',
    crew_fatigue_mid_rotation:'crew_duty',
    crew_duty_extension:'crew_duty_extension',
    fuel_supplier_outage:'station_recovery',
    security_screening:'station_recovery',
    deicing_required:'station_recovery',
    deicing_capacity_collapse:'station_recovery',
    holdover_expired:'station_recovery',
    network_atc_sector_capacity:'network_event',
    network_airspace_closure:'network_event',
    network_convective_weather:'network_event',
    performance_limited:'performance',
    destination_handling_unavailable:'destination_handling',
    onboard_medical:'medical',
    inflight_technical_fault:'inflight_diversion',
    fuel_margin_low:'inflight_diversion',
    atc_holding_fuel_conflict:'inflight_diversion',
    unruly_passenger:'inflight_diversion',
    destination_below_minima:'inflight_diversion',
    diversion_airport_unavailable:'inflight_diversion',
    lightning_strike:'inflight_diversion',
    bird_strike:'inflight_diversion',
    pressurization_issue:'inflight_diversion',
    airborne_atc_reroute:'airborne_atc_reroute'
  };
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

  const OCC_DESK=[{type:'occ_desk',amount:1}];
  const DESTINATION_MAINTENANCE=[{type:'maintenance_support',location:'destination',amount:1}];

  const KIND_META={
    aircraft_substitution:{eligibility:{phase:'pre_departure_unfueled'},resources:[{type:'aircraft',mode:'replacement'}]},
    maintenance_check_scheduling:{resources:[]},
    mobile_maintenance_team:{resources:[]},
    manual_maintenance_ferry_required:{resources:[]},
    crew_allocation:{resources:[{type:'crew_pool',location:'origin'}]},
    manual_crew_move_required:{resources:[]},
    crew_augmentation:{resources:[{type:'augmented_crew',location:'origin'}]},
    stand_request:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    station_coordination:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    turnaround_expedite:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    station_recovery:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    fuel_recovery:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1}]},
    security_coordination:{resources:[{type:'personnel',role:'groundHandling',location:'origin',amount:1},{type:'personnel',role:'customerService',location:'origin',amount:1}]},
    alternate_selection:{resources:[{type:'alternate',mode:'operational'}]},
    return_origin_selection:{resources:[{type:'alternate',mode:'return_origin'}]},
    alternate_handling:{resources:[]},
    inbound_wait:{resources:OCC_DESK},
    authority_decision:{resources:OCC_DESK},
    flightdeck_recommendation:{resources:OCC_DESK},
    diversion_clearance:{resources:OCC_DESK},
    medical_assessment:{resources:OCC_DESK},
    medical_coordination:{resources:OCC_DESK},
    flight_watch_assessment:{resources:OCC_DESK},
    flight_watch_coordination:{resources:OCC_DESK},
    fuel_monitoring:{resources:OCC_DESK},
    performance_coordination:{resources:OCC_DESK},
    reroute_coordination:{resources:OCC_DESK},
    network_event_coordination:{resources:OCC_DESK},
    network_route_revision:{resources:OCC_DESK},
    crew_extension_record:{resources:OCC_DESK},
    cabin_security_coordination:{resources:OCC_DESK},
    arrival_maintenance_check:{resources:DESTINATION_MAINTENANCE},
    destination_handling:{resources:[]}
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
        {id:'replace',label:'Activate local reserve crew',detail:'Use a legal qualified reserve already at the operating airport.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal, qualified local pool. The reserve must still report and brief before the duty is protected.',dependsOn:['crew-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report, complete briefing, and become usable for the duty.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    mel_defect:{classification:'incident',steps:withCancellation([
      {key:'mx-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect reported defect',detail:'Assign an engineering inspection before choosing a technical disposition.'},
      {key:'mx-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose ground technical recovery',detail:'Select whether to defer under MEL, schedule a repair, or substitute aircraft.',dependsOn:['mx-inspect'],options:[
        {id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},
        {id:'schedule_check',label:'Schedule technical repair',detail:'Plan a repair window and hold the aircraft until engineering clears the defect.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-defer',department:'maintenance',kind:'maintenance_defer',label:'Defer defect under MEL',detail:'Document restrictions and confirm the aircraft can continue under MEL.',dependsOn:['mx-strategy'],branch:'defer'},
      {key:'mx-schedule-check',department:'maintenance',kind:'maintenance_check_scheduling',label:'Schedule technical repair',detail:'Choose a repair window for the affected aircraft. The aircraft remains unavailable until engineering clears the defect.',dependsOn:['mx-strategy'],branch:'schedule_check'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare at origin or position one in before departure.',dependsOn:['mx-strategy'],branch:'substitute'},
    ])},
    night_curfew_conflict:{classification:'derived',steps:withCancellation([
      {key:'dispatch-night-curfew-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose night-curfew recovery',detail:'A delay now conflicts with an airport night curfew. Decide whether to protect the flight after reopening or cancel before departure.',options:[
        {id:'change_departure',label:'Change departure in Dispatch',detail:'Use Dispatch OCC actions to manually hold the flight until the curfew conflict is clear.'}
      ]},
      {key:'dispatch-night-departure-change',department:'dispatch',kind:'manual_departure_change_required',label:'Confirm revised departure',detail:'Change the selected flight departure in Dispatch OCC actions, then confirm the updated timing no longer violates a hard curfew.',dependsOn:['dispatch-night-curfew-strategy'],branch:'change_departure'}
    ])},
    arrival_curfew_coordination:{classification:'derived',steps:[
      {key:'dispatch-arrival-curfew-coordinate',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate curfew arrival exception',detail:'The flight is already airborne and projected to arrive inside a hard night curfew. Coordinate airport, ATC, station, and handling acceptance.'}
    ]},
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
      {key:'dispatch-plan-ferry',department:'dispatch',kind:'manual_ferry_required',label:'Plan positioning ferry',detail:'Create the ferry movement in Dispatch, then return here to confirm the aircraft is projected at origin.',dependsOn:['dispatch-position-strategy'],branch:'position_ferry',action:'check_ferry'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before the disrupted departure.',dependsOn:['dispatch-position-strategy'],branch:'substitute'},
    ])},
    aircraft_misposition_after_diversion:{classification:'derived',steps:withCancellation([
      {key:'dispatch-position-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose post-diversion aircraft recovery',detail:'Select how to protect the next sector after the assigned aircraft diverted away from origin.',options:[
        {id:'position_ferry',label:'Create recovery ferry',detail:'Manually schedule a positioning leg from the diversion airport to the next origin.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft at the next origin.'}
      ]},
      {key:'dispatch-plan-ferry',department:'dispatch',kind:'manual_ferry_required',label:'Plan recovery ferry',detail:'Create the ferry movement in Dispatch, then return here to confirm the aircraft is projected at origin.',dependsOn:['dispatch-position-strategy'],branch:'position_ferry',action:'check_ferry'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before the disrupted departure.',dependsOn:['dispatch-position-strategy'],branch:'substitute'},
    ])},
    postflight_technical_defect:{classification:'derived',steps:withCancellation([
      {key:'mx-postflight-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect inbound aircraft',detail:'Engineering checks the aircraft after the previous sector before releasing it for the next departure.'},
      {key:'mx-postflight-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose post-flight technical recovery',detail:'Select whether to defer the finding, schedule a repair, or substitute aircraft.',dependsOn:['mx-postflight-inspect'],options:[
        {id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions if the finding is deferrable.'},
        {id:'schedule_check',label:'Schedule technical repair',detail:'Plan a repair window before this aircraft is released.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}
      ]},
      {key:'mx-postflight-defer',department:'maintenance',kind:'maintenance_defer',label:'Defer post-flight finding',detail:'Document restrictions and confirm the aircraft can operate the next sector.',dependsOn:['mx-postflight-strategy'],branch:'defer'},
      {key:'mx-postflight-schedule-check',department:'maintenance',kind:'maintenance_check_scheduling',label:'Schedule technical repair',detail:'Choose a repair window for the inbound aircraft and hold it until engineering clears the defect.',dependsOn:['mx-postflight-strategy'],branch:'schedule_check'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare or borrowed aircraft before departure.',dependsOn:['mx-postflight-strategy'],branch:'substitute'},
    ])},
    crew_misconnect:{classification:'derived',steps:withCancellation([
      {key:'crew-misconnect-strategy',department:'crew',kind:'recovery_strategy',label:'Choose crew misconnect recovery',detail:'Select whether to wait for the positioned crew or use local replacement crew.',options:[
        {id:'wait_crew',label:'Wait for connecting crew',detail:'Accept the crew transfer ETA and publish the revised departure.'},
        {id:'replace',label:'Activate local reserve crew',detail:'Use a legal qualified reserve already at the departure station.'}
      ]},
      {key:'crew-wait-connect',department:'crew',kind:'inbound_wait',label:'Accept crew connection ETA',detail:'Use the crew transfer arrival and reporting time as the operating plan.',dependsOn:['crew-misconnect-strategy'],branch:'wait_crew',action:'wait_crew'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal qualified local pool. The reserve must report before the flight can use that crew.',dependsOn:['crew-misconnect-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    crew_misposition_after_diversion:{classification:'derived',steps:withCancellation([
      {key:'crew-diversion-strategy',department:'crew',kind:'recovery_strategy',label:'Choose post-diversion crew recovery',detail:'Select how to recover the through crew after a diversion left them away from the next departure station.',options:[
        {id:'move_crew',label:'Move diverted crew to origin',detail:'Manually position the displaced crew to the next origin in the Personnel widget.'},
        {id:'replace',label:'Activate local reserve crew',detail:'Use a legal qualified reserve already at the departure station.'},
        {id:'wait_crew',label:'Delay for displaced crew',detail:'Accept the crew positioning ETA and publish the revised departure.'}
      ]},
      {key:'crew-move-diverted',department:'crew',kind:'manual_crew_move_required',label:'Move displaced crew',detail:'Book the personnel move, then return here once the crew is projected at the departure station.',dependsOn:['crew-diversion-strategy'],branch:'move_crew',action:'check_crew_move'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal qualified local pool. The reserve must report before the flight can use that crew.',dependsOn:['crew-diversion-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-wait-connect',department:'crew',kind:'inbound_wait',label:'Publish crew-positioning delay',detail:'Use the displaced crew movement time as the operating plan.',dependsOn:['crew-diversion-strategy'],branch:'wait_crew',action:'wait_crew'},
    ])},
    crew_report_delayed:{classification:'incident',steps:withCancellation([
      {key:'crew-report-delay-strategy',department:'crew',kind:'recovery_strategy',label:'Choose crew-report recovery',detail:'Select how Crew Control protects a departure when the assigned crew cannot complete report on time.',options:[
        {id:'wait_crew',label:'Wait for assigned crew',detail:'Accept the late report and publish the revised departure.'},
        {id:'replace',label:'Activate local reserve crew',detail:'Use a legal qualified reserve already at the departure station.'},
        {id:'move_reserve',label:'Move reserve crew to origin',detail:'Manually position qualified reserve crew from another station, then confirm local availability.'}
      ]},
      {key:'crew-wait-report',department:'crew',kind:'inbound_wait',label:'Publish crew-report delay',detail:'Use the crew report ETA as the operating plan.',dependsOn:['crew-report-delay-strategy'],branch:'wait_crew',action:'wait_crew'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal qualified local pool. The reserve must report before the flight can use that crew.',dependsOn:['crew-report-delay-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-move-reserve',department:'crew',kind:'manual_crew_move_required',label:'Move reserve crew',detail:'Book the personnel move, then return here once the reserve crew is projected at the departure station.',dependsOn:['crew-report-delay-strategy'],branch:'move_reserve',action:'check_crew_move'},
    ])},
    crew_duty_risk:{classification:'derived',steps:withCancellation([
      {key:'crew-duty-strategy',department:'crew',kind:'recovery_strategy',label:'Choose duty recovery',detail:'Select a legal crew recovery before the duty limit is exceeded.',options:[
        {id:'augment',label:'Activate augmented crew',detail:'Use additional qualified local crew if the augmented duty remains legal.'},
        {id:'replace',label:'Activate local reserve crew',detail:'Replace the duty with legal qualified reserve crew at the operating airport.'}
      ]},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Activate augmented crew',detail:'Crew Control calls the additional flight and cabin crew; they must report before the duty envelope is protected.',dependsOn:['crew-duty-strategy'],branch:'augment'},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal, qualified local pool. The reserve must report before the duty is protected.',dependsOn:['crew-duty-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to travel, report, and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
    ])},
    crew_fatigue_report:{classification:'incident',steps:withCancellation([
      {key:'crew-fatigue-strategy',department:'crew',kind:'recovery_strategy',label:'Choose fatigue recovery',detail:'Select a crew-control response to a fatigue report before departure.',options:[
        {id:'replace',label:'Activate local reserve crew',detail:'Use a legal qualified reserve already at the operating airport.'},
        {id:'augment',label:'Activate augmented crew',detail:'Use additional crew where the duty can remain legal with augmentation.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal, qualified local pool. The reserve must report before the duty is protected.',dependsOn:['crew-fatigue-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Activate augmented crew',detail:'Crew Control calls additional flight and cabin crew for this sector.',dependsOn:['crew-fatigue-strategy'],branch:'augment'},
    ])},
    crew_fatigue_mid_rotation:{classification:'derived',steps:withCancellation([
      {key:'crew-fatigue-strategy',department:'crew',kind:'recovery_strategy',label:'Choose mid-rotation fatigue recovery',detail:'Select a crew-control response when the current duty margin is too thin for the remaining sector.',options:[
        {id:'replace',label:'Activate local reserve crew',detail:'Replace the operating crew at the departure station before continuing the rotation.'},
        {id:'augment',label:'Activate augmented crew',detail:'Use additional crew where the duty can remain legal with augmentation.'}
      ]},
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Activate local reserve crew',detail:'Select a legal, qualified local pool. The reserve must report before the duty is protected.',dependsOn:['crew-fatigue-strategy'],branch:'replace'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Reserve response and briefing',detail:'Crew Control waits for the reserve to report and complete briefing.',dependsOn:['crew-allocate'],branch:'replace',automatic:true},
      {key:'crew-augment',department:'crew',kind:'crew_augmentation',label:'Activate augmented crew',detail:'Crew Control calls additional flight and cabin crew for this sector.',dependsOn:['crew-fatigue-strategy'],branch:'augment'},
    ])},
    crew_duty_extension:{classification:'derived',steps:[
      {key:'crew-extension-strategy',department:'crew',kind:'recovery_strategy',label:'Choose airborne duty response',detail:'The crew keeps operating to a safe landing; choose the OCC / Crew Control support plan for the duty overrun.',options:[
        {id:'record_extension',label:'Record duty extension',detail:'Record commander discretion / unforeseen duty extension and plan post-arrival review.'},
        {id:'priority',label:'Request priority handling',detail:'Ask Flight Watch / ATC coordination for a realistic shortcut or priority arrival opportunity.'},
        {id:'protect_next',label:'Protect next sector crew',detail:'Stand down the current crew on arrival and activate reserve crew for the next unflown sector.'}
      ]},
      {key:'crew-extension-record',department:'crew',kind:'crew_extension_record',label:'Record duty-extension plan',detail:'Crew Control records the duty extension and post-arrival review. The flight continues to safe landing.',dependsOn:['crew-extension-strategy'],branch:'record_extension',action:'record_extension'},
      {key:'dispatch-extension-priority',department:'dispatch',kind:'reroute_coordination',label:'Request priority handling',detail:'Coordinate a shorter routing or arrival-priority request via the flight deck / ATC.',dependsOn:['crew-extension-strategy'],branch:'priority',action:'direct'},
      {key:'crew-extension-record-priority',department:'crew',kind:'crew_extension_record',label:'Record duty-extension plan',detail:'Record the extension after the priority-handling reply and keep post-arrival crew review active.',dependsOn:['dispatch-extension-priority'],branch:'priority',action:'record_priority'},
      {key:'crew-next-sector-replacement',department:'crew',kind:'crew_next_sector_replacement',label:'Activate reserve for next sector',detail:'Use local reserve crew at the next departure station. If none is available, move/request crew manually first.',dependsOn:['crew-extension-strategy'],branch:'protect_next'},
      {key:'crew-extension-standdown',department:'crew',kind:'crew_extension_record',label:'Stand down current crew on arrival',detail:'Crew Control records the current crew as removed from downstream flying and requiring post-arrival rest review.',dependsOn:['crew-next-sector-replacement'],branch:'protect_next',action:'stand_down'},
    ]},
    no_legal_crew:{classification:'derived',steps:withCancellation([
      {key:'crew-legal-strategy',department:'crew',kind:'recovery_strategy',label:'Choose legal crew recovery',detail:'Select how to recover the flight when no complete legal qualified crew is locally available.',options:[
        {id:'confirm',label:'Confirm legal crew available',detail:'Use this after the required crew has been moved or requested into the departure station.'}
      ]},
    ])},
    fuel_supplier_outage:{classification:'incident',steps:withCancellation([
      {key:'station-fuel-outage-strategy',department:'station',kind:'recovery_strategy',label:'Choose fuel-supplier recovery',detail:'Select the station/OCC response when the local fuel provider cannot support normal uplift.',options:[
        {id:'priority',label:'Request priority fuel truck',detail:'Escalate the affected flight with the fuel provider or airport fuel desk.'},
        {id:'wait_supply',label:'Wait for supplier recovery',detail:'Accept the provider recovery ETA and update the departure plan.'},
        {id:'tanker_inbound',label:'Tanker fuel on inbound',detail:'Overfuel the aircraft before it reaches the disrupted station so the next sector can depart without local uplift.'},
        {id:'minimum_uplift',label:'Use minimum compliant uplift',detail:'Dispatch with legal fuel only if the supplier can provide the minimum required uplift.'},
        {id:'substitute',label:'Use already fueled replacement aircraft',detail:'Assign a serviceable aircraft that can depart without waiting for the affected aircraft uplift.'}
      ]},
      {key:'station-fuel-priority',department:'station',kind:'fuel_recovery',label:'Escalate fuel priority',detail:'Coordinate priority truck dispatch or hydrant access with the provider.',dependsOn:['station-fuel-outage-strategy'],branch:'priority',action:'fuel_outage_priority'},
      {key:'station-fuel-wait',department:'station',kind:'fuel_recovery',label:'Publish supplier recovery ETA',detail:'Accept the supplier outage recovery time as the departure driver.',dependsOn:['station-fuel-outage-strategy'],branch:'wait_supply',action:'wait_supply'},
      {key:'station-fuel-tanker',department:'station',kind:'fuel_recovery',label:'Coordinate inbound tanker fuel',detail:'Confirm the previous station can load enough fuel for this sector before the aircraft reaches the disrupted airport.',dependsOn:['station-fuel-outage-strategy'],branch:'tanker_inbound',action:'tanker_inbound'},
      {key:'station-fuel-minimum',department:'station',kind:'fuel_recovery',label:'Confirm minimum compliant uplift',detail:'Use the legal dispatch fuel plan without discretionary uplift if the provider can support it.',dependsOn:['station-fuel-outage-strategy'],branch:'minimum_uplift',action:'minimum_uplift'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign fueled replacement aircraft',detail:'Use a suitable spare or borrowed aircraft before departure.',dependsOn:['station-fuel-outage-strategy'],branch:'substitute'},
    ])},
    maintenance_resource_unavailable:{classification:'derived',steps:withCancellation([
      {key:'mx-resource-strategy',department:'maintenance',kind:'recovery_strategy',label:'Choose maintenance-resource recovery',detail:'Required engineering work is at a station without maintenance support. Choose how OCC protects the aircraft and schedule.',options:[
        {id:'send_mobile_team',label:'Send mobile maintenance team',detail:'Dispatch a mobile engineering team from the nearest capable station, then schedule the check locally after they arrive.'},
        {id:'ferry_to_maintenance',label:'Create ferry to maintenance station',detail:'Manually plan a ferry to a maintenance-capable station if the aircraft is legal to reposition.'},
        {id:'substitute',label:'Use replacement aircraft',detail:'Protect the passenger flight with a serviceable aircraft while the original aircraft remains unavailable.'}
      ]},
      {key:'mx-mobile-team',department:'maintenance',kind:'mobile_maintenance_team',label:'Send mobile maintenance team',detail:'Coordinate an engineering callout and wait until the mobile team is available at the aircraft.',dependsOn:['mx-resource-strategy'],branch:'send_mobile_team',action:'send_mobile_team'},
      {key:'dispatch-maintenance-ferry',department:'dispatch',kind:'manual_maintenance_ferry_required',label:'Plan maintenance ferry',detail:'Create a ferry movement to a maintenance-capable airport, then confirm the plan here.',dependsOn:['mx-resource-strategy'],branch:'ferry_to_maintenance',action:'check_maintenance_ferry'},
      {key:'dispatch-substitute',department:'dispatch',kind:'aircraft_substitution',label:'Assign replacement aircraft',detail:'Use a serviceable spare at origin or position one in before departure.',dependsOn:['mx-resource-strategy'],branch:'substitute'},
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
    deicing_capacity_collapse:{classification:'derived',steps:withCancellation([
      {key:'station-deicing-collapse-strategy',department:'station',kind:'recovery_strategy',label:'Choose deicing-queue recovery',detail:'Select the station/OCC response when local deicing demand overwhelms available treatment capacity.',options:[
        {id:'join_queue',label:'Join deicing queue',detail:'Accept the station queue and publish the likely departure delay.'},
        {id:'priority_deice',label:'Request priority deicing',detail:'Escalate for an earlier treatment slot where operational priority is justified.'},
        {id:'wait_weather',label:'Wait for weather improvement',detail:'Hold until precipitation or deicing demand eases.'}
      ]},
      {key:'station-deice-queue',department:'station',kind:'station_recovery',label:'Publish deicing queue time',detail:'Coordinate station queueing, stand access, and a treatment sequence.',dependsOn:['station-deicing-collapse-strategy'],branch:'join_queue',action:'deice_queue'},
      {key:'station-priority-deice',department:'station',kind:'station_recovery',label:'Request priority deicing',detail:'Coordinate an earlier deicing sequence with station and ramp control.',dependsOn:['station-deicing-collapse-strategy'],branch:'priority_deice',action:'priority_deice'},
      {key:'station-wait-weather',department:'station',kind:'station_recovery',label:'Hold for weather improvement',detail:'Keep the departure held until snow or ice exposure decreases.',dependsOn:['station-deicing-collapse-strategy'],branch:'wait_weather',action:'wait_weather'},
    ])},
    holdover_expired:{classification:'derived',steps:withCancellation([
      {key:'station-holdover-strategy',department:'station',kind:'recovery_strategy',label:'Choose holdover recovery',detail:'Select the recovery when the previous deicing holdover window has expired before takeoff.',options:[
        {id:'redeice',label:'Repeat deicing',detail:'Return to treatment before departure.'},
        {id:'wait_deice_slot',label:'Wait for deicing slot',detail:'Hold until station can repeat treatment.'}
      ]},
      {key:'station-redeice',department:'station',kind:'station_recovery',label:'Repeat deicing',detail:'Coordinate repeat treatment and a new holdover window.',dependsOn:['station-holdover-strategy'],branch:'redeice',action:'redeice'},
      {key:'station-wait-deice-slot',department:'station',kind:'station_recovery',label:'Wait for deicing slot',detail:'Accept station queueing until repeat treatment is available.',dependsOn:['station-holdover-strategy'],branch:'wait_deice_slot',action:'wait_deice_slot'},
    ])},
    atc_ground_stop:{classification:'derived',steps:withCancellation([
      {key:'dispatch-groundstop-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose ground-stop recovery',detail:'Select how to handle a destination or airspace ground stop before departure.',options:[
        {id:'hold_ground',label:'Hold on ground',detail:'Keep the aircraft at the gate/stand until the ground stop releases.'},
        {id:'priority',label:'Request exemption or earlier release',detail:'Ask flow control for an earlier opportunity if the flight qualifies.'}
      ]},
    ])},
    network_atc_sector_capacity:{classification:'derived',steps:[
      {key:'dispatch-network-atc-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose sector flow plan',detail:'A shared ATC regulation affects several flights crossing the same sector. Choose the network-level dispatch plan.',options:[
        {id:'accept_flow',label:'Accept regulated flow',detail:'Apply the published sector delay to affected flights and keep the filed routes.'},
        {id:'reroute_around',label:'Build avoidance routes',detail:'Coordinate route revisions around the constrained sector where fuel and timing make sense.'},
        {id:'hold_departures',label:'Hold crossing departures',detail:'Keep not-yet-departed affected flights on the ground while airborne flights continue tactically.'}
      ]},
      {key:'dispatch-network-atc-flow',department:'dispatch',kind:'network_event_coordination',label:'Apply sector flow plan',detail:'Publish the sector-regulation delay across affected flights and update their projected timings.',dependsOn:['dispatch-network-atc-strategy'],branch:'accept_flow',action:'accept_flow'},
      {key:'dispatch-network-atc-reroute',department:'dispatch',kind:'network_route_revision',label:'Coordinate avoidance routes',detail:'Create route revisions around the constrained sector and publish updated ETAs for affected flights.',dependsOn:['dispatch-network-atc-strategy'],branch:'reroute_around',action:'reroute_around'},
      {key:'dispatch-network-atc-hold',department:'dispatch',kind:'network_event_coordination',label:'Publish departure holds',detail:'Hold affected departures until the sector program eases; airborne flights retain tactical ATC handling.',dependsOn:['dispatch-network-atc-strategy'],branch:'hold_departures',action:'hold_departures'}
    ]},
    network_airspace_closure:{classification:'derived',steps:[
      {key:'dispatch-network-airspace-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose airspace-closure plan',detail:'A closed or restricted airspace area blocks planned routings. Choose a shared recovery plan for crossing flights.',options:[
        {id:'reroute_around',label:'Build avoidance routes',detail:'Coordinate new waypoint routes around the closed area for flights that can still use them.'},
        {id:'hold_departures',label:'Hold affected departures',detail:'Stop not-yet-departed flights from entering the area until a route package or reopening is available.'}
      ]},
      {key:'dispatch-network-airspace-reroute',department:'dispatch',kind:'network_route_revision',label:'Coordinate avoidance routes',detail:'Create route revisions around the closed airspace and publish updated ETAs.',dependsOn:['dispatch-network-airspace-strategy'],branch:'reroute_around',action:'reroute_around'},
      {key:'dispatch-network-airspace-hold',department:'dispatch',kind:'network_event_coordination',label:'Publish departure holds',detail:'Ground-hold affected departures and coordinate tactical handling for airborne flights.',dependsOn:['dispatch-network-airspace-strategy'],branch:'hold_departures',action:'hold_departures'}
    ]},
    network_convective_weather:{classification:'derived',steps:[
      {key:'dispatch-network-weather-strategy',department:'dispatch',kind:'recovery_strategy',label:'Choose convective-weather plan',detail:'A severe weather corridor affects multiple routes. Choose the shared flight-watch plan.',options:[
        {id:'reroute_around',label:'Build weather avoidance routes',detail:'Coordinate route revisions around the convective area where fuel margin allows.'},
        {id:'accept_tactical',label:'Use tactical deviations',detail:'Let affected flights remain on filed routes with tactical flight-deck/ATC weather deviations.'},
        {id:'hold_departures',label:'Hold crossing departures',detail:'Delay not-yet-departed flights until the cell moves or an avoidance route is available.'}
      ]},
      {key:'dispatch-network-weather-reroute',department:'dispatch',kind:'network_route_revision',label:'Coordinate weather avoidance routes',detail:'Create route revisions around the convective corridor and publish updated ETAs.',dependsOn:['dispatch-network-weather-strategy'],branch:'reroute_around',action:'reroute_around'},
      {key:'dispatch-network-weather-tactical',department:'dispatch',kind:'network_event_coordination',label:'Coordinate tactical deviations',detail:'Record flight-deck and ATC tactical deviations and update arrival projections.',dependsOn:['dispatch-network-weather-strategy'],branch:'accept_tactical',action:'accept_tactical'},
      {key:'dispatch-network-weather-hold',department:'dispatch',kind:'network_event_coordination',label:'Publish weather holds',detail:'Hold affected departures until the convective corridor moves or clears.',dependsOn:['dispatch-network-weather-strategy'],branch:'hold_departures',action:'hold_departures'}
    ]},
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
        {id:'request_handling',label:'Request destination handling',detail:'Secure own-station or contract handling acceptance before the flight arrives.'},
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
        {id:'divert',label:'Record medical diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport and medical reception.'},
        {id:'return_origin',label:'Record medical return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, handling, and medical reception at origin.'}
      ]},
      {key:'dispatch-medical-continue',department:'dispatch',kind:'medical_coordination',label:'Coordinate destination medical meet',detail:'Arrange medical assistance on arrival and update the flight deck.',dependsOn:['dispatch-medical-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate medical diversion airport',detail:'Choose a suitable airport with fuel, weather, and handling support.',dependsOn:['dispatch-medical-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, medical reception, and handling for a return to the departure airport.',dependsOn:['dispatch-medical-decision'],branch:'return_origin'},
    ]},
    inflight_technical_fault:{classification:'incident',steps:[
      {key:'dispatch-tech-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess inflight technical fault',detail:'Coordinate with the flight deck and maintenance control to classify the fault.'},
      {key:'dispatch-tech-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck technical plan',detail:'The captain decides continuation, diversion, or return after maintenance-control guidance; OCC records and supports the plan.',dependsOn:['dispatch-tech-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record monitored continuation',detail:'Flight deck continues; OCC maintains flight watch and prepares arrival maintenance.'},
        {id:'divert',label:'Record technical diversion request',detail:'Flight deck requests diversion; OCC prepares engineering and passenger handling.'},
        {id:'return_origin',label:'Record technical return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, handling, and engineering support at origin.'}
      ]},
      {key:'dispatch-tech-monitor',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate continued flight watch',detail:'Confirm abnormal checklist status, arrival priority, and maintenance readiness at destination.',dependsOn:['dispatch-tech-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate technical diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-tech-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, handling, and maintenance support for a return to the departure airport.',dependsOn:['dispatch-tech-decision'],branch:'return_origin'},
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
      {key:'dispatch-cabin-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck security plan',detail:'The captain decides whether the situation is contained, diversion is needed, or return is requested; OCC coordinates security support.',dependsOn:['dispatch-cabin-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record destination continuation',detail:'Flight deck continues; OCC arranges police/security reception at destination.'},
        {id:'divert',label:'Record security diversion request',detail:'Flight deck requests diversion; OCC prepares an airport for immediate security handover.'},
        {id:'return_origin',label:'Record security return request',detail:'Flight deck requests return; OCC coordinates ATC, handling, and security reception at origin.'}
      ]},
      {key:'dispatch-cabin-continue',department:'dispatch',kind:'cabin_security_coordination',label:'Coordinate arrival security meet',detail:'Arrange destination security/law enforcement and update the flight deck.',dependsOn:['dispatch-cabin-decision'],branch:'continue',action:'continue'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate security diversion airport',detail:'Choose a suitable airport with handling and security support.',dependsOn:['dispatch-cabin-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, ATC, handling, and security reception at the departure airport.',dependsOn:['dispatch-cabin-decision'],branch:'return_origin'},
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
      {key:'dispatch-lightning-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck lightning plan',detail:'The captain decides continued flight, diversion, or return after aircraft status checks; OCC coordinates inspection support.',dependsOn:['dispatch-lightning-assess'],action:'flightdeck',options:[
        {id:'continue',label:'Record continuation with inspection',detail:'Flight deck continues; OCC arranges arrival inspection if systems remain normal.'},
        {id:'divert',label:'Record inspection diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport for immediate inspection.'},
        {id:'return_origin',label:'Record inspection return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, handling, and inspection support at origin.'}
      ]},
      {key:'mx-arrival-check',department:'maintenance',kind:'arrival_maintenance_check',label:'Arrange arrival inspection',detail:'Ensure receiving station can inspect the aircraft after landing.',dependsOn:['dispatch-lightning-decision'],branch:'continue',action:'arrival_check'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate inspection diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-lightning-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, handling, and inspection support for a return to the departure airport.',dependsOn:['dispatch-lightning-decision'],branch:'return_origin'},
    ]},
    pressurization_issue:{classification:'incident',steps:[
      {key:'dispatch-pressure-assess',department:'dispatch',kind:'flight_watch_assessment',label:'Assess pressurization issue',detail:'Coordinate with the flight deck after abnormal pressurization indications.'},
      {key:'dispatch-pressure-decision',department:'dispatch',kind:'authority_decision',label:'Record flight deck pressurization plan',detail:'The captain decides low-altitude continuation, diversion, or return after checklist actions; OCC coordinates fuel and support.',dependsOn:['dispatch-pressure-assess'],action:'flightdeck',options:[
        {id:'continue_low',label:'Record lower-altitude continuation',detail:'Flight deck continues at lower altitude; OCC monitors fuel burn and prepares destination support.'},
        {id:'divert',label:'Record technical diversion request',detail:'Flight deck requests diversion; OCC prepares a suitable airport for technical inspection.'},
        {id:'return_origin',label:'Record technical return request',detail:'Flight deck requests return; OCC confirms fuel, ATC, handling, and technical support at origin.'}
      ]},
      {key:'dispatch-pressure-continue',department:'dispatch',kind:'flight_watch_coordination',label:'Coordinate lower-altitude profile',detail:'Coordinate fuel burn, ATC clearance, and arrival support for continued flight.',dependsOn:['dispatch-pressure-decision'],branch:'continue_low',action:'continue_low'},
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate pressurization diversion airport',detail:'Choose a suitable airport with fuel, weather, range, and handling support.',dependsOn:['dispatch-pressure-decision'],branch:'divert'},
      {key:'dispatch-return-origin',department:'dispatch',kind:'return_origin_selection',label:'Evaluate return to origin',detail:'Confirm fuel, weather, handling, and technical support for a return to the departure airport.',dependsOn:['dispatch-pressure-decision'],branch:'return_origin'},
    ]}
  };


  const INCIDENT_SCOPE_BY_TYPE={
    crew_sick:'flight',
    mel_defect:'aircraft',
    night_curfew_conflict:'flight',
    arrival_curfew_coordination:'flight',
    destination_closure:'airport',
    destination_closure_ground:'airport',
    aircraft_out_of_position:'aircraft',
    aircraft_misposition_after_diversion:'aircraft',
    postflight_technical_defect:'aircraft',
    crew_misconnect:'flight',
    crew_misposition_after_diversion:'flight',
    crew_report_delayed:'flight',
    crew_duty_risk:'flight',
    crew_fatigue_report:'flight',
    crew_fatigue_mid_rotation:'flight',
    crew_duty_extension:'flight',
    no_legal_crew:'flight',
    fuel_supplier_outage:'airport',
    maintenance_resource_unavailable:'aircraft',
    deicing_required:'flight',
    deicing_capacity_collapse:'airport',
    holdover_expired:'flight',
    atc_ground_stop:'airport',
    network_atc_sector_capacity:'network',
    network_airspace_closure:'network',
    network_convective_weather:'network',
    performance_limited:'flight',
    destination_handling_unavailable:'flight',
    security_screening:'flight',
    bird_strike:'flight',
    onboard_medical:'flight',
    inflight_technical_fault:'flight',
    fuel_margin_low:'flight',
    atc_holding_fuel_conflict:'flight',
    airborne_atc_reroute:'flight',
    unruly_passenger:'flight',
    destination_below_minima:'flight',
    diversion_airport_unavailable:'flight',
    lightning_strike:'flight',
    pressurization_issue:'flight'
  };
  const INCIDENT_AIRPORT_ROLE_BY_TYPE={
    destination_closure:'destination',
    destination_closure_ground:'destination',
    destination_handling_unavailable:'destination',
    night_curfew_conflict:'destination',
    arrival_curfew_coordination:'destination',
    fuel_supplier_outage:'origin',
    deicing_capacity_collapse:'origin'
  };
  const ACTIVE_INCIDENT_TYPES=Object.keys(WORKFLOWS);
  const INCIDENT_MODEL_CACHE=new Map();
  const STEP_CACHE=new Map();
  const OPTION_CACHE=new Map();

  function incidentDefinitions(){
    return INCIDENT_DEFINITIONS;
  }

  function definitionForType(type){
    return INCIDENT_DEFINITIONS[type]||null;
  }

  function incidentTypeOrder(){
    return INCIDENT_TYPE_ORDER.slice();
  }

  function retiredIncidentTypes(){
    return new Set(RETIRED_INCIDENT_TYPES);
  }

  function isRetiredType(type){
    return RETIRED_INCIDENT_TYPES.has(type);
  }

  function retiredOutcomeForType(type){
    return RETIRED_INCIDENT_OUTCOMES[type]||'This retired incident is tracked as operational context instead of as a standalone incident.';
  }

  function derivedIncidentTypes(){
    return new Set(DERIVED_INCIDENT_TYPES);
  }

  function isDerivedType(type){
    return DERIVED_INCIDENT_TYPES.has(type);
  }

  function titleForType(type){
    const fallback=String(type||'operational_issue').replaceAll('_',' ');
    return definitionForType(type)?.title||fallback;
  }

  function summaryForType(type){
    return definitionForType(type)?.summary||'Operational impact projected.';
  }

  function severityForType(type){
    return definitionForType(type)?.severity||'warning';
  }

  function decisionMinutesForType(type){
    return definitionForType(type)?.decisionMin||30;
  }

  function arrivalInspectionOnClose(type){
    return Boolean(definitionForType(type)?.arrivalInspectionOnClose);
  }

  function finalizerForType(type){
    return incidentModel(type)?.finalizer||'';
  }

  function incidentModel(type){
    if(INCIDENT_MODEL_CACHE.has(type)) return INCIDENT_MODEL_CACHE.get(type);
    const workflow=WORKFLOWS[type];
    if(!workflow) return null;
    const definition=definitionForType(type)||{};
    const phase=definition.airborneOnly?'airborne':definition.allowAirborne?'any':'ground';
    const scope=INCIDENT_SCOPE_BY_TYPE[type];
    if(!scope){
      console.error(`Missing explicit problem scope for ${type}`);
      return null;
    }
    const model={
      type,
      title:definition.title||titleForType(type),
      severity:definition.severity||'warning',
      decisionMin:definition.decisionMin||30,
      summary:definition.summary||'',
      classification:workflow.classification||'incident',
      scope,
      phase,
      airportRole:INCIDENT_AIRPORT_ROLE_BY_TYPE[type]||(phase==='airborne'?'destination':'origin'),
      allowAirborne:Boolean(definition.allowAirborne),
      airborneOnly:Boolean(definition.airborneOnly),
      arrivalInspectionOnClose:Boolean(definition.arrivalInspectionOnClose),
      defaultPolicy:defaultPolicyForType(type),
      finalizer:INCIDENT_FINALIZER_BY_TYPE[type]||'',
      steps:workflow.steps||[]
    };
    INCIDENT_MODEL_CACHE.set(type,model);
    return model;
  }

  function activeIncidentTypes(){
    return ACTIVE_INCIDENT_TYPES.slice();
  }

  function workflowDefinitions(){
    return WORKFLOWS;
  }

  function classificationForType(type){
    return incidentModel(type)?.classification||'incident';
  }

  function scopeForType(type){
    return incidentModel(type)?.scope||'';
  }

  function phaseForType(type){
    return incidentModel(type)?.phase||'ground';
  }

  function airportRoleForType(type){
    return incidentModel(type)?.airportRole||'origin';
  }

  function defaultPolicyForType(type){
    if(isRetiredType(type)) return {mode:'none',label:'none',summary:'This incident type is retired.'};
    return INCIDENT_DEFAULT_POLICIES[type]||{mode:'manual_required_no_auto_fix',label:'manual required',summary:'No automatic recovery exists for this case. The flight remains held until the player takes the required OCC action.'};
  }

  function stepForTask(type,key){
    if(!STEP_CACHE.has(type)){
      STEP_CACHE.set(type,new Map((WORKFLOWS[type]?.steps||[]).map(step=>[step.key,step])));
    }
    return STEP_CACHE.get(type).get(key)||null;
  }

  function optionForTask(type,key,actionId){
    if(!actionId) return null;
    const cacheKey=`${type}:${key}`;
    if(!OPTION_CACHE.has(cacheKey)){
      const step=stepForTask(type,key);
      OPTION_CACHE.set(cacheKey,new Map((step?.options||[]).map(option=>[option.id,option])));
    }
    return OPTION_CACHE.get(cacheKey).get(actionId)||null;
  }

  function num(value,fallback=0){
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  }

  function contextDelay(incident,flight){
    return Math.max(
      num(incident?.context?.delayMin,0),
      num(incident?.context?.inboundDelayMin,0),
      num(incident?.context?.holdingDelayMin,0),
      num(flight?.airportDelayMin,0),
      num(flight?.airspaceDelayMin,0)
    );
  }

  function directContextDelay(incident,flight){
    return Math.max(
      num(incident?.context?.delayMin,0),
      num(flight?.airportDelayMin,0),
      num(flight?.airspaceDelayMin,0)
    );
  }

  function emptyTimingProfile(){
    return {delayMin:0,responseMin:0,spread:.25,drivers:[],exactDelay:false,exactResponse:false};
  }

  function timingProfileForTask(task,incident,actionId='',flight=null){
    const action=actionId||task?.action||task?.selection?.action||task?.selection?.strategy||'';
    const key=task?.key||'';
    const kind=task?.kind||'';
    const type=incident?.type||'';
    const directDelay=directContextDelay(incident,flight);
    const delay=contextDelay(incident,flight);
    const profile=emptyTimingProfile();
    const step=stepForTask(type,task?.key||'');
    const option=optionForTask(type,task?.key||'',action);
    const declared={...(step?.timing||{}),...(option?.timing||{})};

    let inferred=null;
    if(action==='cancel') inferred={...profile,delayMin:0,responseMin:0,drivers:['flight cancellation']};
    else if(['manual_ferry_required','manual_crew_move_required','manual_departure_change_required','maintenance_check_scheduling'].includes(kind)) inferred={...profile,delayMin:delay,responseMin:0,exactDelay:Boolean(delay),drivers:['manual OCC action']};
    else if(kind==='aircraft_substitution') inferred={...profile,delayMin:num(incident?.replacementDelayMin,0),responseMin:0,exactDelay:true,drivers:['replacement aircraft readiness']};
    else if(kind==='crew_allocation') inferred={...profile,responseMin:0,drivers:['local reserve selection']};
    else if(kind==='crew_report'||action==='replace') inferred={...profile,delayMin:25,responseMin:25,spread:.30,drivers:['reserve report and briefing']};
    else if(kind==='crew_augmentation'||action==='augment') inferred={...profile,delayMin:25,responseMin:25,spread:.30,drivers:['augmentation callout']};
    else if(kind==='maintenance_inspection') inferred={...profile,responseMin:25,spread:.35,drivers:['engineering inspection']};
    else if(kind==='maintenance_repair'||action==='repair') inferred={...profile,responseMin:120,spread:.30,drivers:['technical repair']};
    else if(kind==='maintenance_clearance') inferred={...profile,responseMin:8,spread:.20,drivers:['engineering release']};
    else if(kind==='mobile_maintenance_team'||action==='send_mobile_team') inferred={...profile,responseMin:90,spread:.35,drivers:['mobile engineering response']};
    else if(kind==='arrival_maintenance_check'||action==='arrival_check') inferred={...profile,responseMin:18,spread:.30,drivers:['arrival inspection coordination']};
    else if(kind==='medical_assessment') inferred={...profile,responseMin:7,spread:.30,drivers:['medical advisory response']};
    else if(kind==='authority_decision') inferred={...profile,responseMin:task?.action==='medical'?7:6,spread:.35,drivers:[task?.action==='medical'?'medical and flight deck response':'flight deck response']};
    else if(kind==='fuel_monitoring') inferred={...profile,responseMin:action==='conserve'?8:6,spread:.25,drivers:['fuel monitoring']};
    else if(kind==='flight_watch_assessment') inferred={...profile,responseMin:6,spread:.25,drivers:['flight-watch assessment']};
    else if(kind==='flightdeck_recommendation') inferred={...profile,responseMin:6,spread:.25,drivers:['flight deck review']};
    else if(kind==='diversion_clearance') inferred={...profile,responseMin:8,spread:.25,drivers:['ATC clearance']};
    else if(kind==='alternate_handling'||kind==='destination_handling') inferred={...profile,delayMin:12,responseMin:12,spread:.30,drivers:['handling acceptance']};
    else if(action==='hold_ground') inferred={...profile,delayMin:Math.max(35,directDelay||45),responseMin:12,spread:directDelay?0:.18,exactDelay:Boolean(directDelay),drivers:['ATC release estimate']};
    else if(action==='priority') inferred={...profile,delayMin:Math.max(10,Math.round((directDelay||30)*.55)),responseMin:15,spread:directDelay?0:.28,exactDelay:Boolean(directDelay),drivers:['flow-management reply']};
    else if(action==='accept') inferred={...profile,delayMin:Math.max(15,directDelay||15),responseMin:0,spread:directDelay?0:.18,exactDelay:Boolean(directDelay),drivers:[type==='airborne_atc_reroute'?'ATC amended route':'airport flow sequence']};
    else if(action==='remote') inferred={...profile,delayMin:20,responseMin:10,spread:.25,drivers:['remote stand and bussing']};
    else if(action==='tow') inferred={...profile,delayMin:30,responseMin:15,spread:.25,drivers:['tow coordination']};
    else if(action==='wait_gate') inferred={...profile,delayMin:45,responseMin:20,spread:.25,drivers:['stand release']};
    else if(['wait_crew','wait_destination_reopen','wait_destination_handling','delay_reopen','delay_departure'].includes(action)) inferred={...profile,delayMin:Math.max(15,delay||25),responseMin:0,spread:delay?0:.20,exactDelay:Boolean(delay),drivers:['resource ETA']};
    else if(action==='position_ferry'||action==='move_crew'||action==='move_reserve') inferred={...profile,delayMin:Math.max(0,delay||45),responseMin:0,spread:delay?0:.25,exactDelay:Boolean(delay),drivers:['positioning ETA']};
    else if(action==='fuel_outage_priority') inferred={...profile,delayMin:Math.max(20,Math.round((delay||45)*.35)),responseMin:14,spread:.28,drivers:['fuel-provider escalation']};
    else if(action==='wait_truck') inferred={...profile,delayMin:35,responseMin:18,spread:.30,drivers:['fuel-truck availability']};
    else if(action==='wait_supply') inferred={...profile,delayMin:Math.max(75,delay||75),responseMin:Math.max(30,Math.round((delay||75)*.35)),spread:delay?0:.20,exactDelay:Boolean(delay),drivers:['supplier outage ETA']};
    else if(action==='minimum_uplift') inferred={...profile,delayMin:15,responseMin:10,spread:.20,drivers:['minimum fuel uplift']};
    else if(action==='tanker_inbound') inferred={...profile,delayMin:Math.max(10,delay||10),responseMin:12,spread:delay?0:.20,exactDelay:Boolean(delay),drivers:['inbound tanker fuel']};
    else if(action==='deice') inferred={...profile,delayMin:25,responseMin:14,spread:.35,drivers:['deicing treatment']};
    else if(action==='priority_deice') inferred={...profile,delayMin:key==='station-deicing-collapse-strategy'?20:15,responseMin:12,spread:.30,drivers:['priority deicing']};
    else if(action==='deice_queue'||action==='join_queue') inferred={...profile,delayMin:Math.max(60,num(incident?.context?.queueMin,0)||delay||60),responseMin:Math.max(20,Math.round((num(incident?.context?.queueMin,0)||delay||60)*.35)),spread:num(incident?.context?.queueMin,0)||delay?0:.25,exactDelay:Boolean(num(incident?.context?.queueMin,0)||delay),drivers:['deicing queue']};
    else if(action==='wait_weather') inferred={...profile,delayMin:Math.max(45,delay||45),responseMin:0,spread:delay?0:.30,exactDelay:Boolean(delay),drivers:['weather improvement']};
    else if(action==='redeice') inferred={...profile,delayMin:25,responseMin:14,spread:.30,drivers:['repeat deicing']};
    else if(action==='wait_deice_slot') inferred={...profile,delayMin:35,responseMin:0,spread:.30,drivers:['next deicing slot']};
    else if(action==='payload_reduce') inferred={...profile,delayMin:20,responseMin:10,spread:.30,drivers:['load-control coordination']};
    else if(action==='delay_conditions') inferred={...profile,delayMin:Math.max(30,delay||45),responseMin:0,spread:delay?0:.30,exactDelay:Boolean(delay),drivers:['performance window']};
    else if(kind==='network_route_revision') inferred={...profile,delayMin:Math.max(8,num(incident?.context?.rerouteDelayMin,0)||Math.round((delay||30)*.65)),responseMin:Math.max(12,6+Math.min(18,(incident?.context?.affectedCount||1)*2)),spread:delay?0:.28,exactDelay:Boolean(delay),drivers:['network reroute package']};
    else if(kind==='network_event_coordination') inferred={...profile,delayMin:Math.max(8,delay||25),responseMin:Math.max(8,5+Math.min(14,(incident?.context?.affectedCount||1)*1.5)),spread:delay?0:.25,exactDelay:Boolean(delay),drivers:['network flow coordination']};
    else if(action==='direct') inferred={...profile,delayMin:Math.max(5,Math.round((delay||15)*.45)),responseMin:10,spread:delay?0:.30,exactDelay:Boolean(delay),drivers:['ATC / flight deck response']};
    else if(action==='hold') inferred={...profile,delayMin:Math.max(20,delay||20),responseMin:8,spread:delay?0:.25,exactDelay:Boolean(delay),drivers:['holding plan']};
    else if(action==='continue_low') inferred={...profile,delayMin:25,responseMin:8,spread:.25,drivers:['lower altitude fuel burn']};
    else if(action==='continue') inferred={...profile,delayMin:type==='onboard_medical'?20:type==='unruly_passenger'?15:12,responseMin:8,spread:.25,drivers:['arrival coordination']};
    else if(action==='monitor') inferred={...profile,delayMin:10,responseMin:8,spread:.20,drivers:['flight-watch monitoring']};
    else if(action==='conserve') inferred={...profile,delayMin:0,responseMin:6,spread:.20,drivers:['fuel-conservation profile']};
    else if(['alternate','divert','return_origin','reselect','alternate_destination','prepare_alternate'].includes(action)) inferred={...profile,delayMin:delay,responseMin:0,exactDelay:Boolean(delay),drivers:['route revision and downstream recovery']};
    else inferred={...profile,delayMin:delay,responseMin:0,exactDelay:Boolean(delay),drivers:delay?['known operational delay']:[]};

    return {...inferred,...declared,drivers:[...(inferred.drivers||[]),...(declared.drivers||[])]};
  }


  const ProblemModel={
    DEPARTMENTS,WORKFLOWS,KIND_META,
    incidentModel,activeIncidentTypes,workflowDefinitions,classificationForType,scopeForType,phaseForType,airportRoleForType,
    definitionForType,incidentDefinitions,incidentTypeOrder,retiredIncidentTypes,isRetiredType,retiredOutcomeForType,
    derivedIncidentTypes,isDerivedType,titleForType,summaryForType,severityForType,decisionMinutesForType,
    arrivalInspectionOnClose,finalizerForType,defaultPolicyForType,stepForTask,optionForTask,metadataForStep,timingProfileForTask
  };
  global.AeroProblemModel=ProblemModel;
  global.AeroIncidentModel=ProblemModel;

})(typeof window!=='undefined'?window:globalThis);
