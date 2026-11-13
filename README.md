# dsh-local-model — Strata 本地模型控制插件 for DeepSeek Harness (DSH)

> **⚠️ 重要环境适配声明（Strata 专属插件）**  
> 本插件 **仅适配 [Strata 本地推理引擎](https://github.com/sxczzl2008/dsh-local-model)**（原生 GGUF 本地服务，如 `Huihui 18081` / `SC117 18082`），不支持 Ollama、LM Studio 或 vLLM 等其他后端。  
> **安全脱钩保护**：如果本机未安装或未配置 Strata 环境，插件在启动时（`< 5ms` 快检）会**自动安全脱钩（Inert Mode）**，零钩子挂载、零报错阻塞，绝不影响你的云端模型与日常对话；并会在首次进入时提供**「一键复制 AI 检修/卸载提示词」**按钮，复制后直接粘贴到 DSH 聊天框即可让你当前使用的工作 AI 协助配置路径或安全卸载插件。

---

## 一、 核心特性

1. **设置页一级入口（「设置 → 本地模型」）**：
   - 与「桌面控制」「内阁模式」同级的左侧独立选项卡，打开即见运行状态、显存控制与参数滑块。
2. **端口自动嗅探与外部进程自动认领**：
   - 实时探测 `127.0.0.1:18081`（Huihui）与 `127.0.0.1:18082`（SC117）；无论模型是由插件启动还是在外部双击脚本启动，一律自动识别运行状态与当前参数。
3. **五维核心参数调节（滑块 + 精确数字双向联动，手动保存生效）**：
   - **上下文窗口 (`contextWindow`)**：`8192 ～ 512000` tokens（默认推荐 `245000`；当超过 `262144` 即 262K 时自动给出长程幻觉风险提示）。
   - **单次默认输出预算 (`maxTokens`)**：`1 ～ (上下文窗口 - 1)` tokens（默认 `8192`，与 `dsh-cabinet` 内阁席位输出预算无缝对齐）。
   - **采样参数 (`Temperature` / `Top P` / `Top K`)**：支持勾选「保持模型默认继承」或自定义数值；模型在线时保存采样参数会自动热同步至 Strata 引擎。
4. **独立停止与显存保护（专为 16GB 显存设计）**：
   - 点击 **「停止当前模型（释放显存）」** 只停止当前运行的本地模型并释放端口与 `serial-runtime.lock`，**绝不自动拉起另一个模型**，立即腾出 16GB 显存。
5. **单会话精准切换（不污染全局默认模型）**：
   - 点击 **「启动并切换到当前对话」** 仅将当前打开的聊天会话切至所选本地模型，不篡改新建对话的全局默认云端模型。

---

## 二、 目录结构

```text
dsh-local-model/
├── package.json                        # DSH 插件包声明 (dsh-local-model v0.1.0)
├── cordis.patch.yml                    # Cordis 插件注入补丁
├── README.md                           # 说明与排障指南
├── CHANGELOG.md                        # 结构化版本变更日志
├── lib/
│   ├── index.js                        # 统一导出入口
│   ├── index.mjs                       # Cordis 服务、OpenAI 兼容流式适配器、单会话切换与 HTTP 接口
│   ├── env-check.mjs                   # <5ms Strata 环境快检、惰性脱钩判定、AI 检修提示词生成器
│   ├── strata-controller.mjs           # 参数原子读写、端口嗅探、启动与独立停止控制
│   └── client.js                       # 设置页「本地模型」选项卡 UI 与单次环境脱钩引导弹窗
└── scripts/
    ├── patch-host.cjs                  # 非侵入式安装/卸载脚本（与 dsh-cabinet 无缝共存）
    └── Manage-LocalModel-Plugin.ps1    # 一键安装、卸载、发版打 Tag 与版本回滚脚本
```

---

## 三、 安装、卸载与版本回滚命令

### 1. 安装到正式版 DSH
```powershell
pwsh -File "E:\DSH\dsh-local-model\scripts\Manage-LocalModel-Plugin.ps1" -Action Install
```

### 2. 从正式版 DSH 安全卸载
```powershell
pwsh -File "E:\DSH\dsh-local-model\scripts\Manage-LocalModel-Plugin.ps1" -Action Uninstall
```

### 3. 发布新版本并记录结构化日志
```powershell
pwsh -File "E:\DSH\dsh-local-model\scripts\Manage-LocalModel-Plugin.ps1" -Action PublishVersion -Version "0.2.0" -Summary "简要说明本次版本改动"
```

### 4. 回滚至指定历史版本 Tag
```powershell
pwsh -File "E:\DSH\dsh-local-model\scripts\Manage-LocalModel-Plugin.ps1" -Action RollbackVersion -TargetTag "v0.1.0"
```
