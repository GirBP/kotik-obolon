// AST-кодмод: переносить спільний стан у core-модулі.
// - реассайнювані примітиви → state.X (безпечно: AST розрізняє ключі/властивості/тернар)
// - видаляє top-level декларації перенесених імен (CFG, toXY, ac, car, segments, …)
// - car = {…}  →  resetCar({…})
// - додає імпорти; лишає решту байт-у-байт (сплайси, без reprint)
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const FILE = 'src/main.js';
const src = readFileSync(FILE, 'utf8');

// відрізати старий dev-міст (перепишемо наприкінці)
const BRIDGE = '// ===== DEV-ТЕСТ-МІСТ';
const bi = src.indexOf(BRIDGE);
const body = bi >= 0 ? src.slice(0, bi) : src;

const STATE = new Set([
  'phase', 'roadsOnly', 'fuel', 'money', 'fuelType', 'churchCd', 'blessing',
  'job', 'jobMarker', 'sensPoi', 'selectedMode', 'handedMode', 'steerTarget',
  'steerActive', 'steerStartX', 'cruiseSet', 'curLanes', 'lastRoadHit', 'lastT',
  'radioNearType', 'mpEnabled', 'ctxAction', 'lowShown', 'curStreet', 'seqIdx', 'seqTimer',
]);
// імена, чиї top-level декларації видаляємо (перенесені в core), БЕЗ реассайну посилань
const MOVED_CONST = new Set([
  'car', 'input', 'segments', 'grid', 'GRID', 'stations', 'fuelMarks', 'churchMarks',
  'radio', 'hudCache', 'CFG', 'BRAND_PRICE', 'LPG_PRICE', 'GEARS_M', 'ENG', 'LANDMARKS',
  'MP_BROKERS', 'AC', 'ORG', 'MLAT', 'MLNG', 'torqueCurve', 'ac', 'bell', 'esc', 'toast',
  'bannerT', 'toXY', 'fromXY',
]);
const REMOVE_DECL = new Set([...STATE, ...MOVED_CONST]);

const ast = parse(body, { sourceType: 'module', ranges: true });

const deletes = []; // [start,end] цілих top-level декларацій
const edits = []; // {start,end,text}

// 1) top-level декларації на видалення
for (const node of ast.program.body) {
  if (node.type === 'VariableDeclaration') {
    const names = node.declarations.map((d) => d.id.name);
    const rm = names.filter((n) => REMOVE_DECL.has(n));
    if (rm.length === 0) continue;
    if (rm.length !== names.length)
      throw new Error(`ЗМІШАНА декларація (частину лишаємо): ${names.join(', ')}`);
    deletes.push([node.start, node.end]);
  } else if (node.type === 'FunctionDeclaration' && node.id && REMOVE_DECL.has(node.id.name)) {
    deletes.push([node.start, node.end]);
  }
}
const inDelete = (s) => deletes.some(([a, b]) => s >= a && s < b);

// 2) посилання STATE.X + car={} → resetCar()
let renameCount = 0,
  shorthandCount = 0,
  carResetCount = 0;
traverse(ast, {
  AssignmentExpression(path) {
    const n = path.node;
    if (n.operator === '=' && n.left.type === 'Identifier' && n.left.name === 'car') {
      if (inDelete(n.start)) return;
      edits.push({ start: n.start, end: n.right.start, text: 'resetCar(' });
      edits.push({ start: n.right.end, end: n.right.end, text: ')' });
      carResetCount++;
    }
  },
  Identifier(path) {
    const n = path.node;
    if (!STATE.has(n.name)) return;
    if (inDelete(n.start)) return;
    const p = path.parent;
    // .property у obj.name — пропускаємо
    if (p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    // ключ об'єкта { name: … } — пропускаємо (крім shorthand)
    const isObjKey =
      (p.type === 'ObjectProperty' || p.type === 'ObjectMethod' || p.type === 'Property') &&
      p.key === n &&
      !p.computed;
    if (isObjKey && !p.shorthand) return;
    if (isObjKey && p.shorthand) {
      // { name } → { name: state.name }
      edits.push({ start: n.start, end: n.end, text: `${n.name}: state.${n.name}` });
      shorthandCount++;
      return;
    }
    edits.push({ start: n.start, end: n.end, text: `state.${n.name}` });
    renameCount++;
  },
});

// 3) застосувати сплайси (видалення + правки), від кінця до початку
const ops = [
  ...deletes.map(([a, b]) => ({ start: a, end: b, text: '' })),
  ...edits,
].sort((x, y) => y.start - x.start || y.end - x.end);
let out = body;
let prevStart = Infinity;
for (const op of ops) {
  if (op.end > prevStart) throw new Error(`перекриття сплайсів на ${op.start}..${op.end}`);
  out = out.slice(0, op.start) + op.text + out.slice(op.end);
  prevStart = op.start;
}

// 4) імпорти + новий dev-міст
const imports =
  `import { CFG, BRAND_PRICE, LPG_PRICE, GEARS_M, ENG, torqueCurve, LANDMARKS, MP_BROKERS, GRID } from './core/config.js';\n` +
  `import { toXY, fromXY } from './core/geo.js';\n` +
  `import { ac, bell } from './core/audio.js';\n` +
  `import { esc, toast } from './core/dom.js';\n` +
  `import { state, input, car, resetCar, segments, grid, stations, fuelMarks, churchMarks, radio, hudCache } from './core/state.js';\n\n`;

const bridge =
  `\n// ===== DEV-ТЕСТ-МІСТ (Vite прибирає з прод-збірки: import.meta.env.DEV===false) =====\n` +
  `if (import.meta.env && import.meta.env.DEV) {\n` +
  `  window.__game = { startGame, startSequence, finishSequence, step, toast, fmToggle,\n` +
  `    laneChange, nearestRoad, toXY, fromXY, initGame, state, input, car, segments };\n` +
  `}\n`;

writeFileSync(FILE, imports + out + bridge, 'utf8');
console.log(
  `OK: ${deletes.length} декларацій видалено, ${renameCount} посилань → state.X, ` +
    `${shorthandCount} shorthand, ${carResetCount} car→resetCar`
);
