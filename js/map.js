/* AeroSim MapLibre map, live aircraft layers, and application bootstrap loop. */

const MAP_STYLE_URL='https://tiles.openfreemap.org/styles/dark';
const EMPTY_FEATURE_COLLECTION={type:'FeatureCollection',features:[]};
const HIDDEN_BASEMAP_LABEL_LAYERS=[
  'road_oneway',
  'road_oneway_opposite',
  'highway_name_other',
  'highway_name_motorway',
  'place_other',
  'place_suburb',
  'place_village',
  'place_town',
  'place_state'
];

const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE_URL,
  center: [8.5,49.5],
  zoom: 4,
  attributionControl: true
});

map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-left');

let mapReady=false;
window.__aeroMapReady=false;
const airportMarkers = new Map();
const aircraftMarkers = new Map();
let routeSignature = '';
let weatherMapSignature = '';
let latestWeatherCells = [];
const mapPopup = new maplibregl.Popup({
  closeButton:false,
  closeOnClick:false,
  className:'map-tooltip'
});

function mapFeatureCollection(features=[]){
  return {type:'FeatureCollection',features};
}

function setMapSourceData(id, data=EMPTY_FEATURE_COLLECTION){
  const source=map.getSource(id);
  if(source&&typeof source.setData==='function') source.setData(data);
}

function clearMapSource(id){
  setMapSourceData(id, EMPTY_FEATURE_COLLECTION);
}

function layerExists(id){ return Boolean(map.getLayer(id)); }
function sourceExists(id){ return Boolean(map.getSource(id)); }

function addGeoJsonSource(id){
  if(!sourceExists(id)) map.addSource(id,{type:'geojson',data:EMPTY_FEATURE_COLLECTION});
}

function addLineLayer(id,source,paint={},layout={}){
  if(layerExists(id)) return;
  map.addLayer({
    id,
    type:'line',
    source,
    layout:{'line-cap':'round','line-join':'round',...layout},
    paint
  });
}

function addFillLayer(id,source,paint={}){
  if(layerExists(id)) return;
  map.addLayer({id,type:'fill',source,paint});
}

function airportNightTooltip(airport){
  const rule=AIRPORT_NIGHT_RULES[airport.iata];
  if(!rule||rule.mode==='open') return `${airport.iata} - ${airport.name}\nNight: 24h operations`;
  const modeLabel=rule.mode==='curfew'?'Night closure':rule.mode==='quota'?'Night quota':'Night procedures';
  return `${airport.iata} - ${airport.name}\n${modeLabel}: ${rule.start}-${rule.end} local\n${rule.detail||rule.label}`;
}

function simplifyBaseMapLabels(){
  for(const id of HIDDEN_BASEMAP_LABEL_LAYERS){
    if(layerExists(id)) map.setLayoutProperty(id,'visibility','none');
  }
}

function aircraftMapIncidentState(ac,p,index=operationalIndex()){
  const open=[
    ...(index.openIncidentsByAircraft.get(ac.id)||[]),
    ...(p.flight?(index.openIncidentsByFlight.get(p.flight.id)||[]):[])
  ].filter((incident,pos,items)=>items.findIndex(item=>item.id===incident.id)===pos);
  const critical=open.find(incident=>incident.severity==='critical'||INCIDENT_DEFINITIONS[incident.type]?.severity==='critical');
  const warning=open.find(incident=>incident.severity==='warning'||INCIDENT_DEFINITIONS[incident.type]?.severity==='warning');
  return {
    level:critical?'critical':warning?'warning':'normal',
    label:(critical||warning)?(INCIDENT_DEFINITIONS[(critical||warning).type]?.title||'Open incident'):''
  };
}

function aircraftMarkerHtml(ac, p, index=operationalIndex()) {
  const selected = ac.id === selectedAircraftId;
  const label = p.flight ? `${p.flight.id}  ${ac.tail}` : ac.tail;
  const incident=aircraftMapIncidentState(ac,p,index);
  const rotation = Math.round((p.heading || 0) - 45);
  const movementClass=p.status==='airborne'?'airborne':p.status==='taxi_out'||p.status==='taxi_in'?'taxi':'ground';
  const statusLabel=p.status==='taxi_out'?'Taxi out':p.status==='taxi_in'?'Taxi in':p.status==='airborne'?'Airborne':'On ground';
  return `<div class="plane-shell ${movementClass} ${incident.level} ${selected ? 'selected' : ''}" title="${esc(incident.label||statusLabel)}">
    <span class="plane-halo"></span>
    <span class="plane-glyph" style="transform:rotate(${rotation}deg)">&#9992;</span>
    <span class="plane-label-map">${esc(label)}</span>
  </div>`;
}

function createAirportMarker(airport){
  const element=document.createElement('button');
  element.type='button';
  element.className='airport-marker';
  const tooltip=airportNightTooltip(airport);
  element.title=tooltip;
  element.innerHTML=`<span class="airport-dot"></span><span class="airport-label">${esc(airport.iata)}</span>`;
  element.addEventListener('mouseenter',()=>{
    mapPopup
      .setLngLat([airport.lon,airport.lat])
      .setHTML(esc(tooltip).replace(/\n/g,'<br>'))
      .addTo(map);
  });
  element.addEventListener('mouseleave',()=>mapPopup.remove());
  element.addEventListener('click',event=>{
    event.stopPropagation();
    if(typeof setOperationsAirportFilter==='function') setOperationsAirportFilter(airport.iata);
  });
  const marker=new maplibregl.Marker({element,anchor:'center'})
    .setLngLat([airport.lon,airport.lat])
    .addTo(map);
  airportMarkers.set(airport.iata,marker);
}

function createAirportMarkers(){
  if(airportMarkers.size) return;
  for (const airport of Object.values(AIRPORTS)) createAirportMarker(airport);
}

function circlePolygon(lon,lat,radiusKm,steps=72){
  const coords=[];
  const angularDistance=radiusKm/6371;
  const latRad=lat*Math.PI/180;
  const lonRad=lon*Math.PI/180;
  for(let i=0;i<=steps;i++){
    const bearing=2*Math.PI*i/steps;
    const pointLat=Math.asin(Math.sin(latRad)*Math.cos(angularDistance)+Math.cos(latRad)*Math.sin(angularDistance)*Math.cos(bearing));
    const pointLon=lonRad+Math.atan2(
      Math.sin(bearing)*Math.sin(angularDistance)*Math.cos(latRad),
      Math.cos(angularDistance)-Math.sin(latRad)*Math.sin(pointLat)
    );
    coords.push([((pointLon*180/Math.PI+540)%360)-180,pointLat*180/Math.PI]);
  }
  return coords;
}

function routeLineFeature(f,routeWeather,t){
  const destination=flightOperationalDestination(f);
  const selected=f.id===selectedFlightId;
  const st=statusOfFlight(f,t);
  const coords=routeCoords(AIRPORTS[f.from], AIRPORTS[destination], 80);
  return {
    type:'Feature',
    id:f.id,
    properties:{
      id:f.id,
      selected,
      status:st,
      color:selected ? '#58d2ff' : (['airborne','taxi_out','taxi_in'].includes(st) ? '#74a9c1' : '#607887'),
      width:selected ? 3 : 2,
      opacity:(st === 'scheduled' || st === 'delayed') ? .38 : .78,
      tooltip:`${f.id} · ${f.from} -> ${destination}${destination!==f.to?` (planned ${f.to})`:''}${routeWeather.delayMin?` · ${routeWeather.label} +${routeWeather.delayMin}m`:''}`
    },
    geometry:{type:'LineString',coordinates:coords}
  };
}

function routeWeatherFeature(f,routeWeather){
  const destination=flightOperationalDestination(f);
  if(!routeWeather.hazards?.length) return null;
  const selected=f.id===selectedFlightId;
  return {
    type:'Feature',
    id:`${f.id}-weather`,
    properties:{
      id:f.id,
      selected,
      level:routeWeather.level||'caution',
      color:routeWeather.level==='severe' ? '#e66b5d' : '#d9b95f',
      width:selected ? 8 : 6,
      opacity:selected ? .55 : .36
    },
    geometry:{type:'LineString',coordinates:routeCoords(AIRPORTS[f.from], AIRPORTS[destination], 80)}
  };
}

function rebuildRoutesIfNeeded() {
  if(!mapReady) return;
  const t = simNow();
  const visible = state.flights
    .filter(f => !f.cancelled && flightActualDeparture(f) <= t + 2*HOUR && flightActualArrival(f) > t - 15*MIN)
    .sort((a,b) => a.id.localeCompare(b.id));
  const signature = visible.map(f =>
    `${f.id}:${statusOfFlight(f,t)}:${flightOperationalDestination(f)}:${f.id===selectedFlightId?1:0}:${window.AeroWeatherEngine?.routeHazardSummary?.(f.from,flightOperationalDestination(f),t)?.level||'normal'}`
  ).join('|');

  if (signature === routeSignature) return;
  routeSignature = signature;

  const routes=[];
  const routeWeather=[];
  for (const f of visible) {
    const destination=flightOperationalDestination(f);
    const weather=window.AeroWeatherEngine?.routeHazardSummary?.(f.from,destination,t)||{hazards:[],level:'normal',delayMin:0,label:''};
    routes.push(routeLineFeature(f,weather,t));
    const weatherFeature=routeWeatherFeature(f,weather);
    if(weatherFeature) routeWeather.push(weatherFeature);
  }
  setMapSourceData('routes',mapFeatureCollection(routes));
  setMapSourceData('route-weather',mapFeatureCollection(routeWeather));
}

function weatherLevelStyle(level){
  if(level==='severe') return {color:'#e66b5d',fillColor:'#e66b5d',fillOpacity:.18,opacity:.82};
  if(level==='caution') return {color:'#d9b95f',fillColor:'#d9b95f',fillOpacity:.13,opacity:.7};
  return {color:'#6bcf91',fillColor:'#6bcf91',fillOpacity:.06,opacity:.4};
}

function weatherCellFeature(cell,selected=false){
  const style=weatherLevelStyle(cell.severity==='severe'?'severe':'caution');
  const coordinates=(cell.polygon||[]).map(point=>[point.lon,point.lat]);
  if(coordinates.length<3) return null;
  coordinates.push(coordinates[0]);
  return {
    type:'Feature',
    id:cell.id,
    properties:{
      id:cell.id,
      type:cell.type,
      severity:cell.severity,
      label:cell.label,
      delayMin:cell.delayMin,
      color:style.color,
      fillColor:style.fillColor,
      fillOpacity:cell.severity==='severe' ? .16 : .10,
      opacity:selected ? .9 : cell.severity==='severe' ? .55 : .38,
      width:selected ? 2 : 1,
      tooltip:`${cell.label} · ${cell.severity} · possible +${cell.delayMin}m`
    },
    geometry:{type:'Polygon',coordinates:[coordinates]}
  };
}

function airportWeatherFeature(code,weather){
  const airport=AIRPORTS[code];
  if(!airport) return null;
  const style=weatherLevelStyle(weather.level);
  return {
    type:'Feature',
    id:`airport-weather-${code}`,
    properties:{
      code,
      level:weather.level,
      color:style.color,
      fillColor:style.fillColor,
      fillOpacity:style.fillOpacity,
      opacity:style.opacity,
      width:weather.level==='normal'?1:2,
      tooltip:`${code} · ${weather.conditions} · wind ${weather.windDirection}°/${weather.windKph}G${weather.gustKph} km/h · vis ${weather.visibilityKm} km · ceiling ${weather.ceilingFt} ft · capacity ${Math.round(weather.capacityFactor*100)}%`
    },
    geometry:{type:'Polygon',coordinates:[circlePolygon(airport.lon,airport.lat,weather.impactRadiusKm||35)]}
  };
}

function rebuildWeatherMapIfNeeded(){
  if(!mapReady||!window.AeroWeatherEngine) return;
  const t=simNow();
  const period=Math.floor(t/(30*MIN));
  const codes=typeof operationalAirportCodes==='function'?operationalAirportCodes():Object.keys(AIRPORTS);
  const weatherByCode=codes.map(code=>({code,weather:Management.weatherAt(code,t)}));
  const cells=window.AeroWeatherEngine.weatherCells(t);
  latestWeatherCells=cells;
  const signature=[
    period,
    weatherByCode.map(item=>`${item.code}:${item.weather.level}:${item.weather.type}:${item.weather.delayMin}`).join('|'),
    cells.map(cell=>`${cell.id}:${Math.round(cell.lat*10)}:${Math.round(cell.lon*10)}:${cell.severity}`).join('|'),
    typeof operationFilterWeatherCellId==='function'?operationFilterWeatherCellId():''
  ].join('::');
  if(signature===weatherMapSignature) return;
  weatherMapSignature=signature;

  const selectedId=typeof operationFilterWeatherCellId==='function'?operationFilterWeatherCellId():'';
  setMapSourceData('weather-cells',mapFeatureCollection(cells.map(cell=>weatherCellFeature(cell,selectedId===cell.id)).filter(Boolean)));
  setMapSourceData('airport-weather',mapFeatureCollection(weatherByCode.map(item=>airportWeatherFeature(item.code,item.weather)).filter(Boolean)));
}

function createAircraftMarker(ac,p,index){
  const element=document.createElement('button');
  element.type='button';
  element.className='aircraft-marker';
  element.innerHTML=aircraftMarkerHtml(ac,p,index);
  element.addEventListener('click',event=>{
    event.stopPropagation();
    settleSelected(ac.id);
  });
  const marker=new maplibregl.Marker({element,anchor:'center'})
    .setLngLat([p.lon,p.lat])
    .addTo(map);
  const record={marker,element,iconKey:''};
  aircraftMarkers.set(ac.id, record);
  return record;
}

function updateMapData() {
  if(!mapReady) return;
  rebuildWeatherMapIfNeeded();
  rebuildRoutesIfNeeded();
  const t = simNow();
  const index=operationalIndex(t);
  const liveIds = new Set();

  for (const ac of state.aircraft) {
    const p = currentAircraftPosition(ac,t,index);
    liveIds.add(ac.id);
    let record = aircraftMarkers.get(ac.id);
    const incident=aircraftMapIncidentState(ac,p,index);
    const iconKey=[
      p.status,
      ac.id===selectedAircraftId?1:0,
      p.flight?p.flight.id:'ground',
      incident.level,
      Math.round((p.heading||0)/5)*5
    ].join('|');

    if (!record) record=createAircraftMarker(ac,p,index);
    record.marker.setLngLat([p.lon,p.lat]);
    record.element.style.zIndex=['airborne','taxi_out','taxi_in'].includes(p.status) ? '1000' : '300';
    if(record.iconKey!==iconKey){
      record.element.innerHTML=aircraftMarkerHtml(ac,p,index);
      record.iconKey=iconKey;
    }
  }

  for (const [id, record] of aircraftMarkers) {
    if (!liveIds.has(id)) {
      record.marker.remove();
      aircraftMarkers.delete(id);
    }
  }
}

function fitNetwork() {
  if(!mapReady) return;
  const bounds=new maplibregl.LngLatBounds();
  let hasPoints=false;
  function extend(lon,lat){
    if(!Number.isFinite(lon)||!Number.isFinite(lat)) return;
    bounds.extend([lon,lat]);
    hasPoints=true;
  }
  for(const ac of state.aircraft){
    const p=currentAircraftPosition(ac);
    extend(p.lon,p.lat);
  }
  for(const f of state.flights){
    const destination=flightOperationalDestination(f);
    const from=AIRPORTS[f.from],to=AIRPORTS[destination];
    if(from) extend(from.lon,from.lat);
    if(to) extend(to.lon,to.lat);
  }
  if(!hasPoints) return;
  map.fitBounds(bounds, {padding:60, maxZoom:5, duration:0});
}

function showLayerPopup(event){
  const feature=event.features?.[0];
  const tooltip=feature?.properties?.tooltip;
  if(!tooltip) return;
  mapPopup.setLngLat(event.lngLat).setHTML(esc(tooltip)).addTo(map);
}

function bindMapLayerInteractions(){
  for(const layerId of ['routes','weather-cells-fill','airport-weather-fill']){
    map.on('mouseenter',layerId,()=>{ map.getCanvas().style.cursor='pointer'; });
    map.on('mousemove',layerId,showLayerPopup);
    map.on('mouseleave',layerId,()=>{
      map.getCanvas().style.cursor='';
      mapPopup.remove();
    });
  }
  map.on('click','routes',event=>{
    const id=event.features?.[0]?.properties?.id;
    if(id) settleSelectedFlight(id);
  });
  map.on('click','weather-cells-fill',event=>{
    const id=event.features?.[0]?.properties?.id;
    const cell=latestWeatherCells.find(item=>item.id===id);
    if(cell&&typeof setOperationsWeatherFilter==='function') setOperationsWeatherFilter(cell);
  });
}

function initialiseMapLayers(){
  addGeoJsonSource('airport-weather');
  addGeoJsonSource('weather-cells');
  addGeoJsonSource('route-weather');
  addGeoJsonSource('routes');

  addFillLayer('airport-weather-fill','airport-weather',{
    'fill-color':['get','fillColor'],
    'fill-opacity':['get','fillOpacity']
  });
  addLineLayer('airport-weather-line','airport-weather',{
    'line-color':['get','color'],
    'line-opacity':['get','opacity'],
    'line-width':['get','width']
  });
  addFillLayer('weather-cells-fill','weather-cells',{
    'fill-color':['get','fillColor'],
    'fill-opacity':['get','fillOpacity']
  });
  addLineLayer('weather-cells-line','weather-cells',{
    'line-color':['get','color'],
    'line-opacity':['get','opacity'],
    'line-width':['get','width']
  });
  addLineLayer('route-weather-line','route-weather',{
    'line-color':['get','color'],
    'line-opacity':['get','opacity'],
    'line-width':['get','width'],
    'line-dasharray':[2,2.4]
  });
  addLineLayer('routes','routes',{
    'line-color':['get','color'],
    'line-opacity':['get','opacity'],
    'line-width':['get','width'],
    'line-dasharray':[1.8,1.8]
  });

  bindMapLayerInteractions();
}

const routeLayer={clearLayers:()=>{ routeSignature=''; clearMapSource('routes'); clearMapSource('route-weather'); }};
const aircraftLayer={clearLayers:()=>{ for(const record of aircraftMarkers.values()) record.marker.remove(); aircraftMarkers.clear(); }};
const weatherLayer={clearLayers:()=>{ weatherMapSignature=''; clearMapSource('weather-cells'); }};
const airportWeatherLayer={clearLayers:()=>{ weatherMapSignature=''; clearMapSource('airport-weather'); }};
const airportLayer={clearLayers:()=>{ for(const marker of airportMarkers.values()) marker.remove(); airportMarkers.clear(); }};

map.invalidateSize=function(){ map.resize(); };
map.setView=function(center,zoom,options={}){
  const [lat,lon]=center;
  const payload={center:[lon,lat],zoom};
  if(options.animate) map.easeTo(payload);
  else map.jumpTo(payload);
};

map.on('load', () => {
  mapReady=true;
  window.__aeroMapReady=true;
  simplifyBaseMapLabels();
  initialiseMapLayers();
  createAirportMarkers();
  updateMapData();
  fitNetwork();
  refreshScheduleTimeline(true);
});

document.getElementById('fitBtn').addEventListener('click',fitNetwork);

let lastUi=0;
let lastMapTick=0;
let lastHeaderTick=0;
function loop(now){
  const changed=processEvents();
  if(changed&&typeof markUiDirty==='function') markUiDirty('all');
  if(typeof checkActionableIncidentDing==='function') checkActionableIncidentDing();
  if(changed||now-lastMapTick>350){
    updateMapData();
    lastMapTick=now;
  }
  if(now-lastHeaderTick>250){
    refreshHeader();
    lastHeaderTick=now;
  }
  updateScheduleNowLine();
  if(now-lastUi>900){
    // Passive tickers update lightweight progress surfaces; structural renders are
    // routed through dirty flags.
    refreshGroundTaskProgress();
    refreshFleetList();
    refreshOccWidgets(false);
    refreshScheduleTimeline(false);
    refreshDepartmentWidgets(false);

    lastUi=now;
  }
  if(typeof flushUiDirty==='function') flushUiDirty();
  requestAnimationFrame(loop);
}
applyWorkspaceView(activeWorkspaceView,{restoreWidths:true});
refreshAll();
requestAnimationFrame(loop);
setInterval(save,5000);
window.addEventListener('beforeunload',save);
