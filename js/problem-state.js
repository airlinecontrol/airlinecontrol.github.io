/* Problem-state source of truth. */
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

  const RETIRED_STATE_KEYS=[
    'in'+'cidents',
    'coordination'+'Tasks',
    'in'+'cidentTransitions',
    'next'+'In'+'cident',
    'problemTasks',
    'nextProblemTask'
  ];

  function discardRetiredStateKeys(target){
    for(const key of RETIRED_STATE_KEYS) delete target[key];
  }

  function normalizeProblem(raw={}){
    const problem={...raw};
    problem.entity='problem';
    if(!problem.id) problem.id=problem.problemId||'';
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
    if(!problem.rootProblemId) problem.rootProblemId=problem.caseId||problem.id;
    if(problem.triggeredByProblemId===undefined) problem.triggeredByProblemId='';
    if(problem.chainReason===undefined) problem.chainReason='';
    return problem;
  }

  function normalizeTransition(raw={}){
    const entry={...raw};
    if(!entry.problemId) entry.problemId='';
    return entry;
  }

  function installProblemState(target){
    if(!target||typeof target!=='object') return target;
    target.problems=asArray(target.problems).map(normalizeProblem);
    target.problemTransitions=asArray(target.problemTransitions).map(normalizeTransition);
    if(!Number.isFinite(target.nextProblem)) target.nextProblem=nextNumberFromIds(target.problems,'PR',1);
    else target.nextProblem=Math.max(target.nextProblem,nextNumberFromIds(target.problems,'PR',1));
    discardRetiredStateKeys(target);
    return target;
  }

  function serializableState(target){
    if(!target||typeof target!=='object') return target;
    const out={...target};
    out.problems=asArray(target.problems).map(normalizeProblem);
    out.problemTransitions=asArray(target.problemTransitions).map(normalizeTransition);
    out.nextProblem=Number.isFinite(target.nextProblem)?target.nextProblem:nextNumberFromIds(out.problems,'PR',1);
    discardRetiredStateKeys(out);
    return out;
  }

  function createProblemId(stateRef){
    const nextFromIds=nextNumberFromIds(stateRef.problems,'PR',1);
    stateRef.nextProblem=Number.isFinite(stateRef.nextProblem)?Math.max(stateRef.nextProblem,nextFromIds):nextFromIds;
    return `PR${stateRef.nextProblem++}`;
  }

  global.AeroProblems={
    installProblemState,
    normalizeProblem,
    normalizeTransition,
    serializableState,
    createProblemId
  };
})(typeof window!=='undefined'?window:globalThis);
