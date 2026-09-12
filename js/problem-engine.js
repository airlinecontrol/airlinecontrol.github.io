/* Problem identity, scoping, creation, and case linking. */

function problemIsDerivedType(type,source=''){
  const model=globalThis.AeroProblemModel;
  return source==='derived'||model?.isDerivedType?.(type);
}

function problemScopeKind(type){
  const model=globalThis.AeroProblemModel;
  return model?.scopeForType?.(type)||'';
}

function problemAirport(type,flight,context=null){
  if(context?.airport&&AIRPORTS[context.airport]) return context.airport;
  const model=globalThis.AeroProblemModel;
  const role=model?.airportRoleForType?.(type)||'origin';
  if(role==='destination') return flight?flightOperationalDestination(flight):(context?.to||'');
  return flight?.from||context?.from||state.home;
}

function problemScopeSubjectId(type,flight,context=null){
  const kind=problemScopeKind(type);
  if(kind==='network') return context?.networkId||context?.sourceId||'network';
  if(kind==='airport') return problemAirport(type,flight,context)||state.home;
  if(kind==='aircraft') return context?.aircraftId||flight?.aircraftId||'';
  return flight?.id||context?.flightId||context?.sourceId||'';
}

function problemScopeForRequest(type,flight,context=null){
  const kind=problemScopeKind(type);
  return {kind,subjectId:problemScopeSubjectId(type,flight,context)};
}

function problemScopeMatches(problem,scope){
  if(!problem||!scope) return false;
  const existing=problem.scope||null;
  if(existing?.kind&&existing?.subjectId) return existing.kind===scope.kind&&existing.subjectId===scope.subjectId;
  if(scope.kind==='aircraft') return problem.aircraftId===scope.subjectId;
  if(scope.kind==='airport') return problem.airport===scope.subjectId;
  if(scope.kind==='network') return (existing?.subjectId||problem.context?.networkId||problem.sourceKey||'network')===scope.subjectId;
  return problem.flightId===scope.subjectId;
}

function problemDedupeScopeKind(type){
  const kind=problemScopeKind(type);
  if(kind==='airport'){
    return 'airport';
  }
  return kind;
}

function problemDedupeSubjectId(type,flight,context=null){
  const kind=problemDedupeScopeKind(type);
  if(kind==='airport') return problemAirport(type,flight,context)||state.home;
  if(kind==='aircraft') return context?.aircraftId||flight?.aircraftId||'';
  if(kind==='network') return context?.networkId||'network';
  return flight?.id||context?.flightId||context?.sourceId||'';
}

function problemDedupeKeyForRequest(type,flight,{source='',sourceKey='',context=null,detectedAt=simNow()}={}){
  const kind=problemDedupeScopeKind(type);
  const subjectId=problemDedupeSubjectId(type,flight,context);
  if(!kind||!subjectId) return '';
  if(kind==='airport'){
    if(sourceKey&&String(sourceKey).startsWith(`${kind}:${type}:${subjectId}:`)) return String(sourceKey);
    const reason=String(context?.reason||context?.conditions||source||type).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9:_-]/g,'');
    const sourceGroup=String(sourceKey||'').replace(flight?.id||'', '').replace(/:+/g,':').replace(/^:|:$/g,'');
    return [kind,type,subjectId,sourceGroup||reason||Math.floor(detectedAt/(6*HOUR))].join(':');
  }
  return [kind,type,subjectId].join(':');
}

function problemAffectedFlightIdsForRequest(type,flight,{scope=null,context=null,detectedAt=simNow()}={}){
  const ids=new Set();
  if(flight?.id) ids.add(flight.id);
  const contextualIds=context?.affectedFlightIds||context?.flightIds||[];
  if(Array.isArray(contextualIds)) contextualIds.forEach(id=>id&&ids.add(id));
  const resolvedScope=scope||problemScopeForRequest(type,flight,context);
  if(resolvedScope.kind==='airport'&&resolvedScope.subjectId){
    const airport=resolvedScope.subjectId;
    const start=detectedAt-2*HOUR;
    const end=detectedAt+8*HOUR;
    for(const item of state.flights||[]){
      if(item.cancelled||item.settled) continue;
      if(flightActualArrival(item)<start||flightActualDeparture(item)>end) continue;
      if(item.from===airport||flightOperationalDestination(item)===airport) ids.add(item.id);
    }
  }
  return [...ids];
}

function problemAffectedFlightIds(problem){
  const ids=new Set();
  if(problem?.flightId) ids.add(problem.flightId);
  if(Array.isArray(problem?.affectedFlightIds)) problem.affectedFlightIds.forEach(id=>id&&ids.add(id));
  return [...ids];
}

function problemPrimaryFlight(problem){
  if(!problem) return null;
  const index=operationalIndex();
  if(problem.flightId) return index.flightsById.get(problem.flightId)||null;
  for(const id of problemAffectedFlightIds(problem)){
    const flight=index.flightsById.get(id);
    if(flight) return flight;
  }
  return null;
}

function problemAffectedFlights(problem){
  const index=operationalIndex();
  return problemAffectedFlightIds(problem).map(id=>index.flightsById.get(id)).filter(Boolean);
}

function ensureProblemIdentityFields(problem,flight=null,context=null,t=simNow()){
  if(!problem||!problem.type) return false;
  const primaryFlight=flight||problemPrimaryFlight(problem);
  const resolvedContext=context||problem.context||null;
  const scope=problemScopeForRequest(problem.type,primaryFlight,resolvedContext);
  const dedupeKey=problemDedupeKeyForRequest(problem.type,primaryFlight,{
    source:problem.source||'',
    sourceKey:problem.sourceKey||'',
    context:resolvedContext,
    detectedAt:problem.detectedAt||t
  });
  const affectedFlightIds=problemAffectedFlightIdsForRequest(problem.type,primaryFlight,{
    scope,context:resolvedContext,detectedAt:problem.detectedAt||t
  });
  let changed=false;
  if(!problem.scope||problem.scope.kind!==scope.kind||problem.scope.subjectId!==scope.subjectId){
    problem.scope=scope; changed=true;
  }
  if(dedupeKey&&problem.dedupeKey!==dedupeKey){ problem.dedupeKey=dedupeKey; changed=true; }
  const currentIds=problemAffectedFlightIds(problem);
  const desiredIds=scope.kind==='network'
    ? affectedFlightIds
    : [...new Set([...currentIds,...affectedFlightIds])];
  const current=currentIds.sort().join('|');
  const next=desiredIds.sort().join('|');
  if(current!==next){ problem.affectedFlightIds=desiredIds; changed=true; }
  if(!problem.airport){
    const airport=problemAirport(problem.type,primaryFlight,resolvedContext);
    if(airport){ problem.airport=airport; changed=true; }
  }
  return changed;
}

function problemCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey){
  if(!candidate||candidate.status!=='open'||candidate.sourceKey&&sourceKey&&candidate.sourceKey===sourceKey) return 0;
  if(candidate.flightId===flight.id&&candidate.type===type) return 0;
  const index=operationalIndex(detectedAt);
  const candidateFlight=candidate.flightId?index.flightsById.get(candidate.flightId):null;
  let score=0;
  if(context?.sourceProblemId&&candidate.id===context.sourceProblemId) score+=120;
  if(context?.sourceId&&(candidate.id===context.sourceId||candidate.flightId===context.sourceId)) score+=80;
  if(context?.previousFlightId&&candidate.flightId===context.previousFlightId) score+=85;
  if(candidate.flightId===flight.id) score+=72;
  if(candidate.aircraftId&&candidate.aircraftId===flight.aircraftId) score+=34;
  if(candidate.airport&&candidate.airport===problemAirport(type,flight,context)) score+=8;
  if(candidate.scope?.kind&&candidate.scope.kind===problemScopeKind(type)) score+=6;
  if(!problemIsDerivedType(candidate.type,candidate.source)) score+=20;
  if(candidate.rootProblemId===candidate.id) score+=8;
  if(candidate.detectedAt<=detectedAt) score+=10;
  else score-=18;
  if(candidateFlight&&candidateFlight.departure<=flight.departure) score+=12;
  if(candidate.type==='night_curfew_conflict'&&type==='night_curfew_conflict') score-=60;
  return score;
}

function findProblemCaseParent(type,flight,context,detectedAt,source,sourceKey){
  if(!problemIsDerivedType(type,source)||!flight) return null;
  if(problemScopeKind(type)==='network') return null;
  let best=null,bestScore=0;
  for(const candidate of state.problems||[]){
    const score=problemCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey);
    if(score>bestScore){ best=candidate; bestScore=score; }
  }
  return bestScore>=55?best:null;
}

function problemChainReason(type,parent,flight,context){
  if(!parent) return '';
  if(context?.previousFlightId&&parent.flightId===context.previousFlightId) return `Knock-on from inbound ${context.previousFlightId}`;
  if(parent.flightId===flight?.id) return 'Same disrupted flight';
  if(parent.aircraftId&&parent.aircraftId===flight?.aircraftId) return 'Same aircraft rotation';
  if(parent.scope?.kind==='airport'&&parent.scope.subjectId===problemAirport(type,flight,context)) return `Same ${parent.scope.subjectId} airport disruption`;
  if(context?.sourceId) return `Linked operational source ${context.sourceId}`;
  return 'Linked operational consequence';
}

function ensureProblemCaseFields(problem,parent=null,flight=null,context=null){
  if(!problem) return false;
  let changed=ensureProblemIdentityFields(problem,flight,context);
  if(parent){
    const caseId=parent.caseId||parent.id;
    const rootProblemId=parent.rootProblemId||parent.id;
    if(problem.caseId!==caseId){ problem.caseId=caseId; changed=true; }
    if(problem.rootProblemId!==rootProblemId){ problem.rootProblemId=rootProblemId; changed=true; }
    if(problem.triggeredByProblemId!==parent.id){ problem.triggeredByProblemId=parent.id; changed=true; }
    const reason=problemChainReason(problem.type,parent,flight||state.flights.find(item=>item.id===problem.flightId),context||problem.context||null);
    if(problem.chainReason!==reason){ problem.chainReason=reason; changed=true; }
  }else{
    if(!problem.caseId){ problem.caseId=problem.id; changed=true; }
    if(!problem.rootProblemId){ problem.rootProblemId=problem.id; changed=true; }
    if(problem.triggeredByProblemId===undefined){ problem.triggeredByProblemId=''; changed=true; }
    if(problem.chainReason===undefined){ problem.chainReason=''; changed=true; }
  }
  return changed;
}

function repairProblemCaseLinks(){
  let changed=false;
  for(const problem of state.problems||[]) changed=ensureProblemCaseFields(problem)||changed;
  const open=(state.problems||[]).filter(problem=>problem.status==='open'&&problemIsDerivedType(problem.type,problem.source));
  for(const problem of open){
    if(problem.triggeredByProblemId) continue;
    const flight=problemPrimaryFlight(problem);
    if(!flight) continue;
    const parent=findProblemCaseParent(problem.type,flight,problem.context,problem.detectedAt||simNow(),problem.source,problem.sourceKey);
    if(parent&&parent.id!==problem.id) changed=ensureProblemCaseFields(problem,parent,flight,problem.context)||changed;
  }
  if(changed) invalidateOperationalIndex();
  return changed;
}

function problemCreationPhaseBlocker(type,flight,t=simNow()){
  const registry=globalThis.AeroProblemModel;
  const model=registry?.problemModel?.(type);
  const definition=registry?.definitionForType?.(type);
  if(!model||!definition||!flight) return 'invalid';
  if(model.phase==='airborne'&&!flightIsAirborne(flight,t)) return 'requires_airborne';
  if(model.phase==='ground'&&flightHasDeparted(flight,t)) return 'requires_ground';
  return '';
}

function problemIsBeforeTakeoff(type,flight,t=simNow()){
  const registry=globalThis.AeroProblemModel;
  const model=registry?.problemModel?.(type);
  return Boolean(model?.phase==='airborne'&&flight&&t<flightMovementTimes(flight).takeoffAt);
}

function startRequiredProblemResponse(problem,requestedAt=simNow()){
  const requirement=globalThis.AeroProblemModel?.requiredResponseForType?.(problem?.type);
  if(!problem||!requirement||problem.requiredResponse) return false;
  const responseMin=globalThis.AeroProblemModel.responseDelayMinutesForProblem(problem);
  problem.requiredResponse={
    owner:requirement.owner,
    label:requirement.label,
    status:'pending',
    requestedAt,
    respondsAt:requestedAt+responseMin*MIN,
    receivedAt:0,
    outcomeId:'',
    title:'',
    detail:''
  };
  if(typeof traceProblemTransition==='function'){
    traceProblemTransition(problem,'required_response_started',{
      owner:requirement.owner,label:requirement.label,responseMin
    });
  }
  return true;
}

function updateExistingProblemForRequest(problem,type,flight,{detectedAt,sourceKey,context,source}){
  const previousContext=JSON.stringify(problem.context||null);
  const nextContext=JSON.stringify(context||problem.context||null);
  let changed=false;
  const requestAffected=problemAffectedFlightIdsForRequest(type,flight,{
    scope:problemScopeForRequest(type,flight,context),
    context,
    detectedAt
  });
  const mergedAffected=[...new Set([...problemAffectedFlightIds(problem),...requestAffected])];
  if(mergedAffected.sort().join('|')!==problemAffectedFlightIds(problem).sort().join('|')){
    problem.affectedFlightIds=mergedAffected;
    changed=true;
  }
  if(previousContext!==nextContext){ problem.context=context||problem.context||null; changed=true; }
  if(sourceKey&&!problem.sourceKey){ problem.sourceKey=sourceKey; changed=true; }
  if(source&&!problem.source){ problem.source=source; changed=true; }
  if((problem.lastDetectedAt||0)!==detectedAt){ problem.lastDetectedAt=detectedAt; changed=true; }
  const parent=problem.triggeredByProblemId?null:findProblemCaseParent(type,flight,problem.context,detectedAt,source,sourceKey);
  changed=ensureProblemCaseFields(problem,parent,flight,problem.context)||changed;
  if(changed) invalidateOperationalIndex();
  return problem;
}

function openProblemCase({type,flight,training=false,detectedAt=simNow(),source='random',sourceKey='',context=null}={}){
  if(type==='destination_closure'&&flight&&!flightIsAirborne(flight,detectedAt)) type='destination_closure_ground';
  const registry=globalThis.AeroProblemModel;
  const model=registry?.problemModel?.(type);
  const definition=registry?.definitionForType?.(type);
  if(registry?.isRetiredType?.(type)||!model||!definition||!flight||flight.cancelled||flight.settled) return null;
  if(!training&&!flight.departureLogged&&model.phase!=='airborne'){
    const leadMin=definition.maxAutoLeadMin||(source==='derived'?360:180);
    if(detectedAt<flightActualDeparture(flight)-leadMin*MIN) return null;
  }
  if(problemCreationPhaseBlocker(type,flight,detectedAt)) return null;
  if(type==='destination_closure_ground'&&!context){
    const destination=flightOperationalDestination(flight);
    const weather=Management.weatherAt(destination,flightActualArrival(flight));
    context={sourceId:flight.id,airport:destination,conditions:weather.conditions,capacityFactor:weather.capacityFactor,delayMin:Math.max(60,weather.delayMin||90),reason:'Destination unavailable before departure'};
  }
  if(type==='arrival_curfew_coordination'&&!context){
    context=arrivalCurfewContextForFlight(flight,detectedAt);
    if(!context) return null;
    sourceKey=context.sourceKey;
  }
  const scope=problemScopeForRequest(type,flight,context);
  const dedupeKey=problemDedupeKeyForRequest(type,flight,{source,sourceKey,context,detectedAt});
  state.problems??=[];
  const duplicate=(state.problems||[]).find(problem=>
    problem.status==='open'&&problem.type===type&&(
      (dedupeKey&&problem.dedupeKey===dedupeKey)||
      problemScopeMatches(problem,scope)||
      (problem.flightId===flight.id&&problem.type===type)
    )
  );
  if(duplicate) return updateExistingProblemForRequest(duplicate,type,flight,{detectedAt,sourceKey,context,source});
  const id=window.AeroProblems?.createProblemId
    ? window.AeroProblems.createProblemId(state)
    : `PR${state.nextProblem++}`;
  const parent=findProblemCaseParent(type,flight,context,detectedAt,source,sourceKey);
  const airborne=flightIsAirborne(flight,detectedAt);
  const deadline=airborne
    ? Math.max(detectedAt+10*MIN,detectedAt+definition.decisionMin*MIN)
    : Math.max(detectedAt+10*MIN,flightActualDeparture(flight));
  const affectedFlightIds=problemAffectedFlightIdsForRequest(type,flight,{scope,context,detectedAt});
  const affectedRole=['crew_sick','crew_fatigue_report'].includes(type)?crewSickRoleForFlight(flight):
    ['no_legal_crew','crew_misposition_after_diversion'].includes(type)?context?.role||'captains':'';
  const affectedCrew=affectedRole?[{role:affectedRole,count:1,family:crewRecoveryFlightFamily(flight),flightIds:affectedFlightIds}]:[];
  const rawProblem={
    id,problemId:id,entity:'problem',type,flightId:flight.id,aircraftId:flight.aircraftId,
    scope,dedupeKey,affectedFlightIds,
    airport:problemAirport(type,flight,context),
    detectedAt,deadline,status:'open',severity:definition.severity,blocking:true,
    training:Boolean(training),resolvedAt:0,outcome:'',automaticResolution:false,
    technicalContext:['mel_defect','postflight_technical_defect'].includes(type)?technicalContextForProblem(type,id,detectedAt,context):null,
    classification:model.classification||'problem',overdue:false,
    firstVisibleAt:0,autoClosedAt:0,autoCloseReason:'',
    affectedRole,affectedCrew,
    recoveryPlan:'',recoveryPlanAt:0,source,sourceKey,context,lastDetectedAt:detectedAt,impacts:[],
    caseId:parent?.caseId||parent?.id||id,
    rootProblemId:parent?.rootProblemId||parent?.id||id,
    triggeredByProblemId:parent?.id||'',
    chainReason:problemChainReason(type,parent,flight,context)
  };
  const problem=window.AeroProblems?.normalizeProblem?.(rawProblem)||rawProblem;
  if(type==='bird_strike') problem.technicalContext=OperationalIntelligence.melFinding(`${id}:bird`,detectedAt);
  state.problems.push(problem);
  if(['crew_sick','crew_fatigue_report'].includes(type)){
    const absences=recordCrewUnavailability(flight,[problem.affectedRole||'captains'],{
      reason:type==='crew_sick'?'sick':'fatigue',sourceId:problem.id,at:detectedAt
    });
    problem.affectedCrew=absences.map(item=>({role:item.role,count:item.amount,family:item.family,until:item.until,flightIds:[...item.flightIds]}));
  }
  if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'opened',{deadline,detectedAt,source,scope,reason:context?.reason||context?.trigger||''});
  startRequiredProblemResponse(problem,detectedAt);
  if(typeof processProblemDefaults==='function') processProblemDefaults(problem,detectedAt);
  if(state.problems.length>250){
    const removable=state.problems.findIndex(item=>item.status!=='open');
    if(removable>=0) state.problems.splice(removable,1);
  }
  invalidateOperationalIndex();
  return problem;
}

function createProblem(type,flight,options={}){
  return openProblemCase({type,flight,...options});
}
