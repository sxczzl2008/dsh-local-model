import { Service } from '@deepseek-ai/cordis';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { writePluginConfig } from './env-check.mjs';
import { StrataController, MODEL_PROFILES } from './strata-controller.mjs';

class StrataOpenAiAdapter extends LlmAdapter {
  constructor(profile, controller) {
    super();
    this.profile = profile;
    this.controller = controller;
  }

  providerInfo() {
    return { id: this.profile.provider, name: this.profile.label };
  }

  async listModels(provider) {
    const snap = await this.controller.readModelSnapshot(this.profile.key);
    return [{
      provider,
      id: this.profile.model,
      name: this.profile.label,
      inputModalities: ['text'],
      contextWindow: snap.saved.contextWindow,
      defaultMaxTokens: snap.saved.maxTokens
    }];
  }

  async resolveModel(provider, modelId) {
    const snap = await this.controller.readModelSnapshot(this.profile.key);
    return {
      provider,
      id: modelId,
      name: this.profile.label,
      inputModalities: ['text'],
      context: { contextWindow: snap.saved.contextWindow },
      defaultMaxTokens: snap.saved.maxTokens
    };
  }

  async *stream(options) {
    const probe = await this.controller.probeModelRuntime(this.profile.key);
    if (!probe.online || !probe.loaded) {
      throw new Error(`${this.profile.label} 当前未启动 · 请在「设置 → 本地模型」中点击启动后再调用`);
    }
    const snap = await this.controller.readModelSnapshot(this.profile.key);
    const messages = (options.messages ?? []).map(m => ({
      role: m.role === 'developer' ? 'system' : m.role,
      content: Array.isArray(m.content)
        ? m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        : String(m.content ?? '')
    }));

    const body = {
      model: this.profile.model,
      messages,
      max_tokens: options.maxTokens ?? snap.saved.maxTokens ?? 8192
    };
    if (snap.saved.temperature !== null) body.temperature = snap.saved.temperature;
    if (snap.saved.topP !== null) body.top_p = snap.saved.topP;
    if (snap.saved.topK !== null) body.top_k = snap.saved.topK;

    const res = await fetch(`${this.profile.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`本地模型返回错误 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const reply = msg.content || msg.reasoning_content || '';
    if (reply) {
      yield { type: 'text-delta', index: 0, text: reply };
    }
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

export default class LocalModelControlService extends Service {
  static inject = ['llm', 'sessionController', 'webServer', 'connection'];

  constructor(ctx, config = {}) {
    super(ctx, 'localModelControl');
    this.config = config;
    this.controller = new StrataController(config.dataRoot ?? null);
    this.disposers = [];

    const envStatus = this.controller.getEnv();
    this.compatible = envStatus.compatible;

    if (this.compatible) {
      this.registerStrataAdapters();
    }

    if (ctx.webServer?.register) {
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-local-model',
        handler: (req, res) => this.handleHttp(req, res).catch(err => {
          this.respond(res, 400, { ok: false, error: err.message || '操作未完成' });
        })
      });
    }

    if (ctx.effect) {
      ctx.effect(() => () => {
        while (this.disposers.length) {
          try { this.disposers.pop()(); } catch {}
        }
      }, 'dsh-local-model lifecycle');
    }
  }

  registerStrataAdapters() {
    if (!this.ctx?.llm?.registerAdapter) return;
    while (this.disposers.length) {
      try { this.disposers.pop()(); } catch {}
    }
    for (const profile of Object.values(MODEL_PROFILES)) {
      try {
        const off = this.ctx.llm.registerAdapter([profile.provider], new StrataOpenAiAdapter(profile, this.controller));
        if (typeof off === 'function') this.disposers.push(off);
      } catch {}
    }
  }

  respond(res, status, payload) {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  async switchSessionModel(sessionId, modelKey) {
    const profile = MODEL_PROFILES[modelKey];
    if (!profile) throw new Error('未知本地模型');
    await this.controller.startModel(modelKey);
    if (sessionId && this.ctx?.sessionController?.resolveAgent) {
      const resolved = await this.ctx.sessionController.resolveAgent(sessionId);
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

  async handleHttp(req, res) {
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
        if (env.compatible && !this.compatible) {
          this.compatible = true;
          this.registerStrataAdapters();
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
        const out = await this.switchSessionModel(body.sessionId, body.modelKey || 'huihui');
        this.respond(res, 200, out);
        return;
      }

      this.respond(res, 400, { ok: false, error: `未知操作：${body.action}` });
    }
  }
}
