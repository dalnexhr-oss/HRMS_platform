import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const kebabCase = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const componentName = /^[A-Z][A-Za-z0-9]*$/;
const hookName = /^use[A-Z][A-Za-z0-9]*$/;
const routeGroup = /^\([a-z][a-z0-9-]*\)$/;
const routeParameter = /^\[(?:\.\.\.)?[a-z][A-Za-z0-9]*\]$/;
const errors = [];
const seen = new Map();

async function checkDirectory(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    const key = relative.toLowerCase();
    if (seen.has(key)) {
      errors.push(`${relative}: clashes with ${seen.get(key)} on Windows`);
    }
    seen.set(key, relative);

    if (entry.isDirectory()) {
      const appRoute = relative.startsWith('src/app/');
      if (
        !kebabCase.test(entry.name) &&
        !(appRoute && (routeGroup.test(entry.name) || routeParameter.test(entry.name)))
      ) {
        errors.push(`${relative}: directories must use kebab-case`);
      }
      await checkDirectory(relative);
      continue;
    }

    if (!entry.isFile() || !/\.(?:tsx?|mjs|css)$/.test(entry.name)) {
      continue;
    }
    const extension = path.extname(entry.name);
    const stem = entry.name.slice(0, -extension.length).replace(/\.test$/, '');
    const component = relative.startsWith('src/components/');
    const valid =
      component && extension === '.tsx'
        ? componentName.test(stem)
        : kebabCase.test(stem) || (component && extension === '.ts' && hookName.test(stem));
    if (!valid) {
      errors.push(
        `${relative}: use PascalCase for components, useCamelCase for hooks, and kebab-case for other files`,
      );
    }
  }
}

for (const directory of ['src', 'scripts', 'tests']) {
  await checkDirectory(directory);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('File and directory names follow the project conventions.');
}
