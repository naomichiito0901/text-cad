// 立体 (solidsOf の結果) を計算エンジンへ渡す記述に変換し、STEP / STL を作る (メインスレッド側)。
// 穴の段差 (座ぐり・皿穴・止まり) や長穴の位置は、既存の関数 (holeSteps / slotSeg) で求めた値をそのまま渡す。
// これにより、旧実装 (自作 STEP ライター) と同じ解釈で形状を作る。
function kernelModelOf(solids) {
  return solids.map((s) => {
    if (s.kind === 'cyl') {
      return { kind: 'cyl', name: s.name, cx: s.cx, cy: s.cy, r: s.r, z0: s.z0, z1: s.z1, ct: s.ct || 0, cb: s.cb || 0, ft: s.ft || 0, fb: s.fb || 0 };
    }
    return {
      kind: 'box', name: s.name, x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1, cr: s.cr || 0, ct: s.ct || 0, cb: s.cb || 0,
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

// 計算エンジンで STEP と STL を作る。 同じ立体なら再計算しない
const kernelCache = new Map();
async function kernelExport(wf, fileName) {
  const model = kernelModelOf(wf.solids);
  const key = JSON.stringify(model);
  if (!kernelCache.has(key)) {
    if (kernelCache.size > 8) kernelCache.delete(kernelCache.keys().next().value);
    kernelCache.set(key, Kernel.call('buildModel', { model }));
  }
  let out;
  try { out = await kernelCache.get(key); } catch (e) { kernelCache.delete(key); throw e; }
  return { ...out, step: stepHeader(out.step, wf.project, fileName || 'model.step') };
}

// 出力ボタン用: 計算エンジンが読み込み中なら待つ。
// 使えないとき、oldFn があればそれで作り (engine: 'old')、無ければ data: null を返す (engine: 'none')
async function kernelOrOld(wf, fileName, what, oldFn) {
  if (Kernel.state.phase === 'idle' || Kernel.state.phase === 'loading') {
    try { await Kernel.ready; } catch (e) { /* 失敗は下で扱う */ }
  }
  if (Kernel.state.phase === 'ready') {
    try { return { data: (await kernelExport(wf, fileName))[what], engine: 'kernel' }; } catch (e) { /* 下で扱う */ }
  }
  return oldFn ? { data: oldFn(), engine: 'old' } : { data: null, engine: 'none' };
}
