/* Runtime save repairs and cleanup for retired simulation concepts. */

function retireTrackedIncidents(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>AeroIncidentModel.isRetiredType(item.type)&&item.status==='open')){
    incident.status='resolved';
    incident.blocking=false;
    incident.resolvedAt=t;
    incident.automaticResolution=true;
    incident.selectedAction='tracked_on_schedule';
    incident.outcome=AeroIncidentModel.retiredOutcomeForType(incident.type);
    for(const task of incidentTasks(incident.id)){
      if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
    }
    if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'auto_closed',{reason:'retired_incident'});
    changed=true;
  }
  return changed;
}

function duplicateIncidentProgressScore(incident){
  const tasks=incidentTasks(incident.id);
  const hasActive=tasks.some(task=>['in_progress','waiting_external'].includes(task.status));
  const completed=tasks.filter(task=>task.status==='completed').length;
  return (hasActive?100:0)+completed*12+(incident.selectedStrategy?20:0)-(incident.detectedAt||0)/1e13;
}

function repairDuplicateOpenIncidents(t=simNow()){
  const groups=new Map();
  for(const incident of state.incidents||[]){
    if(incident.status!=='open'||!incident.type) continue;
    if(typeof ensureIncidentIdentityFields==='function') ensureIncidentIdentityFields(incident,null,incident.context,t);
    const scope=incident.scope||null;
    const key=scope?.kind&&scope.subjectId
      ? `${scope.kind}:${incident.type}:${scope.subjectId}`
      : incident.dedupeKey||`${incident.flightId||incident.aircraftId||incident.airport||incident.id}:${incident.type}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(incident);
  }
  let changed=false;
  for(const incidents of groups.values()){
    if(incidents.length<2) continue;
    const keeper=incidents.slice().sort((a,b)=>duplicateIncidentProgressScore(b)-duplicateIncidentProgressScore(a))[0];
    for(const duplicate of incidents){
      if(duplicate.id===keeper.id) continue;
      if((duplicate.lastDetectedAt||duplicate.detectedAt||0)>(keeper.lastDetectedAt||keeper.detectedAt||0)){
        keeper.lastDetectedAt=duplicate.lastDetectedAt||duplicate.detectedAt;
        if(duplicate.context) keeper.context=duplicate.context;
      }
      if(typeof incidentAffectedFlightIds==='function'){
        keeper.affectedFlightIds=[...new Set([...incidentAffectedFlightIds(keeper),...incidentAffectedFlightIds(duplicate)])];
      }
      duplicate.status='resolved';
      duplicate.blocking=false;
      duplicate.resolvedAt=t;
      duplicate.automaticResolution=true;
      duplicate.selectedAction='duplicate_case_merged';
      duplicate.outcome=`Merged into existing ${keeper.id} ${AeroIncidentModel.titleForType(keeper.type)} case for the same operational subject.`;
      for(const task of incidentTasks(duplicate.id)){
        if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
      }
      if(typeof traceIncidentTransition==='function') traceIncidentTransition(duplicate,'auto_closed',{reason:'duplicate_case_merged',mergedInto:keeper.id});
      changed=true;
    }
  }
  return changed;
}
