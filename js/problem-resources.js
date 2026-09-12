/* Resource helpers used by problem cards, simulation guards, and widget actions. */
(function(global){
  'use strict';

  function diversionRouteDurationMs(km,model){
    return (.45+km/model.speedKmh)*HOUR;
  }

  function diversionFuelEstimate(flight,aircraft,km){
    const now=simNow();
    const model=MODELS[aircraft.model];
    const performance=aircraftFuelPerformance(model);
    const planned=flightFuelPlan(flight.from,flight.to,aircraft);
    const inOperation=typeof flightIsInOperation==='function'
      ? flightIsInOperation(flight,now)
      : Boolean(flight?.departureLogged&&flightActualDeparture(flight)<=now&&now<flightActualArrival(flight));
    const progress=inOperation&&typeof flightProgress==='function'?flightProgress(flight,now):0;
    const onboard=flight.fueled?(flight.fuelOnboardAtDeparture||planned.requiredGal):Math.max(planned.requiredGal,aircraft.fuelGallons||0);
    const remaining=Math.max(0,onboard-(flight.tripFuelGallons||planned.tripBurnGal)*progress);
    const required=Math.ceil(performance.burnGalPerHour*(diversionRouteDurationMs(km,model)/HOUR)+performance.burnGalPerHour*.45);
    return {remaining,required,ok:remaining>=required||!flight.departureLogged,estimated:Boolean(inOperation||flight.fueled)};
  }

  function diversionAnchorForProblem(problem,flight,aircraft,t=simNow()){
    const inOperation=typeof flightIsInOperation==='function'
      ? flightIsInOperation(flight,t)
      : Boolean(flight?.departureLogged&&flightActualDeparture(flight)<=t&&t<flightActualArrival(flight));
    if(inOperation&&aircraft){
      const position=currentAircraftPosition(aircraft,t);
      if(position&&position.status!=='ground'){
        return {type:'aircraft',lat:position.lat,lon:position.lon,label:'current aircraft position',status:position.status};
      }
    }
    const airport=AIRPORTS[flight?.from]||AIRPORTS[state.home];
    return {type:'origin',airport:flight?.from||state.home,lat:airport.lat,lon:airport.lon,label:`${flight?.from||state.home} origin`};
  }

  function diversionDistanceFromAnchor(anchor,code){
    const airport=AIRPORTS[code];
    return airport&&anchor ? distanceKm(anchor,airport) : Infinity;
  }

  function diversionCandidateArrivalAt(flight,anchor,duration,t=simNow()){
    if(anchor?.type==='aircraft') return t+duration;
    const plannedDeparture=typeof flightActualDeparture==='function' ? flightActualDeparture(flight) : flight?.departure;
    return Math.max(t,Number(plannedDeparture)||t)+duration;
  }

  function diversionCandidatesForProblem(problem,{includeReturnOrigin=true,onlyReturnOrigin=false}={}){
    const flight=state.flights.find(item=>item.id===problem.flightId);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return [];
    const destination=flightOperationalDestination(flight);
    const anchor=diversionAnchorForProblem(problem,flight,aircraft);
    const t=simNow();
    return Object.keys(AIRPORTS).filter(code=>code!==destination&&(includeReturnOrigin||code!==flight.from)).map(code=>{
      const returnOrigin=code===flight.from;
      if(onlyReturnOrigin&&!returnOrigin) return null;
      const km=Math.max(40,diversionDistanceFromAnchor(anchor,code));
      const destinationKm=distanceKm(AIRPORTS[destination],AIRPORTS[code]);
      const duration=diversionRouteDurationMs(km,MODELS[aircraft.model]);
      const weatherAt=diversionCandidateArrivalAt(flight,anchor,duration,t);
      const weather=Management.weatherAt(code,weatherAt);
      const rangeOk=km<=MODELS[aircraft.model].maxRangeKm;
      const handling=diversionHandlingAvailability(code);
      const fuel=diversionFuelEstimate(flight,aircraft,km);
      const weatherOk=weather.level!=='severe';
      const destinationBias=anchor.type==='aircraft' ? destinationKm/180 : destinationKm/80;
      const suitability=(rangeOk?100:0)-km/70-destinationBias+(returnOrigin?12:0)+(weather.level==='normal'?15:weather.level==='caution'?0:-30)+Math.min(12,handling.score/8)+(fuel.ok?0:-80);
      const rejectionReasons=[
        rangeOk?'':`outside ${MODELS[aircraft.model].maxRangeKm} km range`,
        weatherOk?'':`${weather.conditions||'severe weather'} at alternate`,
        handling.available?'':handling.label,
        fuel.ok?'':`fuel ${Math.round(fuel.remaining)} gal remaining / ${Math.round(fuel.required)} gal required`
      ].filter(Boolean);
      return {
        code,km,destinationKm,weather,weatherAt,weatherOk,handling,rangeOk,fuel,returnOrigin,rejectionReasons,
        anchor:{type:anchor.type,label:anchor.label,status:anchor.status||'',airport:anchor.airport||''},
        duration,durationMode:anchor.type==='aircraft'?'remaining_from_anchor':'total_from_origin',suitability
      };
    }).filter(Boolean);
  }

  function diversionCandidateSuitable(item){
    return Boolean(item?.rangeOk&&item.weatherOk&&item.handling?.available&&item.fuel?.ok);
  }

  function diversionOptionsForProblem(problem,options={}){
    return diversionCandidatesForProblem(problem,options)
      .filter(diversionCandidateSuitable)
      .sort((a,b)=>b.suitability-a.suitability)
      .slice(0,5);
  }

  function diversionRejectionSummaryForProblem(problem,options={}){
    const candidates=diversionCandidatesForProblem(problem,options);
    if(!candidates.length) return 'No airport catalog candidates are available for this case.';
    const rejected=candidates.filter(item=>!(item.rangeOk&&item.weatherOk&&item.handling?.available&&item.fuel.ok));
    if(!rejected.length) return '';
    const counts={
      range:rejected.filter(item=>!item.rangeOk).length,
      weather:rejected.filter(item=>!item.weatherOk).length,
      handling:rejected.filter(item=>!item.handling?.available).length,
      fuel:rejected.filter(item=>!item.fuel.ok).length
    };
    const summary=Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=>`${count} ${key}`).join(' · ');
    const nearest=rejected
      .sort((a,b)=>a.km-b.km)
      .slice(0,3)
      .map(item=>`${item.code}: ${item.rejectionReasons.slice(0,2).join(', ')}`)
      .join(' · ');
    return `${summary}${nearest?` (${nearest})`:''}`;
  }

  function alternateUnavailableMessage(problem,options={}){
    const details=diversionRejectionSummaryForProblem(problem,options);
    return details
      ? `No suitable alternate is available yet: ${details}. Add a resource only if handling is the blocker; otherwise use fuel/range/weather alternatives.`
      : 'No suitable alternate is available yet.';
  }

  function legalCrewConfirmationBlocker(problem){
    const flight=state.flights.find(item=>item.id===problem?.flightId&&!item.cancelled);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return 'The affected flight is no longer available.';
    const departure=Math.max(flightActualDeparture(flight),simNow());
    const deficits=personnelDeficitsForFlight(aircraft,departure,flight.arrival-flight.departure,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType)
      .filter(item=>['captains','firstOfficers','cabinCrew'].includes(item.role));
    if(!deficits.length) return '';
    const missing=deficits.map(item=>`${PERSONNEL[item.role]?.label||item.role}${item.qualification?` rated ${item.qualification}`:''}: ${item.available}/${item.required}`).join(' · ');
    return `Crew is still not legal at ${flight.from}: ${missing}. Add, request, or move personnel in the Personnel widget.`;
  }

  const api={
    diversionRouteDurationMs,diversionFuelEstimate,
    diversionCandidateArrivalAt,diversionAnchorForProblem,diversionCandidatesForProblem,
    diversionOptionsForProblem,diversionRejectionSummaryForProblem,alternateUnavailableMessage,legalCrewConfirmationBlocker
  };
  global.AeroProblemResources=api;
  Object.assign(global,api);
})(window);
