#!/usr/bin/env node
import { Command } from 'commander';
import { LOADER_VERSION } from './constants.js';
import { detectInstall, formatInstallSummary } from './detect.js';
import {
  formatPatchState,
  installPatches,
  readPatchState,
  reinstallPatches,
  uninstallPatches,
} from './patch.js';

const program = new Command();

program
  .name('bhchat')
  .description('BetterHeyboxChat 补丁安装器')
  .version(LOADER_VERSION);

program
  .command('detect')
  .description('检测黑盒语音安装路径与版本')
  .option('-p, --path <installRoot>', '手动指定安装根目录')
  .action(async (options: { path?: string }) => {
    const install = await detectInstall(options.path);
    if (!install) {
      console.error('未找到黑盒语音安装。可尝试: bhchat detect --path "D:\\Program Files\\Qingfeng\\HeyboxChat"');
      process.exitCode = 1;
      return;
    }
    console.log(formatInstallSummary(install));
  });

program
  .command('status')
  .description('查看当前补丁状态')
  .option('-p, --path <installRoot>', '手动指定安装根目录')
  .action(async (options: { path?: string }) => {
    const install = await detectInstall(options.path);
    if (!install) {
      console.error('未找到黑盒语音安装。');
      process.exitCode = 1;
      return;
    }
    const state = readPatchState(install.appDir);
    console.log(formatInstallSummary(install));
    console.log('');
    console.log(formatPatchState(state));
  });

program
  .command('install')
  .description('安装 BetterHeyboxChat 补丁与运行时')
  .option('-p, --path <installRoot>', '手动指定安装根目录')
  .option('-y, --yes', '跳过确认提示')
  .action(async (options: { path?: string; yes?: boolean }) => {
    const install = await detectInstall(options.path);
    if (!install) {
      console.error('未找到黑盒语音安装。');
      process.exitCode = 1;
      return;
    }

    console.log(formatInstallSummary(install));
    console.log('');

    if (!options.yes) {
      console.log('将 patch preload / index.html / index.js，并复制运行时到 betterheyboxchat/ 目录。');
      console.log('已安装请用 reinstall。请确保黑盒语音已关闭。继续请添加 --yes');
      process.exitCode = 1;
      return;
    }

    try {
      await installPatches(install);
      console.log('安装成功。请启动黑盒语音验证注入效果。');
    } catch (error) {
      printWriteError(error);
      process.exitCode = 1;
    }
  });

program
  .command('reinstall')
  .description('卸载后重新安装补丁与运行时（用于更新）')
  .option('-p, --path <installRoot>', '手动指定安装根目录')
  .option('-y, --yes', '跳过确认提示')
  .action(async (options: { path?: string; yes?: boolean }) => {
    const install = await detectInstall(options.path);
    if (!install) {
      console.error('未找到黑盒语音安装。');
      process.exitCode = 1;
      return;
    }

    console.log(formatInstallSummary(install));
    console.log('');

    if (!options.yes) {
      console.log('将先卸载再安装补丁与运行时。请确保黑盒语音已关闭。继续请添加 --yes');
      process.exitCode = 1;
      return;
    }

    try {
      await reinstallPatches(install);
      console.log('重装成功。请启动黑盒语音验证注入效果。');
    } catch (error) {
      printWriteError(error);
      process.exitCode = 1;
    }
  });

program
  .command('uninstall')
  .description('卸载补丁并还原原始文件')
  .option('-p, --path <installRoot>', '手动指定安装根目录')
  .option('-y, --yes', '跳过确认提示')
  .action(async (options: { path?: string; yes?: boolean }) => {
    const install = await detectInstall(options.path);
    if (!install) {
      console.error('未找到黑盒语音安装。');
      process.exitCode = 1;
      return;
    }

    if (!options.yes) {
      console.log('将还原 preload / index.html / index.js 并删除 betterheyboxchat/ 目录。');
      console.log('继续请添加 --yes');
      process.exitCode = 1;
      return;
    }

    try {
      await uninstallPatches(install.appDir);
      console.log('卸载成功。');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

function printWriteError(error: unknown): void {
  if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPERM') {
    console.error('写入失败：权限不足。请以管理员身份运行终端后重试。');
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}

program.parseAsync(process.argv);
