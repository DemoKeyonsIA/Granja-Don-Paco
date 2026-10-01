const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf8');

const regex = /export type ExtractedData = \{[\s\S]*?\};/;
code = code.replace(regex, "");

fs.writeFileSync('src/types.ts', code);
