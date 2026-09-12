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
const APP_TITLE='Airline Operations Control Center';

let nextWorkspace='operations';
let managementPage='planning';
let contextMode='context';
let lastContextSignature='';
let lastAircraftListSignature='';
let lastMaintenanceListSignature='';
let lastCorporateResourcesSignature='';
let lastPersonnelRailSignature='';
let lastManagementSignature='';
let lastDeskStackSignature='';
const expandedEmptyDesks=new Set();
let lastWeatherStripSignature='';
let lastOperationFilterSignature='';
let dispatchSwapEditorFlightId='';
let problemSoundInitialized=false;
let knownActionableProblemIds=new Set();
let problemAudioContext=null;
let problemAudioContextCtor=null;
let problemAudioReady=false;
let problemDingRetryTimer=0;
let operationFilterCache={key:'',weatherFlightIds:new Set(),weatherCount:0};

function invalidateMapSize(){
  if(typeof map!=='undefined'&&typeof map.invalidateSize==='function') map.invalidateSize({animate:false});
}

const NextRender=(()=>{
  const dirty=new Set();
  let scheduled=false;
  const allViews=['header','selects','filter','left','desk','context','management','map','weather','schedule'];
  const run=(label,fn)=>{
    try{ fn(); }
    catch(error){ console.error(`AOC render failed: ${label}`,error); }
  };
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
    if(dirty.has('header')) run('header',()=>refreshHeader());
    if(dirty.has('selects')) run('selects',()=>refreshAircraftSelect(true));
    if(dirty.has('left')) run('left rail',()=>{ lastCorporateResourcesSignature=''; lastAircraftListSignature=''; lastMaintenanceListSignature=''; lastPersonnelRailSignature=''; refreshCorporateResources(true); refreshPersonnelRail(true); refreshFleetList(true); refreshMaintenanceRail(true); });
    if(dirty.has('desk')) run('right desk',()=>{ lastDeskStackSignature=''; renderDeskStack(true); });
    if(dirty.has('context')) run('context',()=>{ lastContextSignature=''; renderContext(true); });
    if(dirty.has('schedule')) run('schedule',()=>{ lastScheduleSignature=''; lastScheduleConnectionOverlaySignature=''; refreshScheduleTimeline(true); });
    if(dirty.has('weather')) run('weather strip',()=>{ lastWeatherStripSignature=''; renderWeatherStrip(true); });
    if(dirty.has('filter')) run('filter bar',()=>{ lastOperationFilterSignature=''; renderOperationFilterBar(true); });
    if(dirty.has('management')) run('management',()=>refreshManagement(true));
    if(dirty.has('map')) run('map',()=>updateMapData());
    dirty.clear();
  }
  return {invalidate,flush};
})();
function markUiDirty(...views){ NextRender.invalidate(...views); }
function flushUiDirty(){ NextRender.flush(); }
function noteRenderSurface(surface,mode='rendered'){
  const stats=window.__aocRenderStats??={};
  const bucket=stats[surface]??={rendered:0,skipped:0,lastAt:0,lastMode:''};
  bucket[mode]=(bucket[mode]||0)+1;
  bucket.lastAt=Date.now();
  bucket.lastMode=mode;
  stats[surface]=bucket;
  window.__aocRenderStats=stats;
}
function refreshOperationalSurfacesSoft(){
  refreshHeader();
  renderOperationFilterBar(false);
  refreshCorporateResources(false);
  refreshPersonnelRail(false);
  refreshFleetList(false);
  refreshMaintenanceRail(false);
  renderDeskStack(false);
  renderContext(false);
  renderWeatherStrip(false);
  refreshScheduleTimeline(false);
}

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
  markUiDirty('desk','left');
  return result;
};
settleSelectedFlight=function(flightId){
  contextMode='context';
  if(dispatchSwapEditorFlightId!==flightId) dispatchSwapEditorFlightId='';
  const result=baseSettleSelectedFlight(flightId);
  markUiDirty('desk','left');
  return result;
};

function clearOperationalSelection(){
  selectedFlightId=null;
  selectedAircraftId=null;
  dispatchSwapEditorFlightId='';
  contextMode='context';
  markUiDirty('context','desk','left','schedule','filter','map');
}

workspaceUi.collapsed??={occ:{}};
workspaceUi.collapsed.occ??={};
workspaceUi.collapsed.rail??={};
workspaceUi.nextDeskPanels??={};
workspaceUi.dismissedWarnings??={};
workspaceUi.operationFilter??={airports:[],activeProblems:false,delayed:false,weatherCell:null};
workspaceUi.operationFilter.airports=Array.isArray(workspaceUi.operationFilter.airports)
  ? workspaceUi.operationFilter.airports.filter(code=>AIRPORTS[code])
  : workspaceUi.operationFilter.airport&&AIRPORTS[workspaceUi.operationFilter.airport]?[workspaceUi.operationFilter.airport]:[];
workspaceUi.operationFilter.airport='';
workspaceUi.operationFilter.activeProblems=Boolean(workspaceUi.operationFilter.activeProblems);
workspaceUi.operationFilter.delayed=Boolean(workspaceUi.operationFilter.delayed);
workspaceUi.operationFilter.weatherCell??=null;

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function activeFormControl(){
  const active=document.activeElement;
  return active&&active.matches('select,input,textarea,[contenteditable="true"]')?active:null;
}
function activeFormControlWithin(root){
  const active=activeFormControl();
  return Boolean(root&&active&&root.contains(active));
}
function activeEmbeddedManagementControl(){
  return Boolean(activeFormControl()?.closest('[data-management-content]'));
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
function crewRecoveryAvailabilityLabel(record,now=simNow()){
  if(!record) return '';
  if(record.status!=='confirmed') return responseTimeLabel(record,now);
  if(typeof crewRecoveryRecordIsAvailable==='function'&&crewRecoveryRecordIsAvailable(record,now)){
    return `crew available ${shortClock(Number(record.availableAt)||record.completedAt||record.updatedAt)}`;
  }
  const availableAt=Number(record.availableAt)||now;
  return `available in ${formatDuration(Math.max(0,availableAt-now))}`;
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
  workspaceUi.operationFilter??={airports:[],activeProblems:false,delayed:false,weatherCell:null};
  if(!Array.isArray(workspaceUi.operationFilter.airports)) workspaceUi.operationFilter.airports=[];
  return workspaceUi.operationFilter;
}
function operationFilterSummary(){
  const filter=operationFilter();
  return [
    ...(filter.airports||[]),
    filter.activeProblems?'problems':'',
    filter.delayed?'delayed':'',
    filter.weatherCell?.id||''
  ].filter(Boolean).join('|');
}
function operationFilterActive(){
  const filter=operationFilter();
  return Boolean(filter.airports?.length||filter.activeProblems||filter.delayed||filter.weatherCell?.id);
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
function activeProblemFlightIds(){
  const ids=new Set();
  (state.problems||[])
    .filter(problem=>problem.status==='open')
    .forEach(problem=>{
      const affected=typeof problemAffectedFlightIds==='function'?problemAffectedFlightIds(problem):(problem.flightId?[problem.flightId]:[]);
      affected.forEach(id=>id&&ids.add(id));
    });
  return ids;
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
  if(!cellId||(!window.AeroRoutePlanning?.routeHazardSummaryForFlight&&!window.AeroWeatherEngine?.routeHazards)) return new Set();
  const period=Math.floor(now/(30*MIN));
  const flights=(state.flights||[]).filter(flight=>!flight.cancelled&&!flight.settled&&flightActualArrival(flight)>now-2*HOUR);
  const key=[
    cellId,period,
    flights.map(flight=>`${flight.id}:${flight.from}:${flightOperationalDestination(flight)}:${window.AeroRoutePlanning?.activeRevision?.(window.AeroRoutePlanning?.ensureFlightRoutePlan?.(flight))?.id||'direct'}:${flightActualDeparture(flight)}:${flightActualArrival(flight)}`).join(',')
  ].join('|');
  if(operationFilterCache.key===key) return operationFilterCache.weatherFlightIds;
  const ids=new Set();
  for(const flight of flights){
    const hazardsById=new Map();
    for(const hazard of window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,now)?.hazards||[]) hazardsById.set(hazard.id,hazard);
    for(const hazard of window.AeroWeatherEngine?.routeHazards?.(flight.from,flightOperationalDestination(flight),now)||[]) hazardsById.set(hazard.id,hazard);
    const hazards=[...hazardsById.values()];
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
  if(filter.activeProblems&&!(prepared?.activeProblemIds||activeProblemFlightIds()).has(flight.id)) return false;
  if(filter.delayed&&!flightDelayedForFilter(flight)) return false;
  if(filter.weatherCell?.id&&!(prepared?.weatherFlightIds||weatherFilterFlightIds(now)).has(flight.id)) return false;
  return true;
}
function filterFlightsForOperations(flights,now=simNow()){
  if(!operationFilterActive()) return flights;
  const filter=operationFilter();
  const prepared={
    airportSet:new Set(filter.airports||[]),
    activeProblemIds:activeProblemFlightIds(),
    weatherFlightIds:weatherFilterFlightIds(now)
  };
  return flights.filter(flight=>flightMatchesOperationFilter(flight,now,prepared));
}
function applyOperationFilter(update={}){
  const filter=operationFilter();
  if('airports' in update) filter.airports=Array.isArray(update.airports)?[...new Set(update.airports)].filter(code=>AIRPORTS[code]):[];
  if('airport' in update&&update.airport&&AIRPORTS[update.airport]&&!filter.airports.includes(update.airport)) filter.airports.push(update.airport);
  if('removeAirport' in update) filter.airports=filter.airports.filter(code=>code!==update.removeAirport);
  if('activeProblems' in update) filter.activeProblems=Boolean(update.activeProblems);
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
function clearOperationFilters(){ applyOperationFilter({airports:[],activeProblems:false,delayed:false,weatherCell:null}); }
function deskCollapseKey(desk){ return `next:${desk}`; }
function isDeskOpen(desk){ return workspaceUi.collapsed.occ[deskCollapseKey(desk)]!==true; }
function isRailWidgetOpen(widget){ return workspaceUi.collapsed.rail?.[widget]!==true; }
function activeDeskPanel(desk){ return workspaceUi.nextDeskPanels?.[desk]||''; }
function activeDeskTab(desk){ return activeDeskPanel(desk)||'overview'; }
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
function closeFlightPlanningWidget(){ setDeskPanel('planning',''); markUiDirty('desk'); }
function setWidgetOpen(widget,open,{persist=false}={}){
  const desk=widget?.dataset?.deskWidget;
  if(desk) setDeskOpen(desk,open,{persist});
}
function problemCopy(problem){
  const title=problem?.title||AeroProblemModel.titleForType(problem?.type||'Operational issue');
  return {title:problem?.training?`Training · ${title}`:title,summary:problem?.summary||AeroProblemModel.summaryForType(problem?.type)||'Operational coordination is required.'};
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
  const problem=openProblemsForFlight(flight.id)[0];
  if(problem) return {label:problemCopy(problem).title,critical:Boolean(problem.blocking),problem};
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

function openProblemForAircraft(aircraftId){
  return (operationalIndex().openProblemsByAircraft.get(aircraftId)||[])
    .find(item=>!item.flightId||item.type==='mel_defect')||null;
}

function attentionForAircraft(aircraft){
  const problem=openProblemForAircraft(aircraft.id);
  if(problem) return problemCopy(problem).title;
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
  const crewReady=duty.legal&&!flight.staffingBlocked&&!openProblemsForFlight(flight.id).some(item=>item.type==='crew_sick');
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
  if(activeFormControlWithin(root)||activeEmbeddedManagementControl()) return;
  lastOperationFilterSignature=signature;
  root.innerHTML=`<div class="filter-title"><span>Filters</span><b>${matched.length}/${base.length} flights</b></div>
    <label class="filter-control airport-filter"><span>Airport</span><select data-operation-filter-airport>
      <option value="">Add airport</option>
      ${airports.filter(code=>!selectedAirports.includes(code)).map(code=>`<option value="${esc(code)}">${esc(code)} · ${esc(AIRPORTS[code]?.name||'Airport')}</option>`).join('')}
    </select></label>
    ${selectedAirports.map(code=>`<button class="filter-chip airport" type="button" data-remove-airport-filter="${esc(code)}" title="Remove ${esc(code)} filter"><span>${esc(code)}</span><b>&times;</b></button>`).join('')}
    <button class="filter-toggle ${filter.activeProblems?'active':''}" type="button" data-operation-filter-problems aria-pressed="${filter.activeProblems?'true':'false'}">Active problems</button>
    <button class="filter-toggle ${filter.delayed?'active':''}" type="button" data-operation-filter-delayed aria-pressed="${filter.delayed?'true':'false'}">Delayed</button>
    ${weather?`<button class="filter-chip weather ${weather.severity==='severe'?'severe':'warning'}" type="button" data-clear-weather-filter title="Clear weather filter"><span>${esc(weather.label)}</span><b>${esc(weather.id)}</b></button>`:''}
    ${operationFilterActive()?'<button class="filter-clear" type="button" data-clear-operation-filters>Clear</button>':''}`;
  root.querySelector('[data-operation-filter-airport]')?.addEventListener('change',event=>{applyOperationFilter({airport:event.target.value});event.target.blur();});
  root.querySelectorAll('[data-remove-airport-filter]').forEach(button=>button.addEventListener('click',()=>applyOperationFilter({removeAirport:button.dataset.removeAirportFilter})));
  root.querySelector('[data-operation-filter-problems]')?.addEventListener('click',()=>applyOperationFilter({activeProblems:!operationFilter().activeProblems}));
  root.querySelector('[data-operation-filter-delayed]')?.addEventListener('click',()=>applyOperationFilter({delayed:!operationFilter().delayed}));
  root.querySelector('[data-clear-weather-filter]')?.addEventListener('click',()=>applyOperationFilter({weatherCell:null}));
  root.querySelector('[data-clear-operation-filters]')?.addEventListener('click',clearOperationFilters);
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
    if(selectedAircraftId===button.dataset.nextAircraft){ clearSelectedAircraft(); return; }
    contextMode='context'; settleSelected(button.dataset.nextAircraft);
  }));
  bindLeftInlineDetails();
}

function activeMelItemsForAircraft(aircraft){
  return (aircraft?.melItems||[]).filter(item=>['open','expired'].includes(item.status));
}

function melItemExpired(item,now=simNow()){
  return item?.status==='expired'||Number(item?.remainingCycles)<=0||(Number.isFinite(item?.expiresAt)&&item.expiresAt<=now);
}

function melRemainingLabel(item,now=simNow()){
  const cycles=Math.max(0,Number(item?.remainingCycles)||0);
  const expiresAt=Number(item?.expiresAt)||0;
  const time=expiresAt?formatDuration(Math.max(0,expiresAt-now)):'time unknown';
  return `${cycles} cycle${cycles===1?'':'s'} / ${time}`;
}

function melDetailsMarkup(melItems,now=simNow()){
  if(!melItems?.length) return '';
  return `<div class="mel-detail-list">${melItems.map(item=>{
    const expired=melItemExpired(item,now);
    return `<div class="mel-detail-row ${expired?'expired':''}">
      <b>MEL ${esc(item.code||item.ata||'')}</b>
      <span>${esc(item.title||'Deferred defect')}</span>
      <em>${expired?'expired':melRemainingLabel(item,now)}</em>
      ${item.restriction?`<small>${esc(item.restriction)}</small>`:''}
    </div>`;
  }).join('')}</div>`;
}

function melClearancePlanForAircraft(aircraft,now=simNow()){
  const items=activeMelItemsForAircraft(aircraft);
  if(!items.length) return {items,needsWarning:false,expired:false,scheduled:false,timely:false};
  const status=Management.maintenanceStatus(aircraft,now);
  const job=status.scheduled||null;
  const expiries=items.map(item=>Number(item.expiresAt)).filter(Number.isFinite);
  const earliestExpiry=expiries.length?Math.min(...expiries):Infinity;
  const expired=items.some(item=>melItemExpired(item,now));
  const scheduled=Boolean(job);
  const timely=scheduled&&(!Number.isFinite(earliestExpiry)||job.end<=earliestExpiry);
  return {
    items,status,job,earliestExpiry,expired,scheduled,timely,
    needsWarning:expired||!timely
  };
}

function melRectificationReason(aircraft,melItems=activeMelItemsForAircraft(aircraft)){
  const codes=melItems.map(item=>item.code||item.ata).filter(Boolean).slice(0,3).map(code=>`MEL ${code}`).join(', ');
  return `MEL rectification${codes?`: ${codes}`:''}`;
}

function maintenanceWorkTypeOptions(){
  const labels=Management.MAINTENANCE_WORK_LABELS||{};
  return [
    {id:'scheduled_check',label:labels.scheduled_check||'Scheduled maintenance check'},
    {id:'mel_rectification',label:labels.mel_rectification||'MEL rectification'},
    {id:'urgent_repair',label:labels.urgent_repair||'Technical repair'},
    {id:'arrival_inspection',label:labels.arrival_inspection||'Arrival inspection'}
  ];
}

function maintenanceWorkTypeLabel(workType){
  return maintenanceWorkTypeOptions().find(item=>item.id===workType)?.label||maintenanceWorkTypeOptions()[0].label;
}

function maintenanceFindingForWorkType(aircraft,workType){
  if(workType==='urgent_repair'){
    return {category:'C',title:aircraft?.defectReason||'Manual technical repair'};
  }
  if(workType==='arrival_inspection'){
    return {category:'D',title:'Arrival inspection'};
  }
  return null;
}

function maintenanceScheduleReason(aircraft,workType,melItems=[]){
  if(workType==='mel_rectification') return melRectificationReason(aircraft,melItems);
  if(workType==='urgent_repair') return aircraft?.defectReason?`Technical repair: ${aircraft.defectReason}`:'Technical repair';
  if(workType==='arrival_inspection') return aircraft?.arrivalInspectionRequired?'Arrival inspection after reported event':'Arrival inspection';
  return 'Scheduled maintenance check';
}

function maintenanceScheduleOptions(aircraft,workType){
  const melItems=workType==='mel_rectification'?activeMelItemsForAircraft(aircraft):[];
  return {
    workType,
    melItems,
    finding:maintenanceFindingForWorkType(aircraft,workType),
    reason:maintenanceScheduleReason(aircraft,workType,melItems),
    allowFlightConflict:true
  };
}

function defaultMaintenanceSchedulerAircraftId(){
  const selectedFlight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  const selectedIds=[selectedFlight?.aircraftId,selectedAircraftId].filter(Boolean);
  const preferred=selectedIds.map(id=>state.aircraft.find(ac=>ac.id===id)).find(Boolean);
  if(preferred) return preferred.id;
  const now=simNow();
  const attention=state.aircraft.find(ac=>{
    const status=Management.maintenanceStatus(ac,now);
    return !status.scheduled&&(status.grounding||status.due||activeMelItemsForAircraft(ac).length||ac.defectUntil>now||ac.arrivalInspectionRequired);
  });
  return (attention||state.aircraft[0]||{}).id||'';
}

function defaultMaintenanceSchedulerWorkType(aircraft){
  if(activeMelItemsForAircraft(aircraft).length) return 'mel_rectification';
  if(aircraft?.defectUntil>simNow()) return 'urgent_repair';
  if(aircraft?.arrivalInspectionRequired) return 'arrival_inspection';
  return 'scheduled_check';
}

function maintenanceWorkPreview(acId,workType,start){
  const aircraft=state.aircraft.find(item=>item.id===acId);
  if(!aircraft) return {disabled:true,html:'<div class="form-feedback">Select an aircraft.</div>'};
  const safeWorkType=maintenanceWorkTypeOptions().some(item=>item.id===workType)?workType:'scheduled_check';
  const options=maintenanceScheduleOptions(aircraft,safeWorkType);
  const requestedStart=Number.isFinite(start)?Math.max(simNow(),start):defaultMaintenanceStart(aircraft.id,options);
  const plan=Management.maintenancePlan(aircraft,requestedStart,aircraft.location,MODELS[aircraft.model]?.seats||100,options);
  const support=maintenanceSupportAtAirport(aircraft.location,aircraft,requestedStart);
  const status=Management.maintenanceStatus(aircraft,simNow());
  const conflict=plan?maintenancePlanConflict(aircraft,plan):null;
  const disabled=Boolean(status.scheduled||!support.available||(safeWorkType==='mel_rectification'&&!options.melItems.length));
  const details=[
    plan?`${formatDuration(plan.end-plan.start)} · ${shortDay(plan.start)} ${shortClock(plan.start)}-${shortClock(plan.end)} · est ${money(plan.cost||0)}`:'',
    support.available?support.label:support.label||'maintenance support unavailable',
    safeWorkType==='mel_rectification'&&options.melItems.length?options.melItems.map(item=>`MEL ${item.code||item.ata}`).join(', '):'',
    conflict?`${conflict.id} overlaps this work window and will be cancelled on confirmation.`:'',
    status.scheduled?`${aircraft.tail} already has planned maintenance work.`:'',
    safeWorkType==='mel_rectification'&&!options.melItems.length?'No open MEL item is recorded for this aircraft.':''
  ].filter(Boolean);
  return {
    disabled,plan,support,conflict,options,
    html:`<div class="maintenance-work-preview ${disabled?'blocked':''}">
      <b>${esc(maintenanceWorkTypeLabel(safeWorkType))} · ${esc(aircraft.tail)} at ${esc(aircraft.location)}</b>
      ${details.map(item=>`<span>${esc(item)}</span>`).join('')}
    </div>`
  };
}

function maintenanceSchedulerPanelMarkup(){
  const aircraftId=defaultMaintenanceSchedulerAircraftId();
  const aircraft=state.aircraft.find(item=>item.id===aircraftId);
  const workType=defaultMaintenanceSchedulerWorkType(aircraft);
  const options=maintenanceScheduleOptions(aircraft,workType);
  const start=aircraft?defaultMaintenanceStart(aircraft.id,options):simNow()+2*HOUR;
  const preview=maintenanceWorkPreview(aircraftId,workType,start);
  return `<div class="maintenance-scheduler" data-maintenance-scheduler>
    <div class="form-grid compact-form">
      <label>Aircraft<select data-maintenance-work-aircraft>${state.aircraft.map(ac=>{
        const job=Management.maintenanceStatus(ac,simNow()).scheduled;
        return `<option value="${esc(ac.id)}" ${ac.id===aircraftId?'selected':''}>${esc(ac.tail)} · ${esc(ac.model)} · ${esc(ac.location)}${job?' · booked':''}</option>`;
      }).join('')}</select></label>
      <label>Task<select data-maintenance-work-type>${maintenanceWorkTypeOptions().map(item=>`<option value="${esc(item.id)}" ${item.id===workType?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>
      <label>Start<input type="datetime-local" data-maintenance-work-start value="${esc(datetimeLocalValue(start))}"></label>
    </div>
    <div data-maintenance-work-preview>${preview.html}</div>
    <div class="form-actions"><button class="primary-button" type="button" data-schedule-maintenance-work ${preview.disabled?'disabled':''}>Schedule maintenance</button></div>
  </div>`;
}

function maintenanceJobProgress(job,now=simNow()){
  if(!job) return 0;
  if(now<=job.start) return 0;
  if(now>=job.end) return 1;
  return clamp((now-job.start)/Math.max(1,job.end-job.start),0,1);
}

function maintenanceWorkJobs(now=simNow()){
  return state.aircraft
    .map(aircraft=>({aircraft,status:Management.maintenanceStatus(aircraft,now)}))
    .map(item=>({...item,job:item.status.scheduled}))
    .filter(item=>item.job)
    .sort((a,b)=>a.job.start-b.job.start||a.aircraft.tail.localeCompare(b.aircraft.tail));
}

function maintenanceWorkCardMarkup(item,now=simNow()){
  const {aircraft,status,job}=item;
  const active=status.active||job.status==='active';
  const progress=maintenanceJobProgress(job,now);
  const selected=selectedAircraftId===aircraft.id;
  const stateLabel=active?'In progress':now<job.start?'Planned':'Finishing';
  const title=`${aircraft.tail} ${String(job.label||'maintenance').toLowerCase()} at ${job.airport||aircraft.location} · ${formatTime(job.start)}-${formatTime(job.end)} · ${job.reason||job.label}`;
  return `<article class="left-list-card maintenance-work-card ${active?'active':'planned'} ${selected?'selected':''}" data-maintenance-job-card="${esc(aircraft.id)}">
    <button class="maintenance-work-main" type="button" data-maintenance-aircraft="${esc(aircraft.id)}" title="${esc(title)}">
      <span class="list-primary"><span>${esc(aircraft.tail)} · ${esc(job.label||'Maintenance')}</span><span>${esc(stateLabel)}</span></span>
      <span class="list-secondary"><span>${esc(job.airport||aircraft.location)} · ${shortDay(job.start)} ${shortClock(job.start)}-${shortClock(job.end)}</span><span>${formatPct(progress)}</span></span>
      <span class="maintenance-work-reason">${esc(job.reason||job.label||'Maintenance')}</span>
      <span class="maintenance-work-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress*100)}"><span style="width:${formatPct(progress)}"></span></span>
    </button>
    <div class="maintenance-work-actions">
      ${active?'<span>Work underway</span>':`<button class="desk-action-link" type="button" data-cancel-check="${esc(aircraft.id)}">Cancel work</button>`}
    </div>
  </article>`;
}

function updateMaintenanceSchedulerPreview(root=document,{resetStart=false}={}){
  const panel=root.querySelector?.('[data-maintenance-scheduler]');
  if(!panel) return;
  const acSelect=panel.querySelector('[data-maintenance-work-aircraft]');
  const typeSelect=panel.querySelector('[data-maintenance-work-type]');
  const startInput=panel.querySelector('[data-maintenance-work-start]');
  const aircraft=state.aircraft.find(item=>item.id===acSelect?.value);
  const workType=typeSelect?.value||'scheduled_check';
  if(resetStart&&aircraft&&startInput){
    const options=maintenanceScheduleOptions(aircraft,workType);
    startInput.value=datetimeLocalValue(defaultMaintenanceStart(aircraft.id,options));
  }
  const start=startInput?.value?new Date(startInput.value).getTime():NaN;
  const preview=maintenanceWorkPreview(acSelect?.value,workType,start);
  const previewRoot=panel.querySelector('[data-maintenance-work-preview]');
  if(previewRoot) previewRoot.innerHTML=preview.html;
  const button=panel.querySelector('[data-schedule-maintenance-work]');
  if(button) button.disabled=preview.disabled;
}

function bindMaintenanceRail(root){
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    setRailWidgetOpen('maintenance',true,{persist:false});
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-maintenance-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    if(selectedAircraftId===button.dataset.maintenanceAircraft){ clearSelectedAircraft(); return; }
    contextMode='context'; settleSelected(button.dataset.maintenanceAircraft);
  }));
  root.querySelectorAll('[data-maintenance-work-aircraft],[data-maintenance-work-type]').forEach(control=>control.addEventListener('change',()=>updateMaintenanceSchedulerPreview(root,{resetStart:true})));
  root.querySelectorAll('[data-maintenance-work-start]').forEach(control=>control.addEventListener('input',()=>updateMaintenanceSchedulerPreview(root)));
  root.querySelectorAll('[data-schedule-maintenance-work]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    const panel=button.closest('[data-maintenance-scheduler]');
    const acId=panel?.querySelector('[data-maintenance-work-aircraft]')?.value;
    const aircraft=state.aircraft.find(item=>item.id===acId);
    const workType=panel?.querySelector('[data-maintenance-work-type]')?.value||'scheduled_check';
    const startValue=panel?.querySelector('[data-maintenance-work-start]')?.value;
    const start=startValue?new Date(startValue).getTime():undefined;
    const active=activeFormControl();
    if(active&&panel?.contains(active)) active.blur();
    button.blur?.();
    const plan=scheduleAircraftMaintenance(acId,Number.isFinite(start)?start:undefined,maintenanceScheduleOptions(aircraft,workType));
    if(plan){
      setDeskPanel('maintenance','');
      markUiDirty('all');
    }
  }));
  root.querySelectorAll('[data-cancel-check]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    cancelAircraftMaintenance(button.dataset.cancelCheck);
  }));
  updateMaintenanceSchedulerPreview(root);
}

function maintenanceRailMarkup(jobs,now=simNow()){
  const active=activeDeskTab('maintenance');
  return `${deskActionBar('maintenance',[{panel:'overview',label:'Overview'},{panel:'schedule',label:'Schedule'}])}
    ${deskPanelMarkup('maintenance','schedule','Schedule maintenance',maintenanceSchedulerPanelMarkup())}
    ${active==='overview'?`<div class="maintenance-work-list">${jobs.length?jobs.map(item=>maintenanceWorkCardMarkup(item,now)).join(''):'<div class="empty-state">No planned or active maintenance work.</div>'}</div>`:''}`;
}

function refreshMaintenanceRail(force=false){
  const now=simNow();
  const root=document.getElementById('maintenanceList');
  if(!root) return;
  if(activeFormControlWithin(root)) return;
  const jobs=maintenanceWorkJobs(now);
  const signature=[
    selectedAircraftId||'',selectedFlightId||'',activeDeskPanel('maintenance'),
    jobs.map(item=>`${item.aircraft.id}:${item.aircraft.location}:${item.job.start}:${item.job.end}:${item.job.status}:${item.status.active?1:0}:${item.job.workType}:${item.job.reason||''}`).join('|'),
    activeDeskPanel('maintenance')
  ].join('::');
  if(!force&&signature===lastMaintenanceListSignature) return;
  lastMaintenanceListSignature=signature;
  const count=document.getElementById('maintenanceListCount');
  if(count) count.textContent=jobs.length;
  root.innerHTML=maintenanceRailMarkup(jobs,now);
  refreshRailCollapseState();
  bindMaintenanceRail(root);
}

function corporateResourcesMarkup(activeRequests){
  return `${deskActionBar('corporate',[
      {panel:'planning',label:'Plan flight'},
      {panel:'aircraft',label:'Request aircraft'},
      {panel:'personnel',label:'Request personnel'},
      {panel:'release-aircraft',label:'Remove aircraft'},
      {panel:'remove-schedule',label:'Remove schedule'}
    ])}
    ${deskPanelMarkup('corporate','planning','Plan flight')}
    ${deskPanelMarkup('corporate','aircraft','Request aircraft')}
    ${deskPanelMarkup('corporate','personnel','Request personnel')}
    ${deskPanelMarkup('corporate','release-aircraft','Remove aircraft',releaseAircraftPanelMarkup())}
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
  const count=document.getElementById('corporateResourceCount');
  if(count) count.textContent=activeRequests.length;
  const root=document.getElementById('corporateResourcesList');
  if(!root) return;
  if(!force&&signature===lastCorporateResourcesSignature) return;
  if(activeFormControlWithin(root)||activeEmbeddedManagementControl()) return;
  lastCorporateResourcesSignature=signature;
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
  root.querySelectorAll('[data-release-aircraft-corporate]').forEach(button=>button.addEventListener('click',()=>{
    const panel=button.closest('[data-active-desk-panel]');
    const acId=panel?.querySelector('[data-release-aircraft-select]')?.value;
    releaseAircraft(acId);
    markUiDirty('all');
  }));
  refreshManagement(true);
}

function bindPersonnelRail(root){
  bindPersonnelAssignmentControls(root);
  root.onfocusout=()=>requestAnimationFrame(()=>refreshPersonnelRail(false));
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    setRailWidgetOpen('personnel',true,{persist:false});
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    markUiDirty('left');
  }));
  root.querySelectorAll('[data-connection-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.connectionFlight)));
  root.querySelectorAll('[data-crew-recovery]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    authorizeCrewRecovery(button.dataset.crewRecovery,button.dataset.crewRecoveryAction||'hotel');
    markUiDirty('all');
  }));
}

function refreshPersonnelRail(force=false,fromInteraction=false){
  const root=document.getElementById('personnelRailList');
  if(!fromInteraction&&root?.contains(document.activeElement)&&document.activeElement.matches('select,input,textarea')) return;
  if(!root) return;
  const now=simNow();
  const activeTransfers=(state.personnelTransfers||[]).filter(item=>!['completed','cancelled'].includes(item.status));
  const crewExposures=typeof crewAccommodationExposures==='function'?crewAccommodationExposures(now):[];
  const crewImpactCount=crewExposures.filter(item=>!item.arranged).length;
  const transferSignature=activeTransfers.map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.actualTo||''}:${item.status==='scheduled'&&now>=item.departure?'transit':'waiting'}`).join('|');
  const pendingAssignments=crewAssignments().filter(crewAssignmentPending).length;
  const crewRefreshKey=['overview','crew-impact'].includes(activeDeskTab('personnel'))?Math.floor(now/MIN):0;
  const signature=[
    selectedFlightId||'',selectedAircraftId||'',activeDeskPanel('personnel'),
    transferSignature,
    crewExposures.map(item=>`${item.flightId}:${item.cost}:${item.arranged?1:0}:${item.releaseAirport}:${item.reason}:${(item.records||[]).map(record=>`${record.action}:${record.status}:${record.updatedAt}:${record.completedAt}:${record.availableAt}:${record.availabilityStatus}`).join(',')}`).join('|'),
    (state.crewRecoveries||[]).map(item=>`${item.id}:${item.flightId}:${item.action}:${item.status}:${item.updatedAt}:${item.completedAt}:${item.availableAt}:${item.availabilityStatus}`).join('|'),
    crewAssignments().map(item=>`${item.id}:${item.status}:${item.updatedAt}:${item.readyAt}`).join('|'),
    JSON.stringify(state.crewUnavailability),JSON.stringify(personnelAssignmentUi),
    state.flights.map(item=>`${item.id}:${item.aircraftId}:${item.actualDeparture}:${item.cancelled}:${item.departureLogged}:${item.crewDutyId}`).join('|'),
    JSON.stringify(state.personnel.assignments||{}),
    JSON.stringify(state.personnel.qualifications||{}),
    crewRefreshKey,
    activeDeskPanel('personnel')
  ].join('::');
  if(!force&&signature===lastPersonnelRailSignature) return;
  lastPersonnelRailSignature=signature;
  const count=document.getElementById('personnelRailCount');
  if(count) count.textContent=activeTransfers.length+crewImpactCount+pendingAssignments;
  restoreEmbeddedManagementPages(root);
  root.innerHTML=`${deskActionBar('personnel',[
      {panel:'overview',label:'Pools',count:pendingAssignments},
      {panel:'relocation',label:'Move crew',count:activeTransfers.length},
      {panel:'crew-impact',label:'Crew impact',count:crewImpactCount}
    ])}${personnelDeskMarkup([],activeTransfers,crewExposures)}`;
  mountOccManagementPages(root);
  refreshRailCollapseState();
  bindPersonnelRail(root);
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

function flightWeatherForecastContext(flight,now=simNow()){
  const destination=flightOperationalDestination(flight);
  const inOperation=typeof flightIsInOperation==='function'
    ? flightIsInOperation(flight,now)
    : Boolean(flight?.departureLogged&&flightActualDeparture(flight)<=now&&now<flightActualArrival(flight));
  const forecastTime=inOperation?now:Math.max(now,flightActualDeparture(flight));
  const origin=Management.weatherAt(flight.from,forecastTime);
  const destinationWeather=Management.weatherAt(destination,flightActualArrival(flight));
  const routeWeather=window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,forecastTime,{forecast:true})
    ||window.AeroWeatherEngine?.routeHazardSummary?.(flight.from,destination,forecastTime)
    ||{hazards:[],delayMin:0,level:'normal',label:''};
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
  return {
    destination,forecastTime,origin,destinationWeather,routeWeather,hazards,
    routeTone,routeText,originTitle,destinationTitle,routeTitle
  };
}

function flightWeatherForecastMarkup(flight){
  const forecast=flightWeatherForecastContext(flight);
  const {destination,origin,destinationWeather,hazards,routeTone,routeText,originTitle,destinationTitle,routeTitle}=forecast;
  return `<section class="context-section flight-weather-forecast"><h2>Forecast weather</h2>
    <div class="weather-forecast-row ${origin.level==='severe'?'critical':origin.level==='caution'?'warning':''}" title="${esc(originTitle)}"><span>${weatherIcon(origin)} ${esc(flight.from)}</span><b>${esc(origin.conditions)} · ${Math.round(origin.capacityFactor*100)}%</b></div>
    <div class="weather-forecast-row ${routeTone}" title="${esc(routeTitle)}"><span>Route</span><b>${esc(routeText)}</b></div>
    <div class="weather-forecast-row ${destinationWeather.level==='severe'?'critical':destinationWeather.level==='caution'?'warning':''}" title="${esc(destinationTitle)}"><span>${weatherIcon(destinationWeather)} ${esc(destination)}</span><b>${esc(destinationWeather.conditions)} · ETA ${shortClock(flightActualArrival(flight))}</b></div>
  </section>`;
}

function flightRoutePlanMarkup(flight){
  const summary=window.AeroRoutePlanning?.flightRouteSummary?.(flight);
  if(!summary) return '';
  const revisionText=summary.activeRevisionCount>1
    ? `${summary.reason||summary.mode} · ${summary.revisionId}`
    : `${summary.reason||'Filed route'} · ${summary.cruiseLevel||'cruise level pending'}`;
  return `<section class="context-section flight-route-plan"><h2>Route plan</h2>
    <div class="simple-row"><span>Active route</span><b>${esc(revisionText)}</b></div>
    <div class="simple-row"><span>Waypoints</span><b>${esc(summary.waypointCount)} · ${esc(summary.routeText)}</b></div>
    <div class="simple-row"><span>Distance</span><b>${esc(summary.distanceKm)} km${summary.cruiseLevel?` · ${esc(summary.cruiseLevel)}`:''}</b></div>
  </section>`;
}

function flightInlineDetailsMarkup(flight){
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const issue=attentionForFlight(flight);
  const problem=issue?.problem;
  const duty=crewDutyForFlight(flight);
  const ground=groundOperationsForFlight(flight);
  const now=simNow();
  const departed=typeof flightHasDeparted==='function'?flightHasDeparted(flight,now):Boolean(flight?.departureLogged);
  const completed=typeof flightHasCompleted==='function'?flightHasCompleted(flight,now):Boolean(flight?.settled&&departed&&flightActualArrival(flight)<=now);
  const inOperation=typeof flightIsInOperation==='function'?flightIsInOperation(flight,now):Boolean(departed&&flightActualDeparture(flight)<=now&&now<flightActualArrival(flight));
  const operation=completed?{flight,phase:ground?.postflight}:!departed?{flight,phase:ground?.departure}:null;
  const delay=flightTotalDepartureDelayMin(flight);
  const phaseLabel=(()=> {
    if(!departed&&flightActualDeparture(flight)<=now) return 'Departure held';
    const status=statusOfFlight(flight,now);
    if(status==='taxi_out') return 'Taxi out';
    if(status==='taxi_in') return 'Taxi in';
    if(status==='airborne') return 'Airborne';
    return status.replaceAll('_',' ');
  })();
  return `<article class="left-inline-details" data-left-flight-details="${esc(flight.id)}">
    ${issue?`<section class="attention-summary ${issue.critical?'critical':'warning'}"><b>${esc(issue.label)}</b>${problem?`<span>${esc(problemCopy(problem).summary)}</span>`:''}</section>`:''}
    <div class="fact-grid">${fact('Scheduled',`${shortClock(flight.departure)}-${shortClock(flight.arrival)}`)}${fact('Expected',`${shortClock(flightActualDeparture(flight))}-${shortClock(flightActualArrival(flight))}`)}${fact('Delay',delay?`+${delay} min`:'On time')}${fact('Aircraft',aircraft?`${aircraft.tail} · ${aircraft.model}`:'Unassigned')}</div>
    ${flightRoutePlanMarkup(flight)}
    ${flightWeatherForecastMarkup(flight)}
    <section class="context-section"><h2>Ground progress</h2>${operation?phaseMarkup(operation):inOperation?`<div class="simple-row"><span>Current phase</span><b>${esc(phaseLabel)}</b></div>`:phaseMarkup(null)}</section>
    ${inOperation?flightFuelBarMarkup(flight):''}
    <section class="context-section"><h2>Crew duty</h2>${inOperation?crewDutyProgressMarkup(duty):''}<div class="simple-row"><span>Planned duty</span><b>${Number(duty.dutyHours||0).toFixed(1)} h / ${Number(duty.maxHours||0).toFixed(1)} h</b></div><div class="simple-row"><span>Sectors</span><b>${duty.sectors||1}${rotationUsesThroughCrew(flight)?' · through crew':''}</b></div><div class="simple-row"><span>Legality</span><b>${duty.legal?'Within limit':'Limit exceeded'}</b></div></section>
    ${aircraft?`<section class="context-section"><button class="object-link" type="button" data-context-aircraft="${esc(aircraft.id)}"><span>Assigned aircraft</span><b>${esc(aircraft.tail)} →</b></button></section>`:''}
  </article>`;
}

function aircraftInlineDetailsMarkup(aircraft){
  const active=aircraftActiveFlight(aircraft.id),upcoming=aircraftUpcomingFlight(aircraft.id);
  const problem=openProblemForAircraft(aircraft.id);
  const maintenance=Management.maintenanceStatus(aircraft,simNow());
  const ground=aircraftGroundOperation(aircraft);
  const fuel=aircraftFuelPerformance(MODELS[aircraft.model]);
  const turnStation=active?flightOperationalDestination(active):(upcoming?upcoming.from:aircraft.location);
  const baseTurn=Number(MODELS[aircraft.model]?.minimumTurnMin)||minimumTurnMinutes(aircraft,turnStation);
  const stationTurn=minimumTurnMinutes(aircraft,turnStation);
  const turnLabel=stationTurn===baseTurn?`${stationTurn} min`:`${stationTurn} min at ${turnStation}`;
  return `<article class="left-inline-details" data-left-aircraft-details="${esc(aircraft.id)}">
    ${problem?`<section class="attention-summary critical"><b>${esc(problemCopy(problem).title)}</b><span>${esc(problemCopy(problem).summary)}</span></section>`:''}
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
  const selected=selectedAircraftId===aircraft.id;
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
  return [];
}
function taskStateLabel(task){
  if(task.status==='blocked') return 'Queued handoff';
  if(task.status==='waiting_external') return 'Awaiting external response';
  if(task.status==='in_progress') return 'In progress';
  return 'Ready for action';
}

function prefillPositioningFerryPlanner(problem){
  const plan=positioningFerryPlanState(problem);
  if(!plan.flight||!plan.aircraft) return toast(plan.reason||'No positioning plan is available.');
  selectedFlightId=plan.flight.id;
  selectedAircraftId=plan.aircraft.id;
  setRailWidgetOpen('corporateResources',true,{persist:false});
  setDeskPanel('corporate','planning',{toggle:false});
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
  markUiDirty('desk','selects','left','schedule','map');
  document.querySelector('[data-rail-widget="corporateResources"]')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Ferry planner staged for ${plan.aircraft.tail}: ${plan.from} → ${plan.to}.`);
}

function prefillCrewRelocationPlanner(problem){
  const plan=crewRelocationPlanState(problem);
  if(!plan.flight) return toast(plan.reason||'No crew movement plan is available.');
  selectedFlightId=plan.flight.id;
  selectedAircraftId=plan.flight.aircraftId;
  setRailWidgetOpen('personnel',true,{persist:false});
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
  markUiDirty('left','selects','desk','schedule','map');
  document.querySelector('[data-rail-widget="personnel"]')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast(`Personnel move staged: ${PERSONNEL[plan.role]?.label||'Crew'}${plan.from?` ${plan.from}`:''} → ${plan.to}.`);
}

function openOperationalProblems(){
  const problems=operationalIndex().openProblems.slice().sort((a,b)=>Number(Boolean(b.blocking))-Number(Boolean(a.blocking))||(a.detectedAt||0)-(b.detectedAt||0));
  problems.forEach(problem=>{
    if(!problem.firstVisibleAt){
      problem.firstVisibleAt=simNow();
      if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'visible');
    }
  });
  return problems;
}

function problemFlight(problem){
  return problem?.flightId?operationalIndex().flightsById.get(problem.flightId)||null:null;
}

function problemHasStartedWork(problem){
  return false;
}

function problemHasVisibleWork(problem){
  return Boolean(problem&&problem.status==='open');
}

function problemIsActionable(problem,now=simNow()){
  const flight=problemFlight(problem);
  if(problemHasStartedWork(problem)) return true;
  if(problem?.blocking&&problemHasVisibleWork(problem)) return true;
  if(!flight) return problem.severity==='critical'||(problem.deadline||0)<=now;
  const dep=flightActualDeparture(flight),arr=flightActualArrival(flight);
  const airborne=flight.departureLogged&&arr>now;
  const nearDeparture=!flight.departureLogged&&dep>now&&dep<=now+6*HOUR;
  const activeTurn=arr>now-90*MIN&&dep<=now+6*HOUR;
  const criticalToday=problem.severity==='critical'&&dep<=now+24*HOUR&&arr>now-2*HOUR;
  const overdueToday=(problem.deadline||0)<=now&&dep<=now+24*HOUR&&arr>now-2*HOUR;
  return airborne||nearDeparture||activeTurn||criticalToday||overdueToday;
}

function problemNeedsUserAction(problem,now=simNow()){
  return problemIsActionable(problem,now);
}

function actionableProblemIdSet(now=simNow()){
  return new Set(state.problems
    .filter(problem=>problem.status==='open'&&problemIsActionable(problem,now))
    .map(problem=>problem.id));
}

function problemDingContext(){
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context) return null;
  if(!problemAudioContext||problemAudioContextCtor!==Context){
    try{ problemAudioContext=new Context(); }
    catch(_){ return null; }
    problemAudioContextCtor=Context;
    problemAudioReady=false;
  }
  return problemAudioContext;
}

function playProblemDing({retry=false}={}){
  const ctx=problemDingContext();
  if(!ctx) return false;
  if(ctx.state==='suspended'){
    if(retry&&!problemDingRetryTimer){
      problemDingRetryTimer=setTimeout(()=>{
        problemDingRetryTimer=0;
        if(problemAudioContext?.state==='running') playProblemDing();
      },120);
    }
    return false;
  }
  if(problemDingRetryTimer){
    clearTimeout(problemDingRetryTimer);
    problemDingRetryTimer=0;
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

function primeProblemAudio(ctx){
  if(!ctx||problemAudioReady) return;
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
  problemAudioReady=true;
}

async function armProblemDing(){
  const ctx=problemDingContext();
  if(!ctx) return;
  try{ await ctx.resume(); }catch(_){}
  if(ctx.state==='running') primeProblemAudio(ctx);
}

function checkActionableProblemDing(){
  const current=actionableProblemIdSet();
  if(!problemSoundInitialized){
    knownActionableProblemIds=current;
    problemSoundInitialized=true;
    return;
  }
  const hasNew=[...current].some(id=>!knownActionableProblemIds.has(id));
  knownActionableProblemIds=current;
  if(hasNew) playProblemDing({retry:true});
}

function problemProblemScopeLabel(problem,flight,aircraft,affectedCount){
  const scopeKind=problem.scope?.kind||((flight&&'flight')||(aircraft&&'aircraft')||'problem');
  if(scopeKind==='network') return `Network · ${affectedCount} affected flight${affectedCount===1?'':'s'}`;
  if(scopeKind==='airport') return `Airport · ${problem.scope?.subjectId||problem.context?.airport||''} · ${affectedCount} affected flight${affectedCount===1?'':'s'}`;
  if(scopeKind==='aircraft'&&aircraft) return `Aircraft · ${aircraft.tail} · ${aircraft.model} · ${affectedCount} affected flight${affectedCount===1?'':'s'}`;
  if(flight) return `Flight · ${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`;
  if(aircraft) return `Aircraft · ${aircraft.tail} · ${aircraft.model}`;
  return 'Operational problem';
}
function disruptionCaseGroups(problems,now=simNow()){
  const byId=new Map((state.problems||[]).map(problem=>[problem.id,problem]));
  const groups=new Map();
  for(const problem of problems){
    const key=problem.caseId||problem.rootProblemId||problem.id;
    if(!groups.has(key)){
      const root=byId.get(problem.rootProblemId)||byId.get(key)||problem;
      groups.set(key,{id:key,root,problems:[]});
    }
    groups.get(key).problems.push(problem);
  }
  const severityScore=problem=>problem?.severity==='critical'?2:problem?.severity==='warning'?1:0;
  return [...groups.values()].map(group=>{
    group.problems.sort((a,b)=>{
      if(a.id===group.root.id) return -1;
      if(b.id===group.root.id) return 1;
      return Number(problemIsActionable(b,now))-Number(problemIsActionable(a,now))
        ||severityScore(b)-severityScore(a)
        ||(a.deadline||0)-(b.deadline||0);
    });
    return group;
  }).sort((a,b)=>{
    const aAction=a.problems.some(problem=>problemIsActionable(problem,now));
    const bAction=b.problems.some(problem=>problemIsActionable(problem,now));
    const aCritical=a.problems.some(problem=>problem.severity==='critical');
    const bCritical=b.problems.some(problem=>problem.severity==='critical');
    return Number(bAction)-Number(aAction)
      ||Number(bCritical)-Number(aCritical)
      ||Math.min(...a.problems.map(problem=>problem.deadline||Infinity))-Math.min(...b.problems.map(problem=>problem.deadline||Infinity));
  });
}

function deskActionBar(desk,actions){
  const hasTabs=actions.some(action=>action.kind!=='direct');
  const activePanel=activeDeskPanel(desk);
  return `<div class="desk-action-bar ${hasTabs?'desk-tabs':''}" ${hasTabs?'role="tablist"':''}>${actions.map(action=>{
    if(action.kind==='direct') return `<button class="desk-action-link" type="button" ${action.attr||''}>${esc(action.label)}</button>`;
    const active=activePanel?activePanel===action.panel:action.panel==='overview';
    return `<button class="desk-action-tab ${active?'active':''}" type="button" role="tab" aria-selected="${active}" data-desk-panel="${esc(desk)}:${esc(action.panel)}">${esc(action.label)}${action.count?` <span class="tab-count">${Number(action.count)}</span>`:''}</button>`;
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

function occWidgetMarkup(key,kicker,title,count,status,actions,content,{empty=null,autoCompact=false}={}){
  const context=[kicker,status].filter(Boolean).join(' · ');
  const isEmpty=empty===null?!count:Boolean(empty);
  if(!isEmpty) expandedEmptyDesks.delete(key);
  const automaticallyCompacted=autoCompact&&isEmpty&&!expandedEmptyDesks.has(key);
  const open=isDeskOpen(key)&&!automaticallyCompacted;
  return `<section class="occ-board-widget ${count?'has-work':'empty-work'} ${isEmpty?'compact-empty':''} ${automaticallyCompacted?'auto-compact':''} ${open?'':'collapsed'}" id="occ-desk-${key}" data-desk-widget="${key}">
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

function bindInlineTaskActions(){ return; }

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

function routeRevisionDispatchLabel(route){
  if(!route) return '';
  if(route.mode==='diversion') return `Diversion to ${route.to}`;
  if(route.mode==='return_origin') return `Return to ${route.to}`;
  if(route.mode==='weather_detour') return 'Weather avoidance';
  if(route.mode==='direct') return 'Direct routing';
  if(route.mode==='priority') return 'Priority routing';
  return route.reason||'Filed route';
}

function dispatchRouteComparisonMarkup(flight){
  const comparison=window.AeroRoutePlanning?.flightRouteComparison?.(flight,simNow());
  const active=comparison?.active;
  if(!active?.waypoints?.length) return '';
  const forecast=flightWeatherForecastContext(flight);
  const tracks=[];
  if(comparison.revised&&comparison.filed?.waypoints?.length){
    tracks.push({key:'filed',className:'filed',label:'Original',waypoints:comparison.filed.waypoints});
  }
  tracks.push({key:'active',className:'active',label:comparison.revised?'Active':'Filed',waypoints:active.waypoints});
  const graphic=routeGraphicProjection(tracks,{width:300,height:96,pad:13});
  if(!graphic.tracks.length) return '';
  const filedTrack=graphic.tracks.find(track=>track.key==='filed');
  const activeTrack=graphic.tracks.find(track=>track.key==='active')||graphic.tracks[0];
  const activeD=routeGraphicPath(activeTrack.points);
  const filedD=filedTrack?routeGraphicPath(filedTrack.points):'';
  const sampledFixes=(activeTrack.points||[]).slice(1,-1).filter((_,index)=>index%Math.max(1,Math.ceil(activeTrack.points.length/6))===0).slice(0,5);
  const endpoints=[activeTrack.points[0],activeTrack.points[activeTrack.points.length-1]].filter(Boolean);
  const weatherLayer=dispatchRouteWeatherLayerMarkup(graphic,forecast,endpoints,activeTrack);
  const status=comparison.revised
    ? `${routeRevisionDispatchLabel(active)} · ${active.distanceKm.toLocaleString()} km`
    : `${active.waypointCount} waypoint filed route · ${active.distanceKm.toLocaleString()} km`;
  const title=comparison.revised
    ? `Original ${comparison.filed.from || flight.from} to ${comparison.filed.to || flight.to}; active ${routeRevisionDispatchLabel(active)}`
    : `${flight.id} filed waypoint route`;
  return `<div class="dispatch-route-visual ${comparison.revised?'has-revision':'single-route'}" data-dispatch-route="${esc(flight.id)}" title="${esc(title)}">
    <svg class="dispatch-route-map" viewBox="0 0 ${graphic.width} ${graphic.height}" role="img" aria-label="${esc(title)}">
      ${filedD?`<path class="dispatch-route-path filed" d="${esc(filedD)}"></path>`:''}
      <path class="dispatch-route-path active" d="${esc(activeD)}"></path>
      ${weatherLayer.cells}
      ${sampledFixes.map(point=>`<circle class="dispatch-route-fix" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2"></circle>`).join('')}
      ${endpoints.map((point,index)=>`<g class="dispatch-route-endpoint ${index?'destination':'origin'}"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.4"></circle><text x="${point.x.toFixed(1)}" y="${(point.y+(point.y<19?14:-8)).toFixed(1)}">${esc(index?(active.to||flightOperationalDestination(flight)):(active.from||flight.from||'POS'))}</text></g>`).join('')}
      ${weatherLayer.airports}
    </svg>
    <div class="dispatch-route-legend">
      ${comparison.revised&&comparison.filed?`<span class="filed"><i></i>Original · ${esc(comparison.filed.from||flight.from)} → ${esc(comparison.filed.to||flight.to)}</span>`:''}
      <span class="active"><i></i>${esc(comparison.revised?'Active':'Filed')} · ${esc(status)}${active.cruiseLevel?` · ${esc(active.cruiseLevel)}`:''}</span>
      <span class="weather ${esc(forecast.routeTone)}" data-dispatch-route-weather="${esc(flight.id)}" title="${esc(forecast.routeTitle)}"><i></i>${esc(forecast.routeText)}</span>
    </div>
  </div>`;
}

function dispatchWeatherTone(weather){
  return weather?.level==='severe'?'critical':weather?.level==='caution'?'warning':'normal';
}

function dispatchWeatherGlyph(weather){
  const level=weather?.level || (weather?.severity==='severe'?'severe':weather?.severity==='caution'?'caution':'normal');
  return weatherIcon({...weather,level});
}

function dispatchRouteWeatherLayerMarkup(graphic,forecast,endpoints=[],activeTrack=null){
  if(!forecast) return {cells:'',airports:''};
  const hazards=(forecast.hazards||[])
    .map((item,index,all)=>{
      const point=dispatchRouteWeatherCellPoint(graphic,item,index,all.length,activeTrack);
      return point?{...item,...point}:null;
    })
    .filter(Boolean)
    .slice(0,3);
  const cells=hazards.map(item=>{
    const tone=item.severity==='severe'?'critical':'warning';
    const radius=Math.max(12,Math.min(25,(Number(item.radiusKm)||180)/12));
    const title=`${item.id} · ${item.label} · +${item.delayMin} min forecast route impact`;
    return `<g class="dispatch-route-weather-cell ${tone}" data-route-weather-cell="${esc(item.id)}" transform="translate(${item.x.toFixed(1)} ${item.y.toFixed(1)})">
      <title>${esc(title)}</title>
      <circle r="${radius.toFixed(1)}"></circle>
      <text y="3.6">${esc(dispatchWeatherGlyph(item))}</text>
    </g>`;
  }).join('');
  const endpointForecasts=[
    {point:endpoints[0],weather:forecast.origin,title:`${forecast.originTitle}`},
    {point:endpoints[1],weather:forecast.destinationWeather,title:`${forecast.destinationTitle}`}
  ].filter(item=>item.point&&item.weather);
  const airportMarkers=endpointForecasts.map((item,index)=>{
    const tone=dispatchWeatherTone(item.weather);
    const point=dispatchEndpointWeatherBadgePoint(graphic,item.point,index);
    return `<g class="dispatch-route-weather-airport ${tone}" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})">
      <title>${esc(item.title)}</title>
      <rect x="-9" y="-7.5" width="18" height="15" rx="4"></rect>
      <text y="3.6">${esc(dispatchWeatherGlyph(item.weather))}</text>
    </g>`;
  }).join('');
  return {
    cells:cells?`<g class="dispatch-route-weather-layer enroute">${cells}</g>`:'',
    airports:airportMarkers?`<g class="dispatch-route-weather-layer airports">${airportMarkers}</g>`:''
  };
}

function dispatchRouteWeatherCellPoint(graphic,hazard,index=0,count=1,activeTrack=null){
  const explicit=routeGraphicProjectPoint(graphic,hazard);
  if(explicit) return explicit;
  const points=activeTrack?.points||graphic?.tracks?.[0]?.points||[];
  if(points.length<2) return null;
  const segmentCount=points.length-1;
  const rawSegment=Number.isFinite(Number(hazard?.segmentIndex))
    ? Math.round(Number(hazard.segmentIndex))
    : Math.floor((index+1)*segmentCount/(count+1));
  const segment=clamp(rawSegment,0,segmentCount-1);
  const start=points[segment],end=points[segment+1];
  if(!start||!end) return null;
  return {x:(start.x+end.x)/2,y:(start.y+end.y)/2};
}

function dispatchEndpointWeatherBadgePoint(graphic,point,index=0){
  const preferred=index?15:-15;
  let x=point.x+preferred;
  if(x<11||x>graphic.width-11) x=point.x-preferred;
  return {
    x:clamp(x,10,graphic.width-10),
    y:clamp(point.y,10,graphic.height-10)
  };
}

function dispatchSelectedFlightMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  const now=simNow();
  const rotation=rotationForFlight(flight);
  const pairedReturn=rotation.returnFlight&&flight.serviceLeg!=='return'?rotation.returnFlight:null;
  const scope=flight.serviceId&&rotation.outbound
    ? `Round trip ${rotation.outbound.id}${pairedReturn?` + ${pairedReturn.id}`:''}`
    : 'Selected flight';
  const statusRaw=statusOfFlight(flight,now);
  const status=statusRaw.replaceAll('_',' ');
  const depDelay=flightTotalDepartureDelayMin(flight);
  const arrDelay=Math.max(0,Math.round((flightActualArrival(flight)-flight.arrival)/MIN));
  const inOperation=typeof flightIsInOperation==='function'
    ? flightIsInOperation(flight,now)
    : Boolean(flight?.departureLogged&&flightActualDeparture(flight)<=now&&now<flightActualArrival(flight));
  const departed=typeof flightHasDeparted==='function'?flightHasDeparted(flight,now):Boolean(flight?.departureLogged);
  const progress=inOperation?flightProgress(flight,now):(statusRaw==='arrived'?1:0);
  const progressLabel=inOperation?formatPct(progress):statusRaw==='arrived'?'Arrived':departed?'Complete':flightActualDeparture(flight)<=now?'Held on ground':'Not departed';
  const problems=openProblemsForFlight(flight.id);
  const delayLabel=depDelay||arrDelay
    ? `${depDelay?`D +${depDelay}`:'D on time'} · ${arrDelay?`A +${arrDelay}`:'A on time'}`
    : 'On time';
  return `<section class="dispatch-scope-card dispatch-flight-board dispatch-flight-context" data-dispatch-selected-flight="${esc(flight.id)}" data-dispatch-flight-status="${esc(flight.id)}">
    ${dispatchRouteComparisonMarkup(flight)}
    <div class="dispatch-flight-heading">
      <div><span>Selected flight</span><b>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</b><em>${esc(scope)} · ${esc(shortDay(flightActualDeparture(flight)))} ${esc(shortClock(flightActualDeparture(flight)))}-${esc(shortClock(flightActualArrival(flight)))} · ${esc(delayLabel)}</em></div>
      <strong>${esc(status)}</strong>
    </div>
    <div class="dispatch-flight-facts">
      <div><span>Aircraft</span><b>${esc(aircraft?`${aircraft.tail} · ${aircraft.model}`:'Unassigned')}</b></div>
      <div class="${problems.length?'has-problems':''}"><span>Problems</span><b>${problems.length}</b></div>
    </div>
    <div class="dispatch-progress" title="${esc(`${status} · ${shortClock(flightActualDeparture(flight))}-${shortClock(flightActualArrival(flight))}`)}">
      <div class="progress-track"><span style="width:${formatPct(progress)}"></span></div>
      <div class="progress-caption"><span>Flight progress</span><b>${esc(progressLabel)}</b></div>
    </div>
  </section>`;
}

function dispatchTurnaroundRowsMarkup(flight,aircraft){
  const index=operationalIndex();
  const previous=index.previousFlightById.get(flight.id)||previousAircraftFlight(flight);
  const next=(index.flightsByAircraft.get(flight.aircraftId)||[])
    .filter(item=>!item.cancelled&&item.id!==flight.id&&item.departure>flight.departure)
    .sort((a,b)=>a.departure-b.departure)[0]||null;
  const rows=[];
  if(previous&&flightOperationalDestination(previous)===flight.from){
    const turn=turnaroundGapInfo(previous,flight,aircraft);
    rows.push(`<div class="desk-list-row ${turn?.belowMinimum?'highlight':''}"><div><b>Inbound turn · ${esc(previous.id)} → ${esc(flight.id)}</b><span>${esc(turn?.title||`${previous.id} arrives before ${flight.id}`)}</span></div><em>${turn?`${turn.actualGapMin} min`:shortClock(flightActualArrival(previous))}</em></div>`);
  }
  if(next&&flightOperationalDestination(flight)===next.from){
    const turn=turnaroundGapInfo(flight,next,aircraft);
    rows.push(`<div class="desk-list-row ${turn?.belowMinimum?'highlight':''}"><div><b>Outbound turn · ${esc(flight.id)} → ${esc(next.id)}</b><span>${esc(turn?.title||`${next.id} follows this flight`)}</span></div><em>${turn?`${turn.actualGapMin} min`:shortClock(flightActualDeparture(next))}</em></div>`);
  }
  return rows.join('')||'<div class="desk-list-row"><div><b>No connected turnaround</b><span>This flight has no adjacent same-aircraft turn in the visible operating plan.</span></div><em>standalone</em></div>';
}

function selectedDispatchFlight(){
  return selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled)||null;
}

function dispatchOverviewMarkup(){
  const flight=selectedDispatchFlight();
  if(!flight) return '<section class="desk-section dispatch-overview-section"><h2>Overview</h2><div class="empty-state">Select a flight to inspect dispatch context.</div></section>';
  const aircraft=state.aircraft.find(item=>item.id===flight.aircraftId);
  return `<section class="desk-section dispatch-overview-section" data-dispatch-occ-flight="${esc(flight.id)}">
    <h2>Overview</h2>
    ${dispatchOverviewAircraftMarkup(flight,aircraft)}
    <section class="dispatch-turnaround-list"><h2>Turnaround</h2>${dispatchTurnaroundRowsMarkup(flight,aircraft)}</section>
    ${dispatchTimingActionsMarkup()}
    ${dispatchCancellationMarkup(flight)}
  </section>`;
}

function aircraftSwapContext(flight){
  const beforeDeparture=typeof flightHasDeparted==='function'?!flightHasDeparted(flight):!flight.departureLogged;
  const candidates=manualSwapCandidatesForFlight(flight);
  const unavailableReason=beforeDeparture
    ? flight.fueled?'Aircraft swap unavailable after fueling.':!candidates.length?'No suitable replacement aircraft is available.':''
    : 'Aircraft swap is only available before departure.';
  return {candidates,unavailableReason};
}

function dispatchOverviewAircraftMarkup(flight,aircraft){
  const swap=aircraftSwapContext(flight);
  const expanded=dispatchSwapEditorFlightId===flight.id;
  const editor=expanded
    ? `<div class="dispatch-overview-inline-action" data-dispatch-swap-editor="${esc(flight.id)}">
        ${swap.candidates.length?`<div><b>Replacement aircraft</b><span>${swap.candidates.length} suitable candidate${swap.candidates.length===1?'':'s'} at the required station</span></div><div class="occ-action-controls wide"><select data-occ-swap-aircraft aria-label="Replacement aircraft">${swap.candidates.map(item=>`<option value="${esc(item.id)}">${esc(item.tail)} · ${esc(item.model)} · ${esc(item.location)}</option>`).join('')}</select><button class="secondary-button" type="button" data-occ-swap-flight="${esc(flight.id)}">${flight.serviceId?'Confirm turnaround swap':'Confirm aircraft swap'}</button></div>`:`<span class="dispatch-inline-unavailable">${esc(swap.unavailableReason)}</span>`}
      </div>`
    : '';
  return `<div class="desk-list-row dispatch-overview-aircraft-row">
      <div><b>Aircraft</b><span>${esc(aircraft?`${aircraft.tail} · ${aircraft.model} · ${aircraft.location}`:'No assigned aircraft')}</span></div>
      <div class="occ-action-controls"><em>${aircraft?`${Math.round(aircraft.condition??100)}% condition`:''}</em><button class="secondary-button compact" type="button" data-toggle-dispatch-swap="${esc(flight.id)}" aria-expanded="${expanded}">${expanded?'Close swap':'Swap aircraft'}</button></div>
    </div>${editor}`;
}

function dispatchCancellationMarkup(flight){
  const beforeDeparture=typeof flightHasDeparted==='function'?!flightHasDeparted(flight):!flight.departureLogged;
  const canCancelFlight=typeof flightCanBeCancelled==='function'?flightCanBeCancelled(flight):beforeDeparture;
  const turnaroundTargets=typeof turnaroundCancellationTargets==='function'?turnaroundCancellationTargets(flight):[];
  const canCancelTurnaround=canCancelFlight&&turnaroundTargets.length>1;
  const turnaroundLabel=turnaroundTargets.map(item=>item.id).join(' + ');
  return `<section class="dispatch-cancellation-list"><h2>Cancellation</h2>${flightCancellationActionRowsMarkup(flight,canCancelFlight,turnaroundLabel,canCancelTurnaround)}</section>`;
}

function dispatchTimingActionsMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<section class="desk-section occ-actions-section"><h2>Timing</h2><div class="empty-state">Select a flight to use Dispatch timing actions.</div></section>';
  const beforeDeparture=typeof flightHasDeparted==='function'?!flightHasDeparted(flight):!flight.departureLogged;
  const holdUntilValue=datetimeLocalValue(Math.max(flightActualDeparture(flight)+15*MIN,simNow()+15*MIN));
  const timingRows=beforeDeparture
    ? `<div class="occ-action-row">
      <div><b>Timing</b><span>Manual hold</span></div>
      <div class="occ-action-controls"><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="15">+15</button><button class="secondary-button" type="button" data-occ-delay-flight="${esc(flight.id)}" data-delay-min="30">+30</button><input type="number" min="5" max="240" step="5" value="15" aria-label="Custom delay minutes" data-occ-custom-delay><button class="secondary-button" type="button" data-occ-custom-delay-flight="${esc(flight.id)}">Apply</button></div>
    </div>
    <div class="occ-action-row">
      <div><b>Hold until</b><span>Set exact projected departure</span></div>
      <div class="occ-action-controls wide"><input type="datetime-local" value="${esc(holdUntilValue)}" aria-label="Hold until departure time" data-occ-hold-until><button class="secondary-button" type="button" data-occ-hold-until-flight="${esc(flight.id)}">Set time</button></div>
    </div>`
    : `<div class="occ-action-row muted">
      <div><b>Timing</b><span>Departure controls locked after taxi-out.</span></div>
      <div class="occ-action-controls"><span class="dispatch-row-state">departed</span></div>
    </div>`;
  return `<section class="desk-section occ-actions-section" data-dispatch-occ-flight="${esc(flight.id)}">
    <h2>Timing</h2>
    ${timingRows}
  </section>`;
}

function dispatchRouteProblemContext(flight){
  return {id:`dispatch-route-${flight.id}`,type:'dispatch_route_coordination',flightId:flight.id,aircraftId:flight.aircraftId,context:{}};
}

function dispatchAlternateCandidates(flight){
  if(!flight||typeof diversionCandidatesForProblem!=='function') return [];
  const problem=dispatchRouteProblemContext(flight);
  return diversionCandidatesForProblem(problem,{includeReturnOrigin:false})
    .filter(item=>typeof diversionCandidateSuitable==='function'?diversionCandidateSuitable(item):item.rangeOk&&item.weatherOk&&item.handling?.available&&item.fuel?.ok)
    .sort((a,b)=>b.suitability-a.suitability)
    .slice(0,8);
}

function dispatchReturnOriginCandidate(flight){
  if(!flight||typeof diversionCandidatesForProblem!=='function'||!dispatchReturnOriginEligible(flight)) return null;
  const problem=dispatchRouteProblemContext(flight);
  return diversionCandidatesForProblem(problem,{onlyReturnOrigin:true})[0]||null;
}

function dispatchReturnOriginEligible(flight){
  if(!flight||flight.cancelled) return false;
  if(typeof dispatchRouteCoordinationRequiresResponse==='function') return dispatchRouteCoordinationRequiresResponse(flight,simNow());
  const status=statusOfFlight(flight,simNow());
  return ['taxi_out','airborne','taxi_in'].includes(status)||Boolean(flight.departureLogged);
}

function dispatchCandidateLabel(candidate){
  if(!candidate) return '';
  const handling=candidate.handling?.source==='station'?'own station':candidate.handling?.source==='contract'?'contract handling':'handling unknown';
  const fuel=candidate.fuel?.ok?'fuel OK':'fuel check';
  return `${candidate.code} · ${Math.round(candidate.km)} km · ${candidate.weather?.conditions||'weather'} · ${handling} · ${fuel}`;
}

function dispatchRouteRequestStatusMarkup(flight){
  const request=flight?.dispatchRouteRequest;
  if(!request) return '';
  if(request.status==='pending'){
    const remaining=Math.max(0,Math.ceil(((request.respondsAt||simNow())-simNow())/MIN));
    return `<div class="occ-action-context compact dispatch-route-response pending"><b>${esc(request.label||'Route coordination')} pending</b><span>Awaiting flight deck / ATC response · ${remaining} min remaining</span></div>`;
  }
  const accepted=['accepted','partial'].includes(request.status);
  const statusLabel=request.status==='accepted'?'Accepted':request.status==='partial'?'Partially accepted':request.status==='denied'?'Not accepted':'No longer usable';
  const cost=Number(request.appliedCost)||0;
  return `<div class="occ-action-context compact dispatch-route-response ${accepted?'success':'warning'}"><b>${esc(statusLabel)} · ${esc(request.label||'Route coordination')}</b><span>${esc(request.outcome||'Response recorded.')}${cost?` · cost ${money(cost)}`:''}</span></div>`;
}

function dispatchRoutePlanRowsMarkup(flight){
  const comparison=window.AeroRoutePlanning?.flightRouteComparison?.(flight,simNow());
  const active=comparison?.active;
  const filed=comparison?.filed;
  const destinationWeather=Management.weatherAt(flightOperationalDestination(flight),flightActualArrival(flight));
  const rows=[
    `<div class="desk-list-row"><div><b>Filed plan</b><span>${esc(filed?`${filed.from||flight.from} → ${filed.to||flight.to} · ${filed.distanceKm.toLocaleString()} km`:`${flight.from} → ${flight.to}`)}</span></div><em>${esc(filed?.cruiseLevel||'filed')}</em></div>`,
    `<div class="desk-list-row ${comparison?.revised?'highlight':''}"><div><b>Active plan</b><span>${esc(active?`${active.from||flight.from} → ${active.to||flightOperationalDestination(flight)} · ${routeRevisionDispatchLabel(active)}`:`${flight.from} → ${flightOperationalDestination(flight)}`)}</span></div><em>${esc(active?.cruiseLevel||'active')}</em></div>`,
    `<div class="desk-list-row ${destinationWeather.level==='severe'?'highlight':''}"><div><b>Destination picture</b><span>${esc(destinationWeather.conditions)} · capacity ${Math.round((destinationWeather.capacityFactor||1)*100)}% · ETA ${shortClock(flightActualArrival(flight))}</span></div><em>${esc(flightOperationalDestination(flight))}</em></div>`
  ];
  return rows.join('');
}

function dispatchRouteRefilingMarkup(flight){
  const routeWeather=window.AeroRoutePlanning?.routeHazardSummaryForFlight?.(flight,simNow(),{forecast:true});
  const hasHazards=Boolean(routeWeather?.hazards?.length);
  const hasPending=Boolean(flight?.dispatchRouteRequest?.status==='pending');
  return `<div class="occ-action-row">
    <div><b>Route refile</b><span>${hasPending?'A route coordination request is already waiting for response.':hasHazards?esc(`${routeWeather.label||'Route weather'} · ${routeWeather.hazards.length} cell${routeWeather.hazards.length===1?'':'s'}`):'Direct-route refile or measurable weather avoidance.'}</span></div>
    <div class="occ-action-controls wide">
      <button class="secondary-button" type="button" data-dispatch-route-revision="${esc(flight.id)}" data-route-revision-mode="direct" ${hasPending?'disabled':''}>Refile direct</button>
      <button class="secondary-button" type="button" data-dispatch-route-revision="${esc(flight.id)}" data-route-revision-mode="weather_detour" ${hasHazards&&!hasPending?'':'disabled'}>Refile weather avoidance</button>
    </div>
  </div>`;
}

function dispatchAlternateCoordinationMarkup(flight){
  const candidates=dispatchAlternateCandidates(flight);
  const returnCandidate=dispatchReturnOriginCandidate(flight);
  const returnEligible=dispatchReturnOriginEligible(flight);
  const returnSuitable=returnCandidate&&(typeof diversionCandidateSuitable==='function'?diversionCandidateSuitable(returnCandidate):returnCandidate.rangeOk&&returnCandidate.weatherOk&&returnCandidate.handling?.available&&returnCandidate.fuel?.ok);
  const returnLabel=returnCandidate
    ? dispatchCandidateLabel(returnCandidate)
    : returnEligible
      ? 'Origin is not suitable right now under range, weather, fuel, or handling checks.'
      : 'Available after departure.';
  const hasPending=Boolean(flight?.dispatchRouteRequest?.status==='pending');
  return `<section class="desk-section dispatch-route-section" data-dispatch-route-flight="${esc(flight.id)}" data-dispatch-occ-flight="${esc(flight.id)}">
    <h2>Route / Alternate</h2>
    ${dispatchRouteRequestStatusMarkup(flight)}
    ${dispatchRoutePlanRowsMarkup(flight)}
    <div class="occ-action-row">
      <div><b>Alternate plan</b><span>${hasPending?'A route coordination request is already waiting for response.':candidates.length?`${candidates.length} suitable candidate${candidates.length===1?'':'s'}`:'No suitable alternate currently passes range, weather, fuel, and handling checks.'}</span></div>
      <div class="occ-action-controls wide">
        ${candidates.length?`<select data-dispatch-alternate-select ${hasPending?'disabled':''}>${candidates.map(item=>`<option value="${esc(item.code)}">${esc(dispatchCandidateLabel(item))}</option>`).join('')}</select><button class="secondary-button" type="button" data-dispatch-alternate-plan="${esc(flight.id)}" ${hasPending?'disabled':''}>Coordinate alternate</button>`:'<span class="dispatch-row-state">no candidate</span>'}
      </div>
    </div>
    <div class="occ-action-row">
      <div><b>Return to origin</b><span>${esc(hasPending?'A route coordination request is already waiting for response.':returnLabel)}</span></div>
      <div class="occ-action-controls"><button class="secondary-button" type="button" data-dispatch-return-origin="${esc(flight.id)}" ${returnSuitable&&!hasPending?'':'disabled'}>Coordinate return</button></div>
    </div>
    ${dispatchRouteRefilingMarkup(flight)}
    ${enrouteRecoveryActionRowMarkup(flight)}
  </section>`;
}

function dispatchRouteAlternateMarkup(){
  const flight=selectedDispatchFlight();
  if(!flight) return '<section class="desk-section dispatch-route-section"><h2>Route / Alternate</h2><div class="empty-state">Select a flight to coordinate route, alternate, or return planning.</div></section>';
  return dispatchAlternateCoordinationMarkup(flight);
}

function enrouteRecoveryActionRowMarkup(flight){
  const context=typeof enrouteRecoveryContextForFlight==='function'?enrouteRecoveryContextForFlight(flight):null;
  if(!context) return '';
  const pending=context.pending;
  if(pending){
    const remaining=Math.max(0,Math.ceil((pending.respondsAt-simNow())/MIN));
    return `<div class="occ-action-row enroute-recovery-row">
      <div><b>Route</b><span>${esc(pending.label||'Recovery request')} pending · ${remaining} min remaining</span></div>
      <div class="occ-action-controls"><span class="recovery-status-pill"><b>Request sent</b><em>Awaiting ATC / flight deck</em></span></div>
    </div>`;
  }
  const completed=context.completed;
  if(completed){
    const statusLabel=completed.status==='confirmed'?'Accepted':completed.status==='denied'?'Not accepted':completed.status==='unusable'?'No effect':'Completed';
    const tone=completed.status==='confirmed'?'success':completed.status==='denied'?'warning':'muted';
    const outcome=completed.outcome||flight.enrouteRecoveryCause||'Flight deck / ATC response recorded.';
    const recovered=Number(completed.recoveredMin)||0;
    const cost=Number(completed.appliedCost)||0;
    return `<div class="occ-action-row enroute-recovery-row">
      <div><b>Route</b><span>${esc(completed.label||'Recovery request')} response received</span></div>
      <div class="enroute-result-card ${esc(tone)}">
        <b>${esc(statusLabel)}</b>
        <span>${esc(outcome)}</span>
        <em>${recovered?`recovered ${recovered} min`:completed.status==='denied'?'no schedule recovery applied':'no recoverable delay remained'}${cost?` · cost ${money(cost)}`:''}</em>
      </div>
    </div>`;
  }
  const optionButtons=context.options.map(option=>{
    const disabled=Boolean(context.unavailableReason||option.disabled);
    const detail=option.disabledReason||option.detail;
    const responseText=option.responseHighMin
      ? option.responseLowMin===option.responseHighMin?`reply ${option.responseHighMin} min`:`reply ${option.responseLowMin}-${option.responseHighMin} min`
      : 'reply pending';
    return `<button class="choice-button" type="button" data-enroute-recovery="${esc(flight.id)}" data-recovery-option="${esc(option.id)}" ${disabled?'disabled':''}>
      <b>${esc(option.label)}</b>
      <span>${esc(detail)}</span>
      <em class="choice-consequence">possible -${esc(option.recoverMin)} min · ${esc(responseText)} · fuel margin ${esc(option.fuelMarginPct)}%</em>
      <em class="choice-cost">est ${esc(money(option.cost))}</em>
    </button>`;
  }).join('');
  const optionBlockReason=!context.options.some(option=>!option.disabled)?context.options.find(option=>option.disabledReason)?.disabledReason:'';
  const detail=context.unavailableReason||optionBlockReason||`Arrival +${context.arrDelay} min · ${context.remainingMin} min remaining · fuel margin ${context.fuelMarginPct}%`;
  const recovery=Number(flight.enrouteRecoveryMin)||0;
  return `<div class="occ-action-row enroute-recovery-row">
    <div><b>Route</b><span>${esc(detail)}${recovery?` · recovered ${recovery} min`:''}</span></div>
    <div class="choice-list enroute-choice-list">${optionButtons}</div>
  </div>`;
}

function flightCancellationActionRowsMarkup(flight,canCancelFlight=!flight.departureLogged,turnaroundLabel='',canCancelTurnaround=false){
  const status=statusOfFlight(flight);
  const canCancelLabel=status==='taxi_out'?'Return to gate and cancel this leg; paired or later legs remain in the programme.':'Cancels only this leg; paired or later legs remain in the programme.';
  const blockedLabel=typeof flightCancellationUnavailableReason==='function'?flightCancellationUnavailableReason(flight):'Aircraft is airborne or completed.';
  return `<div class="occ-action-row">
      <div><b>Cancel flight</b><span>${canCancelFlight?canCancelLabel:blockedLabel}</span></div>
      <div class="occ-action-controls"><button class="danger-button" type="button" data-occ-cancel-single-flight="${esc(flight.id)}" ${canCancelFlight?'':'disabled'}>Cancel flight</button></div>
    </div>
    ${flight.serviceId?`<div class="occ-action-row">
      <div><b>Turnaround</b><span>${canCancelTurnaround?`Cancels ${esc(turnaroundLabel)} only; the recurring schedule remains active.`:'No complete future turnaround pair is available.'}</span></div>
      <div class="occ-action-controls"><button class="danger-button" type="button" data-occ-cancel-turnaround="${esc(flight.id)}" ${canCancelTurnaround?'':'disabled'}>Cancel turnaround</button></div>
    </div>`:''}`;
}

function dispatchDelayAnalysisMarkup(){
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId&&!item.cancelled);
  if(!flight) return '<section class="desk-section dispatch-delay-section"><h2>Delay</h2><div class="empty-state">Select a flight to inspect delay causes.</div></section>';
  const analysis=flightDelayAnalysis(flight);
  if(!analysis.active) return `<section class="desk-section dispatch-delay-section" data-dispatch-delay-flight="${esc(flight.id)}"><h2>Delay</h2><div class="desk-list-row"><div><b>On plan</b><span>No departure or arrival delay is currently projected.</span></div><em>${esc(shortClock(flightActualDeparture(flight)))}</em></div></section>`;
  const primary=analysis.primary;
  const causeRows=analysis.causes.map((item,index)=>`<div class="desk-list-row ${index?'':'highlight'}"><div><b>${esc(item.minutes<0?'Recovery':index?'Contributing cause':'Primary cause')}: ${esc(item.label)}</b><span>${esc(item.detail||'Operational timing impact')}</span></div><em>${item.minutes<0?item.minutes:`+${item.minutes}`} min</em></div>`).join('');
  return `<section class="desk-section dispatch-delay-section" data-dispatch-delay-flight="${esc(flight.id)}">
    <h2>Delay</h2>
    <div class="occ-action-context compact"><b>Departure +${analysis.depDelay} · arrival +${analysis.arrDelay}</b><span>${primary?esc(primary.label):'Operational timing impact'}</span></div>
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

function releaseAircraftOptions(){
  return state.aircraft.slice()
    .sort((a,b)=>a.tail.localeCompare(b.tail))
    .map(aircraft=>{
      const blocked=aircraftHasAssignments(aircraft.id);
      const next=state.flights
        .filter(flight=>flight.aircraftId===aircraft.id&&!flight.cancelled&&!flight.settled&&flightActualArrival(flight)>simNow())
        .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
      const detail=blocked
        ? next?`assigned to ${next.id} ${shortDay(flightActualDeparture(next))} ${shortClock(flightActualDeparture(next))}`:'active schedule or ground task'
        : `available at ${aircraft.location}`;
      return {id:aircraft.id,label:`${aircraft.tail} · ${aircraft.model}`,detail,blocked};
    });
}

function releaseAircraftPanelMarkup(){
  const options=releaseAircraftOptions();
  if(!options.length) return '<div class="empty-state">No aircraft in the operations pool.</div>';
  return `<div class="form-grid compact-form"><label>Aircraft<select data-release-aircraft-select>${options.map(option=>`<option value="${esc(option.id)}" ${option.blocked?'disabled':''}>${esc(option.label)} · ${esc(option.detail)}</option>`).join('')}</select></label></div>
    <div class="form-actions"><button class="danger-button" type="button" data-release-aircraft-corporate>Remove aircraft</button></div>
    <p class="panel-note">Only aircraft without active services, future flights, or open ground work can be removed.</p>`;
}

function planningDeskMarkup(){
  const tabDefinitions=[
    {panel:'overview',label:'Overview'},
    {panel:'route',label:'Route / Alternate'},
    {panel:'delay',label:'Delay'}
  ];
  if(activeDeskPanel('planning')&&!tabDefinitions.some(item=>item.panel===activeDeskPanel('planning'))){
    delete workspaceUi.nextDeskPanels.planning;
    saveWorkspaceUi();
  }
  const active=activeDeskTab('planning');
  const tabs=deskActionBar('planning',tabDefinitions);
  return `${dispatchSelectedFlightMarkup()}${tabs}
    ${active==='overview'?dispatchOverviewMarkup():''}
    ${active==='route'?dispatchRouteAlternateMarkup():''}
    ${active==='delay'?dispatchDelayAnalysisMarkup():''}`;
}

function personnelDeskMarkup(requests,transfers,crewExposures=null){
  const active=activeDeskTab('personnel');
  const exposures=crewExposures||(typeof crewAccommodationExposures==='function'?crewAccommodationExposures():[]);
  return `${deskPanelMarkup('personnel','relocation','Move personnel')}
    ${active==='crew-impact'?crewAccommodationMarkup(exposures):''}
    ${active==='relocation'?resourceActivityMarkup([],transfers,'Personnel movement'):''}
    ${active==='overview'?personnelPoolsMarkup():''}`;
}

function activeNetworkConstraints(now=simNow()){
  return (state.networkEvents||[]).filter(event=>(event.activeFrom||0)<=now&&(event.activeUntil||0)>now);
}

function networkConstraintRows(events=activeNetworkConstraints()){
  const now=simNow();
  return events
    .slice(0,5)
    .map(event=>{
      const affected=typeof globalThis.AeroNetworkEvents?.affectedFlightsForNetworkEvent==='function'
        ? globalThis.AeroNetworkEvents.affectedFlightsForNetworkEvent(event,now).length
        : event.affectedFlightIds?.length||0;
      const windowText=`${shortClock(event.activeFrom)}-${shortClock(event.activeUntil)}`;
      return `<div class="desk-list-row"><div><b>${esc(event.label||event.reason||event.eventType||'Network constraint')}</b><span>${esc(event.reason||'Shared route constraint')} · ${affected} affected flight${affected===1?'':'s'}</span></div><em>${esc(windowText)}</em></div>`;
    });
}

function networkFlowDeskMarkup(events=activeNetworkConstraints()){
  const rows=networkConstraintRows(events);
  return `<section class="desk-section"><h2>Active constraints</h2>${rows.length?rows.join(''):'<div class="empty-state">No active shared airspace or flow constraints.</div>'}</section>`;
}

function incidentAttentionFlight(flight,now=simNow()){
  const status=statusOfFlight(flight,now).replaceAll('_',' ');
  const delay=flightTotalDepartureDelayMin(flight);
  return {
    id:flight.id,
    route:`${flight.from} → ${flightOperationalDestination(flight)}`,
    detail:[status,delay?`+${delay} min`:shortClock(flightActualDeparture(flight))].filter(Boolean).join(' · ')
  };
}

function incidentAttentionRequiredResponse(problems,now=simNow()){
  const problem=problems.find(item=>item.requiredResponse?.status==='pending')
    ||problems.find(item=>item.requiredResponse?.status==='received');
  const response=problem?.requiredResponse;
  if(!response) return null;
  const duration=Math.max(1,response.respondsAt-response.requestedAt);
  const remaining=Math.max(0,Math.ceil((response.respondsAt-now)/MIN));
  const ownerLabel={cabin:'Cabin crew',flightDeck:'Flight deck',maintenance:'Maintenance Control',atc:'ATC'}[response.owner]||'Operational desk';
  return {
    status:response.status,
    owner:response.owner,
    ownerLabel,
    label:response.label,
    requestedAt:response.requestedAt,
    respondsAt:response.respondsAt,
    progress:clamp((now-response.requestedAt)/duration,0,1),
    remainingLabel:remaining?`${remaining} min remaining`:`${ownerLabel} response due`,
    title:response.title,
    detail:response.detail,
    severityLabel:response.severityLabel||'',
    decision:response.decision||response.title||''
  };
}

function incidentAttentionDefaultConsequence(problems,now=simNow()){
  if(typeof problemDefaultConsequence!=='function') return null;
  const consequence=problems
    .map(problem=>problemDefaultConsequence(problem,now))
    .filter(Boolean)
    .sort((a,b)=>a.deadline-b.deadline)[0];
  if(!consequence) return null;
  return {
    ...consequence,
    remainingLabel:consequence.deadline>now
      ? `${Math.max(1,Math.ceil((consequence.deadline-now)/MIN))} min remaining`
      : 'Default action due',
    progress:clamp((now-consequence.startAt)/Math.max(MIN,consequence.deadline-consequence.startAt),0,1)
  };
}

function incidentAttentionCards(groups,now=simNow()){
  const index=operationalIndex(now);
  return groups.map(group=>{
    const root=group.root||group.problems[0];
    const ids=new Set();
    group.problems.forEach(problem=>problemAffectedFlightIds(problem).forEach(id=>ids.add(id)));
    const flights=[...ids]
      .map(id=>index.flightsById.get(id))
      .filter(Boolean)
      .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
    const rootFlight=index.flightsById.get(root.flightId)||flights[0]||null;
    const aircraft=index.aircraftById.get(root.aircraftId)||null;
    const affectedCount=Math.max(ids.size,root.context?.affectedCount||0);
    const copy=problemCopy(root);
    const linkedEffects=Math.max(0,group.problems.length-1);
    const blocking=group.problems.some(problem=>problem.blocking);
    const actionable=group.problems.some(problem=>problemNeedsUserAction(problem,now));
    const requiredResponse=incidentAttentionRequiredResponse(group.problems,now);
    const defaultConsequence=incidentAttentionDefaultConsequence(group.problems,now);
    const crewAbsences=[...new Map(group.problems.flatMap(problem=>crewAbsencesForProblem(problem)).map(item=>[item.id,item])).values()];
    return {
      id:group.id,
      title:copy.title,
      summary:[copy.summary,linkedEffects?`${linkedEffects} linked operational effect${linkedEffects===1?'':'s'}`:''].filter(Boolean).join(' · '),
      scope:problemProblemScopeLabel(root,rootFlight,aircraft,affectedCount),
      status:requiredResponse?.status==='pending'?`Waiting ${requiredResponse.ownerLabel.toLowerCase()}`:blocking?'Blocking':actionable?'Action':'Monitor',
      affectedCount,
      requiredResponse,
      defaultConsequence,
      crewAbsences,
      flights:flights.map(flight=>incidentAttentionFlight(flight,now))
    };
  });
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
    const actions=(item.actions||[]).filter(action=>!(item.records||[]).some(entry=>entry.action===action.id&&entry.status==='confirmed')).map(action=>{
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
      if(record) return `<span class="recovery-status-pill"><b>${esc(action.label)}</b><em>${esc(crewRecoveryStatusLabel(record.status))} · ${esc(crewRecoveryAvailabilityLabel(record,now))}</em></span>`;
      return `<button class="secondary-button" type="button" data-crew-recovery="${esc(item.flightId)}" data-crew-recovery-action="${esc(action.id)}">${esc(action.label)}</button>`;
    }).join('');
    const detail=[
      item.reason,
      item.releaseDelayMin?`+${item.releaseDelayMin} min release`:'',
      item.plannedReleaseAirport&&item.plannedReleaseAirport!==item.releaseAirport?`planned ${item.plannedReleaseAirport}`:'',
      item.activeRecord?.availableAirport?`available at ${item.activeRecord.availableAirport}`:'',
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

function renderDeskStack(force=false,fromInteraction=false){
  const root=document.getElementById('deskStack');
  if(!root) return;
  const now=simNow();
  const index=operationalIndex(now);
  const problems=openOperationalProblems();
  const problemGroups=disruptionCaseGroups(problems,now);
  const incidentCards=incidentAttentionCards(problemGroups,now);
  const disruptionGroupCount=problemGroups.length;
  const passengerExposures=typeof passengerRecoveryExposures==='function'?passengerRecoveryExposures(now):[];
  const passengerActionCount=passengerExposures.filter(item=>!item.arranged).length;
  const networkConstraints=activeNetworkConstraints(now);
  const stationWorkCount=stationServiceRequests().filter(record=>record.airport===stationSelectedAirport()&&stationServiceReserved(record)).length;
  const allWarnings=operationWarnings(now,index);
  const warnings=visibleOperationWarnings(allWarnings);
  const attentionCount=disruptionGroupCount+warnings.length;
  const signature=[
    selectedFlightId||'',selectedAircraftId||'',
    problems.map(item=>`${item.id}:${item.status}:${item.blocking?1:0}:${item.caseId||''}:${item.rootProblemId||''}:${item.triggeredByProblemId||''}:${item.chainReason||''}:${item.requiredResponse?.status||''}:${item.requiredResponse?.respondsAt||0}:${item.requiredResponse?.outcomeId||''}:${Object.values(item.unattended?.flights||{}).map(entry=>`${entry.flightId}:${entry.status}:${entry.mode}:${entry.deadline}:${entry.pendingUntil||0}:${entry.appliedAt||0}`).join(',')}:${(item.impacts||[]).map(impact=>`${impact.key}:${impact.status}:${impact.summary}`).join(',')}`).join('|'),
    (state.externalRequests||[]).map(item=>`${item.id}:${item.status}:${item.respondsAt}`).join('|'),
    (state.services||[]).map(service=>`${service.id}:${service.active?1:0}:${service.aircraftId}:${service.nextDeparture}`).join('|'),
    selectedFlightId?(()=>{
      const f=index.flightsById.get(selectedFlightId);
      const routePlan=f?.routePlan;
      const activeRoute=window.AeroRoutePlanning?.activeRevision?.(routePlan);
      const revisions=Array.isArray(routePlan?.revisions)?routePlan.revisions:[];
      const forecast=f?flightWeatherForecastContext(f,now):null;
      const weatherKey=forecast
        ? `${forecast.origin.level}:${forecast.origin.delayMin}:${forecast.destinationWeather.level}:${forecast.destinationWeather.delayMin}:${forecast.routeWeather.level}:${forecast.routeWeather.delayMin}:${(forecast.hazards||[]).map(item=>`${item.id}:${item.delayMin}:${item.severity}`).join(',')}:${Math.floor((forecast.forecastTime||now)/(30*MIN))}`
        : '';
      const routeRequest=f?.dispatchRouteRequest||{};
      const routeRefreshKey=activeDeskTab('planning')==='route'&&typeof dispatchRouteCoordinationRequiresResponse==='function'&&dispatchRouteCoordinationRequiresResponse(f,now)
        ? Math.floor(now/(5*MIN))
        : 0;
      return f?`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.aircraftId}:${f.cancelled?1:0}:${f.staffingBlocked?1:0}:${f.enrouteRecoveryMin||0}:${f.enrouteRecoveryCost||0}:${f.enrouteRecoveryRequest?.status||''}:${f.enrouteRecoveryRequest?.respondsAt||0}:${routeRequest.status||''}:${routeRequest.respondsAt||0}:${routeRequest.mode||''}:${routeRequest.airport||''}:${routeRequest.outcome||''}:${activeRoute?.id||''}:${activeRoute?.mode||''}:${activeRoute?.to||''}:${revisions.length}:${weatherKey}:${routeRefreshKey}`:'';
    })():'',
    warnings.map(item=>`${item.id}:${item.level}:${item.flightId||''}:${item.aircraftId||''}:${item.title}:${item.detail}:${item.sortAt}:${item.clearing?1:0}`).join('|'),
    passengerExposures.map(item=>`${item.flightId}:${item.cost}:${item.arranged?1:0}:${item.reason}:${item.overnightPax}:${item.criticalConnections}:${item.atRiskConnections}:${(item.records||[]).map(record=>`${record.action}:${record.status}:${record.updatedAt}`).join(',')}`).join('|'),
    (state.passengerRecoveries||[]).map(item=>`${item.id}:${item.flightId}:${item.action}:${item.status}:${item.updatedAt}:${item.completedAt}`).join('|'),
    state.aircraft.map(ac=>`${ac.id}:${ac.location}:${attentionForAircraft(ac)}:${Math.round(ac.condition??100)}`).join('|'),
    state.slotRights.length,
    JSON.stringify(state.personnel.assignments||{}),
    stationServicesRenderKey(now),
    JSON.stringify(workspaceUi.collapsed.occ||{}),JSON.stringify(workspaceUi.nextDeskPanels||{}),
    JSON.stringify(workspaceUi.dismissedWarnings||{})
  ].join('::');
  if(!force&&signature===lastDeskStackSignature){ noteRenderSurface?.('desk','skipped'); return; }
  if(!fromInteraction&&activeFormControlWithin(root)) return;
  lastDeskStackSignature=signature;
  noteRenderSurface?.('desk','rendered');
  restoreEmbeddedManagementPages(root);
  root.innerHTML=`<div class="desk-stack-column desk-stack-work" data-desk-column="work">
      ${occWidgetMarkup('planning','Dispatch desk','Dispatch',0,selectedFlightId?'Selected-flight control':'Select a flight for OCC actions','',planningDeskMarkup(),{empty:!selectedFlightId,autoCompact:true})}
      ${occWidgetMarkup('station','Station operations','Station Operations',stationWorkCount,'Exceptional station coordination','',stationServicesDeskMarkup(),{empty:false})}
      ${occWidgetMarkup('network','Network control','Network / Flow',networkConstraints.length,networkConstraints.length?'Active shared network constraints':'No shared network constraints','',networkFlowDeskMarkup(networkConstraints),{empty:!networkConstraints.length,autoCompact:true})}
      ${occWidgetMarkup('passengers','Passenger desk','Passenger impact',passengerActionCount,passengerActionCount?`${passengerActionCount} passenger impact item${passengerActionCount===1?'':'s'} need coordination`:'No passenger impact exposure','',passengerRecoveryDeskMarkup(passengerExposures),{empty:!passengerActionCount,autoCompact:true})}
    </div>
    <div class="desk-stack-column desk-stack-attention" data-desk-column="attention">
      ${occWidgetMarkup('warnings','Operational attention','Incidents & warnings',attentionCount,attentionCount?`${disruptionGroupCount} critical incident${disruptionGroupCount===1?'':'s'} · ${warnings.length} warning${warnings.length===1?'':'s'}`:'No operational attention required',deskActionBar('warnings',[
        {kind:'direct',label:'Training scenario',attr:'data-training-problem'}
      ]),incidentsWarningsDeskMarkup(incidentCards,warnings),{empty:!attentionCount,autoCompact:true})}
    </div>`;
  mountOccManagementPages(root);
  bindStationServiceControls(root);
  root.querySelectorAll('[data-toggle-desk]').forEach(button=>button.addEventListener('click',event=>{
    if(event.target.closest('.info-tip')) return;
    const desk=button.dataset.toggleDesk;
    const widget=button.closest('[data-desk-widget]');
    if(widget?.classList.contains('auto-compact')){
      expandedEmptyDesks.add(desk);
      setDeskOpen(desk,true,{persist:true});
      markUiDirty('desk');
      return;
    }
    expandedEmptyDesks.delete(desk);
    setDeskOpen(desk,!isDeskOpen(desk),{persist:true});
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    const [desk,panel]=button.dataset.deskPanel.split(':');
    setDeskPanel(desk,panel);
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-close-desk-panel]').forEach(button=>button.addEventListener('click',()=>{
    setDeskPanel(button.dataset.closeDeskPanel,'');
    markUiDirty('desk');
  }));
  root.querySelector('[data-training-problem]')?.addEventListener('click',generateTrainingProblem);
  root.querySelectorAll('[data-case-affected-flight]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelectedFlight(button.dataset.caseAffectedFlight);
  }));
  root.querySelectorAll('[data-context-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelected(button.dataset.contextAircraft);
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
  root.querySelectorAll('[data-toggle-dispatch-swap]').forEach(button=>button.addEventListener('click',()=>{
    const flightId=button.dataset.toggleDispatchSwap;
    dispatchSwapEditorFlightId=dispatchSwapEditorFlightId===flightId?'':flightId;
    markUiDirty('desk');
  }));
  root.querySelectorAll('[data-occ-swap-flight]').forEach(button=>button.addEventListener('click',()=>{
    const select=button.closest('[data-dispatch-occ-flight]')?.querySelector('[data-occ-swap-aircraft]');
    if(!select) return;
    const flight=state.flights.find(item=>item.id===button.dataset.occSwapFlight);
    const previousAircraftId=flight?.aircraftId;
    swapSelectedFlightAircraft(button.dataset.occSwapFlight,select.value);
    if(flight&&flight.aircraftId!==previousAircraftId) dispatchSwapEditorFlightId='';
    markUiDirty('desk','left','schedule','map');
  }));
  root.querySelectorAll('[data-occ-cancel-single-flight]').forEach(button=>button.addEventListener('click',()=>cancelSingleFlight(button.dataset.occCancelSingleFlight)));
  root.querySelectorAll('[data-occ-cancel-turnaround]').forEach(button=>button.addEventListener('click',()=>cancelTurnaround(button.dataset.occCancelTurnaround)));
  root.querySelectorAll('[data-enroute-recovery]').forEach(button=>button.addEventListener('click',()=>requestEnrouteRecovery(button.dataset.enrouteRecovery,button.dataset.recoveryOption)));
  root.querySelectorAll('[data-dispatch-route-revision]').forEach(button=>button.addEventListener('click',()=>{
    coordinateDispatchRouteRevision(button.dataset.dispatchRouteRevision,button.dataset.routeRevisionMode||'direct');
  }));
  root.querySelectorAll('[data-dispatch-alternate-plan]').forEach(button=>button.addEventListener('click',()=>{
    const section=button.closest('[data-dispatch-route-flight]');
    const airport=section?.querySelector('[data-dispatch-alternate-select]')?.value||'';
    coordinateDispatchDestinationPlan(button.dataset.dispatchAlternatePlan,airport,{mode:'diversion',reason:'Dispatch alternate coordination'});
  }));
  root.querySelectorAll('[data-dispatch-return-origin]').forEach(button=>button.addEventListener('click',()=>{
    const flight=state.flights.find(item=>item.id===button.dataset.dispatchReturnOrigin&&!item.cancelled);
    coordinateDispatchDestinationPlan(button.dataset.dispatchReturnOrigin,flight?.from||'',{mode:'return_origin',reason:'Dispatch return-to-origin coordination'});
  }));
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
  refreshManagement(true);
}

function openDesk(desk){
  const destination=desk==='crew'?'personnel':desk==='maintenance'?'maintenance':desk==='dispatch'?'planning':desk==='station'?'station':desk==='network'?'network':['fleet','resources'].includes(desk)?'planning':'warnings';
  if(destination==='personnel'){
    setRailWidgetOpen('personnel',true,{persist:true});
    if(desk==='crew') setDeskPanel('personnel','crew-impact',{toggle:false});
    markUiDirty('left');
    document.querySelector('[data-rail-widget="personnel"]')?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  if(destination==='maintenance'){
    setRailWidgetOpen('maintenance',true,{persist:true});
    refreshRailCollapseState();
    document.querySelector('[data-rail-widget="maintenance"]')?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
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
  const signature=`${contextMode}:${selectedFlightId||''}:${selectedAircraftId||''}`;
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
}

function refreshDepartmentWidgets(force=false){
  renderDeskStack(force);
}

function setElementText(id,value){
  const element=document.getElementById(id);
  if(element&&element.textContent!==String(value)) element.textContent=String(value);
}

function refreshHeader(){
  const now=simNow();
  const active=operationalIndex(now).activeFlights;
  const openProblemCount=openOperationalProblems().length;
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
  setElementText('simClock',new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(now)));
  setElementText('headerActive',active.length);
  setElementText('headerUpcoming',upcomingCount);
  setElementText('headerOnTime',`${onTime}%`);
  const title=`(${openProblemCount}) ${APP_TITLE}`;
  if(document.title!==title) document.title=title;
  refreshPauseControl();
}
function refreshKPIs(){ refreshHeader(); }

function refreshPauseControl(){
  const speedSelect=document.getElementById('speed');
  const pauseButton=document.getElementById('pauseTopbarBtn');
  const paused=simulationIsPaused();
  const displayedSpeed=paused?normalizedClockSpeed(state.clock?.previousSpeed,1):normalizedClockSpeed(state.clock?.speed,1);
  if(speedSelect){
    speedSelect.value=String(displayedSpeed);
    speedSelect.disabled=paused;
  }
  if(pauseButton){
    const label=paused?'Resume simulation':'Pause simulation';
    const icon=paused?'&#9654;':'&#10074;&#10074;';
    if(pauseButton.innerHTML!==icon) pauseButton.innerHTML=icon;
    if(pauseButton.title!==label) pauseButton.title=label;
    if(pauseButton.getAttribute('aria-label')!==label) pauseButton.setAttribute('aria-label',label);
    pauseButton.setAttribute('aria-pressed',paused?'true':'false');
    pauseButton.classList.toggle('paused',paused);
  }
}

function setHomeBase(code){
  if(!AIRPORTS[code]) return;
  state.home=code;
  save();
  populateManagementControls();
  refreshAircraftSelect(true);
  refreshManagement(true);
  refreshSchedulePreview();
  if(typeof centerMapOnHomeBase==='function') centerMapOnHomeBase({animate:true});
  markUiDirty('header','desk','left','filter','weather','map');
  toast(`Home base set to ${code}.`);
}

function plannerMinimumTurnaround(){
  const ac=state.aircraft.find(item=>item.id===aircraftEl.value);
  if(!ac) return 90;
  const turnStation=AIRPORTS[destEl.value]?destEl.value:ac.location||state.home;
  return Math.max(25,minimumTurnMinutes(ac,turnStation));
}
function syncPlannerTurnaroundMinimum({force=false}={}){
  if(!turnaroundEl) return;
  const minimum=plannerMinimumTurnaround();
  const previousAuto=Number(turnaroundEl.dataset.minimumTurnaround)||0;
  const current=Number(turnaroundEl.value);
  const untouched=!turnaroundEl.dataset.userTurnaround||current===previousAuto;
  turnaroundEl.min=String(minimum);
  turnaroundEl.dataset.minimumTurnaround=String(minimum);
  if(force||untouched||!Number.isFinite(current)||current<minimum){
    turnaroundEl.value=String(minimum);
    if(force||current<minimum) delete turnaroundEl.dataset.userTurnaround;
  }
}
function notePlannerTurnaroundEdit(){
  const current=Number(turnaroundEl.value);
  const automatic=Number(turnaroundEl.dataset.minimumTurnaround)||plannerMinimumTurnaround();
  if(Number.isFinite(current)&&current!==automatic) turnaroundEl.dataset.userTurnaround='true';
  else delete turnaroundEl.dataset.userTurnaround;
}

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring',ferry=scheduleTypeEl.value==='ferry';
  document.getElementById('repeatRuleWrap').hidden=!recurring;
  document.getElementById('turnaroundWrap').hidden=!recurring;
  if(recurring) syncPlannerTurnaroundMinimum();
  if(ferry){
    const ac=state.aircraft.find(item=>item.id===aircraftEl.value),departure=nextTimestampForClock(departureTimeEl.value);
    const projected=ac&&aircraftProjectedLocation(ac,departure||simNow());
    if(projected?.location&&AIRPORTS[projected.location]) originEl.value=projected.location;
  }
  refreshSchedulePreview();
}
function routeGraphicProjection(rawTracks,{width=260,height=88,pad=12}={}){
  const sourceTracks=(rawTracks||[]).map(track=>({
    ...track,
    waypoints:(track.waypoints||[]).filter(point=>Number.isFinite(point.lat)&&Number.isFinite(point.lon))
  })).filter(track=>track.waypoints.length>=2);
  if(!sourceTracks.length) return {width,height,tracks:[]};
  const anchorLon=sourceTracks[0].waypoints[0].lon;
  const unwrappedTracks=sourceTracks.map(track=>{
    let previousLon=anchorLon;
    return {
      ...track,
      waypoints:track.waypoints.map(point=>{
        let lon=point.lon;
        while(lon-previousLon>180) lon-=360;
        while(previousLon-lon>180) lon+=360;
        previousLon=lon;
        return {...point,lon};
      })
    };
  });
  const all=unwrappedTracks.flatMap(track=>track.waypoints);
  const minLon=Math.min(...all.map(point=>point.lon));
  const maxLon=Math.max(...all.map(point=>point.lon));
  const minLat=Math.min(...all.map(point=>point.lat));
  const maxLat=Math.max(...all.map(point=>point.lat));
  const spanLon=Math.max(.01,maxLon-minLon);
  const spanLat=Math.max(.01,maxLat-minLat);
  return {
    width,
    height,
    pad,
    minLon,
    maxLon,
    minLat,
    maxLat,
    spanLon,
    spanLat,
    tracks:unwrappedTracks.map(track=>({
      ...track,
      points:track.waypoints.map(point=>({
        ...point,
        x:pad+(point.lon-minLon)/spanLon*(width-pad*2),
        y:pad+(maxLat-point.lat)/spanLat*(height-pad*2)
      }))
    }))
  };
}
function routeGraphicProjectPoint(graphic,point){
  if(!graphic||!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)) return null;
  let lon=Number(point.lon);
  const center=(graphic.minLon+graphic.maxLon)/2;
  while(lon-center>180) lon-=360;
  while(center-lon>180) lon+=360;
  const x=graphic.pad+(lon-graphic.minLon)/graphic.spanLon*(graphic.width-graphic.pad*2);
  const y=graphic.pad+(graphic.maxLat-point.lat)/graphic.spanLat*(graphic.height-graphic.pad*2);
  if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
  return {x,y};
}
function routeGraphicPath(points){
  return (points||[]).map((point,index)=>`${index?'L':'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}
function routePreviewPathMarkup(routePreview,from,to){
  const graphic=routeGraphicProjection([{key:'preview',waypoints:routePreview?.waypoints||[]}]);
  const projected=graphic.tracks[0]?.points||[];
  if(projected.length<2) return '';
  const d=routeGraphicPath(projected);
  const sampledFixes=projected.slice(1,-1).filter((_,index)=>index%Math.max(1,Math.ceil(projected.length/7))===0).slice(0,6);
  const labels=projected.filter((_,index)=>index===0||index===projected.length-1);
  const title=`${from} to ${to} · ${routePreview.waypointCount} waypoints · ${routePreview.cruiseLevel||'planned cruise'} · ${Math.round(routePreview.distanceKm||0).toLocaleString()} km`;
  return `<figure class="route-preview-card" title="${esc(title)}">
    <svg class="route-preview-map" viewBox="0 0 ${graphic.width} ${graphic.height}" role="img" aria-label="${esc(title)}">
      <path class="route-preview-shadow" d="${esc(d)}"></path>
      <path class="route-preview-path" d="${esc(d)}"></path>
      ${sampledFixes.map(point=>`<circle class="route-preview-fix" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.2"></circle>`).join('')}
      ${labels.map((point,index)=>`<g class="route-preview-endpoint ${index?'destination':'origin'}"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5"></circle><text x="${point.x.toFixed(1)}" y="${(point.y+(point.y<18?14:-8)).toFixed(1)}">${esc(index?to:from)}</text></g>`).join('')}
    </svg>
    <figcaption><b>${esc(routePreview.mode==='filed'?'Filed route':'Route preview')}</b><span>${esc(routePreview.routeText||`${from} → ${to}`)}</span><em>${esc(routePreview.cruiseLevel||'')}</em></figcaption>
  </figure>`;
}
function refreshSchedulePreview(){
  const ac=state.aircraft.find(item=>item.id===aircraftEl.value),from=originEl.value,to=destEl.value,departure=nextTimestampForClock(departureTimeEl.value);
  if(!ac||!departure||from===to){document.getElementById('schedulePreview').textContent='Choose an aircraft, two airports, and a departure time.';return;}
  const ferry=scheduleTypeEl.value==='ferry',estimate=ferry?estimateFerryFlight(from,to,ac,departure):estimateFlight(from,to,ac,currentScheduleFares(),{departure});
  let message=`${Math.round(estimate.km)} km · ${formatDuration(estimate.duration)} block time · ${estimate.rangeOk?'within range':'outside aircraft range'}`;
  if(!ferry) message+=` · projected ${estimate.pax||0} passengers`;
  const routePreview=window.AeroRoutePlanning?.previewRoute?.(from,to,ac,departure);
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
  document.getElementById('schedulePreview').innerHTML=`<div class="schedule-preview-summary"><b>${esc(ac.tail)} · ${esc(from)} → ${esc(to)}</b><span>${esc(message)}</span></div>${routePreviewPathMarkup(routePreview,from,to)}`;
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
  const station=staffAt(from,role),reserved=reservedOutboundPersonnelAt(from,role),available=availableStationStaffAt(from,role),same=from===to,plan=external&&!same?externalTransferPlan(from,to,amount):null,selected=flights.find(f=>f.id===select.value);
  document.getElementById('personnelTransferPreview').textContent=same?'Choose two different airports.':available<amount?`Only ${available} available at ${from}${reserved?` (${station} at station, ${reserved} committed to booked moves)`:''}.`:external?`New external booking · estimated arrival ${formatTime(plan.arrival)}.`:selected?`New non-revenue booking on ${selected.id} · arrival ${formatTime(flightActualArrival(selected))}.`:'No own flight has enough spare seats.';
  document.getElementById('transferPersonnelBtn').disabled=same||available<amount||(!external&&!selected);
}
function createPersonnelTransfer(){
  const role=document.getElementById('transferPersonnelRole').value,from=document.getElementById('transferPersonnelFrom').value,to=document.getElementById('transferPersonnelTo').value,amount=clamp(Math.floor(Number(document.getElementById('transferPersonnelAmount').value)||1),1,50),method=document.getElementById('transferPersonnelMethod').value;
  const qualifications=qualificationTransferMix(from,role,amount); if(!PERSONNEL[role]||from===to||availableStationStaffAt(from,role)<amount||qualifications===null) return toast('That personnel transfer is not available.');
  const id='PT'+state.nextPersonnelTransfer++; let transfer;
  if(method==='own'){
    const flight=eligiblePersonnelFlights(from,to,amount).find(f=>f.id===document.getElementById('transferPersonnelFlight').value); if(!flight) return toast('That own flight is no longer suitable.');
    transfer={id,role,amount,from,to,method,qualifications,flightId:flight.id,departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),cost:0,status:'scheduled',originDebited:false,createdAt:simNow()};
  }else{ const plan=externalTransferPlan(from,to,amount); transfer={id,role,amount,from,to,method,qualifications,departure:plan.departure,arrival:plan.arrival,cost:0,status:'scheduled',originDebited:false,createdAt:simNow()}; }
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
    const mel=activeMelItemsForAircraft(ac);
    return `<div class="data-row"><div><b>${esc(ac.tail)} · ${esc(status.label)}</b><span>Condition ${Math.round(ac.condition??100)}% · ${Math.round(status.remainingHours)} h / ${Math.round(status.remainingCycles)} cycles remaining${job?` · ${shortDay(job.start)} ${shortClock(job.start)}`:''}${mel.length?` · ${mel.length} MEL item${mel.length===1?'':'s'}`:''}</span>${melDetailsMarkup(mel,simNow())}</div><div class="data-row-actions">${job&&job.status==='scheduled'?`<button class="secondary-button" type="button" data-cancel-check="${esc(ac.id)}">Cancel work</button>`:`<input type="datetime-local" data-maintenance-start-for="${esc(ac.id)}" value="${esc(datetimeLocalValue(defaultMaintenanceStart(ac.id)))}"><button class="primary-button" type="button" data-schedule-check="${esc(ac.id)}">Schedule check</button>`}</div></div>`;
  }).join(''):'<div class="empty-state">No aircraft assigned.</div>';
  list.querySelectorAll('[data-schedule-check]').forEach(button=>button.addEventListener('click',()=>{
    const input=list.querySelector(`[data-maintenance-start-for="${CSS.escape(button.dataset.scheduleCheck)}"]`);
    scheduleAircraftMaintenance(button.dataset.scheduleCheck,input?.value?new Date(input.value).getTime():undefined);
  }));
  list.querySelectorAll('[data-cancel-check]').forEach(button=>button.addEventListener('click',()=>cancelAircraftMaintenance(button.dataset.cancelCheck)));
}

function refreshManagement(force=false){
  const transferSignature=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.actualTo||''}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const signature=[managementPage,state.aircraft.length,state.slotRights.length,JSON.stringify(state.personnel.assignments),transferSignature,state.resourceRequests?.map(r=>`${r.id}:${r.status}`).join('|')].join('::');
  if(!force&&signature===lastManagementSignature) return;
  if(activeEmbeddedManagementControl()) return;
  lastManagementSignature=signature;
  refreshAircraftSelect(force); refreshAircraftRequestPreview(); refreshPersonnelRequestPreview(); refreshPersonnelTransferOptions();
  renderManagementAircraft(); renderManagementPersonnel(); renderPersonnelTransfers(); refreshMaintenance(); refreshSchedulePreview();
}
function refreshPersonnel(force=false){ if(force||nextWorkspace==='management'){renderManagementPersonnel();renderPersonnelTransfers();refreshPersonnelTransferOptions();} }
function refreshResourceRequestSummary(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshManagementCycle(force=false){ if(force||nextWorkspace==='management') refreshManagement(force); }
function refreshWeather(force=false){ renderWeatherStrip(force); }

function applyWorkspaceView(){
  refreshPauseControl();
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

function railWidthFallback(totalWidth){
  return clamp(totalWidth*.26,300,440);
}
function readRailWidths(){
  const total=document.getElementById('operationsView')?.getBoundingClientRect().width||window.innerWidth||1400;
  return {
    left:Number(localStorage.getItem(LEFT_SIDEBAR_SPLIT_KEY))||railWidthFallback(total),
    right:Number(localStorage.getItem(RIGHT_SIDEBAR_SPLIT_KEY))||railWidthFallback(total)
  };
}
function clampRailWidths(widths=readRailWidths()){
  const shell=document.getElementById('operationsView');
  const total=shell?.getBoundingClientRect().width||window.innerWidth||1400;
  const min=240;
  const absoluteMax=Math.min(620,Math.max(min,total-420-18-min));
  let left=clamp(widths.left,min,absoluteMax);
  let right=clamp(widths.right,min,absoluteMax);
  const centerMin=window.matchMedia('(max-width:1100px)').matches?360:window.matchMedia('(max-width:1280px)').matches?420:460;
  const availableForRails=total-centerMin-18;
  if(left+right>availableForRails){
    const scale=availableForRails/Math.max(1,left+right);
    left=clamp(left*scale,min,absoluteMax);
    right=clamp(right*scale,min,absoluteMax);
  }
  return {left:Math.round(left),right:Math.round(right)};
}
function applyRailWidths(widths=readRailWidths(),{persist=false}={}){
  if(window.matchMedia('(max-width:900px)').matches) return;
  const normalized=clampRailWidths(widths);
  document.documentElement.style.setProperty('--aoc-left-rail-width',`${normalized.left}px`);
  document.documentElement.style.setProperty('--aoc-right-rail-width',`${normalized.right}px`);
  if(persist){
    localStorage.setItem(LEFT_SIDEBAR_SPLIT_KEY,String(normalized.left));
    localStorage.setItem(RIGHT_SIDEBAR_SPLIT_KEY,String(normalized.right));
  }
  requestAnimationFrame(invalidateMapSize);
}
function initRailSplitters(){
  const shell=document.getElementById('operationsView');
  if(!shell) return;
  applyRailWidths(readRailWidths());
  const bind=(splitterId,side)=>{
    const splitter=document.getElementById(splitterId);
    if(!splitter) return;
    let dragging=false;
    const apply=clientX=>{
      const rect=shell.getBoundingClientRect();
      const current=readRailWidths();
      const next={...current};
      next[side]=side==='left'?clientX-rect.left:rect.right-clientX;
      applyRailWidths(next,{persist:true});
    };
    splitter.addEventListener('pointerdown',event=>{
      dragging=true;
      splitter.classList.add('dragging');
      splitter.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    splitter.addEventListener('pointermove',event=>{if(dragging) apply(event.clientX);});
    const stop=event=>{
      if(!dragging) return;
      dragging=false;
      splitter.classList.remove('dragging');
      try{splitter.releasePointerCapture(event.pointerId);}catch(_){}
    };
    splitter.addEventListener('pointerup',stop);
    splitter.addEventListener('pointercancel',stop);
  };
  bind('left-rail-splitter','left');
  bind('right-rail-splitter','right');
  window.addEventListener('resize',()=>applyRailWidths(readRailWidths()));
}

function refreshAll(){
  const managementVisible=!document.getElementById('managementView')?.hidden;
  processEvents();
  recalculateOperations();
  checkActionableProblemDing();
  refreshHeader();
  refreshAircraftSelect(true);
  renderOperationFilterBar(true);
  refreshCorporateResources(true);
  refreshPersonnelRail(true);
  refreshFleetList(true);
  refreshMaintenanceRail(true);
  refreshDepartmentWidgets(true);
  renderContext(true);
  if(managementVisible) refreshManagement(true);
  updateMapData();
  refreshWeather(true);
  refreshScheduleTimeline(true);
}

populateManagementControls();
refreshAircraftSelect(true);
syncPlannerTurnaroundMinimum({force:true});
refreshScheduleMode();
refreshAircraftRequestPreview();
refreshPersonnelRequestPreview();
refreshPersonnelTransferOptions();
refreshPauseControl();

document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>showWorkspace(button.dataset.workspace)));
document.querySelectorAll('[data-management-page]').forEach(button=>button.addEventListener('click',()=>showManagementPage(button.dataset.managementPage)));
scheduleBtn.addEventListener('click',scheduleFlight);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,departureTimeEl,repeatRuleEl].forEach(element=>{element.addEventListener('change',refreshSchedulePreview);element.addEventListener('input',refreshSchedulePreview);});
destEl.addEventListener('change',()=>{syncPlannerTurnaroundMinimum();refreshSchedulePreview();});
destEl.addEventListener('input',()=>{syncPlannerTurnaroundMinimum();refreshSchedulePreview();});
turnaroundEl.addEventListener('change',()=>{notePlannerTurnaroundEdit();refreshSchedulePreview();});
turnaroundEl.addEventListener('input',()=>{notePlannerTurnaroundEdit();refreshSchedulePreview();});
aircraftEl.addEventListener('change',()=>{const ac=state.aircraft.find(item=>item.id===aircraftEl.value);if(ac)originEl.value=ac.location;syncPlannerTurnaroundMinimum({force:true});refreshScheduleMode();});

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

document.getElementById('speed').addEventListener('change',event=>{rebaseClock(Number(event.target.value));refreshPauseControl();markUiDirty('all');toast(event.target.value==='1'?'Realtime enabled.':'Test acceleration enabled.');});
document.getElementById('pauseTopbarBtn')?.addEventListener('click',()=>{const clock=toggleSimulationPause();refreshPauseControl();markUiDirty('all');toast(simulationIsPaused()?'Simulation paused.':`Simulation resumed at ${clock.speed}×.`);});
document.getElementById('schedulePrevBtn').addEventListener('click',()=>{scheduleWindowOffsetHours-=12;markUiDirty('schedule');});
document.getElementById('scheduleNowBtn').addEventListener('click',centerScheduleOnNow);
document.getElementById('scheduleNextBtn').addEventListener('click',()=>{scheduleWindowOffsetHours+=12;markUiDirty('schedule');});
document.getElementById('scheduleRange').addEventListener('change',event=>{scheduleRangeHours=Number(event.target.value)||24;markUiDirty('schedule');});
function confirmLocalReset(){
  if(window.confirm('Delete this local airline save? Aircraft, flights, schedules, tasks, and slot rights will be removed.')) resetLocalSave();
}
function handleOperationsShortcut(event){
  const deletionKey=event.key==='Delete'||event.key==='Backspace';
  if(event.defaultPrevented||!deletionKey||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey) return;
  if(activeFormControl()) return;
  const flight=selectedFlightId&&state.flights.find(item=>item.id===selectedFlightId);
  if(!flight?.cancelled) return;
  event.preventDefault();
  removeCancelledFlight(flight.id,{skipConfirm:true});
}
document.getElementById('resetBtn')?.addEventListener('click',confirmLocalReset);
document.getElementById('resetTopbarBtn')?.addEventListener('click',confirmLocalReset);
window.addEventListener('pointerdown',armProblemDing,{passive:true});
window.addEventListener('keydown',armProblemDing);
window.addEventListener('keydown',handleOperationsShortcut);
bindRailWidgetToggles();
initWorkspaceSplitter();
initRailSplitters();
refreshRailCollapseState();
refreshWeather(true);
