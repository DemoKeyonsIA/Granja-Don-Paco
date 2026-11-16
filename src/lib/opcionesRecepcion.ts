// Opciones canónicas de motivo cuando la cantidad recibida en bodega no calza con la esperada.
// Un faltante puede ser desperdicio o diferencia por investigar; un sobrante se informa
// como una diferencia positiva de inventario, nunca como merma.
//
// El rótulo de la categoría 'alerta' es "Diferencia por investigar" y no una
// acusación. La diferencia es un hecho de conteo; la causa puede ser un error de
// carga, un cartón mal contado, un faltante del proveedor o algo indebido, y la
// recepción no tiene cómo distinguirlos. Etiquetar el hecho como "robo" en la
// pantalla apunta a una persona sin evidencia, y en una operación de bodega eso
// se lee como acusación. El detalle va al detalle de la alerta; el rótulo describe
// lo que hay que hacer, que es investigarlo.
export type TipoDiferencia = 'desperdicio' | 'alerta' | 'sobrante';

export interface OpcionDiferencia {
  id: string;
  label: string;
  tipo: TipoDiferencia;
}

export const OPCIONES_DIFERENCIA_RECEPCION: OpcionDiferencia[] = [
  { id: 'quebrados', label: 'Kilos de huevo rotos o dañados', tipo: 'desperdicio' },
  { id: 'sucios', label: 'Kilos de huevo sucios o contaminados', tipo: 'desperdicio' },
  { id: 'vencidos', label: 'Kilos de huevo vencidos o descompuestos', tipo: 'desperdicio' },
  { id: 'no-aparece', label: 'Kilos que no aparecen / no llegaron', tipo: 'alerta' },
  { id: 'faltante-sin-causa', label: 'Faltante sin causa aparente', tipo: 'alerta' },
  { id: 'diferencia-peso', label: 'Diferencia en el peso recibido', tipo: 'alerta' },
  { id: 'sobrante-no-documentado', label: 'Llegó más producto del indicado', tipo: 'sobrante' },
];

export const ETIQUETA_TIPO_DIFERENCIA: Record<TipoDiferencia, string> = {
  desperdicio: 'Desperdicio registrado',
  alerta: 'Diferencia por investigar',
  sobrante: 'Sobrante por revisar',
};

// Devuelve la opción canónica dado un id (nuevo) o un label (legado free-text).
export function clasificarDiferencia(motivo?: string | null): OpcionDiferencia | undefined {
  if (!motivo) return undefined;
  const directo = OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === motivo);
  if (directo) return directo;
  const porLabel = OPCIONES_DIFERENCIA_RECEPCION.find(o => o.label.toLowerCase() === motivo.trim().toLowerCase());
  if (porLabel) return porLabel;
  // Heurística para texto libre histórico
  const t = motivo.toLowerCase();
  if (/sobr|adicional|más producto|mas producto/i.test(t)) return OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === 'sobrante-no-documentado');
  if (/no aparec|no lleg|faltante|faltan.*sin|incompleto|peso/i.test(t)) return OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === 'no-aparece');
  if (/queb|rot|romp|caid|sucio|contamin|vencid|descomp/i.test(t)) return OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === 'quebrados');
  return undefined;
}
