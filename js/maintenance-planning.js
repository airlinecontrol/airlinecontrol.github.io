/* Aircraft maintenance work planning and booking actions. */
(function(global){
function earliestMaintenancePlan(ac,options={}){
  const model=MODELS[ac.model];
  let start=simNow()+2*HOUR,airport=ac.location,guard=0;
  while(guard<100){
    const plan=Management.maintenancePlan(ac,start,airport,model.seats,options);
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
  const support=maintenanceSupportAtAirport(ac.location,ac,requestedStart);
  if(!support.available&&!allowUnsupportedMaintenance){
    toast(`${ac.tail} has no maintenance support at ${ac.location}. Move the aircraft to a supported station before scheduling the work.`);
    return null;
  }
  const plan=Management.maintenancePlan(ac,requestedStart,ac.location,MODELS[ac.model]?.seats||100,{workType,finding,melItems});
  if(!plan) return toast(`No maintenance window found for ${ac.tail} in the current programme.`);
  const conflict=maintenancePlanConflict(ac,plan);
  if(conflict&&!allowFlightConflict) return toast(`${ac.tail} has ${conflict.id} during that maintenance window. Pick another time.`);
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
    earliestMaintenancePlan,maintenancePlanConflict,cancelMaintenanceAffectedFlights,
    defaultMaintenanceStart,scheduleMaintenanceCheckForAircraft,
    scheduleAircraftMaintenance,cancelAircraftMaintenance
  };
  global.AeroMaintenancePlanning=api;
  Object.assign(global,api);
})(window);
