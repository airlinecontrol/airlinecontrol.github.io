/* Aircraft maintenance work planning and booking actions. */
(function(global){
function maintenanceBookingLocation(ac,start){
  const projection=aircraftProjectedLocation(ac,start);
  const flight=projection.blockedBy;
  const inOperation=flight&&flightHasDeparted(flight,simNow())&&flightActualArrival(flight)>start;
  const blocker=inOperation?`${ac.tail} is still operating ${flight.id} at that time.`
    : ['position_conflict','stale_unflown'].includes(projection.status)?`${ac.tail} cannot reach the maintenance station until ${flight.id} is recovered.`:'';
  return {airport:projection.location,blocker};
}

function maintenanceBookingAssessment(ac,start,options={}){
  const location=maintenanceBookingLocation(ac,start);
  const plan=Management.maintenancePlan(ac,start,location.airport,MODELS[ac.model]?.seats||100,options);
  const support=maintenanceSupportAtAirport(plan.airport,ac,start);
  const conflict=maintenancePlanConflict(ac,plan);
  const airborneConflict=conflict&&flightHasDeparted(conflict,simNow());
  const blocker=location.blocker||(airborneConflict?`${ac.tail} is still operating ${conflict.id} during that maintenance window.`:'')
    ||(!support.available&&!options.allowUnsupportedMaintenance?`${ac.tail} has no maintenance support at ${plan.airport}.`:'')
    ||(conflict&&!options.allowFlightConflict?`${ac.tail} has ${conflict.id} during that maintenance window. Pick another time.`:'');
  return {plan,support,conflict,blocker};
}

function maintenanceAircraftAvailability(ac,job,t=simNow()){
  const legs=state.flights.filter(flight=>flight.aircraftId===ac.id&&!flight.cancelled&&flightHasDeparted(flight,t));
  const underway=legs.find(flight=>flightActualDeparture(flight)<=t&&flightActualArrival(flight)>t);
  if(underway) return {available:false,availableAt:flightActualArrival(underway),reason:`Awaiting ${underway.id} arrival at ${flightOperationalDestination(underway)}.`};
  const latest=legs.filter(flight=>flightActualArrival(flight)<=t).sort((a,b)=>flightActualArrival(b)-flightActualArrival(a))[0];
  const airport=latest?flightOperationalDestination(latest):ac.location;
  if(airport!==job.airport) return {available:false,reason:`Aircraft is at ${airport}; work is booked at ${job.airport}.`};
  const support=maintenanceSupportAtAirport(job.airport,ac,t);
  if(!support.available) return {available:false,reason:support.label||'Maintenance support unavailable.'};
  return {available:true,availableAt:latest?flightActualArrival(latest):job.status==='waiting'?t:job.start};
}

function processAircraftMaintenance(t=simNow()){
  return Management.processMaintenance(state,t,postTransaction,maintenanceAircraftAvailability);
}

function earliestMaintenancePlan(ac,options={}){
  const model=MODELS[ac.model];
  let start=simNow()+2*HOUR,airport=ac.location,guard=0;
  while(guard<100){
    const plan=Management.maintenancePlan(ac,start,airport,model.seats,options);
    const conflict=state.flights
      .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&flightActualArrival(f)>plan.start&&flightActualDeparture(f)<plan.end)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
    if(!conflict) return Management.maintenancePlan(ac,start,maintenanceBookingLocation(ac,start).airport,model.seats,options);
    start=flightActualArrival(conflict)+2*HOUR;
    airport=flightOperationalDestination(conflict);
    guard++;
  }
  return null;
}

function maintenancePlanConflict(ac,plan){
  if(!ac||!plan) return null;
  return state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&flightActualArrival(f)>plan.start&&flightActualDeparture(f)<plan.end)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0]||null;
}

function cancelMaintenanceAffectedFlights(ac,plan,{preserveProblemId='',reason=''}={}){
  if(!ac||!plan) return [];
  const affected=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&!f.departureLogged&&flightActualArrival(f)>plan.start&&flightActualDeparture(f)<plan.end)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||a.id.localeCompare(b.id));
  for(const flight of affected){
    applyFlightCancellation(flight,reason||plan.reason||plan.label||'Scheduled maintenance check',{preserveProblemId});
    flight.maintenanceBlocked=false;
    flight.maintenanceDelayMin=0;
  }
  return affected;
}

function defaultMaintenanceStart(acId,options={}){
  const ac=state.aircraft.find(item=>item.id===acId);
  return (ac&&earliestMaintenancePlan(ac,options)?.start)||simNow()+2*HOUR;
}

function scheduleMaintenanceCheckForAircraft(acId,start,{skipConfirm=false,reason='',allowFlightConflict=false,preserveProblemId='',allowUnsupportedMaintenance=false,workType='scheduled_check',finding=null,melItems=[]}={}){
  const ac=state.aircraft.find(item=>item.id===acId);
  if(!ac) return;
  const maintenance=Management.maintenanceStatus(ac,simNow());
  if(maintenance.scheduled) return toast(`${ac.tail} already has scheduled maintenance work.`);
  const requestedStart=Number.isFinite(start)?Math.max(simNow(),start):defaultMaintenanceStart(ac.id,{workType,finding,melItems});
  const {plan,blocker}=maintenanceBookingAssessment(ac,requestedStart,{workType,finding,melItems,allowFlightConflict,allowUnsupportedMaintenance});
  if(blocker){ toast(blocker); return null; }
  const affectedCount=allowFlightConflict
    ? state.flights.filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&!f.departureLogged&&flightActualArrival(f)>plan.start&&flightActualDeparture(f)<plan.end).length
    : 0;
  if(!skipConfirm&&!AeroServices.confirm(
    `Schedule ${ac.tail} for ${String(plan.label||'maintenance').toLowerCase()} at ${plan.airport}?\n\n`+
    `Start: ${formatTime(plan.start)}\nDuration: ${formatDuration(plan.end-plan.start)}`+
    (affectedCount?`\n\n${affectedCount} overlapping unflown flight${affectedCount===1?'':'s'} will be cancelled.`:'')
  )) return;
  Management.ensureState(state,simNow());
  plan.reason=reason||plan.label||'Scheduled maintenance check';
  plan.bookedAt=simNow();
  plan.inspectionFlights=plan.coverage.inspection
    ? state.flights.filter(flight=>flight.aircraftId===ac.id&&flight.arrivalInspectionRequired)
      .map(flight=>({id:flight.id,version:flight.arrivalInspectionVersion||0}))
    : [];
  ac.maintenance.scheduled=plan;
  const cancelledFlights=allowFlightConflict
    ? cancelMaintenanceAffectedFlights(ac,plan,{preserveProblemId,reason:plan.reason})
    : [];
  updateMaintenanceConstraints(simNow());
  recalculateOperations();
  AeroServices.commit();
  toast(`${ac.tail} maintenance booked at ${plan.airport}${cancelledFlights.length?`; ${cancelledFlights.length} affected flight${cancelledFlights.length===1?'':'s'} cancelled.`:'.'}`);
  return plan;
}

function scheduleAircraftMaintenance(acId,start,options={}){
  return scheduleMaintenanceCheckForAircraft(acId,start,options);
}

function cancelAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  const job=ac&&Management.maintenanceStatus(ac,simNow()).scheduled;
  if(!job||job.status==='active') return toast('Active maintenance cannot be cancelled.');
  ac.maintenance.scheduled=null;
  AeroServices.commit(); toast(`${ac.tail} maintenance booking removed.`);
}

  const api={
    maintenanceBookingLocation,maintenanceBookingAssessment,maintenanceAircraftAvailability,processAircraftMaintenance,
    earliestMaintenancePlan,maintenancePlanConflict,cancelMaintenanceAffectedFlights,
    defaultMaintenanceStart,scheduleMaintenanceCheckForAircraft,
    scheduleAircraftMaintenance,cancelAircraftMaintenance
  };
  global.AeroMaintenancePlanning=api;
  Object.assign(global,api);
})(window);
