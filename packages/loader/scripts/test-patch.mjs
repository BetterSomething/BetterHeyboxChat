/**
 * 在无管理员权限的临时目录中验证 patch / unpatch 逻辑。
 * 用法: node scripts/test-patch.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderRoot = path.resolve(__dirname, '..');
const { installPatches, uninstallPatches, readPatchState } = await import(
  pathToFileURL(path.join(loaderRoot, 'dist/patch.js')).href
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bhchat-test-'));
const appDir = path.join(tempRoot, '1.56.0', 'resources', 'versions', '1.56.0', 'app');

fs.mkdirSync(path.join(appDir, 'source/preload'), { recursive: true });
fs.mkdirSync(path.join(appDir, 'webapp'), { recursive: true });

fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify({ name: 'heybox-chat-electron', version: '1.56.0' }),
);
fs.writeFileSync(path.join(appDir, 'source/preload/index.js'), "console.log('preload');\n");
fs.writeFileSync(
  path.join(appDir, 'index.js'),
  "let args = process.argv.slice(1)\nif (args.includes('--load_js')) {\n  require('./bytenode/loader/index')\n  require('./src/main')\n} else {\n  require('./bytenode/loader/index')\n  require('./source/main')\n}\n",
);
fs.writeFileSync(
  path.join(appDir, 'webapp/index.html'),
  '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
);
fs.writeFileSync(
  path.join(appDir, 'env.js'),
  "module.exports = {\n  ELECTRON_ENV: 'local',\n  NODE_BIT: 64\n};\n",
);

const install = {
  installRoot: path.join(tempRoot),
  version: '1.56.0',
  versionDir: path.join(tempRoot, '1.56.0'),
  appDir,
  packageName: 'heybox-chat-electron',
};

await installPatches(install);

const afterInstall = readPatchState(appDir);
if (!afterInstall.installed) {
  console.error('FAIL: expected installed=true');
  process.exit(1);
}

const preload = fs.readFileSync(path.join(appDir, 'source/preload/index.js'), 'utf8');
const html = fs.readFileSync(path.join(appDir, 'webapp/index.html'), 'utf8');

const indexJs = fs.readFileSync(path.join(appDir, 'index.js'), 'utf8');
if (!preload.includes('BetterHeyboxChat:begin')) throw new Error('preload not patched');
if (!html.includes('BetterHeyboxChat:begin')) throw new Error('html not patched');
if (!indexJs.includes('main-bridge.js')) throw new Error('index.js main bridge not patched');
if (!fs.existsSync(path.join(appDir, 'betterheyboxchat/loader.js'))) {
  throw new Error('runtime not deployed');
}

const envAfterInstall = fs.readFileSync(path.join(appDir, 'env.js'), 'utf8');
if (!envAfterInstall.includes("ELECTRON_ENV: 'prod'")) {
  throw new Error('env.js must stay prod; local 会导致正式包灰屏');
}

await uninstallPatches(appDir);

const afterUninstall = readPatchState(appDir);
if (afterUninstall.installed || afterUninstall.runtimePresent) {
  throw new Error('uninstall incomplete');
}

const restoredPreload = fs.readFileSync(path.join(appDir, 'source/preload/index.js'), 'utf8');
if (restoredPreload.includes('BetterHeyboxChat')) {
  throw new Error('preload not restored');
}

const restoredEnv = fs.readFileSync(path.join(appDir, 'env.js'), 'utf8');
if (!restoredEnv.includes("ELECTRON_ENV: 'prod'")) {
  throw new Error('env.js not restored to prod on uninstall');
}

const restoredIndex = fs.readFileSync(path.join(appDir, 'index.js'), 'utf8');
if (restoredIndex.includes('BetterHeyboxChat') || restoredIndex.includes('main-bridge')) {
  throw new Error('index.js not restored on uninstall');
}

console.log('OK: patch install/uninstall cycle passed');
fs.rmSync(tempRoot, { recursive: true, force: true });
