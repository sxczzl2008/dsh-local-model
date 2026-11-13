import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT_DIR = path.resolve(CURRENT_DIR, '..');

export function resolveConfigFilePath(customDataRoot = null) {
  const baseHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dataRoot = customDataRoot ? path.resolve(customDataRoot) : path.join(baseHome, 'local-model-control');
  fs.mkdirSync(dataRoot, { recursive: true });
  return path.join(dataRoot, 'config.json');
}

export function readPluginConfig(customDataRoot = null) {
  const file = resolveConfigFilePath(customDataRoot);
  if (!fs.existsSync(file)) {
    return { strataRoot: '', dismissedIncompatibleModal: false, configFilePath: file };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      strataRoot: typeof raw.strataRoot === 'string' ? raw.strataRoot.trim() : '',
      dismissedIncompatibleModal: raw.dismissedIncompatibleModal === true,
      configFilePath: file
    };
  } catch {
    return { strataRoot: '', dismissedIncompatibleModal: false, configFilePath: file };
  }
}

export function writePluginConfig(patch = {}, customDataRoot = null) {
  const current = readPluginConfig(customDataRoot);
  const next = {
    strataRoot: typeof patch.strataRoot === 'string' ? patch.strataRoot.trim() : current.strataRoot,
    dismissedIncompatibleModal: typeof patch.dismissedIncompatibleModal === 'boolean'
      ? patch.dismissedIncompatibleModal
      : current.dismissedIncompatibleModal,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(current.configFilePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { ...next, configFilePath: current.configFilePath };
}

export function checkStrataEnvironment(customDataRoot = null) {
  const cfg = readPluginConfig(customDataRoot);
  const candidates = [
    cfg.strataRoot,
    process.env.STRATA_ROOT,
    'D:/Helios Agent Team/strata',
    'C:/Strata',
    'D:/Strata',
    'E:/Strata'
  ].filter(Boolean).map(p => path.resolve(p));

  let selectedRoot = candidates.find(p => fs.existsSync(p)) || candidates[0] || path.resolve('D:/Helios Agent Team/strata');
  for (const cand of candidates) {
    if (fs.existsSync(path.join(cand, 'launchers/Start-Strata-Migrated.ps1'))) {
      selectedRoot = cand;
      break;
    }
  }

  const launchersDir = path.join(selectedRoot, 'launchers');
  const launcherScript = path.join(launchersDir, 'Start-Strata-Migrated.ps1');
  const controlPython = path.join(selectedRoot, 'runtime/app/v0.2.1/control/python/python.exe');
  const controlEntry = path.join(selectedRoot, 'runtime/app/v0.2.1/control/strata.py');
  const huihuiConfig = path.join(launchersDir, 'huihui-migrated.json');
  const sc117Config = path.join(launchersDir, 'sc117-iq3_s-migrated.json');

  const checks = [
    { key: 'strataRoot', label: 'Strata 根目录', path: selectedRoot, ok: fs.existsSync(selectedRoot) },
    { key: 'launcherScript', label: 'Strata 启动脚本', path: launcherScript, ok: fs.existsSync(launcherScript) },
    { key: 'controlPython', label: 'Strata Python 运行时', path: controlPython, ok: fs.existsSync(controlPython) },
    { key: 'controlEntry', label: 'Strata 控制入口 (strata.py)', path: controlEntry, ok: fs.existsSync(controlEntry) },
    { key: 'modelConfigs', label: '模型启动配置 (huihui / sc117)', path: huihuiConfig, ok: fs.existsSync(huihuiConfig) || fs.existsSync(sc117Config) }
  ];

  const missing = checks.filter(c => !c.ok);
  const compatible = missing.length === 0;
  const uninstallCmd = `pwsh -File "${path.join(PLUGIN_ROOT_DIR, 'scripts/Manage-LocalModel-Plugin.ps1')}" -Action Uninstall`;

  const aiDiagnosticPrompt = [
    '我在 DeepSeek Harness (DSH) 中安装了 `dsh-local-model`（仅适配 Strata 引擎的本地模型控制插件），但插件启动自检发现当前环境未满足 Strata 依赖，已自动安全脱钩（未影响 DSH 其他功能）。',
    '',
    '【插件环境自检详情】',
    `- 当前探测的 Strata 根目录：${selectedRoot}`,
    `- 缺失或未就绪项：${missing.length ? missing.map(m => `${m.label} (${m.path})`).join('；') : '无'}`,
    `- 插件配置文件位置：${cfg.configFilePath}`,
    `- 插件安装目录：${PLUGIN_ROOT_DIR}`,
    '',
    '请帮我检查本机环境并给出操作方案：',
    '1. 如果我本机已有 Strata 引擎和模型但安装路径不同，请帮我找出正确的 Strata 根目录，并将其写入上述配置文件的 `"strataRoot"` 字段；',
    '2. 如果我本机需要配置 Strata 本地模型环境，请指导我完成部署；',
    `3. 如果这台电脑不需要使用 Strata 本地模型，请帮我执行以下命令干净卸载该插件：\n   ${uninstallCmd}`
  ].join('\n');

  return {
    compatible,
    mode: compatible ? 'active' : 'detached',
    strataRoot: selectedRoot,
    launchersDir,
    launcherScript,
    controlPython,
    controlEntry,
    configFilePath: cfg.configFilePath,
    pluginRoot: PLUGIN_ROOT_DIR,
    dismissedIncompatibleModal: cfg.dismissedIncompatibleModal,
    checks,
    missing,
    uninstallCmd,
    aiDiagnosticPrompt
  };
}
