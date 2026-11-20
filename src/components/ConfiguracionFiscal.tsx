import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Save, ShieldCheck, RefreshCw } from 'lucide-react';
import { sessionHeaders } from '../lib/session';
import type { User } from '../types';

type PerfilFiscal = {
  razonSocial: string; identificacionTipo: string; identificacion: string; actividadEconomica: string;
  nombreComercial: string; correo: string; telefono: string; provincia: string; canton: string;
  distrito: string; barrio: string; otrasSenas: string; monedaPresentacion: string;
  estadoRevision: string; referenciaEvidencia: string; revisorNombre: string; revisorCredencial: string;
  actualizadoEn?: string;
};
const VACIO: PerfilFiscal = { razonSocial: '', identificacionTipo: '', identificacion: '', actividadEconomica: '', nombreComercial: '', correo: '', telefono: '', provincia: '', canton: '', distrito: '', barrio: '', otrasSenas: '', monedaPresentacion: 'CRC', estadoRevision: 'Pendiente', referenciaEvidencia: '', revisorNombre: '', revisorCredencial: '' };
const CAMPOS: Array<[keyof PerfilFiscal, string, string?]> = [
  ['razonSocial', 'Razón social legal'], ['identificacion', 'Identificación tributaria'], ['actividadEconomica', 'Código de actividad económica'],
  ['nombreComercial', 'Nombre comercial (opcional)'], ['correo', 'Correo para comprobantes'], ['telefono', 'Teléfono'],
  ['provincia', 'Provincia'], ['canton', 'Cantón'], ['distrito', 'Distrito'], ['barrio', 'Barrio (opcional)'], ['otrasSenas', 'Otras señas'],
];

export default function ConfiguracionFiscal({ currentUser }: { currentUser: User }) {
  const [perfil, setPerfil] = useState<PerfilFiscal>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [estadoMaestros, setEstadoMaestros] = useState<any>(null);
  const [revisandoMaestros, setRevisandoMaestros] = useState(false);
  const actualizar = (campo: keyof PerfilFiscal, valor: string) => setPerfil(prev => ({ ...prev, [campo]: valor }));

  useEffect(() => {
    let activo = true;
    fetch('/api/configuracion-fiscal/emisor', { headers: sessionHeaders(currentUser.id) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo cargar el perfil fiscal.'); return d; })
      .then(d => { if (activo && d.configuracion) { setPerfil({ ...VACIO, ...d.configuracion }); setCargado(true); } })
      .catch(e => toast.error(e.message || 'No se pudo cargar el perfil fiscal.'))
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [currentUser.id]);

  const revisarMaestros = async () => {
    setRevisandoMaestros(true);
    try {
      const r = await fetch('/api/configuracion-fiscal/estado-maestros', { headers: sessionHeaders(currentUser.id) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo revisar la integridad fiscal.');
      setEstadoMaestros(d);
    } catch (e: any) { toast.error(e.message || 'No se pudo revisar la integridad fiscal.'); }
    finally { setRevisandoMaestros(false); }
  };
  useEffect(() => { void revisarMaestros(); }, [currentUser.id]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setOcupado(true);
    try {
      const r = await fetch('/api/configuracion-fiscal/emisor', { method: 'PUT', headers: { ...sessionHeaders(currentUser.id), 'Content-Type': 'application/json' }, body: JSON.stringify(perfil) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
      setPerfil(prev => ({ ...prev, estadoRevision: d.estadoRevision, referenciaEvidencia: '', revisorNombre: '', revisorCredencial: '' })); setCargado(true);
      toast.success('Datos fiscales guardados; requieren revisión declarada.');
    } catch (e: any) { toast.error(e.message || 'No se pudo guardar el perfil.'); }
    finally { setOcupado(false); }
  };
  const registrarRevision = async () => {
    setOcupado(true);
    try {
      const r = await fetch('/api/configuracion-fiscal/emisor/revisar', { method: 'POST', headers: { ...sessionHeaders(currentUser.id), 'Content-Type': 'application/json' }, body: JSON.stringify(perfil) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo registrar la revisión.');
      setPerfil(prev => ({ ...prev, estadoRevision: d.estadoRevision })); toast.success('Revisión declarada registrada.');
    } catch (e: any) { toast.error(e.message || 'No se pudo registrar la revisión.'); }
    finally { setOcupado(false); }
  };

  if (cargando) return <p className="rounded-xl border p-5 text-sm text-neutral-500">Cargando datos fiscales…</p>;
  return <div className="max-w-5xl space-y-4">
    <header><h3 className="text-xl font-black">Perfil fiscal del emisor</h3><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">Ficha de preparación para facturación electrónica. Hacienda v4.4 rige desde el 1 de junio de 2025; esta app conserva datos para revisión, pero la facturación sigue siendo simulada.</p></header>
    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p><b>No es una conexión fiscal.</b> La revisión aquí solo registra una declaración y una referencia documental. No valida identidad, actividad económica, vigencia tributaria ni credenciales del CPA. No se transmite ningún dato a Hacienda.</p></div>
    <section className="space-y-3 rounded-2xl border bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-bold">Integridad de datos fiscales</h4><p className="text-xs text-neutral-500">Identifica fichas incompletas antes de preparar una demostración o un paquete para el contador.</p></div><button type="button" onClick={revisarMaestros} disabled={revisandoMaestros} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${revisandoMaestros ? 'animate-spin' : ''}`} />Actualizar revisión</button></div>
      {!estadoMaestros ? <p className="text-sm text-neutral-500">{revisandoMaestros ? 'Revisando…' : 'No se ha cargado la revisión.'}</p> : <><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-800"><b>Emisor</b><p>{estadoMaestros.emisor?.faltantes?.length ? `${estadoMaestros.emisor.faltantes.length} campos pendientes` : 'Campos requeridos completos'}</p><small className="text-neutral-500">Revisión: {estadoMaestros.emisor?.revisionDeclarada}</small></div><div className="rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-800"><b>Clientes activos</b><p>{estadoMaestros.clientes?.totalActivos ?? 0} total · {estadoMaestros.clientes?.sinIdentificacion ?? 0} sin identificación · {estadoMaestros.clientes?.sinActividadEconomica ?? 0} sin actividad</p></div><div className="rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-800"><b>Productos activos</b><p>{estadoMaestros.productos?.totalActivos ?? 0} total · {estadoMaestros.productos?.conDatosFiscalPendientes ?? 0} con datos/revisión pendientes · {estadoMaestros.productos?.fueraDeVigenciaOHastaSinInicio ?? 0} fuera de vigencia</p></div></div>{estadoMaestros.productos?.pendientes?.length > 0 && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-bold">Ver productos pendientes (primeros 100)</summary><ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{estadoMaestros.productos.pendientes.map((p: any) => <li key={p.id}><b>{p.nombre}</b> · {p.faltantes.join(', ')}</li>)}</ul></details>}<p className="text-xs text-amber-800 dark:text-amber-200">Esta revisión comprueba campos guardados, no contrasta con Hacienda ni valida las aprobaciones declaradas.</p></>}
    </section>
    <form onSubmit={guardar} className="space-y-4 rounded-2xl border bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-semibold">Tipo de identificación del emisor<select required value={perfil.identificacionTipo} onChange={e => actualizar('identificacionTipo', e.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-neutral-800"><option value="">Seleccione</option><option value="01">Física</option><option value="02">Jurídica</option><option value="03">DIMEX</option><option value="04">NITE</option></select></label>
        {CAMPOS.map(([key, label]) => <label key={key} className={`text-xs font-semibold ${key === 'otrasSenas' ? 'sm:col-span-2 lg:col-span-3' : ''}`}>{label}{key === 'otrasSenas' ? <textarea required value={perfil[key]} onChange={e => actualizar(key, e.target.value)} rows={2} maxLength={500} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-neutral-800" /> : <input required={!['nombreComercial', 'barrio'].includes(key)} value={perfil[key]} onChange={e => actualizar(key, e.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-neutral-800" />}</label>)}
        <label className="text-xs font-semibold">Moneda de presentación<select required value={perfil.monedaPresentacion} onChange={e => actualizar('monedaPresentacion', e.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-neutral-800"><option value="CRC">CRC · Colón costarricense</option><option value="USD">USD · Dólar estadounidense</option><option value="EUR">EUR · Euro</option></select></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span className="text-sm">Estado: <b>{perfil.estadoRevision || 'Pendiente'}</b>{perfil.actualizadoEn ? ` · actualizado ${new Date(perfil.actualizadoEn).toLocaleString()}` : ''}</span><button disabled={ocupado} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Guardar perfil</button></div>
    </form>
    <section className="space-y-3 rounded-2xl border p-5 dark:border-neutral-700"><div><h4 className="font-bold">Revisión profesional declarada</h4><p className="text-xs text-neutral-500">Registre esto solo después de cotejar el perfil con documentación legal y tributaria vigente.</p></div><div className="grid gap-3 sm:grid-cols-3"><input value={perfil.revisorNombre} onChange={e => actualizar('revisorNombre', e.target.value)} placeholder="Nombre del CPA" className="rounded-lg border p-2 text-sm dark:bg-neutral-800" /><input value={perfil.revisorCredencial} onChange={e => actualizar('revisorCredencial', e.target.value)} placeholder="Credencial profesional" className="rounded-lg border p-2 text-sm dark:bg-neutral-800" /><input value={perfil.referenciaEvidencia} onChange={e => actualizar('referenciaEvidencia', e.target.value)} placeholder="Referencia al soporte archivado" className="rounded-lg border p-2 text-sm dark:bg-neutral-800" /></div><button type="button" disabled={ocupado || !cargado || !perfil.revisorNombre.trim() || !perfil.revisorCredencial.trim() || !perfil.referenciaEvidencia.trim()} onClick={registrarRevision} className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-800 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Registrar revisión declarada</button></section>
  </div>;
}
