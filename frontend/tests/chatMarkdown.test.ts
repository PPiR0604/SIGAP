import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '../src/ChatMarkdown.tsx';

test('assistant replies render bold labels, bullet lists and numbered questions', () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: '**Pratinjau Kanonis (R001)**\n- **Status:** Parsial\n- **Jumlah Jiwa:** Belum diketahui\n\n**Informasi yang Perlu Ditanyakan:**\n1. Nama Posko\n2. Jumlah pengungsi' }));
  assert.match(html, /<strong>Pratinjau Kanonis \(R001\)<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li><strong>Status:<\/strong> Parsial<\/li>/);
  assert.ok(!html.includes('**'));
});

test('HTML and unsafe links in assistant output cannot execute', () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: '<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n```svg\n<svg onload="alert(1)"></svg>\n```' }));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<svg'));
  assert.match(html, /<pre><code class="language-svg">/);
  assert.match(html, /&lt;svg/);
});

test('tables and nested lists retain semantic structure', () => {
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: '| Posko | Jiwa |\n| --- | --- |\n| A | 10 |\n\n- Kebutuhan\n  - Air bersih' }));
  assert.match(html, /<table>/);
  assert.match(html, /<th>Posko<\/th>/);
  assert.equal((html.match(/<ul>/g) || []).length, 2);
});
