# Fase 6 — validación de perfiles demo

## Objetivo

Comprobar que las cuentas demo muestran las tareas esperadas por tipo de usuario y que los flujos operativos principales se completan con datos ficticios, sin duplicar inventario ni dinero al reintentar.

## Preparación

- Usar la versión de demostración y datos ficticios. No ejecutar la sesión contra producción ni emitir documentos reales.
- Probar una cuenta ejemplificativa por cada tipo habilitado: Admin, Comercial/facturación, Comercial/vendedor, Socio, Bodeguero, Despachador/Encargado de Galerón y Camionero.
- Usar las cuentas demo (clave `1234`) y confirmar que el menú corresponde a cada rol.
- Ejecutar los tres guiones operativos con Comercial/vendedor, Bodeguero y Despachador. En las demás cuentas verificar acceso, navegación y restricciones esperadas.
- Simular un fallo o respuesta lenta en los pasos con reintento y confirmar que no se duplican operaciones.
- No se necesitan participantes reales para este demo. Si pasa a uso operativo, validar usabilidad con personal de campo antes del despliegue.

## Guion

Leer el escenario, no explicar cómo navegar. Si la persona se detiene, esperar; si pide ayuda, ayudar para proteger los datos de prueba y registrar la intervención.

### Vendedor — caja de ruta

1. Abrir la ruta asignada y encontrar el cliente indicado.
2. Registrar una venta de un producto y cantidad que estén disponibles. Identificar en voz alta el precio, la unidad y el total antes de confirmar.
3. Registrar el pago indicado y encontrar dónde se confirma el efectivo antes de cerrar la caja.

**Observar:** si distingue precio por unidad del total, si nota el stock disponible, si entiende cualquier bloqueo y si puede corregir la cantidad sin ayuda.

### Bodeguero — recibir carga

1. Encontrar la carga pendiente del camión indicado.
2. Registrar primero una recepción conforme en los datos preparados.
3. En una carga separada, registrar una diferencia (incluido cero recibido) y seleccionar el motivo correspondiente antes de confirmar.

**Observar:** si entiende esperado vs. recibido, si distingue faltante de sobrante, si entiende cuándo debe escoger un motivo y si ve la confirmación final.

### Despachador — registrar carga

1. Seleccionar la granja y el galpón indicados.
2. Capturar las cantidades indicadas de cartones y sacos.
3. Seleccionar el camión, revisar el resumen y enviar la carga.

**Observar:** si reconoce el paso actual, diferencia cartones de sacos, detecta errores en el resumen y entiende que el camionero debe confirmar la carga.

## Registro por perfil demo

Completar una copia de esta tabla por participante. Registrar tiempos reales; no fijar un límite de duración hasta tener la primera ronda como referencia.

| Fecha | Tipo de usuario / cuenta | Menú esperado | Flujo verificado | Reintento sin duplicado | Resultado / comentario |
|---|---|---|---|---|---|
| | | | | | |

## Criterio de aceptación

- Una cuenta demo por tipo de usuario inicia sesión y muestra las áreas previstas para su perfil.
- Comercial/vendedor, Bodeguero y Despachador completan sus guiones con datos de demostración.
- Cero errores críticos: precio equivocado confirmado, cliente equivocado, stock sobrevendido, recepción sin motivo cuando existe faltante o carga enviada con cantidades distintas a las revisadas.
- Los errores no críticos quedan anotados y se corrigen o se aceptan explícitamente antes de cerrar la fase.
- Ante un error simulado de red, la interfaz explica el problema y permite reintentar sin duplicar inventario ni ventas.
- Esta validación comprueba el demo; no sustituye pruebas de usabilidad con personal real antes de producción.

No se considera aprobado un flujo solo porque pase las pruebas automatizadas.

## Hallazgos y cierre

| ID | Rol/pantalla | Qué pasó | Severidad (bloqueante / alta / baja) | Corrección acordada | Responsable | Estado |
|---|---|---|---|---|---|---|
| | | | | | | |

### Cobertura de cuentas demo

| Tipo de usuario | Cuenta | Acceso / menú | Flujo operativo | Bloqueantes | Fecha |
|---|---|---|---|---|---|
| Admin | `admin@granja.com` | | No aplica | | |
| Comercial / facturación | `facturacion@granja.com` | | Facturación si aplica | | |
| Comercial / vendedor | `vendedor@granja.com` | | Caja de ruta | | |
| Socio | `socio@granja.com` | | No aplica | | |
| Bodeguero | `bodega@granja.com` | | Recepción | | |
| Despachador / Encargado de Galerón | `despacho@granja.com` | | Registrar carga | | |
| Camionero | `camionero@granja.com` | | Confirmar carga si aplica | | |

**Cierre de Fase 6 demo:** completar la cobertura de cuentas y guiones, resolver bloqueantes, volver a ejecutar lint, pruebas UI y build, y actualizar el resumen. La validación de usabilidad con personas reales queda como requisito previo a producción.
