import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRepositoryIndex } from '../modules/repository-index/index.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-config-level1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

test('Level 1 extracts architecture boundaries from supported configuration families', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({
    name: 'web', workspaces: ['packages/*'], scripts: { start: 'node server.js' }, dependencies: { express: '1' },
  }));
  write(root, 'pyproject.toml', '[project]\nname = "worker"\ndependencies = ["fastapi>=1", "redis"]\n[project.scripts]\nworker = "worker:main"\n');
  write(root, 'go.mod', 'module example.com/api\ngo 1.23\nrequire github.com/gin-gonic/gin v1.10.0\n');
  write(root, 'Cargo.toml', '[package]\nname = "engine"\n[dependencies]\ntokio = "1"\n');
  write(root, 'pom.xml', '<project><groupId>com.example</groupId><artifactId>gateway</artifactId><dependencies><dependency><artifactId>grpc-netty</artifactId></dependency></dependencies></project>');
  write(root, 'build.gradle', 'plugins { id "java" }\ndependencies { implementation "org.example:client:1" }\n');
  write(root, 'Service.csproj', '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../Core/Core.csproj" /><PackageReference Include="Grpc.Net.Client" /></ItemGroup></Project>');
  write(root, 'Dockerfile', 'FROM node:22 AS build\nEXPOSE 3000\nCMD ["node", "server.js"]\n');
  write(root, 'docker-compose.yml', 'services:\n  api:\n    image: example/api:1\n    depends_on:\n      - worker\n  worker:\n    build: .\nnetworks:\n  backend:\n');
  write(root, 'k8s/deployment.yaml', 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      serviceAccountName: api-sa\n      containers:\n        - name: api\n          image: example/api:1\n');
  write(root, 'main.tf', 'resource "aws_sqs_queue" "jobs" {}\ndata "aws_vpc" "main" {}\nmodule "network" { source = "./network" }\n');
  write(root, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: Public API\n  version: 1.0.0\npaths:\n  /users:\n    get:\n      responses: {}\n');
  write(root, 'api.proto', 'syntax = "proto3";\npackage api.v1;\nservice Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }\nmessage HelloRequest {}\n');
  write(root, '.github/workflows/ci.yml', 'jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n');
  write(root, 'src/private.js', 'export const privateSourceMarker = true;\n');

  const result = buildRepositoryIndex(root, { batchSize: 100 });
  const byKind = new Map(result.level1.configurations.map((entry) => [entry.kind, entry]));

  assert.equal(result.level1.name, 'configuration-boundaries');
  assert.equal(result.level1.sourceBodiesIncluded, false);
  assert.equal(result.level1.consideredFiles, 14);
  assert.equal(result.level1.parsedFiles, 14);
  for (const kind of [
    'package-json', 'pyproject', 'go-mod', 'cargo', 'maven', 'gradle', 'dotnet',
    'dockerfile', 'docker-compose', 'kubernetes', 'terraform', 'openapi', 'protobuf', 'ci-workflow',
  ]) assert.ok(byKind.has(kind), `missing ${kind}`);

  assert.deepEqual(byKind.get('package-json').facts.runtimeDependencies, ['express']);
  assert.deepEqual(byKind.get('package-json').facts.entryScriptFiles, { start: ['server.js'] });
  assert.deepEqual(byKind.get('pyproject').facts.dependencies, ['fastapi', 'redis']);
  assert.equal(byKind.get('go-mod').facts.module, 'example.com/api');
  assert.deepEqual(byKind.get('cargo').facts.dependencies, ['tokio']);
  assert.ok(byKind.get('maven').facts.dependencies.includes('grpc-netty'));
  assert.ok(byKind.get('gradle').facts.plugins.includes('java'));
  assert.deepEqual(byKind.get('dotnet').facts.targetFrameworks, ['net8.0']);
  assert.deepEqual(byKind.get('dockerfile').facts.baseImages, ['node:22']);
  assert.deepEqual(byKind.get('docker-compose').facts.services, [
    { name: 'api', image: 'example/api:1', build: null, dependsOn: ['worker'] },
    { name: 'worker', image: null, build: '.', dependsOn: [] },
  ]);
  assert.deepEqual(byKind.get('kubernetes').facts.kinds, ['Deployment']);
  assert.deepEqual(byKind.get('terraform').facts.resources, ['aws_sqs_queue']);
  assert.deepEqual(byKind.get('openapi').facts.paths, ['/users']);
  assert.deepEqual(byKind.get('protobuf').facts.services, ['Greeter']);
  assert.deepEqual(byKind.get('ci-workflow').facts.jobs, ['test']);
  assert.equal(JSON.stringify(result.level1).includes('privateSourceMarker'), false);
});

test('Level 1 also reads Python requirement files, Procfile, workspaces, Helm, GitLab and Azure CI, and sniffs Kubernetes YAML by content', (t) => {
  const root = workspace(t);
  write(root, 'requirements.txt', 'fastapi>=0.100\nredis==5.0.0  # cache\n-r requirements/base.txt\ngit+https://user:token@example.com/private/repo.git#egg=secretlib\n');
  write(root, 'requirements/base.txt', 'numpy\n');
  write(root, 'Pipfile', '[packages]\nrequests = "*"\n[scripts]\nserve = "python app.py"\n');
  write(root, 'setup.cfg', '[metadata]\nname = toolkit\n[options]\ninstall_requires =\n    click>=8\n    rich\n[options.entry_points]\nconsole_scripts =\n    toolkit = toolkit.cli:main\n');
  write(root, 'environment.yml', 'name: research\nchannels:\n  - conda-forge\ndependencies:\n  - python=3.11\n  - pytorch\n');
  write(root, 'Procfile', 'web: gunicorn app:server\nworker: python worker.py\n');
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - "libs/*"\n');
  write(root, 'charts/app/Chart.yaml', 'apiVersion: v2\nname: app\ndependencies:\n  - name: redis\n    version: 1.0\n');
  write(root, '.gitlab-ci.yml', 'stages:\n  - test\n  - deploy\nvariables:\n  SECRET_TOKEN: abc123\ntest:\n  stage: test\n  image: node:22\n  script: npm test\n.hidden:\n  script: echo\n');
  write(root, 'azure-pipelines.yml', 'stages:\n  - stage: Build\n    jobs:\n      - job: Compile\n        pool:\n          vmImage: ubuntu-latest\n');
  write(root, 'deploy.yaml', 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          image: example/api:1\n          env:\n            - name: DB_PASSWORD\n              value: hunter2\n');
  write(root, 'config/settings.yaml', 'database:\n  password: hunter2\n');

  const result = buildRepositoryIndex(root, { batchSize: 100 });
  const byKind = new Map(result.level1.configurations.map((entry) => [entry.kind, entry]));
  assert.deepEqual([...byKind.keys()].sort(), [
    'azure-pipeline', 'conda-environment', 'gitlab-ci', 'helm-chart', 'kubernetes', 'pipfile', 'pnpm-workspace', 'procfile', 'python-requirements', 'setup-cfg',
  ]);
  const requirements = result.level1.configurations.filter((entry) => entry.kind === 'python-requirements').map((entry) => entry.path).sort();
  assert.deepEqual(requirements, ['requirements.txt', 'requirements/base.txt']);
  const rootRequirements = result.level1.configurations.find((entry) => entry.path === 'requirements.txt');
  assert.deepEqual(rootRequirements.facts.dependencies, ['fastapi', 'redis']);
  assert.deepEqual(rootRequirements.facts.includes, ['requirements/base.txt']);
  assert.deepEqual(byKind.get('pipfile').facts, { dependencies: ['requests'], scripts: ['serve'] });
  assert.deepEqual(byKind.get('setup-cfg').facts, { name: 'toolkit', dependencies: ['click', 'rich'], scripts: ['toolkit'] });
  assert.deepEqual(byKind.get('conda-environment').facts, { name: 'research', channels: ['conda-forge'], dependencies: ['python', 'pytorch'] });
  assert.deepEqual(byKind.get('procfile').facts.processes, { web: [], worker: ['worker.py'] });
  assert.deepEqual(byKind.get('pnpm-workspace').facts.packages, ['apps/*', 'libs/*']);
  assert.deepEqual(byKind.get('helm-chart').facts, { name: 'app', dependencies: ['redis'] });
  assert.deepEqual(byKind.get('gitlab-ci').facts, { stages: ['test', 'deploy'], jobs: ['test'], images: ['node:22'] });
  assert.deepEqual(byKind.get('azure-pipeline').facts, { stages: ['Build'], jobs: ['Compile'], pools: ['ubuntu-latest'] });
  assert.equal(byKind.get('kubernetes').path, 'deploy.yaml', 'a root-level manifest is recognised by its apiVersion/kind, not its directory');
  assert.equal(result.level1.consideredFiles, result.level1.parsedFiles, 'a plain settings YAML is a candidate that is dropped, not counted');
  const text = JSON.stringify(result.level1);
  for (const secret of ['hunter2', 'abc123', 'user:token', 'secretlib']) assert.equal(text.includes(secret), false, `${secret} must not appear in Level 1 output`);
});

test('Level 1 rolls the per-file facts up into architecture boundaries with their sources', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({
    name: 'shop', workspaces: ['packages/*'], bin: { shop: 'bin/cli.mjs' }, main: 'index.mjs',
    scripts: { start: 'node server.js', test: 'node --test' },
  }));
  write(root, 'docker-compose.yml', 'services:\n  web:\n    build: .\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n');
  write(root, 'Dockerfile', 'FROM node:22\nEXPOSE 8080\nCMD ["node", "server.js"]\n');
  write(root, 'openapi.json', JSON.stringify({ info: { title: 'Shop API', version: '1' }, paths: { '/carts': {}, '/orders': {} } }));
  write(root, 'api.proto', 'syntax = "proto3";\npackage shop.v1;\nservice Carts { rpc Get (R) returns (S); }\n');
  write(root, '.github/workflows/ci.yml', 'jobs:\n  test:\n    runs-on: ubuntu-latest\n');
  write(root, 'infra/main.tf', 'resource "aws_rds_instance" "db" {}\n');
  write(root, 'Service.csproj', '<Project><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Project>');

  const { boundaries } = buildRepositoryIndex(root, { batchSize: 100 }).level1;
  assert.deepEqual(boundaries.services.map((s) => [s.name, s.kind]), [
    ['Service', 'dotnet-project'], ['web', 'compose-service'], ['db', 'compose-service'], ['shop', 'node-package'],
  ]);
  assert.deepEqual(boundaries.dependencies, [
    { from: 'Service.csproj', to: '../Core/Core.csproj', relation: 'project-reference', source: 'Service.csproj' },
    { from: 'web', to: 'db', relation: 'depends_on', source: 'docker-compose.yml' },
    { from: 'shop', to: 'packages/*', relation: 'workspace', source: 'package.json' },
  ]);
  assert.deepEqual(boundaries.entrypoints.map((e) => [e.name, e.kind, e.files]), [
    ['Dockerfile', 'container-command', []],
    ['shop', 'npm-bin', ['bin/cli.mjs']],
    ['shop:main', 'npm-main', ['index.mjs']],
    ['shop:start', 'npm-script', ['server.js']],
  ]);
  assert.deepEqual(boundaries.deployment.map((d) => d.kind), ['container-image', 'terraform']);
  assert.deepEqual(boundaries.apis.map((a) => [a.kind, a.paths || a.services]), [['grpc', ['Carts']], ['openapi', ['/carts', '/orders']]]);
  assert.deepEqual(boundaries.ci, [{ kind: 'ci-workflow', jobs: ['test'], stages: [], source: '.github/workflows/ci.yml' }]);
  for (const list of Object.values(boundaries)) for (const item of list) assert.ok(item.source, 'every boundary names its configuration file');
});

test('Level 1 pages every configuration candidate without dropping files at the page limit', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 4; index += 1) write(root, `services/s${index}/package.json`, JSON.stringify({ name: `s${index}`, dependencies: { left: '1' } }));
  write(root, 'go.mod', `module example.com/big\n${'require example.com/dep v1.0.0\n'.repeat(400)}`);
  write(root, 'src/a.js', 'export const a = 1;\n');

  const limited = buildRepositoryIndex(root, { batchSize: 2, level1Limits: { maximumFiles: 3 } }).level1;
  assert.equal(limited.parsedFiles, 3);
  assert.equal(limited.skippedByLimit, 0);
  assert.equal(limited.limits.maximumFiles, 3);
  assert.deepEqual(limited.coverage, {
    surfaced: 3, total: 5, complete: false,
    directories: { covered: 3, total: 5 },
    kinds: { covered: 2, total: 2 },
    nextBatch: 2,
  });
  const second = buildRepositoryIndex(root, { batchSize: 2, batch: 2, level1Limits: { maximumFiles: 3 } }).level1;
  assert.equal(second.parsedFiles, 2);
  assert.equal(second.coverage.complete, true);
  assert.deepEqual(new Set([...limited.configurations, ...second.configurations].map((entry) => entry.path)), new Set([
    'go.mod', 'services/s0/package.json', 'services/s1/package.json', 'services/s2/package.json', 'services/s3/package.json',
  ]));

  const small = buildRepositoryIndex(root, { batchSize: 2, level1Limits: { maximumBytesPerFile: 200 } }).level1;
  const goMod = small.configurations.find((entry) => entry.kind === 'go-mod');
  assert.equal(goMod.truncated, true);
  assert.ok(goMod.facts.requires.length >= 1 && small.bytesRead < 1000, 'only the capped prefix was read');

  const later = buildRepositoryIndex(root, { batchSize: 2, batch: 2 });
  assert.deepEqual(later.level1.configurations, []);
  assert.equal(later.level1.coverage.complete, true);
});

test('Level 1 reads named configuration before unnamed YAML, so candidates cannot starve the budget', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 5; index += 1) write(root, `aaa-${index}.yml`, 'title: not a manifest\n');
  write(root, 'zzz/package.json', JSON.stringify({ name: 'late' }));
  write(root, 'zzz/deploy.yml', 'apiVersion: v1\nkind: Service\nmetadata:\n  name: late\n');

  const level1 = buildRepositoryIndex(root, { batchSize: 100 }).level1;
  assert.deepEqual(level1.configurations.map((entry) => entry.path), ['zzz/deploy.yml', 'zzz/package.json']);
  assert.deepEqual(level1.candidates, { inspected: 6, rejected: 5 });
  assert.equal(level1.consideredFiles, 2, 'the five plain YAML files are inspected and dropped, not counted');

  const capped = buildRepositoryIndex(root, { batchSize: 100, level1Limits: { maximumFiles: 2 } }).level1;
  assert.deepEqual(capped.configurations.map((entry) => entry.kind), ['package-json'], 'the named file is still parsed');
  assert.equal(capped.coverage.complete, false);
  const next = buildRepositoryIndex(root, { batchSize: 100, batch: 2, level1Limits: { maximumFiles: 2 } }).level1;
  assert.deepEqual(next.configurations.map((entry) => entry.kind), ['kubernetes'], 'the next page reaches another directory without scoring');
  const last = buildRepositoryIndex(root, { batchSize: 100, batch: 4, level1Limits: { maximumFiles: 2 } });
  assert.deepEqual(last.files, [], 'configuration coverage can continue after file inventory coverage is complete');
  assert.equal(last.level1.coverage.complete, true);
  assert.equal(last.coverage.nextBatch, null);
});

test('Level 1 reports fact and boundary caps separately from file coverage', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 60; index += 1) {
    write(root, `packages/p${index}/package.json`, JSON.stringify({
      name: `p${index}`,
      dependencies: Object.fromEntries(Array.from({ length: 60 }, (_, item) => [`dep${item}`, '1'])),
    }));
  }
  const result = buildRepositoryIndex(root, { batchSize: 100 });
  assert.equal(result.level1.coverage.complete, true);
  assert.equal(result.level1.configurations.length, 60);
  assert.equal(result.level1.configurations[0].truncated, false);
  assert.equal(result.level1.configurations[0].factsTruncated, true);
  assert.equal(result.level1.boundaries.services.length, 50);
  assert.equal(result.level1.boundariesTruncated, true);
});

test('Compose dependency forms do not invent condition edges or lose inline targets', (t) => {
  const root = workspace(t);
  write(root, 'docker-compose.yml', `services:
  api:
    depends_on:
      db:
        condition: service_healthy
        restart: true
  cache:
    depends_on: [db, redis]
  db:
    image: postgres:16
  redis:
    image: redis:7
`);
  const edges = buildRepositoryIndex(root).level1.boundaries.dependencies;
  assert.deepEqual(edges.map(({ from, to }) => [from, to]), [
    ['api', 'db'], ['cache', 'db'], ['cache', 'redis'],
  ]);
});

test('repository inspection removes credentials from prefixed Terraform URLs', (t) => {
  const root = workspace(t);
  write(root, 'infra/main.tf', 'module "app" {\n  source = "git::https://demo:FAKE_SECRET@example.invalid/repo.git?token=FAKE_QUERY"\n}\n');
  const result = buildRepositoryIndex(root);
  assert.deepEqual(result.level1.configurations[0].facts.moduleSources, ['git::https://example.invalid/repo.git']);
  assert.doesNotMatch(JSON.stringify(result), /FAKE_SECRET|FAKE_QUERY/);
});
