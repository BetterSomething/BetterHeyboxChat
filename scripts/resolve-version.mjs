#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installerArtifactName,
  pickReleaseTag,
  renderVersionJs,
  renderVersionJson,
  resolveBuild,
} from './lib/versioning.mjs';

export function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function collectGitFacts(cwd, env = process.env) {
  const pointsAt = git(['tag', '--points-at', 'HEAD'], cwd);
  const tags = pointsAt ? pointsAt.split(/\r?\n/) : [];
  return {
    bhcVersion: env.BHC_VERSION || '',
    exactTag: pickReleaseTag(tags),
    shortSha: git(['rev-parse', '--short', 'HEAD'], cwd),
  };
}

export function writeVersionFiles(root, build) {
  const versionJs = path.join(root, 'runtime', 'lib', 'version.js');
  const versionJson = path.join(root, 'runtime', 'version.json');
  fs.mkdirSync(path.dirname(versionJs), { recursive: true });
  fs.writeFileSync(versionJs, renderVersionJs(build));
  fs.writeFileSync(versionJson, renderVersionJson(build));
  return { versionJs, versionJson, artifact: installerArtifactName(build.version) };
}

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] && path.resolve(process.argv[1]);
  return invoked === self;
}

if (isMain()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const build = resolveBuild(collectGitFacts(root));
  const written = writeVersionFiles(root, build);
  process.stdout.write(JSON.stringify({ ...build, artifact: written.artifact }) + '\n');
}
