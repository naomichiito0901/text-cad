"""納品zip (asm.zip / arch.zip) の中身を検査: DXF の audit、STEP の有効性と体積、IFC の要素数"""
import os, sys, tempfile, zipfile
import ezdxf, ifcopenshell
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp

S = os.environ.get('CAD_OUT', '/tmp/cad-out') + '/'
ok = True
for z in ['asm.zip', 'arch.zip']:
    zf = zipfile.ZipFile(S + z)
    ok &= zf.testzip() is None
    has = 'LICENSES.txt' in zf.namelist() and b'MIT License' in zf.read('LICENSES.txt') and b'three' in zf.read('LICENSES.txt')
    ok &= has
    print('  LICENSES.txt 同梱:', has)
    print(z, len(zf.namelist()), 'files')
    for n in zf.namelist():
        d = zf.read(n)
        t = tempfile.mktemp(suffix=os.path.splitext(n)[1])
        open(t, 'wb').write(d)
        if n.endswith('.dxf'):
            doc = ezdxf.readfile(t)
            e = len(doc.audit().errors)
            ok &= e == 0
            print('  DXF', n, len(list(doc.modelspace())), 'ents, audit errors', e)
        elif n.endswith('.step'):
            r = STEPControl_Reader(); r.ReadFile(t); r.TransferRoots(); s = r.OneShape()
            v = BRepCheck_Analyzer(s).IsValid()
            g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g)
            ok &= v
            print('  STEP', n, 'valid', v, 'vol %.2f' % g.Mass())
        elif n.endswith('.ifc'):
            m = ifcopenshell.open(t)
            print('  IFC', n, {k: len(m.by_type(k)) for k in ['IfcWall', 'IfcDoor', 'IfcWindow', 'IfcSpace', 'IfcSlab']})
print('ALL OK:', ok)
sys.exit(0 if ok else 1)
