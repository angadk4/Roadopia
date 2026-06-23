/**
 * Placeholder backend entry (M0-T03 skeleton). The Fastify service + `/plan` SSE land at M6.
 *
 * The type-only import below exists to prove the `@shared/*` path alias resolves
 * (M0-T03 AC). It is erased at compile time — no runtime coupling yet.
 */
import type { ServerConfig } from '@shared/config';
import type { Route } from '@shared/types';

export type BackendConfig = ServerConfig;

/** Stub proving the shared domain types resolve into the backend (M0-T06 DoD). */
export type BackendRoute = Route;
