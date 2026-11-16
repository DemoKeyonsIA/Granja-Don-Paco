# Fase 3 — Control de precios por cliente

## Cambios implementados

- Las excepciones cliente/producto requieren el permiso de aprobación que actualmente solo tiene Admin. El backend obtiene al aprobador de la sesión/usuario resuelto y no acepta un nombre de aprobador confiado desde el formulario.
- Una excepción requiere precio positivo, justificación y fechas de inicio/fin válidas. Rechaza ventanas solapadas para el mismo cliente y producto.
- El resolvedor central aplica la excepción solo dentro de sus fechas. Al vencer o antes de iniciar, vuelve a la siguiente regla comercial aplicable.
- Cliente 360 permite al Admin crear una excepción temporal (30 días por defecto), muestra aprobador, vigencia y estado efectivo, y permite desactivarla. La desactivación conserva el registro en vez de borrarlo y genera auditoría.
- El esquema nuevo incluye fechas de vigencia y el arranque agrega las columnas de forma idempotente en bases existentes.
- Se conserva el login de demo actual; las llamadas del formulario usan el token y el identificador de la sesión activa.
- Crear listas, agregar bandas, cambiar precios y desactivar excepciones exige permiso Admin. El actor se deriva del usuario autenticado y se guarda en auditoría; el frontend ya no pide escribir manualmente el aprobador.
- Crear una lista Ruta o Cliente exige seleccionar su ámbito. Agregar producto valida que exista la lista y que no haya una fila duplicada. Los rangos se validan como precio objetivo dentro de piso/techo y descuento válido.
- Al cambiar el precio objetivo, el sistema mueve proporcionalmente el piso y el techo para conservar la banda negociable. Se rechaza una banda heredada incoherente antes de cambiar el registro.

## Verificación

- `npm run lint`: correcto después de los cambios.
- `tests/precios-resolver.test.ts`: 7/7.
- `tests/e2e-clientes-crm.test.ts`: 7/7, incluida autorización Admin para listas/bandas/excepciones, vigencia, bloqueo de solapamiento, identidad verificada del aprobador y desactivación con historial.
- `tests/f3-caja.test.ts`: 13/13.
- `tests/e2e-cadena-custodia.test.ts`: 70/70, incluida banda reescalada en el historial.
- `tests/e2e-cobertura-gaps.test.ts`: 20/20.
- `tests/smoke.test.ts`: 25/25, con contratos de sesión y verificación de rutas.
- Una ejecución conjunta previa perdió un worker nativo de Vitest; los archivos de dominio terminaron correctamente ejecutados por separado.

## Siguiente trabajo

- Verificar de nuevo `npm run build` y la suite general tras la última protección de rutas.
- Continuar Fase 4: idempotencia en creación/envío de documentos fiscales, conciliación venta↔tiquete↔factura↔pago y trazabilidad de gastos/caja.
- La revisión completa de permisos de todas las rutas sigue siendo un objetivo transversal de Fase 1.
