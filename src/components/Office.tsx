import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, RefreshCw, Search, Mail, FolderTree, Link2, AlertTriangle, Unlink, Eye, Paperclip,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { sembrarOfficeInicial } from '../lib/officeSeed';
import { loadSession } from '../lib/session';
import { toast } from 'sonner';
import { User } from '../types';
import { rolesEfectivos, espacioOfficeDe, subTabsDe, type EspacioOffice } from '../nav/modulos';
import Breadcrumb from './Breadcrumb';
import './gcrm.css';

/** Los ids de `ESPACIOS_OFFICE`, derivados de la configuración y no repetidos. */
type Espacio = EspacioOffice;

interface Props { currentUser: User; initialEspacio?: Espacio; }

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

/**
 * Iconos de la fila de espacios.
 *
 * Vive aquí y no en `modulos.ts` porque ese módulo es puro y no importa lucide;
 * los ids, en cambio, salen de `ESPACIOS_OFFICE`. Un espacio visible sin entrada
 * aquí no se ve raro: React falla al montar la fila, y con ella toda la pantalla
 * de Office.
 */
const ICONO_ESPACIO: Record<string, React.ComponentType<{ className?: string }>> = {
  correo: Mail,
  documentos: FolderTree,
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

/**
 * Provider local: si no hay cuentas, sembramos la bandeja inicial.
 *
 * El seed vive en src/lib/officeSeed.ts y no aqui: este componente importa
 * ./gcrm.css, y cualquier modulo que lo importe se lleva el CSS a un
 * consumidor de Node. Ahi queda tambien como dato declarativo, verificable
 * con scripts/sembrar-office.ts sin levantar React.
 */
const sembrarSiEstaVacio = (f: typeof fetch) => sembrarOfficeInicial(f);

/**
 * Auth de las llamadas de Office. `requireOfficeViewer` delega en
 * `requirePermission('office','view')`, que termina en `resolveUsuario`, y ese solo
 * acepta un header `Bearer` o `x-user-id`: no hay cookie. Con `fetch` pelado las
 * cinco llamadas de `cargar` devolvian 401 y la pantalla se quedaba en "No se pudieron
 * cargar las cuentas" con los datos sembrados en la base. Ningun otro modulo lo notaba
 * porque sus endpoints no exigen auth.
 *
 * Se mandan los dos: el token valida la sesion (caducada o usuario desactivado cortan) y
 * el `x-user-id` es el patron que ya usan Facturacion, CajaRuta y TableroRutas. El rol
 * nunca viaja en el header; lo resuelve el server contra la BD.
 *
 * Vive a nivel de modulo y no dentro de `Office` porque `SubirDocumento` tambien
 * habla con la API y no recibe `currentUser` por props.
 */
function fetchOffice(userId: string | number, url: string, init: RequestInit = {}) {
  const token = loadSession()?.token;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) || {}),
    'x-user-id': String(userId),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

export default function Office({ currentUser, initialEspacio = 'correo' }: Props) {
  // La fila y la pantalla usan el mismo filtro. Si se calcularan por separado,
  // un rol sin permiso podría ver el tab y montar la pantalla, o al revés:
  // abrir un espacio invisible desde una URL.
  //
  // `rolesEfectivos` devuelve un array nuevo en cada llamada, y eso importa:
  // sin memorizarlo, `espacioPermitido` cambia de identidad en cada render, el
  // efecto que sincroniza `initialEspacio` se dispara siempre y el click en la
  // fila se pierde, porque `espacio` vuelve a su valor inicial en el mismo ciclo.
  const roles = useMemo(
    () => rolesEfectivos(currentUser.role, currentUser.roles),
    [currentUser.role, currentUser.roles],
  );
  const puedeEditarOffice = roles.includes('Admin');
  const espacios = useMemo(() => subTabsDe('office', roles), [roles]);
  const espacioPermitido = useCallback((id: string) => espacioOfficeDe(id, roles), [roles]);
  const [espacio, setEspacio] = useState<Espacio>(() => espacioPermitido(initialEspacio));

  useEffect(() => { setEspacio(espacioPermitido(initialEspacio)); }, [initialEspacio, espacioPermitido]);
  // Estado de la última ejecución del efecto de carga, para distinguir tres
  // causas que antes iban juntas en la dependencia `cargar`: primera carga,
  // cambio de filtro y cambio de espacio.
  const cargaPrevia = useRef<{ espacio: Espacio; cargar: typeof cargar } | null>(null);
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
  const [documentoVista, setDocumentoVista] = useState<Documento | null>(null);
  const [documentosMover, setDocumentosMover] = useState<Documento[] | null>(null);
  const [carpetaDestino, setCarpetaDestino] = useState('');
  const [guardandoCarpeta, setGuardandoCarpeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Auth de todas las llamadas de Office: ver `fetchOffice` arriba.
  const apiFetch = useCallback(
    (url: string, init: RequestInit = {}) => fetchOffice(currentUser.id, url, init),
    [currentUser.id],
  );

  const cargar = useCallback(async () => {
    try {
      setError(null);
      try { await sembrarOfficeInicial(); } catch {}
      const params = new URLSearchParams();
      if (cuentaSel) params.set('cuenta', cuentaSel);
      if (vista !== 'todos') params.set('vista', vista);
      if (conAdjuntos) params.set('conAdjuntos', 'true');
      if (q.trim()) params.set('q', q.trim());
      const dp = new URLSearchParams();
      if (carpetaSel) dp.set('carpeta', carpetaSel);
      if (q.trim()) dp.set('q', q.trim());
      const [rc, rm, rd, ra, rr] = await Promise.all([
        apiFetch('/api/office/cuentas').catch(()=>null),
        apiFetch(`/api/office/mensajes?${params.toString()}`).catch(()=>null),
        apiFetch(`/api/office/documentos?${dp.toString()}`).catch(()=>null),
        apiFetch('/api/office/arbol').catch(()=>null),
        apiFetch('/api/office/resumen').catch(()=>null),
      ]);
      if (rc && rc.ok) setCuentas(await rc.json()); else setCuentas([]);
      setMensajes((rm && rm.ok) ? await rm.json() : []);
      setDocs((rd && rd.ok) ? await rd.json() : []);
      const arbolRes = (ra && ra.ok) ? await ra.json() : { arbol: [] };
      setArbol(arbolRes.arbol || []);
      setResumen((rr && rr.ok) ? await rr.json() : { cuentas: 1, mensajes: 0, sinLeer: 0, documentos: 0, reglasActivas: 0, reglas: 0, cuentasSinCarpeta: 0, documentosHuerfanos: 0, ultimoSync: null });
    } catch (e: any) {
      setError(e.message || 'Error de carga');
    } finally {
      setCargando(false);
    }
  }, [apiFetch, cuentaSel, vista, conAdjuntos, carpetaSel, q]);

  // Sembrar la bandeja de ejemplo es una sola vez por montaje. Antes colgaba de
  // `espacio`, con lo que cambiar de espacio volvía a disparar el `GET` (y los
  // `POST` de cuentas) de una siembra que ya había ocurrido.
  const sembrado = useRef(false);
  useEffect(() => {
    if (currentUser.role !== 'Admin' || sembrado.current) return;
    sembrado.current = true;
    void sembrarSiEstaVacio(apiFetch);
  }, [currentUser.role]);
  useEffect(() => {
    // Correo y Documentos comparten la misma bandeja, así que cambiar entre los
    // dos no recarga: lo que se necesita ya está en memoria.
    const previa = cargaPrevia.current;
    cargaPrevia.current = { espacio, cargar };
    const cambiaFiltro = previa !== null && previa.cargar !== cargar;
    if (previa === null || cambiaFiltro) void cargar();
  }, [cargar, espacio]);

  const abrirHilo = async (threadId: string) => {
    try {
      const r = await apiFetch(`/api/office/mensajes/${encodeURIComponent(threadId)}`);
      if (r.ok) {
        const d = await r.json();
        setHilo({ mensajes: d.hilo, documentos: d.documentos, carpeta: d.carpeta });
        if (d.hilo?.[0]?.leido === 0) {
          await apiFetch(`/api/office/mensajes/${d.hilo[0].id}/leer`, { method: 'POST' });
          void cargar();
        }
      }
    } catch { setError('No se pudo abrir el hilo'); }
  };

  const sincronizar = async () => {
    await apiFetch('/api/office/sync', { method: 'POST' });
    void cargar();
  };

  const marcarLeido = async (m: Mensaje) => {
    await apiFetch(`/api/office/mensajes/${m.id}/leer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leido: m.leido === 0 }),
    });
    void cargar();
  };

  const descargarFichaDocumento = (doc: Documento) => {
    const contenido = [
      `FICHA DE DOCUMENTO — ${doc.archivoNombre}`,
      `Tipo: ${doc.archivoTipo}`,
      `Tamaño registrado: ${fmtBytes(doc.archivoBytes)}`,
      `Carpeta: ${doc.carpeta || 'Sin carpeta'}`,
      `Origen: ${doc.origen}`,
      `Fecha de registro: ${new Date(doc.fecha).toLocaleString('es-CR')}`,
      `Estado de vínculo: ${doc.huerfano ? 'Sin hilo vinculado' : 'Vinculado a un hilo'}`,
      '',
      'Esta ficha contiene metadatos del demo. El archivo binario original no está almacenado.',
    ].join('\n');
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.archivoNombre.replace(/[<>:"/\\|?*]/g, '_')}-ficha.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const descargarFichasDocumentos = (lista: Documento[]) => {
    const contenido = lista.map(doc => [
      `FICHA DE DOCUMENTO — ${doc.archivoNombre}`,
      `Tipo: ${doc.archivoTipo}`,
      `Tamaño registrado: ${fmtBytes(doc.archivoBytes)}`,
      `Carpeta: ${doc.carpeta || 'Sin carpeta'}`,
      `Origen: ${doc.origen}`,
      `Fecha de registro: ${new Date(doc.fecha).toLocaleString('es-CR')}`,
      `Estado de vínculo: ${doc.huerfano ? 'Sin hilo vinculado' : 'Vinculado a un hilo'}`,
    ].join('\n')).join('\n\n------------------------------\n\n');
    const url = URL.createObjectURL(new Blob([`${contenido}\n\nEsta descarga contiene fichas de metadatos; no incluye los archivos originales.`], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fichas-documentos.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const guardarCarpetaDocumento = async () => {
    if (!documentosMover?.length) return;
    setGuardandoCarpeta(true);
    try {
      const actualizados = await Promise.all(documentosMover.map(async doc => {
        const r = await apiFetch(`/api/office/documentos/${encodeURIComponent(doc.id)}/carpeta`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carpeta: carpetaDestino }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `No se pudo cambiar la carpeta de ${doc.archivoNombre}`);
        return data as Documento;
      }));
      const porId = new Map(actualizados.map(d => [d.id, d]));
      setDocs(prev => prev.map(d => porId.has(d.id) ? { ...d, ...porId.get(d.id)! } : d));
      setHilo(prev => prev ? {
        ...prev,
        carpeta: prev.documentos.some(d => porId.has(d.id)) ? carpetaDestino : prev.carpeta,
        documentos: prev.documentos.map(d => porId.has(d.id) ? { ...d, ...porId.get(d.id)! } : d),
      } : prev);
      setDocumentosMover(null);
      setCarpetaDestino('');
      toast.success('Carpeta del documento actualizada');
      void cargar();
    } catch (e: any) {
      setError(e.message || 'No se pudo cambiar la carpeta');
    } finally {
      setGuardandoCarpeta(false);
    }
  };

  const deseleccionar = () => { setCuentaSel(null); setCarpetaSel(null); };
  const vistasVisibles = useMemo(() => {
    if (espacio === 'documentos') return VISTAS.slice(0, 1);
    return VISTAS;
  }, [espacio]);

  const filaEspacios = (
    <div data-testid="office-espacios" className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
      {espacios.map(e => {
        const Icono = ICONO_ESPACIO[e.id];
        return (
          <button key={e.id} data-espacio-id={e.id} aria-current={espacio === e.id ? 'page' : undefined}
            onClick={() => setEspacio(e.id as Espacio)}
            className="pb-3 text-sm font-semibold transition-colors border-b-2"
            style={{
              color: espacio === e.id ? 'var(--brand-primary)' : 'var(--text-muted)',
              borderColor: espacio === e.id ? 'var(--brand-primary)' : 'transparent',
            }}>
            <span className="flex items-center gap-2"><Icono className="w-4 h-4" />{e.label}</span>
          </button>
        );
      })}
      {/* Correo y Documentos nunca se ven a la vez */}
      <div className="ml-auto pb-2 flex gap-2">
        {espacio === 'correo'
          ? <button onClick={async () => {
              const email = prompt('Email de la cuenta a conectar');
              if (!email) return;
              const etiqueta = prompt('Etiqueta (Gerencia, Proveedores, Contabilidad, Ventas)') || 'Gerencia';
              const r = await apiFetch('/api/office/cuentas', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, etiqueta }),
              });
              if (!r.ok) { const e = await r.json().catch(() => ({})); setError(e.error || 'No se pudo conectar'); }
              void cargar();
            }} className="btn"><Mail className="w-3.5 h-3.5" />Conectar cuenta</button>
          : espacio === 'documentos' && <SubirDocumento currentUser={currentUser} onDone={() => void cargar()} />}
      </div>
    </div>
  );

  return (
    <div className="gcrm">
      <Breadcrumb items={[
        { label: 'Dirección' },
        { label: espacio === 'correo' ? 'Correo' : 'Documentos' },
      ]} />
      {filaEspacios}

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
                    <b>{hilo.carpeta ? <span style={{ color: 'var(--brand)' }}>{hilo.carpeta}</span> : <span style={{ color: 'var(--amber)' }}>sin carpeta (ver Office › Vinculaciones)</span>}</b>
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
              <button className="btn sm brand" disabled={!hilo.documentos.length} onClick={() => setDocumentoVista(hilo.documentos[0] || null)}><Eye className="w-3 h-3" />Ver ficha</button>
              <button className="btn sm" disabled={!hilo.documentos.length} onClick={() => descargarFichasDocumentos(hilo.documentos)}>Descargar fichas</button>
              {puedeEditarOffice && hilo.documentos.length > 0 && <button className="btn sm" onClick={() => { setError(null); setDocumentosMover(hilo.documentos); setCarpetaDestino(hilo.documentos.length > 0 && hilo.documentos.every(d => d.carpeta === hilo.documentos[0].carpeta) ? hilo.documentos[0].carpeta || '' : ''); }}><Link2 className="w-3 h-3" />Mover a carpeta</button>}
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setHilo(null)}>Ir a Documentos →</button>
            </div>
          </div>
        </div>
      )}

      {documentoVista && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setDocumentoVista(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="office-preview-title" className="w-full max-w-lg rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 id="office-preview-title" className="text-lg font-extrabold">Ficha del documento</h3><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{documentoVista.archivoNombre}</p></div>
              <button className="btn ico" onClick={() => setDocumentoVista(null)} aria-label="Cerrar ficha"><X className="w-4 h-4" /></button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt style={{ color: 'var(--text-muted)' }}>Tipo</dt><dd className="font-bold">{documentoVista.archivoTipo}</dd></div>
              <div><dt style={{ color: 'var(--text-muted)' }}>Tamaño registrado</dt><dd className="font-bold">{fmtBytes(documentoVista.archivoBytes)}</dd></div>
              <div><dt style={{ color: 'var(--text-muted)' }}>Carpeta</dt><dd className="font-bold">{documentoVista.carpeta || 'Sin carpeta'}</dd></div>
              <div><dt style={{ color: 'var(--text-muted)' }}>Fecha</dt><dd className="font-bold">{fmtFecha(documentoVista.fecha)}</dd></div>
            </dl>
            <p className="mt-4 rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>El demo conserva los datos del documento, pero no almacena su archivo digital; por eso no hay contenido original para previsualizar.</p>
            <div className="mt-4 flex justify-end"><button className="btn sm brand" onClick={() => descargarFichaDocumento(documentoVista)}>Descargar ficha</button></div>
          </section>
        </div>
      )}

      {documentosMover && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !guardandoCarpeta && setDocumentosMover(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="office-folder-title" className="w-full max-w-md rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
            <h3 id="office-folder-title" className="text-lg font-extrabold">Mover a carpeta</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{documentosMover.length === 1 ? documentosMover[0].archivoNombre : `${documentosMover.length} documentos del hilo`}</p>
            <label className="mt-4 block text-sm font-bold" htmlFor="office-carpeta-destino">Carpeta destino</label>
            <input id="office-carpeta-destino" list="office-carpetas-existentes" value={carpetaDestino} onChange={e => setCarpetaDestino(e.target.value)} placeholder="Ej. Drive/Finanzas/Proveedores" className="panel-in mt-2 w-full" maxLength={200} />
            <datalist id="office-carpetas-existentes">{arbol.map(item => <option key={item.carpeta} value={item.carpeta} />)}</datalist>
            {error && <p className="mt-2 text-sm" style={{ color: 'var(--status-danger)' }}>{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn sm" disabled={guardandoCarpeta} onClick={() => setDocumentosMover(null)}>Cancelar</button>
              <button className="btn sm brand" disabled={guardandoCarpeta || !carpetaDestino.trim()} onClick={() => void guardarCarpetaDocumento()}>{guardandoCarpeta ? 'Guardando…' : 'Guardar carpeta'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SubirDocumento({ currentUser, onDone }: { currentUser: User; onDone: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('PDF');
  const [carpeta, setCarpeta] = useState('');
  const [bytes, setBytes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const enviar = async () => {
    setErr(null);
    const r = await fetchOffice(currentUser.id, '/api/office/documentos', {
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
