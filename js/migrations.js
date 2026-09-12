/* Runtime save repairs and cleanup for retired simulation concepts. */

function retireTrackedProblems(t=simNow()){
  let changed=false;
  for(const problem of state.problems.filter(item=>AeroProblemModel.isRetiredType(item.type)&&item.status==='open')){
    problem.status='resolved';
    problem.blocking=false;
    problem.resolvedAt=t;
    problem.automaticResolution=true;
    problem.outcome=AeroProblemModel.retiredOutcomeForType(problem.type);
    if(typeof traceProblemTransition==='function') traceProblemTransition(problem,'auto_closed',{reason:'retired_problem'});
    changed=true;
  }
  return changed;
}

function duplicateProblemProgressScore(problem){
  return (problem.firstVisibleAt?20:0)+(problem.lastDetectedAt||problem.detectedAt||0)/1e13;
}

function repairDuplicateOpenProblems(t=simNow()){
  const groups=new Map();
  for(const problem of state.problems||[]){
    if(problem.status!=='open'||!problem.type) continue;
    if(typeof ensureProblemIdentityFields==='function') ensureProblemIdentityFields(problem,null,problem.context,t);
    const scope=problem.scope||null;
    const key=scope?.kind&&scope.subjectId
      ? `${scope.kind}:${problem.type}:${scope.subjectId}`
      : problem.dedupeKey||`${problem.flightId||problem.aircraftId||problem.airport||problem.id}:${problem.type}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(problem);
  }
  let changed=false;
  for(const problems of groups.values()){
    if(problems.length<2) continue;
    const keeper=problems.slice().sort((a,b)=>duplicateProblemProgressScore(b)-duplicateProblemProgressScore(a))[0];
    for(const duplicate of problems){
      if(duplicate.id===keeper.id) continue;
      if((duplicate.lastDetectedAt||duplicate.detectedAt||0)>(keeper.lastDetectedAt||keeper.detectedAt||0)){
        keeper.lastDetectedAt=duplicate.lastDetectedAt||duplicate.detectedAt;
        if(duplicate.context) keeper.context=duplicate.context;
      }
      if(typeof problemAffectedFlightIds==='function'){
        keeper.affectedFlightIds=[...new Set([...problemAffectedFlightIds(keeper),...problemAffectedFlightIds(duplicate)])];
      }
      duplicate.status='resolved';
      duplicate.blocking=false;
      duplicate.resolvedAt=t;
      duplicate.automaticResolution=true;
      duplicate.outcome=`Merged into existing ${keeper.id} ${AeroProblemModel.titleForType(keeper.type)} case for the same operational subject.`;
      if(typeof traceProblemTransition==='function') traceProblemTransition(duplicate,'auto_closed',{reason:'duplicate_case_merged',mergedInto:keeper.id});
      changed=true;
    }
  }
  return changed;
}
