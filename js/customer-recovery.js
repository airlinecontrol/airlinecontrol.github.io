/* Passenger disruption exposure, customer recovery actions, and response timers. */

function passengerRecoveryExposures(t=simNow()){
  return state.flights
    .filter(flight=>flight.flightType!=='ferry'&&(flight.pax||0)>0)
    .map(flight=>{
      const sortAt=flight.cancelled?(flight.cancelledAt||flight.departure):flightActualDeparture(flight);
      if(sortAt<t-24*HOUR||sortAt>t+72*HOUR) return null;
      const delayMin=flightTotalDepartureDelayMin(flight);
      const overnight=typeof passengerOvernightExposure==='function'?passengerOvernightExposure(flight,delayMin):{pax:0,cost:0,reason:''};
      const diverted=Boolean(flight.diversionAirport&&flight.diversionAirport!==flight.to);
      const critical=Number(flight.connectionCriticalPax)||0;
      const atRisk=Number(flight.connectionAtRiskPax)||0;
      if(!diverted) return null;
      const connectionCost=(critical+atRisk)>0?Math.max(800,(critical+atRisk)*85):0;
      const cost=Math.max(overnight.cost,connectionCost,typeof passengerDelayCost==='function'?passengerDelayCost(flight,delayMin):0);
      const reason=`diverted to ${flight.diversionAirport}`;
      const exposure={
        flightId:flight.id,flight,reason,cost,delayMin,
        pax:flight.pax||0,overnightPax:overnight.pax||0,
        criticalConnections:critical,atRiskConnections:atRisk,
        sortAt
      };
      exposure.records=passengerRecoveryRecordsForFlight(flight.id);
      exposure.actions=passengerRecoveryActionsForExposure(exposure);
      const confirmedRecord=exposure.records.find(record=>record.status==='confirmed');
      const activeRecord=exposure.records.find(record=>record.status!=='confirmed');
      if(activeRecord) exposure.actions=exposure.actions.filter(action=>action.id===activeRecord.action);
      exposure.arranged=Boolean(confirmedRecord);
      exposure.activeRecord=activeRecord||null;
      return exposure;
    })
    .filter(Boolean)
    .sort((a,b)=>(a.arranged===b.arranged?0:a.arranged?1:-1)||b.cost-a.cost||a.sortAt-b.sortAt)
    .slice(0,20);
}

function passengerRecoveryRecordsForFlight(flightId){
  return (state.passengerRecoveries||[])
    .filter(item=>item.flightId===flightId)
    .sort((a,b)=>(a.completedAt||a.updatedAt||a.requestedAt)-(b.completedAt||b.updatedAt||b.requestedAt));
}

function passengerRecoveryActionLabel(action){
  return {
    rebooking:'Authorize reaccommodation',
    release:'Release passengers',
    hotel:'Authorize hotel',
    transport:'Authorize transport',
    station_support:'Request station support'
  }[action]||'Coordinate recovery';
}

function passengerRecoveryActionRequestLabel(action){
  return {
    rebooking:'reaccommodation authorization',
    release:'passenger release authorization',
    hotel:'hotel authorization',
    transport:'transport authorization',
    station_support:'station support request'
  }[action]||'customer recovery coordination';
}

function passengerRecoveryStatusLabel(status){
  return {requested:'Requested',in_progress:'In progress',confirmed:'Confirmed'}[status]||'Requested';
}

function passengerRecoveryActionEstimate(exposure,action){
  const pax=Math.max(1,Number(exposure.pax)||0);
  const connectionPax=(Number(exposure.criticalConnections)||0)+(Number(exposure.atRiskConnections)||0);
  if(action==='rebooking') return Math.max(800,(connectionPax||pax)*85);
  if(action==='release') return Math.max(450,pax*14);
  if(action==='hotel') return Math.max(1200,Math.max(Number(exposure.overnightPax)||0,pax)*115);
  if(action==='transport') return Math.max(600,pax*35);
  if(action==='station_support') return Math.max(500,pax*8);
  return Math.max(0,Number(exposure.cost)||0);
}

function passengerRecoveryActionPax(exposure,action){
  if(action==='rebooking') return Math.max(1,(Number(exposure.criticalConnections)||0)+(Number(exposure.atRiskConnections)||0));
  if(action==='hotel') return Math.max(Number(exposure.overnightPax)||0,Number(exposure.pax)||0);
  return Math.max(1,Number(exposure.pax)||0);
}

function passengerReleaseApplicable(exposure){
  const flight=exposure.flight;
  if(!flight||flight.flightType==='ferry') return false;
  return Boolean(flight.diversionAirport&&flight.diversionAirport!==flight.to);
}

function passengerRecoveryActionsForExposure(exposure){
  const actions=[];
  const push=(id)=>{ if(!actions.some(item=>item.id===id)) actions.push({id,label:passengerRecoveryActionLabel(id),amount:passengerRecoveryActionEstimate(exposure,id)}); };
  const diverted=Boolean(exposure.flight?.diversionAirport&&exposure.flight.diversionAirport!==exposure.flight.to);
  if(!diverted) return actions;
  if(passengerReleaseApplicable(exposure)) push('release');
  if((exposure.criticalConnections||0)+(exposure.atRiskConnections||0)>0) push('rebooking');
  if((exposure.overnightPax||0)>0) push('hotel');
  push('transport');
  push('station_support');
  return actions;
}

function passengerRecoveryActionDuration(action){
  return {rebooking:35*MIN,release:12*MIN,hotel:25*MIN,transport:20*MIN,station_support:15*MIN}[action]||20*MIN;
}

function processPassengerRecoveries(t=simNow()){
  let changed=false;
  for(const recovery of state.passengerRecoveries||[]){
    if(recovery.status==='confirmed') continue;
    if(recovery.status==='requested'&&t>=recovery.requestedAt+10*MIN){
      recovery.status='in_progress';
      recovery.updatedAt=t;
      changed=true;
    }
    if(recovery.status==='in_progress'&&t>=recovery.confirmsAt){
      recovery.status='confirmed';
      recovery.completedAt=t;
      recovery.updatedAt=t;
      const flight=state.flights.find(item=>item.id===recovery.flightId);
      if(flight){
        if(recovery.action==='release') flight.passengerReleasedAt=t;
        if(recovery.action==='hotel'||recovery.action==='transport') flight.passengerAccommodationArrangedAt=t;
        else if(recovery.action!=='release') flight.passengerRecoveryArrangedAt=t;
      }
      changed=true;
    }
  }
  if(changed&&typeof requestUiRefresh==='function') requestUiRefresh('desk','left','context');
  return changed;
}

function authorizePassengerRecovery(flightId,action='hotel'){
  const exposure=passengerRecoveryExposures().find(item=>item.flightId===flightId);
  if(!exposure) return toast('No passenger disruption exposure is currently projected for that flight.');
  const flight=exposure.flight;
  const available=passengerRecoveryActionsForExposure(exposure).find(item=>item.id===action);
  if(!available) return toast(`${passengerRecoveryActionLabel(action)} is not applicable to ${flight.id}.`);
  const existing=passengerRecoveryRecordsForFlight(flightId).find(item=>item.action===action);
  if(existing) return toast(`${flight.id}: ${passengerRecoveryActionRequestLabel(action)} already ${passengerRecoveryStatusLabel(existing.status).toLowerCase()}.`);
  const now=simNow();
  const amount=available.amount;
  const event=typeof recordRecoveryCostEvent==='function'?recordRecoveryCostEvent({
    flight,category:'passenger',kind:`passenger_${action}`,
    amount,passengers:passengerRecoveryActionPax(exposure,action),
    airport:flightOperationalDestination(flight),
    description:`${flight.id}: ${passengerRecoveryActionRequestLabel(action)}`
  }):null;
  state.passengerRecoveries??=[];
  state.passengerRecoveries.push({
    id:`PR${state.nextPassengerRecovery++}`,
    flightId,
    action,
    status:'requested',
    requestedAt:now,
    updatedAt:now,
    confirmsAt:now+passengerRecoveryActionDuration(action),
    completedAt:0,
    amount,
    passengers:passengerRecoveryActionPax(exposure,action),
    reason:exposure.reason,
    costEventId:event?.id||''
  });
  AeroServices.commit();
  requestUiRefresh('desk','left','context');
  toast(`${flight.id}: ${passengerRecoveryActionRequestLabel(action)} requested${event?` (${money(event.amount)})`:''}.`);
  return event;
}

function arrangePassengerRecovery(flightId,mode='accommodation'){
  return authorizePassengerRecovery(flightId,mode==='connections'?'rebooking':'hotel');
}
