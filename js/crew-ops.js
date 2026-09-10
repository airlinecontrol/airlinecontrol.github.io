/* Crew duty, staffing, crew swaps, and disrupted crew recovery. */

function rotationUsesThroughCrew(flight){
  const rotation=rotationForFlight(flight);
  if(!rotation.outbound||!rotation.returnFlight) return false;
  if(rotation.outbound.crewDutySplit||rotation.returnFlight.crewDutySplit) return false;
  return OperationalIntelligence.crewDutyAssessment({
    departure:flightActualDeparture(rotation.outbound),arrival:flightActualArrival(rotation.returnFlight),sectors:2,
    augmented:Boolean(rotation.outbound.crewAugmented)
  }).legal;
}

function inferredCrewDutyForFlight(flight){
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

function plannedCrewDutyAssessmentForFlight(flight,{augmented=false}={}){
  if(!flight||flight.flightType==='ferry') return null;
  const rotation=rotationForFlight(flight);
  if(rotationUsesThroughCrew(flight)&&rotation.outbound&&rotation.returnFlight){
    return {
      target:rotation.outbound,
      flights:[rotation.outbound,rotation.returnFlight],
      assessment:OperationalIntelligence.crewDutyAssessment({
        departure:rotation.outbound.departure,arrival:rotation.returnFlight.arrival,sectors:2,augmented
      })
    };
  }
  return {
    target:flight,
    flights:[flight],
    assessment:OperationalIntelligence.crewDutyAssessment({
      departure:flight.departure,arrival:flight.arrival,sectors:1,augmented
    })
  };
}

function ensurePlannedCrewAugmentation(){
  let changed=false;
  const processed=new Set();
  for(const flight of state.flights){
    if(flight.cancelled||flight.departureLogged||flight.flightType==='ferry'||processed.has(flight.id)) continue;
    const normal=plannedCrewDutyAssessmentForFlight(flight,{augmented:false});
    if(!normal?.target) continue;
    normal.flights.forEach(item=>processed.add(item.id));
    if(normal.target.crewAugmented) continue;
    const augmented=plannedCrewDutyAssessmentForFlight(flight,{augmented:true});
    if(!normal.assessment.legal&&augmented?.assessment?.legal){
      normal.target.crewAugmented=true;
      normal.target.crewAugmentationPlanned=true;
      normal.target.crewAugmentationReason='Planned augmented crew required by scheduled duty length.';
      changed=true;
    }
  }
  return changed;
}

function crewDutyForFlight(flight){
  const stored=flight?.crewDutyId&&state.crewDuties?.find(item=>item.id===flight.crewDutyId);
  if(stored) return stored;
  return inferredCrewDutyForFlight(flight);
}

function crewDiversionDisplacementFlight(f){
  if(f?.diversionAirport&&f.diversionAirport!==f.to) return f;
  if(!(f?.serviceId&&f.serviceLeg==='outbound')) return null;
  const returnFlight=state.flights
    .filter(other=>!other.cancelled&&other.serviceId===f.serviceId&&other.serviceLeg==='return'&&other.departure>f.departure)
    .sort((a,b)=>a.departure-b.departure)[0];
  if(returnFlight&&returnReusesOutboundCrew(returnFlight)&&returnFlight.diversionAirport&&returnFlight.diversionAirport!==returnFlight.to) return returnFlight;
  return null;
}

function crewAccommodationExposures(t=simNow()){
  return state.flights
    .filter(flight=>flight.flightType!=='ferry')
    .map(flight=>{
      const sortAt=flightCrewRelease(flight);
      if(sortAt<t-24*HOUR||sortAt>t+72*HOUR) return null;
      const releaseAirport=flightCrewReleaseAirport(flight);
      const plannedRelease=flightCrewPlannedRelease(flight);
      const plannedReleaseAirport=flightCrewPlannedReleaseAirport(flight);
      const releaseDelayMin=Math.max(0,Math.round((sortAt-plannedRelease)/MIN));
      const diversionFlight=crewDiversionDisplacementFlight(flight);
      const diverted=Boolean(diversionFlight);
      const releaseAirportChanged=releaseAirport&&plannedReleaseAirport&&releaseAirport!==plannedReleaseAirport;
      if(!diverted) return null;
      const crew=typeof crewComplementForFlight==='function'?crewComplementForFlight(flight):3;
      const reason=releaseAirportChanged
        ? `release airport changed from ${plannedReleaseAirport} to ${releaseAirport}`
        : `diversion release at ${releaseAirport}`;
      const exposure={
        flightId:flight.id,flight,releaseAirport,plannedReleaseAirport,crew,
        cost:typeof crewRecoveryCost==='function'?crewRecoveryCost(flight,{hotel:true,position:diverted||releaseAirportChanged}):crew*140,
        releaseDelayMin,diverted,releaseAirportChanged,diversionFlightId:diversionFlight?.id||flight.id,
        crewIncident:false,reason,sortAt
      };
      exposure.records=crewRecoveryRecordsForFlight(flight.id);
      exposure.actions=crewRecoveryActionsForExposure(exposure);
      const readyRecord=exposure.records.find(record=>crewRecoveryRecordIsAvailable(record,t));
      const activeRecord=exposure.records.find(record=>record.status!=='confirmed'||!crewRecoveryRecordIsAvailable(record,t));
      if(activeRecord) exposure.actions=exposure.actions.filter(action=>action.id===activeRecord.action);
      const legacyHandled=!exposure.records.length&&Boolean(flight.crewAccommodationArrangedAt);
      exposure.arranged=Boolean(readyRecord)||legacyHandled;
      exposure.activeRecord=activeRecord||null;
      return exposure;
    })
    .filter(Boolean)
    .sort((a,b)=>(a.arranged===b.arranged?0:a.arranged?1:-1)||b.cost-a.cost||a.sortAt-b.sortAt)
    .slice(0,20);
}

function crewRecoveryRecordsForFlight(flightId){
  return (state.crewRecoveries||[])
    .filter(item=>item.flightId===flightId)
    .sort((a,b)=>(a.completedAt||a.updatedAt||a.requestedAt)-(b.completedAt||b.updatedAt||b.requestedAt));
}

function crewRecoveryActionLabel(action){
  return {
    hotel:'Request crew hotel',
    transport:'Arrange crew transport',
    stand_down:'Stand down crew'
  }[action]||'Coordinate crew';
}

function crewRecoveryActionRequestLabel(action){
  return {
    hotel:'crew hotel request',
    transport:'crew transport arrangement',
    stand_down:'crew stand-down coordination'
  }[action]||'crew recovery coordination';
}

function crewRecoveryStatusLabel(status){ return passengerRecoveryStatusLabel(status); }

function crewRecoveryActionEstimate(exposure,action){
  const crew=Math.max(1,Number(exposure.crew)||3);
  if(action==='hotel') return Math.max(500,crew*160);
  if(action==='transport') return Math.max(350,crew*65);
  if(action==='stand_down') return Math.max(300,crew*45);
  return Math.max(0,Number(exposure.cost)||0);
}

function crewRecoveryActionsForExposure(exposure){
  const actions=[];
  const push=(id)=>{ if(!actions.some(item=>item.id===id)) actions.push({id,label:crewRecoveryActionLabel(id),amount:crewRecoveryActionEstimate(exposure,id)}); };
  if(!exposure.releaseAirportChanged&&!exposure.diverted) return actions;
  push('transport');
  push('hotel');
  return actions;
}

function crewRecoveryActionDuration(action){
  return {hotel:25*MIN,transport:18*MIN,stand_down:12*MIN}[action]||20*MIN;
}

function crewRecoveryFlightFamily(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
  return aircraft?Management.aircraftFamily(aircraft.model):'Multi-fleet';
}

function crewRecoveryRolesForFlight(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
  return crewRequirementForFlight(flight,aircraft);
}

function crewRecoveryAvailabilityPlan(exposure,action,requestedAt=simNow()){
  const flight=exposure?.flight;
  const confirmsAt=requestedAt+crewRecoveryActionDuration(action);
  const releaseAt=flight?flightCrewRelease(flight):confirmsAt;
  const duty=flight?crewDutyForFlight(flight):null;
  const plannedRestUntil=Math.max(releaseAt,Number(duty?.restUntil)||releaseAt+10*HOUR);
  if(action==='hotel'){
    const transferToHotel=25*MIN;
    const reportTime=45*MIN;
    return {
      confirmsAt,
      availableAt:Math.max(confirmsAt,plannedRestUntil)+transferToHotel+reportTime,
      availableAirport:exposure.releaseAirport,
      detail:'hotel, minimum rest, and report time'
    };
  }
  if(action==='transport'){
    return {
      confirmsAt,
      availableAt:confirmsAt,
      availableAirport:exposure.plannedReleaseAirport||exposure.releaseAirport,
      detail:'positioning transport confirmed'
    };
  }
  if(action==='stand_down'){
    return {
      confirmsAt,
      availableAt:Math.max(confirmsAt,plannedRestUntil),
      availableAirport:exposure.releaseAirport,
      detail:'stand-down rest complete'
    };
  }
  return {confirmsAt,availableAt:confirmsAt,availableAirport:exposure.releaseAirport,detail:'coordination complete'};
}

function crewRecoveryRecordIsAvailable(record,t=simNow()){
  if(!record||record.status!=='confirmed') return false;
  if(record.availabilityStatus==='available') return true;
  const availableAt=Number(record.availableAt)||Number(record.completedAt)||Number(record.updatedAt)||0;
  return availableAt<=t;
}

function crewRecoveryRoleCount(record,role,family=''){
  const roles=record?.roles||{};
  if(!roles[role]) return 0;
  if(['captains','firstOfficers'].includes(role)&&record.family&&family&&record.family!==family&&record.family!=='Multi-fleet') return 0;
  return Math.max(0,Math.floor(Number(roles[role])||0));
}

function crewRecoveryAvailableStaffAt(airport,role,family='',t=simNow(),excludeFlightId=''){
  return (state.crewRecoveries||[]).reduce((sum,record)=>{
    if(record.flightId===excludeFlightId) return sum;
    if(record.availableAirport!==airport||!crewRecoveryRecordIsAvailable(record,t)) return sum;
    return sum+crewRecoveryRoleCount(record,role,family);
  },0);
}

function availableStaffAt(airport,role,t=simNow(),excludeFlightId=''){
  const station=typeof availableStationStaffAt==='function'?availableStationStaffAt(airport,role):staffAt(airport,role);
  return station+crewRecoveryAvailableStaffAt(airport,role,'',t,excludeFlightId);
}

function availableQualifiedStaffAt(airport,role,family,t=simNow(),excludeFlightId=''){
  const station=typeof availableQualifiedStationStaffAt==='function'?availableQualifiedStationStaffAt(airport,role,family):qualifiedStaffAt(airport,role,family);
  return station+crewRecoveryAvailableStaffAt(airport,role,family,t,excludeFlightId);
}

function processCrewRecoveries(t=simNow()){
  let changed=false;
  for(const recovery of state.crewRecoveries||[]){
    if(recovery.status==='confirmed'){
      if(recovery.availabilityStatus!=='available'&&crewRecoveryRecordIsAvailable(recovery,t)){
        recovery.availabilityStatus='available';
        recovery.updatedAt=t;
        changed=true;
      }
      continue;
    }
    if(recovery.status==='requested'&&t>=recovery.requestedAt+8*MIN){
      recovery.status='in_progress';
      recovery.updatedAt=t;
      changed=true;
    }
    if(recovery.status==='in_progress'&&t>=recovery.confirmsAt){
      recovery.status='confirmed';
      recovery.completedAt=t;
      recovery.updatedAt=t;
      recovery.availabilityStatus=crewRecoveryRecordIsAvailable(recovery,t)?'available':'pending';
      const flight=state.flights.find(item=>item.id===recovery.flightId);
      if(flight){
        if(recovery.action==='hotel') flight.crewAccommodationArrangedAt=t;
        if(recovery.action==='transport') flight.crewTransportArrangedAt=t;
        if(recovery.action==='stand_down') flight.crewStoodDownAt=t;
      }
      changed=true;
    }
  }
  if(changed&&typeof requestUiRefresh==='function') requestUiRefresh('desk','left','context');
  return changed;
}

function authorizeCrewRecovery(flightId,action='hotel'){
  const exposure=crewAccommodationExposures().find(item=>item.flightId===flightId);
  if(!exposure) return toast('No disrupted crew rest or positioning exposure is currently projected for that flight.');
  const flight=exposure.flight;
  const available=crewRecoveryActionsForExposure(exposure).find(item=>item.id===action);
  if(!available) return toast(`${crewRecoveryActionLabel(action)} is not applicable to ${flight.id}.`);
  const existing=crewRecoveryRecordsForFlight(flightId).find(item=>item.action===action);
  if(existing) return toast(`${flight.id}: ${crewRecoveryActionRequestLabel(action)} already ${crewRecoveryStatusLabel(existing.status).toLowerCase()}.`);
  const now=simNow();
  const amount=available.amount;
  const availability=crewRecoveryAvailabilityPlan(exposure,action,now);
  const event=typeof recordRecoveryCostEvent==='function'?recordRecoveryCostEvent({
    flight,category:'crew',kind:`crew_${action}`,
    amount,crew:exposure.crew,airport:exposure.releaseAirport,
    description:`${flight.id}: ${crewRecoveryActionRequestLabel(action)} at ${exposure.releaseAirport}`
  }):null;
  state.crewRecoveries??=[];
  state.crewRecoveries.push({
    id:`CR${state.nextCrewRecovery++}`,
    flightId,
    action,
    status:'requested',
    requestedAt:now,
    updatedAt:now,
    confirmsAt:availability.confirmsAt,
    completedAt:0,
    availableAt:availability.availableAt,
    availableAirport:availability.availableAirport,
    availabilityStatus:'pending',
    availabilityDetail:availability.detail,
    amount,
    crew:exposure.crew,
    roles:crewRecoveryRolesForFlight(flight),
    family:crewRecoveryFlightFamily(flight),
    releaseAirport:exposure.releaseAirport,
    plannedReleaseAirport:exposure.plannedReleaseAirport,
    reason:exposure.reason,
    costEventId:event?.id||''
  });
  AeroServices.commit();
  requestUiRefresh('desk','left','context');
  toast(`${flight.id}: ${crewRecoveryActionRequestLabel(action)} requested${event?` (${money(event.amount)})`:''}.`);
  return event;
}

function arrangeCrewAccommodation(flightId){
  return authorizeCrewRecovery(flightId,'hotel');
}

function returnReusesOutboundCrew(f){
  if(!f.serviceId || f.serviceLeg!=='return') return false;
  const outbound=state.flights
    .filter(other=>!other.cancelled&&other.serviceId===f.serviceId && other.serviceLeg==='outbound' && other.departure<f.departure)
    .sort((a,b)=>b.departure-a.departure)[0];
  return Boolean(outbound&&rotationUsesThroughCrew(f));
}
function flightUsesLocalCrew(f){ return !returnReusesOutboundCrew(f); }
function plannedReturnForCrew(f){
  if(!(f.serviceId&&f.serviceLeg==='outbound')) return null;
  return state.flights
    .filter(other=>other.serviceId===f.serviceId&&other.serviceLeg==='return'&&other.departure>f.departure)
    .sort((a,b)=>a.departure-b.departure)[0]||null;
}
function flightCrewPlannedRelease(f){
  const returnFlight=plannedReturnForCrew(f);
  if(returnFlight&&returnReusesOutboundCrew(returnFlight)) return returnFlight.arrival;
  return f.arrival;
}
function flightCrewPlannedReleaseAirport(f){
  const returnFlight=plannedReturnForCrew(f);
  if(returnFlight&&returnReusesOutboundCrew(returnFlight)) return returnFlight.to;
  return f.to;
}
function flightCrewRelease(f){
  if(f.serviceId && f.serviceLeg==='outbound'){
    const returnFlight=state.flights
      .filter(other=>!other.cancelled&&other.serviceId===f.serviceId && other.serviceLeg==='return' && other.departure>f.departure)
      .sort((a,b)=>a.departure-b.departure)[0];
    if(returnFlight && returnReusesOutboundCrew(returnFlight)) return flightActualArrival(returnFlight);
  }
  return flightActualArrival(f);
}

function flightCrewContinuationDeparture(f,airport){
  if(f.serviceId && f.serviceLeg==='outbound'){
    const returnFlight=state.flights
      .filter(other=>!other.cancelled&&other.serviceId===f.serviceId&&other.serviceLeg==='return'&&other.departure>f.departure)
      .sort((a,b)=>a.departure-b.departure)[0];
    if(returnFlight&&returnReusesOutboundCrew(returnFlight)&&flightOperationalDestination(returnFlight)===airport){
      return flightActualDeparture(returnFlight);
    }
  }
  return flightActualDeparture(f);
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

function crewRequirementForFlight(flight,aircraft=null){
  const ac=aircraft||state.aircraft.find(item=>item.id===flight.aircraftId);
  const multiplier=flight.crewAugmented?2:1;
  return {
    captains:multiplier,
    firstOfficers:multiplier,
    cabinCrew:flight.flightType==='ferry'?0:Math.max(1,Math.ceil(cabinSeatCount(ac||flight)/50))*multiplier
  };
}

function crewDutyStatus(assessment,now=simNow()){
  if(!assessment.legal) return 'illegal';
  if(now>=assessment.dutyEnd) return 'released';
  if(now>=assessment.dutyStart) return 'active';
  return 'planned';
}

function buildCrewDutyRecord(id,flights){
  const ordered=flights.filter(Boolean).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  if(!ordered.length) return null;
  const first=ordered[0],last=ordered[ordered.length-1];
  const aircraft=state.aircraft.find(item=>item.id===first.aircraftId);
  const augmented=ordered.some(item=>item.crewAugmented);
  const assessment=OperationalIntelligence.crewDutyAssessment({
    departure:flightActualDeparture(first),arrival:flightActualArrival(last),sectors:ordered.length,augmented
  });
  const crew=ordered.reduce((max,flight)=>{
    const requirement=crewRequirementForFlight(flight,state.aircraft.find(item=>item.id===flight.aircraftId)||aircraft);
    for(const role of Object.keys(requirement)) max[role]=Math.max(max[role]||0,requirement[role]||0);
    return max;
  },{captains:0,firstOfficers:0,cabinCrew:0});
  const roleSwaps=ordered.flatMap(flight=>Object.values(flight.crewRoleSwaps||{}).map(swap=>({...swap,flightId:flight.id})));
  return {
    id,flightIds:ordered.map(item=>item.id),aircraftId:first.aircraftId,airport:first.from,
    releaseAirport:flightOperationalDestination(last),family:aircraft?Management.aircraftFamily(aircraft.model):'Multi-fleet',
    reportAt:assessment.dutyStart,dutyStart:assessment.dutyStart,dutyEnd:assessment.dutyEnd,
    releaseAt:assessment.dutyEnd,restUntil:assessment.dutyEnd+assessment.restHours*HOUR,
    sectors:ordered.length,augmented,legal:assessment.legal,dutyHours:assessment.dutyHours,
    maxHours:assessment.maxHours,remainingHours:assessment.remainingHours,night:assessment.night,
    crew,roleSwaps,status:crewDutyStatus(assessment),label:assessment.label
  };
}

function rebuildCrewDuties(){
  if(!Array.isArray(state.crewDuties)) state.crewDuties=[];
  const duties=[],processed=new Set();
  for(const flight of state.flights.slice().sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||a.id.localeCompare(b.id))){
    if(flight.cancelled){ flight.crewDutyId=''; continue; }
    if(processed.has(flight.id)) continue;
    const rotation=rotationForFlight(flight);
    if(flight.serviceLeg==='return'&&returnReusesOutboundCrew(flight)&&rotation.outbound&&!processed.has(rotation.outbound.id)){
      continue;
    }
    if(flight.serviceLeg==='outbound'&&rotation.returnFlight&&rotationUsesThroughCrew(flight)){
      const id=`CD-${flight.id}-${rotation.returnFlight.id}`;
      const duty=buildCrewDutyRecord(id,[flight,rotation.returnFlight]);
      if(duty){
        duties.push(duty);
        for(const item of [flight,rotation.returnFlight]){ item.crewDutyId=id; processed.add(item.id); }
        continue;
      }
    }
    const id=`CD-${flight.id}`;
    const duty=buildCrewDutyRecord(id,[flight]);
    if(duty){ duties.push(duty); flight.crewDutyId=id; }
    processed.add(flight.id);
  }
  state.crewDuties=duties;
  return duties;
}

function staffingRequirementSnapshot(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
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
    const releaseAirport=flightCrewReleaseAirport(f);
    if(f.cancelled || (f.from!==airport && releaseAirport!==airport) || f.id===candidateId) continue;
    if(candidateId && (f.departure>departure || (f.departure===departure && f.id>candidateId))) continue;
    const otherDep=flightActualDeparture(f);
    // Pooled flight crews remain committed through the rotation and then need
    // ten hours of rest. This avoids named-employee micromanagement while making
    // duty limits and reserve depth operationally meaningful.
    const crewRelease=flightCrewRelease(f);
    const crewAvailableAfter=crewRelease+10*HOUR;
    const continuationDeparture=flightCrewContinuationDeparture(f,airport);
    const canContinueSameDuty=crewRelease<=departure&&releaseAirport===airport&&
      OperationalIntelligence.crewDutyAssessment({departure:continuationDeparture,arrival,sectors:2,augmented:Boolean(f.crewAugmented)}).legal;
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
  return {airport,family,needed,qualifiedNeeded};
}

function personnelDeficitsForFlight(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
  const {family,needed,qualifiedNeeded}=staffingRequirementSnapshot(ac,departure,duration,airport,candidateId,localFlightCrew,flightType);
  const deficits=[];
  for(const [role,count] of Object.entries(needed)){
    const availableRole=availableStaffAt(airport,role,departure,candidateId);
    const missing=Math.max(0,count-availableRole);
    if(!['captains','firstOfficers'].includes(role)){
      if(missing) deficits.push({role,airport,amount:missing,qualification:'',required:count,available:availableRole});
      continue;
    }
    const availableRated=availableQualifiedStaffAt(airport,role,family,departure,candidateId);
    const ratingMissing=Math.max(0,(qualifiedNeeded[role]||0)-availableRated);
    const amount=Math.max(missing,ratingMissing);
    if(amount) deficits.push({role,airport,amount,qualification:family,required:Math.max(count,qualifiedNeeded[role]||0),available:Math.min(availableRole,availableRated)});
  }
  return deficits;
}

function staffingShortagesForFlight(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
  return personnelDeficitsForFlight(ac,departure,duration,airport,candidateId,localFlightCrew,flightType)
    .map(item=>`${PERSONNEL[item.role].label}${item.qualification?` rated ${item.qualification}`:''} at ${item.airport}: ${item.available}/${item.required}`);
}

function requestPersonnelDeficitsForFlight(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
  const requests=[];
  for(const deficit of personnelDeficitsForFlight(ac,departure,duration,airport,candidateId,localFlightCrew,flightType)){
    const result=requestPersonnelResource(deficit.role,deficit.airport,deficit.amount,deficit.qualification);
    if(result) requests.push({...deficit,result});
  }
  return requests;
}

function personnelRequestToastSuffix(requests){
  if(!requests.length) return '';
  const roles=[...new Set(requests.map(item=>PERSONNEL[item.role]?.label||item.role))];
  const airports=[...new Set(requests.map(item=>item.airport))];
  const roleCopy=roles.slice(0,3).join(', ')+(roles.length>3?', ...':'');
  const airportCopy=airports.slice(0,2).join(', ')+(airports.length>2?', ...':'');
  return ` Personnel provisioned: ${roleCopy} at ${airportCopy}.`;
}

function crewSwapBlocker(flight){
  if(!flight||flight.cancelled) return 'Select an active flight first.';
  if(flight.departureLogged) return 'Crew swap is only available before departure.';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return 'No aircraft is assigned to this flight.';
  const deficits=personnelDeficitsForFlight(
    aircraft,flightActualDeparture(flight),flight.arrival-flight.departure,flight.from,flight.id,true,flight.flightType
  ).filter(item=>['captains','firstOfficers','cabinCrew'].includes(item.role));
  const shortages=deficits.map(item=>`${PERSONNEL[item.role].label}${item.qualification?` rated ${item.qualification}`:''} at ${item.airport}: ${item.available}/${item.required}`);
  return shortages.length?`No local reserve crew is available: ${shortages.join(' · ')}`:'';
}

function swapCrewForFlight(flightId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const blocker=crewSwapBlocker(flight);
  if(blocker) return toast(blocker);
  const previousDuty=flight.crewDutyId||'';
  flight.crewDutySplit=true;
  flight.crewAugmented=false;
  flight.crewSwappedAt=simNow();
  if(typeof recordRecoveryCostEvent==='function'&&typeof crewRecoveryCost==='function'){
    recordRecoveryCostEvent({
      flight,category:'crew',kind:'manual_crew_swap',amount:crewRecoveryCost(flight,{replace:true}),
      crew:typeof crewComplementForFlight==='function'?crewComplementForFlight(flight):0,airport:flight.from,
      description:`${flight.id}: local reserve crew swap`
    });
  }
  flight.issueAcknowledgedAt=0; flight.issueAcknowledgedKey='';
  recalculateOperations();
  processDerivedOperationalIncidents(simNow());
  AeroServices.commit();
  const duty=crewDutyForFlight(flight);
  toast(`${flight.id}: local reserve crew assigned${previousDuty&&previousDuty!==duty.id?` from ${duty.airport}`:''}.`);
  return duty;
}
