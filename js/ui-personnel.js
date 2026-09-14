/* Pool-first Personnel UI; operational changes remain in crew services. */
const personnelAssignmentUi={airport:'',flightId:'',requestId:'',newRequest:false};
const expandedCrewPools=new Set();
const CREW_ROLE_LABELS={captains:'Captain',firstOfficers:'First officer',cabinCrew:'Cabin crew'};

function crewAssignmentRolesLabel(roles){
  return Object.entries(roles).filter(([,amount])=>amount>0).map(([role,amount])=>
    `${amount} ${(amount===1?CREW_ROLE_LABELS[role]:PERSONNEL[role].label).toLowerCase()}`).join(' · ');
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

function selectPersonnelAssignmentFlight(flight){
  const pending=flight&&crewAssignments().find(record=>record.flightId===flight.id&&crewAssignmentPending(record));
  Object.assign(personnelAssignmentUi,{
    flightId:flight?.id||'',requestId:pending?.id||'',newRequest:!pending
  });
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
  const phaseStart=({requested:record.requestedAt,accepted:record.acceptedAt,reporting:record.acceptedAt,briefing:record.reportAt})[record.status]||record.requestedAt;
  const roles=crewAssignmentRolesLabel(record.roles);
  if(compact){
    return `<div class="crew-assignment-receipt compact" data-crew-assignment-receipt="${esc(record.id)}">
      <button type="button" class="desk-action-link" data-connection-flight="${esc(record.flightId)}" title="${esc(`${roles} · Ready ${formatTime(record.readyAt)} · ${money(record.cost)}`)}">${esc(record.flightId)}</button>
      ${AeroUi.requestStatus({title:copy.label,pending,startAt:phaseStart,endAt:copy.at})}
      ${pending?`<button type="button" class="icon-button" data-cancel-crew-assignment="${esc(record.id)}" aria-label="Cancel crew request for ${esc(record.flightId)}" title="Cancel request">×</button>`:''}
    </div>`;
  }
  return `<div class="crew-assignment-receipt" data-crew-assignment-receipt="${esc(record.id)}">
    <button type="button" class="desk-action-link" data-connection-flight="${esc(record.flightId)}">${esc(record.flightId)}</button>
    ${AeroUi.requestStatus({title:copy.label,detail:pending?roles:[roles,copy.detail].filter(Boolean).join(' · '),pending,startAt:phaseStart,endAt:copy.at,tone:pending?'':record.status==='failed'?'warning':'success',facts:[[pending?'Estimated ready':'Ready',formatTime(record.readyAt)],['Cost',money(record.cost)]],actions:pending?`<button type="button" class="desk-action-link" data-cancel-crew-assignment="${esc(record.id)}">Cancel request</button>`:'<button type="button" class="desk-action-link" data-new-crew-assignment>New assignment</button>'})}
  </div>`;
}

function pendingCrewAssignmentsMarkup(excludeFlightId=''){
  const records=crewAssignments().filter(record=>crewAssignmentPending(record)&&record.flightId!==excludeFlightId).sort((a,b)=>a.readyAt-b.readyAt);
  return records.length?`<section class="desk-section crew-request-list"><h2>Assignment requests</h2>${AeroUi.list(records,record=>personnelAssignmentReceipt(record,{compact:true}),{key:'crew-assignments'})}</section>`:'';
}

function personnelAssignmentPanelMarkup(airport=personnelAssignmentUi.airport){
  if(!airport||personnelAssignmentUi.airport!==airport) return '';
  const options=personnelPoolFlightOptions(airport);
  const flight=personnelAssignmentFlight();
  if(!flight) return `<section class="personnel-form crew-pool-assignment"><header><b>Assign from ${esc(airport)}</b><button type="button" class="icon-button" data-close-crew-pool aria-label="Close">×</button></header><div class="empty-state">No future flight departs from this airport.</div></section>`;
  const activeRecord=crewAssignments().find(item=>item.flightId===flight.id&&crewAssignmentPending(item))||
    (!personnelAssignmentUi.newRequest&&crewAssignmentById(personnelAssignmentUi.requestId));
  const preview=activeRecord?null:crewAssignmentPlan(flight.id);
  const assigning=preview&&[preview.mode==='full'?'Full crew':preview.mode==='augment'?'Additional crew':'',crewAssignmentRolesLabel(preview.roles)].filter(Boolean).join(' · ');
  const source=preview&&preview.source!=='local'?crewAssignmentSourceOptions(flight).find(item=>item.id===preview.source)?.label:'';
  return `<section class="personnel-form crew-pool-assignment">
    <header><b>Assign from ${esc(airport)}</b><button type="button" class="icon-button" data-close-crew-pool aria-label="Close assignment form" title="Close">×</button></header>
    <label>Flight<select data-crew-assignment-flight>${options.map(item=>`<option value="${esc(item.id)}" ${item.id===flight.id?'selected':''}>${esc(AeroUi.flightLabel(item))}</option>`).join('')}</select></label>
    ${activeRecord?personnelAssignmentReceipt(activeRecord):`
      <dl class="crew-assignment-facts">
        <div><dt>Assigning</dt><dd>${esc(assigning)}<span class="crew-assignment-family">${esc(crewRecoveryFlightFamily(flight))}</span></dd></div>
        ${preview.readyAt?`<div><dt>Ready</dt><dd>${esc(formatTime(preview.readyAt))}${source?`<span class="crew-assignment-source">${esc(source)}</span>`:''}</dd></div>`:''}
        <div><dt>Impact</dt><dd>${preview.delayMin?`At least +${preview.delayMin} min`:'No additional delay'}</dd></div>
        <div><dt>Cost</dt><dd>${money(preview.cost)}</dd></div>
      </dl>
      ${preview.blocker?`<p class="crew-form-message" data-crew-assignment-blocker>${esc(preview.blocker)}</p>`:''}
      <div class="form-actions"><button type="button" class="desk-action-link" data-connection-flight="${esc(flight.id)}">Open flight</button><button class="primary-button" type="button" data-request-crew-assignment ${preview.blocker?'disabled':''}>Assign crew</button></div>`}
  </section>`;
}

function crewPoolQualificationMarkup(pool,code){
  return `<div class="crew-pool-qualifications" id="crew-qualifications-${esc(code)}">
    <b>${esc(AIRPORTS[code].name)}</b>
    ${pool.qualifications.length?`<table><caption>Qualifications at station</caption><thead><tr><th scope="col">Aircraft family</th><th scope="col">Captain</th><th scope="col"><abbr title="First officer">F/O</abbr></th></tr></thead><tbody>${pool.qualifications.map(item=>`<tr><th scope="row">${esc(item.family)}</th><td>${item.captains}</td><td>${item.firstOfficers}</td></tr>`).join('')}</tbody></table>`:'<p>No pilot qualifications recorded.</p>'}
  </div>`;
}

function personnelPoolRowMarkup(code){
  const pool=crewPoolSnapshot(code);
  const active=personnelAssignmentUi.airport===code;
  const expanded=expandedCrewPools.has(code);
  return `<tbody data-crew-pool="${esc(code)}" class="${active?'active':''}">
    <tr class="crew-pool-row">
      <th scope="row"><button type="button" class="crew-pool-toggle" data-toggle-crew-pool="${esc(code)}" aria-expanded="${expanded}" aria-controls="crew-qualifications-${esc(code)}" title="${esc(AIRPORTS[code].name)} qualifications"><span aria-hidden="true">›</span>${esc(code)}</button></th>
      ${CREW_ROLES.map(role=>`<td data-crew-pool-role="${role}" class="${pool.roles[role].available?'':'empty'}">${pool.roles[role].available}</td>`).join('')}
      <td><button type="button" class="desk-action-link" data-assign-crew-pool="${esc(code)}" aria-label="Assign crew from ${esc(code)}" aria-expanded="${active}">Assign</button></td>
    </tr>
    <tr class="crew-pool-details" ${expanded?'':'hidden'}><td colspan="5">${crewPoolQualificationMarkup(pool,code)}</td></tr>
    ${active?`<tr class="crew-pool-assignment-row"><td colspan="5">${personnelAssignmentPanelMarkup(code)}</td></tr>`:''}
  </tbody>`;
}

function personnelPoolsMarkup(){
  const codes=personnelPoolCodes();
  let visibleAssignmentFlightId='';
  const pools=codes.length?AeroUi.list(codes,code=>{
    if(code===personnelAssignmentUi.airport) visibleAssignmentFlightId=personnelAssignmentFlight()?.id||'';
    return personnelPoolRowMarkup(code);
  },{
    key:'crew-pools',
    wrap:rows=>`<table class="crew-pool-table"><caption>Available now</caption><colgroup><col><col><col><col><col></colgroup><thead><tr><th scope="col">Airport</th><th scope="col">Captain</th><th scope="col"><abbr title="First officer">F/O</abbr></th><th scope="col">Cabin</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>${rows}</table>`
  }):'<div class="empty-state">No crew pools are staffed.</div>';
  return `<section class="desk-section crew-pools">${pools}</section>${pendingCrewAssignmentsMarkup(visibleAssignmentFlightId)}`;
}

function bindPersonnelAssignmentControls(root){
  const refresh=()=>{ lastPersonnelRailSignature=''; refreshPersonnelRail(true,true); };
  const select=(selector,callback)=>root.querySelector(selector)?.addEventListener('change',event=>{callback(event.target);refresh();});
  root.querySelectorAll('[data-toggle-crew-pool]').forEach(button=>button.addEventListener('click',()=>{
    const airport=button.dataset.toggleCrewPool;
    const expanded=!expandedCrewPools.has(airport);
    if(expanded) expandedCrewPools.add(airport);else expandedCrewPools.delete(airport);
    button.setAttribute('aria-expanded',String(expanded));
    button.closest('[data-crew-pool]').querySelector('.crew-pool-details').hidden=!expanded;
  }));
  root.querySelectorAll('[data-assign-crew-pool]').forEach(button=>button.addEventListener('click',()=>{
    const airport=button.dataset.assignCrewPool;
    personnelAssignmentUi.airport=airport;
    const options=personnelPoolFlightOptions(airport);
    selectPersonnelAssignmentFlight(options.find(item=>item.id===selectedFlightId)||options[0]);refresh();
  }));
  root.querySelector('[data-close-crew-pool]')?.addEventListener('click',()=>{personnelAssignmentUi.airport='';personnelAssignmentUi.flightId='';personnelAssignmentUi.requestId='';refresh();});
  select('[data-crew-assignment-flight]',input=>{
    selectPersonnelAssignmentFlight(state.flights.find(item=>item.id===input.value));
  });
  root.querySelector('[data-request-crew-assignment]')?.addEventListener('click',()=>{
    const flight=personnelAssignmentFlight();
    const record=flight&&requestCrewForFlight(flight.id);
    if(record){personnelAssignmentUi.requestId=record.id;personnelAssignmentUi.newRequest=false;}
    refresh();
  });
  root.querySelectorAll('[data-cancel-crew-assignment]').forEach(button=>button.addEventListener('click',()=>{cancelCrewAssignment(button.dataset.cancelCrewAssignment);refresh();}));
  root.querySelector('[data-new-crew-assignment]')?.addEventListener('click',()=>{personnelAssignmentUi.requestId='';personnelAssignmentUi.newRequest=true;refresh();});
}
