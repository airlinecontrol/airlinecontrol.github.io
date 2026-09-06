/* Pure decision-support models for AeroSim's OCC simulation. */

window.AeroOperationalIntelligence = (() => {
  'use strict';

  const MINUTE=60_000;
  const HOUR=60*MINUTE;

  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }

  function stableUnit(seed){
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }

  function resourceAvailability({kind,key='',location='',current=0,pending=0,now=Date.now()}){
    const seed=`${kind}:${key}:${location}:${Math.floor(now/(7*24*HOUR))}`;
    const roll=stableUnit(seed);
    const capacity=kind==='aircraft'?8+Math.floor(roll*5):kind==='personnel'?20+Math.floor(roll*21):4+Math.floor(roll*4);
    const available=Math.max(0,capacity-current-pending);
    const leadMin=available?0:kind==='aircraft'?180+Math.round(roll*540):kind==='personnel'?45+Math.round(roll*180):60+Math.round(roll*300);
    return {
      capacity,available,leadMin,
      status:available?'available':'lead-time',
      label:available?`${available} available now`:`allocation in ${leadMin} min`
    };
  }

  function airportConstraint(airport,timestamp,weather={capacityFactor:1}){
    const period=Math.floor(timestamp/(6*HOUR));
    const roll=stableUnit(`${airport}:${period}:airport-flow`);
    const weatherPenalty=Math.max(0,1-(Number(weather.capacityFactor)||1));
    const constrained=roll<.18+weatherPenalty*.7;
    const severe=constrained&&(roll<.035+weatherPenalty*.25);
    const reasons=['Runway configuration','Stand congestion','Departure sequencing','Surface movement restriction'];
    const delayMin=severe?30+Math.round(stableUnit(`${airport}:${period}:severe`)*30):constrained?8+Math.round(stableUnit(`${airport}:${period}:delay`)*17):0;
    return {
      airport,level:severe?'severe':constrained?'reduced':'normal',delayMin,
      capacityFactor:clamp((Number(weather.capacityFactor)||1)*(severe ? .58 : constrained ? .82 : 1),.35,1),
      reason:delayMin?reasons[Math.floor(stableUnit(`${airport}:${period}:reason`)*reasons.length)]:'Normal airport flow',
      validUntil:(period+1)*6*HOUR
    };
  }

  function airspaceConstraint(from,to,timestamp,distanceKm=0){
    const period=Math.floor(timestamp/(6*HOUR));
    const roll=stableUnit(`${from}:${to}:${period}:airspace`);
    const longHaulFactor=distanceKm>4000?.08:distanceKm>1500?.04:0;
    const restricted=roll<.13+longHaulFactor;
    const delayMin=restricted?8+Math.round(stableUnit(`${from}:${to}:${period}:flow`)*22):0;
    const sectors=['upper-airway congestion','military airspace activation','cross-border flow regulation','oceanic entry sequencing'];
    return {
      level:restricted?'regulated':'normal',delayMin,
      reason:restricted?sectors[Math.floor(stableUnit(`${from}:${to}:${period}:reason`)*sectors.length)]:'Route available',
      validUntil:(period+1)*6*HOUR
    };
  }

  const MEL_FINDINGS=[
    {ata:'21',code:'21-52',title:'Pack control channel fault',category:'C',days:10,restriction:'Single-pack dispatch procedure',performancePenalty:.025},
    {ata:'23',code:'23-71',title:'Cabin communication handset inoperative',category:'D',days:120,restriction:'Cabin station coordination procedure',performancePenalty:0},
    {ata:'27',code:'27-94',title:'Flight-control position sensor fault',category:'B',days:3,restriction:'Reduced automation dispatch',performancePenalty:.02},
    {ata:'32',code:'32-41',title:'Brake temperature indication fault',category:'B',days:3,restriction:'Manual brake cooling calculation',performancePenalty:.035},
    {ata:'34',code:'34-45',title:'Weather radar channel degraded',category:'C',days:10,restriction:'Avoid embedded convective weather',performancePenalty:.015},
    {ata:'36',code:'36-11',title:'Pneumatic leak detection channel fault',category:'A',days:1,restriction:'Engineering-controlled flight limit',performancePenalty:.04}
  ];

  function melFinding(seed,detectedAt=Date.now()){
    const finding=MEL_FINDINGS[Math.floor(stableUnit(`${seed}:mel`)*MEL_FINDINGS.length)];
    return {
      ...finding,id:`MEL-${finding.code}-${String(seed).replace(/\W/g,'').slice(-5)}`,
      detectedAt,expiresAt:detectedAt+finding.days*24*HOUR,remainingCycles:finding.category==='A'?2:finding.category==='B'?8:finding.category==='C'?30:120,
      status:'open'
    };
  }

  function crewDutyAssessment({departure,arrival,sectors=1,reportingMin=60,releaseMin=30,augmented=false}){
    const localHour=new Date(departure).getHours();
    const night=localHour<6||localHour>=22;
    const normalMax=clamp((night?11:13)-Math.max(0,sectors-2)*.5,9,13);
    const maxHours=augmented?Math.min(18,normalMax+4):normalMax;
    const dutyStart=departure-reportingMin*MINUTE;
    const dutyEnd=arrival+releaseMin*MINUTE;
    const dutyHours=(dutyEnd-dutyStart)/HOUR;
    return {
      dutyStart,dutyEnd,dutyHours,maxHours,sectors,night,augmented,legal:dutyHours<=maxHours,
      remainingHours:maxHours-dutyHours,restHours:10,
      label:dutyHours<=maxHours?'Legal duty':`Exceeds FDP by ${(dutyHours-maxHours).toFixed(1)} h`
    };
  }

  const MAJOR_CONNECTION_AIRPORTS=new Set(['LHR','JFK','CDG','AMS','HND','DXB','SIN']);
  function minimumConnectionMinutes(airport){
    return MAJOR_CONNECTION_AIRPORTS.has(airport)?60:45;
  }
  function maximumConnectionMinutes(airport){
    return MAJOR_CONNECTION_AIRPORTS.has(airport)?210:180;
  }

  function connectionManifest({flight,onwardFlights=[],actualArrival,now=actualArrival}){
    const connectionAirport=flight.diversionAirport||flight.to;
    const isOwnNetworkConnection=next=>{
      if(!next||next.id===flight.id||next.cancelled||next.flightType==='ferry'||flight.flightType==='ferry') return false;
      if(next.from!==connectionAirport) return false;
      if(flight.aircraftId&&next.aircraftId===flight.aircraftId) return false;
      if(next.to===flight.from) return false;
      const scheduledConnectionMin=(next.departure-flight.arrival)/MINUTE;
      return scheduledConnectionMin>=minimumConnectionMinutes(connectionAirport)&&scheduledConnectionMin<=maximumConnectionMinutes(connectionAirport);
    };
    const candidates=onwardFlights
      .filter(isOwnNetworkConnection)
      .sort((a,b)=>a.departure-b.departure).slice(0,2);
    if(!candidates.length||!flight.pax||flight.flightType==='ferry') return {total:0,critical:0,atRisk:0,missed:0,connections:[]};
    const share=.10+stableUnit(`${flight.id}:connections`)*.20;
    const total=Math.min(Math.round(flight.pax*share),Math.max(0,flight.pax-1));
    const weights=candidates.map(next=>.7+stableUnit(`${flight.id}:${next.id}`)*.6);
    const weightTotal=weights.reduce((sum,value)=>sum+value,0);
    let assigned=0;
    const connections=candidates.map((next,index)=>{
      const pax=index===candidates.length-1?total-assigned:Math.round(total*weights[index]/weightTotal);
      assigned+=pax;
      const airport=connectionAirport;
      const mctMin=minimumConnectionMinutes(airport);
      const departure=next.actualDeparture??next.departure;
      const correctedAvailable=(departure-actualArrival)/MINUTE;
      const departed=Boolean(next.departureLogged)||departure<=now;
      const status=correctedAvailable<0||departed?'missed':correctedAvailable<mctMin?'critical':correctedAvailable<mctMin+20?'at-risk':'protected';
      return {flightId:next.id,to:next.diversionAirport||next.to,pax,mctMin,availableMin:correctedAvailable,status,ownNetwork:true};
    });
    return {
      total,
      critical:connections.filter(item=>item.status==='critical').reduce((sum,item)=>sum+item.pax,0),
      atRisk:connections.filter(item=>item.status==='at-risk').reduce((sum,item)=>sum+item.pax,0),
      missed:connections.filter(item=>item.status==='missed').reduce((sum,item)=>sum+item.pax,0),
      connections
    };
  }

  function recoveryOptions({flight,downstreamFlights=[],connections={total:0,critical:0,atRisk:0,missed:0},spareAvailable=false}){
    const delayMin=Math.max(0,Math.round(((flight.actualDeparture??flight.departure)-flight.departure)/MINUTE));
    const downstreamDelay=downstreamFlights.reduce((sum,item)=>sum+Math.max(0,Math.round(((item.actualDeparture??item.departure)-item.departure)/MINUTE)),0);
    const baseImpact=delayMin+downstreamDelay+(connections.atRisk||0)+(connections.critical||0)*2+(connections.missed||0)*3;
    const plans=[];
    if((flight.handlingDelayMin||0)>0) plans.push({id:'expedite',label:'Expedite turnaround',tone:'good',delayMin:Math.max(0,delayMin-15),downstreamDelay:Math.max(0,downstreamDelay-15*downstreamFlights.length),misconnectPax:Math.max(0,connections.missed-Math.ceil(connections.total*.25)),risk:Math.max(0,baseImpact-25),detail:'Prioritize ground resources and recover up to 15 minutes.'});
    if(spareAvailable) plans.push({id:'use-spare',label:'Use spare aircraft',tone:'good',delayMin:Math.min(delayMin,10),downstreamDelay:Math.max(0,downstreamDelay-delayMin),misconnectPax:Math.floor(connections.missed*.25),risk:Math.max(0,baseImpact-35),detail:'Protect this rotation with the first eligible spare.'});
    if(!plans.length) return [];
    const impactLabel=connections.atRisk||connections.critical||connections.missed
      ? `Accept connection risk${connections.missed?` · ${connections.missed} missed`:connections.critical?` · ${connections.critical} critical`:''}`
      : `Accept current delay · +${delayMin} min`;
    plans.push({
      id:'accept-impact',label:impactLabel,tone:'',delayMin,downstreamDelay,misconnectPax:connections.missed,risk:baseImpact,
      detail:connections.atRisk||connections.critical||connections.missed
        ? 'Keep the current operation and accept the displayed passenger-connection impact.'
        : 'Keep the current operation and accept its displayed delay and downstream impact.'
    });
    return plans.sort((a,b)=>a.risk-b.risk);
  }

  function dispatchBriefing({flight,crew,departureWeather,arrivalWeather,airport,airspace,melItems=[],incidents=[],fuelReady=false,alternate=''}){
    const blocks=[];
    if(!crew?.legal) blocks.push('Crew duty limit');
    if(incidents.some(item=>item.blocking)) blocks.push('Open incident');
    if(melItems.some(item=>item.status==='open'&&(item.expiresAt<=flight.departure||item.remainingCycles<=0))) blocks.push('Expired MEL');
    if(departureWeather?.level==='severe'||arrivalWeather?.level==='severe') blocks.push('Severe weather');
    const cautions=[];
    if(!fuelReady) cautions.push('Fuel pending');
    if(airport?.delayMin) cautions.push(`${airport.reason} +${airport.delayMin}m`);
    if(airspace?.delayMin) cautions.push(`${airspace.reason} +${airspace.delayMin}m`);
    if(melItems.some(item=>item.status==='open')) cautions.push(`${melItems.filter(item=>item.status==='open').length} MEL restriction`);
    return {
      status:blocks.length?'hold':cautions.length?'conditional':'released',blocks,cautions,alternate,
      label:blocks.length?'Dispatch hold':cautions.length?'Conditional release':'Released'
    };
  }

  function scenarioScore({completed=[],cancelled=[],openIncidents=[],missedConnections=0,expiredMel=0}){
    const operated=completed.length,total=operated+cancelled.length;
    const onTime=completed.filter(flight=>((flight.actualArrival??flight.arrival)-flight.arrival)<=15*MINUTE).length;
    const completion=total?operated/total:1;
    const otp=operated?onTime/operated:1;
    const averageDelay=operated?completed.reduce((sum,flight)=>sum+Math.max(0,((flight.actualArrival??flight.arrival)-flight.arrival)/MINUTE),0)/operated:0;
    const score=Math.round(clamp(100-(1-otp)*35-(1-completion)*45-Math.min(20,averageDelay*.35)-Math.min(15,missedConnections*.15)-openIncidents.length*2-expiredMel*8,0,100));
    return {
      score,otp,completion,averageDelay,
      objectives:[
        {id:'completion',label:'Complete at least 96% of flights',met:completion>=.96,value:`${Math.round(completion*100)}%`},
        {id:'punctuality',label:'Maintain at least 80% on-time performance',met:otp>=.8,value:`${Math.round(otp*100)}%`},
        {id:'connections',label:'Keep missed connections below 10 passengers',met:missedConnections<10,value:String(missedConnections)},
        {id:'incidents',label:'Clear decision incidents',met:openIncidents.length===0,value:String(openIncidents.length)},
        {id:'mel',label:'Operate with no expired MEL items',met:expiredMel===0,value:String(expiredMel)}
      ]
    };
  }

  return {
    MINUTE,HOUR,stableUnit,resourceAvailability,airportConstraint,airspaceConstraint,melFinding,
    crewDutyAssessment,connectionManifest,recoveryOptions,dispatchBriefing,scenarioScore
  };
})();
