"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
  className?: string;
};

const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-6 text-section-title font-semibold leading-snug text-[#292925] first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-6 text-body font-semibold leading-snug text-[#292925] first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-5 text-body font-semibold leading-snug text-[#34342f] first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 whitespace-normal leading-[1.72] last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[#292925]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#5b5a54]">{children}</em>,
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1.5 leading-[1.7] last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1.5 leading-[1.7] last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1 marker:text-[#8a8982] [&>p]:mb-0">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-[#c8d4ce] pl-3 text-[#66655f]">{children}</blockquote>,
  hr: () => <hr className="my-5 border-0 border-t border-[#e3e2dc]" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-[#376554] underline decoration-[#9fb4aa] underline-offset-2 hover:text-[#244b3d]"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => (
    <code
      className={`${className ?? ""} rounded bg-[#f1f1ed] px-1 py-0.5 font-mono text-[0.9em] text-[#3f4a45]`}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-[7px] border border-[#deddd7] bg-[#f7f7f4] p-3 text-[13px] leading-6 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-[7px] border border-[#deddd7]">
      <table className="w-full border-collapse text-left text-[0.94em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-[#deddd7] bg-[#f5f5f1] px-3 py-2 font-semibold text-[#3f3f3a]">{children}</th>,
  td: ({ children }) => <td className="border-b border-[#ecebe6] px-3 py-2 align-top last:border-b-0">{children}</td>,
};

/** Render trusted product Markdown structure without accepting model-authored HTML. */
export function MarkdownMessage({ content, className = "" }: MarkdownMessageProps) {
  return (
    <div className={`min-w-0 break-words ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
