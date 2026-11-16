import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { hashPassword } from '../lib/password';

/** Seeds the fresh demo database after Drizzle has applied the schema. */
export async function initializeNeonDatabase(db: any) {
  const now = new Date().toISOString();
  const users = await db.select({ id: schema.users.id }).from(schema.users).limit(1);

  if (!users.length) {
    const passwordHash = hashPassword(process.env.GDP_DEMO_PASSWORD || '1234');
    const demoUsers = [
      { id: '1', name: 'Administrador', email: 'admin@granja.com', role: 'Admin', roles: 'Admin' },
      { id: '2', name: 'Comercial Central', email: 'facturacion@granja.com', role: 'Comercial', roles: 'Comercial' },
      { id: '3', name: 'Comercial Ruta 1', email: 'vendedor@granja.com', role: 'Comercial', roles: 'Comercial' },
      { id: '6', name: 'Socio Inversor', email: 'socio@granja.com', role: 'Socio', roles: 'Socio' },
      { id: '7', name: 'Bodeguero Principal', email: 'bodega@granja.com', role: 'Bodeguero', roles: 'Bodeguero' },
      { id: '8', name: 'Encargado de Galerón', email: 'despacho@granja.com', role: 'Despachador', roles: 'Despachador' },
      { id: '9', name: 'Comercial Reparto Demo', email: 'camionero@granja.com', role: 'Comercial', roles: 'Comercial' },
    ];

    await db.insert(schema.users).values(demoUsers.map((user) => ({
      ...user,
      password_hash: passwordHash,
      activo: true,
    }))).onConflictDoNothing();
  }

  const products = await db.select({ id: schema.productosCatalogo.id }).from(schema.productosCatalogo).limit(1);
  if (!products.length) {
    await db.insert(schema.productosCatalogo).values([
      { id: crypto.randomUUID(), nombre: 'Huevos Extra Grandes', descripcion: 'Huevos de tamaño extra grande (≥70g)', unidad: 'kg', precioBase: 18500, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Grandes', descripcion: 'Huevos de tamaño grande (60-69g)', unidad: 'kg', precioBase: 16000, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Medianos', descripcion: 'Huevos de tamaño mediano (50-59g)', unidad: 'kg', precioBase: 13500, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Pequeños', descripcion: 'Huevos de tamaño pequeño (<50g)', unidad: 'kg', precioBase: 11000, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Gallinaza', descripcion: 'Excremento de gallina procesado, fertilizante', unidad: 'sacos', precioBase: 3500, categoria: 'Subproductos', estado: 'Activo', fechaCreacion: now },
    ]).onConflictDoNothing();
  }

  const cartonTypes = await db.select({ id: schema.tiposCarton.id }).from(schema.tiposCarton).limit(1);
  if (!cartonTypes.length) {
    await db.insert(schema.tiposCarton).values([
      { id: crypto.randomUUID(), nombre: 'Cartón de 30 huevos', unidades: 30, estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Cartón de 12 huevos', unidades: 12, estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Cartón de 6 huevos', unidades: 6, estado: 'Activo', fechaCreacion: now },
    ]).onConflictDoNothing();
  }

  // Small, clearly synthetic operating dataset so the hosted demo opens with
  // useful screens. Never copy the local SQLite database into the demo.
  const hasDemoClients = await db.select({ id: schema.clientes.id }).from(schema.clientes).where(eq(schema.clientes.id, 'DEMO-CLI-001')).limit(1);
  if (!hasDemoClients.length) {
    await db.insert(schema.clientes).values([
      { id: 'DEMO-CLI-001', nombre: 'Mini Súper La Esquina', tipo_documento: 'Juridica', documento_id: '3-101-900001', telefono: '8888-0101', email: 'esquina@example.test', direccion: 'Centro de Naranjo', provincia: 'Alajuela', canton: 'Naranjo', ruta: 'Ruta Occidente', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-002', nombre: 'Abastecedor El Molino', tipo_documento: 'Juridica', documento_id: '3-101-900002', telefono: '8888-0102', email: 'molino@example.test', direccion: 'San Ramón', provincia: 'Alajuela', canton: 'San Ramón', ruta: 'Ruta Occidente', condicion_pago: 'Crédito', limite_credito: 250000, saldo_pendiente: 78000, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-003', nombre: 'Soda La Granja', tipo_documento: 'Fisica', documento_id: '1-1111-0003', telefono: '8888-0103', direccion: 'Palmares', provincia: 'Alajuela', canton: 'Palmares', ruta: 'Ruta Palmares', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-004', nombre: 'Pulpería San Miguel', tipo_documento: 'Fisica', documento_id: '1-1111-0004', telefono: '8888-0104', direccion: 'San Carlos', provincia: 'Alajuela', canton: 'San Carlos', ruta: 'Ruta Norte', condicion_pago: 'Crédito', limite_credito: 180000, saldo_pendiente: 42000, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-005', nombre: 'Restaurante Buen Día', tipo_documento: 'Juridica', documento_id: '3-101-900005', telefono: '8888-0105', direccion: 'Grecia', provincia: 'Alajuela', canton: 'Grecia', ruta: 'Ruta Occidente', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
    ]).onConflictDoNothing();
  }

  const hasDemoFarm = await db.select({ id: schema.granjas.id }).from(schema.granjas).where(eq(schema.granjas.id, 'DEMO-FARM-001')).limit(1);
  if (!hasDemoFarm.length) {
    await db.insert(schema.granjas).values({ id: 'DEMO-FARM-001', nombre: 'Granja Demostración Occidente', ubicacion: 'Naranjo, Alajuela', tipo_produccion: 'Ponedoras', encargadoId: '8', estado: 'Activo' }).onConflictDoNothing();
    await db.insert(schema.galerones).values({ id: 'DEMO-GAL-001', granjaId: 'DEMO-FARM-001', nombre: 'Galerón Las Lomas', capacidad_maxima: 9000, aves_en_produccion: 7500, tipo_galeron: 'Productora', produccion_diaria_esperada: 6500, estado: 'Activo' }).onConflictDoNothing();
    await db.insert(schema.lotes_aves).values({ id: 'DEMO-BIRDLOT-001', galeronId: 'DEMO-GAL-001', fecha_ingreso: '2025-08-01', cantidad_inicial: 7500, linea_genetica: 'Hy-Line Brown (demo)', estado: 'Activo' }).onConflictDoNothing();
  }

  const hasDemoStock = await db.select({ id: schema.inventario.id }).from(schema.inventario).where(eq(schema.inventario.id, 'DEMO-STOCK-001')).limit(1);
  if (!hasDemoStock.length) {
    await db.insert(schema.inventario).values([
      { id: 'DEMO-STOCK-001', producto: 'Huevos Grandes', cantidad: 224, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-GRANDE-20261116', fecha_caducidad: '2026-12-14', ultima_actualizacion: now },
      { id: 'DEMO-STOCK-002', producto: 'Huevos Medianos', cantidad: 86.5, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-MEDIANO-20261115', fecha_caducidad: '2026-12-13', ultima_actualizacion: now },
      { id: 'DEMO-STOCK-003', producto: 'Huevos Extra Grandes', cantidad: 52, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-EXTRA-20261115', fecha_caducidad: '2026-12-13', ultima_actualizacion: now },
    ]).onConflictDoNothing();
  }

  const hasDemoRoutes = await db.select({ id: schema.rutas.id }).from(schema.rutas).where(eq(schema.rutas.id, 'DEMO-ROUTE-001')).limit(1);
  if (!hasDemoRoutes.length) {
    await db.insert(schema.camiones).values([
      { id: 'DEMO-TRUCK-001', nombre: 'Camión Ruta Occidente', placa: 'DEMO-001', camioneroId: '9', ruta_defecto: 'Ruta Occidente', capacidad_cartones: 350, estado: 'Activo' },
      { id: 'DEMO-TRUCK-002', nombre: 'Camión Ruta Norte', placa: 'DEMO-002', camioneroId: '3', ruta_defecto: 'Ruta Norte', capacidad_cartones: 300, estado: 'Activo' },
    ]).onConflictDoNothing();
    await db.insert(schema.rutas).values([
      { id: 'DEMO-ROUTE-001', nombre: 'Ruta Occidente', vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-001', cliente_ids: 'DEMO-CLI-001,DEMO-CLI-002,DEMO-CLI-005', dias_frecuencia: 'Lunes,Miércoles,Viernes', kilometraje_aprox: 68, estado: 'Activa', capacidad_max_cartones: 350 },
      { id: 'DEMO-ROUTE-002', nombre: 'Ruta Norte', vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-002', cliente_ids: 'DEMO-CLI-004', dias_frecuencia: 'Martes,Jueves', kilometraje_aprox: 92, estado: 'Activa', capacidad_max_cartones: 300 },
      { id: 'DEMO-ROUTE-003', nombre: 'Ruta Palmares', vendedor_asignado: '3', cliente_ids: 'DEMO-CLI-003', dias_frecuencia: 'Lunes a Sábado', kilometraje_aprox: 34, estado: 'Activa', capacidad_max_cartones: 200 },
    ]).onConflictDoNothing();
  }

  // Keep the initial administrator active for the demo after an interrupted seed.
  await db.update(schema.users).set({ activo: true }).where(eq(schema.users.email, 'admin@granja.com'));
}
