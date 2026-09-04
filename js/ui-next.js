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
let lastWeatherStripSignature='';

const managementContentHome=document.querySelector('.management-content');
const embeddedManagementPages=new Map([...document.querySelectorAll('[data-management-content]')].map(element=>[
  element.dataset.managementContent,{element,parent:element.parentNode,next:element.nextSibling}
]));

const baseSettleSelected=settleSelected;
const baseSettleSelectedFlight=settleSelectedFlight;
settleSelected=function(acId){
  contextMode='context';
  const result=baseSettleSelected(acId);
  lastDeskStackSignature='';
  renderDeskStack(true);
  return result;
};
settleSelectedFlight=function(flightId){
  contextMode='context';
  const result=baseSettleSelectedFlight(flightId);
  lastDeskStackSignature='';
  renderDeskStack(true);
  return result;
};

workspaceUi.collapsed??={occ:{}};
workspaceUi.collapsed.occ??={};
workspaceUi.collapsed.rail??={};
workspaceUi.nextDeskPanels??={};
workspaceUi.nextActiveIncidentId??='';

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function infoTip(text){
  if(!String(text||'').trim()) return '';
  const copy=esc(text);
  return `<span class="info-tip" title="${copy}" aria-label="${copy}" tabindex="0">i</span>`;
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
function saveWorkspaceUi(){ localStorage.setItem(WORKSPACE_UI_KEY,JSON.stringify(workspaceUi)); }
function deskCollapseKey(desk){ return `next:${desk}`; }
function isDeskOpen(desk){ return workspaceUi.collapsed.occ[deskCollapseKey(desk)]!==true; }
function isRailWidgetOpen(widget){ return workspaceUi.collapsed.rail?.[widget]!==true; }
function activeDeskPanel(desk){ return workspaceUi.nextDeskPanels?.[desk]||''; }
function setDeskOpen(desk,open,{persist=true}={}){
  workspaceUi.collapsed.occ[deskCollapseKey(desk)]=!open;
  if(persist) saveWorkspaceUi();
}
function setRailWidgetOpen(widget,open,{persist=true}={}){
  workspaceUi.collapsed.rail??={};
  workspaceUi.collapsed.rail[widget]=!open;
  if(persist) saveWorkspaceUi();
}
function refreshRailCollapseState(){
  document.querySelectorAll('[data-rail-widget]').forEach(section=>{
    const widget=section.dataset.railWidget;
    const open=isRailWidgetOpen(widget);
    section.classList.toggle('collapsed',!open);
    const toggle=section.querySelector('[data-toggle-rail]');
    const body=section.querySelector('.rail-widget-body');
    if(toggle) toggle.setAttribute('aria-expanded',String(open));
    if(body) body.hidden=!open;
    const caret=toggle?.querySelector('.toggle-caret');
    if(caret) caret.textContent=open?'▾':'▸';
  });
}
function bindRailWidgetToggles(){
  document.querySelectorAll('[data-toggle-rail]').forEach(button=>button.addEventListener('click',()=>{
    const widget=button.dataset.toggleRail;
    setRailWidgetOpen(widget,!isRailWidgetOpen(widget),{persist:true});
    refreshRailCollapseState();
  }));
}
function setDeskPanel(desk,panel,{toggle=true}={}){
  workspaceUi.nextDeskPanels??={};
  if(panel&&(!toggle||activeDeskPanel(desk)!==panel)) workspaceUi.nextDeskPanels[desk]=panel;
  else delete workspaceUi.nextDeskPanels[desk];
  setDeskOpen(desk,true,{persist:false});
  saveWorkspaceUi();
}
function activeIncidentCase(incidents){
  if(!incidents.length) return null;
  const selected=incidents.find(incident=>incident.id===workspaceUi.nextActiveIncidentId);
  if(selected) return selected;
  const flightIncident=selectedFlightId&&incidents.find(incident=>incident.flightId===selectedFlightId);
  return flightIncident||incidents[0];
}
function setActiveIncidentCase(incidentId){
  workspaceUi.nextActiveIncidentId=incidentId||'';
  setDeskOpen('incidents',true,{persist:false});
  saveWorkspaceUi();
}
function closeFlightPlanningWidget(){ setDeskPanel('planning',''); lastDeskStackSignature=''; renderDeskStack(true); }
function setWidgetOpen(widget,open,{persist=false}={}){
  const desk=widget?.dataset?.deskWidget;
  if(desk) setDeskOpen(desk,open,{persist});
}
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
  if(flight.handlingDelayMin) return {label:`${flight.handlingDelayCause||'Ground handling'} · ${flight.handlingDelayMin} min`,critical:false};
  const delay=flightTotalDepartureDelayMin(flight);
  return delay?{label:`Departure delayed ${delay} min`,critical:false}:null;
}

function openIncidentForAircraft(aircraftId){
  return state.incidents.find(item=>item.status==='open'&&item.aircraftId===aircraftId&&(!item.flightId||item.type==='mel_defect'));
}

function attentionForAircraft(aircraft){
  const incident=openIncidentForAircraft(aircraft.id);
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
  const duty=crewDutyForFlight(flight);
  const crewReady=duty.legal&&!flight.staffingBlocked&&!openIncidentsForFlight(flight.id).some(item=>item.type==='crew_sick');
  const fuelState=flight.fueled||active?'Fuel ready':'Fuel pending';
  const slotState=flight.slotMissed?(flight.assignedSlot?`Slot ${shortClock(flight.assignedSlot)}`:'Slot pending'):'Slot planned';
  return `<button class="list-row ${issue?'needs-attention':''} ${selectedFlightId===flight.id?'selected':''}" type="button" data-next-flight="${esc(flight.id)}">
    ${issue?'<i class="attention-marker"></i>':''}
    <span class="list-primary"><span>${esc(flight.id)} · ${esc(flight.from)} → ${esc(destination)}</span><span>${active?formatPct(flightProgress(flight)):shortClock(flightActualDeparture(flight))}</span></span>
    <span class="list-secondary"><span>${esc(status==='airborne'?'Airborne':status==='delayed'?'Delayed':'Scheduled')}</span><span>${esc(shortDay(flightActualDeparture(flight)))}</span></span>
    <span class="list-readiness"><i class="${crewReady?'ready':'blocked'}">Crew ${crewReady?'legal':'blocked'}</i><i class="${flight.fueled||active?'ready':''}">${esc(fuelState)}</i><i class="${flight.slotMissed?'warning':'ready'}">${esc(slotState)}</i></span>
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
  const flightListCount=document.getElementById('flightListCount');
  if(flightListCount) flightListCount.textContent=active.length+upcoming.length;
  document.getElementById('activeFlightCount').textContent=active.length;
  document.getElementById('upcomingFlightCount').textContent=upcoming.length;
  document.getElementById('activeFlightList').innerHTML=active.length?active.map(f=>flightListItem(f,true)).join(''):'<div class="empty-state">No flights are airborne.</div>';
  document.getElementById('upcomingFlightList').innerHTML=upcoming.length?upcoming.map(f=>flightListItem(f)).join(''):'<div class="empty-state">No flights in the next 24 hours.</div>';
  refreshRailCollapseState();
  document.querySelectorAll('[data-next-flight]').forEach(button=>button.addEventListener('click',()=>{
    contextMode='context'; settleSelectedFlight(button.dataset.nextFlight);
  }));
  bindLeftInlineDetails();
}

function refreshFleetList(force=false){
  const signature=[selectedAircraftId,selectedFlightId,state.aircraft.map(ac=>{
    const active=aircraftActiveFlight(ac.id),next=aircraftUpcomingFlight(ac.id);
    return `${ac.id}:${ac.location}:${active?.id||''}:${next?.id||''}:${attentionForAircraft(ac)}`;
  }).join('|')].join('::');
  if(!force&&signature===lastAircraftListSignature) return;
  lastAircraftListSignature=signature;
  document.getElementById('aircraftListCount').textContent=state.aircraft.length;
  document.getElementById('aircraftList').innerHTML=state.aircraft.length?state.aircraft.map(aircraftListItem).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  refreshRailCollapseState();
  document.querySelectorAll('[data-next-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    contextMode='context'; settleSelected(button.dataset.nextAircraft);
  }));
  bindLeftInlineDetails();
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

function fact(label,value){ return `<div class="fact"><span>${esc(label)}</span><b>${esc(value)}</b></div>`; }

function flightInlineDetailsMarkup(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const issue=attentionForFlight(flight);
  const incident=issue?.incident;
  const duty=crewDutyForFlight(flight);
  const ground=groundOperationsForFlight(flight);
  const now=simNow();
  const operation=flightActualArrival(flight)<=now?{flight,phase:ground?.postflight}:flightActualDeparture(flight)>now?{flight,phase:ground?.departure}:null;
  const delay=flightTotalDepartureDelayMin(flight);
  return `<article class="left-inline-details" data-left-flight-details="${esc(flight.id)}">
    ${issue?`<section class="attention-summary ${issue.critical?'critical':'warning'}"><b>${esc(issue.label)}</b>${incident?`<span>${esc(incidentCopy(incident).summary)}</span>`:''}</section>`:''}
    <div class="fact-grid">${fact('Scheduled',`${shortClock(flight.departure)}-${shortClock(flight.arrival)}`)}${fact('Expected',`${shortClock(flightActualDeparture(flight))}-${shortClock(flightActualArrival(flight))}`)}${fact('Delay',delay?`+${delay} min`:'On time')}${fact('Aircraft',aircraft?`${aircraft.tail} · ${aircraft.model}`:'Unassigned')}</div>
    <section class="context-section"><h2>Ground progress</h2>${operation?phaseMarkup(operation):flightActualDeparture(flight)<=now&&now<flightActualArrival(flight)?'<div class="simple-row"><span>Current phase</span><b>Airborne</b></div>':phaseMarkup(null)}</section>
    <section class="context-section"><h2>Crew duty</h2><div class="simple-row"><span>Planned duty</span><b>${Number(duty.dutyHours||0).toFixed(1)} h / ${Number(duty.maxHours||0).toFixed(1)} h</b></div><div class="simple-row"><span>Sectors</span><b>${duty.sectors||1}${rotationUsesThroughCrew(flight)?' · through crew':''}</b></div><div class="simple-row"><span>Legality</span><b>${duty.legal?'Within limit':'Limit exceeded'}</b></div></section>
    ${aircraft?`<section class="context-section"><button class="object-link" type="button" data-context-aircraft="${esc(aircraft.id)}"><span>Assigned aircraft</span><b>${esc(aircraft.tail)} →</b></button></section>`:''}
  </article>`;
}

function aircraftInlineDetailsMarkup(aircraft){
  const active=aircraftActiveFlight(aircraft.id),upcoming=aircraftUpcomingFlight(aircraft.id);
  const incident=openIncidentForAircraft(aircraft.id);
  const maintenance=Management.maintenanceStatus(aircraft,simNow());
  const ground=aircraftGroundOperation(aircraft);
  const fuel=aircraftFuelPerformance(MODELS[aircraft.model]);
  return `<article class="left-inline-details" data-left-aircraft-details="${esc(aircraft.id)}">
    ${incident?`<section class="attention-summary critical"><b>${esc(incidentCopy(incident).title)}</b><span>${esc(incidentCopy(incident).summary)}</span></section>`:''}
    <div class="fact-grid">${fact('Location',active?`${active.from} → ${flightOperationalDestination(active)}`:aircraft.location)}${fact('Condition',`${Math.round(aircraft.condition??100)}%`)}${fact('Utilisation',`${Math.round(aircraft.flightHours||0)} h · ${aircraft.cycles||0} cycles`)}${fact('Fuel',`${Math.round(aircraft.fuelGallons||0)} / ${Math.round(fuel.fuelCapacityGal)} gal`)}</div>
    <section class="context-section"><h2>Current ground work</h2>${phaseMarkup(ground)}</section>
    <section class="context-section"><h2>Maintenance</h2><div class="simple-row"><span>Status</span><b>${esc(maintenance.label)}</b></div><div class="simple-row"><span>Next limit</span><b>${Math.max(0,Math.round(maintenance.remainingHours||0))} h / ${Math.max(0,Math.round(maintenance.remainingCycles||0))} cycles</b></div></section>
    <section class="context-section"><h2>Flying programme</h2>${active?`<button class="object-link" type="button" data-context-flight="${esc(active.id)}"><span>Active</span><b>${esc(active.id)} · ${esc(active.from)} → ${esc(flightOperationalDestination(active))}</b></button>`:''}${upcoming?`<button class="object-link" type="button" data-context-flight="${esc(upcoming.id)}"><span>Next</span><b>${esc(upcoming.id)} · ${shortClock(flightActualDeparture(upcoming))}</b></button>`:''}${!active&&!upcoming?'<div class="simple-row"><span>Assignment</span><b>Available</b></div>':''}</section>
  </article>`;
}

function flightListItem(flight,active=false){
  const selected=selectedFlightId===flight.id;
  const issue=attentionForFlight(flight);
  return `<article class="left-list-card ${selected?'selected':''} ${issue?'needs-attention':''}" data-left-card-flight="${esc(flight.id)}">${flightListRow(flight,active)}${selected?flightInlineDetailsMarkup(flight):''}</article>`;
}

function aircraftListItem(aircraft){
  const active=aircraftActiveFlight(aircraft.id),next=aircraftUpcomingFlight(aircraft.id),issue=attentionForAircraft(aircraft);
  const place=active?`${active.from} → ${flightOperationalDestination(active)}`:aircraft.location;
  const sub=active?`Airborne · ${active.id}`:next?`Next ${next.id} · ${shortClock(flightActualDeparture(next))}`:'Available';
  const rotation=state.flights.filter(f=>f.aircraftId===aircraft.id&&!f.cancelled&&flightActualDeparture(f)>simNow()&&flightActualDeparture(f)<=simNow()+24*HOUR).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b)).slice(0,2);
  const selected=selectedAircraftId===aircraft.id&&!selectedFlightId;
  return `<article class="left-list-card ${selected?'selected':''} ${issue?'needs-attention':''}" data-left-card-aircraft="${esc(aircraft.id)}"><button class="list-row ${issue?'needs-attention':''} ${selected?'selected':''}" type="button" data-next-aircraft="${esc(aircraft.id)}">
      ${issue?'<i class="attention-marker"></i>':''}<span class="list-primary"><span>${esc(aircraft.tail)}</span><span>${esc(place)}</span></span>
      <span class="list-secondary"><span>${esc(aircraft.model)}</span><span>${esc(sub)}</span></span>
      ${rotation.length?`<span class="rotation-line">${rotation.map(f=>`${esc(f.id)} ${shortClock(flightActualDeparture(f))} ${esc(f.from)}→${esc(flightOperationalDestination(f))}`).join(' · ')}</span>`:''}
      ${issue?`<span class="list-reason">${esc(issue)}</span>`:''}
    </button>${selected?aircraftInlineDetailsMarkup(aircraft):''}</article>`;
}

function bindContextCommon(){
  document.querySelector('[data-close-context]')?.addEventListener('click',()=>{
    selectedFlightId=null; selectedAircraftId=null; contextMode='context'; lastContextSignature=''; renderContext(true); refreshOccWidgets(true); refreshFleetList(true); refreshScheduleTimeline(true); updateMapData();
  });
  document.querySelectorAll('.ground-task-toggle').forEach(button=>{
    if(button.dataset.boundGroundToggle) return;
    button.dataset.boundGroundToggle='true';
    button.addEventListener('click',()=>{
      const list=button.nextElementSibling,expanded=button.getAttribute('aria-expanded')==='true';
      button.setAttribute('aria-expanded',String(!expanded));
      if(list) list.hidden=expanded;
      button.textContent=expanded?`Show ${list?.children.length||0} ground tasks`:'Hide ground tasks';
    });
  });
}

function bindLeftInlineDetails(){
  document.querySelectorAll('.left-inline-details [data-context-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation(); contextMode='context'; settleSelected(button.dataset.contextAircraft);
  }));
  document.querySelectorAll('.left-inline-details [data-context-flight]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation(); contextMode='context'; settleSelectedFlight(button.dataset.contextFlight);
  }));
  bindContextCommon();
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
  setActiveIncidentCase(incident.id);
  ensureIncidentWorkflow(incident);
  const task=incidentWorkflowProgress(incident).current;
  if(task) openTask(task.id);
}
function openTask(taskId){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  if(!task) return;
  focusedTaskId=task.id;
  if(task.incidentId) setActiveIncidentCase(task.incidentId);
  setDeskPanel(taskDesk(task),`task:${task.id}`,{toggle:false});
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
  const blocker=['technical_strategy','recovery_strategy'].includes(task.kind)?'':taskResourceBlocker(task,incident);
  if(blocker) return `<div class="attention-summary critical"><b>Resource unavailable</b><span>${esc(blocker)}</span></div>`;
  if(task.kind==='crew_allocation'){
    const options=crewPoolOptions(incident);
    return options.length?`<div class="task-form"><label>Qualified personnel pool<select data-task-crew-pool>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="allocate">Allocate crew</button></div>`:'<div class="attention-summary critical"><b>No qualified crew available</b><span>Request or position qualified personnel in the Personnel desk.</span></div>';
  }
  if(task.kind==='technical_strategy'||task.kind==='recovery_strategy'){
    const fallback=[{id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},{id:'repair',label:'Repair aircraft',detail:'Ground the aircraft for engineering sign-off.'},{id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}];
    const options=task.strategyOptions||fallback;
    return `<div class="choice-list">${options.map(option=>{
      const optionBlocker=branchStrategyOptionBlocker(task,incident,option.id);
      const consequence=operationalOptionConsequence(task,incident,option.id);
      return `<button class="choice-button" type="button" data-task-action="${esc(option.id)}" ${optionBlocker?'disabled':''}><b>${esc(option.label||option.id)}</b><span>${esc(optionBlocker||option.detail||'Select this recovery path.')}</span>${consequence?`<em class="choice-consequence">${esc(consequence)}</em>`:''}</button>`;
    }).join('')}</div>`;
  }
  if(task.kind==='maintenance_disposition') return `<div class="choice-list"><button class="choice-button" type="button" data-task-action="defer"><b>Defer under MEL</b><br>Document restrictions and continue if permitted.</button><button class="choice-button" type="button" data-task-action="repair"><b>Repair aircraft</b><br>Ground the aircraft while engineering completes the repair.</button></div>`;
  if(task.kind==='maintenance_defer') return `<button class="primary-button" type="button" data-task-action="defer">Confirm MEL deferral</button>`;
  if(task.kind==='maintenance_repair') return `<button class="primary-button" type="button" data-task-action="repair">Start repair</button>`;
  if(task.kind==='maintenance_clearance') return `<button class="primary-button" type="button" data-task-action="complete">Record engineering clearance</button>`;
  if(task.kind==='crew_augmentation') return `<button class="primary-button" type="button" data-task-action="complete">Assign augmented crew</button>`;
  if(task.kind==='aircraft_substitution'){
    const options=incidentAircraftReplacementOptions(incident);
    return options.length?`<div class="task-form"><label>Replacement aircraft<select data-task-replacement-aircraft>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)} · ${esc(option.detail)}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="substitute-aircraft">Assign replacement</button></div>`:'<div class="attention-summary critical"><b>No replacement aircraft available</b><span>Request an aircraft or reposition a spare in Dispatch & slots, then return to this task.</span></div>';
  }
  if(task.kind==='flight_cancellation') return `<button class="danger-button" type="button" data-task-action="cancel-flight">Cancel affected flight</button>`;
  if(task.kind==='atc_coordination') return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if(task.kind==='stand_request') return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if(['inbound_wait','turnaround_expedite','slot_coordination','station_recovery','fuel_recovery','security_coordination','connection_protection','medical_assessment','medical_coordination'].includes(task.kind)) return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if(task.kind==='alternate_selection'){
    const options=diversionOptionsForIncident(incident,{includeReturnOrigin:false});
    return options.length?`<div class="task-form"><label>Operational alternate<select data-task-alternate>${options.map(option=>`<option value="${option.code}">${option.returnOrigin?'Return to origin':option.code} · ${option.returnOrigin?'origin airport':`${Math.round(option.destinationKm)} km from destination`} · fuel ${option.fuel.estimated?'estimated':'planned'}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="alternate">Select alternate</button></div>`:'<div class="attention-summary critical"><b>No suitable alternate available</b></div>';
  }
  if(task.kind==='return_origin_selection'){
    const option=diversionOptionsForIncident(incident,{onlyReturnOrigin:true})[0];
    return option?`<button class="primary-button" type="button" data-task-action="complete">Confirm return to ${esc(option.code)}</button>`:'<div class="attention-summary critical"><b>Return unavailable</b><span>Fuel, weather, or handling does not support a return right now.</span></div>';
  }
  const labels={maintenance_inspection:'Start engineering inspection',atc_coordination:task.label,flightdeck_recommendation:'Send recommendation',diversion_clearance:'Submit ATC request',alternate_handling:'Request handling',dispatch_release:'Issue release',station_coordination:'Confirm coordination'};
  return `<button class="primary-button" type="button" data-task-action="complete">${esc(labels[task.kind]||'Complete task')}</button>`;
}

const OCC_OWNER_LABELS={dispatch:'Dispatch',crew:'Crew Control',maintenance:'Maintenance',station:'Station Operations'};
const OCC_DESK_LABELS={planning:'Dispatch & Planning',personnel:'Personnel',maintenance:'Maintenance',airports:'Airports'};

function openOperationalIncidents(){
  const incidents=state.incidents.filter(item=>item.status==='open').sort((a,b)=>Number(Boolean(b.blocking))-Number(Boolean(a.blocking))||(a.detectedAt||0)-(b.detectedAt||0));
  incidents.forEach(ensureIncidentWorkflow);
  return incidents;
}

function taskDesk(task){
  if(task.department==='crew') return 'personnel';
  if(task.department==='maintenance') return 'maintenance';
  if(task.department==='station') return 'airports';
  if(task.department==='dispatch') return 'planning';
  return 'planning';
}

function taskPriority(task){
  const selected=task.flightId&&task.flightId===selectedFlightId ? -100 : task.aircraftId&&task.aircraftId===selectedAircraftId ? -80 : 0;
  const status={available:0,in_progress:1,waiting_external:2,blocked:3};
  return selected+(status[task.status]??4);
}

function tasksForDesk(desk){
  return actionableTasks().filter(task=>{
    const incident=state.incidents.find(item=>item.id===task.incidentId);
    return taskDesk(task)===desk&&taskRelevantToIncidentStrategy(task,incident);
  }).sort((a,b)=>taskPriority(a)-taskPriority(b)||(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));
}

function taskObjectLabel(task){
  const flight=state.flights.find(item=>item.id===task.flightId);
  const aircraft=state.aircraft.find(item=>item.id===task.aircraftId);
  if(flight) return `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`;
  if(aircraft) return `${aircraft.tail} · ${aircraft.model}`;
  return task.incidentId||'Operational task';
}

function blockedTaskCopy(task){
  const tasks=incidentTasks(task.incidentId);
  const blockers=task.dependsOn
    .map(id=>tasks.find(item=>item.id===id))
    .filter(item=>item&&item.status!=='completed')
    .map(item=>item.label);
  return blockers.length?`Waiting for ${blockers.join(' · ')}`:'Waiting for an earlier step.';
}

function departmentTaskMarkup(task,{compact=false}={}){
  const incident=state.incidents.find(item=>item.id===task.incidentId);
  const copy=incidentCopy(incident);
  const active=task.status!=='blocked';
  return `<article class="department-task ${focusedTaskId===task.id?'focused':''} ${active?'':'queued'}" data-inline-task="${esc(task.id)}">
    <div class="department-task-head"><div><span>${esc(taskObjectLabel(task))}</span><b>${esc(task.label)}</b></div><em>${esc(taskStateLabel(task))}</em></div>
    ${compact?'':`<p>${esc(copy.title)} · ${esc(task.detail)}</p>`}
    ${active?`<div class="inline-task-action">${taskActions(task,incident)}</div>`:`<p>${esc(blockedTaskCopy(task))}</p>`}
  </article>`;
}

function deskTaskPanelMarkup(desk){
  const panel=activeDeskPanel(desk);
  if(!panel.startsWith('task:')) return '';
  const taskId=panel.slice(5);
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  if(!task||taskDesk(task)!==desk) return '';
  if(['available','in_progress','waiting_external'].includes(task.status)) return '';
  return `<section class="desk-action-panel" data-active-desk-panel="${esc(panel)}"><header><b>${esc(task.label)}</b><button class="icon-button" type="button" data-close-desk-panel="${esc(desk)}" aria-label="Close">×</button></header>${departmentTaskMarkup(task)}</section>`;
}

function deskActiveTasksMarkup(desk){
  const tasks=tasksForDesk(desk).filter(task=>['available','in_progress','waiting_external'].includes(task.status));
  if(!tasks.length) return '';
  return `<section class="desk-section desk-active-task-section"><h2>Active task${tasks.length===1?'':'s'}</h2>${tasks.map(task=>departmentTaskMarkup(task,{compact:true})).join('')}</section>`;
}

function caseStepStatusLabel(task){
  if(task.status==='completed') return 'Complete';
  if(task.status==='waiting_external') return 'Waiting reply';
  if(task.status==='in_progress') return 'In progress';
  if(task.status==='available') return 'Ready';
  if(task.status==='blocked') return 'Blocked';
  return task.status||'Open';
}
function caseStepsMarkup(incident,currentTask){
  const tasks=playableIncidentTasks(incident);
  return `<section class="case-console-section"><h2>Coordination chain</h2><div class="case-step-list">${tasks.map(task=>`<div class="case-step ${task.id===currentTask?.id?'current':''} ${esc(task.status)}"><span>${esc(caseStepStatusLabel(task))}</span><b>${esc(OCC_OWNER_LABELS[task.department]||'Operations')}</b><em>${esc(task.label)}</em></div>`).join('')}</div></section>`;
}
function impactStatusLabel(status){
  if(status==='auto') return 'Defaulted';
  if(status==='handled') return 'Handled';
  if(status==='accepted') return 'Accepted';
  if(status==='cleared') return 'Cleared';
  return 'Impact';
}
function incidentImpactDetail(impact){
  const context=impact.context||{};
  if(impact.type==='slot_miss_risk') return `${context.slotDelayMin||0} min slot delay`;
  if(impact.type==='connection_risk') return `${context.atRiskPax||0} at risk · ${context.missedPax||0} missed`;
  if(impact.type==='crew_duty_risk') return context.label||'Duty envelope at risk';
  return impact.summary||INCIDENT_DEFINITIONS[impact.type]?.summary||'Operational impact';
}
function caseImpactsMarkup(incident){
  const impacts=(incident.impacts||[]).filter(Boolean);
  if(!impacts.length) return '';
  return `<section class="case-console-section"><h2>Linked impacts</h2><div class="case-step-list">${impacts.map(impact=>`<div class="case-step ${esc(impact.status||'open')}"><span>${esc(impactStatusLabel(impact.status))}</span><b>${esc(impact.title||INCIDENT_DEFINITIONS[impact.type]?.title||impact.type)}</b><em>${esc(incidentImpactDetail(impact))}</em></div>`).join('')}</div></section>`;
}
function caseLogMarkup(incident){
  const entries=[{time:incident.detectedAt,text:`${incidentCopy(incident).title} detected at ${incident.airport||'operation'}.`}];
  for(const impact of incident.impacts||[]){
    if(impact.createdAt) entries.push({time:impact.createdAt,text:`Impact linked: ${impact.title||INCIDENT_DEFINITIONS[impact.type]?.title||impact.type}.`});
  }
  for(const task of incidentTasks(incident.id)){
    if(task.startedAt) entries.push({time:task.startedAt,text:`${task.label} started.`});
    const request=(state.externalRequests||[]).find(item=>item.taskId===task.id);
    if(request?.submittedAt) entries.push({time:request.submittedAt,text:`Request sent to ${request.counterparty}.`});
    if(task.completedAt) entries.push({time:task.completedAt,text:task.outcome||`${task.label} complete.`});
  }
  if(incident.resolvedAt) entries.push({time:incident.resolvedAt,text:incident.outcome||'Case resolved.'});
  const rows=entries.sort((a,b)=>a.time-b.time).slice(-6);
  return `<section class="case-console-section"><h2>Case log</h2><div class="case-log-list">${rows.map(row=>`<div class="case-log-row"><span>${shortClock(row.time)}</span><b>${esc(row.text)}</b></div>`).join('')}</div></section>`;
}
function caseActiveTaskMarkup(incident,task){
  if(!task) return '<section class="case-console-section"><h2>Active task</h2><div class="occ-clear-state"><b>Coordination complete</b><span>The case will close once operational constraints refresh.</span></div></section>';
  if(task.status==='blocked') return `<section class="case-console-section"><h2>Active task</h2><article class="case-blocked-task"><b>${esc(task.label)}</b><span>${esc(blockedTaskCopy(task))}</span></article></section>`;
  return `<section class="case-console-section case-active-task"><h2>Active task</h2>${departmentTaskMarkup(task,{compact:true})}</section>`;
}
function incidentDecisionSummary(incident,task){
  if(task) return `${OCC_OWNER_LABELS[task.department]||'Operations'} · ${caseStepStatusLabel(task)}`;
  if(incident.status==='resolved') return 'Resolved';
  return 'Coordination complete';
}
function incidentCaseMarkup(incident){
  const copy=incidentCopy(incident),progress=incidentWorkflowProgress(incident),task=progress.current;
  const flight=state.flights.find(item=>item.id===incident.flightId),aircraft=state.aircraft.find(item=>item.id===incident.aircraftId);
  const reference=flight?`${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`:aircraft?`${aircraft.tail} · ${aircraft.model}`:'Operational case';
  const expanded=workspaceUi.nextActiveIncidentId===incident.id;
  return `<article class="incident-case case-console ${expanded?'expanded':'compact'} ${focusedTaskId===task?.id?'focused':''}" data-incident-case="${esc(incident.id)}">
    <header class="incident-case-header"><button type="button" data-case-object="${esc(flight?'flight':'aircraft')}" data-case-object-id="${esc(flight?.id||aircraft?.id||'')}"><span>${esc(reference)}</span><b>${esc(copy.title)}</b></button><em>${incident.blocking?'Blocking':'Open'}</em></header>
    <p>${esc(copy.summary)}</p>
    <div class="incident-meta"><span>${esc(incidentDecisionSummary(incident,task))}</span><span>${progress.completed}/${progress.total} steps</span></div>
    <div class="progress-track"><span style="width:${formatPct(progress.progress)}"></span></div>
    ${expanded?`${caseActiveTaskMarkup(incident,task)}${caseImpactsMarkup(incident)}${caseStepsMarkup(incident,task)}${caseLogMarkup(incident)}`:`<button class="case-open-link" type="button" data-open-case="${esc(incident.id)}">Open case</button>`}
  </article>`;
}

function deskActionBar(desk,actions){
  return `<div class="desk-action-bar">${actions.map(action=>{
    if(action.kind==='direct') return `<button class="desk-action-link" type="button" ${action.attr||''}>${esc(action.label)}</button>`;
    return `<button class="desk-action-link ${activeDeskPanel(desk)===action.panel?'active':''}" type="button" data-desk-panel="${esc(desk)}:${esc(action.panel)}">${esc(action.label)}</button>`;
  }).join('')}</div>`;
}

function deskPanelMarkup(desk,panel,title,content=''){
  if(activeDeskPanel(desk)!==panel) return '';
  const body=content||`<div class="occ-management-host" data-occ-page-host="${esc(panel)}"></div>`;
  return `<section class="desk-action-panel" data-active-desk-panel="${esc(panel)}"><header><b>${esc(title)}</b><button class="icon-button" type="button" data-close-desk-panel="${esc(desk)}" aria-label="Close">×</button></header>${body}</section>`;
}

function airportPanelMarkup(kind){
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(kind==='alternates'){
    const incident=selected&&openIncidentsForFlight(selected.id).find(item=>item.type==='destination_closure');
    const options=incident?diversionOptionsForIncident(incident):selected?Object.keys(AIRPORTS).filter(code=>code!==selected.from&&code!==selected.to).map(code=>{
      const weather=Management.weatherAt(code,simNow());
      return {code,weather,destinationKm:distanceKm(AIRPORTS[selected.to],AIRPORTS[code]),handling:staffAt(code,'groundHandling'),returnOrigin:false};
    }).sort((a,b)=>a.destinationKm-b.destinationKm).slice(0,5):[];
    return options.length?options.map(item=>`<div class="desk-list-row"><div><b>${esc(item.returnOrigin?'Return to origin':item.code)} · ${esc(AIRPORTS[item.code]?.name||'Airport')}</b><span>${esc(item.weather.label)} · ${item.returnOrigin?'origin airport':`${Math.round(item.destinationKm)} km from destination`} · ${item.handling} handlers${item.fuel?` · fuel ${item.fuel.estimated?'estimated':'planned'}`:''}</span></div><em>${esc(item.weather.level)}</em></div>`).join(''):'<div class="empty-state">Select a flight to review alternates.</div>';
  }
  return airportOpsMarkup();
}

function selectedAlternatesMarkup(){
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!selected) return '';
  return `<section class="desk-section"><h2>Suitable alternates</h2>${airportPanelMarkup('alternates')}</section>`;
}

function sparesPanelMarkup(){
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  const candidates=selected?rotationReplacementCandidates(selected):state.aircraft.filter(ac=>!aircraftActiveFlight(ac.id)&&!aircraftUpcomingFlight(ac.id)&&!aircraftIsDefective(ac)).slice(0,5);
  return candidates.length?candidates.map(ac=>`<div class="desk-list-row"><div><b>${esc(ac.tail)} · ${esc(ac.model)}</b><span>${esc(ac.location)} · condition ${Math.round(ac.condition??100)}%</span></div><em>spare</em></div>`).join(''):'<div class="empty-state">No spare aircraft match the current operation.</div>';
}

function occWidgetMarkup(key,kicker,title,count,status,actions,content){
  const context=[kicker,status].filter(Boolean).join(' · ');
  const open=isDeskOpen(key);
  return `<section class="occ-board-widget ${count?'has-work':''} ${open?'':'collapsed'}" id="occ-desk-${key}" data-desk-widget="${key}">
    <header class="occ-widget-header"><button class="occ-widget-toggle" type="button" data-toggle-desk="${esc(key)}" aria-expanded="${open}" aria-controls="occ-body-${esc(key)}"><span class="toggle-caret">${open?'▾':'▸'}</span><span class="widget-title"><h1>${esc(title)}</h1>${infoTip(context)}</span><span class="occ-widget-state"><b>${count}</b></span></button></header>
    <div class="occ-widget-body" id="occ-body-${esc(key)}" ${open?'':'hidden'}>${actions}${content}</div>
  </section>`;
}

function ensurePageInfoTip(page){
  const heading=page.querySelector('.page-heading');
  const help=heading?.querySelector('p');
  const title=heading?.querySelector('h1');
  if(!heading||!help||!title||heading.querySelector('.info-tip')) return;
  title.insertAdjacentHTML('afterend',infoTip(help.textContent.trim()));
}

function mountOccManagementPages(root){
  const hosts={planning:'planning',personnel:'personnel',relocation:'relocation',aircraft:'aircraft',maintenance:'maintenance',slots:'slots'};
  for(const [pageName,hostName] of Object.entries(hosts)){
    const page=embeddedManagementPages.get(pageName)?.element;
    const host=root.querySelector(`[data-occ-page-host="${hostName}"]`);
    if(!page||!host) continue;
    page.hidden=false;
    page.classList.add('active');
    ensurePageInfoTip(page);
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
    if(action==='substitute-aircraft'){actionId='';payload.optionId=card.querySelector('[data-task-replacement-aircraft]')?.value;}
    if(action==='cancel-flight') actionId='';
    if(action==='complete') actionId='';
    focusedTaskId=task.id;
    const desk=taskDesk(task);
    const taskPanel=`task:${task.id}`;
    const performed=performOperationalTask(task.id,actionId,payload);
    if(performed&&task.status==='completed'&&activeDeskPanel(desk)===taskPanel){
      focusedTaskId='';
      setDeskPanel(desk,'');
      lastDeskStackSignature='';
      renderDeskStack(true);
    }
  }));
}

function transferStatusCopy(transfer,t=simNow()){
  if(transfer.status==='completed') return {label:'completed',detail:`Arrived ${shortClock(transfer.completedAt||transfer.arrival)}`};
  if(transfer.status==='cancelled') return {label:'cancelled',detail:'Returned to origin roster'};
  const remaining=Math.max(0,Math.ceil(((transfer.arrival||t)-t)/MIN));
  const phase=t>=transfer.departure?'in transit':'booked';
  return {label:phase,detail:`ETA ${shortClock(transfer.arrival)} · ${remaining} min`};
}

function resourceActivityMarkup(requests,transfers,title='Activity underway'){
  if(!requests.length&&!transfers.length) return '';
  const requestRows=requests.map(item=>{
    const payload=item.payload||{},subject=payload.model||PERSONNEL[payload.role]?.label||payload.airport||item.location||item.kind;
    return `<div class="desk-list-row"><div><b>${esc(item.id)} · ${esc(subject)}</b><span>${esc(item.kind)} request${item.location?` · ${esc(item.location)}`:''}</span></div><em>Expected ${shortClock(item.readyAt)}</em></div>`;
  });
  const transferRows=transfers.map(item=>{
    const status=transferStatusCopy(item);
    return `<div class="desk-list-row"><div><b>${esc(item.id)} · ${esc(item.from)} → ${esc(item.actualTo||item.to)}</b><span>${item.amount} ${esc(PERSONNEL[item.role]?.label||item.role)} · ${esc(item.method==='own'?item.flightId:'external service')} · ${esc(status.detail)}</span></div><em>${esc(status.label)}</em></div>`;
  });
  return `<section class="desk-section"><h2>${esc(title)}</h2>${[...requestRows,...transferRows].join('')}</section>`;
}

function dispatchOccActionsMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<section class="desk-section occ-actions-section"><h2>OCC actions</h2><div class="empty-state">Select a flight to hold, swap aircraft, or cancel.</div></section>';
  const now=simNow();
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const beforeDeparture=!flight.departureLogged&&flightActualDeparture(flight)>now;
  const rotation=rotationForFlight(flight);
  const pairedReturn=rotation.returnFlight&&flight.serviceLeg!=='return'?rotation.returnFlight:null;
  const scope=flight.serviceId&&rotation.outbound
    ? `Round trip ${rotation.outbound.id}${pairedReturn?` + ${pairedReturn.id}`:''}`
    : 'Selected flight';
  const candidates=manualSwapCandidatesForFlight(flight);
  const swapBlocked=beforeDeparture
    ? flight.fueled?'Aircraft swap unavailable after fueling.':!candidates.length?'No suitable replacement aircraft is available.':''
    : 'Aircraft swap is only available before departure.';
  return `<section class="desk-section occ-actions-section" data-dispatch-occ-flight="${esc(flight.id)}">
    <h2>OCC actions</h2>
    <div class="occ-action-context"><b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</b><span>${esc(scope)} · ${esc(aircraft?`${aircraft.tail} · ${aircraft.model}`:'unassigned')} · expected ${shortClock(flightActualDeparture(flight))}</span></div>
    <div class="occ-action-row">
      <div><b>Delay departure</b><span>${beforeDeparture?'Manual operational hold':'Flight already departed'}</span></div>
      <div class="occ-action-controls"><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="15" ${beforeDeparture?'':'disabled'}>+15</button><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="30" ${beforeDeparture?'':'disabled'}>+30</button><input type="number" min="5" max="240" step="5" value="15" aria-label="Custom delay minutes" data-occ-custom-delay><button class="secondary-button" type="button" data-occ-custom-delay-flight="${esc(flight.id)}" ${beforeDeparture?'':'disabled'}>Apply</button></div>
    </div>
    <div class="occ-action-row">
      <div><b>Swap aircraft</b><span>${swapBlocked||`${candidates.length} suitable candidate${candidates.length===1?'':'s'}`}</span></div>
      ${candidates.length?`<div class="occ-action-controls wide"><select data-occ-swap-aircraft>${candidates.map(ac=>`<option value="${esc(ac.id)}">${esc(ac.tail)} · ${esc(ac.model)} · ${esc(ac.location)}</option>`).join('')}</select><button class="secondary-button" type="button" data-occ-swap-flight="${esc(flight.id)}">${flight.serviceId?'Swap round trip':'Swap flight'}</button></div>`:''}
    </div>
    <div class="occ-action-row danger">
      <div><b>Cancel flight</b><span>${beforeDeparture?`${scope}${pairedReturn?' will be cancelled together':''}`:'Cancellation is only available before departure'}</span></div>
      <button class="danger-button" type="button" data-occ-cancel-flight="${esc(flight.id)}" ${beforeDeparture?'':'disabled'}>Cancel</button>
    </div>
  </section>`;
}

function personnelSnapshotMarkup(){
  const selectedFlight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  const focusCodes=[selectedFlight?.from,selectedFlight&&flightOperationalDestination(selectedFlight),state.home].filter(Boolean);
  const codes=[...new Set([...focusCodes,...operationalAirportCodes()])].slice(0,6);
  return `<section class="desk-section"><h2>Staff availability</h2>${codes.length?codes.map(code=>{
    return `<div class="desk-list-row"><div><b>${esc(code)} · ${esc(AIRPORTS[code]?.name||'Station')}</b><span>${staffAt(code,'captains')} captains · ${staffAt(code,'firstOfficers')} first officers · ${staffAt(code,'cabinCrew')} cabin · ${staffAt(code,'groundHandling')} handling</span></div><em>${selectedFlight?.from===code?'origin':selectedFlight&&flightOperationalDestination(selectedFlight)===code?'arrival':'station'}</em></div>`;
  }).join(''):'<div class="empty-state">No staffed stations yet.</div>'}</section>`;
}

function maintenanceSnapshotMarkup(){
  const now=simNow();
  const aircraft=state.aircraft.slice().sort((a,b)=>{
    const aSelected=a.id===selectedAircraftId?-100:0,bSelected=b.id===selectedAircraftId?-100:0;
    const aStatus=Management.maintenanceStatus(a,now),bStatus=Management.maintenanceStatus(b,now);
    const aScore=(aStatus.grounding?0:aStatus.due?1:a.melItems?.some(item=>item.status==='open')?2:3)+aSelected;
    const bScore=(bStatus.grounding?0:bStatus.due?1:b.melItems?.some(item=>item.status==='open')?2:3)+bSelected;
    return aScore-bScore||a.tail.localeCompare(b.tail);
  }).slice(0,5);
  return `<section class="desk-section"><h2>Aircraft condition</h2>${aircraft.length?aircraft.map(ac=>{
    const status=Management.maintenanceStatus(ac,now),mel=(ac.melItems||[]).filter(item=>['open','expired'].includes(item.status));
    return `<div class="desk-list-row"><div><b>${esc(ac.tail)} · ${esc(status.label)}</b><span>Condition ${Math.round(ac.condition??100)}% · ${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles${mel.length?` · ${mel.length} MEL`:''}</span></div><em>${esc(ac.location)}</em></div>`;
  }).join(''):'<div class="empty-state">No aircraft assigned.</div>'}</section>`;
}

function externalRepliesMarkup(){
  const requests=(state.externalRequests||[]).slice().sort((a,b)=>{
    const activeA=a.status==='submitted'?0:1,activeB=b.status==='submitted'?0:1;
    return activeA-activeB||(b.submittedAt||0)-(a.submittedAt||0);
  }).slice(0,5);
  if(!requests.length) return `<section class="desk-section"><h2>External replies</h2><div class="empty-state">No ATC, flight deck, station, or handler replies are pending.</div></section>`;
  return `<section class="desk-section"><h2>External replies</h2>${requests.map(request=>{
    const task=state.coordinationTasks.find(item=>item.id===request.taskId);
    const remaining=Math.max(0,Math.ceil(((request.respondsAt||simNow())-simNow())/MIN));
    return `<div class="desk-list-row"><div><b>${esc(request.counterparty||'Counterparty')}</b><span>${esc(taskObjectLabel(task||{}))} · ${esc(request.outcome||'Awaiting response')}</span></div><em>${request.status==='submitted'?`${remaining} min`:esc(request.status)}</em></div>`;
  }).join('')}</section>`;
}

function planningDeskMarkup(requests){
  const aircraftRequests=requests.filter(item=>item.kind==='aircraft');
  const slotRequests=requests.filter(item=>item.kind==='slot');
  return `${deskPanelMarkup('planning','planning','Plan flight')}
    ${deskPanelMarkup('planning','aircraft','Request aircraft')}
    ${deskPanelMarkup('planning','slots','Request slot series')}
    ${deskActiveTasksMarkup('planning')}${deskTaskPanelMarkup('planning')}${dispatchOccActionsMarkup()}
    ${resourceActivityMarkup([...aircraftRequests,...slotRequests],[],'Resource requests')}${externalRepliesMarkup()}`;
}

function personnelDeskMarkup(requests,transfers){
  return `${deskPanelMarkup('personnel','personnel','Request personnel')}
    ${deskPanelMarkup('personnel','relocation','Move personnel')}
    ${deskActiveTasksMarkup('personnel')}${deskTaskPanelMarkup('personnel')}${personnelSnapshotMarkup()}${resourceActivityMarkup(requests.filter(item=>item.kind==='personnel'),transfers,'Personnel movement') || ''}`;
}

function maintenanceDeskMarkup(){
  return `${deskPanelMarkup('maintenance','maintenance','Schedule or cancel check')}
    ${deskActiveTasksMarkup('maintenance')}${deskTaskPanelMarkup('maintenance')}${maintenanceSnapshotMarkup()}`;
}

function incidentsDeskMarkup(incidents){
  return `<div class="incident-case-list">${incidents.length?incidents.map(incidentCaseMarkup).join(''):'<div class="occ-clear-state"><b>Operation normal</b><span>No unresolved incidents require coordination.</span></div>'}</div>`;
}

function airportsDeskMarkup(){
  return `${deskActiveTasksMarkup('airports')}${deskTaskPanelMarkup('airports')}${airportOpsMarkup()}${selectedAlternatesMarkup()}`;
}

function renderDeskStack(force=false){
  const root=document.getElementById('deskStack');
  if(!root) return;
  const incidents=openOperationalIncidents();
  const activeIncident=activeIncidentCase(incidents);
  workspaceUi.nextActiveIncidentId=activeIncident?.id||'';
  const activeRequests=(state.resourceRequests||[]).filter(item=>!['delivered','cancelled'].includes(item.status));
  const activeTransfers=(state.personnelTransfers||[]).filter(item=>!['completed','cancelled'].includes(item.status));
  const airportWarnings=operationalAirportCodes().filter(code=>Management.weatherAt(code,simNow()).level!=='normal');
  const planningTasks=tasksForDesk('planning'),personnelTasks=tasksForDesk('personnel'),maintenanceTasks=tasksForDesk('maintenance'),airportTasks=tasksForDesk('airports');
  const aircraftIssues=state.aircraft.filter(ac=>{
    const status=Management.maintenanceStatus(ac,simNow());
    return status.due||status.grounding||(ac.melItems||[]).some(item=>['open','expired'].includes(item.status));
  });
  const transferSignature=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.actualTo||''}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const signature=[
    selectedFlightId||'',selectedAircraftId||'',
    workspaceUi.nextActiveIncidentId||'',
    incidents.map(item=>`${item.id}:${item.status}:${item.blocking?1:0}:${(item.impacts||[]).map(impact=>`${impact.key}:${impact.status}:${impact.summary}`).join(',')}`).join('|'),
    actionableTasks().map(t=>`${t.id}:${t.status}:${t.completesAt}:${t.outcome||''}:${JSON.stringify(t.selection||{})}`).join('|'),
    (state.externalRequests||[]).map(item=>`${item.id}:${item.status}:${item.respondsAt}`).join('|'),
    activeRequests.map(item=>`${item.id}:${item.status}:${item.readyAt}`).join('|'),
    state.flights.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.staffingBlocked?1:0}:${f.slotMissed?1:0}`).join('|'),
    state.aircraft.map(ac=>`${ac.id}:${ac.location}:${attentionForAircraft(ac)}:${Math.round(ac.condition??100)}`).join('|'),
    airportWarnings.join('|'),state.slotRights.length,
    JSON.stringify(state.personnel.assignments||{}),transferSignature,
    JSON.stringify(workspaceUi.collapsed.occ||{}),JSON.stringify(workspaceUi.nextDeskPanels||{})
  ].join('::');
  if(!force&&signature===lastDeskStackSignature) return;
  if(!force&&root.contains(document.activeElement)) return;
  lastDeskStackSignature=signature;
  restoreEmbeddedManagementPages();
  root.innerHTML=`${occWidgetMarkup('incidents','Operational work','Open incidents',incidents.length,incidents.length?`${incidents.length} unresolved case${incidents.length===1?'':'s'}`:'No action required',deskActionBar('incidents',[
      {kind:'direct',label:'Training scenario',attr:'data-training-incident'}
    ]),incidentsDeskMarkup(incidents))}
    ${occWidgetMarkup('planning','Dispatch planning','Dispatch & slots',planningTasks.length+activeRequests.filter(item=>['aircraft','slot'].includes(item.kind)).length+(state.externalRequests||[]).filter(item=>item.status==='submitted').length,planningTasks.length?'Dispatch work queued':activeRequests.some(item=>['aircraft','slot'].includes(item.kind))?'Requests underway':'Planner ready',deskActionBar('planning',[
      {panel:'planning',label:'Plan flight'},
      {panel:'aircraft',label:'Request aircraft'},
      {panel:'slots',label:'Request slots'}
    ]),planningDeskMarkup(activeRequests))}
    ${occWidgetMarkup('personnel','People desk','Personnel',personnelTasks.length+activeRequests.filter(item=>item.kind==='personnel').length+activeTransfers.length,personnelTasks.length?'Crew work queued':activeTransfers.length?'Movements underway':'Staffing ready',deskActionBar('personnel',[
      {panel:'personnel',label:'Request personnel'},
      {panel:'relocation',label:'Move personnel'}
    ]),personnelDeskMarkup(activeRequests,activeTransfers))}
    ${occWidgetMarkup('maintenance','Engineering desk','Maintenance',maintenanceTasks.length+aircraftIssues.length,maintenanceTasks.length?'Engineering work queued':aircraftIssues.length?'Aircraft need attention':'Fleet serviceable',deskActionBar('maintenance',[
      {panel:'maintenance',label:'Schedule check'}
    ]),maintenanceDeskMarkup())}
    ${occWidgetMarkup('airports','Network desk','Airports',airportWarnings.length+airportTasks.length,airportTasks.length?'Airport work queued':airportWarnings.length?`${airportWarnings.length} weather warning${airportWarnings.length===1?'':'s'}`:'Stations normal','',airportsDeskMarkup())}`;
  mountOccManagementPages(root);
  root.querySelectorAll('[data-toggle-desk]').forEach(button=>button.addEventListener('click',event=>{
    if(event.target.closest('.info-tip')) return;
    const desk=button.dataset.toggleDesk;
    setDeskOpen(desk,!isDeskOpen(desk),{persist:true});
    lastDeskStackSignature=''; renderDeskStack(true);
  }));
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    lastDeskStackSignature=''; renderDeskStack(true);
  }));
  root.querySelectorAll('[data-open-case]').forEach(button=>button.addEventListener('click',()=>{
    const incident=state.incidents.find(item=>item.id===button.dataset.openCase);
    if(!incident) return;
    setActiveIncidentCase(incident.id);
    if(incident.flightId) settleSelectedFlight(incident.flightId);
    else if(incident.aircraftId) settleSelected(incident.aircraftId);
    lastDeskStackSignature=''; renderDeskStack(true);
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    lastDeskStackSignature=''; renderDeskStack(true);
  }));
  root.querySelector('[data-training-incident]')?.addEventListener('click',generateTrainingIncident);
  root.querySelectorAll('[data-case-object]').forEach(button=>button.addEventListener('click',()=>button.dataset.caseObject==='flight'?settleSelectedFlight(button.dataset.caseObjectId):settleSelected(button.dataset.caseObjectId)));
  root.querySelectorAll('[data-open-task]').forEach(button=>button.addEventListener('click',()=>openTask(button.dataset.openTask)));
  root.querySelectorAll('[data-occ-delay-flight]').forEach(button=>button.addEventListener('click',()=>delayFlight(button.dataset.occDelayFlight,Number(button.dataset.delayMin)||15)));
  root.querySelectorAll('[data-occ-custom-delay-flight]').forEach(button=>button.addEventListener('click',()=>{
    const minutes=clamp(Math.round(Number(button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-custom-delay]')?.value)||15),5,240);
    delayFlight(button.dataset.occCustomDelayFlight,minutes);
  }));
  root.querySelectorAll('[data-occ-swap-flight]').forEach(button=>button.addEventListener('click',()=>{
    const select=button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-swap-aircraft]');
    if(select) swapSelectedFlightAircraft(button.dataset.occSwapFlight,select.value);
  }));
  root.querySelectorAll('[data-occ-cancel-flight]').forEach(button=>button.addEventListener('click',()=>cancelFlight(button.dataset.occCancelFlight)));
  bindInlineTaskActions(root);
  refreshManagement(true);
}

function openDesk(desk){
  const destination=desk==='crew'?'personnel':desk==='maintenance'?'maintenance':desk==='station'?'airports':desk==='dispatch'?'planning':['fleet','resources'].includes(desk)?'planning':['network','weather','airports'].includes(desk)?'airports':'incidents';
  setDeskOpen(destination,true,{persist:true});
  lastDeskStackSignature=''; renderDeskStack(true);
  document.getElementById(`occ-desk-${destination}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeDesk(){}
function operationalAirportCodes(){
  const now=simNow(),flights=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)<now+24*HOUR&&flightActualArrival(f)>now);
  const used=new Set([state.home,...flights.flatMap(f=>[f.from,flightOperationalDestination(f)]),...state.slotRights.map(right=>right.airport),...Object.keys(state.personnel.assignments||{})]);
  return Object.keys(AIRPORTS).filter(code=>used.has(code));
}
function weatherIcon(weather){
  const text=`${weather?.label||''} ${weather?.conditions||''}`.toLowerCase();
  if(text.includes('storm')||weather?.level==='severe') return '⛈';
  if(text.includes('rain')) return '☔';
  if(text.includes('fog')||text.includes('cloud')) return '☁';
  if(text.includes('snow')) return '❄';
  if(weather?.level&&weather.level!=='normal') return '⛅';
  return '☀';
}
function renderWeatherStrip(force=false){
  const root=document.getElementById('weatherStrip');
  if(!root) return;
  const now=simNow();
  const codes=operationalAirportCodes();
  const signature=codes.map(code=>{
    const weather=Management.weatherAt(code,now);
    return `${code}:${weather.label}:${weather.windKph}:${weather.delayMin}:${weather.level}`;
  }).join('|');
  if(!force&&signature===lastWeatherStripSignature) return;
  lastWeatherStripSignature=signature;
  root.innerHTML=`<div class="weather-strip-scroll">${codes.length?codes.map(code=>{
    const weather=Management.weatherAt(code,now);
    return `<div class="weather-chip ${weather.level!=='normal'?'warning':''}" title="${esc(weather.conditions)} · wind ${weather.windKph} km/h · expected delay ${weather.delayMin} min"><span class="weather-icon" aria-hidden="true">${weatherIcon(weather)}</span><b>${esc(code)}</b><span>${esc(weather.label)}</span><em>${Math.round(weather.capacityFactor*100)}%</em></div>`;
  }).join(''):'<div class="weather-chip empty"><span class="weather-icon" aria-hidden="true">☀</span><b>No active stations</b></div>'}</div>`;
}
function airportOpsMarkup(){
  const now=simNow(),flights=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)>now&&flightActualDeparture(f)<now+24*HOUR);
  const codes=operationalAirportCodes();
  return `<div class="airport-ops-list">${codes.map(code=>{
    const departures=flights.filter(f=>f.from===code),arrivals=flights.filter(f=>flightOperationalDestination(f)===code),slots=state.slotRights.filter(right=>right.airport===code);
    return `<article class="airport-ops-row"><header><div><b>${esc(code)}</b><span>${esc(AIRPORTS[code].name)}</span></div><em>${departures.length+arrivals.length} movements</em></header><p>${departures.length} departures · ${arrivals.length} arrivals · ${slots.length} slot series</p><p>${staffAt(code,'groundHandling')} handling · ${staffAt(code,'operations')} operations · ${staffAt(code,'customerService')} customer service</p></article>`;
  }).join('')||'<div class="empty-state">No active stations.</div>'}</div>`;
}

function renderSelectionContext(expanded=false){
  const pane=document.getElementById('contextPane');
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
  let operation=null;
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  if(flight){
    const ground=groundOperationsForFlight(flight,now);
    operation=flightActualArrival(flight)<=now?{flight,phase:ground?.postflight}:flightActualDeparture(flight)>now?{flight,phase:ground?.departure}:null;
  }else{
    const aircraft=selectedAircraftId&&state.aircraft.find(item=>item.id===selectedAircraftId);
    if(aircraft) operation=aircraftGroundOperation(aircraft,now);
  }
  document.querySelectorAll('.left-inline-details .ground-overview').forEach(root=>{
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
  });
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
  document.getElementById('personnelTransferPreview').textContent=same?'Choose two different airports.':available<amount?`Only ${available} available at ${from}.`:external?`New external booking · estimated arrival ${formatTime(plan.arrival)}.`:selected?`New non-revenue booking on ${selected.id} · arrival ${formatTime(flightActualArrival(selected))}.`:'No own flight has enough spare seats.';
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
  document.getElementById('personnelTransferList').innerHTML=transfers.length?transfers.map(item=>{
    const status=transferStatusCopy(item);
    return `<div class="data-row"><div><b>${esc(item.id)} · ${esc(item.from)} → ${esc(item.actualTo||item.to)}</b><span>${item.amount} ${esc(PERSONNEL[item.role]?.label||item.role)} · ${esc(item.method==='own'?item.flightId:'external service')} · ${esc(status.detail)}</span></div><em>${esc(status.label)}</em></div>`;
  }).join(''):'<div class="empty-state">No personnel transfers.</div>';
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
  const transferSignature=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.actualTo||''}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const signature=[managementPage,state.aircraft.length,state.slotRights.length,JSON.stringify(state.personnel.assignments),transferSignature,state.resourceRequests?.map(r=>`${r.id}:${r.status}`).join('|')].join('::');
  if(!force&&signature===lastManagementSignature) return; lastManagementSignature=signature;
  refreshAircraftSelect(force); refreshAircraftRequestPreview(); refreshPersonnelRequestPreview(); refreshSlotBuyPreview(); refreshPersonnelTransferOptions();
  renderManagementAircraft(); renderManagementPersonnel(); refreshSlotPortfolio(force); renderPersonnelTransfers(); refreshMaintenance(); refreshSchedulePreview();
}
function refreshPersonnel(force=false){ if(force||nextWorkspace==='management'){renderManagementPersonnel();renderPersonnelTransfers();refreshPersonnelTransferOptions();} }
function refreshResourceRequestSummary(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshManagementCycle(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshWeather(force=false){ renderWeatherStrip(force); }

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
  processEvents(); recalculateOperations(); refreshHeader(); refreshAircraftSelect(true); refreshOccWidgets(true); refreshFleetList(true); refreshDepartmentWidgets(true); renderContext(true); refreshManagement(true); updateMapData(); refreshWeather(true); refreshScheduleTimeline(true);
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
function confirmLocalReset(){
  if(window.confirm('Delete this local airline save? Aircraft, flights, schedules, tasks, and slot rights will be removed.')) resetLocalSave();
}
document.getElementById('resetBtn')?.addEventListener('click',confirmLocalReset);
document.getElementById('resetTopbarBtn')?.addEventListener('click',confirmLocalReset);
bindRailWidgetToggles();
initWorkspaceSplitter();
refreshRailCollapseState();
refreshWeather(true);
