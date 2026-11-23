import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePluginConfig } from './env-check.mjs';
import { StrataController } from './strata-controller.mjs';
import { reconcileManagedCredentials } from './provider-credentials.mjs';

export const name = 'dsh-local-model';

function resolveProfilePatchPath() {
  const baseHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(baseHome, 'profiles/desktop/cordis.patch.yml');
}

function loopbackEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

// Legacy unmarked declarations cannot be replaced as owned blocks. Preserve
// their spelling and every non-budget field, updating only an unambiguous
// discovered Strata model's two existing save controls.
function syncUnmarkedBudgets(text, snapshot, discovered) {
  const { profile, saved } = snapshot;
  const endpoint = loopbackEndpoint(profile.endpoint);
  if (!endpoint || !/^[a-z][a-z0-9-]*$/.test(profile.provider)
    || !discovered.some(model => model.provider === profile.provider && model.model === profile.model
      && loopbackEndpoint(model.endpoint) === endpoint)
    || !Number.isSafeInteger(saved.contextWindow) || !Number.isSafeInteger(saved.maxTokens)
    || saved.contextWindow <= saved.maxTokens || saved.maxTokens < 1) return text;
  const scalar = raw => {
    const value = raw.trim();
    try {
      if (value.startsWith('"')) return JSON.parse(value);
      if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
      if (/^[^\s'"\[\]{},&*!|>#%][^#\r\n]*$/.test(value)) return value;
    } catch {}
    return null;
  };
  const header = new RegExp(`^ {6}${profile.provider}:[ \\t]*(?:\\r?\\n|$)`, 'gm');
  const matches = [...text.matchAll(header)];
  if (matches.length !== 1) return text;
  const start = matches[0].index;
  const rest = text.slice(start + matches[0][0].length);
  const boundary = rest.search(/^ {0,6}\S/m);
  const end = boundary < 0 ? text.length : start + matches[0][0].length + boundary;
  const block = text.slice(start, end);
  const fields = key => [...block.matchAll(new RegExp(`^ {8}${key}:[ \\t]*([^\\r\\n]*)(?:\\r?\\n|$)`, 'gm'))];
  const apis = fields('api'), endpoints = fields('baseURL'), modelLists = fields('models');
  if (apis.length !== 1 || scalar(apis[0][1]) !== 'openai-completions'
    || endpoints.length !== 1 || loopbackEndpoint(scalar(endpoints[0][1])) !== endpoint
    || modelLists.length !== 1 || modelLists[0][1].trim() || /^ {8}<<:/m.test(block)) return text;
  const modelHeads = [...block.matchAll(/^ {10}- id:[ \t]*([^\r\n]*)(?:\r?\n|$)/gm)];
  const target = modelHeads.filter(match => scalar(match[1]) === profile.model);
  if (target.length !== 1) return text;
  const modelStart = target[0].index;
  const modelRest = block.slice(modelStart + target[0][0].length);
  const modelBoundary = modelRest.search(/^ {0,10}\S/m);
  const modelEnd = modelBoundary < 0 ? block.length : modelStart + target[0][0].length + modelBoundary;
  let modelText = block.slice(modelStart, modelEnd);
  if (/^ {12}<<:/m.test(modelText)) return text;
  for (const key of ['contextWindow', 'maxTokens']) {
    const all = [...modelText.matchAll(new RegExp(`^ {12}${key}:`, 'gm'))];
    const numeric = new RegExp(`(^ {12}${key}:[ \\t]*)([0-9]+)([ \\t]*(?:#.*)?)(\\r?\\n|$)`, 'm');
    if (all.length > 1 || (all.length === 1 && !numeric.test(modelText))) return text;
  }
  const newline = block.includes('\r\n') ? '\r\n' : '\n';
  for (const key of ['contextWindow', 'maxTokens']) {
    const numeric = new RegExp(`(^ {12}${key}:[ \\t]*)([0-9]+)([ \\t]*(?:#.*)?)(\\r?\\n|$)`, 'm');
    if (numeric.test(modelText)) modelText = modelText.replace(numeric, (_all, prefix, _old, suffix, ending) => `${prefix}${saved[key]}${suffix}${ending}`);
    else modelText += `${modelText.endsWith('\n') ? '' : newline}            ${key}: ${saved[key]}${newline}`;
  }
  const updated = block.slice(0, modelStart) + modelText + block.slice(modelEnd);
  return text.slice(0, start) + updated + text.slice(end);
}

export async function syncLocalProvidersToPatch(controller) {
  try {
    const patchFile = resolveProfilePatchPath();
    if (!fs.existsSync(patchFile)) return false;

    const env = controller.getEnv();
    const discovered = env.compatible ? controller.discoverModels() : [];
    const snapshots = await Promise.all(discovered.map(m => controller.readModelSnapshot(m.key)));

    const originalText = fs.readFileSync(patchFile, 'utf8');
    const start = originalText.search(/^- id: llm-pi-ai\s*$/m);
    if (start < 0) return false;
    const following = originalText.indexOf('\n- id:', start);
    const end = following < 0 ? originalText.length : following;
    let text = originalText.slice(start, end);
    if (!/^  name: ["']?@deepseek-ai\/dsh-llm-pi-ai["']?\s*$/m.test(text)) return false;
    const writeChanged = () => {
      const next = originalText.slice(0, start) + text + originalText.slice(end);
      if (next !== originalText) fs.writeFileSync(patchFile, next, 'utf8');
    };
    // Only this plugin's explicit managed block belongs to it.
    text = text.replace(/\r?\n {6}# >>> dsh-local-model providers >>>[\s\S]*?# <<< dsh-local-model providers <<</g, '');

    if (!env.compatible || snapshots.length === 0) {
      writeChanged();
      return true;
    }

    for (const snapshot of snapshots.filter(s => s.profile && s.saved)) text = syncUnmarkedBudgets(text, snapshot, discovered);
    // An existing declaration is never replaced wholesale or adopted into the
    // marker block. Exact local identity permits only the budget edits above.
    const existingProviders = new Set([...text.matchAll(/^ {6}([a-zA-Z0-9_-]+):\s*$/gm)].map(match => match[1]));
    const blocks = snapshots.filter(s => s.profile && s.saved && !existingProviders.has(s.profile.provider)).map(s => [
      `      ${s.profile.provider}:`,
      `        api: openai-completions`,
      `        baseURL: ${s.profile.endpoint}`,
      `        models:`,
      `          - id: ${s.profile.model}`,
      `            name: ${JSON.stringify(s.profile.label)}`,
      `            contextWindow: ${s.saved.contextWindow}`,
      `            maxTokens: ${s.saved.maxTokens}`,
      `            input:`,
      `              - text`,
      ...(s.profile.hasVision ? ['              - image'] : [])
    ].join('\n'));

    const managedSection = blocks.length ? [
      '      # >>> dsh-local-model providers >>>',
      ...blocks,
      '      # <<< dsh-local-model providers <<<'
    ].join('\n') : '';

    if (text.includes('  config:\n    providers:') || text.includes('  config:\r\n    providers:')) {
      if (managedSection) text = text.replace(/(  config:\r?\n    providers:)/, `$1\n${managedSection}`);
      writeChanged();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export class LocalModelControlHost {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.controller = new StrataController(config.dataRoot ?? null);

    const envStatus = this.controller.getEnv();
    this.compatible = envStatus.compatible;
    if (this.compatible) {
      void syncLocalProvidersToPatch(this.controller);
    }
    this.mountCredentialCheck(ctx);
    this.mountRoutes(ctx);
  }

  mountCredentialCheck(ctx) {
    this.credentialCheck = Promise.resolve();
    if (typeof ctx?.inject !== 'function') return;
    ctx.inject(['llm', 'credentials', 'settings'], scoped => {
      let disposed = false;
      scoped.effect?.(() => () => { disposed = true; });
      const check = () => {
        this.credentialCheck = this.credentialCheck.catch(() => {}).then(async () => {
          if (!disposed) await reconcileManagedCredentials(this.controller, {
            llm: this.getService('llm', scoped),
            credentials: this.getService('credentials', scoped),
            settings: this.getService('settings', scoped),
            isActive: () => !disposed && ctx.fiber?.uid !== null && scoped.fiber?.uid !== null
          });
        }).catch(() => {
          // Do not expose credentials or block unrelated providers on failure.
          scoped.logger?.warn?.('dsh-local-model: local credential self-check did not complete');
        });
        return this.credentialCheck;
      };
      for (const event of ['llm/adapters-updated', 'llm/models-updated', 'loader/volatile-update']) {
        scoped.on(event, check);
      }
      return check();
    });
  }

  getService(key, scoped = null) {
    for (const s of [scoped, this.ctx]) {
      try {
        if (s && s[key]) return s[key];
        if (typeof s?.get === 'function') {
          const found = s.get(key);
          if (found) return found;
        }
      } catch {}
    }
    return null;
  }

  mountRoutes(ctx) {
    const registerOn = (webServer, scoped) => {
      if (typeof webServer?.register !== 'function') return;
      webServer.register({
        kind: 'exact',
        path: '/dsh-local-model',
        handler: (req, res) => this.handleHttp(req, res, scoped).catch(err => {
          this.respond(res, 400, { ok: false, error: err.message || '操作未完成' });
        })
      });
    };

    const directWs = this.getService('webServer');
    if (directWs) {
      registerOn(directWs, ctx);
    } else if (typeof ctx?.inject === 'function') {
      try {
        ctx.inject(['webServer'], scoped => {
          registerOn(scoped?.webServer || this.getService('webServer', scoped), scoped);
        });
      } catch {}
    }
  }

  respond(res, status, payload) {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  async switchSessionModel(sessionId, modelKey, scoped = null) {
    const { profile } = this.controller.resolveModel(modelKey);
    if (!profile) throw new Error('未找到指定的 Strata 本地模型');
    await this.controller.startModel(profile.key);
    const sessionController = this.getService('sessionController', scoped);
    if (sessionId && typeof sessionController?.resolveAgent === 'function') {
      const resolved = await sessionController.resolveAgent(sessionId);
      if (resolved?.agent?.model?.select) {
        resolved.agent.model.select({ provider: profile.provider, model: profile.model });
      }
    }
    return {
      ok: true,
      switchedSessionId: sessionId || null,
      modelKey: profile.key,
      provider: profile.provider,
      model: profile.model,
      status: await this.controller.inspectAllStatus(),
      snapshot: await this.controller.readModelSnapshot(profile.key)
    };
  }

  async handleHttp(req, res, scoped = null) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const action = url.searchParams.get('action') || 'snapshot';

    if (req.method === 'GET') {
      const env = this.controller.getEnv();
      if (!env.compatible || action === 'env') {
        this.respond(res, 200, { ok: true, env });
        return;
      }
      const modelKey = url.searchParams.get('model') || null;
      const snapshot = await this.controller.readModelSnapshot(modelKey);
      this.respond(res, 200, { ok: true, env, snapshot });
      return;
    }

    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 262144) throw new Error('请求体过大');
      }
      const body = JSON.parse(raw || '{}');

      if (body.action === 'updateConfig') {
        const cfg = writePluginConfig({
          strataRoot: body.strataRoot,
          extraConfigDirs: body.extraConfigDirs,
          singleGpuMutex: body.singleGpuMutex,
          dismissedIncompatibleModal: body.dismissedIncompatibleModal
        }, this.config.dataRoot ?? null);
        const env = this.controller.getEnv();
        this.compatible = env.compatible;
        await syncLocalProvidersToPatch(this.controller);
        const snapshot = env.compatible ? await this.controller.readModelSnapshot(body.modelKey || null) : null;
        this.respond(res, 200, { ok: true, config: cfg, env, snapshot });
        return;
      }

      const env = this.controller.getEnv();
      if (!env.compatible) {
        this.respond(res, 409, { ok: false, error: '未检测到 Strata 环境，插件当前处于停用状态', env });
        return;
      }

      if (body.action === 'rescan') {
        await syncLocalProvidersToPatch(this.controller);
        const snapshot = await this.controller.readModelSnapshot(body.modelKey || null);
        this.respond(res, 200, { ok: true, env, snapshot, notice: `✓ 已重新扫描本地模型（共发现 ${snapshot.discoveredModels?.length || 0} 款模型）` });
        return;
      }
      if (body.action === 'save') {
        const out = await this.controller.saveModelParameters(body.modelKey, body.values || {});
        await syncLocalProvidersToPatch(this.controller);
        this.respond(res, 200, out);
        return;
      }
      if (body.action === 'start') {
        const status = await this.controller.startModel(body.modelKey);
        this.respond(res, 200, { ok: true, status, snapshot: await this.controller.readModelSnapshot(body.modelKey) });
        return;
      }
      if (body.action === 'stop') {
        const status = await this.controller.stopCurrentModel(body.targetModelKey || null);
        this.respond(res, 200, { ok: true, status, snapshot: await this.controller.readModelSnapshot(body.modelKey) });
        return;
      }
      if (body.action === 'switchSession') {
        const out = await this.switchSessionModel(body.sessionId, body.modelKey, scoped);
        this.respond(res, 200, out);
        return;
      }

      this.respond(res, 400, { ok: false, error: `未知操作：${body.action}` });
    }
  }
}

export function apply(ctx, config = {}) {
  try {
    new LocalModelControlHost(ctx, config);
  } catch {
    /* apply() must never throw */
  }
}

export default { name, apply };
