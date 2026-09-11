/* Runtime task materialization from the central problem model. */
(function(global){
  'use strict';

  const IncidentModel=global.AeroProblemModel||global.AeroIncidentModel;
  if(!IncidentModel) throw new Error('AeroProblemModel must load before AeroOperationalWorkflows.');

  const DEPARTMENTS=IncidentModel.DEPARTMENTS;
  const KIND_META=IncidentModel.KIND_META;
  const WORKFLOWS=IncidentModel.workflowDefinitions();

  function taskId(problemId,key,targetId=''){
    return global.AeroProblems?.createProblemTaskId
      ? global.AeroProblems.createProblemTaskId(problemId,key,targetId)
      : [problemId,key,targetId].filter(Boolean).join(':');
  }

  function tasksForProblem(problem){
    const workflow=WORKFLOWS[problem.type];
    if(!workflow) return [];
    return workflow.steps.map(step=>{
      const meta=IncidentModel.metadataForStep(step);
      const task={
        id:taskId(problem.id,step.key),
        problemId:problem.id,
        flightId:problem.flightId,
        aircraftId:problem.aircraftId,
        target:{kind:'flight',id:problem.flightId||''},
        department:step.department,
        kind:step.kind,
        key:step.key,
        label:step.label,
        detail:step.detail,
        dependsOn:(step.dependsOn||[]).map(key=>taskId(problem.id,key)),
        branch:step.branch||'',
        strategies:step.strategies||null,
        action:step.action||'',
        strategyOptions:step.options||null,
        eligibility:meta.eligibility,
        resources:meta.resources,
        automatic:Boolean(step.automatic),
        required:!step.optional,
        status:step.dependsOn?.length?'blocked':'available',
        createdAt:problem.detectedAt,
        startedAt:0,
        completesAt:0,
        completedAt:0,
        selection:null,
        outcome:''
      };
      return global.AeroProblems?.normalizeProblemTask?.(task)||task;
    });
  }

  function tasksForIncident(incident){
    return tasksForProblem(incident);
  }

  function progress(task,now){
    if(task.status==='completed') return 1;
    if(!['in_progress','waiting_external'].includes(task.status)||!task.startedAt||!task.completesAt) return 0;
    return Math.max(0,Math.min(1,(now-task.startedAt)/(task.completesAt-task.startedAt)));
  }

  const ProblemTasks={
    DEPARTMENTS,
    WORKFLOWS,
    taskId,
    tasksForProblem,
    tasksForIncident,
    progress,
    KIND_META
  };
  global.AeroProblemTasks=ProblemTasks;
  global.AeroOperationalWorkflows=ProblemTasks;
})(typeof window!=='undefined'?window:globalThis);
