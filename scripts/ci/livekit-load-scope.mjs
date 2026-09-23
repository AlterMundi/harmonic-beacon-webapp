import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Closed dependency scope: presentation/binding lookup and app-only delivery,
// not media code. Unknown or incomplete evidence always retains load checks.
const NO_MEDIA_CHANGE = new Set([
  'src/app/layout.tsx',
  'src/app/__tests__/layout-account-navigation.test.tsx',
  'src/components/brand/StaffModeAccess.tsx',
  'src/components/brand/__tests__/StaffModeAccess.test.tsx',
  'src/lib/brand/account-navigation-state.ts',
  'src/lib/brand/__tests__/account-navigation-state.test.ts',
  'e2e/account-fixture/rp.spec.ts',
  'e2e/account-fixture/runtime-backend.test.ts',
  'deploy/hb-app-bridge-permit.example.json',
  'deploy/hb-app-bridge-production.compose.yml',
  'deploy/hb-app-bridge-staging.compose.yml',
  'deploy/hb-app-bridge-root',
  'scripts/ops/__tests__/app-bridge.test.mjs',
]);

export function requiresLiveKitLoad(files) {
  return !files.length || files.some(file =>
    !file.endsWith('.md') && !NO_MEDIA_CHANGE.has(file));
}

export function selectFromRefs(base, head, git = execFileSync) {
  if (![base, head].every(ref => /^[a-f0-9]{40}$/.test(ref ?? '') && !/^0+$/.test(ref))) return true;
  try {
    const paths = git('git', ['diff', '--name-only', '-z', base, head], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
    return requiresLiveKitLoad(paths);
  } catch {
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`required=${selectFromRefs(process.env.BASE_SHA, process.env.HEAD_SHA)}`);
}
