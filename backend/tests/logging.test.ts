import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../src/logging.js';

test('logger preserves error messages and redacts credentials', () => {
  for (const level of ['info', 'warn', 'error'] as const) {
    const method = level === 'info' ? 'log' : level;
    const original = console[method];
    let output = '';
    console[method] = (message: string) => { output = message; };
    try {
      logger[level]('Startup failed:', new Error('Invalid config Bearer test-secret'));
      assert.match(output, /Invalid config/);
      assert.match(output, /\[REDACTED_TOKEN\]/);
      assert.ok(!output.includes('test-secret'));
    } finally {
      console[method] = original;
    }
  }
});
