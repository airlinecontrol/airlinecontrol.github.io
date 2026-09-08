/* Flight scheduling, market estimation, aircraft availability, and schedule removal. */

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
        return {ok:false,code:'turnaround',reason:`turnaround before ${leg.label||'this leg'} is ${actualTurn} min; ${ac.model} requires ${minimumTurn} min at ${leg.from}`,legLabel:leg.label||'',previousLegLabel:previousLeg?.label||'',actualTurn,minimumTurn,airport:leg.from};
      }
      return {ok:false,code:'overlap',reason:`overlaps ${leg.label||'another planned leg'}`,legLabel:leg.label||'',previousLegLabel:previousLeg?.label||'',availableAt};
    }
    if(leg.from!==location) return {ok:false,code:'position',reason:`aircraft will be at ${location}, not ${leg.from}, before ${leg.label||'this leg'}`,legLabel:leg.label||'',previousLegLabel:previousLeg?.label||'',location,requiredLocation:leg.from,availableAt};
    location=leg.to;
    availableAt=leg.arrival+minimumTurnMinutes(ac,leg.to)*MIN;
    previousLeg=leg;
  }
  return {ok:true};
}

function aircraftDepartureAvailability(ac,from,departure){
  const projected=aircraftProjectedLocation(ac,departure);
  if(projected?.status==='stale_unflown'){
    return {ok:false,reason:`${ac.tail} has ${projected.blockedBy?.id||'a flight'} scheduled in the past. Settle, cancel, or remove that leg before planning more flying.`};
  }
  if(projected?.blockedBy&&projected.availableAt>departure){
    return {ok:false,reason:`${ac.tail} is already committed to ${projected.blockedBy.id||'another flight'} until ${formatTime(projected.availableAt)}.`};
  }
  if(projected?.location&&projected.location!==from){
    return {ok:false,reason:`${ac.tail} is projected at ${projected.location}, not ${from}, at ${formatTime(departure)}.`};
  }
  return {ok:true,projected};
}

function aircraftItineraryFailureMessage(ac,itinerary,kind='flight'){
  if(!itinerary||itinerary.ok) return '';
  if(itinerary.code==='position'&&itinerary.legLabel){
    const chainConflict=String(itinerary.previousLegLabel||'').startsWith('new ');
    if(chainConflict){
      return `${ac.tail} can make the requested departure, but the added ${kind} would leave it at ${itinerary.location}, not ${itinerary.requiredLocation}, before ${itinerary.legLabel}.`;
    }
  }
  if(itinerary.code==='turnaround'&&itinerary.legLabel){
    return `${ac.tail} cannot fit this ${kind}: turnaround before ${itinerary.legLabel} is ${itinerary.actualTurn} min; ${ac.model} requires ${itinerary.minimumTurn} min at ${itinerary.airport}.`;
  }
  return `${ac.tail} cannot fit this ${kind}: ${itinerary.reason}.`;
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
    maintenanceCost:0,weatherCost:0,defectSeverity:'',flightType,cancelled:false,cancelledAt:0,cancellationCost:0,cancellationReason:'',
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
  const availability=aircraftDepartureAvailability(ac,from,departure);
  if(!availability.ok) return toast(availability.reason);
  if(scheduleType==='once'){
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure,arrival:departure+outbound.duration,label:'new flight'}]);
    if(!itinerary.ok) return toast(aircraftItineraryFailureMessage(ac,itinerary,'flight'));
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
  if(!itinerary.ok) return toast(aircraftItineraryFailureMessage(ac,itinerary,'round trip'));

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

function flightCanBeCancelled(f,t=simNow()){
  if(!f||f.cancelled||flightHasCompleted(f,t)) return false;
  return ['scheduled','delayed','taxi_out'].includes(statusOfFlight(f,t));
}

function flightCancellationUnavailableReason(f,t=simNow()){
  if(!f||f.cancelled) return 'The affected flight is no longer available.';
  const status=statusOfFlight(f,t);
  if(status==='airborne'||status==='taxi_in') return 'Aircraft is airborne or landing; use an airborne recovery path.';
  if(status==='arrived'||flightHasCompleted(f,t)) return 'Completed flight cannot be cancelled.';
  return '';
}

function flightCancellationTargets(f){
  if(!f.serviceId||f.serviceLeg!=='outbound') return [f];
  const rotation=rotationForFlight(f);
  return [rotation.outbound,rotation.returnFlight].filter(Boolean).filter(item=>flightCanBeCancelled(item));
}

function turnaroundCancellationTargets(f){
  if(!f?.serviceId) return [];
  const rotation=rotationForFlight(f);
  const targets=[rotation.outbound,rotation.returnFlight]
    .filter(Boolean)
    .filter(item=>flightCanBeCancelled(item));
  return [...new Map(targets.map(item=>[item.id,item])).values()];
}

function applyFlightCancellation(flight,reason='',{preserveIncidentId=''}={}){
  const now=simNow();
  if(!flightHasDeparted(flight,now)){
    flight.departureLogged=false;
    flight.settled=false;
  }
  const cancellationCost=typeof cancellationRecoveryCost==='function'?cancellationRecoveryCost(flight):0;
  flight.cancelled=true;
  flight.cancelledAt=now;
  flight.cancellationCost=cancellationCost;
  flight.cancellationReason=reason||'Cancelled';
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
    if(preserveIncidentId&&incident.id===preserveIncidentId) continue;
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
  const blocker=flightCancellationUnavailableReason(f);
  if(blocker) return toast(blocker);
  const targets=flightCancellationTargets(f);
  const pairing=targets.length>1?' The paired return leg will also be cancelled so the aircraft remains correctly positioned.':'';
  if(!skipConfirm&&!AeroServices.confirm(`Cancel ${f.id}?${pairing}`)) return;
  for(const flight of targets) applyFlightCancellation(flight,reason);
  return finishFlightCancellations(targets,`${targets.map(item=>item.id).join(' and ')} cancelled.`);
}

function cancelSingleFlight(flightId,{skipConfirm=false,reason='Manual OCC cancellation'}={}){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const blocker=flightCancellationUnavailableReason(flight);
  if(blocker) return toast(blocker);
  const rotationWarning=flight.serviceId?' This cancels only this leg; any paired leg remains in the programme and may need aircraft recovery.':'';
  if(!skipConfirm&&!AeroServices.confirm(`Cancel single flight ${flight.id}?${rotationWarning}`)) return false;
  applyFlightCancellation(flight,reason);
  return finishFlightCancellations([flight],`${flight.id} cancelled.`);
}

function cancelTurnaround(flightId,{skipConfirm=false,reason='Manual OCC turnaround cancellation'}={}){
  const flight=state.flights.find(item=>item.id===flightId&&!item.cancelled);
  const blocker=flightCancellationUnavailableReason(flight);
  if(blocker) return toast(blocker);
  const targets=turnaroundCancellationTargets(flight);
  if(targets.length<2) return toast('No complete future turnaround pair is available for this flight.');
  const label=targets.map(item=>item.id).join(' + ');
  if(!skipConfirm&&!AeroServices.confirm(`Cancel turnaround ${label}? Future rotations in the recurring schedule stay active.`)) return false;
  for(const target of targets) applyFlightCancellation(target,reason);
  return finishFlightCancellations(targets,`Turnaround ${label} cancelled. Recurring schedule remains active.`);
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
  AeroServices.commit(); requestUiRefresh('selects','schedule','left','desk','filter','map');
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
  AeroServices.commit(); requestUiRefresh('selects','schedule','left','desk','filter','map');
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
