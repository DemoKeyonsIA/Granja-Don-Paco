const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldMantenimientos = `
      await db.insert(mantenimientos).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha,
        tipo,
        descripcion,
        estado
      });
      res.status(201).json({ success: true });`;

const newMantenimientos = `
      await db.transaction(async (tx) => {
        await tx.insert(mantenimientos).values({
          id: crypto.randomUUID(),
          galeronId,
          fecha,
          tipo,
          descripcion,
          estado
        });
        
        // Actualizar la fecha del ultimo mantenimiento en el galeron
        await tx.update(galerones).set({ fecha_ultimo_mantenimiento: fecha }).where(eq(galerones.id, galeronId));
      });
      res.status(201).json({ success: true });`;

code = code.replace(oldMantenimientos, newMantenimientos);
fs.writeFileSync('server.ts', code);
