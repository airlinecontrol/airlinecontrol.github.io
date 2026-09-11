/* Shared incident timing estimates and locked operational outcomes. */
(function(global){
  'use strict';

  const STEP_MIN=5;
  const MS_PER_MIN=60_000;

  function num(value,fallback=0){
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  }

  function clamp(value,min,max){
    return Math.max(min,Math.min(max,value));
  }

  function roundToStep(value,step=STEP_MIN){
    return Math.max(0,Math.round(num(value)/step)*step);
  }

  function stableUnit(seed){
    if(global.AeroOperationalIntelligence?.stableUnit) return global.AeroOperationalIntelligence.stableUnit(seed);
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)/4294967295;
  }

  function flightAircraft(flight){
    return global.state?.aircraft?.find(item=>item.id===flight?.aircraftId)||null;
  }

  function airportCodeForTask(task,incident,flight){
    const context=incident?.context||{};
    if(task?.department==='station'&&context.airport) return context.airport;
    if(task?.kind==='alternate_handling') return incident?.selectedAlternate||flight?.diversionAirport||flight?.to||flight?.from||'';
    if(['destination_handling','medical_coordination'].includes(task?.kind)) return flight?.diversionAirport||flight?.to||'';
    if(['flight_watch_coordination','reroute_coordination','fuel_monitoring'].includes(task?.kind)) return flight?.diversionAirport||flight?.to||flight?.from||'';
    return context.airport||flight?.from||flight?.to||'';
  }

  function aircraftScale(flight){
    const aircraft=flightAircraft(flight);
    const seats=aircraft&&global.cabinSeatCount ? global.cabinSeatCount(aircraft) : num(global.MODELS?.[aircraft?.model]?.seats,flight?.pax||120);
    if(seats>=380) return {factor:1.55,label:'very large aircraft'};
    if(seats>=240) return {factor:1.35,label:'widebody'};
    if(seats>=170) return {factor:1.16,label:'full narrowbody'};
    if(seats<=70) return {factor:.82,label:'regional aircraft'};
    return {factor:1,label:'aircraft size'};
  }

  function airportScale(code){
    const market=global.AIRPORT_MARKETS?.[code]||{};
    const ops=global.AIRPORT_OPS?.[code]||{};
    const pressure=(num(market.size,.65)+num(market.hub,.55))/2;
    const slotFactor=ops.slotIntervalMin&&ops.slotIntervalMin<=10?.08:0;
    const factor=clamp(.88+pressure*.28+slotFactor,.88,1.28);
    const label=pressure>.88?'hub pressure':pressure>.72?'airport complexity':'station complexity';
    return {factor,label};
  }

  function weatherScale(code,timestamp){
    const weather=code&&global.Management?.weatherAt ? global.Management.weatherAt(code,timestamp) : null;
    if(!weather) return {factor:1,label:''};
    const condition=weather.conditions||weather.label||'weather';
    if(weather.type==='snow'||/snow|ice|deicing/i.test(condition)) return {factor:1.32,label:'winter weather'};
    if(weather.level==='severe') return {factor:1.30,label:'severe weather'};
    if(weather.level==='caution') return {factor:1.14,label:'weather caution'};
    if(num(weather.capacityFactor,1)<.85) return {factor:1.12,label:'reduced airport capacity'};
    return {factor:1,label:''};
  }

  function passengerScale(flight){
    const pax=num(flight?.pax,0);
    if(flight?.flightType==='ferry'||pax<=0) return {factor:.88,label:'empty flight'};
    if(pax>=300) return {factor:1.22,label:'high passenger load'};
    if(pax>=170) return {factor:1.10,label:'passenger load'};
    return {factor:1,label:''};
  }

  function timingTimestamp(incident,flight){
    return num(incident?.detectedAt,0)||num(flight?.departure,0)||Date.now();
  }

  function baseProfile(task,incident,flight,action){
    const profile=global.AeroIncidentModel?.timingProfileForTask?.(task,incident,action,flight);
    return profile||{delayMin:0,responseMin:0,spread:.25,drivers:[],exactDelay:false,exactResponse:false};
  }

  function variedValue({seed,base,spread,min,max,scale=1,exact=false}){
    const raw=Math.max(0,num(base,0));
    if(!raw) return {value:0,low:0,high:0};
    const scaled=raw*(exact?1:scale);
    const bounded=value=>clamp(value,num(min,0),Number.isFinite(max)?max:600);
    if(exact||spread===0){
      const value=roundToStep(bounded(scaled));
      return {value,low:value,high:value};
    }
    const roll=stableUnit(seed);
    const low=roundToStep(bounded(scaled*(1-spread*.65)));
    const high=Math.max(low,roundToStep(bounded(scaled*(1+spread))));
    const value=roundToStep(bounded(low+(high-low)*roll));
    return {value,low,high};
  }

  function operationalScale(task,incident,flight,action,timestamp){
    const drivers=[];
    let factor=1;
    const add=entry=>{
      if(!entry?.label) return;
      factor*=entry.factor||1;
      if(Math.abs((entry.factor||1)-1)>.04) drivers.push(entry.label);
    };
    if(['station_recovery','fuel_recovery','security_coordination','destination_handling','alternate_handling','performance_coordination'].includes(task?.kind)||['continue','continue_low','hold'].includes(action)){
      add(aircraftScale(flight));
      add(passengerScale(flight));
    }
    if(['station_recovery','fuel_recovery','security_coordination','stand_request','destination_handling','alternate_handling'].includes(task?.kind)){
      add(airportScale(airportCodeForTask(task,incident,flight)));
      add(weatherScale(airportCodeForTask(task,incident,flight),timestamp));
    }
    if(['atc_coordination','reroute_coordination','flight_watch_coordination'].includes(task?.kind)||['priority','direct','accept','hold_ground'].includes(action)){
      add(airportScale(airportCodeForTask(task,incident,flight)));
    }
    if(['crew_report','crew_augmentation','crew_allocation'].includes(task?.kind)||['replace','augment','wait_crew'].includes(action)){
      add(airportScale(flight?.from||airportCodeForTask(task,incident,flight)));
    }
    return {factor:clamp(factor,.65,1.9),drivers};
  }

  function estimateTaskTiming(task,incident,flight,actionId='',overrides={}){
    const action=actionId||overrides.action||task?.action||task?.selection?.action||task?.selection?.strategy||'';
    const timestamp=timingTimestamp(incident,flight);
    const profile=baseProfile(task,incident,flight,action);
    const scale=operationalScale(task,incident,flight,action,timestamp);
    const exactDelay=overrides.exactDelay ?? profile.exactDelay;
    const exactResponse=overrides.exactResponse ?? profile.exactResponse;
    const delayBase=overrides.delayMin ?? overrides.baseDelayMin ?? profile.delayMin;
    const responseBase=overrides.responseMin ?? overrides.baseResponseMin ?? profile.responseMin;
    const spread=overrides.spread ?? profile.spread ?? .25;
    const delay=variedValue({
      seed:`${incident?.id||'incident'}:${task?.key||task?.id||'task'}:${action}:delay`,
      base:delayBase,spread,min:overrides.minDelayMin??0,max:overrides.maxDelayMin??600,
      scale:overrides.delayScale ?? scale.factor,exact:exactDelay
    });
    const response=variedValue({
      seed:`${incident?.id||'incident'}:${task?.key||task?.id||'task'}:${action}:response`,
      base:responseBase,spread:Math.min(spread,.35),min:overrides.minResponseMin??0,max:overrides.maxResponseMin??240,
      scale:overrides.responseScale ?? scale.factor,exact:exactResponse
    });
    const drivers=[...(profile.drivers||[]),...scale.drivers,...(overrides.drivers||[])].filter(Boolean);
    return {
      action,
      delayMin:delay.value,delayLowMin:delay.low,delayHighMin:delay.high,
      responseMin:response.value,responseLowMin:response.low,responseHighMin:response.high,
      exactDelay:Boolean(exactDelay),exactResponse:Boolean(exactResponse),
      drivers:[...new Set(drivers)].slice(0,3),
      generatedAt:timestamp
    };
  }

  function lockTaskTiming(task,incident,flight,actionId='',overrides={}){
    const action=actionId||overrides.action||task?.action||'default';
    task.timingPlans??={};
    if(task.timingPlans[action]) return task.timingPlans[action];
    const plan=estimateTaskTiming(task,incident,flight,action,overrides);
    task.timingPlans[action]={...plan,lockedAt:global.simNow?global.simNow():Date.now()};
    return task.timingPlans[action];
  }

  function timingRangeText(low,high,{prefix='+',suffix=' min delay'}={}){
    low=Math.max(0,Math.round(num(low,0)));
    high=Math.max(low,Math.round(num(high,low)));
    if(!high) return prefix==='-'?'no recoverable delay':'no planned delay';
    return low===high?`${prefix}${high}${suffix}`:`${prefix}${low}-${high}${suffix}`;
  }

  function optionDelayPreview(task,incident,flight,actionId='',overrides={}){
    const plan=estimateTaskTiming(task,incident,flight,actionId,overrides);
    return plan.delayHighMin||plan.responseHighMin ? plan : null;
  }

  function formatOptionDelay(plan){
    if(!plan) return '';
    const pieces=[];
    if(plan.delayHighMin) pieces.push(`possible ${timingRangeText(plan.delayLowMin,plan.delayHighMin)}`);
    if(plan.responseHighMin) pieces.push(`response ${timingRangeText(plan.responseLowMin,plan.responseHighMin,{prefix:'',suffix:' min'})}`);
    if(plan.drivers?.length) pieces.push(plan.drivers.join(' / '));
    return pieces.join(' · ');
  }

  function enrouteResponseEstimate(flight,option){
    const base=option?.id==='speed'?5:option?.id==='priority'?9:7;
    const spread=option?.id==='priority'?.35:.30;
    const rollSeed=`${flight?.id||'flight'}:${option?.id||'recovery'}:enroute-response`;
    const estimate=variedValue({seed:rollSeed,base,spread,min:3,max:18,scale:1,exact:false});
    return {
      responseMin:Math.max(3,estimate.value),
      responseLowMin:Math.max(3,estimate.low),
      responseHighMin:Math.max(3,estimate.high),
      drivers:[option?.id==='speed'?'flight deck acceptance':'ATC / flight deck response']
    };
  }

  function lockEnrouteResponse(flight,option){
    if(!flight||!option) return enrouteResponseEstimate(flight,option);
    flight.enrouteRecoveryTimingPlans??={};
    if(flight.enrouteRecoveryTimingPlans[option.id]) return flight.enrouteRecoveryTimingPlans[option.id];
    const plan=enrouteResponseEstimate(flight,option);
    flight.enrouteRecoveryTimingPlans[option.id]={...plan,lockedAt:global.simNow?global.simNow():Date.now()};
    return flight.enrouteRecoveryTimingPlans[option.id];
  }

  const api={
    estimateTaskTiming,lockTaskTiming,optionDelayPreview,formatOptionDelay,timingRangeText,
    enrouteResponseEstimate,lockEnrouteResponse
  };
  global.AeroIncidentDelay=api;
})(window);
