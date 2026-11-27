"""部品ごとの融合 (test22.js が f_<ケース>.{step,json} に書き出したもの) を、OpenCascade で読み直して理論値と照合する。

一覧の項目: 部品の数 / 融合のあとの立体の数 (STEP の中) / 融合の前後の体積 / 理論 / 表面積 / 理論 / 面の数 / 有効性。
合格基準: STEP が有効 / 立体の数が期待どおり (離れた立体は別のまま) / 融合の前の体積 (立体ごとの合計) と、
融合のあとの体積・表面積が理論値と 1e-4 以内 (理論値の無いサンプルは、前後で体積が変わらないこと)
"""
import json, os, sys
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID

S = os.environ.get('CAD_OUT', '/tmp/cad-out') + '/'
CASES = ['touch-boss', 'overlap-boxes', 'overlap-cyl', 'disjoint', 'asm-bolt', 'sample', 'asm', 'feat']


def count(shp, kind):
    e = TopExp_Explorer(shp, kind)
    n = 0
    while e.More():
        n += 1
        e.Next()
    return n


ok = True
print('体積・面積は mm³・mm²。 前 = 融合の前 (立体ごとの合計)、後 = 融合のあと (STEP を OpenCascade で読み直した値)')
print(f"{'case':14} {'部品':3} {'立体':3} {'面':3} {'有効':4} | {'前 体積':>10} {'理論':>10} | {'後 体積':>10} {'理論':>10} {'差':>8} | {'後 面積':>10} {'理論':>10} {'差':>8} | 警告")
for k in CASES:
    d = json.load(open(S + f'f_{k}.json'))
    parts, ex = d['parts'], d['expect']
    r = STEPControl_Reader(); r.ReadFile(S + f'f_{k}.step'); r.TransferRoots(); shp = r.OneShape()
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(shp, g); vol = g.Mass()
    a = GProp_GProps(); BRepGProp.SurfaceProperties_s(shp, a); area = a.Mass()
    valid = BRepCheck_Analyzer(shp).IsValid()
    solids, faces = count(shp, TopAbs_SOLID), count(shp, TopAbs_FACE)
    before = sum(p['volumeBefore'] for p in parts)
    good = valid and len(parts) == ex['parts'] and solids == ex['solids'] and all(p['valid'] for p in parts)
    tv = f"{ex['before']:10.2f}" if 'before' in ex else f"{'-':>10}"
    ta_v = f"{ex['after']:10.2f}" if 'after' in ex else f"{'-':>10}"
    dv = da = ''
    if 'before' in ex:
        good = good and abs(before - ex['before']) / ex['before'] < 1e-4
    else:  # 理論値の無いサンプル: 前後で体積が変わらない
        good = good and abs(vol - before) / before < 1e-6
    if 'after' in ex:
        e = abs(vol - ex['after']) / ex['after']; good = good and e < 1e-4; dv = f'{e * 100:.4f}%'
    ta_a = f"{ex['area']:10.2f}" if 'area' in ex else f"{'-':>10}"
    if 'area' in ex:
        e = abs(area - ex['area']) / ex['area']; good = good and e < 1e-4; da = f'{e * 100:.4f}%'
    warn = '離れた立体あり' if d['warn'] and not d['warn']['ok'] else '-'
    ok &= good
    print(f"{k:14} {len(parts):3d} {solids:3d} {faces:3d} {str(valid):4} | {before:10.2f} {tv} | {vol:10.2f} {ta_v} {dv:>8} | {area:10.2f} {ta_a} {da:>8} | {warn}")
    if not good:
        print(f'   ^^^ {k}: 不一致あり')
print('ALL OK:', ok)
sys.exit(0 if ok else 1)
