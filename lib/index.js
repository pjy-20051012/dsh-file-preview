/**
 * dsh-file-preview — server half.
 *
 * Registers four loopback-only endpoints on the web server:
 *   GET  /api/file-preview/preview?path=<abs>  — file metadata + text content (or kind marker)
 *   GET  /api/file-preview/raw?path=<abs>      — raw bytes (images / PDF, for <img>/<iframe>)
 *   POST /api/file-preview/open                — { path } open with the OS default application
 *   POST /api/file-preview/reveal              — { path } reveal in the containing folder
 *
 * Every endpoint applies the same peer-socket loopback fence as dsh-usage-stats:
 * requests must come from a loopback interface and carry a loopback Host header.
 * Paths must be absolute; the preview endpoint only ever READS, never writes.
 *
 * @module dsh-file-preview
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute } from "node:path";

/** Stable Cordis plugin name. */
export const name = "file-preview";

/** Services required before this plugin activates. */
export const inject = ["webServer"];

export const PREVIEW_PATH = "/api/file-preview/preview";
export const RAW_PATH = "/api/file-preview/raw";
export const OPEN_PATH = "/api/file-preview/open";
export const REVEAL_PATH = "/api/file-preview/reveal";

/** Text content cap (bytes); larger files report `truncated: true`. */
const TEXT_LIMIT = 1024 * 1024;
/** Raw stream cap (bytes); anything larger is refused with 413. */
const RAW_LIMIT = 64 * 1024 * 1024;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif", ".tif", ".tiff"]);
const TEXT_EXT = new Set([
	".txt", ".md", ".markdown", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
	".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".java",
	".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php", ".swift", ".kt", ".kts", ".scala", ".sh", ".bash",
	".zsh", ".ps1", ".bat", ".cmd", ".sql", ".html", ".htm", ".css", ".scss", ".less", ".xml", ".svg",
	".csv", ".tsv", ".log", ".gitignore", ".gitattributes", ".editorconfig", ".env", ".vue", ".svelte",
	".lua", ".pl", ".r", ".dart", ".ex", ".exs", ".fs", ".fsx", ".nim", ".zig", ".tf", ".lock", ".diff", ".patch"
]);

const MIME = {
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
	".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff",
	".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
	".json": "application/json; charset=utf-8", ".yaml": "text/yaml; charset=utf-8", ".yml": "text/yaml; charset=utf-8",
	".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".ts": "text/typescript; charset=utf-8",
	".xml": "application/xml; charset=utf-8", ".csv": "text/csv; charset=utf-8"
};

//#region loopback fence (mirrors dsh-usage-stats)
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name = hostNameOf(req.headers.host);
	return name === "localhost" || isLoopbackAddress(name);
}

/** Refuse non-loopback callers and disallowed methods before any work. */
function rejectForeignCaller(req, res, allowed) {
	const methods = Array.isArray(allowed) ? allowed : [allowed];
	if (!methods.includes(req.method)) {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: methods.join(", ") });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return true;
	}
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({ ok: false, error: "forbidden" }));
	return true;
}
//#endregion

//#region path + body helpers
/** Windows drive, UNC, or POSIX-absolute path. */
export function isAbsolutePath(value) {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;
	if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
	if (/^\\\\/.test(value)) return true;
	return value.startsWith("/");
}

/** Read a JSON request body (bounded). */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) {
				req.destroy();
				reject(new Error("payload too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("invalid json body"));
			}
		});
		req.on("error", reject);
	});
}

function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}
//#endregion

//#region classification
export function classify(path, ext) {
	if (ext === ".pdf") return "pdf";
	if (IMAGE_EXT.has(ext)) return "image";
	if (TEXT_EXT.has(ext)) return "text";
	return "unknown";
}

/**
 * Sniff unknown files: no NUL byte in the head and a low fraction of
 * replacement characters ⇒ treat as text.
 */
export function sniffText(buffer) {
	if (buffer.includes(0)) return false;
	const sample = buffer.subarray(0, 8192).toString("utf8");
	let bad = 0;
	for (let i = 0; i < sample.length; i += 1) if (sample.charCodeAt(i) === 0xfffd) bad += 1;
	return bad / Math.max(1, sample.length) < 0.01;
}

/** Resolve a query path; returns null when missing or not absolute. */
function queryPath(req) {
	const url = new URL(req.url, "http://localhost");
	const path = url.searchParams.get("path");
	return isAbsolutePath(path) ? path : null;
}
//#endregion

//#region handlers
async function handlePreview(ctx, req, res) {
	if (rejectForeignCaller(req, res, "GET")) return;
	const path = queryPath(req);
	if (path === null) {
		json(res, 400, { ok: false, error: "bad-path", message: "path must be an absolute filesystem path" });
		return;
	}
	try {
		const info = await stat(path);
		if (!info.isFile()) {
			json(res, 404, { ok: false, error: "not-a-file", message: "path is not a regular file" });
			return;
		}
		const ext = extname(path).toLowerCase();
		const kind = classify(path, ext);
		const base = { ok: true, kind, name: basename(path), path, size: info.size, mtime: info.mtimeMs };
		if (kind === "image" || kind === "pdf") {
			json(res, 200, { ...base, url: `${RAW_PATH}?path=${encodeURIComponent(path)}` });
			return;
		}
		let buffer;
		try {
			buffer = await readFile(path);
		} catch (error) {
			json(res, 500, { ok: false, error: "read-failed", message: error instanceof Error ? error.message : String(error) });
			return;
		}
		const isText = kind === "text" || (kind === "unknown" && sniffText(buffer));
		if (!isText) {
			json(res, 200, { ...base, kind: "binary" });
			return;
		}
		const truncated = buffer.length > TEXT_LIMIT;
		const content = buffer.subarray(0, TEXT_LIMIT).toString("utf8");
		json(res, 200, { ...base, kind: "text", content, truncated });
	} catch (error) {
		if (error?.code === "ENOENT") {
			json(res, 404, { ok: false, error: "not-found", message: "file does not exist" });
			return;
		}
		ctx.logger.warn(`file-preview: preview failed for "${path}": ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

async function handleRaw(ctx, req, res) {
	if (rejectForeignCaller(req, res, "GET")) return;
	const path = queryPath(req);
	if (path === null) {
		json(res, 400, { ok: false, error: "bad-path", message: "path must be an absolute filesystem path" });
		return;
	}
	try {
		const info = await stat(path);
		if (!info.isFile()) {
			json(res, 404, { ok: false, error: "not-a-file", message: "path is not a regular file" });
			return;
		}
		if (info.size > RAW_LIMIT) {
			json(res, 413, { ok: false, error: "too-large", message: "file exceeds the raw preview size cap" });
			return;
		}
		const ext = extname(path).toLowerCase();
		const type = MIME[ext] ?? "application/octet-stream";
		res.writeHead(200, {
			"content-type": type,
			"content-length": info.size,
			"cache-control": "no-cache",
			"content-disposition": `inline; filename="${basename(path).replace(/["\\]/g, "_")}"`,
			"x-content-type-options": "nosniff"
		});
		const stream = createReadStream(path);
		stream.on("error", (error) => {
			ctx.logger.warn(`file-preview: raw stream failed for "${path}": ${String(error)}`);
			if (!res.headersSent) {
				json(res, 500, { ok: false, error: "read-failed", message: error instanceof Error ? error.message : String(error) });
			} else {
				res.destroy(error);
			}
		});
		stream.pipe(res);
	} catch (error) {
		if (error?.code === "ENOENT") {
			json(res, 404, { ok: false, error: "not-found", message: "file does not exist" });
			return;
		}
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/** Spawn a detached, fire-and-forget native command. Returns false when spawning throws. */
function spawnDetached(command, args) {
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}

/** Open one path with the OS default application. */
function openNative(path) {
	if (process.platform === "win32") {
		return spawnDetached("cmd.exe", ["/c", "start", "", `"${path}"`]);
	}
	if (process.platform === "darwin") {
		return spawnDetached("open", [path]);
	}
	return spawnDetached("xdg-open", [path]);
}

/** Reveal one path in its containing folder. */
function revealNative(path) {
	if (process.platform === "win32") {
		return spawnDetached("explorer.exe", [`/select,${path}`]);
	}
	if (process.platform === "darwin") {
		return spawnDetached("open", ["-R", path]);
	}
	// Linux has no portable reveal; open the containing folder instead.
	return spawnDetached("xdg-open", [dirname(path)]);
}

async function handleAction(ctx, req, res, action) {
	if (rejectForeignCaller(req, res, "POST")) return;
	let payload;
	try {
		payload = await readBody(req);
	} catch (error) {
		json(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
		return;
	}
	const path = payload?.path;
	if (!isAbsolutePath(path)) {
		json(res, 400, { ok: false, error: "bad-path", message: "path must be an absolute filesystem path" });
		return;
	}
	try {
		await stat(path);
	} catch (error) {
		json(res, 404, { ok: false, error: "not-found", message: error?.code === "ENOENT" ? "path does not exist" : (error instanceof Error ? error.message : String(error)) });
		return;
	}
	const launched = action === "open" ? openNative(path) : revealNative(path);
	if (!launched) {
		json(res, 500, { ok: false, error: "launch-failed", message: "could not launch the native opener" });
		return;
	}
	json(res, 200, { ok: true });
}

//#endregion

/**
 * Plugin body: register the four exact routes on the web server.
 * @param ctx - plugin context carrying webServer.
 */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: PREVIEW_PATH,
		handler: (req, res) => handlePreview(ctx, req, res)
	}), "file-preview: preview route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: RAW_PATH,
		handler: (req, res) => handleRaw(ctx, req, res)
	}), "file-preview: raw route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: OPEN_PATH,
		handler: (req, res) => handleAction(ctx, req, res, "open")
	}), "file-preview: open route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: REVEAL_PATH,
		handler: (req, res) => handleAction(ctx, req, res, "reveal")
	}), "file-preview: reveal route");
}
