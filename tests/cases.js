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
module.exports = { cases, samples };
