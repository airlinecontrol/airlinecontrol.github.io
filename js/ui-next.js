/* AeroSim Next UI — a quieter presentation over the existing simulation state. */

const scheduleTypeEl=document.getElementById('scheduleType');
const aircraftEl=document.getElementById('aircraft');
const originEl=document.getElementById('origin');
const destEl=document.getElementById('destination');
const departureTimeEl=document.getElementById('departureTime');
const repeatRuleEl=document.getElementById('repeatRule');
const turnaroundEl=document.getElementById('turnaround');
const scheduleBtn=document.getElementById('scheduleBtn');
const operatingDayEls=[];
const operatingMonthEls=[];

let nextWorkspace='operations';
let managementPage='planning';
let contextMode='context';
let focusedTaskId='';
let lastContextSignature='';
let lastFlightListSignature='';
let lastAircraftListSignature='';
let lastMaintenanceListSignature='';
let lastCorporateResourcesSignature='';
let lastManagementSignature='';
let lastDeskStackSignature='';
let lastWeatherStripSignature='';
let lastOperationFilterSignature='';
let incidentSoundInitialized=false;
let knownActionableIncidentIds=new Set();
let incidentAudioContext=null;
let incidentAudioContextCtor=null;
let incidentAudioReady=false;
let incidentDingRetryTimer=0;
let operationFilterCache={key:'',weatherFlightIds:new Set(),weatherCount:0};

function invalidateMapSize(){
  if(typeof map!=='undefined'&&typeof map.invalidateSize==='function') map.invalidateSize({animate:false});
}

const NextRender=(()=>{
  const dirty=new Set();
  let scheduled=false;
  const allViews=['header','selects','filter','left','desk','context','management','map','weather','schedule'];
  function invalidate(...views){
    for(const view of views.length?views:['all']){
      if(view==='all') allViews.forEach(item=>dirty.add(item));
      else dirty.add(view);
    }
    if(!scheduled){
      scheduled=true;
      requestAnimationFrame(flush);
    }
  }
  function flush(){
    scheduled=false;
    if(!dirty.size) return;
    if(dirty.has('header')) refreshHeader();
    if(dirty.has('selects')) refreshAircraftSelect(true);
    if(dirty.has('left')){ lastCorporateResourcesSignature=''; lastFlightListSignature=''; lastAircraftListSignature=''; lastMaintenanceListSignature=''; refreshCorporateResources(true); refreshOccWidgets(true); refreshFleetList(true); refreshMaintenanceRail(true); }
    if(dirty.has('desk')){ lastDeskStackSignature=''; renderDeskStack(true); }
    if(dirty.has('context')){ lastContextSignature=''; renderContext(true); }
    if(dirty.has('schedule')){ lastScheduleSignature=''; refreshScheduleTimeline(true); }
    if(dirty.has('weather')){ lastWeatherStripSignature=''; renderWeatherStrip(true); }
    if(dirty.has('filter')){ lastOperationFilterSignature=''; renderOperationFilterBar(true); }
    if(dirty.has('management')) refreshManagement(true);
    if(dirty.has('map')) updateMapData();
    dirty.clear();
  }
  return {invalidate,flush};
})();
function markUiDirty(...views){ NextRender.invalidate(...views); }
function flushUiDirty(){ NextRender.flush(); }

function datetimeLocalValue(timestamp){
  const d=new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const managementContentHome=document.querySelector('.management-content');
const embeddedManagementPages=new Map([...document.querySelectorAll('[data-management-content]')].map(element=>[
  element.dataset.managementContent,{element,parent:element.parentNode,next:element.nextSibling}
]));

const baseSettleSelected=settleSelected;
const baseSettleSelectedFlight=settleSelectedFlight;
settleSelected=function(acId){
  contextMode='context';
  const result=baseSettleSelected(acId);
  markUiDirty('desk');
  return result;
};
settleSelectedFlight=function(flightId){
  contextMode='context';
  const result=baseSettleSelectedFlight(flightId);
  markUiDirty('desk');
  return result;
};

function clearOperationalSelection(){
  selectedFlightId=null;
  selectedAircraftId=null;
  contextMode='context';
  markUiDirty('context','desk','left','schedule','filter','map');
}

workspaceUi.collapsed??={occ:{}};
workspaceUi.collapsed.occ??={};
workspaceUi.collapsed.rail??={};
workspaceUi.nextDeskPanels??={};
workspaceUi.nextActiveIncidentId??='';
workspaceUi.incidentFilter??='actionable';
workspaceUi.dismissedWarnings??={};
workspaceUi.operationFilter??={airports:[],activeIncidents:false,delayed:false,weatherCell:null};
workspaceUi.operationFilter.airports=Array.isArray(workspaceUi.operationFilter.airports)
  ? workspaceUi.operationFilter.airports.filter(code=>AIRPORTS[code])
  : workspaceUi.operationFilter.airport&&AIRPORTS[workspaceUi.operationFilter.airport]?[workspaceUi.operationFilter.airport]:[];
workspaceUi.operationFilter.airport='';
workspaceUi.operationFilter.activeIncidents=Boolean(workspaceUi.operationFilter.activeIncidents);
workspaceUi.operationFilter.delayed=Boolean(workspaceUi.operationFilter.delayed);
workspaceUi.operationFilter.weatherCell??=null;

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
function responseTimeLabel(record,now=simNow()){
  if(!record) return '';
  if(record.status==='confirmed') return `confirmed ${shortClock(record.completedAt||record.updatedAt)}`;
  const remaining=Math.max(0,(Number(record.confirmsAt)||now)-now);
  return remaining ? `response in ${formatDuration(remaining)}` : 'awaiting confirmation';
}
function formatPct(value){ return `${Math.round(clamp(Number(value)||0,0,1)*100)}%`; }
function selectedOperatingCalendar(){ return {days:[],months:[]}; }
function currentScheduleFares(){
  if(!AIRPORTS[originEl.value]||!AIRPORTS[destEl.value]||originEl.value===destEl.value) return {economy:0,business:0,first:0};
  const km=distanceKm(AIRPORTS[originEl.value],AIRPORTS[destEl.value]);
  const economy=Math.max(60,Math.round(45+km*.105));
  return {economy,business:Math.round(economy*2.65),first:Math.round(economy*5.2)};
}
function saveWorkspaceUi(){ localStorage.setItem(WORKSPACE_UI_KEY,JSON.stringify(workspaceUi)); }
function operationFilter(){
  workspaceUi.operationFilter??={airports:[],activeIncidents:false,delayed:false,weatherCell:null};
  if(!Array.isArray(workspaceUi.operationFilter.airports)) workspaceUi.operationFilter.airports=[];
  return workspaceUi.operationFilter;
}
function operationFilterSummary(){
  const filter=operationFilter();
  return [
    ...(filter.airports||[]),
    filter.activeIncidents?'incidents':'',
    filter.delayed?'delayed':'',
    filter.weatherCell?.id||''
  ].filter(Boolean).join('|');
}
function operationFilterActive(){
  const filter=operationFilter();
  return Boolean(filter.airports?.length||filter.activeIncidents||filter.delayed||filter.weatherCell?.id);
}
function operationFilterAirportCodes(){
  const used=new Set();
  for(const flight of state.flights||[]){
    if(flight.cancelled) continue;
    used.add(flight.from);
    used.add(flightOperationalDestination(flight));
  }
  Object.keys(state.personnel.assignments||{}).forEach(code=>used.add(code));
  state.slotRights?.forEach(right=>used.add(right.airport));
  return [...used].filter(code=>AIRPORTS[code]).sort();
}
function activeIncidentFlightIds(){
  return new Set((state.incidents||[])
    .filter(incident=>incident.status==='open'&&incident.flightId)
    .map(incident=>incident.flightId));
}
function flightDelayedForFilter(flight){
  if(!flight||flight.cancelled) return false;
  const threshold=5*MIN;
  const isOperationallyDelayed=['delayed','airborne'].includes(statusOfFlight(flight))&&flightTotalDepartureDelayMin(flight)>=5;
  return Math.abs(flightActualDeparture(flight)-flight.departure)>=threshold ||
    Math.abs(flightActualArrival(flight)-flight.arrival)>=threshold ||
    Boolean(flight.slotMissed) ||
    isOperationallyDelayed;
}
function weatherFilterFlightIds(now=simNow()){
  const filter=operationFilter();
  const cellId=filter.weatherCell?.id;
  if(!cellId||!window.AeroWeatherEngine?.routeHazards) return new Set();
  const period=Math.floor(now/(30*MIN));
  const flights=(state.flights||[]).filter(flight=>!flight.cancelled&&!flight.settled&&flightActualArrival(flight)>now-2*HOUR);
  const key=[
    cellId,period,
    flights.map(flight=>`${flight.id}:${flight.from}:${flightOperationalDestination(flight)}:${flightActualDeparture(flight)}:${flightActualArrival(flight)}`).join(',')
  ].join('|');
  if(operationFilterCache.key===key) return operationFilterCache.weatherFlightIds;
  const ids=new Set();
  for(const flight of flights){
    const hazards=window.AeroWeatherEngine.routeHazards(flight.from,flightOperationalDestination(flight),now)||[];
    if(hazards.some(cell=>cell.id===cellId)) ids.add(flight.id);
  }
  operationFilterCache={key,weatherFlightIds:ids,weatherCount:ids.size};
  return ids;
}
function flightMatchesOperationFilter(flight,now=simNow(),prepared=null){
  if(!flight||flight.cancelled) return false;
  const filter=operationFilter();
  const airportSet=prepared?.airportSet||new Set(filter.airports||[]);
  if(airportSet.size&&!airportSet.has(flight.from)&&!airportSet.has(flightOperationalDestination(flight))) return false;
  if(filter.activeIncidents&&!(prepared?.activeIncidentIds||activeIncidentFlightIds()).has(flight.id)) return false;
  if(filter.delayed&&!flightDelayedForFilter(flight)) return false;
  if(filter.weatherCell?.id&&!(prepared?.weatherFlightIds||weatherFilterFlightIds(now)).has(flight.id)) return false;
  return true;
}
function filterFlightsForOperations(flights,now=simNow()){
  if(!operationFilterActive()) return flights;
  const filter=operationFilter();
  const prepared={
    airportSet:new Set(filter.airports||[]),
    activeIncidentIds:activeIncidentFlightIds(),
    weatherFlightIds:weatherFilterFlightIds(now)
  };
  return flights.filter(flight=>flightMatchesOperationFilter(flight,now,prepared));
}
function applyOperationFilter(update={}){
  const filter=operationFilter();
  if('airports' in update) filter.airports=Array.isArray(update.airports)?[...new Set(update.airports)].filter(code=>AIRPORTS[code]):[];
  if('airport' in update&&update.airport&&AIRPORTS[update.airport]&&!filter.airports.includes(update.airport)) filter.airports.push(update.airport);
  if('removeAirport' in update) filter.airports=filter.airports.filter(code=>code!==update.removeAirport);
  if('activeIncidents' in update) filter.activeIncidents=Boolean(update.activeIncidents);
  if('delayed' in update) filter.delayed=Boolean(update.delayed);
  if('weatherCell' in update) filter.weatherCell=update.weatherCell?{
    id:update.weatherCell.id,
    label:update.weatherCell.label||'Weather cell',
    type:update.weatherCell.type||'weather',
    severity:update.weatherCell.severity||'caution',
    delayMin:Number(update.weatherCell.delayMin)||0
  }:null;
  operationFilterCache={key:'',weatherFlightIds:new Set(),weatherCount:0};
  saveWorkspaceUi();
  markUiDirty('filter','left','schedule','map','header');
}
function setOperationsAirportFilter(code){
  applyOperationFilter({airport:code||''});
  if(code) toast(`Filtered flights touching ${code}.`);
}
function setOperationsWeatherFilter(cell){
  applyOperationFilter({weatherCell:cell||null});
  if(cell) toast(`Filtered flights affected by ${cell.label||cell.id}.`);
}
function operationFilterWeatherCellId(){
  return operationFilter().weatherCell?.id||'';
}
function clearOperationFilters(){ applyOperationFilter({airports:[],activeIncidents:false,delayed:false,weatherCell:null}); }
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
function setIncidentFilter(filter){
  workspaceUi.incidentFilter=['actionable','today','watch','all'].includes(filter)?filter:'actionable';
  workspaceUi.nextActiveIncidentId='';
  setDeskOpen('incidents',true,{persist:false});
  saveWorkspaceUi();
}
function closeFlightPlanningWidget(){ setDeskPanel('planning',''); markUiDirty('desk'); }
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
  if(nextWorkspace==='operations') requestAnimationFrame(()=>{ invalidateMapSize(); markUiDirty('schedule','map'); });
  else refreshManagement(true);
}

function restoreEmbeddedManagementPages(scope=null){
  for(const {element,parent,next} of embeddedManagementPages.values()){
    if(scope&&!scope.contains(element)) continue;
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
  if(flight.positioningBlocked){
    const context=aircraftOutOfPositionContextForFlight(flight);
    return {label:`Aircraft expected ${context?.expectedLocation||'elsewhere'}, not ${flight.from}`,critical:true};
  }
  const slot=flightSlotImpactState(flight);
  if(slot.impacted) return {label:`Departure slot ${slot.actualMissed?'missed':'at risk'} · ${flight.slotDelayMin||0} min wait`,critical:false};
  if(flight.weatherDelayMin) return {label:`Weather · ${flight.weatherDelayMin} min`,critical:false};
  if(flight.nightRestrictionConflictDelayMin) return {label:`Night curfew decision required · ${flight.nightRestrictionConflictDelayMin} min`,critical:true};
  if(flight.nightRestrictionDelayMin) return {label:`${flight.nightRestrictionLabel||'Night operations'} · ${flight.nightRestrictionDelayMin} min`,critical:false};
  if(flight.airportDelayMin||flight.airspaceDelayMin) return {label:`Network restriction · ${(flight.airportDelayMin||0)+(flight.airspaceDelayMin||0)} min`,critical:false};
  if(flight.handlingDelayMin) return {label:`${flight.handlingDelayCause||'Ground handling'} · ${flight.handlingDelayMin} min`,critical:false};
  const delay=flightTotalDepartureDelayMin(flight);
  return delay?{label:`Departure delayed ${delay} min`,critical:false}:null;
}

function flightSlotImpactState(flight,t=simNow()){
  if(!flight?.slotMissed) return {impacted:false,actualMissed:false,state:'planned',label:'SLOT',readiness:'Slot planned'};
  const cfg=AIRPORT_OPS[flight.from] || {graceMin:10};
  const graceMin=Number(cfg.graceMin)||10;
  const actualMissed=t>=flight.departure+graceMin*MIN;
  return {
    impacted:true,actualMissed,state:actualMissed?'missed':'risk',
    label:actualMissed?'MISSED':'RISK',
    readiness:flight.assignedSlot?`${actualMissed?'Slot':'Slot risk'} ${shortClock(flight.assignedSlot)}`:'Slot pending',
    title:actualMissed
      ? `${flight.from} planned slot ${shortClock(flight.departure)} missed; reassigned ${shortClock(flight.assignedSlot||flightActualDeparture(flight))}`
      : `${flight.from} planned slot ${shortClock(flight.departure)} is at risk; projected reassignment ${shortClock(flight.assignedSlot||flightActualDeparture(flight))}`
  };
}

function openIncidentForAircraft(aircraftId){
  return (operationalIndex().openIncidentsByAircraft.get(aircraftId)||[])
    .find(item=>!item.flightId||item.type==='mel_defect')||null;
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

function flightFuelBarMarkup(flight){
  const context=fuelMarginContextForFlight(flight);
  if(!context) return '';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const onboard=Number(flight.fuelOnboardAtDeparture)||Number(aircraft?.fuelGallons)||Math.max(context.remainingNowGal,context.reserveGal,1);
  const remainingPct=clamp((context.remainingNowGal||0)/(onboard||1),0,1);
  const reservePct=clamp((context.reserveGal||0)/(onboard||1),0,1);
  const tone=context.remainingNowGal<context.reserveGal?'critical':context.marginPct<120?'warning':'';
  return `<section class="context-section"><h2>Fuel remaining</h2>
    <div class="fuel-progress ${tone}" title="${esc(`Remaining now ${context.remainingNowGal} gal · projected landing ${context.projectedLandingFuelGal} gal · reserve ${context.reserveGal} gal`)}">
      <div class="progress-track"><span style="width:${formatPct(remainingPct)}"></span><i style="left:${formatPct(reservePct)}"></i></div>
      <div class="progress-caption"><span>${Math.round(context.remainingNowGal||0)} gal now</span><b>${Math.round(context.projectedLandingFuelGal||0)} gal landing / ${Math.round(context.reserveGal||0)} reserve</b></div>
    </div>
  </section>`;
}

function flightListRow(flight,active=false){
  const issue=attentionForFlight(flight);
  const status=statusOfFlight(flight);
  const destination=flightOperationalDestination(flight);
  const duty=crewDutyForFlight(flight);
  const crewReady=duty.legal&&!flight.staffingBlocked&&!openIncidentsForFlight(flight.id).some(item=>item.type==='crew_sick');
  const fuelState=flight.fueled||active?'Fuel ready':'Fuel pending';
  const slot=flightSlotImpactState(flight);
  return `<button class="list-row ${issue?'needs-attention':''} ${selectedFlightId===flight.id?'selected':''}" type="button" data-next-flight="${esc(flight.id)}">
    ${issue?'<i class="attention-marker"></i>':''}
    <span class="list-primary"><span>${esc(flight.id)} · ${esc(flight.from)} → ${esc(destination)}</span><span>${active?formatPct(flightProgress(flight)):shortClock(flightActualDeparture(flight))}</span></span>
    <span class="list-secondary"><span>${esc(status==='airborne'?'Airborne':status==='taxi_out'?'Taxi out':status==='taxi_in'?'Taxi in':status==='delayed'?'Delayed':'Scheduled')}</span><span>${esc(shortDay(flightActualDeparture(flight)))}</span></span>
    <span class="list-readiness"><i class="${crewReady?'ready':'blocked'}">Crew ${crewReady?'legal':'blocked'}</i><i class="${flight.fueled||active?'ready':''}">${esc(fuelState)}</i><i class="${slot.impacted?'warning':'ready'}">${esc(slot.readiness)}</i></span>
    ${issue?`<span class="list-reason">${esc(issue.label)}</span>`:''}
    ${active?`<span class="active-progress" title="${esc(`Flight progress ${formatPct(flightProgress(flight))}`)}"><span style="width:${formatPct(flightProgress(flight))}"></span></span>`:''}
  </button>`;
}

function renderOperationFilterBar(force=false){
  const root=document.getElementById('operationFilterBar');
  if(!root) return;
  const now=simNow();
  const filter=operationFilter();
  const base=(state.flights||[]).filter(flight=>!flight.cancelled&&!flight.settled&&flightActualArrival(flight)>now-2*HOUR);
  const matched=filterFlightsForOperations(base,now);
  const airports=operationFilterAirportCodes();
  const selectedAirports=filter.airports||[];
  const weather=filter.weatherCell;
  const signature=[
    operationFilterSummary(),
    matched.length,base.length,
    airports.join(','),
    Math.floor(now/(30*MIN))
  ].join('|');
  if(!force&&signature===lastOperationFilterSignature) return;
  lastOperationFilterSignature=signature;
  root.innerHTML=`<div class="filter-title"><span>Filters</span><b>${matched.length}/${base.length} flights</b></div>
    <label class="filter-control airport-filter"><span>Airport</span><select data-operation-filter-airport>
      <option value="">Add airport</option>
      ${airports.filter(code=>!selectedAirports.includes(code)).map(code=>`<option value="${esc(code)}">${esc(code)} · ${esc(AIRPORTS[code]?.name||'Airport')}</option>`).join('')}
    </select></label>
    ${selectedAirports.map(code=>`<button class="filter-chip airport" type="button" data-remove-airport-filter="${esc(code)}" title="Remove ${esc(code)} filter"><span>${esc(code)}</span><b>&times;</b></button>`).join('')}
    <button class="filter-toggle ${filter.activeIncidents?'active':''}" type="button" data-operation-filter-incidents aria-pressed="${filter.activeIncidents?'true':'false'}">Active incidents</button>
    <button class="filter-toggle ${filter.delayed?'active':''}" type="button" data-operation-filter-delayed aria-pressed="${filter.delayed?'true':'false'}">Delayed</button>
    ${weather?`<button class="filter-chip weather ${weather.severity==='severe'?'severe':'warning'}" type="button" data-clear-weather-filter title="Clear weather filter"><span>${esc(weather.label)}</span><b>${esc(weather.id)}</b></button>`:''}
    ${operationFilterActive()?'<button class="filter-clear" type="button" data-clear-operation-filters>Clear</button>':''}`;
  root.querySelector('[data-operation-filter-airport]')?.addEventListener('change',event=>applyOperationFilter({airport:event.target.value}));
  root.querySelectorAll('[data-remove-airport-filter]').forEach(button=>button.addEventListener('click',()=>applyOperationFilter({removeAirport:button.dataset.removeAirportFilter})));
  root.querySelector('[data-operation-filter-incidents]')?.addEventListener('click',()=>applyOperationFilter({activeIncidents:!operationFilter().activeIncidents}));
  root.querySelector('[data-operation-filter-delayed]')?.addEventListener('click',()=>applyOperationFilter({delayed:!operationFilter().delayed}));
  root.querySelector('[data-clear-weather-filter]')?.addEventListener('click',()=>applyOperationFilter({weatherCell:null}));
  root.querySelector('[data-clear-operation-filters]')?.addEventListener('click',clearOperationFilters);
}

function refreshOccWidgets(force=false){
  const now=simNow();
  const index=operationalIndex(now);
  const active=filterFlightsForOperations(index.activeFlights,now);
  const signature=[selectedFlightId,operationFilterSummary(),active.map(f=>`${f.id}:${attentionForFlight(f)?.label||''}:${Math.floor(flightProgress(f)*50)}`).join('|')].join('::');
  if(!force&&signature===lastFlightListSignature) return;
  lastFlightListSignature=signature;
  const activeFlightCount=document.getElementById('activeFlightCount');
  if(activeFlightCount) activeFlightCount.textContent=active.length;
  const filterNote=operationFilterActive()?' match the current filter':'';
  const activeFlightList=document.getElementById('activeFlightList');
  if(activeFlightList) activeFlightList.innerHTML=active.length?active.map(f=>flightListItem(f,true)).join(''):`<div class="empty-state">No airborne flights${filterNote}.</div>`;
  refreshRailCollapseState();
  document.querySelectorAll('[data-next-flight]').forEach(button=>button.addEventListener('click',()=>{
    if(selectedFlightId===button.dataset.nextFlight){ clearOperationalSelection(); return; }
    contextMode='context'; settleSelectedFlight(button.dataset.nextFlight);
  }));
  bindLeftInlineDetails();
}

function refreshFleetList(force=false){
  const index=operationalIndex();
  const signature=[selectedAircraftId,selectedFlightId,state.aircraft.map(ac=>{
    const active=index.activeFlightByAircraft.get(ac.id),next=index.upcomingFlightByAircraft.get(ac.id);
    return `${ac.id}:${ac.location}:${active?.id||''}:${next?.id||''}:${attentionForAircraft(ac)}`;
  }).join('|')].join('::');
  if(!force&&signature===lastAircraftListSignature) return;
  lastAircraftListSignature=signature;
  document.getElementById('aircraftListCount').textContent=state.aircraft.length;
  document.getElementById('aircraftList').innerHTML=state.aircraft.length?state.aircraft.map(aircraft=>aircraftListItem(aircraft,index)).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  refreshRailCollapseState();
  document.querySelectorAll('[data-next-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    if(selectedAircraftId===button.dataset.nextAircraft&&!selectedFlightId){ clearOperationalSelection(); return; }
    contextMode='context'; settleSelected(button.dataset.nextAircraft);
  }));
  bindLeftInlineDetails();
}

function maintenanceRailItem(aircraft,now=simNow()){
  const status=Management.maintenanceStatus(aircraft,now);
  const condition=clamp(Math.round(aircraft.condition??100),0,100);
  const mel=(aircraft.melItems||[]).filter(item=>['open','expired'].includes(item.status));
  const tone=condition<50||status.grounding?'critical':condition<75||status.due?'warning':'';
  const selected=selectedAircraftId===aircraft.id&&!selectedFlightId;
  const attention=status.grounding||status.due||status.active||mel.length;
  const job=status.scheduled;
  const title=`Condition ${condition}% · ${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles remaining${mel.length?` · ${mel.length} MEL item${mel.length===1?'':'s'}`:''}`;
  const action=job
    ? `<button class="desk-action-link" type="button" data-cancel-check="${esc(aircraft.id)}" ${status.active?'disabled':''}>${status.active?'Check in progress':'Cancel check'}</button>`
    : `<button class="desk-action-link" type="button" data-schedule-check="${esc(aircraft.id)}">Schedule check</button>`;
  return `<article class="left-list-card maintenance-rail-card ${selected?'selected':''} ${attention?'needs-attention':''}">
    <button class="list-row maintenance-rail-row ${tone} ${attention?'needs-attention':''} ${selected?'selected':''}" type="button" data-maintenance-aircraft="${esc(aircraft.id)}" title="${esc(title)}">
      ${attention?'<i class="attention-marker"></i>':''}
      <span class="list-primary"><span>${esc(aircraft.tail)}</span><span>${condition}%</span></span>
      <span class="list-secondary"><span>${esc(status.label)}</span><span>${esc(aircraft.location)}</span></span>
      <span class="maintenance-limit">${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles${job?` · ${shortDay(job.start)} ${shortClock(job.start)}`:''}</span>
      <span class="progress-track"><span style="width:${formatPct(condition/100)}"></span></span>
    </button>
    <div class="maintenance-rail-actions">${action}</div>
  </article>`;
}

function refreshMaintenanceRail(force=false){
  const now=simNow();
  const rows=state.aircraft.slice().sort((a,b)=>{
    const aSelected=a.id===selectedAircraftId?-100:0,bSelected=b.id===selectedAircraftId?-100:0;
    const aStatus=Management.maintenanceStatus(a,now),bStatus=Management.maintenanceStatus(b,now);
    const aScore=(aStatus.grounding?0:aStatus.due?1:aStatus.active?2:(a.condition??100)<75?3:4)+aSelected;
    const bScore=(bStatus.grounding?0:bStatus.due?1:bStatus.active?2:(b.condition??100)<75?3:4)+bSelected;
    return aScore-bScore||a.tail.localeCompare(b.tail);
  }).slice(0,6);
  const issues=state.aircraft.filter(ac=>{
    const status=Management.maintenanceStatus(ac,now);
    return status.grounding||status.due||status.active||(ac.melItems||[]).some(item=>['open','expired'].includes(item.status));
  }).length;
  const signature=[
    selectedAircraftId||'',selectedFlightId||'',issues,
    rows.map(ac=>{
      const status=Management.maintenanceStatus(ac,now);
      return `${ac.id}:${ac.location}:${Math.round(ac.condition??100)}:${status.label}:${Math.round(status.remainingHours)}:${Math.round(status.remainingCycles)}:${status.active?1:0}`;
    }).join('|')
  ].join('::');
  if(!force&&signature===lastMaintenanceListSignature) return;
  lastMaintenanceListSignature=signature;
  const count=document.getElementById('maintenanceListCount');
  if(count) count.textContent=issues;
  const list=document.getElementById('maintenanceList');
  if(list) list.innerHTML=rows.length?rows.map(ac=>maintenanceRailItem(ac,now)).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  refreshRailCollapseState();
  document.querySelectorAll('[data-maintenance-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    if(selectedAircraftId===button.dataset.maintenanceAircraft&&!selectedFlightId){ clearOperationalSelection(); return; }
    contextMode='context'; settleSelected(button.dataset.maintenanceAircraft);
  }));
  list?.querySelectorAll('[data-schedule-check]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    scheduleAircraftMaintenance(button.dataset.scheduleCheck);
  }));
  list?.querySelectorAll('[data-cancel-check]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    cancelAircraftMaintenance(button.dataset.cancelCheck);
  }));
}

function corporateResourcesMarkup(activeRequests){
  return `${deskActionBar('corporate',[
      {panel:'planning',label:'Plan flight'},
      {panel:'aircraft',label:'Request aircraft'},
      {panel:'personnel',label:'Request personnel'},
      {panel:'remove-schedule',label:'Remove schedule'}
    ])}
    ${deskPanelMarkup('corporate','planning','Plan flight')}
    ${deskPanelMarkup('corporate','aircraft','Request aircraft')}
    ${deskPanelMarkup('corporate','personnel','Request personnel')}
    ${deskPanelMarkup('corporate','remove-schedule','Remove schedule',removeSchedulePanelMarkup())}
    ${resourceActivityMarkup(activeRequests,[],'Resource requests') || '<div class="empty-state">No corporate resource requests underway.</div>'}`;
}

function refreshCorporateResources(force=false){
  const activeRequests=(state.resourceRequests||[]).filter(item=>!['delivered','cancelled'].includes(item.status));
  const activePanel=activeDeskPanel('corporate');
  const signature=[
    activePanel,
    activeRequests.map(item=>`${item.id}:${item.kind}:${item.status}:${item.readyAt}:${item.location||''}`).join('|'),
    (state.services||[]).map(service=>`${service.id}:${service.active?1:0}:${service.aircraftId}:${service.nextDeparture}`).join('|'),
    state.aircraft.map(ac=>`${ac.id}:${ac.location}:${ac.tail}`).join('|'),
    JSON.stringify(state.personnel.assignments||{}),
    Math.floor(simNow()/MIN)
  ].join('::');
  if(!force&&signature===lastCorporateResourcesSignature) return;
  lastCorporateResourcesSignature=signature;
  const count=document.getElementById('corporateResourceCount');
  if(count) count.textContent=activeRequests.length;
  const root=document.getElementById('corporateResourcesList');
  if(!root) return;
  restoreEmbeddedManagementPages(root);
  root.innerHTML=corporateResourcesMarkup(activeRequests);
  mountOccManagementPages(root);
  refreshRailCollapseState();
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-remove-schedule]').forEach(button=>button.addEventListener('click',()=>{
    const panel=button.closest('[data-active-desk-panel]');
    const selection=panel?.querySelector('[data-remove-schedule-select]')?.value;
    if(removeScheduleSelection(selection)){
      setDeskPanel(panel?.dataset.activeDesk||'corporate','');
      markUiDirty('all');
    }
  }));
  refreshManagement(true);
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

function crewDutyProgressMarkup(duty){
  if(!duty) return '';
  const now=simNow(),start=duty.reportAt??duty.dutyStart,end=duty.releaseAt??duty.dutyEnd;
  if(start==null||end==null||end<=start) return '';
  const elapsed=clamp((now-start)/(end-start),0,1);
  const margin=Number(duty.maxHours||0)-Number(duty.dutyHours||0);
  const tone=!duty.legal?'critical':margin<1.5?'warning':'';
  const title=`Report ${shortClock(start)} · release ${shortClock(end)} · duty ${Number(duty.dutyHours||0).toFixed(1)} h of ${Number(duty.maxHours||0).toFixed(1)} h max · ${duty.sectors||1} sector${(duty.sectors||1)===1?'':'s'}`;
  return `<div class="crew-duty-progress ${tone}" title="${esc(title)}">
    <div class="progress-track"><span style="width:${formatPct(elapsed)}"></span></div>
    <div class="progress-caption"><span>Crew duty</span><b>rel ${shortClock(end)}</b></div>
  </div>`;
}

function flightWeatherForecastMarkup(flight){
  const destination=flightOperationalDestination(flight);
  const now=simNow();
  const forecastTime=flightActualDeparture(flight)<=now&&now<flightActualArrival(flight)?now:flightActualDeparture(flight);
  const origin=Management.weatherAt(flight.from,forecastTime);
  const destinationWeather=Management.weatherAt(destination,flightActualArrival(flight));
  const routeWeather=window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,destination,forecastTime)||{hazards:[],delayMin:0,level:'normal',label:''};
  const hazards=(routeWeather.hazards||[]).slice(0,2);
  const routeTone=routeWeather.level==='severe'?'critical':routeWeather.level==='caution'?'warning':'';
  const routeText=hazards.length
    ? hazards.map(item=>`${item.label} ${item.severity==='severe'?'severe':'watch'} +${item.delayMin}m`).join(' · ')
    : 'No significant enroute cells';
  const originTitle=`${origin.conditions} · wind ${origin.windDirection}°/${origin.windKph}G${origin.gustKph} km/h · vis ${origin.visibilityKm} km · ceiling ${origin.ceilingFt} ft`;
  const destinationTitle=`${destinationWeather.conditions} · wind ${destinationWeather.windDirection}°/${destinationWeather.windKph}G${destinationWeather.gustKph} km/h · vis ${destinationWeather.visibilityKm} km · ceiling ${destinationWeather.ceilingFt} ft`;
  const routeTitle=hazards.length
    ? hazards.map(item=>`${item.id} · ${item.label} · ${item.severity} · +${item.delayMin} min · ${Math.round(item.distanceKm||0)} km from route`).join(' | ')
    : 'No active weather polygons intersect this planned route.';
  return `<section class="context-section flight-weather-forecast"><h2>Forecast weather</h2>
    <div class="weather-forecast-row ${origin.level==='severe'?'critical':origin.level==='caution'?'warning':''}" title="${esc(originTitle)}"><span>${weatherIcon(origin)} ${esc(flight.from)}</span><b>${esc(origin.conditions)} · ${Math.round(origin.capacityFactor*100)}%</b></div>
    <div class="weather-forecast-row ${routeTone}" title="${esc(routeTitle)}"><span>Route</span><b>${esc(routeText)}</b></div>
    <div class="weather-forecast-row ${destinationWeather.level==='severe'?'critical':destinationWeather.level==='caution'?'warning':''}" title="${esc(destinationTitle)}"><span>${weatherIcon(destinationWeather)} ${esc(destination)}</span><b>${esc(destinationWeather.conditions)} · ETA ${shortClock(flightActualArrival(flight))}</b></div>
  </section>`;
}

function flightInlineDetailsMarkup(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const issue=attentionForFlight(flight);
  const incident=issue?.incident;
  const duty=crewDutyForFlight(flight);
  const ground=groundOperationsForFlight(flight);
  const now=simNow();
  const operation=flightActualArrival(flight)<=now?{flight,phase:ground?.postflight}:flightActualDeparture(flight)>now?{flight,phase:ground?.departure}:null;
  const delay=flightTotalDepartureDelayMin(flight);
  const active=flightActualDeparture(flight)<=now&&now<flightActualArrival(flight);
  return `<article class="left-inline-details" data-left-flight-details="${esc(flight.id)}">
    ${issue?`<section class="attention-summary ${issue.critical?'critical':'warning'}"><b>${esc(issue.label)}</b>${incident?`<span>${esc(incidentCopy(incident).summary)}</span>`:''}</section>`:''}
    <div class="fact-grid">${fact('Scheduled',`${shortClock(flight.departure)}-${shortClock(flight.arrival)}`)}${fact('Expected',`${shortClock(flightActualDeparture(flight))}-${shortClock(flightActualArrival(flight))}`)}${fact('Delay',delay?`+${delay} min`:'On time')}${fact('Aircraft',aircraft?`${aircraft.tail} · ${aircraft.model}`:'Unassigned')}</div>
    ${flightWeatherForecastMarkup(flight)}
    <section class="context-section"><h2>Ground progress</h2>${operation?phaseMarkup(operation):flightActualDeparture(flight)<=now&&now<flightActualArrival(flight)?`<div class="simple-row"><span>Current phase</span><b>${esc(statusOfFlight(flight,now)==='taxi_out'?'Taxi out':statusOfFlight(flight,now)==='taxi_in'?'Taxi in':'Airborne')}</b></div>`:phaseMarkup(null)}</section>
    ${active?flightFuelBarMarkup(flight):''}
    <section class="context-section"><h2>Crew duty</h2>${active?crewDutyProgressMarkup(duty):''}<div class="simple-row"><span>Planned duty</span><b>${Number(duty.dutyHours||0).toFixed(1)} h / ${Number(duty.maxHours||0).toFixed(1)} h</b></div><div class="simple-row"><span>Sectors</span><b>${duty.sectors||1}${rotationUsesThroughCrew(flight)?' · through crew':''}</b></div><div class="simple-row"><span>Legality</span><b>${duty.legal?'Within limit':'Limit exceeded'}</b></div></section>
    ${aircraft?`<section class="context-section"><button class="object-link" type="button" data-context-aircraft="${esc(aircraft.id)}"><span>Assigned aircraft</span><b>${esc(aircraft.tail)} →</b></button></section>`:''}
  </article>`;
}

function aircraftInlineDetailsMarkup(aircraft){
  const active=aircraftActiveFlight(aircraft.id),upcoming=aircraftUpcomingFlight(aircraft.id);
  const incident=openIncidentForAircraft(aircraft.id);
  const maintenance=Management.maintenanceStatus(aircraft,simNow());
  const ground=aircraftGroundOperation(aircraft);
  const fuel=aircraftFuelPerformance(MODELS[aircraft.model]);
  const turnStation=active?flightOperationalDestination(active):(upcoming?upcoming.from:aircraft.location);
  const baseTurn=Number(MODELS[aircraft.model]?.minimumTurnMin)||minimumTurnMinutes(aircraft,turnStation);
  const stationTurn=minimumTurnMinutes(aircraft,turnStation);
  const turnLabel=stationTurn===baseTurn?`${stationTurn} min`:`${stationTurn} min at ${turnStation}`;
  return `<article class="left-inline-details" data-left-aircraft-details="${esc(aircraft.id)}">
    ${incident?`<section class="attention-summary critical"><b>${esc(incidentCopy(incident).title)}</b><span>${esc(incidentCopy(incident).summary)}</span></section>`:''}
    <div class="fact-grid">${fact('Location',active?`${active.from} → ${flightOperationalDestination(active)}`:aircraft.location)}${fact('Condition',`${Math.round(aircraft.condition??100)}%`)}${fact('Utilisation',`${Math.round(aircraft.flightHours||0)} h · ${aircraft.cycles||0} cycles`)}${fact('Fuel',`${Math.round(aircraft.fuelGallons||0)} / ${Math.round(fuel.fuelCapacityGal)} gal`)}${fact('Min turn',turnLabel)}</div>
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

function aircraftListItem(aircraft,index=operationalIndex()){
  const active=index.activeFlightByAircraft.get(aircraft.id),next=index.upcomingFlightByAircraft.get(aircraft.id),issue=attentionForAircraft(aircraft);
  const place=active?`${active.from} → ${flightOperationalDestination(active)}`:aircraft.location;
  const sub=active?`Airborne · ${active.id}`:next?`Next ${next.id} · ${shortClock(flightActualDeparture(next))}`:'Available';
  const now=index.t||simNow();
  const rotation=(index.flightsByAircraft.get(aircraft.id)||[]).filter(f=>flightActualDeparture(f)>now&&flightActualDeparture(f)<=now+24*HOUR).slice(0,2);
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
    selectedFlightId=null; selectedAircraftId=null; contextMode='context'; markUiDirty('context','left','schedule','map','desk');
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
  selectedFlightId=task.flightId; selectedAircraftId=task.aircraftId;
  contextMode='context';
  markUiDirty('context','desk','left','schedule','map');
  requestAnimationFrame(()=>{
    const card=document.querySelector(`[data-inline-task="${CSS.escape(task.id)}"]`);
    card?.scrollIntoView({behavior:'smooth',block:'center'});
    card?.classList.add('attention-pulse');
  });
}

function prefillPositioningFerryPlanner(incident){
  const plan=positioningFerryPlanState(incident);
  if(!plan.flight||!plan.aircraft) return toast(plan.reason||'No positioning plan is available.');
  setDeskOpen('planning',true,{persist:false});
  setDeskPanel('planning','planning',{toggle:false});
  refreshAircraftSelect(true);
  scheduleTypeEl.value='ferry';
  aircraftEl.value=plan.aircraft.id;
  originEl.value=plan.from;
  destEl.value=plan.to;
  const estimate=estimateFerryFlight(plan.from,plan.to,plan.aircraft,simNow());
  const latest=flightActualDeparture(plan.flight)-minimumTurnMinutes(plan.aircraft,plan.to)*MIN-(estimate.duration||45*MIN);
  const departure=Math.max(simNow()+15*MIN,Math.min(latest,flightActualDeparture(plan.flight)-45*MIN));
  departureTimeEl.value=hhmm(departure);
  refreshScheduleMode();
  refreshSchedulePreview();
  markUiDirty('desk','selects');
  document.getElementById('occ-desk-planning')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Ferry planner staged for ${plan.aircraft.tail}: ${plan.from} → ${plan.to}.`);
}

function prefillCrewRelocationPlanner(incident){
  const plan=crewRelocationPlanState(incident);
  if(!plan.flight) return toast(plan.reason||'No crew movement plan is available.');
  setDeskOpen('personnel',true,{persist:false});
  setDeskPanel('personnel','relocation',{toggle:false});
  const roleEl=document.getElementById('transferPersonnelRole');
  const fromEl=document.getElementById('transferPersonnelFrom');
  const toEl=document.getElementById('transferPersonnelTo');
  const amountEl=document.getElementById('transferPersonnelAmount');
  if(roleEl) roleEl.value=plan.role;
  if(fromEl&&plan.from) fromEl.value=plan.from;
  if(toEl) toEl.value=plan.to;
  if(amountEl) amountEl.value=1;
  refreshPersonnelTransferOptions();
  markUiDirty('desk','selects');
  document.getElementById('occ-desk-personnel')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Personnel move staged: ${PERSONNEL[plan.role]?.label||'Crew'}${plan.from?` ${plan.from}`:''} → ${plan.to}.`);
}

function taskActions(task,incident){
  if(['in_progress','waiting_external'].includes(task.status)){
    const progress=OperationalWorkflows.progress(task,simNow());
    const remaining=Math.max(0,Math.ceil(((task.completesAt||simNow())-simNow())/MIN));
    const label=task.kind==='crew_report'?'Crew response pending':task.kind==='crew_augmentation'?'Augmentation response pending':task.status==='waiting_external'?'Request sent':'Work underway';
    return `<div class="task-waiting"><b>${esc(label)}</b><span>${esc(task.pendingOutcome||task.detail)} · <em data-inline-task-remaining>${remaining} min remaining</em></span><div class="progress-track"><span data-inline-task-progress style="width:${formatPct(progress)}"></span></div></div>`;
  }
  if(task.kind==='manual_crew_move_required'){
    const plan=crewRelocationPlanState(incident);
    return `<div class="task-form">
      <div class="attention-summary ${plan.ready?'':'warning'}"><b>${plan.ready?'Crew move detected':'Manual crew move required'}</b><span>${esc(plan.reason)}</span></div>
      <div class="form-actions"><button class="secondary-button" type="button" data-task-action="open-crew-relocation">Open Personnel move</button><button class="primary-button" type="button" data-task-action="check-crew-move" ${plan.ready?'':'disabled'}>Check crew move</button></div>
    </div>`;
  }
  const blocker=['technical_strategy','recovery_strategy'].includes(task.kind)?'':taskResourceBlocker(task,incident);
  if(blocker) return `<div class="attention-summary critical"><b>Resource unavailable</b><span>${esc(blocker)}</span></div>`;
  if(task.kind==='crew_allocation'){
    const options=crewPoolOptions(incident);
    return options.length?`<div class="task-form"><label>Qualified local reserve<select data-task-crew-pool>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="allocate">Activate selected crew</button></div>`:'<div class="attention-summary critical"><b>No qualified crew available</b><span>Request or position qualified personnel in the Personnel desk, then return to this task.</span></div>';
  }
  if(task.kind==='authority_decision'){
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const options=task.strategyOptions||[];
    const cancelOption=options.find(option=>option.id==='cancel');
    const optionLabels=options.filter(option=>option.id!=='cancel').map(option=>`<span>${esc(option.label||option.id)}</span>`).join('');
    const cancelBlocker=cancelOption?branchStrategyOptionBlocker(task,incident,'cancel'):'';
    const cancelConsequence=cancelOption?operationalOptionConsequence(task,incident,'cancel'):'';
    const cancelCost=cancelOption&&typeof costPreviewText==='function'?costPreviewText(task,incident,'cancel'):'';
    const cancelMarkup=cancelOption&&!flight?.departureLogged
      ? `<button class="choice-button danger" type="button" data-task-action="cancel" ${cancelBlocker?'disabled':''}><b>${esc(cancelOption.label)}</b><span>${esc(cancelBlocker||cancelOption.detail)}</span>${cancelConsequence?`<em class="choice-consequence">${esc(cancelConsequence)}</em>`:''}${cancelCost?`<em class="choice-cost">${esc(cancelCost)}</em>`:''}</button>`
      : '';
    return `<div class="authority-task"><button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>${optionLabels?`<div>${optionLabels}</div>`:''}${cancelMarkup}</div>`;
  }
  if(task.kind==='technical_strategy'||task.kind==='recovery_strategy'){
    const fallback=[{id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},{id:'repair',label:'Repair aircraft',detail:'Ground the aircraft for engineering sign-off.'},{id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}];
    const flight=state.flights.find(item=>item.id===incident?.flightId&&!item.cancelled);
    const options=(task.strategyOptions||fallback).filter(option=>!(option.id==='cancel'&&flight?.departureLogged));
    return `<div class="choice-list">${options.map(option=>{
      const optionBlocker=branchStrategyOptionBlocker(task,incident,option.id);
      const consequence=operationalOptionConsequence(task,incident,option.id);
      const cost=typeof costPreviewText==='function'?costPreviewText(task,incident,option.id):'';
      return `<button class="choice-button ${option.id==='cancel'?'danger':''}" type="button" data-task-action="${esc(option.id)}" ${optionBlocker?'disabled':''}><b>${esc(option.label||option.id)}</b><span>${esc(optionBlocker||option.detail||'Select this recovery path.')}</span>${consequence?`<em class="choice-consequence">${esc(consequence)}</em>`:''}${cost?`<em class="choice-cost">${esc(cost)}</em>`:''}</button>`;
    }).join('')}</div>`;
  }
  if(task.kind==='maintenance_disposition') return `<div class="choice-list"><button class="choice-button" type="button" data-task-action="defer"><b>Defer under MEL</b><br>Document restrictions and continue if permitted.</button><button class="choice-button" type="button" data-task-action="repair"><b>Repair aircraft</b><br>Ground the aircraft while engineering completes the repair.</button></div>`;
  if(task.kind==='maintenance_defer') return `<button class="primary-button" type="button" data-task-action="defer">Confirm MEL deferral</button>`;
  if(task.kind==='maintenance_repair') return `<button class="primary-button" type="button" data-task-action="repair">Start repair</button>`;
  if(task.kind==='maintenance_clearance') return `<button class="primary-button" type="button" data-task-action="complete">Record engineering clearance</button>`;
  if(task.kind==='crew_augmentation') return `<button class="primary-button" type="button" data-task-action="complete">Start augmentation callout</button>`;
  if(task.kind==='crew_next_sector_replacement'){
    const next=nextSectorForCrewExtensionIncident(incident);
    const blocker=taskResourceBlocker(task,incident);
    return next
      ? `<div class="task-form"><div class="attention-summary ${blocker?'warning':''}"><b>${esc(next.id)} · ${esc(next.from)} → ${esc(flightOperationalDestination(next))}</b><span>${esc(blocker||'Local reserve crew is available for the next sector.')}</span></div><button class="primary-button" type="button" data-task-action="complete" ${blocker?'disabled':''}>Activate reserve crew</button></div>`
      : '<div class="attention-summary warning"><b>No next sector</b><span>Use duty-extension record or priority handling instead.</span></div>';
  }
  if(task.kind==='aircraft_substitution'){
    const options=incidentAircraftReplacementOptions(incident);
    return options.length?`<div class="task-form"><label>Replacement aircraft<select data-task-replacement-aircraft>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)} · ${esc(option.detail)}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="substitute-aircraft">Assign replacement</button></div>`:'<div class="attention-summary critical"><b>No replacement aircraft available</b><span>Request an aircraft or reposition a spare in Dispatch & slots, then return to this task.</span></div>';
  }
  if(task.kind==='manual_ferry_required'){
    const plan=positioningFerryPlanState(incident);
    return `<div class="task-form">
      <div class="attention-summary ${plan.ready?'':'warning'}"><b>${plan.ready?'Ferry plan detected':'Manual ferry required'}</b><span>${esc(plan.ready?(plan.ferry?`${plan.ferry.id} positions ${plan.aircraft.tail} to ${plan.to}.`:`${plan.aircraft?.tail||'Aircraft'} is projected at ${plan.to}.`):plan.reason)}</span></div>
      <div class="form-actions"><button class="secondary-button" type="button" data-task-action="open-ferry-planner">Open ferry planner</button><button class="primary-button" type="button" data-task-action="check-ferry" ${plan.ready?'':'disabled'}>Check ferry plan</button></div>
    </div>`;
  }
  if(task.kind==='manual_departure_change_required'){
    const plan=nightDepartureChangePlanState(incident);
    return `<div class="task-form">
      <div class="attention-summary ${plan.ready?'':'warning'}"><b>${plan.ready?'Departure clear':'Manual departure change required'}</b><span>${esc(plan.reason)}</span></div>
      <div class="form-actions"><button class="secondary-button" type="button" data-task-action="open-dispatch-actions">Open Dispatch actions</button><button class="primary-button" type="button" data-task-action="check-departure-change" ${plan.ready?'':'disabled'}>Check departure</button></div>
    </div>`;
  }
  if(task.kind==='atc_coordination') return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if(task.kind==='stand_request') return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if([
    'inbound_wait','turnaround_expedite','station_recovery','fuel_recovery','security_coordination',
    'medical_assessment','medical_coordination','flight_watch_assessment','flight_watch_coordination','fuel_monitoring','reroute_coordination','crew_extension_record',
    'performance_coordination','cabin_security_coordination','arrival_maintenance_check','destination_handling','authority_decision'
  ].includes(task.kind)) return `<button class="primary-button" type="button" data-task-action="complete">${esc(task.label)}</button>`;
  if(task.kind==='alternate_selection'){
    const options=diversionOptionsForIncident(incident,{includeReturnOrigin:false});
    return options.length?`<div class="task-form"><label>Operational alternate<select data-task-alternate>${options.map(option=>`<option value="${option.code}">${option.returnOrigin?'Return to origin':option.code} · ${option.returnOrigin?'origin airport':`${Math.round(option.destinationKm)} km from destination`} · fuel ${option.fuel.estimated?'estimated':'planned'}</option>`).join('')}</select></label><button class="primary-button" type="button" data-task-action="alternate">Select alternate</button></div>`:'<div class="attention-summary critical"><b>No suitable alternate available</b></div>';
  }
  if(task.kind==='return_origin_selection'){
    const option=diversionOptionsForIncident(incident,{onlyReturnOrigin:true})[0];
    return option?`<button class="primary-button" type="button" data-task-action="complete">Confirm return to ${esc(option.code)}</button>`:'<div class="attention-summary critical"><b>Return unavailable</b><span>Fuel, weather, or handling does not support a return right now.</span></div>';
  }
  const labels={maintenance_inspection:'Start engineering inspection',atc_coordination:task.label,flightdeck_recommendation:'Send recommendation',diversion_clearance:'Submit ATC request',alternate_handling:'Request handling',station_coordination:'Confirm coordination'};
  return `<button class="primary-button" type="button" data-task-action="complete">${esc(labels[task.kind]||'Complete task')}</button>`;
}

const TASK_KINDS_WITH_REQUIRED_INPUT=new Set([
  'crew_allocation','aircraft_substitution','alternate_selection','maintenance_disposition','manual_ferry_required','manual_crew_move_required','manual_departure_change_required'
]);

function taskCanAutoRunAfterStrategy(task,incident){
  if(!task||!incident||task.status!=='available') return false;
  if(task.kind==='technical_strategy'||task.kind==='recovery_strategy') return false;
  if(TASK_KINDS_WITH_REQUIRED_INPUT.has(task.kind)) return false;
  if(taskResourceBlocker(task,incident)) return false;
  return true;
}

function autoRunBranchFollowUps(incident,originTaskId){
  if(!incident||incident.status!=='open') return false;
  let ran=false;
  for(let guard=0;guard<6;guard++){
    unlockOperationalTasks(incident.id);
    if(incident.status!=='open') break;
    const task=incidentWorkflowProgress(incident).current;
    if(!task||task.id===originTaskId||!taskCanAutoRunAfterStrategy(task,incident)) break;
    if(!performOperationalTask(task.id,'',{})) break;
    ran=true;
    if(['in_progress','waiting_external'].includes(task.status)) break;
  }
  return ran;
}

const OCC_OWNER_LABELS={dispatch:'Dispatch',crew:'Crew Control',maintenance:'Maintenance',station:'Station Operations'};
const OCC_DESK_LABELS={planning:'Dispatch & Planning',personnel:'Personnel',maintenance:'Maintenance'};

function openOperationalIncidents(){
  const incidents=operationalIndex().openIncidents.slice().sort((a,b)=>Number(Boolean(b.blocking))-Number(Boolean(a.blocking))||(a.detectedAt||0)-(b.detectedAt||0));
  incidents.forEach(ensureIncidentWorkflow);
  return incidents;
}

function incidentFlight(incident){
  return incident?.flightId?operationalIndex().flightsById.get(incident.flightId)||null:null;
}

function incidentHasStartedWork(incident){
  return incidentTasks(incident.id).some(task=>['in_progress','waiting_external'].includes(task.status));
}

function incidentIsActionable(incident,now=simNow()){
  const flight=incidentFlight(incident);
  if(incidentHasStartedWork(incident)) return true;
  if(!flight) return incident.severity==='critical'||(incident.deadline||0)<=now;
  const dep=flightActualDeparture(flight),arr=flightActualArrival(flight);
  const airborne=flight.departureLogged&&arr>now;
  const nearDeparture=!flight.departureLogged&&dep>now&&dep<=now+6*HOUR;
  const activeTurn=arr>now-90*MIN&&dep<=now+6*HOUR;
  const criticalToday=incident.severity==='critical'&&dep<=now+24*HOUR&&arr>now-2*HOUR;
  const overdueToday=(incident.deadline||0)<=now&&dep<=now+24*HOUR&&arr>now-2*HOUR;
  return airborne||nearDeparture||activeTurn||criticalToday||overdueToday;
}

function actionableIncidentIdSet(now=simNow()){
  return new Set(state.incidents
    .filter(incident=>incident.status==='open'&&incidentIsActionable(incident,now))
    .map(incident=>incident.id));
}

function incidentDingContext(){
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context) return null;
  if(!incidentAudioContext||incidentAudioContextCtor!==Context){
    try{ incidentAudioContext=new Context(); }
    catch(_){ return null; }
    incidentAudioContextCtor=Context;
    incidentAudioReady=false;
  }
  return incidentAudioContext;
}

function playIncidentDing({retry=false}={}){
  const ctx=incidentDingContext();
  if(!ctx) return false;
  if(ctx.state==='suspended'){
    if(retry&&!incidentDingRetryTimer){
      incidentDingRetryTimer=setTimeout(()=>{
        incidentDingRetryTimer=0;
        if(incidentAudioContext?.state==='running') playIncidentDing();
      },120);
    }
    return false;
  }
  if(incidentDingRetryTimer){
    clearTimeout(incidentDingRetryTimer);
    incidentDingRetryTimer=0;
  }
  const now=ctx.currentTime;
  const gain=ctx.createGain();
  gain.gain.setValueAtTime(0.0001,now);
  gain.gain.exponentialRampToValueAtTime(0.045,now+0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+0.28);
  gain.connect(ctx.destination);

  const tone=ctx.createOscillator();
  tone.type='sine';
  tone.frequency.setValueAtTime(880,now);
  tone.frequency.setValueAtTime(1175,now+0.09);
  tone.connect(gain);
  tone.start(now);
  tone.stop(now+0.3);
  tone.addEventListener('ended',()=>gain.disconnect(),{once:true});
  return true;
}

function primeIncidentAudio(ctx){
  if(!ctx||incidentAudioReady) return;
  const now=ctx.currentTime;
  const gain=ctx.createGain();
  gain.gain.value=0.00001;
  gain.connect(ctx.destination);
  const tone=ctx.createOscillator();
  tone.frequency.value=440;
  tone.connect(gain);
  tone.start(now);
  tone.stop(now+0.02);
  tone.addEventListener('ended',()=>gain.disconnect(),{once:true});
  incidentAudioReady=true;
}

async function armIncidentDing(){
  const ctx=incidentDingContext();
  if(!ctx) return;
  try{ await ctx.resume(); }catch(_){}
  if(ctx.state==='running') primeIncidentAudio(ctx);
}

function checkActionableIncidentDing(){
  const current=actionableIncidentIdSet();
  if(!incidentSoundInitialized){
    knownActionableIncidentIds=current;
    incidentSoundInitialized=true;
    return;
  }
  const hasNew=[...current].some(id=>!knownActionableIncidentIds.has(id));
  knownActionableIncidentIds=current;
  if(hasNew) playIncidentDing({retry:true});
}

function incidentFilterBucket(incident,now=simNow()){
  if(incidentIsActionable(incident,now)) return 'actionable';
  const flight=incidentFlight(incident);
  if(!flight) return 'today';
  const dep=flightActualDeparture(flight),arr=flightActualArrival(flight);
  if(arr<=now-2*HOUR) return 'all';
  if(dep<=now+24*HOUR) return 'today';
  if(dep<=now+72*HOUR) return 'watch';
  return 'all';
}

function incidentTriageCounts(incidents,now=simNow()){
  const counts={actionable:0,today:0,watch:0,all:incidents.length};
  for(const incident of incidents){
    const bucket=incidentFilterBucket(incident,now);
    if(bucket!=='all'&&counts[bucket]!==undefined) counts[bucket]++;
  }
  return counts;
}

function filteredOperationalIncidents(incidents,filter=workspaceUi.incidentFilter,now=simNow()){
  const activeFilter=['actionable','today','watch','all'].includes(filter)?filter:'actionable';
  if(activeFilter==='all') return incidents;
  return incidents.filter(incident=>incidentFilterBucket(incident,now)===activeFilter);
}

function taskDesk(task){
  if(task.department==='crew') return 'personnel';
  if(task.department==='maintenance') return 'maintenance';
  if(task.department==='station') return 'airports';
  if(task.department==='dispatch') return 'planning';
  return 'planning';
}

function taskObjectLabel(task){
  const flight=state.flights.find(item=>item.id===task.flightId);
  const aircraft=state.aircraft.find(item=>item.id===task.aircraftId);
  if(flight) return `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`;
  if(aircraft) return `${aircraft.tail} · ${aircraft.model}`;
  return task.incidentId||'Operational task';
}

function taskObjectLinkMarkup(task){
  const label=taskObjectLabel(task);
  if(task.flightId) return `<button class="department-task-object-link" type="button" data-task-flight="${esc(task.flightId)}">${esc(label)}</button>`;
  if(task.aircraftId) return `<button class="department-task-object-link" type="button" data-task-aircraft="${esc(task.aircraftId)}">${esc(label)}</button>`;
  return `<span>${esc(label)}</span>`;
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
    <div class="department-task-head"><div>${taskObjectLinkMarkup(task)}<b>${esc(task.label)}</b></div><em>${esc(taskStateLabel(task))}</em></div>
    ${compact?'':`<p>${esc(copy.title)} · ${esc(task.detail)}</p>`}
    ${active?`<div class="inline-task-action">${taskActions(task,incident)}</div>`:`<p>${esc(blockedTaskCopy(task))}</p>`}
  </article>`;
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
  if(impact.type==='slot_miss_risk') return `${context.slotDelayMin||0} min slot delay${context.primaryCause?` · ${context.primaryCause}`:''}`;
  if(impact.type==='crew_duty_risk') return context.label||'Duty envelope at risk';
  return impact.summary||INCIDENT_DEFINITIONS[impact.type]?.summary||'Operational impact';
}
function slotCauseContextMarkup(context){
  if(!context) return '';
  const facts=[
    context.plannedSlot?`planned ${shortClock(context.plannedSlot)}`:'',
    context.graceUntil?`grace ${shortClock(context.graceUntil)}`:'',
    context.readyAt?`ready ${shortClock(context.readyAt)}`:'',
    context.assignedSlot?`new ${shortClock(context.assignedSlot)}`:''
  ].filter(Boolean).join(' · ');
  const causes=(context.causeBreakdown||[]).filter(item=>item.minutes>0);
  return `<div class="case-step-list slot-cause-list">
    <div class="case-step current"><span>${esc(context.readinessLateMin||0)}m late</span><b>${esc(context.primaryCause||'Readiness delay')}</b><em>${esc(facts||'Slot timing unavailable')}</em></div>
    ${causes.map(cause=>`<div class="case-step"><span>+${esc(cause.minutes)}m</span><b>${esc(cause.label)}</b><em>${esc(cause.detail||'Operational delay source')}</em></div>`).join('')}
  </div>`;
}
function caseSlotCauseMarkup(incident){
  const contexts=[];
  for(const impact of incident.impacts||[]){
    if(impact.type==='slot_miss_risk'&&impact.context) contexts.push(impact.context);
  }
  if(!contexts.length) return '';
  return `<section class="case-console-section"><h2>Slot miss reason</h2>${contexts.map(slotCauseContextMarkup).join('')}</section>`;
}
function incidentContextSummaryMarkup(incident){
  const context=incident?.context||{};
  let label='',detail='';
  if(incident.type==='fuel_margin_low'){
    label='Fuel projection';
    detail=`landing ${context.projectedLandingFuelGal||0} gal / reserve ${context.reserveGal||0} gal · margin ${context.marginPct||0}%`;
  }else if(incident.type==='atc_holding_fuel_conflict'){
    label='Holding fuel exposure';
    detail=`holding +${context.holdingDelayMin||0}m · landing ${context.projectedLandingFuelGal||0} gal / reserve ${context.reserveGal||0} gal · margin ${context.marginPct||0}%`;
  }else if(incident.type==='airborne_atc_reroute'){
    label='Reroute trigger';
    detail=context.weatherSummary||`${context.cause||'route constraint'} · possible +${context.delayMin||0} min`;
  }else if(incident.type==='destination_weather_deterioration'){
    label='Destination weather';
    detail=context.weatherSummary||`${context.airport||context.destination||''} ${context.conditions||''} · capacity ${context.capacityPct||0}%${context.forecastAt?` · forecast ${shortClock(context.forecastAt)}`:''}`;
  }else if(incident.type==='destination_below_minima'){
    label='Landing minima';
    detail=context.weatherSummary||`${context.airport||context.destination||''} ${context.minima||''} · ${context.conditions||''}`;
  }else if(incident.type==='alternate_unsuitable'){
    label='Alternate picture';
    detail=`${context.conditions||'destination weather'} · ${context.availableAlternates||0} suitable alternate${context.availableAlternates===1?'':'s'} · capacity ${context.capacityPct||0}%`;
  }else if(['aircraft_out_of_position','aircraft_misposition_after_diversion'].includes(incident.type)){
    label='Aircraft positioning';
    detail=`${context.tail||'Aircraft'} expected ${context.expectedLocation||context.diversionAirport||'elsewhere'} · required ${context.requiredLocation||''} · +${context.delayMin||0}m`;
  }else if(incident.type==='postflight_technical_defect'){
    label='Inbound technical state';
    detail=`${context.previousFlightId||'Inbound'} arrived ${context.arrivedAt?shortClock(context.arrivedAt):''} · ${context.reason||'inspection required'} · condition ${context.condition??'n/a'}`;
  }else if(incident.type==='no_legal_crew'){
    label='Crew availability';
    detail=context.shortage||'Required crew pool unavailable at origin';
  }else if(['crew_misconnect','crew_misposition_after_diversion'].includes(incident.type)){
    label='Crew transfer';
    detail=`${context.transferId||context.reason||'Crew movement'} ${context.from||''} -> ${context.to||''} · ready ${context.readyAt?shortClock(context.readyAt):''} · +${context.delayMin||0}m`;
  }else if(incident.type==='crew_report_delayed'){
    label='Crew report';
    detail=`${PERSONNEL[context.role]?.label||'Crew'} · ${context.reason||'report delayed'} · ready ${context.reportReadyAt?shortClock(context.reportReadyAt):''} · +${context.delayMin||0}m`;
  }else if(incident.type==='crew_fatigue_mid_rotation'){
    label='Duty margin';
    detail=context.label||`${(context.remainingHours||0).toFixed?.(1)||0} h remaining`;
  }else if(incident.type==='crew_duty_extension'){
    label='Duty extension';
    const release=context.projectedRelease?shortClock(context.projectedRelease):'n/a';
    const limit=context.dutyLimitAt?shortClock(context.dutyLimitAt):'n/a';
    const next=context.nextFlightId?` · next ${context.nextFlightId} ${context.nextFlightOrigin||''} ${context.nextFlightDeparture?shortClock(context.nextFlightDeparture):''}`:'';
    detail=`release ${release} / limit ${limit} · +${context.overrunMin||0}m · ${context.primaryCause||'operational delay'}${next}`;
  }else if(incident.type==='night_curfew_conflict'){
    label='Night restriction chain';
    detail=context.restrictionSummary||context.reason||`${context.affectedAirport||''} ${context.affectedPhase||''} curfew`;
  }else if(['deicing_required','deicing_capacity_collapse','holdover_expired','airport_capacity_reduction','atc_ground_stop','fuel_supplier_outage'].includes(incident.type)){
    label=['airport_capacity_reduction','atc_ground_stop'].includes(incident.type)?'Airport flow':'Station weather';
    if(incident.type==='fuel_supplier_outage') label='Fuel provider';
    detail=context.reason||`${context.airport||''} ${context.conditions||''}${context.delayMin?` · +${context.delayMin}m`:''}`;
  }else if(incident.type==='performance_limited'){
    label='Dispatch performance';
    detail=`route ${context.routeKm||0} km · range margin ${context.rangeMarginKm||0} km · fuel margin ${context.fuelMarginGal||0} gal`;
  }else if(incident.type==='destination_handling_unavailable'){
    label='Destination handling';
    detail=`${context.airport||context.destination||''} handling unavailable · delay exposure +${context.delayMin||0}m`;
  }else if(incident.type==='lightning_strike'){
    label='Weather cell crossing';
    detail=`${context.conditions||'Thunderstorm cells'} · ${context.severity||'convective'} cell ${context.cellId||''}`;
  }else if(incident.type==='diversion_airport_unavailable'){
    label='Diversion airport';
    detail=context.weatherSummary||`${context.airport||''} ${context.reason||context.conditions||'unavailable'} · capacity ${context.capacityPct||0}% · handling ${context.handling??'n/a'}`;
  }else if(['inflight_technical_fault','pressurization_issue'].includes(incident.type)){
    label='Aircraft state';
    detail=`${context.trigger||'flight deck report'} · condition ${context.aircraftCondition??'n/a'} · ${context.phasePct||0}% enroute`;
  }else if(incident.type==='unruly_passenger'){
    label='Cabin report';
    detail=`${context.trigger||'Cabin crew security report'} · ${context.phasePct||0}% enroute`;
  }
  return label?`<div class="case-context-strip"><b>${esc(label)}</b><span>${esc(detail)}</span></div>`:'';
}
function caseImpactsMarkup(incident){
  const impacts=(incident.impacts||[]).filter(Boolean);
  if(!impacts.length) return '';
  return `<section class="case-console-section"><h2>Linked impacts</h2><div class="case-step-list">${impacts.map(impact=>`<div class="case-step ${esc(impact.status||'open')}"><span>${esc(impactStatusLabel(impact.status))}</span><b>${esc(impact.title||INCIDENT_DEFINITIONS[impact.type]?.title||impact.type)}</b><em>${esc(incidentImpactDetail(impact))}</em></div>`).join('')}</div></section>`;
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
  const activeCase=workspaceUi.nextActiveIncidentId===incident.id;
  return `<article class="incident-case case-console expanded ${activeCase?'active-case':''} ${focusedTaskId===task?.id?'focused':''}" data-incident-case="${esc(incident.id)}">
    <header class="incident-case-header"><button type="button" data-case-object="${esc(flight?'flight':'aircraft')}" data-case-object-id="${esc(flight?.id||aircraft?.id||'')}"><span>${esc(reference)}</span><b>${esc(copy.title)}</b></button><em>${incident.blocking?'Blocking':'Open'}</em></header>
    <p>${esc(copy.summary)}</p>
    ${incidentContextSummaryMarkup(incident)}
    <div class="incident-meta"><span>${esc(incidentDecisionSummary(incident,task))}</span><span>${progress.completed}/${progress.total} steps</span></div>
    <div class="progress-track"><span style="width:${formatPct(progress.progress)}"></span></div>
    ${caseSlotCauseMarkup(incident)}${caseActiveTaskMarkup(incident,task)}${caseImpactsMarkup(incident)}${caseStepsMarkup(incident,task)}
  </article>`;
}

function disruptionCaseGroups(incidents,now=simNow()){
  const byId=new Map((state.incidents||[]).map(incident=>[incident.id,incident]));
  const groups=new Map();
  for(const incident of incidents){
    const key=incident.caseId||incident.rootIncidentId||incident.id;
    if(!groups.has(key)){
      const root=byId.get(incident.rootIncidentId)||byId.get(key)||incident;
      groups.set(key,{id:key,root,incidents:[]});
    }
    groups.get(key).incidents.push(incident);
  }
  const severityScore=incident=>incident?.severity==='critical'?2:incident?.severity==='warning'?1:0;
  return [...groups.values()].map(group=>{
    group.incidents.sort((a,b)=>{
      if(a.id===group.root.id) return -1;
      if(b.id===group.root.id) return 1;
      return Number(incidentIsActionable(b,now))-Number(incidentIsActionable(a,now))
        ||severityScore(b)-severityScore(a)
        ||(a.deadline||0)-(b.deadline||0);
    });
    return group;
  }).sort((a,b)=>{
    const aActive=a.incidents.some(incident=>incident.id===workspaceUi.nextActiveIncidentId);
    const bActive=b.incidents.some(incident=>incident.id===workspaceUi.nextActiveIncidentId);
    const aAction=a.incidents.some(incident=>incidentIsActionable(incident,now));
    const bAction=b.incidents.some(incident=>incidentIsActionable(incident,now));
    const aCritical=a.incidents.some(incident=>incident.severity==='critical');
    const bCritical=b.incidents.some(incident=>incident.severity==='critical');
    return Number(bActive)-Number(aActive)
      ||Number(bAction)-Number(aAction)
      ||Number(bCritical)-Number(aCritical)
      ||Math.min(...a.incidents.map(incident=>incident.deadline||Infinity))-Math.min(...b.incidents.map(incident=>incident.deadline||Infinity));
  });
}

function disruptionRootReference(root){
  const flight=root?.flightId&&state.flights.find(item=>item.id===root.flightId);
  const aircraft=root?.aircraftId&&state.aircraft.find(item=>item.id===root.aircraftId);
  if(flight) return `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`;
  if(aircraft) return `${aircraft.tail} · ${aircraft.model}`;
  return 'Network disruption';
}

function disruptionCaseGroupMarkup(group){
  const root=group.root||group.incidents[0],rootCopy=incidentCopy(root);
  const actionable=group.incidents.filter(incident=>incidentIsActionable(incident)).length;
  const effects=group.incidents.filter(incident=>incident.id!==root.id);
  const chainRows=effects.slice(0,4).map(incident=>{
    const copy=incidentCopy(incident);
    return `<div class="disruption-chain-row"><span>${esc(incident.chainReason||'Operational consequence')}</span><b>${esc(copy.title)}</b></div>`;
  }).join('');
  return `<section class="disruption-case-group" data-disruption-case="${esc(group.id)}">
    <header class="disruption-case-header">
      <div><span>Disruption case · ${esc(disruptionRootReference(root))}</span><b>Root: ${esc(rootCopy.title||'Operational disruption')}</b></div>
      <em>${actionable?`${actionable} actionable`:''}${actionable&&effects.length?' · ':''}${effects.length} effect${effects.length===1?'':'s'}</em>
    </header>
    ${chainRows?`<div class="disruption-chain-list">${chainRows}${effects.length>4?`<div class="disruption-chain-row muted"><span>More effects</span><b>${effects.length-4} additional open incident${effects.length-4===1?'':'s'}</b></div>`:''}</div>`:''}
    <div class="disruption-incident-list">${group.incidents.map(incidentCaseMarkup).join('')}</div>
  </section>`;
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
  return `<section class="desk-action-panel" data-active-desk="${esc(desk)}" data-active-desk-panel="${esc(panel)}"><header><b>${esc(title)}</b><button class="icon-button" type="button" data-close-desk-panel="${esc(desk)}" aria-label="Close">×</button></header>${body}</section>`;
}

function sparesPanelMarkup(){
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  const candidates=selected?rotationReplacementCandidates(selected):state.aircraft.filter(ac=>!aircraftActiveFlight(ac.id)&&!aircraftUpcomingFlight(ac.id)&&!aircraftIsDefective(ac)).slice(0,5);
  return candidates.length?candidates.map(ac=>`<div class="desk-list-row"><div><b>${esc(ac.tail)} · ${esc(ac.model)}</b><span>${esc(ac.location)} · condition ${Math.round(ac.condition??100)}%</span></div><em>spare</em></div>`).join(''):'<div class="empty-state">No spare aircraft match the current operation.</div>';
}

function occWidgetMarkup(key,kicker,title,count,status,actions,content){
  const context=[kicker,status].filter(Boolean).join(' · ');
  const open=isDeskOpen(key);
  const empty=!count&&!activeDeskPanel(key);
  return `<section class="occ-board-widget ${count?'has-work':'empty-work'} ${empty?'compact-empty':''} ${open?'':'collapsed'}" id="occ-desk-${key}" data-desk-widget="${key}">
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
    if(action==='open-ferry-planner'){
      const incident=state.incidents.find(item=>item.id===task.incidentId);
      if(incident) prefillPositioningFerryPlanner(incident);
      return;
    }
    if(action==='check-ferry') actionId='';
    if(action==='open-crew-relocation'){
      const incident=state.incidents.find(item=>item.id===task.incidentId);
      if(incident) prefillCrewRelocationPlanner(incident);
      return;
    }
    if(action==='check-crew-move') actionId='';
    if(action==='open-dispatch-actions'){
      const incident=state.incidents.find(item=>item.id===task.incidentId);
      if(incident?.flightId){
        settleSelectedFlight(incident.flightId);
        setDeskOpen('planning',true,{persist:false});
        markUiDirty('desk','left','context','schedule');
      }
      return;
    }
    if(action==='check-departure-change') actionId='';
    if(action==='complete') actionId='';
    focusedTaskId=task.id;
    const performed=performOperationalTask(task.id,actionId,payload);
    const incident=state.incidents.find(item=>item.id===task.incidentId);
    if(performed&&['technical_strategy','recovery_strategy'].includes(task.kind)){
      autoRunBranchFollowUps(incident,task.id);
    }
    if(performed){
      const nextTask=incident?incidentWorkflowProgress(incident).current:null;
      focusedTaskId=nextTask?.id||'';
      NextRender.invalidate('desk','left','context','schedule','weather');
      NextRender.flush();
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

function crewSwapPanelMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<div class="empty-state">Select a flight to swap its full operating crew.</div>';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const duty=crewDutyForFlight(flight);
  const blocker=crewSwapBlocker(flight);
  const family=aircraft?Management.aircraftFamily(aircraft.model):'Multi-fleet';
  const cabinNeed=aircraft&&flight.flightType!=='ferry'?Math.max(1,Math.ceil(cabinSeatCount(aircraft)/50)):0;
  return `<div class="occ-action-context"><b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</b><span>${esc(family)} · ${duty.sectors||1} sector${duty.sectors===1?'':'s'} · release ${shortClock(duty.releaseAt)}</span></div>
    <div class="occ-action-row">
      <div><b>Local reserve crew</b><span>${esc(blocker||`${qualifiedStaffAt(flight.from,'captains',family)} captains · ${qualifiedStaffAt(flight.from,'firstOfficers',family)} first officers · ${staffAt(flight.from,'cabinCrew')} cabin at ${flight.from}`)}</span></div>
      <button class="secondary-button" type="button" data-crew-swap-flight="${esc(flight.id)}" ${blocker?'disabled':''}>Swap full crew</button>
    </div>
    <p class="panel-note">${blocker?esc(blocker):`Requires 1 captain, 1 first officer${cabinNeed?`, and ${cabinNeed} cabin crew`:''}. The old duty ends before this flight and the new crew takes this sector.`}</p>`;
}

function dispatchSelectedFlightMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const rotation=rotationForFlight(flight);
  const pairedReturn=rotation.returnFlight&&flight.serviceLeg!=='return'?rotation.returnFlight:null;
  const scope=flight.serviceId&&rotation.outbound
    ? `Round trip ${rotation.outbound.id}${pairedReturn?` + ${pairedReturn.id}`:''}`
    : 'Selected flight';
  const status=statusOfFlight(flight).replaceAll('_',' ');
  const depDelay=flightTotalDepartureDelayMin(flight);
  const arrDelay=Math.max(0,Math.round((flightActualArrival(flight)-flight.arrival)/MIN));
  const timing=[
    `${shortDay(flightActualDeparture(flight))} ${shortClock(flightActualDeparture(flight))}`,
    depDelay?`departure +${depDelay} min`:'',
    arrDelay?`arrival +${arrDelay} min`:''
  ].filter(Boolean).join(' · ');
  return `<section class="dispatch-scope-card" data-dispatch-selected-flight="${esc(flight.id)}">
    <span>Selected flight</span>
    <b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</b>
    <em>${esc(scope)} · ${esc(aircraft?`${aircraft.tail} · ${aircraft.model}`:'unassigned')} · ${esc(status)} · ${esc(timing)}</em>
  </section>`;
}

function dispatchOccActionsMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<section class="desk-section occ-actions-section"><h2>OCC actions</h2><div class="empty-state">Select a flight to hold or swap aircraft.</div></section>';
  const beforeDeparture=!flight.departureLogged;
  const turnaroundTargets=typeof turnaroundCancellationTargets==='function'?turnaroundCancellationTargets(flight):[];
  const canCancelTurnaround=beforeDeparture&&turnaroundTargets.length>1;
  const turnaroundLabel=turnaroundTargets.map(item=>item.id).join(' + ');
  const candidates=manualSwapCandidatesForFlight(flight);
  const swapBlocked=beforeDeparture
    ? flight.fueled?'Aircraft swap unavailable after fueling.':!candidates.length?'No suitable replacement aircraft is available.':''
    : 'Aircraft swap is only available before departure.';
  const holdUntilValue=datetimeLocalValue(Math.max(flightActualDeparture(flight)+15*MIN,simNow()+15*MIN));
  return `<section class="desk-section occ-actions-section" data-dispatch-occ-flight="${esc(flight.id)}">
    <h2>OCC actions</h2>
    <div class="occ-action-row">
      <div><b>Delay departure</b><span>${beforeDeparture?'Manual operational hold':'Flight already departed'}</span></div>
      <div class="occ-action-controls"><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="15" ${beforeDeparture?'':'disabled'}>+15</button><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="30" ${beforeDeparture?'':'disabled'}>+30</button><input type="number" min="5" max="240" step="5" value="15" aria-label="Custom delay minutes" data-occ-custom-delay><button class="secondary-button" type="button" data-occ-custom-delay-flight="${esc(flight.id)}" ${beforeDeparture?'':'disabled'}>Apply</button></div>
    </div>
    <div class="occ-action-row">
      <div><b>Hold until</b><span>${beforeDeparture?'Set projected departure time manually':'Flight already departed'}</span></div>
      <div class="occ-action-controls wide"><input type="datetime-local" value="${esc(holdUntilValue)}" aria-label="Hold until departure time" data-occ-hold-until><button class="secondary-button" type="button" data-occ-hold-until-flight="${esc(flight.id)}" ${beforeDeparture?'':'disabled'}>Set time</button></div>
    </div>
    <div class="occ-action-row">
      <div><b>Swap aircraft</b><span>${swapBlocked||`${candidates.length} suitable candidate${candidates.length===1?'':'s'}`}</span></div>
      ${candidates.length?`<div class="occ-action-controls wide"><select data-occ-swap-aircraft>${candidates.map(ac=>`<option value="${esc(ac.id)}">${esc(ac.tail)} · ${esc(ac.model)} · ${esc(ac.location)}</option>`).join('')}</select><button class="secondary-button" type="button" data-occ-swap-flight="${esc(flight.id)}">${flight.serviceId?'Swap round trip':'Swap flight'}</button></div>`:''}
    </div>
    <div class="occ-action-row">
      <div><b>Cancel single flight</b><span>${beforeDeparture?'Cancels only this leg; paired or later legs remain in the programme.':'Flight already departed'}</span></div>
      <div class="occ-action-controls"><button class="danger-button" type="button" data-occ-cancel-single-flight="${esc(flight.id)}" ${beforeDeparture?'':'disabled'}>Cancel flight</button></div>
    </div>
    ${flight.serviceId?`<div class="occ-action-row">
      <div><b>Cancel turnaround</b><span>${canCancelTurnaround?`Cancels ${esc(turnaroundLabel)} only; the recurring schedule remains active.`:'No complete future turnaround pair is available.'}</span></div>
      <div class="occ-action-controls"><button class="danger-button" type="button" data-occ-cancel-turnaround="${esc(flight.id)}" ${canCancelTurnaround?'':'disabled'}>Cancel turnaround</button></div>
    </div>`:''}
  </section>`;
}

function dispatchDelayAnalysisMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<section class="desk-section dispatch-delay-section"><h2>Delay analysis</h2><div class="empty-state">Select a flight to inspect delay causes.</div></section>';
  const analysis=flightDelayAnalysis(flight);
  if(!analysis.active) return `<section class="desk-section dispatch-delay-section" data-dispatch-delay-flight="${esc(flight.id)}"><h2>Delay analysis</h2><div class="desk-list-row"><div><b>${esc(flight.id)} · on plan</b><span>No departure or arrival delay is currently projected.</span></div><em>${esc(shortClock(flightActualDeparture(flight)))}</em></div></section>`;
  const primary=analysis.primary;
  const causeRows=analysis.causes.map((item,index)=>`<div class="desk-list-row ${index?'':'highlight'}"><div><b>${esc(index?'Contributing cause':'Primary cause')}: ${esc(item.label)}</b><span>${esc(item.detail||'Operational timing impact')}</span></div><em>+${item.minutes} min</em></div>`).join('');
  return `<section class="desk-section dispatch-delay-section" data-dispatch-delay-flight="${esc(flight.id)}">
    <h2>Delay analysis</h2>
    <div class="occ-action-context"><b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</b><span>Departure +${analysis.depDelay} min · arrival +${analysis.arrDelay} min${primary?` · ${esc(primary.label)}`:''}</span></div>
    ${causeRows}
  </section>`;
}

function scheduleRuleLabel(rule){
  return ({daily:'daily',weekdays:'weekdays',every2:'every 2 days',weekly:'weekly',custom:'custom calendar'})[rule]||rule||'recurring';
}

function scheduleRemovalOptions(){
  const now=simNow();
  const serviceOptions=(state.services||[]).filter(service=>service.active).map(service=>{
    const flights=state.flights
      .filter(flight=>flight.serviceId===service.id&&!flight.cancelled&&!flight.departureLogged&&flightActualDeparture(flight)>now)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
    if(!flights.length) return null;
    const aircraft=state.aircraft.find(item=>item.id===service.aircraftId);
    return {
      id:`service:${service.id}`,sortAt:flightActualDeparture(flights[0]),
      label:`${service.id} · ${service.from} ↔ ${service.to}`,
      detail:`${scheduleRuleLabel(service.rule)} · ${flights.length} unflown · next ${shortDay(flights[0].departure)} ${shortClock(flightActualDeparture(flights[0]))}${aircraft?` · ${aircraft.tail}`:''}`
    };
  }).filter(Boolean);
  const flightOptions=state.flights
    .filter(flight=>!flight.serviceId&&!flight.cancelled&&!flight.departureLogged&&flightActualDeparture(flight)>now)
    .map(flight=>({
      id:`flight:${flight.id}`,sortAt:flightActualDeparture(flight),
      label:`${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`,
      detail:`${flight.flightType==='ferry'?'ferry':'one-time'} · ${shortDay(flight.departure)} ${shortClock(flightActualDeparture(flight))}`
    }));
  return serviceOptions.concat(flightOptions).sort((a,b)=>a.sortAt-b.sortAt||a.label.localeCompare(b.label));
}

function removeSchedulePanelMarkup(){
  const options=scheduleRemovalOptions();
  return `${options.length?`<div class="form-grid compact-form"><label>Schedule<select data-remove-schedule-select>${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)} · ${esc(option.detail)}</option>`).join('')}</select></label></div>`:'<div class="empty-state">No unflown schedules can be removed.</div>'}
    <div class="form-actions"><button class="danger-button" type="button" data-remove-schedule ${options.length?'':'disabled'}>Remove schedule</button></div>
    <p class="panel-note">Unflown flights are removed. Departed or completed flights stay in history.</p>`;
}

function personnelSnapshotMarkup(){
  const selectedFlight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  const focusCodes=[selectedFlight?.from,selectedFlight&&flightOperationalDestination(selectedFlight),state.home].filter(Boolean);
  const codes=[...new Set([...focusCodes,...operationalAirportCodes()])].slice(0,6);
  return `<section class="desk-section"><h2>Staff availability</h2>${codes.length?codes.map(code=>{
    return `<div class="desk-list-row"><div><b>${esc(code)} · ${esc(AIRPORTS[code]?.name||'Station')}</b><span>${staffAt(code,'captains')} captains · ${staffAt(code,'firstOfficers')} first officers · ${staffAt(code,'cabinCrew')} cabin · ${staffAt(code,'groundHandling')} handling</span></div><em>${selectedFlight?.from===code?'origin':selectedFlight&&flightOperationalDestination(selectedFlight)===code?'arrival':'station'}</em></div>`;
  }).join(''):'<div class="empty-state">No staffed stations yet.</div>'}</section>`;
}

function planningDeskMarkup(requests){
  return `${dispatchSelectedFlightMarkup()}
    ${dispatchOccActionsMarkup()}
    ${dispatchDelayAnalysisMarkup()}`;
}

function personnelDeskMarkup(requests,transfers,crewExposures=[]){
  return `${deskPanelMarkup('personnel','relocation','Move personnel')}
    ${deskPanelMarkup('personnel','crew-swap','Swap full crew',crewSwapPanelMarkup())}
    ${crewAccommodationMarkup(crewExposures)}
    ${personnelSnapshotMarkup()}${resourceActivityMarkup([],transfers,'Personnel movement') || ''}`;
}

function warningLevelRank(level){
  return ({critical:0,warning:1,watch:2})[level]??3;
}

function warningFlightWindow(now=simNow()){
  return {start:now-30*MIN,end:now+24*HOUR};
}

function warningDismissKey(warning){
  const fingerprint=[
    warning.id,
    warning.level,
    warning.title,
    warning.detail,
    warning.flightId||'',
    warning.aircraftId||''
  ].join('|');
  return `${warning.id}:${Math.round(stableFraction(fingerprint)*1e9).toString(36)}`;
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
    const aircraft=index.aircraftById.get(aircraftId)||state.aircraft.find(item=>item.id===aircraftId);
    for(let i=1;i<aircraftFlights.length;i++){
      const previous=aircraftFlights[i-1],next=aircraftFlights[i];
      const turn=turnaroundGapInfo(previous,next,aircraft);
      if(!turn?.belowMinimum) continue;
      const gapLabel=turn.limitingGapMin<0?'overlap':`${Math.max(0,turn.limitingGapMin)}m`;
      add({
        id:`short-turn:${next.id}`,
        type:'short_turn',
        group:'Short turns',
        level:turn.shortageMin>=15?'critical':'warning',
        owner:'Dispatch',
        flightId:next.id,
        aircraftId:next.aircraftId,
        title:`Short turn ${gapLabel}/${turn.minimumMin}m`,
        detail:`${previous.id} -> ${next.id} at ${next.from} · ${turn.shortageMin} min under minimum`,
        sortAt:flightActualDeparture(next)
      });
    }
  }
  for(const flight of flights){
    const destination=flightOperationalDestination(flight);
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
  return warnings.sort((a,b)=>warningLevelRank(a.level)-warningLevelRank(b.level)||a.sortAt-b.sortAt||a.title.localeCompare(b.title));
}

function warningsDeskMarkup(warnings){
  if(!warnings.length) return '<div class="occ-clear-state"><b>No current warnings</b><span>Derived schedule, crew, night, and maintenance risks are clear.</span></div>';
  const byGroup=new Map();
  for(const warning of warnings) mapPush(byGroup,warning.group||'Other warnings',warning);
  const row=warning=>{
    const actionAttr=warning.flightId
      ? `data-warning-flight="${esc(warning.flightId)}"`
      : warning.aircraftId
        ? `data-warning-aircraft="${esc(warning.aircraftId)}"`
        : '';
    const dismissKey=warningDismissKey(warning);
    return `<div class="desk-list-row warning-row ${esc(warning.level)}" data-warning-key="${esc(dismissKey)}">
      <button class="row-main-button" type="button" ${actionAttr}>
        <b>${esc(warning.title)}</b>
        <span>${esc(warning.detail)}</span>
      </button>
      <button class="warning-dismiss-button" type="button" data-dismiss-warning="${esc(dismissKey)}" aria-label="Dismiss warning" title="Dismiss warning">×</button>
      <em>${esc(warning.owner)}</em>
    </div>`;
  };
  const groups=[...byGroup.entries()]
    .sort((a,b)=>warningLevelRank(a[1][0]?.level)-warningLevelRank(b[1][0]?.level)||b[1].length-a[1].length||a[0].localeCompare(b[0]))
    .map(([name,items])=>{
      const critical=items.filter(item=>item.level==='critical').length;
      const shown=items.slice(0,2),hidden=items.slice(2,8);
      return `<section class="warning-group-card ${critical?'critical':''}">
        <header><div><b>${esc(name)}</b><span>${critical?`${critical} critical · `:''}${items.length} warning${items.length===1?'':'s'}</span></div><em>${esc(items[0]?.owner||'OCC')}</em></header>
        ${shown.map(row).join('')}
        ${hidden.length?`<details class="warning-group-more"><summary>Show ${items.length-shown.length} more</summary>${hidden.map(row).join('')}${items.length>shown.length+hidden.length?`<p>${items.length-shown.length-hidden.length} more not shown.</p>`:''}</details>`:''}
      </section>`;
    })
    .join('');
  return `<section class="desk-section warning-group-section"><h2>Warning groups</h2>${groups}</section>`;
}

function incidentFilterMarkup(allIncidents){
  const counts=incidentTriageCounts(allIncidents),active=['actionable','today','watch','all'].includes(workspaceUi.incidentFilter)?workspaceUi.incidentFilter:'actionable';
  const filters=[
    ['actionable','Actionable',counts.actionable],
    ['today','Today',counts.today],
    ['watch','Watch',counts.watch],
    ['all','All',counts.all]
  ];
  return `<div class="incident-filter" role="tablist" aria-label="Incident triage">${filters.map(([key,label,count])=>`<button type="button" role="tab" class="${active===key?'active':''}" aria-selected="${active===key}" data-incident-filter="${key}"><span>${esc(label)}</span><b>${count}</b></button>`).join('')}</div>`;
}

function incidentsDeskMarkup(allIncidents){
  const filter=['actionable','today','watch','all'].includes(workspaceUi.incidentFilter)?workspaceUi.incidentFilter:'actionable';
  const incidents=filteredOperationalIncidents(allIncidents,filter);
  const groups=disruptionCaseGroups(incidents);
  const empty=filter==='actionable'&&allIncidents.length
    ? '<div class="occ-clear-state"><b>No immediate cases</b><span>Open cases are parked in Today, Watch, or All.</span></div>'
    : '<div class="occ-clear-state"><b>Operation normal</b><span>No unresolved incidents require coordination.</span></div>';
  return `${incidentFilterMarkup(allIncidents)}<div class="incident-case-list">${groups.length?groups.map(group=>group.incidents.length>1?disruptionCaseGroupMarkup(group):incidentCaseMarkup(group.incidents[0])).join(''):empty}</div>`;
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

function passengerRecoveryDeskMarkup(exposures=passengerRecoveryExposures()){
  const now=simNow();
  const active=exposures.filter(item=>!item.arranged).slice(0,6);
  const rows=active.map(item=>{
    const detail=[
      item.reason,
      item.delayMin?`+${item.delayMin} min`:'',
      item.overnightPax?`${item.overnightPax} overnight pax`:'',
      item.criticalConnections||item.atRiskConnections?`${item.criticalConnections} critical / ${item.atRiskConnections} at risk`:''
    ].filter(Boolean).join(' · ');
    const actions=(item.actions||[]).map(action=>{
      const record=(item.records||[]).find(entry=>entry.action===action.id);
      if(record) return `<span class="recovery-status-pill"><b>${esc(action.label)}</b><em>${esc(passengerRecoveryStatusLabel(record.status))} · ${esc(responseTimeLabel(record,now))}</em></span>`;
      return `<button class="secondary-button" type="button" data-passenger-recovery="${esc(item.flightId)}" data-passenger-recovery-action="${esc(action.id)}">${esc(action.label)}</button>`;
    }).join('');
    return `<div class="desk-list-row passenger-recovery-row">
      <button class="row-main-button" type="button" data-connection-flight="${esc(item.flightId)}"><b>${esc(item.flightId)} · ${esc(item.flight.from)} → ${esc(flightOperationalDestination(item.flight))}</b><span>${esc(detail)}</span></button>
      <div class="occ-action-controls"><em>exposure ${money(item.cost)}</em>${actions}</div>
    </div>`;
  }).join('');
  const arranged=exposures.filter(item=>item.arranged).length;
  return `<section class="desk-section"><h2>Customer coordination</h2>${rows||'<div class="empty-state">No diversion passenger coordination needed.</div>'}${arranged?`<p class="panel-note">${arranged} confirmed passenger coordination item${arranged===1?'':'s'} tracked in recovery costs.</p>`:''}</section>`;
}

function crewAccommodationMarkup(exposures=crewAccommodationExposures()){
  const now=simNow();
  const rows=exposures.filter(item=>!item.arranged).slice(0,5).map(item=>{
    const actions=(item.actions||[]).map(action=>{
      const record=(item.records||[]).find(entry=>entry.action===action.id);
      if(record) return `<span class="recovery-status-pill"><b>${esc(action.label)}</b><em>${esc(crewRecoveryStatusLabel(record.status))} · ${esc(responseTimeLabel(record,now))}</em></span>`;
      return `<button class="secondary-button" type="button" data-crew-recovery="${esc(item.flightId)}" data-crew-recovery-action="${esc(action.id)}">${esc(action.label)}</button>`;
    }).join('');
    const detail=[
      item.reason,
      item.releaseDelayMin?`+${item.releaseDelayMin} min release`:'',
      item.plannedReleaseAirport&&item.plannedReleaseAirport!==item.releaseAirport?`planned ${item.plannedReleaseAirport}`:'',
      `release ${shortClock(flightCrewRelease(item.flight))}`
    ].filter(Boolean).join(' · ');
    return `<div class="desk-list-row crew-accommodation-row">
      <button class="row-main-button" type="button" data-connection-flight="${esc(item.flightId)}"><b>${esc(item.flightId)} · crew at ${esc(item.releaseAirport)}</b><span>${esc(detail)} · ${item.crew} crew</span></button>
      <div class="occ-action-controls"><em>exposure ${money(item.cost)}</em>${actions}</div>
    </div>`;
  }).join('');
  const arranged=exposures.filter(item=>item.arranged).length;
  return `<section class="desk-section"><h2>Crew rest & positioning</h2>${rows||'<div class="empty-state">No diversion crew rest or positioning exposure.</div>'}${arranged?`<p class="panel-note">${arranged} confirmed crew coordination item${arranged===1?'':'s'} tracked in recovery costs.</p>`:''}</section>`;
}

function renderDeskStack(force=false){
  const root=document.getElementById('deskStack');
  if(!root) return;
  const now=simNow();
  const index=operationalIndex(now);
  const incidents=openOperationalIncidents();
  const filteredIncidents=filteredOperationalIncidents(incidents);
  const activeIncident=activeIncidentCase(filteredIncidents);
  workspaceUi.nextActiveIncidentId=activeIncident?.id||'';
  const disruptionGroupCount=disruptionCaseGroups(incidents).length;
  const activeRequests=(state.resourceRequests||[]).filter(item=>!['delivered','cancelled'].includes(item.status));
  const activeTransfers=(state.personnelTransfers||[]).filter(item=>!['completed','cancelled'].includes(item.status));
  const passengerExposures=typeof passengerRecoveryExposures==='function'?passengerRecoveryExposures(now):[];
  const passengerActionCount=passengerExposures.filter(item=>!item.arranged).length;
  const crewExposures=typeof crewAccommodationExposures==='function'?crewAccommodationExposures(now):[];
  const crewAccommodationCount=crewExposures.filter(item=>!item.arranged).length;
  const allWarnings=operationWarnings(now,index);
  const warnings=visibleOperationWarnings(allWarnings);
  const criticalWarnings=warnings.filter(item=>item.level==='critical').length;
  const transferSignature=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.actualTo||''}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const signature=[
    selectedFlightId||'',selectedAircraftId||'',
    workspaceUi.nextActiveIncidentId||'',
    workspaceUi.incidentFilter||'actionable',
    incidents.map(item=>`${item.id}:${item.status}:${item.blocking?1:0}:${item.caseId||''}:${item.rootIncidentId||''}:${item.triggeredByIncidentId||''}:${item.chainReason||''}:${(item.impacts||[]).map(impact=>`${impact.key}:${impact.status}:${impact.summary}`).join(',')}`).join('|'),
    actionableTasks().map(t=>`${t.id}:${t.status}:${t.completesAt}:${t.outcome||''}:${JSON.stringify(t.selection||{})}`).join('|'),
    (state.externalRequests||[]).map(item=>`${item.id}:${item.status}:${item.respondsAt}`).join('|'),
    activeRequests.map(item=>`${item.id}:${item.status}:${item.readyAt}`).join('|'),
    (state.services||[]).map(service=>`${service.id}:${service.active?1:0}:${service.aircraftId}:${service.nextDeparture}`).join('|'),
    selectedFlightId?(()=>{
      const f=index.flightsById.get(selectedFlightId);
      return f?`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.aircraftId}:${f.cancelled?1:0}:${f.staffingBlocked?1:0}`:'';
    })():'',
    warnings.map(item=>`${item.id}:${item.level}:${item.flightId||''}:${item.aircraftId||''}:${item.title}:${item.detail}:${item.sortAt}`).join('|'),
    passengerExposures.map(item=>`${item.flightId}:${item.cost}:${item.arranged?1:0}:${item.reason}:${item.overnightPax}:${item.criticalConnections}:${item.atRiskConnections}:${(item.records||[]).map(record=>`${record.action}:${record.status}:${record.updatedAt}`).join(',')}`).join('|'),
    (state.passengerRecoveries||[]).map(item=>`${item.id}:${item.flightId}:${item.action}:${item.status}:${item.updatedAt}:${item.completedAt}`).join('|'),
    crewExposures.map(item=>`${item.flightId}:${item.cost}:${item.arranged?1:0}:${item.releaseAirport}:${item.reason}:${(item.records||[]).map(record=>`${record.action}:${record.status}:${record.updatedAt}`).join(',')}`).join('|'),
    (state.crewRecoveries||[]).map(item=>`${item.id}:${item.flightId}:${item.action}:${item.status}:${item.updatedAt}:${item.completedAt}`).join('|'),
    state.aircraft.map(ac=>`${ac.id}:${ac.location}:${attentionForAircraft(ac)}:${Math.round(ac.condition??100)}`).join('|'),
    Math.floor(now/MIN),state.slotRights.length,
    JSON.stringify(state.personnel.assignments||{}),transferSignature,
    JSON.stringify(workspaceUi.collapsed.occ||{}),JSON.stringify(workspaceUi.nextDeskPanels||{}),
    JSON.stringify(workspaceUi.dismissedWarnings||{})
  ].join('::');
  if(!force&&signature===lastDeskStackSignature) return;
  if(!force&&root.contains(document.activeElement)) return;
  lastDeskStackSignature=signature;
  restoreEmbeddedManagementPages(root);
  root.innerHTML=`${occWidgetMarkup('incidents','Operational work','Open incidents',disruptionGroupCount,incidents.length?`${disruptionGroupCount} disruption case${disruptionGroupCount===1?'':'s'} · ${incidents.length} open incident${incidents.length===1?'':'s'}`:'No action required',deskActionBar('incidents',[
      {kind:'direct',label:'Training scenario',attr:'data-training-incident'}
    ]),incidentsDeskMarkup(incidents))}
    ${occWidgetMarkup('warnings','Operational risk','Warnings',warnings.length,warnings.length?`${criticalWarnings} critical · ${warnings.length} derived warning${warnings.length===1?'':'s'}`:'No derived schedule risks','',warningsDeskMarkup(warnings))}
    ${occWidgetMarkup('planning','Dispatch desk','Dispatch & slots',0,selectedFlightId?'Selected-flight control':'Select a flight for OCC actions','',planningDeskMarkup(activeRequests))}
    ${occWidgetMarkup('passengers','Passenger desk','Passenger impact',passengerActionCount,passengerActionCount?`${passengerActionCount} passenger impact item${passengerActionCount===1?'':'s'} need coordination`:'No passenger impact exposure','',passengerRecoveryDeskMarkup(passengerExposures))}
    ${occWidgetMarkup('personnel','People desk','Personnel',activeTransfers.length+crewAccommodationCount,crewAccommodationCount?`${crewAccommodationCount} crew accommodation item${crewAccommodationCount===1?'':'s'}`:activeTransfers.length?'Movements underway':'Staffing ready',deskActionBar('personnel',[
      {panel:'relocation',label:'Move personnel'},
      {panel:'crew-swap',label:'Swap full crew'}
    ]),personnelDeskMarkup(activeRequests,activeTransfers,crewExposures))}`;
  mountOccManagementPages(root);
  root.querySelectorAll('[data-toggle-desk]').forEach(button=>button.addEventListener('click',event=>{
    if(event.target.closest('.info-tip')) return;
    const desk=button.dataset.toggleDesk;
    setDeskOpen(desk,!isDeskOpen(desk),{persist:true});
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-incident-filter]').forEach(button=>button.addEventListener('click',()=>{
    setIncidentFilter(button.dataset.incidentFilter);
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    markUiDirty('desk');
  }));
  root.querySelector('[data-training-incident]')?.addEventListener('click',generateTrainingIncident);
  root.querySelectorAll('[data-case-object]').forEach(button=>button.addEventListener('click',()=>button.dataset.caseObject==='flight'?settleSelectedFlight(button.dataset.caseObjectId):settleSelected(button.dataset.caseObjectId)));
  root.querySelectorAll('[data-task-flight]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelectedFlight(button.dataset.taskFlight);
  }));
  root.querySelectorAll('[data-task-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelected(button.dataset.taskAircraft);
  }));
  root.querySelectorAll('[data-warning-flight]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelectedFlight(button.dataset.warningFlight);
  }));
  root.querySelectorAll('[data-warning-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelected(button.dataset.warningAircraft);
  }));
  root.querySelectorAll('[data-dismiss-warning]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    dismissWarning(button.dataset.dismissWarning);
  }));
  root.querySelectorAll('[data-occ-delay-flight]').forEach(button=>button.addEventListener('click',()=>delayFlight(button.dataset.occDelayFlight,Number(button.dataset.delayMin)||15)));
  root.querySelectorAll('[data-occ-custom-delay-flight]').forEach(button=>button.addEventListener('click',()=>{
    const minutes=clamp(Math.round(Number(button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-custom-delay]')?.value)||15),5,240);
    delayFlight(button.dataset.occCustomDelayFlight,minutes);
  }));
  root.querySelectorAll('[data-occ-hold-until-flight]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-hold-until]')?.value;
    delayFlightUntil(button.dataset.occHoldUntilFlight,new Date(value).getTime());
  }));
  root.querySelectorAll('[data-occ-swap-flight]').forEach(button=>button.addEventListener('click',()=>{
    const select=button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-swap-aircraft]');
    if(select) swapSelectedFlightAircraft(button.dataset.occSwapFlight,select.value);
  }));
  root.querySelectorAll('[data-occ-cancel-single-flight]').forEach(button=>button.addEventListener('click',()=>cancelSingleFlight(button.dataset.occCancelSingleFlight)));
  root.querySelectorAll('[data-occ-cancel-turnaround]').forEach(button=>button.addEventListener('click',()=>cancelTurnaround(button.dataset.occCancelTurnaround)));
  root.querySelectorAll('[data-remove-schedule]').forEach(button=>button.addEventListener('click',()=>{
    const selection=button.closest('[data-active-desk-panel]')?.querySelector('[data-remove-schedule-select]')?.value;
    if(removeScheduleSelection(selection)){
      setDeskPanel('planning','');
      markUiDirty('all');
    }
  }));
  root.querySelectorAll('[data-connection-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.connectionFlight)));
  root.querySelectorAll('[data-passenger-recovery]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    authorizePassengerRecovery(button.dataset.passengerRecovery,button.dataset.passengerRecoveryAction||'hotel');
    markUiDirty('all');
  }));
  root.querySelectorAll('[data-crew-accommodation]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    arrangeCrewAccommodation(button.dataset.crewAccommodation);
    markUiDirty('all');
  }));
  root.querySelectorAll('[data-crew-recovery]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    authorizeCrewRecovery(button.dataset.crewRecovery,button.dataset.crewRecoveryAction||'hotel');
    markUiDirty('all');
  }));
  root.querySelectorAll('[data-crew-swap-flight]').forEach(button=>button.addEventListener('click',()=>{
    swapCrewForFlight(button.dataset.crewSwapFlight);
    markUiDirty('all');
  }));
  bindInlineTaskActions(root);
  refreshManagement(true);
}

function openDesk(desk){
  const destination=desk==='crew'?'personnel':desk==='maintenance'?'maintenance':desk==='dispatch'?'planning':['fleet','resources'].includes(desk)?'planning':'incidents';
  setDeskOpen(destination,true,{persist:true});
  markUiDirty('desk');
  document.getElementById(`occ-desk-${destination}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeDesk(){}
function operationalAirportCodes(){
  const now=simNow(),flights=state.flights.filter(f=>!f.cancelled&&flightActualDeparture(f)<now+24*HOUR&&flightActualArrival(f)>now);
  const used=new Set([state.home,...flights.flatMap(f=>[f.from,flightOperationalDestination(f)]),...state.slotRights.map(right=>right.airport),...Object.keys(state.personnel.assignments||{})]);
  return Object.keys(AIRPORTS).filter(code=>used.has(code));
}
function weatherIcon(weather){
  const text=`${weather?.label||''} ${weather?.conditions||''} ${weather?.type||''}`.toLowerCase();
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
    const title=`${weather.conditions} · wind ${weather.windDirection}°/${weather.windKph}G${weather.gustKph} km/h · vis ${weather.visibilityKm} km · ceiling ${weather.ceilingFt} ft · expected delay ${weather.delayMin} min`;
    return `<div class="weather-chip ${weather.level==='severe'?'severe':weather.level==='caution'?'warning':''}" title="${esc(title)}"><span class="weather-icon" aria-hidden="true">${weatherIcon(weather)}</span><b>${esc(code)}</b><span>${esc(weather.conditions)}</span><em>${Math.round(weather.capacityFactor*100)}%</em></div>`;
  }).join(''):'<div class="weather-chip empty"><span class="weather-icon" aria-hidden="true">☀</span><b>No active stations</b></div>'}</div>`;
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
  const active=operationalIndex(now).activeFlights;
  let upcomingCount=0;
  const completed=[];
  for(const f of state.flights){
    if(f.cancelled) continue;
    const departure=flightActualDeparture(f);
    if(departure>now&&departure<=now+24*HOUR) upcomingCount++;
    if(f.settled) completed.push(f);
  }
  const recentCompleted=completed.slice(-50);
  const onTime=recentCompleted.length?Math.round(recentCompleted.filter(f=>flightTotalDepartureDelayMin(f)<=15).length/recentCompleted.length*100):100;
  document.getElementById('simClock').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(now));
  document.getElementById('headerActive').textContent=active.length;
  document.getElementById('headerUpcoming').textContent=upcomingCount;
  document.getElementById('headerOnTime').textContent=`${onTime}%`;
}
function refreshKPIs(){ refreshHeader(); }

function setHomeBase(code){
  if(!AIRPORTS[code]) return;
  state.home=code;
  save();
  populateManagementControls();
  refreshAircraftSelect(true);
  refreshManagement(true);
  refreshSchedulePreview();
  markUiDirty('header','desk','left','filter','weather','map');
  toast(`Home base set to ${code}.`);
}

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
function scheduleCrewDutyLaneItems(duties){
  const laneEnds=[];
  const visualBuffer=20*MIN;
  return duties.slice()
    .sort((a,b)=>a.dutyStart-b.dutyStart||a.dutyEnd-b.dutyEnd||String(a.id).localeCompare(String(b.id)))
    .map(duty=>{
      let lane=laneEnds.findIndex(end=>duty.dutyStart>=end);
      if(lane<0){ lane=laneEnds.length; laneEnds.push(0); }
      laneEnds[lane]=duty.dutyEnd+visualBuffer;
      return {duty,lane};
    });
}

function scheduleCrewDutyMarkup(duty,start,end,pxPerHour,lane=0,focusIds=new Set(),nightLaneCount=1){
  const clippedStart=Math.max(start,duty.dutyStart),clippedEnd=Math.min(end,duty.dutyEnd);
  if(clippedEnd<=clippedStart) return '';
  const left=(clippedStart-start)/HOUR*pxPerHour,width=Math.max(8,(clippedEnd-clippedStart)/HOUR*pxPerHour);
  const now=simNow(),elapsed=clamp((now-duty.dutyStart)/(duty.dutyEnd-duty.dutyStart||1),0,1);
  const margin=Number(duty.maxHours||0)-Number(duty.dutyHours||0);
  const stateClass=!duty.legal?'illegal':margin<1.5?'warning':duty.status==='active'?'active':'legal';
  const selected=duty.flightIds?.includes(selectedFlightId);
  const focused=(duty.flightIds||[]).some(id=>focusIds.has(id));
  const swaps=(duty.roleSwaps||[]).map(swap=>PERSONNEL[swap.role]?.label||swap.role);
  const augmentation=duty.augmented?' · augmented crew planned':'';
  const label=`Crew duty · rel ${shortClock(duty.releaseAt)}`;
  const title=`${duty.flightIds.join(' + ')} · report ${shortClock(duty.reportAt)} · release ${shortClock(duty.releaseAt)} · duty ${Number(duty.dutyHours||0).toFixed(1)} h of ${Number(duty.maxHours||0).toFixed(1)} h max · ${duty.sectors} sector${duty.sectors===1?'':'s'}${augmentation} · ${duty.label}${swaps.length?` · role replacement: ${swaps.join(', ')}`:''}`;
  const nightOffset=Math.max(0,nightLaneCount-1)*16;
  return `<div class="crew-duty-bar ${stateClass} ${duty.augmented?'augmented':''} ${focused?'focus':''} ${selected?'selected':''} ${swaps.length?'has-role-swap':''}" data-crew-duty="${esc(duty.id)}" title="${esc(title)}" style="left:${left}px;width:${width}px;--crew-duty-top:${68+nightOffset+lane*17}px"><span style="width:${formatPct(elapsed)}"></span><b>${esc(label)}</b>${swaps.length?`<em>${esc(swaps.length===1?swaps[0]:'roles')}</em>`:''}</div>`;
}
function scheduleNightMarkerInfo(flight){
  const conflict=Number(flight.nightRestrictionConflictDelayMin)||0;
  if(conflict>0){
    const reason=flight.nightRestrictionConflictLabel||'Night curfew decision required';
    return {
      label:'N!',
      className:'conflict',
      title:`${reason} · expected ${shortClock(flightActualDeparture(flight))}-${shortClock(flightActualArrival(flight))} · planned ${shortClock(flight.departure)}-${shortClock(flight.arrival)}`
    };
  }
  const delay=Number(flight.nightRestrictionDelayMin)||0;
  if(delay<=0) return null;
  const reason=flight.nightRestrictionLabel||'Night operations restriction';
  return {
    label:'N',
    title:`${reason} · +${delay} min · expected departure ${shortClock(flightActualDeparture(flight))}`
  };
}
function scheduleNightWindowConstrained(airportCode,timestamp){
  const status=airportNightStatus(airportCode,timestamp);
  const mode=status.rule?.mode;
  if(mode==='curfew') return status.status==='closed';
  if(mode!=='quota') return false;
  const [hour,minute]=String(status.localTime||'00:00').split(':').map(Number);
  return minuteInWindow((hour||0)*60+(minute||0),status.rule.start,status.rule.end);
}
function scheduleNightWindowNearFlightTime(flight,{airportCode,timestamp,edge},cache){
  const rule=AIRPORT_NIGHT_RULES[airportCode];
  if(!rule||!['curfew','quota'].includes(rule.mode)) return null;
  const step=5*MIN,anchor=Math.floor(timestamp/step)*step,key=`${edge}:${airportCode}:${Math.floor(anchor/step)}`;
  if(cache?.has(key)) return cache.get(key);
  const scanStart=edge==='arrival'?anchor-45*MIN:anchor-14*HOUR;
  const scanEnd=edge==='arrival'?anchor+3*HOUR:anchor+45*MIN;
  let inWindow=false,windowStart=null,windowEnd=null;
  for(let t=scanStart;t<=scanEnd;t+=step){
    const constrained=scheduleNightWindowConstrained(airportCode,t);
    if(constrained&&!inWindow){
      windowStart=t;
      inWindow=true;
    }else if(!constrained&&inWindow){
      windowEnd=t;
      break;
    }
  }
  if(inWindow&&!windowEnd){
    for(let t=scanEnd+step;t<=scanEnd+14*HOUR;t+=step){
      if(!scheduleNightWindowConstrained(airportCode,t)){ windowEnd=t; break; }
    }
  }
  if(windowStart&&scheduleNightWindowConstrained(airportCode,windowStart)){
    for(let t=windowStart-step;t>=windowStart-14*HOUR;t-=step){
      if(!scheduleNightWindowConstrained(airportCode,t)){ windowStart=t+step; break; }
    }
  }
  let result=null;
  if(windowStart!==null&&windowEnd!==null){
    const inside=anchor>=windowStart&&anchor<windowEnd;
    const startsSoon=edge==='arrival'&&windowStart>=anchor&&windowStart-anchor<=2*HOUR;
    const endedRecently=edge==='departure'&&windowEnd<=anchor&&anchor-windowEnd<=2*HOUR;
    if(inside||startsSoon||endedRecently){
      const status=airportNightStatus(airportCode,inside?anchor:windowStart);
      result={
        airport:airportCode,
        flightId:flight.id,
        edge,
        start:windowStart,
        end:windowEnd,
        label:`${rule.start} - ${rule.end}`,
        title:`${airportCode} ${status.rule.label}: ${rule.start}-${rule.end} local · ${status.rule.detail||'Night operations window'}`
      };
    }
  }
  cache?.set(key,result);
  return result;
}
function scheduleArrivalNightWindow(flight,cache){
  return scheduleNightWindowNearFlightTime(flight,{
    airportCode:flightOperationalDestination(flight),
    timestamp:flightActualArrival(flight),
    edge:'arrival'
  },cache);
}
function scheduleDepartureNightWindow(flight,cache){
  return scheduleNightWindowNearFlightTime(flight,{
    airportCode:flight.from,
    timestamp:flightActualDeparture(flight),
    edge:'departure'
  },cache);
}
function scheduleNightWindowLaneItems(flights,cache,focusIds=new Set()){
  const unique=new Map();
  for(const flight of flights){
    const focused=focusIds.has(flight.id),selected=selectedFlightId===flight.id;
    const windows=[scheduleArrivalNightWindow(flight,cache),scheduleDepartureNightWindow(flight,cache)].filter(Boolean);
    for(const info of windows){
      const key=`${info.airport}:${Math.round(info.start/(5*MIN))}:${Math.round(info.end/(5*MIN))}`;
      const existing=unique.get(key);
      if(existing){
        existing.focused ||= focused;
        existing.selected ||= selected;
        if(selected) existing.info={...info};
      }else{
        unique.set(key,{info:{...info},focused,selected,lane:0});
      }
    }
  }
  const laneEnds=[];
  return [...unique.values()]
    .sort((a,b)=>a.info.start-b.info.start||a.info.end-b.info.end||a.info.airport.localeCompare(b.info.airport))
    .map(item=>{
      let lane=laneEnds.findIndex(end=>item.info.start>=end);
      if(lane<0){ lane=laneEnds.length; laneEnds.push(0); }
      laneEnds[lane]=item.info.end+10*MIN;
      item.lane=lane;
      return item;
    });
}
function scheduleNightWindowMarkup(info,start,end,pxPerHour,focusClass='',selected=false,lane=0){
  if(!info) return '';
  const clippedStart=Math.max(start,info.start),clippedEnd=Math.min(end,info.end);
  if(clippedEnd<=clippedStart) return '';
  const left=(clippedStart-start)/HOUR*pxPerHour,width=Math.max(24,(clippedEnd-clippedStart)/HOUR*pxPerHour);
  return `<div class="night-closure-bar ${focusClass} ${selected?'selected':''}" data-night-airport="${esc(info.airport)}" data-night-flight="${esc(info.flightId||'')}" data-night-edge="${esc(info.edge||'')}" title="${esc(info.title)}" style="left:${left}px;width:${width}px;--night-lane-top:${53+lane*16}px"><b>${esc(info.airport)}</b><span>${esc(info.label)}</span></div>`;
}
function flightArrivalDelayMin(flight){
  return Math.max(0,Math.round((flightActualArrival(flight)-flight.arrival)/MIN));
}
function flightDelayAnalysis(flight,index=null){
  const depDelay=flightTotalDepartureDelayMin(flight),arrDelay=flightArrivalDelayMin(flight);
  const totalDelay=Math.max(depDelay,arrDelay);
  if(totalDelay<=0) return {active:false,depDelay,arrDelay,totalDelay,primary:null,causes:[],tooltipLines:[]};
  const previous=index?.previousFlightById?.get(flight.id)||previousAircraftFlight(flight);
  const context=slotMissContextForFlight(flight,previous);
  const causes=(context.causeBreakdown||[]).filter(item=>item.minutes>0).map(item=>({...item}));
  if((Number(flight.enrouteDelayMin)||0)>0) causes.push({label:'Enroute delay',minutes:Math.round(Number(flight.enrouteDelayMin)||0),detail:flight.enrouteDelayCause||'Airborne routing, holding, or flight-deck operational impact'});
  if(arrDelay>depDelay && !(Number(flight.enrouteDelayMin)||0)) causes.push({label:'Arrival delay',minutes:arrDelay-depDelay,detail:'Arrival moved later than departure delay alone'});
  if(!causes.length) causes.push({label:'Recorded timing shift',minutes:totalDelay,detail:'Actual timing differs from plan'});
  const ordered=causes.sort((a,b)=>b.minutes-a.minutes||a.label.localeCompare(b.label)).slice(0,6);
  const primary=ordered[0]||null;
  const lines=[
    `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`,
    `Planned ${shortClock(flight.departure)}–${shortClock(flight.arrival)} · Actual ${shortClock(flightActualDeparture(flight))}–${shortClock(flightActualArrival(flight))}`,
    `Delay: departure +${depDelay} min · arrival +${arrDelay} min`,
    primary?`Primary cause: ${primary.label} · +${primary.minutes} min`:null,
    ...ordered.slice(1,4).map(item=>`Contributing: ${item.label} · +${item.minutes} min`)
  ].filter(Boolean);
  return {active:true,depDelay,arrDelay,totalDelay,primary,causes:ordered,tooltipLines:lines};
}
function scheduleFlightHasTimingShift(flight){
  if(!flight) return false;
  const threshold=5*MIN;
  return Math.abs(flightActualDeparture(flight)-flight.departure)>=threshold ||
    Math.abs(flightActualArrival(flight)-flight.arrival)>=threshold ||
    Boolean(flight.slotMissed) ||
    (Number(flight.nightRestrictionDelayMin)||0)>0;
}
function scheduleFlightStatusClass(flight,now=simNow()){
  const status=statusOfFlight(flight,now);
  if(status==='cancelled') return status;
  return flightTotalDepartureDelayMin(flight)>0||flightArrivalDelayMin(flight)>0 ? 'delayed' : status;
}
function scheduleFocusedFlightIds(){
  const ids=new Set();
  const selected=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  if(!selected) return ids;
  ids.add(selected.id);
  const rotation=rotationForFlight(selected);
  if(rotation.outbound?.id) ids.add(rotation.outbound.id);
  if(rotation.returnFlight?.id) ids.add(rotation.returnFlight.id);
  return ids;
}
function scrollSelectedScheduleFlightIntoView(){
  const block=document.querySelector('#schedule-board .flight-block.selected'),scroll=document.getElementById('schedule-scroll'),row=block?.closest('.sched-aircraft-row');
  if(!block||!scroll||!row) return;
  scroll.scrollTo({left:Math.max(0,block.offsetLeft+122-scroll.clientWidth/2+block.offsetWidth/2),top:Math.max(0,row.offsetTop-scroll.clientHeight/2+row.offsetHeight/2),behavior:'smooth'});
}
function scheduleLateInboundWarnings(flights,t=simNow(),index=operationalIndex(t)){
  return flights
    .map(flight=>({flight,status:lateInboundStatusForFlight(flight,t,{index})}))
    .filter(item=>item.status.active);
}
function scheduleAircraftRowBadges(aircraft,flights,lateInboundById,now=simNow()){
  if(!flights.length) return '';
  let delayed=0,incidents=0,lateInbound=0,night=0,cancelled=0,shortTurns=0;
  for(let i=0;i<flights.length;i++){
    const flight=flights[i];
    if(flight.cancelled) cancelled++;
    else if(flightTotalDepartureDelayMin(flight)>0||flightArrivalDelayMin(flight)>0) delayed++;
    if(openIncidentsForFlight(flight.id).length) incidents++;
    if(lateInboundById.get(flight.id)) lateInbound++;
    if(scheduleNightMarkerInfo(flight)) night++;
    if(i>0&&turnaroundGapInfo(flights[i-1],flight,aircraft)?.belowMinimum) shortTurns++;
  }
  const badges=[
    delayed?{className:'delayed',label:`${delayed} delayed`}:null,
    incidents?{className:'incident',label:`${incidents} incident${incidents===1?'':'s'}`}:null,
    lateInbound?{className:'late',label:`${lateInbound} late inbound${lateInbound===1?'':'s'}`}:null,
    shortTurns?{className:'short-turn',label:`${shortTurns} min turn`}:null,
    night?{className:'night',label:`${night} night`}:null,
    cancelled?{className:'cancelled',label:`${cancelled} cancelled`}:null
  ].filter(Boolean);
  if(!badges.length) return '';
  const title=badges.map(item=>item.label).join(' · ');
  return `<div class="sched-row-badges" title="${esc(title)}">${badges.slice(0,3).map(item=>`<span class="row-badge ${esc(item.className)}">${esc(item.label)}</span>`).join('')}${badges.length>3?`<span class="row-badge more">+${badges.length-3}</span>`:''}</div>`;
}
function updateScheduleAlerts(warnings){
  const element=document.getElementById('scheduleAlerts');
  if(!element) return;
  element.innerHTML=warnings.length
    ? `<span class="schedule-alert late-inbound" title="${esc(warnings.map(item=>`${item.flight.id}: +${item.status.delayMin} min from ${item.status.previousFlightId}`).join(' · '))}">${warnings.length} late inbound${warnings.length===1?'':'s'}</span>`
    : '';
}
function refreshScheduleTimeline(force=false){
  const board=document.getElementById('schedule-board'); if(!board) return;
  const focusIds=scheduleFocusedFlightIds();
  board.classList.toggle('has-selected-flight',focusIds.size>0);
  const {start,end,now}=scheduleWindow(),pxPerHour=scheduleRangeHours===24?84:48,timeWidth=Math.round(scheduleRangeHours*pxPerHour),labelWidth=122;
  const index=operationalIndex(now);
  const relevantRaw=state.flights.filter(f=>
    (flightActualArrival(f)>start&&flightActualDeparture(f)<end) ||
    (f.arrival>start&&f.departure<end)
  ).sort((a,b)=>Math.min(a.departure,flightActualDeparture(a))-Math.min(b.departure,flightActualDeparture(b)));
  const relevant=filterFlightsForOperations(relevantRaw,now);
  const relevantIds=new Set(relevant.map(flight=>flight.id));
  const relevantByAircraft=new Map();
  for(const flight of relevant) mapPush(relevantByAircraft,flight.aircraftId,flight);
  for(const flights of relevantByAircraft.values()) flights.sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const dutyByAircraft=new Map();
  for(const duty of state.crewDuties||[]){
    if(duty.dutyEnd<=start||duty.dutyStart>=end) continue;
    if(operationFilterActive()&&!(duty.flightIds||[]).some(id=>relevantIds.has(id))) continue;
    mapPush(dutyByAircraft,duty.aircraftId,duty);
  }
  const lateInboundWarnings=scheduleLateInboundWarnings(relevant,now,index);
  const lateInboundById=new Map(lateInboundWarnings.map(item=>[item.flight.id,item.status]));
  const nightWindowCache=new Map();
  updateScheduleAlerts(lateInboundWarnings);
  const visibleAircraft=operationFilterActive()
    ? state.aircraft.filter(ac=>relevantByAircraft.has(ac.id))
    : state.aircraft;
  const signature=[Math.floor(start/MIN),scheduleRangeHours,operationFilterSummary(),selectedFlightId||'',selectedAircraftId||'',Array.from(focusIds).sort().join(','),relevant.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.aircraftId}:${flightSlotImpactState(f,now).state}:${f.assignedSlot||0}:${f.cancelled?1:0}:${f.crewDutyId||''}:${f.crewDutySplit?1:0}:${f.nightRestrictionDelayMin||0}:${f.nightRestrictionLabel||''}:${f.nightRestrictionConflictDelayMin||0}:${f.nightRestrictionConflictLabel||''}:${scheduleFlightHasTimingShift(f)?1:0}:${lateInboundById.get(f.id)?.delayMin||0}:${lateInboundById.get(f.id)?.inboundReadyAt||0}:${openIncidentsForFlight(f.id).length}`).join(','),(state.crewDuties||[]).map(d=>`${d.id}:${d.dutyStart}:${d.dutyEnd}:${d.legal?1:0}:${d.status}`).join(','),visibleAircraft.map(a=>a.id).join(',')].join('|');
  if(force||signature!==lastScheduleSignature){
    lastScheduleSignature=signature;
    let html='<div class="sched-header-row"><div class="sched-label"><b>Aircraft</b></div><div class="sched-timearea" style="width:'+timeWidth+'px">';
    for(let h=0;h<=scheduleRangeHours;h++){
      const ts=start+h*HOUR,left=h*pxPerHour,major=new Date(ts).getHours()%6===0;
      html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      if(h<scheduleRangeHours&&(scheduleRangeHours===24||h%2===0)) html+=`<span class="sched-time-label" style="left:${left}px">${shortClock(ts)}</span>`;
    }
    html+='<div id="scheduleNowHeader" class="now-label" style="display:none">NOW</div></div></div>';
    for(const ac of visibleAircraft){
      const flights=relevantByAircraft.get(ac.id)||[];
      const dutyItems=scheduleCrewDutyLaneItems(dutyByAircraft.get(ac.id)||[]);
      const dutyLaneCount=Math.max(1,...dutyItems.map(item=>item.lane+1));
      const nightItems=scheduleNightWindowLaneItems(flights,nightWindowCache,focusIds);
      const nightLaneCount=Math.max(1,...nightItems.map(item=>item.lane+1));
      const rowHeight=90+Math.max(0,dutyLaneCount-1)*17+Math.max(0,nightLaneCount-1)*16;
      const rowBadges=scheduleAircraftRowBadges(ac,flights,lateInboundById,now);
      html+=`<div class="sched-aircraft-row ${flights.some(f=>focusIds.has(f.id))?'selected-row':''}" data-sched-aircraft="${esc(ac.id)}" style="height:${rowHeight}px;--crew-duty-lanes:${dutyLaneCount};--night-lanes:${nightLaneCount}"><div class="sched-label"><div class="sched-tail">${esc(ac.tail)}</div><div class="sched-model">${esc(ac.model)}</div>${rowBadges}</div><div class="sched-timearea" style="width:${timeWidth}px">`;
      for(let h=0;h<=scheduleRangeHours;h++) html+=`<span class="sched-gridline ${new Date(start+h*HOUR).getHours()%6===0?'major':''}" style="left:${h*pxPerHour}px"></span>`;
      for(const item of nightItems){
        html+=scheduleNightWindowMarkup(item.info,start,end,pxPerHour,item.focused?'focus':'',item.selected,item.lane);
      }
      for(const {duty,lane} of dutyItems){
        html+=scheduleCrewDutyMarkup(duty,start,end,pxPerHour,lane,focusIds,nightLaneCount);
      }
      for(let i=0;i<flights.length;i++){
        const f=flights[i],actualDep=flightActualDeparture(f),actualArr=flightActualArrival(f),clippedStart=Math.max(start,actualDep),clippedEnd=Math.min(end,actualArr);
        const left=(clippedStart-start)/HOUR*pxPerHour,width=Math.max(6,(clippedEnd-clippedStart)/HOUR*pxPerHour),st=scheduleFlightStatusClass(f,now),delay=flightTotalDepartureDelayMin(f),destination=flightOperationalDestination(f);
        const focused=focusIds.has(f.id),selected=selectedFlightId===f.id;
        const focusClass=focused?'focus':'';
        const night=scheduleNightMarkerInfo(f);
        const lateInbound=lateInboundById.get(f.id);
        const positionContext=f.positioningBlocked?aircraftOutOfPositionContextForFlight(f):null;
        if(f.departure>=start&&f.departure<=end){
          const markerLeft=(f.departure-start)/HOUR*pxPerHour;
          const slot=flightSlotImpactState(f,now);
          html+=`<span class="slot-marker planned ${slot.impacted?slot.state:''} ${focusClass} ${selected?'selected':''}" data-slot-flight="${esc(f.id)}" title="${esc(slot.title||`${f.from} planned slot ${shortClock(f.departure)}`)}" style="left:${markerLeft}px"><span class="slot-label">${esc(`${f.id} ${shortClock(f.departure)}`)}</span></span>`;
        }
        if(f.slotMissed&&f.assignedSlot>=start&&f.assignedSlot<=end) html+=`<span class="slot-marker reassigned ${focusClass} ${selected?'selected':''}" data-slot-flight="${esc(f.id)}" title="${esc(`${f.from} reassigned slot ${shortClock(f.assignedSlot)}`)}" style="left:${(f.assignedSlot-start)/HOUR*pxPerHour}px"><span class="slot-label">${esc(`${f.id} ${shortClock(f.assignedSlot)}`)}</span></span>`;
        const shifted=scheduleFlightHasTimingShift(f);
        if(shifted&&focused){
          const plannedStart=Math.max(start,f.departure),plannedEnd=Math.min(end,f.arrival);
          if(plannedEnd>plannedStart) html+=`<div class="planned-flight-block ${night&&!night.className?'has-night-marker':''} ${focusClass} ${selected?'selected':''}" data-flight-id="${esc(f.id)}" title="${esc(`${f.id} planned ${shortClock(f.departure)}–${shortClock(f.arrival)}${night&&!night.className?` · ${night.title}`:''}`)}" style="left:${(plannedStart-start)/HOUR*pxPerHour}px;width:${Math.max(6,(plannedEnd-plannedStart)/HOUR*pxPerHour)}px"><span class="planned-flight-label">${esc(`${f.id} ${shortClock(f.departure)}`)}</span>${night&&!night.className?`<span class="flight-night-marker" title="${esc(night.title)}">${esc(night.label)}</span>`:''}</div>`;
        }
        const delayAnalysis=flightDelayAnalysis(f,index);
        const flightTitle=[
          ...(delayAnalysis.active?delayAnalysis.tooltipLines:[`${f.id} · ${f.from} → ${destination}`,shifted?`Planned ${shortClock(f.departure)}–${shortClock(f.arrival)} · Actual ${shortClock(actualDep)}–${shortClock(actualArr)}`:null]),
          positionContext?`Aircraft positioning: expected ${positionContext.expectedLocation}, required ${positionContext.requiredLocation}`:null,
          lateInbound?.title,
          night?.title
        ].filter(Boolean).join('\n');
        if(clippedEnd>clippedStart) html+=`<div class="flight-block ${st} ${shifted?'shifted':''} ${lateInbound?'late-inbound-risk':''} ${positionContext?'positioning-conflict':''} ${night?'has-night-marker':''} ${focusClass} ${selected?'selected':''}" data-flight-id="${esc(f.id)}" title="${esc(flightTitle)}" style="left:${left}px;width:${width}px"><div class="flight-code">${esc(f.id)}${delay?` <span class="delay-text">+${delay}</span>`:''}</div>${lateInbound?`<span class="flight-late-inbound" title="${esc(lateInbound.title)}">IN</span>`:''}${night?`<span class="flight-night-marker ${esc(night.className||'')}" title="${esc(night.title)}">${esc(night.label)}</span>`:''}<div class="flight-route">${esc(f.from)} → ${esc(destination)}</div><div class="flight-times">${shifted?`<span class="sched">S ${shortClock(f.departure)}</span> · <span class="actual">A ${shortClock(actualDep)}</span>`:`${shortClock(actualDep)}–${shortClock(actualArr)}`}</div></div>`;
        const next=flights[i+1];
        if(next){
          const nextDep=flightActualDeparture(next),gapMs=nextDep-actualArr,turn=turnaroundGapInfo(f,next,ac);
          const connectorShortTurn=Boolean(turn?.belowMinimum),drawPositiveGap=nextDep>actualArr;
          if(drawPositiveGap||connectorShortTurn){
            const same=destination===next.from,connectionFocused=focusIds.has(f.id)&&focusIds.has(next.id);
            const connectorLateInbound=Boolean(lateInboundById.get(next.id));
            const gapStart=drawPositiveGap?Math.max(start,actualArr):Math.max(start,Math.min(end,actualArr));
            const gapEnd=drawPositiveGap?Math.min(end,nextDep):gapStart;
            const warningWidth=Math.max(8,Math.min(28,pxPerHour*.16));
            const connLeft=drawPositiveGap
              ? (gapStart-start)/HOUR*pxPerHour
              : Math.max(0,Math.min(timeWidth-warningWidth,(gapStart-start)/HOUR*pxPerHour-warningWidth/2));
            const connWidth=drawPositiveGap?Math.max(3,(gapEnd-gapStart)/HOUR*pxPerHour):warningWidth;
            const visibleGap=!drawPositiveGap||gapEnd>gapStart;
            if(visibleGap&&connWidth>0&&connLeft<timeWidth){
              const titleParts=[
                turn?.title||`${f.id} to ${next.id}: ground time ${formatDuration(Math.max(0,gapMs))}`,
                connectorLateInbound?'late inbound rotation warning':null
              ].filter(Boolean);
              const label=connectorShortTurn&&turn
                ? `${Math.max(0,turn.actualGapMin)}/${turn.minimumMin}m`
                : formatDuration(gapMs);
              html+=`<span class="connection-label ${connectorLateInbound?'late-inbound':''} ${connectorShortTurn?'short-turn':''} ${connectionFocused?'focus':''}" title="${esc(titleParts.join(' · '))}" style="left:${connLeft+connWidth/2}px">${esc(label)}</span>`;
              html+=`<span class="connection-line ${same?'':'mismatch'} ${connectorLateInbound?'late-inbound':''} ${connectorShortTurn?'short-turn':''} ${connectionFocused?'focus':''}" title="${esc(titleParts.join(' · '))}" style="left:${connLeft}px;width:${connWidth}px"></span>`;
            }
          }
        }
      }
      html+='<div class="now-line schedule-now-row" style="display:none"></div></div></div>';
    }
    if(!state.aircraft.length) html+='<div class="schedule-empty">No aircraft in fleet.</div>';
    else if(!visibleAircraft.length) html+='<div class="schedule-empty">No scheduled flights match the current filter.</div>';
    board.innerHTML=html; board.style.width=(labelWidth+timeWidth)+'px';
    board.onclick=event=>{
      if(!selectedFlightId) return;
      if(event.target.closest('[data-flight-id],[data-slot-flight],[data-crew-duty]')) return;
      clearOperationalSelection();
    };
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
function centerScheduleOnNow(){ scheduleWindowOffsetHours=-2;markUiDirty('schedule');document.getElementById('schedule-scroll').scrollLeft=0; }

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring',ferry=scheduleTypeEl.value==='ferry';
  document.getElementById('repeatRuleWrap').hidden=!recurring;
  document.getElementById('turnaroundWrap').hidden=!recurring;
  if(ferry){
    const ac=state.aircraft.find(item=>item.id===aircraftEl.value),departure=nextTimestampForClock(departureTimeEl.value);
    const projected=ac&&aircraftProjectedLocation(ac,departure||simNow());
    if(projected?.location&&AIRPORTS[projected.location]) originEl.value=projected.location;
  }
  refreshSchedulePreview();
}
function refreshSchedulePreview(){
  const ac=state.aircraft.find(item=>item.id===aircraftEl.value),from=originEl.value,to=destEl.value,departure=nextTimestampForClock(departureTimeEl.value);
  if(!ac||!departure||from===to){document.getElementById('schedulePreview').textContent='Choose an aircraft, two airports, and a departure time.';return;}
  const ferry=scheduleTypeEl.value==='ferry',estimate=ferry?estimateFerryFlight(from,to,ac,departure):estimateFlight(from,to,ac,currentScheduleFares(),{departure});
  let message=`${Math.round(estimate.km)} km · ${formatDuration(estimate.duration)} block time · ${estimate.rangeOk?'within range':'outside aircraft range'}`;
  if(!ferry) message+=` · projected ${estimate.pax||0} passengers`;
  const routeMinimumTurn=minimumTurnMinutes(ac,to);
  message+=` · min turn at ${to} ${routeMinimumTurn} min`;
  const night=flightNightRestriction({from,to,departure,arrival:departure+estimate.duration,operationalDurationMs:estimate.duration,enrouteDelayMin:0},departure);
  if(night.delayMin) message+=` · ${night.reason} +${night.delayMin} min`;
  if(scheduleTypeEl.value==='recurring'){
    const requestedTurnaround=Number(turnaroundEl.value)||90;
    const effectiveTurnaround=effectiveTurnaroundMinutes(ac,to,requestedTurnaround);
    const plan=requiredSlotPlan(from,to,ac,currentScheduleFares(),departure,effectiveTurnaround),missing=[];
    if(!plan.originRight) missing.push(`${from} ${shortClock(plan.outboundDeparture)}`);
    if(!plan.destinationRight) missing.push(`${to} ${shortClock(plan.returnDeparture)}`);
    message+=effectiveTurnaround>requestedTurnaround
      ? ` · requested turn raised to ${effectiveTurnaround} min`
      : ` · requested turn ${effectiveTurnaround} min`;
    message+=missing.length?` · slot series will be requested: ${missing.join(', ')}`:' · both slot series owned';
  }
  document.getElementById('schedulePreview').innerHTML=`<b>${esc(ac.tail)} · ${esc(from)} → ${esc(to)}</b><br>${esc(message)}`;
}

function optionList(values,label){ return values.map(value=>`<option value="${esc(value)}">${esc(label(value))}</option>`).join(''); }
function populateManagementControls(){
  const airports=Object.keys(AIRPORTS);
  [originEl,destEl,document.getElementById('managementAircraftDelivery'),document.getElementById('personnelAirport'),document.getElementById('transferPersonnelFrom'),document.getElementById('transferPersonnelTo'),document.getElementById('homeBaseSelect')].filter(Boolean).forEach(select=>{
    select.innerHTML=optionList(airports,code=>`${code} — ${AIRPORTS[code].name}`);
  });
  document.getElementById('homeBaseSelect').value=state.home;
  originEl.value=state.home; destEl.value=airports.find(code=>code!==state.home)||airports[0];
  document.getElementById('managementAircraftDelivery').value=state.home;
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

function aircraftRequest(){
  const modelName=document.getElementById('managementAircraftModel').value,model=MODELS[modelName]; if(!model) return null;
  const deliveryAirport=document.getElementById('managementAircraftDelivery').value;
  return {modelName,model,deliveryAirport,cabin:defaultCabin(modelName)};
}
function refreshAircraftRequestPreview(){
  const request=aircraftRequest(); if(!request) return;
  const supply=resourceAvailability('aircraft',request.modelName,request.deliveryAirport);
  const minimumTurn=minimumTurnMinutes({model:request.modelName},request.deliveryAirport);
  document.getElementById('aircraftRequestPreview').innerHTML=`<b>${esc(request.modelName)} · ${request.model.seats} passenger seats · ${esc(request.deliveryAirport)}</b><br>${request.model.maxRangeKm.toLocaleString()} km range · min turn ${minimumTurn} min at ${esc(request.deliveryAirport)} · ${supply.available?'available now':`allocation lead about ${supply.leadMin} min`}`;
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
  state.personnelTransfers.push(transfer); save(); markUiDirty('all'); toast(`${id} booked.`);
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
  refreshAircraftSelect(force); refreshAircraftRequestPreview(); refreshPersonnelRequestPreview(); refreshPersonnelTransferOptions();
  renderManagementAircraft(); renderManagementPersonnel(); renderPersonnelTransfers(); refreshMaintenance(); refreshSchedulePreview();
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
  const apply=clientY=>{const rect=workspace.getBoundingClientRect(),usable=Math.max(1,rect.height-7);pct=clamp((clientY-rect.top)/usable*100,22,78);mapPane.style.flexBasis=pct+'%';localStorage.setItem('aerosim_next_center_split_pct',String(pct));requestAnimationFrame(invalidateMapSize);};
  splitter.addEventListener('pointerdown',event=>{dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture(event.pointerId);});
  splitter.addEventListener('pointermove',event=>{if(dragging)apply(event.clientY);});
  const stop=event=>{if(!dragging)return;dragging=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture(event.pointerId);}catch(_){}};
  splitter.addEventListener('pointerup',stop); splitter.addEventListener('pointercancel',stop);
}

function refreshAll(){
  processEvents(); recalculateOperations(); checkActionableIncidentDing(); refreshHeader(); refreshAircraftSelect(true); renderOperationFilterBar(true); refreshCorporateResources(true); refreshOccWidgets(true); refreshFleetList(true); refreshMaintenanceRail(true); refreshDepartmentWidgets(true); renderContext(true); refreshManagement(true); updateMapData(); refreshWeather(true); refreshScheduleTimeline(true);
}

populateManagementControls();
refreshAircraftSelect(true);
refreshScheduleMode();
refreshAircraftRequestPreview();
refreshPersonnelRequestPreview();
refreshPersonnelTransferOptions();
document.getElementById('speed').value=String(state.clock.speed);

document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>showWorkspace(button.dataset.workspace)));
document.querySelectorAll('[data-management-page]').forEach(button=>button.addEventListener('click',()=>showManagementPage(button.dataset.managementPage)));
document.getElementById('taskInboxButton')?.addEventListener('click',()=>{showWorkspace('operations');contextMode='inbox';markUiDirty('context');});
scheduleBtn.addEventListener('click',scheduleFlight);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,destEl,departureTimeEl,repeatRuleEl,turnaroundEl].forEach(element=>{element.addEventListener('change',refreshSchedulePreview);element.addEventListener('input',refreshSchedulePreview);});
aircraftEl.addEventListener('change',()=>{const ac=state.aircraft.find(item=>item.id===aircraftEl.value);if(ac)originEl.value=ac.location;refreshScheduleMode();});

['managementAircraftModel','managementAircraftDelivery'].forEach(id=>document.getElementById(id).addEventListener('input',refreshAircraftRequestPreview));
document.getElementById('requestAircraftButton').addEventListener('click',()=>{const request=aircraftRequest();if(request){requestAircraft(request.modelName,request.cabin,request.deliveryAirport);markUiDirty('all');}});
document.getElementById('homeBaseSelect').addEventListener('change',event=>setHomeBase(event.target.value));
['personnelRole','personnelAirport','personnelQualification','personnelAmount'].forEach(id=>document.getElementById(id).addEventListener('input',refreshPersonnelRequestPreview));
document.getElementById('requestPersonnelBtn').addEventListener('click',()=>{
  const role=document.getElementById('personnelRole').value,airport=document.getElementById('personnelAirport').value,amount=clamp(Math.floor(Number(document.getElementById('personnelAmount').value)||1),1,50),qualification=document.getElementById('personnelQualification').value;
  const result=requestPersonnelResource(role,airport,amount,qualification); markUiDirty('all'); toast(result?.status==='delivered'?`${amount} ${PERSONNEL[role].label.toLowerCase()} assigned at ${airport}.`:`Personnel request submitted for ${airport}.`);
});
['transferPersonnelRole','transferPersonnelAmount','transferPersonnelFrom','transferPersonnelTo','transferPersonnelMethod','transferPersonnelFlight'].forEach(id=>document.getElementById(id).addEventListener('input',refreshPersonnelTransferOptions));
document.getElementById('transferPersonnelBtn').addEventListener('click',createPersonnelTransfer);

document.getElementById('speed').addEventListener('change',event=>{rebaseClock(Number(event.target.value));markUiDirty('all');toast(event.target.value==='1'?'Realtime enabled.':'Test acceleration enabled.');});
document.getElementById('schedulePrevBtn').addEventListener('click',()=>{scheduleWindowOffsetHours-=12;markUiDirty('schedule');});
document.getElementById('scheduleNowBtn').addEventListener('click',centerScheduleOnNow);
document.getElementById('scheduleNextBtn').addEventListener('click',()=>{scheduleWindowOffsetHours+=12;markUiDirty('schedule');});
document.getElementById('scheduleRange').addEventListener('change',event=>{scheduleRangeHours=Number(event.target.value)||24;markUiDirty('schedule');});
function confirmLocalReset(){
  if(window.confirm('Delete this local airline save? Aircraft, flights, schedules, tasks, and slot rights will be removed.')) resetLocalSave();
}
document.getElementById('resetBtn')?.addEventListener('click',confirmLocalReset);
document.getElementById('resetTopbarBtn')?.addEventListener('click',confirmLocalReset);
window.addEventListener('pointerdown',armIncidentDing,{passive:true});
window.addEventListener('keydown',armIncidentDing);
bindRailWidgetToggles();
initWorkspaceSplitter();
refreshRailCollapseState();
refreshWeather(true);
