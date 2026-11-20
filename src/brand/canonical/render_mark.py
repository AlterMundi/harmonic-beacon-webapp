"""One reproducible Beacon centerline, reconstructed from Sai's selected image."""
from pathlib import Path
import json
import math
import argparse
import re

ROOT=Path(__file__).resolve().parent


def segments(knots):
    n=len(knots)
    for i,p1 in enumerate(knots):
        p0,p2,p3=knots[(i-1)%n],knots[(i+1)%n],knots[(i+2)%n]
        yield p1, [p1[j]+(p2[j]-p0[j])/6 for j in [0,1]], [p2[j]-(p3[j]-p1[j])/6 for j in [0,1]], p2


def samples(knots, steps=8):
    pts=[]
    for a,b,c,d in segments(knots):
        for i in range(steps):
            t=i/steps;u=1-t
            pts.append([u**3*a[j]+3*u*u*t*b[j]+3*u*t*t*c[j]+t**3*d[j] for j in [0,1]])
    return pts


def normalized(data):
    pts=samples(data['image_space_knots'],8)
    xs=[p[0] for p in pts];ys=[p[1] for p in pts]
    bounds=[min(xs),min(ys),max(xs),max(ys)]
    scale=data['mark_height']/(bounds[3]-bounds[1])
    cx,cy=(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2
    return [[(x-cx)*scale+100,(y-cy)*scale+100] for x,y in data['image_space_knots']],bounds


def path_data(knots, polyline=False):
    f=lambda x:f'{x:.4f}'.rstrip('0').rstrip('.')
    if polyline:
        p=samples(knots,5)
        return 'M'+' L'.join(f'{f(x)} {f(y)}' for x,y in p)+' Z'
    result=f'M{f(knots[0][0])} {f(knots[0][1])}'
    for a,b,c,d in segments(knots):
        result+=' C'+' '.join(f'{f(x)} {f(y)}' for x,y in [b,c,d])
    return result+' Z'


def svg(data,color,width=6,polyline=False,symbol=False):
    knots,bounds=normalized(data);d=path_data(knots,polyline)
    attrs=f'fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'
    if symbol:
        return f'<svg xmlns="http://www.w3.org/2000/svg"><symbol id="beacon-mark" viewBox="0 0 200 200"><path d="{d}" {attrs}/></symbol></svg>\n'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none"><title>Harmonic Beacon</title><desc>Source-grounded reconstruction of Sai\'s selected looping curve. Physical oscillator parameters are unknown.</desc><g id="beacon-mark"><path d="{d}" {attrs}/></g></svg>\n'


def render_all(data,dest):
    dest.mkdir(parents=True,exist_ok=True)
    (dest/'beacon-mark.svg').write_text(svg(data,'currentColor'))
    (dest/'beacon-mark-symbol.svg').write_text(svg(data,'currentColor',symbol=True))
    (dest/'beacon-mark-polyline.svg').write_text(svg(data,'currentColor',polyline=True))
    for name,color in data['palette'].items():
        (dest/f'beacon-mark-{name}.svg').write_text(svg(data,color))
    (dest/'beacon-mark-small.svg').write_text(svg(data,'currentColor',10))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--geometry',type=Path,default=ROOT/'geometry.json');parser.add_argument('--out',type=Path,default=ROOT);parser.add_argument('--sync-consumers',action='store_true');args=parser.parse_args()
    data=json.loads(args.geometry.read_text())
    render_all(data,args.out)
    if args.sync_consumers:
        repo=ROOT.parents[2]
        nav=repo/'assets/hb-global-nav.js'
        path=path_data(normalized(data)[0])
        block="/* HB_MARK_GENERATED_BEGIN: assets/brand/beacon-mark/geometry.json */\n  function beaconMarkPath() {\n    return "+repr(path)+";\n  }\n  /* HB_MARK_GENERATED_END */"
        text,count=re.subn(r'/\* HB_MARK_GENERATED_BEGIN:.*?/\* HB_MARK_GENERATED_END \*/',block,nav.read_text(),count=1,flags=re.S)
        if count!=1:raise SystemExit('Canonical generated mark block not found; no consumer mutation')
        nav.write_text(text)
        favicon=svg(data,data['palette']['gold'],9).replace('<g id="beacon-mark">','<rect width="200" height="200" rx="38" fill="#16120D"/><g id="beacon-mark">')
        (repo/'favicon.svg').write_text(favicon)
