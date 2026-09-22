/**
 * The sign-in sheet as a ROUTE (redesign — SPEC "SignInSheet"; "RootStack").
 *
 * This screen is the `SignIn` form sheet of the root stack. It draws nothing
 * of its own: the body is `SignInBody` (`components/SignInSheet`), the sheet
 * chrome is the platform's, and the header is none. Its one job is the
 * handshake between the platform's dismissal and the auth engine's state:
 *
 *   - The engine's `sheetOpen` OPENS this route (App.tsx navigates when it
 *     turns true) and POPS it (App.tsx goes back when it turns false — after
 *     "Not now", and after a successful verify).
 *   - The platform can also dismiss it without asking the engine: a swipe
 *     down. Then this route unmounts while the engine still thinks the sheet
 *     is open, and the parked action would sit there forever, so the unmount
 *     calls `dismissSheet()` — which drops the parked action and tells its
 *     owner ("Not saved — sign in to keep this drive"), exactly what
 *     `onRequestClose` did in the Modal days.
 *
 * ONLY IF STILL OPEN. After a successful verify the engine has already closed
 * the sheet and RUN the parked action; after "Not now" it has already dropped
 * it. Either way `sheetOpen` is false by the time the pop unmounts this
 * screen, and calling `dismissSheet()` then would fire the host's
 * `onDismiss` a second time — "Not saved" under a drive that was just saved.
 * The flag is mirrored into a ref so the unmount cleanup reads the LATEST
 * value, and the cleanup itself has no dependencies, so it runs once, at
 * unmount, never on a re-render.
 */

import { useEffect, useRef, type ReactElement } from 'react';

import { SignInBody } from '../components/SignInSheet';
import { useAuth } from '../lib/use_auth';

export default function SignInScreen(): ReactElement {
  const { sheetOpen, dismissSheet } = useAuth();
  const stillOpen = useRef(sheetOpen);
  const dismiss = useRef(dismissSheet);

  useEffect(() => {
    stillOpen.current = sheetOpen;
    dismiss.current = dismissSheet;
  }, [sheetOpen, dismissSheet]);

  useEffect(
    () => () => {
      // The platform closed the sheet (swipe) while the engine still had a
      // parked action: drop it now, once. A pop the engine itself caused
      // (verify success, "Not now") arrives here with the flag already false.
      if (stillOpen.current) dismiss.current();
    },
    [],
  );

  return <SignInBody />;
}
