/* Shared disruption recovery costing. */
(function(global){
  'use strict';

  function roundedCost(value){
    return Math.round(Math.max(0,Number(value)||0)/100)*100;
  }

  function aircraftSizeFactor(flight){
    const aircraft=global.state?.aircraft?.find(item=>item.id===flight?.aircraftId);
    const seats=aircraft&&typeof global.cabinSeatCount==='function'
      ? global.cabinSeatCount(aircraft)
      : Math.max(80,Number(flight?.pax)||100);
    return seats>=240?1.9:seats>=160?1.35:seats>=100?1:.72;
  }

  function passengerOvernightExposure(flight,extraDelayMin=0){
    if(!flight||flight.flightType==='ferry'||!(Number(flight.pax)>0)) return {pax:0,cost:0,reason:'',overnight:false};
    const currentDelay=typeof global.flightTotalDepartureDelayMin==='function'
      ? global.flightTotalDepartureDelayMin(flight)
      : Math.max(0,Math.round(((flight.actualDeparture??flight.departure)-flight.departure)/(global.MIN||60_000)));
    const delayMin=Math.max(currentDelay,Number(extraDelayMin)||0);
    const baseArrival=typeof global.flightActualArrival==='function'
      ? global.flightActualArrival(flight)
      : (flight.actualArrival??flight.arrival);
    const actualArrival=baseArrival+Math.max(0,(Number(extraDelayMin)||0)-currentDelay)*(global.MIN||60_000);
    const destination=typeof global.flightOperationalDestination==='function'
      ? global.flightOperationalDestination(flight)
      : (flight.diversionAirport||flight.to);
    const rule=global.AIRPORT_NIGHT_RULES?.[destination];
    const local=rule&&typeof global.localTimeParts==='function'
      ? global.localTimeParts(rule.timeZone,actualArrival)
      : {hour:new Date(actualArrival).getHours()};
    const localHour=Number(local.hour)||0;
    const nightStatus=typeof global.airportNightStatus==='function'
      ? global.airportNightStatus(destination,actualArrival)
      : {status:'open'};
    const inHardRestriction=nightStatus.status==='closed';
    const lateArrival=delayMin>=120&&(localHour>=23||localHour<5);
    if(!lateArrival&&!inHardRestriction) return {pax:0,cost:0,reason:'',overnight:false};
    const diverted=Boolean(flight.diversionAirport&&flight.diversionAirport!==flight.to);
    const pax=Math.ceil((Number(flight.pax)||0)*(diverted?.45:.22));
    const unit=diverted?145:125;
    return {pax,cost:roundedCost(pax*unit),reason:diverted?'diversion overnight':'late-night arrival',overnight:true};
  }

  function passengerDelayCost(flight,delayMin){
    const pax=Math.max(0,Number(flight?.pax)||0);
    const minutes=Math.max(0,Number(delayMin)||0);
    const soft=pax*minutes*.38;
    const voucher=minutes>=120?pax*18:minutes>=60?pax*7:0;
    return roundedCost(soft+voucher+passengerOvernightExposure(flight,minutes).cost);
  }

  function crewComplementForFlight(flight){
    const aircraft=global.state?.aircraft?.find(item=>item.id===flight?.aircraftId);
    const cabin=aircraft&&flight?.flightType!=='ferry'&&typeof global.cabinSeatCount==='function'
      ? Math.max(1,Math.ceil(global.cabinSeatCount(aircraft)/50))
      : 0;
    return 2+cabin;
  }

  function crewRecoveryCost(flight,{hotel=false,position=false,replace=false,augment=false}={}){
    const crew=crewComplementForFlight(flight);
    return roundedCost((hotel?crew*135:0)+(position?crew*260:0)+(replace?crew*180:0)+(augment?crew*310:0));
  }

  function crewAssignmentCost(roles){
    return roundedCost(Object.entries(roles).reduce((sum,[role,count])=>sum+count*(role==='cabinCrew'?130:450),0));
  }

  function cancellationRecoveryCost(flight){
    if(!flight) return 0;
    const pax=Math.max(0,Number(flight.pax)||0);
    const revenue=Math.max(0,Number(flight.revenue)||0);
    const awayFromBase=Boolean(global.state?.home&&flight.from!==global.state.home);
    return roundedCost(revenue*.55+pax*95+crewRecoveryCost(flight,{hotel:awayFromBase}));
  }

  function recordRecoveryCostEvent({flight=null,problem=null,category='recovery',amount=0,description='',kind='recovery',passengers=0,crew=0,airport=''}={}){
    const value=roundedCost(amount);
    if(!value||!global.state) return null;
    const state=global.state;
    state.recoveryCostEvents??=[];
    state.stats??={};
    if(!Number.isFinite(state.nextRecoveryCostEvent)) state.nextRecoveryCostEvent=state.recoveryCostEvents.length+1;
    const event={
      id:`RC${state.nextRecoveryCostEvent++}`,
      flightId:flight?.id||problem?.flightId||'',
      problemId:problem?.id||'',
      category,
      kind,
      amount:value,
      passengers:Math.max(0,Math.round(Number(passengers)||0)),
      crew:Math.max(0,Math.round(Number(crew)||0)),
      airport:airport||problem?.airport||flight?.from||'',
      description:description||'Operational recovery cost',
      createdAt:typeof global.simNow==='function'?global.simNow():Date.now()
    };
    state.recoveryCostEvents.push(event);
    state.stats.recoveryCosts=(Number(state.stats.recoveryCosts)||0)+value;
    if(category==='passenger') state.stats.passengerRecoveryCosts=(Number(state.stats.passengerRecoveryCosts)||0)+value;
    if(category==='crew') state.stats.crewRecoveryCosts=(Number(state.stats.crewRecoveryCosts)||0)+value;
    if(category==='cancellation') state.stats.cancellationCosts=(Number(state.stats.cancellationCosts)||0)+value;
    if(flight){
      flight.recoveryCostBooked=(Number(flight.recoveryCostBooked)||0)+value;
      if(flight.economics&&typeof global.refreshEconomicsTotals==='function'){
        flight.economics.recoveryOps=(Number(flight.economics.recoveryOps)||0)+value;
        global.refreshEconomicsTotals(flight);
      }
    }
    if(typeof global.postTransaction==='function') global.postTransaction(-value,'Recovery',event.description,event.problemId||event.flightId);
    return event;
  }

  const api={
    aircraftSizeFactor,
    passengerDelayCost,
    passengerOvernightExposure,
    crewComplementForFlight,
    crewRecoveryCost,
    crewAssignmentCost,
    cancellationRecoveryCost,
    recordRecoveryCostEvent
  };
  global.AeroRecoveryCosts=api;
  Object.assign(global,api);
})(typeof window!=='undefined'?window:globalThis);
