/* AeroSim scheduling, demand, flight economics, staffing, and operations simulation. */

const OperationalIntelligence=window.AeroOperationalIntelligence;
const OperationalWorkflows=window.AeroOperationalWorkflows;

function flightActualDeparture(f){ return f.actualDeparture ?? f.departure; }
function flightActualArrival(f){ return f.actualArrival ?? f.arrival; }
function flightOperationalDestination(f){ return f.diversionAirport||f.to; }
function flightTotalDepartureDelayMin(f){ return Math.max(0,Math.round((flightActualDeparture(f)-f.departure)/MIN)); }
function aircraftIsDefective(ac,t=simNow()){ return Boolean(ac && ac.defectUntil && t<ac.defectUntil); }
function stableFraction(seed){
  let hash=2166136261;
  for(const char of String(seed)){ hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
  return (hash>>>0)/4294967295;
}
function airportTaxiBaseMinutes(code,type='out'){
  const major=['LHR','JFK','AMS','CDG','HND','ATL','ORD','DFW','LAX','DXB','SIN','IST','FRA'].includes(code);
  const ops=AIRPORT_OPS[code]||{};
  const flow=Number(ops.slotIntervalMin)<=10?2:0;
  return Math.round((type==='out'?(major?16:11):(major?10:7))+flow);
}
function flightTaxiTimes(f){
  const duration=Math.max(MIN,flightActualArrival(f)-flightActualDeparture(f));
  const seed=f.id||`${f.from}-${f.to}-${f.departure}`;
  let taxiOut=(Number(f.taxiOutMin)||0)>0?Number(f.taxiOutMin):airportTaxiBaseMinutes(f.from,'out')+Math.round(stableFraction(`${seed}:taxi-out`)*5);
  let taxiIn=(Number(f.taxiInMin)||0)>0?Number(f.taxiInMin):airportTaxiBaseMinutes(flightOperationalDestination(f),'in')+Math.round(stableFraction(`${seed}:taxi-in`)*4);
  taxiOut+=Math.max(0,Number(f.taxiOutDelayMin)||0);
  taxiIn+=Math.max(0,Number(f.taxiInDelayMin)||0);
  const maxTaxi=Math.max(4*MIN,Math.min(42*MIN,duration*.38));
  if((taxiOut+taxiIn)*MIN>maxTaxi){
    const scale=maxTaxi/((taxiOut+taxiIn)*MIN);
    taxiOut=Math.max(2,Math.round(taxiOut*scale));
    taxiIn=Math.max(2,Math.round(taxiIn*scale));
  }
  return {taxiOutMin:taxiOut,taxiInMin:taxiIn};
}
function flightMovementTimes(f){
  const offBlockAt=flightActualDeparture(f),onBlockAt=flightActualArrival(f);
  const taxi=flightTaxiTimes(f);
  let takeoffAt=offBlockAt+taxi.taxiOutMin*MIN;
  let landingAt=onBlockAt-taxi.taxiInMin*MIN;
  if(landingAt<takeoffAt){
    const mid=offBlockAt+(onBlockAt-offBlockAt)/2;
    takeoffAt=Math.min(mid,offBlockAt+2*MIN);
    landingAt=Math.max(takeoffAt+MIN,onBlockAt-2*MIN);
  }
  return {offBlockAt,takeoffAt,landingAt,onBlockAt,...taxi};
}
function flightHasDeparted(f,t=simNow()){
  return Boolean(f && !f.cancelled && f.departureLogged && t>=f.departure && t>=flightActualDeparture(f));
}
function flightHasCompleted(f,t=simNow()){
  return Boolean(f && !f.cancelled && f.settled && flightHasDeparted(f,t) && t>=flightActualArrival(f));
}
function repairFlightLifecycleFlags(f,t=simNow()){
  if(!f||f.cancelled) return false;
  let changed=false;
  if(f.departureLogged&&!flightHasDeparted(f,t)){
    f.departureLogged=false;
    changed=true;
  }
  if(f.settled&&!flightHasCompleted(f,t)){
    f.settled=false;
    changed=true;
  }
  return changed;
}
function flightIsInOperation(f,t=simNow()){
  return Boolean(f && !f.cancelled && !flightHasCompleted(f,t) && flightHasDeparted(f,t) && flightActualDeparture(f)<=t && t<flightActualArrival(f));
}
function flightIsAirborne(f,t=simNow()){
  if(!flightIsInOperation(f,t)) return false;
  const movement=flightMovementTimes(f);
  return t>=movement.takeoffAt && t<movement.landingAt;
}
function flightArrivalDelayMinutes(f){ return Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN)); }

let operationalIndexRevision=0;
let operationalIndexCache={key:'',value:null};

function invalidateOperationalIndex(){
  operationalIndexRevision++;
  operationalIndexCache={key:'',value:null};
}

function mapPush(map,key,value){
  if(!map.has(key)) map.set(key,[]);
  map.get(key).push(value);
}

function operationalIndex(t=simNow()){
  const incidentSignature=(state.incidents||[])
    .map(item=>`${item.id}:${item.status}:${item.type}:${item.flightId}:${item.aircraftId}:${item.blocking?1:0}`)
    .join('|');
  const key=[
    operationalIndexRevision,
    Math.floor(t/MIN),
    state.aircraft.length,
    state.flights.length,
    state.crewDuties?.length||0,
    state.resourceRequests?.length||0,
    incidentSignature
  ].join('::');
  if(operationalIndexCache.key===key&&operationalIndexCache.value) return operationalIndexCache.value;
  const aircraftById=new Map(state.aircraft.map(aircraft=>[aircraft.id,aircraft]));
  const flightsById=new Map();
  const flightsByAircraft=new Map(state.aircraft.map(aircraft=>[aircraft.id,[]]));
  const previousFlightById=new Map();
  const activeFlights=[];
  const activeFlightByAircraft=new Map();
  const upcomingFlightByAircraft=new Map();
  const openIncidentsByFlight=new Map();
  const openIncidentsByAircraft=new Map();
  const openIncidents=[];
  for(const flight of state.flights){
    flightsById.set(flight.id,flight);
    if(!flight.cancelled) mapPush(flightsByAircraft,flight.aircraftId,flight);
    if(!flight.cancelled&&flightIsInOperation(flight,t)){
      activeFlights.push(flight);
      activeFlightByAircraft.set(flight.aircraftId,flight);
    }
  }
  for(const flights of flightsByAircraft.values()){
    flights.sort(compareAircraftRotationFlights);
    let previous=null;
    for(const flight of flights){
      if(previous) previousFlightById.set(flight.id,previous);
      if(!flight.settled&&flightActualDeparture(flight)>t&&!upcomingFlightByAircraft.has(flight.aircraftId)){
        upcomingFlightByAircraft.set(flight.aircraftId,flight);
      }
      previous=flight;
    }
  }
  activeFlights.sort((a,b)=>flightActualArrival(a)-flightActualArrival(b));
  for(const incident of state.incidents||[]){
    if(incident.status!=='open') continue;
    openIncidents.push(incident);
    if(incident.flightId) mapPush(openIncidentsByFlight,incident.flightId,incident);
    if(incident.aircraftId) mapPush(openIncidentsByAircraft,incident.aircraftId,incident);
  }
  const value={
    t,
    aircraftById,
    flightsById,
    flightsByAircraft,
    previousFlightById,
    activeFlights,
    activeFlightByAircraft,
    upcomingFlightByAircraft,
    openIncidents,
    openIncidentsByFlight,
    openIncidentsByAircraft
  };
  operationalIndexCache={key,value};
  return value;
}

function aircraftActiveFlight(acId,t=simNow()){
  return operationalIndex(t).activeFlightByAircraft.get(acId)||null;
}
function aircraftUpcomingFlight(acId,t=simNow()){
  return operationalIndex(t).upcomingFlightByAircraft.get(acId)||null;
}

function aircraftRotationSequenceTime(flight){
  return Number.isFinite(flight?.rotationDeparture)?flight.rotationDeparture:
    Number.isFinite(flight?.plannedDeparture)?flight.plannedDeparture:
    Number.isFinite(flight?.departure)?flight.departure:flightActualDeparture(flight);
}

function compareAircraftRotationFlights(a,b){
  return aircraftRotationSequenceTime(a)-aircraftRotationSequenceTime(b)||
    flightActualDeparture(a)-flightActualDeparture(b)||
    flightActualArrival(a)-flightActualArrival(b)||
    String(a?.id||'').localeCompare(String(b?.id||''));
}

function aircraftProjectedLocation(ac,t=simNow()){
  const now=simNow();
  if(!ac) return {location:state.home,availableAt:now,status:'unknown'};
  let location=ac.location,availableAt=now;
  const legs=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualArrival(f)>now)
    .sort(compareAircraftRotationFlights);
  for(const flight of legs){
    const departure=flightActualDeparture(flight),arrival=flightActualArrival(flight),destination=flightOperationalDestination(flight);
    if(!flight.departureLogged&&departure<now){
      return {location,availableAt,blockedBy:flight,status:'stale_unflown'};
    }
    if(departure>t) break;
    if(flight.from!==location){
      return {location,availableAt,blockedBy:flight,status:'position_conflict'};
    }
    if(arrival>t){
      return {location:flight.from,availableAt:arrival,blockedBy:flight,status:flight.departureLogged?statusOfFlight(flight,t):'planned'};
    }
    location=destination;
    availableAt=arrival;
  }
  return {location,availableAt,status:'ground'};
}

function aircraftRotationProjectionBeforeFlight(flight,t=simNow()){
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return {location:state.home,availableAt:t,status:'unknown'};
  const active=aircraftActiveFlight(aircraft.id,t);
  let location=active?flightOperationalDestination(active):aircraft.location;
  let availableAt=active?flightActualArrival(active):t;
  const future=state.flights
    .filter(item=>item.aircraftId===aircraft.id&&!item.cancelled&&!item.settled&&!item.departureLogged&&flightActualArrival(item)>t)
    .sort(compareAircraftRotationFlights);
  for(const candidate of future){
    if(candidate.id===flight.id) return {location,availableAt,status:'ready'};
    const departure=flightActualDeparture(candidate),arrival=flightActualArrival(candidate),destination=flightOperationalDestination(candidate);
    if(candidate.from!==location){
      return {location,availableAt,blockedBy:candidate,status:'position_conflict'};
    }
    location=destination;
    const readyAfterArrival=arrival+minimumTurnMinutes(aircraft,destination)*MIN;
    availableAt=departure>=availableAt?readyAfterArrival:Math.max(availableAt,readyAfterArrival);
  }
  return {location,availableAt,status:'ground'};
}

function statusOfFlight(f,t=simNow()){
  if(f.cancelled) return 'cancelled';
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  if(!flightHasDeparted(f,t)&&t<f.departure){
    if(flightTotalDepartureDelayMin(f)>0 && t>=f.departure-90*MIN) return 'delayed';
    return 'scheduled';
  }
  if(flightHasDeparted(f,t)){
    const movement=flightMovementTimes(f);
    if(t<arr){
      if(t<movement.takeoffAt) return 'taxi_out';
      if(t>=movement.landingAt) return 'taxi_in';
      return 'airborne';
    }
    return 'arrived';
  }
  if(t<dep){
    if(flightTotalDepartureDelayMin(f)>0 && t>=f.departure-90*MIN) return 'delayed';
    return 'scheduled';
  }
  return 'delayed';
}
function flightProgress(f,t=simNow()){
  const movement=flightMovementTimes(f),dep=movement.takeoffAt,arr=movement.landingAt;
  return clamp((t-dep)/(arr-dep),0,1);
}
function offsetGeoPoint(point,heading,distanceKm){
  const R=6371,b=rad(heading),lat1=rad(point.lat),lon1=rad(point.lon),d=distanceKm/R;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(b));
  const lon2=lon1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return {lat:deg(lat2),lon:((deg(lon2)+540)%360)-180};
}
function airportTaxiPoint(airport,flight,kind,phase='out'){
  const destination=AIRPORTS[flightOperationalDestination(flight)]||airport;
  const origin=AIRPORTS[flight.from]||airport;
  const routeBearing=bearing(airport,destination);
  const baseBearing=phase==='in'?bearing(airport,origin):routeBearing;
  if(kind==='runway') return offsetGeoPoint(airport,baseBearing,2.4);
  const standBearing=baseBearing+95+stableFraction(`${flight.id}:stand`)*170;
  return offsetGeoPoint(airport,standBearing,0.75);
}

function addTaxiCause(causes,phase,label,minutes,detail){
  const value=Math.max(0,Math.round(Number(minutes)||0));
  if(value>0) causes.push({phase,label,minutes:value,detail});
}
function taxiWeatherDelayFor(code,weather,phase){
  if(!weather) return [];
  const out=[],vis=Number(weather.visibilityKm),ceiling=Number(weather.ceilingFt),capacity=Number(weather.capacityFactor)||1;
  const condition=weather.conditions||weather.label||'weather';
  if(vis<=1 || ceiling<=300) addTaxiCause(out,phase,'Low visibility taxi procedures',10,`${code} ${condition}: ${vis} km visibility / ${ceiling} ft ceiling`);
  else if(vis<=2.5 || ceiling<=800 || weather.type==='fog') addTaxiCause(out,phase,'Low visibility taxi procedures',6,`${code} ${condition}: ${vis} km visibility / ${ceiling} ft ceiling`);
  if(weather.type==='snow'||/snow|ice|deicing/i.test(condition)) addTaxiCause(out,phase,'Winter taxi / deicing sequencing',phase==='out'?9:6,`${code} ${condition}`);
  if(['storm','wind'].includes(weather.type)||capacity<.78) addTaxiCause(out,phase,'Runway spacing and configuration',capacity<.65?8:5,`${code} ${condition} · capacity ${Math.round(capacity*100)}%`);
  return out;
}
function buildTaxiPressureIndex(flights){
  const index=new Map(),step=15*MIN;
  const add=(code,time,id)=>{
    if(!AIRPORTS[code]||!Number.isFinite(time)) return;
    const key=`${code}:${Math.floor(time/step)}`;
    if(!index.has(key)) index.set(key,new Set());
    index.get(key).add(id);
  };
  for(const flight of flights){
    if(flight.cancelled||flight.settled) continue;
    add(flight.from,flightActualDeparture(flight),flight.id);
    add(flightOperationalDestination(flight),flightActualArrival(flight),flight.id);
  }
  return index;
}
function taxiPressureCount(index,code,time){
  const step=15*MIN,bucket=Math.floor(time/step);
  const ids=new Set();
  for(let offset=-1;offset<=1;offset++){
    const group=index.get(`${code}:${bucket+offset}`);
    if(group) for(const id of group) ids.add(id);
  }
  return ids.size;
}
function taxiDelayProfile(flight,{departureTime=flightActualDeparture(flight),arrivalTime=flightActualArrival(flight),pressureIndex=null}={}){
  const destination=flightOperationalDestination(flight);
  const causes=[];
  const originWeather=Management.weatherAt(flight.from,departureTime);
  const destinationWeather=Management.weatherAt(destination,arrivalTime);
  causes.push(...taxiWeatherDelayFor(flight.from,originWeather,'out'));
  causes.push(...taxiWeatherDelayFor(destination,destinationWeather,'in'));
  if(pressureIndex){
    const departurePressure=taxiPressureCount(pressureIndex,flight.from,departureTime);
    const arrivalPressure=taxiPressureCount(pressureIndex,destination,arrivalTime);
    if(departurePressure>=4) addTaxiCause(causes,'out','Ramp / runway departure pressure',Math.min(12,(departurePressure-3)*3),`${departurePressure} own-network movements around ${flight.from}`);
    if(arrivalPressure>=4) addTaxiCause(causes,'in','Arrival taxi-in pressure',Math.min(10,(arrivalPressure-3)*2),`${arrivalPressure} own-network movements around ${destination}`);
  }
  const taxiOutDelayMin=Math.min(22,causes.filter(item=>item.phase==='out').reduce((sum,item)=>sum+item.minutes,0));
  const taxiInDelayMin=Math.min(18,causes.filter(item=>item.phase==='in').reduce((sum,item)=>sum+item.minutes,0));
  return {taxiOutDelayMin,taxiInDelayMin,causes};
}
function taxiCauseText(flight,phase=''){
  return (flight.taxiDelayCauses||[])
    .filter(item=>!phase||item.phase===phase)
    .slice(0,3)
    .map(item=>`${item.label}${item.detail?`: ${item.detail}`:''}`)
    .join(' | ');
}
function currentAircraftPosition(ac,t=simNow(),index=null){
  const f=(index||operationalIndex(t)).activeFlightByAircraft.get(ac.id)||null;
  if(!f){
    const ap=AIRPORTS[ac.location] || AIRPORTS[state.home];
    return {lat:ap.lat,lon:ap.lon,heading:0,status:'ground',flight:null};
  }
  const aa=AIRPORTS[f.from],bb=AIRPORTS[flightOperationalDestination(f)],movement=flightMovementTimes(f);
  if(t<movement.takeoffAt){
    const stand=airportTaxiPoint(aa,f,'stand','out'),runway=airportTaxiPoint(aa,f,'runway','out'),progress=clamp((t-movement.offBlockAt)/(movement.takeoffAt-movement.offBlockAt||1),0,1);
    const pos={lat:stand.lat+(runway.lat-stand.lat)*progress,lon:stand.lon+(runway.lon-stand.lon)*progress};
    return {...pos,heading:bearing(pos,runway),status:'taxi_out',flight:f};
  }
  if(t>=movement.landingAt){
    const runway=airportTaxiPoint(bb,f,'runway','in'),stand=airportTaxiPoint(bb,f,'stand','in'),progress=clamp((t-movement.landingAt)/(movement.onBlockAt-movement.landingAt||1),0,1);
    const pos={lat:runway.lat+(stand.lat-runway.lat)*progress,lon:runway.lon+(stand.lon-runway.lon)*progress};
    return {...pos,heading:bearing(pos,stand),status:'taxi_in',flight:f};
  }
  const p=flightProgress(f,t);
  const routePosition=window.AeroRoutePlanning?.sampleRoutePosition?.(f,t);
  if(routePosition) return {...routePosition,status:'airborne',flight:f};
  const pos=interpolateGreatCircle(aa,bb,p), pos2=interpolateGreatCircle(aa,bb,Math.min(1,p+.002));
  return {...pos,heading:bearing(pos,pos2),status:'airborne',flight:f};
}
function minimumTurnMinutes(ac,airportCode){
  const model=MODELS[ac.model];
  const segment=String(model?.segment||'');
  const base=Number(model?.minimumTurnMin)||(
    segment.includes('turboprop')?30:
      segment.includes('Regional jet')?35:
        segment.includes('widebody')?60:40
  );
  const congested=['LHR','JFK','AMS','CDG','HND'].includes(airportCode)?10:0;
  return base+congested;
}

function effectiveTurnaroundMinutes(ac,airportCode,requestedMin=0){
  return Math.max(Number(requestedMin)||0,minimumTurnMinutes(ac,airportCode));
}

function turnaroundGapInfo(previous,next,aircraft=null){
  if(!previous||!next) return null;
  const ac=aircraft||state.aircraft.find(item=>item.id===next.aircraftId||item.id===previous.aircraftId);
  if(!ac) return null;
  const previousDestination=flightOperationalDestination(previous);
  const sameStation=previousDestination===next.from;
  const recoveredTurn=Math.max(0,Number(next.turnaroundRecoveryMin)||0);
  const minimumMin=Math.max(25,minimumTurnMinutes(ac,next.from)-recoveredTurn);
  const actualGapMin=Math.round((flightActualDeparture(next)-flightActualArrival(previous))/MIN);
  const plannedGapMin=Math.round((next.departure-previous.arrival)/MIN);
  const limitingGapMin=Math.min(actualGapMin,plannedGapMin);
  const plannedBelowMinimum=sameStation&&plannedGapMin<minimumMin;
  const actualBelowMinimum=sameStation&&actualGapMin<minimumMin;
  const belowMinimum=plannedBelowMinimum||actualBelowMinimum;
  const shortageMin=Math.max(0,minimumMin-limitingGapMin);
  const plannedShortageMin=Math.max(0,minimumMin-plannedGapMin);
  const actualShortageMin=Math.max(0,minimumMin-actualGapMin);
  const visibleGapLabel=value=>value<0?'overlap':`${value} min`;
  const limitingGapLabel=actualBelowMinimum
    ? `actual turnaround ${visibleGapLabel(actualGapMin)}`
    : plannedBelowMinimum
      ? `planned turnaround ${visibleGapLabel(plannedGapMin)}`
      : `turnaround ${visibleGapLabel(actualGapMin)}`;
  return {
    sameStation,minimumMin,actualGapMin,plannedGapMin,limitingGapMin,
    belowMinimum,plannedBelowMinimum,actualBelowMinimum,shortageMin,plannedShortageMin,actualShortageMin,
    title:belowMinimum
      ? `${previous.id} to ${next.id}: ${limitingGapLabel}, minimum ${minimumMin} min for ${ac.model} · planned ${plannedGapMin} min · actual ${actualGapMin} min`
      : `${previous.id} to ${next.id}: ground time ${actualGapMin} min, minimum ${minimumMin} min for ${ac.model}`
  };
}

function previousAircraftFlight(flight){
  return state.flights
    .filter(other=>other.aircraftId===flight.aircraftId&&!other.cancelled&&other.id!==flight.id&&compareAircraftRotationFlights(other,flight)<0)
    .sort((a,b)=>compareAircraftRotationFlights(b,a))[0]||null;
}

function inboundAircraftReadyForPostflightInspection(previous,station,t=simNow()){
  if(!previous||previous.flightType==='ferry'||!previous.departureLogged) return false;
  if(flightOperationalDestination(previous)!==station) return false;
  return statusOfFlight(previous,t)==='arrived';
}

function lateInboundStatusForFlight(flight,t=simNow(),context={}){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged||flight.flightType==='ferry') return {active:false,delayMin:0};
  const index=context.index||operationalIndex(t);
  const aircraft=context.aircraft||index.aircraftById.get(flight.aircraftId)||state.aircraft.find(item=>item.id===flight.aircraftId);
  let previous=context.previous||index.previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  if(previous&&flightOperationalDestination(previous)!==flight.from) previous=previousAircraftFlight(flight);
  if(!aircraft||!previous||flightOperationalDestination(previous)!==flight.from) return {active:false,delayMin:0};
  const turn=turnaroundGapInfo(previous,flight,aircraft);
  if(!turn?.sameStation||turn.plannedGapMin<turn.minimumMin||turn.actualGapMin>=turn.minimumMin){
    return {active:false,delayMin:0,previousFlightId:previous.id,turn};
  }
  const shortageMin=Math.max(0,turn.minimumMin-turn.actualGapMin);
  const delayMin=shortageMin;
  const inboundReadyAt=flightActualArrival(previous)+turn.minimumMin*MIN;
  return {
    active:true,delayMin,shortageMin,previousFlightId:previous.id,inboundReadyAt,turnMin:turn.minimumMin,protectedDepartureAt:flightActualDeparture(flight),turn,
    title:`Late inbound: ${previous.id} ready ${formatTime(inboundReadyAt)} · ${delayMin} min below minimum turn`
  };
}

function groundOperationsForFlight(flight,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const previousFlight=previousAircraftFlight(flight);
  const connectedPrevious=previousFlight?{
    ...previousFlight,operationalDestination:flightOperationalDestination(previousFlight)
  }:null;
  return {
    departure:AeroGroundOperations.departurePhase({
      flight,aircraft,previousFlight:connectedPrevious,
      previousArrival:previousFlight?flightActualArrival(previousFlight):null,
      minimumTurnMin:Math.max(25,minimumTurnMinutes(aircraft,flight.from)-Math.max(0,Number(flight.turnaroundRecoveryMin)||0)),now:t
    }),
    postflight:AeroGroundOperations.postflightPhase({
      flight,aircraft:MODELS[aircraft.model],actualArrival:flightActualArrival(flight),now:t
    })
  };
}

function aircraftGroundOperation(aircraft,t=simNow()){
  const flights=state.flights
    .filter(flight=>flight.aircraftId===aircraft.id&&!flight.cancelled)
    .sort((a,b)=>a.departure-b.departure);
  const upcoming=flights.find(flight=>flightActualDeparture(flight)>t);
  const recent=[...flights].reverse().find(flight=>flightActualArrival(flight)<=t);
  const recentPost=recent?groundOperationsForFlight(recent,t)?.postflight:null;
  if(recentPost&&recentPost.status!=='complete') return {flight:recent,phase:recentPost};
  const active=flights.find(flight=>flightIsAirborne(flight,t));
  if(active) return {flight:active,phase:groundOperationsForFlight(active,t)?.postflight};
  if(upcoming) return {flight:upcoming,phase:groundOperationsForFlight(upcoming,t)?.departure};
  return recentPost?{flight:recent,phase:recentPost}:null;
}

function connectionStatusForFlight(flight,onwardFlights=null){
  return OperationalIntelligence.connectionManifest({
    flight,actualArrival:flightActualArrival(flight),now:simNow(),
    onwardFlights:(onwardFlights||state.flights).filter(item=>!item.cancelled&&item.id!==flight.id).map(item=>({
      ...item,actualDeparture:flightActualDeparture(item)
    }))
  });
}

function networkConstraintsForFlight(flight){
  const departureWeather=Management.weatherAt(flight.from,flight.departure);
  const routePlan=window.AeroRoutePlanning?.ensureFlightRoutePlan?.(flight);
  const activeRoute=window.AeroRoutePlanning?.activeRevision?.(routePlan);
  const distance=activeRoute?.distanceKm||distanceKm(AIRPORTS[flight.from],AIRPORTS[flightOperationalDestination(flight)]);
  const airspace=OperationalIntelligence.airspaceConstraint(flight.from,flightOperationalDestination(flight),flight.departure,distance);
  const routeWeather=window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,flight.departure,{forecast:true})
    ||window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,flightOperationalDestination(flight),flight.departure);
  const night=flightNightRestriction(flight,flight.departure);
  if(routeWeather?.delayMin){
    const weatherDelay=Math.min(25,routeWeather.delayMin);
    if(weatherDelay>airspace.delayMin){
      airspace.delayMin=weatherDelay;
      airspace.reason=routeWeather.label||'convective weather avoidance';
      airspace.capacityFactor=routeWeather.severe ? .7 : .82;
    }
  }
  return {
    airport:OperationalIntelligence.airportConstraint(flight.from,flight.departure,departureWeather),
    airspace,night
  };
}

function nightConflictSourceKey(flight,night){
  const firstClosure=night?.closures?.[0];
  const affected=firstClosure||night?.closedStatus||(night?.departure?.status==='closed'?night.departure:night?.arrival?.status==='closed'?night.arrival:null);
  return `night-curfew:${flight.id}:${affected?.airport||flightOperationalDestination(flight)}:${Math.floor((affected?.nextOpenAt||night?.nextDeparture||0)/DAY)}`;
}

function nightConflictApproved(flight,night){
  const key=nightConflictSourceKey(flight,night);
  return flight.nightRecoveryDecision==='reschedule_after_curfew'&&flight.nightRecoverySourceKey===key;
}

function nightCurfewConflictContextForFlight(flight,proposedDeparture=flightActualDeparture(flight)){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged) return null;
  const duration=Number.isFinite(flight.operationalDurationMs)?flight.operationalDurationMs:(flight.arrival-flight.departure);
  const night=flightNightRestriction({...flight,operationalDurationMs:duration},proposedDeparture);
  if(night.status!=='closed'||night.delayMin<=0) return null;
  const sourceKey=nightConflictSourceKey(flight,night);
  if(flight.nightRecoveryDecision==='reschedule_after_curfew'&&flight.nightRecoverySourceKey===sourceKey) return null;
  const curfewPhases=(night.closures||[]).map(item=>({
    phase:item.phase,airport:item.airport,localTime:item.localTime,
    nextOpenAt:item.nextOpenAt,opensAt:item.opensAt,label:item.label
  }));
  if(!curfewPhases.length&&night.closedStatus){
    curfewPhases.push({
      phase:night.closedStatus.airport===flight.from?'departure':'arrival',
      airport:night.closedStatus.airport,
      localTime:night.closedStatus.localTime,
      nextOpenAt:night.closedStatus.nextOpenAt,
      opensAt:night.closedStatus.rule?.end,
      label:night.closedStatus.label
    });
  }
  const restrictionPhases=(night.restrictions||[])
    .filter(item=>item.status==='restricted'&&item.rule?.mode!=='curfew')
    .map(item=>({
      phase:item.phase,airport:item.airport,mode:item.rule?.mode||'restricted',
      label:item.label,localTime:item.localTime,delayMin:item.delayMin||0
    }));
  const phaseText=phase=>phase==='departure'?'departure':'arrival';
  const curfewSummary=curfewPhases.map(item=>`${item.airport} ${phaseText(item.phase)} curfew until ${item.opensAt||'reopening'}`);
  const restrictionSummary=restrictionPhases.map(item=>`${item.airport} ${phaseText(item.phase)} ${item.mode==='quota'?'night quota':'night restriction'}${item.delayMin?` +${item.delayMin}m`:''}`);
  const affected=curfewPhases[0]||night.closedStatus;
  return {
    sourceId:flight.id,
    sourceKey,
    active:true,
    delayMin:night.delayMin,
    readyAt:proposedDeparture,
    nextDeparture:night.nextDeparture,
    affectedAirport:affected?.airport||flightOperationalDestination(flight),
    affectedPhase:affected?.phase||(night.departure?.status==='closed'?'departure':'arrival'),
    curfewPhases,
    restrictionPhases,
    restrictionSummary:[...curfewSummary,...restrictionSummary].join(' · '),
    reason:night.reason,
    causedByDelay:proposedDeparture>flight.departure+5*MIN,
    plannedDeparture:flight.departure,
    plannedArrival:flight.arrival
  };
}

function nightDepartureChangePlanState(incident){
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
  if(!flight) return {ready:false,flight:null,reason:'Affected flight is no longer available.'};
  if(flight.departureLogged) return {ready:false,flight,reason:'The flight has already departed. Use airborne curfew coordination instead.'};
  const current=nightCurfewConflictContextForFlight(flight,flightActualDeparture(flight));
  if(current?.active){
    const target=current.nextDeparture?` Recommended earliest clear departure ${formatTime(current.nextDeparture)}.`:'';
    return {
      ready:false,flight,current,
      reason:`Current projected departure ${formatTime(flightActualDeparture(flight))} still conflicts with ${current.restrictionSummary||current.reason}.${target}`
    };
  }
  const night=flightNightRestriction(flight,flightActualDeparture(flight));
  const restricted=(night.restrictions||[]).filter(item=>item.status==='restricted'&&item.rule?.mode!=='curfew');
  const restrictionSummary=restricted.map(item=>`${item.airport} ${item.phase} ${item.rule?.mode==='quota'?'night quota':'night restriction'}${item.delayMin?` +${item.delayMin}m`:''}`).join(' · ');
  return {
    ready:true,flight,current:null,restrictionSummary,
    reason:restrictionSummary
      ? `Hard curfew cleared. Remaining restriction: ${restrictionSummary}.`
      : `Hard curfew cleared at projected departure ${formatTime(flightActualDeparture(flight))}.`
  };
}

function arrivalCurfewContextForFlight(flight,t=simNow()){
  if(!flight||flight.cancelled||flight.settled||!flight.departureLogged||!flightIsAirborne(flight,t)) return null;
  const destination=flightOperationalDestination(flight);
  const expectedArrival=flightActualArrival(flight);
  const status=airportNightStatus(destination,expectedArrival);
  if(status.status!=='closed') return null;
  const sourceKey=`arrival-curfew:${flight.id}:${destination}:${Math.floor(status.nextOpenAt/DAY)}`;
  if(flight.arrivalCurfewCoordinatedKey===sourceKey) return null;
  return {
    sourceId:flight.id,
    sourceKey,
    active:true,
    delayMin:Math.max(0,Math.ceil((status.nextOpenAt-expectedArrival)/MIN)),
    expectedArrival,
    plannedArrival:flight.arrival,
    affectedAirport:destination,
    affectedPhase:'arrival',
    nextOpenAt:status.nextOpenAt,
    reason:`Expected arrival inside ${destination} night curfew`
  };
}

function dispatchBriefingForFlight(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const constraints=networkConstraintsForFlight(flight);
  const destination=flightOperationalDestination(flight);
  const alternate=nearestDiversionAirport(flight,aircraft)||'';
  return OperationalIntelligence.dispatchBriefing({
    flight,crew:crewDutyForFlight(flight),
    departureWeather:Management.weatherAt(flight.from,flightActualDeparture(flight)),
    arrivalWeather:Management.weatherAt(destination,flightActualArrival(flight)),
    airport:constraints.airport,airspace:constraints.airspace,
    melItems:aircraft.melItems||[],incidents:openIncidentsForFlight(flight.id),
    fuelReady:Boolean(flight.fueled||simNow()<flight.departure-60*MIN),alternate
  });
}

function currentScenarioScore(t=simNow()){
  const start=t-7*DAY;
  const completed=state.flights.filter(flight=>flight.settled&&flightActualArrival(flight)>=start&&flightActualArrival(flight)<=t);
  const cancelled=state.flights.filter(flight=>flight.cancelled&&(flight.cancelledAt||flight.departure)>=start);
  const missedConnections=completed.reduce((sum,flight)=>sum+(flight.connectionMissedPax||0),0);
  const expiredMel=state.aircraft.reduce((sum,aircraft)=>sum+(aircraft.melItems||[]).filter(item=>item.status==='expired'||(item.status==='open'&&(item.expiresAt<=t||item.remainingCycles<=0))).length,0);
  return OperationalIntelligence.scenarioScore({
    completed,cancelled,missedConnections,expiredMel,
    openIncidents:state.incidents.filter(incident=>incident.status==='open')
  });
}

function nextSlotTime(readyTs, airportCode){
  const cfg=AIRPORT_OPS[airportCode] || {slotIntervalMin:15,graceMin:10};
  const weatherCapacity=Management.weatherAt(airportCode,readyTs).capacityFactor;
  const nightCapacity=airportNightStatus(airportCode,readyTs).capacityFactor;
  const capacity=Math.max(.2,weatherCapacity*nightCapacity);
  const effectiveInterval=Math.ceil((cfg.slotIntervalMin/capacity)/5)*5;
  const step=effectiveInterval*MIN;
  return Math.ceil(readyTs/step)*step;
}
function recalculateOperations(){
  const now=simNow();
  const flightsByAircraft=new Map(state.aircraft.map(ac=>[ac.id,[]]));
  for(const f of state.flights){
    f.handlingDelayMin=Number(f.handlingDelayMin)||0;
    f.technicalDelayMin=Number(f.technicalDelayMin)||0;
    f.enrouteDelayMin=Number(f.enrouteDelayMin)||0;
    f.manualDelayMin=Number(f.manualDelayMin)||0;
    f.weatherDelayMin=Number(f.weatherDelayMin)||0;
    f.liveWeatherDelayMin=Number(f.liveWeatherDelayMin)||0;
    f.incidentDelayMin=Number(f.incidentDelayMin)||0;
    f.maintenanceDelayMin=Number(f.maintenanceDelayMin)||0;
    f.positioningDelayMin=Number(f.positioningDelayMin)||0;
    f.airportDelayMin=Number(f.airportDelayMin)||0;
    f.airspaceDelayMin=Number(f.airspaceDelayMin)||0;
    f.taxiOutDelayMin=0; f.taxiInDelayMin=0; f.taxiDelayCauses=[];
    f.nightRestrictionDelayMin=0; f.nightRestrictionLabel='';
    f.nightRestrictionConflictDelayMin=0; f.nightRestrictionConflictLabel='';
    f.propagatedDelayMin=0; f.slotDelayMin=0; f.slotMissed=false;
    f.actualDeparture=f.departure; f.actualArrival=f.arrival;
    f.groundReadyAt=f.departure; f.groundPhaseKind='preflight';
    if(!f.cancelled) mapPush(flightsByAircraft,f.aircraftId,f);
  }
  const taxiPressureIndex=buildTaxiPressureIndex(state.flights);
  for(const ac of state.aircraft){
    const flights=(flightsByAircraft.get(ac.id)||[]).sort(compareAircraftRotationFlights);
    let prev=null;
    for(const f of flights){
      const baseReady=f.departure+(
        f.handlingDelayMin+f.technicalDelayMin+f.staffingDelayMin+f.manualDelayMin+
        f.weatherDelayMin+f.incidentDelayMin+f.maintenanceDelayMin+f.positioningDelayMin+
        f.airportDelayMin+f.airspaceDelayMin
      )*MIN;
      const connectedPrevious=prev?{...prev,operationalDestination:flightOperationalDestination(prev)}:null;
      const recoveredTurn=Math.max(0,Number(f.turnaroundRecoveryMin)||0);
      const groundPhase=AeroGroundOperations.departurePhase({
        flight:f,aircraft:ac,previousFlight:connectedPrevious,
        previousArrival:prev?flightActualArrival(prev):null,
        minimumTurnMin:Math.max(25,minimumTurnMinutes(ac,f.from)-recoveredTurn),now
      });
      f.groundReadyAt=groundPhase.readyAt;
      f.groundPhaseKind=groundPhase.kind;
      let ready=Math.max(baseReady,groundPhase.readyAt);
      if(groundPhase.readyAt>baseReady){
        f.propagatedDelayMin=Math.ceil((groundPhase.readyAt-baseReady)/MIN);
      }
      const operationalDuration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
      if(ac.defectUntil && ac.defectUntil>ready && f.departure<ac.defectUntil){
        ready=ac.defectUntil;
      }
      if(!f.departureLogged){
        const night=flightNightRestriction({...f,operationalDurationMs:operationalDuration},ready);
        if(night.delayMin>0){
          if(night.status==='closed'&&!nightConflictApproved(f,night)){
            f.nightRestrictionConflictDelayMin=night.delayMin;
            f.nightRestrictionConflictLabel=night.reason;
          }else{
            ready=night.nextDeparture;
            f.nightRestrictionDelayMin=night.delayMin;
            f.nightRestrictionLabel=night.reason;
          }
        }
      }
      const cfg=AIRPORT_OPS[f.from] || {slotIntervalMin:15,graceMin:10};
      let actualDep=ready;
      if(ready>f.departure+cfg.graceMin*MIN){
        f.slotMissed=true;
        const reassigned=nextSlotTime(ready,f.from);
        f.slotDelayMin=Math.max(0,Math.ceil((reassigned-ready)/MIN));
        const recoveredSlot=Math.min(f.slotDelayMin,Math.max(0,Number(f.slotPriorityMin)||0));
        f.slotDelayMin-=recoveredSlot;
        f.assignedSlot=reassigned-recoveredSlot*MIN;
        actualDep=f.assignedSlot;
      }else{
        f.assignedSlot=f.departure;
      }
      f.actualDeparture=Math.max(f.departure,actualDep);
      const enrouteRecovery=Math.min(Math.max(0,Number(f.enrouteRecoveryMin)||0),Math.max(0,Math.floor((operationalDuration+f.enrouteDelayMin*MIN-MIN)/MIN)));
      const preliminaryArrival=f.actualDeparture+operationalDuration+(f.enrouteDelayMin-enrouteRecovery)*MIN;
      const taxiProfile=taxiDelayProfile(f,{departureTime:f.actualDeparture,arrivalTime:preliminaryArrival,pressureIndex:taxiPressureIndex});
      f.taxiOutDelayMin=taxiProfile.taxiOutDelayMin;
      f.taxiInDelayMin=taxiProfile.taxiInDelayMin;
      f.taxiDelayCauses=taxiProfile.causes;
      f.actualArrival=preliminaryArrival+(f.taxiOutDelayMin+f.taxiInDelayMin)*MIN;
      const arrivalCurfew=arrivalCurfewContextForFlight(f,now);
      if(arrivalCurfew){
        f.nightRestrictionConflictDelayMin=arrivalCurfew.delayMin;
        f.nightRestrictionConflictLabel=arrivalCurfew.reason;
      }
      prev=f;
    }
  }
  rebuildCrewDuties();
  invalidateOperationalIndex();
}
function getNextGroundFlightForAircraft(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && !f.cancelled && !f.settled && flightActualDeparture(f)>t)
    .sort((x,y)=>flightActualDeparture(x)-flightActualDeparture(y))[0] || null;
}

function logEvent(){ /* operations log intentionally disabled */ }

function openIncidentsForFlight(flightId){
  return operationalIndex().openIncidentsByFlight.get(flightId)||[];
}

function departureBlockingIncidentsForFlight(flight){
  if(!flight) return [];
  return (state.incidents||[]).filter(incident=>{
    if(incident.flightId!==flight.id||incident.status!=='open'||!incident.blocking) return false;
    const definition=INCIDENT_DEFINITIONS[incident.type]||{};
    return !definition.airborneOnly;
  });
}

function departureGroundBlockersForFlight(flight){
  if(!flight) return [];
  const blockers=[...departureBlockingIncidentsForFlight(flight)];
  if(flight.positioningBlocked) blockers.push({type:'aircraft_positioning'});
  if(flight.staffingBlocked) blockers.push({type:'staffing'});
  if(flight.maintenanceBlocked) blockers.push({type:'maintenance'});
  return blockers;
}

function stableGroundHoldFields(kind){
  return {
    startedAt:`${kind}HoldStartedAt`,
    reason:`${kind}HoldReason`,
    releasedAt:`${kind}HoldReleasedAt`
  };
}

function markStableGroundHold(flight,kind,reason='',t=simNow(),startAt=null){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged) return false;
  const holdStart=Number.isFinite(startAt)?startAt:flight.departure;
  if(t<holdStart) return false;
  const fields=stableGroundHoldFields(kind);
  const normalizedReason=String(reason||kind);
  let changed=false;
  if(!flight[fields.startedAt]){ flight[fields.startedAt]=t; changed=true; }
  if(flight[fields.reason]!==normalizedReason){ flight[fields.reason]=normalizedReason; changed=true; }
  return changed;
}

function releaseStableGroundHold(flight,kind,delayField,t=simNow(),{bufferMin=1,quantumMin=1,targetAt=null}={}){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged) return false;
  const fields=stableGroundHoldFields(kind);
  if(!flight[fields.startedAt]) return false;
  let changed=false;
  const releaseAt=Number.isFinite(targetAt)?targetAt:t+Math.max(0,Number(bufferMin)||0)*MIN;
  const quantum=Math.max(1,Number(quantumMin)||1);
  if(t>=flight.departure&&flightActualDeparture(flight)<=t){
    const releaseDelay=Math.max(0,Math.ceil((releaseAt-flight.departure)/(quantum*MIN))*quantum);
    if((Number(flight[delayField])||0)<releaseDelay){
      flight[delayField]=releaseDelay;
      changed=true;
    }
  }
  if(flight[fields.releasedAt]!==t){ flight[fields.releasedAt]=t; changed=true; }
  if(flight[fields.startedAt]){ flight[fields.startedAt]=0; changed=true; }
  if(flight[fields.reason]){ flight[fields.reason]=''; changed=true; }
  return changed;
}

function crewSickRoleForFlight(flight){
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  const cabinNeed=aircraft?Math.max(1,Math.ceil(cabinSeatCount(aircraft)/50)):3;
  const options=[
    {role:'captains',weight:1},
    {role:'firstOfficers',weight:1},
    {role:'cabinCrew',weight:Math.min(4,cabinNeed)}
  ];
  let roll=simulationRandom(`crew-sick-role:${flight?.id||'unknown'}`)*options.reduce((total,item)=>total+item.weight,0);
  for(const option of options){
    roll-=option.weight;
    if(roll<=0) return option.role;
  }
  return 'cabinCrew';
}

function incidentAirport(type,flight){
  if(['destination_closure','destination_closure_ground'].includes(type)) return flight.to;
  if(['destination_handling_unavailable'].includes(type)) return flightOperationalDestination(flight);
  if(['night_curfew_conflict','arrival_curfew_coordination'].includes(type)) return flightOperationalDestination(flight);
  if(['onboard_medical','inflight_technical_fault','fuel_margin_low','atc_holding_fuel_conflict','airborne_atc_reroute','unruly_passenger','destination_weather_deterioration','destination_below_minima','alternate_unsuitable','diversion_airport_unavailable','lightning_strike','pressurization_issue','crew_duty_extension'].includes(type)) return flightOperationalDestination(flight);
  return flight.from;
}

function incidentIsDerivedType(type,source=''){
  return source==='derived'||DERIVED_INCIDENT_TYPES.has(type);
}

function incidentCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey){
  if(!candidate||candidate.status!=='open'||candidate.sourceKey&&sourceKey&&candidate.sourceKey===sourceKey) return 0;
  if(candidate.flightId===flight.id&&candidate.type===type) return 0;
  const index=operationalIndex(detectedAt);
  const candidateFlight=candidate.flightId?index.flightsById.get(candidate.flightId):null;
  let score=0;
  if(context?.sourceIncidentId&&candidate.id===context.sourceIncidentId) score+=120;
  if(context?.sourceId&&(candidate.id===context.sourceId||candidate.flightId===context.sourceId)) score+=80;
  if(context?.previousFlightId&&candidate.flightId===context.previousFlightId) score+=85;
  if(candidate.flightId===flight.id) score+=72;
  if(candidate.aircraftId&&candidate.aircraftId===flight.aircraftId) score+=34;
  if(candidate.airport&&candidate.airport===incidentAirport(type,flight)) score+=8;
  if(!incidentIsDerivedType(candidate.type,candidate.source)) score+=20;
  if(candidate.rootIncidentId&&candidate.rootIncidentId===candidate.id) score+=8;
  if(candidate.detectedAt<=detectedAt) score+=10;
  else score-=18;
  if(candidateFlight&&candidateFlight.departure<=flight.departure) score+=12;
  if(candidate.type==='night_curfew_conflict'&&type==='night_curfew_conflict') score-=60;
  return score;
}

function findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey){
  if(!incidentIsDerivedType(type,source)||!flight) return null;
  let best=null,bestScore=0;
  for(const candidate of state.incidents||[]){
    const score=incidentCaseParentScore(candidate,type,flight,context,detectedAt,sourceKey);
    if(score>bestScore){ best=candidate; bestScore=score; }
  }
  return bestScore>=55?best:null;
}

function incidentChainReason(type,parent,flight,context){
  if(!parent) return '';
  if(context?.previousFlightId&&parent.flightId===context.previousFlightId) return `Knock-on from inbound ${context.previousFlightId}`;
  if(parent.flightId===flight.id) return 'Same disrupted flight';
  if(parent.aircraftId===flight.aircraftId) return 'Same aircraft rotation';
  if(context?.sourceId) return `Linked operational source ${context.sourceId}`;
  return 'Linked operational consequence';
}

function ensureIncidentCaseFields(incident,parent=null,flight=null,context=null){
  if(!incident) return false;
  let changed=false;
  if(parent){
    const caseId=parent.caseId||parent.id;
    const rootIncidentId=parent.rootIncidentId||parent.id;
    if(incident.caseId!==caseId){ incident.caseId=caseId; changed=true; }
    if(incident.rootIncidentId!==rootIncidentId){ incident.rootIncidentId=rootIncidentId; changed=true; }
    if(incident.triggeredByIncidentId!==parent.id){ incident.triggeredByIncidentId=parent.id; changed=true; }
    const reason=incidentChainReason(incident.type,parent,flight||state.flights.find(item=>item.id===incident.flightId),context||incident.context||null);
    if(incident.chainReason!==reason){ incident.chainReason=reason; changed=true; }
  }else{
    if(!incident.caseId){ incident.caseId=incident.id; changed=true; }
    if(!incident.rootIncidentId){ incident.rootIncidentId=incident.id; changed=true; }
    if(incident.triggeredByIncidentId===undefined){ incident.triggeredByIncidentId=''; changed=true; }
    if(incident.chainReason===undefined){ incident.chainReason=''; changed=true; }
  }
  return changed;
}

function repairIncidentCaseLinks(){
  let changed=false;
  for(const incident of state.incidents||[]) changed=ensureIncidentCaseFields(incident)||changed;
  const open=(state.incidents||[]).filter(incident=>incident.status==='open'&&incidentIsDerivedType(incident.type,incident.source));
  for(const incident of open){
    if(incident.triggeredByIncidentId) continue;
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) continue;
    const parent=findIncidentCaseParent(incident.type,flight,incident.context,incident.detectedAt||simNow(),incident.source,incident.sourceKey);
    if(parent&&parent.id!==incident.id) changed=ensureIncidentCaseFields(incident,parent,flight,incident.context)||changed;
  }
  if(changed) invalidateOperationalIndex();
  return changed;
}

function incidentCreationPhaseBlocker(type,flight,t=simNow()){
  const definition=INCIDENT_DEFINITIONS[type];
  if(!definition||!flight) return 'invalid';
  if(definition.airborneOnly&&!flightIsAirborne(flight,t)) return 'requires_airborne';
  if(flight.departureLogged&&!definition.allowAirborne) return 'requires_ground';
  return '';
}

function incidentIsBeforeTakeoff(type,flight,t=simNow()){
  const definition=INCIDENT_DEFINITIONS[type];
  return Boolean(definition?.airborneOnly&&flight&&t<flightMovementTimes(flight).takeoffAt);
}

function createIncident(type,flight,{training=false,detectedAt=simNow(),source='random',sourceKey='',context=null}={}){
  if(type==='destination_closure'&&flight&&!flightIsAirborne(flight,detectedAt)) type='destination_closure_ground';
  const definition=INCIDENT_DEFINITIONS[type];
  if(RETIRED_INCIDENT_TYPES.has(type)||!definition||!flight||flight.cancelled||flight.settled) return null;
  if(!training&&!flight.departureLogged&&!definition.airborneOnly){
    const leadMin=definition.maxAutoLeadMin||(source==='derived'?360:180);
    if(detectedAt<flightActualDeparture(flight)-leadMin*MIN) return null;
  }
  if(incidentCreationPhaseBlocker(type,flight,detectedAt)) return null;
  if(type==='destination_closure_ground'&&!context){
    const destination=flightOperationalDestination(flight);
    const weather=Management.weatherAt(destination,flightActualArrival(flight));
    context={sourceId:flight.id,airport:destination,conditions:weather.conditions,capacityFactor:weather.capacityFactor,delayMin:Math.max(60,weather.delayMin||90),reason:'Destination unavailable before departure'};
  }
  if(type==='arrival_curfew_coordination'&&!context){
    context=arrivalCurfewContextForFlight(flight,detectedAt);
    if(!context) return null;
    sourceKey=context.sourceKey;
  }
  const duplicate=state.incidents.find(incident=>incident.flightId===flight.id&&incident.type===type&&incident.status==='open');
  if(duplicate){
    const parent=duplicate.triggeredByIncidentId?null:findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey);
    duplicate.context=context||duplicate.context||null;
    duplicate.lastDetectedAt=detectedAt;
    if(sourceKey&&!duplicate.sourceKey) duplicate.sourceKey=sourceKey;
    ensureIncidentCaseFields(duplicate,parent,flight,duplicate.context);
    invalidateOperationalIndex();
    return duplicate;
  }
  const id='INC'+state.nextIncident++;
  const parent=findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey);
  const latestUsefulDeadline=Math.max(detectedAt+5*MIN,flight.departure);
  const airborne=flightIsAirborne(flight,detectedAt);
  const deadline=airborne
    ? Math.min(detectedAt+definition.decisionMin*MIN,Math.max(detectedAt+5*MIN,flightActualArrival(flight)))
    : Math.min(detectedAt+definition.decisionMin*MIN,latestUsefulDeadline);
  const incident={
    id,type,flightId:flight.id,aircraftId:flight.aircraftId,
    airport:incidentAirport(type,flight),
    detectedAt,deadline,status:'open',severity:definition.severity,blocking:true,
    training:Boolean(training),selectedAction:'',resolvedAt:0,outcome:'',automaticResolution:false,
    technicalContext:['mel_defect','postflight_technical_defect'].includes(type)?technicalContextForIncident(type,id,detectedAt,context):null,
    classification:OperationalWorkflows.WORKFLOWS[type]?.classification||'incident',workflowCreatedAt:0,overdue:false,
    defaultApplied:false,defaultAppliedAt:0,defaultPolicy:'',defaultOutcome:'',
    firstVisibleAt:0,autoClosedAt:0,autoCloseReason:'',
    affectedRole:type==='crew_sick'?crewSickRoleForFlight(flight):'',
    recoveryPlan:'',recoveryPlanAt:0,source,sourceKey,context,lastDetectedAt:detectedAt,impacts:[],
    caseId:parent?.caseId||parent?.id||id,
    rootIncidentId:parent?.rootIncidentId||parent?.id||id,
    triggeredByIncidentId:parent?.id||'',
    chainReason:incidentChainReason(type,parent,flight,context)
  };
  if(type==='crew_fatigue_report') incident.affectedRole=crewSickRoleForFlight(flight);
  if(['no_legal_crew','crew_fatigue_mid_rotation','crew_misposition_after_diversion','crew_report_delayed'].includes(type)) incident.affectedRole=context?.role||'captains';
  if(type==='bird_strike') incident.technicalContext=OperationalIntelligence.melFinding(`${id}:bird`,detectedAt);
  if(type==='crew_misconnect') incident.affectedRole=context?.role||'captains';
  state.incidents.push(incident);
  ensureIncidentWorkflow(incident);
  if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'opened',{deadline,detectedAt,source,reason:context?.reason||context?.trigger||''});
  if(state.incidents.length>250){
    const removable=state.incidents.findIndex(item=>item.status!=='open');
    if(removable>=0) state.incidents.splice(removable,1);
  }
  invalidateOperationalIndex();
  return incident;
}

function technicalContextForIncident(type,id,detectedAt,context=null){
  const finding=OperationalIntelligence.melFinding(id,detectedAt);
  const forced=context&&(
    context.technicalDisposition||
    (context.deferAllowed===false?'maintenance_required':'')||
    (context.deferAllowed===true?'mel_allowed':'')
  );
  const roll=OperationalIntelligence.stableUnit(`${id}:${type}:technical-disposition`);
  const maintenanceRequired=forced
    ? forced==='maintenance_required'||forced==='immediate_check'||forced==='schedule_check'
    : roll<.38;
  return {
    ...finding,
    deferAllowed:!maintenanceRequired,
    requiresMaintenanceCheck:maintenanceRequired,
    disposition:maintenanceRequired?'maintenance_required':'mel_allowed',
    label:maintenanceRequired?`${finding.title} · immediate technical repair required`:finding.title
  };
}

function impactContextSignature(context){
  return JSON.stringify(context||null);
}

function derivedImpactStatus(type,context){
  if(type==='slot_miss_risk'&&(context?.slotDelayMin||0)<=10) return 'auto';
  return 'open';
}

function upsertIncidentImpact(parent,type,context,t){
  if(!parent) return false;
  parent.impacts??=[];
  const key=`${type}:${context?.sourceId||parent.flightId}`;
  const status=derivedImpactStatus(type,context);
  const existing=parent.impacts.find(item=>item.key===key);
  if(existing){
    const changed=existing.status!==status||impactContextSignature(existing.context)!==impactContextSignature(context);
    if(changed){
      existing.type=type; existing.context=context; existing.status=status; existing.updatedAt=t;
      existing.title=INCIDENT_DEFINITIONS[type]?.title||type;
      existing.summary=impactSummary(type,context,status);
    }
    return changed;
  }
  parent.impacts.push({
    key,type,status,context,createdAt:t,updatedAt:t,
    title:INCIDENT_DEFINITIONS[type]?.title||type,
    summary:impactSummary(type,context,status)
  });
  return true;
}

function impactSummary(type,context,status='open'){
  const prefix=status==='auto'?'Default policy recorded: ':'';
  if(type==='slot_miss_risk'){
    const cause=context?.primaryCause&&context.primaryCause!=='Unknown readiness delay'?` Cause: ${context.primaryCause}.`:'';
    return `${prefix}${context?.slotDelayMin||0} minutes of slot delay projected.${cause}`;
  }
  if(type==='crew_duty_risk') return `${prefix}${context?.label||'Crew duty limit risk projected.'}`;
  if(type==='crew_duty_extension') return `${prefix}+${context?.overrunMin||0} minutes beyond duty limit projected${context?.primaryCause?` · ${context.primaryCause}`:''}.`;
  return INCIDENT_DEFINITIONS[type]?.summary||'Operational impact projected.';
}

function addSlotCause(causes,label,minutes,detail=''){
  const value=Math.max(0,Math.round(Number(minutes)||0));
  if(value>0) causes.push({label,minutes:value,detail});
}

function weatherSourceRecord(kind,label,{weather=null,routeWeather=null,timestamp=simNow(),from='',to='',delayMin=null}={}){
  const hazards=(routeWeather?.hazards||[]).slice(0,3).map(item=>({
    id:item.id,type:item.type,severity:item.severity,label:item.label,
    delayMin:Math.round(Number(item.delayMin)||0),
    distanceKm:Math.round(Number(item.distanceKm)||0)
  }));
  const routeDelay=routeWeather?Math.round(Number(delayMin??routeWeather.delayMin)||0):0;
  const weatherDelay=weather?Math.round(Number(delayMin??weather.delayMin)||0):0;
  return {
    kind,label,timestamp,
    airport:weather?.airport||'',
    from,to,
    conditions:routeWeather?.label||weather?.conditions||label,
    level:routeWeather?.level||weather?.level||'normal',
    delayMin:Math.max(0,routeWeather?routeDelay:weatherDelay),
    capacityPct:Number.isFinite(weather?.capacityFactor)?Math.round(weather.capacityFactor*100):null,
    validFrom:weather?.validFrom||0,
    validUntil:weather?.validUntil||0,
    nearbyCell:weather?.nearbyCell||null,
    hazards
  };
}

function weatherSourceText(source){
  if(!source) return '';
  const target=source.kind?.includes('route')
    ? [source.from,source.to].filter(Boolean).join(' → ')
    : source.airport||'airport';
  const when=Number.isFinite(source.timestamp)?` at ${formatTime(source.timestamp)}`:'';
  const capacity=Number.isFinite(source.capacityPct)?` · capacity ${source.capacityPct}%`:'';
  const cell=source.nearbyCell?.id?` · cell ${source.nearbyCell.id}`:'';
  const hazards=source.hazards?.length?` · ${source.hazards.map(item=>item.id).join(', ')}`:'';
  return `${source.label}${target?` ${target}`:''}${when}: ${source.conditions}${source.delayMin?` · +${source.delayMin}m`:''}${capacity}${cell}${hazards}`;
}

function weatherCauseText(cause){
  const sources=(cause?.sources||[]).filter(item=>item&&item.delayMin>0);
  if(!sources.length) return '';
  return sources.slice().sort((a,b)=>(b.delayMin||0)-(a.delayMin||0)).slice(0,2).map(weatherSourceText).join(' | ');
}

function setFlightWeatherCause(f,sources,appliedAt=simNow()){
  const active=sources.filter(item=>item&&item.delayMin>0);
  if(!active.length){
    f.weatherCause=null;
    f.weatherCode='';
    return null;
  }
  const ordered=active.slice().sort((a,b)=>(b.delayMin||0)-(a.delayMin||0));
  f.weatherCause={appliedAt,primary:ordered[0],sources:ordered};
  f.weatherCode=weatherCauseText(f.weatherCause);
  return f.weatherCause;
}

function appendFlightWeatherCause(f,source,appliedAt=simNow()){
  const existing=(f.weatherCause?.sources||[]).filter(item=>item&&item.kind!==source.kind);
  return setFlightWeatherCause(f,[...existing,source],appliedAt);
}

function slotMissContextForFlight(flight,previous=null){
  previous=previous||(previousAircraftFlight(flight)||null);
  if(previous&&flightOperationalDestination(previous)!==flight.from) previous=null;
  const cfg=AIRPORT_OPS[flight.from] || {graceMin:10};
  const graceMin=Number(cfg.graceMin)||10;
  const assignedSlot=flight.assignedSlot||flightActualDeparture(flight);
  const slotWaitMin=Math.max(0,Number(flight.slotDelayMin)||0);
  const readyAt=flight.slotMissed&&Number.isFinite(assignedSlot)
    ? assignedSlot-slotWaitMin*MIN
    : flightActualDeparture(flight);
  const graceUntil=flight.departure+graceMin*MIN;
  const causes=[];
  if(previous){
    const previousArrival=flightActualArrival(previous);
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    const inboundReady=previousArrival+(aircraft?minimumTurnMinutes(aircraft,flight.from):45)*MIN;
    addSlotCause(causes,'Late inbound / turn readiness',Math.ceil((inboundReady-flight.departure)/MIN),`${previous.id} available ${formatTime(inboundReady)}`);
  }else{
    addSlotCause(causes,'Turn readiness',flight.propagatedDelayMin,'Aircraft or ground phase ready after planned departure');
  }
  addSlotCause(causes,'Handling delay',flight.handlingDelayMin,flight.handlingDelayCause||'Ground handling not complete');
  addSlotCause(causes,'Technical delay',flight.technicalDelayMin,'Aircraft technical work before departure readiness');
  addSlotCause(causes,'Personnel shortfall',flight.staffingDelayMin,flight.staffingShortage||'Required crew or station personnel not ready');
  addSlotCause(causes,'Manual OCC hold',flight.manualDelayMin,'Dispatcher-entered departure hold');
  addSlotCause(causes,'Weather delay',(flight.weatherDelayMin||0)+(flight.liveWeatherDelayMin||0),weatherCauseText(flight.weatherCause)||flight.weatherCode||flight.weatherRouteHazard||'Weather impact on departure, arrival, or route');
  addSlotCause(causes,'Taxi-out delay',flight.taxiOutDelayMin,taxiCauseText(flight,'out')||'Taxi-out sequencing or surface movement delay');
  addSlotCause(causes,'Taxi-in delay',flight.taxiInDelayMin,taxiCauseText(flight,'in')||'Taxi-in sequencing or stand arrival delay');
  addSlotCause(causes,'Incident response',flight.incidentDelayMin,'Open incident coordination added delay');
  addSlotCause(causes,'Maintenance hold',flight.maintenanceDelayMin,'Maintenance availability or inspection hold');
  addSlotCause(causes,'Aircraft positioning',flight.positioningDelayMin,'Aircraft not available at the planned origin');
  addSlotCause(causes,'Airport flow restriction',flight.airportDelayMin,flight.airportConstraintLabel||'Departure airport flow restriction');
  addSlotCause(causes,'Airspace restriction',flight.airspaceDelayMin,flight.airspaceConstraintLabel||'Route or airspace flow restriction');
  addSlotCause(causes,'Night operations',flight.nightRestrictionDelayMin,flight.nightRestrictionLabel||'Curfew or night quota constraint');
  const primary=causes.slice().sort((a,b)=>b.minutes-a.minutes)[0];
  return {
    sourceId:flight.id,
    plannedSlot:flight.departure,
    graceUntil,
    graceMin,
    readyAt,
    assignedSlot,
    slotDelayMin:flightTotalDepartureDelayMin(flight),
    slotWaitMin,
    readinessLateMin:Math.max(0,Math.ceil((readyAt-graceUntil)/MIN)),
    primaryCause:primary?.label||'Unknown readiness delay',
    causeBreakdown:causes.slice(0,8),
    weatherCause:flight.weatherCause||null
  };
}

function airborneContextForFlight(flight,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const position=aircraft?currentAircraftPosition(aircraft,t):null;
  const destination=flightOperationalDestination(flight);
  return {
    sourceId:flight.id,
    phasePct:Math.round(flightProgress(flight,t)*100),
    destination,
    position:position?{lat:Math.round(position.lat*1000)/1000,lon:Math.round(position.lon*1000)/1000}:null,
    eta:flightActualArrival(flight)
  };
}

function fuelMarginContextForFlight(flight,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const destination=flightOperationalDestination(flight);
  const plan=flightFuelPlan(flight.from,destination,aircraft);
  const performance=aircraftFuelPerformance(MODELS[aircraft.model]);
  const progress=flightProgress(flight,t);
  const tripBurn=Number(flight.tripFuelGallons)||plan.tripBurnGal;
  const reserve=Number(flight.fuelReserveGallons)||plan.reserveGal;
  const onboard=Number(flight.fuelOnboardAtDeparture)||Number(aircraft.fuelGallons)||plan.requiredGal;
  const delayBurn=Math.max(0,Number(flight.enrouteDelayMin)||0)*performance.burnGalPerHour/60*.55;
  const recoveryBurn=Math.max(0,Number(flight.enrouteRecoveryFuelPenaltyGal)||0);
  const projectedLandingFuel=Math.max(0,onboard-tripBurn-delayBurn-recoveryBurn);
  const remainingNow=Math.max(0,onboard-tripBurn*progress-delayBurn*progress-recoveryBurn*progress);
  const marginRatio=reserve?projectedLandingFuel/reserve:1;
  return {
    ...airborneContextForFlight(flight,t),
    remainingNowGal:Math.round(remainingNow),
    projectedLandingFuelGal:Math.round(projectedLandingFuel),
    reserveGal:Math.round(reserve),
    marginPct:Math.round(marginRatio*100),
    delayBurnGal:Math.round(delayBurn+recoveryBurn),
    active:flight.departureLogged&&marginRatio<.7
  };
}

function holdingFuelConflictContextForFlight(flight,t=simNow()){
  const fuel=fuelMarginContextForFlight(flight,t);
  if(!fuel||!flightIsAirborne(flight,t)) return null;
  const holdingDelay=Math.max(0,Number(flight.enrouteDelayMin)||0);
  const active=holdingDelay>=20&&fuel.marginPct<115&&fuel.marginPct>=70;
  return {
    ...fuel,
    sourceId:flight.id,
    holdingDelayMin:holdingDelay,
    active
  };
}

function routeRerouteContextForFlight(flight,t=simNow()){
  const destination=flightOperationalDestination(flight);
  const routeWeather=window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,t)
    ||window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,destination,t);
  if(!routeWeather?.hazards?.length) return null;
  const delayMin=Math.min(45,Math.max(8,routeWeather.delayMin||0));
  const source=weatherSourceRecord('live_route','Live route weather',{routeWeather,timestamp:t,from:flight.from,to:destination,delayMin});
  return {
    ...airborneContextForFlight(flight,t),
    cause:routeWeather.label||'Route weather avoidance',
    delayMin,
    level:routeWeather.level,
    timestamp:t,
    weatherSource:source,
    weatherSummary:weatherSourceText(source),
    hazards:routeWeather.hazards.slice(0,3).map(item=>({
      id:item.id,type:item.type,severity:item.severity,label:item.label,delayMin:item.delayMin,
      distanceKm:Math.round(item.distanceKm||0),lat:item.lat,lon:item.lon,radiusKm:item.radiusKm
    }))
  };
}

function destinationWeatherContextForFlight(flight,t=simNow()){
  const destination=flightOperationalDestination(flight);
  const forecastAt=t+45*MIN;
  const weather=Management.weatherAt(destination,forecastAt);
  const source=weatherSourceRecord('live_destination_forecast','Destination forecast',{weather,timestamp:forecastAt});
  return {
    ...airborneContextForFlight(flight,t),
    airport:destination,
    conditions:weather.conditions,
    level:weather.level,
    capacityFactor:weather.capacityFactor,
    capacityPct:Math.round(weather.capacityFactor*100),
    delayMin:weather.delayMin,
    visibilityKm:weather.visibilityKm,
    ceilingFt:weather.ceilingFt,
    forecastAt,
    sourceKey:`destination-weather:${flight.id}:${destination}:${Math.floor(forecastAt/(3*HOUR))}`,
    weatherSource:source,
    weatherSummary:weatherSourceText(source)
  };
}

function destinationBelowMinimaContextForFlight(flight,t=simNow()){
  const context=destinationWeatherContextForFlight(flight,t);
  const lowVisibility=Number(context.visibilityKm)<=1.5;
  const lowCeiling=Number(context.ceilingFt)<=500;
  return {
    ...context,
    sourceId:flight.id,
    sourceKey:`destination-minima:${flight.id}:${context.airport}:${Math.floor((context.forecastAt||t)/(3*HOUR))}`,
    minima:`visibility ${context.visibilityKm} km / ceiling ${context.ceilingFt} ft`,
    active:Boolean((lowVisibility||lowCeiling)&&context.level!=='normal')
  };
}

function alternateSuitabilityContextForFlight(flight,t=simNow()){
  const destination=flightOperationalDestination(flight);
  const destinationWeather=Management.weatherAt(destination,t+45*MIN);
  const fakeIncident={flightId:flight.id,aircraftId:flight.aircraftId,selectedAlternate:''};
  const alternates=typeof diversionOptionsForIncident==='function'
    ? diversionOptionsForIncident(fakeIncident,{includeReturnOrigin:false})
    : [];
  const degradedDestination=destinationWeather.level!=='normal'&&(destinationWeather.delayMin>=15||destinationWeather.capacityFactor<.82);
  return {
    ...airborneContextForFlight(flight,t),
    sourceId:flight.id,
    sourceKey:`alternate-suitability:${flight.id}:${destination}:${Math.floor((t+45*MIN)/(3*HOUR))}`,
    airport:destination,
    conditions:destinationWeather.conditions,
    level:destinationWeather.level,
    capacityPct:Math.round(destinationWeather.capacityFactor*100),
    delayMin:destinationWeather.delayMin,
    availableAlternates:alternates.length,
    active:Boolean(degradedDestination&&alternates.length<=1)
  };
}

function aircraftOutOfPositionContextForFlight(flight,t=simNow()){
  if(!flight.positioningBlocked) return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const projection=aircraftRotationProjectionBeforeFlight(flight,t);
  const expectedLocation=projection.location || aircraft.location;
  return {
    sourceId:flight.id,
    aircraftId:aircraft.id,
    tail:aircraft.tail,
    expectedLocation,
    requiredLocation:flight.from,
    blockingFlightId:projection.blockedBy?.id||'',
    availableAt:projection.availableAt,
    delayMin:Math.max(15,Number(flight.positioningDelayMin)||15),
    active:expectedLocation!==flight.from
  };
}

function aircraftMispositionAfterDiversionContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||flight.flightType==='ferry'||t<flight.departure-8*HOUR) return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const previous=operationalIndex(t).previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  if(!aircraft||!previous||!previous.diversionAirport) return null;
  const divertedTo=flightOperationalDestination(previous);
  if(divertedTo===flight.from||!AIRPORTS[divertedTo]||!AIRPORTS[flight.from]) return null;
  const projection=aircraftRotationProjectionBeforeFlight(flight,t);
  const active=projection.location!==flight.from;
  if(!active) return null;
  const ferryDeparture=Math.max(t+15*MIN,flightActualArrival(previous)+20*MIN);
  const ferry=estimateFerryFlight(divertedTo,flight.from,aircraft,ferryDeparture);
  const readyAt=ferryDeparture+ferry.duration+minimumTurnMinutes(aircraft,flight.from)*MIN;
  return {
    sourceId:previous.id,
    previousFlightId:previous.id,
    aircraftId:aircraft.id,
    tail:aircraft.tail,
    expectedLocation:divertedTo,
    requiredLocation:flight.from,
    diversionAirport:divertedTo,
    sourceKey:`diversion-aircraft:${previous.id}:${flight.id}`,
    delayMin:Math.max(15,Math.ceil((readyAt-flight.departure)/MIN)),
    active:true
  };
}

function positioningFerryPlanState(incident,t=simNow()){
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight||!aircraft) return {ready:false,flight:null,aircraft:null,ferry:null,from:'',to:'',reason:'Affected flight or aircraft is no longer available.'};
  const context=aircraftOutOfPositionContextForFlight(flight,t)||incident.context||{};
  const departure=flightActualDeparture(flight);
  const projection=aircraftProjectedLocation(aircraft,departure);
  const from=context.expectedLocation||projection.location||aircraft.location;
  const to=flight.from;
  const ferry=state.flights
    .filter(item=>item.id!==flight.id&&!item.cancelled&&item.flightType==='ferry'&&item.aircraftId===aircraft.id&&item.from===from&&flightOperationalDestination(item)===to&&flightActualDeparture(item)<departure)
    .sort((a,b)=>flightActualArrival(b)-flightActualArrival(a))[0]||null;
  const ready=projection.location===to&&!['position_conflict','stale_unflown'].includes(projection.status);
  const reason=ready?'':ferry
    ? `${ferry.id} exists, but the aircraft is still not projected at ${to} before ${flight.id}. Adjust timing or schedule.`
    : `Create a ferry flight for ${aircraft.tail} from ${from} to ${to} before ${flight.id}.`;
  return {ready,flight,aircraft,ferry,from,to,projection,reason};
}

function crewMispositionAfterDiversionContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||flight.flightType==='ferry'||!returnReusesOutboundCrew(flight)||t<flight.departure-8*HOUR) return null;
  const previous=operationalIndex(t).previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  if(!previous||previous.serviceId!==flight.serviceId||!previous.diversionAirport) return null;
  const crewAirport=flightCrewReleaseAirport(previous);
  if(crewAirport===flight.from||!AIRPORTS[crewAirport]||!AIRPORTS[flight.from]) return null;
  const role='captains';
  const km=distanceKm(AIRPORTS[crewAirport],AIRPORTS[flight.from]);
  const readyAt=t+Math.max(90,Math.ceil(60+km/750*60))*MIN;
  return {
    sourceId:previous.id,
    previousFlightId:previous.id,
    role,
    from:crewAirport,
    to:flight.from,
    reason:`Through crew from ${previous.id} is at ${crewAirport} after diversion`,
    sourceKey:`diversion-crew:${previous.id}:${flight.id}`,
    readyAt,
    delayMin:Math.max(15,Math.ceil((readyAt-flight.departure)/MIN)),
    active:true
  };
}

function crewRelocationPlanState(incident,t=simNow()){
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
  if(!flight) return {ready:false,flight:null,from:'',to:'',role:'',transfer:null,reason:'Affected flight is no longer available.'};
  const role=incident.affectedRole||incident.context?.role||'captains';
  const from=incident.context?.from||incident.context?.crewAirport||'';
  const to=flight.from;
  const reportBy=flight.departure-20*MIN;
  const transfer=(state.personnelTransfers||[])
    .filter(item=>!['cancelled'].includes(item.status)&&item.role===role&&item.to===to&&(!from||item.from===from)&&item.amount>0)
    .sort((a,b)=>(a.arrival||Infinity)-(b.arrival||Infinity))[0]||null;
  const ready=Boolean(transfer&&transfer.status==='completed'&&(transfer.actualTo||transfer.to)===to) || Boolean(transfer&&transfer.arrival<=reportBy);
  const reason=ready
    ? `${transfer.id} positions ${PERSONNEL[role]?.label?.toLowerCase()||'crew'} to ${to} before report.`
    : transfer
      ? `${transfer.id} arrives ${formatTime(transfer.arrival)}, after the report window. Adjust timing or move another crew.`
      : `Move qualified ${PERSONNEL[role]?.label?.toLowerCase()||'crew'}${from?` from ${from}`:''} to ${to} in the Personnel widget.`;
  return {ready,flight,from,to,role,transfer,reason};
}

function legalCrewContextForFlight(flight,t=simNow()){
  if(!flight.staffingBlocked||flight.flightType==='ferry') return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const departure=Math.max(flight.departure,t);
  const deficits=personnelDeficitsForFlight(aircraft,departure,flight.arrival-flight.departure,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType);
  const crewDeficits=deficits.filter(item=>['captains','firstOfficers','cabinCrew'].includes(item.role));
  if(!crewDeficits.length) return null;
  const primary=crewDeficits[0];
  return {
    sourceId:flight.id,
    role:primary.role,
    shortage:crewDeficits.map(item=>`${PERSONNEL[item.role].label}${item.qualification?` rated ${item.qualification}`:''}: ${item.available}/${item.required}`).join(' · '),
    delayMin:Math.max(15,Number(flight.staffingDelayMin)||15),
    active:true
  };
}

function crewFatigueMidRotationContextForFlight(flight){
  if(flight.flightType==='ferry'||flight.crewAugmented||flight.crewDutySplit||flight.serviceLeg!=='return'||!returnReusesOutboundCrew(flight)) return null;
  const duty=crewDutyForFlight(flight);
  const active=duty.legal&&duty.remainingHours>=0&&duty.remainingHours<1&&flightTotalDepartureDelayMin(flight)>=20;
  return {
    sourceId:flight.id,
    role:'captains',
    dutyHours:duty.dutyHours,
    maxHours:duty.maxHours,
    remainingHours:duty.remainingHours,
    label:`${duty.remainingHours.toFixed(1)} h duty margin remains after current delay`,
    active
  };
}

function addCrewDutyDelayCause(causes,label,minutes,detail=''){
  const value=Math.max(0,Math.round(Number(minutes)||0));
  if(value>0) causes.push({label,minutes:value,detail});
}

function crewDutyExtensionDelayCauses(duty){
  const causes=[];
  for(const flightId of duty?.flightIds||[]){
    const flight=state.flights.find(item=>item.id===flightId);
    if(!flight||flight.cancelled) continue;
    const prefix=flight.id;
    addCrewDutyDelayCause(causes,'Manual OCC hold',flight.manualDelayMin,`${prefix}: dispatcher-entered hold`);
    addCrewDutyDelayCause(causes,'Incident response',flight.incidentDelayMin,`${prefix}: incident coordination delay`);
    addCrewDutyDelayCause(causes,'Weather delay',(flight.weatherDelayMin||0)+(flight.liveWeatherDelayMin||0),`${prefix}: ${weatherCauseText(flight.weatherCause)||flight.weatherCode||flight.weatherRouteHazard||'weather impact'}`);
    addCrewDutyDelayCause(causes,'Enroute delay',flight.enrouteDelayMin,`${prefix}: airborne routing, holding, or flight-watch impact`);
    addCrewDutyDelayCause(causes,'Airport flow restriction',flight.airportDelayMin,`${prefix}: ${flight.airportConstraintLabel||'airport flow restriction'}`);
    addCrewDutyDelayCause(causes,'Airspace restriction',flight.airspaceDelayMin,`${prefix}: ${flight.airspaceConstraintLabel||'route or airspace flow restriction'}`);
    addCrewDutyDelayCause(causes,'Taxi delay',(flight.taxiOutDelayMin||0)+(flight.taxiInDelayMin||0),`${prefix}: ${taxiCauseText(flight,'out')||taxiCauseText(flight,'in')||'surface movement delay'}`);
    addCrewDutyDelayCause(causes,'Late inbound / turn readiness',flight.propagatedDelayMin,`${prefix}: aircraft or crew rotation delayed`);
    addCrewDutyDelayCause(causes,'Slot delay',flight.slotDelayMin,`${prefix}: regulated departure slot moved`);
    addCrewDutyDelayCause(causes,'Night operations',flight.nightRestrictionDelayMin,`${prefix}: ${flight.nightRestrictionLabel||'night restriction'}`);
  }
  return causes.sort((a,b)=>b.minutes-a.minutes).slice(0,8);
}

function nextCrewDutyFlightAfter(flight,duty){
  const ordered=(duty?.flightIds||[])
    .map(id=>state.flights.find(item=>item.id===id&&!item.cancelled))
    .filter(Boolean)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||a.id.localeCompare(b.id));
  return ordered.find(item=>item.id!==flight.id&&flightActualDeparture(item)>flightActualDeparture(flight)&&!item.departureLogged)||null;
}

function crewDutyExtensionProjectionForFlight(flight){
  const rotation=rotationForFlight(flight);
  const pair=rotation.outbound&&rotation.returnFlight&&!rotation.outbound.crewDutySplit&&!rotation.returnFlight.crewDutySplit;
  if(pair){
    const augmented=Boolean(rotation.outbound.crewAugmented);
    const planned=OperationalIntelligence.crewDutyAssessment({
      departure:rotation.outbound.departure,arrival:rotation.returnFlight.arrival,sectors:2,augmented
    });
    const actual=OperationalIntelligence.crewDutyAssessment({
      departure:flightActualDeparture(rotation.outbound),arrival:flightActualArrival(rotation.returnFlight),sectors:2,augmented
    });
    if(planned.legal){
      return {
        id:`CD-${rotation.outbound.id}-${rotation.returnFlight.id}`,
        flightIds:[rotation.outbound.id,rotation.returnFlight.id],
        dutyStart:actual.dutyStart,dutyEnd:actual.dutyEnd,releaseAt:actual.dutyEnd,
        maxHours:actual.maxHours,dutyHours:actual.dutyHours,remainingHours:actual.remainingHours,
        legal:actual.legal,label:actual.label,sectors:2,augmented
      };
    }
  }
  const actual=OperationalIntelligence.crewDutyAssessment({
    departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),sectors:1,augmented:Boolean(flight.crewAugmented)
  });
  return {
    id:flight.crewDutyId||`CD-${flight.id}`,flightIds:[flight.id],
    dutyStart:actual.dutyStart,dutyEnd:actual.dutyEnd,releaseAt:actual.dutyEnd,
    maxHours:actual.maxHours,dutyHours:actual.dutyHours,remainingHours:actual.remainingHours,
    legal:actual.legal,label:actual.label,sectors:1,augmented:Boolean(flight.crewAugmented)
  };
}

function crewDutyExtensionContextForFlight(flight,t=simNow()){
  if(!flightIsAirborne(flight,t)||flight.flightType==='ferry') return null;
  const duty=crewDutyExtensionProjectionForFlight(flight);
  if(!duty||duty.legal||!Number.isFinite(duty.dutyStart)||!Number.isFinite(duty.maxHours)) return null;
  const dutyLimitAt=duty.dutyStart+duty.maxHours*HOUR;
  const overrunMin=Math.ceil(((duty.releaseAt||duty.dutyEnd)-dutyLimitAt)/MIN);
  if(overrunMin<10) return null;
  const causes=crewDutyExtensionDelayCauses(duty);
  if(!causes.length) return null;
  const nextFlight=nextCrewDutyFlightAfter(flight,duty);
  return {
    ...airborneContextForFlight(flight,t),
    sourceId:flight.id,
    dutyId:duty.id,
    dutyStart:duty.dutyStart,
    projectedRelease:duty.releaseAt||duty.dutyEnd,
    dutyLimitAt,
    overrunMin,
    dutyHours:Number(duty.dutyHours||0),
    maxHours:Number(duty.maxHours||0),
    primaryCause:causes[0]?.label||'Operational delay',
    causeBreakdown:causes,
    nextFlightId:nextFlight?.id||'',
    nextFlightDeparture:nextFlight?flightActualDeparture(nextFlight):0,
    nextFlightOrigin:nextFlight?.from||'',
    active:true
  };
}

function airportCapacityContextForFlight(flight,t=simNow()){
  const delayMin=Math.max(0,Number(flight.airportDelayMin)||0);
  if(delayMin<15) return null;
  const weather=Management.weatherAt(flight.from,flightActualDeparture(flight));
  return {
    sourceId:flight.id,
    airport:flight.from,
    delayMin,
    reason:flight.airportConstraintLabel||'Airport flow restriction',
    capacityPct:Math.round(weather.capacityFactor*100),
    weather:weather.conditions,
    active:true
  };
}

function deicingContextForFlight(flight,t=simNow()){
  if(flight.flightType==='ferry'||flight.deicingCompletedAt||flight.departureLogged) return null;
  const weather=Management.weatherAt(flight.from,Math.max(t,flight.departure-30*MIN));
  const active=weather.type==='snow'||/snow|ice|deicing/i.test(weather.conditions||'');
  if(!active) return null;
  return {
    sourceId:flight.id,
    airport:flight.from,
    conditions:weather.conditions,
    level:weather.level,
    delayMin:Math.max(20,weather.delayMin||20),
    capacityPct:Math.round(weather.capacityFactor*100),
    active:true
  };
}

function deicingCapacityCollapseContextForFlight(flight,t=simNow()){
  const base=deicingContextForFlight(flight,t);
  if(!base||t<flight.departure-4*HOUR) return null;
  const airport=flight.from;
  const windowStart=flight.departure-90*MIN;
  const windowEnd=flight.departure+90*MIN;
  const demand=state.flights.filter(item=>{
    if(item.cancelled||item.settled||item.departureLogged||item.from!==airport||item.id===flight.id) return false;
    if(item.departure<windowStart||item.departure>windowEnd) return false;
    const weather=Management.weatherAt(airport,Math.max(t,item.departure-30*MIN));
    return weather.type==='snow'||/snow|ice|deicing/i.test(weather.conditions||'');
  }).length+1;
  const severe=base.level==='severe'||Number(base.capacityPct||100)<72;
  const congested=['LHR','JFK','AMS','CDG','HND','ORD','FRA','MUC','ZRH','ARN','CPH','OSL','YYZ','BOS','DEN'].includes(airport);
  const active=demand>=4 || (demand>=3&&(severe||congested));
  if(!active) return null;
  const queueMin=Math.max(35,Math.round((base.delayMin||20)+demand*12+(severe?20:0)));
  return {
    ...base,
    sourceId:flight.id,
    demand,
    queueMin,
    delayMin:queueMin,
    reason:`${demand} departures need deicing in the local queue`,
    sourceKey:`deice-collapse:${airport}:${Math.floor(flight.departure/(2*HOUR))}`,
    active:true
  };
}

function holdoverExpiredContextForFlight(flight,t=simNow()){
  if(!flight.deicingCompletedAt||flight.departureLogged) return null;
  const windowMin=35;
  const expiresAt=flight.deicingCompletedAt+windowMin*MIN;
  const active=t>=expiresAt&&flightActualDeparture(flight)>expiresAt;
  if(!active) return null;
  const weather=Management.weatherAt(flight.from,t);
  return {
    sourceId:flight.id,
    airport:flight.from,
    deicedAt:flight.deicingCompletedAt,
    expiresAt,
    holdoverMin:windowMin,
    conditions:weather.conditions,
    active
  };
}

function postflightTechnicalContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||flight.flightType==='ferry') return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const previous=previousAircraftFlight(flight);
  if(!aircraft||!inboundAircraftReadyForPostflightInspection(previous,flight.from,t)) return null;
  const previousArrival=flightActualArrival(previous);
  if(previousArrival<t-4*HOUR) return null;
  const inspectionRequired=Boolean(previous.arrivalInspectionRequired||aircraft.arrivalInspectionRequired);
  const poorCondition=(aircraft.condition??100)<76;
  const maintenanceDue=Boolean(Management.maintenanceStatus(aircraft,t)?.due);
  const active=inspectionRequired||poorCondition||maintenanceDue;
  if(!active) return null;
  const reason=inspectionRequired?'arrival inspection required':poorCondition?'low aircraft condition':'scheduled maintenance due after inbound';
  return {
    sourceId:previous.id,
    previousFlightId:previous.id,
    aircraftId:aircraft.id,
    tail:aircraft.tail,
    arrivedAt:previousArrival,
    condition:Math.round(aircraft.condition??100),
    reason,
    delayMin:inspectionRequired?35:maintenanceDue?60:45,
    active:true
  };
}

function crewMisconnectContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||flight.flightType==='ferry'||t<flight.departure-8*HOUR) return null;
  const activeTransfers=(state.personnelTransfers||[]).filter(item=>
    !['completed','cancelled'].includes(item.status)&&item.to===flight.from&&['captains','firstOfficers','cabinCrew'].includes(item.role)
  );
  if(!activeTransfers.length) return null;
  const shortage=legalCrewContextForFlight(flight,t);
  if(!shortage) return null;
  const reportBuffer=20*MIN;
  const late=activeTransfers
    .map(item=>({...item,readyAt:(item.arrival||0)+reportBuffer,delayMin:Math.ceil(((item.arrival||0)+reportBuffer-flight.departure)/MIN)}))
    .filter(item=>item.delayMin>0&&item.delayMin<8*60)
    .sort((a,b)=>a.readyAt-b.readyAt)[0];
  if(!late) return null;
  return {
    sourceId:late.id,
    transferId:late.id,
    role:late.role,
    from:late.from,
    to:late.to,
    method:late.method,
    transferFlightId:late.flightId||'',
    arrival:late.arrival,
    readyAt:late.readyAt,
    delayMin:Math.max(15,late.delayMin),
    shortage:shortage.shortage,
    active:true
  };
}

function atcGroundStopContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||t<flight.departure-6*HOUR) return null;
  const destination=flightOperationalDestination(flight);
  const departureWeather=Management.weatherAt(flight.from,Math.max(t,flight.departure));
  const destinationWeather=Management.weatherAt(destination,flightActualArrival(flight));
  const airspaceDelay=Math.max(0,Number(flight.airspaceDelayMin)||0);
  const airportDelay=Math.max(0,Number(flight.airportDelayMin)||0);
  const severeDestination=destinationWeather.level==='severe'&&destinationWeather.capacityFactor<.72;
  const severeDeparture=departureWeather.level==='severe'&&departureWeather.capacityFactor<.65;
  const active=severeDestination||severeDeparture||airspaceDelay>=35||airportDelay>=45;
  if(!active) return null;
  const reason=severeDestination?`${destination} ${destinationWeather.conditions}`:
    severeDeparture?`${flight.from} ${departureWeather.conditions}`:
      airspaceDelay>=35?(flight.airspaceConstraintLabel||'Airspace flow restriction'):(flight.airportConstraintLabel||'Airport ground stop');
  return {
    sourceId:flight.id,
    airport:severeDeparture?flight.from:destination,
    reason,
    departureConditions:departureWeather.conditions,
    destinationConditions:destinationWeather.conditions,
    delayMin:Math.max(35,airspaceDelay,airportDelay,destinationWeather.delayMin||0,departureWeather.delayMin||0),
    active:true
  };
}

function performanceLimitCauseForContext(context={}){
  if(context.performanceCause) return context.performanceCause;
  if(Number(context.rangeMarginKm)<0) return 'range';
  if(Number(context.fuelMarginGal)<0) return 'fuel';
  if(Number(context.melPenalty)>0) return 'mel';
  const weather=String(context.weather||context.conditions||'').toLowerCase();
  if(context.weatherLevel==='severe'||context.weatherLevel==='caution'||/wind|storm|rain|snow|ice|visibility|ceiling|runway/.test(weather)) return 'weather';
  return 'margin';
}

function performanceLimitContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||t<flight.departure-8*HOUR) return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const destination=flightOperationalDestination(flight);
  const model=MODELS[aircraft.model];
  const plan=flightFuelPlan(flight.from,destination,aircraft);
  const performance=aircraftFuelPerformance(model);
  const routeKm=distanceKm(AIRPORTS[flight.from],AIRPORTS[destination]);
  const melPenalty=(aircraft.melItems||[]).filter(item=>item.status!=='closed').reduce((sum,item)=>sum+(Number(item.performancePenalty)||0),0);
  const weather=Management.weatherAt(flight.from,Math.max(t,flight.departure));
  const weatherPenalty=weather.type==='wind'||weather.level==='severe'?0.08:weather.level==='caution'?0.04:0;
  const usableRange=model.maxRangeKm*Math.max(.72,.94-melPenalty-weatherPenalty);
  const rangeMarginKm=usableRange-routeKm;
  const fuelMarginGal=performance.fuelCapacityGal-plan.requiredGal;
  const active=rangeMarginKm<180||fuelMarginGal<performance.fuelCapacityGal*.08;
  if(!active) return null;
  const payloadReductionPct=clamp(Math.ceil((Math.max(0,180-rangeMarginKm)/Math.max(1,routeKm))*100+8),8,22);
  const performanceCause=performanceLimitCauseForContext({rangeMarginKm,fuelMarginGal,melPenalty,weather:weather.conditions,weatherLevel:weather.level});
  return {
    sourceId:flight.id,
    routeKm:Math.round(routeKm),
    usableRangeKm:Math.round(usableRange),
    rangeMarginKm:Math.round(rangeMarginKm),
    fuelRequiredGal:Math.round(plan.requiredGal),
    fuelCapacityGal:Math.round(performance.fuelCapacityGal),
    fuelMarginGal:Math.round(fuelMarginGal),
    weather:weather.conditions,
    weatherLevel:weather.level,
    melPenalty,
    performanceCause,
    delayUseful:performanceCause==='weather',
    payloadReductionUseful:flight.flightType!=='ferry'&&Number(flight.pax||0)>0&&['range','fuel','mel','margin'].includes(performanceCause),
    payloadReductionPct,
    delayMin:weather.level==='normal'?20:45,
    active:true
  };
}

function performanceLimitIncidentRequired(context){
  if(!context?.active) return false;
  return Number(context.rangeMarginKm)<0||Number(context.fuelMarginGal)<0||Number(context.payloadReductionPct)>=18;
}

function destinationHandlingContextForFlight(flight,t=simNow()){
  if(flight.flightType==='ferry'||t<flight.departure-6*HOUR||flight.settled) return null;
  const destination=flightOperationalDestination(flight);
  if(flight.diversionAirport){
    const plan=typeof destinationHandlingPlanForFlight==='function'
      ? destinationHandlingPlanForFlight(flight,{airport:destination,t,reason:'Diversion arrival handling',ensure:true})
      : null;
    const available=Boolean(plan?.available);
    if(available) return null;
    return {
      sourceId:flight.id,
      airport:destination,
      handling:0,
      handlingPlan:plan,
      contractedStation:plan?.source==='contract',
      reason:plan?.label||'No own-station or contract handler is available',
      delayMin:flight.departureLogged?25:35,
      active:true
    };
  }
  const trackedStation=Boolean(state.personnel.assignments?.[destination]);
  const handling=staffAt(destination,'groundHandling');
  const relevant=trackedStation||Boolean(flight.diversionAirport);
  if(!relevant||handling>0) return null;
  return {
    sourceId:flight.id,
    airport:destination,
    handling,
    handlingPlan:null,
    contractedStation:!trackedStation,
    reason:'No destination handling team is assigned',
    delayMin:flight.departureLogged?25:35,
    active:true
  };
}

function destinationHandlingIncidentRequired(flight,context){
  if(!context?.active||!flight) return false;
  return Boolean((flight.departureLogged||flight.diversionAirport)&&!context.handlingPlan?.available);
}

function diversionAirportUnavailableContextForFlight(flight,t=simNow()){
  if(!flight.diversionAirport||!flightIsAirborne(flight,t)) return null;
  const airport=flight.diversionAirport;
  const arrivalAt=Math.max(t,Number(flightActualArrival(flight))||t+30*MIN);
  const weather=Management.weatherAt(airport,arrivalAt);
  const fallbackStaff=staffAt(airport,'groundHandling');
  const handlingAvailability=typeof diversionHandlingAvailability==='function'
    ? diversionHandlingAvailability(airport,t)
    : {available:fallbackStaff>0,source:fallbackStaff>0?'station':'none',staff:fallbackStaff,label:fallbackStaff>0?`own station handling · ${fallbackStaff} team${fallbackStaff===1?'':'s'}`:'no modeled diversion handler'};
  const weatherBlocked=weather.level==='severe';
  const handlingBlocked=!handlingAvailability.available;
  const active=weatherBlocked||handlingBlocked;
  if(!active) return null;
  const reasons=[
    weatherBlocked?`${airport} weather deteriorated below acceptance`:null,
    handlingBlocked?`${airport} ${handlingAvailability.label||'handling no longer available'}`:null
  ].filter(Boolean);
  return {
    ...airborneContextForFlight(flight,t),
    sourceId:flight.id,
    airport,
    conditions:weather.conditions,
    level:weather.level,
    forecastAt:arrivalAt,
    capacityPct:Math.round(weather.capacityFactor*100),
    handling:fallbackStaff,
    handlingAvailable:Boolean(handlingAvailability.available),
    handlingSource:handlingAvailability.source,
    handlingLabel:handlingAvailability.label,
    reason:reasons.join(' · '),
    active:true
  };
}

function maybeDetectLightningStrike(flight,t=simNow()){
  if(!flightIsAirborne(flight,t)||flight.flightType==='ferry') return false;
  if(state.incidents.some(item=>item.flightId===flight.id&&item.type==='lightning_strike')) return false;
  flight.weatherLiveChecks??={};
  flight.weatherLiveChecks.lightningCheckedCells??=[];
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const position=aircraft?currentAircraftPosition(aircraft,t):null;
  const cells=(window.AeroWeatherEngine?.cellsAtPoint?.(position,t)||[]).filter(cell=>cell.type==='storm');
  for(const cell of cells){
    const key=`${cell.id}:${Math.floor(t/(30*MIN))}`;
    if(flight.weatherLiveChecks.lightningCheckedCells.includes(key)) continue;
    flight.weatherLiveChecks.lightningCheckedCells.push(key);
    const risk=cell.severity==='severe' ? .42 : .16;
    const roll=window.AeroWeatherEngine?.stableUnit?.(`${flight.id}:${key}:lightning`)??1;
    if(roll>=risk) continue;
    const incident=createIncident('lightning_strike',flight,{detectedAt:t,source:'weather',sourceKey:`lightning:${flight.id}:${cell.id}`,context:{
      ...airborneContextForFlight(flight,t),
      cellId:cell.id,conditions:cell.label,severity:cell.severity,delayMin:cell.delayMin,
      position:position?{lat:Math.round(position.lat*1000)/1000,lon:Math.round(position.lon*1000)/1000}:null
    }});
    return Boolean(incident);
  }
  return false;
}

function resolveIncidentImpacts(incident,t=simNow(),status='handled'){
  if(!incident?.impacts?.length) return;
  for(const impact of incident.impacts){
    if(['handled','accepted','cleared'].includes(impact.status)) continue;
    impact.status=status;
    impact.resolvedAt=t;
  }
}

function nearestDiversionAirport(f,ac){
  return Object.keys(AIRPORTS)
    .filter(code=>code!==f.to&&code!==f.from)
    .map(code=>({code,fromOrigin:distanceKm(AIRPORTS[f.from],AIRPORTS[code]),fromDestination:distanceKm(AIRPORTS[f.to],AIRPORTS[code])}))
    .filter(item=>item.fromOrigin<=MODELS[ac.model].maxRangeKm)
    .sort((a,b)=>a.fromDestination-b.fromDestination)[0]?.code||null;
}

function incidentReplacementCandidates(f){
  if(f.serviceId) return rotationReplacementCandidates(f);
  const duration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
  const destination=flightOperationalDestination(f);
  return state.aircraft.filter(ac=>{
    if(ac.id===f.aircraftId||ac.location!==f.from||aircraftIsDefective(ac)) return false;
    if(!estimateFlight(f.from,destination,ac,f.fares||f.fare,{departure:f.departure}).rangeOk) return false;
    return validateAircraftItinerary(ac,[{from:f.from,to:destination,departure:f.departure,arrival:f.departure+duration,label:f.id}]).ok;
  });
}

function replacementLegsForFlight(f,ac,delayMin=0){
  const departure=f.departure+delayMin*MIN;
  const duration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
  const legs=[{from:f.from,to:flightOperationalDestination(f),departure,arrival:departure+duration,label:f.id}];
  const {service,outbound,returnFlight}=rotationForFlight(f);
  if(service&&outbound&&returnFlight&&f.id===outbound.id){
    const returnDelay=Math.max(0,Math.ceil(Math.max(0,legs[0].arrival+minimumTurnMinutes(ac,returnFlight.from)*MIN-returnFlight.departure)/MIN));
    const returnDeparture=returnFlight.departure+returnDelay*MIN;
    const returnDuration=Number.isFinite(returnFlight.operationalDurationMs)?returnFlight.operationalDurationMs:returnFlight.arrival-returnFlight.departure;
    legs.push({from:returnFlight.from,to:flightOperationalDestination(returnFlight),departure:returnDeparture,arrival:returnDeparture+returnDuration,label:returnFlight.id});
  }
  return legs;
}

function aircraftReplacementCommitment(ac,excludeServiceId=''){
  const now=simNow();
  const futureFlights=state.flights.filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&flightActualArrival(f)>now);
  const activeServices=state.services.filter(s=>s.active&&s.id!==excludeServiceId&&s.aircraftId===ac.id);
  return {
    futureFlights,
    activeServices,
    borrowed:Boolean(futureFlights.length||activeServices.length)
  };
}

function plannedReplacementFerryOptions(ac,target,serviceId=''){
  const now=simNow();
  return state.flights
    .filter(ferry=>
      ferry.aircraftId===ac.id &&
      ferry.flightType==='ferry' &&
      !ferry.cancelled &&
      !ferry.settled &&
      ferry.id!==target.id &&
      flightOperationalDestination(ferry)===target.from &&
      flightActualArrival(ferry)>now &&
      flightActualArrival(ferry)<=target.departure+8*HOUR
    )
    .map(ferry=>{
      const readyAt=flightActualArrival(ferry)+minimumTurnMinutes(ac,target.from)*MIN;
      const delayMin=Math.max(0,Math.ceil((readyAt-target.departure)/(15*MIN))*15);
      const proposed=replacementLegsForFlight(target,ac,delayMin);
      const itinerary=validateAircraftItinerary(ac,proposed);
      if(!itinerary.ok) return null;
      const commitment=aircraftReplacementCommitment(ac,serviceId);
      const borrowed=commitment.futureFlights.some(item=>item.id!==ferry.id&&item.flightType!=='ferry')||commitment.activeServices.length>0;
      const impact=borrowed?'Planned ferry, borrowed from later schedule':'Planned ferry';
      return {
        id:`planned:${ferry.id}:${ac.id}`,aircraftId:ac.id,tail:ac.tail,model:ac.model,mode:'planned',kind:borrowed?'borrow':'spare',
        impact,from:ferry.from,delayMin,ferryId:ferry.id,ferryDeparture:flightActualDeparture(ferry),ferryArrival:flightActualArrival(ferry),
        label:`${ac.tail} · ${ac.model} via ${ferry.id}`,detail:`${impact} ${ferry.id}; arrives ${formatTime(flightActualArrival(ferry))}${delayMin?` · delays departure ${delayMin} min`:' · ready before departure'}.`
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.delayMin-b.delayMin||a.ferryArrival-b.ferryArrival||a.tail.localeCompare(b.tail));
}

function incidentAircraftReplacementOptions(incident){
  const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
  if(!flight||flight.departureLogged||flight.fueled) return [];
  const {service,outbound}=rotationForFlight(flight);
  const target=service&&outbound?outbound:flight;
  if(target.fueled||target.departureLogged) return [];
  const now=simNow();
  return state.aircraft.map(ac=>{
    if(ac.id===target.aircraftId||aircraftIsDefective(ac,now)) return null;
    const mainEstimate=estimateFlight(target.from,flightOperationalDestination(target),ac,target.fares||target.fare,{departure:target.departure});
    if(!mainEstimate.rangeOk) return null;
    const commitment=aircraftReplacementCommitment(ac,service?.id||'');
    const kind=commitment.borrowed?'borrow':'spare';
    const impact=commitment.borrowed?'Borrow from later schedule':'Clean spare';

    const planned=plannedReplacementFerryOptions(ac,target,service?.id||'');
    if(planned.length) return planned[0];

    if(ac.location===target.from){
      const proposed=replacementLegsForFlight(target,ac,0);
      if(validateAircraftItinerary(ac,proposed).ok){
        return {id:`local:${ac.id}`,aircraftId:ac.id,tail:ac.tail,model:ac.model,mode:'local',kind,impact,from:ac.location,delayMin:0,
          label:`${ac.tail} · ${ac.model} at ${target.from}`,detail:`${impact}; itinerary remains valid.`};
      }
      return null;
    }

    const ferryDeparture=now+15*MIN;
    const ferry=estimateFerryFlight(ac.location,target.from,ac,ferryDeparture);
    if(!ferry.rangeOk) return null;
    const readyAt=ferryDeparture+ferry.duration+minimumTurnMinutes(ac,target.from)*MIN;
    const delayMin=Math.max(0,Math.ceil((readyAt-target.departure)/(15*MIN))*15);
    const proposed=[
      {from:ac.location,to:target.from,departure:ferryDeparture,arrival:ferryDeparture+ferry.duration,label:`position ${ac.tail}`}
    ].concat(replacementLegsForFlight(target,ac,delayMin));
    if(!validateAircraftItinerary(ac,proposed).ok) return null;
    return {id:`position:${ac.id}`,aircraftId:ac.id,tail:ac.tail,model:ac.model,mode:'position',kind,impact,from:ac.location,delayMin,
      ferryDeparture,ferryArrival:ferryDeparture+ferry.duration,
      label:`${ac.tail} · ${ac.model} from ${ac.location}`,detail:`${impact}; positioning flight to ${target.from}${delayMin?` · delays departure ${delayMin} min`:''}.`};
  }).filter(Boolean).sort((a,b)=>a.delayMin-b.delayMin||a.tail.localeCompare(b.tail)).slice(0,8);
}

function incidentAircraftReplacementOptionsForTask(incident,task=null){
  if(incident?.type!=='fuel_supplier_outage') return incidentAircraftReplacementOptions(incident);
  return fuelSupplierReplacementOptions(incident);
}

function fuelSupplierTargetFlight(incident){
  const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
  if(!flight) return null;
  const {service,outbound}=rotationForFlight(flight);
  return service&&outbound?outbound:flight;
}

function fuelSupplierReplacementOptions(incident){
  const target=fuelSupplierTargetFlight(incident);
  if(!target||target.departureLogged||target.fueled) return [];
  return incidentAircraftReplacementOptions(incident).filter(option=>{
    if(option.mode!=='local') return false;
    const aircraft=state.aircraft.find(item=>item.id===option.aircraftId);
    if(!aircraft) return false;
    const plan=flightFuelPlan(target.from,flightOperationalDestination(target),aircraft);
    return (Number(aircraft.fuelGallons)||0)>=plan.requiredGal;
  }).map(option=>({
    ...option,
    detail:`${option.impact}; fuel already onboard for ${target.from}-${flightOperationalDestination(target)}.`
  }));
}

function fuelOutageTankerPlan(incident){
  const target=fuelSupplierTargetFlight(incident);
  const aircraft=target&&state.aircraft.find(item=>item.id===target.aircraftId);
  if(!target||!aircraft) return {available:false,reason:'The affected flight or aircraft is no longer available.'};
  if(target.cancelled||target.departureLogged) return {available:false,reason:'Tanker fuel is only useful before the affected flight departs.'};
  if(target.fueled) return {available:false,reason:'The affected flight is already fueled.'};
  const targetPlan=flightFuelPlan(target.from,flightOperationalDestination(target),aircraft);
  const onboard=Math.max(0,Number(aircraft.fuelGallons)||0);
  if(aircraft.location===target.from&&onboard>=targetPlan.requiredGal){
    return {
      available:true,mode:'onboard',targetFlight:target,aircraft,targetPlan,
      targetFuelGal:targetPlan.requiredGal,delayMin:0,extraFuelGal:0,cost:0,
      reason:`${aircraft.tail} already has enough onboard fuel for ${target.from}-${flightOperationalDestination(target)}.`
    };
  }
  const previous=previousAircraftFlight(target);
  if(!previous||previous.cancelled||flightOperationalDestination(previous)!==target.from){
    return {available:false,reason:'No inbound leg reaches the disrupted station before this flight.'};
  }
  if(previous.departureLogged){
    return {available:false,reason:`${previous.id} has already departed, so extra tanker fuel can no longer be loaded upstream.`};
  }
  const previousPlan=flightFuelPlan(previous.from,flightOperationalDestination(previous),aircraft);
  const combinedFuelGal=Math.ceil(previousPlan.tripBurnGal+targetPlan.requiredGal);
  const usableCapacity=Math.floor(targetPlan.fuelCapacityGal*.96);
  if(combinedFuelGal>usableCapacity){
    return {available:false,reason:`${aircraft.tail} cannot carry enough fuel for ${previous.id} plus the next sector without exceeding practical tank capacity.`};
  }
  const extraFuelGal=Math.max(0,combinedFuelGal-onboard);
  const cost=Math.round(extraFuelGal*(state.fuelMarket?.pricePerGallon||FUEL_MARKET_BASE_EUR_GAL)*1.08+450);
  return {
    available:true,mode:'previous_leg',targetFlight:target,previousFlight:previous,aircraft,targetPlan,previousPlan,
    previousFlightId:previous.id,combinedFuelGal,targetFuelGal:targetPlan.requiredGal,extraFuelGal,cost,delayMin:10,
    reason:`Load tanker fuel on ${previous.id}; ${aircraft.tail} should arrive at ${target.from} with enough fuel for ${target.id}.`
  };
}

function applyFuelOutageTankerPlan(incident){
  const plan=fuelOutageTankerPlan(incident);
  if(!plan.available) return toast(plan.reason);
  const flight=plan.targetFlight, aircraft=plan.aircraft;
  if(plan.mode==='previous_leg'&&plan.previousFlight){
    const previous=plan.previousFlight;
    const purchased=Math.max(0,Math.ceil(plan.combinedFuelGal-(Number(aircraft.fuelGallons)||0)));
    aircraft.fuelGallons=Math.max(Number(aircraft.fuelGallons)||0,plan.combinedFuelGal);
    previous.fueled=true;
    previous.fuelOnboardAtDeparture=aircraft.fuelGallons;
    previous.fuelRequiredGallons=plan.previousPlan.requiredGal;
    previous.tripFuelGallons=plan.previousPlan.tripBurnGal;
    previous.fuelReserveGallons=plan.previousPlan.reserveGal;
    previous.fuelCapacityGallons=plan.previousPlan.fuelCapacityGal;
    previous.fuelPurchasedGallons=(Number(previous.fuelPurchasedGallons)||0)+purchased;
    previous.fuelPricePerGallon=state.fuelMarket?.pricePerGallon||FUEL_MARKET_BASE_EUR_GAL;
    previous.tankerFuelForFlightId=flight.id;
  }
  flight.fueled=true;
  flight.fueledAt=simNow();
  flight.fuelGallons=0;
  flight.fuelPurchasedGallons=0;
  flight.fuelRequiredGallons=plan.targetPlan.requiredGal;
  flight.fuelOnboardAtDeparture=plan.targetFuelGal;
  flight.tripFuelGallons=plan.targetPlan.tripBurnGal;
  flight.fuelReserveGallons=plan.targetPlan.reserveGal;
  flight.fuelCapacityGallons=plan.targetPlan.fuelCapacityGal;
  flight.tankerFuelPlanned=true;
  flight.tankerFuelPreviousFlightId=plan.previousFlightId||'';
  if(plan.cost){
    flight.economics??={ticketRevenue:flight.revenue||0};
    flight.economics.recoveryOps=(Number(flight.economics.recoveryOps)||0)+plan.cost;
    refreshEconomicsTotals(flight);
    postTransaction(-plan.cost,'Fuel tanker',`${flight.id} protected from supplier outage${plan.previousFlightId?` via ${plan.previousFlightId}`:''}`,flight.id);
  }
  return plan;
}

function fuelFlight(f,t,force=false){
  if(f.fueled || f.cancelled || (!force&&t<f.departure-60*MIN)) return false;
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  if(!ac || ac.location!==f.from) return false;
  const nextFlight=state.flights
    .filter(other=>other.aircraftId===ac.id && !other.cancelled && !other.settled && !other.departureLogged)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b) || a.id.localeCompare(b.id))[0];
  if(!nextFlight || nextFlight.id!==f.id) return false;
  const plan=flightFuelPlan(f.from,flightOperationalDestination(f),ac);
  const onboard=Math.max(0,ac.fuelGallons||0);
  const purchased=Math.max(0,Math.ceil(plan.requiredGal-onboard));
  ac.fuelGallons=Math.min(plan.fuelCapacityGal,onboard+purchased);
  if(ac.fuelGallons<plan.requiredGal) return false;
  if(purchased>0) ac.lastFuelingFlightId=f.id;
  f.fueled=true;
  f.fueledAt=t;
  f.fuelGallons=purchased;
  f.fuelPurchasedGallons=purchased;
  f.fuelRequiredGallons=plan.requiredGal;
  f.fuelOnboardAtDeparture=ac.fuelGallons;
  f.tripFuelGallons=plan.tripBurnGal;
  f.fuelReserveGallons=plan.reserveGal;
  f.fuelCapacityGallons=plan.fuelCapacityGal;
  f.fuelPricePerGallon=state.fuelMarket.pricePerGallon;
  f.fuelCost=Math.round(purchased*f.fuelPricePerGallon);
  if(f.economics){
    f.economics.fuel=f.fuelCost;
    refreshEconomicsTotals(f);
  }else{
    f.costs=(f.baseCosts||0)+f.fuelCost+(f.maintenanceCost||0);
  }
  postTransaction(-f.fuelCost,'Fuel',`${f.id} purchased ${num(f.fuelPurchasedGallons)} US gal`,f.id);
  logEvent(`${f.id}: purchased ${num(purchased)} US gal of Jet A; ${num(ac.fuelGallons)} gal onboard for ${money(f.fuelCost)}.`);
  return true;
}
function repairFirstFlightFuelAttribution(){
  let changed=false;
  for(const ac of state.aircraft){
    if((ac.cycles||0)>0) continue;
    const flights=state.flights
      .filter(f=>f.aircraftId===ac.id && !f.cancelled && !f.settled)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b) || a.id.localeCompare(b.id));
    const first=flights[0];
    if(!first?.fueled || (first.fuelPurchasedGallons??first.fuelGallons)>0 || (first.fuelCost||0)>0) continue;
    const plan=flightFuelPlan(first.from,first.to,ac);
    const donor=flights.slice(1).find(f=>f.fueled && (f.fuelPurchasedGallons??f.fuelGallons)>0 && f.fuelCost>0);
    if(donor){
      first.fuelPurchasedGallons=donor.fuelPurchasedGallons??donor.fuelGallons;
      first.fuelGallons=first.fuelPurchasedGallons;
      first.fuelCost=donor.fuelCost;
      first.fuelPricePerGallon=donor.fuelPricePerGallon;
      first.fueledAt=donor.fueledAt;
      donor.fueled=false; donor.fuelGallons=0; donor.fuelPurchasedGallons=0; donor.fuelCost=0;
      if(donor.economics){ donor.economics.fuel=0; refreshEconomicsTotals(donor); }
    }else{
      first.fuelPurchasedGallons=plan.requiredGal;
      first.fuelGallons=plan.requiredGal;
      first.fuelPricePerGallon=first.fuelPricePerGallon||state.fuelMarket.pricePerGallon;
      first.fuelCost=Math.round(plan.requiredGal*first.fuelPricePerGallon);
      postTransaction(-first.fuelCost,'Fuel',`${first.id} initial fuel attribution`,first.id);
    }
    first.fuelRequiredGallons=plan.requiredGal;
    first.fuelOnboardAtDeparture=Math.max(plan.requiredGal,ac.fuelGallons||0);
    first.tripFuelGallons=plan.tripBurnGal;
    first.fuelReserveGallons=plan.reserveGal;
    first.fuelCapacityGallons=plan.fuelCapacityGal;
    ac.fuelGallons=first.fuelOnboardAtDeparture;
    ac.lastFuelingFlightId=first.id;
    if(first.economics){ first.economics.fuel=first.fuelCost; refreshEconomicsTotals(first); }
    changed=true;
  }
  return changed;
}

function resourceAvailability(kind,key='',location='',t=simNow()){
  const pending=(state.resourceRequests||[]).filter(request=>request.status==='pending'&&request.kind===kind&&request.key===key&&request.location===location).length;
  const current=kind==='aircraft'
    ? state.aircraft.filter(aircraft=>aircraft.model===key).length
    : kind==='personnel'
      ? staffAt(location,key)
      : state.slotRights.filter(right=>right.airport===location&&Math.floor(right.minuteOfDay/60)===Number(key)).length;
  return OperationalIntelligence.resourceAvailability({kind,key,location,current,pending,now:t});
}

function queueResourceRequest(kind,payload,supply){
  const request={
    id:`RR${state.nextResourceRequest++}`,kind,key:payload.key||'',location:payload.location||'',
    payload,requestedAt:simNow(),readyAt:simNow()+supply.leadMin*MIN,status:'pending'
  };
  state.resourceRequests.push(request);
  if(state.resourceRequests.length>200){
    const removable=state.resourceRequests.findIndex(item=>item.status!=='pending');
    if(removable>=0) state.resourceRequests.splice(removable,1);
  }
  save();
  return request;
}

function assignRequestedAircraft(modelName,cabin,location=state.home,requestedAt=simNow()){
  const n=state.nextAircraft++;
  const aircraft={
    id:'AC'+n,tail:randomTail(n),model:modelName,cabin:{...cabin},location,
    defectUntil:0,defectReason:'',condition:100,flightHours:0,cycles:0,fuelGallons:0,melItems:[],
    issueAcknowledgedAt:0,issueAcknowledgedKey:'',acquisitionType:'requested',
    resourceSource:'operations pool',acquiredAt:simNow(),requestedAt
  };
  state.aircraft.push(aircraft);
  Management.ensureState(state,simNow());
  return aircraft;
}

function requestPersonnelResource(role,airport,amount,qualification=''){
  if(!PERSONNEL[role]||!AIRPORTS[airport]) return null;
  const supply=resourceAvailability('personnel',role,airport);
  if(supply.available>=amount){
    changeStaff(airport,role,amount);
    if(['captains','firstOfficers'].includes(role)) changeQualification(airport,role,qualification,amount);
    save();
    return {status:'delivered',amount};
  }
  return queueResourceRequest('personnel',{key:role,location:airport,role,airport,amount,qualification},supply);
}

function processResourceRequests(t=simNow()){
  let changed=false;
  for(const request of state.resourceRequests||[]){
    if(request.status!=='pending'||t<request.readyAt) continue;
    const payload=request.payload||{};
    if(request.kind==='aircraft'){
      const aircraft=assignRequestedAircraft(payload.model,payload.cabin,payload.location,request.requestedAt);
      request.deliveredResourceId=aircraft.id;
    }else if(request.kind==='personnel'){
      changeStaff(payload.airport,payload.role,payload.amount);
      if(['captains','firstOfficers'].includes(payload.role)) changeQualification(payload.airport,payload.role,payload.qualification,payload.amount);
    }else if(request.kind==='slot'){
      const right=requestSlotRight(payload.airport,payload.timestamp,{silent:true,source:'operations request',force:true});
      request.deliveredResourceId=right?.id||'';
    }
    request.status='delivered'; request.deliveredAt=t; changed=true;
  }
  return changed;
}

function maybeApplyNetworkConstraints(flight,t){
  if(flight.cancelled||flight.settled||flight.departureLogged||flight.constraintChecked||t<flight.departure-120*MIN||t>=flight.departure) return false;
  flight.constraintChecked=true;
  const constraints=networkConstraintsForFlight(flight);
  flight.airportDelayMin=constraints.airport.delayMin;
  flight.airspaceDelayMin=constraints.airspace.delayMin;
  flight.airportConstraintLabel=constraints.airport.delayMin?constraints.airport.reason:'';
  flight.airspaceConstraintLabel=constraints.airspace.delayMin?constraints.airspace.reason:'';
  if(constraints.night?.delayMin&&constraints.night.status!=='closed'){
    flight.nightRestrictionDelayMin=constraints.night.delayMin;
    flight.nightRestrictionLabel=constraints.night.reason;
  }else if(constraints.night?.status==='closed'){
    flight.nightRestrictionConflictDelayMin=constraints.night.delayMin||0;
    flight.nightRestrictionConflictLabel=constraints.night.reason||'Night curfew conflict';
  }
  return true;
}

function updatePassengerConnections(){
  let changed=false;
  const byOrigin=new Map();
  for(const candidate of state.flights){
    if(candidate.cancelled) continue;
    if(!byOrigin.has(candidate.from)) byOrigin.set(candidate.from,[]);
    byOrigin.get(candidate.from).push(candidate);
  }
  for(const flight of state.flights){
    const connections=connectionStatusForFlight(flight,byOrigin.get(flightOperationalDestination(flight))||[]);
    const next={total:connections.total,critical:connections.critical,atRisk:connections.atRisk,missed:connections.missed};
    if(flight.connectionPax!==next.total||flight.connectionCriticalPax!==next.critical||flight.connectionAtRiskPax!==next.atRisk||flight.connectionMissedPax!==next.missed){
      flight.connectionPax=next.total;
      flight.connectionCriticalPax=next.critical;
      flight.connectionAtRiskPax=next.atRisk;
      flight.connectionMissedPax=next.missed;
      changed=true;
    }
  }
  return changed;
}

function processMelConstraints(t=simNow()){
  let changed=false;
  for(const aircraft of state.aircraft){
    aircraft.melItems??=[];
    const maintenanceCompletedAt=aircraft.maintenance?.lastCompletedAt||0;
    for(const item of aircraft.melItems){
      if(['open','expired'].includes(item.status)&&maintenanceCompletedAt>(item.deferredAt||item.detectedAt||0)){
        item.status='cleared'; item.clearedAt=maintenanceCompletedAt; changed=true; continue;
      }
      if(item.status==='open'&&(t>=item.expiresAt||item.remainingCycles<=0)){
        item.status='expired'; item.expiredAt=t;
        aircraft.defectReason=`Expired MEL ${item.code}`;
        aircraft.defectUntil=Math.max(aircraft.defectUntil||0,t+365*DAY);
        changed=true;
      }
    }
    if(!aircraft.melItems.some(item=>item.status==='expired')&&aircraft.defectReason?.startsWith('Expired MEL')){
      aircraft.defectReason=''; aircraft.defectUntil=0; changed=true;
    }
  }
  return changed;
}

function processFlightLifecycleTransitions(t=simNow()){
  let changed=false,needsRecalc=false;
  for(const f of state.flights){
    if(f.cancelled) continue;
    if(repairFlightLifecycleFlags(f,t)) changed=true;
    if(fuelFlight(f,t)) changed=true;
    const slotGraceMin=(AIRPORT_OPS[f.from]?.graceMin)||10;
    if(f.slotMissed && !f.slotLogged && t>=f.departure+slotGraceMin*MIN){
      f.slotLogged=true;
      logEvent(`${f.id}: original ${f.from} slot missed; new slot ${formatTime(f.assignedSlot)}.`);
      changed=true;
    }
    if(!flightHasDeparted(f,t) && t>=f.departure && t>=flightActualDeparture(f) && !departureGroundBlockersForFlight(f).length){
      f.departureLogged=true;
      if(maybeGenerateEnrouteIssue(f,t)){ changed=true; needsRecalc=true; }
      const d=flightTotalDepartureDelayMin(f);
      logEvent(`${f.id} departed ${f.from} for ${flightOperationalDestination(f)}${d?` ${d} min late`:''}.`,flightActualDeparture(f));
      changed=true;
    }
    if(flightHasDeparted(f,t) && !flightHasCompleted(f,t) && t>=flightActualArrival(f)){
      f.settled=true;
      const ac=state.aircraft.find(a=>a.id===f.aircraftId);
      if(ac){
        ac.location=flightOperationalDestination(f);
        const onboardFuel=Number.isFinite(ac.fuelGallons)?ac.fuelGallons:(f.fuelOnboardAtDeparture||0);
        ac.fuelGallons=Math.max(0,onboardFuel-(f.tripFuelGallons||0));
        const hours=(Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure)/HOUR;
        ac.flightHours=(ac.flightHours||0)+hours;
        ac.cycles=(ac.cycles||0)+1;
        ac.condition=clamp((ac.condition??100)-(.12+hours*.035),0,100);
        for(const item of ac.melItems||[]){
          if(item.status==='open') item.remainingCycles=Math.max(0,(item.remainingCycles||0)-1);
        }
      }
      const prepaid=(f.fuelCost||0)+(f.maintenanceCost||0)+(f.weatherCost||0);
      postTransaction(f.revenue,'Ticket revenue',`${f.id} ${f.from} → ${f.to}`,f.id);
      const remainingOperatingCost=Math.max(0,f.costs-prepaid);
      if(remainingOperatingCost) postTransaction(-remainingOperatingCost,'Flight operations',`${f.id} remaining operating costs`,f.id);
      state.stats.revenue += f.revenue; state.stats.costs += f.costs;
      state.stats.pax += f.pax; state.stats.completed += 1;
      const ad=Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN));
      logEvent(`${f.id} arrived ${flightOperationalDestination(f)}${ad?` ${ad} min late`:''}.`,flightActualArrival(f));
      changed=true;
    }
  }
  for(const ac of state.aircraft){
    const expiredMel=(ac.melItems||[]).some(item=>item.status==='expired');
    if(ac.defectUntil && t>=ac.defectUntil&&!expiredMel){ ac.defectUntil=0; ac.defectReason=''; changed=true; needsRecalc=true; }
  }
  return {changed,needsRecalc};
}

function compactFlightHistoryRecord(f){
  const actualDeparture=flightActualDeparture(f),actualArrival=flightActualArrival(f);
  return {
    id:f.id,serviceId:f.serviceId||'',serviceLeg:f.serviceLeg||'',aircraftId:f.aircraftId||'',
    from:f.from,to:f.to,operationalDestination:flightOperationalDestination(f),flightType:f.flightType||'passenger',
    departure:f.departure,arrival:f.arrival,actualDeparture,actualArrival,
    settled:Boolean(f.settled),cancelled:Boolean(f.cancelled),cancelledAt:f.cancelledAt||0,
    pax:Number(f.pax)||0,seats:f.load?Math.round((Number(f.pax)||0)/f.load):Number(f.pax)||0,
    revenue:Number(f.revenue)||0,costs:Number(f.costs)||0,cancellationCost:Number(f.cancellationCost)||0,
    delayMin:Math.max(0,Math.round((actualArrival-f.arrival)/MIN)),
    blockHours:Math.max(0,(f.arrival-f.departure)/HOUR)
  };
}

function flightHasOpenOperationalWork(flightId){
  if(!flightId) return false;
  if((state.incidents||[]).some(item=>item.flightId===flightId&&item.status==='open')) return true;
  if((state.coordinationTasks||[]).some(item=>item.flightId===flightId&&!['completed','cancelled'].includes(item.status))) return true;
  if((state.personnelTransfers||[]).some(item=>item.flightId===flightId&&!['completed','cancelled'].includes(item.status))) return true;
  if((state.passengerRecoveries||[]).some(item=>item.flightId===flightId&&!['confirmed','cancelled'].includes(item.status))) return true;
  if((state.crewRecoveries||[]).some(item=>item.flightId===flightId&&!['confirmed','cancelled'].includes(item.status))) return true;
  return false;
}

function pruneOperationalFlightRetention(t=simNow()){
  const pastCutoff=t-OPERATIONAL_PAST_FLIGHT_RETENTION;
  const futureCutoff=t+OPERATIONAL_FUTURE_FLIGHT_HORIZON;
  const removedIds=new Set();
  const removedFutureOutboundByService=new Map();
  const historyById=new Map((state.flightHistory||[]).map(item=>[item.id,item]));

  const shouldPruneFutureFlight=flight=>{
    if(flight.cancelled||flight.settled||flight.departureLogged) return false;
    if(flightActualDeparture(flight)<=futureCutoff) return false;
    if(flight.serviceId){
      const rotation=rotationForFlight(flight);
      const outbound=rotation.outbound||flight;
      const outboundDeparture=flightActualDeparture(outbound);
      if(outboundDeparture<=futureCutoff) return false;
      const current=removedFutureOutboundByService.get(flight.serviceId);
      if(!Number.isFinite(current)||outboundDeparture<current) removedFutureOutboundByService.set(flight.serviceId,outboundDeparture);
    }
    return true;
  };

  for(const flight of state.flights||[]){
    if(flightHasOpenOperationalWork(flight.id)) continue;
    const terminalAt=flight.settled
      ? flightActualArrival(flight)
      : flight.cancelled
        ? (flight.cancelledAt||flightActualDeparture(flight))
        : 0;
    if(terminalAt&&terminalAt<pastCutoff){
      historyById.set(flight.id,compactFlightHistoryRecord(flight));
      removedIds.add(flight.id);
      continue;
    }
    if(shouldPruneFutureFlight(flight)) removedIds.add(flight.id);
  }

  if(!removedIds.size){
    const trimmed=[...historyById.values()].filter(item=>(item.actualArrival||item.cancelledAt||item.arrival)>=t-FLIGHT_HISTORY_RETENTION);
    const changed=trimmed.length!==(state.flightHistory||[]).length;
    state.flightHistory=trimmed;
    return changed;
  }

  state.flights=state.flights.filter(flight=>!removedIds.has(flight.id));
  for(const [serviceId,departure] of removedFutureOutboundByService.entries()){
    const service=state.services.find(item=>item.id===serviceId&&item.active);
    if(service&&departure<service.nextDeparture) service.nextDeparture=departure;
  }
  const removedIncidentIds=new Set(
    (state.incidents||[])
      .filter(incident=>removedIds.has(incident.flightId)&&incident.status!=='open')
      .map(incident=>incident.id)
  );
  state.incidents=(state.incidents||[]).filter(incident=>!removedIncidentIds.has(incident.id)&&!removedIds.has(incident.flightId));
  state.coordinationTasks=(state.coordinationTasks||[]).filter(task=>!removedIncidentIds.has(task.incidentId)&&!removedIds.has(task.flightId));
  state.personnelTransfers=(state.personnelTransfers||[]).filter(item=>!removedIds.has(item.flightId)||!['completed','cancelled'].includes(item.status));
  state.passengerRecoveries=(state.passengerRecoveries||[]).filter(item=>!removedIds.has(item.flightId)||!['confirmed','cancelled'].includes(item.status));
  state.crewRecoveries=(state.crewRecoveries||[]).filter(item=>!removedIds.has(item.flightId)||!['confirmed','cancelled'].includes(item.status));
  state.crewDuties=(state.crewDuties||[]).map(duty=>({
    ...duty,
    flightIds:(duty.flightIds||[]).filter(id=>!removedIds.has(id))
  })).filter(duty=>duty.flightIds.length||Math.max(duty.releaseAt||0,duty.dutyEnd||0)>=pastCutoff);
  if(selectedFlightId&&removedIds.has(selectedFlightId)) selectedFlightId=null;
  if(state.warningRegistry&&typeof state.warningRegistry==='object'){
    for(const [key,warning] of Object.entries(state.warningRegistry)){
      if(removedIds.has(warning?.flightId)) delete state.warningRegistry[key];
    }
  }
  state.flightHistory=[...historyById.values()].filter(item=>(item.actualArrival||item.cancelledAt||item.arrival)>=t-FLIGHT_HISTORY_RETENTION);
  invalidateOperationalIndex();
  return true;
}

function eventProcessingContext(t){
  return {
    t,
    changed:false,
    needsRecalc:false,
    changedSources:[],
    markChanged(source,recalc=false){
      this.changed=true;
      this.changedSources.push(source);
      if(recalc) this.needsRecalc=true;
    },
    flushRecalc(){
      if(this.needsRecalc){
        recalculateOperations();
        this.needsRecalc=false;
      }
    }
  };
}

function processStateRepairEvents(ctx){
  const t=ctx.t;
  if(retireTrackedIncidents(t)) ctx.markChanged('retireTrackedIncidents');
  if(repairDuplicateOpenIncidents(t)) ctx.markChanged('repairDuplicateOpenIncidents');
  if(typeof reopenSilentDefaultFlightdeckFollowups==='function'&&reopenSilentDefaultFlightdeckFollowups(t)) ctx.markChanged('reopenSilentDefaultFlightdeckFollowups');
  if(!state.ops?.caseLinksRepaired){
    if(repairIncidentCaseLinks()) ctx.markChanged('repairIncidentCaseLinks');
    state.ops??={automaticDisruptions:true};
    state.ops.caseLinksRepaired=true;
    ctx.markChanged('caseLinksRepairedFlag');
  }
  if(!state.ops?.phaseRealismRepaired){
    if(repairIncidentPhaseRealism(t)) ctx.markChanged('repairIncidentPhaseRealismInitial');
    state.ops??={automaticDisruptions:true};
    state.ops.phaseRealismRepaired=true;
    ctx.markChanged('phaseRealismRepairedFlag');
  }
  if(repairIncidentPhaseRealism(t)) ctx.markChanged('repairIncidentPhaseRealism');
  if(pruneOperationalFlightRetention(t)) ctx.markChanged('pruneOperationalFlightRetention',true);
}

function processOperationalTimerEvents(ctx){
  const t=ctx.t;
  if(ensureRecurringFlights()) ctx.markChanged('ensureRecurringFlights',true);
  if(ensurePlannedCrewAugmentation()) ctx.markChanged('ensurePlannedCrewAugmentation',true);
  if(processOperationalWorkflows(t)) ctx.markChanged('processOperationalWorkflows',true);
  if(Management.processMaintenance(state,t,postTransaction)) ctx.markChanged('processMaintenance',true);
  if(Management.processWeeklyReviews(state,t)) ctx.markChanged('processWeeklyReviews');
  if(repairFirstFlightFuelAttribution()) ctx.markChanged('repairFirstFlightFuelAttribution');
  if(processPersonnelTransfers(t)) ctx.markChanged('processPersonnelTransfers',true);
  if(processResourceRequests(t)) ctx.markChanged('processResourceRequests',true);
  if(processEnrouteRecoveryRequests(t)) ctx.markChanged('processEnrouteRecoveryRequests',true);
  if(processPassengerRecoveries(t)) ctx.markChanged('processPassengerRecoveries');
  if(processCrewRecoveries(t)) ctx.markChanged('processCrewRecoveries');
  if(processMelConstraints(t)) ctx.markChanged('processMelConstraints',true);
}

function processFlightGenerationEvents(ctx){
  const t=ctx.t;
  for(const f of state.flights){
    if(maybeApplyWeatherDelay(f,t)) ctx.markChanged(`maybeApplyWeatherDelay:${f.id}`,true);
    if(maybeApplyLiveWeatherImpact(f,t)) ctx.markChanged(`maybeApplyLiveWeatherImpact:${f.id}`,true);
    if(maybeGenerateEnrouteIssue(f,t)) ctx.markChanged(`maybeGenerateEnrouteIssue:${f.id}`,true);
    if(maybeGeneratePreDepartureIssue(f,t)) ctx.markChanged(`maybeGeneratePreDepartureIssue:${f.id}`,true);
    if(maybeGenerateOperationalIncident(f,t)) ctx.markChanged(`maybeGenerateOperationalIncident:${f.id}`,true);
    if(maybeApplyNetworkConstraints(f,t)) ctx.markChanged(`maybeApplyNetworkConstraints:${f.id}`,true);
  }
}

function processLifecycleAndConstraintEvents(ctx){
  const t=ctx.t;
  if(processIncidentDeadlines(t)) ctx.markChanged('processIncidentDeadlines',true);
  ctx.flushRecalc();
  if(updateStaffingConstraints(t)) ctx.markChanged('updateStaffingConstraints',true);
  if(updateMaintenanceConstraints(t)) ctx.markChanged('updateMaintenanceConstraints',true);
  if(updatePositioningConstraints(t)) ctx.markChanged('updatePositioningConstraints',true);
  if(updateIncidentConstraints(t)) ctx.markChanged('updateIncidentConstraints',true);
  ctx.flushRecalc();
  const lifecycle=processFlightLifecycleTransitions(t);
  if(lifecycle.changed){
    ctx.markChanged('processFlightLifecycleTransitions');
    invalidateOperationalIndex();
  }
  if(lifecycle.needsRecalc) ctx.needsRecalc=true;
  ctx.flushRecalc();
  if(updateStaffingConstraints(t)) ctx.markChanged('updateStaffingConstraintsAfterLifecycle',true);
  if(updateMaintenanceConstraints(t)) ctx.markChanged('updateMaintenanceConstraintsAfterLifecycle',true);
  if(updatePositioningConstraints(t)) ctx.markChanged('updatePositioningConstraintsAfterLifecycle',true);
  if(updateIncidentConstraints(t)) ctx.markChanged('updateIncidentConstraintsAfterLifecycle',true);
  ctx.flushRecalc();
  if(updatePassengerConnections()) ctx.markChanged('updatePassengerConnections');
  if(processDerivedOperationalIncidents(t)) ctx.markChanged('processDerivedOperationalIncidents',true);
}

function processEvents(){
  const ctx=eventProcessingContext(simNow());
  processStateRepairEvents(ctx);
  processOperationalTimerEvents(ctx);
  processFlightGenerationEvents(ctx);
  processLifecycleAndConstraintEvents(ctx);
  if(ctx.changed){
    if(ctx.needsRecalc) recalculateOperations();
    else invalidateOperationalIndex();
    save();
    if(typeof window!=='undefined'){
      window.__aocLastEventChanges={at:ctx.t,realAt:Date.now(),sources:ctx.changedSources.slice(0,80)};
      const counts=window.__aocEventChangeCounts??={};
      for(const source of ctx.changedSources) counts[source]=(counts[source]||0)+1;
      window.__aocEventChangeCounts=counts;
    }
  }
  return ctx.changed;
}

function updateMaintenanceConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled||f.settled||f.departureLogged) continue;
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    if(!ac) continue;
    const maintenance=Management.maintenanceStatus(ac,t);
    const job=maintenance.scheduled;
    const overlapsJob=Boolean(job&&job.start<flightActualArrival(f)&&job.end>flightActualDeparture(f));
    if(overlapsJob){
      applyFlightCancellation(f,job.reason||job.label||'Scheduled maintenance check');
      changed=true;
      continue;
    }
    if(maintenance.grounding){
      const reason=job?.reason||job?.label||maintenance.reason||'Aircraft under maintenance';
      if(!f.maintenanceBlocked) changed=true;
      f.maintenanceBlocked=true;
      if(markStableGroundHold(f,'maintenance',reason,t)) changed=true;
      if(job){
        const delay=Math.max(15,Math.ceil((job.end-f.departure)/(15*MIN))*15);
        if(f.maintenanceDelayMin!==delay){ f.maintenanceDelayMin=delay; changed=true; }
      }
    }else if(f.maintenanceBlocked||f.maintenanceDelayMin){
      f.maintenanceBlocked=false;
      if(!releaseStableGroundHold(f,'maintenance','maintenanceDelayMin',t) && f.maintenanceDelayMin){
        f.maintenanceDelayMin=0;
      }
      changed=true;
    }
  }
  return changed;
}

function updatePositioningConstraints(t=simNow()){
  let changed=false;
  for(const ac of state.aircraft){
    const active=aircraftActiveFlight(ac.id,t);
    let projectedLocation=active?flightOperationalDestination(active):ac.location;
    let availableAt=active?flightActualArrival(active):t;
    const future=state.flights
      .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&!f.departureLogged&&flightActualArrival(f)>t)
      .sort(compareAircraftRotationFlights);
    for(const flight of future){
      const dep=flightActualDeparture(flight),destination=flightOperationalDestination(flight);
      const outOfPosition=flight.from!==projectedLocation;
      const inActionWindow=t>=dep-6*HOUR;
      if(outOfPosition){
        if(!flight.positioningBlocked) changed=true;
        flight.positioningBlocked=true;
        if(inActionWindow&&markStableGroundHold(flight,'positioning',`${projectedLocation}->${flight.from}`,t,dep)) changed=true;
        continue;
      }
      if(flight.positioningBlocked||flight.positioningDelayMin||flight.positioningHoldStartedAt){
        flight.positioningBlocked=false;
        if(!releaseStableGroundHold(flight,'positioning','positioningDelayMin',t) && flight.positioningDelayMin){
          flight.positioningDelayMin=0;
        }
        changed=true;
      }
      if(dep>=availableAt){
        projectedLocation=destination;
        availableAt=flightActualArrival(flight)+minimumTurnMinutes(ac,destination)*MIN;
      }else{
        projectedLocation=destination;
        availableAt=Math.max(availableAt,flightActualArrival(flight)+minimumTurnMinutes(ac,destination)*MIN);
      }
    }
  }
  return changed;
}

function updateStaffingConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled || f.settled || f.departureLogged || t<f.departure-60*MIN) continue;
    const ac=state.aircraft.find(a=>a.id===f.aircraftId);
    if(!ac) continue;
    const evaluationDeparture=Math.max(f.departure,t);
    const shortages=staffingShortagesForFlight(ac,evaluationDeparture,f.arrival-f.departure,f.from,f.id,flightUsesLocalCrew(f),f.flightType);
    if(shortages.length){
      const shortageText=shortages.join(' · ');
      if(!f.staffingBlocked||f.staffingShortage!==shortageText){ changed=true; }
      f.staffingBlocked=true; f.staffingShortage=shortageText;
      if(markStableGroundHold(f,'staffing',shortageText,t)) changed=true;
    }else if(f.staffingBlocked || f.staffingDelayMin || f.staffingHoldStartedAt){
      f.staffingBlocked=false; f.staffingShortage='';
      if(!releaseStableGroundHold(f,'staffing','staffingDelayMin',t) && f.staffingDelayMin){
        f.staffingDelayMin=0;
      }
      changed=true;
    }
  }
  return changed;
}

function rotationForFlight(f){
  if(!f || !f.serviceId) return {service:null,outbound:f,returnFlight:null};
  const service=state.services.find(s=>s.id===f.serviceId) || null;
  const serviceFlights=state.flights
    .filter(x=>x.serviceId===f.serviceId)
    .sort((a,b)=>a.departure-b.departure);

  let outbound=null, returnFlight=null;
  if(f.serviceLeg==='outbound'){
    outbound=f;
    returnFlight=serviceFlights.find(x=>x.serviceLeg==='return' && x.departure>f.departure) || null;
  }else if(f.serviceLeg==='return'){
    returnFlight=f;
    const prior=serviceFlights.filter(x=>x.serviceLeg==='outbound' && x.departure<f.departure);
    outbound=prior[prior.length-1] || null;
  }else{
    outbound=f;
  }
  return {service,outbound,returnFlight};
}

function rotationReplacementCandidates(f){
  const {service,outbound,returnFlight}=rotationForFlight(f);
  if(!service || !outbound) return [];
  const now=simNow();
  if(flightActualDeparture(outbound)<=now) return [];

  const windowStart=outbound.departure-45*MIN;
  const windowEnd=(returnFlight?.arrival || outbound.arrival)+45*MIN;

  return state.aircraft.filter(ac=>{
    if(ac.id===outbound.aircraftId) return false;
    if(ac.location!==service.from) return false;
    if(aircraftIsDefective(ac,now)) return false;
    if(state.services.some(s=>s.active && s.id!==service.id && s.aircraftId===ac.id)) return false;

    const outEst=estimateFlight(service.from,service.to,ac,service.fares||service.fare);
    const backEst=estimateFlight(service.to,service.from,ac,service.fares||service.fare);
    if(!outEst.rangeOk || !backEst.rangeOk) return false;

    const conflict=state.flights.some(x=>
      x.aircraftId===ac.id &&
      !x.settled &&
      x.id!==outbound.id &&
      x.id!==(returnFlight?.id || '') &&
      flightActualArrival(x)>windowStart &&
      flightActualDeparture(x)<windowEnd
    );
    return !conflict;
  });
}

function substituteSelectedRotation(flightId,newAcId){
  const selected=state.flights.find(f=>f.id===flightId);
  const newAc=state.aircraft.find(a=>a.id===newAcId);
  if(!selected || !newAc) return;

  const {service,outbound,returnFlight}=rotationForFlight(selected);
  if(!service || !outbound) return toast('This flight is not part of a recurring schedule.');
  if(outbound.fueled) return toast('This round trip has already been fueled; its aircraft can no longer be changed.');
  if(outbound.departureLogged) return toast('This round trip has already started.');

  const candidates=rotationReplacementCandidates(selected);
  if(!candidates.some(a=>a.id===newAcId)){
    return toast(`${newAc.tail} is not available for this round trip.`);
  }

  outbound.aircraftId=newAcId;
  clearAircraftSpecificDelay(outbound);
  if(returnFlight){
    returnFlight.aircraftId=newAcId;
    clearAircraftSpecificDelay(returnFlight);
  }
  if(typeof recordRecoveryCostEvent==='function'){
    const amount=Math.round((2_500*(typeof aircraftSizeFactor==='function'?aircraftSizeFactor(outbound):1))/100)*100;
    recordRecoveryCostEvent({
      flight:outbound,category:'aircraft',kind:'manual_aircraft_swap',amount,
      airport:outbound.from,
      description:`${outbound.id}: manual round-trip aircraft swap to ${newAc.tail}`
    });
  }
  for(const flight of [outbound,returnFlight].filter(Boolean)){
    for(const incident of state.incidents.filter(item=>item.flightId===flight.id&&item.status==='open')){
      incident.aircraftId=newAcId;
    }
  }

  selectedAircraftId=newAcId;
  selectedFlightId=selected.id;
  recalculateOperations();
  AeroServices.commit();
  toast(`${newAc.tail} will operate this round trip only.`);
}

function manualSwapCandidatesForFlight(flight){
  if(!flight||flight.cancelled||flightHasDeparted(flight)||flight.fueled) return [];
  if(flight.serviceId) return rotationReplacementCandidates(flight);
  return incidentReplacementCandidates(flight);
}

function swapSelectedFlightAircraft(flightId,newAcId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const aircraft=state.aircraft.find(item=>item.id===newAcId);
  if(!flight||!aircraft) return;
  if(flight.serviceId) return substituteSelectedRotation(flightId,newAcId);
  if(flight.departureLogged) return toast('This flight has already departed.');
  if(flight.fueled) return toast('This flight has already been fueled; its aircraft can no longer be changed.');
  const candidates=manualSwapCandidatesForFlight(flight);
  if(!candidates.some(item=>item.id===newAcId)) return toast(`${aircraft.tail} is not available for this flight.`);
  flight.aircraftId=newAcId;
  if(typeof recordRecoveryCostEvent==='function'){
    const amount=Math.round((2_500*(typeof aircraftSizeFactor==='function'?aircraftSizeFactor(flight):1))/100)*100;
    recordRecoveryCostEvent({
      flight,category:'aircraft',kind:'manual_aircraft_swap',amount,
      airport:flight.from,
      description:`${flight.id}: manual aircraft swap to ${aircraft.tail}`
    });
  }
  for(const incident of state.incidents.filter(item=>item.flightId===flight.id&&item.status==='open')){
    incident.aircraftId=newAcId;
  }
  clearAircraftSpecificDelay(flight);
  selectedAircraftId=newAcId;
  selectedFlightId=flight.id;
  recalculateOperations();
  AeroServices.commit();
  toast(`${aircraft.tail} will operate ${flight.id}.`);
}

function serviceReplacementCandidates(svc){
  const now=simNow();
  const nextOut=state.flights.filter(f=>f.serviceId===svc.id && f.serviceLeg==='outbound' && flightActualDeparture(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  return state.aircraft.filter(ac=>{
    if(ac.id===svc.aircraftId) return true;
    if(ac.location!==svc.from || aircraftIsDefective(ac,now)) return false;
    if(state.services.some(s=>s.active && s.id!==svc.id && s.aircraftId===ac.id)) return false;
    const out=estimateFlight(svc.from,svc.to,ac,svc.fares||svc.fare), back=estimateFlight(svc.to,svc.from,ac,svc.fares||svc.fare);
    if(!out.rangeOk || !back.rangeOk) return false;
    if(nextOut){
      const ret=state.flights.filter(f=>f.serviceId===svc.id && f.serviceLeg==='return' && f.departure>nextOut.departure)
        .sort((a,b)=>a.departure-b.departure)[0];
      const ws=nextOut.departure-30*MIN, we=(ret?.arrival||nextOut.arrival)+30*MIN;
      if(state.flights.some(f=>f.aircraftId===ac.id && !f.settled && flightActualArrival(f)>ws && flightActualDeparture(f)<we)) return false;
    }
    return true;
  });
}
function clearAircraftSpecificDelay(f){
  f.technicalDelayMin=0; f.propagatedDelayMin=0; f.slotDelayMin=0;
  f.slotMissed=false; f.slotLogged=false; f.opsChecked=false;
}
function substituteNextRotation(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('Choose a different spare aircraft.');
  if(!serviceReplacementCandidates(svc).some(a=>a.id===newAcId)) return toast(`${ac.tail} is not available at ${svc.from}.`);
  const now=simNow();
  const out=state.flights.filter(f=>f.serviceId===serviceId && f.serviceLeg==='outbound' && flightActualDeparture(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  if(!out) return toast('No future rotation found.');
  if(out.fueled) return toast('The next rotation has already been fueled and cannot be reassigned.');
  const ret=state.flights.filter(f=>f.serviceId===serviceId && f.serviceLeg==='return' && f.departure>out.departure)
    .sort((a,b)=>a.departure-b.departure)[0];
  out.aircraftId=newAcId; clearAircraftSpecificDelay(out);
  if(ret){ ret.aircraftId=newAcId; clearAircraftSpecificDelay(ret); }
  recalculateOperations(); logEvent(`${ac.tail} substituted for ${svc.id} next ${svc.from} ↔ ${svc.to} rotation.`);
  AeroServices.commit(); toast(`${ac.tail} will operate the next round trip only.`);
}
function changeServiceAircraft(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('That aircraft already owns this schedule.');
  if(state.flights.some(f=>f.serviceId===serviceId && ['taxi_out','airborne','taxi_in'].includes(statusOfFlight(f))))
    return toast('Wait until the current rotation is on the ground.');
  const nextFueledOutbound=state.flights
    .filter(f=>f.serviceId===serviceId && f.serviceLeg==='outbound' && flightActualDeparture(f)>simNow())
    .sort((a,b)=>a.departure-b.departure)[0];
  if(nextFueledOutbound?.fueled) return toast('The next rotation has already been fueled and cannot be reassigned.');
  if(!serviceReplacementCandidates(svc).some(a=>a.id===newAcId)) return toast(`${ac.tail} is not a suitable spare at ${svc.from}.`);
  const old=state.aircraft.find(a=>a.id===svc.aircraftId); svc.aircraftId=newAcId; const now=simNow();
  for(const f of state.flights){
    if(f.serviceId===serviceId && flightActualDeparture(f)>now){ f.aircraftId=newAcId; clearAircraftSpecificDelay(f); }
  }
  recalculateOperations(); logEvent(`${svc.id}: aircraft changed ${old?.tail||'unknown'} → ${ac.tail} for all future rotations.`);
  selectedAircraftId=newAcId; AeroServices.commit(); toast(`${ac.tail} is now permanently assigned to ${svc.id}.`);
}
function injectHandlingDelay(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  f.handlingDelayMin=(f.handlingDelayMin||0)+30; f.opsChecked=true;
  recalculateOperations(); logEvent(`${f.id}: manual test — ground handling delay +30 min.`);
  AeroServices.commit(); toast(`${f.id} now has a 30-minute handling delay.`);
}
function injectTechnicalDefect(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  if(aircraftActiveFlight(ac.id)) return toast('Defect testing is only available on the ground.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  const repairMin=180; ac.defectUntil=Math.max(ac.defectUntil||0,f.departure+repairMin*MIN); ac.defectReason='Technical defect';
  f.technicalDelayMin=Math.max(f.technicalDelayMin||0,repairMin); f.opsChecked=true;
  recalculateOperations(); logEvent(`${ac.tail}: technical defect; estimated repair 3h. Consider a substitute aircraft.`);
  AeroServices.commit(); toast(`${ac.tail} is defective for about 3 hours.`);
}

function delayFlight(flightId,minutes=15){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||flightHasDeparted(f)) return toast('Only a flight still on the ground can be held.');
  f.manualDelayMin=(Number(f.manualDelayMin)||0)+minutes;
  if(typeof recordRecoveryCostEvent==='function'&&typeof passengerDelayCost==='function'){
    const amount=passengerDelayCost(f,minutes);
    if(amount) recordRecoveryCostEvent({
      flight:f,category:'dispatch',kind:'manual_delay',amount,
      passengers:f.pax||0,airport:f.from,
      description:`${f.id}: manual OCC hold +${minutes} min`
    });
  }
  f.issueAcknowledgedAt=0; f.issueAcknowledgedKey='';
  recalculateOperations();
  processDerivedOperationalIncidents(simNow());
  updatePassengerConnections();
  AeroServices.persist();
  requestUiRefresh('left','desk','context','schedule','filter','map','weather');
  toast(`${f.id} held for ${minutes} additional minutes. Downstream delays were recalculated.`);
}

function delayFlightUntil(flightId,targetTime){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||flightHasDeparted(f)) return toast('Only a flight still on the ground can be held.');
  if(!Number.isFinite(targetTime)) return toast('Choose a valid hold-until time.');
  const current=flightActualDeparture(f);
  if(targetTime<=current+30_000) return toast(`${f.id} is already projected at or after that time.`);
  const minutes=Math.ceil((targetTime-current)/MIN);
  delayFlight(flightId,minutes);
}

function prioritizeFuel(flightId){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('This flight can no longer be fueled on the ground.');
  if(!fuelFlight(f,simNow(),true)) return toast('Fueling is not possible yet: the aircraft must be at origin and this must be its next flight.');
  AeroServices.commit(); toast(`${f.id} fueled early.`);
}

function recoveryPlansForFlight(flight){
  if(!flight) return [];
  const downstreamFlights=state.flights
    .filter(item=>!item.cancelled&&item.aircraftId===flight.aircraftId&&item.departure>flight.departure&&item.departure<flight.departure+12*HOUR)
    .sort((a,b)=>a.departure-b.departure).slice(0,3);
  const aircraftRecoveryNeeded=Boolean(
    flight.technicalDelayMin||flight.maintenanceBlocked||flight.maintenanceDelayMin||flight.positioningBlocked
  );
  const plans=OperationalIntelligence.recoveryOptions({
    flight:{...flight,actualDeparture:flightActualDeparture(flight)},
    downstreamFlights:downstreamFlights.map(item=>({...item,actualDeparture:flightActualDeparture(item)})),
    connections:connectionStatusForFlight(flight),
    spareAvailable:aircraftRecoveryNeeded&&incidentReplacementCandidates(flight).length>0
  });
  const duty=crewDutyForFlight(flight);
  if(!duty.legal){
    if(!flight.crewAugmented){
      const planned=plannedCrewDutyAssessmentForFlight(flight,{augmented:true});
      const rotation=rotationForFlight(flight);
      const through=rotationUsesThroughCrew(flight)&&rotation.outbound&&rotation.returnFlight;
      const liveAugmented=OperationalIntelligence.crewDutyAssessment({
        departure:through?flightActualDeparture(rotation.outbound):flightActualDeparture(flight),
        arrival:through?flightActualArrival(rotation.returnFlight):flightActualArrival(flight),
        sectors:through?2:1,
        augmented:true
      });
      if(liveAugmented.legal){
        return [{
          id:'augment-crew',label:'Activate augmented crew',tone:'good',delayMin:flightTotalDepartureDelayMin(flight),
          downstreamDelay:downstreamFlights.reduce((sum,item)=>sum+flightTotalDepartureDelayMin(item),0),
          misconnectPax:connectionStatusForFlight(flight).missed,risk:0,
          detail:`Crew Control calls relief crew for the ${through?'rotation':'sector'}; planned baseline ${planned?.assessment?.legal?'was legal with augmentation':'still needs disruption recovery'}.`
        }];
      }
    }
    return [{id:'crew-unavailable',label:'No legal crew configuration',tone:'bad',disabled:true,
      delayMin:flightTotalDepartureDelayMin(flight),downstreamDelay:0,misconnectPax:connectionStatusForFlight(flight).missed,risk:100,
      detail:'Even an augmented crew cannot operate this sector within the current duty model. Cancel or revise the flight plan.'}];
  }
  return plans;
}

function applyRecoveryPlan(flightId,planId){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!flight||flight.departureLogged) return toast('Recovery changes are only available before departure.');
  const plan=recoveryPlansForFlight(flight).find(item=>item.id===planId);
  if(!plan) return toast('That recovery option is no longer available.');
  if(plan.disabled) return toast(plan.detail);
  if(planId==='accept-impact'){
    acknowledgeFlightIssue(flight.id); return;
  }
  if(planId==='augment-crew'){
    flight.crewAugmented=true;
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    const family=Management.aircraftFamily(aircraft.model);
    for(const role of ['captains','firstOfficers']){
      const missing=Math.max(0,2-qualifiedStaffAt(flight.from,role,family));
      if(missing) requestPersonnelResource(role,flight.from,missing,family);
    }
    const cabinRequired=Math.max(2,Math.ceil(cabinSeatCount(aircraft)/50)*2);
    const cabinMissing=Math.max(0,cabinRequired-staffAt(flight.from,'cabinCrew'));
    if(cabinMissing) requestPersonnelResource('cabinCrew',flight.from,cabinMissing);
    flight.recoveryAction='Augmented operating crew assigned';
  }else if(planId==='expedite'){
    flight.handlingDelayMin=Math.max(0,(flight.handlingDelayMin||0)-15);
    flight.recoveryAction='Ground resources prioritized';
  }else if(planId==='use-spare'){
    const spare=incidentReplacementCandidates(flight)[0];
    if(!spare) return toast('No eligible spare remains available.');
    if(flight.serviceId){ substituteSelectedRotation(flight.id,spare.id); return; }
    flight.aircraftId=spare.id; clearAircraftSpecificDelay(flight);
    flight.recoveryAction=`Spare ${spare.tail} assigned`;
  }
  flight.issueAcknowledgedAt=0; flight.issueAcknowledgedKey='';
  recalculateOperations(); updatePassengerConnections(); AeroServices.commit();
  toast(`${flight.id}: ${plan.label} applied.`);
}

function flightIssueKey(f){
  return [f.staffingBlocked,f.maintenanceBlocked,f.positioningBlocked,f.slotMissed,f.technicalDelayMin,f.handlingDelayMin,
    f.manualDelayMin,f.weatherDelayMin,f.liveWeatherDelayMin,f.incidentDelayMin,f.airportDelayMin,f.airspaceDelayMin,f.taxiOutDelayMin,f.taxiInDelayMin,f.nightRestrictionDelayMin,f.nightRestrictionConflictDelayMin,f.propagatedDelayMin,f.slotDelayMin,f.enrouteDelayMin,
    f.connectionCriticalPax,f.connectionAtRiskPax,f.connectionMissedPax,f.crewAugmented,
    openIncidentsForFlight(f.id).map(incident=>incident.id).join(',')].join(':');
}

function requestUiRefresh(...views){
  if(typeof markUiDirty==='function') markUiDirty(...views);
  else if(typeof refreshAll==='function') refreshAll();
}

function acknowledgeFlightIssue(flightId){
  const f=state.flights.find(item=>item.id===flightId);
  if(!f) return;
  f.issueAcknowledgedAt=simNow(); f.issueAcknowledgedKey=flightIssueKey(f);
  AeroServices.persist(); requestUiRefresh('left','desk','context');
  toast(`${f.id} issue acknowledged. It will return if the situation changes.`);
}

function acknowledgeAircraftIssue(aircraftId){
  const ac=state.aircraft.find(item=>item.id===aircraftId);
  if(!ac) return;
  ac.issueAcknowledgedAt=simNow(); ac.issueAcknowledgedKey=aircraftIssueKey(ac);
  AeroServices.persist(); requestUiRefresh('left','desk','context');
  toast(`${ac.tail} issue acknowledged. It will return if the situation changes.`);
}

function maintenanceSupportAtAirport(airportCode,aircraft=null,t=simNow()){
  const airport=AIRPORTS[airportCode], market=AIRPORT_MARKETS[airportCode], costs=AIRPORT_COSTS[airportCode], ops=AIRPORT_OPS[airportCode];
  if(!airport||!market||!costs||!ops) return {available:false,score:0,source:'none',airport:airportCode,label:'No airport maintenance profile'};
  if(
    aircraft?.mobileMaintenanceAirport===airportCode&&
    Number(aircraft.mobileMaintenanceAvailableAt||0)<=t&&
    Number(aircraft.mobileMaintenanceUntil||0)>t
  ){
    return {available:true,score:80,source:'mobile_team',airport:airportCode,label:'mobile maintenance team on site'};
  }
  const stationGround=staffAt(airportCode,'groundHandling');
  const stationOps=staffAt(airportCode,'operations');
  const ownScore=Math.min(100,stationGround*6+stationOps*8);
  if(airportCode===state.home||ownScore>=42){
    return {
      available:true,score:Math.max(75,ownScore),source:airportCode===state.home?'home_base':'line_station',airport:airportCode,
      responseMin:airportCode===state.home?25:40,
      label:airportCode===state.home?'home-base line maintenance':`own line station maintenance · support ${Math.max(75,ownScore)}%`
    };
  }
  const seats=MODELS[aircraft?.model]?.seats||120;
  const heavy=seats>=250;
  const contractScore=Math.round((market.hub*.42+market.size*.34+market.business*.18+market.wealth*.06)*100);
  const available=contractScore>=(heavy?82:66)&&costs.handlingBase>0;
  return {
    available,score:available?contractScore:0,source:available?'contract':'none',airport:airportCode,
    responseMin:available?Math.round(55+(100-contractScore)*.8):0,
    label:available?`contract line maintenance · readiness ${contractScore}%`:'no modeled line-maintenance support'
  };
}

function maintenanceSupportOptions(airportCode,aircraft=null,t=simNow()){
  return Object.keys(AIRPORTS)
    .map(code=>{
      const support=maintenanceSupportAtAirport(code,aircraft,t);
      if(!support.available) return null;
      const km=AIRPORTS[airportCode]&&AIRPORTS[code]?distanceKm(AIRPORTS[airportCode],AIRPORTS[code]):Infinity;
      return {...support,km};
    })
    .filter(Boolean)
    .sort((a,b)=>a.km-b.km||b.score-a.score);
}

function mobileMaintenanceTeamPlan(incident,t=simNow()){
  const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  const airport=incident?.context?.airport||flight?.from||aircraft?.location;
  if(!flight||!aircraft||!AIRPORTS[airport]) return {available:false,reason:'The affected aircraft or airport is no longer available.'};
  const candidates=maintenanceSupportOptions(airport,aircraft,t).filter(item=>item.airport!==airport);
  if(!candidates.length) return {available:false,reason:`No maintenance-capable station can dispatch a mobile team to ${airport}.`};
  const source=candidates[0];
  const responseMin=Math.round(75+source.km/650*60);
  const cost=Math.round(3200+source.km*6+(MODELS[aircraft.model]?.seats||120)*18);
  return {
    available:true,aircraft,flight,airport,source:source.airport,sourceLabel:source.label,
    responseMin,cost,arrivesAt:t+responseMin*MIN,
    reason:`Mobile team from ${source.airport} can reach ${airport} in about ${responseMin} minutes.`
  };
}

function applyMobileMaintenanceTeam(incident){
  const plan=mobileMaintenanceTeamPlan(incident);
  if(!plan.available) return toast(plan.reason);
  plan.aircraft.mobileMaintenanceAirport=plan.airport;
  plan.aircraft.mobileMaintenanceAvailableAt=plan.arrivesAt;
  plan.aircraft.mobileMaintenanceUntil=plan.arrivesAt+8*HOUR;
  plan.aircraft.mobileMaintenanceSource=plan.source;
  plan.flight.economics??={ticketRevenue:plan.flight.revenue||0};
  plan.flight.economics.recoveryOps=(Number(plan.flight.economics.recoveryOps)||0)+plan.cost;
  refreshEconomicsTotals(plan.flight);
  postTransaction(-plan.cost,'Mobile maintenance',`${plan.aircraft.tail} team ${plan.source} → ${plan.airport}`,plan.flight.id);
  return plan;
}

function maintenanceFerryPlanState(incident,t=simNow()){
  const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  const from=incident?.context?.airport||flight?.from||aircraft?.location;
  if(!flight||!aircraft||!AIRPORTS[from]) return {ready:false,reason:'The affected aircraft or airport is no longer available.'};
  if(incident?.technicalContext?.deferAllowed===false||aircraft.defectUntil>t){
    return {ready:false,flight,aircraft,from,to:'',reason:'This aircraft is not legal to ferry until Maintenance Control clears a ferry permit or sends support to the aircraft.'};
  }
  const capable=maintenanceSupportOptions(from,aircraft,t).filter(item=>item.airport!==from);
  if(!capable.length) return {ready:false,reason:`No maintenance-capable airport is available for ${aircraft.tail}.`};
  const ferry=(state.flights||[]).find(item=>
    item.flightType==='ferry'&&item.aircraftId===aircraft.id&&!item.cancelled&&!item.settled&&
    item.from===from&&capable.some(candidate=>candidate.airport===flightOperationalDestination(item))&&
    flightActualDeparture(item)>=t-5*MIN
  );
  if(!ferry){
    return {
      ready:false,aircraft,flight,from,to:capable[0].airport,
      reason:`Create a ferry flight from ${from} to a maintenance-capable station, for example ${capable[0].airport}.`
    };
  }
  return {ready:true,aircraft,flight,from,to:flightOperationalDestination(ferry),ferry,reason:`${ferry.id} positions ${aircraft.tail} to maintenance support at ${flightOperationalDestination(ferry)}.`};
}

function maintenanceResourceContextForFlight(flight,t=simNow()){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged||flight.flightType==='ferry') return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!aircraft) return null;
  const status=Management.maintenanceStatus(aircraft,t);
  const postflight=postflightTechnicalContextForFlight(flight,t);
  const maintenanceNeeded=Boolean(
    status?.grounding||
    aircraft.defectUntil>t||
    postflight?.reason==='scheduled maintenance due after inbound'||
    (postflight?.active&&postflight.delayMin>=45)
  );
  if(!maintenanceNeeded) return null;
  const support=maintenanceSupportAtAirport(flight.from,aircraft,t);
  if(support.available) return null;
  return {
    sourceId:flight.id,
    aircraftId:aircraft.id,
    tail:aircraft.tail,
    airport:flight.from,
    reason:aircraft.defectReason||postflight?.reason||status?.label||'Maintenance required',
    supportLabel:support.label,
    active:true
  };
}

function createMaintenanceResourceIncidentForAircraft(aircraft,airport,context={}){
  const flight=(state.flights||[]).filter(item=>
    item.aircraftId===aircraft.id&&!item.cancelled&&!item.settled&&!item.departureLogged&&item.from===airport
  ).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||a.id.localeCompare(b.id))[0];
  if(!flight) return null;
  const incidentContext={
    sourceId:`${aircraft.id}:${airport}:maintenance-resource`,
    aircraftId:aircraft.id,tail:aircraft.tail,airport,
    reason:context.reason||aircraft.defectReason||'Maintenance required',
    supportLabel:context.supportLabel||maintenanceSupportAtAirport(airport,aircraft).label,
    active:true
  };
  return createIncident('maintenance_resource_unavailable',flight,{
    detectedAt:simNow(),source:'derived',
    sourceKey:`derived:maintenance_resource_unavailable:${aircraft.id}:${airport}`,
    context:incidentContext
  });
}

function requestAircraft(modelName,cabin=defaultCabin(modelName),location=state.home){
  if(!MODELS[modelName]) return;
  const deliveryAirport=AIRPORTS[location]?location:state.home;
  const supply=resourceAvailability('aircraft',modelName,deliveryAirport);
  if(!supply.available){
    const request=queueResourceRequest('aircraft',{key:modelName,location:deliveryAirport,model:modelName,cabin},supply);
    requestUiRefresh('all'); toast(`${modelName} requested for ${deliveryAirport}. Allocation expected ${formatTime(request.readyAt)}.`); return request;
  }
  const ac=assignRequestedAircraft(modelName,cabin,deliveryAirport);
  AeroServices.commit(); toast(`${ac.tail} assigned from the operations pool at ${deliveryAirport}.`); return ac;
}

function aircraftHasAssignments(acId,t=simNow()){
  const aircraft=state.aircraft.find(item=>item.id===acId);
  const groundOperation=aircraft&&aircraftGroundOperation(aircraft,t);
  return state.services.some(s=>s.active&&s.aircraftId===acId)||
    state.flights.some(f=>f.aircraftId===acId&&!f.cancelled&&flightActualArrival(f)>t)||
    Boolean(groundOperation?.phase.key==='postflight'&&groundOperation.phase.status!=='complete');
}

function releaseAircraft(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac||aircraftHasAssignments(ac.id)) return toast('Remove this aircraft’s active and future assignments first.');
  if(!AeroServices.confirm(`Release ${ac.tail} (${ac.model}) from the operations pool?`)) return;
  state.aircraft=state.aircraft.filter(a=>a.id!==ac.id);
  if(selectedAircraftId===ac.id) selectedAircraftId=null;
  if(selectedFlightId&&state.flights.find(f=>f.id===selectedFlightId)?.aircraftId===ac.id) selectedFlightId=null;
  AeroServices.commit(); toast(`${ac.tail} released from the operations pool.`);
}

function settleSelected(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac) return;

  selectedAircraftId=acId;
  AeroServices.openContextWorkbench({scroll:'widget'});
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function settleSelectedFlight(flightId){
  const f=state.flights.find(x=>x.id===flightId);
  if(!f) return;

  selectedFlightId=f.id;
  if(!selectedAircraftId||!state.aircraft.some(ac=>ac.id===selectedAircraftId)) selectedAircraftId=f.aircraftId;
  alignScheduleWindowToFlight(f);

  AeroServices.openContextWorkbench({scroll:'top'});
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function clearSelectedFlight(){
  selectedFlightId=null;
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function clearSelectedAircraft(){
  selectedAircraftId=null;
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function toggleAircraftCard(acId){
  if(selectedAircraftId===acId){
    selectedAircraftId=null;
    routeSignature='';
    requestUiRefresh('left','desk','context','schedule','map','weather','management');
    return;
  }
  settleSelected(acId);
}
