/**
 * dsh-local-model — client bundle.
 * Registers the root-level "本地模型" section in Settings left rail
 * and shows a one-time decoupling guide modal if Strata environment is absent.
 */
window.__ModuleLoader__.load({
  id: "dsh-local-model",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var ReactDOM = require("react-dom");

    var PACKAGE_ID = "dsh-local-model";
    var VERSION = "0.1.0";
    var API_ENDPOINT = "/dsh-local-model";
    var SETTINGS_SLOT = "settings.section";
    var SETTINGS_ICON_SLOT = "settings.section.icon";
    var SETTINGS_ENTRY_ID = "dsh-local-model-settings";
    var SETTINGS_ORDER = 66;
    var REPO_URL = "https://github.com/sxczzl2008/dsh-local-model";
    var STYLE_ID = "dsh-local-model-styles";

    var GITHUB_ICON_PATH =
      "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

    var CSS = [
      ".dlmc-set{display:flex;flex-direction:column;gap:18px;max-width:920px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}",
      ".dlmc-head{display:flex;flex-direction:column;gap:6px}",
      ".dlmc-brand{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
      ".dlmc-title{margin:0;font-size:20px;font-weight:650;letter-spacing:-.01em}",
      ".dlmc-link{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#d7dee6);border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary,#65717d);text-decoration:none}",
      ".dlmc-version{font-size:12px;color:var(--dsw-alias-label-tertiary,#86909c)}",
      ".dlmc-card{display:flex;flex-direction:column;gap:12px;padding:18px 20px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,#e3e8ee);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff))}",
      ".dlmc-card__title{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dlmc-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;border-radius:8px;border:1px solid #3d609a;background:#3d609a;color:#fff}",
      ".dlmc-btn:disabled{opacity:.5;cursor:not-allowed}",
      ".dlmc-btn--quiet{background:transparent;color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,#d7dee6)}",
      ".dlmc-btn--danger{background:#fdf2f2;color:#be3b3b;border-color:#e0a0a0}",
      ".dlmc-rows{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:0;align-items:baseline}",
      ".dlmc-rows dt{color:var(--dsw-alias-label-secondary,#65717d);white-space:nowrap}",
      ".dlmc-rows dd{margin:0;min-width:0;overflow-wrap:anywhere}",
      ".dlmc-param{padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,#e8edf2);background:var(--dsw-alias-bg-layer-2,#fafbfd)}"
    ].join("");

    function installStyles() {
      if (typeof document === "undefined") return;
      var el = document.getElementById(STYLE_ID);
      if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = CSS;
    }

    function SettingsNavIcon(props) {
      var size = props && typeof props.size === "number" ? props.size : 16;
      return React.createElement(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 16 16", width: size, height: size, fill: "currentColor", "aria-hidden": "true" },
        React.createElement("path", { d: "M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5v11A1.5 1.5 0 0 1 10.5 15h-5A1.5 1.5 0 0 1 4 13.5v-11ZM5.5 2.5v11h5v-11h-5Z" }),
        React.createElement("circle", { cx: 8, cy: 11.5, r: 1 }),
        React.createElement("rect", { x: 6.5, y: 4, width: 3, height: 1.2, rx: 0.5 }),
        React.createElement("rect", { x: 6.5, y: 6.2, width: 3, height: 1.2, rx: 0.5 })
      );
    }

    async function callApi(body, query) {
      var url = body ? API_ENDPOINT : API_ENDPOINT + "?" + new URLSearchParams(query);
      var res = await fetch(url, body ? {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      } : { credentials: "same-origin" });
      var data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "操作未完成");
      return data;
    }

    function copyTextToClipboard(text, onCopied) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { onCopied("✓ 已复制到剪贴板，可直接粘贴到 DSH 对话框发送给工作 AI"); }).catch(function () {
          onCopied("复制未成功，请手动选中下方文本框复制");
        });
      } else {
        onCopied("请手动选中下方文本框复制");
      }
    }

    function DecoupledGuideCard(props) {
      var H = React.createElement;
      var env = props.env || {};
      var onReload = props.onReload;
      var _rootInput = React.useState(env.strataRoot || ""), rootInput = _rootInput[0], setRootInput = _rootInput[1];
      var _copyMsg = React.useState(""), copyMsg = _copyMsg[0], setCopyMsg = _copyMsg[1];
      var _saving = React.useState(false), saving = _saving[0], setSaving = _saving[1];

      var saveCustomRoot = function () {
        setSaving(true); setCopyMsg("");
        callApi({ action: "updateConfig", strataRoot: rootInput }).then(function () {
          onReload && onReload();
        }).catch(function (e) {
          setCopyMsg(e.message || "保存路径失败");
        }).finally(function () {
          setSaving(false);
        });
      };

      return H("section", { className: "dlmc-card", style: { borderColor: "#e6b8b8", background: "#fffafa" } },
        H("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
          H("h3", { className: "dlmc-card__title", style: { color: "#be3b3b" } }, "当前环境未检测到 Strata 引擎（插件已自动安全脱钩）"),
          H("span", { style: { fontSize: 12, padding: "2px 8px", borderRadius: 10, background: "#fdf2f2", color: "#be3b3b", border: "1px solid #e0a0a0" } }, "已脱钩 · 不影响 DSH 其他功能")
        ),
        H("p", { style: { margin: 0, color: "#26313d" } },
          "本插件专为 Strata 本地推理引擎设计。因当前电脑未检测到完整的 Strata 运行时，插件已自动中断后续挂载并与 DSH 脱钩，确保你的云端模型与日常对话不受任何干扰。"
        ),
        H("div", { style: { fontSize: 12, color: "#65717d" } },
          "未就绪项：",
          (env.missing || []).map(function (m) { return m.label + " (" + m.path + ")"; }).join(" ； ") || "未检测到 Strata 目录"
        ),
        H("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
          H("input", {
            type: "text",
            value: rootInput,
            onChange: function (e) { setRootInput(e.target.value); },
            placeholder: "若本机已安装 Strata，请在此输入 Strata 根目录路径（如 D:\\Strata）",
            style: { flex: "1 1 320px", padding: "6px 10px", borderRadius: 6, border: "1px solid #d7dee6", font: "inherit" }
          }),
          H("button", { type: "button", className: "dlmc-btn dlmc-btn--quiet", disabled: saving, onClick: saveCustomRoot }, saving ? "检测中…" : "保存路径并重新检测")
        ),
        H("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 } },
          H("strong", { style: { fontSize: 13 } }, "一键求助你当前 DSH 中的工作 AI（部署环境 / 寻找路径 / 卸载插件）："),
          H("textarea", {
            readOnly: true,
            rows: 5,
            value: env.aiDiagnosticPrompt || "",
            style: { width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #d7dee6", background: "#f7f9fb", font: "inherit", fontSize: 12 }
          }),
          copyMsg && H("div", { style: { color: "#2d8f54", fontSize: 12, fontWeight: 500 } }, copyMsg),
          H("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 } },
            H("button", {
              type: "button", className: "dlmc-btn",
              onClick: function () { copyTextToClipboard(env.aiDiagnosticPrompt || "", setCopyMsg); }
            }, "一键复制 AI 检修/卸载提示词"),
            H("button", {
              type: "button", className: "dlmc-btn dlmc-btn--danger",
              onClick: function () { copyTextToClipboard(env.uninstallCmd || "", setCopyMsg); }
            }, "复制一键卸载命令")
          )
        )
      );
    }

    function ParameterRow(props) {
      var H = React.createElement;
      var meta = props.meta;
      var value = props.value;
      var contextWindowVal = props.contextWindowVal || 245000;
      var onChange = props.onChange;
      var disabled = props.disabled;
      var _showTip = React.useState(false), showTip = _showTip[0], setShowTip = _showTip[1];

      var isInherited = meta.inheritable && (value === null || value === undefined || value === "");
      var effectiveMax = meta.key === "maxTokens" ? Math.max(1024, contextWindowVal - 1) : meta.max;
      var numericVal = isInherited ? meta.recommended : Number(value);
      var showWarn = meta.warningAbove && numericVal > meta.warningAbove;

      return H("div", { className: "dlmc-param" },
        H("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          H("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            H("strong", { style: { fontSize: 13 } }, meta.label),
            H("button", {
              type: "button",
              onClick: function () { setShowTip(!showTip); },
              style: { width: 20, height: 20, borderRadius: "50%", border: "1px solid #d7dee6", background: "#edf0f3", color: "#65717d", cursor: "pointer", fontSize: 12, padding: 0 }
            }, "?")
          ),
          meta.inheritable && H("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#65717d", cursor: "pointer" } },
            H("input", {
              type: "checkbox",
              checked: isInherited,
              disabled: disabled,
              onChange: function (e) { onChange(e.target.checked ? null : meta.recommended); }
            }),
            "保持模型默认继承"
          )
        ),
        showTip && H("div", { style: { marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "#eef4fc", color: "#26313d", fontSize: 12 } }, meta.tip),
        !isInherited && H("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" } },
          H("input", {
            type: "range",
            min: meta.min,
            max: effectiveMax,
            step: meta.step || (meta.integer ? 256 : 0.05),
            value: Number.isFinite(numericVal) ? Math.min(effectiveMax, Math.max(meta.min, numericVal)) : meta.recommended,
            disabled: disabled,
            onChange: function (e) { onChange(meta.integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value)); },
            style: { flex: "1 1 240px", accentColor: "#3d609a" }
          }),
          H("input", {
            type: "number",
            min: meta.min,
            max: effectiveMax,
            step: meta.step || 1,
            value: value ?? meta.recommended,
            disabled: disabled,
            onChange: function (e) {
              var v = e.target.value;
              if (v === "") { onChange(""); return; }
              onChange(meta.integer ? parseInt(v, 10) : parseFloat(v));
            },
            style: { width: 110, padding: "5px 8px", borderRadius: 6, border: "1px solid #d7dee6", font: "inherit", fontSize: 13 }
          }),
          meta.unit && H("span", { style: { fontSize: 12, color: "#65717d" } }, meta.unit)
        ),
        showWarn && H("div", { role: "note", style: { marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "#fff8eb", border: "1px solid #f0d090", color: "#b26b00", fontSize: 12 } },
          meta.warningText
        )
      );
    }

    function LocalModelSettingsPage(props) {
      var H = React.createElement;
      var currentSessionId = props && props.currentSessionId;
      var _modelKey = React.useState("huihui"), modelKey = _modelKey[0], setModelKey = _modelKey[1];
      var _env = React.useState(null), env = _env[0], setEnv = _env[1];
      var _snap = React.useState(null), snap = _snap[0], setSnap = _snap[1];
      var _draft = React.useState(null), draft = _draft[0], setDraft = _draft[1];
      var _dirty = React.useState(false), dirty = _dirty[0], setDirty = _dirty[1];
      var _busy = React.useState(false), busy = _busy[0], setBusy = _busy[1];
      var _notice = React.useState(""), notice = _notice[0], setNotice = _notice[1];
      var _error = React.useState(""), error = _error[0], setError = _error[1];

      var load = React.useCallback(function (targetModel) {
        var m = targetModel || modelKey;
        setBusy(true); setError("");
        callApi(null, { action: "snapshot", model: m }).then(function (res) {
          setEnv(res.env);
          if (res.snapshot) {
            setSnap(res.snapshot);
            setDraft(JSON.parse(JSON.stringify(res.snapshot.saved)));
            setDirty(false);
          }
        }).catch(function (e) {
          setError(e.message || "读取状态未完成");
        }).finally(function () {
          setBusy(false);
        });
      }, [modelKey]);

      React.useEffect(function () { load(modelKey); }, [modelKey, load]);
      return renderLocalModelPage({ H, VERSION, REPO_URL, GITHUB_ICON_PATH, currentSessionId, modelKey, setModelKey, env, snap, setSnap, draft, setDraft, dirty, setDirty, busy, setBusy, notice, setNotice, error, setError, load });
    }

    function renderLocalModelPage(ctx) {
      var H = ctx.H;
      var env = ctx.env;
      var snap = ctx.snap;
      var draft = ctx.draft || {};
      var allStatus = snap && snap.allStatus ? snap.allStatus : { runningModelKey: null, runningLabel: "检测中…", models: {} };

      var updateDraftField = function (k, v) {
        var next = Object.assign({}, draft);
        next[k] = v;
        if (k === "contextWindow" && Number.isFinite(v) && Number.isFinite(next.maxTokens) && next.maxTokens >= v) {
          next.maxTokens = Math.max(1024, v - 1024);
        }
        ctx.setDraft(next);
        ctx.setDirty(true);
        ctx.setNotice("");
      };

      var handleSave = function () {
        ctx.setBusy(true); ctx.setError(""); ctx.setNotice("");
        callApi({ action: "save", modelKey: ctx.modelKey, values: draft }).then(function (res) {
          ctx.setSnap(res.snapshot);
          ctx.setDraft(JSON.parse(JSON.stringify(res.snapshot.saved)));
          ctx.setDirty(false);
          ctx.setNotice(res.notice || "✓ 参数已保存");
        }).catch(function (e) { ctx.setError(e.message || "保存失败"); }).finally(function () { ctx.setBusy(false); });
      };

      var handleAction = function (act) {
        ctx.setBusy(true); ctx.setError(""); ctx.setNotice("");
        callApi({ action: act, modelKey: ctx.modelKey, sessionId: ctx.currentSessionId }).then(function (res) {
          if (res.snapshot) ctx.setSnap(res.snapshot);
          else ctx.load(ctx.modelKey);
          ctx.setNotice(act === "stop" ? "✓ 本地模型已停止，16GB 显存已释放" : act === "switchSession" ? "✓ 模型已启动并切换至当前对话" : "✓ 模型已启动就绪");
        }).catch(function (e) { ctx.setError(e.message || "操作失败"); }).finally(function () { ctx.setBusy(false); });
      };

      return H("div", { className: "dlmc-set", "data-testid": "dsh-local-model-settings-page" },
        H("header", { className: "dlmc-head" },
          H("div", { className: "dlmc-brand" },
            H("h2", { className: "dlmc-title" }, "本地模型 (Strata)"),
            H("a", { className: "dlmc-link", href: ctx.REPO_URL, target: "_blank", rel: "noreferrer" },
              H("svg", { viewBox: "0 0 24 24", width: 13, height: 13, fill: "currentColor" }, H("path", { d: ctx.GITHUB_ICON_PATH })),
              H("span", null, "GitHub")
            ),
            H("span", { className: "dlmc-version" }, "v" + ctx.VERSION)
          ),
          H("p", { style: { margin: 0, color: "#65717d" } },
            "管理本机 Strata 推理引擎（Huihui 18081 / SC117 18082）的上下文窗口、输出预算、采样参数与显存启停。"
          )
        ),
        env && !env.compatible && H(DecoupledGuideCard, { env: env, onReload: function () { ctx.load(ctx.modelKey); } }),
        ctx.error && H("div", { style: { padding: "8px 12px", borderRadius: 8, background: "#fdf2f2", border: "1px solid #e0a0a0", color: "#be3b3b" } }, ctx.error),
        ctx.notice && H("div", { style: { padding: "8px 12px", borderRadius: 8, background: "#eef8f2", border: "1px solid #9fd4b2", color: "#2d8f54", fontWeight: 500 } }, ctx.notice),
        renderCompatibleCards(ctx, H, env, snap, draft, allStatus, updateDraftField, handleSave, handleAction)
      );
    }

    function renderCompatibleCards(ctx, H, env, snap, draft, allStatus, updateDraftField, handleSave, handleAction) {
      if (!env || !env.compatible) return null;
      return H(React.Fragment, null,
        H("section", { className: "dlmc-card" },
          H("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } },
            H("h3", { className: "dlmc-card__title" }, "运行状态与显存控制"),
            H("span", { style: { fontSize: 12, padding: "2px 10px", borderRadius: 999, background: allStatus.runningModelKey ? "#eef8f2" : "#f2f4f7", color: allStatus.runningModelKey ? "#2d8f54" : "#65717d", fontWeight: 600 } },
              allStatus.runningLabel
            )
          ),
          H("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } },
            H("button", { type: "button", className: "dlmc-btn", disabled: ctx.busy, onClick: function () { handleAction("start"); } },
              ctx.busy ? "执行中…" : "启动 " + (ctx.modelKey === "huihui" ? "Huihui (18081)" : "SC117 (18082)")
            ),
            H("button", { type: "button", className: "dlmc-btn dlmc-btn--quiet", disabled: ctx.busy, onClick: function () { handleAction("switchSession"); } },
              "启动并切换到当前对话"
            ),
            H("button", { type: "button", className: "dlmc-btn dlmc-btn--danger", disabled: ctx.busy || !allStatus.runningModelKey, onClick: function () { handleAction("stop"); } },
              "停止当前模型（释放显存）"
            ),
            H("button", { type: "button", className: "dlmc-btn dlmc-btn--quiet", disabled: ctx.busy, onClick: function () { ctx.load(ctx.modelKey); } },
              "刷新状态"
            )
          )
        ),
        snap && H("section", { className: "dlmc-card" },
          H("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 } },
            H("h3", { className: "dlmc-card__title" }, "模型参数配置（切换编辑不触发启停，点保存生效）"),
            H("div", { style: { display: "flex", gap: 6 } },
              ["huihui", "sc117"].map(function (k) {
                var active = ctx.modelKey === k;
                var mStatus = allStatus.models && allStatus.models[k];
                return H("button", {
                  key: k, type: "button",
                  className: "dlmc-btn " + (active ? "" : "dlmc-btn--quiet"),
                  onClick: function () { ctx.setModelKey(k); }
                }, (k === "huihui" ? "Huihui (18081)" : "SC117 (18082)") + (mStatus && mStatus.online ? " · 运行中" : ""));
              })
            )
          ),
          H("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
            (snap.parameterMeta || []).map(function (meta) {
              return H(ParameterRow, {
                key: meta.key, meta: meta,
                value: draft[meta.key],
                contextWindowVal: Number(draft.contextWindow) || 245000,
                disabled: ctx.busy,
                onChange: function (val) { updateDraftField(meta.key, val); }
              });
            })
          ),
          H("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 } },
            H("button", { type: "button", className: "dlmc-btn", disabled: ctx.busy || !ctx.dirty, onClick: handleSave }, "保存参数修改"),
            H("button", {
              type: "button", className: "dlmc-btn dlmc-btn--quiet", disabled: ctx.busy,
              onClick: function () {
                ctx.setDraft({ contextWindow: 245000, maxTokens: 8192, temperature: null, topP: null, topK: null });
                ctx.setDirty(true);
              }
            }, "填入推荐默认值 (245K / 8192)"),
            ctx.dirty && H("button", {
              type: "button", className: "dlmc-btn dlmc-btn--quiet", disabled: ctx.busy,
              onClick: function () { ctx.setDraft(JSON.parse(JSON.stringify(snap.saved))); ctx.setDirty(false); }
            }, "放弃未保存修改")
          )
        ),
        H("section", { className: "dlmc-card" },
          H("h3", { className: "dlmc-card__title" }, "本机环境路径"),
          H("dl", { className: "dlmc-rows" },
            H("dt", null, "Strata 根目录"), H("dd", null, env.strataRoot),
            H("dt", null, "启动器配置目录"), H("dd", null, env.launchersDir),
            H("dt", null, "插件源码目录"), H("dd", null, env.pluginRoot)
          )
        )
      );
    }

    function mountIncompatibleNotifier() {
      if (typeof document === "undefined") return;
      callApi(null, { action: "env" }).then(function (res) {
        var env = res && res.env;
        if (!env || env.compatible || env.dismissedIncompatibleModal) return;

        var host = document.createElement("div");
        host.id = "dlmc-incompatible-modal-host";
        document.body.appendChild(host);

        function closeModal(dismissForever) {
          if (dismissForever) {
            callApi({ action: "updateConfig", dismissedIncompatibleModal: true }).catch(function () {});
          }
          try { host.remove(); } catch (e) {}
        }

        function ModalView() {
          var H = React.createElement;
          return H("div", {
            style: {
              position: "fixed", inset: 0, background: "rgba(18, 22, 28, 0.45)", zIndex: 99999,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20
            }
          },
            H("div", {
              style: {
                width: "min(680px, 94vw)", maxHeight: "88vh", overflowY: "auto", background: "#fff",
                borderRadius: 16, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: 14
              }
            },
              H(DecoupledGuideCard, { env: env, onReload: function () { closeModal(false); } }),
              H("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10 } },
                H("button", { type: "button", className: "dlmc-btn dlmc-btn--quiet", onClick: function () { closeModal(false); } }, "稍后处理"),
                H("button", { type: "button", className: "dlmc-btn", onClick: function () { closeModal(true); } }, "已知晓，不再自动弹出")
              )
            )
          );
        }

        if (ReactDOM && ReactDOM.createRoot) {
          ReactDOM.createRoot(host).render(React.createElement(ModalView));
        } else if (ReactDOM && ReactDOM.render) {
          ReactDOM.render(React.createElement(ModalView), host);
        }
      }).catch(function () {});
    }

    function apply(ctx) {
      installStyles();
      setTimeout(mountIncompatibleNotifier, 1200);
      try {
        ctx.slots.inject(SETTINGS_ICON_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_ICON_SLOT,
              id: SETTINGS_ENTRY_ID,
              order: SETTINGS_ORDER,
              label: function () { return "本地模型"; }
            },
            SettingsNavIcon
          );
        });
        ctx.slots.inject(SETTINGS_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_SLOT,
              id: SETTINGS_ENTRY_ID,
              order: SETTINGS_ORDER,
              label: function () { return "本地模型"; }
            },
            function LocalModelSection(props) {
              return React.createElement(LocalModelSettingsPage, props);
            }
          );
        });
        ctx.slots.inject("plugins.bundle.config", function () {
          return ctx.slots.register(
            {
              name: "plugins.bundle.config",
              key: PACKAGE_ID,
              label: function () { return "本地模型 (Strata)"; }
            },
            function () {
              return React.createElement(
                "p",
                { style: { margin: 0, fontSize: 13, color: "var(--dsw-alias-label-secondary)" } },
                "Strata 本地模型控制已就绪。请在左侧「本地模型」设置页调节上下文窗口、输出预算并控制模型启停。"
              );
            }
          );
        });
      } catch (e) {
        try { console.error("[dsh-local-model] slot registration error:", e); } catch (ig) {}
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
