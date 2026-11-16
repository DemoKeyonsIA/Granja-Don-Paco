import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Registra correo, documentos, cuentas y reglas de Office. */
export function registrarRutasOffice(app: any, db: any, requirePermission: (...args: any[]) => any, resolveUsuario: (req: any) => Promise<any>) {
  // ==================== MÓDULO OFFICE (correo + documentos) ====================
  // Provider 'local': los mensajes y archivos viven en las tablas office_*.
  // El shape es idéntico al que usaría el provider 'google' (boceto §7), así que
  // cambiar de proveedor no obliga a tocar ni la UI ni los endpoints.
  //
  // Permisos: Office se ve para Admin/Socio/Comercial. Las REGLAS de correlación
  // (office_links) son configuración global: solo Admin las administra.

  function requireOfficeViewer(req: any, res: any, next: any) {
    return requirePermission('office', 'view')(req, res, next);
  }

  // Las 4 cuentas del provider local son buzones COMPARTIDOS de la empresa
  // (gerencia/proveedores/contabilidad/ventas), no buzones personales. Por eso
  // todo rol con office:view las ve; lo que se restringe por rol es escribir
  // configuración (conectar cuentas y reglas), no leer la bandeja.
  async function officeCuentasDe(user: { id: string; role: string }) {
    return await db.select().from(schema.officeAccounts);
  }

  // Conectar/desconectar cuentas y administrar reglas es solo Admin.
  async function requireOfficeAdmin(req: any, res: any, next: any) {
    const usuario = await resolveUsuario(req);
    if (!usuario) return res.status(401).json({ error: 'Autenticación requerida' });
    if (usuario.role === 'Admin') { (req as any).usuario = usuario; return next(); }
    return res.status(403).json({ error: 'Solo un Admin puede administrar las cuentas y reglas de Office' });
  }

  // Aplica una regla (office_links) a un mensaje. Devuelve la regla que aplicó o null.
  function officeReglaAplica(reglas: any[], msg: any) {
    const texto = `${msg.asunto || ''} ${msg.preview || ''}`.toLowerCase();
    const remitente = String(msg.remitenteEmail || '').toLowerCase();
    const labels = String(msg.labelIds || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
    for (const r of reglas) {
      if (r.estado !== 'Activa') continue;
      const valor = String(r.criterioValor || '').toLowerCase().trim();
      if (!valor) continue;
      if (r.criterioTipo === 'label') { if (labels.includes(valor)) return r; continue; }
      if (r.criterioTipo === 'from') { if (remitente.includes(valor)) return r; continue; }
      if (r.criterioTipo === 'subject') { if (texto.includes(valor)) return r; continue; }
    }
    return null;
  }

  // GET /api/office/resumen - contadores para el viewhead y el sidebar de cuentas.
  app.get("/api/office/resumen", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const mensajes = ids.length
        ? (await db.select().from(schema.officeMessages)).filter((m: any) => ids.includes(m.accountId))
        : [];
      const docs = await db.select().from(schema.officeDriveIndex);
      const reglas = await db.select().from(schema.officeLinks);
      const sinLeer = mensajes.filter((m: any) => m.leido === 0).length;
      const sinCarpeta = reglas.filter((r: any) => r.estado === 'Activa' && !r.carpeta).length;
      const huérfanos = docs.filter((d: any) => !d.threadId).length;
      res.json({
        cuentas: cuentas.length,
        mensajes: mensajes.length,
        sinLeer,
        documentos: docs.length,
        reglasActivas: reglas.filter((r: any) => r.estado === 'Activa').length,
        reglas: reglas.length,
        cuentasSinCarpeta: sinCarpeta,
        documentosHuerfanos: huérfanos,
        ultimoSync: cuentas.map((c: any) => c.lastSync).filter(Boolean).sort().slice(-1)[0] || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/cuentas - listado de cuentas con su contador de no leídos.
  app.get("/api/office/cuentas", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const mensajes = await db.select().from(schema.officeMessages);
      res.json(cuentas.map((c: any) => ({
        ...c,
        mensajes: mensajes.filter((m: any) => m.accountId === c.id).length,
        sinLeer: mensajes.filter((m: any) => m.accountId === c.id && m.leido === 0).length,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/cuentas - "Conectar cuenta". Con provider local no hay OAuth:
  // se registra la cuenta y queda lista para sincronizar. Solo Admin.
  app.post("/api/office/cuentas", requireOfficeViewer, requireOfficeAdmin, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { email, etiqueta, color, provider } = req.body || {};
      if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) return res.status(400).json({ error: "Email es requerido y debe ser válido" });
      if (!etiqueta) return res.status(400).json({ error: "Etiqueta es requerida" });
      const existentes = await db.select().from(schema.officeAccounts);
      if (existentes.some((c: any) => String(c.email).toLowerCase() === String(email).toLowerCase())) {
        return res.status(409).json({ error: "La cuenta ya está conectada" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.officeAccounts).values({
        id, userId: usuario.id, email, etiqueta,
        color: color || '#3D7A4A',
        provider: provider || 'local',
        scope: provider === 'google' ? 'gmail.readonly drive.file' : '',
        estado: 'Conectada',
        lastSync: null,
      });
      const [creada] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, id));
      res.status(201).json(creada);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/office/cuentas/:id - desconectar. Borra los mensajes de esa cuenta
  // (si no, la FK account_id impide el DELETE) y deja los documentos como huérfanos
  // para que sigan visibles en Admin › Vinculaciones. Solo Admin.
  app.delete("/api/office/cuentas/:id", requireOfficeAdmin, async (req, res) => {
    try {
      const [cuenta] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, req.params.id));
      if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.accountId === req.params.id);
      const threadIds = mensajes.map((m: any) => m.threadId);
      await db.delete(schema.officeMessages).where(eq(schema.officeMessages.accountId, req.params.id));
      // Los documentos de esos hilos quedan sin vínculo (huérfanos), no se borran.
      for (const doc of await db.select().from(schema.officeDriveIndex)) {
        if (doc.threadId && threadIds.includes(doc.threadId)) {
          await db.update(schema.officeDriveIndex).set({ threadId: null, messageId: null, origen: 'manual' }).where(eq(schema.officeDriveIndex.id, doc.id));
        }
      }
      await db.delete(schema.officeAccounts).where(eq(schema.officeAccounts.id, req.params.id));
      res.json({ ok: true, id: req.params.id, mensajesEliminados: mensajes.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/sync - "Actualizar". Con provider local NO inventa mensajes:
  // solo sella last_sync. Un provider real llenaría la bandeja aquí (ej. con
  // Gmail History API/watch para incremental, o full sync bajo demanda).
  app.post("/api/office/sync", requirePermission('office', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const now = new Date().toISOString();
      for (const c of cuentas) {
        await db.update(schema.officeAccounts).set({ lastSync: now }).where(eq(schema.officeAccounts.id, c.id));
      }
      res.json({ ok: true, sincronizado: cuentas.length, lastSync: now });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/mensajes - bandeja unificada. Filtros: cuenta, vista, q, conAdjuntos.
  // vista: todos | con-documentos | sin-responder
  app.get("/api/office/mensajes", requireOfficeViewer, async (req, res) => {    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const porId = new Map<string, any>(cuentas.map((c: any) => [c.id, c]));
      const docs = await db.select().from(schema.officeDriveIndex);
      const reglas = await db.select().from(schema.officeLinks);

      let filas: any[] = (await db.select().from(schema.officeMessages)).filter((m: any) => ids.includes(m.accountId));
      const vista = String(req.query.vista || 'todos');
      if (req.query.cuenta) filas = filas.filter((m: any) => m.accountId === req.query.cuenta);
      if (req.query.conAdjuntos === 'true') filas = filas.filter((m: any) => Number(m.adjuntoCount) > 0);
      if (req.query.desde) filas = filas.filter((m: any) => new Date(m.fecha).getTime() >= new Date(String(req.query.desde)).getTime());
      if (vista === 'con-documentos') filas = filas.filter((m: any) => Number(m.adjuntoCount) > 0);
      if (vista === 'sin-responder') filas = filas.filter((m: any) => Number(m.recibidos) < 2 && m.leido === 0);
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) filas = filas.filter((m: any) => `${m.asunto} ${m.remitente} ${m.preview}`.toLowerCase().includes(q));

      filas = filas.map((m: any) => {
        const regla = officeReglaAplica(reglas.filter((r: any) => !r.accountId || r.accountId === m.accountId), m);
        return {
          ...m,
          etiquetaCuenta: porId.get(m.accountId)?.etiqueta || '',
          colorCuenta: porId.get(m.accountId)?.color || '#3D7A4A',
          carpeta: regla?.carpeta || null,
          reglaId: regla?.id || null,
          documentos: docs.filter((d: any) => d.threadId === m.threadId),
        };
      });
      filas.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      res.json(filas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/mensajes - ingesta de un mensaje al buzón.
  // Con provider local la bandeja se siembra por esta vía; un provider 'google'
  // llamaría el mismo endpoint desde su worker de messages.list/watch.
  app.post("/api/office/mensajes", requirePermission('office', 'create'), async (req, res) => {
    try {
      const { accountId, threadId, remitente, remitenteEmail, asunto, preview, labelIds, recibidos, leido, adjuntoCount, fecha } = req.body || {};
      if (!accountId || !threadId || !remitente || !remitenteEmail || !asunto) {
        return res.status(400).json({ error: "accountId, threadId, remitente, remitenteEmail y asunto son requeridos" });
      }
      const [cuenta] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, accountId));
      if (!cuenta) return res.status(400).json({ error: "La cuenta indicada no existe" });
      const id = crypto.randomUUID();
      await db.insert(schema.officeMessages).values({
        id, accountId, threadId,
        remitente,
        remitenteEmail,
        asunto,
        preview: preview || '',
        labelIds: labelIds || '',
        recibidos: Number(recibidos || 1),
        leido: Number(leido || 0),
        adjuntoCount: Number(adjuntoCount || 0),
        fecha: fecha || new Date().toISOString(),
      });
      const [creado] = await db.select().from(schema.officeMessages).where(eq(schema.officeMessages.id, id));
      res.status(201).json(creado);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/mensajes/:threadId - hilo completo + documentos vinculados.
  app.get("/api/office/mensajes/:threadId", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.threadId === req.params.threadId);
      if (!mensajes.length || !ids.includes(mensajes[0].accountId)) return res.status(404).json({ error: "Hilo no encontrado" });
      const docs = (await db.select().from(schema.officeDriveIndex)).filter((d: any) => d.threadId === req.params.threadId);
      const reglas = await db.select().from(schema.officeLinks);
      const regla = officeReglaAplica(reglas.filter((r: any) => !r.accountId || r.accountId === mensajes[0].accountId), mensajes[0]);
      const orden = [...mensajes].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
      res.json({ hilo: orden, documentos: docs, carpeta: regla?.carpeta || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/mensajes/:id/leer - marcar leído/no leído.
  app.post("/api/office/mensajes/:id/leer", requireOfficeViewer, async (req, res) => {
    try {
      const leido = req.body?.leido === false ? 0 : 1;
      const [msg] = await db.select().from(schema.officeMessages).where(eq(schema.officeMessages.id, req.params.id));
      if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });
      await db.update(schema.officeMessages).set({ leido }).where(eq(schema.officeMessages.id, req.params.id));
      res.json({ ok: true, leido });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/arbol - árbol de carpetas + contador de faltantes (para Documentos).
  app.get("/api/office/arbol", requireOfficeViewer, async (req, res) => {
    try {
      const reglas = (await db.select().from(schema.officeLinks)).filter((r: any) => r.estado === 'Activa');
      const docs = await db.select().from(schema.officeDriveIndex);
      const carpetas = Array.from(new Set(reglas.map((r: any) => r.carpeta).filter(Boolean))) as string[];
      const arbol = carpetas.map((carpeta: string) => {
        const enCarpeta = docs.filter((d: any) => d.carpeta === carpeta);
        return {
          carpeta,
          total: enCarpeta.length,
          huerfanos: enCarpeta.filter((d: any) => !d.threadId).length,
        };
      });
      const sinCarpeta = reglas.filter((r: any) => !r.carpeta).map((r: any) => ({ nombreCuenta: r.nombreCuenta, id: r.id }));
      res.json({ arbol, sinCarpeta, totalDocs: docs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/documentos - índice de archivos. Filtros: carpeta, q, tipo.
  app.get("/api/office/documentos", requireOfficeViewer, async (req, res) => {
    try {
      let docs: any[] = await db.select().from(schema.officeDriveIndex);
      if (req.query.carpeta) docs = docs.filter((d: any) => d.carpeta === req.query.carpeta);
      if (req.query.tipo) docs = docs.filter((d: any) => d.archivoTipo === req.query.tipo);
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) docs = docs.filter((d: any) => d.archivoNombre.toLowerCase().includes(q));
      docs = docs.map((d: any) => ({ ...d, huerfano: !d.threadId }));
      docs.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/documentos - "Subir documento" (sin binario: registra metadata).
  app.post("/api/office/documentos", requirePermission('office', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { archivoNombre, archivoTipo, carpeta, bytes, linkId, origen } = req.body || {};
      if (!archivoNombre) return res.status(400).json({ error: "Nombre de archivo es requerido" });
      if (!carpeta) return res.status(400).json({ error: "Carpeta destino es requerida" });
      const [regla] = linkId
        ? await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, linkId))
        : [null];
      const id = crypto.randomUUID();
      await db.insert(schema.officeDriveIndex).values({
        id,
        archivoNombre,
        archivoTipo: archivoTipo || 'PDF',
        archivoBytes: Number(bytes || 0),
        linkId: regla?.id || null,
        carpeta,
        threadId: req.body?.threadId || null,
        messageId: req.body?.messageId || null,
        origen: origen || (regla ? 'hilo' : 'manual'),
        fecha: new Date().toISOString(),
      });
      await db.insert(schema.auditoria).values({
        id: crypto.randomUUID(), usuarioId: usuario.id, accion: 'Subir documento', modulo: 'Office',
        referenciaId: id, fecha: new Date().toISOString(),
      });
      const [creado] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, id));
      res.status(201).json({ ...creado, huerfano: !creado.threadId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/office/documentos/:id/carpeta", requirePermission('office', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const carpeta = String(req.body?.carpeta || '').trim();
      if (!carpeta) return res.status(400).json({ error: 'La carpeta destino es requerida' });
      if (carpeta.length > 200) return res.status(400).json({ error: 'La carpeta destino no puede superar 200 caracteres' });
      const [doc] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
      await db.update(schema.officeDriveIndex).set({ carpeta }).where(eq(schema.officeDriveIndex.id, req.params.id));
      await db.insert(schema.auditoria).values({
        id: crypto.randomUUID(), usuarioId: usuario.id, accion: 'Mover documento a carpeta', modulo: 'Office',
        referenciaId: doc.id, valoresAntes: JSON.stringify({ carpeta: doc.carpeta }),
        valoresDespues: JSON.stringify({ carpeta }), motivo: 'Cambio de carpeta desde Documentos', fecha: new Date().toISOString(),
      });
      const [actualizado] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      res.json({ ...actualizado, huerfano: !actualizado.threadId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/documentos/:id/vincular - liga un archivo huérfano a un hilo.
  app.post("/api/office/documentos/:id/vincular", requirePermission('office', 'create'), async (req, res) => {
    try {
      const { threadId, messageId, carpeta, linkId } = req.body || {};
      if (!threadId) return res.status(400).json({ error: "threadId es requerido" });
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.threadId === threadId);
      if (!mensajes.length) return res.status(404).json({ error: "Hilo no encontrado" });
      const [doc] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
      await db.update(schema.officeDriveIndex).set({
        threadId, messageId: messageId || mensajes[0].id,
        linkId: linkId || doc.linkId || null,
        carpeta: carpeta || doc.carpeta || null,
        origen: 'hilo',
      }).where(eq(schema.officeDriveIndex.id, req.params.id));
      const [actualizado] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      res.json({ ...actualizado, huerfano: !actualizado.threadId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Reglas de correlación (Admin › Vinculaciones) ----
  // Solo Admin: es configuración global del sistema, no una vista de correo.

  app.get("/api/office/vinculaciones", requireOfficeAdmin, async (req, res) => {
    try {
      const reglas = await db.select().from(schema.officeLinks);
      const docs = await db.select().from(schema.officeDriveIndex);
      res.json(reglas.map((r: any) => ({
        ...r,
        archivos: docs.filter((d: any) => d.linkId === r.id).length,
        requiereAccion: r.estado === 'Activa' && !r.carpeta,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/office/vinculaciones", requireOfficeAdmin, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { nombreCuenta, carpeta, criterioTipo, criterioValor, automatico, accountId } = req.body || {};
      if (!nombreCuenta) return res.status(400).json({ error: "Cuenta es requerida" });
      if (!criterioTipo || !['label', 'from', 'subject', 'manual'].includes(criterioTipo)) {
        return res.status(400).json({ error: "Criterio inválido (label | from | subject | manual)" });
      }
      if (criterioTipo !== 'manual' && !criterioValor) {
        return res.status(400).json({ error: "El criterio automático necesita un valor" });
      }
      if (!carpeta && criterioTipo !== 'manual') {
        return res.status(400).json({ error: "Una regla automática necesita carpeta destino" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.officeLinks).values({
        id,
        accountId: accountId || null,
        nombreCuenta,
        driveFolderId: carpeta || null,
        carpeta: carpeta || null,
        criterioTipo,
        criterioValor: criterioValor || '',
        automatico: automatico === false ? 0 : 1,
        estado: 'Activa',
        creadoPor: usuario.id,
        fechaCreacion: new Date().toISOString(),
      });
      const [creada] = await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, id));
      res.status(201).json({ ...creada, archivos: 0, requiereAccion: !creada.carpeta });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/office/vinculaciones/:id", requireOfficeAdmin, async (req, res) => {
    try {
      const [regla] = await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, req.params.id));
      if (!regla) return res.status(404).json({ error: "Regla no encontrada" });
      await db.delete(schema.officeLinks).where(eq(schema.officeLinks.id, req.params.id));
      res.json({ ok: true, id: req.params.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/vinculaciones/probar - dry-run: qué regla aplicaría a qué mensajes.
  app.post("/api/office/vinculaciones/probar", requireOfficeAdmin, async (req, res) => {
    try {
      const reglas = await db.select().from(schema.officeLinks);
      const mensajes = await db.select().from(schema.officeMessages);
      const porRegla = new Map<string, any[]>();
      for (const m of mensajes) {
        const r = officeReglaAplica(reglas.filter((x: any) => !x.accountId || x.accountId === m.accountId), m);
        const key = r ? r.id : 'sin-regla';
        if (!porRegla.has(key)) porRegla.set(key, []);
        porRegla.get(key)!.push({ asunto: m.asunto, remitente: m.remitente, adjuntoCount: m.adjuntoCount });
      }
      res.json({
        reglas: reglas.map((r: any) => ({ id: r.id, nombreCuenta: r.nombreCuenta, carpeta: r.carpeta, coincide: porRegla.get(r.id)?.length || 0, ejemplos: (porRegla.get(r.id) || []).slice(0, 3) })),
        sinRegla: { coincide: porRegla.get('sin-regla')?.length || 0, ejemplos: (porRegla.get('sin-regla') || []).slice(0, 5) },
        totalMensajes: mensajes.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
