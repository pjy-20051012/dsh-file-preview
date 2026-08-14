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
import { apply, classify, isAbsolutePath, sniffText, PREVIEW_PATH, RAW_PATH, OPEN_PATH, REVEAL_PATH } from "../lib/index.js";

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
		assert.equal(classify("/x/a.zzz", ".zzz"), "unknown");
	});

	await check("sniffText distinguishes text from binary", async () => {
		assert.equal(sniffText(Buffer.from("hello world\nline two")), true);
		assert.equal(sniffText(Buffer.from([0xff, 0x00, 0x01, 0x02])), false); // NUL byte → binary
		assert.equal(sniffText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x0d])), true); // no NUL → text
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
	await writeFile(textFile, "const answer = 42;\n// 中文注释\n", "utf8");
	await writeFile(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
	await writeFile(binFile, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]));

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
