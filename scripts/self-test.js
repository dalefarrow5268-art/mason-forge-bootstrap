const fs = require('fs');
const required = ['package.json','index.html','frontend/src/main.jsx','frontend/src/style.css','docs/MASON_FORGE_BOOTSTRAP.md','docs/IMPLEMENTATION_STEPS.md','config/stack.json'];
let missing = required.filter(f=>!fs.existsSync(f));
if(missing.length){console.error('Missing files:', missing); process.exit(1)}
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
if(!pkg.scripts?.dev || !pkg.scripts?.build || !pkg.scripts?.test){console.error('Missing required scripts'); process.exit(1)}
console.log('Mason Forge bootstrap self-test passed.');
