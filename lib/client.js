/**
 * dsh-file-preview — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step), mirroring the
 * dsh-usage-stats pattern. Three surfaces:
 *
 *  1. A frame-wide right-side floating PREVIEW PANEL (`shell.overlay`) that
 *     renders text/code, images and PDFs fetched from the server half.
 *  2. A produced-files row under each closing assistant message
 *     (`conversation.chat.turnTail` chain, priority -10 so it wins over the
 *     shipped deliverables row) with per-file actions: preview, open, and
 *     reveal-in-folder.
 *  3. A sidebar footer action (`sidebar.footer.action`) that toggles the
 *     panel.
 *
 * All three share one tiny module-level store, so a file clicked in the
 * conversation opens the panel no matter which surface is mounted.
 */

window.__ModuleLoader__.load({
	id: "dsh-file-preview",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const { Tooltip } = primitives;
		const IconCloseOutline16 = primitives.IconCloseOutline16;
		const IconRefreshOutline14 = primitives.IconRefreshOutline14;
		const IconFolderOpenOutline16 = primitives.IconFolderOpenOutline16;
		const IconRightUpOutline14 = primitives.IconRightUpOutline14;
		const IconPaperclipOutline16 = primitives.IconPaperclipOutline16;
		const IconCodeOutline16 = primitives.IconCodeOutline16;

		//#region css
		const css = [
			".fp_layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}",
			".fp_footerButtons{align-items:center;width:100%;display:flex}",
			".fp_badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}",
			".fp_badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".fp_badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}",
			".fp_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".fp_layer.fp_rail{width:36px;height:36px;margin:0}",
			".fp_layer.fp_rail .fp_badge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}",
			".fp_layer.fp_rail .fp_footerButtons{flex-direction:column;gap:2px}",
			".fp_panel{z-index:40;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);width:480px;max-width:calc(100vw - 24px);height:calc(100vh - 96px);max-height:calc(100vh - 96px);box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;display:flex;position:fixed;top:72px;right:12px;overflow:hidden}",
			".fp_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex:none;min-height:52px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}",
			".fp_headerRow{align-items:center;gap:8px;display:flex;min-width:0}",
			".fp_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".fp_path{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;direction:rtl;text-align:left}",
			".fp_headerActions{align-items:center;gap:2px;display:flex;flex:none;margin-left:auto}",
			".fp_iconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".fp_iconButton:hover:not(:disabled){color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".fp_iconButton:disabled{opacity:.5;cursor:default}",
			".fp_body{flex:1;min-height:0;overflow:auto;padding:12px 14px;background:var(--dsw-alias-fill-l1, transparent)}",
			".fp_empty{align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center;display:flex;padding:24px}",
			".fp_error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;margin:8px 0;padding:8px 10px;font-size:12px;line-height:18px;display:flex;gap:8px;align-items:flex-start;justify-content:space-between}",
			".fp_pre{margin:0;padding:0;color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);font-size:12px;line-height:1.6;white-space:pre;overflow:auto}",
			".fp_img{max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto}",
			".fp_iframe{border:0;width:100%;height:100%;background:#fff;border-radius:8px;display:block}",
			".fp_note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}",
			".fp_truncated{color:var(--dsw-alias-label-tertiary);margin-top:10px;font-size:11px;line-height:16px}",
			".fp_footer{box-sizing:border-box;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex:none;align-items:center;gap:8px;min-height:32px;padding:4px 12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:flex;font-variant-numeric:tabular-nums}",
			".fp_footerKind{flex:none;background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;padding:0 6px}",
			".fp_footerMeta{margin-left:auto;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}",
			".fp_row{flex-direction:column;gap:6px;margin-top:16px;display:flex;position:relative}",
			".fp_rowLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;flex:none}",
			".fp_chips{flex-wrap:wrap;align-items:center;gap:6px;display:flex}",
			".fp_chip{box-sizing:border-box;align-items:center;gap:2px;height:28px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:0 4px 0 10px;display:inline-flex;min-width:0}",
			".fp_chipName{color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;background:0 0;border:none;padding:0;max-width:220px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".fp_chipName:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}",
			".fp_chipButton{cursor:pointer;width:22px;height:22px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".fp_chipButton:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".fp_chipButton[data-primary]{color:var(--dsw-alias-label-secondary)}",
			".fp_chipButton[data-primary]:hover{color:var(--dsw-alias-label-primary)}"
		].join("");
		const tagId = "dsh-file-preview/FilePreview.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-file-preview";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region shared preview store
		const previewStore = {
			path: null,
			open: false,
			version: 0,
			listeners: new Set()
		};

		function subscribePreview(listener) {
			previewStore.listeners.add(listener);
			return () => {
				previewStore.listeners.delete(listener);
			};
		}

		function getPreviewVersion() {
			return previewStore.version;
		}

		function mutatePreview(mutator) {
			mutator();
			previewStore.version += 1;
			for (const listener of [...previewStore.listeners]) listener();
		}

		/** Open the panel and preview `path`. */
		function openPreview(path) {
			mutatePreview(() => {
				previewStore.path = path;
				previewStore.open = true;
			});
		}

		function togglePanel() {
			mutatePreview(() => {
				previewStore.open = !previewStore.open;
			});
		}

		function closePanel() {
			mutatePreview(() => {
				previewStore.open = false;
			});
		}

		/** Re-render the caller whenever the store changes. */
		function usePreviewVersion() {
			return react.useSyncExternalStore(subscribePreview, getPreviewVersion, getPreviewVersion);
		}
		//#endregion

		//#region helpers
		/** Trailing path segment. */
		function basenameOf(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}

		/** Leading directory of a path. */
		function dirnameOf(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at <= 0 ? path : path.slice(0, at);
		}

		/** Locale-safe template interpolation. */
		function interpolate(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(params, key) ? String(params[key]) : match));
		}

		function fmtBytes(bytes) {
			if (bytes === void 0 || bytes === null || !Number.isFinite(bytes)) return "—";
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}

		/** Local time label for an mtime. */
		function fmtTime(mtimeMs) {
			if (mtimeMs === void 0 || mtimeMs === null) return "";
			try {
				return new Date(mtimeMs).toLocaleString([], {
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit"
				});
			} catch {
				return "";
			}
		}

		async function fetchJson(path, options) {
			const response = await fetch(path, { headers: { accept: "application/json" }, ...options });
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload === null || typeof payload !== "object") {
				throw new Error(payload?.message ?? `HTTP ${response.status}`);
			}
			return payload;
		}

		/** Files produced by one turn (same derivation as ui-deliverables' turn data). */
		function producedForClosing(data, seq) {
			if (data === void 0 || data === null) return [];
			const paths = [];
			const seen = new Set();
			for (const produced of data.produced ?? []) {
				if (produced === null || typeof produced !== "object" || typeof produced.path !== "string") continue;
				if (produced.seq > seq || seen.has(produced.path)) continue;
				seen.add(produced.path);
				paths.push(produced.path);
			}
			return paths;
		}
		//#endregion

		//#region PreviewPanel
		/**
		 * Right-side floating preview panel, mounted in `shell.overlay`.
		 * Owns its fetch state; the shared store decides visibility and target.
		 */
		function PreviewPanel({ t }) {
			usePreviewVersion();
			const state = previewStore;
			const [data, setData] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);

			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);

			const load = react.useCallback((path) => {
				setLoading(true);
				setError(null);
				setData(null);
				fetchJson(`/api/file-preview/preview?path=${encodeURIComponent(path)}`)
					.then((payload) => {
						if (payload.ok !== true) {
							setError(payload.message ?? "preview failed");
							return;
						}
						setData(payload);
					})
					.catch((reason) => {
						setError(reason instanceof Error ? reason.message : String(reason));
					})
					.finally(() => {
						setLoading(false);
					});
			}, []);

			react.useEffect(() => {
				if (!state.open || state.path === null) return;
				load(state.path);
			}, [state.open, state.path, load]);

			if (!state.open) return null;

			const openExternal = () => {
				if (state.path !== null) {
					fetchJson("/api/file-preview/open", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: state.path })
					}).catch(() => {});
				}
			};

			const reveal = () => {
				if (state.path !== null) {
					fetchJson("/api/file-preview/reveal", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: state.path })
					}).catch(() => {});
				}
			};

			return react.createElement(
				"section",
				{ className: "fp_panel", "data-file-preview-panel": true, "aria-label": translate("panel.title") },
				react.createElement(
					"header",
					{ className: "fp_header" },
					react.createElement(
						"div",
						{ className: "fp_headerRow" },
						react.createElement("span", { className: "fp_title", title: state.path ?? "" }, state.path !== null ? basenameOf(state.path) : translate("panel.title")),
						react.createElement(
							"div",
							{ className: "fp_headerActions" },
							react.createElement(
								Tooltip,
								{ label: translate("panel.open"), side: "bottom", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_iconButton", "aria-label": translate("panel.open"), disabled: state.path === null, onClick: openExternal },
									react.createElement(IconRightUpOutline14, { size: 14 })
								)
							),
							react.createElement(
								Tooltip,
								{ label: translate("panel.reveal"), side: "bottom", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_iconButton", "aria-label": translate("panel.reveal"), disabled: state.path === null, onClick: reveal },
									react.createElement(IconFolderOpenOutline16, { size: 14 })
								)
							),
							react.createElement(
								Tooltip,
								{ label: translate("panel.refresh"), side: "bottom", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_iconButton", "aria-label": translate("panel.refresh"), disabled: state.path === null, onClick: () => load(state.path) },
									react.createElement(IconRefreshOutline14, { size: 14 })
								)
							),
							react.createElement(
								Tooltip,
								{ label: translate("panel.close"), side: "bottom", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_iconButton", "aria-label": translate("panel.close"), onClick: closePanel },
									react.createElement(IconCloseOutline16, { size: 14 })
								)
							)
						)
					),
					state.path !== null && react.createElement("div", { className: "fp_path", title: state.path }, dirnameOf(state.path))
				),
				react.createElement(
					"div",
					{ className: "fp_body" },
					state.path === null
						? react.createElement("div", { className: "fp_empty" }, translate("panel.empty"))
						: loading
							? react.createElement("p", { className: "fp_note" }, translate("panel.loading"))
							: error !== null
								? react.createElement("div", { className: "fp_error" }, react.createElement("span", null, translate("panel.error", { message: error })))
								: data === null
									? null
									: data.ok !== true
										? react.createElement("div", { className: "fp_error" }, react.createElement("span", null, data.message ?? translate("panel.error", { message: "?" })))
										: renderPreviewBody(data, translate)
				),
				data !== null && data.ok === true && react.createElement(
					"footer",
					{ className: "fp_footer" },
					react.createElement("span", { className: "fp_footerKind" }, kindLabel(data.kind, translate)),
					react.createElement("span", { className: "fp_footerMeta" }, `${fmtBytes(data.size)} · ${fmtTime(data.mtime)}`)
				)
			);
		}

		function renderPreviewBody(data, translate) {
			if (data.kind === "text") {
				return react.createElement(
					react.Fragment,
					null,
					react.createElement("pre", { className: "fp_pre" }, data.content ?? ""),
					data.truncated === true && react.createElement("p", { className: "fp_truncated" }, translate("panel.truncated", { size: "1 MB" }))
				);
			}
			if (data.kind === "image") {
				return react.createElement("img", { className: "fp_img", src: data.url, alt: data.name });
			}
			if (data.kind === "pdf") {
				return react.createElement("iframe", { className: "fp_iframe", src: data.url, title: data.name });
			}
			if (data.kind === "binary") {
				return react.createElement("p", { className: "fp_note" }, translate("panel.binary"));
			}
			return react.createElement("p", { className: "fp_note" }, translate("panel.binary"));
		}

		function kindLabel(kind, translate) {
			return translate(`kind.${kind}`) ?? kind;
		}
		//#endregion

		//#region ProducedFileActions
		/**
		 * Turn-tail chain entry: one row of per-file actions under each closing
		 * assistant message whose turn produced files. Wins the chain over the
		 * shipped deliverables row via `priority: -10`.
		 */
		function selectProduced(owner) {
			const data = owner?.turn?.data?.get("deliverables");
			const paths = producedForClosing(data, owner?.seq);
			return paths.length === 0 ? null : paths;
		}

		function ProducedFileActions({ matched: paths, openFile, t }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);

			const preview = (path) => {
				openPreview(path);
			};

			const reveal = (path) => {
				fetchJson("/api/file-preview/reveal", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path })
				}).catch(() => {});
			};

			const open = (path) => {
				if (typeof openFile === "function") openFile(path);
				else {
					fetchJson("/api/file-preview/open", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path })
					}).catch(() => {});
				}
			};

			return react.createElement(
				"div",
				{ className: "fp_row", "data-file-preview-row": true },
				react.createElement("span", { className: "fp_rowLabel" }, translate("row.label")),
				react.createElement(
					"div",
					{ className: "fp_chips" },
					paths.map((path) =>
						react.createElement(
							"span",
							{ className: "fp_chip", key: path, title: path },
							react.createElement(
								"button",
								{ type: "button", className: "fp_chipName", "aria-label": translate("row.preview", { name: path }), onClick: () => preview(path) },
								basenameOf(path)
							),
							react.createElement(
								Tooltip,
								{ label: translate("row.open", { name: path }), side: "top", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_chipButton", "data-primary": true, "aria-label": translate("row.open", { name: path }), onClick: () => open(path) },
									react.createElement(IconRightUpOutline14, { size: 12 })
								)
							),
							react.createElement(
								Tooltip,
								{ label: translate("row.reveal", { name: path }), side: "top", delayMs: 500 },
								react.createElement(
									"button",
									{ type: "button", className: "fp_chipButton", "aria-label": translate("row.reveal", { name: path }), onClick: () => reveal(path) },
									react.createElement(IconFolderOpenOutline16, { size: 12 })
								)
							)
						)
					)
				)
			);
		}
		//#endregion

		//#region SidebarBadge
		/** Sidebar footer action toggling the preview panel. */
		function SidebarBadge({ wide, t }) {
			usePreviewVersion();
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			const open = previewStore.open;
			return react.createElement(
				"div",
				{ className: wide ? "fp_layer" : "fp_layer fp_rail" },
				react.createElement(
					"div",
					{ className: "fp_footerButtons" },
					react.createElement(
						"button",
						{
							type: "button",
							className: "fp_badge",
							"data-file-preview-badge": true,
							"data-active": open || undefined,
							"aria-label": translate("badge"),
							"aria-expanded": open,
							onClick: togglePanel
						},
						react.createElement(IconPaperclipOutline16, { size: wide ? 14 : 18 }),
						wide && react.createElement("span", { className: "fp_badgeLabel" }, translate("badge"))
					)
				)
			);
		}
		//#endregion

		//#region locales
		/** `filePreview` namespace dictionaries (zh key set is the source of truth). */
		const NS = "filePreview";
		const zh = {
			"badge": "文件预览",
			"panel.title": "文件预览",
			"panel.empty": "点击对话中的文件即可在右侧预览。",
			"panel.loading": "正在读取文件…",
			"panel.error": "读取失败：{message}",
			"panel.truncated": "内容过长，仅显示前 {size}，可点击“打开”查看完整文件。",
			"panel.binary": "此文件类型暂不支持预览，请点击“打开”查看。",
			"panel.open": "用默认程序打开",
			"panel.reveal": "打开所在文件夹",
			"panel.refresh": "刷新",
			"panel.close": "关闭",
			"row.label": "文件操作",
			"row.preview": "预览 {name}",
			"row.open": "打开 {name}",
			"row.reveal": "在文件夹中显示 {name}",
			"kind.text": "文本",
			"kind.image": "图片",
			"kind.pdf": "PDF",
			"kind.binary": "二进制",
			"kind.unknown": "文件"
		};
		const en = {
			"badge": "File preview",
			"panel.title": "File preview",
			"panel.empty": "Click a file in the conversation to preview it here.",
			"panel.loading": "Reading file…",
			"panel.error": "Read failed: {message}",
			"panel.truncated": "Content is long; showing the first {size}. Use “Open” for the full file.",
			"panel.binary": "This file type can't be previewed; use “Open” instead.",
			"panel.open": "Open with default app",
			"panel.reveal": "Open containing folder",
			"panel.refresh": "Refresh",
			"panel.close": "Close",
			"row.label": "Files",
			"row.preview": "Preview {name}",
			"row.open": "Open {name}",
			"row.reveal": "Show {name} in folder",
			"kind.text": "text",
			"kind.image": "image",
			"kind.pdf": "PDF",
			"kind.binary": "binary",
			"kind.unknown": "file"
		};
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale", "connection"];

		/**
		 * Client plugin body: dictionaries, the frame-wide preview panel, the
		 * turn-tail file-action row, and the sidebar footer badge.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "file-preview: dictionaries");

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "file-preview",
				locale: NS,
				order: 20
			}, PreviewPanel));

			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: selectProduced,
				locale: NS,
				priority: -10
			}, ProducedFileActions));

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "file-preview",
				locale: NS,
				order: 20
			}, SidebarBadge));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.PreviewPanel = PreviewPanel;
		exports.ProducedFileActions = ProducedFileActions;
		exports.SidebarBadge = SidebarBadge;
		exports.renderPreviewBody = renderPreviewBody;
		exports.kindLabel = kindLabel;
		exports.openPreview = openPreview;
		exports.togglePanel = togglePanel;
		exports.closePanel = closePanel;
		exports.producedForClosing = producedForClosing;
		return module.exports;
	}
});
