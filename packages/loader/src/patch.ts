import fs from 'node:fs';
import path from 'node:path';
import {
  HTML_MARKER,
  HTML_SNIPPET,
  INDEX_SNIPPET,
  LOADER_VERSION,
  MARKER_BEGIN,
  PRELOAD_SNIPPET,
  SUPPORTED_CLIENT_VERSIONS,
} from './constants.js';
import { getRuntimeSourceDir } from './detect.js';
import type { ClientInstall, InstallManifest, PatchState } from './types.js';

const MANIFEST_FILE = 'install.json';
const BACKUP_DIR = '.backup';

export function readPatchState(appDir: string): PatchState {
  const preloadPath = path.join(appDir, 'source/preload/index.js');
  const htmlPath = path.join(appDir, 'webapp/index.html');
  const runtimeDir = path.join(appDir, 'betterheyboxchat');
  const manifestPath = path.join(runtimeDir, MANIFEST_FILE);

  const preloadPatched = fs.existsSync(preloadPath)
    ? fs.readFileSync(preloadPath, 'utf8').includes(MARKER_BEGIN)
    : false;
  const htmlPatched = fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, 'utf8').includes(HTML_MARKER)
    : false;
  const runtimePresent = fs.existsSync(path.join(runtimeDir, 'loader.js'));

  const state: PatchState = {
    installed: preloadPatched && htmlPatched && runtimePresent,
    preloadPatched,
    htmlPatched,
    runtimePresent,
  };

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as InstallManifest;
    state.loaderVersion = manifest.loaderVersion;
    state.installedAt = manifest.installedAt;
    state.clientVersion = manifest.clientVersion;
    state.installRoot = manifest.installRoot;
    state.appDir = manifest.appDir;
  }

  return state;
}

export function assertClientSupported(version: string): void {
  if (!SUPPORTED_CLIENT_VERSIONS.includes(version)) {
    throw new Error(
      `客户端版本 ${version} 暂未纳入兼容表。当前支持: ${SUPPORTED_CLIENT_VERSIONS.join(', ')}`,
    );
  }
}

export async function installPatches(install: ClientInstall): Promise<void> {
  assertClientSupported(install.version);

  const state = readPatchState(install.appDir);
  if (state.installed) {
    throw new Error('BetterHeyboxChat 已安装。如需重装请先执行 uninstall。');
  }

  const runtimeDir = path.join(install.appDir, 'betterheyboxchat');
  fs.mkdirSync(path.join(runtimeDir, BACKUP_DIR), { recursive: true });

  const backedUpFiles: string[] = [];
  patchPreload(install.appDir, backedUpFiles);
  patchIndexHtml(install.appDir, backedUpFiles);
  patchIndexJs(install.appDir, backedUpFiles);
  ensureEnvProd(install.appDir, backedUpFiles);
  deployRuntime(install.appDir);

  const manifest: InstallManifest = {
    loaderVersion: LOADER_VERSION,
    installedAt: new Date().toISOString(),
    clientVersion: install.version,
    installRoot: install.installRoot,
    appDir: install.appDir,
    backedUpFiles,
  };

  fs.writeFileSync(path.join(runtimeDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
}

export async function uninstallPatches(appDir: string): Promise<void> {
  const state = readPatchState(appDir);
  if (!state.installed && !state.preloadPatched && !state.htmlPatched && !state.runtimePresent) {
    throw new Error('未检测到 BetterHeyboxChat 安装。');
  }

  restoreFile(appDir, 'source/preload/index.js');
  restoreFile(appDir, 'webapp/index.html');
  restoreFile(appDir, 'index.js');
  restoreEnvJs(appDir);

  const runtimeDir = path.join(appDir, 'betterheyboxchat');
  if (fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

function patchPreload(appDir: string, backedUpFiles: string[]): void {
  const filePath = path.join(appDir, 'source/preload/index.js');
  const original = fs.readFileSync(filePath, 'utf8');

  if (original.includes(MARKER_BEGIN)) {
    throw new Error('preload/index.js 已包含 BetterHeyboxChat 标记。');
  }

  backupFile(filePath, backedUpFiles);
  fs.writeFileSync(filePath, `${original.trimEnd()}\n\n${PRELOAD_SNIPPET}\n`, 'utf8');
}

function patchIndexJs(appDir: string, backedUpFiles: string[]): void {
  const filePath = path.join(appDir, 'index.js');
  if (!fs.existsSync(filePath)) return;

  const original = fs.readFileSync(filePath, 'utf8');
  if (original.includes(MARKER_BEGIN)) {
    throw new Error('index.js 已包含 BetterHeyboxChat 标记。');
  }

  backupFile(filePath, backedUpFiles);
  fs.writeFileSync(filePath, `${INDEX_SNIPPET}\n\n${original}`, 'utf8');
}

function ensureEnvProd(appDir: string, backedUpFiles: string[]): void {
  const filePath = path.join(appDir, 'env.js');
  if (!fs.existsSync(filePath)) return;

  const original = fs.readFileSync(filePath, 'utf8');
  if (!/ELECTRON_ENV:\s*'local'/.test(original)) return;

  backupFile(filePath, backedUpFiles);
  fs.writeFileSync(filePath, original.replace(/ELECTRON_ENV:\s*'local'/, "ELECTRON_ENV: 'prod'"), 'utf8');
}

function patchIndexHtml(appDir: string, backedUpFiles: string[]): void {
  const filePath = path.join(appDir, 'webapp/index.html');
  const original = fs.readFileSync(filePath, 'utf8');

  if (original.includes(HTML_MARKER)) {
    throw new Error('webapp/index.html 已包含 BetterHeyboxChat 标记。');
  }

  backupFile(filePath, backedUpFiles);

  const injected = original.includes('<head>')
    ? original.replace('<head>', `<head>${HTML_SNIPPET}`)
    : `${HTML_SNIPPET}${original}`;

  fs.writeFileSync(filePath, injected, 'utf8');
}

function deployRuntime(appDir: string): void {
  const sourceDir = getRuntimeSourceDir();
  const targetDir = path.join(appDir, 'betterheyboxchat');

  fs.mkdirSync(targetDir, { recursive: true });
  copyDirectory(sourceDir, targetDir);
}

function copyDirectory(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function backupFile(filePath: string, backedUpFiles: string[]): void {
  const appDir = findAppDirFromTarget(filePath);
  const relative = path.relative(appDir, filePath);
  const backupPath = path.join(appDir, 'betterheyboxchat', BACKUP_DIR, relative);

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  backedUpFiles.push(relative);
}

function restoreEnvJs(appDir: string): void {
  const targetPath = path.join(appDir, 'env.js');
  const backupPath = path.join(appDir, 'betterheyboxchat', BACKUP_DIR, 'env.js');
  let content = '';
  if (fs.existsSync(backupPath)) {
    content = fs.readFileSync(backupPath, 'utf8');
  } else if (fs.existsSync(targetPath)) {
    content = fs.readFileSync(targetPath, 'utf8');
  } else {
    return;
  }
  fs.writeFileSync(targetPath, content.replace(/ELECTRON_ENV:\s*'local'/, "ELECTRON_ENV: 'prod'"), 'utf8');
}

function restoreFile(appDir: string, relativePath: string): void {
  const targetPath = path.join(appDir, relativePath);
  const backupPath = path.join(appDir, 'betterheyboxchat', BACKUP_DIR, relativePath);

  if (fs.existsSync(backupPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(backupPath, targetPath);
    return;
  }

  if (!fs.existsSync(targetPath)) return;

  const content = fs.readFileSync(targetPath, 'utf8');
  if (relativePath.endsWith('preload/index.js') && content.includes(MARKER_BEGIN)) {
    const cleaned = removeMarkedBlock(content, MARKER_BEGIN, '// BetterHeyboxChat:end');
    fs.writeFileSync(targetPath, cleaned, 'utf8');
  } else if (relativePath.endsWith('index.html') && content.includes(HTML_MARKER)) {
    fs.writeFileSync(targetPath, content.replace(HTML_SNIPPET, ''), 'utf8');
  } else if (relativePath.endsWith('index.js') && content.includes(MARKER_BEGIN)) {
    const cleaned = removeMarkedBlock(content, MARKER_BEGIN, '// BetterHeyboxChat:end');
    fs.writeFileSync(targetPath, cleaned, 'utf8');
  } else if (relativePath.endsWith('env.js') && /ELECTRON_ENV:\s*'local'/.test(content)) {
    fs.writeFileSync(targetPath, content.replace(/ELECTRON_ENV:\s*'local'/, "ELECTRON_ENV: 'prod'"), 'utf8');
  }
}

function removeMarkedBlock(content: string, begin: string, end: string): string {
  const start = content.indexOf(begin);
  if (start === -1) return content;
  const endIndex = content.indexOf(end, start);
  if (endIndex === -1) return content;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(endIndex + end.length).trimStart();
  if (!before) return after.endsWith('\n') ? after : `${after}\n`;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}`;
}

function findAppDirFromTarget(filePath: string): string {
  const normalized = path.normalize(filePath);
  const marker = `${path.sep}resources${path.sep}versions${path.sep}`;
  const index = normalized.indexOf(marker);
  if (index === -1) {
    throw new Error(`无法从路径推断 app 目录: ${filePath}`);
  }

  const after = normalized.slice(index + marker.length);
  const version = after.split(path.sep)[0];
  return path.join(normalized.slice(0, index), 'resources', 'versions', version, 'app');
}

export function formatPatchState(state: PatchState): string {
  const lines = [
    `安装状态: ${state.installed ? '已安装' : '未安装'}`,
    `Preload 补丁: ${state.preloadPatched ? '是' : '否'}`,
    `HTML 补丁: ${state.htmlPatched ? '是' : '否'}`,
    `运行时文件: ${state.runtimePresent ? '是' : '否'}`,
  ];

  if (state.loaderVersion) lines.push(`Loader 版本: ${state.loaderVersion}`);
  if (state.clientVersion) lines.push(`客户端版本: ${state.clientVersion}`);
  if (state.installedAt) lines.push(`安装时间: ${state.installedAt}`);
  if (state.appDir) lines.push(`App 目录: ${state.appDir}`);

  return lines.join('\n');
}
