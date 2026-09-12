/* Central problem model: definitions, facts, recommendations, and state-derived resolution. */
(function(global){
  'use strict';

  const DESKS={
    dispatch:{label:'Dispatch',widget:'planning'},
    personnel:{label:'Personnel',widget:'personnel'},
    maintenance:{label:'Maintenance',widget:'maintenance'},
    corporate:{label:'Corporate Resources',widget:'corporate'},
    station:{label:'Station Operations',widget:'station'},
    network:{label:'Network / Flow',widget:'network'},
    passengers:{label:'Passenger impact',widget:'passengers'},
    crewImpact:{label:'Crew impact',widget:'personnel'}
  };

  const COMMON={
    delay:{desk:'dispatch',panel:'timing',label:'Delay / retime flight',detail:'Use Dispatch timing controls to hold or retime the selected flight.'},
    cancel:{desk:'dispatch',panel:'timing',label:'Cancel flight',detail:'Use Dispatch cancellation controls when recovery is no longer acceptable.'},
    swap:{desk:'dispatch',panel:'assignment',label:'Swap aircraft',detail:'Assign a serviceable aircraft through Dispatch before departure.'},
    ferry:{desk:'corporate',label:'Plan ferry / positioning flight',detail:'Create a ferry or positioning leg in Corporate Resources.'},
    crewMove:{desk:'personnel',panel:'overview',label:'Coordinate crew assignment',detail:'Choose an airport crew pool and assign qualified crew to an eligible departure in Personnel.'},
    maintenance:{desk:'maintenance',label:'Schedule maintenance work',detail:'Use Maintenance to inspect, repair, defer, or clear the aircraft.'},
    handling:{desk:'station',label:'Coordinate station exception',detail:'Use Station Operations for diversion handling, provider replacement, or disruption capacity.'},
    alternate:{desk:'dispatch',panel:'route',label:'Coordinate alternate / return',detail:'Use Dispatch flight-watch actions for alternate, return, route, or support planning.'},
    passengers:{desk:'passengers',label:'Coordinate passengers',detail:'Use Passenger impact tools if the disruption creates passenger recovery exposure.'},
    crewImpact:{desk:'crewImpact',panel:'crew-impact',label:'Coordinate crew rest / positioning',detail:'Use the Personnel crew-impact tab when a diversion or delay creates downstream crew recovery exposure.'},
    network:{desk:'network',label:'Coordinate shared network plan',detail:'Use Network / Flow for shared holds, restrictions, or route packages.'}
  };

  function rec(...items){ return items.filter(Boolean); }

  const PROBLEM_DEFINITIONS={
    crew_sick:{
      title:'Crew sick call',severity:'critical',decisionMin:30,scope:'flight',phase:'ground',
      summary:'A required operating crew member reported unavailable.',
      recommendations:['crewMove','delay','cancel'],
      resolution:'Assign legal replacement crew, retime the flight, or cancel before departure.'
    },
    mel_defect:{
      title:'Ground technical defect',severity:'critical',decisionMin:25,scope:'aircraft',phase:'ground',
      summary:'A pre-departure aircraft defect requires maintenance-control disposition.',
      recommendations:['maintenance','swap','ferry','cancel'],
      resolution:'Clear the defect, defer it under MEL, assign a replacement aircraft, or cancel the unflown flight.'
    },
    destination_closure_ground:{
      title:'Destination closure',severity:'critical',decisionMin:35,scope:'airport',phase:'ground',airportRole:'destination',
      summary:'The destination is unavailable before departure and needs an OCC operating decision.',
      recommendations:['delay','alternate','cancel'],
      resolution:'Hold the departure until acceptable, change the operating plan, or cancel before departure.'
    },
    destination_closure:{
      title:'Destination closure',severity:'critical',decisionMin:20,scope:'airport',phase:'airborne',airportRole:'destination',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'The destination airport became unavailable while the flight is airborne.',
      recommendations:['alternate','handling','passengers','crewImpact'],
      resolution:'Coordinate the flight-deck plan, airport acceptance, and downstream passenger/crew support.'
    },
    aircraft_misposition_after_diversion:{
      title:'Aircraft misposition after diversion',severity:'critical',decisionMin:40,scope:'aircraft',phase:'ground',
      summary:'A previous diversion left the assigned aircraft away from the next planned origin.',
      recommendations:['ferry','swap','delay','cancel'],
      resolution:'Recover the aircraft position, assign a replacement, retime, or cancel.'
    },
    postflight_technical_defect:{
      title:'Post-flight technical defect',severity:'critical',decisionMin:30,scope:'aircraft',phase:'ground',
      summary:'The inbound aircraft needs engineering disposition before the next sector.',
      recommendations:['maintenance','swap','ferry','cancel'],
      resolution:'Inspect and clear/defer/repair the aircraft, use another aircraft, or cancel.'
    },
    crew_fatigue_report:{
      title:'Crew fatigue report',severity:'critical',decisionMin:30,scope:'flight',phase:'ground',
      summary:'A crew member reported fatigue or fitness concerns before departure.',
      recommendations:['crewMove','delay','cancel'],
      resolution:'Replace or augment the crew, retime legally, or cancel.'
    },
    crew_misposition_after_diversion:{
      title:'Crew misposition after diversion',severity:'critical',decisionMin:35,scope:'flight',phase:'ground',
      summary:'The through crew is away from the next departure station after a diversion.',
      recommendations:['crewMove','crewImpact','delay','cancel'],
      resolution:'Position or replace the crew, then retime or cancel the affected flight.'
    },
    no_legal_crew:{
      title:'No legal crew for departure',severity:'critical',decisionMin:35,scope:'flight',phase:'ground',
      summary:'No complete legal qualified crew is available at the departure station.',
      recommendations:['crewMove','delay','cancel'],
      resolution:'Make a legal crew available at origin, or cancel the unflown flight.'
    },
    fuel_supplier_outage:{
      title:'Fuel supplier outage',severity:'critical',decisionMin:30,scope:'airport',phase:'ground',airportRole:'origin',
      summary:'The departure fuel provider has a local outage or truck shortage before departure.',
      recommendations:['handling','swap','delay','cancel'],
      resolution:'Secure fuel service, use a fueled replacement aircraft, retime, or cancel.'
    },
    deicing_capacity_collapse:{
      title:'Deicing capacity collapse',severity:'critical',decisionMin:30,scope:'airport',phase:'ground',airportRole:'origin',
      summary:'Winter weather and local demand have overwhelmed the departure deicing queue.',
      recommendations:['handling','delay','cancel'],
      resolution:'Coordinate queue/priority treatment, hold departures, or cancel affected flights.'
    },
    holdover_expired:{
      title:'Deicing holdover expired',severity:'critical',decisionMin:20,scope:'flight',phase:'ground',
      summary:'The treated aircraft exceeded its usable holdover window before takeoff.',
      recommendations:['handling','delay','cancel'],
      resolution:'Repeat treatment, wait for a new slot, or cancel.'
    },
    atc_ground_stop:{
      title:'ATC ground stop',severity:'critical',decisionMin:25,scope:'airport',phase:'ground',airportRole:'destination',
      summary:'A destination or airspace ground stop prevents normal departure release.',
      recommendations:['delay','network','cancel'],
      resolution:'Hold departures, find an accepted release/reroute, or cancel.'
    },
    network_airspace_closure:{
      title:'Airspace closure',severity:'critical',decisionMin:30,scope:'network',phase:'any',allowAirborne:true,
      defaultStrategy:'network_avoidance',
      summary:'A restricted or closed airspace polygon blocks planned route corridors.',
      recommendations:['network','delay'],
      resolution:'Route affected flights around the polygon or hold departures outside the area.'
    },
    network_convective_weather:{
      title:'Convective weather corridor',severity:'critical',decisionMin:25,scope:'network',phase:'any',allowAirborne:true,
      defaultStrategy:'network_avoidance',
      summary:'A severe convective weather corridor affects multiple planned or airborne routings.',
      recommendations:['network','delay'],
      resolution:'Publish weather avoidance routes, tactical deviations, or departure holds.'
    },
    night_curfew_conflict:{
      title:'Night curfew conflict',severity:'critical',decisionMin:30,scope:'flight',phase:'ground',airportRole:'destination',
      summary:'A delay pushes the flight into an airport night curfew and needs OCC recovery.',
      recommendations:['delay','cancel'],
      resolution:'Retime outside the restriction or cancel before departure.'
    },
    arrival_curfew_coordination:{
      title:'Arrival curfew coordination',severity:'critical',decisionMin:18,scope:'flight',phase:'airborne',airportRole:'destination',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'The airborne flight is projected to arrive inside a hard night curfew and needs arrival acceptance coordination.',
      recommendations:['alternate','handling','passengers','crewImpact'],
      resolution:'Coordinate acceptance, diversion, or return support for the airborne flight.'
    },
    security_screening:{
      title:'Security offload / manifest issue',severity:'critical',decisionMin:25,scope:'flight',phase:'ground',
      summary:'A security irregularity requires passenger, baggage, manifest, or departure coordination.',
      recommendations:['handling','delay','cancel'],
      resolution:'Complete security/station coordination, retime, or cancel.'
    },
    bird_strike:{
      title:'Suspected bird strike',severity:'critical',decisionMin:18,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true,
      defaultStrategy:'continue_inspection',
      summary:'The flight deck reports a suspected bird strike while airborne.',
      recommendations:['alternate','maintenance','handling'],
      resolution:'Record the flight-deck plan and coordinate inspection/arrival support.'
    },
    onboard_medical:{
      title:'Onboard medical case',severity:'critical',decisionMin:20,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,
      summary:'The flight deck reports a medical case requiring OCC coordination.',
      requiredResponse:{
        owner:'cabin',label:'Cabin medical assessment',responseMin:[3,7],
        outcomes:[
          {id:'stable',weight:4,fallbackMode:'continue',title:'Passenger stable after first aid',detail:'Cabin crew report that the passenger is stable and can be monitored while the flight deck reviews continuation.'},
          {id:'serious',weight:4,fallbackMode:'divert',title:'Passenger condition is deteriorating',detail:'Cabin crew recommend prompt medical support on arrival; the flight deck is assessing a diversion.'},
          {id:'critical',weight:2,fallbackMode:'divert',title:'Immediate medical assistance required',detail:'Cabin crew report a critical condition. The flight deck requests the nearest suitable medical diversion plan.'}
        ]
      },
      defaultStrategy:'flight_deck_response',
      recommendations:['alternate','handling','passengers'],
      resolution:'Coordinate the medical/flight-deck plan and receiving support.'
    },
    inflight_technical_fault:{
      title:'Inflight technical fault',severity:'critical',decisionMin:20,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true,
      summary:'The flight deck reports a technical abnormality requiring flight-watch coordination.',
      requiredResponse:{
        owner:'flightDeck',label:'Flight deck technical assessment',responseMin:[4,9],
        outcomes:[
          {id:'continue_monitor',weight:5,fallbackMode:'continue',severityLabel:'Minor / monitored',decision:'Continue to destination',title:'Continue to destination',detail:'Indications are stable. The flight deck will continue while monitoring the fault and requests maintenance attendance on arrival.'},
          {id:'continue_priority',weight:3,fallbackMode:'continue',severityLabel:'Operationally significant',decision:'Continue with priority handling',title:'Continue with priority handling',detail:'The aircraft remains controllable, but the flight deck requests priority handling and engineering support on arrival.'},
          {id:'return_origin',weight:2,fallbackMode:'return_origin',maxPhasePct:55,severityLabel:'Significant',decision:'Return to origin',title:'Return to origin',detail:'The flight deck intends to return to the departure airport. OCC must coordinate the return route, acceptance, handling, and downstream recovery.'},
          {id:'divert',weight:2,fallbackMode:'divert',severityLabel:'Significant',decision:'Divert to a suitable airport',title:'Divert to a suitable airport',detail:'The flight deck requests the nearest operationally suitable airport. OCC must coordinate the alternate, handling, and downstream recovery.'},
          {id:'land_asap',weight:.75,fallbackMode:'divert',severityLabel:'Severe',decision:'Land as soon as practical',title:'Land as soon as practical',detail:'The fault requires an expeditious landing. OCC must support the flight deck with the nearest suitable airport and emergency arrival coordination.'}
        ]
      },
      defaultStrategy:'flight_deck_response',
      recommendations:['alternate','maintenance','handling','passengers','crewImpact'],
      resolution:'Coordinate the flight-deck plan, engineering support, and downstream recovery.'
    },
    fuel_margin_low:{
      title:'Fuel margin low',severity:'critical',decisionMin:18,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'Projected landing fuel is below the planned operational margin.',
      recommendations:['alternate','network'],
      resolution:'Coordinate fuel conservation, priority routing, diversion, or return support.'
    },
    atc_holding_fuel_conflict:{
      title:'ATC holding fuel conflict',severity:'critical',decisionMin:18,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'Assigned airborne delay is eroding fuel margin before arrival.',
      recommendations:['alternate','network'],
      resolution:'Coordinate priority handling, reduced holding, diversion, or return support.'
    },
    unruly_passenger:{
      title:'Unruly passenger',severity:'critical',decisionMin:20,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,
      summary:'Cabin crew report a disruptive passenger requiring flight deck and security coordination.',
      requiredResponse:{
        owner:'cabin',label:'Cabin security assessment',responseMin:[2,6],
        outcomes:[
          {id:'contained',weight:4,fallbackMode:'continue',title:'Passenger contained and cooperative',detail:'Cabin crew have de-escalated the situation and recommend continued monitoring with security meeting the flight on arrival.'},
          {id:'restrained',weight:4,fallbackMode:'continue',title:'Passenger restrained; cabin stable',detail:'Cabin crew have restrained the passenger. The captain is reviewing continuation against the remaining flight time.'},
          {id:'escalating',weight:2,fallbackMode:'divert',title:'Threat remains uncontrolled',detail:'Cabin crew report an immediate safety risk. The captain requests the nearest suitable diversion and police support.'}
        ]
      },
      defaultStrategy:'flight_deck_response',
      recommendations:['alternate','handling','passengers'],
      resolution:'Coordinate the captain/security plan and arrival or diversion support.'
    },
    destination_below_minima:{
      title:'Destination below landing minima',severity:'critical',decisionMin:15,scope:'flight',phase:'airborne',airportRole:'destination',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'Forecast arrival weather is below practical landing minima.',
      recommendations:['alternate','network','handling'],
      resolution:'Coordinate holding, diversion, return, and station support based on fuel/weather.'
    },
    diversion_airport_unavailable:{
      title:'Diversion airport unavailable',severity:'critical',decisionMin:12,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,
      defaultStrategy:'divert',
      summary:'The selected diversion airport can no longer accept the flight.',
      recommendations:['alternate','handling','passengers','crewImpact'],
      resolution:'Choose another workable airport or return plan and coordinate support.'
    },
    lightning_strike:{
      title:'Lightning strike',severity:'critical',decisionMin:18,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true,
      defaultStrategy:'continue_inspection',
      summary:'The aircraft crossed convective weather and reports a possible lightning strike.',
      recommendations:['alternate','maintenance','handling'],
      resolution:'Coordinate inspection, continuation, diversion, or return support.'
    },
    pressurization_issue:{
      title:'Pressurization issue',severity:'critical',decisionMin:15,scope:'flight',phase:'airborne',allowAirborne:true,airborneOnly:true,arrivalInspectionOnClose:true,
      summary:'The flight deck reports abnormal pressurization requiring immediate flight-watch support.',
      requiredResponse:{
        owner:'cabin',label:'Cabin condition report',responseMin:[2,5],
        outcomes:[
          {id:'secure',weight:4,fallbackMode:'divert',title:'Cabin secure; no injuries reported',detail:'Cabin crew confirm that the cabin is secure after the descent. The flight deck is assessing continuation at the lower level.'},
          {id:'assistance',weight:4,fallbackMode:'divert',title:'Passenger assistance required',detail:'Cabin crew report oxygen deployment and minor injuries. Medical and arrival support should be prepared.'},
          {id:'serious',weight:2,fallbackMode:'divert',title:'Serious cabin effects reported',detail:'Cabin crew report significant passenger effects. The flight deck requests an immediate suitable diversion plan.'}
        ]
      },
      defaultStrategy:'flight_deck_response',
      recommendations:['alternate','maintenance','handling','passengers','crewImpact'],
      resolution:'Coordinate the low-altitude/diversion/return plan and downstream support.'
    }
  };

  const WARNING_ONLY_TYPES=new Set([
    'aircraft_out_of_position','crew_duty_risk','crew_fatigue_mid_rotation','crew_duty_extension',
    'crew_misconnect','crew_report_delayed','deicing_required','network_atc_sector_capacity','airborne_atc_reroute'
  ]);
  const WIDGET_STATE_TYPES=new Set([
    'maintenance_resource_unavailable','performance_limited','destination_handling_unavailable'
  ]);
  const ESCALATING_TYPES=new Set([
    'night_curfew_conflict','destination_below_minima','deicing_capacity_collapse','network_convective_weather'
  ]);
  const RETIRED_PROBLEM_TYPES=new Set([
    'slot_miss_risk','aircraft_late_inbound','alternate_unsuitable','destination_weather_deterioration','atc_restriction',
    'gate_conflict','baggage_loading_issue','fueling_issue','airport_capacity_reduction',
    ...WARNING_ONLY_TYPES,...WIDGET_STATE_TYPES
  ]);

  const RETIRED_PROBLEM_OUTCOMES={
    aircraft_late_inbound:'Late inbound risk is tracked directly on the schedule instead of as a standalone problem.',
    alternate_unsuitable:'Alternate suitability is tracked as a warning instead of as a standalone problem.',
    destination_weather_deterioration:'Destination weather deterioration is tracked as a warning instead of as a standalone problem.',
    atc_restriction:'ATC flow restrictions are tracked as airport-flow causes instead of standalone problems.',
    gate_conflict:'Gate and stand pressure is tracked as station-readiness warnings unless it creates a stronger operational disruption.',
    baggage_loading_issue:'Load-control and baggage trouble is tracked as station-readiness delay context unless a security or cancellation decision is required.',
    fueling_issue:'Routine fuel uplift constraints are tracked as station-readiness warnings; supplier outages remain problems.',
    airport_capacity_reduction:'Airport flow restrictions are tracked as warnings unless they escalate into a ground stop or another OCC decision case.',
    slot_miss_risk:'Slot risk is tracked on the schedule and as linked disruption context instead of as a standalone problem.',
    aircraft_out_of_position:'Projected aircraft positioning is tracked as a warning until an actual diversion misposition needs recovery.',
    maintenance_resource_unavailable:'Maintenance support availability is tracked in Maintenance instead of as a separate problem.',
    crew_duty_risk:'Projected crew legality is tracked as a warning; actual crew unavailability remains a problem.',
    crew_fatigue_mid_rotation:'Low remaining duty margin is tracked as a warning until a crew member reports fatigue or no legal crew remains.',
    crew_duty_extension:'Airborne duty overrun is tracked as a crew warning and downstream recovery exposure.',
    crew_misconnect:'A late positioning crew is tracked as a warning until the departure reaches the no-legal-crew decision point.',
    crew_report_delayed:'Crew report lateness is tracked as a warning and timing cause instead of as a separate problem.',
    deicing_required:'Routine weather-driven deicing is tracked as a station-readiness warning.',
    network_atc_sector_capacity:'Sector capacity is tracked as a shared network warning; airspace closures remain problems.',
    performance_limited:'Dispatch performance margin is tracked in Dispatch and warnings instead of as a separate problem.',
    destination_handling_unavailable:'Destination handling readiness is tracked in Station Operations and warnings instead of as a separate problem.',
    airborne_atc_reroute:'Airborne route amendments are tracked as route/weather warnings unless they create a stronger decision case.'
  };

  const DERIVED_PROBLEM_TYPES=new Set([
    'aircraft_misposition_after_diversion','postflight_technical_defect',
    'crew_misposition_after_diversion','no_legal_crew',
    'deicing_capacity_collapse','holdover_expired','atc_ground_stop',
    'network_airspace_closure','network_convective_weather',
    'night_curfew_conflict','arrival_curfew_coordination',
    'fuel_margin_low','atc_holding_fuel_conflict',
    'destination_below_minima','diversion_airport_unavailable','lightning_strike'
  ]);

  const PROBLEM_TYPE_ORDER=Object.keys(PROBLEM_DEFINITIONS);

  function definitionForType(type){ return PROBLEM_DEFINITIONS[type]||null; }
  function problemDefinitions(){ return PROBLEM_DEFINITIONS; }
  function problemTypeOrder(){ return PROBLEM_TYPE_ORDER.slice(); }
  function activeProblemTypes(){ return PROBLEM_TYPE_ORDER.filter(type=>!RETIRED_PROBLEM_TYPES.has(type)); }
  function retiredProblemTypes(){ return new Set(RETIRED_PROBLEM_TYPES); }
  function isRetiredType(type){ return RETIRED_PROBLEM_TYPES.has(type); }
  function retiredOutcomeForType(type){ return RETIRED_PROBLEM_OUTCOMES[type]||'This retired problem is tracked as operational context instead of as a standalone problem.'; }
  function attentionModeForType(type){
    if(WARNING_ONLY_TYPES.has(type)) return 'warning';
    if(WIDGET_STATE_TYPES.has(type)) return 'widget';
    if(ESCALATING_TYPES.has(type)) return 'escalating';
    return definitionForType(type)&&!isRetiredType(type)?'problem':'retired';
  }
  function derivedProblemTypes(){ return new Set(DERIVED_PROBLEM_TYPES); }
  function isDerivedType(type){ return DERIVED_PROBLEM_TYPES.has(type); }
  function titleForType(type){ return definitionForType(type)?.title||String(type||'operational_issue').replaceAll('_',' '); }
  function summaryForType(type){ return definitionForType(type)?.summary||'Operational impact projected.'; }
  function severityForType(type){ return definitionForType(type)?.severity||'warning'; }
  function decisionMinutesForType(type){ return definitionForType(type)?.decisionMin||30; }
  function requiredResponseForType(type){
    const response=definitionForType(type)?.requiredResponse;
    return response?{
      ...response,
      responseMin:Array.isArray(response.responseMin)?response.responseMin.slice():[response.responseMin,response.responseMin],
      outcomes:(response.outcomes||[]).map(outcome=>({...outcome}))
    }:null;
  }
  function stableResponseUnit(seed){
    const stableUnit=global.AeroOperationalIntelligence?.stableUnit;
    if(typeof stableUnit==='function') return stableUnit(seed);
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }
  function responseDelayMinutesForProblem(problem){
    const response=requiredResponseForType(problem?.type);
    if(!response) return 0;
    const [rawLow,rawHigh]=response.responseMin;
    const low=Math.max(1,Math.round(Number(rawLow)||1));
    const high=Math.max(low,Math.round(Number(rawHigh)||low));
    return low+Math.round(stableResponseUnit(`${problem?.id||problem?.type}:required-response-delay`)*(high-low));
  }
  function responseOutcomeForProblem(problem){
    const response=requiredResponseForType(problem?.type);
    const phasePct=Number(problem?.context?.phasePct);
    const outcomes=(response?.outcomes||[]).filter(outcome=>
      (!Number.isFinite(outcome.minPhasePct)||!Number.isFinite(phasePct)||phasePct>=outcome.minPhasePct)&&
      (!Number.isFinite(outcome.maxPhasePct)||!Number.isFinite(phasePct)||phasePct<=outcome.maxPhasePct)
    );
    if(!outcomes.length) return null;
    const total=outcomes.reduce((sum,outcome)=>sum+Math.max(0,Number(outcome.weight)||0),0)||outcomes.length;
    let cursor=stableResponseUnit(`${problem?.id||problem?.type}:required-response-outcome`)*total;
    for(const outcome of outcomes){
      cursor-=Math.max(0,Number(outcome.weight)||0)||(total===outcomes.length?1:0);
      if(cursor<=0) return {...outcome};
    }
    return {...outcomes[outcomes.length-1]};
  }
  function arrivalInspectionOnClose(type){ return Boolean(definitionForType(type)?.arrivalInspectionOnClose); }
  function classificationForType(type){ return isDerivedType(type)?'derived':'problem'; }
  function scopeForType(type){ return definitionForType(type)?.scope||'flight'; }
  function phaseForType(type){ return definitionForType(type)?.phase||'ground'; }
  function airportRoleForType(type){ return definitionForType(type)?.airportRole||(phaseForType(type)==='airborne'?'destination':'origin'); }
  function defaultPolicyForType(type){
    const definition=definitionForType(type);
    if(!definition||isRetiredType(type)) return null;
    const mode=definition.defaultStrategy||(
      definition.phase==='ground'?'cancel_at_departure':
      definition.scope==='network'?'network_avoidance':'flight_deck_safe'
    );
    const labels={
      cancel_at_departure:'Cancel at departure',
      flight_deck_response:'Safest reported flight-deck decision',
      flight_deck_safe:'Safest flight-deck decision',
      divert:'Divert to a suitable airport',
      continue_inspection:'Continue and inspect on arrival',
      network_avoidance:'Avoid affected airspace'
    };
    return {
      mode,
      label:labels[mode]||'Safest operational outcome',
      minimumVisibleMin:10,
      responseReviewMin:10,
      summary:definition.phase==='ground'
        ? 'If the current actual departure passes without a workable recovery, the affected unflown flight is cancelled.'
        : 'If OCC does not respond, the safest available flight-deck outcome is applied.'
    };
  }

  function problemModel(type){
    const def=definitionForType(type);
    if(!def||isRetiredType(type)) return null;
    return {
      type,
      title:def.title,
      severity:def.severity||'warning',
      decisionMin:def.decisionMin||30,
      summary:def.summary||'',
      classification:classificationForType(type),
      scope:def.scope||'flight',
      phase:def.phase||'ground',
      airportRole:airportRoleForType(type),
      allowAirborne:Boolean(def.allowAirborne),
      airborneOnly:Boolean(def.airborneOnly),
      arrivalInspectionOnClose:Boolean(def.arrivalInspectionOnClose),
      requiredResponse:requiredResponseForType(type),
      defaultPolicy:defaultPolicyForType(type),
      recommendations:recommendationsForType(type)
    };
  }

  function recommendationsForType(type){
    const def=definitionForType(type);
    return rec(...(def?.recommendations||[]).map(key=>COMMON[key])).map(item=>({...item}));
  }

  function recommendationsForProblem(problem){
    const base=recommendationsForType(problem?.type).map(item=>({...item}));
    const flight=problem?.flightId&&global.state?.flights?.find(item=>item.id===problem.flightId);
    if(flight&&typeof global.flightCanBeCancelled==='function'&&!global.flightCanBeCancelled(flight)){
      return base.filter(item=>item.label!=='Cancel flight');
    }
    return base;
  }

  function formatClock(value){
    if(typeof global.shortClock==='function') return global.shortClock(value);
    try{ return new Date(value).toISOString().slice(11,16); }catch(_){ return ''; }
  }

  function factsForProblem(problem){
    const context=problem?.context||{};
    const facts=[];
    const add=value=>{ if(value) facts.push(String(value)); };
    add(context.reason||context.trigger||context.conditions||context.weatherSummary);
    if(context.delayMin) add(`projected delay +${Math.round(context.delayMin)} min`);
    if(context.airport||problem?.airport) add(`airport ${context.airport||problem.airport}`);
    if(context.expectedLocation&&context.requiredLocation) add(`aircraft expected ${context.expectedLocation}, required ${context.requiredLocation}`);
    if(context.shortage) add(context.shortage);
    if(context.role) add(`role ${context.role}`);
    if(context.activeFrom&&context.activeUntil) add(`active ${formatClock(context.activeFrom)}-${formatClock(context.activeUntil)}`);
    if(Array.isArray(context.affectedFlightIds)&&context.affectedFlightIds.length) add(`${context.affectedFlightIds.length} affected flights`);
    if(problem?.technicalContext?.label) add(problem.technicalContext.label);
    if(Array.isArray(problem?.affectedCrew)&&problem.affectedCrew.length){
      const labels={captains:'captain',firstOfficers:'first officer',cabinCrew:'cabin crew'};
      add(`unavailable ${problem.affectedCrew.map(item=>`${item.count||1} ${labels[item.role]||item.role}${item.family?` (${item.family})`:''}`).join(', ')}`);
    }else if(problem?.affectedRole) add(`unavailable ${problem.affectedRole}`);
    return facts.slice(0,5);
  }

  function resolutionTextForProblem(problem){
    return definitionForType(problem?.type)?.resolution||'Use the owning widget actions until the operational state no longer violates this condition.';
  }

  const ProblemModel={
    DESKS,COMMON,
    problemModel,activeProblemTypes,classificationForType,scopeForType,phaseForType,airportRoleForType,attentionModeForType,
    definitionForType,problemDefinitions,problemTypeOrder,retiredProblemTypes,isRetiredType,retiredOutcomeForType,
    derivedProblemTypes,isDerivedType,titleForType,summaryForType,severityForType,decisionMinutesForType,
    requiredResponseForType,responseDelayMinutesForProblem,responseOutcomeForProblem,
    arrivalInspectionOnClose,defaultPolicyForType,
    recommendationsForType,recommendationsForProblem,factsForProblem,resolutionTextForProblem
  };
  global.AeroProblemModel=ProblemModel;

})(typeof window!=='undefined'?window:globalThis);
