const assert=require('node:assert/strict');

global.window=global;
global.MIN=60_000;
global.state={aircraft:[]};
global.flightTotalDepartureDelayMin=flight=>Math.max(0,Math.round(((flight.actualDeparture??flight.departure)-flight.departure)/MIN));
global.flightActualArrival=flight=>flight.actualArrival??flight.arrival;
global.flightOperationalDestination=flight=>flight.diversionAirport||flight.to;
global.AIRPORT_NIGHT_RULES={FRA:{timeZone:'UTC'}};
global.localTimeParts=(zone,timestamp)=>({
  hour:new Date(timestamp).getUTCHours(),
  minute:new Date(timestamp).getUTCMinutes()
});
global.airportNightStatus=(airport,timestamp)=>{
  const hour=new Date(timestamp).getUTCHours();
  return {status:hour>=23||hour<5?'closed':'open'};
};

require('../js/recovery-costs.js');

const dayFlight={
  id:'AS1',from:'LHR',to:'FRA',
  departure:Date.UTC(2026,0,1,8),
  arrival:Date.UTC(2026,0,1,10),
  actualDeparture:Date.UTC(2026,0,1,12),
  actualArrival:Date.UTC(2026,0,1,14),
  pax:120
};
assert.equal(passengerOvernightExposure(dayFlight,240).pax,0,'long daytime delay should not become overnight pax');

const nightFlight={
  ...dayFlight,id:'AS2',
  actualDeparture:Date.UTC(2026,0,1,20),
  actualArrival:Date.UTC(2026,0,1,23,20)
};
assert.ok(passengerOvernightExposure(nightFlight,240).pax>0,'late-night arrival should create overnight pax');

console.log('passenger recovery smoke tests passed');
