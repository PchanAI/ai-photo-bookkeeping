// 將 chrome-extension/ 資料夾打包成 public/chrome-extension.zip
// 跨平台：Windows 用 PowerShell Compress-Archive，其他平台用 zip 指令
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extDir = path.join(root, 'chrome-extension');
const outZip = path.join(root, 'public', 'chrome-extension.zip');

if (!existsSync(extDir)) {
  console.error('找不到 chrome-extension/ 資料夾，請先確認擴充來源存在。');
  process.exit(1);
}

if (existsSync(outZip)) {
  rmSync(outZip);
}

if (process.platform === 'win32') {
  execSync(
    `powershell -Command "Compress-Archive -Path '${extDir}' -DestinationPath '${outZip}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`zip -r '${outZip}' '${path.relative(root, extDir)}'`, {
    stdio: 'inherit',
    cwd: root
  });
}

console.log(`已產生 ${path.relative(root, outZip)}`);
