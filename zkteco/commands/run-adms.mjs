// Start the Python receiver independently of Next.js so each service can restart.
import path from 'node:path';
import nextEnv from '@next/env';
import { projectRoot, spawnPython } from '../shared/python-runtime.mjs';

nextEnv.loadEnvConfig(projectRoot, process.env.NODE_ENV !== 'production');
const mode = process.argv[2] ?? 'serve';
if (!['serve', 'check', 'status'].includes(mode)) {
  throw new Error('Use serve, check, or status.');
}
const pythonArguments = [
  path.join(projectRoot, 'zkteco/commands/adms_commands.py'),
  mode,
  '--config',
  process.env.ZKTECO_ADMS_CONFIG ?? '.local/zkteco/adms/config.json',
];
let child;
try {
  child = spawnPython([...pythonArguments, ...process.argv.slice(3)]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
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
