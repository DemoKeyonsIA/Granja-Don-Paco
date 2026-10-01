const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<div className="flex-1 overflow-y-auto p-4 space-y-4">[\s\S]*?<div className="bg-white border-t border-neutral-200 p-3 shrink-0">/;
const replacement = `<div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-bold text-neutral-800">Hola, soy Estela</h3>
                    <p className="text-sm text-neutral-500 mt-1 max-w-[200px]">Tu analista de operaciones. ¿En qué te ayudo hoy?</p>
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={\`flex \${msg.role === 'user' ? 'justify-end' : 'justify-start'}\`}>
                    <div className={\`max-w-[85%] p-3 rounded-2xl text-sm \${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-neutral-200 text-neutral-800 rounded-bl-none shadow-sm'}\`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {error && (
                <div className="bg-red-50 p-3 rounded-xl border border-red-200 text-sm flex items-start">
                  <Info className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </div>
            <div className="bg-white border-t border-neutral-200 p-3 shrink-0">`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('src/App.tsx', code);
    console.log("Replaced");
} else {
    console.log("Not found");
}

