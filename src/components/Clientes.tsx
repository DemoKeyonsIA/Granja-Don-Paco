import React, { useState, useEffect, useMemo } from 'react';
import { Search, Download, Plus, Check, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { Cliente, User } from '../types';
import { rolesEfectivos } from '../nav/modulos';
import Cliente360 from './Cliente360';
import { sessionHeaders } from '../lib/session';
import './gcrm.css';

interface ClientesProps {
  currentUser: User;
}

interface CarteraRow {
  id: string;
  nombre: string;
  tipoDocumento?: string;
  documentoId?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  ruta?: string;
  condicionPago?: string;
  precioEspecial?: number | null;
  limiteCredito?: number;
  saldoPendiente?: number;
  notas?: string;
  segmento: 'A' | 'B' | 'C';
  comportamiento: string;
  pedidos90d: number;
  ticketPromedio: number;
  monto90d: number;
  venta12m: number;
  usoLinea: number;
  score: number;
  riesgo: 'Bajo' | 'Medio' | 'Alto';
  diasVencido: number;
  vencido: number;
  facturas30d: number;
  tiquetes30d: number;
  ultimaCompra: string | null;
}

const fmt = (n: any) => `₡${Math.round(Number(n || 0)).toLocaleString()}`;

const PROVINCIAS = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];

const COMBO: Record<string, { chip: string }> = {
  'Puntual': { chip: 'green' },
  'Atraso leve': { chip: 'amber' },
  'Atraso frecuente': { chip: 'orange' },
  'Crónico': { chip: 'red' },
};

const NOMBRE_REGLAS = {
  'Puntual': 'Puntual (≤3d)',
  'Atraso leve': 'Atraso leve (1–15d)',
  'Atraso frecuente': 'Atraso frecuente (16–30d)',
  'Crónico': 'Crónico (30d+)',
};

const CADENCIA: Record<string, string[]> = {
  'Puntual': ['Recordatorio 3d antes + agradecimiento post-pago', 'Email auto', '—', 'Upsell de línea si usan <50%'],
  'Atraso leve': ['D0 aviso · D7 email + check-in personal', 'Email + WhatsApp', 'Vendedor ruta', 'Ofrecer enlace de pago'],
  'Atraso frecuente': ['D14 llamada · D21 escalada a jefe crédito', 'Llamada + email', 'Cobranza', 'Tope de línea al 60%'],
  'Crónico': ['L4 carta formal · L5 bloqueo + gerencia', 'Carta + llamada', 'Jefe crédito', 'Bloqueo al 80% sin pago parcial'],
};

function diasTranscurridos(fechaISO: string, ref?: number) {
  if (!fechaISO) return 0;
  return Math.max(0, Math.floor(((ref || Date.now()) - new Date(fechaISO).getTime()) / 86400000));
}

export default function Clientes({ currentUser }: ClientesProps) {
  const rolesActuales = rolesEfectivos(currentUser.role, currentUser.roles);
  const esAdmin = rolesActuales.includes('Admin');
  const esVendedor = rolesActuales.includes('Comercial');
  const canViewAnalysis = rolesActuales.includes('Admin') || rolesActuales.includes('Socio');
  const [view, setView] = useState<'cartera' | 'analisis'>(canViewAnalysis ? 'analisis' : 'cartera');
  const [aTab, setATab] = useState<'hoy' | 'seg' | 'reglas' | 'politica'>('hoy');

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cartera, setCartera] = useState<CarteraRow[]>([]);
  const [analisis, setAnalisis] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [segmentHelpOpen, setSegmentHelpOpen] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCliente, setNewCliente] = useState<Partial<Cliente>>({
    nombre: '',
    tipo_documento: 'Fisica',
    documento_id: '',
    actividad_economica: '',
    telefono: '',
    email: '',
    direccion: '',
    provincia: '',
    canton: '',
    distrito: '',
    ruta: '',
    condicion_pago: 'Contado',
    precio_especial: null,
    limite_credito: 0,
    notas: ''
  });

  const [rutas, setRutas] = useState<any[]>([]);
  const [solicitudesCliente, setSolicitudesCliente] = useState<any[]>([]);
  const [drawerCliente, setDrawerCliente] = useState<Cliente | null>(null);
  const rutaAsignadaVendedor = esVendedor && rutas.length === 1 ? rutas[0] : null;

  const rutasSelect = useMemo(() => {
    const existentes = new Set((rutas as any[]).map(r => r.nombre));
    const extra = !esVendedor && newCliente.ruta && !existentes.has(newCliente.ruta) ? [{ id: 'actual', nombre: newCliente.ruta }] : [];
    return [...extra, ...(rutas as any[])];
  }, [rutas, newCliente.ruta, esVendedor]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [resCliente, resCartera, resAnalisis, resRutas, resSolicitudes] = await Promise.all([
        esVendedor ? Promise.resolve(null) : fetch('/api/clientes', { headers: headersUsuario() }),
        fetch('/api/clientes/cartera', { headers: headersUsuario() }),
        canViewAnalysis ? fetch('/api/clientes/analisis', { headers: headersUsuario() }) : Promise.resolve(null),
        fetch('/api/rutas', { headers: headersUsuario() }),
        esVendedor ? fetch('/api/clientes/solicitudes', { headers: headersUsuario() }) : Promise.resolve(null),
      ]);
      if (resCliente?.ok) setClientes(await resCliente.json());
      if (resCartera.ok) { const d = await resCartera.json(); setCartera(d.clientes || []); }
      if (resAnalisis?.ok) setAnalisis(await resAnalisis.json());
      if (resRutas.ok) setRutas(await resRutas.json());
      if (resSolicitudes?.ok) setSolicitudesCliente(await resSolicitudes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (!canViewAnalysis) setView('cartera'); }, [canViewAnalysis]);

  const canEdit = esAdmin;

  const headersUsuario = (json = false) => sessionHeaders(currentUser.id, json);

  const resetForm = () => {
    setNewCliente({
      nombre: '', tipo_documento: 'Fisica', documento_id: '', actividad_economica: '', telefono: '', email: '', direccion: '',
      provincia: '', canton: '', distrito: '',
      ruta: '', condicion_pago: 'Contado', precio_especial: null, limite_credito: 0, notas: ''
    });
  };

  const startEdit = (cliente: Cliente) => {
    setEditingId(cliente.id);
    setNewCliente({
      nombre: cliente.nombre,
      tipo_documento: cliente.tipo_documento || 'Fisica',
      documento_id: cliente.documento_id || '',
      actividad_economica: cliente.actividad_economica || '',
      telefono: cliente.telefono || '',
      email: cliente.email || '',
      direccion: cliente.direccion || '',
      provincia: cliente.provincia || '',
      canton: cliente.canton || '',
      distrito: cliente.distrito || '',
      ruta: cliente.ruta || '',
      condicion_pago: cliente.condicion_pago || 'Contado',
      precio_especial: cliente.precio_especial,
      limite_credito: cliente.limite_credito || 0,
      notas: cliente.notas || ''
    });
    setIsAdding(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCliente.nombre) return;
    if (esVendedor && !rutaAsignadaVendedor) {
      toast.error(rutas.length > 1
        ? 'Tu cuenta debe tener una sola ruta asignada para solicitar un cliente.'
        : 'No tienes una ruta asignada. Solicita a Administración que te asigne una antes de pedir el alta.');
      return;
    }
    try {
      const res = await fetch(esVendedor ? '/api/clientes/solicitudes' : '/api/clientes', {
        method: 'POST', headers: headersUsuario(true),
        body: JSON.stringify(esVendedor
          ? { ...newCliente, ruta: rutaAsignadaVendedor.nombre }
          : newCliente)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (esVendedor ? 'No se pudo enviar la solicitud' : 'Error al crear cliente'));
      await fetchData();
      setIsAdding(false);
      resetForm();
      toast.success(esVendedor ? 'Solicitud enviada a Administración' : 'Cliente creado');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      const res = await fetch(`/api/clientes/${editingId}`, {
        method: 'PUT', headers: headersUsuario(true),
        body: JSON.stringify(newCliente)
      });
      if (!res.ok) throw new Error('Error al actualizar cliente');
      await fetchData();
      setEditingId(null);
      setIsAdding(false);
      resetForm();
      toast.success('Cliente actualizado');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Archivar este cliente? Se conservará su historial y no aparecerá en nuevas ventas.')) return;
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'DELETE', headers: headersUsuario() });
      if (!res.ok) throw new Error('Error al eliminar');
      await fetchData();
      toast.success('Cliente archivado');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtrarCartera = useMemo(() => {
    const s = searchTerm.toLowerCase();
    if (!s) return cartera;
    return cartera.filter(c =>
      c.nombre.toLowerCase().includes(s) ||
      (c.ruta || '').toLowerCase().includes(s) ||
      (c.documentoId || '').toLowerCase().includes(s) ||
      (c.telefono || '').includes(s)
    );
  }, [cartera, searchTerm]);

  const exportCSV = () => {
    const rows = [['Cliente', 'Ruta', 'Segmento', 'Comportamiento', 'Pedidos 90d', 'Ticket prom', 'Uso línea %', 'Score', 'Riesgo', 'Saldo'], ...filtrarCartera.map((c: any) => [
      c.nombre, c.ruta || '', c.segmento, c.comportamiento, c.pedidos90d, fmt(c.ticketPromedio), `${c.usoLinea}%`, c.score, c.riesgo, fmt(c.saldoPendiente)
    ])];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cartera-granja-don-paco-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Cartera exportada (CSV)');
  };

  const comportamientoStats = useMemo(() => {
    const map: Record<string, { cuentas: number; vencido: number }> = {
      'Puntual': { cuentas: 0, vencido: 0 }, 'Atraso leve': { cuentas: 0, vencido: 0 },
      'Atraso frecuente': { cuentas: 0, vencido: 0 }, 'Crónico': { cuentas: 0, vencido: 0 },
    };
    for (const c of cartera) {
      const k = map[c.comportamiento] ? c.comportamiento : 'Puntual';
      map[k].cuentas += 1;
      map[k].vencido += Number(c.vencido || 0);
    }
    return map;
  }, [cartera]);

  const matrizSegmento = useMemo(() => {
    const m: Record<string, Record<string, number>> = { A: { Puntual: 0, 'Atraso leve': 0, 'Atraso frecuente': 0, 'Crónico': 0 }, B: { Puntual: 0, 'Atraso leve': 0, 'Atraso frecuente': 0, 'Crónico': 0 }, C: { Puntual: 0, 'Atraso leve': 0, 'Atraso frecuente': 0, 'Crónico': 0 } };
    for (const c of cartera) {
      const seg = m[c.segmento] ? c.segmento : 'C';
      const k = m[seg][c.comportamiento] !== undefined ? c.comportamiento : 'Puntual';
      m[seg][k] += 1;
    }
    return m;
  }, [cartera]);

  const scorePromedio = useMemo(() => {
    const scores = cartera.map(c => Number(c.score)).filter(Number.isFinite);
    if (scores.length === 0) return '—';
    return Math.round(scores.reduce((a, score) => a + score, 0) / scores.length);
  }, [cartera]);

  const mejoresVenta = useMemo(() => cartera.slice().sort((a, b) => b.venta12m - a.venta12m).slice(0, 5), [cartera]);
  const maxVenta5 = mejoras => Math.max(1, ...mejoras.map(c => c.venta12m));
  const top10 = useMemo(() => cartera.slice().sort((a, b) => b.venta12m - a.venta12m).slice(0, 10), [cartera]);
  const maxVenta10 = Math.max(1, ...top10.map(c => c.venta12m));
  const conVenta = useMemo(() => cartera.filter(c => c.venta12m > 0), [cartera]);
  const concentracionTop3 = useMemo(() => {
    const total = conVenta.reduce((a, c) => a + c.venta12m, 0);
    const top3 = conVenta.slice().sort((a, b) => b.venta12m - a.venta12m).slice(0, 3).reduce((a, c) => a + c.venta12m, 0);
    return total > 0 ? Math.round((top3 / total) * 100) : 0;
  }, [conVenta]);
  const topN = Math.min(3, conVenta.length);

  const riesgoBars = (c: CarteraRow) => {
    const p = Math.max(0, Math.min(100, c.usoLinea));
    const color = c.riesgo === 'Alto' ? 'var(--red)' : c.riesgo === 'Medio' ? 'var(--amber)' : c.usoLinea > 50 ? 'var(--amber)' : 'var(--brand)';
    return { p, color };
  };

  const riesgoPri = (c: CarteraRow) =>
    c.riesgo === 'Alto' ? 'high' : c.riesgo === 'Medio' ? 'mid' : 'low';

  return (
    <div className="gcrm min-h-full" style={{ padding: '18px 22px 60px' }}>
      <div className="clientes-content">
        <div className="viewhead">
          <div>
            <div className="crumb">Clientes / <b>{view === 'analisis' ? `Análisis · ${analisis?.periodo?.etiqueta || ''}` : 'Cartera'}</b></div>
            <h1>{view === 'analisis' ? 'Análisis de Cartera' : 'Cartera de Clientes'}</h1>
            <div className="sub">
              {view === 'cartera'
                ? esVendedor
                  ? `${filtrarCartera.length} clientes asignados · seleccione uno para ver pedidos y recomendación de venta`
                  : `${filtrarCartera.length} de ${cartera.length} clientes · click en una fila abre el perfil 360 · busca por nombre, documento, teléfono o ruta`
                : `${analisis?.totalClientes ?? 0} cuentas · la segmentación decide dónde pone el foco su equipo`}
            </div>
          </div>
          {view === 'cartera' && (
            <div style={{ display: 'flex', gap: 8 }}>
              {!esVendedor && <button className="btn" onClick={exportCSV}><Download className="w-4 h-4" /> Exportar</button>}
              {canEdit && (
                <button
                  className="btn brand"
                  onClick={() => { setIsAdding(!isAdding); setEditingId(null); resetForm(); }}
                >
                  {isAdding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {isAdding ? 'Cancelar' : 'Nuevo Cliente'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="a-tabs">
          {canViewAnalysis && <button className={cn(view === 'analisis' && 'on')} onClick={() => { setView('analisis'); setATab('hoy'); }}>Análisis</button>}
          <button className={cn(view === 'cartera' && 'on')} onClick={() => setView('cartera')}>Cartera</button>
        </div>

        {view === 'analisis' && (
          <div className="a-tabs" style={{ marginTop: 0, borderBottom: 'none', boxShadow: '0 2px 0 0 var(--line)' }}>
            <button className={cn(aTab === 'hoy' && 'on')} onClick={() => setATab('hoy')}>Hoy</button>
            <button className={cn(aTab === 'seg' && 'on')} onClick={() => setATab('seg')}>Segmentación</button>
            <button className={cn(aTab === 'reglas' && 'on')} onClick={() => setATab('reglas')}>Reglas &amp; Score</button>
            <button className={cn(aTab === 'politica' && 'on')} onClick={() => setATab('politica')}>Política</button>
          </div>
        )}

        {view === 'cartera' && (
          <>
            {esVendedor && solicitudesCliente.length > 0 && (
              <section className="panel" aria-label="Estado de solicitudes de alta">
                <div className="panelbar"><strong>Solicitudes de clientes</strong><span>{solicitudesCliente.filter(s => s.estado === 'Pendiente').length} pendientes</span></div>
                <div className="divide-y">
                  {solicitudesCliente.slice(0, 3).map((s: any) => {
                    let datos: any = {}; try { datos = JSON.parse(s.datos || '{}'); } catch { /* solicitud antigua */ }
                    return <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span><b>{datos.nombre || s.descripcion}</b><span className="ml-2 text-neutral-500">{datos.ruta || ''}</span></span><span className={cn('rounded-full px-3 py-1 text-xs font-bold', s.estado === 'Aprobado' ? 'bg-emerald-100 text-emerald-800' : s.estado === 'Rechazado' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{s.estado === 'Aprobado' ? 'Aprobada · ya está en su lista' : s.estado === 'Rechazado' ? `Rechazada${s.motivoRechazo ? ` · ${s.motivoRechazo}` : ''}` : 'En revisión'}</span></div>;
                  })}
                </div>
              </section>
            )}

            {isAdding && canEdit && (
              <div className="modal-fixed">
                <form className="modal" onSubmit={editingId ? handleUpdate : handleAdd}>
                  <div className="modal-head"><div><h2>{editingId ? 'Editar Cliente' : esVendedor ? 'Solicitar alta de cliente' : 'Registrar Nuevo Cliente'}</h2>{esVendedor && <p className="text-sm text-neutral-500">Administración revisará los datos antes de agregarlo a su ruta.</p>}</div><button type="button" className="btn ico" onClick={() => { setIsAdding(false); setEditingId(null); }}><X className="w-4 h-4" /></button></div>
                  <div className="modal-body">
                    <div className="grid">
                      <div className="field"><label>Nombre del Negocio <span className="req">*</span></label><input required type="text" value={newCliente.nombre} onChange={e => setNewCliente({ ...newCliente, nombre: e.target.value })} placeholder="Ej. Pulpería La Central" /></div>
                      <div className="field"><label>Tipo Documento</label>
                        <select value={newCliente.tipo_documento} onChange={e => setNewCliente({ ...newCliente, tipo_documento: e.target.value })}>
                          <option value="Fisica">Física</option><option value="Juridica">Jurídica</option><option value="DIMEX">DIMEX</option><option value="Pasaporte">Pasaporte</option>
                        </select>
                      </div>
                      <div className="field"><label>Nº Documento</label><input type="text" value={newCliente.documento_id} onChange={e => setNewCliente({ ...newCliente, documento_id: e.target.value })} placeholder="Cédula o jurídica" /></div>
                      <div className="field"><label>Actividad económica (opcional)</label><input type="text" value={newCliente.actividad_economica || ''} onChange={e => setNewCliente({ ...newCliente, actividad_economica: e.target.value })} placeholder="Código informado por el cliente" /></div>
                      <div className="field"><label>Teléfono</label><input type="text" value={newCliente.telefono} onChange={e => setNewCliente({ ...newCliente, telefono: e.target.value })} placeholder="8888-8888" /></div>
                      <div className="field"><label>Email</label><input type="email" value={newCliente.email} onChange={e => setNewCliente({ ...newCliente, email: e.target.value })} placeholder="correo@ejemplo.com" /></div>
                      {esVendedor ? (
                        <div className="field">
                          <label htmlFor="solicitud-ruta-asignada">Ruta asignada</label>
                          <input
                            id="solicitud-ruta-asignada"
                            type="text"
                            readOnly
                            aria-readonly="true"
                            value={rutaAsignadaVendedor?.nombre || ''}
                            placeholder={rutas.length > 1 ? 'Requiere revisión de Administración' : 'Sin ruta asignada'}
                          />
                          {!rutaAsignadaVendedor && <p className="text-xs" role="status" style={{ color: 'var(--status-danger)' }}>
                            {rutas.length > 1
                              ? 'Hay más de una ruta asignada. Administración debe dejar una activa.'
                              : 'Administración debe asignarte una ruta antes de solicitar el alta.'}
                          </p>}
                        </div>
                      ) : (
                        <div className="field"><label>Ruta</label>
                          <select value={newCliente.ruta || ''} onChange={e => setNewCliente({ ...newCliente, ruta: e.target.value })}>
                            <option value="">Sin ruta asignada</option>
                            {rutasSelect.map((r: any) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="field full"><label>Dirección</label><input type="text" value={newCliente.direccion} onChange={e => setNewCliente({ ...newCliente, direccion: e.target.value })} placeholder="Dirección completa" /></div>
                      <div className="field"><label>Provincia</label>
                        <select value={newCliente.provincia || ''} onChange={e => setNewCliente({ ...newCliente, provincia: e.target.value })}>
                          <option value="">—</option>
                          {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Cantón</label><input type="text" value={newCliente.canton || ''} onChange={e => setNewCliente({ ...newCliente, canton: e.target.value })} placeholder="Ej. Alajuela" /></div>
                      <div className="field"><label>Distrito</label><input type="text" value={newCliente.distrito || ''} onChange={e => setNewCliente({ ...newCliente, distrito: e.target.value })} placeholder="Ej. San Rafael" /></div>
                      {!esVendedor && <><div className="field"><label>Condición de Pago</label>
                        <select value={newCliente.condicion_pago} onChange={e => setNewCliente({ ...newCliente, condicion_pago: e.target.value as any })}>
                          <option value="Contado">Contado</option><option value="Credito">Crédito</option>
                        </select>
                      </div>
                      <div className="field"><label>Precio Especial (₡)</label><input type="number" value={newCliente.precio_especial || ''} onChange={e => setNewCliente({ ...newCliente, precio_especial: e.target.value ? Number(e.target.value) : null })} placeholder="Ej. 1450" /></div>
                      <div className="field"><label>Límite Crédito (₡)</label><input type="number" value={newCliente.limite_credito || ''} onChange={e => setNewCliente({ ...newCliente, limite_credito: e.target.value ? Number(e.target.value) : 0 })} placeholder="0" /></div>
                      <div className="field full"><label>Notas internas</label><input type="text" value={newCliente.notas} onChange={e => setNewCliente({ ...newCliente, notas: e.target.value })} placeholder="Notas internas..." /></div></>}
                    </div>
                  </div>
                  <div className="modal-foot">
                    <button type="button" className="btn" onClick={() => { setIsAdding(false); setEditingId(null); }}>Cancelar</button>
                    <button type="submit" disabled={esVendedor && !rutaAsignadaVendedor} className="btn brand"><Check className="w-4 h-4" /> {editingId ? 'Guardar Cambios' : esVendedor ? 'Enviar a aprobación' : 'Guardar Cliente'}</button>
                  </div>
                </form>
              </div>
            )}

            <div className="panel" style={{ marginTop: 8 }}>
              <div className={cn('panelbar', esVendedor && 'seller-client-toolbar')}>
                <div className={cn(esVendedor && 'seller-client-search')} style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
                  <Search className="w-4 h-4" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
                  <input
                    type="text"
                    placeholder={esVendedor ? 'Buscar cliente de mi ruta…' : 'Buscar por nombre, documento, teléfono, ruta...'}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ paddingLeft: 34, width: '100%' }}
                  />
                </div>
                <button className="btn sm ghost" onClick={() => setSearchTerm('')}>Limpiar</button>
              </div>
              {isLoading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 12.5 }}>Cargando cartera…</div>
              ) : filtrarCartera.length === 0 ? (
                <div className="empty">No se encontraron clientes que coincidan con la búsqueda.</div>
              ) : (
                <>
                {esVendedor && <div className="seller-client-list" aria-label="Clientes asignados">
                  {filtrarCartera.map(c => {
                    const iniciales = c.nombre.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
                    return <article key={c.id} className="seller-client-card">
                      <div className="seller-client-card-identity">
                        <span className="av-mini" aria-hidden="true">{iniciales}</span>
                        <div className="seller-client-card-copy">
                          <h2>{c.nombre}</h2>
                          <p>{Number(c.pedidos90d || 0)} pedidos en los últimos 90 días</p>
                        </div>
                      </div>
                      <button type="button" className="btn sm brand seller-client-card-action" onClick={() => setDrawerCliente({ id: c.id, nombre: c.nombre } as Cliente)}>
                        Ver pedidos y sugerencia
                      </button>
                    </article>;
                  })}
                </div>}
                <div className="cartera-table-scroll" style={{ overflowX: 'auto', display: esVendedor ? 'none' : undefined }}>
                  <table className="gcrm-table">
                    <thead>
                      {esVendedor
                        ? <tr><th>Clientes de mi ruta</th><th className="client-actions-head">Acción</th></tr>
                        : <tr><th>Cliente</th><th>Ruta</th><th>Segmento</th><th>Pedidos 90d</th><th className="num" title="Compra promedio por pedido">Ticket prom.</th><th>Crédito (uso)</th><th>Riesgo</th><th className="num">Saldo</th><th className="client-actions-head">Acciones</th></tr>}
                    </thead>
                    <tbody>
                      {filtrarCartera.map((c) => {
                        const iniciales = c.nombre.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
                        if (esVendedor) return (
                          <tr key={c.id} className="clickable" onClick={() => setDrawerCliente({ id: c.id, nombre: c.nombre } as Cliente)}>
                            <td><span className="av-mini">{iniciales}</span><span className="strong" style={{ verticalAlign: 'middle' }}>{c.nombre}</span></td>
                            <td className="client-actions-cell" onClick={e => e.stopPropagation()}><button className="btn sm brand" onClick={() => setDrawerCliente({ id: c.id, nombre: c.nombre } as Cliente)}>Ver pedidos</button></td>
                          </tr>
                        );
                        const bar = riesgoBars(c);
                        return (
                          <tr key={c.id} className="clickable" onClick={() => setDrawerCliente(clientes.find(x => x.id === c.id) || toCliente(c))}>
                            <td>
                              <span className="av-mini">{iniciales}</span>
                              <div style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                                <div className="strong">{c.nombre}</div>
                                <div className="mini">{c.tipoDocumento || 'Física'} {c.documentoId || ''}</div>
                              </div>
                            </td>
                            <td>{c.ruta ? <span className="chip gray">{c.ruta}</span> : <span className="mini">Sin ruta</span>}</td>
                            <td>
                              <div className="client-segment-stack">
                                <div className="client-segment-line">
                                  <span className={cn('seg', c.segmento === 'A' ? 'seg-A' : c.segmento === 'B' ? 'seg-B' : 'seg-C')} title={`Segmento ${c.segmento}. ${fmt(c.monto90d)} en ${c.pedidos90d} pedidos durante los últimos 90 días.`}>{c.segmento}</span>
                                  <button
                                    type="button"
                                    className="segment-help-trigger"
                                    aria-label="Explicar segmentos de clientes"
                                    aria-expanded={segmentHelpOpen === c.id}
                                    aria-controls={`segment-help-${c.id}`}
                                    aria-describedby={segmentHelpOpen === c.id ? `segment-help-${c.id}` : undefined}
                                    title={`Por qué ${c.nombre} está en segmento ${c.segmento}`}
                                    onClick={(e) => { e.stopPropagation(); setSegmentHelpOpen(open => open === c.id ? null : c.id); }}
                                  ><Info aria-hidden="true" /></button>
                                </div>
                                {segmentHelpOpen === c.id && (
                                  <div id={`segment-help-${c.id}`} className="segment-help-popover" role="tooltip" onClick={e => e.stopPropagation()}>
                                    <strong>Por qué está en {c.segmento}</strong>
                                    <span>{fmt(c.monto90d)} en {c.pedidos90d} pedidos durante los últimos 90 días.</span>
                                    {c.segmento === 'A' && <span>Alcanza el nivel A: ₡400.000 o más.</span>}
                                    {c.segmento === 'B' && <span>Está entre ₡120.000 y ₡399.999 (nivel B).</span>}
                                    {c.segmento === 'C' && <span>Está por debajo de ₡120.000; le faltan {fmt(Math.max(0, 120000 - c.monto90d))} para llegar a B.</span>}
                                    <small>Ticket promedio: {fmt(c.ticketPromedio)}. Pago: “{c.comportamiento}”, con máximo de {c.diasVencido} días de atraso y {fmt(c.vencido)} de saldo vencido.</small>
                                  </div>
                                )}
                                <span className={cn('chip', COMBO[c.comportamiento]?.chip || 'gray')} title={`${c.comportamiento}: máximo ${c.diasVencido} días de atraso registrados${c.vencido > 0 ? `; ${fmt(c.vencido)} vencidos` : '; sin saldo vencido'}.`}>{c.comportamiento}</span>
                              </div>
                            </td>
                            <td>
                              <div className="strong">{c.pedidos90d}</div>
                              <div className="mini">{c.ultimaCompra ? `último ${diasTranscurridos(c.ultimaCompra)} d` : 'sin compras'}</div>
                            </td>
                            <td className="num mono">{fmt(c.ticketPromedio)}</td>
                            <td>
                              {c.condicionPago === 'Credito' ? (
                                <>
                                  <div className="mono" style={{ fontSize: 11 }}>{fmt(c.saldoPendiente)}/{fmt(c.limiteCredito)}</div>
                                  <div className="bar" style={{ width: 92 }}><div style={{ width: `${bar.p}%`, background: bar.color }}></div></div>
                                </>
                              ) : (
                                <span className="chip gray">Contado</span>
                              )}
                            </td>
                            <td><span className={cn('prio', riesgoPri(c))} title={c.riesgo}>{c.riesgo}</span></td>
                            <td className="num">
                              {Number(c.saldoPendiente || 0) > 0 ? (
                                <span className={c.riesgo === 'Alto' ? 'chip red' : c.riesgo === 'Medio' ? 'chip amber' : 'chip green'}>{fmt(c.saldoPendiente)}</span>
                              ) : (
                                <span className="chip blue">al día</span>
                              )}
                            </td>
                            <td className="client-actions-cell" onClick={e => e.stopPropagation()}>
                              <span className="row-actions">
                                <button className="btn sm" title="Abrir perfil 360" aria-label={`Abrir perfil de ${c.nombre}`} onClick={() => setDrawerCliente(clientes.find(x => x.id === c.id) || toCliente(c))}>Ver perfil</button>
                                {canEdit && <>
                                  <button className="btn sm ico" title="Editar" aria-label={`Editar ${c.nombre}`} onClick={() => startEdit(clientes.find(x => x.id === c.id) || toCliente(c))}><span style={{ fontSize: 12 }}>✎</span></button>
                                  <button className="btn sm ico" title="Archivar" aria-label={`Archivar ${c.nombre}`} onClick={() => handleDelete(c.id)}><span style={{ color: 'var(--red)', fontSize: 12 }}>🗑</span></button>
                                </>}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
              {!esVendedor && <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: 'var(--ink3)', flexWrap: 'wrap', gap: 8 }}>
                <span>Ticket = <b>compra promedio por pedido</b> · Riesgo = score 0–100 (Bajo ≤ 40 · Medio 41–70 · Alto 71+) · score promedio de cartera: <b>{scorePromedio}</b></span>
              </div>}
            </div>
          </>
        )}

        {view === 'analisis' && isLoading && (
          <div style={{ padding: '50px 0', textAlign: 'center', color: 'var(--ink3)', fontSize: 12.5 }}>Cargando análisis…</div>
        )}

        {view === 'analisis' && !isLoading && analisis && (
          <>
            {/* ============ HOY ============ */}
            {aTab === 'hoy' && (
              <>
                <div className="kpis">
                  <div className="kpi">
                    <div className="row"><div className="l">Venta del mes</div><span className="dot amber"></span></div>
                    <div className="v">{fmt(analisis.ventaDelMes)}</div>
                    <div className="ins">del mes · {fmt(analisis.ventaTotal12m)} en 12m</div>
                  </div>
                  <div className="kpi">
                    <div className="row"><div className="l">Cartera / vencido</div><span className="dot amber"></span></div>
                    <div className="v">{fmt(analisis.carteraTotal)} <span style={{ fontSize: 13, color: 'var(--ink3)', fontWeight: 600 }}>/ {fmt(analisis.vencidoTotal)}</span></div>
                    <div className="ins"><b>{analisis.pctVencido}% vencido</b> de la cartera</div>
                  </div>
                  <div className="kpi">
                    <div className="row"><div className="l">DSO vs. Best Possible</div><span className="dot amber"></span></div>
                    <div className="v">{analisis.dso} <span style={{ fontSize: 13 }}>d</span> <span style={{ fontSize: 12, color: 'var(--ink3)', fontWeight: 600 }}>/ {analisis.bestPossible} d</span></div>
                    <div className="ins">{analisis.dso - analisis.bestPossible} días de holgura.</div>
                  </div>
                  <div className="kpi">
                    <div className="row"><div className="l">CEI (cobranza)</div><span className="dot green"></span></div>
                    <div className="v">{analisis.cei}%</div>
                    <div className="ins"><span className="t-up">▲</span> efectividad de cobro · meta 90%</div>
                  </div>
                  <div className="kpi">
                    <div className="row"><div className="l">Clientes en riesgo</div><span className="dot red"></span></div>
                    <div className="v">{analisis.clientesEnRiesgo}</div>
                    <div className="ins">{cartera.filter(c => c.riesgo === 'Alto').length} bloqueos · listado abajo</div>
                  </div>
                </div>

                <div className="exec-grid">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="panel">
                      <div className="panel-head">
                        <div className="panel-title"><span className="dot green"></span>Exposición de crédito (aging)</div>
                        <div className="mini">cartera {fmt(analisis.carteraTotal)}</div>
                      </div>
                      <div style={{ padding: '6px 18px 16px' }}>
                        {(() => {
                          const a = analisis.aging || {};
                          const sum = a.alDia + a.d1_30 + a.d31_60 + a.d60 || 1;
                          const pct = (v: number) => Math.round((v / sum) * 100);
                          return (
                            <>
                              <div className="stacked">
                                <div aria-label={`Al día: ${pct(a.alDia)}%`} style={{ flex: Math.max(4, pct(a.alDia)), background: 'var(--brand)' }} />
                                <div aria-label={`1 a 30 días: ${pct(a.d1_30)}%`} style={{ flex: Math.max(2, pct(a.d1_30)), background: 'var(--status-warning-soft)' }} />
                                <div aria-label={`31 a 60 días: ${pct(a.d31_60)}%`} style={{ flex: Math.max(2, pct(a.d31_60)), background: 'var(--status-blocked-soft)' }} />
                                <div aria-label={`Más de 60 días: ${pct(a.d60)}%`} style={{ flex: Math.max(2, pct(a.d60)), background: 'var(--status-danger-soft)' }} />
                              </div>
                              <div className="legend">
                                <span><span className="dot green"></span>Al día · {fmt(a.alDia)}</span>
                                <span><span className="dot amber"></span>1–30d · {fmt(a.d1_30)}</span>
                                <span><span className="dot orange"></span>31–60d · {fmt(a.d31_60)}</span>
                                <span><span className="dot red"></span>60d+ · {fmt(a.d60)}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-head"><div className="panel-title"><span className="dot blue"></span>Top 5 por venta 12m</div><button className="btn sm" onClick={() => setView('cartera')}>Ver cartera completa</button></div>
                      <div style={{ padding: '14px 18px 16px' }}>
                        {mejoresVenta.length === 0 && <div className="empty">Sin datos de venta</div>}
                        {mejoresVenta.map(c => (
                          <div className="tbar" key={c.id}>
                            <div className="lb"><span>{c.nombre} {c.riesgo !== 'Bajo' && <span className={c.riesgo === 'Alto' ? 'chip red' : 'chip amber'}>{c.riesgo}</span>}</span><b className="mono">{fmt(c.venta12m)}</b></div>
                            <div className="track"><div className="fill" style={{ width: `${Math.round((c.venta12m / maxVenta5(mejoresVenta)) * 100)}%`, background: c.riesgo === 'Alto' ? 'var(--red)' : c.riesgo === 'Medio' ? 'var(--status-warning)' : 'var(--brand)' }}></div></div>
                          </div>
                        ))}
                        <div className="mini" style={{ marginTop: 8 }}>Verde: paga bien · ámbar: saldo vencido · rojo: morosidad (el valor crece, el efectivo no llega).</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="panel">
                      <div className="panel-head"><div className="panel-title"><span className="dot red"></span>Worklist priorizada · top 4</div></div>
                      <div className="attn" style={{ padding: 12 }}>
                        {(analisis.worklist || []).map((w: any, i: number) => (
                          <div className={cn('attn-card', w.riesgo === 'Alto' ? 'crit' : 'warn')} key={i}>
                            <div className="t">
                              <span className={cn('prio', w.riesgo === 'Alto' ? 'high' : w.riesgo === 'Medio' ? 'mid' : 'low')}>{w.score}</span>
                              <span className="g">{w.nombre}</span>
                              <span className={w.diasVencido > 30 ? 'chip red' : w.diasVencido > 15 ? 'chip orange' : w.diasVencido > 3 ? 'chip amber' : 'chip green'}>{w.diasVencido}d</span>
                            </div>
                            <div className="d">Saldo <b className="mono">{fmt(w.saldo)}</b> · uso línea <b>{w.usoLinea}%</b> → próximo paso: <b>{w.siguientePaso}</b>.</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="btn sm brand" onClick={() => window.confirm(`Llamar a ${w.nombre} (demo)`)}>Llamar ahora</button>
                              <button className="btn sm" onClick={() => { const cc = cartera.find(x => x.id === w.clienteId); if (cc) setDrawerCliente(clientes.find(x => x.id === w.clienteId) || toCliente(cc)); }}>Ver 360</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-head"><div className="panel-title"><span className="dot violet"></span>Alertas de riesgo <span className="chip red">{cartera.filter(c => c.usoLinea >= 80 || c.riesgo === 'Alto').length}</span></div></div>
                      <div className="attn" style={{ padding: 12 }}>
                        {cartera.filter(c => c.usoLinea >= 80).slice(0, 3).map(c => (
                          <div className="attn-card warn" key={c.id}><div className="t"><span className="chip orange">80% línea</span><span className="g">{c.nombre}</span></div><div className="d">Límite {fmt(c.limiteCredito)} · uso {c.usoLinea}% → <b>revisión interina</b> (regla CreditPulse).</div></div>
                        ))}
                        {concentracionTop3 >= 30 && (
                          <div className="attn-card warn"><div className="t"><span className="chip orange">Concentración</span><span className="g">{topN} cuenta{topN === 1 ? '' : 's'} = {concentracionTop3}% de la venta</span></div><div className="d">Tope sano 1–2% ingreso por cuenta. Revisar cartera A.</div></div>
                        )}
                        <div className="attn-card warn"><div className="t"><span className="chip amber">Revisión anual línea</span><span className="g">{cartera.length} cuenta{cartera.length === 1 ? '' : 's'}</span></div><div className="d">Programadas para revisión anual de límites (Allianz Trade).</div></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel">
                    <div className="panel-head"><div className="panel-title">DSO vs Best Possible · holgura real</div><div className="mini">{analisis.bestPossible} días = {fmt(analisis.bestPossible * (analisis.ventaTotal12m / 365))} liberables</div></div>
                    <div style={{ padding: 16 }}>
                      <div className="tbar"><div className="lb"><span>DSO actual</span><b className="mono">{analisis.dso} d</b></div><div className="track"><div className="fill" style={{ width: `${Math.min(100, Math.round((analisis.dso / 41) * 100))}%`, background: 'var(--amber)' }}></div></div></div>
                      <div className="tbar"><div className="lb"><span>Best possible</span><b className="mono">{analisis.bestPossible} d</b></div><div className="track"><div className="fill" style={{ width: `${Math.min(100, Math.round((analisis.bestPossible / 41) * 100))}%`, background: 'var(--brand)' }}></div></div></div>
                      <div className="tbar"><div className="lb"><span>Benchmark industria</span><b className="mono">41 d</b></div><div className="track"><div className="fill" style={{ width: '100%', background: 'var(--ink3)' }}></div></div></div>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-head"><div className="panel-title">Morosidad por ruta</div><div className="mini">% vencido vs cartera</div></div>
                    <div style={{ padding: 16 }}>
                      {(() => {
                        const porRuta: Record<string, { cuentas: number; vencido: number; dso: number }> = {};
                        for (const c of cartera) {
                          const k = c.ruta || 'Sin ruta';
                          porRuta[k] = porRuta[k] || { cuentas: 0, vencido: 0, dso: 0 };
                          porRuta[k].cuentas += 1;
                          porRuta[k].vencido += Number(c.vencido || 0);
                          if (c.diasVencido > 0) porRuta[k].dso += c.diasVencido;
                        }
                        const arr = Object.entries(porRuta);
                        const maxdso = Math.max(1, ...arr.map(([, v]) => v.dso / Math.max(1, v.cuentas)));
                        return arr.slice(0, 5).map(([ruta, v]) => (
                          <div className="tbar" key={ruta}>
                            <div className="lb"><span>{ruta}</span><b className="mono">{fmt(v.vencido)}</b></div>
                            <div className="track"><div className="fill" style={{ width: `${Math.min(100, Math.round(((v.dso / Math.max(1, v.cuentas)) / maxdso) * 100))}%`, background: v.vencido > 0 ? 'var(--red)' : 'var(--brand)' }}></div></div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: 16 }}>
                  <div className="panel-head"><div className="panel-title"><span className="dot blue"></span>Top 10 clientes por venta vs. riesgo de cobro</div><div className="mini">♥ top bar = ${fmt(top10[0]?.venta12m || 0)} · 12m</div></div>
                  <div style={{ padding: '18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 4, alignItems: 'end', height: 120 }}>
                      {top10.map((c, i) => (
                        <div key={c.id} title={`${c.nombre} · ${c.riesgo}`}
                          style={{ background: c.riesgo === 'Alto' ? 'var(--red)' : c.riesgo === 'Medio' ? 'var(--amber)' : 'var(--brand)', height: `${Math.round((c.venta12m / maxVenta10) * 100)}%`, borderRadius: '6px 6px 0 0' }}></div>
                      ))}
                    </div>
                    <div className="legend" style={{ marginTop: 8 }}>
                      <span><span className="dot green"></span>Venta sana</span>
                      <span><span className="dot amber"></span>Venta con vencido</span>
                      <span><span className="dot red"></span>Alta morosidad (revisar línea)</span>
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button className="btn sm" onClick={exportCSV}>Exportar CSV</button>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className="chip green">Cartera {cartera.length}</span>
                        <span className="chip amber">DSO {analisis.dso}d</span>
                        <span className="chip blue">Score prom. {scorePromedio}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ============ SEGMENTACION ============ */}
            {aTab === 'seg' && (
              <>
                <div className="panel">
                  <div className="panel-head"><div className="panel-title">Comportamiento de pago → estrategia diferencial</div><div className="mini">{cartera.length} cuentas · la segmentación decide dónde pone el foco su equipo</div></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="gcrm-table">
                      <thead><tr><th>Segmento</th><th className="num">Cuentas</th><th className="num">Vencido</th><th>Cadencia automática</th><th>Canal</th><th>Dueño</th><th>Acción umbral</th></tr></thead>
                      <tbody>
                        {Object.keys(NOMBRE_REGLAS).map(k => {
                          const s = comportamientoStats[k];
                          return (
                            <tr key={k}>
                              <td><span className={cn('chip', COMBO[k].chip)}>{NOMBRE_REGLAS[k]}</span></td>
                              <td className="num strong">{s.cuentas}</td>
                              <td className="num">{s.cuentas > 0 ? fmt(s.vencido) : '—'}</td>
                              <td>{CADENCIA[k][0]}</td>
                              <td>{CADENCIA[k][1]}</td>
                              <td>{CADENCIA[k][2] || '—'}</td>
                              <td>{CADENCIA[k][3]}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Matriz valor × disciplina (foco: cuentas A)</h4></div>
                    <div style={{ display: 'grid', width: '100%', gridTemplateColumns: '1fr 1fr 1fr', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: 8, background: 'var(--bg-muted)', fontSize: 10, fontWeight: 800, color: 'var(--ink3)', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>A · Alto</div>
                      <div style={{ padding: 8, background: 'var(--bg-muted)', fontSize: 10, fontWeight: 800, color: 'var(--ink3)', textAlign: 'center', borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>B · Medio</div>
                      <div style={{ padding: 8, background: 'var(--bg-muted)', fontSize: 10, fontWeight: 800, color: 'var(--ink3)', textAlign: 'center', borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>C · Bajo</div>
                      {(['Puntual', 'Atraso leve', 'Atraso frecuente'] as const).map((lvl, i) => (
                        <React.Fragment key={lvl}>
                          {(['A', 'B', 'C'] as const).map((seg) => {
                            const n = matrizSegmento[seg][lvl] + (lvl === 'Atraso frecuente' ? matrizSegmento[seg]['Crónico'] : 0);
                            return (
                              <div key={seg} style={{
                                padding: 14, borderBottom: i < 2 ? '1px solid var(--line)' : undefined,
                                borderLeft: seg !== 'A' ? '1px solid var(--line)' : undefined,
                                background: lvl === 'Puntual' ? 'var(--status-success-soft)' : lvl === 'Atraso leve' ? 'var(--status-warning-soft)' : 'var(--status-danger-soft)'
                              }}>
                                <div className="strong" style={lvl === 'Atraso frecuente' ? { color: 'var(--red)' } : undefined}>{n}</div>
                                <div className="mini">{lvl === 'Puntual' ? 'sanos' : lvl === 'Atraso leve' ? 'seguimiento' : 'alto riesgo'}</div>
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Score de crédito · doble scorecard</h4>
                      <div className="mcell" style={{ marginBottom: 8, borderLeft: '3px solid var(--blue)' }}><div className="t">Scorecard nuevo cliente</div><div className="d">Años en negocio · referencias · garantía · pedido proyectado → límite inicial ≤ 10–20% del gasto anual proyectado.</div></div>
                      <div className="mcell" style={{ borderLeft: '3px solid var(--violet)' }}><div className="t">Scorecard existente</div><div className="d">Puntualidad 12m · atrasos frecuentes · uso de línea · rentabilidad → revisión interina si &gt;80% línea o si falla un pago.</div></div>
                      <div className="mini" style={{ marginTop: 8 }}>Score promedio de cartera: <b>{scorePromedio}/100</b>. Sin scorecard único (NACM: consistencia sin perder excepciones).</div>
                    </div>
                  </div>
                </div>

                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel">
                    <div className="panel-head"><div className="panel-title">Vencido por segmento</div></div>
                    <div style={{ padding: 16 }}>
                      {(analisis.porSegmento || []).map((s: any) => (
                        <div className="tbar" key={s.segmento}>
                          <div className="lb"><span>{s.segmento} · {s.cuentas} cuentas</span><b className="mono">{fmt(s.vencido)}</b></div>
                          <div className="track"><div className="fill" style={{ width: `${Math.max(4, Math.round((s.vencido / Math.max(1, analisis.vencidoTotal)) * 100))}%`, background: s.segmento === 'A' ? 'var(--brand)' : s.segmento === 'B' ? 'var(--amber)' : 'var(--red)' }}></div></div>
                        </div>
                      ))}
                      <div className="mini" style={{ marginTop: 8 }}>El gap de {Math.max(0, analisis.dso - analisis.bestPossible)} días vs best possible concentra la holgura de caja.</div>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-head"><div className="panel-title">Distribución por condición de pago</div></div>
                    <div style={{ padding: 16 }}>
                      {(() => {
                        const contado = cartera.filter(c => c.condicionPago !== 'Credito').length;
                        const credito = cartera.length - contado;
                        return (
                          <>
                            <div className="stacked" style={{ margin: '6px 0 10px' }}>
                              <div aria-label={`Crédito: ${Math.round((credito / Math.max(1, cartera.length)) * 100)}%`} style={{ flex: Math.max(10, credito), background: 'var(--brand)' }} />
                              <div aria-label={`Contado: ${Math.round((contado / Math.max(1, cartera.length)) * 100)}%`} style={{ flex: Math.max(6, contado), background: 'var(--status-neutral-soft)' }} />
                            </div>
                            <div className="legend">
                              <span><span className="dot green"></span>Crédito · {credito} cuentas</span>
                              <span><span className="dot gray"></span>Contado · {contado} cuentas</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ============ REGLAS & SCORE ============ */}
            {aTab === 'reglas' && (
              <div className="cols-2">
                <div className="panel" style={{ padding: 16 }}>
                  <div className="sect"><h4>Rules engine (Smart Rules)</h4>
                    <div className="mcell" style={{ marginBottom: 8 }}><div className="t">RULE 01 · Atraso &gt; 45d</div><div className="d"><b>SI</b> saldo vencido &gt; 45d y sin acuerdo de pago <b>→ asignar</b> worklist de jefe crédito + carta L4 automática (crédito en hold). <span className="chip green">Activa</span></div></div>
                    <div className="mcell" style={{ marginBottom: 8 }}><div className="t">RULE 02 · Primera demora</div><div className="d"><b>SI</b> cliente puntual 6m+ con arrastre &gt; 3d <b>→</b> recordatorio suave con enlace de pago (no llamada). <span className="chip green">Activa</span></div></div>
                    <div className="mcell" style={{ marginBottom: 8 }}><div className="t">RULE 03 · Cuenta en riesgo</div><div className="d"><b>SI</b> atraso &gt; 30d sin respuesta o sin acuerdos <b>→</b> +30 pts al score, escalar a gerencia y prohibir nueva línea hasta pago. <span className="chip green">Activa</span></div></div>
                    <div className="mcell"><div className="t">RULE 04 · Margen roto</div><div className="d"><b>SI</b> precio &lt; margen objetivo <b>→</b> alerta a Comercial (chivo en matriz de precios). <span className="chip amber">Pendiente revisar tope</span></div></div>
                  </div>
                </div>
                <div className="panel" style={{ padding: 16 }}>
                  <div className="sect"><h4>Cadencia de dunning (L0–L5)</h4>
                    <div className="d-ladder">
                      <div className="rung"><div className="st">L0</div><div className="nm">Al día</div><div className="ds">Recordatorio 3d antes (auto)</div></div>
                      <div className="rung"><div className="st">L1 · D0</div><div className="nm">Aviso</div><div className="ds">Email suave + enlace de pago</div></div>
                      <div className="rung"><div className="st">L2 · D7</div><div className="nm">Firme</div><div className="ds">Email firme + SMS</div></div>
                      <div className="rung hot"><div className="st">L3 · D14</div><div className="nm">Llamada</div><div className="ds">Cobra ventas (contexto en 1 clic)</div></div>
                      <div className="rung hot"><div className="st">L4 · D21</div><div className="nm">Escalada</div><div className="ds">Jefe crédito + aviso formal</div></div>
                      <div className="rung crit"><div className="st">L5 · D45</div><div className="nm">Bloqueo</div><div className="ds">Crédito en hold · revisión gerencia</div></div>
                    </div>
                    <div className="mini" style={{ marginTop: 8 }}>Llamada entra el <b>día 14</b> como máximo; esperar más entrena al cliente (CreditPulse/Stripe).</div>
                  </div>
                </div>
              </div>
            )}

            {/* ============ POLITICA ============ */}
            {aTab === 'politica' && (
              <>
                <div className="panel" style={{ padding: 16 }}>
                  <div className="sect"><h4>Política de crédito · límites en vivo</h4>
                    <div className="mcell" style={{ marginBottom: 8, borderLeft: '3px solid var(--amber)' }}><div className="t">Alerta al 80% de uso</div><div className="d">Uso ≥80% de la línea → <b>revisión interina en 24h</b>; sin revisión, la venta se restringe en el punto de pedido (SAP: credit limit deviation). Afecta hoy a <b>{cartera.filter(c => c.usoLinea >= 80).length} cuenta{cartera.filter(c => c.usoLinea >= 80).length === 1 ? '' : 's'}</b>.</div></div>
                    <div className="mcell" style={{ marginBottom: 8, borderLeft: '3px solid var(--blue)' }}><div className="t">Cuenta nueva</div><div className="d">Límite inicial ≤ <b>10–20% del gasto anual proyectado</b> evaluado con scorecard nuevo; re-evaluación a los 3 y 12 meses (Allianz Trade/CreditPulse).</div></div>
                    <div className="mcell" style={{ borderLeft: '3px solid var(--violet)' }}><div className="t">Revisión anual</div><div className="d">{cartera.length} cuenta{cartera.length === 1 ? '' : 's'} en evaluación · revisión automática de límite con scorecard existente (puntualidad, atrasos, uso, rentabilidad).</div></div>
                  </div>
                </div>
                <div className="cols-2" style={{ marginTop: 16 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Concentración y salud de cartera</h4>
                      <div className="tbar"><div className="lb"><span>{topN} cuenta{topN === 1 ? '' : 's'} = {concentracionTop3}% de la venta</span><b className="mono" style={{ color: concentracionTop3 >= 30 ? 'var(--red)' : 'var(--brand)' }}>{concentracionTop3 >= 30 ? 'alto' : 'sano'}</b></div><div className="track"><div className="fill" style={{ width: `${Math.min(100, Math.round(concentracionTop3))}%`, background: concentracionTop3 >= 30 ? 'var(--red)' : 'var(--brand)' }}></div></div></div>
                      <div className="tbar"><div className="lb"><span>Segmentos A+B = {((matrizSegmento.A.Puntual + matrizSegmento.A['Atraso leve'] + matrizSegmento.A['Atraso frecuente'] + matrizSegmento.A['Crónico'] + matrizSegmento.B.Puntual + matrizSegmento.B['Atraso leve'] + matrizSegmento.B['Atraso frecuente'] + matrizSegmento.B['Crónico']) / Math.max(1, cartera.length) * 100).toFixed(0)}% de cuentas</span><b className="mono">sano</b></div><div className="track"><div className="fill" style={{ width: `${((matrizSegmento.A.Puntual + matrizSegmento.A['Atraso leve'] + matrizSegmento.A['Atraso frecuente'] + matrizSegmento.A['Crónico'] + matrizSegmento.B.Puntual + matrizSegmento.B['Atraso leve'] + matrizSegmento.B['Atraso frecuente'] + matrizSegmento.B['Crónico']) / Math.max(1, cartera.length) * 100).toFixed(0)}%`, background: 'var(--brand)' }}></div></div></div>
                      <div className="mini" style={{ marginTop: 8 }}>Tope sano de concentración: 1–2% del ingreso por cuenta (NACM). Reducir exposición según riesgo.</div>
                    </div>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div className="sect"><h4>Expuestos a la regla 80% línea</h4>
                      {cartera.filter(c => c.usoLinea >= 80).length === 0 ? (
                        <div className="empty">Ninguna cuenta sobre la regla CreditPulse.</div>
                      ) : (
                        <table><thead><tr><th>Cliente</th><th className="num">Uso</th><th className="num">Saldo</th></tr></thead>
                          <tbody>
                            {cartera.filter(c => c.usoLinea >= 80).slice(0, 6).map(c => (
                              <tr key={c.id}><td className="strong">{c.nombre}</td><td className="num" style={{ color: 'var(--red)' }}>{c.usoLinea}%</td><td className="num mono">{fmt(c.saldoPendiente)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Cliente360
        cliente={drawerCliente}
        currentUser={currentUser}
        esVendedor={esVendedor}
        open={!!drawerCliente}
        onClose={() => setDrawerCliente(null)}
        onEdit={canEdit ? (c) => { if (c) { setDrawerCliente(null); startEdit(c); } } : undefined}
      />
    </div>
  );
}

function toCliente(c: CarteraRow): Cliente {
  return {
    id: c.id,
    nombre: c.nombre,
    tipo_documento: c.tipoDocumento,
    documento_id: c.documentoId,
    telefono: c.telefono,
    email: c.email,
    direccion: c.direccion,
    ruta: c.ruta || '',
    condicion_pago: (c.condicionPago === 'Credito' ? 'Credito' : 'Contado'),
    precio_especial: c.precioEspecial ?? null,
    limite_credito: c.limiteCredito || 0,
    saldo_pendiente: c.saldoPendiente || 0,
    promedio_compra: Math.round((c.ticketPromedio || 0) * 30), // approx mensual
    notas: c.notas || '',
  };
}
