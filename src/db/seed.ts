import { db } from './index';
import { users, clientes, inventario } from './schema';
import { mockUsers, mockClientes, mockInventario } from '../data';

async function seed() {
  try {
    console.log('Seeding users...');
    for (const u of mockUsers) {
      await db.insert(users).values({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role
      }).onConflictDoNothing();
    }

    console.log('Seeding clientes...');
    for (const c of mockClientes) {
      await db.insert(clientes).values({
        id: c.id,
        nombre: c.nombre,
        ruta: c.ruta,
        condicion_pago: c.condicion_pago,
        precio_especial: c.precio_especial ?? null,
        promedio_compra: c.promedio_compra
      }).onConflictDoNothing();
    }

    console.log('Seeding inventario...');
    for (const i of mockInventario) {
      await db.insert(inventario).values({
        id: i.id,
        producto: i.producto,
        cantidad: i.cantidad,
        unidad: i.unidad,
        ubicacion: i.ubicacion,
        lote: i.lote ?? null,
        fecha_caducidad: i.fecha_caducidad ?? null,
        ultima_actualizacion: i.ultima_actualizacion
      }).onConflictDoNothing();
    }

    console.log('Seeding complete!');
  } catch (err) {
    console.error('Error seeding:', err);
  }
}

seed();
