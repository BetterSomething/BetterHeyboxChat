#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReleaseNotes, previousReleaseTag, resolveBuild } from './lib/versioning.mjs';
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

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] && path.resolve(process.argv[1]);
  return invoked === self;
}

if (isMain()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const build = resolveBuild(collectGitFacts(root));
  const currentRef = build.channel === 'release' ? `v${build.version}` : build.version;
  const previous = previousReleaseTag(
    listReleaseTags(root),
    build.channel === 'release' ? currentRef : null,
  );
  const range = previous ? `${previous}..HEAD` : '';
  const notes = formatReleaseNotes({
    version: build.version,
    channel: build.channel,
    previousTag: previous,
    currentRef,
    subjects: commitSubjects(root, range),
  });

  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : '';
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), notes);
  } else {
    process.stdout.write(notes);
  }
}
