import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Shared, safe Markdown rendering for agent replies and donor bulletins. */
export function MarkdownContent({ text, className = '', tableLabel = 'Tabel dalam konten',allowImages=true }: {
  text: string; className?: string; tableLabel?: string;allowImages?:boolean;
}) {
  return createElement('div', { className: `markdown-content ${className}`.trim() },
    createElement(Markdown, {
      children: text,
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      components: {
        ...(!allowImages?{img:()=>null}:{}),
        a: ({ node: _node, ...props }) => createElement('a', { ...props, target: '_blank', rel: 'noopener noreferrer' }),
        table: ({ node: _node, ...props }) => createElement('div', {
          className: 'markdown-table', role: 'region', 'aria-label': tableLabel, tabIndex: 0,
        }, createElement('table', props)),
      },
    }),
  );
}
