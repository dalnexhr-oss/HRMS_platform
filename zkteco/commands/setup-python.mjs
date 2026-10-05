// Install the declared Python dependencies; never start services or modify device data.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import nextEnv from '@next/env';
import { projectRoot, pythonEnvironment, requirementsFile, getPythonExecutable } from '../shared/python-runtime.mjs';
import { runCommand } from './command-errors.mjs';

function runSetupStep(executable, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (error) => {
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `Python was not found at ${executable}. Install Python 3.11+ (with venv and pip), then run npm run zkteco:setup.`
            : error.message,
        ),
      );
    });
    child.once('exit', (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Python setup failed (${signal ?? exitCode}). See the output above.`));
      }
    });
  });
}

runCommand(async () => {
  const { values } = parseArgs({
    options: { check: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log('Usage: npm run zkteco:setup [-- --check]');
    console.log(
      'Installs zkteco/requirements.txt into .local/zkteco/python. --check only verifies.',
    );
    console.log(
      'ZKTECO_PYTHON selects an existing interpreter; ZKTECO_PYTHON_BASE selects one for creating the environment.',
    );
    return;
  }
  nextEnv.loadEnvConfig(projectRoot, process.env.NODE_ENV !== 'production');
  if (!values.check) {
    if (!process.env.ZKTECO_PYTHON && !existsSync(path.join(pythonEnvironment, 'pyvenv.cfg'))) {
      const basePython =
        process.env.ZKTECO_PYTHON_BASE ?? (process.platform === 'win32' ? 'python' : 'python3');
      await runSetupStep(basePython, ['-m', 'venv', pythonEnvironment]);
    }
    const pythonExecutable = getPythonExecutable();
    await runSetupStep(pythonExecutable, [
      '-B',
      '-c',
      "import sys; sys.exit('Python 3.11 or newer is required.') if sys.version_info < (3, 11) else None",
    ]);
    await runSetupStep(pythonExecutable, [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-r',
      requirementsFile,
    ]);
    await runSetupStep(pythonExecutable, ['-m', 'pip', 'check']);
  }
  await runSetupStep(getPythonExecutable(), ['-B', 'zkteco/shared/runtime_dependencies.py']);
});
