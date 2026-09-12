import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const projectDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dev = process.argv.includes('--dev');
if (!dev) console.info('Opening Thor Track…');
// Source launches always build the current checkout. Installed apps use the bundled build directly.
const build = spawn(process.execPath, [path.join(projectDirectory, 'node_modules', 'vinext', 'dist', 'cli.js'), 'build'], {
  cwd: projectDirectory, stdio: dev ? 'inherit' : 'ignore', windowsHide: true,
});
build.on('error', (error) => { console.error(dev ? error.message : 'Thor Track could not be prepared. Try again with --dev for details.'); process.exitCode = 1; });
build.on('exit', (code) => {
  if (code !== 0) { console.error('Thor Track could not be prepared. Try again with --dev for details.'); process.exitCode = code ?? 1; return; }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [projectDirectory, ...process.argv.slice(2)], {
    cwd: projectDirectory, env, stdio: dev ? 'inherit' : 'ignore', windowsHide: true,
  });
  child.on('error', (error) => { console.error(dev ? error.message : 'Thor Track could not open. Try again with --dev for details.'); process.exitCode = 1; });
  child.on('exit', (exitCode) => { process.exitCode = exitCode ?? 1; });
});
