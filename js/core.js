/* Airline Operations Control Center Simulator shared utilities, state migration, and local persistence. */

const VERSION = 6;
const SAVE_KEY = 'aerosim_mvp_v6';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const Management = window.AeroManagement;
const SUPPORTED_SIMULATION_SPEEDS = [1,10];
const OPERATIONAL_PAST_FLIGHT_RETENTION = 24 * HOUR;
const OPERATIONAL_FUTURE_FLIGHT_HORIZON = 3 * DAY;
const FLIGHT_HISTORY_RETENTION = 35 * DAY;

const FUEL_MARKET_STEP = 6 * HOUR;
const FUEL_MARKET_BASE_EUR_GAL = 2.45;
const FUEL_KG_PER_US_GAL = 3.04;
const CO2_KG_PER_KG_FUEL = 3.16;
const CARBON_PRICE_EUR_PER_KG = .085;

const nightFormatters=new Map();
function timeToMinute(value){
  const [hours,minutes]=String(value||'00:00').split(':').map(Number);
  return ((hours||0)*60+(minutes||0))%1440;
}
function minuteInWindow(minute,start,end){
  start=timeToMinute(start); end=timeToMinute(end);
  if(start===end) return false;
  return start<end ? minute>=start&&minute<end : minute>=start||minute<end;
}
function localTimeParts(timeZone,timestamp){
  if(!nightFormatters.has(timeZone)){
    nightFormatters.set(timeZone,new Intl.DateTimeFormat('en-GB',{
      timeZone,hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'
    }));
  }
  const values={};
  for(const part of nightFormatters.get(timeZone).formatToParts(new Date(timestamp))){
    if(part.type!=='literal') values[part.type]=part.value;
  }
  return {weekday:values.weekday||'',hour:Number(values.hour)||0,minute:Number(values.minute)||0};
}
function stableCatalogUnit(seed){
  let hash=2166136261;
  for(const char of String(seed)){
    hash^=char.charCodeAt(0);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)/4294967295;
}
function simulationRandomUnit(seed){
  return stableCatalogUnit(`${state?.rng?.seed||'aoc'}:${seed}`);
}
function simulationRandom(label='random'){
  state.rng??={seed:`aoc-${state.clock?.simBase||Date.now()}`,counter:0,log:[]};
  state.rng.counter=(Number(state.rng.counter)||0)+1;
  const value=simulationRandomUnit(`${state.rng.counter}:${label}`);
  state.rng.log??=[];
  state.rng.log.push({counter:state.rng.counter,label,value,at:simNow(),realAt:Date.now()});
  if(state.rng.log.length>80) state.rng.log.splice(0,state.rng.log.length-80);
  return value;
}
function recentSimulationRandomRolls(limit=10){
  return (state.rng?.log||[]).slice(-Math.max(1,limit));
}
function airportNightStatus(airportCode,timestamp){
  const rule=AIRPORT_NIGHT_RULES[airportCode]||nightRule('UTC','open');
  const local=localTimeParts(rule.timeZone,timestamp);
  const minute=local.hour*60+local.minute;
  const inCore=minuteInWindow(minute,rule.start,rule.end);
  const inShoulder=rule.shoulderStart&&rule.shoulderEnd&&minuteInWindow(minute,rule.shoulderStart,rule.shoulderEnd)&&!inCore;
  const closed=rule.mode==='curfew'&&inCore;
  const restricted=!closed&&(inCore||inShoulder)&&rule.mode!=='open';
  const period=Math.floor(timestamp/(3*HOUR));
  const variable=Math.round(stableCatalogUnit(`${airportCode}:${period}:night`)*(rule.spreadMin||0));
  const delayMin=closed?0:restricted?(rule.delayMin||0)+variable:0;
  const nextOpenAt=closed?nextAirportNightOpenTime(airportCode,timestamp):timestamp;
  return {
    airport:airportCode,rule,status:closed?'closed':restricted?'restricted':'open',
    label:closed?'Night curfew active':restricted?rule.label:'Open overnight',
    detail:rule.detail,localTime:`${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}`,
    localWeekday:local.weekday,nextOpenAt,delayMin,capacityFactor:closed?rule.capacityFactor:restricted?rule.capacityFactor:1
  };
}
function nextAirportNightOpenTime(airportCode,timestamp){
  for(let step=5;step<=36*60;step+=5){
    const candidate=timestamp+step*MIN;
    const rule=AIRPORT_NIGHT_RULES[airportCode];
    const local=localTimeParts(rule?.timeZone||'UTC',candidate);
    const minute=local.hour*60+local.minute;
    if(!(rule?.mode==='curfew'&&minuteInWindow(minute,rule.start,rule.end))) return candidate;
  }
  return timestamp+6*HOUR;
}
function flightNightRestriction(flight,proposedDeparture=flight.departure){
  const duration=Number.isFinite(flight.operationalDurationMs)?flight.operationalDurationMs:(flight.arrival-flight.departure);
  const destination=flight.diversionAirport||flight.to;
  let departure=proposedDeparture;
  let closedDelay=0;
  let closedStatus=null;
  const closureEvents=[];
  const reasons=[];
  for(let i=0;i<6;i++){
    const depStatus=airportNightStatus(flight.from,departure);
    if(depStatus.status==='closed'){
      closedStatus=depStatus;
      closureEvents.push({
        phase:'departure',airport:flight.from,localTime:depStatus.localTime,
        nextOpenAt:depStatus.nextOpenAt,opensAt:depStatus.rule.end,
        label:depStatus.label,detail:depStatus.detail
      });
      const wait=depStatus.nextOpenAt-departure;
      closedDelay+=wait; departure+=wait;
      reasons.push(`${flight.from} opens ${depStatus.rule.end}`);
      continue;
    }
    const arrival=departure+duration+(Number(flight.enrouteDelayMin)||0)*MIN;
    const arrStatus=airportNightStatus(destination,arrival);
    if(arrStatus.status==='closed'){
      closedStatus=arrStatus;
      closureEvents.push({
        phase:'arrival',airport:destination,localTime:arrStatus.localTime,
        nextOpenAt:arrStatus.nextOpenAt,opensAt:arrStatus.rule.end,
        label:arrStatus.label,detail:arrStatus.detail
      });
      const wait=arrStatus.nextOpenAt-arrival;
      closedDelay+=wait; departure+=wait;
      reasons.push(`${destination} opens ${arrStatus.rule.end}`);
      continue;
    }
    break;
  }
  const depStatus=airportNightStatus(flight.from,departure);
  const arrStatus=airportNightStatus(destination,departure+duration+(Number(flight.enrouteDelayMin)||0)*MIN);
  const advisoryDelay=Math.max(depStatus.status==='restricted'?depStatus.delayMin:0,arrStatus.status==='restricted'?arrStatus.delayMin:0);
  const delayMin=Math.ceil(closedDelay/MIN)+advisoryDelay;
  const active=[
    {...depStatus,phase:'departure'},
    {...arrStatus,phase:'arrival'}
  ].filter(status=>status.status!=='open');
  return {
    delayMin,nextDeparture:departure+advisoryDelay*MIN,
    status:closedDelay?'closed':active.length?'restricted':'open',
    departure:depStatus,arrival:arrStatus,
    closedStatus,closures:closureEvents,restrictions:active,
    reason:closedDelay?`Night curfew: ${reasons.slice(-1)[0]||'next opening'}`:
      active.length?`Night restrictions at ${active.map(status=>status.airport).join('/')}`:'Night operations clear'
  };
}

function validateAirportCatalogs(){
  const required={
    markets:[AIRPORT_MARKETS,['size','business','tourism','wealth','hub','region','season']],
    operations:[AIRPORT_OPS,['slotIntervalMin','graceMin']],
    costs:[AIRPORT_COSTS,['landingPerTonne','passengerFee','securityFee','handlingBase','handlingPerPax','parkingHour']],
    nightRules:[AIRPORT_NIGHT_RULES,['timeZone','mode','label','start','end','capacityFactor','delayMin','detail']]
  };
  const airportCodes=Object.keys(AIRPORTS);
  for(const [catalogName,[catalog,fields]] of Object.entries(required)){
    const extras=Object.keys(catalog).filter(code=>!AIRPORTS[code]);
    if(extras.length) throw new Error(`Airport ${catalogName} contains unknown codes: ${extras.join(', ')}`);
    for(const code of airportCodes){
      if(!catalog[code]) throw new Error(`${code} is missing its airport ${catalogName} profile.`);
      const missing=fields.filter(field=>catalog[code][field]===undefined);
      if(missing.length) throw new Error(`${code} airport ${catalogName} profile is missing: ${missing.join(', ')}`);
    }
  }
  return true;
}
validateAirportCatalogs();

const AIRCRAFT_FAMILIES=[...new Set(Object.keys(MODELS).map(Management.aircraftFamily))];

const money = n => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const num = n => new Intl.NumberFormat('en-IE').format(Math.round(n));
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const rad = d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
function defaultCabin(modelName){ return {economy:MODELS[modelName]?.seats||0,business:0,first:0}; }
function cabinForAircraft(ac){ return ac?.cabin||defaultCabin(ac?.model); }
function cabinSeatCount(ac){ return Object.values(cabinForAircraft(ac)).reduce((total,seats)=>total+(Number(seats)||0),0); }
function normalizeFares(value){
  if(value && typeof value==='object') return {
    economy:clamp(Number(value.economy)||140,20,3000),
    business:clamp(Number(value.business)||350,50,6000),
    first:clamp(Number(value.first)||700,100,12000)
  };
  const economy=clamp(Number(value)||140,20,3000);
  return {economy,business:Math.round(economy*2.5),first:Math.round(economy*5)};
}

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
function requestSlotRight(airportCode,ts,{silent=false,source='operations request',force=false}={}){
  const aligned=alignTimestampToAirportSlot(ts,airportCode);
  const existing=slotRightAt(airportCode,aligned);
  if(existing) return existing;
  if(!force&&(state.resourceRequests||[]).some(item=>item.status==='pending'&&item.kind==='slot'&&item.payload?.airport===airportCode&&item.payload?.timestamp===aligned)) return null;
  if(!force&&typeof resourceAvailability==='function'&&typeof queueResourceRequest==='function'){
    const key=String(new Date(aligned).getHours());
    const supply=resourceAvailability('slot',key,airportCode);
    if(!supply.available){
      queueResourceRequest('slot',{key,location:airportCode,airport:airportCode,timestamp:aligned},supply);
      return null;
    }
  }
  const right={
    id:'SL'+state.nextSlotRight++,
    airport:airportCode,
    minuteOfDay:minuteOfDay(aligned),
    price:0,source:source==='market'?'requested':source,acquiredAt:simNow()
  };
  state.slotRights.push(right);
  save();
  return right;
}
function requiredSlotPlan(from,to,ac,fare,departure,turnaroundMin){
  const out=estimateFlight(from,to,ac,fare);
  const outboundDeparture=alignTimestampToAirportSlot(departure,from);
  const requestedTurnaroundMin=Number(turnaroundMin)||0;
  const fallbackMinimum=Number(MODELS[ac?.model]?.minimumTurnMin)||0;
  const effectiveTurnaroundMin=typeof effectiveTurnaroundMinutes==='function'
    ? effectiveTurnaroundMinutes(ac,to,requestedTurnaroundMin)
    : Math.max(requestedTurnaroundMin,fallbackMinimum);
  const earliestReturn=outboundDeparture+out.duration+effectiveTurnaroundMin*MIN;
  const returnDeparture=alignTimestampToAirportSlot(earliestReturn,to);
  return {
    outboundDeparture,
    returnDeparture,
    originRight:slotRightAt(from,outboundDeparture),
    destinationRight:slotRightAt(to,returnDeparture)
  };
}
function randomTail(i){return 'D-AS'+String(i).padStart(2,'0');}

function aircraftFuelPerformance(model){
  const turboprop=model.segment.includes('turboprop');
  const widebody=model.segment.includes('widebody');
  const regional=model.segment.includes('Regional jet');
  const burnGalPerHour=turboprop
    ? model.seats*2.5+50
    : widebody
      ? model.seats*4.1+300
      : regional
        ? model.seats*3.2+120
        : model.seats*3.7+150;
  const fuelCapacityGal=Math.round(burnGalPerHour*(model.maxRangeKm/model.speedKmh+1.4));
  return {burnGalPerHour:Math.round(burnGalPerHour),fuelCapacityGal};
}

function aircraftOperatingProfile(model){
  const fuel=aircraftFuelPerformance(model);
  const turboprop=model.segment.includes('turboprop');
  const widebody=model.segment.includes('widebody');
  const regional=model.segment.includes('Regional jet');
  const mtowTonnes=Math.round(model.seats*(widebody ? .62 : turboprop ? .48 : regional ? .52 : .50)+12);
  const maintenanceReserveHour=Math.round((turboprop?900:widebody?4_800:regional?1_650:2_300)+model.seats*8);
  const insuranceHour=Math.round(280+model.price/250_000);
  return {...fuel,mtowTonnes,maintenanceReserveHour,insuranceHour};
}

function calculateFlightEconomics({from,to,model,distanceKm,duration,pax,fare,ticketRevenue:providedRevenue,fuelGallons,fuelPrice}){
  const profile=aircraftOperatingProfile(model);
  const origin=AIRPORT_COSTS[from],destination=AIRPORT_COSTS[to];
  const hours=duration/HOUR;
  const ticketRevenue=Math.round(providedRevenue??pax*fare);
  const fuel=Math.round(fuelGallons*fuelPrice);
  const landingFees=Math.round(profile.mtowTonnes*destination.landingPerTonne);
  const passengerFees=Math.round(pax*(origin.passengerFee+origin.securityFee));
  const groundHandling=Math.round(origin.handlingBase+destination.handlingBase+pax*(origin.handlingPerPax+destination.handlingPerPax));
  const navigation=Math.round(distanceKm*.72*Math.sqrt(profile.mtowTonnes/50));
  const emissions=Math.round(fuelGallons*FUEL_KG_PER_US_GAL*CO2_KG_PER_KG_FUEL*CARBON_PRICE_EUR_PER_KG);
  const insurance=Math.round(hours*profile.insuranceHour);
  const parking=Math.round(destination.parkingHour*Math.max(1,MIN_TURN_MIN/60));
  const economics={
    ticketRevenue,fuel,landingFees,passengerFees,groundHandling,navigation,emissions,
    maintenanceReserve:0,unscheduledMaintenance:0,insurance,parking
  };
  economics.totalCost=flightEconomicsTotal(economics);
  economics.operatingProfit=ticketRevenue-economics.totalCost;
  return economics;
}

function flightEconomicsTotal(economics){
  return ['fuel','landingFees','passengerFees','groundHandling','navigation','emissions','maintenanceReserve','unscheduledMaintenance','weatherOps','recoveryOps','insurance','parking','legacyOperating']
    .reduce((total,key)=>total+(Number(economics[key])||0),0);
}

function refreshEconomicsTotals(f){
  if(!f.economics) return;
  f.economics.totalCost=flightEconomicsTotal(f.economics);
  f.economics.operatingProfit=(f.economics.ticketRevenue||f.revenue||0)-f.economics.totalCost;
  f.revenue=f.economics.ticketRevenue;
  f.costs=f.economics.totalCost;
}

function flightFuelPlan(from,to,ac){
  const model=MODELS[ac.model];
  const performance=aircraftFuelPerformance(model);
  const duration=flightDurationMs(AIRPORTS[from],AIRPORTS[to],model);
  const tripAndTaxiGal=performance.burnGalPerHour*(duration/HOUR);
  const reserveGal=performance.burnGalPerHour*.75;
  const requiredGal=Math.min(performance.fuelCapacityGal,Math.ceil(tripAndTaxiGal+reserveGal));
  return {...performance,requiredGal,tripBurnGal:Math.ceil(tripAndTaxiGal),reserveGal:Math.ceil(reserveGal)};
}

function updateFuelMarket(t=simNow()){
  const market=state.fuelMarket;
  if(!market) return false;
  const elapsed=Math.floor((t-market.updatedAt)/FUEL_MARKET_STEP);
  if(elapsed<=0) return false;
  const steps=Math.min(elapsed,1000);
  for(let i=0;i<steps;i++){
    const meanPull=(FUEL_MARKET_BASE_EUR_GAL-market.pricePerGallon)*.045;
    const shock=(simulationRandomUnit(`fuel-market:${market.updatedAt}:${i}`)-.5)*.12;
    market.pricePerGallon=clamp(market.pricePerGallon+meanPull+shock,1.55,4.25);
  }
  market.pricePerGallon=Math.round(market.pricePerGallon*100)/100;
  market.updatedAt+=elapsed*FUEL_MARKET_STEP;
  return true;
}

function monthlyPayroll(){
  return Object.entries(state.personnel.assignments||{}).reduce((total,[,roles])=>
    total+Object.entries(PERSONNEL).reduce((airportTotal,[role,config])=>airportTotal+(roles[role]||0)*config.salary,0),0
  );
}

function leaseMonthlyFee(modelName,termMonths){
  const months=clamp(Math.round(Number(termMonths)||60),12,120);
  const monthlyRate=.0105-((months-12)/108)*.003;
  return Math.round(MODELS[modelName].price*monthlyRate/1000)*1000;
}

function processLeasePayments(t=simNow()){
  let changed=false;
  for(const ac of state.aircraft){
    if(ac.acquisitionType!=='lease'||!Number.isFinite(ac.leasePaidThrough)) continue;
    let guard=0;
    while(t>=ac.leasePaidThrough&&guard<240){
      postTransaction(-ac.leaseMonthlyFee,'Aircraft lease',`${ac.tail} monthly lease payment`,ac.id);
      state.stats.leaseCosts+=ac.leaseMonthlyFee;
      ac.leasePaidThrough+=30*DAY;
      guard++; changed=true;
    }
  }
  return changed;
}

function staffAt(airport,role){ return Math.max(0,Math.floor(state.personnel.assignments?.[airport]?.[role]||0)); }
function changeStaff(airport,role,delta){
  if(!state.personnel.assignments[airport]) state.personnel.assignments[airport]={};
  state.personnel.assignments[airport][role]=Math.max(0,staffAt(airport,role)+delta);
}
function qualificationAt(airport,role,family){
  return Math.max(0,Math.floor(state.personnel.qualifications?.[airport]?.[role]?.[family]||0));
}
function qualifiedStaffAt(airport,role,family){
  return qualificationAt(airport,role,'Multi-fleet')+qualificationAt(airport,role,family);
}
function changeQualification(airport,role,family,delta){
  if(!['captains','firstOfficers'].includes(role)) return;
  state.personnel.qualifications??={};
  state.personnel.qualifications[airport]??={};
  state.personnel.qualifications[airport][role]??={};
  const current=qualificationAt(airport,role,family);
  state.personnel.qualifications[airport][role][family]=Math.max(0,current+delta);
}
function qualificationTransferMix(airport,role,amount){
  if(!['captains','firstOfficers'].includes(role)) return {};
  let remaining=amount;
  const mix={};
  const ratings=Object.entries(state.personnel.qualifications?.[airport]?.[role]||{}).sort((a,b)=>b[1]-a[1]);
  for(const [family,count] of ratings){
    const moved=Math.min(remaining,availableQualificationAt(airport,role,family));
    if(moved){ mix[family]=moved; remaining-=moved; }
    if(!remaining) break;
  }
  return remaining?null:mix;
}

function transferOriginDebited(transfer){
  return transfer?.originDebited!==false;
}

function reservedOutboundPersonnelAt(airport,role){
  return (state.personnelTransfers||[]).reduce((sum,transfer)=>{
    if(transfer.status!=='scheduled'||transfer.originDebited!==false||transfer.from!==airport||transfer.role!==role) return sum;
    return sum+Math.max(0,Math.floor(Number(transfer.amount)||0));
  },0);
}

function availableStationStaffAt(airport,role){
  return Math.max(0,staffAt(airport,role)-reservedOutboundPersonnelAt(airport,role));
}

function reservedOutboundQualificationAt(airport,role,family){
  if(!['captains','firstOfficers'].includes(role)||!family) return 0;
  return (state.personnelTransfers||[]).reduce((sum,transfer)=>{
    if(transfer.status!=='scheduled'||transfer.originDebited!==false||transfer.from!==airport||transfer.role!==role) return sum;
    return sum+Math.max(0,Math.floor(Number(transfer.qualifications?.[family])||0));
  },0);
}

function availableQualificationAt(airport,role,family){
  return Math.max(0,qualificationAt(airport,role,family)-reservedOutboundQualificationAt(airport,role,family));
}

function availableQualifiedStationStaffAt(airport,role,family){
  if(!['captains','firstOfficers'].includes(role)) return availableStationStaffAt(airport,role);
  if(family==='Multi-fleet') return availableQualificationAt(airport,role,'Multi-fleet');
  return availableQualificationAt(airport,role,'Multi-fleet')+availableQualificationAt(airport,role,family);
}

function flightPersonnelTransferCount(flightId){
  return (state.personnelTransfers||[]).reduce((total,transfer)=>
    total+(transfer.status!=='cancelled'&&transfer.method==='own'&&transfer.flightId===flightId?transfer.amount:0),0
  );
}

function externalTransferPlan(from,to,amount,t=simNow()){
  const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
  const departure=t+2*HOUR;
  const arrival=departure+(.65+km/800)*HOUR;
  return {km,cost:0,departure,arrival};
}

function restorePersonnelTransferOrigin(transfer){
  if(!transferOriginDebited(transfer)) return false;
  changeStaff(transfer.from,transfer.role,transfer.amount);
  for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(transfer.from,transfer.role,family,count);
  transfer.originDebited=false;
  return true;
}

function cancelPersonnelTransfer(transfer,t=simNow(),reason=''){
  if(transfer.status==='scheduled') restorePersonnelTransferOrigin(transfer);
  transfer.status='cancelled';
  transfer.cancelledAt=t;
  transfer.cancelReason=reason||transfer.cancelReason||'Transfer no longer available';
  return true;
}

function debitPersonnelTransferOrigin(transfer,t=simNow()){
  if(transferOriginDebited(transfer)) return true;
  if(staffAt(transfer.from,transfer.role)<transfer.amount) return false;
  for(const [family,count] of Object.entries(transfer.qualifications||{})){
    if(qualificationAt(transfer.from,transfer.role,family)<count) return false;
  }
  changeStaff(transfer.from,transfer.role,-transfer.amount);
  for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(transfer.from,transfer.role,family,-count);
  transfer.originDebited=true;
  transfer.departedAt=transfer.departure||t;
  return true;
}

function processPersonnelTransfers(t=simNow()){
  let changed=false;
  for(const transfer of state.personnelTransfers||[]){
    if(!['scheduled','in_transit'].includes(transfer.status)) continue;
    if(transfer.method==='own'){
      const flight=state.flights.find(f=>f.id===transfer.flightId&&!f.cancelled);
      if(!flight&&transfer.status==='scheduled'){
        cancelPersonnelTransfer(transfer,t,'Booked flight no longer operates');
        changed=true;
        continue;
      }
      if(flight){
        if(transfer.status==='scheduled') transfer.departure=flightActualDeparture(flight);
        transfer.arrival=flightActualArrival(flight);
      }
    }
    if(transfer.status==='scheduled'&&t>=transfer.departure){
      if(!debitPersonnelTransferOrigin(transfer,t)){
        cancelPersonnelTransfer(transfer,t,'Origin personnel no longer available at departure');
        changed=true;
        continue;
      }
      transfer.status='in_transit';
      logEvent(`${transfer.id}: ${transfer.amount} ${PERSONNEL[transfer.role].label.toLowerCase()} departed ${transfer.from}.`,transfer.departure);
      changed=true;
    }
    if(transfer.status==='in_transit'&&t>=transfer.arrival){
      const flight=transfer.method==='own'&&state.flights.find(f=>f.id===transfer.flightId);
      const arrivalAirport=flight?flightOperationalDestination(flight):transfer.to;
      transfer.actualTo=arrivalAirport;
      changeStaff(arrivalAirport,transfer.role,transfer.amount);
      for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(arrivalAirport,transfer.role,family,count);
      transfer.status='completed'; transfer.completedAt=transfer.arrival; changed=true;
      logEvent(`${transfer.id}: ${transfer.amount} ${PERSONNEL[transfer.role].label.toLowerCase()} arrived at ${arrivalAirport}.`);
    }
  }
  if(changed&&typeof reconcileCrewResourceIncidents==='function'){
    changed=Boolean(reconcileCrewResourceIncidents(t))||changed;
  }
  return changed;
}

function processPersonnelPayroll(t=simNow()){
  const days=Math.floor((t-state.personnel.lastPayrollAt)/DAY);
  if(days<=0) return false;
  const cost=Math.round(monthlyPayroll()/30*days);
  postTransaction(-cost,'Payroll',`${days} day${days===1?'':'s'} of personnel payroll`);
  state.stats.staffCosts+=cost;
  state.personnel.lastPayrollAt+=days*DAY;
  return true;
}

function newState(){
  const real=Date.now();
  const sim=real;
  const s={
    version:VERSION,
    clock:{realBase:real,simBase:sim,speed:1,paused:false,previousSpeed:1},
    cash:0,
    home:'FRA',
    nextAircraft:1,
    nextFlight:1,
    nextService:1,
    nextSlotRight:1,
    nextTransaction:2,
    nextPersonnelTransfer:1,
    nextIncident:1,
    nextResourceRequest:1,
    nextExternalRequest:1,
    nextResourceAssignment:1,
    nextRecoveryCostEvent:1,
    nextPassengerRecovery:1,
    nextCrewRecovery:1,
    rng:{seed:`aoc-${sim}`,counter:0,log:[]},
    incidentExerciseIndex:0,
    slotRights:[],
    aircraft:[],
    flights:[],
    services:[],
    incidents:[],
    incidentTransitions:[],
    flightHistory:[],
    coordinationTasks:[],
    externalRequests:[],
    resourceAssignments:[],
    crewDuties:[],
    warningRegistry:{},
    transactions:[],
    personnelTransfers:[],
    resourceRequests:[],
    recoveryCostEvents:[],
    passengerRecoveries:[],
    crewRecoveries:[],
    fuelMarket:{pricePerGallon:FUEL_MARKET_BASE_EUR_GAL,updatedAt:sim},
    personnel:{assignments:{},lastPayrollAt:sim},
    ops:{automaticDisruptions:true,caseLinksRepaired:true,phaseRealismRepaired:true},
    management:{cycleStart:sim,reviews:[]},
    stats:{revenue:0,costs:0,staffCosts:0,leaseCosts:0,transferCosts:0,recoveryCosts:0,cancellationCosts:0,passengerRecoveryCosts:0,crewRecoveryCosts:0,scheduledMaintenanceCosts:0,cancelled:0,pax:0,completed:0},
  };
return s;
}

function migrateState(parsed){
  if(!parsed || parsed.version!==VERSION) return newState();
  if(!Array.isArray(parsed.services)) parsed.services=[];
  if(!Array.isArray(parsed.flights)) parsed.flights=[];
  if(!Array.isArray(parsed.aircraft)) parsed.aircraft=[];
  if(!Array.isArray(parsed.slotRights)) parsed.slotRights=[];
  if(!Array.isArray(parsed.incidents)) parsed.incidents=[];
  if(!Array.isArray(parsed.incidentTransitions)) parsed.incidentTransitions=[];
  if(!Array.isArray(parsed.flightHistory)) parsed.flightHistory=[];
  parsed.flightHistory=parsed.flightHistory.filter(item=>item&&item.id);
  if(!Array.isArray(parsed.coordinationTasks)) parsed.coordinationTasks=[];
  if(!parsed.clock || typeof parsed.clock!=='object') parsed.clock={realBase:Date.now(),simBase:Date.now(),speed:1};
  if(!Number.isFinite(parsed.clock.realBase)) parsed.clock.realBase=Date.now();
  if(!Number.isFinite(parsed.clock.simBase)) parsed.clock.simBase=Date.now();
  if(!Number.isFinite(parsed.clock.speed)) parsed.clock.speed=1;
  const wasPaused=parsed.clock.paused===true||parsed.clock.speed===0;
  parsed.clock.previousSpeed=normalizedClockSpeed(parsed.clock.previousSpeed,parsed.clock.speed>0?parsed.clock.speed:1);
  parsed.clock.speed=wasPaused?0:normalizedClockSpeed(parsed.clock.speed,parsed.clock.previousSpeed);
  parsed.clock.paused=wasPaused;
  const removedIncidentIds=new Set(parsed.incidents.filter(incident=>incident.type==='connection_risk').map(incident=>incident.id));
  if(removedIncidentIds.size){
    parsed.incidents=parsed.incidents.filter(incident=>!removedIncidentIds.has(incident.id));
    parsed.coordinationTasks=parsed.coordinationTasks.filter(task=>!removedIncidentIds.has(task.incidentId));
  }
  for(const incident of parsed.incidents){
    if(Array.isArray(incident.impacts)) incident.impacts=incident.impacts.filter(impact=>impact.type!=='connection_risk');
  }
  if(!Array.isArray(parsed.externalRequests)) parsed.externalRequests=[];
  if(!Array.isArray(parsed.resourceAssignments)) parsed.resourceAssignments=[];
  if(!Array.isArray(parsed.crewDuties)) parsed.crewDuties=[];
  if(!parsed.warningRegistry || typeof parsed.warningRegistry!=='object') parsed.warningRegistry=parsed.operationalWarningRegistry&&typeof parsed.operationalWarningRegistry==='object'?parsed.operationalWarningRegistry:{};
  if(!Number.isFinite(parsed.nextExternalRequest)) parsed.nextExternalRequest=parsed.externalRequests.length+1;
  if(!Number.isFinite(parsed.nextResourceAssignment)) parsed.nextResourceAssignment=parsed.resourceAssignments.length+1;
  if(!Array.isArray(parsed.resourceRequests)) parsed.resourceRequests=[];
  if(!Array.isArray(parsed.recoveryCostEvents)) parsed.recoveryCostEvents=[];
  if(!Array.isArray(parsed.passengerRecoveries)) parsed.passengerRecoveries=[];
  if(!Array.isArray(parsed.crewRecoveries)) parsed.crewRecoveries=[];
  if(!Number.isFinite(parsed.nextResourceRequest)) parsed.nextResourceRequest=parsed.resourceRequests.length+1;
  if(!Number.isFinite(parsed.nextRecoveryCostEvent)) parsed.nextRecoveryCostEvent=parsed.recoveryCostEvents.length+1;
  if(!Number.isFinite(parsed.nextPassengerRecovery)) parsed.nextPassengerRecovery=parsed.passengerRecoveries.length+1;
  if(!Number.isFinite(parsed.nextCrewRecovery)) parsed.nextCrewRecovery=parsed.crewRecoveries.length+1;
  if(!parsed.rng || typeof parsed.rng!=='object') parsed.rng={seed:`aoc-${parsed.clock?.simBase||Date.now()}`,counter:0,log:[]};
  if(!parsed.rng.seed) parsed.rng.seed=`aoc-${parsed.clock?.simBase||Date.now()}`;
  if(!Number.isFinite(parsed.rng.counter)) parsed.rng.counter=0;
  if(!Array.isArray(parsed.rng.log)) parsed.rng.log=[];
  if(parsed.rng.log.length>80) parsed.rng.log=parsed.rng.log.slice(-80);
  if(!Number.isFinite(parsed.nextIncident)) parsed.nextIncident=parsed.incidents.length+1;
  if(!Number.isFinite(parsed.incidentExerciseIndex)) parsed.incidentExerciseIndex=0;
  for(const incident of parsed.incidents){
    if(!incident.status) incident.status=incident.resolvedAt?'resolved':'open';
    if(!Number.isFinite(incident.detectedAt)) incident.detectedAt=parsed.clock?.simBase||Date.now();
    if(!Number.isFinite(incident.deadline)) incident.deadline=incident.detectedAt+30*MIN;
    if(incident.blocking===undefined) incident.blocking=incident.status==='open';
    if(incident.training===undefined) incident.training=false;
    if(incident.selectedAction===undefined) incident.selectedAction='';
    if(incident.outcome===undefined) incident.outcome='';
    if(incident.technicalContext===undefined) incident.technicalContext=null;
    if(incident.classification===undefined) incident.classification='incident';
    if(incident.workflowCreatedAt===undefined) incident.workflowCreatedAt=0;
    if(incident.overdue===undefined) incident.overdue=false;
    if(incident.defaultApplied===undefined) incident.defaultApplied=false;
    if(!Number.isFinite(incident.defaultAppliedAt)) incident.defaultAppliedAt=0;
    if(incident.defaultPolicy===undefined) incident.defaultPolicy='';
    if(incident.defaultOutcome===undefined) incident.defaultOutcome='';
    if(incident.affectedRole===undefined) incident.affectedRole=incident.type==='crew_sick'?'captains':'';
    if(incident.recoveryPlan===undefined) incident.recoveryPlan='';
    if(!Number.isFinite(incident.recoveryPlanAt)) incident.recoveryPlanAt=0;
    if(incident.source===undefined) incident.source=incident.training?'training':'legacy';
    if(incident.sourceKey===undefined) incident.sourceKey='';
    if(incident.context===undefined) incident.context=null;
    if(!Number.isFinite(incident.lastDetectedAt)) incident.lastDetectedAt=incident.detectedAt;
    if(!Array.isArray(incident.impacts)) incident.impacts=[];
    if(!incident.caseId) incident.caseId=incident.id;
    if(!incident.rootIncidentId) incident.rootIncidentId=incident.id;
    if(incident.triggeredByIncidentId===undefined) incident.triggeredByIncidentId='';
    if(incident.chainReason===undefined) incident.chainReason='';
  }
  for(const task of parsed.coordinationTasks){
    if(task.branch===undefined) task.branch='';
    if(task.strategies===undefined) task.strategies=null;
    if(task.required===undefined) task.required=true;
    if(task.action===undefined) task.action='';
    if(task.strategyOptions===undefined) task.strategyOptions=null;
  }
  if(!Array.isArray(parsed.transactions)){
    parsed.transactions=[{id:'TX1',timestamp:parsed.clock?.simBase||Date.now(),amount:parsed.cash||0,category:'Opening',description:'Balance brought forward from existing save',balanceAfter:parsed.cash||0}];
  }
  if(!Number.isFinite(parsed.nextTransaction)) parsed.nextTransaction=parsed.transactions.length+1;
  for(const recovery of parsed.passengerRecoveries){
    if(!recovery.id) recovery.id=`PR${parsed.nextPassengerRecovery++}`;
    if(recovery.action===undefined) recovery.action='rebooking';
    if(recovery.status===undefined) recovery.status=recovery.completedAt?'confirmed':'requested';
    if(!Number.isFinite(recovery.requestedAt)) recovery.requestedAt=parsed.clock?.simBase||Date.now();
    if(!Number.isFinite(recovery.updatedAt)) recovery.updatedAt=recovery.requestedAt;
    if(!Number.isFinite(recovery.confirmsAt)) recovery.confirmsAt=recovery.updatedAt;
    if(!Number.isFinite(recovery.completedAt)) recovery.completedAt=0;
    if(!Number.isFinite(recovery.amount)) recovery.amount=0;
    if(!Number.isFinite(recovery.passengers)) recovery.passengers=0;
    if(recovery.reason===undefined) recovery.reason='';
    if(recovery.costEventId===undefined) recovery.costEventId='';
  }
  for(const recovery of parsed.crewRecoveries){
    if(!recovery.id) recovery.id=`CR${parsed.nextCrewRecovery++}`;
    if(recovery.action===undefined) recovery.action='hotel';
    if(recovery.status===undefined) recovery.status=recovery.completedAt?'confirmed':'requested';
    if(!Number.isFinite(recovery.requestedAt)) recovery.requestedAt=parsed.clock?.simBase||Date.now();
    if(!Number.isFinite(recovery.updatedAt)) recovery.updatedAt=recovery.requestedAt;
    if(!Number.isFinite(recovery.confirmsAt)) recovery.confirmsAt=recovery.updatedAt;
    if(!Number.isFinite(recovery.completedAt)) recovery.completedAt=0;
    if(!Number.isFinite(recovery.availableAt)) recovery.availableAt=recovery.completedAt||recovery.confirmsAt||recovery.updatedAt;
    if(recovery.availableAirport===undefined) recovery.availableAirport=recovery.releaseAirport||'';
    if(recovery.availabilityStatus===undefined) recovery.availabilityStatus=(recovery.status==='confirmed'&&recovery.availableAt<=(parsed.clock?.simBase||Date.now()))?'available':'pending';
    if(recovery.availabilityDetail===undefined) recovery.availabilityDetail='';
    if(!Number.isFinite(recovery.amount)) recovery.amount=0;
    if(!Number.isFinite(recovery.crew)) recovery.crew=0;
    if(!recovery.roles) recovery.roles={captains:1,firstOfficers:1,cabinCrew:Math.max(0,recovery.crew-2)};
    for(const role of ['captains','firstOfficers','cabinCrew']) recovery.roles[role]=Math.max(0,Math.floor(Number(recovery.roles[role])||0));
    if(recovery.family===undefined) recovery.family='Multi-fleet';
    if(recovery.releaseAirport===undefined) recovery.releaseAirport='';
    if(recovery.plannedReleaseAirport===undefined) recovery.plannedReleaseAirport='';
    if(recovery.reason===undefined) recovery.reason='';
    if(recovery.costEventId===undefined) recovery.costEventId='';
  }
  if(!Array.isArray(parsed.personnelTransfers)) parsed.personnelTransfers=[];
  for(const transfer of parsed.personnelTransfers){
    if(!transfer.qualifications&&transfer.qualification) transfer.qualifications={[transfer.qualification]:transfer.amount||1};
  }
  if(!Number.isFinite(parsed.nextPersonnelTransfer)) parsed.nextPersonnelTransfer=1;
  if(!parsed.fuelMarket || !Number.isFinite(parsed.fuelMarket.pricePerGallon))
    parsed.fuelMarket={pricePerGallon:FUEL_MARKET_BASE_EUR_GAL,updatedAt:parsed.clock?.simBase||Date.now()};
  if(!Number.isFinite(parsed.fuelMarket.updatedAt)) parsed.fuelMarket.updatedAt=parsed.clock?.simBase||Date.now();
  if(!parsed.stats) parsed.stats={revenue:0,costs:0,pax:0,completed:0};
  if(!parsed.personnel) parsed.personnel={};
  if(!parsed.personnel.assignments){
    const homeRoles={};
    for(const role of Object.keys(PERSONNEL)) homeRoles[role]=Math.max(0,Math.floor(Number(parsed.personnel[role])||0));
    parsed.personnel.assignments={[parsed.home||'FRA']:homeRoles};
  }
  for(const roles of Object.values(parsed.personnel.assignments))
    for(const role of Object.keys(PERSONNEL)) roles[role]=Math.max(0,Math.floor(Number(roles[role])||0));
  if(!parsed.personnel.qualifications){
    parsed.personnel.qualifications={};
    for(const [airport,roles] of Object.entries(parsed.personnel.assignments)){
      parsed.personnel.qualifications[airport]={
        captains:{'Multi-fleet':Math.max(0,Math.floor(Number(roles.captains)||0))},
        firstOfficers:{'Multi-fleet':Math.max(0,Math.floor(Number(roles.firstOfficers)||0))}
      };
    }
  }
  if(!Number.isFinite(parsed.personnel.lastPayrollAt)) parsed.personnel.lastPayrollAt=parsed.clock?.simBase||Date.now();
  if(!Number.isFinite(parsed.stats.staffCosts)) parsed.stats.staffCosts=0;
  if(!Number.isFinite(parsed.stats.leaseCosts)) parsed.stats.leaseCosts=0;
  if(!Number.isFinite(parsed.stats.transferCosts)) parsed.stats.transferCosts=0;
  if(!Number.isFinite(parsed.stats.recoveryCosts)) parsed.stats.recoveryCosts=parsed.recoveryCostEvents.reduce((sum,item)=>sum+(Number(item.amount)||0),0);
  if(!Number.isFinite(parsed.stats.passengerRecoveryCosts)) parsed.stats.passengerRecoveryCosts=parsed.recoveryCostEvents.filter(item=>item.category==='passenger').reduce((sum,item)=>sum+(Number(item.amount)||0),0);
  if(!Number.isFinite(parsed.stats.crewRecoveryCosts)) parsed.stats.crewRecoveryCosts=parsed.recoveryCostEvents.filter(item=>item.category==='crew').reduce((sum,item)=>sum+(Number(item.amount)||0),0);
  if(!Number.isFinite(parsed.nextSlotRight)) parsed.nextSlotRight=1;
  if(!parsed.ops) parsed.ops={automaticDisruptions:true};
  parsed.ops.automaticDisruptions=true;
  if(parsed.ops.caseLinksRepaired===undefined) parsed.ops.caseLinksRepaired=false;
  if(parsed.ops.phaseRealismRepaired===undefined) parsed.ops.phaseRealismRepaired=false;
  for(const ac of parsed.aircraft){
    if(!ac.acquisitionType) ac.acquisitionType='requested';
    if(ac.acquisitionType!=='requested'){
      ac.resourceSource=ac.resourceSource||'legacy save';
      ac.acquisitionType='requested';
    }
    if(!Number.isFinite(ac.acquiredAt)) ac.acquiredAt=parsed.clock?.simBase||Date.now();
    if(ac.defectUntil===undefined) ac.defectUntil=0;
    if(ac.defectReason===undefined) ac.defectReason='';
    if(!Number.isFinite(ac.condition)) ac.condition=100;
    if(!Number.isFinite(ac.flightHours)) ac.flightHours=0;
    if(!Number.isFinite(ac.cycles)) ac.cycles=0;
    if(!Number.isFinite(ac.fuelGallons)) ac.fuelGallons=0;
    if(!Number.isFinite(ac.issueAcknowledgedAt)) ac.issueAcknowledgedAt=0;
    if(ac.issueAcknowledgedKey===undefined) ac.issueAcknowledgedKey='';
    if(!Array.isArray(ac.melItems)) ac.melItems=[];
    if(!ac.cabin) ac.cabin=defaultCabin(ac.model);
  }
  for(const f of parsed.flights){
    for(const k of ['handlingDelayMin','technicalDelayMin','staffingDelayMin','incidentDelayMin','enrouteDelayMin','enrouteRecoveryMin','enrouteRecoveryCost','enrouteRecoveryFuelPenaltyGal','liveWeatherDelayMin','propagatedDelayMin','slotDelayMin','turnaroundRecoveryMin','slotPriorityMin','nightRestrictionDelayMin','nightRestrictionConflictDelayMin','taxiOutDelayMin','taxiInDelayMin','deicingCompletedAt','deicingHoldoverUntil','nightRecoveryApprovedAt'])
      if(f[k]===undefined) f[k]=0;
    if(f.enrouteRecoveryPlan===undefined) f.enrouteRecoveryPlan='';
    if(f.enrouteRecoveryCause===undefined) f.enrouteRecoveryCause='';
    if(!f.enrouteRecoveryRequest || typeof f.enrouteRecoveryRequest!=='object') f.enrouteRecoveryRequest=null;
    if(!Array.isArray(f.taxiDelayCauses)) f.taxiDelayCauses=[];
    for(const k of ['airportDelayMin','airspaceDelayMin']) if(f[k]===undefined) f[k]=0;
    if(f.nightRestrictionLabel===undefined) f.nightRestrictionLabel='';
    if(f.nightRestrictionConflictLabel===undefined) f.nightRestrictionConflictLabel='';
    if(f.nightRecoveryDecision===undefined) f.nightRecoveryDecision='';
    if(f.nightRecoverySourceKey===undefined) f.nightRecoverySourceKey='';
    if(f.arrivalCurfewCoordinatedKey===undefined) f.arrivalCurfewCoordinatedKey='';
    if(f.arrivalCurfewCoordinatedAt===undefined) f.arrivalCurfewCoordinatedAt=0;
    if(f.constraintChecked===undefined) f.constraintChecked=Boolean(f.departureLogged);
    if(f.airportConstraintLabel===undefined) f.airportConstraintLabel='';
    if(f.airspaceConstraintLabel===undefined) f.airspaceConstraintLabel='';
    if(f.connectionPax===undefined) f.connectionPax=0;
    if(f.connectionCriticalPax===undefined) f.connectionCriticalPax=0;
    if(f.connectionAtRiskPax===undefined) f.connectionAtRiskPax=0;
    if(f.connectionMissedPax===undefined) f.connectionMissedPax=0;
    if(!Number.isFinite(f.passengerAccommodationArrangedAt)) f.passengerAccommodationArrangedAt=0;
    if(!Number.isFinite(f.passengerRecoveryArrangedAt)) f.passengerRecoveryArrangedAt=0;
    if(!Number.isFinite(f.passengerReleasedAt)) f.passengerReleasedAt=0;
    if(!Number.isFinite(f.crewAccommodationArrangedAt)) f.crewAccommodationArrangedAt=0;
    if(!Number.isFinite(f.crewTransportArrangedAt)) f.crewTransportArrangedAt=0;
    if(!Number.isFinite(f.crewStoodDownAt)) f.crewStoodDownAt=0;
    if(!Number.isFinite(f.recoveryCostBooked)) f.recoveryCostBooked=0;
    if(f.cancellationCostBooked===undefined) f.cancellationCostBooked='';
    if(f.cancellationReason===undefined) f.cancellationReason='';
    if(f.crewAugmented===undefined) f.crewAugmented=false;
    if(f.crewAugmentationPlanned===undefined) f.crewAugmentationPlanned=false;
    if(f.crewAugmentationReason===undefined) f.crewAugmentationReason='';
    if(f.crewDutyId===undefined) f.crewDutyId='';
    if(f.crewDutySplit===undefined) f.crewDutySplit=false;
    if(!Number.isFinite(f.crewSwappedAt)) f.crewSwappedAt=0;
    if(!f.crewRoleSwaps || typeof f.crewRoleSwaps!=='object') f.crewRoleSwaps={};
    if(!f.incidentChecks || typeof f.incidentChecks!=='object') f.incidentChecks={};
    if(f.staffingBlocked===undefined) f.staffingBlocked=false;
    if(f.staffingShortage===undefined) f.staffingShortage='';
    if(f.handlingDelayCause===undefined) f.handlingDelayCause='';
    if(f.slotMissed===undefined) f.slotMissed=false;
    if(f.opsChecked===undefined) f.opsChecked=Boolean(f.departureLogged);
    if(f.enrouteChecked===undefined) f.enrouteChecked=Boolean(f.departureLogged);
    if(!f.weatherLiveChecks || typeof f.weatherLiveChecks!=='object') f.weatherLiveChecks={};
    if(f.weatherRouteHazard===undefined) f.weatherRouteHazard='';
    if(f.weatherCause===undefined) f.weatherCause=null;
    if(!f.routePlan || typeof f.routePlan!=='object') f.routePlan=null;
    if(!f.diversionHandlingPlan || typeof f.diversionHandlingPlan!=='object') f.diversionHandlingPlan=null;
    if(f.slotLogged===undefined) f.slotLogged=false;
    if(f.baseCosts===undefined) f.baseCosts=f.costs||0;
    if(f.fueled===undefined) f.fueled=Boolean(f.settled||f.departureLogged);
    if(f.fuelGallons===undefined) f.fuelGallons=0;
    if(f.fuelPurchasedGallons===undefined) f.fuelPurchasedGallons=f.fuelGallons||0;
    if(f.tripFuelGallons===undefined) f.tripFuelGallons=0;
    if(f.fuelRequiredGallons===undefined) f.fuelRequiredGallons=0;
    if(f.fuelCost===undefined) f.fuelCost=0;
    if(f.fuelPricePerGallon===undefined) f.fuelPricePerGallon=0;
    if(f.maintenanceCost===undefined) f.maintenanceCost=0;
    if(f.weatherCost===undefined) f.weatherCost=0;
    if(f.defectSeverity===undefined) f.defectSeverity='';
    if(!f.fares) f.fares=normalizeFares(f.fare);
    if(!f.classPax) f.classPax={economy:f.pax||0,business:0,first:0};
    if(!f.classLoads) f.classLoads={economy:f.load||0,business:0,first:0};
    if(!f.economics){
      f.economics={ticketRevenue:f.revenue||0,fuel:f.fuelCost||0,legacyOperating:f.baseCosts||0,unscheduledMaintenance:f.maintenanceCost||0};
      refreshEconomicsTotals(f);
    }
  }

  Management.ensureState(parsed,parsed.clock?.simBase||Date.now());

  // Existing recurring services get zero-cost grandfathered slot rights.
  for(const svc of parsed.services){
    if(!svc.active) continue;
    if(!svc.fares) svc.fares=normalizeFares(svc.fare);
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

const SPLIT_KEY='aerosim_center_split_pct';
const LEFT_SIDEBAR_SPLIT_KEY='aerosim_left_sidebar_width';
const RIGHT_SIDEBAR_SPLIT_KEY='aerosim_right_sidebar_width';
const WORKSPACE_UI_KEY='aerosim_occ_ui_v1';
const WORKSPACE_WIDGETS={
  'context-workbench':{views:['occ'],defaultOpen:true},
  'dispatch-control':{views:['occ'],defaultOpen:false},
  'crew-control':{views:['occ'],defaultOpen:false},
  'maintenance-control':{views:['occ'],defaultOpen:false},
  'station-operations':{views:['occ'],defaultOpen:false},
  'flight-operations':{views:['occ'],defaultOpen:true},
  'flight-planning':{views:['occ'],defaultOpen:false},
  'my-aircraft':{views:['occ'],defaultOpen:true},
  'management-cycle':{views:['occ'],defaultOpen:false},
  'network-support':{views:['occ'],defaultOpen:false},
  weather:{views:['occ'],defaultOpen:false},
  'personnel-relocation':{views:['occ'],defaultOpen:false}
};
function loadWorkspaceUi(){
  try{
    const parsed=JSON.parse(localStorage.getItem(WORKSPACE_UI_KEY)||'{}');
    return {
      activeView:'occ',
      collapsed:parsed.collapsed||{occ:{}},
      scheduleRanges:{occ:Number(parsed.scheduleRanges?.occ)||24},
      nextDeskPanels:parsed.nextDeskPanels||{},
      dismissedWarnings:parsed.dismissedWarnings||{},
      incidentFilter:parsed.incidentFilter||'actionable'
    };
  }catch(_){
    return {
      activeView:'occ',
      collapsed:{occ:{}},
      scheduleRanges:{occ:24},
      nextDeskPanels:{},
      dismissedWarnings:{},
      incidentFilter:'actionable'
    };
  }
}
let workspaceUi=loadWorkspaceUi();
let activeWorkspaceView=workspaceUi.activeView;
let restoreSidebarWidthsForView=()=>{};
let restoreCenterSplitForView=()=>{};
let scheduleWindowOffsetHours=-2;
let scheduleRangeHours=24;
let lastScheduleSignature='';
let lastScheduleConnectionOverlaySignature='';
let lastScheduleRenderAt=0;
let aircraftSelectSignature='';
let occSignature='';
let managementSignature='';
let maintenanceSignature='';
let weatherSignature='';
function postTransaction(amount,category,description,reference=''){
  return null;
}

function simNow(){
  return state.clock.simBase + (Date.now()-state.clock.realBase)*state.clock.speed;
}
function normalizedClockSpeed(value,fallback=1){
  const speed=Number(value);
  if(SUPPORTED_SIMULATION_SPEEDS.includes(speed)) return speed;
  const fallbackSpeed=Number(fallback);
  return SUPPORTED_SIMULATION_SPEEDS.includes(fallbackSpeed)?fallbackSpeed:1;
}
function rebaseClock(newSpeed){
  const now=simNow();
  const speed=normalizedClockSpeed(newSpeed,state.clock?.previousSpeed||1);
  state.clock={...state.clock,realBase:Date.now(),simBase:now,speed,paused:false,previousSpeed:speed};
  save();
}
function setSimulationPaused(paused){
  const now=simNow();
  if(paused){
    const previousSpeed=normalizedClockSpeed(state.clock?.speed,state.clock?.previousSpeed||1);
    state.clock={...state.clock,realBase:Date.now(),simBase:now,speed:0,paused:true,previousSpeed};
  }else{
    const speed=normalizedClockSpeed(state.clock?.previousSpeed,state.clock?.speed||1);
    state.clock={...state.clock,realBase:Date.now(),simBase:now,speed,paused:false,previousSpeed:speed};
  }
  save();
  return state.clock;
}
function toggleSimulationPause(){
  return setSimulationPaused(!simulationIsPaused());
}
function simulationIsPaused(){
  return Boolean(state.clock?.paused||state.clock?.speed===0);
}
function traceIncidentTransition(incident,event,details={}){
  if(!incident) return null;
  state.incidentTransitions??=[];
  const now=simNow();
  const entry={
    at:now,realAt:Date.now(),event,
    incidentId:incident.id,type:incident.type,flightId:incident.flightId||'',
    source:incident.source||'',sourceKey:incident.sourceKey||'',
    status:incident.status||'',selectedAction:incident.selectedAction||'',
    details
  };
  state.incidentTransitions.push(entry);
  if(state.incidentTransitions.length>80) state.incidentTransitions.splice(0,state.incidentTransitions.length-80);
  return entry;
}
function recentIncidentTransitions(limit=10){
  return (state.incidentTransitions||[]).slice(-Math.max(1,limit));
}
function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }

function setResetControlsDisabled(disabled){
  document.querySelectorAll('#resetBtn,#resetTopbarBtn').forEach(button=>{ button.disabled=disabled; });
}
function setResetStatus(message){
  const resetStatus=document.getElementById('resetStatus');
  if(resetStatus) resetStatus.textContent=message;
}
function resetLocalSave(){
  setResetControlsDisabled(true);
  setResetStatus('Resetting local airline data…');
  const blank=newState();
  try{
    // Write the replacement immediately so the periodic save and beforeunload
    // handlers can only persist the new blank state from this point onward.
    state=blank;
    localStorage.setItem(SAVE_KEY,JSON.stringify(blank));
    localStorage.removeItem(WORKSPACE_UI_KEY);
    localStorage.removeItem(SPLIT_KEY);
    localStorage.removeItem(`${SPLIT_KEY}_occ`);
    localStorage.removeItem(`${SPLIT_KEY}_management`);
    localStorage.removeItem(LEFT_SIDEBAR_SPLIT_KEY);
    localStorage.removeItem(RIGHT_SIDEBAR_SPLIT_KEY);
    localStorage.removeItem('aerosim_next_center_split_pct');
    workspaceUi=loadWorkspaceUi();
  }catch(error){
    console.error('AeroSim reset failed',error);
    setResetControlsDisabled(false);
    setResetStatus('Reset failed because browser storage is unavailable.');
    toast('Reset failed: browser storage is unavailable.');
    return;
  }

  try{
    selectedAircraftId=null;
    selectedFlightId=null;
    scheduleWindowOffsetHours=-2;
    lastScheduleSignature='';
    lastScheduleRenderAt=0;
    aircraftSelectSignature='';
    routeSignature='';

    document.getElementById('speed').value='1';
    if(typeof refreshPauseControl==='function') refreshPauseControl();
    aircraftMarkers.clear();
    aircraftLayer.clearLayers();
    routeLayer.clearLayers();
    refreshAll();
    if(typeof centerMapOnHomeBase==='function') centerMapOnHomeBase({animate:false});
    else{
      const airport=AIRPORTS[state.home]||AIRPORTS.FRA||Object.values(AIRPORTS)[0];
      if(airport) map.setView([airport.lat,airport.lon],5,{animate:false});
    }
  }catch(error){
    // The blank state is already safely stored. A reload is the most reliable
    // recovery if any stale renderer fails while clearing the old UI.
    console.error('AeroSim reset render failed; reloading blank save',error);
    setResetStatus('Data cleared. Reloading the blank airline…');
    window.location.reload();
    return;
  }

  try{
    const persisted=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(!persisted || persisted.aircraft.length || persisted.flights.length || persisted.services.length || persisted.slotRights.length){
      throw new Error('Blank state verification failed');
    }
  }catch(error){
    console.error('AeroSim reset verification failed',error);
    setResetControlsDisabled(false);
    setResetStatus('Reset could not be verified.');
    toast('Reset could not be verified. Reload and try again.');
    return;
  }
  setResetControlsDisabled(false);
  setResetStatus('Reset complete · 0 aircraft · 0 flights · 0 slot rights');
  toast('Local save reset. Your airline is empty.');
}
