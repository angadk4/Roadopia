/**
 * Contact / abuse path (M10-T08; FR-304). The address is deploy
 * configuration (EXPO_PUBLIC_CONTACT_EMAIL) — the in-repo default is a
 * reserved-domain placeholder on purpose (Hard rule H posture: no real
 * personal address checked in; the owner sets the real one at M12 deploy).
 */

export const CONTACT_EMAIL = process.env['EXPO_PUBLIC_CONTACT_EMAIL'] ?? 'contact@roadopia.example';

export function contactMailtoUrl(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
