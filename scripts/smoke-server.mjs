#!/usr/bin/env node

/**
 * Offline server smoke test — no dsh required.
 *
 * Boots the plugin's routes on a plain node:http server with a fake ctx,
 * then exercises the loopback fence, path validation, classification, and
 * every endpoint against real temporary files. Exits non-zero on any failure.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, classify, convertOfficeToPdf, extractOffice, explorerSelectArg, isAbsolutePath, officeConverterKind, sniffText, PREVIEW_PATH, RAW_PATH, OPEN_PATH, REVEAL_PATH } from "../lib/index.js";

/**
 * Build a minimal ZIP archive with STORED entries (method 0) — enough for
 * the plugin's own zip reader and for realistic docx/xlsx/pptx fixtures.
 */
function buildZip(entries) {
	const parts = [];
	const central = [];
	let offset = 0;
	for (const { name, data } of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(0, 8); // stored
		local.writeUInt32LE(0, 14); // crc (reader does not validate)
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		parts.push(local, nameBuf, data);
		central.push({ nameBuf, data, offset });
		offset += 30 + nameBuf.length + data.length;
	}
	const centralStart = offset;
	const centralParts = [];
	for (const { nameBuf, data, offset: o } of central) {
		const c = Buffer.alloc(46);
		c.writeUInt32LE(0x02014b50, 0);
		c.writeUInt16LE(20, 4);
		c.writeUInt16LE(20, 6);
		c.writeUInt16LE(0x0800, 8);
		c.writeUInt16LE(0, 10);
		c.writeUInt32LE(0, 16);
		c.writeUInt32LE(data.length, 20);
		c.writeUInt32LE(data.length, 24);
		c.writeUInt16LE(nameBuf.length, 28);
		c.writeUInt16LE(0, 30);
		c.writeUInt16LE(0, 32);
		c.writeUInt16LE(0, 34);
		c.writeUInt16LE(0, 36);
		c.writeUInt32LE(0, 38);
		c.writeUInt32LE(o, 42);
		centralParts.push(c, nameBuf);
	}
	const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralStart, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...parts, ...centralParts, eocd]);
}

/** Minimal .docx fixture: two paragraphs with Chinese + entities. */
function docxFixture() {
	const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX 标题</w:t></w:r></w:p><w:p><w:r><w:t>第二段 &amp; 内容</w:t></w:r></w:p></w:body></w:document>`;
	return buildZip([
		{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
		{ name: "word/document.xml", data: Buffer.from(xml, "utf8") }
	]);
}

/** Minimal .xlsx fixture: shared strings + one sheet with two rows. */
function xlsxFixture() {
	const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>名称</t></si><si><t>数量</t></si><si><t>苹果</t></si></sst>`;
	const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>5</t></is></c></row></sheetData></worksheet>`;
	return buildZip([
		{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
		{ name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf8") },
		{ name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") }
	]);
}

/** Minimal .pptx fixture: one slide with one text run. */
function pptxFixture() {
	const slide = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
	return buildZip([
		{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
		{ name: "ppt/slides/slide1.xml", data: Buffer.from(slide, "utf8") }
	]);
}

/** Minimal .odt fixture (ODF has no COM converter → deterministic text fallback). */
function odtFixture() {
	const xml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Hello ODT 文档</text:p><text:p>第二行内容</text:p></office:text></office:body></office:document-content>`;
	return buildZip([
		{ name: "content.xml", data: Buffer.from(xml, "utf8") }
	]);
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

async function main() {
	// Unit checks on exported pure helpers.
	await check("isAbsolutePath accepts Windows drives and POSIX roots, rejects relative", async () => {
		assert.equal(isAbsolutePath("C:\\Users\\a\\b.txt"), true);
		assert.equal(isAbsolutePath("C:/Users/a/b.txt"), true);
		assert.equal(isAbsolutePath("\\\\server\\share\\a.txt"), true);
		assert.equal(isAbsolutePath("/home/user/a.txt"), true);
		assert.equal(isAbsolutePath("relative/path.txt"), false);
		assert.equal(isAbsolutePath("a.txt"), false);
		assert.equal(isAbsolutePath(""), false);
		assert.equal(isAbsolutePath("C:\\a\0b.txt"), false);
	});

	await check("classify groups extensions", async () => {
		assert.equal(classify("/x/a.png", ".png"), "image");
		assert.equal(classify("/x/a.pdf", ".pdf"), "pdf");
		assert.equal(classify("/x/a.ts", ".ts"), "text");
		assert.equal(classify("/x/a.pptx", ".pptx"), "office");
		assert.equal(classify("/x/a.docx", ".docx"), "office");
		assert.equal(classify("/x/a.xlsx", ".xlsx"), "office");
		assert.equal(classify("/x/a.zzz", ".zzz"), "unknown");
	});

	await check("sniffText distinguishes text from binary", async () => {
		assert.equal(sniffText(Buffer.from("hello world\nline two")), true);
		assert.equal(sniffText(Buffer.from([0xff, 0x00, 0x01, 0x02])), false); // NUL byte → binary
		assert.equal(sniffText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x0d])), true); // no NUL → text
	});

	await check("extractOffice extracts docx paragraphs with entities", async () => {
		const text = extractOffice(docxFixture(), "docx");
		assert.ok(text !== null, "extraction must succeed");
		assert.match(text, /Hello DOCX 标题/);
		assert.match(text, /第二段 & 内容/);
	});

	await check("extractOffice extracts xlsx shared strings and cells", async () => {
		const text = extractOffice(xlsxFixture(), "xlsx");
		assert.ok(text !== null, "extraction must succeed");
		assert.match(text, /--- Sheet 1 ---/);
		assert.match(text, /名称\t数量/);
		assert.match(text, /苹果\t5/);
	});

	await check("extractOffice extracts pptx slide text", async () => {
		const text = extractOffice(pptxFixture(), "pptx");
		assert.ok(text !== null, "extraction must succeed");
		assert.match(text, /--- Slide 1 ---/);
		assert.match(text, /第一页标题/);
	});

	await check("extractOffice rejects non-zip content (handler degrades to binary)", async () => {
		assert.throws(() => extractOffice(Buffer.from("not a zip at all"), "docx"), /not a zip/);
		assert.throws(() => extractOffice(Buffer.from([0x00, 0x01, 0x02]), "xlsx"));
	});

	await check("officeConverterKind maps formats to COM converters", async () => {
		assert.equal(officeConverterKind("docx"), "word");
		assert.equal(officeConverterKind("doc"), "word");
		assert.equal(officeConverterKind("xlsx"), "excel");
		assert.equal(officeConverterKind("xls"), "excel");
		assert.equal(officeConverterKind("pptx"), "powerpoint");
		assert.equal(officeConverterKind("ppt"), "powerpoint");
		assert.equal(officeConverterKind("odt"), null);
		assert.equal(officeConverterKind("ods"), null);
		assert.equal(officeConverterKind("odp"), null);
	});

	await check("convertOfficeToPdf returns null for formats without a converter (no spawn)", async () => {
		assert.equal(await convertOfficeToPdf("C:\\x\\a.odt", "odt", 100, 1000), null);
	});

	await check("explorerSelectArg quotes the path for explorer", async () => {
		assert.equal(explorerSelectArg("C:\\a b\\file.txt"), "/select,\"C:\\a b\\file.txt\"");
		assert.equal(explorerSelectArg("E:\\ds harness\\a.docx"), "/select,\"E:\\ds harness\\a.docx\"");
		assert.equal(explorerSelectArg("C:\\x\"y.txt"), "/select,\"C:\\xy.txt\"");
	});

	// Boot a real http server that routes through the plugin's handlers.
	const routes = [];
	const disposers = [];
	const ctx = {
		logger: { warn: () => {} },
		effect: (fn, label) => {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			else console.log(`note - effect installed: ${label}`);
		},
		webServer: {
			register: (route) => {
				routes.push(route);
				return () => {};
			}
		}
	};
	apply(ctx);
	assert.equal(routes.length, 4, "four routes registered");

	const server = createServer((req, res) => {
		const url = new URL(req.url, "http://localhost");
		const route = routes.find((r) => r.kind === "exact" && r.path === url.pathname);
		if (route === void 0) {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "no-route" }));
			return;
		}
		route.handler(req, res);
	});

	await new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	const base = `http://127.0.0.1:${port}`;

	const tmp = await mkdtemp(join(tmpdir(), "dsh-file-preview-test-"));
	const textFile = join(tmp, "sample.ts");
	const imageFile = join(tmp, "pic.png");
	const binFile = join(tmp, "archive.zip");
	const docxFile = join(tmp, "报告.docx");
	const odtFile = join(tmp, "报告.odt");
	const corruptOdtFile = join(tmp, "坏文档.odt");
	await writeFile(textFile, "const answer = 42;\n// 中文注释\n", "utf8");
	await writeFile(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
	await writeFile(binFile, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));
	await writeFile(odtFile, odtFixture());
	await writeFile(corruptOdtFile, Buffer.from("this is not a zip document, sorry", "utf8"));

	const get = async (path, headers = {}) => {
		const response = await fetch(`${base}${path}`, { headers });
		const body = await response.arrayBuffer();
		return { status: response.status, headers: response.headers, body: Buffer.from(body) };
	};
	const post = async (path, payload) => {
		const response = await fetch(`${base}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload)
		});
		const body = await response.json();
		return { status: response.status, body };
	};

	await check("preview returns text content", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(textFile)}`);
		assert.equal(status, 200);
		const payload = JSON.parse(body.toString("utf8"));
		assert.equal(payload.ok, true);
		assert.equal(payload.kind, "text");
		assert.equal(payload.name, "sample.ts");
		assert.match(payload.content, /const answer = 42/);
		assert.match(payload.content, /中文注释/);
		assert.equal(payload.truncated, false);
	});

	await check("preview classifies images with raw url", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(imageFile)}`);
		assert.equal(status, 200);
		const payload = JSON.parse(body.toString("utf8"));
		assert.equal(payload.kind, "image");
		assert.equal(payload.url, `${RAW_PATH}?path=${encodeURIComponent(imageFile)}`);
	});

	await check("preview falls back to ODF text extraction over HTTP (no COM converter)", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(odtFile)}`);
		assert.equal(status, 200);
		const payload = JSON.parse(body.toString("utf8"));
		assert.equal(payload.kind, "office");
		assert.equal(payload.officeFormat, "odt");
		assert.match(payload.content, /Hello ODT 文档/);
		assert.match(payload.content, /第二行内容/);
		assert.equal(payload.truncated, false);
	});

	await check("preview degrades a corrupt office file to binary", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(corruptOdtFile)}`);
		assert.equal(status, 200);
		const payload = JSON.parse(body.toString("utf8"));
		assert.equal(payload.kind, "binary");
	});

	await check("preview classifies unknown binary", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(binFile)}`);
		assert.equal(status, 200);
		const payload = JSON.parse(body.toString("utf8"));
		assert.equal(payload.kind, "binary");
		assert.equal(payload.content, void 0);
	});

	await check("preview 404 on missing file", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent(join(tmp, "nope.txt"))}`);
		assert.equal(status, 404);
		assert.equal(JSON.parse(body.toString("utf8")).ok, false);
	});

	await check("preview 400 on relative path", async () => {
		const { status, body } = await get(`${PREVIEW_PATH}?path=${encodeURIComponent("relative.txt")}`);
		assert.equal(status, 400);
		assert.equal(JSON.parse(body.toString("utf8")).ok, false);
	});

	await check("preview 400 on missing path param", async () => {
		const { status } = await get(PREVIEW_PATH);
		assert.equal(status, 400);
	});

	await check("raw serves bytes with content-type", async () => {
		const { status, headers, body } = await get(`${RAW_PATH}?path=${encodeURIComponent(imageFile)}`);
		assert.equal(status, 200);
		assert.equal(headers.get("content-type"), "image/png");
		assert.equal(body[0], 0x89);
		assert.equal(headers.get("content-disposition").startsWith("inline;"), true);
	});

	await check("raw 404 on missing file", async () => {
		const { status } = await get(`${RAW_PATH}?path=${encodeURIComponent(join(tmp, "nope.png"))}`);
		assert.equal(status, 404);
	});

	await check("open POST returns ok", async () => {
		const { status, body } = await post(OPEN_PATH, { path: textFile });
		assert.equal(status, 200);
		assert.equal(body.ok, true);
	});

	await check("reveal POST returns ok", async () => {
		const { status, body } = await post(REVEAL_PATH, { path: textFile });
		assert.equal(status, 200);
		assert.equal(body.ok, true);
	});

	await check("open POST rejects relative path", async () => {
		const { status, body } = await post(OPEN_PATH, { path: "relative.txt" });
		assert.equal(status, 400);
		assert.equal(body.ok, false);
	});

	await check("open POST 404 on missing file", async () => {
		const { status, body } = await post(OPEN_PATH, { path: join(tmp, "gone.txt") });
		assert.equal(status, 404);
		assert.equal(body.ok, false);
	});

	await check("GET on POST-only route is 405", async () => {
		const { status } = await get(OPEN_PATH);
		assert.equal(status, 405);
	});

	await check("POST on GET-only route is 405", async () => {
		const { status } = await post(PREVIEW_PATH, { path: textFile });
		assert.equal(status, 405);
	});

	await check("unknown route is 404", async () => {
		const { status } = await get("/api/file-preview/nope");
		assert.equal(status, 404);
	});

	for (const dispose of disposers) dispose();
	server.close();
	await rm(tmp, { recursive: true, force: true });

	if (failures.length > 0) {
		console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
		process.exit(1);
	}
	console.log("\nAll server smoke checks passed.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
