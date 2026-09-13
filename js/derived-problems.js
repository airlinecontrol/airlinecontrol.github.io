/* Derived problems: operational risks inferred from the live schedule and resources. */

const DERIVED_PROBLEM_CLEAR_GRACE_MS=30*MIN;

function derivedProblemKey(type,flight,context,t=simNow()){
  return typeof problemDedupeKeyForRequest==='function'
    ? problemDedupeKeyForRequest(type,flight,{source:'derived',sourceKey:context?.sourceKey||'',context,detectedAt:t})
    : context?.sourceKey||`derived:${type}:${context?.sourceId||flight.id}`;
}

function findOpenDerivedProblem(type,key){
  return (state.problems||[]).find(item=>item.status==='open'&&item.type===type&&item.dedupeKey===key);
}

function observeDerivedProblemClosure(problem,reason){
  const observation=state.derivedProblemObservations?.[problem.dedupeKey];
  if(observation&&observation.problemId===problem.id&&(
    reason.endsWith('_state_cleared')||['condition_cleared','airport_window_cleared','network_event_cleared'].includes(reason)
  )) observation.active=false;
}

function updateOpenDerivedProblem(type,flight,active,context,t){
  const key=derivedProblemKey(type,flight,context,t);
  const problem=findOpenDerivedProblem(type,key);
  state.derivedProblemObservations??={};
  if(!active&&!problem&&!state.derivedProblemObservations[key]) return false;
  const observation=state.derivedProblemObservations[key]??={active:false,problemId:''};
  const observationChanged=observation.active!==active||Boolean(problem&&observation.problemId!==problem.id);
  if(active){
    if(!problem&&observation.active&&observation.problemId) return false;
    observation.active=true;
    if(problem){
      observation.problemId=problem.id;
      const previous=JSON.stringify(problem.context||null);
      const next=JSON.stringify(context||null);
      let changed=observationChanged;
      if(previous!==next){ problem.context=context; changed=true; }
      if(problem.conditionClearedAt){ problem.conditionClearedAt=0; changed=true; }
      if(problem.dedupeKey!==key){ problem.dedupeKey=key; changed=true; }
      if(typeof ensureProblemIdentityFields==='function') changed=ensureProblemIdentityFields(problem,flight,context,t)||changed;
      problem.lastDetectedAt=t;
      return changed;
    }
    const created=createProblem(type,flight,{detectedAt:t,source:'derived',sourceKey:key,context});
    if(created) observation.problemId=created.id;
    return Boolean(created);
  }
  observation.active=false;
  if(problem){
    const visibleSince=problem.firstVisibleAt||problem.detectedAt||t;
    if(!problem.conditionClearedAt){
      problem.conditionClearedAt=t;
      if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'condition_clear_pending',{clearAfter:DERIVED_PROBLEM_CLEAR_GRACE_MS});
      return true;
    }
    if(t-Math.max(visibleSince,problem.conditionClearedAt)<DERIVED_PROBLEM_CLEAR_GRACE_MS) return observationChanged;
    return closeProblem(problem,t,'condition_cleared','The underlying operational risk cleared before OCC action was needed.');
  }
  return observationChanged;
}

function processDerivedOperationalProblems(t=simNow()){
  let changed=retireTrackedProblems(t);
  if(!state.ops.automaticDisruptions) return changed;
  const observations=new Map();
  // A shared condition is active if any exposed flight still observes it.
  const observe=(type,flight,active,context)=>{
    const key=derivedProblemKey(type,flight,context,t);
    if(!observations.has(key)||active) observations.set(key,{type,flight,active,context});
  };
  for(const flight of state.flights){
    if(flight.cancelled||flight.settled) continue;
    const dep=flightActualDeparture(flight), arr=flightActualArrival(flight);
    const preDeparture=!flight.departureLogged&&dep>t;
    if(preDeparture&&t>=flight.departure-6*HOUR){
      const diversionAircraftContext=aircraftMispositionAfterDiversionContextForFlight(flight,t);
      observe('aircraft_misposition_after_diversion',flight,Boolean(diversionAircraftContext?.active),diversionAircraftContext);

      const postflightContext=postflightTechnicalContextForFlight(flight,t);
      observe('postflight_technical_defect',flight,Boolean(postflightContext?.active),postflightContext);

      const legalCrewContext=legalCrewContextForFlight(flight,t);
      observe('no_legal_crew',flight,Boolean(legalCrewContext?.active),legalCrewContext);

      const crewDiversionContext=crewMispositionAfterDiversionContextForFlight(flight,t);
      observe('crew_misposition_after_diversion',flight,Boolean(crewDiversionContext?.active),crewDiversionContext);

      const groundStopContext=atcGroundStopContextForFlight(flight,t);
      observe('atc_ground_stop',flight,Boolean(groundStopContext?.active),groundStopContext);

      const nightCurfewContext=nightCurfewConflictContextForFlight(flight,dep);
      const nightProblemRequired=nightCurfewProblemRequired(flight,nightCurfewContext,t);
      observe('night_curfew_conflict',flight,nightProblemRequired,nightCurfewContext);

      const deicingCollapseContext=deicingCapacityCollapseContextForFlight(flight,t);
      const deicingProblemRequired=deicingCapacityProblemRequired(flight,deicingCollapseContext,t);
      observe('deicing_capacity_collapse',flight,deicingProblemRequired,deicingCollapseContext);

      const holdoverContext=holdoverExpiredContextForFlight(flight,t);
      observe('holdover_expired',flight,Boolean(holdoverContext?.active),holdoverContext);
    }
    if(t<arr&&flight.flightType!=='ferry'){
      if(flightIsAirborne(flight,t)){
        const fuelContext=fuelMarginContextForFlight(flight,t);
        observe('fuel_margin_low',flight,Boolean(fuelContext?.active),fuelContext);
        const holdingContext=holdingFuelConflictContextForFlight(flight,t);
        observe('atc_holding_fuel_conflict',flight,Boolean(holdingContext?.active),holdingContext);
        const diversionUnavailableContext=diversionAirportUnavailableContextForFlight(flight,t);
        observe('diversion_airport_unavailable',flight,Boolean(diversionUnavailableContext?.active),diversionUnavailableContext);
        const arrivalCurfewContext=arrivalCurfewContextForFlight(flight,t);
        observe('arrival_curfew_coordination',flight,Boolean(arrivalCurfewContext?.active),arrivalCurfewContext);
      }
    }
  }
  for(const {type,flight,active,context} of observations.values()){
    changed=updateOpenDerivedProblem(type,flight,active,context,t)||changed;
  }
  const retainedProblems=new Set(state.problems.map(problem=>problem.id));
  for(const [key,observation] of Object.entries(state.derivedProblemObservations||{})){
    if(!observations.has(key)&&!retainedProblems.has(observation.problemId)){
      delete state.derivedProblemObservations[key];
      changed=true;
    }
  }
  return changed;
}
