/**
 * Placeholder backend entry (M0-T03 skeleton). The Fastify service + `/plan` SSE land at M6.
 *
 * The type-only import below exists to prove the `@shared/*` path alias resolves
 * (M0-T03 AC). It is erased at compile time — no runtime coupling yet.
 */
import type { ServerConfig } from '@shared/config';

export type BackendConfig = ServerConfig;
