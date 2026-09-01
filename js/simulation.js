/* AeroSim scheduling, demand, flight economics, staffing, and operations simulation. */

function flightActualDeparture(f){ return f.actualDeparture ?? f.departure; }
function flightActualArrival(f){ return f.actualArrival ?? f.arrival; }
function flightTotalDepartureDelayMin(f){ return Math.max(0,Math.round((flightActualDeparture(f)-f.departure)/MIN)); }
function aircraftIsDefective(ac,t=simNow()){ return Boolean(ac && ac.defectUntil && t<ac.defectUntil); }

function aircraftActiveFlight(acId,t=simNow()){
  return state.flights.find(f=>f.aircraftId===acId && !f.cancelled && flightActualDeparture(f)<=t && t<flightActualArrival(f));
}
function aircraftUpcomingFlight(acId,t=simNow()){
  return state.flights.filter(f=>f.aircraftId===acId && !f.cancelled && flightActualDeparture(f)>t)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
}

function validateAircraftItinerary(ac,proposedLegs=[]){
  const now=simNow();
  const legs=state.flights
    .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualArrival(f)>now)
    .map(f=>({from:f.from,to:f.to,departure:flightActualDeparture(f),arrival:flightActualArrival(f),label:f.id,existing:true}))
    .concat(proposedLegs)
    .sort((a,b)=>a.departure-b.departure||a.arrival-b.arrival);
  let location=ac.location,availableAt=now;
  for(const leg of legs){
    if(leg.existing&&leg.departure<=now&&now<leg.arrival){ location=leg.to; availableAt=leg.arrival; continue; }
    if(leg.departure<availableAt) return {ok:false,reason:`overlaps ${leg.label||'another planned leg'}`};
    if(leg.from!==location) return {ok:false,reason:`aircraft will be at ${location}, not ${leg.from}, before ${leg.label||'this leg'}`};
    location=leg.to; availableAt=leg.arrival;
  }
  return {ok:true};
}
function statusOfFlight(f,t=simNow()){
  if(f.cancelled) return 'cancelled';
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
function minimumTurnMinutes(ac,airportCode){
  const model=MODELS[ac.model];
  const base=model.segment.includes('turboprop')?30:
    model.segment.includes('Regional jet')?35:
      model.segment.includes('widebody')?60:40;
  const congested=['LHR','JFK','AMS','CDG','HND'].includes(airportCode)?10:0;
  return base+congested;
}
function nextSlotTime(readyTs, airportCode){
  const cfg=AIRPORT_OPS[airportCode] || {slotIntervalMin:15,graceMin:10};
  const capacity=Management.weatherAt(airportCode,readyTs).capacityFactor;
  const effectiveInterval=Math.ceil((cfg.slotIntervalMin/capacity)/5)*5;
  const step=effectiveInterval*MIN;
  return Math.ceil(readyTs/step)*step;
}
function recalculateOperations(){
  for(const f of state.flights){
    f.handlingDelayMin=Number(f.handlingDelayMin)||0;
    f.technicalDelayMin=Number(f.technicalDelayMin)||0;
    f.enrouteDelayMin=Number(f.enrouteDelayMin)||0;
    f.manualDelayMin=Number(f.manualDelayMin)||0;
    f.weatherDelayMin=Number(f.weatherDelayMin)||0;
    f.maintenanceDelayMin=Number(f.maintenanceDelayMin)||0;
    f.positioningDelayMin=Number(f.positioningDelayMin)||0;
    f.propagatedDelayMin=0; f.slotDelayMin=0; f.slotMissed=false;
    f.actualDeparture=f.departure; f.actualArrival=f.arrival;
  }
  for(const ac of state.aircraft){
    const flights=state.flights.filter(f=>f.aircraftId===ac.id && !f.cancelled).sort((x,y)=>x.departure-y.departure);
    let prev=null;
    for(const f of flights){
      const baseReady=f.departure+(
        f.handlingDelayMin+f.technicalDelayMin+f.staffingDelayMin+f.manualDelayMin+
        f.weatherDelayMin+f.maintenanceDelayMin+f.positioningDelayMin
      )*MIN;
      let ready=baseReady;
      if(prev){
        const inboundReady=flightActualArrival(prev)+minimumTurnMinutes(ac,f.from)*MIN;
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
  return state.flights.filter(f=>f.aircraftId===acId && !f.cancelled && !f.settled && flightActualDeparture(f)>t)
    .sort((x,y)=>flightActualDeparture(x)-flightActualDeparture(y))[0] || null;
}

function logEvent(){ /* operations log intentionally disabled */ }
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
    const repairMin=90+Math.floor(Math.random()*241);
    const seats=MODELS[ac?.model]?.seats||100;
    const severity=repairMin<=150?'minor':repairMin<=240?'major':'severe';
    const maintenanceCost=Math.round((6_000+repairMin*55+seats*35)/500)*500;
    f.technicalDelayMin+=repairMin;
    f.defectSeverity=severity;
    f.maintenanceCost=(f.maintenanceCost||0)+maintenanceCost;
    if(f.economics){
      f.economics.unscheduledMaintenance=(f.economics.unscheduledMaintenance||0)+maintenanceCost;
      refreshEconomicsTotals(f);
    }else{
      f.costs=(f.baseCosts||0)+(f.fuelCost||0)+f.maintenanceCost;
    }
    postTransaction(-maintenanceCost,'Maintenance',`${f.id} ${severity} outsourced technical repair`,f.id);
    if(ac){
      ac.defectUntil=Math.max(ac.defectUntil||0,f.departure+repairMin*MIN);
      ac.defectReason='Technical defect';
      ac.condition=clamp(ac.condition+(severity==='minor'?2:severity==='major'?4:7),0,100);
    }
    logEvent(`${f.id}: ${severity} technical defect on ${ac?.tail||'aircraft'}; outsourced repair ${money(maintenanceCost)}, estimated ${repairMin} min.`);
  }else if(roll<technicalChance+.135){
    const delay=10+Math.floor(Math.random()*31);
    f.handlingDelayMin+=delay;
    logEvent(`${f.id}: ground handling delay +${delay} min at ${f.from}.`);
  }
  return true;
}
function maybeApplyWeatherDelay(f,t){
  if(f.cancelled||f.weatherChecked||t<f.departure-90*MIN||t>=f.departure) return false;
  f.weatherChecked=true;
  const departureWeather=Management.weatherAt(f.from,f.departure);
  const arrivalWeather=Management.weatherAt(f.to,f.arrival);
  const primary=departureWeather.delayMin>=arrivalWeather.delayMin?departureWeather:arrivalWeather;
  f.weatherCode=primary.level==='normal'?'':`${primary.airport}: ${primary.conditions}`;
  f.weatherDelayMin=primary.delayMin;
  if(primary.delayMin&&!f.weatherCost){
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const seats=ac?cabinSeatCount(ac):100;
    f.weatherCost=Math.round((1_500+seats*(primary.level==='severe'?45:18))/500)*500;
    if(f.economics){ f.economics.weatherOps=f.weatherCost; refreshEconomicsTotals(f); }
    postTransaction(-f.weatherCost,'Weather operations',`${f.id} ${primary.conditions.toLowerCase()} handling`,f.id);
  }
  return true;
}
function maybeGenerateEnrouteIssue(f,t){
  if(f.cancelled || f.enrouteChecked || !state.ops.automaticDisruptions || t<flightActualDeparture(f)) return false;
  f.enrouteChecked=true;
  if(Math.random()<0.09){
    const delay=5+Math.floor(Math.random()*21);
    f.enrouteDelayMin+=delay;
    logEvent(`${f.id}: en-route disruption adds about ${delay} min to arrival.`);
  }
  return true;
}
function fuelFlight(f,t,force=false){
  if(f.fueled || f.cancelled || (!force&&t<f.departure-60*MIN)) return false;
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  if(!ac || ac.location!==f.from) return false;
  const nextFlight=state.flights
    .filter(other=>other.aircraftId===ac.id && !other.cancelled && !other.settled && !other.departureLogged)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b) || a.id.localeCompare(b.id))[0];
  if(!nextFlight || nextFlight.id!==f.id) return false;
  const plan=flightFuelPlan(f.from,f.to,ac);
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
function processEvents(){
  ensureRecurringFlights();
  const t=simNow();
  let changed=false;
  if(updateFuelMarket(t)) changed=true;
  if(Management.processMaintenance(state,t,postTransaction)) changed=true;
  if(Management.processWeeklyReviews(state,t)) changed=true;
  if(repairFirstFlightFuelAttribution()) changed=true;
  if(processPersonnelPayroll(t)) changed=true;
  if(processLeasePayments(t)) changed=true;
  if(processPersonnelTransfers(t)) changed=true;

  for(const f of state.flights){
    if(maybeApplyWeatherDelay(f,t)) changed=true;
    if(maybeGeneratePreDepartureIssue(f,t)) changed=true;
  }
  recalculateOperations();
  if(updateStaffingConstraints(t)) changed=true;
  if(updateMaintenanceConstraints(t)) changed=true;
  if(updatePositioningConstraints(t)) changed=true;
  recalculateOperations();

  for(const f of state.flights){
    if(f.cancelled) continue;
    if(fuelFlight(f,t)) changed=true;
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
      if(ac){
        ac.location=f.to;
        const onboardFuel=Number.isFinite(ac.fuelGallons)?ac.fuelGallons:(f.fuelOnboardAtDeparture||0);
        ac.fuelGallons=Math.max(0,onboardFuel-(f.tripFuelGallons||0));
        const hours=(f.arrival-f.departure)/HOUR;
        ac.flightHours=(ac.flightHours||0)+hours;
        ac.cycles=(ac.cycles||0)+1;
        ac.condition=clamp((ac.condition??100)-(.12+hours*.035),0,100);
      }
      const prepaid=(f.fuelCost||0)+(f.maintenanceCost||0)+(f.weatherCost||0);
      postTransaction(f.revenue,'Ticket revenue',`${f.id} ${f.from} → ${f.to}`,f.id);
      const remainingOperatingCost=Math.max(0,f.costs-prepaid);
      if(remainingOperatingCost) postTransaction(-remainingOperatingCost,'Flight operations',`${f.id} remaining operating costs`,f.id);
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
    manualDelayMin:0,weatherDelayMin:0,weatherChecked:false,weatherCode:'',maintenanceDelayMin:0,maintenanceBlocked:false,
    positioningDelayMin:0,positioningBlocked:false,issueAcknowledgedAt:0,issueAcknowledgedKey:'',
    enrouteDelayMin:0,propagatedDelayMin:0,slotDelayMin:0,
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
      const earliestReturn=outbound.arrival+svc.turnaroundMin*MIN;
      const isFirst=outbound.departure===svc.firstDeparture;
      const returnDeparture=isFirst && Number.isFinite(svc.firstReturnDeparture)
        ? svc.firstReturnDeparture
        : destinationRight
          ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
          : alignTimestampToAirportSlot(earliestReturn,svc.to);
      if(returnDeparture<simNow() || (nextOutbound && returnDeparture>=nextOutbound.departure)) continue;
      const returnEstimate=estimateFlight(svc.to,svc.from,state.aircraft.find(a=>a.id===svc.aircraftId),svc.fares||svc.fare,{departure:returnDeparture});
      if(!validateAircraftItinerary(state.aircraft.find(a=>a.id===svc.aircraftId),[{
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
      const ac=state.aircraft.find(a=>a.id===svc.aircraftId);
      if(!ac){ svc.active=false; changed=true; break; }

      const outboundEstimate=estimateFlight(svc.from,svc.to,ac,svc.fares||svc.fare,{departure:svc.nextDeparture});
      const destinationRight=slotRightById(svc.destinationSlotRightId);
      const earliestReturn=svc.nextDeparture+outboundEstimate.duration+svc.turnaroundMin*MIN;
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
  return Boolean(outbound && f.arrival-outbound.departure<=12*HOUR);
}
function flightUsesLocalCrew(f){ return !returnReusesOutboundCrew(f); }
function flightCrewRelease(f){
  if(f.serviceId && f.serviceLeg==='outbound'){
    const returnFlight=state.flights
      .filter(other=>!other.cancelled&&other.serviceId===f.serviceId && other.serviceLeg==='return' && other.departure>f.departure)
      .sort((a,b)=>a.departure-b.departure)[0];
    if(returnFlight && returnReusesOutboundCrew(returnFlight)) return flightActualArrival(returnFlight);
  }
  return flightActualArrival(f);
}

function staffingShortagesForFlight(ac,departure,duration,airport=ac.location,candidateId=null,localFlightCrew=true,flightType='passenger'){
  const arrival=departure+duration;
  const ferry=flightType==='ferry';
  const family=Management.aircraftFamily(ac.model);
  const qualifiedNeeded={captains:localFlightCrew?1:0,firstOfficers:localFlightCrew?1:0};
  const needed={
    captains:localFlightCrew?1:0,
    firstOfficers:localFlightCrew?1:0,
    cabinCrew:localFlightCrew&&!ferry?Math.max(1,Math.ceil(cabinSeatCount(ac)/50)):0,
    groundHandling:ferry?2:4,operations:1,customerService:ferry?0:1
  };
  for(const f of state.flights){
    if(f.cancelled || f.from!==airport || f.id===candidateId) continue;
    if(candidateId && (f.departure>departure || (f.departure===departure && f.id>candidateId))) continue;
    const otherDep=flightActualDeparture(f);
    // Pooled flight crews remain committed through the rotation and then need
    // ten hours of rest. This avoids named-employee micromanagement while making
    // duty limits and reserve depth operationally meaningful.
    const crewAvailableAfter=flightCrewRelease(f)+10*HOUR;
    if(flightUsesLocalCrew(f) && crewAvailableAfter>departure && otherDep<arrival){
      needed.captains++; needed.firstOfficers++;
      const other=state.aircraft.find(a=>a.id===f.aircraftId);
      if(other&&Management.aircraftFamily(other.model)===family){ qualifiedNeeded.captains++; qualifiedNeeded.firstOfficers++; }
      if(f.flightType!=='ferry') needed.cabinCrew+=Math.max(1,Math.ceil(((other?cabinSeatCount(other):f.pax)||1)/50));
    }
    if(Math.abs(otherDep-departure)<90*MIN) needed.groundHandling+=f.flightType==='ferry'?2:4;
    if(Math.abs(otherDep-departure)<60*MIN){ needed.operations++; if(f.flightType!=='ferry') needed.customerService++; }
  }
  const shortages=Object.entries(needed)
    .filter(([role,count])=>staffAt(airport,role)<count)
    .map(([role,count])=>`${PERSONNEL[role].label} at ${airport}: ${staffAt(airport,role)}/${count}`);
  for(const role of ['captains','firstOfficers']){
    const available=qualifiedStaffAt(airport,role,family),required=qualifiedNeeded[role];
    if(available<required) shortages.push(`${PERSONNEL[role].label} rated ${family} at ${airport}: ${available}/${required}`);
  }
  return shortages;
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
    const next=state.flights
      .filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&!f.departureLogged&&flightActualDeparture(f)>t)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
    if(!next) continue;
    const expectedLocation=active?active.to:ac.location;
    if(next.from!==expectedLocation){
      const delay=Math.max(15,Math.ceil((t+15*MIN-next.departure)/(15*MIN))*15);
      if(!next.positioningBlocked||next.positioningDelayMin!==delay) changed=true;
      next.positioningBlocked=true;
      next.positioningDelayMin=delay;
    }else if(next.positioningBlocked||next.positioningDelayMin){
      next.positioningBlocked=false;
      next.positioningDelayMin=0;
      changed=true;
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

  const outbound=estimateFlight(from,to,ac,fares,{departure});
  if(!outbound.rangeOk) return toast(`${ac.model} does not have enough range for this route.`);
  const staffingShortages=staffingShortagesForFlight(ac,departure,outbound.duration,from);
  if(staffingShortages.length) return toast(`Hire required staff first · ${staffingShortages.join(' · ')}`);

  if(scheduleType==='once'){
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+outbound.duration,label:'new flight'}]);
    if(!itinerary.ok) return toast(`${ac.tail} cannot operate this flight: ${itinerary.reason}.`);
    const f=createFlightRecord({aircraftId:ac.id,from,to,departure,fare:fares});
    logEvent(`${f.id} scheduled ${from} → ${to} with ${ac.tail}.`);
    selectedAircraftId=ac.id;
    save(); refreshAll();
    return toast(`${f.id} scheduled. ${formatDuration(outbound.duration)} block time.`);
  }

  const rule=repeatRuleEl.value;
  if(rule==='custom' && (!operatingCalendar.days.length||!operatingCalendar.months.length))
    return toast('Select at least one operating weekday and one operating month.');
  const turnaroundMin=Number(turnaroundEl.value)||90;
  const slotPlan=requiredSlotPlan(from,to,ac,fares,departure,turnaroundMin);
  const inbound=estimateFlight(to,from,ac,fares,{departure:slotPlan.returnDeparture});
  const alignedDeparture=slotPlan.outboundDeparture;
  const cycle=(slotPlan.returnDeparture-alignedDeparture)+inbound.duration;
  const returnNeedsLocalFlightCrew=cycle>12*HOUR;
  const returnStaffingShortages=staffingShortagesForFlight(ac,slotPlan.returnDeparture,inbound.duration,to,null,returnNeedsLocalFlightCrew);
  if(returnStaffingShortages.length) return toast(`Hire required return-flight staff first · ${returnStaffingShortages.join(' · ')}`);
  const minInterval=minimumRepeatInterval(rule);

  if(!slotPlan.originRight||!slotPlan.destinationRight){
    return toast('Recurring service needs owned slot rights at both airports. Acquire the missing rights first.');
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

  const svc={
    id:'SCH'+state.nextService++,
    aircraftId:ac.id,from,to,fare:fares.economy,fares,rule,turnaroundMin,
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
  save(); refreshAll(); toast(`${ac.tail} will operate the next round trip only.`);
}
function changeServiceAircraft(serviceId,newAcId){
  const svc=state.services.find(s=>s.id===serviceId && s.active), ac=state.aircraft.find(a=>a.id===newAcId);
  if(!svc||!ac) return;
  if(newAcId===svc.aircraftId) return toast('That aircraft already owns this schedule.');
  if(state.flights.some(f=>f.serviceId===serviceId && statusOfFlight(f)==='airborne'))
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

function delayFlight(flightId,minutes=15){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('Only a flight still on the ground can be held.');
  f.manualDelayMin=(Number(f.manualDelayMin)||0)+minutes;
  f.issueAcknowledgedAt=0; f.issueAcknowledgedKey='';
  recalculateOperations();
  save(); refreshAll();
  toast(`${f.id} held for ${minutes} additional minutes. Downstream delays were recalculated.`);
}

function flightCancellationTargets(f){
  if(!f.serviceId||f.serviceLeg!=='outbound') return [f];
  const rotation=rotationForFlight(f);
  return [rotation.outbound,rotation.returnFlight].filter(Boolean).filter(item=>!item.cancelled&&!item.departureLogged);
}

function cancelFlight(flightId){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('An airborne or completed flight cannot be cancelled.');
  const targets=flightCancellationTargets(f);
  const plans=targets.map(item=>({
    flight:item,
    plan:Management.cancellationPlan(item,distanceKm(AIRPORTS[item.from],AIRPORTS[item.to]),simNow())
  }));
  const total=plans.reduce((sum,item)=>sum+item.plan.total,0);
  const pairing=targets.length>1?' The paired return leg will also be cancelled so the aircraft remains correctly positioned.':'';
  if(!window.confirm(`Cancel ${f.id}?${pairing}\n\nEstimated passenger care, reaccommodation and handling: ${money(total)}.`)) return;
  for(const {flight,plan} of plans){
    flight.cancelled=true; flight.cancelledAt=simNow(); flight.cancellationCost=plan.total;
    flight.issueAcknowledgedAt=0; flight.issueAcknowledgedKey='';
    postTransaction(-plan.total,'Flight cancellation',`${flight.id} passenger recovery and handling`,flight.id);
    state.stats.cancellationCosts+=plan.total;
    state.stats.cancelled+=1;
  }
  recalculateOperations();
  save(); refreshAll();
  toast(`${targets.map(item=>item.id).join(' and ')} cancelled · ${money(total)} recovery cost.`);
}

function prioritizeFuel(flightId){
  const f=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  if(!f||f.departureLogged) return toast('This flight can no longer be fueled on the ground.');
  if(!fuelFlight(f,simNow(),true)) return toast('Fueling is not possible yet: the aircraft must be at origin and this must be its next flight.');
  save(); refreshAll(); toast(`${f.id} fueled early at the current market price.`);
}

function flightIssueKey(f){
  return [f.staffingBlocked,f.maintenanceBlocked,f.positioningBlocked,f.slotMissed,f.technicalDelayMin,f.handlingDelayMin,
    f.manualDelayMin,f.weatherDelayMin,f.propagatedDelayMin,f.slotDelayMin,f.enrouteDelayMin].join(':');
}

function acknowledgeFlightIssue(flightId){
  const f=state.flights.find(item=>item.id===flightId);
  if(!f) return;
  f.issueAcknowledgedAt=simNow(); f.issueAcknowledgedKey=flightIssueKey(f);
  save(); refreshOccWidgets(true); refreshFleetList();
  toast(`${f.id} issue acknowledged. It will return if the situation changes.`);
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
    airport=conflict.to;
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
  if(!window.confirm(`Schedule ${ac.tail} for an outsourced check at ${plan.airport}?\n\nStart: ${formatTime(plan.start)}\nDuration: ${formatDuration(plan.end-plan.start)}\nEstimated invoice: ${money(plan.cost)} on completion.`)) return;
  Management.ensureState(state,simNow());
  ac.maintenance.scheduled=plan;
  save(); refreshAll();
  toast(`${ac.tail} maintenance booked at ${plan.airport}.`);
}

function cancelAircraftMaintenance(acId){
  const ac=state.aircraft.find(item=>item.id===acId);
  const job=ac&&Management.maintenanceStatus(ac,simNow()).scheduled;
  if(!job||job.status==='active') return toast('Active maintenance cannot be cancelled.');
  ac.maintenance.scheduled=null;
  save(); refreshAll(); toast(`${ac.tail} maintenance booking removed.`);
}

function cancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId);
  if(!svc) return;
  svc.active=false;
  const t=simNow();
  state.flights=state.flights.filter(f => !(f.serviceId===serviceId && flightActualDeparture(f)>t));
  if(selectedFlightId && !state.flights.some(f=>f.id===selectedFlightId)) selectedFlightId=null;
  logEvent(`${serviceId} recurring schedule cancelled.`);
  save(); refreshAll(); refreshAircraftSelect(true);
  toast(`${serviceId} removed. Flights that had not departed were cancelled.`);
}
function confirmCancelService(serviceId){
  const svc=state.services.find(s=>s.id===serviceId && s.active);
  if(!svc) return;
  const confirmed=window.confirm(
    `Remove ${svc.id} (${svc.from} ↔ ${svc.to})?\n\n`+
    'The recurring schedule will stop and all flights that have not departed will be cancelled. An airborne flight will finish.'
  );
  if(confirmed) cancelService(serviceId);
}

function buyAircraft(modelName,cabin=defaultCabin(modelName)){
  const m=MODELS[modelName];
  if(state.cash<m.price) return toast(`Not enough cash for ${modelName}.`);
  postTransaction(-m.price,'Aircraft purchase',`Purchased ${modelName}`);
  const n=state.nextAircraft++;
  const ac={id:'AC'+n,tail:randomTail(n),model:modelName,cabin:{...cabin},location:state.home,defectUntil:0,defectReason:'',condition:100,flightHours:0,cycles:0,fuelGallons:0,acquisitionType:'owned',acquiredAt:simNow()};
  state.aircraft.push(ac);
  Management.ensureState(state,simNow());
  logEvent(`Purchased ${modelName} ${ac.tail} for ${money(m.price)}.`);
  save(); refreshAll(); toast(`${ac.tail} delivered at ${state.home}.`);
}

function leaseAircraft(modelName,termMonths,cabin=defaultCabin(modelName)){
  const months=clamp(Math.round(Number(termMonths)||60),12,120);
  const monthlyFee=leaseMonthlyFee(modelName,months);
  if(state.cash<monthlyFee) return toast(`You need ${money(monthlyFee)} for the first lease payment.`);
  postTransaction(-monthlyFee,'Aircraft lease',`${modelName} first monthly lease payment`);
  state.stats.leaseCosts+=monthlyFee;
  const n=state.nextAircraft++,startedAt=simNow();
  const ac={
    id:'AC'+n,tail:randomTail(n),model:modelName,cabin:{...cabin},location:state.home,
    defectUntil:0,defectReason:'',condition:100,flightHours:0,cycles:0,fuelGallons:0,
    acquisitionType:'lease',acquiredAt:startedAt,leaseTermMonths:months,leaseMonthlyFee:monthlyFee,
    leaseEndAt:startedAt+months*30*DAY,leasePaidThrough:startedAt+30*DAY
  };
  state.aircraft.push(ac);
  Management.ensureState(state,simNow());
  logEvent(`Leased ${modelName} ${ac.tail} for ${months} months at ${money(monthlyFee)}/month.`);
  save(); refreshAll(); toast(`${ac.tail} delivered at ${state.home}. First monthly payment charged.`);
}

function aircraftHasAssignments(acId,t=simNow()){
  return state.services.some(s=>s.active&&s.aircraftId===acId)||
    state.flights.some(f=>f.aircraftId===acId&&!f.cancelled&&flightActualArrival(f)>t);
}

function aircraftSaleValue(ac){
  const conditionFactor=.55+.45*clamp(ac.condition??100,0,100)/100;
  const utilizationFactor=clamp(1-(ac.flightHours||0)/100000,.72,1);
  return Math.round(MODELS[ac.model].price*.78*conditionFactor*utilizationFactor/1000)*1000;
}

function disposeAircraft(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac||aircraftHasAssignments(ac.id)) return toast('Remove this aircraft’s active and future assignments first.');
  if(ac.acquisitionType==='lease'){
    const remainingPayments=Math.max(0,Math.ceil((ac.leaseEndAt-Math.max(simNow(),ac.leasePaidThrough||simNow()))/(30*DAY)));
    const terminationFee=Math.min(6,remainingPayments)*(ac.leaseMonthlyFee||0);
    const confirmed=window.confirm(`Return leased ${ac.tail}?${terminationFee?`\n\nEarly termination charge: ${money(terminationFee)}.`:'\n\nThe agreed lease term has ended; no return charge applies.'}`);
    if(!confirmed) return;
    if(terminationFee) postTransaction(-terminationFee,'Aircraft lease',`${ac.tail} early termination charge`,ac.id);
    state.stats.leaseCosts+=terminationFee;
    logEvent(`${ac.tail} returned to lessor${terminationFee?` with ${money(terminationFee)} early termination charge`:''}.`);
  }else{
    const value=aircraftSaleValue(ac);
    if(!window.confirm(`Sell ${ac.tail} (${ac.model}) for ${money(value)}?\n\nThe value reflects condition, utilization, and used-market depreciation.`)) return;
    postTransaction(value,'Aircraft sale',`Sold ${ac.tail} (${ac.model})`,ac.id);
    logEvent(`${ac.tail} sold for ${money(value)}.`);
  }
  state.aircraft=state.aircraft.filter(a=>a.id!==ac.id);
  if(selectedAircraftId===ac.id){ selectedAircraftId=null; selectedFlightId=null; }
  save(); refreshAll(); toast(ac.acquisitionType==='lease'?`${ac.tail} returned.`:`${ac.tail} sold.`);
}

function settleSelected(acId){
  const ac=state.aircraft.find(a=>a.id===acId);
  if(!ac) return;

  selectedFlightId=null;
  selectedAircraftId=acId;
  refreshFleetList();
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
}


function settleSelectedFlight(flightId){
  const f=state.flights.find(x=>x.id===flightId);
  if(!f) return;

  if(sidebarSearchTokens.length){
    sidebarSearchTokens=[];
    leftSidebarSearch.value='';
  }
  selectedFlightId=f.id;
  selectedAircraftId=f.aircraftId;

  refreshFleetList();
  routeSignature='';
  updateMapData();
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  const card=document.querySelector(`[data-aircraft-id="${f.aircraftId}"]`);
  if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function toggleAircraftCard(acId){
  if(selectedAircraftId===acId){
    selectedAircraftId=null;
    selectedFlightId=null;
    refreshFleetList();
    routeSignature='';
    updateMapData();
    lastScheduleSignature='';
    refreshScheduleTimeline(true);
    return;
  }
  settleSelected(acId);
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}
