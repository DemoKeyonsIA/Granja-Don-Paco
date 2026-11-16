# Fase 7 — Integración por rol y control de acceso operativo

## Alcance aplicado

- La matriz de `role-permissions.ts` ahora se aplica en backend a los maestros de granjas, galerones, lotes y mantenimiento; recolección; traslados, remisiones, recepción, alistamiento y creación de guías; ingresos de bodega; y registro/consulta de pesos.
- Admin mantiene administración de maestros y supervisión completa. El Socio conserva lectura de dashboards y CRM, sin permisos de operación o escritura. Despachador registra producción y traslados; Bodeguero recibe y administra inventario; Comercial realiza ventas, facturación móvil y confirma/rechaza cargas desde su teléfono.
- Comercial conserva acceso a Documentos para facturar y no ve Analítica. Sus accesos operativos se simplifican a Venta, Facturar y Cargas; las sub-filas de gestión no se montan en su sesión.
- En Clientes, Comercial entra directamente a Cartera y no solicita el panel de Análisis; el endpoint de análisis CRM queda para Admin y Socio. Socio conserva lectura sin escritura.
- Los nombres heredados Vendedor, Facturador y Camionero se normalizan al rol Comercial. La lectura e inicio de ruta reconocen la asignación del camión por `camioneroId` y por `vendedor_id` para conservar datos demo y registros heredados.
- Se valida en servidor que Comercial solo inicie una guía asignada a su camión. Las cargas sin camión asignado no aparecen para un conductor ni se pueden confirmar.
- El tablero de rutas y la vista operativa de Bodega comparten `useTablero`, que consulta cada 15 segundos; cumple el intervalo acordado para el demo sin depender de un servicio de tiempo real pago.
- Las rutas auxiliares de auditoría e IA ahora aplican permisos de backend. Auditoría es solo para Admin y las entradas usan el usuario autenticado, ignorando un `usuarioId` enviado por el cliente. Las consultas de IA se limitan al contexto de cada perfil; Estela ejecutiva y Nova quedan para Admin.
- El flujo de huevo usa kg desde la recolección diaria y la remisión de granja hasta la recepción, el alistamiento, la etiqueta, la venta, el retorno y el cuadre. Los contratos todavía entienden formatos heredados para compatibilidad, pero las vistas de huevo registran kg explícitos.
- La recepción requiere campos kg cuando el traslado llegó en kg y rechaza unidades incompatibles. Bodega no mezcla filas de kg y cartones para el mismo producto. El alistamiento divide la masa pesada en etiquetas de hasta 30 kg y valida contra inventario.
- La primera captura de peso neto de una etiqueta en bodega queda permitida; correcciones posteriores siguen requiriendo que el inventario esté conciliado en kg.
- El E2E de ciclo completo ahora usa precio por kg, vende kg, devuelve kg, acepta físicamente el retorno y cierra el cuadre usando kg desde la recepción pesada.

## Validación ejecutada

- `npm run lint -- --pretty false`: TypeScript limpio.
- `tests/e2e-ciclo-completo-custodia.test.ts`: 16/16 pruebas pasan, con flujo completo expresado en kg.
- `tests/e2e-cadena-custodia.test.ts`: 70/70 pruebas pasan; sus escenarios migrados cubren la cadena de granja, bodega y ruta en kg.
- `tests/e2e-pesaje-kg.test.ts`: 1/1 prueba pasa.
- `tests/e2e-autorizacion-operaciones.test.ts`: 8/8 pruebas pasan, incluyendo auditoría, extracción IA, carga predictiva y asistentes por rol.
- Las cuatro suites anteriores suman 95 pruebas aprobadas. TypeScript (`tsc --noEmit`) también pasa.
- 144 pruebas en siete archivos: 22 de integración de roles/operación y 122 de navegación por perfil. Cubren la coherencia del hub, despacho/cargas, recepción por escaneo, custodia por kg, CRM de Socio en lectura, Comercial sin analítica y el alias Camionero → Comercial.
- 122 pruebas de navegación por rol en dos archivos: el Socio ve el CRM en lectura, Comercial no ve analítica, y Camionero legado hereda el flujo Comercial completo.

## Límites y compatibilidad

- Los endpoints conservan lectura de algunos campos heredados en cartones para no invalidar datos antiguos. Las pantallas de recolección, remisión y alistamiento de huevo envían kg; saco de gallinaza sigue usando su unidad propia.
- La medición de kg se captura manualmente o desde el flujo de pesaje disponible; integración física con una báscula automática requiere definir el dispositivo y su protocolo.

## Cierre de fase

**Estado: cerrada para el demo.** La matriz de permisos, la navegación por perfil y los flujos de campo se consideran implementados y cubiertos por pruebas automatizadas.

Validación final de cierre:

- `npx tsc --noEmit`: sin errores.
- `tests/e2e-autorizacion-operaciones.test.ts`: 8/8.
- `tests/smoke.test.ts`: 26/26.
- Ejecución conjunta de las dos suites anteriores: 34/34.
- Flujos de cuadre, devolución parcial, consolidación y ciclo completo en kg: aprobados en la ejecución dirigida.
- El barrido global recorrió los archivos de pruebas sin fallos de aserción, pero Vitest reportó el cierre inesperado de un worker nativo de LibSQL en Windows. Las suites que quedaron pendientes en ese barrido pasaron al ejecutarlas por separado. El flake del runner permanece como limitación de infraestructura y está descrito en `vitest.config.ts`; no se considera un bloqueo funcional para cerrar esta fase.

La fase no certifica usabilidad con trabajadores reales ni conexión con una báscula física. Esas validaciones corresponden a una ronda de campo y a la integración de hardware antes de un uso productivo.
