import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { format } from 'prettier';
import ts from 'typescript';
import * as importPlugin from '../scripts/prettier-imports.mjs';

const options = {
  parser: 'typescript',
  plugins: [importPlugin],
  printWidth: 40,
  singleQuote: true,
};

test('long imports stay on one line while ordinary code keeps its configured width', async () => {
  const input = `
import { firstVeryLongName, secondVeryLongName, thirdVeryLongName } from 'example-package';
import type { FirstLongType, SecondLongType, ThirdLongType } from 'example-types';
const value = firstVeryLongName(secondVeryLongName, thirdVeryLongName);
`;
  for (const parser of ['typescript', 'babel-ts']) {
    const output = await format(input, { ...options, parser });
    const lines = output.split('\n');
    assert.match(lines[0], /^import \{ .+ \} from 'example-package';$/);
    assert.match(lines[1], /^import type \{ .+ \} from 'example-types';$/);
    assert.ok(lines[0].length > options.printWidth);
    assert.ok(output.includes('const value = firstVeryLongName(\n'));
    assert.equal(await format(output, { ...options, parser }), output);
  }
});

test('import comments survive formatting without consuming imported names or following code', async () => {
  const input = `
// Module note
import {
  firstName, // Keep this rationale
  /* Keep this symbol note */ secondName
} from 'example-package';
export const both = [firstName, secondName];
`;
  const output = await format(input, options);
  for (const note of ['Module note', 'Keep this rationale', 'Keep this symbol note']) {
    assert.ok(output.includes(note));
  }
  const emitted = async (source) =>
    format(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, removeComments: true },
      }).outputText,
      { parser: 'babel' },
    );
  assert.equal(await emitted(output), await emitted(input));
  assert.equal(await format(output, options), output);
});

test('lint fixes split and group type imports without moving runtime imports or directives', async () => {
  const input = `
'use client';
import './example.css';
import type { FirstType } from './first';
import { firstValue, type SecondType } from './second';
import { secondValue } from './third';
export const values = [firstValue, secondValue];
export type Both = FirstType & SecondType;
`;
  const eslint = new ESLint({ fix: true });
  const [result] = await eslint.lintText(input, { filePath: 'src/import-formatting-example.ts' });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  const output = await format(result.output ?? input, options);
  const imports = output.split('\n').filter((line) => line.startsWith('import '));
  assert.deepEqual(imports.slice(0, 3), [
    "import './example.css';",
    "import { firstValue } from './second';",
    "import { secondValue } from './third';",
  ]);
  assert.deepEqual(imports.slice(3).sort(), [
    "import type { FirstType } from './first';",
    "import type { SecondType } from './second';",
  ]);
  assert.ok(output.startsWith("'use client';"));
  const [again] = await eslint.lintText(output, { filePath: 'src/import-formatting-example.ts' });
  assert.equal(again.errorCount, 0);
  assert.equal(await format(again.output ?? output, options), output);
});
