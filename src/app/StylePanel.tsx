/**
 * Style and Theme.
 *
 * The user's stated ranking was: theme values AND per-element override first,
 * theme-only second, per-element only third. Both halves are here.
 *
 * Theme edits change one value that many elements reference. Per-element edits
 * change one declaration in one `style` attribute. Neither needs any change to
 * the site's structure — the export already carries `:root` blocks and the
 * markup already references them.
 */

import { useMemo, useState } from 'react';
import type { StyleDecl, ThemeToken } from '../core/css';
import { FEATURED_PROPS, isColorValue, resolveVar } from '../core/css';
import type { EditTarget } from '../core/targets';
import type { PendingChange } from '../core/publish';
import type { ElementNode } from '../core/htmlIndex';

interface Common {
  valueOf: (t: EditTarget) => string;
  onEdit: (id: string, v: string) => void;
  changes: Map<string, PendingChange>;
  targetsById: Map<string, EditTarget>;
  tokens: ThemeToken[];
}

/** A colour swatch that opens the native picker, beside a free-text field. */
function ValueField({
  target, value, edited, tokens, onEdit,
}: {
  target: EditTarget;
  value: string;
  edited: boolean;
  tokens: ThemeToken[];
  onEdit: (v: string) => void;
}) {
  const swatch = resolveVar(value, tokens);
  const canPick = swatch != null && /^#[0-9a-f]{6}$/i.test(swatch);

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {swatch && (
        <label
          className="swatch"
          style={{ background: swatch }}
          title={canPick ? 'Pick a colour' : swatch}
        >
          {canPick && (
            <input
              type="color"
              value={swatch}
              onChange={(e) => onEdit(e.target.value)}
              aria-label={`Colour for ${target.tag}`}
            />
          )}
        </label>
      )}
      <input
        className={`input mono ${edited ? 'edited' : ''}`}
        style={{ fontSize: 12 }}
        value={value}
        spellCheck={false}
        onChange={(e) => onEdit(e.target.value)}
      />
    </div>
  );
}

/* -------------------------------- Style ------------------------------- */

export function StylePanel({
  element, decls, hoverDecls, valueOf, onEdit, changes, targetsById, tokens,
  hoverHeld, onHoldHover,
}: Common & {
  element: ElementNode | null;
  decls: StyleDecl[];
  hoverDecls: StyleDecl[];
  hoverHeld: boolean;
  onHoldHover: (hold: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const { featured, rest } = useMemo(() => {
    const f: StyleDecl[] = [];
    const r: StyleDecl[] = [];
    for (const d of decls) {
      (FEATURED_PROPS.includes(d.prop as never) ? f : r).push(d);
    }
    f.sort((a, b) => FEATURED_PROPS.indexOf(a.prop as never) - FEATURED_PROPS.indexOf(b.prop as never));
    return { featured: f, rest: r };
  }, [decls]);

  if (!element) {
    return (
      <div className="panel">
        <div className="empty">Click something in the page to change how it looks.</div>
      </div>
    );
  }

  if (!decls.length && !hoverDecls.length) {
    return (
      <div className="panel">
        <div className="label">{element.tag}</div>
        <div className="empty">
          This element has no styling of its own — it inherits from the page, or from the
          theme. Change the matching value in the Theme tab to affect it.
        </div>
      </div>
    );
  }

  const row = (d: StyleDecl) => {
    const target = targetsById.get(d.id);
    if (!target) return null;
    return (
      <div className="field" key={d.id}>
        <div className="field-head">
          <span className="label">{d.prop}</span>
          {changes.has(d.id) && <span className="tag" style={{ color: 'var(--color-accent-700)' }}>edited</span>}
        </div>
        <ValueField
          target={target}
          value={valueOf(target)}
          edited={changes.has(d.id)}
          tokens={tokens}
          onEdit={(v) => onEdit(d.id, v)}
        />
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="label">
        {element.tag} · {decls.length} propert{decls.length === 1 ? 'y' : 'ies'}
      </div>

      {featured.map(row)}

      {hoverDecls.length > 0 && (
        <div className="stack" style={{ gap: 8, borderTop: '2px solid var(--color-divider)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label">On hover</span>
            <button
              className={`btn ${hoverHeld ? 'btn-primary' : ''}`}
              style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 8px' }}
              onClick={() => onHoldHover(!hoverHeld)}
            >
              {hoverHeld ? 'Release' : 'Show it'}
            </button>
          </div>
          <div className="empty" style={{ marginTop: -2 }}>
            {hoverHeld
              ? 'Held in its hover appearance so you can see what you are changing.'
              : 'What this element looks like when the pointer is over it.'}
          </div>
          {hoverDecls.map(row)}
        </div>
      )}

      {rest.length > 0 && (
        <>
          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide' : `Show ${rest.length} more`}
          </button>
          {showAll && rest.map(row)}
        </>
      )}

      <div className="empty">
        A value like <span className="mono">var(--gold)</span> comes from the theme. Change it
        here and only this element moves; change it in Theme and everything using it moves.
      </div>
    </div>
  );
}

/* -------------------------------- Theme ------------------------------- */

export function ThemePanel({
  valueOf, onEdit, changes, targetsById, tokens,
}: Common) {
  const [showSystem, setShowSystem] = useState(false);

  const primary = tokens.filter((t) => t.primary);
  const system = tokens.filter((t) => !t.primary);

  const row = (t: ThemeToken) => {
    const target = targetsById.get(t.id);
    if (!target) return null;
    return (
      <div className="field" key={t.id}>
        <div className="field-head">
          <span className="label mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{t.prop}</span>
          {changes.has(t.id) && <span className="tag" style={{ color: 'var(--color-accent-700)' }}>edited</span>}
        </div>
        <ValueField
          target={target}
          value={valueOf(target)}
          edited={changes.has(t.id)}
          tokens={tokens}
          onEdit={(v) => onEdit(t.id, v)}
        />
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="label">Your site's colours — one change moves everything using it</div>
      {primary.map(row)}

      <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12 }}>
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowSystem((v) => !v)}>
          {showSystem ? 'Hide' : `Design system values (${system.length})`}
        </button>
      </div>

      {showSystem && (
        <>
          <div className="empty">
            These come from the design system the site was built with. Changing them affects
            anything that uses them, which may be more than you expect.
          </div>
          {system.map(row)}
        </>
      )}
    </div>
  );
}

export { isColorValue };
