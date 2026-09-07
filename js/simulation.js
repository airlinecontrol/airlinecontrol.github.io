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
function flightIsInOperation(f,t=simNow()){
  return Boolean(f && !f.cancelled && !f.settled && f.departureLogged && flightActualDeparture(f)<=t && t<flightActualArrival(f));
}
function flightIsAirborne(f,t=simNow()){
  if(!flightIsInOperation(f,t)) return false;
  const movement=flightMovementTimes(f);
  return t>=movement.takeoffAt && t<movement.landingAt;
}

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
    flights.sort((a,b)=>a.departure-b.departure||a.id.localeCompare(b.id));
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

function aircraftProjectedLocation(ac,t=simNow()){
  const now=simNow();
  if(!ac) return {location:state.home,availableAt:now,status:'unknown'};
  let location=ac.location,availableAt=now;
  const legs=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualArrival(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||flightActualArrival(a)-flightActualArrival(b));
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

function validateAircraftItinerary(ac,proposedLegs=[]){
  const now=simNow();
  const legs=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualArrival(f)>now)
    .map(f=>({from:f.from,to:flightOperationalDestination(f),departure:flightActualDeparture(f),arrival:flightActualArrival(f),label:f.id,existing:true,departureLogged:Boolean(f.departureLogged)}))
    .concat(proposedLegs)
    .sort((a,b)=>a.departure-b.departure||a.arrival-b.arrival);
  let location=ac.location,availableAt=now,previousLeg=null;
  for(const leg of legs){
    if(leg.existing&&leg.departureLogged&&leg.departure<=now&&now<leg.arrival){
      location=leg.to;
      availableAt=leg.arrival+minimumTurnMinutes(ac,leg.to)*MIN;
      previousLeg=leg;
      continue;
    }
    if(leg.departure<availableAt){
      if(previousLeg&&leg.from===previousLeg.to&&leg.departure>=previousLeg.arrival){
        const actualTurn=Math.round((leg.departure-previousLeg.arrival)/MIN);
        const minimumTurn=minimumTurnMinutes(ac,leg.from);
        return {ok:false,reason:`turnaround before ${leg.label||'this leg'} is ${actualTurn} min; ${ac.model} requires ${minimumTurn} min at ${leg.from}`};
      }
      return {ok:false,reason:`overlaps ${leg.label||'another planned leg'}`};
    }
    if(leg.from!==location) return {ok:false,reason:`aircraft will be at ${location}, not ${leg.from}, before ${leg.label||'this leg'}`};
    location=leg.to;
    availableAt=leg.arrival+minimumTurnMinutes(ac,leg.to)*MIN;
    previousLeg=leg;
  }
  return {ok:true};
}
function statusOfFlight(f,t=simNow()){
  if(f.cancelled) return 'cancelled';
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  if(f.departureLogged&&t<arr){
    const movement=flightMovementTimes(f);
    if(t<movement.takeoffAt) return 'taxi_out';
    if(t>=movement.landingAt) return 'taxi_in';
    return 'airborne';
  }
  if(t<dep){
    if(flightTotalDepartureDelayMin(f)>0 && t>=f.departure-90*MIN) return 'delayed';
    return 'scheduled';
  }
  if(t<arr&&!f.departureLogged) return 'delayed';
  return 'arrived';
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
  const minimumMin=minimumTurnMinutes(ac,next.from);
  const actualGapMin=Math.round((flightActualDeparture(next)-flightActualArrival(previous))/MIN);
  const plannedGapMin=Math.round((next.departure-previous.arrival)/MIN);
  const limitingGapMin=Math.min(actualGapMin,plannedGapMin);
  const belowMinimum=sameStation&&limitingGapMin<minimumMin;
  const shortageMin=Math.max(0,minimumMin-limitingGapMin);
  const limitingGapLabel=limitingGapMin<0?'overlap':`${limitingGapMin} min`;
  return {
    sameStation,minimumMin,actualGapMin,plannedGapMin,limitingGapMin,belowMinimum,shortageMin,
    title:belowMinimum
      ? `${previous.id} to ${next.id}: turnaround ${limitingGapLabel}, minimum ${minimumMin} min for ${ac.model} · planned ${plannedGapMin} min · actual ${actualGapMin} min`
      : `${previous.id} to ${next.id}: ground time ${actualGapMin} min, minimum ${minimumMin} min for ${ac.model}`
  };
}

function previousAircraftFlight(flight){
  return state.flights
    .filter(other=>other.aircraftId===flight.aircraftId&&!other.cancelled&&other.id!==flight.id&&other.departure<flight.departure)
    .sort((a,b)=>b.departure-a.departure)[0]||null;
}

function lateInboundStatusForFlight(flight,t=simNow(),context={}){
  if(!flight||flight.cancelled||flight.settled||flight.departureLogged||flight.flightType==='ferry') return {active:false,delayMin:0};
  const index=context.index||operationalIndex(t);
  const aircraft=context.aircraft||index.aircraftById.get(flight.aircraftId)||state.aircraft.find(item=>item.id===flight.aircraftId);
  const previous=context.previous||index.previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  if(!aircraft||!previous||flightOperationalDestination(previous)!==flight.from) return {active:false,delayMin:0};
  const recoveredTurn=Math.max(0,Number(flight.turnaroundRecoveryMin)||0);
  const turnMin=Math.max(25,minimumTurnMinutes(aircraft,flight.from)-recoveredTurn);
  const inboundReadyAt=flightActualArrival(previous)+turnMin*MIN;
  const delayMin=Math.max(0,Math.ceil((inboundReadyAt-flight.departure)/MIN));
  const active=delayMin>=15;
  return {
    active,delayMin,previousFlightId:previous.id,inboundReadyAt,turnMin,
    title:active?`Late inbound: ${previous.id} ready ${formatTime(inboundReadyAt)} · +${delayMin} min`:''
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
  const distance=distanceKm(AIRPORTS[flight.from],AIRPORTS[flightOperationalDestination(flight)]);
  const airspace=OperationalIntelligence.airspaceConstraint(flight.from,flightOperationalDestination(flight),flight.departure,distance);
  const routeWeather=window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,flightOperationalDestination(flight),flight.departure);
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
    const flights=(flightsByAircraft.get(ac.id)||[]).sort((x,y)=>x.departure-y.departure);
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
      if(ac.defectUntil && ac.defectUntil>ready && f.departure<ac.defectUntil){
        ready=ac.defectUntil;
      }
      const operationalDuration=Number.isFinite(f.operationalDurationMs)?f.operationalDurationMs:f.arrival-f.departure;
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
      const preliminaryArrival=f.actualDeparture+operationalDuration+f.enrouteDelayMin*MIN;
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

const INCIDENT_TYPE_ORDER=[
  'crew_sick','mel_defect','atc_restriction','gate_conflict','destination_closure_ground','destination_closure',
  'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect',
  'crew_misconnect','crew_misposition_after_diversion','crew_report_delayed','no_legal_crew','crew_duty_extension',
  'airport_capacity_reduction','atc_ground_stop','night_curfew_conflict','arrival_curfew_coordination','performance_limited','destination_handling_unavailable',
  'fueling_issue','fuel_supplier_outage','deicing_required','deicing_capacity_collapse','security_screening','crew_fatigue_report','bird_strike'
];
const INCIDENT_DEFINITIONS={
  crew_sick:{title:'Crew sick call',severity:'critical',decisionMin:30,summary:'A required operating crew member reported unavailable.'},
  mel_defect:{title:'Ground technical defect',severity:'critical',decisionMin:25,summary:'A pre-departure aircraft defect requires maintenance-control disposition.'},
  atc_restriction:{title:'ATC flow restriction',severity:'warning',decisionMin:35,summary:'Air traffic control issued a regulated departure window.'},
  gate_conflict:{title:'Gate conflict',severity:'warning',decisionMin:30,summary:'The planned gate is unavailable for this departure.'},
  destination_closure_ground:{title:'Destination closure',severity:'critical',decisionMin:35,summary:'The destination is unavailable before departure and needs an OCC operating decision.'},
  destination_closure:{title:'Destination closure',severity:'critical',decisionMin:20,summary:'The destination airport became unavailable while the flight is airborne.',allowAirborne:true,airborneOnly:true},
  aircraft_out_of_position:{title:'Aircraft out of position',severity:'critical',decisionMin:35,summary:'The assigned aircraft is not projected to be at the planned origin in time.'},
  aircraft_misposition_after_diversion:{title:'Aircraft misposition after diversion',severity:'critical',decisionMin:40,summary:'A previous diversion left the assigned aircraft away from the next planned origin.'},
  postflight_technical_defect:{title:'Post-flight technical defect',severity:'critical',decisionMin:30,summary:'The inbound aircraft needs engineering disposition before the next sector.'},
  crew_duty_risk:{title:'Crew duty risk',severity:'critical',decisionMin:40,summary:'The planned duty is projected to exceed the crew duty envelope.'},
  crew_fatigue_report:{title:'Crew fatigue report',severity:'critical',decisionMin:30,summary:'A crew member reported fatigue or fitness concerns before departure.'},
  crew_fatigue_mid_rotation:{title:'Crew fatigue mid-rotation',severity:'critical',decisionMin:30,summary:'The active crew duty has too little margin for the remaining sector.'},
  crew_duty_extension:{title:'Crew duty extension required',severity:'warning',decisionMin:25,summary:'The airborne duty is now projected beyond the crew duty limit; OCC must coordinate support and downstream crew recovery.',allowAirborne:true,airborneOnly:true},
  crew_misconnect:{title:'Crew misconnect',severity:'critical',decisionMin:30,summary:'Positioned crew is projected to miss the report time for this departure.'},
  crew_misposition_after_diversion:{title:'Crew misposition after diversion',severity:'critical',decisionMin:35,summary:'The through crew is away from the next departure station after a diversion.'},
  crew_report_delayed:{title:'Crew report delayed',severity:'warning',decisionMin:30,summary:'The assigned operating crew is not expected to complete report and briefing on time.'},
  no_legal_crew:{title:'No legal crew for departure',severity:'critical',decisionMin:35,summary:'No complete legal qualified crew is available at the departure station.'},
  slot_miss_risk:{title:'Slot miss impact',severity:'warning',decisionMin:25,summary:'The flight is projected to miss its planned airport departure slot.'},
  baggage_loading_issue:{title:'Loadsheet reissue',severity:'warning',decisionMin:30,summary:'A station baggage issue now requires weight-and-balance or load-control reissue.'},
  fueling_issue:{title:'Fuel uplift constraint',severity:'warning',decisionMin:25,summary:'Fuel supply or uplift timing affects departure readiness.'},
  fuel_supplier_outage:{title:'Fuel supplier outage',severity:'critical',decisionMin:30,summary:'The departure fuel provider has a local outage or truck shortage before departure.'},
  deicing_required:{title:'Deicing required',severity:'warning',decisionMin:35,summary:'Departure weather requires aircraft deicing before takeoff.'},
  deicing_capacity_collapse:{title:'Deicing capacity collapse',severity:'critical',decisionMin:30,summary:'Winter weather and local demand have overwhelmed the departure deicing queue.'},
  holdover_expired:{title:'Deicing holdover expired',severity:'critical',decisionMin:20,summary:'The treated aircraft exceeded its usable holdover window before takeoff.'},
  airport_capacity_reduction:{title:'Airport capacity reduction',severity:'warning',decisionMin:35,summary:'A temporary airport capacity reduction is affecting departure flow.'},
  atc_ground_stop:{title:'ATC ground stop',severity:'critical',decisionMin:25,summary:'A destination or airspace ground stop prevents normal departure release.'},
  night_curfew_conflict:{title:'Night curfew conflict',severity:'critical',decisionMin:30,summary:'A delay now pushes the flight into an airport night curfew and needs an OCC recovery decision.'},
  arrival_curfew_coordination:{title:'Arrival curfew coordination',severity:'critical',decisionMin:18,summary:'The airborne flight is projected to arrive inside a hard night curfew and needs arrival acceptance coordination.',allowAirborne:true,airborneOnly:true},
  performance_limited:{title:'Performance limited',severity:'critical',decisionMin:35,summary:'Route, fuel, weather, or MEL limits erode dispatch performance margin.'},
  destination_handling_unavailable:{title:'Destination handling unavailable',severity:'warning',decisionMin:35,summary:'The destination station cannot currently accept the arriving aircraft.',allowAirborne:true},
  security_screening:{title:'Security offload / manifest issue',severity:'critical',decisionMin:25,summary:'A security irregularity requires passenger, baggage, manifest, or departure coordination.'},
  bird_strike:{title:'Suspected bird strike',severity:'critical',decisionMin:18,summary:'The flight deck reports a suspected bird strike while airborne.',allowAirborne:true,airborneOnly:true},
  onboard_medical:{title:'Onboard medical case',severity:'critical',decisionMin:20,summary:'The flight deck reports a medical case requiring OCC coordination.',allowAirborne:true,airborneOnly:true},
  inflight_technical_fault:{title:'Inflight technical fault',severity:'critical',decisionMin:20,summary:'The flight deck reports a technical abnormality requiring flight-watch coordination.',allowAirborne:true,airborneOnly:true},
  fuel_margin_low:{title:'Fuel margin low',severity:'critical',decisionMin:18,summary:'Projected landing fuel is below the planned operational margin.',allowAirborne:true,airborneOnly:true},
  atc_holding_fuel_conflict:{title:'ATC holding fuel conflict',severity:'critical',decisionMin:18,summary:'Assigned airborne delay is eroding fuel margin before arrival.',allowAirborne:true,airborneOnly:true},
  airborne_atc_reroute:{title:'Airborne ATC reroute',severity:'warning',decisionMin:25,summary:'The aircraft is assigned an amended airborne route with arrival and fuel impact.',allowAirborne:true,airborneOnly:true},
  unruly_passenger:{title:'Unruly passenger',severity:'critical',decisionMin:20,summary:'Cabin crew report a disruptive passenger requiring flight deck and security coordination.',allowAirborne:true,airborneOnly:true},
  destination_weather_deterioration:{title:'Destination weather deterioration',severity:'warning',decisionMin:25,summary:'Destination weather is trending below normal operating capacity while the flight is airborne.',allowAirborne:true,airborneOnly:true},
  destination_below_minima:{title:'Destination below landing minima',severity:'critical',decisionMin:15,summary:'Forecast arrival weather is below practical landing minima.',allowAirborne:true,airborneOnly:true},
  alternate_unsuitable:{title:'Alternate suitability risk',severity:'warning',decisionMin:25,summary:'The available alternate picture no longer supports the current flight-watch plan.',allowAirborne:true,airborneOnly:true},
  diversion_airport_unavailable:{title:'Diversion airport unavailable',severity:'critical',decisionMin:12,summary:'The selected diversion airport can no longer accept the flight.',allowAirborne:true,airborneOnly:true},
  lightning_strike:{title:'Lightning strike',severity:'critical',decisionMin:18,summary:'The aircraft crossed convective weather and reports a possible lightning strike.',allowAirborne:true,airborneOnly:true},
  pressurization_issue:{title:'Pressurization issue',severity:'critical',decisionMin:15,summary:'The flight deck reports abnormal pressurization requiring immediate flight-watch support.',allowAirborne:true,airborneOnly:true}
};
const RETIRED_INCIDENT_TYPES=new Set(['slot_miss_risk','aircraft_late_inbound']);
const DERIVED_INCIDENT_TYPES=new Set([
  'aircraft_out_of_position','aircraft_misposition_after_diversion','postflight_technical_defect','crew_duty_risk',
  'crew_fatigue_mid_rotation','crew_misconnect','crew_misposition_after_diversion','no_legal_crew','crew_duty_extension',
  'deicing_required','deicing_capacity_collapse','holdover_expired','airport_capacity_reduction','atc_ground_stop','night_curfew_conflict','arrival_curfew_coordination','performance_limited',
  'destination_handling_unavailable','fuel_margin_low','atc_holding_fuel_conflict','airborne_atc_reroute','destination_weather_deterioration',
  'destination_below_minima','alternate_unsuitable','diversion_airport_unavailable','lightning_strike'
]);

function openIncidentsForFlight(flightId){
  return operationalIndex().openIncidentsByFlight.get(flightId)||[];
}

function crewSickRoleForFlight(flight){
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  const cabinNeed=aircraft?Math.max(1,Math.ceil(cabinSeatCount(aircraft)/50)):3;
  const options=[
    {role:'captains',weight:1},
    {role:'firstOfficers',weight:1},
    {role:'cabinCrew',weight:Math.min(4,cabinNeed)}
  ];
  let roll=Math.random()*options.reduce((total,item)=>total+item.weight,0);
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

function createIncident(type,flight,{training=false,detectedAt=simNow(),source='random',sourceKey='',context=null}={}){
  if(type==='destination_closure'&&flight&&!flightIsAirborne(flight,detectedAt)) type='destination_closure_ground';
  const definition=INCIDENT_DEFINITIONS[type];
  if(RETIRED_INCIDENT_TYPES.has(type)||!definition||!flight||flight.cancelled||flight.settled) return null;
  if(!training&&!flight.departureLogged&&!definition.airborneOnly){
    const leadMin=definition.maxAutoLeadMin||(source==='derived'?360:180);
    if(detectedAt<flightActualDeparture(flight)-leadMin*MIN) return null;
  }
  if(flight.departureLogged&&!definition.allowAirborne) return null;
  if(definition.airborneOnly&&!flightIsAirborne(flight,detectedAt)) return null;
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
  const duplicate=state.incidents.find(incident=>incident.flightId===flight.id&&incident.type===type&&incident.status==='open'&&(!sourceKey||incident.sourceKey===sourceKey));
  if(duplicate){
    const parent=duplicate.triggeredByIncidentId?null:findIncidentCaseParent(type,flight,context,detectedAt,source,sourceKey);
    duplicate.context=context||duplicate.context||null;
    duplicate.lastDetectedAt=detectedAt;
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
    technicalContext:['mel_defect','postflight_technical_defect'].includes(type)?OperationalIntelligence.melFinding(id,detectedAt):null,
    classification:OperationalWorkflows.WORKFLOWS[type]?.classification||'incident',workflowCreatedAt:0,overdue:false,
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
  if(state.incidents.length>250){
    const removable=state.incidents.findIndex(item=>item.status!=='open');
    if(removable>=0) state.incidents.splice(removable,1);
  }
  invalidateOperationalIndex();
  return incident;
}

const PRE_DEPARTURE_INCIDENT_GENERATORS=[
  {type:'crew_sick',weight:1.05,eligible:f=>flightUsesLocalCrew(f)},
  {type:'mel_defect',weight:.9,eligible:(f,t)=>Management.maintenanceStatus(state.aircraft.find(a=>a.id===f.aircraftId),t)?.due||Math.random()<.45},
  {type:'atc_restriction',weight:1},
  {type:'gate_conflict',weight:.85},
  {type:'destination_closure_ground',weight:.5,eligible:f=>distanceKm(AIRPORTS[f.from],AIRPORTS[f.to])>250},
  {type:'fueling_issue',weight:.75},
  {type:'fuel_supplier_outage',weight:.45},
  {type:'security_screening',weight:.55,eligible:f=>f.flightType!=='ferry'},
  {type:'crew_fatigue_report',weight:.55,eligible:f=>flightUsesLocalCrew(f)},
  {type:'crew_report_delayed',weight:.45,eligible:f=>flightUsesLocalCrew(f)}
];

const GROUND_DELAY_CAUSES=[
  {label:'Baggage loading delay',weight:1.1,passengerOnly:true},
  {label:'Load-control closeout delay',weight:.75,passengerOnly:true},
  {label:'Boarding flow delay',weight:.9,passengerOnly:true},
  {label:'Catering service delay',weight:.55,passengerOnly:true},
  {label:'Ground equipment delay',weight:.9},
  {label:'Ramp sequencing delay',weight:.8}
];

function chooseGroundDelayCause(f){
  const options=GROUND_DELAY_CAUSES.filter(item=>!item.passengerOnly||f.flightType!=='ferry');
  let roll=Math.random()*options.reduce((total,item)=>total+item.weight,0);
  for(const option of options){
    roll-=option.weight;
    if(roll<=0) return option.label;
  }
  return 'Ground handling delay';
}

function chooseIncidentGenerator(f,t){
  const options=PRE_DEPARTURE_INCIDENT_GENERATORS.filter(item=>!item.eligible||item.eligible(f,t));
  let roll=Math.random()*options.reduce((total,item)=>total+item.weight,0);
  for(const option of options){
    roll-=option.weight;
    if(roll<=0) return option;
  }
  return options[0]||null;
}

function maybeGenerateOperationalIncident(f,t){
  if(f.cancelled||f.settled||f.departureLogged||!state.ops.automaticDisruptions) return false;
  f.incidentChecks??={};
  if(f.incidentChecks.operationalGeneration||t<f.departure-120*MIN||t>=f.departure) return false;
  f.incidentChecks.operationalGeneration=true;
  if(!openIncidentsForFlight(f.id).length&&Math.random()<.16){
    const generator=chooseIncidentGenerator(f,t);
    if(generator){
      const context=generatedIncidentContext(generator.type,f,t);
      createIncident(generator.type,f,{detectedAt:t,source:'random',sourceKey:`random:${f.id}`,context});
    }
  }
  return true;
}

function generatedIncidentContext(type,flight,t=simNow()){
  const roll=OperationalIntelligence.stableUnit(`${flight.id}:${type}:context`);
  if(type==='fuel_supplier_outage'){
    const reasons=['Fuel-truck fleet shortage','Supplier hydrant pump outage','Fuel farm delivery interruption','Airport fuel provider staffing gap'];
    const reason=reasons[Math.min(reasons.length-1,Math.floor(roll*reasons.length))];
    return {
      sourceId:flight.id,
      airport:flight.from,
      reason,
      delayMin:45+Math.round(roll*45),
      active:true
    };
  }
  if(type==='crew_report_delayed'){
    const roles=['captains','firstOfficers','cabinCrew'];
    const reasons=['Crew transport delay','Security access delay','Late crew hotel shuttle','Crew briefing package reissue'];
    const role=roles[Math.min(roles.length-1,Math.floor(roll*roles.length))];
    const reason=reasons[Math.min(reasons.length-1,Math.floor(OperationalIntelligence.stableUnit(`${flight.id}:${type}:reason`)*reasons.length))];
    return {
      sourceId:flight.id,
      role,
      airport:flight.from,
      reason,
      reportReadyAt:flight.departure+(15+Math.round(roll*35))*MIN,
      delayMin:15+Math.round(roll*35),
      active:true
    };
  }
  return null;
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
  const projectedLandingFuel=Math.max(0,onboard-tripBurn-delayBurn);
  const remainingNow=Math.max(0,onboard-tripBurn*progress-delayBurn*progress);
  const marginRatio=reserve?projectedLandingFuel/reserve:1;
  return {
    ...airborneContextForFlight(flight,t),
    remainingNowGal:Math.round(remainingNow),
    projectedLandingFuelGal:Math.round(projectedLandingFuel),
    reserveGal:Math.round(reserve),
    marginPct:Math.round(marginRatio*100),
    delayBurnGal:Math.round(delayBurn),
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
  const routeWeather=window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,destination,t);
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
      distanceKm:Math.round(item.distanceKm||0)
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
  const projection=aircraftProjectedLocation(aircraft,flightActualDeparture(flight));
  const active=aircraftActiveFlight(aircraft.id,t);
  const expectedLocation=projection.location || (active?flightOperationalDestination(active):aircraft.location);
  return {
    sourceId:flight.id,
    aircraftId:aircraft.id,
    tail:aircraft.tail,
    expectedLocation,
    requiredLocation:flight.from,
    delayMin:Math.max(15,Number(flight.positioningDelayMin)||15),
    active:expectedLocation!==flight.from || ['position_conflict','stale_unflown'].includes(projection.status)
  };
}

function aircraftMispositionAfterDiversionContextForFlight(flight,t=simNow()){
  if(flight.departureLogged||flight.flightType==='ferry'||t<flight.departure-8*HOUR) return null;
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const previous=operationalIndex(t).previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  if(!aircraft||!previous||!previous.diversionAirport) return null;
  const divertedTo=flightOperationalDestination(previous);
  if(divertedTo===flight.from||!AIRPORTS[divertedTo]||!AIRPORTS[flight.from]) return null;
  const projection=aircraftProjectedLocation(aircraft,flightActualDeparture(flight));
  const active=projection.location!==flight.from||['position_conflict','stale_unflown'].includes(projection.status);
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
  if(!aircraft||!previous||flightOperationalDestination(previous)!==flight.from) return null;
  const previousArrival=flightActualArrival(previous);
  if(previousArrival>t||previousArrival<t-4*HOUR) return null;
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
  return {
    sourceId:flight.id,
    routeKm:Math.round(routeKm),
    usableRangeKm:Math.round(usableRange),
    rangeMarginKm:Math.round(rangeMarginKm),
    fuelRequiredGal:Math.round(plan.requiredGal),
    fuelCapacityGal:Math.round(performance.fuelCapacityGal),
    fuelMarginGal:Math.round(fuelMarginGal),
    weather:weather.conditions,
    melPenalty,
    payloadReductionPct,
    delayMin:weather.level==='normal'?20:45,
    active:true
  };
}

function destinationHandlingContextForFlight(flight,t=simNow()){
  if(flight.flightType==='ferry'||t<flight.departure-6*HOUR||flight.settled) return null;
  const destination=flightOperationalDestination(flight);
  const trackedStation=Boolean(state.personnel.assignments?.[destination]);
  const handling=staffAt(destination,'groundHandling');
  const relevant=trackedStation||Boolean(flight.diversionAirport);
  if(!relevant||handling>0) return null;
  return {
    sourceId:flight.id,
    airport:destination,
    handling,
    contractedStation:!trackedStation,
    delayMin:flight.departureLogged?25:35,
    active:true
  };
}

function diversionAirportUnavailableContextForFlight(flight,t=simNow()){
  if(!flight.diversionAirport||!flightIsAirborne(flight,t)) return null;
  const airport=flight.diversionAirport;
  const weather=Management.weatherAt(airport,t+30*MIN);
  const handling=staffAt(airport,'groundHandling');
  const weatherBlocked=weather.level==='severe'&&weather.capacityFactor<.72;
  const handlingBlocked=handling<=0;
  const active=weatherBlocked||handlingBlocked;
  if(!active) return null;
  return {
    ...airborneContextForFlight(flight,t),
    sourceId:flight.id,
    airport,
    conditions:weather.conditions,
    level:weather.level,
    capacityPct:Math.round(weather.capacityFactor*100),
    handling,
    reason:weatherBlocked?`${airport} weather deteriorated below acceptance`:`${airport} handling no longer available`,
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

function updateOpenDerivedIncident(type,flight,active,context,t){
  const key=context?.sourceKey||`derived:${type}:${context?.sourceId||flight.id}`;
  const incident=state.incidents.find(item=>item.status==='open'&&item.type===type&&item.flightId===flight.id&&item.sourceKey===key);
  if(active){
    if(!incident&&state.incidents.some(item=>item.type===type&&item.flightId===flight.id&&item.sourceKey===key&&item.status==='resolved')) return false;
    if(incident){
      const previous=JSON.stringify(incident.context||null);
      const next=JSON.stringify(context||null);
      if(previous!==next){ incident.context=context; incident.lastDetectedAt=t; return true; }
      return false;
    }
    return Boolean(createIncident(type,flight,{detectedAt:t,source:'derived',sourceKey:key,context}));
  }
  if(incident&&!incidentTasks(incident.id).some(task=>task.status==='completed')){
    incident.status='resolved'; incident.blocking=false; incident.resolvedAt=t;
    incident.automaticResolution=true; incident.selectedAction='condition_cleared';
    incident.outcome='The underlying operational risk cleared before OCC action was needed.';
    for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
    return true;
  }
  return false;
}

function retireScheduleTrackedIncidents(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>['slot_miss_risk','aircraft_late_inbound'].includes(item.type)&&item.status==='open')){
    incident.status='resolved';
    incident.blocking=false;
    incident.resolvedAt=t;
    incident.automaticResolution=true;
    incident.selectedAction='tracked_on_schedule';
    incident.outcome=incident.type==='aircraft_late_inbound'
      ? 'Late inbound risk is tracked directly on the schedule instead of as a standalone incident.'
      : 'Slot risk is tracked on the schedule and as linked disruption context instead of as a standalone incident.';
    for(const task of incidentTasks(incident.id)){
      if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
    }
    changed=true;
  }
  return changed;
}

function processDerivedOperationalIncidents(t=simNow()){
  let changed=retireScheduleTrackedIncidents(t);
  if(!state.ops.automaticDisruptions) return changed;
  for(const flight of state.flights){
    if(flight.cancelled||flight.settled) continue;
    const dep=flightActualDeparture(flight), arr=flightActualArrival(flight);
    const preDeparture=!flight.departureLogged&&dep>t;
    if(preDeparture&&t>=flight.departure-6*HOUR){
      const duty=crewDutyForFlight(flight);
      const dutyActive=!duty.legal&&flight.flightType!=='ferry';
      const dutyContext={sourceId:flight.id,dutyHours:duty.dutyHours,maxHours:duty.maxHours,label:duty.label};
      if(updateOpenDerivedIncident('crew_duty_risk',flight,dutyActive,dutyContext,t)) changed=true;

      const diversionAircraftContext=aircraftMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('aircraft_misposition_after_diversion',flight,Boolean(diversionAircraftContext?.active),diversionAircraftContext,t)) changed=true;

      const positionContext=aircraftOutOfPositionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('aircraft_out_of_position',flight,Boolean(positionContext?.active&&!diversionAircraftContext?.active),positionContext,t)) changed=true;

      const postflightContext=postflightTechnicalContextForFlight(flight,t);
      if(updateOpenDerivedIncident('postflight_technical_defect',flight,Boolean(postflightContext?.active),postflightContext,t)) changed=true;

      const legalCrewContext=legalCrewContextForFlight(flight,t);
      if(updateOpenDerivedIncident('no_legal_crew',flight,Boolean(legalCrewContext?.active),legalCrewContext,t)) changed=true;

      const crewMisconnectContext=crewMisconnectContextForFlight(flight,t);
      if(updateOpenDerivedIncident('crew_misconnect',flight,Boolean(crewMisconnectContext?.active),crewMisconnectContext,t)) changed=true;

      const crewDiversionContext=crewMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('crew_misposition_after_diversion',flight,Boolean(crewDiversionContext?.active),crewDiversionContext,t)) changed=true;

      const fatigueContext=crewFatigueMidRotationContextForFlight(flight);
      if(updateOpenDerivedIncident('crew_fatigue_mid_rotation',flight,Boolean(fatigueContext?.active),fatigueContext,t)) changed=true;

      const capacityContext=airportCapacityContextForFlight(flight,t);
      if(updateOpenDerivedIncident('airport_capacity_reduction',flight,Boolean(capacityContext?.active),capacityContext,t)) changed=true;

      const groundStopContext=atcGroundStopContextForFlight(flight,t);
      if(updateOpenDerivedIncident('atc_ground_stop',flight,Boolean(groundStopContext?.active),groundStopContext,t)) changed=true;

      const nightCurfewContext=nightCurfewConflictContextForFlight(flight,dep);
      if(updateOpenDerivedIncident('night_curfew_conflict',flight,Boolean(nightCurfewContext?.active),nightCurfewContext,t)) changed=true;

      const performanceContext=performanceLimitContextForFlight(flight,t);
      if(updateOpenDerivedIncident('performance_limited',flight,Boolean(performanceContext?.active),performanceContext,t)) changed=true;

      const handlingContext=destinationHandlingContextForFlight(flight,t);
      if(updateOpenDerivedIncident('destination_handling_unavailable',flight,Boolean(handlingContext?.active),handlingContext,t)) changed=true;

      const deicingCollapseContext=deicingCapacityCollapseContextForFlight(flight,t);
      if(updateOpenDerivedIncident('deicing_capacity_collapse',flight,Boolean(deicingCollapseContext?.active),deicingCollapseContext,t)) changed=true;

      const deicingContext=deicingContextForFlight(flight,t);
      if(updateOpenDerivedIncident('deicing_required',flight,Boolean(deicingContext?.active&&!deicingCollapseContext?.active),deicingContext,t)) changed=true;

      const holdoverContext=holdoverExpiredContextForFlight(flight,t);
      if(updateOpenDerivedIncident('holdover_expired',flight,Boolean(holdoverContext?.active),holdoverContext,t)) changed=true;
    }
    if(t<arr&&flight.flightType!=='ferry'){
      if(flightIsAirborne(flight,t)){
        const fuelContext=fuelMarginContextForFlight(flight,t);
        if(fuelContext&&updateOpenDerivedIncident('fuel_margin_low',flight,Boolean(fuelContext.active),fuelContext,t)) changed=true;
        const holdingContext=holdingFuelConflictContextForFlight(flight,t);
        if(holdingContext&&updateOpenDerivedIncident('atc_holding_fuel_conflict',flight,Boolean(holdingContext.active),holdingContext,t)) changed=true;
        const airborneHandlingContext=destinationHandlingContextForFlight(flight,t);
        if(airborneHandlingContext&&updateOpenDerivedIncident('destination_handling_unavailable',flight,Boolean(airborneHandlingContext.active),airborneHandlingContext,t)) changed=true;
        const diversionUnavailableContext=diversionAirportUnavailableContextForFlight(flight,t);
        if(diversionUnavailableContext&&updateOpenDerivedIncident('diversion_airport_unavailable',flight,Boolean(diversionUnavailableContext.active),diversionUnavailableContext,t)) changed=true;
        const arrivalCurfewContext=arrivalCurfewContextForFlight(flight,t);
        if(updateOpenDerivedIncident('arrival_curfew_coordination',flight,Boolean(arrivalCurfewContext?.active),arrivalCurfewContext,t)) changed=true;
        const dutyExtensionContext=crewDutyExtensionContextForFlight(flight,t);
        if(updateOpenDerivedIncident('crew_duty_extension',flight,Boolean(dutyExtensionContext?.active),dutyExtensionContext,t)) changed=true;
      }
    }
  }
  return changed;
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

function incidentTasks(incidentId){
  return (state.coordinationTasks||[]).filter(task=>task.incidentId===incidentId);
}

function taskRelevantToIncidentStrategy(task,incident){
  if(!incident) return task.status!=='cancelled';
  if(incident.status&&incident.status!=='open') return false;
  if(task.status==='cancelled') return false;
  if(task.branch) return incident.selectedStrategy?task.branch===incident.selectedStrategy:false;
  if(Array.isArray(task.strategies)) return incident.selectedStrategy?task.strategies.includes(incident.selectedStrategy):false;
  return true;
}

function playableIncidentTasks(incident){
  return incidentTasks(incident.id).filter(task=>task.required&&taskRelevantToIncidentStrategy(task,incident));
}

function ensureIncidentWorkflow(incident){
  if(!incident||incident.status!=='open'||!OperationalWorkflows.WORKFLOWS[incident.type]) return [];
  state.coordinationTasks??=[];
  const existing=incidentTasks(incident.id);
  const tasks=OperationalWorkflows.tasksForIncident(incident);
  if(existing.length){
    const desiredByKey=new Map(tasks.map(task=>[task.key,task]));
    for(const task of existing){
      const desired=desiredByKey.get(task.key);
      if(!desired){
        task.status='cancelled';
        task.required=false;
        continue;
      }
      task.department=desired.department; task.kind=desired.kind; task.label=desired.label; task.detail=desired.detail;
      task.dependsOn=desired.dependsOn; task.branch=desired.branch||''; task.strategies=desired.strategies||null;
      task.action=desired.action||''; task.strategyOptions=desired.strategyOptions||null;
      task.eligibility=desired.eligibility||null; task.resources=desired.resources||[];
      task.automatic=Boolean(desired.automatic); task.required=Boolean(desired.required);
      if(task.status==='blocked'&&!task.dependsOn.length) task.status='available';
    }
    const existingKeys=new Set(existing.map(task=>task.key));
    state.coordinationTasks.push(...tasks.filter(task=>!existingKeys.has(task.key)));
    unlockOperationalTasks(incident.id);
    return incidentTasks(incident.id);
  }
  state.coordinationTasks.push(...tasks);
  incident.workflowCreatedAt=simNow();
  incident.classification=OperationalWorkflows.WORKFLOWS[incident.type].classification;
  return tasks;
}

function ensureOperationalWorkflows(){
  let changed=false;
  for(const incident of state.incidents.filter(item=>item.status==='open')){
    if(!incidentTasks(incident.id).length&&ensureIncidentWorkflow(incident).length) changed=true;
  }
  return changed;
}

function repairIncidentPhaseRealism(t=simNow()){
  let changed=false;
  for(const incident of state.incidents||[]){
    if(incident.status!=='open') continue;
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) continue;
    const started=incidentTasks(incident.id).some(task=>['completed','in_progress','waiting_external'].includes(task.status));
    if(started) continue;
    if(incident.type==='destination_closure'&&!flightIsAirborne(flight,t)){
      incident.type='destination_closure_ground';
      incident.summary=INCIDENT_DEFINITIONS.destination_closure_ground.summary;
      incident.context??={sourceId:flight.id,airport:flightOperationalDestination(flight),delayMin:90,reason:'Destination unavailable before departure'};
      incident.classification=OperationalWorkflows.WORKFLOWS.destination_closure_ground.classification;
      incident.selectedStrategy='';
      ensureIncidentWorkflow(incident);
      changed=true;
    }else if(incident.type==='bird_strike'&&!flightIsAirborne(flight,t)){
      incident.type='mel_defect';
      incident.summary=INCIDENT_DEFINITIONS.mel_defect.summary;
      incident.context={...(incident.context||{}),phaseRepair:'Ground bird-strike report reframed as a ground technical defect'};
      incident.technicalContext=incident.technicalContext||OperationalIntelligence.melFinding(`${incident.id}:ground`,incident.detectedAt||t);
      incident.classification=OperationalWorkflows.WORKFLOWS.mel_defect.classification;
      incident.selectedStrategy='';
      ensureIncidentWorkflow(incident);
      changed=true;
    }
  }
  if(changed) invalidateOperationalIndex();
  return changed;
}

function openDepartmentTasks(department){
  return (state.coordinationTasks||[]).filter(task=>{
    const incident=state.incidents.find(item=>item.id===task.incidentId);
    return task.department===department&&!['completed','cancelled'].includes(task.status)&&taskRelevantToIncidentStrategy(task,incident);
  });
}

function incidentWorkflowProgress(incident,t=simNow()){
  const tasks=playableIncidentTasks(incident);
  const completed=tasks.filter(task=>task.status==='completed').length;
  const active=tasks.find(task=>['in_progress','waiting_external'].includes(task.status));
  const available=tasks.find(task=>task.status==='available');
  return {
    completed,total:tasks.length,progress:tasks.length?completed/tasks.length:0,
    current:active||available||tasks.find(task=>task.status==='blocked')||null,
    activeProgress:active?OperationalWorkflows.progress(active,t):0
  };
}

function startOperationalTask(task,durationMin,status='in_progress',outcome=''){
  const now=simNow();
  task.status=status; task.startedAt=now; task.completesAt=now+durationMin*MIN;
  if(outcome) task.pendingOutcome=outcome;
}

function createExternalWorkflowRequest(task,counterparty,durationMin,outcome){
  const request={
    id:`XR${state.nextExternalRequest++}`,taskId:task.id,incidentId:task.incidentId,
    counterparty,submittedAt:simNow(),respondsAt:simNow()+durationMin*MIN,status:'submitted',outcome
  };
  state.externalRequests.push(request);
  task.externalRequestId=request.id;
  startOperationalTask(task,durationMin,'waiting_external',outcome);
  return request;
}

function nextSectorForCrewExtensionIncident(incident){
  const nextId=incident?.context?.nextFlightId||'';
  if(!nextId) return null;
  return state.flights.find(item=>item.id===nextId&&!item.cancelled&&!item.departureLogged)||null;
}

/* Incident resource and consequence helpers live in incident-resources.js and incident-consequences.js. */

function completeOperationalTask(task,outcome=''){
  task.status='completed'; task.completedAt=simNow(); task.completesAt=task.completedAt;
  task.outcome=outcome||task.pendingOutcome||task.outcome||'Completed';
  delete task.pendingOutcome;
  unlockOperationalTasks(task.incidentId);
  const incident=state.incidents.find(item=>item.id===task.incidentId);
  if(incident) finalizeOperationalCase(incident);
}

function unlockOperationalTasks(incidentId){
  const tasks=incidentTasks(incidentId);
  const incident=state.incidents.find(item=>item.id===incidentId);
  let changed=true;
  while(changed){
    changed=false;
    for(const task of tasks){
      if(task.status!=='blocked'||!taskRelevantToIncidentStrategy(task,incident)) continue;
      if(!task.dependsOn.every(id=>tasks.some(other=>other.id===id&&['completed','cancelled'].includes(other.status)))) continue;
      task.status='available'; changed=true;
      if(task.automatic&&task.kind==='crew_report'){
        const allocation=tasks.find(item=>item.kind==='crew_allocation');
        const reportMin=allocation?.selection?.reportMin||25;
        startOperationalTask(task,reportMin,'in_progress',`Replacement crew reports after ${reportMin} minutes.`);
      }
    }
  }
}

function selectIncidentStrategy(incident,strategy){
  incident.selectedStrategy=strategy;
  for(const task of incidentTasks(incident.id)){
    if((task.branch&&task.branch!==strategy)||(Array.isArray(task.strategies)&&!task.strategies.includes(strategy))){
      if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
    }
  }
}

function finalizeOperationalCase(incident){
  if(!incident||incident.status!=='open') return false;
  const tasks=playableIncidentTasks(incident);
  if(!tasks.length||tasks.some(task=>task.status!=='completed')) return false;
  const flight=state.flights.find(item=>item.id===incident.flightId);
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!flight) return false;
  if(incident.type==='crew_sick'){
    const allocation=tasks.find(task=>task.kind==='crew_allocation');
    applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
    incident.outcome=`Replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} reported and the crew plan was updated.`;
  }else if(['mel_defect','postflight_technical_defect'].includes(incident.type)){
    if(incident.selectedStrategy==='repair') incident.outcome='Repair completed and aircraft returned to service.';
    else if(incident.selectedStrategy==='substitute') incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned and the technical disruption was recovered.`;
    else incident.outcome=`Defect deferred under MEL ${incident.technicalContext?.code||''}; dispatch accepted the restrictions.`;
  }else if(['atc_restriction','airport_capacity_reduction','atc_ground_stop'].includes(incident.type)){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||45);
    incident.outcome=incident.atcOutcome||'Returned airport flow opportunity incorporated into the operating plan.';
  }else if(incident.type==='night_curfew_conflict'){
    if(incident.selectedStrategy==='change_departure'){
      const plan=nightDepartureChangePlanState(incident);
      if(!plan.ready) return false;
      flight.nightRecoveryDecision='manual_departure_change';
      flight.nightRecoverySourceKey=incident.context?.sourceKey||'';
      flight.nightRecoveryApprovedAt=simNow();
      incident.outcome=`${flight.id} manually retimed in Dispatch. ${plan.reason}`;
    }else{
      const context=nightCurfewConflictContextForFlight(flight,flightActualDeparture(flight))||incident.context;
      if(!context?.sourceKey) return false;
      flight.nightRecoveryDecision='reschedule_after_curfew';
      flight.nightRecoverySourceKey=context.sourceKey;
      flight.nightRecoveryApprovedAt=simNow();
      incident.outcome=`${flight.id} rescheduled after night restrictions${context.restrictionSummary?`: ${context.restrictionSummary}`:''}; first feasible departure ${formatTime(context.nextDeparture)}.`;
    }
  }else if(incident.type==='arrival_curfew_coordination'){
    const context=arrivalCurfewContextForFlight(flight,simNow())||incident.context;
    if(!context?.sourceKey) return false;
    flight.arrivalCurfewCoordinatedKey=context.sourceKey;
    flight.arrivalCurfewCoordinatedAt=simNow();
    incident.outcome=`${context.affectedAirport||flightOperationalDestination(flight)} curfew arrival acceptance coordinated for expected arrival ${formatTime(context.expectedArrival||flightActualArrival(flight))}.`;
  }else if(incident.type==='gate_conflict'){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||30);
    incident.outcome=incident.stationOutcome||'Replacement stand and ground movement coordinated.';
  }else if(incident.type==='destination_closure'){
    const alternate=incident.selectedAlternate;
    if(!alternate||!aircraft) return false;
    flight.diversionAirport=alternate;
    flight.operationalDurationMs=incident.diversionDurationMs||flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
    flight.weatherChecked=false;
    incident.outcome=alternate===flight.from
      ? `Captain and ATC accepted return to ${alternate}; handling confirmed and the diversion plan was updated.`
      : `Captain and ATC accepted ${alternate}; alternate handling confirmed and the diversion plan was updated.`;
  }else if(incident.type==='destination_closure_ground'){
    if(incident.selectedStrategy==='alternate_destination'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incident.diversionDurationMs||flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
      flight.weatherChecked=false;
      incident.outcome=`OCC re-planned ${flight.id} to ${alternate} before departure because ${incident.context?.airport||flight.to} was unavailable.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||90);
      incident.outcome=`OCC held ${flight.id} on the ground until ${incident.context?.airport||flight.to} can accept the flight.`;
    }
  }else if(['aircraft_out_of_position','aircraft_misposition_after_diversion'].includes(incident.type)){
    if(incident.selectedStrategy==='substitute'){
      incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned to protect the out-of-position departure.`;
    }else{
      const plan=positioningFerryPlanState(incident);
      if(!plan.ready) return false;
      incident.positioningFerryId=plan.ferry?.id||incident.positioningFerryId||'';
      incident.outcome=incident.positioningFerryId
        ? `Positioning ferry ${incident.positioningFerryId} brings ${plan.aircraft.tail} to ${plan.to} before ${flight.id}.`
        : `${plan.aircraft.tail} is projected at ${plan.to}; positioning conflict cleared.`;
    }
  }else if(incident.type==='no_legal_crew'){
    incident.outcome='Legal crew availability confirmed after personnel/resources were updated.';
  }else if(incident.type==='crew_misconnect'){
    if(incident.selectedStrategy==='replace'){
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Local replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} assigned after the crew misconnect.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome='Connecting crew ETA accepted and the revised departure was published.';
    }
  }else if(['crew_misposition_after_diversion','crew_report_delayed'].includes(incident.type)){
    if(incident.selectedStrategy==='replace'){
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Local replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} assigned and the crew plan was updated.`;
    }else if(['move_crew','move_reserve'].includes(incident.selectedStrategy)){
      const plan=crewRelocationPlanState(incident);
      if(!plan.ready) return false;
      applyIncidentMinimumDelay(flight,Math.max(0,incident.context?.delayMin||0));
      incident.outcome=`${PERSONNEL[plan.role]?.label||'Crew'} positioning confirmed at ${plan.to}.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome='Crew report / positioning ETA accepted and the revised departure was published.';
    }
  }else if(['crew_duty_risk','crew_fatigue_report','crew_fatigue_mid_rotation'].includes(incident.type)){
    if(incident.selectedStrategy==='augment'){
      flight.crewAugmented=true;
      incident.outcome='Augmented crew assigned and the crew plan was updated.';
    }else{
      const allocation=tasks.find(task=>task.kind==='crew_allocation');
      applyIncidentMinimumDelay(flight,allocation?.selection?.reportMin||25);
      incident.outcome=`Replacement ${PERSONNEL[allocation?.selection?.role]?.label?.toLowerCase()||'crew'} reported and the crew plan was updated.`;
    }
  }else if(incident.type==='crew_duty_extension'){
    flight.crewDutyExtensionRecordedAt=simNow();
    flight.crewDutyExtensionOverrunMin=incident.context?.overrunMin||0;
    if(incident.selectedStrategy==='protect_next'){
      const next=state.flights.find(item=>item.id===incident.context?.nextFlightId);
      if(next){
        next.recoveryAction=`Reserve crew protected after ${flight.id} duty extension`;
        next.issueAcknowledgedAt=0;
        next.issueAcknowledgedKey='';
      }
      flight.crewStandDownPlannedAt=simNow();
      incident.outcome=next
        ? `Crew duty extension recorded; current crew stands down on arrival and ${next.id} is protected with reserve crew.`
        : 'Crew duty extension recorded; current crew stands down on arrival.';
    }else if(incident.selectedStrategy==='priority'){
      flight.crewDutyPriorityRequestedAt=simNow();
      incident.outcome='Priority-handling reply recorded and the crew duty extension / post-arrival review plan was filed.';
    }else{
      incident.outcome='Commander discretion / unforeseen duty extension recorded; current crew continues to safe landing with post-arrival review.';
    }
  }else if(['baggage_loading_issue','fueling_issue','fuel_supplier_outage','security_screening','deicing_required','deicing_capacity_collapse','holdover_expired'].includes(incident.type)){
    applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||20);
    incident.outcome=incident.stationOutcome||'Station recovery completed and the operating plan was updated.';
  }else if(incident.type==='performance_limited'){
    if(incident.selectedStrategy==='substitute'){
      incident.outcome=`Replacement aircraft ${incident.replacementAircraftTail||''} assigned with enough dispatch performance margin.`;
    }else if(incident.selectedStrategy==='payload_reduce'){
      const pct=incident.payloadReductionPct||incident.context?.payloadReductionPct||10;
      const originalPax=Number(flight.pax)||0;
      const remove=Math.min(originalPax,Math.max(1,Math.ceil(originalPax*pct/100)));
      flight.pax=Math.max(0,originalPax-remove);
      if(flight.classPax?.economy) flight.classPax.economy=Math.max(0,flight.classPax.economy-remove);
      flight.revenue=Math.round((Number(flight.revenue)||0)*(originalPax?flight.pax/originalPax:1));
      if(flight.economics){ flight.economics.revenue=flight.revenue; refreshEconomicsTotals(flight); }
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||20);
      incident.outcome=`Payload reduced by about ${pct}% and dispatch performance margin restored.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||45);
      incident.outcome='Departure delayed for a better performance window.';
    }
  }else if(incident.type==='destination_handling_unavailable'){
    if(incident.selectedStrategy==='prepare_alternate'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incident.diversionDurationMs||flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
      flight.weatherChecked=false;
      incident.outcome=`Handling alternate ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else{
      applyIncidentMinimumDelay(flight,incident.coordinatedDelayMin||incident.context?.delayMin||25);
      incident.outcome=incident.selectedStrategy==='request_handling'
      ? `${flightOperationalDestination(flight)} handling acceptance secured.`
      : 'Departure held until destination handling can accept the aircraft.';
    }
  }else if(incident.type==='onboard_medical'){
    if(incident.selectedStrategy==='divert'){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incident.diversionDurationMs||flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
      incident.outcome=`Medical diversion to ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else{
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Flight continued with medical advice and arrival assistance confirmed.';
    }
  }else if(['inflight_technical_fault','fuel_margin_low','atc_holding_fuel_conflict','unruly_passenger','destination_weather_deterioration','destination_below_minima','alternate_unsuitable','diversion_airport_unavailable','lightning_strike','bird_strike','pressurization_issue'].includes(incident.type)){
    if(['divert','return_origin','reselect'].includes(incident.selectedStrategy)){
      const alternate=incident.selectedAlternate;
      if(!alternate||!aircraft) return false;
      flight.diversionAirport=alternate;
      flight.operationalDurationMs=incident.diversionDurationMs||flightDurationMs(AIRPORTS[flight.from],AIRPORTS[alternate],MODELS[aircraft.model]);
      flight.weatherChecked=false;
      incident.outcome=incident.selectedStrategy==='return_origin'
        ? `Return to ${alternate} coordinated with flight deck, ATC, and station handling.`
        : `Diversion to ${alternate} coordinated with flight deck, ATC, and station handling.`;
    }else if(['fuel_margin_low','atc_holding_fuel_conflict'].includes(incident.type)){
      if(incident.selectedStrategy==='direct') flight.enrouteDelayMin=Math.max(0,Math.min(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||10));
      flight.fuelMarginReviewed=true;
      incident.outcome=incident.selectedStrategy==='conserve'
        ? 'Fuel-conservation profile coordinated and landing fuel monitoring continues.'
        : 'ATC shortcut or priority request coordinated and the fuel watch plan was recorded.';
    }else if(incident.type==='unruly_passenger'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||15);
      incident.outcome='Flight continued with arrival security/law-enforcement reception coordinated.';
    }else if(incident.type==='destination_weather_deterioration'){
      if(incident.selectedStrategy==='hold') flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome=incident.selectedStrategy==='hold'
        ? 'Destination holding plan and diversion trigger point coordinated.'
        : 'Destination weather monitoring plan recorded with flight deck.';
    }else if(incident.type==='destination_below_minima'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Destination minima hold and diversion trigger point coordinated with flight deck.';
    }else if(incident.type==='alternate_unsuitable'){
      incident.outcome='Alternate suitability monitoring plan recorded with flight deck.';
    }else if(incident.type==='diversion_airport_unavailable'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||20);
      incident.outcome='Diversion-airport holding plan and next decision trigger coordinated with flight deck.';
    }else if(['lightning_strike','bird_strike'].includes(incident.type)){
      const destination=flightOperationalDestination(flight);
      flight.arrivalInspectionRequired=true;
      incident.outcome=`Flight continued with ${destination} arrival inspection arranged.`;
    }else if(incident.type==='pressurization_issue'){
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,incident.coordinatedDelayMin||25);
      incident.outcome='Lower-altitude continuation coordinated with fuel monitoring and arrival support.';
    }else{
      incident.outcome='Inflight technical monitoring completed and the amended flight-watch plan was recorded.';
    }
  }else if(incident.type==='airborne_atc_reroute'){
    const delay=Math.max(5,incident.coordinatedDelayMin||incident.context?.delayMin||15);
    flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.outcome=incident.selectedStrategy==='direct'
      ? 'Shorter ATC routing coordinated and revised arrival estimate published.'
      : 'ATC reroute accepted and revised arrival estimate published.';
  }
  resolveIncidentImpacts(incident,simNow(),incident.selectedStrategy&&['wait_inbound','accept_next','accept'].includes(incident.selectedStrategy)?'accepted':'handled');
  if(typeof recordResolvedIncidentRecoveryCost==='function') recordResolvedIncidentRecoveryCost(incident);
  incident.status='resolved'; incident.blocking=false; incident.resolvedAt=simNow();
  incident.selectedAction='workflow_complete'; incident.automaticResolution=false;
  for(const task of incidentTasks(incident.id)){
    if(!['completed','cancelled'].includes(task.status)) task.status='cancelled';
  }
  for(const assignment of state.resourceAssignments||[]){
    if(assignment.incidentId===incident.id) assignment.status='committed';
  }
  return true;
}

function processOperationalWorkflows(t=simNow()){
  let changed=ensureOperationalWorkflows();
  for(const task of state.coordinationTasks||[]){
    if(!['in_progress','waiting_external'].includes(task.status)||!task.completesAt||t<task.completesAt) continue;
    if(task.externalRequestId){
      const request=state.externalRequests.find(item=>item.id===task.externalRequestId);
      if(request){ request.status='responded'; request.respondedAt=t; }
    }
    if(['maintenance_disposition','maintenance_repair'].includes(task.kind)&&task.selection?.action==='repair'){
      const incident=state.incidents.find(item=>item.id===task.incidentId);
      const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
      const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
      if(aircraft){ aircraft.defectUntil=0; aircraft.defectReason=''; aircraft.condition=clamp((aircraft.condition??100)+5,0,100); }
    }
    completeOperationalTask(task); changed=true;
  }
  for(const incident of state.incidents.filter(item=>item.status==='open')){
    unlockOperationalTasks(incident.id);
    if(finalizeOperationalCase(incident)) changed=true;
  }
  return changed;
}

function applyIncidentAircraftSubstitution(incident,optionId){
  const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
  const option=incidentAircraftReplacementOptions(incident).find(item=>item.id===optionId);
  if(!flight||!option) return toast('No suitable replacement aircraft is available. Request or position an aircraft in Dispatch & slots.');
  const replacement=state.aircraft.find(item=>item.id===option.aircraftId);
  const original=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(!replacement) return false;
  const {service,outbound,returnFlight}=rotationForFlight(flight);
  const target=service&&outbound?outbound:flight;
  const targets=[target,service&&returnFlight&&target.id===outbound?.id?returnFlight:null].filter(Boolean);

  if(option.mode==='position'){
    createFlightRecord({
      aircraftId:replacement.id,from:replacement.location,to:target.from,
      departure:option.ferryDeparture,fare:0,flightType:'ferry'
    });
  }

  for(const item of targets){
    item.aircraftId=replacement.id;
    clearAircraftSpecificDelay(item);
    item.positioningDelayMin=Math.max(item.positioningDelayMin||0,option.delayMin||0);
    item.recoveryAction=`Replacement aircraft ${replacement.tail} assigned`;
  }
  if(original){
    original.defectUntil=Math.max(original.defectUntil||0,simNow()+180*MIN);
    original.defectReason=incident.technicalContext?.label||'Technical defect';
    original.condition=clamp((original.condition??100)-4,0,100);
  }
  incident.replacementAircraftId=replacement.id;
  incident.replacementAircraftTail=replacement.tail;
  incident.replacementMode=option.mode;
  incident.replacementDelayMin=option.delayMin||0;
  return option;
}

function applyTurnaroundExpedite(flight){
  flight.turnaroundRecoveryMin=Math.max(Number(flight.turnaroundRecoveryMin)||0,15);
  if(flight.handlingDelayMin) flight.handlingDelayMin=Math.max(0,flight.handlingDelayMin-10);
  flight.recoveryAction='Priority turnaround resources assigned';
}

const STATION_RECOVERY_EFFECTS={
  baggage_expedite:{delay:15,outcome:'Ramp control prioritized baggage loading and load-control closeout.'},
  baggage_reload:{delay:35,outcome:'Baggage was reloaded and reconciled before closeout.'},
  baggage_offload:{delay:20,outcome:'Affected bags were offloaded and passenger-service follow-up was opened.'},
  hold_screening:{delay:30,outcome:'Airport security completed rescreening before departure.'},
  offload_passenger:{delay:25,outcome:'Affected passenger and baggage were offloaded and the manifest was corrected.'},
  priority:{delay:10,outcome:'Fuel provider accepted priority fueling.'},
  fuel_outage_priority:{delay:20,outcome:'Fuel provider accepted escalation and dispatched limited fuel capacity.'},
  wait_truck:{delay:35,outcome:'Fuel truck delay accepted and fuel completion time updated.'},
  wait_supply:{delay:75,outcome:'Fuel supplier outage recovery ETA accepted and departure plan updated.'},
  minimum_uplift:{delay:15,outcome:'Minimum compliant fuel uplift confirmed with dispatch.'},
  deice:{delay:25,outcome:'Aircraft deicing completed and a holdover window was started.'},
  priority_deice:{delay:15,outcome:'Station accepted priority deicing and a holdover window was started.'},
  deice_queue:{delay:60,outcome:'Aircraft entered the constrained deicing queue and a treatment sequence was confirmed.'},
  wait_weather:{delay:45,outcome:'Flight held until snow/ice exposure improves.'},
  redeice:{delay:25,outcome:'Repeat deicing completed and a new holdover window was started.'},
  wait_deice_slot:{delay:35,outcome:'Flight held for the next available deicing treatment slot.'}
};

function authorityDecisionForIncident(task,incident,flight){
  const options=(task.strategyOptions||[]).map(option=>option.id);
  const has=id=>options.includes(id);
  const choose=id=>has(id)?id:(options[0]||'');
  const roll=OperationalIntelligence.stableUnit(`${incident.id}:${task.key}:authority`);
  const context=incident.context||{};
  const progress=Number.isFinite(context.phasePct)?context.phasePct/100:flightProgress(flight,simNow());
  const hasAlternate=diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length>0;
  const hasReturn=diversionOptionsForIncident(incident,{onlyReturnOrigin:true}).length>0;
  const poorFuel=Number(context.marginPct||100)<75;
  const highDelay=Number(context.delayMin||context.holdingDelayMin||0)>=25;
  const poorWeather=context.level==='severe'||Number(context.capacityFactor||1)<.72||Number(context.capacityPct||100)<72;
  const poorCondition=Number(context.aircraftCondition||100)<78||context.maintenanceDue===true;
  let strategy='';
  if(context.authorityDecision&&has(context.authorityDecision)) strategy=context.authorityDecision;
  if(strategy) return {
    strategy,
    counterparty:task.action==='medical'?'Medical advisory / flight deck':'Flight deck',
    durationMin:task.action==='medical'?7:6,
    outcome:{
      continue:'Flight deck continues to destination',
      continue_low:'Flight deck continues at lower altitude',
      divert:'Flight deck requests diversion',
      direct:'Flight deck requests priority or shortcut',
      conserve:'Flight deck accepts fuel-conservation profile',
      hold:'Flight deck/ATC will hold under fuel watch',
      monitor:'Flight deck accepts monitored continuation',
      alternate:'Flight deck requests an alternate',
      return_origin:'Flight deck requests return to origin',
      reselect:'Flight deck requests a new diversion airport'
    }[strategy]||`Authority response received: ${strategy}.`
  };
  switch(incident.type){
    case 'destination_closure':
      strategy=hasReturn&&(progress<.35||!hasAlternate||roll<.25)?'return_origin':'alternate';
      break;
    case 'onboard_medical':
      strategy=hasAlternate&&progress<.82&&roll<.48?'divert':'continue';
      break;
    case 'inflight_technical_fault':
      strategy=hasAlternate&&(poorCondition||roll<.32||progress<.25)?'divert':'continue';
      break;
    case 'fuel_margin_low':
      strategy=hasReturn&&progress<.45&&(poorFuel||!hasAlternate||roll<.22)?'return_origin':hasAlternate&&(poorFuel||roll<.35)?'divert':roll<.72?'direct':'conserve';
      break;
    case 'atc_holding_fuel_conflict':
      strategy=hasAlternate&&(poorFuel||Number(context.holdingDelayMin||0)>=35||roll<.42)?'divert':'direct';
      break;
    case 'unruly_passenger':
      strategy=hasAlternate&&roll<.36?'divert':'continue';
      break;
    case 'destination_weather_deterioration':
      strategy=poorWeather&&hasAlternate?'divert':highDelay||roll<.38?'hold':'monitor';
      break;
    case 'destination_below_minima':
      strategy=hasAlternate&&(progress>.35||!hasReturn||roll>.18)?'divert':hasReturn?'return_origin':'hold';
      break;
    case 'alternate_unsuitable':
      strategy=hasAlternate?'reselect':hasReturn?'return_origin':'monitor';
      break;
    case 'diversion_airport_unavailable':
      strategy=hasAlternate?'reselect':hasReturn?'return_origin':'hold';
      break;
    case 'lightning_strike':
      strategy=hasAlternate&&(context.severity==='severe'||poorCondition||roll<.28)?'divert':'continue';
      break;
    case 'bird_strike':
      strategy=hasReturn&&progress<.35&&(poorCondition||roll<.4)?'return_origin':hasAlternate&&(poorCondition||roll<.58)?'divert':'continue';
      break;
    case 'pressurization_issue':
      strategy=hasAlternate&&(progress<.78||poorFuel||roll<.72)?'divert':'continue_low';
      break;
    default:
      strategy=options[Math.floor(roll*Math.max(1,options.length))]||'';
  }
  strategy=choose(strategy);
  const labels={
    continue:'Flight deck continues to destination',
    continue_low:'Flight deck continues at lower altitude',
    divert:'Flight deck requests diversion',
    direct:'Flight deck requests priority or shortcut',
    conserve:'Flight deck accepts fuel-conservation profile',
    hold:'Flight deck/ATC will hold under fuel watch',
    monitor:'Flight deck accepts monitored continuation',
    alternate:'Flight deck requests an alternate',
    return_origin:'Flight deck requests return to origin',
    reselect:'Flight deck requests a new diversion airport'
  };
  const counterparty=task.action==='medical'?'Medical advisory / flight deck':'Flight deck';
  return {
    strategy,
    counterparty,
    durationMin:task.action==='medical'?7:6,
    outcome:labels[strategy]||`Authority response received: ${strategy}.`
  };
}

function performImmediateRecoveryStrategy(task,incident,flight,action){
  if(!['dispatch-flow-strategy','dispatch-capacity-strategy','dispatch-groundstop-strategy','station-stand-strategy'].includes(task.key)) return false;
  selectIncidentStrategy(incident,action);
  task.selection={strategy:action};
  if(task.key==='dispatch-flow-strategy'){
    if(action==='accept'){
      incident.coordinatedDelayMin=45;
      incident.atcOutcome='Assigned CTOT accepted with a 45-minute ground delay.';
      completeOperationalTask(task,incident.atcOutcome);
      return true;
    }
    if(action==='priority'){
      incident.coordinatedDelayMin=20;
      incident.atcOutcome='ATC returned an earlier regulated opportunity with a 20-minute delay.';
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
      return true;
    }
  }else if(task.key==='dispatch-capacity-strategy'){
    const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||30);
    if(action==='accept'){
      incident.coordinatedDelayMin=base;
      incident.atcOutcome=`Reduced airport-flow sequence accepted with a ${base}-minute ground delay.`;
      completeOperationalTask(task,incident.atcOutcome);
      return true;
    }
    if(action==='priority'){
      incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
      incident.atcOutcome=`Airport flow returned an earlier opportunity with a ${incident.coordinatedDelayMin}-minute delay.`;
      createExternalWorkflowRequest(task,'Airport flow control',15,incident.atcOutcome);
      return true;
    }
  }else if(task.key==='dispatch-groundstop-strategy'){
    if(action==='hold_ground'){
      const delay=Math.max(35,incident.context?.delayMin||flight.airspaceDelayMin||flight.airportDelayMin||45);
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=`Ground stop held at origin with a ${delay}-minute release estimate.`;
      createExternalWorkflowRequest(task,'ATC flow management',12,incident.atcOutcome);
      return true;
    }
    if(action==='priority'){
      const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30);
      incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
      incident.atcOutcome=`Flow management returned an earlier release with a ${incident.coordinatedDelayMin}-minute delay.`;
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
      return true;
    }
  }else if(task.key==='station-stand-strategy'){
    const options={
      remote:{delay:20,duration:10,outcome:'Airport allocated a remote stand with passenger bussing.'},
      tow:{delay:30,duration:15,outcome:'Airport allocated a replacement gate requiring an aircraft tow.'},
      wait_gate:{delay:45,duration:20,outcome:'Airport retained the planned gate after a 45-minute hold.'}
    };
    const option=options[action];
    if(!option) return false;
    incident.coordinatedDelayMin=option.delay;
    incident.stationOutcome=option.outcome;
    createExternalWorkflowRequest(task,'Airport stand control',option.duration,option.outcome);
    return true;
  }
  return false;
}

function performOperationalTask(taskId,actionId='',payload={}){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  const incident=task&&state.incidents.find(item=>item.id===task.incidentId&&item.status==='open');
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
  if(!task||!incident||!flight||!['available','in_progress'].includes(task.status)) return false;
  const blocker=['technical_strategy','recovery_strategy'].includes(task.kind)?'':AeroIncidentResources.taskResourceBlocker(task,incident);
  if(blocker) return toast(blocker);
  if(['technical_strategy','recovery_strategy','authority_decision'].includes(task.kind)&&actionId==='cancel'){
    const strategyBlocker=AeroIncidentResources.branchStrategyOptionBlocker(task,incident,'cancel');
    if(strategyBlocker) return toast(strategyBlocker);
    selectIncidentStrategy(incident,'cancel');
    task.selection={strategy:'cancel'};
    task.status='completed';
    task.completedAt=simNow();
    task.completesAt=task.completedAt;
    task.outcome='Flight cancelled as the selected incident recovery.';
    if(incident.type==='night_curfew_conflict') cancelSingleFlight(flight.id,{skipConfirm:true,reason:INCIDENT_DEFINITIONS[incident.type]?.title||incident.type});
    else cancelFlight(flight.id,{skipConfirm:true,reason:INCIDENT_DEFINITIONS[incident.type]?.title||incident.type});
    return true;
  }
  if(task.kind==='crew_allocation'){
    const option=crewPoolOptions(incident).find(item=>item.id===payload.optionId);
    if(!option) return toast('That personnel pool is no longer available.');
    const assignment={id:`RA${state.nextResourceAssignment++}`,incidentId:incident.id,taskId:task.id,flightId:flight.id,
      role:option.role,base:option.airport,operatingAirport:flight.from,amount:1,family:option.family,
      assignedAt:simNow(),reportAt:simNow()+option.reportMin*MIN,releaseAt:flightCrewRelease(flight)+10*HOUR,status:'assigned'};
    state.resourceAssignments.push(assignment);
    flight.crewRoleSwaps??={};
    flight.crewRoleSwaps[option.role]={role:option.role,assignmentId:assignment.id,airport:option.airport,assignedAt:simNow()};
    task.selection={...option,assignmentId:assignment.id};
    completeOperationalTask(task,`${option.label} assigned.`);
  }else if(task.kind==='crew_augmentation'){
    const blocker=AeroIncidentResources.crewAugmentationBlocker(incident);
    if(blocker) return toast(blocker);
    task.selection={action:'augment',reportMin:25};
    startOperationalTask(task,25,'in_progress','Augmented crew reports and completes briefing.');
  }else if(task.kind==='crew_next_sector_replacement'){
    const next=nextSectorForCrewExtensionIncident(incident);
    if(!next) return toast('No unflown downstream sector is available for crew replacement.');
    const duty=swapCrewForFlight(next.id);
    if(!duty) return false;
    task.selection={flightId:next.id,dutyId:duty.id,airport:next.from};
    completeOperationalTask(task,`${next.id} protected with local reserve crew at ${next.from}.`);
  }else if(task.kind==='maintenance_inspection'){
    startOperationalTask(task,25,'in_progress','Engineering inspection completed.');
  }else if(task.kind==='authority_decision'){
    const decision=authorityDecisionForIncident(task,incident,flight);
    if(!decision.strategy) return false;
    selectIncidentStrategy(incident,decision.strategy);
    task.selection={...decision};
    createExternalWorkflowRequest(task,decision.counterparty,decision.durationMin,decision.outcome);
  }else if(task.kind==='technical_strategy'||task.kind==='recovery_strategy'){
    const options=(task.strategyOptions||[
      {id:'defer'},{id:'repair'},{id:'substitute'}
    ]).map(option=>option.id);
    if(!options.includes(actionId)) return false;
    const strategyBlocker=AeroIncidentResources.branchStrategyOptionBlocker(task,incident,actionId);
    if(strategyBlocker) return toast(strategyBlocker);
    if(performImmediateRecoveryStrategy(task,incident,flight,actionId)){
      processOperationalWorkflows(simNow()); recalculateOperations(); AeroServices.commit();
      return true;
    }
    selectIncidentStrategy(incident,actionId);
    task.selection={strategy:actionId};
    completeOperationalTask(task,`${task.label}: ${actionId}.`);
  }else if(task.kind==='maintenance_defer'||task.kind==='maintenance_disposition'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(task.kind==='maintenance_defer'||actionId==='defer'){
      const finding=incident.technicalContext||OperationalIntelligence.melFinding(incident.id,incident.detectedAt);
      aircraft.melItems??=[];
      if(!aircraft.melItems.some(item=>item.id===finding.id)) aircraft.melItems.push({...finding,status:'open',deferredAt:simNow()});
      aircraft.condition=clamp((aircraft.condition??100)-3,0,100);
      incident.selectedStrategy='defer'; task.selection={action:'defer',finding};
      completeOperationalTask(task,`Deferred under MEL ${finding.code} with documented restrictions.`);
    }else if(actionId==='repair'){
      incident.selectedStrategy='repair'; task.selection={action:'repair'};
      aircraft.defectUntil=Math.max(aircraft.defectUntil||0,simNow()+120*MIN); aircraft.defectReason='Technical defect under repair';
      startOperationalTask(task,120,'in_progress','Repair completed and engineering sign-off recorded.');
    }else return false;
  }else if(task.kind==='maintenance_repair'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!aircraft) return false;
    if(actionId&&actionId!=='repair') return false;
      incident.selectedStrategy='repair'; task.selection={action:'repair'};
      aircraft.defectUntil=Math.max(aircraft.defectUntil||0,simNow()+120*MIN); aircraft.defectReason='Technical defect under repair';
      startOperationalTask(task,120,'in_progress','Repair completed and engineering sign-off recorded.');
  }else if(task.kind==='maintenance_clearance'){
    const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
    if(aircraft){ aircraft.defectUntil=0; aircraft.defectReason=''; aircraft.condition=clamp((aircraft.condition??100)-1,0,100); }
    task.selection={action:'release'};
    completeOperationalTask(task,'Engineering recorded no-damage clearance.');
  }else if(task.kind==='aircraft_substitution'){
    const option=applyIncidentAircraftSubstitution(incident,payload.optionId);
    if(!option) return false;
    task.selection=option;
    completeOperationalTask(task,`${option.label} assigned as replacement aircraft.`);
  }else if(task.kind==='manual_ferry_required'){
    const plan=positioningFerryPlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    incident.selectedStrategy='position_ferry';
    incident.positioningFerryId=plan.ferry?.id||'';
    task.selection={action:'check_ferry',ferryFlightId:incident.positioningFerryId,projectedLocation:plan.projection?.location||''};
    completeOperationalTask(task,incident.positioningFerryId?`Positioning ferry ${incident.positioningFerryId} confirmed.`:'Aircraft projection confirmed at origin.');
  }else if(task.kind==='manual_crew_move_required'){
    const plan=crewRelocationPlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    task.selection={action:'check_crew_move',transferId:plan.transfer?.id||'',role:plan.role,to:plan.to};
    completeOperationalTask(task,plan.transfer?`${plan.transfer.id} positions ${PERSONNEL[plan.role]?.label?.toLowerCase()||'crew'} to ${plan.to}.`:`Qualified ${PERSONNEL[plan.role]?.label?.toLowerCase()||'crew'} confirmed at ${plan.to}.`);
  }else if(task.kind==='manual_departure_change_required'){
    const plan=nightDepartureChangePlanState(incident);
    if(!plan.ready) return toast(plan.reason);
    task.selection={action:'check_departure_change',actualDeparture:flightActualDeparture(flight),restrictionSummary:plan.restrictionSummary||''};
    completeOperationalTask(task,plan.reason);
  }else if(task.kind==='atc_coordination'){
    const action=actionId||task.action;
    if(action==='accept'){
      const delay=incident.type==='airport_capacity_reduction'||incident.type==='atc_ground_stop'
        ? Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30)
        : 45;
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=incident.type==='atc_ground_stop'
        ? `Ground-stop release estimate accepted with a ${delay}-minute departure hold.`
        : incident.type==='airport_capacity_reduction'
        ? `Reduced airport-flow sequence accepted with a ${delay}-minute ground delay.`
        : 'Assigned CTOT accepted with a 45-minute ground delay.';
      task.selection={action:'accept'}; completeOperationalTask(task,incident.atcOutcome);
    }else if(action==='hold_ground'){
      const delay=Math.max(35,incident.context?.delayMin||flight.airspaceDelayMin||flight.airportDelayMin||45);
      incident.coordinatedDelayMin=delay;
      incident.atcOutcome=`Ground stop held at origin with a ${delay}-minute release estimate.`;
      task.selection={action,delayMin:delay};
      completeOperationalTask(task,incident.atcOutcome);
    }else if(action==='priority'){
      if(incident.type==='airport_capacity_reduction'||incident.type==='atc_ground_stop'){
        const base=Math.max(15,incident.context?.delayMin||flight.airportDelayMin||flight.airspaceDelayMin||30);
        incident.coordinatedDelayMin=Math.max(10,Math.round(base*.55));
        incident.atcOutcome=incident.type==='atc_ground_stop'
          ? `Flow management returned an earlier release with a ${incident.coordinatedDelayMin}-minute delay.`
          : `Airport flow returned an earlier opportunity with a ${incident.coordinatedDelayMin}-minute delay.`;
      }else{
        incident.coordinatedDelayMin=20;
        incident.atcOutcome='ATC returned an earlier regulated opportunity with a 20-minute delay.';
      }
      task.selection={action:'priority'};
      createExternalWorkflowRequest(task,'ATC flow management',15,incident.atcOutcome);
    }else return false;
  }else if(task.kind==='stand_request'){
    const action=actionId||task.action;
    const options={remote:{delay:20,duration:10,outcome:'Airport allocated a remote stand with passenger bussing.'},tow:{delay:30,duration:15,outcome:'Airport allocated a replacement gate requiring an aircraft tow.'},wait_gate:{delay:45,duration:20,outcome:'Airport retained the planned gate after a 45-minute hold.'}};
    const option=options[action]; if(!option) return false;
    incident.coordinatedDelayMin=option.delay; incident.stationOutcome=option.outcome; task.selection={action};
    createExternalWorkflowRequest(task,'Airport stand control',option.duration,option.outcome);
  }else if(task.kind==='inbound_wait'){
    const delay=incident.context?.inboundDelayMin||incident.context?.delayMin||flightTotalDepartureDelayMin(flight)||15;
    incident.coordinatedDelayMin=Math.max(15,delay);
    task.selection={action:actionId||task.action||'wait_inbound',delayMin:incident.coordinatedDelayMin};
    const prefix=['aircraft_out_of_position','aircraft_misposition_after_diversion'].includes(incident.type)?'Aircraft positioning':
      ['crew_misconnect','crew_misposition_after_diversion','crew_report_delayed'].includes(incident.type)?'Crew timing':
        incident.type==='destination_handling_unavailable'?'Destination handling':'Timing';
    completeOperationalTask(task,`${prefix} accepted with ${incident.coordinatedDelayMin} minutes projected delay.`);
  }else if(task.kind==='turnaround_expedite'){
    applyTurnaroundExpedite(flight);
    incident.coordinatedDelayMin=Math.max(0,(incident.context?.inboundDelayMin||flightTotalDepartureDelayMin(flight)||20)-15);
    task.selection={action:'expedite_turn'};
    createExternalWorkflowRequest(task,'Station turnaround control',10,'Ground resources reprioritized for an expedited turn.');
  }else if(['station_recovery','fuel_recovery','security_coordination'].includes(task.kind)){
    const action=actionId||task.action;
    const effect=STATION_RECOVERY_EFFECTS[action];
    if(!effect) return false;
    const delay=action==='deice_queue'?Math.max(effect.delay,incident.context?.queueMin||incident.context?.delayMin||0):
      action==='wait_supply'?Math.max(effect.delay,incident.context?.delayMin||0):
      action==='fuel_outage_priority'?Math.max(effect.delay,Math.round((incident.context?.delayMin||45)*.35)):
      effect.delay;
    const outcome=action==='deice_queue'&&incident.context?.demand
      ? `Station sequenced ${incident.context.demand} deicing-demand departures; treatment queue accepted.`
      : effect.outcome;
    if(task.kind==='fuel_recovery'&&['priority','fuel_outage_priority','minimum_uplift'].includes(action)) fuelFlight(flight,simNow(),true);
    if(task.kind==='security_coordination'&&action==='offload_passenger'&&flight.pax>0){
      flight.pax=Math.max(0,flight.pax-1);
      if(flight.classPax?.economy) flight.classPax.economy=Math.max(0,flight.classPax.economy-1);
    }
    if(task.kind==='station_recovery'&&['deice','priority_deice','redeice'].includes(action)){
      flight.deicingCompletedAt=simNow()+delay*MIN;
      flight.deicingHoldoverUntil=flight.deicingCompletedAt+35*MIN;
    }
    incident.coordinatedDelayMin=delay;
    incident.stationOutcome=outcome;
    task.selection={action,delayMin:delay};
    createExternalWorkflowRequest(task,task.kind==='fuel_recovery'?'Fuel provider':task.kind==='security_coordination'?'Airport security':'Station ramp control',Math.max(8,Math.ceil(delay/2)),outcome);
  }else if(task.kind==='performance_coordination'){
    const action=actionId||task.action;
    if(action==='payload_reduce'){
      const pct=incident.context?.payloadReductionPct||12;
      incident.payloadReductionPct=pct;
      incident.coordinatedDelayMin=20;
      task.selection={action,payloadReductionPct:pct,delayMin:20};
      createExternalWorkflowRequest(task,'Load control / station',10,`Payload reduction of about ${pct}% coordinated with load control.`);
    }else if(action==='delay_conditions'){
      const delay=Math.max(30,incident.context?.delayMin||45);
      incident.coordinatedDelayMin=delay;
      task.selection={action,delayMin:delay};
      completeOperationalTask(task,`Performance window delay accepted with ${delay} minutes projected delay.`);
    }else return false;
  }else if(task.kind==='destination_handling'){
    const destination=flightOperationalDestination(flight);
    const action=actionId||task.action||'request_handling';
    incident.coordinatedDelayMin=15;
    task.selection={action,airport:destination,delayMin:15};
    createExternalWorkflowRequest(task,`${destination} station / handler`,12,`${destination} confirms stand, ramp, and passenger-handling acceptance.`);
  }else if(task.kind==='alternate_selection'){
    const option=diversionOptionsForIncident(incident,{includeReturnOrigin:false}).find(item=>item.code===payload.airport);
    if(!option) return toast('That alternate is no longer operationally suitable.');
    incident.selectedAlternate=option.code;
    incident.diversionReturnOrigin=Boolean(option.returnOrigin);
    incident.diversionRouteKm=option.km;
    incident.diversionDurationMs=option.duration;
    incident.diversionFuel=option.fuel;
    task.selection={airport:option.code,returnOrigin:Boolean(option.returnOrigin),fuel:option.fuel};
    completeOperationalTask(task,`${option.returnOrigin?'Return to origin':option.code} selected; flight deck, ATC, and handling coordination bundled into the recovery plan.`);
  }else if(task.kind==='return_origin_selection'){
    const option=diversionOptionsForIncident(incident,{onlyReturnOrigin:true})[0];
    if(!option) return toast('Return to origin is not currently suitable.');
    incident.selectedAlternate=option.code;
    incident.diversionReturnOrigin=true;
    incident.diversionRouteKm=option.km;
    incident.diversionDurationMs=option.duration;
    incident.diversionFuel=option.fuel;
    task.selection={airport:option.code,returnOrigin:true,fuel:option.fuel};
    completeOperationalTask(task,`Return to ${option.code} confirmed; flight deck, ATC, and handling coordination bundled into the recovery plan.`);
  }else if(task.kind==='flightdeck_recommendation'){
    if(!incident.selectedAlternate) return false;
    task.selection={airport:incident.selectedAlternate};
    createExternalWorkflowRequest(task,'Flight deck',6,incident.diversionReturnOrigin?`Captain accepts return to ${incident.selectedAlternate}.`:`Captain accepts ${incident.selectedAlternate} as the operational alternate.`);
  }else if(task.kind==='diversion_clearance'){
    createExternalWorkflowRequest(task,'ATC via flight crew',8,incident.diversionReturnOrigin?`ATC clears the flight to return to ${incident.selectedAlternate}.`:`ATC clears the flight to ${incident.selectedAlternate} via an amended route.`);
  }else if(task.kind==='alternate_handling'){
    createExternalWorkflowRequest(task,`${incident.selectedAlternate} station / handler`,12,incident.diversionReturnOrigin?`${incident.selectedAlternate} confirms return stand and handling acceptance.`:`${incident.selectedAlternate} confirms stand and handling acceptance.`);
  }else if(task.kind==='medical_assessment'){
    createExternalWorkflowRequest(task,'Medical advisory service',5,'Medical advisory service returned operational guidance.');
  }else if(task.kind==='medical_coordination'){
    incident.coordinatedDelayMin=20;
    createExternalWorkflowRequest(task,'Destination station medical support',8,'Destination medical assistance confirmed for arrival.');
  }else if(task.kind==='flight_watch_assessment'){
    createExternalWorkflowRequest(task,'Flight deck / maintenance control',6,'Flight deck status and maintenance-control guidance received.');
  }else if(task.kind==='flight_watch_coordination'){
    const action=actionId||task.action;
    const delay=action==='hold'?20:action==='continue_low'?25:action==='monitor'?10:12;
    if(['hold','continue_low'].includes(action)) flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.coordinatedDelayMin=delay;
    task.selection={action};
    createExternalWorkflowRequest(task,'Flight deck / ATC coordination',8,`${task.label} confirmed.`);
  }else if(task.kind==='crew_extension_record'){
    const action=actionId||task.action||'record_extension';
    task.selection={action,overrunMin:incident.context?.overrunMin||0,projectedRelease:incident.context?.projectedRelease||0};
    const message=action==='stand_down'
      ? 'Crew Control confirmed stand-down on arrival and post-duty review.'
      : 'Duty extension recorded with flight deck / Crew Control for post-arrival review.';
    createExternalWorkflowRequest(task,'Flight deck / Crew Control',5,message);
  }else if(task.kind==='fuel_monitoring'){
    const action=actionId||task.action||'assess';
    if(action==='conserve') flight.fuelConservationApplied=true;
    incident.fuelMarginContext=fuelMarginContextForFlight(flight,simNow());
    task.selection={action,context:incident.fuelMarginContext};
    createExternalWorkflowRequest(task,'Flight crew fuel monitoring',6,action==='conserve'?'Fuel-conservation profile accepted.':'Fuel state and projected landing margin confirmed.');
  }else if(task.kind==='reroute_coordination'){
    const action=actionId||task.action;
    const baseDelay=Math.max(8,incident.context?.delayMin||15);
    const delay=action==='direct'?Math.max(5,Math.round(baseDelay*.45)):baseDelay;
    flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,delay);
    incident.coordinatedDelayMin=delay;
    task.selection={action,delayMin:delay};
    createExternalWorkflowRequest(task,'ATC via flight crew',10,action==='direct'?'ATC returned a shorter routing opportunity.':'ATC amended route accepted and arrival estimate updated.');
  }else if(task.kind==='cabin_security_coordination'){
    const action=actionId||task.action||'assess';
    if(action==='continue'){
      incident.coordinatedDelayMin=15;
      flight.enrouteDelayMin=Math.max(Number(flight.enrouteDelayMin)||0,15);
    }
    task.selection={action};
    createExternalWorkflowRequest(task,action==='continue'?'Destination security':'Flight deck / cabin lead',8,action==='continue'?'Destination security meet confirmed.':'Cabin security status confirmed.');
  }else if(task.kind==='arrival_maintenance_check'){
    const destination=flightOperationalDestination(flight);
    task.selection={airport:destination};
    createExternalWorkflowRequest(task,`${destination} station / maintenance`,12,'Arrival inspection and post-flight technical hold arranged.');
  }else if(task.kind==='station_coordination'){
    completeOperationalTask(task,'Ground movement, equipment, and passenger handling coordinated.');
  }else return false;
  processOperationalWorkflows(simNow()); recalculateOperations(); AeroServices.commit();
  return true;
}

function applyIncidentMinimumDelay(f,minutes){
  f.incidentDelayMin=Math.max(Number(f.incidentDelayMin)||0,minutes);
}

function processIncidentDeadlines(t=simNow()){
  let changed=false;
  for(const incident of state.incidents.filter(item=>item.status==='open'&&t>=item.deadline)){
    if(!incident.overdue){ incident.overdue=true; incident.deadlineMissedAt=t; changed=true; }
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(flight&&!flight.departureLogged){
      const delay=Math.max(15,Math.ceil((t+15*MIN-flight.departure)/(15*MIN))*15);
      if((flight.incidentDelayMin||0)<delay){ flight.incidentDelayMin=delay; changed=true; }
    }
  }
  return changed;
}

function updateIncidentConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled||f.settled||f.departureLogged||!openIncidentsForFlight(f.id).some(incident=>incident.blocking)) continue;
    if(t>=f.departure){
      const delay=Math.max(15,Math.ceil((t+15*MIN-f.departure)/(15*MIN))*15);
      if((f.incidentDelayMin||0)<delay){ f.incidentDelayMin=delay; changed=true; }
    }
  }
  return changed;
}

function generateTrainingIncident(){
  const type=INCIDENT_TYPE_ORDER[state.incidentExerciseIndex%INCIDENT_TYPE_ORDER.length];
  const definition=INCIDENT_DEFINITIONS[type];
  const flight=state.flights
    .filter(item=>!item.cancelled&&!item.settled&&(definition?.airborneOnly?flightIsAirborne(item):(!item.departureLogged&&flightActualDeparture(item)>simNow()))&&!state.incidents.some(incident=>incident.flightId===item.id&&incident.type===type&&incident.status==='open'))
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  if(!flight) return toast(definition?.airborneOnly?'No airborne flight is available for that exercise.':'Create a future flight before generating a training incident.');
  const incident=createIncident(type,flight,{training:true});
  if(!incident) return toast('No eligible flight is available for that exercise.');
  state.incidentExerciseIndex=(state.incidentExerciseIndex+1)%INCIDENT_TYPE_ORDER.length;
  AeroServices.commit(); toast(`${incident.id} training scenario opened for ${flight.id}.`);
}
function maybeGeneratePreDepartureIssue(f,t){
  if(f.cancelled || f.opsChecked || !state.ops.automaticDisruptions) return false;
  if(t < f.departure-60*MIN || t >= f.departure) return false;
  f.opsChecked=true;
  const roll=Math.random();
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  const maintenance=ac?Management.maintenanceStatus(ac,t):null;
  const conditionFactor=(1+(100-(ac?.condition??100))/25)*(maintenance?.due?1.55:1);
  const technicalChance=clamp(.025*conditionFactor,.025,.15);
  if(roll<technicalChance){
    createIncident('mel_defect',f,{detectedAt:t});
  }else if(roll<technicalChance+.135){
    const delay=10+Math.floor(Math.random()*31);
    const cause=chooseGroundDelayCause(f);
    f.handlingDelayMin+=delay;
    f.handlingDelayCause=cause;
    logEvent(`${f.id}: ${cause.toLowerCase()} +${delay} min at ${f.from}.`);
  }
  return true;
}
function maybeApplyWeatherDelay(f,t){
  if(f.cancelled||f.weatherChecked||t<f.departure-90*MIN||t>=f.departure) return false;
  f.weatherChecked=true;
  const destination=flightOperationalDestination(f);
  const departureWeather=Management.weatherAt(f.from,f.departure);
  const arrivalAt=flightActualArrival(f);
  const arrivalWeather=Management.weatherAt(destination,arrivalAt);
  const routeWeather=window.AeroWeatherEngine?.routeHazardSummary?.(f.from,destination,f.departure)||{delayMin:0,hazards:[]};
  const routeDelay=Math.min(35,routeWeather.delayMin||0);
  const primary=departureWeather.delayMin>=arrivalWeather.delayMin?departureWeather:arrivalWeather;
  f.weatherDelayMin=Math.max(primary.delayMin,routeDelay);
  const weatherCause=setFlightWeatherCause(f,[
    weatherSourceRecord('departure_forecast','Departure forecast',{weather:departureWeather,timestamp:f.departure}),
    weatherSourceRecord('arrival_forecast','Arrival forecast',{weather:arrivalWeather,timestamp:arrivalAt}),
    weatherSourceRecord('route_forecast','Route forecast',{routeWeather,timestamp:f.departure,from:f.from,to:destination,delayMin:routeDelay})
  ],t);
  if(f.weatherDelayMin&&!f.weatherCost){
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const seats=ac?cabinSeatCount(ac):100;
    const severity=weatherCause?.primary?.level||primary.level;
    f.weatherCost=Math.round((1_500+seats*(severity==='severe'?45:18))/500)*500;
    if(f.economics){ f.economics.weatherOps=f.weatherCost; refreshEconomicsTotals(f); }
    postTransaction(-f.weatherCost,'Weather operations',`${f.id} ${(f.weatherCode||primary.conditions).toLowerCase()} handling`,f.id);
  }
  return true;
}
function maybeApplyLiveWeatherImpact(f,t){
  if(!flightIsAirborne(f,t)||!state.ops.automaticDisruptions) return false;
  f.weatherLiveChecks??={};
  const period=Math.floor(t/(30*MIN));
  if(f.weatherLiveChecks.period===period) return false;
  f.weatherLiveChecks.period=period;
  let changed=false;
  const destination=flightOperationalDestination(f);
  const destinationWeather=Management.weatherAt(destination,t+45*MIN);
  const destinationKey=`weather-destination:${f.id}:${Math.floor(t/(3*HOUR))}`;
  const closureActive=destinationWeather.level==='severe'&&destinationWeather.capacityFactor<.7;
  if(closureActive){
    const source=weatherSourceRecord('live_destination_forecast','Destination forecast',{weather:destinationWeather,timestamp:t+45*MIN});
    const type=f.diversionAirport?'diversion_airport_unavailable':'destination_closure';
    const incident=createIncident(type,f,{detectedAt:t,source:'weather',sourceKey:destinationKey,context:{
      airport:destination,conditions:destinationWeather.conditions,capacityFactor:destinationWeather.capacityFactor,delayMin:destinationWeather.delayMin,
      forecastAt:t+45*MIN,weatherSource:source,weatherSummary:weatherSourceText(source),
      reason:f.diversionAirport?`${destination} weather deteriorated after diversion selection`:'Destination airport closed by weather'
    }});
    if(incident){ incident.airport=destination; changed=true; }
  }
  const deteriorationContext=destinationWeatherContextForFlight(f,t);
  const deteriorationActive=!closureActive&&destinationWeather.level!=='normal'&&(destinationWeather.delayMin>=12||destinationWeather.capacityFactor<.86);
  if(updateOpenDerivedIncident('destination_weather_deterioration',f,deteriorationActive,deteriorationContext,t)) changed=true;
  const minimaContext=destinationBelowMinimaContextForFlight(f,t);
  if(updateOpenDerivedIncident('destination_below_minima',f,!closureActive&&Boolean(minimaContext?.active),minimaContext,t)) changed=true;
  const alternateContext=alternateSuitabilityContextForFlight(f,t);
  if(updateOpenDerivedIncident('alternate_unsuitable',f,!closureActive&&Boolean(alternateContext?.active),alternateContext,t)) changed=true;
  if(maybeDetectLightningStrike(f,t)) changed=true;
  const routeContext=routeRerouteContextForFlight(f,t);
  const routeActive=Boolean(routeContext&&routeContext.delayMin>=12);
  if(updateOpenDerivedIncident('airborne_atc_reroute',f,routeActive,routeContext,t)) changed=true;
  if(routeActive&&!f.weatherLiveChecks.routeApplied){
    const delay=Math.min(35,Math.max(8,routeContext.delayMin));
    f.enrouteDelayMin=Math.max(Number(f.enrouteDelayMin)||0,delay);
    f.liveWeatherDelayMin=Math.max(Number(f.liveWeatherDelayMin)||0,Math.round(delay*.35));
    const source=weatherSourceRecord('live_route','Live route weather',{routeWeather:{...routeContext,label:routeContext.cause},timestamp:t,from:f.from,to:destination,delayMin:delay});
    appendFlightWeatherCause(f,source,t);
    f.weatherLiveChecks.routeApplied=true;
    f.weatherRouteHazard=weatherSourceText(source);
    logEvent(`${f.id}: route weather avoidance adds about ${delay} min.`);
    changed=true;
  }
  return changed;
}
function maybeGenerateEnrouteIssue(f,t){
  if(f.enrouteChecked || !state.ops.automaticDisruptions || !flightIsAirborne(f,t)) return false;
  const progress=flightProgress(f,t);
  if(progress<.12||progress>.88||openIncidentsForFlight(f.id).some(incident=>incident.blocking)) return false;
  f.enrouteChecked=true;
  const aircraft=state.aircraft.find(item=>item.id===f.aircraftId);
  const maintenance=aircraft?Management.maintenanceStatus(aircraft,t):null;
  const condition=aircraft?.condition??100;
  const maintenanceBonus=maintenance?.due ? .08 : 0;
  const conditionRisk=clamp((92-condition)/45,0,.45)+maintenanceBonus;
  const passengerFlight=f.flightType!=='ferry'&&(f.pax||0)>0;
  const roll=OperationalIntelligence.stableUnit(`${f.id}:${Math.floor(t/HOUR)}:airborne-report`);
  const context={...airborneContextForFlight(f,t),aircraftCondition:Math.round(condition),maintenanceDue:Boolean(maintenance?.due),phase:'cruise'};
  const nearAirport=progress<.2||progress>.82;
  if(nearAirport){
    const birdRoll=OperationalIntelligence.stableUnit(`${f.id}:${Math.floor(t/(15*MIN))}:bird-strike`);
    if(birdRoll<.018) return Boolean(createIncident('bird_strike',f,{detectedAt:t,source:'flight-deck-report',sourceKey:`bird:${f.id}`,context:{...context,phase:progress<.2?'climb':'descent',trigger:'Suspected bird strike reported by flight deck'}}));
  }
  let cursor=.018+conditionRisk*.10;
  if(roll<cursor){
    return Boolean(createIncident('pressurization_issue',f,{detectedAt:t,source:'condition',sourceKey:`pressurization:${f.id}`,context:{...context,trigger:'Aircraft condition / pneumatic system risk'}}));
  }
  cursor+=.026+conditionRisk*.14;
  if(roll<cursor){
    return Boolean(createIncident('inflight_technical_fault',f,{detectedAt:t,source:'condition',sourceKey:`technical:${f.id}`,context:{...context,trigger:'Aircraft condition / maintenance reliability risk'}}));
  }
  if(passengerFlight){
    cursor+=.035;
    if(roll<cursor) return Boolean(createIncident('onboard_medical',f,{detectedAt:t,source:'passenger-report',sourceKey:`medical:${f.id}`,context:{...context,trigger:'Passenger medical report'}}));
    cursor+=.018+Math.min(.012,(f.pax||0)/25000);
    if(roll<cursor) return Boolean(createIncident('unruly_passenger',f,{detectedAt:t,source:'cabin-report',sourceKey:`unruly:${f.id}`,context:{...context,trigger:'Cabin crew security report'}}));
  }
  return false;
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
      const allActionsConfirmed=exposure.actions.length>0&&exposure.actions.every(action=>exposure.records.some(record=>record.action===action.id&&record.status==='confirmed'));
      const legacyHandled=!exposure.records.length&&Boolean(flight.passengerRecoveryArrangedAt||flight.passengerAccommodationArrangedAt||flight.passengerReleasedAt);
      exposure.arranged=allActionsConfirmed||legacyHandled;
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
  return changed;
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
      const allActionsConfirmed=exposure.actions.length>0&&exposure.actions.every(action=>exposure.records.some(record=>record.action===action.id&&record.status==='confirmed'));
      const legacyHandled=!exposure.records.length&&Boolean(flight.crewAccommodationArrangedAt);
      exposure.arranged=allActionsConfirmed||legacyHandled;
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

function processCrewRecoveries(t=simNow()){
  let changed=false;
  for(const recovery of state.crewRecoveries||[]){
    if(recovery.status==='confirmed') continue;
    if(recovery.status==='requested'&&t>=recovery.requestedAt+8*MIN){
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
        if(recovery.action==='hotel') flight.crewAccommodationArrangedAt=t;
        if(recovery.action==='transport') flight.crewTransportArrangedAt=t;
        if(recovery.action==='stand_down') flight.crewStoodDownAt=t;
      }
      changed=true;
    }
  }
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
    confirmsAt:now+crewRecoveryActionDuration(action),
    completedAt:0,
    amount,
    crew:exposure.crew,
    releaseAirport:exposure.releaseAirport,
    reason:exposure.reason,
    costEventId:event?.id||''
  });
  AeroServices.commit();
  requestUiRefresh('desk','left','context');
  toast(`${flight.id}: ${crewRecoveryActionRequestLabel(action)} requested${event?` (${money(event.amount)})`:''}.`);
  return event;
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

function arrangeCrewAccommodation(flightId){
  return authorizeCrewRecovery(flightId,'hotel');
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

function processEvents(){
  let changed=false;
  let needsRecalc=false;
  const t=simNow();
  if(!state.ops?.caseLinksRepaired){
    if(repairIncidentCaseLinks()) changed=true;
    state.ops??={automaticDisruptions:true};
    state.ops.caseLinksRepaired=true;
    changed=true;
  }
  if(!state.ops?.phaseRealismRepaired){
    if(repairIncidentPhaseRealism(t)) changed=true;
    state.ops??={automaticDisruptions:true};
    state.ops.phaseRealismRepaired=true;
    changed=true;
  }
  if(ensureRecurringFlights()){ changed=true; needsRecalc=true; }
  if(ensurePlannedCrewAugmentation()){ changed=true; needsRecalc=true; }
  if(processOperationalWorkflows(t)){ changed=true; needsRecalc=true; }
  if(Management.processMaintenance(state,t,postTransaction)){ changed=true; needsRecalc=true; }
  if(Management.processWeeklyReviews(state,t)) changed=true;
  if(repairFirstFlightFuelAttribution()) changed=true;
  if(processPersonnelTransfers(t)){ changed=true; needsRecalc=true; }
  if(processResourceRequests(t)){ changed=true; needsRecalc=true; }
  if(processPassengerRecoveries(t)) changed=true;
  if(processCrewRecoveries(t)) changed=true;
  if(processMelConstraints(t)){ changed=true; needsRecalc=true; }

  for(const f of state.flights){
    if(maybeApplyWeatherDelay(f,t)){ changed=true; needsRecalc=true; }
    if(maybeApplyLiveWeatherImpact(f,t)){ changed=true; needsRecalc=true; }
    if(maybeGenerateEnrouteIssue(f,t)){ changed=true; needsRecalc=true; }
    if(maybeGeneratePreDepartureIssue(f,t)){ changed=true; needsRecalc=true; }
    if(maybeGenerateOperationalIncident(f,t)){ changed=true; needsRecalc=true; }
    if(maybeApplyNetworkConstraints(f,t)){ changed=true; needsRecalc=true; }
  }
  if(processIncidentDeadlines(t)){ changed=true; needsRecalc=true; }
  if(updateIncidentConstraints(t)){ changed=true; needsRecalc=true; }
  if(needsRecalc){ recalculateOperations(); needsRecalc=false; }
  if(updateStaffingConstraints(t)){ changed=true; needsRecalc=true; }
  if(updateMaintenanceConstraints(t)){ changed=true; needsRecalc=true; }
  if(updatePositioningConstraints(t)){ changed=true; needsRecalc=true; }
  if(needsRecalc){ recalculateOperations(); needsRecalc=false; }
  if(updatePassengerConnections()) changed=true;
  if(processDerivedOperationalIncidents(t)){ changed=true; needsRecalc=true; }

  for(const f of state.flights){
    if(f.cancelled) continue;
    if(fuelFlight(f,t)) changed=true;
    const slotGraceMin=(AIRPORT_OPS[f.from]?.graceMin)||10;
    if(f.slotMissed && !f.slotLogged && t>=f.departure+slotGraceMin*MIN){
      f.slotLogged=true;
      logEvent(`${f.id}: original ${f.from} slot missed; new slot ${formatTime(f.assignedSlot)}.`);
      changed=true;
    }
    if(!f.departureLogged && t>=flightActualDeparture(f)){
      f.departureLogged=true;
      if(maybeGenerateEnrouteIssue(f,t)){ changed=true; needsRecalc=true; }
      const d=flightTotalDepartureDelayMin(f);
      logEvent(`${f.id} departed ${f.from} for ${flightOperationalDestination(f)}${d?` ${d} min late`:''}.`,flightActualDeparture(f));
      changed=true;
    }
    if(f.departureLogged && !f.settled && t>=flightActualArrival(f)){
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
  if(changed){
    if(needsRecalc) recalculateOperations();
    else invalidateOperationalIndex();
    save();
  }
  return changed;
}

function availableAircraftForSchedule(){
  return state.aircraft;
}

function stableRouteAffinity(from,to){
  const key=[from,to].sort().join('-');
  let hash=2166136261;
  for(const char of key){ hash^=char.charCodeAt(0); hash=Math.imul(hash,16777619); }
  return .84+((hash>>>0)%3300)/10000;
}

function destinationSeasonFactor(destination,month){
  const profile=AIRPORT_MARKETS[destination];
  if(month===11) return 1.10;
  if([6,7].includes(month)) return profile.season==='summer'?1.14:profile.season==='winter'?.89:1.02;
  if([0,1].includes(month)) return profile.season==='winter'?1.13:profile.season==='summer'?.90:.98;
  if([2,3].includes(month)&&profile.season==='spring') return 1.12;
  if([3,4,8,9].includes(month)) return 1.03;
  return 1;
}

function demandTimeFactors(departure,from,to){
  const d=new Date(departure||simNow());
  const day=d.getDay(),hour=d.getHours(),month=d.getMonth();
  const destinationTourism=AIRPORT_MARKETS[to]?.tourism||.7;
  const seasonRaw=to?destinationSeasonFactor(to,month):1;
  const economy={
    weekday:[5,0].includes(day)?1.12:day===6?1.06:[2,3].includes(day)?.93:.98,
    time:hour>=6&&hour<10?1.05:hour>=16&&hour<20?1.08:hour>=10&&hour<16?1.03:hour>=21||hour<6?.82:.94,
    season:1+(seasonRaw-1)*destinationTourism
  };
  const business={
    weekday:[1,2,3,4].includes(day)?1.11:day===5?.98:day===0?.82:.70,
    time:hour>=6&&hour<10?1.16:hour>=16&&hour<20?1.13:hour>=10&&hour<16?.98:hour>=21||hour<6?.75:.90,
    season:1+(seasonRaw-1)*.28
  };
  const first={weekday:business.weekday,time:business.time,season:1+(seasonRaw-1)*.4};
  return {
    weekday:(economy.weekday+business.weekday)/2,
    time:(economy.time+business.time)/2,
    season:(economy.season+business.season)/2,
    classes:{economy,business,first}
  };
}

function routeMarketDemand(from,to,departure){
  const origin=AIRPORT_MARKETS[from],destination=AIRPORT_MARKETS[to];
  const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
  const marketSize=Math.sqrt(origin.size*destination.size);
  const distanceFactor=km<400?.62:km<1500?1:km<4000?.91:.82;
  const regionFactor=origin.region===destination.region?1.12:1;
  const networkFactor=.78+.22*((origin.hub+destination.hub)/2);
  const localAffinity=stableRouteAffinity(from,to);
  const totalDaily=Math.round((120+900*Math.pow(marketSize,1.65))*distanceFactor*regionFactor*networkFactor*localAffinity);
  const homePresence=[from,to].includes(state?.home);
  const capture=clamp(.27+(homePresence?.11:0)+origin.hub*.035,.27,.43);
  const capturedDaily=Math.round(totalDaily*capture);
  const avgBusiness=(origin.business+destination.business)/2,avgWealth=(origin.wealth+destination.wealth)/2;
  const longHaul=km>=3500;
  const firstShare=clamp((longHaul?.018:.004)+avgWealth*.035+(km>=7000?.012:0),.01,.065);
  const businessShare=clamp(.07+avgBusiness*.11+(km>=1500?.035:0)+(longHaul?.025:0),.12,.25);
  return {
    totalDaily,capturedDaily,capture,km,marketSize,distanceFactor,regionFactor,networkFactor,localAffinity,
    mix:{business:avgBusiness,tourism:(origin.tourism+destination.tourism)/2,wealth:avgWealth},
    classDemand:{
      economy:Math.round(capturedDaily*(1-businessShare-firstShare)),
      business:Math.round(capturedDaily*businessShare),
      first:Math.round(capturedDaily*firstShare)
    }
  };
}

function sameLocalOperatingDay(a,b){
  const x=new Date(a),y=new Date(b);
  return x.getFullYear()===y.getFullYear()&&x.getMonth()===y.getMonth()&&x.getDate()===y.getDate();
}

function existingRouteBookings(from,to,departure){
  const booked={economy:0,business:0,first:0};
  for(const flight of state.flights){
    if(flight.cancelled||flight.from!==from||flight.to!==to||!sameLocalOperatingDay(flight.departure,departure)) continue;
    for(const className of Object.keys(CABIN_CLASSES)) booked[className]+=flight.classPax?.[className]||0;
  }
  return booked;
}

function estimateFlight(from,to,ac,fareValue,{departure=simNow(),randomize=false,availableFuelGallons=0}={}){
  const a=AIRPORTS[from], b=AIRPORTS[to], m=MODELS[ac.model];
  const km=distanceKm(a,b);
  const duration=flightDurationMs(a,b,m);
  const rangeOk=km<=m.maxRangeKm;
  const baseFare=60+km*.085;
  const fares=normalizeFares(fareValue);
  const cabin=cabinForAircraft(ac);
  const market=routeMarketDemand(from,to,departure);
  const routeFactor=clamp(market.capturedDaily/450,.35,1.6);
  const calendar=demandTimeFactors(departure,from,to);
  const existingBookings=existingRouteBookings(from,to,departure);
  const classPax={},classLoads={},classDemand={};
  let pax=0,revenue=0,occupiedSeats=0,totalSeats=0;
  for(const [className,config] of Object.entries(CABIN_CLASSES)){
    const seats=cabin[className]||0;
    const classBaseFare=baseFare*config.baseFareMultiplier;
    const priceFactor=clamp(Math.exp(-config.elasticity*(fares[className]/classBaseFare-1)),.01,1.15);
    const randomFactor=randomize ? .92+Math.random()*.16 : 1;
    const timing=calendar.classes[className];
    const remainingDemand=Math.max(0,market.classDemand[className]-existingBookings[className]);
    const willingPassengers=remainingDemand*priceFactor*timing.weekday*timing.time*timing.season*randomFactor;
    const passengers=seats?Math.min(Math.floor(seats*.98),Math.max(0,Math.round(willingPassengers))):0;
    const load=seats?passengers/seats:0;
    classPax[className]=passengers; classLoads[className]=load;
    classDemand[className]={price:priceFactor,random:randomFactor,remaining:remainingDemand,market:market.classDemand[className],...timing};
    pax+=passengers; occupiedSeats+=passengers; totalSeats+=seats;
    revenue+=passengers*fares[className];
  }
  const load=totalSeats?occupiedSeats/totalSeats:0;
  const fuel=flightFuelPlan(from,to,ac);
  const fuelPrice=state?.fuelMarket?.pricePerGallon||FUEL_MARKET_BASE_EUR_GAL;
  const fuelGallons=Math.max(0,Math.ceil(fuel.requiredGal-availableFuelGallons));
  const fuelRemaining=Math.max(0,availableFuelGallons+fuelGallons-fuel.tripBurnGal);
  const economics=calculateFlightEconomics({from,to,model:m,distanceKm:km,duration,pax,fare:fares.economy,ticketRevenue:revenue,fuelGallons,fuelPrice});
  const fuelCost=economics.fuel,costs=economics.totalCost;
  const baseCosts=costs-fuelCost;
  const demand={route:routeFactor,weekday:calendar.weekday,time:calendar.time,season:calendar.season,classes:classDemand,market,existingBookings};
  return {km,duration,rangeOk,baseFare,load,pax,classPax,classLoads,fares,revenue,baseCosts,fuelGallons,fuelRequiredGallons:fuel.requiredGal,tripFuelGallons:fuel.tripBurnGal,fuelRemaining,fuelCost,costs,profit:revenue-costs,demand,economics};
}

function addLocalDays(timestamp, days){
  const d=new Date(timestamp);
  d.setDate(d.getDate()+days);
  return d.getTime();
}

function nextRecurringDeparture(timestamp, rule, operatingDays=null, operatingMonths=null){
  if(rule==='custom'){
    const days=Array.isArray(operatingDays)&&operatingDays.length?operatingDays:[0,1,2,3,4,5,6];
    const months=Array.isArray(operatingMonths)&&operatingMonths.length?operatingMonths:[0,1,2,3,4,5,6,7,8,9,10,11];
    let next=addLocalDays(timestamp,1),guard=0;
    while(guard<740 && (!days.includes(new Date(next).getDay())||!months.includes(new Date(next).getMonth()))){ next=addLocalDays(next,1); guard++; }
    return next;
  }
  if(rule==='every2') return addLocalDays(timestamp,2);
  if(rule==='weekly') return addLocalDays(timestamp,7);
  if(rule==='weekdays'){
    let n=addLocalDays(timestamp,1);
    while([0,6].includes(new Date(n).getDay())) n=addLocalDays(n,1);
    return n;
  }
  return addLocalDays(timestamp,1);
}

function minimumRepeatInterval(rule){
  if(rule==='every2') return 2*DAY;
  if(rule==='weekly') return 7*DAY;
  return DAY;
}

function alignToOperatingCalendar(timestamp,rule,operatingDays,operatingMonths){
  if(rule!=='custom') return timestamp;
  let candidate=timestamp,guard=0;
  while(guard<740){
    const date=new Date(candidate);
    if(operatingDays.includes(date.getDay())&&operatingMonths.includes(date.getMonth())) return candidate;
    candidate=addLocalDays(candidate,1); guard++;
  }
  return null;
}

function estimateFerryFlight(from,to,ac,departure){
  const estimate=estimateFlight(from,to,ac,0,{departure,randomize:false});
  estimate.pax=0; estimate.load=0; estimate.revenue=0;
  estimate.classPax={economy:0,business:0,first:0};
  estimate.classLoads={economy:0,business:0,first:0};
  estimate.economics.ticketRevenue=0;
  estimate.economics.passengerFees=0;
  estimate.economics.groundHandling=Math.round((estimate.economics.groundHandling||0)*.55);
  estimate.economics.totalCost=flightEconomicsTotal(estimate.economics);
  estimate.economics.operatingProfit=-estimate.economics.totalCost;
  estimate.costs=estimate.economics.totalCost;
  estimate.profit=-estimate.costs;
  estimate.baseCosts=estimate.costs-(estimate.economics.fuel||0);
  return estimate;
}

function createFlightRecord({aircraftId,from,to,departure,fare,serviceId=null,serviceLeg=null,flightType='passenger'}){
  const ac=state.aircraft.find(a=>a.id===aircraftId);
  const est=flightType==='ferry'?estimateFerryFlight(from,to,ac,departure):estimateFlight(from,to,ac,fare,{departure,randomize:true});
  const id='AS'+state.nextFlight++;
  const f={
    id,aircraftId,from,to,departure,arrival:departure+est.duration,fare:est.fares.economy,fares:est.fares,
    load:est.load,pax:est.pax,classPax:est.classPax,classLoads:est.classLoads,revenue:est.revenue,demand:est.demand,economics:{...est.economics,fuel:0,totalCost:est.baseCosts,operatingProfit:est.revenue-est.baseCosts},
    baseCosts:est.baseCosts,costs:est.baseCosts,
    fueled:false,fuelGallons:0,fuelPurchasedGallons:0,fuelRequiredGallons:0,tripFuelGallons:0,fuelCost:0,fuelPricePerGallon:0,
    maintenanceCost:0,weatherCost:0,defectSeverity:'',flightType,cancelled:false,cancelledAt:0,cancellationCost:0,
    settled:false,departureLogged:false,serviceId,serviceLeg,
    handlingDelayMin:0,technicalDelayMin:0,staffingDelayMin:0,staffingBlocked:false,staffingShortage:'',
    handlingDelayCause:'',manualDelayMin:0,weatherDelayMin:0,liveWeatherDelayMin:0,weatherChecked:false,weatherCode:'',maintenanceDelayMin:0,maintenanceBlocked:false,
      positioningDelayMin:0,positioningBlocked:false,issueAcknowledgedAt:0,issueAcknowledgedKey:'',
      incidentDelayMin:0,incidentChecks:{},diversionAirport:'',operationalDurationMs:null,
      enrouteDelayMin:0,propagatedDelayMin:0,slotDelayMin:0,turnaroundRecoveryMin:0,slotPriorityMin:0,
      deicingCompletedAt:0,deicingHoldoverUntil:0,
      nightRestrictionDelayMin:0,nightRestrictionLabel:'',nightRestrictionConflictDelayMin:0,nightRestrictionConflictLabel:'',
    nightRecoveryDecision:'',nightRecoverySourceKey:'',nightRecoveryApprovedAt:0,
    arrivalCurfewCoordinatedKey:'',arrivalCurfewCoordinatedAt:0,
    crewDutyId:'',crewDutySplit:false,crewSwappedAt:0,crewRoleSwaps:{},crewAugmentationPlanned:false,crewAugmentationReason:'',
    crewAccommodationArrangedAt:0,crewTransportArrangedAt:0,crewStoodDownAt:0,
    connectionPax:0,connectionCriticalPax:0,connectionAtRiskPax:0,connectionMissedPax:0,
    passengerAccommodationArrangedAt:0,passengerRecoveryArrangedAt:0,passengerReleasedAt:0,recoveryCostBooked:0,cancellationCostBooked:'',
    weatherLiveChecks:{},weatherRouteHazard:'',weatherCause:null,
    slotMissed:false,opsChecked:false,enrouteChecked:false,slotLogged:false
  };
  state.flights.push(f);
  return f;
}

function ensureRecurringFlights(){
  if(!Array.isArray(state.services)) state.services=[];
  const horizon=simNow()+14*DAY;
  let changed=false;

  for(const svc of state.services){
    if(!svc.active) continue;
    const ac=state.aircraft.find(a=>a.id===svc.aircraftId);
    if(!ac){ svc.active=false; changed=true; continue; }
    const turnMin=effectiveTurnaroundMinutes(ac,svc.to,svc.turnaroundMin);
    const serviceFlights=state.flights.filter(f=>f.serviceId===svc.id).sort((a,b)=>a.departure-b.departure);
    const outboundFlights=serviceFlights.filter(f=>f.serviceLeg==='outbound');
    const returnFlights=serviceFlights.filter(f=>f.serviceLeg==='return');
    for(let i=0;i<outboundFlights.length;i++){
      const outbound=outboundFlights[i];
      const nextOutbound=outboundFlights[i+1];
      const alreadyPaired=returnFlights.some(f=>
        f.departure>outbound.departure && (!nextOutbound || f.departure<nextOutbound.departure)
      );
      if(alreadyPaired) continue;
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=outbound.arrival+turnMin*MIN;
      const isFirst=outbound.departure===svc.firstDeparture;
      const returnDeparture=isFirst && Number.isFinite(svc.firstReturnDeparture)
        ? svc.firstReturnDeparture
        : destinationRight
          ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
          : alignTimestampToAirportSlot(earliestReturn,svc.to);
      if(returnDeparture<simNow() || (nextOutbound && returnDeparture>=nextOutbound.departure)) continue;
      const returnEstimate=estimateFlight(svc.to,svc.from,ac,svc.fares||svc.fare,{departure:returnDeparture});
      if(!validateAircraftItinerary(ac,[{
        from:svc.to,to:svc.from,departure:returnDeparture,arrival:returnDeparture+returnEstimate.duration,label:`${svc.id} return`
      }]).ok) continue;
      createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.to,to:svc.from,departure:returnDeparture,
        fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'return'
      });
      changed=true;
    }
    let guard=0;
    while(svc.nextDeparture<=horizon && guard<600){
      const outboundEstimate=estimateFlight(svc.from,svc.to,ac,svc.fares||svc.fare,{departure:svc.nextDeparture});
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=svc.nextDeparture+outboundEstimate.duration+turnMin*MIN;
      const firstRotation=svc.lastGeneratedDeparture===null && svc.nextDeparture===svc.firstDeparture;
      const returnDeparture=firstRotation && Number.isFinite(svc.firstReturnDeparture)
        ? svc.firstReturnDeparture
        : destinationRight
          ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
          : alignTimestampToAirportSlot(earliestReturn,svc.to);
      const returnEstimate=estimateFlight(svc.to,svc.from,ac,svc.fares||svc.fare,{departure:returnDeparture});
      const itinerary=validateAircraftItinerary(ac,[
        {from:svc.from,to:svc.to,departure:svc.nextDeparture,arrival:svc.nextDeparture+outboundEstimate.duration,label:`${svc.id} outbound`},
        {from:svc.to,to:svc.from,departure:returnDeparture,arrival:returnDeparture+returnEstimate.duration,label:`${svc.id} return`}
      ]);
      if(itinerary.ok){
        createFlightRecord({
          aircraftId:svc.aircraftId,from:svc.from,to:svc.to,
          departure:svc.nextDeparture,fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'outbound'
        });
        createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.to,to:svc.from,
        departure:returnDeparture,
        fare:svc.fares||svc.fare,serviceId:svc.id,serviceLeg:'return'
        });
      }else{
        logEvent(`${svc.id} rotation skipped: ${itinerary.reason}.`,svc.nextDeparture);
      }

      svc.lastGeneratedDeparture=svc.nextDeparture;
      svc.nextDeparture=nextRecurringDeparture(svc.nextDeparture,svc.rule,svc.operatingDays,svc.operatingMonths);
      guard++; changed=true;
    }
  }
  if(changed) save();
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
    const missing=Math.max(0,count-staffAt(airport,role));
    if(!['captains','firstOfficers'].includes(role)){
      if(missing) deficits.push({role,airport,amount:missing,qualification:'',required:count,available:staffAt(airport,role)});
      continue;
    }
    const ratingMissing=Math.max(0,(qualifiedNeeded[role]||0)-qualifiedStaffAt(airport,role,family));
    const amount=Math.max(missing,ratingMissing);
    if(amount) deficits.push({role,airport,amount,qualification:family,required:Math.max(count,qualifiedNeeded[role]||0),available:Math.min(staffAt(airport,role),qualifiedStaffAt(airport,role,family))});
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

function updateMaintenanceConstraints(t=simNow()){
  let changed=false;
  for(const f of state.flights){
    if(f.cancelled||f.settled||f.departureLogged) continue;
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    if(!ac) continue;
    const maintenance=Management.maintenanceStatus(ac,t);
    const job=maintenance.scheduled;
    const overlapsJob=Boolean(job&&job.start<f.arrival&&job.end>f.departure);
    if(maintenance.grounding||overlapsJob||maintenance.active){
      const delayTarget=job?job.end:t+15*MIN;
      const delay=Math.max(15,Math.ceil((delayTarget-f.departure)/(15*MIN))*15);
      if(!f.maintenanceBlocked||f.maintenanceDelayMin!==delay) changed=true;
      f.maintenanceBlocked=true;
      f.maintenanceDelayMin=delay;
    }else if(f.maintenanceBlocked||f.maintenanceDelayMin){
      f.maintenanceBlocked=false;
      f.maintenanceDelayMin=0;
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
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||flightActualArrival(a)-flightActualArrival(b));
    for(const flight of future){
      const dep=flightActualDeparture(flight),destination=flightOperationalDestination(flight);
      const outOfPosition=flight.from!==projectedLocation;
      const inActionWindow=t>=flight.departure-6*HOUR;
      const delay=outOfPosition&&inActionWindow
        ? Math.max(15,Math.ceil((Math.max(t+15*MIN,availableAt)-flight.departure)/(15*MIN))*15)
        : 0;
      if(outOfPosition){
        if(!flight.positioningBlocked||flight.positioningDelayMin!==delay) changed=true;
        flight.positioningBlocked=true;
        flight.positioningDelayMin=delay;
        continue;
      }
      if(flight.positioningBlocked||flight.positioningDelayMin){
        flight.positioningBlocked=false;
        flight.positioningDelayMin=0;
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
      const delay=Math.max(15,Math.ceil((t+15*MIN-f.departure)/(15*MIN))*15);
      if(f.staffingDelayMin!==delay || !f.staffingBlocked){ changed=true; }
      f.staffingDelayMin=delay; f.staffingBlocked=true; f.staffingShortage=shortages.join(' · ');
    }else if(f.staffingBlocked || f.staffingDelayMin){
      f.staffingDelayMin=0; f.staffingBlocked=false; f.staffingShortage=''; changed=true;
    }
  }
  return changed;
}

function scheduleFlight(){
  const from=originEl.value, to=destEl.value, acId=aircraftEl.value;
  const ac=state.aircraft.find(a=>a.id===acId);
  const fares=currentScheduleFares();
  const scheduleType=scheduleTypeEl.value;
  const operatingCalendar=selectedOperatingCalendar();
  const rawDeparture=nextTimestampForClock(departureTimeEl.value);
  const usesCustomCalendar=scheduleType==='recurring'&&repeatRuleEl.value==='custom';
  const departure=rawDeparture&&(!usesCustomCalendar||(operatingCalendar.days.length&&operatingCalendar.months.length))
    ? alignToOperatingCalendar(rawDeparture,usesCustomCalendar?'custom':repeatRuleEl.value,operatingCalendar.days,operatingCalendar.months)
    : null;
  if(!departure) return toast('Choose a valid departure time.');

  if(!ac) return toast('Choose an available aircraft.');
  if(from===to) return toast('Origin and destination must differ.');

  if(scheduleType==='ferry'){
    const projected=aircraftProjectedLocation(ac,departure);
    if(['airborne','taxi_out','taxi_in','planned'].includes(projected.status)) return toast(`${ac.tail} is not available until ${formatTime(projected.availableAt)} because of ${projected.blockedBy?.id||'another flight'}.`);
    if(from!==projected.location){
      originEl.value=projected.location;
      refreshSchedulePreview();
      return toast(`${ac.tail} is expected at ${projected.location}; ferry origin updated.`);
    }
    const ferry=estimateFerryFlight(from,to,ac,departure);
    if(!ferry.rangeOk) return toast(`${ac.model} does not have enough range for this ferry flight.`);
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+ferry.duration,label:'ferry flight'}]);
    if(!itinerary.ok) return toast(`${ac.tail} cannot operate this ferry flight: ${itinerary.reason}.`);
    const personnelRequests=requestPersonnelDeficitsForFlight(ac,departure,ferry.duration,from,null,true,'ferry');
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare:0,flightType:'ferry'});
    selectedAircraftId=ac.id; selectedFlightId=f.id;
    AeroServices.commit();
    closeFlightPlanningWidget();
    return toast(`${f.id} ferry flight scheduled ${from} → ${to}.${personnelRequestToastSuffix(personnelRequests)}`);
  }

  const outbound=estimateFlight(from,to,ac,fares,{departure});
  if(!outbound.rangeOk) return toast(`${ac.model} does not have enough range for this route.`);
  if(scheduleType==='once'){
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+outbound.duration,label:'new flight'}]);
    if(!itinerary.ok) return toast(`${ac.tail} cannot operate this flight: ${itinerary.reason}.`);
    const personnelRequests=requestPersonnelDeficitsForFlight(ac,departure,outbound.duration,from);
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare:fares});
    logEvent(`${f.id} scheduled ${from} → ${to} with ${ac.tail}.`);
    selectedAircraftId=ac.id;
    AeroServices.commit();
    closeFlightPlanningWidget();
    return toast(`${f.id} scheduled. ${formatDuration(outbound.duration)} block time.${personnelRequestToastSuffix(personnelRequests)}`);
  }

  const rule=repeatRuleEl.value;
  if(rule==='custom' && (!operatingCalendar.days.length||!operatingCalendar.months.length))
    return toast('Select at least one operating weekday and one operating month.');
  const requestedTurnaroundMin=Number(turnaroundEl.value)||90;
  const turnaroundMin=effectiveTurnaroundMinutes(ac,to,requestedTurnaroundMin);
  let slotPlan=requiredSlotPlan(from,to,ac,fares,departure,turnaroundMin);
  const inbound=estimateFlight(to,from,ac,fares,{departure:slotPlan.returnDeparture});
  const alignedDeparture=slotPlan.outboundDeparture;
  const cycle=(slotPlan.returnDeparture-alignedDeparture)+inbound.duration;
  const returnNeedsLocalFlightCrew=cycle>12*HOUR;
  const minInterval=minimumRepeatInterval(rule);

  if(!slotPlan.originRight||!slotPlan.destinationRight){
    const requested=[];
    if(!slotPlan.originRight){
      requestSlotRight(from,slotPlan.outboundDeparture,{silent:true,source:'flight creation'});
      requested.push(`${from} ${formatTime(slotPlan.outboundDeparture)}`);
    }
    if(!slotPlan.destinationRight){
      requestSlotRight(to,slotPlan.returnDeparture,{silent:true,source:'flight creation'});
      requested.push(`${to} ${formatTime(slotPlan.returnDeparture)}`);
    }
    slotPlan=requiredSlotPlan(from,to,ac,fares,departure,turnaroundMin);
    if(!slotPlan.originRight||!slotPlan.destinationRight){
      AeroServices.commit();
      return toast(`Slot coordination requested for ${requested.join(' and ')}. Create the recurring service once the slot series is assigned.`);
    }
  }

  const itinerary=validateAircraftItinerary(ac,[
    {from,to,departure:alignedDeparture,arrival:alignedDeparture+outbound.duration,label:'new outbound'},
    {from:to,to:from,departure:slotPlan.returnDeparture,arrival:slotPlan.returnDeparture+inbound.duration,label:'new return'}
  ]);
  if(!itinerary.ok) return toast(`${ac.tail} cannot fit this rotation: ${itinerary.reason}.`);

  if(cycle>minInterval){
    return toast(
      `This aircraft needs ${formatDuration(cycle)} for the round trip. `+
      `Choose a less frequent repeat pattern or a shorter route.`
    );
  }

  const personnelRequests=[
    ...requestPersonnelDeficitsForFlight(ac,alignedDeparture,cycle,from),
    ...requestPersonnelDeficitsForFlight(ac,slotPlan.returnDeparture,inbound.duration,to,null,returnNeedsLocalFlightCrew)
  ];
  const svc={
    id:'SCH'+state.nextService++,
    aircraftId:ac.id,from,to,fare:fares.economy,fares,rule,turnaroundMin,requestedTurnaroundMin,
    operatingDays:rule==='custom'?operatingCalendar.days:null,
    operatingMonths:rule==='custom'?operatingCalendar.months:null,
    firstDeparture:alignedDeparture,firstReturnDeparture:slotPlan.returnDeparture,
    nextDeparture:alignedDeparture,
    originSlotRightId:slotPlan.originRight.id,
    destinationSlotRightId:slotPlan.destinationRight.id,
    lastGeneratedDeparture:null,active:true,createdAt:simNow()
  };
  state.services.push(svc);
  ensureRecurringFlights();
  logEvent(`${svc.id} created: ${from} ↔ ${to}, ${rule}, ${ac.tail}.`);
  selectedAircraftId=ac.id;
  AeroServices.commit();
  closeFlightPlanningWidget();
  toast(`${svc.id} is active. Future round trips will be generated automatically.${turnaroundMin>requestedTurnaroundMin?` Turn raised to ${turnaroundMin} min minimum.`:''}${personnelRequestToastSuffix(personnelRequests)}`);
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
  if(!flight||flight.cancelled||flight.departureLogged||flight.fueled) return [];
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
  if(!f||f.departureLogged) return toast('Only a flight still on the ground can be held.');
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
  if(!f||f.departureLogged) return toast('Only a flight still on the ground can be held.');
  if(!Number.isFinite(targetTime)) return toast('Choose a valid hold-until time.');
  const current=flightActualDeparture(f);
  if(targetTime<=current+30_000) return toast(`${f.id} is already projected at or after that time.`);
  const minutes=Math.ceil((targetTime-current)/MIN);
  delayFlight(flightId,minutes);
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

function flightCancellationTargets(f){
  if(!f.serviceId||f.serviceLeg!=='outbound') return [f];
  const rotation=rotationForFlight(f);
  return [rotation.outbound,rotation.returnFlight].filter(Boolean).filter(item=>!item.cancelled&&!item.departureLogged);
}

function turnaroundCancellationTargets(f){
  if(!f?.serviceId) return [];
  const rotation=rotationForFlight(f);
  const targets=[rotation.outbound,rotation.returnFlight]
    .filter(Boolean)
    .filter(item=>!item.cancelled&&!item.departureLogged);
  return [...new Map(targets.map(item=>[item.id,item])).values()];
}

function applyFlightCancellation(flight,reason=''){
  const now=simNow();
  const cancellationCost=typeof cancellationRecoveryCost==='function'?cancellationRecoveryCost(flight):0;
  flight.cancelled=true;
  flight.cancelledAt=now;
  flight.cancellationCost=cancellationCost;
  if(cancellationCost&&!flight.cancellationCostBooked&&typeof recordRecoveryCostEvent==='function'){
    const event=recordRecoveryCostEvent({
      flight,category:'passenger',kind:'flight_cancellation',amount:cancellationCost,
      passengers:flight.pax||0,airport:flight.from,
      description:`${flight.id}: cancellation recovery and reaccommodation`
    });
    flight.cancellationCostBooked=event?.id||'manual';
  }
  flight.issueAcknowledgedAt=0;
  flight.issueAcknowledgedKey='';
  state.stats.cancelled+=1;
  for(const incident of state.incidents){
    if(incident.flightId!==flight.id||incident.status!=='open') continue;
    resolveIncidentImpacts(incident,now,'handled');
    incident.status='resolved';
    incident.blocking=false;
    incident.resolvedAt=now;
    incident.selectedAction='cancel';
    incident.outcome=`${flight.id} cancelled${reason?` · ${reason}`:''}.`;
    for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
  }
}

function finishFlightCancellations(targets,message){
  if(targets.some(flight=>selectedFlightId===flight.id)) selectedFlightId=null;
  recalculateOperations();
  updatePassengerConnections();
  AeroServices.commit();
  requestUiRefresh('all');
  toast(message);
  return true;
}

function cancelFlight(flightId,{skipConfirm=false,reason=''}={}){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('An airborne or completed flight cannot be cancelled.');
  const targets=flightCancellationTargets(f);
  const pairing=targets.length>1?' The paired return leg will also be cancelled so the aircraft remains correctly positioned.':'';
  if(!skipConfirm&&!AeroServices.confirm(`Cancel ${f.id}?${pairing}`)) return;
  for(const flight of targets) applyFlightCancellation(flight,reason);
  return finishFlightCancellations(targets,`${targets.map(item=>item.id).join(' and ')} cancelled.`);
}

function cancelSingleFlight(flightId,{skipConfirm=false,reason='Manual OCC cancellation'}={}){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!flight||flight.departureLogged) return toast('An airborne or completed flight cannot be cancelled.');
  const rotationWarning=flight.serviceId?' This cancels only this leg; any paired leg remains in the programme and may need aircraft recovery.':'';
  if(!skipConfirm&&!AeroServices.confirm(`Cancel single flight ${flight.id}?${rotationWarning}`)) return false;
  applyFlightCancellation(flight,reason);
  return finishFlightCancellations([flight],`${flight.id} cancelled.`);
}

function cancelTurnaround(flightId,{skipConfirm=false,reason='Manual OCC turnaround cancellation'}={}){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!flight||flight.departureLogged) return toast('An airborne or completed flight cannot be cancelled.');
  const targets=turnaroundCancellationTargets(flight);
  if(targets.length<2) return toast('No complete future turnaround pair is available for this flight.');
  const label=targets.map(item=>item.id).join(' + ');
  if(!skipConfirm&&!AeroServices.confirm(`Cancel turnaround ${label}? Future rotations in the recurring schedule stay active.`)) return false;
  for(const target of targets) applyFlightCancellation(target,reason);
  return finishFlightCancellations(targets,`Turnaround ${label} cancelled. Recurring schedule remains active.`);
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

function earliestMaintenancePlan(ac){
  const model=MODELS[ac.model];
  let start=simNow()+2*HOUR,airport=ac.location,guard=0;
  while(guard<100){
    const plan=Management.maintenancePlan(ac,start,airport,model.seats);
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

function scheduleAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  if(!ac) return;
  const maintenance=Management.maintenanceStatus(ac,simNow());
  if(maintenance.scheduled) return toast(`${ac.tail} already has a scheduled check.`);
  const plan=earliestMaintenancePlan(ac);
  if(!plan) return toast(`No maintenance window found for ${ac.tail} in the current programme.`);
  if(!AeroServices.confirm(`Schedule ${ac.tail} for an outsourced check at ${plan.airport}?\n\nStart: ${formatTime(plan.start)}\nDuration: ${formatDuration(plan.end-plan.start)}`)) return;
  Management.ensureState(state,simNow());
  ac.maintenance.scheduled=plan;
  AeroServices.commit();
  toast(`${ac.tail} maintenance booked at ${plan.airport}.`);
}

function cancelAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  const job=ac&&Management.maintenanceStatus(ac,simNow()).scheduled;
  if(!job||job.status==='active') return toast('Active maintenance cannot be cancelled.');
  ac.maintenance.scheduled=null;
  AeroServices.commit(); toast(`${ac.tail} maintenance booking removed.`);
}

function resolveRemovedScheduleArtifacts(flightIds,label,t=simNow()){
  const removedFlightIds=new Set(flightIds);
  for(const incident of state.incidents){
    if(!removedFlightIds.has(incident.flightId)||incident.status!=='open') continue;
    resolveIncidentImpacts(incident,t,'handled');
    incident.status='resolved'; incident.blocking=false; incident.resolvedAt=t;
    incident.selectedAction='schedule_removed'; incident.outcome=`${label} was removed from the programme.`;
    for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
  }
  for(const transfer of state.personnelTransfers||[]){
    if(removedFlightIds.has(transfer.flightId)&&!['completed','cancelled'].includes(transfer.status)){
      transfer.status='cancelled';
      transfer.cancelledAt=t;
    }
  }
}

function removeServiceSchedule(serviceId){
  const svc=state.services.find(s=>s.id===serviceId);
  if(!svc) return false;
  svc.active=false;
  const t=simNow();
  const removedFlightIds=state.flights
    .filter(f=>f.serviceId===serviceId&&flightActualDeparture(f)>t)
    .map(f=>f.id);
  resolveRemovedScheduleArtifacts(removedFlightIds,serviceId,t);
  state.flights=state.flights.filter(f => !(f.serviceId===serviceId && flightActualDeparture(f)>t));
  if(selectedFlightId && !state.flights.some(f=>f.id===selectedFlightId)) selectedFlightId=null;
  logEvent(`${serviceId} recurring schedule removed.`);
  AeroServices.commit(); requestUiRefresh('selects');
  toast(`${serviceId} removed. Unflown flights were removed.`);
  return true;
}
function cancelService(serviceId){
  return removeServiceSchedule(serviceId);
}
function confirmCancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId && s.active);
  if(!svc) return;
  const confirmed=AeroServices.confirm(
    `Remove ${svc.id} (${svc.from} ↔ ${svc.to})?\n\n`+
    'The recurring schedule will stop and all flights that have not departed will be cancelled. An airborne flight will finish.'
  );
  if(confirmed) cancelService(serviceId);
}

function removeStandaloneSchedule(flightId){
  const flight=state.flights.find(f=>f.id===flightId&&!f.cancelled);
  if(!flight||flight.serviceId) return toast('Choose a standalone future flight to remove.');
  if(flight.departureLogged||flightActualDeparture(flight)<=simNow()) return toast('Only unflown future flights can be removed from the schedule.');
  const t=simNow();
  resolveRemovedScheduleArtifacts([flight.id],flight.id,t);
  state.flights=state.flights.filter(f=>f.id!==flight.id);
  if(selectedFlightId===flight.id) selectedFlightId=null;
  logEvent(`${flight.id} removed from the schedule.`);
  recalculateOperations();
  AeroServices.commit(); requestUiRefresh('selects');
  toast(`${flight.id} removed from the schedule.`);
  return true;
}

function removeScheduleSelection(selection){
  const [kind,id]=String(selection||'').split(':');
  if(kind==='service'){
    const svc=state.services.find(s=>s.id===id&&s.active);
    if(!svc) return toast('Choose an active recurring schedule.');
    const future=state.flights.filter(f=>f.serviceId===id&&flightActualDeparture(f)>simNow());
    if(!AeroServices.confirm(`Remove ${svc.id} (${svc.from} ↔ ${svc.to})?\n\n${future.length} unflown flight${future.length===1?'':'s'} will be removed. Flights already departed stay in history.`)) return false;
    return removeServiceSchedule(id);
  }
  if(kind==='flight'){
    const flight=state.flights.find(f=>f.id===id&&!f.cancelled&&!f.serviceId);
    if(!flight) return toast('Choose a standalone future flight.');
    if(!AeroServices.confirm(`Remove ${flight.id} (${flight.from} → ${flightOperationalDestination(flight)}) from the schedule?`)) return false;
    return removeStandaloneSchedule(id);
  }
  return toast('Choose a schedule to remove.');
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
  if(selectedAircraftId===ac.id){ selectedAircraftId=null; selectedFlightId=null; }
  AeroServices.commit(); toast(`${ac.tail} released from the operations pool.`);
}

function settleSelected(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac) return;

  selectedFlightId=null;
  selectedAircraftId=acId;
  AeroServices.openContextWorkbench({scroll:'widget'});
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}


function settleSelectedFlight(flightId){
  const f=state.flights.find(x=>x.id===flightId);
  if(!f) return;

  selectedFlightId=f.id;
  selectedAircraftId=f.aircraftId;
  alignScheduleWindowToFlight(f);

  AeroServices.openContextWorkbench({scroll:'top'});
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function clearSelectedFlight(){
  selectedFlightId=null;
  selectedAircraftId=null;
  routeSignature='';
  requestUiRefresh('left','desk','context','schedule','map','weather','management');
}

function clearSelectedAircraft(){
  clearSelectedFlight();
}

function toggleAircraftCard(acId){
  if(selectedAircraftId===acId&&selectedFlightId){
    settleSelected(acId);
    return;
  }
  if(selectedAircraftId===acId){
    selectedAircraftId=null;
    selectedFlightId=null;
    routeSignature='';
    requestUiRefresh('left','desk','context','schedule','map','weather','management');
    return;
  }
  settleSelected(acId);
}
