const fs = require('fs');
let content = fs.readFileSync('src/db/schema.ts', 'utf-8');

if (!content.includes("estado: text('estado').default('Activo')")) {
  content = content.replace(
    /encargadoId: text\('encargado_id'\)\.notNull\(\)\.references\(\(\) => users\.id\),/g,
    "encargadoId: text('encargado_id').notNull().references(() => users.id),\n  estado: text('estado').default('Activo'),"
  );

  content = content.replace(
    /estado_fisico: text\('estado_fisico'\)\.notNull\(\),/g,
    "estado_fisico: text('estado_fisico').notNull(),\n  estado: text('estado').default('Activo'),"
  );
  fs.writeFileSync('src/db/schema.ts', content);
  console.log("Schema updated");
}
