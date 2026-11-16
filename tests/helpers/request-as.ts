import request from 'supertest';

/** Supertest request with the demo identity header expected by role middleware. */
export function requestAs(app: any, userId: string) {
  const agent: any = request(app);
  const authenticated: any = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
    authenticated[method] = (...args: any[]) => agent[method](...args).set('x-user-id', userId);
  }
  return authenticated;
}
