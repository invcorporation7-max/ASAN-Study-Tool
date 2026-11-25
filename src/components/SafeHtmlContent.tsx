import React, { useMemo } from 'react';
import { sanitizeRichHtmlClient } from '../lib/clientSanitize';

interface SafeHtmlContentProps {
  html?: string;
  fallbackText?: string;
  className?: string;
}

export const SafeHtmlContent: React.FC<SafeHtmlContentProps> = ({
  html,
  fallbackText,
  className = '',
}) => {
  const sanitized = useMemo(() => {
    if (!html || !html.trim()) return '';
    return sanitizeRichHtmlClient(html);
  }, [html]);

  if (!sanitized) {
    return (
      <div className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed ${className}`}>
        {fallbackText || ''}
      </div>
    );
  }

  return (
    <div
      className={`asan-rich-html text-sm text-slate-800 dark:text-slate-100 leading-relaxed break-words [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-slate-900 [&_h1]:dark:text-white [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1.5 [&_h2]:text-slate-900 [&_h2]:dark:text-white [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-1.5 [&_h4]:mb-1 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:dark:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 [&_blockquote]:dark:text-slate-300 [&_blockquote]:my-2 [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:font-mono [&_pre]:text-xs [&_pre]:my-2 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:dark:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_table]:text-xs [&_th]:border [&_th]:border-slate-300 [&_th]:dark:border-slate-700 [&_th]:bg-slate-100 [&_th]:dark:bg-slate-800 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:dark:border-slate-700 [&_td]:px-2.5 [&_td]:py-1.5 [&_a]:text-blue-600 [&_a]:dark:text-blue-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2 ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};
