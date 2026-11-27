// 新旧の比較 (test19.js) と理論値の照合 (validate6.py) で使う形状のケース。
// キー名は validate6.py の理論式と対応している。 samples は、アプリのサンプルを読み込む操作。
const head = 'mode: 3d\ndomain: mechanical\nproject: {title: 形状, drawing_no: F-1, material: SS400, designer: a, drafter: b, date: 2026-11-25, rev: A}\nparts:\n';
const cases = {
  cr: head + '  - box: {name: p, size: [100, 50, 10], corner_radius: 8}\n',
  chamfer: head + '  - box: {name: p, size: [60, 40, 20], chamfer: 3, chamfer_bottom: 2}\n  - hole: {target: p, diameter: 8, at: [30, 20]}\n',
  blind: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 8, at: [15, 20], depth: 12}\n  - hole: {target: p, diameter: 6, at: [45, 20]}\n',
  cbore: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 6.6, at: [15, 20], cbore_d: 11, cbore_depth: 6.5}\n  - hole: {target: p, diameter: 6.6, at: [45, 20], cbore_d: 11, cbore_depth: 6.5, depth: 15}\n',
  csk: head + '  - box: {name: p, size: [60, 40, 20]}\n  - hole: {target: p, diameter: 5.5, at: [15, 20], csk_d: 10.4}\n  - hole: {target: p, diameter: 5.5, at: [45, 20], csk_d: 12, csk_angle: 120, depth: 14}\n',
  cyl: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], chamfer: 2, chamfer_bottom: 3}\n',
  combo: head + '  - box: {name: p, size: [120, 60, 12], corner_radius: 6}\n  - hole: {target: p, diameter: 6.6, at: [12, 12], cbore_d: 11, cbore_depth: 6.5}\n  - hole: {target: p, diameter: 5.5, at: [108, 48], csk_d: 10.4}\n  - hole: {target: p, diameter: 8, at: [60, 30], depth: 8}\n  - cylinder: {name: c, diameter: 16, height: 20, at: [85, 30, 12], chamfer: 1.5}\n',
  thread: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, thread: M6, at: [15, 20]}\n  - hole: {target: p, thread: M8, thread_depth: 8, depth: 13, at: [45, 20]}\n',
  tilt: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, diameter: 6, at: [20, 20], tilt: 30, tilt_dir: "+x"}\n  - hole: {target: p, diameter: 5, at: [45, 12], tilt: 20, tilt_dir: "+y"}\n',
  tilt2: head + '  - box: {name: p, size: [60, 40, 14]}\n  - hole: {target: p, diameter: 6, at: [40, 20], tilt: 25, tilt_dir: "-x"}\n  - hole: {target: p, diameter: 5, at: [20, 30], tilt: 40, tilt_dir: "-y"}\n',
  slotx: head + '  - box: {name: p, size: [60, 40, 14]}\n  - slot: {target: p, width: 8, length: 28, at: [30, 20], dir: x}\n',
  sloty: head + '  - box: {name: p, size: [60, 40, 14]}\n  - slot: {target: p, width: 6, length: 24, at: [30, 20], dir: y}\n  - hole: {target: p, diameter: 5, at: [8, 8]}\n',
  all: head + '  - box: {name: p, size: [100, 60, 14]}\n  - hole: {target: p, thread: M6, at: [15, 15]}\n  - hole: {target: p, diameter: 6, at: [50, 15], tilt: 30, tilt_dir: "+x"}\n  - slot: {target: p, width: 8, length: 28, at: [78, 30], dir: y}\n',
  ft: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 3}\n',
  fb: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet_bottom: 2}\n',
  both: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 3, fillet_bottom: 2}\n',
  mix: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], chamfer: 2, fillet_bottom: 3}\n',
  big: head + '  - cylinder: {name: c, diameter: 20, height: 30, at: [10, 10, 5], fillet: 9.5, fillet_bottom: 9.5}\n',
};
// アプリに内蔵のサンプル (形状は旧実装で作る立体そのまま)
const samples = { sample: null, asm: '#load-asm', feat: '#load-feat', holes: '#load-holes' };

// 干渉チェックのケース (test20.js)。 theory は、手計算できる重なりの体積 (なければ干渉なし = 0)
const proj = 'project: {title: 検証, drawing_no: T-1, designer: a, drafter: b, date: 2026-11-25, standard: JIS B 0001, general_tolerance: x, finish: Ra 6.3, due: 2026-12-01, rev: A}\n';
const boltAsm = (headD) => `mode: 3d\ndomain: mechanical\n${proj}components:\n  plate:\n    title: プレート\n    material: SS400\n    parts:\n      - box: {name: body, size: [40, 40, 12]}\n      - hole: {target: body, diameter: 6.6, at: [20, 20], cbore_d: 11, cbore_depth: 6.5}\n  bolt:\n    title: ボルト\n    material: S45C\n    parts:\n      - cylinder: {name: head, diameter: ${headD}, height: 6, at: [0, 0, 5.5], chamfer: 0.5}\n      - cylinder: {name: shank, diameter: 6.4, height: 20, at: [0, 0, -14.5]}\nassembly:\n  - {id: P1, part: plate}\n  - {id: B1, part: bolt, at: [20, 20, 0]}\n`;
const pinHole = (pinD) => head + `  - box: {name: a, size: [40, 40, 10]}\n  - hole: {target: a, diameter: 8, at: [20, 20]}\n  - cylinder: {name: c, diameter: ${pinD}, height: 20, at: [20, 20, 0]}\n`;
// ボルト頭 (φD・高さ 6・上端 C0.5) が、座ぐり φ11 (z 5.5〜12) に入る体積 = 半径が 5.5 を超える部分
const boltTheory = (D) => {
  const R = D / 2, n = 200000, z0 = 5.5, h = 6;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * h / n, r = z > z0 + h - 0.5 ? R - (z - (z0 + h - 0.5)) : R;
    if (r > 5.5) v += Math.PI * (r * r - 5.5 * 5.5) * h / n;
  }
  return v;
};
const lens = 10 * (200 * Math.acos(0.5) - 5 * Math.sqrt(300)); // 2 つの円柱 (φ20, 中心間 10) が z で 10 重なる
const interference = {
  'box-box': { yaml: head + '  - box: {name: a, size: [40, 40, 10]}\n  - box: {name: b, size: [20, 20, 10], at: [30, 30, 5]}\n', theory: { 'a|b': 10 * 10 * 5 } },
  'pin-hole-fat': { yaml: pinHole(10), theory: { 'a|c': Math.PI * (25 - 16) * 10 } },
  'pin-hole-clear': { yaml: pinHole(7.9), theory: {} },
  'face-contact': { yaml: head + '  - box: {name: a, size: [40, 40, 10]}\n  - cylinder: {name: c, diameter: 10, height: 10, at: [20, 20, 10]}\n', theory: {} },
  'lens': { yaml: head + '  - cylinder: {name: a, diameter: 20, height: 20, at: [0, 0, 0]}\n  - cylinder: {name: b, diameter: 20, height: 20, at: [10, 0, 10]}\n', theory: { 'a|b': lens } },
  'bolt-ok': { yaml: boltAsm(10.5), theory: {} },
  'bolt-hit': { yaml: boltAsm(11.5), theory: { 'P1/body|B1/head': boltTheory(11.5) } },
  // アプリのサンプル (組立) と、ピンを太くしたもの (穴 φ8 に φ8.4 → 1 本あたり π(4.2²-4²)·10)
  'asm': { btn: '#load-asm', theory: {} },
  'asm-fat-pin': { btn: '#load-asm', replace: ['diameter: 7.99', 'diameter: 8.4'], theory: { 'A1/body|A2/shaft': Math.PI * (4.2 * 4.2 - 16) * 10, 'A1/body|A3/shaft': Math.PI * (4.2 * 4.2 - 16) * 10 } },
};

// 部品ごとの融合のケース (test22.js)。 理論値は、融合の前 (立体ごとの合計)・後の体積と、後の表面積 (手計算)。
// parts: 部品の数 / solids: 融合のあとの立体の数 (離れた立体は別のまま)。 サンプルは、数と「前後で体積が変わらない」ことだけ確かめる
const cylV = (r, h) => Math.PI * r * r * h;
const frusV = (R, r, h) => (Math.PI * h / 3) * (R * R + R * r + r * r);
const cylChV = (r, h, c) => cylV(r, h) - (cylV(r, c) - frusV(r, r - c, c)); // 上端 C 面取り
const cylChA = (r, h, c) => 2 * Math.PI * r * (h - c) + Math.PI * r * r + Math.PI * (r - c) ** 2 + Math.PI * (2 * r - c) * c * Math.SQRT2;
const cboreThroughA = (d, D, cd, H) => { const r = d / 2, R = D / 2; return -Math.PI * R * R + Math.PI * D * cd + Math.PI * (R * R - r * r) + Math.PI * d * (H - cd) - Math.PI * r * r; };
const bodyV = 40 * 40 * 12 - (cylV(3.3, 12) + cylV(5.5, 6.5) - cylV(3.3, 6.5));
const bodyA = 2 * (1600 + 480 + 480) + cboreThroughA(6.6, 11, 6.5, 12);
const fusion = {
  'touch-boss': { yaml: head + '  - box: {name: a, size: [60, 40, 10]}\n  - cylinder: {name: c, diameter: 20, height: 15, at: [30, 20, 10]}\n',
    parts: 1, solids: 1, before: 24000 + cylV(10, 15), after: 24000 + cylV(10, 15), area: 2 * (2400 + 600 + 400) + 2 * Math.PI * 10 * 15 + Math.PI * 100 - Math.PI * 100 },
  'overlap-boxes': { yaml: interference['box-box'].yaml, parts: 1, solids: 1, before: 20000, after: 19500, area: 6000 },
  'overlap-cyl': { yaml: interference.lens.yaml, parts: 1, solids: 1, before: 2 * cylV(10, 20), after: 2 * cylV(10, 20) - lens },
  'disjoint': { yaml: head + '  - box: {name: a, size: [20, 20, 10]}\n  - box: {name: b, size: [20, 20, 10], at: [50, 0, 0]}\n', parts: 1, solids: 2, before: 8000, after: 8000, area: 3200, warn: true },
  'asm-bolt': { yaml: boltAsm(10.5), parts: 2, solids: 2,
    before: bodyV + cylChV(5.25, 6, 0.5) + cylV(3.2, 20), after: bodyV + cylChV(5.25, 6, 0.5) + cylV(3.2, 20),
    area: bodyA + cylChA(5.25, 6, 0.5) + (2 * Math.PI * 3.2 * 20 + 2 * Math.PI * 3.2 * 3.2) - 2 * Math.PI * 3.2 * 3.2 },
  'sample': { yaml: null, parts: 1, solids: 1, before: 50000 - 2 * cylV(4, 10) + cylV(10, 15), after: 50000 - 2 * cylV(4, 10) + cylV(10, 15),
    area: 2 * (5000 + 1000 + 500) + 2 * (-2 * Math.PI * 16 + Math.PI * 8 * 10) + 2 * Math.PI * 10 * 15 },
  'asm': { btn: '#load-asm', parts: 3, solids: 3 },
  'feat': { btn: '#load-feat', parts: 1, solids: 1 },
};
module.exports = { cases, samples, interference, fusion, head, boltAsm };
