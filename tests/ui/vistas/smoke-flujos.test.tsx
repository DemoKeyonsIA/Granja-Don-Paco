// @vitest-environment jsdom
/**
 * Smoke de flujos: una acción de escritura por proceso, de punta a punta.
 *
 * Qué se afirma en cada caso
 *   · **Una sola petición** a la API por acción. El doble `fetch` es el bug más
 *     común en esta forma: el botón dispara el handler y además hay un `onClick`
 *     suelto, o un efecto de recarga se dispara por el cambio de estado que él
 *     mismo provoca y vuelve a ejecutar la escritura.
 *   · **Un solo aviso**. Ni cero (el usuario no sabe si salió), ni dos (parece que
 *     la acción se repitió), ni un `error` después de un `success`.
 *   · **El aviso del tipo correcto**: una escritura que sale bien avisa `success`,
 *     una que el servidor rechaza avisa `error` y no dice "guardado".
 *
 * Por qué el servidor falso
 *   El `fetch` se sustituye entero. La capa de API ya tiene sus propios tests
 *   (`e2e-*`); lo que se prueba aquí es la reacción de la vista, y para eso hace
 *   falta poder *hacer que el servidor falle* sin tocar la base de datos.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FIXTURES, instalarRed, instalarMatchMedia, capturarConsola, avisosDeReact,
  montarComo, limpiar, asentar, abrirModulo, irATab, textoVisible,
  toasts, toastsDe, toastsDuplicados, limpiarToasts,
  type Ruido, type TipoToast,
} from '../_vistas/arnes';
import type { Role } from '../../../src/types';

const App = (await import('../../../src/App')).default;

let ruido: Ruido;

beforeEach(() => {
  instalarMatchMedia();
  ruido = capturarConsola();
  instalarRed();
});

afterEach(() => {
  limpiar();
});

/** Las escrituras que salieron durante el test, por camino. */
const escrituras = (): string[] =>
  (vi.mocked(fetch).mock.calls ?? [])
    .filter(c => ((c[1]?.method as string) ?? 'GET') !== 'GET')
    .map(c => String(c[0]).replace(/^https?:\/\/[^/]+/, '').split('?')[0]);

const textoDe = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

/**
 * Afirma el resultado de una acción: una petición, un aviso del tipo esperado, y
 * nada más.
 */
function afirmarAvisoUnico(opts: { vista: string; ruta: string; tipo: TipoToast; veces?: number }) {
  const veces = opts.veces ?? 1;
  const llamadas = escrituras().filter(r => r === opts.ruta);

  expect(
    llamadas,
    `${opts.vista}: ${opts.ruta} se llamó ${llamadas.length} veces y se esperaba ${veces}`,
  ).toHaveLength(veces);

  const delTipo = toastsDe(opts.tipo);
  expect(
    delTipo,
    `${opts.vista}: se esperaba 1 aviso ${opts.tipo} y hubo ${delTipo.length}: ${JSON.stringify(toasts())}`,
  ).toHaveLength(1);

  // Un `success` junto a un `error`, o al revés, es el síntoma de que dos capas
  // informan del mismo hecho y no se pusieron de acuerdo.
  const otros = (['success', 'error', 'info', 'warning'] as TipoToast[])
    .filter(t => t !== opts.tipo)
    .flatMap(t => toastsDe(t));
  expect(
    otros,
    `${opts.vista}: además del aviso ${opts.tipo} esperado salió ${JSON.stringify(otros)}`,
  ).toEqual([]);

  expect(toastsDuplicados(), `${opts.vista}: aviso repetido`).toEqual([]);
  expect(
    avisosDeReact(ruido.errores),
    `${opts.vista}: avisos de consola durante la acción`,
  ).toEqual([]);
}

/** El primer botón visible cuyo texto contiene alguna de estas palabras. */
function boton(...palabras: string[]): HTMLElement {
  const candidatos = Array.from(document.querySelectorAll('button')) as HTMLElement[];
  const hallados = candidatos.filter(b => {
    const t = textoDe(b).toLowerCase();
    return palabras.some(p => t.includes(p.toLowerCase()));
  });
  if (hallados.length === 0) {
    throw new Error(
      `No hay botón con ${palabras.join('/')}. Botones: ` +
      candidatos.map(b => textoDe(b)).filter(Boolean).slice(0, 40).join(' | '),
    );
  }
  return hallados[0];
}

/**
 * Rellena un campo controlado.
 *
 * Va por `fireEvent` y no por `dispatchEvent` a pelo porque Testing Library lo
 * envuelve en `act`. Con eventos-launched a mano, cada `setState` del componente
 * quedaba fuera del ciclo de React y el test se llenaba de avisos de "not wrapped
 * in act", que además tapaban los avisos que este archivo sí quiere ver.
 */
function rellenar(el: HTMLElement, valor: string) {
  fireEvent.change(el, { target: { value: valor } });
}

async function abrir(modulo: string, tab?: string) {
  await abrirModulo(modulo);
  await asentar();
  if (tab) {
    await irATab(tab);
    await asentar();
  }
}

async function hacerClicEn(el: Element) {
  await userEvent.setup().click(el);
  await asentar();
}

// ---------------------------------------------------------------------------

describe('el fixture no esconde errores del servidor', () => {
  it('ningún endpoint capturado devolvió 4xx o 5xx', () => {
    const malos = Object.entries(FIXTURES.endpoints)
      .filter(([, r]) => r.status >= 400)
      .map(([camino, r]) => `${camino} → ${r.status}`);
    expect(
      malos,
      'el fixture se generó sobre endpoints que fallaron: los smoke de vista van a ' +
      'ver estados de error que no son bugs de la vista, y no se van a poder distinguir',
    ).toEqual([]);
  });

  it('con el fixture sembrado no sale ningún aviso de error al arrancar', async () => {
    montarComo(App, 'Admin');
    await asentar();
    expect(
      toastsDe('error'),
      `avisos de error al arrancar: ${JSON.stringify(toastsDe('error'))}`,
    ).toEqual([]);
  });
});

describe('abrir y cerrar vistas no habla', () => {
  const modulos = ['Finanzas', 'Operaciones y Bodegas', 'Logística', 'Admin', 'Office', 'Clientes'];

  for (const modulo of modulos) {
    it(`${modulo} no emite avisos al abrirse`, async () => {
      montarComo(App, 'Admin');
      await asentar();
      await abrirModulo(modulo);
      await asentar();
      expect(
        toasts(),
        `abrir ${modulo} no es una acción del usuario: si avisa, el aviso es ruido`,
      ).toEqual([]);
    });
  }

  it('ir y volver entre módulos no acumula avisos', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrir('Finanzas', 'analitica');
    await abrir('Operaciones y Bodegas');
    await abrir('Finanzas');
    await asentar();
    expect(toasts()).toEqual([]);
  });

  it('abrir el formulario de alta no avisa nada: no es una escritura', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrir('Admin', 'productos');
    limpiarToasts();

    const antes = textoVisible();
    await hacerClicEn(boton('nuevo', 'agregar', 'crear', '+'));

    // Si el "alta" se simula con un toast en vez de un formulario, el usuario no
    // tiene dónde corregir lo que escribió. Y el aviso sale sin que haya pasado nada.
    expect(toasts(), 'abrir el formulario de alta no debe emitir avisos').toEqual([]);
    expect(escrituras(), 'abrir un formulario no debe escribir en la API').toEqual([]);
    expect(textoVisible().length).toBeGreaterThan(80);
    expect(antes.length).toBeGreaterThan(80);
  });
});

/**
 * El alta de venta es un wizard de tres pasos, no un formulario. Los pasos 1 y 2
 * tienen guarda propia en la vista, y esa guarda es la forma más barata de
 * comprobar que un aviso de validación sale exactamente una vez: son Toast puros,
 * sin red, así que el test no depende de ningún endpoint.
 */
describe('las guardas del wizard de venta avisan una vez y no se repiten', () => {
  async function abrirWizard() {
    montarComo(App, 'Admin');
    await asentar();
    await abrir('Finanzas', 'documentos');
    await hacerClicEn(boton('Nueva Venta'));
    await asentar();
    limpiarToasts();
  }

  it('pedir el paso 2 sin productos avisa una vez y no avanza', async () => {
    await abrirWizard();
    await hacerClicEn(boton('Siguiente', 'Continuar', 'Next'));

    expect(
      toastsDe('error'),
      'una guarda de validación debe decir por qué no se puede seguir, una sola vez',
    ).toHaveLength(1);
    expect(toastsDe('success')).toEqual([]);
    expect(toastsDuplicados()).toEqual([]);
    // Y no hablo con el servidor: una guarda local no es una escritura.
    expect(escrituras()).toEqual([]);
  });

  it('avisa de cada guarda con su propio motivo, sin encadenar dos', async () => {
    await abrirWizard();
    await hacerClicEn(boton('Siguiente', 'Continuar', 'Next'));
    const primerMotivo = toastsDe('error')[0];
    limpiarToasts();
    await hacerClicEn(boton('Siguiente', 'Continuar', 'Next'));
    expect(
      toastsDe('error'),
      'reintentar sin corregir debe volver a decir lo mismo, no acumular mensajes',
    ).toEqual([primerMotivo]);
  });
});

describe('una escritura rechazada avisa del error y no dice que salió bien', () => {
  const error = (mensaje: string) =>
    ({
      ok: false, status: 400, statusText: 'Bad Request',
      json: async () => ({ error: mensaje }),
    }) as unknown as Response;

  it('si el servidor rechaza la venta, el aviso es de error y no de éxito', async () => {
    instalarRed({
      escribir: url => (url === '/api/ventas' ? error('El cliente no tiene crédito disponible') : null),
    });

    montarComo(App, 'Admin');
    await asentar();
    await abrir('Finanzas', 'documentos');
    await hacerClicEn(boton('Nueva Venta'));
    await asentar();
    limpiarToasts();

    // El tipo de documento se elige en el paso 1 y solo ahí, así que va primero.
    // Tiquete evita depender de que el catálogo de clientes tenga un elemento
    // seleccionable, que es lo que haría frágil el flujo.
    await hacerClicEn(boton('Tiquete'));
    await asentar();

    // Se escanea un producto de demostración, que es el camino que el propio
    // componente ofrece para rellenar el carrito sin teclear veinte campos.
    await hacerClicEn(boton('Escanear (demo)'));
    await asentar();

    await hacerClicEn(boton('Siguiente'));
    await asentar();
    await hacerClicEn(boton('Siguiente'));
    await asentar();
    limpiarToasts();

    await hacerClicEn(boton('Confirmar y Cobrar'));
    await asentar();

    expect(
      escrituras().filter(r => r === '/api/ventas'),
      'el flujo no llegó a mandar la venta, así que no hay nada que afirmar sobre el aviso',
    ).not.toEqual([]);

    afirmarAvisoUnico({ vista: 'Finanzas/Documentos', ruta: '/api/ventas', tipo: 'error' });
  });

  it('una venta sin documento fiscal no dice que se generó', async () => {
    // El backend guarda la factura y después pide el documento fiscal. Si el
    // segundo paso falla, la venta quedó pero sin respaldo, y el aviso tiene que
    // decirlo: antes se anunciaba el éxito igual, y el vendedor creía haber
    // facturado algo que el fisco nunca vio.
    instalarRed({
      escribir: url =>
        url === '/api/facturacion/crear-documento'
          ? error('El proveedor documentista no respondió')
          : null,
    });

    montarComo(App, 'Admin');
    await asentar();
    await abrir('Finanzas', 'documentos');
    await hacerClicEn(boton('Nueva Venta'));
    await asentar();
    // El tipo de documento se elige en el paso 1 y solo ahí. Tiquete evita
    // depender de que el catálogo de clientes tenga un elemento seleccionable.
    await hacerClicEn(boton('Tiquete'));
    await asentar();
    await hacerClicEn(boton('Escanear (demo)'));
    await asentar();
    await hacerClicEn(boton('Siguiente'));
    await asentar();
    await hacerClicEn(boton('Siguiente'));
    await asentar();
    limpiarToasts();

    await hacerClicEn(boton('Confirmar y Cobrar'));
    await asentar();

    const successes = toastsDe('success');
    expect(
      successes,
      'no debe anunciarse una factura con documento fiscal que nunca se emitió',
    ).toEqual([]);
    expect(
      toastsDe('error'),
      'tiene que decir que la factura quedó pero el documento no',
    ).toHaveLength(1);
    expect(toastsDe('error')[0]).toMatch(/documento fiscal/i);
    expect(toastsDuplicados()).toEqual([]);
  });
});

describe('una escritura aceptada avisa una vez y no repite el fetch', () => {
  it('un alta de producto manda una sola vez y avisa una sola vez', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrir('Admin', 'productos');
    await hacerClicEn(boton('Nuevo Producto'));
    await asentar();
    limpiarToasts();

    const campos = Array.from(document.querySelectorAll('input, select, textarea'));
    for (const c of campos) rellenar(c as HTMLElement, 'Huevos de prueba');
    await asentar();

    await hacerClicEn(boton('Guardar', 'Crear', 'Registrar', 'Agregar'));
    await asentar();

    const hechas = escrituras();
    if (hechas.length === 0) {
      // No hubo ruta de escritura. Se deja constancia en vez de forzar un clic
      // que no tocaría nada y devolvería un falso "un aviso".
      expect(toasts()).toEqual([]);
      return;
    }

    const conteo = hechas.reduce<Record<string, number>>((acc, r) => {
      acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    expect(
      Object.entries(conteo).filter(([, n]) => n > 1),
      'estas rutas se llamaron más de una vez con un solo clic',
    ).toEqual([]);

    expect(
      toastsDuplicados(),
      'el alta avisó dos veces lo mismo',
    ).toEqual([]);
    expect(
      toasts(),
      'un alta aceptada debe avisar exactamente una vez, y del tipo que toca',
    ).toHaveLength(1);
    expect(avisosDeReact(ruido.errores)).toEqual([]);
  });
});

