import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./src/db/schema";
import request from "supertest";
import fs from "fs";
const DB = ".t-busy.db";
const client = createClient({ url: "file:" + DB });
const app = await (await import("./server")).createApp(true, drizzle(client, { schema }));
for (let i = 0; i < 2; i++) {
  const res = await request(app).post("/api/ventas").send({
    factura: { id: "f" + i, consecutivo: "F-" + i, fecha: new Date().toISOString(), clienteId: "x", vendedorId: "1", subtotal: 1000, descuento: 0, total: 1000, condicion_pago: "Contado", metodo_pago: "Efectivo", estado: "Pagada" },
    detalles: [{ producto: "Huevos - Grande", cantidad: 1, precio_unitario: 1000, subtotal: 1000 }]
  });
  console.log(i, res.status, res.body.error || "OK");
}
client.close();
fs.unlinkSync(DB);
