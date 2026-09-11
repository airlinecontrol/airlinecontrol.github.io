/* Problem identity, scoping, creation, and case linking. */

function incidentIsDerivedType(type,source=''){
  const model=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  return source==='derived'||model?.isDerivedType?.(type);
}

function incidentScopeKind(type){
  const model=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  return model?.scopeForType?.(type)||'';
}

function incidentAirport(type,flight,context=null){
  if(context?.airport&&AIRPORTS[context.airport]) return context.airport;
  const model=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  const role=model?.airportRoleForType?.(type)||'origin';
  if(role==='destination') return flight?flightOperationalDestination(flight):(context?.to||'');
  return flight?.from||context?.from||state.home;
}

function incidentScopeSubjectId(type,flight,context=null){
  const kind=incidentScopeKind(type);
  if(kind==='network') return context?.networkId||context?.sourceId||'network';
  if(kind==='airport') return incidentAirport(type,flight,context)||state.home;
  if(kind==='aircraft') return context?.aircraftId||flight?.aircraftId||'';
  return flight?.id||context?.flightId||context?.sourceId||'';
}

function incidentScopeForRequest(type,flight,context=null){
  const kind=incidentScopeKind(type);
  return {kind,subjectId:incidentScopeSubjectId(type,flight,context)};
}

function incidentScopeMatches(incident,scope){
  if(!incident||!scope) return false;
  const existing=incident.scope||null;
  if(existing?.kind&&existing?.subjectId) return existing.kind===scope.kind&&existing.subjectId===scope.subjectId;
  if(scope.kind==='aircraft') return incident.aircraftId===scope.subjectId;
  if(scope.kind==='airport') return incident.airport===scope.subjectId;
  if(scope.kind==='network') return (existing?.subjectId||incident.context?.networkId||incident.sourceKey||'network')===scope.subjectId;
  return incident.flightId===scope.subjectId;
}

function incidentDedupeScopeKind(type){
  const kind=incidentScopeKind(type);
  if(kind==='airport'){
    return 'airport';
  }
  return kind;
}

function incidentDedupeSubjectId(type,flight,context=null){
  const kind=incidentDedupeScopeKind(type);
  if(kind==='airport') return incidentAirport(type,flight,context)||state.home;
  if(kind==='aircraft') return context?.aircraftId||flight?.aircraftId||'';
  if(kind==='network') return context?.networkId||'network';
  return flight?.id||context?.flightId||context?.sourceId||'';
}

function incidentDedupeKeyForRequest(type,flight,{source='',sourceKey='',context=null,detectedAt=simNow()}={}){
  const kind=incidentDedupeScopeKind(type);
  const subjectId=incidentDedupeSubjectId(type,flight,context);
  if(!kind||!subjectId) return '';
  if(kind==='airport'){
    if(sourceKey&&String(sourceKey).startsWith(`${kind}:${type}:${subjectId}:`)) return String(sourceKey);
    const reason=String(context?.reason||context?.conditions||source||type).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9:_-]/g,'');
    const sourceGroup=String(sourceKey||'').replace(flight?.id||'', '').replace(/:+/g,':').replace(/^:|:$/g,'');
    return [kind,type,subjectId,sourceGroup||reason||Math.floor(detectedAt/(6*HOUR))].join(':');
  }
  return [kind,type,subjectId].join(':');
}

function incidentAffectedFlightIdsForRequest(type,flight,{scope=null,context=null,detectedAt=simNow()}={}){
  const ids=new Set();
  if(flight?.id) ids.add(flight.id);
  const contextualIds=context?.affectedFlightIds||context?.flightIds||[];
  if(Array.isArray(contextualIds)) contextualIds.forEach(id=>id&&ids.add(id));
  const resolvedScope=scope||incidentScopeForRequest(type,flight,context);
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

function incidentAffectedFlightIds(incident){
  const ids=new Set();
  if(incident?.flightId) ids.add(incident.flightId);
  if(Array.isArray(incident?.affectedFlightIds)) incident.affectedFlightIds.forEach(id=>id&&ids.add(id));
  return [...ids];
}

function incidentPrimaryFlight(incident){
  if(!incident) return null;
  const index=operationalIndex();
  if(incident.flightId) return index.flightsById.get(incident.flightId)||null;
  for(const id of incidentAffectedFlightIds(incident)){
    const flight=index.flightsById.get(id);
    if(flight) return flight;
  }
  return null;
}

function incidentAffectedFlights(incident){
  const index=operationalIndex();
  return incidentAffectedFlightIds(incident).map(id=>index.flightsById.get(id)).filter(Boolean);
}

function ensureIncidentIdentityFields(incident,flight=null,context=null,t=simNow()){
  if(!incident||!incident.type) return false;
  const primaryFlight=flight||incidentPrimaryFlight(incident);
  const resolvedContext=context||incident.context||null;
  const scope=incidentScopeForRequest(incident.type,primaryFlight,resolvedContext);
  const dedupeKey=incidentDedupeKeyForRequest(incident.type,primaryFlight,{
    source:incident.source||'',
    sourceKey:incident.sourceKey||'',
    context:resolvedContext,
    detectedAt:incident.detectedAt||t
  });
  const affectedFlightIds=incidentAffectedFlightIdsForRequest(incident.type,primaryFlight,{
    scope,context:resolvedContext,detectedAt:incident.detectedAt||t
  });
  let changed=false;
  if(!incident.scope||incident.scope.kind!==scope.kind||incident.scope.subjectId!==scope.subjectId){
    incident.scope=scope; changed=true;
  }
  if(dedupeKey&&incident.dedupeKey!==dedupeKey){ incident.dedupeKey=dedupeKey; changed=true; }
  const currentIds=incidentAffectedFlightIds(incident);
  const desiredIds=scope.kind==='network'
    ? affectedFlightIds
    : [...new Set([...currentIds,...affectedFlightIds])];
  const current=currentIds.sort().join('|');
  const next=desiredIds.sort().join('|');
  if(current!==next){ incident.affectedFlightIds=desiredIds; changed=true; }
  if(!incident.airport){
    const airport=incidentAirport(incident.type,primaryFlight,resolvedContext);
    if(airport){ incident.airport=airport; changed=true; }
  }
  return changed;
}

function incidentCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey){
  if(!candidate||candidate.status!=='open'||candidate.sourceKey&&sourceKey&&candidate.sourceKey===sourceKey) return 0;
  if(candidate.flightId===flight.id&&candidate.type===type) return 0;
  const index=operationalIndex(detectedAt);
  const candidateFlight=candidate.flightId?index.flightsById.get(candidate.flightId):null;
  let score=0;
  if(context?.sourceIncidentId&&candidate.id===context.sourceIncidentId) score+=120;
  if(context?.sourceId&&(candidate.id===context.sourceId||candidate.flightId===context.sourceId)) score+=80;
  if(context?.previousFlightId&&candidate.flightId===context.previousFlightId) score+=85;
  if(candidate.flightId===flight.id) score+=72;
  if(candidate.aircraftId&&candidate.aircraftId===flight.aircraftId) score+=34;
  if(candidate.airport&&candidate.airport===incidentAirport(type,flight,context)) score+=8;
  if(candidate.scope?.kind&&candidate.scope.kind===incidentScopeKind(type)) score+=6;
  if(!incidentIsDerivedType(candidate.type,candidate.source)) score+=20;
  if((candidate.rootProblemId||candidate.rootIncidentId)&&((candidate.rootProblemId||candidate.rootIncidentId)===candidate.id)) score+=8;
  if(candidate.detectedAt<=detectedAt) score+=10;
  else score-=18;
  if(candidateFlight&&candidateFlight.departure<=flight.departure) score+=12;
  if(candidate.type==='night_curfew_conflict'&&type==='night_curfew_conflict') score-=60;
  return score;
}

function findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey){
  if(!incidentIsDerivedType(type,source)||!flight) return null;
  if(incidentScopeKind(type)==='network') return null;
  let best=null,bestScore=0;
  for(const candidate of state.problems||state.incidents||[]){
    const score=incidentCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey);
    if(score>bestScore){ best=candidate; bestScore=score; }
  }
  return bestScore>=55?best:null;
}

function incidentChainReason(type,parent,flight,context){
  if(!parent) return '';
  if(context?.previousFlightId&&parent.flightId===context.previousFlightId) return `Knock-on from inbound ${context.previousFlightId}`;
  if(parent.flightId===flight?.id) return 'Same disrupted flight';
  if(parent.aircraftId&&parent.aircraftId===flight?.aircraftId) return 'Same aircraft rotation';
  if(parent.scope?.kind==='airport'&&parent.scope.subjectId===incidentAirport(type,flight,context)) return `Same ${parent.scope.subjectId} airport disruption`;
  if(context?.sourceId) return `Linked operational source ${context.sourceId}`;
  return 'Linked operational consequence';
}

function ensureIncidentCaseFields(incident,parent=null,flight=null,context=null){
  if(!incident) return false;
  let changed=ensureIncidentIdentityFields(incident,flight,context);
  if(parent){
    const caseId=parent.caseId||parent.id;
    const rootProblemId=parent.rootProblemId||parent.rootIncidentId||parent.id;
    if(incident.caseId!==caseId){ incident.caseId=caseId; changed=true; }
    if(incident.rootProblemId!==rootProblemId){ incident.rootProblemId=rootProblemId; changed=true; }
    if(incident.rootIncidentId!==rootProblemId){ incident.rootIncidentId=rootProblemId; changed=true; }
    if(incident.triggeredByProblemId!==parent.id){ incident.triggeredByProblemId=parent.id; changed=true; }
    if(incident.triggeredByIncidentId!==parent.id){ incident.triggeredByIncidentId=parent.id; changed=true; }
    const reason=incidentChainReason(incident.type,parent,flight||state.flights.find(item=>item.id===incident.flightId),context||incident.context||null);
    if(incident.chainReason!==reason){ incident.chainReason=reason; changed=true; }
  }else{
    if(!incident.caseId){ incident.caseId=incident.id; changed=true; }
    if(!incident.rootProblemId){ incident.rootProblemId=incident.id; changed=true; }
    if(!incident.rootIncidentId){ incident.rootIncidentId=incident.rootProblemId; changed=true; }
    if(incident.triggeredByProblemId===undefined){ incident.triggeredByProblemId=''; changed=true; }
    if(incident.triggeredByIncidentId===undefined){ incident.triggeredByIncidentId=incident.triggeredByProblemId||''; changed=true; }
    if(incident.chainReason===undefined){ incident.chainReason=''; changed=true; }
  }
  return changed;
}

function repairIncidentCaseLinks(){
  let changed=false;
  for(const incident of state.problems||state.incidents||[]) changed=ensureIncidentCaseFields(incident)||changed;
  const open=(state.problems||state.incidents||[]).filter(incident=>incident.status==='open'&&incidentIsDerivedType(incident.type,incident.source));
  for(const incident of open){
    if(incident.triggeredByProblemId||incident.triggeredByIncidentId) continue;
    const flight=incidentPrimaryFlight(incident);
    if(!flight) continue;
    const parent=findIncidentCaseParent(incident.type,flight,incident.context,incident.detectedAt||simNow(),incident.source,incident.sourceKey);
    if(parent&&parent.id!==incident.id) changed=ensureIncidentCaseFields(incident,parent,flight,incident.context)||changed;
  }
  if(changed) invalidateOperationalIndex();
  return changed;
}

function incidentCreationPhaseBlocker(type,flight,t=simNow()){
  const registry=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  const model=registry?.incidentModel?.(type);
  const definition=registry?.definitionForType?.(type);
  if(!model||!definition||!flight) return 'invalid';
  if(model.phase==='airborne'&&!flightIsAirborne(flight,t)) return 'requires_airborne';
  if(model.phase==='ground'&&flightHasDeparted(flight,t)) return 'requires_ground';
  return '';
}

function incidentIsBeforeTakeoff(type,flight,t=simNow()){
  const registry=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  const model=registry?.incidentModel?.(type);
  return Boolean(model?.phase==='airborne'&&flight&&t<flightMovementTimes(flight).takeoffAt);
}

function updateExistingIncidentForRequest(incident,type,flight,{detectedAt,sourceKey,context,source}){
  const previousContext=JSON.stringify(incident.context||null);
  const nextContext=JSON.stringify(context||incident.context||null);
  let changed=false;
  const requestAffected=incidentAffectedFlightIdsForRequest(type,flight,{
    scope:incidentScopeForRequest(type,flight,context),
    context,
    detectedAt
  });
  const mergedAffected=[...new Set([...incidentAffectedFlightIds(incident),...requestAffected])];
  if(mergedAffected.sort().join('|')!==incidentAffectedFlightIds(incident).sort().join('|')){
    incident.affectedFlightIds=mergedAffected;
    changed=true;
  }
  if(previousContext!==nextContext){ incident.context=context||incident.context||null; changed=true; }
  if(sourceKey&&!incident.sourceKey){ incident.sourceKey=sourceKey; changed=true; }
  if(source&&!incident.source){ incident.source=source; changed=true; }
  if((incident.lastDetectedAt||0)!==detectedAt){ incident.lastDetectedAt=detectedAt; changed=true; }
  const parent=(incident.triggeredByProblemId||incident.triggeredByIncidentId)?null:findIncidentCaseParent(type,flight,incident.context,detectedAt,source,sourceKey);
  changed=ensureIncidentCaseFields(incident,parent,flight,incident.context)||changed;
  if(changed) invalidateOperationalIndex();
  return incident;
}

function openIncidentCase({type,flight,training=false,detectedAt=simNow(),source='random',sourceKey='',context=null}={}){
  if(type==='destination_closure'&&flight&&!flightIsAirborne(flight,detectedAt)) type='destination_closure_ground';
  const registry=globalThis.AeroProblemModel||globalThis.AeroIncidentModel;
  const model=registry?.incidentModel?.(type);
  const definition=registry?.definitionForType?.(type);
  if(registry?.isRetiredType?.(type)||!model||!definition||!flight||flight.cancelled||flight.settled) return null;
  if(!training&&!flight.departureLogged&&model.phase!=='airborne'){
    const leadMin=definition.maxAutoLeadMin||(source==='derived'?360:180);
    if(detectedAt<flightActualDeparture(flight)-leadMin*MIN) return null;
  }
  if(incidentCreationPhaseBlocker(type,flight,detectedAt)) return null;
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
  const scope=incidentScopeForRequest(type,flight,context);
  const dedupeKey=incidentDedupeKeyForRequest(type,flight,{source,sourceKey,context,detectedAt});
  state.problems??=[];
  const duplicate=(state.problems||[]).find(incident=>
    incident.status==='open'&&incident.type===type&&(
      (dedupeKey&&incident.dedupeKey===dedupeKey)||
      incidentScopeMatches(incident,scope)||
      (incident.flightId===flight.id&&incident.type===type)
    )
  );
  if(duplicate) return updateExistingIncidentForRequest(duplicate,type,flight,{detectedAt,sourceKey,context,source});
  const id=window.AeroProblems?.createProblemId
    ? window.AeroProblems.createProblemId(state)
    : `PR${state.nextProblem++}`;
  const parent=findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey);
  const latestUsefulDeadline=Math.max(detectedAt+5*MIN,flight.departure);
  const airborne=flightIsAirborne(flight,detectedAt);
  const deadline=airborne
    ? Math.min(detectedAt+definition.decisionMin*MIN,Math.max(detectedAt+5*MIN,flightActualArrival(flight)))
    : Math.min(detectedAt+definition.decisionMin*MIN,latestUsefulDeadline);
  const affectedFlightIds=incidentAffectedFlightIdsForRequest(type,flight,{scope,context,detectedAt});
  const incident={
    id,problemId:id,entity:'problem',type,flightId:flight.id,aircraftId:flight.aircraftId,
    scope,dedupeKey,affectedFlightIds,
    airport:incidentAirport(type,flight,context),
    detectedAt,deadline,status:'open',severity:definition.severity,blocking:true,
    training:Boolean(training),selectedAction:'',resolvedAt:0,outcome:'',automaticResolution:false,
    technicalContext:['mel_defect','postflight_technical_defect'].includes(type)?technicalContextForIncident(type,id,detectedAt,context):null,
    classification:model.classification||'incident',workflowCreatedAt:0,overdue:false,
    defaultApplied:false,defaultAppliedAt:0,defaultPolicy:'',defaultOutcome:'',
    firstVisibleAt:0,autoClosedAt:0,autoCloseReason:'',
    affectedRole:type==='crew_sick'?crewSickRoleForFlight(flight):'',
    recoveryPlan:'',recoveryPlanAt:0,source,sourceKey,context,lastDetectedAt:detectedAt,impacts:[],
    caseId:parent?.caseId||parent?.id||id,
    rootProblemId:parent?.rootProblemId||parent?.rootIncidentId||parent?.id||id,
    rootIncidentId:parent?.rootIncidentId||parent?.id||id,
    triggeredByProblemId:parent?.id||'',
    triggeredByIncidentId:parent?.id||'',
    chainReason:incidentChainReason(type,parent,flight,context)
  };
  if(type==='crew_fatigue_report') incident.affectedRole=crewSickRoleForFlight(flight);
  if(['no_legal_crew','crew_fatigue_mid_rotation','crew_misposition_after_diversion','crew_report_delayed'].includes(type)) incident.affectedRole=context?.role||'captains';
  if(type==='bird_strike') incident.technicalContext=OperationalIntelligence.melFinding(`${id}:bird`,detectedAt);
  if(type==='crew_misconnect') incident.affectedRole=context?.role||'captains';
  const problem=window.AeroProblems?.normalizeProblem?.(incident)||incident;
  state.problems.push(problem);
  ensureIncidentWorkflow(problem);
  if(typeof traceIncidentTransition==='function') traceIncidentTransition(problem,'opened',{deadline,detectedAt,source,scope,reason:context?.reason||context?.trigger||''});
  if(state.problems.length>250){
    const removable=state.problems.findIndex(item=>item.status!=='open');
    if(removable>=0) state.problems.splice(removable,1);
  }
  invalidateOperationalIndex();
  return problem;
}

function createProblem(type,flight,options={}){
  return openIncidentCase({type,flight,...options});
}

function createIncident(type,flight,options={}){
  return createProblem(type,flight,options);
}
