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
    const dLat=lat2-lat1;
    const dLon=((((b.lon-a.lon)+540)%360)-180)*Math.PI/180;
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
  const SYSTEM_BUCKET=6*HOUR;
  const WEATHER_STEP=15*MIN;
  const FORECAST_HORIZON=18*HOUR;
  const REGION_LAT_DEG=15;
  const REGION_LON_DEG=20;
  const SYSTEM_LOOKBACK_BUCKETS=3;
  const weatherCellCache=new Map();
  const airportWeatherCache=new Map();
  const regionalProfileCache=new Map();
  const systemDefinitionBucketCache=new Map();

  function cacheValue(cache,key,create,limit=96){
    if(cache.has(key)) return cache.get(key);
    const value=create();
    cache.set(key,value);
    while(cache.size>limit) cache.delete(cache.keys().next().value);
    return value;
  }
  function monthSeason(timestamp,latitude=45){
    const month=new Date(timestamp).getMonth();
    const north=latitude>=0;
    const winter=north?[11,0,1].includes(month):[5,6,7].includes(month);
    const summer=north?[5,6,7].includes(month):[11,0,1].includes(month);
    return {
      winter,
      summer,
      shoulder:!winter&&!summer
    };
  }
  function phenomenonFor(profile,timestamp,roll,latitude=45){
    const season=monthSeason(timestamp,latitude);
    const climate=profile.climate||'temperate';
    if(['continental','alpine','nordic'].includes(climate)&&season.winter){
      if(roll<.52) return 'snow';
      if(roll<.70) return 'fog';
      if(roll<.90) return 'wind';
      return 'rain';
    }
    if(climate==='tropical'){
      if(roll<.58) return 'storm';
      if(roll<.88) return 'rain';
      return 'wind';
    }
    if(climate==='desert'){
      if(roll<.68) return 'wind';
      if(roll<.84) return 'rain';
      return 'storm';
    }
    if(['maritime','coastal'].includes(climate)){
      if(roll<.30) return 'fog';
      if(roll<.61) return 'rain';
      if(roll<.82) return 'wind';
      return 'storm';
    }
    if(climate==='highland'){
      if(roll<.30) return 'fog';
      if(roll<.58) return 'storm';
      if(roll<.80) return 'wind';
      return 'rain';
    }
    if(roll<.24) return 'fog';
    if(roll<.57) return 'rain';
    if(roll<.79) return 'wind';
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
  function nearestRegionalProfile(lat,lon){
    const key=`${Math.floor((lat+90)/REGION_LAT_DEG)}:${Math.floor((lon+180)/REGION_LON_DEG)}`;
    return cacheValue(regionalProfileCache,key,()=>{
      let nearestCode='',nearestDistance=Infinity;
      for(const [code,airport] of Object.entries(AIRPORTS)){
        const distance=kmBetween({lat,lon},airport);
        if(distance<nearestDistance){ nearestCode=code; nearestDistance=distance; }
      }
      return PROFILES[nearestCode]||PROFILE_DEFAULT;
    },240);
  }
  function systemDurationHours(type,seed){
    const ranges={storm:[4,9],rain:[7,15],fog:[4,10],wind:[7,16],snow:[9,18]};
    const [min,max]=ranges[type]||[6,12];
    return min+(max-min)*stableUnit(`${seed}:duration`);
  }
  function systemRadiusKm(type,severe,seed){
    const ranges={storm:[90,300],rain:[260,680],fog:[80,260],wind:[300,760],snow:[320,820]};
    const [min,max]=ranges[type]||[180,450];
    return Math.round(min+(max-min)*stableUnit(`${seed}:radius`)+(severe?45:0));
  }
  function systemSpeedKph(type,seed){
    const ranges={storm:[25,70],rain:[20,55],fog:[4,18],wind:[30,75],snow:[15,45]};
    const [min,max]=ranges[type]||[20,50];
    return min+(max-min)*stableUnit(`${seed}:speed`);
  }
  function systemDefinition(regionLat,regionLon,bucket){
    const seed=`weather-system:${regionLat}:${regionLon}:${bucket}`;
    const centerLat=regionLat+REGION_LAT_DEG*(.12+.76*stableUnit(`${seed}:lat`));
    const centerLon=regionLon+REGION_LON_DEG*(.12+.76*stableUnit(`${seed}:lon`));
    const profile=nearestRegionalProfile(centerLat,centerLon);
    const season=monthSeason(bucket*SYSTEM_BUCKET,centerLat);
    const seasonalRisk=profile.climate==='tropical'&&season.summer ? .07 :
      ['continental','nordic','alpine'].includes(profile.climate)&&season.winter ? .08 : 0;
    const probability=clamp(.075+profile.risk*.28+seasonalRisk,.09,.25);
    if(stableUnit(`${seed}:active`)>probability) return null;
    const activeFrom=bucket*SYSTEM_BUCKET+stableUnit(`${seed}:offset`)*2.5*HOUR;
    const type=phenomenonFor(profile,activeFrom,stableUnit(`${seed}:type`),centerLat);
    const peakIntensity=.52+stableUnit(`${seed}:intensity`)*.46;
    const severe=peakIntensity>=.76;
    const durationMs=systemDurationHours(type,seed)*HOUR;
    const spec=PHENOMENA[type]||PHENOMENA.rain;
    const detail=stableUnit(`${seed}:detail`);
    const delayMin=Math.max(5,Math.round(spec.delay[0]+(spec.delay[1]-spec.delay[0])*detail*(.65+peakIntensity*.35)));
    return {
      id:`WX-${regionLat}-${regionLon}-${bucket}`,
      seed,type,label:spec.label,peakSeverity:severe?'severe':'caution',peakIntensity,
      startLat:centerLat,startLon:centerLon,
      radiusKm:systemRadiusKm(type,severe,seed),
      bearingRad:stableUnit(`${seed}:bearing`)*Math.PI*2,
      speedKph:systemSpeedKph(type,seed),
      activeFrom,activeUntil:activeFrom+durationMs,
      delayMin,
      capacityFactor:clamp(spec.capacity+(severe?-.06:.08),.38,.9)
    };
  }
  function systemDefinitionsForBucket(bucket){
    return cacheValue(systemDefinitionBucketCache,bucket,()=>{
      const definitions=[];
      for(let lat=-75;lat<75;lat+=REGION_LAT_DEG){
        for(let lon=-180;lon<180;lon+=REGION_LON_DEG){
          const definition=systemDefinition(lat,lon,bucket);
          if(definition) definitions.push(definition);
        }
      }
      return definitions;
    },32);
  }
  function activeSystemDefinitions(timestamp){
    const bucket=Math.floor(timestamp/SYSTEM_BUCKET);
    const definitions=[];
    for(let sourceBucket=bucket-SYSTEM_LOOKBACK_BUCKETS;sourceBucket<=bucket;sourceBucket++){
      for(const definition of systemDefinitionsForBucket(sourceBucket)){
        if(timestamp>=definition.activeFrom&&timestamp<definition.activeUntil) definitions.push(definition);
      }
    }
    return definitions;
  }
  function systemSnapshot(definition,timestamp){
    const elapsedHours=(timestamp-definition.activeFrom)/HOUR;
    const phase=clamp((timestamp-definition.activeFrom)/(definition.activeUntil-definition.activeFrom),0,1);
    const lifecycle=.52+.48*Math.sin(Math.PI*phase);
    const travelledKm=definition.speedKph*Math.max(0,elapsedHours);
    const lat=definition.startLat+Math.cos(definition.bearingRad)*travelledKm/110.57;
    const lon=definition.startLon+Math.sin(definition.bearingRad)*travelledKm/(111.32*Math.max(.15,Math.cos(definition.startLat*Math.PI/180)));
    const radiusKm=Math.round(definition.radiusKm*(.86+.14*lifecycle));
    const intensity=definition.peakIntensity*lifecycle;
    const severity=definition.peakSeverity==='severe'&&intensity>=.62?'severe':'caution';
    return {
      id:definition.id,lat,lon,radiusKm,type:definition.type,severity,
      peakSeverity:definition.peakSeverity,intensity,
      polygon:weatherPolygon(lat,lon,radiusKm,definition.seed,severity==='severe'?16:12),
      label:definition.label,
      delayMin:Math.max(4,Math.round(definition.delayMin*(.56+.44*lifecycle))),
      capacityFactor:clamp(1-(1-definition.capacityFactor)*(.58+.42*lifecycle),.38,.94),
      activeFrom:definition.activeFrom,activeUntil:definition.activeUntil,
      bearingDeg:Math.round(definition.bearingRad*180/Math.PI)%360,
      speedKph:Math.round(definition.speedKph)
    };
  }
  function weatherCells(timestamp){
    const queryAt=Math.floor(timestamp/WEATHER_STEP)*WEATHER_STEP;
    return cacheValue(weatherCellCache,queryAt,()=>activeSystemDefinitions(queryAt)
      .map(definition=>systemSnapshot(definition,queryAt))
      .sort((a,b)=>a.id.localeCompare(b.id)),160);
  }
  function ambientWeather(airportCode,timestamp){
    const point=airportPoint(airportCode)||{lat:0,lon:0};
    const profile=PROFILES[airportCode]||nearestRegionalProfile(point.lat,point.lon)||PROFILE_DEFAULT;
    const period=Math.floor(timestamp/SYSTEM_BUCKET);
    const regionLat=Math.floor((point.lat+90)/5);
    const regionLon=Math.floor((point.lon+180)/5);
    const windRoll=stableUnit(`ambient:${regionLat}:${regionLon}:${period}:wind`);
    const localWind=.94+stableUnit(`ambient:${airportCode}:${period}:local`)*.12;
    const windKph=Math.round(profile.wind*(.68+windRoll*.72)*localWind);
    return {
      airport:airportCode,level:'normal',label:'Normal',type:'clear',icon:PHENOMENA.clear.icon,
      conditions:PHENOMENA.clear.label,windKph,
      windDirection:Math.round(stableUnit(`ambient:${regionLat}:${regionLon}:${period}:direction`)*36)*10%360,
      gustKph:windKph+4,visibilityKm:24,ceilingFt:9000,delayMin:0,capacityFactor:1,
      weatherSystemId:'',nearbyCell:null
    };
  }
  function systemImpactAtAirport(airportCode,point,cell,ambient){
    if(!pointInPolygon(point,cell.polygon)) return null;
    const distanceKm=kmBetween(point,cell);
    const spatial=clamp(1-distanceKm/Math.max(1,cell.radiusKm),.12,1);
    const strength=clamp((.35+.65*spatial)*cell.intensity,.18,1);
    const localSensitivity=.92+stableUnit(`${airportCode}:weather-sensitivity`)*.16;
    const severe=cell.severity==='severe'&&strength>=.48;
    const values=conditionValues(cell.type,severe,stableUnit(`${cell.id}:conditions`));
    const delayMin=Math.max(3,Math.round(cell.delayMin*strength*localSensitivity));
    const capacityFactor=clamp(1-(1-cell.capacityFactor)*strength*localSensitivity,.38,.96);
    const blend=clamp(.28+strength*.72,0,1);
    const visibilityKm=Math.round((ambient.visibilityKm-(ambient.visibilityKm-values.visibilityKm)*blend)*10)/10;
    const ceilingFt=Math.round((ambient.ceilingFt-(ambient.ceilingFt-values.ceilingFt)*blend)/100)*100;
    const level=severe||capacityFactor<.62||delayMin>=40?'severe':'caution';
    return {
      airport:airportCode,level,label:level==='severe'?'Severe':'Caution',type:cell.type,
      icon:(PHENOMENA[cell.type]||PHENOMENA.clear).icon,
      conditions:(PHENOMENA[cell.type]||PHENOMENA.clear).label,
      windKph:Math.max(ambient.windKph,Math.round(ambient.windKph+strength*(cell.type==='wind'?28:cell.type==='storm'?20:8))),
      windDirection:cell.bearingDeg,
      gustKph:Math.max(ambient.gustKph,Math.round(ambient.windKph+strength*(cell.type==='wind'?45:cell.type==='storm'?36:15))),
      visibilityKm,ceilingFt,delayMin,capacityFactor,
      weatherSystemId:cell.id,
      nearbyCell:{id:cell.id,label:cell.label,distanceKm:Math.round(distanceKm),severity:cell.severity},
      systemActiveFrom:cell.activeFrom,systemActiveUntil:cell.activeUntil,
      systemLat:cell.lat,systemLon:cell.lon,
      systemBearingDeg:cell.bearingDeg,systemSpeedKph:cell.speedKph,
      impactRadiusKm:cell.radiusKm
    };
  }
  function evaluateAirportWeather(airportCode,timestamp){
    const ambient=ambientWeather(airportCode,timestamp);
    const point=airportPoint(airportCode);
    if(!point) return ambient;
    const impacts=weatherCells(timestamp)
      .map(cell=>systemImpactAtAirport(airportCode,point,cell,ambient))
      .filter(Boolean)
      .sort((a,b)=>b.delayMin-a.delayMin||a.capacityFactor-b.capacityFactor);
    return impacts[0]||ambient;
  }
  function airportConditionWindow(airportCode,timestamp,weather){
    if(!weather.weatherSystemId){
      return {validFrom:timestamp,validUntil:timestamp+Math.min(6*HOUR,FORECAST_HORIZON)};
    }
    const point=airportPoint(airportCode);
    const activeFrom=weather.systemActiveFrom||timestamp;
    const activeUntil=weather.systemActiveUntil||timestamp+6*HOUR;
    if(!point||!Number.isFinite(weather.systemLat)||!Number.isFinite(weather.systemLon)){
      return {validFrom:Math.max(activeFrom,timestamp),validUntil:Math.max(timestamp+WEATHER_STEP,activeUntil)};
    }
    const meanLat=(point.lat+weather.systemLat)/2*Math.PI/180;
    const east=((((point.lon-weather.systemLon)+540)%360)-180)*111.32*Math.cos(meanLat);
    const north=(point.lat-weather.systemLat)*110.57;
    const bearing=(Number(weather.systemBearingDeg)||0)*Math.PI/180;
    const speed=Math.max(0,Number(weather.systemSpeedKph)||0);
    const vx=Math.sin(bearing)*speed;
    const vy=Math.cos(bearing)*speed;
    const distance=Math.hypot(east,north);
    const radius=Math.max(Number(weather.impactRadiusKm)||0,distance*1.05,1);
    let validFrom=activeFrom,validUntil=activeUntil;
    const a=vx*vx+vy*vy;
    const dot=east*vx+north*vy;
    const c=east*east+north*north-radius*radius;
    const discriminant=dot*dot-a*c;
    if(a>.01&&discriminant>=0){
      const root=Math.sqrt(discriminant);
      const enterHours=(dot-root)/a;
      const exitHours=(dot+root)/a;
      validFrom=Math.max(activeFrom,timestamp+enterHours*HOUR);
      validUntil=Math.min(activeUntil,timestamp+exitHours*HOUR);
    }
    return {
      validFrom:Math.min(timestamp,validFrom),
      validUntil:Math.max(timestamp+WEATHER_STEP,validUntil)
    };
  }
  function weatherAt(airportCode,timestamp){
    const queryAt=Math.floor(timestamp/WEATHER_STEP)*WEATHER_STEP;
    const key=`${airportCode}:${queryAt}`;
    return cacheValue(airportWeatherCache,key,()=>{
      const weather=evaluateAirportWeather(airportCode,queryAt);
      const window=airportConditionWindow(airportCode,queryAt,weather);
      const forecastDurationMin=Math.max(1,Math.round((window.validUntil-window.validFrom)/MIN));
      const forecastRemainingMin=Math.max(1,Math.round((window.validUntil-queryAt)/MIN));
      return {
        ...weather,
        impactRadiusKm:weather.impactRadiusKm||0,
        forecastAt:queryAt,
        validFrom:window.validFrom,
        validUntil:window.validUntil,
        forecastDurationMin,
        forecastRemainingMin
      };
    },1200);
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
