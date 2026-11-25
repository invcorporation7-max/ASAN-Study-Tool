import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  FileText,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Paperclip,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import { uploadForumAttachmentBinary } from '../lib/api';
import { sanitizeRichHtmlClient } from '../lib/clientSanitize';
import type { ForumAttachmentItem } from '../types';

interface SummernoteEditorProps {
  valueHtml: string;
  onChangeHtml: (html: string) => void;
  attachments?: ForumAttachmentItem[];
  onAttachmentsChange?: (next: ForumAttachmentItem[]) => void;
  placeholder?: string;
  minHeight?: number;
  allowAttachments?: boolean;
  onTypingPulse?: () => void;
}

const FONT_FAMILIES = [
  'Default',
  'DM Sans',
  'Plus Jakarta Sans',
  'Georgia',
  'Times New Roman',
  'JetBrains Mono',
];

const FONT_SIZES = [
  { label: 'Small', cmd: '2' },
  { label: 'Normal', cmd: '3' },
  { label: 'Medium', cmd: '4' },
  { label: 'Large', cmd: '5' },
  { label: 'XL', cmd: '6' },
];

const TEXT_COLORS = [
  '#0f172a',
  '#334155',
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
];

const HIGHLIGHT_COLORS = [
  'transparent',
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fecaca',
  '#e9d5ff',
];

export const SummernoteEditor: React.FC<SummernoteEditorProps> = ({
  valueHtml,
  onChangeHtml,
  attachments = [],
  onAttachmentsChange,
  placeholder = 'Write formatted notes, headings, tables, or equations...',
  minHeight = 160,
  allowAttachments = true,
  onTypingPulse,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [codeView, setCodeView] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableHover, setTableHover] = useState<{ r: number; c: number }>({ r: 3, c: 3 });
  const [showLinkBox, setShowLinkBox] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkLabel, setLinkLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Keep contentEditable synced when valueHtml changes externally (e.g. form reset)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || codeView) return;
    if (el.innerHTML !== valueHtml) {
      el.innerHTML = valueHtml || '';
    }
  }, [valueHtml, codeView]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  const emitHtml = () => {
    if (!editorRef.current) return;
    onChangeHtml(editorRef.current.innerHTML);
    onTypingPulse?.();
  };

  const exec = (command: string, value?: string) => {
    restoreSelection();
    try {
      document.execCommand(command, false, value);
    } catch {
      // ignore unsupported command in certain browsers
    }
    emitHtml();
  };

  const applyHeadingOrBlock = (tag: string) => {
    restoreSelection();
    try {
      document.execCommand('formatBlock', false, tag);
    } catch {
      document.execCommand('formatBlock', false, `<${tag}>`);
    }
    emitHtml();
  };

  const insertHtmlAtCursor = (htmlFragment: string) => {
    restoreSelection();
    try {
      document.execCommand('insertHTML', false, sanitizeRichHtmlClient(htmlFragment));
    } catch {
      if (editorRef.current) {
        editorRef.current.innerHTML += sanitizeRichHtmlClient(htmlFragment);
      }
    }
    emitHtml();
  };

  const insertTable = (rows: number, cols: number) => {
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) {
      html += `<th>Col ${c + 1}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows - 1; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += '<td>&nbsp;</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertHtmlAtCursor(html);
    setShowTablePicker(false);
  };

  const handleInsertLink = () => {
    const cleanUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setUploadError('Link URL must begin with http:// or https://');
      return;
    }
    const label = (linkLabel.trim() || cleanUrl).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeHref = cleanUrl.replace(/"/g, '&quot;');
    insertHtmlAtCursor(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    setShowLinkBox(false);
    setLinkUrl('https://');
    setLinkLabel('');
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const uploaded = await uploadForumAttachmentBinary<ForumAttachmentItem>(file);
      onAttachmentsChange?.([...attachments, uploaded]);
      if (uploaded.kind === 'image') {
        // Insert a clean caption placeholder or leave in attachments strip so auth-gated blob loads reliably
        insertHtmlAtCursor(`<p><em>[Attached Image: ${uploaded.fileName}]</em></p>`);
      } else {
        insertHtmlAtCursor(`<p><em>[Attached PDF: ${uploaded.fileName} (${uploaded.pageCount} pg)]</em></p>`);
      }
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Attachment upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const btnCls =
    'p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors';

  return (
    <div
      className={`${
        fullscreen
          ? 'fixed inset-3 z-50 flex flex-col shadow-2xl'
          : 'relative flex flex-col'
      } rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden`}
    >
      {/* Summernote-style Rich Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80">
        {/* Paragraph / Headings */}
        <select
          aria-label="Text block format"
          onMouseDown={saveSelection}
          onChange={(e) => {
            if (e.target.value) applyHeadingOrBlock(e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className="h-7 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
        >
          <option value="" disabled>
            Style / Heading
          </option>
          <option value="p">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="blockquote">Blockquote</option>
          <option value="pre">Code Block</option>
        </select>

        {/* Font Family */}
        <select
          aria-label="Font family"
          onMouseDown={saveSelection}
          onChange={(e) => {
            if (e.target.value && e.target.value !== 'Default') {
              exec('fontName', e.target.value);
            }
          }}
          defaultValue="Default"
          className="h-7 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none max-w-[115px]"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        {/* Font Size */}
        <select
          aria-label="Font size"
          onMouseDown={saveSelection}
          onChange={(e) => {
            if (e.target.value) exec('fontSize', e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className="h-7 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
        >
          <option value="" disabled>
            Size
          </option>
          {FONT_SIZES.map((s) => (
            <option key={s.cmd} value={s.cmd}>
              {s.label}
            </option>
          ))}
        </select>

        <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

        <button type="button" title="Bold" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}>
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Italic" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}>
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Underline" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}>
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Strikethrough" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }}>
          <Strikethrough className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Subscript" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('subscript'); }}>
          <Subscript className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Superscript" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('superscript'); }}>
          <Superscript className="h-3.5 w-3.5" />
        </button>

        {/* Text Color */}
        <select
          aria-label="Text color"
          onMouseDown={saveSelection}
          onChange={(e) => {
            if (e.target.value) exec('foreColor', e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className="h-7 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
        >
          <option value="" disabled>
            A Color
          </option>
          {TEXT_COLORS.map((hex) => (
            <option key={hex} value={hex}>
              {hex}
            </option>
          ))}
        </select>

        {/* Highlight Color */}
        <select
          aria-label="Highlight color"
          onMouseDown={saveSelection}
          onChange={(e) => {
            if (e.target.value) exec('hiliteColor', e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className="h-7 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
        >
          <option value="" disabled>
            Highlight
          </option>
          {HIGHLIGHT_COLORS.map((hex) => (
            <option key={hex} value={hex}>
              {hex === 'transparent' ? 'None' : hex}
            </option>
          ))}
        </select>

        <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

        <button type="button" title="Bulleted list" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>
          <List className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Numbered list" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}>
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Align left" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('justifyLeft'); }}>
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Align center" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('justifyCenter'); }}>
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Align right" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('justifyRight'); }}>
          <AlignRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Justify" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('justifyFull'); }}>
          <AlignJustify className="h-3.5 w-3.5" />
        </button>

        <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

        {/* Table Grid Picker */}
        <div className="relative">
          <button
            type="button"
            title="Insert table"
            className={btnCls}
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
              setShowTablePicker((v) => !v);
              setShowLinkBox(false);
            }}
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
          {showTablePicker && (
            <div className="absolute left-0 top-8 z-30 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 shadow-xl w-44">
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Table {tableHover.r} × {tableHover.c}
              </div>
              <div className="grid grid-cols-6 gap-1">
                {Array.from({ length: 36 }).map((_, idx) => {
                  const r = Math.floor(idx / 6) + 1;
                  const c = (idx % 6) + 1;
                  const active = r <= tableHover.r && c <= tableHover.c;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onMouseEnter={() => setTableHover({ r, c })}
                      onClick={() => insertTable(r, c)}
                      className={`h-4 w-4 rounded-xs border ${
                        active
                          ? 'bg-blue-500 border-blue-600'
                          : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Link Popover */}
        <div className="relative">
          <button
            type="button"
            title="Insert link"
            className={btnCls}
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
              setShowLinkBox((v) => !v);
              setShowTablePicker(false);
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
          {showLinkBox && (
            <div className="absolute left-0 top-8 z-30 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl w-64 space-y-2">
              <input
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="Link text (optional)"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowLinkBox(false)}
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInsertLink}
                  className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Insert
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Image / PDF Upload */}
        {allowAttachments && (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleFileUpload(f);
              }}
            />
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleFileUpload(f);
              }}
            />
            <button
              type="button"
              title="Attach image"
              disabled={uploading}
              onClick={() => imageInputRef.current?.click()}
              className={btnCls}
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Attach PDF"
              disabled={uploading}
              onClick={() => pdfInputRef.current?.click()}
              className={btnCls}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

        <button type="button" title="Undo" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('undo'); }}>
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Redo" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('redo'); }}>
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Clear formatting" className={btnCls} onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}>
          <Eraser className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={codeView ? 'Visual WYSIWYG view' : 'HTML source view'}
          className={`${btnCls} ${codeView ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' : ''}`}
          onClick={() => setCodeView((v) => !v)}
        >
          <Code className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen editor'}
          className={btnCls}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Upload feedback */}
      {(uploading || uploadError) && (
        <div className="px-3 py-1.5 text-xs border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
          {uploading ? (
            <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading attachment...
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">{uploadError}</span>
          )}
          {uploadError && (
            <button type="button" onClick={() => setUploadError('')} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Editable Canvas / Code Source */}
      {codeView ? (
        <textarea
          value={valueHtml}
          onChange={(e) => {
            onChangeHtml(e.target.value);
            onTypingPulse?.();
          }}
          style={{ minHeight: fullscreen ? '100%' : `${minHeight}px` }}
          className="w-full flex-1 p-3 font-mono text-xs bg-slate-950 text-emerald-300 focus:outline-none resize-y"
          placeholder="<h1>Heading</h1><p>Raw HTML source...</p>"
        />
      ) : (
        <div className="relative flex-1 overflow-auto bg-white dark:bg-slate-900">
          {!valueHtml.trim() && (
            <div className="pointer-events-none absolute top-3 left-3.5 text-sm text-slate-400 dark:text-slate-500">
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={emitHtml}
            onBlur={saveSelection}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            style={{ minHeight: fullscreen ? '100%' : `${minHeight}px` }}
            className="p-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-1.5 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:my-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1 [&_h4]:text-sm [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-2.5 [&_pre]:rounded-lg [&_pre]:font-mono [&_pre]:text-xs [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:dark:border-slate-700 [&_th]:bg-slate-100 [&_th]:dark:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 [&_td]:dark:border-slate-700 [&_td]:px-2 [&_td]:py-1 [&_a]:text-blue-600 [&_a]:underline"
          />
        </div>
      )}

      {/* Attached Files Chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200"
            >
              <Paperclip className="h-3 w-3 text-blue-600 dark:text-blue-400" />
              <span className="max-w-[160px] truncate">{att.fileName}</span>
              {onAttachmentsChange && (
                <button
                  type="button"
                  onClick={() =>
                    onAttachmentsChange(attachments.filter((x) => x.id !== att.id))
                  }
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
