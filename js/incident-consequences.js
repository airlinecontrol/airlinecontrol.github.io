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

  function roundCost(value){
    const amount=Math.max(0,Number(value)||0);
    if(amount>=10_000) return Math.round(amount/500)*500;
    return Math.round(amount/100)*100;
  }

  function moneyText(value){
    return typeof money==='function'?money(roundCost(value)):`€${roundCost(value).toLocaleString('en-IE')}`;
  }

  function aircraftSizeFactor(flight){
    const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
    const seats=aircraft?cabinSeatCount(aircraft):Math.max(80,Number(flight?.pax)||100);
    return seats>=240?1.9:seats>=160?1.35:seats>=100?1.0:.72;
  }

  function passengerDelayCost(flight,delayMin){
    const pax=Math.max(0,Number(flight?.pax)||0);
    const minutes=Math.max(0,Number(delayMin)||0);
    const soft=pax*minutes*.38;
    const voucher=minutes>=120?pax*18:minutes>=60?pax*7:0;
    const overnight=passengerOvernightExposure(flight,minutes);
    return roundCost(soft+voucher+overnight.cost);
  }

  function passengerOvernightExposure(flight,extraDelayMin=0){
    if(!flight||flight.flightType==='ferry'||!(flight.pax>0)) return {pax:0,cost:0,reason:'',overnight:false};
    const delayMin=Math.max(flightTotalDepartureDelayMin(flight),Number(extraDelayMin)||0);
    const actualArrival=flightActualArrival(flight)+Math.max(0,(Number(extraDelayMin)||0)-flightTotalDepartureDelayMin(flight))*MIN;
    const destination=typeof flightOperationalDestination==='function'?flightOperationalDestination(flight):(flight.diversionAirport||flight.to);
    const nightRules=typeof AIRPORT_NIGHT_RULES==='object'?AIRPORT_NIGHT_RULES:{};
    const rule=nightRules[destination];
    const local=rule&&typeof localTimeParts==='function'?localTimeParts(rule.timeZone,actualArrival):{hour:new Date(actualArrival).getHours()};
    const localHour=local.hour||0;
    const inHardCurfew=typeof airportNightStatus==='function'&&airportNightStatus(destination,actualArrival).status==='closed';
    const lateArrival=delayMin>=120&&(localHour>=23||localHour<5);
    const diverted=Boolean(flight.diversionAirport&&flight.diversionAirport!==flight.to);
    if(!lateArrival&&!inHardCurfew) return {pax:0,cost:0,reason:'',overnight:false};
    const fraction=diverted?0.45:0.22;
    const pax=Math.ceil((Number(flight.pax)||0)*fraction);
    const unit=diverted?145:125;
    const reason=diverted?'diversion overnight':'late-night arrival';
    return {pax,cost:roundCost(pax*unit),reason,overnight:true};
  }

  function crewComplementForFlight(flight){
    const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
    const cabin=aircraft&&flight?.flightType!=='ferry'?Math.max(1,Math.ceil(cabinSeatCount(aircraft)/50)):0;
    return 2+cabin;
  }

  function crewRecoveryCost(flight,{hotel=false,position=false,replace=false,augment=false}={}){
    const crew=crewComplementForFlight(flight);
    const hotelCost=hotel?crew*135:0;
    const positionCost=position?crew*260:0;
    const replaceCost=replace?crew*180:0;
    const augmentCost=augment?crew*310:0;
    return roundCost(hotelCost+positionCost+replaceCost+augmentCost);
  }

  function ferryRecoveryCost(flight,from,to){
    const aircraft=state.aircraft.find(item=>item.id===flight?.aircraftId);
    if(!aircraft||!AIRPORTS[from]||!AIRPORTS[to]) return 0;
    const km=distanceKm(AIRPORTS[from],AIRPORTS[to]);
    const model=MODELS[aircraft.model];
    return roundCost(Math.max(1_500,km*(model?.costPerKm||7)*1.15+1_200));
  }

  function cancellationRecoveryCost(flight){
    if(!flight) return 0;
    const pax=Math.max(0,Number(flight.pax)||0);
    const revenue=Math.max(0,Number(flight.revenue)||0);
    return roundCost(revenue*.55+pax*95+crewRecoveryCost(flight,{hotel:flight.from!==state.home}));
  }

  function estimateRecoveryOptionCost(task,incident,optionId){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    if(!task||!incident||!flight) return {amount:0,label:'',category:'recovery',components:[]};
    const context=incident.context||{};
    const currentDelay=flightTotalDepartureDelayMin(flight);
    let amount=0,category='recovery',components=[];
    const add=(label,value)=>{
      const cost=roundCost(value);
      if(cost>0){ amount+=cost; components.push({label,cost}); }
    };
    const delay=minutes=>add('delay exposure',passengerDelayCost(flight,minutes));
    if(optionId==='cancel'){
      category='passenger';
      add('cancel/rebook exposure',cancellationRecoveryCost(flight));
    }else if(['crew-strategy','crew-duty-strategy','crew-fatigue-strategy','crew-misconnect-strategy','crew-diversion-strategy','crew-report-delay-strategy'].includes(task.key)){
      category='crew';
      if(optionId==='replace') add('reserve activation',crewRecoveryCost(flight,{replace:true}));
      if(optionId==='augment') add('augmentation callout',crewRecoveryCost(flight,{augment:true}));
      if(['wait_crew','move_crew','move_reserve'].includes(optionId)) delay(context.delayMin||currentDelay||35);
      if(['move_crew','move_reserve'].includes(optionId)) add('crew positioning',crewRecoveryCost(flight,{position:true}));
    }else if(['mx-strategy','mx-postflight-strategy','dispatch-tech-decision','dispatch-lightning-decision','dispatch-bird-decision','dispatch-pressure-decision'].includes(task.key)){
      category='maintenance';
      if(optionId==='defer') add('MEL admin / follow-up',700);
      if(optionId==='schedule_check') add('unscheduled maintenance check',9_500*aircraftSizeFactor(flight));
      if(optionId==='substitute') add('aircraft swap',2_000*aircraftSizeFactor(flight));
      if(['divert','return_origin'].includes(optionId)) add('arrival engineering support',4_500*aircraftSizeFactor(flight));
      if(['continue','continue_low'].includes(optionId)) add('arrival inspection',1_800*aircraftSizeFactor(flight));
    }else if(task.key==='dispatch-position-strategy'){
      category='aircraft';
      if(optionId==='position_ferry') add('positioning ferry',ferryRecoveryCost(flight,context.expectedLocation||context.diversionAirport||'',flight.from));
      if(optionId==='substitute') add('aircraft swap',2_500*aircraftSizeFactor(flight));
      delay(context.delayMin||currentDelay||15);
    }else if(['station-fuel-strategy','station-fuel-outage-strategy'].includes(task.key)){
      category='station';
      if(['priority','fuel_outage_priority'].includes(optionId)) add('provider priority surcharge',3_500*aircraftSizeFactor(flight));
      if(['wait_truck','wait_supply'].includes(optionId)) delay(context.delayMin||35);
      if(optionId==='minimum_uplift') add('reduced fuel margin handling',900*aircraftSizeFactor(flight));
      if(optionId==='substitute') add('aircraft swap',2_500*aircraftSizeFactor(flight));
    }else if(['station-deicing-strategy','station-deicing-collapse-strategy','station-holdover-strategy'].includes(task.key)){
      category='station';
      if(['deice','redeice','join_queue'].includes(optionId)) add('deicing service',2_200*aircraftSizeFactor(flight));
      if(optionId==='priority_deice') add('priority deicing surcharge',4_200*aircraftSizeFactor(flight));
      if(['wait_weather','wait_deice_slot','join_queue'].includes(optionId)) delay(context.queueMin||context.delayMin||45);
    }else if(['station-stand-strategy','station-security-strategy','station-destination-handling-strategy','dispatch-ground-destination-strategy'].includes(task.key)){
      category='passenger';
      if(['remote','tow','hold_screening','delay_departure','delay_reopen'].includes(optionId)) delay(context.delayMin||currentDelay||30);
      if(['offload_passenger','alternate_destination','prepare_alternate','request_handling'].includes(optionId)) add('passenger / station handling',Math.max(1_000,(flight.pax||0)*28));
    }else if(['dispatch-capacity-strategy','dispatch-groundstop-strategy','dispatch-night-curfew-strategy','dispatch-reroute-strategy'].includes(task.key)){
      category='dispatch';
      if(['priority','direct'].includes(optionId)) add('priority coordination',1_200*aircraftSizeFactor(flight));
      delay(optionId==='priority'?Math.max(10,(context.delayMin||30)*.55):context.delayMin||currentDelay||30);
    }else if(['dispatch-flightdeck-decision','dispatch-medical-decision','dispatch-fuel-decision','dispatch-holding-fuel-decision','dispatch-cabin-decision','dispatch-weather-decision','dispatch-minima-decision','dispatch-alternate-decision','dispatch-diversion-airport-decision'].includes(task.key)){
      category=['continue','monitor','direct','conserve','hold'].includes(optionId)?'dispatch':'passenger';
      if(['divert','alternate','reselect'].includes(optionId)) add('diversion recovery',Math.max(3_500,(flight.pax||0)*42+2_500*aircraftSizeFactor(flight)));
      if(optionId==='return_origin') add('return recovery',Math.max(3_000,(flight.pax||0)*38+2_000*aircraftSizeFactor(flight)));
      if(['hold','continue_low'].includes(optionId)) delay(context.delayMin||25);
      if(optionId==='continue') add('arrival coordination',1_200*aircraftSizeFactor(flight));
    }else if(task.key==='dispatch-performance-strategy'){
      category='passenger';
      if(optionId==='payload_reduce') add('payload/passenger reaccommodation',Math.max(1_500,(flight.pax||0)*(context.payloadReductionPct||12)*1.2));
      if(optionId==='delay_conditions') delay(context.delayMin||45);
      if(optionId==='substitute') add('performance aircraft swap',3_000*aircraftSizeFactor(flight));
    }
    const overnight=passengerOvernightExposure(flight,context.delayMin||0);
    if(overnight.pax&&category!=='crew') add('accommodation exposure',overnight.cost);
    amount=roundCost(amount);
    return {
      amount,
      label:amount?`est ${moneyText(amount)}`:'',
      category,
      components,
      passengerAccommodationPax:overnight.pax,
      passengerAccommodationReason:overnight.reason
    };
  }

  function costPreviewText(task,incident,optionId){
    const estimate=estimateRecoveryOptionCost(task,incident,optionId);
    return estimate.amount?`est ${moneyText(estimate.amount)}`:'';
  }

  function appendCostPreview(text,task,incident,optionId){
    const cost=costPreviewText(task,incident,optionId);
    return [text,cost].filter(Boolean).join(' · ');
  }

  function recoveryCostSummaryForIncident(incident){
    if(!incident||incident.recoveryCostEventId) return null;
    const tasks=(typeof playableIncidentTasks==='function'?playableIncidentTasks(incident):incidentTasks(incident.id))||[];
    const strategy=incident.selectedStrategy||incident.selectedAction||'';
    const strategyTask=tasks.find(task=>(task.strategyOptions||[]).some(option=>option.id===strategy));
    if(strategyTask&&strategy){
      const estimate=estimateRecoveryOptionCost(strategyTask,incident,strategy);
      if(estimate.amount) return {...estimate,taskId:strategyTask.id,optionId:strategy};
    }
    const costTask=tasks.find(task=>task.selection&&(task.selection.action||task.selection.airport||task.selection.assignmentId||task.selection.ferryFlightId||task.kind==='aircraft_substitution'));
    if(!costTask) return null;
    let optionId=costTask.selection?.action||strategy||'complete';
    if(costTask.kind==='aircraft_substitution') optionId='substitute';
    if(costTask.kind==='crew_allocation') optionId='replace';
    if(costTask.kind==='crew_augmentation') optionId='augment';
    if(costTask.kind==='alternate_selection') optionId=incident.diversionReturnOrigin?'return_origin':'divert';
    const estimate=estimateRecoveryOptionCost(costTask,incident,optionId);
    return estimate.amount?{...estimate,taskId:costTask.id,optionId}:null;
  }

  function recordRecoveryCostEvent({flight=null,incident=null,task=null,category='recovery',amount=0,description='',kind='incident',passengers=0,crew=0,airport=''}={}){
    const value=roundCost(amount);
    if(!value) return null;
    state.recoveryCostEvents??=[];
    state.stats??={};
    const event={
      id:`RC${state.nextRecoveryCostEvent++}`,
      flightId:flight?.id||incident?.flightId||task?.flightId||'',
      incidentId:incident?.id||task?.incidentId||'',
      taskId:task?.id||'',
      category,
      kind,
      amount:value,
      passengers:Math.max(0,Math.round(Number(passengers)||0)),
      crew:Math.max(0,Math.round(Number(crew)||0)),
      airport:airport||incident?.airport||flight?.from||'',
      description:description||'Operational recovery cost',
      createdAt:simNow()
    };
    state.recoveryCostEvents.push(event);
    state.stats.recoveryCosts=(Number(state.stats.recoveryCosts)||0)+value;
    if(category==='passenger') state.stats.passengerRecoveryCosts=(Number(state.stats.passengerRecoveryCosts)||0)+value;
    if(category==='crew') state.stats.crewRecoveryCosts=(Number(state.stats.crewRecoveryCosts)||0)+value;
    if(flight){
      flight.recoveryCostBooked=(Number(flight.recoveryCostBooked)||0)+value;
      if(flight.economics){
        flight.economics.recoveryOps=(Number(flight.economics.recoveryOps)||0)+value;
        refreshEconomicsTotals(flight);
      }
    }
    if(typeof postTransaction==='function') postTransaction(-value,'Recovery',event.description,event.incidentId||event.flightId);
    return event;
  }

  function recordResolvedIncidentRecoveryCost(incident){
    if(!incident||incident.status!=='open'||incident.recoveryCostEventId) return null;
    const flight=state.flights.find(item=>item.id===incident.flightId);
    if(!flight) return null;
    const summary=recoveryCostSummaryForIncident(incident);
    if(!summary?.amount) return null;
    const event=recordRecoveryCostEvent({
      flight,incident,task:summary.taskId?state.coordinationTasks.find(item=>item.id===summary.taskId):null,
      category:summary.category||'recovery',
      amount:summary.amount,
      kind:'incident_recovery',
      passengers:summary.passengerAccommodationPax||0,
      crew:summary.category==='crew'?crewComplementForFlight(flight):0,
      airport:incident.airport||flight.from,
      description:`${INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}: ${summary.optionId||incident.selectedStrategy||'recovery'}`
    });
    if(event) incident.recoveryCostEventId=event.id;
    return event;
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

    if(['crew-strategy','crew-duty-strategy','crew-fatigue-strategy','crew-misconnect-strategy','crew-diversion-strategy','crew-report-delay-strategy'].includes(task.key)&&optionId==='replace'){
      if(crewPoolOptions(incident).length) return 'reserve response and briefing about +20 min';
      if(remoteCrewPoolOptions(incident).length) return 'local pool unavailable · move remote personnel first';
      return 'requires qualified local or moved personnel';
    }
    if(task.key==='crew-misconnect-strategy'&&optionId==='wait_crew') return `${consequenceDelayText(incident.context?.delayMin||25)} · crew transfer becomes the departure driver`;
    if(task.key==='crew-diversion-strategy'){
      if(optionId==='move_crew') return `${consequenceDelayText(incident.context?.delayMin||45)} · requires manual personnel move`;
      if(optionId==='wait_crew') return `${consequenceDelayText(incident.context?.delayMin||45)} · displaced through crew stays with flight`;
    }
    if(task.key==='crew-report-delay-strategy'){
      if(optionId==='wait_crew') return `${consequenceDelayText(incident.context?.delayMin||25)} · assigned crew remains on duty`;
      if(optionId==='move_reserve') return 'requires manual personnel move · recovery depends on transfer ETA';
    }
    if(['crew-duty-strategy','crew-fatigue-strategy'].includes(task.key)&&optionId==='augment') return 'augmentation callout about +25 min · extra crew tied up';
    if(task.key==='crew-extension-strategy'){
      if(optionId==='record_extension') return `records +${incident.context?.overrunMin||0} min duty extension · crew must be reviewed after landing`;
      if(optionId==='priority') return 'possible enroute delay reduction · waits for ATC / flight deck reply';
      if(optionId==='protect_next') return incident.context?.nextFlightId
        ? `reserve crew protects ${incident.context.nextFlightId} · current crew stands down on arrival`
        : 'no next sector to protect · use record or priority handling';
    }

    if(['mx-strategy','mx-postflight-strategy'].includes(task.key)){
      if(optionId==='defer') return incident.technicalContext?.deferAllowed===false
        ? 'not deferrable under MEL · maintenance check required'
        : 'minimal delay after engineering sign-off · MEL restrictions may remain';
      if(optionId==='schedule_check') return `planned maintenance downtime · ${rotationRiskText(flight)}`;
      if(optionId==='substitute') return replacementConsequenceText(incident);
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
    if(task.key==='station-fuel-outage-strategy'){
      if(optionId==='priority') return 'possible +20 min delay · depends on provider escalation';
      if(optionId==='wait_supply') return `${consequenceDelayText(incident.context?.delayMin||75)} · supplier outage drives departure`;
      if(optionId==='minimum_uplift') return 'possible +25 min delay · legal fuel only, smaller operational margin';
      if(optionId==='substitute') return replacementConsequenceText(incident);
    }
    if(task.key==='station-deicing-strategy'){
      if(optionId==='deice') return 'possible +25 min delay · holdover window starts after treatment';
      if(optionId==='priority_deice') return 'possible +15 min delay · uses priority station resources';
      if(optionId==='wait_weather') return `possible +45 min delay · ${rotationRiskText(flight)}`;
    }
    if(task.key==='station-deicing-collapse-strategy'){
      if(optionId==='join_queue') return `${consequenceDelayText(incident.context?.queueMin||incident.context?.delayMin||60)} · airport deicing queue controls departure`;
      if(optionId==='priority_deice') return 'possible +20 min delay · station priority may affect other departures';
      if(optionId==='wait_weather') return `${consequenceDelayText(Math.max(45,incident.context?.delayMin||60))} · waits for demand or precipitation to ease`;
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
    if(task.key==='dispatch-night-curfew-strategy'&&optionId==='change_departure'){
      const delay=Math.max(0,incident.context?.delayMin||0);
      const next=incident.context?.nextDeparture?formatTime(incident.context.nextDeparture):'after airport reopening';
      const chain=incident.context?.restrictionSummary?` · ${incident.context.restrictionSummary}`:'';
      return `${consequenceDelayText(delay)} · manually hold in Dispatch, recommended earliest clear departure ${next}${chain}`;
    }
    if(task.key==='dispatch-ground-destination-strategy'){
      if(optionId==='delay_reopen') return `${consequenceDelayText(incident.context?.delayMin||90)} · aircraft waits on ground for destination acceptance`;
      if(optionId==='alternate_destination') return `new destination plan · ${diversionConsequenceText(incident)}`;
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
      if(optionId==='return_origin') return `return requested · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
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
    if(task.key==='dispatch-bird-decision'){
      if(optionId==='continue') return 'flight deck continues · arrival inspection required · aircraft may be held after landing';
      if(optionId==='divert') return `inspection diversion requested · ${diversionConsequenceText(incident)}`;
      if(optionId==='return_origin') return `return requested · ${diversionConsequenceText(incident,{returnOrigin:true})}`;
    }
    if(task.key==='dispatch-pressure-decision'){
      if(optionId==='continue_low') return 'flight deck continues lower · possible +25 min delay · higher fuel burn';
      if(optionId==='divert') return `technical diversion requested · ${diversionConsequenceText(incident)}`;
    }
    return '';
  }

  const api={
    consequenceDelayText,consequenceRange,rotationRiskText,replacementConsequenceText,
    diversionConsequenceText,operationalOptionConsequence,estimateRecoveryOptionCost,costPreviewText,appendCostPreview,
    aircraftSizeFactor,passengerDelayCost,passengerOvernightExposure,crewComplementForFlight,crewRecoveryCost,cancellationRecoveryCost,
    recordRecoveryCostEvent,recordResolvedIncidentRecoveryCost
  };
  global.AeroIncidentConsequences=api;
  Object.assign(global,api);
})(window);
