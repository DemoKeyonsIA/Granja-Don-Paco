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
| **Realizado** | Commit `f5db611` (Fase 4) dejó el terreno; esta fase cerró en el commit de Fase 5. Decisiones que se apartaron del texto original, y por qué:<br>• **El módulo no quedó como entrada oculta con `roles: []`**: se borró de `MODULOS` y del tipo `ModuleId`. Con `roles: []` el id `dashboard` seguía siendo un destino válido —y `validarConfig` lo marca como error— sin pantalla que lo atienda.<br>• **`DashboardEnterprise.tsx` se borró acá y no en la Fase 8.** Al salir el módulo del sidebar quedó con 721 líneas sin un solo import; quitarle los tabs internos, como pedía la fila de arriba, exige elegir cuál de los cuatro cuerpos sobrevive, y ese contenido vive hoy en Granja > Salud Avícola y en el hub de la Fase 7. La Fase 8 ya lo tenía como tarea de borrado, así que adelantarlo deja el repo sin código muerto desde esta fase.<br>• **"Salud del negocio" toma solo las siete claves de producción, bodega y logística** de `/api/dashboard/enterprise`. Los cinco campos de dinero que ese endpoint también devuelve se descartan en un pick explícito (`operativoDe`), no por criterio de render: si el resumen y el dashboard pueden pintar P&L, la Fase 3 vuelve a deshacerse. Si el payload viene incompleto, el bloque se oculta en vez de pintar ceros.<br>• **La operación va en una llamada aparte y a su propio estado.** Si `/api/dashboard/enterprise` falla, Resumen conserva las tarjetas, el ciclo y la cartera: un bloque accesorio no puede tumbar la pantalla que tiene los números que deciden.<br>• `tests/ui/sin-centro-mando.test.ts` se escribió como `.tsx` porque monta la app con `jsdom`, igual que los demás tests de UI.

---

## Fase 6 — Office: Vinculaciones pasa de Admin a Office

**Objetivo:** el tercer tab del boceto de Office.

| | |
|---|---|
| **Código** | `Office.tsx` pasa de 2 espacios (`correo`, `documentos`) a 3: agregar `vinculaciones`, moviendo `OfficeVinculos` desde `Admin.tsx:52`. Quitar el tab de `Admin.tsx:17`. Actualizar `nuevoItems` (`App.tsx:195-197`) y `subLabels`. |
| **Tests** | Extender `tests/e2e-office.test.ts` — el módulo sigue accesible, la lista de reglas se ve en el tab correcto, Admin-only se mantiene, la ruta vieja `/admin/vinculaciones` deja de existir. |
| **Nota** | Es la fase más barata: el backend (`/api/office/vinculaciones`) y sus 6 tests ya existen. Es un movimiento de UI. |
| **Realizado** | Decisiones que se apartaron del texto original, y por qué:<br>• **El espacio lleva `roles: ['Admin']`, y eso cambia el alcance.** Office es visible para Admin, Socio y Comercial, así que un espacio sin filtro abriría un 403 en pantalla a los dos roles que no son Admin. El filtro refleja `requireOfficeAdmin`, que ya gobernaba el endpoint antes de la mudanza, y ahora es la única puerta: la fila (`subTabsDe`), la resolución del espacio (`espacioOfficeDe`) y `Office` usan la misma matriz.<br>• **`espacioOfficeDe()` nuevo en `modulos.ts`.** El shell comparaba `subTab` contra `ESPACIOS_OFFICE` sin mirar el rol, así que un `subTab` heredado de la época en que Vinculaciones vivía en Admin montaba la pantalla para un Socio. Se reemplaza esa comparación por un resolvedor que cae al primer espacio visible.<br>• **`subTabPorDefecto('office')` dejó de devolver `''`,** y `validarConfig()` perdió la excepción `m.id === 'office'` que lo saltaba. Con el default resuelto como "primer visible", Office cumple el mismo invariante que los demás módulos en vez de quedar fuera del chequeo.<br>• **La fila de `Admin.tsx` ahora se deriva de `SUBTABS_ADMIN`** (solo iconos y colores quedan en el componente). El texto de la fase lo daba por hecho, pero era la mitad del problema: la fila repetía los tabs en su propio array, y por eso Vinculaciones siguió apareciendo en Admin después de salir de la configuración. Sin esta conexión, la fase cerraba a medias. El shell sigue sin dibujar una fila para Admin: cada tab de Admin monta su propia pantalla con su encabezado.<br>• **Montar Vinculaciones ya no dispara la carga de la bandeja.** `Office` compartía una sola pantalla para Correo y Documentos y pedía cuentas, mensajes, documentos, árbol y resumen siempre; desde Vinculaciones esas cinco respuestas no se usan. `sembrarSiEstaVacio` además hace cuatro `POST` de cuentas: se ahora una sola vez por montaje y no al entrar a Vinculaciones, donde nadie ve la bandeja.<br>• **Efecto de carga reescrito con un `ref` de la ejecución previa.** Con `espacio` en las dependencias, cambiar entre Correo y Documentos recargaba los cinco recursos (antes no recargaba). El `ref` distingue primera carga, cambio de filtro y vuelta desde Vinculaciones. Al implementarlo apareció un fallo real de la Fase 0: `rolesEfectivos` devuelve un array nuevo en cada llamada, así que sin `useMemo` el efecto que sincroniza `initialEspacio` se disparaba en cada render y el click en la fila se perdía.<br>• **La búsqueda de "vínculo / regla / integración" lleva a Admin a Office › Vinculaciones y a los demás roles a Documentos**, no a Admin. Documentos es donde un Socio o un Comercial sí ven los adjuntos que una regla debería haber vinculado.<br>• **`+ Nuevo` gana "Nueva regla" en el espacio Vinculaciones, y solo para Admin.** Sigue siguiendo al espacio activo, igual que antes; la condición es por rol porque es el único de los tres con filtro.<br>• **La ruta vieja `/admin/vinculaciones` no se comprueba con un 404 REST.** Nunca existió como ruta HTTP: era un `subTab` de Admin. Su ausencia se prueba en UI y en configuración, que es donde lived la puerta.<br>• **`tests/ui/office-vinculaciones.test.tsx` (14 casos) reemplaza casi toda la fila de tests prevista.** La lista de reglas en el tab correcto, la matriz por rol y la ausencia de Vinculaciones en Admin son cosas de render, y un test HTTP no las puede ver. `tests/e2e-office.test.ts` solo creció con el caso que faltaba: GET de Socio a `/api/office/vinculaciones` → 403 (ya cubría Comercial).<br>• `data-testid="office-espacios"`, `data-espacio-id` y `data-testid="admin-tabs"` se agregaron para que los tests affirmen sobre la fila y no sobre el texto del botón, que concatena etiqueta y contador.<br>• **Dos hallazgos preexistentes, fuera de alcance:** `+ Nuevo › Conectar cuenta` aparece para Socio y Comercial, aunque `POST /api/office/cuentas` es Admin-only; y `requireOfficeAdmin` revisa solo `usuario.role` (el rol principal), mientras el shell usa roles efectivos, así que un Comercial con Admin como segundo rol ve el espacio y recibe 403. El segundo lo agrava esta fase y queda anotado para cuando se unifique el modelo de permisos. |

---

## Fase 7 — Operaciones: hub de 5 grupos

**Objetivo:** `Resumen · Granja · Bodega · Despacho · Ventas` en una sola fila.

| | |
|---|---|
| **Código** | Quitar `granja` de `macroModules` (`App.tsx:253`).<br>· `BodegaAdmin.tsx` pasa de 2 tabs (`Bodega`, `Control`) a 5, con `roles` por tab (añadir el campo que hoy no tiene y reusar el filtro `DashboardEnterprise.tsx:135`).<br>· **Granja**: `Granjas.tsx` montado como tab; `SaludAvicola` / `Alimento` / `Mantenimiento` como sub-fila. `Granjas.tsx` queda montado en 2 lugares (hub + `Admin › Infraestructura`); se acepta el estado interno duplicado, igual que hoy.<br>· **Despacho**: `DespachoAdmin.tsx` se mueve desde Logística (`Logistica.tsx:549`).<br>· **Ventas**: `CajaRuta.tsx` se mueve desde Logística.<br>· El camino móvil (`App.tsx:608-638`) se mantiene intacto; los roles Bodeguero/Despachador/Camionero no ganan tabs que no puedan usar. `granja` sigue siendo solo Admin.<br>· Habilitar el breadcrumb para `operaciones` (`App.tsx:570` hoy lo suprime).<br>· El maestro de alta **no se mueve**: sigue en `Admin › Infraestructura`. |
| **Tests** | `tests/ui/operaciones-ia.test.ts` — Admin ve 5 tabs; Bodeguero ve solo Bodega; Despachador ve Despacho; Camionero el camino móvil; Comercial ve Despacho+Ventas; el sub-label del breadcrumb ya no está vacío. `tests/e2e-operaciones-hub.test.ts` — los endpoints de cada tab responden con el rol correcto. `tests/smoke.test.ts` → los 5 tabs del hub cargan. |
| **Def. de hecho** | 1 fila de tabs en el módulo; 'Granja' ya no es entrada del sidebar; el maestro sigue en Admin. |
| **Realizado** | Decisiones que se apartaron del texto original, y por qué:<br>• **La fila la dibuja el shell, no `BodegaAdmin`.** El texto pedía que `BodegaAdmin` pasara de 2 tabs a 5 con `roles` por tab, pero un componente no sabe qué roles tiene el usuario: el shell resuelve esa matriz desde la sesión. Además una fila interna no mueve `subTab` ni el breadcrumb, que viven en `App.tsx`. Así que los 5 grupos viven en `SUBTABS_OPERACIONES_DESKTOP` y el shell dibuja las dos filas con `renderFilaTabs`. `BodegaAdmin` recibe `vista` y `onVista`.<br>• **Granja no quedó como módulo con sub-fila, sino al revés: grupo con sub-fila.** `'granja'` se borró de `MODULOS` y del tipo `ModuleId`, y `SUBTABS_GRANJA` (`granjas`, `salud`, `alimento`, `mantenimiento`) sobrevive como sub-fila resuelta por `subTabsInternosDe` — el mismo mecanismo que usa Analítica para sus tipos de reporte, y no un caso especial.<br>• **`BodegaAdmin` perdió su fila y su `useState`.** La vista de existencias pasó a llamarse `existencias` y `control` quedó como la segunda; `bodega` es ahora solo el id del grupo. `subTabsInternosDe` resuelve la sub-fila por id de grupo **o** de item, porque si solo aceptara el grupo, al elegir una vista la fila desaparecería y el usuario perdería el retorno. Consecuencia aceptada: los dos contadores que eran badges de la fila interna (etiquetas generadas, total de alertas) ya no están en la fila; los números siguen en el bloque KPI de la vista. La fila del shell es la misma de todos los módulos y no tiene badges.<br>• **`ResumenDelDia` dejó de ser código muerto.** Reescrito: pide `/api/dashboard/enterprise`, toma 5 claves por nombre (no por posición, como hacía `operativoDe` en Fase 5, porque aquí no hay orden fijo que proteger), se oculta entero si falta una y lleva carga, error y reintento propios. Las props que recibía (`enTransito`, `cajasPendientes`) no correspondían a ningún payload.<br>• **En Logística, `initialTab` por fin hace algo.** Era un parámetro aceptado y descartado: `Logística › Guías de Despacho` montaba Auditoría de Ruta. Ahora es `useState(initialTab ?? 'trazabilidad')`, y el núcleo se queda con Auditoría, Guías, Rutas y Cierre. `subTabPorDefecto('logistica')` ya no distingue roles: el default del Comercial era `caja`, que ya no existe.<br>• **`BREADCRUMB_EXTRA` e `INCIDENCIAS_CONOCIDAS` quedaron vacías.** Sus entradas (`produccion`, `desperdicios`) eran ids que ningún `SUBTABS_*` declaraba y que ningún cuerpo montaba; las dos incidencias conocidas apuntaban al mismo sitio. Ambas siguen declaradas y ahora vacías, con tests que fallan si alguien las vuelve a llenar creyendo que hacen algo.<br>• **El breadcrumb de una sub-fila nombra su grupo** ("Granja", "Bodega"), que es la convención que ya tenía Analítica con sus reportes.<br>• **`Granjas` sí quedó montado en dos lugares** (hub y `Admin › Infraestructura`, que era lo que decía el texto), con el estado interno duplicado que ya existía cuando granja era módulo propio.<br>• **`+ Nuevo` y la búsqueda dejaron de ofrecer puertas que no existían.** `+ Nuevo` ofrecía "Producción" a un Camionero, y era un id que nada montaba; ahora sale de los grupos visibles. La búsqueda tenía un bug real: solo comparaba `remision` sin tilde, así que escribir "remisión" —como lo escribe la gente— no llevaba a nada; ahora ambas formas funcionan, como ya hacía `vínculo`. Y las tres búsquedas que apuntan al hub (remisión, venta, granja) resuelven el destino en `destinoGrupoOperaciones`, que devuelve **`null` cuando el rol no tiene Operaciones**: un Socio busca "granja" y la granja no existe para él, así que no se mueve en vez de abrir el módulo igual y dejarlo con el módulo activo sin fila y sin cuerpo. El camino móvil se resuelve primero porque es el que decide qué se monta (`esRolMovil` gana sobre la fila de escritorio).<br>• **Los E2E no pueden afirmar "con el rol correcto".** Casi ningún endpoint tiene middleware de rol (solo Office lo tiene), así que un 200 no significa que quien puede entrar pueda ver. `tests/e2e-operaciones-hub.test.ts` comprueba que cada grupo tiene endpoint y que **Resumen y Bodega no se contradicen** —`stockBodegaCentral` es el mismo ledger que `kpis.stockTotal`—, que es el defecto que sí podía aparecer al montar el resumen como primer tab. La matriz por rol vive en los tests de UI.<br>• **Fuera de alcance, anotado:** un usuario móvil que además es Admin ve la etiqueta de escritorio con el cuerpo móvil (`esRolMovil` gana); y Camionero conserva el `+ Nuevo` genérico de Operaciones porque no tiene grupos de escritorio, aunque el hub ya no le ofrezca ninguno. |

---

## Fase 8 — Cierre y entrega

| | |
|---|---|
| **Código** | Barrido de duplicados restantes: los 4 componentes de tarjeta KPI (`Reportes.tsx:90`, y los que estaban en `DashboardEnterprise.tsx:256/:514/:534`, ya borrado en la Fase 5) → uno. Los 3 spinners de carga → uno. Las 4 reimplementaciones locales de `cn` → import de `src/lib/utils.ts`. `Finanzas.tsx` (Fase 4) y `DashboardEnterprise.tsx` (Fase 5) ya no están. |
| **Tests** | Consolidar `smoke.test.ts` (hoy 74 casos) como smoke maestro: 1 caso por endpoint, agregado. Suite completa en verde. |
| **Entrega** | `npm run build` + `npm start` → el build de producción sirviendo los 3 bocetos aplicados, verificado en `http://localhost:5174`. Sin hosting: publicar queda fuera del alcance. |
| **Realizado** | Decisiones que se apartaron del texto original, y por qué:<br>• **`cn`: eran 2, no 4.** `Cobranza.tsx` y `Logistica.tsx` eran las dos copias que quedaban; las otras ya importaban de `src/lib/utils.ts`.<br>• **KPI: 35 call sites en 4 pantallas, no 4 componentes.** `TarjetaKpi` (`src/components/TarjetaKpi.tsx`) preserva las tres variantes de layout (`pila`, `fila`, `plano`), dos superficies, los nueve tonos, el tamaño, la posición de icono/etiqueta y el nivel de encabezado. `FinanzasResumen.Tarjeta` sobrevive como wrapper de dominio: su cálculo de variación (negativo en rojo, flecha) es lógica financiera, no presentación.<br>• **`FinanzasResumen.Tarjeta` pasa `nivelEtiqueta={3}`.** `tests/ui/finanzas-ia.test.ts` exige rol `heading` en las cinco etiquetas; sin el prop, unificar las tarjetas las habría degradado a `p` en silencio.<br>• **Spinners: `RefreshCw animate-spin` se queda.** Es un affordance de recarga (el icono rota solo mientras corre), no un estado de carga. Los casos que sí mutaban a icono de carga (`Etiquetas`, `Pesos`, `Facturacion`, `DespachoAdmin`) ya usan `Spinner`.<br>• **El smoke maestro no son "74 casos" ni "1 caso por endpoint": son 24 casos que barren 180 rutas.** El plan pedía una cosa por endpoint; el problema real era otro — con casos escritos a mano no había forma de saber si faltaba alguno. Ahora el inventario vive en tablas y un guard parsea `server.ts` y falla si aparece una ruta que las tablas no conocen. Se comprobó: en su primera corrida detectó `GET /api/clientes` y `POST /api/gastos`, que se habían quedado fuera al transcribir.<br>• **Medir antes de afirmar cambió el contrato.** El smoke se escribió contra el comportamiento real de cada ruta, y eso destapó 13 endpoints que respondían 500 con una petición inválida: 7 POST (`operaciones/traslado`, `operaciones/recepcion`, `logistica/cargar-camion`, `logistica/cierre-ruta`, y `facturacion/generar-xml`, `facturacion/enviar`, `facturacion/consultar-estado`) y 6 PUT (`:id` de mantenimientos, granjas, clientes, rutas, vacunaciones, ordenes-mantenimiento). Los 13 ahora rechazan con 4xx: los POST validan su cuerpo, y los PUT devuelven 404 siguiendo el patrón que ya usaban sus hermanos (`galerones`, `lotes`, `camiones`, `users`). Ningún test dependía de esos 500.<br>• Los tres de facturación salieron de un segundo barrido: sin sesión responden 401, así que el sondeo inicial solo veía el candado. Probarlos con `x-user-id` destapó que `documentoId` sin validar caía a la query y reventaba.<br>• **`e2e-cobertura-gaps.test.ts` cambió de opinión.** Su caso "PUT /api/rutas/:id con id inexistente no rompe" afirmaba 200, que era el bug: la ruta hacía update sobre nada y el cliente creía que había guardado. Ahora afirma 404.<br>• **Las rutas de Gemini quedan fuera, y por escrito.** `/api/extract`, `/api/predict-load`, `/api/ai/*` (7) y `/api/chat/estela` necesitan `GEMINI_API_KEY`; no son verificables en un smoke sin red. El guard las conoce por nombre para que la exclusión sea explícita y no una ruta que se pierde en silencio.<br>• **Las tres rutas que responden 200 ante un id inexistente están anotadas, no escondidas:** `DELETE /api/clientes/:id` es un borrado idempotente, y `GET /api/precios/detalle/:listaId` y `GET /api/precio-excepciones/:clienteId` devuelven listas vacías.<br>• **Deuda que queda, y no se disimula:** el `catch (error: any) → res.status(500)` sigue siendo el patrón mayoritario del servidor, así que un error de dominio ("Stock insuficiente") todavía se reporta como 500 en las rutas donde no se agregó validación. Arreglarlo bien necesita un error tipado, no reescribir 181 `catch`; queda para una fase aparte. Los 13 que se corrigieron aquí no lo resuelven, solo tapan el caso que el smoke mide.<br>**Validación:** `npx tsc --noEmit` limpio · `npm run lint` limpio · `npm test` 39/39 archivos, 647/647 tests · `npm run build` 1839 módulos, `index.js` 974.94 kB (gzip 210.64) y `server.cjs` 388.4 kB · `npm start` sirviendo `dist/` en `http://localhost:5174`: home HTTP 200, y `/api/dashboard/enterprise`, `/api/finanzas/resumen` e `/api/inventario` respondiendo con datos. |

---

## Orden y rationale

```
F0 red ─► F1 bugs ─► F2 datos ─► F3 fuente única ─► F4 tabs ─► F5 disolver ─► F7 hub
                                                                   F6 office (independiente)
```
- **F1 antes que todo**: los bugs de autorización tapan (mascaran) los bugs de navegación. Arreglarlos al final sería diagnosticar el síntoma equivocado.
- **F2 antes que F4**: la pantalla de Cobranza del boceto está marcada "requisito" en 13 lugares. Sin la migración, se entrega un mock que la app no puede cumplir.
- **F3 antes que F4**: la regla de oro del boceto es *un solo lugar calcula el P&L*. Implementar los 4 tabs antes del endpoint significa codificar la duplicación y luego desarmarla.
- **F5 después de F4**: el Centro de Mando se disuelve *dentro* de Resumen, así que Resumen tiene que existir primero.
- **F6 en cualquier momento**: es independiente de Finanzas y Operaciones.

## Rollback

Cada fase es un commit. Sin nada commiteado, `git checkout .` no sirve — de ahí el `git init` de la Fase 0.

## Definición de "en producción"

Con la infraestructura actual, "producción" es `npm run build` + `npm start` sirviendo `dist/` en el puerto 5174. **No hay hosting configurado**, así que esto no llega a internet por sí solo. Hace falta decidir el destino: AI Studio (que es de donde viene el proyecto), o un host nuevo.
