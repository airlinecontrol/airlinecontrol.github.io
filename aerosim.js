const VERSION = 6;
const SAVE_KEY = 'aerosim_mvp_v6';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const AIRPORTS = {
  FRA:{iata:'FRA',name:'Frankfurt',lat:50.0379,lon:8.5622},
  LHR:{iata:'LHR',name:'London Heathrow',lat:51.4700,lon:-0.4543},
  JFK:{iata:'JFK',name:'New York JFK',lat:40.6413,lon:-73.7781},
  MAD:{iata:'MAD',name:'Madrid',lat:40.4983,lon:-3.5676},
  AMS:{iata:'AMS',name:'Amsterdam',lat:52.3105,lon:4.7683},
  CDG:{iata:'CDG',name:'Paris CDG',lat:49.0097,lon:2.5479},
  FCO:{iata:'FCO',name:'Rome Fiumicino',lat:41.8003,lon:12.2389},
  DXB:{iata:'DXB',name:'Dubai',lat:25.2532,lon:55.3657},
  SIN:{iata:'SIN',name:'Singapore',lat:1.3644,lon:103.9915},
  HND:{iata:'HND',name:'Tokyo Haneda',lat:35.5494,lon:139.7798}
};

const AIRPORT_OPS = {
  FRA:{slotIntervalMin:15,graceMin:10}, LHR:{slotIntervalMin:10,graceMin:8},
  JFK:{slotIntervalMin:15,graceMin:10}, MAD:{slotIntervalMin:15,graceMin:10},
  AMS:{slotIntervalMin:10,graceMin:8}, CDG:{slotIntervalMin:10,graceMin:8},
  FCO:{slotIntervalMin:15,graceMin:10}, DXB:{slotIntervalMin:15,graceMin:10},
  SIN:{slotIntervalMin:10,graceMin:8}, HND:{slotIntervalMin:10,graceMin:8}
};
const MIN_TURN_MIN = 35;

// Game abstraction: prices represent recurring seasonal slot-series rights.
const SLOT_MARKET = {
  FRA:{basePrice:4_500_000,scarcity:1.25},
  LHR:{basePrice:12_000_000,scarcity:1.85},
  JFK:{basePrice:6_500_000,scarcity:1.35},
  MAD:{basePrice:2_500_000,scarcity:1.00},
  AMS:{basePrice:7_000_000,scarcity:1.55},
  CDG:{basePrice:6_000_000,scarcity:1.40},
  FCO:{basePrice:2_800_000,scarcity:1.00},
  DXB:{basePrice:5_500_000,scarcity:1.25},
  SIN:{basePrice:5_000_000,scarcity:1.20},
  HND:{basePrice:9_000_000,scarcity:1.65}
};

const MODELS = {
  'A320neo': {seats:186, speedKmh:835, maxRangeKm:6300, price:48_000_000, costPerKm:8.2},
  'A330-900':{seats:287, speedKmh:870, maxRangeKm:13300, price:110_000_000, costPerKm:15.4}
};

const money = n => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const num = n => new Intl.NumberFormat('en-IE').format(Math.round(n));
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const rad = d=>d*Math.PI/180, deg=r=>r*180/Math.PI;

function distanceKm(a,b){
  const R=6371, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function bearing(a,b){
  const y=Math.sin(rad(b.lon-a.lon))*Math.cos(rad(b.lat));
  const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lon-a.lon));
  return (deg(Math.atan2(y,x))+360)%360;
}
function interpolateGreatCircle(a,b,t){
  t=clamp(t,0,1);
  const φ1=rad(a.lat), λ1=rad(a.lon), φ2=rad(b.lat), λ2=rad(b.lon);
  const d=2*Math.asin(Math.sqrt(Math.sin((φ2-φ1)/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2));
  if(d<1e-9) return {lat:a.lat,lon:a.lon};
  const A=Math.sin((1-t)*d)/Math.sin(d), B=Math.sin(t*d)/Math.sin(d);
  const x=A*Math.cos(φ1)*Math.cos(λ1)+B*Math.cos(φ2)*Math.cos(λ2);
  const y=A*Math.cos(φ1)*Math.sin(λ1)+B*Math.cos(φ2)*Math.sin(λ2);
  const z=A*Math.sin(φ1)+B*Math.sin(φ2);
  return {lat:deg(Math.atan2(z,Math.sqrt(x*x+y*y))),lon:deg(Math.atan2(y,x))};
}
function routeCoords(a,b,steps=64){
  const out=[]; for(let i=0;i<=steps;i++){const p=interpolateGreatCircle(a,b,i/steps);out.push([p.lon,p.lat]);} return out;
}
function flightDurationMs(origin,dest,model){
  const km=distanceKm(origin,dest);
  return (0.65 + km/model.speedKmh) * HOUR; // taxi/climb/descent + cruise
}
function formatDuration(ms){
  const m=Math.max(0,Math.round(ms/MIN)); const h=Math.floor(m/60), mm=m%60;
  return h ? `${h}h ${String(mm).padStart(2,'0')}m` : `${m}m`;
}
function formatTime(ms){
  return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'short'}).format(new Date(ms));
}
function hhmm(ms){
  const d=new Date(ms);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function nextTimestampForClock(value, fromTs=simNow()){
  const m=/^(\d{2}):(\d{2})$/.exec(value||'');
  if(!m) return null;
  const h=Number(m[1]), min=Number(m[2]);
  if(h>23 || min>59) return null;
  const d=new Date(fromTs);
  d.setHours(h,min,0,0);
  if(d.getTime() <= fromTs + 30_000) d.setDate(d.getDate()+1);
  return d.getTime();
}
function minuteOfDay(ts){
  const d=new Date(ts);
  return d.getHours()*60+d.getMinutes();
}
function hhmmFromMinute(minute){
  minute=((Math.round(minute)%1440)+1440)%1440;
  return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}
function alignTimestampToAirportSlot(ts,airportCode){
  const interval=AIRPORT_OPS[airportCode]?.slotIntervalMin||15;
  const d=new Date(ts);
  const total=d.getHours()*60+d.getMinutes();
  const aligned=Math.ceil(total/interval)*interval;
  if(aligned>=1440){
    d.setDate(d.getDate()+1); d.setHours(0,0,0,0);
  }else{
    d.setHours(Math.floor(aligned/60),aligned%60,0,0);
  }
  return d.getTime();
}
function timestampAtMinuteAfter(readyTs,minute){
  const d=new Date(readyTs);
  d.setHours(Math.floor(minute/60),minute%60,0,0);
  if(d.getTime()<readyTs) d.setDate(d.getDate()+1);
  return d.getTime();
}
function slotSeriesPrice(airportCode,ts){
  const market=SLOT_MARKET[airportCode]||{basePrice:2_000_000,scarcity:1};
  const hour=new Date(ts).getHours();
  const peak=(hour>=7&&hour<10)||(hour>=16&&hour<20)?1.55:(hour>=6&&hour<22?1.15:.82);
  return Math.round(market.basePrice*market.scarcity*peak/100_000)*100_000;
}
function slotRightAt(airportCode,ts){
  const minute=minuteOfDay(ts);
  return state.slotRights.find(r=>r.airport===airportCode&&r.minuteOfDay===minute)||null;
}
function slotRightById(id){
  return state.slotRights.find(r=>r.id===id)||null;
}
function slotAssignedService(rightId){
  return state.services.find(s=>s.active&&(s.originSlotRightId===rightId||s.destinationSlotRightId===rightId))||null;
}
function acquireSlotRight(airportCode,ts,{silent=false,source='market'}={}){
  const aligned=alignTimestampToAirportSlot(ts,airportCode);
  const existing=slotRightAt(airportCode,aligned);
  if(existing) return existing;
  const price=source==='grandfathered'?0:slotSeriesPrice(airportCode,aligned);
  if(state.cash<price){
    if(!silent) toast(`Not enough cash for ${airportCode} ${hhmm(aligned)} slot series (${money(price)}).`);
    return null;
  }
  state.cash-=price;
  const right={
    id:'SL'+state.nextSlotRight++,
    airport:airportCode,
    minuteOfDay:minuteOfDay(aligned),
    price,source,acquiredAt:simNow()
  };
  state.slotRights.push(right);
  save();
  return right;
}
function requiredSlotPlan(from,to,ac,fare,departure,turnaroundMin){
  const out=estimateFlight(from,to,ac,fare);
  const outboundDeparture=alignTimestampToAirportSlot(departure,from);
  const earliestReturn=outboundDeparture+out.duration+turnaroundMin*MIN;
  const returnDeparture=alignTimestampToAirportSlot(earliestReturn,to);
  return {
    outboundDeparture,
    returnDeparture,
    originRight:slotRightAt(from,outboundDeparture),
    destinationRight:slotRightAt(to,returnDeparture)
  };
}
function randomTail(i){return 'D-AS'+String(i).padStart(2,'0');}

function newState(){
  const real=Date.now();
  const sim=real;
  const s={
    version:VERSION,
    clock:{realBase:real,simBase:sim,speed:1},
    cash:165_000_000,
    home:'FRA',
    nextAircraft:4,
    nextFlight:401,
    nextService:1,
    nextSlotRight:1,
    slotRights:[],
    aircraft:[
      {id:'AC1',tail:'D-AS01',model:'A320neo',location:'FRA',defectUntil:0,defectReason:''},
      {id:'AC2',tail:'D-AS02',model:'A320neo',location:'MAD',defectUntil:0,defectReason:''},
      {id:'AC3',tail:'D-AS03',model:'A330-900',location:'FRA',defectUntil:0,defectReason:''}
    ],
    flights:[],
    services:[],
    ops:{automaticDisruptions:true},
    stats:{revenue:0,costs:0,pax:0,completed:0},
  };
  const addSeed=(id,ac,from,to,dep,arr,fare,load)=>{
    const d=distanceKm(AIRPORTS[from],AIRPORTS[to]);
    const m=MODELS[s.aircraft.find(x=>x.id===ac).model];
    const pax=Math.round(m.seats*load);
    const revenue=Math.round(pax*fare);
    const costs=Math.round(d*m.costPerKm+8500);
    s.flights.push({
      id,aircraftId:ac,from,to,departure:dep,arrival:arr,fare,load,pax,revenue,costs,settled:false,
      handlingDelayMin:0,technicalDelayMin:0,enrouteDelayMin:0,propagatedDelayMin:0,slotDelayMin:0,
      slotMissed:false,opsChecked:true,enrouteChecked:true,slotLogged:false
    });
  };
  addSeed('AS101','AC1','FRA','LHR',sim-28*MIN,sim+52*MIN,190,.84);
  addSeed('AS201','AC3','FRA','JFK',sim-74*MIN,sim+6.25*HOUR,510,.91);
return s;
}

function migrateState(parsed){
  if(!parsed || parsed.version!==VERSION) return newState();
  if(!Array.isArray(parsed.services)) parsed.services=[];
  if(!Array.isArray(parsed.flights)) parsed.flights=[];
  if(!Array.isArray(parsed.aircraft)) parsed.aircraft=[];
  if(!Array.isArray(parsed.slotRights)) parsed.slotRights=[];
  if(!Number.isFinite(parsed.nextSlotRight)) parsed.nextSlotRight=1;
  if(!parsed.ops) parsed.ops={automaticDisruptions:true};
  if(typeof parsed.ops.automaticDisruptions!=='boolean') parsed.ops.automaticDisruptions=true;
  for(const ac of parsed.aircraft){
    if(ac.defectUntil===undefined) ac.defectUntil=0;
    if(ac.defectReason===undefined) ac.defectReason='';
  }
  for(const f of parsed.flights){
    for(const k of ['handlingDelayMin','technicalDelayMin','enrouteDelayMin','propagatedDelayMin','slotDelayMin'])
      if(f[k]===undefined) f[k]=0;
    if(f.slotMissed===undefined) f.slotMissed=false;
    if(f.opsChecked===undefined) f.opsChecked=Boolean(f.departureLogged);
    if(f.enrouteChecked===undefined) f.enrouteChecked=Boolean(f.departureLogged);
    if(f.slotLogged===undefined) f.slotLogged=false;
  }

  // Existing recurring services get zero-cost grandfathered slot rights.
  for(const svc of parsed.services){
    if(!svc.active) continue;
    const out=parsed.flights.filter(f=>f.serviceId===svc.id&&f.serviceLeg==='outbound').sort((a,b)=>a.departure-b.departure)[0];
    const ret=parsed.flights.filter(f=>f.serviceId===svc.id&&f.serviceLeg==='return').sort((a,b)=>a.departure-b.departure)[0];

    if(out&&!svc.originSlotRightId){
      let right=parsed.slotRights.find(r=>r.airport===svc.from&&r.minuteOfDay===minuteOfDay(out.departure));
      if(!right){
        right={id:'SL'+parsed.nextSlotRight++,airport:svc.from,minuteOfDay:minuteOfDay(out.departure),price:0,source:'grandfathered',acquiredAt:Date.now()};
        parsed.slotRights.push(right);
      }
      svc.originSlotRightId=right.id;
    }
    if(ret&&!svc.destinationSlotRightId){
      let right=parsed.slotRights.find(r=>r.airport===svc.to&&r.minuteOfDay===minuteOfDay(ret.departure));
      if(!right){
        right={id:'SL'+parsed.nextSlotRight++,airport:svc.to,minuteOfDay:minuteOfDay(ret.departure),price:0,source:'grandfathered',acquiredAt:Date.now()};
        parsed.slotRights.push(right);
      }
      svc.destinationSlotRightId=right.id;
    }
  }
  return parsed;
}
function loadState(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return newState();
    return migrateState(JSON.parse(raw));
  }catch(e){ return newState(); }
}
let state=loadState();
let selectedAircraftId=null;
let selectedFlightId=null;
let toastTimer=null;

const SPLIT_KEY='aerosim_center_split_pct';
let scheduleWindowOffsetHours=-2;
let scheduleRangeHours=24;
let lastScheduleSignature='';
let lastScheduleRenderAt=0;
let aircraftSelectSignature='';
let servicesUiSignature='';
let slotPortfolioSignature='';

function simNow(){
  return state.clock.simBase + (Date.now()-state.clock.realBase)*state.clock.speed;
}
function rebaseClock(newSpeed){
  const now=simNow();
  state.clock={realBase:Date.now(),simBase:now,speed:newSpeed};
  save();
}
function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }

function flightActualDeparture(f){ return f.actualDeparture ?? f.departure; }
function flightActualArrival(f){ return f.actualArrival ?? f.arrival; }
function flightTotalDepartureDelayMin(f){ return Math.max(0,Math.round((flightActualDeparture(f)-f.departure)/MIN)); }
function aircraftIsDefective(ac,t=simNow()){ return Boolean(ac && ac.defectUntil && t<ac.defectUntil); }

function aircraftActiveFlight(acId,t=simNow()){
  return state.flights.find(f=>f.aircraftId===acId && flightActualDeparture(f)<=t && t<flightActualArrival(f));
}
function aircraftUpcomingFlight(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && flightActualDeparture(f)>t)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
}
function statusOfFlight(f,t=simNow()){
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  if(t<dep){
    if(flightTotalDepartureDelayMin(f)>0 && t>=f.departure-90*MIN) return 'delayed';
    return 'scheduled';
  }
  if(t<arr) return 'airborne';
  return 'arrived';
}
function flightProgress(f,t=simNow()){
  const dep=flightActualDeparture(f), arr=flightActualArrival(f);
  return clamp((t-dep)/(arr-dep),0,1);
}
function currentAircraftPosition(ac,t=simNow()){
  const f=aircraftActiveFlight(ac.id,t);
  if(!f){
    const ap=AIRPORTS[ac.location] || AIRPORTS[state.home];
    return {lat:ap.lat,lon:ap.lon,heading:0,status:'ground',flight:null};
  }
  const p=flightProgress(f,t), aa=AIRPORTS[f.from], bb=AIRPORTS[f.to];
  const pos=interpolateGreatCircle(aa,bb,p), pos2=interpolateGreatCircle(aa,bb,Math.min(1,p+.002));
  return {...pos,heading:bearing(pos,pos2),status:'airborne',flight:f};
}
function nextSlotTime(readyTs, airportCode){
  const cfg=AIRPORT_OPS[airportCode] || {slotIntervalMin:15,graceMin:10};
  const step=cfg.slotIntervalMin*MIN;
  return Math.ceil(readyTs/step)*step;
}
function recalculateOperations(){
  for(const f of state.flights){
    f.handlingDelayMin=Number(f.handlingDelayMin)||0;
    f.technicalDelayMin=Number(f.technicalDelayMin)||0;
    f.enrouteDelayMin=Number(f.enrouteDelayMin)||0;
    f.propagatedDelayMin=0; f.slotDelayMin=0; f.slotMissed=false;
    f.actualDeparture=f.departure; f.actualArrival=f.arrival;
  }
  for(const ac of state.aircraft){
    const flights=state.flights.filter(f=>f.aircraftId===ac.id && !f.cancelled).sort((x,y)=>x.departure-y.departure);
    let prev=null;
    for(const f of flights){
      const baseReady=f.departure+(f.handlingDelayMin+f.technicalDelayMin)*MIN;
      let ready=baseReady;
      if(prev){
        const inboundReady=flightActualArrival(prev)+MIN_TURN_MIN*MIN;
        if(inboundReady>ready){ f.propagatedDelayMin=Math.ceil((inboundReady-ready)/MIN); ready=inboundReady; }
      }
      if(ac.defectUntil && ac.defectUntil>ready && f.departure<ac.defectUntil){
        ready=ac.defectUntil;
      }
      const cfg=AIRPORT_OPS[f.from] || {slotIntervalMin:15,graceMin:10};
      let actualDep=ready;
      if(ready>f.departure+cfg.graceMin*MIN){
        f.slotMissed=true;
        const reassigned=nextSlotTime(ready,f.from);
        f.slotDelayMin=Math.max(0,Math.ceil((reassigned-ready)/MIN));
        f.assignedSlot=reassigned;
        actualDep=reassigned;
      }else{
        f.assignedSlot=f.departure;
      }
      f.actualDeparture=Math.max(f.departure,actualDep);
      f.actualArrival=f.arrival+(f.actualDeparture-f.departure)+f.enrouteDelayMin*MIN;
      prev=f;
    }
  }
}
function getNextGroundFlightForAircraft(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && !f.settled && flightActualDeparture(f)>t)
    .sort((x,y)=>flightActualDeparture(x)-flightActualDeparture(y))[0] || null;
}

function logEvent(){ /* operations log intentionally disabled */ }
function maybeGeneratePreDepartureIssue(f,t){
  if(f.opsChecked || !state.ops.automaticDisruptions) return false;
  if(t < f.departure-60*MIN || t >= f.departure) return false;
  f.opsChecked=true;
  const roll=Math.random();
  if(roll<0.025){
    const ac=state.aircraft.find(a=>a.id===f.aircraftId);
    const repairMin=90+Math.floor(Math.random()*241);
    f.technicalDelayMin+=repairMin;
    if(ac){ ac.defectUntil=Math.max(ac.defectUntil||0,f.departure+repairMin*MIN); ac.defectReason='Technical defect'; }
    logEvent(`${f.id}: technical defect on ${ac?.tail||'aircraft'}; estimated repair ${repairMin} min.`);
  }else if(roll<0.16){
    const delay=10+Math.floor(Math.random()*31);
    f.handlingDelayMin+=delay;
    logEvent(`${f.id}: ground handling delay +${delay} min at ${f.from}.`);
  }
  return true;
}
function maybeGenerateEnrouteIssue(f,t){
  if(f.enrouteChecked || !state.ops.automaticDisruptions || t<flightActualDeparture(f)) return false;
  f.enrouteChecked=true;
  if(Math.random()<0.09){
    const delay=5+Math.floor(Math.random()*21);
    f.enrouteDelayMin+=delay;
    logEvent(`${f.id}: en-route disruption adds about ${delay} min to arrival.`);
  }
  return true;
}
function processEvents(){
  ensureRecurringFlights();
  let changed=false;
  const t=simNow();

  for(const f of state.flights) if(maybeGeneratePreDepartureIssue(f,t)) changed=true;
  recalculateOperations();

  for(const f of state.flights){
    if(f.slotMissed && !f.slotLogged && t>=f.departure-20*MIN){
      f.slotLogged=true;
      logEvent(`${f.id}: original ${f.from} slot missed; new slot ${formatTime(f.assignedSlot)}.`);
      changed=true;
    }
    if(!f.departureLogged && t>=flightActualDeparture(f)){
      f.departureLogged=true;
      if(maybeGenerateEnrouteIssue(f,t)){ recalculateOperations(); changed=true; }
      const d=flightTotalDepartureDelayMin(f);
      logEvent(`${f.id} departed ${f.from} for ${f.to}${d?` ${d} min late`:''}.`,flightActualDeparture(f));
      changed=true;
    }
    if(!f.settled && t>=flightActualArrival(f)){
      f.settled=true;
      const ac=state.aircraft.find(a=>a.id===f.aircraftId);
      if(ac) ac.location=f.to;
      state.cash += f.revenue-f.costs;
      state.stats.revenue += f.revenue; state.stats.costs += f.costs;
      state.stats.pax += f.pax; state.stats.completed += 1;
      const ad=Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN));
      logEvent(`${f.id} arrived ${f.to}${ad?` ${ad} min late`:''}: ${f.pax} pax, ${money(f.revenue-f.costs)} net.`,flightActualArrival(f));
      changed=true;
    }
  }
  for(const ac of state.aircraft){
    if(ac.defectUntil && t>=ac.defectUntil){ ac.defectUntil=0; ac.defectReason=''; changed=true; }
  }
  if(changed){ recalculateOperations(); save(); }
}

function availableAircraftForSchedule(){
  const t=simNow();
  return state.aircraft.filter(ac =>
    !aircraftActiveFlight(ac.id,t) &&
    !aircraftUpcomingFlight(ac.id,t) &&
    !state.services.some(s=>s.active && s.aircraftId===ac.id)
  );
}

function estimateFlight(from,to,ac,fare){
  const a=AIRPORTS[from], b=AIRPORTS[to], m=MODELS[ac.model];
  const km=distanceKm(a,b);
  const duration=flightDurationMs(a,b,m);
  const rangeOk=km<=m.maxRangeKm;
  const baseFare=60+km*.085;
  const priceFactor=clamp(1-(fare-baseFare)/Math.max(250,baseFare*2.5),.38,1.05);
  const routeFactor=0.78 + (Math.sin((from.charCodeAt(0)+to.charCodeAt(0))*1.7)*.08);
  const load=clamp(routeFactor*priceFactor,.38,.96);
  const pax=Math.round(m.seats*load);
  const revenue=Math.round(pax*fare);
  const costs=Math.round(km*m.costPerKm+8500+(duration/HOUR)*1200);
  return {km,duration,rangeOk,load,pax,revenue,costs,profit:revenue-costs};
}

function addLocalDays(timestamp, days){
  const d=new Date(timestamp);
  d.setDate(d.getDate()+days);
  return d.getTime();
}

function nextRecurringDeparture(timestamp, rule){
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

function createFlightRecord({aircraftId,from,to,departure,fare,serviceId=null,serviceLeg=null}){
  const ac=state.aircraft.find(a=>a.id===aircraftId);
  const est=estimateFlight(from,to,ac,fare);
  const id='AS'+state.nextFlight++;
  const f={
    id,aircraftId,from,to,departure,arrival:departure+est.duration,fare,
    load:est.load,pax:est.pax,revenue:est.revenue,costs:est.costs,
    settled:false,departureLogged:false,serviceId,serviceLeg,
    handlingDelayMin:0,technicalDelayMin:0,enrouteDelayMin:0,propagatedDelayMin:0,slotDelayMin:0,
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
    let guard=0;
    while(svc.nextDeparture<=horizon && guard<600){
      const ac=state.aircraft.find(a=>a.id===svc.aircraftId);
      if(!ac){ svc.active=false; changed=true; break; }

      const outbound=createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.from,to:svc.to,
        departure:svc.nextDeparture,fare:svc.fare,serviceId:svc.id,serviceLeg:'outbound'
      });
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=outbound.arrival+svc.turnaroundMin*MIN;
      const returnDeparture=destinationRight
        ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
        : alignTimestampToAirportSlot(earliestReturn,svc.to);
      const returnFlight=createFlightRecord({
        aircraftId:svc.aircraftId,from:svc.to,to:svc.from,
        departure:returnDeparture,
        fare:svc.fare,serviceId:svc.id,serviceLeg:'return'
      });

      svc.lastGeneratedDeparture=svc.nextDeparture;
      svc.nextDeparture=nextRecurringDeparture(svc.nextDeparture,svc.rule);
      guard++; changed=true;
    }
  }
  if(changed) save();
}

function scheduleFlight(){
  const from=originEl.value, to=destEl.value, acId=aircraftEl.value;
  const ac=state.aircraft.find(a=>a.id===acId);
  const fare=clamp(Number(fareEl.value)||0,30,3000);
  const scheduleType=scheduleTypeEl.value;
  const departure=nextTimestampForClock(departureTimeEl.value);
  if(!departure) return toast('Choose a valid departure time.');

  if(!ac) return toast('Choose an available aircraft.');
  if(from===to) return toast('Origin and destination must differ.');
  if(ac.location!==from) return toast(`${ac.tail} is currently at ${ac.location}. Choose that origin.`);
  if(aircraftActiveFlight(ac.id) || aircraftUpcomingFlight(ac.id) || state.services.some(s=>s.active&&s.aircraftId===ac.id))
    return toast(`${ac.tail} already has an active or future assignment.`);

  const outbound=estimateFlight(from,to,ac,fare);
  if(!outbound.rangeOk) return toast(`${ac.model} does not have enough range for this route.`);

  if(scheduleType==='once'){
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare});
    logEvent(`${f.id} scheduled ${from} → ${to} with ${ac.tail}.`);
    selectedAircraftId=ac.id;
    save(); refreshAll();
    return toast(`${f.id} scheduled. ${formatDuration(outbound.duration)} block time.`);
  }

  const rule=repeatRuleEl.value;
  const turnaroundMin=Number(turnaroundEl.value)||90;
  const inbound=estimateFlight(to,from,ac,fare);
  const slotPlan=requiredSlotPlan(from,to,ac,fare,departure,turnaroundMin);
  const alignedDeparture=slotPlan.outboundDeparture;
  const cycle=(slotPlan.returnDeparture-alignedDeparture)+inbound.duration;
  const minInterval=minimumRepeatInterval(rule);

  if(!slotPlan.originRight||!slotPlan.destinationRight){
    return toast('Recurring service needs owned slot rights at both airports. Acquire the missing rights first.');
  }

  if(cycle>minInterval){
    return toast(
      `This aircraft needs ${formatDuration(cycle)} for the round trip. `+
      `Choose a less frequent repeat pattern or a shorter route.`
    );
  }

  const svc={
    id:'SCH'+state.nextService++,
    aircraftId:ac.id,from,to,fare,rule,turnaroundMin,
    firstDeparture:alignedDeparture,nextDeparture:alignedDeparture,
    originSlotRightId:slotPlan.originRight.id,
    destinationSlotRightId:slotPlan.destinationRight.id,
    lastGeneratedDeparture:null,active:true,createdAt:simNow()
  };
  state.services.push(svc);
  ensureRecurringFlights();
  logEvent(`${svc.id} created: ${from} ↔ ${to}, ${rule}, ${ac.tail}.`);
  selectedAircraftId=ac.id;
  save(); refreshAll();
  toast(`${svc.id} is active. Future round trips will be generated automatically.`);
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

    const outEst=estimateFlight(service.from,service.to,ac,service.fare);
    const backEst=estimateFlight(service.to,service.from,ac,service.fare);
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
  if(flightActualDeparture(outbound)<=simNow()) return toast('This round trip has already started.');

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

  selectedAircraftId=newAcId;
  selectedFlightId=selected.id;
  recalculateOperations();
  save();
  refreshAll();
  toast(`${newAc.tail} will operate this round trip only.`);
}

function serviceReplacementCandidates(svc){
  const now=simNow();
  const nextOut=state.flights.filter(f=>f.serviceId===svc.id && f.serviceLeg==='outbound' && flightActualDeparture(f)>now)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  return state.aircraft.filter(ac=>{
    if(ac.id===svc.aircraftId) return true;
    if(ac.location!==svc.from || aircraftIsDefective(ac,now)) return false;
    if(state.services.some(s=>s.active && s.id!==svc.id && s.aircraftId===ac.id)) return false;
    const out=estimateFlight(svc.from,svc.to,ac,svc.fare), back=estimateFlight(svc.to,svc.from,ac,svc.fare);
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
  const ret=state.flights.filter(f=>f.serviceId===serviceId && f.serviceLeg==='return' && f.departure>out.departure)
    .sort((a,b)=>a.departure-b.departure)[0];
  out.aircraftId=newAcId; clearAircraftSpecificDelay(out);
  if(ret){ ret.aircraftId=newAcId; clearAircraftSpecificDelay(ret); }
  recalculateOperations(); logEvent(`${ac.tail} substituted for ${svc.id} next ${svc.from} ↔ ${svc.to} rotation.`);
  save(); refreshAll(); toast(`${ac.tail} will operate the next round trip only.`);
}
function changeServiceAircraft(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('That aircraft already owns this schedule.');
  if(state.flights.some(f=>f.serviceId===serviceId && statusOfFlight(f)==='airborne'))
    return toast('Wait until the current rotation is on the ground.');
  if(!serviceReplacementCandidates(svc).some(a=>a.id===newAcId)) return toast(`${ac.tail} is not a suitable spare at ${svc.from}.`);
  const old=state.aircraft.find(a=>a.id===svc.aircraftId); svc.aircraftId=newAcId; const now=simNow();
  for(const f of state.flights){
    if(f.serviceId===serviceId && flightActualDeparture(f)>now){ f.aircraftId=newAcId; clearAircraftSpecificDelay(f); }
  }
  recalculateOperations(); logEvent(`${svc.id}: aircraft changed ${old?.tail||'unknown'} → ${ac.tail} for all future rotations.`);
  selectedAircraftId=newAcId; save(); refreshAll(); toast(`${ac.tail} is now permanently assigned to ${svc.id}.`);
}
function injectHandlingDelay(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  f.handlingDelayMin=(f.handlingDelayMin||0)+30; f.opsChecked=true;
  recalculateOperations(); logEvent(`${f.id}: manual test — ground handling delay +30 min.`);
  save(); refreshAll(); toast(`${f.id} now has a 30-minute handling delay.`);
}
function injectTechnicalDefect(){
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId); if(!ac) return toast('Select an aircraft first.');
  if(aircraftActiveFlight(ac.id)) return toast('Defect testing is only available on the ground.');
  const f=getNextGroundFlightForAircraft(ac.id); if(!f) return toast(`${ac.tail} has no future flight.`);
  const repairMin=180; ac.defectUntil=Math.max(ac.defectUntil||0,f.departure+repairMin*MIN); ac.defectReason='Technical defect';
  f.technicalDelayMin=Math.max(f.technicalDelayMin||0,repairMin); f.opsChecked=true;
  recalculateOperations(); logEvent(`${ac.tail}: technical defect; estimated repair 3h. Consider a substitute aircraft.`);
  save(); refreshAll(); toast(`${ac.tail} is defective for about 3 hours.`);
}

function cancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId);
  if(!svc) return;
  svc.active=false;
  const t=simNow();
  state.flights=state.flights.filter(f => !(f.serviceId===serviceId && f.departure>t));
  logEvent(`${serviceId} recurring schedule cancelled.`);
  save(); refreshAll(); toast(`${serviceId} cancelled. Existing/airborne flights were kept.`);
}

function buyAircraft(modelName){
  const m=MODELS[modelName];
  if(state.cash<m.price) return toast(`Not enough cash for ${modelName}.`);
  state.cash-=m.price;
  const n=state.nextAircraft++;
  const ac={id:'AC'+n,tail:randomTail(n),model:modelName,location:state.home,defectUntil:0,defectReason:''};
  state.aircraft.push(ac);
  logEvent(`Purchased ${modelName} ${ac.tail} for ${money(m.price)}.`);
  save(); refreshAll(); toast(`${ac.tail} delivered at ${state.home}.`);
}

function settleSelected(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac) return;

  selectedFlightId=null;
  selectedAircraftId=acId;
  refreshSelectedPanel(true);
  refreshLists();
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);

  const panel=document.getElementById('selectedPanel');
  if(panel.animate){
    panel.animate(
      [{outline:'2px solid rgba(88,210,255,0)'},{outline:'2px solid rgba(88,210,255,.85)'},{outline:'2px solid rgba(88,210,255,0)'}],
      {duration:650}
    );
  }
  const r=panel.getBoundingClientRect();
  if(r.top<0 || r.bottom>window.innerHeight){
    panel.scrollIntoView({behavior:'smooth',block:'center'});
  }
}


function settleSelectedFlight(flightId){
  const f=state.flights.find(x=>x.id===flightId);
  if(!f) return;

  selectedFlightId=f.id;
  selectedAircraftId=f.aircraftId;

  refreshSelectedPanel(true);
  refreshLists();
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  refreshOpsControls();

  const panel=document.getElementById('selectedPanel');
  if(panel.animate){
    panel.animate(
      [{outline:'2px solid rgba(88,210,255,0)'},{outline:'2px solid rgba(88,210,255,.85)'},{outline:'2px solid rgba(88,210,255,0)'}],
      {duration:650}
    );
  }
  const r=panel.getBoundingClientRect();
  if(r.top<0 || r.bottom>window.innerHeight){
    panel.scrollIntoView({behavior:'smooth',block:'center'});
  }
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

const scheduleTypeEl=document.getElementById('scheduleType');
const originEl=document.getElementById('origin');
const destEl=document.getElementById('destination');
const aircraftEl=document.getElementById('aircraft');
const departureTimeEl=document.getElementById('departureTime');
const fareEl=document.getElementById('fare');
const repeatRuleEl=document.getElementById('repeatRule');
const turnaroundEl=document.getElementById('turnaround');
const recurringOptionsEl=document.getElementById('recurringOptions');
const scheduleBtn=document.getElementById('scheduleBtn');
const acquireSlotsBtn=document.getElementById('acquireSlotsBtn');
const slotAirportEl=document.getElementById('slotAirport');
const slotTimeEl=document.getElementById('slotTime');
const buySlotBtn=document.getElementById('buySlotBtn');

function populateAirports(){
  const opts=Object.values(AIRPORTS).map(a=>`<option value="${a.iata}">${a.iata} — ${a.name}</option>`).join('');
  originEl.innerHTML=opts; destEl.innerHTML=opts; slotAirportEl.innerHTML=opts;
  originEl.value='FRA'; destEl.value='AMS'; slotAirportEl.value=state.home;
}
function refreshAircraftSelect(force=false){
  const available=availableAircraftForSchedule();
  const previous=aircraftEl.value;
  const sig=available.map(a=>`${a.id}:${a.tail}:${a.model}:${a.location}`).join('|');

  // Replacing <option> nodes while a native select is open causes visible flicker
  // and can discard the user's pending selection. Only rebuild when the actual
  // option set changed, and never while the user is interacting with the control.
  const interacting=document.activeElement===aircraftEl;
  if((force || sig!==aircraftSelectSignature) && !interacting){
    aircraftSelectSignature=sig;
    aircraftEl.innerHTML=available.length
      ? available.map(a=>`<option value="${a.id}">${a.tail} · ${a.model} · at ${a.location}</option>`).join('')
      : '<option value="">No aircraft available</option>';

    if(available.some(a=>a.id===previous)) aircraftEl.value=previous;
    else if(available.length && !aircraftEl.value) aircraftEl.value=available[0].id;
  }

  scheduleBtn.disabled=!available.length;
  refreshSchedulePreview();
}

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring';
  recurringOptionsEl.style.display=recurring?'block':'none';
  scheduleBtn.textContent=recurring?'Create recurring schedule':'Schedule one-time flight';
  if(!recurring) acquireSlotsBtn.style.display='none';
  refreshSchedulePreview();
}

function refreshSchedulePreview(){
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  if(!ac){document.getElementById('schedulePreview').textContent='No unassigned aircraft available.';return;}
  const from=originEl.value,to=destEl.value,fare=clamp(Number(fareEl.value)||0,30,3000);
  if(from===to){
    document.getElementById('schedulePreview').textContent='Choose two different airports.';
    return;
  }
  if(ac.location!==from){
    document.getElementById('schedulePreview').innerHTML=
      `<span class="money bad">${ac.tail} is currently at ${ac.location}.</span> `+
      `Choose ${ac.location} as departure or select another aircraft.`;
    acquireSlotsBtn.style.display='none';
    return;
  }

  const out=estimateFlight(from,to,ac,fare);
  const rangeWarning=out.rangeOk?'':' · <span class="money bad">OUT OF RANGE</span>';

  const firstDeparture=nextTimestampForClock(departureTimeEl.value);
  const firstText=firstDeparture?` · first dep <b>${formatTime(firstDeparture)}</b>`:'';

  if(scheduleTypeEl.value==='once'){
    acquireSlotsBtn.style.display='none';
    document.getElementById('schedulePreview').innerHTML =
      `${num(out.km)} km · ${formatDuration(out.duration)} · load <b>${Math.round(out.load*100)}%</b> · `+
      `est. net <b class="money ${out.profit>=0?'good':'bad'}">${money(out.profit)}</b>${firstText}${rangeWarning}`;
    return;
  }

  const back=estimateFlight(to,from,ac,fare);
  const turnaroundMin=Number(turnaroundEl.value)||90;
  const plan=firstDeparture?requiredSlotPlan(from,to,ac,fare,firstDeparture,turnaroundMin):null;
  const cycle=plan?(plan.returnDeparture-plan.outboundDeparture)+back.duration:out.duration+turnaroundMin*MIN+back.duration;
  const minInterval=minimumRepeatInterval(repeatRuleEl.value);
  const fits=cycle<=minInterval;
  const roundNet=out.profit+back.profit;

  let slotHtml='',missingCost=0;
  if(plan){
    const p1=plan.originRight?0:slotSeriesPrice(from,plan.outboundDeparture);
    const p2=plan.destinationRight?0:slotSeriesPrice(to,plan.returnDeparture);
    missingCost=p1+p2;
    slotHtml=`<div style="margin-top:7px">
      <span class="slot-chip ${plan.originRight?'owned':'missing'}">${from} ${hhmm(plan.outboundDeparture)} ${plan.originRight?'OWNED':'NEEDED'}</span>
      <span class="slot-chip ${plan.destinationRight?'owned':'missing'}">${to} ${hhmm(plan.returnDeparture)} ${plan.destinationRight?'OWNED':'NEEDED'}</span>
      ${missingCost?`<div class="tiny muted" style="margin-top:4px">Missing slot rights: <b>${money(missingCost)}</b></div>`:''}
    </div>`;
    acquireSlotsBtn.style.display=missingCost?'block':'none';
    acquireSlotsBtn.disabled=state.cash<missingCost;
    acquireSlotsBtn.textContent=`Acquire missing slots · ${money(missingCost)}`;
  }else{
    acquireSlotsBtn.style.display='none';
  }

  document.getElementById('schedulePreview').innerHTML =
    `${num(out.km)} km each way · round trip <b>${formatDuration(cycle)}</b> · first dep <b>${plan?formatTime(plan.outboundDeparture):'—'}</b> · `+
    `est. round-trip net <b class="money ${roundNet>=0?'good':'bad'}">${money(roundNet)}</b> · `+
    `<span class="money ${fits?'good':'bad'}">${fits?'schedule fits':'aircraft cannot complete cycle before next departure'}</span>${rangeWarning}${slotHtml}`;
}

function refreshServices(force=false){
  const active=state.services.filter(s=>s.active);
  const uiSig=active.map(s=>{
    const ac=state.aircraft.find(a=>a.id===s.aircraftId);
    const candidates=serviceReplacementCandidates(s).map(a=>`${a.id}:${a.location}:${aircraftIsDefective(a)?1:0}`).join(',');
    return `${s.id}:${s.aircraftId}:${s.active?1:0}:${ac?.defectUntil||0}:${s.originSlotRightId||''}:${s.destinationSlotRightId||''}:${candidates}`;
  }).join('|');

  const serviceList=document.getElementById('serviceList');
  const interacting=Boolean(serviceList && serviceList.contains(document.activeElement));
  if(!force && uiSig===servicesUiSignature) return;
  if(interacting) return;
  servicesUiSignature=uiSig;
  document.getElementById('serviceCount').textContent=active.length;
  const el=document.getElementById('serviceList');
  if(!active.length){ el.innerHTML='<div class="empty">No recurring schedules yet.</div>'; return; }
  const t=simNow();
  el.innerHTML=active.map(s=>{
    const ac=state.aircraft.find(a=>a.id===s.aircraftId);
    const next=state.flights.filter(f=>f.serviceId===s.id && f.serviceLeg==='outbound' && flightActualDeparture(f)>t)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
    const candidates=serviceReplacementCandidates(s);
    const options=candidates.map(a=>`<option value="${a.id}" ${a.id===s.aircraftId?'selected':''}>${a.tail} · ${a.model} · ${a.location}</option>`).join('');
    const defect=aircraftIsDefective(ac,t)?`<span class="issue-badge defect">DEFECT until ${shortClock(ac.defectUntil)}</span>`:'';
    return `<div class="service-row">
      <div class="row-between">
        <div><b>${s.from} ↔ ${s.to}</b><div class="tiny muted">${s.id} · ${s.rule} · ${ac?.tail||'aircraft missing'} ${defect}</div></div>
        <button class="btn bad" data-cancel-service="${s.id}">Cancel</button>
      </div>
      <div class="tiny muted" style="margin-top:5px">${next?`Next ${formatTime(flightActualDeparture(next))}`:'Generating next service…'} · ${s.turnaroundMin} min planned turnaround</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">
        ${slotRightById(s.originSlotRightId)?`<span class="slot-chip owned">${s.from} ${hhmmFromMinute(slotRightById(s.originSlotRightId).minuteOfDay)}</span>`:''}
        ${slotRightById(s.destinationSlotRightId)?`<span class="slot-chip owned">${s.to} ${hhmmFromMinute(slotRightById(s.destinationSlotRightId).minuteOfDay)}</span>`:''}
      </div>
      <div class="service-swap">
        <select data-service-aircraft="${s.id}" aria-label="Replacement aircraft for ${s.id}">${options}</select>
        <span class="slot-chip">${AIRPORT_OPS[s.from]?.slotIntervalMin||15}m slots @ ${s.from}</span>
      </div>
      <div class="service-action-row">
        <button class="btn" data-sub-next="${s.id}" type="button">Sub next round trip</button>
        <button class="btn good" data-change-service="${s.id}" type="button">Change aircraft permanently</button>
      </div>
      ${candidates.length<=1?`<div class="tiny muted" style="margin-top:5px">No spare aircraft is currently available at ${s.from}.</div>`:''}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-cancel-service]').forEach(b=>b.addEventListener('click',()=>cancelService(b.dataset.cancelService)));
  el.querySelectorAll('[data-sub-next]').forEach(b=>b.addEventListener('click',()=>{
    const sel=el.querySelector(`[data-service-aircraft="${b.dataset.subNext}"]`); substituteNextRotation(b.dataset.subNext,sel?.value);
  }));
  el.querySelectorAll('[data-change-service]').forEach(b=>b.addEventListener('click',()=>{
    const sel=el.querySelector(`[data-service-aircraft="${b.dataset.changeService}"]`); changeServiceAircraft(b.dataset.changeService,sel?.value);
  }));
}


function refreshSlotBuyPreview(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base){
    document.getElementById('slotBuyPreview').textContent='Choose a valid time.';
    buySlotBtn.disabled=true; return;
  }
  const aligned=alignTimestampToAirportSlot(base,airport);
  const existing=slotRightAt(airport,aligned);
  const price=slotSeriesPrice(airport,aligned);
  const interval=AIRPORT_OPS[airport]?.slotIntervalMin||15;
  document.getElementById('slotBuyPreview').innerHTML=existing
    ? `<span class="slot-chip owned">${airport} ${hhmm(aligned)} OWNED</span><div style="margin-top:4px">${interval}-minute airport slot cadence.</div>`
    : `<b>${airport} ${hhmm(aligned)}</b> recurring departure series · ${interval}-minute cadence · <b>${money(price)}</b>`;
  buySlotBtn.disabled=Boolean(existing)||state.cash<price;
  buySlotBtn.textContent=existing?'Slot already owned':`Acquire slot · ${money(price)}`;
}

function refreshSlotPortfolio(force=false){
  const list=document.getElementById('slotPortfolio');
  const rights=[...state.slotRights].sort((a,b)=>a.airport.localeCompare(b.airport)||a.minuteOfDay-b.minuteOfDay);
  const uiSig=rights.map(r=>{
    const svc=slotAssignedService(r.id);
    return `${r.id}:${r.airport}:${r.minuteOfDay}:${r.price}:${r.source}:${svc?.id||''}`;
  }).join('|');
  const interacting=Boolean(list && list.contains(document.activeElement));
  if(!force && uiSig===slotPortfolioSignature) return;
  if(interacting) return;
  slotPortfolioSignature=uiSig;
  document.getElementById('slotCount').textContent=rights.length;
  if(!rights.length){
    list.innerHTML='<div class="empty">No recurring airport slot rights yet.</div>'; return;
  }
  list.innerHTML=rights.map(r=>{
    const svc=slotAssignedService(r.id);
    const source=r.source==='grandfathered'?'historic / grandfathered':'market acquired';
    return `<div class="slot-right ${svc?'assigned':''}">
      <div class="row-between">
        <div><span class="airport">${r.airport}</span> <b>${hhmmFromMinute(r.minuteOfDay)}</b></div>
        <span class="tag">${svc?'assigned':'free'}</span>
      </div>
      <div class="meta">${source}${svc?` · ${svc.id} ${svc.from} ↔ ${svc.to}`:''}</div>
      ${!svc&&r.source!=='grandfathered'?`<button class="btn bad" data-sell-slot="${r.id}" type="button" style="margin-top:6px;min-height:28px;padding:3px 7px">Sell · ${money(Math.round(r.price*.7))}</button>`:''}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-sell-slot]').forEach(btn=>btn.addEventListener('click',()=>{
    const right=slotRightById(btn.dataset.sellSlot);
    if(!right||slotAssignedService(right.id)) return;
    state.cash+=Math.round((right.price||0)*.7);
    state.slotRights=state.slotRights.filter(r=>r.id!==right.id);
    save(); refreshAll(); refreshSlotBuyPreview();
    toast(`${right.airport} ${hhmmFromMinute(right.minuteOfDay)} slot right sold.`);
  }));
}

function buyMarketSlot(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base) return toast('Choose a valid slot time.');
  const aligned=alignTimestampToAirportSlot(base,airport);
  if(slotRightAt(airport,aligned)) return toast(`You already own ${airport} ${hhmm(aligned)}.`);
  const right=acquireSlotRight(airport,aligned);
  if(!right) return;
  save(); refreshAll(); refreshSlotBuyPreview();
  toast(`Acquired ${airport} ${hhmm(aligned)} recurring slot series.`);
}

function acquireRequiredScheduleSlots(){
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  const from=originEl.value,to=destEl.value,fare=clamp(Number(fareEl.value)||0,30,3000);
  const first=nextTimestampForClock(departureTimeEl.value);
  const turnaroundMin=Number(turnaroundEl.value)||90;
  if(!ac||!first||from===to) return toast('Complete the recurring schedule first.');

  const plan=requiredSlotPlan(from,to,ac,fare,first,turnaroundMin);
  const needs=[];
  if(!plan.originRight) needs.push({airport:from,ts:plan.outboundDeparture});
  if(!plan.destinationRight) needs.push({airport:to,ts:plan.returnDeparture});
  const total=needs.reduce((sum,x)=>sum+slotSeriesPrice(x.airport,x.ts),0);

  if(!needs.length) return toast('Both required slot rights are already owned.');
  if(state.cash<total) return toast(`You need ${money(total)} for the missing slot rights.`);

  for(const need of needs) acquireSlotRight(need.airport,need.ts,{silent:true});
  save(); refreshAll(); refreshSchedulePreview(); refreshSlotBuyPreview();
  toast(`Acquired ${needs.length} required slot ${needs.length===1?'right':'rights'}.`);
}

function refreshHeader(){
  const t=simNow();
  document.getElementById('cash').textContent=money(state.cash);
  document.getElementById('fleetCount').textContent=state.aircraft.length;
  document.getElementById('airborneCount').textContent=state.flights.filter(f=>statusOfFlight(f,t)==='airborne').length;
  document.getElementById('simClock').textContent=formatTime(t);
}
function refreshKPIs(){
  document.getElementById('kpiRevenue').textContent=money(state.stats.revenue);
  const p=state.stats.revenue-state.stats.costs;
  const pe=document.getElementById('kpiProfit'); pe.textContent=money(p); pe.className='n money '+(p>=0?'good':'bad');
  document.getElementById('kpiPax').textContent=num(state.stats.pax);
  document.getElementById('kpiFlights').textContent=num(state.stats.completed);
}
function refreshLists(){
  const t=simNow();
  const all=state.flights.filter(f=>flightActualArrival(f)>t-30*MIN).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const airborne=all.filter(f=>statusOfFlight(f,t)==='airborne');
  const upcoming=all.filter(f=>statusOfFlight(f,t)==='scheduled').slice(0,24);
  const recent=all.filter(f=>statusOfFlight(f,t)==='arrived').slice(-4);
  const list=[...recent,...airborne,...upcoming].sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  document.getElementById('flightCount').textContent=all.length;
  const el=document.getElementById('flightList');
  if(!list.length){el.innerHTML='<div class="empty">No flights scheduled.</div>';return;}
  el.innerHTML=list.map(f=>{
    const ac=state.aircraft.find(a=>a.id===f.aircraftId);
    const st=statusOfFlight(f,t), p=flightProgress(f,t), depDelay=flightTotalDepartureDelayMin(f);
    const timing=(st==='scheduled'||st==='delayed')?`Dep ${formatTime(flightActualDeparture(f))}`:
      st==='airborne'?`${Math.round(p*100)}% · ETA ${formatTime(flightActualArrival(f))}`:`Arrived ${formatTime(flightActualArrival(f))}`;
    const dotClass=st==='airborne'?'active':st==='delayed'?'delayed':'';
    return `<div class="flight-row ${selectedFlightId===f.id?'selected':''}" data-flight-id="${f.id}" data-ac="${f.aircraftId}">
      <div class="row-between"><span class="route-code">${f.from} → ${f.to}</span><span class="tag"><span class="dot ${dotClass}"></span>${st}</span></div>
      <div class="tiny muted">${f.id}${f.serviceId?` · ${f.serviceId}`:''} · ${ac?.tail||''} · ${timing}${depDelay?` · <span class="delay-text">+${depDelay}m</span>`:''}</div>
      ${st==='airborne'?`<div class="progress"><span style="width:${p*100}%"></span></div>`:''}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-flight-id]').forEach(x=>x.addEventListener('click',()=>settleSelectedFlight(x.dataset.flightId)));
}

function aircraftSwitchMarkup(){ return ''; }
function bindAircraftSwitchControls(){}

function flightSwitchMarkup(f){
  if(!f || !f.serviceId) return '';
  const {service,outbound}=rotationForFlight(f);
  if(!service || !outbound) return '';

  if(flightActualDeparture(outbound)<=simNow()){
    return `<div class="aircraft-switch-box">
      <div class="title">Aircraft replacement</div>
      <div class="tiny muted" style="margin-top:6px">This round trip has already started, so its aircraft can no longer be changed.</div>
    </div>`;
  }

  const candidates=rotationReplacementCandidates(f);
  if(!candidates.length){
    return `<div class="aircraft-switch-box">
      <div class="title">Switch aircraft for this flight</div>
      <div class="tiny muted" style="margin-top:6px">No suitable spare is currently at ${service.from}. A spare must be at the base, available, non-defective and have sufficient range.</div>
    </div>`;
  }

  const options=candidates.map(a=>`<option value="${a.id}">${a.tail} · ${a.model} · at ${a.location}</option>`).join('');
  return `<div class="aircraft-switch-box">
    <div class="title">Switch aircraft for this flight</div>
    <div class="tiny muted" style="margin-top:4px">${service.id} · recurring ${service.from} ↔ ${service.to}</div>
    <select id="flightReplacementAircraft" aria-label="Replacement aircraft">${options}</select>
    <div class="aircraft-switch-actions">
      <button id="flightSubRoundTripBtn" class="btn" type="button">Sub this round trip</button>
      <button id="flightPermanentChangeBtn" class="btn good" type="button">Change future schedule</button>
    </div>
    <div class="flight-switch-note">“Sub this round trip” changes only this outbound/return pair. “Change future schedule” assigns the spare to all later rotations.</div>
  </div>`;
}

function bindFlightSwitchControls(f){
  if(!f || !f.serviceId) return;
  const select=document.getElementById('flightReplacementAircraft');
  const subBtn=document.getElementById('flightSubRoundTripBtn');
  const permanentBtn=document.getElementById('flightPermanentChangeBtn');
  if(subBtn && select) subBtn.addEventListener('click',()=>substituteSelectedRotation(f.id,select.value));
  if(permanentBtn && select) permanentBtn.addEventListener('click',()=>{
    const service=state.services.find(s=>s.id===f.serviceId);
    if(service) changeServiceAircraft(service.id,select.value);
  });
}


function renderSelectedFlightDetails(f){
  const el=document.getElementById('selectedPanel');
  const badge=document.getElementById('selectedBadge');
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  const m=ac?MODELS[ac.model]:null;
  const st=statusOfFlight(f);
  const depDelay=flightTotalDepartureDelayMin(f);
  const arrDelay=Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN));
  const slotText=f.slotMissed
    ? `Missed planned departure slot · reassigned ${formatTime(f.assignedSlot)}`
    : `Departure slot ${formatTime(f.assignedSlot||f.departure)} · grace ${AIRPORT_OPS[f.from]?.graceMin||10} min`;

  if(badge) badge.textContent=f.id;

  el.innerHTML=`
    <div class="flight-detail-header">
      <div>
        <div class="flight-detail-code">${f.id}</div>
        <div class="flight-detail-route">${f.from} → ${f.to}</div>
      </div>
      <span class="tag"><span class="dot ${st==='airborne'?'active':st==='delayed'?'delayed':''}"></span>${st}</span>
    </div>

    <div class="flight-detail-times">
      <div class="flight-detail-time">
        <div class="l">Scheduled</div>
        <div class="v">${formatTime(f.departure)}<br>→ ${formatTime(f.arrival)}</div>
      </div>
      <div class="flight-detail-time">
        <div class="l">Actual / expected</div>
        <div class="v ${depDelay||arrDelay?'delay-text':''}">${formatTime(flightActualDeparture(f))}<br>→ ${formatTime(flightActualArrival(f))}</div>
      </div>
    </div>

    <div class="sep"></div>
    <div class="row-between"><span class="muted">Aircraft</span><b>${ac?`${ac.tail} · ${ac.model}`:'Unknown'}</b></div>
    <div class="row-between"><span class="muted">Schedule</span><b>${f.serviceId||'One-time flight'}</b></div>
    <div class="row-between"><span class="muted">Passengers</span><b>${f.pax}${m?` / ${m.seats}`:''}</b></div>
    <div class="row-between"><span class="muted">Load factor</span><b>${Math.round((f.load||0)*100)}%</b></div>
    <div class="row-between"><span class="muted">Departure delay</span><b class="${depDelay?'delay-text':''}">${depDelay?`+${depDelay} min`:'on time'}</b></div>
    <div class="row-between"><span class="muted">Arrival delay</span><b class="${arrDelay?'delay-text':''}">${arrDelay?`+${arrDelay} min`:'on time'}</b></div>
    <div class="row-between"><span class="muted">Slot</span><b>${slotText}</b></div>
    <div class="row-between"><span class="muted">Airport slot cadence</span><b>${AIRPORT_OPS[f.from]?.slotIntervalMin||15} min</b></div>
    <div class="row-between"><span class="muted">Slot right</span><b>${
      f.serviceId
        ? (()=>{const s=state.services.find(x=>x.id===f.serviceId); const rid=f.serviceLeg==='return'?s?.destinationSlotRightId:s?.originSlotRightId; const r=slotRightById(rid); return r?`${r.airport} ${hhmmFromMinute(r.minuteOfDay)} · owned`:'not assigned';})()
        : 'ad-hoc / one-time'
    }</b></div>

    ${(f.handlingDelayMin||f.technicalDelayMin||f.propagatedDelayMin||f.slotDelayMin||f.enrouteDelayMin)?`
      <div class="sep"></div>
      <div class="muted tiny">DELAY BREAKDOWN</div>
      <div class="row-between"><span class="muted">Ground handling</span><b>+${f.handlingDelayMin||0}m</b></div>
      <div class="row-between"><span class="muted">Technical</span><b>+${f.technicalDelayMin||0}m</b></div>
      <div class="row-between"><span class="muted">Inbound propagation</span><b>+${f.propagatedDelayMin||0}m</b></div>
      <div class="row-between"><span class="muted">Slot wait</span><b>+${f.slotDelayMin||0}m</b></div>
      <div class="row-between"><span class="muted">En-route</span><b>+${f.enrouteDelayMin||0}m</b></div>
    `:''}

    ${flightSwitchMarkup(f)}
  `;
  bindFlightSwitchControls(f);
}

function refreshSelectedPanel(force=false){
  const el=document.getElementById('selectedPanel'), badge=document.getElementById('selectedBadge');

  // The details panel can contain aircraft-replacement combo boxes. Do not destroy
  // and recreate that panel while the user is interacting with one of its controls.
  if(!force && el && el.contains(document.activeElement)) return;

  if(selectedFlightId){
    const selectedFlight=state.flights.find(f=>f.id===selectedFlightId);
    if(selectedFlight){
      renderSelectedFlightDetails(selectedFlight);
      return;
    }
    selectedFlightId=null;
  }

  const ac=state.aircraft.find(a=>a.id===selectedAircraftId);
  if(!ac){ if(badge) badge.textContent='none'; el.innerHTML='<div class="empty">Click an aircraft on the map, timeline or flight list.</div>'; return; }
  if(badge) badge.textContent=ac.tail;
  const t=simNow(), f=aircraftActiveFlight(ac.id,t), next=aircraftUpcomingFlight(ac.id,t), m=MODELS[ac.model];
  const svc=state.services.find(s=>s.active && s.aircraftId===ac.id), defective=aircraftIsDefective(ac,t);
  const defectHtml=defective?`<div class="sep"></div><div class="issue-badge defect">TECHNICAL DEFECT</div><div class="tiny muted" style="margin-top:5px">Unavailable until ${formatTime(ac.defectUntil)}. A spare aircraft can substitute the schedule.</div>`:'';
  if(f){
    const p=flightProgress(f,t), pos=currentAircraftPosition(ac,t), dd=flightTotalDepartureDelayMin(f);
    const ad=Math.max(0,Math.round((flightActualArrival(f)-f.arrival)/MIN));
    el.innerHTML=`<div class="aircraft-title">${ac.tail}</div><div class="muted">${ac.model} · ${m.seats} seats</div>${defectHtml}
      <div class="sep"></div><div class="status-line"><span class="dot active"></span><b>AIRBORNE</b></div>
      <div class="big-route">${f.from} → ${f.to}</div><div class="progress"><span style="width:${p*100}%"></span></div>
      <div class="row-between tiny muted" style="margin-top:5px"><span>${Math.round(p*100)}%</span><span>ETA ${formatTime(flightActualArrival(f))}</span></div>
      <div class="sep"></div><div class="row-between"><span class="muted">Flight</span><b>${f.id}</b></div>
      <div class="row-between"><span class="muted">Departure delay</span><b class="${dd?'delay-text':''}">${dd?`+${dd} min`:'on time'}</b></div>
      <div class="row-between"><span class="muted">Arrival delay</span><b class="${ad?'delay-text':''}">${ad?`+${ad} min`:'on time'}</b></div>
      <div class="row-between"><span class="muted">En-route effect</span><b>${f.enrouteDelayMin?`+${f.enrouteDelayMin} min`:'none'}</b></div>
      <div class="row-between"><span class="muted">Passengers</span><b>${f.pax} / ${m.seats}</b></div>
      <div class="row-between"><span class="muted">Heading</span><b>${Math.round(pos.heading)}°</b></div>
      `;
  }else{
    const nd=next?flightTotalDepartureDelayMin(next):0;
    const slot=next?(next.slotMissed?`Missed original slot · reassigned ${formatTime(next.assignedSlot)}`:`Slot ${formatTime(next.assignedSlot||next.departure)} · grace ${AIRPORT_OPS[next.from]?.graceMin||10} min`):'';
    el.innerHTML=`<div class="aircraft-title">${ac.tail}</div><div class="muted">${ac.model} · ${m.seats} seats</div>${defectHtml}
      <div class="sep"></div><div class="status-line"><span class="dot ${defective?'delayed':''}"></span><b>ON GROUND · ${ac.location}</b></div>
      ${svc?`<div class="sep"></div><div class="muted tiny">RECURRING SCHEDULE</div><div class="big-route">${svc.from} ↔ ${svc.to}</div><div>${svc.id} · ${svc.rule} · ${svc.turnaroundMin} min planned turnaround</div>`:''}
      ${next?`<div class="sep"></div><div class="muted tiny">NEXT FLIGHT</div><div class="big-route">${next.from} → ${next.to}</div>
        <div>${next.id} · dep ${formatTime(flightActualDeparture(next))} ${nd?`<span class="issue-badge delay">+${nd}m</span>`:''}</div>
        <div class="tiny muted" style="margin-top:5px">${slot}</div>
        ${(next.handlingDelayMin||next.technicalDelayMin||next.propagatedDelayMin||next.slotDelayMin)?`<div class="sep"></div><div class="tiny muted">DELAY BREAKDOWN</div>
        <div class="row-between"><span class="muted">Ground handling</span><b>+${next.handlingDelayMin||0}m</b></div>
        <div class="row-between"><span class="muted">Technical</span><b>+${next.technicalDelayMin||0}m</b></div>
        <div class="row-between"><span class="muted">Inbound propagation</span><b>+${next.propagatedDelayMin||0}m</b></div>
        <div class="row-between"><span class="muted">Slot wait</span><b>+${next.slotDelayMin||0}m</b></div>`:''}`
        :(!svc?'<div class="sep"></div><div class="muted">Available for assignment.</div>':'')}
      `;
  }
}
function refreshOpsControls(){
  const toggle=document.getElementById('opsToggle'), status=document.getElementById('opsSelectedStatus');
  const handling=document.getElementById('injectHandlingBtn'), defect=document.getElementById('injectDefectBtn');
  toggle.checked=state.ops.automaticDisruptions;
  const ac=state.aircraft.find(a=>a.id===selectedAircraftId);
  if(!ac){ status.textContent='Select an aircraft to test disruptions.'; handling.disabled=true; defect.disabled=true; return; }
  const next=getNextGroundFlightForAircraft(ac.id), bad=aircraftIsDefective(ac);
  status.innerHTML=`<b>${ac.tail}</b> · ${ac.location}${bad?` · <span class="issue-badge defect">DEFECT</span>`:''}${next?`<br>Next: ${next.id} ${next.from} → ${next.to} at ${formatTime(flightActualDeparture(next))}`:'<br>No future flight assigned.'}`;
  handling.disabled=!next; defect.disabled=!next || Boolean(aircraftActiveFlight(ac.id));
}

function scheduleWindow(){
  const now=simNow();
  const anchor=new Date(now);
  anchor.setMinutes(0,0,0);
  const start=anchor.getTime()+scheduleWindowOffsetHours*HOUR;
  return {start,end:start+scheduleRangeHours*HOUR,now};
}

function shortClock(ms){
  return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
}
function shortDay(ms){
  return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(ms));
}
function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function refreshScheduleTimeline(force=false){
  const board=document.getElementById('schedule-board');
  if(!board) return;

  const {start,end,now}=scheduleWindow();
  const pxPerHour=scheduleRangeHours===24?84:48;
  const timeWidth=Math.round(scheduleRangeHours*pxPerHour);
  const labelWidth=122;

  const relevant=state.flights
    .filter(f=>flightActualArrival(f)>start && flightActualDeparture(f)<end)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));

  const signature=[
    Math.floor(start/MIN),
    scheduleRangeHours,
    selectedFlightId||'',
    selectedAircraftId||'',
    relevant.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.settled?1:0}:${f.aircraftId}:${f.slotMissed?1:0}:${f.assignedSlot||0}:${f.slotDelayMin||0}`).join(','),
    state.aircraft.map(a=>a.id).join(',')
  ].join('|');

  // Rebuild at most when the visible flight geometry/state changes. The now-line moves separately.
  if(force || signature!==lastScheduleSignature){
    lastScheduleSignature=signature;

    let html='<div class="sched-header-row">';
    html+='<div class="sched-label"><b>Aircraft</b></div>';
    html+=`<div class="sched-timearea" style="width:${timeWidth}px">`;

    for(let h=0;h<=scheduleRangeHours;h++){
      const ts=start+h*HOUR;
      const left=h*pxPerHour;
      const major=(new Date(ts).getHours()%6===0);
      html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      if(h<scheduleRangeHours && (scheduleRangeHours===24 || h%2===0)){
        html+=`<span class="sched-time-label" style="left:${left}px">${shortClock(ts)}</span>`;
      }
      if(new Date(ts).getHours()===0){
        html+=`<span class="sched-day-label" style="left:${left}px"></span>`;
      }
    }
    html+='<div id="scheduleNowHeader" class="now-label" style="display:none">NOW</div>';
    html+='</div></div>';

    for(const ac of state.aircraft){
      const flights=relevant.filter(f=>f.aircraftId===ac.id).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
      html+=`<div class="sched-aircraft-row" data-sched-aircraft="${esc(ac.id)}">`;
      html+=`<div class="sched-label"><div class="sched-tail">${esc(ac.tail)}</div><div class="sched-model">${esc(ac.model)}</div></div>`;
      html+=`<div class="sched-timearea" style="width:${timeWidth}px">`;

      for(let h=0;h<=scheduleRangeHours;h++){
        const ts=start+h*HOUR;
        const left=h*pxPerHour;
        const major=(new Date(ts).getHours()%6===0);
        html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      }

      for(let i=0;i<flights.length;i++){
        const f=flights[i];
        const actualDep=flightActualDeparture(f), actualArr=flightActualArrival(f);
        const clippedStart=Math.max(start,actualDep), clippedEnd=Math.min(end,actualArr);
        const left=((clippedStart-start)/HOUR)*pxPerHour, width=Math.max(6,((clippedEnd-clippedStart)/HOUR)*pxPerHour);
        const st=statusOfFlight(f,now), selected=selectedFlightId===f.id?' selected':'';
        const depDelay=flightTotalDepartureDelayMin(f);
        const title=`${f.id} ${f.from} → ${f.to} | scheduled ${formatTime(f.departure)} | actual ${formatTime(actualDep)} – ${formatTime(actualArr)}${depDelay?` | +${depDelay}m departure delay`:''}`;

        // Departure slot markers. Planned slot is always shown; a missed slot gets
        // a red marker plus an amber marker at the reassigned slot.
        const plannedSlot=f.departure;
        if(plannedSlot>=start && plannedSlot<=end){
          const slotLeft=((plannedSlot-start)/HOUR)*pxPerHour;
          const plannedSlotTitle=f.slotMissed
            ? `${f.from} planned slot ${shortClock(plannedSlot)} — MISSED`
            : `${f.from} departure slot ${shortClock(plannedSlot)} · grace ${AIRPORT_OPS[f.from]?.graceMin||10} min`;
          html+=`<span class="slot-marker planned ${f.slotMissed?'missed':''}" data-slot-flight="${esc(f.id)}" style="left:${slotLeft}px"
            title="${esc(plannedSlotTitle)}"><span class="slot-label">${f.slotMissed?'MISSED':'SLOT'}</span></span>`;
        }

        if(f.slotMissed && f.assignedSlot && f.assignedSlot>=start && f.assignedSlot<=end){
          const newSlotLeft=((f.assignedSlot-start)/HOUR)*pxPerHour;
          const newSlotTitle=`${f.from} reassigned departure slot ${shortClock(f.assignedSlot)} · ${f.slotDelayMin||0} min slot wait`;
          html+=`<span class="slot-marker reassigned" data-slot-flight="${esc(f.id)}" style="left:${newSlotLeft}px"
            title="${esc(newSlotTitle)}"><span class="slot-label">NEW ${shortClock(f.assignedSlot)}</span></span>`;
        }

        if(depDelay>0 || actualArr!==f.arrival){
          const plannedStart=Math.max(start,f.departure), plannedEnd=Math.min(end,f.arrival);
          if(plannedEnd>plannedStart){
            const plannedLeft=((plannedStart-start)/HOUR)*pxPerHour;
            const plannedWidth=Math.max(6,((plannedEnd-plannedStart)/HOUR)*pxPerHour);
            html+=`<div class="planned-flight-block" style="left:${plannedLeft}px;width:${plannedWidth}px"
              title="${esc(`Planned ${formatTime(f.departure)} – ${formatTime(f.arrival)}`)}"></div>`;
          }
        }

        html+=`<div class="flight-block ${st}${selected}" data-flight-id="${esc(f.id)}" data-ac="${esc(f.aircraftId)}"
          title="${esc(title)}" style="left:${left}px;width:${width}px">
          <div class="flight-code">${esc(f.id)}${depDelay?` <span class="delay-text">+${depDelay}</span>`:''}</div>
          <div class="flight-route">${esc(f.from)} → ${esc(f.to)}</div>
          ${depDelay>0 || actualArr!==f.arrival
            ? `<div class="flight-times"><span class="sched">S ${shortClock(f.departure)}–${shortClock(f.arrival)}</span> · <span class="actual">A ${shortClock(actualDep)}–${shortClock(actualArr)}</span></div>`
            : `<div class="flight-times">${shortClock(actualDep)}–${shortClock(actualArr)}</div>`}
        </div>`;

        const next=flights[i+1];
        if(next && flightActualDeparture(next)>actualArr){
          const gapStart=Math.max(start,actualArr);
          const gapEnd=Math.min(end,flightActualDeparture(next));
          if(gapEnd>gapStart){
            const connLeft=((gapStart-start)/HOUR)*pxPerHour;
            const connWidth=Math.max(3,((gapEnd-gapStart)/HOUR)*pxPerHour);
            const sameAirport=f.to===next.from;
            const gap=flightActualDeparture(next)-actualArr;
            html+=`<span class="connection-line ${sameAirport?'':'mismatch'}" style="left:${connLeft}px;width:${connWidth}px"
              title="${sameAirport?'Turnaround / connection':'Location mismatch'}: ${f.to} → ${next.from}, ${formatDuration(gap)}"></span>`;
            if(connWidth>50){
              html+=`<span class="connection-label" style="left:${connLeft+connWidth/2}px">${sameAirport?esc(f.to)+' · ':''}${formatDuration(gap)}</span>`;
            }
          }
        }
      }

      html+=`<div class="now-line schedule-now-row" style="display:none"></div>`;
      html+='</div></div>';
    }

    if(!state.aircraft.length){
      html+='<div class="schedule-empty">No aircraft in fleet.</div>';
    }

    board.innerHTML=html;
    board.style.width=(labelWidth+timeWidth)+'px';

    board.querySelectorAll('.flight-block').forEach(el=>{
      el.addEventListener('click',()=>{
        settleSelectedFlight(el.dataset.flightId);
      });
    });
    board.querySelectorAll('[data-slot-flight]').forEach(el=>{
      el.addEventListener('click',e=>{
        e.stopPropagation();
        settleSelectedFlight(el.dataset.slotFlight);
      });
    });
    board.querySelectorAll('[data-sched-aircraft]').forEach(row=>{
      row.addEventListener('dblclick',()=>{
        settleSelected(row.dataset.schedAircraft);
      });
    });
  }

  updateScheduleNowLine();
  document.getElementById('schedule-window-label').textContent=
    `${shortDay(start)} ${shortClock(start)}  →  ${shortDay(end)} ${shortClock(end)}`;
}

function updateScheduleNowLine(){
  const {start,end,now}=scheduleWindow();
  const pxPerHour=scheduleRangeHours===24?84:48;
  const x=((now-start)/HOUR)*pxPerHour;
  const visible=now>=start && now<=end;

  const header=document.getElementById('scheduleNowHeader');
  if(header){
    header.style.display=visible?'block':'none';
    header.style.left=x+'px';
  }
  document.querySelectorAll('.schedule-now-row').forEach(line=>{
    line.style.display=visible?'block':'none';
    line.style.left=x+'px';
  });
}

function centerScheduleOnNow(){
  scheduleWindowOffsetHours=-2;
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  const scroller=document.getElementById('schedule-scroll');
  if(scroller) scroller.scrollLeft=0;
}

function initWorkspaceSplitter(){
  const workspace=document.getElementById('center-workspace');
  const mapPane=document.getElementById('map-pane');
  const splitter=document.getElementById('workspace-splitter');

  let pct=Number(localStorage.getItem(SPLIT_KEY));
  if(!Number.isFinite(pct)) pct=50;
  pct=clamp(pct,22,78);
  mapPane.style.flexBasis=pct+'%';
  splitter.setAttribute('aria-valuenow',String(Math.round(pct)));

  let dragging=false;

  const applyFromClientY=(clientY)=>{
    const rect=workspace.getBoundingClientRect();
    const splitterH=splitter.getBoundingClientRect().height||9;
    const usable=Math.max(1,rect.height-splitterH);
    const y=clamp(clientY-rect.top,usable*.22,usable*.78);
    const next=(y/usable)*100;
    mapPane.style.flexBasis=next+'%';
    splitter.setAttribute('aria-valuenow',String(Math.round(next)));
    localStorage.setItem(SPLIT_KEY,String(next));
    requestAnimationFrame(()=>{
      if(typeof map!=='undefined') map.invalidateSize({animate:false});
      refreshScheduleTimeline(false);
    });
  };

  splitter.addEventListener('pointerdown',e=>{
    dragging=true;
    splitter.classList.add('dragging');
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  splitter.addEventListener('pointermove',e=>{
    if(!dragging) return;
    applyFromClientY(e.clientY);
  });
  const endDrag=e=>{
    if(!dragging) return;
    dragging=false;
    splitter.classList.remove('dragging');
    try{splitter.releasePointerCapture(e.pointerId)}catch(_){}
    setTimeout(()=>map.invalidateSize({animate:false}),0);
  };
  splitter.addEventListener('pointerup',endDrag);
  splitter.addEventListener('pointercancel',endDrag);

  splitter.addEventListener('keydown',e=>{
    if(!['ArrowUp','ArrowDown','Home'].includes(e.key)) return;
    e.preventDefault();
    let current=parseFloat(mapPane.style.flexBasis)||50;
    if(e.key==='Home') current=50;
    else current+=e.key==='ArrowUp'?-3:3;
    current=clamp(current,22,78);
    mapPane.style.flexBasis=current+'%';
    splitter.setAttribute('aria-valuenow',String(Math.round(current)));
    localStorage.setItem(SPLIT_KEY,String(current));
    map.invalidateSize({animate:false});
  });
}


function refreshBuyButtons(){
  document.querySelectorAll('[data-buy]').forEach(b=>{b.disabled=state.cash<MODELS[b.dataset.buy].price;});
}
function refreshAll(){
  processEvents();
  recalculateOperations();
  refreshHeader();

  // State-changing refresh: update structural UI, but the functions themselves
  // still refuse to replace controls that are actively being edited.
  refreshAircraftSelect(true);
  refreshLists();
  refreshServices(true);
  refreshSlotPortfolio(true);

  refreshKPIs();
  refreshSelectedPanel(true);
  refreshOpsControls();
  refreshBuyButtons();
  updateMapData();
  refreshScheduleTimeline(true);
}

populateAirports();
slotTimeEl.value='08:00';
refreshSlotBuyPreview();
{
  const d=new Date(simNow()+15*MIN);
  d.setSeconds(0,0);
  d.setMinutes(Math.ceil(d.getMinutes()/5)*5);
  departureTimeEl.value=hhmm(d.getTime());
}
document.getElementById('speed').value=String(state.clock.speed);
scheduleBtn.addEventListener('click',scheduleFlight);
acquireSlotsBtn.addEventListener('click',acquireRequiredScheduleSlots);
buySlotBtn.addEventListener('click',buyMarketSlot);
slotAirportEl.addEventListener('change',refreshSlotBuyPreview);
slotTimeEl.addEventListener('change',refreshSlotBuyPreview);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,destEl,departureTimeEl,fareEl,repeatRuleEl,turnaroundEl].forEach(el=>{
  el.addEventListener('change',refreshSchedulePreview);
});
fareEl.addEventListener('input',refreshSchedulePreview);
departureTimeEl.addEventListener('input',refreshSchedulePreview);

aircraftEl.addEventListener('change',()=>{
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  if(ac){
    // Explicit aircraft choice: use its physical airport as the departure airport.
    // Never touch the destination field.
    originEl.value=ac.location;
  }
  refreshSchedulePreview();
});
refreshScheduleMode();
document.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click',()=>buyAircraft(b.dataset.buy)));
document.getElementById('speed').addEventListener('change',e=>{
  rebaseClock(Number(e.target.value));
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  refreshHeader();
  toast(e.target.value==='1'?'Realtime enabled.':'Test acceleration enabled.');
});
document.getElementById('schedulePrevBtn').addEventListener('click',()=>{
  scheduleWindowOffsetHours-=12; lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('scheduleNowBtn').addEventListener('click',centerScheduleOnNow);
document.getElementById('scheduleNextBtn').addEventListener('click',()=>{
  scheduleWindowOffsetHours+=12; lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('scheduleRange').addEventListener('change',e=>{
  scheduleRangeHours=Number(e.target.value)||24; lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('opsToggle').addEventListener('change',e=>{
  state.ops.automaticDisruptions=Boolean(e.target.checked);
  logEvent(`Automatic disruptions ${state.ops.automaticDisruptions?'enabled':'disabled'}.`);
  save(); refreshOpsControls();
});
document.getElementById('injectHandlingBtn').addEventListener('click',injectHandlingDelay);
document.getElementById('injectDefectBtn').addEventListener('click',injectTechnicalDefect);
document.getElementById('resetBtn').addEventListener('click',()=>{
  if(confirm('Delete this local airline save and restart the MVP?')){
    localStorage.removeItem(SAVE_KEY); state=newState(); selectedAircraftId=null; selectedFlightId=null; save();
    document.getElementById('speed').value='1'; scheduleWindowOffsetHours=-2; lastScheduleSignature=''; refreshAll(); fitNetwork(); toast('Local save reset.');
  }
});

recalculateOperations();
initWorkspaceSplitter();

const map = L.map('map', {
  zoomControl: true,
  worldCopyJump: true,
  preferCanvas: true,
  attributionControl: true
}).setView([49.5, 8.5], 4);

// Online basemap only; the airline simulation itself stays entirely in the browser.
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const airportLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const aircraftLayer = L.layerGroup().addTo(map);
const aircraftMarkers = new Map();
let routeSignature = '';

function aircraftIcon(ac, p) {
  const selected = ac.id === selectedAircraftId;
  const label = p.flight ? `${p.flight.id}  ${ac.tail}` : ac.tail;
  // The Unicode airplane glyph points roughly northeast, hence the -45 degree correction.
  const rotation = Math.round((p.heading || 0) - 45);
  return L.divIcon({
    className: '',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div class="plane-shell ${p.status === 'ground' ? 'ground' : ''} ${selected ? 'selected' : ''}">
      <span class="plane-halo"></span>
      <span class="plane-glyph" style="transform:rotate(${rotation}deg)">✈</span>
      <span class="plane-label-map">${label}</span>
    </div>`
  });
}

for (const a of Object.values(AIRPORTS)) {
  const marker = L.marker([a.lat, a.lon], {
    icon: L.divIcon({
      className: '',
      iconSize: [20, 28],
      iconAnchor: [5, 5],
      html: `<div class="airport-dot"></div><div class="airport-label">${a.iata}</div>`
    }),
    keyboard: true,
    title: `${a.iata} — ${a.name}`
  }).addTo(airportLayer);
  marker.bindTooltip(`<b>${a.iata}</b> — ${a.name}`, {direction:'top', className:'airport-tip'});
}

function rebuildRoutesIfNeeded() {
  const t = simNow();
  const visible = state.flights
    .filter(f => flightActualDeparture(f) <= t + 2*HOUR && flightActualArrival(f) > t - 15*MIN)
    .sort((a,b) => a.id.localeCompare(b.id));
  const signature = visible.map(f =>
    `${f.id}:${statusOfFlight(f,t)}:${f.id===selectedFlightId?1:0}`
  ).join('|');

  if (signature === routeSignature) return;
  routeSignature = signature;
  routeLayer.clearLayers();

  for (const f of visible) {
    const selected = f.id === selectedFlightId;
    const st = statusOfFlight(f,t);
    const coords = routeCoords(AIRPORTS[f.from], AIRPORTS[f.to], 80).map(([lon,lat]) => [lat,lon]);
    const line = L.polyline(coords, {
      color: selected ? '#58d2ff' : (st === 'airborne' ? '#74a9c1' : '#607887'),
      weight: selected ? 3 : 2,
      opacity: (st === 'scheduled' || st === 'delayed') ? .38 : .78,
      dashArray: '7 7',
      interactive: true
    }).addTo(routeLayer);
    line.bindTooltip(`${f.id} · ${f.from} → ${f.to}`);
    line.on('click', () => settleSelectedFlight(f.id));
  }
}

function updateMapData() {
  rebuildRoutesIfNeeded();
  const t = simNow();
  const liveIds = new Set();

  for (const ac of state.aircraft) {
    const p = currentAircraftPosition(ac,t);
    liveIds.add(ac.id);
    let marker = aircraftMarkers.get(ac.id);
    const iconKey=[
      p.status,
      ac.id===selectedAircraftId?1:0,
      p.flight?p.flight.id:'ground',
      Math.round((p.heading||0)/5)*5
    ].join('|');

    if (!marker) {
      marker = L.marker([p.lat,p.lon], {
        icon: aircraftIcon(ac,p),
        keyboard: true,
        zIndexOffset: p.status === 'airborne' ? 1000 : 300
      }).addTo(aircraftLayer);
      marker.__iconKey=iconKey;
      marker.on('click', (e) => {
        if(e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        settleSelected(ac.id);
      });
      aircraftMarkers.set(ac.id, marker);
    } else {
      marker.setLatLng([p.lat,p.lon]);
      if(marker.__iconKey!==iconKey){
        marker.setIcon(aircraftIcon(ac,p));
        marker.__iconKey=iconKey;
      }
      marker.setZIndexOffset(p.status === 'airborne' ? 1000 : 300);
    }
  }

  for (const [id, marker] of aircraftMarkers) {
    if (!liveIds.has(id)) {
      aircraftLayer.removeLayer(marker);
      aircraftMarkers.delete(id);
    }
  }
}

function fitNetwork() {
  const pts=[];
  for(const ac of state.aircraft){
    const p=currentAircraftPosition(ac);
    pts.push([p.lat,p.lon]);
  }
  for(const f of state.flights){
    pts.push([AIRPORTS[f.from].lat,AIRPORTS[f.from].lon],[AIRPORTS[f.to].lat,AIRPORTS[f.to].lon]);
  }
  if(!pts.length) return;
  map.fitBounds(L.latLngBounds(pts), {padding:[60,60], maxZoom:5});
}

map.whenReady(() => {
  map.invalidateSize({animate:false});
  updateMapData();
  fitNetwork();
  refreshScheduleTimeline(true);
});
document.getElementById('fitBtn').addEventListener('click',fitNetwork);

let lastUi=0;
function loop(now){
  processEvents();
  updateMapData();
  refreshHeader();
  updateScheduleNowLine();
  if(now-lastUi>900){
    // High-frequency refreshes must never rebuild form controls. Native combo boxes
    // can otherwise be destroyed/recreated while the user is choosing a value.
    refreshLists();
    refreshKPIs();
    refreshSelectedPanel();
    refreshOpsControls();
    refreshScheduleTimeline(false);

    // These functions are signature-guarded. They only touch form/card DOM when
    // their underlying data actually changed, and never while a contained control
    // has focus.
    refreshAircraftSelect(false);
    refreshServices(false);
    refreshSlotPortfolio(false);

    lastUi=now;
  }
  requestAnimationFrame(loop);
}
refreshAll();
requestAnimationFrame(loop);
setInterval(save,5000);
window.addEventListener('beforeunload',save);
