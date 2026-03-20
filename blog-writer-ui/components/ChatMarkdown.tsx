"use client";

import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";

/**
 * Renders chat message text as GitHub-flavored Markdown (tables, task lists,
 * strikethrough, autolinks, footnotes) with XSS-safe HTML sanitization.
 */
const components: Partial<Components> = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--cs-text-link)" }}
      {...props}
    >
      {children}
    </a>
  ),
  img: ({ src, alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ""} loading="lazy" {...props} />
  ),
  table: ({ children, ...props }) => (
    <div className="chat-markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

export function ChatMarkdown({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, defaultSchema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
