import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import ts from 'typescript';

const root = resolve(process.cwd());
const files: string[] = [];
function walk(directory: string) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx)$/.test(file)) files.push(file);
  }
}
for (const directory of ['client', 'shared', 'server', 'sdk']) walk(resolve(root, directory));
const local = (file: string) => relative(root, file).replaceAll('\\', '/');
const graph = new Map<string, string[]>();
const errors: string[] = [];
// Explicit write owners keep cross-feature mutations reviewable. Reports may join tables.
const writeOwners: Record<string, string[]> = {
  users: ['account-session-service', 'account-settings', 'account-management', 'cli'],
  sessions: ['account-session-service', 'account-settings', 'maintenance'],
  account_settings: ['account-settings'],
  repositories: ['source-service', 'source-checks'],
  github_owners: ['source-service'],
  import_jobs: ['import-queue', 'installation-service', 'maintenance'],
  import_batches: ['import-batch-service'],
  import_batch_items: ['import-batch-service'],
  installations: ['installation-service', 'import-maintenance', 'maintenance'],
  games: ['installation-service', 'library', 'game-commands'],
  versions: ['installation-service', 'library', 'game-commands'],
  previews: ['preview-service', 'maintenance'],
  plays: ['career'], runs: ['career'], best_scores: ['career'],
  favorites: ['player-library'],
  cloud_saves: ['cloud-save-service'], cloud_save_snapshots: ['cloud-save-service'],
  score_submission_metrics: ['analytics'], visitor_events: ['visitors'],
  operational_state: ['operational-state'],
};
const services = new Set(['account-session-service', 'cloud-save-service', 'game-catalog',
  'source-service', 'import-batch-service', 'import-queue', 'library', 'game-commands',
  'installation-service', 'import-maintenance', 'version-files', 'command-context', 'preview-service', 'platform-update-service', 'admin-data-service', 'save-compatibility']);
const routes = new Set(['account-session', 'cloud-save', 'sources', 'game-updates',
  'game-assets', 'platform-updates', 'game-catalog-routes', 'admin-data']);
const schemaTables = new Map<string, string>();
const schema = readFileSync(resolve(root, 'server/database/schema.ts'), 'utf8');
for (const match of schema.matchAll(/export const (\w+) = sqliteTable\('([^']+)'/g)) schemaTables.set(match[1], match[2]);
for (const table of schemaTables.values()) if (!writeOwners[table]) errors.push(`No write owner for ${table}`);
function checkWrite(file: string, table: string) {
  const from = local(file);
  // Schema migrations own upgrade writes; backup sanitation and CLI seeding are listed above.
  if (!from.startsWith('server/') || from.startsWith('server/database/')) return;
  const module = from.slice('server/'.length).replace(/\.ts$/, '');
  if (!writeOwners[table]?.includes(module)) errors.push(`${from} writes ${table} outside its owning module`);
}
function targetOf(file: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(file), specifier);
  return [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx'), base.replace(/\.js$/, '.ts')].find((candidate) => files.includes(candidate));
}
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const from = local(file), module = from.replace(/^server\//, '').replace(/\.ts$/, '');
  const tableImports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = targetOf(file, statement.moduleSpecifier.text);
    if (!target || !['server/db.ts', 'server/database/schema.ts'].includes(local(target))) continue;
    const names = statement.importClause?.namedBindings;
    if (names && ts.isNamedImports(names)) for (const name of names.elements) {
      const table = schemaTables.get(name.propertyName?.text ?? name.name.text);
      if (table) tableImports.set(name.name.text, table);
    }
  }
  const dependencies: string[] = [];
  function check(specifier: string, runtime: boolean) {
    if (from.startsWith('server/') && services.has(module) && specifier === 'fastify') errors.push(`${from} imports HTTP types/runtime into a service`);
    const target = targetOf(file, specifier);
    if (!target) return;
    const to = local(target);
    if (from.startsWith('client/') && from !== 'client/main.tsx' && to === 'client/main.tsx') errors.push(`${from} imports the application entry`);
    if (from.startsWith('shared/') && (to.startsWith('client/') || to.startsWith('server/'))) errors.push(`${from} imports a runtime layer: ${to}`);
    if ((from.startsWith('server/') || from.startsWith('sdk/')) && to.startsWith('client/')) errors.push(`${from} imports UI: ${to}`);
    if (from.startsWith('client/ui/') && to.startsWith('client/features/')) errors.push(`${from} imports a feature: ${to}`);
    if (services.has(module) && to.startsWith('server/') && routes.has(to.slice(7).replace(/\.ts$/, ''))) errors.push(`${from} imports an HTTP route module: ${to}`);
    if (runtime) dependencies.push(target);
  }
  function visit(node: ts.Node) {
    if (from.startsWith('server/')) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ['insert', 'update', 'delete'].includes(node.expression.name.text) && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
        const table = tableImports.get(node.arguments[0].text);
        if (table) checkWrite(file, table);
      }
      if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
        // Inspect literal fragments only. Calculated SQL/table names require manual review.
        const sql = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ') : node.text;
        for (const match of sql.matchAll(/\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|DELETE\s+FROM)\s+["`\[]?(\w+)|\bUPDATE\s+["`\[]?(\w+)["`\]]?\s+SET\b/gi)) checkWrite(file, match[1] || match[2]);
      }
      if (routes.has(module) && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === 'store' && ['db', 'sqlite'].includes(node.name.text)) errors.push(`${from} accesses persistence in an HTTP route; use its service`);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const names = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (names && ts.isNamedImports(names) && !clause?.name && names.elements.every((name) => name.isTypeOnly)) || (ts.isExportDeclaration(node) && node.isTypeOnly);
      check(node.moduleSpecifier.text, !onlyTypes);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text, true);
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, dependencies);
}
const visited = new Set<string>();
const active: string[] = [];
function checkCycles(file: string) {
  const index = active.indexOf(file);
  if (index !== -1) { errors.push('Runtime cycle: ' + [...active.slice(index), file].map(local).join(' -> ')); return; }
  if (visited.has(file)) return;
  active.push(file);
  for (const dependency of graph.get(file) || []) checkCycles(dependency);
  active.pop();
  visited.add(file);
}
for (const file of files) checkCycles(file);
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else console.log(`Module boundaries passed (${files.length} source files; runtime cycles, layer imports and table write owners checked).`);
