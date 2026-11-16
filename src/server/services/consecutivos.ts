import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Reserva el siguiente número de una serie dentro de la transacción recibida. */
export async function siguienteConsecutivo(tx: any, tipo: string, entidad: string, prefijo: string, longitud: number) {
  const seq = await tx.query.consecutivos.findFirst({
    where: and(eq(schema.consecutivos.tipo, tipo), eq(schema.consecutivos.entidad, entidad)),
  });
  if (seq) {
    const n = Number(seq.ultimo) + 1;
    if (n > Number(seq.rangoHasta)) throw new Error(`Rango de consecutivos agotado para ${prefijo}`);
    await tx.update(schema.consecutivos).set({ ultimo: n }).where(eq(schema.consecutivos.id, seq.id));
    return { n, s: `${prefijo}-${String(n).padStart(longitud, '0')}` };
  }
  const id = crypto.randomUUID();
  await tx.insert(schema.consecutivos).values({ id, tipo, entidad, prefijo, rangoDesde: 1, rangoHasta: 999999999, ultimo: 1 });
  return { n: 1, s: `${prefijo}-${String(1).padStart(longitud, '0')}` };
}

/** Garantiza que exista el cliente técnico usado en tiquetes sin cliente asociado. */
export async function getClienteConsumidorFinal(tx: any) {
  const existente = (await tx.select().from(schema.clientes).where(eq(schema.clientes.id, 'consumidor-final')).limit(1))[0];
  if (existente) return existente;
  await tx.insert(schema.clientes).values({
    id: 'consumidor-final', nombre: 'Consumidor Final', tipo_documento: 'Fisica',
    documento_id: '000000000', condicion_pago: 'Contado', estado: 'Activo',
  });
  return (await tx.select().from(schema.clientes).where(eq(schema.clientes.id, 'consumidor-final')).limit(1))[0];
}
