# dsh-local-model — Strata 通用本地模型控制插件 for DeepSeek Harness (DSH)

> **⚠️ 重要环境适配声明（Strata 引擎专属通用插件）**  
> 本插件专为 **[Strata 本地推理引擎](https://github.com/sxczzl2008/dsh-local-model)**（原生 GGUF 本地推理服务）设计，**自动扫描并管理本机任意数量、任意型号的 Strata 本地模型**（不绑定特定模型或固定端口），不支持 Ollama、LM Studio 或 vLLM 等其他后端。  
> **安全脱钩保护**：如果本机未安装或未配置 Strata 环境，插件在启动时（`< 5ms` 快检）会**自动安全脱钩（Inert Mode）**，零钩子挂载、零报错阻塞，绝不影响你的云端模型与日常对话；并在首次进入时提供**「一键复制 AI 检修/卸载提示词」**按钮，复制后直接粘贴到 DSH 聊天框即可让你当前使用的工作 AI 协助配置路径或安全卸载插件。

---

## 一、 核心特性 (`v0.2.0` 通用版)

1. **设置页一级入口（「设置 → 本地模型」）**：
   - 与「桌面控制」「内阁模式」同级的左侧独立选项卡，打开即见所有已发现模型、运行状态、显存控制与参数滑块。
2. **全自动跨版本 Strata 运行时与模型发现**：
   - 自动按语义版本探测 `<strataRoot>/runtime/app/*/control/strata.py` 与 `%LOCALAPPDATA%\Strata` 标准安装路径（不绑定固定版本号或迁移脚本）；
   - 自动扫描官方 `install` 目录、`%APPDATA%\Strata\settings.json` 历史安装目录、`launchers` 目录及用户自定义 `extraConfigDirs` 下的所有合法 Strata Run Config (`.json`)；
   - 自动为未指定端口的模型持久化分配不冲突的本地端口（从 `18081` 起递增）。
3. **GGUF 文件头原生上下文上限直读 (`readGgufMetadata`)**：
   - 毫秒级直接读取每个模型 `.gguf` 权重文件头的 `<arch>.context_length` 与 `general.architecture`；
   - 根据各模型自身的真实训练上下文上限（如 32K、128K、262K）动态设置滑块推荐值与越界幻觉风险提示。
4. **按端口与进程树精准停止单个实例 + 单卡互斥开关**：
   - 点击 **「停止此模型」** 仅通过该模型的监听端口（`Get-NetTCPConnection -LocalPort`）与配置路径精准终止对应实例，**绝不误杀本机运行的其他 Strata 实例**；
   - 内置 **「单卡显存互斥保护」** 开关（默认开启：启动新模型前自动停掉旧模型释放显存；多卡或大显存用户可取消勾选以同时运行多个 Strata 模型）。
5. **单会话精准切换 & DSH 目录自动同步**：
   - 所有发现的 Strata 模型自动同步至 DSH 模型选择器与「内阁模式」候选池；
   - 点击 **「启动并切换到当前对话」** 仅切换当前打开的聊天窗口，不篡改全局默认云端模型。

---

## 二、 目录结构

```text
dsh-local-model/
├── package.json                        # DSH 插件包声明 (dsh-local-model v0.2.0)
├── cordis.patch.yml                    # Cordis 插件注入补丁
├── README.md                           # 说明与排障指南
├── CHANGELOG.md                        # 结构化版本变更日志
├── lib/
│   ├── index.js                        # 统一导出入口
│   ├── index.mjs                       # Cordis 宿主插件、动态模型目录同步、单会话切换与 HTTP 接口
│   ├── env-check.mjs                   # 跨版本 Strata 环境快检、多目录汇总、惰性脱钩与 AI 检修提示词生成器
│   ├── strata-controller.mjs           # 通用模型扫描、GGUF 元数据解析、参数原子读写、按端口/PID 精准启停
│   └── client.js                       # 设置页「本地模型」动态 UI 与单次环境脱钩引导弹窗
└── scripts/
    ├── patch-host.cjs                  # 非侵入式安装/卸载脚本（与 dsh-cabinet 无缝共存）
    └── Manage-LocalModel-Plugin.ps1    # 一键安装、卸载、发版打 Tag 与版本回滚脚本
```

---

## 三、 安装、卸载与版本回滚命令

### 1. 安装到正式版 DSH
```powershell
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action Install
```

### 2. 从正式版 DSH 安全卸载
```powershell
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action Uninstall
```

### 3. 发布新版本并记录结构化日志
```powershell
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action PublishVersion -Version "0.2.1" -Summary "简要说明本次版本改动"
```

### 4. 回滚至指定历史版本 Tag
```powershell
pwsh -File "<plugin-dir>/scripts/Manage-LocalModel-Plugin.ps1" -Action RollbackVersion -TargetTag "v0.2.0"
```

