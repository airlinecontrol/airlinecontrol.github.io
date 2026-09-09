/* Derived incidents: operational risks inferred from the live schedule and resources. */

const DERIVED_INCIDENT_CLEAR_GRACE_MS=30*MIN;

function updateOpenDerivedIncident(type,flight,active,context,t){
  const key=context?.sourceKey||`derived:${type}:${context?.sourceId||flight.id}`;
  const incident=state.incidents.find(item=>item.status==='open'&&item.type===type&&item.flightId===flight.id&&item.sourceKey===key)
    ||(!context?.sourceKey?state.incidents.find(item=>item.status==='open'&&item.type===type&&item.flightId===flight.id):null);
  if(active){
    if(!incident&&state.incidents.some(item=>item.type===type&&item.flightId===flight.id&&item.sourceKey===key&&item.status==='resolved')) return false;
    if(incident){
      const previous=JSON.stringify(incident.context||null);
      const next=JSON.stringify(context||null);
      let changed=false;
      if(previous!==next){ incident.context=context; changed=true; }
      if(incident.conditionClearedAt){ incident.conditionClearedAt=0; changed=true; }
      incident.lastDetectedAt=t;
      return changed;
    }
    return Boolean(createIncident(type,flight,{detectedAt:t,source:'derived',sourceKey:key,context}));
  }
  if(incident&&!incidentTasks(incident.id).some(task=>task.status==='completed')){
    if(typeof incidentHasUserActionStarted==='function'&&incidentHasUserActionStarted(incident)) return false;
    const visibleSince=incident.firstVisibleAt||incident.detectedAt||t;
    if(!incident.conditionClearedAt){
      incident.conditionClearedAt=t;
      if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'condition_clear_pending',{clearAfter:DERIVED_INCIDENT_CLEAR_GRACE_MS});
      return true;
    }
    if(t-Math.max(visibleSince,incident.conditionClearedAt)<DERIVED_INCIDENT_CLEAR_GRACE_MS) return false;
    incident.status='resolved'; incident.blocking=false; incident.resolvedAt=t;
    incident.autoClosedAt=t;
    incident.autoCloseReason='condition_cleared';
    incident.automaticResolution=true; incident.selectedAction='condition_cleared';
    incident.outcome='The underlying operational risk cleared before OCC action was needed.';
    for(const task of incidentTasks(incident.id)) if(task.status!=='completed') task.status='cancelled';
    if(typeof traceIncidentTransition==='function') traceIncidentTransition(incident,'auto_closed',{reason:'condition_cleared',visibleMs:t-visibleSince});
    return true;
  }
  return false;
}

function processDerivedOperationalIncidents(t=simNow()){
  let changed=retireTrackedIncidents(t);
  if(!state.ops.automaticDisruptions) return changed;
  for(const flight of state.flights){
    if(flight.cancelled||flight.settled) continue;
    const dep=flightActualDeparture(flight), arr=flightActualArrival(flight);
    const preDeparture=!flight.departureLogged&&dep>t;
    if(preDeparture&&t>=flight.departure-6*HOUR){
      const duty=crewDutyForFlight(flight);
      const dutyActive=!duty.legal&&flight.flightType!=='ferry';
      const dutyContext={sourceId:flight.id,dutyHours:duty.dutyHours,maxHours:duty.maxHours,label:duty.label};
      if(updateOpenDerivedIncident('crew_duty_risk',flight,dutyActive,dutyContext,t)) changed=true;

      const diversionAircraftContext=aircraftMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('aircraft_misposition_after_diversion',flight,Boolean(diversionAircraftContext?.active),diversionAircraftContext,t)) changed=true;

      const positionContext=aircraftOutOfPositionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('aircraft_out_of_position',flight,Boolean(positionContext?.active&&!diversionAircraftContext?.active),positionContext,t)) changed=true;

      const postflightContext=postflightTechnicalContextForFlight(flight,t);
      if(updateOpenDerivedIncident('postflight_technical_defect',flight,Boolean(postflightContext?.active),postflightContext,t)) changed=true;

      const maintenanceResourceContext=maintenanceResourceContextForFlight(flight,t);
      if(updateOpenDerivedIncident('maintenance_resource_unavailable',flight,Boolean(maintenanceResourceContext?.active),maintenanceResourceContext,t)) changed=true;

      const legalCrewContext=legalCrewContextForFlight(flight,t);
      if(updateOpenDerivedIncident('no_legal_crew',flight,Boolean(legalCrewContext?.active),legalCrewContext,t)) changed=true;

      const crewMisconnectContext=crewMisconnectContextForFlight(flight,t);
      if(updateOpenDerivedIncident('crew_misconnect',flight,Boolean(crewMisconnectContext?.active),crewMisconnectContext,t)) changed=true;

      const crewDiversionContext=crewMispositionAfterDiversionContextForFlight(flight,t);
      if(updateOpenDerivedIncident('crew_misposition_after_diversion',flight,Boolean(crewDiversionContext?.active),crewDiversionContext,t)) changed=true;

      const fatigueContext=crewFatigueMidRotationContextForFlight(flight);
      if(updateOpenDerivedIncident('crew_fatigue_mid_rotation',flight,Boolean(fatigueContext?.active),fatigueContext,t)) changed=true;

      const groundStopContext=atcGroundStopContextForFlight(flight,t);
      if(updateOpenDerivedIncident('atc_ground_stop',flight,Boolean(groundStopContext?.active),groundStopContext,t)) changed=true;

      const capacityContext=airportCapacityContextForFlight(flight,t);
      if(updateOpenDerivedIncident('airport_capacity_reduction',flight,false,capacityContext,t)) changed=true;

      const nightCurfewContext=nightCurfewConflictContextForFlight(flight,dep);
      if(updateOpenDerivedIncident('night_curfew_conflict',flight,Boolean(nightCurfewContext?.active),nightCurfewContext,t)) changed=true;

      const performanceContext=performanceLimitContextForFlight(flight,t);
      if(updateOpenDerivedIncident('performance_limited',flight,Boolean(performanceLimitIncidentRequired(performanceContext)),performanceContext,t)) changed=true;

      const handlingContext=destinationHandlingContextForFlight(flight,t);
      if(updateOpenDerivedIncident('destination_handling_unavailable',flight,Boolean(destinationHandlingIncidentRequired(flight,handlingContext)),handlingContext,t)) changed=true;

      const deicingCollapseContext=deicingCapacityCollapseContextForFlight(flight,t);
      if(updateOpenDerivedIncident('deicing_capacity_collapse',flight,Boolean(deicingCollapseContext?.active),deicingCollapseContext,t)) changed=true;

      const deicingContext=deicingContextForFlight(flight,t);
      if(updateOpenDerivedIncident('deicing_required',flight,Boolean(deicingContext?.active&&!deicingCollapseContext?.active),deicingContext,t)) changed=true;

      const holdoverContext=holdoverExpiredContextForFlight(flight,t);
      if(updateOpenDerivedIncident('holdover_expired',flight,Boolean(holdoverContext?.active),holdoverContext,t)) changed=true;
    }
    if(t<arr&&flight.flightType!=='ferry'){
      if(flightIsAirborne(flight,t)){
        const fuelContext=fuelMarginContextForFlight(flight,t);
        if(fuelContext&&updateOpenDerivedIncident('fuel_margin_low',flight,Boolean(fuelContext.active),fuelContext,t)) changed=true;
        const holdingContext=holdingFuelConflictContextForFlight(flight,t);
        if(holdingContext&&updateOpenDerivedIncident('atc_holding_fuel_conflict',flight,Boolean(holdingContext.active),holdingContext,t)) changed=true;
        const airborneHandlingContext=destinationHandlingContextForFlight(flight,t);
        if(airborneHandlingContext&&updateOpenDerivedIncident('destination_handling_unavailable',flight,Boolean(destinationHandlingIncidentRequired(flight,airborneHandlingContext)),airborneHandlingContext,t)) changed=true;
        const diversionUnavailableContext=diversionAirportUnavailableContextForFlight(flight,t);
        if(diversionUnavailableContext&&updateOpenDerivedIncident('diversion_airport_unavailable',flight,Boolean(diversionUnavailableContext.active),diversionUnavailableContext,t)) changed=true;
        const arrivalCurfewContext=arrivalCurfewContextForFlight(flight,t);
        if(updateOpenDerivedIncident('arrival_curfew_coordination',flight,Boolean(arrivalCurfewContext?.active),arrivalCurfewContext,t)) changed=true;
        const dutyExtensionContext=crewDutyExtensionContextForFlight(flight,t);
        if(updateOpenDerivedIncident('crew_duty_extension',flight,Boolean(dutyExtensionContext?.active),dutyExtensionContext,t)) changed=true;
      }
    }
  }
  return changed;
}
