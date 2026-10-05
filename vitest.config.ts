import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,

    /**
     * El pool se deja como venga (`forks`) a propósito.
     *
     * hay un flake real: una de cada tres `npm test` pierde a un worker con
     * "Worker exited unexpectedly". NO está arreglado, y conviene no confundir esto
     * con un problema del código bajo prueba. Lo que se verificó:
     *
     *   - No es la aplicación. El mismo recorrido de las 180 rutas registradas,
     *     hecho en un Node normal con `tsx`, termina con codigo 0 una y otra vez.
     *   - No es un handler ni un test concreto. Aislado cada bloque del smoke pasa;
     *     el crash necesita la acumulacion de GETs y POSTs del mismo archivo.
     *   - Es un fallo nativo, no de JavaScript. Con `threads` —donde los 42
     *     archivos comparten proceso— la corrida entera muere con 0xC0000409
     *     (stack buffer overrun) y 0xC0000005 (access violation), 2 de 5 veces.
     *     Con `forks` el hijo muere solo y Vitest sigue con los demas archivos.
     *   - El unico `.node` que carga la suite es `@libsql/win32-x64-msvc`, y cada
     *     archivo de test abre su propia base. Bajar `--maxWorkers` lo atenua poco
     *     (2 workers: 3/4 limpias; 4: 2/4) y `@libsql/client` 0.18.0 dio 5/6
     *     contra 4/6 de 0.17.4, que no alcanza a distinguirse del azar.
     *
     * Cerrarlo de verdad pide un stack nativo (un depurador sobre el proceso que
     * muere) o un reporte de la issue de libsql, no un cambio de configuracion.
     * Lo que sí ayuda y quedó en `tests/helpers/db.ts`: abrir la base con
     * `abrirClienteDePrueba`, que la cierra en `afterAll`.
     */
  },
});
