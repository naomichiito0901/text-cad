import math, re
import numpy as np
from collections import Counter
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE

import os
S = os.environ.get('CAD_OUT', '/tmp/cad-out') + '/'
r, h = 10.0, 30.0


def theory(ct=0, cb=0, ft=0, fb=0):
    """回転体の体積を、半径の関数 r(z) の数値積分で求める (十分細かい刻み)"""
    n = 400000
    dz = h / n
    tot = 0.0
    for i in range(n):
        z = (i + 0.5) * dz
        ins = 0.0
        if ct and z > h - ct:
            ins = z - (h - ct)
        elif cb and z < cb:
            ins = cb - z
        elif ft and z > h - ft:
            ins = ft - math.sqrt(max(ft * ft - (z - (h - ft)) ** 2, 0))
        elif fb and z < fb:
            ins = fb - math.sqrt(max(fb * fb - (fb - z) ** 2, 0))
        tot += math.pi * (r - ins) ** 2 * dz
    return tot


T = {
    'ft': theory(ft=3), 'fb': theory(fb=2), 'both': theory(ft=3, fb=2),
    'mix': theory(ct=2, fb=3), 'big': theory(ft=9.5, fb=9.5),
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
print(f"{'case':5} {'STEP有効':6} {'STEP体積':>10} {'STL体積':>10} {'理論':>10}  STEP誤差  STL誤差  faces tris 非対応辺")
for k, th in T.items():
    rd = STEPControl_Reader()
    rd.ReadFile(S + f'h_{k}.step')
    rd.TransferRoots()
    shp = rd.OneShape()
    valid = BRepCheck_Analyzer(shp).IsValid()
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shp, g)
    e = TopExp_Explorer(shp, TopAbs_FACE)
    nf = 0
    while e.More():
        nf += 1
        e.Next()
    sv, nt, um = stl(f'h_{k}.stl')
    ok &= valid and abs(g.Mass() - th) / th < 1e-4 and um == 0 and abs(sv - th) / th < 0.005
    print(f"{k:5} {str(valid):6} {g.Mass():10.2f} {sv:10.2f} {th:10.2f}  {abs(g.Mass() - th) / th * 100:6.3f}%  {abs(sv - th) / th * 100:6.3f}%  {nf:4d} {nt:5d} {um}")
print('ALL OK:', ok)
