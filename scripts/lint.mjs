import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSettings } from "../src/core/configStore.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirs = new Set([".git", "dist", "logs", "node_modules"]);
const sourceExtensions = new Set([".js", ".jsx"]);
const nodeCheckExtensions = new Set([".js", ".mjs"]);
const importableExtensions = ["", ".js", ".jsx", ".mjs", ".json", ".css"];
const indexCandidates = ["index.js", "index.jsx", "index.mjs"];
const issues = [];

function relative(file) {
  return path.relative(repoRoot, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    issues.push(`${relative(file)}: invalid JSON (${error.message})`);
    return null;
  }
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...(await walk(path.join(directory, entry.name))));
      continue;
    }

    files.push(path.join(directory, entry.name));
  }

  return files;
}

function fileExists(file) {
  try {
    return fsSync.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [];

  for (const extension of importableExtensions) {
    candidates.push(`${base}${extension}`);
  }

  for (const indexFile of indexCandidates) {
    candidates.push(path.join(base, indexFile));
  }

  return candidates.some(fileExists);
}

function findRelativeImports(source) {
  const imports = new Set();
  const staticImportPattern =
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?["'](\.[^"']+)["']/g;
  const dynamicImportPattern = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }

  return imports;
}

function nodeCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    issues.push(`${relative(file)}: syntax check failed\n${result.stderr.trim()}`);
  }
}

async function validatePackageScripts(packageJson) {
  for (const [name, command] of Object.entries(packageJson?.scripts ?? {})) {
    const match = /^node\s+([^\s]+)/.exec(command);
    if (!match || match[1].startsWith("-")) continue;

    const target = path.join(repoRoot, match[1]);
    if (!fileExists(target)) {
      issues.push(`package.json: script "${name}" targets missing file ${match[1]}`);
    }
  }
}

async function main() {
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const settings = await readJson(path.join(repoRoot, "data", "settings.json"));

  if (settings) {
    const validation = validateSettings(settings);
    for (const error of validation.errors) {
      issues.push(`data/settings.json: ${error}`);
    }
  }

  await validatePackageScripts(packageJson);

  const files = await walk(repoRoot);
  const sourceFiles = files.filter((file) => sourceExtensions.has(path.extname(file)));

  for (const file of sourceFiles) {
    if (nodeCheckExtensions.has(path.extname(file))) {
      nodeCheck(file);
    }

    const source = await fs.readFile(file, "utf8");
    for (const specifier of findRelativeImports(source)) {
      if (!resolveRelativeImport(file, specifier)) {
        issues.push(`${relative(file)}: cannot resolve import "${specifier}"`);
      }
    }
  }

  if (issues.length > 0) {
    console.error(`Lint failed with ${issues.length} issue(s):`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(
    `Lint passed: ${sourceFiles.length} source files, package scripts, imports, and settings are valid.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
