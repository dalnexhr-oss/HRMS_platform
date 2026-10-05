// One managed Python environment for ADMS and device commands.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const pythonEnvironment = path.join(projectRoot, '.local/zkteco/python');
const requirementsFile = path.join(projectRoot, 'zkteco/requirements.txt');

function getPythonExecutable() {
  if (process.env.ZKTECO_PYTHON) {
    return process.env.ZKTECO_PYTHON;
  }
  const executable = path.join(
    pythonEnvironment,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  if (!existsSync(executable)) {
    throw new Error('ZKTeco Python environment is missing. Run npm run zkteco:setup first.');
  }
  return executable;
}

function spawnPython(pythonArguments) {
  return spawn(getPythonExecutable(), ['-B', '-u', ...pythonArguments], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
}

export { projectRoot, pythonEnvironment, requirementsFile, getPythonExecutable, spawnPython };
