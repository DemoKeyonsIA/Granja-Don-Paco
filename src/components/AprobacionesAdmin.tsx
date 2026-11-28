import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, RefreshCw, X } from 'lucide-react';
import type { User } from '../types';
import { loadSession } from '../lib/session';
import { toast } from 'sonner';

type Aprobacion = {
  id: string;
  tipo: string;
  modulo: string;
  referenciaId?: string | null;
  solicitudUsuario: string;
  descripcion: string;
  datos?: string | null;
  fechaSolicitud: string;
  estado: string;
};

const NOMBRE_TIPO: Record<string, string> = {
  DiferenciaCuadre: 'Diferencia en el cuadre de ruta',
  DiferenciaCaja: 'Diferencia de efectivo en caja',
  DiferenciaDeposito: 'Diferencia entre caja y depósito bancario',
  DiferenciaConteoBodega: 'El conteo de Bodega no coincide',
  MermaDescuadre: 'Merma por encima del límite',
  AjusteInventario: 'Ajuste de inventario',
  RetornoPendiente: 'Retorno pendiente de Bodega',
  PrecioFueraRango: 'Precio fuera del rango autorizado',
  DescuentoNoAutorizado: 'Descuento requiere aprobación',
  AltaClienteRuta: 'Alta de cliente solicitada por vendedor',
  RecepcionAlimento: 'Recepción de alimento',
};

export default function AprobacionesAdmin({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<Aprobacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState<string | null>(null);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const esAdmin = (currentUser.roles?.length ? currentUser.roles : [currentUser.role]).includes('Admin');

  const headers = useCallback(() => {
    const token = loadSession()?.token;
    return { 'Content-Type': 'application/json', 'x-user-id': currentUser.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, [currentUser.id]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/aprobaciones/pendientes', { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las aprobaciones');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las aprobaciones');
    } finally {
      setCargando(false);
    }
  }, [headers]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (!esAdmin) {
    return <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-900">Esta bandeja está disponible solo para Administración.</section>;
  }

  const resolver = async (item: Aprobacion, estado: 'Aprobado' | 'Rechazado') => {
    if (item.tipo === 'RecepcionAlimento' && estado === 'Rechazado' && !motivos[item.id]?.trim()) {
      toast.error('Indique la diferencia encontrada para informársela al encargado.');
      return;
    }
    const detalleConteo = item.tipo === 'DiferenciaConteoBodega' ? (() => { try { return JSON.parse(item.datos || '{}'); } catch { return {}; } })() : null;
    if (item.tipo === 'DiferenciaConteoBodega' && estado === 'Aprobado' && !detalleConteo?.segundoConteo) return;
    setActualizando(item.id);
    try {
      const res = await fetch(`/api/aprobaciones/${item.id}`, {
        method: 'PUT', headers: headers(),
        body: JSON.stringify({ estado, motivoRechazo: motivos[item.id] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo resolver la aprobación');
      toast.success(item.tipo === 'RecepcionAlimento'
        ? estado === 'Aprobado' ? 'Recepción marcada como revisada' : 'Diferencia reportada a partir de la recepción'
        : estado === 'Aprobado' ? item.tipo === 'AltaClienteRuta' ? 'Cliente aprobado y agregado a la ruta' : 'Solicitud aprobada' : item.tipo === 'DiferenciaConteoBodega' ? 'Bodega debe realizar otro conteo' : 'Solicitud rechazada');
      setMotivos(prev => { const next = { ...prev }; delete next[item.id]; return next; });
      await cargar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo resolver la aprobación');
    } finally {
      setActualizando(null);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-5" aria-labelledby="aprobaciones-titulo">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="aprobaciones-titulo" className="flex items-center gap-2 text-xl font-black text-neutral-900 dark:text-white">
            <ClipboardCheck className="h-5 w-5 text-emerald-700" /> Solicitudes por revisar
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-300">
            Revise qué pasó y quién lo reportó antes de aprobar. Una aprobación queda ligada a su usuario.
          </p>
        </div>
        <button type="button" onClick={() => void cargar()} disabled={cargando}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
          <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      {cargando ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">Cargando solicitudes…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
          <Check className="mx-auto h-8 w-8 text-emerald-700" />
          <p className="mt-2 font-bold text-neutral-900 dark:text-white">No hay solicitudes pendientes</p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">Las diferencias y solicitudes nuevas aparecerán aquí.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const esConteoFisico = item.tipo === 'DiferenciaConteoBodega';
            const esAltaCliente = item.tipo === 'AltaClienteRuta';
            const esRecepcionAlimento = item.tipo === 'RecepcionAlimento';
            const datosConteo = esConteoFisico ? (() => { try { return JSON.parse(item.datos || '{}'); } catch { return {}; } })() : null;
            const datosCliente = esAltaCliente ? (() => { try { return JSON.parse(item.datos || '{}'); } catch { return {}; } })() : null;
            const datosAlimento = esRecepcionAlimento ? (() => { try { return JSON.parse(item.datos || '{}'); } catch { return {}; } })() : null;
            const requiereReconteo = esConteoFisico && !datosConteo?.segundoConteo;
            return (
              <article key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{item.modulo} · {item.referenciaId || (esRecepcionAlimento ? 'Recepción reportada' : 'Sin referencia')}</p>
                    <h3 className="mt-1 text-base font-extrabold text-neutral-900 dark:text-white">{NOMBRE_TIPO[item.tipo] || item.tipo}</h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{item.descripcion}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Pendiente</span>
                </div>
                <p className="mt-3 text-xs text-neutral-500">Reportado por {datosAlimento?.reportadoPorNombre || item.solicitudUsuario} · {new Date(item.fechaSolicitud).toLocaleString()}</p>

                {esAltaCliente && datosCliente && (
                  <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 sm:grid-cols-2 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                    <p><span className="font-semibold">Ruta:</span> {datosCliente.ruta || '—'}</p>
                    <p><span className="font-semibold">Identificación:</span> {datosCliente.tipo_documento || 'Física'} · {datosCliente.documento_id || 'No indicada'}</p>
                    <p><span className="font-semibold">Teléfono:</span> {datosCliente.telefono || 'No indicado'}</p>
                    <p><span className="font-semibold">Correo:</span> {datosCliente.email || 'No indicado'}</p>
                    <p className="sm:col-span-2"><span className="font-semibold">Ubicación:</span> {[datosCliente.direccion, datosCliente.distrito, datosCliente.canton, datosCliente.provincia].filter(Boolean).join(', ') || 'No indicada'}</p>
                    <p className="sm:col-span-2 text-xs">Al aprobar, el cliente se crea como contado y queda agregado a esta ruta.</p>
                  </div>
                )}

                {esRecepcionAlimento && datosAlimento && (
                  <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 sm:grid-cols-2 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                    {datosAlimento.inventarioActualizado && <p className="font-semibold sm:col-span-2">La recepción ya está en el inventario común y disponible para asignarse a un galerón.</p>}
                    <p><span className="font-semibold">Cantidad recibida:</span> {datosAlimento.cantidadSacos} sacos</p>
                    <p><span className="font-semibold">Tipo:</span> {datosAlimento.tipoAlimento || '—'}</p>
                    <p><span className="font-semibold">Granja:</span> {datosAlimento.granja || '—'}</p>
                    <p><span className="font-semibold">Proveedor:</span> {datosAlimento.proveedor || 'No indicado'}</p>
                    <p><span className="font-semibold">Factura o referencia:</span> {datosAlimento.referencia || 'No indicada'}</p>
                    {datosAlimento.observaciones && <p className="sm:col-span-2"><span className="font-semibold">Nota:</span> {datosAlimento.observaciones}</p>}
                    <p className="sm:col-span-2 text-xs">Este reporte no modifica existencias. Revise la cantidad contra la compra antes de actualizar el inventario.</p>
                  </div>
                )}

                {esConteoFisico && (
                  <div className="mt-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    {requiereReconteo ? <p><b>Falta el segundo conteo independiente.</b> Bodega debe volver a contar cada producto con otra persona antes de que pueda aprobarse un ajuste.</p> : <div className="flex-1"><b>Dos conteos confirmaron la diferencia.</b> Si aprueba, el sistema registrará el ajuste, retendrá el producto en cuarentena y dejará las etiquetas originales sin alterar.
                      <div className="mt-3 space-y-1">{(datosConteo.segundoConteo.lineas || []).map((l: any) => <p key={l.producto} className="text-xs">{l.producto}: sistema {l.cantidadSistema} · primer conteo {l.cantidadContada} · segundo conteo {l.cantidadRecontada} {l.unidad} {l.motivoReconteo ? `· ${l.motivoReconteo}` : ''}</p>)}</div>
                    </div>}
                  </div>
                )}

                <label className="mt-4 block text-xs font-bold text-neutral-600 dark:text-neutral-300" htmlFor={`motivo-${item.id}`}>
                  {esConteoFisico ? 'Nota de resolución o motivo para pedir otra revisión' : esRecepcionAlimento ? 'Nota para el encargado (obligatoria si reporta diferencia)' : 'Motivo (opcional)'}
                </label>
                <textarea id={`motivo-${item.id}`} rows={2} value={motivos[item.id] || ''}
                  onChange={e => setMotivos(prev => ({ ...prev, [item.id]: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
                  placeholder={esRecepcionAlimento ? 'Escriba la diferencia encontrada, si aplica' : 'Escriba una nota clara para el equipo'} />
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void resolver(item, 'Rechazado')} disabled={actualizando === item.id}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-300">
                    <X className="h-4 w-4" /> {esConteoFisico ? 'Solicitar nuevo conteo' : esRecepcionAlimento ? 'Reportar diferencia' : 'Rechazar'}
                  </button>
                  <button type="button" onClick={() => void resolver(item, 'Aprobado')} disabled={actualizando === item.id || requiereReconteo}
                    title={requiereReconteo ? 'Se requiere un segundo conteo realizado por otra persona' : undefined}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                    <Check className="h-4 w-4" /> {actualizando === item.id ? 'Guardando…' : esRecepcionAlimento ? 'Marcar revisado' : 'Aprobar'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
