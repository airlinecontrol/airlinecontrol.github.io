/* Shared network disruptions: sector capacity, restricted airspace, and convective corridors. */
(function(global){
  'use strict';

  const MINUTE=typeof MIN==='number'?MIN:60_000;
  const HOUR_MS=typeof HOUR==='number'?HOUR:60*MINUTE;
  const DAY_MS=typeof DAY==='number'?DAY:24*HOUR_MS;
  const LOOKAHEAD_MS=24*HOUR_MS;
  const CLEAR_GRACE_MS=30*MINUTE;
  const EVENT_STALE_MS=3*DAY_MS;

  const STATIC_NETWORK_AREAS=[
    {
      id:'eur-core-sector',
      eventType:'atc_sector_capacity',
      problemType:'network_atc_sector_capacity',
      label:'Central Europe sector capacity',
      reason:'Eurocontrol sector regulation',
      severity:'warning',
      periodHours:8,
      probability:.08,
      minAffected:2,
      durationRange:[90,180],
      delayRange:[18,42],
      polygon:[
        {lat:53.6,lon:3.0},{lat:53.2,lon:12.8},{lat:49.4,lon:14.2},
        {lat:47.2,lon:8.7},{lat:48.2,lon:2.2},{lat:51.3,lon:1.2}
      ]
    },
    {
      id:'us-ne-sector',
      eventType:'atc_sector_capacity',
      problemType:'network_atc_sector_capacity',
      label:'US Northeast sector capacity',
      reason:'FAA enroute sector metering',
      severity:'warning',
      periodHours:8,
      probability:.07,
      minAffected:2,
      durationRange:[80,160],
      delayRange:[15,38],
      polygon:[
        {lat:43.3,lon:-78.8},{lat:43.1,lon:-70.0},{lat:40.0,lon:-68.8},
        {lat:38.0,lon:-73.0},{lat:39.2,lon:-78.6}
      ]
    },
    {
      id:'nat-restricted',
      eventType:'airspace_closure',
      problemType:'network_airspace_closure',
      label:'North Atlantic restricted airspace',
      reason:'Temporary oceanic restricted area',
      severity:'critical',
      periodHours:12,
      probability:.045,
      minAffected:1,
      durationRange:[180,420],
      delayRange:[35,85],
      polygon:[
        {lat:56.0,lon:-44.0},{lat:55.5,lon:-21.0},{lat:48.0,lon:-19.0},
        {lat:47.0,lon:-42.0}
      ]
    },
    {
      id:'gulf-restricted',
      eventType:'airspace_closure',
      problemType:'network_airspace_closure',
      label:'Gulf restricted airspace',
      reason:'Temporary military airspace restriction',
      severity:'critical',
      periodHours:12,
      probability:.035,
      minAffected:1,
      durationRange:[120,300],
      delayRange:[25,65],
      polygon:[
        {lat:31.8,lon:44.5},{lat:31.0,lon:55.5},{lat:25.0,lon:58.0},
        {lat:23.2,lon:49.0},{lat:26.4,lon:43.6}
      ]
    }
  ];

  function finite(value,fallback=0){
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
  }

  function clamp(value,min,max){
    return Math.max(min,Math.min(max,value));
  }

  function stableUnit(seed){
    if(typeof stableCatalogUnit==='function') return stableCatalogUnit(seed);
    if(global.AeroWeatherEngine?.stableUnit) return global.AeroWeatherEngine.stableUnit(seed);
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }

  function rangeValue(seed,[min,max]){
    return Math.round(min+(max-min)*stableUnit(seed));
  }

  function eventPeriod(area,t){
    const periodMs=Math.max(HOUR_MS,finite(area.periodHours,8)*HOUR_MS);
    return {
      index:Math.floor(t/periodMs),
      start:Math.floor(t/periodMs)*periodMs,
      length:periodMs
    };
  }

  function staticTimedEvent(area,t){
    const period=eventPeriod(area,t);
    const roll=stableUnit(`${area.id}:${period.index}:active`);
    if(roll>finite(area.probability,0)) return null;
    const durationMin=rangeValue(`${area.id}:${period.index}:duration`,area.durationRange||[90,180]);
    const offsetMax=Math.max(0,period.length-durationMin*MINUTE);
    const activeFrom=period.start+Math.round(offsetMax*stableUnit(`${area.id}:${period.index}:offset`));
    const activeUntil=activeFrom+durationMin*MINUTE;
    if(t<activeFrom||t>activeUntil) return null;
    const delayMin=rangeValue(`${area.id}:${period.index}:delay`,area.delayRange||[15,40]);
    return {
      id:`NE-${area.id}-${period.index}`,
      source:'simulated_network',
      networkId:`${area.eventType}:${area.id}:${period.index}`,
      eventType:area.eventType,
      problemType:area.problemType,
      label:area.label,
      reason:area.reason,
      severity:area.severity||'warning',
      activeFrom,
      activeUntil,
      delayMin,
      rerouteDelayMin:Math.max(8,Math.round(delayMin*.65)),
      minAffected:area.minAffected||1,
      polygon:area.polygon||[]
    };
  }

  function weatherNetworkEvents(t){
    if(!global.AeroWeatherEngine?.weatherCells) return [];
    const period=Math.floor(t/(3*HOUR_MS));
    return global.AeroWeatherEngine.weatherCells(t)
      .filter(cell=>cell.type==='storm'&&cell.severity==='severe'&&(cell.polygon||[]).length>=3)
      .map(cell=>({
        id:`NE-weather-${cell.id}`,
        source:'convective_weather',
        networkId:`convective:${cell.id}`,
        eventType:'convective_weather',
        problemType:'network_convective_weather',
        label:cell.label||'Convective weather corridor',
        reason:`${cell.label||'Convective weather'} crossing route corridors`,
        severity:'critical',
        activeFrom:period*3*HOUR_MS,
        activeUntil:(period+1)*3*HOUR_MS,
        delayMin:Math.max(18,finite(cell.delayMin,25)),
        rerouteDelayMin:Math.max(10,Math.round(finite(cell.delayMin,25)*.7)),
        minAffected:2,
        polygon:cell.polygon||[],
        weatherCellId:cell.id
      }));
  }

  function injectedNetworkEvents(t){
    return (state.networkEvents||[])
      .filter(event=>event&&event.manual)
      .filter(event=>t>=finite(event.activeFrom,0)&&t<=finite(event.activeUntil,0))
      .map(event=>normaliseEvent(event));
  }

  function candidateNetworkEvents(t=simNow()){
    const staticEvents=state.ops?.automaticDisruptions===false
      ? []
      : [
        ...STATIC_NETWORK_AREAS.map(area=>staticTimedEvent(area,t)).filter(Boolean),
        ...weatherNetworkEvents(t)
      ];
    return [...staticEvents,...injectedNetworkEvents(t)].map(event=>normaliseEvent(event)).filter(Boolean);
  }

  function normalisePoint(point){
    if(Array.isArray(point)) return {lon:Number(point[0]),lat:Number(point[1])};
    return {lon:Number(point?.lon),lat:Number(point?.lat)};
  }

  function normalisePolygon(polygon){
    if(global.AeroRoutePlanning?.normalizePolygonPoints) return global.AeroRoutePlanning.normalizePolygonPoints(polygon);
    return (polygon||[]).map(normalisePoint).filter(point=>Number.isFinite(point.lat)&&Number.isFinite(point.lon));
  }

  function normaliseEvent(event){
    if(!event||!event.id) return null;
    const polygon=normalisePolygon(event.polygon);
    if(polygon.length<3) return null;
    const delayMin=Math.max(0,Math.round(finite(event.delayMin,0)));
    return {
      ...event,
      polygon,
      networkId:event.networkId||event.id,
      activeFrom:finite(event.activeFrom,0),
      activeUntil:finite(event.activeUntil,0),
      delayMin,
      rerouteDelayMin:Math.max(0,Math.round(finite(event.rerouteDelayMin,Math.max(8,delayMin*.65)))),
      minAffected:Math.max(1,Math.round(finite(event.minAffected,1))),
      affectedFlightIds:Array.isArray(event.affectedFlightIds)?event.affectedFlightIds.filter(Boolean):[]
    };
  }

  function coordinatesToPoints(coordinates){
    return (coordinates||[]).map(normalisePoint).filter(point=>Number.isFinite(point.lat)&&Number.isFinite(point.lon));
  }

  function routePointsForFlight(flight,t){
    if(!flight) return [];
    if(typeof flightIsAirborne==='function'&&flightIsAirborne(flight,t)){
      const split=global.AeroRoutePlanning?.splitRouteCoordinatesForFlight?.(flight,t);
      return coordinatesToPoints(split?.remaining||[]);
    }
    return coordinatesToPoints(global.AeroRoutePlanning?.routeCoordinatesForFlight?.(flight)||[]);
  }

  function eventOverlapsFlightWindow(event,flight){
    const dep=typeof flightActualDeparture==='function'?flightActualDeparture(flight):flight?.actualDeparture||flight?.departure||0;
    const arr=typeof flightActualArrival==='function'?flightActualArrival(flight):flight?.actualArrival||flight?.arrival||0;
    return arr>=event.activeFrom&&dep<=event.activeUntil;
  }

  function networkEventAppliesToFlight(event,flight,t=simNow()){
    if(!event||!flight||flight.cancelled||flight.settled) return false;
    if(flight.flightType==='ferry'&&event.problemType==='network_convective_weather') return false;
    const dep=typeof flightActualDeparture==='function'?flightActualDeparture(flight):flight.departure;
    const arr=typeof flightActualArrival==='function'?flightActualArrival(flight):flight.arrival;
    if(arr<t-15*MINUTE) return false;
    if(dep>t+LOOKAHEAD_MS) return false;
    if(!eventOverlapsFlightWindow(event,flight)) return false;
    const points=routePointsForFlight(flight,t);
    return Boolean(points.length>=2&&global.AeroRoutePlanning?.pathIntersectsPolygon?.(points,event.polygon));
  }

  function affectedFlightsForNetworkEvent(event,t=simNow()){
    return (state.flights||[])
      .filter(flight=>networkEventAppliesToFlight(event,flight,t))
      .sort((a,b)=>(typeof flightActualDeparture==='function'?flightActualDeparture(a):a.departure)-(typeof flightActualDeparture==='function'?flightActualDeparture(b):b.departure));
  }

  function networkEventProblemRequired(event,affected,t=simNow()){
    if(!event||!affected?.length) return false;
    if(event.problemType==='network_atc_sector_capacity') return false;
    if(event.problemType!=='network_convective_weather') return true;
    const airborne=affected.some(flight=>typeof flightIsAirborne==='function'&&flightIsAirborne(flight,t));
    const imminentDeparture=affected.some(flight=>{
      if(typeof flightHasDeparted==='function'&&flightHasDeparted(flight,t)) return false;
      const departure=typeof flightActualDeparture==='function'?flightActualDeparture(flight):flight.departure;
      return departure>=t&&departure-t<=90*MINUTE;
    });
    return airborne||imminentDeparture;
  }

  function eventSignature(event,affected){
    return [
      event.id,event.networkId,event.problemType,event.eventType,
      Math.round(event.activeFrom/MINUTE),Math.round(event.activeUntil/MINUTE),
      event.delayMin,event.rerouteDelayMin,
      affected.map(flight=>flight.id).join(',')
    ].join('|');
  }

  function syncNetworkEventState(candidate,affected,t){
    state.networkEvents??=[];
    const signature=eventSignature(candidate,affected);
    const existing=state.networkEvents.find(item=>item.id===candidate.id);
    if(existing){
      if(existing.signature===signature&&existing.status==='active') return false;
      Object.assign(existing,candidate,{
        status:'active',
        affectedFlightIds:affected.map(flight=>flight.id),
        affectedCount:affected.length,
        signature,
        updatedAt:t,
        lastDetectedAt:t
      });
      return true;
    }
    state.networkEvents.push({
      ...candidate,
      status:'active',
      affectedFlightIds:affected.map(flight=>flight.id),
      affectedCount:affected.length,
      signature,
      createdAt:t,
      updatedAt:t,
      lastDetectedAt:t
    });
    return true;
  }

  function expireNetworkEvents(activeIds,t){
    let changed=false;
    for(const event of state.networkEvents||[]){
      if(event.manual) continue;
      if(activeIds.has(event.id)) continue;
      if(event.status==='active'){
        event.status='cleared';
        event.clearedAt=t;
        changed=true;
      }
    }
    const retained=(state.networkEvents||[]).filter(event=>
      event.manual||event.status==='active'||t-Math.max(event.clearedAt||0,event.activeUntil||0)<EVENT_STALE_MS
    );
    if(retained.length!==(state.networkEvents||[]).length){
      state.networkEvents=retained;
      changed=true;
    }
    return changed;
  }

  function problemContextForEvent(event,affected,t){
    const ids=affected.map(flight=>flight.id);
    const airborne=affected.filter(flight=>typeof flightIsAirborne==='function'&&flightIsAirborne(flight,t)).length;
    const departures=affected.filter(flight=>!(typeof flightHasDeparted==='function'&&flightHasDeparted(flight,t))).length;
    return {
      sourceId:event.id,
      sourceKey:event.id,
      networkId:event.networkId||event.id,
      eventId:event.id,
      eventType:event.eventType,
      label:event.label,
      reason:event.reason,
      active:true,
      activeFrom:event.activeFrom,
      activeUntil:event.activeUntil,
      delayMin:event.delayMin,
      rerouteDelayMin:event.rerouteDelayMin,
      affectedFlightIds:ids,
      affectedCount:ids.length,
      airborneCount:airborne,
      departureCount:departures,
      polygon:event.polygon,
      weatherCellId:event.weatherCellId||''
    };
  }

  function findNetworkProblem(event){
    const dedupeKey=`network:${event.problemType}:${event.networkId||event.id}`;
    const problems=state.problems||state.problems||[];
    return problems.find(problem=>problem.status==='open'&&problem.dedupeKey===dedupeKey)
      ||problems.find(problem=>problem.status==='open'&&problem.type===event.problemType&&problem.context?.networkId===(event.networkId||event.id));
  }

  function upsertNetworkProblem(event,affected,t){
    if(!affected.length) return false;
    const primary=affected.find(flight=>typeof flightIsAirborne==='function'&&flightIsAirborne(flight,t))||affected[0];
    const context=problemContextForEvent(event,affected,t);
    const existing=findNetworkProblem(event);
    if(existing){
      const previous=JSON.stringify(existing.context||null);
      const next=JSON.stringify(context);
      let changed=false;
      if(previous!==next){ existing.context=context; changed=true; }
      if(existing.flightId!==primary.id){ existing.flightId=primary.id; changed=true; }
      if(existing.aircraftId!==primary.aircraftId){ existing.aircraftId=primary.aircraftId; changed=true; }
      const current=(existing.affectedFlightIds||[]).slice().sort().join('|');
      const desired=context.affectedFlightIds.slice().sort().join('|');
      if(current!==desired){ existing.affectedFlightIds=context.affectedFlightIds.slice(); changed=true; }
      if(existing.conditionClearedAt){ existing.conditionClearedAt=0; changed=true; }
      existing.lastDetectedAt=t;
      if(typeof ensureProblemIdentityFields==='function') changed=ensureProblemIdentityFields(existing,primary,context,t)||changed;
      if(changed&&typeof invalidateOperationalIndex==='function') invalidateOperationalIndex();
      return changed;
    }
    if((state.problems||state.problems||[]).some(problem=>
      problem.status==='resolved'&&problem.type===event.problemType&&problem.dedupeKey===`network:${event.problemType}:${event.networkId||event.id}`
    )) return false;
    const problem=(typeof createProblem==='function'?createProblem:createProblem)(event.problemType,primary,{
      detectedAt:t,
      source:'network',
      sourceKey:event.id,
      context
    });
    if(!problem) return false;
    problem.severity=event.severity||problem.severity;
    problem.affectedFlightIds=context.affectedFlightIds.slice();
    problem.airport='';
    if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'network_event_attached',{eventId:event.id,affectedCount:affected.length});
    return true;
  }

  function closeClearedNetworkProblems(activeNetworkIds,t){
    let changed=false;
    for(const problem of state.problems||state.problems||[]){
      if(problem.status!=='open'||problem.scope?.kind!=='network') continue;
      const id=problem.context?.networkId||problem.scope.subjectId;
      if(activeNetworkIds.has(id)) continue;
      const visibleSince=problem.firstVisibleAt||problem.detectedAt||t;
      if(!problem.conditionClearedAt){
        problem.conditionClearedAt=t;
        if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'condition_clear_pending',{clearAfter:CLEAR_GRACE_MS});
        changed=true;
        continue;
      }
      if(t-Math.max(visibleSince,problem.conditionClearedAt)<CLEAR_GRACE_MS) continue;
      problem.status='resolved';
      problem.blocking=false;
      problem.resolvedAt=t;
      problem.autoClosedAt=t;
      problem.autoCloseReason='network_event_cleared';
      problem.automaticResolution=true;
      problem.outcome='The shared network constraint cleared before OCC action was needed.';
      if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'auto_closed',{reason:'network_event_cleared'});
      changed=true;
    }
    if(changed&&typeof invalidateOperationalIndex==='function') invalidateOperationalIndex();
    return changed;
  }

  function activeNetworkEvents(t=simNow()){
    return (state.networkEvents||[])
      .map(event=>normaliseEvent(event))
      .filter(Boolean)
      .filter(event=>event.status==='active'&&t>=event.activeFrom-CLEAR_GRACE_MS&&t<=event.activeUntil+CLEAR_GRACE_MS);
  }

  function processNetworkOperationalProblems(t=simNow()){
    let changed=false;
    const activeIds=new Set();
    const activeNetworkIds=new Set();
    for(const event of candidateNetworkEvents(t)){
      const affected=affectedFlightsForNetworkEvent(event,t);
      if(affected.length<event.minAffected) continue;
      activeIds.add(event.id);
      if(syncNetworkEventState(event,affected,t)) changed=true;
      if(networkEventProblemRequired(event,affected,t)){
        activeNetworkIds.add(event.networkId||event.id);
        if(upsertNetworkProblem(event,affected,t)) changed=true;
      }
    }
    if(expireNetworkEvents(activeIds,t)) changed=true;
    if(closeClearedNetworkProblems(activeNetworkIds,t)) changed=true;
    return changed;
  }

  function labelForAction(action){
    if(action==='reroute_around') return 'avoidance routing';
    if(action==='hold_departures') return 'departure hold';
    if(action==='accept_tactical') return 'tactical deviations';
    if(action==='accept_flow') return 'regulated flow';
    return 'network coordination';
  }

  function addFlightNetworkTag(flight,event,label){
    flight.networkConstraintIds??=[];
    const networkId=event.networkId||event.id;
    if(!flight.networkConstraintIds.includes(networkId)) flight.networkConstraintIds.push(networkId);
    flight.networkConstraintLabel=label;
    flight.airspaceConstraintLabel=label;
  }

  function applyDelayToFlight(flight,event,delayMin,t,action){
    const delay=Math.max(0,Math.round(delayMin));
    if(!delay) return 0;
    addFlightNetworkTag(flight,event,`${event.label||'Network event'}: ${labelForAction(action)}`);
    if(typeof flightHasDeparted==='function'&&flightHasDeparted(flight,t)){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    }else{
      flight.airspaceDelayMin=Math.max(Number(flight.airspaceDelayMin)||0,delay);
    }
    return delay;
  }

  function actionDelayForFlight(event,flight,action,t){
    const base=Math.max(8,finite(event.delayMin,25));
    if(action==='reroute_around') return Math.max(8,finite(event.rerouteDelayMin,Math.round(base*.65)));
    if(action==='accept_tactical') return Math.max(8,Math.round(base*.75));
    if(action==='hold_departures'&&!(typeof flightHasDeparted==='function'&&flightHasDeparted(flight,t))){
      return Math.max(base,Math.ceil((finite(event.activeUntil,t)-t)/MINUTE));
    }
    return base;
  }

  function networkActionCost(event,flights,action,totalDelay){
    const affected=flights.length||1;
    const routeCost=action==='reroute_around'?affected*900:action==='hold_departures'?affected*350:affected*250;
    const delayCost=Math.max(0,totalDelay)*22;
    return Math.round((routeCost+delayCost)/100)*100;
  }

  function applyNetworkEventAction(problem,action,{task=null,t=simNow(),flightIds=null}={}){
    const context=problem?.context||{};
    const event=normaliseEvent({
      id:context.eventId||context.sourceId||problem?.id,
      networkId:context.networkId||problem?.scope?.subjectId||context.eventId||problem?.id,
      eventType:context.eventType||'network',
      problemType:problem?.type||context.problemType||'network_atc_sector_capacity',
      label:context.label||global.AeroProblemModel?.titleForType?.(problem?.type)||'Network event',
      reason:context.reason||'Network operational constraint',
      severity:problem?.severity||'warning',
      activeFrom:context.activeFrom||t,
      activeUntil:context.activeUntil||t+60*MINUTE,
      delayMin:context.delayMin||20,
      rerouteDelayMin:context.rerouteDelayMin||0,
      polygon:context.polygon||[]
    });
    if(!event) return {ok:false,reason:'Network event geometry is missing.'};
    const affectedIds=new Set(problemAffectedFlightIds(problem));
    const requestedIds=Array.isArray(flightIds)&&flightIds.length?new Set(flightIds):null;
    const flights=(state.flights||[])
      .filter(flight=>affectedIds.has(flight.id)&&(!requestedIds||requestedIds.has(flight.id))&&!flight.cancelled&&!flight.settled)
      .filter(flight=>networkEventAppliesToFlight(event,flight,t)||action==='hold_departures')
      .sort((a,b)=>(typeof flightActualDeparture==='function'?flightActualDeparture(a):a.departure)-(typeof flightActualDeparture==='function'?flightActualDeparture(b):b.departure));
    if(!flights.length) return {ok:false,reason:'No currently affected flights are available for this network plan.'};
    let routed=0,totalDelay=0;
    for(const flight of flights){
      let delay=actionDelayForFlight(event,flight,action,t);
      if(action==='reroute_around'){
        const revision=global.AeroRoutePlanning?.createAvoidanceRouteRevision?.(flight,event,{
          createdAt:t,
          reason:`${event.label||'Network'} avoidance route`
        });
        if(revision) routed++;
        delay=Math.max(delay,Math.max(0,Number(revision?.estimatedTimeDeltaMin)||0));
      }
      totalDelay+=applyDelayToFlight(flight,event,delay,t,action);
    }
    const averageDelay=Math.round(totalDelay/flights.length);
    const responseMin=Math.max(6,Math.round((task?.timing?.responseMin||0)||8+Math.min(18,flights.length*1.6)));
    const cost=networkActionCost(event,flights,action,totalDelay);
    problem.networkOutcome={
      action,
      label:labelForAction(action),
      affectedCount:flights.length,
      routedCount:routed,
      averageDelayMin:averageDelay,
      totalDelayMin:totalDelay,
      cost,
      appliedAt:t
    };
    problem.coordinatedDelayMin=Math.max(Number(problem.coordinatedDelayMin)||0,averageDelay);
    problem.networkRecoveryCost=cost;
    return {
      ok:true,
      action,
      affectedCount:flights.length,
      routedCount:routed,
      delayMinAvg:averageDelay,
      totalDelayMin:totalDelay,
      responseMin,
      cost,
      counterparty:action==='reroute_around'?'ATC network manager / flight crews':'Network flow desk',
      outcome:`${event.label||'Network event'} ${labelForAction(action)} coordinated for ${flights.length} flight${flights.length===1?'':'s'}; average delay +${averageDelay} min.`
    };
  }

  function flightCoveredByActiveEvent(flight,t=simNow(),problemType=''){
    return activeNetworkEvents(t).some(event=>
      (!problemType||event.problemType===problemType)&&networkEventAppliesToFlight(event,flight,t)
    );
  }

  global.AeroNetworkEvents={
    STATIC_NETWORK_AREAS,
    candidateNetworkEvents,
    activeNetworkEvents,
    affectedFlightsForNetworkEvent,
    networkEventAppliesToFlight,
    networkEventProblemRequired,
    processNetworkOperationalProblems,
    applyNetworkEventAction,
    flightCoveredByActiveEvent
  };
  global.processNetworkOperationalProblems=processNetworkOperationalProblems;
})(typeof window!=='undefined'?window:globalThis);
