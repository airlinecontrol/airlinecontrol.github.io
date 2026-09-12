/* Pool-first Personnel UI; operational changes remain in crew services. */
const personnelAssignmentUi={airport:'',flightId:'',mode:'replace',roles:[],source:'local',requestId:'',newRequest:false};

function personnelFlightLabel(flight){
  const needs=personnelFlightVisibleNeeds(flight);
  const needLabel=Object.entries(needs).map(([role,count])=>`${count} ${PERSONNEL[role].label}`).join(', ');
  return `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)} · ${shortDay(flightActualDeparture(flight))} ${shortClock(flightActualDeparture(flight))}${needLabel?` · needs ${needLabel}`:''}`;
}

function personnelFlightVisibleNeeds(flight){
  const unavailable=Object.fromEntries(CREW_ROLES.map(role=>[role,crewUnavailableRoleCount(flight,role)]).filter(([,count])=>count>0));
  return Object.keys(unavailable).length||!flight.staffingBlocked?unavailable:crewAssignmentNeedsForFlight(flight);
}

function personnelPoolCodes(){
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  const focus=[selected?.from,selected&&flightOperationalDestination(selected),state.home].filter(Boolean);
  const staffed=Object.keys(state.personnel.assignments||{}).filter(code=>CREW_ROLES.some(role=>staffAt(code,role)>0));
  const incoming=(state.personnelTransfers||[]).filter(item=>CREW_ROLES.includes(item.role)&&!['completed','cancelled'].includes(item.status)).map(item=>item.actualTo||item.to);
  const recovering=(state.crewRecoveries||[]).filter(item=>item.status!=='cancelled').map(item=>item.availableAirport);
  return [...new Set([...focus,...staffed,...incoming,...recovering])].filter(code=>AIRPORTS[code]);
}

function personnelPoolFlightOptions(airport=personnelAssignmentUi.airport){
  if(!airport) return [];
  return state.flights
    .filter(flight=>flight.from===airport&&!crewGroundActionBlocker(flight))
    .map(flight=>({flight,need:Object.values(personnelFlightVisibleNeeds(flight)).reduce((sum,n)=>sum+n,0)}))
    .sort((a,b)=>b.need-a.need||flightActualDeparture(a.flight)-flightActualDeparture(b.flight))
    .map(item=>item.flight);
}

function personnelAssignmentFlight(){
  const options=personnelPoolFlightOptions();
  if(!personnelAssignmentUi.flightId){
    personnelAssignmentUi.flightId=(options.find(item=>item.id===selectedFlightId)||options[0])?.id||'';
  }
  return options.find(item=>item.id===personnelAssignmentUi.flightId)||options[0]||null;
}

function suggestedCrewAssignmentRoles(flight){
  const needs=Object.keys(crewAssignmentNeedsForFlight(flight));
  if(needs.length) return needs;
  return CREW_ROLES.filter(role=>crewRequirementForFlight(flight)[role]>0).slice(0,1);
}

function crewRoleCheckboxMarkup(roles,attribute,{disabled=false,flight=null}={}){
  const labels={captains:'Captain',firstOfficers:'First officer',cabinCrew:'Cabin crew'};
  return `<div class="crew-role-options">${CREW_ROLES.filter(role=>!flight||crewRequirementForFlight(flight)[role]>0).map(role=>
    `<label><input type="checkbox" ${attribute}="${role}" ${roles.includes(role)?'checked':''} ${disabled?'disabled':''}>${labels[role]}</label>`).join('')}</div>`;
}

function crewAssignmentStatusCopy(record,now=simNow()){
  const remaining=at=>`${Math.max(0,Math.ceil((at-now)/MIN))} min remaining`;
  const labels={requested:'Awaiting crew response',accepted:'Waiting for crew arrival / rest',reporting:'Crew reporting',briefing:'Crew briefing',assigned:'Crew assigned',operating:'Crew operating',resting:'Crew resting',completed:'Duty and rest complete',cancelled:'Request cancelled',failed:'Request unsuccessful'};
  const at=record.status==='requested'?record.acceptedAt:record.status==='reporting'||record.status==='accepted'?record.reportAt:record.status==='resting'?record.restUntil:record.readyAt;
  return {label:labels[record.status]||record.status,detail:crewAssignmentPending(record)||record.status==='resting'?remaining(at):record.outcome,at};
}

function personnelAssignmentReceipt(record,{compact=false}={}){
  const now=simNow(),copy=crewAssignmentStatusCopy(record,now);
  const pending=crewAssignmentPending(record);
  const roles=Object.entries(record.roles).map(([role,n])=>`${n} ${PERSONNEL[role].label.toLowerCase()}`).join(' · ');
  return `<div class="crew-assignment-receipt ${compact?'compact':''}" role="status" data-crew-assignment-receipt="${esc(record.id)}">
    <button type="button" class="row-main-button" data-connection-flight="${esc(record.flightId)}"><b>${esc(record.flightId)} · ${esc(copy.label)}</b><span>${esc(roles)}</span></button>
    <span>${esc(copy.detail||'')}</span>
    ${pending?`<div class="progress-track"><span style="width:${formatPct(clamp((now-record.requestedAt)/Math.max(MIN,record.readyAt-record.requestedAt),0,1))}"></span></div>`:''}
    <span>${pending?'Estimated ready':'Ready'} ${esc(formatTime(record.readyAt))} · ${money(record.cost)}</span>
    ${pending?`<button type="button" class="desk-action-link" data-cancel-crew-assignment="${esc(record.id)}">Cancel request</button>`:
      !compact?'<button type="button" class="desk-action-link" data-new-crew-assignment>New assignment</button>':''}
  </div>`;
}

function pendingCrewAssignmentsMarkup(){
  const records=crewAssignments().filter(crewAssignmentPending).sort((a,b)=>a.readyAt-b.readyAt);
  return records.length?`<section class="desk-section crew-request-list"><h2>Assignment requests</h2>${records.map(record=>personnelAssignmentReceipt(record,{compact:true})).join('')}</section>`:'';
}

function personnelAssignmentPanelMarkup(airport=personnelAssignmentUi.airport){
  if(!airport||personnelAssignmentUi.airport!==airport) return '';
  const options=personnelPoolFlightOptions(airport);
  const flight=personnelAssignmentFlight();
  if(!flight) return `<section class="personnel-form crew-pool-assignment"><header><b>Assign from ${esc(airport)}</b><button type="button" class="icon-button" data-close-crew-pool aria-label="Close">×</button></header><div class="empty-state">No future flight departs from this airport.</div></section>`;
  const activeRecord=crewAssignments().find(item=>item.flightId===flight.id&&crewAssignmentPending(item))||
    (!personnelAssignmentUi.newRequest&&crewAssignmentById(personnelAssignmentUi.requestId));
  const needs=crewAssignmentNeedsForFlight(flight);
  const hasNeed=Object.keys(needs).length>0;
  if(hasNeed&&personnelAssignmentUi.mode==='replace') personnelAssignmentUi.roles=Object.keys(needs);
  if(!personnelAssignmentUi.roles.length) personnelAssignmentUi.roles=suggestedCrewAssignmentRoles(flight);
  const allRoles=personnelAssignmentUi.mode==='full'||personnelAssignmentUi.mode==='augment';
  const roles=allRoles?CREW_ROLES.filter(role=>crewRequirementForFlight(flight)[role]>0):personnelAssignmentUi.roles;
  const sources=crewAssignmentSourceOptions(flight);
  if(!sources.some(item=>item.id===personnelAssignmentUi.source)) personnelAssignmentUi.source='local';
  const preview=crewAssignmentPreview(flight.id,{...personnelAssignmentUi,roles});
  const pool=crewPoolSnapshot(airport);
  const availability=preview.availability.map(item=>`<div><dt>${esc(PERSONNEL[item.role].label)}</dt><dd>${item.amount} fit for this duty / ${item.required} needed <small>${pool.roles[item.role]?.available||0} available now</small></dd></div>`).join('');
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const aircraftContext=aircraft?.location!==airport?`Aircraft currently ${aircraft?.location||'away'}; assignment is held for its future ${airport} departure.`:`Aircraft at ${airport}.`;
  const modeOptions=hasNeed
    ? [['replace','Cover missing crew']]
    : [['replace','Replace selected roles'],['full','Swap full crew'],['augment','Add long-haul relief']];
  return `<section class="personnel-form crew-pool-assignment">
    <header><div><b>Assign from ${esc(airport)}</b><span>${esc(AIRPORTS[airport]?.name||'Crew pool')}</span></div><button type="button" class="icon-button" data-close-crew-pool aria-label="Close">×</button></header>
    <label>Flight<select data-crew-assignment-flight>${options.map(item=>`<option value="${esc(item.id)}" ${item.id===flight.id?'selected':''}>${esc(personnelFlightLabel(item))}</option>`).join('')}</select></label>
    <div class="crew-form-context"><span>${esc(crewRecoveryFlightFamily(flight))} · ${esc(aircraftContext)}</span><button type="button" class="desk-action-link" data-connection-flight="${esc(flight.id)}">Open flight</button></div>
    ${activeRecord?personnelAssignmentReceipt(activeRecord):`
      ${!hasNeed?`<label>Assignment<select data-crew-assignment-mode>${modeOptions.map(([id,label])=>`<option value="${id}" ${personnelAssignmentUi.mode===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}
      ${hasNeed?`<div class="crew-shortage-callout"><b>Required replacement</b><span>${Object.entries(needs).map(([role,count])=>`${count} ${PERSONNEL[role].label.toLowerCase()}`).join(' · ')}</span></div>`:''}
      ${crewRoleCheckboxMarkup(roles,'data-crew-assignment-role',{disabled:allRoles||hasNeed,flight})}
      ${sources.length>1?`<label>Pool source<select data-crew-assignment-source>${sources.map(item=>`<option value="${esc(item.id)}" ${personnelAssignmentUi.source===item.id?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>`:''}
      <dl class="crew-assignment-facts">${availability}
        ${preview.readyAt?`<div><dt>Earliest ready</dt><dd>${esc(formatTime(preview.readyAt))}</dd></div>`:''}
        <div><dt>Duty coverage</dt><dd>${preview.duty?.legal?'Legal through arrival':'Not legal'}</dd></div>
        <div><dt>Departure impact</dt><dd>${preview.delayMin?`At least +${preview.delayMin} min`:'No additional delay'}</dd></div>
        <div><dt>Estimated cost</dt><dd>${money(preview.cost)}</dd></div>
      </dl>
      ${preview.blocker?`<p class="crew-form-message" data-crew-assignment-blocker>${esc(preview.blocker)}</p>`:''}
      <div class="form-actions"><button class="primary-button" type="button" data-request-crew-assignment ${preview.blocker?'disabled':''}>Request assignment</button></div>`}
  </section>`;
}

function crewPoolQualificationMarkup(pool){
  if(!pool.qualifications.length) return '';
  return `<details class="crew-pool-qualifications"><summary>Aircraft qualifications</summary>${pool.qualifications.map(item=>`<div><b>${esc(item.family)}</b><span>CPT ${item.captains} · FO ${item.firstOfficers}</span></div>`).join('')}</details>`;
}

function personnelPoolCardMarkup(code){
  const pool=crewPoolSnapshot(code);
  const active=personnelAssignmentUi.airport===code;
  const status=pool.summary;
  return `<article class="crew-pool-card ${active?'active':''}" data-crew-pool="${esc(code)}">
    <header><div><b>${esc(code)} · ${esc(AIRPORTS[code]?.name||'Station')}</b><span>${status.committed} committed · ${status.onDuty} on duty${status.incoming?` · ${status.incoming} incoming`:''}${status.shortfall?` · ${status.shortfall} uncovered`:''}</span></div><button type="button" class="secondary-button" data-assign-crew-pool="${esc(code)}">Assign to flight</button></header>
    <div class="crew-pool-role-grid">${CREW_ROLES.map(role=>{
      const item=pool.roles[role];
      return `<div><span>${esc(PERSONNEL[role].label)}</span><b>${item.available} available</b><em>${item.total} at station</em></div>`;
    }).join('')}</div>
    ${(status.reporting||status.resting)?`<div class="crew-pool-status">${status.reporting?`${status.reporting} reporting`:''}${status.reporting&&status.resting?' · ':''}${status.resting?`${status.resting} resting / unavailable`:''}</div>`:''}
    ${crewPoolQualificationMarkup(pool)}
    ${personnelAssignmentPanelMarkup(code)}
  </article>`;
}

function personnelPoolsMarkup(){
  const codes=personnelPoolCodes();
  return `${pendingCrewAssignmentsMarkup()}<section class="desk-section crew-pools"><h2>Available pools</h2>${codes.length?codes.map(personnelPoolCardMarkup).join(''):'<div class="empty-state">No crew pools are staffed.</div>'}</section>`;
}

function bindPersonnelAssignmentControls(root){
  const refresh=()=>{ lastPersonnelRailSignature=''; refreshPersonnelRail(true,true); };
  const select=(selector,callback)=>root.querySelector(selector)?.addEventListener('change',event=>{callback(event.target);refresh();});
  root.querySelectorAll('[data-assign-crew-pool]').forEach(button=>button.addEventListener('click',()=>{
    const airport=button.dataset.assignCrewPool;
    personnelAssignmentUi.airport=airport;
    const options=personnelPoolFlightOptions(airport);
    personnelAssignmentUi.flightId=(options.find(item=>item.id===selectedFlightId)||options[0])?.id||'';
    const flight=options.find(item=>item.id===personnelAssignmentUi.flightId);
    personnelAssignmentUi.mode='replace';personnelAssignmentUi.roles=flight?suggestedCrewAssignmentRoles(flight):[];
    personnelAssignmentUi.source='local';personnelAssignmentUi.requestId='';personnelAssignmentUi.newRequest=true;refresh();
  }));
  root.querySelector('[data-close-crew-pool]')?.addEventListener('click',()=>{personnelAssignmentUi.airport='';personnelAssignmentUi.flightId='';personnelAssignmentUi.requestId='';refresh();});
  select('[data-crew-assignment-flight]',input=>{
    personnelAssignmentUi.flightId=input.value;personnelAssignmentUi.mode='replace';personnelAssignmentUi.source='local';personnelAssignmentUi.requestId='';personnelAssignmentUi.newRequest=true;
    const flight=state.flights.find(item=>item.id===input.value);personnelAssignmentUi.roles=flight?suggestedCrewAssignmentRoles(flight):[];
  });
  select('[data-crew-assignment-mode]',input=>{personnelAssignmentUi.mode=input.value;});
  select('[data-crew-assignment-source]',input=>{personnelAssignmentUi.source=input.value;});
  root.querySelectorAll('[data-crew-assignment-role]').forEach(input=>input.addEventListener('change',()=>{
    personnelAssignmentUi.roles=Array.from(root.querySelectorAll('[data-crew-assignment-role]:checked')).map(item=>item.dataset.crewAssignmentRole);refresh();
  }));
  root.querySelector('[data-request-crew-assignment]')?.addEventListener('click',()=>{
    const flight=personnelAssignmentFlight();
    const record=flight&&requestCrewAssignment(flight.id,personnelAssignmentUi);
    if(record){personnelAssignmentUi.requestId=record.id;personnelAssignmentUi.newRequest=false;}
    refresh();
  });
  root.querySelectorAll('[data-cancel-crew-assignment]').forEach(button=>button.addEventListener('click',()=>{cancelCrewAssignment(button.dataset.cancelCrewAssignment);refresh();}));
  root.querySelector('[data-new-crew-assignment]')?.addEventListener('click',()=>{personnelAssignmentUi.requestId='';personnelAssignmentUi.newRequest=true;refresh();});
}
