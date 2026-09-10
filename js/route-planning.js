/* Waypoint route planning, active route revisions, and per-flight route weather. */
(function(global){
  const EARTH_KM=6371;
  const ROUTE_MIN=60_000;
  const ROUTE_HOUR=60*ROUTE_MIN;
  const routeWeatherCache=new Map();
  let weatherCellsProvider=null;

  function finite(value,fallback=0){ return Number.isFinite(Number(value))?Number(value):fallback; }
  function clampRoute(value,min,max){ return Math.max(min,Math.min(max,value)); }
  function stableUnit(seed){
    if(typeof stableCatalogUnit==='function') return stableCatalogUnit(seed);
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }
  function airportPoint(code){
    const airport=AIRPORTS?.[code];
    return airport?{lat:airport.lat,lon:airport.lon,code}:null;
  }
  function modelForFlight(flight,aircraftOrModel=null){
    if(aircraftOrModel?.speedKmh) return aircraftOrModel;
    if(aircraftOrModel?.model&&MODELS[aircraftOrModel.model]) return MODELS[aircraftOrModel.model];
    const aircraft=(typeof state!=='undefined'&&state.aircraft||[]).find(item=>item.id===flight?.aircraftId);
    return aircraft&&MODELS[aircraft.model] ? MODELS[aircraft.model] : Object.values(MODELS||{})[0];
  }
  function aircraftForFlight(flight){
    return (typeof state!=='undefined'&&state.aircraft||[]).find(item=>item.id===flight?.aircraftId)||null;
  }
  function destinationForFlight(flight){
    return typeof flightOperationalDestination==='function' ? flightOperationalDestination(flight) : (flight?.diversionAirport||flight?.to);
  }
  function normalizeLon(lon){ return ((lon+540)%360)-180; }
  function offsetPoint(point,heading,distanceKm){
    if(!point) return null;
    const radValue=typeof rad==='function'?rad:function(value){return value*Math.PI/180;};
    const degValue=typeof deg==='function'?deg:function(value){return value*180/Math.PI;};
    const b=radValue(heading),lat1=radValue(point.lat),lon1=radValue(point.lon),d=distanceKm/EARTH_KM;
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(b));
    const lon2=lon1+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return {lat:degValue(lat2),lon:normalizeLon(degValue(lon2))};
  }
  function routeWaypoint(id,label,point,kind='fix',airport=''){
    return {
      id:String(id),
      label:String(label||id),
      kind,
      airport,
      lat:Math.round(point.lat*100000)/100000,
      lon:Math.round(point.lon*100000)/100000
    };
  }
  function distanceBetween(a,b){
    return typeof distanceKm==='function' ? distanceKm(a,b) : 0;
  }
  function bearingBetween(a,b){
    return typeof bearing==='function' ? bearing(a,b) : 0;
  }
  function gcPoint(a,b,pct){
    return typeof interpolateGreatCircle==='function'
      ? interpolateGreatCircle(a,b,pct)
      : {lat:a.lat+(b.lat-a.lat)*pct,lon:a.lon+(b.lon-a.lon)*pct};
  }
  function waypointCountForDistance(km,mode='filed'){
    if(mode==='direct') return Math.max(0,Math.min(4,Math.round(km/1600)));
    return Math.max(0,Math.min(12,Math.round(km/700)));
  }
  function syntheticFixLabel(from,to,index,total){
    const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const seed=`${from}:${to}:${index}:${total}`;
    const a=letters[Math.floor(stableUnit(`${seed}:a`)*letters.length)]||'A';
    const b=letters[Math.floor(stableUnit(`${seed}:b`)*letters.length)]||'R';
    return `${a}${b}${String(index).padStart(2,'0')}`;
  }
  function buildRouteBetweenPoints(start,end,{fromCode='',toCode='',mode='filed',seed='',startKind='airport',endKind='airport',startLabel='',endLabel='',via=[]}={}){
    if(!start||!end) return [];
    const directKm=distanceBetween(start,end);
    const heading=bearingBetween(start,end);
    const waypoints=[
      routeWaypoint(startCodeLabel(fromCode,startLabel,'POS'),startLabel||fromCode||'POS',start,startKind,fromCode)
    ];
    const intermediates=[];
    const count=waypointCountForDistance(directKm,mode);
    for(let index=1;index<=count;index++){
      const pct=index/(count+1);
      const base=gcPoint(start,end,pct);
      const lateralMax=mode==='direct'?28:Math.min(190,Math.max(24,directKm*.035));
      const lateral=(stableUnit(`${seed}:${index}:side`)<.5?-1:1)*stableUnit(`${seed}:${index}:offset`)*lateralMax;
      const point=offsetPoint(base,heading+90,lateral)||base;
      intermediates.push(routeWaypoint(
        syntheticFixLabel(fromCode||'P',toCode||'D',index,count),
        syntheticFixLabel(fromCode||'P',toCode||'D',index,count),
        point,
        'fix'
      ));
    }
    for(const fix of via||[]){
      if(fix&&Number.isFinite(fix.lat)&&Number.isFinite(fix.lon)){
        intermediates.push(routeWaypoint(fix.id||fix.label||'VIA',fix.label||fix.id||'VIA',fix,fix.kind||'fix',fix.airport||''));
      }
    }
    intermediates.sort((a,b)=>distanceBetween(start,a)-distanceBetween(start,b));
    waypoints.push(...intermediates);
    waypoints.push(routeWaypoint(toCode||endLabel||'DEST',endLabel||toCode||'DEST',end,endKind,toCode));
    return compactWaypoints(waypoints);
  }
  function startCodeLabel(code,label,fallback){
    return code||label||fallback;
  }
  function compactWaypoints(waypoints){
    const out=[];
    for(const waypoint of waypoints){
      const previous=out[out.length-1];
      if(previous&&distanceBetween(previous,waypoint)<2) continue;
      out.push(waypoint);
    }
    return out;
  }
  function routeDistanceKmForWaypoints(waypoints){
    let total=0;
    for(let index=1;index<(waypoints||[]).length;index++) total+=distanceBetween(waypoints[index-1],waypoints[index]);
    return total;
  }
  function cruiseLevelForDistance(km,model,seed){
    const long=km>5200,medium=km>1800;
    const base=long?350:medium?330:270;
    const step=Math.floor(stableUnit(`${seed}:level`)*3)*20;
    const cap=String(model?.segment||'').includes('Regional')?330:410;
    return `FL${Math.min(cap,base+step)}`;
  }
  function altitudeProfileForRoute(waypoints,model,seed){
    const km=routeDistanceKmForWaypoints(waypoints);
    const cruiseLevel=cruiseLevelForDistance(km,model,seed);
    const climbEnd=km<700?.28:.18;
    const descentStart=km<700?.72:.84;
    return {
      cruiseLevel,
      profile:[
        {phase:'climb',fromPct:0,toPct:climbEnd},
        {phase:'cruise',fromPct:climbEnd,toPct:descentStart},
        {phase:'descent',fromPct:descentStart,toPct:1}
      ]
    };
  }
  function buildRevision({flight,fromCode,toCode,startPoint,endPoint,mode='filed',reason='Filed route',createdAt=null,startKind='airport',endKind='airport',startLabel='',endLabel='',via=[]}){
    const model=modelForFlight(flight);
    const created=finite(createdAt,typeof simNow==='function'?simNow():Date.now());
    const seed=`${flight?.id||fromCode}-${fromCode}-${toCode}-${created}-${mode}`;
    const waypoints=buildRouteBetweenPoints(startPoint,endPoint,{fromCode,toCode,mode,seed,startKind,endKind,startLabel,endLabel,via});
    const distanceKm=Math.round(routeDistanceKmForWaypoints(waypoints));
    const directDistanceKm=Math.round(distanceBetween(startPoint,endPoint));
    const altitude=altitudeProfileForRoute(waypoints,model,seed);
    return {
      id:'',
      mode,
      reason,
      from:fromCode||'',
      to:toCode||'',
      createdAt:created,
      activatedAt:created,
      startKind,
      distanceKm,
      directDistanceKm,
      waypoints,
      altitude,
      cruiseLevel:altitude.cruiseLevel
    };
  }
  function buildFiledRoutePlan(flight,aircraftOrModel=null){
    if(!flight) return null;
    const from=flight.from,to=destinationForFlight(flight);
    const start=airportPoint(from),end=airportPoint(to);
    if(!start||!end) return null;
    const model=modelForFlight(flight,aircraftOrModel);
    const revision=buildRevision({
      flight,fromCode:from,toCode:to,startPoint:start,endPoint:end,
      mode:'filed',reason:'Filed operational route',
      createdAt:flight.departure||Date.now()
    });
    revision.id='R1';
    revision.plannedDeparture=flight.departure;
    revision.plannedArrival=flight.arrival;
    revision.blockTimeMin=Math.round(((flight.operationalDurationMs||flight.arrival-flight.departure)||flightDurationMs(start,end,model))/ROUTE_MIN);
    return {
      id:`RP-${flight.id}`,
      flightId:flight.id,
      createdAt:revision.createdAt,
      activeRevisionId:revision.id,
      revisions:[revision]
    };
  }
  function activeRevision(routePlan){
    const revisions=Array.isArray(routePlan?.revisions)?routePlan.revisions:[];
    return revisions.find(item=>item.id===routePlan.activeRevisionId)||revisions[revisions.length-1]||null;
  }
  function ensureFlightRoutePlan(flight,aircraftOrModel=null,{force=false}={}){
    if(!flight||flight.cancelled) return null;
    const current=flight.routePlan&&typeof flight.routePlan==='object'?flight.routePlan:null;
    const revision=current&&!force?activeRevision(current):null;
    if(revision?.waypoints?.length>=2){
      return current;
    }
    const plan=buildFiledRoutePlan(flight,aircraftOrModel||aircraftForFlight(flight));
    if(plan) flight.routePlan=plan;
    return plan;
  }
  function routeCoordinatesForRevision(revision){
    return (revision?.waypoints||[]).map(point=>[point.lon,point.lat]);
  }
  function routeCoordinatesForFlight(flight){
    const plan=ensureFlightRoutePlan(flight);
    const revision=activeRevision(plan);
    if(revision?.waypoints?.length>=2) return routeCoordinatesForRevision(revision);
    const from=AIRPORTS?.[flight?.from],to=AIRPORTS?.[destinationForFlight(flight)];
    return from&&to&&typeof routeCoords==='function'?routeCoords(from,to,80):[];
  }
  function pointAtDistance(waypoints,targetKm){
    if(!waypoints?.length) return null;
    if(waypoints.length===1||targetKm<=0) return {...waypoints[0]};
    let covered=0;
    for(let index=1;index<waypoints.length;index++){
      const a=waypoints[index-1],b=waypoints[index];
      const segmentKm=Math.max(.001,distanceBetween(a,b));
      if(covered+segmentKm>=targetKm){
        const pct=clampRoute((targetKm-covered)/segmentKm,0,1);
        const point=gcPoint(a,b,pct);
        return {...point,heading:bearingBetween(point,b),segmentIndex:index-1};
      }
      covered+=segmentKm;
    }
    const previous=waypoints[waypoints.length-2],last=waypoints[waypoints.length-1];
    return {...last,heading:bearingBetween(previous,last),segmentIndex:waypoints.length-2};
  }
  function routeProgressForFlight(flight,t){
    if(!flight) return 0;
    if(typeof flightMovementTimes==='function'){
      const movement=flightMovementTimes(flight);
      return clampRoute((t-movement.takeoffAt)/(movement.landingAt-movement.takeoffAt||1),0,1);
    }
    const dep=typeof flightActualDeparture==='function'?flightActualDeparture(flight):flight.actualDeparture||flight.departure;
    const arr=typeof flightActualArrival==='function'?flightActualArrival(flight):flight.actualArrival||flight.arrival;
    return clampRoute((t-dep)/(arr-dep||1),0,1);
  }
  function sampleRoutePosition(flight,t){
    const plan=ensureFlightRoutePlan(flight);
    const revision=activeRevision(plan);
    if(!revision?.waypoints?.length) return null;
    const progress=routeProgressForFlight(flight,t);
    const point=pointAtDistance(revision.waypoints,(revision.distanceKm||routeDistanceKmForWaypoints(revision.waypoints))*progress);
    return point?{lat:point.lat,lon:point.lon,heading:point.heading||0,revisionId:revision.id,progress}:null;
  }
  function splitRouteCoordinatesForFlight(flight,t){
    const plan=ensureFlightRoutePlan(flight);
    const revision=activeRevision(plan);
    const waypoints=revision?.waypoints||[];
    if(waypoints.length<2) return {flown:[],remaining:[],progress:0,revisionId:''};
    const totalDistance=revision.distanceKm||routeDistanceKmForWaypoints(waypoints);
    const progress=routeProgressForFlight(flight,t);
    if(progress<=0) return {flown:[],remaining:routeCoordinatesForRevision(revision),progress,revisionId:revision.id};
    if(progress>=1) return {flown:routeCoordinatesForRevision(revision),remaining:[],progress,revisionId:revision.id};
    const targetKm=totalDistance*progress;
    const current=pointAtDistance(waypoints,targetKm);
    if(!current) return {flown:[],remaining:routeCoordinatesForRevision(revision),progress,revisionId:revision.id};
    const flown=[waypoints[0]];
    const remaining=[];
    let covered=0,inserted=false;
    for(let index=1;index<waypoints.length;index++){
      const a=waypoints[index-1],b=waypoints[index];
      const segmentKm=Math.max(.001,distanceBetween(a,b));
      if(!inserted&&covered+segmentKm>=targetKm){
        flown.push(current);
        remaining.push(current,b);
        inserted=true;
      }else if(!inserted){
        flown.push(b);
      }else{
        remaining.push(b);
      }
      covered+=segmentKm;
    }
    return {
      flown:routeCoordinatesForRevision({waypoints:compactWaypoints(flown)}),
      remaining:routeCoordinatesForRevision({waypoints:compactWaypoints(remaining)}),
      progress,
      revisionId:revision.id
    };
  }
  function remainingRouteDistanceKm(flight,t){
    const revision=activeRevision(ensureFlightRoutePlan(flight));
    if(!revision) return 0;
    return Math.max(0,(revision.distanceKm||routeDistanceKmForWaypoints(revision.waypoints))*(1-routeProgressForFlight(flight,t)));
  }
  function pointToSegmentKm(point,start,end){
    const midLat=(start.lat+end.lat+point.lat)/3*Math.PI/180;
    const scaleX=111.32*Math.cos(midLat),scaleY=110.57;
    const px=point.lon*scaleX,py=point.lat*scaleY;
    const ax=start.lon*scaleX,ay=start.lat*scaleY;
    const bx=end.lon*scaleX,by=end.lat*scaleY;
    const dx=bx-ax,dy=by-ay;
    const lengthSq=dx*dx+dy*dy;
    const t=lengthSq?clampRoute(((px-ax)*dx+(py-ay)*dy)/lengthSq,0,1):0;
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  function routeHazardsForWaypoints(waypoints,timestamp){
    if(!waypoints?.length||!global.AeroWeatherEngine?.weatherCells) return [];
    const cells=global.AeroWeatherEngine.weatherCells(timestamp);
    return cells.map(cell=>{
      let minDistance=Infinity,segmentIndex=0;
      for(let index=1;index<waypoints.length;index++){
        const distance=pointToSegmentKm(cell,waypoints[index-1],waypoints[index]);
        if(distance<minDistance){ minDistance=distance; segmentIndex=index-1; }
      }
      return {...cell,distanceKm:minDistance,segmentIndex};
    })
      .filter(cell=>cell.distanceKm<cell.radiusKm)
      .map(cell=>({
        ...cell,
        routeImpact:clampRoute(1-cell.distanceKm/cell.radiusKm,0,1),
        delayMin:Math.max(4,Math.round(cell.delayMin*clampRoute(1-cell.distanceKm/cell.radiusKm,.25,1)))
      }))
      .sort((a,b)=>b.delayMin-a.delayMin||a.distanceKm-b.distanceKm)
      .slice(0,4);
  }
  function mergeHazards(hazards){
    const byId=new Map();
    for(const hazard of hazards){
      const existing=byId.get(hazard.id);
      if(!existing||hazard.delayMin>existing.delayMin) byId.set(hazard.id,hazard);
    }
    return [...byId.values()].sort((a,b)=>b.delayMin-a.delayMin||a.distanceKm-b.distanceKm).slice(0,4);
  }
  function routeHazardSummaryForRevision(revision,timestamp,{forecast=false,durationMs=0}={}){
    if(!revision?.waypoints?.length) return {hazards:[],delayMin:0,severe:false,label:'',level:'normal',routeRevisionId:revision?.id||''};
    if(global.AeroWeatherEngine?.weatherCells!==weatherCellsProvider){
      routeWeatherCache.clear();
      weatherCellsProvider=global.AeroWeatherEngine?.weatherCells||null;
    }
    const bucket=Math.floor(timestamp/(30*ROUTE_MIN));
    const first=revision.waypoints[0],last=revision.waypoints[revision.waypoints.length-1];
    const routeKey=`${revision.id}:${revision.from}:${revision.to}:${revision.createdAt}:${first.lat},${first.lon}:${last.lat},${last.lon}:${revision.waypoints.length}`;
    const cacheKey=`${routeKey}:${bucket}:${forecast?1:0}:${Math.round(durationMs/ROUTE_MIN)}`;
    if(routeWeatherCache.has(cacheKey)) return routeWeatherCache.get(cacheKey);
    const sampleTimes=forecast&&durationMs>2*ROUTE_HOUR
      ? [timestamp,timestamp+durationMs*.35,timestamp+durationMs*.7]
      : [timestamp];
    const hazards=mergeHazards(sampleTimes.flatMap(time=>routeHazardsForWaypoints(revision.waypoints,time)));
    const delayMin=hazards.reduce((sum,item)=>sum+item.delayMin,0);
    const severe=hazards.some(item=>item.severity==='severe');
    const summary={
      hazards,
      delayMin,
      severe,
      label:hazards[0]?.label||'',
      level:severe?'severe':hazards.length?'caution':'normal',
      routeRevisionId:revision.id,
      routeMode:revision.mode
    };
    routeWeatherCache.set(cacheKey,summary);
    if(routeWeatherCache.size>600) routeWeatherCache.delete(routeWeatherCache.keys().next().value);
    return summary;
  }
  function routeHazardSummaryForFlight(flight,timestamp,{forecast=false}={}){
    const revision=activeRevision(ensureFlightRoutePlan(flight));
    if(revision){
      const dep=typeof flightActualDeparture==='function'?flightActualDeparture(flight):flight.actualDeparture||flight.departure||timestamp;
      const arr=typeof flightActualArrival==='function'?flightActualArrival(flight):flight.actualArrival||flight.arrival||timestamp;
      return routeHazardSummaryForRevision(revision,timestamp,{forecast,durationMs:Math.max(0,arr-dep)});
    }
    const destination=destinationForFlight(flight);
    return global.AeroWeatherEngine?.routeHazardSummary?.(flight.from,destination,timestamp)||{hazards:[],delayMin:0,severe:false,label:'',level:'normal'};
  }
  function detourWaypointForHazard(start,end,hazard,seed){
    if(!hazard||!Number.isFinite(hazard.lat)||!Number.isFinite(hazard.lon)) return null;
    const routeHeading=bearingBetween(start,end);
    const side=stableUnit(`${seed}:detour-side`)<.5?-1:1;
    const distance=Math.max(60,Math.min(520,(hazard.radiusKm||120)*1.25));
    const point=offsetPoint(hazard,routeHeading+90*side,distance);
    return point?routeWaypoint(`${hazard.id||'WX'}-AVD`,'WX avoid',point,'weather_avoidance'):null;
  }
  function createRouteRevision(flight,{mode='direct',reason='',toAirport='',hazards=[],createdAt=null,metadata={}}={}){
    if(!flight||flight.cancelled) return null;
    const aircraft=aircraftForFlight(flight);
    const model=modelForFlight(flight,aircraft);
    const plan=ensureFlightRoutePlan(flight,aircraft)||buildFiledRoutePlan(flight,aircraft);
    if(!plan) return null;
    const previous=activeRevision(plan);
    const created=finite(createdAt,typeof simNow==='function'?simNow():Date.now());
    const targetCode=toAirport||destinationForFlight(flight);
    const end=airportPoint(targetCode);
    if(!end) return null;
    const airborne=typeof flightIsAirborne==='function'&&flightIsAirborne(flight,created);
    const routeSample=airborne?sampleRoutePosition(flight,created):null;
    const start=routeSample ? {lat:routeSample.lat,lon:routeSample.lon} : airportPoint(flight.from);
    if(!start) return null;
    const via=[];
    if(mode==='weather_detour'){
      const primaryHazard=(hazards||[]).find(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lon));
      const detour=detourWaypointForHazard(start,end,primaryHazard,`${flight.id}:${created}:${targetCode}`);
      if(detour) via.push(detour);
    }
    const revision=buildRevision({
      flight,
      fromCode:airborne?'':flight.from,
      toCode:targetCode,
      startPoint:start,
      endPoint:end,
      mode,
      reason:reason||routeReasonForMode(mode,targetCode),
      createdAt:created,
      startKind:airborne?'current_position':'airport',
      endKind:'airport',
      startLabel:airborne?'Current position':flight.from,
      endLabel:targetCode,
      via
    });
    revision.id=`R${(plan.revisions||[]).length+1}`;
    revision.previousRevisionId=previous?.id||'';
    revision.metadata=metadata||{};
    revision.startedAirborne=airborne;
    revision.createdDuringFlight=airborne;
    const oldRemaining=previous?remainingRouteDistanceKm(flight,created):revision.directDistanceKm;
    const newDistance=revision.distanceKm||routeDistanceKmForWaypoints(revision.waypoints);
    revision.remainingDistanceKm=Math.round(newDistance);
    revision.previousRemainingDistanceKm=Math.round(oldRemaining);
    revision.deltaDistanceKm=Math.round(newDistance-oldRemaining);
    revision.estimatedTimeDeltaMin=Math.round((newDistance-oldRemaining)/(model?.speedKmh||750)*60);
    plan.revisions??=[];
    plan.revisions.push(revision);
    plan.activeRevisionId=revision.id;
    flight.routePlan=plan;
    return revision;
  }
  function routeReasonForMode(mode,target){
    if(mode==='direct') return 'Direct routing revision';
    if(mode==='speed') return 'Cost-index recommendation; geometry unchanged';
    if(mode==='priority') return 'Priority recovery route revision';
    if(mode==='weather_detour') return 'Weather avoidance routing';
    if(mode==='return_origin') return `Return route to ${target}`;
    if(mode==='diversion') return `Diversion route to ${target}`;
    return 'Operational route revision';
  }
  function applyDiversionRouteRevision(flight,airport,{incident=null,mode='',reason=''}={}){
    if(!flight||!airport) return null;
    const selectedMode=mode || (airport===flight.from?'return_origin':'diversion');
    return createRouteRevision(flight,{
      mode:selectedMode,
      toAirport:airport,
      reason:reason || (selectedMode==='return_origin'?`Return to ${airport}`:`Diversion to ${airport}`),
      createdAt:typeof simNow==='function'?simNow():Date.now(),
      metadata:{incidentId:incident?.id||'',incidentType:incident?.type||''}
    });
  }
  function noteRecoveryRouteRevision(flight,option,{accepted=true,t=null,hazards=[]}={}){
    if(!flight||!accepted) return null;
    const mode=option?.id||option?.option||option||'direct';
    if(mode==='speed') return null;
    return createRouteRevision(flight,{
      mode:mode==='priority'?'priority':'direct',
      reason:mode==='priority'?'Priority recovery route coordinated':'Direct routing coordinated',
      createdAt:t||simNow(),
      hazards,
      metadata:{source:'enroute_recovery',option:mode}
    });
  }
  function flightRouteSummary(flight){
    const plan=ensureFlightRoutePlan(flight);
    const revision=activeRevision(plan);
    if(!revision) return null;
    const waypoints=revision.waypoints||[];
    const routeLabels=waypoints
      .filter((_,index)=>index===0||index===waypoints.length-1||waypoints.length<=6||index%Math.ceil(waypoints.length/5)===0)
      .map(item=>item.label||item.id);
    return {
      revisionId:revision.id,
      mode:revision.mode,
      reason:revision.reason,
      distanceKm:revision.distanceKm||Math.round(routeDistanceKmForWaypoints(waypoints)),
      directDistanceKm:revision.directDistanceKm||0,
      waypointCount:waypoints.length,
      waypoints:waypoints.map(point=>({...point})),
      coordinates:routeCoordinatesForRevision(revision),
      cruiseLevel:revision.cruiseLevel||revision.altitude?.cruiseLevel||'',
      routeText:routeLabels.join(' → '),
      activeRevisionCount:Array.isArray(plan.revisions)?plan.revisions.length:1
    };
  }
  function revisionRouteSummary(revision){
    if(!revision) return null;
    const waypoints=(revision.waypoints||[]).map(point=>({...point}));
    return {
      revisionId:revision.id,
      mode:revision.mode,
      reason:revision.reason,
      from:revision.from||waypoints[0]?.label||'',
      to:revision.to||waypoints[waypoints.length-1]?.label||'',
      distanceKm:revision.distanceKm||Math.round(routeDistanceKmForWaypoints(waypoints)),
      directDistanceKm:revision.directDistanceKm||0,
      waypointCount:waypoints.length,
      waypoints,
      coordinates:routeCoordinatesForRevision(revision),
      cruiseLevel:revision.cruiseLevel||revision.altitude?.cruiseLevel||''
    };
  }
  function flightRouteComparison(flight,t=null){
    const plan=ensureFlightRoutePlan(flight);
    const revisions=Array.isArray(plan?.revisions)?plan.revisions:[];
    const filed=revisions[0]||null;
    const active=activeRevision(plan);
    if(!active) return null;
    return {
      flightId:flight?.id||'',
      revisionCount:revisions.length,
      revised:Boolean(filed&&active&&filed.id!==active.id),
      progress:t===null?0:routeProgressForFlight(flight,t),
      filed:revisionRouteSummary(filed),
      active:revisionRouteSummary(active)
    };
  }
  function previewRoute(from,to,aircraftOrModel,departure=Date.now()){
    const flight={id:`preview-${from}-${to}-${departure}`,from,to,departure,arrival:departure+(AIRPORTS[from]&&AIRPORTS[to]&&aircraftOrModel?flightDurationMs(AIRPORTS[from],AIRPORTS[to],modelForFlight(null,aircraftOrModel)):0)};
    const plan=buildFiledRoutePlan(flight,aircraftOrModel);
    const revision=activeRevision(plan);
    return revision?flightRouteSummary({...flight,routePlan:plan}):null;
  }

  global.AeroRoutePlanning={
    activeRevision,
    ensureFlightRoutePlan,
    buildFiledRoutePlan,
    createRouteRevision,
    applyDiversionRouteRevision,
    noteRecoveryRouteRevision,
    routeCoordinatesForFlight,
    routeCoordinatesForRevision,
    routeHazardSummaryForFlight,
    routeHazardSummaryForRevision,
    routeHazardsForWaypoints,
    clearRouteWeatherCache:()=>routeWeatherCache.clear(),
    routeDistanceKmForWaypoints,
    routeProgressForFlight,
    sampleRoutePosition,
    splitRouteCoordinatesForFlight,
    remainingRouteDistanceKm,
    flightRouteSummary,
    flightRouteComparison,
    previewRoute
  };
})(window);
