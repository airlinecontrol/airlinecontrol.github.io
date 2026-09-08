/* Deterministic simulated weather for airports, routes, and map overlays. */
(function(global){
  const MIN=60_000,HOUR=60*MIN;
  const PROFILE_DEFAULT={wind:16,risk:.2,climate:'temperate'};
  const PROFILES={
    FRA:{wind:18,risk:.22,climate:'continental'}, LHR:{wind:22,risk:.29,climate:'maritime'},
    JFK:{wind:21,risk:.25,climate:'continental'}, MAD:{wind:15,risk:.13,climate:'dry'},
    AMS:{wind:24,risk:.30,climate:'maritime'}, CDG:{wind:18,risk:.22,climate:'continental'},
    FCO:{wind:14,risk:.15,climate:'mediterranean'}, DXB:{wind:12,risk:.10,climate:'desert'},
    SIN:{wind:13,risk:.28,climate:'tropical'}, HND:{wind:18,risk:.26,climate:'coastal'},
    MUC:{wind:17,risk:.24,climate:'continental'}, ZRH:{wind:16,risk:.22,climate:'alpine'},
    VIE:{wind:17,risk:.21,climate:'continental'}, IST:{wind:20,risk:.22,climate:'coastal'},
    BCN:{wind:16,risk:.17,climate:'mediterranean'}, LIS:{wind:23,risk:.24,climate:'maritime'},
    OSL:{wind:19,risk:.30,climate:'nordic'}, ARN:{wind:18,risk:.28,climate:'nordic'},
    HEL:{wind:18,risk:.30,climate:'nordic'}, DOH:{wind:14,risk:.11,climate:'desert'},
    CPH:{wind:22,risk:.29,climate:'maritime'}, BRU:{wind:20,risk:.27,climate:'maritime'},
    WAW:{wind:17,risk:.23,climate:'continental'}, PRG:{wind:16,risk:.21,climate:'continental'},
    ATH:{wind:18,risk:.16,climate:'mediterranean'},
    EWR:{wind:22,risk:.27,climate:'continental'}, LGW:{wind:21,risk:.28,climate:'maritime'},
    ORY:{wind:17,risk:.21,climate:'continental'}, NRT:{wind:19,risk:.28,climate:'coastal'},
    AUH:{wind:13,risk:.10,climate:'desert'}, MXP:{wind:13,risk:.22,climate:'continental'},
    DUS:{wind:18,risk:.25,climate:'continental'},
    ATL:{wind:16,risk:.24,climate:'continental'}, ORD:{wind:24,risk:.29,climate:'continental'},
    DFW:{wind:21,risk:.24,climate:'continental'}, DEN:{wind:22,risk:.28,climate:'highland'},
    LAX:{wind:14,risk:.15,climate:'coastal'}, SFO:{wind:22,risk:.30,climate:'coastal'},
    BOS:{wind:23,risk:.30,climate:'maritime'}, IAD:{wind:17,risk:.23,climate:'continental'},
    MIA:{wind:18,risk:.35,climate:'tropical'}, YYZ:{wind:21,risk:.28,climate:'continental'},
    SEA:{wind:20,risk:.31,climate:'maritime'}, PHX:{wind:13,risk:.12,climate:'desert'},
    LAS:{wind:15,risk:.13,climate:'desert'}, SLC:{wind:16,risk:.22,climate:'highland'},
    MSP:{wind:20,risk:.30,climate:'continental'}, DTW:{wind:19,risk:.27,climate:'continental'},
    CLT:{wind:15,risk:.24,climate:'continental'}, PHL:{wind:19,risk:.26,climate:'continental'},
    IAH:{wind:17,risk:.31,climate:'tropical'}, MCO:{wind:15,risk:.34,climate:'tropical'},
    FLL:{wind:17,risk:.35,climate:'tropical'}, SAN:{wind:13,risk:.16,climate:'coastal'},
    PDX:{wind:19,risk:.30,climate:'maritime'}, BWI:{wind:18,risk:.25,climate:'continental'},
    DCA:{wind:17,risk:.24,climate:'continental'}, TPA:{wind:15,risk:.33,climate:'tropical'},
    AUS:{wind:16,risk:.24,climate:'continental'}, BNA:{wind:16,risk:.25,climate:'continental'},
    RDU:{wind:15,risk:.25,climate:'continental'}, MSY:{wind:17,risk:.32,climate:'tropical'},
    HNL:{wind:21,risk:.25,climate:'tropical'}, ANC:{wind:18,risk:.31,climate:'nordic'},
    MEX:{wind:15,risk:.24,climate:'highland'}, BOG:{wind:13,risk:.28,climate:'highland'},
    EZE:{wind:22,risk:.24,climate:'maritime'}, SCL:{wind:14,risk:.20,climate:'dry'},
    ADD:{wind:14,risk:.24,climate:'highland'}, CAI:{wind:16,risk:.13,climate:'desert'},
    NBO:{wind:13,risk:.21,climate:'highland'},
    BKK:{wind:12,risk:.32,climate:'tropical'}, HKG:{wind:18,risk:.34,climate:'tropical'},
    PVG:{wind:17,risk:.29,climate:'coastal'}, CAN:{wind:15,risk:.34,climate:'tropical'},
    DEL:{wind:15,risk:.25,climate:'dry'}, BOM:{wind:18,risk:.36,climate:'tropical'},
    TPE:{wind:19,risk:.36,climate:'tropical'}, KUL:{wind:12,risk:.33,climate:'tropical'},
    SYD:{wind:20,risk:.22,climate:'coastal'}, MEL:{wind:23,risk:.25,climate:'maritime'},
    AKL:{wind:24,risk:.31,climate:'maritime'}, JNB:{wind:17,risk:.18,climate:'highland'},
    CPT:{wind:26,risk:.23,climate:'maritime'}
  };
  const PHENOMENA={
    storm:{label:'Thunderstorm cells',icon:'TS',delay:[25,75],capacity:.56,visibility:[2,7],ceiling:[700,1800]},
    snow:{label:'Snow / deicing',icon:'SN',delay:[20,70],capacity:.62,visibility:[1,5],ceiling:[500,1600]},
    fog:{label:'Low visibility',icon:'FG',delay:[15,55],capacity:.68,visibility:[.4,2.5],ceiling:[100,700]},
    wind:{label:'Strong crosswind',icon:'WND',delay:[8,35],capacity:.78,visibility:[8,16],ceiling:[2200,6000]},
    rain:{label:'Rain showers',icon:'RA',delay:[6,25],capacity:.84,visibility:[4,10],ceiling:[1200,3500]},
    clear:{label:'Normal operations',icon:'CLR',delay:[0,0],capacity:1,visibility:[12,30],ceiling:[5000,12000]}
  };

  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }
  function stableUnit(seed){
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }
  function airportPoint(code){
    const airport=AIRPORTS[code];
    return airport?{lat:airport.lat,lon:airport.lon}:null;
  }
  function kmBetween(a,b){
    const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180;
    const dLat=lat2-lat1,dLon=(b.lon-a.lon)*Math.PI/180;
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function pointToSegmentKm(point,start,end){
    const midLat=(start.lat+end.lat+point.lat)/3*Math.PI/180;
    const scaleX=111.32*Math.cos(midLat),scaleY=110.57;
    const px=point.lon*scaleX,py=point.lat*scaleY;
    const ax=start.lon*scaleX,ay=start.lat*scaleY;
    const bx=end.lon*scaleX,by=end.lat*scaleY;
    const dx=bx-ax,dy=by-ay;
    const lengthSq=dx*dx+dy*dy;
    const t=lengthSq?clamp(((px-ax)*dx+(py-ay)*dy)/lengthSq,0,1):0;
    const x=ax+t*dx,y=ay+t*dy;
    return Math.hypot(px-x,py-y);
  }
  function pointInPolygon(point,polygon){
    if(!point||!polygon?.length) return false;
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const xi=polygon[i].lon,yi=polygon[i].lat;
      const xj=polygon[j].lon,yj=polygon[j].lat;
      const intersects=((yi>point.lat)!==(yj>point.lat)) &&
        (point.lon<(xj-xi)*(point.lat-yi)/((yj-yi)||1e-9)+xi);
      if(intersects) inside=!inside;
    }
    return inside;
  }
  function offsetPoint(lat,lon,northKm,eastKm){
    const nextLat=lat+northKm/110.57;
    const nextLon=lon+eastKm/(111.32*Math.max(.15,Math.cos(lat*Math.PI/180)));
    return {lat:nextLat,lon:nextLon};
  }
  function weatherPolygon(lat,lon,radiusKm,seed,points=14){
    const vertices=[];
    const rotation=stableUnit(`${seed}:rotation`)*Math.PI*2;
    for(let index=0;index<points;index++){
      const angle=rotation+index/points*Math.PI*2;
      const wobble=.72+stableUnit(`${seed}:poly:${index}`)*.55;
      const stretch=.82+stableUnit(`${seed}:stretch`)*.46;
      const northKm=Math.cos(angle)*radiusKm*wobble/stretch;
      const eastKm=Math.sin(angle)*radiusKm*wobble*stretch;
      vertices.push(offsetPoint(lat,lon,northKm,eastKm));
    }
    return vertices;
  }
  function monthSeason(timestamp){
    const month=new Date(timestamp).getMonth();
    return {
      winter:[11,0,1].includes(month),
      summer:[5,6,7].includes(month),
      shoulder:[2,3,4,8,9,10].includes(month)
    };
  }
  function phenomenonFor(profile,timestamp,roll){
    const season=monthSeason(timestamp);
    if(['continental','alpine','nordic'].includes(profile.climate)&&season.winter&&roll<.42) return 'snow';
    if(['maritime','coastal'].includes(profile.climate)&&roll<.34) return 'fog';
    if(['tropical','coastal'].includes(profile.climate)&&season.summer&&roll<.52) return 'storm';
    if(profile.climate==='desert'&&season.summer&&roll<.45) return 'wind';
    if(roll<.26) return 'fog';
    if(roll<.52) return 'rain';
    if(roll<.76) return 'wind';
    return 'storm';
  }
  function conditionValues(type,severe,detailRoll){
    const spec=PHENOMENA[type]||PHENOMENA.clear;
    const delay=spec.delay[0]+Math.round((spec.delay[1]-spec.delay[0])*detailRoll);
    const visibility=spec.visibility[0]+(spec.visibility[1]-spec.visibility[0])*(1-detailRoll);
    const ceiling=spec.ceiling[0]+Math.round((spec.ceiling[1]-spec.ceiling[0])*(1-detailRoll));
    return {
      delayMin:severe?Math.max(delay,25):Math.round(delay*.65),
      capacityFactor:clamp(spec.capacity+(severe?-.08:.07),.38,1),
      visibilityKm:Math.round(visibility*10)/10,
      ceilingFt:Math.round(ceiling/100)*100
    };
  }
  function airportWeatherBase(airportCode,timestamp){
    const profile=PROFILES[airportCode]||PROFILE_DEFAULT;
    const period=Math.floor(timestamp/(3*HOUR));
    const riskRoll=stableUnit(`${airportCode}:${period}:event`);
    const windRoll=stableUnit(`${airportCode}:${period}:wind`);
    const typeRoll=stableUnit(`${airportCode}:${period}:type`);
    const detailRoll=stableUnit(`${airportCode}:${period}:detail`);
    const season=monthSeason(timestamp);
    const seasonalRisk=profile.climate==='continental'&&season.winter ? .08 :
      profile.climate==='tropical'&&season.summer ? .09 :
      profile.climate==='coastal'&&season.summer ? .06 :
      profile.climate==='desert'&&season.summer ? .04 :
      profile.climate==='nordic'&&season.winter ? .10 : 0;
    const risk=clamp(profile.risk+seasonalRisk,.08,.46);
    const severe=riskRoll<risk*.14;
    const caution=!severe&&riskRoll<risk;
    const type=caution||severe?phenomenonFor(profile,timestamp,typeRoll):'clear';
    const values=conditionValues(type,severe,detailRoll);
    const windKph=Math.round(profile.wind*(.65+windRoll*1.55)+(severe?25:caution?10:0));
    const windDirection=Math.round(stableUnit(`${airportCode}:${period}:dir`)*36)*10%360;
    return {type,severe,caution,windKph,windDirection,gustKph:windKph+(severe?18:caution?9:4),...values};
  }
  function weatherCells(timestamp){
    const airportValues=Object.values(AIRPORTS);
    if(!airportValues.length) return [];
    const period=Math.floor(timestamp/(3*HOUR));
    const phase=(timestamp-period*3*HOUR)/(3*HOUR);
    const latMin=Math.min(...airportValues.map(item=>item.lat)),latMax=Math.max(...airportValues.map(item=>item.lat));
    const lonMin=Math.min(...airportValues.map(item=>item.lon)),lonMax=Math.max(...airportValues.map(item=>item.lon));
    const cells=[];
    for(let index=0;index<7;index++){
      const seed=`weather-cell:${period}:${index}`;
      const intensity=stableUnit(`${seed}:intensity`);
      const typeRoll=stableUnit(`${seed}:type`);
      const type=typeRoll<.36?'storm':typeRoll<.54?'rain':typeRoll<.72?'fog':typeRoll<.88?'wind':'snow';
      const severity=intensity>.78?'severe':intensity>.42?'caution':'light';
      if(severity==='light') continue;
      const radiusKm=Math.round(130+stableUnit(`${seed}:radius`)*420+(severity==='severe'?80:0));
      const drift=stableUnit(`${seed}:bearing`)*Math.PI*2;
      const speedKm=(55+stableUnit(`${seed}:speed`)*70)*phase;
      const baseLat=latMin+(latMax-latMin)*stableUnit(`${seed}:lat`);
      const baseLon=lonMin+(lonMax-lonMin)*stableUnit(`${seed}:lon`);
      const lat=baseLat+Math.cos(drift)*speedKm/110.57;
      const lon=baseLon+Math.sin(drift)*speedKm/(111.32*Math.cos(baseLat*Math.PI/180));
      const polygon=weatherPolygon(lat,lon,radiusKm,seed,severity==='severe'?16:12);
      cells.push({id:`WX${period}-${index}`,lat,lon,radiusKm,type,severity,
        polygon,
        label:PHENOMENA[type]?.label||'Weather cell',delayMin:severity==='severe'?25+Math.round(intensity*35):8+Math.round(intensity*18),
        capacityFactor:severity==='severe' ? .58 : .78});
    }
    return cells;
  }
  function weatherAt(airportCode,timestamp){
    const base=airportWeatherBase(airportCode,timestamp);
    const point=airportPoint(airportCode);
    const nearby=point?weatherCells(timestamp)
      .map(cell=>({...cell,distanceKm:kmBetween(point,cell)}))
      .filter(cell=>cell.distanceKm<cell.radiusKm*.7)
      .sort((a,b)=>a.distanceKm-b.distanceKm||b.delayMin-a.delayMin)[0]:null;
    const cellDominant=nearby&&nearby.delayMin>base.delayMin;
    const type=cellDominant?nearby.type:base.type;
    const severe=base.severe||nearby?.severity==='severe';
    const caution=base.caution||Boolean(nearby);
    const values=cellDominant?conditionValues(type,severe,stableUnit(`${airportCode}:${nearby.id}:detail`)):base;
    const delayMin=Math.max(base.delayMin,nearby?Math.round(nearby.delayMin*(1-nearby.distanceKm/(nearby.radiusKm*.8))):0);
    const capacityFactor=clamp(Math.min(base.capacityFactor,nearby?.capacityFactor||1,values.capacityFactor),.35,1);
    const level=severe||capacityFactor<.62||delayMin>=40?'severe':caution||delayMin>0||capacityFactor<.9?'caution':'normal';
    const impactRadiusKm=level==='severe'?130+Math.min(70,delayMin):level==='caution'?75+Math.min(45,delayMin):35;
    const spec=PHENOMENA[type]||PHENOMENA.clear;
    return {
      airport:airportCode,level,label:level==='normal'?'Normal':level==='caution'?'Caution':'Severe',
      type,icon:spec.icon,conditions:spec.label,windKph:base.windKph,windDirection:base.windDirection,gustKph:base.gustKph,
      visibilityKm:values.visibilityKm,ceilingFt:values.ceilingFt,delayMin,capacityFactor,
      impactRadiusKm,
      validFrom:Math.floor(timestamp/(3*HOUR))*3*HOUR,validUntil:(Math.floor(timestamp/(3*HOUR))+1)*3*HOUR,
      nearbyCell:nearby?{id:nearby.id,label:nearby.label,distanceKm:Math.round(nearby.distanceKm),severity:nearby.severity}:null
    };
  }
  function routeHazards(from,to,timestamp){
    const start=airportPoint(from),end=airportPoint(to);
    if(!start||!end) return [];
    return weatherCells(timestamp)
      .map(cell=>({...cell,distanceKm:pointToSegmentKm(cell,start,end)}))
      .filter(cell=>cell.distanceKm<cell.radiusKm)
      .map(cell=>({
        ...cell,
        routeImpact:clamp(1-cell.distanceKm/cell.radiusKm,0,1),
        delayMin:Math.max(4,Math.round(cell.delayMin*clamp(1-cell.distanceKm/cell.radiusKm,.25,1)))
      }))
      .sort((a,b)=>b.delayMin-a.delayMin||a.distanceKm-b.distanceKm)
      .slice(0,3);
  }
  function routeHazardSummary(from,to,timestamp){
    const hazards=routeHazards(from,to,timestamp);
    const delayMin=hazards.reduce((sum,item)=>sum+item.delayMin,0);
    const severe=hazards.some(item=>item.severity==='severe');
    return {hazards,delayMin,severe,label:hazards[0]?.label||'',level:severe?'severe':hazards.length?'caution':'normal'};
  }
  function cellsAtPoint(point,timestamp){
    if(!point) return [];
    return weatherCells(timestamp)
      .filter(cell=>pointInPolygon(point,cell.polygon))
      .sort((a,b)=>(b.severity==='severe')-(a.severity==='severe')||b.delayMin-a.delayMin);
  }

  global.AeroWeatherEngine={weatherAt,weatherCells,routeHazards,routeHazardSummary,cellsAtPoint,pointInPolygon,stableUnit};
})(window);
