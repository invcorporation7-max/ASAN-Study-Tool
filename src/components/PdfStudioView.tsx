import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Download,
  FileText,
  FolderOpen,
  GripVertical,
  Printer,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  buildImposedBookletPdf,
  computeImpositionSheets,
  ImpositionSheetOptions,
  PagesPerSideOption,
  PdfSlotItem,
  shareOrDownloadPdf,
} from '../lib/pdfGenerator';

function makeSlotId(): string {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextStandardLabel(existing: PdfSlotItem[]): string {
  const num = existing.filter((p) => p.kind !== 'cover' && p.kind !== 'back').length;
  const sheet = Math.floor(num / 2) + 1;
  const side = num % 2 === 0 ? 'A' : 'B';
  return `${sheet}${side}`;
}

// Estimate character capacity per page-length placeholder at 10pt font size
function getPageTextCapacity(pagesPerSide: PagesPerSideOption): number {
  if (pagesPerSide === 1) return 3200; // Full A4 @ 10pt
  if (pagesPerSide === 2) return 1500; // Half A4 @ 10pt
  return 720; // Quarter A4 @ 10pt
}

function paginateTextForLayout(
  text: string,
  pagesPerSide: PagesPerSideOption
): string[] {
  const capacity = getPageTextCapacity(pagesPerSide);
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [''];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + capacity);
    if (end < normalized.length) {
      const lastBreak = Math.max(
        normalized.lastIndexOf('\n', end),
        normalized.lastIndexOf(' ', end)
      );
      if (lastBreak > cursor + capacity * 0.6) {
        end = lastBreak + 1;
      }
    }
    chunks.push(normalized.slice(cursor, end).trimEnd());
    cursor = end;
  }
  return chunks;
}

export const PdfStudioView: React.FC = () => {
  const [pages, setPages] = useState<PdfSlotItem[]>([
    { id: 'init-0x', label: '0X', kind: 'cover' },
    { id: 'init-1a', label: '1A', kind: 'blank' },
    { id: 'init-1b', label: '1B', kind: 'blank' },
    { id: 'init-2a', label: '2A', kind: 'blank' },
    { id: 'init-2b', label: '2B', kind: 'blank' },
    { id: 'init-xx', label: 'XX', kind: 'back' },
  ]);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>('init-1a');
  const [insertPosition, setInsertPosition] = useState<'end' | 'beginning' | 'after'>('end');

  // Sheet & Assembly Setup matching exact screenshot controls
  const [pagesPerSide, setPagesPerSide] = useState<PagesPerSideOption>(2);
  const [foldVertically, setFoldVertically] = useState(true);
  const [cutVertically, setCutVertically] = useState(false);
  const [foldHorizontally, setFoldHorizontally] = useState(false);
  const [cutHorizontally, setCutHorizontally] = useState(false);
  const [showGuidelineMarks, setShowGuidelineMarks] = useState(true);
  const [showTinyPageId, setShowTinyPageId] = useState(true);

  const [renderedOptions, setRenderedOptions] = useState<ImpositionSheetOptions>({
    pagesPerSide: 2,
    foldVertically: true,
    cutVertically: false,
    foldHorizontally: false,
    cutHorizontally: false,
    showGuidelineMarks: true,
    showTinyPageId: true,
  });

  const [zoomPercent, setZoomPercent] = useState<number>(60);
  const [pdfTitle, setPdfTitle] = useState('ASAN_A4_Booklet');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetsContainerRef = useRef<HTMLDivElement | null>(null);

  const sheets = useMemo(
    () => computeImpositionSheets(pages, renderedOptions),
    [pages, renderedOptions]
  );

  const insertNewSlots = useCallback(
    (newSlots: PdfSlotItem[]) => {
      setPages((prev) => {
        if (insertPosition === 'beginning') {
          return [...newSlots, ...prev];
        }
        if (insertPosition === 'after' && selectedSlotId) {
          const idx = prev.findIndex((p) => p.id === selectedSlotId);
          if (idx >= 0) {
            return [...prev.slice(0, idx + 1), ...newSlots, ...prev.slice(idx + 1)];
          }
        }
        return [...prev, ...newSlots];
      });
      if (newSlots[0]) {
        setSelectedSlotId(newSlots[0].id);
      }
    },
    [insertPosition, selectedSlotId]
  );

  const handleAddImageFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const id = makeSlotId();
          setPages((prev) => {
            const label = nextStandardLabel(prev);
            const item: PdfSlotItem = {
              id,
              label,
              kind: 'image',
              imageDataUrl: reader.result as string,
            };
            if (insertPosition === 'beginning') return [item, ...prev];
            if (insertPosition === 'after' && selectedSlotId) {
              const idx = prev.findIndex((p) => p.id === selectedSlotId);
              if (idx >= 0) {
                return [...prev.slice(0, idx + 1), item, ...prev.slice(idx + 1)];
              }
            }
            return [...prev, item];
          });
          setSelectedSlotId(id);
          setStatusMsg(`Added image "${file.name}".`);
        }
      };
      reader.readAsDataURL(file);
    },
    [insertPosition, selectedSlotId]
  );

  const handleAddTextSlots = useCallback(
    (rawText: string) => {
      const chunks = paginateTextForLayout(rawText, pagesPerSide);
      const created: PdfSlotItem[] = chunks.map((chunk, i) => ({
        id: makeSlotId(),
        label: `T${pages.length + i + 1}`,
        kind: 'text',
        textContent: chunk,
      }));
      insertNewSlots(created);
      setStatusMsg(
        `Pasted text into ${created.length} ${
          pagesPerSide === 1 ? 'Full A4' : pagesPerSide === 2 ? 'Half A4' : 'Quarter A4'
        } page placeholder(s) at 10pt font.`
      );
    },
    [insertNewSlots, pages.length, pagesPerSide]
  );

  // Clipboard Paste Listener (Ctrl+V anywhere in PDF Tool when not typing inside an input/textarea)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isEditable) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleAddImageFile(file);
            return;
          }
        }
      }

      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        handleAddTextSlots(text);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleAddImageFile, handleAddTextSlots]);

  const handlePasteButtonClick = async () => {
    setStatusMsg(null);
    try {
      if (navigator.clipboard && 'read' in navigator.clipboard) {
        const clipItems = await navigator.clipboard.read();
        for (const item of clipItems) {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const file = new File([blob], 'pasted-image.png', { type: imageType });
            handleAddImageFile(file);
            return;
          }
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            if (text.trim()) {
              handleAddTextSlots(text);
              return;
            }
          }
        }
      }
      if (navigator.clipboard && 'readText' in navigator.clipboard) {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          handleAddTextSlots(text);
          return;
        }
      }
      setStatusMsg('Press Ctrl+V on your keyboard to paste clipboard images or text.');
    } catch {
      setStatusMsg('Clipboard permission blocked — press Ctrl+V directly to paste images or text.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach((file) => {
      if (file.type.startsWith('image/')) {
        handleAddImageFile(file);
      }
    });
    const droppedText = e.dataTransfer.getData('text/plain');
    if (files.length === 0 && droppedText && droppedText.trim()) {
      handleAddTextSlots(droppedText);
    }
  };

  const handleAutocorrect = () => {
    setPages((prev) => {
      const covers = prev.filter((p) => p.kind === 'cover');
      const backs = prev.filter((p) => p.kind === 'back');
      const middle = prev.filter((p) => p.kind !== 'cover' && p.kind !== 'back');

      const ordered = [...covers, ...middle, ...backs];
      const multiple = pagesPerSide === 1 ? 1 : pagesPerSide === 2 ? 4 : 8;
      const remainder = ordered.length % multiple;
      if (remainder !== 0) {
        const needed = multiple - remainder;
        const blanks: PdfSlotItem[] = Array.from({ length: needed }, () => ({
          id: makeSlotId(),
          label: 'Blank',
          kind: 'blank',
        }));
        // Insert padding blanks before Back cover if one exists
        if (backs.length > 0) {
          return [...covers, ...middle, ...blanks, ...backs];
        }
        return [...ordered, ...blanks];
      }
      return ordered;
    });
    setStatusMsg('Autocorrected cover/back ordering and booklet page padding.');
  };

  const movePage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  };

  const handleRenderSheets = () => {
    setRenderedOptions({
      pagesPerSide,
      foldVertically,
      cutVertically,
      foldHorizontally,
      cutHorizontally,
      showGuidelineMarks,
      showTinyPageId,
    });
    setStatusMsg(`Rendered ${sheets.length} A4 sheet side(s).`);
  };

  const handleToggleFold = (axis: 'vertical' | 'horizontal', checked: boolean) => {
    if (axis === 'vertical') {
      setFoldVertically(checked);
      if (checked) setFoldHorizontally(false);
    } else {
      setFoldHorizontally(checked);
      if (checked) setFoldVertically(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    setStatusMsg(null);
    try {
      const file = await buildImposedBookletPdf(pdfTitle, sheets, renderedOptions);
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg(`Exported "${file.name}" (${sheets.length} A4 sheet sides).`);
    } finally {
      setExporting(false);
    }
  };

  const handleSharePdf = async () => {
    setExporting(true);
    setStatusMsg(null);
    try {
      const file = await buildImposedBookletPdf(pdfTitle, sheets, renderedOptions);
      const res = await shareOrDownloadPdf(file, pdfTitle);
      setStatusMsg(
        res === 'shared'
          ? 'Shared imposed A4 PDF via native share sheet.'
          : 'Downloaded PDF — ready to attach in any messaging or document app.'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleExportPngs = async () => {
    if (!sheetsContainerRef.current) return;
    setExporting(true);
    setStatusMsg(null);
    try {
      const sheetNodes = sheetsContainerRef.current.querySelectorAll('[data-sheet-card]');
      for (let i = 0; i < sheetNodes.length; i++) {
        const node = sheetNodes[i] as HTMLElement;
        const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${pdfTitle}_sheet_${i + 1}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setStatusMsg(`Exported ${sheetNodes.length} PNG sheet(s).`);
    } catch {
      setStatusMsg('Unable to render PNGs in this browser; try Export PDF instead.');
    } finally {
      setExporting(false);
    }
  };

  const selectedSlot = pages.find((p) => p.id === selectedSlotId) || null;
  const activePageLengthLabel =
    pagesPerSide === 1
      ? 'Full A4 Page'
      : pagesPerSide === 2
        ? 'Half A4 Page'
        : 'Quarter A4 Page';

  return (
    <div className="space-y-3">
      {/* Studio Top Bar matching screenshot */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#141518] px-4 py-2.5 text-white">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-semibold tracking-tight">
            A4 Booklet &amp; Imposition Studio
          </span>
          <input
            type="text"
            value={pdfTitle}
            onChange={(e) => setPdfTitle(e.target.value)}
            aria-label="PDF file name"
            className="hidden sm:block w-44 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 mr-1">Zoom:</span>
          <button
            type="button"
            onClick={() => setZoomPercent((z) => Math.max(25, z - 10))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 hover:bg-slate-700"
          >
            -
          </button>
          <span className="w-12 text-center font-mono tabular-nums">{zoomPercent}%</span>
          <button
            type="button"
            onClick={() => setZoomPercent((z) => Math.min(120, z + 10))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 hover:bg-slate-700"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent(100)}
            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 hover:bg-slate-700"
          >
            100%
          </button>
          <button
            type="button"
            onClick={() => setZoomPercent(60)}
            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 hover:bg-slate-700"
          >
            Fit
          </button>
        </div>

        {/* Export & Print Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPngs}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export PNGs
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={handleSharePdf}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            Print (0.5cm Margins)
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="no-print rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700">
          {statusMsg}
        </div>
      )}

      {/* Split Studio Body: Left Controls + Right Dark Preview Canvas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Control Column */}
        <div className="no-print lg:col-span-4 space-y-4">
          {/* Insert / Paste Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Insert / Append at Position:
              </label>
              <select
                value={insertPosition}
                onChange={(e) =>
                  setInsertPosition(e.target.value as 'end' | 'beginning' | 'after')
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="end">End of list</option>
                <option value="beginning">Beginning of list</option>
                <option value="after">After selected page</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePasteButtonClick}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Paste (Ctrl+V)
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                Choose Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  Array.from(e.target.files || []).forEach(handleAddImageFile);
                  e.target.value = '';
                }}
              />
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="rounded-lg border border-dashed border-blue-400 bg-blue-50/40 px-3 py-3 text-center text-xs text-blue-700"
            >
              Press <strong>Ctrl + V</strong> or drag images / text here
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  insertNewSlots([{ id: makeSlotId(), label: '0X', kind: 'cover' }])
                }
                className="rounded border border-emerald-300 bg-white py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                + Cover (0X)
              </button>
              <button
                type="button"
                onClick={() =>
                  insertNewSlots([
                    { id: makeSlotId(), label: nextStandardLabel(pages), kind: 'blank' },
                  ])
                }
                className="rounded border border-blue-300 bg-white py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
              >
                + Page
              </button>
              <button
                type="button"
                onClick={() =>
                  insertNewSlots([{ id: makeSlotId(), label: 'XX', kind: 'back' }])
                }
                className="rounded border border-slate-300 bg-white py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                + Back (XX)
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    insertNewSlots([
                      { id: makeSlotId(), label: 'Blank', kind: 'blank' },
                    ])
                  }
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  + Blank Slot
                </button>
                <button
                  type="button"
                  onClick={() => handleAddTextSlots('Type or paste 10pt text content here...')}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  + 10pt Text
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPages([]);
                  setSelectedSlotId(null);
                }}
                className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Pages List with Autocorrect & Reordering */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 tabular-nums">
                Pages ({pages.length})
              </span>
              <button
                type="button"
                onClick={handleAutocorrect}
                className="inline-flex items-center gap-1 rounded bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-500"
              >
                <Sparkles className="h-3 w-3" />
                Autocorrect
              </button>
            </div>

            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {pages.map((slot, idx) => {
                const isSelected = slot.id === selectedSlotId;
                return (
                  <div
                    key={slot.id}
                    onClick={() => setSelectedSlotId(slot.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs cursor-pointer ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="w-7 text-center font-mono text-[10px] text-slate-500 border border-slate-200 rounded bg-slate-50 py-0.5 shrink-0">
                      {slot.kind === 'text' ? '10pt' : slot.kind === 'image' ? 'IMG' : slot.label}
                    </span>
                    <input
                      type="text"
                      value={slot.label}
                      onChange={(e) =>
                        setPages((prev) =>
                          prev.map((p) =>
                            p.id === slot.id ? { ...p, label: e.target.value } : p
                          )
                        )
                      }
                      className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-800"
                    />
                    {slot.kind === 'back' && (
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        BACK
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        movePage(idx, -1);
                      }}
                      className="p-0.5 text-slate-500 hover:text-slate-900"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        movePage(idx, 1);
                      }}
                      className="p-0.5 text-slate-500 hover:text-slate-900"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPages((prev) => prev.filter((p) => p.id !== slot.id));
                      }}
                      className="p-0.5 text-red-500 hover:text-red-700"
                      aria-label="Remove page"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Inline Editor for Selected 10pt Text Placeholder */}
            {selectedSlot && selectedSlot.kind === 'text' && (
              <div className="border-t border-slate-100 pt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                  <span>
                    Edit 10pt Text ({activePageLengthLabel})
                  </span>
                  <span className="tabular-nums">
                    {(selectedSlot.textContent || '').length} chars
                  </span>
                </div>
                <textarea
                  rows={5}
                  value={selectedSlot.textContent || ''}
                  onChange={(e) =>
                    setPages((prev) =>
                      prev.map((p) =>
                        p.id === selectedSlot.id
                          ? { ...p, textContent: e.target.value }
                          : p
                      )
                    )
                  }
                  style={{ fontSize: '10pt' }}
                  className="w-full rounded-lg border border-slate-200 p-2.5 leading-snug text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Sheet & Assembly Setup */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-900">
              Sheet &amp; Assembly Setup
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Pages Per A4 Side:
              </label>
              <select
                value={pagesPerSide}
                onChange={(e) =>
                  setPagesPerSide(Number(e.target.value) as PagesPerSideOption)
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value={2}>2 Pages per side (Half A4 Booklet)</option>
                <option value={4}>4 Pages per side (Quarter A4 Booklet)</option>
                <option value={1}>1 Page per side (Full A4)</option>
              </select>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-2.5">
              <div className="text-xs font-medium text-blue-700">
                Paper Actions (Max 1 Fold total, 0–2 Cuts):
              </div>

              <div className="space-y-1 border-b border-slate-100 pb-2 text-xs text-slate-700">
                <div className="font-semibold text-slate-800">
                  Vertical Center Axis:
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={foldVertically}
                    onChange={(e) => handleToggleFold('vertical', e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-blue-600"
                  />
                  Fold Vertically
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cutVertically}
                    onChange={(e) => setCutVertically(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-blue-600"
                  />
                  Cut Vertically
                </label>
              </div>

              <div className="space-y-1 text-xs text-slate-700">
                <div className="font-semibold text-slate-800">
                  Horizontal Center Axis:
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={foldHorizontally}
                    onChange={(e) =>
                      handleToggleFold('horizontal', e.target.checked)
                    }
                    className="h-3.5 w-3.5 rounded text-blue-600"
                  />
                  Fold Horizontally
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cutHorizontally}
                    onChange={(e) => setCutHorizontally(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-blue-600"
                  />
                  Cut Horizontally
                </label>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGuidelineMarks}
                  onChange={(e) => setShowGuidelineMarks(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-blue-600"
                />
                Show Fold &amp; Cut Guideline Marks
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTinyPageId}
                  onChange={(e) => setShowTinyPageId(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-blue-600"
                />
                Show Tiny Page ID on Corner
              </label>
            </div>

            <button
              type="button"
              onClick={handleRenderSheets}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Render A4 Sheets
            </button>
          </div>
        </div>

        {/* Right Dark Studio Viewport */}
        <div
          ref={sheetsContainerRef}
          className="lg:col-span-8 rounded-xl bg-[#202124] p-6 overflow-auto min-h-[75vh] max-h-[82vh] space-y-8 print-only-sheets"
        >
          {sheets.map((sheet, sheetIdx) => {
            const baseW = sheet.orientation === 'landscape' ? 842 : 595;
            const baseH = sheet.orientation === 'landscape' ? 595 : 842;
            const scale = zoomPercent / 100;

            return (
              <div
                key={`${sheet.sheetNumber}-${sheet.side}-${sheetIdx}`}
                className="mx-auto flex flex-col items-center print-sheet-break"
              >
                <div className="no-print mb-1.5 flex w-full max-w-[842px] items-center justify-between text-[11px] font-mono text-amber-300">
                  <span>{sheet.subtitle}</span>
                  <span>Sheet {sheet.sheetNumber}</span>
                </div>

                <div
                  data-sheet-card
                  style={{
                    width: `${baseW * scale}px`,
                    height: `${baseH * scale}px`,
                  }}
                  className="relative bg-white shadow-2xl overflow-hidden border border-slate-700"
                >
                  <div
                    style={{
                      width: `${baseW}px`,
                      height: `${baseH}px`,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                    className={`grid ${
                      sheet.cols === 2 ? 'grid-cols-2' : 'grid-cols-1'
                    } ${sheet.rows === 2 ? 'grid-rows-2' : 'grid-rows-1'} p-[14px]`}
                  >
                    {sheet.slots.map((slot, slotIdx) => (
                      <div
                        key={`slot-${sheetIdx}-${slotIdx}`}
                        onClick={() => slot && setSelectedSlotId(slot.id)}
                        className="relative flex h-full w-full items-center justify-center border border-slate-100 p-4 overflow-hidden"
                      >
                        {!slot || slot.kind === 'blank' ? (
                          <span className="text-xs text-slate-300">
                            {slot?.label || 'Page Blank'}
                          </span>
                        ) : slot.kind === 'image' && slot.imageDataUrl ? (
                          <img
                            src={slot.imageDataUrl}
                            alt={slot.label}
                            referrerPolicy="no-referrer"
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : slot.kind === 'text' ? (
                          /* Page-length placeholder at exact font size 10pt */
                          <div
                            style={{ fontSize: '10pt', lineHeight: 1.4 }}
                            className="h-full w-full overflow-hidden whitespace-pre-wrap text-left text-slate-900 font-sans"
                          >
                            {slot.textContent}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {slot.label}{' '}
                            {slot.kind === 'cover'
                              ? '(Front Cover)'
                              : slot.kind === 'back'
                                ? '(Back Cover)'
                                : ''}
                          </span>
                        )}

                        {renderedOptions.showTinyPageId && slot && (
                          <span className="absolute bottom-1.5 right-1.5 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">
                            {slot.label}
                          </span>
                        )}
                      </div>
                    ))}

                    {/* Fold & Cut Guideline Marks */}
                    {renderedOptions.showGuidelineMarks && (
                      <>
                        {(renderedOptions.foldVertically ||
                          renderedOptions.cutVertically) && (
                          <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-sky-400" />
                        )}
                        {(renderedOptions.foldHorizontally ||
                          renderedOptions.cutHorizontally) && (
                          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-rose-400" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
