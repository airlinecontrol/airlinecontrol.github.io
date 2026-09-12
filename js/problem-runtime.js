/* Problem lifecycle: state-derived open/close rules plus shared operational helpers. */

function problemCollection(){
  return state.problems||[];
}

function problemById(problemId){
  return problemCollection().find(item=>item.id===problemId)||null;
}

function openOperationalProblems(){
  return problemCollection().filter(problem=>problem.status==='open');
}

function openProblemsForFlight(flightId){
  if(!flightId) return [];
  return openOperationalProblems().filter(problem=>{
    const ids=typeof problemAffectedFlightIds==='function'
      ? problemAffectedFlightIds(problem)
      : [problem.flightId].filter(Boolean);
    return ids.includes(flightId);
  });
}

function defaultPolicyForProblem(problem){
  return AeroProblemModel.defaultPolicyForType(problem?.type);
}

const PROBLEM_DEFAULT_STATE_VERSION=1;

function problemAffectedFlightsForRuntime(problem){
  const ids=typeof problemAffectedFlightIds==='function'
    ? problemAffectedFlightIds(problem)
    : [problem?.flightId].filter(Boolean);
  return ids.map(id=>state.flights.find(flight=>flight.id===id)).filter(Boolean);
}

function problemEffectiveDeparture(flight){
  return Number(flightActualDeparture(flight))||Number(flight?.departure)||0;
}

function problemPendingUserResponse(flight,t=simNow()){
  if(!flight) return null;
  const waits=[];
  const add=(label,until,kind)=>{
    const safeUntil=Number(until)||0;
    if(safeUntil>t) waits.push({label,until:safeUntil,kind});
  };
  const routeRequest=flight.dispatchRouteRequest;
  if(routeRequest?.status==='pending') add(routeRequest.label||'Dispatch coordination response',routeRequest.respondsAt,'dispatch');
  const recoveryRequest=flight.enrouteRecoveryRequest;
  if(recoveryRequest?.status==='pending') add('En-route recovery response',recoveryRequest.respondsAt,'dispatch');
  for(const assignment of state.crewAssignments||[]){
    const flightIds=assignment.flightIds||[assignment.flightId];
    if(flightIds.includes(flight.id)&&typeof crewAssignmentPending==='function'&&crewAssignmentPending(assignment)){
      add('Crew assignment response',assignment.readyAt,'crew');
    }
  }
  for(const request of state.stationServiceRequests||[]){
    if(request.flightId!==flight.id) continue;
    if(request.status==='requested') add('Station provider response',request.respondsAt,'station');
    else if(['confirmed','ready','in_progress'].includes(request.status)) add('Station service delivery',request.endsAt||request.readyAt,'station');
  }
  return waits.sort((a,b)=>b.until-a.until)[0]||null;
}

function problemDefaultModeForFlight(problem,flight,t=simNow()){
  if(!flightIsAirborne(flight,t)) return 'cancel_at_departure';
  const policy=defaultPolicyForProblem(problem);
  if(policy?.mode==='flight_deck_response'){
    const response=problem.requiredResponse;
    const declared=AeroProblemModel.requiredResponseForType(problem.type)?.outcomes
      ?.find(outcome=>outcome.id===response?.outcomeId)?.fallbackMode;
    return response?.fallbackMode||declared||'flight_deck_response';
  }
  return policy?.mode||'flight_deck_safe';
}

function problemDefaultState(problem,t=simNow(),{create=false}={}){
  if(!problem) return null;
  if(create&&!problem.firstVisibleAt) problem.firstVisibleAt=t;
  if(create&&(!problem.unattended||problem.unattended.version!==PROBLEM_DEFAULT_STATE_VERSION)){
    problem.unattended={version:PROBLEM_DEFAULT_STATE_VERSION,flights:{}};
  }
  return problem.unattended||null;
}

function problemDefaultDeadline(problem,flight,entry,t=simNow()){
  const policy=defaultPolicyForProblem(problem)||{};
  const visibleAt=Number(problem.firstVisibleAt)||Number(problem.detectedAt)||t;
  const minimumVisibleUntil=visibleAt+Math.max(10,Number(policy.minimumVisibleMin)||10)*MIN;
  const airborne=flightIsAirborne(flight,t);
  let baseDeadline=airborne
    ? Math.max(minimumVisibleUntil,(Number(problem.detectedAt)||visibleAt)+AeroProblemModel.decisionMinutesForType(problem.type)*MIN)
    : Math.max(minimumVisibleUntil,problemEffectiveDeparture(flight));
  if(airborne&&problem.requiredResponse){
    baseDeadline=Math.max(baseDeadline,Number(problem.requiredResponse.respondsAt)||0);
  }
  const pending=problemPendingUserResponse(flight,t);
  if(pending){
    const reviewMin=Math.max(10,Number(policy.responseReviewMin)||10);
    entry.deferredUntil=Math.max(Number(entry.deferredUntil)||0,pending.until+reviewMin*MIN);
    entry.pendingLabel=pending.label;
    entry.pendingUntil=pending.until;
  }else{
    entry.pendingLabel='';
    entry.pendingUntil=0;
  }
  return {
    airborne,
    pending,
    baseDeadline,
    effectiveDeadline:Math.max(baseDeadline,Number(entry.deferredUntil)||0)
  };
}

function problemDefaultEntry(problem,flight,t=simNow(),{create=false}={}){
  const unattended=problemDefaultState(problem,t,{create});
  if(!unattended||!flight) return null;
  const entries=unattended.flights??={};
  const entry=entries[flight.id]??(create?entries[flight.id]={flightId:flight.id,status:'pending',deferredUntil:0,appliedAt:0,outcome:''}:null);
  if(!entry) return null;
  const timing=problemDefaultDeadline(problem,flight,entry,t);
  entry.mode=problemDefaultModeForFlight(problem,flight,t);
  entry.baseDeadline=timing.baseDeadline;
  entry.deadline=timing.effectiveDeadline;
  entry.airborne=timing.airborne;
  if(entry.status!=='applied') entry.status=timing.pending?'waiting_response':'pending';
  return entry;
}

function problemDefaultConsequence(problem,t=simNow()){
  const unattended=problemDefaultState(problem,t);
  const entries=problemAffectedFlightsForRuntime(problem)
    .filter(flight=>!flight.cancelled&&!flight.settled&&!flightHasCompleted(flight,t))
    .map(flight=>unattended?.flights?.[flight.id])
    .filter(entry=>entry&&entry.status!=='applied')
    .sort((a,b)=>a.deadline-b.deadline);
  const entry=entries[0];
  if(!entry) return null;
  const modeLabels={
    cancel_at_departure:`Auto-cancel ${entry.flightId}`,
    divert:`Flight-deck diversion for ${entry.flightId}`,
    return_origin:`Flight-deck return for ${entry.flightId}`,
    continue:`Continue ${entry.flightId} and inspect`,
    continue_inspection:`Continue ${entry.flightId} and inspect`,
    network_avoidance:`Route ${entry.flightId} around constraint`,
    flight_deck_response:`Await flight-deck decision for ${entry.flightId}`,
    flight_deck_safe:`Safest flight-deck action for ${entry.flightId}`
  };
  return {
    flightId:entry.flightId,
    mode:entry.mode,
    status:entry.status,
    startAt:Number(problem.firstVisibleAt)||Number(problem.detectedAt)||t,
    deadline:entry.deadline,
    pendingUntil:entry.pendingUntil||0,
    label:entry.status==='waiting_response'?(entry.pendingLabel||'Operational response pending'):(modeLabels[entry.mode]||`Default action for ${entry.flightId}`),
    detail:entry.status==='waiting_response'
      ? 'The default is suspended while the requested response is pending; a review window follows.'
      : entry.mode==='cancel_at_departure'
        ? 'No workable recovery by the current actual departure deadline cancels this unflown flight.'
        : 'If OCC does not respond, the safest available flight-deck outcome is applied.'
  };
}

function markProblemDefaultApplied(problem,entry,t,outcome){
  entry.status='applied';
  entry.appliedAt=t;
  entry.outcome=outcome;
  problem.automaticResolution=true;
  problem.lastDefaultActionAt=t;
  problem.lastDefaultOutcome=outcome;
  if(typeof traceProblemTransition==='function'){
    traceProblemTransition(problem,'default_applied',{flightId:entry.flightId,mode:entry.mode,outcome});
  }
}

function defaultDiversionForFlight(problem,flight,mode,t){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return {ok:false,reason:'Assigned aircraft is unavailable.'};
  const scopedProblem={...problem,flightId:flight.id,aircraftId:flight.aircraftId};
  const onlyReturnOrigin=mode==='return_origin';
  const options=diversionOptionsForProblem(scopedProblem,{onlyReturnOrigin});
  const alternate=options[0]||(!onlyReturnOrigin?diversionOptionsForProblem(scopedProblem)[0]:null);
  if(!alternate) return {ok:false,reason:alternateUnavailableMessage(scopedProblem,{onlyReturnOrigin})};
  applyOperationalDiversionDestination(flight,scopedProblem,aircraft,alternate.code,{
    mode:alternate.returnOrigin?'return_origin':'diversion',
    reason:`Automatic flight-deck safety decision for ${problem.type}`
  });
  return {ok:true,outcome:`${flight.id} ${alternate.returnOrigin?'returned to origin':'diverted to '+alternate.code} by the flight-deck safety default.`};
}

function applyProblemDefault(problem,flight,entry,t=simNow()){
  if(entry.mode==='cancel_at_departure'){
    if(!flightCanBeCancelled(flight,t)) return {ok:false,reason:flightCancellationUnavailableReason(flight,t)};
    applyFlightCancellation(flight,`No OCC recovery completed for ${AeroProblemModel.titleForType(problem.type)}`,{preserveProblemId:problem.id});
    return {ok:true,outcome:`${flight.id} was automatically cancelled when its departure deadline passed.`};
  }
  if(entry.mode==='flight_deck_response'){
    return {ok:false,reason:'The required flight-deck or cabin assessment has not been received yet.'};
  }
  if(entry.mode==='divert'||entry.mode==='return_origin') return defaultDiversionForFlight(problem,flight,entry.mode,t);
  if(entry.mode==='network_avoidance'){
    const result=globalThis.AeroNetworkEvents?.applyNetworkEventAction?.(problem,'reroute_around',{t,flightIds:[flight.id]});
    return result?.ok?{ok:true,outcome:`${flight.id} was routed around the active network constraint by the flight-deck safety default.`}:{ok:false,reason:result?.reason||'No safe avoidance route is available.'};
  }
  if(entry.mode==='continue'||entry.mode==='continue_inspection'||entry.mode==='flight_deck_safe'){
    applyArrivalInspectionFollowUp(problem,flight);
    return {ok:true,outcome:`${flight.id} continued under the safest available flight-deck plan${AeroProblemModel.arrivalInspectionOnClose(problem.type)?'; arrival inspection required':''}.`};
  }
  return {ok:false,reason:'No safe unattended action is defined for this problem.'};
}

function processProblemDefaults(problem,t=simNow()){
  if(!problem||problem.status!=='open') return false;
  const before=JSON.stringify({firstVisibleAt:problem.firstVisibleAt,deadline:problem.deadline,unattended:problem.unattended});
  problemDefaultState(problem,t,{create:true});
  const entries=[];
  for(const flight of problemAffectedFlightsForRuntime(problem)){
    if(flight.cancelled||flight.settled||flightHasCompleted(flight,t)) continue;
    const entry=problemDefaultEntry(problem,flight,t,{create:true});
    if(!entry||entry.status==='applied') continue;
    entries.push(entry);
    if(entry.status==='waiting_response'||t<entry.deadline||t<(entry.nextAttemptAt||0)) continue;
    const result=applyProblemDefault(problem,flight,entry,t);
    if(result.ok){
      markProblemDefaultApplied(problem,entry,t,result.outcome);
      entry.failure='';
      entry.nextAttemptAt=0;
    }else{
      entry.failure=result.reason||'The safe default cannot be applied yet.';
      entry.nextAttemptAt=t+5*MIN;
    }
  }
  const pendingEntries=Object.values(problem.unattended?.flights||{}).filter(entry=>entry.status!=='applied'&&Number(entry.deadline));
  if(pendingEntries.length) problem.deadline=Math.min(...pendingEntries.map(entry=>entry.deadline));
  if(AeroProblemModel.scopeForType(problem.type)==='flight'&&entries.length&&entries.every(entry=>entry.status==='applied')){
    closeProblem(problem,t,'unattended_default',entries.map(item=>item.outcome).filter(Boolean).join(' '));
  }
  return before!==JSON.stringify({firstVisibleAt:problem.firstVisibleAt,deadline:problem.deadline,unattended:problem.unattended});
}

function problemDiversionDurationMs(problem,flight,aircraft,alternate){
  const elapsed=flight?.departureLogged ? Math.max(0,simNow()-flightActualDeparture(flight)) : 0;
  if(Number.isFinite(problem?.diversionDurationMs)&&problem.diversionDurationMs>0){
    return problem.diversionDurationMode==='remaining_from_anchor'
      ? elapsed+problem.diversionDurationMs
      : problem.diversionDurationMs;
  }
  const model=aircraft&&MODELS[aircraft.model];
  if(!flight||!alternate||!model) return flight ? flight.arrival-flight.departure : 0;
  if(Number.isFinite(problem?.diversionRouteKm)&&problem.diversionRouteKm>0) return diversionRouteDurationMs(problem.diversionRouteKm,model);
  const anchor=typeof diversionAnchorForProblem==='function'
    ? diversionAnchorForProblem(problem,flight,aircraft)
    : {lat:AIRPORTS[flight.from].lat,lon:AIRPORTS[flight.from].lon};
  const km=distanceKm(anchor,AIRPORTS[alternate]);
  const duration=diversionRouteDurationMs(km,model);
  return anchor.type==='aircraft' ? elapsed+duration : duration;
}

function applyOperationalDiversionDestination(flight,problem,aircraft,alternate,{mode='',reason=''}={}){
  if(!flight||!aircraft||!alternate) return null;
  window.AeroRoutePlanning?.ensureFlightRoutePlan?.(flight,aircraft);
  const selectedMode=mode || (alternate===flight.from?'return_origin':'diversion');
  flight.diversionAirport=alternate;
  flight.operationalDurationMs=problemDiversionDurationMs(problem,flight,aircraft,alternate);
  flight.weatherChecked=false;
  ensureDiversionHandlingRequest(flight);
  const revision=window.AeroRoutePlanning?.applyDiversionRouteRevision?.(flight,alternate,{
    problem,
    mode:selectedMode,
    reason:reason || (selectedMode==='return_origin'?`Return to ${alternate}`:`Diversion to ${alternate}`)
  });
  if(problem&&revision){
    problem.routeRevisionId=revision.id;
    problem.routeRevisionReason=revision.reason;
  }
  return revision;
}

function applyArrivalInspectionFollowUp(problem,flight){
  if(!problem||!AeroProblemModel.arrivalInspectionOnClose(problem.type)||!flight) return false;
  flight.arrivalInspectionRequired=true;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(aircraft) aircraft.arrivalInspectionRequired=true;
  return true;
}

function problemPrimaryFlightForRuntime(problem){
  const primary=typeof problemPrimaryFlight==='function'
    ? problemPrimaryFlight(problem)
    : state.flights.find(item=>item.id===problem?.flightId)||null;
  if(primary&&!primary.cancelled&&!primary.settled) return primary;
  return problemAffectedFlightsForRuntime(problem).find(flight=>!flight.cancelled&&!flight.settled)||primary;
}

function closeProblem(problem,t,reason,outcome,{automatic=true}={}){
  if(!problem||problem.status!=='open') return false;
  problem.status='resolved';
  problem.blocking=false;
  problem.resolvedAt=t;
  problem.automaticResolution=automatic;
  problem.autoClosedAt=automatic?t:problem.autoClosedAt||0;
  problem.autoCloseReason=automatic?reason:problem.autoCloseReason||'';
  if(outcome) problem.outcome=outcome;
  if(typeof resolveProblemImpacts==='function') resolveProblemImpacts(problem,t,'handled');
  if(typeof traceProblemTransition==='function') traceProblemTransition(problem,automatic?'auto_closed':'closed',{reason,outcome:problem.outcome||''});
  return true;
}

function allAffectedFlightsCancelledOrGone(problem){
  const ids=typeof problemAffectedFlightIds==='function'?problemAffectedFlightIds(problem):[problem.flightId].filter(Boolean);
  if(!ids.length) return false;
  return ids.every(id=>{
    const flight=state.flights.find(item=>item.id===id);
    return !flight||flight.cancelled||flight.settled;
  });
}

function problemNetworkEventActive(problem,t){
  const networkId=problem.context?.networkId||problem.scope?.subjectId||problem.sourceKey||'';
  return Boolean((state.networkEvents||[]).some(event=>{
    const id=event.networkId||event.id;
    return id===networkId&&event.status!=='cancelled'&&t>=event.activeFrom&&t<=event.activeUntil;
  }));
}

function problemContextStillActive(helperName,flight,t){
  const helper=globalThis[helperName];
  if(typeof helper!=='function') return true;
  return Boolean(helper(flight,t)?.active);
}

function aircraftStillBlockedForProblem(problem,flight,t){
  const aircraft=state.aircraft.find(item=>item.id===(problem.aircraftId||flight?.aircraftId));
  if(!aircraft) return false;
  if(problem.type==='mel_defect') return Boolean(aircraft.melItems?.some(item=>item.status==='open'));
  if(problem.type==='postflight_technical_defect') return problemContextStillActive('postflightTechnicalContextForFlight',flight,t);
  if(problem.type==='aircraft_misposition_after_diversion') return problemContextStillActive('aircraftMispositionAfterDiversionContextForFlight',flight,t);
  return Boolean(aircraft.defectUntil&&aircraft.defectUntil>t);
}

function crewStillBlockedForProblem(problem,flight,t){
  if(!flight) return false;
  if(!crewFlightCoverageStatus(flight,t).ready) return true;
  switch(problem.type){
    case 'crew_sick':
    case 'crew_fatigue_report':
      return !crewDutyForFlight(flight).legal;
    case 'no_legal_crew':
      return Boolean(typeof legalCrewConfirmationBlocker==='function'
        ? legalCrewConfirmationBlocker(problem)
        : flight.staffingBlocked);
    case 'crew_misposition_after_diversion': {
      if(CREW_ROLES.every(role=>assignedCrewRoleCount(flight,role)>=(crewRequirementForFlight(flight)[role]||0))) return false;
      return problemContextStillActive('crewMispositionAfterDiversionContextForFlight',flight,t);
    }
    default:
      return false;
  }
}

function groundStationProblemStillActive(problem,flight,t){
  if(!flight) return false;
  switch(problem.type){
    case 'night_curfew_conflict':
      return Boolean(flight.nightRestrictionConflictDelayMin);
    case 'destination_closure_ground':
      return problemContextStillActive('destinationClosureGroundContextForFlight',flight,t);
    case 'fuel_supplier_outage':
      return Boolean(problem.context?.active!==false&&!flight.departureLogged);
    case 'deicing_capacity_collapse':
      return problemContextStillActive('deicingCapacityCollapseContextForFlight',flight,t);
    case 'holdover_expired':
      return problemContextStillActive('holdoverExpiredContextForFlight',flight,t);
    case 'atc_ground_stop':
      return problemContextStillActive('atcGroundStopContextForFlight',flight,t);
    default:
      return false;
  }
}

function problemShouldClose(problem,t=simNow()){
  if(!problem||problem.status!=='open') return null;
  if(AeroProblemModel.isRetiredType(problem.type)){
    return {reason:'retired_problem',outcome:AeroProblemModel.retiredOutcomeForType(problem.type)};
  }
  if(allAffectedFlightsCancelledOrGone(problem)){
    return {reason:'affected_flights_closed',outcome:'All affected flights are cancelled, settled, or no longer in the operating window.'};
  }
  if(problem.scope?.kind==='network'&&!problemNetworkEventActive(problem,t)){
    return {reason:'network_event_cleared',outcome:'The shared network constraint is no longer active.'};
  }
  const flight=problemPrimaryFlightForRuntime(problem);
  if(!flight){
    return {reason:'flight_removed',outcome:'The affected flight is no longer in the operating plan.'};
  }
  if(flight.cancelled){
    return {reason:'flight_cancelled',outcome:`${flight.id} is cancelled.`};
  }
  const model=AeroProblemModel.problemModel(problem.type);
  if(model?.airborneOnly&&!flightIsAirborne(flight,t)){
    if(flightActualArrival(flight)<=t||flight.settled||statusOfFlight(flight,t)==='arrived'){
      applyArrivalInspectionFollowUp(problem,flight);
      return {reason:'flight_arrived',outcome:`${flight.id} has arrived; any follow-up work is now handled through Maintenance, Station, Passenger, or Personnel crew-impact tools.`};
    }
    if(flightActualDeparture(flight)>t+5*MIN){
      return {reason:'phase_invalid',outcome:'The flight is not airborne, so this in-flight problem is no longer valid.'};
    }
  }
  if(['mel_defect','postflight_technical_defect','aircraft_misposition_after_diversion'].includes(problem.type)){
    return aircraftStillBlockedForProblem(problem,flight,t)?null:{reason:'aircraft_state_cleared',outcome:'Aircraft state no longer violates this problem condition.'};
  }
  if(['crew_sick','crew_fatigue_report','no_legal_crew','crew_misposition_after_diversion'].includes(problem.type)){
    return crewStillBlockedForProblem(problem,flight,t)?null:{reason:'crew_state_cleared',outcome:'Crew state no longer violates this problem condition.'};
  }
  if(['night_curfew_conflict','destination_closure_ground','fuel_supplier_outage','deicing_capacity_collapse','holdover_expired','atc_ground_stop'].includes(problem.type)){
    return groundStationProblemStillActive(problem,flight,t)?null:{reason:'operation_state_cleared',outcome:'The live operating state no longer violates this problem condition.'};
  }
  if(model?.phase==='ground'&&flightHasDeparted(flight,t)){
    return {reason:'flight_departed',outcome:'The flight has departed; any remaining exposure is tracked by the live flight and follow-up widgets.'};
  }
  return null;
}

function refreshRequiredProblemResponse(problem,t=simNow()){
  if(!problem||problem.status!=='open') return false;
  const requirement=AeroProblemModel.requiredResponseForType(problem.type);
  if(!requirement) return false;
  let changed=startRequiredProblemResponse(problem,problem.detectedAt||t);
  const response=problem.requiredResponse;
  if(!response||response.status!=='pending'||t<response.respondsAt) return changed;
  const outcome=AeroProblemModel.responseOutcomeForProblem(problem);
  if(!outcome) return changed;
  response.status='received';
  response.receivedAt=t;
  response.outcomeId=outcome.id;
  response.title=outcome.title;
  response.detail=outcome.detail;
  response.severityLabel=outcome.severityLabel||'';
  response.decision=outcome.decision||outcome.title||'';
  response.fallbackMode=outcome.fallbackMode||'';
  if(typeof traceProblemTransition==='function'){
    traceProblemTransition(problem,'required_response_received',{
      owner:response.owner,label:response.label,outcomeId:outcome.id,title:outcome.title
    });
  }
  return true;
}

function refreshProblem(problem,t=simNow()){
  if(!problem||problem.status!=='open') return false;
  let changed=refreshRequiredProblemResponse(problem,t);
  const flight=problemPrimaryFlightForRuntime(problem);
  if(typeof ensureProblemIdentityFields==='function'){
    changed=ensureProblemIdentityFields(problem,flight,problem.context,t)||changed;
  }
  changed=processProblemDefaults(problem,t)||changed;
  const close=problemShouldClose(problem,t);
  if(close) changed=closeProblem(problem,t,close.reason,close.outcome)||changed;
  return changed;
}

function processProblems(t=simNow()){
  let changed=false;
  for(const problem of openOperationalProblems().slice()){
    if(refreshProblem(problem,t)) changed=true;
  }
  if(changed&&typeof invalidateOperationalIndex==='function') invalidateOperationalIndex();
  return changed;
}

function reconcileCrewResourceProblems(t=simNow()){
  let changed=false;
  const crewTypes=new Set(['crew_sick','crew_fatigue_report','no_legal_crew','crew_misposition_after_diversion']);
  for(const problem of openOperationalProblems()){
    if(!crewTypes.has(problem.type)) continue;
    const flight=problemPrimaryFlightForRuntime(problem);
    if(flight&&!crewStillBlockedForProblem(problem,flight,t)){
      problem.recoveredByResourceUpdate=true;
      changed=true;
    }
  }
  return processProblems(t)||changed;
}
