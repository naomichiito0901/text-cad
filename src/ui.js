/* =====================================================================
 * サンプル入力とUI
 * ===================================================================== */
const SAMPLES = {
  mechanical: `# 機械部品: 穴あきベースプレートと円柱ボス (単位 mm)
mode: 3d            # 工程2の表示: 2d (上面図) / 3d
domain: mechanical
project:            # 工程1: 案件情報
  title: ベースプレート
  drawing_no: BP-001
  material: SS400
  designer: 設計者A
  drafter: 作図者A
  date: 2026-11-25
  due: 2026-12-10
  paper: A3         # A3 / A4
  scale: auto       # auto または 1:2 など
  standard: JIS B 0001
  general_tolerance: JIS B 0405 中級
  finish: Ra 6.3    # 指示のない面の表面粗さ
  rev: A
  notes:
    - 指示なきC面取りは C0.5
    - バリ取りのこと
parts:              # 工程2: 形状
  - box: {name: base, size: [100, 50, 10], finish: Ra 1.6}
  - hole: {target: base, diameter: 8, at: [20, 25], fit: H7}
  - hole: {target: base, diameter: 8, at: [50, 25], fit: H7}
  - cylinder: {name: boss, diameter: 20, height: 15, at: [80, 25, 10]}
`,
  architecture: `# 建築: 6m x 4m の2室 (単位 mm)
mode: 2d            # 工程2の表示: 2d (平面図) / 3d
domain: architecture
project:            # 工程1: 案件情報
  title: 小住宅 平面計画
  drawing_no: AR-001
  material: 木造     # 構造
  designer: 設計者A
  drafter: 作図者A
  date: 2026-11-25
  due: 2026-12-10
  paper: A3          # A4 / A3 / A2 / A1
  scale: auto        # auto または 1:100 など
  standard: JIS A 0150
  rev: A
  notes:
    - 寸法は壁芯 (mm)
    - 壁厚 200、天井高 2400
thickness: 200      # 壁厚 (既定 200)
height: 2400        # 壁高さ (既定 2400)
floor: true         # 3D / IFC で床を出力
walls:              # 壁1〜4: 外壁 (南→東→北→西), 壁5: 間仕切り
  - [[0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]]
  - {from: [3000, 0], to: [3000, 4000]}
doors:              # wall=壁番号, position=壁の始点からの距離
  - {wall: 1, position: 1000, width: 900}
  - {wall: 5, position: 1500, width: 800, swing: right}
windows:
  - {wall: 3, position: 300, width: 2400}
  - {wall: 3, position: 3300, width: 1800}
  - {wall: 2, position: 1200, width: 1600}
rooms:              # 室名と位置 (面積・採光の確認に使います)
  - {name: リビング, at: [1500, 2000]}
  - {name: 洋室, at: [4500, 2000]}
`,
  electrical: `# 電気回路: 電池 + 抵抗 + LED
mode: 2d            # 電気回路は 2d のみ
domain: electrical
parts:              # at を省略すると左から順に並ぶ
  - {id: V1, type: battery, value: 5V}
  - {id: R1, type: resistor, value: 330}
  - {id: D1, type: led, value: Red}
wires:              # 部品ID.ピン名 (battery: + -, led: A K, 他: 1 2)
  - [V1.+, R1.1]
  - [R1.2, D1.A]
  - [D1.K, V1.-]
`,
};
const SAMPLE_ASM = `# 機械部品(組立): ベースプレートに位置決めピン2本を挿入 (単位 mm)
mode: 3d
domain: mechanical
project:
  title: ピン付きプレート組立
  drawing_no: AS-001
  designer: 設計者A
  drafter: 作図者A
  date: 2026-11-25
  due: 2026-12-10
  paper: A3
  standard: JIS B 0001
  general_tolerance: JIS B 0405 中級
  finish: Ra 6.3
  rev: A
  notes:
    - ピンは軽く圧入すること
components:         # 部品定義 (品番は上から 1, 2, ...)
  plate:
    title: ベースプレート
    material: SS400
    parts:
      - box: {name: body, size: [100, 50, 10], finish: Ra 1.6}
      - hole: {target: body, diameter: 8, at: [20, 25], fit: H7}
      - hole: {target: body, diameter: 8, at: [80, 25], fit: H7}
  pin:
    title: 位置決めピン
    material: S45C
    parts:
      - cylinder: {name: shaft, diameter: 7.99, height: 20, tol: g6}
assembly:           # 配置: id / part / at: [x, y, z] / rotate: 0|90|180|270 (Z軸まわり)
  - {id: A1, part: plate}
  - {id: A2, part: pin, at: [20, 25, -5]}
  - {id: A3, part: pin, at: [80, 25, -5]}
sections:           # 断面図: ピンと穴の組み合わせ (部品ごとにハッチの向きが変わります)
  - {plane: y, at: 25}
`;
const SAMPLE_FEAT = `# 機械部品(形状): 角R・座ぐり・皿穴・止まり穴・面取り (単位 mm)
mode: 3d
domain: mechanical
project:
  title: 取付ブラケット
  drawing_no: BK-001
  material: A5052
  designer: 設計者A
  drafter: 作図者A
  date: 2026-11-25
  due: 2026-12-10
  paper: A3
  standard: JIS B 0001
  general_tolerance: JIS B 0405 中級
  finish: Ra 6.3
  rev: A
  notes:
    - 指示なきC面取りは C0.5
    - 角R は 4 箇所とも同寸
parts:
  - box: {name: plate, size: [120, 60, 12], corner_radius: 6, finish: Ra 1.6}     # 角R (フィレット)
  - hole: {target: plate, diameter: 6.6, at: [14, 14], cbore_d: 11, cbore_depth: 6.5}     # 座ぐり
  - hole: {target: plate, diameter: 6.6, at: [106, 14], cbore_d: 11, cbore_depth: 6.5}
  - hole: {target: plate, diameter: 5.5, at: [14, 46], csk_d: 10.4, csk_angle: 90}        # 皿穴
  - hole: {target: plate, diameter: 5.5, at: [106, 46], csk_d: 10.4, csk_angle: 90}
  - hole: {target: plate, diameter: 8, at: [45, 30], depth: 8, fit: H7}                   # 止まり穴
  - cylinder: {name: boss, diameter: 20, height: 22, at: [80, 30, 12], chamfer: 2}        # 端面の面取り
  - cylinder: {name: knob, diameter: 10, height: 14, at: [60, 30, 12], fillet: 2.5}       # 端面のフィレット
sections:           # 断面図: y=14 (座ぐり穴を通る) と y=30 (止まり穴・ボスを通る)
  - {plane: y, at: 14}
  - {plane: y, at: 30}
`;
const SAMPLE_HOLES = `# 機械部品(穴): ねじ穴・斜め穴・長穴 (単位 mm)
mode: 3d
domain: mechanical
project:
  title: 取付プレート
  drawing_no: HP-001
  material: SS400
  designer: 設計者A
  drafter: 作図者A
  date: 2026-11-25
  due: 2026-12-10
  paper: A3
  standard: JIS B 0001
  general_tolerance: JIS B 0405 中級
  finish: Ra 6.3
  rev: A
  notes:
    - ねじは並目ねじ。下穴は表の値
parts:
  - box: {name: plate, size: [100, 60, 14], finish: Ra 1.6}
  - hole: {target: plate, thread: M6, at: [15, 15]}                                   # ねじ穴 (貫通・下穴は自動)
  - hole: {target: plate, thread: M8, thread_depth: 8, depth: 13, at: [15, 45]}      # ねじ穴 (止まり)
  - hole: {target: plate, diameter: 6, at: [50, 15], tilt: 30, tilt_dir: '+x', fit: H8}   # 斜め穴
  - hole: {target: plate, diameter: 5, at: [50, 45], tilt: 20, tilt_dir: '+y'}
  - slot: {target: plate, width: 8, length: 28, at: [78, 30], dir: y}                 # 長穴
sections:           # y=15 (ねじ穴と斜め穴を通る) / x=78 (長穴を長手方向に切る)
  - {plane: y, at: 15}
  - {plane: x, at: 78}
`;
const HELP = {
  mechanical: `project:  title / drawing_no / material / designer / drafter / date / due
          paper(A3|A4) / scale(auto|1:2) / standard / general_tolerance
          finish / rev / notes(- 注記)
box:      {name, size: [幅, 奥行, 高さ], at: [x, y, z], tol, finish,
           corner_radius: 角R, chamfer: 上面外周のC, chamfer_bottom: 下面のC}
cylinder: {name, diameter, height, at: [x, y, z], tol, finish,
           chamfer: 上端のC, chamfer_bottom: 下端のC,
           fillet: 上端のR, fillet_bottom: 下端のR}  (at は底面中心。同じ端に C と R は併用不可)
hole:     {target: box名, diameter, at: [x, y], fit: H7, tol}   (上面から。box 左下基準)
          depth: 止まり穴の深さ / cbore_d + cbore_depth: 座ぐり
          csk_d + csk_angle(既定90): 皿穴  (省略時は貫通穴)
          thread: M6 (+ thread_depth): ねじ穴 (diameter 省略で下穴径)
          tilt: 角度(60以下) + tilt_dir: +x|-x|+y|-y : 斜め穴(貫通のみ)
slot:     {target: box名, width: 幅, length: 全長, at: [中心x, 中心y], dir: x|y}  (貫通の長穴)
sections: auto または [{plane: y, at: 30}]  (A-A断面図。y=at で切り手前から / x=at で切り右から)
dimensions: none で寸法記入を止められます (検図でエラーになります)
組立: parts: の代わりに components:(部品定義: title/material/parts)と
      assembly:(配置: id/part/at/rotate)を書くと、組立図・部品図・部品表を作ります。`,
  architecture: `project:  title / drawing_no / material(構造) / designer / drafter / date / due
          paper(A4|A3|A2|A1) / scale(auto|1:100) / standard / rev / notes
walls:    [[x,y],[x,y],...] (連続した壁) / {from, to, thickness}
doors:    {wall, position, width, height, hinge: start|end, swing: left|right}
windows:  {wall, position, width, sill, height}
rooms:    {name, at: [x, y]}    (面積・採光・出入口を確認)
thickness / height / floor / text_height / dimensions: none
elevations: [S, N, E, W] (立面図を作る向き。false で作らない。既定: すべて)`,
  electrical: `type: resistor / capacitor / battery / led / switch / lamp
parts:  {id, type, value, at: [x, y]}   (at 省略可)
wires:  [A, B] または {from, to, route: top|bottom|direct}
ピン名: battery は + -、led は A K、その他は 1 2。例: R1.1`,
};
const STEPS = [
  { n: 1, name: '要件確認' }, { n: 2, name: 'モデリング' }, { n: 3, name: '干渉チェック' },
  { n: 4, name: '図面化' }, { n: 5, name: '検図' }, { n: 6, name: '納品・改訂' },
];

const $ = (id) => document.getElementById(id);
const ed = $('editor'), errBox = $('error'), statusEl = $('status'), helpEl = $('help');
const panel = $('panel'), resultbar = $('resultbar'), stepsEl = $('steps');
const texts = Object.assign({}, SAMPLES);
const store = { history: [], approval: null, pendingNote: '' };
let slot = 'mechanical', cur = null, wf = null, dwgIdx = 0, step = 1, lastView = '', fitNext = true, timer = 0, flash = '';
let curDomain = 'mechanical', curMode = '3d';

/* ---------- 保存 (ブラウザ内 localStorage / 案件ファイル) ---------- */
const KEY = 'cadtext.project.v2';
const snapshot = () => ({ format: 'cadtext-project', version: 2, slot, texts, history: store.history, approval: store.approval, pendingNote: store.pendingNote });
function persist() { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { /* 保存できない環境では無視 */ } }
function restore(d) {
  if (!d || d.format !== 'cadtext-project') return false;
  Object.keys(SAMPLES).forEach((k) => { if (typeof d.texts?.[k] === 'string') texts[k] = d.texts[k]; });
  store.history = Array.isArray(d.history) ? d.history : [];
  store.approval = d.approval || null;
  store.pendingNote = d.pendingNote || '';
  if (SAMPLES[d.slot]) slot = d.slot;
  return true;
}
try { const raw = localStorage.getItem(KEY); if (raw) restore(JSON.parse(raw)); } catch (e) { /* 無視 */ }

/* ---------- ワークフロー計算 (分野ごとのアダプタ) ---------- */
const WF_DOMAINS = new Set(['mechanical', 'architecture']);
const LICENSES = ($('licenses-text') ? $('licenses-text').textContent : '').trim();
$('about-open').addEventListener('click', () => { $('about-text').textContent = LICENSES; $('about').showModal(); });
const baseOf = (project) => `${(project.drawing_no || 'drawing').replace(/[^\w.-]+/g, '_')}_Rev${project.rev || 'X'}`;
function revRowsOf(project) {
  const rows = store.history.map((h) => ({ rev: h.rev, date: h.date, note: h.note }));
  if (!store.history.some((h) => h.rev === project.rev)) rows.push({ rev: project.rev || '-', date: todayStr(), note: store.pendingNote || '初版' });
  return rows;
}
const mkExports = (base, project, rules, drawing, extra, bom, scale3d) => [
  ...extra,
  { id: 'report', label: '検図レポート', name: `${base}_inspection-report.md`, mime: 'text/markdown', data: () => checkReport({ project, rules, drawing, bom, noProj: scale3d }, store.approval, store.history) },
  { id: 'yaml', label: '案件 YAML', name: `${base}_project.yaml`, mime: 'text/yaml', data: () => ed.value },
];
function buildMechWF(spec, scene) {
  const mech = parseMech(spec), project = parseProject(spec), solids = solidsOf(mech);
  const asm = mech.assembly || null;
  const interference = checkInterference(solids);
  const revRows = revRowsOf(project);
  const secs = parseSections(spec, solids);
  let drawings, bom = null, mechs;
  if (asm) {
    bom = buildBOM(asm);
    const balloons = asm.defs.map((d) => ({ n: d.n, names: solids.filter((o) => asm.insts.some((i) => i.part === d.key && i.id === o.inst)).map((o) => o.name) }));
    drawings = [{ key: 'asm', label: '組立図', suffix: '_asm', d: buildDrawing(solids, project, revRows, { bom, balloons, cuts: secs }) }];
    asm.defs.forEach((def) => {
      const pj = { ...project, title: def.title, material: def.material, drawing_no: def.drawing_no || `${project.drawing_no}-${def.n}` };
      drawings.push({ key: def.key, label: `部品図 ${def.n}: ${def.title}`, suffix: `_part${def.n}-${def.key}`, d: buildDrawing(solidsOf(def.mech), pj, revRows) });
    });
    mechs = asm.defs.map((d) => d.mech);
  } else {
    drawings = [{ key: 'main', label: '図面', suffix: '', d: buildDrawing(solids, project, revRows, { cuts: secs }) }];
    mechs = [mech];
  }
  secs.forEach((sec) => drawings.push({ key: `sec${sec.label}`, label: `断面図 ${sec.label}-${sec.label}`, suffix: `_sec${sec.label}`, d: buildSectionDrawing(solids, project, revRows, sec, !!asm) }));
  const rules = runChecks({ project, mechs, solids, interference, drawings, asmInfo: asm });
  const meshes = scene.kind === '3d' ? scene.meshes : build3dMech(spec).meshes;
  const hot = new Set();
  interference.hits.forEach((h) => { hot.add(h.a); hot.add(h.b); });
  const base = baseOf(project), d0 = drawings[0].d;
  const kind = asm ? 'asm' : 'single';
  const holes = mech.boxes.reduce((n, b) => n + b.holes.length, 0);
  return {
    domain: 'mechanical', spec, project, solids, drawings, drawing: d0, rules, meshes, hash: hashSpec(spec), asm, bom,
    reqKind: kind, projText: ' / 第三角法',
    info1ok: requiredKeys(kind).every((k) => project[k]) && (!asm || asm.defs.every((x) => x.material)),
    btn: { m3: ['dl-step', 'dl-stl'], m2: ['dl-dxf', 'dl-svg', 'dl-step'] },
    status2d: (b) => `上面図 / 範囲 ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)}`,
    status3d: `立体 / 部品 ${solids.length} 個 / 範囲 ${fmt(d0.bbox.W)} × ${fmt(d0.bbox.D)} × ${fmt(d0.bbox.H)}`,
    step3: {
      label: '干渉', hot, okText: `全部品の組み合わせ(${solids.length} 部品)を確認しました`,
      note: '※ 干渉は形状の重なり(体積)で判定します。面が接しているだけの場合は干渉になりません。動作確認・CAE 解析は対象外です。',
      items: [
        ...interference.hits.map((h) => ({ sev: 'error', text: `${h.a} × ${h.b} (重なり 約 ${Math.round(h.volume).toLocaleString('ja-JP')} mm³ / 厚み ${fmt(h.dz)} mm)` })),
        ...(interference.floating.length ? [{ sev: 'warn', text: `他の部品と接していない: ${interference.floating.join('、')}` }] : []),
      ],
    },
    summaryHTML: () => `${asm ? `<h3>部品表(組立)</h3><table class="grid"><thead><tr><th>品番</th><th>部品名</th><th>材質</th><th>図番</th><th>数量</th></tr></thead><tbody>${bom.map((r) => `<tr><td>${r.no}</td><td>${E(r.title)}</td><td>${r.material ? E(r.material) : '<span class="chip ng">未記入</span>'}</td><td>${E(r.drawing_no || `${project.drawing_no || '?'}-${r.no}`)}</td><td>${r.qty}</td></tr>`).join('')}</tbody></table>
      <p class="muted">配置: ${asm.insts.map((i) => `${E(i.id)}=${E(i.part)}${i.rotate ? ` (${i.rotate}°)` : ''}`).join(' / ')}</p>` : ''}
      <h3>形状サマリ</h3><p>直方体 ${mech.boxes.length} / 円柱 ${mech.cyls.length} / 穴 ${holes} ／ 外形 ${fmt(d0.bbox.W)} × ${fmt(d0.bbox.D)} × ${fmt(d0.bbox.H)} mm</p>`,
    exports: mkExports(base, project, rules, d0, [
      { id: 'step', label: '3D STEP', name: `${base}_model.step`, mime: 'model/step', data: () => toSTEP(solids, project, `${base}_model.step`) },
      { id: 'stl', label: '3D STL', name: `${base}_model.stl`, mime: 'model/stl', data: () => toSTL(meshes) },
      ...(bom ? [{ id: 'bom', label: '部品表 CSV', name: `${base}_bom.csv`, mime: 'text/csv', data: () => bomCSV(bom, project) }] : []),
    ], bom, false),
    zipDesc: `全図面の DXF / SVG(印刷してPDF化可) / 3D モデル STEP・STL${bom ? ' / 部品表 CSV' : ''} / 検図レポート / 案件ファイル(YAML) / 改訂履歴`,
    readme: `- .dxf  : 図面 (用紙サイズ=1:1, 単位 mm / AutoCAD R12 形式)。組立の場合は _asm=組立図, _partN=部品図\n- .svg  : 図面 (ブラウザで開いて印刷→PDF保存できます)\n${bom ? '- _bom.csv : 部品表\n' : ''}- _model.step : 3D モデル (STEP AP214 / 他の CAD・CAM に取り込めます)\n- _model.stl : 3D モデル (メッシュ)\n- _inspection-report.md : 検図レポート\n- _project.yaml : 案件ファイル (再生成用)\n`,
    revHint: '例: 穴径 φ8 → φ9',
  };
}
function buildArchWF(spec, scene) {
  const a = parseArch(spec), project = parseProject(spec);
  const sched = buildSchedule(a), an = analyzeArch(a), revRows = revRowsOf(project);
  const drawings = archDrawings(spec, a, an, sched, project, revRows);
  const rules = runArchChecks({ project, a, an, drawings, sched });
  const meshes = scene.kind === '3d' ? scene.meshes : build3dArch(spec).meshes;
  const integ = archIntegrity(a, an, rules), csv = archCSVs(sched, an);
  const base = baseOf(project), d0 = drawings[0].d;
  const nDoor = a.walls.reduce((t, w) => t + w.open.filter((o) => o.kind === 'door').length, 0), nWin = a.walls.reduce((t, w) => t + w.open.filter((o) => o.kind === 'window').length, 0);
  const roomRows = an.rooms.map((r) => `<tr><td>${E(r.name || '-')}</td><td>${r.enclosed ? `${r.area.toFixed(2)} ㎡${r.exact ? '' : ' (概算)'}` : '<span class="chip ng">囲まれていません</span>'}</td><td>${r.enclosed ? r.window.toFixed(2) + ' ㎡' : '—'}</td><td>${r.enclosed && isHabitable(r.name) ? (r.lighting >= 1 / 7 ? `<span class="chip ok">✓ 1/${r.lighting ? (1 / r.lighting).toFixed(1) : '—'}</span>` : `<span class="chip warn">不足 1/${r.lighting ? (1 / r.lighting).toFixed(1) : '∞'}</span>`) : '<span class="muted">対象外</span>'}</td><td>${r.enclosed ? r.doors : '—'}</td></tr>`).join('');
  return {
    domain: 'architecture', spec, project, drawings, drawing: d0, rules, meshes, hash: hashSpec(spec), asm: null, bom: null,
    reqKind: 'arch', projText: '',
    info1ok: requiredKeys('arch').every((k) => project[k]),
    btn: { m3: ['dl-ifc', 'dl-stl'], m2: ['dl-dxf', 'dl-svg', 'dl-ifc'] },
    status2d: (b) => `平面図 / 範囲 ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} / 床面積 ${an.totalArea.toFixed(2)} ㎡`,
    status3d: `立体 / 壁 ${a.walls.length} / 扉 ${nDoor} / 窓 ${nWin} / 室 ${an.rooms.length}`,
    step3: { label: '不整合', hot: integ.hot, okText: integ.okText, note: '※ 壁の重複・室の囲い・扉の開き領域・採光などの整合を確認します。構造・防火・避難などの法規適合は対象外です。', items: integ.items },
    summaryHTML: () => `<h3>室と面積</h3>${an.rooms.length ? `<table class="grid"><thead><tr><th>室名</th><th>面積</th><th>窓面積</th><th>採光(1/7以上)</th><th>扉</th></tr></thead><tbody>${roomRows}</tbody></table><p class="muted">延べの室面積 ${an.totalArea.toFixed(2)} ㎡ (壁の内法)。居室: 洋室・和室・リビング・寝室など</p>` : '<p class="muted">rooms: に {name, at: [x, y]} を書くと面積・採光を確認できます。</p>'}
      <h3>建具</h3><p>扉 ${nDoor} / 窓 ${nWin} ／ 記号: ${sched.map((r) => `${r.mark}(${nf(r.width)}×${nf(r.height)}) ×${r.qty}`).join(' / ') || '—'}</p>`,
    exports: mkExports(base, project, rules, d0, [
      { id: 'ifc', label: 'IFC (BIM)', name: `${base}_model.ifc`, mime: 'application/x-step', data: () => toIFC(a, an, project, `${base}_model.ifc`) },
      { id: 'stl', label: '3D STL', name: `${base}_model.stl`, mime: 'model/stl', data: () => toSTL(meshes) },
      { id: 'schedule', label: '建具表 CSV', name: `${base}_schedule.csv`, mime: 'text/csv', data: () => csv.schedule },
      { id: 'rooms', label: '室面積表 CSV', name: `${base}_rooms.csv`, mime: 'text/csv', data: () => csv.rooms },
    ], null, true),
    zipDesc: '平面図・立面図の DXF / SVG(印刷してPDF化可) / IFC(BIM) / 3D STL / 建具表・室面積表 CSV / 検図レポート / 案件ファイル(YAML) / 改訂履歴',
    readme: '- _plan / _elevN,S,E,W : 平面図・立面図 (.dxf=用紙サイズ1:1 mm, .svg=印刷してPDF保存可)\n- _model.ifc : BIM モデル (IFC4。壁・開口・扉・窓・室・床)\n- _model.stl : 3D モデル (メッシュ)\n- _schedule.csv / _rooms.csv : 建具表・室面積表\n- _inspection-report.md : 検図レポート\n- _project.yaml : 案件ファイル (再生成用)\n',
    revHint: '例: 窓W1の幅 1800 → 2400',
  };
}
function buildWorkflow(spec, scene) { return scene.domain === 'architecture' ? buildArchWF(spec, scene) : buildMechWF(spec, scene); }
const approvalValid = () => !!(wf && store.approval && store.approval.hash === wf.hash);
const delivered = () => wf && store.history.find((h) => h.rev === wf.project.rev);
const errorsOf = () => wf.rules.filter((r) => !r.ok && r.sev === 'error');
const warnsOf = () => wf.rules.filter((r) => !r.ok && r.sev === 'warn');
const reqKeys = () => requiredKeys(wf ? wf.reqKind : 'single');
function stepStatus(n) {
  if (!wf) return '';
  if (n === 1) return wf.info1ok ? 'ok' : 'ng';
  if (n === 2) return 'ok';
  if (n === 3) return wf.step3.items.some((i) => i.sev === 'error') ? 'ng' : 'ok';
  if (n === 4) return wf.rules.filter((r) => ['E02', 'E04'].includes(r.id)).every((r) => r.ok) ? 'ok' : 'ng';
  if (n === 5) return approvalValid() ? 'ok' : (errorsOf().length ? 'ng' : 'wait');
  if (n === 6) { const d = delivered(); return d && d.hash === wf.hash ? 'ok' : 'wait'; }
  return '';
}

/* ---------- 画面の切り替え ---------- */
function showPanels(which) {
  $('wrap2d').hidden = which !== '2d';
  $('wrap3d').hidden = which !== '3d';
  panel.hidden = which !== 'panel';
  if (which === '3d') resize3d();
}
function setButtons(list) {
  ['dl-dxf', 'dl-svg', 'dl-print', 'dl-step', 'dl-ifc', 'dl-stl'].forEach((id) => { $(id).hidden = !list.includes(id); });
}
function setTabs() {
  document.querySelectorAll('[data-domain]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.domain === curDomain)));
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === curMode)));
  const flow = WF_DOMAINS.has(curDomain);
  stepsEl.hidden = !flow;
  $('load-asm').hidden = curDomain !== 'mechanical';
  $('load-feat').hidden = curDomain !== 'mechanical';
  $('load-holes').hidden = curDomain !== 'mechanical';
  $('mode-group').hidden = flow && step !== 2;
  stepsEl.querySelectorAll('[data-step]').forEach((b) => {
    const n = +b.dataset.step, st = stepStatus(n);
    b.setAttribute('aria-current', String(n === step));
    b.dataset.st = st;
    b.querySelector('.mark').textContent = st === 'ok' ? '✓' : st === 'ng' ? '!' : st === 'wait' ? '…' : '';
  });
}
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('ja-JP');
function setError(msg) {
  errBox.textContent = msg || '';
  errBox.hidden = !msg;
  document.querySelector('.preview').classList.toggle('stale', !!msg);
}
function view2d(prims, id) {
  showPanels('2d');
  svg.innerHTML = svgBody(prims);
  if (fitNext || lastView !== id) fit2d(prims);
  lastView = id;
}
function view3d(meshes, id, hot) {
  if (!V.ok && !init3d()) { setError('このブラウザでは WebGL が使えないため 3D 表示できません (2D は利用できます)'); showPanels('panel'); panel.innerHTML = '<p class="muted">3D 表示には WebGL が必要です。</p>'; return false; }
  showPanels('3d');
  show3d(meshes, fitNext || lastView !== id, hot);
  lastView = id;
  return true;
}

/* ---------- 各工程パネル ---------- */
const E = esc;
const chip = (ok, okText, ngText, cls = 'ng') => (ok ? `<span class="chip ok">✓ ${E(okText)}</span>` : `<span class="chip ${cls}">${E(ngText)}</span>`);
function panel1() {
  const P = wf.project, d = wf.drawing;
  const rows = PROJECT_FIELDS.filter(([k]) => !(wf.domain === 'architecture' && ['general_tolerance', 'finish'].includes(k))).map(([k, label]) => {
    const req = reqKeys().includes(k), v = P[k];
    const lab = wf.domain === 'architecture' && k === 'material' ? '構造' : label;
    return `<tr><th>${E(lab)}</th><td>${v ? E(v) : '<span class="muted">—</span>'}</td><td>${req ? '<span class="tag">必須</span>' : '<span class="tag soft">推奨</span>'}</td><td>${v ? '<span class="chip ok">✓</span>' : `<span class="chip ${req ? 'ng' : 'warn'}">未記入</span>`}</td></tr>`;
  }).join('');
  return `<h2>工程1 要件・案件情報の確認</h2>
  <p class="muted">指示書の内容を、左の入力欄の <code>project:</code> に記入します。必須項目が揃うと次工程へ進めます。</p>
  <table class="grid"><thead><tr><th>項目</th><th>内容</th><th></th><th>状態</th></tr></thead><tbody>${rows}
  <tr><th>用紙 / 尺度</th><td>${E(P.paper)} / ${E(scaleText(d.scale))}${P.scale === 'auto' ? ' (自動)' : ''}</td><td></td><td></td></tr>
  <tr><th>注記</th><td>${P.notes.length ? P.notes.map(E).join('<br>') : '<span class="muted">—</span>'}</td><td><span class="tag soft">推奨</span></td><td>${P.notes.length ? '<span class="chip ok">✓</span>' : '<span class="chip warn">未記入</span>'}</td></tr></tbody></table>
  ${wf.summaryHTML()}
  <p><button class="primary" data-goto="2">次へ: モデリング</button></p>`;
}
function panel5() {
  const rules = wf.rules, errs = errorsOf(), warns = warnsOf();
  const group = (title, sev) => {
    const rs = rules.filter((r) => r.sev === sev);
    return `<h3>${title}</h3><table class="grid">${rs.map((r) => `<tr class="${r.ok ? '' : 'row-' + sev}"><td class="c">${r.ok ? '<span class="chip ok">✓</span>' : `<span class="chip ${sev === 'error' ? 'ng' : sev === 'warn' ? 'warn' : 'info'}">${sev === 'error' ? 'NG' : sev === 'warn' ? '警告' : '指摘'}</span>`}</td><td class="id">${r.id}</td><td>${E(r.name)}${!r.ok && r.detail ? `<div class="detail">${E(r.detail)}</div>` : ''}</td></tr>`).join('')}</table>`;
  };
  const ap = store.approval, valid = approvalValid();
  let box;
  if (valid) {
    box = `<div class="approve ok"><b>承認済み</b>: ${E(ap.by)} (${E(ap.at)})${ap.warnAck ? ' / 警告確認済み' : ''}<br><button data-act="revoke">承認を取り消す</button></div>`;
  } else {
    box = `<div class="approve">${ap ? '<p class="warn-text">内容が変更されたため、前回の承認は無効になりました。再度検図してください。</p>' : ''}
      <label>検図者 <input id="appr-name" type="text" placeholder="氏名" value="${E(ap ? ap.by : '')}"></label>
      ${warns.length ? `<label class="chk"><input id="appr-ack" type="checkbox"> 警告 ${warns.length} 件を確認した</label>` : ''}
      <button class="primary" data-act="approve" ${errs.length ? 'disabled' : ''}>検図OK(承認)</button>
      ${errs.length ? `<p class="warn-text">エラー ${errs.length} 件が残っているため承認できません。修正してください。</p>` : ''}</div>`;
  }
  return `<h2>工程5 検図(チェック)</h2>
  <p class="muted">機械的に判定できる項目を自動チェックします。最終的な判断と承認は検図者が行います。</p>
  ${group('エラー(承認前に必ず修正)', 'error')}${group('警告(確認が必要)', 'warn')}${group('情報', 'info')}${box}`;
}
function panel6() {
  const P = wf.project, d = delivered(), valid = approvalValid();
  const changed = d && d.hash !== wf.hash;
  const can = valid && !changed;
  const hist = store.history.length ? store.history.map((h) => `<tr><td>${E(h.rev)}</td><td>${E(h.date)}</td><td>${E(h.note)}</td><td>${E(h.by || '-')}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">まだ納品されていません</td></tr>';
  const msg = !valid ? '検図(工程5)の承認が必要です。' : changed ? `納品済みの版 ${E(P.rev)} から内容が変更されています。改訂してください。` : d ? `版 ${E(P.rev)} は納品済みです。` : '納品できます。';
  return `<h2>工程6 データ変換・納品・改訂</h2>
  <p class="${can ? '' : 'warn-text'}">${msg}${flash ? ` <b>${E(flash)}</b>` : ''}</p>
  <div class="actions">
    <button class="primary" data-act="zip" ${can ? '' : 'disabled'}>納品パッケージ(zip)を作成</button>
  </div>
  <p class="muted">zip の内容: ${wf.zipDesc}</p>
  <div class="actions">
    ${wf.exports.map((x) => `<button data-act="f-exp" data-id="${x.id}">${E(x.label)}</button>`).join('')}
  </div>
  <h3>図面ファイル</h3>
  <table class="grid"><tbody>${wf.drawings.map((dw, i) => `<tr><th>${E(dw.label)}</th><td>${E(dw.d.drawing_no || '')}</td><td class="actions"><button data-act="f-dxf" data-i="${i}">DXF</button><button data-act="f-svg" data-i="${i}">SVG</button><button data-act="f-print" data-i="${i}">印刷 / PDF</button></td></tr>`).join('')}</tbody></table>
  <h3>改訂履歴</h3>
  <table class="grid"><thead><tr><th>版</th><th>日付</th><th>内容</th><th>検図者</th></tr></thead><tbody>${hist}</tbody></table>
  <h3>改訂する(次の版へ)</h3>
  <p class="muted">納品後に変更が必要になったら、改訂内容を書いて「改訂」を押します。版が ${E(nextRev(P.rev))} に上がり、承認は取り消されます。改訂内容は図面の改訂欄に入ります。</p>
  <div class="actions"><input id="rev-note" type="text" placeholder="改訂内容 (${E(wf.revHint)})" ${d ? '' : 'disabled'}>
  <button data-act="revise" ${d && !changed ? '' : 'disabled'}>改訂 (→ ${E(nextRev(P.rev))})</button></div>
  ${d ? '' : '<p class="muted">※ 最初の納品後に改訂できます。</p>'}`;
}
const nameBase = () => baseOf(wf.project);

/* ---------- 画面更新 ---------- */
function present() {
  if (!cur) return;
  curDomain = cur.domain; curMode = cur.mode;
  helpEl.textContent = HELP[curDomain];
  resultbar.hidden = true;
  if (!WF_DOMAINS.has(curDomain) || !wf) {
    if (cur.kind === '2d') {
      view2d(cur.prims, 'x2d');
      const b = bounds2d(cur.prims);
      statusEl.textContent = `${cur.note} / 図形 ${cur.prims.length} 個 / 範囲 ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)}`;
      setButtons(['dl-dxf', 'dl-svg']);
    } else if (view3d(cur.meshes, 'x3d')) {
      const s = bbox3.getSize(new THREE.Vector3());
      statusEl.textContent = `立体 / 部品 ${cur.meshes.length} 個 / 範囲 ${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)}`;
      setButtons(['dl-stl']);
    }
    setTabs(); fitNext = false;
    return;
  }
  if (step === 2) {
    if (cur.kind === '2d') { view2d(cur.prims, 'plan2d'); statusEl.textContent = wf.status2d(bounds2d(cur.prims)); setButtons(wf.btn.m2); }
    else if (view3d(wf.meshes, 'model')) { statusEl.textContent = wf.status3d; setButtons(wf.btn.m3); }
  } else if (step === 3) {
    const S3 = wf.step3, bad = S3.items.filter((i) => i.sev === 'error').length;
    if (view3d(wf.meshes, 'model', S3.hot)) {
      statusEl.textContent = bad ? `${S3.label} ${bad} 件 (赤で表示)` : S3.items.length ? `警告 ${S3.items.length} 件` : `${S3.label}なし`;
      setButtons(wf.btn.m3);
      resultbar.hidden = false;
      resultbar.innerHTML = (S3.items.length
        ? S3.items.map((i) => `<div class="res"><span class="chip ${i.sev === 'error' ? 'ng' : 'warn'}">${i.sev === 'error' ? S3.label : '警告'}</span> ${E(i.text)}</div>`).join('')
        : `<div class="res"><span class="chip ok">✓ ${S3.label}なし</span> ${E(S3.okText)}</div>`)
        + (S3.items.length && !S3.items.some((i) => i.sev === 'error') ? `<div class="res"><span class="chip ok">✓ ${S3.label}なし</span> ${E(S3.okText)}</div>` : '')
        + `<div class="res muted">${E(S3.note)}</div>`;
    }
  } else if (step === 4) {
    if (dwgIdx >= wf.drawings.length) dwgIdx = 0;
    const dw = wf.drawings[dwgIdx], dd = dw.d;
    cur = { kind: '2d', prims: dd.prims, domain: curDomain, mode: '2d', note: '図面', dw };
    view2d(dd.prims, 'drawing:' + dw.key);
    statusEl.textContent = `${dw.label} / ${dd.paper} 横 / 尺度 ${scaleText(dd.scale)}${wf.projText} / 寸法 ${dd.have.length}/${dd.need.length} 項目${dd.fits ? '' : ' / 用紙に収まりません'}`;
    setButtons(['dl-dxf', 'dl-svg', 'dl-print']);
    if (wf.drawings.length > 1) {
      resultbar.hidden = false;
      resultbar.innerHTML = '<div class="group">' + wf.drawings.map((x, i) => `<button data-dwg="${i}" aria-pressed="${i === dwgIdx}">${E(x.label)}</button>`).join('') + '</div>';
    }
  } else {
    showPanels('panel');
    panel.innerHTML = step === 1 ? panel1() : step === 5 ? panel5() : panel6();
    statusEl.textContent = step === 1 ? '工程1: 要件・案件情報' : step === 5 ? `工程5: 検図 (エラー ${errorsOf().length} / 警告 ${warnsOf().length})` : '工程6: 納品・改訂';
    setButtons([]);
  }
  setTabs();
  fitNext = false;
}
function run() {
  timer = 0;
  texts[slot] = ed.value;
  persist();
  let spec;
  try { spec = jsyaml.load(ed.value); }
  catch (e) {
    setError(`YAML の書式エラー${e.mark ? ` (${e.mark.line + 1} 行目)` : ''}: ${e.reason || e.message}`);
    return;
  }
  let scene, w = null;
  try {
    scene = buildScene(spec);
    if (WF_DOMAINS.has(scene.domain)) w = buildWorkflow(spec, scene);
  } catch (e) {
    if (e instanceof SpecError) {
      setError(e.message);
      if (isObj(spec) && DOMAINS[spec.domain]) { curDomain = spec.domain; curMode = String(spec.mode ?? '2d').toLowerCase(); setTabs(); }
      return;
    }
    console.error(e); setError('内部エラー: ' + e.message); return;
  }
  setError('');
  wf = w; cur = scene;
  present();
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
function goStep(n) { step = n; fitNext = true; flash = ''; run(); }

/* ---------- イベント ---------- */
ed.addEventListener('input', schedule);
ed.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); ed.setRangeText('  ', ed.selectionStart, ed.selectionEnd, 'end'); schedule(); }
});
document.querySelectorAll('[data-domain]').forEach((b) => b.addEventListener('click', () => {
  texts[slot] = ed.value; slot = b.dataset.domain; ed.value = texts[slot]; fitNext = true; flash = ''; run();
}));
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.mode;
  if (/^mode:[ \t]*\S+/m.test(ed.value)) ed.value = ed.value.replace(/^mode:[ \t]*\S+/m, `mode: ${m}`);
  else ed.value = `mode: ${m}\n` + ed.value;
  fitNext = true; run();
}));
stepsEl.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.step)));
$('reset-view').addEventListener('click', () => { fitNext = true; if (cur) present(); });
$('reset-text').addEventListener('click', () => { ed.value = SAMPLES[slot]; fitNext = true; run(); });

/* ダウンロード */
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const saveText = (name, text, mime) => saveBlob(name, new Blob([text], { type: mime + ';charset=utf-8' }));
function sheetSVG(d) {
  const [w, h] = PAPERS[d.paper];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 ${-h} ${w} ${h}">\n<rect x="0" y="${-h}" width="${w}" height="${h}" fill="#ffffff"/>\n${svgBody(d.prims.filter((p) => !p.view))}\n</svg>\n`;
}
function printSheet(d) {
  const [w, h] = PAPERS[d.paper];
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}svg{display:block;width:${w}mm;height:${h}mm}</style></head><body>${sheetSVG(d).replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`);
  doc.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 300);
}
const inFlow = () => !!wf && WF_DOMAINS.has(curDomain);
const modelName = () => (inFlow() ? nameBase() : `${cur.domain}-${cur.mode}`);
$('dl-dxf').addEventListener('click', () => {
  if (!cur || cur.kind !== '2d') return;
  saveText(modelName() + (cur.dw ? cur.dw.suffix : '') + '.dxf', toDXF(cur.prims), 'application/dxf');
});
$('dl-svg').addEventListener('click', () => {
  if (!cur || cur.kind !== '2d') return;
  if (inFlow() && step === 4) saveText(modelName() + (cur.dw ? cur.dw.suffix : '') + '.svg', sheetSVG(cur.dw ? cur.dw.d : wf.drawing), 'image/svg+xml');
  else saveText(modelName() + '.svg', toSVGFile(cur.prims), 'image/svg+xml');
});
$('dl-print').addEventListener('click', () => wf && printSheet(cur && cur.dw ? cur.dw.d : wf.drawing));
const saveExport = (id) => { const x = wf && wf.exports.find((e) => e.id === id); if (x) saveText(x.name, x.data(), x.mime); };
$('dl-step').addEventListener('click', () => saveExport('step'));
$('dl-ifc').addEventListener('click', () => saveExport('ifc'));
$('dl-stl').addEventListener('click', () => {
  const meshes = inFlow() ? wf.meshes : cur && cur.meshes;
  if (meshes) saveText(modelName() + '.stl', toSTL(meshes), 'model/stl');
});

/* 工程パネル内の操作 (イベント委譲) */
panel.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  if (t.dataset.goto) return goStep(+t.dataset.goto);
  const act = t.dataset.act;
  if (!act || !wf) return;
  const P = wf.project;
  if (act === 'approve') {
    const by = ($('appr-name').value || '').trim();
    if (!by) { $('appr-name').focus(); flash = ''; setError('検図者の氏名を入力してください'); return; }
    const ack = $('appr-ack');
    if (warnsOf().length && !(ack && ack.checked)) { setError('警告を確認したらチェックを入れてください'); return; }
    setError('');
    store.approval = { by, at: new Date().toLocaleString('ja-JP'), hash: wf.hash, warnAck: warnsOf().length > 0 };
    persist(); present();
  } else if (act === 'revoke') {
    store.approval = null; persist(); present();
  } else if (act === 'zip') {
    const d = delivered();
    if (!d) {
      store.history.push({ rev: P.rev || '-', date: todayStr(), note: store.pendingNote || '初版', by: store.approval.by, hash: wf.hash });
      store.pendingNote = '';
      persist();
      run(); // 改訂欄を含む図面を作り直す
    }
    const base = nameBase();
    const files = [
      ...wf.drawings.flatMap((dw) => [
        { name: `${base}${dw.suffix}.dxf`, data: toDXF(dw.d.prims) },
        { name: `${base}${dw.suffix}.svg`, data: sheetSVG(dw.d) },
      ]),
      ...wf.exports.map((x) => ({ name: x.name, data: x.data() })),
      { name: 'LICENSES.txt', data: LICENSES },
      { name: 'README.txt', data: `納品パッケージ ${base}\n図番: ${P.drawing_no}  版: ${P.rev}\n\n${wf.readme}` },
    ];
    saveBlob(`${base}.zip`, makeZip(files));
    flash = `${files.length} ファイルを書き出しました`;
    present();
  } else if (act === 'revise') {
    const note = ($('rev-note').value || '').trim();
    if (!note) { $('rev-note').focus(); setError('改訂内容を入力してください'); return; }
    setError('');
    const nr = nextRev(P.rev);
    let txt = ed.value;
    if (/^[ \t]+rev:[ \t]*.*$/m.test(txt)) txt = txt.replace(/^([ \t]+)rev:[ \t]*.*$/m, `$1rev: ${nr}`);
    else if (/^project:.*$/m.test(txt)) txt = txt.replace(/^project:.*$/m, (m0) => `${m0}\n  rev: ${nr}`);
    ed.value = txt;
    store.pendingNote = note; store.approval = null;
    flash = `版を ${nr} に改訂しました。内容を修正して再度検図してください`;
    run();
  } else if (act === 'f-dxf') { const dw = wf.drawings[+t.dataset.i]; saveText(`${nameBase()}${dw.suffix}.dxf`, toDXF(dw.d.prims), 'application/dxf'); }
  else if (act === 'f-svg') { const dw = wf.drawings[+t.dataset.i]; saveText(`${nameBase()}${dw.suffix}.svg`, sheetSVG(dw.d), 'image/svg+xml'); }
  else if (act === 'f-print') printSheet(wf.drawings[+t.dataset.i].d);
  else if (act === 'f-exp') saveExport(t.dataset.id);
});

resultbar.addEventListener('click', (e) => {
  const t = e.target.closest('button[data-dwg]');
  if (t) { dwgIdx = +t.dataset.dwg; fitNext = true; present(); }
});
$('load-holes').addEventListener('click', () => {
  texts[slot] = ed.value; slot = 'mechanical'; ed.value = SAMPLE_HOLES; dwgIdx = 0; fitNext = true; flash = ''; run();
});
$('load-feat').addEventListener('click', () => {
  texts[slot] = ed.value; slot = 'mechanical'; ed.value = SAMPLE_FEAT; dwgIdx = 0; fitNext = true; flash = ''; run();
});
$('load-asm').addEventListener('click', () => {
  texts[slot] = ed.value; slot = 'mechanical'; ed.value = SAMPLE_ASM; dwgIdx = 0; fitNext = true; flash = ''; run();
});

/* 案件ファイル */
$('proj-save').addEventListener('click', () => { texts[slot] = ed.value; saveText('cad-project.json', JSON.stringify(snapshot(), null, 2), 'application/json'); });
$('proj-open').addEventListener('click', () => $('proj-file').click());
$('proj-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!restore(d)) throw new Error('形式が違います');
    ed.value = texts[slot]; fitNext = true; step = 1; setError(''); run();
  } catch (err) { setError('案件ファイルを読み込めません: ' + err.message); }
  e.target.value = '';
});

if (window.ResizeObserver) new ResizeObserver(resize3d).observe($('wrap3d'));
ed.value = texts[slot];
run();
window.__cad = {
  run, goStep, toSTEP, get cur() { return cur; }, get wf() { return wf; }, store, toDXF, toSTL, makeZip,
  checkInterference, parseMech, solidsOf, buildDrawing, sectionGroups, jscad: jscadModeling, build3dMech, conformPolys, buildScene, jsyaml,
};
