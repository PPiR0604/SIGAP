import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

test('documented start script boots with a fresh database directory', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sigap-start-'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const [runner, ...args] = pkg.scripts.start.split(' ');
  const command = runner === 'tsx' ? [resolve('node_modules/tsx/dist/cli.mjs'), ...args] : args;
  const child = spawn(process.execPath, command, { cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, SIGAP_AGENT_PROVIDER: 'mock', SIGAP_PORT: '0', SIGAP_DB_PATH: join(folder, 'nested', 'sigap.db'), SIGAP_BOB_COMMAND: join(folder, 'no-bob'), SIGAP_SESSION_TOKEN: 'test-token' } });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  try {
    const address = await new Promise<string>((resolveAddress, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + stderr)), 5000);
      child.on('exit', () => { clearTimeout(timer); reject(new Error('Startup failed: ' + stderr)); });
      child.stdout.on('data', chunk => {
        const match = String(chunk).match(/Backend SIGAP berjalan di (http:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolveAddress(match[1]); }
      });
    });
    const health = await fetch(address + '/api/health').then(res => res.json()) as { mode: string; write_enabled: boolean };
    assert.equal(health.mode, 'mock_mode');
    assert.equal(health.write_enabled, false);
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    if (dirname(resolve(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith('sigap-start-')) throw new Error('Invalid test cleanup path');
    await rm(folder, { recursive: true, force: true });
  }
});
