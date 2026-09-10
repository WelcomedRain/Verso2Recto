import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Tablet, Smartphone, ZoomIn, ZoomOut } from './icons';
import {
  buildPreviewDoc, DEVICE_WIDTH, ZOOM_STEPS, frameSizing,
  type Device, type PreviewMessage,
} from './preview';
import type { TemplateIndex } from '../core/htmlIndex';
import type { TargetKind } from '../core/targets';

interface Props {
  file: string;
  /** The unmodified page file. The preview is assembled from it each time. */
  fileText: string;
  index: TemplateIndex;
  onSelectElement: (elementId: string, runOrdinal: number) => void;
  /** Element to highlight when selection comes from the panel, not a click. */
  selectedElementId: string | null;
  /**
   * Hold an element in its hover appearance.
   *
   * A hover style is invisible while you are editing it — the pointer is over
   * the panel, not the page — so without this the one thing you are changing is
   * the one thing you cannot see.
   */
  forceHover: { elementId: string; decls: { prop: string; value: string }[] } | null;
  /** Selectors to test against the selected element, in rule order. */
  matchSelectors: string[];
  onRulesMatched: (elementId: string, matches: { index: number; count: number }[]) => void;
  /** Edits pushed into the rendered page as the user types. */
  liveEdits: {
    kind: TargetKind;
    elementId: string;
    runOrdinal: number;
    attrName?: string;
    prop?: string;
    value: string;
  }[];
}

export function PageView({
  fileText, index, onSelectElement, selectedElementId, liveEdits, forceHover,
  matchSelectors, onRulesMatched,
}: Props) {
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

  const sizing = frameSizing(device, zoom, pane.w, pane.h);
  const effectiveZoom = sizing.scale;

  const frameStyle: React.CSSProperties = {
    width: sizing.width,
    height: sizing.height,
    ...(sizing.width === '100%'
      ? {}
      : { transform: `scale(${sizing.scale})`, transformOrigin: 'top left' }),
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
      if ((m as { type: string }).type === 'recto:rules-matched') {
        const r = m as unknown as { elementId: string; matches: { index: number; count: number }[] };
        onRulesMatched(r.elementId, r.matches);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelectElement, onRulesMatched]);

  // Ask the page which rules govern the selected element. Only the browser can
  // answer that; the editor knows the markup, not the resolved cascade.
  useEffect(() => {
    if (!ready || !selectedElementId || !matchSelectors.length) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'recto:match-rules', elementId: selectedElementId, selectors: matchSelectors }, '*',
    );
  }, [ready, selectedElementId, matchSelectors]);

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
        case 'html':
          w.postMessage({ type: 'recto:set-html', elementId: e.elementId, html: e.value }, '*');
          break;
        case 'css-hover':
          // Nothing to push: the runtime already consumed style-hover, so the
          // page cannot be told about a change to it. The forceHover hold
          // renders the edited value instead.
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
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'recto:force-hover', ...(forceHover ?? { elementId: null, decls: [] }) }, '*',
    );
  }, [forceHover, ready]);

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
