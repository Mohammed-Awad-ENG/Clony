import { analyzeAndProcessScripts } from './server/services/scriptAnalyzer.js';

const html = `<script type="module" src="../../_assets/b7e754b6fcef9bc3.js"></script>`;
const processed = analyzeAndProcessScripts(html);
console.log("PROCESSED HTML:");
console.log(processed);

