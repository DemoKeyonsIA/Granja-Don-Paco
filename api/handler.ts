import type { Request, Response } from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp, getNeonDatabase, initializeNeonDatabase } = require('../server.bundle.cjs');

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    const rewrittenPath = Array.isArray(req.query.route)
      ? req.query.route.join('/')
      : String(req.query.route || '');
    const safePath = rewrittenPath.replace(/^\/+|\/+$/g, '');
    if (!safePath || safePath.split('/').some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) {
      return res.status(400).json({ error: 'Ruta API inválida.' });
    }

    if (!appPromise) {
      const { db } = getNeonDatabase();
      appPromise = initializeNeonDatabase(db).then(() => createApp(false, db, false));
    }

    const app = await appPromise;
    const query = new URL(req.url || '/', 'https://vercel.invalid').searchParams;
    query.delete('route');
    const suffix = query.toString();
    req.url = `/api/${safePath}${suffix ? `?${suffix}` : ''}`;
    return app(req, res);
  } catch (error) {
    appPromise = null;
    console.error('[Vercel API] No se pudo iniciar el servicio:', error);
    return res.status(503).json({ error: 'El servicio aún no está listo. Revise la configuración de la base de datos.' });
  }
}
