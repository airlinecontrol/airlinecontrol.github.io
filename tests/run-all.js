#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nodeTests = [
  'tests/problem-model-smoke.js',
  'tests/ground-operations-smoke.js',
  'tests/management-smoke.js',
  'tests/passenger-recovery-smoke.js',
  'tests/operational-intelligence-smoke.js'
];
const browserFixtures = [
  'tests/problem-scopes-browser-fixture.html',
  'tests/problem-response-browser-fixture.html',
  'tests/problem-defaults-browser-fixture.html',
  'tests/network-problems-browser-fixture.html',
  'tests/next-ui-browser-fixture.html',
  'tests/warnings-browser-fixture.html',
  'tests/weather-engine-browser-fixture.html',
  'tests/ferry-planning-browser-fixture.html',
  'tests/flight-retention-browser-fixture.html',
  'tests/route-planning-browser-fixture.html',
  'tests/performance-browser-fixture.html',
  'tests/crew-duty-browser-fixture.html',
  'tests/crew-assignment-browser-fixture.html',
  'tests/station-services-browser-fixture.html',
  'tests/personnel-transfer-browser-fixture.html',
  'tests/disruption-cases-browser-fixture.html',
  'tests/map-aircraft-markers-browser-fixture.html',
  'tests/simulation-soak-browser-fixture.html'
];

function run(command, args) {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(result.error.stack || result.error);
    process.exit(result.status || 1);
  }
  if (result.status) process.exit(result.status);
}

for (const file of nodeTests) run(process.execPath, [file]);
run(process.execPath, ['tests/run-browser-fixtures.js', ...browserFixtures]);
console.log('\nAll tests passed.');
