#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nodeTests = [
  'tests/operational-workflows-smoke.js',
  'tests/ground-operations-smoke.js',
  'tests/management-smoke.js',
  'tests/passenger-recovery-smoke.js',
  'tests/operational-intelligence-smoke.js'
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
run(process.execPath, ['tests/run-browser-fixtures.js']);
console.log('\nAll tests passed.');
