/* Problem-state source of truth with temporary legacy API aliases for the UI/runtime. */
(function(global){
  'use strict';

  function asArray(value){
    return Array.isArray(value)?value:[];
  }

  function nextNumberFromIds(items,prefix,fallback=1){
    const max=asArray(items).reduce((largest,item)=>{
      const match=String(item?.id||'').match(new RegExp(`^${prefix}(\\d+)$`));
      return match?Math.max(largest,Number(match[1])||0):largest;
    },0);
    return Math.max(fallback,max+1);
  }

  function defineAlias(target,legacy,modern){
    const legacyValue=target[legacy];
    if(target[modern]===undefined&&legacyValue!==undefined) target[modern]=legacyValue;
    delete target[legacy];
    Object.defineProperty(target,legacy,{
      get(){ return this[modern]; },
      set(value){ this[modern]=value; },
      enumerable:false,
      configurable:true
    });
  }

  function defineArrayAlias(target,legacy,modern,normalizer){
    delete target[legacy];
    Object.defineProperty(target,legacy,{
      get(){ return this[modern]; },
      set(value){ this[modern]=asArray(value).map(normalizer); },
      enumerable:false,
      configurable:true
    });
  }

  function normalizeProblem(raw={}){
    const problem={...raw};
    problem.entity='problem';
    if(!problem.id) problem.id=problem.problemId||problem.incidentId||'';
    problem.problemId=problem.id;
    if(!problem.status) problem.status=problem.resolvedAt?'resolved':'open';
    if(!Array.isArray(problem.affectedFlightIds)){
      problem.affectedFlightIds=problem.flightId?[problem.flightId]:[];
    }
    if(!problem.scope||!problem.scope.kind){
      problem.scope=problem.aircraftId
        ? {kind:'aircraft',subjectId:problem.aircraftId}
        : {kind:'flight',subjectId:problem.flightId||problem.id||''};
    }
    if(!problem.caseId) problem.caseId=problem.id;
    if(!problem.rootProblemId) problem.rootProblemId=problem.rootIncidentId||problem.caseId||problem.id;
    if(problem.triggeredByProblemId===undefined) problem.triggeredByProblemId=problem.triggeredByIncidentId||'';
    defineAlias(problem,'incidentId','problemId');
    defineAlias(problem,'rootIncidentId','rootProblemId');
    defineAlias(problem,'triggeredByIncidentId','triggeredByProblemId');
    return problem;
  }

  function normalizeProblemTask(raw={}){
    const task={...raw};
    task.entity='problemTask';
    if(!task.id) task.id=task.taskId||'';
    if(!task.problemId) task.problemId=task.incidentId||'';
    if(!task.target){
      task.target=task.flightId
        ? {kind:'flight',id:task.flightId}
        : task.aircraftId
          ? {kind:'aircraft',id:task.aircraftId}
          : {kind:'problem',id:task.problemId};
    }
    defineAlias(task,'incidentId','problemId');
    return task;
  }

  function normalizeTransition(raw={}){
    const entry={...raw};
    if(!entry.problemId) entry.problemId=entry.incidentId||'';
    defineAlias(entry,'incidentId','problemId');
    return entry;
  }

  function installStateAliases(target){
    if(!target||typeof target!=='object') return target;
    const sourceProblems=Array.isArray(target.problems)?target.problems:asArray(target.incidents);
    const sourceTasks=Array.isArray(target.problemTasks)?target.problemTasks:asArray(target.coordinationTasks);
    const sourceTransitions=Array.isArray(target.problemTransitions)?target.problemTransitions:asArray(target.incidentTransitions);
    target.problems=sourceProblems.map(normalizeProblem);
    target.problemTasks=sourceTasks.map(normalizeProblemTask);
    target.problemTransitions=sourceTransitions.map(normalizeTransition);
    if(!Number.isFinite(target.nextProblem)){
      const fallback=Number.isFinite(target.nextIncident)?target.nextIncident:nextNumberFromIds(target.problems,'PR',1);
      target.nextProblem=Math.max(fallback,nextNumberFromIds(target.problems,'PR',1));
    }
    if(!Number.isFinite(target.nextProblemTask)) target.nextProblemTask=nextNumberFromIds(target.problemTasks,'PT',1);
    defineArrayAlias(target,'incidents','problems',normalizeProblem);
    defineArrayAlias(target,'coordinationTasks','problemTasks',normalizeProblemTask);
    defineArrayAlias(target,'incidentTransitions','problemTransitions',normalizeTransition);
    defineAlias(target,'nextIncident','nextProblem');
    return target;
  }

  function serializeTask(task){
    const out={...task};
    delete out.incidentId;
    return out;
  }

  function serializeTransition(entry){
    const out={...entry};
    delete out.incidentId;
    return out;
  }

  function serializeProblem(problem){
    const out={...problem};
    delete out.incidentId;
    delete out.rootIncidentId;
    delete out.triggeredByIncidentId;
    return out;
  }

  function serializableState(target){
    if(!target||typeof target!=='object') return target;
    const out={...target};
    out.problems=asArray(target.problems).map(problem=>serializeProblem(normalizeProblem(problem)));
    out.problemTasks=asArray(target.problemTasks).map(task=>serializeTask(normalizeProblemTask(task)));
    out.problemTransitions=asArray(target.problemTransitions).map(entry=>serializeTransition(normalizeTransition(entry)));
    delete out.incidents;
    delete out.coordinationTasks;
    delete out.incidentTransitions;
    delete out.nextIncident;
    return out;
  }

  function createProblemId(stateRef){
    const nextFromIds=nextNumberFromIds(stateRef.problems,'PR',1);
    stateRef.nextProblem=Number.isFinite(stateRef.nextProblem)?Math.max(stateRef.nextProblem,nextFromIds):nextFromIds;
    return `PR${stateRef.nextProblem++}`;
  }

  function createProblemTaskId(problemId,key,targetId=''){
    return [problemId,key,targetId].filter(Boolean).join(':');
  }

  global.AeroProblems={
    installStateAliases,
    normalizeProblem,
    normalizeProblemTask,
    normalizeTransition,
    serializableState,
    createProblemId,
    createProblemTaskId
  };
})(typeof window!=='undefined'?window:globalThis);
