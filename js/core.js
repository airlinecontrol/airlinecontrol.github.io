/* AeroSim catalogs, shared utilities, state migration, and local persistence. */

const VERSION = 6;
const SAVE_KEY = 'aerosim_mvp_v6';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const Management = window.AeroManagement;

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

// Local synthetic market profiles, normalized to 0–1. They describe the metropolitan market,
// not live airport statistics, and keep demand explainable and deterministic offline.
const AIRPORT_MARKETS = {
  FRA:{size:.92,business:.94,tourism:.62,wealth:.86,hub:.98,region:'Europe',season:'summer'},
  LHR:{size:1.00,business:.98,tourism:.82,wealth:.92,hub:.96,region:'Europe',season:'summer'},
  JFK:{size:1.00,business:.94,tourism:.90,wealth:.92,hub:.91,region:'North America',season:'summer'},
  MAD:{size:.78,business:.68,tourism:.91,wealth:.73,hub:.68,region:'Europe',season:'summer'},
  AMS:{size:.82,business:.87,tourism:.84,wealth:.87,hub:.84,region:'Europe',season:'summer'},
  CDG:{size:.96,business:.90,tourism:.97,wealth:.86,hub:.92,region:'Europe',season:'summer'},
  FCO:{size:.76,business:.58,tourism:1.00,wealth:.72,hub:.58,region:'Europe',season:'summer'},
  DXB:{size:.93,business:.90,tourism:.96,wealth:.91,hub:1.00,region:'Middle East',season:'winter'},
  SIN:{size:.89,business:.97,tourism:.86,wealth:.96,hub:.97,region:'Asia',season:'winter'},
  HND:{size:1.00,business:1.00,tourism:.84,wealth:.96,hub:.94,region:'Asia',season:'spring'}
};

const AIRPORT_OPS = {
  FRA:{slotIntervalMin:15,graceMin:10}, LHR:{slotIntervalMin:10,graceMin:8},
  JFK:{slotIntervalMin:15,graceMin:10}, MAD:{slotIntervalMin:15,graceMin:10},
  AMS:{slotIntervalMin:10,graceMin:8}, CDG:{slotIntervalMin:10,graceMin:8},
  FCO:{slotIntervalMin:15,graceMin:10}, DXB:{slotIntervalMin:15,graceMin:10},
  SIN:{slotIntervalMin:10,graceMin:8}, HND:{slotIntervalMin:10,graceMin:8}
};
const MIN_TURN_MIN = 35;
const FUEL_MARKET_STEP = 6 * HOUR;
const FUEL_MARKET_BASE_EUR_GAL = 2.45;
const PERSONNEL = {
  captains:{label:'Captains',salary:11_500},
  firstOfficers:{label:'First officers',salary:7_500},
  cabinCrew:{label:'Cabin crew',salary:3_500},
  groundHandling:{label:'Ground handling',salary:3_200},
  operations:{label:'Operations & dispatch',salary:4_800},
  customerService:{label:'Customer service',salary:3_600}
};
const FUEL_KG_PER_US_GAL = 3.04;
const CO2_KG_PER_KG_FUEL = 3.16;
const CARBON_PRICE_EUR_PER_KG = .085;

const AIRPORT_COSTS = {
  FRA:{landingPerTonne:12.5,passengerFee:25,securityFee:7,handlingBase:2200,handlingPerPax:7,parkingHour:180},
  LHR:{landingPerTonne:18,passengerFee:38,securityFee:10,handlingBase:3200,handlingPerPax:10,parkingHour:320},
  JFK:{landingPerTonne:15,passengerFee:31,securityFee:11,handlingBase:3000,handlingPerPax:10,parkingHour:260},
  MAD:{landingPerTonne:9,passengerFee:18,securityFee:6,handlingBase:1700,handlingPerPax:6,parkingHour:130},
  AMS:{landingPerTonne:15,passengerFee:29,securityFee:9,handlingBase:2600,handlingPerPax:9,parkingHour:230},
  CDG:{landingPerTonne:14,passengerFee:27,securityFee:9,handlingBase:2500,handlingPerPax:9,parkingHour:220},
  FCO:{landingPerTonne:9,passengerFee:20,securityFee:6,handlingBase:1800,handlingPerPax:6,parkingHour:140},
  DXB:{landingPerTonne:11,passengerFee:23,securityFee:7,handlingBase:2300,handlingPerPax:8,parkingHour:180},
  SIN:{landingPerTonne:12,passengerFee:24,securityFee:7,handlingBase:2300,handlingPerPax:8,parkingHour:190},
  HND:{landingPerTonne:16,passengerFee:30,securityFee:9,handlingBase:2800,handlingPerPax:9,parkingHour:250}
};

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
  'ATR 42-600':{manufacturer:'ATR',segment:'Regional turboprop',seats:48,speedKmh:535,maxRangeKm:1345,price:18_000_000,costPerKm:2.6},
  'ATR 72-600':{manufacturer:'ATR',segment:'Regional turboprop',seats:72,speedKmh:500,maxRangeKm:1370,price:24_000_000,costPerKm:3.2},

  'E170':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:72,speedKmh:870,maxRangeKm:3982,price:18_000_000,costPerKm:4.7},
  'E175':{manufacturer:'Embraer',segment:'Regional jet',seats:78,speedKmh:870,maxRangeKm:4074,price:32_000_000,costPerKm:4.9},
  'E190':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:100,speedKmh:870,maxRangeKm:4537,price:24_000_000,costPerKm:5.3},
  'E195':{manufacturer:'Embraer',segment:'Regional jet · used market',seats:116,speedKmh:870,maxRangeKm:4260,price:27_000_000,costPerKm:5.7},
  'E190-E2':{manufacturer:'Embraer',segment:'Regional jet',seats:106,speedKmh:870,maxRangeKm:5278,price:42_000_000,costPerKm:5.4},
  'E195-E2':{manufacturer:'Embraer',segment:'Regional jet',seats:132,speedKmh:870,maxRangeKm:4537,price:45_000_000,costPerKm:5.9},

  'CRJ200':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:50,speedKmh:785,maxRangeKm:3045,price:7_000_000,costPerKm:4.1},
  'CRJ700':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:70,speedKmh:829,maxRangeKm:2553,price:12_000_000,costPerKm:4.7},
  'CRJ900':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:90,speedKmh:829,maxRangeKm:2871,price:16_000_000,costPerKm:5.2},
  'CRJ1000':{manufacturer:'Canadair / MHI RJ',segment:'Regional jet · used market',seats:100,speedKmh:829,maxRangeKm:2761,price:18_000_000,costPerKm:5.5},

  'A220-100':{manufacturer:'Airbus',segment:'Small narrowbody',seats:110,speedKmh:870,maxRangeKm:6670,price:44_000_000,costPerKm:5.8},
  'A220-300':{manufacturer:'Airbus',segment:'Small narrowbody',seats:145,speedKmh:870,maxRangeKm:6300,price:50_000_000,costPerKm:6.5},
  'A319neo':{manufacturer:'Airbus',segment:'Narrowbody',seats:140,speedKmh:835,maxRangeKm:6760,price:45_000_000,costPerKm:6.9},
  'A320neo':{manufacturer:'Airbus',segment:'Narrowbody',seats:180,speedKmh:835,maxRangeKm:6300,price:48_000_000,costPerKm:8.2},
  'A321neo':{manufacturer:'Airbus',segment:'Large narrowbody',seats:206,speedKmh:835,maxRangeKm:6500,price:62_000_000,costPerKm:9.4},
  'A321XLR':{manufacturer:'Airbus',segment:'Long-range narrowbody',seats:206,speedKmh:835,maxRangeKm:8700,price:72_000_000,costPerKm:10.1},
  'A330-800':{manufacturer:'Airbus',segment:'Widebody',seats:248,speedKmh:870,maxRangeKm:15090,price:105_000_000,costPerKm:14.3},
  'A330-900':{manufacturer:'Airbus',segment:'Widebody',seats:287,speedKmh:870,maxRangeKm:13330,price:110_000_000,costPerKm:15.4},
  'A350-900':{manufacturer:'Airbus',segment:'Long-range widebody',seats:325,speedKmh:903,maxRangeKm:15370,price:155_000_000,costPerKm:15.8},
  'A350-1000':{manufacturer:'Airbus',segment:'Large long-range widebody',seats:375,speedKmh:903,maxRangeKm:16100,price:180_000_000,costPerKm:18.1},
  'A380-800':{manufacturer:'Airbus',segment:'Very large widebody · used market',seats:555,speedKmh:903,maxRangeKm:14800,price:125_000_000,costPerKm:29.0},

  '737-7':{manufacturer:'Boeing',segment:'Narrowbody',seats:150,speedKmh:839,maxRangeKm:7040,price:48_000_000,costPerKm:7.2},
  '737-8':{manufacturer:'Boeing',segment:'Narrowbody',seats:178,speedKmh:839,maxRangeKm:6480,price:55_000_000,costPerKm:8.4},
  '737-9':{manufacturer:'Boeing',segment:'Large narrowbody',seats:185,speedKmh:839,maxRangeKm:6110,price:59_000_000,costPerKm:8.9},
  '737-10':{manufacturer:'Boeing',segment:'Large narrowbody',seats:200,speedKmh:839,maxRangeKm:5740,price:63_000_000,costPerKm:9.3},
  '787-8':{manufacturer:'Boeing',segment:'Long-range widebody',seats:242,speedKmh:903,maxRangeKm:14820,price:132_000_000,costPerKm:13.8},
  '787-9':{manufacturer:'Boeing',segment:'Long-range widebody',seats:290,speedKmh:903,maxRangeKm:15370,price:145_000_000,costPerKm:15.1},
  '787-10':{manufacturer:'Boeing',segment:'Large widebody',seats:330,speedKmh:903,maxRangeKm:13890,price:155_000_000,costPerKm:16.8},
  '777-200ER':{manufacturer:'Boeing',segment:'Widebody · used market',seats:313,speedKmh:905,maxRangeKm:13080,price:58_000_000,costPerKm:19.5},
  '777-200LR':{manufacturer:'Boeing',segment:'Ultra-long-range widebody · used market',seats:317,speedKmh:905,maxRangeKm:15843,price:72_000_000,costPerKm:20.6},
  '777-300ER':{manufacturer:'Boeing',segment:'Large widebody · used market',seats:396,speedKmh:905,maxRangeKm:13650,price:82_000_000,costPerKm:23.2}
};
const CABIN_CLASSES = {
  economy:{label:'Economy',space:1,baseFareMultiplier:1,demandScale:1,elasticity:.9},
  business:{label:'Business',space:2,baseFareMultiplier:2.6,demandScale:.72,elasticity:.55},
  first:{label:'First',space:3,baseFareMultiplier:5,demandScale:.42,elasticity:.42}
};
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
  postTransaction(-price,'Slots',`Acquired ${airportCode} ${hhmm(aligned)} slot series`);
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
  return ['fuel','landingFees','passengerFees','groundHandling','navigation','emissions','maintenanceReserve','unscheduledMaintenance','weatherOps','insurance','parking','legacyOperating']
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
    const shock=(Math.random()-.5)*.12;
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
    const moved=Math.min(remaining,Math.max(0,Number(count)||0));
    if(moved){ mix[family]=moved; remaining-=moved; }
    if(!remaining) break;
  }
  return remaining?null:mix;
}

function flightPersonnelTransferCount(flightId){
  return (state.personnelTransfers||[]).reduce((total,transfer)=>
    total+(transfer.status!=='cancelled'&&transfer.method==='own'&&transfer.flightId===flightId?transfer.amount:0),0
  );
}

function externalTransferPlan(from,to,amount,t=simNow()){
  const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
  const farePerPerson=Math.round((75+km*.12)/5)*5;
  const departure=t+2*HOUR;
  const arrival=departure+(.65+km/800)*HOUR;
  return {km,farePerPerson,cost:farePerPerson*amount,departure,arrival};
}

function processPersonnelTransfers(t=simNow()){
  let changed=false;
  for(const transfer of state.personnelTransfers||[]){
    if(transfer.status!=='scheduled') continue;
    if(transfer.method==='own'){
      const flight=state.flights.find(f=>f.id===transfer.flightId&&!f.cancelled);
      if(!flight){
        changeStaff(transfer.from,transfer.role,transfer.amount);
        for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(transfer.from,transfer.role,family,count);
        transfer.status='cancelled'; transfer.cancelledAt=t; changed=true;
        continue;
      }
      transfer.departure=flightActualDeparture(flight);
      transfer.arrival=flightActualArrival(flight);
    }
    if(t>=transfer.arrival){
      changeStaff(transfer.to,transfer.role,transfer.amount);
      for(const [family,count] of Object.entries(transfer.qualifications||{})) changeQualification(transfer.to,transfer.role,family,count);
      transfer.status='completed'; transfer.completedAt=transfer.arrival; changed=true;
      logEvent(`${transfer.id}: ${transfer.amount} ${PERSONNEL[transfer.role].label.toLowerCase()} arrived at ${transfer.to}.`);
    }
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
    clock:{realBase:real,simBase:sim,speed:1},
    cash:165_000_000,
    home:'FRA',
    nextAircraft:1,
    nextFlight:1,
    nextService:1,
    nextSlotRight:1,
    nextTransaction:2,
    nextPersonnelTransfer:1,
    slotRights:[],
    aircraft:[],
    flights:[],
    services:[],
    transactions:[{id:'TX1',timestamp:sim,amount:165_000_000,category:'Opening',description:'Initial shareholder capital',balanceAfter:165_000_000}],
    personnelTransfers:[],
    fuelMarket:{pricePerGallon:FUEL_MARKET_BASE_EUR_GAL,updatedAt:sim},
    personnel:{assignments:{},lastPayrollAt:sim},
    ops:{automaticDisruptions:true},
    management:{cycleStart:sim,reviews:[]},
    stats:{revenue:0,costs:0,staffCosts:0,leaseCosts:0,transferCosts:0,cancellationCosts:0,scheduledMaintenanceCosts:0,cancelled:0,pax:0,completed:0},
  };
return s;
}

function migrateState(parsed){
  if(!parsed || parsed.version!==VERSION) return newState();
  if(!Array.isArray(parsed.services)) parsed.services=[];
  if(!Array.isArray(parsed.flights)) parsed.flights=[];
  if(!Array.isArray(parsed.aircraft)) parsed.aircraft=[];
  if(!Array.isArray(parsed.slotRights)) parsed.slotRights=[];
  if(!Array.isArray(parsed.transactions)){
    parsed.transactions=[{id:'TX1',timestamp:parsed.clock?.simBase||Date.now(),amount:parsed.cash||0,category:'Opening',description:'Balance brought forward from existing save',balanceAfter:parsed.cash||0}];
  }
  if(!Number.isFinite(parsed.nextTransaction)) parsed.nextTransaction=parsed.transactions.length+1;
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
  if(!Number.isFinite(parsed.nextSlotRight)) parsed.nextSlotRight=1;
  if(!parsed.ops) parsed.ops={automaticDisruptions:true};
  parsed.ops.automaticDisruptions=true;
  for(const ac of parsed.aircraft){
    if(!ac.acquisitionType) ac.acquisitionType='owned';
    if(!Number.isFinite(ac.acquiredAt)) ac.acquiredAt=parsed.clock?.simBase||Date.now();
    if(ac.defectUntil===undefined) ac.defectUntil=0;
    if(ac.defectReason===undefined) ac.defectReason='';
    if(!Number.isFinite(ac.condition)) ac.condition=100;
    if(!Number.isFinite(ac.flightHours)) ac.flightHours=0;
    if(!Number.isFinite(ac.cycles)) ac.cycles=0;
    if(!Number.isFinite(ac.fuelGallons)) ac.fuelGallons=0;
    if(!ac.cabin) ac.cabin=defaultCabin(ac.model);
  }
  for(const f of parsed.flights){
    for(const k of ['handlingDelayMin','technicalDelayMin','staffingDelayMin','enrouteDelayMin','propagatedDelayMin','slotDelayMin'])
      if(f[k]===undefined) f[k]=0;
    if(f.staffingBlocked===undefined) f.staffingBlocked=false;
    if(f.staffingShortage===undefined) f.staffingShortage='';
    if(f.slotMissed===undefined) f.slotMissed=false;
    if(f.opsChecked===undefined) f.opsChecked=Boolean(f.departureLogged);
    if(f.enrouteChecked===undefined) f.enrouteChecked=Boolean(f.departureLogged);
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
let toastTimer=null;

const SPLIT_KEY='aerosim_center_split_pct';
const LEFT_SIDEBAR_SPLIT_KEY='aerosim_left_sidebar_width';
const RIGHT_SIDEBAR_SPLIT_KEY='aerosim_right_sidebar_width';
const WORKSPACE_UI_KEY='aerosim_workspace_ui_v1';
const WORKSPACE_WIDGETS={
  'flight-planner':{views:['planning','all'],defaultOpen:false},
  'occ-flights':{views:['occ','all'],defaultOpen:true},
  'occ-attention':{views:['occ','all'],defaultOpen:true},
  'occ-recovery':{views:['occ','all'],defaultOpen:false},
  'my-aircraft':{views:['planning','occ','all'],defaultOpen:true},
  'aircraft-market':{views:['planning','all'],defaultOpen:false},
  'management-cycle':{views:['planning','occ','all'],defaultOpen:true},
  performance:{views:['planning','occ','all'],defaultOpen:true},
  'slot-market':{views:['planning','all'],defaultOpen:false},
  'slot-portfolio':{views:['planning','all'],defaultOpen:true},
  finance:{views:['planning','all'],defaultOpen:true},
  personnel:{views:['planning','occ','all'],defaultOpen:true},
  'hire-personnel':{views:['planning','all'],defaultOpen:true},
  maintenance:{views:['planning','occ','all'],defaultOpen:true},
  weather:{views:['occ','all'],defaultOpen:true}
};
function loadWorkspaceUi(){
  try{
    const parsed=JSON.parse(localStorage.getItem(WORKSPACE_UI_KEY)||'{}');
    const activeView=['planning','occ','all'].includes(parsed.activeView)?parsed.activeView:'planning';
    return {activeView,collapsed:parsed.collapsed||{planning:{},occ:{},all:{}},scheduleRanges:parsed.scheduleRanges||{planning:48,occ:24,all:48}};
  }catch(_){ return {activeView:'planning',collapsed:{planning:{},occ:{},all:{}},scheduleRanges:{planning:48,occ:24,all:48}}; }
}
let workspaceUi=loadWorkspaceUi();
let activeWorkspaceView=workspaceUi.activeView;
let restoreSidebarWidthsForView=()=>{};
let restoreCenterSplitForView=()=>{};
let scheduleWindowOffsetHours=-2;
let scheduleRangeHours=24;
let lastScheduleSignature='';
let lastScheduleRenderAt=0;
let aircraftSelectSignature='';
let slotPortfolioSignature='';
let sidebarSearchTokens=[];
let sidebarSearchTimer=null;
let financeSignature='';
let occSignature='';
let managementSignature='';
let maintenanceSignature='';
let weatherSignature='';
let recoverySignature='';
let latestManagementForecast=null;

function postTransaction(amount,category,description,reference=''){
  const value=Math.round(Number(amount)||0);
  if(!value) return null;
  state.cash+=value;
  const transaction={
    id:'TX'+state.nextTransaction++,timestamp:simNow(),amount:value,category,description,reference,
    balanceAfter:state.cash
  };
  state.transactions.push(transaction);
  if(state.transactions.length>500) state.transactions.splice(0,state.transactions.length-500);
  return transaction;
}

function normalizeSidebarSearch(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function matchesSidebarSearch(...values){
  if(!sidebarSearchTokens.length) return true;
  const haystack=normalizeSidebarSearch(values.join(' '));
  return sidebarSearchTokens.every(token=>haystack.includes(token));
}

function simNow(){
  return state.clock.simBase + (Date.now()-state.clock.realBase)*state.clock.speed;
}
function rebaseClock(newSpeed){
  const now=simNow();
  state.clock={realBase:Date.now(),simBase:now,speed:newSpeed};
  save();
}
function save(){ localStorage.setItem(SAVE_KEY,JSON.stringify(state)); }

function resetLocalSave(){
  const resetStatus=document.getElementById('resetStatus');
  const resetButton=document.getElementById('resetBtn');
  resetButton.disabled=true;
  resetStatus.textContent='Resetting local airline data…';
  const blank=newState();
  try{
    // Write the replacement immediately so the periodic save and beforeunload
    // handlers can only persist the new blank state from this point onward.
    state=blank;
    localStorage.setItem(SAVE_KEY,JSON.stringify(blank));
  }catch(error){
    console.error('AeroSim reset failed',error);
    resetButton.disabled=false;
    resetStatus.textContent='Reset failed because browser storage is unavailable.';
    toast('Reset failed: browser storage is unavailable.');
    return;
  }

  try{
    selectedAircraftId=null;
    selectedFlightId=null;
    sidebarSearchTokens=[];
    leftSidebarSearch.value='';
    scheduleWindowOffsetHours=-2;
    lastScheduleSignature='';
    lastScheduleRenderAt=0;
    aircraftSelectSignature='';
    slotPortfolioSignature='';
    routeSignature='';

    document.getElementById('speed').value='1';
    aircraftMarkers.clear();
    aircraftLayer.clearLayers();
    routeLayer.clearLayers();
    refreshAll();
    refreshSlotBuyPreview();
    map.setView([49.5,8.5],4,{animate:false});
  }catch(error){
    // The blank state is already safely stored. A reload is the most reliable
    // recovery if any stale renderer fails while clearing the old UI.
    console.error('AeroSim reset render failed; reloading blank save',error);
    resetStatus.textContent='Data cleared. Reloading the blank airline…';
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
    resetButton.disabled=false;
    resetStatus.textContent='Reset could not be verified.';
    toast('Reset could not be verified. Reload and try again.');
    return;
  }
  resetButton.disabled=false;
  resetStatus.textContent='Reset complete · 0 aircraft · 0 flights · 0 slot rights';
  toast('Local save reset. Your airline is empty.');
}
