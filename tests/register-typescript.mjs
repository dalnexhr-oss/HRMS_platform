import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Match the application's @/ alias while running source modules with node:test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return {
        url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
