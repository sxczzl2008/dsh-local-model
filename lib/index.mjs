import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePluginConfig } from './env-check.mjs';
import { StrataController, MODEL_PROFILES } from './strata-controller.mjs';

export const name = 'dsh-local-model';

function resolveProfilePatchPath() {
  const baseHome = process.env.DSH_HOME || (fs.existsSync('E:/DSH/home/profiles/desktop') ? 'E:/DSH/home' : path.join(os.homedir(), '.dsh'));
  return path.join(baseHome, 'profiles/desktop/cordis.patch.yml');
}

export async function syncLocalProvidersToPatch(controller) {
  try {
    const env = controller.getEnv();
    if (!env.compatible) return false;
    const patchFile = resolveProfilePatchPath();
    if (!fs.existsSync(patchFile)) return false;

    const [huihuiSnap, sc117Snap] = await Promise.all([
      controller.readModelSnapshot('huihui'),
      controller.readModelSnapshot('sc117')
    ]);

    let text = fs.readFileSync(patchFile, 'utf8');
    const buildBlock = (profile, snap) => [
      `      ${profile.provider}:`,
      `        apiKey: local-strata`,
      `        api: openai-completions`,
      `        baseURL: ${profile.endpoint}`,
      `        models:`,
      `          - id: ${profile.model}`,
      `            name: "${profile.label}"`,
      `            contextWindow: ${snap.saved.contextWindow}`,
      `            maxTokens: ${snap.saved.maxTokens}`,
      `            input:`,
      `              - text`
    ].join('\n');

    const huihuiBlock = buildBlock(MODEL_PROFILES.huihui, huihuiSnap);
    const sc117Block = buildBlock(MODEL_PROFILES.sc117, sc117Snap);

    text = text.replace(/\r?\n {6}huihui-local:[\s\S]*?(?=\r?\n {6}[a-zA-Z0-9_-]+:|\r?\n- id:|\r?\n# <<<|$)/g, '');
    text = text.replace(/\r?\n {6}sc117-local:[\s\S]*?(?=\r?\n {6}[a-zA-Z0-9_-]+:|\r?\n- id:|\r?\n# <<<|$)/g, '');

    if (text.includes('  config:\n    providers:') || text.includes('  config:\r\n    providers:')) {
      text = text.replace(/(  config:\r?\n    providers:)/, `$1\n${huihuiBlock}\n${sc117Block}`);
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
    const profile = MODEL_PROFILES[modelKey];
    if (!profile) throw new Error('未知本地模型');
    await this.controller.startModel(modelKey);
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
      modelKey,
      provider: profile.provider,
      model: profile.model,
      status: await this.controller.inspectAllStatus()
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
      const modelKey = url.searchParams.get('model') || 'huihui';
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
          dismissedIncompatibleModal: body.dismissedIncompatibleModal
        }, this.config.dataRoot ?? null);
        const env = this.controller.getEnv();
        if (env.compatible) {
          this.compatible = true;
          await syncLocalProvidersToPatch(this.controller);
        }
        this.respond(res, 200, { ok: true, config: cfg, env });
        return;
      }

      const env = this.controller.getEnv();
      if (!env.compatible) {
        this.respond(res, 409, { ok: false, error: '当前环境未检测到 Strata 引擎，插件处于安全脱钩状态', env });
        return;
      }

      if (body.action === 'save') {
        const out = await this.controller.saveModelParameters(body.modelKey || 'huihui', body.values || {});
        await syncLocalProvidersToPatch(this.controller);
        this.respond(res, 200, out);
        return;
      }
      if (body.action === 'start') {
        const status = await this.controller.startModel(body.modelKey || 'huihui');
        this.respond(res, 200, { ok: true, status, snapshot: await this.controller.readModelSnapshot(body.modelKey || 'huihui') });
        return;
      }
      if (body.action === 'stop') {
        const status = await this.controller.stopCurrentModel();
        this.respond(res, 200, { ok: true, status, snapshot: await this.controller.readModelSnapshot(body.modelKey || 'huihui') });
        return;
      }
      if (body.action === 'switchSession') {
        const out = await this.switchSessionModel(body.sessionId, body.modelKey || 'huihui', scoped);
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
