/* Station-operations exceptions, provider capacity, and timed service delivery. */
const STATION_SERVICES={
  arrival:{label:'Diversion arrival handling',tab:'diversion',phase:'arrival'},
  departure:{label:'Departure handling',tab:'recovery',phase:'departure',manual:false},
  capacity:{label:'Additional handling teams',tab:'recovery',phase:'station'},
  replacement:{label:'Replacement handler',tab:'recovery'},
  priority:{label:'Turnaround priority request',tab:'recovery',phase:'departure'}
};
const STATION_PROVIDERS={station:'Own station team',contract:'Contract handler',backup:'Alternative contract handler'};
const STATION_RESERVED_STATES=new Set(['requested','offered','confirmed','ready','in_progress']);
const STATION_CONFIRMED_STATES=new Set(['confirmed','ready','in_progress','completed']);

function stationServiceRequests(){ return state.stationServiceRequests||[]; }
function stationServiceRequest(id){ return stationServiceRequests().find(item=>item.id===id)||null; }
function stationServiceReserved(record){ return STATION_RESERVED_STATES.has(record?.status); }
function stationServiceConfirmed(record){ return STATION_CONFIRMED_STATES.has(record?.status); }
function stationServiceFlight(record){ return state.flights.find(flight=>flight.id===record.flightId)||null; }
function stationServicePhase(options){ return STATION_SERVICES[options.service]?.phase||options.handling||'arrival'; }
function stationHandlingUnits(flight){ return flight?.flightType==='ferry'?2:4; }

function stationProviderProfile(airport,provider,t=simNow()){
  const market=AIRPORT_MARKETS[airport],costs=AIRPORT_COSTS[airport];
  if(!market||!costs||!STATION_PROVIDERS[provider]) return {available:false,capacity:0,score:0,label:'Provider unavailable'};
  const weather=Management.weatherAt(airport,t);
  const weatherFactor=clamp(Number(weather.capacityFactor)||1,.2,1);
  const score=Math.round((market.size*.45+market.hub*.35+market.business*.12+market.tourism*.08)*100);
  const total=provider==='station'?availableStationStaffAt(airport,'groundHandling'):
    score>=(provider==='backup'?70:58)&&costs.handlingBase>0?Math.max(4,Math.round(market.size*12+market.hub*8))*(provider==='backup'?.65:1):0;
  const capacity=Math.max(0,Math.floor(total*weatherFactor));
  return {available:capacity>0,capacity,score:provider==='station'?Math.min(100,70+total*2):score,
    label:STATION_PROVIDERS[provider],weather,weatherFactor};
}

function diversionHandlingAvailability(airport,t=simNow()){
  const provider=['station','contract','backup'].find(id=>stationProviderProfile(airport,id,t).capacity>=4);
  const profile=stationProviderProfile(airport,provider,t);
  return {...profile,source:provider||'none',staff:provider==='station'?profile.capacity:0,
    label:provider?`${profile.label} available for coordination`:'No modeled arrival handler'};
}

function stationServiceDuration(flight,service){
  if(service==='priority') return 10;
  const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
  const seats=aircraft?cabinSeatCount(aircraft):100;
  return Math.round((service==='arrival'?10:18)+Math.min(25,seats/14));
}

function stationServiceCost({airport,provider,service,units,durationMin,flight}){
  if(provider==='station'&&service!=='priority') return 0;
  const costs=AIRPORT_COSTS[airport]||{};
  const multiplier=provider==='backup'?1.4:1;
  const pax=flight?.flightType==='ferry'?0:Number(flight?.pax)||0;
  const base=service==='capacity'?units*durationMin/60*150:
    service==='priority'?350+units*95:(Number(costs.handlingBase)||1800)+pax*(Number(costs.handlingPerPax)||8);
  return Math.round(base*multiplier/100)*100;
}

function stationRequestMatchesFlight(record,flight,phase){
  return record.flightId===flight.id&&record.phase===phase&&record.service!=='priority'&&
    record.airport===(phase==='arrival'?flightOperationalDestination(flight):flight.from);
}
function stationFlightHandlingRequest(flight,phase='arrival'){
  if(!flight) return null;
  let latest=null;
  for(const record of stationServiceRequests()){
    if(record.status==='cancelled'||!stationRequestMatchesFlight(record,flight,phase)) continue;
    const confirmed=stationServiceConfirmed(record),previousConfirmed=stationServiceConfirmed(latest);
    if(!latest||(confirmed&&!previousConfirmed)||(confirmed===previousConfirmed&&record.requestedAt>=latest.requestedAt)) latest=record;
  }
  return latest;
}

function stationServiceBlocker(options,t=simNow(),{existing=false}={}){
  const {airport,provider,service,flightId}=options;
  const flight=state.flights.find(item=>item.id===flightId),phase=stationServicePhase(options);
  if(!AIRPORTS[airport]||!STATION_PROVIDERS[provider]||!STATION_SERVICES[service]) return 'Choose a station, service, and provider.';
  if(!['arrival','departure','station'].includes(phase)) return 'Choose arrival or departure handling.';
  if(phase==='station'){
    if(provider==='station') return 'Additional capacity must come from an external provider.';
    if(![2,4,6,8].includes(Number(options.units))||![60,120,240].includes(Number(options.durationMin))) return 'Choose the team count and coverage duration.';
    if(!Number.isFinite(options.startAt)) return 'Choose a coverage start time.';
    return '';
  }
  if(!flight||flight.cancelled) return 'Choose an operating flight.';
  const expectedAirport=phase==='arrival'?flightOperationalDestination(flight):flight.from;
  if(airport!==expectedAirport) return `This service requires ${expectedAirport}, not ${airport}.`;
  if(phase==='departure'&&flightHasDeparted(flight,t)) return 'Departure services are only available before the aircraft leaves the stand.';
  if(phase==='arrival'&&flightHasCompleted(flight,t)&&t>flightActualArrival(flight)+2*HOUR&&!existing) return 'The arrival-service window has passed.';
  if(service==='priority'&&!(flight.handlingDelayMin>0)&&!existing) return 'No handling delay is available to recover. Crew, fuel, weather, and minimum-turn limits cannot be expedited here.';
  if(service==='replacement'&&!existing){
    const prior=stationFlightHandlingRequest(flight,phase);
    if(!prior) return 'No arrival/departure handler has been requested yet. Start in Handling.';
    if(prior.provider===provider) return 'Choose a different provider for the replacement.';
    if(['in_progress','completed'].includes(prior.status)) return 'The existing handling service has already started or finished.';
  }
  return '';
}

function stationServiceWindow(record,flight=stationServiceFlight(record)){
  if(record.startedAt) return {start:record.startedAt,end:record.endsAt};
  if(record.phase!=='station'&&!flight) return {start:record.startAt,end:record.endsAt};
  const target=record.service==='priority'?record.readyAt:record.phase==='station'?record.startAt:record.phase==='arrival'?flightActualArrival(flight):flightActualDeparture(flight)-record.durationMin*MIN;
  const start=Math.max(record.readyAt,target);
  return {start,end:start+record.durationMin*MIN};
}

function stationProviderReservations(airport,provider,{excludeId='',replaceId='',flightId='',phase='',service='',t=simNow()}={}){
  const bookings=stationServiceRequests().filter(record=>record.airport===airport&&record.provider===provider&&stationServiceReserved(record)&&record.id!==excludeId&&record.id!==replaceId)
    .map(record=>({...stationServiceWindow(record),units:record.units}));
  if(provider!=='station') return bookings;
  // Normal rostered handling also occupies own teams, even without a manual request.
  for(const flight of state.flights){
    if(flight.cancelled) continue;
    for(const handling of ['arrival','departure']){
      if((handling==='arrival'?flightOperationalDestination(flight):flight.from)!==airport) continue;
      if(handling==='arrival'?flightHasCompleted(flight,t):flightHasDeparted(flight,t)) continue;
      if(flight.id===flightId&&handling===phase&&service!=='priority') continue;
      const explicit=stationFlightHandlingRequest(flight,handling);
      if(stationServiceReserved(explicit)||stationServiceConfirmed(explicit)) continue;
      const duration=stationServiceDuration(flight,handling)*MIN;
      const start=handling==='arrival'?flightActualArrival(flight):flightActualDeparture(flight)-duration;
      bookings.push({start,end:start+duration,units:stationHandlingUnits(flight)});
    }
  }
  return bookings;
}

function stationProviderSlot(airport,provider,start,durationMin,units,options={}){
  const {t=simNow()}=options;
  const profile=stationProviderProfile(airport,provider,t);
  if(units>profile.capacity) return {available:false,reason:`${profile.label}: ${profile.capacity} teams available; ${units} required.`,profile};
  const bookings=stationProviderReservations(airport,provider,options);
  const candidates=[start,...bookings.map(item=>item.end).filter(at=>at>=start&&at<=start+2*HOUR)].sort((a,b)=>a-b);
  for(const at of candidates){
    const end=at+durationMin*MIN;
    const overlaps=bookings.filter(item=>item.start<end&&item.end>at);
    const points=[at,...overlaps.map(item=>Math.max(at,item.start))];
    if(points.every(point=>overlaps.filter(item=>item.start<=point&&item.end>point).reduce((sum,item)=>sum+item.units,units)<=profile.capacity)) return {available:true,start:at,end,profile};
  }
  return {available:false,reason:'No provider capacity is available within the next two hours of the requested service window.',profile};
}

function stationServicePreview(options,{record=null,t=simNow()}={}){
  const flight=state.flights.find(item=>item.id===options.flightId)||null;
  let blocker=stationServiceBlocker(options,t,{existing:Boolean(record)});
  const phase=stationServicePhase(options);
  const units=phase==='station'?Number(options.units):stationHandlingUnits(flight);
  const durationMin=phase==='station'?Number(options.durationMin):stationServiceDuration(flight,options.service==='replacement'?phase:options.service);
  const duplicate=stationServiceRequests().find(item=>item.id!==record?.id&&item.airport===options.airport&&
    item.flightId===(options.flightId||'')&&item.phase===phase&&stationServiceReserved(item)&&
    (phase!=='station'||Math.abs(item.startAt-options.startAt)<options.durationMin*MIN)&&
    (options.service==='replacement'?item.service==='replacement':item.service===options.service));
  if(duplicate) blocker=`Request ${duplicate.id} is already in progress. Open its receipt instead.`;
  const prior=options.service==='replacement'&&flight?stationFlightHandlingRequest(flight,phase):null;
  const seed=`${record?.id||`SS${state.nextStationServiceRequest}`}:${options.airport}:${options.provider}:${options.service}`;
  const responseMin=3+Math.floor(stableFraction(`${seed}:response`)*4);
  const respondsAt=record?.respondsAt||t+responseMin*MIN;
  const profile=stationProviderProfile(options.airport,options.provider,t);
  const mobilizationMin=options.provider==='station'?5:Math.round(10+(100-profile.score)*.3)+(options.provider==='backup'?10:0);
  const earliestReady=record?.earliestReady||respondsAt+mobilizationMin*MIN;
  const targetAt=options.service==='priority'?earliestReady:phase==='station'?(Number.isFinite(options.startAt)?options.startAt:t):flight?phase==='arrival'?flightActualArrival(flight):flightActualDeparture(flight)-durationMin*MIN:t;
  const slot=blocker?null:stationProviderSlot(options.airport,options.provider,Math.max(earliestReady,targetAt),durationMin,units,{excludeId:record?.id,replaceId:record?.replacesId||prior?.id,flightId:flight?.id,phase,service:options.service,t});
  if(slot&&!slot.available) blocker=slot.reason;
  const readyAt=slot?.available&&slot.start>Math.max(earliestReady,targetAt)?slot.start:earliestReady;
  const startAt=slot?.start||Math.max(earliestReady,targetAt||t),endsAt=startAt+durationMin*MIN;
  const impactMin=flight?Math.max(0,Math.ceil(((phase==='arrival'?readyAt:endsAt)-(phase==='arrival'?flightActualArrival(flight):flightActualDeparture(flight)))/MIN)):Math.max(0,Math.ceil((startAt-options.startAt)/MIN));
  const cost=stationServiceCost({...options,flight,units,durationMin});
  return {...options,phase,flight,units,durationMin,respondsAt,responseMin,earliestReady,readyAt,startAt,endsAt,impactMin,cost,profile,blocker,replacesId:prior?.id||''};
}

function requestStationService(options,{commit=true,t=simNow(),automatic=false}={}){
  const preview=stationServicePreview(options,{t});
  if(preview.blocker){ if(!automatic) toast(preview.blocker); return null; }
  const record={id:`SS${state.nextStationServiceRequest++}`,airport:options.airport,flightId:options.flightId||'',service:options.service,
    phase:preview.phase,handling:options.handling||preview.phase,provider:options.provider,units:preview.units,durationMin:preview.durationMin,
    status:'requested',requestedAt:t,updatedAt:t,respondsAt:preview.respondsAt,earliestReady:preview.earliestReady,readyAt:preview.readyAt,
    startAt:preview.startAt,endsAt:preview.endsAt,quotedReadyAt:preview.readyAt,quotedCost:preview.cost,cost:preview.cost,costEventId:'',
    replacesId:preview.replacesId,startedAt:0,completedAt:0,outcome:'',automatic};
  state.stationServiceRequests.push(record);
  if(commit) commitStationServiceChange(t);
  return record;
}

function confirmStationService(record,t){
  record.status='confirmed';record.confirmedAt=t;record.updatedAt=t;
  record.outcome='Provider confirmed. Mobilization and service delivery are still pending.';
  const prior=stationServiceRequest(record.replacesId);
  if(prior&&stationServiceReserved(prior)) finishStationService(prior,'cancelled',`Replaced by ${record.id}.`,t);
  if(record.cost&&!record.costEventId){
    const event=recordRecoveryCostEvent({flight:stationServiceFlight(record),category:'station',kind:'station_service',amount:record.cost,
      airport:record.airport,description:`${record.id}: ${STATION_SERVICES[record.service].label} - ${STATION_PROVIDERS[record.provider]}`});
    record.costEventId=event?.id||'';
  }
}
function finishStationService(record,status,outcome,t){ record.status=status;record.outcome=outcome;record.updatedAt=t; }

function acceptStationServiceOffer(id){
  const record=stationServiceRequest(id),t=simNow();
  if(record?.status!=='offered') return false;
  if(t>=record.offerExpiresAt){finishStationService(record,'expired','The provider offer expired.',t);commitStationServiceChange(t);return false;}
  const preview=stationServicePreview(record,{record,t});
  if(preview.blocker){finishStationService(record,'unavailable',preview.blocker,t);commitStationServiceChange(t);return false;}
  const revised=preview.readyAt>record.readyAt+MIN||preview.startAt>record.startAt+MIN||preview.cost>record.cost;
  record.readyAt=preview.readyAt;record.startAt=preview.startAt;record.endsAt=preview.endsAt;record.cost=preview.cost;
  if(revised){record.offerExpiresAt=t+15*MIN;record.updatedAt=t;record.outcome='Provider availability or price changed; review the revised offer.';commitStationServiceChange(t);return false;}
  confirmStationService(record,t);commitStationServiceChange(t);return true;
}
function cancelStationService(id){
  const record=stationServiceRequest(id);
  if(!record||!['requested','offered','confirmed','ready'].includes(record.status)) return false;
  finishStationService(record,'cancelled',record.costEventId?'Service cancelled; confirmed booking cost remains.':'Request cancelled; no booking cost charged.',simNow());
  commitStationServiceChange();return true;
}

function ensureDiversionHandlingRequest(flight,t=simNow()){
  if(!flight?.diversionAirport||flight.cancelled) return null;
  const existing=stationFlightHandlingRequest(flight,'arrival');
  if(existing) return existing;
  for(const provider of Object.keys(STATION_PROVIDERS)){
    const record=requestStationService({airport:flightOperationalDestination(flight),flightId:flight.id,service:'arrival',provider},{commit:false,automatic:true,t});
    if(record) return record;
  }
  return null;
}

function stationDepartureReadyAt(flight){
  let readyAt=0;
  for(const item of stationServiceRequests()){
    if(item.flightId===flight.id&&item.airport===flight.from&&item.phase==='departure'&&stationServiceConfirmed(item)) readyAt=Math.max(readyAt,item.completedAt||item.endsAt);
  }
  return readyAt;
}
function stationArrivalReadyAt(flight){
  const record=stationFlightHandlingRequest(flight,'arrival');
  return stationServiceConfirmed(record)?record.readyAt:0;
}
function stationPostflightReadyAt(flight){
  const record=stationFlightHandlingRequest(flight,'arrival');
  return stationServiceConfirmed(record)?record.completedAt||Math.max(record.readyAt,flightActualArrival(flight))+record.durationMin*MIN:0;
}
function stationDepartureBlocked(flight){
  return stationServiceRequests().some(item=>item.flightId===flight.id&&item.phase==='departure'&&item.airport===flight.from&&stationServiceReserved(item)&&item.service!=='priority');
}
function stationHandlingCoverage(flight,phase='departure'){
  const record=stationFlightHandlingRequest(flight,phase);
  return stationServiceConfirmed(record)&&(record.provider!=='station'||record.status==='completed')?record.units:0;
}
function stationAdditionalTeams(airport,t=simNow()){
  let teams=0;
  for(const item of stationServiceRequests()){
    if(item.airport===airport&&item.service==='capacity'&&item.status==='in_progress'&&item.startedAt<=t&&t<item.endsAt) teams+=item.units;
  }
  return teams;
}

function processStationServices(t=simNow()){
  let changed=false;
  for(const record of stationServiceRequests()){
    if(!stationServiceReserved(record)) continue;
    const before=JSON.stringify(record),flight=stationServiceFlight(record);
    const blocker=stationServiceBlocker(record,t,{existing:true});
    if(blocker){finishStationService(record,'cancelled',blocker,t);changed=true;continue;}
    if(record.status==='offered'&&t>=record.offerExpiresAt){finishStationService(record,'expired','The provider offer expired without acceptance.',t);changed=true;continue;}
    if(record.status==='requested'&&t>=record.respondsAt){
      const preview=stationServicePreview(record,{record,t});
      if(preview.blocker) finishStationService(record,'unavailable',preview.blocker,t);
      else{
        record.readyAt=preview.readyAt;record.startAt=preview.startAt;record.endsAt=preview.endsAt;record.cost=preview.cost;
        if(record.readyAt>record.quotedReadyAt+5*MIN||record.cost>record.quotedCost){
          record.offerExpiresAt=t+15*MIN;finishStationService(record,'offered','Provider offered a later service opportunity. Acceptance is required before booking.',t);
        }else confirmStationService(record,t);
      }
    }
    if(['confirmed','ready'].includes(record.status)){
      const window=stationServiceWindow(record,flight);
      const slot=stationProviderSlot(record.airport,record.provider,window.start,record.durationMin,record.units,{excludeId:record.id,flightId:record.flightId,phase:record.phase,service:record.service,t});
      if(!slot.available){finishStationService(record,'unavailable',`Provider can no longer deliver: ${slot.reason}`,t);changed=true;continue;}
      if(slot.start>window.start){record.readyAt=slot.start;record.updatedAt=t;record.outcome='Provider re-sequenced the service after the aircraft or station situation changed.';}
      record.startAt=slot.start;record.endsAt=slot.end;
      if(t>=record.readyAt&&record.status==='confirmed'){record.status='ready';record.updatedAt=t;record.outcome='Provider ready; waiting for the service window and aircraft.';}
      const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
      const onStand=record.phase==='arrival'?flightHasCompleted(flight,t):record.phase==='departure'?aircraft?.location===record.airport&&!aircraftActiveFlight(aircraft.id,t):true;
      if(t>=record.startAt&&onStand){
        const onStandSince=aircraft?Math.max(0,...state.flights.filter(item=>item.aircraftId===aircraft.id&&flightHasCompleted(item,t)&&flightOperationalDestination(item)===record.airport).map(flightActualArrival)):0;
        record.startedAt=Math.max(record.startAt,record.phase==='arrival'?flightActualArrival(flight):onStandSince);
        record.endsAt=record.startedAt+record.durationMin*MIN;record.status='in_progress';record.updatedAt=t;record.outcome='Station service is in progress.';
      }
    }
    if(record.status==='in_progress'&&t>=record.endsAt){
      record.completedAt=record.endsAt;
      if(record.service==='priority'&&flight&&!flightHasDeparted(flight,t)){
        const weather=Management.weatherAt(record.airport,t);
        const recovered=Math.min(flight.handlingDelayMin||0,Math.max(0,Math.round(record.units*3*(weather.capacityFactor||1))));
        flight.handlingDelayMin=Math.max(0,(flight.handlingDelayMin||0)-recovered);
        record.recoveredMin=recovered;
        finishStationService(record,'completed',`Station coordinated ${recovered} min of handling recovery. Other operating limits remain in force.`,t);
      }else finishStationService(record,'completed',record.service==='capacity'?'Additional capacity coverage ended.':'Handling service completed.',t);
    }
    if(before!==JSON.stringify(record)) changed=true;
  }
  return changed;
}

function commitStationServiceChange(t=simNow()){
  recalculateOperations();updateStaffingConstraints(t);processProblems(t);invalidateOperationalIndex();AeroServices.commit();
}
