## Proyecto
Granja Don Paco — app de gestión avícola (React + Express, Better-SQLite/Drizzle, RLS por `userGranjaId`).

## Reciente
- **Opción A (Logística simplificada)** completada y verificada: 5 módulos (Operaciones, Despacho/Ruta, Caja, Cuadre Central, Desperdicios).
- **Patrones de desperdicio** completado: schema 4 FK, auto-migración, POST manual, endpoint patrones, pestaña Patrones en UI, todos los tests actualizados.
- **E2E custodia completa** (`tests/e2e-ciclo-completo-custodia.test.ts`) creado y verificado: 16 tests que trazan un cartón desde el galerón (encargado) hasta la confirmación de retorno en bodega (cuadre central), incluyendo recepción con diferencia (desperdicio controlado), alistamiento de etiquetas, carga, ventas (efectivo + crédito), devolución, fin de día, cuadre con peso de retorno y trazabilidad por actor (x-user-id).
- **E2E integral TODOS LOS PROCESOS** (`tests/e2e-todos-procesos.test.ts`): 26 tests cubren: custodia del huevo completa (recolección → remisión → recepción con pérdida → alistamiento 3 etiquetas → guía 90ct → 3 ventas + devolución → fin-día → cuadre Cerrada, bodega 38), **mantenimiento de galerones** (mantenimiento correctivo, activo, 3 órdenes vencidas/próximas + alertas), **vacunación** (Newcastle vencida, Influenza aplicada + alertas), **facturas y tiquetes** (consolidar-ruta → 2 facturas contado/crédito + 1 NotaCredito por anulada → FE/NC docs, dashboard enterprise real antes/después de pago), **dashboard logística** con datos en vivo (ventas, efectivo, crédito, avance, saltos, etiquetas).
- **Real-data bug corregido en server.ts**: los desperdicios generados por sistema (recepción y cuadre central) tenían `impactoFinanciero: 0` hardcodeado → dashboards mostraban info irreales. Ahora usan `calcularImpactoDesperdicio(producto, cantidad)` que consulta `listas_precios + precios_detalle` (fallback `precio_base`) → el E2E verifica impacto real (32000 para 2 ct a 16000). Los tests f4-cuadre se actualizaron para incluir `impactoFinanciero` (480000 / 32000).
- Tests f4-cuadre actualizados para `impactoFinanciero` en `res.body.desperdicios` (cuadre ahora retorna el 4to campo).
- **4 mejoras de custodia aplicadas (server.ts + tests)**:
  1. **Recepción con diferencia**: ahora se descuenta lo *despachado* del EnTransito (no lo recibido) → no queda stock fantasma; la diferencia sale como kárdex 'Pérdida en Tránsito' (se equilibra con el desperdicio).
  2. **Trazabilidad por etiqueta** ahora expone también el **despacho GD-** (consecutivo, estado, camión, ruta, pesos) que transportó el cartón (se toma del evento 'Cargada' más reciente en `documentoRef`).
  3. **Alistamiento**: la traza 'Alistamiento' ya captura `usuarioId` (responsable=bodeguero) y el `pesoBruto` del lote se reparte proporcionalmente entre galerones (antes cada etiqueta llevaba el total).
  4. **Control de pesos conectado**: nueva helper `registrarPesoPunto` → pesos_por_punto en recepción (báscula llegada), alistamiento, carga (peso andén vs báscula de salida → Conforme/ConDiferencia al 2%) y cuadre central (pesoSalida vs pesoLlegada).
- Tests actualizados con la tabla `pesos_por_punto`: +f2-despacho, f3-caja, f4-consolidacion, f4-cuadre (e2e-ciclo ya la tenía). Nota: el camino de excepción (merma excesiva → CerradaConDiferencia + aprobación + bloqueo/carga) YA está cubierto por f4-cuadre.
- **UI Desperdicios conectada al análisis de patrones**: el modal de pérdida manual ahora expone selectores opcionales de **Ruta / Camión / Vendedor** (carga `/api/rutas`, `/api/logistica/camiones`, `/api/users` filtrado por role Vendedor) y la tabla del registro muestra esas 3 columnas. Cierra la brecha UI↔backend de los vínculos de desperdicio.

## Estado actual
- tsc limpio, vitest 11 archivos / 259 tests (incluye E2E integral 26 tests), build OK.
- Servidor: `node dist/server.cjs`. Migration automática al iniciar.
- `calcularImpactoDesperdicio` (tras L131 en server.ts): helper defensivo; retorna 0 si no hay precios; aplica en recepción y cuadre-central.

## User Request (verbatim)
> "haz pruebas E2E desde que se registra un carton en un galeron por un encargado de galeron pasando por cada uno de las estapas del proceso y los diferentes actores hasta que el camion regresa a bodega y confirma la entrega de lo que regreso" → luego: "ok arregla los 4 puntos de mejora" → luego: "vuelve a hacer la verificacion E2E de todos los procesos, custodia del huevo, mantenimiento de los galerones, vacunacion, facturas y tiquetes, y que los dashboards den informacion real"

## Acotaciones
- El endpoint trazabilidad devuelve la **guía de remisión (GR-)** que originó la etiqueta en `guia` y la **guía de despacho (GD-)** en `despacho`.
- `registrarPesoPunto` no rompe el flujo si falla (auditoría). Tolerancia 2% entre peso esperado y real.
- La recepción con diferencia descuenta `esperada` del EnTransito y registra 'Pérdida en Tránsito'.
- `consolidar-ruta` (POST /api/facturacion/consolidar-ruta): requiere guía `Cerrada`/`CerradaConDiferencia`; crea factura por cliente (Contado → Pagada, Crédito → Pendiente), NotaCredito por venta anulada, docs FE/NC, y enlaza `ventas_ruta.facturaId`. Los estados de la guía "Cerrada" vs "CerradaConDiferencia" se determinan por `fin_dia_fecha` (la columna `estado` en `guias_despacho` sigue como `EnRuta` hasta el cuadre).
- El tablero de logística (`/api/logistica/tablero`) usa la columna `guias_despacho.estado` (no lógica CajaCerrada); una guía aparece como activa mientras `estado ≠ 'Cerrada'` ni `'Anulada'`.
- Los campos `clientesAtendidos` del tablero usan la clave `codigoUnico` (no `tiqueteConsecutivo`) para el tiquete.
- `productos_catalogo` (precio_base) → fallback si no hay `listas_precios/precios_detalle` activas para el producto.`
