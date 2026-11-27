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
pi = math.pi
cyl = lambda r, h: pi * r * r * h
frus = lambda R, r, h: pi * h / 3 * (R * R + R * r + r * r)
tan = lambda a: math.tan(math.radians(a))
B = 60 * 40 * 20


def cyl_ch(r, h, ct=0, cb=0):
    v = cyl(r, h)
    for c in (ct, cb):
        if c:
            v -= cyl(r, c) - frus(r, r - c, c)
    return v


def cskrem(d, D, ang, depth):
    h = (D - d) / 2 / tan(ang / 2)
    return cyl(d / 2, depth) + frus(D / 2, d / 2, h) - cyl(d / 2, h)


W, D = 60, 40
T = {
    'cr': (100 * 50 - (4 - pi) * 64) * 10,
    'chamfer': B - ((W + D) * 9 - 4 * 27 / 3) - ((W + D) * 4 - 4 * 8 / 3) - cyl(4, 20),
    'blind': B - cyl(4, 12) - cyl(3, 20),
    'cbore': B - (cyl(3.3, 20) + cyl(5.5, 6.5) - cyl(3.3, 6.5)) - (cyl(3.3, 15) + cyl(5.5, 6.5) - cyl(3.3, 6.5)),
    'csk': B - cskrem(5.5, 10.4, 90, 20) - cskrem(5.5, 12, 120, 14),
    'cyl': cyl_ch(10, 30, 2, 3),
    'combo': (120 * 60 - (4 - pi) * 36) * 12 - (cyl(3.3, 12) + cyl(5.5, 6.5) - cyl(3.3, 6.5)) - cskrem(5.5, 10.4, 90, 12) - cyl(4, 8) + cyl_ch(8, 20, 1.5, 0),
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
print(f"{'case':8} {'STEP有効':6} {'STEP体積':>10} {'STL体積':>10} {'理論':>10}  STEP誤差  STL誤差  faces tris 非対応辺")
for k, th in T.items():
    rd = STEPControl_Reader()
    rd.ReadFile(S + f'f_{k}.step')
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
    sv, nt, um = stl(f'f_{k}.stl')
    ok &= valid and abs(g.Mass() - th) / th < 1e-4 and um == 0 and abs(sv - th) / th < 0.005
    print(f"{k:8} {str(valid):6} {g.Mass():10.2f} {sv:10.2f} {th:10.2f}  {abs(g.Mass() - th) / th * 100:6.3f}%  {abs(sv - th) / th * 100:6.3f}%  {nf:4d} {nt:5d} {um}")
print('ALL OK:', ok)
