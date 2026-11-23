import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { checkStrataEnvironment, writePluginConfig } from './env-check.mjs';

const GGUF_CACHE = new Map();
const IGNORED_JSON_NAMES = new Set([
  'bundle.json',
  'settings.json',
  'app-settings.json',
  'update_keys.json',
  'package.json',
  'tsconfig.json'
]);

const SCALAR_SIZES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

export function readGgufMetadata(ggufPath) {
  if (!ggufPath || !fs.existsSync(ggufPath)) return null;
  try {
    const st = fs.statSync(ggufPath);
    const cacheKey = `${ggufPath}::${st.mtimeMs}::${st.size}`;
    if (GGUF_CACHE.has(cacheKey)) return GGUF_CACHE.get(cacheKey);

    const fd = fs.openSync(ggufPath, 'r');
    try {
      const maxRead = Math.min(st.size, 512 * 1024);
      const buf = Buffer.allocUnsafe(maxRead);
      const bytesRead = fs.readSync(fd, buf, 0, maxRead, 0);
      if (bytesRead < 24 || buf.toString('ascii', 0, 4) !== 'GGUF') return null;

      let offset = 4;
      const version = buf.readUInt32LE(offset); offset += 4;
      if (version < 2 || version > 3) return null;
      offset += 8; // tensor_count
      const kvCount = Number(buf.readBigUInt64LE(offset)); offset += 8;

      const readStr = () => {
        if (offset + 8 > bytesRead) return null;
        const len = Number(buf.readBigUInt64LE(offset)); offset += 8;
        if (len < 0 || offset + len > bytesRead) { offset = bytesRead + 1; return null; }
        const s = buf.toString('utf8', offset, offset + len);
        offset += len;
        return s;
      };

      const skipOrReadValue = (type, capture) => {
        if (offset > bytesRead) return null;
        if (type === 8) return readStr();
        if (type === 9) {
          if (offset + 12 > bytesRead) { offset = bytesRead + 1; return null; }
          const elemType = buf.readUInt32LE(offset); offset += 4;
          const count = Number(buf.readBigUInt64LE(offset)); offset += 8;
          if (elemType === 8) {
            for (let i = 0; i < count && offset <= bytesRead; i++) readStr();
          } else if (SCALAR_SIZES[elemType]) {
            offset += count * SCALAR_SIZES[elemType];
          } else {
            offset = bytesRead + 1;
          }
          return null;
        }
        const sz = SCALAR_SIZES[type];
        if (!sz || offset + sz > bytesRead) { offset = bytesRead + 1; return null; }
        let val = null;
        if (capture) {
          if (type === 4) val = buf.readUInt32LE(offset);
          else if (type === 5) val = buf.readInt32LE(offset);
          else if (type === 10) val = Number(buf.readBigUInt64LE(offset));
          else if (type === 11) val = Number(buf.readBigInt64LE(offset));
        }
        offset += sz;
        return val;
      };

      let arch = null;
      let modelName = null;
      let contextLength = null;
      const limit = Math.min(kvCount, 512);

      for (let i = 0; i < limit && offset < bytesRead; i++) {
        const key = readStr();
        if (!key || offset + 4 > bytesRead) break;
        const vType = buf.readUInt32LE(offset); offset += 4;
        const wantCapture = key === 'general.architecture' || key === 'general.name' || key.endsWith('.context_length');
        const val = skipOrReadValue(vType, wantCapture);
        if (key === 'general.architecture' && typeof val === 'string') arch = val;
        else if (key === 'general.name' && typeof val === 'string') modelName = val;
        else if (key.endsWith('.context_length') && Number.isSafeInteger(val) && val > 0) contextLength = val;
        if (arch && contextLength) break;
      }

      const meta = { arch, modelName, nativeContextLength: contextLength };
      GGUF_CACHE.set(cacheKey, meta);
      return meta;
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch {
    return null;
  }
}

export function buildParameterMeta(nativeContextLength = 262144, configuredContext = 245000) {
  const effectiveNative = Number.isSafeInteger(nativeContextLength) && nativeContextLength >= 8192 ? nativeContextLength : 262144;
  const maxSlider = Math.max(512000, effectiveNative);
  const recommended = Math.min(effectiveNative, configuredContext || 245000);
  const nativeK = Math.round(effectiveNative / 1024);

  return [
    {
      key: 'contextWindow',
      label: '上下文窗口 (Context Window)',
      unit: 'tokens',
      integer: true,
      min: 8192,
      max: maxSlider,
      recommended,
      nativeContextLength: effectiveNative,
      warningAbove: effectiveNative,
      warningText: `提示：当前设置的窗口已超过该模型 GGUF 原生训练上下文上限（${nativeK}K / ${effectiveNative} tokens），长程推理幻觉风险可能明显增加。`,
      tip: `输入、系统提示词、历史对话与输出共用的总窗口（该模型 GGUF 原生上限为 ${effectiveNative} tokens）。修改后需重启该本地模型并重开 DSH 生效。`
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
  ];
}


export class StrataController {
  constructor(customDataRoot = null) {
    this.customDataRoot = customDataRoot;
    this.activeChildren = new Map();
    this.operationState = { active: false, action: null, modelKey: null, message: '空闲', updatedAt: new Date().toISOString() };
  }

  getEnv() {
    return checkStrataEnvironment(this.customDataRoot);
  }

  discoverModels() {
    const env = this.getEnv();
    const modelsMap = new Map();
    const usedPorts = new Set();
    const portAssignments = { ...(env.portAssignments || {}) };
    let assignmentsDirty = false;

    const rawEntries = [];
    for (const dir of env.configDirs || []) {
      if (!fs.existsSync(dir)) continue;
      let files = [];
      try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const nameLower = entry.name.toLowerCase();
        if (!nameLower.endsWith('.json') || nameLower.endsWith('.shared-settings.json') || IGNORED_JSON_NAMES.has(nameLower) || nameLower.startsWith('manifest')) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 1024 * 1024) continue;
          const cfg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (!cfg || typeof cfg !== 'object' || typeof cfg.exe !== 'string' || !cfg.exe || typeof cfg.tokenizer !== 'string' || !Array.isArray(cfg.args)) {
            continue;
          }
          rawEntries.push({ dir, fileName: entry.name, fullPath, cfg });
          if (Number.isSafeInteger(cfg.port) && cfg.port > 0) {
            usedPorts.add(cfg.port);
          }
        } catch {}
      }
    }

    for (const p of Object.values(portAssignments)) {
      if (Number.isSafeInteger(p) && p > 0) usedPorts.add(p);
    }

    let nextPort = 18081;
    const allocPort = (key) => {
      if (Number.isSafeInteger(portAssignments[key]) && portAssignments[key] > 0) {
        return portAssignments[key];
      }
      while (usedPorts.has(nextPort)) nextPort++;
      usedPorts.add(nextPort);
      portAssignments[key] = nextPort;
      assignmentsDirty = true;
      return nextPort;
    };

    for (const item of rawEntries) {
      const baseStem = item.fileName.slice(0, -'.json'.length);
      let key = baseStem.replace(/^strata-/i, '').replace(/-migrated$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      if (!key) key = 'strata-model';
      if (modelsMap.has(key)) continue;

      const args = item.cfg.args.map(String);
      const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
      };

      const ggufPath = getArg('--native') || getArg('--model') || null;
      const ggufMeta = readGgufMetadata(ggufPath);
      const configuredMaxCtx = Number(getArg('--max-context'));
      const nativeContextLength = ggufMeta?.nativeContextLength || (Number.isSafeInteger(configuredMaxCtx) && configuredMaxCtx > 0 ? configuredMaxCtx : 262144);
      const defaultContextWindow = Number.isSafeInteger(configuredMaxCtx) && configuredMaxCtx >= 8192 ? configuredMaxCtx : Math.min(245000, nativeContextLength);

      const port = Number.isSafeInteger(item.cfg.port) && item.cfg.port > 0 ? item.cfg.port : allocPort(key);
      const host = typeof item.cfg.host === 'string' && item.cfg.host ? item.cfg.host : '127.0.0.1';
      const modelId = (typeof item.cfg.model_name === 'string' && item.cfg.model_name.trim()) ? item.cfg.model_name.trim() : baseStem;
      const shortName = ggufMeta?.modelName || modelId;

      const hasVision = Boolean(
        item.cfg.vision &&
        typeof item.cfg.vision === 'object' &&
        typeof item.cfg.vision.mmproj === 'string' &&
        item.cfg.vision.mmproj.trim() &&
        fs.existsSync(item.cfg.vision.mmproj)
      );
      const visionMode = hasVision ? (item.cfg.vision.gpu ? 'gpu' : 'cpu') : null;

      const sharedPath = path.join(item.dir, `${baseStem}.shared-settings.json`);
      modelsMap.set(key, {
        key,
        stem: baseStem,
        label: `${shortName} (${port})`,
        shortLabel: shortName,
        provider: `${key.replace(/_/g, '-')}-local`,
        model: modelId,
        host,
        port,
        origin: `http://${host}:${port}`,
        endpoint: `http://${host}:${port}/v1`,
        configPath: item.fullPath,
        sharedPath,
        lockPath: path.join(item.dir, 'serial-runtime.lock'),
        ggufPath,
        architecture: ggufMeta?.arch || null,
        hasVision,
        visionMode,
        nativeContextLength,
        defaultContextWindow,
        defaultMaxTokens: 8192
      });
    }

    if (assignmentsDirty) {
      try { writePluginConfig({ portAssignments }, this.customDataRoot); } catch {}
    }

    return [...modelsMap.values()];
  }

  resolveModel(modelKey) {
    const list = this.discoverModels();
    if (!list.length) return { profile: null, list, env: this.getEnv() };
    const found = (modelKey && list.find(m => m.key === modelKey || m.stem === modelKey || m.model === modelKey)) || list[0];
    return { profile: found, list, env: this.getEnv() };
  }


  async probeModelRuntime(profileOrKey) {
    const profile = typeof profileOrKey === 'object' && profileOrKey ? profileOrKey : this.resolveModel(profileOrKey).profile;
    if (!profile) return { online: false, loaded: false, statusText: '未发现模型' };
    try {
      const [healthRes, statusRes, settingsRes] = await Promise.all([
        fetch(`${profile.origin}/health`, { signal: AbortSignal.timeout(750) }).catch(() => null),
        fetch(`${profile.origin}/v1/status`, { signal: AbortSignal.timeout(750) }).catch(() => null),
        fetch(`${profile.origin}/settings`, { signal: AbortSignal.timeout(750) }).catch(() => null)
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
    const list = this.discoverModels();
    const probes = await Promise.all(list.map(async m => [m.key, await this.probeModelRuntime(m)]));
    const models = Object.fromEntries(probes);
    const runningKeys = list.filter(m => models[m.key]?.online).map(m => m.key);
    const runningModelKey = runningKeys[0] || null;
    const runningLabels = runningKeys.map(k => list.find(m => m.key === k)?.label).filter(Boolean);

    return {
      runningModelKey,
      runningKeys,
      runningLabel: runningLabels.length ? `运行中：${runningLabels.join(' 、 ')}` : '当前无运行中的本地模型',
      models,
      discoveredModels: list,
      operation: this.operationState
    };
  }

  async readModelSnapshot(modelKey = null) {
    const { profile, list } = this.resolveModel(modelKey);
    const allStatus = await this.inspectAllStatus();
    if (!profile) {
      return {
        modelKey: null,
        profile: null,
        discoveredModels: list,
        saved: null,
        runtime: { online: false, loaded: false, statusText: '未发现模型配置' },
        allStatus,
        parameterMeta: buildParameterMeta(262144, 245000)
      };
    }

    let contextWindow = profile.defaultContextWindow;
    if (fs.existsSync(profile.configPath)) {
      try {
        const rawConfig = JSON.parse(fs.readFileSync(profile.configPath, 'utf8'));
        const args = Array.isArray(rawConfig.args) ? rawConfig.args : [];
        const idx = args.indexOf('--max-context');
        if (idx >= 0 && args[idx + 1]) {
          const parsed = Number(args[idx + 1]);
          if (Number.isSafeInteger(parsed)) contextWindow = parsed;
        }
      } catch {}
    }

    let shared = { max_tokens: profile.defaultMaxTokens };
    if (fs.existsSync(profile.sharedPath)) {
      try {
        shared = JSON.parse(fs.readFileSync(profile.sharedPath, 'utf8'));
      } catch {}
    }

    const runtime = allStatus.models[profile.key] || await this.probeModelRuntime(profile);
    const saved = {
      contextWindow,
      maxTokens: Number.isSafeInteger(shared.max_tokens) ? shared.max_tokens : profile.defaultMaxTokens,
      temperature: typeof shared.temperature === 'number' ? shared.temperature : null,
      topP: typeof shared.top_p === 'number' ? shared.top_p : null,
      topK: Number.isSafeInteger(shared.top_k) ? shared.top_k : null
    };

    return {
      modelKey: profile.key,
      profile,
      discoveredModels: list,
      saved,
      runtime,
      allStatus,
      parameterMeta: buildParameterMeta(profile.nativeContextLength, contextWindow)
    };
  }


  async saveModelParameters(modelKey, values = {}) {
    const { profile } = this.resolveModel(modelKey);
    if (!profile) throw new Error(`未找到本地模型配置：${modelKey || ''}`);
    const snap = await this.readModelSnapshot(profile.key);

    const maxAllowedW = Math.max(512000, profile.nativeContextLength || 262144);
    const nextW = values.contextWindow !== undefined ? Number(values.contextWindow) : snap.saved.contextWindow;
    const nextO = values.maxTokens !== undefined ? Number(values.maxTokens) : snap.saved.maxTokens;

    if (!Number.isSafeInteger(nextW) || nextW < 8192 || nextW > maxAllowedW) {
      throw new Error(`上下文窗口须为 8192 ～ ${maxAllowedW} 之间的整数`);
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

    if (fs.existsSync(profile.configPath)) {
      const cfg = JSON.parse(fs.readFileSync(profile.configPath, 'utf8'));
      if (Array.isArray(cfg.args)) {
        const idx = cfg.args.indexOf('--max-context');
        if (idx >= 0 && idx + 1 < cfg.args.length) {
          cfg.args[idx + 1] = String(nextW);
        } else {
          cfg.args.push('--max-context', String(nextW));
        }
      }
      if (!Number.isSafeInteger(cfg.port)) cfg.port = profile.port;
      if (!cfg.host) cfg.host = profile.host;
      fs.writeFileSync(profile.configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    }

    const sharedObj = { max_tokens: nextO };
    if (nextTemp !== null) sharedObj.temperature = nextTemp;
    if (nextTopP !== null) sharedObj.top_p = nextTopP;
    if (nextTopK !== null) sharedObj.top_k = nextTopK;
    fs.writeFileSync(profile.sharedPath, JSON.stringify(sharedObj, null, 2) + '\n', 'utf8');

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
      notice = '✓ 参数已保存并实时同步至当前运行中的 Strata 实例。';
    }

    return {
      ok: true,
      notice,
      windowChanged,
      outputChanged,
      runtimeSynced,
      snapshot: await this.readModelSnapshot(profile.key)
    };
  }


  async stopModel(modelKey) {
    const { profile } = this.resolveModel(modelKey);
    if (!profile) return await this.inspectAllStatus();

    this.operationState = { active: true, action: 'stop', modelKey: profile.key, message: `正在停止 ${profile.label} 并释放显存…`, updatedAt: new Date().toISOString() };
    try {
      const child = this.activeChildren.get(profile.key);
      if (child && !child.killed) {
        try { child.kill('SIGINT'); } catch {}
      }
      this.activeChildren.delete(profile.key);

      const port = Number(profile.port);
      const escapedCfg = profile.configPath.replace(/'/g, "''");
      const psScript = [
        `$targetPort = ${port}`,
        `$targetCfg = '${escapedCfg}'`,
        `$pids = New-Object System.Collections.Generic.HashSet[int]`,
        `Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { [void]$pids.Add([int]$_.OwningProcess) } }`,
        `$allProcs = @(Get-CimInstance Win32_Process -Filter "Name='strata.exe' OR Name='python.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue)`,
        `foreach ($p in $allProcs) { if ($p.CommandLine -and $p.CommandLine.IndexOf($targetCfg, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { [void]$pids.Add([int]$p.ProcessId) } }`,
        `$added = $true`,
        `while ($added) { $added = $false; foreach ($p in $allProcs) { if ($pids.Contains([int]$p.ParentProcessId) -and -not $pids.Contains([int]$p.ProcessId)) { [void]$pids.Add([int]$p.ProcessId); $added = $true } } }`,
        `foreach ($id in $pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }`
      ].join('; ');

      try {
        execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', psScript], {
          timeout: 8000,
          windowsHide: true
        });
      } catch {}

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const probe = await this.probeModelRuntime(profile);
        if (!probe.online) break;
        await new Promise(r => setTimeout(r, 350));
      }

      if (fs.existsSync(profile.lockPath)) {
        try { fs.unlinkSync(profile.lockPath); } catch {}
      }

      this.operationState = { active: false, action: 'stop', modelKey: profile.key, message: `${profile.label} 已停止，显存已释放`, updatedAt: new Date().toISOString() };
      return await this.inspectAllStatus();
    } catch (err) {
      this.operationState = { active: false, action: 'stop', modelKey: profile.key, message: `停止操作异常：${err.message}`, updatedAt: new Date().toISOString() };
      throw err;
    }
  }

  async stopCurrentModel(targetModelKey = null) {
    if (targetModelKey) {
      return await this.stopModel(targetModelKey);
    }
    const status = await this.inspectAllStatus();
    for (const key of status.runningKeys || []) {
      await this.stopModel(key);
    }
    return await this.inspectAllStatus();
  }

  async startModel(modelKey) {
    const { profile, env } = this.resolveModel(modelKey);
    if (!profile) throw new Error('未发现可启动的 Strata 模型配置');

    const current = await this.inspectAllStatus();
    if (current.models[profile.key]?.online && current.models[profile.key]?.loaded) {
      this.operationState = { active: false, action: 'start', modelKey: profile.key, message: `${profile.label} 已在运行就绪状态`, updatedAt: new Date().toISOString() };
      return current;
    }

    if (env.singleGpuMutex !== false) {
      for (const runningKey of current.runningKeys || []) {
        if (runningKey !== profile.key) {
          await this.stopModel(runningKey);
        }
      }
    }

    if (fs.existsSync(profile.lockPath)) {
      try { fs.unlinkSync(profile.lockPath); } catch {}
    }

    if (fs.existsSync(profile.configPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(profile.configPath, 'utf8'));
        if (cfg.port !== profile.port || !cfg.host) {
          cfg.port = profile.port;
          cfg.host = profile.host || '127.0.0.1';
          fs.writeFileSync(profile.configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        }
      } catch {}
    }

    const argsList = ['-B', env.controlEntry, 'serve', '--config', profile.configPath, '--offline', '--output', 'jsonl'];
    const childEnv = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      ...(env.strataHome ? { STRATA_HOME: env.strataHome } : {}),
      ...(env.componentsDir ? { STRATA_COMPONENTS_DIR: env.componentsDir } : {}),
      ...(env.strataModelsDir ? { STRATA_MODELS_DIR: env.strataModelsDir } : {})
    };

    this.operationState = { active: true, action: 'start', modelKey: profile.key, message: `正在启动 ${profile.label}，等待模型加载就绪…`, updatedAt: new Date().toISOString() };
    const child = spawn(env.controlPython, argsList, {
      cwd: env.controlDir || path.dirname(env.controlEntry),
      env: childEnv,
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    this.activeChildren.set(profile.key, child);

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const probe = await this.probeModelRuntime(profile);
      if (probe.online && probe.loaded) {
        if (fs.existsSync(profile.sharedPath)) {
          try {
            const sharedObj = JSON.parse(fs.readFileSync(profile.sharedPath, 'utf8'));
            await fetch(`${profile.origin}/settings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(sharedObj),
              signal: AbortSignal.timeout(1500)
            });
          } catch {}
        }
        this.operationState = { active: false, action: 'start', modelKey: profile.key, message: `${profile.label} 已启动就绪`, updatedAt: new Date().toISOString() };
        return await this.inspectAllStatus();
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    this.operationState = { active: false, action: 'start', modelKey: profile.key, message: `${profile.label} 正在后台加载权重，请稍后刷新状态`, updatedAt: new Date().toISOString() };
    return await this.inspectAllStatus();
  }
}
