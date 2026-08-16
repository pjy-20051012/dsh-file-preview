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
/** OOXML/ODF containers previewable as extracted text (zip-based). */
const OFFICE_EXT = new Map([
	[".docx", "docx"], [".xlsx", "xlsx"], [".pptx", "pptx"],
	[".odt", "odt"], [".ods", "ods"], [".odp", "odp"]
]);
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
	".xml": "application/xml; charset=utf-8", ".csv": "text/csv; charset=utf-8",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".ppt": "application/vnd.ms-powerpoint",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".doc": "application/msword",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xls": "application/vnd.ms-excel",
	".odp": "application/vnd.oasis.opendocument.presentation",
	".odt": "application/vnd.oasis.opendocument.text",
	".ods": "application/vnd.oasis.opendocument.spreadsheet"
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
	if (OFFICE_EXT.has(ext)) return "office";
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

//#region office extraction (dependency-free zip + XML text)
/**
 * List the central directory of a ZIP buffer. Office documents are ZIP
 * containers; this minimal reader supports stored (0) and deflate (8)
 * entries, which covers real-world docx/xlsx/pptx/odf files.
 */
export function listZipEntries(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("not a zip");
	// End of central directory: scan the tail window.
	let eocd = -1;
	const start = Math.max(0, buffer.length - 22 - 65536);
	for (let i = buffer.length - 22; i >= start; i -= 1) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) throw new Error("zip end-of-central-directory not found");
	const count = buffer.readUInt16LE(eocd + 10);
	const cdOffset = buffer.readUInt32LE(eocd + 16);
	const entries = [];
	let p = cdOffset;
	for (let i = 0; i < count; i += 1) {
		if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) break;
		const method = buffer.readUInt16LE(p + 10);
		const compressedSize = buffer.readUInt32LE(p + 20);
		const nameLen = buffer.readUInt16LE(p + 28);
		const extraLen = buffer.readUInt16LE(p + 30);
		const commentLen = buffer.readUInt16LE(p + 32);
		const localOffset = buffer.readUInt32LE(p + 42);
		const name = buffer.subarray(p + 46, p + 46 + nameLen).toString("utf8");
		entries.push({ name, method, compressedSize, localOffset });
		p += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

/** Extract one ZIP entry's bytes (stored or deflate). */
export function extractZipEntry(buffer, entry) {
	if (entry.localOffset + 30 > buffer.length) throw new Error("local header out of range");
	const nameLen = buffer.readUInt16LE(entry.localOffset + 26);
	const extraLen = buffer.readUInt16LE(entry.localOffset + 28);
	const dataStart = entry.localOffset + 30 + nameLen + extraLen;
	const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
	if (entry.method === 0) return raw;
	if (entry.method === 8) return inflateRawSync(raw);
	throw new Error(`unsupported zip compression method ${entry.method}`);
}

/** Find a zip entry by exact name; null when absent. */
function zipEntry(buffer, name) {
	return listZipEntries(buffer).find((entry) => entry.name === name) ?? null;
}

/** Decode XML entities (named + numeric). */
export function decodeXmlEntities(text) {
	return text
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
		.replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

/** Strip every XML tag. */
function stripTags(xml) {
	return xml.replace(/<[^>]+>/g, "");
}

/** Collect `<t>` runs of a sharedStrings `<si>` block (concatenated). */
function siText(siBlock) {
	const runs = [];
	const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
	let m;
	while ((m = re.exec(siBlock)) !== null) runs.push(m[1]);
	return decodeXmlEntities(runs.join(""));
}

/**
 * Extract readable text from an Office container. Returns the text or null
 * when the file is not a valid container of the expected kind.
 */
export function extractOffice(buffer, format) {
	const entries = listZipEntries(buffer);
	const find = (name) => {
		const entry = entries.find((e) => e.name === name);
		return entry === void 0 ? null : extractZipEntry(buffer, entry).toString("utf8");
	};
	if (format === "docx") {
		const doc = find("word/document.xml");
		if (doc === null) return null;
		return decodeXmlEntities(stripTags(
			doc.replace(/<\/w:p>/g, "\n").replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br\s*\/>/g, "\n").replace(/<w:cr\s*\/>/g, "\n")
		)).replace(/\n{3,}/g, "\n\n").trim();
	}
	if (format === "xlsx") {
		const shared = find("xl/sharedStrings.xml");
		const strings = [];
		if (shared !== null) {
			const siRe = /<si>([\s\S]*?)<\/si>/g;
			let m;
			while ((m = siRe.exec(shared)) !== null) strings.push(siText(m[1]));
		}
		const sheets = entries
			.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
			.sort((a, b) => {
				const na = Number(/sheet(\d+)\.xml$/.exec(a.name)[1]);
				const nb = Number(/sheet(\d+)\.xml$/.exec(b.name)[1]);
				return na - nb;
			});
		const parts = [];
		for (let s = 0; s < sheets.length; s += 1) {
			const xml = extractZipEntry(buffer, sheets[s]).toString("utf8");
			const rows = [];
			const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
			let rm;
			while ((rm = rowRe.exec(xml)) !== null) {
				const cells = [];
				const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
				let cm;
				while ((cm = cellRe.exec(rm[1])) !== null) {
					const attrs = cm[1];
					const inner = cm[2];
					const type = /t="([^"]*)"/.exec(attrs)?.[1];
					if (type === "s") {
						const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "NaN");
						cells.push(Number.isFinite(idx) && strings[idx] !== void 0 ? strings[idx] : inner.trim());
					} else if (type === "inlineStr") {
						cells.push(decodeXmlEntities(stripTags(inner)).trim());
					} else {
						cells.push(decodeXmlEntities(stripTags(inner)).trim());
					}
				}
				if (cells.length > 0) rows.push(cells.join("\t"));
			}
			if (rows.length > 0) {
				parts.push(`--- Sheet ${s + 1} ---\n${rows.join("\n")}`);
			}
		}
		return parts.join("\n\n");
	}
	if (format === "pptx") {
		const slides = entries
			.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
			.sort((a, b) => {
				const na = Number(/slide(\d+)\.xml$/.exec(a.name)[1]);
				const nb = Number(/slide(\d+)\.xml$/.exec(b.name)[1]);
				return na - nb;
			});
		const parts = [];
		for (let s = 0; s < slides.length; s += 1) {
			const xml = extractZipEntry(buffer, slides[s]).toString("utf8");
			const texts = [];
			const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
			let m;
			while ((m = tRe.exec(xml)) !== null) texts.push(decodeXmlEntities(m[1]));
			if (texts.length > 0) parts.push(`--- Slide ${s + 1} ---\n${texts.join("\n")}`);
		}
		return parts.join("\n\n");
	}
	// OpenDocument family: single content.xml.
	const content = find("content.xml");
	if (content === null) return null;
	const withBreaks = content
		.replace(/<\/text:p>/g, "\n")
		.replace(/<text:tab\s*\/>/g, "\t")
		.replace(/<text:line-break\s*\/>/g, "\n")
		.replace(/<\/table:table-row>/g, "\n")
		.replace(/<\/table:table-cell>/g, "\t")
		.replace(/<\/draw:page>/g, "\n--- Page ---\n");
	return decodeXmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim();
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
		if (kind === "office") {
			const format = OFFICE_EXT.get(ext);
			try {
				const extracted = extractOffice(buffer, format);
				if (extracted !== null && extracted.length > 0) {
					const truncated = extracted.length > TEXT_LIMIT;
					json(res, 200, { ...base, kind: "office", officeFormat: format, content: extracted.slice(0, TEXT_LIMIT), truncated });
					return;
				}
			} catch (error) {
				ctx.logger.warn(`file-preview: office extraction failed for "${path}": ${String(error)}`);
			}
			json(res, 200, { ...base, kind: "binary" });
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

/**
 * Explorer's `/select` argument. Explorer parses the path itself and needs
 * the path quoted INSIDE the argument; spawn then passes it verbatim, so a
 * path containing spaces survives (the classic unquoted form silently opens
 * nothing). Quotes inside the path are stripped.
 */
export function explorerSelectArg(path) {
	return `/select,"${path.replace(/"/g, "")}"`;
}

/** Reveal one path in its containing folder. */
function revealNative(path) {
	if (process.platform === "win32") {
		return spawnDetached("explorer.exe", [explorerSelectArg(path)]);
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
