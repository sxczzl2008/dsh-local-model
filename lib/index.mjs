import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePluginConfig } from './env-check.mjs';
import { StrataController } from './strata-controller.mjs';

export const name = 'dsh-local-model';

function resolveProfilePatchPath() {
  const baseHome = process.env.DSH_HOME || (fs.existsSync('E:/DSH/home/profiles/desktop') ? 'E:/DSH/home' : path.join(os.homedir(), '.dsh'));
  return path.join(baseHome, 'profiles/desktop/cordis.patch.yml');
}

export async function syncLocalProvidersToPatch(controller) {
  try {
    const patchFile = resolveProfilePatchPath();
    if (!fs.existsSync(patchFile)) return false;

    const env = controller.getEnv();
    const discovered = env.compatible ? controller.discoverModels() : [];
    const snapshots = await Promise.all(discovered.map(m => controller.readModelSnapshot(m.key)));

    let text = fs.readFileSync(patchFile, 'utf8');

    // Clean up managed block and any previous local-strata provider blocks
    text = text.replace(/\r?\n {6}# >>> dsh-local-model providers >>>[\s\S]*?# <<< dsh-local-model providers <<</g, '');
    text = text.replace(/\r?\n {6}[a-zA-Z0-9_-]+-local:\r?\n {8}apiKey: local-strata[\s\S]*?(?=\r?\n {6}[a-zA-Z0-9_-]+:|\r?\n- id:|\r?\n# <<<|$)/g, '');

    if (!env.compatible || snapshots.length === 0) {
      fs.writeFileSync(patchFile, text, 'utf8');
      return true;
    }

    const blocks = snapshots.filter(s => s.profile && s.saved).map(s => [
      `      ${s.profile.provider}:`,
      `        apiKey: local-strata`,
      `        api: openai-completions`,
      `        baseURL: ${s.profile.endpoint}`,
      `        models:`,
      `          - id: ${s.profile.model}`,
      `            name: ${JSON.stringify(s.profile.label)}`,
      `            contextWindow: ${s.saved.contextWindow}`,
      `            maxTokens: ${s.saved.maxTokens}`,
      `            input:`,
      `              - text`
    ].join('\n'));

    const managedSection = [
      '      # >>> dsh-local-model providers >>>',
      ...blocks,
      '      # <<< dsh-local-model providers <<<'
    ].join('\n');

    if (text.includes('  config:\n    providers:') || text.includes('  config:\r\n    providers:')) {
      text = text.replace(/(  config:\r?\n    providers:)/, `$1\n${managedSection}`);
      fs.writeFileSync(patchFile, text, 'utf8');
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
    this.mountRoutes(ctx);
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
        this.respond(res, 409, { ok: false, error: '当前环境未检测到 Strata 引擎，插件处于安全脱钩状态', env });
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
