/**
 * R25-U16d — the quick-fill hook: debounced /parse while typing → chips fill
 * visibly. The pure mapping lives in quick_fill.ts; this owns timing + fetch.
 *
 * Fail-open by design: a missed fetch, a 429, or a malformed body leaves the
 * chips exactly where they are — the server re-runs the same rules parser on
 * submit, so the preview can only ever be WRONGLY QUIET, never wrongly loud,
 * and never changes the drive.
 */

import { validateParsedConstraints, type LocationConstraint } from '@shared/types';
import { useEffect, useRef, useState } from 'react';

import { postParse } from './api';
import type { PlanDraft } from './plan_draft';
import { applyAutoFill, computeAutoFill, type AutoFill, type QuickFillField } from './quick_fill';
import { getApiBaseUrl } from './runtime';

export const QUICK_FILL_DEBOUNCE_MS = 600;

export interface QuickFillView {
  /** Fields currently auto-filled from the text (render the marker). */
  fromText: readonly QuickFillField[];
  /** Honest snap note (e.g. a typed time that fits no chip). */
  note: string | null;
  /** Place mentions the parse found — the visible pins ("via Forks of the
   *  Credit"). Display-only: the text is their source of truth, so removing
   *  one means editing the text (they're sent via the brief, not overrides). */
  pins: readonly LocationConstraint[];
}

const IDLE: QuickFillView = { fromText: [], note: null, pins: [] };

export function useQuickFill(args: {
  brief: string;
  draft: PlanDraft;
  setDraft: (update: Partial<PlanDraft>) => void;
  touched: ReadonlySet<QuickFillField>;
  /** Test seam; defaults to POST /parse against the runtime base URL. */
  parseFn?: (brief: string, signal: AbortSignal) => Promise<unknown>;
  debounceMs?: number;
}): QuickFillView {
  const [view, setView] = useState<QuickFillView>(IDLE);
  // refs so the debounce effect keys on the BRIEF only — applying fill
  // updates must not re-trigger the fetch (no feedback loop)
  const draftRef = useRef(args.draft);
  draftRef.current = args.draft;
  const touchedRef = useRef(args.touched);
  touchedRef.current = args.touched;
  const setDraftRef = useRef(args.setDraft);
  setDraftRef.current = args.setDraft;
  const parseRef = useRef(args.parseFn);
  parseRef.current = args.parseFn;

  useEffect(() => {
    const brief = args.brief.trim();
    if (brief.length === 0) {
      setView(IDLE);
      return undefined; // nothing to parse; touched fields stay, untouched stay
    }
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      const call =
        parseRef.current ??
        ((b: string, signal: AbortSignal) =>
          postParse({ baseUrl: getApiBaseUrl() }, { brief: b }, signal));
      call(brief, aborter.signal)
        .then((raw) => {
          if (aborter.signal.aborted) return;
          const body = raw as { constraints?: unknown };
          let auto: AutoFill;
          let pins: readonly LocationConstraint[];
          try {
            const constraints = validateParsedConstraints(body.constraints);
            auto = computeAutoFill(constraints);
            pins = constraints.location_constraints;
          } catch {
            return; // malformed → chips stay put (fail-open)
          }
          const updates = applyAutoFill(draftRef.current, auto, touchedRef.current);
          if (Object.keys(updates).length > 0) setDraftRef.current(updates);
          setView({
            fromText: auto.fromText.filter((f) => !touchedRef.current.has(f)),
            note: auto.note,
            pins,
          });
        })
        .catch(() => {
          /* network/429 → fail-open, keep the last view */
        });
    }, args.debounceMs ?? QUICK_FILL_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      aborter.abort();
    };
  }, [args.brief, args.debounceMs]);

  return view;
}
