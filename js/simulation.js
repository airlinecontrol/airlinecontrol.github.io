/* AeroSim scheduling, demand, flight economics, staffing, and operations simulation. */

const OperationalIntelligence=window.AeroOperationalIntelligence;
const OperationalWorkflows=window.AeroOperationalWorkflows;

function flightActualDeparture(f){ return f.actualDeparture ?? f.departure; }
function flightActualArrival(f){ return f.actualArrival ?? f.arrival; }
function flightOperationalDestination(f){ return f.diversionAirport||f.to; }
function flightTotalDepartureDelayMin(f){ return Math.max(0,Math.round((flightActualDeparture(f)-f.departure)/MIN)); }
function aircraftIsDefective(ac,t=simNow()){ return Boolean(ac && ac.defectUntil && t<ac.defectUntil); }

function aircraftActiveFlight(acId,t=simNow()){
  return state.flights.find(f=>f.aircraftId===acId && !f.cancelled && flightActualDeparture(f)<=t && t<flightActualArrival(f));
}
function aircraftUpcomingFlight(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && !f.cancelled && flightActualDeparture(f)>t)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
}

function validateAircraftItinerary(ac,proposedLegs=[]){
  const now=simNow();
  const legs=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualArrival(f)>now)
    .map(f=>({from:f.from,to:flightOperationalDestination(f),departure:flightActualDeparture(f),arrival:flightActualArrival(f),label:f.id,existing:true}))
    .concat(proposedLegs)
    .sort((a,b)=>a.departure-b.departure||a.arrival-b.arrival);
  let location=ac.location,availableAt=now;
  for(const leg of legs){
    if(leg.existing&&leg.departure<=now&&now<leg.arrival){ location=leg.to; availableAt=leg.arrival; continue; }
    if(leg.departure<availableAt) return {ok:false,reason:`overlaps ${leg.label||'another planned leg'}`};
    if(leg.from!==location) return {ok:false,reason:`aircraft will be at ${location}, not ${leg.from}, before ${leg.label||'this leg'}`};
    location=leg.to; availableAt=leg.arrival;
  }
  return {ok:true};
}
function statusOfFlight(f,t=simNow()){
  if(f.cancelled) return 'cancelled';
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  if(t<dep){
    if(flightTotalDepartureDelayMin(f)>0 && t>=f.departure-90*MIN) return 'delayed';
    return 'scheduled';
  }
  if(t<arr) return 'airborne';
  return 'arrived';
}
function flightProgress(f,t=simNow()){
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  return clamp((t-dep)/(arr-dep),0,1);
}
function currentAircraftPosition(ac,t=simNow()){
  const f=aircraftActiveFlight(ac.id,t);
  if(!f){
    const ap=AIRPORTS[ac.location] || AIRPORTS[state.home];
    return {lat:ap.lat,lon:ap.lon,heading:0,status:'ground',flight:null};
  }
  const p=flightProgress(f,t), aa=AIRPORTS[f.from], bb=AIRPORTS[flightOperationalDestination(f)];
  const pos=interpolateGreatCircle(aa,bb,p), pos2=interpolateGreatCircle(aa,bb,Math.min(1,p+.002));
  return {...pos,heading:bearing(pos,pos2),status:'airborne',flight:f};
}
function minimumTurnMinutes(ac,airportCode){
  const model=MODELS[ac.model];
  const base=model.segment.includes('turboprop')?30:
    model.segment.includes('Regional jet')?35:
      model.segment.includes('widebody')?60:40;
  const congested=['LHR','JFK','AMS','CDG','HND'].includes(airportCode)?10:0;
  return base+congested;
}

function previousAircraftFlight(flight){
  return state.flights
    .filter(other=>other.aircraftId===flight.aircraftId&&!other.cancelled&&other.id!==flight.id&&other.departure<flight.departure)
    .sort((a,b)=>b.departure-a.departure)[0]||null;
}

function groundOperationsForFlight(flight,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const previousFlight=previousAircraftFlight(flight);
  const connectedPrevious=previousFlight?{
    ...previousFlight,operationalDestination:flightOperationalDestination(previousFlight)
  }:null;
  return {
    departure:AeroGroundOperations.departurePhase({
      flight,aircraft,previousFlight:connectedPrevious,
      previousArrival:previousFlight?flightActualArrival(previousFlight):null,
      minimumTurnMin:minimumTurnMinutes(aircraft,flight.from),now:t
    }),
    postflight:AeroGroundOperations.postflightPhase({
      flight,aircraft:MODELS[aircraft.model],actualArrival:flightActualArrival(flight),now:t
    })
  };
}

function aircraftGroundOperation(aircraft,t=simNow()){
  const flights=state.flights
    .filter(flight=>flight.aircraftId===aircraft.id&&!flight.cancelled)
    .sort((a,b)=>a.departure-b.departure);
  const upcoming=flights.find(flight=>flightActualDeparture(flight)>t);
  const recent=[...flights].reverse().find(flight=>flightActualArrival(flight)<=t);
  const recentPost=recent?groundOperationsForFlight(recent,t)?.postflight:null;
  if(recentPost&&recentPost.status!=='complete') return {flight:recent,phase:recentPost};
  const active=flights.find(flight=>flightActualDeparture(flight)<=t&&t<flightActualArrival(flight));
  if(active) return {flight:active,phase:groundOperationsForFlight(active,t)?.postflight};
  if(upcoming) return {flight:upcoming,phase:groundOperationsForFlight(upcoming,t)?.departure};
  return recentPost?{flight:recent,phase:recentPost}:null;
}

function rotationUsesThroughCrew(flight){
  const rotation=rotationForFlight(flight);
  if(!rotation.outbound||!rotation.returnFlight) return false;
  return OperationalIntelligence.crewDutyAssessment({
    departure:flightActualDeparture(rotation.outbound),arrival:flightActualArrival(rotation.returnFlight),sectors:2,
    augmented:Boolean(rotation.outbound.crewAugmented)
  }).legal;
}

function crewDutyForFlight(flight){
  const rotation=rotationForFlight(flight);
  if(rotationUsesThroughCrew(flight)){
    return OperationalIntelligence.crewDutyAssessment({
      departure:flightActualDeparture(rotation.outbound),arrival:flightActualArrival(rotation.returnFlight),sectors:2,
      augmented:Boolean(rotation.outbound.crewAugmented)
    });
  }
  return OperationalIntelligence.crewDutyAssessment({
    departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),sectors:1,
    augmented:Boolean(flight.crewAugmented)
  });
}

function connectionStatusForFlight(flight,onwardFlights=null){
  return OperationalIntelligence.connectionManifest({
    flight,actualArrival:flightActualArrival(flight),
    onwardFlights:(onwardFlights||state.flights).filter(item=>!item.cancelled&&item.id!==flight.id).map(item=>({
      ...item,actualDeparture:flightActualDeparture(item)
    }))
  });
}

function networkConstraintsForFlight(flight){
  const departureWeather=Management.weatherAt(flight.from,flight.departure);
  const distance=distanceKm(AIRPORTS[flight.from],AIRPORTS[flightOperationalDestination(flight)]);
  return {
    airport:OperationalIntelligence.airportConstraint(flight.from,flight.departure,departureWeather),
    airspace:OperationalIntelligence.airspaceConstraint(flight.from,flightOperationalDestination(flight),flight.departure,distance)
  };
}

function dispatchBriefingForFlight(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const constraints=networkConstraintsForFlight(flight);
  const destination=flightOperationalDestination(flight);
  const alternate=nearestDiversionAirport(flight,aircraft)||'';
  return OperationalIntelligence.dispatchBriefing({
    flight,crew:crewDutyForFlight(flight),
    departureWeather:Management.weatherAt(flight.from,flightActualDeparture(flight)),
    arrivalWeather:Management.weatherAt(destination,flightActualArrival(flight)),
    airport:constraints.airport,airspace:constraints.airspace,
    melItems:aircraft.melItems||[],incidents:openIncidentsForFlight(flight.id),
    fuelReady:Boolean(flight.fueled||simNow()<flight.departure-60*MIN),alternate
  });
}

function currentScenarioScore(t=simNow()){
  const start=t-7*DAY;
  const completed=state.flights.filter(flight=>flight.settled&&flightActualArrival(flight)>=start&&flightActualArrival(flight)<=t);
  const cancelled=state.flights.filter(flight=>flight.cancelled&&(flight.cancelledAt||flight.departure)>=start);
  const missedConnections=completed.reduce((sum,flight)=>sum+(flight.connectionMissedPax||0),0);
  const expiredMel=state.aircraft.reduce((sum,aircraft)=>sum+(aircraft.melItems||[]).filter(item=>item.status==='expired'||(item.status==='open'&&(item.expiresAt<=t||item.remainingCycles<=0))).length,0);
  return OperationalIntelligence.scenarioScore({
    completed,cancelled,missedConnections,expiredMel,
    openIncidents:state.incidents.filter(incident=>incident.status==='open')
  });
}

function nextSlotTime(readyTs, airportCode){
  const cfg=AIRPORT_OPS[airportCode] || {slotIntervalMin:15,graceMin:10};
  const capacity=Management.weatherAt(airportCode,readyTs).capacityFactor;
  const effectiveInterval=Math.ceil((cfg.slotIntervalMin/capacity)/5)*5;
  const step=effectiveInterval*MIN;
  return Math.ceil(readyTs/step)*step;
}
function recalculateOperations(){
  const now=simNow();
  for(const f of state.flights){
    f.handlingDelayMin=Number(f.handlingDelayMin)||0;
    f.technicalDelayMin=Number(f.technicalDelayMin)||0;
    f.enrouteDelayMin=Number(f.enrouteDelayMin)||0;
    f.manualDelayMin=Number(f.manualDelayMin)||0;
    f.weatherDelayMin=Number(f.weatherDelayMin)||0;
    f.incidentDelayMin=Number(f.incidentDelayMin)||0;
    f.maintenanceDelayMin=Number(f.maintenanceDelayMin)||0;
    f.positioningDelayMin=Number(f.positioningDelayMin)||0;
    f.airportDelayMin=Number(f.airportDelayMin)||0;
    f.airspaceDelayMin=Number(f.airspaceDelayMin)||0;
    f.propagatedDelayMin=0; f.slotDelayMin=0; f.slotMissed=false;
    f.actualDeparture=f.departure; f.actualArrival=f.arrival;
    f.groundReadyAt=f.departure; f.groundPhaseKind='preflight';
  }
  for(const ac of state.aircraft){
    const flights=state.flights.filter(f=>f.aircraftId===ac.id && !f.cancelled).sort((x,y)=>x.departure-y.departure);
    let prev=null;
    for(const f of flights){
      const baseReady=f.departure+(
        f.handlingDelayMin+f.technicalDelayMin+f.staffingDelayMin+f.manualDelayMin+
        f.weatherDelayMin+f.incidentDelayMin+f.maintenanceDelayMin+f.positioningDelayMin+
        f.airportDelayMin+f.airspaceDelayMin
      )*MIN;
      const connectedPrevious=prev?{...prev,operationalDestination:flightOperationalDestination(prev)}:null;
      const groundPhase=AeroGroundOperations.departurePhase({
        flight:f,aircraft:ac,previousFlight:connectedPrevious,
        previousArrival:prev?flightActualArrival(prev):null,
        minimumTurnMin:minimumTurnMinutes(ac,f.from),now
      });
      f.groundReadyAt=groundPhase.readyAt;
      f.groundPhaseKind=groundPhase.kind;
      let ready=Math.max(baseReady,groundPhase.readyAt);
      if(groundPhase.readyAt>baseReady){
        f.propagatedDelayMin=Math.ceil((groundPhase.readyAt-baseReady)/MIN);
      }
      if(ac.defectUntil && ac.defectUntil>ready && f.departure<ac.defectUntil){
        ready=ac.defectUntil;
      }
      const cfg=AIRPORT_OPS[f.from] || {slotIntervalMin:15,graceMin:10};
      let actualDep=ready;
      if(ready>f.departure+cfg.graceMin*MIN){
        f.slotMissed=true;
        const reassigned=nextSlotTime(ready,f.from);
        f.slotDelayMin=Math.max(0,Math.ceil((reassigned-ready)/MIN));
        f.assignedSlot=reassigned;
        actualDep=reassigned;
      }else{
        f.assignedSlot=f.departure;
      }
      f.actualDeparture=Math.max(f.departure,actualDep);
      const operationalDuration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
      f.actualArrival=f.actualDeparture+operationalDuration+f.enrouteDelayMin*MIN;
      prev=f;
    }
  }
}
function getNextGroundFlightForAircraft(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && !f.cancelled && !f.settled && flightActualDeparture(f)>t)
    .sort((x,y)=>flightActualDeparture(x)-flightActualDeparture(y))[0] || null;
}

function logEvent(){ /* operations log intentionally disabled */ }

const INCIDENT_TYPE_ORDER=['crew_sick','mel_defect','atc_restriction','gate_conflict','destination_closure'];
const INCIDENT_DEFINITIONS={
  crew_sick:{title:'Crew sick call',severity:'critical',decisionMin:30,summary:'A required operating crew member reported unavailable.'},
  mel_defect:{title:'MEL technical defect',severity:'critical',decisionMin:25,summary:'A defect requires an operational airworthiness decision.'},
  atc_restriction:{title:'ATC flow restriction',severity:'warning',decisionMin:35,summary:'Air traffic control issued a regulated departure window.'},
  gate_conflict:{title:'Gate conflict',severity:'warning',decisionMin:30,summary:'The planned gate is unavailable for this departure.'},
  destination_closure:{title:'Destination closure',severity:'critical',decisionMin:20,summary:'The destination airport is temporarily unavailable.'}
};

function openIncidentsForFlight(flightId){
  return state.incidents.filter(incident=>incident.flightId===flightId&&incident.status==='open');
}

function createIncident(type,flight,{training=false,detectedAt=simNow()}={}){
  const definition=INCIDENT_DEFINITIONS[type];
  if(!definition||!flight||flight.cancelled||flight.settled||flight.departureLogged) return null;
  if(state.incidents.some(incident=>incident.flightId===flight.id&&incident.type===type&&incident.status==='open')) return null;
  const latestUsefulDeadline=Math.max(detectedAt+5*MIN,flight.departure);
  const deadline=Math.min(detectedAt+definition.decisionMin*MIN,latestUsefulDeadline);
  const incident={
    id:'INC'+state.nextIncident++,type,flightId:flight.id,aircraftId:flight.aircraftId,
    airport:type==='destination_closure'?flight.to:flight.from,
    detectedAt,deadline,status:'open',severity:definition.severity,blocking:true,
    training:Boolean(training),selectedAction:'',resolvedAt:0,outcome:'',automaticResolution:false,
    technicalContext:type==='mel_defect'?OperationalIntelligence.melFinding(`INC${state.nextIncident-1}`,detectedAt):null,
    classification:OperationalWorkflows.WORKFLOWS[type]?.classification||'incident',workflowCreatedAt:0,overdue:false
  };
  state.incidents.push(incident);
  ensureIncidentWorkflow(incident);
  if(state.incidents.length>250){
    const removable=state.incidents.findIndex(item=>item.status!=='open');
    if(removable>=0) state.incidents.splice(removable,1);
  }
  return incident;
}

function maybeGenerateOperationalIncident(f,t){
  if(f.cancelled||f.settled||f.departureLogged||!state.ops.automaticDisruptions) return false;
  f.incidentChecks??={};
  if(f.incidentChecks.operationalGeneration||t<f.departure-120*MIN||t>=f.departure) return false;
  f.incidentChecks.operationalGeneration=true;
  if(!openIncidentsForFlight(f.id).length&&Math.random()<.16){
    const type=INCIDENT_TYPE_ORDER[Math.floor(Math.random()*INCIDENT_TYPE_ORDER.length)];
    createIncident(type,f,{detectedAt:t});
  }
  return true;
}

function nearestDiversionAirport(f,ac){
  return Object.keys(AIRPORTS)
    .filter(code=>code!==f.to&&code!==f.from)
    .map(code=>({code,fromOrigin:distanceKm(AIRPORTS[f.from],AIRPORTS[code]),fromDestination:distanceKm(AIRPORTS[f.to],AIRPORTS[code])}))
    .filter(item=>item.fromOrigin<=MODELS[ac.model].maxRangeKm)
    .sort((a,b)=>a.fromDestination-b.fromDestination)[0]?.code||null;
}

function incidentReplacementCandidates(f){
  if(f.serviceId) return rotationReplacementCandidates(f);
  const duration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
  const destination=flightOperationalDestination(f);
  return state.aircraft.filter(ac=>{
    if(ac.id===f.aircraftId||ac.location!==f.from||aircraftIsDefective(ac)) return false;
    if(!estimateFlight(f.from,destination,ac,f.fares||f.fare,{departure:f.departure}).rangeOk) return false;
    return validateAircraftItinerary(ac,[{from:f.from,to:destination,departure:f.departure,arrival:f.departure+duration,label:f.id}]).ok;
  });
}

function incidentTasks(incidentId){
  return (state.coordinationTasks||[]).filter(task=>task.incidentId===incidentId);
}

function ensureIncidentWorkflow(incident){
  if(!incident||incident.status!=='open'||!OperationalWorkflows.WORKFLOWS[incident.type]) return [];
  state.coordinationTasks??=[];
  const existing=incidentTasks(incident.id);
  if(existing.length) return existing;
  const tasks=OperationalWorkflows.tasksForIncident(incident);
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

function openDepartmentTasks(department){
  return (state.coordinationTasks||[]).filter(task=>task.department===department&&!['completed','cancelled'].includes(task.status));
}

function incidentWorkflowProgress(incident,t=simNow()){
  const tasks=incidentTasks(incident.id).filter(task=>task.required);
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

function activeWorkflowAssignments(t=simNow()){
  return (state.resourceAssignments||[]).filter(item=>['assigned','committed'].includes(item.status)&&item.releaseAt>t);
}

function crewPoolOptions(incident){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight||!aircraft) return [];
  const role=incident.affectedRole||'captains';
  const family=Management.aircraftFamily(aircraft.model);
  const reserved=activeWorkflowAssignments().filter(item=>item.role===role).reduce((map,item)=>map.set(item.base,(map.get(item.base)||0)+item.amount),new Map());
  return Object.keys(AIRPORTS).map(airport=>{
    const roster=['captains','firstOfficers'].includes(role)?qualifiedStaffAt(airport,role,family):staffAt(airport,role);
    const available=Math.max(0,roster-(reserved.get(airport)||0));
    if(!available) return null;
    const travelMin=airport===flight.from?20:Math.ceil(45+distanceKm(AIRPORTS[airport],AIRPORTS[flight.from])/700*60);
    return {id:`${airport}:${role}`,airport,role,family,available,reportMin:travelMin,
      label:`${airport} ${PERSONNEL[role]?.label||role} pool · ${available} available · report ${travelMin} min`};
  }).filter(Boolean).sort((a,b)=>a.reportMin-b.reportMin||b.available-a.available);
}

function diversionOptionsForIncident(incident){
  const flight=state.flights.find(item=>item.id===incident.flightId);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight||!aircraft) return [];
  return Object.keys(AIRPORTS).filter(code=>code!==flight.to&&code!==flight.from).map(code=>{
    const km=distanceKm(AIRPORTS[flight.from],AIRPORTS[code]);
    const destinationKm=distanceKm(AIRPORTS[flight.to],AIRPORTS[code]);
    const weather=Management.weatherAt(code,simNow());
    const rangeOk=km<=MODELS[aircraft.model].maxRangeKm;
    const handling=staffAt(code,'groundHandling');
    const suitability=(rangeOk?100:0)-destinationKm/80+(weather.level==='normal'?15:weather.level==='caution'?0:-30)+Math.min(10,handling);
    return {code,km,destinationKm,weather,handling,rangeOk,suitability};
  }).filter(item=>item.rangeOk).sort((a,b)=>b.suitability-a.suitability).slice(0,5);
}

function completeOperationalTask(task,outcome=''){
  task.status='completed'; task.completedAt=simNow(); task.completesAt=task.completedAt;
  task.outcome=outcome||task.pendingOutcome||task.outcome||'Completed';
  delete task.pendingOutcome;
  unlockOperationalTasks(task.incidentId);
}

function unlockOperationalTasks(incidentId){
  const tasks=incidentTasks(incidentId);
  let changed=true;
  while(changed){
    changed=false;
    for(const task of tasks){
      if(task.status!=='blocked'||!task.dependsOn.every(id=>tasks.some(other=>other.id===id&&other.status==='completed'))) continue;
      task.status='available'; changed=true;
      if(task.automatic&&task.kind==='crew_report'){
        const allocation=tasks.find(item=>item.kind==='crew_allocation');
        const reportMin=allocation?.selection?.reportMin||25;
        startOperationalTask(task,reportMin,'in_progress',`Replacement crew reports after ${reportMin} minutes.`);
      }
    }
  }
}

function finalizeOperationalCase(incident){
  if(!incident||incident.status!=='open') return false;
  const tasks=incidentTasks(incident.id).filter(task=>task.required);
  if(!tasks.length||tasks.some(task=>task.status!=='completed')) return false;
  const flight=state.flights.find(item=>item.id===incident.flightId);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight) return false;
  if(incident.type==='crew_sick'){
    const allocation=tasks.find(task=>task.kind==='crew_allocation');
    applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
    incident.outcome=`Replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} reported and the amended release was issued.`;
  }else if(incident.type==='mel_defect'){
    incident.outcome=incident.selectedStrategy==='repair'?'Repair completed and aircraft returned to service.':`Defect deferred under MEL ${incident.technicalContext?.code||''}; dispatch accepted the restrictions.`;
  }else if(incident.type==='atc_restriction'){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||45);
    incident.outcome=incident.atcOutcome||'Returned ATC slot incorporated into the operational release.';
  }else if(incident.type==='gate_conflict'){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||30);
    incident.outcome=incident.stationOutcome||'Replacement stand and ground movement coordinated.';
  }else if(incident.type==='destination_closure'){
    const alternate=incident.selectedAlternate;
    if(!alternate||!aircraft) return false;
    flight.diversionAirport=alternate;
    flight.operationalDurationMs=flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
    flight.weatherChecked=false;
    incident.outcome=`Captain and ATC accepted ${alternate}; alternate handling confirmed and the amended operational plan was issued.`;
  }
  incident.status='resolved'; incident.blocking=false; incident.resolvedAt=simNow();
  incident.selectedAction='workflow_complete'; incident.automaticResolution=false;
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
    if(task.kind==='maintenance_disposition'&&task.selection?.action==='repair'){
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

function performOperationalTask(taskId,actionId='',payload={}){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  const incident=task&&state.incidents.find(item=>item.id===task.incidentId&&item.status==='open');
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
  if(!task||!incident||!flight||!['available','in_progress'].includes(task.status)) return false;
  if(task.kind==='crew_allocation'){
    const option=crewPoolOptions(incident).find(item=>item.id===payload.optionId);
    if(!option) return toast('That personnel pool is no longer available.');
    const assignment={id:`RA${state.nextResourceAssignment++}`,incidentId:incident.id,taskId:task.id,flightId:flight.id,
      role:option.role,base:option.airport,operatingAirport:flight.from,amount:1,family:option.family,
      assignedAt:simNow(),reportAt:simNow()+option.reportMin*MIN,releaseAt:flightCrewRelease(flight)+10*HOUR,status:'assigned'};
    state.resourceAssignments.push(assignment);
    task.selection={...option,assignmentId:assignment.id};
    completeOperationalTask(task,`${option.label} assigned.`);
  }else if(task.kind==='maintenance_inspection'){
    startOperationalTask(task,25,'in_progress','Engineering inspection completed.');
  }else if(task.kind==='maintenance_disposition'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(actionId==='defer'){
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
  }else if(task.kind==='atc_coordination'){
    if(actionId==='accept'){
      incident.coordinatedDelayMin=45; incident.atcOutcome='Assigned CTOT accepted with a 45-minute ground delay.';
      task.selection={action:'accept'}; completeOperationalTask(task,incident.atcOutcome);
    }else if(actionId==='priority'){
      incident.coordinatedDelayMin=20; incident.atcOutcome='ATC returned an earlier regulated opportunity with a 20-minute delay.';
      task.selection={action:'priority'};
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
    }else return false;
  }else if(task.kind==='stand_request'){
    const options={remote:{delay:20,duration:10,outcome:'Airport allocated a remote stand with passenger bussing.'},tow:{delay:30,duration:15,outcome:'Airport allocated a replacement gate requiring an aircraft tow.'},wait_gate:{delay:45,duration:20,outcome:'Airport retained the planned gate after a 45-minute hold.'}};
    const option=options[actionId]; if(!option) return false;
    incident.coordinatedDelayMin=option.delay; incident.stationOutcome=option.outcome; task.selection={action:actionId};
    createExternalWorkflowRequest(task,'Airport stand control',option.duration,option.outcome);
  }else if(task.kind==='alternate_selection'){
    const option=diversionOptionsForIncident(incident).find(item=>item.code===payload.airport);
    if(!option) return toast('That alternate is no longer operationally suitable.');
    incident.selectedAlternate=option.code; task.selection={airport:option.code};
    completeOperationalTask(task,`${option.code} selected for recommendation.`);
  }else if(task.kind==='flightdeck_recommendation'){
    if(!incident.selectedAlternate) return false;
    task.selection={airport:incident.selectedAlternate};
    createExternalWorkflowRequest(task,'Flight deck',6,`Captain accepts ${incident.selectedAlternate} as the operational alternate.`);
  }else if(task.kind==='diversion_clearance'){
    createExternalWorkflowRequest(task,'ATC via flight crew',8,`ATC clears the flight to ${incident.selectedAlternate} via an amended route.`);
  }else if(task.kind==='alternate_handling'){
    createExternalWorkflowRequest(task,`${incident.selectedAlternate} station / handler`,12,`${incident.selectedAlternate} confirms stand and handling acceptance.`);
  }else if(task.kind==='dispatch_release'){
    completeOperationalTask(task,task.label.includes('amended')?'Amended operational release issued.':'Operational release updated.');
  }else if(task.kind==='station_coordination'){
    completeOperationalTask(task,'Ground movement, equipment, and passenger handling coordinated.');
  }else return false;
  processOperationalWorkflows(simNow()); recalculateOperations(); save(); refreshAll();
  return true;
}

function applyIncidentMinimumDelay(f,minutes){
  f.incidentDelayMin=Math.max(Number(f.incidentDelayMin)||0,minutes);
}

function processIncidentDeadlines(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>item.status==='open'&&t>=item.deadline)){
    if(!incident.overdue){ incident.overdue=true; incident.deadlineMissedAt=t; changed=true; }
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(flight&&!flight.departureLogged){
      const delay=Math.max(15,Math.ceil((t+15*MIN-flight.departure)/(15*MIN))*15);
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

function generateTrainingIncident(){
  const type=INCIDENT_TYPE_ORDER[state.incidentExerciseIndex%INCIDENT_TYPE_ORDER.length];
  const flight=state.flights
    .filter(item=>!item.cancelled&&!item.settled&&!item.departureLogged&&flightActualDeparture(item)>simNow()&&!state.incidents.some(incident=>incident.flightId===item.id&&incident.type===type&&incident.status==='open'))
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  if(!flight) return toast('Create a future flight before generating a training incident.');
  const incident=createIncident(type,flight,{training:true});
  if(!incident) return toast('No eligible flight is available for that exercise.');
  state.incidentExerciseIndex=(state.incidentExerciseIndex+1)%INCIDENT_TYPE_ORDER.length;
  save(); refreshAll(); toast(`${incident.id} training scenario opened for ${flight.id}.`);
}
function maybeGeneratePreDepartureIssue(f,t){
  if(f.cancelled || f.opsChecked || !state.ops.automaticDisruptions) return false;
  if(t < f.departure-60*MIN || t >= f.departure) return false;
  f.opsChecked=true;
  const roll=Math.random();
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  const maintenance=ac?Management.maintenanceStatus(ac,t):null;
  const conditionFactor=(1+(100-(ac?.condition??100))/25)*(maintenance?.due?1.55:1);
  const technicalChance=clamp(.025*conditionFactor,.025,.15);
  if(roll<technicalChance){
    createIncident('mel_defect',f,{detectedAt:t});
  }else if(roll<technicalChance+.135){
    const delay=10+Math.floor(Math.random()*31);
    f.handlingDelayMin+=delay;
    logEvent(`${f.id}: ground handling delay +${delay} min at ${f.from}.`);
  }
  return true;
}
function maybeApplyWeatherDelay(f,t){
  if(f.cancelled||f.weatherChecked||t<f.departure-90*MIN||t>=f.departure) return false;
  f.weatherChecked=true;
  const departureWeather=Management.weatherAt(f.from,f.departure);
  const arrivalWeather=Management.weatherAt(flightOperationalDestination(f),flightActualArrival(f));
  const primary=departureWeather.delayMin>=arrivalWeather.delayMin?departureWeather:arrivalWeather;
  f.weatherCode=primary.level==='normal'?'':`${primary.airport}: ${primary.conditions}`;
  f.weatherDelayMin=primary.delayMin;
  if(primary.delayMin&&!f.weatherCost){
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const seats=ac?cabinSeatCount(ac):100;
    f.weatherCost=Math.round((1_500+seats*(primary.level==='severe'?45:18))/500)*500;
    if(f.economics){ f.economics.weatherOps=f.weatherCost; refreshEconomicsTotals(f); }
    postTransaction(-f.weatherCost,'Weather operations',`${f.id} ${primary.conditions.toLowerCase()} handling`,f.id);
  }
  return true;
}
function maybeGenerateEnrouteIssue(f,t){
  if(f.cancelled || f.enrouteChecked || !state.ops.automaticDisruptions || t<flightActualDeparture(f)) return false;
  f.enrouteChecked=true;
  if(Math.random()<0.09){
    const delay=5+Math.floor(Math.random()*21);
    f.enrouteDelayMin+=delay;
    logEvent(`${f.id}: en-route disruption adds about ${delay} min to arrival.`);
  }
  return true;
}
function fuelFlight(f,t,force=false){
  if(f.fueled || f.cancelled || (!force&&t<f.departure-60*MIN)) return false;
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  if(!ac || ac.location!==f.from) return false;
  const nextFlight=state.flights
    .filter(other=>other.aircraftId===ac.id && !other.cancelled && !other.settled && !other.departureLogged)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b) || a.id.localeCompare(b.id))[0];
  if(!nextFlight || nextFlight.id!==f.id) return false;
  const plan=flightFuelPlan(f.from,flightOperationalDestination(f),ac);
  const onboard=Math.max(0,ac.fuelGallons||0);
  const purchased=Math.max(0,Math.ceil(plan.requiredGal-onboard));
  ac.fuelGallons=Math.min(plan.fuelCapacityGal,onboard+purchased);
  if(ac.fuelGallons<plan.requiredGal) return false;
  if(purchased>0) ac.lastFuelingFlightId=f.id;
  f.fueled=true;
  f.fueledAt=t;
  f.fuelGallons=purchased;
  f.fuelPurchasedGallons=purchased;
  f.fuelRequiredGallons=plan.requiredGal;
  f.fuelOnboardAtDeparture=ac.fuelGallons;
  f.tripFuelGallons=plan.tripBurnGal;
  f.fuelReserveGallons=plan.reserveGal;
  f.fuelCapacityGallons=plan.fuelCapacityGal;
  f.fuelPricePerGallon=state.fuelMarket.pricePerGallon;
  f.fuelCost=Math.round(purchased*f.fuelPricePerGallon);
  if(f.economics){
    f.economics.fuel=f.fuelCost;
    refreshEconomicsTotals(f);
  }else{
    f.costs=(f.baseCosts||0)+f.fuelCost+(f.maintenanceCost||0);
  }
  postTransaction(-f.fuelCost,'Fuel',`${f.id} purchased ${num(f.fuelPurchasedGallons)} US gal`,f.id);
  logEvent(`${f.id}: purchased ${num(purchased)} US gal of Jet A; ${num(ac.fuelGallons)} gal onboard for ${money(f.fuelCost)}.`);
  return true;
}
function repairFirstFlightFuelAttribution(){
  let changed=false;
  for(const ac of state.aircraft){
    if((ac.cycles||0)>0) continue;
    const flights=state.flights
      .filter(f=>f.aircraftId===ac.id && !f.cancelled && !f.settled)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b) || a.id.localeCompare(b.id));
    const first=flights[0];
    if(!first?.fueled || (first.fuelPurchasedGallons??first.fuelGallons)>0 || (first.fuelCost||0)>0) continue;
    const plan=flightFuelPlan(first.from,first.to,ac);
    const donor=flights.slice(1).find(f=>f.fueled && (f.fuelPurchasedGallons??f.fuelGallons)>0 && f.fuelCost>0);
    if(donor){
      first.fuelPurchasedGallons=donor.fuelPurchasedGallons??donor.fuelGallons;
      first.fuelGallons=first.fuelPurchasedGallons;
      first.fuelCost=donor.fuelCost;
      first.fuelPricePerGallon=donor.fuelPricePerGallon;
      first.fueledAt=donor.fueledAt;
      donor.fueled=false; donor.fuelGallons=0; donor.fuelPurchasedGallons=0; donor.fuelCost=0;
      if(donor.economics){ donor.economics.fuel=0; refreshEconomicsTotals(donor); }
    }else{
      first.fuelPurchasedGallons=plan.requiredGal;
      first.fuelGallons=plan.requiredGal;
      first.fuelPricePerGallon=first.fuelPricePerGallon||state.fuelMarket.pricePerGallon;
      first.fuelCost=Math.round(plan.requiredGal*first.fuelPricePerGallon);
      postTransaction(-first.fuelCost,'Fuel',`${first.id} initial fuel attribution`,first.id);
    }
    first.fuelRequiredGallons=plan.requiredGal;
    first.fuelOnboardAtDeparture=Math.max(plan.requiredGal,ac.fuelGallons||0);
    first.tripFuelGallons=plan.tripBurnGal;
    first.fuelReserveGallons=plan.reserveGal;
    first.fuelCapacityGallons=plan.fuelCapacityGal;
    ac.fuelGallons=first.fuelOnboardAtDeparture;
    ac.lastFuelingFlightId=first.id;
    if(first.economics){ first.economics.fuel=first.fuelCost; refreshEconomicsTotals(first); }
    changed=true;
  }
  return changed;
}

function resourceAvailability(kind,key='',location='',t=simNow()){
  const pending=(state.resourceRequests||[]).filter(request=>request.status==='pending'&&request.kind===kind&&request.key===key&&request.location===location).length;
  const current=kind==='aircraft'
    ? state.aircraft.filter(aircraft=>aircraft.model===key).length
    : kind==='personnel'
      ? staffAt(location,key)
      : state.slotRights.filter(right=>right.airport===location&&Math.floor(right.minuteOfDay/60)===Number(key)).length;
  return OperationalIntelligence.resourceAvailability({kind,key,location,current,pending,now:t});
}

function queueResourceRequest(kind,payload,supply){
  const request={
    id:`RR${state.nextResourceRequest++}`,kind,key:payload.key||'',location:payload.location||'',
    payload,requestedAt:simNow(),readyAt:simNow()+supply.leadMin*MIN,status:'pending'
  };
  state.resourceRequests.push(request);
  if(state.resourceRequests.length>200){
    const removable=state.resourceRequests.findIndex(item=>item.status!=='pending');
    if(removable>=0) state.resourceRequests.splice(removable,1);
  }
  save();
  return request;
}

function assignRequestedAircraft(modelName,cabin,location=state.home,requestedAt=simNow()){
  const n=state.nextAircraft++;
  const aircraft={
    id:'AC'+n,tail:randomTail(n),model:modelName,cabin:{...cabin},location,
    defectUntil:0,defectReason:'',condition:100,flightHours:0,cycles:0,fuelGallons:0,melItems:[],
    issueAcknowledgedAt:0,issueAcknowledgedKey:'',acquisitionType:'requested',
    resourceSource:'operations pool',acquiredAt:simNow(),requestedAt
  };
  state.aircraft.push(aircraft);
  Management.ensureState(state,simNow());
  return aircraft;
}

function requestPersonnelResource(role,airport,amount,qualification=''){
  if(!PERSONNEL[role]||!AIRPORTS[airport]) return null;
  const supply=resourceAvailability('personnel',role,airport);
  if(supply.available>=amount){
    changeStaff(airport,role,amount);
    if(['captains','firstOfficers'].includes(role)) changeQualification(airport,role,qualification,amount);
    save();
    return {status:'delivered',amount};
  }
  return queueResourceRequest('personnel',{key:role,location:airport,role,airport,amount,qualification},supply);
}

function processResourceRequests(t=simNow()){
  let changed=false;
  for(const request of state.resourceRequests||[]){
    if(request.status!=='pending'||t<request.readyAt) continue;
    const payload=request.payload||{};
    if(request.kind==='aircraft'){
      const aircraft=assignRequestedAircraft(payload.model,payload.cabin,payload.location,request.requestedAt);
      request.deliveredResourceId=aircraft.id;
    }else if(request.kind==='personnel'){
      changeStaff(payload.airport,payload.role,payload.amount);
      if(['captains','firstOfficers'].includes(payload.role)) changeQualification(payload.airport,payload.role,payload.qualification,payload.amount);
    }else if(request.kind==='slot'){
      const right=requestSlotRight(payload.airport,payload.timestamp,{silent:true,source:'operations request',force:true});
      request.deliveredResourceId=right?.id||'';
    }
    request.status='delivered'; request.deliveredAt=t; changed=true;
  }
  return changed;
}

function maybeApplyNetworkConstraints(flight,t){
  if(flight.cancelled||flight.settled||flight.departureLogged||flight.constraintChecked||t<flight.departure-120*MIN||t>=flight.departure) return false;
  flight.constraintChecked=true;
  const constraints=networkConstraintsForFlight(flight);
  flight.airportDelayMin=constraints.airport.delayMin;
  flight.airspaceDelayMin=constraints.airspace.delayMin;
  flight.airportConstraintLabel=constraints.airport.delayMin?constraints.airport.reason:'';
  flight.airspaceConstraintLabel=constraints.airspace.delayMin?constraints.airspace.reason:'';
  return true;
}

function updatePassengerConnections(){
  let changed=false;
  const byOrigin=new Map();
  for(const candidate of state.flights){
    if(candidate.cancelled) continue;
    if(!byOrigin.has(candidate.from)) byOrigin.set(candidate.from,[]);
    byOrigin.get(candidate.from).push(candidate);
  }
  for(const flight of state.flights){
    const connections=connectionStatusForFlight(flight,byOrigin.get(flightOperationalDestination(flight))||[]);
    const next={total:connections.total,atRisk:connections.atRisk,missed:connections.missed};
    if(flight.connectionPax!==next.total||flight.connectionAtRiskPax!==next.atRisk||flight.connectionMissedPax!==next.missed){
      flight.connectionPax=next.total;
      flight.connectionAtRiskPax=next.atRisk;
      flight.connectionMissedPax=next.missed;
      changed=true;
    }
  }
  return changed;
}

function processMelConstraints(t=simNow()){
  let changed=false;
  for(const aircraft of state.aircraft){
    aircraft.melItems??=[];
    const maintenanceCompletedAt=aircraft.maintenance?.lastCompletedAt||0;
    for(const item of aircraft.melItems){
      if(['open','expired'].includes(item.status)&&maintenanceCompletedAt>(item.deferredAt||item.detectedAt||0)){
        item.status='cleared'; item.clearedAt=maintenanceCompletedAt; changed=true; continue;
      }
      if(item.status==='open'&&(t>=item.expiresAt||item.remainingCycles<=0)){
        item.status='expired'; item.expiredAt=t;
        aircraft.defectReason=`Expired MEL ${item.code}`;
        aircraft.defectUntil=Math.max(aircraft.defectUntil||0,t+365*DAY);
        changed=true;
      }
    }
    if(!aircraft.melItems.some(item=>item.status==='expired')&&aircraft.defectReason?.startsWith('Expired MEL')){
      aircraft.defectReason=''; aircraft.defectUntil=0; changed=true;
    }
  }
  return changed;
}

function processEvents(){
  ensureRecurringFlights();
  const t=simNow();
  let changed=false;
  if(processOperationalWorkflows(t)) changed=true;
  if(Management.processMaintenance(state,t,postTransaction)) changed=true;
  if(Management.processWeeklyReviews(state,t)) changed=true;
  if(repairFirstFlightFuelAttribution()) changed=true;
  if(processPersonnelTransfers(t)) changed=true;
  if(processResourceRequests(t)) changed=true;
  if(processMelConstraints(t)) changed=true;

  for(const f of state.flights){
    if(maybeApplyWeatherDelay(f,t)) changed=true;
    if(maybeGeneratePreDepartureIssue(f,t)) changed=true;
    if(maybeGenerateOperationalIncident(f,t)) changed=true;
    if(maybeApplyNetworkConstraints(f,t)) changed=true;
  }
  if(processIncidentDeadlines(t)) changed=true;
  if(updateIncidentConstraints(t)) changed=true;
  recalculateOperations();
  if(updateStaffingConstraints(t)) changed=true;
  if(updateMaintenanceConstraints(t)) changed=true;
  if(updatePositioningConstraints(t)) changed=true;
  recalculateOperations();
  if(updatePassengerConnections()) changed=true;

  for(const f of state.flights){
    if(f.cancelled) continue;
    if(fuelFlight(f,t)) changed=true;
    if(f.slotMissed && !f.slotLogged && t>=f.departure-20*MIN){
      f.slotLogged=true;
      logEvent(`${f.id}: original ${f.from} slot missed; new slot ${formatTime(f.assignedSlot)}.`);
      changed=true;
    }
    if(!f.departureLogged && t>=flightActualDeparture(f)){
      f.departureLogged=true;
      if(maybeGenerateEnrouteIssue(f,t)){ recalculateOperations(); changed=true; }
      const d=flightTotalDepartureDelayMin(f);
      logEvent(`${f.id} departed ${f.from} for ${flightOperationalDestination(f)}${d?` ${d} min late`:''}.`,flightActualDeparture(f));
      changed=true;
    }
    if(!f.settled && t>=flightActualArrival(f)){
      f.settled=true;
      const ac=state.aircraft.find(a=>a.id===f.aircraftId);
      if(ac){
        ac.location=flightOperationalDestination(f);
        const onboardFuel=Number.isFinite(ac.fuelGallons)?ac.fuelGallons:(f.fuelOnboardAtDeparture||0);
        ac.fuelGallons=Math.max(0,onboardFuel-(f.tripFuelGallons||0));
        const hours=(Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure)/HOUR;
        ac.flightHours=(ac.flightHours||0)+hours;
        ac.cycles=(ac.cycles||0)+1;
        ac.condition=clamp((ac.condition??100)-(.12+hours*.035),0,100);
        for(const item of ac.melItems||[]){
          if(item.status==='open') item.remainingCycles=Math.max(0,(item.remainingCycles||0)-1);
        }
      }
      const prepaid=(f.fuelCost||0)+(f.maintenanceCost||0)+(f.weatherCost||0);
      postTransaction(f.revenue,'Ticket revenue',`${f.id} ${f.from} → ${f.to}`,f.id);
      const remainingOperatingCost=Math.max(0,f.costs-prepaid);
      if(remainingOperatingCost) postTransaction(-remainingOperatingCost,'Flight operations',`${f.id} remaining operating costs`,f.id);
      state.stats.revenue += f.revenue; state.stats.costs += f.costs;
      state.stats.pax += f.pax; state.stats.completed += 1;
      const ad=Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN));
      logEvent(`${f.id} arrived ${flightOperationalDestination(f)}${ad?` ${ad} min late`:''}.`,flightActualArrival(f));
      changed=true;
    }
  }
  for(const ac of state.aircraft){
    const expiredMel=(ac.melItems||[]).some(item=>item.status==='expired');
    if(ac.defectUntil && t>=ac.defectUntil&&!expiredMel){ ac.defectUntil=0; ac.defectReason=''; changed=true; }
  }
  if(changed){ recalculateOperations(); save(); }
}

function availableAircraftForSchedule(){
  return state.aircraft;
}

function stableRouteAffinity(from,to){
  const key=[from,to].sort().join('-');
  let hash=2166136261;
  for(const char of key){ hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
  return .84+((hash>>>0)%3300)/10000;
}

function destinationSeasonFactor(destination,month){
  const profile=AIRPORT_MARKETS[destination];
  if(month===11) return 1.10;
  if([6,7].includes(month)) return profile.season==='summer'?1.14:profile.season==='winter'?.89:1.02;
  if([0,1].includes(month)) return profile.season==='winter'?1.13:profile.season==='summer'?.90:.98;
  if([2,3].includes(month)&&profile.season==='spring') return 1.12;
  if([3,4,8,9].includes(month)) return 1.03;
  return 1;
}

function demandTimeFactors(departure,from,to){
  const d=new Date(departure||simNow());
  const day=d.getDay(),hour=d.getHours(),month=d.getMonth();
  const destinationTourism=AIRPORT_MARKETS[to]?.tourism||.7;
  const seasonRaw=to?destinationSeasonFactor(to,month):1;
  const economy={
    weekday:[5,0].includes(day)?1.12:day===6?1.06:[2,3].includes(day)?.93:.98,
    time:hour>=6&&hour<10?1.05:hour>=16&&hour<20?1.08:hour>=10&&hour<16?1.03:hour>=21||hour<6?.82:.94,
    season:1+(seasonRaw-1)*destinationTourism
  };
  const business={
    weekday:[1,2,3,4].includes(day)?1.11:day===5?.98:day===0?.82:.70,
    time:hour>=6&&hour<10?1.16:hour>=16&&hour<20?1.13:hour>=10&&hour<16?.98:hour>=21||hour<6?.75:.90,
    season:1+(seasonRaw-1)*.28
  };
  const first={weekday:business.weekday,time:business.time,season:1+(seasonRaw-1)*.4};
  return {
    weekday:(economy.weekday+business.weekday)/2,
    time:(economy.time+business.time)/2,
    season:(economy.season+business.season)/2,
    classes:{economy,business,first}
  };
}

function routeMarketDemand(from,to,departure){
  const origin=AIRPORT_MARKETS[from],destination=AIRPORT_MARKETS[to];
  const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
  const marketSize=Math.sqrt(origin.size*destination.size);
  const distanceFactor=km<400?.62:km<1500?1:km<4000?.91:.82;
  const regionFactor=origin.region===destination.region?1.12:1;
  const networkFactor=.78+.22*((origin.hub+destination.hub)/2);
  const localAffinity=stableRouteAffinity(from,to);
  const totalDaily=Math.round((120+900*Math.pow(marketSize,1.65))*distanceFactor*regionFactor*networkFactor*localAffinity);
  const homePresence=[from,to].includes(state?.home);
  const capture=clamp(.27+(homePresence?.11:0)+origin.hub*.035,.27,.43);
  const capturedDaily=Math.round(totalDaily*capture);
  const avgBusiness=(origin.business+destination.business)/2,avgWealth=(origin.wealth+destination.wealth)/2;
  const longHaul=km>=3500;
  const firstShare=clamp((longHaul?.018:.004)+avgWealth*.035+(km>=7000?.012:0),.01,.065);
  const businessShare=clamp(.07+avgBusiness*.11+(km>=1500?.035:0)+(longHaul?.025:0),.12,.25);
  return {
    totalDaily,capturedDaily,capture,km,marketSize,distanceFactor,regionFactor,networkFactor,localAffinity,
    mix:{business:avgBusiness,tourism:(origin.tourism+destination.tourism)/2,wealth:avgWealth},
    classDemand:{
      economy:Math.round(capturedDaily*(1-businessShare-firstShare)),
      business:Math.round(capturedDaily*businessShare),
      first:Math.round(capturedDaily*firstShare)
    }
  };
}

function sameLocalOperatingDay(a,b){
  const x=new Date(a),y=new Date(b);
  return x.getFullYear()===y.getFullYear()&&x.getMonth()===y.getMonth()&&x.getDate()===y.getDate();
}

function existingRouteBookings(from,to,departure){
  const booked={economy:0,business:0,first:0};
  for(const flight of state.flights){
    if(flight.cancelled||flight.from!==from||flight.to!==to||!sameLocalOperatingDay(flight.departure,departure)) continue;
    for(const className of Object.keys(CABIN_CLASSES)) booked[className]+=flight.classPax?.[className]||0;
  }
  return booked;
}

function estimateFlight(from,to,ac,fareValue,{departure=simNow(),randomize=false,availableFuelGallons=0}={}){
  const a=AIRPORTS[from], b=AIRPORTS[to], m=MODELS[ac.model];
  const km=distanceKm(a,b);
  const duration=flightDurationMs(a,b,m);
  const rangeOk=km<=m.maxRangeKm;
  const baseFare=60+km*.085;
  const fares=normalizeFares(fareValue);
  const cabin=cabinForAircraft(ac);
  const market=routeMarketDemand(from,to,departure);
  const routeFactor=clamp(market.capturedDaily/450,.35,1.6);
  const calendar=demandTimeFactors(departure,from,to);
  const existingBookings=existingRouteBookings(from,to,departure);
  const classPax={},classLoads={},classDemand={};
  let pax=0,revenue=0,occupiedSeats=0,totalSeats=0;
  for(const [className,config] of Object.entries(CABIN_CLASSES)){
    const seats=cabin[className]||0;
    const classBaseFare=baseFare*config.baseFareMultiplier;
    const priceFactor=clamp(Math.exp(-config.elasticity*(fares[className]/classBaseFare-1)),.01,1.15);
    const randomFactor=randomize ? .92+Math.random()*.16 : 1;
    const timing=calendar.classes[className];
    const remainingDemand=Math.max(0,market.classDemand[className]-existingBookings[className]);
    const willingPassengers=remainingDemand*priceFactor*timing.weekday*timing.time*timing.season*randomFactor;
    const passengers=seats?Math.min(Math.floor(seats*.98),Math.max(0,Math.round(willingPassengers))):0;
    const load=seats?passengers/seats:0;
    classPax[className]=passengers; classLoads[className]=load;
    classDemand[className]={price:priceFactor,random:randomFactor,remaining:remainingDemand,market:market.classDemand[className],...timing};
    pax+=passengers; occupiedSeats+=passengers; totalSeats+=seats;
    revenue+=passengers*fares[className];
  }
  const load=totalSeats?occupiedSeats/totalSeats:0;
  const fuel=flightFuelPlan(from,to,ac);
  const fuelPrice=state?.fuelMarket?.pricePerGallon||FUEL_MARKET_BASE_EUR_GAL;
  const fuelGallons=Math.max(0,Math.ceil(fuel.requiredGal-availableFuelGallons));
  const fuelRemaining=Math.max(0,availableFuelGallons+fuelGallons-fuel.tripBurnGal);
  const economics=calculateFlightEconomics({from,to,model:m,distanceKm:km,duration,pax,fare:fares.economy,ticketRevenue:revenue,fuelGallons,fuelPrice});
  const fuelCost=economics.fuel,costs=economics.totalCost;
  const baseCosts=costs-fuelCost;
  const demand={route:routeFactor,weekday:calendar.weekday,time:calendar.time,season:calendar.season,classes:classDemand,market,existingBookings};
  return {km,duration,rangeOk,baseFare,load,pax,classPax,classLoads,fares,revenue,baseCosts,fuelGallons,fuelRequiredGallons:fuel.requiredGal,tripFuelGallons:fuel.tripBurnGal,fuelRemaining,fuelCost,costs,profit:revenue-costs,demand,economics};
}

function addLocalDays(timestamp, days){
  const d=new Date(timestamp);
  d.setDate(d.getDate()+days);
  return d.getTime();
}

function nextRecurringDeparture(timestamp, rule, operatingDays=null, operatingMonths=null){
  if(rule==='custom'){
    const days=Array.isArray(operatingDays)&&operatingDays.length?operatingDays:[0,1,2,3,4,5,6];
    const months=Array.isArray(operatingMonths)&&operatingMonths.length?operatingMonths:[0,1,2,3,4,5,6,7,8,9,10,11];
    let next=addLocalDays(timestamp,1),guard=0;
    while(guard<740 && (!days.includes(new Date(next).getDay())||!months.includes(new Date(next).getMonth()))){ next=addLocalDays(next,1); guard++; }
    return next;
  }
  if(rule==='every2') return addLocalDays(timestamp,2);
  if(rule==='weekly') return addLocalDays(timestamp,7);
  if(rule==='weekdays'){
    let n=addLocalDays(timestamp,1);
    while([0,6].includes(new Date(n).getDay())) n=addLocalDays(n,1);
    return n;
  }
  return addLocalDays(timestamp,1);
}

function minimumRepeatInterval(rule){
  if(rule==='every2') return 2*DAY;
  if(rule==='weekly') return 7*DAY;
  return DAY;
}

function alignToOperatingCalendar(timestamp,rule,operatingDays,operatingMonths){
  if(rule!=='custom') return timestamp;
  let candidate=timestamp,guard=0;
  while(guard<740){
    const date=new Date(candidate);
    if(operatingDays.includes(date.getDay())&&operatingMonths.includes(date.getMonth())) return candidate;
    candidate=addLocalDays(candidate,1); guard++;
  }
  return null;
}

function estimateFerryFlight(from,to,ac,departure){
  const estimate=estimateFlight(from,to,ac,0,{departure,randomize:false});
  estimate.pax=0; estimate.load=0; estimate.revenue=0;
  estimate.classPax={economy:0,business:0,first:0};
  estimate.classLoads={economy:0,business:0,first:0};
  estimate.economics.ticketRevenue=0;
  estimate.economics.passengerFees=0;
  estimate.economics.groundHandling=Math.round((estimate.economics.groundHandling||0)*.55);
  estimate.economics.totalCost=flightEconomicsTotal(estimate.economics);
  estimate.economics.operatingProfit=-estimate.economics.totalCost;
  estimate.costs=estimate.economics.totalCost;
  estimate.profit=-estimate.costs;
  estimate.baseCosts=estimate.costs-(estimate.economics.fuel||0);
  return estimate;
}

function createFlightRecord({aircraftId,from,to,departure,fare,serviceId=null,serviceLeg=null,flightType='passenger'}){
  const ac=state.aircraft.find(a=>a.id===aircraftId);
  const est=flightType==='ferry'?estimateFerryFlight(from,to,ac,departure):estimateFlight(from,to,ac,fare,{departure,randomize:true});
  const id='AS'+state.nextFlight++;
  const f={
    id,aircraftId,from,to,departure,arrival:departure+est.duration,fare:est.fares.economy,fares:est.fares,
    load:est.load,pax:est.pax,classPax:est.classPax,classLoads:est.classLoads,revenue:est.revenue,demand:est.demand,economics:{...est.economics,fuel:0,totalCost:est.baseCosts,operatingProfit:est.revenue-est.baseCosts},
    baseCosts:est.baseCosts,costs:est.baseCosts,
    fueled:false,fuelGallons:0,fuelPurchasedGallons:0,fuelRequiredGallons:0,tripFuelGallons:0,fuelCost:0,fuelPricePerGallon:0,
    maintenanceCost:0,weatherCost:0,defectSeverity:'',flightType,cancelled:false,cancelledAt:0,cancellationCost:0,
    settled:false,departureLogged:false,serviceId,serviceLeg,
    handlingDelayMin:0,technicalDelayMin:0,staffingDelayMin:0,staffingBlocked:false,staffingShortage:'',
    manualDelayMin:0,weatherDelayMin:0,weatherChecked:false,weatherCode:'',maintenanceDelayMin:0,maintenanceBlocked:false,
    positioningDelayMin:0,positioningBlocked:false,issueAcknowledgedAt:0,issueAcknowledgedKey:'',
    incidentDelayMin:0,incidentChecks:{},diversionAirport:'',operationalDurationMs:null,
    enrouteDelayMin:0,propagatedDelayMin:0,slotDelayMin:0,
    slotMissed:false,opsChecked:false,enrouteChecked:false,slotLogged:false
  };
  state.flights.push(f);
  return f;
}

function ensureRecurringFlights(){
  if(!Array.isArray(state.services)) state.services=[];
  const horizon=simNow()+14*DAY;
  let changed=false;

  for(const svc of state.services){
    if(!svc.active) continue;
    const serviceFlights=state.flights.filter(f=>f.serviceId===svc.id).sort((a,b)=>a.departure-b.departure);
    const outboundFlights=serviceFlights.filter(f=>f.serviceLeg==='outbound');
    const returnFlights=serviceFlights.filter(f=>f.serviceLeg==='return');
    for(let i=0;i<outboundFlights.length;i++){
      const outbound=outboundFlights[i];
      const nextOutbound=outboundFlights[i+1];
      const alreadyPaired=returnFlights.some(f=>
        f.departure>outbound.departure && (!nextOutbound || f.departure<nextOutbound.departure)
      );
      if(alreadyPaired) continue;
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=outbound.arrival+svc.turnaroundMin*MIN;
      const isFirst=outbound.departure===svc.firstDeparture;
      const returnDeparture=isFirst && Number.isFinite(svc.firstReturnDeparture)
        ? svc.firstReturnDeparture
        : destinationRight
          ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
          : alignTimestampToAirportSlot(earliestReturn,svc.to);
      if(returnDeparture<simNow() || (nextOutbound && returnDeparture>=nextOutbound.departure)) continue;
      const returnEstimate=estimateFlight(svc.to,svc.from,state.aircraft.find(a=>a.id===svc.aircraftId),svc.fares||svc.fare,{departure:returnDeparture});
      if(!validateAircraftItinerary(state.aircraft.find(a=>a.id===svc.aircraftId),[{
        from:svc.to,to:svc.from,departure:returnDeparture,arrival:returnDeparture+returnEstimate.duration,label:`${svc.id} return`
      }]).ok) continue;
      createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.to,to:svc.from,departure:returnDeparture,
        fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'return'
      });
      changed=true;
    }
    let guard=0;
    while(svc.nextDeparture<=horizon && guard<600){
      const ac=state.aircraft.find(a=>a.id===svc.aircraftId);
      if(!ac){ svc.active=false; changed=true; break; }

      const outboundEstimate=estimateFlight(svc.from,svc.to,ac,svc.fares||svc.fare,{departure:svc.nextDeparture});
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=svc.nextDeparture+outboundEstimate.duration+svc.turnaroundMin*MIN;
      const firstRotation=svc.lastGeneratedDeparture===null && svc.nextDeparture===svc.firstDeparture;
      const returnDeparture=firstRotation && Number.isFinite(svc.firstReturnDeparture)
        ? svc.firstReturnDeparture
        : destinationRight
          ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
          : alignTimestampToAirportSlot(earliestReturn,svc.to);
      const returnEstimate=estimateFlight(svc.to,svc.from,ac,svc.fares||svc.fare,{departure:returnDeparture});
      const itinerary=validateAircraftItinerary(ac,[
        {from:svc.from,to:svc.to,departure:svc.nextDeparture,arrival:svc.nextDeparture+outboundEstimate.duration,label:`${svc.id} outbound`},
        {from:svc.to,to:svc.from,departure:returnDeparture,arrival:returnDeparture+returnEstimate.duration,label:`${svc.id} return`}
      ]);
      if(itinerary.ok){
        createFlightRecord({
          aircraftId:svc.aircraftId,from:svc.from,to:svc.to,
          departure:svc.nextDeparture,fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'outbound'
        });
        createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.to,to:svc.from,
        departure:returnDeparture,
        fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'return'
        });
      }else{
        logEvent(`${svc.id} rotation skipped: ${itinerary.reason}.`,svc.nextDeparture);
      }

      svc.lastGeneratedDeparture=svc.nextDeparture;
      svc.nextDeparture=nextRecurringDeparture(svc.nextDeparture,svc.rule,svc.operatingDays,svc.operatingMonths);
      guard++; changed=true;
    }
  }
  if(changed) save();
}

function returnReusesOutboundCrew(f){
  if(!f.serviceId || f.serviceLeg!=='return') return false;
  const outbound=state.flights
    .filter(other=>!other.cancelled&&other.serviceId===f.serviceId && other.serviceLeg==='outbound' && other.departure<f.departure)
    .sort((a,b)=>b.departure-a.departure)[0];
  return Boolean(outbound&&rotationUsesThroughCrew(f));
}
function flightUsesLocalCrew(f){ return !returnReusesOutboundCrew(f); }
function flightCrewRelease(f){
  if(f.serviceId && f.serviceLeg==='outbound'){
    const returnFlight=state.flights
      .filter(other=>!other.cancelled&&other.serviceId===f.serviceId && other.serviceLeg==='return' && other.departure>f.departure)
      .sort((a,b)=>a.departure-b.departure)[0];
    if(returnFlight && returnReusesOutboundCrew(returnFlight)) return flightActualArrival(returnFlight);
  }
  return flightActualArrival(f);
}

function flightCrewReleaseAirport(f){
  if(f.serviceId&&f.serviceLeg==='outbound'){
    const returnFlight=state.flights
      .filter(other=>!other.cancelled&&other.serviceId===f.serviceId&&other.serviceLeg==='return'&&other.departure>f.departure)
      .sort((a,b)=>a.departure-b.departure)[0];
    if(returnFlight&&returnReusesOutboundCrew(returnFlight)) return flightOperationalDestination(returnFlight);
  }
  return flightOperationalDestination(f);
}

function staffingShortagesForFlight(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
  const arrival=departure+duration;
  const ferry=flightType==='ferry';
  const family=Management.aircraftFamily(ac.model);
  const candidateFlight=candidateId?state.flights.find(item=>item.id===candidateId):null;
  const operatingCrewCount=localFlightCrew?(candidateFlight?.crewAugmented?2:1):0;
  const qualifiedNeeded={captains:operatingCrewCount,firstOfficers:operatingCrewCount};
  const needed={
    captains:operatingCrewCount,
    firstOfficers:operatingCrewCount,
    cabinCrew:localFlightCrew&&!ferry?Math.max(1,Math.ceil(cabinSeatCount(ac)/50))*(candidateFlight?.crewAugmented?2:1):0,
    groundHandling:ferry?2:4,operations:1,customerService:ferry?0:1
  };
  for(const f of state.flights){
    if(f.cancelled || f.from!==airport || f.id===candidateId) continue;
    if(candidateId && (f.departure>departure || (f.departure===departure && f.id>candidateId))) continue;
    const otherDep=flightActualDeparture(f);
    // Pooled flight crews remain committed through the rotation and then need
    // ten hours of rest. This avoids named-employee micromanagement while making
    // duty limits and reserve depth operationally meaningful.
    const crewRelease=flightCrewRelease(f);
    const crewAvailableAfter=crewRelease+10*HOUR;
    const canContinueSameDuty=crewRelease<=departure&&flightCrewReleaseAirport(f)===airport&&
      OperationalIntelligence.crewDutyAssessment({departure:otherDep,arrival,sectors:2,augmented:Boolean(f.crewAugmented)}).legal;
    if(flightUsesLocalCrew(f) && !canContinueSameDuty && crewAvailableAfter>departure && otherDep<arrival){
      const otherCrewCount=f.crewAugmented?2:1;
      needed.captains+=otherCrewCount; needed.firstOfficers+=otherCrewCount;
      const other=state.aircraft.find(a=>a.id===f.aircraftId);
      if(other&&Management.aircraftFamily(other.model)===family){ qualifiedNeeded.captains+=otherCrewCount; qualifiedNeeded.firstOfficers+=otherCrewCount; }
      if(f.flightType!=='ferry') needed.cabinCrew+=Math.max(1,Math.ceil(((other?cabinSeatCount(other):f.pax)||1)/50))*otherCrewCount;
    }
    if(Math.abs(otherDep-departure)<90*MIN) needed.groundHandling+=f.flightType==='ferry'?2:4;
    if(Math.abs(otherDep-departure)<60*MIN){ needed.operations++; if(f.flightType!=='ferry') needed.customerService++; }
  }
  const shortages=Object.entries(needed)
    .filter(([role,count])=>staffAt(airport,role)<count)
    .map(([role,count])=>`${PERSONNEL[role].label} at ${airport}: ${staffAt(airport,role)}/${count}`);
  for(const role of ['captains','firstOfficers']){
    const available=qualifiedStaffAt(airport,role,family),required=qualifiedNeeded[role];
    if(available<required) shortages.push(`${PERSONNEL[role].label} rated ${family} at ${airport}: ${available}/${required}`);
  }
  return shortages;
}

function updateMaintenanceConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled||f.settled||f.departureLogged) continue;
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    if(!ac) continue;
    const maintenance=Management.maintenanceStatus(ac,t);
    const job=maintenance.scheduled;
    const overlapsJob=Boolean(job&&job.start<f.arrival&&job.end>f.departure);
    if(maintenance.grounding||overlapsJob||maintenance.active){
      const delayTarget=job?job.end:t+15*MIN;
      const delay=Math.max(15,Math.ceil((delayTarget-f.departure)/(15*MIN))*15);
      if(!f.maintenanceBlocked||f.maintenanceDelayMin!==delay) changed=true;
      f.maintenanceBlocked=true;
      f.maintenanceDelayMin=delay;
    }else if(f.maintenanceBlocked||f.maintenanceDelayMin){
      f.maintenanceBlocked=false;
      f.maintenanceDelayMin=0;
      changed=true;
    }
  }
  return changed;
}

function updatePositioningConstraints(t=simNow()){
  let changed=false;
  for(const ac of state.aircraft){
    const active=aircraftActiveFlight(ac.id,t);
    const next=state.flights
      .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&!f.departureLogged&&flightActualDeparture(f)>t)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
    if(!next) continue;
    const expectedLocation=active?flightOperationalDestination(active):ac.location;
    if(next.from!==expectedLocation){
      const delay=Math.max(15,Math.ceil((t+15*MIN-next.departure)/(15*MIN))*15);
      if(!next.positioningBlocked||next.positioningDelayMin!==delay) changed=true;
      next.positioningBlocked=true;
      next.positioningDelayMin=delay;
    }else if(next.positioningBlocked||next.positioningDelayMin){
      next.positioningBlocked=false;
      next.positioningDelayMin=0;
      changed=true;
    }
  }
  return changed;
}

function updateStaffingConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled || f.settled || f.departureLogged || t<f.departure-60*MIN) continue;
    const ac=state.aircraft.find(a=>a.id===f.aircraftId);
    if(!ac) continue;
    const evaluationDeparture=Math.max(f.departure,t);
    const shortages=staffingShortagesForFlight(ac,evaluationDeparture,f.arrival-f.departure,f.from,f.id,flightUsesLocalCrew(f),f.flightType);
    if(shortages.length){
      const delay=Math.max(15,Math.ceil((t+15*MIN-f.departure)/(15*MIN))*15);
      if(f.staffingDelayMin!==delay || !f.staffingBlocked){ changed=true; }
      f.staffingDelayMin=delay; f.staffingBlocked=true; f.staffingShortage=shortages.join(' · ');
    }else if(f.staffingBlocked || f.staffingDelayMin){
      f.staffingDelayMin=0; f.staffingBlocked=false; f.staffingShortage=''; changed=true;
    }
  }
  return changed;
}

function scheduleFlight(){
  const from=originEl.value, to=destEl.value, acId=aircraftEl.value;
  const ac=state.aircraft.find(a=>a.id===acId);
  const fares=currentScheduleFares();
  const scheduleType=scheduleTypeEl.value;
  const operatingCalendar=selectedOperatingCalendar();
  const rawDeparture=nextTimestampForClock(departureTimeEl.value);
  const usesCustomCalendar=scheduleType==='recurring'&&repeatRuleEl.value==='custom';
  const departure=rawDeparture&&(!usesCustomCalendar||(operatingCalendar.days.length&&operatingCalendar.months.length))
    ? alignToOperatingCalendar(rawDeparture,usesCustomCalendar?'custom':repeatRuleEl.value,operatingCalendar.days,operatingCalendar.months)
    : null;
  if(!departure) return toast('Choose a valid departure time.');

  if(!ac) return toast('Choose an available aircraft.');
  if(from===to) return toast('Origin and destination must differ.');

  if(scheduleType==='ferry'){
    if(from!==ac.location) return toast(`${ac.tail} is at ${ac.location}; ferry origin updated.`);
    const ferry=estimateFerryFlight(from,to,ac,departure);
    if(!ferry.rangeOk) return toast(`${ac.model} does not have enough range for this ferry flight.`);
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+ferry.duration,label:'ferry flight'}]);
    if(!itinerary.ok) return toast(`${ac.tail} cannot operate this ferry flight: ${itinerary.reason}.`);
    const shortages=staffingShortagesForFlight(ac,departure,ferry.duration,from,null,true,'ferry');
    if(shortages.length) return toast(`Request required ferry personnel first · ${shortages.join(' · ')}`);
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare:0,flightType:'ferry'});
    selectedAircraftId=ac.id; selectedFlightId=f.id;
    save(); refreshAll();
    closeFlightPlanningWidget();
    return toast(`${f.id} ferry flight scheduled ${from} → ${to}.`);
  }

  const outbound=estimateFlight(from,to,ac,fares,{departure});
  if(!outbound.rangeOk) return toast(`${ac.model} does not have enough range for this route.`);
  if(scheduleType==='once'){
    const staffingShortages=staffingShortagesForFlight(ac,departure,outbound.duration,from);
    if(staffingShortages.length) return toast(`Request required personnel first · ${staffingShortages.join(' · ')}`);
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+outbound.duration,label:'new flight'}]);
    if(!itinerary.ok) return toast(`${ac.tail} cannot operate this flight: ${itinerary.reason}.`);
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare:fares});
    logEvent(`${f.id} scheduled ${from} → ${to} with ${ac.tail}.`);
    selectedAircraftId=ac.id;
    save(); refreshAll();
    closeFlightPlanningWidget();
    return toast(`${f.id} scheduled. ${formatDuration(outbound.duration)} block time.`);
  }

  const rule=repeatRuleEl.value;
  if(rule==='custom' && (!operatingCalendar.days.length||!operatingCalendar.months.length))
    return toast('Select at least one operating weekday and one operating month.');
  const turnaroundMin=Number(turnaroundEl.value)||90;
  const slotPlan=requiredSlotPlan(from,to,ac,fares,departure,turnaroundMin);
  const inbound=estimateFlight(to,from,ac,fares,{departure:slotPlan.returnDeparture});
  const alignedDeparture=slotPlan.outboundDeparture;
  const cycle=(slotPlan.returnDeparture-alignedDeparture)+inbound.duration;
  const returnNeedsLocalFlightCrew=cycle>12*HOUR;
  const outboundStaffingShortages=staffingShortagesForFlight(ac,alignedDeparture,cycle,from);
  if(outboundStaffingShortages.length) return toast(`Request required personnel first · ${outboundStaffingShortages.join(' · ')}`);
  const returnStaffingShortages=staffingShortagesForFlight(ac,slotPlan.returnDeparture,inbound.duration,to,null,returnNeedsLocalFlightCrew);
  if(returnStaffingShortages.length) return toast(`Request required return-flight personnel first · ${returnStaffingShortages.join(' · ')}`);
  const minInterval=minimumRepeatInterval(rule);

  if(!slotPlan.originRight||!slotPlan.destinationRight){
    return toast('Recurring service needs coordinated slot series at both airports. Request the missing series first.');
  }

  const itinerary=validateAircraftItinerary(ac,[
    {from,to,departure:alignedDeparture,arrival:alignedDeparture+outbound.duration,label:'new outbound'},
    {from:to,to:from,departure:slotPlan.returnDeparture,arrival:slotPlan.returnDeparture+inbound.duration,label:'new return'}
  ]);
  if(!itinerary.ok) return toast(`${ac.tail} cannot fit this rotation: ${itinerary.reason}.`);

  if(cycle>minInterval){
    return toast(
      `This aircraft needs ${formatDuration(cycle)} for the round trip. `+
      `Choose a less frequent repeat pattern or a shorter route.`
    );
  }

  const svc={
    id:'SCH'+state.nextService++,
    aircraftId:ac.id,from,to,fare:fares.economy,fares,rule,turnaroundMin,
    operatingDays:rule==='custom'?operatingCalendar.days:null,
    operatingMonths:rule==='custom'?operatingCalendar.months:null,
    firstDeparture:alignedDeparture,firstReturnDeparture:slotPlan.returnDeparture,
    nextDeparture:alignedDeparture,
    originSlotRightId:slotPlan.originRight.id,
    destinationSlotRightId:slotPlan.destinationRight.id,
    lastGeneratedDeparture:null,active:true,createdAt:simNow()
  };
  state.services.push(svc);
  ensureRecurringFlights();
  logEvent(`${svc.id} created: ${from} ↔ ${to}, ${rule}, ${ac.tail}.`);
  selectedAircraftId=ac.id;
  save(); refreshAll();
  closeFlightPlanningWidget();
  toast(`${svc.id} is active. Future round trips will be generated automatically.`);
}



function rotationForFlight(f){
  if(!f || !f.serviceId) return {service:null,outbound:f,returnFlight:null};
  const service=state.services.find(s=>s.id===f.serviceId) || null;
  const serviceFlights=state.flights
    .filter(x=>x.serviceId===f.serviceId)
    .sort((a,b)=>a.departure-b.departure);

  let outbound=null, returnFlight=null;
  if(f.serviceLeg==='outbound'){
    outbound=f;
    returnFlight=serviceFlights.find(x=>x.serviceLeg==='return' && x.departure>f.departure) || null;
  }else if(f.serviceLeg==='return'){
    returnFlight=f;
    const prior=serviceFlights.filter(x=>x.serviceLeg==='outbound' && x.departure<f.departure);
    outbound=prior[prior.length-1] || null;
  }else{
    outbound=f;
  }
  return {service,outbound,returnFlight};
}

function rotationReplacementCandidates(f){
  const {service,outbound,returnFlight}=rotationForFlight(f);
  if(!service || !outbound) return [];
  const now=simNow();
  if(flightActualDeparture(outbound)<=now) return [];

  const windowStart=outbound.departure-45*MIN;
  const windowEnd=(returnFlight?.arrival || outbound.arrival)+45*MIN;

  return state.aircraft.filter(ac=>{
    if(ac.id===outbound.aircraftId) return false;
    if(ac.location!==service.from) return false;
    if(aircraftIsDefective(ac,now)) return false;
    if(state.services.some(s=>s.active && s.id!==service.id && s.aircraftId===ac.id)) return false;

    const outEst=estimateFlight(service.from,service.to,ac,service.fares||service.fare);
    const backEst=estimateFlight(service.to,service.from,ac,service.fares||service.fare);
    if(!outEst.rangeOk || !backEst.rangeOk) return false;

    const conflict=state.flights.some(x=>
      x.aircraftId===ac.id &&
      !x.settled &&
      x.id!==outbound.id &&
      x.id!==(returnFlight?.id || '') &&
      flightActualArrival(x)>windowStart &&
      flightActualDeparture(x)<windowEnd
    );
    return !conflict;
  });
}

function substituteSelectedRotation(flightId,newAcId){
  const selected=state.flights.find(f=>f.id===flightId);
  const newAc=state.aircraft.find(a=>a.id===newAcId);
  if(!selected || !newAc) return;

  const {service,outbound,returnFlight}=rotationForFlight(selected);
  if(!service || !outbound) return toast('This flight is not part of a recurring schedule.');
  if(outbound.fueled) return toast('This round trip has already been fueled; its aircraft can no longer be changed.');
  if(flightActualDeparture(outbound)<=simNow()) return toast('This round trip has already started.');

  const candidates=rotationReplacementCandidates(selected);
  if(!candidates.some(a=>a.id===newAcId)){
    return toast(`${newAc.tail} is not available for this round trip.`);
  }

  outbound.aircraftId=newAcId;
  clearAircraftSpecificDelay(outbound);
  if(returnFlight){
    returnFlight.aircraftId=newAcId;
    clearAircraftSpecificDelay(returnFlight);
  }

  selectedAircraftId=newAcId;
  selectedFlightId=selected.id;
  recalculateOperations();
  save();
  refreshAll();
  toast(`${newAc.tail} will operate this round trip only.`);
}

function serviceReplacementCandidates(svc){
  const now=simNow();
  const nextOut=state.flights.filter(f=>f.serviceId===svc.id && f.serviceLeg==='outbound' && flightActualDeparture(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  return state.aircraft.filter(ac=>{
    if(ac.id===svc.aircraftId) return true;
    if(ac.location!==svc.from || aircraftIsDefective(ac,now)) return false;
    if(state.services.some(s=>s.active && s.id!==svc.id && s.aircraftId===ac.id)) return false;
    const out=estimateFlight(svc.from,svc.to,ac,svc.fares||svc.fare), back=estimateFlight(svc.to,svc.from,ac,svc.fares||svc.fare);
    if(!out.rangeOk || !back.rangeOk) return false;
    if(nextOut){
      const ret=state.flights.filter(f=>f.serviceId===svc.id && f.serviceLeg==='return' && f.departure>nextOut.departure)
        .sort((a,b)=>a.departure-b.departure)[0];
      const ws=nextOut.departure-30*MIN, we=(ret?.arrival||nextOut.arrival)+30*MIN;
      if(state.flights.some(f=>f.aircraftId===ac.id && !f.settled && flightActualArrival(f)>ws && flightActualDeparture(f)<we)) return false;
    }
    return true;
  });
}
function clearAircraftSpecificDelay(f){
  f.technicalDelayMin=0; f.propagatedDelayMin=0; f.slotDelayMin=0;
  f.slotMissed=false; f.slotLogged=false; f.opsChecked=false;
}
function substituteNextRotation(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('Choose a different spare aircraft.');
  if(!serviceReplacementCandidates(svc).some(a=>a.id===newAcId)) return toast(`${ac.tail} is not available at ${svc.from}.`);
  const now=simNow();
  const out=state.flights.filter(f=>f.serviceId===serviceId && f.serviceLeg==='outbound' && flightActualDeparture(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  if(!out) return toast('No future rotation found.');
  if(out.fueled) return toast('The next rotation has already been fueled and cannot be reassigned.');
  const ret=state.flights.filter(f=>f.serviceId===serviceId && f.serviceLeg==='return' && f.departure>out.departure)
    .sort((a,b)=>a.departure-b.departure)[0];
  out.aircraftId=newAcId; clearAircraftSpecificDelay(out);
  if(ret){ ret.aircraftId=newAcId; clearAircraftSpecificDelay(ret); }
  recalculateOperations(); logEvent(`${ac.tail} substituted for ${svc.id} next ${svc.from} ↔ ${svc.to} rotation.`);
  save(); refreshAll(); toast(`${ac.tail} will operate the next round trip only.`);
}
function changeServiceAircraft(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('That aircraft already owns this schedule.');
  if(state.flights.some(f=>f.serviceId===serviceId && statusOfFlight(f)==='airborne'))
    return toast('Wait until the current rotation is on the ground.');
  const nextFueledOutbound=state.flights
    .filter(f=>f.serviceId===serviceId && f.serviceLeg==='outbound' && flightActualDeparture(f)>simNow())
    .sort((a,b)=>a.departure-b.departure)[0];
  if(nextFueledOutbound?.fueled) return toast('The next rotation has already been fueled and cannot be reassigned.');
  if(!serviceReplacementCandidates(svc).some(a=>a.id===newAcId)) return toast(`${ac.tail} is not a suitable spare at ${svc.from}.`);
  const old=state.aircraft.find(a=>a.id===svc.aircraftId); svc.aircraftId=newAcId; const now=simNow();
  for(const f of state.flights){
    if(f.serviceId===serviceId && flightActualDeparture(f)>now){ f.aircraftId=newAcId; clearAircraftSpecificDelay(f); }
  }
  recalculateOperations(); logEvent(`${svc.id}: aircraft changed ${old?.tail||'unknown'} → ${ac.tail} for all future rotations.`);
  selectedAircraftId=newAcId; save(); refreshAll(); toast(`${ac.tail} is now permanently assigned to ${svc.id}.`);
}
function injectHandlingDelay(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  f.handlingDelayMin=(f.handlingDelayMin||0)+30; f.opsChecked=true;
  recalculateOperations(); logEvent(`${f.id}: manual test — ground handling delay +30 min.`);
  save(); refreshAll(); toast(`${f.id} now has a 30-minute handling delay.`);
}
function injectTechnicalDefect(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  if(aircraftActiveFlight(ac.id)) return toast('Defect testing is only available on the ground.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  const repairMin=180; ac.defectUntil=Math.max(ac.defectUntil||0,f.departure+repairMin*MIN); ac.defectReason='Technical defect';
  f.technicalDelayMin=Math.max(f.technicalDelayMin||0,repairMin); f.opsChecked=true;
  recalculateOperations(); logEvent(`${ac.tail}: technical defect; estimated repair 3h. Consider a substitute aircraft.`);
  save(); refreshAll(); toast(`${ac.tail} is defective for about 3 hours.`);
}

function delayFlight(flightId,minutes=15){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('Only a flight still on the ground can be held.');
  f.manualDelayMin=(Number(f.manualDelayMin)||0)+minutes;
  f.issueAcknowledgedAt=0; f.issueAcknowledgedKey='';
  recalculateOperations();
  save(); refreshAll();
  toast(`${f.id} held for ${minutes} additional minutes. Downstream delays were recalculated.`);
}

function flightCancellationTargets(f){
  if(!f.serviceId||f.serviceLeg!=='outbound') return [f];
  const rotation=rotationForFlight(f);
  return [rotation.outbound,rotation.returnFlight].filter(Boolean).filter(item=>!item.cancelled&&!item.departureLogged);
}

function cancelFlight(flightId,{skipConfirm=false,reason=''}={}){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('An airborne or completed flight cannot be cancelled.');
  const targets=flightCancellationTargets(f);
  const pairing=targets.length>1?' The paired return leg will also be cancelled so the aircraft remains correctly positioned.':'';
  if(!skipConfirm&&!window.confirm(`Cancel ${f.id}?${pairing}`)) return;
  for(const flight of targets){
    flight.cancelled=true; flight.cancelledAt=simNow(); flight.cancellationCost=0;
    flight.issueAcknowledgedAt=0; flight.issueAcknowledgedKey='';
    state.stats.cancelled+=1;
    for(const incident of state.incidents){
      if(incident.flightId!==flight.id||incident.status!=='open') continue;
      incident.status='resolved'; incident.blocking=false; incident.resolvedAt=simNow();
      incident.selectedAction='cancel'; incident.outcome=`${flight.id} cancelled${reason?` · ${reason}`:''}.`;
      for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
    }
  }
  recalculateOperations();
  save(); refreshAll();
  toast(`${targets.map(item=>item.id).join(' and ')} cancelled.`);
}

function prioritizeFuel(flightId){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('This flight can no longer be fueled on the ground.');
  if(!fuelFlight(f,simNow(),true)) return toast('Fueling is not possible yet: the aircraft must be at origin and this must be its next flight.');
  save(); refreshAll(); toast(`${f.id} fueled early.`);
}

function recoveryPlansForFlight(flight){
  if(!flight) return [];
  const downstreamFlights=state.flights
    .filter(item=>!item.cancelled&&item.aircraftId===flight.aircraftId&&item.departure>flight.departure&&item.departure<flight.departure+12*HOUR)
    .sort((a,b)=>a.departure-b.departure).slice(0,3);
  const aircraftRecoveryNeeded=Boolean(
    flight.technicalDelayMin||flight.maintenanceBlocked||flight.maintenanceDelayMin||flight.positioningBlocked
  );
  const plans=OperationalIntelligence.recoveryOptions({
    flight:{...flight,actualDeparture:flightActualDeparture(flight)},
    downstreamFlights:downstreamFlights.map(item=>({...item,actualDeparture:flightActualDeparture(item)})),
    connections:connectionStatusForFlight(flight),
    spareAvailable:aircraftRecoveryNeeded&&incidentReplacementCandidates(flight).length>0
  });
  const duty=crewDutyForFlight(flight);
  if(!duty.legal){
    if(!flight.crewAugmented){
      const augmented=OperationalIntelligence.crewDutyAssessment({
        departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),sectors:1,augmented:true
      });
      if(augmented.legal){
        return [{
          id:'augment-crew',label:'Assign augmented crew',tone:'good',delayMin:flightTotalDepartureDelayMin(flight),
          downstreamDelay:downstreamFlights.reduce((sum,item)=>sum+flightTotalDepartureDelayMin(item),0),
          misconnectPax:connectionStatusForFlight(flight).missed,risk:0,
          detail:'Add a relief cockpit pair and a second cabin complement so in-flight rest extends the legal duty limit.'
        }];
      }
    }
    return [{id:'crew-unavailable',label:'No legal crew configuration',tone:'bad',disabled:true,
      delayMin:flightTotalDepartureDelayMin(flight),downstreamDelay:0,misconnectPax:connectionStatusForFlight(flight).missed,risk:100,
      detail:'Even an augmented crew cannot operate this sector within the current duty model. Cancel or revise the flight plan.'}];
  }
  return plans;
}

function applyRecoveryPlan(flightId,planId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!flight||flight.departureLogged) return toast('Recovery changes are only available before departure.');
  const plan=recoveryPlansForFlight(flight).find(item=>item.id===planId);
  if(!plan) return toast('That recovery option is no longer available.');
  if(plan.disabled) return toast(plan.detail);
  if(planId==='accept-impact'){
    acknowledgeFlightIssue(flight.id); return;
  }
  if(planId==='augment-crew'){
    flight.crewAugmented=true;
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    const family=Management.aircraftFamily(aircraft.model);
    for(const role of ['captains','firstOfficers']){
      const missing=Math.max(0,2-qualifiedStaffAt(flight.from,role,family));
      if(missing) requestPersonnelResource(role,flight.from,missing,family);
    }
    const cabinRequired=Math.max(2,Math.ceil(cabinSeatCount(aircraft)/50)*2);
    const cabinMissing=Math.max(0,cabinRequired-staffAt(flight.from,'cabinCrew'));
    if(cabinMissing) requestPersonnelResource('cabinCrew',flight.from,cabinMissing);
    flight.recoveryAction='Augmented operating crew assigned';
  }else if(planId==='expedite'){
    flight.handlingDelayMin=Math.max(0,(flight.handlingDelayMin||0)-15);
    flight.recoveryAction='Ground resources prioritized';
  }else if(planId==='protect-connections'){
    for(const connection of connectionStatusForFlight(flight).connections.filter(item=>item.status!=='protected')){
      const onward=state.flights.find(item=>item.id===connection.flightId&&!item.departureLogged&&!item.cancelled);
      if(!onward) continue;
      const required=Math.min(30,Math.max(0,Math.ceil(connection.mctMin-connection.availableMin)));
      onward.manualDelayMin=(onward.manualDelayMin||0)+required;
      onward.recoveryAction=`Connection protection for ${flight.id}`;
    }
    flight.recoveryAction='Passenger connections protected';
  }else if(planId==='use-spare'){
    const spare=incidentReplacementCandidates(flight)[0];
    if(!spare) return toast('No eligible spare remains available.');
    if(flight.serviceId){ substituteSelectedRotation(flight.id,spare.id); return; }
    flight.aircraftId=spare.id; clearAircraftSpecificDelay(flight);
    flight.recoveryAction=`Spare ${spare.tail} assigned`;
  }
  flight.issueAcknowledgedAt=0; flight.issueAcknowledgedKey='';
  recalculateOperations(); updatePassengerConnections(); save(); refreshAll();
  toast(`${flight.id}: ${plan.label} applied.`);
}

function flightIssueKey(f){
  return [f.staffingBlocked,f.maintenanceBlocked,f.positioningBlocked,f.slotMissed,f.technicalDelayMin,f.handlingDelayMin,
    f.manualDelayMin,f.weatherDelayMin,f.incidentDelayMin,f.airportDelayMin,f.airspaceDelayMin,f.propagatedDelayMin,f.slotDelayMin,f.enrouteDelayMin,
    f.connectionAtRiskPax,f.connectionMissedPax,f.crewAugmented,
    openIncidentsForFlight(f.id).map(incident=>incident.id).join(',')].join(':');
}

function acknowledgeFlightIssue(flightId){
  const f=state.flights.find(item=>item.id===flightId);
  if(!f) return;
  f.issueAcknowledgedAt=simNow(); f.issueAcknowledgedKey=flightIssueKey(f);
  save(); refreshOccWidgets(true); refreshFleetList();
  toast(`${f.id} issue acknowledged. It will return if the situation changes.`);
}

function acknowledgeAircraftIssue(aircraftId){
  const ac=state.aircraft.find(item=>item.id===aircraftId);
  if(!ac) return;
  ac.issueAcknowledgedAt=simNow(); ac.issueAcknowledgedKey=aircraftIssueKey(ac);
  save(); refreshOccWidgets(true); refreshFleetList(); refreshAircraftDetails(true);
  toast(`${ac.tail} issue acknowledged. It will return if the situation changes.`);
}

function earliestMaintenancePlan(ac){
  const model=MODELS[ac.model];
  let start=simNow()+2*HOUR,airport=ac.location,guard=0;
  while(guard<100){
    const plan=Management.maintenancePlan(ac,start,airport,model.seats);
    const conflict=state.flights
      .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&flightActualArrival(f)>plan.start&&flightActualDeparture(f)<plan.end)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
    if(!conflict) return plan;
    start=flightActualArrival(conflict)+2*HOUR;
    airport=flightOperationalDestination(conflict);
    guard++;
  }
  return null;
}

function scheduleAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  if(!ac) return;
  const maintenance=Management.maintenanceStatus(ac,simNow());
  if(maintenance.scheduled) return toast(`${ac.tail} already has a scheduled check.`);
  const plan=earliestMaintenancePlan(ac);
  if(!plan) return toast(`No maintenance window found for ${ac.tail} in the current programme.`);
  if(!window.confirm(`Schedule ${ac.tail} for an outsourced check at ${plan.airport}?\n\nStart: ${formatTime(plan.start)}\nDuration: ${formatDuration(plan.end-plan.start)}`)) return;
  Management.ensureState(state,simNow());
  ac.maintenance.scheduled=plan;
  save(); refreshAll();
  toast(`${ac.tail} maintenance booked at ${plan.airport}.`);
}

function cancelAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  const job=ac&&Management.maintenanceStatus(ac,simNow()).scheduled;
  if(!job||job.status==='active') return toast('Active maintenance cannot be cancelled.');
  ac.maintenance.scheduled=null;
  save(); refreshAll(); toast(`${ac.tail} maintenance booking removed.`);
}

function cancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId);
  if(!svc) return;
  svc.active=false;
  const t=simNow();
  const removedFlightIds=new Set(state.flights
    .filter(f=>f.serviceId===serviceId&&flightActualDeparture(f)>t)
    .map(f=>f.id));
  for(const incident of state.incidents){
    if(!removedFlightIds.has(incident.flightId)||incident.status!=='open') continue;
    incident.status='resolved'; incident.blocking=false; incident.resolvedAt=t;
    incident.selectedAction='schedule_removed'; incident.outcome=`${serviceId} was removed from the programme.`;
    for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
  }
  state.flights=state.flights.filter(f => !(f.serviceId===serviceId && flightActualDeparture(f)>t));
  if(selectedFlightId && !state.flights.some(f=>f.id===selectedFlightId)) selectedFlightId=null;
  logEvent(`${serviceId} recurring schedule cancelled.`);
  save(); refreshAll(); refreshAircraftSelect(true);
  toast(`${serviceId} removed. Flights that had not departed were cancelled.`);
}
function confirmCancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId && s.active);
  if(!svc) return;
  const confirmed=window.confirm(
    `Remove ${svc.id} (${svc.from} ↔ ${svc.to})?\n\n`+
    'The recurring schedule will stop and all flights that have not departed will be cancelled. An airborne flight will finish.'
  );
  if(confirmed) cancelService(serviceId);
}

function requestAircraft(modelName,cabin=defaultCabin(modelName)){
  if(!MODELS[modelName]) return;
  const supply=resourceAvailability('aircraft',modelName,state.home);
  if(!supply.available){
    const request=queueResourceRequest('aircraft',{key:modelName,location:state.home,model:modelName,cabin},supply);
    refreshAll(); toast(`${modelName} requested. Allocation expected ${formatTime(request.readyAt)}.`); return request;
  }
  const ac=assignRequestedAircraft(modelName,cabin,state.home);
  save(); refreshAll(); toast(`${ac.tail} assigned from the operations pool at ${state.home}.`); return ac;
}

function aircraftHasAssignments(acId,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===acId);
  const groundOperation=aircraft&&aircraftGroundOperation(aircraft,t);
  return state.services.some(s=>s.active&&s.aircraftId===acId)||
    state.flights.some(f=>f.aircraftId===acId&&!f.cancelled&&flightActualArrival(f)>t)||
    Boolean(groundOperation?.phase.key==='postflight'&&groundOperation.phase.status!=='complete');
}

function releaseAircraft(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac||aircraftHasAssignments(ac.id)) return toast('Remove this aircraft’s active and future assignments first.');
  if(!window.confirm(`Release ${ac.tail} (${ac.model}) from the operations pool?`)) return;
  state.aircraft=state.aircraft.filter(a=>a.id!==ac.id);
  if(selectedAircraftId===ac.id){ selectedAircraftId=null; selectedFlightId=null; }
  save(); refreshAll(); toast(`${ac.tail} released from the operations pool.`);
}

function settleSelected(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac) return;

  selectedFlightId=null;
  selectedAircraftId=acId;
  refreshFleetList();
  refreshOccWidgets(true);
  refreshFlightDetails(true);
  const detailsWidget=document.querySelector('[data-widget="context-workbench"]');
  if(detailsWidget) setWidgetOpen(detailsWidget,true,{persist:false});
  refreshAircraftDetails(true);
  refreshSlotPortfolio(true);
  refreshPersonnel(true);
  refreshMaintenance(true);
  refreshWeather(true);
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  const rightSidebar=detailsWidget?.closest('.sidebar');
  if(rightSidebar) rightSidebar.scrollTo({top:detailsWidget.offsetTop,behavior:'smooth'});
}


function settleSelectedFlight(flightId){
  const f=state.flights.find(x=>x.id===flightId);
  if(!f) return;

  selectedFlightId=f.id;
  selectedAircraftId=f.aircraftId;
  alignScheduleWindowToFlight(f);

  refreshFleetList();
  const detailsWidget=document.querySelector('[data-widget="context-workbench"]');
  if(detailsWidget) setWidgetOpen(detailsWidget,true,{persist:false});
  refreshOccWidgets(true);
  refreshFlightDetails(true);
  refreshAircraftDetails(true);
  refreshSlotPortfolio(true);
  refreshPersonnel(true);
  refreshMaintenance(true);
  refreshWeather(true);
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  const rightSidebar=detailsWidget?.closest('.sidebar');
  if(rightSidebar) rightSidebar.scrollTo({top:0,behavior:'smooth'});
}

function clearSelectedFlight(){
  selectedFlightId=null;
  selectedAircraftId=null;
  refreshFleetList();
  refreshOccWidgets(true);
  refreshFlightDetails(true);
  refreshAircraftDetails(true);
  refreshSlotPortfolio(true);
  refreshPersonnel(true);
  refreshMaintenance(true);
  refreshWeather(true);
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
}

function clearSelectedAircraft(){
  clearSelectedFlight();
}

function toggleAircraftCard(acId){
  if(selectedAircraftId===acId&&selectedFlightId){
    settleSelected(acId);
    return;
  }
  if(selectedAircraftId===acId){
    selectedAircraftId=null;
    selectedFlightId=null;
    refreshFleetList();
    refreshOccWidgets(true);
    refreshFlightDetails(true);
    refreshAircraftDetails(true);
    refreshSlotPortfolio(true);
    refreshPersonnel(true);
    refreshMaintenance(true);
    refreshWeather(true);
    routeSignature='';
    updateMapData();
    lastScheduleSignature='';
    refreshScheduleTimeline(true);
    return;
  }
  settleSelected(acId);
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}
