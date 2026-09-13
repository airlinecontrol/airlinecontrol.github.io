/* Flight-deck/ATC holding coordination and active racetrack flight state. */
(function(global){
'use strict';

const MAX_PLANNED_HOLD_MIN=45;
const MIN_USEFUL_HOLD_MIN=5;
const HOLD_FUEL_BUFFER_RATIO=1.1;
const HOLD_BURN_FACTOR=.55;
const HOLD_RESPONSE_MIN=[3,7];
const HOLD_ENTRY_BLOCKERS=new Set([
  'fuel_margin_low','atc_holding_fuel_conflict','onboard_medical','inflight_technical_fault',
  'unruly_passenger','diversion_airport_unavailable','bird_strike','lightning_strike','pressurization_issue'
]);

function holdingRecord(flight){
  return flight?.holding&&typeof flight.holding==='object'?flight.holding:null;
}

function holdingIsActive(flight){
  return holdingRecord(flight)?.status==='active';
}

function holdingElapsedMinutes(flight){
  return Math.max(0,Number(flight?.holdingDelayMin)||0);
}

function holdingElapsedMsForFlight(flight){
  return holdingElapsedMinutes(flight)*MIN;
}

function holdingProblemCandidates(flight,t=simNow()){
  if(!flight||typeof openProblemsForFlight!=='function') return [];
  return openProblemsForFlight(flight.id)
    .map(problem=>{
      const definition=AeroProblemModel.definitionForType(problem.type);
      if(definition?.holdingPolicy!=='short_recovery') return null;
      const projection=AeroProblemModel.timeProjectionForProblem(problem,t);
      if(!projection) return null;
      const basis=definition.holdingBasis==='current'?'current':'arrival';
      const comparisonAt=basis==='current'?t:flightActualArrival(flight);
      const requiredMin=Math.max(0,Math.ceil((projection.endAt-comparisonAt)/MIN));
      return {problem,definition,projection,basis,requiredMin};
    })
    .filter(Boolean)
    .sort((a,b)=>b.requiredMin-a.requiredMin||a.projection.endAt-b.projection.endAt);
}

function holdingEntryBlocker(flight){
  const blocker=openProblemsForFlight(flight.id).find(problem=>HOLD_ENTRY_BLOCKERS.has(problem.type));
  return blocker?AeroProblemModel.titleForType(blocker.type):'';
}

function holdingFuelPlan(flight,requestedMin,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
  const fuel=flight&&typeof fuelMarginContextForFlight==='function'?fuelMarginContextForFlight(flight,t):null;
  const performance=aircraft&&typeof aircraftFuelPerformance==='function'?aircraftFuelPerformance(MODELS[aircraft.model]):null;
  if(!aircraft||!fuel||!performance) return {available:false,reason:'Aircraft fuel data is unavailable.'};
  const burnGalPerMin=Math.max(1,performance.burnGalPerHour/60*HOLD_BURN_FACTOR);
  const protectedFuelGal=Math.max(0,fuel.reserveGal*HOLD_FUEL_BUFFER_RATIO);
  const usableHoldFuelGal=Math.max(0,fuel.projectedLandingFuelGal-protectedFuelGal);
  const maxSafeHoldMin=Math.max(0,Math.floor(usableHoldFuelGal/burnGalPerMin));
  const holdBurnGal=Math.max(0,Math.round(requestedMin*burnGalPerMin));
  const projectedLandingFuelGal=Math.max(0,fuel.projectedLandingFuelGal-holdBurnGal);
  const projectedMarginPct=fuel.reserveGal?Math.round(projectedLandingFuelGal/fuel.reserveGal*100):0;
  return {
    available:maxSafeHoldMin>=MIN_USEFUL_HOLD_MIN,
    reason:maxSafeHoldMin<MIN_USEFUL_HOLD_MIN?'Insufficient fuel above protected diversion and final reserve.':'',
    burnGalPerMin,holdBurnGal,maxSafeHoldMin,projectedLandingFuelGal,projectedMarginPct,
    currentMarginPct:fuel.marginPct
  };
}

function holdingProposalForFlight(flight,t=simNow(),{ignoreRecord=false}={}){
  if(!flight) return null;
  const record=holdingRecord(flight);
  if(record&&!ignoreRecord&&['pending','active'].includes(record.status)) return {record};
  const candidates=holdingProblemCandidates(flight,t);
  const remainingFlightMin=Math.max(0,Math.ceil((flightActualArrival(flight)-t)/MIN));
  if(!candidates.length){
    const blocker=holdingEntryBlocker(flight);
    const unavailableReason=!flightIsAirborne(flight,t)
      ? `Only available airborne; current state is ${statusOfFlight(flight,t).replaceAll('_',' ')}.`
      : blocker
        ? `Holding is not appropriate while ${blocker.toLowerCase()} is active.`
        : 'No short-lived weather, airport, or ATC constraint currently makes an airborne hold useful.';
    return {
      available:false,
      unavailableReason,
      proposedMin:0,
      requestedMin:0,
      recoveryLabel:'Flight deck / ATC holding coordination',
      projectionEndAt:0,
      sourceProblemIds:[],
      affectedReason:'',
      remainingFlightMin,
      fuel:holdingFuelPlan(flight,MIN_USEFUL_HOLD_MIN,t),
      fuelDecisionAt:0
    };
  }
  const primary=candidates[0];
  const requestedMin=Math.max(...candidates.map(item=>item.requiredMin));
  const fuel=holdingFuelPlan(flight,requestedMin,t);
  const blocker=holdingEntryBlocker(flight);
  let unavailableReason='';
  if(!flightIsAirborne(flight,t)) unavailableReason=`Only available airborne; current state is ${statusOfFlight(flight,t).replaceAll('_',' ')}.`;
  else if(blocker) unavailableReason=`Holding is not appropriate while ${blocker.toLowerCase()} is active.`;
  else if(flight.dispatchRouteRequest?.status==='pending') unavailableReason='Another flight-deck/ATC route request is already pending.';
  else if(remainingFlightMin>150) unavailableReason='Holding coordination is tactical and becomes available nearer the affected arrival or constraint.';
  else if(requestedMin<MIN_USEFUL_HOLD_MIN) unavailableReason='The forecast clears before holding would materially change the arrival.';
  else if(requestedMin>MAX_PLANNED_HOLD_MIN) unavailableReason=`The expected wait of ${requestedMin} minutes is too long for a planned airborne hold.`;
  else if(!fuel.available) unavailableReason=fuel.reason;
  else if(requestedMin>fuel.maxSafeHoldMin) unavailableReason=`The expected wait exceeds the ${fuel.maxSafeHoldMin}-minute fuel-backed holding limit.`;
  const proposedMin=unavailableReason?Math.min(requestedMin,MAX_PLANNED_HOLD_MIN):requestedMin;
  return {
    available:!unavailableReason,
    unavailableReason,
    proposedMin,
    requestedMin,
    recoveryLabel:primary.projection.label,
    projectionEndAt:Math.max(...candidates.map(item=>item.projection.endAt)),
    sourceProblemIds:candidates.map(item=>item.problem.id),
    affectedReason:candidates.map(item=>AeroProblemModel.titleForType(item.problem.type)).join(' / '),
    remainingFlightMin,
    fuel,
    fuelDecisionAt:t+fuel.maxSafeHoldMin*MIN
  };
}

function holdingResponseMinutes(flight){
  const unit=typeof stableFraction==='function'?stableFraction(`${flight.id}:holding-response`):.5;
  return Math.round(HOLD_RESPONSE_MIN[0]+unit*(HOLD_RESPONSE_MIN[1]-HOLD_RESPONSE_MIN[0]));
}

function requestHoldingPlan(flightId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const proposal=holdingProposalForFlight(flight);
  if(!flight) return toast('Select a valid airborne flight first.');
  if(holdingRecord(flight)?.status==='pending') return toast(`${flight.id}: holding coordination is already awaiting a response.`);
  if(holdingIsActive(flight)) return toast(`${flight.id} is already holding.`);
  if(!proposal?.available) return toast(proposal?.unavailableReason||'No safe and useful holding plan is currently available.');
  const requestedAt=simNow();
  const responseMin=holdingResponseMinutes(flight);
  flight.holding={
    id:`HOLD-${flight.id}-${Math.round(requestedAt)}`,
    status:'pending',
    requestedAt,
    respondsAt:requestedAt+responseMin*MIN,
    responseMin,
    proposedMin:proposal.proposedMin,
    projectionEndAt:proposal.projectionEndAt,
    sourceProblemIds:proposal.sourceProblemIds,
    reason:proposal.affectedReason,
    recoveryLabel:proposal.recoveryLabel,
    fuelDecisionAt:proposal.fuelDecisionAt
  };
  AeroServices.persist();
  requestUiRefresh('desk','schedule','context','map');
  toast(`${flight.id}: holding plan sent to flight deck and ATC; response in about ${responseMin} minutes.`);
}

function holdingPatternSize(aircraft){
  const seats=Number(MODELS[aircraft?.model]?.seats)||100;
  if(seats>=250) return {legKm:8.5,radiusKm:3.3,cycleMin:4.8};
  if(seats>=100) return {legKm:7,radiusKm:2.8,cycleMin:4.2};
  return {legKm:5.5,radiusKm:2.3,cycleMin:3.7};
}

function holdingOffsetPoint(fix,heading,alongKm,lateralKm){
  const radians=heading*Math.PI/180;
  const northKm=Math.cos(radians)*alongKm-Math.sin(radians)*lateralKm;
  const eastKm=Math.sin(radians)*alongKm+Math.cos(radians)*lateralKm;
  const lat=fix.lat+northKm/110.57;
  const lon=fix.lon+eastKm/(111.32*Math.max(.15,Math.cos(fix.lat*Math.PI/180)));
  return {lat,lon};
}

function holdingPatternWaypoints(flight){
  const record=holdingRecord(flight);
  if(!record?.fix||!['active','released'].includes(record.status)) return [];
  const half=record.legKm/2,radius=record.radiusKm,points=[];
  const add=(along,lateral)=>points.push(holdingOffsetPoint(record.fix,record.heading||0,along,lateral));
  const steps=10;
  for(let index=0;index<=steps;index++) add(-half+record.legKm*index/steps,radius);
  for(let index=1;index<=steps;index++){
    const angle=Math.PI/2-Math.PI*index/steps;
    add(half+Math.cos(angle)*radius,Math.sin(angle)*radius);
  }
  for(let index=1;index<=steps;index++) add(half-record.legKm*index/steps,-radius);
  for(let index=1;index<=steps;index++){
    const angle=-Math.PI/2-Math.PI*index/steps;
    add(-half+Math.cos(angle)*radius,Math.sin(angle)*radius);
  }
  points.push(points[0]);
  return points;
}

function holdingPositionForFlight(flight,t=simNow()){
  const record=holdingRecord(flight);
  if(record?.status!=='active'||!record.fix) return null;
  const path=holdingPatternWaypoints(flight);
  if(path.length<2) return {...record.fix,heading:record.heading||0,holding:true};
  const elapsedMin=Math.max(0,(t-record.enteredAt)/MIN);
  const cycleMin=Math.max(1,Number(record.cycleMin)||4);
  const progress=(elapsedMin%cycleMin)/cycleMin;
  const position=progress*(path.length-1);
  const index=Math.min(path.length-2,Math.floor(position));
  const fraction=position-index;
  const from=path[index],to=path[index+1];
  const point={lat:from.lat+(to.lat-from.lat)*fraction,lon:from.lon+(to.lon-from.lon)*fraction};
  return {...point,heading:typeof bearing==='function'?bearing(from,to):record.heading||0,holding:true};
}

function holdingCircuits(flight,t=simNow()){
  const record=holdingRecord(flight);
  if(!record?.enteredAt) return 0;
  const end=record.status==='active'?t:Number(record.exitedAt)||t;
  return Math.max(0,(end-record.enteredAt)/(Math.max(1,Number(record.cycleMin)||4)*MIN));
}

function applyHoldingDelay(flight,t){
  const record=holdingRecord(flight);
  if(record?.status!=='active') return false;
  const end=Math.min(t,Number(record.expectedReleaseAt)||t);
  const elapsed=Math.max(0,end-record.enteredAt);
  const target=Math.ceil(elapsed/MIN);
  const previous=Math.max(0,Number(record.appliedDelayMin)||0);
  if(target<=previous) return false;
  const delta=target-previous;
  record.appliedDelayMin=target;
  flight.enrouteDelayMin=Math.max(0,Number(flight.enrouteDelayMin)||0)+delta;
  flight.holdingDelayMin=Math.max(0,Number(flight.holdingDelayMin)||0)+delta;
  flight.enrouteDelayCause=`ATC holding · ${record.reason||record.recoveryLabel||'operational constraint'}`;
  return true;
}

function releaseHolding(flight,t=simNow(),outcome='ATC released the flight from holding.'){
  const record=holdingRecord(flight);
  if(record?.status!=='active') return false;
  applyHoldingDelay(flight,t);
  record.status='released';
  record.exitedAt=t;
  record.totalDelayMin=Math.max(0,Number(record.appliedDelayMin)||0);
  record.outcome=outcome;
  record.circuits=Math.round(holdingCircuits(flight,t)*10)/10;
  if(record.exitRequest?.status==='pending') record.exitRequest={...record.exitRequest,status:'accepted',completedAt:t,outcome};
  return true;
}

function requestHoldingExit(flightId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const record=holdingRecord(flight);
  if(!flight||record?.status!=='active') return toast('The selected flight is not currently holding.');
  if(record.exitRequest?.status==='pending') return toast(`${flight.id}: holding-exit coordination is already pending.`);
  const requestedAt=simNow();
  const responseMin=3+Math.round((typeof stableFraction==='function'?stableFraction(`${record.id}:exit-response`):.5)*2);
  record.exitRequest={status:'pending',requestedAt,respondsAt:requestedAt+responseMin*MIN,responseMin};
  AeroServices.persist();
  requestUiRefresh('desk','context','map');
  toast(`${flight.id}: request to leave holding sent; response in about ${responseMin} minutes.`);
}

function acceptHoldingRequest(flight,record,t){
  const proposal=holdingProposalForFlight(flight,t,{ignoreRecord:true});
  if(!proposal?.available){
    flight.holding={...record,status:'unusable',completedAt:t,outcome:proposal?.unavailableReason||'The holding plan is no longer operationally useful.'};
    return true;
  }
  const roll=typeof stableFraction==='function'?stableFraction(`${record.id}:acceptance`):.5;
  if(roll<.14){
    flight.holding={...record,status:'declined',completedAt:t,outcome:'Flight deck or ATC could not accept the proposed hold.'};
    return true;
  }
  const partial=roll<.38;
  const acceptedMin=Math.max(MIN_USEFUL_HOLD_MIN,Math.round(proposal.proposedMin*(partial?.7:1)));
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const position=currentAircraftPosition(aircraft,t);
  const size=holdingPatternSize(aircraft);
  flight.holding={
    ...record,
    status:'active',
    completedAt:t,
    outcome:partial?'Flight deck and ATC accepted a shorter holding clearance.':'Flight deck and ATC accepted the holding plan.',
    acceptedMin,
    enteredAt:t,
    expectedReleaseAt:t+acceptedMin*MIN,
    fuelDecisionAt:t+proposal.fuel.maxSafeHoldMin*MIN,
    projectionEndAt:proposal.projectionEndAt,
    sourceProblemIds:proposal.sourceProblemIds,
    reason:proposal.affectedReason,
    recoveryLabel:proposal.recoveryLabel,
    destinationAtEntry:flightOperationalDestination(flight),
    fix:{lat:position.lat,lon:position.lon,label:`${flightOperationalDestination(flight)} arrival hold`},
    heading:position.heading||0,
    ...size,
    appliedDelayMin:0,
    exitRequest:null
  };
  return true;
}

function processHoldingOperations(t=simNow()){
  let changed=false;
  for(const flight of state.flights||[]){
    const record=holdingRecord(flight);
    if(!record) continue;
    if(record.status==='pending'&&t>=record.respondsAt){
      changed=acceptHoldingRequest(flight,record,t)||changed;
      continue;
    }
    if(record.status!=='active') continue;
    changed=applyHoldingDelay(flight,t)||changed;
    if(flight.cancelled||flight.settled||!flightIsInOperation(flight,t)){
      changed=releaseHolding(flight,t,'Holding ended because the flight is no longer airborne.')||changed;
      continue;
    }
    if(flightOperationalDestination(flight)!==record.destinationAtEntry){
      changed=releaseHolding(flight,t,'Holding ended when the flight deck accepted a revised destination plan.')||changed;
      continue;
    }
    const exit=record.exitRequest;
    if(exit?.status==='pending'&&t>=exit.respondsAt){
      const accepted=(typeof stableFraction==='function'?stableFraction(`${record.id}:exit-acceptance`):.5)>=.12;
      if(accepted){
        changed=releaseHolding(flight,t,'Flight deck and ATC accepted the request to leave holding.')||changed;
      }else{
        record.exitRequest={...exit,status:'denied',completedAt:t,outcome:'ATC could not release the flight from holding yet.'};
        changed=true;
      }
      continue;
    }
    if(t>=record.expectedReleaseAt){
      changed=releaseHolding(flight,t,'ATC released the flight at the expected-further-clearance time.')||changed;
    }
  }
  return changed;
}

function holdingContextForFlight(flight,t=simNow()){
  if(!flight) return null;
  const record=holdingRecord(flight);
  const proposal=holdingProposalForFlight(flight,t,{ignoreRecord:true});
  if(!record&&!proposal) return null;
  const active=record?.status==='active';
  const remainingMin=active?Math.max(0,Math.ceil((record.expectedReleaseAt-t)/MIN)):0;
  const fuelDecisionMin=active?Math.max(0,Math.ceil((record.fuelDecisionAt-t)/MIN)):proposal?.fuel?.maxSafeHoldMin||0;
  return {
    record,
    proposal,
    active,
    pending:record?.status==='pending',
    completed:Boolean(record&&!['pending','active'].includes(record.status)),
    remainingMin,
    fuelDecisionMin,
    circuits:active?holdingCircuits(flight,t):Number(record?.circuits)||0,
    progress:active?Math.max(0,Math.min(1,(t-record.enteredAt)/Math.max(MIN,record.expectedReleaseAt-record.enteredAt))):0
  };
}

const api={
  holdingRecord,holdingIsActive,holdingElapsedMinutes,holdingElapsedMsForFlight,
  holdingProblemCandidates,holdingFuelPlan,holdingProposalForFlight,holdingContextForFlight,
  holdingPatternWaypoints,holdingPositionForFlight,holdingCircuits,
  requestHoldingPlan,requestHoldingExit,releaseHolding,processHoldingOperations
};
global.AeroHolding=api;
Object.assign(global,api);
})(window);
