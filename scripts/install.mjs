#!/usr/bin/env node

/**
 * dsh-file-preview installer — mirrors the dsh-usage-stats installer.
 *
 * Copies the run files to `<DSH_HOME>/profiles/node_modules/dsh-file-preview`
 * and idempotently enables the plugin in `<DSH_HOME>/profiles/web/cordis.patch.yml`.
 *
 * Flags: --check | --dry-run | --no-enable | --help
 * Exit codes: 2 unknown option; non-zero on validation failure; 0 on success.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const knownFlags = new Set(["--check", "--dry-run", "--no-enable", "--help"]);

/**
 * Run the installer as a library (used by tests with a temporary DSH_HOME).
 * @param argv - CLI arguments (defaults to process.argv.slice(2)).
 * @param env - environment override (defaults to process.env).
 * @returns the process exit code.
 */
export async function run(argv = process.argv.slice(2), env = process.env) {
	const args = new Set(argv);
	for (const arg of args) {
		if (!knownFlags.has(arg)) {
			console.error(`Unknown option: ${arg}`);
			return 2;
		}
	}

	if (args.has("--help")) {
		console.log(`dsh-file-preview installer

Usage:
  node scripts/install.mjs [options]

Options:
  --check      Verify the installed package and Cordis patch without changing them
  --dry-run    Print the resolved paths and planned changes
  --no-enable  Install files without editing cordis.patch.yml
  --help       Show this help

Set DSH_HOME to override the default ~/.dsh location.`);
		return 0;
	}

	const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	const sourcePackage = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
	const dshHome = env.DSH_HOME ?? join(homedir(), ".dsh");
	const target = join(dshHome, "profiles", "node_modules", "dsh-file-preview");
	const patchPath = join(dshHome, "profiles", "web", "cordis.patch.yml");
	const pluginLine = /^\s+name:\s*dsh-file-preview\s*$/gm;
	const patchBlock = `# dsh-file-preview: conversation file links + right-side preview panel
- insert:
    - id: file-preview
      name: dsh-file-preview
`;

	async function readOptional(path) {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if (error?.code === "ENOENT") return null;
			throw error;
		}
	}

	async function verify(expectEnabled) {
		const installedRaw = await readOptional(join(target, "package.json"));
		if (installedRaw === null) throw new Error(`package is not installed at ${target}`);
		const installed = JSON.parse(installedRaw);
		if (installed.name !== sourcePackage.name || installed.version !== sourcePackage.version) {
			throw new Error(`installed package is ${installed.name ?? "unknown"}@${installed.version ?? "unknown"}; expected ${sourcePackage.name}@${sourcePackage.version}`);
		}
		if (expectEnabled) {
			const patch = await readOptional(patchPath);
			const count = patch === null ? 0 : [...patch.matchAll(pluginLine)].length;
			if (count !== 1) throw new Error(`expected exactly one dsh-file-preview entry in ${patchPath}; found ${count}`);
		}
		console.log(`Verified ${sourcePackage.name}@${sourcePackage.version}`);
		console.log(`  package: ${target}`);
		if (expectEnabled) console.log(`  patch:   ${patchPath}`);
	}

	const enable = !args.has("--no-enable");
	if (args.has("--dry-run")) {
		console.log(`Would install ${sourcePackage.name}@${sourcePackage.version}`);
		console.log(`  package: ${target}`);
		console.log(`  patch:   ${enable ? patchPath : "unchanged (--no-enable)"}`);
		return 0;
	}

	if (args.has("--check")) {
		await verify(enable);
		return 0;
	}

	await mkdir(target, { recursive: true });
	for (const entry of ["lib", "package.json", "README.md", "LICENSE", "SECURITY.md"]) {
		await cp(join(sourceRoot, entry), join(target, entry), { recursive: true, force: true });
	}
	await mkdir(join(target, "scripts"), { recursive: true });
	await cp(fileURLToPath(import.meta.url), join(target, "scripts", "install.mjs"), { force: true });

	if (enable) {
		await mkdir(dirname(patchPath), { recursive: true });
		const current = await readOptional(patchPath) ?? "";
		if (![...current.matchAll(pluginLine)].length) {
			const separator = current === "" || current.endsWith("\n") ? "" : "\n";
			const leading = current === "" ? "" : "\n";
			await writeFile(patchPath, `${current}${separator}${leading}${patchBlock}`, "utf8");
		}
	}

	await verify(enable);
	console.log("Installation complete. Restart dsh web, then hard-refresh the browser.");
	return 0;
}

// CLI entry: run only when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exit(await run());
}
