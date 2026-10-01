/**
 * Assertiva de respuesta HTTP para tests: en caso de error, lanza un mensaje
 * que incluye el body de la respuesta para diagnosticar rápido (sin necesidad
 * de agregar logs temporales cada vez que falla un 4xx/5xx).
 */
export function expectApi(res: any, status: number, msg?: string): void {
  if (res.status !== status) {
    const body = JSON.stringify(res.body ?? {});
    throw new Error(
      `${msg || 'API response'} — esperado ${status}, recibido ${res.status}\nBody: ${body}`,
    );
  }
}