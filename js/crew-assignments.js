/* Qualified crew reservations, reporting, assignment, and fitness for duty. */
const CREW_ROLES=['captains','firstOfficers','cabinCrew'];
const CREW_ASSIGNMENT_MODES={reserve:'Activate reserves',replace:'Replace selected roles',full:'Swap full crew',augment:'Restore augmentation'};
const CREW_PENDING_STATES=new Set(['requested','accepted','reporting','briefing']);

function crewAssignments(){ return state.crewAssignments||[]; }
function crewAssignmentById(id){ return crewAssignments().find(item=>item.id===id)||null; }
function crewAssignmentPending(record){ return CREW_PENDING_STATES.has(record?.status); }
function crewAssignmentActive(record){ return crewAssignmentPending(record)||['assigned','operating','resting'].includes(record?.status); }
function crewAssignmentFlights(record){
  return (record.flightIds||[record.flightId]).map(id=>state.flights.find(flight=>flight.id===id)).filter(flight=>flight&&!flight.cancelled);
}
function crewAssignmentForRole(flight,role){
  const record=crewAssignmentById(flight?.crewRoleSwaps?.[role]?.assignmentId);
  return record&&record.assignedAt&&!['cancelled','failed'].includes(record.status)&&record.allocations.some(item=>item.role===role&&!item.releasedAt)?record:null;
}
function assignedCrewRoleCount(flight,role){
  return crewAssignmentsForRole(flight,role).reduce((sum,record)=>sum+(record.roles[role]||0),0);
}
function crewAssignmentsForRole(flight,role){
  const records=[];
  let record=crewAssignmentForRole(flight,role);
  while(record&&!records.includes(record)){
    if(record.allocations.some(item=>item.role===role&&!item.releasedAt)) records.push(record);
    else break;
    record=crewAssignmentById(record.parentAssignments?.[role]);
  }
  return records;
}
function crewUnavailabilityForFlight(flight,t=simNow()){
  return (state.crewUnavailability||[]).filter(item=>item.flightIds.includes(flight.id)&&
    !(item.reason==='late_report'&&t>=item.until)&&
    !((crewAssignmentForRole(flight,item.role)?.assignedAt||0)>=item.at&&crewAssignmentForRole(flight,item.role)?.id!==item.assignmentId));
}
function crewUnavailableRoleCount(flight,role,t=simNow()){
  return Math.max(0,...crewUnavailabilityForFlight(flight,t).filter(item=>item.role===role).map(item=>item.amount));
}
function crewRosterRoleCount(flight,role,{excludeUnavailable=false}={}){
  const required=crewRequirementForFlight(flight)[role]||0;
  return Math.max(0,required-assignedCrewRoleCount(flight,role)-(excludeUnavailable?crewUnavailableRoleCount(flight,role):0));
}

function crewGroundActionBlocker(flight,t=simNow()){
  if(!flight||flight.cancelled) return 'Choose an operating flight.';
  if(flightHasCompleted(flight,t)) return 'This flight is complete.';
  if(flightHasDeparted(flight,t)) return 'Crew changes require the aircraft to be on stand before departure.';
  if(!state.aircraft.some(item=>item.id===flight.aircraftId)) return 'Assign an aircraft first.';
  return '';
}

function crewReservationAt(airport,role,family='',{excludeId='',t=simNow()}={}){
  let amount=0;
  for(const record of crewAssignments()){
    if(record.id===excludeId||!crewAssignmentActive(record)) continue;
    for(const allocation of record.allocations){
      if(allocation.releasedAt){
        if((allocation.releaseAirport||record.airport)===airport&&allocation.role===role&&t<allocation.availableAfter&&(record.departedAt||allocation.sourceType!=='recovery')) amount+=family?Number(allocation.qualifications[family]||0):allocation.amount;
        continue;
      }
      const transfer=allocation.sourceType==='transfer'&&(state.personnelTransfers||[]).find(item=>item.id===allocation.sourceId);
      const atStation=allocation.sourceType==='station'||(transfer?.status==='completed');
      const location=record.returnedAt?record.returnAirport:record.airport;
      if(location!==airport||allocation.role!==role) continue;
      if(record.returnedAt){ if(t>=record.restUntil) continue; }
      else if(record.departedAt||!atStation) continue;
      amount+=family?Number(allocation.qualifications[family]||0):allocation.amount;
    }
  }
  for(const absence of state.crewUnavailability||[]){
    if((absence.poolAirport||absence.airport)!==airport||absence.role!==role||absence.until<=t||absence.assignmentId) continue;
    amount+=family?Number(absence.qualifications[family]||0):absence.amount;
  }
  return amount;
}

function crewRecoveryReservedCount(recoveryId,role,excludeId=''){
  return crewAssignments().reduce((sum,record)=>sum+(record.id!==excludeId&&crewAssignmentActive(record)&&!record.departedAt
    ?record.allocations.filter(item=>item.sourceType==='recovery'&&item.sourceId===recoveryId&&item.role===role).reduce((n,item)=>n+item.amount,0):0),0);
}

function crewRecordRoleQualifications(airport,role,family,amount){
  if(role==='cabinCrew') return {};
  const specific=Math.min(amount,qualificationAt(airport,role,family));
  return {...(specific?{[family]:specific}:{}),...(amount>specific?{'Multi-fleet':amount-specific}:{})};
}

function recordCrewUnavailability(flight,roles,{reason='fatigue',sourceId='',at=simNow(),until=0,amounts={}}={}){
  if(!flight) return [];
  const family=crewRecoveryFlightFamily(flight);
  const duty=crewDutyForFlight(flight);
  const flightIds=(duty.flightIds||[flight.id]).filter(id=>{
    const item=state.flights.find(f=>f.id===id);
    return item&&!flightHasDeparted(item,at)&&flightActualDeparture(item)>=flightActualDeparture(flight);
  });
  if(!flightIds.includes(flight.id)) flightIds.unshift(flight.id);
  const created=[];
  state.crewUnavailability??=[];
  for(const role of roles.filter(role=>CREW_ROLES.includes(role))){
    const existing=state.crewUnavailability.find(item=>item.sourceId===sourceId&&sourceId&&item.role===role);
    if(existing){ created.push(existing); continue; }
    const current=crewAssignmentForRole(flight,role);
    if(crewUnavailabilityForFlight(flight,at).some(item=>item.role===role&&item.reason!=='late_report')) continue;
    const required=crewRequirementForFlight(flight)[role]||0;
    const amount=Math.min(required,Math.max(1,Math.floor(Number(amounts[role])||1)));
    if(!amount) continue;
    const unavailableUntil=Math.max(at+MIN,Number(until)||at+(reason==='sick'?24*HOUR:reason==='late_report'?35*MIN:10*HOUR));
    const poolAirport=flightUsesLocalCrew(flight)?flight.from:(duty.airport||flight.from);
    const record={id:`CU${state.nextCrewUnavailability++}`,sourceId,flightIds,role,amount,airport:flight.from,poolAirport,family,
      assignmentId:current?.id||'',qualifications:crewRecordRoleQualifications(poolAirport,role,family,amount),reason,at,until:unavailableUntil};
    state.crewUnavailability.push(record);
    for(const assignment of crewAssignmentsForRole(flight,role)) releaseCrewAssignmentRoles(assignment,[role],at,{airport:flight.from,availableAfter:unavailableUntil});
    created.push(record);
  }
  return created;
}

function crewAssignmentSourceOptions(flight,t=simNow()){
  if(!flight) return [];
  const options=[{id:'local',label:`Station pool - ${flight.from}`}];
  for(const transfer of state.personnelTransfers||[]){
    if(!CREW_ROLES.includes(transfer.role)||transfer.status==='cancelled'||(transfer.actualTo||transfer.to)!==flight.from) continue;
    if(transfer.status==='completed') continue;
    options.push({id:`transfer:${transfer.id}`,label:`${transfer.id} - ${PERSONNEL[transfer.role].label} from ${transfer.from}`});
  }
  for(const recovery of state.crewRecoveries||[]){
    if(recovery.availableAirport!==flight.from||recovery.status==='cancelled') continue;
    if(CREW_ROLES.every(role=>crewRecoveryRoleCount(recovery,role)<=0)) continue;
    options.push({id:`recovery:${recovery.id}`,label:`${recovery.id} - ${crewRecoveryActionLabel(recovery.action)} - ${flight.from}`});
  }
  return options;
}

function crewSourceAvailability(flight,sourceId,role,{excludeId='',until=flightActualArrival(flight)+30*MIN,t=simNow()}={}){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const family=crewRecoveryFlightFamily(flight);
  const [type,id]=sourceId.split(':');
  if(type==='transfer'||type==='recovery'){
    const source=type==='transfer'?(state.personnelTransfers||[]).find(item=>item.id===id):(state.crewRecoveries||[]).find(item=>item.id===id);
    if(!source||source.status==='cancelled') return {amount:0,readyAt:t,reason:'The source is no longer available.',qualifications:{}};
    const airport=type==='transfer'?(source.actualTo||source.to):source.availableAirport;
    if(airport!==flight.from) return {amount:0,readyAt:t,reason:`Crew is now going to ${airport}, not ${flight.from}.`,qualifications:{}};
    const readyAt=type==='transfer'?source.arrival:source.availableAt;
    const total=type==='transfer'?(source.role===role?source.amount:0):Math.max(0,crewRecoveryRoleCount(source,role,family)-(source.consumedRoles?.[role]||0));
    const qualifications=role==='cabinCrew'?{}:type==='transfer'?(source.qualifications||{}):{[source.family||'Multi-fleet']:total};
    const reserved=crewAssignments().filter(record=>record.id!==excludeId&&crewAssignmentActive(record)&&!record.departedAt)
      .flatMap(record=>record.allocations).filter(item=>item.sourceType===type&&item.sourceId===id&&item.role===role).reduce((sum,item)=>sum+item.amount,0);
    const qualified=role==='cabinCrew'?total:(qualifications[family]||0)+(qualifications['Multi-fleet']||0);
    const amount=Math.max(0,Math.min(total,qualified)-reserved);
    return {amount,readyAt:Math.max(t,readyAt||t),qualifications,sourceType:type,sourceId:id,reason:amount?'':'No uncommitted qualified crew in this source.'};
  }
  const coverageStart=Math.max(t,flightActualDeparture(flight));
  const snapshot=staffingRequirementSnapshot(aircraft,coverageStart,Math.max(MIN,until-coverageStart),flight.from,flight.id,true,flight.flightType,{allCommitments:true});
  const absent=Math.max(0,...crewUnavailabilityForFlight(flight,t).filter(item=>item.role===role&&(item.poolAirport||item.airport)===flight.from).map(item=>item.amount));
  const total=availableStationStaffAt(flight.from,role)+crewReservationCredit(excludeId,role);
  const demand=Math.max(0,(snapshot.needed[role]||0)-absent);
  const ratings=role==='cabinCrew'?{}:Object.fromEntries([family,'Multi-fleet'].map(rating=>[
    rating,Math.max(0,availableQualificationAt(flight.from,role,rating)+crewReservationCredit(excludeId,role,rating))
  ]));
  const qualifiedDemand=Math.max(0,(snapshot.qualifiedNeeded[role]||0)-absent);
  const qualified=role==='cabinCrew'?Infinity:Object.values(ratings).reduce((sum,n)=>sum+n,0)-qualifiedDemand;
  const amount=Math.max(0,Math.min(total-demand,qualified));
  const reason=amount?'':qualified<=0
    ? `No uncommitted ${family}-qualified ${PERSONNEL[role].label.toLowerCase()} cover this duty.`
    : 'All station crew are committed during this duty window.';
  return {amount,readyAt:t,qualifications:ratings,sourceType:'station',sourceId:'',reason};
}

function crewReservationCredit(id,role,family=''){
  const record=crewAssignmentById(id);
  if(!record||record.departedAt||!crewAssignmentActive(record)) return 0;
  return record.allocations.filter(item=>item.role===role&&item.sourceType==='station').reduce((sum,item)=>sum+(family?(item.qualifications[family]||0):item.amount),0);
}

function crewAssignmentRequestRoles(flight,mode,selectedRoles){
  const requirement=crewRequirementForFlight(flight);
  const roles=mode==='full'?CREW_ROLES:mode==='augment'?CREW_ROLES:selectedRoles;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const deficits=mode==='augment'&&flight.crewAugmented?personnelDeficitsForFlight(aircraft,Math.max(simNow(),flightActualDeparture(flight)),flightActualArrival(flight)-flightActualDeparture(flight),flight.from,flight.id,true,flight.flightType):[];
  const operationalNeeds=crewAssignmentNeedsForFlight(flight);
  return Object.fromEntries(roles.filter(role=>CREW_ROLES.includes(role)).map(role=>[
    role,mode==='augment'
      ? (flight.crewAugmented?Math.min(requirement[role],Math.max(crewUnavailableRoleCount(flight,role),deficits.find(item=>item.role===role)?.amount||0)):requirement[role])
      : mode==='full'?requirement[role]:(operationalNeeds[role]||requirement[role])
  ]).filter(([,count])=>count>0));
}

function crewAssignmentNeedsForFlight(flight,t=simNow()){
  if(!flight) return {};
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return {};
  const requirement=crewRequirementForFlight(flight,aircraft);
  const needs=Object.fromEntries(CREW_ROLES.map(role=>[role,Math.min(requirement[role]||0,crewUnavailableRoleCount(flight,role,t))]));
  const departure=Math.max(t,flightActualDeparture(flight));
  const duration=Math.max(MIN,flightActualArrival(flight)-flightActualDeparture(flight));
  for(const deficit of personnelDeficitsForFlight(aircraft,departure,duration,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType)){
    if(CREW_ROLES.includes(deficit.role)) needs[deficit.role]=Math.min(requirement[deficit.role]||0,Math.max(needs[deficit.role]||0,deficit.amount||0));
  }
  return Object.fromEntries(Object.entries(needs).filter(([,amount])=>amount>0));
}

function crewAssignmentTiming(flight,mode,source,requestedAt,sourceReadyAt){
  const seed=`${flight.id}:${mode}:${source}:${state.nextCrewAssignment}`;
  const responseMin=3+Math.floor(stableFraction(`${seed}:response`)*5);
  const travelMin=source==='reserve'?25+Math.floor(stableFraction(`${seed}:report`)*21):0;
  const briefingMin=15+Math.floor(stableFraction(`${seed}:brief`)*11);
  const acceptedAt=requestedAt+responseMin*MIN;
  const reportAt=Math.max(acceptedAt+travelMin*MIN,sourceReadyAt);
  return {acceptedAt,reportAt,briefingMin,readyAt:reportAt+briefingMin*MIN};
}

function crewAssignmentDutyAssessment(flight,roles,reportAt,readyAt,{full=false,augment=false}={}){
  const rotation=rotationForFlight(flight);
  const through=!full&&rotationUsesThroughCrew(flight)&&rotation.returnFlight;
  const flights=through?[flight,...(flight.id!==rotation.returnFlight.id?[rotation.returnFlight]:[])]:[flight];
  const delay=Math.max(0,readyAt-flightActualDeparture(flight));
  const arrival=Math.max(...flights.map(item=>flightActualArrival(item)))+delay;
  const old=crewDutyForFlight(flight);
  const base=OperationalIntelligence.crewDutyAssessment({departure:Math.max(readyAt,flightActualDeparture(flight)),arrival,sectors:flights.length,augmented:augment||Boolean(flight.crewAugmented)});
  const roleDuties=CREW_ROLES.filter(role=>crewRequirementForFlight(flight)[role]>0).map(role=>{
    const replaced=full||Boolean(roles[role]);
    const prior=old.roleDuties?.[role]?.dutyStart||old.dutyStart;
    const start=augment?Math.min(prior,reportAt):replaced?reportAt:prior;
    const maxHours=augment?base.maxHours:replaced?base.maxHours:(old.roleDuties?.[role]?.maxHours||old.maxHours);
    const dutyHours=(arrival+30*MIN-start)/HOUR;
    return {role,dutyStart:start,dutyEnd:arrival+30*MIN,dutyHours,maxHours,legal:dutyHours<=maxHours};
  });
  return {legal:roleDuties.every(item=>item.legal),roleDuties,flightIds:flights.map(item=>item.id),releaseAt:arrival+30*MIN,
    reason:roleDuties.filter(item=>!item.legal).map(item=>`${PERSONNEL[item.role].label}: ${item.dutyHours.toFixed(1)}h / ${item.maxHours.toFixed(1)}h`).join(' · ')};
}

function crewAssignmentPreview(flightId,{mode='reserve',roles=['captains'],source='reserve',record=null}={}){
  const t=simNow(),flight=state.flights.find(item=>item.id===flightId);
  let blocker=crewGroundActionBlocker(flight,t);
  if(blocker) return {flight,blocker,roles:{},availability:[],cost:0};
  if(!CREW_ASSIGNMENT_MODES[mode]) blocker='Choose a crew assignment action.';
  if(record&&(record.family!==crewRecoveryFlightFamily(flight)||record.airport!==flight.from)) blocker='The aircraft qualification or departure station changed. Make a new crew request.';
  if(crewAssignments().some(item=>item.flightId===flightId&&crewAssignmentPending(item)&&item.id!==record?.id)) blocker='A crew request is already in progress for this flight.';
  const required=record?.roles||crewAssignmentRequestRoles(flight,mode,roles);
  if(!Object.keys(required).length) blocker=mode==='augment'?'No missing augmented crew complement.':'Select at least one required crew role.';
  if(mode==='augment'&&flight.flightType==='ferry') blocker='This ferry does not need augmented crew.';
  const availability=Object.entries(required).map(([role,amount])=>({role,required:amount,...crewSourceAvailability(flight,source,role,{excludeId:record?.id,t})}));
  const unavailable=availability.filter(item=>item.amount<item.required);
  if(unavailable.length) blocker=unavailable.map(item=>`${PERSONNEL[item.role].label}: ${item.amount}/${item.required}. ${item.reason||''}`).join(' · ');
  const sourceReadyAt=Math.max(t,...availability.map(item=>item.readyAt));
  const timing=record?{acceptedAt:record.acceptedAt,reportAt:record.reportAt,briefingMin:record.briefingMin,readyAt:record.readyAt}
    :crewAssignmentTiming(flight,mode,source,t,sourceReadyAt);
  const duty=crewAssignmentDutyAssessment(flight,required,timing.reportAt,timing.readyAt,{full:mode==='full',augment:mode==='augment'});
  if(!duty.legal) blocker=`Crew duty would be illegal: ${duty.reason}. Retime, replace more roles, or revise the flight in Dispatch.`;
  const cost=crewAssignmentCost(required);
  return {flight,mode,source,roles:required,availability,sourceReadyAt,...timing,duty,cost,blocker,
    delayMin:Math.max(0,Math.ceil((timing.readyAt-flightActualDeparture(flight))/MIN))};
}

function crewAssignmentAllocate(preview){
  const family=crewRecoveryFlightFamily(preview.flight);
  return preview.availability.map(item=>{
    const amount=item.required;
    const specific=Math.min(amount,Number(item.qualifications[family])||0);
    const qualifications=item.role==='cabinCrew'?{}:{...(specific?{[family]:specific}:{}),...(amount>specific?{'Multi-fleet':amount-specific}:{})};
    return {sourceType:item.sourceType,sourceId:item.sourceId,role:item.role,amount,qualifications};
  });
}

function requestCrewAssignment(flightId,options={}){
  const preview=crewAssignmentPreview(flightId,options);
  if(preview.blocker){ toast(preview.blocker); return null; }
  const t=simNow();
  const record={id:`CA${state.nextCrewAssignment++}`,flightId,flightIds:preview.duty.flightIds,airport:preview.flight.from,
    family:crewRecoveryFlightFamily(preview.flight),mode:preview.mode,source:preview.source,roles:preview.roles,
    allocations:crewAssignmentAllocate(preview),status:'requested',requestedAt:t,updatedAt:t,
    acceptedAt:preview.acceptedAt,reportAt:preview.reportAt,briefingMin:preview.briefingMin,readyAt:preview.readyAt,
    assignedAt:0,departedAt:0,returnedAt:0,restUntil:0,cost:preview.cost,outcome:''};
  record.originalRoleDuties=Object.fromEntries(CREW_ROLES.map(role=>[role,crewDutyForFlight(preview.flight).roleDuties?.[role]?.dutyStart||crewDutyForFlight(preview.flight).dutyStart]));
  state.crewAssignments.push(record);
  const cost=recordRecoveryCostEvent({flight:preview.flight,category:'crew',kind:'crew_assignment',amount:record.cost,
    crew:Object.values(record.roles).reduce((sum,count)=>sum+count,0),airport:record.airport,description:`${record.id}: ${CREW_ASSIGNMENT_MODES[record.mode]}`});
  record.cost=cost?.amount||record.cost;
  updateCrewAssignmentEffects(t);
  AeroServices.commit();
  return record;
}

function cancelCrewAssignment(id){
  const record=crewAssignmentById(id);
  if(!record||!crewAssignmentPending(record)) return false;
  finishCrewAssignmentRequest(record,'cancelled','Crew request cancelled.',simNow());
  updateCrewAssignmentEffects();
  AeroServices.commit();
  return true;
}

function finishCrewAssignmentRequest(record,status,outcome,t){
  record.status=status; record.outcome=outcome; record.updatedAt=t;
}

function crewAssignmentSourceReady(record,t){
  for(const allocation of record.allocations){
    if(allocation.sourceType==='station') continue;
    const source=allocation.sourceType==='transfer'?(state.personnelTransfers||[]).find(item=>item.id===allocation.sourceId):(state.crewRecoveries||[]).find(item=>item.id===allocation.sourceId);
    if(!source||source.status==='cancelled') return {failed:'The crew source was cancelled or removed.'};
    const airport=allocation.sourceType==='transfer'?(source.actualTo||source.to):source.availableAirport;
    if(airport!==record.airport) return {failed:`Crew arrived or will arrive at ${airport}; ${record.airport} is required.`};
    const readyAt=allocation.sourceType==='transfer'?source.arrival:source.availableAt;
    if(readyAt>record.reportAt){ record.reportAt=readyAt; record.readyAt=readyAt+record.briefingMin*MIN; }
    if(allocation.sourceType==='transfer'&&source.status!=='completed') return {ready:false};
    if(allocation.sourceType==='recovery'&&!crewRecoveryRecordIsAvailable(source,t)) return {ready:false};
  }
  return {ready:true};
}

function installCrewAssignment(record,t){
  const flight=state.flights.find(item=>item.id===record.flightId);
  record.parentAssignments={};
  for(const role of Object.keys(record.roles)){
    const previous=crewAssignmentsForRole(flight,role);
    if(record.mode==='augment'&&previous.length) record.parentAssignments[role]=previous[0].id;
    else if(previous.length) previous.forEach(item=>releaseCrewAssignmentRoles(item,[role],record.readyAt,{airport:flight.from}));
    else if(record.mode!=='augment'&&!crewUnavailableRoleCount(flight,role,record.readyAt)&&record.originalRoleDuties[role]<=record.readyAt){
      recordCrewUnavailability(flight,[role],{reason:'released',at:record.readyAt,sourceId:`${record.id}:outgoing`});
    }
  }
  record.assignedAt=record.readyAt;
  record.status='assigned'; record.updatedAt=t;
  if(record.mode==='full') flight.crewDutySplit=true;
  for(const item of crewAssignmentFlights(record)){
    item.crewRoleSwaps??={};
    for(const role of Object.keys(record.roles)){
      item.crewRoleSwaps[role]={role,assignmentId:record.id,at:record.assignedAt,reportAt:record.reportAt,count:record.roles[role],reason:CREW_ASSIGNMENT_MODES[record.mode]};
    }
    if(record.mode==='augment') item.crewAugmented=true;
  }
  flight.crewSwappedAt=record.assignedAt;
  flight.crewAssignmentReadyAt=Math.max(flight.crewAssignmentReadyAt||0,record.readyAt);
  record.outcome=`Assigned to ${record.flightId}; ready ${formatTime(record.readyAt)}.`;
}

function processCrewAssignments(t=simNow()){
  let changed=false;
  for(const record of crewAssignments()){
    if(!crewAssignmentActive(record)) continue;
    if(record.allocations.every(item=>item.releasedAt)){
      record.restUntil=Math.max(...record.allocations.map(item=>item.availableAfter));
      const status=t>=record.restUntil?'completed':'resting';
      if(record.status!==status){record.status=status;record.updatedAt=t;changed=true;}
      continue;
    }
    const flight=state.flights.find(item=>item.id===record.flightId&&!item.cancelled);
    if(!flight&&!record.departedAt){ finishCrewAssignmentRequest(record,'cancelled','Flight cancelled or removed; reservation released.',t); changed=true; continue; }
    if(crewAssignmentPending(record)){
      const oldSignature=[record.status,record.reportAt,record.readyAt].join(':');
      const blocker=crewGroundActionBlocker(flight,t);
      if(blocker){ finishCrewAssignmentRequest(record,'failed',blocker,t); changed=true; continue; }
      const source=crewAssignmentSourceReady(record,t);
      if(source.failed){ finishCrewAssignmentRequest(record,'failed',source.failed,t); changed=true; continue; }
      if(t>=record.readyAt&&source.ready){
        const preview=crewAssignmentPreview(flight.id,{mode:record.mode,roles:Object.keys(record.roles),source:record.source,record});
        if(preview.blocker){ finishCrewAssignmentRequest(record,'failed',preview.blocker,t); changed=true; continue; }
        installCrewAssignment(record,t);
      }else if(t>=record.reportAt&&source.ready) record.status='briefing';
      else if(t>=record.acceptedAt) record.status=source.ready?'reporting':'accepted';
      if(oldSignature!==[record.status,record.reportAt,record.readyAt].join(':')){ record.updatedAt=t; changed=true; }
    }
    if(record.status==='assigned'&&flightHasDeparted(flight,t)){
      for(const allocation of record.allocations){
        if(allocation.releasedAt) continue;
        if(allocation.sourceType==='recovery'){
          const recovery=(state.crewRecoveries||[]).find(item=>item.id===allocation.sourceId);
          recovery.consumedRoles??={};
          recovery.consumedRoles[allocation.role]=(recovery.consumedRoles[allocation.role]||0)+allocation.amount;
        }else{
          changeStaff(record.airport,allocation.role,-allocation.amount);
          for(const [family,count] of Object.entries(allocation.qualifications)) changeQualification(record.airport,allocation.role,family,-count);
        }
      }
      record.departedAt=flightActualDeparture(flight); record.status='operating'; record.updatedAt=t; changed=true;
    }
    if(record.status==='operating'){
      const flights=crewAssignmentFlights(record);
      const last=flights.at(-1);
      if(last&&flightHasCompleted(last,t)){
        record.returnAirport=flightOperationalDestination(last);
        record.returnedAt=flightActualArrival(last)+30*MIN;
        record.restUntil=record.returnedAt+10*HOUR;
        for(const allocation of record.allocations.filter(item=>!item.releasedAt)){
          changeStaff(record.returnAirport,allocation.role,allocation.amount);
          for(const [family,count] of Object.entries(allocation.qualifications)) changeQualification(record.returnAirport,allocation.role,family,count);
        }
        record.status='resting'; record.updatedAt=t; changed=true;
      }
    }
    if(record.status==='resting'&&t>=record.restUntil){ record.status='completed'; record.updatedAt=t; changed=true; }
  }
  return changed;
}

function crewFlightCoverageStatus(flight,t=simNow()){
  const reasons=[];
  const pending=crewAssignments().filter(item=>item.flightIds.includes(flight.id)&&crewAssignmentPending(item));
  if(pending.length) reasons.push('Replacement crew has not completed reporting and briefing.');
  for(const absence of crewUnavailabilityForFlight(flight,t)) reasons.push(`${PERSONNEL[absence.role].label}: ${absence.reason.replaceAll('_',' ')}; replacement required.`);
  for(const role of CREW_ROLES.filter(role=>role!=='cabinCrew')){
    if(crewAssignmentsForRole(flight,role).some(record=>record.family!==crewRecoveryFlightFamily(flight))) reasons.push(`${PERSONNEL[role].label}: assigned crew is not qualified for the current aircraft family.`);
  }
  return {ready:!reasons.length,pending,reasons,readyAt:Math.max(0,...pending.map(item=>item.readyAt))};
}

function crewAssignedDutyAssessment(flights,assessment){
  const roleDuties={};
  const applicable=flights.filter(Boolean);
  for(const role of CREW_ROLES){
    const segments=[];
    for(const flight of applicable){
      if(!crewRequirementForFlight(flight)[role]) continue;
      const record=crewAssignmentForRole(flight,role);
      const baseline=crewAssignments().find(item=>item.assignedAt&&item.flightIds.includes(flight.id))?.originalRoleDuties?.[role]||assessment.dutyStart;
      const start=record?(record.mode==='augment'?Math.min(baseline,record.reportAt):record.reportAt):baseline;
      const release=flightActualArrival(flight)+30*MIN;
      const limit=OperationalIntelligence.crewDutyAssessment({departure:start+60*MIN,arrival:release-30*MIN,sectors:record?record.flightIds.length:assessment.sectors,augmented:assessment.augmented||Boolean(flight.crewAugmented)});
      segments.push({dutyStart:start,dutyEnd:release,dutyHours:(release-start)/HOUR,maxHours:limit.maxHours,assignmentId:record?.id||''});
    }
    if(!segments.length) continue;
    const limiting=segments.reduce((worst,item)=>(item.maxHours-item.dutyHours)<(worst.maxHours-worst.dutyHours)?item:worst);
    roleDuties[role]={...limiting,legal:segments.every(item=>item.dutyHours<=item.maxHours),segments};
  }
  const duties=Object.values(roleDuties);
  if(!duties.length) return {...assessment,roleDuties};
  const limiting=duties.reduce((a,b)=>a.maxHours-a.dutyHours<b.maxHours-b.dutyHours?a:b);
  return {...assessment,roleDuties,legal:duties.every(item=>item.legal),dutyStart:Math.min(...duties.map(item=>item.dutyStart)),
    dutyHours:limiting.dutyHours,maxHours:limiting.maxHours,remainingHours:limiting.maxHours-limiting.dutyHours};
}

function releaseCrewAssignmentRoles(record,roles,at,{airport=record.airport,availableAfter=at+10*HOUR}={}){
  for(const allocation of record.allocations){
    if(!roles.includes(allocation.role)||allocation.releasedAt) continue;
    allocation.releasedAt=at;
    allocation.releaseAirport=airport;
    allocation.availableAfter=availableAfter;
    if(record.departedAt&&!record.returnedAt){
      changeStaff(airport,allocation.role,allocation.amount);
      for(const [family,count] of Object.entries(allocation.qualifications)) changeQualification(airport,allocation.role,family,count);
    }
  }
}

function crewStationRoleSummary(airport,role,t=simNow()){
  const recovered=crewRecoveryAvailableStaffAt(airport,role,'',t);
  const result={role,total:staffAt(airport,role)+recovered,available:availableStationStaffAt(airport,role)+recovered,
    committed:reservedOutboundPersonnelAt(airport,role),reporting:0,onDuty:0,resting:0,incoming:0,shortfall:0};
  for(const record of crewAssignments()){
    const amount=record.roles[role]||0;
    if(!amount) continue;
    if(record.status==='resting'&&record.returnAirport===airport) result.resting+=amount;
    else if(record.airport===airport&&['reporting','briefing'].includes(record.status)) result.reporting+=amount;
    else if(record.airport===airport&&crewAssignmentActive(record)&&!record.departedAt) result.committed+=amount;
  }
  result.resting+=(state.crewUnavailability||[]).filter(item=>(item.poolAirport||item.airport)===airport&&item.role===role&&item.until>t).reduce((sum,item)=>sum+item.amount,0);
  for(const flight of state.flights){
    if(flight.cancelled||flight.from!==airport||!flightUsesLocalCrew(flight)) continue;
    const duty=crewDutyForFlight(flight);
    if(duty.restUntil<=t||duty.reportAt>t+24*HOUR) continue;
    const count=crewRosterRoleCount(flight,role,{excludeUnavailable:true});
    if(!count) continue;
    const covered=Math.min(result.available,count);
    result.shortfall+=count-covered;
    if(duty.dutyEnd<=t) result.resting+=covered;
    else if(duty.reportAt<=t) result.onDuty+=covered;
    else result.committed+=covered;
    result.available-=covered;
  }
  for(const recovery of state.crewRecoveries||[]){
    if(recovery.availableAirport===airport&&recovery.status==='confirmed'&&!crewRecoveryRecordIsAvailable(recovery,t)) result.resting+=crewRecoveryRoleCount(recovery,role);
  }
  result.incoming=(state.personnelTransfers||[]).filter(item=>item.status!=='completed'&&item.status!=='cancelled'&&
    (item.actualTo||item.to)===airport&&item.role===role).reduce((sum,item)=>sum+Math.max(0,Number(item.amount)||0),0);
  return result;
}

function crewStationSummary(airport,t=simNow()){
  const result={available:0,committed:0,reporting:0,onDuty:0,resting:0,incoming:0,shortfall:0};
  for(const role of CREW_ROLES){
    const snapshot=crewStationRoleSummary(airport,role,t);
    for(const key of Object.keys(result)) result[key]+=snapshot[key]||0;
  }
  return result;
}

function crewPoolSnapshot(airport,t=simNow()){
  const roles=Object.fromEntries(CREW_ROLES.map(role=>[role,crewStationRoleSummary(airport,role,t)]));
  const summary={available:0,committed:0,reporting:0,onDuty:0,resting:0,incoming:0,shortfall:0};
  for(const role of CREW_ROLES){
    for(const key of Object.keys(summary)) summary[key]+=roles[role][key]||0;
  }
  const stationQualifications=state.personnel.qualifications?.[airport]||{};
  const families=[...new Set([
    ...Object.keys(stationQualifications.captains||{}),
    ...Object.keys(stationQualifications.firstOfficers||{}),
    ...state.flights.filter(flight=>!flight.cancelled&&flight.from===airport&&flightActualDeparture(flight)>=t)
      .map(flight=>crewRecoveryFlightFamily(flight))
  ])].filter(family=>family&&family!=='Multi-fleet').sort();
  const qualifications=families.map(family=>({family,
    captains:qualifiedStaffAt(airport,'captains',family),
    firstOfficers:qualifiedStaffAt(airport,'firstOfficers',family)
  })).filter(item=>item.captains||item.firstOfficers);
  return {airport,roles,qualifications,summary};
}

function crewAbsencesForProblem(problem){
  if(!problem) return [];
  const records=(state.crewUnavailability||[]).filter(item=>item.sourceId===problem.id);
  if(records.length) return records.map(item=>({id:item.id,role:item.role,count:item.amount,family:item.family,
    until:item.until,flightIds:[...(item.flightIds||[])]}));
  return (problem.affectedCrew||[]).map((item,index)=>({id:`${problem.id}:${index}`,role:item.role,count:item.count||item.amount||1,
    family:item.family||'',until:item.until||0,flightIds:[...(item.flightIds||problem.affectedFlightIds||[])]}));
}

function updateCrewAssignmentEffects(t=simNow()){
  recalculateOperations();
  updateStaffingConstraints(t);
  rebuildCrewDuties();
  processProblems(t);
  invalidateOperationalIndex();
}

function standDownCrew(flightId,roles,reason='fatigue'){
  const flight=state.flights.find(item=>item.id===flightId);
  const blocker=crewGroundActionBlocker(flight);
  if(blocker){ toast(blocker); return null; }
  const records=recordCrewUnavailability(flight,roles,{reason});
  if(!records.length){ toast('The selected crew is already unavailable.'); return null; }
  updateCrewAssignmentEffects(); AeroServices.commit();
  return records;
}
