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
import type { CssRule, StyleDecl, ThemeToken } from '../core/css';
import { FEATURED_PROPS, isColorValue, resolveVar } from '../core/css';
import type { EditTarget } from '../core/targets';
import type { PendingChange } from '../core/publish';
import type { ElementNode } from '../core/htmlIndex';

export interface MatchedRule { rule: CssRule; count: number }

interface Common {
  valueOf: (t: EditTarget) => string;
  onEdit: (id: string, v: string) => void;
  /** Set a property on one element only, leaving the shared value alone. */
  onScopeToElement: (elementId: string, prop: string, value: string) => void;
  changes: Map<string, PendingChange>;
  targetsById: Map<string, EditTarget>;
  tokens: ThemeToken[];
}

/** A colour swatch that opens the native picker, beside a free-text field. */
export function ValueField({
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

/**
 * A value that more than one element depends on.
 *
 * Typing is a draft here rather than an edit. A shared value cannot be changed
 * on the way past — the count is the whole point, and asking once the intent is
 * formed is better than asking on every keystroke. Nothing is queued until one
 * of the two answers is chosen, so neither outcome can happen by accident:
 * moving something shared without meaning to, or scattering one-off overrides
 * that make the page inconsistent.
 */
export function SharedValueField({
  target, value, edited, tokens, count, canScope, onChangeAll, onScope,
}: {
  target: EditTarget;
  value: string;
  edited: boolean;
  tokens: ThemeToken[];
  count: number;
  /** False when nothing is selected to attach an override to. */
  canScope: boolean;
  onChangeAll: (v: string) => void;
  onScope: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = draft !== null && draft !== value;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <ValueField
        target={target}
        value={draft ?? value}
        edited={edited}
        tokens={tokens}
        onEdit={setDraft}
      />
      {pending && (
        <div className="card">
          <div className="card-body">
            <b>{count} places use this.</b>{' '}
            {canScope
              ? 'Change it everywhere, or set it on this element only?'
              : 'Nothing is selected to set it on, so this changes everywhere it is used.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '5px 9px' }}
              onClick={() => { onChangeAll(draft!); setDraft(null); }}
            >
              Change all {count}
            </button>
            {canScope && (
              <button
                className="btn"
                style={{ fontSize: 11, padding: '5px 9px' }}
                onClick={() => { onScope(draft!); setDraft(null); }}
              >
                Just this one
              </button>
            )}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '5px 9px' }}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------- Shared: the style sections --------------------- */

/**
 * The declarations for one element, base and hover.
 *
 * Lives here but is rendered by the Selection panel as well. Clicking something
 * in the page has to answer "what can I change about this?" in one place —
 * sending you to a different tab to find out is the tool declining to help.
 */
export function StyleSections({
  element, decls, hoverDecls, rules, valueOf, onEdit, onScopeToElement, changes,
  targetsById, tokens, hoverHeld, onHoldHover, compact,
}: Common & {
  element: ElementNode | null;
  decls: StyleDecl[];
  hoverDecls: StyleDecl[];
  rules: MatchedRule[];
  hoverHeld: boolean;
  onHoldHover: (hold: boolean) => void;
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  const { featured, rest } = useMemo(() => {
    const f: StyleDecl[] = [];
    const r: StyleDecl[] = [];
    for (const d of decls) (FEATURED_PROPS.includes(d.prop as never) ? f : r).push(d);
    f.sort((a, b) => FEATURED_PROPS.indexOf(a.prop as never) - FEATURED_PROPS.indexOf(b.prop as never));
    return { featured: f, rest: r };
  }, [decls]);

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

  if (!element) return null;

  const sheet = rules.length > 0 && (
    <div className="stack" style={{ gap: 10, borderTop: '2px solid var(--color-divider)', paddingTop: 12 }}>
      <div className="label">From the stylesheet</div>
      <div className="empty" style={{ marginTop: -4 }}>
        These rules style this element from the page's stylesheet rather than from the
        element itself, so changing one moves everything it matches.
      </div>
      {rules.map(({ rule, count }) => (
        <div className="stack" key={rule.id} style={{ gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-accent-700)', wordBreak: 'break-all' }}>
              {rule.selector}
            </span>
            <span className="label" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {count === 1 ? 'this one only' : `${count} elements`}
            </span>
          </div>
          {rule.conditions.length > 0 && (
            <div className="label mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
              only {rule.conditions.join(' · ')}
            </div>
          )}
          {rule.decls.map((d) => {
            const id = `${rule.id}:${d.prop}`;
            const target = targetsById.get(id);
            if (!target) return null;
            return (
              <div className="field" key={id}>
                <div className="field-head">
                  <span className="label">{d.prop}</span>
                  {changes.has(id) && <span className="tag" style={{ color: 'var(--color-accent-700)' }}>edited</span>}
                </div>
                {count > 1 ? (
                  <SharedValueField
                    target={target}
                    value={valueOf(target)}
                    edited={changes.has(id)}
                    tokens={tokens}
                    count={count}
                    canScope={!!element}
                    onChangeAll={(v) => onEdit(id, v)}
                    onScope={(v) => element && onScopeToElement(element.id, d.prop, v)}
                  />
                ) : (
                  <ValueField
                    target={target}
                    value={valueOf(target)}
                    edited={changes.has(id)}
                    tokens={tokens}
                    onEdit={(v) => onEdit(id, v)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  if (!decls.length && !hoverDecls.length) {
    return (
      <>
        {rules.length === 0 && (
          <div className="empty">
            This element has no styling of its own and no stylesheet rule matches it — it
            inherits from the page, or from the theme.
          </div>
        )}
        {sheet}
      </>
    );
  }

  return (
    <>
      {!compact && (
        <div className="label">
          {element.tag} · {decls.length} propert{decls.length === 1 ? 'y' : 'ies'}
        </div>
      )}
      {compact && <div className="label">How it looks</div>}

      {featured.map(row)}

      {rest.length > 0 && (
        <>
          <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide' : `Show ${rest.length} more`}
          </button>
          {showAll && rest.map(row)}
        </>
      )}

      {sheet}

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
    </>
  );
}

/* -------------------------------- Style ------------------------------- */

export function StylePanel(props: Common & {
  element: ElementNode | null;
  decls: StyleDecl[];
  hoverDecls: StyleDecl[];
  rules: MatchedRule[];
  hoverHeld: boolean;
  onHoldHover: (hold: boolean) => void;
}) {
  if (!props.element) {
    return (
      <div className="panel">
        <div className="empty">Click something in the page to change how it looks.</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <StyleSections {...props} />
      <div className="empty">
        A value like <span className="mono">var(--gold)</span> comes from the theme. Change it
        here and only this element moves; change it in Theme and everything using it moves.
      </div>
    </div>
  );
}

/**
 * Which CSS property a token most likely stands for.
 *
 * Only used for the "just this one" path, where a token has to become a real
 * declaration on an element. A token name is a convention, not a contract, so
 * this guesses and the user can correct it in the Style section afterwards.
 */
function guessProp(tokenName: string): string {
  const n = tokenName.replace(/^--/, '').toLowerCase();
  if (/(^|-)(bg|background|ground|surface)/.test(n)) return 'background';
  if (/(^|-)(font|family|wordmark)/.test(n)) return 'font-family';
  if (/(^|-)(size|space|radius|gap)/.test(n)) return 'padding';
  return 'color';
}

/* -------------------------------- Theme ------------------------------- */

export function ThemePanel({
  valueOf, onEdit, onScopeToElement, changes, targetsById, tokens, selectedElementId,
}: Common & { selectedElementId: string | null }) {
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
        {(target.usageCount ?? 0) > 1 ? (
          <SharedValueField
            target={target}
            value={valueOf(target)}
            edited={changes.has(t.id)}
            tokens={tokens}
            count={target.usageCount!}
            canScope={!!selectedElementId}
            onChangeAll={(v) => onEdit(t.id, v)}
            onScope={(v) => selectedElementId && onScopeToElement(selectedElementId, guessProp(t.prop), v)}
          />
        ) : (
          <ValueField
            target={target}
            value={valueOf(target)}
            edited={changes.has(t.id)}
            tokens={tokens}
            onEdit={(v) => onEdit(t.id, v)}
          />
        )}
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
