/* AeroSim DOM references, rendering, event handlers, and resizable workspace layout. */

const scheduleTypeEl=document.getElementById('scheduleType');
const originEl=document.getElementById('origin');
const destEl=document.getElementById('destination');
const aircraftEl=document.getElementById('aircraft');
const departureTimeEl=document.getElementById('departureTime');
const fareEconomyEl=document.getElementById('fareEconomy');
const fareBusinessEl=document.getElementById('fareBusiness');
const fareFirstEl=document.getElementById('fareFirst');
const routeDemandPanel=document.getElementById('routeDemandPanel');
function currentScheduleFares(){ return normalizeFares({economy:fareEconomyEl.value,business:fareBusinessEl.value,first:fareFirstEl.value}); }
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
const acquireSlotsBtn=document.getElementById('acquireSlotsBtn');
const slotAirportEl=document.getElementById('slotAirport');
const slotTimeEl=document.getElementById('slotTime');
const buySlotBtn=document.getElementById('buySlotBtn');
const leftSidebarSearch=document.getElementById('leftSidebarSearch');
const aircraftMarketList=document.getElementById('aircraftMarketList');
const personnelList=document.getElementById('personnelList');
const personnelRoleEl=document.getElementById('personnelRole');
const personnelAirportEl=document.getElementById('personnelAirport');
const personnelHirePreview=document.getElementById('personnelHirePreview');
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
const recoveryAircraftEl=document.getElementById('recoveryAircraft');
const recoveryDestinationEl=document.getElementById('recoveryDestination');
const recoveryDepartureTimeEl=document.getElementById('recoveryDepartureTime');
const createRecoveryFlightBtn=document.getElementById('createRecoveryFlightBtn');

function saveWorkspaceUi(){ localStorage.setItem(WORKSPACE_UI_KEY,JSON.stringify(workspaceUi)); }
function updateWidgetHeaderLabel(widgetId,header,open){
  const meta=header.querySelector('.widget-meta.tiny');
  if(!meta) return;
  const labels={
    'flight-planner':open?'Close scheduler':'Open scheduler',
    'aircraft-market':open?'Close market':'Game prices',
    'slot-market':open?'Close market':'Open market'
  };
  if(labels[widgetId]) meta.textContent=labels[widgetId];
}
function setWidgetOpen(widget,open,{persist=false}={}){
  const widgetId=widget.dataset.widget,header=widget.querySelector(':scope > .widget-header');
  const body=header&&document.getElementById(header.getAttribute('aria-controls'));
  if(!header||!body) return;
  header.setAttribute('aria-expanded',String(open)); body.hidden=!open;
  updateWidgetHeaderLabel(widgetId,header,open);
  if(persist){
    workspaceUi.collapsed[activeWorkspaceView]??={};
    workspaceUi.collapsed[activeWorkspaceView][widgetId]=!open;
    saveWorkspaceUi();
  }
}
function applyWorkspaceView(view,{restoreWidths=true}={}){
  activeWorkspaceView=['planning','occ','all'].includes(view)?view:'planning';
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
  document.getElementById('workspaceContextLabel').textContent=activeWorkspaceView==='occ'?'OCC':activeWorkspaceView==='all'?'All':'Planning';
  scheduleRangeHours=Number(workspaceUi.scheduleRanges?.[activeWorkspaceView])||(activeWorkspaceView==='occ'?24:48);
  document.getElementById('scheduleRange').value=String(scheduleRangeHours);
  lastScheduleSignature='';
  document.body.dataset.workspaceView=activeWorkspaceView;
  saveWorkspaceUi();
  if(restoreWidths){ restoreSidebarWidthsForView(); restoreCenterSplitForView(); }
  refreshFleetList();
  refreshPersonnel(true);
  refreshOccWidgets(true);
  refreshManagementCycle(true);
  refreshPerformance(true);
  refreshMaintenance(true);
  refreshWeather(true);
  refreshRecoveryOptions(true);
  requestAnimationFrame(()=>{ map.invalidateSize({animate:false}); refreshScheduleTimeline(true); });
}

document.querySelectorAll('.sidebar-widget > .widget-header').forEach(header=>header.addEventListener('click',()=>{
  const widget=header.closest('.sidebar-widget');
  const open=header.getAttribute('aria-expanded')!=='true';
  setWidgetOpen(widget,open,{persist:true});
  if(open&&widget.dataset.widget==='flight-planner') requestAnimationFrame(()=>scheduleTypeEl.focus());
}));
document.querySelectorAll('[data-workspace-mode]').forEach(button=>button.addEventListener('click',()=>applyWorkspaceView(button.dataset.workspaceMode)));

leftSidebarSearch.addEventListener('input',()=>{
  clearTimeout(sidebarSearchTimer);
  sidebarSearchTimer=setTimeout(()=>{
    sidebarSearchTokens=normalizeSidebarSearch(leftSidebarSearch.value).trim().split(/\s+/).filter(Boolean).slice(0,8);
    refreshFleetList();
    refreshAircraftMarket();
  },120);
});

aircraftMarketList.addEventListener('click',e=>{
  const button=e.target.closest('[data-buy],[data-lease]');
  if(button && aircraftMarketList.contains(button)){
    const card=button.closest('.market-aircraft-card');
    const cabin={
      first:Number(card.querySelector('[data-cabin-first]').value)||0,
      business:Number(card.querySelector('[data-cabin-business]').value)||0,
      economy:Number(card.querySelector('[data-cabin-economy]').textContent)||0
    };
    if(button.dataset.buy) buyAircraft(button.dataset.buy,cabin);
    else leaseAircraft(button.dataset.lease,Number(card.querySelector('[data-lease-months]').value),cabin);
  }
});
aircraftMarketList.addEventListener('input',event=>{
  const leaseSlider=event.target.closest('[data-lease-months]');
  if(leaseSlider){
    const card=leaseSlider.closest('.market-aircraft-card');
    const months=Number(leaseSlider.value),modelName=card.dataset.model;
    card.querySelector('[data-lease-term-value]').textContent=`${months} months`;
    card.querySelector('[data-lease-fee]').textContent=`${money(leaseMonthlyFee(modelName,months))}/mo`;
    card.querySelector('[data-lease]').disabled=state.cash<leaseMonthlyFee(modelName,months);
    return;
  }
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

function refreshPersonnelHirePreview(){
  const role=personnelRoleEl.value,airport=personnelAirportEl.value,config=PERSONNEL[role];
  const cockpit=['captains','firstOfficers'].includes(role);
  personnelQualificationWrap.hidden=!cockpit;
  const rating=cockpit?` · ${personnelQualificationEl.value} rating`:'';
  personnelHirePreview.textContent=config?`${staffAt(airport,role)} currently based at ${airport}${rating} · ${money(config.salary)} per employee/month`:'';
}
function hirePersonnel(amount){
  const role=personnelRoleEl.value,airport=personnelAirportEl.value;
  if(!PERSONNEL[role]||!AIRPORTS[airport]) return;
  changeStaff(airport,role,amount);
  if(['captains','firstOfficers'].includes(role)) changeQualification(airport,role,personnelQualificationEl.value,amount);
  save(); refreshPersonnel(true); refreshPersonnelHirePreview();
  toast(`Hired ${amount} ${PERSONNEL[role].label.toLowerCase()} at ${airport}.`);
}

function populateAirports(){
  const opts=Object.values(AIRPORTS).map(a=>`<option value="${a.iata}">${a.iata} — ${a.name}</option>`).join('');
  originEl.innerHTML=opts; destEl.innerHTML=opts; slotAirportEl.innerHTML=opts; personnelAirportEl.innerHTML=opts;
  transferPersonnelFromEl.innerHTML=opts; transferPersonnelToEl.innerHTML=opts; recoveryDestinationEl.innerHTML=opts;
  const personnelOpts=Object.entries(PERSONNEL).map(([role,config])=>`<option value="${role}">${config.label}</option>`).join('');
  personnelRoleEl.innerHTML=personnelOpts; transferPersonnelRoleEl.innerHTML=personnelOpts;
  personnelQualificationEl.innerHTML=AIRCRAFT_FAMILIES.map(family=>`<option value="${family}">${family}</option>`).join('');
  originEl.value='FRA'; destEl.value='AMS'; slotAirportEl.value=state.home;
  personnelAirportEl.value=state.home;
  transferPersonnelFromEl.value=state.home;
  transferPersonnelToEl.value=Object.keys(AIRPORTS).find(code=>code!==state.home)||state.home;
  recoveryDestinationEl.value=Object.keys(AIRPORTS).find(code=>code!==state.home)||state.home;
  refreshPersonnelHirePreview();
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

function refreshRecoveryOptions(force=false){
  const previous=recoveryAircraftEl.value;
  const candidates=state.aircraft.filter(ac=>!aircraftActiveFlight(ac.id)&&!aircraftIsDefective(ac));
  const signature=candidates.map(ac=>`${ac.id}:${ac.location}:${ac.defectUntil}`).join('|');
  if((force||signature!==recoverySignature)&&document.activeElement!==recoveryAircraftEl){
    recoverySignature=signature;
    recoveryAircraftEl.innerHTML=candidates.length
      ? candidates.map(ac=>`<option value="${ac.id}">${ac.tail} · ${ac.model} · at ${ac.location}</option>`).join('')
      : '<option value="">No grounded aircraft available</option>';
    if(candidates.some(ac=>ac.id===previous)) recoveryAircraftEl.value=previous;
  }
  refreshRecoveryPreview();
}

function refreshRecoveryPreview(){
  const ac=state.aircraft.find(item=>item.id===recoveryAircraftEl.value);
  const destination=recoveryDestinationEl.value;
  const departure=nextTimestampForClock(recoveryDepartureTimeEl.value);
  const preview=document.getElementById('recoveryPreview');
  if(!ac||!departure){ preview.textContent='Choose a grounded aircraft and departure time.'; createRecoveryFlightBtn.disabled=true; return; }
  if(destination===ac.location){ preview.textContent='Choose an airport different from the aircraft’s current location.'; createRecoveryFlightBtn.disabled=true; return; }
  const estimate=estimateFerryFlight(ac.location,destination,ac,departure);
  const itinerary=validateAircraftItinerary(ac,[{from:ac.location,to:destination,departure,arrival:departure+estimate.duration,label:'recovery ferry'}]);
  const shortages=staffingShortagesForFlight(ac,departure,estimate.duration,ac.location,null,true,'ferry');
  const ready=estimate.rangeOk&&itinerary.ok&&!shortages.length;
  preview.innerHTML=`${ac.location} → ${destination} · ${formatDuration(estimate.duration)} · approximately <b>${money(estimate.costs)}</b>`+
    `<br><span class="money ${ready?'good':'bad'}">${!estimate.rangeOk?'out of range':!itinerary.ok?itinerary.reason:shortages.length?shortages.join(' · '):'aircraft and crew available'}</span>`;
  createRecoveryFlightBtn.disabled=!ready;
}

function createRecoveryFlight(){
  const ac=state.aircraft.find(item=>item.id===recoveryAircraftEl.value);
  const to=recoveryDestinationEl.value;
  const departure=nextTimestampForClock(recoveryDepartureTimeEl.value);
  if(!ac||!departure||to===ac.location) return toast('Choose a valid ferry flight.');
  const estimate=estimateFerryFlight(ac.location,to,ac,departure);
  const itinerary=validateAircraftItinerary(ac,[{from:ac.location,to,departure,arrival:departure+estimate.duration,label:'recovery ferry'}]);
  const shortages=staffingShortagesForFlight(ac,departure,estimate.duration,ac.location,null,true,'ferry');
  if(!estimate.rangeOk||!itinerary.ok||shortages.length) return toast(!estimate.rangeOk?'Aircraft is out of range.':!itinerary.ok?itinerary.reason:shortages.join(' · '));
  const f=createFlightRecord({aircraftId:ac.id,from:ac.location,to,departure,fare:0,flightType:'ferry'});
  selectedAircraftId=ac.id; selectedFlightId=f.id;
  save(); refreshAll(); toast(`${f.id} recovery ferry scheduled ${f.from} → ${f.to}.`);
}

function refreshScheduleMode(){
  const recurring=scheduleTypeEl.value==='recurring';
  recurringOptionsEl.style.display=recurring?'block':'none';
  scheduleBtn.textContent=recurring?'Create recurring schedule':'Schedule one-time flight';
  if(!recurring) acquireSlotsBtn.style.display='none';
  refreshSchedulePreview();
}

function combineEconomics(...items){
  const combined={};
  for(const item of items) for(const [key,value] of Object.entries(item||{}))
    if(key!=='operatingProfit' && key!=='totalCost') combined[key]=(combined[key]||0)+(Number(value)||0);
  combined.totalCost=flightEconomicsTotal(combined);
  combined.operatingProfit=(combined.ticketRevenue||0)-combined.totalCost;
  return combined;
}

function classRevenueMarkup(est,title='Estimated class demand'){
  return `<div class="class-revenue-preview"><div class="estimate-title">${title}</div>${Object.entries(CABIN_CLASSES).map(([className,config])=>{
    const seats=est.cabin?.[className]??est.classSeats?.[className]??0;
    const pax=est.classPax?.[className]||0,fare=est.fares?.[className]||0;
    return seats?`<div class="row-between"><span>${config.label} · ${pax}/${seats} seats</span><b>${money(pax*fare)}</b></div>`:'';
  }).join('')}</div>`;
}

function estimateBreakdownMarkup({revenue,baseCosts,fuelCost,costs,profit,fuelGallons,economics},title){
  const costRows=economics?[
    ['Airport fees',(economics.landingFees||0)+(economics.passengerFees||0)],
    ['Ground handling',economics.groundHandling],['Navigation',economics.navigation],
    ['CO₂ / emissions',economics.emissions],['Maintenance reserve',economics.maintenanceReserve],
    ['Weather operations',economics.weatherOps],
    ['Insurance & parking',(economics.insurance||0)+(economics.parking||0)]
  ].filter(([,value])=>value):[['Base operating costs',baseCosts]];
  return `<div class="estimate-box">
    <div class="estimate-title">${title}</div>
    <div class="row-between"><span>Possible ticket income</span><b class="money good">${money(revenue)}</b></div>
    ${costRows.map(([label,value])=>`<div class="row-between"><span>${label}</span><b>${money(value)}</b></div>`).join('')}
    <div class="row-between"><span>Fuel at current price${fuelGallons?` · ${num(fuelGallons)} gal`:''}</span><b>${money(fuelCost)}</b></div>
    <div class="row-between estimate-total"><span>Estimated total costs</span><b class="money bad">${money(costs)}</b></div>
    <div class="row-between"><span>Possible operating result</span><b class="money ${profit>=0?'good':'bad'}">${money(profit)}</b></div>
    <div class="tiny muted">Estimate only. Actual income depends on the passenger-demand roll; fuel uses the market price when the flight is fueled. Slot-right purchases are excluded.</div>
  </div>`;
}

function flightEconomicsMarkup(f,plannedFuelCost=0){
  if(!f.economics) return '';
  const e={...f.economics};
  if(!f.fueled) e.fuel=plannedFuelCost;
  const total=flightEconomicsTotal(e),profit=(e.ticketRevenue||f.revenue)-total;
  const rows=[
    ['Fuel',e.fuel],['Airport landing',e.landingFees],['Passenger & security',e.passengerFees],
    ['Ground handling',e.groundHandling],['Navigation',e.navigation],['CO₂ / emissions',e.emissions],
    ['Maintenance reserve',e.maintenanceReserve],['Unscheduled repair',e.unscheduledMaintenance],
    ['Weather operations',e.weatherOps],
    ['Insurance',e.insurance],['Parking',e.parking],['Legacy operating',e.legacyOperating]
  ].filter(([,value])=>Number(value)>0);
  return `<div class="estimate-box flight-economics">
    <div class="estimate-title">${f.settled?'Actual flight economics':'Current flight estimate'}</div>
    <div class="row-between"><span>Ticket revenue</span><b class="money good">${money(e.ticketRevenue||f.revenue)}</b></div>
    ${rows.map(([label,value])=>`<div class="row-between"><span>${label}</span><b>${money(value)}</b></div>`).join('')}
    <div class="row-between estimate-total"><span>Total operating costs</span><b class="money bad">${money(total)}</b></div>
    <div class="row-between"><span>Operating result</span><b class="money ${profit>=0?'good':'bad'}">${money(profit)}</b></div>
    <div class="tiny muted">Personnel payroll and slot acquisition are company-level costs and are not allocated to this flight.</div>
  </div>`;
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
      <div class="tiny muted">Daily pool ${estimate.demand.classes[className].market} · remaining ${estimate.demand.classes[className].remaining} · typical fare ${money(baseFare)} · yours ${money(estimate.fares[className])}</div>
      <div class="tiny muted">Projected class income ${money(passengers*estimate.fares[className])}</div>
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
  const ac=state.aircraft.find(a=>a.id===aircraftEl.value);
  if(!ac){
    acquireSlotsBtn.style.display='none';
    routeDemandPanel.innerHTML='<div class="demand-empty">Select an aircraft to inspect route demand.</div>';
    document.getElementById('schedulePreview').textContent='No aircraft available.';
    return;
  }
  const from=originEl.value,to=destEl.value,fares=currentScheduleFares();
  if(from===to){
    routeDemandPanel.innerHTML='<div class="demand-empty">Choose two different airports to compare demand.</div>';
    document.getElementById('schedulePreview').textContent='Choose two different airports.';
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
  const out=estimateFlight(from,to,ac,fares,{departure:firstDeparture||simNow(),availableFuelGallons:ac.fuelGallons||0});
  routeDemandPanel.innerHTML=routeDemandIntelligenceMarkup(from,to,ac,firstDeparture||simNow(),out);
  const rangeWarning=out.rangeOk?'':' · <span class="money bad">OUT OF RANGE</span>';
  const firstText=firstDeparture?` · first dep <b>${formatTime(firstDeparture)}</b>`:'';

  if(scheduleTypeEl.value==='once'){
    const itinerary=validateAircraftItinerary(ac,[{from,to,departure:firstDeparture,arrival:firstDeparture+out.duration,label:'new flight'}]);
    acquireSlotsBtn.style.display='none';
    document.getElementById('schedulePreview').innerHTML =
      `${num(out.km)} km · ${formatDuration(out.duration)} · load <b>${Math.round(out.load*100)}%</b>`+
      `${firstText}${rangeWarning}`+
      ` · <span class="money ${itinerary.ok?'good':'bad'}">${itinerary.ok?'fits aircraft itinerary':itinerary.reason}</span>`+
      classRevenueMarkup({...out,cabin:cabinForAircraft(ac)})+
      estimateBreakdownMarkup(out,'Estimated one-way economics');
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
  const roundNet=out.profit+back.profit;
  const roundEstimate={
    revenue:out.revenue+back.revenue,
    baseCosts:out.baseCosts+back.baseCosts,
    fuelGallons:out.fuelGallons+back.fuelGallons,
    fuelCost:out.fuelCost+back.fuelCost,
    costs:out.costs+back.costs,
    profit:roundNet,
    economics:combineEconomics(out.economics,back.economics)
  };
  const roundClassEstimate={
    classSeats:Object.fromEntries(Object.entries(cabinForAircraft(ac)).map(([className,seats])=>[className,seats*2])),fares,
    classPax:Object.fromEntries(Object.keys(CABIN_CLASSES).map(className=>[className,(out.classPax[className]||0)+(back.classPax[className]||0)]))
  };

  let slotHtml='',missingCost=0;
  if(plan){
    const p1=plan.originRight?0:slotSeriesPrice(from,plan.outboundDeparture);
    const p2=plan.destinationRight?0:slotSeriesPrice(to,plan.returnDeparture);
    missingCost=p1+p2;
    slotHtml=`<div style="margin-top:7px">
      <span class="slot-chip ${plan.originRight?'owned':'missing'}">${from} ${hhmm(plan.outboundDeparture)} ${plan.originRight?'OWNED':'NEEDED'}</span>
      <span class="slot-chip ${plan.destinationRight?'owned':'missing'}">${to} ${hhmm(plan.returnDeparture)} ${plan.destinationRight?'OWNED':'NEEDED'}</span>
      ${missingCost?`<div class="tiny muted" style="margin-top:4px">Missing slot rights: <b>${money(missingCost)}</b></div>`:''}
    </div>`;
    acquireSlotsBtn.style.display=missingCost?'block':'none';
    acquireSlotsBtn.disabled=state.cash<missingCost;
    acquireSlotsBtn.textContent=`Acquire missing slots · ${money(missingCost)}`;
  }else{
    acquireSlotsBtn.style.display='none';
  }

  document.getElementById('schedulePreview').innerHTML =
    `${num(out.km)} km each way · round trip <b>${formatDuration(cycle)}</b> · first dep <b>${plan?formatTime(plan.outboundDeparture):'—'}</b> · `+
    `<span class="money ${fits&&itinerary.ok?'good':'bad'}">${!fits?'aircraft cannot complete cycle before next departure':itinerary.ok?'schedule fits aircraft itinerary':itinerary.reason}</span>${rangeWarning}`+
    classRevenueMarkup(roundClassEstimate,'Estimated round-trip class income')+
    estimateBreakdownMarkup(roundEstimate,'Estimated round-trip economics')+slotHtml;
}

function refreshSlotBuyPreview(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base){
    document.getElementById('slotBuyPreview').textContent='Choose a valid time.';
    buySlotBtn.disabled=true; return;
  }
  const aligned=alignTimestampToAirportSlot(base,airport);
  const existing=slotRightAt(airport,aligned);
  const price=slotSeriesPrice(airport,aligned);
  const interval=AIRPORT_OPS[airport]?.slotIntervalMin||15;
  document.getElementById('slotBuyPreview').innerHTML=existing
    ? `<span class="slot-chip owned">${airport} ${hhmm(aligned)} OWNED</span><div style="margin-top:4px">${interval}-minute airport slot cadence.</div>`
    : `<b>${airport} ${hhmm(aligned)}</b> recurring departure series · ${interval}-minute cadence · <b>${money(price)}</b>`;
  buySlotBtn.disabled=Boolean(existing)||state.cash<price;
  buySlotBtn.textContent=existing?'Slot already owned':`Acquire slot · ${money(price)}`;
}

function refreshSlotPortfolio(force=false){
  const list=document.getElementById('slotPortfolio');
  const rights=[...state.slotRights].sort((a,b)=>a.airport.localeCompare(b.airport)||a.minuteOfDay-b.minuteOfDay);
  const uiSig=rights.map(r=>{
    const svc=slotAssignedService(r.id);
    return `${r.id}:${r.airport}:${r.minuteOfDay}:${r.price}:${r.source}:${svc?.id||''}`;
  }).join('|');
  const interacting=Boolean(list && list.contains(document.activeElement));
  if(!force && uiSig===slotPortfolioSignature) return;
  if(interacting) return;
  slotPortfolioSignature=uiSig;
  document.getElementById('slotCount').textContent=rights.length;
  if(!rights.length){
    list.innerHTML='<div class="empty">No recurring airport slot rights yet.</div>'; return;
  }
  list.innerHTML=rights.map(r=>{
    const svc=slotAssignedService(r.id);
    const source=r.source==='grandfathered'?'historic / grandfathered':'market acquired';
    return `<div class="slot-right ${svc?'assigned':''}">
      <div class="row-between">
        <div><span class="airport">${r.airport}</span> <b>${hhmmFromMinute(r.minuteOfDay)}</b></div>
        <span class="tag">${svc?'assigned':'free'}</span>
      </div>
      <div class="meta">${source}${svc?` · ${svc.id} ${svc.from} ↔ ${svc.to}`:''}</div>
      ${!svc&&r.source!=='grandfathered'?`<button class="btn bad" data-sell-slot="${r.id}" type="button" style="margin-top:6px;min-height:28px;padding:3px 7px">Sell · ${money(Math.round(r.price*.7))}</button>`:''}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-sell-slot]').forEach(btn=>btn.addEventListener('click',()=>{
    const right=slotRightById(btn.dataset.sellSlot);
    if(!right||slotAssignedService(right.id)) return;
    postTransaction(Math.round((right.price||0)*.7),'Slot sale',`Sold ${right.airport} ${hhmmFromMinute(right.minuteOfDay)} slot series`,right.id);
    state.slotRights=state.slotRights.filter(r=>r.id!==right.id);
    save(); refreshAll(); refreshSlotBuyPreview();
    toast(`${right.airport} ${hhmmFromMinute(right.minuteOfDay)} slot right sold.`);
  }));
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
    personnelTransferPreview.innerHTML=sameAirport?'Choose two different airports.':!available?`No ${PERSONNEL[role]?.label.toLowerCase()||'personnel'} available at ${from}.`:`External tickets: <b>${money(plan.cost)}</b> (${money(plan.farePerPerson)} each) · estimated arrival ${formatTime(plan.arrival)}.`;
    transferPersonnelBtn.disabled=sameAirport||available<amount||!plan||state.cash<plan.cost;
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
    if(state.cash<plan.cost) return toast(`You need ${money(plan.cost)} for external-airline tickets.`);
    transfer={id,role,amount,from,to,method,qualifications,departure:plan.departure,arrival:plan.arrival,cost:plan.cost,status:'scheduled',createdAt:simNow()};
    postTransaction(-plan.cost,'Personnel transfer',`${amount} ${PERSONNEL[role].label.toLowerCase()} ${from} → ${to} on another airline`,id);
    state.stats.transferCosts+=plan.cost;
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
  list.innerHTML=transfers.length?`<div class="estimate-title" style="margin-top:10px">Transfers</div>${transfers.map(transfer=>{
    const inTransit=transfer.status==='scheduled'&&simNow()>=transfer.departure;
    const status=transfer.status==='scheduled'?(inTransit?'in transit':'booked'):transfer.status;
    return `<div class="personnel-transfer-row ${transfer.status}">
      <div class="row-between"><b>${transfer.from} → ${transfer.to}</b><span class="tag">${status}</span></div>
      <div class="tiny muted">${transfer.amount} ${PERSONNEL[transfer.role]?.label||transfer.role} · ${transfer.method==='own'?`${transfer.flightId} · non-revenue`:`other airline · ${money(transfer.cost)}`}</div>
      <div class="tiny muted">${transfer.status==='cancelled'?'Returned to origin roster':`Arrival ${formatTime(transfer.arrival)}`}</div>
    </div>`;
  }).join('')}`:'';
}

function refreshPersonnel(force=false){
  const rows=[];
  for(const airport of Object.keys(state.personnel.assignments||{}).sort())
    for(const [role,config] of Object.entries(PERSONNEL)){
      const hired=staffAt(airport,role);
      if(hired) rows.push({airport,role,config,hired,ratings:state.personnel.qualifications?.[airport]?.[role]||{}});
    }
  for(const row of rows) row.shortage=state.flights.some(f=>
    !f.cancelled&&!f.settled&&f.staffingBlocked&&f.from===row.airport&&
    (f.staffingShortage||'').includes(row.config.label)
  );
  const transferSig=(state.personnelTransfers||[]).map(item=>`${item.id}:${item.status}:${item.departure}:${item.arrival}:${item.status==='scheduled'&&simNow()>=item.departure?'transit':'waiting'}`).join('|');
  const signature=`${activeWorkspaceView}:${transferSig}:`+rows.map(row=>`${row.airport}:${row.role}:${row.hired}:${row.shortage}:${JSON.stringify(row.ratings)}`).join('|');
  if(!force && signature===personnelSignature) return;
  personnelSignature=signature;
  const totalStaff=rows.reduce((total,row)=>total+row.hired,0);
  if(activeWorkspaceView==='occ'){
    document.getElementById('personnelPayroll').textContent=`${totalStaff} staff`;
    personnelList.innerHTML=rows.length?`<table class="personnel-table occ-personnel-table">
      <thead><tr><th>Personnel</th><th>Base</th><th>Roster</th></tr></thead>
      <tbody>${rows.map(row=>`<tr class="${row.shortage?'personnel-shortage':''}"><td>${row.config.label}${row.shortage?' <span class="delay-text">!</span>':''}${Object.keys(row.ratings).length?`<div class="tiny muted">${Object.entries(row.ratings).filter(([,count])=>count).map(([family,count])=>`${family} ${count}`).join(' · ')}</div>`:''}</td><td>${row.airport}</td><td>${row.hired}</td></tr>`).join('')}</tbody>
    </table><div class="tiny muted" style="margin-top:7px">Roster counts only. Immediate shortages appear in Attention required.</div>`:'<div class="empty">No operational personnel rostered.</div>';
  }else{
    document.getElementById('personnelPayroll').textContent=`${money(monthlyPayroll())}/mo`;
    personnelList.innerHTML=rows.length?`<table class="personnel-table">
      <thead><tr><th>Personnel</th><th>Base</th><th>Hired</th><th>Salary</th></tr></thead>
      <tbody>${rows.map(row=>`<tr><td>${row.config.label}${Object.keys(row.ratings).length?`<div class="tiny muted">${Object.entries(row.ratings).filter(([,count])=>count).map(([family,count])=>`${family} ${count}`).join(' · ')}</div>`:''}</td><td>${row.airport}</td><td>${row.hired}</td><td>${money(row.config.salary)}/mo</td></tr>`).join('')}</tbody>
    </table>`:'<div class="empty">No personnel hired.</div>';
  }
  renderPersonnelTransfers();
  refreshPersonnelTransferOptions();
}

function buildFinanceForecast(days=30){
  const start=simNow(),end=start+days*DAY;
  const buckets=Array.from({length:days},(_,index)=>({index,income:0,expense:0,net:0,balance:0}));
  const breakdown={ticketRevenue:0,flightOperations:0,fuel:0,payroll:0,leases:0,maintenance:0,flights:0};
  const addFlow=(timestamp,income=0,expense=0)=>{
    const index=clamp(Math.floor((timestamp-start)/DAY),0,days-1);
    buckets[index].income+=income; buckets[index].expense+=expense;
  };

  for(const flight of state.flights){
    if(flight.cancelled||flight.settled) continue;
    const arrival=flightActualArrival(flight);
    if(arrival<start||arrival>end) continue;
    const baseCosts=Math.max(0,flight.baseCosts??Math.max(0,(flight.costs||0)-(flight.fuelCost||0)-(flight.maintenanceCost||0)));
    addFlow(arrival,flight.revenue||0,baseCosts);
    breakdown.ticketRevenue+=flight.revenue||0; breakdown.flightOperations+=baseCosts; breakdown.flights++;
    if(!flight.fueled){
      const ac=state.aircraft.find(item=>item.id===flight.aircraftId);
      if(ac){
        const plannedFuel=Math.round(flightFuelPlan(flight.from,flight.to,ac).requiredGal*state.fuelMarket.pricePerGallon);
        addFlow(Math.max(start,flightActualDeparture(flight)-60*MIN),0,plannedFuel);
        breakdown.fuel+=plannedFuel;
      }
    }
  }

  for(const service of state.services){
    if(!service.active) continue;
    const ac=state.aircraft.find(item=>item.id===service.aircraftId);
    if(!ac) continue;
    let departure=service.nextDeparture,guard=0;
    while(departure<=end&&guard<500){
      const outbound=estimateFlight(service.from,service.to,ac,service.fares||service.fare,{departure});
      const destinationRight=slotRightById(service.destinationSlotRightId);
      const earliestReturn=departure+outbound.duration+service.turnaroundMin*MIN;
      const returnDeparture=destinationRight
        ? timestampAtMinuteAfter(earliestReturn,destinationRight.minuteOfDay)
        : alignTimestampToAirportSlot(earliestReturn,service.to);
      const inbound=estimateFlight(service.to,service.from,ac,service.fares||service.fare,{departure:returnDeparture});
      for(const leg of [
        {estimate:outbound,departure,arrival:departure+outbound.duration},
        {estimate:inbound,departure:returnDeparture,arrival:returnDeparture+inbound.duration}
      ]){
        if(leg.arrival>end) continue;
        const fuel=leg.estimate.economics?.fuel||leg.estimate.fuelCost||0;
        const operations=Math.max(0,leg.estimate.costs-fuel);
        addFlow(leg.arrival,leg.estimate.revenue,operations);
        addFlow(Math.max(start,leg.departure-60*MIN),0,fuel);
        breakdown.ticketRevenue+=leg.estimate.revenue; breakdown.flightOperations+=operations; breakdown.fuel+=fuel; breakdown.flights++;
      }
      departure=nextRecurringDeparture(departure,service.rule,service.operatingDays,service.operatingMonths);
      guard++;
    }
  }

  const dailyPayroll=monthlyPayroll()/30;
  for(let day=0;day<days;day++){
    addFlow(start+day*DAY,0,dailyPayroll);
    breakdown.payroll+=dailyPayroll;
  }
  for(const ac of state.aircraft){
    if(ac.acquisitionType!=='lease'||!Number.isFinite(ac.leasePaidThrough)) continue;
    let due=ac.leasePaidThrough,guard=0;
    while(due<=end&&guard<24){ addFlow(due,0,ac.leaseMonthlyFee||0); breakdown.leases+=ac.leaseMonthlyFee||0; due+=30*DAY; guard++; }
  }
  for(const ac of state.aircraft){
    const job=Management.maintenanceStatus(ac,start).scheduled;
    if(job&&job.end>=start&&job.end<=end){
      addFlow(job.end,0,job.cost||0);
      breakdown.maintenance+=job.cost||0;
    }
  }

  let balance=state.cash,lowest=balance,totalIncome=0,totalExpense=0;
  for(const bucket of buckets){
    bucket.income=Math.round(bucket.income); bucket.expense=Math.round(bucket.expense);
    bucket.net=bucket.income-bucket.expense; balance+=bucket.net; bucket.balance=balance;
    totalIncome+=bucket.income; totalExpense+=bucket.expense; lowest=Math.min(lowest,balance);
  }
  return {days,buckets,closingCash:balance,lowestCash:lowest,totalIncome,totalExpense,net:totalIncome-totalExpense,breakdown};
}

function financeForecastChartMarkup(forecast){
  const width=320,height=150,left=8,right=6,lineTop=12,lineBottom=82,barBase=112,barSpan=28;
  const balances=forecast.buckets.map(day=>day.balance),minBalance=Math.min(...balances),maxBalance=Math.max(...balances);
  const balanceRange=Math.max(1,maxBalance-minBalance);
  const maxAbsNet=Math.max(1,...forecast.buckets.map(day=>Math.abs(day.net)));
  const step=(width-left-right)/Math.max(1,forecast.days-1);
  const barWidth=Math.max(1,Math.min(6,step*.7));
  const points=forecast.buckets.map((day,index)=>{
    const x=left+index*step,y=lineBottom-((day.balance-minBalance)/balanceRange)*(lineBottom-lineTop);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const bars=forecast.buckets.map((day,index)=>{
    const x=left+index*step-barWidth/2,heightValue=Math.max(day.net?1:0,Math.abs(day.net)/maxAbsNet*barSpan);
    const y=day.net>=0?barBase-heightValue:barBase;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${heightValue.toFixed(1)}" rx="1" fill="${day.net>=0?'#5fe1a1':'#ff758f'}"><title>Day ${index+1}: ${money(day.net)} net · ${money(day.balance)} cash</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="${left}" y1="${barBase}" x2="${width-right}" y2="${barBase}" stroke="#29404f" stroke-width="1" />
    <line x1="${left}" y1="${lineBottom}" x2="${width-right}" y2="${lineBottom}" stroke="#1b303d" stroke-width="1" stroke-dasharray="3 3" />
    ${bars}
    <polyline points="${points}" fill="none" stroke="#58d2ff" stroke-width="2" vector-effect="non-scaling-stroke" />
    <circle cx="${left+(forecast.days-1)*step}" cy="${(lineBottom-((balances[balances.length-1]-minBalance)/balanceRange)*(lineBottom-lineTop)).toFixed(1)}" r="3" fill="#58d2ff" />
    <text x="9" y="9" fill="#8fa5b4" font-size="7">CASH BALANCE</text><text x="9" y="103" fill="#8fa5b4" font-size="7">DAILY NET</text>
    <text x="${left}" y="143" fill="#8fa5b4" font-size="7">NOW</text><text x="${width-right}" y="143" text-anchor="end" fill="#8fa5b4" font-size="7">DAY ${forecast.days}</text>
  </svg>`;
}

function projectServiceLegs(service,start,end){
  const ac=state.aircraft.find(item=>item.id===service.aircraftId);
  if(!ac) return [];
  const seats=cabinSeatCount(ac);
  const legs=state.flights
    .filter(f=>f.serviceId===service.id&&!f.cancelled&&!f.settled&&flightActualArrival(f)>=start&&flightActualArrival(f)<=end)
    .map(f=>{
      const plannedFuel=f.fueled?0:Math.round(flightFuelPlan(f.from,f.to,ac).requiredGal*state.fuelMarket.pricePerGallon);
      return {revenue:f.revenue,cost:f.costs+plannedFuel,pax:f.pax,seats,blockHours:(f.arrival-f.departure)/HOUR};
    });
  let departure=service.nextDeparture,guard=0;
  while(departure<=end&&guard<500){
    const outbound=estimateFlight(service.from,service.to,ac,service.fares||service.fare,{departure});
    const destinationRight=slotRightById(service.destinationSlotRightId);
    const returnDeparture=destinationRight
      ? timestampAtMinuteAfter(departure+outbound.duration+service.turnaroundMin*MIN,destinationRight.minuteOfDay)
      : alignTimestampToAirportSlot(departure+outbound.duration+service.turnaroundMin*MIN,service.to);
    const inbound=estimateFlight(service.to,service.from,ac,service.fares||service.fare,{departure:returnDeparture});
    for(const [legDeparture,estimate] of [[departure,outbound],[returnDeparture,inbound]]){
      if(legDeparture+estimate.duration<start||legDeparture+estimate.duration>end) continue;
      legs.push({revenue:estimate.revenue,cost:estimate.costs,pax:estimate.pax,seats,blockHours:estimate.duration/HOUR});
    }
    departure=nextRecurringDeparture(departure,service.rule,service.operatingDays,service.operatingMonths);
    guard++;
  }
  return legs;
}

function routePortfolioMarkup(rows,days){
  if(!rows.length) return `<div class="empty">Create recurring schedules to compare their ${days}-day contribution.</div>`;
  return `<table><thead><tr><th>Schedule</th><th>Flights</th><th>Load</th><th>Revenue</th><th>Contribution</th><th>Margin</th><th>€/flight</th><th>€/pax</th><th>€/block h</th></tr></thead><tbody>${rows.map(row=>`
    <tr class="${row.contribution<0?'loss':''}" title="Direct costs ${money(row.directCosts)} · allocated payroll ${money(row.allocatedPayroll)} · allocated lease ${money(row.allocatedLease)}">
      <td><b>${row.serviceId}</b><br><span class="muted">${row.route}</span></td><td>${row.flights}</td><td>${Math.round(row.loadFactor*100)}%</td><td>${money(row.revenue)}</td><td class="money ${row.contribution>=0?'good':'bad'}">${money(row.contribution)}</td><td>${Math.round(row.margin*100)}%</td><td>${money(row.contribution/row.flights)}</td><td>${row.passengers?money(row.contribution/row.passengers):'—'}</td><td>${row.blockHours?money(row.contribution/row.blockHours):'—'}</td>
    </tr>`).join('')}</tbody></table><div class="tiny muted" style="margin-top:6px">Contribution includes direct flight costs plus allocated payroll and aircraft lease. Hover a row for its allocation.</div>`;
}

function refreshFinance(force=false){
  const transactions=state.transactions||[];
  const forecastDays=Number(document.getElementById('financeForecastDays').value)||30;
  const latest=transactions[transactions.length-1];
  const planningSignature=state.flights.filter(f=>!f.settled&&!f.cancelled).map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.fueled}`).join('|')+
    state.services.filter(service=>service.active).map(service=>`${service.id}:${service.nextDeparture}`).join('|');
  const signature=`${forecastDays}:${transactions.length}:${latest?.id||''}:${state.cash}:${Math.floor(simNow()/DAY)}:${state.fuelMarket.pricePerGallon}:${monthlyPayroll()}:${planningSignature}`;
  if(!force&&signature===financeSignature) return;
  financeSignature=signature;
  const cutoff=simNow()-30*DAY;
  const recent=transactions.filter(tx=>tx.timestamp>=cutoff&&tx.category!=='Opening');
  const income=recent.reduce((total,tx)=>total+Math.max(0,tx.amount),0);
  const expenses=recent.reduce((total,tx)=>total+Math.max(0,-tx.amount),0);
  document.getElementById('accountingEntryCount').textContent=`${transactions.length} ${transactions.length===1?'entry':'entries'}`;
  document.getElementById('financeIncome').textContent=money(income);
  document.getElementById('financeExpenses').textContent=money(expenses);
  const forecast=buildFinanceForecast(forecastDays);
  latestManagementForecast=forecast;
  const routes=Management.buildRoutePortfolio({state,now:simNow(),days:forecastDays,projectService:projectServiceLegs,monthlyPayroll:monthlyPayroll()});
  const forecastMargin=forecast.breakdown.ticketRevenue?forecast.net/forecast.breakdown.ticketRevenue:0;
  const monthlyBurn=Math.max(0,(forecast.totalExpense-forecast.totalIncome)*(30/forecastDays));
  const runway=monthlyBurn?state.cash/monthlyBurn:Infinity;
  document.getElementById('financeTransactionCount').textContent=`${routes.length} ${routes.length===1?'schedule':'schedules'}`;
  document.getElementById('financeForecastTitle').textContent=`${forecastDays}-day forecast`;
  document.getElementById('routePortfolioPeriod').textContent=`${forecastDays}-day plan`;
  document.getElementById('financeManagementSummary').innerHTML=`
    <div><span>${forecastDays}d result</span><b class="money ${forecast.net>=0?'good':'bad'}">${money(forecast.net)}</b></div>
    <div><span>Plan margin</span><b class="money ${forecastMargin>=0?'good':'bad'}">${Math.round(forecastMargin*100)}%</b></div>
    <div><span>Cash runway</span><b class="money ${runway<2?'bad':'good'}">${Number.isFinite(runway)?`${runway.toFixed(1)} mo`:'Sustainable'}</b></div>`;
  document.getElementById('routePortfolio').innerHTML=routePortfolioMarkup(routes,forecastDays);
  const closing=document.getElementById('forecastClosingCash'),net=document.getElementById('forecastNet'),lowest=document.getElementById('forecastLowestCash');
  closing.textContent=money(forecast.closingCash); closing.className=`money ${forecast.closingCash>=0?'good':'bad'}`;
  net.textContent=money(forecast.net); net.className=`money ${forecast.net>=0?'good':'bad'}`;
  lowest.textContent=money(forecast.lowestCash); lowest.className=`money ${forecast.lowestCash>=0?'good':'bad'}`;
  document.getElementById('financeForecastChart').innerHTML=financeForecastChartMarkup(forecast);
  document.getElementById('financeForecastBreakdown').innerHTML=`
    <div class="row-between"><span class="muted">Ticket revenue</span><b class="money good">${money(forecast.breakdown.ticketRevenue)}</b></div>
    <div class="row-between"><span class="muted">Flight operations</span><b>${money(forecast.breakdown.flightOperations)}</b></div>
    <div class="row-between"><span class="muted">Fuel</span><b>${money(forecast.breakdown.fuel)}</b></div>
    <div class="row-between"><span class="muted">Payroll</span><b>${money(forecast.breakdown.payroll)}</b></div>
    <div class="row-between"><span class="muted">Aircraft leases</span><b>${money(forecast.breakdown.leases)}</b></div>
    <div class="row-between"><span class="muted">Scheduled maintenance</span><b>${money(forecast.breakdown.maintenance)}</b></div>
    <div class="row-between"><span class="muted">Projected flights</span><b>${forecast.breakdown.flights}</b></div>`;
  const list=document.getElementById('financeTransactions');
  const visible=transactions.slice(-100).reverse();
  list.innerHTML=visible.length?visible.map(tx=>`<div class="finance-transaction">
    <div class="description" title="${tx.description}">${tx.description}</div>
    <div class="amount money ${tx.amount>=0?'good':'bad'}">${tx.amount>=0?'+':'−'}${money(Math.abs(tx.amount))}</div>
    <div class="meta">${tx.category} · ${formatTime(tx.timestamp)}${tx.reference?` · ${tx.reference}`:''}</div>
    <div class="balance">Balance ${money(tx.balanceAfter)}</div>
  </div>`).join(''):'<div class="empty">No transactions yet.</div>';
}

function refreshManagementCycle(force=false){
  const cycle=Management.cyclePhase(state,simNow());
  const reviews=state.management.reviews||[];
  const signature=`${cycle.phase}:${Math.floor(cycle.progress*100)}:${reviews.length}`;
  if(!force&&signature===managementSignature) return;
  managementSignature=signature;
  document.getElementById('managementCyclePhase').textContent=cycle.phase==='plan'?'Plan':cycle.phase==='operate'?'Operate':'Review';
  const latest=reviews[reviews.length-1];
  document.getElementById('managementCycleContent').innerHTML=`
    <div class="row-between"><b>${cycle.label}</b><span class="tiny muted">Ends ${formatTime(cycle.end)}</span></div>
    <div class="cycle-progress"><span style="width:${Math.round(cycle.progress*100)}%"></span></div>
    <div class="tiny muted">${cycle.guidance}</div>
    <div class="cycle-stage-row"><div class="cycle-stage ${cycle.phase==='plan'?'active':''}">Plan</div><div class="cycle-stage ${cycle.phase==='operate'?'active':''}">Operate</div><div class="cycle-stage ${cycle.phase==='review'?'active':''}">Review</div></div>
    ${latest?`<div class="review-card" style="margin-top:8px"><div class="tiny muted">LAST COMPLETED WEEK · ${latest.id}</div><div class="row-between"><span>On-time</span><b>${Math.round(latest.kpis.onTimePerformance*100)}%</b></div><div class="row-between"><span>Completion</span><b>${Math.round(latest.kpis.completionFactor*100)}%</b></div><div class="row-between"><span>Direct result</span><b class="money ${latest.kpis.directResult>=0?'good':'bad'}">${money(latest.kpis.directResult)}</b></div></div>`:''}`;
}

function refreshPerformance(force=false){
  const now=simNow();
  const kpis=Management.operationalKpis(state,now,30);
  const signature=[kpis.completed,kpis.cancelled,Math.round(kpis.onTimePerformance*1000),Math.round(kpis.loadFactor*1000),Math.round(kpis.averageDelayMin),state.management.reviews.length,activeWorkspaceView].join(':');
  if(!force&&signature===document.getElementById('performanceKpis').dataset.signature) return;
  document.getElementById('performanceKpis').dataset.signature=signature;
  const value=(number,suffix='%')=>kpis.completed?`${Math.round(number)}${suffix}`:'—';
  document.getElementById('performanceKpis').innerHTML=`
    <div class="performance-kpi"><span>On-time ≤15m</span><b class="money ${kpis.onTimePerformance>=.8?'good':'bad'}">${value(kpis.onTimePerformance*100)}</b></div>
    <div class="performance-kpi"><span>Completion</span><b class="money ${kpis.completionFactor>=.95?'good':'bad'}">${kpis.total?`${Math.round(kpis.completionFactor*100)}%`:'—'}</b></div>
    <div class="performance-kpi"><span>Load factor</span><b>${value(kpis.loadFactor*100)}</b></div>
    <div class="performance-kpi"><span>Average delay</span><b>${value(kpis.averageDelayMin,'m')}</b></div>
    <div class="performance-kpi"><span>Utilization</span><b>${value(kpis.utilization*24,'h/day')}</b></div>
    <div class="performance-kpi"><span>Flights / cancelled</span><b>${kpis.completed} / ${kpis.cancelled}</b></div>`;
  const guidance=[];
  if(kpis.total&&kpis.completionFactor<.95) guidance.push('Protect completion before adding more schedule complexity.');
  if(kpis.completed&&kpis.onTimePerformance<.8) guidance.push('Add recovery margin, reserve resources, or reduce tight turns.');
  if(kpis.completed&&kpis.loadFactor<.65) guidance.push('Review fare, frequency, operating days, and cabin capacity.');
  if(kpis.completed&&kpis.operatingMargin<0) guidance.push('At least part of the flown programme is destroying direct contribution.');
  document.getElementById('performanceReview').innerHTML=`<div class="tiny muted">${guidance.length?guidance.join(' '):kpis.completed?'The recent programme is operationally stable.':'KPIs will populate as flights complete.'}</div>`;
}

function refreshWeather(force=false){
  const now=simNow();
  const relevant=new Set([state.home]);
  for(const f of state.flights){
    if(!f.cancelled&&!f.settled&&flightActualDeparture(f)<now+24*HOUR){ relevant.add(f.from); relevant.add(f.to); }
  }
  const weather=[...relevant].map(code=>Management.weatherAt(code,now)).sort((a,b)=>({severe:0,caution:1,normal:2}[a.level]-({severe:0,caution:1,normal:2}[b.level]))||a.airport.localeCompare(b.airport));
  const signature=weather.map(item=>`${item.airport}:${item.level}:${item.validFrom}`).join('|');
  if(!force&&signature===weatherSignature) return;
  weatherSignature=signature;
  const alerts=weather.filter(item=>item.level!=='normal').length;
  document.getElementById('weatherAlertCount').textContent=alerts?`${alerts} alert${alerts===1?'':'s'}`:'Normal';
  document.getElementById('weatherList').innerHTML=weather.map(item=>`<div class="weather-row ${item.level}">
    <div class="row-between"><span class="weather-code">${item.airport}</span><span class="readiness-state ${item.level==='normal'?'ready':item.level==='caution'?'warn':'block'}">${item.label}</span></div>
    <div class="weather-meta">${item.conditions} · wind ${item.windKph} km/h${item.delayMin?` · expected impact +${item.delayMin}m`:''}</div>
    <div class="weather-meta">Airport capacity ${Math.round(item.capacityFactor*100)}% · valid to ${hhmm(item.validUntil)}</div>
  </div>`).join('');
}

function refreshMaintenance(force=false){
  const now=simNow();
  const rows=state.aircraft.map(ac=>({ac,status:Management.maintenanceStatus(ac,now)}));
  const signature=rows.map(({ac,status})=>`${ac.id}:${Math.round(status.progress*100)}:${status.label}:${status.scheduled?.start||0}`).join('|');
  if(!force&&signature===maintenanceSignature) return;
  maintenanceSignature=signature;
  const due=rows.filter(row=>row.status.due||row.status.active).length;
  document.getElementById('maintenanceCount').textContent=`${due} due`;
  const list=document.getElementById('maintenanceList');
  list.innerHTML=rows.length?rows.map(({ac,status})=>`<div class="maintenance-row ${status.grounding?'grounded':status.due?'due':''}">
    <div class="row-between"><div><b>${ac.tail}</b><div class="maintenance-meta">${ac.model} · ${Management.aircraftFamily(ac.model)}</div></div><span class="readiness-state ${status.grounding?'block':status.due?'warn':'ready'}">${status.label}</span></div>
    <div class="maintenance-progress"><span style="width:${Math.min(100,Math.round(status.progress*100))}%"></span></div>
    <div class="maintenance-meta">${Math.round(status.hoursSince)}/${Management.CHECK_INTERVAL_HOURS} h · ${status.cyclesSince}/${Management.CHECK_INTERVAL_CYCLES} cycles since check</div>
    ${status.scheduled?`<div class="maintenance-meta">${status.scheduled.airport} · ${formatTime(status.scheduled.start)}–${formatTime(status.scheduled.end)} · ${money(status.scheduled.cost)}</div>${status.scheduled.status==='scheduled'?`<button class="btn" type="button" data-cancel-maintenance="${ac.id}">Cancel booking</button>`:''}`:`<button class="btn ${status.due?'bad':''}" type="button" data-schedule-maintenance="${ac.id}">Schedule next check</button>`}
  </div>`).join(''):'<div class="empty">No aircraft in fleet.</div>';
  list.querySelectorAll('[data-schedule-maintenance]').forEach(button=>button.addEventListener('click',()=>scheduleAircraftMaintenance(button.dataset.scheduleMaintenance)));
  list.querySelectorAll('[data-cancel-maintenance]').forEach(button=>button.addEventListener('click',()=>cancelAircraftMaintenance(button.dataset.cancelMaintenance)));
}

function refreshOccWidgets(force=false){
  if(!['occ','all'].includes(activeWorkspaceView)&&!force) return;
  const now=simNow(),horizon=now+24*HOUR;
  const flights=state.flights
    .filter(f=>!f.cancelled&&!f.settled&&flightActualArrival(f)>now&&flightActualDeparture(f)<horizon)
    .sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const aircraftIssues=state.aircraft.filter(ac=>aircraftIsDefective(ac,now)||Management.maintenanceStatus(ac,now).grounding);
  const assessed=flights.map(f=>{
    const ac=state.aircraft.find(item=>item.id===f.aircraftId);
    const readiness=ac?readinessForFlight(f,ac,now):{overall:'block',gates:[]};
    return {f,readiness,acknowledged:f.issueAcknowledgedKey===flightIssueKey(f)};
  });
  const issueFlights=assessed
    .filter(item=>item.readiness.overall!=='ready'||flightTotalDepartureDelayMin(item.f)>0)
    .filter(item=>!item.acknowledged)
    .sort((a,b)=>({block:0,warn:1,ready:2}[a.readiness.overall]-({block:0,warn:1,ready:2}[b.readiness.overall]))||flightActualDeparture(a.f)-flightActualDeparture(b.f));
  const signature=flights.map(f=>`${f.id}:${statusOfFlight(f,now)}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.staffingBlocked}`).join('|')+
    '::'+issueFlights.map(({f,readiness})=>`${f.id}:${readiness.overall}:${flightIssueKey(f)}`).join('|')+
    '::'+aircraftIssues.map(ac=>`${ac.id}:${ac.defectUntil}:${Management.maintenanceStatus(ac,now).label}`).join('|');
  if(!force&&signature===occSignature) return;
  occSignature=signature;
  document.getElementById('occFlightCount').textContent=flights.length;
  document.getElementById('occAttentionCount').textContent=issueFlights.length+aircraftIssues.length;
  const flightList=document.getElementById('occFlightList');
  flightList.innerHTML=flights.length?assessed.slice(0,40).map(({f,readiness})=>{
    const status=statusOfFlight(f,now),delay=flightTotalDepartureDelayMin(f);
    return `<button class="occ-item ${readiness.overall==='block'?'blocking':readiness.overall==='warn'?'warning':''}" type="button" data-occ-flight="${f.id}">
      <span class="occ-title"><span>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)} ${f.flightType==='ferry'?'<span class="ferry-badge">Ferry</span>':''}</span><span class="${delay?'delay-text':''}">${delay?`+${delay}m`:status}</span></span>
      <span class="occ-route">${status==='airborne'?`ETA ${formatTime(flightActualArrival(f))}`:`Departure ${formatTime(flightActualDeparture(f))}`}</span>
      <span class="occ-meta">${state.aircraft.find(ac=>ac.id===f.aircraftId)?.tail||f.aircraftId} · ${f.flightType==='ferry'?'non-revenue positioning':`${f.pax} passengers`} · ${readiness.overall}</span>
    </button>`;
  }).join(''):'<div class="empty">No active or upcoming flights in the next 24 hours.</div>';

  const attentionList=document.getElementById('occAttentionList');
  const flightIssueMarkup=issueFlights.map(({f,readiness})=>{
    const reasons=readiness.gates.filter(gate=>gate.status!=='ready').map(gate=>`${gate.label}: ${gate.detail}`);
    if(flightTotalDepartureDelayMin(f)) reasons.push(`Departure +${flightTotalDepartureDelayMin(f)}m`);
    return `<button class="occ-item issue ${readiness.overall==='block'?'blocking':'warning'}" type="button" data-occ-flight="${f.id}">
      <span class="occ-title"><span>${esc(f.id)} · ${esc(f.from)} → ${esc(f.to)}</span><span class="occ-priority">${readiness.overall==='block'?'Action':'Monitor'}</span></span>
      <span class="occ-route">${reasons.join(' · ')}</span>
      <span class="occ-meta">${formatTime(flightActualDeparture(f))} · click for recovery actions</span>
    </button>`;
  });
  const aircraftIssueMarkup=aircraftIssues.map(ac=>`<button class="occ-item issue blocking" type="button" data-occ-aircraft="${ac.id}">
    <span class="occ-title"><span>${esc(ac.tail)} · ${esc(ac.model)}</span><span class="occ-priority">Aircraft</span></span>
    <span class="occ-route">${aircraftIsDefective(ac,now)?esc(ac.defectReason||'Technical defect'):Management.maintenanceStatus(ac,now).label}</span>
    <span class="occ-meta">At ${esc(ac.location)}${aircraftIsDefective(ac,now)?` · unavailable until ${formatTime(ac.defectUntil)}`:''}</span>
  </button>`);
  const issues=flightIssueMarkup.concat(aircraftIssueMarkup);
  attentionList.innerHTML=issues.length?issues.join(''):'<div class="empty">No operational issues require attention.</div>';

  document.querySelectorAll('[data-occ-flight]').forEach(button=>button.addEventListener('click',()=>{
    const fleetWidget=document.querySelector('[data-widget="my-aircraft"]');
    setWidgetOpen(fleetWidget,true,{persist:true});
    settleSelectedFlight(button.dataset.occFlight);
  }));
  document.querySelectorAll('[data-occ-aircraft]').forEach(button=>button.addEventListener('click',()=>{
    const fleetWidget=document.querySelector('[data-widget="my-aircraft"]');
    setWidgetOpen(fleetWidget,true,{persist:true});
    settleSelected(button.dataset.occAircraft);
  }));
}

function buyMarketSlot(){
  const airport=slotAirportEl.value||state.home;
  const base=nextTimestampForClock(slotTimeEl.value||'08:00');
  if(!base) return toast('Choose a valid slot time.');
  const aligned=alignTimestampToAirportSlot(base,airport);
  if(slotRightAt(airport,aligned)) return toast(`You already own ${airport} ${hhmm(aligned)}.`);
  const right=acquireSlotRight(airport,aligned);
  if(!right) return;
  save(); refreshAll(); refreshSlotBuyPreview();
  toast(`Acquired ${airport} ${hhmm(aligned)} recurring slot series.`);
}

function acquireRequiredScheduleSlots(){
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
  const total=needs.reduce((sum,x)=>sum+slotSeriesPrice(x.airport,x.ts),0);

  if(!needs.length) return toast('Both required slot rights are already owned.');
  if(state.cash<total) return toast(`You need ${money(total)} for the missing slot rights.`);

  for(const need of needs) acquireSlotRight(need.airport,need.ts,{silent:true});
  save(); refreshAll(); refreshSchedulePreview(); refreshSlotBuyPreview();
  toast(`Acquired ${needs.length} required slot ${needs.length===1?'right':'rights'}.`);
}

function refreshHeader(){
  const t=simNow();
  document.getElementById('cash').textContent=money(state.cash);
  document.getElementById('fuelPrice').textContent=`€${state.fuelMarket.pricePerGallon.toFixed(2)}`;
  document.getElementById('fleetCount').textContent=state.aircraft.length;
  document.getElementById('airborneCount').textContent=state.flights.filter(f=>statusOfFlight(f,t)==='airborne').length;
  document.getElementById('simClock').textContent=formatTime(t);
}
function refreshKPIs(){
  const kpis=Management.operationalKpis(state,simNow(),30);
  const forecast=latestManagementForecast;
  const labels={
    revenue:document.getElementById('kpiLabelRevenue'),profit:document.getElementById('kpiLabelProfit'),
    pax:document.getElementById('kpiLabelPax'),flights:document.getElementById('kpiLabelFlights')
  };
  const values={
    revenue:document.getElementById('kpiRevenue'),profit:document.getElementById('kpiProfit'),
    pax:document.getElementById('kpiPax'),flights:document.getElementById('kpiFlights')
  };
  if(activeWorkspaceView==='occ'){
    const issues=state.flights.filter(f=>!f.cancelled&&!f.settled&&(
      f.staffingBlocked||f.maintenanceBlocked||f.positioningBlocked||f.slotMissed||f.technicalDelayMin||f.weatherDelayMin||f.propagatedDelayMin
    )).length+state.aircraft.filter(ac=>aircraftIsDefective(ac)||Management.maintenanceStatus(ac,simNow()).grounding).length;
    labels.revenue.textContent='On-time'; labels.profit.textContent='Average delay'; labels.pax.textContent='Completion'; labels.flights.textContent='Open issues';
    values.revenue.textContent=kpis.completed?`${Math.round(kpis.onTimePerformance*100)}%`:'—';
    values.profit.textContent=kpis.completed?`${Math.round(kpis.averageDelayMin)}m`:'—';
    values.pax.textContent=kpis.total?`${Math.round(kpis.completionFactor*100)}%`:'—';
    values.flights.textContent=String(issues);
    values.profit.className=kpis.averageDelayMin<=15?'money good':'money bad';
    values.flights.className=issues?'money bad':'money good';
  }else{
    const margin=forecast?.breakdown.ticketRevenue?forecast.net/forecast.breakdown.ticketRevenue:0;
    labels.revenue.textContent=`${forecast?.days||30}d result`; labels.profit.textContent='Plan margin'; labels.pax.textContent='On-time'; labels.flights.textContent='Completion';
    values.revenue.textContent=forecast?money(forecast.net):'—';
    values.profit.textContent=forecast?`${Math.round(margin*100)}%`:'—';
    values.pax.textContent=kpis.completed?`${Math.round(kpis.onTimePerformance*100)}%`:'—';
    values.flights.textContent=kpis.total?`${Math.round(kpis.completionFactor*100)}%`:'—';
    values.revenue.className=`money ${forecast?.net>=0?'good':'bad'}`;
    values.profit.className=`money ${margin>=0?'good':'bad'}`;
    values.pax.className=''; values.flights.className='';
  }
}

function aircraftOwnershipMarkup(ac){
  if(activeWorkspaceView==='occ') return '';
  const assigned=aircraftHasAssignments(ac.id);
  if(ac.acquisitionType==='lease'){
    const remaining=Math.max(0,Math.ceil((ac.leaseEndAt-simNow())/(30*DAY)));
    const unpaidRemaining=Math.max(0,Math.ceil((ac.leaseEndAt-Math.max(simNow(),ac.leasePaidThrough||simNow()))/(30*DAY)));
    const earlyFee=Math.min(6,unpaidRemaining)*(ac.leaseMonthlyFee||0);
    return `<div class="aircraft-ownership lease">
      <div class="row-between"><span class="muted">Acquisition</span><b>Operating lease</b></div>
      <div class="row-between"><span class="muted">Monthly payment</span><b>${money(ac.leaseMonthlyFee||0)}</b></div>
      <div class="row-between"><span class="muted">Contract end</span><b>${formatTime(ac.leaseEndAt)}</b></div>
      <div class="tiny muted">${remaining?`${remaining} contract months remaining${earlyFee?` · early return ${money(earlyFee)}`:''}`:'Minimum term completed · continues month-to-month until returned.'}</div>
      <button class="btn ${earlyFee?'bad':''} full" type="button" data-dispose-aircraft="${ac.id}" ${assigned?'disabled':''}>Return leased aircraft</button>
      ${assigned?'<div class="tiny muted">Remove active and future assignments before returning it.</div>':''}
    </div>`;
  }
  const value=aircraftSaleValue(ac);
  return `<div class="aircraft-ownership owned">
    <div class="row-between"><span class="muted">Acquisition</span><b>Purchased</b></div>
    <div class="row-between"><span class="muted">Estimated sale value</span><b>${money(value)}</b></div>
    <button class="btn bad full" type="button" data-dispose-aircraft="${ac.id}" ${assigned?'disabled':''}>Sell aircraft · ${money(value)}</button>
    ${assigned?'<div class="tiny muted">Remove active and future assignments before selling it.</div>':''}
  </div>`;
}

function expectedAircraftLocationForFlight(ac,flight){
  const preceding=state.flights
    .filter(item=>item.aircraftId===ac.id&&!item.cancelled&&item.id!==flight.id&&item.departure<flight.departure)
    .sort((a,b)=>b.departure-a.departure)[0];
  return preceding?.to||ac.location;
}

function readinessForFlight(flight,ac,t=simNow()){
  const evaluationAircraft={...ac,location:expectedAircraftLocationForFlight(ac,flight)};
  const shortages=flight.staffingBlocked&&flight.staffingShortage
    ? flight.staffingShortage.split(' · ')
    : staffingShortagesForFlight(ac,flightActualDeparture(flight),flight.arrival-flight.departure,flight.from,flight.id,flightUsesLocalCrew(flight),flight.flightType);
  const readiness=Management.flightReadiness({
    flight,aircraft:evaluationAircraft,now:t,staffingShortages:shortages,
    fuelPlan:flightFuelPlan(flight.from,flight.to,ac)
  });
  if(flight.positioningBlocked){
    const aircraftGate=readiness.gates.find(gate=>gate.key==='aircraft');
    aircraftGate.status='block'; aircraftGate.detail=`Aircraft is not positioned at ${flight.from}`;
    readiness.overall='block';
  }
  return readiness;
}

function readinessMarkup(flight,ac,t){
  const readiness=readinessForFlight(flight,ac,t);
  const label=readiness.overall==='ready'?'Ready':readiness.overall==='warn'?'Monitor':'Blocked';
  return `<div class="readiness-board">
    <div class="readiness-head"><div class="estimate-title">Departure readiness</div><span class="readiness-state ${readiness.overall}">${label}</span></div>
    <div class="readiness-grid">${readiness.gates.map(gate=>`<div class="readiness-gate ${gate.status}"><b>${gate.label}</b><span>${gate.detail}</span></div>`).join('')}</div>
  </div>`;
}

function occFlightActionsMarkup(flight){
  if(!['occ','all'].includes(activeWorkspaceView)||flight.settled||flight.cancelled) return '';
  if(flight.departureLogged) return `<div class="occ-action-panel"><div class="estimate-title">OCC actions</div><div class="tiny muted">Flight is airborne. Continue monitoring arrival and downstream rotation impact.</div></div>`;
  return `<div class="occ-action-panel">
    <div class="estimate-title">OCC actions</div>
    <div class="occ-action-grid">
      <button class="btn" type="button" data-delay-flight="${flight.id}">Hold +15 min</button>
      <button class="btn" type="button" data-priority-fuel="${flight.id}" ${flight.fueled?'disabled':''}>${flight.fueled?'Fuel onboard':'Fuel now'}</button>
      <button class="btn" type="button" data-acknowledge-flight="${flight.id}">Acknowledge</button>
      <button class="btn bad" type="button" data-cancel-flight="${flight.id}">Cancel flight</button>
    </div>
    <div class="tiny muted occ-action-note">Operational actions recalculate downstream aircraft, slot, crew and financial effects immediately.</div>
  </div>`;
}

function inlineAircraftDetailsMarkup(ac,active,upcoming,defective,t){
  const selected=selectedFlightId?state.flights.find(f=>f.id===selectedFlightId && f.aircraftId===ac.id):null;
  const flight=selected||active||upcoming;
  const model=MODELS[ac.model];
  const cabin=cabinForAircraft(ac),configuredSeats=cabinSeatCount(ac);
  const service=flight?.serviceId
    ? state.services.find(s=>s.active && s.id===flight.serviceId)
    : state.services.find(s=>s.active && s.aircraftId===ac.id);
  if(!flight){
    const fuel=aircraftFuelPerformance(model);
    return `<div class="fleet-expanded">
      <div class="row-between"><span class="muted">Location</span><b>${ac.location}</b></div>
      <div class="row-between"><span class="muted">Cabin</span><b>${cabin.economy} economy · ${cabin.business} business · ${cabin.first} first</b></div>
      <div class="row-between"><span class="muted">Installed seats</span><b>${configuredSeats}</b></div>
      <div class="row-between"><span class="muted">Range</span><b>${num(model.maxRangeKm)} km</b></div>
      <div class="row-between"><span class="muted">Fuel capacity</span><b>${num(fuel.fuelCapacityGal)} US gal</b></div>
      <div class="row-between"><span class="muted">Fuel onboard</span><b>${num(ac.fuelGallons||0)} US gal</b></div>
      <div class="row-between"><span class="muted">Condition</span><b>${Math.round(ac.condition??100)}%</b></div>
      <div class="row-between"><span class="muted">Utilization</span><b>${num(ac.flightHours||0)} h · ${num(ac.cycles||0)} cycles</b></div>
      ${defective?`<div class="issue-badge defect" style="margin-top:7px">Unavailable until ${formatTime(ac.defectUntil)}</div>`:'<div class="tiny muted" style="margin-top:7px">Available for assignment.</div>'}
      ${aircraftOwnershipMarkup(ac)}
    </div>`;
  }

  const status=statusOfFlight(flight,t);
  const depDelay=flightTotalDepartureDelayMin(flight);
  const arrDelay=Math.max(0,Math.round((flightActualArrival(flight)-flight.arrival)/MIN));
  const slot=flight.slotMissed
    ? `Missed · new slot ${formatTime(flight.assignedSlot)}`
    : `${formatTime(flight.assignedSlot||flight.departure)}`;
  const fuelPlan=flightFuelPlan(flight.from,flight.to,ac);
  const fuelGallons=flight.fueled?(flight.fuelPurchasedGallons??flight.fuelGallons):Math.max(0,Math.ceil(fuelPlan.requiredGal-(ac.fuelGallons||0)));
  const fuelOnboard=flight.fueled?(flight.fuelOnboardAtDeparture||fuelPlan.requiredGal):(ac.fuelGallons||0)+fuelGallons;
  const fuelAfterFlight=Math.max(0,fuelOnboard-(flight.tripFuelGallons||fuelPlan.tripBurnGal));
  const fuelPrice=flight.fueled?flight.fuelPricePerGallon:state.fuelMarket.pricePerGallon;
  const fuelCost=flight.fueled?flight.fuelCost:Math.round(fuelGallons*fuelPrice);
  return `<div class="fleet-expanded">
    <div class="tiny muted">${selected?'SELECTED FLIGHT':active?'CURRENT FLIGHT':'NEXT FLIGHT'} · ${status.toUpperCase()} ${flight.flightType==='ferry'?'<span class="ferry-badge">Ferry</span>':''}</div>
    <div class="big-route">${flight.from} → ${flight.to}</div>
    <div class="row-between"><span class="muted">Flight</span><b>${flight.id}</b></div>
    <div class="row-between"><span class="muted">Scheduled</span><b>${formatTime(flight.departure)} → ${formatTime(flight.arrival)}</b></div>
    <div class="row-between"><span class="muted">Actual / expected</span><b>${formatTime(flightActualDeparture(flight))} → ${formatTime(flightActualArrival(flight))}</b></div>
    ${flight.flightType==='ferry'?'<div class="row-between"><span class="muted">Operation</span><b>Non-revenue positioning flight</b></div>':`<div class="row-between"><span class="muted">Passengers</span><b>${flight.pax} / ${configuredSeats} · ${Math.round(flight.load*100)}%</b></div>`}
    ${flight.cancelled?`<div class="row-between"><span class="muted">Cancellation recovery</span><b class="money bad">${money(flight.cancellationCost||0)}</b></div>`:''}
    ${flightPersonnelTransferCount(flight.id)?`<div class="row-between"><span class="muted">Non-revenue personnel</span><b>${flightPersonnelTransferCount(flight.id)} repositioning</b></div>`:''}
    ${flight.flightType==='ferry'?'':`<div class="cabin-flight-breakdown">
      ${Object.entries(CABIN_CLASSES).map(([className,config])=>{
        const seats=cabin[className]||0,pax=flight.classPax?.[className]||0,fare=flight.fares?.[className]||0;
        return seats?`<div class="row-between"><span>${config.label}</span><b>${pax}/${seats} · ${money(fare)} · ${money(pax*fare)}</b></div>`:'';
      }).join('')}
    </div>`}
    ${flight.demand?`<div class="tiny muted" style="margin:4px 0 7px">Demand: route ${Math.round(flight.demand.route*100)}% · day ${Math.round(flight.demand.weekday*100)}% · time ${Math.round(flight.demand.time*100)}% · season ${Math.round(flight.demand.season*100)}%</div>`:''}
    <div class="row-between"><span class="muted">Departure delay</span><b class="${depDelay?'delay-text':''}">${depDelay?`+${depDelay} min`:'on time'}</b></div>
    <div class="row-between"><span class="muted">Arrival delay</span><b class="${arrDelay?'delay-text':''}">${arrDelay?`+${arrDelay} min`:'on time'}</b></div>
    <div class="row-between"><span class="muted">Slot</span><b>${slot}</b></div>
    <div class="row-between"><span class="muted">Fuel purchase</span><b>${fuelGallons?`${flight.fueled?'Purchased':'Planned'} · ${num(fuelGallons)} US gal`:'No top-up required'}</b></div>
    <div class="row-between"><span class="muted">Onboard → after flight</span><b>${num(fuelOnboard)} → ${num(fuelAfterFlight)} US gal</b></div>
    <div class="row-between"><span class="muted">Fuel price</span><b>€${fuelPrice.toFixed(2)} / gal · ${money(fuelCost)}</b></div>
    <div class="row-between"><span class="muted">Tank capacity</span><b>${num(fuelPlan.fuelCapacityGal)} US gal</b></div>
    <div class="row-between"><span class="muted">Aircraft condition</span><b>${Math.round(ac.condition??100)}%</b></div>
    ${returnReusesOutboundCrew(flight)?'<div class="row-between"><span class="muted">Flight crew</span><b>Continuing round-trip crew</b></div>':''}
    ${flight.staffingBlocked?`<div class="issue-badge defect" style="margin-top:7px">Waiting for personnel at ${flight.from}</div><div class="tiny muted" style="margin-top:4px">${flight.staffingShortage}</div>`:''}
    ${flight.maintenanceCost?`<div class="row-between"><span class="muted">Outsourced repair</span><b class="delay-text">${flight.defectSeverity} · ${money(flight.maintenanceCost)}</b></div>`:''}
    ${flight.weatherCode?`<div class="row-between"><span class="muted">Weather impact</span><b class="delay-text">${flight.weatherCode}</b></div>`:''}
    ${service?`<div class="tiny muted" style="margin-top:6px">${service.id} · ${service.rule}${service.rule==='custom'?` (${(service.operatingDays||[]).length} weekdays, ${(service.operatingMonths||[]).length} months)`:''} · ${service.from} ↔ ${service.to}</div>`:''}
    ${(flight.handlingDelayMin||flight.technicalDelayMin||flight.staffingDelayMin||flight.manualDelayMin||flight.weatherDelayMin||flight.maintenanceDelayMin||flight.positioningDelayMin||flight.propagatedDelayMin||flight.slotDelayMin||flight.enrouteDelayMin)?`
      <div class="sep"></div><div class="tiny muted">DELAY BREAKDOWN</div>
      <div class="row-between"><span class="muted">Handling / technical</span><b>+${(flight.handlingDelayMin||0)+(flight.technicalDelayMin||0)}m</b></div>
      <div class="row-between"><span class="muted">Personnel</span><b>+${flight.staffingDelayMin||0}m</b></div>
      <div class="row-between"><span class="muted">OCC hold / weather</span><b>+${(flight.manualDelayMin||0)+(flight.weatherDelayMin||0)}m</b></div>
      <div class="row-between"><span class="muted">Maintenance / position</span><b>+${(flight.maintenanceDelayMin||0)+(flight.positioningDelayMin||0)}m</b></div>
      <div class="row-between"><span class="muted">Propagation / slot</span><b>+${(flight.propagatedDelayMin||0)+(flight.slotDelayMin||0)}m</b></div>
      <div class="row-between"><span class="muted">En-route</span><b>+${flight.enrouteDelayMin||0}m</b></div>`:''}
    ${readinessMarkup(flight,ac,t)}
    ${flightEconomicsMarkup(flight,fuelCost)}
    ${occFlightActionsMarkup(flight)}
    ${flightSwitchMarkup(flight)}
    ${service&&activeWorkspaceView!=='occ'?`<div class="schedule-management-box">
      <button id="removeScheduleBtn" class="btn bad full" type="button">Remove ${service.id} schedule</button>
      <div class="tiny muted" style="margin-top:5px">Stops future rotations. Any flight already airborne will continue.</div>
    </div>`:''}
    ${aircraftOwnershipMarkup(ac)}
  </div>`;
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
  const visibleRows=rows.filter(({ac,active,upcoming,defective})=>
    matchesSidebarSearch(
      `aircraft airplane fleet ${activeWorkspaceView!=='occ'?(ac.acquisitionType==='lease'?'leased lease':'owned purchased'):''}`,ac.tail,ac.model,ac.location,
      active?.id,active?.from,active?.to,upcoming?.id,upcoming?.from,upcoming?.to,
      defective?'defect':'',active?'airborne':'ground'
    )
  );
  document.getElementById('aircraftListCount').textContent=sidebarSearchTokens.length?`${visibleRows.length}/${rows.length}`:rows.length;
  if(!visibleRows.length){
    el.innerHTML=`<div class="empty">${sidebarSearchTokens.length?'No aircraft match your search.':'No aircraft owned.'}</div>`;
    return;
  }
  el.innerHTML=visibleRows.map(({ac,active,upcoming,defective})=>{
    const p=active?flightProgress(active,t):0;
    const status=active?'airborne':defective?'defect':'ground';
    const dotClass=active?'active':defective?'delayed':'';
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
    return `<div class="fleet-row ${selectedAircraftId===ac.id?'selected':''} ${defective?'defective':''}" data-aircraft-id="${ac.id}">
      <div class="fleet-summary" data-aircraft-toggle="${ac.id}" role="button" tabindex="0" aria-expanded="${selectedAircraftId===ac.id}">
        <div class="row-between"><span><b>${ac.tail}</b> <span class="tiny muted">${ac.model}${activeWorkspaceView!=='occ'?` · ${ac.acquisitionType==='lease'?'leased':'owned'}`:''}</span></span><span class="tag"><span class="dot ${dotClass}"></span>${status}</span></div>
        <div class="route-code fleet-meta">${route}</div>
        <div class="tiny muted fleet-meta">${detail}</div>
        ${active?`<div class="progress" aria-label="Flight progress ${Math.round(p*100)} percent"><span style="width:${p*100}%"></span></div>`:''}
      </div>
      ${selectedAircraftId===ac.id?inlineAircraftDetailsMarkup(ac,active,upcoming,defective,t):''}
    </div>`;
  }).join('');
  el.querySelectorAll('[data-aircraft-id]').forEach(card=>{
    card.addEventListener('click',event=>{
      if(event.target.closest('.fleet-expanded')) return;
      toggleAircraftCard(card.dataset.aircraftId);
    });
  });
  el.querySelectorAll('[data-aircraft-toggle]').forEach(summary=>{
    const toggle=()=>toggleAircraftCard(summary.dataset.aircraftToggle);
    summary.addEventListener('keydown',event=>{
      if(event.key!=='Enter' && event.key!==' ') return;
      event.preventDefault();
      toggle();
    });
  });
  el.querySelectorAll('[data-dispose-aircraft]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    button.blur();
    disposeAircraft(button.dataset.disposeAircraft);
  }));
  const expandedAircraft=state.aircraft.find(ac=>ac.id===selectedAircraftId);
  const expandedOperations=expandedAircraft?operationsByAircraft.get(expandedAircraft.id):null;
  const expandedFlight=selectedFlightId
    ? state.flights.find(f=>f.id===selectedFlightId)
    : expandedOperations?.active||expandedOperations?.upcoming;
  if(expandedFlight) bindFlightSwitchControls(expandedFlight);
}

function refreshAircraftMarket(){
  const list=document.getElementById('aircraftMarketList');
  const models=Object.entries(MODELS).filter(([name,m])=>
    matchesSidebarSearch('buy lease aircraft airplane market',name,m.manufacturer,m.segment,m.seats,m.maxRangeKm)
  );
  if(!models.length){
    list.innerHTML='<div class="empty">No market aircraft match your search.</div>';
    return;
  }
  list.innerHTML=models.map(([name,m])=>{
    const label=normalizeSidebarSearch(name).startsWith(normalizeSidebarSearch(m.manufacturer))?name:`${m.manufacturer} ${name}`;
    const defaultLeaseFee=leaseMonthlyFee(name,60);
    return `<div class="card market-aircraft-card" data-capacity="${m.seats}" data-model="${name}">
    <div class="row-between">
      <div><b>${label}</b><div class="tiny muted">${m.segment||'Passenger aircraft'}</div></div>
      <b>${money(m.price)}</b>
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
    <div class="lease-config">
      <div class="row-between"><label>Lease duration</label><b data-lease-term-value>60 months</b></div>
      <input data-lease-months type="range" min="12" max="120" value="60" step="12" />
      <div class="row-between"><span class="tiny muted">Longer terms reduce the monthly rate</span><b data-lease-fee>${money(defaultLeaseFee)}/mo</b></div>
    </div>
    <div class="market-acquisition-actions">
      <button class="btn" data-buy="${name}">Buy · ${money(m.price)}</button>
      <button class="btn good" data-lease="${name}">Lease · ${money(defaultLeaseFee)}/mo</button>
    </div>
  </div>`;
  }).join('');
  refreshBuyButtons();
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
      <div class="tiny muted" style="margin-top:6px">Fuel is already onboard, so this round trip's aircraft can no longer be changed.</div>
    </div>`;
  }

  if(flightActualDeparture(outbound)<=simNow()){
    return `<div class="aircraft-switch-box">
      <div class="title">Aircraft replacement</div>
      <div class="tiny muted" style="margin-top:6px">This round trip has already started, so its aircraft can no longer be changed.</div>
    </div>`;
  }

  const candidates=rotationReplacementCandidates(f);
  if(!candidates.length){
    return `<div class="aircraft-switch-box">
      <div class="title">Switch aircraft for this flight</div>
      <div class="tiny muted" style="margin-top:6px">No suitable spare is currently at ${service.from}. A spare must be at the base, available, non-defective and have sufficient range.</div>
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
    <div class="flight-switch-note">“Sub this round trip” changes only this outbound/return pair. “Change future schedule” assigns the spare to all later rotations.</div>
  </div>`;
}

function bindFlightSwitchControls(f){
  if(!f) return;
  document.querySelectorAll(`[data-delay-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>delayFlight(f.id,15)));
  document.querySelectorAll(`[data-priority-fuel="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>prioritizeFuel(f.id)));
  document.querySelectorAll(`[data-acknowledge-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>acknowledgeFlightIssue(f.id)));
  document.querySelectorAll(`[data-cancel-flight="${f.id}"]`).forEach(button=>button.addEventListener('click',()=>cancelFlight(f.id)));
  if(!f.serviceId) return;
  const removeBtn=document.getElementById('removeScheduleBtn');
  if(removeBtn) removeBtn.addEventListener('click',()=>{
    removeBtn.blur();
    confirmCancelService(f.serviceId);
  });
  const select=document.getElementById('flightReplacementAircraft');
  const subBtn=document.getElementById('flightSubRoundTripBtn');
  const permanentBtn=document.getElementById('flightPermanentChangeBtn');
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
      html+=`<div class="sched-aircraft-row" data-sched-aircraft="${esc(ac.id)}">`;
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
        const title=`${f.id} ${f.from} → ${f.to} | scheduled ${formatTime(f.departure)} | actual ${formatTime(actualDep)} – ${formatTime(actualArr)}${depDelay?` | +${depDelay}m departure delay`:''}`;

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
          <div class="flight-route">${esc(f.from)} → ${esc(f.to)}</div>
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
            const sameAirport=f.to===next.from;
            const gap=flightActualDeparture(next)-actualArr;
            html+=`<span class="connection-line ${sameAirport?'':'mismatch'}" style="left:${connLeft}px;width:${connWidth}px"
              title="${sameAirport?'Turnaround / connection':'Location mismatch'}: ${f.to} → ${next.from}, ${formatDuration(gap)}"></span>`;
            if(connWidth>50){
              html+=`<span class="connection-label" style="left:${connLeft+connWidth/2}px">${sameAirport?esc(f.to)+' · ':''}${formatDuration(gap)}</span>`;
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


function refreshBuyButtons(){
  document.querySelectorAll('[data-buy]').forEach(b=>{b.disabled=state.cash<MODELS[b.dataset.buy].price;});
  document.querySelectorAll('[data-lease]').forEach(b=>{
    const months=Number(b.closest('.market-aircraft-card')?.querySelector('[data-lease-months]')?.value)||60;
    b.disabled=state.cash<leaseMonthlyFee(b.dataset.lease,months);
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
  refreshSlotPortfolio(true);
  refreshPersonnel(true);
  refreshFinance(true);
  refreshOccWidgets(true);
  refreshManagementCycle(true);
  refreshPerformance(true);
  refreshMaintenance(true);
  refreshWeather(true);
  refreshRecoveryOptions(true);
  refreshAircraftMarket();

  refreshKPIs();
  refreshBuyButtons();
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
  recoveryDepartureTimeEl.value=hhmm(d.getTime());
}
document.getElementById('speed').value=String(state.clock.speed);
scheduleBtn.addEventListener('click',scheduleFlight);
acquireSlotsBtn.addEventListener('click',acquireRequiredScheduleSlots);
buySlotBtn.addEventListener('click',buyMarketSlot);
document.getElementById('hirePersonnelBtn').addEventListener('click',()=>hirePersonnel(1));
document.getElementById('hirePersonnelFiveBtn').addEventListener('click',()=>hirePersonnel(5));
transferPersonnelBtn.addEventListener('click',createPersonnelTransfer);
createRecoveryFlightBtn.addEventListener('click',createRecoveryFlight);
[recoveryAircraftEl,recoveryDestinationEl,recoveryDepartureTimeEl].forEach(el=>el.addEventListener('change',refreshRecoveryPreview));
recoveryDepartureTimeEl.addEventListener('input',refreshRecoveryPreview);
document.getElementById('financeForecastDays').addEventListener('change',()=>{ financeSignature=''; refreshFinance(true); refreshKPIs(); });
personnelRoleEl.addEventListener('change',refreshPersonnelHirePreview);
personnelAirportEl.addEventListener('change',refreshPersonnelHirePreview);
personnelQualificationEl.addEventListener('change',refreshPersonnelHirePreview);
[transferPersonnelRoleEl,transferPersonnelFromEl,transferPersonnelToEl,transferPersonnelMethodEl,transferPersonnelFlightEl].forEach(el=>el.addEventListener('change',refreshPersonnelTransferOptions));
transferPersonnelAmountEl.addEventListener('input',refreshPersonnelTransferOptions);
slotAirportEl.addEventListener('change',refreshSlotBuyPreview);
slotTimeEl.addEventListener('change',refreshSlotBuyPreview);
scheduleTypeEl.addEventListener('change',refreshScheduleMode);
[originEl,destEl,departureTimeEl,fareEconomyEl,fareBusinessEl,fareFirstEl,repeatRuleEl,turnaroundEl].forEach(el=>{
  el.addEventListener('change',refreshSchedulePreview);
});
[fareEconomyEl,fareBusinessEl,fareFirstEl].forEach(el=>el.addEventListener('input',refreshSchedulePreview));
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
  workspaceUi.scheduleRanges??={planning:48,occ:24,all:48};
  workspaceUi.scheduleRanges[activeWorkspaceView]=scheduleRangeHours;
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
