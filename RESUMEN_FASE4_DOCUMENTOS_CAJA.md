# Fase 4 — Documentos fiscales y cobranza

## Cambios implementados

- Creación idempotente de documentos electrónicos por factura y tipo, con detección de reintentos idénticos y conflicto `409` cuando se reutiliza la llave con contenido diferente.
- Generación de XML, envío y consulta de estado idempotentes: los reintentos no crean estados ni fechas inconsistentes.
- El listado de facturas ahora informa `pagado` y `saldoPendiente`, sumando pagos registrados y respetando datos históricos ya marcados como pagados.
- Cobranza permite registrar abonos parciales, valida el monto contra el saldo, autentica la solicitud con la sesión demo y refleja el estado y saldo devueltos por el servidor.
- Cartera, cobrado de contado y vencimiento se muestran con importes/saldos reales; los días de atraso se cuentan desde la fecha de vencimiento.
- Registro de gastos requiere sesión y permiso de rol, valida categoría, monto y fecha, guarda el actor autenticado y permite reintentos idempotentes. Gastos legacy conserva compatibilidad con la categoría `Diesel`.

## Validación

- `npm run lint`: correcto.
- `npm run build`: correcto. Vite mantiene el aviso existente de bundle JavaScript principal mayor a 500 kB.
- `tests/e2e-pagos.test.ts`: 15/15.
- `tests/e2e-cobranza-aging.test.ts`: 7/7.
- `tests/e2e-cadena-custodia.test.ts`: 70/70.
- `tests/e2e-finanzas-roles.test.ts`: 9/9.
- `tests/smoke.test.ts`: 25/25.
- `tests/e2e-todos-procesos.test.ts`: 27/27.
- Ejecutar dos archivos de integración a la vez hizo que Vitest perdiera un worker inesperadamente; cada archivo pasó al correrlo por separado.

## Iteración de caja y conciliación bancaria

- El cierre de fin de día solicita el efectivo contado y guarda el esperado, gastos en efectivo, monto contado, diferencia y estado por guía.
- Los gastos pueden vincularse a una guía y medio de pago. Solo los gastos en efectivo de esa guía reducen el efectivo esperado; los gastos generales siguen en el P&L sin tocar la caja de ruta.
- La venta de ruta separa efectivo, transferencia y crédito. Resúmenes de ruta y tableros exponen esos totales por separado.
- El resumen financiero incluye tiquetes cobrados aún no consolidados; tiquetes anulados o ya consolidados no se suman dos veces.
- Los depósitos bancarios se registran contra el conteo de cierre, con referencia y enlace opcional al comprobante. Una diferencia crea aprobación; quien registró el depósito no puede aprobarla.
- El resumen financiero muestra cierres, gastos de efectivo de ruta, esperado/contado, diferencias y depósitos conciliados o pendientes.
- La guía conserva el estado de cierre de caja al volver a abrirla. Office ya cuenta con vínculos de documentos y correo; la suite de vinculación sigue pasando.

## Validación de esta iteración

- `npm run lint`: correcto.
- `npm run build`: correcto; permanece el aviso de Vite por el bundle principal mayor a 500 kB.
- `tests/f3-caja.test.ts`: 14/14 (incluye gasto en efectivo, transferencia, diferencia de caja, depósito y aprobación segregada).
- `tests/e2e-finanzas-resumen.test.ts`: 20/20.
- `tests/e2e-finanzas-roles.test.ts`: 9/9.
- `tests/e2e-pagos.test.ts`: 15/15.
- `tests/f4-consolidacion.test.ts`: 5/5.
- `tests/finanzas-rules.test.ts`: 40/40.
- `tests/smoke.test.ts`: 26/26.
- `tests/ui/finanzas-ia.test.tsx`: 34/34.
- `tests/ui/office-vinculaciones.test.tsx`: 14/14.
- Las suites de integración se ejecutaron individualmente; una corrida combinada perdió un worker de Vitest.

## Estado

Fase 4 completada y validada focalizadamente. Se preserva el login simulado por rol del demo. La suite global y la conciliación automática con un banco externo quedan fuera de esta validación local; no se conectaron servicios financieros externos.
