#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

function help() {
  console.log(`Usage: scripts/hb.mjs <command> [options]

Commands:
  doctor         inspect repository, access, service health and operational routing
  change-impact  select a conservative verification profile for changed paths`);
}

let code = 0;
if (!command || command === '--help' || command === '-h') {
  help();
} else if (command === 'doctor') {
  const doctor = await import('./ops/hb-doctor.mjs');
  code = await doctor.main(args);
} else if (command === 'change-impact') {
  const impact = await import('./ci/change-impact.mjs');
  code = impact.main(args);
} else {
  console.error(`hb: unknown command: ${command}`);
  help();
  code = 1;
}

process.exitCode = code;
