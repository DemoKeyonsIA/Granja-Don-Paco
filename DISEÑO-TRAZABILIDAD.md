# Diseño: Proceso y Trazabilidad — Galerón → Bodega → Camión → Cliente → Retorno

> Documento de diseño (sin implementación). Basado en el estado actual del código en `server.ts`, `src/db/schema.ts` y los componentes, más buenas prácticas de trazabilidad alimentaria (control de lote como unidad mínima, eventos críticos de seguimiento KDE/CTE, guía de despacho, tiquete de venta en ruta).

---

## 1. Estado actual (hallazgos de la investigación)

El sistema **ya tiene los bloques** pero están **desconectados entre sí** y la trazabilidad es a nivel de *agregado* (cartones), no por unidad/lote.

### Lo que existe hoy

| Proceso | Endpoint / UI | Cómo funciona hoy |
|---|---|---|
| Recolección en galerón | `POST /api/produccion/recoleccion` → tabla `produccion_diaria` | Registra cantidad por galerón y tamaño. Estado de items: Disponible. |
| Traslado granja→bodega | `POST /api/operaciones/traslado` → `movimientos_inventario` "Traslado" | Mueve cantidad agregada por producto. UI en Operaciones→Traslados. |
| Recepción en bodega | `POST /api/operaciones/recepcion` | El bodeguero digita recibido vs esperado; si hay diferencia pide motivo (`prompt`). Guarda en `recepciones`. |
| Existencias | `GET /api/inventario` | Stock agregado por producto+ubicación ("Bodega Central", "Camión Ruta 1"...). Sin lote por unidad. |
| Etiquetas QR | `/api/etiquetas/*` + `Etiquetas.tsx` | Tabla `etiquetas` con **código único**, ciclo de estados: `Generada → EnBodega → Cargada → Entregada → Retornada → Merma`. **El QR impreso es un placeholder de texto** (no hay librería QR). El escaneo cambia estado/ubicación pero **no guarda historial por evento**. |
| Carga de camión | `POST /api/logistica/cargar-camion` | Resta stock de Bodega Central, suma al camión, registra movimiento "Carga Camión". **No genera guía ni vincula etiquetas.** |
| Venta en ruta | `POST /api/ventas` → `facturas` + `detalles_factura` | Crea factura con límite de crédito y precios de lista. Descuenta inventario del camión **hardcodeado** a "Camión Ruta 1". |
| Facturación electrónica | `/api/facturacion/*` | Borrador→XML→enviar→consultar estado→nota crédito. Capa Hacienda CR presente (proveedor Facel/FacturaYA/FACBOX/HaciendaDirect). |
| Tiquete | `Facturacion.tsx` (tipoDocumento 'Tiquete') | Existe botón "Tiquete" (sin cliente) y botón "Imprimir". El escaneo de código de barras es **simulado** (agrega línea 'Huevos' fija). |
| Cierre de ruta | `POST /api/logistica/cierre-ruta` | Cuadre matemático: `merma = cargado − vendido − restante`. Devuelve **todo** lo que queda al camión a bodega. **No concilia dinero, no usa tiquetes, no genera nota crédito por devolución.** |
| Peso en puntos de custodia | `/api/pesos/*` + `Pesos.tsx` | Registra peso esperado/real por punto (Granja/Bodega/Camión/Cliente) con tolerancia 2%. La conciliación es por ubicación. |
| Merma | `/api/desperdicios` + `Desperdicios.tsx` | Registro manual por origen/motivo. **No se dispara desde el cierre de ruta ni desde diferencias de báscula.** Tabla `aprobaciones` existe pero la UI no la usa para merma. |
| Auditoría | `auditoria` + `logAudit()` | Se usa en ventas (Crear Factura). **No registra eventos de etiquetas ni cambios de estado de guías.** |
| Autenticación | Login.jsx + `mockUsers` | **Login es mock**: valida contra un array en `src/data.ts`, no contra `users` en DB. Roles = filtro visual de módulos, no autorización real. |

### Brechas principales identificadas

1. **No hay "documento controlador" del despacho** (guía/maniobra). La carga a camión es un movimiento de inventario sin número de guía, sin firmas, sin impresión.
2. **La trazabilidad no es por lote/unidad**. Las etiquetas existen pero no se generan en el momento de recolección, no se vinculan al traslado/recepción, no se vinculan a la venta ni al retorno.
3. **Sobrantes: se devuelve en bloque**, sin saber qué etiquetas retornan y sin validar peso a la entrada; no hay nota crédito de devolución.
4. **Cierre no concilia dinero** (efectivo/crédito/tiquetes vs facturas), solo cartones.
5. **Vendedor no tiene caja de venta en ruta**: vender = llenar factura manual. No hay flujo tiquete→factura→cuadre.
6. **Sin impresión real**: tiquetes/etiquetas se imprimen con `window.print()` minimizando; el QR es un rectángulo de texto.
7. **Sin escaneo real**: no hay lector; el "escanear" es teclear el código.
8. **Sin control de sesión por camión**: no existe la noción de "ruta activa" de un camión hoy (qué guía está abierta, qué vendedor la opera).
9. **Bug de camión hardcodeado**: `/api/ventas` descuenta inventario SIEMPRE de `'Camión Ruta 1'` (`server.ts:328`), sin importar qué camión/ruta cargó la mercancía. La ruta solo queda `referencia_id` del movimiento de carga; no hay ligadura venta↔guía↔camión.
10. **Sin tablero en vivo**: no hay pantalla que muestre el avance de una ruta por tiquetes ni horas de entrega agregadas; no hay WebSocket (solo polling manual).
11. **Permisos no son de servidor**: cualquiera que edite JS entra como Admin (`mockUsers`).
12. **Sin offline**: si el camión pierde señal no puede operar.

---

## 2. Proceso objetivo (flujo a diseñar)

```
┌─────────────────────────── GRANJA ───────────────────────────┐
│ 1. Recolección diaria por galerón (cantidad por tamaño)       │
│ 2. LIMPIEZA / desinfección de huevos                          │
│ 3. ALISTAMIENTO en cartones (30 huevos por cartón, según      │
│    negocio) — NO se etiqueta ni se pesa en granja             │
│ 4. Traslado simple con GUÍA DE REMISIÓN (granja → bodega):    │
│    · cartones por producto/tamaño                             │
│    · responsable + transporte, SIN peso, SIN etiquetas        │
│    → trazabilidad del viaje = lote de recolección (fecha+     │
│      granja+galerón) ya registrado en produccion_diaria       │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌────────────────────────── BODEGA ────────────────────────────┐
│ 5. RECEPCIÓN por CONTEO de cartones (esperado vs recibido) +   │
│    PESO de control (aquí se pesa por primera vez)              │
│    → motivo si difiere                                         │
│ 6. ALISTAMIENTO/CLASIFICACIÓN EN BODEGA: la bodega arma los    │
│    galerones (agrupa cartones), clasifica (Grado A/B/C) y      │
│    GENERA LA ETIQUETA QR por galerón armado                    │
│    · lote de bodega = fecha + granja origen + N° de lote       │
│    · etiqueta nace aquí (estado EnBodega), con el origen       │
│      (granja/galerón) que viene de la guía de remisión         │
│ 7. DESPACHO: Despachador elige camión + galerones/lotes        │
│    → GUÍA DE DESPACHO (consecutivo, N copias)                  │
│    → peso de ANDÉN → bloqueo de stock → etiquetas Cargada      │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌────────────────────────── CAMIÓN ─────────────────────────────┐
│ 8. RUTA ACTIVA: vendedor opera "caja" del camión               │
│ 9. VENTA en cliente: escanea etiqueta + eliges cantidad/lote   │
│    → genera TIQUETE (consecutivo por rango asignado a camión)  │
│    → imprime tiquete al cliente → etiqueta estado Entregada    │
│    -> registra cobro (efectivo / crédito / pendiente)          │
│ 10. DEVOLUCIÓN: etiquetas sobrantes → estado Retornada, se     │
│    registran en la guía como retorno con peso                  │
│ 11. FIN DE RUTA: cuadre en el camión (cartones, $ y cajas)     │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌────────────────────────── CENTRAL ────────────────────────────┐
│ 12. CIERRE DE RUTA (despachador/administrador):                │
│     · cuadre de cartones: cargado − vendido − retorno − merma  │
│     · cuadre monetario: tiquetes vs efectivo+crédito           │
│     · retorno se reingresa a bodega con validación de peso     │
│     · merma real → Desperdicios (con aprobación si excede %)   │
│     · FACTURAS ELECTRÓNICAS: del consolidado de tiquetes       │
│       (consumidor final) + nota crédito por devoluciones       │
```

> **Ajuste clave:** en la granja **no** se etiqueta ni se pesa. La granja solo limpia, alista cartones y remite. El **nacimiento de la etiqueta** (unidad de trazabilidad) ocurre en **bodega**, en el alistamiento, cuando la bodega arma el galerón y le asigna lote + QR. La granja rastrea "hacia atrás" gracias al lote de recolección (`produccion_diaria`: fecha+granja+galerón) que queda registrado al momento de recoger, sin necesidad de pegar nada en granja.

**Principio de diseño:** *la etiqueta (código único del galerón armado en bodega, con origen de granja heredado) es la unidad de trazabilidad; el documento (remisión, guía, tiquete, nota crédito) es lo que vincula las etiquetas entre puntos de custodia; cada cambio de custodia genera un evento de auditoría. La granja no etiqueta ni pesa: su punto de trazabilidad es el lote de recolección y la guía de remisión.*

---

## 3. Unidad de trazabilidad y código

- **Nacimiento de la trazabilidad:** la etiqueta se genera **en bodega** durante el alistamiento. La granja **no etiqueta ni pesa**; solo limpia, alista cartones y remite.
- **Unidad física operativa:** un *galerón* = contenedor con N cartones (configurable, ej. 30 cartones = 900 huevos) **armado en la bodega**. Marcar la etiqueta del galerón (no cada cartón) reduce el trabajo y sigue siendo rastreable por lote. Los cartones que llegan de la granja quedan vinculados al galerón bajo el cual se despachan.
- **Código de la etiqueta (QR):**
  `ETQ-<AAAAMMDD>-<BODEGA 2>-<secuencial 3>`  → ej. `ETQ-20260907-BC-014`
  - Contenido del **QR** = `https://<dominio>/trazabilidad/ETQ-...` (página pública consultable: origen de granja, lote, fechas, custodias).
  - Además se imprime en **texto legible** el código (para digitar en el teléfono si el QR no lee).
- **Lote:** asignado en el alistamiento de bodega, **heredando el origen de granja** de la guía de remisión (fecha + granja + galerón de recolección). Ej.: `L-20260907-GRANJA01-G2`. Esto permite trazabilidad hacia atrás hasta *granja/galerón/aves de origen* sin haber pegado nada en granja.
- **Ticket de venta (tiquete):** consecutivo por **rango asignado** (ej. camión Ruta 1 usa tiquetes `TQ-0001..TQ-1999`). Con numeración con rango por camión/vendedor, el cuadre al cierre detecta huecos (tiquete anulado/sin registrar).

---

## 4. Modelo de datos propuesto (nuevas tablas / cambios)

### Nuevas tablas

```sql
-- Camión (hoy es solo un texto en inventario.ubicacion)
camiones(id, nombre, placa, ruta_defecto, vendedor_id, estado, ultima_guia_id)

-- GUÍA / MANIOBRA DE DESPACHO: documento controlador
guias_despacho(
  id, consecutivo UNIQUE,           -- GD-<AAAA>-<0001> secuencial
  camion_id, ruta_id,               -- ruta de la cual salen los clientes
  fecha, hora_carga,
  responsable_carga, responsable_transporte,  -- despachador + vendedor/conductor
  total_cartones, peso_bruto_sal, peso_bruto_llegada,
  estado,                           -- Preparada / Cargada / EnRuta / Cerrada / Anulada
  firmas,                           -- JSON firmas(carga, transporte)
  observaciones)

guias_despacho_detalle(
  id, guia_id, etiqueta_id,         -- qué etiquetas (o lote+cartones) van
  producto, cartones, peso_esperado, peso_real_anden,
  estado_salida)                    -- checked/pendiente

-- CAJA DEL CAMIÓN: cada venta emitida en ruta
ventas_ruta(
  id, tiquete_consecutivo UNIQUE, camion_id, guia_id, vendedor_id,
  fecha, hora, cliente_id (nullable),     -- tiquete puede no llevar cliente
  etiqueta_id (opcional), producto, cartones,
  subtotal, descuento, total, cobro,      -- efectivo / credito / pendiente
  estado,                                 -- Emitida / Anulada / Cobrada
  factura_id NULL,                        -- se llena en el cierre (factura electrónica)
  imprimido)

-- EVENTOS DE VIDA por etiqueta (la verdadera trazabilidad)
traza_etiqueta(
  id, etiqueta_id, tipo_evento,     -- Alistamiento Bodega, Recibida Bodega (sin etiqueta:
                                    -- evento a nivel lote/guía de remisión), Cargada, EnRuta,
                                    -- Entregada Venta, Retornada, Recibida Retorno, Merma, Anulada
  ubicacion, documento_ref,         -- guia_id / tiquete_id / recepcion_id / guia_remision_id
  usuario_id, dispositivo, fecha, observaciones)

-- RETORNO DE CAMIÓN: parecido a recepciones pero origen=camión
retornos_camion(
  id, guia_id, fecha, camion_id, responsable,
  cantidad_etiquetas, peso_bruto, detalle_json,  -- etiquetas que regresan
  estado)                          -- Registrado / RecibidoEnBodega / ConDiferencia
```

### Cambios a tablas existentes

- `facturas`: + `guia_id`, `camion_id`, `tiquete_consecutivo`, `fue_tiquete`.
- `facturas_electronicas`: ya soporta `tipoDocumento` Factura/Tiquete/NotaCredito → vincular `notas_credito_id` con devoluciones (retorno).
- `etiquetas`: **se genera en bodega (alistamiento)**, no en granja. + `guia_id` (guía actual), `lote_id`, `guia_remision_id` (origen granja heredado), `peso_bodega` (peso del galerón armado); validar ciclo de estados en servidor: `Generada→EnBodega→Cargada→Entregada/Retornada`.
- `desperdicios`: vincular `guia_id`, `tiquete_id`, `etiqueta_id`; activar flujo de `aprobaciones` cuando merma > umbral (ej. >2%) o motivo = "Diferencia de peso".
- `traslados`/`recepciones`: la remisión granja→bodega es un traslado **sin etiquetas** (solo cartones por producto) que se concilia en bodega por **conteo + peso**; origen puede ser "Camión" (reuso) para retornos. `granjaOrigen` obligatorio para heredar a la etiqueta.
- `movimientos_inventario`: + `guia_id`, `etiqueta_id` opcional para poder trazar hasta el movimiento.

### Reglas de negocio (servidor, no UI)

- Consecutivos: contadores por tipo (GD/pesos/tiquetes por camión) en tabla `consecutivos` (con transacción para no duplicar).
- Estado de etiqueta: transición validada en servidor con whitelist.
- En la carga: no se puede cargar una etiqueta sin estado `EnBodega`; las etiquetas cargadas quedan "comprometidas" hasta el cierre.
- En el cierre: cuadres deben cerrar con merma explicada o solicitud de aprobación (`aprobaciones`). Si merma ≠ 0 sin motivo, el estado queda `CerradaConDiferencia` y bloquea el siguiente despacho del camión hasta resolver.
- Un camión no puede tener 2 guías abiertas a la vez.

---

## 5. Impresión y escaneo

### Impresión
- **Etiquetas de galerón:** impresora térmica 40×30 mm **en la bodega** (Zebra/Goojprt), QR real con librería `qrcode` (generar en el **servidor** como PNG/vector para imprimir consistente), velocidad de peek ~200 etiquetas/día.
- **Guía de despacho:** A4 (o térmica 80 mm) en bodega; dos copias (bodega/despacho + camión).
- **Tiquete de venta:** térmica 80 mm en el camión (impresora USB-Bluetooth desde tablet/teléfono que use el vendedor), o mini `window.print()` como fallback actual.
- URLs impresas consultables: `https://dominio/trazabilidad/ETQ-...` (lector abre la historia completa, ideal para clientes finales y auditoría).

### Escaneo
- **Fase 1 (web + lector USB):** el campo de escaneo existe hoy como input; un lector USB (modo teclado) "escribe" el código + Enter → mismo flujo actual pero ahora dispara evento de trazabilidad.
- **Fase 2 (móvil):** PWA con `navigator.mediaDevices` + escáner QR (librería `html5-qrcode`) para bodeguero y vendedor; no requiere app nativa.

---

## 6. UI por rol (diseño orientado a simplicidad)

Meta: **el usuario de a pie no piensa en "módulos", piensa en su trabajo del día.** Una pantalla principal por rol, botones grandes, sin tablas densas.

### 🐔 Encargado de granja (limpia y remite)
Pantalla única "Granja hoy" (no toca etiquetas ni básculas):
- **Recolección:** registra (o confirma) lo recogido por galerón/tamaño (ya existe hoy en Operaciones→Recolección).
- **Remitir:** confirma los cartones a enviar por producto/tamaño → genera la **guía de remisión** (consecutivo, responsable). Sin pesaje, sin etiquetado.
- **Enviado:** ve el estado de la remisión (¿la bodega ya la recibió? ¿hubo diferencia?).
- Un botón grande y legible; nada de formularios administrativos.

### 🏭 Bodeguero (recibe, alista/etiqueta y despacha)
Pantalla única "Bodega hoy":
- **Recibir:** escanea la **guía de remisión** de la granja → conteo de cartones por producto → **peso de control en báscula** → muestra "Esperado X / Recibido Y" → botón verde único **"Confirmar"** (si difiere, aparece *una* pregunta con chips: Quebrado / Peso / Contado-viene-mal).
- **Alistar (etiquetar):** agrupa los cartones recibidos en **galerones** (30 cartones c/u) → el sistema **genera e imprime la etiqueta QR** por galerón, con lote y origen de granja heredado de la remisión. El galerón físico se pega la etiqueta → etiqueta nace `EnBodega`.
- **Despachar:** escanea/conta galerones a preparar (FIFO) → botón **"Generar Guía"** (de despacho) → imprime.
- **Existencias:** tarjetas grandes por producto+lote con stock; tap en un galerón muestra sus etiquetas y origen.
- Sin formularios de captura de datos administrativos (clasificación/fechas se heredan de la remisión y la etiqueta).

### 📦 Despachador (Pone el camión en la calle)
Pantalla "Despacho del día":
- **Crear guía:** 3 pasos (Camión → Lotes/disponibles → Cantidad & peso) → **Imprimir guía**. La guía fija **RUTA** (nombre, número de clientes, orden de recorrido) — de ahí el vendedor obtiene su orden del día. En el andén se identifica el camión por la guía impresa (número + ruta en grande).
- **Guías activas:** tarjetas de cada camión en ruta con: estado, % de avance (ventas/retornos recibidos del teléfono del vendedor), cuadre en vivo.
- **Tablero de recorrido (vista ruta):** clic en un camión → lista de sus clientes en orden de ruta, cada uno con estado `Pendiente / Visitado ▸ HH:MM / $Facturado / Devolvió`. Barra de progreso de cartones vendidos vs cargados. (Fase 5: overlay de mapa con GPS del celular del vendedor.)
- **Cerrar ruta:** revisa cuadre cartones + dinero; botón **"Cerrar & Generar facturas"**.
- Solo Admin + Despachador tocan esto (ya es así en `App.tsx`).

### 🚚 Vendedor en camión (Caja táctil tipo POS)
Pantalla única "Caja" (parece una caja registradora):
- Header gigante de total, teclado numérico grande (touch-first), colores de botones altos.
- Acciones mayores visibles siempre: **VENDER** (verde), **DEVOLVER** (ámbar), **TERMINAR DÍA** (gris).
- Flujo venta: 1) escanea etiqueta o elige cliente reciente (grandes botones) → 2) cantidad en teclado → 3) # cartones → 4) cobro: botones grandotes **EFECTIVO** / **CRÉDITO** → se imprime el tiquete automáticamente.
- "Terminar día": hace cuadre en pantalla (tiquetes emitidos, efectivo, crédito, retornos, merma declarada) y envía al servidor; bloquea nueva venta hasta cuadre.
- Lista de "clientes de la ruta" precargada desde la ruta (botones, no selects).

### 🧾 Facturador / Centro (Cierre fiscal)
- Al cerrar ruta: consolida tiquetes → factura electrónica (borrador→enviar→estado) por cliente (o consumidor final del día), nota crédito automática por devoluciones que apliquen.

### Seguridad
- Reemplazar `mockUsers` por auth real: login contra `users` en DB + contraseña hasheada + sesión/token; permisos por rol en el servidor (middleware en endpoints sensibles). Los roles actuales (Admin, Socio, Facturador, Vendedor, Bodeguero, Despachador) se mantienen.

---

## 7. Asignación de camiones a rutas (mejores prácticas de routing)

> Base ya existente: `rutas` es un **territorio** (agrupa `cliente_ids` con `dias_frecuencia` y `kilometraje_aprox`); `clientes.ruta` asigna el cliente a su territorio. La optimización recomendada opera **dentro y entre** esos territorios.

### A. Principios clave (fuente: TrackRoad, Upper, Descartes, Zeo)
1. **Feasible primero, eficiente después:** el camión primero debe poder ejecutar la ruta (capacidad, horarios, chofer); luego se minimiza distancia/tiempo. Un plan óptimo que el conductor no puede ejecutar vale cero.
2. **Planificación ≠ optimización:** planificar = construir la ruta ejecutable; optimizar = elegir entre rutas viables según un objetivo (menor km, menos tiempo, trabajo balanceado entre camiones). Para flotas pequeñas con rutas fijas, **empezar planificando bien** y agregar optimización solo si crece la flota.
3. **Tres decisiones de ruteo (VRP):** (1) qué camión atiende cada cliente, (2) en qué orden se visita, (3) cuándo (ETA), respetando restricciones.
4. **Datos limpios:** dirección/coordenadas válidas, tiempo de servicio por parada (2–15 min: parquear, entregar, firmar), ventanas horarias (ventanas muy estrictas rompen la ruta), capacidad del camión en **cartones** (CVRP) y jornada del chofer.
5. **Reoptimización en el día:** cliente ausente (fallida → reintento), nuevos pedidos, cancelaciones — resolver sin romper el resto de la ruta.
6. **Plan vs Actual + KPIs:** comparar lo planeado con lo ejecutado (orden seguido, puntualidad, tiempo de servicio, hora de fin) y medir: km por ruta, paradas por chofer/día, entregas a tiempo, costo por parada, tasa de fallidas. Es el lazo de mejora continua.

### B. Cómo aplicarlo en Granja Don Paco (fase 1, sin motores externos)
- **Camión ↔ ruta con reglas:** al registrar el camión se le asigna su ruta defecto (o se elige en cada guía). El sistema **sugiere la ruta** al crear la guía según: capacidad del camión en cartones, demanda histórica de la ruta ese día de frecuencia (`dias_frecuencia`), y clientes que deben recibir ese día.
- **Orden de paradas optimizado por cercanía:** geocodificar los clientes una vez (lat/lng, desde Google Maps/OSM al registrar el cliente) y el sistema sugiere **el orden de visita** (minimiza retrocesos) — se guarda en la guía y alimenta el tablero de recorrido. Si no hay coordenadas, mantiene el orden manual actual.
- **No sobrecargar:** validar en carga que `cartones ≥ demanda de la ruta` (capacidad) y que quede margen para venta en ruta de clientes nuevos/de paso.
- **Fase avanzada (solo si crece la flota):** integrar un optimizador VRP (ej. librería open source `or-tools` u `openrouteservice`) para re-agrupar clientes entre camiones; no es necesario hoy.

### C. Parámetros con los que se define una ruta (jerarquía de criterios)

Las buenas prácticas (Atlas, SimpliRoute, SmartRoutes, Everest, Netlogistik) definen la ruta por **esta combinación, en este orden de importancia**:

1. **Geografía (agrupación principal).** Una ruta = un **territorio**: clientes cercanos entre sí (clustering por proximidad, ej. k-means). Las zonas no se solapan, la densidad alta puede exigir más camiones/días, y se **evita en zigzag** dentro de la zona. *Regla: un cliente pertenece a una sola ruta por zona.*
2. **Frecuencia de entrega (`dias_frecuencia`).** Rutas **estáticas/recurrentes** para demanda predecible: el cliente se visita según su ciclo (diario, 2×/semana, semanal). Esto define **qué ruta se corre cada día**, no solo dónde.
3. **Volumen / capacidad (Cartones).** La carga demandada de la ruta debe caber en el camión (CVRP); se **balancea el trabajo entre camiones** para que ninguno quede sobrecargado ni subutilizado.
4. **Restricciones duras:** ventanas horarias del cliente (ej. pulperías 6–9 am), tiempo de servicio por parada (2–15 min), jornada del chofer y km razonables/día.
5. **Prioridad comercial (VIP / cuentas clave).** La prioridad **no agrupa** la ruta ni define el territorio: **ordena** dentro de la ruta y garantiza la ventana. Un VIP se visita primero / se le protege la promesa de entrega, pero sigue agrupado geográficamente.
6. **Conocimiento del chofer.** Territorios **estables** (el mismo camión/chofer conoce su zona, muelles, atajos, problemas de parqueo) → menos fallidas y más velocidad. Solo se rebalancea cuando la demanda cambia (estacionalidad, clientes nuevos).

**Modelo de datos que lo soporta:**
- `rutas`: + `coordenada_referencia` (centroide del territorio), `dias_activos`, `capacidad_max_cartones`, `orden_por_defecto`.
- `clientes`: + `lat`, `lng` (geocodificar una vez), `prioridad` (`VIP / Alta / Normal`), `ventana_entrega` (hora mín/máx), `demanda_promedio_cartones`, `dias_frecuencia` (ya existe en `rutas`; mover a cliente para pedidos distintos).
- Al crear la guía, el sistema ordena los clientes así: **1) respetar ventanas horarias y prioridad** → 2) dentro de cada grupo, **minimizar distancia recorrida** (coordenadas). El resultado se guarda en la guía y alimenta el tablero de recorrido.

**Respuesta concreta a "¿ubicación, prioridad o VIP?":** la **ubicación define el territorio** (qué clientes van juntos y en qué camión), la **frecuencia define el día**, la **capacidad define cuánto**, y la **prioridad/VIP solo ordena la visita dentro de la ruta y protege horarios** — no crea rutas.

## 8. Tablero en vivo de rutas (despacho en vivo, versión sencilla)

> Mejores prácticas de "live dispatching" (TrackRoad, Zeo, Motive, Track-POD): estados de parada **coherentes**, actualizaciones desde el móvil del chofer, y el despachador ve progreso sin llamar. **Simplificación para Don Paco: el estado no se digita ni usa GPS — se deriva automáticamente del tiquete emitido en la caja del vendedor.**

### Modelo de estados de parada (simple, cubre ~95%)
| Estado | Cómo se marca |
|---|---|
| **Pendiente** | Planificado, aún sin entregar |
| **Entregada ▸ HH:MM** | **Automático:** al emitirse el tiquete en la caja del camión |
| **Devuelto** | Cliente rechaza/reusa → botón DEVOLUCIÓN (con tiquete de devolución) |
| **Fallida / Cliente ausente** | Anotación del vendedor (sin vender, se reintenta; no rompe el día) |

### Qué muestra el tablero (una línea de progreso por camión)
- **Línea/checklist del recorrido:** cada cliente es un eslabón en orden de ruta; se ilumina de **verde con su hora** cuando llega el tiquete. Gris = pendiente, ámbar = retorno/fallida.
- **Barra de cartones:** vendido vs cargado (progreso físico que el despachador quería ver "llenándose").
- **$ acumulado en ruta** y sobrantes/merma declarados en vivo.
- Cada eslabón es clicable: muestra el tiquete(s), hora (tomada del **servidor**), monto y método de cobro.

### Mecánica de actualización (simple, sin GPS en fase 1)
- Polling corto del tablero cada ~15–30 s (o WebSocket en fase 5). La hora del evento es la del servidor, no la del celular.
- El estado se deriva de `ventas_ruta` (tiquete) + `traza_etiqueta` (evento `Entregada Venta`). Cero digitaciones y cero check-ins de "llegué".
- **Fase 5 (opcional):** GPS del teléfono del vendedor cada 30–60 s para ver el camión en un mapa y calcular ETA; no es necesario para el control del día.

### Excepciones que el tablero detecta
- Cliente "Entregada" pero no en orden planeado → saltos de secuencia (el vendedor cambió el orden).
- Parada pendiente con Hora Plan pasada → **atrasada** (chip ámbar).
- $ en ruta que no coincide con cartones → alerta temprana de descuadre antes del cierre.
- KPIs al cerrar: entregas a tiempo, paradas completadas, tiempo de servicio promedio, hora real de fin vs plan, tasa de fallidas.

---

## 9. Robusteza del proceso

1. **Consecutivos de servidor** (nunca del cliente) para guía, tiquete y factura → sin huecos/duplicados.
2. **Transacciones DB** en carga, venta, retorno y cierre (ya patrón usado en `cargar-camion`).
3. **Cuadre dual**: cada punto cierra con identidad `esperado vs real` + motivo (remisión, recepción, andén, cliente, retorno). Dos verificadores humanos donde haya dinero (vendedor+cajero central en el cierre).
4. **Merma con política**: umbral configurable; sobre el umbral, requiere `aprobaciones` y registra `desperdicios` con `impactoFinanciero`.
5. **Backwards/forwards**: desde una factura se llega a la guía → etiquetas → lote → galerón → aves. Desde una etiqueta se llega a todas sus custodias y documentos.
6. **Sesión de camión**: una guía activa por camión; impedir ventas si no hay guía abierta; impedir doble cierre del mismo día.
7. **Auditoría completa**: cada transición de etiqueta y cambio de estado de guía se registra (`traza_etiqueta` + `auditoria`).

---

## 10. Offline en el camión (fase 2)

- PWA del vendedor: que funcione sin señal. Cola local de tiquetes/ventas/retornos; impresión local (impresora bluetooth). Al reconectar: sincroniza ventas (transacción por tiquete), cuadree de pesos, y descarga precios/clientes de la ruta del día. El servidor acepta lotes identificados por `guia_id + ordinal`.
- El QR de etiquetas ya carga toda la info en el código apuntando al lote; no depende de red para identificar (codifica origen+lote+secuencial).

---

## 11. Fases de implementación sugeridas

| Fase | Alcance | Entrega |
|---|---|---|
| **F0 (base)** | Autenticación real por roles (DB+session+middleware). | Seguridad. |
| **F1 (cadena conectada)** | Remisión simple de granja (cartones, sin peso/etiquetas); recepción en bodega por conteo+peso; **alistamiento** que arma galerones y **genera la etiqueta QR en bodega**; bloqueo por estado; `traza_etiqueta` registrando cada paso. | Huevo rastreable granja→bodega (etiqueta nace en bodega). |
| **F2 (despacho)** | Tabla `camiones`, `guias_despacho`, carga por etiquetas/lotes con peso andén, impresión de guía, una guía activa por camión. | Bodega→camión con documento. |
| **F3 (caja del vendedor)** | `ventas_ruta` + tiquetes por rango + impresión 80 mm + retornos + cuadre del día desde el camión. | Camión→cliente con tiquete. |
| **F4 (cierre y fiscal)** | Cierre de ruta con cuadre cartones+dinero, reingreso de retornos con peso, nota crédito, generación de facturas electrónicas del consolidado, merma con aprobaciones. | Trazabilidad y facturación ligadas de punta a punta. |
| **F5 (movilidad/offline)** | PWA escáner QR en el camión, modo offline, sincronización. | Operación robusta en campo. |

**Orden recomendado:** F0 → F1 → F2 → F4 (cierre) → F3 (caja) → F5. (El cierre antes que la caja porque el cierre une todo y valida el diseño; la caja móvil al final es lo que más prueba el nudo.)

---

## 12. Riesgos y puntos a decidir con el negocio

1. **Unidad de etiqueta**: confirmar el *galerón* (N cartones) que la bodega armará al alistar (sugerido 30 cartones) y el recipiente real que usan. La remisión de granja solo lleva cartones por producto/tamaño — validar cómo cuentan hoy el "esperado" en bodega (¿por cartón? ¿por docena?).
2. **Fiscalidad del tiquete**: ¿el tiquete es solo comprobante de entrega y la factura electrónica se emite por consumidor final consolidado, o necesitan tiquete electrónico? Para CR: definir si cada venta diaria por cliente va como factura electrónica individual (volumen: los tiquetes de ruta son miles → costo de facturación electrónica por documento es un factor).
3. **Crédito vs contado en ruta**: política de cobranza al día siguiente vs fin de mes ya existe (limite_credito, saldo_pendiente) — mantener.
4. **Merma tolerada**: definir umbral % para aprobación (sugerido 2% del peso cargado).
5. **Inventario congelado vs disponible**: huevos por lote tienen vencimiento/rotación FIFO — el despacho debe sugerir **FIFO por lote** (los más viejos primero).
6. **Multi-bodega**: hoy todo es "Bodega Central". Si hay 2+, el modelo guía/recepción ya lo soporta con `bodegaDestinoId`.
7. **Impresoras reales**: invertir en térmicas 80 mm (3ers gigantes no funcionan bien en camión). Presupuesto a validar.

---

## 13. Cómo se verifica (definición de "listo")

- **Trazabilidad hacia atrás:** dado un tiquete/factura → guía → etiquetas → lote → galerón → granja → aves del lote. Pantalla `/trazabilidad/<codigo>` pública consultable.
- **Trazabilidad hacia adelante:** dada una etiqueta → todos los documentos y custodias.
- **Cuadre del día:** cargado = vendido + retornado + merma, y suma de tiquetes = efectivo + crédito, con 0 hangings inexplicados en un día normal.
- **Controles:** nulo intento de saltar estados, nula doble guía abierta, nula venta sin guía, nula emisión ilegal de tiquete sin rango.