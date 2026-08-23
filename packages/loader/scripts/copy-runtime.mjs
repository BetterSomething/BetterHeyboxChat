import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(__dirname, '../../../runtime');
const target = path.resolve(__dirname, '../runtime');

if (!fs.existsSync(source)) {
  console.error(`runtime 源目录不存在: ${source}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
copyDir(source, target);
console.log(`已复制 runtime -> ${target}`);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
