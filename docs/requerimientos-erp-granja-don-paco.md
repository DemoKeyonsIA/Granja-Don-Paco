# Documento de requerimientos - ERP modular para Granja Don Paco

Version: 0.1  
Fecha: 2026-08-13  
Estado: Borrador ampliado para validacion con cliente

## 1. Resumen ejecutivo

Granja Don Paco requiere una plataforma tipo ERP para administrar la operacion avicola desde la produccion en granja hasta la entrega al cliente final, manteniendo control de inventario, trazabilidad, custodia, facturacion, rutas, clientes, finanzas y conciliacion de cantidades.

El principio central del sistema es que todos los numeros deben cuadrar:

- Produccion registrada en galeron.
- Huevo trasladado de granja a bodega.
- Huevo recibido en bodega.
- Huevo cargado a camion.
- Huevo entregado por cliente.
- Huevo retornado a bodega.
- Huevo facturado, cobrado o pendiente de cobro.

La solucion debe operar en web y movil. El personal administrativo y gerencial puede usar web; bodega, despacho, recibidores y vendedores en ruta deben poder operar desde celulares.

## 2. Objetivos del producto

1. Controlar la produccion diaria por granja, galeron y lote de aves.
2. Registrar el movimiento fisico del huevo desde recoleccion hasta venta o retorno.
3. Garantizar control de custodia entre granja, bodega, camion, cliente y retorno.
4. Mantener inventario confiable por ubicacion, presentacion, lote y estado.
5. Gestionar clientes, rutas, vendedores, precios, condiciones de pago y entregas.
6. Emitir facturas, tiquetes, notas de credito, cotizaciones y ordenes relacionadas.
7. Integrar facturacion electronica costarricense con Hacienda mediante proveedor o API.
8. Diseñar una arquitectura modular reutilizable para otros nichos: esteticas, clinicas, abogados, arquitectos, paqueteria, comercios y servicios.
9. Controlar peso, etiqueta, lote, fecha y custodia de cada carton o unidad logistica definida.
10. Dar visibilidad en tiempo real al administrador sobre produccion, bodega, rutas, facturacion, tiquetes, desperdicio y diferencias.
11. Incorporar controles enterprise: auditoria, aprobaciones, roles, trazabilidad, dashboards, IA asistida y alertas operativas.

## 3. Alcance funcional inicial

### 3.1 Gestion de granjas

Cada granja debe registrar:

- Nombre.
- Ubicacion.
- Encargado.
- Estado operativo.
- Tipos de produccion.
- Produccion agregada por dia, semana, mes y producto.
- Relacion con galerones.

El sistema debe permitir consultar cuanto produce cada granja por tipo de producto y periodo.

### 3.2 Gestion de galerones

Cada galeron debe registrar:

- Nombre.
- Granja a la que pertenece.
- Estado: crianza, produccion, mantenimiento, inactivo u otro definido por el cliente.
- Capacidad.
- Gallinas disponibles cuando aplique.
- Lote de aves activo.
- Produccion diaria esperada.
- Produccion diaria real.
- Registro de recoleccion dia a dia.
- Consumo de alimento.
- Calendario de vacunacion.
- Mantenimientos.
- Mortalidad, descarte o ajustes de aves, si el cliente confirma que aplica.

Reglas principales:

- Un galeron en produccion debe permitir registro diario de huevo producido.
- Un galeron en crianza debe permitir control de aves, alimento, vacunas y cambios de estado.
- Un galeron en mantenimiento no debe generar produccion activa salvo autorizacion especial.

### 3.3 Produccion y recoleccion

El sistema debe registrar cada evento de recoleccion:

- Fecha y hora.
- Granja.
- Galeron.
- Lote de aves.
- Producto o clasificacion.
- Cantidad.
- Unidad de medida: huevo individual, carton, caja u otra definida.
- Usuario responsable.
- Observaciones.

Pendiente de definicion:

- Si el huevo se clasifica por tamano, calidad, presentacion o categoria antes de llegar a bodega.
- Si existe merma por huevo quebrado, sucio, consumo interno o descarte.
- Equivalencias oficiales usadas por Don Paco, por ejemplo huevos por carton y cartones por caja.

### 3.4 Transferencia de granja a bodega

Cuando el huevo sale de la granja hacia bodega se debe crear un documento de traslado con:

- Consecutivo.
- Fecha y hora de salida.
- Granja origen.
- Bodega destino.
- Producto, presentacion y cantidad.
- Responsable de entrega en granja.
- Responsable de transporte.
- Estado: preparado, en transito, recibido, recibido con diferencia, anulado.
- Evidencia opcional: firma, foto, comentario o comprobante.

Regla de cuadre:

Produccion disponible en granja - cantidad enviada a bodega - ajustes autorizados = saldo disponible en granja.

### 3.5 Recepcion en bodega

El recibidor de bodega debe registrar cuanto huevo llego fisicamente:

- Documento de traslado asociado.
- Fecha y hora de recepcion.
- Cantidad esperada.
- Cantidad recibida.
- Diferencia.
- Motivo de diferencia.
- Responsable de recepcion.
- Estado de recepcion.

Regla de cuadre:

Cantidad enviada desde granja debe calzar con cantidad recibida en bodega. Si no calza, el sistema debe exigir motivo, responsable y aprobacion segun rol.

### 3.6 Inventario de bodega

La bodega debe manejar inventario por:

- Producto.
- Presentacion.
- Cantidad.
- Unidad.
- Ubicacion.
- Lote o referencia de origen.
- Fecha de recepcion.
- Estado: disponible, reservado, cargado, entregado, retornado, merma, ajuste.

El inventario debe moverse unicamente mediante documentos: recepcion, carga a camion, venta, retorno, ajuste, merma o transferencia.

### 3.7 Carga de camion y despacho

Antes de iniciar una ruta se debe crear una carga de camion:

- Camion.
- Chofer o vendedor.
- Ruta.
- Fecha.
- Clientes planificados.
- Producto y cantidad cargada.
- Bodega origen.
- Responsable de despacho.
- Estado: planificada, cargada, en ruta, cerrada, conciliada.

Regla de cuadre:

Inventario disponible en bodega - cantidad cargada a camion = inventario remanente en bodega.

### 3.8 Gestion de rutas

Cada ruta debe permitir:

- Nombre.
- Zona geografica.
- Dias de visita.
- Orden de clientes.
- Vendedor o chofer asignado.
- Camion asignado, si aplica.
- Clientes incluidos.
- Historial de entregas.

La vista movil de ruta debe mostrar al vendedor:

- Clientes del dia.
- Cantidad sugerida o pedida.
- Saldo del cliente.
- Precio aplicable.
- Facturas pendientes.
- Acciones: entregar, facturar, cobrar, registrar devolucion, omitir visita.

### 3.9 Entrega por cliente

En tiempo real, conforme el camion entrega huevo a cada cliente, el vendedor debe registrar:

- Cliente.
- Producto.
- Cantidad entregada.
- Precio.
- Descuento, si aplica.
- Condicion de pago: contado, credito u otra.
- Documento generado: factura electronica, tiquete electronico, orden, recibo o comprobante interno.
- Pago recibido, si aplica.
- Firma o confirmacion, si aplica.

Regla de cuadre:

Inventario inicial del camion - entregas por cliente - devoluciones o mermas autorizadas = inventario esperado de retorno.

### 3.10 Retorno de camion a bodega

Al regresar, bodega debe registrar:

- Camion.
- Ruta.
- Cantidad cargada originalmente.
- Cantidad entregada total.
- Cantidad retornada fisicamente.
- Diferencia.
- Motivo de diferencia.
- Responsable de cierre.
- Aprobacion, si aplica.

Regla de cuadre:

Cantidad cargada al camion - cantidad entregada a clientes = cantidad que debe retornar a bodega.

Si la cantidad fisica retornada no calza, el sistema debe dejar la ruta en estado con diferencia hasta que se documente y apruebe el ajuste.

### 3.11 Clientes y expedientes

El sistema debe mantener expedientes de clientes con:

- Nombre comercial y razon social.
- Identificacion.
- Contactos.
- Telefonos y correos.
- Direcciones.
- Ubicacion GPS, si aplica.
- Ruta asignada.
- Condicion de pago.
- Limite de credito.
- Lista de precios.
- Historial de compras.
- Historial de pagos.
- Documentos fiscales.
- Notas internas.

Este modulo debe diseñarse como reusable para otros tipos de negocio.

### 3.12 Finanzas

El modulo financiero debe cubrir:

- Facturacion.
- Cuentas por cobrar.
- Pagos y abonos.
- Caja chica.
- Gastos.
- Cuentas por pagar, si se confirma en alcance.
- Reportes de ventas por ruta, vendedor, cliente, granja y producto.
- Conciliacion de ventas contra entregas fisicas.

Pendiente de definicion:

- Si se requiere contabilidad completa o solo control operativo-financiero.
- Si se integrara con un sistema contable externo.

### 3.13 Facturacion, tiquetes y documentos comerciales

Documentos requeridos:

- Factura electronica.
- Tiquete electronico.
- Nota de credito.
- Nota de debito, si aplica.
- Cotizacion.
- Orden de compra, si aplica.
- Recibo de dinero.
- Comprobante interno de traslado.
- Comprobante interno de entrega o retorno.

Para Costa Rica, el sistema debe contemplar:

- Version vigente de comprobantes electronicos.
- Codigos CABYS.
- Impuestos.
- Exoneraciones, si aplica.
- Estados de Hacienda: enviado, aceptado, rechazado, pendiente.
- Almacenamiento de XML, PDF y respuesta de Hacienda.
- Reintentos y trazabilidad de errores.

## 4. Reglas de control de custodia

El sistema debe implementar una cadena de custodia basada en documentos y eventos auditables.

Cada movimiento relevante debe tener:

- Documento o evento unico.
- Origen.
- Destino.
- Responsable que entrega.
- Responsable que recibe.
- Fecha y hora.
- Cantidad esperada.
- Cantidad confirmada.
- Estado.
- Diferencias y motivos.
- Evidencia opcional.
- Registro de auditoria.

Puntos de control:

1. Galeron produce.
2. Granja consolida produccion.
3. Granja despacha a bodega.
4. Bodega recibe.
5. Bodega carga camion.
6. Camion entrega a cliente.
7. Sistema emite factura o tiquete.
8. Camion retorna sobrante.
9. Bodega recibe retorno.
10. Administracion concilia ruta, inventario y dinero.

### 4.1 Flujos operativos enterprise

#### Vacunacion

1. Se crea calendario sanitario por granja, galeron y lote de aves.
2. El sistema alerta vacunas proximas o vencidas.
3. Encargado aplica vacuna y registra fecha, responsable, dosis, producto y evidencia.
4. Sistema actualiza historial sanitario.
5. Sistema programa o sugiere la siguiente fecha.
6. Administrador revisa cumplimiento por granja y galeron.

#### Mantenimiento de granja

1. Se define plan preventivo para galerones, silos, agua, electricidad, ventilacion y equipos.
2. El sistema crea tareas recurrentes.
3. Encargado ejecuta checklist y registra evidencia.
4. Si hay falla, se abre mantenimiento correctivo.
5. Administrador ve vencimientos, costos y activos criticos.

#### Mantenimiento de bodega

1. Bodega mantiene calendario de limpieza, desinfeccion, control de plagas y calibracion de basculas.
2. Bodeguero o encargado ejecuta checklist.
3. Sistema registra fecha, responsable, evidencia y proxima revision.
4. Si una bascula esta vencida, el sistema debe advertir o bloquear registros criticos segun configuracion.

#### Custodia completa de producto

1. Granja produce y etiqueta o agrupa producto.
2. Granja registra salida a bodega con cantidad, peso y documento.
3. Bodega recibe, escanea, pesa y compara contra lo enviado.
4. Bodega carga camion por ruta, escaneando etiquetas y registrando pesos.
5. Vendedor entrega al cliente, genera factura o tiquete y descuenta inventario del camion.
6. Vendedor registra quiebres, rechazos o desperdicio con motivo y evidencia.
7. Camion regresa a bodega.
8. Bodega pesa y recibe retorno.
9. Sistema concilia cargado - entregado - desperdiciado = retornado.
10. Administrador aprueba o investiga cualquier diferencia.

#### Facturacion y visibilidad en tiempo real

1. Vendedor abre cliente asignado en su ruta.
2. Sistema muestra precio global o precio especial del cliente.
3. Vendedor confirma producto, cantidad, peso y etiquetas.
4. Sistema genera tiquete o factura.
5. Administrador ve el documento en tiempo real con ruta, vendedor, cliente, monto, estado fiscal y estado de cobro.
6. Si el documento fiscal falla, queda en cola de reintento y alerta.

#### Cierre diario administrativo

1. Administrador revisa produccion del dia.
2. Revisa entradas y salidas de bodega.
3. Revisa rutas activas y cerradas.
4. Revisa facturas, tiquetes y cobros.
5. Revisa retornos y desperdicio.
6. Atiende diferencias.
7. Cierra el dia operativo con reporte.

## 5. Arquitectura modular reusable

La plataforma debe separarse en modulos base y capas de personalizacion por industria.

### 5.1 Modulos base reutilizables

#### Identidad, roles y permisos

- Usuarios.
- Roles.
- Permisos por accion.
- Sucursales o unidades operativas.
- Auditoria de actividad.

Reusable en todos los nichos.

#### Expedientes

- Clientes.
- Proveedores.
- Contactos.
- Direcciones.
- Documentos asociados.
- Historial de interacciones.
- Campos personalizados por nicho.

Reusable en granjas, esteticas, clinicas, abogados, arquitectos, paqueteria y comercios.

#### Catalogo

- Productos.
- Servicios.
- Presentaciones.
- Precios.
- Impuestos.
- CABYS para Costa Rica.
- Categorias.

Reusable para venta de productos, servicios profesionales, inventario y facturacion.

#### Inventario

- Existencias.
- Ubicaciones.
- Lotes.
- Kardex.
- Entradas.
- Salidas.
- Transferencias.
- Ajustes.
- Mermas.
- Reservas.

Reusable para granjas, esteticas, clinicas, paqueteria y retail.

#### Finanzas

- Facturacion.
- Cuentas por cobrar.
- Pagos.
- Caja chica.
- Gastos.
- Reportes financieros.
- Integracion fiscal.

Reusable en todos los nichos.

#### Logistica

- Rutas.
- Vehiculos.
- Conductores.
- Entregas.
- Recolecciones.
- Despacho.
- Prueba de entrega.
- Conciliacion de carga y retorno.

Reusable para granjas, paqueteria, distribucion y servicios a domicilio.

#### Documentos comerciales

- Cotizaciones.
- Ordenes de compra.
- Ordenes de trabajo.
- Facturas.
- Tiquetes.
- Recibos.
- Notas de credito.
- Plantillas PDF.

Reusable en todos los nichos.

#### Reporteria e inteligencia operativa

- Dashboards.
- Indicadores.
- Exportaciones.
- Alertas.
- Comparativos por periodo.

Reusable en todos los nichos.

### 5.2 Capas de personalizacion por nicho

Cada industria debe extender los modulos base con entidades, reglas y pantallas propias.

Ejemplos:

- Granja avicola: granjas, galerones, lotes de aves, produccion diaria, vacunacion, alimento, custodia de huevo.
- Estetica: expedientes de clientes, citas, tratamientos, catalogo de servicios, inventario de productos, paquetes.
- Clinica medica: expediente clinico, agenda, consentimientos, servicios, facturacion.
- Abogados: expedientes legales, casos, actuaciones, documentos, honorarios.
- Arquitectos: clientes, proyectos, hitos, presupuestos, entregables, facturacion.
- Paqueteria: clientes, paquetes, tracking, bodegas, rutas, cobros.

### 5.3 Principio tecnico recomendado

Separar la plataforma en tres capas:

1. Nucleo comun: usuarios, permisos, expedientes, catalogo, inventario, finanzas, documentos, reportes.
2. Modulos de dominio: logistica, produccion, agenda, proyectos, casos, paquetes.
3. Personalizacion por vertical: reglas, campos, flujos, pantallas y reportes propios de cada cliente o industria.

## 6. Capa especifica para Granja Don Paco

Modulos recomendados para el primer producto:

1. Operacion avicola.
2. Inventario y bodega.
3. Logistica y rutas.
4. Ventas en ruta.
5. Facturacion electronica.
6. Clientes y precios.
7. Finanzas operativas.
8. Reportes y conciliaciones.
9. Administracion y auditoria.
10. Vacunacion y salud avicola.
11. Alimentacion, silos y consumo.
12. Mantenimiento de granja.
13. Mantenimiento de bodega.
14. Etiquetado, lotes y trazabilidad.
15. Control de peso y basculas.
16. Desperdicio, quiebres y merma.
17. Servicio al cliente.
18. IA operativa con Estela.
19. Roles, permisos y vistas por perfil.

Indicadores clave:

- Produccion diaria por granja.
- Produccion diaria por galeron.
- Produccion esperada vs real.
- Huevo enviado a bodega.
- Diferencias entre envio y recepcion.
- Inventario disponible por bodega.
- Carga por camion.
- Venta por ruta.
- Retorno por camion.
- Diferencias de ruta.
- Facturacion diaria.
- Cuentas por cobrar.
- Merma y ajustes.
- Peso enviado, recibido, cargado, entregado y retornado.
- Desperdicio por etapa.
- Facturas y tiquetes por ruta en tiempo real.
- Cumplimiento de vacunacion.
- Mantenimientos vencidos y proximos.
- Etiquetas/cartones por estado.
- Rentabilidad por ruta y cliente.

## 7. Referencias de mercado e integraciones

### 7.1 ERPs y software avicola

La investigacion inicial muestra que los sistemas especializados para huevo priorizan trazabilidad, control de produccion, inventario, entregas e invoicing. Un ejemplo publico es EggFlow ERP, descrito como un ERP para digitalizar produccion de huevo donde se rastrea desde la recepcion en galerones hasta facturacion de clientes, con documentos PDF y codigos QR.

Referencia: https://sxnlabs.com/en/clients/agriculture/corbel-earl-eggflow-erp/

Implicacion para Don Paco:

- La trazabilidad no debe ser un reporte posterior; debe estar integrada en cada movimiento.
- La facturacion debe nacer de la entrega real, no de una captura duplicada.
- Cada documento debe poder auditarse desde origen hasta cliente.

Otros sistemas avicolas revisados destacan capacidades adicionales que elevan el nivel enterprise:

- Control de lotes de aves, casas/galerones y ciclos productivos.
- Produccion diaria, mortalidad, alimento, vacunacion y medicacion.
- Analitica de rendimiento, costo por huevo y eficiencia de alimento.
- Clasificacion/calidad del huevo, quiebres y desperdicio.
- Trazabilidad por lote, ubicacion y movimiento.
- Integracion con inventario, ventas, compras, cuentas y reportes.
- Uso movil para captura diaria en campo.

Referencias adicionales:

- Navfarm Poultry ERP: https://www.navfarm.com/poultry/
- CoopSense Poultry Management: https://www.coopsense.com/
- PoulSoft Layer Management: https://www.poulsoft.com/
- PoultryCare ERP Layer Module: https://www.poultry.care/modules/layer
- Odoo Poultry Management module: https://apps.odoo.com/apps/modules/17.0/dps_poutry_management
- Broilr Poultry ERP: https://broilr.app/
- Poultry Log: https://poultrylog.com/poultry-farm-management-software

### 7.1.1 Route accounting y distribucion directa

El flujo de Don Paco se parece a un modelo DSD, direct store delivery: el camion sale con inventario, vende o entrega en ruta, factura en campo, cobra si aplica, registra devoluciones/quiebres y regresa a bodega para conciliacion.

Mejores practicas aplicables:

- Inventario inicial del camion.
- Entregas por parada.
- Facturacion movil.
- Cobro en ruta.
- Prueba de entrega con firma, foto, GPS o timestamp.
- Registro de retornos, rechazos y desperdicio.
- Settlement o cierre de ruta.
- Sincronizacion offline/online.
- Conciliacion automatica contra inventario y dinero.

Referencias:

- Orderwerks Route Accounting Guide: https://www.orderwerks.com/blog/route-accounting-software-guide
- Leadbeam Route Accounting Guide 2026: https://www.leadbeam.ai/blog/route-accounting-software

### 7.1.2 Etiquetado, fechas y peso de huevo

Las buenas practicas de trazabilidad de huevo recomiendan codigos de lote, fechas de empaque/consumo, control de peso y rotacion de inventario. Aunque las reglas especificas dependen del pais y del esquema comercial de Don Paco, el ERP debe quedar preparado para registrar:

- Codigo de lote.
- Fecha de empaque.
- Fecha de vencimiento o consumo recomendado.
- Planta/granja/origen.
- Peso neto.
- Clasificacion.
- Trazabilidad por carton.

Referencias:

- USDA FSIS, Shell Eggs from Farm to Table: https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/eggs/shell-eggs-farm-table
- USDA AMS, Shell Egg Grading Service Q&A: https://www.ams.usda.gov/publications/qa-shell-eggs

### 7.2 Facturacion electronica Costa Rica

Opciones identificadas:

- Integracion directa con API de comprobantes electronicos de Hacienda.
- Integracion mediante proveedor local con API REST.
- Uso mixto: portal del proveedor + API integrada al ERP.

Referencias:

- Ministerio de Hacienda, API de comprobantes electronicos: https://www.hacienda.go.cr/docs/ComprobantesElectronicosAPI.html
- Facel, facturacion electronica con API, app movil y personalizaciones: https://facturacion-electronica-4-4.facelcr.com/index.html
- Facel planes y funcionalidades: https://facelcr.com/facellp/
- FacturaYA API: https://www.facturaya.cr/guia-api
- AFECR API: https://www.afecr.com/
- Almendro API: https://fe.almendro.cr/docs
- FACBOX API: https://facbox.com/api-facturacion-electronica-para-ecommerce-y-erp-costa-rica
- Fáctico API: https://www.factico.net/factico-api
- Integra Factura: https://www.integrafactura.com/
- Facturica API: https://facturica.com/integracion-api

Recomendacion inicial:

El ERP debe implementar una interfaz interna de facturacion electronica independiente del proveedor. Asi Don Paco puede iniciar con un proveedor como Facel u otro, pero la plataforma no queda amarrada a una sola API.

La interfaz debe contemplar:

- Crear documento fiscal.
- Enviar a proveedor o Hacienda.
- Consultar estado.
- Recibir aceptacion o rechazo.
- Descargar XML.
- Descargar PDF.
- Guardar respuesta de Hacienda.
- Emitir notas de credito.
- Reintentar documentos fallidos.
- Operar en ambiente de pruebas y produccion.

## 8. Alcance enterprise ampliado para Granja Don Paco

### 8.1 Control de vacunacion y salud avicola

El sistema debe administrar un calendario sanitario por granja, galeron y lote de aves.

Cada evento de vacunacion debe registrar:

- Granja.
- Galeron o galerones incluidos.
- Lote de aves.
- Tipo de vacuna.
- Proveedor o marca.
- Dosis aplicada.
- Metodo de aplicacion.
- Fecha programada.
- Fecha aplicada.
- Responsable.
- Estado: programada, aplicada, vencida, reprogramada, cancelada.
- Evidencia opcional.
- Observaciones.
- Reaccion o incidencia posterior, si aplica.
- Proxima fecha sugerida o programada.

Funciones requeridas:

- Calendario por granja y galeron.
- Alertas de vacunas proximas.
- Alertas de vacunas vencidas.
- Historial sanitario por lote.
- Reporte de cumplimiento.
- Relacion con mortalidad, produccion o baja de rendimiento.

Regla:

Una vacuna vencida o no aplicada debe aparecer como alerta critica para el administrador y el encargado de granja.

### 8.2 Control de alimento, silos y consumo

El sistema debe registrar alimento disponible, consumo y reposicion.

Datos requeridos:

- Tipo de alimento.
- Proveedor.
- Lote de alimento.
- Silo o ubicacion.
- Cantidad recibida.
- Cantidad consumida.
- Galeron/lote asociado.
- Fecha.
- Responsable.
- Merma o ajuste.

Funciones:

- Control de inventario de alimento.
- Consumo por galeron.
- Consumo por lote de aves.
- Alertas de bajo inventario.
- Limpieza de silos.
- Historial de relleno de silos.
- Costo de alimento por huevo producido.

Indicadores:

- Consumo diario.
- Consumo por gallina.
- Costo de alimento por carton.
- Produccion vs alimento.

### 8.3 Mantenimiento de infraestructura de granja

El sistema debe administrar mantenimiento preventivo y correctivo de:

- Galerones.
- Silos.
- Sistemas de agua.
- Sistemas electricos.
- Ventilacion.
- Cercas.
- Equipos de recoleccion.
- Vehiculos internos.
- Herramientas.
- Otros activos definidos por el cliente.

Cada mantenimiento debe registrar:

- Activo o area.
- Granja.
- Galeron, si aplica.
- Tipo: preventivo, correctivo, limpieza, inspeccion.
- Fecha programada.
- Fecha ejecutada.
- Responsable.
- Estado.
- Insumos usados.
- Costo.
- Evidencia opcional.
- Observaciones.
- Proxima fecha.

Funciones:

- Calendario de mantenimiento.
- Checklist por tipo de activo.
- Alertas de vencimiento.
- Historial por activo.
- Costos por granja.
- Bloqueo o advertencia si un galeron en mantenimiento intenta registrar produccion normal.

### 8.4 Mantenimiento de bodega

La bodega debe tener su propio control de mantenimiento y saneamiento.

Areas o activos:

- Areas de recepcion.
- Areas de almacenamiento.
- Basculas.
- Equipos de empaque.
- Refrigeracion, si aplica.
- Estantes.
- Andenes.
- Vehiculos o montacargas, si aplica.

Eventos:

- Limpieza.
- Desinfeccion.
- Calibracion de basculas.
- Inspeccion de temperatura.
- Control de plagas.
- Reparaciones.

Regla enterprise:

Las basculas usadas para registrar pesos deben tener estado vigente de calibracion. Si una bascula esta vencida, el sistema debe advertir o bloquear registros criticos segun configuracion.

### 8.5 Etiquetado, lotes y peso de cartones

Cada carton o unidad logistica debe tener una etiqueta unica.

Datos minimos de etiqueta:

- Codigo unico.
- Codigo de barras o QR.
- Fecha de produccion.
- Fecha de empaque.
- Granja origen.
- Galeron o lote origen, si se decide manejar ese nivel.
- Tipo de producto.
- Clasificacion.
- Cantidad de huevos.
- Peso bruto.
- Peso neto.
- Tara, si aplica.
- Bodega actual.
- Estado.
- Fecha de vencimiento o consumo recomendado, si aplica.

Funciones:

- Generar etiquetas.
- Imprimir etiquetas.
- Escanear etiquetas en bodega.
- Escanear etiquetas al cargar camion.
- Escanear etiquetas al entregar cliente.
- Escanear etiquetas en retorno.
- Consultar trazabilidad completa por codigo.

Regla:

Un carton no debe poder venderse si no fue recibido en bodega, si no esta disponible, si ya fue cargado a otra ruta, o si su estado no permite venta.

### 8.6 Control de peso y conciliacion exacta

El sistema debe controlar pesos por punto de custodia:

- Peso que sale de granja.
- Peso que llega a bodega.
- Peso almacenado en bodega.
- Peso cargado en camion.
- Peso entregado a cliente.
- Peso desperdiciado o quebrado.
- Peso retornado a bodega.

Cada movimiento debe registrar:

- Cantidad.
- Unidad.
- Peso esperado.
- Peso real.
- Diferencia.
- Bascula utilizada.
- Responsable.
- Fecha y hora.
- Documento asociado.

Reglas:

- Peso enviado de granja debe calzar con peso recibido en bodega.
- Peso cargado a camion debe calzar con peso descontado de bodega.
- Peso entregado a cliente debe calzar con factura o tiquete generado.
- Peso retornado + peso entregado + peso desperdiciado autorizado debe calzar con peso cargado.
- Diferencias deben tener motivo, evidencia y aprobacion segun umbral.

Pendiente de definicion:

- Tolerancia permitida por peso.
- Si el cuadre debe ser exacto siempre o por rango autorizado.
- Si se pesa por carton, por caja, por tarima o por carga completa.

### 8.7 Control de desperdicio, quiebres y merma

El sistema debe registrar cualquier perdida del producto.

Tipos:

- Huevo quebrado en granja.
- Huevo quebrado en bodega.
- Huevo quebrado en camion.
- Huevo rechazado por cliente.
- Huevo vencido.
- Huevo sucio o no vendible.
- Diferencia de peso.
- Ajuste administrativo.

Cada evento debe registrar:

- Origen.
- Producto.
- Etiqueta o lote.
- Cantidad.
- Peso.
- Motivo.
- Responsable.
- Evidencia opcional.
- Aprobacion, si aplica.
- Impacto financiero.

Regla:

El desperdicio debe formar parte del cuadre. No puede desaparecer inventario sin movimiento documentado.

### 8.8 Precios por cliente y politicas comerciales

El administrador debe gestionar precios globales y precios especiales por cliente.

Funciones:

- Lista de precios global.
- Lista de precios por ruta.
- Precio especial por cliente.
- Vigencia de precios.
- Descuentos permitidos.
- Bloqueo de descuento no autorizado.
- Historial de cambios de precio.
- Aprobacion para excepciones.

Regla:

El vendedor no debe poder alterar un precio establecido si no tiene permiso. Si se permite excepcion, debe quedar registrada y aprobada.

El total facturado debe calzar con:

Cantidad entregada x precio aplicable - descuentos autorizados + impuestos.

### 8.9 Facturacion y tiquetes en ruta en tiempo real

El vendedor debe poder generar rapidamente tiquetes y/o facturas desde el celular al entregar producto.

Flujo movil minimo:

1. Seleccionar cliente desde ruta del dia.
2. Ver precio asignado.
3. Escanear o seleccionar producto/cartones.
4. Confirmar cantidad y peso.
5. Generar tiquete o factura.
6. Registrar pago, si aplica.
7. Capturar firma, ubicacion o evidencia, si aplica.
8. Sincronizar con administracion.

Vista del administrador:

- Facturas generadas en tiempo real.
- Tiquetes generados en tiempo real.
- Ruta, vendedor y cliente.
- Monto.
- Estado fiscal.
- Estado de cobro.
- Producto entregado.
- Diferencias o anulaciones.

Regla:

Toda factura o tiquete debe estar asociado a una entrega real, a una ruta, a un cliente y a inventario del camion.

### 8.10 Vistas por rol

#### Administrador

- Dashboard general.
- Produccion.
- Bodega.
- Rutas en tiempo real.
- Facturas y tiquetes.
- Diferencias.
- Precios.
- Clientes.
- Usuarios y permisos.
- Reportes.
- Aprobaciones.

#### Socio

- Vista solo lectura.
- Dashboard ejecutivo.
- Produccion.
- Ventas.
- Inventario.
- Rutas.
- Finanzas resumidas.
- Diferencias.
- Sin permiso para modificar.

#### Vendedor

- Ruta del dia.
- Clientes asignados.
- Inventario del camion.
- Precios de clientes.
- Entrega.
- Factura/tiquete.
- Cobro.
- Devoluciones.
- Quiebres.
- Cierre de ruta.

#### Despachador

- Preparar carga.
- Escanear etiquetas.
- Pesar cartones.
- Asignar a camion.
- Confirmar salida.
- Imprimir documentos.
- Ver rutas planificadas.

#### Bodeguero

- Recibir de granja.
- Pesar.
- Escanear etiquetas.
- Registrar inventario.
- Registrar retorno.
- Registrar desperdicio.
- Conteos fisicos.
- Mantenimiento de bodega.

#### Encargado de granja

- Produccion diaria.
- Recoleccion.
- Vacunacion.
- Alimentacion.
- Mantenimiento.
- Salida hacia bodega.
- Incidencias.

### 8.11 Dashboard general enterprise

El administrador necesita una pantalla principal para controlar el negocio diariamente.

Indicadores recomendados:

- Produccion del dia por granja.
- Produccion del dia por galeron.
- Produccion esperada vs real.
- Huevo/cartones enviados a bodega.
- Huevo/cartones recibidos en bodega.
- Diferencias granja-bodega.
- Inventario actual por bodega.
- Inventario cargado por camion.
- Rutas activas.
- Clientes visitados vs pendientes.
- Facturas/tiquetes emitidos hoy.
- Ventas del dia.
- Cobros del dia.
- Cuentas por cobrar.
- Retornos pendientes.
- Desperdicio/quiebres por etapa.
- Diferencias abiertas.
- Vacunas vencidas o proximas.
- Mantenimientos vencidos o proximos.
- Alertas de bajo inventario.
- Top clientes.
- Margen estimado por producto/ruta.

Alertas criticas:

- Ruta con diferencia.
- Traslado recibido con diferencia.
- Factura rechazada por Hacienda/proveedor.
- Precio alterado.
- Carton sin etiqueta.
- Bascula vencida.
- Vacuna vencida.
- Mantenimiento vencido.
- Cliente excede limite de credito.

### 8.12 IA aplicada a Granja Don Paco

La plataforma puede incluir Estela como asistente gobernada para el ERP.

Agentes recomendados:

- Ceres: asistente avicola para produccion, vacunacion, alimento, mantenimiento, alertas de cuadre y rendimiento.
- Vega: servicio al cliente para consultas de clientes, pedidos, estados de factura y reclamos.
- Nash: analista financiero para ventas, cartera, rentabilidad y margen por ruta.
- Tales: control fiscal y documentos electronicos.
- Houston: coordinador operativo para rutas, tareas, mantenimiento y atrasos.
- Magnetar: retencion de clientes y recompra.
- Nova: marketing y redes sociales.

Funciones IA utiles:

- Resumen diario del negocio.
- Alertas inteligentes.
- Preguntas en lenguaje natural sobre ventas, produccion, inventario y rutas.
- Deteccion de anomalias: baja de produccion, aumento de quiebres, diferencias recurrentes.
- Sugerencia de mantenimiento preventivo.
- Sugerencia de pedidos por cliente segun historial.
- Resumen de ruta al cierre.
- Explicacion de diferencias.
- Asistencia al vendedor en ruta.
- Clasificacion de reclamos.
- Generacion de borradores de mensajes a clientes.

Regla:

La IA no debe aprobar ajustes, modificar precios, emitir notas de credito, anular facturas, cambiar permisos ni cerrar diferencias sin aprobacion humana.

## 9. Requerimientos no funcionales

### 9.1 Web y movil

- Web responsive para administracion, bodega y gerencia.
- Interfaz movil optimizada para vendedores, choferes, recibidores y despacho.
- Flujos rapidos, con botones grandes y poca digitacion en ruta.

### 9.2 Operacion en campo

Pendiente de definicion:

- Si las rutas tienen internet estable.
- Si se requiere modo offline con sincronizacion posterior.
- Si se usaran impresoras moviles para tiquetes.
- Si se enviaran documentos por WhatsApp, correo o ambos.

### 9.3 Seguridad

- Acceso por usuario y rol.
- Permisos por modulo y accion.
- Auditoria de cambios.
- Bloqueo de documentos cerrados.
- Aprobaciones para ajustes y diferencias.
- Proteccion de credenciales fiscales y certificados.

### 9.4 Auditoria

El sistema debe guardar:

- Quien creo, edito, aprobo o anulo.
- Fecha y hora.
- Valores antes y despues en campos criticos.
- Motivo de cambios relevantes.
- Relacion con documento origen.

### 9.5 Disponibilidad e integridad

- Respaldos automaticos.
- Control de errores de sincronizacion.
- Registro de fallos de integracion fiscal.
- Reportes de diferencias pendientes.
- Alertas de documentos fiscales rechazados.

## 10. Modelo conceptual inicial

Entidades principales:

- Usuario.
- Rol.
- Granja.
- Galeron.
- Lote de aves.
- Produccion diaria.
- Vacunacion.
- Consumo de alimento.
- Bodega.
- Inventario.
- Movimiento de inventario.
- Traslado granja-bodega.
- Recepcion de bodega.
- Camion.
- Ruta.
- Carga de camion.
- Cliente.
- Entrega.
- Factura.
- Tiquete.
- Pago.
- Gasto.
- Ajuste.
- Auditoria.
- Medicamento.
- Evento de vacunacion.
- Silo.
- Alimento.
- Lote de alimento.
- Consumo de alimento.
- Activo de mantenimiento.
- Orden de mantenimiento.
- Checklist de mantenimiento.
- Bascula.
- Calibracion de bascula.
- Etiqueta de carton.
- Lote de empaque.
- Peso registrado.
- Merma o desperdicio.
- Inventario de camion.
- Prueba de entrega.
- Lista de precios.
- Precio por cliente.
- Aprobacion.
- Ticket de servicio al cliente.
- Evento de IA.

## 11. Estados recomendados

### Galeron

- Crianza.
- Produccion.
- Mantenimiento.
- Inactivo.

### Traslado granja-bodega

- Preparado.
- En transito.
- Recibido.
- Recibido con diferencia.
- Anulado.

### Carga de camion

- Planificada.
- Cargada.
- En ruta.
- Cerrada.
- Cerrada con diferencia.
- Conciliada.

### Documento fiscal

- Borrador.
- Emitido.
- Enviado.
- Aceptado.
- Rechazado.
- Anulado o reversado mediante nota, segun aplique.

## 12. MVP recomendado

Para evitar construir demasiado de una vez, el MVP deberia enfocarse en el hilo operacional completo:

1. Granjas y galerones.
2. Registro de produccion diaria.
3. Traslado granja a bodega.
4. Recepcion en bodega con cuadre.
5. Inventario basico de huevo.
6. Clientes.
7. Rutas.
8. Carga de camion.
9. Entrega por cliente.
10. Retorno y conciliacion de ruta.
11. Facturacion o tiquete mediante integracion definida.
12. Reportes de diferencias.
13. Etiquetado basico de cartones o unidades logisticas.
14. Registro de peso en granja, bodega, camion, entrega y retorno.
15. Registro de desperdicio/quiebres.
16. Precios globales y precios por cliente.
17. Vistas por rol: administrador, socio, vendedor, despachador, bodeguero y encargado de granja.
18. Dashboard general diario.
19. Vacunacion y mantenimiento como calendario operativo basico.

Finanzas avanzadas, caja chica, cuentas por pagar, compras, analitica predictiva, IA avanzada, marketing y servicio al cliente omnicanal pueden entrar como fase 2 si el cliente acepta.

Nota:

Si el objetivo principal es trazabilidad maxima, etiquetas, peso, desperdicio, precios por cliente, rutas y conciliacion deben entrar desde el MVP. Dejarlos para despues debilitaria el control operativo que el cliente esta pidiendo.

## 13. Preguntas abiertas para Don Paco

### Operacion avicola

1. Cuantas granjas existen actualmente?
2. Cuantos galerones tiene cada granja?
3. Que estados reales usan para galerones?
4. Manejan lotes de aves por edad, linea genetica o proveedor?
5. Registran mortalidad?
6. Registran consumo de alimento por galeron o por granja?
7. Como manejan calendario de vacunacion actualmente?
8. Clasifican huevo por tamano, calidad o presentacion?
9. Cuales son las unidades oficiales de trabajo: huevo, carton, caja, tarima?
10. Cuales equivalencias usan entre unidades?

### Bodega e inventario

11. Hay una sola bodega o varias?
12. Hay clasificacion o empaque en bodega?
13. Manejan lote o fecha de produccion para vender primero lo mas antiguo?
14. Que tipos de merma existen?
15. Quien puede aprobar diferencias?

### Rutas y ventas

16. Cuantos camiones operan?
17. Los vendedores son los choferes?
18. Las rutas son fijas por dia?
19. El cliente hace pedido previo o el vendedor vende desde inventario cargado?
20. Que pasa si el cliente recibe menos de lo planeado?
21. Que pasa si el cliente devuelve producto?
22. Requieren prueba de entrega con firma, foto o ubicacion?

### Facturacion y cobro

23. Facturan en el momento de entrega o posteriormente?
24. Usan factura electronica, tiquete electronico o ambos?
25. Ya tienen proveedor de facturacion electronica?
26. Usan Facel actualmente o solo lo estan evaluando?
27. Requieren impresora movil?
28. Cobran en efectivo, SINPE, transferencia, tarjeta o credito?
29. Manejan limites de credito?
30. Requieren recibos de dinero?

### Tecnologia

31. Hay internet estable en granjas, bodegas y rutas?
32. Se requiere modo offline?
33. Que celulares usa el equipo: Android, iPhone o mixto?
34. Quienes usaran web y quienes movil?
35. Requieren integracion con WhatsApp, correo, mapas o GPS?

### Pesos, etiquetas y trazabilidad

36. Cada carton tendra etiqueta individual o se etiquetara por caja/lote?
37. Que informacion debe aparecer en la etiqueta?
38. Ya tienen impresoras de etiquetas?
39. Usan codigo de barras, QR o ambos?
40. En que puntos se pesa: granja, bodega, camion, cliente, retorno?
41. Que basculas usan actualmente?
42. Las basculas se calibran? Cada cuanto?
43. Hay tolerancia aceptada por peso?
44. El precio se calcula por carton, por peso, por caja o por otra unidad?
45. Que pasa si cantidad y peso no coinciden?
46. Hay clasificacion por tamano/calidad que afecte precio?

### Operacion sanitaria y mantenimiento

47. Existe calendario formal de vacunacion?
48. Quien aplica vacunas?
49. Que vacunas y ciclos manejan?
50. Manejan medicamentos ademas de vacunas?
51. Que mantenimientos son recurrentes?
52. Cada cuanto limpian silos, galerones y bodega?
53. Requieren checklist obligatorio?
54. Registran costos de mantenimiento?
55. Que activos deben llevar historial?

### Roles y control

56. Que puede hacer cada rol exactamente?
57. El socio puede ver montos financieros completos o solo indicadores?
58. Quien aprueba diferencias?
59. Quien puede cambiar precios?
60. Quien puede anular facturas o tiquetes?
61. Quien puede registrar desperdicio?
62. Que diferencias requieren evidencia?
63. Quien puede cerrar el dia operativo?

## 14. Criterios de aceptacion del sistema

El sistema se considera exitoso cuando:

- Una produccion registrada en galeron puede rastrearse hasta bodega, camion, cliente o retorno.
- Las diferencias quedan bloqueadas hasta documentarse.
- Los movimientos de inventario no pueden ocurrir sin documento.
- La ruta puede cerrarse solo cuando cargado, entregado y retornado calzan o tienen ajuste aprobado.
- La factura o tiquete se genera a partir de la entrega real.
- Gerencia puede ver diferencias, ventas, inventario y produccion sin depender de hojas externas.
- La arquitectura permite reutilizar expedientes, catalogo, inventario, finanzas, documentos y logistica en otros nichos.
- Cada carton o unidad logistica puede rastrearse por etiqueta desde origen hasta venta, retorno o desperdicio.
- Los pesos registrados por etapa calzan o quedan documentados con aprobacion.
- El administrador ve en tiempo real tiquetes, facturas, rutas, entregas y diferencias.
- Los precios por cliente se respetan automaticamente.
- Vacunacion y mantenimiento generan alertas y mantienen historial.
- Las vistas por rol muestran solo lo necesario y bloquean acciones no autorizadas.
- El desperdicio/quiebre queda incluido en la conciliacion, no como ajuste informal.
- Cada cierre diario muestra recibido, salido, entregado, retornado, desperdiciado, facturado y cobrado.
