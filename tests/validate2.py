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
cosd = lambda a: math.cos(math.radians(a))
slot = lambda w, L: ((L - w) * w + pi * (w / 2) ** 2)
box = 60 * 40 * 14
T = {
    'thread': box - cyl(2.5, 14) - cyl(3.4, 13),
    'tilt': box - cyl(3, 14) / cosd(30) - cyl(2.5, 14) / cosd(20),
    'tilt2': box - cyl(3, 14) / cosd(25) - cyl(2.5, 14) / cosd(40),
    'slotx': box - slot(8, 28) * 14,
    'sloty': box - slot(6, 24) * 14 - cyl(2.5, 14),
    'all': 100 * 60 * 14 - cyl(2.5, 14) - cyl(3, 14) / cosd(30) - slot(8, 28) * 14,
}


def stl(fn):
    txt = open(S + fn).read()
    v = np.array([[float(x) for x in m.groups()] for m in re.finditer(r'vertex\s+(\S+)\s+(\S+)\s+(\S+)', txt)]).reshape(-1, 3, 3)
    vol = np.einsum('ij,ij->i', v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6
    E = Counter()
    for t in v:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            E[(tuple(np.round(t[a], 3)), tuple(np.round(t[b], 3)))] += 1
    um = sum(1 for (a, b), c in E.items() if E.get((b, a), 0) != c)
    return vol, len(v), um


ok = True
print(f"{'case':7} {'STEP有効':6} {'STEP体積':>10} {'STL体積':>10} {'理論':>10}  STEP誤差  STL誤差  faces tris 非対応辺")
for k, th in T.items():
    r = STEPControl_Reader()
    r.ReadFile(S + f'g_{k}.step')
    r.TransferRoots()
    shp = r.OneShape()
    valid = BRepCheck_Analyzer(shp).IsValid()
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shp, g)
    e = TopExp_Explorer(shp, TopAbs_FACE)
    nf = 0
    while e.More():
        nf += 1
        e.Next()
    sv, nt, um = stl(f'g_{k}.stl')
    ok &= valid and abs(g.Mass() - th) / th < 1e-4 and um == 0 and abs(sv - th) / th < 0.005
    print(f"{k:7} {str(valid):6} {g.Mass():10.2f} {sv:10.2f} {th:10.2f}  {abs(g.Mass() - th) / th * 100:6.3f}%  {abs(sv - th) / th * 100:6.3f}%  {nf:4d} {nt:5d} {um}")
print('ALL OK:', ok)
