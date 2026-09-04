/* AeroSim DOM references, rendering, event handlers, and resizable workspace layout. */

const flightPlanningSource=document.getElementById('flightPlanningSource');
const flightPlanningPanel=document.getElementById('flightPlanningPanel');
document.getElementById('flightPlanningWidgetBody').append(flightPlanningPanel);
flightPlanningSource.remove();

const scheduleTypeEl=document.getElementById('scheduleType');
const resourceMenuToggle=document.getElementById('resourceMenuToggle');
const resourceMenu=document.getElementById('resourceMenu');
const resourceMenuRoot=document.getElementById('resourceMenuRoot');
const originEl=document.getElementById('origin');
const destEl=document.getElementById('destination');
const aircraftEl=document.getElementById('aircraft');
const departureTimeEl=document.getElementById('departureTime');
const routeDemandPanel=document.getElementById('routeDemandPanel');
function currentScheduleFares(){
  const from=AIRPORTS[originEl.value],to=AIRPORTS[destEl.value];
  const base=from&&to?Math.round((60+distanceKm(from,to)*.085)/5)*5:140;
  return normalizeFares({economy:base,business:Math.round(base*2.6/5)*5,first:Math.round(base*5/5)*5});
}
const repeatRuleEl=document.getElementById('repeatRule');
const operatingCalendarEl=document.getElementById('operatingCalendar');
const operatingCalendarSummaryEl=document.getElementById('operatingCalendarSummary');
const operatingDayEls=[...document.querySelectorAll('[name="operatingDay"]')];
const operatingMonthEls=[...document.querySelectorAll('[name="operatingMonth"]')];
function selectedOperatingCalendar(){
  return {
    days:operatingDayEls.filter(el=>el.checked).map(el=>Number(el.value)),
    months:operatingMonthEls.filter(el=>el.checked).map(el=>Number(el.value))
  };
}
const turnaroundEl=document.getElementById('turnaround');
const recurringOptionsEl=document.getElementById('recurringOptions');
const scheduleBtn=document.getElementById('scheduleBtn');
const requestSlotsBtn=document.getElementById('requestSlotsBtn');
const slotAirportEl=document.getElementById('slotAirport');
const slotTimeEl=document.getElementById('slotTime');
const requestSlotBtn=document.getElementById('requestSlotBtn');
const aircraftMarketList=document.getElementById('aircraftMarketList');
const networkAirportList=document.getElementById('networkAirportList');
const personnelRoleEl=document.getElementById('personnelRole');
const personnelAirportEl=document.getElementById('personnelAirport');
const personnelRequestPreview=document.getElementById('personnelRequestPreview');
const personnelQualificationWrap=document.getElementById('personnelQualificationWrap');
const personnelQualificationEl=document.getElementById('personnelQualification');
const transferPersonnelRoleEl=document.getElementById('transferPersonnelRole');
const transferPersonnelAmountEl=document.getElementById('transferPersonnelAmount');
const transferPersonnelFromEl=document.getElementById('transferPersonnelFrom');
const transferPersonnelToEl=document.getElementById('transferPersonnelTo');
const transferPersonnelMethodEl=document.getElementById('transferPersonnelMethod');
const transferPersonnelFlightEl=document.getElementById('transferPersonnelFlight');
const transferOwnFlightWrap=document.getElementById('transferOwnFlightWrap');
const personnelTransferPreview=document.getElementById('personnelTransferPreview');
const transferPersonnelBtn=document.getElementById('transferPersonnelBtn');
const incidentExerciseBtn=document.getElementById('incidentExerciseBtn');
const flightDetailsPane=document.getElementById('flightDetailsPane');
const aircraftDetailsPane=document.getElementById('aircraftDetailsPane');
const contextWorkbenchMeta=document.getElementById('contextWorkbenchMeta');
const flightDetailsMeta=contextWorkbenchMeta;
const aircraftDetailsMeta=contextWorkbenchMeta;
let flightDetailsSignature='';
let aircraftDetailsSignature='';
let networkSupportSignature='';
let previousMaintenanceAttentionCount=0;
let previousWeatherAlertCount=0;
let departmentTaskSignature='';
let selectedDepartmentTaskId='';
const DEPARTMENT_UI={
  dispatch:{widget:'dispatch-control',count:'dispatchTaskCount',list:'dispatchTaskList',detail:'dispatchTaskDetail'},
  crew:{widget:'crew-control',count:'crewTaskCount',list:'crewTaskList',detail:'crewTaskDetail'},
  maintenance:{widget:'maintenance-control',count:'maintenanceTaskCount',list:'maintenanceTaskList',detail:'maintenanceTaskDetail'},
  station:{widget:'station-operations',count:'stationTaskCount',list:'stationTaskList',detail:'stationTaskDetail'}
};

function showResourceMenuRoot({focus=false}={}){
  resourceMenu.querySelectorAll('[data-resource-menu-panel]').forEach(panel=>panel.hidden=true);
  resourceMenu.querySelectorAll('[data-resource-page]').forEach(button=>button.setAttribute('aria-expanded','false'));
  if(focus) requestAnimationFrame(()=>resourceMenuRoot.querySelector('[data-resource-page]')?.focus());
}
function showResourceMenuPage(page,{focus=false}={}){
  const target=resourceMenu.querySelector(`[data-resource-menu-panel="${page}"]`);
  if(!target) return;
  resourceMenu.querySelectorAll('[data-resource-menu-panel]').forEach(panel=>panel.hidden=panel!==target);
  resourceMenu.querySelectorAll('[data-resource-page]').forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.resourcePage===page)));
  if(focus) requestAnimationFrame(()=>target.querySelector('select,input,button')?.focus());
}
function positionResourceMenu(){
  const rect=resourceMenuToggle.getBoundingClientRect();
  const rootWidth=window.innerWidth<=880?170:210;
  const submenuWidth=Math.min(580,Math.max(180,window.innerWidth-(window.innerWidth<=880?190:230)));
  const totalWidth=rootWidth+3+submenuWidth;
  resourceMenu.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-totalWidth-8))}px`;
  resourceMenu.style.top=`${rect.bottom+4}px`;
}
function openResourceMenu(page=null){
  positionResourceMenu();
  resourceMenu.hidden=false;
  resourceMenuToggle.setAttribute('aria-expanded','true');
  showResourceMenuRoot();
  if(page) showResourceMenuPage(page,{focus:true});
}
function closeResourceMenu({restoreFocus=false}={}){
  if(resourceMenu.hidden) return;
  resourceMenu.hidden=true;
  resourceMenuToggle.setAttribute('aria-expanded','false');
  showResourceMenuRoot();
  if(restoreFocus) resourceMenuToggle.focus();
}

function saveWorkspaceUi(){ localStorage.setItem(WORKSPACE_UI_KEY,JSON.stringify(workspaceUi)); }
function setWidgetOpen(widget,open,{persist=false}={}){
  const widgetId=widget.dataset.widget,header=widget.querySelector(':scope > .widget-header');
  const body=header&&document.getElementById(header.getAttribute('aria-controls'));
  if(!header||!body) return;
  header.setAttribute('aria-expanded',String(open)); body.hidden=!open;
  if(persist){
    workspaceUi.collapsed[activeWorkspaceView]??={};
    workspaceUi.collapsed[activeWorkspaceView][widgetId]=!open;
    saveWorkspaceUi();
  }
}
function closeFlightPlanningWidget(){
  const widget=document.querySelector('[data-widget="flight-planning"]');
  if(widget) setWidgetOpen(widget,false,{persist:true});
}
function applyWorkspaceView(view,{restoreWidths=true}={}){
  activeWorkspaceView='occ';
  workspaceUi.activeView=activeWorkspaceView;
  for(const [widgetId,config] of Object.entries(WORKSPACE_WIDGETS)){
    const widget=document.querySelector(`[data-widget="${widgetId}"]`);
    if(!widget) continue;
    const visible=config.views.includes(activeWorkspaceView);
    widget.hidden=!visible;
    if(visible){
      const saved=workspaceUi.collapsed[activeWorkspaceView]?.[widgetId];
      setWidgetOpen(widget,saved===undefined?config.defaultOpen:!saved);
    }
  }
  document.querySelectorAll('[data-workspace-views]').forEach(el=>{
    el.hidden=!el.dataset.workspaceViews.split(',').includes(activeWorkspaceView);
  });
  document.querySelectorAll('[data-workspace-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.workspaceMode===activeWorkspaceView)));
  document.getElementById('workspaceContextLabel').textContent='OCC';
  scheduleRangeHours=Number(workspaceUi.scheduleRanges?.occ)||24;
  document.getElementById('scheduleRange').value=String(scheduleRangeHours);
  lastScheduleSignature='';
  document.body.dataset.workspaceView=activeWorkspaceView;
  saveWorkspaceUi();
  if(restoreWidths){ restoreSidebarWidthsForView(); restoreCenterSplitForView(); }
  refreshFleetList();
  refreshFlightDetails(true);
  refreshAircraftDetails(true);
  refreshPersonnel(true);
  refreshOccWidgets(true);
  refreshDepartmentWidgets(true);
  refreshManagementCycle(true);
  refreshMaintenance(true);
  refreshWeather(true);
  requestAnimationFrame(()=>{ map.invalidateSize({animate:false}); refreshScheduleTimeline(true); });
}

document.querySelectorAll('.sidebar-widget > .widget-header').forEach(header=>header.addEventListener('click',()=>{
  const widget=header.closest('.sidebar-widget');
  const open=header.getAttribute('aria-expanded')!=='true';
  setWidgetOpen(widget,open,{persist:true});
}));
document.querySelectorAll('[data-workspace-mode]').forEach(button=>button.addEventListener('click',()=>applyWorkspaceView(button.dataset.workspaceMode)));

resourceMenuToggle.addEventListener('click',()=>resourceMenu.hidden?openResourceMenu():closeResourceMenu({restoreFocus:true}));
resourceMenu.querySelectorAll('[data-resource-page]').forEach(button=>{
  button.addEventListener('mouseenter',()=>showResourceMenuPage(button.dataset.resourcePage));
  button.addEventListener('focus',()=>showResourceMenuPage(button.dataset.resourcePage));
  button.addEventListener('click',()=>showResourceMenuPage(button.dataset.resourcePage,{focus:true}));
});
document.addEventListener('click',event=>{
  if(!resourceMenu.hidden&&!resourceMenu.contains(event.target)&&!resourceMenuToggle.contains(event.target)) closeResourceMenu();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!resourceMenu.hidden){ event.preventDefault(); closeResourceMenu({restoreFocus:true}); }
});
window.addEventListener('resize',()=>{ if(!resourceMenu.hidden) positionResourceMenu(); });

aircraftMarketList.addEventListener('click',e=>{
  const button=e.target.closest('[data-request-aircraft]');
  if(button && aircraftMarketList.contains(button)){
    const card=button.closest('.market-aircraft-card');
    const cabin={
      first:Number(card.querySelector('[data-cabin-first]').value)||0,
      business:Number(card.querySelector('[data-cabin-business]').value)||0,
      economy:Number(card.querySelector('[data-cabin-economy]').textContent)||0
    };
    requestAircraft(button.dataset.requestAircraft,cabin);
  }
});
aircraftMarketList.addEventListener('input',event=>{
  const slider=event.target.closest('[data-cabin-first],[data-cabin-business]');
  if(!slider) return;
  const card=slider.closest('.market-aircraft-card'),capacity=Number(card.dataset.capacity);
  const first=card.querySelector('[data-cabin-first]'),business=card.querySelector('[data-cabin-business]');
  const firstSeats=Math.min(Number(first.value)||0,Math.floor(capacity/3));
  first.value=firstSeats;
  business.max=Math.floor((capacity-firstSeats*3)/2);
  if(Number(business.value)>Number(business.max)) business.value=business.max;
  const economy=capacity-firstSeats*3-(Number(business.value)||0)*2;
  card.querySelector('[data-cabin-first-value]').textContent=firstSeats;
  card.querySelector('[data-cabin-business-value]').textContent=business.value;
  card.querySelector('[data-cabin-economy]').textContent=economy;
});

function refreshPersonnelRequestPreview(){
  const role=personnelRoleEl.value,airport=personnelAirportEl.value,config=PERSONNEL[role];
  const cockpit=['captains','firstOfficers'].includes(role);
  personnelQualificationWrap.hidden=!cockpit;
  const rating=cockpit?` · ${personnelQualificationEl.value} rating`:'';
  const supply=config?resourceAvailability('personnel',role,airport):null;
  personnelRequestPreview.textContent=config?`${staffAt(airport,role)} based at ${airport}${rating} · ${supply.label}`:'';
}
let resourceRequestSignature='';
function refreshResourceRequestSummary(force=false){
  const summary=document.getElementById('resourceRequestSummary');
  const pending=(state.resourceRequests||[]).filter(item=>item.status==='pending').sort((a,b)=>a.readyAt-b.readyAt);
  const signature=pending.map(item=>`${item.id}:${item.readyAt}`).join('|');
  if(!force&&signature===resourceRequestSignature) return;
  resourceRequestSignature=signature;
  summary.hidden=!pending.length;
  summary.innerHTML=pending.length?`<b>${pending.length} awaiting allocation</b>${pending.slice(0,4).map(item=>`<span>${esc(item.kind)} · ${esc(item.payload?.model||item.payload?.role||item.payload?.airport||item.location)} · ${shortClock(item.readyAt)}</span>`).join('')}`:'';
}
function requestPersonnel(amount){
  const role=personnelRoleEl.value,airport=personnelAirportEl.value;
  if(!PERSONNEL[role]||!AIRPORTS[airport]) return;
  const result=requestPersonnelResource(role,airport,amount,personnelQualificationEl.value);
  refreshPersonnel(true); refreshPersonnelRequestPreview();
  if(result?.status==='pending') toast(`${amount} ${PERSONNEL[role].label.toLowerCase()} requested for ${airport}. Arrival expected ${formatTime(result.readyAt)}.`);
  else toast(`${amount} ${PERSONNEL[role].label.toLowerCase()} assigned to ${airport}.`);
}

function populateAirports(){
  const opts=Object.values(AIRPORTS).map(a=>`<option value="${a.iata}">${a.iata} — ${a.name}</option>`).join('');
  originEl.innerHTML=opts; destEl.innerHTML=opts; slotAirportEl.innerHTML=opts; personnelAirportEl.innerHTML=opts;
  transferPersonnelFromEl.innerHTML=opts; transferPersonnelToEl.innerHTML=opts;
  const personnelOpts=Object.entries(PERSONNEL).map(([role,config])=>`<option value="${role}">${config.label}</option>`).join('');
  personnelRoleEl.innerHTML=personnelOpts; transferPersonnelRoleEl.innerHTML=personnelOpts;
  personnelQualificationEl.innerHTML=AIRCRAFT_FAMILIES.map(family=>`<option value="${family}">${family}</option>`).join('');
  originEl.value='FRA'; destEl.value='AMS'; slotAirportEl.value=state.home;
  personnelAirportEl.value=state.home;
  transferPersonnelFromEl.value=state.home;
  transferPersonnelToEl.value=Object.keys(AIRPORTS).find(code=>code!==state.home)||state.home;
  refreshPersonnelRequestPreview();
  refreshPersonnelTransferOptions();
}
function refreshAircraftSelect(force=false){
  const available=availableAircraftForSchedule();
  const previous=aircraftEl.value;
  const sig=available.map(a=>`${a.id}:${a.tail}:${a.model}:${a.location}`).join('|');

  // Replacing <option> nodes while a native select is open causes visible flicker
  // and can discard the user's pending selection. Only rebuild when the actual
  // option set changed, and never while the user is interacting with the control.
  const interacting=document.activeElement===aircraftEl;
  if((force || sig!==aircraftSelectSignature) && !interacting){
    aircraftSelectSignature=sig;
    aircraftEl.innerHTML=available.length
      ? available.map(a=>`<option value="${a.id}">${a.tail} · ${a.model} · at ${a.location}</option>`).join('')
      : '<option value="">No aircraft available</option>';

    if(available.some(a=>a.id===previous)) aircraftEl.value=previous;
    else if(available.length && !aircraftEl.value) aircraftEl.value=available[0].id;
  }

  scheduleBtn.disabled=!available.length;
  refreshSchedulePreview();
}

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring';
  const ferry=scheduleTypeEl.value==='ferry';
  recurringOptionsEl.style.display=recurring?'block':'none';
  originEl.disabled=ferry;
  routeDemandPanel.hidden=ferry;
  if(ferry){
    const ac=state.aircraft.find(item=>item.id===aircraftEl.value);
    if(ac) originEl.value=ac.location;
  }
  scheduleBtn.textContent=recurring?'Create recurring schedule':ferry?'Create ferry flight':'Schedule one-time flight';
  if(!recurring) requestSlotsBtn.style.display='none';
  refreshSchedulePreview();
}

function classLoadMarkup(est,title='Estimated class demand'){
  return `<div class="class-load-preview"><div class="estimate-title">${title}</div>${Object.entries(CABIN_CLASSES).map(([className,config])=>{
    const seats=est.cabin?.[className]??est.classSeats?.[className]??0;
    const pax=est.classPax?.[className]||0;
    return seats?`<div class="row-between"><span>${config.label}</span><b>${pax}/${seats} seats · ${Math.round(pax/seats*100)}%</b></div>`:'';
  }).join('')}</div>`;
}

function demandStrength(value){
  if(value>=.9) return {label:'Strong',className:'strong'};
  if(value>=.78) return {label:'Balanced',className:'balanced'};
  return {label:'Limited',className:'limited'};
}

function demandFactorText(value){
  const percent=Math.round((value-1)*100);
  return `${percent>=0?'+':''}${percent}%`;
}

function routeDemandIntelligenceMarkup(from,to,ac,departure,estimate){
  const date=new Date(departure),cabin=cabinForAircraft(ac);
  const strength=demandStrength(estimate.demand.route);
  const market=estimate.demand.market;
  const day=date.toLocaleDateString('en-GB',{weekday:'short'});
  const month=date.toLocaleDateString('en-GB',{month:'short'});
  const classRows=Object.entries(CABIN_CLASSES).filter(([className])=>cabin[className]>0).map(([className,config])=>{
    const seats=cabin[className],passengers=estimate.classPax[className]||0;
    const load=Math.round((estimate.classLoads[className]||0)*100);
    const baseFare=estimate.baseFare*config.baseFareMultiplier;
    return `<div class="demand-class-row">
      <div class="row-between"><b>${config.label}</b><span>${passengers}/${seats} seats · <b>${load}%</b></span></div>
      <div class="demand-meter"><span style="width:${load}%"></span></div>
      <div class="tiny muted">Daily pool ${estimate.demand.classes[className].market} · remaining ${estimate.demand.classes[className].remaining}</div>
    </div>`;
  }).join('');
  const marketType=market.mix.business>=market.mix.tourism?'business-led':'leisure-led';
  const guidance=marketType==='business-led'
    ? 'Business-led route: weekday morning and late-afternoon flights usually perform best, especially in premium cabins.'
    : 'Leisure-led route: Friday, weekend, and destination peak-season departures usually perform best; economy demand dominates.';
  return `<div class="demand-intelligence-card">
    <div class="demand-intelligence-head"><b>Route demand intelligence</b><span class="demand-level ${strength.className}">${strength.label}</span></div>
    <div class="tiny muted">${from} → ${to} · ${marketType} · ${num(market.km)} km</div>
    <div class="demand-market-summary">
      <div><span>Total market/day</span><b>${num(market.totalDaily)}</b></div>
      <div><span>Your reachable pool</span><b>${num(market.capturedDaily)}</b></div>
      <div><span>Market access</span><b>${Math.round(market.capture*100)}%</b></div>
    </div>
    <div class="demand-factor-grid">
      <div class="demand-factor"><span>Day</span><b>${day} ${demandFactorText(estimate.demand.weekday)}</b></div>
      <div class="demand-factor"><span>Time</span><b>${hhmm(departure)} ${demandFactorText(estimate.demand.time)}</b></div>
      <div class="demand-factor"><span>Season</span><b>${month} ${demandFactorText(estimate.demand.season)}</b></div>
    </div>
    <div class="demand-class-list">${classRows}</div>
    <div class="demand-guidance"><b>Planning guide:</b> ${guidance} Additional flights consume the remaining daily class pools.</div>
    <div class="tiny muted">Synthetic offline market forecast. Market access represents competition and your home/hub presence; no live booking data is used.</div>
  </div>`;
}

function refreshSchedulePreview(){
  operatingCalendarEl.hidden=scheduleTypeEl.value!=='recurring'||repeatRuleEl.value!=='custom';
  const ferry=scheduleTypeEl.value==='ferry';
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  if(!ac){
    requestSlotsBtn.style.display='none';
    routeDemandPanel.innerHTML='<div class="demand-empty">Select an aircraft to inspect route demand.</div>';
    document.getElementById('schedulePreview').textContent='No aircraft available.';
    return;
  }
  if(ferry) originEl.value=ac.location;
  const from=originEl.value,to=destEl.value,fares=currentScheduleFares();
  if(from===to){
    routeDemandPanel.innerHTML=ferry?'':'<div class="demand-empty">Choose two different airports to compare demand.</div>';
    document.getElementById('schedulePreview').textContent=ferry?'Choose a destination different from the aircraft’s current airport.':'Choose two different airports.';
    scheduleBtn.disabled=ferry;
    return;
  }
  const calendar=selectedOperatingCalendar();
  const rawFirstDeparture=nextTimestampForClock(departureTimeEl.value);
  const usesCustomCalendar=scheduleTypeEl.value==='recurring'&&repeatRuleEl.value==='custom';
  const firstDeparture=rawFirstDeparture&&(!usesCustomCalendar||(calendar.days.length&&calendar.months.length))
    ? alignToOperatingCalendar(rawFirstDeparture,usesCustomCalendar?'custom':repeatRuleEl.value,calendar.days,calendar.months)
    : null;
  operatingCalendarSummaryEl.textContent=!calendar.days.length||!calendar.months.length
    ? 'Select at least one weekday and one month.'
    : `First matching departure: ${firstDeparture?formatTime(firstDeparture):'none found'}`;
  if(ferry){
    routeDemandPanel.innerHTML='';
    requestSlotsBtn.style.display='none';
    const estimate=estimateFerryFlight(from,to,ac,firstDeparture||simNow());
    const itinerary=firstDeparture
      ? validateAircraftItinerary(ac,[{from,to,departure:firstDeparture,arrival:firstDeparture+estimate.duration,label:'ferry flight'}])
      : {ok:false,reason:'choose a valid departure time'};
    const shortages=firstDeparture?staffingShortagesForFlight(ac,firstDeparture,estimate.duration,from,null,true,'ferry'):[];
    const ready=estimate.rangeOk&&itinerary.ok&&!shortages.length;
    scheduleBtn.disabled=!ready;
    document.getElementById('schedulePreview').innerHTML=`<b>Non-revenue positioning</b> · ${num(estimate.km)} km · ${formatDuration(estimate.duration)}`+
      `${firstDeparture?` · departs ${formatTime(firstDeparture)}`:''}<br><span class="metric ${ready?'good':'bad'}">${!estimate.rangeOk?'out of range':!itinerary.ok?itinerary.reason:shortages.length?shortages.join(' · '):'aircraft and ferry crew available'}</span>`;
    return;
  }
  scheduleBtn.disabled=false;
  const out=estimateFlight(from,to,ac,fares,{departure:firstDeparture||simNow(),availableFuelGallons:ac.fuelGallons||0});
  routeDemandPanel.innerHTML=routeDemandIntelligenceMarkup(from,to,ac,firstDeparture||simNow(),out);
  const rangeWarning=out.rangeOk?'':' · <span class="metric bad">OUT OF RANGE</span>';
  const firstText=firstDeparture?` · first dep <b>${formatTime(firstDeparture)}</b>`:'';

  if(scheduleTypeEl.value==='once'){
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure:firstDeparture,arrival:firstDeparture+out.duration,label:'new flight'}]);
    requestSlotsBtn.style.display='none';
    document.getElementById('schedulePreview').innerHTML =
      `${num(out.km)} km · ${formatDuration(out.duration)} · load <b>${Math.round(out.load*100)}%</b>`+
      `${firstText}${rangeWarning}`+
      ` · <span class="metric ${itinerary.ok?'good':'bad'}">${itinerary.ok?'fits aircraft itinerary':itinerary.reason}</span>`+
      classLoadMarkup({...out,cabin:cabinForAircraft(ac)});
    return;
  }

  const turnaroundMin=Number(turnaroundEl.value)||90;
  const plan=firstDeparture?requiredSlotPlan(from,to,ac,fares,firstDeparture,turnaroundMin):null;
  const back=estimateFlight(to,from,ac,fares,{departure:plan?.returnDeparture||firstDeparture||simNow(),availableFuelGallons:out.fuelRemaining});
  const cycle=plan?(plan.returnDeparture-plan.outboundDeparture)+back.duration:out.duration+turnaroundMin*MIN+back.duration;
  const minInterval=minimumRepeatInterval(repeatRuleEl.value);
  const fits=cycle<=minInterval;
  const itinerary=plan?validateAircraftItinerary(ac,[
    {from,to,departure:plan.outboundDeparture,arrival:plan.outboundDeparture+out.duration,label:'new outbound'},
    {from:to,to:from,departure:plan.returnDeparture,arrival:plan.returnDeparture+back.duration,label:'new return'}
  ]):{ok:false,reason:'choose a valid operating calendar'};
  const roundClassEstimate={
    classSeats:Object.fromEntries(Object.entries(cabinForAircraft(ac)).map(([className,seats])=>[className,seats*2])),fares,
    classPax:Object.fromEntries(Object.keys(CABIN_CLASSES).map(className=>[className,(out.classPax[className]||0)+(back.classPax[className]||0)]))
  };

  let slotHtml='';
  if(plan){
    const missingCount=(plan.originRight?0:1)+(plan.destinationRight?0:1);
    slotHtml=`<div style="margin-top:7px">
      <span class="slot-chip ${plan.originRight?'assigned':'missing'}">${from} ${hhmm(plan.outboundDeparture)} ${plan.originRight?'ASSIGNED':'NEEDED'}</span>
      <span class="slot-chip ${plan.destinationRight?'assigned':'missing'}">${to} ${hhmm(plan.returnDeparture)} ${plan.destinationRight?'ASSIGNED':'NEEDED'}</span>
    </div>`;
    requestSlotsBtn.style.display=missingCount?'block':'none';
    requestSlotsBtn.disabled=false;
    requestSlotsBtn.textContent=`Request ${missingCount} missing slot ${missingCount===1?'series':'series'}`;
  }else{
    requestSlotsBtn.style.display='none';
  }

  document.getElementById('schedulePreview').innerHTML =
    `${num(out.km)} km each way · round trip <b>${formatDuration(cycle)}</b> · first dep <b>${plan?formatTime(plan.outboundDeparture):'—'}</b> · `+
    `<span class="metric ${fits&&itinerary.ok?'good':'bad'}">${!fits?'aircraft cannot complete cycle before next departure':itinerary.ok?'schedule fits aircraft itinerary':itinerary.reason}</span>${rangeWarning}`+
    classLoadMarkup(roundClassEstimate,'Estimated round-trip class demand')+slotHtml;
}

function refreshSlotBuyPreview(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base){
    document.getElementById('slotBuyPreview').textContent='Choose a valid time.';
    requestSlotBtn.disabled=true; return;
  }
  const aligned=alignTimestampToAirportSlot(base,airport);
  const existing=slotRightAt(airport,aligned);
  const interval=AIRPORT_OPS[airport]?.slotIntervalMin||15;
  const supply=resourceAvailability('slot',String(new Date(aligned).getHours()),airport);
  document.getElementById('slotBuyPreview').innerHTML=existing
    ? `<span class="slot-chip assigned">${airport} ${hhmm(aligned)} ASSIGNED</span><div style="margin-top:4px">${interval}-minute airport slot cadence.</div>`
    : `<b>${airport} ${hhmm(aligned)}</b> recurring departure series · ${interval}-minute cadence<div class="tiny muted" style="margin-top:4px">${esc(supply.label)}</div>`;
  requestSlotBtn.disabled=Boolean(existing);
  requestSlotBtn.textContent=existing?'Slot already assigned':'Request slot series';
}

function selectedContextAirports(){
  const flight=selectedFlightId?state.flights.find(item=>item.id===selectedFlightId):null;
  if(flight) return new Set([flight.from,flightOperationalDestination(flight)]);
  const ac=selectedAircraftId?state.aircraft.find(item=>item.id===selectedAircraftId):null;
  if(!ac) return new Set();
  const airports=new Set([ac.location]);
  const relevant=state.flights
    .filter(item=>item.aircraftId===ac.id&&!item.cancelled&&!item.settled)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  if(relevant){ airports.add(relevant.from); airports.add(flightOperationalDestination(relevant)); }
  return airports;
}

function refreshNetworkSupport(force=false){
  if(!networkAirportList) return;
  const now=simNow();
  const contextAirports=selectedContextAirports();
  const airportCodes=new Set([state.home,...contextAirports,...Object.keys(state.personnel.assignments||{})]);
  for(const right of state.slotRights||[]) airportCodes.add(right.airport);
  for(const ac of state.aircraft||[]) airportCodes.add(ac.location);
  for(const request of (state.resourceRequests||[]).filter(item=>item.status==='pending')){
    const airport=request.location||request.payload?.airport||request.payload?.location;
    if(airport) airportCodes.add(airport);
  }
  for(const flight of state.flights||[]){
    if(!flight.cancelled&&!flight.settled&&flightActualDeparture(flight)<now+24*HOUR){
      airportCodes.add(flight.from); airportCodes.add(flightOperationalDestination(flight));
    }
  }
  const airports=[...airportCodes].filter(code=>AIRPORTS[code]).map(code=>{
    const personnel=Object.entries(PERSONNEL).map(([role,config])=>({role,label:config.label,count:staffAt(code,role)})).filter(item=>item.count);
    const slots=(state.slotRights||[]).filter(right=>right.airport===code).sort((a,b)=>a.minuteOfDay-b.minuteOfDay);
    const aircraft=(state.aircraft||[]).filter(ac=>ac.location===code).map(ac=>({ac,status:Management.maintenanceStatus(ac,now)}));
    const pending=(state.resourceRequests||[]).filter(request=>request.status==='pending'&&(request.location===code||request.payload?.airport===code||request.payload?.location===code));
    const transfers=(state.personnelTransfers||[]).filter(item=>item.status==='scheduled'&&(item.from===code||item.to===code));
    const problems=aircraft.filter(item=>item.status.due||item.status.grounding||(item.ac.melItems||[]).some(mel=>['open','expired'].includes(mel.status))).length+
      state.flights.filter(f=>!f.cancelled&&!f.settled&&f.from===code&&f.staffingBlocked).length;
    return {code,personnel,slots,aircraft,pending,transfers,problems};
  }).sort((a,b)=>(contextAirports.has(a.code)?0:1)-(contextAirports.has(b.code)?0:1)||b.problems-a.problems||a.code.localeCompare(b.code));
  const signature=JSON.stringify({
    context:[...contextAirports],airports:airports.map(item=>({
      code:item.code,personnel:item.personnel.map(role=>[role.role,role.count]),
      slots:item.slots.map(right=>[right.id,right.minuteOfDay,slotAssignedService(right.id)?.id||'']),
      aircraft:item.aircraft.map(({ac,status})=>[ac.id,ac.location,status.label,status.scheduled?.start||0,(ac.melItems||[]).map(mel=>[mel.id,mel.status,mel.remainingCycles])]),
      pending:item.pending.map(request=>[request.id,request.kind,request.readyAt]),
      transfers:item.transfers.map(transfer=>[transfer.id,transfer.status,transfer.arrival])
    }))
  });
  if(!force&&signature===networkSupportSignature) return;
  if(networkAirportList.contains(document.activeElement)) return;
  networkSupportSignature=signature;
  document.getElementById('networkSupportMeta').textContent=contextAirports.size?`${[...contextAirports].join(' · ')} first`:`${airports.length} airports`;
  networkAirportList.innerHTML=airports.length?airports.map(item=>`<article class="network-airport-row ${contextAirports.has(item.code)?'context':''} ${item.problems?'has-problem':''}">
    <div class="network-airport-heading">
      <div><b>${esc(item.code)}</b><span>${esc(AIRPORTS[item.code].name)}</span></div>
      ${item.problems?`<span class="problem-reason-badge critical">${item.problems} issue${item.problems===1?'':'s'}</span>`:''}
    </div>
    <div class="network-resource-line">
      <span class="network-resource-label">Personnel</span>
      <div class="network-resource-values">${item.personnel.length?item.personnel.map(role=>`<span>${esc(role.label)} <b>${role.count}</b></span>`).join(''):'<em>None assigned</em>'}</div>
    </div>
    <div class="network-resource-line">
      <span class="network-resource-label">Slot series</span>
      <div class="network-resource-values">${item.slots.length?item.slots.map(right=>{
        const service=slotAssignedService(right.id);
        return `<span class="network-slot-value"><b>${hhmmFromMinute(right.minuteOfDay)}</b> ${service?esc(service.id):'free'}${!service&&right.source!=='grandfathered'?` <button type="button" data-release-network-slot="${esc(right.id)}" aria-label="Release ${esc(item.code)} ${hhmmFromMinute(right.minuteOfDay)} slot">×</button>`:''}</span>`;
      }).join(''):'<em>None assigned</em>'}</div>
    </div>
    <div class="network-resource-line">
      <span class="network-resource-label">Aircraft</span>
      <div class="network-resource-values network-aircraft-values">${item.aircraft.length?item.aircraft.map(({ac,status})=>`<span class="network-aircraft-value">
        <button type="button" data-network-aircraft="${esc(ac.id)}">${esc(ac.tail)}</button>
        <small class="${status.grounding?'bad':status.due?'warn':''}">${esc(status.label)}</small>
        ${status.scheduled?.status==='scheduled'?`<button class="network-inline-action" type="button" data-cancel-maintenance="${esc(ac.id)}">Cancel check</button>`:status.due||status.grounding?`<button class="network-inline-action" type="button" data-schedule-maintenance="${esc(ac.id)}">Schedule check</button>`:''}
      </span>`).join(''):'<em>No aircraft on ground</em>'}</div>
    </div>
    ${item.pending.length?`<div class="network-resource-line"><span class="network-resource-label">Pending</span><div class="network-resource-values">${item.pending.map(request=>`<span>${esc(request.kind)} · due ${shortClock(request.readyAt)}</span>`).join('')}</div></div>`:''}
    ${item.transfers.length?`<div class="network-resource-line"><span class="network-resource-label">Transfers</span><div class="network-resource-values">${item.transfers.map(transfer=>`<span>${transfer.amount} ${esc(PERSONNEL[transfer.role]?.label||transfer.role)} · ${esc(transfer.from)} → ${esc(transfer.to)}</span>`).join('')}</div></div>`:''}
  </article>`).join(''):'<div class="empty">No airport resources assigned.</div>';

  networkAirportList.querySelectorAll('[data-release-network-slot]').forEach(button=>button.addEventListener('click',()=>{
    const right=slotRightById(button.dataset.releaseNetworkSlot);
    if(!right||slotAssignedService(right.id)) return;
    state.slotRights=state.slotRights.filter(item=>item.id!==right.id);
    save(); refreshAll(); refreshSlotBuyPreview();
    toast(`${right.airport} ${hhmmFromMinute(right.minuteOfDay)} slot series released.`);
  }));
  networkAirportList.querySelectorAll('[data-network-aircraft]').forEach(button=>button.addEventListener('click',()=>settleSelected(button.dataset.networkAircraft)));
  networkAirportList.querySelectorAll('[data-schedule-maintenance]').forEach(button=>button.addEventListener('click',()=>scheduleAircraftMaintenance(button.dataset.scheduleMaintenance)));
  networkAirportList.querySelectorAll('[data-cancel-maintenance]').forEach(button=>button.addEventListener('click',()=>cancelAircraftMaintenance(button.dataset.cancelMaintenance)));
}

function refreshSlotPortfolio(force=false){
  refreshNetworkSupport(force);
}

let personnelSignature='';
function eligiblePersonnelFlights(from,to,amount){
  const now=simNow();
  return state.flights.filter(f=>{
    if(f.cancelled||f.settled||f.from!==from||f.to!==to||flightActualDeparture(f)<=now) return false;
    const ac=state.aircraft.find(a=>a.id===f.aircraftId);
    const spare=(ac?cabinSeatCount(ac):f.pax||0)-(f.pax||0)-flightPersonnelTransferCount(f.id);
    return spare>=amount;
  }).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
}

function refreshPersonnelTransferOptions(){
  const role=transferPersonnelRoleEl.value,from=transferPersonnelFromEl.value,to=transferPersonnelToEl.value;
  const amount=clamp(Math.floor(Number(transferPersonnelAmountEl.value)||1),1,50);
  transferPersonnelAmountEl.value=amount;
  const available=staffAt(from,role);
  const sameAirport=from===to;
  const external=transferPersonnelMethodEl.value==='external';
  transferOwnFlightWrap.hidden=external;
  if(!external){
    const previous=transferPersonnelFlightEl.value;
    const flights=sameAirport?[]:eligiblePersonnelFlights(from,to,amount);
    transferPersonnelFlightEl.innerHTML=flights.length?flights.map(f=>{
      const ac=state.aircraft.find(a=>a.id===f.aircraftId);
      const spare=(ac?cabinSeatCount(ac):f.pax||0)-(f.pax||0)-flightPersonnelTransferCount(f.id);
      return `<option value="${f.id}">${f.id} · ${formatTime(flightActualDeparture(f))} · ${spare} spare seats</option>`;
    }).join(''):'<option value="">No suitable own flight</option>';
    if(flights.some(f=>f.id===previous)) transferPersonnelFlightEl.value=previous;
    const selected=state.flights.find(f=>f.id===transferPersonnelFlightEl.value);
    personnelTransferPreview.textContent=sameAirport?'Choose two different airports.':!available?`No ${PERSONNEL[role]?.label.toLowerCase()||'personnel'} available at ${from}.`:selected?`${amount} employees travel non-revenue on ${selected.id}; available at ${to} after ${formatTime(flightActualArrival(selected))}.`:'No future own flight has enough unused seats on this route.';
    transferPersonnelBtn.disabled=sameAirport||available<amount||!selected;
  }else{
    const plan=sameAirport?null:externalTransferPlan(from,to,amount);
    personnelTransferPreview.textContent=sameAirport?'Choose two different airports.':!available?`No ${PERSONNEL[role]?.label.toLowerCase()||'personnel'} available at ${from}.`:`New external positioning booking · estimated arrival ${formatTime(plan.arrival)}.`;
    transferPersonnelBtn.disabled=sameAirport||available<amount||!plan;
  }
}

function createPersonnelTransfer(){
  const role=transferPersonnelRoleEl.value,from=transferPersonnelFromEl.value,to=transferPersonnelToEl.value;
  const amount=clamp(Math.floor(Number(transferPersonnelAmountEl.value)||1),1,50);
  const method=transferPersonnelMethodEl.value;
  const qualifications=qualificationTransferMix(from,role,amount);
  if(!PERSONNEL[role]||from===to||staffAt(from,role)<amount) return toast('Choose an available personnel group and two different airports.');
  if(qualifications===null) return toast('The selected cockpit personnel do not have enough transferable type ratings.');
  const id='PT'+state.nextPersonnelTransfer++;
  let transfer;
  if(method==='own'){
    const flight=eligiblePersonnelFlights(from,to,amount).find(f=>f.id===transferPersonnelFlightEl.value);
    if(!flight) return toast('That own flight no longer has enough spare seats.');
    transfer={id,role,amount,from,to,method,qualifications,flightId:flight.id,departure:flightActualDeparture(flight),arrival:flightActualArrival(flight),cost:0,status:'scheduled',createdAt:simNow()};
  }else{
    const plan=externalTransferPlan(from,to,amount);
    transfer={id,role,amount,from,to,method,qualifications,departure:plan.departure,arrival:plan.arrival,cost:0,status:'scheduled',createdAt:simNow()};
  }
  changeStaff(from,role,-amount);
  for(const [family,count] of Object.entries(qualifications||{})) changeQualification(from,role,family,-count);
  state.personnelTransfers.push(transfer);
  if(state.personnelTransfers.length>200){
    const removable=state.personnelTransfers.findIndex(item=>item.status!=='scheduled');
    if(removable>=0) state.personnelTransfers.splice(removable,1);
  }
  logEvent(`${id}: ${amount} ${PERSONNEL[role].label.toLowerCase()} relocating ${from} → ${to} ${method==='own'?`on ${transfer.flightId}`:'on another airline'}.`);
  save(); refreshAll(); toast(`${id} booked. Personnel are now in transit.`);
}

function renderPersonnelTransfers(){
  const list=document.getElementById('personnelTransferList');
  const transfers=[...(state.personnelTransfers||[])].sort((a,b)=>(a.status==='scheduled'?0:1)-(b.status==='scheduled'?0:1)||b.createdAt-a.createdAt).slice(0,20);
  const active=transfers.filter(transfer=>transfer.status==='scheduled').length;
  document.getElementById('personnelTransferCount').textContent=`${active} active`;
  list.innerHTML=transfers.length?`<div class="estimate-title" style="margin-top:10px">Transfers</div>${transfers.map(transfer=>{
    const inTransit=transfer.status==='scheduled'&&simNow()>=transfer.departure;
    const status=transfer.status==='scheduled'?(inTransit?'in transit':'booked'):transfer.status;
    const remaining=Math.max(0,Math.ceil(((transfer.arrival||simNow())-simNow())/MIN));
    const arrivalAirport=transfer.actualTo||transfer.to;
    return `<div class="personnel-transfer-row ${transfer.status}">
      <div class="row-between"><b>${transfer.from} → ${arrivalAirport}</b><span class="tag">${status}</span></div>
      <div class="tiny muted">${transfer.amount} ${PERSONNEL[transfer.role]?.label||transfer.role} · ${transfer.method==='own'?`${transfer.flightId} · non-revenue`:'external positioning service'}</div>
      <div class="tiny muted">${transfer.status==='cancelled'?'Returned to origin roster':transfer.status==='completed'?`Arrived ${formatTime(transfer.completedAt||transfer.arrival)}`:`${arrivalAirport!==transfer.to?`Diverted from ${transfer.to} · `:''}ETA ${formatTime(transfer.arrival)} · ${remaining} min`}</div>
    </div>`;
  }).join('')}`:'';
}

function refreshPersonnel(force=false){
  const transferSig=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const rosterSig=Object.entries(state.personnel.assignments||{}).map(([airport,roles])=>`${airport}:${JSON.stringify(roles)}:${JSON.stringify(state.personnel.qualifications?.[airport]||{})}`).join('|');
  const signature=`${activeWorkspaceView}:${transferSig}:${rosterSig}`;
  if(force||signature!==personnelSignature){
    personnelSignature=signature;
    renderPersonnelTransfers();
    refreshPersonnelTransferOptions();
  }
  refreshNetworkSupport(force);
}

function refreshManagementCycle(force=false){
  const cycle=Management.cyclePhase(state,simNow());
  const scenario=currentScenarioScore();
  const reviews=state.management.reviews||[];
  const signature=`${cycle.phase}:${Math.floor(cycle.progress*100)}:${reviews.length}:${scenario.score}:${scenario.objectives.map(item=>item.met).join('')}`;
  if(!force&&signature===managementSignature) return;
  managementSignature=signature;
  document.getElementById('managementCyclePhase').textContent=cycle.phase==='plan'?'Plan':cycle.phase==='operate'?'Operate':'Review';
  const latest=reviews[reviews.length-1];
  document.getElementById('managementCycleContent').innerHTML=`
    <div class="row-between"><b>${cycle.label}</b><span class="tiny muted">Ends ${formatTime(cycle.end)}</span></div>
    <div class="cycle-progress"><span style="width:${Math.round(cycle.progress*100)}%"></span></div>
    <div class="tiny muted">${cycle.guidance}</div>
    <div class="cycle-stage-row"><div class="cycle-stage ${cycle.phase==='plan'?'active':''}">Plan</div><div class="cycle-stage ${cycle.phase==='operate'?'active':''}">Operate</div><div class="cycle-stage ${cycle.phase==='review'?'active':''}">Review</div></div>
    <div class="scenario-objectives"><div class="row-between"><b>Current scenario objectives</b><strong>${scenario.score}/100</strong></div>${scenario.objectives.map(item=>`<div class="objective-row ${item.met?'met':'missed'}"><span>${item.met?'✓':'!'} ${esc(item.label)}</span><b>${esc(item.value)}</b></div>`).join('')}</div>
    ${latest?`<div class="review-card" style="margin-top:8px"><div class="tiny muted">LAST COMPLETED WEEK · ${latest.id}</div><div class="row-between"><span>On-time</span><b>${Math.round(latest.kpis.onTimePerformance*100)}%</b></div><div class="row-between"><span>Completion</span><b>${Math.round(latest.kpis.completionFactor*100)}%</b></div><div class="row-between"><span>Average delay</span><b>${Math.round(latest.kpis.averageDelayMin)} min</b></div></div>`:''}`;
}

function refreshWeather(force=false){
  const now=simNow();
  const relevant=selectedContextAirports();
  if(!relevant.size){
    relevant.add(state.home);
    for(const f of state.flights){
      if(!f.cancelled&&!f.settled&&flightActualDeparture(f)<now+24*HOUR){ relevant.add(f.from); relevant.add(flightOperationalDestination(f)); }
    }
  }
  const weather=[...relevant].map(code=>Management.weatherAt(code,now)).sort((a,b)=>({severe:0,caution:1,normal:2}[a.level]-({severe:0,caution:1,normal:2}[b.level]))||a.airport.localeCompare(b.airport));
  const signature=`${[...relevant].join(',')}::`+weather.map(item=>`${item.airport}:${item.level}:${item.validFrom}`).join('|');
  if(!force&&signature===weatherSignature) return;
  weatherSignature=signature;
  const alerts=weather.filter(item=>item.level!=='normal').length;
  document.getElementById('weatherAlertCount').textContent=alerts?`${alerts} alert${alerts===1?'':'s'}`:'Normal';
  if(alerts>previousWeatherAlertCount){
    const widget=document.querySelector('[data-widget="weather"]');
    if(widget) setWidgetOpen(widget,true,{persist:false});
  }
  previousWeatherAlertCount=alerts;
  document.getElementById('weatherList').innerHTML=weather.map(item=>`<div class="weather-row ${item.level}">
    <div class="row-between"><span class="weather-code">${item.airport}</span><span class="readiness-state ${item.level==='normal'?'ready':item.level==='caution'?'warn':'block'}">${item.label}</span></div>
    <div class="weather-meta">${item.conditions} · wind ${item.windKph} km/h${item.delayMin?` · expected impact +${item.delayMin}m`:''}</div>
    <div class="weather-meta">Airport capacity ${Math.round(item.capacityFactor*100)}% · valid to ${hhmm(item.validUntil)}</div>
  </div>`).join('');
}

function refreshMaintenance(force=false){
  const now=simNow();
  const rows=state.aircraft.map(ac=>({ac,status:Management.maintenanceStatus(ac,now)}));
  rows.sort((a,b)=>Number(b.ac.id===selectedAircraftId)-Number(a.ac.id===selectedAircraftId)||Number(b.status.grounding||b.status.due)-Number(a.status.grounding||a.status.due)||a.ac.tail.localeCompare(b.ac.tail));
  const signature=`${selectedAircraftId||''}::`+rows.map(({ac,status})=>`${ac.id}:${Math.round(status.progress*100)}:${status.label}:${status.scheduled?.start||0}:${(ac.melItems||[]).map(item=>`${item.id}:${item.status}:${item.remainingCycles}`).join(',')}`).join('|');
  if(!force&&signature===maintenanceSignature){ refreshNetworkSupport(false); return; }
  maintenanceSignature=signature;
  const due=rows.filter(row=>row.status.due||row.status.active||(row.ac.melItems||[]).some(item=>['open','expired'].includes(item.status))).length;
  if(due>previousMaintenanceAttentionCount){
    const widget=document.querySelector('[data-widget="network-support"]');
    if(widget) setWidgetOpen(widget,true,{persist:false});
  }
  previousMaintenanceAttentionCount=due;
  refreshNetworkSupport(force);
}

function incidentDeadlineText(incident,now){
  const remaining=incident.deadline-now;
  if(remaining<=0) return 'Decision due now';
  const minutes=Math.max(1,Math.ceil(remaining/MIN));
  return `${minutes} min to decide`;
}

function aircraftIssueKey(ac,now=simNow()){
  const maintenance=Management.maintenanceStatus(ac,now);
  return [
    aircraftIsDefective(ac,now),ac.defectUntil||0,ac.defectReason||'',
    maintenance.grounding,maintenance.label,maintenance.scheduled?.start||0
  ].join(':');
}

function flightHasOpenProblem(flight,readiness){
  return readiness.overall!=='ready'||flightTotalDepartureDelayMin(flight)>0||openIncidentsForFlight(flight.id).length>0||flight.connectionAtRiskPax>0||flight.connectionMissedPax>0;
}
function readinessIssueLabel(gate){
  const detail=String(gate?.detail||'');
  if(!gate||gate.status==='ready') return '';
  if(gate.key==='aircraft') return detail.replace('Aircraft currently at ','Aircraft at ')||'Aircraft unavailable';
  if(gate.key==='crew') return detail?`Crew shortage · ${detail}`:'Crew unavailable';
  if(gate.key==='fuel') return 'Fuel top-up pending';
  if(gate.key==='slot') return 'Departure slot missed';
  if(gate.key==='weather') return `Weather · ${detail.split(' · ')[0]||'departure restriction'}`;
  if(gate.key==='rotation') return detail||'Inbound aircraft delayed';
  if(gate.key==='incident') return '';
  if(gate.key==='dispatch') return `Dispatch hold · ${detail.split(' · ')[0]||'release blocked'}`;
  return detail||gate.label;
}
function flightProblemLabels(flight,readiness){
  const labels=openIncidentsForFlight(flight.id).map(incident=>INCIDENT_DEFINITIONS[incident.type]?.title||incident.type);
  if(flight.staffingBlocked||flight.staffingDelayMin) labels.push('Crew or ground staff unavailable');
  if(flight.technicalDelayMin) labels.push(`Technical delay · +${flight.technicalDelayMin} min`);
  if(flight.weatherDelayMin||flight.weatherCode) labels.push(`Weather delay${flight.weatherCode?` · ${flight.weatherCode}`:''}`);
  if(flight.airportDelayMin) labels.push(flight.airportConstraintLabel||'Airport flow');
  if(flight.airspaceDelayMin) labels.push(flight.airspaceConstraintLabel||'Airspace');
  if(flight.connectionMissedPax) labels.push(`${flight.connectionMissedPax} missed connections`);
  else if(flight.connectionAtRiskPax) labels.push(`${flight.connectionAtRiskPax} connections at risk`);
  if(flight.maintenanceBlocked||flight.maintenanceDelayMin) labels.push('Maintenance prevents departure');
  if(flight.positioningBlocked||flight.positioningDelayMin) labels.push('Aircraft not at departure airport');
  if(flight.slotMissed||flight.slotDelayMin) labels.push('Original departure slot missed');
  if(flight.handlingDelayMin) labels.push(`${flight.handlingDelayCause||'Ground task delay'} · +${flight.handlingDelayMin} min`);
  const delay=flightTotalDepartureDelayMin(flight);
  if(delay) labels.push(`Delay +${delay}m`);
  for(const gate of readiness?.gates||[]){
    const label=readinessIssueLabel(gate);
    if(label) labels.push(label);
  }
  return [...new Set(labels)].slice(0,3);
}
function problemBadgesMarkup(labels){
  const criticalPattern=/incident|sick|technical|defect|expired|grounded|closure|cancel|missed connection/i;
  return labels.length?`<span class="problem-reasons">${labels.map(label=>`<span class="problem-reason-badge ${criticalPattern.test(label)?'critical':'warning'}" title="Operational issue: ${esc(label)}">${esc(label)}</span>`).join('')}</span>`:'';
}

function operationalCaseSignature(incidents){
  return incidents.map(incident=>{
    const tasks=incidentTasks(incident.id)
      .map(task=>`${task.id}:${task.status}:${task.startedAt||0}:${task.completesAt||0}:${task.completedAt||0}:${task.outcome||''}`)
      .join('~');
    return `${incident.id}:${incident.status}:${incident.deadline}:${incident.overdue?1:0}:${tasks}`;
  }).join(',');
}

function refreshOccWidgets(force=false){
  if(!['occ','all'].includes(activeWorkspaceView)&&!force) return;
  const now=simNow(),horizon=now+24*HOUR;
  const openIncidentFlightIds=new Set(state.incidents.filter(incident=>incident.status==='open').map(incident=>incident.flightId));
  const queueFlights=state.flights
    .filter(f=>!f.cancelled&&!f.settled&&flightActualArrival(f)>now&&flightActualDeparture(f)<horizon)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const activeFlights=queueFlights.filter(f=>statusOfFlight(f,now)==='airborne');
  const upcomingFlights=queueFlights.filter(f=>statusOfFlight(f,now)!=='airborne');
  const attentionFlights=state.flights
    .filter(f=>!f.cancelled&&!f.settled&&flightActualArrival(f)>now&&(flightActualDeparture(f)<horizon||openIncidentFlightIds.has(f.id)))
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const aircraftIssues=state.aircraft
    .filter(ac=>aircraftIsDefective(ac,now)||Management.maintenanceStatus(ac,now).grounding)
    .filter(ac=>ac.issueAcknowledgedKey!==aircraftIssueKey(ac,now));
  const assessed=attentionFlights.map(f=>{
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const readiness=ac?readinessForFlight(f,ac,now):{overall:'block',gates:[]};
    return {f,readiness,acknowledged:f.issueAcknowledgedKey===flightIssueKey(f)};
  });
  const issueFlights=assessed
    .filter(item=>openIncidentsForFlight(item.f.id).length||item.readiness.overall!=='ready'||flightTotalDepartureDelayMin(item.f)>0||item.f.connectionAtRiskPax>0||item.f.connectionMissedPax>0)
    .filter(item=>openIncidentsForFlight(item.f.id).length||!item.acknowledged)
    .sort((a,b)=>({block:0,warn:1,ready:2}[a.readiness.overall]-({block:0,warn:1,ready:2}[b.readiness.overall]))||flightActualDeparture(a.f)-flightActualDeparture(b.f));
  const assessmentByFlight=new Map(assessed.map(item=>[item.f.id,item]));
  const signature=activeFlights.map(f=>`${f.id}:${Math.round(flightProgress(f,now)*100)}:${flightIssueKey(f)}`).join('|')+
    '::upcoming:'+upcomingFlights.map(f=>`${f.id}:${statusOfFlight(f,now)}:${flightActualDeparture(f)}:${flightIssueKey(f)}`).join('|')+
    '::'+issueFlights.map(({f,readiness})=>`${f.id}:${readiness.overall}:${flightIssueKey(f)}`).join('|')+
    '::'+aircraftIssues.map(ac=>`${ac.id}:${ac.defectUntil}:${Management.maintenanceStatus(ac,now).label}`).join('|')+
    `::selected:${selectedFlightId||''}::`+operationalCaseSignature(state.incidents.filter(incident=>incident.status==='open'));
  if(!force&&signature===occSignature) return;
  const attentionList=document.getElementById('occAttentionList');
  const activeList=document.getElementById('occActiveFlightList');
  const upcomingList=document.getElementById('occUpcomingFlightList');
  if(attentionList.contains(document.activeElement)&&document.activeElement.matches('select,input,textarea')) return;
  occSignature=signature;
  document.getElementById('occActiveFlightCount').textContent=activeFlights.length;
  document.getElementById('occUpcomingFlightCount').textContent=upcomingFlights.length;
  document.getElementById('occAttentionCount').textContent=issueFlights.length+aircraftIssues.length;
  document.getElementById('occFlightOperationsCount').textContent=`${activeFlights.length+upcomingFlights.length} flights`;
  const flightQueueMarkup=(flights,{active=false}={})=>flights.slice(0,40).map(f=>{
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const readiness=assessmentByFlight.get(f.id)?.readiness||(ac?readinessForFlight(f,ac,now):{overall:'block'});
    const status=statusOfFlight(f,now),delay=flightTotalDepartureDelayMin(f),problem=flightHasOpenProblem(f,readiness);
    const problemLabels=problem?flightProblemLabels(f,readiness):[];
    const progress=active?flightProgress(f,now):0;
    return `<button class="occ-item ${problem?'has-problem':''}" type="button" data-occ-flight="${esc(f.id)}">
      <span class="occ-title"><span>${esc(f.id)} · ${esc(f.from)} → ${esc(flightOperationalDestination(f))} ${f.flightType==='ferry'?'<span class="ferry-badge">Ferry</span>':''}</span><span class="${delay?'delay-text':''}">${delay?`+${delay}m`:esc(status)}</span></span>
      ${problemBadgesMarkup(problemLabels)}
      <span class="occ-route">${active?`ETA ${formatTime(flightActualArrival(f))}`:`Departure ${formatTime(flightActualDeparture(f))}`}</span>
      <span class="occ-meta">${esc(ac?.tail||f.aircraftId)} · ${f.flightType==='ferry'?'non-revenue positioning':`${f.pax} passengers`}</span>
      ${active?`<span class="active-flight-progress" aria-label="Flight progress ${Math.round(progress*100)} percent"><span style="width:${progress*100}%"></span></span>`:''}
    </button>`;
  }).join('');
  activeList.innerHTML=activeFlights.length?flightQueueMarkup(activeFlights,{active:true}):'<div class="empty">No flights currently airborne.</div>';
  upcomingList.innerHTML=upcomingFlights.length?flightQueueMarkup(upcomingFlights):'<div class="empty">No upcoming flights in the next 24 hours.</div>';
  const flightIssueMarkup=issueFlights.map(({f,readiness})=>{
    const reasons=readiness.gates.filter(gate=>gate.status!=='ready').map(readinessIssueLabel).filter(Boolean);
    if(flightTotalDepartureDelayMin(f)) reasons.push(`Departure +${flightTotalDepartureDelayMin(f)}m`);
    const conciseReasons=reasons.slice(0,3).join(' · ')+(reasons.length>3?` · +${reasons.length-3} more`:'');
    const openIncidents=openIncidentsForFlight(f.id).sort((a,b)=>a.deadline-b.deadline);
    if(openIncidents.length){
      const incident=openIncidents[0];
      const definition=INCIDENT_DEFINITIONS[incident.type]||{title:incident.type,summary:'Operational incident requires a decision.'};
      const workflow=incidentWorkflowProgress(incident,now);
      const currentDepartment=workflow.current?OperationalWorkflows.DEPARTMENTS[workflow.current.department]?.label:'';
      return `<article class="occ-item issue incident-card ${incident.severity==='critical'?'critical':''} ${selectedFlightId===f.id?'selected':''}" data-attention-incident="${esc(incident.id)}">
        <button class="occ-item-select" type="button" data-occ-flight="${esc(f.id)}" data-incident-flight="${esc(f.id)}">
          <span class="occ-title"><span><span class="problem-reason-badge critical">${esc(definition.title)}</span>${incident.training?'<span class="training-badge">Training</span>':''}</span><span class="incident-deadline">${esc(incidentDeadlineText(incident,now))}</span></span>
          <span class="incident-route">${esc(f.id)} · ${esc(f.from)} → ${esc(flightOperationalDestination(f))}</span>
          <span class="occ-meta">${workflow.completed}/${workflow.total} coordinated${workflow.current?` · ${esc(currentDepartment)}: ${esc(workflow.current.label)}`:''}${openIncidents.length>1?` · +${openIncidents.length-1} more incident${openIncidents.length>2?'s':''}`:''}</span>
          <span class="attention-case-progress"><span style="width:${Math.round(workflow.progress*100)}%"></span></span>
        </button>
        <div class="attention-item-actions"><button class="btn" type="button" data-acknowledge-flight="${esc(f.id)}">Acknowledge</button></div>
      </article>`;
    }
    return `<article class="occ-item issue ${readiness.overall==='block'?'blocking':'warning'} ${selectedFlightId===f.id?'selected':''}">
      <button class="occ-item-select" type="button" data-occ-flight="${esc(f.id)}" ${openIncidents.length?`data-incident-flight="${esc(f.id)}"`:''}>
        <span class="occ-title"><span>${esc(f.id)} · ${esc(f.from)} → ${esc(flightOperationalDestination(f))}</span><span class="occ-priority">${readiness.overall==='block'?'Action required':'Review issue'}</span></span>
        ${problemBadgesMarkup(reasons.slice(0,3))}
        <span class="occ-route">${conciseReasons}</span>
        <span class="occ-meta">${shortClock(flightActualDeparture(f))}</span>
      </button>
      <div class="attention-item-actions"><button class="btn" type="button" data-acknowledge-flight="${esc(f.id)}">Acknowledge</button></div>
    </article>`;
  });
  const aircraftIssueMarkup=aircraftIssues.map(ac=>`<article class="occ-item issue blocking ${selectedAircraftId===ac.id&&!selectedFlightId?'selected':''}">
    <button class="occ-item-select" type="button" data-occ-aircraft="${esc(ac.id)}">
      <span class="occ-title"><span>${esc(ac.tail)} · ${esc(ac.model)}</span><span class="occ-priority">Aircraft unavailable</span></span>
      <span class="occ-route">${aircraftIsDefective(ac,now)?esc(ac.defectReason||'Technical defect'):Management.maintenanceStatus(ac,now).label}</span>
      <span class="occ-meta">At ${esc(ac.location)}${aircraftIsDefective(ac,now)?` · unavailable until ${formatTime(ac.defectUntil)}`:''}</span>
    </button>
    <div class="attention-item-actions"><button class="btn" type="button" data-acknowledge-aircraft="${esc(ac.id)}">Acknowledge</button></div>
  </article>`);
  const issues=flightIssueMarkup.concat(aircraftIssueMarkup);
  attentionList.innerHTML=issues.length?issues.join(''):'<div class="empty">No operational issues require attention.</div>';

  [activeList,upcomingList].forEach(list=>list.querySelectorAll('[data-occ-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.occFlight))));
  attentionList.querySelectorAll('[data-occ-flight]').forEach(button=>button.addEventListener('click',()=>{
    settleSelectedFlight(button.dataset.occFlight);
  }));
  attentionList.querySelectorAll('[data-acknowledge-flight]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    acknowledgeFlightIssue(button.dataset.acknowledgeFlight);
  }));
  attentionList.querySelectorAll('[data-acknowledge-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    acknowledgeAircraftIssue(button.dataset.acknowledgeAircraft);
  }));
  attentionList.querySelectorAll('[data-occ-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    settleSelected(button.dataset.occAircraft);
  }));
}

function requestSlotSeries(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base) return toast('Choose a valid slot time.');
  const aligned=alignTimestampToAirportSlot(base,airport);
  if(slotRightAt(airport,aligned)) return toast(`${airport} ${hhmm(aligned)} is already assigned.`);
  const right=requestSlotRight(airport,aligned);
  if(!right){
    const pending=(state.resourceRequests||[]).filter(item=>item.status==='pending'&&item.kind==='slot'&&item.payload?.airport===airport&&item.payload?.timestamp===aligned).at(-1);
    refreshSlotBuyPreview();
    return toast(`Slot series requested. Allocation expected ${pending?formatTime(pending.readyAt):'after airport review'}.`);
  }
  save(); refreshAll(); refreshSlotBuyPreview();
  toast(`${airport} ${hhmm(aligned)} recurring slot series assigned.`);
}

function requestRequiredScheduleSlots(){
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  const from=originEl.value,to=destEl.value,fares=currentScheduleFares();
  const calendar=selectedOperatingCalendar();
  const rawFirst=nextTimestampForClock(departureTimeEl.value);
  const first=rawFirst&&repeatRuleEl.value==='custom'
    ? alignToOperatingCalendar(rawFirst,'custom',calendar.days,calendar.months)
    : rawFirst;
  const turnaroundMin=Number(turnaroundEl.value)||90;
  if(!ac||!first||from===to) return toast('Complete the recurring schedule first.');

  const plan=requiredSlotPlan(from,to,ac,fares,first,turnaroundMin);
  const needs=[];
  if(!plan.originRight) needs.push({airport:from,ts:plan.outboundDeparture});
  if(!plan.destinationRight) needs.push({airport:to,ts:plan.returnDeparture});
  if(!needs.length) return toast('Both required slot series are already assigned.');

  let queued=0;
  for(const need of needs) if(!requestSlotRight(need.airport,need.ts,{silent:true})) queued++;
  save(); refreshAll(); refreshSchedulePreview(); refreshSlotBuyPreview();
  toast(queued?`${queued} slot ${queued===1?'series is':'series are'} awaiting airport allocation.`:`Assigned ${needs.length} required slot ${needs.length===1?'series':'series'}.`);
}

function refreshHeader(){
  const t=simNow();
  const openCount=state.incidents.filter(incident=>incident.status==='open').length;
  document.getElementById('fleetCount').textContent=state.aircraft.length;
  document.getElementById('airborneCount').textContent=state.flights.filter(f=>statusOfFlight(f,t)==='airborne').length;
  document.getElementById('headerIncidentCount').textContent=openCount;
  document.getElementById('simClock').textContent=formatTime(t);
}
function refreshKPIs(){
  const kpis=Management.operationalKpis(state,simNow(),30);
  const scenario=currentScenarioScore();
  const values={
    onTime:document.getElementById('kpiOnTime'),averageDelay:document.getElementById('kpiAverageDelay'),
    completion:document.getElementById('kpiCompletion'),loadFactor:document.getElementById('kpiLoadFactor'),
    utilization:document.getElementById('kpiUtilization'),flights:document.getElementById('kpiFlights')
  };
  values.onTime.textContent=kpis.completed?`${Math.round(kpis.onTimePerformance*100)}%`:'—';
  values.averageDelay.textContent=kpis.completed?`${Math.round(kpis.averageDelayMin)}m`:'—';
  values.completion.textContent=kpis.total?`${Math.round(kpis.completionFactor*100)}%`:'—';
  values.loadFactor.textContent=kpis.completed?`${Math.round(kpis.loadFactor*100)}%`:'—';
  values.utilization.textContent=kpis.completed?`${Math.round(kpis.utilization*24)}h/day`:'—';
  values.flights.textContent=`${kpis.completed} / ${kpis.cancelled}`;
  values.onTime.className=kpis.onTimePerformance>=.8?'metric good':'metric bad';
  values.averageDelay.className=kpis.averageDelayMin<=15?'metric good':'metric bad';
  values.completion.className=kpis.completionFactor>=.95?'metric good':'metric bad';
  values.loadFactor.className=kpis.loadFactor>=.65?'metric good':'metric bad';
  values.utilization.className='';
  values.flights.className=kpis.cancelled?'metric bad':'metric good';
  const score=document.getElementById('kpiOccScore');
  score.textContent=String(scenario.score);
  score.className=scenario.score>=80?'metric good':scenario.score>=60?'metric warn':'metric bad';
}

function aircraftOwnershipMarkup(ac){
  const assigned=aircraftHasAssignments(ac.id);
  return `<div class="aircraft-ownership">
    <div class="row-between"><span class="muted">Resource source</span><b>${esc(ac.resourceSource||'operations pool')}</b></div>
    <button class="btn bad full" type="button" data-release-aircraft="${ac.id}" ${assigned?'disabled':''}>Release aircraft</button>
    ${assigned?'<div class="tiny muted">Remove active and future assignments before releasing it.</div>':''}
  </div>`;
}

function expectedAircraftLocationForFlight(ac,flight){
  const preceding=state.flights
    .filter(item=>item.aircraftId===ac.id&&!item.cancelled&&item.id!==flight.id&&item.departure<flight.departure)
    .sort((a,b)=>b.departure-a.departure)[0];
  return preceding?flightOperationalDestination(preceding):ac.location;
}

function readinessForFlight(flight,ac,t=simNow()){
  const evaluationAircraft={...ac,location:expectedAircraftLocationForFlight(ac,flight)};
  const shortages=flight.staffingBlocked&&flight.staffingShortage
    ? flight.staffingShortage.split(' · ')
    : staffingShortagesForFlight(ac,flightActualDeparture(flight),flight.arrival-flight.departure,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType);
  const readiness=Management.flightReadiness({
    flight,aircraft:evaluationAircraft,now:t,staffingShortages:shortages,
    fuelPlan:flightFuelPlan(flight.from,flightOperationalDestination(flight),ac),
    openIncidents:openIncidentsForFlight(flight.id).map(incident=>({...incident,title:INCIDENT_DEFINITIONS[incident.type]?.title||incident.type}))
  });
  if(flight.positioningBlocked){
    const aircraftGate=readiness.gates.find(gate=>gate.key==='aircraft');
    aircraftGate.status='block'; aircraftGate.detail=`Aircraft is not positioned at ${flight.from}`;
    readiness.overall='block';
  }
  const dispatch=dispatchBriefingForFlight(flight);
  if(dispatch){
    readiness.gates.push({
      key:'dispatch',label:'Dispatch',status:dispatch.status==='hold'?'block':dispatch.status==='conditional'?'warn':'ready',
      detail:[...dispatch.blocks,...dispatch.cautions].join(' · ')||`Release issued · alternate ${dispatch.alternate||'not required'}`
    });
  }
  const groundPhase=groundOperationsForFlight(flight,t)?.departure;
  const rotationGate=readiness.gates.find(gate=>gate.key==='rotation');
  if(groundPhase&&rotationGate){
    const groundDelay=Math.max(0,Math.round((groundPhase.readyAt-flight.departure)/MIN));
    rotationGate.label='Ground operation';
    rotationGate.status=groundDelay?'warn':'ready';
    rotationGate.detail=groundDelay
      ? `${groundPhase.label} completes ${groundDelay} minutes after schedule`
      : groundPhase.status==='active'
        ? `${groundPhase.label} ${Math.round(groundPhase.progress*100)}% complete`
        : groundPhase.status==='complete'
          ? `${groundPhase.label} complete`
          : `${groundPhase.label} planned from ${shortClock(groundPhase.startAt)}`;
  }
  const score={ready:0,warn:1,block:2};
  readiness.overall=readiness.gates.reduce((worst,gate)=>score[gate.status]>score[worst]?gate.status:worst,'ready');
  return readiness;
}

function readinessMarkup(flight,ac,t){
  const readiness=readinessForFlight(flight,ac,t);
  const label=readiness.overall==='ready'?'Ready to depart':readiness.overall==='warn'?'Potential delay':'Cannot depart';
  return `<div class="readiness-board">
    <div class="readiness-head"><div class="estimate-title">Departure readiness</div><span class="readiness-state ${readiness.overall}">${label}</span></div>
    <div class="readiness-grid">${readiness.gates.map(gate=>`<div class="readiness-gate ${gate.status}"><b>${gate.label}</b><span>${gate.detail}</span></div>`).join('')}</div>
  </div>`;
}

function flightControlsMarkup(flight){
  if(flight.settled||flight.cancelled) return '';
  if(flight.departureLogged) return `<div id="flight-section-controls" class="flight-status-note"><b>Flight airborne</b><span>No departure action is required. Arrival and downstream effects update automatically.</span></div>`;
  return `<div id="flight-section-controls" class="flight-control-panel">
    <div class="flight-detail-section-heading"><span>Flight controls</span><b>Before departure</b></div>
    <div class="occ-action-grid compact"><button class="btn" type="button" data-priority-fuel="${flight.id}" ${flight.fueled?'disabled':''}>${flight.fueled?'Fuel onboard':'Fuel now'}</button><button class="btn bad" type="button" data-cancel-flight="${flight.id}">Cancel flight</button></div>
  </div>`;
}

function dispatchDetailsMarkup(flight,ac){
  const briefing=dispatchBriefingForFlight(flight),crew=crewDutyForFlight(flight),constraints=networkConstraintsForFlight(flight);
  if(!briefing) return '';
  const activeMel=(ac.melItems||[]).filter(item=>['open','expired'].includes(item.status));
  const rotation=rotationForFlight(flight);
  const crewPlan=crew.augmented?'Augmented crew · in-flight rest':rotation.returnFlight||flight.serviceLeg==='return'
    ? rotationUsesThroughCrew(flight)?'Through crew · outbound and return':'Split duty · destination crew operates return'
    : 'Standard operating crew';
  const crewAction=recoveryPlansForFlight(flight).find(plan=>plan.id==='augment-crew'||plan.id==='crew-unavailable');
  return `<section id="flight-section-dispatch" class="flight-detail-section dispatch-section">
    <div class="flight-detail-section-heading"><span>Dispatch &amp; crew duty</span><b class="dispatch-state ${briefing.status}">${esc(briefing.label)}</b></div>
    <div class="flight-detail-section-body">
      <div class="row-between"><span>Flight duty period</span><b class="${crew.legal?'':'delay-text'}">${crew.dutyHours.toFixed(1)} / ${crew.maxHours.toFixed(1)} h · ${crew.sectors} sectors</b></div>
      <div class="row-between"><span>Crew plan</span><b>${esc(crewPlan)}</b></div>
      <div class="row-between"><span>Alternate</span><b>${esc(briefing.alternate||'None required')}</b></div>
      <div class="row-between"><span>Departure slot</span><b class="${flight.slotMissed?'delay-text':''}">${flight.slotMissed?`Missed · reassigned ${shortClock(flight.assignedSlot)}`:`Original opportunity valid · ${shortClock(flight.assignedSlot||flight.departure)}`}</b></div>
      <div class="row-between"><span>Airport flow</span><b>${esc(constraints.airport.reason)}${constraints.airport.delayMin?` · +${constraints.airport.delayMin}m`:''}</b></div>
      <div class="row-between"><span>Airspace</span><b>${esc(constraints.airspace.reason)}${constraints.airspace.delayMin?` · +${constraints.airspace.delayMin}m`:''}</b></div>
      ${activeMel.map(item=>`<div class="detail-shaded warning"><span>MEL ${esc(item.code)} · CAT ${esc(item.category)}</span><b>${esc(item.restriction)}</b></div>`).join('')}
      ${briefing.blocks.length?`<div class="detail-shaded danger"><span>Release blocks</span><b>${esc(briefing.blocks.join(' · '))}</b></div>`:''}
      ${crewAction?`<div class="context-section-action"><div><b>${esc(crewAction.label)}</b><span>${esc(crewAction.detail)}</span></div><button class="btn ${crewAction.tone||''}" type="button" data-apply-recovery="${esc(crewAction.id)}" data-recovery-flight="${esc(flight.id)}" ${crewAction.disabled?'disabled':''}>${crewAction.disabled?'Unavailable':'Apply'}</button></div>`:''}
    </div>
  </section>`;
}

function passengerConnectionsMarkup(flight){
  const manifest=connectionStatusForFlight(flight);
  if(!manifest.total) return '';
  const protectAction=recoveryPlansForFlight(flight).find(plan=>plan.id==='protect-connections');
  return `<section id="flight-section-connections" class="flight-detail-section connection-section">
    <div class="flight-detail-section-heading"><span>Passenger connections</span><b>${manifest.total} connecting · ${manifest.missed} missed</b></div>
    <div class="flight-detail-section-body">${manifest.connections.map(item=>`<div class="connection-row ${item.status}"><span>${item.pax} pax → ${esc(item.flightId)} / ${esc(item.to)}</span><b>${esc(item.status)} · ${Math.round(item.availableMin)}m / ${item.mctMin}m MCT</b></div>`).join('')}${protectAction?`<div class="context-section-action"><div><b>${esc(protectAction.label)}</b><span>${esc(protectAction.detail)}</span></div><button class="btn good" type="button" data-apply-recovery="protect-connections" data-recovery-flight="${esc(flight.id)}">Apply</button></div>`:''}</div>
  </section>`;
}

function workflowTaskState(task){
  if(task.status==='waiting_external') return 'Awaiting external response';
  if(task.status==='in_progress') return 'In progress';
  if(task.status==='available') return 'Action required';
  if(task.status==='blocked') return 'Blocked';
  if(task.status==='completed') return 'Complete';
  return task.status;
}

function workflowTaskProgressMarkup(task,t){
  if(!['in_progress','waiting_external'].includes(task.status)) return '';
  const progress=OperationalWorkflows.progress(task,t),percent=Math.round(progress*100);
  const remaining=Math.max(0,Math.ceil((task.completesAt-t)/MIN));
  return `<div class="workflow-progress"><div class="row-between"><span>${task.status==='waiting_external'?'Response pending':'Work in progress'}</span><b>${remaining} min</b></div><div class="workflow-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div></div>`;
}

function operationalTaskActionMarkup(task,incident,flight,t){
  if(task.status==='blocked'){
    const pending=task.dependsOn.map(id=>state.coordinationTasks.find(item=>item.id===id)).filter(item=>item&&item.status!=='completed');
    return `<div class="department-task-blocker">Waiting for ${pending.map(item=>esc(item.label)).join(' and ')}.</div>`;
  }
  if(['in_progress','waiting_external'].includes(task.status)){
    const request=task.externalRequestId?state.externalRequests.find(item=>item.id===task.externalRequestId):null;
    return `${workflowTaskProgressMarkup(task,t)}${request?`<div class="department-counterparty"><span>External party</span><b>${esc(request.counterparty)}</b></div>`:''}`;
  }
  if(task.status!=='available') return '';
  const blocker=['technical_strategy','recovery_strategy'].includes(task.kind)?'':taskResourceBlocker(task,incident);
  if(blocker) return `<div class="department-task-blocker">${esc(blocker)}</div>`;
  if(task.kind==='crew_allocation'){
    const options=crewPoolOptions(incident);
    return options.length?`<label for="crewPool-${esc(task.id)}">Personnel pool</label><select id="crewPool-${esc(task.id)}" data-task-payload="optionId">${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)}</option>`).join('')}</select><button class="btn primary full" type="button" data-operational-task="${esc(task.id)}" style="margin-top:7px">Reserve replacement crew</button>`:'<div class="department-task-blocker">No legal qualified personnel pool is available. Request or relocate personnel, then return to this task.</div>';
  }
  if(task.kind==='maintenance_inspection') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">Start 25-minute engineering inspection</button>`;
  if(task.kind==='technical_strategy'||task.kind==='recovery_strategy'){
    const fallback=[{id:'defer',label:'Defer under MEL',detail:'Continue with documented restrictions.'},{id:'repair',label:'Repair aircraft',detail:'Ground the aircraft for engineering sign-off.'},{id:'substitute',label:'Use replacement aircraft',detail:'Assign a serviceable spare or borrowed aircraft.'}];
    const options=task.strategyOptions||fallback;
    return `<div class="department-choice-grid">${options.map(option=>{
      const optionBlocker=branchStrategyOptionBlocker(task,incident,option.id);
      const consequence=operationalOptionConsequence(task,incident,option.id);
      return `<button class="btn ${optionBlocker?'':'primary'}" type="button" data-operational-task="${esc(task.id)}" data-task-action="${esc(option.id)}" ${optionBlocker?'disabled':''}><b>${esc(option.label||option.id)}</b><span>${esc(optionBlocker||option.detail||'Select this recovery path.')}</span>${consequence?`<em class="choice-consequence">${esc(consequence)}</em>`:''}</button>`;
    }).join('')}</div>${options.map(option=>branchStrategyOptionBlocker(task,incident,option.id)).filter(Boolean).map(message=>`<div class="department-task-blocker">${esc(message)}</div>`).join('')}`;
  }
  if(task.kind==='maintenance_disposition'){
    const finding=incident.technicalContext;
    return `${finding?`<div class="technical-finding"><b>MEL ${esc(finding.code)} · ATA ${esc(finding.ata)} · CAT ${esc(finding.category)}</b><span>${esc(finding.title)}</span><em>${esc(finding.restriction)}</em></div>`:''}<div class="department-choice-grid"><button class="btn" type="button" data-operational-task="${esc(task.id)}" data-task-action="defer">Defer under MEL</button><button class="btn primary" type="button" data-operational-task="${esc(task.id)}" data-task-action="repair">Begin 2-hour repair</button></div>`;
  }
  if(task.kind==='maintenance_defer') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}" data-task-action="defer">Confirm MEL deferral</button>`;
  if(task.kind==='maintenance_repair') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}" data-task-action="repair">Begin 2-hour repair</button>`;
  if(task.kind==='maintenance_clearance') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">Record engineering clearance</button>`;
  if(task.kind==='crew_augmentation') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">Assign augmented crew</button>`;
  if(task.kind==='aircraft_substitution'){
    const options=incidentAircraftReplacementOptions(incident);
    return options.length?`<label for="replacement-${esc(task.id)}">Replacement aircraft</label><select id="replacement-${esc(task.id)}" data-task-payload="optionId">${options.map(option=>`<option value="${esc(option.id)}">${esc(option.label)} · ${esc(option.detail)}</option>`).join('')}</select><button class="btn primary full" type="button" data-operational-task="${esc(task.id)}" style="margin-top:7px">Assign replacement aircraft</button>`:'<div class="department-task-blocker">No suitable spare aircraft is available. Request aircraft or position a spare, then return to this task.</div>';
  }
  if(task.kind==='flight_cancellation') return `<button class="btn bad full" type="button" data-operational-task="${esc(task.id)}">Cancel affected flight</button>`;
  if(task.kind==='atc_coordination') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">${esc(task.label)}</button>`;
  if(task.kind==='stand_request') return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">${esc(task.label)}</button>`;
  if(['inbound_wait','turnaround_expedite','slot_coordination','station_recovery','fuel_recovery','security_coordination','connection_protection','medical_assessment','medical_coordination'].includes(task.kind)) return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">${esc(task.label)}</button>`;
  if(task.kind==='alternate_selection'){
    const options=diversionOptionsForIncident(incident,{includeReturnOrigin:false});
    return options.length?`<label for="alternate-${esc(task.id)}">Operational alternate</label><select id="alternate-${esc(task.id)}" data-task-payload="airport">${options.map(option=>`<option value="${esc(option.code)}">${esc(option.returnOrigin?'Return to origin':option.code)} · ${option.returnOrigin?'origin airport':`${Math.round(option.destinationKm)} km from destination`} · ${esc(option.weather.label)} · fuel ${option.fuel.estimated?'estimated':'planned'}</option>`).join('')}</select><div class="alternate-comparison">${options.slice(0,3).map(option=>`<span><b>${esc(option.returnOrigin?'Return':option.code)}</b>${Math.round(option.km)} km route · ${esc(option.weather.conditions)} · fuel ${Math.round(option.fuel.remaining)}/${Math.round(option.fuel.required)} gal</span>`).join('')}</div><button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">Select alternate</button>`:'<div class="department-task-blocker">No suitable alternate is currently available.</div>';
  }
  if(task.kind==='return_origin_selection'){
    const option=diversionOptionsForIncident(incident,{onlyReturnOrigin:true})[0];
    return option?`<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">Confirm return to ${esc(option.code)}</button>`:'<div class="department-task-blocker">Return to origin is not currently suitable.</div>';
  }
  const labels={
    atc_coordination:task.label,
    flightdeck_recommendation:`Send ${incident.selectedAlternate||'alternate'} recommendation to flight deck`,
    diversion_clearance:'Monitor flight-crew ATC clearance request',
    alternate_handling:`Request ${incident.selectedAlternate||'alternate'} stand and handling`,
    dispatch_release:task.label,
    station_coordination:'Confirm ground movement and handling plan'
  };
  return `<button class="btn primary full" type="button" data-operational-task="${esc(task.id)}">${esc(labels[task.kind]||task.label)}</button>`;
}

function departmentTaskDetailMarkup(task,t){
  if(!task) return '';
  const incident=state.incidents.find(item=>item.id===task.incidentId);
  const flight=incident&&state.flights.find(item=>item.id===incident.flightId);
  if(!incident||!flight) return '';
  const definition=INCIDENT_DEFINITIONS[incident.type]||{title:incident.type};
  return `<div class="department-task-focus ${task.status}">
    <div class="department-task-context"><span>${esc(flight.id)} · ${esc(flight.from)} → ${esc(flightOperationalDestination(flight))}</span><b>${esc(definition.title)}</b></div>
    <div class="department-task-focus-head"><div><b>${esc(task.label)}</b><span>${esc(task.detail)}</span></div><em>${esc(workflowTaskState(task))}</em></div>
    ${operationalTaskActionMarkup(task,incident,flight,t)}
  </div>`;
}

function bindDepartmentTaskControls(root){
  root.querySelectorAll('[data-department-task]').forEach(button=>button.addEventListener('click',()=>{
    selectedDepartmentTaskId=button.dataset.departmentTask;
    refreshDepartmentWidgets(true);
  }));
  root.querySelectorAll('[data-operational-task]').forEach(button=>button.addEventListener('click',()=>{
    const detail=button.closest('.department-task-detail');
    const payload={};
    detail?.querySelectorAll('[data-task-payload]').forEach(input=>payload[input.dataset.taskPayload]=input.value);
    performOperationalTask(button.dataset.operationalTask,button.dataset.taskAction||'',payload);
  }));
}

function refreshDepartmentWidgets(force=false){
  const t=simNow();
  const signature=(state.coordinationTasks||[]).map(task=>`${task.id}:${task.status}:${task.startedAt}:${task.completesAt}:${JSON.stringify(task.selection)}`).join('|')+`::${selectedDepartmentTaskId}`;
  if(!force&&signature===departmentTaskSignature){
    document.querySelectorAll('.department-task-focus').forEach(focus=>{
      const task=state.coordinationTasks.find(item=>item.id===focus.closest('.department-task-detail')?.dataset.taskId);
      if(task&&['in_progress','waiting_external'].includes(task.status)) refreshDepartmentWidgets(true);
    });
    return;
  }
  departmentTaskSignature=signature;
  for(const [department,ui] of Object.entries(DEPARTMENT_UI)){
    const list=document.getElementById(ui.list),detail=document.getElementById(ui.detail);
    const tasks=openDepartmentTasks(department).sort((a,b)=>Number(b.incidentId===state.coordinationTasks.find(item=>item.id===selectedDepartmentTaskId)?.incidentId)-Number(a.incidentId===state.coordinationTasks.find(item=>item.id===selectedDepartmentTaskId)?.incidentId)||({available:0,in_progress:1,waiting_external:1,blocked:2}[a.status]-({available:0,in_progress:1,waiting_external:1,blocked:2}[b.status]))||a.createdAt-b.createdAt);
    document.getElementById(ui.count).textContent=`${tasks.length} task${tasks.length===1?'':'s'}`;
    if(!tasks.length){ list.innerHTML='<div class="empty">No active departmental tasks.</div>'; detail.innerHTML=''; detail.dataset.taskId=''; continue; }
    let selected=tasks.find(task=>task.id===selectedDepartmentTaskId)||tasks[0];
    if(!tasks.some(task=>task.id===selectedDepartmentTaskId)&&document.querySelector(`[data-widget="${ui.widget}"] .widget-header`)?.getAttribute('aria-expanded')==='true') selectedDepartmentTaskId=selected.id;
    list.innerHTML=tasks.map(task=>{
      const incident=state.incidents.find(item=>item.id===task.incidentId),flight=incident&&state.flights.find(item=>item.id===incident.flightId);
      return `<button class="department-task-row ${task.id===selected.id?'selected':''} ${task.status}" type="button" data-department-task="${esc(task.id)}"><span><b>${esc(flight?.id||task.flightId)}</b>${esc(task.label)}</span><em>${esc(workflowTaskState(task))}</em></button>`;
    }).join('');
    detail.dataset.taskId=selected.id;
    detail.innerHTML=departmentTaskDetailMarkup(selected,t);
    bindDepartmentTaskControls(document.getElementById(`${ui.widget.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())}WidgetBody`)||list.parentElement);
  }
}

function openDepartmentTask(taskId){
  const task=state.coordinationTasks.find(item=>item.id===taskId);
  const ui=task&&DEPARTMENT_UI[task.department];
  if(!task||!ui) return;
  selectedDepartmentTaskId=task.id;
  for(const config of Object.values(DEPARTMENT_UI)){
    const widget=document.querySelector(`[data-widget="${config.widget}"]`);
    if(widget) setWidgetOpen(widget,config.widget===ui.widget,{persist:false});
  }
  refreshDepartmentWidgets(true);
  const widget=document.querySelector(`[data-widget="${ui.widget}"]`);
  widget?.scrollIntoView({behavior:'smooth',block:'start'});
}

function incidentContextMarkup(incidents,t,{showFlight=false}={}){
  const ordered=incidents.filter(incident=>incident.status==='open').sort((a,b)=>a.deadline-b.deadline);
  if(!ordered.length) return '';
  return `<section ${showFlight?'':'id="flight-section-incidents" '}class="flight-detail-section incident-context-section priority-case-section">
    <div class="flight-detail-section-heading"><span>Operational ${ordered.length===1?'case':'cases'}</span><b>${ordered.length} open</b></div>
    <div class="flight-detail-section-body incident-context-list">${ordered.map(incident=>{
      const definition=INCIDENT_DEFINITIONS[incident.type]||{title:incident.type,summary:'An operational incident affects this movement.'};
      const context=[incident.id,showFlight?incident.flightId:'',incident.airport?`At ${incident.airport}`:''].filter(Boolean).join(' · ');
      const technical=incident.type==='mel_defect'?(incident.technicalContext||OperationalIntelligence.melFinding(incident.id,incident.detectedAt)):null;
      const tasks=incidentTasks(incident.id),workflow=incidentWorkflowProgress(incident,t);
      const impacts=(incident.impacts||[]).map(impact=>{
        const status=impact.status==='auto'?'Defaulted':impact.status==='handled'?'Handled':impact.status==='accepted'?'Accepted':impact.status==='cleared'?'Cleared':'Impact';
        const context=impact.context||{};
        const detail=impact.type==='slot_miss_risk'?`${context.slotDelayMin||0} min slot delay`
          : impact.type==='connection_risk'?`${context.atRiskPax||0} at risk · ${context.missedPax||0} missed`
            : impact.type==='crew_duty_risk'?(context.label||'Duty envelope at risk')
              : (impact.summary||INCIDENT_DEFINITIONS[impact.type]?.summary||'Operational impact');
        return `<div class="case-task-row ${esc(impact.status||'open')}"><span><b>${esc(status)} · ${esc(impact.title||INCIDENT_DEFINITIONS[impact.type]?.title||impact.type)}</b>${esc(detail)}</span></div>`;
      }).join('');
      return `<div class="incident-context-card open">
        <div class="row-between"><b>${esc(definition.title)}</b><span class="incident-context-state">${esc(incident.overdue?'Coordination overdue':incidentDeadlineText(incident,t))}</span></div>
        <div class="incident-summary">${esc(definition.summary||'Operational intervention required.')}</div>
        <div class="incident-context-meta">${esc(context)}</div>
        ${technical?`<div class="incident-technical"><b>MEL ${esc(technical.code)} · ATA ${esc(technical.ata)} · CAT ${esc(technical.category)}</b><span>${esc(technical.title)} · ${esc(technical.restriction)} · defer to ${formatTime(technical.expiresAt)}</span></div>`:''}
        ${impacts?`<div class="case-task-list">${impacts}</div>`:''}
        <div class="case-progress"><div class="row-between"><span>Coordination progress</span><b>${workflow.completed}/${workflow.total}</b></div><div class="workflow-progress-bar"><span style="width:${Math.round(workflow.progress*100)}%"></span></div></div>
        <div class="case-task-list">${tasks.map(task=>`<div class="case-task-row ${task.status}"><span><b>${task.status==='completed'?'✓':task.status==='blocked'?'○':'●'} ${esc(OperationalWorkflows.DEPARTMENTS[task.department]?.label||task.department)}</b>${esc(task.label)}</span>${task.status==='completed'?`<em>Complete</em>`:`<button type="button" data-open-department-task="${esc(task.id)}">${task.status==='available'?'Open task':task.status==='blocked'?'Inspect':'View progress'}</button>`}</div>`).join('')}</div>
        ${showFlight?`<button class="incident-context-flight" type="button" data-incident-context-flight="${esc(incident.flightId)}">Open ${esc(incident.flightId)}</button>`:''}
      </div>`;
    }).join('')}</div>
  </section>`;
}

function bindIncidentResponseControls(root){
  root.querySelectorAll('[data-open-department-task]').forEach(button=>button.addEventListener('click',()=>openDepartmentTask(button.dataset.openDepartmentTask)));
}

function groundTaskStatusLabel(task){
  return task.status==='complete'?'Complete':task.status==='active'?`${Math.round(task.progress*100)}%`:'Waiting';
}

function groundPhaseMarkup(phase){
  const phaseStatus=phase.status==='complete'?'Complete':phase.status==='active'?`${Math.round(phase.progress*100)}%`:'Waiting';
  const timing=phase.key==='postflight'
    ? `${shortClock(phase.startAt)}–${shortClock(phase.endAt)}`
    : `Ready ${shortClock(phase.readyAt)}`;
  return `<div class="ground-phase ${phase.status}" data-ground-phase="${esc(phase.key)}">
    <div class="ground-phase-head">
      <div><b>${esc(phase.label)}</b><span>${esc(phase.airport)} · ${timing}</span></div>
      <strong data-ground-phase-status>${phaseStatus}</strong>
    </div>
    <div class="ground-phase-progress" role="progressbar" aria-label="${esc(phase.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(phase.progress*100)}"><span data-ground-phase-fill style="width:${Math.round(phase.progress*100)}%"></span></div>
    <div class="ground-task-grid">${phase.tasks.map(task=>`<div class="ground-task ${task.status} ${task.delayed?'delayed':''}" data-ground-task="${esc(task.id)}">
      <div class="ground-task-head"><span>${esc(task.label)}${task.delayed?'<em>handling exception</em>':''}</span><b data-ground-task-status>${groundTaskStatusLabel(task)}</b></div>
      <div class="ground-task-progress" role="progressbar" aria-label="${esc(task.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(task.progress*100)}"><span data-ground-task-fill style="width:${Math.round(task.progress*100)}%"></span></div>
    </div>`).join('')}</div>
  </div>`;
}

function groundOperationsMarkup(flight,t,{phaseKey='',heading='Ground operations',showActions=false}={}){
  const operations=groundOperationsForFlight(flight,t);
  if(!operations) return '';
  const phases=phaseKey?[operations[phaseKey]].filter(Boolean):[operations.departure,operations.postflight];
  const expediteAction=showActions?recoveryPlansForFlight(flight).find(plan=>plan.id==='expedite'):null;
  return `<section ${showActions?'id="flight-section-ground" ':''}class="flight-detail-section ground-operations-section" data-ground-ops-flight="${esc(flight.id)}" data-ground-phase-filter="${esc(phaseKey)}">
    <div class="flight-detail-section-heading"><span>${esc(heading)}</span><b>${phases.length===1?esc(phases[0].airport):'Departure · arrival'}</b></div>
    <div class="flight-detail-section-body ground-operations-body">${phases.map(groundPhaseMarkup).join('')}${expediteAction?`<div class="context-section-action"><div><b>${esc(expediteAction.label)}</b><span>${esc(expediteAction.detail)}</span></div><button class="btn good" type="button" data-apply-recovery="expedite" data-recovery-flight="${esc(flight.id)}">Apply</button></div>`:''}</div>
  </section>`;
}

function refreshGroundTaskProgress(){
  const t=simNow();
  document.querySelectorAll('[data-ground-ops-flight]').forEach(container=>{
    const flight=state.flights.find(item=>item.id===container.dataset.groundOpsFlight);
    const operations=flight&&groundOperationsForFlight(flight,t);
    if(!operations) return;
    const phaseFilter=container.dataset.groundPhaseFilter;
    container.querySelectorAll('[data-ground-phase]').forEach(phaseElement=>{
      if(phaseFilter&&phaseElement.dataset.groundPhase!==phaseFilter) return;
      const phase=operations[phaseElement.dataset.groundPhase];
      if(!phase) return;
      const percent=Math.round(phase.progress*100);
      phaseElement.classList.remove('waiting','active','complete');
      phaseElement.classList.add(phase.status);
      phaseElement.querySelector('[data-ground-phase-status]').textContent=phase.status==='complete'?'Complete':phase.status==='active'?`${percent}%`:'Waiting';
      const phaseBar=phaseElement.querySelector('.ground-phase-progress');
      phaseBar.setAttribute('aria-valuenow',String(percent));
      phaseBar.querySelector('[data-ground-phase-fill]').style.width=`${percent}%`;
      const taskById=new Map(phase.tasks.map(task=>[task.id,task]));
      phaseElement.querySelectorAll('[data-ground-task]').forEach(taskElement=>{
        const task=taskById.get(taskElement.dataset.groundTask);
        if(!task) return;
        const taskPercent=Math.round(task.progress*100);
        taskElement.classList.remove('waiting','active','complete');
        taskElement.classList.add(task.status);
        taskElement.querySelector('[data-ground-task-status]').textContent=groundTaskStatusLabel(task);
        const taskBar=taskElement.querySelector('.ground-task-progress');
        taskBar.setAttribute('aria-valuenow',String(taskPercent));
        taskBar.querySelector('[data-ground-task-fill]').style.width=`${taskPercent}%`;
      });
    });
  });
}

function aircraftDetailsMarkup(ac,t){
  const model=MODELS[ac.model];
  const cabin=cabinForAircraft(ac),configuredSeats=cabinSeatCount(ac);
  const fuel=aircraftFuelPerformance(model);
  const defective=aircraftIsDefective(ac,t);
  const maintenance=Management.maintenanceStatus(ac,t);
  const active=state.flights.find(f=>f.aircraftId===ac.id&&!f.cancelled&&flightActualDeparture(f)<=t&&t<flightActualArrival(f));
  const upcoming=state.flights.filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled&&flightActualDeparture(f)>t).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b))[0];
  const incidents=state.incidents.filter(incident=>incident.status==='open'&&(incident.aircraftId===ac.id||state.flights.find(f=>f.id===incident.flightId)?.aircraftId===ac.id));
  const currentGroundOperation=aircraftGroundOperation(ac,t);
  const activeMel=(ac.melItems||[]).filter(item=>['open','expired'].includes(item.status));
  const stateLabel=active?'Airborne':defective?'Unavailable':maintenance.grounding?'Maintenance hold':
    currentGroundOperation?.phase.key==='postflight'&&currentGroundOperation.phase.status==='active'?'Post-flight service':'On ground';
  return `<div class="aircraft-details-content">
    <div class="flight-detail-header">
      <div>
        <div class="flight-detail-code">${esc(ac.tail)}</div>
        <div class="aircraft-detail-model">${esc(ac.model)}</div>
        <div class="tiny muted">${esc(ac.location)} · ${stateLabel}</div>
      </div>
      <button class="flight-detail-close" type="button" data-close-aircraft-details aria-label="Close aircraft details">×</button>
    </div>
    ${defective?`<div class="issue-badge defect">${esc(ac.defectReason||'Technical defect')} · unavailable until ${formatTime(ac.defectUntil)}</div>`:''}
    ${incidentContextMarkup(incidents,t,{showFlight:true})}
    ${activeMel.length?`<section class="flight-detail-section mel-section"><div class="flight-detail-section-heading"><span>Deferred defects</span><b>${activeMel.length} active MEL</b></div><div class="flight-detail-section-body">${activeMel.map(item=>`<div class="mel-row ${item.status}"><span><b>${esc(item.code)} · CAT ${esc(item.category)}</b>${esc(item.title)}</span><span>${item.status==='expired'?'EXPIRED':`${item.remainingCycles} cycles · to ${formatTime(item.expiresAt)}`}</span><em>${esc(item.restriction)}</em></div>`).join('')}</div></section>`:''}
    ${currentGroundOperation?.phase?groundOperationsMarkup(currentGroundOperation.flight,t,{phaseKey:currentGroundOperation.phase.key,heading:currentGroundOperation.phase.status==='waiting'?'Next ground operation':'Current ground operation'}):''}
    <section class="flight-detail-section"><div class="flight-detail-section-heading"><span>Operational status</span><b>${stateLabel}</b></div><div class="flight-detail-section-body">
      <div class="row-between"><span>Location</span><b>${esc(ac.location)}</b></div>
      <div class="row-between"><span>Condition</span><b>${Math.round(ac.condition??100)}%</b></div>
      <div class="row-between"><span>Utilization</span><b>${num(ac.flightHours||0)} h · ${num(ac.cycles||0)} cycles</b></div>
      <div class="row-between"><span>Maintenance</span><b>${esc(maintenance.label)}</b></div>
      ${active?`<button class="aircraft-operation-link" type="button" data-aircraft-flight="${esc(active.id)}">Active · ${esc(active.id)} · ${esc(active.from)} → ${esc(flightOperationalDestination(active))}</button>`:''}
      ${upcoming?`<button class="aircraft-operation-link" type="button" data-aircraft-flight="${esc(upcoming.id)}">Next · ${esc(upcoming.id)} · ${esc(upcoming.from)} → ${esc(flightOperationalDestination(upcoming))} · ${shortClock(flightActualDeparture(upcoming))}</button>`:''}
    </div></section>
    <section class="flight-detail-section"><div class="flight-detail-section-heading"><span>Cabin &amp; performance</span><b>${configuredSeats} seats</b></div><div class="flight-detail-section-body">
      <div class="row-between"><span>Cabin</span><b>${cabin.economy} economy · ${cabin.business} business · ${cabin.first} first</b></div>
      <div class="row-between"><span>Range</span><b>${num(model.maxRangeKm)} km</b></div>
      <div class="row-between"><span>Fuel</span><b>${num(ac.fuelGallons||0)} / ${num(fuel.fuelCapacityGal)} US gal</b></div>
    </div></section>
    ${aircraftOwnershipMarkup(ac)}
  </div>`;
}

function flightProblemAnchorsMarkup(flight,readiness,incidents,delays,hasService){
  const links=new Map();
  const add=(target,label)=>{ if(!links.has(target)) links.set(target,label); };
  if(incidents.length) add('flight-section-incidents',incidents.length===1?(INCIDENT_DEFINITIONS[incidents[0].type]?.title||'Open incident'):`${incidents.length} open incidents`);
  for(const gate of readiness.gates.filter(item=>item.status!=='ready')){
    if(gate.key==='crew'||gate.key==='dispatch'||gate.key==='weather') add('flight-section-dispatch',readinessIssueLabel(gate)||'Dispatch restriction');
    else if(gate.key==='aircraft') add(hasService?'flight-section-schedule':'flight-section-aircraft',readinessIssueLabel(gate)||'Aircraft unavailable');
    else if(gate.key==='fuel') add('flight-section-fuel','Fuel top-up pending');
    else if(gate.key==='slot') add('flight-section-dispatch','Departure slot missed');
    else if(gate.key==='rotation') add('flight-section-ground',readinessIssueLabel(gate)||'Inbound rotation delay');
  }
  if(flight.handlingDelayMin) add('flight-section-ground',`${flight.handlingDelayCause||'Ground task delay'} · +${flight.handlingDelayMin} min`);
  if(flight.connectionAtRiskPax||flight.connectionMissedPax) add('flight-section-connections',flight.connectionMissedPax?`${flight.connectionMissedPax} missed connections`:`${flight.connectionAtRiskPax} connections at risk`);
  if(delays.length&&!links.size) add('flight-section-overview',`${delays[0][0]} · +${delays[0][1]} min`);
  if(!links.size) return '';
  return `<nav class="flight-problem-nav" aria-label="Jump to flight problems"><span>Problems</span>${[...links].map(([target,label])=>`<a href="#${target}" data-flight-anchor="${target}">${esc(label)}</a>`).join('')}</nav>`;
}

function flightDetailsMarkup(flight,ac,t){
  const model=MODELS[ac.model];
  const cabin=cabinForAircraft(ac),configuredSeats=cabinSeatCount(ac);
  const service=flight.serviceId?state.services.find(s=>s.active&&s.id===flight.serviceId):null;
  const status=statusOfFlight(flight,t);
  const depDelay=flightTotalDepartureDelayMin(flight);
  const arrDelay=Math.max(0,Math.round((flightActualArrival(flight)-flight.arrival)/MIN));
  const fuelPlan=flightFuelPlan(flight.from,flightOperationalDestination(flight),ac);
  const fuelGallons=flight.fueled?(flight.fuelPurchasedGallons??flight.fuelGallons):Math.max(0,Math.ceil(fuelPlan.requiredGal-(ac.fuelGallons||0)));
  const fuelOnboard=flight.fueled?(flight.fuelOnboardAtDeparture||fuelPlan.requiredGal):(ac.fuelGallons||0)+fuelGallons;
  const fuelAfterFlight=Math.max(0,fuelOnboard-(flight.tripFuelGallons||fuelPlan.tripBurnGal));
  const operationalDestination=flightOperationalDestination(flight);
  const flightIncidents=state.incidents.filter(incident=>incident.status==='open'&&incident.flightId===flight.id).sort((a,b)=>a.deadline-b.deadline);
  const readiness=readinessForFlight(flight,ac,t);
  const recoveryPlans=recoveryPlansForFlight(flight);
  const aircraftRecovery=recoveryPlans.find(plan=>plan.id==='use-spare');
  const readinessLabel=readiness.overall==='ready'?'Ready to depart':readiness.overall==='warn'?'Potential delay':'Cannot depart';
  const delays=[
    ['Handling / technical',(flight.handlingDelayMin||0)+(flight.technicalDelayMin||0)],
    ['Personnel',flight.staffingDelayMin||0],
    ['OCC hold / weather',(flight.manualDelayMin||0)+(flight.weatherDelayMin||0)],
    ['Airport / airspace',(flight.airportDelayMin||0)+(flight.airspaceDelayMin||0)],
    [flightIncidents.length?'Incident response':'Operational recovery',flight.incidentDelayMin||0],
    ['Maintenance / position',(flight.maintenanceDelayMin||0)+(flight.positioningDelayMin||0)],
    ['Propagation / slot',(flight.propagatedDelayMin||0)+(flight.slotDelayMin||0)],
    ['En-route',flight.enrouteDelayMin||0]
  ].filter(([,minutes])=>minutes);
  const delayCause=delays[0]?.[0]||'';
  const delayDetail=delays.map(([label,minutes])=>`${label} +${minutes}m`).join(' · ');
  const problemAnchors=flightProblemAnchorsMarkup(flight,readiness,flightIncidents,delays,Boolean(service));
  return `<div class="flight-details-content">
    <div class="flight-detail-header">
      <div>
        <div class="flight-detail-code">${esc(flight.id)} ${flight.flightType==='ferry'?'<span class="ferry-badge">Ferry</span>':''}</div>
        <div class="flight-detail-route">${esc(flight.from)} → ${esc(operationalDestination)}</div>
        <div class="tiny muted">${esc(status)}</div>
      </div>
      <button class="flight-detail-close" type="button" data-close-flight-details aria-label="Close flight details">×</button>
    </div>
    ${operationalDestination!==flight.to?`<div class="issue-badge delay">Diverted · planned destination ${flight.to}</div>`:''}
    ${problemAnchors}
    ${incidentContextMarkup(flightIncidents,t)}
    ${flightControlsMarkup(flight)}
    <div id="flight-section-overview" class="flight-summary-grid">
      <div><span>Scheduled</span><b title="${formatTime(flight.departure)} → ${formatTime(flight.arrival)}">${shortClock(flight.departure)}–${shortClock(flight.arrival)}</b></div>
      <div><span>Expected</span><b title="${formatTime(flightActualDeparture(flight))} → ${formatTime(flightActualArrival(flight))}">${shortClock(flightActualDeparture(flight))}–${shortClock(flightActualArrival(flight))}</b></div>
      <div><span>Delay</span><b class="${depDelay||arrDelay?'delay-text':''}" title="${esc(delayDetail)}">${depDelay||arrDelay?`+${Math.max(depDelay,arrDelay)}m${delayCause?` · ${esc(delayCause)}`:''}${delays.length>1?` +${delays.length-1}`:''}`:'On time'}</b></div>
      <div><span>Readiness</span><b><span class="readiness-state ${readiness.overall}">${readinessLabel}</span></b></div>
    </div>
    <button id="flight-section-aircraft" class="context-object-link" type="button" data-open-context-aircraft="${esc(ac.id)}"><span>Assigned aircraft</span><b>${esc(ac.tail)} · ${esc(ac.model)}</b><span aria-hidden="true">›</span></button>
    ${dispatchDetailsMarkup(flight,ac)}
    ${groundOperationsMarkup(flight,t,{showActions:true})}
    ${flight.flightType==='ferry'?'':`<section class="flight-detail-section"><div class="flight-detail-section-heading"><span>Passengers &amp; cabin</span><b>${flight.pax}/${configuredSeats} · ${Math.round(flight.load*100)}%</b></div><div class="flight-detail-section-body">
      ${Object.entries(CABIN_CLASSES).map(([className,config])=>{
        const seats=cabin[className]||0,pax=flight.classPax?.[className]||0;
        return seats?`<div class="row-between"><span>${config.label}</span><b>${pax}/${seats} · ${Math.round(pax/seats*100)}%</b></div>`:'';
      }).join('')}
      ${flightPersonnelTransferCount(flight.id)?`<div class="row-between"><span>Positioning personnel</span><b>${flightPersonnelTransferCount(flight.id)}</b></div>`:''}
    </div></section>`}
    ${passengerConnectionsMarkup(flight)}
    <section id="flight-section-fuel" class="flight-detail-section"><div class="flight-detail-section-heading"><span>Fuel</span><b>${flight.fueled?'Onboard':'Planned'}</b></div><div class="flight-detail-section-body">
      <div class="row-between"><span>Uplift</span><b>${fuelGallons?`${num(fuelGallons)} US gal`:'None'}</b></div>
      <div class="row-between"><span>Onboard → arrival</span><b>${num(fuelOnboard)} → ${num(fuelAfterFlight)} US gal</b></div>
      <div class="row-between"><span>Tank capacity</span><b>${num(fuelPlan.fuelCapacityGal)} US gal</b></div>
    </div></section>
    ${aircraftRecovery&&!service?`<section id="flight-section-operation" class="flight-detail-section"><div class="flight-detail-section-heading"><span>Aircraft recovery</span><b>Substitution available</b></div><div class="flight-detail-section-body"><div class="context-section-action"><div><b>${esc(aircraftRecovery.label)}</b><span>${esc(aircraftRecovery.detail)}</span></div><button class="btn good" type="button" data-apply-recovery="use-spare" data-recovery-flight="${esc(flight.id)}">Apply</button></div></div></section>`:''}
    ${service?`<section id="flight-section-schedule" class="flight-detail-section"><div class="flight-detail-section-heading"><span>Aircraft &amp; schedule</span><b>${esc(service.id)}</b></div><div class="flight-detail-section-body">
      <div class="row-between"><span>Rotation</span><b>${esc(service.from)} ↔ ${esc(service.to)}</b></div>
      <div class="row-between"><span>Repeat</span><b>${esc(service.rule)}</b></div>
      ${flightSwitchMarkup(flight)}
      <div class="schedule-management-box"><button id="removeScheduleBtn" class="btn bad full" type="button">Remove ${esc(service.id)} schedule</button></div>
    </div></section>`:''}
  </div>`;
}

function refreshFlightDetails(force=false){
  if(!flightDetailsPane||!flightDetailsMeta) return;
  if(flightDetailsPane.contains(document.activeElement)&&document.activeElement.matches('select,input,textarea')) return;
  const flight=selectedFlightId?state.flights.find(item=>item.id===selectedFlightId):null;
  const ac=flight?state.aircraft.find(item=>item.id===flight.aircraftId):null;
  const signature=flight&&ac?[
    flight.id,statusOfFlight(flight,simNow()),flightActualDeparture(flight),flightActualArrival(flight),flightIssueKey(flight),
    flight.fueled?1:0,flight.settled?1:0,flight.cancelled?1:0,flight.diversionAirport||'',ac.id,ac.location,ac.condition,ac.fuelGallons,
    (ac.melItems||[]).map(item=>`${item.id}:${item.status}:${item.remainingCycles}`).join(','),
    operationalCaseSignature(state.incidents.filter(incident=>incident.status==='open'&&incident.flightId===flight.id)),
    state.aircraft.map(item=>`${item.id}:${item.location}:${item.defectUntil}`).join(',')
  ].join('|'):'empty';
  if(!force&&signature===flightDetailsSignature) return;
  flightDetailsSignature=signature;
  if(!flight||!ac){
    if(selectedAircraftId) return;
    flightDetailsPane.hidden=false;
    aircraftDetailsPane.hidden=true;
    flightDetailsMeta.textContent='Network overview';
    const now=simNow();
    const airborne=state.flights.filter(item=>!item.cancelled&&statusOfFlight(item,now)==='airborne').length;
    const upcoming=state.flights.filter(item=>!item.cancelled&&!item.settled&&flightActualDeparture(item)>now&&flightActualDeparture(item)<now+24*HOUR).length;
    const incidents=state.incidents.filter(item=>item.status==='open').length;
    flightDetailsPane.innerHTML=`<div class="context-overview">
      <div class="context-overview-heading"><span aria-hidden="true">⌖</span><div><b>Network overview</b><small>Select a flight or aircraft for its complete operational context.</small></div></div>
      <div class="context-overview-metrics"><div><span>Airborne</span><b>${airborne}</b></div><div><span>Next 24 h</span><b>${upcoming}</b></div><div><span>Open issues</span><b>${incidents}</b></div></div>
      <div class="context-overview-hint">Use Flight operations, My aircraft, the map, or the schedule to open a work item here.</div>
    </div>`;
    return;
  }
  flightDetailsPane.hidden=false;
  aircraftDetailsPane.hidden=true;
  flightDetailsMeta.textContent=`${flight.id} · ${statusOfFlight(flight,simNow())}`;
  flightDetailsPane.innerHTML=flightDetailsMarkup(flight,ac,simNow());
  flightDetailsPane.querySelector('[data-close-flight-details]')?.addEventListener('click',clearSelectedFlight);
  flightDetailsPane.querySelector('[data-open-context-aircraft]')?.addEventListener('click',()=>settleSelected(ac.id));
  flightDetailsPane.querySelectorAll('[data-flight-anchor]').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();
    flightDetailsPane.querySelector(`#${link.dataset.flightAnchor}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  bindIncidentResponseControls(flightDetailsPane);
  bindFlightSwitchControls(flight,flightDetailsPane);
}

function refreshAircraftDetails(force=false){
  if(!aircraftDetailsPane||!aircraftDetailsMeta) return;
  const ac=selectedAircraftId&&!selectedFlightId?state.aircraft.find(item=>item.id===selectedAircraftId):null;
  const signature=ac?[
    ac.id,ac.location,ac.condition,ac.flightHours,ac.cycles,ac.fuelGallons,ac.defectUntil,ac.defectReason,
    (ac.melItems||[]).map(item=>`${item.id}:${item.status}:${item.remainingCycles}`).join(','),
    Management.maintenanceStatus(ac,simNow()).label,
    state.flights.filter(f=>f.aircraftId===ac.id&&!f.cancelled&&!f.settled).map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}`).join(','),
    operationalCaseSignature(state.incidents.filter(incident=>incident.status==='open'&&(incident.aircraftId===ac.id||state.flights.find(f=>f.id===incident.flightId)?.aircraftId===ac.id)))
  ].join('|'):'empty';
  if(!force&&signature===aircraftDetailsSignature) return;
  aircraftDetailsSignature=signature;
  if(!ac){
    aircraftDetailsPane.hidden=true;
    return;
  }
  flightDetailsPane.hidden=true;
  aircraftDetailsPane.hidden=false;
  aircraftDetailsMeta.textContent=`${ac.tail} · ${aircraftIsDefective(ac,simNow())?'Unavailable':'Selected'}`;
  aircraftDetailsPane.innerHTML=aircraftDetailsMarkup(ac,simNow());
  aircraftDetailsPane.querySelector('[data-close-aircraft-details]')?.addEventListener('click',clearSelectedAircraft);
  aircraftDetailsPane.querySelectorAll('[data-aircraft-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.aircraftFlight)));
  aircraftDetailsPane.querySelectorAll('[data-incident-context-flight]').forEach(button=>button.addEventListener('click',()=>settleSelectedFlight(button.dataset.incidentContextFlight)));
  bindIncidentResponseControls(aircraftDetailsPane);
  aircraftDetailsPane.querySelector('[data-release-aircraft]')?.addEventListener('click',()=>releaseAircraft(ac.id));
}

function refreshFleetList(){
  const t=simNow();
  const el=document.getElementById('aircraftList');
  const focusedControl=el.contains(document.activeElement) &&
    document.activeElement.matches('input, select, button, textarea');
  if(focusedControl) return;
  const operationsByAircraft=new Map(state.aircraft.map(ac=>[ac.id,{active:null,upcoming:null}]));

  // Build current/next-flight lookups in one pass. Fleet rendering therefore
  // scales with aircraft + flights instead of scanning every flight per aircraft.
  for(const flight of state.flights){
    if(flight.cancelled) continue;
    const ops=operationsByAircraft.get(flight.aircraftId);
    if(!ops) continue;
    const departure=flightActualDeparture(flight),arrival=flightActualArrival(flight);
    if(departure<=t && t<arrival) ops.active=flight;
    else if(departure>t && (!ops.upcoming || departure<flightActualDeparture(ops.upcoming))) ops.upcoming=flight;
  }

  const rows=state.aircraft.map(ac=>{
    const ops=operationsByAircraft.get(ac.id);
    return {ac,active:ops?.active||null,upcoming:ops?.upcoming||null,defective:aircraftIsDefective(ac,t)};
  });
  document.getElementById('aircraftListCount').textContent=rows.length;
  if(!rows.length){
    el.innerHTML='<div class="empty">No aircraft assigned.</div>';
    return;
  }
  el.innerHTML=rows.map(({ac,active,upcoming,defective})=>{
    const p=active?flightProgress(active,t):0;
    const relevantFlight=active||upcoming;
    const relevantReadiness=relevantFlight?readinessForFlight(relevantFlight,ac,t):null;
    const maintenance=Management.maintenanceStatus(ac,t);
    const aircraftIncidents=state.incidents.filter(incident=>incident.status==='open'&&(incident.aircraftId===ac.id||state.flights.find(f=>f.id===incident.flightId)?.aircraftId===ac.id));
    const problemLabels=aircraftIncidents.map(incident=>INCIDENT_DEFINITIONS[incident.type]?.title||incident.type);
    const activeMel=(ac.melItems||[]).filter(item=>['open','expired'].includes(item.status));
    if(activeMel.length) problemLabels.push(activeMel.some(item=>item.status==='expired')?'Expired MEL':`${activeMel.length} MEL restriction${activeMel.length===1?'':'s'}`);
    if(defective) problemLabels.push(ac.defectReason||'Technical defect');
    if(maintenance.grounding) problemLabels.push(maintenance.label);
    if(relevantFlight) problemLabels.push(...flightProblemLabels(relevantFlight,relevantReadiness));
    const conciseProblemLabels=[...new Set(problemLabels)].slice(0,3);
    const hasProblem=conciseProblemLabels.length>0;
    const status=active?'airborne':defective?'defect':'ground';
    const dotClass=active?'active':'';
    const route=active
      ? `${active.from} → ${active.to}`
      : upcoming
        ? `Next ${upcoming.from} → ${upcoming.to}`
        : `At ${ac.location}`;
    const detail=active
      ? `${active.id} · ${Math.round(p*100)}% · ETA ${formatTime(flightActualArrival(active))}`
      : defective
        ? `At ${ac.location} · unavailable until ${formatTime(ac.defectUntil)}`
        : upcoming
          ? `At ${ac.location} · departs ${formatTime(flightActualDeparture(upcoming))}`
          : `At ${ac.location} · no flight assigned`;
    return `<div class="fleet-row ${selectedAircraftId===ac.id?'selected':''} ${defective?'defective':''} ${hasProblem?'has-problem':''}" data-aircraft-id="${ac.id}">
      <div class="fleet-summary" data-aircraft-toggle="${ac.id}" role="button" tabindex="0" aria-pressed="${selectedAircraftId===ac.id&&!selectedFlightId}">
        <div class="row-between"><span><b>${ac.tail}</b> <span class="tiny muted">${ac.model}</span></span><span class="tag"><span class="dot ${dotClass}"></span>${status}</span></div>
        ${problemBadgesMarkup(conciseProblemLabels)}
        <div class="route-code fleet-meta">${route}</div>
        <div class="tiny muted fleet-meta">${detail}</div>
        ${active?`<div class="progress" aria-label="Flight progress ${Math.round(p*100)} percent"><span style="width:${p*100}%"></span></div>`:''}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-aircraft-id]').forEach(card=>{
    card.addEventListener('click',()=>toggleAircraftCard(card.dataset.aircraftId));
  });
  el.querySelectorAll('[data-aircraft-toggle]').forEach(summary=>{
    const toggle=()=>toggleAircraftCard(summary.dataset.aircraftToggle);
    summary.addEventListener('keydown',event=>{
      if(event.key!=='Enter' && event.key!==' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

function refreshAircraftMarket(){
  const list=document.getElementById('aircraftMarketList');
  const models=Object.entries(MODELS);
  list.innerHTML=models.map(([name,m])=>{
    const label=name.toLowerCase().startsWith(String(m.manufacturer).toLowerCase())?name:`${m.manufacturer} ${name}`;
    const supply=resourceAvailability('aircraft',name,state.home);
    return `<div class="card market-aircraft-card" data-capacity="${m.seats}" data-model="${name}">
    <div class="row-between">
      <div><b>${label}</b><div class="tiny muted">${m.segment||'Passenger aircraft'}</div></div>
      <span class="tag ${supply.available?'':'warn'}">${esc(supply.available?`${supply.available} available`:supply.label)}</span>
    </div>
    <div class="market-specs">
      <span>${num(m.seats)} economy-seat units</span><span>${num(m.maxRangeKm)} km range</span><span>${num(m.speedKmh)} km/h</span>
    </div>
    <div class="cabin-config">
      <div class="row-between"><label>First class</label><b><span data-cabin-first-value>0</span> seats</b></div>
      <input data-cabin-first type="range" min="0" max="${Math.floor(m.seats/3)}" value="0" step="1" />
      <div class="row-between"><label>Business class</label><b><span data-cabin-business-value>0</span> seats</b></div>
      <input data-cabin-business type="range" min="0" max="${Math.floor(m.seats/2)}" value="0" step="1" />
      <div class="row-between cabin-economy"><span>Economy class</span><b><span data-cabin-economy>${m.seats}</span> seats</b></div>
      <div class="tiny muted">Space use: economy 1 · business 2 · first 3</div>
    </div>
    <button class="btn good full" data-request-aircraft="${name}" type="button" style="margin-top:8px">Request aircraft</button>
  </div>`;
  }).join('');
}

function aircraftSwitchMarkup(){ return ''; }
function bindAircraftSwitchControls(){}

function flightSwitchMarkup(f){
  if(!f || !f.serviceId) return '';
  const {service,outbound}=rotationForFlight(f);
  if(!service || !outbound) return '';

  if(outbound.fueled){
    return `<div class="aircraft-switch-box">
      <div class="title">Aircraft replacement</div>
      <div class="tiny muted" style="margin-top:6px">Unavailable after fueling.</div>
    </div>`;
  }

  if(flightActualDeparture(outbound)<=simNow()){
    return `<div class="aircraft-switch-box">
      <div class="title">Aircraft replacement</div>
      <div class="tiny muted" style="margin-top:6px">Unavailable after departure.</div>
    </div>`;
  }

  const candidates=rotationReplacementCandidates(f);
  if(!candidates.length){
    return `<div class="aircraft-switch-box">
      <div class="title">Switch aircraft for this flight</div>
      <div class="tiny muted" style="margin-top:6px">No suitable spare at ${service.from}.</div>
    </div>`;
  }

  const options=candidates.map(a=>`<option value="${a.id}">${a.tail} · ${a.model} · at ${a.location}</option>`).join('');
  return `<div class="aircraft-switch-box">
    <div class="title">Switch aircraft for this flight</div>
    <div class="tiny muted" style="margin-top:4px">${service.id} · recurring ${service.from} ↔ ${service.to}</div>
    <select id="flightReplacementAircraft" aria-label="Replacement aircraft">${options}</select>
    <div class="aircraft-switch-actions">
      <button id="flightSubRoundTripBtn" class="btn" type="button">Sub this round trip</button>
      <button id="flightPermanentChangeBtn" class="btn good" type="button">Change future schedule</button>
    </div>
  </div>`;
}

function bindFlightActionControls(f,root=document){
  if(!f) return;
  root.querySelectorAll(`[data-recovery-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>applyRecoveryPlan(f.id,button.dataset.applyRecovery)));
  root.querySelectorAll(`[data-delay-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>delayFlight(f.id,15)));
  root.querySelectorAll(`[data-priority-fuel="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>prioritizeFuel(f.id)));
  root.querySelectorAll(`[data-acknowledge-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>acknowledgeFlightIssue(f.id)));
  root.querySelectorAll(`[data-cancel-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>cancelFlight(f.id)));
}

function bindFlightSwitchControls(f,root=document){
  if(!f) return;
  bindFlightActionControls(f,root);
  if(!f.serviceId) return;
  const removeBtn=root.querySelector('#removeScheduleBtn');
  if(removeBtn) removeBtn.addEventListener('click',()=>{
    removeBtn.blur();
    confirmCancelService(f.serviceId);
  });
  const select=root.querySelector('#flightReplacementAircraft');
  const subBtn=root.querySelector('#flightSubRoundTripBtn');
  const permanentBtn=root.querySelector('#flightPermanentChangeBtn');
  if(subBtn && select) subBtn.addEventListener('click',()=>substituteSelectedRotation(f.id,select.value));
  if(permanentBtn && select) permanentBtn.addEventListener('click',()=>{
    const service=state.services.find(s=>s.id===f.serviceId);
    if(service) changeServiceAircraft(service.id,select.value);
  });
}


function scheduleWindow(){
  const now=simNow();
  const anchor=new Date(now);
  anchor.setMinutes(0,0,0);
  const start=anchor.getTime()+scheduleWindowOffsetHours*HOUR;
  return {start,end:start+scheduleRangeHours*HOUR,now};
}

function alignScheduleWindowToFlight(flight){
  if(!flight) return;
  const {start,end}=scheduleWindow();
  const departure=flightActualDeparture(flight),arrival=flightActualArrival(flight);
  if(arrival>start&&departure<end) return;
  const anchor=new Date(simNow());
  anchor.setMinutes(0,0,0);
  scheduleWindowOffsetHours=Math.floor((departure-anchor.getTime())/HOUR)-2;
}

function scrollSelectedScheduleFlightIntoView(){
  const block=document.querySelector('#schedule-board .flight-block.selected');
  const scroll=document.getElementById('schedule-scroll');
  const row=block?.closest('.sched-aircraft-row');
  if(!block||!scroll||!row) return;
  const left=Math.max(0,block.offsetLeft+122-scroll.clientWidth/2+block.offsetWidth/2);
  const top=Math.max(0,row.offsetTop-scroll.clientHeight/2+row.offsetHeight/2);
  scroll.scrollTo({left,top,behavior:'smooth'});
}

function shortClock(ms){
  return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
}
function shortDay(ms){
  return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(ms));
}
function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function refreshScheduleTimeline(force=false){
  const board=document.getElementById('schedule-board');
  if(!board) return;

  const {start,end,now}=scheduleWindow();
  const pxPerHour=scheduleRangeHours===24?84:48;
  const timeWidth=Math.round(scheduleRangeHours*pxPerHour);
  const labelWidth=122;

  const relevant=state.flights
    .filter(f=>flightActualArrival(f)>start && flightActualDeparture(f)<end)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));

  const signature=[
    Math.floor(start/MIN),
    scheduleRangeHours,
    selectedFlightId||'',
    selectedAircraftId||'',
    relevant.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.settled?1:0}:${f.aircraftId}:${f.slotMissed?1:0}:${f.assignedSlot||0}:${f.slotDelayMin||0}`).join(','),
    state.aircraft.map(a=>a.id).join(',')
  ].join('|');

  // Rebuild at most when the visible flight geometry/state changes. The now-line moves separately.
  if(force || signature!==lastScheduleSignature){
    lastScheduleSignature=signature;

    let html='<div class="sched-header-row">';
    html+='<div class="sched-label"><b>Aircraft</b></div>';
    html+=`<div class="sched-timearea" style="width:${timeWidth}px">`;

    for(let h=0;h<=scheduleRangeHours;h++){
      const ts=start+h*HOUR;
      const left=h*pxPerHour;
      const major=(new Date(ts).getHours()%6===0);
      html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      if(h<scheduleRangeHours && (scheduleRangeHours===24 || h%2===0)){
        html+=`<span class="sched-time-label" style="left:${left}px">${shortClock(ts)}</span>`;
      }
      if(new Date(ts).getHours()===0){
        html+=`<span class="sched-day-label" style="left:${left}px"></span>`;
      }
    }
    html+='<div id="scheduleNowHeader" class="now-label" style="display:none">NOW</div>';
    html+='</div></div>';

    for(const ac of state.aircraft){
      const flights=relevant.filter(f=>f.aircraftId===ac.id).sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
      const selectedRow=flights.some(f=>f.id===selectedFlightId);
      html+=`<div class="sched-aircraft-row ${selectedRow?'selected-row':''}" data-sched-aircraft="${esc(ac.id)}">`;
      html+=`<div class="sched-label"><div class="sched-tail">${esc(ac.tail)}</div><div class="sched-model">${esc(ac.model)}</div></div>`;
      html+=`<div class="sched-timearea" style="width:${timeWidth}px">`;

      for(let h=0;h<=scheduleRangeHours;h++){
        const ts=start+h*HOUR;
        const left=h*pxPerHour;
        const major=(new Date(ts).getHours()%6===0);
        html+=`<span class="sched-gridline ${major?'major':''}" style="left:${left}px"></span>`;
      }

      for(let i=0;i<flights.length;i++){
        const f=flights[i];
        const actualDep=flightActualDeparture(f), actualArr=flightActualArrival(f);
        const clippedStart=Math.max(start,actualDep), clippedEnd=Math.min(end,actualArr);
        const left=((clippedStart-start)/HOUR)*pxPerHour, width=Math.max(6,((clippedEnd-clippedStart)/HOUR)*pxPerHour);
        const st=statusOfFlight(f,now), selected=selectedFlightId===f.id?' selected':'';
        const depDelay=flightTotalDepartureDelayMin(f);
        const operationalDestination=flightOperationalDestination(f);
        const title=`${f.id} ${f.from} → ${operationalDestination}${operationalDestination!==f.to?` (planned ${f.to})`:''} | scheduled ${formatTime(f.departure)} | actual ${formatTime(actualDep)} – ${formatTime(actualArr)}${depDelay?` | +${depDelay}m departure delay`:''}`;

        // Departure slot markers. Planned slot is always shown; a missed slot gets
        // a red marker plus an amber marker at the reassigned slot.
        const plannedSlot=f.departure;
        if(plannedSlot>=start && plannedSlot<=end){
          const slotLeft=((plannedSlot-start)/HOUR)*pxPerHour;
          const plannedSlotTitle=f.slotMissed
            ? `${f.from} planned slot ${shortClock(plannedSlot)} — MISSED`
            : `${f.from} departure slot ${shortClock(plannedSlot)} · grace ${AIRPORT_OPS[f.from]?.graceMin||10} min`;
          html+=`<span class="slot-marker planned ${f.slotMissed?'missed':''}" data-slot-flight="${esc(f.id)}" style="left:${slotLeft}px"
            title="${esc(plannedSlotTitle)}"><span class="slot-label">${f.slotMissed?'MISSED':'SLOT'}</span></span>`;
        }

        if(f.slotMissed && f.assignedSlot && f.assignedSlot>=start && f.assignedSlot<=end){
          const newSlotLeft=((f.assignedSlot-start)/HOUR)*pxPerHour;
          const newSlotTitle=`${f.from} reassigned departure slot ${shortClock(f.assignedSlot)} · ${f.slotDelayMin||0} min slot wait`;
          html+=`<span class="slot-marker reassigned" data-slot-flight="${esc(f.id)}" style="left:${newSlotLeft}px"
            title="${esc(newSlotTitle)}"><span class="slot-label">NEW ${shortClock(f.assignedSlot)}</span></span>`;
        }

        if(depDelay>0 || actualArr!==f.arrival){
          const plannedStart=Math.max(start,f.departure), plannedEnd=Math.min(end,f.arrival);
          if(plannedEnd>plannedStart){
            const plannedLeft=((plannedStart-start)/HOUR)*pxPerHour;
            const plannedWidth=Math.max(6,((plannedEnd-plannedStart)/HOUR)*pxPerHour);
            html+=`<div class="planned-flight-block" style="left:${plannedLeft}px;width:${plannedWidth}px"
              title="${esc(`Planned ${formatTime(f.departure)} – ${formatTime(f.arrival)}`)}"></div>`;
          }
        }

        html+=`<div class="flight-block ${st}${selected}" data-flight-id="${esc(f.id)}" data-ac="${esc(f.aircraftId)}"
          title="${esc(title)}" style="left:${left}px;width:${width}px">
          <div class="flight-code">${esc(f.id)}${depDelay?` <span class="delay-text">+${depDelay}</span>`:''}</div>
          <div class="flight-route">${esc(f.from)} → ${esc(operationalDestination)}</div>
          ${depDelay>0 || actualArr!==f.arrival
            ? `<div class="flight-times"><span class="sched">S ${shortClock(f.departure)}–${shortClock(f.arrival)}</span> · <span class="actual">A ${shortClock(actualDep)}–${shortClock(actualArr)}</span></div>`
            : `<div class="flight-times">${shortClock(actualDep)}–${shortClock(actualArr)}</div>`}
        </div>`;

        const next=flights[i+1];
        if(next && flightActualDeparture(next)>actualArr){
          const gapStart=Math.max(start,actualArr);
          const gapEnd=Math.min(end,flightActualDeparture(next));
          if(gapEnd>gapStart){
            const connLeft=((gapStart-start)/HOUR)*pxPerHour;
            const connWidth=Math.max(3,((gapEnd-gapStart)/HOUR)*pxPerHour);
            const connectionAirport=flightOperationalDestination(f);
            const sameAirport=connectionAirport===next.from;
            const gap=flightActualDeparture(next)-actualArr;
            html+=`<span class="connection-line ${sameAirport?'':'mismatch'}" style="left:${connLeft}px;width:${connWidth}px"
              title="${sameAirport?'Turnaround / connection':'Location mismatch'}: ${connectionAirport} → ${next.from}, ${formatDuration(gap)}"></span>`;
            if(connWidth>50){
              html+=`<span class="connection-label" style="left:${connLeft+connWidth/2}px">${sameAirport?esc(connectionAirport)+' · ':''}${formatDuration(gap)}</span>`;
            }
          }
        }
      }

      html+=`<div class="now-line schedule-now-row" style="display:none"></div>`;
      html+='</div></div>';
    }

    if(!state.aircraft.length){
      html+='<div class="schedule-empty">No aircraft in fleet.</div>';
    }

    board.innerHTML=html;
    board.style.width=(labelWidth+timeWidth)+'px';

    board.querySelectorAll('.flight-block').forEach(el=>{
      el.addEventListener('click',()=>{
        settleSelectedFlight(el.dataset.flightId);
      });
    });
    board.querySelectorAll('[data-slot-flight]').forEach(el=>{
      el.addEventListener('click',e=>{
        e.stopPropagation();
        settleSelectedFlight(el.dataset.slotFlight);
      });
    });
    board.querySelectorAll('[data-sched-aircraft]').forEach(row=>{
      row.addEventListener('dblclick',()=>{
        settleSelected(row.dataset.schedAircraft);
      });
    });
    if(selectedFlightId) requestAnimationFrame(scrollSelectedScheduleFlightIntoView);
  }

  updateScheduleNowLine();
  document.getElementById('schedule-window-label').textContent=
    `${shortDay(start)} ${shortClock(start)}  →  ${shortDay(end)} ${shortClock(end)}`;
}

function updateScheduleNowLine(){
  const {start,end,now}=scheduleWindow();
  const pxPerHour=scheduleRangeHours===24?84:48;
  const x=((now-start)/HOUR)*pxPerHour;
  const visible=now>=start && now<=end;

  const header=document.getElementById('scheduleNowHeader');
  if(header){
    header.style.display=visible?'block':'none';
    header.style.left=x+'px';
  }
  document.querySelectorAll('.schedule-now-row').forEach(line=>{
    line.style.display=visible?'block':'none';
    line.style.left=x+'px';
  });
}

function centerScheduleOnNow(){
  scheduleWindowOffsetHours=-2;
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  const scroller=document.getElementById('schedule-scroll');
  if(scroller) scroller.scrollLeft=0;
}

function initWorkspaceSplitter(){
  const workspace=document.getElementById('center-workspace');
  const mapPane=document.getElementById('map-pane');
  const splitter=document.getElementById('workspace-splitter');

  const storedViewSplit=localStorage.getItem(`${SPLIT_KEY}_${activeWorkspaceView}`);
  const rawSplit=storedViewSplit??localStorage.getItem(SPLIT_KEY);
  let pct=rawSplit===null?NaN:Number(rawSplit);
  if(!Number.isFinite(pct)) pct=50;
  pct=clamp(pct,22,78);
  mapPane.style.flexBasis=pct+'%';
  splitter.setAttribute('aria-valuenow',String(Math.round(pct)));

  let dragging=false;

  const applyFromClientY=(clientY)=>{
    const rect=workspace.getBoundingClientRect();
    const splitterH=splitter.getBoundingClientRect().height||9;
    const usable=Math.max(1,rect.height-splitterH);
    const y=clamp(clientY-rect.top,usable*.22,usable*.78);
    const next=(y/usable)*100;
    mapPane.style.flexBasis=next+'%';
    splitter.setAttribute('aria-valuenow',String(Math.round(next)));
    localStorage.setItem(`${SPLIT_KEY}_${activeWorkspaceView}`,String(next));
    requestAnimationFrame(()=>{
      if(typeof map!=='undefined') map.invalidateSize({animate:false});
      refreshScheduleTimeline(false);
    });
  };

  splitter.addEventListener('pointerdown',e=>{
    dragging=true;
    splitter.classList.add('dragging');
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  splitter.addEventListener('pointermove',e=>{
    if(!dragging) return;
    applyFromClientY(e.clientY);
  });
  const endDrag=e=>{
    if(!dragging) return;
    dragging=false;
    splitter.classList.remove('dragging');
    try{splitter.releasePointerCapture(e.pointerId)}catch(_){}
    setTimeout(()=>map.invalidateSize({animate:false}),0);
  };
  splitter.addEventListener('pointerup',endDrag);
  splitter.addEventListener('pointercancel',endDrag);

  splitter.addEventListener('keydown',e=>{
    if(!['ArrowUp','ArrowDown','Home'].includes(e.key)) return;
    e.preventDefault();
    let current=parseFloat(mapPane.style.flexBasis)||50;
    if(e.key==='Home') current=50;
    else current+=e.key==='ArrowUp'?-3:3;
    current=clamp(current,22,78);
    mapPane.style.flexBasis=current+'%';
    splitter.setAttribute('aria-valuenow',String(Math.round(current)));
    localStorage.setItem(`${SPLIT_KEY}_${activeWorkspaceView}`,String(current));
    map.invalidateSize({animate:false});
  });

  restoreCenterSplitForView=()=>{
    let stored=Number(localStorage.getItem(`${SPLIT_KEY}_${activeWorkspaceView}`));
    if(!Number.isFinite(stored)||!stored) stored=50;
    stored=clamp(stored,22,78);
    mapPane.style.flexBasis=stored+'%';
    splitter.setAttribute('aria-valuenow',String(Math.round(stored)));
  };
}

function initSidebarSplitters(){
  const main=document.getElementById('main-layout');
  const leftSidebar=main.querySelector('.sidebar:not(.right)');
  const rightSidebar=main.querySelector('.sidebar.right');
  const configs=[
    {
      side:'left',splitter:document.getElementById('left-sidebar-splitter'),sidebar:leftSidebar,
      other:rightSidebar,baseKey:LEFT_SIDEBAR_SPLIT_KEY,cssVar:'--left-sidebar-width',defaultWidth:320
    },
    {
      side:'right',splitter:document.getElementById('right-sidebar-splitter'),sidebar:rightSidebar,
      other:leftSidebar,baseKey:RIGHT_SIDEBAR_SPLIT_KEY,cssVar:'--right-sidebar-width',defaultWidth:310
    }
  ];

  const applyWidth=(config,width,persist=true)=>{
    const mainWidth=main.getBoundingClientRect().width;
    const otherWidth=config.other.getBoundingClientRect().width;
    const maxWidth=Math.max(220,Math.min(520,mainWidth-otherWidth-420-18));
    const next=Math.round(clamp(width,220,maxWidth));
    main.style.setProperty(config.cssVar,next+'px');
    config.splitter.setAttribute('aria-valuenow',String(next));
    config.splitter.setAttribute('aria-valuemin','220');
    config.splitter.setAttribute('aria-valuemax',String(Math.round(maxWidth)));
    if(persist) localStorage.setItem(`${config.baseKey}_${activeWorkspaceView}`,String(next));
    requestAnimationFrame(()=>{
      if(typeof map!=='undefined') map.invalidateSize({animate:false});
      refreshScheduleTimeline(false);
    });
  };

  for(const config of configs){
    const viewStored=localStorage.getItem(`${config.baseKey}_${activeWorkspaceView}`);
    const legacyStored=localStorage.getItem(config.baseKey);
    const rawStored=viewStored??legacyStored;
    const stored=rawStored===null?NaN:Number(rawStored);
    const cssWidth=parseFloat(getComputedStyle(main).getPropertyValue(config.cssVar));
    applyWidth(config,Number.isFinite(stored)?stored:(cssWidth||config.defaultWidth),false);

    let dragging=false;
    config.splitter.addEventListener('pointerdown',e=>{
      dragging=true;
      config.splitter.classList.add('dragging');
      config.splitter.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    config.splitter.addEventListener('pointermove',e=>{
      if(!dragging) return;
      const rect=main.getBoundingClientRect();
      const width=config.side==='left'?e.clientX-rect.left:rect.right-e.clientX;
      applyWidth(config,width);
    });
    const endDrag=e=>{
      if(!dragging) return;
      dragging=false;
      config.splitter.classList.remove('dragging');
      try{config.splitter.releasePointerCapture(e.pointerId)}catch(_){}
      setTimeout(()=>map.invalidateSize({animate:false}),0);
    };
    config.splitter.addEventListener('pointerup',endDrag);
    config.splitter.addEventListener('pointercancel',endDrag);
    config.splitter.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home'].includes(e.key)) return;
      e.preventDefault();
      const current=config.sidebar.getBoundingClientRect().width;
      const direction=config.side==='left'?1:-1;
      const next=e.key==='Home'?config.defaultWidth:current+(e.key==='ArrowRight'?10:-10)*direction;
      applyWidth(config,next);
    });
  }

  restoreSidebarWidthsForView=()=>{
    for(const config of configs){
      const stored=Number(localStorage.getItem(`${config.baseKey}_${activeWorkspaceView}`));
      applyWidth(config,Number.isFinite(stored)&&stored>0?stored:config.defaultWidth,false);
    }
  };

  window.addEventListener('resize',()=>{
    if(window.innerWidth<=880) return;
    for(const config of configs) applyWidth(config,config.sidebar.getBoundingClientRect().width,false);
  });
}


function refreshAll(){
  processEvents();
  recalculateOperations();
  refreshHeader();

  // State-changing refresh: update structural UI, but the functions themselves
  // still refuse to replace controls that are actively being edited.
  refreshAircraftSelect(true);
  refreshFleetList();
  refreshFlightDetails(true);
  refreshAircraftDetails(true);
  refreshSlotPortfolio(true);
  refreshPersonnel(true);
  refreshOccWidgets(true);
  refreshDepartmentWidgets(true);
  refreshManagementCycle(true);
  refreshMaintenance(true);
  refreshWeather(true);
  refreshAircraftMarket();
  refreshPersonnelRequestPreview();
  refreshSlotBuyPreview();
  refreshResourceRequestSummary(true);

  refreshKPIs();
  updateMapData();
  refreshScheduleTimeline(true);
}

populateAirports();
slotTimeEl.value='08:00';
refreshSlotBuyPreview();
{
  const d=new Date(simNow()+15*MIN);
  d.setSeconds(0,0);
  d.setMinutes(Math.ceil(d.getMinutes()/5)*5);
  departureTimeEl.value=hhmm(d.getTime());
}
document.getElementById('speed').value=String(state.clock.speed);
scheduleBtn.addEventListener('click',scheduleFlight);
requestSlotsBtn.addEventListener('click',requestRequiredScheduleSlots);
requestSlotBtn.addEventListener('click',requestSlotSeries);
document.getElementById('requestPersonnelBtn').addEventListener('click',()=>requestPersonnel(1));
document.getElementById('requestPersonnelFiveBtn').addEventListener('click',()=>requestPersonnel(5));
transferPersonnelBtn.addEventListener('click',createPersonnelTransfer);
incidentExerciseBtn.addEventListener('click',generateTrainingIncident);
personnelRoleEl.addEventListener('change',refreshPersonnelRequestPreview);
personnelAirportEl.addEventListener('change',refreshPersonnelRequestPreview);
personnelQualificationEl.addEventListener('change',refreshPersonnelRequestPreview);
[transferPersonnelRoleEl,transferPersonnelFromEl,transferPersonnelToEl,transferPersonnelMethodEl,transferPersonnelFlightEl].forEach(el=>el.addEventListener('change',refreshPersonnelTransferOptions));
transferPersonnelAmountEl.addEventListener('input',refreshPersonnelTransferOptions);
slotAirportEl.addEventListener('change',refreshSlotBuyPreview);
slotTimeEl.addEventListener('change',refreshSlotBuyPreview);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,destEl,departureTimeEl,repeatRuleEl,turnaroundEl].forEach(el=>{
  el.addEventListener('change',refreshSchedulePreview);
});
departureTimeEl.addEventListener('input',refreshSchedulePreview);
operatingDayEls.concat(operatingMonthEls).forEach(el=>el.addEventListener('change',refreshSchedulePreview));

aircraftEl.addEventListener('change',()=>{
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  if(ac){
    // Explicit aircraft choice: use its physical airport as the departure airport.
    // Never touch the destination field.
    originEl.value=ac.location;
  }
  refreshSchedulePreview();
});
refreshScheduleMode();
document.getElementById('speed').addEventListener('change',e=>{
  rebaseClock(Number(e.target.value));
  lastScheduleSignature='';
  refreshScheduleTimeline(true);
  refreshHeader();
  toast(e.target.value==='1'?'Realtime enabled.':'Test acceleration enabled.');
});
document.getElementById('schedulePrevBtn').addEventListener('click',()=>{
  scheduleWindowOffsetHours-=12; lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('scheduleNowBtn').addEventListener('click',centerScheduleOnNow);
document.getElementById('scheduleNextBtn').addEventListener('click',()=>{
  scheduleWindowOffsetHours+=12; lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('scheduleRange').addEventListener('change',e=>{
  scheduleRangeHours=Number(e.target.value)||24;
  workspaceUi.scheduleRanges??={occ:24};
  workspaceUi.scheduleRanges.occ=scheduleRangeHours;
  saveWorkspaceUi();
  lastScheduleSignature=''; refreshScheduleTimeline(true);
});
document.getElementById('resetBtn').addEventListener('click',()=>{
  if(window.confirm('Delete this local airline save? Your aircraft, flights, schedules and slot rights will be removed.')){
    resetLocalSave();
  }
});

recalculateOperations();
initWorkspaceSplitter();
initSidebarSplitters();
