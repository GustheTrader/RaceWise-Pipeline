import path from 'path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

// Serves the Vercel functions in api/ during `vite dev`.
function apiDev(): Plugin {
  return {
    name: 'api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '');
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          const { POST } = await server.ssrLoadModule(`/api/${name}.ts`);
          const response: Response = await POST(new Request(`http://localhost/api/${name}`, {
            method: 'POST',
            headers: req.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }));
          res.statusCode = response.status;
          res.setHeader('content-type', 'application/json');
          res.end(await response.text());
        } catch (err: any) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: err?.message || 'Not found' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    for (const name of ['GEMINI_API_KEY', 'CHEAPERINFERENCE_API_KEY', 'CHEAPERINFERENCE_BASE_URL', 'CHEAPERINFERENCE_MODEL', 'PIPELINE_INGEST_KEY', 'PIPELINE_INGEST_URL', 'PIPELINE_APP_PASSWORD']) {
      if (env[name]) process.env[name] = env[name];
    }
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), apiDev()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
