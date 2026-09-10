import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Tablet, Smartphone, ZoomIn, ZoomOut } from './icons';
import {
  buildPreviewDoc, DEVICE_WIDTH, ZOOM_STEPS, frameSizing,
  type Device, type PreviewMessage,
} from './preview';
import type { TemplateIndex } from '../core/htmlIndex';
import type { TargetKind } from '../core/targets';
import type { FitMeasurement, SweepPoint } from '../core/fit';

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
  /** Image element to measure in its frame, if one is selected. */
  measureFitFor: string | null;
  /** Set to an element id to measure its frame across a range of widths. */
  sweepFor: string | null;
  onSwept: (points: SweepPoint[]) => void;
  /** elementId -> the asset id its markup references, for re-resolution. */
  assetRefs: Record<string, string>;
  /** The unedited markup for an element, to put back when an edit is undone. */
  originalHtmlFor: (elementId: string) => string | null;
  /** The unedited style attribute, for the same reason. */
  originalStyleFor: (elementId: string) => string;
  onFitMeasured: (m: FitMeasurement) => void;
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
  matchSelectors, onRulesMatched, measureFitFor, onFitMeasured, assetRefs,
  sweepFor, onSwept, originalHtmlFor, originalStyleFor,
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
      if ((m as { type: string }).type === 'recto:fit-measured') {
        onFitMeasured(m as unknown as FitMeasurement);
      }
      if ((m as { type: string }).type === 'recto:rules-matched') {
        const r = m as unknown as { elementId: string; matches: { index: number; count: number }[] };
        onRulesMatched(r.elementId, r.matches);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelectElement, onRulesMatched, onFitMeasured]);

  useEffect(() => {
    if (!ready || !measureFitFor) return;
    // Deferred: a change to the fit arrives as a markup replacement in the same
    // tick, and measuring immediately reads the node that is about to be
    // replaced — so the panel would keep describing the previous state.
    const t = setTimeout(() => {
      frameRef.current?.contentWindow?.postMessage(
        { type: 'recto:measure-fit', elementId: measureFitFor }, '*',
      );
    }, 120);
    return () => clearTimeout(t);
  }, [ready, measureFitFor, liveEdits]);

  // Ask the page which rules govern the selected element. Only the browser can
  // answer that; the editor knows the markup, not the resolved cascade.
  useEffect(() => {
    if (!ready || !selectedElementId || !matchSelectors.length) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'recto:match-rules', elementId: selectedElementId, selectors: matchSelectors }, '*',
    );
  }, [ready, selectedElementId, matchSelectors]);

  /**
   * Elements whose markup we have replaced in the preview.
   *
   * Needed because undoing a code edit sends nothing: the bridge only ever
   * hears about changes that exist. Without this the page keeps showing markup
   * the working copy no longer contains.
   */
  const replaced = useRef<Set<string>>(new Set());
  const restyled = useRef<Set<string>>(new Set());

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
        case 'style-attr':
          restyled.current.add(e.elementId);
          w.postMessage({ type: 'recto:set-style-attr', elementId: e.elementId, value: e.value }, '*');
          break;
        case 'html':
          replaced.current.add(e.elementId);
          w.postMessage({ type: 'recto:set-html', elementId: e.elementId, html: e.value, assetRefs }, '*');
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
    // Same for a scoped override: removing one sends nothing on its own.
    const styled = new Set(
      liveEdits.filter((e) => e.kind === 'style-attr').map((e) => e.elementId),
    );
    for (const id of [...restyled.current]) {
      if (styled.has(id)) continue;
      restyled.current.delete(id);
      w.postMessage({ type: 'recto:set-style-attr', elementId: id, value: originalStyleFor(id) }, '*');
    }

    // Anything we replaced that is no longer edited goes back to its source.
    const live = new Set(liveEdits.filter((e) => e.kind === 'html').map((e) => e.elementId));
    for (const id of [...replaced.current]) {
      if (live.has(id)) continue;
      const original = originalHtmlFor(id);
      replaced.current.delete(id);
      if (original) {
        w.postMessage({ type: 'recto:set-html', elementId: id, html: original, assetRefs }, '*');
      }
    }
  }, [liveEdits, ready, assetRefs, originalHtmlFor, originalStyleFor]);

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

  /**
   * Measure the frame at a range of window widths.
   *
   * Advice about proportion is only true at the width it was measured at, and
   * this frame's shape swings from 1.58:1 to 2.83:1 as the window moves. The
   * only way to know that is to lay the page out at each width and look.
   *
   * Timers rather than requestAnimationFrame: a hidden or backgrounded pane
   * throttles rAF to nothing and the sweep would hang forever.
   */
  useEffect(() => {
    if (!ready || !sweepFor) return;
    let cancelled = false;
    const el = frameRef.current;
    if (!el) return;
    const previous = el.style.width;

    (async () => {
      const points: SweepPoint[] = [];
      for (const viewport of [390, 500, 600, 700, 834, 1000, 1280, 1440]) {
        if (cancelled) break;
        el.style.width = `${viewport}px`;
        await new Promise((r) => setTimeout(r, 90));
        const doc = el.contentDocument;
        const node = doc?.querySelector(`[data-recto-id="${sweepFor}"]`);
        const box = node?.parentElement?.getBoundingClientRect();
        if (box && box.width) {
          points.push({ viewport, frameW: Math.round(box.width), frameH: Math.round(box.height) });
        }
      }
      el.style.width = previous;
      if (!cancelled) onSwept(points);
    })();

    return () => { cancelled = true; el.style.width = previous; };
  }, [ready, sweepFor, onSwept]);

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
