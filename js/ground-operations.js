/* Timestamp-derived aircraft ground-operation task models. */

window.AeroGroundOperations = (() => {
  'use strict';

  const MINUTE = 60_000;

  const TASKS = {
    preflight: [
      {id:'dispatch',label:'Dispatch release',start:0,end:.28},
      {id:'walkaround',label:'Aircraft walkaround',start:0,end:.38},
      {id:'cabin',label:'Cabin preparation',start:0,end:.48},
      {id:'fuel',label:'Fueling',start:.08,end:.62},
      {id:'baggage-load',label:'Baggage loading',start:.12,end:.72},
      {id:'boarding',label:'Boarding',start:.45,end:.88,after:['cabin']},
      {id:'load-closeout',label:'Load closeout',start:.84,end:.96,after:['baggage-load','boarding']},
      {id:'pushback',label:'Pushback clearance',start:.94,end:1,after:['dispatch','fuel','load-closeout']}
    ],
    turnaround: [
      {id:'deboarding',label:'Deboarding',start:0,end:.28},
      {id:'baggage-unload',label:'Baggage unloading',start:0,end:.34},
      {id:'cleaning',label:'Cabin cleaning',start:.20,end:.55,after:['deboarding']},
      {id:'catering',label:'Catering',start:.20,end:.56},
      {id:'fuel',label:'Fueling',start:.25,end:.65},
      {id:'baggage-load',label:'Baggage loading',start:.38,end:.76,after:['baggage-unload']},
      {id:'boarding',label:'Boarding',start:.55,end:.90,after:['cleaning']},
      {id:'load-closeout',label:'Load closeout',start:.86,end:.97,after:['baggage-load','boarding']},
      {id:'pushback',label:'Pushback clearance',start:.96,end:1,after:['catering','fuel','load-closeout']}
    ],
    postflight: [
      {id:'deboarding',label:'Deboarding',start:0,end:.42},
      {id:'baggage-unload',label:'Baggage unloading',start:0,end:.52},
      {id:'walkaround',label:'Post-flight inspection',start:.08,end:.65},
      {id:'cabin-reset',label:'Cabin secure & reset',start:.38,end:.78,after:['deboarding']},
      {id:'handover',label:'Technical handover',start:.62,end:1,after:['walkaround','cabin-reset']}
    ],
    ferryPreflight: [
      {id:'dispatch',label:'Dispatch release',start:0,end:.35},
      {id:'walkaround',label:'Aircraft walkaround',start:0,end:.48},
      {id:'fuel',label:'Fueling',start:.12,end:.68},
      {id:'load-closeout',label:'Load closeout',start:.62,end:.90,after:['walkaround']},
      {id:'pushback',label:'Pushback clearance',start:.88,end:1,after:['dispatch','fuel','load-closeout']}
    ],
    ferryPostflight: [
      {id:'walkaround',label:'Post-flight inspection',start:0,end:.62},
      {id:'cabin-reset',label:'Aircraft secure',start:.18,end:.72},
      {id:'handover',label:'Technical handover',start:.62,end:1,after:['walkaround','cabin-reset']}
    ]
  };

  function clamp(value,min=0,max=1){ return Math.max(min,Math.min(max,value)); }

  function stableIndex(seed,length){
    let hash=2166136261;
    for(const char of String(seed)){
      hash^=char.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    }
    return length ? (hash>>>0)%length : -1;
  }

  function taskState(progress){
    return progress>=1?'complete':progress>0?'active':'waiting';
  }

  function materializeTasks(definitions,startAt,endAt,now,{delayTaskId=''}={}){
    const duration=Math.max(MINUTE,endAt-startAt);
    const built=new Map();
    const tasks=definitions.map(definition=>{
      const dependencies=(definition.after||[]).map(id=>built.get(id)).filter(Boolean);
      const dependencyEnd=dependencies.reduce((latest,task)=>Math.max(latest,task.endAt),startAt);
      const rawStart=startAt+definition.start*duration;
      const start=Math.max(rawStart,dependencyEnd);
      const rawEnd=startAt+definition.end*duration;
      const end=Math.max(start+MINUTE,Math.min(endAt,rawEnd));
      const progress=clamp((now-start)/Math.max(MINUTE,end-start));
      const task={
        id:definition.id,label:definition.label,startAt:start,endAt:end,progress,
        status:taskState(progress),delayed:definition.id===delayTaskId,
        dependencies:(definition.after||[]).slice()
      };
      built.set(task.id,task);
      return task;
    });
    return tasks;
  }

  function phaseModel({key,label,kind,airport,startAt,endAt,now,definitions,delayTaskId='',readyAt=endAt}){
    const tasks=materializeTasks(definitions,startAt,endAt,now,{delayTaskId});
    const progress=tasks.length?tasks.reduce((total,task)=>total+task.progress,0)/tasks.length:1;
    const status=now<startAt?'waiting':progress>=1?'complete':'active';
    return {key,label,kind,airport,startAt,endAt,readyAt,tasks,progress,status};
  }

  function departurePhase({flight,previousFlight=null,previousArrival=null,minimumTurnMin=40,now=Date.now()}){
    const previousDestination=previousFlight&&(previousFlight.operationalDestination||previousFlight.to);
    const connected=Boolean(previousFlight&&previousDestination===flight.from&&Number.isFinite(previousArrival));
    const handlingDelayMin=Math.max(0,Number(flight.handlingDelayMin)||0);
    const nominalStart=connected
      ? Math.max(previousArrival,flight.departure-minimumTurnMin*MINUTE)
      : flight.departure-minimumTurnMin*MINUTE;
    const inboundReady=connected?previousArrival+minimumTurnMin*MINUTE:flight.departure;
    const readyAt=Math.max(flight.departure+handlingDelayMin*MINUTE,inboundReady);
    const ferry=flight.flightType==='ferry';
    const kind=connected?'turnaround':'preflight';
    const definitions=ferry?TASKS.ferryPreflight:TASKS[kind];
    const delayCandidates=definitions.filter(task=>['cleaning','catering','fuel','baggage-load','boarding','walkaround'].includes(task.id));
    const delayTask=handlingDelayMin?delayCandidates[stableIndex(flight.id,delayCandidates.length)]:null;
    return phaseModel({
      key:'departure',kind,airport:flight.from,startAt:nominalStart,endAt:readyAt,readyAt,now,definitions,
      delayTaskId:delayTask?.id||'',
      label:connected?'Turnaround departure preparation':'First-flight departure preparation'
    });
  }

  function postflightMinutes(aircraft){
    const segment=String(aircraft?.segment||aircraft?.modelSegment||'');
    if(segment.includes('widebody')) return 50;
    if(segment.includes('Regional')||segment.includes('turboprop')) return 28;
    return 35;
  }

  function postflightPhase({flight,aircraft=null,actualArrival,now=Date.now()}){
    const startAt=actualArrival;
    const endAt=startAt+postflightMinutes(aircraft)*MINUTE;
    const ferry=flight.flightType==='ferry';
    return phaseModel({
      key:'postflight',kind:'postflight',airport:flight.diversionAirport||flight.to,
      startAt,endAt,readyAt:endAt,now,
      definitions:ferry?TASKS.ferryPostflight:TASKS.postflight,
      label:'Post-arrival servicing'
    });
  }

  return {departurePhase,postflightPhase,postflightMinutes};
})();
