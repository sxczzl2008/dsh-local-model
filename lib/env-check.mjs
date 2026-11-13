import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT_DIR = path.resolve(CURRENT_DIR, '..');

export function resolveConfigFilePath(customDataRoot = null) {
  const baseHome = process.env.DSH_HOME || (fs.existsSync('E:/DSH/home/profiles/desktop') ? 'E:/DSH/home' : path.join(os.homedir(), '.dsh'));
  const dataRoot = customDataRoot ? path.resolve(customDataRoot) : path.join(baseHome, 'local-model-control');
  fs.mkdirSync(dataRoot, { recursive: true });
  return path.join(dataRoot, 'config.json');
}

export function readPluginConfig(customDataRoot = null) {
  const file = resolveConfigFilePath(customDataRoot);
  const defaults = {
    strataRoot: '',
    extraConfigDirs: [],
    singleGpuMutex: true,
    dismissedIncompatibleModal: false,
    portAssignments: {},
    configFilePath: file
  };
  if (!fs.existsSync(file)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      strataRoot: typeof raw.strataRoot === 'string' ? raw.strataRoot.trim() : '',
      extraConfigDirs: Array.isArray(raw.extraConfigDirs)
        ? raw.extraConfigDirs.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim())
        : [],
      singleGpuMutex: raw.singleGpuMutex !== false,
      dismissedIncompatibleModal: raw.dismissedIncompatibleModal === true,
      portAssignments: raw.portAssignments && typeof raw.portAssignments === 'object' ? raw.portAssignments : {},
      configFilePath: file
    };
  } catch {
    return defaults;
  }
}

export function writePluginConfig(patch = {}, customDataRoot = null) {
  const current = readPluginConfig(customDataRoot);
  const next = {
    strataRoot: typeof patch.strataRoot === 'string' ? patch.strataRoot.trim() : current.strataRoot,
    extraConfigDirs: Array.isArray(patch.extraConfigDirs)
      ? patch.extraConfigDirs.filter(d => typeof d === 'string' && d.trim()).map(d => path.resolve(d.trim()))
      : current.extraConfigDirs,
    singleGpuMutex: typeof patch.singleGpuMutex === 'boolean' ? patch.singleGpuMutex : current.singleGpuMutex,
    dismissedIncompatibleModal: typeof patch.dismissedIncompatibleModal === 'boolean'
      ? patch.dismissedIncompatibleModal
      : current.dismissedIncompatibleModal,
    portAssignments: patch.portAssignments && typeof patch.portAssignments === 'object'
      ? { ...current.portAssignments, ...patch.portAssignments }
      : current.portAssignments,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(current.configFilePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { ...next, configFilePath: current.configFilePath };
}

function compareSemverDesc(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(x => (Number.isFinite(Number(x)) ? Number(x) : x));
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map(x => (Number.isFinite(Number(x)) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va === vb) continue;
    return vb > va ? 1 : -1;
  }
  return 0;
}


function readRememberedStrataInstalls() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
  const settingsCandidates = [
    process.env.STRATA_SETTINGS_FILE,
    path.join(appData, 'Strata/settings.json'),
    path.join(localAppData, 'Strata/app-settings.json'),
    path.join(home, '.config/strata/settings.json')
  ].filter(Boolean);

  const dirs = [];
  for (const file of settingsCandidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data.installs)) {
        for (const item of data.installs) {
          if (typeof item === 'string' && item.trim()) dirs.push(path.resolve(item.trim()));
        }
      }
    } catch {}
  }
  return dirs;
}

function probeRuntimeUnderRoot(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const appBases = [
    path.join(rootDir, 'runtime/app'),
    path.join(rootDir, 'app')
  ];
  for (const appBase of appBases) {
    if (!fs.existsSync(appBase)) continue;
    try {
      const vers = fs.readdirSync(appBase, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort(compareSemverDesc);
      for (const ver of vers) {
        const controlDir = path.join(appBase, ver, 'control');
        const controlEntry = path.join(controlDir, 'strata.py');
        const pyWin = path.join(controlDir, 'python/python.exe');
        const pyPosix = path.join(controlDir, 'python/bin/python3');
        const controlPython = fs.existsSync(pyWin) ? pyWin : fs.existsSync(pyPosix) ? pyPosix : '';
        if (fs.existsSync(controlEntry) && controlPython) {
          const compCandidates = [
            path.join(rootDir, 'runtime/components', ver),
            path.join(rootDir, 'components', ver),
            path.join(rootDir, 'runtime/components'),
            path.join(rootDir, 'components')
          ];
          const componentsDir = compCandidates.find(c => fs.existsSync(c)) || compCandidates[0];
          return {
            strataRoot: rootDir,
            version: ver,
            controlDir,
            controlEntry,
            controlPython,
            componentsDir,
            strataHome: fs.existsSync(path.join(rootDir, 'runtime/home'))
              ? path.join(rootDir, 'runtime/home')
              : path.join(rootDir, 'home'),
            strataModelsDir: fs.existsSync(path.join(rootDir, 'runtime/models'))
              ? path.join(rootDir, 'runtime/models')
              : path.join(rootDir, 'models')
          };
        }
      }
    } catch {}
  }

  const directControl = fs.existsSync(path.join(rootDir, 'control/strata.py'))
    ? path.join(rootDir, 'control')
    : fs.existsSync(path.join(rootDir, 'strata.py'))
      ? rootDir
      : null;
  if (directControl) {
    const pyWin = path.join(directControl, 'python/python.exe');
    const pyPosix = path.join(directControl, 'python/bin/python3');
    const controlPython = fs.existsSync(pyWin) ? pyWin : fs.existsSync(pyPosix) ? pyPosix : 'python';
    return {
      strataRoot: rootDir,
      version: 'local',
      controlDir: directControl,
      controlEntry: path.join(directControl, 'strata.py'),
      controlPython,
      componentsDir: path.join(rootDir, 'components'),
      strataHome: path.join(rootDir, 'home'),
      strataModelsDir: path.join(rootDir, 'models')
    };
  }
  return null;
}

export function checkStrataEnvironment(customDataRoot = null) {
  const cfg = readPluginConfig(customDataRoot);
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
  const remembered = readRememberedStrataInstalls();

  const rootCandidates = [
    cfg.strataRoot,
    process.env.STRATA_ROOT,
    process.env.STRATA_INSTALL_DIR,
    path.join(localAppData, 'Strata'),
    ...remembered,
    'D:/Helios Agent Team/strata',
    'C:/Strata',
    'D:/Strata',
    'E:/Strata',
    path.join(home, '.local/share/strata')
  ].filter(Boolean).map(p => path.resolve(p));

  let runtime = null;
  for (const cand of rootCandidates) {
    runtime = probeRuntimeUnderRoot(cand);
    if (runtime) break;
  }

  const selectedRoot = runtime?.strataRoot || (cfg.strataRoot ? path.resolve(cfg.strataRoot) : rootCandidates[0]);
  const controlEntry = runtime?.controlEntry || path.join(selectedRoot, 'runtime/app/<version>/control/strata.py');
  const controlPython = runtime?.controlPython || path.join(selectedRoot, 'runtime/app/<version>/control/python/python.exe');

  const configDirs = [
    ...cfg.extraConfigDirs,
    process.env.STRATA_INSTALL_DIR,
    path.join(selectedRoot, 'launchers'),
    path.join(selectedRoot, 'install'),
    path.join(selectedRoot, 'runtime/components/install'),
    runtime?.controlDir,
    path.join(localAppData, 'Strata/install'),
    ...remembered
  ].filter(Boolean).map(p => path.resolve(p));

  const uniqueConfigDirs = [...new Set(configDirs)].filter(d => fs.existsSync(d));

  const checks = [
    { key: 'strataRoot', label: 'Strata 根目录', path: selectedRoot, ok: fs.existsSync(selectedRoot) },
    { key: 'controlEntry', label: 'Strata 控制入口 (strata.py)', path: controlEntry, ok: Boolean(runtime?.controlEntry && fs.existsSync(runtime.controlEntry)) },
    { key: 'controlPython', label: 'Strata Python 运行时', path: controlPython, ok: Boolean(runtime?.controlPython && (runtime.controlPython === 'python' || fs.existsSync(runtime.controlPython))) },
    { key: 'configDirs', label: '模型配置扫描目录', path: uniqueConfigDirs[0] || path.join(selectedRoot, 'install'), ok: uniqueConfigDirs.length > 0 }
  ];

  const missing = checks.filter(c => !c.ok);
  const compatible = missing.length === 0;
  const uninstallCmd = `pwsh -File "${path.join(PLUGIN_ROOT_DIR, 'scripts/Manage-LocalModel-Plugin.ps1')}" -Action Uninstall`;

  const aiDiagnosticPrompt = [
    '我在 DeepSeek Harness (DSH) 中安装了 `dsh-local-model`（Strata 引擎通用本地模型控制插件），但插件自检发现当前环境未满足 Strata 依赖，已自动安全脱钩（未影响 DSH 其他功能）。',
    '',
    '【插件环境自检详情】',
    `- 当前探测的 Strata 根目录：${selectedRoot}`,
    `- 缺失或未就绪项：${missing.length ? missing.map(m => `${m.label} (${m.path})`).join('；') : '无'}`,
    `- 插件配置文件位置：${cfg.configFilePath}`,
    `- 插件安装目录：${PLUGIN_ROOT_DIR}`,
    '',
    '请帮我检查本机环境并给出操作方案：',
    '1. 如果我本机已安装 Strata 引擎但路径不同，请帮我找出正确的 Strata 根目录，并将其写入上述配置文件的 `"strataRoot"` 字段（如模型配置文件在单独目录，可一并写入 `"extraConfigDirs"` 数组）；',
    '2. 如果我本机需要配置 Strata 本地模型环境，请指导我完成部署；',
    `3. 如果这台电脑不需要使用 Strata 本地模型，请帮我执行以下命令干净卸载该插件：\n   ${uninstallCmd}`
  ].join('\n');

  return {
    compatible,
    mode: compatible ? 'active' : 'detached',
    strataRoot: selectedRoot,
    version: runtime?.version || null,
    controlDir: runtime?.controlDir || null,
    controlEntry: runtime?.controlEntry || null,
    controlPython: runtime?.controlPython || null,
    componentsDir: runtime?.componentsDir || null,
    strataHome: runtime?.strataHome || null,
    strataModelsDir: runtime?.strataModelsDir || null,
    configDirs: uniqueConfigDirs,
    extraConfigDirs: cfg.extraConfigDirs,
    singleGpuMutex: cfg.singleGpuMutex,
    portAssignments: cfg.portAssignments,
    configFilePath: cfg.configFilePath,
    pluginRoot: PLUGIN_ROOT_DIR,
    dismissedIncompatibleModal: cfg.dismissedIncompatibleModal,
    checks,
    missing,
    uninstallCmd,
    aiDiagnosticPrompt
  };
}

