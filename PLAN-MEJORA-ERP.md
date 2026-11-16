# Plan maestro de mejora del ERP — Granja Don Paco

**Propósito:** convertir el sistema actual en una operación conectada, confiable y fácil de usar desde granja hasta cliente. Este documento está dirigido al agente que implemente las mejoras. Describe una secuencia verificable; no propone reescribir todo de una vez.

**Estado del análisis:** 19 de octubre de 2026. Basado en `server.ts`, `src/`, `tests/`, `docs/requerimientos-erp-granja-don-paco.md`, `PLAN-IMPLEMENTACION.md` y `PLAN-IA-UNIFICADA.md`.

## 1. Diagnóstico del código actual

### Lo que ya existe y debe preservarse

- React 19, TypeScript, Vite, Express, Drizzle y libSQL/SQLite.
- Usuarios, sesiones, roles, clientes, rutas y camiones.
- Producción, galerones, lotes de aves, alimento, vacunación y mantenimiento.
- Remisiones, recepción, etiquetas, eventos de custodia y traslados.
- Despacho, ventas/tíquetes de ruta, retornos, caja, cierres, incidentes y desperdicio.
- Facturas, documentos electrónicos, pagos, gastos, listas de precio, excepciones y aprobaciones.
- Office para correo/documentos; Estela/Gemini y sugerencias operativas.
- Una suite amplia de pruebas HTTP, de proceso, UI y navegación.

El requerimiento principal ya tiene una base funcional. La prioridad es hacer que la misma operación tenga un solo flujo de datos y reglas, y que sus distintas vistas no se contradigan.

### Problemas observados en el repositorio

1. **Concentración excesiva:** `server.ts` tiene unas 7.800 líneas y 180 rutas HTTP. Contiene configuración de auth/permisos, funciones de dominio, endpoints de todos los módulos, lógica de IA, migraciones al arranque y Office.
2. **Autorización desigual:** existe `requirePermission`, pero el escaneo encontró solo 15 usos en rutas de escritura sensibles frente a las 180 rutas. La visibilidad del menú por rol no reemplaza el control del servidor.
3. **Parcheo histórico dentro del producto:** hay cerca de 50 `.cjs`/`.js` en la raíz con nombres `fix_*`, `patch_*`, `update_*`, `rewrite_*`, varios `*.log`, `*.txt` y bases `.test-*.db`. Cuesta distinguir código fuente, herramientas reproducibles y residuos locales.
4. **Arquitectura parcialmente modular:** `src/nav/modulos.ts`, `src/components/operaciones/` y `src/lib/` muestran una dirección útil, pero los límites de dominio de backend, UI, API y datos todavía no siguen una estructura uniforme.
5. **Fuentes de verdad vulnerables a divergir:** el plan anterior ya documentó cálculos financieros repetidos e incompatibles, rutas API duplicadas, pestañas/vistas repetidas y contenido huérfano. Las pruebas de caracterización son valiosas y deben mantenerse como red de seguridad.
6. **Precio y autorización comercial incompletos como control operativo:** existen listas, `precio_especial`, excepciones y descuentos máximos en cálculo de precio; hay que verificar que se apliquen a toda venta y factura, que el vendedor no pueda saltarlos, y que haya autorización auditable fuera de rango.
7. **Carga y cuadre deben usar una sola unidad canónica:** existen cartones, kilos y factores de conversión, más guías, ventas, retornos y desperdicio. Se debe fijar cómo el sistema demuestra que cargado = vendido + devuelto + desperdiciado + saldo explicado, sin mezclar unidades ni ignorar conversiones.
8. **Documentación de entrada débil:** `README.md` conserva texto de plantilla de AI Studio, no describe arquitectura, roles, flujos ni operación del ERP.

Las conclusiones anteriores se deben validar contra el HEAD actual antes de tocar código; los documentos previos pueden describir una etapa ya resuelta. No borrar una función solamente porque su nombre o módulo parezca duplicado: primero rastrear imports, rutas, permisos, datos y pruebas.

## 2. Objetivos de producto y medidas de éxito

### Objetivo A — Custodia confiable del huevo

Seguir cada cantidad desde recolección en granja/galerón/lote hasta recepción, bodega, carga, venta, devolución o merma. Cada cambio de custodio y estado produce un evento con usuario, fecha, documento y motivo.

**Indicadores:** diferencia sin explicar por guía; tiempo de recepción/cierre; porcentaje de eventos con responsable; número de ajustes manuales; trazabilidad completa por lote/documento.

### Objetivo B — Venta y dinero conciliados

Tiquete/factura es la fuente documental de cada venta. Caja del vendedor se concilia contra efectivo, transferencias, crédito y notas; facturas se concilian contra pagos y saldos. Una venta no puede desaparecer al consolidarse a factura.

**Indicadores:** ventas sin documento, duplicados, saldo de caja sin explicar, documentos pendientes de envío/aceptación y diferencias entre ventas, documentos, cobros y reportes.

### Objetivo C — Clientes y precios controlados

Un perfil único de cliente conserva identidad, ruta, condición de pago, historial de compra por producto/unidad, precios realmente cobrados, saldos y reglas vigentes. El precio se evalúa en servidor; el vendedor recibe una banda autorizada y una explicación sencilla.

### Objetivo D — Operación sencilla por rol

Cada rol ve una tarea principal clara y pocos pasos. El personal de campo debe completar una tarea con botones grandes, términos cotidianos, valores prellenados, lectura fácil, confirmación y soporte ante mala conectividad.

### Objetivo E — Administración y crecimiento ordenados

El administrador ve excepciones y tendencias; mantiene reglas, activos y costos. Bodega, flota/rutas, granjas, alimento, mantenimiento, correo y documentos se conectan con los procesos diarios sin competir visualmente con ellos.

## 3. Mapa de procesos que debe reflejar el sistema

### Flujo 1 — Granja a bodega

1. Responsable registra recolección: granja, galerón, lote, producto/clasificación, cantidad/unidad, fecha y usuario.
2. Genera remisión de traslado y carga con cantidades verificables.
3. Bodega cuenta/escanea/recibe y registra diferencia y motivo cuando la cantidad recibida no coincide.
4. El inventario se mueve de ubicación solo al confirmar la transición. Cada evento actualiza kardex/custodia y permite consultar el origen.

### Flujo 2 — Preparación de ruta y entrega

1. Despachador selecciona ruta, camión, conductor, vendedor y clientes/paradas.
2. El sistema recomienda una carga usando demanda histórica y capacidad. La carga extra es un **colchón planificado** visible y configurable; no se cuenta como venta hasta venderla ni se omite del cuadre.
3. Selecciona producto/lote con reglas FEFO cuando aplique; valida peso/cantidad, capacidad y stock. Emite guía y sella inventario en el camión al confirmar carga.
4. En ruta, vendedor busca cliente por lista, teléfono, código o nombre; registra cantidades, precio mostrado, tipo de cobro y emite tiquete. Cliente nuevo puede capturarse como prospecto/alta rápida sujeta a los campos mínimos requeridos.
5. Cada venta descuenta del stock asignado a esa guía/camión, en la misma transacción que registra documento y movimiento.
6. Registra roturas/merma con cantidad, producto, motivo y evidencia opcional. Registra devolución del cliente como devolución ligada a la venta/documento; no la confunde con producto no vendido.
7. Regresa sobrante a bodega con conteo/escaneo, diferencia y condición. Cierre concilia cantidades, documentos, cobros y gastos.

**Ecuación obligatoria de cuadre:** `carga confirmada = venta neta documentada + devolución del cliente pendiente de reingreso/estado + merma aprobada + retorno físico aceptado + saldo todavía bajo custodia del camión`. Para una guía cerrada, saldo bajo custodia debe ser cero. Usar unidad base por producto y conversiones versionadas; no comparar kilos con cartones sin conversión explícita.

Toda diferencia debe quedar clasificada, tener responsable y estado (`pendiente`, `explicada`, `aprobada` o `rechazada`). No sobrescribir ni borrar el movimiento original: ajuste compensatorio con motivo y auditoría.

### Flujo 3 — Venta, factura, cobro y caja

1. Tiquete/factura se genera desde la misma venta; relación 1:N explícita para consolidar varios tiquetes sin duplicar ingresos ni consumo de inventario.
2. Guarda líneas, cantidades, unidad de venta, precio aplicado, regla/lista de origen, descuentos, impuestos y snapshot del cliente/producto.
3. Contado actualiza caja por medio de pago; crédito crea saldo en CxC y vencimiento. Un pago puede ser parcial, con historial inmutable.
4. Nota de crédito/devolución corrige el documento original y las existencias siguiendo el flujo autorizado; anular no equivale a borrar.
5. Reportes consultan servicios/cálculos comunes y concilian ruta, tiquetes, facturas, pagos, gastos, caja y bancos.

### Flujo 4 — Ciclo de cliente

Alta/edición con validación → ruta y vendedor → condición/limite de crédito → reglas de precio → compras e historial → cobro y riesgo → segmentación/seguimiento. El administrador puede fijar precio obligatorio por cliente y producto, con vigencia y precedencia explícita.

### Flujo 5 — Activos, bodega, correo y documentos

Activos (galerones, camiones, equipos) tienen ficha, estado, calendario, orden de trabajo, repuestos/costos, responsable y evidencia. Alimento tiene entradas, consumo por lote/galerón, unidad y saldo. Office debe vincular mensajes/documentos a cliente, factura, ruta, activo o proceso, con permisos, búsqueda y registro de quién accedió/cambió.

## 4. Reglas de negocio que el backend debe garantizar

### Precio negociado por vendedores

Crear un resolvedor único de precio de servidor con precedencia configurable y visible, propuesta inicial:

1. Precio contractual obligatorio del cliente + producto (si está vigente).
2. Excepción aprobada del cliente + producto, con fecha desde/hasta, mínimo/máximo y autor/motivo.
3. Lista específica asignada a cliente.
4. Lista de ruta/segmento vigente.
5. Lista general.
6. Precio base de catálogo; si no existe, bloquear venta hasta resolver.

Cada regla tiene **piso**, **objetivo/lista** y **techo** o, alternativamente, precio fijo. El administrador configura rango por producto y puede establecer rango por cliente. Los valores deben expresarse en la unidad comercial (por kilo, cartón u otra) y conservar conversión al inventario.

- Dentro del rango: permitir venta; mostrar al vendedor precio sugerido y mínimo/máximo claramente.
- Precio por debajo del piso: bloquear el envío y ofrecer solicitud de aprobación al administrador; no permitir que el cliente manipule el precio en el navegador/API.
- Sobre techo: bloquear o requerir autorización según la política acordada; capturar motivo para evitar promesas que dañen la marca.
- Regla fija: solo ese precio. La excepción manual no puede eludirla salvo permiso administrativo explícito, temporal y auditado.
- El administrador puede aprobar/rechazar solicitudes desde una bandeja; la autorización se amarra a vendedor, cliente, producto, precio, cantidad, ruta y vencimiento. No es un permiso abierto reutilizable.
- Guardar snapshot de regla y resolución en cada línea/documento; cambiar lista mañana no reescribe la historia.
- Validar también ventas de ruta, facturas, tiquetes y consolidaciones en las APIs correspondientes, en una transacción.
- Cliente 360 presenta últimas compras y precio por producto/unidad/fecha, precio vigente, rango permitido, regla que lo origina, volumen y pagos.

### Cantidades y unidades

- Catálogo de productos define unidad de inventario, unidad de venta y conversiones vigentes con vigencia e historial. Guardar cantidad original y cantidad normalizada en la unidad base.
- Para huevo, acordar si la base es kg, unidades, cartones o si hay varios productos/clasificaciones. Una estimación de peso no equivale a un pesaje real.
- Ventas, devoluciones, merma y retornos deben referirse a línea/documento y guía. Prevenir doble devolución/doble retorno y saldo negativo concurrente.
- El cierre no se aprueba con diferencia pendiente salvo rol autorizado, motivo, evidencia y registro del monto/unidad de la diferencia.
- Movimientos confirmados son inmutables; corregir con reverso/ajuste autorizado.

### Dinero y permisos

- Cantidad de permisos por ruta API no es la métrica; el criterio es **toda** ruta privada protegida con permiso de objeto/acción en servidor. Denegar por defecto.
- Separar `view`, `create`, `edit`, `void`, `approve`, `close` y acceso a datos propios (`mi ruta`, `mis clientes`, `mi caja`) donde corresponda.
- Evitar roles confiados desde body/header no autenticado; resolver identidad de sesión en middleware.
- Facturación electrónica, pagos, descuentos, anulación, cierre de caja, inventario y permisos de Office requieren política explícita, auditoría y control de concurrencia.

## 5. Arquitectura objetivo

No hacer una reescritura grande. Mover responsabilidades por dominio, manteniendo contratos API existentes durante la transición:

```text
src/
  app/                 # shell, rutas/pantallas, sesión y layout por rol
  domains/
    custody/           # producción, remisión, recepción, etiquetas, movimientos
    dispatch/           # guías, cargas, rutas, ventas de ruta, cierre y cuadre
    customers/          # CRM, crédito, historial y reglas de precio
    documents/          # tiquetes, facturas, notas, pagos y conciliación
    finance/            # caja, gastos, CxC, reportes contables
    inventory/          # existencias, unidades, kardex, FEFO
    farm-assets/        # granjas, galerones, aves, alimento y mantenimiento
    office/             # correo, archivos y vínculos
  shared/
    api/                # cliente fetch, errores, tipos compartidos
    ui/                 # sistema visual y controles reutilizables
    auth/               # permiso central del cliente; solo UX, no seguridad
    domain/             # dinero, fechas, cantidades y errores tipados
server/
  app.ts                # createApp, middleware y composición
  middleware/           # sesión, permiso, validación, errores y auditoría
  modules/<dominio>/    # routes, service, repository, schema/DTO
  db/                   # schema, migraciones y conexión
```

El destino puede adaptarse al stack actual. No introducir microservicios. La separación inicial es por módulos en el mismo proceso y base de datos.

Principios:

- **Routes:** HTTP, parseo/validación, auth y llamada al servicio; sin reglas financieras.
- **Services/use cases:** transacciones y reglas del negocio.
- **Repositories:** queries Drizzle; no se replican cálculos de dominio.
- **Schemas/DTOs:** tipos/validación de entrada y salida sin `any` de borde.
- **Shared domain:** un solo cálculo para resolver precio, unidades, saldo, antigüedad, margen, cuadre y dinero CRC.
- **Transacciones:** venta + consecutivo + detalle + stock + caja/auditoría indivisibles; cierre de ruta transaccional.
- **Migraciones versionadas:** sacar `ALTER TABLE` dispersos del arranque. Migración idempotente por versión, backup, log y rollback/documentación. No cambiar/borrar columnas sin revisar datos existentes.
- **Errores tipados:** validación 400/422, no autenticado 401, sin permiso 403, no existe 404, conflicto de estado/stock/precio 409, fallo inesperado 500. Nunca enviar stacktrace/datos sensibles al cliente.
- **API:** conservar `/api/...` mientras migra; estandarizar formato de error y contrato sin romper clientes.

## 6. Plan para desenredar duplicados y código muerto

Ejecutar inventario, no borrado masivo:

1. **Congelar el punto de partida.** Confirmar estado y commit Git, mantener los archivos del usuario. Si no hay red Git disponible, guardar baseline local. Anotar `npm run lint`, build y suite existentes sin convertir un fallo preexistente en regresión.
2. **Crear un mapa de símbolos y dependencias.** Para cada pantalla, endpoint, tabla, helper y script registrar definición, importadores/llamadores, rol, pruebas y datos que escribe. Buscar tanto JSX/imports como `fetch('/api/...')`, `fetch(`/api/...`) y registros dinámicos.
3. **Clasificar candidatos:** fuente activa; prototipo/boceto; herramienta histórica reproducible; artefacto local; duplicado confirmado; obsoleto pero referenciado. No inferir código muerto solo por falta de import directo: revisar rutas, imports dinámicos, seeds, migraciones, `require`, scripts de package y pruebas.
4. **Poner residuos fuera del camino:** crear `tools/legacy/` solo para scripts que tengan valor de recuperación y anotación de uso; mover logs/DB de pruebas a una ubicación ignorada o eliminarlos solo si se regeneran y no contienen estado local que deba preservarse. No versionar logs, DB locales ni scripts one-off. Actualizar `.gitignore` y README.
5. **Eliminación segura por lotes pequeños:** una familia duplicada cada cambio. Primero consolidar callers al helper canónico, agregar/verificar pruebas de caracterización que ya existan, quitar segunda definición y revisar diff. Enviar cada lote con su inventario de símbolos eliminados.
6. **Consolidar UI duplicada:** una vista canónica por tarea y rol; vistas móvil y escritorio pueden ser diferentes en presentación pero consumen el mismo servicio/API y reglas. Eliminar duplicación de estado/flujo dentro de Admin/Operaciones/Granja/Logística si ya hay un hub; compartir formularios, tablas, estados vacíos y feedback visual.
7. **Consolidar endpoints:** ubicar rutas por dominio sin cambiar su contrato al principio. Buscar rutas duplicadas por método + path; fallar CI ante duplicados. Cada endpoint listado en inventario con permiso y servicio.
8. **Eliminar solo tras evidencia:** una semana/fase sin referencias, pruebas y build correctos, confirmar que no se carga por string/ruta, luego quitar. No borrar bases de usuario, documentación histórica o prototipos de diseño sin registrarlo.

Herramientas esperadas en el repo: registro de rutas generado o mantenido junto a pruebas; regla para rutas duplicadas; dependencias no usadas y archivos huérfanos reportados como auditoría, no auto-borrados; scripts de package con nombres descriptivos y salida reproducible.

## 7. Sistema visual y UX por rol

### Dirección visual

Construir una identidad propia: **operación avícola moderna**. Base grafito/crema, verde profundo para operación confirmada, ámbar para atención y rojo solo para bloqueo/pérdida; acento cálido inspirado en producto/granja con moderación. Mantener tokens existentes donde funcionen y unificarlos; no usar colores como único indicador.

- Tipografía sans legible (por ejemplo Inter/Atkinson o equivalente) y números tabulares para kg, cartones y CRC.
- H1 de página, contexto operativo (fecha, ruta, centro), acción primaria única por pantalla.
- Tarjetas blancas/neutral con bordes y sombras discretas; fondos densos solo en navegación. Reducir mosaicos KPI redundantes y gradientes decorativos.
- Espaciado consistente en escala 4/8; radio único; estados hover/focus/disabled/loading definidos.
- Buen contraste WCAG AA; texto base 16 px en modo de campo; controles táctiles mínimo 44–48 px; zonas críticas con separación y confirmación.
- Formularios en español de Costa Rica, CRC explícito, fechas/hora local y formatos familiares.
- Tablas administrativas con filtros, columna fija clave, exportación con permiso y diseño responsive. En móvil, tarjetas/resumen de una tarea; no encoger una tabla de 12 columnas.
- Estados completos: cargando, sin datos, error con reintento, desconectado, guardado, pendiente de sincronizar, conflicto y éxito. No esconder fallas de API como “no hay datos”.

### Experiencia por rol

| Rol | Inicio / trabajo principal | Diseño de tarea |
|---|---|---|
| Administrador | Centro de control: diferencias, aprobaciones, precios fuera de rango, caja/documentos por revisar, stock y tareas críticas | Bandejas priorizadas y enlaces al registro exacto; no 20 KPIs sin acción |
| Socio/Gerencia | Ventas, margen, cartera, caja, desempeño de rutas y alertas con filtros de periodo | Lectura ejecutiva y drill-down; no botones de escritura que no puede usar |
| Despachador | Guías del día, cargas, capacidad, pendientes y cierre | Asistente por pasos: ruta/camión → carga → revisar → confirmar |
| Bodeguero | Recibir, preparar, cargar, recibir retornos; stock y excepciones | Una tarea por pantalla, escaneo/entrada grande, conteos claros y resumen antes de guardar |
| Vendedor | Próxima parada, clientes de ruta, vender/cobrar/devolver y cierre de caja | Botón grande “Iniciar venta”; cliente/unidad/precio visibles; cantidades con teclado numérico; rango y confirmación verbal/visual; operación offline controlada |
| Camionero | Carga asignada, estado, incidentes, regreso y confirmación de entrega | Secuencia de checklist con fotos opcionales y sin formularios administrativos |
| Granja | Recolección/producción, remitir, alimento y alertas sanitarias | Registro diario rápido por galerón; copiar último dato con confirmación y validar anomalías |
| Facturación/Cobranza | Documentos pendientes, emisión, errores Hacienda, pagos vencidos | Lista de trabajo priorizada y acciones contextualizadas |

### Lenguaje para personal con baja escolaridad

- Una instrucción por paso: “Escanee los cartones que salen”, “¿Cuántos regresaron?”
- Palabras operativas y ejemplos de unidad; evitar “conciliación”, “SKU”, “ledger”, “payload”.
- Estado textual + icono + color: “Faltan 2 cartones por explicar”, no solo un punto naranja.
- Campos prellenados desde guía/ruta/cliente. Captura guiada en vez de texto libre.
- Al confirmar, resumen hablado/visual opcional: “Cargó 500; vendió 450; regresan 50”.
- Validación inmediata en el campo con cómo corregir, posibilidad de deshacer solo antes de confirmar; después ajuste con aprobación.
- Modo móvil: botones fijos accesibles, no modales pequeños, contraste alto, funcionar con conectividad intermitente e idempotencia al reintentar.

## 8. IA y automatización útiles

La IA sugiere y resume; el backend determinista valida y ejecuta. La IA jamás decide precio permitido, registra un cobro, altera inventario ni cierra una ruta sin confirmación humana y reglas server-side.

1. **Asistente de cierre de ruta:** agrupa tiquetes, stock, retornos, merma, cobros y gastos; detecta diferencias y pregunta por ellas en español simple. Propone explicación, no la inventa.
2. **Sugerencia de carga/ruta:** predice demanda por parada/producto/estación, capacidad y extra autorizado; explica evidencia y muestra confianza. Despachador acepta/ajusta.
3. **Alerta de precio:** detecta precio fuera de rango y prepara solicitud con cliente, historial, margen y volumen. La política de precio la evalúa código determinista.
4. **Cliente 360 asistido:** resumen de última compra, patrón, saldo, producto preferido y próxima acción sugerida; identifica inactividad o caída sin enviar mensajes automáticamente.
5. **Captura documental:** OCR/extracción de facturas, comprobantes y correos, propone tipo/cliente/fecha/monto/consecutivo y pide confirmación si confianza baja. Guardar documento fuente y trazabilidad.
6. **Mantenimiento preventivo:** estima cuándo revisar camión/equipo con kilometraje, historial y fabricante; crea borrador de orden, nunca hace una compra.
7. **Alimento/producción:** anomalías de consumo, mortalidad/producción o merma contra histórico, explicadas con datos usados.
8. **Correo:** clasificación y sugerencia de respuesta/resumen; aprobación antes de enviar. Nunca dar a la IA acceso transversal sin permisos del usuario y alcance del documento.

Requisitos: herramientas permitidas por rol; mínimos datos; ocultar secretos; no meter datos de clientes en prompts generales; registrar proveedor/modelo/versión y acción confirmada; mostrar “sugerencia IA” y fuente; fallback sin IA; umbral de confianza; evaluación con casos reales anonimizados y medición de falsos positivos/costo/tiempo ahorrado. No automatizar envíos, pagos, precios o escrituras al ERP sin confirmación y permiso explícitos.

## 9. Fases y entregables

### Fase 0 — Baseline y mapa del sistema (1 iteración)

- Confirmar HEAD, árbol, scripts, rutas, tablas, roles y pruebas reales.
- Generar inventario de 180 rutas, 41 tablas aproximadas, vistas importadas y llamadas API. Resolver diferencias de conteos tras verificar HEAD.
- Marcar archivos locales ignorables y scripts históricos; crear README operativo y diagrama de flujo actual.
- Definir owners de negocio para unidades de huevo, devoluciones, documentos, caja y precios.
- **Salida:** mapa validado, riesgos ordenados, decisión de política de precio y unidad base. Sin cambios funcionales grandes.

### Fase 1 — Seguridad y fuentes únicas (prioridad crítica)

- Cubrir todas las rutas con sesión/permiso deny-by-default y autorización por propietario/alcance.
- Inventario de rutas y guard de duplicados; validación de DTO; errores tipados.
- Centralizar dinero, CxC, aging, unidades/conversiones, cálculo de cuadre y resolución de precio.
- Confirmar transacciones para venta, tiquete/factura, caja, inventario y pagos.
- **Salida:** matriz rol × acción × ruta; ventas prohibidas fuera de precio/regla; sin diferencias entre vistas para las mismas métricas.

### Fase 2 — Cuadre integral de ruta (prioridad crítica)

**Estado: completada y validada focalizadamente (5 de noviembre de 2026).** El flujo incluye reconteo independiente, aprobación segregada, cuarentena, reempaque con etiquetas nuevas y liberación trazable. Ocho suites relacionadas pasan (162/162); la suite global no terminó en esta sesión.

- Modelar movimientos por guía/línea/producto/unidad y estados de devolución, merma y retorno.
- Hacer el cierre con ecuación y bandeja de diferencias; reingreso a bodega acepta/rechaza físicamente el retorno.
- Cargar colchón extra y stock de camión como parte de la custodia; no como cantidad invisible.
- Ensayar casos: 500→450+50; 500→448+50+2 rotos; devolución parcial; ventas adicionales; venta anulada; dos operaciones simultáneas; conversión kg/cartón.
- **Salida:** cada guía cerrada queda en cero o con diferencia formalmente pendiente y responsable; nunca saldo desaparecido.

### Fase 3 — Venta simple y control de precio

**Estado: completada y validada focalizadamente (5 de noviembre de 2026).** Se aplican rangos y excepciones en cotización y venta, listas con vigencias no solapadas, deduplicación de factura/tiquete en CRM y snapshot de la regla aplicada.

- Construir selector/resolvedor central, bandas, precio fijo cliente/producto, vigencias y aprobaciones temporales.
- Unificar venta móvil/escritorio como proceso y servicio. Tiquete, factura y consolidación conservan vínculo y no duplican venta.
- Cliente 360 muestra historial factual (incluidos tiquetes y facturas consolidados sin doble conteo), reglas y precio aplicado.
- **Salida:** empleado nuevo puede completar venta en ruta con pocos pasos; API rechaza precio inválido incluso si se manipula UI.

### Fase 4 — Caja, documentos y finanzas

**Estado: completada y validada focalizadamente (5 de noviembre de 2026).** Cierres de caja por guía con conteo físico, gastos de ruta ligados al medio de pago, efectivo/transferencia/crédito separados, depósitos bancarios con referencia y comprobante, y diferencias con aprobación segregada. Documentos, pagos parciales y Office conservan sus vínculos y permisos.

- Separar venta, documento fiscal, cobro, gasto y depósito como entidades relacionadas; idempotencia para emisión y reintento Hacienda.
- Conciliar tiquetes↔facturas↔pagos↔caja; estados y excepciones visibles; reportes usan mismo servicio de finanzas.
- Office vincula correo/documentos al registro pertinente con búsqueda y permisos claros.
- **Salida:** cada colón tiene documento/medio/estado y cada monto de reporte se puede rastrear a sus registros.

### Fase 5 — Modularización técnica y limpieza progresiva

**Estado: cerrada para modularización de rutas y composición del servidor.** Los dominios de API están en routers por área bajo `src/server/routes/`; cálculos compartidos viven en servicios/librerías, y DDL/migraciones compatibles/semillas/backfill están aislados en `src/db/initialize.ts`. `server.ts` quedó como bootstrap de la app, middleware, composición de routers, helpers compartidos de borde y fallback Vite; no contiene handlers API de negocio. El smoke enumera rutas desde los routers y protege el inventario de contratos. Los scripts históricos se clasificaron en `docs/INVENTARIO_SCRIPTS_HISTORICOS.md` y se conservaron porque no se comprobó que todos fueran descartables.

**Seguimiento de plataforma:** las migraciones actuales siguen siendo idempotentes pero no versionadas. Convertirlas a migraciones numeradas y separar semillas por entorno requiere una estrategia de baseline compatible con `local.db`; se agenda como endurecimiento de datos y no como parte del corte de modularización, para no marcar bases existentes como migradas sin ejecutar cambios pendientes. La suite completa del corte quedó en 812/813; el único fallo es el caso de Finanzas con payload incompleto en `tests/ui/sin-centro-mando.test.tsx:250`, ajeno al backend.

- Extraer dominios de `server.ts` a routers por área y servicios transaccionales; conservar `createApp()` de tests.
- Retirar scripts one-off solo cuando la referencia, duplicación y regeneración estén comprobadas.
- **Salida alcanzada:** `server.ts` compone middleware y routers; las rutas API viven en módulos; archivos históricos tienen clasificación/owner documentado.

### Fase 6 — UI enterprise y campo

- Definir tokens, controles, tabla, formularios, alertas, estados y layout de breakpoint; aplicar primero en operación diaria de vendedor, bodega y despacho.
- Quitar pantallas redundantes y entradas de navegación que solo duplican camino.
- Accesibilidad teclado/lector, contraste AA, foco, targets táctiles; prueba en dispositivos reales y red lenta.
- **Salida:** tareas habituales medidas por pasos/tiempo/error y aprobación de usuarios de cada rol.

**Estado: en curso.** Entregas para operación móvil: caja de ruta para vendedor (`src/components/CajaRuta.tsx`), recepción de Bodega (`src/components/BodegaMovil.tsx`) y captura guiada de carga de Despacho (`src/components/DespachoMovil.tsx`). Incluyen controles táctiles, instrucciones directas, estado/paso visibles, límites y diferencias de conteo explícitos y respuestas claras ante errores. Se ajustaron los tokens para contraste AA (5,15:1 en texto secundario claro; 6,92:1 en oscuro), se etiquetaron controles de icono y se ampliaron objetivos táctiles a 44×44 px. Cobertura UI: `tests/ui/caja-ruta.test.tsx` y `tests/ui/operaciones-movil.test.tsx`.

**Consolidación completada en código:** la barra de acción móvil de venta, recepción y envío de carga comparte `src/components/AccionFijaMovil.tsx`. Se revisó el shell de Operaciones: los roles de campo tienen un solo punto de entrada; los caminos Admin/Comercial y móvil corresponden a tareas distintas, así que no se eliminó navegación válida. Los errores al cargar datos tienen reintento visible; recolección, traslado y recepción son idempotentes por carga/traslado y rechazan con 409 un contenido distinto sin aplicar otro movimiento de inventario.

**Pendiente para cierre:** ejecutar con usuarios reales la guía de [validación de campo](docs/FASE6_VALIDACION_CAMPO.md), registrar tareas/tiempos/errores y recoger la aprobación de cada rol. Los tests automatizados verifican recorridos, pero no sustituyen esa validación.

### Fase 7 — IA acotada y automatizaciones

- Añadir primero explicación de cierre y extracción documental con confirmación; luego carga preventiva.
- Medir precisión, falsas alertas, tiempo, uso y costo; apagar el asistente sin afectar operación.
- **Salida:** cada recomendación es explicable y aceptada/rechazada por usuario; no hay escritura autónoma crítica.

## 10. Verificación y definición de terminado

- Mantener pruebas actuales; agregar pruebas para huecos de negocio ya identificados, especialmente permisos/propietario, rangos de precio, consolidación sin duplicados y cuadre.
- Para cada cambio: typecheck/build y pruebas del dominio afectado. Después suite completa y pruebas de migración con DB vacía y DB previa.
- Pruebas de proceso UI en cada rol en móvil y escritorio; no solo probar endpoint 200.
- Casos de concurrencia, reintento, offline, datos parciales y rol no autorizado.
- Validar que los reportes se deriven de registros de origen y que el balance cierre.
- Medir: tiempo de venta, errores de captura, diferencias de ruta, minutos de cierre, facturas pendientes, intentos fuera de rango, pasos de bodega y éxito de sincronización.
- No hacer deploy ni cambiar credenciales/productos externos como parte de una refactorización local.

## 11. Instrucción de trabajo para el agente implementador

1. Lee este plan y `PLAN-IMPLEMENTACION.md`, `PLAN-IA-UNIFICADA.md`, `docs/requerimientos-erp-granja-don-paco.md` para reconciliar decisiones ya tomadas.
2. Inspecciona el estado actual antes de editar; algunos planes previos están implementados y otros anotan deuda pendiente.
3. Empieza por Fase 0 y entrega una propuesta de mapa/riesgos. No reescribas `server.ts` entero.
4. Elige cambios pequeños, preserva API y datos, añade migración reversible cuando cambie esquema, y deja evidencia de pruebas relevante.
5. Toda regla de precio, custodia y dinero tiene una fuente única de backend. La interfaz no puede ser el único control.
6. No borres artefactos ni archivos con estado local hasta identificar su regeneración y contenido.
7. Si se debe elegir una regla de negocio no definida aquí (unidad oficial, límites aprobados, comportamiento fiscal), anota la decisión requerida y continúa las tareas independientes.

## 12. Referencias del repositorio revisado

- `server.ts`: alrededor de 7.800 líneas; define 180 rutas en el escaneo actual.
- `src/App.tsx`: shell de navegación/roles y parte de composición de pantallas.
- `src/nav/modulos.ts`: configuración declarativa de navegación por rol.
- `src/db/schema.ts`: aproximadamente 41 tablas de operación, finanzas, Office y auditoría.
- `src/lib/kilos.ts`, `src/lib/finanzas.ts`, `src/lib/cobranza.ts`, `src/lib/vendedores.ts`: base de lógica compartida que conviene extender en vez de duplicar.
- `src/components/operaciones/`: patrón de desglose por área útil para futuras extracciones.
- `tests/`: cobertura extensa de procesos, clientes, caja, bodega, permisos y UI; usarla para entender contratos existentes antes de modificar.
- `README.md`: reemplazar contenido genérico de AI Studio por guía del producto, setup, variables, migraciones, roles y ejecución local.
