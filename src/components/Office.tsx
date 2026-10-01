import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, RefreshCw, Search, Mail, FolderTree, Link2, AlertTriangle, Unlink, Eye, Paperclip,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from '../types';
import Breadcrumb from './Breadcrumb';
import './gcrm.css';

interface Props { currentUser: User; initialEspacio?: 'correo' | 'documentos'; }

interface Cuenta {
  id: string; email: string; etiqueta: string; color: string;
  provider: string; estado: string; lastSync: string | null;
  mensajes: number; sinLeer: number;
}

interface Documento {
  id: string; archivoNombre: string; archivoTipo: string; archivoBytes: number | null;
  carpeta: string | null; threadId: string | null; origen: string; fecha: string;
  huerfano: boolean;
}

interface Mensaje {
  id: string; accountId: string; threadId: string; remitente: string; remitenteEmail: string;
  asunto: string; preview: string; labelIds: string; recibidos: number; leido: number;
  adjuntoCount: number; fecha: string;
  etiquetaCuenta: string; colorCuenta: string; carpeta: string | null; reglaId: string | null;
  documentos: Documento[];
}

interface Resumen {
  cuentas: number; mensajes: number; sinLeer: number; documentos: number;
  reglasActivas: number; reglas: number; cuentasSinCarpeta: number;
  documentosHuerfanos: number; ultimoSync: string | null;
}

interface Arbol { carpeta: string; total: number; huerfanos: number; }
interface NodoCarpeta { carpeta: string; total: number; huerfanos: number; }

const VISTAS = [
  { id: 'todos', label: 'Todos' },
  { id: 'con-documentos', label: 'Con documentos' },
  { id: 'sin-responder', label: 'Sin responder' },
] as const;

const COLOR_TIPO: Record<string, string> = {
  PDF: '#DC2626', XLS: '#3D7A4A', IMG: '#7C3AED', DOC: '#2563EB',
};

const fmtBytes = (b: number | null) => {
  const n = Number(b || 0);
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtFecha = (iso: string) => {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit' });
};

const haceCuanto = (iso: string | null) => {
  if (!iso) return 'sin sincronizar';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

/** Provider local: si no hay cuentas, sembramos la bandeja inicial del boceto. */
async function sembrarSiEstaVacio() {
  const r = await fetch('/api/office/cuentas');
  if (!r.ok) return;
  const cuentas = await r.json();
  if (Array.isArray(cuentas) && cuentas.length > 0) return;

  const definicion = [
    { email: 'gerencia@gdp.cr', etiqueta: 'Gerencia', color: '#3D7A4A' },
    { email: 'proveedores@gdp.cr', etiqueta: 'Proveedores', color: '#B8860B' },
    { email: 'contabilidad@gdp.cr', etiqueta: 'Contabilidad', color: '#2980b9' },
    { email: 'ventas@gdp.cr', etiqueta: 'Ventas', color: '#7C3AED' },
  ];
  const creadas: any[] = [];
  for (const d of definicion) {
    const res = await fetch('/api/office/cuentas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    if (res.ok) creadas.push(await res.json());
  }
  const porEtiqueta = new Map(creadas.map((c) => [c.etiqueta, c.id]));

  const ahora = Date.now();
  const mins = (m: number) => new Date(ahora - m * 60000).toISOString();
  const mensajes = [
    { et: 'Proveedores', remitente: 'Huevos Pollo Feliz', email: 'facturacion@huevospollofeliz.cr', asunto: 'RE: Factura 0123 - cartones extra grandes', preview: 'Adjuntamos la factura 0123 corregida con el precio acordado.', labels: 'facturas', recibidos: 3, leido: 0, adj: 2, fecha: mins(4) },
    { et: 'Proveedores', remitente: 'Banco Nacional', email: 'notificaciones@bncr.cr', asunto: 'Estado de cuenta septiembre', preview: 'Su estado de cuenta de septiembre ya está disponible.', labels: '', recibidos: 1, leido: 0, adj: 1, fecha: mins(70) },
    { et: 'Ventas', remitente: 'Super Chepe', email: 'compras@superchepe.com', asunto: 'Pedido #410 - 50 cartones medianos', preview: 'Confirmamos el pedido para entrega el jueves.', labels: 'pedidos', recibidos: 1, leido: 1, adj: 0, fecha: mins(1500) },
    { et: 'Proveedores', remitente: 'Grupo Naco', email: 'ventas@gruponaco.cr', asunto: 'Cotizacion gallinaza a granel', preview: 'Adjunto la cotizacion solicitada en su totalidad.', labels: '', recibidos: 1, leido: 0, adj: 1, fecha: mins(4300) },
    { et: 'Gerencia', remitente: 'CCSS', email: 'notificacion@ccss.go.cr', asunto: 'Planilla setiembre', preview: 'Se adjunta la planilla de setiembre.', labels: '', recibidos: 1, leido: 1, adj: 0, fecha: mins(4400) },
  ];
  for (const m of mensajes) {
    await fetch('/api/office/mensajes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...m, threadId: `th-${m.asunto.replace(/[^a-zA-Z0-9]/g, '').slice(0, 18)}`, accountId: porEtiqueta.get(m.et) }),
    });
  }

  const reglas = [
    { nombreCuenta: 'proveedores@gdp.cr', carpeta: 'Drive/Finanzas/Proveedores', criterioTipo: 'subject', criterioValor: 'factura' },
    { nombreCuenta: 'contabilidad@gdp.cr', carpeta: 'Drive/Finanzas/Hacienda', criterioTipo: 'label', criterioValor: 'hacienda' },
    { nombreCuenta: 'ventas@gdp.cr', carpeta: 'Drive/Comercial/Pedidos', criterioTipo: 'label', criterioValor: 'pedidos' },
    { nombreCuenta: 'gerencia@gdp.cr', carpeta: null, criterioTipo: 'manual', criterioValor: '' },
  ];
  for (const r of reglas) {
    await fetch('/api/office/vinculaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
  }

  const docs = [
    { archivoNombre: 'Factura 0123.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 188416, origen: 'hilo', threadId: 'thREFactura0123cartones' },
    { archivoNombre: 'Acuse de recibo.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 43008, origen: 'hilo', threadId: 'thREFactura0123cartones' },
    { archivoNombre: 'Cotizacion gallinaza.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 98304, origen: 'hilo', threadId: 'thCotizaciongallinaza' },
    { archivoNombre: 'Orden de precios Naco.xlsx', archivoTipo: 'XLS', carpeta: 'Drive/Finanzas/Proveedores', bytes: 41984, origen: 'manual', threadId: null },
    { archivoNombre: 'Foto etiqueta recibida.jpg', archivoTipo: 'IMG', carpeta: 'Drive/Finanzas/Hacienda', bytes: 1258291, origen: 'manual', threadId: null },
  ];
  for (const d of docs) {
    await fetch('/api/office/documentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
  }
  await fetch('/api/office/sync', { method: 'POST' });
}

export default function Office({ currentUser, initialEspacio = 'correo' }: Props) {
  const [espacio, setEspacio] = useState<'correo' | 'documentos'>(initialEspacio);

  useEffect(() => { setEspacio(initialEspacio); }, [initialEspacio]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [arbol, setArbol] = useState<NodoCarpeta[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cuentaSel, setCuentaSel] = useState<string | null>(null);
  const [vista, setVista] = useState<string>('todos');
  const [carpetaSel, setCarpetaSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [conAdjuntos, setConAdjuntos] = useState(false);
  const [hilo, setHilo] = useState<{ mensajes: Mensaje[]; documentos: Documento[]; carpeta: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (cuentaSel) params.set('cuenta', cuentaSel);
      if (vista !== 'todos') params.set('vista', vista);
      if (conAdjuntos) params.set('conAdjuntos', 'true');
      if (q.trim()) params.set('q', q.trim());

      const dp = new URLSearchParams();
      if (carpetaSel) dp.set('carpeta', carpetaSel);
      if (q.trim()) dp.set('q', q.trim());

      const [rc, rm, rd, ra, rr] = await Promise.all([
        fetch('/api/office/cuentas'),
        fetch(`/api/office/mensajes?${params.toString()}`),
        fetch(`/api/office/documentos?${dp.toString()}`),
        fetch('/api/office/arbol'),
        fetch('/api/office/resumen'),
      ]);
      if (!rc.ok) throw new Error('No se pudieron cargar las cuentas');
      setCuentas(await rc.json());
      setMensajes(rm.ok ? await rm.json() : []);
      setDocs(rd.ok ? await rd.json() : []);
      const arbolRes = ra.ok ? await ra.json() : { arbol: [] };
      setArbol(arbolRes.arbol || []);
      setResumen(rr.ok ? await rr.json() : null);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Error de carga');
    } finally {
      setCargando(false);
    }
  }, [cuentaSel, vista, conAdjuntos, carpetaSel, q]);

  useEffect(() => {
    if (currentUser.role === 'Admin') void sembrarSiEstaVacio();
  }, [currentUser.role]);
  useEffect(() => { void cargar(); }, [cargar]);

  const abrirHilo = async (threadId: string) => {
    try {
      const r = await fetch(`/api/office/mensajes/${encodeURIComponent(threadId)}`);
      if (r.ok) {
        const d = await r.json();
        setHilo({ mensajes: d.hilo, documentos: d.documentos, carpeta: d.carpeta });
        if (d.hilo?.[0]?.leido === 0) {
          await fetch(`/api/office/mensajes/${d.hilo[0].id}/leer`, { method: 'POST' });
          void cargar();
        }
      }
    } catch { setError('No se pudo abrir el hilo'); }
  };

  const sincronizar = async () => {
    await fetch('/api/office/sync', { method: 'POST' });
    void cargar();
  };

  const marcarLeido = async (m: Mensaje) => {
    await fetch(`/api/office/mensajes/${m.id}/leer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leido: m.leido === 0 }),
    });
    void cargar();
  };

  const deseleccionar = () => { setCuentaSel(null); setCarpetaSel(null); };
  const vistasVisibles = useMemo(() => {
    if (espacio === 'documentos') return VISTAS.slice(0, 1);
    return VISTAS;
  }, [espacio]);

  return (
    <div className="gcrm">
      <Breadcrumb items={[
        { label: 'Office' },
        { label: espacio === 'correo' ? 'Correo' : 'Documentos' },
      ]} />
      {/* Tabs de espacio — Correo y Documentos nunca se ven a la vez */}
      <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
        {(['correo', 'documentos'] as const).map(k => (
          <button key={k} onClick={() => setEspacio(k)}
            className="pb-3 text-sm font-semibold transition-colors border-b-2"
            style={{
              color: espacio === k ? 'var(--brand-primary)' : 'var(--text-muted)',
              borderColor: espacio === k ? 'var(--brand-primary)' : 'transparent',
            }}>
            {k === 'correo' ? <span className="flex items-center gap-2"><Mail className="w-4 h-4" />Correo</span> : <span className="flex items-center gap-2"><FolderTree className="w-4 h-4" />Documentos</span>}
          </button>
        ))}
        <div className="ml-auto pb-2 flex gap-2">
          {espacio === 'correo'
            ? <button onClick={async () => {
                const email = prompt('Email de la cuenta a conectar');
                if (!email) return;
                const etiqueta = prompt('Etiqueta (Gerencia, Proveedores, Contabilidad, Ventas)') || 'Gerencia';
                const r = await fetch('/api/office/cuentas', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, etiqueta }),
                });
                if (!r.ok) { const e = await r.json().catch(() => ({})); setError(e.error || 'No se pudo conectar'); }
                void cargar();
              }} className="btn"><Mail className="w-3.5 h-3.5" />Conectar cuenta</button>
            : <SubirDocumento onDone={() => void cargar()} />}
        </div>
      </div>

      <div className="viewhead">
        <div>
          <h1>{espacio === 'correo' ? 'Correo' : 'Documentos'}</h1>
          <div className="sub">
            {espacio === 'correo'
              ? <>
                  {resumen?.cuentas ?? 0} cuentas conectadas · sincronizado {haceCuanto(resumen?.ultimoSync ?? null)} · {resumen?.sinLeer ?? 0} sin leer
                  {resumen && resumen.cuentasSinCarpeta > 0 && (
                    <span className="chip amber" style={{ marginLeft: 8 }}>
                      <AlertTriangle className="w-3 h-3" />{resumen.cuentasSinCarpeta} cuenta sin carpeta
                    </span>
                  )}
                </>
              : <>
                  {carpetaSel ?? 'Todas las carpetas'} · {docs.length} archivos
                  {resumen && resumen.documentosHuerfanos > 0 && (
                    <span className="chip amber" style={{ marginLeft: 8 }}><Unlink className="w-3 h-3" />{resumen.documentosHuerfanos} huérfano(s)</span>
                  )}
                </>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button className="btn" onClick={sincronizar} disabled={cargando}><RefreshCw className="w-3.5 h-3.5" />Actualizar</button>
          {espacio === 'correo' && <button className={cn('btn sm', conAdjuntos && 'brand')} onClick={() => setConAdjuntos(v => !v)}>Con adjuntos ▾</button>}
        </div>
      </div>

      {error && (
        <div className="chip red" style={{ padding: '8px 12px', marginBottom: 12 }}>
          <AlertTriangle className="w-3.5 h-3.5" />{error}
        </div>
      )}

      <div className="of-cols" style={{ marginTop: 14 }}>
        {/* Columna izquierda: cuentas (correo) o árbol de carpetas (documentos) */}
        <div>
          {espacio === 'correo' ? (
            <>
              <div className="sect">
                <h4>Cuentas</h4>
                <button className={cn('of-acct', !cuentaSel && 'on')} onClick={deseleccionar}>
                  <span className="dot green" />Todas<span className="b">{resumen?.mensajes ?? 0}</span>
                </button>
                {cuentas.map(c => (
                  <button key={c.id} className={cn('of-acct', cuentaSel === c.id && 'on')}
                    onClick={() => setCuentaSel(cuentaSel === c.id ? null : c.id)}>
                    <span className="dot" style={{ background: c.color }} />{c.etiqueta}
                    <span className="b">{c.sinLeer || c.mensajes}</span>
                  </button>
                ))}
              </div>
              <div className="sect" style={{ marginTop: 16 }}>
                <h4>Vistas</h4>
                {vistasVisibles.map(v => (
                  <button key={v.id} className={cn('of-acct', vista === v.id && 'on')} onClick={() => setVista(v.id)}>
                    {v.label}
                    <span className="b">{v.id === 'sin-responder' ? mensajes.filter(m => m.recibidos < 2 && m.leido === 0).length : v.id === 'con-documentos' ? mensajes.filter(m => m.adjuntoCount > 0).length : ''}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="sect">
              <h4>Carpetas</h4>
              <button className={cn('of-tree-f', !carpetaSel && 'on')} onClick={() => setCarpetaSel(null)}>
                📁 Todas las carpetas
              </button>
              {arbol.map(a => (
                <button key={a.carpeta} className={cn('of-tree-f', carpetaSel === a.carpeta && 'on')}
                  onClick={() => setCarpetaSel(carpetaSel === a.carpeta ? null : a.carpeta)}>
                  📁 {a.carpeta}<span className="b" style={{ marginLeft: 'auto', fontSize: 10 }}>{a.total}</span>
                </button>
              ))}
              {resumen && resumen.cuentasSinCarpeta > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button className="of-tree-f warn" disabled>
                    ⚠ Sin carpeta ({resumen.cuentasSinCarpeta})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Columna derecha: panel */}
        <div className="panel">
          <div className="panelbar">
            <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink3)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', paddingLeft: 26 }}
                placeholder={espacio === 'correo' ? 'Buscar en el correo…' : 'Buscar en carpeta…'} />
            </div>
            <span className="chip">{espacio === 'correo' ? 'Todos los remitentes' : 'Todos los tipos'}</span>
          </div>

          {cargando && <div className="chip" style={{ padding: '10px 14px' }}>Cargando…</div>}

          {!cargando && espacio === 'correo' && mensajes.map(m => (
            <div key={m.id} className={cn('of-row', m.leido === 0 && 'on')}>
              <span className="av-mini" style={{ background: m.colorCuenta, color: '#fff' }}>
                {m.remitente.charAt(0)}
              </span>
              <button className="of-txt text-left" onClick={() => void abrirHilo(m.threadId)} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
                <span className="of-who">{m.remitente}</span>{' '}
                <span className="of-subj">{m.asunto}</span>
              </button>
              {m.adjuntoCount > 0 && <span className="chip blue"><Paperclip className="w-3 h-3" />{m.adjuntoCount}</span>}
              <span className="of-ti">{fmtFecha(m.fecha)}</span>
              <span className="of-hact">
                <button className="btn sm" onClick={() => void abrirHilo(m.threadId)}>Abrir</button>
                <button className="btn sm" onClick={() => void marcarLeido(m)}>{m.leido === 0 ? '✓' : '○'}</button>
              </span>
            </div>
          ))}

          {!cargando && espacio === 'documentos' && docs.map(d => (
            <div key={d.id} className="of-row">
              <span className="of-ic2" style={{ background: COLOR_TIPO[d.archivoTipo] || '#64748B' }}>{d.archivoTipo}</span>
              <span className="of-txt">
                <span className="of-who">{d.archivoNombre}</span>{' '}
                <span className="of-subj">{fmtFecha(d.fecha)} · {fmtBytes(d.archivoBytes)} · {d.carpeta ?? 'sin carpeta'}</span>
              </span>
              {d.huerfano ? <span className="chip amber">huérfano</span> : <span className="chip blue">de hilo</span>}
              <span className="of-hact">
                {d.huerfano
                  ? <button className="btn sm" onClick={() => setHilo({ mensajes: [], documentos: [d], carpeta: d.carpeta })}><Link2 className="w-3 h-3" />Vincular</button>
                  : <button className="btn sm" onClick={() => void abrirHilo(d.threadId!)}><Eye className="w-3 h-3" />Vista previa</button>}
              </span>
            </div>
          ))}

          {!cargando && (espacio === 'correo' ? mensajes.length === 0 : docs.length === 0) && (
            <div style={{ padding: 20, fontSize: 12, color: 'var(--ink3)' }}>
              {espacio === 'correo' ? 'No hay mensajes con estos filtros.' : 'No hay documentos en esta carpeta.'}
            </div>
          )}

          {espacio === 'documentos' && docs.length > 0 && (
            <div className="of-meta">
              <span>Ubicación: <b>{carpetaSel ?? docs[0].carpeta ?? '—'}</b></span>
              <span>Vínculo: <b style={{ color: 'var(--brand)' }}>{docs.some(d => d.huerfano) ? 'mixto (algunos huérfanos)' : 'automático'}</b></span>
              <span style={{ marginLeft: 'auto' }}>{resumen?.documentosHuerfanos ?? 0} sin hilo</span>
            </div>
          )}
        </div>
      </div>

      {/* Drawer — mismo patrón de Cliente360 */}
      {hilo && (
        <div className="drawer-fixed" onClick={() => setHilo(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="identity">
              <div className="main">
                <div style={{ minWidth: 0 }}>
                  <div className="of-who" style={{ fontSize: 15, fontWeight: 800 }}>
                    {hilo.mensajes[0]?.asunto || hilo.documentos[0]?.archivoNombre || 'Documento'}
                  </div>
                  <div className="mini" style={{ marginTop: 4 }}>
                    {hilo.mensajes[0]
                      ? `${hilo.mensajes[0].remitente} · ${hilo.mensajes[0].remitenteEmail} · ${hilo.mensajes.length} mensajes`
                      : `${hilo.documentos[0]?.archivoTipo} · ${fmtBytes(hilo.documentos[0]?.archivoBytes ?? null)}`}
                  </div>
                </div>
              </div>
              <button className="btn ico" onClick={() => setHilo(null)} aria-label="Cerrar"><X className="w-4 h-4" /></button>
            </div>

            <div className="drawer-body">
              {hilo.mensajes[0] && (
                <>
                  <div className="kv"><span>Hilo</span><b>{hilo.mensajes.length} mensajes</b></div>
                  <div className="kv"><span>Cuenta</span><b>{hilo.mensajes[0].etiquetaCuenta}</b></div>
                  <div className="kv">
                    <span>Vinculado a</span>
                    <b>{hilo.carpeta ? <span style={{ color: 'var(--brand)' }}>{hilo.carpeta}</span> : <span style={{ color: 'var(--amber)' }}>sin carpeta (ver Admin › Vinculaciones)</span>}</b>
                  </div>
                  <div className="sect" style={{ marginTop: 16 }}>
                    <h4>Mensajes</h4>
                    {hilo.mensajes.map((m, i) => (
                      <div key={m.id} className="of-msg">
                        <b>{m.remitente} · {fmtFecha(m.fecha)}</b><br />{m.preview || m.asunto}
                        {i === 0 && m.labelIds && <div style={{ marginTop: 6 }}><span className="chip">#{m.labelIds}</span></div>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="sect" style={{ marginTop: 16 }}>
                <h4>Documentos vinculados</h4>
                {hilo.documentos.length === 0 && (
                  <div className="mini">Sin documentos en este hilo.</div>
                )}
                {hilo.documentos.map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '9px 10px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, fontSize: 11.5 }}>
                    <span className="of-ic2" style={{ background: COLOR_TIPO[d.archivoTipo] || '#64748B' }}>{d.archivoTipo}</span>
                    <span style={{ minWidth: 0 }}>
                      <b>{d.archivoNombre}</b><br />
                      <span className="mini">{fmtFecha(d.fecha)} · {fmtBytes(d.archivoBytes)} · {d.carpeta ?? 'sin carpeta'}</span>
                    </span>
                    <span className="ml-auto flex gap-1.5 items-center">
                      <span className={cn('chip', d.huerfano ? 'amber' : 'blue')}>{d.huerfano ? 'huérfano' : 'de hilo'}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="of-foot">
              <button className="btn sm brand"><Eye className="w-3 h-3" />Vista previa</button>
              <button className="btn sm">Descargar</button>
              <button className="btn sm"><Link2 className="w-3 h-3" />Vincular a carpeta…</button>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setHilo(null)}>Ir a Documentos →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubirDocumento({ onDone }: { onDone: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('PDF');
  const [carpeta, setCarpeta] = useState('');
  const [bytes, setBytes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const enviar = async () => {
    setErr(null);
    const r = await fetch('/api/office/documentos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivoNombre: nombre, archivoTipo: tipo, carpeta, bytes: Number(bytes || 0) }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); setErr(e.error || 'No se pudo subir'); return; }
    setAbierto(false); setNombre(''); setBytes(''); onDone();
  };

  if (!abierto) {
    return <button className="btn" onClick={() => setAbierto(true)}>Subir documento</button>;
  }
  return (
    <div className="panel" style={{ padding: 14, marginTop: 8, width: 340 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Subir documento</div>
      <div className="flex flex-col gap-2">
        <input placeholder="Nombre del archivo" value={nombre} onChange={e => setNombre(e.target.value)} className="panel-in" />
        <div className="flex gap-2">
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="panel-in">
            {['PDF', 'XLS', 'DOC', 'IMG'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Tamaño en bytes" value={bytes} onChange={e => setBytes(e.target.value)} className="panel-in" style={{ flex: 1 }} />
        </div>
        <input placeholder="Carpeta destino (ej. Drive/Finanzas/Proveedores)" value={carpeta} onChange={e => setCarpeta(e.target.value)} className="panel-in" />
        {err && <span className="chip red">{err}</span>}
        <div className="flex gap-2">
          <button className="btn brand sm" onClick={enviar}>Subir</button>
          <button className="btn sm" onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
