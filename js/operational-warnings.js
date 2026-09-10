/* Derived operational warning model and warning stability memory. */
(function(global){
function warningLevelRank(level){
  return ({critical:0,warning:1,watch:2})[level]??3;
}
const WARNING_CLEAR_GRACE_MS=60*MIN;
const WARNING_SUPERSEDING_INCIDENTS={
  destination_weather:new Set(['destination_below_minima','destination_closure','destination_closure_ground'])
};

function warningFlightWindow(now=simNow()){
  return {start:now-30*MIN,end:now+24*HOUR};
}

function warningDismissKey(warning){
  return String(warning?.id||'');
}

function warningStableKey(warning){
  return String(warning?.id||'');
}

function warningMemoryStillRelevant(warning){
  if(!warning) return false;
  if(warning.flightId){
    const flight=state.flights.find(item=>item.id===warning.flightId);
    if(!flight||flight.cancelled||flight.settled) return false;
    const superseders=WARNING_SUPERSEDING_INCIDENTS[warning.type];
    if(superseders&&openIncidentsForFlight(warning.flightId).some(incident=>superseders.has(incident.type))) return false;
  }
  if(warning.aircraftId){
    const aircraft=state.aircraft.find(item=>item.id===warning.aircraftId);
    if(!aircraft) return false;
    if(warning.type==='mel_restriction'&&!melClearancePlanForAircraft(aircraft).needsWarning) return false;
  }
  return true;
}

function operationWarningRegistry(){
  state.warningRegistry??={};
  return state.warningRegistry;
}

function stabilizeOperationWarnings(rawWarnings,now=simNow()){
  const memory=operationWarningRegistry();
  const activeKeys=new Set();
  const warnings=[];
  let changed=false;

  for(const warning of rawWarnings){
    const key=warningStableKey(warning);
    if(!key) continue;
    activeKeys.add(key);
    const previous=memory[key];
    const stable={
      ...warning,
      id:key,
      firstSeenAt:previous?.firstSeenAt||now,
      lastSeenAt:now,
      clearSince:0,
      clearing:false
    };
    if(previous&&!previous.clearSince&&previous.level===warning.level){
      stable.title=previous.title;
      stable.detail=previous.detail;
      stable.sortAt=previous.sortAt;
    }
    memory[key]=stable;
    warnings.push(stable);
    if(!previous||previous.clearSince) changed=true;
  }

  for(const key of Object.keys(memory)){
    if(activeKeys.has(key)) continue;
    const previous=memory[key];
    if(!previous) continue;
    if(!warningMemoryStillRelevant(previous)){
      delete memory[key];
      changed=true;
      continue;
    }
    if(!previous.clearSince){
      previous.clearSince=now;
      previous.lastSeenAt=previous.lastSeenAt||now;
      changed=true;
    }
    if(now-previous.clearSince<WARNING_CLEAR_GRACE_MS){
      warnings.push({...previous,clearing:true,level:previous.level==='critical'?'warning':previous.level});
    }else{
      delete memory[key];
      changed=true;
    }
  }

  if(changed) save();
  return warnings.sort((a,b)=>warningLevelRank(a.level)-warningLevelRank(b.level)||a.sortAt-b.sortAt||a.title.localeCompare(b.title));
}

function visibleOperationWarnings(warnings){
  workspaceUi.dismissedWarnings??={};
  const activeKeys=new Set(warnings.map(warningDismissKey));
  let changed=false;
  for(const key of Object.keys(workspaceUi.dismissedWarnings)){
    if(!activeKeys.has(key)){
      delete workspaceUi.dismissedWarnings[key];
      changed=true;
    }
  }
  if(changed) saveWorkspaceUi();
  return warnings.filter(warning=>!workspaceUi.dismissedWarnings[warningDismissKey(warning)]);
}
function dismissWarning(key){
  if(!key) return;
  workspaceUi.dismissedWarnings??={};
  workspaceUi.dismissedWarnings[key]=simNow();
  saveWorkspaceUi();
  markUiDirty('desk');
  toast('Warning dismissed.');
}

function connectionSeverityScore(manifest){
  if(!manifest) return 0;
  return (manifest.critical||0)*3+(manifest.atRisk||0)*2+(manifest.total||0)*.01;
}

function displayConnectionManifest(manifest){
  const connections=(manifest?.connections||[]).filter(connection=>['critical','at-risk'].includes(connection.status));
  return {
    ...(manifest||{}),
    connections,
    total:connections.reduce((sum,item)=>sum+(item.pax||0),0),
    critical:connections.filter(item=>item.status==='critical').reduce((sum,item)=>sum+(item.pax||0),0),
    atRisk:connections.filter(item=>item.status==='at-risk').reduce((sum,item)=>sum+(item.pax||0),0),
    missed:0
  };
}

function connectionRowsForWidget(){
  const now=simNow();
  return state.flights
    .filter(flight=>!flight.cancelled&&flight.flightType!=='ferry'&&flightActualArrival(flight)>now-2*HOUR&&flightActualArrival(flight)<now+24*HOUR)
    .sort((a,b)=>flightActualArrival(a)-flightActualArrival(b))
    .slice(0,140)
    .map(flight=>({flight,manifest:displayConnectionManifest(connectionStatusForFlight(flight))}))
    .filter(row=>row.manifest.connections.length)
    .sort((a,b)=>connectionSeverityScore(b.manifest)-connectionSeverityScore(a.manifest)||flightActualArrival(a.flight)-flightActualArrival(b.flight));
}

function operationWarnings(now=simNow(),index=operationalIndex(now)){
  const {start,end}=warningFlightWindow(now);
  const warnings=[];
  const add=warning=>{
    if(!warning?.id) return;
    warnings.push({level:'warning',owner:'Dispatch',sortAt:now,...warning});
  };
  const flights=state.flights
    .filter(flight=>!flight.cancelled&&!flight.settled&&flightActualArrival(flight)>start&&flightActualDeparture(flight)<end)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)||a.id.localeCompare(b.id));
  const flightsByAircraft=new Map();
  for(const flight of flights) mapPush(flightsByAircraft,flight.aircraftId,flight);
  for(const [aircraftId,aircraftFlights] of flightsByAircraft.entries()){
    aircraftFlights.sort((a,b)=>a.departure-b.departure||a.id.localeCompare(b.id));
    const aircraft=index.aircraftById.get(aircraftId)||state.aircraft.find(item=>item.id===aircraftId);
    for(let i=1;i<aircraftFlights.length;i++){
      const previous=aircraftFlights[i-1],next=aircraftFlights[i];
      const turn=turnaroundGapInfo(previous,next,aircraft);
      if(!turn?.plannedBelowMinimum) continue;
      const gapLabel=turn.plannedGapMin<0?'overlap':`${Math.max(0,turn.plannedGapMin)}m`;
      add({
        id:`short-turn:${next.id}`,
        type:'short_turn',
        group:'Short turns',
        level:turn.plannedShortageMin>=15?'critical':'warning',
        owner:'Dispatch',
        flightId:next.id,
        aircraftId:next.aircraftId,
        title:`Short turn ${gapLabel}/${turn.minimumMin}m`,
        detail:`${previous.id} -> ${next.id} at ${next.from} · planned ${turn.plannedShortageMin} min under minimum`,
        sortAt:next.departure
      });
    }
  }
  for(const flight of flights){
    const destination=flightOperationalDestination(flight);
    const handlingDelay=Math.max(0,Number(flight.handlingDelayMin)||0);
    const handlingCause=flight.handlingDelayCause||'Ground handling delay';
    const loadControlAffected=/baggage|load-control|loadsheet/i.test(handlingCause);
    if(loadControlAffected&&handlingDelay>=10&&!flight.departureLogged){
      add({
        id:`load-control:${flight.id}`,
        type:'load_control_warning',
        group:'Station readiness',
        level:handlingDelay>=30?'warning':'watch',
        owner:'Station',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:'Load-control delay',
        detail:`${flight.id} ${handlingCause} · +${handlingDelay} min`,
        sortAt:flightActualDeparture(flight)
      });
    }
    if(!flight.fueled&&!flight.departureLogged&&now>=flight.departure-60*MIN&&now<flightActualDeparture(flight)){
      add({
        id:`fuel-uplift:${flight.id}`,
        type:'fuel_uplift_warning',
        group:'Station readiness',
        level:now>=flight.departure-20*MIN?'warning':'watch',
        owner:'Station',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:'Fuel uplift pending',
        detail:`${flight.id} at ${flight.from} · fueling window open`,
        sortAt:flight.departure
      });
    }
    const late=lateInboundStatusForFlight(flight,now,{index});
    if(late.active){
      add({
        id:`late-inbound:${flight.id}`,
        type:'late_inbound',
        group:'Late inbound',
        level:late.delayMin>=60?'critical':'warning',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:`Late inbound +${late.delayMin} min`,
        detail:`${late.previousFlightId} makes ${flight.id} ready at ${shortClock(late.inboundReadyAt)}`,
        sortAt:flight.departure
      });
    }
    const departureStatus=airportNightStatus(flight.from,flightActualDeparture(flight));
    const arrivalStatus=airportNightStatus(destination,flightActualArrival(flight));
    const affected=[{...departureStatus,phase:'departure',time:flightActualDeparture(flight)},{...arrivalStatus,phase:'arrival',time:flightActualArrival(flight)}]
      .filter(status=>status.status!=='open');
    if(affected.some(status=>status.status==='closed')||Number(flight.nightRestrictionConflictDelayMin)>0||Number(flight.nightRestrictionDelayMin)>0){
      const hard=affected.find(status=>status.status==='closed');
      const status=hard||affected[0]||{};
      const conflict=Number(flight.nightRestrictionConflictDelayMin)>0||Boolean(hard);
      add({
        id:`night:${flight.id}`,
        type:conflict?'night_conflict':'night_restriction',
        group:conflict?'Night curfew conflicts':'Night restrictions',
        level:conflict?'critical':'watch',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:conflict?'Night curfew conflict':'Night operations restriction',
        detail:affected.length
          ? affected.map(item=>`${item.airport} ${item.phase} ${shortClock(item.time)} · ${item.label}`).join(' · ')
          : `${flight.from}/${destination} · ${flight.nightRestrictionLabel||flight.nightRestrictionConflictLabel||'night operations impact'}`,
        sortAt:status.time||flightActualDeparture(flight)
      });
    }
    const alternateContext=typeof alternateSuitabilityContextForFlight==='function'&&flightIsAirborne(flight,now)
      ? alternateSuitabilityContextForFlight(flight,now)
      : null;
    if(alternateContext?.active){
      add({
        id:`alternate-coverage:${flight.id}`,
        type:'alternate_coverage',
        group:'Alternate coverage',
        level:alternateContext.availableAlternates>0?'warning':'critical',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:`Alternate coverage low · ${alternateContext.availableAlternates} suitable`,
        detail:`${destination} ${alternateContext.conditions||'weather'} · capacity ${alternateContext.capacityPct||0}% · destination delay +${alternateContext.delayMin||0} min`,
        sortAt:flightActualArrival(flight)
      });
    }
    const destinationWeather=typeof destinationWeatherContextForFlight==='function'&&flightIsAirborne(flight,now)
      ? destinationWeatherContextForFlight(flight,now)
      : null;
    const belowMinima=destinationWeather&&typeof destinationBelowMinimaContextForFlight==='function'
      ? destinationBelowMinimaContextForFlight(flight,now)
      : null;
    const closureActive=destinationWeather?.level==='severe'&&Number(destinationWeather.capacityFactor)<.7;
    const weatherActive=Boolean(destinationWeather&&!belowMinima?.active&&!closureActive&&destinationWeather.level!=='normal'&&(Number(destinationWeather.delayMin)>=12||Number(destinationWeather.capacityFactor)<.86));
    if(weatherActive){
      add({
        id:`destination-weather:${flight.id}`,
        type:'destination_weather',
        group:'Destination weather',
        level:Number(destinationWeather.capacityFactor)<.76||Number(destinationWeather.delayMin)>=30?'critical':'warning',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:`Destination weather ${destinationWeather.capacityPct||0}%`,
        detail:`${destination} ${destinationWeather.conditions||'weather'} · ETA ${shortClock(flightActualArrival(flight))} · forecast ${shortClock(destinationWeather.forecastAt||now)} · possible +${destinationWeather.delayMin||0} min`,
        sortAt:flightActualArrival(flight)
      });
    }
    const capacityContext=airportCapacityContextForFlight(flight,now);
    const groundStopContext=atcGroundStopContextForFlight(flight,now);
    if(capacityContext?.active&&!groundStopContext?.active){
      add({
        id:`airport-flow:${flight.id}`,
        type:'airport_flow_warning',
        group:'Airport flow',
        level:capacityContext.delayMin>=35?'warning':'watch',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:`Airport flow +${capacityContext.delayMin} min`,
        detail:`${capacityContext.airport} ${capacityContext.reason} · capacity ${capacityContext.capacityPct||0}%`,
        sortAt:flightActualDeparture(flight)
      });
    }
    const performanceContext=performanceLimitContextForFlight(flight,now);
    if(performanceContext?.active&&!performanceLimitIncidentRequired(performanceContext)){
      add({
        id:`performance-margin:${flight.id}`,
        type:'performance_margin_warning',
        group:'Performance margins',
        level:Number(performanceContext.rangeMarginKm)<90||Number(performanceContext.fuelMarginGal)<Number(performanceContext.fuelCapacityGal)*.04?'warning':'watch',
        owner:'Dispatch',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:'Performance margin degraded',
        detail:`${flight.id} ${flight.from} -> ${destination} · range margin ${performanceContext.rangeMarginKm} km · payload buffer ${performanceContext.payloadReductionPct}%`,
        sortAt:flightActualDeparture(flight)
      });
    }
    const handlingContext=destinationHandlingContextForFlight(flight,now);
    if(handlingContext?.active&&!destinationHandlingIncidentRequired(flight,handlingContext)){
      add({
        id:`destination-handling:${flight.id}`,
        type:'destination_handling_warning',
        group:'Destination handling',
        level:flightActualArrival(flight)-now<90*MIN?'warning':'watch',
        owner:'Station',
        flightId:flight.id,
        aircraftId:flight.aircraftId,
        title:'Destination handling not ready',
        detail:`${destination} has no handling team at ETA ${shortClock(flightActualArrival(flight))}`,
        sortAt:flightActualArrival(flight)
      });
    }
  }
  for(const row of connectionRowsForWidget()){
    const manifest=row.manifest;
    const affected=(manifest.connections||[]).filter(connection=>['critical','at-risk'].includes(connection.status));
    if(!affected.length) continue;
    const critical=affected.filter(connection=>connection.status==='critical').reduce((sum,connection)=>sum+(connection.pax||0),0);
    const atRisk=affected.filter(connection=>connection.status==='at-risk').reduce((sum,connection)=>sum+(connection.pax||0),0);
    const examples=affected.slice(0,3).map(connection=>`${connection.flightId} ${connection.pax||0} pax ${connection.status==='at-risk'?'at risk':'critical'}`).join(' · ');
    add({
      id:`connection-risk:${row.flight.id}`,
      type:'connection_risk',
      group:'Connection risks',
      level:critical?'critical':'warning',
      owner:'Network',
      flightId:row.flight.id,
      aircraftId:row.flight.aircraftId,
      title:`Connection risk ${critical?`${critical} critical`:''}${critical&&atRisk?' · ':''}${atRisk?`${atRisk} at risk`:''}`,
      detail:`${row.flight.id} inbound at ${flightOperationalDestination(row.flight)} · ${examples}`,
      sortAt:flightActualArrival(row.flight)
    });
  }
  for(const duty of state.crewDuties||[]){
    if(duty.status==='completed'||duty.dutyEnd<start||duty.dutyStart>end) continue;
    const margin=Number(duty.maxHours||0)-Number(duty.dutyHours||0);
    if(duty.legal&&margin>1.5) continue;
    const dutyFlights=(duty.flightIds||[]).map(id=>index.flightsById.get(id)).filter(Boolean);
    const focusFlight=dutyFlights.find(flight=>flightActualArrival(flight)>=now)||dutyFlights[0];
    add({
      id:`crew-duty:${duty.id}`,
      type:'crew_duty',
      group:'Crew duty margins',
      level:duty.legal?'warning':'critical',
      owner:'Crew Control',
      flightId:focusFlight?.id||'',
      aircraftId:duty.aircraftId||focusFlight?.aircraftId||'',
      title:duty.legal?`Crew duty margin ${Math.max(0,Math.round(margin*60))}m`:'Crew duty limit exceeded',
      detail:`${(duty.flightIds||[]).join(' + ')||'assigned duty'} · release ${shortClock(duty.releaseAt||duty.dutyEnd)}`,
      sortAt:duty.dutyStart
    });
  }
  for(const aircraft of state.aircraft||[]){
    const status=Management.maintenanceStatus(aircraft,now);
    const activeOrNext=index.activeFlightByAircraft.get(aircraft.id)||index.upcomingFlightByAircraft.get(aircraft.id);
    if(!status.grounding&&status.progress<.9) continue;
    add({
      id:`maintenance:${aircraft.id}`,
      type:'maintenance',
      group:'Maintenance',
      level:status.grounding?'critical':status.due?'warning':'watch',
      owner:'Maintenance',
      flightId:activeOrNext?.id||'',
      aircraftId:aircraft.id,
      title:status.grounding?'Mandatory check overdue':status.due?'Maintenance due':'Maintenance due soon',
      detail:`${aircraft.tail} · ${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles remaining`,
      sortAt:activeOrNext?flightActualDeparture(activeOrNext):now+12*HOUR
    });
  }
  for(const aircraft of state.aircraft||[]){
    const plan=melClearancePlanForAircraft(aircraft,now);
    if(!plan.needsWarning) continue;
    const activeOrNext=index.activeFlightByAircraft.get(aircraft.id)||index.upcomingFlightByAircraft.get(aircraft.id);
    const limitingItem=plan.items.slice().sort((a,b)=>
      (melItemExpired(b,now)?1:0)-(melItemExpired(a,now)?1:0)||
      (Number(a.expiresAt)||Infinity)-(Number(b.expiresAt)||Infinity)||
      (Number(a.remainingCycles)||Infinity)-(Number(b.remainingCycles)||Infinity)
    )[0];
    const title=plan.expired
      ? `Expired MEL ${limitingItem?.code||''}`.trim()
      : plan.scheduled
        ? `MEL expires before check`
        : `MEL clearance not scheduled`;
    const detailParts=[
      aircraft.tail,
      `${plan.items.length} active MEL item${plan.items.length===1?'':'s'}`,
      limitingItem?`MEL ${limitingItem.code||''} · ${melRemainingLabel(limitingItem,now)}`:'',
      plan.scheduled?`${String(plan.job.label||'maintenance').toLowerCase()} ${shortDay(plan.job.start)} ${shortClock(plan.job.start)}`:'schedule maintenance work'
    ].filter(Boolean);
    add({
      id:`mel-restriction:${aircraft.id}`,
      type:'mel_restriction',
      group:'Maintenance restrictions',
      level:plan.expired||plan.scheduled?'critical':'warning',
      owner:'Maintenance',
      flightId:activeOrNext?.id||'',
      aircraftId:aircraft.id,
      title,
      detail:detailParts.join(' · '),
      sortAt:activeOrNext?flightActualDeparture(activeOrNext):now+10*HOUR
    });
  }
  return stabilizeOperationWarnings(warnings,now);
}

  const api={
    warningLevelRank,warningFlightWindow,warningDismissKey,warningStableKey,
    operationWarningRegistry,stabilizeOperationWarnings,visibleOperationWarnings,
    dismissWarning,operationWarnings,
    connectionSeverityScore,displayConnectionManifest,connectionRowsForWidget
  };
  global.AeroOperationalWarnings=api;
  Object.assign(global,api);
})(window);
