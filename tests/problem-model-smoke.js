const assert = require('node:assert/strict');

global.window = global;
require('../js/problem-model.js');

const model = global.AeroProblemModel;
assert.ok(model, 'problem model should be exposed');
assert.equal(model.workflowDefinitions, undefined, 'legacy workflow definitions must not be exposed');
assert.equal(global.AeroProblemTasks, undefined, 'legacy problem task engine must not be exposed');

const types = model.activeProblemTypes();
assert.ok(types.length > 20, 'active problem catalog is unexpectedly small');
assert.ok(types.includes('destination_closure'), 'airborne destination closure is missing');
assert.ok(types.includes('network_airspace_closure'), 'network airspace closure is missing');
assert.ok(types.includes('mel_defect'), 'ground technical defect is missing');

for (const type of types) {
  const definition = model.definitionForType(type);
  const entry = model.problemModel(type);
  assert.ok(definition?.title, `${type} missing title`);
  assert.ok(definition?.summary, `${type} missing summary`);
  assert.ok(['flight', 'aircraft', 'airport', 'network'].includes(entry.scope), `${type} has invalid scope ${entry.scope}`);
  assert.ok(['ground', 'airborne', 'any'].includes(entry.phase), `${type} has invalid phase ${entry.phase}`);
  assert.ok(model.recommendationsForType(type).length, `${type} has no owning-widget recommendations`);
  assert.match(model.resolutionTextForProblem({ type }), /\S/, `${type} has no resolution copy`);
}

const airportTypes = types.filter(type => model.scopeForType(type) === 'airport');
assert.ok(airportTypes.includes('destination_closure'), 'airport-scoped airborne destination closure is missing');
assert.ok(airportTypes.includes('destination_closure_ground'), 'airport-scoped ground destination closure is missing');

const networkTypes = types.filter(type => model.scopeForType(type) === 'network');
assert.deepEqual(networkTypes.sort(), [
  'network_airspace_closure',
  'network_convective_weather'
].sort(), 'unexpected network-scoped problem catalog');

for (const type of [
  'crew_duty_risk', 'crew_fatigue_mid_rotation', 'crew_misconnect', 'crew_report_delayed',
  'aircraft_out_of_position', 'crew_duty_extension', 'deicing_required',
  'airborne_atc_reroute', 'network_atc_sector_capacity'
]) {
  assert.equal(model.attentionModeForType(type), 'warning', `${type} should be warning-only`);
  assert.equal(model.problemModel(type), null, `${type} should not expose a problem model`);
}
for (const type of ['maintenance_resource_unavailable', 'destination_handling_unavailable', 'performance_limited']) {
  assert.equal(model.attentionModeForType(type), 'widget', `${type} should be owned by widget state`);
  assert.equal(model.problemModel(type), null, `${type} should not expose a problem model`);
}
for (const type of ['night_curfew_conflict', 'destination_below_minima', 'deicing_capacity_collapse', 'network_convective_weather']) {
  assert.equal(model.attentionModeForType(type), 'escalating', `${type} should use warning-to-problem escalation`);
}

const defaultPolicy = model.defaultPolicyForType('destination_closure');
assert.equal(defaultPolicy.mode, 'divert');
assert.equal(defaultPolicy.minimumVisibleMin, 10);
assert.match(defaultPolicy.summary, /safest available flight-deck outcome/i);
assert.equal(model.defaultPolicyForType('crew_sick').mode, 'cancel_at_departure');
assert.equal(model.defaultPolicyForType('network_airspace_closure').mode, 'network_avoidance');

const recommendations = model.recommendationsForProblem({ type: 'destination_closure', flightId: 'AS1' });
assert.ok(recommendations.some(item => item.desk === 'dispatch'), 'destination closure should point to Dispatch');
assert.ok(recommendations.some(item => item.desk === 'station'), 'destination closure should point to Station Operations');

const cabinResponseTypes = types.filter(type => model.requiredResponseForType(type)?.owner === 'cabin');
assert.deepEqual(cabinResponseTypes.sort(), [
  'onboard_medical',
  'pressurization_issue',
  'unruly_passenger'
].sort(), 'unexpected cabin-response problem catalog');
for (const type of cabinResponseTypes) {
  const problem = { id: `TEST-${type}`, type };
  const requirement = model.requiredResponseForType(type);
  const delayMin = model.responseDelayMinutesForProblem(problem);
  const outcome = model.responseOutcomeForProblem(problem);
  assert.ok(delayMin >= requirement.responseMin[0] && delayMin <= requirement.responseMin[1], `${type} response time is outside its configured range`);
  assert.ok(outcome?.id && outcome?.title && outcome?.detail && outcome?.fallbackMode, `${type} has no usable cabin response outcome`);
}
const flightDeckResponseTypes = types.filter(type => model.requiredResponseForType(type)?.owner === 'flightDeck');
assert.deepEqual(flightDeckResponseTypes, ['inflight_technical_fault'], 'unexpected flight-deck-response problem catalog');
const technicalProblem = { id: 'TEST-TECHNICAL', type: 'inflight_technical_fault', context: { phasePct: 70 } };
const technicalResponse = model.requiredResponseForType(technicalProblem.type);
const technicalDelay = model.responseDelayMinutesForProblem(technicalProblem);
const technicalOutcome = model.responseOutcomeForProblem(technicalProblem);
assert.ok(technicalDelay >= technicalResponse.responseMin[0] && technicalDelay <= technicalResponse.responseMin[1], 'technical response time is outside its configured range');
assert.ok(technicalOutcome?.severityLabel && technicalOutcome?.decision, 'technical response must report severity and flight-deck decision');
assert.notEqual(technicalOutcome.id, 'return_origin', 'late-flight technical assessment must not select return to origin');
assert.equal(model.requiredResponseForType('crew_sick'), null, 'crew sick call should not wait for a second crew report');

console.log('problem model smoke tests passed');
