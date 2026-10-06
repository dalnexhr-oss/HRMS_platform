// Build and serve an isolated production copy while the normal dev server stays available.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const mode = process.argv[2];
if (!['build', 'start'].includes(mode)) {
  throw new Error('Use build or start.');
}
const args = [require.resolve('next/dist/bin/next'), mode];
if (mode === 'start') {
  args.push('--hostname', '127.0.0.1', '--port', process.env.HRMS_TEST_PORT ?? '3100');
}
args.push(...process.argv.slice(3));
const child = spawn(process.execPath, args, {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-production' },
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
