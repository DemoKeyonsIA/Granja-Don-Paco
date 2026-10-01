const http = require('http');

const data = JSON.stringify({
  nombre: 'Prueba',
  ubicacion: 'Lugar X',
  tipo_produccion: 'Producción de huevos, Producción de gallinaza',
  encargadoId: '1',
  galerones: []
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/granjas/wizard',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', e => console.error(e));
req.write(data);
req.end();
