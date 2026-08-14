#!/usr/bin/env node

/**
 * Installer regression test — fully offline.
 *
 * Drives scripts/install.mjs as a library against a temporary DSH_HOME and
 * asserts: fresh install, idempotent re-install, --check pass/fail behavior,
 * and --no-enable leaving the patch untouched. Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../scripts/install.mjs";

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
	const home = await mkdtemp(join(tmpdir(), "dsh-file-preview-install-test-"));
	const env = { ...process.env, DSH_HOME: home };
	const patchPath = join(home, "profiles", "web", "cordis.patch.yml");
	const target = join(home, "profiles", "node_modules", "dsh-file-preview");
	const line = /^\s+name:\s*dsh-file-preview\s*$/gm;

	try {
		await check("unknown flag exits 2", async () => {
			assert.equal(await run(["--bogus"], env), 2);
		});

		await check("dry-run changes nothing", async () => {
			assert.equal(await run(["--dry-run"], env), 0);
			await assert.rejects(readFile(patchPath, "utf8"));
		});

		await check("fresh install copies package and patches once", async () => {
			assert.equal(await run([], env), 0);
			const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
			assert.equal(pkg.name, "dsh-file-preview");
			const patch = await readFile(patchPath, "utf8");
			assert.equal([...patch.matchAll(line)].length, 1);
		});

		await check("re-install is idempotent", async () => {
			assert.equal(await run([], env), 0);
			const patch = await readFile(patchPath, "utf8");
			assert.equal([...patch.matchAll(line)].length, 1, "patch must still contain exactly one entry");
		});

		await check("--check passes after install", async () => {
			assert.equal(await run(["--check"], env), 0);
		});

		await check("--no-enable does not touch the patch", async () => {
			const before = await readFile(patchPath, "utf8");
			assert.equal(await run(["--no-enable"], env), 0);
			const after = await readFile(patchPath, "utf8");
			assert.equal(after, before);
		});

		await check("--check fails after removing the patch entry", async () => {
			const patched = (await readFile(patchPath, "utf8")).replace(line, "");
			const { writeFile } = await import("node:fs/promises");
			await writeFile(patchPath, patched, "utf8");
			await assert.rejects(run(["--check"], env), /expected exactly one/);
		});

		await check("--check fails when the package is missing", async () => {
			await rm(target, { recursive: true, force: true });
			await assert.rejects(run(["--check"], env), /not installed/);
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}

	if (failures.length > 0) {
		console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
		process.exit(1);
	}
	console.log("\nAll installer checks passed.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
