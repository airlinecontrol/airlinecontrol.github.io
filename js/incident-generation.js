/* Training, random, weather-triggered, and enroute incident generation. */

const PRE_DEPARTURE_INCIDENT_GENERATORS=[
  {type:'crew_sick',weight:1.05,eligible:f=>flightUsesLocalCrew(f)},
  {type:'mel_defect',weight:.9,eligible:(f,t)=>Management.maintenanceStatus(state.aircraft.find(a=>a.id===f.aircraftId),t)?.due||simulationRandom(`mel-eligibility:${f.id}`)<.45},
  {type:'destination_closure_ground',weight:.5,eligible:f=>distanceKm(AIRPORTS[f.from],AIRPORTS[f.to])>250},
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
  let roll=simulationRandom(`ground-delay-cause:${f.id}`)*options.reduce((total,item)=>total+item.weight,0);
  for(const option of options){
    roll-=option.weight;
    if(roll<=0) return option.label;
  }
  return 'Ground handling delay';
}

function chooseIncidentGenerator(f,t){
  const options=PRE_DEPARTURE_INCIDENT_GENERATORS.filter(item=>!item.eligible||item.eligible(f,t));
  let roll=simulationRandom(`incident-generator:${f.id}`)*options.reduce((total,item)=>total+item.weight,0);
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
  if(!openIncidentsForFlight(f.id).length&&simulationRandom(`operational-incident:${f.id}`)<.16){
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
  const roll=simulationRandom(`predeparture-issue:${f.id}`);
  const ac=state.aircraft.find(a=>a.id===f.aircraftId);
  const maintenance=ac?Management.maintenanceStatus(ac,t):null;
  const conditionFactor=(1+(100-(ac?.condition??100))/25)*(maintenance?.due?1.55:1);
  const technicalChance=clamp(.025*conditionFactor,.025,.15);
  if(roll<technicalChance){
    createIncident('mel_defect',f,{detectedAt:t});
  }else if(roll<technicalChance+.135){
    const delay=10+Math.floor(simulationRandom(`predeparture-delay:${f.id}`)*31);
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
  const routeWeather=window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(f,f.departure,{forecast:true})
    ||window.AeroWeatherEngine?.routeHazardSummary?.(f.from,destination,f.departure)
    ||{delayMin:0,hazards:[]};
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
  const closureActive=destinationWeather.level==='severe'&&destinationWeather.capacityFactor<.7;
  if(closureActive){
    const source=weatherSourceRecord('live_destination_forecast','Destination forecast',{weather:destinationWeather,timestamp:t+45*MIN});
    const type=f.diversionAirport?'diversion_airport_unavailable':'destination_closure';
    const destinationKey=`weather-destination:${type}:${f.id}:${destination}`;
    const incident=createIncident(type,f,{detectedAt:t,source:'weather',sourceKey:destinationKey,context:{
      airport:destination,conditions:destinationWeather.conditions,capacityFactor:destinationWeather.capacityFactor,delayMin:destinationWeather.delayMin,
      forecastAt:t+45*MIN,weatherSource:source,weatherSummary:weatherSourceText(source),
      reason:f.diversionAirport?`${destination} weather deteriorated after diversion selection`:'Destination airport closed by weather'
    }});
    if(incident){ incident.airport=destination; changed=true; }
  }
  const minimaContext=destinationBelowMinimaContextForFlight(f,t);
  if(updateOpenDerivedIncident('destination_below_minima',f,!closureActive&&Boolean(minimaContext?.active),minimaContext,t)) changed=true;
  if(maybeDetectLightningStrike(f,t)) changed=true;
  const routeContext=routeRerouteContextForFlight(f,t);
  const routeActive=Boolean(routeContext&&routeContext.delayMin>=12);
  if(updateOpenDerivedIncident('airborne_atc_reroute',f,routeActive,routeContext,t)) changed=true;
  if(routeActive&&!f.weatherLiveChecks.routeApplied){
    const delay=Math.min(35,Math.max(8,routeContext.delayMin));
    f.enrouteDelayMin=Math.max(Number(f.enrouteDelayMin)||0,delay);
    f.liveWeatherDelayMin=Math.max(Number(f.liveWeatherDelayMin)||0,Math.round(delay*.35));
    window.AeroRoutePlanning?.createRouteRevision?.(f,{
      mode:'weather_detour',
      reason:'Weather avoidance route assigned',
      hazards:routeContext.hazards||[],
      createdAt:t,
      metadata:{source:'live_route_weather'}
    });
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
