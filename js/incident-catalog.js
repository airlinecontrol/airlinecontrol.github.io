/* Incident metadata, retired-case markers, and default no-action policies. */

const INCIDENT_TYPE_ORDER=[
  'crew_sick','mel_defect','destination_closure_ground','destination_closure',
  'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect',
  'maintenance_resource_unavailable',
  'crew_misconnect','crew_misposition_after_diversion','crew_report_delayed','no_legal_crew','crew_duty_extension',
  'atc_ground_stop','night_curfew_conflict','arrival_curfew_coordination','performance_limited','destination_handling_unavailable',
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
  'deicing_required','deicing_capacity_collapse','holdover_expired','atc_ground_stop','night_curfew_conflict','arrival_curfew_coordination','performance_limited',
  'destination_handling_unavailable','fuel_margin_low','atc_holding_fuel_conflict','airborne_atc_reroute',
  'destination_below_minima','diversion_airport_unavailable','lightning_strike'
]);
