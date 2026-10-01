# Plan de Implementación — Trazabilidad, Despacho y Caja en Ruta

> Documento ejecutable basado en: **`DISEÑO-TRAZABILIDAD.md`** (diseño validado). Este plan define **qué se construye, en qué orden, en qué archivos, y cómo se verifica**. No toca lo ya funcionando (dark mode, ocuppación galerones, testes existentes).

---

## 1. Contexto técnico (qué hay hoy)

| Área | Estado actual |
|---|---|
| Stack | Express + Drizzle-ORM + libsql (SQLite) · React 19 · Tailwind 4 · TypeScript · Vitest + Supertest |
| Entrada | `npm run dev` → `tsx server.ts` (puerto 5174). Tests: `npm test` (144 pasando). Lint: `npm run lint` (`tsc --noEmit`). |
| Archivos clave | `server.ts` (~2.8k líneas, 113 rutas) · `src/db/schema.ts` (427 líneas) · `src/App.tsx` (routing por rol) · `src/components/Login.tsx`, `Operaciones.tsx`, `Logistica.tsx`, `Etiquetas.tsx`, `Facturacion.tsx`, `Desperdicios.tsx` · `src/data.ts` |
| Auth | **Mock** (`src/data.ts` + `Login.tsx`). `users` en DB solo tiene `id/name/email/role` — **sin password**. |
| Geografía | `clientes.latitud/longitud` **ya existen** · `rutas` tiene `cliente_ids`, `dias_frecuencia`, `kilometraje_aprox`, `vendedor_asignado` |
| Bug conocido | `/api/ventas` descuenta inventario hardcodeado `'Camión Ruta 1'` (server.ts:328) |
| Dependencias a sumar | `qrcode` (+types), `bcryptjs` (+types). Sin JWT: usar sesión en tabla + token aleatorio. Hash de password con `crypto.scrypt` de Node (cero deps). |
| Roles | Admin, Socio, Facturador, Vendedor, Bodeguero, Despachador + nuevo **Encargado de Granja** (puede reusar rol Vendedor restringido) |

**Principios de ejecución**
1. Cada fase entrega algo **verificable** y no rompe fases anteriores (tests verdes + `tsc` limpio al terminar).
2. Servidor fuente de verdad: transacciones, consecutivos, horas de evento, validación de estados (nunca el cliente).
3. Auditoría en cada transición (helper `recordEvent`).
4. Deps nuevas solo cuando aportan (QR real, hash de password). Impresión inicial con `window.print()` existente.

---

## 2. Fase 0 — Autenticación real y permisos por rol (seguridad)

**Objetivo:** eliminar el login mock; que cada rol solo pueda llamar lo suyo desde el servidor.

**Datos (`src/db/schema.ts`)**
- `users`: + `password_hash` (scrypt), `activo` (default 1). Seed actual de `src/data.ts` migra a DB con hash.
- Nueva `sesiones(id, userId, token, creada, expira)`.

**Endpoints (server.ts)**
- `POST /api/auth/login` → valida `email+password` contra DB, crea sesión, devuelve token + rol.
- `POST /api/auth/logout`, `GET /api/auth/me`.
- Middleware `requireAuth()` + `requireRole(...roles)` aplicado a rutas sensibles:
  - `logistica/*`: Admin, Despachador, Facturador, Vendedor.
  - `operaciones/*`: Admin, Bodeguero, Despachador, Facturador + Encargado de Granja.
  - `ventas`, `facturacion/*`: Admin, Facturador, Vendedor.
  - `auditoria`, `aprobaciones`, `reportes`: Admin, Socio.

**UI**
- `Login.tsx`: llama al endpoint real (guardar token en `localStorage`/contexto). Quitar validación de `src/data.ts`.
- `App.tsx`: pasa el token en los `fetch` (helper `api()` central). Mantener filtrado visual actual de `macroModules`.

**Tests**
- Login válido/inválido, sesión expirada, acceso denegado 403 por rol (supertest).
- Mantener 144 tests verdes (adaptar los que usen login mock).

**DoD:** sin manera de entrar sin password; un Bodeguero recibe 403 en `/api/facturas`; `npm test` + `npm run lint` verdes.

---

## 3. Fase 1 — Cadena granja → bodega con etiqueta que nace en bodega

**Status: ✅ COMPLETADA (F1)** — fecha: 2026-09-08. 168/168 tests, lint y build OK, servidor en 5174 verificado.
Desviaciones menores vs. este plan: (a) la UI se integró dentro del módulo `Operaciones y Bodegas` como subpestaña **"Remisiones y Alistar"** (`src/components/Remisiones.tsx`) en vez de crear el rol "Encargado de Granja" / pantallas separadas (rol pendiente de definir, decisión #3); (b) `lotes_report` se pospone — v1 usa el campo `lote`; (c) `CARTONES_POR_GALERON = 30` como constante en el endpoint (decisión #1) — se lee `body.cartonesPorGaleron` si se envía, fácil de parametrizar después.

**Objetivo:** remisión simple de granja (sin peso/etiquetas), recepción por conteo+peso y **alistamiento** que arma galerones y genera el QR real, con trazabilidad por evento.

**Datos**
- `guias_remision(id, consecutivo, granjaId, fecha, responsable, transporte, producto, cartonesEsperados, estado)` — sin etiquetas.
- `recepciones`: + `guia_remision_id`, `peso_bruto`, `motivo_diferencia`.
- `etiquetas`: + `guia_remision_id`, `lote`, `granjaOrigen`, `peso_bodega`, `galeron`.
- Nueva `traza_etiqueta(id, etiquetaId, tipoEvento, ubicacion, documentoRef, usuarioId, fecha, observaciones)`.
- Nueva `lotes_report(id, codigo, granjaOrigen, fecha, galeronOrigen)` (opcional, v1 puede usar campo `lote`).

**Endpoints**
- `POST /api/operaciones/remision` (crear remisión de granja), `GET /api/operaciones/remisiones`.
- `POST /api/operaciones/recepcion-remision` (conteo esperado/recibido + peso + motivo si difiere; marca remisión `Recibida`).
- `POST /api/operaciones/alistamiento` (arma galerones N cartones → inserta etiquetas `EnBodega` + eventos).
- `GET /api/etiquetas/:codigo/qr.png` (QR real con librería `qrcode`, comienza con la URL de trazabilidad).
- `GET /api/etiquetas/trazabilidad/:codigo` (consolidado real: origen granja, lotes, custodias, documentos).
- Helper `recordEvent(...)` para `traza_etiqueta` + `logAudit`.

**UI**
- **Encargado de Granja** (`src/components/RemisionesGranja.tsx`): 1 pantalla — Recolección (reuso Operaciones→Recolección) + **Remitir** (botón grande → guía de remisión, sin peso).
- **Bodeguero** (`src/components/Bodega.tsx`): 3 acciones grandes — **Recibir** (escanea guía remisión → báscula → Confirmar/diferencia), **Alistar** (arma galerones → imprime QR en bodega), **Existencias**.
- `Etiquetas.tsx`: imprimir QR **real** en vez del placeholder `[ QR: CODIGO ]`.

**Reglas** (servidor): transición de estado validada (`Generada→EnBodega→…`); no cargar/repartir etiqueta que no esté `EnBodega`; consecutivo de remisión por servidor.

**Tests**: ciclo remisión→recepción con/sin diferencia→alistamiento genera N etiquetas→eventos en `traza_etiqueta`→trazabilidad devuelve el origen.

**DoD:** un huevo físico se puede rastrear desde la recolección de granja (lote) hasta el galerón etiquetado en bodega, con QR real imprimible y consultable.

---

## 4. Fase 2 — Despacho con guía: camiones, rutas y carga

**Objetivo:** carga de camión **documentada** (guía de despacho), con ruta explícita, una guía activa por camión, y orden de recorrido sugerido.

**Datos**
- `camiones(id, nombre, placa, rutaDefecto, capacidadCartones, vendedorId, estado, guiaActivaId)`.
- `rutas`: + `centroideLat/Lng`, `capacidadMaxCartones`, `diasActivos`.
- `clientes`: + `prioridad` (`VIP/Alta/Normal`), `ventanaEntrega` (min/max), `demandaPromedioCartones`, `diasFrecuencia` (mover de ruta a cliente para flexibilidad).
- `guias_despacho(id, consecutivo, camionId, rutaId, fecha, horaCarga, responsableCarga, responsableTransporte, totalCartones, pesoSalida, pesoLlegada, estado[Preparada/Cargada/EnRuta/Cerrada/Anulada], firmasJson, rutaOrdenJson)`.
- `guias_despacho_detalle(guíaId, etiquetaId, producto, cartones, pesoAnden, estadoSalida)`.
- Nueva `consecutivos(tipo, rangoDesde, rangoHasta, ultimo)` — transacción antidups.

**Endpoints**
- `POST/GET /api/logistica/camiones` (CRUD básico).
- `POST /api/logistica/guias` → valida camión sin guía activa, **sugiere ruta** (días + capacidad), arma `rutaOrdenJson` (ventanas + prioridad → nearest-neighbor por lat/lng), pesa andén, marca etiquetas `Cargada` + `guia_id`, bloquea stock, imprime guía, registra evento.
- `GET /api/logistica/guias-activas`, `GET /api/logistica/guias/:id` (con orden de recorrido).
- **Refactor** de `cargar-camion` y **fix del bug** `/api/ventas` hardcodeado 'Camión Ruta 1' — pasar `guiaId` y deducir camión desde la guía.

**UI**
- `src/components/Despacho.tsx` (Despachador): **Crear guía** (3 pasos) · **Guías activas** (tarjetas camión+ruta+% avance) · **Cerrar ruta**.
- `Logistica.tsx`: reemplazar el "cuadre a cartones" por guías reales; sub-tab Camiones/Rutas con parámetros de la Sección 7C del diseño.

**Reglas**: 1 guía activa/camión; no cargar etiquetas fuera de estado `EnBodega`; no sobrepasar `capacidadCartones`; FIFO por lote en la sugerencia de carga.

**Tests**: carga con capacidad/stock/estado ok y fallos; no doble guía; orden sugerido respeta ventanas+prioridad; fix del descuento usa el camión de la guía.

**DoD:** cada camión en la calle sale con una guía impresa (N° + ruta) y el sistema sabe qué clientes y en qué orden hará.

---

## 5. Fase 3 — Caja del vendedor + tablero en vivo (aprobado)

**Objetivo:** vender en ruta con **tiquete impreso**, retornos, y que el despachador/admin vea la **línea de progreso** rellenarse en vivo.

**Datos**
- `ventas_ruta(id, tiqueteConsecutivo, camionId, guiaId, vendedorId, fechaHora(servidor), clienteId? , etiquetaId, producto, cartones, subtotal, descuento, total, cobro[Efectivo/Credito], estado[Emitida/Anulada], facturaId, imprimido)`.
- `retornos_camion(guiaId, fecha, responsable, etiquetasJson, peso, estado)`.
- `consecutivos`: rangos de tiquetes por camión (ej. camión R1 usa `TQ-0001..1999`).

**Endpoints (caja en ruta)**
- `POST /api/logistica/caja/venta` — crea `ventas_ruta`, descuenta inventario del **camión de la guía**, etiqueta → `Entregada` (pesos: si venta parcial del galerón, marcar parcial con saldo), emite tiquete del rango, evento + auditoría.
- `POST /api/logistica/caja/devolucion` — etiqueta → `Retornada`, registra en `retornos_camion`; libera inventario del camión.
- `POST /api/logistica/caja/fin-dia` — cuadre provisional en pantalla (tiquetes/efectivo/crédito/retornos/merma) y bloquea ventas hasta cuadre en central.
- `GET /api/logistica/tablero` — agrega por guía: clientes con estado (+hora servidor), cartones vendidos/cargados, $, retornos, merma; marca atrasadas y saltos de secuencia.

**UI**
- **Vendedor** (`src/components/CajaRuta.tsx`): POS táctil — botones grandes VENDER / DEVOLVER / TERMINAR DÍA, cliente en botones, teclado numérico, EFECTIVO/CRÉDITO, tiquete automático.
- **Tablero** (`src/components/TableroRutas.tsx`, solo Admin/Despachador): línea de progreso por camión, polling ~15–30 s; chips verdes ▸hora, ámbar=atrasado/retorno, barra cartones + $.
- `Facturacion.tsx`: el "escaneo simulado" pasa a lector USB real (mismo input + Enter).

**Reglas**: venta sin guía activa → bloqueada; hora = servidor; tiquete consecutivo secuencial sin huecos (anulación queda registrada).

**Tests**: venta descuenta del camión correcto (regresión del bug), tiquete consecutivo, devolución libera inventario y etiqueta, tablero devuelve estados/horas, fin-dia bloquea.

**DoD:** el despachador ve en su pantalla, sin llamadas, el recorrido completándose con horas; el vendedor emite tiquete impreso; el cuadre de dinero por camión existe.

---

## 6. Fase 4 — Cierre de ruta, retornos y facturación electrónica

**Objetivo:** cerrar el día con **cuadre doble** (cartones y dinero), reingreso de retornos con peso, merma con aprobación y facturación electrónica del consolidado.

**Endpoints**
- `POST /api/logistica/cierre-ruta` (extender): cuadre `cargado = vendido + retornado + merma` y `Σ tiquetes = efectivo + crédito`; si descuadre o merma sin motivo → `CerradaConDiferencia` + solicitud en `aprobaciones` + bloqueo del siguiente despacho del camión.
- `POST /api/logistica/retornos/:guiaId/recibir` — bodeguero escanea retornos, pesa, reingresa etiquetas `Retornada→EnBodega`.
- `POST /api/desperdicios` (extender): vincula `guiaId`/`etiquetaId`, flujo de `aprobaciones` real en UI.
- `POST /api/facturacion/consolidar-ruta` — de los tiquetes genera facturas electrónicas (borrador→enviar→estado) y **nota de crédito** por devoluciones; enlaza `ventas_ruta.facturaId`.
- Facturas: + `guia_id`, `camion_id`, `tiquete_consecutivo`, `fue_tiquete`.

**UI**
- `Despacho.tsx` → botón **Cerrar y generar facturas** con resumen del cuadre.
- `Desperdicios.tsx` → vista de aprobaciones (Admin) para merma > umbral.
- `Facturacion.tsx` → listado "Rutas del día" para el Facturador.

**Reglas**: un cierre no duplicable; nota crédito obligatoria cuando hay retornos; consecutivo fiscal del servidor.

**Tests**: cuadre exacto, cuadre con descuadre→bloqueo, merma con/sin aprobación, consolidación tiquetes→factura electrónica + NC (mock del proveedor Hacienda).

**DoD:** un día termina con cero hangings inexplicados: cartones, dinero, merma y factura electrónica concilian; retornos reingresan con peso.

---

## 7. Fase 5 — Movilidad / offline (backlog opcional)

- PWA del vendedor: cola local de ventas/retornos, `html5-qrcode` para escanear, impresión bluetooth, sync batch por `guiaId + ordinal`, horarios del servidor al sincronizar.
- GPS del celular del vendedor cada 30–60 s → mapa + ETA en el tablero (fase 8 del diseño).
- Evaluar motor VRP (`or-tools`/`openrouteservice`) solo si crece la flota.

**DoD (si se hace):** el camión opera sin señal y sincroniza sin duplicados; el tablero muestra el mapa.

---

## 8. Orden, dependencias y estimación

```
F0 (Auth real) ─────────────── 2-3 d
F1 (Remisión+Recepción+Etiqueta) 3-4 d   ← bloqueada por decisión "galerón = N cartones"
F2 (Despacho con guía) ──────── 3 d     ← requiere F1 (etiquetas cargadas) y F0 (seguridad)
F3 (Caja + Tablero) ─────────── 3-4 d   ← requiere F2 (guía activa) y F0
F4 (Cierre + Facturación) ───── 2-3 d   ← requiere F2+F3
F5 (Offline/GPS) ────────────── 3+ d    ← backlog
```
**Total ~16–17 días hombre** (sin F5). Dependencias críticas: F1→F2→F3→F4. F0 puede ir en paralelo mientras se define el galerón. **Los tests de cada fase SON el hito** (`npm test` + `npm run lint` + `npm run build`).

**Riesgo del plan:** F3/F4 tocan el inventario del camión y la facturación — por eso F2 primero; y el fix del bug `'Camión Ruta 1'` se hace en F2 para que F3 ya nunca lo tenga.

---

## 9. Decisiones que bloquean (resolver ANTES de cada fase)

1. **Galerón = cuántos cartones** (bloquea F1. Sugerido 30 cartones).
2. **Fiscalidad del tiquete** (bloquea F4): ¿tiquete = solo comprobante y factura electrónica consolidada por consumidor final, o factura electrónica por cliente/día? (Volumen de documentos afecta costo con Hacienda).
3. **¿Encargado de Granja = rol nuevo o Vendedor restringido?** (bloquea F0; afecta permisos).
4. **Merma tolerada** (sugerida 2%) para el umbral de aprobaciones (bloquea F4).
5. **Prioridad en la jerarquía de rutas**: confirmar que geografía>frecuencia>capacidad>prioridad (bloquea F2; opciones en Sección 7C del diseño).

---

## 10. Definición de "listo" global (DoD)

- [ ] Cualquier usuario solo entra con credenciales reales; permisos por rol aplicados en servidor.
- [ ] Huevo rastreable punta a punta: recolección → remisión → recepción → alistamiento (QR) → guía → tiquete → retorno → merma, con `traza_etiqueta` en cada custodia.
- [ ] Una guía de despacho por camión; camión+ruta fijos; orden de recorrido sugerido y seguido.
- [ ] Tablero en vivo: el despachador ve la línea de progreso y las horas de entrega sin llamar.
- [ ] Cierre con cuadre doble (cartones + dinero), retornos con peso, merma con aprobación, factura electrónica consolidada + nota crédito.
- [ ] `npm test` verde en cada fase + `npm run lint` + `npm run build`.
- [ ] Manual de uso mínimo por rol (Bodeguero, Despachador, Vendedor, Encargado de Granja).