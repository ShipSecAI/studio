const fs = require('fs');

const FILE = 'frontend/src/pages/ChatInterface.tsx';
let content = fs.readFileSync(FILE, 'utf8');
let Math = global.Math;
let lines = content.split('\n');

// Wrap the main chat column
lines.splice(270, 0, '      {/* Main layout container */}');
lines.splice(271, 0, '      <div className="flex-1 flex overflow-hidden">');

// We shifted lines down by 2 so we compensate.
// Now look for RunInspectorSidePanel
let inspectorIndex = lines.findIndex(l => l.includes('<RunInspectorSidePanel />'));


lines.splice(inspectorIndex - 1, 0, '      </div>'); 

let closingDivIndex = lines.findIndex((l, i) => i > inspectorIndex && l.includes('</div>') && lines[i+2]?.includes('ChatCommandPalette'));
if (closingDivIndex !== -1) {
    lines.splice(closingDivIndex, 1);
}

fs.writeFileSync(FILE, lines.join('\n'));
console.log("Rewrote layout");
