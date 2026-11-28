import React, { useState, useEffect } from 'react';
import { Wheat, Plus, AlertTriangle, CheckCircle, Droplets, TrendingDown, RefreshCw, X, Package } from 'lucide-react';
import { InventarioAlimento, ConsumoAlimento, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { sessionHeaders } from '../lib/session';

interface Props { currentUser: User; }
type TipoAlimento = { id: string; nombre: string; estado: 'Activo' | 'Archivado' };

export default function Alimento({ currentUser }: Props) {
  const [inventario, setInventario] = useState<InventarioAlimento[]>([]);
  const [consumos, setConsumos] = useState<ConsumoAlimento[]>([]);
  const [alertas, setAlertas] = useState<any>(null);
  const [galerones, setGalerones] = useState<any[]>([]);
  const [lotesAves, setLotesAves] = useState<any[]>([]);
  const [integridad, setIntegridad] = useState<any>(null);
  const [conteos, setConteos] = useState<any[]>([]);
  const [transferencias, setTransferencias] = useState<any[]>([]);
  const [tiposAlimento, setTiposAlimento] = useState<TipoAlimento[]>([]);
  const [mostrarConteo, setMostrarConteo] = useState(false);
  const [mostrarTransferencia, setMostrarTransferencia] = useState(false);
  const [formConteo, setFormConteo] = useState({ inventarioAlimentoId: '', cantidadFisica: '', responsable: '', observaciones: '' });
  const [formTransferencia, setFormTransferencia] = useState({ inventarioAlimentoId: '', ubicacionDestino: '', responsable: '', observaciones: '' });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isConsumo, setIsConsumo] = useState(false);
  const [tipoMovimientoAlimento, setTipoMovimientoAlimento] = useState<'Consumo' | 'Merma'>('Consumo');
  const [subTab, setSubTab] = useState<'inventario' | 'consumo' | 'alertas'>('inventario');

  const [formInv, setFormInv] = useState({
    tipoAlimento: '', proveedor: '', loteAlimento: '', siloUbicacion: 'Silo 1',
    cantidadRecibida: 0, unidad: 'kg', responsable: '', galeronAsociado: '', loteAvesAsociado: '', referenciaDocumentoOrigen: '', fechaDocumentoOrigen: '', montoDocumentoOrigen: '', monedaDocumentoOrigen: 'CRC'
  });
  const [formCons, setFormCons] = useState({
    inventarioAlimentoId: '', galeronId: '', loteAvesId: '', cantidadConsumida: 0, unidad: 'kg', responsable: '', observaciones: ''
  });

  const cargar = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const headers = sessionHeaders(currentUser.id);
      const [iRes, cRes, aRes, gRes, lRes, f3Res, conteosRes, transferenciasRes, tiposRes] = await Promise.all([
        fetch('/api/alimento', { headers }), fetch('/api/alimento/consumo', { headers }), fetch('/api/alimento/alertas', { headers }),
        fetch('/api/galerones', { headers }), fetch('/api/lotes', { headers }), fetch('/api/alimento/f3-integridad', { headers }), fetch('/api/alimento/conteos', { headers }), fetch('/api/alimento/transferencias', { headers }), fetch('/api/alimento/tipos', { headers })
      ]);
      const responses = [iRes, cRes, aRes];
      const failed = responses.find(r => !r.ok);
      if (failed) throw new Error(failed.status === 401 || failed.status === 403
        ? 'No tienes acceso al control de alimento con este perfil.'
        : `No se pudo cargar alimento (${failed.status}).`);
      const [inventarioData, consumosData, alertasData] = await Promise.all(responses.map(r => r.json()));
      const tiposData = await tiposRes.json();
      if (!tiposRes.ok) throw new Error(tiposData.error || `No se pudo cargar el catálogo de alimento (${tiposRes.status}).`);
      const tiposActivos = (Array.isArray(tiposData) ? tiposData : []).filter((tipo: TipoAlimento) => tipo.estado === 'Activo');
      setTiposAlimento(tiposActivos);
      setFormInv(prev => ({ ...prev, tipoAlimento: tiposActivos.some((tipo: TipoAlimento) => tipo.nombre === prev.tipoAlimento) ? prev.tipoAlimento : tiposActivos[0]?.nombre || '' }));
      setInventario(Array.isArray(inventarioData) ? inventarioData : []);
      setConsumos(Array.isArray(consumosData) ? consumosData : []);
      setAlertas(alertasData && typeof alertasData === 'object' ? alertasData : {});
      if (gRes.ok) setGalerones(await gRes.json());
      if (lRes.ok) setLotesAves(await lRes.json());
      if (f3Res.ok) setIntegridad(await f3Res.json());
      if (conteosRes.ok) { const rows = await conteosRes.json(); setConteos(Array.isArray(rows) ? rows : []); }
      if (transferenciasRes.ok) { const rows = await transferenciasRes.json(); setTransferencias(Array.isArray(rows) ? rows : []); }
    } catch (e: any) { const message = e?.message || 'No se pudieron cargar los datos de alimento.'; setLoadError(message); toast.error(message); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const crearInventario = async () => {
    if (!formInv.tipoAlimento || !formInv.cantidadRecibida || !formInv.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/alimento', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify(formInv)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar ingreso'); }
      toast.success('Ingreso de alimento registrado');
      setIsCreating(false);
      setFormInv({ tipoAlimento: tiposAlimento[0]?.nombre || '', proveedor: '', loteAlimento: '', siloUbicacion: 'Silo 1', cantidadRecibida: 0, unidad: 'kg', responsable: '', galeronAsociado: '', loteAvesAsociado: '', referenciaDocumentoOrigen: '', fechaDocumentoOrigen: '', montoDocumentoOrigen: '', monedaDocumentoOrigen: 'CRC' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const registrarConsumo = async () => {
    if (!formCons.inventarioAlimentoId || !formCons.cantidadConsumida || !formCons.responsable || (tipoMovimientoAlimento === 'Merma' && !formCons.observaciones.trim())) { toast.error(tipoMovimientoAlimento === 'Merma' ? 'Seleccione lote, cantidad y responsable; describa la causa de la merma.' : 'Seleccione lote, cantidad y responsable.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/alimento/consumo', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ ...formCons, tipoMovimiento: tipoMovimientoAlimento })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar consumo'); }
      toast.success('Consumo registrado');
      setIsConsumo(false);
      setTipoMovimientoAlimento('Consumo');
      setFormCons({ inventarioAlimentoId: '', galeronId: '', loteAvesId: '', cantidadConsumida: 0, unidad: 'kg', responsable: '', observaciones: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const totalInventario = inventario.filter(i => i.estado === 'Activo').reduce((a, i) => a + Number(i.cantidadActual), 0);
  const lotesDisponibles = lotesAves.filter(l => l.estado === 'Activo' && (!formCons.galeronId || l.galeronId === formCons.galeronId));
  const exportarIntegridad = () => {
    if (!integridad) return;
    const rows = [...(integridad.saldos || []).map((r: any) => ({ grupo: 'Saldo de alimento', ...r })), ...(integridad.pendientes || []).map((r: any) => ({ grupo: 'Datos de trazabilidad pendientes', detalle: r.detalle, tipoAlimento: r.tipo, inventarioId: r.inventarioId, loteAlimento: r.loteAlimento })), ...(integridad.consumosSinDimension || []).map((r: any) => ({ grupo: 'Consumo sin asignación', ...r })), ...conteos.map((c: any) => ({ grupo: 'Conteo físico', fecha: c.fecha, usuarioId: c.usuarioId, detalle: c.motivo, ...(c.conteo || {}) })), ...transferencias.map((t: any) => ({ grupo: 'Transferencia de alimento', fecha: t.fecha, usuarioId: t.usuarioId, detalle: t.motivo, ...(t.traslado || {}) }))];
    const columns = [...new Set(rows.flatMap((r: any) => Object.keys(r)))];
    const cell = (v: any) => { if (typeof v === 'number' && Number.isFinite(v)) return String(v); let s = v == null ? '' : String(v); if (/^[\s\u0000-\u001f]*[=+@\-]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    const csv = `\uFEFF${[columns, ...rows.map((r: any) => columns.map(c => r[c] ?? ''))].map(r => r.map(cell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `integridad-alimento-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const registrarConteoFisico = async () => {
    if (!formConteo.inventarioAlimentoId || formConteo.cantidadFisica === '' || !formConteo.responsable.trim() || !formConteo.observaciones.trim()) { toast.error('Complete lote, cantidad física, responsable y observación.'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/alimento/conteos', { method: 'POST', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify({ ...formConteo, cantidadFisica: Number(formConteo.cantidadFisica) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo guardar el conteo.');
      toast.success(Math.abs(data.diferencia) > 0.001 ? `Conteo guardado; diferencia de ${data.diferencia} ${data.unidad} requiere revisión.` : 'Conteo físico coincide con el saldo del sistema.');
      setFormConteo({ inventarioAlimentoId: '', cantidadFisica: '', responsable: '', observaciones: '' }); setMostrarConteo(false); await cargar();
    } catch (error: any) { toast.error(error.message || 'No se pudo guardar el conteo.'); }
    setLoading(false);
  };

  const registrarTransferencia = async () => {
    const item = inventario.find(i => i.id === formTransferencia.inventarioAlimentoId);
    if (!item || !formTransferencia.ubicacionDestino || !formTransferencia.responsable.trim()) { toast.error('Seleccione el lote y destino, e indique responsable.'); return; }
    if (item.siloUbicacion === formTransferencia.ubicacionDestino) { toast.error('Seleccione una ubicación diferente a la actual.'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/alimento/transferencias', { method: 'POST', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify(formTransferencia) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo registrar el traslado.');
      toast.success(`Saldo completo trasladado a ${data.traslado.destino}.`);
      setFormTransferencia({ inventarioAlimentoId: '', ubicacionDestino: '', responsable: '', observaciones: '' }); setMostrarTransferencia(false); await cargar();
    } catch (error: any) { toast.error(error.message || 'No se pudo registrar el traslado.'); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--brand-danger)', background: 'var(--status-danger-soft)', color: 'var(--text-primary)' }}><span>{loadError}</span><button onClick={cargar} className="font-bold underline">Reintentar</button></div>}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)' }}><Wheat className="w-6 h-6" style={{ color: 'var(--brand-secondary)' }} /></div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">Control de Alimento</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Inventario, consumo y silos</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
          <button onClick={() => setIsCreating(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-secondary)' }}>
            <Plus className="w-4 h-4" /><span>Nuevo Ingreso</span>
          </button>
          <button onClick={() => setIsConsumo(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
            <TrendingDown className="w-4 h-4" /><span>Registrar Consumo</span>
          </button>
        </div>
      </div>

      {/* Resumen cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Stock Total</p>
          <p className="text-2xl font-black mt-1" style={{ color: 'var(--brand-secondary)' }}>{totalInventario.toLocaleString()} kg</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Silos Activos</p>
          <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">{inventario.filter(i => i.estado === 'Activo').length}</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Bajo Inventario</p>
          <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{alertas?.bajoInventario?.length || 0}</p>
        </div>
      </div>

      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6">
        {[['inventario', 'Inventario'], ['consumo', 'Consumo'], ['alertas', 'Alertas']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k as any)}
            className={cn("pb-3 text-sm font-bold border-b-2 transition-colors",
              subTab === k ? "text-stone-800 border-b-2" : "text-stone-400 border-transparent hover:text-stone-600")}
              style={subTab === k ? { borderColor: 'var(--brand-secondary)', color: 'var(--brand-secondary-dark)' } : {}}>{l}</button>
        ))}
      </div>

      {subTab === 'inventario' && (
        <>
        {integridad && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">F3 · Control de alimento y trazabilidad</h3><p className="text-sm">Comprueba recibido menos consumo/merma y compara conteos físicos. No calcula costo.</p></div><div className="flex gap-2"><button type="button" onClick={() => setMostrarConteo(v => !v)} className="rounded-lg border px-3 py-2 text-xs font-bold">{mostrarConteo ? 'Cancelar conteo' : 'Registrar conteo físico'}</button><button type="button" onClick={() => setMostrarTransferencia(v => !v)} className="rounded-lg border px-3 py-2 text-xs font-bold">{mostrarTransferencia ? 'Cancelar traslado' : 'Trasladar lote'}</button><button type="button" onClick={exportarIntegridad} className="rounded-lg border px-3 py-2 text-xs font-bold">Descargar revisión CSV</button></div></div>{mostrarConteo && <div className="grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 dark:bg-neutral-800"><label className="text-xs font-semibold">Lote de alimento<select value={formConteo.inventarioAlimentoId} onChange={e => setFormConteo({ ...formConteo, inventarioAlimentoId: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700"><option value="">Seleccione lote</option>{inventario.map(i => <option key={i.id} value={i.id}>{i.tipoAlimento} · {i.loteAlimento || 'sin lote'} · {i.siloUbicacion}</option>)}</select></label><label className="text-xs font-semibold">Cantidad física ({inventario.find(i => i.id === formConteo.inventarioAlimentoId)?.unidad || 'unidad'})<input type="number" min="0" step="0.001" value={formConteo.cantidadFisica} onChange={e => setFormConteo({ ...formConteo, cantidadFisica: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Responsable del conteo<input value={formConteo.responsable} onChange={e => setFormConteo({ ...formConteo, responsable: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Observación / referencia del conteo<input value={formConteo.observaciones} onChange={e => setFormConteo({ ...formConteo, observaciones: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><button type="button" disabled={loading} onClick={registrarConteoFisico} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white sm:col-span-2">Guardar conteo para revisión</button><p className="text-xs text-amber-800 sm:col-span-2">El conteo queda en historial como evidencia observada. No modifica el saldo ni genera un asiento.</p></div>}{mostrarTransferencia && <div className="grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 dark:bg-neutral-800"><label className="text-xs font-semibold">Lote / silo actual<select value={formTransferencia.inventarioAlimentoId} onChange={e => { const item = inventario.find(i => i.id === e.target.value); setFormTransferencia({ ...formTransferencia, inventarioAlimentoId: e.target.value, ubicacionDestino: item?.siloUbicacion === 'Silo 1' ? 'Silo 2' : 'Silo 1' }); }} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700"><option value="">Seleccione lote</option>{inventario.filter(i => i.estado === 'Activo').map(i => <option key={i.id} value={i.id}>{i.tipoAlimento} · {i.loteAlimento || 'sin lote'} · {i.siloUbicacion} · {i.cantidadActual} {i.unidad}</option>)}</select></label><label className="text-xs font-semibold">Destino<select value={formTransferencia.ubicacionDestino} onChange={e => setFormTransferencia({ ...formTransferencia, ubicacionDestino: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700"><option value="">Seleccione ubicación</option>{['Silo 1', 'Silo 2', 'Silo 3', 'Bodega Alimento'].map(s => <option key={s} value={s} disabled={s === inventario.find(i => i.id === formTransferencia.inventarioAlimentoId)?.siloUbicacion}>{s}</option>)}</select></label><label className="text-xs font-semibold">Responsable<input value={formTransferencia.responsable} onChange={e => setFormTransferencia({ ...formTransferencia, responsable: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Observaciones<input value={formTransferencia.observaciones} onChange={e => setFormTransferencia({ ...formTransferencia, observaciones: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><button type="button" disabled={loading} onClick={registrarTransferencia} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white sm:col-span-2">Trasladar saldo completo</button><p className="text-xs text-amber-800 sm:col-span-2">Mueve todo el saldo del registro de lote. No se admite traslado parcial en este flujo y el total global permanece igual.</p></div>}<div className="grid gap-2 sm:grid-cols-5 text-sm"><div className="rounded-lg bg-white p-3 dark:bg-neutral-800"><small>Lotes de alimento</small><b className="block text-xl">{integridad.resumen?.lotesAlimento}</b></div><div className="rounded-lg bg-white p-3 dark:bg-neutral-800"><small>Saldos con diferencia</small><b className="block text-xl">{integridad.resumen?.saldosConDiferencia}</b></div><div className="rounded-lg bg-white p-3 dark:bg-neutral-800"><small>Ingresos con datos pendientes</small><b className="block text-xl">{integridad.resumen?.ingresosConDatosTrazabilidadPendientes}</b></div><div className="rounded-lg bg-white p-3 dark:bg-neutral-800"><small>Consumos sin galerón/lote</small><b className="block text-xl">{integridad.resumen?.consumosSinAsignacionCompleta}</b></div><div className="rounded-lg bg-white p-3 dark:bg-neutral-800"><small>Sin soporte de compra</small><b className="block text-xl">{integridad.resumen?.sinDocumentoCompra}</b></div></div>{integridad.saldos?.some((x: any) => x.estado !== 'Conciliado') && <details className="rounded-lg border bg-white p-3 dark:bg-neutral-800"><summary className="cursor-pointer text-sm font-bold">Revisar lotes con diferencia de saldo</summary><ul className="mt-2 space-y-1 text-xs">{integridad.saldos.filter((x: any) => x.estado !== 'Conciliado').slice(0, 50).map((x: any) => <li key={x.id}>{x.tipoAlimento} · lote {x.loteAlimento || 'sin lote'} · esperado {x.saldoEsperado} {x.unidad} / actual {x.saldoActual} {x.unidad} · diferencia {x.diferencia}</li>)}</ul></details>}<details className="rounded-lg border bg-white p-3 dark:bg-neutral-800"><summary className="cursor-pointer text-sm font-bold">Historial de traslados ({transferencias.length})</summary>{transferencias.length ? <div className="mt-2 space-y-2">{transferencias.slice(0, 20).map(t => <div key={t.id} className="border-b pb-2 text-xs"><b>{t.traslado?.loteAlimento || t.traslado?.alimento}</b> · {t.traslado?.origen} → {t.traslado?.destino} · {t.traslado?.saldoTrasladado} {t.traslado?.unidad} · {t.traslado?.responsable} · {new Date(t.fecha).toLocaleString()}</div>)}</div> : <p className="mt-2 text-xs text-neutral-500">Aún no hay traslados.</p>}</details><details className="rounded-lg border bg-white p-3 dark:bg-neutral-800"><summary className="cursor-pointer text-sm font-bold">Historial de conteos físicos ({conteos.length})</summary>{conteos.length ? <div className="mt-2 space-y-2">{conteos.slice(0, 20).map(c => <div key={c.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-xs"><span>{c.conteo?.loteAlimento || c.conteo?.inventarioAlimentoId} · {c.conteo?.cantidadFisica} {c.conteo?.unidad} contado por {c.conteo?.responsable} · {new Date(c.fecha).toLocaleString()}</span><b className={Math.abs(Number(c.conteo?.diferencia || 0)) > 0.001 ? 'text-amber-700' : 'text-green-700'}>Diferencia {c.conteo?.diferencia} {c.conteo?.unidad}</b></div>)}</div> : <p className="mt-2 text-xs text-neutral-500">Aún no se han guardado conteos físicos.</p>}</details><p className="text-xs text-amber-900 dark:text-amber-200">El monto de factura se conserva como fuente. Falta que el CPA defina su tratamiento para el costo de producción; no se calcula automáticamente.</p></section>}
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Tipo / proveedor</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Lote / ubicación</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Galerón / lote aves</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Recibido</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Actual</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Estado</th></tr>
            </thead>
            <tbody>
              {inventario.map(i => (
                <tr key={i.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{i.tipoAlimento}<small className="block text-neutral-500">{i.proveedor || 'Proveedor no registrado'}</small></td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{i.loteAlimento || 'Lote no registrado'}<small className="block">{i.siloUbicacion || 'Ubicación sin registrar'}</small><small className="block">{i.referenciaDocumentoOrigen ? `${i.referenciaDocumentoOrigen} · ${i.monedaDocumentoOrigen} ${Number(i.montoDocumentoOrigen).toLocaleString()}` : 'Sin soporte de compra'}</small></td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{galerones.find(g => g.id === i.galeronAsociado)?.nombre || 'Stock común'}<small className="block">{lotesAves.find(l => l.id === i.loteAvesAsociado)?.linea_genetica || ''}</small></td>
                  <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">{Number(i.cantidadRecibida).toLocaleString()} {i.unidad}</td>
                  <td className={cn("px-4 py-3 text-right font-bold", i.cantidadActual < i.cantidadRecibida * 0.2 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
                    {Number(i.cantidadActual).toLocaleString()} {i.unidad}
                  </td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded-full text-xs font-bold", i.estado === 'Activo' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300")}>{i.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {inventario.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin inventario de alimento</p>}
        </div>
        </>
      )}

      {subTab === 'consumo' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Fecha</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Movimiento / alimento</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Galerón / lote de aves</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Cantidad</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Responsable</th></tr>
            </thead>
            <tbody>
              {consumos.map(c => (
                <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{c.fecha}</td>
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{c.tipoMovimiento === 'Merma' ? 'Merma · ' : 'Consumo · '}{inventario.find(i => i.id === c.inventarioAlimentoId)?.tipoAlimento || 'Inventario no asociado'}<small className="block text-neutral-500">{inventario.find(i => i.id === c.inventarioAlimentoId)?.loteAlimento || 'Sin lote de proveedor'} · {c.observaciones || ''}</small></td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{galerones.find(g => g.id === c.galeronId)?.nombre || 'Sin galerón'}<small className="block">{lotesAves.find(l => l.id === c.loteAvesId)?.linea_genetica || 'Sin lote aves'}</small></td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 dark:text-white">{Number(c.cantidadConsumida)} {c.unidad}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{c.responsable}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {consumos.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin consumos registrados</p>}
        </div>
      )}

      {subTab === 'alertas' && (
        <div className="space-y-3">
          {alertas?.bajoInventario?.map((i: any) => (
            <div key={i.id} className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-secondary)' }} />
              <div><p className="font-bold text-stone-800">{i.tipoAlimento} — {i.siloUbicacion}</p>
                <p className="text-sm" style={{ color: 'var(--brand-secondary)' }}>Stock: {Number(i.cantidadActual)} {i.unidad} ({Math.round((i.cantidadActual / i.cantidadRecibida) * 100)}%)</p></div>
            </div>
          ))}
          {(!alertas?.bajoInventario || alertas.bajoInventario.length === 0) && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 dark:text-green-400 mx-auto mb-2" />
              <p className="font-bold text-green-800 dark:text-green-300">Todos los silos con stock suficiente</p>
            </div>
          )}
        </div>
      )}

      {/* Modal crear inventario */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Ingreso de Alimento</h3>
              <button onClick={() => setIsCreating(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo de Alimento *</label>
                <select required value={formInv.tipoAlimento} onChange={e => setFormInv({ ...formInv, tipoAlimento: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccione un tipo</option>
                  {tiposAlimento.map(t => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
                </select></div>
              {tiposAlimento.length === 0 && <p className="text-sm text-amber-800 dark:text-amber-200">Agrega y activa un tipo de alimento en Administración → Configuración para habilitar nuevos ingresos.</p>}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Proveedor</label>
                  <input value={formInv.proveedor} onChange={e => setFormInv({ ...formInv, proveedor: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Lote</label>
                  <input value={formInv.loteAlimento} onChange={e => setFormInv({ ...formInv, loteAlimento: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400">Asignar a galerón (opcional)<select value={formInv.galeronAsociado} onChange={e => setFormInv({ ...formInv, galeronAsociado: e.target.value, loteAvesAsociado: '' })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-neutral-700"><option value="">Stock común</option>{galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}</select></label><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400">Lote de aves (opcional)<select value={formInv.loteAvesAsociado} onChange={e => setFormInv({ ...formInv, loteAvesAsociado: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-neutral-700"><option value="">Sin asignar</option>{lotesAves.filter(l => l.estado === 'Activo' && (!formInv.galeronAsociado || l.galeronId === formInv.galeronAsociado)).map(l => <option key={l.id} value={l.id}>{l.linea_genetica} · {l.fecha_ingreso}</option>)}</select></label></div>
              <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-bold">Soporte de compra (opcional)</summary><p className="mt-1 text-xs text-neutral-500">Capture el dato tal como aparece en la factura del proveedor. El sistema no calcula costo unitario ni tratamiento de impuestos.</p><div className="mt-2 grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Número/referencia<input value={formInv.referenciaDocumentoOrigen} onChange={e => setFormInv({ ...formInv, referenciaDocumentoOrigen: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Fecha<input type="date" value={formInv.fechaDocumentoOrigen} onChange={e => setFormInv({ ...formInv, fechaDocumentoOrigen: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Monto total documento<input type="number" min="0" step="0.01" value={formInv.montoDocumentoOrigen} onChange={e => setFormInv({ ...formInv, montoDocumentoOrigen: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700" /></label><label className="text-xs font-semibold">Moneda<select value={formInv.monedaDocumentoOrigen} onChange={e => setFormInv({ ...formInv, monedaDocumentoOrigen: e.target.value })} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-neutral-700"><option value="CRC">CRC</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label></div></details>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Silo/Ubicación</label>
                  <select value={formInv.siloUbicacion} onChange={e => setFormInv({ ...formInv, siloUbicacion: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    {['Silo 1', 'Silo 2', 'Silo 3', 'Bodega Alimento'].map(s => <option key={s}>{s}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cantidad (kg) *</label>
                  <input type="number" value={formInv.cantidadRecibida || ''} onChange={e => setFormInv({ ...formInv, cantidadRecibida: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                <input value={formInv.responsable} onChange={e => setFormInv({ ...formInv, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <button onClick={crearInventario} disabled={!tiposAlimento.length || !formInv.tipoAlimento} className="w-full text-white py-2.5 rounded-lg font-bold disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--brand-secondary)' }}>Registrar Ingreso</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal consumo */}
      {isConsumo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">{tipoMovimientoAlimento === 'Merma' ? 'Registrar merma de alimento' : 'Registrar Consumo'}</h3>
              <button onClick={() => setIsConsumo(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setTipoMovimientoAlimento('Consumo')} className={cn('rounded-lg border px-3 py-2 text-sm font-bold', tipoMovimientoAlimento === 'Consumo' && 'border-blue-500 bg-blue-50 dark:bg-blue-950/40')}>Consumo</button><button type="button" onClick={() => setTipoMovimientoAlimento('Merma')} className={cn('rounded-lg border px-3 py-2 text-sm font-bold', tipoMovimientoAlimento === 'Merma' && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40')}>Merma</button></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Inventario *</label>
                <select value={formCons.inventarioAlimentoId} onChange={e => { const item = inventario.find(i => i.id === e.target.value); setFormCons({ ...formCons, inventarioAlimentoId: e.target.value, unidad: item?.unidad || 'kg' }); }} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {inventario.filter(i => i.estado === 'Activo').map(i => <option key={i.id} value={i.id}>{i.tipoAlimento} — lote {i.loteAlimento || 'sin lote'} · {i.siloUbicacion} ({i.cantidadActual} {i.unidad})</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400">Galerón<select value={formCons.galeronId} onChange={e => setFormCons({ ...formCons, galeronId: e.target.value, loteAvesId: '' })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-neutral-700"><option value="">Seleccione</option>{galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}</select></label><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400">Lote de aves<select value={formCons.loteAvesId} onChange={e => setFormCons({ ...formCons, loteAvesId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-neutral-700"><option value="">Seleccione</option>{lotesDisponibles.map(l => <option key={l.id} value={l.id}>{l.linea_genetica} · {l.fecha_ingreso}</option>)}</select></label></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cantidad Consumida ({formCons.unidad}) *</label>
                <input type="number" value={formCons.cantidadConsumida || ''} onChange={e => setFormCons({ ...formCons, cantidadConsumida: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                <input value={formCons.responsable} onChange={e => setFormCons({ ...formCons, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">{tipoMovimientoAlimento === 'Merma' ? 'Causa / observación *' : 'Observaciones'}</label><textarea value={formCons.observaciones} onChange={e => setFormCons({ ...formCons, observaciones: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" rows={2} /></div>
              <button onClick={registrarConsumo} className="w-full text-white py-2.5 rounded-lg font-bold" style={{ background: tipoMovimientoAlimento === 'Merma' ? 'var(--brand-secondary)' : 'var(--brand-primary)' }}>{tipoMovimientoAlimento === 'Merma' ? 'Guardar merma' : 'Registrar Consumo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
