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
  const MAINTENANCE_WORK_LABELS = {
    scheduled_check:'Scheduled maintenance check',
    mel_rectification:'MEL rectification',
    urgent_repair:'Technical repair',
    arrival_inspection:'Arrival inspection'
  };

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
    if(/^Saab 340/.test(modelName)) return 'Saab 340';
    if(/^Dornier 328/.test(modelName)) return 'Dornier 328';
    if(/^ATR/.test(modelName)) return 'ATR';
    if(/^DHC-8|^Dash 8/.test(modelName)) return 'Dash 8';
    if(/^E\d/.test(modelName)) return 'Embraer E-Jet';
    if(/^CRJ/.test(modelName)) return 'CRJ';
    if(/^A220/.test(modelName)) return 'Airbus A220';
    if(/^A31|^A32/.test(modelName)) return 'Airbus A320 family';
    if(/^A330/.test(modelName)) return 'Airbus A330';
    if(/^A350/.test(modelName)) return 'Airbus A350';
    if(/^A380/.test(modelName)) return 'Airbus A380';
    if(/^737/.test(modelName)) return 'Boeing 737';
    if(/^747/.test(modelName)) return 'Boeing 747';
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
    const profile=AIRPORT_WEATHER[airportCode]||{wind:16};
    const period=Math.floor(timestamp/(6*HOUR));
    const windRoll=stableUnit(`${airportCode}:${period}:wind`);
    const windKph=Math.round(profile.wind*(.75+windRoll*.55));
    const validFrom=period*6*HOUR,validUntil=(period+1)*6*HOUR;
    return {
      airport:airportCode,level:'normal',label:'Normal',type:'clear',icon:'CLR',
      windKph,windDirection:Math.round(stableUnit(`${airportCode}:${period}:direction`)*36)*10%360,gustKph:windKph+4,
      delayMin:0,capacityFactor:1,conditions:'Normal operations',visibilityKm:24,ceilingFt:9000,
      weatherSystemId:'',nearbyCell:null,impactRadiusKm:0,
      forecastAt:validFrom,validFrom,validUntil,
      forecastDurationMin:Math.round((validUntil-validFrom)/MIN),
      forecastRemainingMin:Math.round((validUntil-validFrom)/MIN)
    };
  }

  function maintenanceStatus(aircraft,now){
    const maintenance=ensureAircraftMaintenance(aircraft);
    const hoursSince=Math.max(0,(Number(aircraft.flightHours)||0)-maintenance.lastCheckHours);
    const cyclesSince=Math.max(0,(Number(aircraft.cycles)||0)-maintenance.lastCheckCycles);
    const progress=Math.max(hoursSince/CHECK_INTERVAL_HOURS,cyclesSince/CHECK_INTERVAL_CYCLES);
    const scheduled=maintenance.scheduled;
    const active=scheduled?.status==='active';
    const due=progress>=1;
    const grounding=progress>=1.15;
    return {
      hoursSince,cyclesSince,progress,due,grounding,active,scheduled,
      remainingHours:Math.max(0,CHECK_INTERVAL_HOURS-hoursSince),
      remainingCycles:Math.max(0,CHECK_INTERVAL_CYCLES-cyclesSince),
      label:active?(scheduled?.label||'In maintenance'):grounding?'Grounded — overdue':due?'Maintenance due':scheduled?(scheduled.label||'Check scheduled'):'Serviceable'
    };
  }

  function maintenanceWorkType(type){
    return MAINTENANCE_WORK_LABELS[type]?type:'scheduled_check';
  }

  function roundHalfHour(hours){
    return Math.max(.5,Math.round(hours*2)/2);
  }

  function maintenanceFindingCategory(options={}){
    const items=Array.isArray(options.melItems)&&options.melItems.length
      ? options.melItems
      : options.finding?[options.finding]:[];
    const order={A:4,B:3,C:2,D:1};
    return items
      .map(item=>String(item.category||'C').toUpperCase())
      .sort((a,b)=>(order[b]||0)-(order[a]||0))[0]||'C';
  }

  function maintenanceWorkProfile(type,aircraft,seats,status,options={}){
    const workType=maintenanceWorkType(type);
    const category=maintenanceFindingCategory(options);
    const widebody=seats>=240;
    const extraItems=Math.max(0,((Array.isArray(options.melItems)?options.melItems.length:0)-1)*.75);
    const categoryWeight={A:1.25,B:1,C:.75,D:.45}[category]||.75;
    if(workType==='mel_rectification'){
      const base={A:3.5,B:3,C:2.5,D:1.5}[category]||2.5;
      const durationHours=roundHalfHour(Math.min(6,base+extraItems+(widebody ? .75 : 0)));
      return {
        workType,label:MAINTENANCE_WORK_LABELS[workType],durationHours,
        cost:Math.round((4_500+seats*32+categoryWeight*2_500+extraItems*900)/250)*250,
        conditionGain:4,resetsCheck:false,transaction:'MEL rectification'
      };
    }
    if(workType==='urgent_repair'){
      const base={A:5.5,B:4.5,C:3.5,D:2.5}[category]||4;
      const durationHours=roundHalfHour(Math.min(9,base+(widebody?1:0)));
      return {
        workType,label:MAINTENANCE_WORK_LABELS[workType],durationHours,
        cost:Math.round((9_000+seats*62+categoryWeight*4_000)/500)*500,
        conditionGain:8,resetsCheck:false,transaction:'Technical repair'
      };
    }
    if(workType==='arrival_inspection'){
      const durationHours=roundHalfHour(widebody?1.5:1);
      return {
        workType,label:MAINTENANCE_WORK_LABELS[workType],durationHours,
        cost:Math.round((1_800+seats*12)/250)*250,
        conditionGain:2,resetsCheck:false,transaction:'Arrival inspection'
      };
    }
    const overdueFactor=status.due?1.18:1;
    const durationHours=roundHalfHour(6+seats/65);
    return {
      workType:'scheduled_check',label:MAINTENANCE_WORK_LABELS.scheduled_check,durationHours,
      cost:Math.round((18_000+seats*240)*overdueFactor/500)*500,
      conditionGain:18,resetsCheck:true,transaction:'Scheduled maintenance'
    };
  }

  function maintenancePlan(aircraft,start,airport,seats=100,options={}){
    const status=maintenanceStatus(aircraft,start);
    const profile=maintenanceWorkProfile(options.workType,aircraft,seats,status,options);
    const inspection=['arrival_inspection','scheduled_check'].includes(profile.workType);
    const repairsDefect=['urgent_repair','scheduled_check'].includes(profile.workType);
    const melItems=profile.workType==='scheduled_check'?(aircraft.melItems||[]):profile.workType==='mel_rectification'?(options.melItems||[]):[];
    return {
      start,end:start+profile.durationHours*HOUR,airport,
      durationHours:profile.durationHours,cost:profile.cost,status:'scheduled',
      workType:profile.workType,label:profile.label,
      coverage:{
        melIds:melItems.filter(item=>['open','expired'].includes(item.status)).map(item=>item.id),
        defect:repairsDefect&&aircraft.defectUntil?{until:aircraft.defectUntil,reason:aircraft.defectReason||''}:null,
        inspection:inspection&&Boolean(aircraft.arrivalInspectionRequired),
        inspectionVersion:aircraft.arrivalInspectionVersion||0
      },
      resetsCheck:profile.resetsCheck,conditionGain:profile.conditionGain,transaction:profile.transaction
    };
  }

  function completeMaintenanceFindings(state,aircraft,job){
    const coverage=job.coverage||{};
    const coveredMel=new Set(coverage.melIds||[]);
    for(const item of aircraft.melItems||[]){
      if(coveredMel.has(item.id)&&['open','expired'].includes(item.status)){
        item.status='cleared';item.clearedAt=job.end;
      }
    }
    if(coverage.defect&&aircraft.defectUntil===coverage.defect.until&&(aircraft.defectReason||'')===coverage.defect.reason){
      aircraft.defectUntil=0;
      aircraft.defectReason='';
    }
    if(coverage.inspection&&(aircraft.arrivalInspectionVersion||0)===coverage.inspectionVersion){
      aircraft.arrivalInspectionRequired=false;
    }
    const inspectedFlights=new Map((job.inspectionFlights||[]).map(item=>[item.id,item.version]));
    for(const flight of state.flights||[]){
      if(inspectedFlights.get(flight.id)===(flight.arrivalInspectionVersion||0)) flight.arrivalInspectionRequired=false;
    }
  }

  function processMaintenance(state,now,postTransaction,availabilityForAircraft){
    let changed=false;
    for(const aircraft of state.aircraft||[]){
      const maintenance=ensureAircraftMaintenance(aircraft);
      const job=maintenance.scheduled;
      if(!job) continue;
      if(now>=job.start&&['scheduled','waiting','active'].includes(job.status)){
        const availability=availabilityForAircraft(aircraft,job,now);
        if(!availability.available){
          const nextStart=Math.max(job.start,Number(availability.availableAt)||job.start);
          if(job.status!=='waiting'||job.waitingReason!==availability.reason||job.start!==nextStart) changed=true;
          job.status='waiting';
          job.waitingReason=availability.reason;
          job.start=nextStart;
          job.end=nextStart+job.durationHours*HOUR;
          continue;
        }
        if(job.status!=='active'){
          job.startedAt=Math.max(job.start,Number(availability.availableAt)||now);
          job.start=job.startedAt;
          job.end=job.startedAt+job.durationHours*HOUR;
          job.waitingReason='';
          job.status='active';
          changed=true;
        }
      }
      if(now>=job.end&&job.status==='active'){
        const workType=maintenanceWorkType(job.workType);
        job.status='completed';
        if(job.resetsCheck!==false&&workType==='scheduled_check'){
          maintenance.lastCheckHours=Number(aircraft.flightHours)||0;
          maintenance.lastCheckCycles=Number(aircraft.cycles)||0;
        }
        maintenance.lastCompletedAt=job.end;
        aircraft.condition=clamp((Number(aircraft.condition)||0)+(Number(job.conditionGain)||2),0,100);
        completeMaintenanceFindings(state,aircraft,job);
        state.stats.scheduledMaintenanceCosts+=(Number(job.cost)||0);
        if(job.cost) postTransaction(-job.cost,job.transaction||MAINTENANCE_WORK_LABELS[workType],`${aircraft.tail} ${String(job.label||MAINTENANCE_WORK_LABELS[workType]).toLowerCase()}`,aircraft.id);
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
    const completed=[
      ...(state.flights||[]).filter(f=>f.settled&&(f.actualArrival??f.arrival)>=start&&(f.actualArrival??f.arrival)<end),
      ...(state.flightHistory||[]).filter(f=>f.settled&&(f.actualArrival??f.arrival)>=start&&(f.actualArrival??f.arrival)<end)
    ];
    const cancelled=[
      ...(state.flights||[]).filter(f=>f.cancelled&&f.cancelledAt>=start&&f.cancelledAt<end),
      ...(state.flightHistory||[]).filter(f=>f.cancelled&&f.cancelledAt>=start&&f.cancelledAt<end)
    ];
    const operated=completed.length;
    const total=operated+cancelled.length;
    const onTime=completed.filter(f=>((f.actualArrival??f.arrival)-f.arrival)<=15*MIN).length;
    const arrivalDelay=completed.reduce((sum,f)=>sum+Math.max(0,((f.actualArrival??f.arrival)-f.arrival)/MIN),0);
    const pax=completed.reduce((sum,f)=>sum+(Number(f.pax)||0),0);
    const seats=completed.reduce((sum,f)=>sum+(Number(f.seats)||0||(f.load?Math.round((Number(f.pax)||0)/f.load):Number(f.pax)||0)),0);
    const revenue=completed.reduce((sum,f)=>sum+(Number(f.revenue)||0),0);
    const directCosts=completed.reduce((sum,f)=>sum+(Number(f.costs)||0),0);
    const blockHours=completed.reduce((sum,f)=>sum+(Number(f.blockHours)||Math.max(0,(f.arrival-f.departure)/HOUR)),0);
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

  function flightReadiness({flight,aircraft,now,staffingShortages=[],fuelPlan=null,openProblems=[]}){
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
    add('problem','Open problems',openProblems.some(problem=>problem.blocking)?'block':openProblems.length?'warn':'ready',
      openProblems.length?openProblems.map(problem=>problem.title||problem.type).join(' · '):'No unresolved operational problems');
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
    MIN,HOUR,DAY,WEEK,CHECK_INTERVAL_HOURS,CHECK_INTERVAL_CYCLES,MAINTENANCE_WORK_LABELS,
    aircraftFamily,ensureState,weatherAt,maintenanceStatus,maintenancePlan,processMaintenance,
    cyclePhase,operationalKpis,processWeeklyReviews,flightReadiness,cancellationPlan,buildRoutePortfolio
  };
})();
