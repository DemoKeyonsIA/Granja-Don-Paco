# Resumen Fase 2 - Cuadre integral de ruta

## Objetivo
Implementar un cuadre integral por `guía + producto + unidad base` con regla estricta:
`saldoNoExplicado = carga - ventas netas - merma registrada - retorno físico aceptado - saldo que permanece bajo custodia del camión`  
Solo se cierra sin diferencia si `saldoNoExplicado == 0`.  
Las diferencias se reportan por producto/línea (no se netean entre distintos productos). `tieneDiferencias = diferencias.length > 0`.

## Cambios principales

### 1) Fuente única de verdad
- **Nuevo módulo** `src/lib/cuadre-integral.ts` con `calcularCuadreIntegral()` y tipos: `MovimientoProducto`, `VentaEmitidaMov`, `DevolucionMov`, `MermaMov`, `EntradaCuadre` (`sobranteFisicoCamion`), `LineaCuadre`, `DiferenciaPendiente`, `CuadreIntegral`.
- **Redondeo/EPS**: 3 decimales con EPS 0.0001, clave `producto||unidad`.
- **Cálculos**: ventas netas (ventas - devoluciones parciales ligadas), merma **solo explícita** (`desperdicios`), retornos distinguidos entre **pendientes**, **aceptados** y **rechazados**, y saldo que permanece físicamente en el camión. Los productos y unidades se concilian individualmente.
- **Descuadre físico**: `descuadreFisico = |totalSaldoNoExplicado|`. No fuerza aprobación por sí solo; las aprobaciones se derivan por tipo de diferencia.

### 2) Schema / Migración
- **`src/db/schema.ts`**: `retornos_camion` ampliado con `cantidadAceptada`, `aceptadoPor`, `aceptadoEn`, `condicion`, `tipo`.
- **`src/db/ddl.ts`**: DDL canónico actualizado.
- **`server.ts` (migración idempotente)**: backfill de estados históricos (`Registrado/Recibido/Cerrado` → `PendienteBodega/AceptadoBodega/RechazadoBodega`) y ajustes de esquema.

### 3) Ventas unificadas a `ventas_ruta`
- **`POST /api/ventas`** ahora inserta fila en `ventas_ruta` cuando hay `guiaId` + camión resuelto (usa `siguienteConsecutivo` TIQUETE). 
- **Fuente única**: tanto `/api/logistica/caja/venta` como `/api/ventas` alimentan `ventas_ruta`. Esto elimina desajustes entre Facturación y Cuadre.

### 4) Devoluciones y aceptación por Bodega
- **`POST /api/logistica/caja/devolucion`**: ahora crea el retorno con estado **`PendienteBodega`** y retorna `retornoId` (no se acepta automáticamente).
- **Nuevo endpoint** `POST /api/logistica/bodega/retorno/aceptar` (transaccional + idempotente): acepta parcial o completo, permite **rechazo**, actualiza `cantidadAceptada/aceptadoPor/aceptadoEn/condicion`, mueve a **Bodega Central** y genera `movimientosInventario` tipo `Aceptación Bodega`. 
- **Estados**: `PendienteBodega | AceptadoBodega | RechazadoBodega`. Históricos preservados.

### 5) Aceptación física de sobrantes por Bodega
- **Nuevo endpoint** `POST /api/logistica/bodega/retorno/aceptar-sobrante`, protegido por permiso de Bodega. Recibe un conteo físico obligatorio por producto después del fin de día y antes del cierre.
- Si el conteo coincide con el saldo del camión, mueve el inventario a Bodega Central, pone en cero el saldo del camión, marca etiquetas no entregadas como `EnBodega` y registra el movimiento `Retorno Sobrante Camión`.
- Si hay diferencia, requiere motivo, crea una aprobación `DiferenciaConteoBodega` y responde con diferencia pendiente. **No modifica inventario ni etiquetas.** Volver a contar y enviar un conteo exacto permite continuar cuando fue un error de conteo. La aprobación no modifica stock automáticamente.

### 6) Cuadre Central integrado (aceptación previa obligatoria)
- **`GET/POST /api/logistica/cuadre-central`** migrados al cuadre integral (`construirEntradaCuadre`, `cuadreIntegralDeGuia`, delegando a fuente única).
- **`POST /api/logistica/cuadre-central`**: valida que los retornos etiquetados estén resueltos y que el saldo del camión ya haya sido aceptado físicamente por Bodega. No recibe inventario ni acepta retornos implícitamente. Recalcula la fuente única antes de cerrar.
- **Decisión**: `tieneDiferencias = diferencias.length > 0` (no neto entre productos). `tieneRetornosPendientes`, rechazados, existencias bajo custodia y conversiones kg sin factor bloquean cierre sin diferencias. `cartonesReingresar` informa el saldo actual del camión. `descuadreFisico` se basa en las diferencias por producto.
- **Aprobaciones**: el residuo no se convierte automáticamente a merma; se generan aprobaciones (`DiferenciaCuadre`/`RetornoPendiente`/`AjusteInventario`/`MermaDescuadre`) según caso. Merma **únicamente** desde `desperdicios` explícitos.

### 6) Otros ajustes
- **`fin-dia`, `tablero`** actualizados al modelo integral.
- **`cargarContextoCuadre`** carga `guias_despacho_detalle` y `desperdicios`.
- **`desperdicios`** ahora requiere `origen` en creación.

## Validación
- **TypeScript**: `.\node_modules\.bin\tsc --noEmit` **limpio**.
- **Unitarios clave**: `tests/cuadre-integral.test.ts` **10/10**, `tests/f3-caja.test.ts` **11/11**.
- **E2E actualizados**: `tests/e2e-todos-procesos.test.ts`, `tests/e2e-cadena-custodia.test.ts`, `tests/e2e-ciclo-completo-custodia.test.ts`, `tests/f4-cuadre.test.ts` migrados al nuevo flujo (retornos PendienteBodega, aceptación integrada en cuadre central).
- **Smoke**: `tests/smoke.test.ts` incluye inventario de rutas.
- **Validación focalizada tras la aceptación previa de Bodega**: 7 archivos, **132/132** pruebas pasan (`e2e-cadena-custodia`, `e2e-smoke-flujo`, `f2-despacho`, `f4-cuadre`, `cuadre-integral`, `f4-devolucion-parcial`, `f4-consolidacion`). `npm run lint` y `npm run build` pasaron en esta fase de trabajo; Vite reporta un bundle principal grande como advertencia.
- **Suite completa**: antes del cierre hubo fallos en pruebas ajenas al cuadre y un error de worker; las regresiones encontradas se corrigieron y la última corrida global ya está limpia.

## Auditoría de cierre — 4 de noviembre de 2026

- Preview `GET /api/logistica/cuadre-central` requiere permiso de Bodega/Admin; el cierre requiere permiso de aprobación administrativa. Las pruebas validan 401 sin sesión y 403 para Vendedor.
- Las aprobaciones requieren Admin para consultar/resolverlas. El actor aprobador se toma de la sesión, se rechazan aprobaciones ya resueltas y la actualización de la aprobación + estado de guía se ejecuta en transacción. Aprobar `DiferenciaCuadre` ahora completa la guía `CerradaConDiferencia`; aprobar `DiferenciaConteoBodega` no modifica existencias ni libera la guía.
- La aceptación de retorno, movimiento de inventario, estado de etiqueta y evento de traza ahora ocurren en una misma transacción. El actor de aceptación proviene del usuario resuelto por el backend.
- El cálculo de dinero neto por tiquetes/devoluciones está centralizado en `resumenDineroVentasRuta()` y lo consumen fin de día, tablero y cuadre central.
- Validación posterior a estos cambios: `npm run lint` y `npm run build` correctos; pruebas focalizadas de cuadre (10/10), despacho F2 (16/16), custodia completa (16/16), cadena de custodia (70/70), devolución parcial (2/2), consolidación (5/5), caja F3 (13/13), función pura (17/17), smoke (25/25), procesos integrales (27/27) y e2e con login real (13/13).
- Una corrida global anterior reportó 794/805 pruebas pasando y luego 783/805 con cinco fallos y un error de worker. La sección de actualización abajo registra el resultado vigente luego de corregir las regresiones.

### Actualización de cierre técnico — 4 de noviembre de 2026

- Se añadió una bandeja de aprobaciones al panel Admin (`Aprobaciones`) para revisar solicitudes, quién las reportó, su referencia, descripción y resolución. Los rechazos admiten nota; el aprobador queda derivado de la sesión del servidor.
- La pestaña se filtra por rol Admin y la pantalla no solicita datos al API para usuarios sin ese rol, incluso si reciben un `initialTab` obsoleto. El endpoint también requiere permiso Admin.
- La interfaz deshabilita la aprobación de `DiferenciaConteoBodega` mientras no exista una regla de negocio para faltantes/sobrantes; el servidor también rechaza esa transición con HTTP 409. Se puede rechazar y solicitar recuento. Así una aprobación no aparenta corregir stock cuando no lo hace.
- Regresiones corregidas al investigar la suite global: `NO_LOTE_ACTIVO` se excluye de listados y conteos, el total de aves usa la ocupación real de galerones (no el historial de lotes finalizados), las cargas respetan `camionero_id` persistido al crear camión, y alertas de recepción usan una etiqueta neutral compartida con la UI.
- Validación final de estos cambios: `npm run lint` y `npm run build` correctos. Seis suites focalizadas: **118/118**. Corrida global `npx vitest run --pool=forks --maxWorkers=1`: **45 archivos, 806/806 pruebas pasando**, sin errores de worker.
- El contrato de alta de camión admite el `camioneroId` que envía la pantalla y la forma `camionero_id` usada por clientes API; ambos persisten en `camionero_id` para el filtro de cargas.

## Archivos relevantes
- `src/lib/cuadre-integral.ts` (fuente única)
- `server.ts` (wiring, endpoints unificados, migración)
- `src/db/schema.ts`, `src/db/ddl.ts`
- `tests/cuadre-integral.test.ts`, `tests/f3-caja.test.ts`, `tests/e2e-todos-procesos.test.ts`, `tests/e2e-cadena-custodia.test.ts`, `tests/e2e-ciclo-completo-custodia.test.ts`, `tests/f4-cuadre.test.ts`
- `PLAN-MEJORA-ERP.md`, `docs/requerimientos-erp-granja-don-paco.md`

## Pendiente / límite operativo
- Validar visualmente en el demo el flujo de reconteo, cuarentena y reempaque con el personal de Bodega.
- Suite E2E completa del repositorio: la corrida global no devolvió resumen y el proceso terminó antes de completar; la validación de Fase 2 se apoya en las suites focalizadas indicadas abajo.

## Actualización de política de conteo físico — 5 de noviembre de 2026

El usuario aprobó aplicar la práctica recomendada: reconteo independiente, separación entre quien cuenta y quien aprueba, ajuste auditable y cuarentena del producto hasta investigación.

- Se añadió `inventario_cuarentena` al esquema y al DDL de arranque. La diferencia inicial conserva conteo, usuario, hora y motivo sin mover existencias.
- Bodega puede enviar reconteos independientes; no puede repetirlo alguien que ya participó en un conteo. Administración puede solicitar otro conteo. El aprobador debe ser Admin y distinto de todas las personas registradas como contadoras.
- Si el segundo conteo coincide con sistema, el caso se resuelve sin ajuste y Bodega puede confirmar el sobrante normal. Si confirma la diferencia, Administración aprueba un movimiento positivo/negativo con auditoría; lo físicamente encontrado se mueve a `Cuarentena Bodega` y el saldo del camión se pone en cero.
- La cantidad impresa y la identidad de etiquetas existentes no se reescriben. Se registra el evento de conteo; etiquetas originales pasan a `EnCuarentena` o `DiferenciaInventario`. La aprobación no convierte faltantes en merma.
- El cálculo integral incorpora el delta firmado aprobado. Un faltante aprobado puede explicar el saldo, pero continúa visible como ajuste de inventario, separado de la merma registrada.
- La liberación de cuarentena requiere Admin, motivo de investigación y correspondencia entre la cantidad física y las etiquetas originales. Cuando las cantidades no coinciden, la API bloquea la liberación y exige reempaque/re-etiquetado.
- Cuando la cantidad no coincide con las etiquetas originales, Administración puede vincular etiquetas nuevas del reempaque con el endpoint documentado abajo; el caso sigue en cuarentena hasta completar esa validación y liberación.

### Cierre del pendiente de reempaque — 5 de noviembre de 2026

- Se implementó `POST /api/logistica/bodega/cuarentena/:id/etiquetas-reemplazo`, solo para Administración. Valida que las etiquetas sean nuevas, estén en `Generada`, correspondan al mismo producto y sumen exactamente los cartones físicos del caso.
- Las etiquetas nuevas pasan a `EnCuarentena`; las etiquetas originales pasan a `ReemplazadaReempaque`. Se registra traza bidireccional por etiqueta y auditoría del caso, sin cambiar las cantidades impresas ni sumar stock disponible.
- La liberación ahora activa las etiquetas nuevas vinculadas, mueve el stock de cuarentena a Bodega Central y registra el motivo de liberación. No permite liberar si faltan etiquetas vigentes o su suma no coincide con el conteo físico.
- Se agregó `etiquetas_reemplazo_json` a schema/DDL y auto-migración idempotente para bases existentes.
- La pantalla de Bodega permite a Admin seleccionar etiquetas nuevas generadas para el producto, muestra el total seleccionado y vincula el reempaque antes de liberar.
- Validación focalizada: `tests/f4-cuadre.test.ts` **10/10** y `tests/cuadre-integral.test.ts` **19/19** correctas. También pasaron juntas ocho suites de despacho/caja/custodia/cuadre: **162/162**.

### Validación de esta actualización

- `npm run lint`: correcto.
- `npm run build`: correcto; se mantiene la advertencia de Vite por el bundle principal mayor a 500 kB.
- `tests/cuadre-integral.test.ts`: **19/19** correctas, incluyendo ajuste firmado positivo y negativo.
- `tests/f4-cuadre.test.ts`: **10/10** correctas tras habilitar loopback para Supertest; el escenario valida reconteo independiente, separación de quien cuenta y aprueba, reempaque, etiquetas nuevas y liberación.
- Suites focalizadas: `f2-despacho`, `f3-caja`, `f4-cuadre`, `f4-devolucion-parcial`, `f4-consolidacion`, `cuadre-integral`, `e2e-cadena-custodia` y `e2e-todos-procesos`: **8 suites, 162/162**.
- La corrida global `npx vitest run --pool=forks --maxWorkers=1` no completó ni devolvió resumen en esta sesión; no se reporta como validación exitosa.
