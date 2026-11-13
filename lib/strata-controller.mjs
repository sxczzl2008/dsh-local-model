import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { checkStrataEnvironment } from './env-check.mjs';

export const MODEL_PROFILES = Object.freeze({
  huihui: {
    key: 'huihui',
    label: 'Huihui (主力 18081)',
    shortLabel: 'Huihui',
    provider: 'huihui-local',
    model: 'huihui-qwen3.8-flash-next-gyro-m',
    endpoint: 'http://127.0.0.1:18081/v1',
    origin: 'http://127.0.0.1:18081',
    port: 18081,
    launcher: 'huihui',
    defaultContextWindow: 262144,
    defaultMaxTokens: 8192
  },
  sc117: {
    key: 'sc117',
    label: 'SC117 (备选 18082)',
    shortLabel: 'SC117',
    provider: 'sc117-local',
    model: 'sc117-qwen3.8-flash-next-iq3_s',
    endpoint: 'http://127.0.0.1:18082/v1',
    origin: 'http://127.0.0.1:18082',
    port: 18082,
    launcher: 'sc117-iq3_s',
    defaultContextWindow: 245000,
    defaultMaxTokens: 8192
  }
});

export const PARAMETER_META = Object.freeze([
  {
    key: 'contextWindow',
    label: '上下文窗口 (Context Window)',
    unit: 'tokens',
    integer: true,
    min: 8192,
    max: 512000,
    recommended: 245000,
    warningAbove: 262144,
    warningText: '提示：上下文超过 262K（262144 tokens）时，模型长程幻觉可能明显增加。',
    tip: '输入、系统提示词、历史对话与输出共用的总窗口（范围 8192 ～ 512000，推荐 245000）。修改后需重启本地模型并重开 DSH 生效。'
  },
  {
    key: 'maxTokens',
    label: '单次默认输出预算 (Max Tokens)',
    unit: 'tokens',
    integer: true,
    min: 1,
    max: 65536,
    recommended: 8192,
    tip: '单次回复默认最大生成 token 数（须小于上下文窗口，常用 8192 ～ 32768）。保存后运行中的 Strata 会自动更新，重开 DSH 可刷新宿主目录缓存。'
  },
  {
    key: 'temperature',
    label: 'Temperature（采样温度）',
    unit: '',
    integer: false,
    min: 0,
    max: 2,
    step: 0.05,
    recommended: 0.7,
    inheritable: true,
    tip: '控制生成多样性（0 ～ 2）。勾选「保持模型默认继承」时使用模型内置最佳值。'
  },
  {
    key: 'topP',
    label: 'Top P（核采样）',
    unit: '',
    integer: false,
    min: 0.05,
    max: 1,
    step: 0.05,
    recommended: 0.9,
    inheritable: true,
    tip: '按累计概率保留候选词（0 < P ≤ 1）。勾选「保持模型默认继承」时使用模型内置默认值。'
  },
  {
    key: 'topK',
    label: 'Top K（候选数）',
    unit: '候选',
    integer: true,
    min: 1,
    max: 64,
    step: 1,
    recommended: 20,
    inheritable: true,
    tip: '每步采样的最大候选词数量（1 ～ 64）。勾选「保持模型默认继承」时使用模型内置默认值。'
  }
]);

export class StrataController {
  constructor(customDataRoot = null) {
    this.customDataRoot = customDataRoot;
    this.activeChild = null;
    this.activeModelKey = null;
    this.operationState = { active: false, action: null, modelKey: null, message: '空闲', updatedAt: new Date().toISOString() };
  }

  getEnv() {
    return checkStrataEnvironment(this.customDataRoot);
  }

  modelFiles(modelKey) {
    const profile = MODEL_PROFILES[modelKey];
    if (!profile) throw new Error(`未知本地模型：${modelKey}`);
    const env = this.getEnv();
    return {
      profile,
      env,
      configPath: path.join(env.launchersDir, `${profile.launcher}-migrated.json`),
      sharedPath: path.join(env.launchersDir, `${profile.launcher}-migrated.shared-settings.json`),
      lockPath: path.join(env.launchersDir, 'serial-runtime.lock')
    };
  }

  async probeModelRuntime(modelKey) {
    const profile = MODEL_PROFILES[modelKey];
    if (!profile) return { online: false, loaded: false, statusText: '未运行' };
    try {
      const [healthRes, statusRes, settingsRes] = await Promise.all([
        fetch(`${profile.origin}/health`, { signal: AbortSignal.timeout(800) }).catch(() => null),
        fetch(`${profile.origin}/v1/status`, { signal: AbortSignal.timeout(800) }).catch(() => null),
        fetch(`${profile.origin}/settings`, { signal: AbortSignal.timeout(800) }).catch(() => null)
      ]);
      if (!healthRes || !healthRes.ok) {
        return { online: false, loaded: false, statusText: '未运行', port: profile.port };
      }
      const health = await healthRes.json().catch(() => ({}));
      const status = statusRes?.ok ? await statusRes.json().catch(() => ({})) : {};
      const settings = settingsRes?.ok ? await settingsRes.json().catch(() => ({})) : {};
      const loaded = health.loaded === true || status.loaded === true;
      return {
        online: true,
        loaded,
        statusText: loaded ? '运行中（已就绪）' : '启动加载中…',
        port: profile.port,
        modelName: status.model || health.model || profile.model,
        contextWindow: status.n_ctx || null,
        inFlight: status.activity?.in_flight ?? 0,
        runtimeDefaults: settings.defaults || {}
      };
    } catch {
      return { online: false, loaded: false, statusText: '未运行', port: profile.port };
    }
  }

  async inspectAllStatus() {
    const [huihui, sc117] = await Promise.all([
      this.probeModelRuntime('huihui'),
      this.probeModelRuntime('sc117')
    ]);
    const runningModelKey = huihui.online ? 'huihui' : sc117.online ? 'sc117' : null;
    return {
      runningModelKey,
      runningLabel: runningModelKey ? MODEL_PROFILES[runningModelKey].label : '当前无运行中的本地模型',
      models: { huihui, sc117 },
      operation: this.operationState
    };
  }

  async readModelSnapshot(modelKey = 'huihui') {
    const { profile, configPath, sharedPath } = this.modelFiles(modelKey);
    let contextWindow = profile.defaultContextWindow;
    let rawConfig = null;
    if (fs.existsSync(configPath)) {
      try {
        rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const args = Array.isArray(rawConfig.args) ? rawConfig.args : [];
        const idx = args.indexOf('--max-context');
        if (idx >= 0 && args[idx + 1]) {
          const parsed = Number(args[idx + 1]);
          if (Number.isSafeInteger(parsed)) contextWindow = parsed;
        }
      } catch {}
    }

    let shared = { max_tokens: profile.defaultMaxTokens };
    if (fs.existsSync(sharedPath)) {
      try {
        shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
      } catch {}
    }

    const runtime = await this.probeModelRuntime(modelKey);
    const allStatus = await this.inspectAllStatus();

    const saved = {
      contextWindow,
      maxTokens: Number.isSafeInteger(shared.max_tokens) ? shared.max_tokens : profile.defaultMaxTokens,
      temperature: typeof shared.temperature === 'number' ? shared.temperature : null,
      topP: typeof shared.top_p === 'number' ? shared.top_p : null,
      topK: Number.isSafeInteger(shared.top_k) ? shared.top_k : null
    };

    return {
      modelKey,
      profile,
      saved,
      runtime,
      allStatus,
      parameterMeta: PARAMETER_META
    };
  }

  async saveModelParameters(modelKey, values = {}) {
    const { profile, configPath, sharedPath } = this.modelFiles(modelKey);
    const snap = await this.readModelSnapshot(modelKey);

    const nextW = values.contextWindow !== undefined ? Number(values.contextWindow) : snap.saved.contextWindow;
    const nextO = values.maxTokens !== undefined ? Number(values.maxTokens) : snap.saved.maxTokens;

    if (!Number.isSafeInteger(nextW) || nextW < 8192 || nextW > 512000) {
      throw new Error('上下文窗口须为 8192 ～ 512000 之间的整数');
    }
    if (!Number.isSafeInteger(nextO) || nextO < 1 || nextO >= nextW) {
      throw new Error('默认输出预算须为 1 ～ (上下文窗口 - 1) 之间的整数');
    }

    const nextTemp = values.temperature === null || values.temperature === '' || values.temperature === undefined
      ? null
      : Number(values.temperature);
    if (nextTemp !== null && (!Number.isFinite(nextTemp) || nextTemp < 0 || nextTemp > 2)) {
      throw new Error('Temperature 须在 0 ～ 2 之间');
    }

    const nextTopP = values.topP === null || values.topP === '' || values.topP === undefined
      ? null
      : Number(values.topP);
    if (nextTopP !== null && (!Number.isFinite(nextTopP) || nextTopP <= 0 || nextTopP > 1)) {
      throw new Error('Top P 须在 (0, 1] 之间');
    }

    const nextTopK = values.topK === null || values.topK === '' || values.topK === undefined
      ? null
      : Number(values.topK);
    if (nextTopK !== null && (!Number.isSafeInteger(nextTopK) || nextTopK < 1 || nextTopK > 64)) {
      throw new Error('Top K 须为 1 ～ 64 之间的整数');
    }

    const windowChanged = nextW !== snap.saved.contextWindow;
    const outputChanged = nextO !== snap.saved.maxTokens;

    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(cfg.args)) {
        const idx = cfg.args.indexOf('--max-context');
        if (idx >= 0 && idx + 1 < cfg.args.length) {
          cfg.args[idx + 1] = String(nextW);
        }
      }
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }

    const sharedObj = { max_tokens: nextO };
    if (nextTemp !== null) sharedObj.temperature = nextTemp;
    if (nextTopP !== null) sharedObj.top_p = nextTopP;
    if (nextTopK !== null) sharedObj.top_k = nextTopK;
    fs.writeFileSync(sharedPath, JSON.stringify(sharedObj, null, 2) + '\n', 'utf8');

    let runtimeSynced = false;
    if (snap.runtime.online && snap.runtime.loaded && !windowChanged) {
      try {
        const r = await fetch(`${profile.origin}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sharedObj),
          signal: AbortSignal.timeout(1500)
        });
        runtimeSynced = r.ok;
      } catch {}
    }

    let notice = '✓ 参数已保存。';
    if (windowChanged && snap.runtime.online) {
      notice = '✓ 参数已保存。上下文窗口已变更，请点击「重启/启动模型」重载权重，并重开 DSH 更新目录缓存。';
    } else if (windowChanged || outputChanged) {
      notice = '✓ 参数已保存。重开 DSH 后宿主模型目录缓存将完全同步最新窗口/输出预算。';
    } else if (runtimeSynced) {
      notice = '✓ 参数已保存并实时同步至当前运行中的 Strata 引擎。';
    }

    return {
      ok: true,
      notice,
      windowChanged,
      outputChanged,
      runtimeSynced,
      snapshot: await this.readModelSnapshot(modelKey)
    };
  }

  async stopCurrentModel() {
    this.operationState = { active: true, action: 'stop', modelKey: null, message: '正在停止本地模型并释放显存…', updatedAt: new Date().toISOString() };
    try {
      if (this.activeChild && !this.activeChild.killed) {
        try { this.activeChild.kill('SIGINT'); } catch {}
      }
      this.activeChild = null;
      this.activeModelKey = null;

      try {
        execFileSync('pwsh.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          "Get-Process -Name 'strata' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; " +
          "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pwsh.exe'\" -ErrorAction SilentlyContinue | " +
          "Where-Object { $_.CommandLine -match 'strata\\.py|Start-Strata-Migrated' } | " +
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        ], { timeout: 8000, windowsHide: true });
      } catch {}

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const st = await this.inspectAllStatus();
        if (!st.runningModelKey) break;
        await new Promise(r => setTimeout(r, 400));
      }

      this.operationState = { active: false, action: 'stop', modelKey: null, message: '本地模型已停止，显存已释放', updatedAt: new Date().toISOString() };
      return await this.inspectAllStatus();
    } catch (err) {
      this.operationState = { active: false, action: 'stop', modelKey: null, message: `停止操作异常：${err.message}`, updatedAt: new Date().toISOString() };
      throw err;
    }
  }

  async startModel(modelKey) {
    const { profile, env, configPath, sharedPath, lockPath } = this.modelFiles(modelKey);
    const current = await this.inspectAllStatus();
    if (current.runningModelKey === modelKey && current.models[modelKey]?.loaded) {
      this.operationState = { active: false, action: 'start', modelKey, message: `${profile.label} 已在运行就绪状态`, updatedAt: new Date().toISOString() };
      return current;
    }

    if (current.runningModelKey && current.runningModelKey !== modelKey) {
      await this.stopCurrentModel();
    }

    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch {}
    }

    const argsList = ['-B', env.controlEntry, 'serve', '--config', configPath, '--offline', '--output', 'jsonl'];
    const childEnv = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      STRATA_HOME: path.join(env.strataRoot, 'runtime/home'),
      STRATA_COMPONENTS_DIR: path.join(env.strataRoot, 'runtime/components/v0.2.1'),
      STRATA_MODELS_DIR: path.join(env.strataRoot, 'runtime/models')
    };

    this.operationState = { active: true, action: 'start', modelKey, message: `正在启动 ${profile.label}，等待模型加载就绪…`, updatedAt: new Date().toISOString() };
    const child = spawn(env.controlPython, argsList, {
      cwd: path.dirname(env.controlEntry),
      env: childEnv,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    this.activeChild = child;
    this.activeModelKey = modelKey;

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const probe = await this.probeModelRuntime(modelKey);
      if (probe.online && probe.loaded) {
        if (fs.existsSync(sharedPath)) {
          try {
            const sharedObj = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
            await fetch(`${profile.origin}/settings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(sharedObj),
              signal: AbortSignal.timeout(1500)
            });
          } catch {}
        }
        this.operationState = { active: false, action: 'start', modelKey, message: `${profile.label} 已启动就绪`, updatedAt: new Date().toISOString() };
        return await this.inspectAllStatus();
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    this.operationState = { active: false, action: 'start', modelKey, message: `${profile.label} 正在后台加载权重，请稍后刷新状态`, updatedAt: new Date().toISOString() };
    return await this.inspectAllStatus();
  }
}
