/* AeroSim Leaflet map, live aircraft layers, and application bootstrap loop. */

const map = L.map('map', {
  zoomControl: true,
  worldCopyJump: true,
  preferCanvas: true,
  attributionControl: true
}).setView([49.5, 8.5], 4);

// Online basemap only; the airline simulation itself stays entirely in the browser.
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const weatherLayer = L.layerGroup().addTo(map);
const airportWeatherLayer = L.layerGroup().addTo(map);
const airportLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const aircraftLayer = L.layerGroup().addTo(map);
const aircraftMarkers = new Map();
let routeSignature = '';
let weatherMapSignature = '';

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

function aircraftIcon(ac, p, index=operationalIndex()) {
  const selected = ac.id === selectedAircraftId;
  const label = p.flight ? `${p.flight.id}  ${ac.tail}` : ac.tail;
  const incident=aircraftMapIncidentState(ac,p,index);
  // The Unicode airplane glyph points roughly northeast, hence the -45 degree correction.
  const rotation = Math.round((p.heading || 0) - 45);
  return L.divIcon({
    className: '',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div class="plane-shell ${p.status === 'airborne' ? 'airborne' : 'ground'} ${incident.level} ${selected ? 'selected' : ''}" title="${esc(incident.label)}">
      <span class="plane-halo"></span>
      <span class="plane-glyph" style="transform:rotate(${rotation}deg)">✈</span>
      <span class="plane-label-map">${label}</span>
    </div>`
  });
}

for (const a of Object.values(AIRPORTS)) {
  const marker = L.marker([a.lat, a.lon], {
    icon: L.divIcon({
      className: '',
      iconSize: [20, 28],
      iconAnchor: [5, 5],
      html: `<div class="airport-dot"></div><div class="airport-label">${a.iata}</div>`
    }),
    keyboard: true,
    title: `${a.iata} — ${a.name}`
  }).addTo(airportLayer);
  marker.bindTooltip(`<b>${a.iata}</b> — ${a.name}`, {direction:'top', className:'airport-tip'});
  marker.on('click', (e) => {
    if(e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
    if(typeof setOperationsAirportFilter==='function') setOperationsAirportFilter(a.iata);
  });
}

function rebuildRoutesIfNeeded() {
  const t = simNow();
  const visible = state.flights
    .filter(f => !f.cancelled && flightActualDeparture(f) <= t + 2*HOUR && flightActualArrival(f) > t - 15*MIN)
    .sort((a,b) => a.id.localeCompare(b.id));
  const signature = visible.map(f =>
    `${f.id}:${statusOfFlight(f,t)}:${flightOperationalDestination(f)}:${f.id===selectedFlightId?1:0}:${window.AeroWeatherEngine?.routeHazardSummary?.(f.from,flightOperationalDestination(f),t)?.level||'normal'}`
  ).join('|');

  if (signature === routeSignature) return;
  routeSignature = signature;
  routeLayer.clearLayers();

  for (const f of visible) {
    const selected = f.id === selectedFlightId;
    const st = statusOfFlight(f,t);
    const destination=flightOperationalDestination(f);
    const routeWeather=window.AeroWeatherEngine?.routeHazardSummary?.(f.from,destination,t)||{hazards:[],level:'normal',delayMin:0,label:''};
    const coords = routeCoords(AIRPORTS[f.from], AIRPORTS[destination], 80).map(([lon,lat]) => [lat,lon]);
    if(routeWeather.hazards?.length){
      L.polyline(coords, {
        color: routeWeather.level==='severe' ? '#e66b5d' : '#d9b95f',
        weight: selected ? 8 : 6,
        opacity: selected ? .55 : .36,
        dashArray: '12 14',
        interactive: false,
        className: `route-weather route-weather-${routeWeather.level}`
      }).addTo(routeLayer);
    }
    const line = L.polyline(coords, {
      color: selected ? '#58d2ff' : (st === 'airborne' ? '#74a9c1' : '#607887'),
      weight: selected ? 3 : 2,
      opacity: (st === 'scheduled' || st === 'delayed') ? .38 : .78,
      dashArray: '7 7',
      interactive: true
    }).addTo(routeLayer);
    line.bindTooltip(`${f.id} · ${f.from} → ${destination}${destination!==f.to?` (planned ${f.to})`:''}${routeWeather.delayMin?` · ${routeWeather.label} +${routeWeather.delayMin}m`:''}`);
    line.on('click', () => settleSelectedFlight(f.id));
  }
}

function weatherLevelStyle(level){
  if(level==='severe') return {color:'#e66b5d',fillColor:'#e66b5d',fillOpacity:.18,opacity:.82};
  if(level==='caution') return {color:'#d9b95f',fillColor:'#d9b95f',fillOpacity:.13,opacity:.7};
  return {color:'#6bcf91',fillColor:'#6bcf91',fillOpacity:.06,opacity:.4};
}

function rebuildWeatherMapIfNeeded(){
  if(!window.AeroWeatherEngine) return;
  const t=simNow();
  const period=Math.floor(t/(30*MIN));
  const codes=typeof operationalAirportCodes==='function'?operationalAirportCodes():Object.keys(AIRPORTS);
  const weatherByCode=codes.map(code=>({code,weather:Management.weatherAt(code,t)}));
  const cells=window.AeroWeatherEngine.weatherCells(t);
  const signature=[
    period,
    weatherByCode.map(item=>`${item.code}:${item.weather.level}:${item.weather.type}:${item.weather.delayMin}`).join('|'),
    cells.map(cell=>`${cell.id}:${Math.round(cell.lat*10)}:${Math.round(cell.lon*10)}:${cell.severity}`).join('|'),
    typeof operationFilterWeatherCellId==='function'?operationFilterWeatherCellId():''
  ].join('::');
  if(signature===weatherMapSignature) return;
  weatherMapSignature=signature;
  weatherLayer.clearLayers();
  airportWeatherLayer.clearLayers();

  for(const cell of cells){
    if(typeof L.polygon!=='function') continue;
    const style=weatherLevelStyle(cell.severity==='severe'?'severe':'caution');
    const polygon=(cell.polygon||[]).map(point=>[point.lat,point.lon]);
    if(polygon.length<3) continue;
    const selected=typeof operationFilterWeatherCellId==='function'&&operationFilterWeatherCellId()===cell.id;
    const layer=L.polygon(polygon,{
      color:style.color,
      fillColor:style.fillColor,
      fillOpacity:cell.severity==='severe' ? .16 : .10,
      opacity:selected ? .9 : cell.severity==='severe' ? .55 : .38,
      weight:selected ? 2 : 1,
      className:`weather-cell weather-cell-${cell.type} weather-cell-${cell.severity} ${selected?'selected':''}`,
      interactive:true
    }).bindTooltip(`${cell.label} · ${cell.severity} · possible +${cell.delayMin}m`).addTo(weatherLayer);
    layer.on('click', (e) => {
      if(e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      if(typeof setOperationsWeatherFilter==='function') setOperationsWeatherFilter(cell);
    });
  }

  for(const {code,weather} of weatherByCode){
    const airport=AIRPORTS[code];
    if(!airport||typeof L.circle!=='function') continue;
    const style=weatherLevelStyle(weather.level);
    L.circle([airport.lat,airport.lon],{
      radius:(weather.impactRadiusKm||35)*1000,
      color:style.color,
      fillColor:style.fillColor,
      fillOpacity:style.fillOpacity,
      opacity:style.opacity,
      weight:weather.level==='normal'?1:2,
      className:`airport-weather-halo airport-weather-${weather.level}`
    }).bindTooltip(`${code} · ${weather.conditions} · wind ${weather.windDirection}°/${weather.windKph}G${weather.gustKph} km/h · vis ${weather.visibilityKm} km · ceiling ${weather.ceilingFt} ft · capacity ${Math.round(weather.capacityFactor*100)}%`).addTo(airportWeatherLayer);
  }
}

function updateMapData() {
  rebuildWeatherMapIfNeeded();
  rebuildRoutesIfNeeded();
  const t = simNow();
  const index=operationalIndex(t);
  const liveIds = new Set();

  for (const ac of state.aircraft) {
    const p = currentAircraftPosition(ac,t,index);
    liveIds.add(ac.id);
    let marker = aircraftMarkers.get(ac.id);
    const incident=aircraftMapIncidentState(ac,p,index);
    const iconKey=[
      p.status,
      ac.id===selectedAircraftId?1:0,
      p.flight?p.flight.id:'ground',
      incident.level,
      Math.round((p.heading||0)/5)*5
    ].join('|');

    if (!marker) {
      marker = L.marker([p.lat,p.lon], {
        icon: aircraftIcon(ac,p,index),
        keyboard: true,
        zIndexOffset: p.status === 'airborne' ? 1000 : 300
      }).addTo(aircraftLayer);
      marker.__iconKey=iconKey;
      marker.on('click', (e) => {
        if(e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        settleSelected(ac.id);
      });
      aircraftMarkers.set(ac.id, marker);
    } else {
      marker.setLatLng([p.lat,p.lon]);
      if(marker.__iconKey!==iconKey){
        marker.setIcon(aircraftIcon(ac,p,index));
        marker.__iconKey=iconKey;
      }
      marker.setZIndexOffset(p.status === 'airborne' ? 1000 : 300);
    }
  }

  for (const [id, marker] of aircraftMarkers) {
    if (!liveIds.has(id)) {
      aircraftLayer.removeLayer(marker);
      aircraftMarkers.delete(id);
    }
  }
}

function fitNetwork() {
  const pts=[];
  for(const ac of state.aircraft){
    const p=currentAircraftPosition(ac);
    pts.push([p.lat,p.lon]);
  }
  for(const f of state.flights){
    const destination=flightOperationalDestination(f);
    pts.push([AIRPORTS[f.from].lat,AIRPORTS[f.from].lon],[AIRPORTS[destination].lat,AIRPORTS[destination].lon]);
  }
  if(!pts.length) return;
  map.fitBounds(L.latLngBounds(pts), {padding:[60,60], maxZoom:5});
}

map.whenReady(() => {
  if(typeof map.invalidateSize==='function') map.invalidateSize({animate:false});
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
