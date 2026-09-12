/* Derived problems: operational risks inferred from the live schedule and resources. */

const DERIVED_PROBLEM_CLEAR_GRACE_MS=30*MIN;

function derivedProblemKey(type,flight,context,t=simNow()){
  return typeof problemDedupeKeyForRequest==='function'
    ? problemDedupeKeyForRequest(type,flight,{source:'derived',sourceKey:context?.sourceKey||'',context,detectedAt:t})
    : context?.sourceKey||`derived:${type}:${context?.sourceId||flight.id}`;
}

function findOpenDerivedProblem(type,flight,key){
  return (state.problems||[]).find(item=>item.status==='open'&&item.type===type&&item.dedupeKey===key)
    ||(state.problems||[]).find(item=>item.status==='open'&&item.type===type&&item.flightId===flight.id&&item.sourceKey===key)
    ||(state.problems||[]).find(item=>item.status==='open'&&item.type===type&&item.flightId===flight.id&&!item.dedupeKey);
}

function updateOpenDerivedProblem(type,flight,active,context,t){
  const key=derivedProblemKey(type,flight,context,t);
  const problem=findOpenDerivedProblem(type,flight,key);
  if(active){
    if(!problem&&state.problems.some(item=>item.type===type&&item.dedupeKey===key&&item.status==='resolved')) return false;
    if(problem){
      const previous=JSON.stringify(problem.context||null);
      const next=JSON.stringify(context||null);
      let changed=false;
      if(previous!==next){ problem.context=context; changed=true; }
      if(problem.conditionClearedAt){ problem.conditionClearedAt=0; changed=true; }
      if(problem.dedupeKey!==key){ problem.dedupeKey=key; changed=true; }
      if(typeof ensureProblemIdentityFields==='function') changed=ensureProblemIdentityFields(problem,flight,context,t)||changed;
      problem.lastDetectedAt=t;
      return changed;
    }
    return Boolean(createProblem(type,flight,{detectedAt:t,source:'derived',sourceKey:key,context}));
  }
  if(problem){
    const visibleSince=problem.firstVisibleAt||problem.detectedAt||t;
    if(!problem.conditionClearedAt){
      problem.conditionClearedAt=t;
      if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'condition_clear_pending',{clearAfter:DERIVED_PROBLEM_CLEAR_GRACE_MS});
      return true;
    }
    if(t-Math.max(visibleSince,problem.conditionClearedAt)<DERIVED_PROBLEM_CLEAR_GRACE_MS) return false;
    problem.status='resolved'; problem.blocking=false; problem.resolvedAt=t;
    problem.autoClosedAt=t;
    problem.autoCloseReason='condition_cleared';
    problem.automaticResolution=true;
    problem.outcome='The underlying operational risk cleared before OCC action was needed.';
    if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'auto_closed',{reason:'condition_cleared',visibleMs:t-visibleSince});
    return true;
  }
  return false;
}

function processDerivedOperationalProblems(t=simNow()){
  let changed=retireTrackedProblems(t);
  if(!state.ops.automaticDisruptions) return changed;
  for(const flight of state.flights){
    if(flight.cancelled||flight.settled) continue;
    const dep=flightActualDeparture(flight), arr=flightActualArrival(flight);
    const preDeparture=!flight.departureLogged&&dep>t;
    if(preDeparture&&t>=flight.departure-6*HOUR){
      const diversionAircraftContext=aircraftMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedProblem('aircraft_misposition_after_diversion',flight,Boolean(diversionAircraftContext?.active),diversionAircraftContext,t)) changed=true;

      const postflightContext=postflightTechnicalContextForFlight(flight,t);
      if(updateOpenDerivedProblem('postflight_technical_defect',flight,Boolean(postflightContext?.active),postflightContext,t)) changed=true;

      const legalCrewContext=legalCrewContextForFlight(flight,t);
      if(updateOpenDerivedProblem('no_legal_crew',flight,Boolean(legalCrewContext?.active),legalCrewContext,t)) changed=true;

      const crewDiversionContext=crewMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedProblem('crew_misposition_after_diversion',flight,Boolean(crewDiversionContext?.active),crewDiversionContext,t)) changed=true;

      const groundStopContext=atcGroundStopContextForFlight(flight,t);
      if(updateOpenDerivedProblem('atc_ground_stop',flight,Boolean(groundStopContext?.active),groundStopContext,t)) changed=true;

      const nightCurfewContext=nightCurfewConflictContextForFlight(flight,dep);
      const nightProblemRequired=nightCurfewProblemRequired(flight,nightCurfewContext,t);
      if(updateOpenDerivedProblem('night_curfew_conflict',flight,nightProblemRequired,nightCurfewContext,t)) changed=true;

      const deicingCollapseContext=deicingCapacityCollapseContextForFlight(flight,t);
      const deicingProblemRequired=deicingCapacityProblemRequired(flight,deicingCollapseContext,t);
      if(updateOpenDerivedProblem('deicing_capacity_collapse',flight,deicingProblemRequired,deicingCollapseContext,t)) changed=true;

      const holdoverContext=holdoverExpiredContextForFlight(flight,t);
      if(updateOpenDerivedProblem('holdover_expired',flight,Boolean(holdoverContext?.active),holdoverContext,t)) changed=true;
    }
    if(t<arr&&flight.flightType!=='ferry'){
      if(flightIsAirborne(flight,t)){
        const fuelContext=fuelMarginContextForFlight(flight,t);
        if(fuelContext&&updateOpenDerivedProblem('fuel_margin_low',flight,Boolean(fuelContext.active),fuelContext,t)) changed=true;
        const holdingContext=holdingFuelConflictContextForFlight(flight,t);
        if(holdingContext&&updateOpenDerivedProblem('atc_holding_fuel_conflict',flight,Boolean(holdingContext.active),holdingContext,t)) changed=true;
        const diversionUnavailableContext=diversionAirportUnavailableContextForFlight(flight,t);
        if(diversionUnavailableContext&&updateOpenDerivedProblem('diversion_airport_unavailable',flight,Boolean(diversionUnavailableContext.active),diversionUnavailableContext,t)) changed=true;
        const arrivalCurfewContext=arrivalCurfewContextForFlight(flight,t);
        if(updateOpenDerivedProblem('arrival_curfew_coordination',flight,Boolean(arrivalCurfewContext?.active),arrivalCurfewContext,t)) changed=true;
      }
    }
  }
  return changed;
}
