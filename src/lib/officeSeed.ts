/**
 * Bandeja inicial de Office.
 *
 * Vive aparte del componente a proposito: `Office.tsx` importa `./gcrm.css`, y
 * un modulo que se importa desde el componente arrastra el CSS a cualquier
 * consumidor de Node (un script, un test). Ademas, los payloads quedan como
 * datos declarativos y se pueden verificar sin levantar React.
 *
 * La simulacion es de dos cuentas Gmail conectadas: lo que se quiere ver es
 * como queda el correo y los documentos de Drive cuando las reglas de
 * vinculacion YA estan aplicadas — por eso cada mensaje con adjunto tiene su
 * documento en la carpeta que le corresponde a su regla, y los dos archivos
 * sueltos quedan huerfanos a proposito, para que se vea tambien el caso "aun
 * sin vincular".
 */

export type CuentaSemilla = { email: string; etiqueta: string; color: string };

export type MensajeSemilla = {
  th: string; et: string; remitente: string; remitenteEmail: string; asunto: string;
  preview: string; labelIds: string; recibidos: number; leido: number; adjuntoCount: number;
  /** Minutos hacia atras desde que se siembra; se resuelve a fecha ISO al enviar. */
  mins: number;
};

export type ReglaSemilla = {
  nombreCuenta: string; carpeta: string | null; criterioTipo: string; criterioValor: string;
};

export type DocumentoSemilla = {
  archivoNombre: string; archivoTipo: string; carpeta: string; bytes: number;
  origen: 'hilo' | 'manual'; threadId: string | null;
};

export const CUENTAS_INICIALES: CuentaSemilla[] = [
  { email: 'granjadonpaco@gmail.com', etiqueta: 'Granja Don Paco', color: '#1E40AF' },
  { email: 'concepcion@gmail.com', etiqueta: 'Concepción', color: '#7C3AED' },
];

/**
 * Los `th` son explicitos y no se derivan del asunto: los documentos de abajo
 * tienen que apuntar al mismo `threadId` que el mensaje, o el chip "de hilo" se
 * ve bien pero al abrir el documento el hilo sale vacio.
 *
 * `et` es la ETIQUETA de la cuenta que recibe, no su email: es la clave que usa
 * el seed para resolver el `accountId`. Los demas nombres son los que espera
 * `POST /api/office/mensajes` (`remitenteEmail`, `labelIds`, `adjuntoCount`):
 * mandarlos con otros nombres no da error visible, el endpoint responde 400 y el
 * mensaje simplemente no aparece.
 */
export const MENSAJES_INICIALES: MensajeSemilla[] = [
  { th: 'th-factura-0123', et: 'Granja Don Paco', remitente: 'Concepción Umaña', remitenteEmail: 'concepcion@gmail.com', asunto: 'RE: Factura 0123 - cartones extra grandes', preview: 'Adjunto la factura 0123 corregida con el precio que acordamos.', labelIds: 'facturas', recibidos: 3, leido: 0, adjuntoCount: 2, mins: 4 },
  { th: 'th-estado-cuenta-sep', et: 'Granja Don Paco', remitente: 'Banco Nacional', remitenteEmail: 'notificaciones@bncr.cr', asunto: 'Estado de cuenta septiembre', preview: 'Su estado de cuenta de septiembre ya está disponible.', labelIds: 'hacienda', recibidos: 1, leido: 0, adjuntoCount: 1, mins: 70 },
  { th: 'th-pedido-410', et: 'Concepción', remitente: 'Concepción Umaña', remitenteEmail: 'concepcion@gmail.com', asunto: 'Pedido #410 - 50 cartones medianos', preview: 'Confirmo el pedido, lo entregamos el jueves en la finca.', labelIds: 'pedidos', recibidos: 1, leido: 1, adjuntoCount: 1, mins: 1500 },
  { th: 'th-cotizacion-naco', et: 'Granja Don Paco', remitente: 'Grupo Naco', remitenteEmail: 'ventas@gruponaco.cr', asunto: 'Cotizacion gallinaza a granel', preview: 'Adjunto la cotizacion solicitada, el volumen subio a 12 toneladas.', labelIds: 'facturas', recibidos: 1, leido: 0, adjuntoCount: 1, mins: 4300 },
  { th: 'th-planilla-sep', et: 'Granja Don Paco', remitente: 'CCSS', remitenteEmail: 'notificacion@ccss.go.cr', asunto: 'Planilla setiembre', preview: 'Se adjunta la planilla de setiembre con los 14 trabajadores.', labelIds: 'hacienda', recibidos: 1, leido: 1, adjuntoCount: 1, mins: 4400 },
  { th: 'th-visita-veterinario', et: 'Concepción', remitente: 'Concepción Umaña', remitenteEmail: 'concepcion@gmail.com', asunto: 'Visita del veterinario el jueves', preview: '¿Le sirve a las 8am? Quiero revisar el lote nuevo antes de salir.', labelIds: '', recibidos: 1, leido: 1, adjuntoCount: 0, mins: 5600 },
];

export const REGLAS_INICIALES: ReglaSemilla[] = [
  { nombreCuenta: 'granjadonpaco@gmail.com', carpeta: 'Drive/Finanzas/Proveedores', criterioTipo: 'label', criterioValor: 'facturas' },
  { nombreCuenta: 'granjadonpaco@gmail.com', carpeta: 'Drive/Finanzas/Hacienda', criterioTipo: 'label', criterioValor: 'hacienda' },
  { nombreCuenta: 'concepcion@gmail.com', carpeta: 'Drive/Comercial/Pedidos', criterioTipo: 'label', criterioValor: 'pedidos' },
  { nombreCuenta: 'concepcion@gmail.com', carpeta: null, criterioTipo: 'manual', criterioValor: '' },
];

export const DOCUMENTOS_INICIALES: DocumentoSemilla[] = [
  { archivoNombre: 'Factura 0123.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 188416, origen: 'hilo', threadId: 'th-factura-0123' },
  { archivoNombre: 'Acuse de recibo.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 43008, origen: 'hilo', threadId: 'th-factura-0123' },
  { archivoNombre: 'Estado de cuenta septiembre.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Hacienda', bytes: 312000, origen: 'hilo', threadId: 'th-estado-cuenta-sep' },
  { archivoNombre: 'Planilla setiembre.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Hacienda', bytes: 147000, origen: 'hilo', threadId: 'th-planilla-sep' },
  { archivoNombre: 'Cotizacion gallinaza.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 98304, origen: 'hilo', threadId: 'th-cotizacion-naco' },
  { archivoNombre: 'Orden de compra 410.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Comercial/Pedidos', bytes: 88200, origen: 'hilo', threadId: 'th-pedido-410' },
  { archivoNombre: 'Orden de precios 2026.xlsx', archivoTipo: 'XLS', carpeta: 'Drive/Finanzas/Proveedores', bytes: 41984, origen: 'manual', threadId: null },
  { archivoNombre: 'Galeron 1 - instalaciones.jpg', archivoTipo: 'IMG', carpeta: 'Drive/Finanzas/Hacienda', bytes: 1258291, origen: 'manual', threadId: null },
];

const json = (cuerpo: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

/**
 * Siembra cuentas, mensajes, reglas y documentos. Idempotente: si ya hay
 * alguna cuenta conectada, no hace nada.
 *
 * @param fetchApi `fetch` a usar. Por defecto el global, que en el browser
 *   resuelve URLs relativas; un script contra un server en pie inyecta el suyo.
 * @returns si sembró o no.
 */
export async function sembrarOfficeInicial(fetchApi: typeof fetch = fetch): Promise<boolean> {
  const r = await fetchApi('/api/office/cuentas');
  if (!r.ok) return false;
  const existentes = await r.json();
  if (Array.isArray(existentes) && existentes.length > 0) return false;

  const ahora = Date.now();
  const mins = (m: number) => new Date(ahora - m * 60000).toISOString();

  // `provider: 'google'` no es decorativo: el endpoint lo usa para guardar el
  // scope (`gmail.readonly drive.file`), que es lo que hace que la cuenta se
  // vea como una Gmail de verdad y no como una bandeja local.
  const creadas: any[] = [];
  for (const d of CUENTAS_INICIALES) {
    const res = await fetchApi('/api/office/cuentas', { method: 'POST', ...json({ ...d, provider: 'google' }) });
    if (res.ok) creadas.push(await res.json());
  }
  if (creadas.length !== CUENTAS_INICIALES.length) {
    throw new Error(`se esperaban ${CUENTAS_INICIALES.length} cuentas y se crearon ${creadas.length}`);
  }

  // Las reglas se guardan con `nombreCuenta` como texto libre y el endpoint NO
  // lo resuelve contra `office_accounts`: si no se manda `accountId` explicito
  // la regla queda con `accountId` null — se ve en la pantalla pero no esta
  // amarrada a ninguna bandeja, que es justo lo que esta simulacion tiene que
  // demostrar. Por eso el seed si lo manda.
  const porEmail = new Map<string, string>(creadas.map((c) => [c.email, c.id]));
  const porEtiqueta = new Map<string, string>(creadas.map((c) => [c.etiqueta, c.id]));

  for (const { mins: atras, ...m } of MENSAJES_INICIALES) {
    const res = await fetchApi('/api/office/mensajes', {
      method: 'POST', ...json({ ...m, fecha: mins(atras), threadId: m.th, accountId: porEtiqueta.get(m.et) }),
    });
    if (!res.ok) throw new Error(`no se pudo sembrar el mensaje "${m.asunto}": ${res.status}`);
  }

  const reglasCreadas: any[] = [];
  for (const regla of REGLAS_INICIALES) {
    const res = await fetchApi('/api/office/vinculaciones', {
      method: 'POST', ...json({ ...regla, accountId: porEmail.get(regla.nombreCuenta) || null }),
    });
    if (res.ok) reglasCreadas.push(await res.json());
  }
  if (reglasCreadas.length !== REGLAS_INICIALES.length) {
    throw new Error(`se esperaban ${REGLAS_INICIALES.length} reglas y se crearon ${reglasCreadas.length}`);
  }

  // Cada documento se amarra a la regla de SU carpeta. Sin esto el archivo queda
  // `huerfano` aunque tenga hilo, y la pantalla lo ofrece para vincular de nuevo
  // como si no estuviera vinculado.
  const linkPorCarpeta = new Map<string, string>(reglasCreadas.filter((x) => x.carpeta).map((x) => [x.carpeta, x.id]));

  for (const doc of DOCUMENTOS_INICIALES) {
    const res = await fetchApi('/api/office/documentos', {
      method: 'POST', ...json({ ...doc, linkId: linkPorCarpeta.get(doc.carpeta) || null }),
    });
    if (!res.ok) throw new Error(`no se pudo sembrar el documento "${doc.archivoNombre}": ${res.status}`);
  }

  await fetchApi('/api/office/sync', { method: 'POST' });
  return true;
}
