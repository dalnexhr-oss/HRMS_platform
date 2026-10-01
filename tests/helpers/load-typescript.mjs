// Run application modules in Node tests without starting Next.js or connecting to MongoDB.
// Overrides replace infrastructure at its module boundary; application functions run unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

function loadTypeScript(file, overrides = {}, sourceOverrides = {}) {
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) {
      return cache.get(absolute).exports;
    }
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const source = sourceOverrides[relative] ?? fs.readFileSync(absolute, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: absolute,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    cache.set(absolute, loadedModule);
    function resolve(specifier) {
      if (Object.hasOwn(overrides, specifier)) {
        return overrides[specifier];
      }
      if (specifier === 'server-only') {
        return {};
      }
      if (specifier.startsWith('@/') || specifier.startsWith('.')) {
        const candidate = specifier.startsWith('@/')
          ? path.join(root, 'src', specifier.slice(2))
          : path.resolve(path.dirname(absolute), specifier);
        return load(path.extname(candidate) ? candidate : `${candidate}.ts`);
      }
      return require(specifier);
    }
    new Function('require', 'module', 'exports', output)(
      resolve,
      loadedModule,
      loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return load(file);
}

export { loadTypeScript };
