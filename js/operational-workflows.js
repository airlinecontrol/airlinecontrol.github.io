/* Pure workflow definitions for persistent OCC case coordination. */
(function(global){
  const DEPARTMENTS={
    dispatch:{label:'Dispatch & Flight Watch',widget:'dispatch-control'},
    crew:{label:'Crew Control',widget:'crew-control'},
    maintenance:{label:'Maintenance Control',widget:'maintenance-control'},
    station:{label:'Station Operations',widget:'station-operations'}
  };

  const WORKFLOWS={
    crew_sick:{classification:'incident',steps:[
      {key:'crew-allocate',department:'crew',kind:'crew_allocation',label:'Allocate replacement crew',detail:'Select a legal, qualified personnel pool and reserve it for this duty.'},
      {key:'crew-report',department:'crew',kind:'crew_report',label:'Replacement report and briefing',detail:'The assigned replacement must travel, report, and complete briefing.',dependsOn:['crew-allocate'],automatic:true},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Amend operational release',detail:'Verify the replacement crew and issue the amended release.',dependsOn:['crew-report']}
    ]},
    mel_defect:{classification:'incident',steps:[
      {key:'mx-inspect',department:'maintenance',kind:'maintenance_inspection',label:'Inspect reported defect',detail:'Assign an engineering inspection before choosing a technical disposition.'},
      {key:'mx-disposition',department:'maintenance',kind:'maintenance_disposition',label:'Set technical disposition',detail:'Repair the defect or defer it under the applicable MEL conditions.',dependsOn:['mx-inspect']},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Review technical release',detail:'Confirm that the resulting aircraft restrictions are acceptable for this flight.',dependsOn:['mx-disposition']}
    ]},
    atc_restriction:{classification:'constraint',steps:[
      {key:'dispatch-flow',department:'dispatch',kind:'atc_coordination',label:'Coordinate ATC flow restriction',detail:'Review the assigned CTOT or submit a priority request.'},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Update operational release',detail:'Accept the returned ATC outcome and update the flight plan.',dependsOn:['dispatch-flow']}
    ]},
    gate_conflict:{classification:'constraint',steps:[
      {key:'station-stand',department:'station',kind:'stand_request',label:'Request replacement stand',detail:'Request a remote stand, replacement gate, or planned-gate hold from airport operations.'},
      {key:'station-coordinate',department:'station',kind:'station_coordination',label:'Coordinate ground movement',detail:'Arrange buses, towing, equipment, and handling for the allocated stand.',dependsOn:['station-stand']}
    ]},
    destination_closure:{classification:'incident',steps:[
      {key:'dispatch-alternate',department:'dispatch',kind:'alternate_selection',label:'Evaluate operational alternate',detail:'Choose a suitable alternate using fuel, weather, distance, and handling information.'},
      {key:'dispatch-flightdeck',department:'dispatch',kind:'flightdeck_recommendation',label:'Send recommendation to flight deck',detail:'Transmit the alternate recommendation for the captain’s decision.',dependsOn:['dispatch-alternate']},
      {key:'dispatch-atc',department:'dispatch',kind:'diversion_clearance',label:'Coordinate flight-crew ATC request',detail:'Relay and monitor the flight crew’s request for diversion clearance.',dependsOn:['dispatch-flightdeck']},
      {key:'station-alternate',department:'station',kind:'alternate_handling',label:'Secure alternate handling',detail:'Request a stand and handling acceptance at the selected alternate.',dependsOn:['dispatch-alternate']},
      {key:'dispatch-release',department:'dispatch',kind:'dispatch_release',label:'Issue amended operational plan',detail:'Confirm clearance and alternate handling, then issue the amended plan.',dependsOn:['dispatch-atc','station-alternate']}
    ]}
  };

  function taskId(incidentId,key){ return `${incidentId}:${key}`; }
  function tasksForIncident(incident){
    const workflow=WORKFLOWS[incident.type];
    if(!workflow) return [];
    return workflow.steps.map(step=>({
      id:taskId(incident.id,step.key),incidentId:incident.id,flightId:incident.flightId,
      aircraftId:incident.aircraftId,department:step.department,kind:step.kind,key:step.key,
      label:step.label,detail:step.detail,dependsOn:(step.dependsOn||[]).map(key=>taskId(incident.id,key)),
      automatic:Boolean(step.automatic),required:true,status:step.dependsOn?.length?'blocked':'available',
      createdAt:incident.detectedAt,startedAt:0,completesAt:0,completedAt:0,selection:null,outcome:''
    }));
  }
  function progress(task,now){
    if(task.status==='completed') return 1;
    if(!['in_progress','waiting_external'].includes(task.status)||!task.startedAt||!task.completesAt) return 0;
    return Math.max(0,Math.min(1,(now-task.startedAt)/(task.completesAt-task.startedAt)));
  }

  global.AeroOperationalWorkflows={DEPARTMENTS,WORKFLOWS,taskId,tasksForIncident,progress};
})(window);
