// Run the bridge separately, or alongside Next.js. A bridge failure never shuts down web punching.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import nextEnv from '@next/env';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? 'bridge';
const extra = process.argv.slice(3);
const deviceCommands = ['bridge', 'status', 'inspect', 'sync-users'];
const combined = mode === 'dev' || mode === 'start';
const children = new Set();
let stopping = false;

function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function stop(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

async function main() {
  if (!combined && !deviceCommands.includes(mode)) {
    throw new Error('Use dev, start, bridge, status, inspect, or sync-users.');
  }
  nextEnv.loadEnvConfig(root, mode !== 'start');
  const configFile = process.env.ZKTECO_CONFIG ?? '.local/zkteco/config.json';
  process.on('SIGINT', () => stop(130));
  process.on('SIGTERM', () => stop(143));
  if (combined) {
    const configText = await readFile(path.resolve(root, configFile), 'utf8');
    const config = JSON.parse(configText.replace(/^\uFEFF/, ''));
    const destination = new URL(config.apiUrl);
    if (
      destination.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname)
    ) {
      throw new Error(
        'Combined startup requires a localhost apiUrl. For hosted HRMS use device:bridge separately.',
      );
    }
    const port = destination.port || '80';
    const web = start(process.execPath, [
      require.resolve('next/dist/bin/next'),
      mode,
      '--port',
      port,
      ...extra,
    ]);
    web.once('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    web.once('exit', (code) => stop(code ?? 1));
  }
  const command = combined ? 'bridge' : mode;
  const worker = start(process.env.ZKTECO_PYTHON ?? 'python', [
    '-u',
    path.join(root, 'zkteco/cli/device.py'),
    command,
    '--config',
    configFile,
    ...(combined ? [] : extra),
  ]);
  const workerFailure = (message) => {
    console.error(`[zkteco] ${message}`);
    if (combined) {
      console.error(
        '[zkteco] The web app remains running. Restart device:bridge after resolving the error.',
      );
    } else {
      process.exitCode = 1;
    }
  };
  worker.once('error', (error) => workerFailure(error.message));
  worker.once('exit', (code) => {
    if (!stopping && code !== 0) {
      workerFailure(`${command} exited with code ${code}.`);
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  stop(1);
});
