/* Incident workflow execution, task progression, and default no-action handling. */

function incidentTasks(incidentId){
  return (state.coordinationTasks||[]).filter(task=>task.incidentId===incidentId);
}

function incidentDiversionDurationMs(incident,flight,aircraft,alternate){
  const elapsed=flight?.departureLogged ? Math.max(0,simNow()-flightActualDeparture(flight)) : 0;
  if(Number.isFinite(incident?.diversionDurationMs)&&incident.diversionDurationMs>0){
    return incident.diversionDurationMode==='remaining_from_anchor'
      ? elapsed+incident.diversionDurationMs
      : incident.diversionDurationMs;
  }
  const model=aircraft&&MODELS[aircraft.model];
  if(!flight||!alternate||!model) return flight ? flight.arrival-flight.departure : 0;
  if(Number.isFinite(incident?.diversionRouteKm)&&incident.diversionRouteKm>0) return diversionRouteDurationMs(incident.diversionRouteKm,model);
  const anchor=typeof diversionAnchorForIncident==='function'
    ? diversionAnchorForIncident(incident,flight,aircraft)
    : {lat:AIRPORTS[flight.from].lat,lon:AIRPORTS[flight.from].lon};
  const km=distanceKm(anchor,AIRPORTS[alternate]);
  const duration=diversionRouteDurationMs(km,model);
  return anchor.type==='aircraft' ? elapsed+duration : duration;
}

function taskRelevantToIncidentStrategy(task,incident){
  if(!incident) return task.status!=='cancelled';
  if(incident.status&&incident.status!=='open') return false;
  if(task.status==='cancelled') return false;
  if(task.branch) return incident.selectedStrategy?task.branch===incident.selectedStrategy:false;
  if(Array.isArray(task.strategies)) return incident.selectedStrategy?task.strategies.includes(incident.selectedStrategy):false;
  return true;
}

function taskBelongsToIncidentStrategy(task,incident){
  if(!incident) return true;
  if(task.branch) return incident.selectedStrategy?task.branch===incident.selectedStrategy:false;
  if(Array.isArray(task.strategies)) return incident.selectedStrategy?task.strategies.includes(incident.selectedStrategy):false;
  return true;
}

function playableIncidentTasks(incident){
  return incidentTasks(incident.id).filter(task=>task.required&&taskRelevantToIncidentStrategy(task,incident));
}

function ensureIncidentWorkflow(incident){
  if(!incident||incident.status!=='open'||!OperationalWorkflows.WORKFLOWS[incident.type]) return [];
  state.coordinationTasks??=[];
  const existing=incidentTasks(incident.id);
  const tasks=OperationalWorkflows.tasksForIncident(incident);
  if(existing.length){
    const desiredByKey=new Map(tasks.map(task=>[task.key,task]));
    for(const task of existing){
      const desired=desiredByKey.get(task.key);
      if(!desired){
        task.status='cancelled';
        task.required=false;
        continue;
      }
      task.department=desired.department; task.kind=desired.kind; task.label=desired.label; task.detail=desired.detail;
      task.dependsOn=desired.dependsOn; task.branch=desired.branch||''; task.strategies=desired.strategies||null;
      task.action=desired.action||''; task.strategyOptions=desired.strategyOptions||null;
      task.eligibility=desired.eligibility||null; task.resources=desired.resources||[];
      task.automatic=Boolean(desired.automatic); task.required=Boolean(desired.required);
      if(task.status==='blocked'&&!task.dependsOn.length) task.status='available';
    }
    const existingKeys=new Set(existing.map(task=>task.key));
    state.coordinationTasks.push(...tasks.filter(task=>!existingKeys.has(task.key)));
    unlockOperationalTasks(incident.id);
    return incidentTasks(incident.id);
  }
  state.coordinationTasks.push(...tasks);
  incident.workflowCreatedAt=simNow();
  incident.classification=OperationalWorkflows.WORKFLOWS[incident.type].classification;
  return tasks;
}

function ensureOperationalWorkflows(){
  let changed=false;
  for(const incident of state.incidents.filter(item=>item.status==='open')){
    if(!incidentTasks(incident.id).length&&ensureIncidentWorkflow(incident).length) changed=true;
  }
  return changed;
}

function repairIncidentPhaseRealism(t=simNow()){
  let changed=false;
  for(const incident of state.incidents||[]){
    if(incident.status!=='open') continue;
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) continue;
    const started=incidentTasks(incident.id).some(task=>['completed','in_progress','waiting_external'].includes(task.status));
    if(started) continue;
    if(incident.type==='postflight_technical_defect'&&!postflightTechnicalContextForFlight(flight,t)){
      incident.status='resolved';
      incident.blocking=false;
      incident.resolvedAt=t;
      incident.automaticResolution=true;
      incident.autoClosedAt=t;
      incident.autoCloseReason='phase_repair';
      incident.outcome='Closed: this post-flight defect is not valid until the inbound aircraft has arrived on-block.';
      incident.context={...(incident.context||{}),phaseRepair:'Post-flight defect closed before inbound arrival'};
      for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
      if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'auto_closed',{reason:'phase_repair'});
      changed=true;
      continue;
    }
    const beforeTakeoff=incidentIsBeforeTakeoff(incident.type,flight,t);
    if(incident.type==='destination_closure'&&beforeTakeoff){
      incident.type='destination_closure_ground';
      incident.summary=INCIDENT_DEFINITIONS.destination_closure_ground.summary;
      incident.context??={sourceId:flight.id,airport:flightOperationalDestination(flight),delayMin:90,reason:'Destination unavailable before departure'};
      incident.classification=OperationalWorkflows.WORKFLOWS.destination_closure_ground.classification;
      incident.selectedStrategy='';
      ensureIncidentWorkflow(incident);
      changed=true;
    }else if(incident.type==='bird_strike'&&beforeTakeoff){
      incident.type='mel_defect';
      incident.summary=INCIDENT_DEFINITIONS.mel_defect.summary;
      incident.context={...(incident.context||{}),phaseRepair:'Ground bird-strike report reframed as a ground technical defect'};
      incident.technicalContext=incident.technicalContext||technicalContextForIncident('mel_defect',`${incident.id}:ground`,incident.detectedAt||t,incident.context);
      incident.classification=OperationalWorkflows.WORKFLOWS.mel_defect.classification;
      incident.selectedStrategy='';
      ensureIncidentWorkflow(incident);
      changed=true;
    }else if(beforeTakeoff){
      incident.status='resolved';
      incident.blocking=false;
      incident.resolvedAt=t;
      incident.automaticResolution=true;
      incident.outcome='Closed: this airborne-only report is no longer valid because the flight has not taken off.';
      incident.context={...(incident.context||{}),phaseRepair:'Airborne-only report closed before takeoff'};
      for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
      if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'auto_closed',{reason:'phase_repair'});
      changed=true;
    }
  }
  if(changed) invalidateOperationalIndex();
  return changed;
}

function openDepartmentTasks(department){
  return (state.coordinationTasks||[]).filter(task=>{
    const incident=state.incidents.find(item=>item.id===task.incidentId);
    return task.department===department&&!['completed','cancelled'].includes(task.status)&&taskRelevantToIncidentStrategy(task,incident);
  });
}

function incidentWorkflowProgress(incident,t=simNow()){
  const tasks=playableIncidentTasks(incident);
  const completed=tasks.filter(task=>task.status==='completed').length;
  const active=tasks.find(task=>['in_progress','waiting_external'].includes(task.status));
  const available=tasks.find(task=>task.status==='available');
  return {
    completed,total:tasks.length,progress:tasks.length?completed/tasks.length:0,
    current:active||available||tasks.find(task=>task.status==='blocked')||null,
    activeProgress:active?OperationalWorkflows.progress(active,t):0
  };
}

function startOperationalTask(task,durationMin,status='in_progress',outcome=''){
  const now=simNow();
  task.status=status; task.startedAt=now; task.completesAt=now+durationMin*MIN;
  if(outcome) task.pendingOutcome=outcome;
}

function createExternalWorkflowRequest(task,counterparty,durationMin,outcome){
  const request={
    id:`XR${state.nextExternalRequest++}`,taskId:task.id,incidentId:task.incidentId,
    counterparty,submittedAt:simNow(),respondsAt:simNow()+durationMin*MIN,status:'submitted',outcome
  };
  state.externalRequests.push(request);
  task.externalRequestId=request.id;
  startOperationalTask(task,durationMin,'waiting_external',outcome);
  return request;
}

function nextSectorForCrewExtensionIncident(incident){
  const nextId=incident?.context?.nextFlightId||'';
  if(!nextId) return null;
  return state.flights.find(item=>item.id===nextId&&!item.cancelled&&!item.departureLogged)||null;
}

/* Incident resource and consequence helpers live in incident-resources.js and incident-consequences.js. */

function completeOperationalTask(task,outcome=''){
  task.status='completed'; task.completedAt=simNow(); task.completesAt=task.completedAt;
  task.outcome=outcome||task.pendingOutcome||task.outcome||'Completed';
  delete task.pendingOutcome;
  unlockOperationalTasks(task.incidentId);
  const incident=state.incidents.find(item=>item.id===task.incidentId);
  if(incident) finalizeOperationalCase(incident);
}

function unlockOperationalTasks(incidentId){
  const tasks=incidentTasks(incidentId);
  const incident=state.incidents.find(item=>item.id===incidentId);
  let changed=true;
  while(changed){
    changed=false;
    for(const task of tasks){
      if(task.status!=='blocked'||!taskRelevantToIncidentStrategy(task,incident)) continue;
      if(!task.dependsOn.every(id=>tasks.some(other=>other.id===id&&['completed','cancelled'].includes(other.status)))) continue;
      task.status='available'; changed=true;
      if(task.automatic&&task.kind==='crew_report'){
        const allocation=tasks.find(item=>item.kind==='crew_allocation');
        const reportMin=allocation?.selection?.reportMin||25;
        startOperationalTask(task,reportMin,'in_progress',`Replacement crew reports after ${reportMin} minutes.`);
      }
    }
  }
}

function selectIncidentStrategy(incident,strategy){
  incident.selectedStrategy=strategy;
  for(const task of incidentTasks(incident.id)){
    if((task.branch&&task.branch!==strategy)||(Array.isArray(task.strategies)&&!task.strategies.includes(strategy))){
      if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
    }
  }
}

function finalizeOperationalCase(incident){
  if(!incident||incident.status!=='open') return false;
  const tasks=playableIncidentTasks(incident);
  if(!tasks.length||tasks.some(task=>task.status!=='completed')) return false;
  const flight=state.flights.find(item=>item.id===incident.flightId);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight) return false;
  if(incident.type==='crew_sick'){
    const allocation=tasks.find(task=>task.kind==='crew_allocation');
    applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
    incident.outcome=`Replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} reported and the crew plan was updated.`;
  }else if(['mel_defect','postflight_technical_defect'].includes(incident.type)){
    if(incident.selectedStrategy==='schedule_check') incident.outcome=`Maintenance check scheduled for ${incident.maintenanceCheckTail||aircraft?.tail||'aircraft'}.`;
    else if(incident.selectedStrategy==='substitute') incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned and the technical disruption was recovered.`;
    else incident.outcome=`Defect deferred under MEL ${incident.technicalContext?.code||''}; dispatch accepted the restrictions.`;
  }else if(incident.type==='maintenance_resource_unavailable'){
    if(incident.selectedStrategy==='send_mobile_team') incident.outcome=`Mobile maintenance team dispatched to ${incident.mobileMaintenanceAirport||flight.from}; local check scheduling is now available when the team arrives.`;
    else if(incident.selectedStrategy==='ferry_to_maintenance') incident.outcome=`Maintenance ferry ${incident.maintenanceFerryId||''} planned to ${incident.maintenanceFerryAirport||'a maintenance-capable station'}.`;
    else if(incident.selectedStrategy==='substitute') incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned while the original aircraft awaits maintenance support.`;
    else incident.outcome='Maintenance-resource recovery path recorded.';
  }else if(['airport_capacity_reduction','atc_ground_stop'].includes(incident.type)){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||45);
    incident.outcome=incident.atcOutcome||'Returned airport flow opportunity incorporated into the operating plan.';
  }else if(incident.type==='night_curfew_conflict'){
    if(incident.selectedStrategy==='change_departure'){
      const plan=nightDepartureChangePlanState(incident);
      if(!plan.ready) return false;
      flight.nightRecoveryDecision='manual_departure_change';
      flight.nightRecoverySourceKey=incident.context?.sourceKey||'';
      flight.nightRecoveryApprovedAt=simNow();
      incident.outcome=`${flight.id} manually retimed in Dispatch. ${plan.reason}`;
    }else{
      const context=nightCurfewConflictContextForFlight(flight,flightActualDeparture(flight))||incident.context;
      if(!context?.sourceKey) return false;
      flight.nightRecoveryDecision='reschedule_after_curfew';
      flight.nightRecoverySourceKey=context.sourceKey;
      flight.nightRecoveryApprovedAt=simNow();
      incident.outcome=`${flight.id} rescheduled after night restrictions${context.restrictionSummary?`: ${context.restrictionSummary}`:''}; first feasible departure ${formatTime(context.nextDeparture)}.`;
    }
  }else if(incident.type==='arrival_curfew_coordination'){
    const context=arrivalCurfewContextForFlight(flight,simNow())||incident.context;
    if(!context?.sourceKey) return false;
    flight.arrivalCurfewCoordinatedKey=context.sourceKey;
    flight.arrivalCurfewCoordinatedAt=simNow();
    incident.outcome=`${context.affectedAirport||flightOperationalDestination(flight)} curfew arrival acceptance coordinated for expected arrival ${formatTime(context.expectedArrival||flightActualArrival(flight))}.`;
  }else if(incident.type==='gate_conflict'){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||30);
    incident.outcome=incident.stationOutcome||'Replacement stand and ground movement coordinated.';
  }else if(incident.type==='destination_closure'){
    const alternate=incident.selectedAlternate;
    if(!alternate||!aircraft) return false;
    flight.diversionAirport=alternate;
    flight.operationalDurationMs=incidentDiversionDurationMs(incident,flight,aircraft,alternate);
    flight.weatherChecked=false;
    incident.outcome=alternate===flight.from
      ? `Captain and ATC accepted return to ${alternate}; handling confirmed and the diversion plan was updated.`
      : `Captain and ATC accepted ${alternate}; alternate handling confirmed and the diversion plan was updated.`;
  }else if(incident.type==='destination_closure_ground'){
    if(incident.selectedStrategy==='alternate_destination'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incidentDiversionDurationMs(incident,flight,aircraft,alternate);
      flight.weatherChecked=false;
      incident.outcome=`OCC re-planned ${flight.id} to ${alternate} before departure because ${incident.context?.airport||flight.to} was unavailable.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||90);
      incident.outcome=`OCC held ${flight.id} on the ground until ${incident.context?.airport||flight.to} can accept the flight.`;
    }
  }else if(['aircraft_out_of_position','aircraft_misposition_after_diversion'].includes(incident.type)){
    if(incident.selectedStrategy==='substitute'){
      incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned to protect the out-of-position departure.`;
    }else{
      const plan=positioningFerryPlanState(incident);
      if(!plan.ready) return false;
      incident.positioningFerryId=plan.ferry?.id||incident.positioningFerryId||'';
      incident.outcome=incident.positioningFerryId
        ? `Positioning ferry ${incident.positioningFerryId} brings ${plan.aircraft.tail} to ${plan.to} before ${flight.id}.`
        : `${plan.aircraft.tail} is projected at ${plan.to}; positioning conflict cleared.`;
    }
  }else if(incident.type==='no_legal_crew'){
    incident.outcome='Legal crew availability confirmed after personnel/resources were updated.';
  }else if(incident.type==='crew_misconnect'){
    if(incident.selectedStrategy==='replace'){
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Local replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} assigned after the crew misconnect.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome='Connecting crew ETA accepted and the revised departure was published.';
    }
  }else if(['crew_misposition_after_diversion','crew_report_delayed'].includes(incident.type)){
    if(incident.selectedStrategy==='replace'){
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Local replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} assigned and the crew plan was updated.`;
    }else if(['move_crew','move_reserve'].includes(incident.selectedStrategy)){
      const plan=crewRelocationPlanState(incident);
      if(!plan.ready) return false;
      applyIncidentMinimumDelay(flight,Math.max(0,incident.context?.delayMin||0));
      incident.outcome=`${PERSONNEL[plan.role]?.label||'Crew'} positioning confirmed at ${plan.to}.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome='Crew report / positioning ETA accepted and the revised departure was published.';
    }
  }else if(['crew_duty_risk','crew_fatigue_report','crew_fatigue_mid_rotation'].includes(incident.type)){
    if(incident.selectedStrategy==='augment'){
      flight.crewAugmented=true;
      incident.outcome='Augmented crew assigned and the crew plan was updated.';
    }else{
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} reported and the crew plan was updated.`;
    }
  }else if(incident.type==='crew_duty_extension'){
    flight.crewDutyExtensionRecordedAt=simNow();
    flight.crewDutyExtensionOverrunMin=incident.context?.overrunMin||0;
    if(incident.selectedStrategy==='protect_next'){
      const next=state.flights.find(item=>item.id===incident.context?.nextFlightId);
      if(next){
        next.recoveryAction=`Reserve crew protected after ${flight.id} duty extension`;
        next.issueAcknowledgedAt=0;
        next.issueAcknowledgedKey='';
      }
      flight.crewStandDownPlannedAt=simNow();
      incident.outcome=next
        ? `Crew duty extension recorded; current crew stands down on arrival and ${next.id} is protected with reserve crew.`
        : 'Crew duty extension recorded; current crew stands down on arrival.';
    }else if(incident.selectedStrategy==='priority'){
      flight.crewDutyPriorityRequestedAt=simNow();
      incident.outcome='Priority-handling reply recorded and the crew duty extension / post-arrival review plan was filed.';
    }else{
      incident.outcome='Commander discretion / unforeseen duty extension recorded; current crew continues to safe landing with post-arrival review.';
    }
  }else if(['baggage_loading_issue','fueling_issue','fuel_supplier_outage','security_screening','deicing_required','deicing_capacity_collapse','holdover_expired'].includes(incident.type)){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||20);
    incident.outcome=incident.stationOutcome||'Station recovery completed and the operating plan was updated.';
  }else if(incident.type==='performance_limited'){
    if(incident.selectedStrategy==='substitute'){
      incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned with enough dispatch performance margin.`;
    }else if(incident.selectedStrategy==='payload_reduce'){
      const pct=incident.payloadReductionPct||incident.context?.payloadReductionPct||10;
      const originalPax=Number(flight.pax)||0;
      const remove=Math.min(originalPax,Math.max(1,Math.ceil(originalPax*pct/100)));
      flight.pax=Math.max(0,originalPax-remove);
      if(flight.classPax?.economy) flight.classPax.economy=Math.max(0,flight.classPax.economy-remove);
      flight.revenue=Math.round((Number(flight.revenue)||0)*(originalPax?flight.pax/originalPax:1));
      if(flight.economics){ flight.economics.revenue=flight.revenue; refreshEconomicsTotals(flight); }
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||20);
      incident.outcome=`Payload reduced by about ${pct}% and dispatch performance margin restored.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||45);
      incident.outcome='Departure delayed for a better performance window.';
    }
  }else if(incident.type==='destination_handling_unavailable'){
    if(incident.selectedStrategy==='prepare_alternate'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incidentDiversionDurationMs(incident,flight,aircraft,alternate);
      flight.weatherChecked=false;
      incident.outcome=`Handling alternate ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome=incident.selectedStrategy==='request_handling'
      ? `${flightOperationalDestination(flight)} handling acceptance secured.`
      : 'Departure held until destination handling can accept the aircraft.';
    }
  }else if(incident.type==='onboard_medical'){
    if(incident.selectedStrategy==='divert'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incidentDiversionDurationMs(incident,flight,aircraft,alternate);
      incident.outcome=`Medical diversion to ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else{
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Flight continued with medical advice and arrival assistance confirmed.';
    }
  }else if(['inflight_technical_fault','fuel_margin_low','atc_holding_fuel_conflict','unruly_passenger','destination_weather_deterioration','destination_below_minima','alternate_unsuitable','diversion_airport_unavailable','lightning_strike','bird_strike','pressurization_issue'].includes(incident.type)){
    if(['divert','return_origin','reselect'].includes(incident.selectedStrategy)){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incidentDiversionDurationMs(incident,flight,aircraft,alternate);
      flight.weatherChecked=false;
      incident.outcome=incident.selectedStrategy==='return_origin'
        ? `Return to ${alternate} coordinated with flight deck, ATC, and station handling.`
        : `Diversion to ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else if(['fuel_margin_low','atc_holding_fuel_conflict'].includes(incident.type)){
      if(incident.selectedStrategy==='direct') flight.enrouteDelayMin=Math.max(0,Math.min(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||10));
      flight.fuelMarginReviewed=true;
      incident.outcome=incident.selectedStrategy==='conserve'
        ? 'Fuel-conservation profile coordinated and landing fuel monitoring continues.'
        : 'ATC shortcut or priority request coordinated and the fuel watch plan was recorded.';
    }else if(incident.type==='unruly_passenger'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||15);
      incident.outcome='Flight continued with arrival security/law-enforcement reception coordinated.';
    }else if(incident.type==='destination_weather_deterioration'){
      if(incident.selectedStrategy==='hold') flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome=incident.selectedStrategy==='hold'
        ? 'Destination holding plan and diversion trigger point coordinated.'
        : 'Destination weather monitoring plan recorded with flight deck.';
    }else if(incident.type==='destination_below_minima'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Destination minima hold and diversion trigger point coordinated with flight deck.';
    }else if(incident.type==='alternate_unsuitable'){
      incident.outcome='Alternate suitability monitoring plan recorded with flight deck.';
    }else if(incident.type==='diversion_airport_unavailable'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Diversion-airport holding plan and next decision trigger coordinated with flight deck.';
    }else if(['lightning_strike','bird_strike'].includes(incident.type)){
      const destination=flightOperationalDestination(flight);
      flight.arrivalInspectionRequired=true;
      incident.outcome=`Flight continued with ${destination} arrival inspection arranged.`;
    }else if(incident.type==='pressurization_issue'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||25);
      incident.outcome='Lower-altitude continuation coordinated with fuel monitoring and arrival support.';
    }else{
      incident.outcome='Inflight technical monitoring completed and the amended flight-watch plan was recorded.';
    }
  }else if(incident.type==='airborne_atc_reroute'){
    const delay=Math.max(5,incident.coordinatedDelayMin||incident.context?.delayMin||15);
    flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.outcome=incident.selectedStrategy==='direct'
      ? 'Shorter ATC routing coordinated and revised arrival estimate published.'
      : 'ATC reroute accepted and revised arrival estimate published.';
  }
  resolveIncidentImpacts(incident,simNow(),incident.selectedStrategy&&['wait_inbound','accept_next','accept'].includes(incident.selectedStrategy)?'accepted':'handled');
  if(typeof recordResolvedIncidentRecoveryCost==='function') recordResolvedIncidentRecoveryCost(incident);
  incident.status='resolved'; incident.blocking=false; incident.resolvedAt=simNow();
  incident.selectedAction='workflow_complete'; incident.automaticResolution=false;
  for(const task of incidentTasks(incident.id)){
    if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
  }
  for(const assignment of state.resourceAssignments||[]){
    if(assignment.incidentId===incident.id) assignment.status='committed';
  }
  return true;
}

function processOperationalWorkflows(t=simNow()){
  let changed=ensureOperationalWorkflows();
  for(const task of state.coordinationTasks||[]){
    if(!['in_progress','waiting_external'].includes(task.status)||!task.completesAt||t<task.completesAt) continue;
    if(task.externalRequestId){
      const request=state.externalRequests.find(item=>item.id===task.externalRequestId);
      if(request){ request.status='responded'; request.respondedAt=t; }
    }
    if(['maintenance_disposition','maintenance_repair'].includes(task.kind)&&task.selection?.action==='repair'){
      const incident=state.incidents.find(item=>item.id===task.incidentId);
      const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
      const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
      if(aircraft){ aircraft.defectUntil=0; aircraft.defectReason=''; aircraft.condition=clamp((aircraft.condition??100)+5,0,100); }
    }
    completeOperationalTask(task); changed=true;
  }
  for(const incident of state.incidents.filter(item=>item.status==='open')){
    unlockOperationalTasks(incident.id);
    if(finalizeOperationalCase(incident)) changed=true;
  }
  return changed;
}

function applyIncidentAircraftSubstitution(incident,optionId){
  const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
  const options=incident.type==='fuel_supplier_outage' ? fuelSupplierReplacementOptions(incident) : incidentAircraftReplacementOptions(incident);
  const option=options.find(item=>item.id===optionId);
  if(!flight||!option) return toast('No suitable replacement aircraft is available. Request or position an aircraft in Dispatch.');
  const replacement=state.aircraft.find(item=>item.id===option.aircraftId);
  const original=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!replacement) return false;
  const {service,outbound,returnFlight}=rotationForFlight(flight);
  const target=service&&outbound?outbound:flight;
  const targets=[target,service&&returnFlight&&target.id===outbound?.id?returnFlight:null].filter(Boolean);

  if(option.mode==='position'){
    createFlightRecord({
      aircraftId:replacement.id,from:replacement.location,to:target.from,
      departure:option.ferryDeparture,fare:0,flightType:'ferry'
    });
  }

  for(const item of targets){
    item.aircraftId=replacement.id;
    clearAircraftSpecificDelay(item);
    item.positioningDelayMin=Math.max(item.positioningDelayMin||0,option.delayMin||0);
    item.recoveryAction=`Replacement aircraft ${replacement.tail} assigned`;
  }
  if(original){
    original.defectUntil=Math.max(original.defectUntil||0,simNow()+180*MIN);
    original.defectReason=incident.technicalContext?.label||'Technical defect';
    original.condition=clamp((original.condition??100)-4,0,100);
  }
  incident.replacementAircraftId=replacement.id;
  incident.replacementAircraftTail=replacement.tail;
  incident.replacementMode=option.mode;
  incident.replacementFerryId=option.ferryId||'';
  incident.replacementDelayMin=option.delayMin||0;
  return option;
}

function applyTurnaroundExpedite(flight){
  flight.turnaroundRecoveryMin=Math.max(Number(flight.turnaroundRecoveryMin)||0,15);
  if(flight.handlingDelayMin) flight.handlingDelayMin=Math.max(0,flight.handlingDelayMin-10);
  flight.recoveryAction='Priority turnaround resources assigned';
}

const STATION_RECOVERY_EFFECTS={
  baggage_expedite:{delay:15,outcome:'Ramp control prioritized baggage loading and load-control closeout.'},
  baggage_reload:{delay:35,outcome:'Baggage was reloaded and reconciled before closeout.'},
  baggage_offload:{delay:20,outcome:'Affected bags were offloaded and passenger-service follow-up was opened.'},
  hold_screening:{delay:30,outcome:'Airport security completed rescreening before departure.'},
  offload_passenger:{delay:25,outcome:'Affected passenger and baggage were offloaded and the manifest was corrected.'},
  priority:{delay:10,outcome:'Fuel provider accepted priority fueling.'},
  fuel_outage_priority:{delay:20,outcome:'Fuel provider accepted escalation and dispatched limited fuel capacity.'},
  wait_truck:{delay:35,outcome:'Fuel truck delay accepted and fuel completion time updated.'},
  wait_supply:{delay:75,outcome:'Fuel supplier outage recovery ETA accepted and departure plan updated.'},
  minimum_uplift:{delay:15,outcome:'Minimum compliant fuel uplift confirmed with dispatch.'},
  tanker_inbound:{delay:10,outcome:'Inbound tanker fuel coordinated; departure protected without relying on local fuel supply.'},
  deice:{delay:25,outcome:'Aircraft deicing completed and a holdover window was started.'},
  priority_deice:{delay:15,outcome:'Station accepted priority deicing and a holdover window was started.'},
  deice_queue:{delay:60,outcome:'Aircraft entered the constrained deicing queue and a treatment sequence was confirmed.'},
  wait_weather:{delay:45,outcome:'Flight held until snow/ice exposure improves.'},
  redeice:{delay:25,outcome:'Repeat deicing completed and a new holdover window was started.'},
  wait_deice_slot:{delay:35,outcome:'Flight held for the next available deicing treatment slot.'}
};

function authorityDecisionForIncident(task,incident,flight){
  const options=(task.strategyOptions||[]).map(option=>option.id);
  const has=id=>options.includes(id);
  const choose=id=>has(id)?id:(options[0]||'');
  const roll=OperationalIntelligence.stableUnit(`${incident.id}:${task.key}:authority`);
  const context=incident.context||{};
  const progress=Number.isFinite(context.phasePct)?context.phasePct/100:flightProgress(flight,simNow());
  const hasAlternate=diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length>0;
  const hasReturn=diversionOptionsForIncident(incident,{onlyReturnOrigin:true}).length>0;
  const poorFuel=Number(context.marginPct||100)<75;
  const highDelay=Number(context.delayMin||context.holdingDelayMin||0)>=25;
  const poorWeather=context.level==='severe'||Number(context.capacityFactor||1)<.72||Number(context.capacityPct||100)<72;
  const poorCondition=Number(context.aircraftCondition||100)<78||context.maintenanceDue===true;
  let strategy='';
  if(context.authorityDecision&&has(context.authorityDecision)) strategy=context.authorityDecision;
  if(strategy) return {
    strategy,
    counterparty:task.action==='medical'?'Medical advisory / flight deck':'Flight deck',
    durationMin:task.action==='medical'?7:6,
    outcome:{
      continue:'Flight deck continues to destination',
      continue_low:'Flight deck continues at lower altitude',
      divert:'Flight deck requests diversion',
      direct:'Flight deck requests priority or shortcut',
      conserve:'Flight deck accepts fuel-conservation profile',
      hold:'Flight deck/ATC will hold under fuel watch',
      monitor:'Flight deck accepts monitored continuation',
      alternate:'Flight deck requests an alternate',
      return_origin:'Flight deck requests return to origin',
      reselect:'Flight deck requests a new diversion airport'
    }[strategy]||`Authority response received: ${strategy}.`
  };
  switch(incident.type){
    case 'destination_closure':
      strategy=hasReturn&&(progress<.35||!hasAlternate||roll<.25)?'return_origin':'alternate';
      break;
    case 'onboard_medical':
      strategy=hasAlternate&&progress<.82&&roll<.48?'divert':'continue';
      break;
    case 'inflight_technical_fault':
      strategy=hasAlternate&&(poorCondition||roll<.32||progress<.25)?'divert':'continue';
      break;
    case 'fuel_margin_low':
      strategy=hasReturn&&progress<.45&&(poorFuel||!hasAlternate||roll<.22)?'return_origin':hasAlternate&&(poorFuel||roll<.35)?'divert':roll<.72?'direct':'conserve';
      break;
    case 'atc_holding_fuel_conflict':
      strategy=hasAlternate&&(poorFuel||Number(context.holdingDelayMin||0)>=35||roll<.42)?'divert':'direct';
      break;
    case 'unruly_passenger':
      strategy=hasAlternate&&roll<.36?'divert':'continue';
      break;
    case 'destination_weather_deterioration':
      strategy=poorWeather&&hasAlternate?'divert':highDelay||roll<.38?'hold':'monitor';
      break;
    case 'destination_below_minima':
      strategy=hasAlternate&&(progress>.35||!hasReturn||roll>.18)?'divert':hasReturn?'return_origin':'hold';
      break;
    case 'alternate_unsuitable':
      strategy=hasAlternate?'reselect':hasReturn?'return_origin':'monitor';
      break;
    case 'diversion_airport_unavailable':
      strategy=hasAlternate?'reselect':hasReturn?'return_origin':'hold';
      break;
    case 'lightning_strike':
      strategy=hasAlternate&&(context.severity==='severe'||poorCondition||roll<.28)?'divert':'continue';
      break;
    case 'bird_strike':
      strategy=hasReturn&&progress<.35&&(poorCondition||roll<.4)?'return_origin':hasAlternate&&(poorCondition||roll<.58)?'divert':'continue';
      break;
    case 'pressurization_issue':
      strategy=hasAlternate&&(progress<.78||poorFuel||roll<.72)?'divert':'continue_low';
      break;
    default:
      strategy=options[Math.floor(roll*Math.max(1,options.length))]||'';
  }
  strategy=choose(strategy);
  const labels={
    continue:'Flight deck continues to destination',
    continue_low:'Flight deck continues at lower altitude',
    divert:'Flight deck requests diversion',
    direct:'Flight deck requests priority or shortcut',
    conserve:'Flight deck accepts fuel-conservation profile',
    hold:'Flight deck/ATC will hold under fuel watch',
    monitor:'Flight deck accepts monitored continuation',
    alternate:'Flight deck requests an alternate',
    return_origin:'Flight deck requests return to origin',
    reselect:'Flight deck requests a new diversion airport'
  };
  const counterparty=task.action==='medical'?'Medical advisory / flight deck':'Flight deck';
  return {
    strategy,
    counterparty,
    durationMin:task.action==='medical'?7:6,
    outcome:labels[strategy]||`Authority response received: ${strategy}.`
  };
}

function performImmediateRecoveryStrategy(task,incident,flight,action){
  if(!['dispatch-capacity-strategy','dispatch-groundstop-strategy','station-stand-strategy'].includes(task.key)) return false;
  selectIncidentStrategy(incident,action);
  task.selection={strategy:action};
  if(task.key==='dispatch-capacity-strategy'){
    const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||30);
    if(action==='accept'){
      incident.coordinatedDelayMin=base;
      incident.atcOutcome=`Reduced airport-flow sequence accepted with a ${base}-minute ground delay.`;
      completeOperationalTask(task,incident.atcOutcome);
      return true;
    }
    if(action==='priority'){
      incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
      incident.atcOutcome=`Airport flow returned an earlier opportunity with a ${incident.coordinatedDelayMin}-minute delay.`;
      createExternalWorkflowRequest(task,'Airport flow control',15,incident.atcOutcome);
      return true;
    }
  }else if(task.key==='dispatch-groundstop-strategy'){
    if(action==='hold_ground'){
      const delay=Math.max(35,incident.context?.delayMin||flight.airspaceDelayMin||flight.airportDelayMin||45);
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=`Ground stop held at origin with a ${delay}-minute release estimate.`;
      createExternalWorkflowRequest(task,'ATC flow management',12,incident.atcOutcome);
      return true;
    }
    if(action==='priority'){
      const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30);
      incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
      incident.atcOutcome=`Flow management returned an earlier release with a ${incident.coordinatedDelayMin}-minute delay.`;
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
      return true;
    }
  }else if(task.key==='station-stand-strategy'){
    const options={
      remote:{delay:20,duration:10,outcome:'Airport allocated a remote stand with passenger bussing.'},
      tow:{delay:30,duration:15,outcome:'Airport allocated a replacement gate requiring an aircraft tow.'},
      wait_gate:{delay:45,duration:20,outcome:'Airport retained the planned gate after a 45-minute hold.'}
    };
    const option=options[action];
    if(!option) return false;
    incident.coordinatedDelayMin=option.delay;
    incident.stationOutcome=option.outcome;
    createExternalWorkflowRequest(task,'Airport stand control',option.duration,option.outcome);
    return true;
  }
  return false;
}

function performOperationalTask(taskId,actionId='',payload={}){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  const incident=task&&state.incidents.find(item=>item.id===task.incidentId&&item.status==='open');
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
  if(!task||!incident||!flight||!['available','in_progress'].includes(task.status)) return false;
  const blocker=['technical_strategy','recovery_strategy'].includes(task.kind)?'':AeroIncidentResources.taskResourceBlocker(task,incident);
  if(blocker) return toast(blocker);
  if(['technical_strategy','recovery_strategy','authority_decision'].includes(task.kind)&&actionId==='cancel'){
    const strategyBlocker=AeroIncidentResources.branchStrategyOptionBlocker(task,incident,'cancel');
    if(strategyBlocker) return toast(strategyBlocker);
    selectIncidentStrategy(incident,'cancel');
    task.selection={strategy:'cancel'};
    task.status='completed';
    task.completedAt=simNow();
    task.completesAt=task.completedAt;
    task.outcome='Flight cancelled as the selected incident recovery.';
    if(incident.type==='night_curfew_conflict') cancelSingleFlight(flight.id,{skipConfirm:true,reason:INCIDENT_DEFINITIONS[incident.type]?.title||incident.type});
    else cancelFlight(flight.id,{skipConfirm:true,reason:INCIDENT_DEFINITIONS[incident.type]?.title||incident.type});
    return true;
  }
  if(task.kind==='crew_allocation'){
    const option=crewPoolOptions(incident).find(item=>item.id===payload.optionId);
    if(!option) return toast('That personnel pool is no longer available.');
    const assignment={id:`RA${state.nextResourceAssignment++}`,incidentId:incident.id,taskId:task.id,flightId:flight.id,
      role:option.role,base:option.airport,operatingAirport:flight.from,amount:1,family:option.family,
      assignedAt:simNow(),reportAt:simNow()+option.reportMin*MIN,releaseAt:flightCrewRelease(flight)+10*HOUR,status:'assigned'};
    state.resourceAssignments.push(assignment);
    flight.crewRoleSwaps??={};
    flight.crewRoleSwaps[option.role]={role:option.role,assignmentId:assignment.id,airport:option.airport,assignedAt:simNow()};
    task.selection={...option,assignmentId:assignment.id};
    completeOperationalTask(task,`${option.label} assigned.`);
  }else if(task.kind==='crew_augmentation'){
    const blocker=AeroIncidentResources.crewAugmentationBlocker(incident);
    if(blocker) return toast(blocker);
    task.selection={action:'augment',reportMin:25};
    startOperationalTask(task,25,'in_progress','Augmented crew reports and completes briefing.');
  }else if(task.kind==='crew_next_sector_replacement'){
    const next=nextSectorForCrewExtensionIncident(incident);
    if(!next) return toast('No unflown downstream sector is available for crew replacement.');
    const duty=swapCrewForFlight(next.id);
    if(!duty) return false;
    task.selection={flightId:next.id,dutyId:duty.id,airport:next.from};
    completeOperationalTask(task,`${next.id} protected with local reserve crew at ${next.from}.`);
  }else if(task.kind==='maintenance_inspection'){
    startOperationalTask(task,25,'in_progress','Engineering inspection completed.');
  }else if(task.kind==='authority_decision'){
    const decision=authorityDecisionForIncident(task,incident,flight);
    if(!decision.strategy) return false;
    selectIncidentStrategy(incident,decision.strategy);
    task.selection={...decision};
    createExternalWorkflowRequest(task,decision.counterparty,decision.durationMin,decision.outcome);
  }else if(task.kind==='technical_strategy'||task.kind==='recovery_strategy'){
    const options=(task.strategyOptions||[
      {id:'defer'},{id:'schedule_check'},{id:'substitute'}
    ]).map(option=>option.id);
    if(!options.includes(actionId)) return false;
    const strategyBlocker=AeroIncidentResources.branchStrategyOptionBlocker(task,incident,actionId);
    if(strategyBlocker) return toast(strategyBlocker);
    if(performImmediateRecoveryStrategy(task,incident,flight,actionId)){
      processOperationalWorkflows(simNow()); recalculateOperations(); AeroServices.commit();
      return true;
    }
    selectIncidentStrategy(incident,actionId);
    task.selection={strategy:actionId};
    completeOperationalTask(task,`${task.label}: ${actionId}.`);
  }else if(task.kind==='maintenance_defer'||task.kind==='maintenance_disposition'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(task.kind==='maintenance_defer'||actionId==='defer'){
      if(incident.technicalContext?.deferAllowed===false) return toast('This technical finding is not deferrable under MEL. Schedule a maintenance check or use a replacement aircraft.');
      const finding=incident.technicalContext||OperationalIntelligence.melFinding(incident.id,incident.detectedAt);
      aircraft.melItems??=[];
      if(!aircraft.melItems.some(item=>item.id===finding.id)) aircraft.melItems.push({...finding,status:'open',deferredAt:simNow()});
      aircraft.condition=clamp((aircraft.condition??100)-3,0,100);
      incident.selectedStrategy='defer'; task.selection={action:'defer',finding};
      completeOperationalTask(task,`Deferred under MEL ${finding.code} with documented restrictions.`);
    }else if(actionId==='repair'){
      incident.selectedStrategy='repair'; task.selection={action:'repair'};
      aircraft.defectUntil=Math.max(aircraft.defectUntil||0,simNow()+120*MIN); aircraft.defectReason='Technical defect under repair';
      startOperationalTask(task,120,'in_progress','Repair completed and engineering sign-off recorded.');
    }else return false;
  }else if(task.kind==='maintenance_repair'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!aircraft) return false;
    if(actionId&&actionId!=='repair') return false;
      incident.selectedStrategy='repair'; task.selection={action:'repair'};
      aircraft.defectUntil=Math.max(aircraft.defectUntil||0,simNow()+120*MIN); aircraft.defectReason='Technical defect under repair';
      startOperationalTask(task,120,'in_progress','Repair completed and engineering sign-off recorded.');
  }else if(task.kind==='maintenance_check_scheduling'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!aircraft) return false;
    const requestedStart=Number(payload.start)||Math.max(simNow(),flightActualDeparture(flight)-30*MIN);
    const plan=scheduleMaintenanceCheckForAircraft(aircraft.id,requestedStart,{
      skipConfirm:true,
      allowFlightConflict:true,
      preserveIncidentId:incident.id,
      reason:`${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}: ${incident.technicalContext?.title||'technical finding'}`
    });
    if(!plan) return false;
    incident.selectedStrategy='schedule_check';
    incident.maintenanceCheckAircraftId=aircraft.id;
    incident.maintenanceCheckTail=aircraft.tail;
    incident.maintenanceCheckStart=plan.start;
    incident.maintenanceCheckEnd=plan.end;
    aircraft.defectUntil=Math.max(aircraft.defectUntil||0,plan.end);
    aircraft.defectReason=incident.technicalContext?.title||'Maintenance check required';
    task.selection={action:'schedule_check',start:plan.start,end:plan.end,aircraftId:aircraft.id};
    completeOperationalTask(task,`${aircraft.tail} maintenance check scheduled ${formatTime(plan.start)}-${formatTime(plan.end)}.`);
    recalculateOperations();
    AeroServices.persist();
  }else if(task.kind==='mobile_maintenance_team'){
    const plan=applyMobileMaintenanceTeam(incident);
    if(!plan) return false;
    incident.mobileMaintenanceSource=plan.source;
    incident.mobileMaintenanceAirport=plan.airport;
    incident.mobileMaintenanceArrivesAt=plan.arrivesAt;
    incident.mobileMaintenanceCost=plan.cost;
    task.selection={action:'send_mobile_team',source:plan.source,airport:plan.airport,responseMin:plan.responseMin,cost:plan.cost};
    createExternalWorkflowRequest(task,'Mobile maintenance control',plan.responseMin,`${plan.source} mobile team available at ${plan.airport}; schedule the check locally.`);
  }else if(task.kind==='maintenance_clearance'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(aircraft){ aircraft.defectUntil=0; aircraft.defectReason=''; aircraft.condition=clamp((aircraft.condition??100)-1,0,100); }
    task.selection={action:'release'};
    completeOperationalTask(task,'Engineering recorded no-damage clearance.');
  }else if(task.kind==='aircraft_substitution'){
    const option=applyIncidentAircraftSubstitution(incident,payload.optionId);
    if(!option) return false;
    task.selection=option;
    completeOperationalTask(task,`${option.label} assigned as replacement aircraft.`);
  }else if(task.kind==='manual_ferry_required'){
    const plan=positioningFerryPlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    incident.selectedStrategy='position_ferry';
    incident.positioningFerryId=plan.ferry?.id||'';
    task.selection={action:'check_ferry',ferryFlightId:incident.positioningFerryId,projectedLocation:plan.projection?.location||''};
    completeOperationalTask(task,incident.positioningFerryId?`Positioning ferry ${incident.positioningFerryId} confirmed.`:'Aircraft projection confirmed at origin.');
  }else if(task.kind==='manual_maintenance_ferry_required'){
    const plan=maintenanceFerryPlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    incident.selectedStrategy='ferry_to_maintenance';
    incident.maintenanceFerryId=plan.ferry?.id||'';
    incident.maintenanceFerryAirport=plan.to;
    task.selection={action:'check_maintenance_ferry',ferryFlightId:incident.maintenanceFerryId,to:plan.to};
    completeOperationalTask(task,incident.maintenanceFerryId?`Maintenance ferry ${incident.maintenanceFerryId} confirmed to ${plan.to}.`:`${plan.aircraft?.tail||'Aircraft'} maintenance positioning confirmed.`);
  }else if(task.kind==='manual_crew_move_required'){
    const plan=crewRelocationPlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    task.selection={action:'check_crew_move',transferId:plan.transfer?.id||'',role:plan.role,to:plan.to};
    completeOperationalTask(task,plan.transfer?`${plan.transfer.id} positions ${PERSONNEL[plan.role]?.label?.toLowerCase()||'crew'} to ${plan.to}.`:`Qualified ${PERSONNEL[plan.role]?.label?.toLowerCase()||'crew'} confirmed at ${plan.to}.`);
  }else if(task.kind==='manual_departure_change_required'){
    const plan=nightDepartureChangePlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    task.selection={action:'check_departure_change',actualDeparture:flightActualDeparture(flight),restrictionSummary:plan.restrictionSummary||''};
    completeOperationalTask(task,plan.reason);
  }else if(task.kind==='atc_coordination'){
    const action=actionId||task.action;
    if(action==='accept'){
      const delay=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30);
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=incident.type==='atc_ground_stop'
        ? `Ground-stop release estimate accepted with a ${delay}-minute departure hold.`
        : `Reduced airport-flow sequence accepted with a ${delay}-minute ground delay.`;
      task.selection={action:'accept'}; completeOperationalTask(task,incident.atcOutcome);
    }else if(action==='hold_ground'){
      const delay=Math.max(35,incident.context?.delayMin||flight.airspaceDelayMin||flight.airportDelayMin||45);
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=`Ground stop held at origin with a ${delay}-minute release estimate.`;
      task.selection={action,delayMin:delay};
      completeOperationalTask(task,incident.atcOutcome);
    }else if(action==='priority'){
      const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30);
      incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
      incident.atcOutcome=incident.type==='atc_ground_stop'
        ? `Flow management returned an earlier release with a ${incident.coordinatedDelayMin}-minute delay.`
        : `Airport flow returned an earlier opportunity with a ${incident.coordinatedDelayMin}-minute delay.`;
      task.selection={action:'priority'};
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
    }else return false;
  }else if(task.kind==='stand_request'){
    const action=actionId||task.action;
    const options={remote:{delay:20,duration:10,outcome:'Airport allocated a remote stand with passenger bussing.'},tow:{delay:30,duration:15,outcome:'Airport allocated a replacement gate requiring an aircraft tow.'},wait_gate:{delay:45,duration:20,outcome:'Airport retained the planned gate after a 45-minute hold.'}};
    const option=options[action]; if(!option) return false;
    incident.coordinatedDelayMin=option.delay; incident.stationOutcome=option.outcome; task.selection={action};
    createExternalWorkflowRequest(task,'Airport stand control',option.duration,option.outcome);
  }else if(task.kind==='inbound_wait'){
    const delay=incident.context?.inboundDelayMin||incident.context?.delayMin||flightTotalDepartureDelayMin(flight)||15;
    incident.coordinatedDelayMin=Math.max(15,delay);
    task.selection={action:actionId||task.action||'wait_inbound',delayMin:incident.coordinatedDelayMin};
    const prefix=['aircraft_out_of_position','aircraft_misposition_after_diversion'].includes(incident.type)?'Aircraft positioning':
      ['crew_misconnect','crew_misposition_after_diversion','crew_report_delayed'].includes(incident.type)?'Crew timing':
        incident.type==='destination_handling_unavailable'?'Destination handling':'Timing';
    completeOperationalTask(task,`${prefix} accepted with ${incident.coordinatedDelayMin} minutes projected delay.`);
  }else if(task.kind==='turnaround_expedite'){
    applyTurnaroundExpedite(flight);
    incident.coordinatedDelayMin=Math.max(0,(incident.context?.inboundDelayMin||flightTotalDepartureDelayMin(flight)||20)-15);
    task.selection={action:'expedite_turn'};
    createExternalWorkflowRequest(task,'Station turnaround control',10,'Ground resources reprioritized for an expedited turn.');
  }else if(['station_recovery','fuel_recovery','security_coordination'].includes(task.kind)){
    const action=actionId||task.action;
    const effect=STATION_RECOVERY_EFFECTS[action];
    if(!effect) return false;
    const delay=action==='deice_queue'?Math.max(effect.delay,incident.context?.queueMin||incident.context?.delayMin||0):
      action==='wait_supply'?Math.max(effect.delay,incident.context?.delayMin||0):
      action==='fuel_outage_priority'?Math.max(effect.delay,Math.round((incident.context?.delayMin||45)*.35)):
      effect.delay;
    const outcome=action==='deice_queue'&&incident.context?.demand
      ? `Station sequenced ${incident.context.demand} deicing-demand departures; treatment queue accepted.`
      : effect.outcome;
    if(task.kind==='fuel_recovery'&&action==='tanker_inbound'){
      const plan=applyFuelOutageTankerPlan(incident);
      if(!plan) return false;
      incident.fuelTankerPlan={mode:plan.mode,previousFlightId:plan.previousFlightId||'',targetFuelGal:plan.targetFuelGal,extraFuelGal:plan.extraFuelGal,cost:plan.cost};
    }else if(task.kind==='fuel_recovery'&&['priority','fuel_outage_priority','minimum_uplift'].includes(action)){
      fuelFlight(flight,simNow(),true);
    }
    if(task.kind==='security_coordination'&&action==='offload_passenger'&&flight.pax>0){
      flight.pax=Math.max(0,flight.pax-1);
      if(flight.classPax?.economy) flight.classPax.economy=Math.max(0,flight.classPax.economy-1);
    }
    if(task.kind==='station_recovery'&&['deice','priority_deice','redeice'].includes(action)){
      flight.deicingCompletedAt=simNow()+delay*MIN;
      flight.deicingHoldoverUntil=flight.deicingCompletedAt+35*MIN;
    }
    incident.coordinatedDelayMin=delay;
    incident.stationOutcome=outcome;
    task.selection={action,delayMin:delay};
    createExternalWorkflowRequest(task,task.kind==='fuel_recovery'?'Fuel provider':task.kind==='security_coordination'?'Airport security':'Station ramp control',Math.max(8,Math.ceil(delay/2)),outcome);
  }else if(task.kind==='performance_coordination'){
    const action=actionId||task.action;
    if(action==='payload_reduce'){
      const pct=incident.context?.payloadReductionPct||12;
      incident.payloadReductionPct=pct;
      incident.coordinatedDelayMin=20;
      task.selection={action,payloadReductionPct:pct,delayMin:20};
      createExternalWorkflowRequest(task,'Load control / station',10,`Payload reduction of about ${pct}% coordinated with load control.`);
    }else if(action==='delay_conditions'){
      const delay=Math.max(30,incident.context?.delayMin||45);
      incident.coordinatedDelayMin=delay;
      task.selection={action,delayMin:delay};
      completeOperationalTask(task,`Performance window delay accepted with ${delay} minutes projected delay.`);
    }else return false;
  }else if(task.kind==='destination_handling'){
    const destination=flightOperationalDestination(flight);
    const action=actionId||task.action||'request_handling';
    incident.coordinatedDelayMin=15;
    task.selection={action,airport:destination,delayMin:15};
    createExternalWorkflowRequest(task,`${destination} station / handler`,12,`${destination} confirms stand, ramp, and passenger-handling acceptance.`);
  }else if(task.kind==='alternate_selection'){
    const option=diversionOptionsForIncident(incident,{includeReturnOrigin:false}).find(item=>item.code===payload.airport);
    if(!option) return toast('That alternate is no longer operationally suitable.');
    incident.selectedAlternate=option.code;
    incident.diversionReturnOrigin=Boolean(option.returnOrigin);
    incident.diversionRouteKm=option.km;
    incident.diversionDurationMs=option.duration;
    incident.diversionDurationMode=option.durationMode||'total_from_origin';
    incident.diversionAnchor=option.anchor||null;
    incident.diversionFuel=option.fuel;
    task.selection={airport:option.code,returnOrigin:Boolean(option.returnOrigin),fuel:option.fuel};
    completeOperationalTask(task,`${option.returnOrigin?'Return to origin':option.code} selected; flight deck, ATC, and handling coordination bundled into the recovery plan.`);
  }else if(task.kind==='return_origin_selection'){
    const option=diversionOptionsForIncident(incident,{onlyReturnOrigin:true})[0];
    if(!option) return toast('Return to origin is not currently suitable.');
    incident.selectedAlternate=option.code;
    incident.diversionReturnOrigin=true;
    incident.diversionRouteKm=option.km;
    incident.diversionDurationMs=option.duration;
    incident.diversionDurationMode=option.durationMode||'total_from_origin';
    incident.diversionFuel=option.fuel;
    incident.diversionAnchor=option.anchor||null;
    task.selection={airport:option.code,returnOrigin:true,fuel:option.fuel};
    completeOperationalTask(task,`Return to ${option.code} confirmed; flight deck, ATC, and handling coordination bundled into the recovery plan.`);
  }else if(task.kind==='flightdeck_recommendation'){
    if(!incident.selectedAlternate) return false;
    task.selection={airport:incident.selectedAlternate};
    createExternalWorkflowRequest(task,'Flight deck',6,incident.diversionReturnOrigin?`Captain accepts return to ${incident.selectedAlternate}.`:`Captain accepts ${incident.selectedAlternate} as the operational alternate.`);
  }else if(task.kind==='diversion_clearance'){
    createExternalWorkflowRequest(task,'ATC via flight crew',8,incident.diversionReturnOrigin?`ATC clears the flight to return to ${incident.selectedAlternate}.`:`ATC clears the flight to ${incident.selectedAlternate} via an amended route.`);
  }else if(task.kind==='alternate_handling'){
    createExternalWorkflowRequest(task,`${incident.selectedAlternate} station / handler`,12,incident.diversionReturnOrigin?`${incident.selectedAlternate} confirms return stand and handling acceptance.`:`${incident.selectedAlternate} confirms stand and handling acceptance.`);
  }else if(task.kind==='medical_assessment'){
    createExternalWorkflowRequest(task,'Medical advisory service',5,'Medical advisory service returned operational guidance.');
  }else if(task.kind==='medical_coordination'){
    incident.coordinatedDelayMin=20;
    createExternalWorkflowRequest(task,'Destination station medical support',8,'Destination medical assistance confirmed for arrival.');
  }else if(task.kind==='flight_watch_assessment'){
    createExternalWorkflowRequest(task,'Flight deck / maintenance control',6,'Flight deck status and maintenance-control guidance received.');
  }else if(task.kind==='flight_watch_coordination'){
    const action=actionId||task.action;
    const delay=action==='hold'?20:action==='continue_low'?25:action==='monitor'?10:12;
    if(['hold','continue_low'].includes(action)) flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.coordinatedDelayMin=delay;
    task.selection={action};
    createExternalWorkflowRequest(task,'Flight deck / ATC coordination',8,`${task.label} confirmed.`);
  }else if(task.kind==='crew_extension_record'){
    const action=actionId||task.action||'record_extension';
    task.selection={action,overrunMin:incident.context?.overrunMin||0,projectedRelease:incident.context?.projectedRelease||0};
    const message=action==='stand_down'
      ? 'Crew Control confirmed stand-down on arrival and post-duty review.'
      : 'Duty extension recorded with flight deck / Crew Control for post-arrival review.';
    createExternalWorkflowRequest(task,'Flight deck / Crew Control',5,message);
  }else if(task.kind==='fuel_monitoring'){
    const action=actionId||task.action||'assess';
    if(action==='conserve') flight.fuelConservationApplied=true;
    incident.fuelMarginContext=fuelMarginContextForFlight(flight,simNow());
    task.selection={action,context:incident.fuelMarginContext};
    createExternalWorkflowRequest(task,'Flight crew fuel monitoring',6,action==='conserve'?'Fuel-conservation profile accepted.':'Fuel state and projected landing margin confirmed.');
  }else if(task.kind==='reroute_coordination'){
    const action=actionId||task.action;
    const baseDelay=Math.max(8,incident.context?.delayMin||15);
    const delay=action==='direct'?Math.max(5,Math.round(baseDelay*.45)):baseDelay;
    flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.coordinatedDelayMin=delay;
    task.selection={action,delayMin:delay};
    createExternalWorkflowRequest(task,'ATC via flight crew',10,action==='direct'?'ATC returned a shorter routing opportunity.':'ATC amended route accepted and arrival estimate updated.');
  }else if(task.kind==='cabin_security_coordination'){
    const action=actionId||task.action||'assess';
    if(action==='continue'){
      incident.coordinatedDelayMin=15;
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,15);
    }
    task.selection={action};
    createExternalWorkflowRequest(task,action==='continue'?'Destination security':'Flight deck / cabin lead',8,action==='continue'?'Destination security meet confirmed.':'Cabin security status confirmed.');
  }else if(task.kind==='arrival_maintenance_check'){
    const destination=flightOperationalDestination(flight);
    task.selection={airport:destination};
    createExternalWorkflowRequest(task,`${destination} station / maintenance`,12,'Arrival inspection and post-flight technical hold arranged.');
  }else if(task.kind==='station_coordination'){
    completeOperationalTask(task,'Ground movement, equipment, and passenger handling coordinated.');
  }else return false;
  processOperationalWorkflows(simNow()); recalculateOperations(); AeroServices.commit();
  return true;
}

function applyIncidentMinimumDelay(f,minutes){
  f.incidentDelayMin=Math.max(Number(f.incidentDelayMin)||0,minutes);
}

function incidentDefaultPolicyForType(type){
  if(RETIRED_INCIDENT_TYPES.has(type)) return {mode:'none',label:'none',summary:'This incident type is retired.'};
  return INCIDENT_DEFAULT_POLICIES[type]||{mode:'manual_required_no_auto_fix',label:'manual required',summary:'No automatic recovery exists for this case. The flight remains held until the player takes the required OCC action.'};
}

function defaultPolicyForIncident(incident){
  if(!incident) return null;
  const base=incidentDefaultPolicyForType(incident.type);
  if(!base||base.mode==='none') return base;
  const flight=state.flights.find(item=>item.id===incident.flightId);
  if(incident.type==='destination_handling_unavailable'&&flight?.departureLogged){
    return {mode:'flightdeck_default',label:'coordinate arrival',summary:'If OCC does not complete the case before the deadline, the airborne flight continues under flight-watch coordination while destination handling acceptance is recorded.'};
  }
  return base;
}

function incidentDefaultPolicyLabel(incident){
  const policy=defaultPolicyForIncident(incident);
  return policy&&policy.mode!=='none' ? policy.label||policy.mode : '';
}

function incidentDefaultPolicySummary(incident){
  const policy=defaultPolicyForIncident(incident);
  return policy&&policy.mode!=='none' ? policy.summary||'' : '';
}

function incidentHasUserActionStarted(incident){
  return incidentTasks(incident.id).some(task=>
    ['completed','in_progress','waiting_external'].includes(task.status)||Boolean(task.selection)
  );
}

function markIncidentDefault(incident,policy,t,outcome){
  let changed=false;
  if(!incident.defaultApplied){ incident.defaultApplied=true; changed=true; }
  if(!Number.isFinite(incident.defaultAppliedAt)||!incident.defaultAppliedAt){ incident.defaultAppliedAt=t; changed=true; }
  if(incident.defaultPolicy!==policy.mode){ incident.defaultPolicy=policy.mode; changed=true; }
  if(incident.defaultOutcome!==outcome){ incident.defaultOutcome=outcome; changed=true; }
  if(!incident.overdue){ incident.overdue=true; changed=true; }
  if(!incident.deadlineMissedAt){ incident.deadlineMissedAt=t; changed=true; }
  return changed;
}

function closeIncidentByDefault(incident,policy,t,outcome,{impactStatus='handled',strategy='default'}={}){
  markIncidentDefault(incident,policy,t,outcome);
  if(strategy) incident.selectedStrategy=strategy;
  resolveIncidentImpacts(incident,t,impactStatus);
  incident.status='resolved';
  incident.blocking=false;
  incident.resolvedAt=t;
  incident.selectedAction='default_policy';
  incident.automaticResolution=true;
  incident.outcome=outcome;
  for(const task of incidentTasks(incident.id)){
    if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
  }
  if(typeof recordResolvedIncidentRecoveryCost==='function') recordResolvedIncidentRecoveryCost(incident);
  if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'auto_closed',{reason:'default_policy',policy:policy.mode,outcome});
  return true;
}

function defaultRollingGroundDelay(flight,t){
  return Math.max(15,Math.ceil((t+15*MIN-flight.departure)/(15*MIN))*15);
}

function defaultDelayMinutes(incident,flight,policy,t){
  return Math.max(
    policy.delayMin||0,
    incident.coordinatedDelayMin||0,
    Number(incident.context?.delayMin)||0,
    flight&&!flight.departureLogged?defaultRollingGroundDelay(flight,t):0,
    20
  );
}

function applyDefaultDelay(incident,policy,t){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  if(!flight||flight.cancelled) return false;
  const delay=defaultDelayMinutes(incident,flight,policy,t);
  const strategy=policy.strategy||'accept';
  incident.coordinatedDelayMin=Math.max(Number(incident.coordinatedDelayMin)||0,delay);
  if(flight.departureLogged) flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
  else applyIncidentMinimumDelay(flight,delay);
  return closeIncidentByDefault(
    incident,policy,t,
    `${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}: no OCC action before deadline; ${delay}-minute ${flight.departureLogged?'en-route':'ground'} delay accepted.`,
    {impactStatus:'accepted',strategy}
  );
}

function applyDefaultHold(incident,policy,t){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  if(!flight||flight.cancelled) return false;
  const outcome=policy.mode==='manual_required_no_auto_fix'
    ? `${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}: no automatic recovery is available. The flight remains held until the required resource/action is provided.`
    : `${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}: held after the deadline; OCC action is still required.`;
  let changed=markIncidentDefault(incident,policy,t,outcome);
  if(!flight.departureLogged){
    const delay=defaultRollingGroundDelay(flight,t);
    if((flight.incidentDelayMin||0)<delay){ flight.incidentDelayMin=delay; changed=true; }
  }
  return changed;
}

function applyDefaultCancellation(incident,policy,t){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  if(!flight||flight.cancelled) return false;
  if(typeof flightCanBeCancelled==='function'&&!flightCanBeCancelled(flight,t)){
    const fallback={mode:'manual_required_no_auto_fix',label:'manual required',summary:'Default cancellation is not possible after departure; the case remains open for OCC coordination.'};
    return applyDefaultHold(incident,fallback,t);
  }
  const targets=(incident.type==='night_curfew_conflict'?[flight]:flightCancellationTargets(flight))
    .filter(item=>item&&flightCanBeCancelled(item,t));
  const reason=`Default no-action decision: ${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}`;
  for(const target of targets){
    applyFlightCancellation(target,reason,{preserveIncidentId:target.id===flight.id?incident.id:''});
  }
  const outcome=targets.length>1
    ? `${targets.map(item=>item.id).join(' and ')} cancelled by default because no OCC action was completed before the decision deadline.`
    : `${flight.id} cancelled by default because no OCC action was completed before the decision deadline.`;
  return closeIncidentByDefault(incident,policy,t,outcome,{impactStatus:'handled',strategy:'cancel'});
}

function setDefaultDiversionTarget(incident,flight,strategy){
  const onlyReturnOrigin=strategy==='return_origin';
  const includeReturnOrigin=onlyReturnOrigin;
  let options=diversionOptionsForIncident(incident,{includeReturnOrigin,onlyReturnOrigin});
  if(strategy==='reselect'&&flight.diversionAirport) options=options.filter(option=>option.code!==flight.diversionAirport);
  const selected=options[0];
  if(!selected) return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  incident.selectedAlternate=selected.code;
  incident.diversionRouteKm=selected.km||incident.diversionRouteKm||0;
  incident.diversionDurationMode=selected.durationMode||'total_from_origin';
  incident.diversionAnchor=selected.anchor||null;
  incident.diversionDurationMs=selected.duration||incidentDiversionDurationMs(incident,flight,aircraft,selected.code);
  incident.diversionFuelRequiredGal=selected.fuel?.required||0;
  flight.diversionAirport=selected.code;
  flight.operationalDurationMs=incident.diversionDurationMs;
  flight.weatherChecked=false;
  return selected;
}

const DEFAULT_FLIGHTDECK_MANUAL_FOLLOWUP_STRATEGIES=new Set(['alternate','divert','return_origin','reselect']);

function completeDefaultPrerequisitesForTask(task,incident,outcome,t){
  const tasks=incidentTasks(incident.id);
  for(const dependencyId of task.dependsOn||[]){
    const dependency=tasks.find(item=>item.id===dependencyId);
    if(!dependency||dependency.status==='completed') continue;
    dependency.status='completed';
    dependency.completedAt=t;
    dependency.completesAt=t;
    dependency.selection={defaultApplied:true};
    dependency.outcome=outcome;
  }
}

function applyDefaultFlightdeckManualFollowup(incident,policy,t,task,decision){
  const outcome=`${decision.outcome}; OCC follow-up is still required before the flight is rerouted.`;
  markIncidentDefault(incident,policy,t,outcome);
  completeDefaultPrerequisitesForTask(task,incident,'Deadline passed; flight deck response became the controlling input.',t);
  selectIncidentStrategy(incident,decision.strategy);
  task.status='completed';
  task.completedAt=t;
  task.completesAt=t;
  task.selection={...decision,defaultApplied:true,manualFollowupRequired:true};
  task.outcome=outcome;
  incident.status='open';
  incident.blocking=true;
  incident.selectedAction='default_policy_pending_occ';
  incident.automaticResolution=false;
  incident.outcome=outcome;
  unlockOperationalTasks(incident.id);
  if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'default_applied',{policy:policy.mode,strategy:decision.strategy,outcome,manualFollowupRequired:true});
  return true;
}

function reopenSilentDefaultFlightdeckFollowups(t=simNow()){
  let changed=false;
  for(const incident of state.incidents||[]){
    if(
      incident.status!=='resolved' ||
      incident.defaultPolicy!=='flightdeck_default' ||
      incident.selectedAction!=='default_policy' ||
      !DEFAULT_FLIGHTDECK_MANUAL_FOLLOWUP_STRATEGIES.has(incident.selectedStrategy)
    ) continue;
    const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled&&!item.settled);
    if(!flight) continue;
    incident.status='open';
    incident.blocking=true;
    incident.resolvedAt=0;
    incident.automaticResolution=false;
    incident.selectedAction='default_policy_pending_occ';
    incident.outcome=`Previous automatic ${incident.selectedStrategy} decision reopened for OCC follow-up${flight.diversionAirport?`; current operational destination is ${flight.diversionAirport}`:''}.`;
    ensureIncidentWorkflow(incident);
    const tasks=incidentTasks(incident.id);
    const decisionTask=tasks.find(item=>item.kind==='authority_decision')
      ||tasks.find(item=>item.kind==='recovery_strategy');
    if(decisionTask){
      completeDefaultPrerequisitesForTask(decisionTask,incident,'Previous automatic flight-deck decision restored as case context.',t);
      selectIncidentStrategy(incident,incident.selectedStrategy);
      decisionTask.status='completed';
      decisionTask.completedAt=t;
      decisionTask.completesAt=t;
      decisionTask.selection={strategy:incident.selectedStrategy,defaultApplied:true,manualFollowupRequired:true};
      decisionTask.outcome=incident.outcome;
    }
    for(const task of tasks){
      if(task===decisionTask||task.status==='completed') continue;
      if(taskBelongsToIncidentStrategy(task,incident)){
        task.status=task.dependsOn?.length?'blocked':'available';
        task.startedAt=0; task.completesAt=0; task.completedAt=0; task.selection=null; task.outcome='';
      }else{
        task.status='cancelled';
      }
    }
    unlockOperationalTasks(incident.id);
    if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'reopened',{reason:'silent_default_flightdeck_followup',strategy:incident.selectedStrategy});
    changed=true;
  }
  return changed;
}

function applyDefaultFlightdeckConsequence(incident,flight,decision,t){
  const strategy=decision.strategy||'';
  incident.selectedStrategy=strategy;
  incident.coordinatedDelayMin=Math.max(Number(incident.coordinatedDelayMin)||0,Number(incident.context?.delayMin)||0,20);
  if(['alternate','divert','return_origin','reselect'].includes(strategy)){
    const target=setDefaultDiversionTarget(incident,flight,strategy);
    if(!target) return {ok:false,outcome:`${decision.outcome||'Flight deck response recorded'}, but no suitable ${strategy==='return_origin'?'return':'alternate'} resource is available. The case remains blocking for manual OCC action.`};
    return {ok:true,outcome:strategy==='return_origin'
      ? `${decision.outcome||'Flight deck requests return to origin'}; return to ${target.code} recorded by default.`
      : `${decision.outcome||'Flight deck requests diversion'}; ${target.code} selected from available alternates by default.`};
  }
  if(incident.type==='crew_duty_extension'){
    flight.crewDutyExtensionRecordedAt=t;
    flight.crewDutyExtensionOverrunMin=incident.context?.overrunMin||0;
    flight.crewStandDownPlannedAt=t;
    return {ok:true,outcome:'Airborne crew duty extension recorded by default for safe completion of the current flight; downstream crew recovery remains visible.'};
  }
  if(incident.type==='arrival_curfew_coordination'){
    const context=arrivalCurfewContextForFlight(flight,t)||incident.context;
    flight.arrivalCurfewCoordinatedKey=context?.sourceKey||incident.sourceKey||'default';
    flight.arrivalCurfewCoordinatedAt=t;
    return {ok:true,outcome:`${context?.affectedAirport||flightOperationalDestination(flight)} curfew arrival acceptance recorded by default for the airborne flight.`};
  }
  if(['direct','conserve','hold','monitor','continue','continue_low','accept'].includes(strategy)){
    const delay=['direct','conserve','monitor','continue'].includes(strategy)?10:incident.coordinatedDelayMin;
    flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    if(['fuel_margin_low','atc_holding_fuel_conflict'].includes(incident.type)) flight.fuelMarginReviewed=true;
    if(['lightning_strike','bird_strike','inflight_technical_fault'].includes(incident.type)) flight.arrivalInspectionRequired=true;
    return {ok:true,outcome:decision.outcome||'Flight deck plan recorded by default.'};
  }
  return {ok:true,outcome:decision.outcome||'Flight-watch plan recorded by default.'};
}

function applyDefaultFlightdeckDecision(incident,policy,t){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  if(!flight||flight.cancelled) return false;
  const task=incidentTasks(incident.id).find(item=>item.kind==='authority_decision')
    || incidentTasks(incident.id).find(item=>item.kind==='recovery_strategy')
    || {id:`${incident.id}:default`,key:'default',action:'flightdeck',strategyOptions:[]};
  const decision=authorityDecisionForIncident(task,incident,flight);
  if(DEFAULT_FLIGHTDECK_MANUAL_FOLLOWUP_STRATEGIES.has(decision.strategy)){
    return applyDefaultFlightdeckManualFollowup(incident,policy,t,task,decision);
  }
  const applied=applyDefaultFlightdeckConsequence(incident,flight,decision,t);
  if(!applied.ok){
    return applyDefaultHold(incident,{...policy,mode:'manual_required_no_auto_fix',label:'manual required',summary:applied.outcome},t);
  }
  return closeIncidentByDefault(incident,policy,t,applied.outcome,{impactStatus:'handled',strategy:decision.strategy||'flightdeck_default'});
}

function applyIncidentDefaultPolicy(incident,t=simNow()){
  if(!incident||incident.status!=='open'||t<incident.deadline) return false;
  const policy=defaultPolicyForIncident(incident);
  if(!policy||policy.mode==='none') return false;
  if(incidentHasUserActionStarted(incident)) return false;
  if(incident.defaultApplied&&policy.mode!=='hold_until_resolved'&&policy.mode!=='manual_required_no_auto_fix') return false;
  if(policy.mode==='cancel_after_deadline') return applyDefaultCancellation(incident,policy,t);
  if(policy.mode==='accept_delay') return applyDefaultDelay(incident,policy,t);
  if(policy.mode==='hold_until_resolved'||policy.mode==='manual_required_no_auto_fix') return applyDefaultHold(incident,policy,t);
  if(policy.mode==='flightdeck_default') return applyDefaultFlightdeckDecision(incident,policy,t);
  return applyDefaultHold(incident,{...policy,mode:'manual_required_no_auto_fix'},t);
}

function processIncidentDeadlines(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>item.status==='open'&&t>=item.deadline)){
    if(!incident.overdue){ incident.overdue=true; incident.deadlineMissedAt=t; changed=true; }
    if(applyIncidentDefaultPolicy(incident,t)){ changed=true; }
    if(incident.status!=='open') continue;
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(flight&&!flight.departureLogged){
      const delay=defaultRollingGroundDelay(flight,t);
      if((flight.incidentDelayMin||0)<delay){ flight.incidentDelayMin=delay; changed=true; }
    }
  }
  return changed;
}

function updateIncidentConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled||f.settled||f.departureLogged||!openIncidentsForFlight(f.id).some(incident=>incident.blocking)) continue;
    if(t>=f.departure){
      const delay=Math.max(15,Math.ceil((t+15*MIN-f.departure)/(15*MIN))*15);
      if((f.incidentDelayMin||0)<delay){ f.incidentDelayMin=delay; changed=true; }
    }
  }
  return changed;
}
