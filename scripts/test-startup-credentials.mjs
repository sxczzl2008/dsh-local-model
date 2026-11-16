import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

// Narrow offline wire test. Only compiled library files are read from app.asar.
// No DSH application, production profile, real session, or network server starts.
const here = path.dirname(fileURLToPath(import.meta.url));
const revisionRoot = path.resolve(here, '..');
const option = (flag, fallback) => { const index = process.argv.indexOf(flag); return index < 0 ? fallback : process.argv[index + 1]; };
const defaultAsar = ['ProgramFiles', 'LOCALAPPDATA']
  .map(k => process.env[k] ? path.join(process.env[k], k === 'LOCALAPPDATA' ? 'Programs/DeepSeek Harness/resources/app.asar' : 'DeepSeek Harness/resources/app.asar') : '')
  .find(p => p && fs.existsSync(p)) || 'resources/app.asar';
const asarPath = path.resolve(option('--asar', defaultAsar));
const pluginPath = path.resolve(option('--plugin', path.join(revisionRoot, 'lib', 'index.mjs')));
const baselineRoot = path.resolve(option('--baseline-root', path.join(revisionRoot, '..', '..', 'baseline', 'dsh-local-model')));
const outputBase = path.resolve(option('--output-root', os.tmpdir()));
fs.mkdirSync(outputBase, { recursive: true });
const outputRoot = fs.mkdtempSync(path.join(outputBase, 'startup-credentials-'));
process.env.DSH_HOME = path.join(outputRoot, 'synthetic-home');
process.env.DSH_TELEMETRY_DISABLED = '1';
fs.mkdirSync(process.env.DSH_HOME);
const evidence = { scope: 'Offline actual installed Cordis, LLM and PiAi adapter, synthetic credential file and transport capture; no app launched.', outputRoot,
  asarPath, pluginPath, tests: [], captures: [], moduleFiles: [], externalNetworkAttempts: 0, interceptedFetchCalls: 0 };
const writeEvidence = () => fs.writeFileSync(path.join(outputRoot, 'evidence.json'), JSON.stringify(evidence, null, 2));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const rejectNetwork = () => { evidence.externalNetworkAttempts++; throw new Error('NETWORK_FORBIDDEN'); };
http.request = rejectNetwork; http.get = rejectNetwork;
https.request = rejectNetwork; https.get = rejectNetwork;
net.connect = rejectNetwork; net.createConnection = rejectNetwork;
net.Socket.prototype.connect = rejectNetwork; tls.connect = rejectNetwork;
globalThis.fetch = rejectNetwork;

// Extract the exact static import closure, preserving every source byte and its
// package manifest. This is library loading, not an alternative serializer.
const archiveBytes = fs.readFileSync(asarPath);
const archiveHeader = JSON.parse(archiveBytes.subarray(16, 16 + archiveBytes.readUInt32LE(12)));
const archiveBase = 8 + archiveBytes.readUInt32LE(4);
const archiveNode = name => name.split('/').reduce((node, key) => node?.files?.[key], archiveHeader);
const archiveRead = name => {
  const node = archiveNode(name);
  if (!node || node.files || node.link) throw new Error('Expected installed library file: ' + name);
  if (node.unpacked) {
    const bytes = fs.readFileSync(path.join(asarPath + '.unpacked', name));
    assert.equal(sha(bytes), node.integrity.hash, 'Unpacked library bytes must match ASAR integrity');
    return bytes;
  }
  return archiveBytes.subarray(archiveBase + Number(node.offset), archiveBase + Number(node.offset) + node.size);
};
const packagePrefix = 'dsh/node_modules/';
const libraryRoot = path.join(outputRoot, 'actual-library');
const copied = new Set(); const manifests = new Map();
const builtins = new Set([...builtinModules, ...builtinModules.map(name => 'node:' + name)]);
function packageName(specifier) { return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]; }
function chooseTarget(value, mode) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => chooseTarget(item, mode)).find(Boolean);
  if (value && typeof value === 'object') for (const condition of ['node', mode, 'default']) {
    const chosen = chooseTarget(value[condition], mode); if (chosen) return chosen;
  }
}
function manifest(name, packageRoot = packagePrefix + name) {
  if (!manifests.has(packageRoot)) {
    const file = packageRoot + '/package.json';
    const value = JSON.parse(archiveRead(file).toString('utf8')); manifests.set(packageRoot, value); copy(file);
  }
  return manifests.get(packageRoot);
}
function existingFile(file) {
  for (const candidate of [file, file + '.js', file + '.mjs', file + '.cjs', file + '.json', file + '/index.js']) {
    const node = archiveNode(candidate); if (node && !node.files) return candidate;
  }
  throw new Error('Cannot resolve static library import: ' + file);
}
function resolveSpecifier(specifier, from, mode = 'import') {
  if (builtins.has(specifier) || specifier.startsWith('node:')) return null;
  if (specifier.startsWith('.')) return existingFile(path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)));
  if (specifier.startsWith('/')) throw new Error('Unexpected absolute library import: ' + specifier);
  const name = packageName(specifier);
  let packageRoot;
  for (let dir = path.posix.dirname(from); dir.startsWith('dsh'); dir = path.posix.dirname(dir)) {
    const candidate = path.posix.join(dir, 'node_modules', name);
    if (archiveNode(candidate + '/package.json')) { packageRoot = candidate; break; }
    if (dir === 'dsh') break;
  }
  // Absent optional CommonJS dependencies (e.g. debug's supports-color) are
  // guarded by their upstream try/catch and remain absent in the isolated copy.
  if (!packageRoot && mode === 'require') return null;
  packageRoot ??= packagePrefix + name;
  const meta = manifest(name, packageRoot);
  const subpath = specifier.slice(name.length); const key = subpath ? '.' + subpath : '.';
  let target = chooseTarget(meta.exports?.[key] ?? (key === '.' && typeof meta.exports === 'string' ? meta.exports : undefined), mode);
  if (!target && meta.exports && typeof meta.exports === 'object') for (const [pattern, value] of Object.entries(meta.exports)) {
    if (!pattern.includes('*')) continue;
    const [prefix, suffix] = pattern.split('*');
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      const matched = key.slice(prefix.length, suffix.length ? -suffix.length : undefined);
      target = chooseTarget(value, mode)?.replaceAll('*', matched); if (target) break;
    }
  }
  if (!target && key === '.' && meta.exports && !Object.keys(meta.exports).some(key => key.startsWith('.'))) target = chooseTarget(meta.exports, mode);
  target ??= subpath ? subpath.slice(1) : (mode === 'import' && meta.module || meta.main || 'index.js');
  return existingFile(path.posix.join(packageRoot, target));
}
function copy(file) {
  if (copied.has(file)) return;
  assert.ok(file.startsWith(packagePrefix), 'Only installed module-library files may be extracted'); copied.add(file);
  const bytes = archiveRead(file); const target = path.join(libraryRoot, file.slice('dsh/'.length));
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  evidence.moduleFiles.push({ source: file, sha256: sha(bytes), bytes: bytes.length });
  if (!/\.(?:mjs|cjs|js)$/.test(file)) return;
  const text = bytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [expression, mode] of [[/\b(?:import|export)\s+(?:[\w*$][^;]*?|\{[^}]*\})\s+from\s*["']([^"']+)["']/g, 'import'], [/\bimport\s*["']([^"']+)["']/g, 'import'], [/\bimport\s*\(\s*["']([^"']+)["']/g, 'import'], [/\brequire\s*\(\s*["']([^"']+)["']/g, 'require']]) {
    for (const match of text.matchAll(expression)) { let resolved; try { resolved = resolveSpecifier(match[1], file, mode); } catch (error) { throw new Error(error.message + ' from ' + file + ' (' + mode + ' ' + match[1] + ')'); } if (resolved) copy(resolved); }
  }
}
function libraryEntry(name) { const file = resolveSpecifier(name, packagePrefix + '_entry.js'); copy(file); return pathToFileURL(path.join(libraryRoot, file.slice('dsh/'.length))).href; }

const roots = [];
const fixtureModel = 'synthetic-model';
let transportCapture = null;
// A transport capture observes the installed protocol's final serialized request.
// It refuses before DNS/socket work and records only whether the placeholder
// matched, never an Authorization value or credential record.
globalThis.fetch = async (url, options = {}) => {
  evidence.interceptedFetchCalls++;
  assert.ok(transportCapture, 'Fetch outside a deliberately captured request');
  const request = url instanceof Request ? url : null;
  const address = String(request?.url ?? url);
  assert.equal(new URL(address).origin, 'http://127.0.0.1:19871');
  const headers = new Headers(options.headers ?? request?.headers);
  const body = typeof options.body === 'string' ? options.body : request ? await request.clone().text() : '';
  assert.ok(body, 'Installed protocol must produce serialized JSON');
  const parsed = JSON.parse(body);
  transportCapture.push({ url: address, authorizationUsesLocalPlaceholder: headers.get('authorization') === 'Bearer local',
    modelMatches: parsed.model === fixtureModel, purpose: 'dsh-cabinet-seat', serializedBodyBytes: Buffer.byteLength(body) });
  throw Object.assign(new Error('CAPTURED_BEFORE_NETWORK'), { code: 'CAPTURED_BEFORE_NETWORK' });
};

try {
  const [{ Context }, { LlmRuntime }, pi, { LocalCredentialProvider }, plugin, credentialHelper, { StrataController }] = await Promise.all([
    import(libraryEntry('@deepseek-ai/cordis')), import(libraryEntry('@deepseek-ai/dsh-llm')),
    import(libraryEntry('@deepseek-ai/dsh-llm-pi-ai')), import(libraryEntry('@deepseek-ai/dsh-credentials-local')),
    import(pathToFileURL(pluginPath).href), import(pathToFileURL(path.join(path.dirname(pluginPath), 'provider-credentials.mjs')).href),
    import(pathToFileURL(path.join(path.dirname(pluginPath), 'strata-controller.mjs')).href)
  ]);
  assert.equal(typeof credentialHelper.reconcileManagedCredentials, 'function');
  evidence.realModuleVersions = Object.fromEntries([...manifests].filter(([, meta]) => meta.name.startsWith('@deepseek-ai/')).map(([, meta]) => [meta.name, meta.version]));
  evidence.pluginSha256 = sha(fs.readFileSync(pluginPath));
  const providerProfile = (baseURL, extra = {}) => ({ api: 'openai-completions', baseURL,
    models: [{ id: fixtureModel, name: fixtureModel, contextWindow: 16384, maxTokens: 1024, input: ['text'] }], retryPolicy: { mode: 'normal', maxRetries: 0 }, ...extra });
  const localEndpoint = 'http://127.0.0.1:19871/v1';
  function controller(profiles) { return { getEnv: () => ({ compatible: true }), discoverModels: () => profiles.map(item => ({ ...item })) }; }
  async function fixture(label, { profiles, inherited = profiles, user = {}, seeds = [], refs = [], mountPi = true } = {}) {
    const ctx = new Context(); roots.push(ctx);
    const home = path.join(outputRoot, label); fs.mkdirSync(home, { recursive: true });
    const descriptors = [{ ns: 'llm-pi-ai', value: { providers: profiles }, base: { providers: inherited }, user: { providers: user } }];
    // The read-only seam models actual SettingsForms.describe().value, whose
    // installed source projects entry.fiber.effectiveConfig (all active layers).
    const settings = { configure: () => () => {}, describe: () => descriptors };
    ctx.provide('settings', settings);
    const credentialsFiber = ctx.plugin(LocalCredentialProvider, { path: path.join(home, '.credentials.yaml'), watch: false }); await credentialsFiber.await();
    const llmFiber = ctx.plugin(LlmRuntime); await llmFiber.await();
    for (const [key, record] of seeds) await ctx.credentials.modifyRecord(key, async () => structuredClone(record));
    for (const [ref, value] of refs) await ctx.credentials.set(ref, value);
    const writes = []; const calls = []; const referenceWrites = []; const originalModify = ctx.credentials.modifyRecord.bind(ctx.credentials);
    const originalSet = ctx.credentials.set.bind(ctx.credentials);
    ctx.credentials.set = async (ref, value) => { referenceWrites.push(ref); return originalSet(ref, value); };
    ctx.credentials.modifyRecord = async (key, mutate) => {
      calls.push(key);
      return originalModify(key, async current => { const next = await mutate(current); if (next !== undefined && JSON.stringify(next) !== JSON.stringify(current)) writes.push(key); return next; });
    };
    let piFiber;
    async function mount() { piFiber = ctx.plugin(pi, { providers: profiles }); await piFiber.await(); return piFiber; }
    if (mountPi) await mount();
    return { ctx, settings, writes, calls, referenceWrites, home, descriptors, mount, credentialsFiber, get piFiber() { return piFiber; } };
  }
  async function check(name, run) { await run(); evidence.tests.push({ name, ok: true }); writeEvidence(); }
  async function reconcile(f, discovered) { await credentialHelper.reconcileManagedCredentials(controller(discovered), { llm: f.ctx.llm, credentials: f.ctx.credentials, settings: f.settings }); }
  function mountHost(f, discovered) {
    const result = {};
    result.owner = f.ctx.plugin({ name: 'synthetic-local-model-owner', apply(scoped) {
      // Avoid probing the machine's Strata installation in this library test.
      const getEnv = StrataController.prototype.getEnv;
      try {
        StrataController.prototype.getEnv = () => ({ compatible: false });
        result.host = new plugin.LocalModelControlHost(scoped, { dataRoot: path.join(f.home, 'plugin-data') });
        result.host.controller = controller(discovered);
      } finally { StrataController.prototype.getEnv = getEnv; }
    } });
    return result;
  }
  async function settleHost(handle) { await handle.owner.await(); await Promise.resolve(); await handle.host.credentialCheck; }
  async function firstSeat(f, label, provider = 'owned-alpha') {
    const captures = []; transportCapture = captures; let diagnostic = '';
    try {
      const prepared = await f.ctx.llm.prepareCall({ provider, model: fixtureModel, maxTokens: 128, purpose: 'dsh-cabinet-seat' });
      for await (const _chunk of prepared.stream({ ...prepared.config, sessionId: 'synthetic-cabinet-seat', purpose: 'dsh-cabinet-seat',
        messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic credential seam check' }] }], toolHistory: [] })) {
        if (_chunk.type === 'finish' && _chunk.reason?.kind === 'error') diagnostic = _chunk.reason.failure?.message ?? '';
      }
    } catch (error) { diagnostic = error.message; /* expected transport refusal */ }
    finally { transportCapture = null; }
    if (label.startsWith('before-repair')) {
      evidence.nativeCredentialFailure = { noApiKeyErrorObserved: /No API key for provider|not configured|no credential/i.test(diagnostic), noTransport: captures.length === 0 };
      assert.equal(evidence.nativeCredentialFailure.noApiKeyErrorObserved, true, 'Installed adapter must diagnose absent provider authentication');
    }
    assert.equal(captures.length, 1, 'First seat must reach one installed protocol request');
    assert.equal(captures[0].authorizationUsesLocalPlaceholder, true);
    assert.equal(captures[0].modelMatches, true);
    evidence.captures.push({ label, ...captures[0] });
  }
  const discoveredAlpha = { key: 'alpha', provider: 'owned-alpha', model: fixtureModel, endpoint: localEndpoint };
  // Reproduce the old plugin's exact legacy inline placeholder field. The
  // installed adapter accepts it as unknown config but authenticates from its
  // credential seam instead, so this is not a failure induced by omitting it.
  const cold = await fixture('cold-start', { profiles: { 'owned-alpha': providerProfile(localEndpoint, { apiKey: 'local-strata' }) } });
  let coldHost;
  await check('cold start reproduces missing-record failure before repair', async () => {
    await assert.rejects(() => firstSeat(cold, 'before-repair'), /First seat must reach/);
    assert.deepEqual(cold.writes, []);
  });
  await check('cold start fills only missing managed record and first local seat resolves placeholder', async () => {
    coldHost = mountHost(cold, [discoveredAlpha]); await settleHost(coldHost);
    assert.deepEqual(cold.writes, ['llm-pi-ai/owned-alpha']);
    assert.deepEqual(await cold.ctx.credentials.readRecord('llm-pi-ai/owned-alpha'), { kind: 'api-key', key: 'local' });
    await firstSeat(cold, 'first-local-seat-after-cold-start');
  });
  await check('repeated start is silent and performs no credential write', async () => {
    const credentialFile = path.join(cold.home, '.credentials.yaml');
    const before = fs.readFileSync(credentialFile); const mtime = fs.statSync(credentialFile).mtimeMs;
    const calls = cold.calls.length; const writes = cold.writes.length;
    cold.ctx.emit('llm/models-updated', 'owned-alpha'); await coldHost.host.credentialCheck;
    cold.ctx.emit('llm/adapters-updated'); await coldHost.host.credentialCheck;
    assert.equal(cold.calls.length, calls); assert.equal(cold.writes.length, writes);
    assert.deepEqual(fs.readFileSync(credentialFile), before); assert.equal(fs.statSync(credentialFile).mtimeMs, mtime);
  });
  await check('first startup after update repairs a new provider without replacing existing/cloud records', async () => {
    const existing = { kind: 'api-key', key: 'SYNTHETIC-EXISTING-PLACEHOLDER' };
    const grant = { kind: 'grant', payload: { type: 'synthetic', marker: 'PRESERVE-GRANT' } };
    const cloud = { kind: 'api-key', key: 'SYNTHETIC-CLOUD-PLACEHOLDER' };
    const f = await fixture('update-first-start', { profiles: { 'owned-alpha': providerProfile(localEndpoint), 'owned-existing': providerProfile('http://localhost:19872/v1'),
      'owned-grant': providerProfile('http://127.0.0.1:19873/v1'), 'cloud-local': providerProfile('https://synthetic-cloud.invalid/v1') },
      seeds: [['llm-pi-ai/owned-existing', existing], ['llm-pi-ai/owned-grant', grant], ['llm-pi-ai/cloud-local', cloud]] });
    const managed = [discoveredAlpha, { key: 'existing', provider: 'owned-existing', model: fixtureModel, endpoint: 'http://localhost:19872/v1' },
      { key: 'grant', provider: 'owned-grant', model: fixtureModel, endpoint: 'http://127.0.0.1:19873/v1' }];
    const mounted = mountHost(f, managed); await settleHost(mounted); assert.deepEqual(f.writes, ['llm-pi-ai/owned-alpha']);
    assert.deepEqual(await f.ctx.credentials.readRecord('llm-pi-ai/owned-existing'), existing);
    assert.deepEqual(await f.ctx.credentials.readRecord('llm-pi-ai/owned-grant'), grant);
    assert.deepEqual(await f.ctx.credentials.readRecord('llm-pi-ai/cloud-local'), cloud);
    await firstSeat(f, 'first-local-seat-after-update');
    await f.piFiber.dispose(); await f.mount(); const writes = f.writes.length;
    await mounted.host.credentialCheck; assert.equal(f.writes.length, writes); await firstSeat(f, 'first-seat-after-provider-rebuild');
  });
  await check('effective endpoint, explicit credential reference, unknown ownership and model mismatch never write', async () => {
    const f = await fixture('negative-boundaries', { profiles: {
      'owned-alpha': providerProfile('https://synthetic-override.invalid/v1'),
      'owned-reference': providerProfile('http://127.0.0.1:19874/v1', { apiKeyEnv: 'SYNTHETIC_REFERENCE' }),
      'not-discovered-local': providerProfile('http://127.0.0.1:19875/v1'),
      'owned-remote': providerProfile('http://synthetic-remote.invalid:19876/v1'),
      'owned-mismatch': providerProfile('http://127.0.0.1:19877/v1') }, inherited: { 'owned-alpha': providerProfile(localEndpoint) } });
    await reconcile(f, [discoveredAlpha,
      { key: 'reference', provider: 'owned-reference', model: fixtureModel, endpoint: 'http://127.0.0.1:19874/v1' },
      { key: 'remote', provider: 'owned-remote', model: fixtureModel, endpoint: 'http://synthetic-remote.invalid:19876/v1' },
      { key: 'mismatch', provider: 'owned-mismatch', model: 'not-in-catalog', endpoint: 'http://127.0.0.1:19877/v1' }]);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []); assert.deepEqual(await f.ctx.credentials.listRecords(), []);
  });
  await check('services may precede model registration and a later catalogue becomes repairable', async () => {
    const f = await fixture('late-catalog', { profiles: { 'owned-alpha': providerProfile(localEndpoint) }, mountPi: false });
    const mounted = mountHost(f, [discoveredAlpha]); await settleHost(mounted); assert.deepEqual(f.writes, []);
    await f.mount(); await mounted.host.credentialCheck; assert.deepEqual(f.writes, ['llm-pi-ai/owned-alpha']);
  });
  await check('unload during an awaited catalogue read prevents a later credential write', async () => {
    const f = await fixture('unload-race', { profiles: { 'owned-alpha': providerProfile(localEndpoint) } });
    let release, started; const blocked = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { started = resolve; });
    const listModels = f.ctx.llm.listModels.bind(f.ctx.llm);
    f.ctx.llm.listModels = async (...args) => { started(); await blocked; return listModels(...args); };
    const mounted = mountHost(f, [discoveredAlpha]);
    await entered; const disposing = mounted.owner.dispose(); await new Promise(resolve => setImmediate(resolve));
    evidence.unloadStateBeforeRelease = { ownerUid: mounted.owner.uid, ownerState: mounted.owner.state, hostUid: mounted.host.ctx.fiber.uid, hostState: mounted.host.ctx.fiber.state };
    release(); await disposing; await mounted.host.credentialCheck;
    assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, []);
  });
  await check('profile sync preserves unmarked same-name and unknown suffix blocks and does not rewrite repeats', async () => {
    const profileDir = path.join(process.env.DSH_HOME, 'profiles', 'desktop'); fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    const unmarked = '- id: unrelated\n  name: synthetic-other-plugin\n  config:\n    providers:\n      untouched: keep\n- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers:\n      owned-alpha:\n        apiKey: local-strata\n        baseURL: http://127.0.0.1:19871/v1\n      unrelated-local:\n        apiKey: local-strata\n        baseURL: https://synthetic-cloud.invalid/v1\n';
    fs.writeFileSync(patchFile, unmarked);
    const c = controller([discoveredAlpha]);
    c.readModelSnapshot = async () => ({ profile: { ...discoveredAlpha, label: 'synthetic alpha' }, saved: { contextWindow: 16384, maxTokens: 1024 } });
    const mtime = fs.statSync(patchFile).mtimeMs; await plugin.syncLocalProvidersToPatch(c);
    assert.equal(fs.readFileSync(patchFile, 'utf8'), unmarked); assert.equal(fs.statSync(patchFile).mtimeMs, mtime);
    fs.writeFileSync(patchFile, '- id: unrelated\n  name: synthetic-other-plugin\n  config:\n    providers:\n      untouched: keep\n- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers:\n      unrelated-local:\n        baseURL: https://synthetic-cloud.invalid/v1\n');
    await plugin.syncLocalProvidersToPatch(c); const generated = fs.readFileSync(patchFile, 'utf8');
    assert.ok(generated.includes('# >>> dsh-local-model providers >>>')); assert.ok(!generated.includes('apiKey:'));
    assert.ok(generated.includes('      unrelated-local:\n        baseURL: https://synthetic-cloud.invalid/v1'));
    assert.equal(generated.split('- id: llm-pi-ai')[0].includes('owned-alpha:'), false);
    const generatedMtime = fs.statSync(patchFile).mtimeMs; await plugin.syncLocalProvidersToPatch(c);
    assert.equal(fs.readFileSync(patchFile, 'utf8'), generated); assert.equal(fs.statSync(patchFile).mtimeMs, generatedMtime);
  });
  const budgetPatchFile = path.join(process.env.DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
  const legacyBudgetBlock = '- id: llm-pi-ai\r\n  name: "@deepseek-ai/dsh-llm-pi-ai"\r\n  config:\r\n    providers:\r\n      owned-alpha:\r\n        apiKey: SYNTHETIC-PRESERVE-INLINE\r\n        apiKeyEnv: SYNTHETIC_PRESERVE_REF\r\n        api: openai-completions\r\n        baseURL: http://127.0.0.1:19871/v1\r\n        displayName: "Preserve this label"\r\n        models:\r\n          - id: synthetic-model\r\n            name: "Preserve model label"\r\n            contextWindow: 8192 # preserve window annotation\r\n            maxTokens: 512 # preserve output annotation\r\n            input:\r\n              - text\r\n          - id: unrelated-model\r\n            contextWindow: 9999\r\n            maxTokens: 999\r\n      unrelated-local:\r\n        apiKey: local-strata\r\n        baseURL: https://synthetic-cloud.invalid/v1\r\n';
  const budgetController = controller([discoveredAlpha]);
  budgetController.readModelSnapshot = async () => ({ profile: { ...discoveredAlpha, label: 'synthetic alpha' }, saved: { contextWindow: 16384, maxTokens: 1024 } });
  await check('legacy exact local model keeps parameter-save budget synchronization', async () => {
    fs.writeFileSync(budgetPatchFile, legacyBudgetBlock); await plugin.syncLocalProvidersToPatch(budgetController);
    assert.equal(fs.readFileSync(budgetPatchFile, 'utf8'), legacyBudgetBlock.replace('contextWindow: 8192', 'contextWindow: 16384').replace('maxTokens: 512', 'maxTokens: 1024'));
  });
  await check('legacy budget maintenance preserves credential spelling and every unrelated byte', async () => {
    const updated = fs.readFileSync(budgetPatchFile, 'utf8');
    const restored = updated.replace('contextWindow: 16384', 'contextWindow: 8192').replace('maxTokens: 1024', 'maxTokens: 512');
    assert.equal(restored, legacyBudgetBlock); assert.equal(updated.includes('# >>> dsh-local-model providers >>>'), false);
    const mtime = fs.statSync(budgetPatchFile).mtimeMs; await plugin.syncLocalProvidersToPatch(budgetController);
    assert.equal(fs.readFileSync(budgetPatchFile, 'utf8'), updated); assert.equal(fs.statSync(budgetPatchFile).mtimeMs, mtime);
  });
  await check('legacy endpoint, model or duplicate identity ambiguity never changes the patch', async () => {
    for (const text of [legacyBudgetBlock.replace('baseURL: http://127.0.0.1:19871/v1', 'baseURL: https://synthetic-cloud.invalid/v1'),
      legacyBudgetBlock.replace('- id: synthetic-model', '- id: different-model'),
      legacyBudgetBlock.replace('          - id: unrelated-model', '          - id: synthetic-model')]) {
      fs.writeFileSync(budgetPatchFile, text); const mtime = fs.statSync(budgetPatchFile).mtimeMs;
      await plugin.syncLocalProvidersToPatch(budgetController);
      assert.equal(fs.readFileSync(budgetPatchFile, 'utf8'), text); assert.equal(fs.statSync(budgetPatchFile).mtimeMs, mtime);
    }
  });
  await check('old sync drops an existing credential reference while the new sync preserves the working first request without writes', async () => {
    const baselinePath = path.join(baselineRoot, 'lib', 'index.mjs');
    const [baseline, yaml] = await Promise.all([import(pathToFileURL(baselinePath).href), import(libraryEntry('yaml'))]);
    const provider = 'owned-alpha-local', ref = 'SYNTHETIC_STRATA_AUTH';
    const original = '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers:\n      owned-alpha-local:\n        apiKey: local-strata\n        apiKeyEnv: SYNTHETIC_STRATA_AUTH\n        api: openai-completions\n        baseURL: http://127.0.0.1:19871/v1\n        models:\n          - id: synthetic-model\n            name: synthetic-model\n            contextWindow: 16384\n            maxTokens: 1024\n            input:\n              - text\n';
    const managed = { ...discoveredAlpha, provider };
    const c = controller([managed]); c.readModelSnapshot = async () => ({ profile: { ...managed, label: 'synthetic-model' }, saved: { contextWindow: 16384, maxTokens: 1024 } });
    const parseProfiles = text => yaml.parse(text).find(entry => entry.id === 'llm-pi-ai').config.providers;
    fs.writeFileSync(budgetPatchFile, original); await baseline.syncLocalProvidersToPatch(c);
    const afterOld = fs.readFileSync(budgetPatchFile, 'utf8');
    assert.equal(afterOld.includes('apiKeyEnv:'), false);
    const oldHost = await fixture('legacy-sync-broken-reference', { profiles: parseProfiles(afterOld), refs: [[ref, 'local']] });
    assert.equal((await oldHost.ctx.credentials.resolve(ref))?.value === 'local', true);
    await assert.rejects(() => firstSeat(oldHost, 'before-repair-old-sync-reference-loss', provider), /First seat must reach/);
    fs.writeFileSync(budgetPatchFile, original); await plugin.syncLocalProvidersToPatch(c);
    const afterNew = fs.readFileSync(budgetPatchFile, 'utf8');
    assert.equal(afterNew, original);
    const newHost = await fixture('legacy-sync-preserved-reference', { profiles: parseProfiles(afterNew), refs: [[ref, 'local']] });
    const mounted = mountHost(newHost, [managed]); await settleHost(mounted);
    assert.deepEqual(newHost.calls, []); assert.deepEqual(newHost.writes, []); assert.deepEqual(newHost.referenceWrites, []);
    await firstSeat(newHost, 'first-seat-preserved-existing-reference', provider);
    evidence.referenceHandoffMechanism = { baselineSha256: sha(fs.readFileSync(baselinePath)),
      oldSyncRemovedReference: true, persistedReferenceStillPresent: true, oldRouteMissingAuthentication: true,
      newSyncPreservedReferenceByteForByte: true, newHostCredentialWrites: 0, newFirstRequestUsesLocalPlaceholder: true };
  });
  await check('both plugins load in one isolated actual Cordis context without a model conversation', async () => {
    const cabinetPath = path.resolve(revisionRoot, '..', 'dsh-cabinet', 'lib', 'index.mjs');
    const cabinet = await import(pathToFileURL(cabinetPath).href);
    const f = await fixture('joint-plugin-load', { profiles: { 'owned-alpha': providerProfile(localEndpoint) } });
    const routes = [];
    f.ctx.provide('webServer', { register: route => { routes.push({ path: route.path, kind: route.kind }); } });
    f.ctx.provide('sessions', new Map()); f.ctx.provide('agents', new Map());
    f.ctx.provide('sessionController', { resolveAgent: async () => { throw new Error('No conversation is authorized in this joint-load test'); } });
    f.ctx.provide('sessionQuery', {});
    const fetchesBefore = evidence.interceptedFetchCalls;
    const local = mountHost(f, [discoveredAlpha]); await settleHost(local);
    const cabinetFiber = f.ctx.plugin(cabinet.default, { dataRoot: path.join(f.home, 'cabinet-data') }); await cabinetFiber.await();
    const mountedCabinet = f.ctx.get('cabinetV2'); assert.ok(mountedCabinet instanceof cabinet.CabinetV2);
    const catalog = await mountedCabinet.catalog.getCatalog();
    assert.ok(catalog.models.some(model => model.providerId === 'owned-alpha' && model.modelId === fixtureModel));
    assert.deepEqual(routes.map(route => route.path).sort(), ['/cabinet-v2', '/cabinet-v2/events', '/dsh-local-model']);
    assert.equal(evidence.interceptedFetchCalls, fetchesBefore);
    evidence.jointLoading = { cabinetDataRoot: mountedCabinet.dataRoot, routes, catalogModels: catalog.models.length,
      noConversationSubmitted: true, noInferenceRequests: evidence.interceptedFetchCalls === fetchesBefore,
      cabinetSourceSha256: Object.fromEntries(['index.mjs', 'orchestrator.mjs', 'llm-bridge.mjs', 'main-context.mjs', 'session-manager.mjs']
        .map(name => [name, sha(fs.readFileSync(path.join(path.dirname(cabinetPath), name)))])) };
    await cabinetFiber.dispose(); await local.owner.dispose();
    assert.equal(f.ctx.get('cabinetV2'), undefined); assert.equal(mountedCabinet.shuttingDown, true); assert.equal(mountedCabinet.llmBridge.disposed, true);
  });
  assert.equal(evidence.externalNetworkAttempts, 0);
  evidence.ok = true; writeEvidence();
  console.log(JSON.stringify({ ok: true, tests: evidence.tests.length, externalNetworkAttempts: 0, evidence: path.join(outputRoot, 'evidence.json') }, null, 2));
} catch (error) {
  evidence.ok = false; evidence.failure = { name: error.name, message: error.message, stack: error.stack }; writeEvidence();
  console.error(JSON.stringify({ ok: false, error: error.message, evidence: path.join(outputRoot, 'evidence.json') }, null, 2)); process.exitCode = 1;
} finally {
  for (const ctx of roots.reverse()) { try { await ctx.fiber.dispose(); } catch {} }
}

