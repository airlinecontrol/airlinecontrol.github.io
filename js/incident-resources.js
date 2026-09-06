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
    const roster=['captains','firstOfficers'].includes(role)?qualifiedStaffAt(airport,role,family):staffAt(airport,role);
    const available=Math.max(0,roster-(reserved.get(airport)||0));
    if(!available) return [];
    return [{id:`${airport}:${role}`,airport,role,family,available,reportMin:20,
      label:`${airport} ${PERSONNEL[role]?.label||role} pool · ${available} available · report 20 min`}];
  }

  function remoteCrewPoolOptions(incident){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) return [];
    return Object.keys(AIRPORTS).filter(code=>code!==flight.from)
      .flatMap(code=>crewPoolOptionsAtAirport(incident,code).map(option=>({
        ...option,reportMin:Math.ceil(45+distanceKm(AIRPORTS[code],AIRPORTS[flight.from])/700*60),
        label:`${code} ${PERSONNEL[option.role]?.label||option.role} pool · ${option.available} available · move to ${flight.from}`
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

  function diversionOptionsForIncident(incident,{includeReturnOrigin=true,onlyReturnOrigin=false}={}){
    const flight=state.flights.find(item=>item.id===incident.flightId);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return [];
    const routeKm=distanceKm(AIRPORTS[flight.from],AIRPORTS[flight.to]);
    return Object.keys(AIRPORTS).filter(code=>code!==flight.to&&(includeReturnOrigin||code!==flight.from)).map(code=>{
      const returnOrigin=code===flight.from;
      if(onlyReturnOrigin&&!returnOrigin) return null;
      const km=returnOrigin?Math.max(80,routeKm*.45):distanceKm(AIRPORTS[flight.from],AIRPORTS[code]);
      const destinationKm=distanceKm(AIRPORTS[flight.to],AIRPORTS[code]);
      const weather=Management.weatherAt(code,simNow());
      const rangeOk=km<=MODELS[aircraft.model].maxRangeKm;
      const handling=staffAt(code,'groundHandling');
      const fuel=diversionFuelEstimate(flight,aircraft,km);
      const suitability=(rangeOk?100:0)-destinationKm/80+(returnOrigin?12:0)+(weather.level==='normal'?15:weather.level==='caution'?0:-30)+Math.min(10,handling)+(fuel.ok?0:-80);
      return {code,km,destinationKm,weather,handling,rangeOk,fuel,returnOrigin,duration:diversionRouteDurationMs(km,MODELS[aircraft.model]),suitability};
    }).filter(item=>item&&item.rangeOk&&item.handling>0&&item.fuel.ok).sort((a,b)=>b.suitability-a.suitability).slice(0,5);
  }

  function crewAugmentationBlocker(incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const aircraft=flight&&state.aircraft.find(item=>item.id===flight.aircraftId);
    if(!flight||!aircraft) return 'The affected flight is no longer available.';
    const augmented=OperationalIntelligence.crewDutyAssessment({
      departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),sectors:1,augmented:true
    });
    if(!augmented.legal) return 'Augmented crew would still exceed the duty envelope. Use replacement crew or cancel before departure.';
    const family=Management.aircraftFamily(aircraft.model);
    const missingCaptain=Math.max(0,2-qualifiedStaffAt(flight.from,'captains',family));
    const missingFirstOfficer=Math.max(0,2-qualifiedStaffAt(flight.from,'firstOfficers',family));
    const cabinRequired=Math.max(2,Math.ceil(cabinSeatCount(aircraft)/50)*2);
    const missingCabin=Math.max(0,cabinRequired-staffAt(flight.from,'cabinCrew'));
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
      if(flight.departureLogged) return 'Cancellation is only available before departure. Use an operational recovery path for airborne flights.';
      if(staffAt(flight.from,'operations')<=0) return `No operations/dispatch personnel are available at ${flight.from}. Add personnel in the Personnel widget.`;
      return '';
    }
    if(['mx-strategy','mx-postflight-strategy','dispatch-position-strategy','dispatch-performance-strategy','mx-bird-strategy'].includes(task.key)&&optionId==='substitute'&&!incidentAircraftReplacementOptions(incident).length) return 'No suitable replacement aircraft is available. Add or position aircraft in Dispatch & slots, then try again.';
    if(task.key==='crew-legal-strategy'&&optionId==='confirm') return legalCrewConfirmationBlocker(incident);
    if(['crew-duty-strategy','crew-fatigue-strategy'].includes(task.key)&&optionId==='augment'){
      const message=crewAugmentationBlocker(incident);
      if(message) return message;
    }
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(['dispatch-flow-strategy','dispatch-capacity-strategy','dispatch-groundstop-strategy','dispatch-night-curfew-strategy'].includes(task.key)&&staffAt(flight?.from,'operations')<=0){
      return `No operations/dispatch personnel are available at ${flight?.from||'the origin'}. Add personnel in the Personnel widget.`;
    }
    if(task.key==='station-stand-strategy'&&staffAt(flight?.from,'groundHandling')<=0){
      return `No ground handling team is available at ${flight?.from||'the origin'}. Add personnel in the Personnel widget.`;
    }
    if(task.key==='station-destination-handling-strategy'&&optionId==='delay_departure'){
      const flight=state.flights.find(item=>item.id===incident.flightId&&!item.cancelled);
      if(flight?.departureLogged) return 'The flight is already airborne. Secure destination handling or prepare an alternate instead.';
    }
    if(task.key==='station-destination-handling-strategy'&&optionId==='prepare_alternate'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return 'No suitable alternate is available. Add handling personnel at a candidate airport or request destination handling.';
    return '';
  }

  function taskEligibilityBlocker(task,incident){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const phase=task?.eligibility?.phase;
    if(!phase||!flight) return '';
    if(phase==='pre_departure'&&flight.departureLogged) return 'Cancellation is only available before departure. Use an operational recovery path for airborne flights.';
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
    if(requirement.type==='aircraft'&&requirement.mode==='replacement'&&!incidentAircraftReplacementOptions(incident).length) return 'No suitable replacement aircraft is available. Request aircraft or position a spare in Dispatch & slots.';
    if(requirement.type==='alternate'&&requirement.mode==='operational'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return 'No alternate with range, weather, fuel, and handling resources is available. Add handling personnel at a candidate alternate.';
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
    if(task.kind==='crew_augmentation'){
      const message=crewAugmentationBlocker(incident);
      if(message) return message;
    }
    if(task.kind==='aircraft_substitution'&&!incidentAircraftReplacementOptions(incident).length) return 'No suitable replacement aircraft is available. Request aircraft or position a spare in Dispatch & slots.';
    if(['stand_request','station_coordination'].includes(task.kind)&&staffAt(flight.from,'groundHandling')<=0) return `No ground handling team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(['station_recovery','fuel_recovery','security_coordination','turnaround_expedite'].includes(task.kind)&&staffAt(flight.from,'groundHandling')<=0) return `No ground handling team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(task.kind==='security_coordination'&&staffAt(flight.from,'customerService')<=0) return `No customer-service team is available at ${flight.from}. Add personnel in the Personnel widget.`;
    if(task.kind==='alternate_selection'&&!diversionOptionsForIncident(incident,{includeReturnOrigin:false}).length) return 'No alternate with range, weather, fuel, and handling resources is available. Add handling personnel at a candidate alternate.';
    if(task.kind==='return_origin_selection'&&!diversionOptionsForIncident(incident,{onlyReturnOrigin:true}).length) return 'Return to origin is not currently suitable. Fuel, weather, or handling is not available.';
    if(task.kind==='alternate_handling'&&(!incident.selectedAlternate||staffAt(incident.selectedAlternate,'groundHandling')<=0)) return `No handling team is available at ${incident.selectedAlternate||'the selected alternate'}. Add personnel before securing handling.`;
    if([
      'inbound_wait','medical_assessment','medical_coordination',
      'flight_watch_assessment','flight_watch_coordination','fuel_monitoring','reroute_coordination','cabin_security_coordination'
    ].includes(task.kind)&&staffAt(flight.from,'operations')<=0) return `No operations/dispatch personnel are available at ${flight.from}. Add personnel in the Personnel widget.`;
    return '';
  }

  const api={
    activeWorkflowAssignments,crewPoolOptions,crewPoolOptionsAtAirport,remoteCrewPoolOptions,
    diversionRouteDurationMs,diversionFuelEstimate,diversionOptionsForIncident,
    crewAugmentationBlocker,legalCrewConfirmationBlocker,branchStrategyOptionBlocker,taskResourceBlocker,
    taskEligibilityBlocker,taskResourceRequirementBlocker
  };
  global.AeroIncidentResources=api;
  Object.assign(global,api);
})(window);
