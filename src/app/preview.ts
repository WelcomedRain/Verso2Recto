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
import type { TargetKind } from '../core/targets';

export interface SelectMessage {
  type: 'recto:select';
  elementId: string;
  tag: string;
  text: string;
  runOrdinal: number;
}

/**
 * What the page says after being asked to apply a change.
 *
 * The editor cannot work this out for itself — whether an element is drawn at
 * the current width, whether a selector matches anything, whether a media
 * condition holds — so the page reports rather than the editor guessing.
 */
export interface AppliedMessage {
  type: 'recto:applied';
  id: string;
  result: 'shown' | 'hidden' | 'missing' | 'state';
  why: string;
}

export type PreviewMessage = SelectMessage | AppliedMessage | { type: 'recto:ready' };

/**
 * One queued change, in the shape the bridge wants.
 *
 * `id` is the change's own id and comes back on the acknowledgement, which is
 * what lets the editor say which change is not being shown rather than just
 * that one is not.
 */
export interface LiveEdit {
  id: string;
  kind: TargetKind;
  elementId: string;
  runOrdinal: number;
  attrName?: string;
  prop?: string;
  value: string;
  /** For a stylesheet rule: how to write it into the override sheet. */
  selector?: string;
  matchSelector?: string;
  conditions?: string[];
  /** `hover`, `focus-visible` — the state the rule describes, if any. */
  ruleState?: string | null;
}

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

  /**
   * Is this node actually drawn right now?
   *
   * The distinction the editor cannot make on its own. An element inside a
   * menu that is display:none at this width, or a tag in <head>, takes the
   * change perfectly well and shows nothing for it.
   */
  function renders(el) {
    if (!el || !document.body.contains(el)) return false;
    return el.getClientRects().length > 0;
  }

  /**
   * The override sheet used to preview stylesheet-rule edits.
   *
   * Kept as text keyed by change id and rewritten whole. Editing a live
   * CSSOM rule in place would be less code and would strand a removed edit —
   * undoing a change sends nothing on its own, and the page would keep showing
   * a rule the working copy no longer contains.
   */
  var rules = {};
  function writeRule(id, text) {
    if (text === null) delete rules[id];
    else rules[id] = text;
    var sheet = document.getElementById('__recto_rules');
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = '__recto_rules';
      // Last in the document, so it wins a tie on specificity exactly as the
      // published page would.
      document.body.appendChild(sheet);
    }
    var texts = [];
    for (var k in rules) texts.push(rules[k]);
    sheet.textContent = texts.join('\n');
  }

  function ack(m, result, why) {
    if (!m || !m.id) return;
    parent.postMessage({ type: 'recto:applied', id: m.id, result: result, why: why || '' }, '*');
  }

  var INFO_TAGS = { META: 1, TITLE: 1, LINK: 1, SCRIPT: 1, STYLE: 1, BASE: 1 };

  /**
   * Report on a node we just changed, in the page's own terms.
   *
   * Decided by tag name before position, because position is not stable: this
   * export keeps its share tags in a <helmet> element in the body and the
   * runtime hoists them into <head> a moment after first render. Asking where
   * the node sits gave the right answer only if you asked late enough.
   *
   * The settle retry is that same race, generally. An element can be invisible
   * simply because the runtime has not finished with the page, so a verdict of
   * "cannot be seen" is checked once more before it is left standing.
   */
  function ackNode(m, el, settle) {
    if (INFO_TAGS[el.tagName]) {
      return ack(m, 'hidden',
        'This is a page-information tag. It changes link previews and search results, '
        + 'not anything you can see on the page.');
    }
    if (!renders(el)) {
      ack(m, 'hidden',
        'The element it belongs to is not drawn at this width — it may only appear on '
        + 'another device size, or be hidden until something opens it.');
      if (settle !== false) setTimeout(function () { ackNode(m, el, false); }, 400);
      return;
    }
    return ack(m, 'shown', '');
  }

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
      if (!el) {
        return ack(m, 'missing',
          'Nothing in the rendered page carries this text. It may be built by the page '
          + 'as it loads rather than written in the markup.');
      }
      var n = 0, done = false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3 && c.nodeValue.trim()) {
          if (n === (m.runOrdinal || 0)) { c.nodeValue = m.value; done = true; break; }
          n++;
        }
      }
      // The run was whitespace-only when the page rendered; fall back to the
      // element's own text so typing still shows something.
      if (!done) el.textContent = m.value;
      return ackNode(m, el);
    }

    if (m.type === 'recto:set-attr') {
      var t = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!t) return ack(m, 'missing', 'That element is not in the rendered page.');
      t.setAttribute(m.attrName, m.value);
      return ackNode(m, t);
    }

    if (m.type === 'recto:set-style') {
      var se = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!se) return ack(m, 'missing', 'That element is not in the rendered page.');
      se.style.setProperty(m.prop, m.value);
      return ackNode(m, se);
    }

    if (m.type === 'recto:set-theme') {
      // An inline custom property on <html> outranks the :root rule, so the
      // page updates without touching its stylesheet.
      document.documentElement.style.setProperty(m.prop, m.value);
      // Whether anything reads it is the useful question, and only the page can
      // answer it: a token can be declared and never referenced.
      var used = false;
      try {
        var all = document.body.querySelectorAll('*');
        for (var ui = 0; ui < all.length && !used; ui++) {
          if (getComputedStyle(all[ui]).getPropertyValue(m.prop).trim()) used = true;
        }
      } catch (err) { used = true; }
      return ack(m, used ? 'shown' : 'hidden',
        used ? '' : 'Nothing drawn on the page reads ' + m.prop + ' at this width.');
    }

    if (m.type === 'recto:drop-rule') {
      writeRule(m.id, null);
      return;
    }

    if (m.type === 'recto:set-rule') {
      // A stylesheet rule cannot be written through an element, so it is
      // previewed by an override sheet appended last in the document: at equal
      // specificity the later rule wins, which is the same answer the published
      // page gives. No !important — an inline style outranks a rule there too,
      // and the preview should not pretend otherwise.
      var conds = m.conditions || [];
      var matchSel = m.matchSelector || m.selector;

      // What the matching elements look like BEFORE the rule is written, so
      // the answer can be "and it changed nothing" rather than a guess.
      var targets = [];
      try { targets = [].slice.call(document.querySelectorAll(matchSel), 0, 50); }
      catch (err3) { targets = null; }
      var was = [];
      if (targets) {
        for (var bi = 0; bi < targets.length; bi++) {
          was.push(getComputedStyle(targets[bi]).getPropertyValue(m.prop));
        }
      }

      var body = m.selector + '{' + m.prop + ':' + m.value + '}';
      for (var qi = conds.length - 1; qi >= 0; qi--) body = conds[qi] + '{' + body + '}';
      writeRule(m.id, body);

      // Now say honestly whether it can be seen. Four separate reasons it might
      // not be, and each calls for something different.
      for (var ci = 0; ci < conds.length; ci++) {
        if (String(conds[ci]).indexOf('@media') !== 0) continue;
        var q = String(conds[ci]).replace(/^@media\s*/i, '');
        var holds = true;
        try { holds = window.matchMedia(q).matches; } catch (err2) { holds = true; }
        if (!holds) {
          return ack(m, 'hidden',
            'This rule only applies at ' + q + ', and the preview is not at that size. '
            + 'Switch the device or zoom the preview to that width to see it.');
        }
      }

      if (targets && targets.length === 0) {
        return ack(m, 'hidden',
          'Nothing on the page matches ' + m.selector + ' at this width, so the rule '
          + 'changes nothing you can see here.');
      }
      if (m.state) {
        return ack(m, 'state',
          'This rule only applies while the element is :' + m.state + '.');
      }

      // Matching an element is not the same as changing it. This page sets most
      // of its styling directly on the elements, and an element's own style
      // attribute outranks any stylesheet rule — so a rule edit can be correct,
      // publishable, and completely invisible. Measured rather than reasoned
      // about: the browser resolves the cascade, we only read the result.
      if (targets) {
        var moved = false;
        for (var ai = 0; ai < targets.length && !moved; ai++) {
          if (getComputedStyle(targets[ai]).getPropertyValue(m.prop) !== was[ai]) moved = true;
        }
        if (!moved) {
          // Say WHY only when there is evidence for it. An element declaring
          // the property itself is that evidence; without it the honest answer
          // is that nothing moved, not a guess at the cause.
          var overridden = false;
          for (var oi = 0; oi < targets.length && !overridden; oi++) {
            if (targets[oi].style.getPropertyValue(m.prop)) overridden = true;
          }
          return ack(m, 'hidden', overridden
            ? 'The rule changed, but nothing on the page moved: the elements matching '
              + m.selector + ' set ' + m.prop + ' on themselves, and the style on an element '
              + 'outranks a stylesheet rule. To change how this looks, set '
              + m.prop + ' on the element instead.'
            : 'The rule changed, but nothing on the page looks different — the new value '
              + 'resolves to what was already being drawn.');
        }
      }
      return ack(m, 'shown', '');
    }

    // There is deliberately no handler for writing style-hover back. Measured
    // against the live bundle: the Claude Design runtime consumes that
    // attribute while rendering and wires its own handlers, so zero elements
    // carry it in the DOM (293 carry data-recto-id, which it passes through).
    // Setting it would write to nothing. recto:force-hover is the honest
    // preview: it applies the declarations inline and remembers what to
    // restore.

    if (m.type === 'recto:set-style-attr') {
      var sa = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!sa) return ack(m, 'missing', 'That element is not in the rendered page.');
      sa.setAttribute('style', m.value || '');
      return ackNode(m, sa);
    }

    if (m.type === 'recto:measure-fit') {
      // How an image actually sits in its frame can only be measured, not
      // inferred: the frame is laid out by the cascade, and its width here is
      // fluid.
      var fi = document.querySelector('[data-recto-id="' + m.elementId + '"]');
      if (!fi || fi.tagName !== 'IMG') return;
      var box = fi.parentElement;
      var ir = fi.getBoundingClientRect();
      var br = box ? box.getBoundingClientRect() : ir;
      var cs = getComputedStyle(fi);
      parent.postMessage({
        type: 'recto:fit-measured',
        elementId: m.elementId,
        intrinsic: [fi.naturalWidth, fi.naturalHeight],
        rendered: [Math.round(ir.width), Math.round(ir.height)],
        frame: [Math.round(br.width), Math.round(br.height)],
        objectFit: cs.objectFit,
        // The *specified* sizing, not the used pixels. When an image happens to
        // fill its frame exactly, the geometry cannot say whether it is
        // anchored by height, by width, or stretched — but the declaration can.
        inlineWidth: fi.style.width || '',
        inlineHeight: fi.style.height || '',
        frameOverflow: box ? getComputedStyle(box).overflow : 'visible'
      }, '*');
    }

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
      if (!ht) return ack(m, 'missing', 'That element is not in the rendered page.');
      var tmp = document.createElement('div');
      tmp.innerHTML = m.html;
      var repl = tmp.firstElementChild;
      if (!repl) {
        return ack(m, 'missing',
          'The browser could not build an element out of that code, so the page is '
          + 'still showing the original.');
      }
      // Re-stamp the id or the element becomes unselectable the moment it is
      // replaced. Its children are new markup and get no ids until reload,
      // which is honest: they are not the nodes the index knows about.
      repl.setAttribute('data-recto-id', m.elementId);

      // Fresh markup carries the source's bare asset ids, which the browser
      // cannot load — the runtime swapped them for blob URLs when it rendered,
      // and it does that in any attribute, so the id cannot be stashed in the
      // markup either. The editor sends elementId -> assetId; pairing that with
      // what each element currently shows gives assetId -> blob URL.
      var resolved = {};
      var refs = m.assetRefs || {};
      for (var key in refs) {
        var holder = document.querySelector('[data-recto-id="' + key + '"]');
        var live = holder && holder.getAttribute('src');
        if (live && live.indexOf(':') !== -1) resolved[refs[key]] = live;
      }
      var candidates = repl.tagName === 'IMG' ? [repl] : [];
      var inner = repl.querySelectorAll ? repl.querySelectorAll('img') : [];
      for (var ii = 0; ii < inner.length; ii++) candidates.push(inner[ii]);
      for (var ci = 0; ci < candidates.length; ci++) {
        var cur = candidates[ci].getAttribute('src');
        if (cur && resolved[cur]) candidates[ci].setAttribute('src', resolved[cur]);
      }

      ht.replaceWith(repl);
      if (selected && !selected.isConnected) selected = repl;
      return ackNode(m, repl);
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
