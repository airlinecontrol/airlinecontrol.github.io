/* Schedule timeline rendering, markers, and schedule board interactions. */

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

function scheduleRenderableCrewDuty(duty){
  const activeFlights=(duty.flightIds||[])
    .map(id=>state.flights.find(flight=>flight.id===id&&!flight.cancelled))
    .filter(Boolean);
  if(!activeFlights.length) return null;
  if(activeFlights.length===(duty.flightIds||[]).length) return duty;
  if(typeof buildCrewDutyRecord==='function'){
    return buildCrewDutyRecord(duty.id,activeFlights)||null;
  }
  return {...duty,flightIds:activeFlights.map(flight=>flight.id),aircraftId:activeFlights[0].aircraftId};
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
  if(mode==='open') return false;
  const [hour,minute]=String(status.localTime||'00:00').split(':').map(Number);
  return minuteInWindow((hour||0)*60+(minute||0),status.rule.start,status.rule.end);
}
function scheduleNightWindowNearFlightTime(flight,{airportCode,timestamp,edge},cache){
  const rule=AIRPORT_NIGHT_RULES[airportCode];
  const softRestrictionApplies=(Number(flight.nightRestrictionDelayMin)||0)>0;
  if(!rule||rule.mode==='open'||(!['curfew','quota'].includes(rule.mode)&&!softRestrictionApplies)) return null;
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
        className:status.status==='restricted'?'restriction':'',
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
  for(const flight of flights.filter(item=>!item.cancelled)){
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
  return `<div class="night-closure-bar ${esc(info.className||'')} ${focusClass} ${selected?'selected':''}" data-night-airport="${esc(info.airport)}" data-night-flight="${esc(info.flightId||'')}" data-night-edge="${esc(info.edge||'')}" title="${esc(info.title)}" style="left:${left}px;width:${width}px;--night-lane-top:${53+lane*16}px"><b>${esc(info.airport)}</b><span>${esc(info.label)}</span></div>`;
}
function scheduleMaintenanceJobMarkup(aircraft,job,start,end,pxPerHour){
  if(!aircraft||!job) return '';
  const clippedStart=Math.max(start,job.start),clippedEnd=Math.min(end,job.end);
  if(clippedEnd<=clippedStart) return '';
  const left=(clippedStart-start)/HOUR*pxPerHour,width=Math.max(34,(clippedEnd-clippedStart)/HOUR*pxPerHour);
  const title=`${aircraft.tail} ${String(job.label||'maintenance').toLowerCase()} · ${formatTime(job.start)}-${formatTime(job.end)} · ${job.reason||'Scheduled maintenance'} · est ${money(job.cost||0)}`;
  return `<div class="maintenance-schedule-block ${job.status==='active'?'active':''}" data-maintenance-job="${esc(aircraft.id)}" title="${esc(title)}" style="left:${left}px;width:${width}px"><b>MX</b><span>${esc(shortClock(job.start))}-${esc(shortClock(job.end))}</span></div>`;
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
  if((Number(flight.enrouteRecoveryMin)||0)>0) causes.push({label:'En-route recovery',minutes:-Math.round(Number(flight.enrouteRecoveryMin)||0),detail:flight.enrouteRecoveryCause||'OCC coordinated time recovery en route'});
  if(arrDelay>depDelay && !(Number(flight.enrouteDelayMin)||0)) causes.push({label:'Arrival delay',minutes:arrDelay-depDelay,detail:'Arrival moved later than departure delay alone'});
  if(!causes.length) causes.push({label:'Recorded timing shift',minutes:totalDelay,detail:'Actual timing differs from plan'});
  const ordered=causes.sort((a,b)=>Math.abs(b.minutes)-Math.abs(a.minutes)||a.label.localeCompare(b.label)).slice(0,6);
  const primary=ordered.find(item=>item.minutes>0)||ordered[0]||null;
  const lines=[
    `${flight.id} · ${flight.from} → ${flightOperationalDestination(flight)}`,
    `Planned ${shortClock(flight.departure)}–${shortClock(flight.arrival)} · Actual ${shortClock(flightActualDeparture(flight))}–${shortClock(flightActualArrival(flight))}`,
    `Delay: departure +${depDelay} min · arrival +${arrDelay} min`,
    primary?`Primary cause: ${primary.label} · +${primary.minutes} min`:null,
    ...ordered.slice(1,4).map(item=>`${item.minutes<0?'Recovery':'Contributing'}: ${item.label} · ${item.minutes<0?item.minutes:`+${item.minutes}`} min`)
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
function schedulePassengerConnectionPairs(renderedFlights,focusIds=new Set(),now=simNow()){
  const visibleById=new Map(renderedFlights.filter(flight=>!flight.cancelled&&!flight.settled).map(flight=>[flight.id,flight]));
  if(!visibleById.size) return [];
  const pairs=[];
  const seen=new Set();
  const selectedId=selectedFlightId||'';
  const selectedPairs=[];
  const warningPairs=[];
  for(const inbound of visibleById.values()){
    if(inbound.flightType==='ferry') continue;
    const manifest=connectionStatusForFlight(inbound);
    for(const connection of manifest.connections||[]){
      if(connection.status==='missed') continue;
      const outbound=visibleById.get(connection.flightId);
      if(!outbound) continue;
      const isSelected=Boolean(selectedId&&(inbound.id===selectedId||outbound.id===selectedId));
      const isWarning=['critical','at-risk'].includes(connection.status);
      if(!isSelected&&!isWarning) continue;
      const key=`${inbound.id}->${outbound.id}`;
      if(seen.has(key)) continue;
      seen.add(key);
      const pair={inbound,outbound,connection,selected:isSelected,focused:focusIds.has(inbound.id)||focusIds.has(outbound.id),warning:isWarning};
      (isSelected?selectedPairs:warningPairs).push(pair);
    }
  }
  pairs.push(...selectedPairs.slice(0,10),...warningPairs.slice(0,8));
  return pairs.sort((a,b)=>flightActualArrival(a.inbound)-flightActualArrival(b.inbound)||flightActualDeparture(a.outbound)-flightActualDeparture(b.outbound));
}
function scheduleConnectionTone(connection){
  if(connection.status==='critical') return 'critical';
  if(connection.status==='at-risk') return 'at-risk';
  return 'protected';
}
function scheduleConnectionLabel(connection){
  const pax=Math.max(0,Math.round(Number(connection.pax)||0));
  const available=Math.round(Number(connection.availableMin)||0);
  const mct=Math.round(Number(connection.mctMin)||0);
  return `${pax}p · ${available}/${mct}m`;
}
function renderScheduleConnectionOverlay(board,pairs){
  const boardRect=board.getBoundingClientRect();
  const width=Math.max(board.scrollWidth,board.offsetWidth,boardRect.width);
  const height=Math.max(board.scrollHeight,board.offsetHeight,boardRect.height);
  const signature=[
    Math.round(width),Math.round(height),selectedFlightId||'',selectedAircraftId||'',
    pairs.map(pair=>[
      pair.inbound.id,
      pair.outbound.id,
      pair.connection.status,
      Math.round(pair.connection.availableMin||0),
      Math.round(pair.connection.mctMin||0),
      pair.connection.pax||0,
      pair.focused?1:0,
      pair.selected?1:0
    ].join(':')).join('|')
  ].join('::');
  if(signature===lastScheduleConnectionOverlaySignature) return;
  lastScheduleConnectionOverlaySignature=signature;
  board.querySelector('.schedule-connection-overlay')?.remove();
  if(!pairs.length) return;
  const paths=[];
  for(const pair of pairs){
    const inboundEl=board.querySelector(`.flight-block[data-flight-id="${CSS.escape(pair.inbound.id)}"]`);
    const outboundEl=board.querySelector(`.flight-block[data-flight-id="${CSS.escape(pair.outbound.id)}"]`);
    if(!inboundEl||!outboundEl) continue;
    const from=inboundEl.getBoundingClientRect(),to=outboundEl.getBoundingClientRect();
    const x1=from.right-boardRect.left;
    const y1=from.top+from.height*.5-boardRect.top;
    const x2=to.left-boardRect.left;
    const y2=to.top+to.height*.5-boardRect.top;
    if(!Number.isFinite(x1+y1+x2+y2)) continue;
    const midX=(x1+x2)/2,midY=(y1+y2)/2;
    const curve=Math.max(32,Math.abs(x2-x1)*.38);
    const c1=x1+curve,c2=x2-curve;
    const tone=scheduleConnectionTone(pair.connection);
    const focusClass=pair.focused||pair.selected?'focus':'';
    const title=[
      `${pair.inbound.id} to ${pair.outbound.id}`,
      `${pair.connection.pax||0} connecting passengers`,
      `${Math.round(pair.connection.availableMin||0)} min available / ${Math.round(pair.connection.mctMin||0)} min MCT`,
      pair.connection.status==='protected'?'protected connection':pair.connection.status
    ].join(' · ');
    paths.push(`<g class="schedule-passenger-connection ${esc(tone)} ${esc(focusClass)}" data-connection-inbound="${esc(pair.inbound.id)}" data-connection-outbound="${esc(pair.outbound.id)}">
      <path class="schedule-connection-path ${esc(tone)} ${esc(focusClass)}" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1.toFixed(1)} ${y1.toFixed(1)}, ${c2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" marker-end="url(#connection-arrow-${esc(tone)})"><title>${esc(title)}</title></path>
      <text class="schedule-passenger-connection-label ${esc(tone)} ${esc(focusClass)}" x="${midX.toFixed(1)}" y="${(midY-7).toFixed(1)}"><title>${esc(title)}</title>${esc(scheduleConnectionLabel(pair.connection))}</text>
    </g>`);
  }
  if(!paths.length) return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','schedule-connection-overlay');
  svg.setAttribute('width',String(width));
  svg.setAttribute('height',String(height));
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.innerHTML=`<defs>
    <marker id="connection-arrow-protected" viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#7fd6e8"></path></marker>
    <marker id="connection-arrow-at-risk" viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#e1bd5a"></path></marker>
    <marker id="connection-arrow-critical" viewBox="0 0 8 8" markerWidth="6" markerHeight="6" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#df5e72"></path></marker>
  </defs>${paths.join('')}`;
  board.appendChild(svg);
  svg.querySelectorAll('[data-connection-inbound]').forEach(element=>element.addEventListener('click',event=>{
    event.stopPropagation();
    contextMode='context';
    settleSelectedFlight(element.dataset.connectionInbound);
  }));
}
function scheduleAircraftRowBadges(aircraft,flights,lateInboundById,now=simNow()){
  if(!flights.length) return '';
  let delayed=0,incidents=0,lateInbound=0,night=0,cancelled=0,shortTurns=0;
  for(let i=0;i<flights.length;i++){
    const flight=flights[i];
    if(flight.cancelled){ cancelled++; continue; }
    if(flightTotalDepartureDelayMin(flight)>0||flightArrivalDelayMin(flight)>0) delayed++;
    if(openIncidentsForFlight(flight.id).length) incidents++;
    if(lateInboundById.get(flight.id)) lateInbound++;
    if(scheduleNightMarkerInfo(flight)) night++;
  }
  const scheduledFlights=flights.filter(flight=>!flight.cancelled).sort((a,b)=>a.departure-b.departure||a.id.localeCompare(b.id));
  for(let i=1;i<scheduledFlights.length;i++){
    if(turnaroundGapInfo(scheduledFlights[i-1],scheduledFlights[i],aircraft)?.plannedBelowMinimum) shortTurns++;
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
  const operationalRelevant=relevant.filter(flight=>!flight.cancelled);
  const operationalRelevantIds=new Set(operationalRelevant.map(flight=>flight.id));
  const relevantByAircraft=new Map();
  for(const flight of relevant) mapPush(relevantByAircraft,flight.aircraftId,flight);
  for(const flights of relevantByAircraft.values()) flights.sort((a,b)=>flightActualDeparture(a)-flightActualDeparture(b));
  const dutyByAircraft=new Map();
  for(const duty of state.crewDuties||[]){
    const renderDuty=scheduleRenderableCrewDuty(duty);
    if(!renderDuty||renderDuty.dutyEnd<=start||renderDuty.dutyStart>=end) continue;
    if(!(renderDuty.flightIds||[]).some(id=>operationalRelevantIds.has(id))) continue;
    mapPush(dutyByAircraft,renderDuty.aircraftId,renderDuty);
  }
  const lateInboundWarnings=scheduleLateInboundWarnings(operationalRelevant,now,index);
  const lateInboundById=new Map(lateInboundWarnings.map(item=>[item.flight.id,item.status]));
  const nightWindowCache=new Map();
  updateScheduleAlerts(lateInboundWarnings);
  const visibleAircraft=operationFilterActive()
    ? state.aircraft.filter(ac=>relevantByAircraft.has(ac.id))
    : state.aircraft;
  const signature=[Math.floor(start/MIN),scheduleRangeHours,operationFilterSummary(),selectedFlightId||'',selectedAircraftId||'',Array.from(focusIds).sort().join(','),relevant.map(f=>`${f.id}:${flightActualDeparture(f)}:${flightActualArrival(f)}:${f.aircraftId}:${flightSlotImpactState(f,now).state}:${f.assignedSlot||0}:${f.cancelled?1:0}:${f.crewDutyId||''}:${f.crewDutySplit?1:0}:${f.nightRestrictionDelayMin||0}:${f.nightRestrictionLabel||''}:${f.nightRestrictionConflictDelayMin||0}:${f.nightRestrictionConflictLabel||''}:${scheduleFlightHasTimingShift(f)?1:0}:${lateInboundById.get(f.id)?.delayMin||0}:${lateInboundById.get(f.id)?.inboundReadyAt||0}:${openIncidentsForFlight(f.id).length}`).join(','),(state.crewDuties||[]).map(d=>`${d.id}:${d.dutyStart}:${d.dutyEnd}:${d.legal?1:0}:${d.status}`).join(','),visibleAircraft.map(a=>`${a.id}:${a.maintenance?.scheduled?.start||0}:${a.maintenance?.scheduled?.end||0}:${a.maintenance?.scheduled?.status||''}`).join(',')].join('|');
  if(force||signature!==lastScheduleSignature){
    lastScheduleSignature=signature;
    if(typeof noteRenderSurface==='function') noteRenderSurface('schedule','rendered');
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
      const operationalFlights=flights.filter(flight=>!flight.cancelled);
      const nightItems=scheduleNightWindowLaneItems(operationalFlights,nightWindowCache,focusIds);
      const nightLaneCount=Math.max(1,...nightItems.map(item=>item.lane+1));
      const rowHeight=90+Math.max(0,dutyLaneCount-1)*17+Math.max(0,nightLaneCount-1)*16;
      const rowBadges=scheduleAircraftRowBadges(ac,flights,lateInboundById,now);
      html+=`<div class="sched-aircraft-row ${flights.some(f=>focusIds.has(f.id))?'selected-row':''}" data-sched-aircraft="${esc(ac.id)}" style="height:${rowHeight}px;--crew-duty-lanes:${dutyLaneCount};--night-lanes:${nightLaneCount}"><div class="sched-label"><div class="sched-tail">${esc(ac.tail)}</div><div class="sched-model">${esc(ac.model)}</div>${rowBadges}</div><div class="sched-timearea" style="width:${timeWidth}px">`;
      for(let h=0;h<=scheduleRangeHours;h++) html+=`<span class="sched-gridline ${new Date(start+h*HOUR).getHours()%6===0?'major':''}" style="left:${h*pxPerHour}px"></span>`;
      html+=scheduleMaintenanceJobMarkup(ac,ac.maintenance?.scheduled,start,end,pxPerHour);
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
        const night=f.cancelled?null:scheduleNightMarkerInfo(f);
        const lateInbound=f.cancelled?null:lateInboundById.get(f.id);
        const positionContext=f.positioningBlocked?aircraftOutOfPositionContextForFlight(f):null;
        const openIncidents=openIncidentsForFlight(f.id);
        if(!f.cancelled&&f.departure>=start&&f.departure<=end){
          const markerLeft=(f.departure-start)/HOUR*pxPerHour;
          const slot=flightSlotImpactState(f,now);
          html+=`<span class="slot-marker planned ${slot.impacted?slot.state:''} ${focusClass} ${selected?'selected':''}" data-slot-flight="${esc(f.id)}" title="${esc(slot.title||`${f.from} planned slot ${shortClock(f.departure)}`)}" style="left:${markerLeft}px"><span class="slot-label">${esc(`${f.id} ${shortClock(f.departure)}`)}</span></span>`;
        }
        if(!f.cancelled&&f.slotMissed&&f.assignedSlot>=start&&f.assignedSlot<=end) html+=`<span class="slot-marker reassigned ${focusClass} ${selected?'selected':''}" data-slot-flight="${esc(f.id)}" title="${esc(`${f.from} reassigned slot ${shortClock(f.assignedSlot)}`)}" style="left:${(f.assignedSlot-start)/HOUR*pxPerHour}px"><span class="slot-label">${esc(`${f.id} ${shortClock(f.assignedSlot)}`)}</span></span>`;
        const shifted=scheduleFlightHasTimingShift(f);
        if(!f.cancelled&&shifted&&focused){
          const plannedStart=Math.max(start,f.departure),plannedEnd=Math.min(end,f.arrival);
          if(plannedEnd>plannedStart) html+=`<div class="planned-flight-block ${night&&!night.className?'has-night-marker':''} ${focusClass} ${selected?'selected':''}" data-flight-id="${esc(f.id)}" title="${esc(`${f.id} planned ${shortClock(f.departure)}–${shortClock(f.arrival)}${night&&!night.className?` · ${night.title}`:''}`)}" style="left:${(plannedStart-start)/HOUR*pxPerHour}px;width:${Math.max(6,(plannedEnd-plannedStart)/HOUR*pxPerHour)}px"><span class="planned-flight-label">${esc(`${f.id} ${shortClock(f.departure)}`)}</span>${night&&!night.className?`<span class="flight-night-marker" title="${esc(night.title)}">${esc(night.label)}</span>`:''}</div>`;
        }
        const delayAnalysis=flightDelayAnalysis(f,index);
        const flightTitle=[
          ...(delayAnalysis.active?delayAnalysis.tooltipLines:[`${f.id} · ${f.from} → ${destination}`,shifted?`Planned ${shortClock(f.departure)}–${shortClock(f.arrival)} · Actual ${shortClock(actualDep)}–${shortClock(actualArr)}`:null]),
          f.cancelled&&f.cancellationReason?`Cancelled: ${f.cancellationReason}`:null,
          openIncidents.length?`Open incident${openIncidents.length===1?'':'s'}: ${openIncidents.map(incident=>incident.title||incident.type).join(' · ')}`:null,
          positionContext?`Aircraft positioning: expected ${positionContext.expectedLocation}, required ${positionContext.requiredLocation}`:null,
          lateInbound?.title,
          night?.title
        ].filter(Boolean).join('\n');
        if(clippedEnd>clippedStart) html+=`<div class="flight-block ${st} ${shifted?'shifted':''} ${openIncidents.length?'has-incident':''} ${lateInbound?'late-inbound-risk':''} ${positionContext?'positioning-conflict':''} ${night?'has-night-marker':''} ${focusClass} ${selected?'selected':''}" data-flight-id="${esc(f.id)}" title="${esc(flightTitle)}" style="left:${left}px;width:${width}px"><div class="flight-code">${esc(f.id)}${delay?` <span class="delay-text">+${delay}</span>`:''}</div>${lateInbound?`<span class="flight-late-inbound" title="${esc(lateInbound.title)}">IN</span>`:''}${night?`<span class="flight-night-marker ${esc(night.className||'')}" title="${esc(night.title)}">${esc(night.label)}</span>`:''}<div class="flight-route">${esc(f.from)} → ${esc(destination)}</div><div class="flight-times">${shifted?`<span class="sched">S ${shortClock(f.departure)}</span> · <span class="actual">A ${shortClock(actualDep)}</span>`:`${shortClock(actualDep)}–${shortClock(actualArr)}`}</div></div>`;
        const next=flights[i+1];
        if(next&&!f.cancelled&&!next.cancelled){
          const nextDep=flightActualDeparture(next),gapMs=nextDep-actualArr,turn=turnaroundGapInfo(f,next,ac);
          const connectorShortTurn=Boolean(turn?.plannedBelowMinimum),drawPositiveGap=nextDep>actualArr;
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
    lastScheduleConnectionOverlaySignature='';
    board.onclick=event=>{
      if(!selectedFlightId) return;
      if(event.target.closest('[data-flight-id],[data-slot-flight],[data-crew-duty]')) return;
      clearOperationalSelection();
    };
    board.querySelectorAll('[data-flight-id]').forEach(element=>element.addEventListener('click',()=>{contextMode='context';settleSelectedFlight(element.dataset.flightId);}));
    board.querySelectorAll('[data-slot-flight]').forEach(element=>element.addEventListener('click',event=>{event.stopPropagation();contextMode='context';settleSelectedFlight(element.dataset.slotFlight);}));
    board.querySelectorAll('[data-sched-aircraft]').forEach(row=>row.addEventListener('dblclick',()=>{contextMode='context';settleSelected(row.dataset.schedAircraft);}));
    if(selectedFlightId) requestAnimationFrame(scrollSelectedScheduleFlightIntoView);
  }else{
    if(typeof noteRenderSurface==='function') noteRenderSurface('schedule','skipped');
  }
  renderScheduleConnectionOverlay(board,schedulePassengerConnectionPairs(operationalRelevant,focusIds,now));
  updateScheduleNowLine();
  document.getElementById('schedule-window-label').textContent=`${shortDay(start)} ${shortClock(start)}  →  ${shortDay(end)} ${shortClock(end)}`;
}
function updateScheduleNowLine(){
  const {start,end,now}=scheduleWindow(),x=(now-start)/HOUR*(scheduleRangeHours===24?84:48),visible=now>=start&&now<=end;
  const header=document.getElementById('scheduleNowHeader'); if(header){header.style.display=visible?'block':'none';header.style.left=x+'px';}
  document.querySelectorAll('.schedule-now-row').forEach(line=>{line.style.display=visible?'block':'none';line.style.left=x+'px';});
}
function centerScheduleOnNow(){ scheduleWindowOffsetHours=-2;markUiDirty('schedule');document.getElementById('schedule-scroll').scrollLeft=0; }
