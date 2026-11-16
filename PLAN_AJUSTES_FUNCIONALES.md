# Plan de ajustes funcionales del ERP Granja Don Paco

## Propósito

Alinear el demo con la operación que describió el cliente: huevos controlados y vendidos en kilogramos desde producción hasta entrega; administración completa por Admin; perfiles simples por rol; lotes de aves con seguimiento durante crianza y producción; documentos, precios, clientes, auditoría, dashboards e IA conectados a los mismos datos.

Este documento establece alcance, orden de trabajo y criterios de aceptación. No autoriza por sí mismo conectar servicios fiscales reales ni desplegar a producción.

## Decisiones confirmadas

1. Los movimientos de huevo, ventas, tiquetes y facturas usan **kg** como unidad. No se usarán cartones como unidad comercial ni de inventario del huevo.
2. La cantidad que muestran los documentos es el peso en kg efectivamente entregado. El tiquete azul y la factura blanca son documentos diferentes, pero ambos muestran kg, precio por kg e importe.
3. Admin define precio estándar por kg, rango mínimo/máximo y precios/rangos específicos por cliente. El Comercial solo vende dentro del rango efectivo del producto y cliente.
4. Los roles Vendedor, Facturador y Camionero se consolidan en **Comercial**. Este rol vende, emite documentos y confirma o rechaza cargas asignadas. Su experiencia es principalmente móvil y no muestra Analítica empresarial.
5. **Socio** puede consultar dashboards y CRM, sin editar.
6. Admin puede crear, editar y archivar productos, clientes, granjas, galerones, lotes, datos maestros y configuración de bodega/custodia.
7. Los cambios deben dejar usuario, fecha/hora, acción, motivo cuando corresponda, y valores antes/después.
8. Una actualización del tablero cada 15 segundos satisface la necesidad del demo; puede ofrecerse también un botón de actualización inmediata.
9. El grupo de aves se denomina **Lote de aves** en la interfaz; “parvada” puede mostrarse como término alternativo.

## Modelo operativo objetivo

### Huevo: custodia y venta en kg

Representar cada cambio como un evento de custodia con lote/identificador, producto, kg, ubicación origen/destino, fecha/hora, usuario, documento y motivo. Los estados típicos son: producido, recibido en bodega, preparado, cargado al vehículo, en ruta, entregado, retornado, mermado o en cuarentena.

La venta registra kilos efectivamente entregados al cliente. El servidor resuelve precio por kg con esta precedencia: precio especial vigente por cliente/producto → lista de cliente → lista de ruta si se conserva esa regla → lista general → precio base del catálogo. El resultado debe guardar una instantánea del precio, el rango aplicado, la lista/regla, los kg y el importe para que un cambio futuro no reescriba el documento histórico.

Las facturas y tiquetes muestran producto, cantidad en kg, precio por kg, descuentos/impuestos según la configuración del documento e importe. En la aplicación deben llamarse **Tiquete de ruta/entrega** y **Factura** para distinguir el comprobante operativo de la factura. Cada documento enlaza cliente, vendedor, ruta, fecha/hora y eventos de custodia.

La báscula puede registrar peso bruto, tara y peso neto; el valor comercial debe ser el kg neto entregado. Si una operación no tiene una medición validada, la interfaz debe exigir kg confirmados antes de emitir el documento. No convertir cartones a kg con factores estimados.

### Lotes de aves

Un lote conserva su identidad desde ingreso hasta cierre. Cambiar de etapa o ubicación agrega un evento al historial; no sobrescribe el origen. Las etapas configurables son: recibido/colocación, crianza, desarrollo, prepostura, producción y cierre. La edad se deriva de la fecha de nacimiento o fecha de referencia del proveedor; las transiciones se registran con fecha efectiva y responsable.

La población se calcula desde el saldo inicial y movimientos: aves recibidas + entradas − salidas − muertes − descartes. Muertes y descartes se registran por separado. En cada traslado de lote se anotan granja/galerón origen y destino, cantidad salida/recibida, diferencia o bajas en tránsito, motivo, responsable y aprobación si hay diferencia. Para dividir o combinar grupos se conservan vínculos entre lotes padre e hijo.

Registrar a diario mortalidad y descartes, producción de huevos por categoría, consumo de alimento (kg), agua, temperatura y observaciones. Registrar semanalmente o según protocolo el peso corporal, tamaño de muestra, uniformidad y variación. Vacunas/tratamientos, lote y vencimiento del insumo, dosis, vía, fecha y responsable quedan ligados al lote.

Indicadores calculados por lote, edad, galerón y granja:

- Mortalidad diaria = aves muertas del día / aves vivas al inicio del día.
- Mortalidad semanal = muertes de la semana / población al inicio de la semana.
- Mortalidad acumulada = muertes acumuladas / aves alojadas originalmente.
- Supervivencia = aves vivas / aves alojadas originalmente.
- Producción ave-día = huevos del día / promedio de aves vivas del día.
- Producción ave alojada = huevos del día / aves alojadas al inicio del lote.
- Masa de huevo = huevos × peso promedio del huevo; usar kg como unidad de salida.
- Conversión alimenticia = kg de alimento consumido / kg de masa de huevo producida.

Las metas por edad y genética se almacenan como curvas configurables a partir de la línea genética/proveedor. No hardcodear un único umbral de producción o mortalidad para todos los lotes.

### Archivo, corrección y auditoría

Los maestros —productos, clientes, granjas, galerones, ubicaciones, usuarios y listas— se archivan para impedir nuevos usos sin borrar su historial. Los hechos confirmados —ventas, facturas, pesajes, movimientos, traslados, muertes, vacunas aplicadas y recepciones— no se eliminan físicamente. Si algo debe corregirse, registrar reverso/ajuste con referencia al hecho original, usuario, hora y justificación. Guardar historial de cambios y conservar los valores originales.

## Roles y límites

| Rol | Funciones objetivo |
|---|---|
| **Admin** | Administración total: productos, precios, clientes, usuarios, granjas, galerones, lotes, salud, alimento, mantenimiento, bodega, rutas, camiones, documentos, caja, aprobaciones, auditoría y dashboards. Puede editar/archivar maestros y aprobar ajustes sensibles. |
| **Comercial** | En móvil: consultar rutas/clientes asignados, registrar kg entregados, ver precio y rango autorizados, emitir tiquete/factura permitido, registrar pago/retorno/merma según el flujo y confirmar/rechazar cargas asignadas. No ve Analítica de empresa ni configura precios. |
| **Socio** | Dashboards y CRM de solo lectura. Puede abrir historial y perfil de cliente, sin controles de edición, archivo, cambio de precio o modificación de crédito. |
| **Bodeguero** | Recibir kg, registrar pesaje y diferencias, preparar movimientos, aceptar/rechazar retornos, reportar merma y consultar existencias. Correcciones confirmadas se registran como ajustes auditables. |
| **Despachador / Encargado de Galerón** | Registrar eventos de producción y lote que le correspondan, preparar carga de huevo en kg, asignar ruta/vehículo y enviar carga al Comercial responsable; reportar incidencias. |

## Orden de implementación

### Paso 1 — Contrato de datos, permisos y estados

- Definir roles canónicos: `Admin`, `Comercial`, `Socio`, `Bodeguero`, `Despachador`.
- Migrar Vendedor, Facturador y Camionero a Comercial sin perder IDs ni atribución histórica.
- Crear una matriz única de permisos para navegación y backend; evitar listas separadas que diverjan.
- Asegurar que cada endpoint de lectura/escritura resuelva el usuario autenticado y compruebe rol/alcance. Los IDs recibidos del navegador no son prueba de identidad.
- Especificar estados de producto, cliente, granja, galerón, lote y documentos; usar archivo/cierre en vez de borrado.

**Aceptación:** cada cuenta demo ve sus pantallas correctas; Socio no puede modificar datos ni vía interfaz ni API; Comercial ve únicamente sus asignaciones y no ve Analítica; Admin entra a todas las áreas.

### Paso 2 — Migración del huevo a kg

- Cambiar tipos monetarios/cantidades de huevo para aceptar decimales en kg en catálogo, inventario, movimientos, guías, ventas, tiquetes, facturas, retornos, mermas, reportes y cuadre.
- Cambiar formularios y validaciones para solicitar kg netos y precio/kg; quitar cartones como unidad de huevo en pantallas, cálculos, mensajes y contratos API.
- Enlazar cada entrega con la ubicación/lote y los eventos de custodia relacionados. Las etiquetas pueden seguir siendo identificadores trazables, pero representan una cantidad en kg, no “un cartón”.
- Mantener conversión de moneda redondeada a la precisión monetaria configurada, no redondear kg a enteros.
- Preparar transición de datos: no inferir kg a partir de cartones. Pesar el inventario existente para fijar saldos iniciales en kg; convertir históricos solo cuando haya peso neto real disponible. Conservar sin alterar documentos históricos cuyo peso no se conozca.

**Aceptación:** el ejemplo 32 kg × ₡1.200 calcula ₡38.400; el ejemplo 29,50 kg × ₡1.300 calcula ₡38.350 antes de impuestos; inventario y cuadre aceptan decimales y no mezclan kg con cartones.

### Paso 3 — Ventas, política de precios y documentos

- En Admin, configurar precio base por producto/kg, piso y techo; permitir listas y excepciones por cliente con vigencia y justificación.
- En Comercial, consultar precio efectivo después de elegir cliente/producto; mostrar claramente precio/kg, rango permitido y total antes de confirmar.
- Rechazar en backend cualquier precio fuera del rango. La venta no tiene excepción manual del vendedor.
- Emitir tiquete operativo de ruta con kg realmente entregados. Crear/emitir factura en el flujo documental enlazado a la venta, evitando duplicar ingresos al consolidar.
- Mostrar recibos similares a los ejemplos del cliente: fecha, cliente, condición de pago, producto, kg, precio/kg, subtotal, descuentos/impuestos y total.
- Guardar snapshot de política de precio, peso, usuario, ruta, cliente y fecha/hora.

**Aceptación:** precios general y cliente específico se aplican con precedencia estable; ventas fuera de rango fallan; documentos imprimibles muestran kg; venta consolidada no cuenta dos veces en ingresos.

### Paso 4 — Ciclo completo del lote de aves

- Ampliar la ficha de lote con código, nacimiento/edad de ingreso, origen, línea genética, cantidad recibida y etapa.
- Crear historial de etapas y tabla de movimientos entre granjas/galerones; balances de salida/recepción deben cuadrar o crear diferencia pendiente.
- Crear registro diario por lote para población, muertes, descartes, huevos por categoría, alimento kg, agua, temperaturas e incidentes.
- Añadir muestras de peso corporal/uniformidad y lotes de vacunas/tratamientos.
- Calcular población, mortalidad, supervivencia, postura, masa de huevo y conversión desde eventos confirmados.
- Configurar metas por línea genética y edad. Mostrar alerta explicable cuando el dato salga de la curva; no declarar diagnóstico veterinario.

**Aceptación:** se puede seguir un lote desde crianza hasta producción, ver cada cambio de ubicación/etapa y reconstruir población a cualquier fecha. Un movimiento que sale de un galerón aparece como entrada en el destino. Las muertes no se editan sobre el saldo: generan eventos y recalculan aves vivas/KPIs.

### Paso 5 — Administración de maestros y bitácora universal

- Dar al Admin crear/editar/archivar productos, clientes, granjas, galerones, lotes, ubicaciones y catálogos de bodega.
- Permitir al personal operativo crear eventos de recepción, pesaje, carga, entrega, retorno y merma bajo sus permisos. Admin puede inspeccionar y resolver diferencias.
- Implementar un servicio de auditoría compartido para cada mutación con actor resuelto desde sesión, acción, objeto, fecha/hora, motivo y antes/después.
- Si falla la bitácora, no confirmar silenciosamente una operación crítica. Guardar movimiento y auditoría en la misma transacción cuando sea posible.
- Reemplazar borrados definitivos por archivar/desactivar maestros; transacciones se corrigen con reverso/ajuste enlazado.

**Aceptación:** se puede responder quién cambió precio, cliente, lote, granja, galerón o inventario, qué cambió y cuándo; operaciones confirmadas conservan historia y no se borran.

### Paso 6 — CRM, dashboards y seguimiento de ruta

- CRM 360: historial unificado de tiquetes y facturas, kg por producto, precio/kg aplicado, frecuencia, saldo y condición de pago.
- Comercial obtiene una vista de ruta móvil reducida: clientes asignados, últimos pedidos, precio autorizado, kg vendidos/restantes y tareas de entrega.
- Socio obtiene dashboards de negocio y CRM en lectura; no mostrar controles de edición.
- Admin obtiene vistas ejecutivas, comerciales, operativas y financieras, con filtros por fecha, ruta, producto, cliente, granja, galerón y lote.
- Ampliar tablero de ruta para mostrar por cliente: kilos entregados, producto, documento, hora, precio/kg, total, pago y estado de custodia.
- Mantener refresco cada 15 s y acción “Actualizar ahora”; al guardar una entrega, actualizar inmediatamente la pantalla del Comercial y que Admin la vea en la siguiente actualización.

**Aceptación:** el Admin puede identificar a quién se entregaron qué kg y cuándo; los totales coinciden con documentos y con el movimiento de custodia.

### Paso 7 — IA asistiva, no autónoma

- Pronóstico de kg por cliente/ruta usando historial de pedidos, estacionalidad y tendencia; mostrar intervalo/confianza y datos usados.
- Sugerencias de carga por ruta basadas en kg históricos, pedidos confirmados, stock disponible y extras aprobados.
- Alertas de lotes de aves por desviaciones de mortalidad, postura, alimento/agua o edad respecto a la curva genética configurada.
- Asistente administrativo que resume diferencias, cuentas, clientes en riesgo y variaciones; cada recomendación enlaza a los registros que la sustentan.
- La IA propone; el Admin acepta o descarta. No cambia precios, inventario, facturas, vacunación ni estado de lotes por sí sola.

**Aceptación:** si los datos no alcanzan, la IA lo dice y no inventa un pronóstico; recomendaciones presentan explicación, evidencia y acción manual.

### Paso 8 — UX por rol y cierre del demo

- Comercial: móvil primero, botones grandes, flujo corto “cliente → producto → kg → precio autorizado → pago → emitir”; confirmación con recibo.
- Bodega/Despacho: formularios paso a paso, kg grandes y legibles, lectura de código cuando exista, errores accionables y prevención de doble envío.
- Socio: dashboards y CRM solo lectura, con filtros y definiciones sencillas.
- Admin: vistas de resumen con drill-down; formularios de configuración separados de la operación diaria.
- Probar con cuentas demo una por perfil, datos ficticios y escenarios completos; mantener accesibilidad, contraste y recuperación de errores de Fase 6.

**Aceptación final:** flujos demostrables desde lote avícola → producción → movimiento de huevo en kg → bodega → carga → venta/tiquete/factura → retorno/merma → conciliación; los roles, saldos, documentos, tablero y bitácora concuerdan.

## Riesgos y reglas de implementación

- **No mezclar aves con huevo:** población de lotes se mide en aves; huevo comercial/inventario en kg; alimento en kg o unidad de compra conservada en su catálogo.
- **No convertir cartones a kg con promedios inventados.** Los saldos de apertura se verifican con pesaje; las ventas toman kg reales entregados.
- **No borrar hechos confirmados.** Corregir con evento compensatorio auditable.
- **No usar el mismo saldo manual como fuente para todos los KPIs.** La población de aves y kg de huevo se derivan de eventos; Admin ve y aprueba ajustes.
- **No fijar metas avícolas universales.** Usar curvas por genética y edad; documentar fuente/versión de curva.
- **No permitir que dos cuentas demo Comercial hereden permisos distintos por su nombre.** Ambas representan el mismo perfil unificado.
- **Mantener demo fiscal como demo.** Emitir documentos de muestra según la interfaz solicitada; cualquier integración fiscal real requiere un alcance separado.

## Referencias de industria

- Hy-Line, *Guía de variedades y manejo*: indicadores de mortalidad, producción ave-día/ave alojada, masa de huevo, conversión y registro diario/semanal: https://www.hyline.com/spanish/variedades/guide?languageid=e97acade-b3e0-47fb-b1c1-cb86ed8c7f40&productid=d3b7c322-48b3-4cdf-9b4d-14f50d5987b3&typeid=d09daefc-d0b4-439e-b0bf-bf79e218a19b
- LOHMANN, *Management Guide — Alternative Housing*: preparación y traslado a producción, continuidad del seguimiento y etapas de alimentación/manejo: https://lohmann-breeders.com/e-guide/alternative-housing/
- GS1, *Traceability Checklist*: eventos críticos y elementos de datos Who/What/Where/When/Why y referencias que enlazan los eventos: https://www.gs1.org/docs/traceability/GS1_Traceability_Checklist_Assessors_Guide_V1.0.pdf

## Puntos del código que motivan el alcance

- La caja actual cobra por cartón: `src/components/CajaRuta.tsx`; la resolución de precios vive en `src/lib/precios.ts`.
- El catálogo posee `kgPorCarton`, pero las rutas de altas/edición de producto no lo guardan; para el modelo kg se dejará de depender de esa conversión.
- La custodia y el cuadre de ruta están en `src/server/routes/logistica/caja-custodia.ts` y `src/lib/cuadre-integral.ts`; ambos deben cambiar a kg.
- `lotes_aves`, `produccion_diaria`, galerones, vacunas y alimento están definidos en `src/db/schema.ts`; faltan eventos de etapa/ubicación y un libro diario de mortalidad/población.
- `src/components/Granjas.tsx` muestra un cálculo de eficiencia fijo a cero, que debe reemplazarse por KPIs calculados desde registros reales.
- Las rutas de administración, clientes, catálogo y operación deben usar una matriz común de permisos y auditoría; la visibilidad de navegación no basta.
