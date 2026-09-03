import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const wranglerCli = path.join(projectDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const result = spawnSync(
  process.execPath,
  [
    wranglerCli,
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    'wrangler.local.jsonc',
    '--persist-to',
    '.wrangler/state',
  ],
  {
    cwd: projectDirectory,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: path.join(projectDirectory, '.wrangler', 'logs'),
      WRANGLER_WRITE_LOGS: 'false',
    },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
