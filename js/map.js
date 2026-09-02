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

const airportLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const aircraftLayer = L.layerGroup().addTo(map);
const aircraftMarkers = new Map();
let routeSignature = '';

function aircraftIcon(ac, p) {
  const selected = ac.id === selectedAircraftId;
  const label = p.flight ? `${p.flight.id}  ${ac.tail}` : ac.tail;
  // The Unicode airplane glyph points roughly northeast, hence the -45 degree correction.
  const rotation = Math.round((p.heading || 0) - 45);
  return L.divIcon({
    className: '',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div class="plane-shell ${p.status === 'ground' ? 'ground' : ''} ${selected ? 'selected' : ''}">
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
}

function rebuildRoutesIfNeeded() {
  const t = simNow();
  const visible = state.flights
    .filter(f => !f.cancelled && flightActualDeparture(f) <= t + 2*HOUR && flightActualArrival(f) > t - 15*MIN)
    .sort((a,b) => a.id.localeCompare(b.id));
  const signature = visible.map(f =>
    `${f.id}:${statusOfFlight(f,t)}:${flightOperationalDestination(f)}:${f.id===selectedFlightId?1:0}`
  ).join('|');

  if (signature === routeSignature) return;
  routeSignature = signature;
  routeLayer.clearLayers();

  for (const f of visible) {
    const selected = f.id === selectedFlightId;
    const st = statusOfFlight(f,t);
    const destination=flightOperationalDestination(f);
    const coords = routeCoords(AIRPORTS[f.from], AIRPORTS[destination], 80).map(([lon,lat]) => [lat,lon]);
    const line = L.polyline(coords, {
      color: selected ? '#58d2ff' : (st === 'airborne' ? '#74a9c1' : '#607887'),
      weight: selected ? 3 : 2,
      opacity: (st === 'scheduled' || st === 'delayed') ? .38 : .78,
      dashArray: '7 7',
      interactive: true
    }).addTo(routeLayer);
    line.bindTooltip(`${f.id} · ${f.from} → ${destination}${destination!==f.to?` (planned ${f.to})`:''}`);
    line.on('click', () => settleSelectedFlight(f.id));
  }
}

function updateMapData() {
  rebuildRoutesIfNeeded();
  const t = simNow();
  const liveIds = new Set();

  for (const ac of state.aircraft) {
    const p = currentAircraftPosition(ac,t);
    liveIds.add(ac.id);
    let marker = aircraftMarkers.get(ac.id);
    const iconKey=[
      p.status,
      ac.id===selectedAircraftId?1:0,
      p.flight?p.flight.id:'ground',
      Math.round((p.heading||0)/5)*5
    ].join('|');

    if (!marker) {
      marker = L.marker([p.lat,p.lon], {
        icon: aircraftIcon(ac,p),
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
        marker.setIcon(aircraftIcon(ac,p));
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
  map.invalidateSize({animate:false});
  updateMapData();
  fitNetwork();
  refreshScheduleTimeline(true);
});
document.getElementById('fitBtn').addEventListener('click',fitNetwork);

let lastUi=0;
function loop(now){
  processEvents();
  updateMapData();
  refreshHeader();
  updateScheduleNowLine();
  if(now-lastUi>900){
    // High-frequency refreshes must never rebuild form controls. Native combo boxes
    // can otherwise be destroyed/recreated while the user is choosing a value.
    refreshFleetList();
    refreshFlightDetails(false);
    refreshAircraftDetails(false);
    refreshGroundTaskProgress();
    refreshKPIs();
    refreshScheduleTimeline(false);

    // These functions are signature-guarded. They only touch form/card DOM when
    // their underlying data actually changed, and never while a contained control
    // has focus.
    refreshAircraftSelect(false);
    refreshSlotPortfolio(false);
    refreshPersonnel(false);
    refreshOccWidgets(false);
    refreshDepartmentWidgets(false);
    refreshManagementCycle(false);
    refreshMaintenance(false);
    refreshWeather(false);
    refreshResourceRequestSummary(false);

    lastUi=now;
  }
  requestAnimationFrame(loop);
}
applyWorkspaceView(activeWorkspaceView,{restoreWidths:true});
refreshAll();
requestAnimationFrame(loop);
setInterval(save,5000);
window.addEventListener('beforeunload',save);
