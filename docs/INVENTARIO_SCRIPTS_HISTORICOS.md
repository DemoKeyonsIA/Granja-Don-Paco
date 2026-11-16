# Inventario de scripts históricos y artefactos locales

Revisión: 2026-11-05. Alcance: archivos `.js`, `.cjs`, `.mjs`, `.log` y `.txt` en la raíz del repositorio.

## Clasificación y decisión

- Los scripts `fix_*`, `patch_*`, `rewrite_*`, `add_*` y `update_*` son parches/manuales de una sola vez que quedaron de iteraciones previas; no forman parte de los comandos de `package.json`. Se conservan como historial y no deben ejecutarse como parte del arranque, build o pruebas.
- `generate_operaciones.cjs`, `clean_types.cjs`, `import_sparkles*.cjs` y `test_post.cjs` también son utilidades puntuales; sus efectos se consideran incorporados al código actual y no son pasos de instalación.
- `update_app_layout_script.js` está vacío y se conserva porque `update_app_layout.cjs` lo genera.
- `*.log`, `*.txt`, `.t-busy.mjs` son salidas/capturas temporales locales, no fuentes activas. Se dejan intactos en esta fase para no borrar evidencia o estado que pudiera ser útil.
- Se comprobó una copia idéntica de `update_facturacion.js` y `update_facturacion.cjs`; la copia `.js` ya se retiró. No se eliminan más archivos sin confirmar duplicación y referencias.

## Archivos encontrados en la raíz

| Archivo | Clasificación |
|---|---|
| `.t-busy.mjs` | Log, captura o temporal local |
| `add_estado_schema.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `add_fetch.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `add_historial_ui.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `add_kardex_server.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `clean_types.cjs` | Utilidad puntual histórica; no invocada por npm |
| `cuadre_dbg.txt` | Log, captura o temporal local |
| `dev-server.err.log` | Log, captura o temporal local |
| `dev-server.log` | Log, captura o temporal local |
| `fix_app.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_app_chat.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_app_chat_ui.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_fetchData.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_historial_state.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_import_sparkles.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_import_sparkles2.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_inventory_match.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_produccion.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_server.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_slashes.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `fix_types.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `generate_operaciones.cjs` | Utilidad puntual histórica; no invocada por npm |
| `import_sparkles.cjs` | Utilidad puntual histórica; no invocada por npm |
| `inventario_full.txt` | Log, captura o temporal local |
| `patch_chat.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_edit.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_estela.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_logistica.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_operaciones.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_operaciones_1.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_operaciones_2.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_operaciones_val.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_produccion.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_produccion_historial.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_server.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_server2.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_server3.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_server_put.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `patch_wizard_put.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `produccion_full.txt` | Log, captura o temporal local |
| `rewrite_inventario.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `server-console.log` | Log, captura o temporal local |
| `server-error.log` | Log, captura o temporal local |
| `server-run.err.log` | Log, captura o temporal local |
| `server-run.log` | Log, captura o temporal local |
| `server.log` | Log, captura o temporal local |
| `test_post.cjs` | Prueba manual histórica; no invocada por npm |
| `update_app.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_app2.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_app_chat.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_app_finanzas.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_app_layout.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_app_layout_script.js` | Generado vacío por `update_app_layout.cjs`; conservar |
| `update_clientes.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_fact_ui.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_facturacion.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_facturacion_logic.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_operaciones.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_produccion.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server2.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server3.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server_backend.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server_gastos.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server_hierarchy.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `update_server_produccion.cjs` | Parche de una sola vez (`fix/patch/update/rewrite/add`); no invocado por npm |
| `vis.err.log` | Log, captura o temporal local |
| `vis.log` | Log, captura o temporal local |
| `vite.log` | Log, captura o temporal local |
