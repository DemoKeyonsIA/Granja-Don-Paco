# Fase 6 — avance de UI para operación de campo

## Alcance entregado en código

- **Vendedor — caja de ruta:** selección guiada de ruta, cliente, producto y pago; controles táctiles amplios; precio, unidad, existencias y total claros; bloqueo por falta de existencias; conteo de efectivo antes de cerrar caja.
- **Bodega — recepción:** cantidades esperadas/recibidas explícitas, captura de cero cuando no llegó producto, motivo obligatorio para faltantes y distinción entre faltante y sobrante. Los fallos de carga tienen reintento visible; repetir una recepción guardada no duplica inventario y un conteo distinto solicita corrección administrativa.
- **Despacho — carga:** indicador accesible del paso, cartones y sacos diferenciados, resumen previo y acción de envío persistente. Los reintentos comparten un id de carga y no repiten producción ni traslados; cambios de contenido devuelven conflicto para revisión.
- Las barras de acción usan el patrón común `src/components/AccionFijaMovil.tsx`. Se ajustó contraste (texto secundario 5,15:1 claro / 6,92:1 oscuro; texto sobre acción azul 7,55:1), los botones de icono tienen nombre para lector de pantalla, mensajes de escaneo/confirmación se anuncian y controles táctiles clave alcanzan 44×44 px.
- La navegación fue revisada. Los roles tienen una entrada clara; móvil y escritorio mantienen caminos diferentes donde cambian tareas y permisos.

## Validación automatizada

- TypeScript (`npm run lint`) limpio.
- 114 pruebas UI focalizadas pasan. Las 9 pruebas E2E de carga/recepción y los 14 escenarios E2E del flujo completo pasan, incluida una comprobación de login para las siete cuentas demo, idempotencia frente a reintentos y conflicto por contenido distinto.
- Build de frontend y servidor pasa; Vite advierte que el bundle JS supera 500 kB.

## Validación para el demo

El cliente verá perfiles simulados, por lo que no se requieren usuarios reales para validar esta versión. [El protocolo de validación](docs/FASE6_VALIDACION_CAMPO.md) cubre una cuenta de ejemplo por tipo: Admin, Comercial/facturación, Comercial/vendedor, Socio, Bodeguero, Despachador/Encargado de Galerón y Camionero. Se añadió acceso rápido visible para facturación junto con los demás perfiles.

La validación de demo debe verificar el acceso y menú de cada perfil y ejecutar los flujos móviles de venta, recepción y despacho con datos ficticios. La usabilidad con personal real queda como requisito antes de desplegar el sistema para operaciones reales.

**Validación ejecutada en esta continuación:** `npm run lint` sin errores; 114 pruebas UI en 4 archivos; 14 escenarios en `tests/e2e-smoke-flujo.test.ts`, incluidos inicios de sesión para las siete cuentas; `npm run build` exitoso. El suite E2E necesitó permiso para abrir el socket local temporal de LibSQL. El acceso rápido ofrece los siete perfiles.
