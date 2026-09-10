#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUpdateNotes, previousReleaseTag, renderUpdateJson, resolveBuild } from './lib/versioning.mjs';
import { collectGitFacts, git } from './resolve-version.mjs';

function listReleaseTags(cwd) {
  const raw = git(['tag', '--list', 'v*'], cwd);
  return raw ? raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function commitSubjects(cwd, range) {
  const args = ['log', '--no-merges', '--pretty=format:%s'];
  if (range) args.push(range);
  const raw = git(args, cwd);
  return raw ? raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? String(process.argv[idx + 1] || '').trim() : '';
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = resolveBuild(collectGitFacts(root));
const currentRef = build.channel === 'release' ? `v${build.version}` : build.version;
const previous = previousReleaseTag(
  listReleaseTags(root),
  build.channel === 'release' ? currentRef : null,
);
const notes = formatUpdateNotes(commitSubjects(root, previous ? `${previous}..HEAD` : ''));
const artifactName = argValue('--artifact') || `bhchat-installer-${build.version}.exe`;
const artifactPath = path.isAbsolute(artifactName)
  ? artifactName
  : path.resolve(process.cwd(), artifactName);
if (!fs.existsSync(artifactPath)) {
  throw new Error(`找不到安装包: ${artifactPath}`);
}

const json = renderUpdateJson({
  build,
  sha256: sha256File(artifactPath),
  notes,
  tag: build.channel === 'release' ? `v${build.version}` : 'dev',
});

const outPath = path.resolve(argValue('--out') || 'update.json');
fs.writeFileSync(outPath, json);
process.stdout.write(outPath + '\n');
