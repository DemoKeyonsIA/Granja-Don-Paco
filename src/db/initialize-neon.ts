import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { hashPassword } from '../lib/password';

/** Seeds the fresh demo database after Drizzle has applied the schema. */
export async function initializeNeonDatabase(db: any) {
  const now = new Date().toISOString();

  {
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

  await db.insert(schema.camiones).values([
    { id: 'DEMO-TRUCK-001', nombre: 'Camión Ruta Occidente', placa: 'DEMO-001', camioneroId: '3', ruta_defecto: 'Ruta Occidente', capacidad_cartones: 350, estado: 'Activo' },
    { id: 'DEMO-TRUCK-002', nombre: 'Camión Ruta Norte', placa: 'DEMO-002', camioneroId: '9', ruta_defecto: 'Ruta Norte', capacidad_cartones: 300, estado: 'Activo' },
    { id: 'DEMO-TRUCK-003', nombre: 'Camión Ruta Palmares', placa: 'DEMO-003', camioneroId: '3', ruta_defecto: 'Ruta Palmares', capacidad_cartones: 200, estado: 'Activo' },
  ]).onConflictDoNothing();
  await db.insert(schema.rutas).values([
    { id: 'DEMO-ROUTE-001', nombre: 'Ruta Occidente', vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-001', cliente_ids: 'DEMO-CLI-001,DEMO-CLI-002,DEMO-CLI-005', dias_frecuencia: 'Lunes,Miércoles,Viernes', kilometraje_aprox: 68, estado: 'Activa', capacidad_max_cartones: 350 },
    { id: 'DEMO-ROUTE-002', nombre: 'Ruta Norte', vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-002', cliente_ids: 'DEMO-CLI-004', dias_frecuencia: 'Martes,Jueves', kilometraje_aprox: 92, estado: 'Activa', capacidad_max_cartones: 300 },
    { id: 'DEMO-ROUTE-003', nombre: 'Ruta Palmares', vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-003', cliente_ids: 'DEMO-CLI-003', dias_frecuencia: 'Lunes a Sábado', kilometraje_aprox: 34, estado: 'Activa', capacidad_max_cartones: 200 },
  ]).onConflictDoNothing();

  // Asegura que las asignaciones demo sigan siendo coherentes aunque la ruta ya
  // existiera antes de este seed: el acceso de vendedor se filtra por camionero.
  await db.update(schema.camiones).set({ camioneroId: '3', ruta_defecto: 'Ruta Occidente' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-001'));
  await db.update(schema.camiones).set({ camioneroId: '9', ruta_defecto: 'Ruta Norte' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-002'));
  await db.update(schema.camiones).set({ camioneroId: '3', ruta_defecto: 'Ruta Palmares' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-003'));
  await db.update(schema.rutas).set({ vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-001', cliente_ids: 'DEMO-CLI-001,DEMO-CLI-002,DEMO-CLI-005' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-001'));
  await db.update(schema.rutas).set({ vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-002', cliente_ids: 'DEMO-CLI-004' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-002'));
  await db.update(schema.rutas).set({ vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-003', cliente_ids: 'DEMO-CLI-003' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-003'));

  // Precios autorizados para que el vendedor pueda completar una venta demo.
  await db.insert(schema.listas_precios).values({
    id: 'DEMO-PRICE-ROUTE-OCCIDENTE', nombre: 'Demo · Ruta Occidente por kilo', tipo: 'Ruta',
    rutaAsociada: 'Ruta Occidente', estado: 'Activa', fechaInicio: now.slice(0, 10), aprobadoPor: '1',
  }).onConflictDoNothing();
  await db.insert(schema.listas_precios).values({
    id: 'DEMO-PRICE-ROUTE-PALMARES', nombre: 'Demo · Ruta Palmares por kilo', tipo: 'Ruta',
    rutaAsociada: 'Ruta Palmares', estado: 'Activa', fechaInicio: now.slice(0, 10), aprobadoPor: '1',
  }).onConflictDoNothing();
  const preciosRutaDemo = [
    ['DEMO-PRICE-ROUTE-OCCIDENTE', 'Huevos Grandes', 1200, 1100, 1350],
    ['DEMO-PRICE-ROUTE-OCCIDENTE', 'Huevos Medianos', 1050, 980, 1180],
    ['DEMO-PRICE-ROUTE-PALMARES', 'Huevos Grandes', 1200, 1100, 1350],
    ['DEMO-PRICE-ROUTE-PALMARES', 'Huevos Medianos', 1050, 980, 1180],
  ] as const;
  for (const [listaId, producto, precioUnitario, precioMinimo, precioMaximo] of preciosRutaDemo) {
    await db.insert(schema.precios_detalle).values({
      id: `${listaId}-${producto.replace(/[^A-Za-z0-9]+/g, '-')}`, listaId, producto,
      precioUnitario, precioMinimo, precioMaximo, descuentoMaximo: 0, unidad: 'kg',
    }).onConflictDoNothing();
  }

  // Dos guías dejan lista la interacción del Comercial: una carga por iniciar
  // y una ruta ya iniciada. Se crean una sola vez para no reponer stock vendido.
  const guiasDemoVendedor = [
    {
      id: 'DEMO-GUIA-VENDEDOR-OCCIDENTE', consecutivo: 'GD-DEMO-OCCIDENTE-001', camionId: 'DEMO-TRUCK-001', rutaId: 'DEMO-ROUTE-001',
      vendedorId: '3', estado: 'Cargada', clientes: ['DEMO-CLI-001', 'DEMO-CLI-002', 'DEMO-CLI-005'],
      cargas: [
        { etiquetaId: 'DEMO-ETQ-RUTA-OCC-GRANDE-01', codigo: 'DEMO-RUTA-OCC-GRANDE-01', producto: 'Huevos Grandes', kg: 20, lote: 'DEMO-OCC-GRANDE-20261116', caduca: '2026-12-14' },
        { etiquetaId: 'DEMO-ETQ-RUTA-OCC-MEDIANO-01', codigo: 'DEMO-RUTA-OCC-MEDIANO-01', producto: 'Huevos Medianos', kg: 12, lote: 'DEMO-OCC-MEDIANO-20261116', caduca: '2026-12-13' },
      ],
    },
    {
      id: 'DEMO-GUIA-VENDEDOR-PALMARES', consecutivo: 'GD-DEMO-PALMARES-001', camionId: 'DEMO-TRUCK-003', rutaId: 'DEMO-ROUTE-003',
      vendedorId: '3', estado: 'EnRuta', clientes: ['DEMO-CLI-003'],
      cargas: [
        { etiquetaId: 'DEMO-ETQ-RUTA-PAL-GRANDE-01', codigo: 'DEMO-RUTA-PAL-GRANDE-01', producto: 'Huevos Grandes', kg: 8, lote: 'DEMO-PAL-GRANDE-20261116', caduca: '2026-12-14' },
        { etiquetaId: 'DEMO-ETQ-RUTA-PAL-MEDIANO-01', codigo: 'DEMO-RUTA-PAL-MEDIANO-01', producto: 'Huevos Medianos', kg: 8, lote: 'DEMO-PAL-MEDIANO-20261116', caduca: '2026-12-13' },
      ],
    },
  ];
  for (const guiaDemo of guiasDemoVendedor) {
    await db.transaction(async (tx: any) => {
      const ahora = new Date().toISOString();
      const truck = await tx.query.camiones.findFirst({ where: eq(schema.camiones.id, guiaDemo.camionId) });
      const creada = await tx.insert(schema.guias_despacho).values({
        id: guiaDemo.id, consecutivo: guiaDemo.consecutivo, camionId: guiaDemo.camionId, rutaId: guiaDemo.rutaId,
        fecha: ahora, horaCarga: ahora.slice(11, 19), responsableCarga: 'Bodeguero demo',
        responsableTransporte: 'Comercial Ruta 1', vendedorId: guiaDemo.vendedorId,
        clientesIds: JSON.stringify(guiaDemo.clientes), totalCartones: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0),
        totalKg: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0), pesoSalida: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0),
        estado: guiaDemo.estado, recibidoEn: guiaDemo.estado === 'EnRuta' ? ahora : null,
        rutaOrdenJson: JSON.stringify(guiaDemo.clientes.map((clienteId, index) => ({ clienteId, orden: index + 1 }))),
      }).onConflictDoNothing().returning({ id: schema.guias_despacho.id });
      if (!creada.length) return;
      if (!truck) throw new Error(`No existe el camión demo ${guiaDemo.camionId}`);

      for (const [indice, carga] of guiaDemo.cargas.entries()) {
        const stockBodegaId = carga.producto === 'Huevos Grandes' ? 'DEMO-STOCK-001' : 'DEMO-STOCK-002';
        const saldoBodega = await tx.query.inventario.findFirst({ where: eq(schema.inventario.id, stockBodegaId) });
        if (!saldoBodega || Number(saldoBodega.cantidad) < carga.kg) throw new Error(`Stock demo insuficiente de ${carga.producto} para ${guiaDemo.consecutivo}`);
        await tx.update(schema.inventario).set({ cantidad: Number(saldoBodega.cantidad) - carga.kg, ultima_actualizacion: ahora }).where(eq(schema.inventario.id, saldoBodega.id));

        const etiqueta = {
          id: carga.etiquetaId, codigoUnico: carga.codigo, producto: carga.producto, cantidad: carga.kg, unidad: 'kg',
          pesoBruto: carga.kg + 0.4, pesoNeto: carga.kg, saldoKg: carga.kg, pesoOrigen: 'Manual',
          pesoRegistradoPor: '7', pesoRegistradoEn: ahora, fechaProduccion: now.slice(0, 10), fechaEmpaque: now.slice(0, 10),
          fechaVencimiento: carga.caduca, granjaOrigen: 'Granja Demostración Occidente', galeronOrigen: 'Galerón Las Lomas',
          clasificacion: carga.producto.includes('Medianos') ? 'Mediano' : 'Grande', tara: 0.4,
          estado: 'Cargada', ubicacionActual: truck.nombre, lote: carga.lote, pesoBodega: carga.kg,
          guiaDespachoId: guiaDemo.id, fechaRecepcion: ahora,
        };
        await tx.insert(schema.etiquetas).values(etiqueta).onConflictDoNothing();
        await tx.insert(schema.guias_despacho_detalle).values({
          id: `${guiaDemo.id}-DET-${String(indice + 1).padStart(2, '0')}`, guiaId: guiaDemo.id,
          etiquetaId: carga.etiquetaId, producto: carga.producto, cartones: carga.kg, cantidadKg: carga.kg,
          pesoAnden: carga.kg + 0.4, estadoSalida: 'checked',
        }).onConflictDoNothing();
        const stockCamion = await tx.query.inventario.findMany({ where: eq(schema.inventario.ubicacion, truck.nombre) });
        const stockProducto = stockCamion.find((x: any) => x.producto === carga.producto && x.unidad === 'kg');
        if (stockProducto) await tx.update(schema.inventario).set({ cantidad: Number(stockProducto.cantidad) + carga.kg, ultima_actualizacion: ahora }).where(eq(schema.inventario.id, stockProducto.id));
        else await tx.insert(schema.inventario).values({
          id: `${guiaDemo.id}-INV-${String(indice + 1).padStart(2, '0')}`, producto: carga.producto, cantidad: carga.kg,
          unidad: 'kg', ubicacion: truck.nombre, lote: carga.lote, fecha_caducidad: carga.caduca, ultima_actualizacion: ahora,
        }).onConflictDoNothing();
        await tx.insert(schema.movimientosInventario).values({
          id: `${guiaDemo.id}-MOV-${String(indice + 1).padStart(2, '0')}`, producto: carga.producto, cantidad: carga.kg,
          unidad: 'kg', tipo: 'Despacho demo a ruta', origen: 'Bodega Central', destino: truck.nombre,
          fecha: ahora, referencia_id: guiaDemo.id,
        }).onConflictDoNothing();
        await tx.insert(schema.traza_etiqueta).values({
          id: `${guiaDemo.id}-TRAZA-${String(indice + 1).padStart(2, '0')}`, etiquetaId: carga.etiquetaId,
          tipoEvento: 'Carga de ruta', ubicacion: truck.nombre, documentoRef: guiaDemo.consecutivo,
          usuarioId: '7', fecha: ahora, observaciones: 'Carga sintética de demostración; inventario expresado en kg.',
        }).onConflictDoNothing();
      }
    });
  }

  // Keep the initial administrator active for the demo after an interrupted seed.
  await db.update(schema.users).set({ activo: true }).where(eq(schema.users.email, 'admin@granja.com'));
}
