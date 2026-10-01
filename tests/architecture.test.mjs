import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
function imports(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return tree.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => !node.importClause?.isTypeOnly)
    .map((node) => node.moduleSpecifier.text);
}

test('feature queries remain explicitly server-only and do not depend on request handlers', () => {
  for (const name of fs.readdirSync(path.join(root, 'src/lib/queries'))) {
    if (!name.endsWith('.ts')) {
      continue;
    }
    const dependencies = imports(`src/lib/queries/${name}`);
    assert(dependencies.includes('server-only'), `${name} needs a server-only boundary`);
    assert(
      !dependencies.some((item) => item.startsWith('@/lib/actions/')),
      `${name} depends on a request handler`,
    );
  }
});

test('pure payroll and document rules have no runtime dependency on server infrastructure', () => {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) {
      return;
    }
    visited.add(file);
    for (const dependency of imports(file)) {
      assert(
        !/^(?:server-only|mongodb|next\/|@\/lib\/(?:db|actions|queries)\/)/.test(dependency),
        `${file} imports ${dependency}`,
      );
      if (dependency.startsWith('@/')) {
        visit(`src/${dependency.slice(2)}.ts`);
      }
    }
  }
  visit('src/lib/payroll/payslip-calculation.ts');
  visit('src/lib/documents/document-summary.ts');
});
