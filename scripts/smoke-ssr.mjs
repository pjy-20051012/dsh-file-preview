#!/usr/bin/env node

/**
 * SSR render test — renders the three client components to real HTML with
 * React 18 + react-dom/server against the installed profile's React, proving
 * the component trees construct and render without runtime errors (the one
 * layer a plain factory smoke cannot reach).
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const candidates = [
	process.env.SMOKE_NODE_MODULES,
	join(root, "node_modules"),
	join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "profiles", "node_modules")
].filter(Boolean);
let react = null;
let renderer = null;
for (const candidate of candidates) {
	try {
		const probe = createRequire(join(candidate, "noop.js"));
		react = probe("react");
		renderer = probe("react-dom/server");
		break;
	} catch {
		/* try next candidate */
	}
}
if (react === null || renderer === null) {
	console.error("Cannot resolve react + react-dom/server. Set SMOKE_NODE_MODULES to a node_modules root containing both.");
	process.exit(1);
}

const failures = [];
function check(label, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`ok - ${label}`))
		.catch((error) => {
			failures.push(label);
			console.error(`FAIL - ${label}: ${error?.message ?? error}`);
		});
}

const icon = () => null;
const primitivesStub = {
	Tooltip: ({ children }) => children ?? null,
	IconCloseOutline16: icon,
	IconRefreshOutline14: icon,
	IconFolderOpenOutline16: icon,
	IconRightUpOutline14: icon,
	IconPaperclipOutline16: icon,
	IconCodeOutline16: icon
};

async function loadBundle() {
	const source = await readFile(join(root, "lib", "client.js"), "utf8");
	let loaded = null;
	globalThis.window = { __ModuleLoader__: { load: (entry) => { loaded = entry; } }, document: undefined };
	new Function(`${source}\n//# sourceURL=client-bundle.js`)();
	const provided = {
		react,
		"react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: react.Fragment },
		"@deepseek-ai/dsh-client-ui-primitives": primitivesStub,
		"@deepseek-ai/dsh-client-locale": {},
		"@deepseek-ai/dsh-client-runtime": {},
		"@deepseek-ai/dsh-client-connection": {}
	};
	return loaded.factory((id) => {
		if (!(id in provided)) throw new Error(`unexpected require: ${id}`);
		return provided[id];
	});
}

const t = (key, params) => {
	const zh = {
		"panel.title": "文件预览",
		"panel.empty": "点击对话中的文件即可在右侧预览。",
		"panel.loading": "正在读取文件…",
		"panel.error": "读取失败：{message}",
		"panel.truncated": "内容过长，仅显示前 {size}。",
		"panel.binary": "此文件类型暂不支持预览。",
		"panel.open": "用默认程序打开",
		"panel.reveal": "打开所在文件夹",
		"panel.refresh": "刷新",
		"panel.close": "关闭",
		"badge": "文件预览",
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
	const template = zh[key] ?? key;
	return template.replace(/\{(\w+)\}/g, (match, name) => (params?.[name] !== void 0 ? String(params[name]) : match));
};

async function main() {
	const mod = await loadBundle();

	await check("SidebarBadge renders wide and rail variants", async () => {
		const wide = renderer.renderToString(react.createElement(mod.SidebarBadge, { wide: true, t }));
		assert.match(wide, /文件预览/);
		assert.match(wide, /fp_badge/);
		const rail = renderer.renderToString(react.createElement(mod.SidebarBadge, { wide: false, t }));
		assert.match(rail, /fp_rail/);
	});

	await check("ProducedFileActions renders chips with three actions per file", async () => {
		const html = renderer.renderToString(react.createElement(mod.ProducedFileActions, {
			matched: ["C:\\work\\a.txt", "C:\\work\\b.ts"],
			openFile: () => {},
			t
		}));
		assert.match(html, /文件操作/);
		assert.match(html, /a\.txt/);
		assert.match(html, /b\.ts/);
		assert.match(html, /预览 C:\\work\\a\.txt/);
		assert.match(html, /打开 C:\\work\\a\.txt/);
		assert.match(html, /在文件夹中显示 C:\\work\\a\.txt/);
		assert.equal((html.match(/fp_chipButton/g) ?? []).length, 4, "two files x two icon buttons");
	});

	await check("PreviewPanel renders nothing while closed", async () => {
		mod.closePanel();
		const html = renderer.renderToString(react.createElement(mod.PreviewPanel, { t }));
		assert.equal(html, "");
	});

	await check("PreviewPanel renders shell after openPreview", async () => {
		mod.openPreview("C:\\work\\a.txt");
		const html = renderer.renderToString(react.createElement(mod.PreviewPanel, { t }));
		assert.match(html, /fp_panel/);
		assert.match(html, /a\.txt/);
		assert.match(html, /打开所在文件夹/);
	});

	await check("renderPreviewBody renders text, image, pdf and binary bodies", async () => {
		const text = renderer.renderToString(react.createElement("div", null, mod.renderPreviewBody({ kind: "text", content: "const x = 1;" }, t)));
		assert.match(text, /const x = 1;/);
		const image = renderer.renderToString(react.createElement("div", null, mod.renderPreviewBody({ kind: "image", name: "p.png", url: "/api/file-preview/raw?path=x" }, t)));
		assert.match(image, /<img/);
		assert.match(image, /\/api\/file-preview\/raw\?path=x/);
		const pdf = renderer.renderToString(react.createElement("div", null, mod.renderPreviewBody({ kind: "pdf", name: "p.pdf", url: "/api/file-preview/raw?path=y" }, t)));
		assert.match(pdf, /<iframe/);
		const binary = renderer.renderToString(react.createElement("div", null, mod.renderPreviewBody({ kind: "binary" }, t)));
		assert.match(binary, /此文件类型暂不支持预览/);
	});

	await check("kindLabel maps kinds", async () => {
		assert.equal(mod.kindLabel("text", t), "文本");
		assert.equal(mod.kindLabel("pdf", t), "PDF");
		assert.equal(mod.kindLabel("image", t), "图片");
	});

	if (failures.length > 0) {
		console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
		process.exit(1);
	}
	console.log("\nAll SSR render checks passed.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
