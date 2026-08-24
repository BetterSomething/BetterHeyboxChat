import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  DEFAULT_INSTALL_CANDIDATES,
  HEYBOX_DISPLAY_NAME_HINTS,
  REGISTRY_APP_PATH_KEYS,
  REGISTRY_UNINSTALL_KEYS,
} from './constants.js';
import type { ClientInstall } from './types.js';

const execFileAsync = promisify(execFile);

const SEMVER_DIR = /^\d+\.\d+\.\d+$/;

export function stripIconIndex(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, '').trim();
  const comma = trimmed.lastIndexOf(',');
  if (comma >= 0 && /^[-\d]+$/.test(trimmed.slice(comma + 1))) {
    return trimmed.slice(0, comma).trim().replace(/^"|"$/g, '');
  }
  return trimmed;
}

export function collectCandidateRoots(opts: {
  manualRoot?: string;
  registryRoots?: string[];
  fallbacks?: string[];
}): string[] {
  const roots = opts.manualRoot
    ? [opts.manualRoot]
    : [...(opts.registryRoots ?? []), ...(opts.fallbacks ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const key = root.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(root);
    }
  }
  return out;
}

export async function detectInstall(installRoot?: string): Promise<ClientInstall | null> {
  const roots = installRoot
    ? collectCandidateRoots({ manualRoot: installRoot })
    : collectCandidateRoots({
        registryRoots: await findRegistryInstallRoots(),
        fallbacks: DEFAULT_INSTALL_CANDIDATES,
      });

  const seen = new Set<string>();
  for (const root of roots) {
    const inferred = await inferInstallRoot(root);
    if (!inferred || seen.has(inferred)) continue;
    seen.add(inferred);
    const install = await resolveInstallFromRoot(inferred);
    if (install) return install;
  }

  return null;
}

async function findRegistryInstallRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return [];

  const roots: string[] = [];
  await collectAppPathRoots(roots);
  await collectUninstallRoots(roots);
  return roots;
}

async function collectAppPathRoots(roots: string[]): Promise<void> {
  for (const key of REGISTRY_APP_PATH_KEYS) {
    const values = await readRegValues(key);
    if (!values) continue;
    await pushInferredRoot(roots, values.defaultValue);
    await pushInferredRoot(roots, values.path);
  }
}

async function collectUninstallRoots(roots: string[]): Promise<void> {
  for (const key of REGISTRY_UNINSTALL_KEYS) {
    let subKeys: string[] = [];
    try {
      const { stdout } = await execFileAsync('reg', ['query', key], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      subKeys = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('HKEY_'));
    } catch {
      continue;
    }

    for (const subKey of subKeys) {
      const info = await readUninstallKey(subKey);
      if (!info) continue;
      if (!matchesHeyboxName(info.displayName) || looksLikeAccelerator(info.displayName)) {
        continue;
      }
      await pushInferredRoot(roots, info.installLocation);
      await pushInferredRoot(roots, info.displayIcon);
    }
  }
}

async function readRegValues(
  key: string,
): Promise<{ defaultValue?: string; path?: string } | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key], {
      encoding: 'utf8',
      windowsHide: true,
    });
    let defaultValue: string | undefined;
    let pathValue: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^\(Default\)/i.test(trimmed) || /^\(默认\)/.test(trimmed)) {
        defaultValue = trimmed.split(/REG_SZ/i).pop()?.trim();
      }
      if (/^Path\s/i.test(trimmed)) {
        pathValue = trimmed.split(/REG_SZ/i).pop()?.trim();
      }
    }
    return { defaultValue, path: pathValue };
  } catch {
    return null;
  }
}

async function readUninstallKey(
  subKey: string,
): Promise<{ displayName?: string; installLocation?: string; displayIcon?: string } | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', subKey], {
      encoding: 'utf8',
      windowsHide: true,
    });

    let displayName: string | undefined;
    let installLocation: string | undefined;
    let displayIcon: string | undefined;

    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DisplayName')) {
        displayName = trimmed.split('REG_SZ').pop()?.trim();
      }
      if (trimmed.startsWith('InstallLocation')) {
        installLocation = trimmed.split('REG_SZ').pop()?.trim();
      }
      if (trimmed.startsWith('DisplayIcon')) {
        displayIcon = trimmed.split('REG_SZ').pop()?.trim();
      }
    }

    if (!displayName && !installLocation && !displayIcon) return null;
    return { displayName, installLocation, displayIcon };
  } catch {
    return null;
  }
}

function matchesHeyboxName(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return HEYBOX_DISPLAY_NAME_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

function looksLikeAccelerator(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('加速') || lower.includes('accelerator') || lower.includes('heyboxacc');
}

async function pushInferredRoot(roots: string[], raw?: string): Promise<void> {
  if (!raw) return;
  const inferred = await inferInstallRoot(stripIconIndex(raw));
  if (inferred && !roots.includes(inferred)) {
    roots.push(inferred);
  }
}

async function inferInstallRoot(start: string): Promise<string | null> {
  let current = start;
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
      current = path.dirname(current);
    }
  } catch {
    return null;
  }

  for (let i = 0; i < 8; i += 1) {
    if (await resolveInstallFromRoot(current)) {
      return normalizePath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function resolveInstallFromRoot(installRoot: string): Promise<ClientInstall | null> {
  if (!fs.existsSync(installRoot)) return null;

  const versionDirs = fs
    .readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SEMVER_DIR.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareSemver)
    .reverse();

  for (const version of versionDirs) {
    const install = await resolveAppDir(installRoot, version);
    if (install) return install;
  }

  return null;
}

async function resolveAppDir(
  installRoot: string,
  version: string,
): Promise<ClientInstall | null> {
  const versionDir = path.join(installRoot, version);
  const appDir = path.join(versionDir, 'resources', 'versions', version, 'app');
  const packageJsonPath = path.join(appDir, 'package.json');

  if (!fs.existsSync(packageJsonPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    name?: string;
    version?: string;
    devDependencies?: Record<string, string>;
  };

  if (pkg.name !== 'heybox-chat-electron') return null;

  return {
    installRoot: normalizePath(installRoot),
    version: pkg.version ?? version,
    versionDir: normalizePath(versionDir),
    appDir: normalizePath(appDir),
    packageName: pkg.name,
    electronVersion: pkg.devDependencies?.electron,
  };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

export function getRuntimeSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../runtime'),
    path.resolve(here, '../../../runtime'),
    path.resolve(process.cwd(), 'runtime'),
    path.resolve(process.cwd(), 'packages/loader/runtime'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'loader.js'))) {
      return candidate;
    }
  }

  throw new Error('找不到 runtime 目录，请先执行 pnpm build');
}

export function formatInstallSummary(install: ClientInstall): string {
  return [
    `安装根目录: ${install.installRoot}`,
    `客户端版本: ${install.version}`,
    `App 目录:   ${install.appDir}`,
    install.electronVersion ? `Electron:   ${install.electronVersion}` : null,
    `平台:       ${os.platform()} ${os.arch()}`,
  ]
    .filter(Boolean)
    .join('\n');
}
