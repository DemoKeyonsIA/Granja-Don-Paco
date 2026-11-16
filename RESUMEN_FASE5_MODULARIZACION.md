# Fase 5 — Modularización técnica y limpieza progresiva

## Primer corte: despacho y custodia

Se extrajeron las rutas de consulta y una transición operativa de guías desde `server.ts` al router `src/server/routes/logistica/guias.ts`:

- `GET /api/logistica/guias`
- `GET /api/logistica/guias-activas`
- `GET /api/logistica/guias/:id`
- `POST /api/logistica/guias/:id/marcar-en-ruta`

`createApp()` sigue creando el servidor Express y registra el router con `registrarRutasGuias`. Las reglas existentes de resumen de dinero, estado lógico y colchón de carga se inyectan como dependencias. No se cambió el contrato HTTP, el orden de rutas ni los permisos.

También se extrajo el cálculo del orden de visita a `src/server/services/logistica/orden-ruta.ts`, una función sin acceso a Express ni a la base de datos que conserva la estrategia existente: vecino más cercano cuando hay coordenadas y orden geográfico alfabético como alternativa.

La creación transaccional de guía también quedó en su router dedicado, `src/server/routes/logistica/crear-guia.ts`. `createApp()` le inyecta la base de datos, el generador de consecutivos, registro de peso, traza de etiquetas y normalizador de errores HTTP; el contrato, la transacción y sus validaciones se conservaron.

El resumen de cobros netos de ruta se centralizó en `src/lib/finanzasRuta.ts` y ahora lo consumen el router de guías y los flujos de cuadre/tablero. Las rutas financieras de depósitos y resumen común quedaron en `src/server/routes/finanzas.ts`; los reportes operativos están en `src/server/routes/reportes-operativos.ts`. Office quedó en `src/server/routes/office.ts`, y vacunaciones, alimento, mantenimiento y desperdicios en `src/server/routes/activos-granja.ts`.

Se eliminó `update_facturacion.js` tras verificar que era byte por byte idéntico a `update_facturacion.cjs` y no tenía referencias. Se conservó `update_app_layout_script.js`: aunque está vacío, un script histórico todavía lo genera. No se borraron los demás parches históricos sin evaluación individual.

El dominio de clientes avanzó con `src/server/routes/clientes.ts` (CRUD básico) y `src/server/routes/clientes-crm.ts` (cartera, análisis y perfil 360). Precios tiene sus routers de consulta (`src/server/routes/precios-lookup.ts`) y administración (`src/server/routes/precios-admin.ts`); el resolvedor puro de reglas permanece en `src/lib/precios.ts`.

Facturación electrónica y consolidación de ruta están en `src/server/routes/facturacion.ts`. Los consecutivos y la fila de Consumidor Final se comparten desde `src/server/services/consecutivos.ts` entre ventas y facturación. Las consultas de inventario, kardex y stock FEFO están en `src/server/routes/inventario-lectura.ts`; los flujos de escritura de inventario y recepción siguen en `server.ts`. Las escrituras de inventario y registro/consulta de pesos se separaron en `src/server/routes/inventario-escritura.ts`. Usuarios y rutas/camiones CRUD ahora están en routers propios. La custodia operativa quedó en `operaciones-custodia.ts`, y caja de ruta, retornos y cuadre en `logistica/caja-custodia.ts`. Los dashboards se registran desde `dashboards.ts` y las aprobaciones (incluidos conteo físico, caja, depósitos y cierre de guía) desde `aprobaciones.ts`.

## Validación

- `npm run lint` (`tsc --noEmit`): correcto.
- `npm run build`: correcto; permanece el aviso existente de Vite por el bundle del navegador mayor a 500 kB.
- Validación enfocada de precios/clientes/despacho/custodia/caja: 142/142, en un worker.
- Validación enfocada de finanzas/reportes: 86/86.
- Validación enfocada de activos/bodega/Office/finanzas: 89/89.
- Validación de Office API/UI: 31/31.
- Validación de facturación/consecutivos/ventas/pagos/finanzas: 137/137.
- Validación de inventario FEFO/kardex/despacho/custodia/consolidación: 103/103.
- Suite completa antes de las últimas extracciones de Office y activos: 44 archivos pasaron; 812 pruebas pasaron y una prueba UI falló en `tests/ui/sin-centro-mando.test.tsx` porque aparece un valor `0` en Finanzas aunque el payload incompleto indica que el bloque no está disponible. Ese fallo es ajeno a los módulos movidos. Las extracciones posteriores pasaron sus pruebas enfocadas.
- `npm run lint` (`tsc --noEmit`): correcto tras extraer aprobaciones.
- `npm run build`: correcto; Vite mantiene el aviso de bundle web mayor a 500 kB.
- Validación final de dashboards, finanzas, custodia, recepción, operaciones, caja y cuadre: 8 archivos, 156 pruebas pasaron. Después de extraer aprobaciones: 3 archivos, 51 pruebas pasaron.

## Estado y siguiente corte

**Fase 5 sigue abierta.** Se completó un corte importante de extracción y las pruebas de los flujos movidos pasan, pero `server.ts` aún mide unas 2.750 líneas y define decenas de handlers. Conserva lógica de ventas/facturas/pagos, gastos, etiquetas/QR, auditoría, asistentes IA, catálogo de productos/tipos de cartón, permisos y otros flujos de granja/operación. La fase solo se podrá cerrar cuando esos dominios estén separados con límites claros, `server.ts` funcione principalmente como composición/middleware y los scripts históricos estén clasificados. No se borraron más scripts históricos sin comprobar referencias y duplicación exacta.

**Siguiente corte recomendado:** extraer transacciones comerciales (ventas, facturas, pagos y gastos) como routers separados, preservando el orden de registro, middleware y contratos; después etiquetas/catálogo, auditoría e IA. Luego hacer un pase de clasificación de scripts y retirar únicamente duplicados confirmados. Actualizar el conteo de rutas y ejecutar suite completa antes del cierre.


## Cierre de la modularización (noviembre 2026)

Se extrajeron los dominios restantes a `src/server/routes/`: autenticación, ventas/facturas/pagos, gastos, granjas/producción, etiquetas/QR, auditoría, asistentes IA, catálogo/precio por cliente, incidentes y auditoría logística. La inicialización de esquema, migraciones compatibles, semillas y backfill ahora se concentra en `src/db/initialize.ts`. `server.ts` quedó en 458 líneas y no registra handlers de negocio: el único handler Express inline es el fallback de Vite; `createApp()` configura middleware, dependencias, routers y salida estática.

El smoke de cobertura ahora descubre rutas dentro de `src/server/routes` recursivamente, por lo que conserva el guard de contratos tras modularizar. Se limpiaron imports y consultas de datos no usados en el backend tocado. Los scripts históricos y archivos de salida se clasificaron en [`docs/INVENTARIO_SCRIPTS_HISTORICOS.md`](docs/INVENTARIO_SCRIPTS_HISTORICOS.md); se conservaron para evitar borrar evidencia sin verificarla.

La inicialización preserva el esquema y migraciones idempotentes existentes, pero todavía no tiene un registro de migraciones numeradas por versión. Se documenta como endurecimiento futuro de base de datos; no se cambió el mecanismo de actualización en este refactor para evitar saltarse migraciones en bases existentes.

### Validación final

- `npm run lint`: TypeScript sin errores.
- `npm run build`: correcto; queda el aviso de bundle web mayor a 500 kB.
- Suite completa: 44 archivos pasaron; 812/813 pruebas pasaron. El único fallo es `tests/ui/sin-centro-mando.test.tsx:250`: en Finanzas se renderiza un `0` pese a que el payload incompleto marca el bloque como no disponible. Es un fallo UI preexistente y ajeno al cambio de rutas.
- El inventario smoke se actualizó para escanear routers recursivamente y pasó en la suite completa.
- Pruebas focalizadas antes de la suite completa: ventas/pagos/gastos/caja 118/118; custodia/etiquetas/recepción/cuadre 118/118; aprobaciones/cuadre/caja/procesos 51/51; smoke/auth/CRM/dashboard/backfill 62/62.
- `tsc --noUnusedLocals` filtrado sobre `server.ts`, `src/server/` y `src/db/initialize.ts`: sin declaraciones locales o imports sin uso en esos módulos.


**Estado: modularización de rutas cerrada.** La migración numerada y el fallo de UI quedan como seguimientos separados, no como lógica de negocio pendiente dentro de `server.ts`.
