"""計算エンジン (replicad / OpenCascade WASM) が出力した STEP・STL を、OpenCascade で読み直して理論式と照合する。

照合する量: STEP の有効性 / 体積 / 表面積 (どちらも理論式)、STL の水密性と体積。
対象 (test18.js が書き出す):
  plate : 60 x 40 x 20 の箱に φ8 の貫通穴 (XY の中心)
  knob  : φ20 x 30 の円柱の上端に R3 のフィレット
"""
import math, os, re, sys
import numpy as np
from collections import Counter
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE

S = os.environ.get('CAD_OUT', '/tmp/cad-out') + '/'
pi = math.pi


def knob_volume(r=10.0, h=30.0, ft=3.0, n=400000):
    """回転体の体積を、半径の関数 r(z) の数値積分で求める"""
    dz = h / n
    tot = 0.0
    for i in range(n):
        z = (i + 0.5) * dz
        ins = ft - math.sqrt(max(ft * ft - (z - (h - ft)) ** 2, 0)) if z > h - ft else 0.0
        tot += pi * (r - ins) ** 2 * dz
    return tot


THEORY = {
    # 体積 = 箱 - 穴。 面積 = 箱の表面 - 穴の口 2 つ + 穴の内面
    'plate': (48000 - pi * 16 * 20, 2 * (60 * 40 + 60 * 20 + 40 * 20) - 2 * pi * 16 + 2 * pi * 4 * 20),
    # 面積 = 側面 + 底面 + 上面の平らな部分 + 1/4 トーラス (フィレット)
    'knob': (knob_volume(), 2 * pi * 10 * 27 + pi * 100 + pi * 49 + 2 * pi * 3 * (3.5 * pi + 3)),
}


def stl(fn):
    txt = open(S + fn).read()
    v = np.array([[float(x) for x in m.groups()] for m in re.finditer(r'vertex\s+(\S+)\s+(\S+)\s+(\S+)', txt)]).reshape(-1, 3, 3)
    vol = np.einsum('ij,ij->i', v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6
    E = Counter()
    for t in v:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            E[(tuple(np.round(t[a], 3)), tuple(np.round(t[b], 3)))] += 1
    return vol, len(v), sum(1 for (a, b), c in E.items() if E.get((b, a), 0) != c)


ok = True
print(f"{'case':16} {'STEP有効':6} {'体積':>10} {'理論':>10} {'誤差':>8} {'面積':>10} {'理論':>10} {'誤差':>8} {'STL誤差':>8} 非対応辺")
for target in ('offline', 'web'):
    for k, (tv, ta) in THEORY.items():
        fn = f'kernel_{target}_{k}'
        r = STEPControl_Reader()
        r.ReadFile(S + fn + '.step')
        r.TransferRoots()
        shp = r.OneShape()
        valid = BRepCheck_Analyzer(shp).IsValid()
        g = GProp_GProps(); BRepGProp.VolumeProperties_s(shp, g); vol = g.Mass()
        g2 = GProp_GProps(); BRepGProp.SurfaceProperties_s(shp, g2); area = g2.Mass()
        sv, nt, um = stl(fn + '.stl')
        ev, ea, es = abs(vol - tv) / tv, abs(area - ta) / ta, abs(sv - tv) / tv
        ok &= valid and ev < 1e-4 and ea < 1e-4 and um == 0 and es < 0.005
        print(f"{fn:16} {str(valid):6} {vol:10.2f} {tv:10.2f} {ev * 100:7.4f}% {area:10.2f} {ta:10.2f} {ea * 100:7.4f}% {es * 100:7.4f}% {um}")
print('ALL OK:', ok)
sys.exit(0 if ok else 1)
