# dsh-local-model — Strata 本地模型控制插件 for DeepSeek Harness (DSH)

> **适用范围说明**  
> 这个插件用来在 DeepSeek Harness (DSH) 里管理本机 **Strata 本地推理引擎** 下的 GGUF 模型，不支持 Ollama、LM Studio 或 vLLM。  
> 如果电脑上没装 Strata，插件启动自检后会自己停用，不会报错，也不会影响你平时用云端模型聊天；第一次点进设置页时，可以点「复制 AI 检修/卸载提示词」粘贴到聊天框里，让 AI 帮你配路径或卸载。

---

## 一、 主要功能

1. **设置页独立入口（「设置 → 本地模型」）**：
   - 在设置页左边栏增加「本地模型」一栏，点开就能看到本机已有的 Strata 模型、当前有没有在跑、以及各项参数滑块。
2. **自动查找本机 Strata 和模型配置**：
   - 自动去 `%LOCALAPPDATA%\Strata`、`<strataRoot>/runtime/app/*/control/strata.py` 以及 `%APPDATA%\Strata\settings.json` 记录过的安装目录里找 Strata 运行环境和 `.json` 模型配置文件；
   - 没设端口的模型会自动分配一个空闲本地端口（从 `18081` 往上顺延）。
3. **直接读取 GGUF 模型文件的上下文上限**：
   - 直接从 `.gguf` 模型文件头里读出它原本支持的上下文长度（比如 32K、128K、262K），用来标出滑块的推荐范围；拉得太高时会提示容易产生幻觉。
4. **单独启停模型与单卡显存开关**：
   - 点 **「停止此模型」** 会按对应端口把那个模型的进程停掉；
   - 带有一个 **「单卡显存互斥」** 开关（默认打开：启动新模型前先停掉正在跑的旧模型，腾出显存；如果你有多张显卡或者显存够大，可以关掉它同时跑多个模型）。
5. **切换到当前对话**：
   - 找到的本地模型会自动出现在 DSH 的模型下拉菜单和「内阁模式」列表里；
   - 点 **「启动并切换到当前对话」** 只会把当前聊天窗口切过去用这个模型，不会改掉你的全局默认模型。
6. **原生视觉能力自动识别**：
   - 当本机 Strata 模型配置启用了视觉投影（`vision.mmproj` 文件就绪）时，同步给 DSH 的模型声明会自动带上 `image` 输入能力，并在设置页显示当前视觉编码器的运行模式（CPU / GPU）。

---

## 二、 安装方法

### 方式一：通过 DSH CLI 或插件管理安装（推荐）

在 DSH 桌面端或网页端插件管理中填入 `github:sxczzl2008/dsh-local-model`，或运行：

```bash
# 桌面端（Official Desktop）
dsh plugin --profile desktop add github:sxczzl2008/dsh-local-model

# 网页端（dsh web）
dsh plugin --profile web add github:sxczzl2008/dsh-local-model
```

装完后重启一次 DSH，即可在 **设置 → 本地模型** 中看到本机扫描出的 Strata 模型。

### 方式二：本地源码脚本安装、卸载与回滚

```powershell
# 1. 安装到正式版 DSH
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action Install

# 2. 从正式版 DSH 卸载
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action Uninstall

# 3. 回滚到指定历史版本 Tag
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action RollbackVersion -TargetTag "v0.2.2"
```

---

## 三、 目录结构

```text
dsh-local-model/
├── package.json                        # 插件包信息
├── cordis.patch.yml                    # 插件挂载配置
├── README.md                           # 使用说明
├── CHANGELOG.md                        # 版本更新记录
├── lib/
│   ├── index.js / index.mjs            # 后端服务入口、模型列表同步与启停接口
│   ├── env-check.mjs                   # Strata 路径检查与提示词生成
│   ├── provider-credentials.mjs        # 本机环回路由占位凭据协调
│   ├── strata-controller.mjs           # 模型扫描、GGUF/视觉状态读取、参数保存与进程启停
│   └── client.js                       # 设置页「本地模型」界面
└── scripts/
    ├── patch-host.cjs                  # 安装与卸载脚本
    └── Manage-LocalModel-Plugin.ps1    # 命令行管理脚本
```


