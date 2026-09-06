/* Player-facing consequence previews for OCC incident recovery options. */
(function(global){
  function consequenceDelayText(min,max=min){
    if(!Number.isFinite(min)||!Number.isFinite(max)) return '';
    const low=Math.max(0,Math.round(Math.min(min,max)));
    const high=Math.max(0,Math.round(Math.max(min,max)));
    if(!high) return 'no planned delay';
    return low===high?`possible +${high} min delay`:`possible +${low}-${high} min delay`;
  }

  function consequenceRange(values){
    const clean=values.filter(value=>Number.isFinite(value)).map(value=>Math.max(0,Math.round(value)));
    if(!clean.length) return null;
    return {min:Math.min(...clean),max:Math.max(...clean)};
  }

  function rotationRiskText(flight){
    const rotation=rotationForFlight(flight);
    if(rotation.returnFlight&&flight.serviceLeg!=='return') return `${rotation.returnFlight.id} return sector at risk`;
    const next=state.flights
      .filter(item=>!item.cancelled&&item.aircraftId===flight.aircraftId&&item.departure>flight.departure&&item.departure<flight.departure+10*HOUR)
      .sort((a,b)=>a.departure-b.departure)[0];
    return next?`${next.id} later rotation at risk`:'downstream rotation may be affected';
  }

  function replacementConsequenceText(incident){
    const options=incidentAircraftReplacementOptions(incident);
    if(!options.length) return 'requires a suitable spare or positioned aircraft';
    const range=consequenceRange(options.map(option=>option.delayMin||0));
    const borrowed=options.some(option=>option.kind==='borrow');
    return [`replacement candidate ${consequenceDelayText(range.min,range.max)}`,borrowed?'borrowed aircraft may affect a later schedule':'' ].filter(Boolean).join(' · ');
  }

  function diversionConsequenceText(incident,{returnOrigin=false,medical=false}={}){
    const options=diversionOptionsForIncident(incident,returnOrigin?{onlyReturnOrigin:true}:{includeReturnOrigin:false});
    if(!options.length) return returnOrigin?'return currently not available':'requires suitable fuel, weather, range, and handling';
    const range=consequenceRange(options.map(option=>option.duration/MIN));
    const flight=state.flights.find(item=>item.id===incident.flightId);
    const risk=flight?rotationRiskText(flight):'downstream rotation may be affected';
    if(returnOrigin) return `return flight time ${Math.round(range.min)} min · ${risk}`;
    return `${medical?'medical ':''}diversion route ${Math.round(range.min)}-${Math.round(range.max)} min · ${risk}`;
  }

  function operationalOptionConsequence(task,incident,optionId){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    if(!task||!incident||!flight) return '';
    const currentDelay=flightTotalDepartureDelayMin(flight);
    if(optionId==='cancel') return 'flight removed before departure · aircraft and crew released';

    if(['crew-strategy','crew-duty-strategy','crew-fatigue-strategy','crew-misconnect-strategy'].includes(task.key)&&optionId==='replace'){
      if(crewPoolOptions(incident).length) return 'local replacement report about +20 min';
      if(remoteCrewPoolOptions(incident).length) return 'local pool unavailable · move remote personnel first';
      return 'requires qualified local or moved personnel';
    }
    if(task.key==='crew-misconnect-strategy'&&optionId==='wait_crew') return `${consequenceDelayText(incident.context?.delayMin||25)} · crew transfer becomes the departure driver`;
    if(['crew-duty-strategy','crew-fatigue-strategy'].includes(task.key)&&optionId==='augment') return 'no extra delay if crew is available · extra crew tied up';

    if(['mx-strategy','mx-bird-strategy','mx-postflight-strategy'].includes(task.key)){
      if(optionId==='defer'||optionId==='release') return 'minimal delay after engineering sign-off · MEL restrictions may remain';
      if(optionId==='repair') return `possible +120 min delay · ${rotationRiskText(flight)}`;
      if(optionId==='substitute') return replacementConsequenceText(incident);
    }

    if(task.key==='dispatch-flow-strategy'){
      if(optionId==='accept') return 'possible +45 min ground delay';
      if(optionId==='priority') return 'possible +20 min delay · waits for ATC reply';
    }
    if(task.key==='station-stand-strategy'){
      if(optionId==='remote') return 'possible +20 min delay · bus boarding required';
      if(optionId==='tow') return 'possible +30 min delay · tow coordination required';
      if(optionId==='wait_gate') return `possible +45 min delay · ${rotationRiskText(flight)}`;
    }
    if(task.key==='dispatch-flightdeck-decision'){
      if(optionId==='alternate') return `flight deck requested alternate · ${diversionConsequenceText(incident)}`;
      if(optionId==='return_origin') return `flight deck requested return · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
    }
    if(task.key==='dispatch-position-strategy'){
      const delay=Math.max(15,incident.context?.delayMin||currentDelay||15);
      if(optionId==='position_ferry') return `requires manual ferry flight · possible ${consequenceDelayText(delay)} · ${rotationRiskText(flight)}`;
      if(optionId==='substitute') return replacementConsequenceText(incident);
    }
    if(task.key==='crew-legal-strategy'){
      if(optionId==='confirm') return 'available after local crew resources cover all missing roles';
    }
    if(task.key==='station-baggage-strategy'){
      if(optionId==='expedite') return 'possible +15 min delay · ramp priority required';
      if(optionId==='reload') return 'possible +35 min delay · amended loadsheet required';
      if(optionId==='offload') return 'possible +20 min delay · passenger-service follow-up';
    }
    if(task.key==='station-fuel-strategy'){
      if(optionId==='priority') return 'possible +10 min delay · fuel provider must accept priority';
      if(optionId==='wait_truck') return `possible +35 min delay · ${rotationRiskText(flight)}`;
      if(optionId==='minimum_uplift') return 'possible +15 min delay · less discretionary fuel margin';
    }
    if(task.key==='station-deicing-strategy'){
      if(optionId==='deice') return 'possible +25 min delay · holdover window starts after treatment';
      if(optionId==='priority_deice') return 'possible +15 min delay · uses priority station resources';
      if(optionId==='wait_weather') return `possible +45 min delay · ${rotationRiskText(flight)}`;
    }
    if(task.key==='station-holdover-strategy'){
      if(optionId==='redeice') return 'possible +25 min delay · new holdover window starts';
      if(optionId==='wait_deice_slot') return `possible +35 min delay · ${rotationRiskText(flight)}`;
    }
    if(task.key==='dispatch-capacity-strategy'){
      const delay=Math.max(15,incident.context?.delayMin||currentDelay||30);
      if(optionId==='accept') return `${consequenceDelayText(delay)} · airport sequence preserved`;
      if(optionId==='priority') return `${consequenceDelayText(Math.max(10,delay*.55),delay)} · waits for airport/flow reply`;
    }
    if(task.key==='dispatch-groundstop-strategy'){
      const delay=Math.max(35,incident.context?.delayMin||currentDelay||45);
      if(optionId==='hold_ground') return `${consequenceDelayText(delay)} · aircraft remains at origin`;
      if(optionId==='priority') return `${consequenceDelayText(Math.max(10,delay*.55),delay)} · waits for flow-management reply`;
    }
    if(task.key==='dispatch-night-curfew-strategy'&&optionId==='reschedule_after_curfew'){
      const delay=Math.max(0,incident.context?.delayMin||0);
      const next=incident.context?.nextDeparture?formatTime(incident.context.nextDeparture):'after airport reopening';
      return `${consequenceDelayText(delay)} · first feasible departure ${next}`;
    }
    if(task.key==='dispatch-performance-strategy'){
      if(optionId==='payload_reduce') return `possible +20 min delay · about ${incident.context?.payloadReductionPct||12}% payload offload`;
      if(optionId==='delay_conditions') return `${consequenceDelayText(incident.context?.delayMin||45)} · waits for runway/weather performance margin`;
      if(optionId==='substitute') return replacementConsequenceText(incident);
    }
    if(task.key==='station-destination-handling-strategy'){
      if(optionId==='request_handling') return 'requires destination ground-handling personnel · small arrival coordination delay';
      if(optionId==='delay_departure') return `${consequenceDelayText(incident.context?.delayMin||35)} · protects arrival acceptance`;
    }
    if(task.key==='station-security-strategy'){
      if(optionId==='hold_screening') return 'possible +30 min delay · boarding/manifest held open';
      if(optionId==='offload_passenger') return 'possible +25 min delay · passenger and bag removed';
    }
    if(task.key==='dispatch-medical-decision'){
      if(optionId==='continue') return 'flight deck continues · possible +20 min arrival medical coordination delay';
      if(optionId==='divert') return `medical diversion requested · ${diversionConsequenceText(incident,{medical:true})}`;
    }
    if(task.key==='dispatch-tech-decision'){
      if(optionId==='continue') return 'flight deck continues · possible +10-15 min flight-watch coordination · arrival inspection may be needed';
      if(optionId==='divert') return `technical diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-fuel-decision'){
      if(optionId==='conserve') return 'flight deck reports conservation profile · no planned route delay · fuel margin watched';
      if(optionId==='direct') return 'flight deck requests priority/shortcut · arrival recovery possible if ATC approves';
      if(optionId==='divert') return `fuel diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-holding-fuel-decision'){
      if(optionId==='direct') return 'flight deck requests priority/shortcut · fuel margin may improve if ATC reduces holding';
      if(optionId==='divert') return `fuel diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-reroute-strategy'){
      const delay=incident.context?.delayMin||currentDelay||15;
      if(optionId==='accept') return `${consequenceDelayText(delay)} · downstream arrival may move`;
      if(optionId==='direct') return `${consequenceDelayText(Math.max(5,delay*.4),delay)} · waits for ATC reply`;
    }
    if(task.key==='dispatch-cabin-decision'){
      if(optionId==='continue') return 'flight deck continues · possible +15 min arrival security coordination delay';
      if(optionId==='divert') return `security diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-weather-decision'){
      if(optionId==='monitor') return 'flight deck monitors destination · no immediate diversion · approach minima watched';
      if(optionId==='hold') return 'flight deck/ATC holding plan · possible +20 min holding · fuel margin at risk';
      if(optionId==='divert') return `weather diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-minima-decision'){
      if(optionId==='hold') return 'flight deck/ATC holding plan · possible +20 min holding · fuel margin watched closely';
      if(optionId==='divert') return `weather diversion requested · ${diversionConsequenceText(incident)}`;
      if(optionId==='return_origin') return `return requested · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
    }
    if(task.key==='dispatch-alternate-decision'){
      if(optionId==='reselect') return `new alternate requested · ${diversionConsequenceText(incident)}`;
      if(optionId==='monitor') return 'flight deck accepts monitoring · alternate and destination trend watched';
      if(optionId==='return_origin') return `return requested · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
    }
    if(task.key==='dispatch-diversion-airport-decision'){
      if(optionId==='reselect') return `new diversion requested · ${diversionConsequenceText(incident)}`;
      if(optionId==='hold') return 'flight deck/ATC holding plan · possible +20 min holding · fuel margin watched closely';
      if(optionId==='return_origin') return `return requested · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
    }
    if(task.key==='dispatch-lightning-decision'){
      if(optionId==='continue') return 'flight deck continues · arrival inspection required · aircraft may be held after landing';
      if(optionId==='divert') return `inspection diversion requested · ${diversionConsequenceText(incident)}`;
    }
    if(task.key==='dispatch-pressure-decision'){
      if(optionId==='continue_low') return 'flight deck continues lower · possible +25 min delay · higher fuel burn';
      if(optionId==='divert') return `technical diversion requested · ${diversionConsequenceText(incident)}`;
    }
    return '';
  }

  const api={
    consequenceDelayText,consequenceRange,rotationRiskText,replacementConsequenceText,
    diversionConsequenceText,operationalOptionConsequence
  };
  global.AeroIncidentConsequences=api;
  Object.assign(global,api);
})(window);
