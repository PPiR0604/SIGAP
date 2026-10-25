import { createElement } from 'react';
import { MarkdownContent } from './MarkdownContent';

export function ChatMarkdown({ text }: { text: string }) {
  return createElement(MarkdownContent, { text, className: 'chat-markdown', tableLabel: 'Tabel jawaban Agent' });
}
