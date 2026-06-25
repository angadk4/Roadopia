import Fastify from 'fastify';

/**
 * Minimal Fastify dev server (M0-T09). The real service — `/plan` SSE, the
 * deterministic planner, the cost-guarded model client — lands at M6. For now
 * this is just the health stub the Docker dev stack boots against.
 */
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

app.listen({ port: PORT, host: HOST }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
