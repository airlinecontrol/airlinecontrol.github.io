/* Runtime save repairs and cleanup for retired simulation concepts. */

function retiredIncidentOutcome(type){
  if(type==='aircraft_late_inbound') return 'Late inbound risk is tracked directly on the schedule instead of as a standalone incident.';
  if(type==='alternate_unsuitable') return 'Alternate suitability is tracked as a warning instead of as a standalone incident.';
  if(type==='destination_weather_deterioration') return 'Destination weather deterioration is tracked as a warning instead of as a standalone incident.';
  if(type==='atc_restriction') return 'ATC flow restrictions are tracked as airport-flow causes instead of standalone incidents.';
  if(type==='gate_conflict') return 'Gate and stand pressure is tracked as station-readiness warnings unless it creates a stronger operational disruption.';
  if(type==='baggage_loading_issue') return 'Load-control and baggage trouble is tracked as station-readiness delay context unless a security or cancellation decision is required.';
  if(type==='fueling_issue') return 'Routine fuel uplift constraints are tracked as station-readiness warnings; supplier outages remain incidents.';
  if(type==='airport_capacity_reduction') return 'Airport flow restrictions are tracked as warnings unless they escalate into a ground stop or another OCC decision case.';
  return 'Slot risk is tracked on the schedule and as linked disruption context instead of as a standalone incident.';
}

function retireTrackedIncidents(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>RETIRED_INCIDENT_TYPES.has(item.type)&&item.status==='open')){
    incident.status='resolved';
    incident.blocking=false;
    incident.resolvedAt=t;
    incident.automaticResolution=true;
    incident.selectedAction='tracked_on_schedule';
    incident.outcome=retiredIncidentOutcome(incident.type);
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
    if(incident.status!=='open'||!incident.flightId||!incident.type) continue;
    const key=`${incident.flightId}:${incident.type}`;
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
      duplicate.status='resolved';
      duplicate.blocking=false;
      duplicate.resolvedAt=t;
      duplicate.automaticResolution=true;
      duplicate.selectedAction='duplicate_case_merged';
      duplicate.outcome=`Merged into existing ${keeper.id} ${INCIDENT_DEFINITIONS[keeper.type]?.title||keeper.type} case for the same flight.`;
      for(const task of incidentTasks(duplicate.id)){
        if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
      }
      if(typeof traceIncidentTransition==='function') traceIncidentTransition(duplicate,'auto_closed',{reason:'duplicate_case_merged',mergedInto:keeper.id});
      changed=true;
    }
  }
  return changed;
}
