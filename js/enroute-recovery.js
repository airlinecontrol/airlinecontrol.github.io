/* Dispatch en-route recovery option model and response processing. */
(function(global){
function enrouteRecoveryContextForFlight(flight,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
  const status=flight?statusOfFlight(flight,t):'';
  const airborne=Boolean(flight&&flightIsAirborne(flight,t));
  const remainingMin=flight?Math.max(0,Math.round((flightActualArrival(flight)-t)/MIN)):0;
  const arrDelay=flight?flightArrivalDelayMinutes(flight):0;
  const existingRecovery=Math.max(0,Number(flight?.enrouteRecoveryMin)||0);
  const request=flight?.enrouteRecoveryRequest||null;
  const pending=request?.status==='pending'?request:null;
  const completed=request&&request.status!=='pending'?request:null;
  const routeWeather=flight&&(window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,t)
    ||window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,flightOperationalDestination(flight),t));
  const fuel=flight?fuelMarginContextForFlight(flight,t):null;
  const performance=aircraft?aircraftFuelPerformance(MODELS[aircraft.model]):null;
  const price=Number(state.fuelMarket?.pricePerGallon)||FUEL_MARKET_BASE_EUR_GAL;
  const baseRecoverable=Math.max(0,Math.min(arrDelay-1,Math.floor(remainingMin*.16),35));
  const weatherFactor=routeWeather?.level==='severe'?.55:routeWeather?.level==='caution'?.75:1;
  const directRecover=Math.min(baseRecoverable,Math.max(0,Math.round((5+remainingMin*.065)*weatherFactor)));
  const speedRecover=Math.min(baseRecoverable,Math.max(0,Math.round(4+remainingMin*.045)));
  const priorityRecover=Math.min(baseRecoverable,Math.max(directRecover,speedRecover)+Math.round(Math.min(directRecover,speedRecover)*.55));
  const optionFuel=(recoverMin,mode)=>{
    if(!performance) return 0;
    const factor=mode==='priority'?.5:mode==='speed'?.42:0;
    return Math.max(0,Math.round(recoverMin*performance.burnGalPerHour/60*factor));
  };
  const buildOption=(id,label,detail,recoverMin,baseCost,mode,waitExternal=false)=>{
    const extraFuelGal=optionFuel(recoverMin,mode);
    const fuelCost=Math.round(extraFuelGal*price);
    const projectedFuel=Math.max(0,(fuel?.projectedLandingFuelGal||0)-extraFuelGal);
    const marginPct=fuel?.reserveGal?Math.round(projectedFuel/fuel.reserveGal*100):100;
    const disabledReason=recoverMin<3
      ? 'Not enough recoverable delay remains.'
      : extraFuelGal&&marginPct<105
        ? `Fuel margin would fall to ${marginPct}% of reserve.`
        : '';
    return {
      id,label,detail,
      recoverMin:Math.max(0,recoverMin),
      cost:Math.max(0,Math.round(baseCost+fuelCost)),
      extraFuelGal,
      fuelMarginPct:marginPct,
      waitExternal,
      disabled:Boolean(disabledReason),
      disabledReason
    };
  };
  const options=[
    buildOption('direct','Ask direct routing','Ask the flight deck to request shortcut or more efficient airway clearance from ATC.',directRecover,650,'direct',true),
    buildOption('speed','Recommend speed-up','Recommend a higher cruise cost index; flight deck confirms if fuel and conditions allow.',speedRecover,250,'speed',true),
    buildOption('priority','Coordinate priority recovery','Coordinate a combined speed and routing recovery with flight deck and ATC.',priorityRecover,950,'priority',true)
  ];
  const unavailableReason=!flight?'Select a flight.'
    : !aircraft?'No aircraft assigned.'
    : !airborne?`Only available airborne; current state is ${status.replaceAll('_',' ')}.`
    : arrDelay<10?'Arrival delay below 10 minutes.'
    : remainingMin<20?'Too little flight time remains.'
    : '';
  return {
    available:!unavailableReason&&!pending&&!completed&&options.some(option=>!option.disabled),
    unavailableReason,
    pending,
    completed,
    status,airborne,remainingMin,arrDelay,existingRecovery,
    fuelMarginPct:fuel?.marginPct??100,
    routeWeather,
    options
  };
}

function applyEnrouteRecovery(flight,option,{outcome='',costFactor=1,recoverFactor=1,t=simNow()}={}){
  if(!flight||!option) return false;
  const recoverMin=Math.max(0,Math.min(Math.round(option.recoverMin*recoverFactor),Math.max(0,flightArrivalDelayMinutes(flight)-1),Math.max(0,Math.floor((flightActualArrival(flight)-t)/MIN*.16))));
  if(recoverMin<1) return false;
  const extraFuelGal=Math.max(0,Math.round((Number(option.extraFuelGal)||0)*recoverMin/Math.max(1,Number(option.recoverMin)||recoverMin)));
  const cost=Math.max(0,Math.round((Number(option.cost)||0)*costFactor));
  flight.enrouteRecoveryMin=(Number(flight.enrouteRecoveryMin)||0)+recoverMin;
  flight.enrouteRecoveryCost=(Number(flight.enrouteRecoveryCost)||0)+cost;
  flight.enrouteRecoveryFuelPenaltyGal=(Number(flight.enrouteRecoveryFuelPenaltyGal)||0)+extraFuelGal;
  flight.enrouteRecoveryPlan=option.label||option.id||'En-route recovery';
  flight.enrouteRecoveryCause=`${flight.enrouteRecoveryPlan}: ${outcome||`recovered ${recoverMin} min`}`;
  if(cost&&typeof recordRecoveryCostEvent==='function'){
    recordRecoveryCostEvent({
      flight,category:'dispatch',kind:'enroute_recovery',amount:cost,
      passengers:flight.pax||0,airport:flightOperationalDestination(flight),
      description:`${flight.id}: ${flight.enrouteRecoveryPlan} recovered ${recoverMin} min`
    });
  }
  return true;
}

function requestEnrouteRecovery(flightId,optionId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const context=enrouteRecoveryContextForFlight(flight);
  if(!flight) return toast('Select a valid flight first.');
  if(context.pending) return toast(`${flight.id}: en-route recovery request is already pending.`);
  const option=context.options.find(item=>item.id===optionId);
  if(context.unavailableReason) return toast(context.unavailableReason);
  if(!option||option.disabled) return toast(option?.disabledReason||'This en-route recovery option is not available.');
  const waitBase=option.id==='speed'?3:5;
  const waitSpread=option.id==='speed'?4:7;
  const waitMin=waitBase+Math.round(stableFraction(`${flight.id}:${option.id}:${simNow()}`)*waitSpread);
  flight.enrouteRecoveryRequest={
    id:`ERR-${flight.id}-${Math.round(simNow())}`,
    option:option.id,label:option.label,
    recoverMin:option.recoverMin,cost:option.cost,extraFuelGal:option.extraFuelGal,
    requestedAt:simNow(),respondsAt:simNow()+waitMin*MIN,status:'pending'
  };
  AeroServices.persist();
  requestUiRefresh('desk','schedule','context');
  return toast(`${flight.id}: ${option.label.toLowerCase()} sent; response in about ${waitMin} min.`);
}

function processEnrouteRecoveryRequests(t=simNow()){
  let changed=false;
  for(const flight of state.flights||[]){
    const request=flight.enrouteRecoveryRequest;
    if(!request||request.status!=='pending'||t<request.respondsAt) continue;
    const roll=stableFraction(`${request.id}:response`);
    const denied=roll<(request.option==='priority'?.1:.18);
    const partial=!denied&&roll<(request.option==='priority'?.42:.58);
    const option={id:request.option,label:request.label,recoverMin:request.recoverMin,cost:request.cost,extraFuelGal:request.extraFuelGal};
    if(denied){
      const deniedOutcome=request.option==='speed'
        ? 'Flight deck could not support the speed-up recommendation.'
        : 'ATC/flight deck could not support the recovery request.';
      flight.enrouteRecoveryRequest={...request,status:'denied',completedAt:t,outcome:deniedOutcome};
      if(request.cost&&typeof recordRecoveryCostEvent==='function') recordRecoveryCostEvent({
        flight,category:'dispatch',kind:'enroute_recovery_request',amount:Math.round(request.cost*.25),
        passengers:flight.pax||0,airport:flightOperationalDestination(flight),
        description:`${flight.id}: ${request.label} coordination unsuccessful`
      });
      changed=true;
      continue;
    }
    const factor=partial?.55:1;
    const approval=request.option==='speed'
      ? (partial?'partial flight deck acceptance':'flight deck acceptance')
      : (partial?'partial ATC/flight deck approval':'ATC/flight deck approval');
    const beforeRecovery=Number(flight.enrouteRecoveryMin)||0;
    const beforeCost=Number(flight.enrouteRecoveryCost)||0;
    const applied=applyEnrouteRecovery(flight,option,{recoverFactor:factor,costFactor:partial?.75:1,t,outcome:approval});
    if(applied) window.AeroRoutePlanning?.noteRecoveryRouteRevision?.(flight,option,{accepted:true,t});
    const recoveredMin=Math.max(0,(Number(flight.enrouteRecoveryMin)||0)-beforeRecovery);
    const appliedCost=Math.max(0,(Number(flight.enrouteRecoveryCost)||0)-beforeCost);
    flight.enrouteRecoveryRequest={
      ...request,
      status:applied?'confirmed':'unusable',
      completedAt:t,
      outcome:applied?`${approval}; recovered ${recoveredMin} min.`:'No recoverable delay remained.',
      recoveredMin,
      appliedCost
    };
    changed=true;
  }
  return changed;
}

  const api={
    enrouteRecoveryContextForFlight,applyEnrouteRecovery,
    requestEnrouteRecovery,processEnrouteRecoveryRequests
  };
  global.AeroEnrouteRecovery=api;
  Object.assign(global,api);
})(window);
