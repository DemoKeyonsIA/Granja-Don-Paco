import React, { useState, useEffect, useCallback } from 'react';
import { Link2, Search, AlertTriangle, Play, Trash2, Plus, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from '../types';
import './gcrm.css';

interface Props { currentUser: User; }

interface Regla {
  id: string; nombreCuenta: string; carpeta: string | null; driveFolderId: string | null;
  criterioTipo: 'label' | 'from' | 'subject' | 'manual'; criterioValor: string;
  automatico: number; estado: string; fechaCreacion: string;
  archivos: number; requiereAccion: boolean;
}

interface ResultadoPrueba {
  reglas: { id: string; nombreCuenta: string; carpeta: string | null; coincide: number; ejemplos: { asunto: string; remitente: string; adjuntoCount: number }[] }[];
  sinRegla: { coincide: number; ejemplos: { asunto: string; remitente: string; adjuntoCount: number }[] };
  totalMensajes: number;
}

const ETIQUETA_CITERIO: Record<string, string> = {
  label: 'Etiqueta Gmail', from: 'Remitente contiene', subject: 'Asunto contiene', manual: 'Manual',
};

export default function OfficeVinculos({ currentUser }: Props) {
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  const [probando, setProbando] = useState(false);
  const [alta, setAlta] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/office/vinculaciones');
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.error || 'No se pudieron cargar las reglas');
        setReglas([]); return;
      }
      setReglas(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Error de carga');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const probar = async () => {
    setProbando(true);
    try {
      const r = await fetch('/api/office/vinculaciones/probar', { method: 'POST' });
      if (r.ok) setPrueba(await r.json());
    } finally {
      setProbando(false);
    }
  };

  const eliminar = async (id: string) => {
    await fetch(`/api/office/vinculaciones/${id}`, { method: 'DELETE' });
    setPrueba(null);
    void cargar();
  };

  const visibles = reglas.filter(r =>
    !q.trim() || `${r.nombreCuenta} ${r.carpeta ?? ''} ${r.criterioValor}`.toLowerCase().includes(q.trim().toLowerCase()));
  const sinCarpeta = reglas.filter(r => r.requiereAccion).length;

  return (
    <div className="gcrm">
      <div className="viewhead">
        <div>
          <h1>Vinculaciones</h1>
          <div className="sub">
            {reglas.filter(r => r.estado === 'Activa').length} reglas activas ·{' '}
            {sinCarpeta > 0 ? `${sinCarpeta} cuenta sin carpeta` : 'todas las cuentas tienen carpeta'} ·{' '}
            Auto-clasifica adjuntos de correo y documentos electrónicos
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button className="btn" onClick={probar} disabled={probando}>
            <Play className="w-3.5 h-3.5" />{probando ? 'Probando…' : 'Probar reglas'}
          </button>
          <button className="btn sm" onClick={() => setAlta(true)}><Plus className="w-3.5 h-3.5" />Nueva regla</button>
        </div>
      </div>

      {error && <div className="chip red" style={{ padding: '8px 12px', marginBottom: 12 }}><AlertTriangle className="w-3.5 h-3.5" />{error}</div>}

      {alta && <FormRegla onCerrar={() => setAlta(false)} onGuardado={() => { setAlta(false); setPrueba(null); void cargar(); }} currentUser={currentUser} />}

      <div className="panel">
        <div className="panelbar">
          <div style={{ position: 'relative', flex: 1, maxWidth: 240 }}>
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink3)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', paddingLeft: 26 }}
              placeholder="Buscar regla, cuenta o carpeta…" />
          </div>
          <span className="chip">Todas las cuentas</span>
          {sinCarpeta > 0 && <span className="chip amber">{sinCarpeta} sin carpeta</span>}
        </div>

        {cargando && <div className="chip" style={{ padding: '10px 14px' }}>Cargando…</div>}

        {!cargando && visibles.map(r => (
          <div key={r.id} className={cn('of-row', r.requiereAccion && 'on')}>
            <span className="of-txt">
              <span className="of-who">{r.nombreCuenta}</span>{' '}
              <span className="of-subj">
                → {r.carpeta
                  ? <span style={{ color: 'var(--brand)' }}>{r.carpeta}</span>
                  : <b style={{ color: 'var(--amber)' }}>sin carpeta destino</b>}
              </span>
            </span>
            <span className="chip">{ETIQUETA_CITERIO[r.criterioTipo]}{r.criterioValor ? ` "${r.criterioValor}"` : ''}</span>
            {r.criterioTipo === 'manual' ? <span className="chip amber">manual</span> : <span className="chip blue">auto</span>}
            {r.requiereAccion && <span className="chip amber">requiere acción</span>}
            <span className="of-ti">{r.archivos} archivos</span>
            <span className="of-hact">
              <button className="btn sm" onClick={probar}><Play className="w-3 h-3" />Probar</button>
              <button className="btn sm" onClick={() => void eliminar(r.id)}><Trash2 className="w-3 h-3" /></button>
            </span>
          </div>
        ))}

        {!cargando && visibles.length === 0 && (
          <div style={{ padding: 20, fontSize: 12, color: 'var(--ink3)' }}>
            {reglas.length === 0 ? 'No hay reglas configuradas.' : 'Ninguna regla coincide con la búsqueda.'}
          </div>
        )}

        <div className="of-meta">
          <span>Criterio: <b>etiqueta Gmail · remitente · asunto</b></span>
          <span>Destino: <b>carpeta</b></span>
          <span>Efecto: <b style={{ color: 'var(--brand)' }}>indexa archivo ↔ hilo ↔ entidad</b></span>
          <span style={{ marginLeft: 'auto' }}>Solo Admin</span>
        </div>
      </div>

      {prueba && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <span className="panel-title"><Play className="w-4 h-4" />Resultado de la prueba (dry-run, no escribe nada)</span>
            <button className="btn sm" onClick={() => setPrueba(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="admin-table-scroll">
          <table className="gcrm-table">
            <thead><tr><th>Regla</th><th>Carpeta</th><th className="num">Mensajes</th><th>Ejemplos</th></tr></thead>
            <tbody>
              {prueba.reglas.map(r => (
                <tr key={r.id}>
                  <td>{r.nombreCuenta}</td>
                  <td>{r.carpeta ?? <span className="chip amber">sin carpeta</span>}</td>
                  <td className="num">{r.coincide}</td>
                  <td className="mini">{r.ejemplos.length ? r.ejemplos.map(e => e.asunto).join(' · ') : '—'}</td>
                </tr>
              ))}
              <tr>
                <td><b>Sin regla</b></td>
                <td>—</td>
                <td className="num">{prueba.sinRegla.coincide}</td>
                <td className="mini">{prueba.sinRegla.ejemplos.length ? prueba.sinRegla.ejemplos.map(e => e.asunto).join(' · ') : '—'}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <div className="of-meta">
            <span>{prueba.totalMensajes} mensajes evaluados contra {prueba.reglas.length} reglas</span>
            <span style={{ marginLeft: 'auto' }}><Check className="w-3 h-3" />dry-run: nada se modificó</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FormRegla({ onCerrar, onGuardado, currentUser }: { onCerrar: () => void; onGuardado: () => void; currentUser: User }) {
  const [nombreCuenta, setNombreCuenta] = useState('');
  const [carpeta, setCarpeta] = useState('');
  const [criterioTipo, setCriterioTipo] = useState<'label' | 'from' | 'subject' | 'manual'>('subject');
  const [criterioValor, setCriterioValor] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setErr(null); setGuardando(true);
    try {
      const r = await fetch('/api/office/vinculaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombreCuenta, carpeta: carpeta || null, criterioTipo, criterioValor }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); setErr(e.error || 'No se pudo guardar'); return; }
      onGuardado();
    } finally { setGuardando(false); }
  };

  return (
    <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}><Link2 className="w-4 h-4" />Nueva regla de vinculación</div>
      <div className="flex flex-wrap gap-2 items-center">
        <input className="panel-in" style={{ maxWidth: 240 }} placeholder="Correo de la cuenta (ej. proveedores@gdp.cr)"
          value={nombreCuenta} onChange={e => setNombreCuenta(e.target.value)} />
        <select className="panel-in" style={{ maxWidth: 200 }} value={criterioTipo} onChange={e => setCriterioTipo(e.target.value as any)}>
          {Object.entries(ETIQUETA_CITERIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {criterioTipo !== 'manual' && (
          <input className="panel-in" style={{ maxWidth: 180 }} placeholder={criterioTipo === 'label' ? 'hacienda' : 'factura'}
            value={criterioValor} onChange={e => setCriterioValor(e.target.value)} />
        )}
        <input className="panel-in" style={{ maxWidth: 280 }} placeholder="Carpeta destino (ej. Drive/Finanzas/Proveedores)"
          value={carpeta} onChange={e => setCarpeta(e.target.value)} />
        {err && <span className="chip red">{err}</span>}
        <button className="btn brand sm" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar regla'}
        </button>
        <button className="btn sm" onClick={onCerrar}>Cancelar</button>
      </div>
      <div className="mini" style={{ marginTop: 8 }}>
        Creada por {currentUser.name}. Las reglas automáticas requieren carpeta destino; las manuales pueden quedar pendientes.
      </div>
    </div>
  );
}
