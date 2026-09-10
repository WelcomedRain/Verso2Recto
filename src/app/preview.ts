/**
 * The preview document and its bridge to the editor.
 *
 * The page is rendered in an iframe from the *real* bundle, with every element
 * stamped `data-recto-id`. Verified against the Claude Design runtime: unknown
 * attributes survive into the rendered DOM, which is what makes click-to-select
 * work without restructuring the site.
 *
 * The tagged document is never written to disk. Publishing serializes the clean
 * template.
 */

import { parseBundle, serializeBundle } from '../core/bundle';
import { tagForPreview, type TemplateIndex } from '../core/htmlIndex';

export interface SelectMessage {
  type: 'recto:select';
  elementId: string;
  tag: string;
  text: string;
  runOrdinal: number;
}

export type PreviewMessage = SelectMessage | { type: 'recto:ready' };

/**
 * Runs inside the iframe. Kept as a string because it must be injected into a
 * document we assemble by hand, not bundled.
 */
const BRIDGE = String.raw`
<style id="__recto_bridge_style">
  [data-recto-selected] { outline: 2px solid #ec3013 !important; outline-offset: 3px !important; }
  [data-recto-hover]:not([data-recto-selected]) { outline: 1px dashed rgba(236,48,19,0.55) !important; outline-offset: 2px !important; }
</style>
<script>
(function () {
  var selected = null, hovered = null;

  function editable(el) {
    while (el && el !== document.body) {
      if (el.nodeType === 1 && el.hasAttribute('data-recto-id')) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Which text run of this element is the one the click landed nearest.
  function runOrdinalFor(el, target) {
    var n = 0, found = 0;
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 3 && c.nodeValue.trim()) {
        if (c === target) found = n;
        n++;
      }
    }
    return found;
  }

  document.addEventListener('mouseover', function (e) {
    var el = editable(e.target);
    if (hovered === el) return;
    if (hovered) hovered.removeAttribute('data-recto-hover');
    hovered = el;
    if (hovered) hovered.setAttribute('data-recto-hover', '');
  }, true);

  document.addEventListener('click', function (e) {
    var el = editable(e.target);
    if (!el) return;
    // The page is a preview: its own links and buttons must not navigate.
    e.preventDefault();
    e.stopPropagation();
    if (selected) selected.removeAttribute('data-recto-selected');
    selected = el;
    el.setAttribute('data-recto-selected', '');
    parent.postMessage({
      type: 'recto:select',
      elementId: el.getAttribute('data-recto-id'),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 400),
      runOrdinal: e.target.nodeType === 3 ? runOrdinalFor(el, e.target) : 0
    }, '*');
  }, true);

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    if (m.type === 'recto:set-text') {
      var el = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!el) return;
      var n = 0;
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3 && c.nodeValue.trim()) {
          if (n === (m.runOrdinal || 0)) { c.nodeValue = m.value; return; }
          n++;
        }
      }
      // The run was whitespace-only when the page rendered; fall back to the
      // element's own text so typing still shows something.
      el.textContent = m.value;
    }

    if (m.type === 'recto:set-attr') {
      var t = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (t) t.setAttribute(m.attrName, m.value);
    }

    if (m.type === 'recto:set-style') {
      var se = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (se) se.style.setProperty(m.prop, m.value);
    }

    if (m.type === 'recto:set-theme') {
      // An inline custom property on <html> outranks the :root rule, so the
      // page updates without touching its stylesheet.
      document.documentElement.style.setProperty(m.prop, m.value);
    }

    // There is deliberately no handler for writing style-hover back. Measured
    // against the live bundle: the Claude Design runtime consumes that
    // attribute while rendering and wires its own handlers, so zero elements
    // carry it in the DOM (293 carry data-recto-id, which it passes through).
    // Setting it would write to nothing. recto:force-hover is the honest
    // preview: it applies the declarations inline and remembers what to
    // restore.

    if (m.type === 'recto:match-rules') {
      // Selector matching has to happen against the real DOM: the editor knows
      // the markup but not what the browser resolved it to.
      var target = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      var res = [];
      for (var mi = 0; mi < m.selectors.length; mi++) {
        var sel = m.selectors[mi];
        var applies = false, count = 0;
        try {
          applies = !!target && target.matches(sel);
          count = document.querySelectorAll(sel).length;
        } catch (err) { applies = false; count = 0; }
        if (applies) res.push({ index: mi, count: count });
      }
      parent.postMessage({ type: 'recto:rules-matched', elementId: m.elementId, matches: res, token: m.token }, '*');
    }

    if (m.type === 'recto:set-html') {
      var ht = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!ht) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = m.html;
      var repl = tmp.firstElementChild;
      if (!repl) return;
      // Re-stamp the id or the element becomes unselectable the moment it is
      // replaced. Its children are new markup and get no ids until reload,
      // which is honest: they are not the nodes the index knows about.
      repl.setAttribute('data-recto-id', m.elementId);
      ht.replaceWith(repl);
      if (selected && !selected.isConnected) selected = repl;
    }

    if (m.type === 'recto:force-hover') {
      // Release whatever was held before, restoring the exact inline values.
      if (window.__rectoHeld) {
        var prev = document.querySelector('[data-recto-id="' + window.__rectoHeld.id + '"]');
        if (prev) {
          for (var k in window.__rectoHeld.before) {
            if (window.__rectoHeld.before[k] === null) prev.style.removeProperty(k);
            else prev.style.setProperty(k, window.__rectoHeld.before[k]);
          }
        }
        window.__rectoHeld = null;
      }
      if (m.elementId && m.decls && m.decls.length) {
        var el2 = document.querySelector('[data-recto-id="' + m.elementId + '"]');
        if (el2) {
          var before = {};
          for (var di = 0; di < m.decls.length; di++) {
            var pr = m.decls[di].prop;
            before[pr] = el2.style.getPropertyValue(pr) || null;
            el2.style.setProperty(pr, m.decls[di].value, 'important');
          }
          window.__rectoHeld = { id: m.elementId, before: before };
        }
      }
    }

    if (m.type === 'recto:select-id') {
      var s = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (selected) selected.removeAttribute('data-recto-selected');
      selected = s;
      if (s) {
        s.setAttribute('data-recto-selected', '');
        s.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  parent.postMessage({ type: 'recto:ready' }, '*');
})();
</script>
`;

/**
 * Build the preview document.
 *
 * The bridge goes into the wrapper immediately before `</body>` so it runs after
 * the Claude Design runtime has rendered the template into the DOM.
 */
export function buildPreviewDoc(originalFile: string, index: TemplateIndex): string {
  const bundle = parseBundle(originalFile);
  const tagged = tagForPreview(bundle.template, index);
  const withTags = serializeBundle(bundle, { template: tagged });

  const at = withTags.lastIndexOf('</body>');
  if (at === -1) return withTags + BRIDGE;
  return withTags.slice(0, at) + BRIDGE + withTags.slice(at);
}

/** Device widths. Zoom is a separate control and must never reflow the page. */
export const DEVICE_WIDTH = { desktop: 1280, tablet: 834, phone: 390 } as const;
export type Device = keyof typeof DEVICE_WIDTH;

export const ZOOM_STEPS = [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * Fill fits WIDTH ONLY.
 *
 * Height must never influence width — letting it do so meant that shrinking the
 * window shrank the page, which was a reported defect.
 */
export function fillZoom(paneWidth: number, deviceWidth: number): number {
  if (paneWidth <= 0) return 1;
  return Math.min(1, Math.max(0.08, paneWidth / deviceWidth));
}

export interface FrameSizing {
  /** CSS width for the iframe. */
  width: number | '100%';
  height: number;
  scale: number;
}

/**
 * Work out how large to draw the page.
 *
 * Extracted and pure because the interesting rule here is easy to get wrong and
 * impossible to see when it is: letting the pane's width override the chosen
 * device silently disabled the Tablet and Phone buttons entirely, since a
 * ~460px pane is wider than a 390px phone.
 *
 * Choosing a device is a statement about how wide the page should be, so it
 * always wins. Only Desktop stretches to fill a pane wider than itself, which
 * is what stops a wide window showing a 1280px page marooned in dead space.
 */
export function frameSizing(
  device: Device,
  zoom: number | 'fill',
  paneW: number,
  paneH: number,
): FrameSizing {
  const deviceW = DEVICE_WIDTH[device];
  const scale = zoom === 'fill' ? fillZoom(paneW, deviceW) : zoom;

  if (device === 'desktop' && zoom === 'fill' && paneW >= deviceW) {
    return { width: '100%', height: Math.max(240, paneH), scale: 1 };
  }
  return {
    width: deviceW,
    // The frame fills the pane's height so the page scrolls inside it, like a
    // browser window, rather than the pane scrolling the frame.
    height: Math.max(240, paneH / (scale || 1)),
    scale,
  };
}
