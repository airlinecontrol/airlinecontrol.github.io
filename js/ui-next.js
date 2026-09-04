/* AeroSim Next UI — a quieter presentation over the existing simulation state. */

const scheduleTypeEl=document.getElementById('scheduleType');
const aircraftEl=document.getElementById('aircraft');
const originEl=document.getElementById('origin');
const destEl=document.getElementById('destination');
const departureTimeEl=document.getElementById('departureTime');
const repeatRuleEl=document.getElementById('repeatRule');
const turnaroundEl=document.getElementById('turnaround');
const scheduleBtn=document.getElementById('scheduleBtn');
const requestSlotsBtn=document.getElementById('requestSlotsBtn');
const operatingDayEls=[];
const operatingMonthEls=[];

let nextWorkspace='operations';
let managementPage='planning';
let contextMode='context';
let focusedTaskId='';
let lastContextSignature='';
let lastFlightListSignature='';
let lastAircraftListSignature='';
let lastManagementSignature='';
let lastDeskStackSignature='';

const managementContentHome=document.querySelector('.management-content');
const embeddedManagementPages=new Map([...document.querySelectorAll('[data-management-content]')].map(element=>[
  element.dataset.managementContent,{element,parent:element.parentNode,next:element.nextSibling}
]));

const baseSettleSelected=settleSelected;
const baseSettleSelectedFlight=settleSelectedFlight;
settleSelected=function(acId){ contextMode='context'; return baseSettleSelected(acId); };
settleSelectedFlight=function(flightId){ contextMode='context'; return baseSettleSelectedFlight(flightId); };

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function shortClock(ms){ return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(ms)); }
function shortDay(ms){ return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(ms)); }
function formatPct(value){ return `${Math.round(clamp(Number(value)||0,0,1)*100)}%`; }
function selectedOperatingCalendar(){ return {days:[],months:[]}; }
function currentScheduleFares(){
  if(!AIRPORTS[originEl.value]||!AIRPORTS[destEl.value]||originEl.value===destEl.value) return {economy:0,business:0,first:0};
  const km=distanceKm(AIRPORTS[originEl.value],AIRPORTS[destEl.value]);
  const economy=Math.max(60,Math.round(45+km*.105));
  return {economy,business:Math.round(economy*2.65),first:Math.round(economy*5.2)};
}
function closeFlightPlanningWidget(){ showWorkspace('operations'); }
function setWidgetOpen(){}
function incidentCopy(incident){
  const definition=INCIDENT_DEFINITIONS[incident?.type]||{};
  const title=incident?.title||definition.title||String(incident?.type||'Operational issue').replaceAll('_',' ');
  return {title:incident?.training?`Training · ${title}`:title,summary:incident?.summary||definition.summary||'Operational coordination is required.'};
}

function showWorkspace(name){
  if(name==='management'){
    restoreEmbeddedManagementPages();
    document.querySelectorAll('[data-management-content]').forEach(section=>{
      const active=section.dataset.managementContent===managementPage;
      section.hidden=!active; section.classList.toggle('active',active);
    });
  }
  nextWorkspace=name==='management'?'management':'operations';
  activeWorkspaceView=nextWorkspace;
  document.getElementById('operationsView').hidden=nextWorkspace!=='operations';
  document.getElementById('managementView').hidden=nextWorkspace!=='management';
  document.querySelectorAll('[data-workspace]').forEach(button=>button.classList.toggle('active',button.dataset.workspace===nextWorkspace));
  if(nextWorkspace==='operations') requestAnimationFrame(()=>{
    if(typeof map!=='undefined') map.invalidateSize({animate:false});
    refreshScheduleTimeline(true);
  });
  else refreshManagement(true);
}

function restoreEmbeddedManagementPages(){
  for(const {element,parent,next} of embeddedManagementPages.values()){
    if(element.parentNode===parent) continue;
    if(next&&next.parentNode===parent) parent.insertBefore(element,next); else parent.appendChild(element);
  }
}

function showManagementPage(page){
  managementPage=page;
  document.querySelectorAll('[data-management-page]').forEach(button=>button.classList.toggle('active',button.dataset.managementPage===page));
  document.querySelectorAll('[data-management-content]').forEach(section=>{
    const active=section.dataset.managementContent===page;
    section.hidden=!active; section.classList.toggle('active',active);
  });
  refreshManagement(true);
}

function attentionForFlight(flight){
  const incident=openIncidentsForFlight(flight.id)[0];
  if(incident) return {label:incidentCopy(incident).title,critical:Boolean(incident.blocking),incident};
  if(flight.staffingBlocked||flight.staffingDelayMin) return {label:flight.staffingShortage||'Crew or station staffing shortfall',critical:true};
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  if(aircraftIsDefective(aircraft)) return {label:aircraft.defectReason||'Aircraft unavailable',critical:true};
  if(flight.slotMissed) return {label:`Departure slot missed · ${flight.slotDelayMin||0} min wait`,critical:false};
  if(flight.weatherDelayMin) return {label:`Weather · ${flight.weatherDelayMin} min`,critical:false};
  if(flight.airportDelayMin||flight.airspaceDelayMin) return {label:`Network restriction · ${(flight.airportDelayMin||0)+(flight.airspaceDelayMin||0)} min`,critical:false};
  if(flight.handlingDelayMin) return {label:`Ground handling · ${flight.handlingDelayMin} min`,critical:false};
  const delay=flightTotalDepartureDelayMin(flight);
  return delay?{label:`Departure delayed ${delay} min`,critical:false}:null;
}

function attentionForAircraft(aircraft){
  const incident=state.incidents.find(item=>item.status==='open'&&item.aircraftId===aircraft.id);
  if(incident) return incidentCopy(incident).title;
  if(aircraftIsDefective(aircraft)) return aircraft.defectReason||'Technical restriction';
  const maintenance=Management.maintenanceStatus(aircraft,simNow());
  if(maintenance.grounding) return 'Maintenance limit exceeded';
  if(maintenance.due) return 'Maintenance due';
  return '';
}

function flightListRow(flight,active=false){
  const issue=attentionForFlight(flight);
  const status=statusOfFlight(flight);
  const destination=flightOperationalDestination(flight);
  return `<button class="list-row ${issue?'needs-attention':''} ${selectedFlightId===flight.id?'selected':''}" type="button" data-next-flight="${esc(flight.id)}">
    ${issue?'<i class="attention-marker"></i>':''}
    <span class="list-primary"><span>${esc(flight.id)} · ${esc(flight.from)} → ${esc(destination)}</span><span>${active?formatPct(flightProgress(flight)):shortClock(flightActualDeparture(flight))}</span></span>
    <span class="list-secondary"><span>${esc(status==='airborne'?'Airborne':status==='delayed'?'Delayed':'Scheduled')}</span><span>${esc(shortDay(flightActualDeparture(flight)))}</span></span>
    ${issue?`<span class="list-reason">${esc(issue.label)}</span>`:''}
    ${active?`<span class="active-progress"><span style="width:${formatPct(flightProgress(flight))}"></span></span>`:''}
  </button>`;
}

function refreshOccWidgets(force=false){
  const now=simNow();
  const active=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)<=now&&now<flightActualArrival(f)).sort((a,b)=>flightActualArrival(a)-flightActualArrival(b));
  const upcoming=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)>now&&flightActualDeparture(f)<=now+24*HOUR).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const signature=[selectedFlightId,active.map(f=>`${f.id}:${attentionForFlight(f)?.label||''}:${Math.floor(flightProgress(f)*50)}`).join('|'),upcoming.map(f=>`${f.id}:${flightActualDeparture(f)}:${attentionForFlight(f)?.label||''}`).join('|')].join('::');
  if(!force&&signature===lastFlightListSignature) return;
  lastFlightListSignature=signature;
  document.getElementById('activeFlightCount').textContent=active.length;
  document.getElementById('upcomingFlightCount').textContent=upcoming.length;
  document.getElementById('activeFlightList').innerHTML=active.length?active.map(f=>flightListRow(f,true)).join(''):'<div class="empty-state">No flights are airborne.</div>';
  document.getElementById('upcomingFlightList').innerHTML=upcoming.length?upcoming.map(f=>flightListRow(f)).join(''):'<div class="empty-state">No flights in the next 24 hours.</div>';
  document.querySelectorAll('[data-next-flight]').forEach(button=>button.addEventListener('click',()=>{
    contextMode='context'; settleSelectedFlight(button.dataset.nextFlight);
  }));
}

function refreshFleetList(force=false){
  const signature=[selectedAircraftId,selectedFlightId,state.aircraft.map(ac=>{
    const active=aircraftActiveFlight(ac.id),next=aircraftUpcomingFlight(ac.id);
    return `${ac.id}:${ac.location}:${active?.id||''}:${next?.id||''}:${attentionForAircraft(ac)}`;
  }).join('|')].join('::');
  if(!force&&signature===lastAircraftListSignature) return;
  lastAircraftListSignature=signature;
  document.getElementById('aircraftListCount').textContent=state.aircraft.length;
  document.getElementById('aircraftList').innerHTML=state.aircraft.length?state.aircraft.map(ac=>{
    const active=aircraftActiveFlight(ac.id),next=aircraftUpcomingFlight(ac.id),issue=attentionForAircraft(ac);
    const place=active?`${active.from} → ${flightOperationalDestination(active)}`:ac.location;
    const sub=active?`Airborne · ${active.id}`:next?`Next ${next.id} · ${shortClock(flightActualDeparture(next))}`:'Available';
    return `<button class="list-row ${issue?'needs-attention':''} ${selectedAircraftId===ac.id&&!selectedFlightId?'selected':''}" type="button" data-next-aircraft="${esc(ac.id)}">
      ${issue?'<i class="attention-marker"></i>':''}<span class="list-primary"><span>${esc(ac.tail)}</span><span>${esc(place)}</span></span>
      <span class="list-secondary"><span>${esc(ac.model)}</span><span>${esc(sub)}</span></span>${issue?`<span class="list-reason">${esc(issue)}</span>`:''}
    </button>`;
  }).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  document.querySelectorAll('[data-next-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    contextMode='context'; settleSelected(button.dataset.nextAircraft);
  }));
}

function phaseMarkup(operation){
  if(!operation?.phase) return '<div class="empty-state">No ground activity is currently planned.</div>';
  const phase=operation.phase;
  const tasks=phase.tasks||[];
  return `<div class="ground-overview" data-ground-phase="${esc(phase.key)}"><div class="ground-head"><b>${esc(phase.label||phase.key)}</b><span class="ground-percent">${formatPct(phase.progress)}</span></div>
    <div class="progress-track"><span data-ground-phase-progress style="width:${formatPct(phase.progress)}"></span></div>
    ${tasks.length?`<button class="ground-task-toggle" type="button" aria-expanded="false">Show ${tasks.length} ground tasks</button><div class="ground-task-list" hidden>${tasks.map(task=>`<div class="task-progress-row ${task.status==='complete'?'complete':''}" data-ground-task="${esc(task.id)}"><div><span>${esc(task.label)}</span><em>${esc(task.status==='complete'?'Complete':task.status==='active'?'In progress':'Planned')}</em></div><div class="progress-track"><span style="width:${formatPct(task.progress)}"></span></div></div>`).join('')}</div>`:''}
  </div>`;
}

function contextHeader(eyebrow,title,subtitle=''){
  return `<header class="context-header"><div><span class="context-eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button class="icon-button" type="button" data-close-context aria-label="Close">×</button></header>`;
}

function fact(label,value){ return `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`; }

function renderFlightContext(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const issue=attentionForFlight(flight);
  const incident=issue?.incident;
  const workflow=incident?incidentWorkflowProgress(incident):null;
  const duty=crewDutyForFlight(flight);
  const ground=groundOperationsForFlight(flight);
  const now=simNow();
  const operation=flightActualArrival(flight)<=now?{flight,phase:ground?.postflight}:flightActualDeparture(flight)>now?{flight,phase:ground?.departure}:null;
  const delay=flightTotalDepartureDelayMin(flight);
  const pane=document.getElementById('contextPane');
  pane.innerHTML=`${contextHeader('Flight',`${flight.from} → ${flightOperationalDestination(flight)}`,`${flight.id} · ${statusOfFlight(flight)}`)}
    ${issue?`<section class="attention-summary ${issue.critical?'critical':'warning'}"><b>${esc(issue.label)}</b>${incident?`<span>${esc(incidentCopy(incident).summary)}</span><div class="next-action">Next: ${esc(workflow?.current?.label||'Review case')}</div><button class="primary-button" type="button" data-handle-incident="${esc(incident.id)}">Handle task</button>`:''}</section>`:''}
    <div class="fact-grid">${fact('Scheduled',`${shortClock(flight.departure)}–${shortClock(flight.arrival)}`)}${fact('Expected',`${shortClock(flightActualDeparture(flight))}–${shortClock(flightActualArrival(flight))}`)}${fact('Departure delay',delay?`+${delay} min`:'On time')}${fact('Aircraft',aircraft?`${aircraft.tail} · ${aircraft.model}`:'Unassigned')}</div>
    <section class="context-section"><h2>Ground progress</h2>${operation?phaseMarkup(operation):flightActualDeparture(flight)<=now&&now<flightActualArrival(flight)?'<div class="simple-row"><span>Current phase</span><b>Airborne</b></div>':phaseMarkup(null)}</section>
    <section class="context-section"><h2>Crew duty</h2><div class="simple-row"><span>Planned duty</span><b>${Number(duty.dutyHours||0).toFixed(1)} h / ${Number(duty.maxHours||0).toFixed(1)} h</b></div><div class="simple-row"><span>Sectors</span><b>${duty.sectors||1}${rotationUsesThroughCrew(flight)?' · through crew':''}</b></div><div class="simple-row"><span>Legality</span><b>${duty.legal?'Within limit':'Limit exceeded'}</b></div></section>
    ${aircraft?`<section class="context-section"><button class="object-link" type="button" data-context-aircraft="${esc(aircraft.id)}"><span>Assigned aircraft</span><b>${esc(aircraft.tail)} →</b></button></section>`:''}
    ${!flight.cancelled&&flightActualDeparture(flight)>now?`<div class="context-actions"><button class="danger-button" type="button" data-cancel-next-flight="${esc(flight.id)}">Cancel flight</button></div>`:''}`;
  bindContextCommon();
  pane.querySelector('[data-handle-incident]')?.addEventListener('click',()=>openIncidentTask(incident));
  pane.querySelector('[data-context-aircraft]')?.addEventListener('click',button=>{contextMode='context';settleSelected(button.currentTarget.dataset.contextAircraft);});
  pane.querySelector('[data-cancel-next-flight]')?.addEventListener('click',button=>cancelFlight(button.currentTarget.dataset.cancelNextFlight));
}

function renderAircraftContext(aircraft){
  const active=aircraftActiveFlight(aircraft.id),upcoming=aircraftUpcomingFlight(aircraft.id);
  const incident=state.incidents.find(item=>item.status==='open'&&item.aircraftId===aircraft.id);
  const maintenance=Management.maintenanceStatus(aircraft,simNow());
  const ground=aircraftGroundOperation(aircraft);
  const fuel=aircraftFuelPerformance(MODELS[aircraft.model]);
  const pane=document.getElementById('contextPane');
  pane.innerHTML=`${contextHeader('Aircraft',aircraft.tail,aircraft.model)}
    ${incident?`<section class="attention-summary critical"><b>${esc(incidentCopy(incident).title)}</b><span>${esc(incidentCopy(incident).summary)}</span><div class="next-action">Next: ${esc(incidentWorkflowProgress(incident).current?.label||'Review case')}</div><button class="primary-button" type="button" data-handle-aircraft-incident>Handle task</button></section>`:''}
    <div class="fact-grid">${fact('Location',active?`${active.from} → ${flightOperationalDestination(active)}`:aircraft.location)}${fact('Condition',`${Math.round(aircraft.condition??100)}%`)}${fact('Utilisation',`${Math.round(aircraft.flightHours||0)} h · ${aircraft.cycles||0} cycles`)}${fact('Fuel',`${Math.round(aircraft.fuelGallons||0)} / ${Math.round(fuel.tankGallons)} gal`)}</div>
    <section class="context-section"><h2>Current ground work</h2>${phaseMarkup(ground)}</section>
    <section class="context-section"><h2>Maintenance</h2><div class="simple-row"><span>Status</span><b>${esc(maintenance.label)}</b></div><div class="simple-row"><span>Next limit</span><b>${Math.max(0,Math.round(maintenance.remainingHours||0))} h / ${Math.max(0,Math.round(maintenance.remainingCycles||0))} cycles</b></div></section>
    <section class="context-section"><h2>Flying programme</h2>${active?`<button class="object-link" type="button" data-context-flight="${esc(active.id)}"><span>Active</span><b>${esc(active.id)} · ${esc(active.from)} → ${esc(flightOperationalDestination(active))}</b></button>`:''}${upcoming?`<button class="object-link" type="button" data-context-flight="${esc(upcoming.id)}"><span>Next</span><b>${esc(upcoming.id)} · ${shortClock(flightActualDeparture(upcoming))}</b></button>`:''}${!active&&!upcoming?'<div class="simple-row"><span>Assignment</span><b>Available</b></div>':''}</section>`;
  bindContextCommon();
  pane.querySelector('[data-handle-aircraft-incident]')?.addEventListener('click',()=>openIncidentTask(incident));
  pane.querySelectorAll('[data-context-flight]').forEach(button=>button.addEventListener('click',()=>{contextMode='context';settleSelectedFlight(button.dataset.contextFlight);}));
}

function renderFlightSummary(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId),issue=attentionForFlight(flight),incident=issue?.incident,duty=crewDutyForFlight(flight),now=simNow(),ground=groundOperationsForFlight(flight);
  const phase=flightActualArrival(flight)<=now?ground?.postflight:flightActualDeparture(flight)>now?ground?.departure:null;
  const pane=document.getElementById('contextPane'); pane.classList.add('context-compact');
  pane.innerHTML=`${contextHeader('Selected flight',`${flight.from} → ${flightOperationalDestination(flight)}`,`${flight.id} · ${aircraft?.tail||'Unassigned'} · ${statusOfFlight(flight)}`)}
    ${issue?`<section class="attention-summary ${issue.critical?'critical':'warning'}"><b>${esc(issue.label)}</b>${incident?`<span>Next: ${esc(incidentWorkflowProgress(incident).current?.label||'Review case')}</span><button class="primary-button" type="button" data-summary-task>Work task</button>`:''}</section>`:''}
    <div class="compact-status-lines"><div class="compact-status-line"><span>Expected</span><b>${shortClock(flightActualDeparture(flight))}–${shortClock(flightActualArrival(flight))}</b><em>${flightTotalDepartureDelayMin(flight)?`+${flightTotalDepartureDelayMin(flight)} min`:'On time'}</em></div>
    <div class="compact-status-line"><span>Ground</span><b>${esc(phase?.label||'No active ground phase')}</b><div class="progress-track"><span style="width:${formatPct(phase?.progress||0)}"></span></div></div>
    <div class="compact-status-line"><span>Crew duty</span><b>${Number(duty.dutyHours||0).toFixed(1)} / ${Number(duty.maxHours||0).toFixed(1)} h</b><em>${duty.legal?'Legal':'Exceeded'}</em></div></div>
    <button class="secondary-button compact-details-action" type="button" data-full-flight>Open full flight details</button>`;
  bindContextCommon();
  pane.querySelector('[data-summary-task]')?.addEventListener('click',()=>openIncidentTask(incident));
  pane.querySelector('[data-full-flight]')?.addEventListener('click',()=>{contextMode='details';lastContextSignature='';renderContext(true);});
}

function renderAircraftSummary(aircraft){
  const active=aircraftActiveFlight(aircraft.id),next=aircraftUpcomingFlight(aircraft.id),maintenance=Management.maintenanceStatus(aircraft,simNow()),ground=aircraftGroundOperation(aircraft),incident=state.incidents.find(item=>item.status==='open'&&item.aircraftId===aircraft.id);
  const pane=document.getElementById('contextPane'); pane.classList.add('context-compact');
  pane.innerHTML=`${contextHeader('Selected aircraft',aircraft.tail,`${aircraft.model} · ${active?'Airborne':aircraft.location}`)}
    ${incident?`<section class="attention-summary critical"><b>${esc(incidentCopy(incident).title)}</b><span>Next: ${esc(incidentWorkflowProgress(incident).current?.label||'Review case')}</span><button class="primary-button" type="button" data-summary-task>Work task</button></section>`:''}
    <div class="compact-status-lines"><div class="compact-status-line"><span>Condition</span><b>${Math.round(aircraft.condition??100)}%</b><em>${esc(maintenance.label)}</em></div><div class="compact-status-line"><span>Ground</span><b>${esc(ground?.phase?.label||'No active ground work')}</b><div class="progress-track"><span style="width:${formatPct(ground?.phase?.progress||0)}"></span></div></div><div class="compact-status-line"><span>Programme</span><b>${esc(active?.id||next?.id||'Available')}</b><em>${next?shortClock(flightActualDeparture(next)):''}</em></div></div>
    <button class="secondary-button compact-details-action" type="button" data-full-aircraft>Open full aircraft details</button>`;
  bindContextCommon(); pane.querySelector('[data-summary-task]')?.addEventListener('click',()=>openIncidentTask(incident)); pane.querySelector('[data-full-aircraft]')?.addEventListener('click',()=>{contextMode='details';lastContextSignature='';renderContext(true);});
}

function bindContextCommon(){
  document.querySelector('[data-close-context]')?.addEventListener('click',()=>{
    selectedFlightId=null; selectedAircraftId=null; contextMode='context'; lastContextSignature=''; renderContext(true); refreshOccWidgets(true); refreshFleetList(true); refreshScheduleTimeline(true); updateMapData();
  });
  document.querySelectorAll('#contextPane .ground-task-toggle').forEach(button=>button.addEventListener('click',()=>{
    const list=button.nextElementSibling,expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));
    if(list) list.hidden=expanded;
    button.textContent=expanded?`Show ${list?.children.length||0} ground tasks`:'Hide ground tasks';
  }));
}

function actionableTasks(){
  return (state.coordinationTasks||[]).filter(task=>!['completed','cancelled'].includes(task.status));
}
function taskStateLabel(task){
  if(task.status==='blocked') return 'Queued handoff';
  if(task.status==='waiting_external') return 'Awaiting external response';
  if(task.status==='in_progress') return 'In progress';
  return 'Ready for action';
}

function openIncidentTask(incident){
  if(!incident) return;
  ensureIncidentWorkflow(incident);
  const task=incidentWorkflowProgress(incident).current;
  if(task) openTask(task.id);
}
function openTask(taskId){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  if(!task) return;
  focusedTaskId=task.id;
  selectedFlightId=task.flightId; selectedAircraftId=task.aircraftId;
  contextMode='context'; lastContextSignature=''; lastDeskStackSignature='';
  renderContext(true); refreshDepartmentWidgets(true); refreshOccWidgets(true); refreshFleetList(true); refreshScheduleTimeline(true); updateMapData();
  requestAnimationFrame(()=>{
    const card=document.querySelector(`[data-inline-task="${CSS.escape(task.id)}"]`);
    card?.scrollIntoView({behavior:'smooth',block:'center'});
    card?.classList.add('attention-pulse');
  });
}

function taskActions(task,incident){
  if(['in_progress','waiting_external'].includes(task.status)){
    const progress=OperationalWorkflows.progress(task,simNow());
    const remaining=Math.max(0,Math.ceil(((task.completesAt||simNow())-simNow())/MIN));
    return `<div class="task-waiting"><b>${task.status==='waiting_external'?'Request sent':'Work underway'}</b><span>${esc(task.pendingOutcome||task.detail)} · <em data-inline-task-remaining>${remaining} min remaining</em></span><div class="progress-track"><span data-inline-task-progress style="width:${formatPct(progress)}"></span></div></div>`;
  }
  if(task.kind==='crew_allocation'){
    const options=crewPoolOptions(incident);
    return options.length?`<div class="task-form"><label>Qualified personnel pool<select data-task-crew-pool>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="allocate">Allocate crew</button></div>`:'<div class="attention-summary critical"><b>No qualified crew available</b><span>Request or position qualified personnel through Crew Control.</span></div>';
  }
  if(task.kind==='maintenance_disposition') return `<div class="choice-list"><button class="choice-button" type="button" data-task-action="defer"><b>Defer under MEL</b><br>Document restrictions and continue if permitted.</button><button class="choice-button" type="button" data-task-action="repair"><b>Repair aircraft</b><br>Ground the aircraft while engineering completes the repair.</button></div>`;
  if(task.kind==='atc_coordination') return `<div class="choice-list"><button class="choice-button" type="button" data-task-action="accept">Accept assigned CTOT · 45 min</button><button class="choice-button" type="button" data-task-action="priority">Request earlier opportunity from ATC</button></div>`;
  if(task.kind==='stand_request') return `<div class="choice-list"><button class="choice-button" type="button" data-task-action="remote">Request remote stand</button><button class="choice-button" type="button" data-task-action="tow">Request tow to another gate</button><button class="choice-button" type="button" data-task-action="wait_gate">Hold for planned gate</button></div>`;
  if(task.kind==='alternate_selection'){
    const options=diversionOptionsForIncident(incident);
    return options.length?`<div class="task-form"><label>Operational alternate<select data-task-alternate>${options.map(option=>`<option value="${option.code}">${option.code} · ${Math.round(option.destinationKm)} km from destination · ${option.weather.level}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="alternate">Select alternate</button></div>`:'<div class="attention-summary critical"><b>No suitable alternate available</b></div>';
  }
  const labels={maintenance_inspection:'Start engineering inspection',flightdeck_recommendation:'Send recommendation',diversion_clearance:'Submit ATC request',alternate_handling:'Request handling',dispatch_release:'Issue release',station_coordination:'Confirm coordination'};
  return `<button class="primary-button" type="button" data-task-action="complete">${esc(labels[task.kind]||'Complete task')}</button>`;
}

const DESK_DEFINITIONS={
  dispatch:'Dispatch & Flight Planning',crew:'Crew Control',fleet:'Fleet & Rotations',
  maintenance:'Maintenance Control',network:'Network & Stations',weather:'Weather'
};

function deskTasks(desk){
  const departments=desk==='network'?['station']:['fleet','weather'].includes(desk)?[]:[desk];
  return actionableTasks().filter(task=>departments.includes(task.department));
}
function deskSignals(){
  const now=simNow(),next24=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)>now&&flightActualDeparture(f)<=now+24*HOUR);
  const maintenance=state.aircraft.filter(ac=>aircraftIsDefective(ac)||ac.melItems?.some(item=>item.status==='open')||Management.maintenanceStatus(ac,now).due);
  const fleet=state.aircraft.filter(ac=>{
    if(aircraftActiveFlight(ac.id,now)) return false;
    const next=aircraftUpcomingFlight(ac.id,now);
    return Boolean(next&&ac.location!==next.from);
  });
  const network=next24.filter(f=>f.slotMissed||f.staffingBlocked||f.airportDelayMin||f.airspaceDelayMin);
  const usedAirports=[...new Set(next24.flatMap(f=>[f.from,flightOperationalDestination(f)]))];
  const weather=usedAirports.map(code=>Management.weatherAt(code,now)).filter(item=>item.level!=='normal');
  const uncovered=next24.filter(f=>f.staffingBlocked||openIncidentsForFlight(f.id).some(item=>item.type==='crew_sick'));
  return {now,next24,maintenance,fleet,network,weather,uncovered};
}
function inlineTaskMarkup(task){
  const incident=state.incidents.find(item=>item.id===task.incidentId&&item.status==='open');
  if(!incident) return '';
  const required=incidentTasks(incident.id).filter(item=>item.required);
  const completed=required.filter(item=>item.status==='completed').length;
  if(task.status==='blocked'){
    const dependencies=task.dependsOn.map(id=>state.coordinationTasks.find(item=>item.id===id)?.label).filter(Boolean);
    return `<article class="inline-task queued" data-inline-task="${esc(task.id)}"><div class="inline-task-heading"><div><span>${esc(task.flightId)} · queued handoff</span><b>${esc(task.label)}</b></div><em>Waiting</em></div><p>After: ${esc(dependencies.join(' · ')||'earlier coordination')}</p></article>`;
  }
  return `<article class="inline-task ${focusedTaskId===task.id?'focused':''}" data-inline-task="${esc(task.id)}">
    <div class="inline-task-heading"><div><span>${esc(task.flightId)} · ${esc(incidentCopy(incident).title)}</span><b>${esc(task.label)}</b></div><em>${esc(taskStateLabel(task))}</em></div>
    <p>${esc(task.detail)}</p>
    <div class="inline-case-progress"><span>Case ${completed}/${required.length}</span><div class="progress-track"><span style="width:${formatPct(required.length?completed/required.length:0)}"></span></div></div>
    <div class="inline-task-action">${taskActions(task,incident)}</div>
  </article>`;
}

function inlineTaskListMarkup(tasks){
  return tasks.length?`<section class="desk-section task-queue"><h2>Current work · ${tasks.length}</h2>${tasks.map(inlineTaskMarkup).join('')}</section>`:'';
}

function occWidgetMarkup(key,title,count,status,content,tools=''){
  return `<section class="occ-board-widget ${count?'has-work':''}" id="occ-desk-${key}" data-desk-widget="${key}">
    <header class="occ-widget-header"><div><span>OCC department</span><h1>${esc(title)}</h1></div><div class="occ-widget-state">${tools}<b>${count}</b><span>${esc(status)}</span></div></header>
    <div class="occ-widget-body">${content}</div>
  </section>`;
}

function mountOccManagementPages(root){
  const hosts={planning:'planning',personnel:'personnel',relocation:'relocation',aircraft:'aircraft',maintenance:'maintenance',slots:'slots'};
  for(const [pageName,hostName] of Object.entries(hosts)){
    const page=embeddedManagementPages.get(pageName)?.element;
    const host=root.querySelector(`[data-occ-page-host="${hostName}"]`);
    if(!page||!host) continue;
    page.hidden=false;
    page.classList.add('active');
    host.appendChild(page);
  }
}

function bindInlineTaskActions(root){
  root.querySelectorAll('[data-task-action]').forEach(button=>button.addEventListener('click',()=>{
    const card=button.closest('[data-inline-task]');
    const task=card&&state.coordinationTasks.find(item=>item.id===card.dataset.inlineTask);
    if(!task) return;
    const action=button.dataset.taskAction;
    let actionId=action,payload={};
    if(action==='allocate'){actionId='';payload.optionId=card.querySelector('[data-task-crew-pool]')?.value;}
    if(action==='alternate'){actionId='';payload.airport=card.querySelector('[data-task-alternate]')?.value;}
    if(action==='complete') actionId='';
    focusedTaskId=task.id;
    performOperationalTask(task.id,actionId,payload);
  }));
}

function departmentStatus(tasks,clearLabel){
  if(tasks.some(task=>task.status==='available')) return 'Action required';
  if(tasks.some(task=>['in_progress','waiting_external'].includes(task.status))) return 'Coordination underway';
  if(tasks.length) return 'Queued handoff';
  return clearLabel;
}

function renderDeskStack(force=false){
  const root=document.getElementById('deskStack');
  if(!root) return;
  const signals=deskSignals();
  const tasks=Object.fromEntries(Object.keys(DESK_DEFINITIONS).map(key=>[key,deskTasks(key)]));
  const signature=[
    state.flights.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.staffingBlocked?1:0}:${f.slotMissed?1:0}:${f.fueled?1:0}:${attentionForFlight(f)?.label||''}`).join('|'),
    state.aircraft.map(ac=>`${ac.id}:${ac.location}:${attentionForAircraft(ac)}:${Math.round(ac.condition??100)}`).join('|'),
    Object.values(tasks).flat().map(t=>`${t.id}:${t.status}:${t.completesAt}`).join('|'),
    signals.weather.map(w=>`${w.airport}:${w.level}`).join('|'),state.slotRights.length,
    JSON.stringify(state.personnel.assignments||{}),(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}`).join('|')
  ].join('::');
  if(!force&&signature===lastDeskStackSignature) return;
  if(!force&&root.contains(document.activeElement)) return;
  lastDeskStackSignature=signature;
  restoreEmbeddedManagementPages();
  root.innerHTML=`<header class="occ-board-header"><div><span>Live workspace</span><b>OCC control board</b></div><em>All current information · scroll to review</em></header>
    ${occWidgetMarkup('dispatch','Dispatch & flight planning',tasks.dispatch.length,departmentStatus(tasks.dispatch,'Flight watch normal'),`${inlineTaskListMarkup(tasks.dispatch)}${dispatchBoardMarkup()}<div class="occ-management-host" data-occ-page-host="planning"></div>`,`<button class="small-button" type="button" data-training-incident>Training scenario</button>`)}
    ${occWidgetMarkup('crew','Crew control',Math.max(tasks.crew.length,signals.uncovered.length),departmentStatus(tasks.crew,'Duties covered'),`${inlineTaskListMarkup(tasks.crew)}${crewDutyBoardMarkup()}<div class="occ-management-host" data-occ-page-host="personnel"></div><div class="occ-management-host" data-occ-page-host="relocation"></div>`)}
    ${occWidgetMarkup('fleet','Fleet & rotations',Math.max(tasks.fleet.length,signals.fleet.length),departmentStatus(tasks.fleet,signals.fleet.length?`${signals.fleet.length} rotation restriction${signals.fleet.length===1?'':'s'}`:'Rotations stable'),`${inlineTaskListMarkup(tasks.fleet)}${fleetRotationsMarkup()}${fleetRecoveryMarkup()}<div class="occ-management-host" data-occ-page-host="aircraft"></div>`)}
    ${occWidgetMarkup('maintenance','Maintenance control',Math.max(tasks.maintenance.length,signals.maintenance.length),departmentStatus(tasks.maintenance,signals.maintenance.length?'Review required':'Fleet serviceable'),`${inlineTaskListMarkup(tasks.maintenance)}<div class="occ-management-host" data-occ-page-host="maintenance"></div>`)}
    ${occWidgetMarkup('network','Network & stations',Math.max(tasks.network.length,signals.network.length),departmentStatus(tasks.network,signals.network.length?`${signals.network.length} network constraint${signals.network.length===1?'':'s'}`:'Stations ready'),`${inlineTaskListMarkup(tasks.network)}${stationPlanMarkup()}<div class="occ-management-host" data-occ-page-host="slots"></div>`)}
    ${occWidgetMarkup('weather','Weather',signals.weather.length,signals.weather.length?`${signals.weather.length} airport warning${signals.weather.length===1?'':'s'}`:'Normal outlook',weatherMarkup(false))}`;
  mountOccManagementPages(root);
  root.querySelector('[data-training-incident]')?.addEventListener('click',generateTrainingIncident);
  root.querySelectorAll('[data-workbench-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.workbenchFlight)));
  root.querySelector('[data-desk-sub-rotation]')?.addEventListener('click',button=>substituteSelectedRotation(button.dataset.deskSubRotation,document.getElementById('deskReplacementAircraft').value));
  root.querySelector('[data-desk-change-service]')?.addEventListener('click',button=>{const flight=state.flights.find(item=>item.id===button.dataset.deskChangeService),service=flight&&state.services.find(item=>item.id===flight.serviceId);if(service)changeServiceAircraft(service.id,document.getElementById('deskReplacementAircraft').value);});
  bindInlineTaskActions(root);
  refreshManagement(true);
}

function openDesk(desk){
  document.getElementById(`occ-desk-${desk}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeDesk(){}
function dispatchBoardMarkup(){
  const now=simNow();
  const flights=state.flights.filter(f=>!f.cancelled&&flightActualArrival(f)>now&&flightActualDeparture(f)<now+24*HOUR).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  return `<section class="desk-section"><h2>Flight watch and release readiness · 24 hours</h2>${flights.length?flights.map(f=>{
    const issue=attentionForFlight(f),duty=crewDutyForFlight(f),constraints=networkConstraintsForFlight(f),aircraft=state.aircraft.find(item=>item.id===f.aircraftId),alternate=aircraft?nearestDiversionAirport(f,aircraft):'';
    const slot=f.slotMissed?`New ${f.assignedSlot?shortClock(f.assignedSlot):'pending'}`:'Planned';
    const fuel=f.fueled?'Fuel ready':flightActualDeparture(f)<=now?'Airborne':'Fuel pending';
    return `<button class="occ-flight-row" type="button" data-workbench-flight="${esc(f.id)}"><span class="occ-flight-main"><b>${esc(f.id)} · ${esc(f.from)} → ${esc(flightOperationalDestination(f))}</b><em>${shortDay(flightActualDeparture(f))} ${shortClock(flightActualDeparture(f))} · ${esc(statusOfFlight(f))}</em></span><span class="occ-flight-readiness"><i>Crew ${duty.legal&&!f.staffingBlocked?'legal':'blocked'}</i><i>${esc(fuel)}</i><i>Slot ${esc(slot)}</i></span><span class="occ-flight-route">Alternate ${esc(alternate||'none')} · airport ${esc(constraints.airport.label)} · airspace ${esc(constraints.airspace.label)}</span><strong>${esc(issue?.label||'Ready')}</strong></button>`;
  }).join(''):'<div class="empty-state">No active or planned flights in the next 24 hours.</div>'}</section>`;
}
function crewDutyBoardMarkup(){
  const flights=state.flights.filter(f=>!f.cancelled&&flightActualArrival(f)>simNow()&&flightActualDeparture(f)<simNow()+36*HOUR).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  return `<section class="desk-section"><h2>Upcoming duties</h2>${flights.map(f=>{const duty=crewDutyForFlight(f),issue=openIncidentsForFlight(f.id).find(i=>i.type==='crew_sick');return `<div class="desk-list-row"><div><b>${esc(f.id)} · ${esc(f.from)} → ${esc(flightOperationalDestination(f))}</b><span>${duty.sectors||1} sector${(duty.sectors||1)===1?'':'s'} · ${Number(duty.dutyHours||0).toFixed(1)} / ${Number(duty.maxHours||0).toFixed(1)} h${rotationUsesThroughCrew(f)?' · through crew':''}</span></div><em>${issue?'Crew required':duty.legal?'Legal':'Limit exceeded'}</em></div>`;}).join('')||'<div class="empty-state">No duties planned.</div>'}</section>`;
}
function fleetRotationsMarkup(){
  const horizon=simNow()+24*HOUR;
  return `<section class="desk-section"><h2>Complete aircraft rotations · 24 hours</h2>${state.aircraft.map(ac=>{const active=aircraftActiveFlight(ac.id),next=state.flights.filter(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualDeparture(f)>simNow()&&flightActualDeparture(f)<=horizon).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));return `<div class="desk-list-row"><div><b>${esc(ac.tail)} · ${esc(ac.model)}</b><span>${active?`${active.id} ${active.from}→${flightOperationalDestination(active)} · `:''}${next.length?next.map(f=>`${f.id} ${shortClock(flightActualDeparture(f))} ${f.from}→${flightOperationalDestination(f)}`).join(' · '):'No further rotation in horizon'}</span></div><em>${esc(attentionForAircraft(ac)||ac.location)}</em></div>`;}).join('')||'<div class="empty-state">No aircraft assigned.</div>'}</section>`;
}
function fleetRecoveryMarkup(){
  const candidates=state.flights.filter(f=>f.serviceId&&!f.cancelled&&flightActualDeparture(f)>simNow()).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const flight=candidates.find(f=>f.id===selectedFlightId)||candidates[0];
  if(!flight) return '<section class="desk-section"><h2>Aircraft recovery</h2><div class="empty-state">No future recurring rotation is available for substitution. Use Ferry flight to reposition an aircraft.</div></section>';
  const replacements=rotationReplacementCandidates(flight);
  return `<section class="desk-section"><h2>Aircraft recovery</h2><div class="simple-row"><span>Selected rotation</span><b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flight.to)} · ${shortDay(flightActualDeparture(flight))} ${shortClock(flightActualDeparture(flight))}</b></div>${replacements.length?`<div class="task-form"><label>Available replacement<select id="deskReplacementAircraft">${replacements.map(ac=>`<option value="${esc(ac.id)}">${esc(ac.tail)} · ${esc(ac.model)} · ${esc(ac.location)}</option>`).join('')}</select></label><div class="occ-desk-actions"><button class="primary-button" type="button" data-desk-sub-rotation="${esc(flight.id)}">Sub this round trip</button><button class="secondary-button" type="button" data-desk-change-service="${esc(flight.id)}">Change future schedule</button></div></div>`:`<div class="attention-summary warning"><b>No suitable spare aircraft</b><span>A replacement must be at ${esc(flight.from)}, have sufficient range, and be free for the complete rotation.</span></div>`}</section>`;
}
function stationPlanMarkup(){
  const flights=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)>simNow()&&flightActualDeparture(f)<simNow()+24*HOUR);
  const codes=Object.keys(AIRPORTS).filter(code=>flights.some(f=>f.from===code||flightOperationalDestination(f)===code)||state.slotRights.some(right=>right.airport===code)||Object.values(state.personnel.assignments?.[code]||{}).some(Boolean));
  return `<section class="desk-section"><h2>Airport operating plan · complete network</h2>${codes.map(code=>{const departures=flights.filter(f=>f.from===code),arrivals=flights.filter(f=>flightOperationalDestination(f)===code),weather=Management.weatherAt(code,simNow());return `<div class="desk-list-row"><div><b>${esc(code)} · ${esc(AIRPORTS[code].name)}</b><span>${departures.length} departures · ${arrivals.length} arrivals · ${state.slotRights.filter(r=>r.airport===code).length} slot series</span><span>${staffAt(code,'captains')} captains · ${staffAt(code,'firstOfficers')} first officers · ${staffAt(code,'cabinCrew')} cabin · ${staffAt(code,'groundHandling')} handling · ${staffAt(code,'operations')} operations</span></div><em>${weather.label} · ${Math.round(weather.capacityFactor*100)}%</em></div>`;}).join('')||'<div class="empty-state">No active stations.</div>'}</section>`;
}
function weatherMarkup(outlook=false){
  const now=simNow(),flights=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)<now+24*HOUR&&flightActualArrival(f)>now),codes=[...new Set(flights.length?flights.flatMap(f=>[f.from,flightOperationalDestination(f)]):[state.home])];
  return `<section class="desk-section"><h2>${outlook?'Airport outlook':'Operational weather briefing'}</h2>${codes.map(code=>{const weather=Management.weatherAt(code,now);return `<div class="desk-list-row"><div><b>${esc(code)} · ${esc(weather.label)}</b><span>${esc(weather.conditions)} · wind ${weather.windKph} km/h · expected delay ${weather.delayMin} min</span></div><em>Capacity ${Math.round(weather.capacityFactor*100)}%</em></div>`;}).join('')}</section>`;
}

function renderSelectionContext(expanded=false){
  const pane=document.getElementById('contextPane');
  pane.classList.toggle('context-compact',!expanded);
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  if(flight){pane.hidden=false;return expanded?renderFlightContext(flight):renderFlightSummary(flight);}
  const aircraft=selectedAircraftId&&state.aircraft.find(item=>item.id===selectedAircraftId);
  if(aircraft){pane.hidden=false;return expanded?renderAircraftContext(aircraft):renderAircraftSummary(aircraft);}
  pane.hidden=true;
  pane.innerHTML='';
}

function renderContext(force=false){
  const signature=`${contextMode}:${selectedFlightId||''}:${selectedAircraftId||''}:${(state.coordinationTasks||[]).map(t=>`${t.id}:${t.status}:${t.completesAt}`).join('|')}`;
  if(!force&&signature===lastContextSignature) return;
  lastContextSignature=signature;
  renderSelectionContext(contextMode==='details');
}

function refreshFlightDetails(force=false){ renderContext(force); }
function refreshAircraftDetails(force=false){ renderContext(force); }
function refreshGroundTaskProgress(){
  const now=simNow();
  if(contextMode==='details'){
    let operation=null;
    const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
    if(flight){
      const ground=groundOperationsForFlight(flight,now);
      operation=flightActualArrival(flight)<=now?{flight,phase:ground?.postflight}:flightActualDeparture(flight)>now?{flight,phase:ground?.departure}:null;
    }else{
      const aircraft=selectedAircraftId&&state.aircraft.find(item=>item.id===selectedAircraftId);
      if(aircraft) operation=aircraftGroundOperation(aircraft,now);
    }
    const root=document.querySelector('#contextPane .ground-overview');
    if(root&&operation?.phase&&root.dataset.groundPhase===operation.phase.key){
      root.querySelector('[data-ground-phase-progress]')?.style.setProperty('width',formatPct(operation.phase.progress));
      const percent=root.querySelector('.ground-percent'); if(percent) percent.textContent=formatPct(operation.phase.progress);
      for(const task of operation.phase.tasks||[]){
        const row=root.querySelector(`[data-ground-task="${CSS.escape(task.id)}"]`); if(!row) continue;
        row.classList.toggle('complete',task.status==='complete');
        row.querySelector('.progress-track span')?.style.setProperty('width',formatPct(task.progress));
        const status=row.querySelector('em'); if(status) status.textContent=task.status==='complete'?'Complete':task.status==='active'?'In progress':'Planned';
      }
    }
  }
  document.querySelectorAll('[data-inline-task]').forEach(card=>{
    const task=state.coordinationTasks.find(item=>item.id===card.dataset.inlineTask);
    if(!task||!['in_progress','waiting_external'].includes(task.status)) return;
    card.querySelector('[data-inline-task-progress]')?.style.setProperty('width',formatPct(OperationalWorkflows.progress(task,now)));
    const remaining=card.querySelector('[data-inline-task-remaining]');
    if(remaining) remaining.textContent=`${Math.max(0,Math.ceil(((task.completesAt||now)-now)/MIN))} min remaining`;
  });
}

function refreshDepartmentWidgets(force=false){
  renderDeskStack(force);
}

function refreshHeader(){
  const now=simNow();
  const active=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)<=now&&now<flightActualArrival(f));
  const upcoming=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)>now&&flightActualDeparture(f)<=now+24*HOUR);
  const completed=state.flights.filter(f=>f.settled&&!f.cancelled).slice(-50);
  const onTime=completed.length?Math.round(completed.filter(f=>flightTotalDepartureDelayMin(f)<=15).length/completed.length*100):100;
  document.getElementById('simClock').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(now));
  document.getElementById('headerActive').textContent=active.length;
  document.getElementById('headerUpcoming').textContent=upcoming.length;
  document.getElementById('headerOnTime').textContent=`${onTime}%`;
}
function refreshKPIs(){ refreshHeader(); }

function scheduleWindow(){
  const now=simNow(),anchor=new Date(now); anchor.setMinutes(0,0,0);
  const start=anchor.getTime()+scheduleWindowOffsetHours*HOUR;
  return {start,end:start+scheduleRangeHours*HOUR,now};
}
function alignScheduleWindowToFlight(flight){
  if(!flight) return;
  const {start,end}=scheduleWindow(),departure=flightActualDeparture(flight),arrival=flightActualArrival(flight);
  if(arrival>start&&departure<end) return;
  const anchor=new Date(simNow()); anchor.setMinutes(0,0,0);
  scheduleWindowOffsetHours=Math.floor((departure-anchor.getTime())/HOUR)-2;
}
function scrollSelectedScheduleFlightIntoView(){
  const block=document.querySelector('#schedule-board .flight-block.selected'),scroll=document.getElementById('schedule-scroll'),row=block?.closest('.sched-aircraft-row');
  if(!block||!scroll||!row) return;
  scroll.scrollTo({left:Math.max(0,block.offsetLeft+122-scroll.clientWidth/2+block.offsetWidth/2),top:Math.max(0,row.offsetTop-scroll.clientHeight/2+row.offsetHeight/2),behavior:'smooth'});
}
function refreshScheduleTimeline(force=false){
  const board=document.getElementById('schedule-board'); if(!board) return;
  const {start,end,now}=scheduleWindow(),pxPerHour=scheduleRangeHours===24?84:48,timeWidth=Math.round(scheduleRangeHours*pxPerHour),labelWidth=122;
  const relevant=state.flights.filter(f=>flightActualArrival(f)>start&&flightActualDeparture(f)<end).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const signature=[Math.floor(start/MIN),scheduleRangeHours,selectedFlightId||'',selectedAircraftId||'',relevant.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.aircraftId}:${f.slotMissed?1:0}:${f.assignedSlot||0}:${f.cancelled?1:0}`).join(','),state.aircraft.map(a=>a.id).join(',')].join('|');
  if(force||signature!==lastScheduleSignature){
    lastScheduleSignature=signature;
    let html='<div class="sched-header-row"><div class="sched-label"><b>Aircraft</b></div><div class="sched-timearea" style="width:'+timeWidth+'px">';
    for(let h=0;h<=scheduleRangeHours;h++){
      const ts=start+h*HOUR,left=h*pxPerHour,major=new Date(ts).getHours()%6===0;
      html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      if(h<scheduleRangeHours&&(scheduleRangeHours===24||h%2===0)) html+=`<span class="sched-time-label" style="left:${left}px">${shortClock(ts)}</span>`;
    }
    html+='<div id="scheduleNowHeader" class="now-label" style="display:none">NOW</div></div></div>';
    for(const ac of state.aircraft){
      const flights=relevant.filter(f=>f.aircraftId===ac.id).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
      html+=`<div class="sched-aircraft-row ${flights.some(f=>f.id===selectedFlightId)?'selected-row':''}" data-sched-aircraft="${esc(ac.id)}"><div class="sched-label"><div class="sched-tail">${esc(ac.tail)}</div><div class="sched-model">${esc(ac.model)}</div></div><div class="sched-timearea" style="width:${timeWidth}px">`;
      for(let h=0;h<=scheduleRangeHours;h++) html+=`<span class="sched-gridline ${new Date(start+h*HOUR).getHours()%6===0?'major':''}" style="left:${h*pxPerHour}px"></span>`;
      for(let i=0;i<flights.length;i++){
        const f=flights[i],actualDep=flightActualDeparture(f),actualArr=flightActualArrival(f),clippedStart=Math.max(start,actualDep),clippedEnd=Math.min(end,actualArr);
        const left=(clippedStart-start)/HOUR*pxPerHour,width=Math.max(6,(clippedEnd-clippedStart)/HOUR*pxPerHour),st=statusOfFlight(f,now),delay=flightTotalDepartureDelayMin(f),destination=flightOperationalDestination(f);
        if(f.departure>=start&&f.departure<=end){
          const markerLeft=(f.departure-start)/HOUR*pxPerHour;
          html+=`<span class="slot-marker planned ${f.slotMissed?'missed':''}" data-slot-flight="${esc(f.id)}" style="left:${markerLeft}px"><span class="slot-label">${f.slotMissed?'MISSED':'SLOT'}</span></span>`;
        }
        if(f.slotMissed&&f.assignedSlot>=start&&f.assignedSlot<=end) html+=`<span class="slot-marker reassigned" data-slot-flight="${esc(f.id)}" style="left:${(f.assignedSlot-start)/HOUR*pxPerHour}px"><span class="slot-label">NEW ${shortClock(f.assignedSlot)}</span></span>`;
        if(delay>0||actualArr!==f.arrival){
          const plannedStart=Math.max(start,f.departure),plannedEnd=Math.min(end,f.arrival);
          if(plannedEnd>plannedStart) html+=`<div class="planned-flight-block" style="left:${(plannedStart-start)/HOUR*pxPerHour}px;width:${Math.max(6,(plannedEnd-plannedStart)/HOUR*pxPerHour)}px"></div>`;
        }
        html+=`<div class="flight-block ${st} ${selectedFlightId===f.id?'selected':''}" data-flight-id="${esc(f.id)}" style="left:${left}px;width:${width}px"><div class="flight-code">${esc(f.id)}${delay?` <span class="delay-text">+${delay}</span>`:''}</div><div class="flight-route">${esc(f.from)} → ${esc(destination)}</div><div class="flight-times">${delay?`<span class="sched">S ${shortClock(f.departure)}</span> · <span class="actual">A ${shortClock(actualDep)}</span>`:`${shortClock(actualDep)}–${shortClock(actualArr)}`}</div></div>`;
        const next=flights[i+1];
        if(next&&flightActualDeparture(next)>actualArr){
          const gapStart=Math.max(start,actualArr),gapEnd=Math.min(end,flightActualDeparture(next));
          if(gapEnd>gapStart){
            const connLeft=(gapStart-start)/HOUR*pxPerHour,connWidth=Math.max(3,(gapEnd-gapStart)/HOUR*pxPerHour),same=destination===next.from;
            html+=`<span class="connection-line ${same?'':'mismatch'}" style="left:${connLeft}px;width:${connWidth}px"></span>`;
          }
        }
      }
      html+='<div class="now-line schedule-now-row" style="display:none"></div></div></div>';
    }
    if(!state.aircraft.length) html+='<div class="schedule-empty">No aircraft in fleet.</div>';
    board.innerHTML=html; board.style.width=(labelWidth+timeWidth)+'px';
    board.querySelectorAll('[data-flight-id]').forEach(element=>element.addEventListener('click',()=>{contextMode='context';settleSelectedFlight(element.dataset.flightId);}));
    board.querySelectorAll('[data-slot-flight]').forEach(element=>element.addEventListener('click',event=>{event.stopPropagation();contextMode='context';settleSelectedFlight(element.dataset.slotFlight);}));
    board.querySelectorAll('[data-sched-aircraft]').forEach(row=>row.addEventListener('dblclick',()=>{contextMode='context';settleSelected(row.dataset.schedAircraft);}));
    if(selectedFlightId) requestAnimationFrame(scrollSelectedScheduleFlightIntoView);
  }
  updateScheduleNowLine();
  document.getElementById('schedule-window-label').textContent=`${shortDay(start)} ${shortClock(start)}  →  ${shortDay(end)} ${shortClock(end)}`;
}
function updateScheduleNowLine(){
  const {start,end,now}=scheduleWindow(),x=(now-start)/HOUR*(scheduleRangeHours===24?84:48),visible=now>=start&&now<=end;
  const header=document.getElementById('scheduleNowHeader'); if(header){header.style.display=visible?'block':'none';header.style.left=x+'px';}
  document.querySelectorAll('.schedule-now-row').forEach(line=>{line.style.display=visible?'block':'none';line.style.left=x+'px';});
}
function centerScheduleOnNow(){ scheduleWindowOffsetHours=-2;lastScheduleSignature='';refreshScheduleTimeline(true);document.getElementById('schedule-scroll').scrollLeft=0; }

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring',ferry=scheduleTypeEl.value==='ferry';
  document.getElementById('repeatRuleWrap').hidden=!recurring;
  document.getElementById('turnaroundWrap').hidden=!recurring;
  if(ferry){ const ac=state.aircraft.find(item=>item.id===aircraftEl.value); if(ac) originEl.value=ac.location; }
  refreshSchedulePreview();
}
function refreshSchedulePreview(){
  const ac=state.aircraft.find(item=>item.id===aircraftEl.value),from=originEl.value,to=destEl.value,departure=nextTimestampForClock(departureTimeEl.value);
  if(!ac||!departure||from===to){document.getElementById('schedulePreview').textContent='Choose an aircraft, two airports, and a departure time.';requestSlotsBtn.hidden=true;return;}
  const ferry=scheduleTypeEl.value==='ferry',estimate=ferry?estimateFerryFlight(from,to,ac,departure):estimateFlight(from,to,ac,currentScheduleFares(),{departure});
  let message=`${Math.round(estimate.km)} km · ${formatDuration(estimate.duration)} block time · ${estimate.rangeOk?'within range':'outside aircraft range'}`;
  if(!ferry) message+=` · projected ${estimate.pax||0} passengers`;
  if(scheduleTypeEl.value==='recurring'){
    const plan=requiredSlotPlan(from,to,ac,currentScheduleFares(),departure,Number(turnaroundEl.value)||90),missing=[];
    if(!plan.originRight) missing.push(`${from} ${shortClock(plan.outboundDeparture)}`);
    if(!plan.destinationRight) missing.push(`${to} ${shortClock(plan.returnDeparture)}`);
    message+=missing.length?` · slot series needed: ${missing.join(', ')}`:' · both slot series owned';
    requestSlotsBtn.hidden=!missing.length;
  }else requestSlotsBtn.hidden=true;
  document.getElementById('schedulePreview').innerHTML=`<b>${esc(ac.tail)} · ${esc(from)} → ${esc(to)}</b><br>${esc(message)}`;
}
function requestRequiredScheduleSlots(){
  const ac=state.aircraft.find(item=>item.id===aircraftEl.value),departure=nextTimestampForClock(departureTimeEl.value); if(!ac||!departure) return;
  const plan=requiredSlotPlan(originEl.value,destEl.value,ac,currentScheduleFares(),departure,Number(turnaroundEl.value)||90);
  if(!plan.originRight) requestSlotRight(originEl.value,plan.outboundDeparture);
  if(!plan.destinationRight) requestSlotRight(destEl.value,plan.returnDeparture);
  refreshAll(); refreshSchedulePreview();
}

function optionList(values,label){ return values.map(value=>`<option value="${esc(value)}">${esc(label(value))}</option>`).join(''); }
function populateManagementControls(){
  const airports=Object.keys(AIRPORTS);
  [originEl,destEl,document.getElementById('slotAirport'),document.getElementById('personnelAirport'),document.getElementById('transferPersonnelFrom'),document.getElementById('transferPersonnelTo')].forEach(select=>{
    select.innerHTML=optionList(airports,code=>`${code} — ${AIRPORTS[code].name}`);
  });
  originEl.value=state.home; destEl.value=airports.find(code=>code!==state.home)||airports[0];
  document.getElementById('slotAirport').value=state.home;
  document.getElementById('personnelAirport').value=state.home;
  document.getElementById('transferPersonnelFrom').value=state.home;
  document.getElementById('transferPersonnelTo').value=airports.find(code=>code!==state.home)||airports[0];
  const roles=Object.keys(PERSONNEL);
  [document.getElementById('personnelRole'),document.getElementById('transferPersonnelRole')].forEach(select=>select.innerHTML=optionList(roles,role=>PERSONNEL[role].label));
  const families=[...new Set(['Multi-fleet',...Object.keys(MODELS).map(model=>Management.aircraftFamily(model))])];
  document.getElementById('personnelQualification').innerHTML=optionList(families,value=>value);
  const modelSelect=document.getElementById('managementAircraftModel');
  modelSelect.innerHTML=optionList(Object.keys(MODELS),model=>`${model} · ${MODELS[model].seats} eq. seats`);
  const d=new Date(simNow()+15*MIN); d.setSeconds(0,0); d.setMinutes(Math.ceil(d.getMinutes()/5)*5); departureTimeEl.value=hhmm(d.getTime());
}

function refreshAircraftSelect(force=false){
  const signature=state.aircraft.map(ac=>`${ac.id}:${ac.location}:${ac.tail}`).join('|');
  if(!force&&signature===aircraftSelectSignature) return;
  if(document.activeElement===aircraftEl) return;
  aircraftSelectSignature=signature;
  const previous=aircraftEl.value;
  aircraftEl.innerHTML=state.aircraft.length?state.aircraft.map(ac=>`<option value="${esc(ac.id)}">${esc(ac.tail)} · ${esc(ac.model)} · ${esc(ac.location)}</option>`).join(''):'<option value="">No aircraft assigned</option>';
  if(state.aircraft.some(ac=>ac.id===previous)) aircraftEl.value=previous;
  else if(selectedAircraftId&&state.aircraft.some(ac=>ac.id===selectedAircraftId)) aircraftEl.value=selectedAircraftId;
  refreshScheduleMode();
}

function aircraftCabinRequest(){
  const modelName=document.getElementById('managementAircraftModel').value,model=MODELS[modelName]; if(!model) return null;
  let first=clamp(Math.floor(Number(document.getElementById('managementCabinFirst').value)||0),0,Math.floor(model.seats/3));
  let business=clamp(Math.floor(Number(document.getElementById('managementCabinBusiness').value)||0),0,Math.floor((model.seats-first*3)/2));
  document.getElementById('managementCabinFirst').value=first; document.getElementById('managementCabinBusiness').value=business;
  return {modelName,model,cabin:{economy:model.seats-first*3-business*2,business,first}};
}
function refreshAircraftRequestPreview(){
  const request=aircraftCabinRequest(); if(!request) return;
  const supply=resourceAvailability('aircraft',request.modelName,state.home);
  document.getElementById('aircraftRequestPreview').innerHTML=`<b>${esc(request.modelName)} · ${request.cabin.economy+request.cabin.business+request.cabin.first} passenger seats</b><br>${request.cabin.economy} economy · ${request.cabin.business} business · ${request.cabin.first} first · ${request.model.maxRangeKm.toLocaleString()} km range · ${supply.available?'available now':`allocation lead about ${supply.leadMin} min`}`;
}
function renderManagementAircraft(){
  const list=document.getElementById('managementAircraftList');
  list.innerHTML=state.aircraft.length?state.aircraft.map(ac=>{
    const assigned=aircraftHasAssignments(ac.id),status=attentionForAircraft(ac)||'Serviceable';
    return `<div class="data-row"><div><b>${esc(ac.tail)} · ${esc(ac.model)}</b><span>${esc(ac.location)} · condition ${Math.round(ac.condition??100)}% · ${esc(status)}</span></div><div class="data-row-actions"><button class="secondary-button" type="button" data-manage-aircraft="${esc(ac.id)}">Open</button><button class="danger-button" type="button" data-release-aircraft="${esc(ac.id)}" ${assigned?'disabled':''}>Release</button></div></div>`;
  }).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  list.querySelectorAll('[data-manage-aircraft]').forEach(button=>button.addEventListener('click',()=>{showWorkspace('operations');contextMode='context';settleSelected(button.dataset.manageAircraft);}));
  list.querySelectorAll('[data-release-aircraft]').forEach(button=>button.addEventListener('click',()=>releaseAircraft(button.dataset.releaseAircraft)));
}

function refreshPersonnelRequestPreview(){
  const role=document.getElementById('personnelRole').value,airport=document.getElementById('personnelAirport').value,amount=clamp(Math.floor(Number(document.getElementById('personnelAmount').value)||1),1,50);
  document.getElementById('personnelAmount').value=amount;
  const cockpit=['captains','firstOfficers'].includes(role),wrap=document.getElementById('personnelQualificationWrap'); wrap.hidden=!cockpit;
  const supply=resourceAvailability('personnel',role,airport);
  document.getElementById('personnelRequestPreview').innerHTML=`<b>${amount} ${esc(PERSONNEL[role]?.label||role)} at ${esc(airport)}</b><br>${cockpit?`${esc(document.getElementById('personnelQualification').value)} type rating · `:''}${supply.available>=amount?'available now':`allocation lead about ${supply.leadMin} min`}`;
}
function renderManagementPersonnel(){
  const airports=Object.keys(state.personnel.assignments||{}).filter(code=>Object.values(state.personnel.assignments[code]||{}).some(Boolean)).sort();
  document.getElementById('managementPersonnelList').innerHTML=airports.length?`<table class="data-table"><thead><tr><th>Airport</th>${Object.values(PERSONNEL).map(role=>`<th>${esc(role.label)}</th>`).join('')}</tr></thead><tbody>${airports.map(code=>`<tr><td><b>${esc(code)}</b></td>${Object.keys(PERSONNEL).map(role=>`<td>${staffAt(code,role)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">No personnel assigned.</div>';
}

function slotTimestamp(){ return nextTimestampForClock(document.getElementById('slotTime').value)||simNow()+DAY; }
function refreshSlotBuyPreview(){
  const airport=document.getElementById('slotAirport').value,aligned=alignTimestampToAirportSlot(slotTimestamp(),airport),existing=slotRightAt(airport,aligned),supply=resourceAvailability('slot',String(new Date(aligned).getHours()),airport);
  document.getElementById('slotBuyPreview').innerHTML=`<b>${esc(airport)} · ${shortClock(aligned)}</b><br>${existing?'Already in portfolio':supply.available?'Available for immediate assignment':`Coordination lead about ${supply.leadMin} min`}`;
  document.getElementById('requestSlotBtn').disabled=Boolean(existing);
}
function refreshSlotPortfolio(force=false){
  const list=document.getElementById('managementSlotList'); if(!list) return;
  list.innerHTML=state.slotRights.length?state.slotRights.slice().sort((a,b)=>a.airport.localeCompare(b.airport)||a.minuteOfDay-b.minuteOfDay).map(right=>{
    const service=slotAssignedService(right.id);
    return `<div class="data-row"><div><b>${esc(right.airport)} · ${hhmmFromMinute(right.minuteOfDay)}</b><span>${esc(right.source||'requested')} · ${service?`used by ${service.id}`:'available'}</span></div><em>${service?'In use':'Free'}</em></div>`;
  }).join(''):'<div class="empty-state">No slot series held.</div>';
}

function eligiblePersonnelFlights(from,to,amount){
  const now=simNow(); return state.flights.filter(f=>!f.cancelled&&!f.settled&&f.from===from&&f.to===to&&flightActualDeparture(f)>now).filter(f=>{
    const ac=state.aircraft.find(a=>a.id===f.aircraftId),spare=(ac?cabinSeatCount(ac):f.pax||0)-(f.pax||0)-flightPersonnelTransferCount(f.id); return spare>=amount;
  }).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
}
function refreshPersonnelTransferOptions(){
  const role=document.getElementById('transferPersonnelRole').value,from=document.getElementById('transferPersonnelFrom').value,to=document.getElementById('transferPersonnelTo').value,amount=clamp(Math.floor(Number(document.getElementById('transferPersonnelAmount').value)||1),1,50),external=document.getElementById('transferPersonnelMethod').value==='external';
  document.getElementById('transferPersonnelAmount').value=amount; document.getElementById('transferOwnFlightWrap').hidden=external;
  const flights=external?[]:eligiblePersonnelFlights(from,to,amount),select=document.getElementById('transferPersonnelFlight'),previous=select.value;
  select.innerHTML=flights.length?flights.map(f=>`<option value="${esc(f.id)}">${esc(f.id)} · ${shortDay(flightActualDeparture(f))} ${shortClock(flightActualDeparture(f))}</option>`).join(''):'<option value="">No suitable own flight</option>';
  if(flights.some(f=>f.id===previous)) select.value=previous;
  const available=staffAt(from,role),same=from===to,plan=external&&!same?externalTransferPlan(from,to,amount):null,selected=flights.find(f=>f.id===select.value);
  document.getElementById('personnelTransferPreview').textContent=same?'Choose two different airports.':available<amount?`Only ${available} available at ${from}.`:external?`External service · arrival ${formatTime(plan.arrival)}.`:selected?`Non-revenue travel on ${selected.id} · arrival ${formatTime(flightActualArrival(selected))}.`:'No own flight has enough spare seats.';
  document.getElementById('transferPersonnelBtn').disabled=same||available<amount||(!external&&!selected);
}
function createPersonnelTransfer(){
  const role=document.getElementById('transferPersonnelRole').value,from=document.getElementById('transferPersonnelFrom').value,to=document.getElementById('transferPersonnelTo').value,amount=clamp(Math.floor(Number(document.getElementById('transferPersonnelAmount').value)||1),1,50),method=document.getElementById('transferPersonnelMethod').value;
  const qualifications=qualificationTransferMix(from,role,amount); if(!PERSONNEL[role]||from===to||staffAt(from,role)<amount||qualifications===null) return toast('That personnel transfer is not available.');
  const id='PT'+state.nextPersonnelTransfer++; let transfer;
  if(method==='own'){
    const flight=eligiblePersonnelFlights(from,to,amount).find(f=>f.id===document.getElementById('transferPersonnelFlight').value); if(!flight) return toast('That own flight is no longer suitable.');
    transfer={id,role,amount,from,to,method,qualifications,flightId:flight.id,departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),cost:0,status:'scheduled',createdAt:simNow()};
  }else{ const plan=externalTransferPlan(from,to,amount); transfer={id,role,amount,from,to,method,qualifications,departure:plan.departure,arrival:plan.arrival,cost:0,status:'scheduled',createdAt:simNow()}; }
  changeStaff(from,role,-amount); for(const [family,count] of Object.entries(qualifications||{})) changeQualification(from,role,family,-count);
  state.personnelTransfers.push(transfer); save(); refreshAll(); toast(`${id} booked.`);
}
function renderPersonnelTransfers(){
  const transfers=[...(state.personnelTransfers||[])].sort((a,b)=>b.createdAt-a.createdAt).slice(0,30);
  document.getElementById('personnelTransferList').innerHTML=transfers.length?transfers.map(item=>`<div class="data-row"><div><b>${esc(item.id)} · ${esc(item.from)} → ${esc(item.actualTo||item.to)}</b><span>${item.amount} ${esc(PERSONNEL[item.role]?.label||item.role)} · ${esc(item.method==='own'?item.flightId:'external service')}</span></div><em>${esc(item.status)}</em></div>`).join(''):'<div class="empty-state">No personnel transfers.</div>';
}

function refreshMaintenance(){
  const list=document.getElementById('managementMaintenanceList'); if(!list) return;
  list.innerHTML=state.aircraft.length?state.aircraft.map(ac=>{
    const status=Management.maintenanceStatus(ac,simNow()),job=status.scheduled;
    return `<div class="data-row"><div><b>${esc(ac.tail)} · ${esc(status.label)}</b><span>Condition ${Math.round(ac.condition??100)}% · ${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles remaining${job?` · ${shortDay(job.start)} ${shortClock(job.start)}`:''}</span></div><div class="data-row-actions">${job&&job.status==='scheduled'?`<button class="secondary-button" type="button" data-cancel-check="${esc(ac.id)}">Cancel check</button>`:`<button class="primary-button" type="button" data-schedule-check="${esc(ac.id)}">Schedule check</button>`}</div></div>`;
  }).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  list.querySelectorAll('[data-schedule-check]').forEach(button=>button.addEventListener('click',()=>scheduleAircraftMaintenance(button.dataset.scheduleCheck)));
  list.querySelectorAll('[data-cancel-check]').forEach(button=>button.addEventListener('click',()=>cancelAircraftMaintenance(button.dataset.cancelCheck)));
}

function refreshManagement(force=false){
  const signature=[managementPage,state.aircraft.length,state.slotRights.length,JSON.stringify(state.personnel.assignments),state.personnelTransfers?.length,state.resourceRequests?.map(r=>`${r.id}:${r.status}`).join('|')].join('::');
  if(!force&&signature===lastManagementSignature) return; lastManagementSignature=signature;
  refreshAircraftSelect(force); refreshAircraftRequestPreview(); refreshPersonnelRequestPreview(); refreshSlotBuyPreview(); refreshPersonnelTransferOptions();
  renderManagementAircraft(); renderManagementPersonnel(); refreshSlotPortfolio(force); renderPersonnelTransfers(); refreshMaintenance(); refreshSchedulePreview();
}
function refreshPersonnel(force=false){ if(force||nextWorkspace==='management'){renderManagementPersonnel();renderPersonnelTransfers();refreshPersonnelTransferOptions();} }
function refreshResourceRequestSummary(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshManagementCycle(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshWeather(){}

function applyWorkspaceView(){
  document.getElementById('speed').value=String(state.clock.speed);
  document.getElementById('scheduleRange').value=String(scheduleRangeHours);
  showWorkspace('operations');
}

function initWorkspaceSplitter(){
  const workspace=document.getElementById('center-workspace'),mapPane=document.getElementById('map-pane'),splitter=document.getElementById('workspace-splitter');
  let pct=clamp(Number(localStorage.getItem('aerosim_next_center_split_pct'))||50,22,78); mapPane.style.flexBasis=pct+'%';
  let dragging=false;
  const apply=clientY=>{const rect=workspace.getBoundingClientRect(),usable=Math.max(1,rect.height-7);pct=clamp((clientY-rect.top)/usable*100,22,78);mapPane.style.flexBasis=pct+'%';localStorage.setItem('aerosim_next_center_split_pct',String(pct));requestAnimationFrame(()=>{if(typeof map!=='undefined')map.invalidateSize({animate:false});});};
  splitter.addEventListener('pointerdown',event=>{dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture(event.pointerId);});
  splitter.addEventListener('pointermove',event=>{if(dragging)apply(event.clientY);});
  const stop=event=>{if(!dragging)return;dragging=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture(event.pointerId);}catch(_){}};
  splitter.addEventListener('pointerup',stop); splitter.addEventListener('pointercancel',stop);
}

function refreshAll(){
  processEvents(); recalculateOperations(); refreshHeader(); refreshAircraftSelect(true); refreshOccWidgets(true); refreshFleetList(true); refreshDepartmentWidgets(true); renderContext(true); refreshManagement(true); updateMapData(); refreshScheduleTimeline(true);
}

populateManagementControls();
refreshAircraftSelect(true);
refreshScheduleMode();
refreshAircraftRequestPreview();
refreshPersonnelRequestPreview();
refreshSlotBuyPreview();
refreshPersonnelTransferOptions();
document.getElementById('speed').value=String(state.clock.speed);

document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>showWorkspace(button.dataset.workspace)));
document.querySelectorAll('[data-management-page]').forEach(button=>button.addEventListener('click',()=>showManagementPage(button.dataset.managementPage)));
document.getElementById('taskInboxButton')?.addEventListener('click',()=>{showWorkspace('operations');contextMode='inbox';lastContextSignature='';renderContext(true);});
scheduleBtn.addEventListener('click',scheduleFlight);
requestSlotsBtn.addEventListener('click',requestRequiredScheduleSlots);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,destEl,departureTimeEl,repeatRuleEl,turnaroundEl].forEach(element=>{element.addEventListener('change',refreshSchedulePreview);element.addEventListener('input',refreshSchedulePreview);});
aircraftEl.addEventListener('change',()=>{const ac=state.aircraft.find(item=>item.id===aircraftEl.value);if(ac)originEl.value=ac.location;refreshScheduleMode();});

['managementAircraftModel','managementCabinFirst','managementCabinBusiness'].forEach(id=>document.getElementById(id).addEventListener('input',refreshAircraftRequestPreview));
document.getElementById('requestAircraftButton').addEventListener('click',()=>{const request=aircraftCabinRequest();if(request)requestAircraft(request.modelName,request.cabin);});
['personnelRole','personnelAirport','personnelQualification','personnelAmount'].forEach(id=>document.getElementById(id).addEventListener('input',refreshPersonnelRequestPreview));
document.getElementById('requestPersonnelBtn').addEventListener('click',()=>{
  const role=document.getElementById('personnelRole').value,airport=document.getElementById('personnelAirport').value,amount=clamp(Math.floor(Number(document.getElementById('personnelAmount').value)||1),1,50),qualification=document.getElementById('personnelQualification').value;
  const result=requestPersonnelResource(role,airport,amount,qualification); refreshAll(); toast(result?.status==='delivered'?`${amount} ${PERSONNEL[role].label.toLowerCase()} assigned at ${airport}.`:`Personnel request submitted for ${airport}.`);
});
['slotAirport','slotTime'].forEach(id=>document.getElementById(id).addEventListener('input',refreshSlotBuyPreview));
document.getElementById('requestSlotBtn').addEventListener('click',()=>{const airport=document.getElementById('slotAirport').value,aligned=alignTimestampToAirportSlot(slotTimestamp(),airport),right=requestSlotRight(airport,aligned);refreshAll();toast(right?`${airport} ${shortClock(aligned)} slot series assigned.`:'Slot coordination request submitted.');});
['transferPersonnelRole','transferPersonnelAmount','transferPersonnelFrom','transferPersonnelTo','transferPersonnelMethod','transferPersonnelFlight'].forEach(id=>document.getElementById(id).addEventListener('input',refreshPersonnelTransferOptions));
document.getElementById('transferPersonnelBtn').addEventListener('click',createPersonnelTransfer);

document.getElementById('speed').addEventListener('change',event=>{rebaseClock(Number(event.target.value));lastScheduleSignature='';refreshAll();toast(event.target.value==='1'?'Realtime enabled.':'Test acceleration enabled.');});
document.getElementById('schedulePrevBtn').addEventListener('click',()=>{scheduleWindowOffsetHours-=12;lastScheduleSignature='';refreshScheduleTimeline(true);});
document.getElementById('scheduleNowBtn').addEventListener('click',centerScheduleOnNow);
document.getElementById('scheduleNextBtn').addEventListener('click',()=>{scheduleWindowOffsetHours+=12;lastScheduleSignature='';refreshScheduleTimeline(true);});
document.getElementById('scheduleRange').addEventListener('change',event=>{scheduleRangeHours=Number(event.target.value)||24;lastScheduleSignature='';refreshScheduleTimeline(true);});
document.getElementById('resetBtn').addEventListener('click',()=>{if(window.confirm('Delete this local airline save? Aircraft, flights, schedules, tasks, and slot rights will be removed.'))resetLocalSave();});
initWorkspaceSplitter();
