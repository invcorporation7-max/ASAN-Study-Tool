import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Crop,
  Download,
  FileText,
  FolderOpen,
  GripVertical,
  Layers,
  Printer,
  RotateCw,
  Share2,
  Sparkles,
  Square,
  Trash2,
  X,
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

function getPageTextCapacity(pagesPerSide: PagesPerSideOption): number {
  if (pagesPerSide === 1) return 3200;
  if (pagesPerSide === 2) return 1500;
  return 720;
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

interface CropRectPct {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function rotateImageDataUrl90(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

async function cropImageDataUrl(dataUrl: string, rect: CropRectPct): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, Math.round((rect.x / 100) * img.width));
      const sy = Math.max(0, Math.round((rect.y / 100) * img.height));
      const sw = Math.max(10, Math.min(img.width - sx, Math.round((rect.w / 100) * img.width)));
      const sh = Math.max(10, Math.min(img.height - sy, Math.round((rect.h / 100) * img.height)));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
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
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
  const [insertPosition, setInsertPosition] = useState<'end' | 'beginning' | 'after'>('end');

  // Sheet & Assembly Setup
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

  // Page View, Scroll & Responsive Fit Zoom
  const [viewMode, setViewMode] = useState<'scroll' | 'single'>('scroll');
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [zoomPercent, setZoomPercent] = useState<number>(60);
  const [autoFitDone, setAutoFitDone] = useState(false);

  const [pdfTitle, setPdfTitle] = useState('ASAN_A4_Booklet');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Interactive Image Crop & Rotate Modal State
  const [cropSlotId, setCropSlotId] = useState<string | null>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string>('');
  const [cropNaturalSize, setCropNaturalSize] = useState<{ w: number; h: number }>({
    w: 1000,
    h: 1000,
  });
  const [cropRect, setCropRect] = useState<CropRectPct>({ x: 0, y: 0, w: 100, h: 100 });
  const [cropBusy, setCropBusy] = useState(false);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    mode: 'move' | 'se';
    startX: number;
    startY: number;
    startRect: CropRectPct;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetsContainerRef = useRef<HTMLDivElement | null>(null);
  const sheetCardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const sheets = useMemo(
    () => computeImpositionSheets(pages, renderedOptions),
    [pages, renderedOptions]
  );

  // Clamp activeSheetIdx when sheet count changes
  useEffect(() => {
    if (activeSheetIdx >= sheets.length && sheets.length > 0) {
      setActiveSheetIdx(sheets.length - 1);
    }
  }, [sheets.length, activeSheetIdx]);

  const computeFitZoom = useCallback(() => {
    const container = sheetsContainerRef.current;
    if (!container) return 60;
    const isLandscape = renderedOptions.pagesPerSide !== 1;
    const baseW = isLandscape ? 842 : 595;
    const availW = Math.max(240, container.clientWidth - 48);
    const pct = Math.floor((availW / baseW) * 100);
    return Math.max(28, Math.min(100, pct));
  }, [renderedOptions.pagesPerSide]);

  useEffect(() => {
    if (!autoFitDone && sheetsContainerRef.current) {
      setZoomPercent(computeFitZoom());
      setAutoFitDone(true);
    }
  }, [autoFitDone, computeFitZoom]);

  const jumpToSheet = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(sheets.length - 1, idx));
      setActiveSheetIdx(clamped);
      if (viewMode === 'scroll') {
        const el = sheetCardRefs.current[clamped];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [sheets.length, viewMode]
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

  // Clipboard Paste Listener (Ctrl+V)
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

  const handleDropFiles = (e: React.DragEvent) => {
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

  // Multi-select / Group Image Reordering
  const toggleCheckSlot = (idx: number, id: string, shiftKey: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, idx);
        const end = Math.max(lastCheckedIndex, idx);
        for (let i = start; i <= end; i++) {
          if (pages[i]) next.add(pages[i].id);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setLastCheckedIndex(idx);
  };

  const selectAllImages = () => {
    const imgIds = pages.filter((p) => p.kind === 'image').map((p) => p.id);
    if (imgIds.length === 0) {
      setStatusMsg('No images in the page list yet.');
      return;
    }
    setCheckedIds(new Set(imgIds));
    setStatusMsg(`Selected ${imgIds.length} image(s) for group reordering.`);
  };

  const moveCheckedGroup = (direction: 'up' | 'down' | 'top' | 'bottom') => {
    if (checkedIds.size === 0) return;
    setPages((prev) => {
      const selectedItems = prev.filter((p) => checkedIds.has(p.id));
      const remainingItems = prev.filter((p) => !checkedIds.has(p.id));
      if (selectedItems.length === 0) return prev;

      if (direction === 'top') {
        return [...selectedItems, ...remainingItems];
      }
      if (direction === 'bottom') {
        return [...remainingItems, ...selectedItems];
      }

      if (direction === 'up') {
        const firstIdx = prev.findIndex((p) => checkedIds.has(p.id));
        if (firstIdx <= 0) {
          // Compact group cleanly to top even if non-contiguous
          return [...selectedItems, ...remainingItems];
        }
        // Find item immediately before the first selected item
        const anchorId = prev[firstIdx - 1].id;
        const anchorPosInRemaining = remainingItems.findIndex((p) => p.id === anchorId);
        const insertAt = Math.max(0, anchorPosInRemaining);
        return [
          ...remainingItems.slice(0, insertAt),
          ...selectedItems,
          ...remainingItems.slice(insertAt),
        ];
      }

      // direction === 'down'
      let lastIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (checkedIds.has(prev[i].id)) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx === -1 || lastIdx >= prev.length - 1) {
        return [...remainingItems, ...selectedItems];
      }
      const afterId = prev[lastIdx + 1].id;
      const afterPosInRemaining = remainingItems.findIndex((p) => p.id === afterId);
      const insertAt = afterPosInRemaining >= 0 ? afterPosInRemaining + 1 : remainingItems.length;
      return [
        ...remainingItems.slice(0, insertAt),
        ...selectedItems,
        ...remainingItems.slice(insertAt),
      ];
    });
    setStatusMsg(`Reordered ${checkedIds.size} grouped item(s).`);
  };

  const handleGroupDropOnSlot = (targetSlotId: string) => {
    if (!draggedSlotId || draggedSlotId === targetSlotId) {
      setDraggedSlotId(null);
      setDragOverSlotId(null);
      return;
    }

    const movingIds = checkedIds.has(draggedSlotId)
      ? new Set(checkedIds)
      : new Set([draggedSlotId]);

    if (movingIds.has(targetSlotId)) {
      setDraggedSlotId(null);
      setDragOverSlotId(null);
      return;
    }

    setPages((prev) => {
      const targetOldIdx = prev.findIndex((p) => p.id === targetSlotId);
      const draggedOldIdx = prev.findIndex((p) => p.id === draggedSlotId);
      const movingItems = prev.filter((p) => movingIds.has(p.id));
      const remaining = prev.filter((p) => !movingIds.has(p.id));
      const targetIdxInRemaining = remaining.findIndex((p) => p.id === targetSlotId);
      if (targetIdxInRemaining < 0) return prev;
      const insertIdx =
        draggedOldIdx < targetOldIdx ? targetIdxInRemaining + 1 : targetIdxInRemaining;
      return [
        ...remaining.slice(0, insertIdx),
        ...movingItems,
        ...remaining.slice(insertIdx),
      ];
    });

    setStatusMsg(
      movingIds.size > 1
        ? `Moved group of ${movingIds.size} images/pages together.`
        : 'Reordered page.'
    );
    setDraggedSlotId(null);
    setDragOverSlotId(null);
  };

  // Crop Modal Open & Interactive Dragging
  const openCropModal = (slot: PdfSlotItem) => {
    if (slot.kind !== 'image' || !slot.imageDataUrl) return;
    setCropSlotId(slot.id);
    setCropImageSrc(slot.imageDataUrl);
    setCropRect({ x: 0, y: 0, w: 100, h: 100 });
    const img = new Image();
    img.onload = () => {
      setCropNaturalSize({ w: img.width || 1000, h: img.height || 1000 });
    };
    img.src = slot.imageDataUrl;
  };

  const applyAspectPreset = (preset: 'free' | 'a4p' | 'a4h' | '1:1' | '4:3') => {
    if (preset === 'free') {
      setCropRect({ x: 0, y: 0, w: 100, h: 100 });
      return;
    }
    const targetRatio =
      preset === 'a4p'
        ? 210 / 297
        : preset === 'a4h'
          ? 148.5 / 210
          : preset === '1:1'
            ? 1
            : 4 / 3;
    const natRatio = cropNaturalSize.w / Math.max(1, cropNaturalSize.h);
    let wPct = 100;
    let hPct = 100;
    if (natRatio > targetRatio) {
      wPct = Math.max(15, Math.min(100, (targetRatio / natRatio) * 100));
    } else {
      hPct = Math.max(15, Math.min(100, (natRatio / targetRatio) * 100));
    }
    setCropRect({
      x: Math.round((100 - wPct) / 2),
      y: Math.round((100 - hPct) / 2),
      w: Math.round(wPct),
      h: Math.round(hPct),
    });
  };

  const handleCropPointerDown = (mode: 'move' | 'se', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...cropRect },
    };
  };

  const handleCropPointerMove = (e: React.PointerEvent) => {
    const ds = dragStateRef.current;
    const stage = cropStageRef.current;
    if (!ds || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxPct = ((e.clientX - ds.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - ds.startY) / rect.height) * 100;

    if (ds.mode === 'move') {
      const nx = Math.max(0, Math.min(100 - ds.startRect.w, ds.startRect.x + dxPct));
      const ny = Math.max(0, Math.min(100 - ds.startRect.h, ds.startRect.y + dyPct));
      setCropRect({
        ...ds.startRect,
        x: Math.round(nx),
        y: Math.round(ny),
      });
    } else {
      const nw = Math.max(10, Math.min(100 - ds.startRect.x, ds.startRect.w + dxPct));
      const nh = Math.max(10, Math.min(100 - ds.startRect.y, ds.startRect.h + dyPct));
      setCropRect({
        ...ds.startRect,
        w: Math.round(nw),
        h: Math.round(nh),
      });
    }
  };

  const handleCropPointerUp = () => {
    dragStateRef.current = null;
  };

  const handleRotateInCropModal = async () => {
    if (!cropImageSrc) return;
    setCropBusy(true);
    try {
      const rotated = await rotateImageDataUrl90(cropImageSrc);
      setCropImageSrc(rotated);
      setCropRect({ x: 0, y: 0, w: 100, h: 100 });
      setCropNaturalSize((prev) => ({ w: prev.h, h: prev.w }));
    } finally {
      setCropBusy(false);
    }
  };

  const handleApplyCrop = async () => {
    if (!cropSlotId || !cropImageSrc) return;
    setCropBusy(true);
    try {
      const croppedUrl = await cropImageDataUrl(cropImageSrc, cropRect);
      setPages((prev) =>
        prev.map((p) => (p.id === cropSlotId ? { ...p, imageDataUrl: croppedUrl } : p))
      );
      setStatusMsg('Applied crop/rotation to image.');
      setCropSlotId(null);
    } catch {
      setStatusMsg('Failed to crop image in browser canvas.');
    } finally {
      setCropBusy(false);
    }
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

  const visibleSheets =
    viewMode === 'single' && sheets[activeSheetIdx]
      ? [{ sheet: sheets[activeSheetIdx], sheetIdx: activeSheetIdx }]
      : sheets.map((sheet, sheetIdx) => ({ sheet, sheetIdx }));

  return (
    <div className="space-y-3">
      {/* Studio Top Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#141518] px-3 sm:px-4 py-2.5 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-display text-sm font-semibold tracking-tight truncate">
            A4 Booklet &amp; Imposition Studio
          </span>
          <input
            type="text"
            value={pdfTitle}
            onChange={(e) => setPdfTitle(e.target.value)}
            aria-label="PDF file name"
            className="hidden sm:block w-40 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Zoom & View Mode Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex items-center rounded border border-slate-700 bg-slate-800 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('scroll')}
              className={`rounded px-2 py-1 text-[11px] font-medium ${
                viewMode === 'scroll' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Scroll All
            </button>
            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={`rounded px-2 py-1 text-[11px] font-medium ${
                viewMode === 'single' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Single Page
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoomPercent((z) => Math.max(25, z - 10))}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 hover:bg-slate-700"
              aria-label="Zoom out"
            >
              -
            </button>
            <span className="w-11 text-center font-mono tabular-nums">{zoomPercent}%</span>
            <button
              type="button"
              onClick={() => setZoomPercent((z) => Math.min(130, z + 10))}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 hover:bg-slate-700"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoomPercent(100)}
              className="hidden sm:inline-block rounded border border-slate-700 bg-slate-800 px-2 py-1 hover:bg-slate-700"
            >
              100%
            </button>
            <button
              type="button"
              onClick={() => setZoomPercent(computeFitZoom())}
              className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 hover:bg-slate-700"
            >
              Fit
            </button>
          </div>
        </div>

        {/* Export & Print Actions */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleExportPngs}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            PNGs
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={handleSharePdf}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-700 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
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
              onDrop={handleDropFiles}
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

            <div className="flex flex-wrap items-center justify-between gap-2">
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
                  setCheckedIds(new Set());
                }}
                className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Pages List with Group Reordering, Image Cropping & Autocorrect */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 tabular-nums">
                Pages ({pages.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={selectAllImages}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  Select Images
                </button>
                <button
                  type="button"
                  onClick={handleAutocorrect}
                  className="inline-flex items-center gap-1 rounded bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                >
                  <Sparkles className="h-3 w-3" />
                  Autocorrect
                </button>
              </div>
            </div>

            {/* Group Image Reorder Bar */}
            {checkedIds.size > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-blue-900">
                  <span>{checkedIds.size} Selected · Drag or move group together</span>
                  <button
                    type="button"
                    onClick={() => setCheckedIds(new Set())}
                    className="text-blue-700 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => moveCheckedGroup('top')}
                    className="rounded border border-blue-200 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-blue-100"
                  >
                    To Top
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCheckedGroup('up')}
                    className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-blue-100"
                  >
                    <ArrowUp className="h-3 w-3" />
                    Group Up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCheckedGroup('down')}
                    className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-blue-100"
                  >
                    <ArrowDown className="h-3 w-3" />
                    Group Down
                  </button>
                  <button
                    type="button"
                    onClick={() => moveCheckedGroup('bottom')}
                    className="rounded border border-blue-200 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-blue-100"
                  >
                    To Bottom
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPages((prev) => prev.filter((p) => !checkedIds.has(p.id)));
                      setCheckedIds(new Set());
                    }}
                    className="ml-auto rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {pages.map((slot, idx) => {
                const isSelected = slot.id === selectedSlotId;
                const isChecked = checkedIds.has(slot.id);
                const isDragTarget = dragOverSlotId === slot.id;
                return (
                  <div
                    key={slot.id}
                    draggable
                    onDragStart={() => setDraggedSlotId(slot.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedSlotId && draggedSlotId !== slot.id) {
                        setDragOverSlotId(slot.id);
                      }
                    }}
                    onDragLeave={() => setDragOverSlotId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleGroupDropOnSlot(slot.id);
                    }}
                    onDragEnd={() => {
                      setDraggedSlotId(null);
                      setDragOverSlotId(null);
                    }}
                    onClick={() => setSelectedSlotId(slot.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                      isDragTarget
                        ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-400'
                        : isChecked
                          ? 'border-blue-400 bg-blue-50/40'
                          : isSelected
                            ? 'border-blue-500 bg-slate-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCheckSlot(idx, slot.id, e.shiftKey);
                      }}
                      className="text-slate-500 hover:text-blue-600 shrink-0"
                      aria-label={`Select ${slot.label} for group reorder`}
                    >
                      {isChecked ? (
                        <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <GripVertical className="h-3.5 w-3.5 text-slate-400 shrink-0 cursor-grab" />
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
                    {slot.kind === 'image' && slot.imageDataUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCropModal(slot);
                        }}
                        title="Crop & Rotate Image"
                        aria-label="Crop and rotate image"
                        className="rounded border border-amber-200 bg-amber-50 p-1 text-amber-700 hover:bg-amber-100 shrink-0"
                      >
                        <Crop className="h-3 w-3" />
                      </button>
                    )}
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
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(slot.id);
                          return next;
                        });
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

            {selectedSlot && selectedSlot.kind === 'image' && selectedSlot.imageDataUrl && (
              <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 truncate">
                  Image: <strong>{selectedSlot.label}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => openCropModal(selectedSlot)}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-600 shrink-0"
                >
                  <Crop className="h-3.5 w-3.5" />
                  Crop &amp; Rotate
                </button>
              </div>
            )}

            {/* Inline Editor for Selected 10pt Text Placeholder */}
            {selectedSlot && selectedSlot.kind === 'text' && (
              <div className="border-t border-slate-100 pt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                  <span>Edit 10pt Text ({activePageLengthLabel})</span>
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
                <div className="font-semibold text-slate-800">Vertical Center Axis:</div>
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
                <div className="font-semibold text-slate-800">Horizontal Center Axis:</div>
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

        {/* Right Dark Studio Viewport with Sheet Navigation & Smooth Scroll */}
        <div className="lg:col-span-8 flex flex-col rounded-xl bg-[#202124] overflow-hidden border border-slate-800 print-only-sheets">
          {/* Page View & Jump Bar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-[#18191c] px-3 sm:px-4 py-2 text-xs text-slate-200">
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
              <Layers className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-400 shrink-0">
                Sheets ({sheets.length}):
              </span>
              {sheets.map((s, i) => (
                <button
                  key={`jump-${i}`}
                  type="button"
                  onClick={() => jumpToSheet(i)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] shrink-0 transition-colors ${
                    activeSheetIdx === i
                      ? 'bg-amber-400 font-bold text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {s.sheetNumber}
                  {s.side === 'FRONT' ? 'F' : 'B'}
                </button>
              ))}
            </div>

            {viewMode === 'single' && sheets.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={activeSheetIdx <= 0}
                  onClick={() => jumpToSheet(activeSheetIdx - 1)}
                  className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="font-mono text-[11px] tabular-nums">
                  {activeSheetIdx + 1} / {sheets.length}
                </span>
                <button
                  type="button"
                  disabled={activeSheetIdx >= sheets.length - 1}
                  onClick={() => jumpToSheet(activeSheetIdx + 1)}
                  className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div
            ref={sheetsContainerRef}
            className="flex-1 p-3 sm:p-6 overflow-auto min-h-[58vh] lg:min-h-[75vh] max-h-[82vh] space-y-6 sm:space-y-8 scroll-smooth touch-pan-x touch-pan-y"
          >
            {sheets.length === 0 ? (
              <div className="flex h-full min-h-[300px] items-center justify-center text-xs text-slate-400">
                Add pages or images to generate imposed A4 sheets.
              </div>
            ) : (
              visibleSheets.map(({ sheet, sheetIdx }) => {
                const baseW = sheet.orientation === 'landscape' ? 842 : 595;
                const baseH = sheet.orientation === 'landscape' ? 595 : 842;
                const scale = zoomPercent / 100;

                return (
                  <div
                    key={`${sheet.sheetNumber}-${sheet.side}-${sheetIdx}`}
                    ref={(el) => {
                      sheetCardRefs.current[sheetIdx] = el;
                    }}
                    className="mx-auto flex flex-col items-center print-sheet-break scroll-mt-4"
                  >
                    <div
                      style={{ width: `${Math.max(240, baseW * scale)}px` }}
                      className="no-print mb-1.5 flex items-center justify-between text-[11px] font-mono text-amber-300"
                    >
                      <span className="truncate">{sheet.subtitle}</span>
                      <span className="shrink-0 ml-2">Sheet {sheet.sheetNumber}</span>
                    </div>

                    <div
                      data-sheet-card
                      style={{
                        width: `${baseW * scale}px`,
                        height: `${baseH * scale}px`,
                      }}
                      className="relative bg-white shadow-2xl overflow-hidden border border-slate-700 shrink-0"
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
                            className="relative flex h-full w-full items-center justify-center border border-slate-100 p-4 overflow-hidden group"
                          >
                            {!slot || slot.kind === 'blank' ? (
                              <span className="text-xs text-slate-300">
                                {slot?.label || 'Page Blank'}
                              </span>
                            ) : slot.kind === 'image' && slot.imageDataUrl ? (
                              <>
                                <img
                                  src={slot.imageDataUrl}
                                  alt={slot.label}
                                  referrerPolicy="no-referrer"
                                  className="max-h-full max-w-full object-contain"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openCropModal(slot);
                                  }}
                                  className="no-print absolute top-2 right-2 hidden group-hover:inline-flex items-center gap-1 rounded bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
                                >
                                  <Crop className="h-3 w-3" />
                                  Crop
                                </button>
                              </>
                            ) : slot.kind === 'text' ? (
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
              })
            )}
          </div>
        </div>
      </div>

      {/* Interactive Image Crop & Rotate Modal */}
      {cropSlotId && cropImageSrc && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Crop className="h-4 w-4 text-amber-400" />
                Crop &amp; Rotate Image
              </div>
              <button
                type="button"
                onClick={() => setCropSlotId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Aspect Ratio & Rotate Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/50 px-4 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-400">Aspect:</span>
                {(
                  [
                    ['free', 'Free'],
                    ['a4p', 'A4 Portrait'],
                    ['a4h', 'A4 Half'],
                    ['1:1', '1:1'],
                    ['4:3', '4:3'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyAspectPreset(id)}
                    className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] hover:bg-slate-700"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={cropBusy}
                onClick={handleRotateInCropModal}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-700"
              >
                <RotateCw className="h-3.5 w-3.5 text-amber-400" />
                Rotate 90°
              </button>
            </div>

            {/* Visual Drag-to-Crop Stage */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#141518]">
              <div
                ref={cropStageRef}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                className="relative inline-block select-none touch-none max-h-[50vh]"
              >
                <img
                  src={cropImageSrc}
                  alt="Crop preview"
                  className="max-h-[48vh] max-w-full object-contain block pointer-events-none"
                />
                {/* Interactive Crop Box */}
                <div
                  onPointerDown={(e) => handleCropPointerDown('move', e)}
                  style={{
                    left: `${cropRect.x}%`,
                    top: `${cropRect.y}%`,
                    width: `${cropRect.w}%`,
                    height: `${cropRect.h}%`,
                  }}
                  className="absolute border-2 border-amber-400 bg-amber-400/10 cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.52)]"
                >
                  <div
                    onPointerDown={(e) => handleCropPointerDown('se', e)}
                    title="Drag corner to resize crop area"
                    className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-white bg-amber-500 cursor-nwse-resize shadow"
                  />
                </div>
              </div>
            </div>

            {/* Fine Numeric Sliders (helpful on small touchscreens) */}
            <div className="border-t border-slate-800 bg-slate-900 px-4 py-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px] text-slate-300 tabular-nums">
              <label className="space-y-1">
                <span>Left: {cropRect.x}%</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, 90 - cropRect.w)}
                  value={cropRect.x}
                  onChange={(e) =>
                    setCropRect((r) => ({ ...r, x: Math.min(Number(e.target.value), 100 - r.w) }))
                  }
                  className="w-full accent-amber-400"
                />
              </label>
              <label className="space-y-1">
                <span>Top: {cropRect.y}%</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, 90 - cropRect.h)}
                  value={cropRect.y}
                  onChange={(e) =>
                    setCropRect((r) => ({ ...r, y: Math.min(Number(e.target.value), 100 - r.h) }))
                  }
                  className="w-full accent-amber-400"
                />
              </label>
              <label className="space-y-1">
                <span>Width: {cropRect.w}%</span>
                <input
                  type="range"
                  min={10}
                  max={100 - cropRect.x}
                  value={cropRect.w}
                  onChange={(e) => setCropRect((r) => ({ ...r, w: Number(e.target.value) }))}
                  className="w-full accent-amber-400"
                />
              </label>
              <label className="space-y-1">
                <span>Height: {cropRect.h}%</span>
                <input
                  type="range"
                  min={10}
                  max={100 - cropRect.y}
                  value={cropRect.h}
                  onChange={(e) => setCropRect((r) => ({ ...r, h: Number(e.target.value) }))}
                  className="w-full accent-amber-400"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3 bg-slate-950/60">
              <button
                type="button"
                onClick={() => setCropRect({ x: 0, y: 0, w: 100, h: 100 })}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setCropSlotId(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={cropBusy}
                onClick={handleApplyCrop}
                className="rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
              >
                {cropBusy ? 'Applying...' : 'Apply Crop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
