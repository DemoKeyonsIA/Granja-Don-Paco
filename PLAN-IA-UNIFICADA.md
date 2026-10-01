# Plan de aplicación de los 3 bocetos a código — IA unificada

> Estado: **aprobado, Fase 0 en curso**.
> Origen: `bocetos/boceto-modulo-office.html`, `bocetos/boceto-operaciones-logistica.html`, `bocetos/boceto-finanzas-reportes.html`
> Meta: que los tres bocetos se vean en el **build de producción** (`npm run build` + `npm start`), con E2E + smoke por fase.

## Decisiones tomadas (2026-09-30)

| Decisión | Elección | Consecuencia |
|---|---|---|
| Cobertura de UI | **jsdom + @testing-library/react + user-event** | Los tests de UI usan el docblock `// @vitest-environment jsdom`; sin tocar `vitest.config.ts` ni descargar navegador. Los 345 tests HTTP siguen en `environment: node`. |
| Facturación para Comercial | **Comercial entra al módulo Finanzas** | `macroModules.finanzas.roles` pasa a `['Admin', 'Socio', 'Comercial']`, con tabs por rol: Comercial ve **Documentos + Analítica**, no Resumen ni Cobranza. El tab `facturacion` de Logística desaparece para todos. Una sola ruta de acceso. |
| "Producción" | **Solo build local** | Cada fase cierra con `npm run build` + `npm start` verificado en `http://localhost:5174`. Sin hosting. Publicar queda fuera del alcance. |

---

## 0. Hechos del terreno que condicionan el plan

Investigados en el código, no asumidos:

| Hecho | Evidencia | Impacto |
|---|---|---|
| **No hay git** | `.git` no existe | Sin red de seguridad. **Fase 0 debe hacer `git init` + commit base.** |
| **No hay deploy configurado** | sin `vercel.json` / `netlify.toml` / `fly.toml` / `render.yaml` / `.github` | "Producción" = `dist/` servido por `npm start` en el puerto 5174. Para internet hace falta definir un hosting. |
| **Cero tests de UI** | vitest corre en `environment: node`; sin Playwright/Puppeteer/jsdom | **Un cambio de navegación es invisible a la suite actual.** Es el riesgo #1 del plan. |
| Runner | `vitest run` (4.1.10) + `supertest`; 23 archivos, **345 tests**, todos verdes en 8.9 s | Plantilla a copiar: `tests/e2e-office.test.ts` |
| `npm run lint` es typecheck | `tsc --noEmit` (no hay ESLint en el repo) | Gate único de tipos |
| Aislamiento de tests | `createApp(true, testDb)` + libsql file-backed `.test-<nombre>.db` | Cada archivo de test necesita un `.db` nuevo y único |
| Sin endpoint de salud | no existe `/api/health` | El smoke de boot es implícito (si `beforeAll` no lanza, arrancó) |
| Puerto único | `5174`, Vite corre como *middleware* dentro de Express | No hay proxy ni `VITE_*`; el front usa rutas `/api/...` relativas |
| 23 `.test-*.db` huérfanos en la raíz | no están en `.gitignore` | Limpiar en Fase 0 y añadir a `.gitignore` |

### Bugs reales encontrados durante la investigación (no estaban en los bocetos)

1. **`ventas-ruta` es un 404 garantizado.** `Reportes.tsx:37` pide `/api/reportes/ventas-ruta`; `server.ts:5794` sirve `/api/reportes/ventas-por-ruta`. El 0 resultado es la cadena `ventas` + `-ruta`. Y `Reportes.tsx:28` nunca chequea `res.ok`, así que el fallo se renderiza como *"No hay ventas registradas"*.
2. **Un Socio que entra a Finanzas ve P&L bajo un tab que no está seleccionado.** `App.tsx:711` solo muestra `Reportes` para no-Admin, pero `App.tsx:111` deja `subTab='flujo'`; `App.tsx:725` renderiza `<Finanzas/>` igual. La causa del desajuste de permisos que reporté entre el módulo y el Centro de Mando.
3. **`/api/produccion/historial` está registrado dos veces** (`server.ts:836` sin filtros y `server.ts:1278` con filtros). Express gana el primero: los filtros de granja y fecha de `Granjas.tsx:1009` se ignoran en silencio. Y `server.ts:1282` filtra por `p.granjaId`, columna que `produccion_diaria` no tiene.
4. **`Cobranza.tsx:55` usa `Math.abs`** en `calculateDaysPast`, así que una factura con fecha futura reporta antigüedad positiva.
5. **`notas de débito` no existen.** El tipo es `'Factura' | 'Tiquete' | 'NotaCredito'` (`types.ts:187`); cero coincidencias de `NotaDebito` en todo el repo. El boceto de Documentos las muestra: hay que crearlas o quitarlas del diseño.
6. **El P&L se calcula 11 veces** con 4 definiciones incompatibles. El caso peligroso es *Cuentas por Cobrar*: 3 semánticas distintas, así que los números no coinciden entre pantallas.
7. **Un Socio que entra a sesión aterriza en un módulo que no ve.** `moduloPorDefecto(['Socio'])` devuelve `'logistica'`, pero `logistica.roles` es `['Admin','Comercial']`. El módulo renderiza y el breadcrumb muestra "Logística", pero el sidebar del Socio no tiene esa entrada: no hay forma de navegar a otro sitio. Detectado por `tests/ui/nav-render.test.tsx` en la Fase 0, no estaba en los bocetos.
8. **Un crash en un módulo borra toda la aplicación.** `App.tsx` envuelve todo el shell en un único `ErrorBoundary`; un fallo en `DashboardEnterprise` deja al usuario en la pantalla de error global en lugar de conservar la navegación.

---

## Fase 0 — Red de seguridad y andamiaje de tests

**Objetivo:** que las fases 1-7 sean reversibles y que la navegación sea verificable por tests.

| | |
|---|---|
| **Código** | `git init` + commit base. Añadir `.test-*.db` a `.gitignore`. Borrar los 23 `.db` huérfanos. Extraer la IA a datos puros: `src/nav/modulos.ts` (módulos, tabs, defaults, breadcrumbs, `INCIDENCIAS_CONOCIDAS` y `validarConfig()`) e `src/nav/icons.tsx` (mapa de iconos). `App.tsx` pasa a importar de ahí. Instalar `jsdom` + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` (sin navegador) con el docblock `// @vitest-environment jsdom` en los tests de UI, sin tocar `vitest.config.ts`. Añadir `data-modulo-id`, `data-testid="nav-tabs"` y `data-tab-id` a la navegación. |
| **Por qué** | Hoy los tabs son arrays literales inline en 6 lugares de `App.tsx`. Sin extraerlos a datos puros, ninguna fase es testeable ni reversible. |
| **Tests** | `tests/nav-config.test.ts` — 56 tests de caracterización e invariantes sobre la config pura, incluidos los 4 bugs abiertos y sus fases. `tests/ui/nav-render.test.tsx` — 31 tests de render real con `jsdom` + `user-event`: sidebar por rol, módulo de entrada, fila de tabs por módulo, camino móvil, breadcrumbs y navegación propia de Office/Admin. Los módulos hijos se sustituyen con `vi.doMock` (no `vi.mock`: dentro de un bucle el hoisting rompe la ruta) usando rutas relativas al archivo de test. |
| **Def. de hecho** | `npm run lint` verde · suite completa verde (345+N) · `git status` limpio tras el commit |

---

## Fase 1 — Bugs críticos (sin cambio de IA visible)

**Objetivo:** arreglar lo que hoy está roto antes de mover nada.

| | |
|---|---|
| **Código** | `Reportes.tsx:37` → id `ventas-por-ruta`. `Reportes.tsx:28` → chequeo de `res.ok` con mensaje de error. `App.tsx` → tab por defecto de Finanzas coherente con el rol. **Y el módulo por defecto de Socio: hoy es `logistica`, pero `logistica.roles` es `[Admin, Comercial]`, así que un Socio aterriza en un módulo que no tiene en su sidebar y del que no puede salir (bug 4, detectado por `tests/ui/nav-render.test.tsx`).** Eliminar el handler duplicado de `/api/produccion/historial` (`server.ts:836`); el de `server.ts:1278` pasa a filtrar por `galeronId`. `Cobranza.tsx:55` → quitar `Math.abs`. `Facturacion.tsx` → botón "Imprimir" sin `onClick` (`:746`). |
| **Tests** | `tests/e2e-fixes-criticos.test.ts` — 200 en los 5 reportes (incluido `ventas-por-ruta` con datos), filtro de fechas aplicado en financiero, historial de producción devuelve solo la granja pedida, aging de fecha futura = 0 días. `tests/smoke.test.ts` → +1 caso: los 5 reportes responden 200. Actualizar `tests/nav-config.test.ts` y `tests/ui/nav-render.test.tsx` para que los 4 bugs queden como regresión cubierta y `validarConfig()` devuelva `errores` vacío. |
| **Def. de hecho** | Los 5 tabs de Reportes muestran datos. Socio entrando a Finanzas ve un tab seleccionado que corresponde al contenido. |

---

## Fase 2 — Cimientos de datos de Finanzas (`pagos` + vencimiento)

**Objetivo:** desbloquear la pantalla de Cobranza del boceto, que hoy está marcada como requisito.

| | |
|---|---|
| **Código** | Siguiendo el idioma de auto-migración existente (`server.ts:6990-7050`: `PRAGMA table_info` + `ALTER TABLE` condicional):<br>· tabla `pagos (id, factura_id, fecha, monto, metodo, usuario_id)`<br>· columna `facturas.fechaVencimiento` + backfill desde `condicion_pago` (0/8/15 días)<br>· `POST /api/pagos` (`server.ts:673`) real: inserta en `pagos`, acepta pago parcial, calcula saldo, solo marca `Pagada` si saldo = 0, nunca revive una factura `Anulada`<br>· `GET /api/clientes/analisis` (`server.ts:2329`) pasa a aging por vencimiento real |
| **Tests** | `tests/e2e-pagos.test.ts` — inserción, pago parcial, pago completo en 2 cuotas, bloqueo de factura anulada, saldo pendiente consistente, `no Anulada`. `tests/e2e-cobranza-aging.test.ts` — buckets 1-30/31-60/61-90/>90 por vencimiento, DSO, % vencida. `tests/smoke.test.ts` → +1 caso: `GET /api/clientes/analisis`. |
| **Riesgo** | **Es la única fase que muta datos existentes.** Requiere copia de `local.db` antes de empezar y un test de migración sobre una base con datos preexistentes. |
| **Def. de hecho** | Un cobro parcial deja historial consultable y el aging refleja el vencimiento real. |

---

## Fase 3 — Fuente única del P&L: `/api/finanzas/resumen`

**Objetivo:** que exista **un** lugar que calcula el dinero.

| | |
|---|---|
| **Código** | Nuevo endpoint con: ingresos, gastos, utilidad, margen, cartera, Δ vs período anterior, gastos por categoría, y el **ciclo del dinero** (ventas_ruta → documentos → CxC → cobro → caja → resultado). Incluir `ventas_ruta` en la utilidad (gap #1 del boceto). `src/lib/finanzas.ts` con `fmtCRC` (promovido de `CajaRuta.tsx:11`, reemplaza 40 llamadas `.toLocaleString()` sueltas) y una sola definición de `cuentasPorCobrar`. `/api/dashboard/enterprise` pasa a consumir este endpoint en vez de recalcular. |
| **Tests** | `tests/e2e-finanzas-resumen.test.ts` — cifras cuadran contra `facturas`+`gastos` crudos, `ventas_ruta` incluida, Δ correcto, gasto por categoría, `0`facturas no revienta. `tests/e2e-consistencia-kpis.test.ts` — **el test que hoy no existe**: el mismo número calculado en 4 pantallas debe dar idéntico. |
| **Def. de hecho** | Ingresos/Gastos/Utilidad/Margen/Cartera coinciden bit a bit entre Resumen, Analítica y el bloque fusionado. |

---

## Fase 4 — Finanzas: 4 tabs (Resumen · Documentos · Cobranza · Analítica)

**Objetivo:** la pantalla A–D del boceto.

| | |
|---|---|
| **Código** | `src/nav/tabs.ts`: `resumen · documentos · cobranza · analitica` con `roles` por tab (reutiliza el patrón `DashboardEnterprise.tsx:55-60`).<br>· `FinanzasResumen.tsx` nuevo: las 5 tarjetas + banda del ciclo + bandeja "Requiere atención". Reemplaza `Finanzas.tsx` (que se elimina).<br>· `Facturacion.tsx` pasa a ser el tab **Documentos** (sus 3 listas de `:702-890`); se le quita el tab anidado.<br>· `Reportes.tsx` → sub-fila de **Analítica** con 6 tipos (agrega `flujo-caja`). Se borra su fila interna de tabs (`Reportes.tsx:35-41` la baja al sub-menú).<br>· El tab `facturacion` de Logística (`:699`) desaparece; "Registro de Gastos" (`Finanzas.tsx:118`) deja de ser tab y pasa a acción del `+ Nuevo` (`App.tsx:188`).<br>· Llego a la Fase 5: el bloque "Salud del negocio" reusando datos de `/api/finanzas/resumen`. |
| **Tests** | `tests/ui/finanzas-ia.test.ts` — Admin ve 4 tabs; Comercial ve Documentos; Socio ve Resumen+Analítica; el tab visible siempre corresponde al contenido renderizado (el bug #2). `tests/e2e-finanzas-roles.test.ts` — matriz de permisos. `tests/smoke.test.ts` → las 4 pantallas cargan sin 500. |
| **Decisión tomada** | Comercial entra al módulo Finanzas: `finanzas.roles = ['Admin','Socio','Comercial']`, y la matriz de tabs por rol queda Admin=4, Socio=Resumen+Analítica, Comercial=Documentos+Analítica. El tab `facturacion` de Logística se elimina para todos los roles. |

---

## Fase 5 — El Centro de Mando se disuelve dentro de Resumen

**Objetivo:** quitar el módulo `dashboard` del sidebar.

| | |
|---|---|
| **Código** | Quitar `{ id: 'dashboard' }` de `macroModules` (`App.tsx:251`). El bloque "Salud del negocio" (Producción + Logística) vive como columna derecha de Resumen. La bandeja de alertas del Centro de Mando se fusiona con "Requiere atención" → **una sola bandeja**. Borrar los tabs internos de `DashboardEnterprise.tsx:55-60`. Eliminar código muerto: `src/components/Dashboard.tsx`, `DashboardAdmin.tsx` (nunca importados; `Dashboard.tsx` además tiene datos fijos de una clínica "ILCASU") y los scripts `add_tab_component.cjs`, `update_dashboard.cjs`, `rewrite_app.cjs`. El `activeTab` por defecto de Admin pasa de `dashboard` a `finanzas`. |
| **Tests** | `tests/ui/sin-centro-mando.test.ts` — 'Centro de Mando' no aparece en el sidebar de ningún rol; Resumen sí muestra Salud del negocio. `tests/e2e-dashboard-consumido.test.ts` — los KPIs del dashboard viejo coinciden con `/api/finanzas/resumen`. `tests/smoke.test.ts` → el app arranca sin el módulo. |
| **Def. de hecho** | Ningún rol ve "Centro de Mando"; no queda ni un import del componente borrado. |

---

## Fase 6 — Office: Vinculaciones pasa de Admin a Office

**Objetivo:** el tercer tab del boceto de Office.

| | |
|---|---|
| **Código** | `Office.tsx` pasa de 2 espacios (`correo`, `documentos`) a 3: agregar `vinculaciones`, moviendo `OfficeVinculos` desde `Admin.tsx:52`. Quitar el tab de `Admin.tsx:17`. Actualizar `nuevoItems` (`App.tsx:195-197`) y `subLabels`. |
| **Tests** | Extender `tests/e2e-office.test.ts` — el módulo sigue accesible, la lista de reglas se ve en el tab correcto, Admin-only se mantiene, la ruta vieja `/admin/vinculaciones` deja de existir. |
| **Nota** | Es la fase más barata: el backend (`/api/office/vinculaciones`) y sus 6 tests ya existen. Es un movimiento de UI. |

---

## Fase 7 — Operaciones: hub de 5 grupos

**Objetivo:** `Resumen · Granja · Bodega · Despacho · Ventas` en una sola fila.

| | |
|---|---|
| **Código** | Quitar `granja` de `macroModules` (`App.tsx:253`).<br>· `BodegaAdmin.tsx` pasa de 2 tabs (`Bodega`, `Control`) a 5, con `roles` por tab (añadir el campo que hoy no tiene y reusar el filtro `DashboardEnterprise.tsx:135`).<br>· **Granja**: `Granjas.tsx` montado como tab; `SaludAvicola` / `Alimento` / `Mantenimiento` como sub-fila. `Granjas.tsx` queda montado en 2 lugares (hub + `Admin › Infraestructura`); se acepta el estado interno duplicado, igual que hoy.<br>· **Despacho**: `DespachoAdmin.tsx` se mueve desde Logística (`Logistica.tsx:549`).<br>· **Ventas**: `CajaRuta.tsx` se mueve desde Logística.<br>· El camino móvil (`App.tsx:608-638`) se mantiene intacto; los roles Bodeguero/Despachador/Camionero no ganan tabs que no puedan usar. `granja` sigue siendo solo Admin.<br>· Habilitar el breadcrumb para `operaciones` (`App.tsx:570` hoy lo suprime).<br>· El maestro de alta **no se mueve**: sigue en `Admin › Infraestructura`. |
| **Tests** | `tests/ui/operaciones-ia.test.ts` — Admin ve 5 tabs; Bodeguero ve solo Bodega; Despachador ve Despacho; Camionero el camino móvil; Comercial ve Despacho+Ventas; el sub-label del breadcrumb ya no está vacío. `tests/e2e-operaciones-hub.test.ts` — los endpoints de cada tab responden con el rol correcto. `tests/smoke.test.ts` → los 5 tabs del hub cargan. |
| **Def. de hecho** | 1 fila de tabs en el módulo; 'Granja' ya no es entrada del sidebar; el maestro sigue en Admin. |

---

## Fase 8 — Cierre y entrega

| | |
|---|---|
| **Código** | Barrido de duplicados restantes: los 4 componentes de tarjeta KPI (`Reportes.tsx:90`, `DashboardEnterprise.tsx:256/:514/:534`) → uno. Los 3 spinners de carga → uno. Las 4 reimplementaciones locales de `cn` → import de `src/lib/utils.ts`. `Finanzas.tsx` y `DashboardEnterprise.tsx` borrados. |
| **Tests** | Consolidar `smoke.test.ts` (hoy 74 casos) como smoke maestro: 1 caso por endpoint, agregado. Suite completa en verde. |
| **Entrega** | `npm run build` + `npm start` → el build de producción sirviendo los 3 bocetos aplicados, verificado en `http://localhost:5174`. Sin hosting: publicar queda fuera del alcance. |

---

## Orden y rationale

```
F0 red ─► F1 bugs ─► F2 datos ─► F3 fuente única ─► F4 tabs ─► F5 disolver ─► F7 hub
                                                                   F6 office (independiente)
```
- **F1 antes que todo**: los bugs掩盖 (mascaran) los bugs de navegación. Arreglarlos al final sería diagnosticar el síntoma equivocado.
- **F2 antes que F4**: la pantalla de Cobranza del boceto está marcada "requisito" en 13 lugares. Sin la migración, se entrega un mock que la app no puede cumplir.
- **F3 antes que F4**: la regla de oro del boceto es *un solo lugar calcula el P&L*. Implementar los 4 tabs antes del endpoint significa codificar la duplicación y luego desarmarla.
- **F5 después de F4**: el Centro de Mando se disuelve *dentro* de Resumen, así que Resumen tiene que existir primero.
- **F6 en cualquier momento**: es independiente de Finanzas y Operaciones.

## Rollback

Cada fase es un commit. Sin nada commiteado, `git checkout .` no sirve — de ahí el `git init` de la Fase 0.

## Definición de "en producción"

Con la infraestructura actual, "producción" es `npm run build` + `npm start` sirviendo `dist/` en el puerto 5174. **No hay hosting configurado**, así que esto no llega a internet por sí solo. Hace falta decidir el destino: AI Studio (que es de donde viene el proyecto), o un host nuevo.
