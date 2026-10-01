// Opciones canónicas de motivo cuando la cantidad recibida en bodega no calza con la esperada.
// Cada opción clasifica el faltante como:
//   - 'desperdicio': el producto llegó pero se dañó (se registra en Desperdicios)
//   - 'alerta':      el producto no aparece → posible robo (se registra alerta, NO desperdicio)
export type TipoDiferencia = 'desperdicio' | 'alerta';

export interface OpcionDiferencia {
  id: string;
  label: string;
  tipo: TipoDiferencia;
}

export const OPCIONES_DIFERENCIA_RECEPCION: OpcionDiferencia[] = [
  { id: 'quebrados', label: 'Cartón de huevos que se rompieron o se cayeron', tipo: 'desperdicio' },
  { id: 'sucios', label: 'Cartón de huevos sucios o contaminados', tipo: 'desperdicio' },
  { id: 'vencidos', label: 'Cartón de huevos vencidos o descompuestos', tipo: 'desperdicio' },
  { id: 'no-aparece', label: 'Cartón de huevos que no aparece / no llegó', tipo: 'alerta' },
  { id: 'faltante-sin-causa', label: 'Faltante sin causa aparente', tipo: 'alerta' },
  { id: 'diferencia-peso', label: 'Cartón incompleto / diferencia de peso', tipo: 'alerta' },
];

export const ETIQUETA_TIPO_DIFERENCIA: Record<TipoDiferencia, string> = {
  desperdicio: 'Desperdicio registrado',
  alerta: 'Posible robo de huevos',
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
  if (/no aparec|no lleg|faltante|faltan.*sin|incompleto|peso/i.test(t)) return OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === 'no-aparece');
  if (/queb|rot|romp|caid|sucio|contamin|vencid|descomp/i.test(t)) return OPCIONES_DIFERENCIA_RECEPCION.find(o => o.id === 'quebrados');
  return undefined;
}