// Витягує ui/hud.js + 15 IIFE-систем у окремі файли.
// Для кожного блоку рахує ТОЧНІ імпорти через babel scope-аналіз (вільні ідентифікатори).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

// таблиця: ім'я → шлях модуля (відносно src/systems|ui/*)
const M = {
  '../core/config.js': ['CFG', 'BRAND_PRICE', 'LPG_PRICE', 'GEARS_M', 'ENG', 'torqueCurve', 'LANDMARKS', 'MP_BROKERS', 'GRID'],
  '../core/geo.js': ['toXY', 'fromXY'],
  '../core/audio.js': ['ac', 'bell'],
  '../core/dom.js': ['esc', 'toast'],
  '../core/tts.js': ['speakLines'],
  '../core/state.js': ['state', 'input', 'car', 'resetCar', 'segments', 'grid', 'stations', 'fuelMarks', 'churchMarks', 'radio', 'hudCache'],
  '../world/map.js': ['map', 'dist'],
  '../world/markers.js': ['poiIcon'],
  '../world/roads.js': ['buildRoads', 'nearestRoad'],
  '../world/pois.js': ['addPOIs'],
  '../ui/hud.js': ['updateHUD', 'rangeKm'],
  '../main.js': ['stopRadio'],
};
const NAME2MOD = {};
for (const [mod, names] of Object.entries(M)) for (const n of names) NAME2MOD[n] = mod;

const lines = readFileSync('src/main.js', 'utf8').split('\n');
const L = (a, b) => lines.slice(a - 1, b).join('\n'); // 1-indexed inclusive

// обчислити імпорти для тексту блоку
function importsFor(code, selfNames = []) {
  const ast = parse(code, { sourceType: 'module', ranges: true });
  const free = new Set();
  traverse(ast, {
    ReferencedIdentifier(path) {
      const n = path.node.name;
      if (NAME2MOD[n] && !selfNames.includes(n) && !path.scope.getBinding(n)) free.add(n);
    },
  });
  const byMod = {};
  for (const n of free) (byMod[NAME2MOD[n]] ||= []).push(n);
  return Object.entries(byMod)
    .sort()
    .map(([mod, ns]) => `import { ${ns.sort().join(', ')} } from '${mod}';`)
    .join('\n');
}

// walk-back: включити провідні коментарі/порожні рядки над IIFE
function headStart(start) {
  let s = start;
  while (s > 1) {
    const prev = lines[s - 2].trim();
    if (prev.startsWith('//') || prev === '') s--;
    else break;
  }
  return s;
}

mkdirSync('src/systems', { recursive: true });
mkdirSync('src/ui', { recursive: true });

// ---- ui/hud.js: rangeKm(236) + updateHUD(274-312) ----
const hudCode = L(236, 236) + '\n' + L(274, 312);
const hudImports = importsFor(hudCode, ['rangeKm', 'updateHUD']);
writeFileSync(
  'src/ui/hud.js',
  `// ================= HUD =================\n${hudImports}\n\n` +
    hudCode.replace('function rangeKm', 'export function rangeKm').replace('function updateHUD', 'export function updateHUD') +
    '\n'
);

// ---- системи ----
const SYS = [
  ['live', 907, 1221], ['save', 1242, 1427], ['traces', 1457, 2037],
  ['settings', 2048, 2169], ['police', 2205, 2321], ['lights', 2361, 2533],
  ['speed', 2560, 2727], ['peds', 2777, 2985], ['signs', 3017, 3208],
  ['audio', 3253, 3403], ['sfx', 3451, 3606], ['passengers', 3672, 4074],
  ['fmquests', 4118, 4386], ['progression', 4414, 4772], ['onboarding', 4832, 5005],
];
const ranges = []; // [start,end] для видалення з main
for (const [name, iifeStart, end] of SYS) {
  const start = headStart(iifeStart);
  const code = L(start, end);
  const imp = importsFor(code);
  writeFileSync('src/systems/' + name + '.js', (imp ? imp + '\n\n' : '') + code + '\n');
  ranges.push([start, end]);
}
// hud-функції теж видалити
ranges.push([274, 312]); // updateHUD
ranges.push([236, 236]); // rangeKm

// видалити з main.js (спадно за start), лишити маркер
ranges.sort((a, b) => b[0] - a[0]);
for (const [a, b] of ranges) lines.splice(a - 1, b - a + 1);

// export stopRadio (для циклічного імпорту SETTINGS)
for (let i = 0; i < lines.length; i++)
  if (lines[i].startsWith('function stopRadio')) { lines[i] = 'export ' + lines[i]; break; }

// вставити імпорти систем + hud після наявного import-блоку
let i = 0;
while (i < lines.length && (lines[i].startsWith('import ') || lines[i].trim() === '')) i++;
const sysImports =
  `import { updateHUD } from './ui/hud.js';\n` +
  SYS.map(([n]) => `import './systems/${n}.js';`).join('\n') +
  '\n';
lines.splice(i, 0, sysImports);
writeFileSync('src/main.js', lines.join('\n'));
console.log(`OK: ui/hud.js + ${SYS.length} систем витягнуто; main.js тепер ${lines.length} рядків`);
