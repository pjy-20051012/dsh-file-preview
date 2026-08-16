/**
 * dsh-file-preview — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step), mirroring the
 * dsh-usage-stats pattern. Surfaces:
 *
 *  1. A frame-wide right-side floating PREVIEW PANEL (`shell.overlay`) with
 *     two views: a RECENT list (last 10 produced files of the current
 *     session) and a PREVIEW body (text/code, images, PDFs).
 *  2. A produced-files row under each closing assistant message
 *     (`conversation.chat.turnTail` chain, priority -10) with per-file
 *     actions: preview, open, reveal-in-folder.
 *  3. A hidden collector (`conversation.input.dock`, session scope) that
 *     publishes the session's recent produced files into the shared store.
 *  4. A sidebar footer action (`sidebar.footer.action`) that opens the panel
 *     in RECENT view.
 *
 * All surfaces share one module-level store, so a file clicked anywhere
 * opens the panel no matter which surface is mounted.
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
		const IconChevronLeftOutline14 = primitives.IconChevronLeftOutline14;
		const IconDataOutline16 = primitives.IconDataOutline16;

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
			".fp_chipButton[data-primary]:hover{color:var(--dsw-alias-label-primary)}",
			".fp_recentList{flex-direction:column;display:flex}",
			".fp_recentRow{box-sizing:border-box;align-items:center;gap:10px;min-height:52px;border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 2px;display:flex}",
			".fp_recentRow:last-child{border-bottom:0}",
			".fp_recentIcon{color:var(--dsw-alias-label-tertiary);flex:none;width:28px;height:28px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);justify-content:center;align-items:center;display:flex}",
			".fp_recentInfo{min-width:0;flex:1;flex-direction:column;gap:1px;display:flex}",
			".fp_recentName{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;background:0 0;border:none;padding:0;text-align:left;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".fp_recentName:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}",
			".fp_recentPath{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".fp_recentMeta{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;flex:none;font-variant-numeric:tabular-nums}",
			".fp_recentActions{align-items:center;gap:2px;display:flex;flex:none}",
			".fp_panel,.fp_header,.fp_footer{background:color-mix(in srgb,var(--dsw-static-neutral-bluish-00) 90%,transparent)}",
			"body[data-ds-dark-theme] .fp_panel,body[data-ds-dark-theme] .fp_header,body[data-ds-dark-theme] .fp_footer{background:color-mix(in srgb,var(--dsw-static-neutral-bluish-950) 90%,transparent)}",
			".fp_body{background:transparent}",
			":root{--dsw-specific-sidebar-fill:color-mix(in srgb,var(--dsw-static-neutral-bluish-50) 88%,transparent) !important}",
			"body[data-ds-dark-theme]{--dsw-specific-sidebar-fill:color-mix(in srgb,var(--dsw-static-neutral-bluish-900) 88%,transparent) !important}"
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
		const RECENT_LIMIT = 10;
		const previewStore = {
			path: null,
			open: false,
			view: "recent",
			recent: [],
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

		/** Preview one file: the panel opens in PREVIEW view. */
		function openPreview(path) {
			mutatePreview(() => {
				previewStore.path = path;
				previewStore.view = "preview";
				previewStore.open = true;
			});
		}

		/** Show the RECENT list: the panel opens in RECENT view. */
		function showRecent() {
			mutatePreview(() => {
				previewStore.view = "recent";
				previewStore.path = null;
				previewStore.open = true;
			});
		}

		/** Sidebar badge toggle: open → recent view; open-in-preview → recent; else close. */
		function togglePanel() {
			mutatePreview(() => {
				if (!previewStore.open) {
					previewStore.view = "recent";
					previewStore.path = null;
					previewStore.open = true;
				} else if (previewStore.view === "preview") {
					previewStore.view = "recent";
					previewStore.path = null;
				} else {
					previewStore.open = false;
				}
			});
		}

		function closePanel() {
			mutatePreview(() => {
				previewStore.open = false;
			});
		}

		/** Publish the session's recent produced files (called by the collector). */
		function setRecentFiles(list) {
			mutatePreview(() => {
				previewStore.recent = Array.isArray(list) ? list : [];
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

		/** Local time label for an epoch-ms timestamp. */
		function fmtTime(ms) {
			if (ms === void 0 || ms === null || !Number.isFinite(ms) || ms <= 0) return "";
			try {
				return new Date(ms).toLocaleString([], {
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

		/**
		 * Host-provided native opener (`host.openPath` remote). This is the SAME
		 * mechanism the conversation's file links use — it works under the
		 * harness sandbox, unlike plugin-side process spawns.
		 */
		let hostOpener = null;

		/** Open a path via the host opener; true when handled. */
		function openViaHost(path) {
			if (hostOpener !== null && typeof hostOpener.openPath === "function") {
				try {
					hostOpener.openPath(path).catch(() => {});
					return true;
				} catch {
					return false;
				}
			}
			return false;
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

		/**
		 * Collect produced files from a conversation snapshot's nodes.
		 *
		 * A file counts as produced when:
		 *  - its tool result carries a render intent that creates/modifies it
		 *    (diff card, or a generic edit) — the same rule ui-deliverables
		 *    uses; OR
		 *  - an assistant message names it as inline code (`` `path` ``) — this
		 *    covers files created through terminal commands (pwsh/exec), which
		 *    never carry tool `locations`; OR
		 *  - a tool result's text mentions an absolute path (a fallback for
		 *    command output that echoes the file it wrote).
		 *
		 * Results are deduped by path (last occurrence wins), ordered by seq,
		 * capped at RECENT_LIMIT, most-recent-first.
		 * @param nodes - `ConversationSnapshot.nodes` (ConversationNode[]).
		 * @returns `{ path, seq, time }[]`, newest first.
		 */
		function producedFilesFromSnapshot(nodes) {
			const entries = [];
			if (!Array.isArray(nodes)) return entries;
			for (const node of nodes) {
				if (node === null || typeof node !== "object") continue;
				const seq = typeof node.seq === "number" ? node.seq : 0;
				const time = typeof node.time === "number" ? node.time : 0;
				if (node.kind === "tool-result") {
					const view = node.callView;
					if (view !== null && typeof view === "object") {
						const isProduced = view.card === "diff" || (view.card === "generic" && view.kind === "edit");
						if (isProduced) {
							const locations = Array.isArray(view.locations) ? view.locations : [];
							for (const loc of locations) {
								if (loc !== null && typeof loc === "object" && typeof loc.path === "string" && loc.path.length > 0) {
									entries.push({ path: loc.path, seq, time });
								}
							}
						}
					}
					// Command output may echo the file it wrote; collect absolute paths
					// mentioned in the result content as a fallback.
					const content = node.content;
					if (Array.isArray(content)) {
						for (const block of content) {
							if (block !== null && typeof block === "object" && typeof block.text === "string") {
								pushMentionedPaths(entries, block.text, seq, time);
							}
						}
					}
					continue;
				}
				if (node.kind === "assistant") {
					// The closing prose names produced files as inline code
					// (`` `path` ``); collect those absolute or workspace paths.
					const blocks = node.blocks;
					if (Array.isArray(blocks)) {
						for (const block of blocks) {
							if (block === null || typeof block !== "object") continue;
							if (typeof block.text === "string") pushMentionedPaths(entries, block.text, seq, time);
							const content = block.content;
							if (Array.isArray(content)) {
								for (const part of content) {
									if (part !== null && typeof part === "object" && typeof part.text === "string") {
										pushMentionedPaths(entries, part.text, seq, time);
									}
								}
							}
						}
					}
				}
			}
			const byPath = new Map();
			for (const entry of entries) byPath.set(entry.path, entry);
			const unique = [...byPath.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
			return unique.slice(-RECENT_LIMIT).reverse();
		}

		/**
		 * Match inline-code backtick spans and absolute path-like tokens in
		 * prose, then append any that look like files to `entries`.
		 */
		function pushMentionedPaths(entries, text, seq, time) {
			if (typeof text !== "string" || text.length === 0) return;
			// Inline code spans first: `D:\path\file.pptx` or `./file.md`.
			const backtickRe = /`([^`\n]+)`/g;
			let m;
			while ((m = backtickRe.exec(text)) !== null) {
				const token = m[1].trim();
				if (looksLikeFilePath(token)) entries.push({ path: normalizePathToken(token), seq, time });
			}
			// Bare absolute paths in prose (drive-letter, UNC, or POSIX).
			const bareRe = /(?<![A-Za-z0-9_`])([A-Za-z]:[\\/][^\s"'`<>]+|\\\\[^\s"'`<>]+|\/(?!\/)[^\s"'`<>]+(?:\.[A-Za-z0-9]{1,10}))(?![A-Za-z0-9_`])/g;
			while ((m = bareRe.exec(text)) !== null) {
				const token = m[1].trim().replace(/[.,;:)]+$/, "");
				if (looksLikeFilePath(token)) entries.push({ path: normalizePathToken(token), seq, time });
			}
		}

		/** Heuristic: does this token look like a file path (has a separator or a known extension)? */
		function looksLikeFilePath(token) {
			if (typeof token !== "string" || token.length === 0 || token.length > 512) return false;
			if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith("\\\\") || token.startsWith("/")) {
				if (token.endsWith(".") || token.endsWith(":") || token.includes("\0")) return false;
				return true;
			}
			// Relative path with a separator and an extension.
			if ((token.includes("/") || token.includes("\\")) && /\.[A-Za-z0-9]{1,10}$/.test(token)) return true;
			return false;
		}

		/** Normalize a path token: strip trailing punctuation and collapse separators. */
		function normalizePathToken(token) {
			let value = token.replace(/[.,;:!?)]+$/, "").trim();
			if (value.startsWith("./") || value.startsWith(".\\")) value = value.slice(2);
			return value;
		}

		/** Coarse kind by extension, for list icons. */
		function guessKind(path) {
			const at = path.lastIndexOf(".");
			if (at === -1) return "file";
			const ext = path.slice(at + 1).toLowerCase();
			if (ext === "pdf") return "pdf";
			if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "tif", "tiff"].includes(ext)) return "image";
			if (["pptx", "ppt", "docx", "doc", "xlsx", "xls", "key", "odp", "odt", "ods"].includes(ext)) return "office";
			return "text";
		}
		//#endregion

		//#region RecentFilesCollector
		/**
		 * Hidden session-scoped collector: publishes the session's recent
		 * produced files into the shared store. Renders nothing.
		 * Owner share `session` is the live conversation snapshot, re-rendered
		 * by the dispatch skeleton on every change.
		 */
		function RecentFilesCollector({ session }) {
			const list = react.useMemo(() => producedFilesFromSnapshot(session?.nodes), [session]);
			react.useEffect(() => {
				setRecentFiles(list);
			}, [list]);
			return null;
		}
		//#endregion

		//#region RecentList
		/** One list row: icon, clickable name, path, time, open/reveal actions. */
		function RecentRow({ item, t, openFile }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			const kind = guessKind(item.path);
			const open = () => {
				if (typeof openFile === "function") {
					openFile(item.path);
				} else if (!openViaHost(item.path)) {
					fetchJson("/api/file-preview/open", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: item.path })
					}).catch(() => {});
				}
			};
			const reveal = () => {
				if (!openViaHost(dirnameOf(item.path))) {
					fetchJson("/api/file-preview/reveal", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: item.path })
					}).catch(() => {});
				}
			};
			const Icon = kind === "image" || kind === "pdf" ? IconDataOutline16 : IconCodeOutline16;
			return react.createElement(
				"div",
				{ className: "fp_recentRow", title: item.path },
				react.createElement("span", { className: "fp_recentIcon" }, react.createElement(Icon, { size: 14 })),
				react.createElement(
					"div",
					{ className: "fp_recentInfo" },
					react.createElement(
						"button",
						{ type: "button", className: "fp_recentName", "aria-label": translate("recent.preview", { name: item.path }), onClick: () => openPreview(item.path) },
						basenameOf(item.path)
					),
					react.createElement("div", { className: "fp_recentPath" }, item.path)
				),
				item.time > 0 && react.createElement("span", { className: "fp_recentMeta" }, fmtTime(item.time)),
				react.createElement(
					"div",
					{ className: "fp_recentActions" },
					react.createElement(
						Tooltip,
						{ label: translate("row.open", { name: item.path }), side: "top", delayMs: 500 },
						react.createElement(
							"button",
							{ type: "button", className: "fp_chipButton", "data-primary": true, "aria-label": translate("row.open", { name: item.path }), onClick: open },
							react.createElement(IconRightUpOutline14, { size: 12 })
						)
					),
					react.createElement(
						Tooltip,
						{ label: translate("row.reveal", { name: item.path }), side: "top", delayMs: 500 },
						react.createElement(
							"button",
							{ type: "button", className: "fp_chipButton", "aria-label": translate("row.reveal", { name: item.path }), onClick: reveal },
							react.createElement(IconFolderOpenOutline16, { size: 12 })
						)
					)
				)
			);
		}

		/** The RECENT view body: the last 10 produced files of the session. */
		function RecentList({ items, t, openFile }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			if (!Array.isArray(items) || items.length === 0) {
				return react.createElement("div", { className: "fp_empty" }, translate("recent.empty"));
			}
			return react.createElement(
				"div",
				{ className: "fp_recentList", "data-file-preview-recent": true },
				items.map((item) => react.createElement(RecentRow, { item, t, openFile, key: item.path }))
			);
		}
		//#endregion

		//#region PreviewPanel
		/**
		 * Right-side floating panel, mounted in `shell.overlay`. Two views:
		 * RECENT (list) and PREVIEW (file body). Owns its fetch state; the
		 * shared store decides visibility, view, and target.
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

			// Poll while an Office conversion is running in the background.
			react.useEffect(() => {
				if (!state.open || state.path === null || data?.kind !== "pending") return;
				const timer = window.setTimeout(() => load(state.path), 3000);
				return () => window.clearTimeout(timer);
			}, [state.open, state.path, data, load]);

			if (!state.open) return null;

			const openExternal = () => {
				if (state.path !== null && !openViaHost(state.path)) {
					fetchJson("/api/file-preview/open", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: state.path })
					}).catch(() => {});
				}
			};

			const reveal = () => {
				if (state.path !== null && !openViaHost(dirnameOf(state.path))) {
					fetchJson("/api/file-preview/reveal", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: state.path })
					}).catch(() => {});
				}
			};

			// RECENT view: the last 10 produced files.
			if (state.view === "recent") {
				return react.createElement(
					"section",
					{ className: "fp_panel", "data-file-preview-panel": true, "data-file-preview-view": "recent", "aria-label": translate("recent.title") },
					react.createElement(
						"header",
						{ className: "fp_header" },
						react.createElement(
							"div",
							{ className: "fp_headerRow" },
							react.createElement("span", { className: "fp_title" }, translate("recent.title")),
							react.createElement(
								"div",
								{ className: "fp_headerActions" },
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
						react.createElement("div", { className: "fp_path" }, translate("recent.subtitle", { count: String(RECENT_LIMIT) }))
					),
					react.createElement(
						"div",
						{ className: "fp_body" },
						react.createElement(RecentList, { items: state.recent, t })
					)
				);
			}

			// PREVIEW view.
			return react.createElement(
				"section",
				{ className: "fp_panel", "data-file-preview-panel": true, "data-file-preview-view": "preview", "aria-label": translate("panel.title") },
				react.createElement(
					"header",
					{ className: "fp_header" },
					react.createElement(
						"div",
						{ className: "fp_headerRow" },
						state.recent.length > 0 && react.createElement(
							Tooltip,
							{ label: translate("panel.back"), side: "bottom", delayMs: 500 },
							react.createElement(
								"button",
								{ type: "button", className: "fp_iconButton", "aria-label": translate("panel.back"), onClick: showRecent },
								react.createElement(IconChevronLeftOutline14, { size: 14 })
							)
						),
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
			if (data.kind === "pending") {
				return react.createElement("p", { className: "fp_note", "data-file-preview-pending": true }, translate("panel.converting"));
			}
			if (data.kind === "office") {
				return react.createElement(
					react.Fragment,
					null,
					react.createElement("p", { className: "fp_note", "data-file-preview-office-note": true }, translate("panel.officeExtracted", { format: data.officeFormat ?? "" })),
					react.createElement("pre", { className: "fp_pre" }, data.content ?? ""),
					data.truncated === true && react.createElement("p", { className: "fp_truncated" }, translate("panel.truncated", { size: "1 MB" }))
				);
			}
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
				// Open the parent folder through the host opener (same sandbox-safe
				// mechanism the chat's file links use); Explorer shows the folder.
				if (typeof openFile === "function") {
					openFile(dirnameOf(path));
					return;
				}
				if (!openViaHost(dirnameOf(path))) {
					fetchJson("/api/file-preview/reveal", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path })
					}).catch(() => {});
				}
			};

			const open = (path) => {
				if (typeof openFile === "function") openFile(path);
				else if (!openViaHost(path)) {
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
		/** Sidebar footer action toggling the preview panel (opens the RECENT list). */
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
			"panel.office": "这是 Office 文档，暂不支持内嵌预览，请点击下方下载或用右上角“打开”查看。",
			"panel.download": "下载 {name}",
			"panel.open": "用默认程序打开",
			"panel.reveal": "打开所在文件夹",
			"panel.refresh": "刷新",
			"panel.close": "关闭",
			"panel.back": "返回最近文件",
			"recent.title": "最近文件",
			"recent.subtitle": "本会话最近 {count} 个文件，点击可预览",
			"recent.empty": "还没有最近文件——让助手创建或编辑文件后，它们会出现在这里。",
			"recent.preview": "预览 {name}",
			"row.label": "文件操作",
			"row.preview": "预览 {name}",
			"row.open": "打开 {name}",
			"row.reveal": "在文件夹中显示 {name}",
			"panel.officeExtracted": "无法可视化渲染，已提取文本预览（不含排版）",
			"panel.converting": "正在转换，完成后自动显示…（首次约 1–3 分钟）",
			"kind.text": "文本",
			"kind.image": "图片",
			"kind.pdf": "PDF",
			"kind.office": "Office",
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
			"panel.office": "This is an Office document; inline preview isn't supported. Download it below or use “Open” in the header.",
			"panel.download": "Download {name}",
			"panel.open": "Open with default app",
			"panel.reveal": "Open containing folder",
			"panel.refresh": "Refresh",
			"panel.close": "Close",
			"panel.back": "Back to recent files",
			"recent.title": "Recent files",
			"recent.subtitle": "Last {count} files of this session; click to preview",
			"recent.empty": "No recent files yet — ask the agent to create or edit files and they will show up here.",
			"recent.preview": "Preview {name}",
			"row.label": "Files",
			"row.preview": "Preview {name}",
			"row.open": "Open {name}",
			"row.reveal": "Show {name} in folder",
			"panel.officeExtracted": "Visual preview unavailable; showing extracted text (layout not included)",
			"panel.converting": "Converting… auto-refreshes when done (first time takes 1–3 min)",
			"kind.text": "text",
			"kind.image": "image",
			"kind.pdf": "PDF",
			"kind.office": "Office",
			"kind.binary": "binary",
			"kind.unknown": "file"
		};
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale", "connection"];

		/**
		 * Client plugin body: dictionaries, the frame-wide panel, the recent
		 * collector, the turn-tail file-action row, and the sidebar badge.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			// Host native opener (sandbox-safe): same remote the chat's file
			// links use, provided by the api-remotes client.
			hostOpener = ctx.get("workspaces") ?? ctx.workspaces ?? null;
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

			// Hidden session-scoped collector feeding the panel's RECENT list.
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "file-preview"
			}, RecentFilesCollector));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.PreviewPanel = PreviewPanel;
		exports.RecentList = RecentList;
		exports.RecentFilesCollector = RecentFilesCollector;
		exports.ProducedFileActions = ProducedFileActions;
		exports.SidebarBadge = SidebarBadge;
		exports.renderPreviewBody = renderPreviewBody;
		exports.kindLabel = kindLabel;
		exports.producedFilesFromSnapshot = producedFilesFromSnapshot;
		exports.producedForClosing = producedForClosing;
		exports.guessKind = guessKind;
		exports.openPreview = openPreview;
		exports.showRecent = showRecent;
		exports.togglePanel = togglePanel;
		exports.closePanel = closePanel;
		exports.setRecentFiles = setRecentFiles;
		return module.exports;
	}
});
