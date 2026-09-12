/* Independent Station Operations selection, exception forms, and request receipts. */
const stationServiceUi={airport:'',flightId:'',handling:'arrival',service:'capacity',provider:'contract',units:4,durationMin:120,startAt:0,requestId:'',newRequest:false,showAll:false};

function stationRequestStatus(record){
  return ({requested:'Awaiting provider response',offered:'Alternative offered',confirmed:'Confirmed - mobilizing',ready:'Provider ready',in_progress:record.service==='capacity'?'Additional teams available':'Service in progress',completed:'Service completed',unavailable:'Provider unavailable',cancelled:'Cancelled',expired:'Offer expired'})[record.status]||record.status;
}
function stationSelectedAirport(){ return stationServiceUi.airport||state.home; }
function stationSelectedService(){
  if(activeDeskTab('station')==='diversion') return 'arrival';
  return ['capacity','replacement','priority'].includes(stationServiceUi.service)?stationServiceUi.service:'capacity';
}
function stationFlightOptions(phase,service=stationSelectedService()){
  const airport=stationSelectedAirport(),now=simNow();
  return state.flights.filter(flight=>{
    if(flight.cancelled) return false;
    const phaseEligible=phase==='arrival'
      ?flightOperationalDestination(flight)===airport&&(!flightHasCompleted(flight,now)||flightActualArrival(flight)>=now-2*HOUR)
      :flight.from===airport&&!flightHasDeparted(flight,now);
    if(!phaseEligible) return false;
    if(service==='arrival') return Boolean(flight.diversionAirport)||Boolean(stationFlightHandlingRequest(flight,'arrival'));
    if(service==='replacement'){
      const existing=stationFlightHandlingRequest(flight,phase);
      return Boolean(existing)&&!['in_progress','completed'].includes(existing.status);
    }
    if(service==='priority') return phase==='departure'&&Number(flight.handlingDelayMin)>0;
    return false;
  })
    .sort((a,b)=>(phase==='arrival'?flightActualArrival(a)-flightActualArrival(b):flightActualDeparture(a)-flightActualDeparture(b))||a.id.localeCompare(b.id));
}
function stationServiceFormOptions(){
  const ui=stationServiceUi,service=stationSelectedService(),phase=stationServicePhase({service,handling:ui.handling});
  const flights=phase==='station'?[]:stationFlightOptions(phase,service);
  const flight=flights.find(item=>item.id===ui.flightId)||flights[0]||null;
  return {airport:stationSelectedAirport(),service,provider:ui.provider,flightId:flight?.id||'',handling:ui.handling,
    units:ui.units,durationMin:ui.durationMin,startAt:ui.startAt===0?simNow():ui.startAt,flight,flights,phase};
}
function stationRequestReceipt(record){
  const now=simNow();
  const response=record.status==='requested',offered=record.status==='offered';
  const target=response?record.respondsAt:offered?record.offerExpiresAt:record.status==='confirmed'?record.readyAt:record.status==='in_progress'?record.endsAt:0;
  const remaining=target?`${Math.max(0,Math.ceil((target-now)/MIN))} min remaining`:'';
  const progress=response?clamp((now-record.requestedAt)/Math.max(MIN,record.respondsAt-record.requestedAt),0,1):record.status==='in_progress'?clamp((now-record.startedAt)/Math.max(MIN,record.endsAt-record.startedAt),0,1):null;
  return `<section class="station-receipt" data-station-receipt="${esc(record.id)}" role="status">
    <div class="station-status-heading"><b>${esc(stationRequestStatus(record))}</b><span>${esc(remaining)}</span></div>
    <span>${esc(STATION_SERVICES[record.service].label)} · ${esc(STATION_PROVIDERS[record.provider])}</span>
    ${progress!==null?`<div class="progress-track"><span style="width:${formatPct(progress)}"></span></div>`:''}
    ${record.outcome?`<p>${esc(record.outcome)}</p>`:''}
    <dl class="station-facts"><div><dt>Provider ready</dt><dd>${esc(formatTime(record.readyAt))}</dd></div><div><dt>Service window</dt><dd>${esc(shortClock(record.startAt))} - ${esc(shortClock(record.endsAt))}</dd></div><div><dt>${record.confirmedAt?'Booked cost':'Quoted cost'}</dt><dd>${money(record.cost)}</dd></div></dl>
    <div class="form-actions">${offered?`<button class="primary-button" type="button" data-station-accept="${esc(record.id)}">Accept offer</button>`:''}
      ${['requested','offered','confirmed','ready'].includes(record.status)?`<button class="desk-action-link" type="button" data-station-cancel="${esc(record.id)}">${offered?'Decline offer':'Cancel request'}</button>`:''}</div>
  </section>`;
}
function stationOverviewMarkup(){
  const airport=stationSelectedAirport(),now=simNow(),weather=Management.weatherAt(airport,now);
  const profiles=Object.keys(STATION_PROVIDERS).map(id=>({id,...stationProviderProfile(airport,id,now)}));
  const records=stationServiceRequests().filter(item=>item.airport===airport)
    .sort((a,b)=>Number(stationServiceReserved(b))-Number(stationServiceReserved(a))||b.requestedAt-a.requestedAt);
  const shown=stationServiceUi.showAll?records:records.slice(0,6);
  return `<section class="station-overview"><div class="station-weather"><span aria-hidden="true">${weatherIcon(weather)}</span><b>${esc(weather.conditions)}</b><span>${Math.round((weather.capacityFactor||1)*100)}% weather capacity</span></div>
    <dl class="station-facts">${profiles.map(profile=>`<div><dt>${esc(profile.label)}</dt><dd>${profile.available?`${profile.capacity} teams`:'Unavailable'}</dd></div>`).join('')}<div><dt>Additional teams active</dt><dd>${stationAdditionalTeams(airport,now)}</dd></div></dl>
    <h2>Exceptional coordination</h2><div class="station-request-list">${shown.length?shown.map(record=>`<button type="button" class="station-request-row" data-station-open="${esc(record.id)}"><span><b>${esc(record.flightId||record.airport)} · ${esc(STATION_SERVICES[record.service].label)}</b><small>${esc(STATION_PROVIDERS[record.provider])} · ${esc(shortClock(record.startAt))}</small></span><em>${esc(stationRequestStatus(record))}</em></button>`).join(''):'<div class="empty-state">No station coordination requests.</div>'}</div>
    ${records.length>6?`<button class="desk-action-link" type="button" data-station-show-all>${stationServiceUi.showAll?'Show fewer':`Show all ${records.length}`}</button>`:''}</section>`;
}
function stationServiceFormMarkup(){
  const ui=stationServiceUi,options=stationServiceFormOptions(),service=options.service;
  const selected=stationServiceRequest(ui.requestId);
  const record=selected&&selected.airport===options.airport&&STATION_SERVICES[selected.service].tab===activeDeskTab('station')?selected:
    !ui.newRequest?stationServiceRequests().filter(item=>item.airport===options.airport&&item.flightId===options.flightId&&item.service===service).at(-1):null;
  if(record) return `${record.flightId?`<div class="station-flight-context"><b>${esc(record.flightId)} · ${esc(record.airport)}</b><button type="button" class="desk-action-link" data-connection-flight="${esc(record.flightId)}">Open flight</button></div>`:''}${stationRequestReceipt(record)}<button class="desk-action-link station-other-request" type="button" data-station-new>Other service / flight</button>`;
  const preview=stationServicePreview(options);
  const panel=activeDeskTab('station');
  const serviceChoices=Object.entries(STATION_SERVICES).filter(([,model])=>model.tab===panel&&model.manual!==false);
  const submitLabel=service==='arrival'?'Request diversion handling':service==='capacity'?'Request additional teams':service==='replacement'?'Request replacement handler':'Request turnaround priority';
  return `<section class="station-service-form">
    ${panel==='recovery'?`<label>Recovery action<select data-station-service>${serviceChoices.map(([id,model])=>`<option value="${id}" ${id===service?'selected':''}>${esc(model.label)}</option>`).join('')}</select></label>`:''}
    ${service==='replacement'?`<label>Handling phase<select data-station-handling><option value="arrival" ${ui.handling==='arrival'?'selected':''}>Arrival handling</option><option value="departure" ${ui.handling==='departure'?'selected':''}>Departure handling</option></select></label>`:''}
    ${options.phase!=='station'?`<label>${service==='arrival'?'Diverted flight':'Flight'}<select data-station-flight ${!options.flights.length?'disabled':''}>${options.flights.length?options.flights.map(flight=>`<option value="${esc(flight.id)}" ${options.flightId===flight.id?'selected':''}>${esc(personnelFlightLabel(flight))}</option>`).join(''):`<option>${service==='arrival'?'No diverted arrival needs handling':service==='priority'?'No flight has recoverable handling delay':'No handler replacement is needed'}</option>`}</select></label>`:
      `<div class="station-form-pair"><label>Additional teams<select data-station-units>${[2,4,6,8].map(n=>`<option value="${n}" ${ui.units===n?'selected':''}>${n}</option>`).join('')}</select></label><label>Duration<select data-station-duration>${[60,120,240].map(n=>`<option value="${n}" ${ui.durationMin===n?'selected':''}>${n/60} hours</option>`).join('')}</select></label></div><label>Coverage from<input type="datetime-local" data-station-start value="${Number.isFinite(options.startAt)?datetimeLocalValue(options.startAt):''}"></label>`}
    <label>Provider<select data-station-provider>${Object.entries(STATION_PROVIDERS).map(([id,label])=>`<option value="${id}" ${ui.provider===id?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
    <dl class="station-facts"><div><dt>Provider capacity ${infoTip('Modeled handling teams, reduced by weather. Existing requests reserve service windows; this is not runway capacity.')}</dt><dd>${preview.profile.capacity} teams / ${preview.units} required</dd></div><div><dt>Response</dt><dd>${preview.responseMin} min</dd></div><div><dt>Earliest provider ready</dt><dd>${esc(formatTime(preview.readyAt))}</dd></div><div><dt>Service window</dt><dd>${esc(shortClock(preview.startAt))} - ${esc(shortClock(preview.endsAt))}</dd></div><div><dt>Potential impact</dt><dd>${preview.impactMin?`+${preview.impactMin} min wait`:'No additional wait'}</dd></div><div><dt>Estimated cost</dt><dd>${money(preview.cost)}</dd></div></dl>
    ${preview.blocker?`<p class="station-form-message">${esc(preview.blocker)}</p>`:''}
    <div class="form-actions"><button type="button" class="primary-button" data-station-request ${preview.blocker?'disabled':''}>${submitLabel}</button></div>
  </section>`;
}
function stationServicesDeskMarkup(){
  const airport=stationSelectedAirport();
  const panels=['overview','diversion','recovery'];
  if(!panels.includes(activeDeskTab('station'))){
    delete workspaceUi.nextDeskPanels.station;
    saveWorkspaceUi();
  }
  return `<div data-station-widget><label class="station-selector">Station<select data-station-airport>${Object.keys(AIRPORTS).sort().map(code=>`<option value="${code}" ${code===airport?'selected':''}>${esc(code)} - ${esc(AIRPORTS[code].name)}</option>`).join('')}</select></label>
    ${deskActionBar('station',[{panel:'overview',label:'Overview'},{panel:'diversion',label:'Diversions'},{panel:'recovery',label:'Recovery'}])}
    ${activeDeskTab('station')==='overview'?stationOverviewMarkup():stationServiceFormMarkup()}</div>`;
}
function stationServicesRenderKey(now=simNow()){
  return [JSON.stringify(stationServiceUi),Math.floor(now/MIN),stationServiceRequests().map(record=>`${record.id}:${record.status}:${record.updatedAt}:${record.readyAt}:${record.startAt}:${record.endsAt}`).join('|'),
    state.flights.map(flight=>`${flight.id}:${flightActualDeparture(flight)}:${flightActualArrival(flight)}:${flightOperationalDestination(flight)}:${flight.cancelled}:${flight.departureLogged}:${flight.settled}`).join('|')].join('::');
}
function bindStationServiceControls(root){
  const host=root.querySelector('[data-station-widget]');if(!host) return;
  const refresh=()=>{lastDeskStackSignature='';renderDeskStack(true,true);};
  const change=(selector,callback)=>host.querySelector(selector)?.addEventListener('change',event=>{callback(event.target);refresh();});
  change('[data-station-airport]',input=>{Object.assign(stationServiceUi,{airport:input.value,flightId:'',requestId:'',newRequest:false});});
  change('[data-station-flight]',input=>{stationServiceUi.flightId=input.value;});
  change('[data-station-service]',input=>{stationServiceUi.service=input.value;stationServiceUi.flightId='';stationServiceUi.requestId='';stationServiceUi.newRequest=true;});
  change('[data-station-handling]',input=>{stationServiceUi.handling=input.value;});
  change('[data-station-provider]',input=>{stationServiceUi.provider=input.value;});
  change('[data-station-units]',input=>{stationServiceUi.units=Number(input.value);});
  change('[data-station-duration]',input=>{stationServiceUi.durationMin=Number(input.value);});
  change('[data-station-start]',input=>{stationServiceUi.startAt=new Date(input.value).getTime();});
  host.querySelector('[data-station-request]')?.addEventListener('click',()=>{const options=stationServiceFormOptions();const record=requestStationService(options);if(record) Object.assign(stationServiceUi,{requestId:record.id,flightId:record.flightId,newRequest:false});refresh();});
  host.querySelectorAll('[data-station-new]').forEach(button=>button.addEventListener('click',()=>{stationServiceUi.requestId='';stationServiceUi.newRequest=true;refresh();}));
  host.querySelector('[data-station-cancel]')?.addEventListener('click',event=>{cancelStationService(event.currentTarget.dataset.stationCancel);refresh();});
  host.querySelector('[data-station-accept]')?.addEventListener('click',event=>{acceptStationServiceOffer(event.currentTarget.dataset.stationAccept);refresh();});
  host.querySelector('[data-station-show-all]')?.addEventListener('click',()=>{stationServiceUi.showAll=!stationServiceUi.showAll;refresh();});
  root.querySelectorAll('[data-station-open]').forEach(button=>button.addEventListener('click',()=>{
    const record=stationServiceRequest(button.dataset.stationOpen);stationServiceUi.requestId=record.id;stationServiceUi.newRequest=false;stationServiceUi.airport=record.airport;
    setDeskPanel('station',STATION_SERVICES[record.service].tab,{toggle:false});refresh();
    document.getElementById('occ-desk-station')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  host.addEventListener('focusout',()=>setTimeout(()=>{if(!activeFormControlWithin(host)) renderDeskStack(false);},0));
}
