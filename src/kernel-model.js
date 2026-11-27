// 立体 (solidsOf の結果) を計算エンジンへ渡す記述に変換し、STEP / STL を作る (メインスレッド側)。
// 穴の段差 (座ぐり・皿穴・止まり) や長穴の位置は、既存の関数 (holeSteps / slotSeg) で求めた値をそのまま渡す。
// 図面・干渉チェックと同じ解釈で形状を作るため、穴の形は既存の関数をそのまま使う。
function kernelModelOf(solids) {
  return solids.map((s) => {
    if (s.kind === 'cyl') {
      return { kind: 'cyl', name: s.name, inst: s.inst, part: s.partLabel, cx: s.cx, cy: s.cy, r: s.r, z0: s.z0, z1: s.z1, ct: s.ct || 0, cb: s.cb || 0, ft: s.ft || 0, fb: s.fb || 0 };
    }
    return {
      kind: 'box', name: s.name, inst: s.inst, part: s.partLabel, x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1, cr: s.cr || 0, ct: s.ct || 0, cb: s.cb || 0,
      holes: s.holes.map((h) => {
        if (h.tilt) return { tilt: { x: h.x, y: h.y, d: h.d, angle: h.tilt, dir: h.tdir } };
        const { pts, through } = holeSteps(h, s.z1, s.z0);
        return { rev: { x: h.x, y: h.y, pts, through } };
      }),
      slots: (s.slots || []).map((sl) => ({ cx: sl.cx, cy: sl.cy, w: sl.w, len: sl.len, dir: sl.dir })),
    };
  });
}

// STEP のヘッダ (FILE_NAME) を、案件の情報に置き換える。 本体 (形状) には触れない
function stepHeader(step, project, fileName) {
  const stamp = new Date().toISOString().slice(0, 19);
  const head = `FILE_NAME('${stepStr(fileName)}','${stamp}',('${stepStr(project.drafter || '')}'),(''),'cad-text','cad-text (OpenCascade)','');\nFILE_SCHEMA`;
  return step.replace(/FILE_NAME\([\s\S]*?\);\s*FILE_SCHEMA/, head);
}

// 計算エンジンで、部品ごとに融合した STEP と STL を作る。 同じ立体・同じ形式なら再計算しない。
// STEP の形式は案件情報の step_format (AP242 | AP214)。 失敗したら、理由つきの Error を投げる
const kernelCache = new Map();
async function kernelExport(wf, fileName) {
  const model = kernelModelOf(wf.solids);
  const format = wf.project.step_format || 'AP242';
  const test = window.__kernelTest || undefined; // テスト用の指定 (融合の失敗を再現する)
  const key = JSON.stringify([model, format, test]);
  if (!kernelCache.has(key)) {
    if (kernelCache.size > 8) kernelCache.delete(kernelCache.keys().next().value);
    kernelCache.set(key, Kernel.call('buildModel', { model, format, test }));
  }
  let out;
  try { out = await kernelCache.get(key); } catch (e) { kernelCache.delete(key); throw e; }
  return { ...out, step: stepHeader(out.step, wf.project, fileName || 'model.step') };
}

// 出力ボタン用: 計算エンジンが読み込み中なら待つ。
// 戻り値の engine: 'kernel' (計算エンジン) / 'old' (使えず、oldFn で作った) / 'none' (作れない。 reason に理由)
async function kernelOrOld(wf, fileName, what, oldFn) {
  let reason = '';
  if (Kernel.state.phase === 'idle' || Kernel.state.phase === 'loading') {
    try { await Kernel.ready; } catch (e) { /* 失敗は下で扱う */ }
  }
  if (Kernel.state.phase === 'ready') {
    try { return { data: (await kernelExport(wf, fileName))[what], engine: 'kernel' }; } catch (e) { reason = String((e && e.message) || e); }
  } else reason = '計算エンジンを読み込めませんでした。 ページを読み込み直してください';
  return oldFn ? { data: oldFn(), engine: 'old', reason } : { data: null, engine: 'none', reason };
}

// 干渉チェック: 部品どうしの共通部分の体積を、計算エンジンで求める (非同期)。
// 結果は立体の記述ごとに覚える。 まだ求まっていなければ state: 'pending' を返し、求まったら onDone() を呼ぶ。
// 計算エンジンが使えなければ state: 'unavailable'。 「浮いている部品」は外形 (バウンディングボックス) の接触で判定する
const interferenceCache = new Map();
const interferenceKey = (solids) => JSON.stringify(kernelModelOf(solids));
function interferenceFor(solids, onDone) {
  const key = interferenceKey(solids);
  let e = interferenceCache.get(key);
  if (!e) {
    e = { state: 'pending', hits: [] };
    if (interferenceCache.size > 16) interferenceCache.delete(interferenceCache.keys().next().value);
    interferenceCache.set(key, e);
    const names = solids.map((o) => o.name);
    Kernel.call('interfere', { model: JSON.parse(key) }).then((r) => {
      e.hits = r.hits.map((h) => ({ a: names[h.i], b: names[h.j], volume: h.volume, dz: h.dz }));
      e.parts = r.parts; // 部品ごとの情報 (離れた立体があるか)
      e.state = 'done';
    }, () => { e.state = 'unavailable'; }).then(() => onDone && onDone());
  }
  return { state: e.state, hits: e.hits, parts: e.parts || null, floating: floatingParts(solids) };
}

// 断面: 部品ごと (融合した形) の切断面の輪郭を、計算エンジンで求める (非同期)。 干渉と同じく、結果は立体の記述・切る面ごとに覚える。
// 戻り値の state: 'done' / 'pending' (求まったら onDone()) / 'unavailable'。 groups: 切れた部品ごとの { key, name, loops (図面用に整えた輪郭の一覧), area (厳密な面積), faces }
const sectionCache = new Map();
function sectionFor(solids, sec, onDone) {
  const model = kernelModelOf(solids), key = JSON.stringify([model, sec.plane, sec.at]);
  let e = sectionCache.get(key);
  if (!e) {
    e = { state: 'pending', groups: [] };
    if (sectionCache.size > 24) sectionCache.delete(sectionCache.keys().next().value);
    sectionCache.set(key, e);
    Kernel.call('section', { model, plane: sec.plane, at: sec.at }).then((r) => {
      e.groups = r.groups.map((g) => ({ ...g, loops: g.faces.flatMap((f) => [f.outer, ...f.holes]).map(collinearReduce).filter((l) => l.length >= 3) }));
      e.state = 'done';
    }, () => { e.state = 'unavailable'; }).then(() => onDone && onDone());
  }
  return e;
}
