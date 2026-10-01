const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/import \{([^}]+)\} from "lucide-react";/, function(match, p1) {
    if (!p1.includes('Sparkles')) {
        return `import { \${p1}, Sparkles } from "lucide-react";`;
    }
    return match;
});

// Also remove unused subcomponents to keep it clean
const cleanAppCode = code.substring(0, code.indexOf("// --- Subcomponents ---"));
if (cleanAppCode.length > 100) {
    code = cleanAppCode;
}

fs.writeFileSync('src/App.tsx', code);
