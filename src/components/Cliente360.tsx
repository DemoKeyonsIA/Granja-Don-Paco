import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Plus, Trash2, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { Cliente, User } from '../types';
import { sessionHeaders } from '../lib/session';
import { toast } from 'sonner';
import './gcrm.css';

interface ProductoCatalogo { id: string; nombre: string; precioBase: number; unidad: string; }

type Tab = 'resumen' | 'pedidos' | 'docs' | 'rutas' | 'credito' | 'precios' | 'notas';

interface Cliente360Props {
  cliente: Cliente | null;
  currentUser: User;
  esVendedor?: boolean;
  open: boolean;
  onClose: () => void;
  onEdit?: (cliente: Cliente) => void;
}

const fmt = (n: any) => `₡${Number(n || 0).toLocaleString()}`;
const fmtKg = (n: any) => `${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg`;

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'pedidos', label: 'Pedidos & Análisis' },
  { id: 'docs', label: 'Facturas & Tiquetes' },
  { id: 'rutas', label: 'Rutas & Vendedor' },
  { id: 'credito', label: 'Crédito & Cobranza' },
  { id: 'precios', label: 'Precios' },
  { id: 'notas', label: 'Notas' },
];

function RiskChip({ estado, diasVencido }: { estado: string; diasVencido?: number }) {
  if (!estado || estado === 'Pagada') return <span className="chip green">Al día</span>;
  const d = diasVencido || 0;
  if (d > 30) return <span className="chip red">{d}d · en riesgo</span>;
  if (d > 15) return <span className="chip orange">{d}d</span>;
  if (d > 3) return <span className="chip amber">{d}d</span>;
  return <span className="chip blue">Al día</span>;
}

function fechaLocal(d: Date) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function Cliente360({ cliente, currentUser, esVendedor = false, open, onClose, onEdit }: Cliente360Props) {
  const [activeTab, setActiveTab] = useState<Tab>('resumen');
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [preciosRecomendados, setPreciosRecomendados] = useState<Record<string, any>>({});
  const [cargandoPrecios, setCargandoPrecios] = useState(false);

  const [catalogo, setCatalogo] = useState<ProductoCatalogo[]>([]);
  const [showExcForm, setShowExcForm] = useState(false);
  const [formExc, setFormExc] = useState(() => {
    const hoy = new Date();
    const fin = new Date(hoy);
    fin.setDate(fin.getDate() + 30);
    return { productoId: '', precioExcepcion: 0, justificacion: '', fechaInicio: fechaLocal(hoy), fechaFin: fechaLocal(fin) };
  });

  useEffect(() => {
    if (!open || esVendedor) return;
    fetch('/api/productos-catalogo', { headers: sessionHeaders(currentUser.id) }).then(r => r.ok ? r.json() : []).then(setCatalogo).catch(() => setCatalogo([]));
  }, [open, esVendedor, currentUser.id]);

  const cargarPerfil = async () => {
    if (!cliente) return;
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/360`, { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setData(await res.json());
    } catch { }
  };

  const agregarExcepcion = async () => {
    if (!cliente || !formExc.productoId || !formExc.precioExcepcion || !formExc.justificacion.trim()) return;
    const res = await fetch('/api/precio-excepciones', {
      method: 'POST', headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({ clienteId: cliente.id, ...formExc })
    });
    if (res.ok) {
      setShowExcForm(false);
      const hoy = new Date();
      const fin = new Date(hoy);
      fin.setDate(fin.getDate() + 30);
      setFormExc({ productoId: '', precioExcepcion: 0, justificacion: '', fechaInicio: fechaLocal(hoy), fechaFin: fechaLocal(fin) });
      cargarPerfil();
      toast.success('Excepción autorizada por 30 días');
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || 'No se pudo autorizar la excepción');
    }
  };

  const eliminarExcepcion = async (id: string) => {
    if (!window.confirm('¿Eliminar esta excepción?')) return;
    const res = await fetch(`/api/precio-excepciones/${id}`, { method: 'DELETE', headers: sessionHeaders(currentUser.id) });
    if (res.ok) { toast.success('Excepción desactivada'); cargarPerfil(); }
    else toast.error('No se pudo desactivar la excepción');
  };

  useEffect(() => {
    if (!open || !cliente) return;
    setActiveTab('resumen');
    setData(null);
    setPreciosRecomendados({});
    setIsLoading(true);
    cargarPerfil().finally(() => setIsLoading(false));
  }, [open, cliente]);

  useEffect(() => {
    if (!open || !esVendedor || !cliente || !Array.isArray(data?.recomendaciones)) return;
    const productos = data.recomendaciones.map((item: any) => item.producto).filter(Boolean);
    if (productos.length === 0) { setPreciosRecomendados({}); setCargandoPrecios(false); return; }
    const controller = new AbortController();
    setCargandoPrecios(true);
    fetch('/api/precios/lookup-multiple', {
      method: 'POST', signal: controller.signal,
      headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({ productos, clienteId: cliente.id }),
    }).then(async res => res.ok ? res.json() : {}).then(result => setPreciosRecomendados(result || {}))
      .catch(error => { if (error.name !== 'AbortError') setPreciosRecomendados({}); })
      .finally(() => { if (!controller.signal.aborted) setCargandoPrecios(false); });
    return () => controller.abort();
  }, [open, esVendedor, cliente?.id, data?.recomendaciones, currentUser.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  if (esVendedor) {
    const clienteNombre = data?.cliente?.nombre || cliente?.nombre || 'Cliente';
    const historial = Array.isArray(data?.historialPedidos) ? data.historialPedidos : [];
    const recomendaciones = Array.isArray(data?.recomendaciones) ? data.recomendaciones : [];
    const cerrar = <button type="button" onClick={onClose} aria-label="Cerrar" className="btn ico"><X className="w-5 h-5" /></button>;
    return (
      <div className="gcrm">
        <div className="drawer-fixed" onClick={onClose}>
          <aside className="drawer" onClick={e => e.stopPropagation()}>
            <div className="identity" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div><div className="mini">Pedidos y recomendación de venta</div><h2 style={{ margin: '5px 0 0', color: 'var(--ink)' }}>{clienteNombre}</h2></div>
              {cerrar}
            </div>
            <div style={{ padding: 20, display: 'grid', gap: 20 }}>
              {isLoading ? <div className="empty">Cargando historial…</div> : data == null ? <div className="empty">No se pudo cargar la información. Cierre y vuelva a abrir el cliente.</div> : <>
                <section className="panel" aria-labelledby="recomendacion-ruta-heading">
                  <div className="panelbar"><strong id="recomendacion-ruta-heading">Recomendación para la ruta</strong></div>
                  {recomendaciones.length === 0 ? <div className="empty">Aún no hay pedidos recientes para calcular una recomendación.</div> : (
                    <div className="divide-y">
                      {recomendaciones.map((item: any) => {
                        const precio = preciosRecomendados[item.producto];
                        return <div key={item.producto} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div><div className="strong">{item.producto}</div><div className="mini">Promedio por pedido: {fmtKg(item.promedioKgPedido)}</div></div>
                          <div className="text-right"><div className="strong">Sugerido: {fmtKg(item.kilosRecomendados)}</div><div className="mini">Precio recomendado: {precio?.precio != null ? `${fmt(precio.precio)}/kg` : cargandoPrecios ? 'Consultando…' : 'Sin precio autorizado'}</div></div>
                        </div>;
                      })}
                    </div>
                  )}
                </section>
                <section className="panel" aria-labelledby="historial-pedidos-heading">
                  <div className="panelbar"><strong id="historial-pedidos-heading">Historial de pedidos</strong><span>{historial.length}</span></div>
                  {historial.length === 0 ? <div className="empty">Este cliente todavía no tiene pedidos registrados.</div> : (
                    <div className="divide-y">
                      {historial.map((pedido: any, index: number) => <article key={`${pedido.referencia}-${index}`} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{pedido.referencia}</strong><span className="mini">{pedido.fecha ? new Date(pedido.fecha).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Fecha no disponible'}</span></div>
                        <ul className="mt-2 grid gap-1 text-sm">{(pedido.lineas || []).map((linea: any, lineaIndex: number) => <li key={`${linea.producto}-${lineaIndex}`} className="flex justify-between gap-3"><span>{linea.producto}</span><span className="font-semibold tabular-nums">{fmtKg(linea.kilos)}</span></li>)}</ul>
                      </article>)}
                    </div>
                  )}
                </section>
              </>}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // Mantiene a mano los datos ricos de la fila de cartera mientras carga el
  // 360; así la explicación de segmento no desaparece por un payload parcial.
  const c = { ...(cliente || {} as any), ...(data?.cliente || {}) };
  const k = data?.kpis || {};
  const iniciales = (String(c.nombre || '?')).split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const ultimaFechaLegible = k.ultimaCompra ? new Date(k.ultimaCompra).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : '—';
  const vencidas = Number(k.vencidas || 0);
  const deuda = Number(c.saldoPendiente || 0);
  const uso = Number(k.usoLinea || 0);
  const riesgoNivel = vencidas > 0 || deuda > 0 ? (deuda > 0 && uso >= 80 ? 'high' : deuda > 0 ? 'mid' : 'low') : 'low';

  const proximaAccion =
    riesgoNivel === 'high'
      ? ['Revisar saldo y facturas vencidas', `${vencidas} factura(s) vencida(s) · saldo ${fmt(deuda)} · uso de línea ${uso}%`]
      : riesgoNivel === 'mid'
        ? ['Revisar el saldo pendiente', `saldo ${fmt(deuda)} · uso de línea ${uso}%`]
        : !k.diasUltima || k.diasUltima > 14
          ? ['Contactar para conocer próxima necesidad', k.diasUltima != null ? `última compra hace ${k.diasUltima} días` : 'todavía no hay compras registradas']
          : ['Mantener seguimiento habitual', `última compra hace ${k.diasUltima} días · saldo ${fmt(deuda)}`];
  const ubicacionCliente = [c.direccion, c.distrito, c.canton, c.provincia].filter(Boolean).join(' · ');

  return (
    <div className="gcrm">
      <div className="drawer-fixed" onClick={onClose}>
        <aside className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="identity">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {c.ruta && <span className="chip green">{c.ruta}</span>}
                {c.segmento && <span className={cn('seg', c.segmento === 'A' ? 'seg-A' : c.segmento === 'B' ? 'seg-B' : 'seg-C')} title="Segmento según compras de los últimos 90 días">Segmento {c.segmento}</span>}
                <span className={c.condicionPago === 'Credito' ? 'chip amber' : 'chip green'}>{c.condicionPago}</span>
                <span className="chip gray">tipo {c.tipoDocumento}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div className="ava">{iniciales}</div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1.15, color: 'var(--ink)' }}>{c.nombre}</div>
                  <div className="mini" style={{ marginTop: 3 }}>{c.tipoDocumento || 'Identificación'} {c.documentoId || '—'} · {c.telefono || 'Sin teléfono'} · {c.email || 'Sin correo'}</div>
                  <div className="mini" style={{ marginTop: 5, color: 'var(--ink2)', maxWidth: 560 }}>
                    {ubicacionCliente || 'Ubicación sin registrar'}{c.ruta ? ` · ${c.ruta}` : ''}
                  </div>
                  {c.segmento && <div className="mini" style={{ marginTop: 4, maxWidth: 560 }}>
                    Segmento {c.segmento}: {fmt(c.monto90d)} en {c.pedidos90d || 0} compra(s) en 90 días. {c.segmento === 'A' ? 'Nivel A: ₡400.000 o más.' : c.segmento === 'B' ? 'Nivel B: entre ₡120.000 y ₡399.999.' : `Nivel C: faltan ${fmt(Math.max(0, 120000 - Number(c.monto90d || 0)))} para llegar a B.`}
                  </div>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {onEdit && <button className="btn sm" onClick={() => { if (cliente) { onEdit(cliente); } }}>Editar</button>}
                    <button className="btn sm" onClick={() => window.confirm(`Llamar a ${c.nombre} (demo)`) ? undefined : undefined}>Llamar</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexShrink: 0 }}>
              <div className="p-health">
                <div className="ring"><div>{Math.max(0, 100 - (deuda > 0 ? Math.min(99, Math.round((deuda / Math.max(1, c.limiteCredito || 1)) * 100 + vencidas * 2)) : 0))}</div></div>
                Salud
              </div>
              <button className="btn ico" onClick={onClose} title="Cerrar (Esc)"><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="drawer-actions">
            <div className="upnext">
              <span className="tag">Próxima acción</span>
              <span className="act">{proximaAccion[0]}</span>
              <span className="why">{proximaAccion[1]}</span>
            </div>
          </div>

          <div className="p-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={cn(activeTab === t.id && 'on')} onClick={() => setActiveTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="drawer-body">
            {isLoading && (
              <div className="empty">Cargando perfil 360…</div>
            )}
            {!isLoading && activeTab === 'resumen' && (
              <div className="a-panel on" data-a="resumen">
                <section className="client-facts" aria-label="Información del cliente">
                  <div><span>Identificación</span><b>{c.tipoDocumento || c.tipo_documento || 'Física'} · {c.documentoId || c.documento_id || 'Sin registrar'}</b></div>
                  <div><span>Ubicación</span><b>{ubicacionCliente || 'Sin dirección registrada'}</b></div>
                  <div><span>Ruta / vendedor</span><b>{c.ruta || 'Sin ruta asignada'}</b></div>
                  <div><span>Condición de pago</span><b>{c.condicionPago || c.condicion_pago || 'Contado'}{(c.condicionPago === 'Credito' || c.condicion_pago === 'Credito') ? ` · límite ${fmt(c.limiteCredito || c.limite_credito)}` : ''}</b></div>
                </section>
                <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
                  <div className="kpi"><div className="l">Pedidos 30d</div><div className="v">{k.pedidos30d ?? 0}</div><div className="ins">facturas del mes</div></div>
                  <div className="kpi"><div className="l">Ticket prom.</div><div className="v">{fmt(k.ticketProm)}</div><div className="ins">compra prom. por pedido</div></div>
                  <div className="kpi"><div className="l">Últ. compra</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{ultimaFechaLegible}</div><div className="ins">{k.diasUltima != null ? `hace ${k.diasUltima} d` : 'sin compras'}</div></div>
                  <div className="kpi"><div className="l">Deuda</div><div className="v" style={{ color: deuda > 0 ? 'var(--red)' : 'var(--brand)' }}>{fmt(deuda)}</div><div className="ins">{deuda > 0 ? `${vencidas || 0} vencidas` : 'al día'}</div></div>
                  <div className="kpi"><div className="l">Venta 12m</div><div className="v">{fmt(k.venta12m)}</div><div className="ins">por facturas</div></div>
                </div>
                <div className="cols">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="panel" style={{ padding: 16 }}>
                      <div className="sect"><h4>Próxima acción recomendada</h4></div>
                      <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{proximaAccion[0]}</div>
                      <div className="mini" style={{ color: 'var(--ink2)', marginBottom: 12 }}>{proximaAccion[1]}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn sm brand" onClick={() => setActiveTab('pedidos')}>Ver historial</button>
                        <button className="btn sm" onClick={() => setActiveTab('rutas')}>Ver ruta</button>
                      </div>
                    </div>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Últimos pedidos</h4></div>
                    {(data?.facturas || []).slice(0, 3).length === 0 ? (
                      <div className="empty" style={{ marginTop: 4 }}>Sin facturas registradas</div>
                    ) : (
                      <table>
                        <thead><tr><th>Factura</th><th className="num">Total</th><th>Fecha</th><th>Estado</th></tr></thead>
                        <tbody>
                          {(data?.facturas || []).slice(0, 3).map((f: any) => (
                            <tr key={f.id}>
                              <td className="strong mono">{f.consecutivo}</td>
                              <td className="num mono">{fmt(f.total)}</td>
                              <td className="mono">{new Date(f.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</td>
                              <td><RiskChip estado={f.estado} diasVencido={f.diasVencido} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <div className="panel" style={{ padding: 16, marginTop: 16 }}>
                  <div className="sect"><h4>Últimos documentos</h4></div>
                  {(data?.documentos || []).slice(0, 5).length === 0 ? (
                    <div className="empty">Sin documentos</div>
                  ) : (
                    <table>
                      <thead><tr><th>Documento</th><th className="num">Monto</th><th>Fecha</th><th>Estado</th></tr></thead>
                      <tbody>
                        {(data?.documentos || []).slice(0, 5).map((d: any, i: number) => (
                          <tr key={i}>
                            <td className="strong mono">{d.tipo === 'Factura' ? d.consecutivo : `${d.consecutivo || 'TQ'}`}</td>
                            <td className="num mono">{fmt(d.monto)}</td>
                            <td className="mono">{new Date(d.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</td>
                            <td><span className={d.estado === 'Pagada' || d.estado === 'Posteado' ? 'chip green' : d.estado === 'Anulada' ? 'chip gray' : d.estado === 'Pendiente' ? 'chip amber' : 'chip violet'}>{d.estado}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'pedidos' && (
              <div className="a-panel on" data-a="pedidos">
                <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <div className="kpi"><div className="l">Frecuencia</div><div className="v">{((k.pedidos30d || 0) / 4).toFixed(1)}<span style={{ fontSize: 13 }}>/sem</span></div><div className="ins">{k.pedidos30d || 0} pedidos · 30d</div></div>
                  <div className="kpi"><div className="l">Ticket prom.</div><div className="v">{fmt(k.ticketProm)}</div><div className="ins">compra prom. por pedido</div></div>
                  <div className="kpi"><div className="l">Por facturar · 30d</div><div className="v">{k.tiquetes30d ?? 0}</div><div className="ins">{fmt(k.montoTiquetes30d)}</div></div>
                  <div className="kpi"><div className="l">Mix cesta</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{data?.mix?.[0]?.producto || '—'}</div><div className="ins">top producto por monto</div></div>
                </div>
                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Mix por producto · 90 días</h4></div>
                    {(data?.mix || []).length === 0 ? (
                      <div className="empty">Sin ventas con detalle en 90d</div>
                    ) : (
                      <table>
                        <thead><tr><th>Producto</th><th className="num">Cantidad entregada</th><th className="num">Monto</th></tr></thead>
                        <tbody>
                          {data.mix.slice(0, 6).map((m: any, i: number) => (
                            <tr key={i}>
                              <td className="strong">{m.producto}</td>
                              <td className="num mono" title={m.pesoPendiente || m.kilos == null ? 'Este documento no tiene un peso en kg validado.' : 'Cantidad de huevo vendida y entregada en kilogramos.'}>{m.pesoPendiente || m.kilos == null ? 'Peso pendiente de validar' : fmtKg(m.kilos)}</td>
                              <td className="num mono">{fmt(m.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Tiquetes recientes</h4></div>
                    {(data?.tiquetes || []).slice(0, 6).length === 0 ? (
                      <div className="empty">Sin tiquetes en ruta</div>
                    ) : (
                      <table>
                        <thead><tr><th>Tiquete</th><th className="num">Monto</th><th>Fecha</th></tr></thead>
                        <tbody>
                          {data.tiquetes.slice(0, 6).map((t: any) => (
                            <tr key={t.id}>
                              <td className="strong mono">{t.consecutivo}</td>
                              <td className="num mono">{fmt(t.monto)}</td>
                              <td className="mono">{new Date(t.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'docs' && (
              <div className="a-panel on" data-a="docs">
                <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <div className="kpi"><div className="l">Facturas abiertas</div><div className="v">{k.facturasAbiertas ?? 0}</div><div className="ins">{fmt(k.montoPorCobrar)} por cobrar</div></div>
                  <div className="kpi"><div className="l">Vencidas</div><div className="v" style={{ color: vencidas > 0 ? 'var(--amber)' : 'var(--brand)' }}>{vencidas}</div><div className="ins">{vencidas > 0 ? 'en riesgo' : 'sin vencidas'}</div></div>
                  <div className="kpi"><div className="l">Por facturar · 30d</div><div className="v">{k.tiquetes30d ?? 0}</div><div className="ins">{fmt((k.tiquetes30d && k.montoTiquetes30d) ? k.montoTiquetes30d : 0)}</div></div>
                  <div className="kpi"><div className="l">Últ. tiquete</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>
                    {k.ultimoTiquete ? new Date(k.ultimoTiquete.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : '—'}
                  </div><div className="ins">{k.ultimoTiquete?.consecutivo || 'sin tiquetes'}</div></div>
                </div>
                <div className="panel" style={{ marginTop: 16 }}>
                  <div className="panel-head"><div className="panel-title">Facturas</div></div>
                  {(data?.facturas || []).length === 0 ? (
                    <div className="empty">Sin facturas</div>
                  ) : (
                    <table>
                      <thead><tr><th>Factura</th><th>Productos y regla aplicada</th><th className="num">Monto</th><th className="num">Vence</th><th>Estado</th></tr></thead>
                      <tbody>
                        {(data?.facturas || []).map((f: any) => (
                          <tr key={f.id}>
                            <td className="strong mono">{f.consecutivo}</td>
                            <td>{(f.lineas || []).length ? f.lineas.map((l: any, i: number) => (
                              <div key={i} className="mini">
                                {l.producto} × {l.cantidad} · {fmt(l.precioUnitario)} · {l.resolucionPrecio?.regla || 'precio histórico'}
                              </div>
                            )) : <span className="mini">Sin detalle de líneas</span>}</td>
                            <td className="num mono">{fmt(f.total)}</td>
                            <td className="num mono">{f.estado === 'Pagada' ? '—' : `${f.diasVencido} d`}</td>
                            <td><RiskChip estado={f.estado} diasVencido={f.diasVencido} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="panel" style={{ marginTop: 16 }}>
                  <div className="panel-head"><div className="panel-title">Tiquetes (pagos / ventas en ruta)</div></div>
                  {(data?.tiquetes || []).length === 0 ? (
                    <div className="empty">Sin tiquetes</div>
                  ) : (
                    <table>
                      <thead><tr><th>Tiquete</th><th>Producto</th><th className="num">Precio</th><th>Regla</th><th className="num">Monto</th><th>Factura vinculada</th><th>Fecha</th><th>Tipo</th><th>Estado</th></tr></thead>
                      <tbody>
                        {(data?.tiquetes || []).map((t: any) => (
                          <tr key={t.id}>
                            <td className="strong mono">{t.consecutivo}</td>
                            <td>{t.producto} × {t.cantidad}</td>
                            <td className="num mono">{fmt(t.precioUnitario)}</td>
                            <td>{t.resolucionPrecio?.regla || 'precio histórico'}</td>
                            <td className="num mono">{fmt(t.monto)}</td>
                            <td className="mono">{t.facturaConsecutivo || 'Por facturar'}</td>
                            <td className="mono">{new Date(t.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</td>
                            <td>{t.cobro || 'Efectivo'}</td>
                            <td><span className={t.estado === 'Anulada' ? 'chip gray' : 'chip green'}>{t.estado}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'rutas' && (
              <div className="a-panel on" data-a="rutas">
                <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <div className="kpi"><div className="l">Ruta</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{c.ruta || '—'}</div><div className="ins">asignada al cliente</div></div>
                  <div className="kpi"><div className="l">Condición</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{c.condicionPago || 'Contado'}</div><div className="ins">{c.precioEspecial ? `tarifa especial ₡${c.precioEspecial}` : 'tarifa estándar'}</div></div>
                  <div className="kpi"><div className="l">Documento</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{c.tipoDocumento}</div><div className="ins">{c.documentoId || '—'}</div></div>
                  <div className="kpi"><div className="l">Contacto</div><div className="v" style={{ fontSize: 15, paddingTop: 5 }}>{c.telefono || <span style={{ fontSize: 12 }}>sin teléfono</span>}</div><div className="ins">{c.email || 'sin email'}</div></div>
                </div>
                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Ubicación / punto de entrega</h4></div>
                    {c.direccion ? (
                      <div style={{ background: 'var(--status-info-soft)', borderRadius: 12, height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--status-info)', fontWeight: 800, fontSize: 11 }}>
                        <div style={{ fontSize: 20 }}>📍</div>
                        {c.direccion}<br />
                        <span className="mini" style={{ color: 'var(--text-primary)' }}>ruta: {c.ruta || 'sin asignar'}</span>
                      </div>
                    ) : (
                      <div className="empty">Sin dirección registrada</div>
                    )}
                    <div className="kv" style={{ marginTop: 8 }}><span>Entrega</span><b>{c.direccion || '—'}</b></div>
                    <div className="kv"><span>Punto en ruta</span><b>{c.ruta || '—'}</b></div>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Condiciones comerciales</h4></div>
                    <div className="kv"><span>Condición de pago</span><b>{c.condicionPago}</b></div>
                    <div className="kv"><span>Precio especial</span><b>{c.precioEspecial ? `₡${c.precioEspecial}` : 'Estándar'}</b></div>
                    <div className="kv"><span>Límite de crédito</span><b>{fmt(c.limiteCredito)}</b></div>
                    <div className="kv"><span>Saldo pendiente</span><b style={{ color: deuda > 0 ? 'var(--red)' : 'var(--brand)' }}>{fmt(c.saldoPendiente)}</b></div>
                  </div>
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'credito' && (
              <div className="a-panel on" data-a="credito">
                <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <div className="kpi"><div className="l">Límite</div><div className="v">{fmt(c.limiteCredito)}</div><div className="ins">línea de crédito</div></div>
                  <div className="kpi"><div className="l">Pendiente</div><div className="v">{fmt(c.saldoPendiente)}</div><div className="ins">{uso}% de uso</div></div>
                  <div className="kpi"><div className="l">Uso línea</div><div className="v" style={{ color: uso >= 80 ? 'var(--red)' : uso >= 50 ? 'var(--amber)' : 'var(--brand)' }}>{uso}%</div><div className="ins">alerta 80% · revisión 24h</div></div>
                  <div className="kpi"><div className="l">Facturas</div><div className="v">{k.facturasAbiertas ?? 0}</div><div className="ins">{k.vencidas || 0} vencidas</div></div>
                </div>
                <div className="panel" style={{ padding: 16, marginTop: 14 }}>
                  <div className="sect"><h4>Antigüedad de saldo</h4></div>
                  <div className="aging">
                    <div className="bucket"><div className="b">Al día</div><div className="m">{fmt(Number(c.saldoPendiente) * (1 - Math.min(1, vencidas)))}</div></div>
                    <div className="bucket"><div className="b">1–30 d</div><div className="m">{fmt(vencidas > 0 ? Number(c.saldoPendiente) * 0.5 : 0)}</div></div>
                    <div className="bucket"><div className="b">31–60 d</div><div className="m">{fmt(vencidas > 1 ? Number(c.saldoPendiente) * 0.25 : 0)}</div></div>
                    <div className="bucket"><div className="b">60+ d</div><div className="m">{fmt(vencidas > 2 ? Number(c.saldoPendiente) * 0.1 : 0)}</div></div>
                  </div>
                </div>
                <div className="panel" style={{ marginTop: 16 }}>
                  <div className="panel-head"><div className="panel-title">Facturas pendientes por cobrar</div></div>
                  {(data?.facturas || []).filter((f: any) => f.estado !== 'Pagada').length === 0 ? (
                    <div className="empty">Sin facturas pendientes · SLA estándar 5 días laborales</div>
                  ) : (
                    <table>
                      <thead><tr><th>Factura</th><th className="num">Monto</th><th className="num">Edad</th><th>Bucket</th></tr></thead>
                      <tbody>
                        {(data?.facturas || []).filter((f: any) => f.estado !== 'Pagada').map((f: any) => (
                          <tr key={f.id}>
                            <td className="strong mono">{f.consecutivo}</td>
                            <td className="num mono">{fmt(f.total)}</td>
                            <td className="num mono">{f.diasVencido}d</td>
                            <td><RiskChip estado={f.estado} diasVencido={f.diasVencido} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'precios' && (
              <div className="a-panel on" data-a="precios">
                <div className="panel" style={{ padding: 16 }}>
                  <div className="panel-title" style={{ marginBottom: 12 }}>Matriz de precios · excepciones del cliente</div>
                  <div className="info-note" style={{ marginTop: 4 }}>
                    Tarifa base para {c.condicionPago || 'Contado'}: {c.precioEspecial ? `₡${c.precioEspecial}` : 'Estándar'}. Las excepciones requieren autorización de Admin y vencen en la fecha indicada.
                  </div>
                  {currentUser.role === 'Admin' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <button className="btn sm brand" onClick={() => setShowExcForm(!showExcForm)}>
                      <Plus className="w-3.5 h-3.5" /> {showExcForm ? 'Cancelar' : 'Nueva excepción temporal'}
                    </button>
                  </div>}
                  {showExcForm && (
                    <div style={{ border: '1px solid var(--status-success)', background: 'var(--status-success-soft)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="field">
                          <label>Producto <span className="req">*</span></label>
                          <select value={formExc.productoId} onChange={e => setFormExc({ ...formExc, productoId: e.target.value })}>
                            <option value="">Seleccionar...</option>
                            {catalogo.filter(p => p.nombre.toLowerCase().includes('huevo')).map(p => (
                              <option key={p.id} value={p.id}>{p.nombre} — ₡{p.precioBase.toLocaleString()} base</option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Precio excepción (₡) <span className="req">*</span></label>
                          <input type="number" value={formExc.precioExcepcion || ''} placeholder="Precio especial"
                            onChange={e => setFormExc({ ...formExc, precioExcepcion: Number(e.target.value) })} />
                        </div>
                        <div className="field">
                          <label>Justificación <span className="req">*</span></label>
                          <input type="text" value={formExc.justificacion} placeholder="Motivo de la excepción"
                            onChange={e => setFormExc({ ...formExc, justificacion: e.target.value })} />
                        </div>
                        <div className="field"><label>Válida desde <span className="req">*</span></label><input type="date" value={formExc.fechaInicio} onChange={e => setFormExc({ ...formExc, fechaInicio: e.target.value })} /></div>
                        <div className="field"><label>Válida hasta <span className="req">*</span></label><input type="date" value={formExc.fechaFin} onChange={e => setFormExc({ ...formExc, fechaFin: e.target.value })} /></div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                        <button className="btn sm brand" onClick={agregarExcepcion}><Check className="w-3.5 h-3.5" /> Guardar</button>
                      </div>
                    </div>
                  )}
                  {(data?.excepciones || []).length === 0 ? (
                    <div className="empty">Sin excepciones de precio · tarifa {c.precioEspecial ? `especial ₡${c.precioEspecial}` : 'estándar'}</div>
                  ) : (
                    <table>
                      <thead><tr><th>Producto</th><th className="num">Base</th><th className="num">Cliente</th><th className="num">Delta</th><th>Aprobado por</th><th></th></tr></thead>
                      <tbody>
                        {(data?.excepciones || []).map((e: any) => (
                          <tr key={e.id}>
                            <td className="strong">{e.producto}</td>
                            <td className="num mono">{fmt(e.precioBase)}</td>
                            <td className="num mono">{fmt(e.precioExcepcion)}</td>
                            <td className="num mono" style={{ color: e.precioBase > e.precioExcepcion ? 'var(--blue)' : 'var(--brand)' }}>
                              {e.precioBase > 0 ? `${((e.precioExcepcion - e.precioBase) / e.precioBase * 100).toFixed(0)}%` : '—'}
                            </td>
                            <td>{e.aprobadoPor || '—'}<div className="mini">{e.fechaInicio || 'Histórica'} – {e.fechaFin || 'sin vencimiento'} · {e.estadoVigencia || e.estado}</div></td>
                            <td>{currentUser.role === 'Admin' && e.estado === 'Activa' && <button className="btn ico" onClick={() => eliminarExcepcion(e.id)} title="Desactivar excepción"><Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--red)' }} /></button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'notas' && (
              <div className="a-panel on" data-a="notas">
                <div className="panel" style={{ padding: 16 }}>
                  <div className="sect"><h4>Notas internas del cliente</h4></div>
                  {c.notas ? (
                    <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{c.notas}</div>
                  ) : (
                    <div className="empty">Sin notas registradas</div>
                  )}
                </div>
              </div>
            )}

            {!isLoading && activeTab === 'credito' && vencidas > 0 && (
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--amber)' }} />
                1 cuenta en gestión SLA (5 días laborales). Gestionar antes de volver a cobrar.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
