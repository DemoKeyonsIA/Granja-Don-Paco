const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

const mainAreaTarget = `        <main className="flex-1 overflow-y-auto w-full overscroll-none">
        
        {activeTab === 'bot' && (`;

const mainAreaReplacement = `        <main className="flex-1 overflow-y-auto w-full overscroll-none">
        
        {activeTab === 'dashboard' && (
          <DashboardAdmin />
        )}
        {activeTab === 'bot' && (`;

if (content.includes(mainAreaTarget)) {
  content = content.replace(mainAreaTarget, mainAreaReplacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log("Component inserted");
} else {
  console.log("Main area not found");
}
