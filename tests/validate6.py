"""計算エンジン (replicad / OpenCascade WASM) が出力した STEP・STL を、OpenCascade で読み直して一覧にし、理論式と照合する
(test19.js が k_<ケース>.{step,stl} に書き出したファイルを使う)。

一覧の項目: STEP の有効性 / 立体の数 / 面の数 / 体積 / 表面積 / STL の水密性と体積。
理論値: 体積・表面積とも、理論式のあるケースで照合する (サンプルには理論式が無いので、有効性と STL だけを確認する)。

合格基準: STEP が有効 / 理論体積・理論面積と 1e-4 以内 / STL が水密で体積が STEP と 0.5% 以内
(面の数は一覧に出すだけ。 OpenCascade は周期面を継ぎ目で別の面として数える)
"""
import math, os, re, sys, json
import numpy as np
from collections import Counter
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID

S = os.environ.get('CAD_OUT', '/tmp/cad-out') + '/'
pi = math.pi
sqrt2 = math.sqrt(2)
tan = lambda a: math.tan(math.radians(a))
sin = lambda a: math.sin(math.radians(a))
cos = lambda a: math.cos(math.radians(a))

# ---------- 理論式 (体積) ----------
cyl = lambda r, h: pi * r * r * h
frus = lambda R, r, h: pi * h / 3 * (R * R + R * r + r * r)
slot = lambda w, L: (L - w) * w + pi * (w / 2) ** 2
B = 60 * 40 * 20


def cyl_ch(r, h, ct=0, cb=0):
    v = cyl(r, h)
    for c in (ct, cb):
        if c:
            v -= cyl(r, c) - frus(r, r - c, c)
    return v


def csk_vol(d, D, ang, depth):
    h = (D - d) / 2 / tan(ang / 2)
    return cyl(d / 2, depth) + frus(D / 2, d / 2, h) - cyl(d / 2, h)


def knob_volume(r=10.0, h=30.0, ct=0, cb=0, ft=0, fb=0, n=400000):
    dz = h / n
    tot = 0.0
    for i in range(n):
        z = (i + 0.5) * dz
        ins = 0.0
        if ct and z > h - ct: ins = z - (h - ct)
        elif cb and z < cb: ins = cb - z
        elif ft and z > h - ft: ins = ft - math.sqrt(max(ft * ft - (z - (h - ft)) ** 2, 0))
        elif fb and z < fb: ins = fb - math.sqrt(max(fb * fb - (fb - z) ** 2, 0))
        tot += pi * (r - ins) ** 2 * dz
    return tot


# ---------- 理論式 (表面積) ----------
def hole_through(d, H):  # 貫通穴: 壁 + 口の円を 2 つ除く
    return pi * d * H - 2 * pi * (d / 2) ** 2


def hole_blind(d, depth):  # 止まり穴: 壁だけ増える (底の円が口の円を相殺する)
    return pi * d * depth


def cbore_area(d, D, cd, depth, H):  # 座ぐり穴 (depth=None なら貫通)
    r, R = d / 2, D / 2
    through = depth is None
    dep = H if through else depth
    return -pi * R * R + pi * D * cd + pi * (R * R - r * r) + pi * d * (dep - cd) + (-pi * r * r if through else pi * r * r)


def csk_area(d, D, ang, depth, H):  # 皿穴 (depth=None なら貫通)
    r, R = d / 2, D / 2
    a = ang / 2
    dR = R - r
    h, slant = dR / tan(a), dR / sin(a)
    through = depth is None
    dep = H if through else depth
    return pi * (R + r) * slant + pi * d * (dep - h) - pi * R * R + (-pi * r * r if through else pi * r * r)


def tilt_area(d, H, ang):  # 斜め穴 (口の楕円が板の中に収まる場合)
    return pi * d * H / cos(ang) - 2 * pi * (d / 2) ** 2 / cos(ang)


def slot_area(w, L, H):
    return -2 * slot(w, L) + (2 * (L - w) + pi * w) * H


def rr_area(W, D, R, H):  # 角 R の板
    A = W * D - (4 - pi) * R * R
    P = 2 * (W + D) - 8 * R + 2 * pi * R
    return 2 * A + P * H


def cyl_area(r, h, top=None, bot=None):  # 端面を (種類 'c'|'f', 値) で加工した円柱
    tot, lat = 0.0, h
    for e in (top, bot):
        if e is None:
            tot += pi * r * r
        else:
            k, v = e
            lat -= v
            tot += pi * (r - v) ** 2
            tot += pi * (2 * r - v) * v * sqrt2 if k == 'c' else 2 * pi * v * ((r - v) * pi / 2 + v)
    return tot + 2 * pi * r * lat


box7600 = 2 * (60 * 40 + 60 * 14 + 40 * 14)  # 60 x 40 x 14 の箱の表面積
box8800 = 2 * (60 * 40 + 60 * 20 + 40 * 20)  # 60 x 40 x 20
# (体積, 表面積 または None)
THEORY = {
    'cr': ((5000 - (4 - pi) * 64) * 10, rr_area(100, 50, 8, 10)),
    'chamfer': (B - ((60 + 40) * 9 - 4 * 27 / 3) - ((60 + 40) * 4 - 4 * 8 / 3) - cyl(4, 20),
                54 * 34 + 56 * 36 + 200 * 15 + 3 * sqrt2 * (200 + 176) / 2 + 2 * sqrt2 * (200 + 184) / 2 - 2 * pi * 16 + pi * 8 * 20),
    'blind': (B - cyl(4, 12) - cyl(3, 20), box8800 + hole_blind(8, 12) + hole_through(6, 20)),
    'cbore': (B - (cyl(3.3, 20) + cyl(5.5, 6.5) - cyl(3.3, 6.5)) - (cyl(3.3, 15) + cyl(5.5, 6.5) - cyl(3.3, 6.5)),
              box8800 + cbore_area(6.6, 11, 6.5, None, 20) + cbore_area(6.6, 11, 6.5, 15, 20)),
    'csk': (B - csk_vol(5.5, 10.4, 90, 20) - csk_vol(5.5, 12, 120, 14), box8800 + csk_area(5.5, 10.4, 90, None, 20) + csk_area(5.5, 12, 120, 14, 20)),
    'cyl': (cyl_ch(10, 30, 2, 3), cyl_area(10, 30, ('c', 2), ('c', 3))),
    # 板 120x60x12 (角R6) + 座ぐり + 皿 + 止まり穴 と、φ16x20 の円柱 (上端 C1.5) が別の立体
    'combo': ((120 * 60 - (4 - pi) * 36) * 12 - (cyl(3.3, 12) + cyl(5.5, 6.5) - cyl(3.3, 6.5)) - csk_vol(5.5, 10.4, 90, 12) - cyl(4, 8) + cyl_ch(8, 20, 1.5, 0),
              # 融合後: 円柱の底の円 (r8) と、板の上面の同じ円がなくなる (2 つ分)
              rr_area(120, 60, 6, 12) + cbore_area(6.6, 11, 6.5, None, 12) + csk_area(5.5, 10.4, 90, None, 12) + hole_blind(8, 8) + cyl_area(8, 20, ('c', 1.5), None) - 2 * pi * 64),
    'thread': (7600 * 0 + 60 * 40 * 14 - cyl(2.5, 14) - cyl(3.4, 13), box7600 + hole_through(5, 14) + hole_blind(6.8, 13)),
    'tilt': (60 * 40 * 14 - cyl(3, 14) / cos(30) - cyl(2.5, 14) / cos(20), box7600 + tilt_area(6, 14, 30) + tilt_area(5, 14, 20)),
    'tilt2': (60 * 40 * 14 - cyl(3, 14) / cos(25) - cyl(2.5, 14) / cos(40), box7600 + tilt_area(6, 14, 25) + tilt_area(5, 14, 40)),
    'slotx': (60 * 40 * 14 - slot(8, 28) * 14, box7600 + slot_area(8, 28, 14)),
    'sloty': (60 * 40 * 14 - slot(6, 24) * 14 - cyl(2.5, 14), box7600 + slot_area(6, 24, 14) + hole_through(5, 14)),
    'all': (100 * 60 * 14 - cyl(2.5, 14) - cyl(3, 14) / cos(30) - slot(8, 28) * 14,
            2 * (100 * 60 + 100 * 14 + 60 * 14) + hole_through(5, 14) + tilt_area(6, 14, 30) + slot_area(8, 28, 14)),
    'ft': (knob_volume(ft=3), cyl_area(10, 30, ('f', 3), None)),
    'fb': (knob_volume(fb=2), cyl_area(10, 30, None, ('f', 2))),
    'both': (knob_volume(ft=3, fb=2), cyl_area(10, 30, ('f', 3), ('f', 2))),
    'mix': (knob_volume(ct=2, fb=3), cyl_area(10, 30, ('c', 2), ('f', 3))),
    'big': (knob_volume(ft=9.5, fb=9.5), cyl_area(10, 30, ('f', 9.5), ('f', 9.5))),
}
# アプリのサンプル (板 100x50x10 に φ8 の貫通穴 2 つ + ボス φ20 x 15): 融合後、ボスの底の円 (r10) と板の上面の同じ円がなくなる
THEORY['sample'] = (50000 - 2 * cyl(4, 10) + cyl(10, 15), 2 * (100 * 50 + 100 * 10 + 50 * 10) + 2 * (-2 * pi * 16 + pi * 8 * 10) + 2 * pi * 10 * 15 + pi * 100 - pi * 100 + 0)
CASES = list(THEORY) + ['asm', 'feat', 'holes']


def load(fn):
    r = STEPControl_Reader()
    r.ReadFile(fn)
    r.TransferRoots()
    return r.OneShape()


def count(shp, kind):
    e = TopExp_Explorer(shp, kind)
    n = 0
    while e.More():
        n += 1
        e.Next()
    return n


def props(shp):
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(shp, g)
    a = GProp_GProps(); BRepGProp.SurfaceProperties_s(shp, a)
    return g.Mass(), a.Mass()


def stl(fn):
    txt = open(fn).read()
    v = np.array([[float(x) for x in m.groups()] for m in re.finditer(r'vertex\s+(\S+)\s+(\S+)\s+(\S+)', txt)]).reshape(-1, 3, 3)
    vol = np.einsum('ij,ij->i', v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6
    E = Counter()
    for t in v:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            E[(tuple(np.round(t[a], 3)), tuple(np.round(t[b], 3)))] += 1
    return vol, sum(1 for (a, b), c in E.items() if E.get((b, a), 0) != c)


SCHEMA = {'AP242': 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF', 'AP214': 'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'}
ok = True
print('体積・面積は mm³・mm²。 「理論」の列は、理論式との相対差。 立体 = STEP の中の立体の数 (部品ごとに融合したあと)')
print(f"{'case':8} {'形式':5} {'有効':4} {'部品':3} {'立体':3} {'面':3} {'体積':>10} {'面積':>10} {'STL水密':>7} {'STL体積差':>9} | {'理論体積差':>9} {'理論面積差':>9} | スキーマ")
for k in CASES:
    parts = json.load(open(S + f'k_{k}.json'))
    n_expect = sum(p['solids'] for p in parts)  # 融合のあとの立体の数 (離れた立体は別のまま)
    for fmt, fn in (('AP242', f'k_{k}.step'), ('AP214', f'k_{k}_214.step')):
        shp = load(S + fn)
        v, a = props(shp)
        text = open(S + fn).read()
        schema_ok = SCHEMA[fmt] in text.replace('\n', ' ') and (fmt == 'AP214' or True)
        r = dict(valid=BRepCheck_Analyzer(shp).IsValid(), solids=count(shp, TopAbs_SOLID), faces=count(shp, TopAbs_FACE), vol=v, area=a)
        good = r['valid'] and r['solids'] == n_expect and schema_ok
        # 融合の前後で体積が変わらない (面で接しているだけの立体)
        good = good and all(abs(p['volume'] - p['volumeBefore']) / p['volumeBefore'] < 1e-9 for p in parts)
        um, stlerr = '', ''
        if fmt == 'AP242':
            sv, um_ = stl(S + f'k_{k}.stl')
            um, stlerr = um_, abs(sv - v) / v
            good = good and um_ == 0 and stlerr < 0.005
        tail = ''
        th = THEORY.get(k)
        if th:
            ev, ea = abs(v - th[0]) / th[0], abs(a - th[1]) / th[1]
            good = good and ev < 1e-4 and ea < 1e-4
            tail = f"{ev * 100:8.4f}% {ea * 100:8.4f}%"
        ok &= good
        print(f"{k if fmt == 'AP242' else '':8} {fmt:5} {str(r['valid']):4} {len(parts):3d} {r['solids']:3d} {r['faces']:3d} {r['vol']:10.2f} {r['area']:10.2f} {um!s:>7} {(f'{stlerr * 100:.4f}%' if stlerr != '' else ''):>9} | {tail:>19} | {'一致' if schema_ok else '不一致'}")
        if not good:
            print(f'   ^^^ {k} ({fmt}): 不一致あり')
print('ALL OK:', ok)
sys.exit(0 if ok else 1)
