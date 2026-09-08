/*
 * AeroSim management domain
 *
 * Pure, browser-native helpers for the connected planning → operations → review
 * game loop. The module deliberately owns no DOM and no persistence. Callers
 * pass the current save and the few simulation callbacks it needs.
 */
window.AeroManagement = (() => {
  'use strict';

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const CHECK_INTERVAL_HOURS = 600;
  const CHECK_INTERVAL_CYCLES = 450;

  const AIRPORT_WEATHER = {
    FRA:{wind:18,risk:.22,climate:'continental'}, LHR:{wind:22,risk:.29,climate:'maritime'},
    JFK:{wind:21,risk:.25,climate:'continental'}, MAD:{wind:15,risk:.13,climate:'dry'},
    AMS:{wind:24,risk:.30,climate:'maritime'}, CDG:{wind:18,risk:.22,climate:'continental'},
    FCO:{wind:14,risk:.15,climate:'mediterranean'}, DXB:{wind:12,risk:.10,climate:'desert'},
    SIN:{wind:13,risk:.28,climate:'tropical'}, HND:{wind:18,risk:.26,climate:'coastal'},
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
    HNL:{wind:21,risk:.25,climate:'tropical'}, ANC:{wind:18,risk:.31,climate:'nordic'}
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

  function aircraftFamily(modelName=''){
    if(/^ATR/.test(modelName)) return 'ATR';
    if(/^E\d/.test(modelName)) return 'Embraer E-Jet';
    if(/^CRJ/.test(modelName)) return 'CRJ';
    if(/^A220/.test(modelName)) return 'Airbus A220';
    if(/^A31|^A32/.test(modelName)) return 'Airbus A320 family';
    if(/^A330/.test(modelName)) return 'Airbus A330';
    if(/^A350/.test(modelName)) return 'Airbus A350';
    if(/^A380/.test(modelName)) return 'Airbus A380';
    if(/^737/.test(modelName)) return 'Boeing 737';
    if(/^787/.test(modelName)) return 'Boeing 787';
    if(/^777/.test(modelName)) return 'Boeing 777';
    return 'Multi-fleet';
  }

  function ensureAircraftMaintenance(aircraft){
    if(!aircraft.maintenance || typeof aircraft.maintenance!=='object'){
      aircraft.maintenance={
        lastCheckHours:Number(aircraft.flightHours)||0,
        lastCheckCycles:Number(aircraft.cycles)||0,
        scheduled:null
      };
    }
    if(!Number.isFinite(aircraft.maintenance.lastCheckHours)) aircraft.maintenance.lastCheckHours=Number(aircraft.flightHours)||0;
    if(!Number.isFinite(aircraft.maintenance.lastCheckCycles)) aircraft.maintenance.lastCheckCycles=Number(aircraft.cycles)||0;
    return aircraft.maintenance;
  }

  function ensureState(state,now){
    let changed=false;
    if(!state.management || typeof state.management!=='object'){
      state.management={cycleStart:now,reviews:[]};
      changed=true;
    }
    if(!Number.isFinite(state.management.cycleStart)){
      state.management.cycleStart=now;
      changed=true;
    }
    if(!Array.isArray(state.management.reviews)){
      state.management.reviews=[];
      changed=true;
    }
    for(const aircraft of state.aircraft||[]){
      if(!aircraft.maintenance){ ensureAircraftMaintenance(aircraft); changed=true; }
    }
    for(const flight of state.flights||[]){
      const defaults={
        manualDelayMin:0,weatherDelayMin:0,liveWeatherDelayMin:0,weatherChecked:false,weatherCode:'',
        cancelled:false,cancelledAt:0,cancellationCost:0,flightType:'passenger',
        connectionCriticalPax:0,
        issueAcknowledgedAt:0
      };
      for(const [key,value] of Object.entries(defaults)){
        if(flight[key]===undefined){ flight[key]=value; changed=true; }
      }
      if(!flight.weatherLiveChecks || typeof flight.weatherLiveChecks!=='object') flight.weatherLiveChecks={};
      if(flight.weatherRouteHazard===undefined) flight.weatherRouteHazard='';
      if(flight.weatherCause===undefined) flight.weatherCause=null;
    }
    const statDefaults={cancellationCosts:0,scheduledMaintenanceCosts:0,cancelled:0};
    for(const [key,value] of Object.entries(statDefaults)){
      if(!Number.isFinite(state.stats?.[key])){ state.stats[key]=value; changed=true; }
    }
    return changed;
  }

  function weatherAt(airportCode,timestamp){
    if(window.AeroWeatherEngine?.weatherAt) return window.AeroWeatherEngine.weatherAt(airportCode,timestamp);
    const profile=AIRPORT_WEATHER[airportCode]||{wind:16,risk:.2,climate:'temperate'};
    const period=Math.floor(timestamp/(6*HOUR));
    const date=new Date(timestamp);
    const month=date.getMonth();
    const winter=[11,0,1].includes(month);
    const summer=[5,6,7].includes(month);
    const seasonalRisk=profile.climate==='continental'&&winter ? .08 :
      profile.climate==='tropical'&&summer ? .09 :
      profile.climate==='coastal'&&summer ? .06 :
      profile.climate==='desert'&&summer ? .04 : 0;
    const risk=clamp(profile.risk+seasonalRisk,.08,.42);
    const eventRoll=stableUnit(`${airportCode}:${period}:event`);
    const windRoll=stableUnit(`${airportCode}:${period}:wind`);
    const detailRoll=stableUnit(`${airportCode}:${period}:detail`);
    const severe=eventRoll<risk*.12;
    const caution=!severe&&eventRoll<risk;
    const level=severe?'severe':caution?'caution':'normal';
    const windKph=Math.round(profile.wind*(.65+windRoll*1.55)+(severe?25:caution?10:0));
    const delayMin=severe?45+Math.round(detailRoll*45):caution?10+Math.round(detailRoll*20):0;
    const conditions=severe
      ? (profile.climate==='continental'&&winter?'Snow / low visibility':'Storm cells / low visibility')
      : caution
        ? (windKph>38?'Strong crosswind':'Reduced visibility / showers')
        : 'Normal operations';
    return {
      airport:airportCode,level,label:level==='normal'?'Normal':level==='caution'?'Caution':'Severe',
      windKph,delayMin,capacityFactor:severe?.55:caution?.78:1,conditions,
      validFrom:period*6*HOUR,validUntil:(period+1)*6*HOUR
    };
  }

  function maintenanceStatus(aircraft,now){
    const maintenance=ensureAircraftMaintenance(aircraft);
    const hoursSince=Math.max(0,(Number(aircraft.flightHours)||0)-maintenance.lastCheckHours);
    const cyclesSince=Math.max(0,(Number(aircraft.cycles)||0)-maintenance.lastCheckCycles);
    const progress=Math.max(hoursSince/CHECK_INTERVAL_HOURS,cyclesSince/CHECK_INTERVAL_CYCLES);
    const scheduled=maintenance.scheduled;
    const active=Boolean(scheduled&&now>=scheduled.start&&now<scheduled.end);
    const due=progress>=1;
    const grounding=progress>=1.15;
    return {
      hoursSince,cyclesSince,progress,due,grounding,active,scheduled,
      remainingHours:Math.max(0,CHECK_INTERVAL_HOURS-hoursSince),
      remainingCycles:Math.max(0,CHECK_INTERVAL_CYCLES-cyclesSince),
      label:active?'In maintenance':grounding?'Grounded — overdue':due?'Maintenance due':scheduled?'Check scheduled':'Serviceable'
    };
  }

  function maintenancePlan(aircraft,start,airport,seats=100){
    const status=maintenanceStatus(aircraft,start);
    const overdueFactor=status.due?1.18:1;
    const durationHours=Math.round((6+seats/65)*2)/2;
    const cost=Math.round((18_000+seats*240)*overdueFactor/500)*500;
    return {start,end:start+durationHours*HOUR,airport,durationHours,cost,status:'scheduled'};
  }

  function processMaintenance(state,now,postTransaction){
    let changed=false;
    for(const aircraft of state.aircraft||[]){
      const maintenance=ensureAircraftMaintenance(aircraft);
      const job=maintenance.scheduled;
      if(!job) continue;
      if(now>=job.start&&job.status==='scheduled'){
        job.status='active';
        changed=true;
      }
      if(now>=job.end&&job.status!=='completed'){
        job.status='completed';
        maintenance.lastCheckHours=Number(aircraft.flightHours)||0;
        maintenance.lastCheckCycles=Number(aircraft.cycles)||0;
        maintenance.lastCompletedAt=job.end;
        aircraft.condition=clamp((Number(aircraft.condition)||0)+18,0,100);
        state.stats.scheduledMaintenanceCosts+=(Number(job.cost)||0);
        if(job.cost) postTransaction(-job.cost,'Scheduled maintenance',`${aircraft.tail} scheduled check`,aircraft.id);
        maintenance.scheduled=null;
        changed=true;
      }
    }
    return changed;
  }

  function cyclePhase(state,now){
    const start=state.management?.cycleStart||now;
    const elapsed=clamp(now-start,0,WEEK);
    const progress=elapsed/WEEK;
    const phase=elapsed<DAY?'plan':elapsed<6*DAY?'operate':'review';
    return {
      phase,start,end:start+WEEK,progress,
      label:phase==='plan'?'Plan the week':phase==='operate'?'Operate and recover':'Review and adjust',
      guidance:phase==='plan'
        ? 'Confirm demand, rotations, staffing and maintenance before the operating week develops.'
        : phase==='operate'
          ? 'Protect completion and punctuality. Resolve the highest-impact exceptions first.'
          : 'Review route contribution and operational KPIs, then adjust the next programme.'
    };
  }

  function operationalKpis(state,now,days=30,startOverride=null,endOverride=null){
    const start=startOverride??now-days*DAY;
    const end=endOverride??now;
    const completed=(state.flights||[]).filter(f=>f.settled&&(f.actualArrival??f.arrival)>=start&&(f.actualArrival??f.arrival)<end);
    const cancelled=(state.flights||[]).filter(f=>f.cancelled&&f.cancelledAt>=start&&f.cancelledAt<end);
    const operated=completed.length;
    const total=operated+cancelled.length;
    const onTime=completed.filter(f=>((f.actualArrival??f.arrival)-f.arrival)<=15*MIN).length;
    const arrivalDelay=completed.reduce((sum,f)=>sum+Math.max(0,((f.actualArrival??f.arrival)-f.arrival)/MIN),0);
    const pax=completed.reduce((sum,f)=>sum+(Number(f.pax)||0),0);
    const seats=completed.reduce((sum,f)=>sum+(f.load?Math.round((Number(f.pax)||0)/f.load):Number(f.pax)||0),0);
    const revenue=completed.reduce((sum,f)=>sum+(Number(f.revenue)||0),0);
    const directCosts=completed.reduce((sum,f)=>sum+(Number(f.costs)||0),0);
    const blockHours=completed.reduce((sum,f)=>sum+Math.max(0,(f.arrival-f.departure)/HOUR),0);
    const periodDays=Math.max(1,(end-start)/DAY);
    return {
      completed:operated,cancelled:cancelled.length,total,
      onTimePerformance:operated?onTime/operated:1,
      completionFactor:total?operated/total:1,
      loadFactor:seats?pax/seats:0,
      averageDelayMin:operated?arrivalDelay/operated:0,
      utilization:(state.aircraft?.length&&periodDays)?blockHours/(state.aircraft.length*periodDays*24):0,
      revenue,directCosts,directResult:revenue-directCosts,
      operatingMargin:revenue?(revenue-directCosts)/revenue:0,
      passengers:pax,blockHours
    };
  }

  function processWeeklyReviews(state,now){
    let changed=false,guard=0;
    while(now>=state.management.cycleStart+WEEK&&guard<104){
      const start=state.management.cycleStart,end=start+WEEK;
      const kpis=operationalKpis(state,end,7,start,end);
      state.management.reviews.push({id:`WR${state.management.reviews.length+1}`,start,end,createdAt:end,kpis});
      if(state.management.reviews.length>52) state.management.reviews.splice(0,state.management.reviews.length-52);
      state.management.cycleStart=end;
      changed=true; guard++;
    }
    return changed;
  }

  function flightReadiness({flight,aircraft,now,staffingShortages=[],fuelPlan=null,openIncidents=[]}){
    const departure=flight.actualDeparture??flight.departure;
    const maintenance=aircraft?maintenanceStatus(aircraft,now):null;
    const weather=weatherAt(flight.from,departure);
    const gates=[];
    const add=(key,label,status,detail)=>gates.push({key,label,status,detail});
    const aircraftBlocked=!aircraft||flight.cancelled||
      (aircraft.defectUntil&&aircraft.defectUntil>departure)||maintenance?.active||maintenance?.grounding||
      (departure>now&&aircraft.location!==flight.from);
    add('aircraft','Aircraft availability',aircraftBlocked?'block':maintenance?.due?'warn':'ready',
      !aircraft?'Not assigned':flight.cancelled?'Flight cancelled':maintenance?.active?'Scheduled maintenance in progress':maintenance?.grounding?'Mandatory check overdue':aircraft.defectUntil>departure?'Technical defect unresolved':aircraft.location!==flight.from?`Aircraft currently at ${aircraft.location}`:maintenance?.due?'Maintenance due soon':'Available');
    add('crew','Crew availability',staffingShortages.length?'block':'ready',staffingShortages.length?staffingShortages.join(' · '):'Qualified crew and ground team available');
    const fuelReady=flight.fueled||now<flight.departure-60*MIN;
    add('fuel','Fuel status',fuelReady?'ready':'warn',flight.fueled?`${Math.round(flight.fuelOnboardAtDeparture||0)} US gal onboard`:now<flight.departure-60*MIN?'Automatic fueling opens 60 minutes before departure':`Top-up required${fuelPlan?` · ${Math.round(fuelPlan.requiredGal)} US gal target`:''}`);
    add('slot','Departure slot',flight.slotMissed?'warn':'ready',flight.slotMissed?'Original slot missed; recovery slot assigned':'Planned slot protected');
    add('weather','Departure weather',weather.level==='severe'?'block':weather.level==='caution'?'warn':'ready',`${weather.conditions} · wind ${weather.windKph} km/h`);
    add('rotation','Inbound rotation',flight.propagatedDelayMin?'warn':'ready',flight.propagatedDelayMin?`Inbound rotation adds ${flight.propagatedDelayMin} minutes`:'Aircraft rotation connected');
    add('incident','Open incidents',openIncidents.some(incident=>incident.blocking)?'block':openIncidents.length?'warn':'ready',
      openIncidents.length?openIncidents.map(incident=>incident.title||incident.type).join(' · '):'No unresolved operational incidents');
    const score={ready:0,warn:1,block:2};
    const overall=gates.reduce((worst,gate)=>score[gate.status]>score[worst]?gate.status:worst,'ready');
    return {overall,gates,weather,maintenance};
  }

  function cancellationPlan(flight,distanceKm,now){
    const hoursBefore=(flight.departure-now)/HOUR;
    const passengerCare=hoursBefore>24?25:distanceKm>=3500?400:distanceKm>=1500?250:150;
    const reaccommodation=Math.round((Number(flight.pax)||0)*passengerCare);
    const handling=Math.round((2_000+(Number(flight.pax)||0)*12)/500)*500;
    return {reaccommodation,handling,total:reaccommodation+handling,hoursBefore};
  }

  function buildRoutePortfolio({state,now,days=30,projectService,monthlyPayroll=0}){
    const rows=[];
    for(const service of (state.services||[]).filter(item=>item.active)){
      const legs=projectService(service,now,now+days*DAY)||[];
      if(!legs.length) continue;
      const row={
        serviceId:service.id,route:`${service.from} ↔ ${service.to}`,aircraftId:service.aircraftId,
        flights:legs.length,revenue:0,directCosts:0,passengers:0,seats:0,blockHours:0
      };
      for(const leg of legs){
        row.revenue+=Number(leg.revenue)||0; row.directCosts+=Number(leg.cost)||0;
        row.passengers+=Number(leg.pax)||0; row.seats+=Number(leg.seats)||0;
        row.blockHours+=Number(leg.blockHours)||0;
      }
      row.directContribution=row.revenue-row.directCosts;
      rows.push(row);
    }
    const totalBlockHours=rows.reduce((sum,row)=>sum+row.blockHours,0);
    const leaseByAircraft=new Map();
    for(const aircraft of state.aircraft||[]){
      if(aircraft.acquisitionType==='lease') leaseByAircraft.set(aircraft.id,(Number(aircraft.leaseMonthlyFee)||0)*(days/30));
    }
    for(const row of rows){
      const share=totalBlockHours?row.blockHours/totalBlockHours:0;
      const aircraftHours=rows.filter(item=>item.aircraftId===row.aircraftId).reduce((sum,item)=>sum+item.blockHours,0);
      row.allocatedPayroll=monthlyPayroll*(days/30)*share;
      row.allocatedLease=(leaseByAircraft.get(row.aircraftId)||0)*(aircraftHours?row.blockHours/aircraftHours:0);
      row.contribution=row.directContribution-row.allocatedPayroll-row.allocatedLease;
      row.margin=row.revenue?row.contribution/row.revenue:0;
      row.loadFactor=row.seats?row.passengers/row.seats:0;
    }
    return rows.sort((a,b)=>b.contribution-a.contribution);
  }

  return {
    MIN,HOUR,DAY,WEEK,CHECK_INTERVAL_HOURS,CHECK_INTERVAL_CYCLES,
    aircraftFamily,ensureState,weatherAt,maintenanceStatus,maintenancePlan,processMaintenance,
    cyclePhase,operationalKpis,processWeeklyReviews,flightReadiness,cancellationPlan,buildRoutePortfolio
  };
})();
