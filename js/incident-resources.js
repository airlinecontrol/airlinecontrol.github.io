/* Resource and eligibility checks for OCC incident tasks. */
(function(global){
  function activeWorkflowAssignments(t=simNow()){
    return (state.resourceAssignments||[]).filter(item=>['assigned','committed'].includes(item.status)&&item.releaseAt>t);
  }

  function crewPoolOptions(incident){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return [];
    return crewPoolOptionsAtAirport(incident,flight.from);
  }

  function crewPoolOptionsAtAirport(incident,airport){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft||!AIRPORTS[airport]) return [];
    const role=incident.affectedRole||'captains';
    const family=Management.aircraftFamily(aircraft.model);
    const reserved=activeWorkflowAssignments().filter(item=>item.role===role).reduce((map,item)=>map.set(item.base,(map.get(item.base)||0)+item.amount),new Map());
    const t=simNow();
    const roster=['captains','firstOfficers'].includes(role)&&typeof availableQualifiedStaffAt==='function'
      ? availableQualifiedStaffAt(airport,role,family,t,flight.id)
      : typeof availableStaffAt==='function'
        ? availableStaffAt(airport,role,t,flight.id)
        : ['captains','firstOfficers'].includes(role)?qualifiedStaffAt(airport,role,family):staffAt(airport,role);
    const available=Math.max(0,roster-(reserved.get(airport)||0));
    if(!available) return [];
    return [{id:`${airport}:${role}`,airport,role,family,available,reportMin:20,
      label:`${airport} ${PERSONNEL[role]?.label||role} reserve · ${available} available · response 20 min`}];
  }

  function remoteCrewPoolOptions(incident){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) return [];
    return Object.keys(AIRPORTS).filter(code=>code!==flight.from)
      .flatMap(code=>crewPoolOptionsAtAirport(incident,code).map(option=>({
        ...option,reportMin:Math.ceil(45+distanceKm(AIRPORTS[code],AIRPORTS[flight.from])/700*60),
        label:`${code} ${PERSONNEL[option.role]?.label||option.role} reserve · ${option.available} available · move to ${flight.from}`
      })))
      .sort((a,b)=>a.reportMin-b.reportMin||b.available-a.available);
  }

  function diversionRouteDurationMs(km,model){
    return (.45+km/model.speedKmh)*HOUR;
  }

  function diversionFuelEstimate(flight,aircraft,km){
    const model=MODELS[aircraft.model];
    const performance=aircraftFuelPerformance(model);
    const planned=flightFuelPlan(flight.from,flight.to,aircraft);
    const plannedDuration=Math.max(1,(Number.isFinite(flight.operationalDurationMs)?flight.operationalDurationMs:flight.arrival-flight.departure));
    const airborne=Boolean(flight.departureLogged&&flightActualDeparture(flight)<=simNow()&&simNow()<flightActualArrival(flight));
    const progress=airborne?clamp((simNow()-flightActualDeparture(flight))/plannedDuration,0,1):0;
    const onboard=flight.fueled?(flight.fuelOnboardAtDeparture||planned.requiredGal):Math.max(planned.requiredGal,aircraft.fuelGallons||0);
    const remaining=Math.max(0,onboard-(flight.tripFuelGallons||planned.tripBurnGal)*progress);
    const required=Math.ceil(performance.burnGalPerHour*(diversionRouteDurationMs(km,model)/HOUR)+performance.burnGalPerHour*.45);
    return {remaining,required,ok:remaining>=required||!flight.departureLogged,estimated:Boolean(airborne||flight.fueled)};
  }

  function diversionHandlingAvailability(code,t=simNow()){
    const airport=AIRPORTS[code], market=AIRPORT_MARKETS[code], costs=AIRPORT_COSTS[code], ops=AIRPORT_OPS[code];
    if(!airport||!market||!costs||!ops) return {available:false,score:0,source:'none',label:'missing airport handling profile'};
    const stationStaff=staffAt(code,'groundHandling');
    if(stationStaff>0){
      return {
        available:true,
        score:Math.min(100,70+stationStaff*2),
        source:'station',
        staff:stationStaff,
        responseMin:10,
        label:`own station handling · ${stationStaff} team${stationStaff===1?'':'s'}`
      };
    }
    const contractScore=Math.round((market.size*.45+market.hub*.35+market.business*.12+market.tourism*.08)*100);
    const available=contractScore>=58 && costs.handlingBase>0;
    return {
      available,
      score:available?contractScore:0,
      source:available?'contract':'none',
      staff:0,
      responseMin:available?Math.round(18+(100-contractScore)*.35):0,
      label:available?`contract handling likely · ${contractScore}% readiness`:'no modeled diversion handler'
    };
  }

  function diversionAnchorForIncident(incident,flight,aircraft,t=simNow()){
    const airborne=Boolean(
      flight?.departureLogged&&
      flightActualDeparture(flight)<=t&&
      t<flightActualArrival(flight)
    );
    if(airborne&&aircraft){
      const position=currentAircraftPosition(aircraft,t);
      if(position&&position.status!=='ground'){
        return {
          type:'aircraft',
          lat:position.lat,
          lon:position.lon,
          label:'current aircraft position',
          status:position.status
        };
      }
    }
    const airport=AIRPORTS[flight?.from]||AIRPORTS[state.home];
    return {
      type:'origin',
      airport:flight?.from||state.home,
      lat:airport.lat,
      lon:airport.lon,
      label:`${flight?.from||state.home} origin`
    };
  }

  function diversionDistanceFromAnchor(anchor,code){
    const airport=AIRPORTS[code];
    return airport&&anchor ? distanceKm(anchor,airport) : Infinity;
  }

  function diversionCandidatesForIncident(incident,{includeReturnOrigin=true,onlyReturnOrigin=false}={}){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return [];
    const destination=flightOperationalDestination(flight);
    const anchor=diversionAnchorForIncident(incident,flight,aircraft);
    return Object.keys(AIRPORTS).filter(code=>code!==destination&&(includeReturnOrigin||code!==flight.from)).map(code=>{
      const returnOrigin=code===flight.from;
      if(onlyReturnOrigin&&!returnOrigin) return null;
      const km=Math.max(40,diversionDistanceFromAnchor(anchor,code));
      const destinationKm=distanceKm(AIRPORTS[destination],AIRPORTS[code]);
      const weather=Management.weatherAt(code,simNow());
      const rangeOk=km<=MODELS[aircraft.model].maxRangeKm;
      const handling=diversionHandlingAvailability(code);
      const fuel=diversionFuelEstimate(flight,aircraft,km);
      const weatherOk=weather.level!=='severe';
      const duration=diversionRouteDurationMs(km,MODELS[aircraft.model]);
      const destinationBias=anchor.type==='aircraft' ? destinationKm/180 : destinationKm/80;
      const suitability=(rangeOk?100:0)-km/70-destinationBias+(returnOrigin?12:0)+(weather.level==='normal'?15:weather.level==='caution'?0:-30)+Math.min(12,handling.score/8)+(fuel.ok?0:-80);
      const rejectionReasons=[
        rangeOk?'':`outside ${MODELS[aircraft.model].maxRangeKm} km range`,
        weatherOk?'':`${weather.conditions||'severe weather'} at alternate`,
        handling.available?'':handling.label,
        fuel.ok?'':`fuel ${Math.round(fuel.remaining)} gal remaining / ${Math.round(fuel.required)} gal required`
      ].filter(Boolean);
      return {
        code,km,destinationKm,weather,weatherOk,handling,rangeOk,fuel,returnOrigin,rejectionReasons,
        anchor:{type:anchor.type,label:anchor.label,status:anchor.status||'',airport:anchor.airport||''},
        duration,durationMode:anchor.type==='aircraft'?'remaining_from_anchor':'total_from_origin',suitability
      };
    }).filter(Boolean);
  }

  function diversionOptionsForIncident(incident,options={}){
    return diversionCandidatesForIncident(incident,options)
      .filter(item=>item.rangeOk&&item.weatherOk&&item.handling?.available&&item.fuel.ok)
      .sort((a,b)=>b.suitability-a.suitability)
      .slice(0,5);
  }

  function diversionRejectionSummaryForIncident(incident,options={}){
    const candidates=diversionCandidatesForIncident(incident,options);
    if(!candidates.length) return 'No airport catalog candidates are available for this case.';
    const rejected=candidates.filter(item=>!(item.rangeOk&&item.weatherOk&&item.handling?.available&&item.fuel.ok));
    if(!rejected.length) return '';
    const counts={
      range:rejected.filter(item=>!item.rangeOk).length,
      weather:rejected.filter(item=>!item.weatherOk).length,
      handling:rejected.filter(item=>!item.handling?.available).length,
      fuel:rejected.filter(item=>!item.fuel.ok).length
    };
    const summary=Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=>`${count} ${key}`).join(' · ');
    const nearest=rejected
      .sort((a,b)=>a.km-b.km)
      .slice(0,3)
      .map(item=>`${item.code}: ${item.rejectionReasons.slice(0,2).join(', ')}`)
      .join(' · ');
    return `${summary}${nearest?` (${nearest})`:''}`;
  }

  function alternateUnavailableMessage(incident,options={}){
    const details=diversionRejectionSummaryForIncident(incident,options);
    return details
      ? `No suitable alternate is available yet: ${details}. Add a resource only if handling is the blocker; otherwise use fuel/range/weather alternatives.`
      : 'No suitable alternate is available yet.';
  }

  function crewAugmentationBlocker(incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return 'The affected flight is no longer available.';
    const rotation=rotationForFlight(flight);
    const through=rotationUsesThroughCrew(flight)&&rotation.outbound&&rotation.returnFlight;
    const augmented=OperationalIntelligence.crewDutyAssessment({
      departure:through?flightActualDeparture(rotation.outbound):flightActualDeparture(flight),
      arrival:through?flightActualArrival(rotation.returnFlight):flightActualArrival(flight),
      sectors:through?2:1,
      augmented:true
    });
    if(!augmented.legal) return 'Augmented crew would still exceed the duty envelope. Use replacement crew or cancel before departure.';
    const family=Management.aircraftFamily(aircraft.model);
    const availableCaptains=typeof availableQualifiedStaffAt==='function'?availableQualifiedStaffAt(flight.from,'captains',family,simNow(),flight.id):qualifiedStaffAt(flight.from,'captains',family);
    const availableFirstOfficers=typeof availableQualifiedStaffAt==='function'?availableQualifiedStaffAt(flight.from,'firstOfficers',family,simNow(),flight.id):qualifiedStaffAt(flight.from,'firstOfficers',family);
    const availableCabin=typeof availableStaffAt==='function'?availableStaffAt(flight.from,'cabinCrew',simNow(),flight.id):staffAt(flight.from,'cabinCrew');
    const missingCaptain=Math.max(0,2-availableCaptains);
    const missingFirstOfficer=Math.max(0,2-availableFirstOfficers);
    const cabinRequired=Math.max(2,Math.ceil(cabinSeatCount(aircraft)/50)*2);
    const missingCabin=Math.max(0,cabinRequired-availableCabin);
    const missing=[];
    if(missingCaptain) missing.push(`${missingCaptain} captain`);
    if(missingFirstOfficer) missing.push(`${missingFirstOfficer} first officer`);
    if(missingCabin) missing.push(`${missingCabin} cabin crew`);
    return missing.length?`Augmentation needs ${missing.join(', ')} at ${flight.from}. Add or move personnel in the Personnel widget.`:'';
  }

  function legalCrewConfirmationBlocker(incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return 'The affected flight is no longer available.';
    const departure=Math.max(flightActualDeparture(flight),simNow());
    const deficits=personnelDeficitsForFlight(aircraft,departure,flight.arrival-flight.departure,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType)
      .filter(item=>['captains','firstOfficers','cabinCrew'].includes(item.role));
    if(!deficits.length) return '';
    const missing=deficits.map(item=>`${PERSONNEL[item.role]?.label||item.role}${item.qualification?` rated ${item.qualification}`:''}: ${item.available}/${item.required}`).join(' · ');
    return `Crew is still not legal at ${flight.from}: ${missing}. Add, request, or move personnel in the Personnel widget.`;
  }

  function branchStrategyOptionBlocker(task,incident,optionId){
    if(!task||!incident) return '';
    if(optionId==='cancel'){
      const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
      if(!flight) return 'The affected flight is no longer available.';
      if(typeof flightCanBeCancelled==='function'&&!flightCanBeCancelled(flight)) return flightCancellationUnavailableReason(flight)||'Cancellation is only available before the aircraft is airborne.';
      if(staffAt(flight.from,'operations')<=0) return `No operations/dispatch personnel are available at ${flight.from}. Add personnel in the Personnel widget.`;
      return '';
    }
    if(['mx-strategy','mx-postflight-strategy'].includes(task.key)&&optionId==='defer'&&incident.technicalContext?.deferAllowed===false){
      return 'This finding is not deferrable under MEL. Schedule a maintenance check, substitute aircraft, or cancel before departure.';
    }
    if(['mx-strategy','mx-postflight-strategy','dispatch-position-strategy','dispatch-performance-strategy','mx-resource-strategy'].includes(task.key)&&optionId==='substitute'&&!incidentAircraftReplacementOptions(incident).length) return 'No suitable replacement aircraft is available. Add or position aircraft in Dispatch, then try again.';
    if(task.key==='station-fuel-outage-strategy'&&optionId==='tanker_inbound'){
      const plan=typeof fuelOutageTankerPlan==='function'?fuelOutageTankerPlan(incident):null;
      if(!plan?.available) return plan?.reason||'Inbound tanker fuel is not available for this rotation.';
    }
    if(task.key==='station-fuel-outage-strategy'&&optionId==='substitute'&&!incidentAircraftReplacementOptionsForTask(incident,task).length) return 'No suitable replacement aircraft is already fueled for this sector. Add a fueled aircraft or choose a different recovery.';
    if(task.key==='mx-resource-strategy'&&optionId==='send_mobile_team'){
      const plan=typeof mobileMaintenanceTeamPlan==='function'?mobileMaintenanceTeamPlan(incident):null;
      if(!plan?.available) return plan?.reason||'No mobile maintenance team is available.';
    }
    if(task.key==='crew-legal-strategy'&&optionId==='confirm') return legalCrewConfirmationBlocker(incident);
    if(['crew-duty-strategy','crew-fatigue-strategy'].includes(task.key)&&optionId==='augment'){
      const message=crewAugmentationBlocker(incident);
      if(message) return message;
    }
    if(task.key==='crew-extension-strategy'&&optionId==='protect_next'){
      const next=typeof nextSectorForCrewExtensionIncident==='function'?nextSectorForCrewExtensionIncident(incident):null;
      if(!next) return 'No unflown next sector exists for this duty. Record the duty extension or request priority handling instead.';
      const blocker=typeof crewSwapBlocker==='function'?crewSwapBlocker(next):'';
      if(blocker) return `${next.id}: ${blocker}`;
    }
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(['dispatch-capacity-strategy','dispatch-groundstop-strategy','dispatch-night-curfew-strategy','dispatch-ground-destination-strategy'].includes(task.key)&&staffAt(flight?.from,'operations')<=0){
      return `No operations/dispatch personnel are available at ${flight?.from||'the origin'}. Add personnel in the Personnel widget.`;
    }
    if(task.key==='station-stand-strategy'&&staffAt(flight?.from,'groundHandling')<=0){
      return `No ground handling team is available at ${flight?.from||'the origin'}. Add personnel in the Personnel widget.`;
    }
    if(task.key==='station-destination-handling-strategy'&&optionId==='delay_departure'){
      const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
      if(flight?.departureLogged) return 'The flight is already airborne. Secure destination handling or prepare an alternate instead.';
    }
    if(task.key==='station-destination-handling-strategy'&&optionId==='prepare_alternate'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return `${alternateUnavailableMessage(incident,{includeReturnOrigin:false})} Request destination handling or choose another strategy.`;
    if(task.key==='dispatch-ground-destination-strategy'&&optionId==='alternate_destination'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return `${alternateUnavailableMessage(incident,{includeReturnOrigin:false})} Delay or cancel the flight if no airport is workable.`;
    if(['crew-diversion-strategy','crew-report-delay-strategy'].includes(task.key)&&optionId==='replace'&&!crewPoolOptions(incident).length){
      const remote=remoteCrewPoolOptions(incident);
      return remote.length
        ? `No qualified crew are at ${flight?.from||'origin'}. Move personnel from ${remote[0].airport} first, then allocate locally.`
        : 'No qualified crew pool is available. Request or move personnel in the Personnel widget.';
    }
    return '';
  }

  function taskEligibilityBlocker(task,incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const phase=task?.eligibility?.phase;
    if(!phase||!flight) return '';
    if(phase==='pre_departure'&&flight.departureLogged) return 'This departure-hold action is only available before off-block.';
    if(phase==='pre_departure_unfueled'){
      if(flight.departureLogged) return 'Aircraft substitution is only available before departure.';
      if(flight.fueled) return 'The flight is already fueled. Use a delay, repair, or cancellation path instead.';
    }
    return '';
  }

  function taskResourceLocation(requirement,incident,flight){
    if(requirement.location==='selectedAlternate') return incident.selectedAlternate||'';
    if(requirement.location==='destination') return flightOperationalDestination(flight);
    return requirement.location==='origin' ? flight.from : requirement.location;
  }

  function taskResourceRequirementBlocker(requirement,task,incident,flight){
    if(requirement.type==='personnel'){
      const location=taskResourceLocation(requirement,incident,flight);
      const amount=Math.max(1,Number(requirement.amount)||1);
      if(!location) return 'Select an operational airport before reserving personnel.';
      if(staffAt(location,requirement.role)<amount) return `No ${PERSONNEL[requirement.role]?.label?.toLowerCase()||requirement.role} are available at ${location}. Add personnel in the Personnel widget.`;
      return '';
    }
    if(requirement.type==='crew_pool'){
      if(crewPoolOptions(incident).length) return '';
      const remote=remoteCrewPoolOptions(incident);
      if(remote.length){
        const nearest=remote[0];
        return `No qualified ${PERSONNEL[nearest.role]?.label?.toLowerCase()||'crew'} are at ${flight.from}. Move personnel from ${nearest.airport} in the Personnel widget, then allocate locally.`;
      }
      return 'No qualified crew pool is available. Request or move personnel in the Personnel widget.';
    }
    if(requirement.type==='augmented_crew') return crewAugmentationBlocker(incident);
    if(requirement.type==='aircraft'&&requirement.mode==='replacement'&&!incidentAircraftReplacementOptionsForTask(incident,task).length) return 'No suitable replacement aircraft is available. Request aircraft or position a spare in Dispatch.';
    if(requirement.type==='alternate'&&requirement.mode==='operational'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return alternateUnavailableMessage(incident,{includeReturnOrigin:false});
    if(requirement.type==='alternate'&&requirement.mode==='return_origin'&&!diversionOptionsForIncident(incident,{onlyReturnOrigin:true}).length) return 'Return to origin is not currently suitable. Fuel, weather, or handling is not available.';
    return '';
  }

  function taskResourceBlocker(task,incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    if(!task||!incident||!flight) return 'The affected flight is no longer available.';
    const eligibility=taskEligibilityBlocker(task,incident);
    if(eligibility) return eligibility;
    for(const requirement of task.resources||[]){
      const blocker=taskResourceRequirementBlocker(requirement,task,incident,flight);
      if(blocker) return blocker;
    }
    if(task.kind==='crew_allocation'&&!crewPoolOptions(incident).length){
      const remote=remoteCrewPoolOptions(incident);
      if(remote.length){
        const nearest=remote[0];
        return `No qualified ${PERSONNEL[nearest.role]?.label?.toLowerCase()||'crew'} are at ${flight.from}. Move personnel from ${nearest.airport} in the Personnel widget, then allocate locally.`;
      }
      return 'No qualified crew pool is available. Request or move personnel in the Personnel widget.';
    }
    if(task.kind==='manual_crew_move_required'){
      const plan=typeof crewRelocationPlanState==='function'?crewRelocationPlanState(incident):null;
      if(plan&&!plan.ready) return plan.reason;
    }
    if(task.kind==='crew_augmentation'){
      const message=crewAugmentationBlocker(incident);
      if(message) return message;
    }
    if(task.kind==='crew_next_sector_replacement'){
      const next=typeof nextSectorForCrewExtensionIncident==='function'?nextSectorForCrewExtensionIncident(incident):null;
      if(!next) return 'No unflown downstream sector is available for crew replacement.';
      const blocker=typeof crewSwapBlocker==='function'?crewSwapBlocker(next):'';
      if(blocker) return `${next.id}: ${blocker}`;
    }
    if(task.kind==='aircraft_substitution'&&!incidentAircraftReplacementOptionsForTask(incident,task).length) return incident.type==='fuel_supplier_outage'
      ? 'No replacement aircraft is already fueled for this sector. Request or position a fueled spare, use tanker fuel, wait supplier recovery, or cancel.'
      : 'No suitable replacement aircraft is available. Request aircraft or position a spare in Dispatch.';
    if(task.kind==='fuel_recovery'&&task.action==='tanker_inbound'){
      const plan=typeof fuelOutageTankerPlan==='function'?fuelOutageTankerPlan(incident):null;
      if(!plan?.available) return plan?.reason||'Inbound tanker fuel is not available for this rotation.';
    }
    if(task.kind==='mobile_maintenance_team'){
      const plan=typeof mobileMaintenanceTeamPlan==='function'?mobileMaintenanceTeamPlan(incident):null;
      if(!plan?.available) return plan?.reason||'No mobile maintenance team is available.';
    }
    if(['stand_request','station_coordination'].includes(task.kind)&&staffAt(flight.from,'groundHandling')<=0) return `No ground handling team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(['station_recovery','fuel_recovery','security_coordination','turnaround_expedite'].includes(task.kind)&&staffAt(flight.from,'groundHandling')<=0) return `No ground handling team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(task.kind==='security_coordination'&&staffAt(flight.from,'customerService')<=0) return `No customer-service team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(task.kind==='alternate_selection'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return alternateUnavailableMessage(incident,{includeReturnOrigin:false});
    if(task.kind==='return_origin_selection'&&!diversionOptionsForIncident(incident,{onlyReturnOrigin:true}).length) return 'Return to origin is not currently suitable. Fuel, weather, or handling is not available.';
    if(task.kind==='alternate_handling'){
      const handling=incident.selectedAlternate?diversionHandlingAvailability(incident.selectedAlternate):null;
      if(!incident.selectedAlternate||!handling?.available) return `No handling acceptance is available at ${incident.selectedAlternate||'the selected alternate'}. Add personnel or choose another alternate.`;
    }
    if([
      'inbound_wait','medical_assessment','medical_coordination',
      'flight_watch_assessment','flight_watch_coordination','fuel_monitoring','reroute_coordination','crew_extension_record','cabin_security_coordination'
    ].includes(task.kind)&&staffAt(flight.from,'operations')<=0) return `No operations/dispatch personnel are available at ${flight.from}. Add personnel in the Personnel widget.`;
    return '';
  }

  const api={
    activeWorkflowAssignments,crewPoolOptions,crewPoolOptionsAtAirport,remoteCrewPoolOptions,
    diversionRouteDurationMs,diversionFuelEstimate,diversionHandlingAvailability,diversionAnchorForIncident,diversionCandidatesForIncident,diversionOptionsForIncident,diversionRejectionSummaryForIncident,alternateUnavailableMessage,
    crewAugmentationBlocker,legalCrewConfirmationBlocker,branchStrategyOptionBlocker,taskResourceBlocker,
    taskEligibilityBlocker,taskResourceRequirementBlocker
  };
  global.AeroIncidentResources=api;
  Object.assign(global,api);
})(window);
