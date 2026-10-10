import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({ text }: { text: string }) {
  return createElement('div', { className: 'chat-markdown' },
    createElement(Markdown, {
      children: text,
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      components: {
        a: ({ node: _node, ...props }) => createElement('a', { ...props, target: '_blank', rel: 'noopener noreferrer' }),
        table: ({ node: _node, ...props }) => createElement('div', { className: 'chat-table' }, createElement('table', props))
      }
    })
  );
}
