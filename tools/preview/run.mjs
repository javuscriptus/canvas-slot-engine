import { SYMBOLS } from "../assets/symbols.mjs";
import { renderContactSheet } from "../assets/render.mjs";
const items = SYMBOLS.map(s => ({ name: s.key, svg: s.svg() }));
await renderContactSheet(items, "/tmp/symbols-preview.png", { columns: 6, cell: 200, bg: "#0A3C55" });
console.log("ok");
