import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Tablet, Smartphone, ZoomIn, ZoomOut } from './icons';
import {
  buildPreviewDoc, DEVICE_WIDTH, ZOOM_STEPS, fillZoom,
  type Device, type PreviewMessage,
} from './preview';
import type { TemplateIndex } from '../core/htmlIndex';

interface Props {
  file: string;
  /** The unmodified page file. The preview is assembled from it each time. */
  fileText: string;
  index: TemplateIndex;
  onSelectElement: (elementId: string, runOrdinal: number) => void;
  /** Element to highlight when selection comes from the panel, not a click. */
  selectedElementId: string | null;
  /** Edits pushed into the rendered page as the user types. */
  liveEdits: {
    kind: 'text' | 'attr' | 'css-inline' | 'css-theme';
    elementId: string;
    runOrdinal: number;
    attrName?: string;
    prop?: string;
    value: string;
  }[];
}

export function PageView({ fileText, index, onSelectElement, selectedElementId, liveEdits }: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState<number | 'fill'>('fill');
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  const deviceW = DEVICE_WIDTH[device];

  /**
   * Measure with a ResizeObserver bound in a layout effect. Cold-load
   * correctness was the most frequent bug in this design: a single mount-time
   * measurement is dropped because the pane has no size yet.
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setPane((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setPane({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const effectiveZoom = zoom === 'fill' ? fillZoom(pane.w, deviceW) : zoom;

  // When the pane is wider than the device in Fill mode, let the page reflow at
  // 1:1 instead of capping it at the device width.
  const fillIsWider = zoom === 'fill' && pane.w >= deviceW;

  const frameStyle: React.CSSProperties = fillIsWider
    ? { width: '100%', height: Math.max(240, pane.h) }
    : {
        width: deviceW,
        // The frame fills the pane's height so the page scrolls inside it,
        // like a browser window, rather than the pane scrolling the frame.
        height: Math.max(240, pane.h / (effectiveZoom || 1)),
        transform: `scale(${effectiveZoom})`,
        transformOrigin: 'top left',
      };

  const srcDoc = useMemo(
    () => (fileText ? buildPreviewDoc(fileText, index) : ''),
    [fileText, index],
  );

  // A 2 MB srcdoc is slow to re-parse; a blob URL loads much faster and lets the
  // browser stream it.
  const [blobUrl, setBlobUrl] = useState<string>('');
  useEffect(() => {
    if (!srcDoc) return;
    const url = URL.createObjectURL(new Blob([srcDoc], { type: 'text/html' }));
    setBlobUrl(url);
    setReady(false);
    return () => URL.revokeObjectURL(url);
  }, [srcDoc]);

  useEffect(() => {
    const onMsg = (e: MessageEvent<PreviewMessage>) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'recto:ready') setReady(true);
      if (m.type === 'recto:select') onSelectElement(m.elementId, m.runOrdinal);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelectElement]);

  // Push edits into the rendered page as they are typed.
  useEffect(() => {
    if (!ready) return;
    const w = frameRef.current?.contentWindow;
    if (!w) return;
    for (const e of liveEdits) {
      switch (e.kind) {
        case 'attr':
          w.postMessage({ type: 'recto:set-attr', elementId: e.elementId, attrName: e.attrName, value: e.value }, '*');
          break;
        case 'css-inline':
          w.postMessage({ type: 'recto:set-style', elementId: e.elementId, prop: e.prop, value: e.value }, '*');
          break;
        case 'css-theme':
          w.postMessage({ type: 'recto:set-theme', prop: e.prop, value: e.value }, '*');
          break;
        default:
          w.postMessage({ type: 'recto:set-text', elementId: e.elementId, runOrdinal: e.runOrdinal, value: e.value }, '*');
      }
    }
  }, [liveEdits, ready]);

  useEffect(() => {
    if (!ready || !selectedElementId) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'recto:select-id', elementId: selectedElementId }, '*',
    );
  }, [selectedElementId, ready]);

  const stepZoom = (dir: 1 | -1) => {
    const cur = effectiveZoom;
    const i = ZOOM_STEPS.findIndex((z) => z >= cur - 0.001);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? ZOOM_STEPS.length - 1 : i) + dir))];
    setZoom(next);
  };

  const fitNote = zoom === 'fill'
    ? `${device} · ${deviceW}px · fits the width`
    : `${device} · ${deviceW}px · at ${Math.round(effectiveZoom * 100)}%`;

  return (
    <div className="page-view">
      <div className="viewbar">
        <div className="seg dark">
          <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} title="Desktop" aria-label="Desktop"><Monitor /></button>
          <button className={device === 'tablet' ? 'on' : ''} onClick={() => setDevice('tablet')} title="Tablet" aria-label="Tablet"><Tablet /></button>
          <button className={device === 'phone' ? 'on' : ''} onClick={() => setDevice('phone')} title="Phone" aria-label="Phone"><Smartphone /></button>
        </div>

        <div className="zoom">
          <button className="icon-btn" onClick={() => stepZoom(-1)} aria-label="Zoom out"><ZoomOut /></button>
          <div className="readout">{Math.round(effectiveZoom * 100)}%</div>
          <button className="icon-btn" onClick={() => stepZoom(1)} aria-label="Zoom in"><ZoomIn /></button>
          <button className={`icon-btn ${zoom === 'fill' ? 'on' : ''}`} onClick={() => setZoom('fill')}
            style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase' }}>Fill</button>
          <button className={`icon-btn ${zoom === 1 ? 'on' : ''}`} onClick={() => setZoom(1)}
            style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11 }}>1:1</button>
        </div>

        <div style={{ marginLeft: 'auto' }} className="label">{fitNote}</div>
      </div>

      <div className="render-box" ref={boxRef}>
        {blobUrl ? (
          <iframe
            ref={frameRef}
            src={blobUrl}
            style={frameStyle}
            title="Your site"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div style={{ padding: 20 }} className="empty">Nothing loaded yet.</div>
        )}
      </div>
    </div>
  );
}
