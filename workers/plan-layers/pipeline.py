"""Source-preserving page capture and candidate architectural layers."""
import argparse, hashlib, io, json, re, time
from pathlib import Path
from collections import defaultdict
import fitz
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DictionaryObject, NameObject, ArrayObject, TextStringObject

VERSION = 'mason-plan-layers-0.1.1'
PAINT = {b'S', b's', b'f', b'F', b'f*', b'B', b'B*', b'b', b'b*', b'Tj', b'TJ', b"'", b'"', b'Do', b'sh', b'INLINE IMAGE'}
LAYERS = {'walls':'Walls', 'windows':'Windows', 'doors':'Doors', 'rooms':'Room names and numbers', 'other':'Not needed for measuring'}

def digest(data): return hashlib.sha256(data).hexdigest()
def write_json(path, value): path.write_text(json.dumps(value, indent=2, default=list))
def group(stack): return next((s for s in reversed(stack) if s.startswith('/Element')), 'ungrouped')
def track(stack, operands, operator):
    if operator in (b'BMC', b'BDC'): stack.append(str(operands[0]))
    elif operator == b'EMC' and stack: stack.pop()

def apply_layers(reader, page_index, assignments, names, visible):
    writer = PdfWriter(); writer.add_page(reader.pages[page_index]); page = writer.pages[0]
    refs = {key:writer._add_object(DictionaryObject({NameObject('/Type'):NameObject('/OCG'), NameObject('/Name'):TextStringObject(name)})) for key,name in names.items()}
    resources = page['/Resources'].get_object()
    if '/Properties' not in resources: resources[NameObject('/Properties')] = DictionaryObject()
    props = resources['/Properties'].get_object()
    aliases = {}
    for i,(key,ref) in enumerate(refs.items()):
        alias = '/MasonLayer'+str(i)
        while alias in props: alias += '_'
        props[NameObject(alias)] = ref; aliases[key] = alias
    config = DictionaryObject({NameObject('/BaseState'):NameObject('/OFF'), NameObject('/ON'):ArrayObject([refs[k] for k in visible]), NameObject('/OFF'):ArrayObject([v for k,v in refs.items() if k not in visible]), NameObject('/Order'):ArrayObject(list(refs.values()))})
    if set(names)==set(LAYERS):
        config[NameObject('/Order')]=ArrayObject([ArrayObject([TextStringObject('Measuring')]+[refs[k] for k in ('walls','windows','doors','rooms')]),refs['other']])
    writer._root_object[NameObject('/OCProperties')] = DictionaryObject({NameObject('/OCGs'):ArrayObject(list(refs.values())), NameObject('/D'):config})
    stream = ContentStream(page['/Contents'],writer); original = list(stream.operations); output=[]; stack=[]
    for operands,operator in original:
        track(stack,operands,operator)
        if operator in PAINT:
            key = assignments.get(group(stack),'other')
            output.extend([([NameObject('/OC'),NameObject(aliases[key])],b'BDC'),(operands,operator),([],b'EMC')])
        else: output.append((operands,operator))
    # Original operation objects are kept intact and in the original order.
    stream.operations=output; page[NameObject('/Contents')]=writer._add_object(stream)
    buffer=io.BytesIO(); writer.write(buffer)
    return buffer.getvalue(), len(original), len(output)

def run(source, page_number, profile, output):
    started=time.monotonic(); raw=source.read_bytes(); sha=digest(raw)
    identity={'sourceSha256':sha,'page':page_number,'profile':profile,'workerVersion':VERSION}
    key=digest(json.dumps(identity,sort_keys=True).encode()); folder=output/key; marker=folder/'layer-manifest.json'
    if marker.exists():
        result=json.loads(marker.read_text())
        if all((folder/name).exists() and digest((folder/name).read_bytes())==h for name,h in result['artifactSha256'].items()):
            return {'cacheHit':True,'folder':str(folder),'manifest':result}
    folder.mkdir(parents=True,exist_ok=True)
    marker.unlink(missing_ok=True)
    reader=PdfReader(io.BytesIO(raw)); index=page_number-1
    if not 0<=index<len(reader.pages): raise ValueError('Page outside source document')
    page=reader.pages[index]
    original=PdfWriter(); original.add_page(page)
    with (folder/'original-page.pdf').open('wb') as f: original.write(f)
    doc=fitz.open(stream=raw,filetype='pdf'); fp=doc[index]
    fp.get_pixmap(matrix=fitz.Matrix(.75,.75)).save(folder/'full-page.png')
    drawings=fp.get_drawings()
    write_json(folder/'full-page.json',{'source':identity,'pageRect':list(fp.rect),'mediaBox':list(page.mediabox),'cropBox':list(page.cropbox),'rotation':fp.rotation,'coordinateSystem':'PYMUPDF_POINTS_TOP_LEFT','pdfToGeometryTransform':list(fp.transformation_matrix),'text':fp.get_text(),'textBlocks':fp.get_text('blocks'),'drawings':drawings,'imageCount':len(fp.get_images()),'status':'CAPTURED_NOT_SEMANTICALLY_REVIEWED'})
    stack=[]; text=defaultdict(str)
    def before(op,args,cm,tm): track(stack,args,op)
    def visit(value,cm,tm,font,size):
        if value.strip(): text[group(stack)]+=value
    page.extract_text(visitor_operand_before=before,visitor_text=visit)
    groups=defaultdict(lambda:{'maxwidth':0,'gray':False,'regions':set()}); stack=[]; states=[]; width=1; fill=None
    for args,op in ContentStream(page['/Contents'],reader).operations:
        track(stack,args,op)
        if op==b'q': states.append((width,fill))
        elif op==b'Q' and states: width,fill=states.pop()
        elif op==b'w': width=float(args[0])
        elif op==b'rg': fill=tuple(float(a) for a in args)
        elif op==b'g': fill=(float(args[0]),)*3
        rec=groups[group(stack)]; rec['regions'].update(s for s in stack if s.startswith('/ViewRegion'))
        if op in (b'S',b's',b'B',b'b',b'B*',b'b*'): rec['maxwidth']=max(width,rec['maxwidth'])
        if op in (b'f',b'F',b'f*',b'B',b'b',b'B*',b'b*') and fill and all(.45<v<.55 for v in fill): rec['gray']=True
    # Existing OCG documents need an adapter preserving their nested configuration.
    supported=any(k.startswith('/Element') for k in groups) and '/OCProperties' not in reader.trailer['/Root']
    assignments={k:'other' for k in groups}; records=[]
    if supported:
        tag_names={k:k for k in groups}; tag_names['other']='other'
        tagged,_,_=apply_layers(reader,index,{k:k for k in groups},tag_names,list(tag_names))
        tagged_doc=fitz.open(stream=tagged,filetype='pdf'); geometry=defaultdict(list)
        for drawing in tagged_doc[0].get_drawings(): geometry[drawing['layer']].append(drawing)
        for k,rec in groups.items():
            category='other'; reason='No matching architectural candidate rule'
            if profile.get('textRegion') in rec['regions'] and re.search(r'[A-Za-z].*\d{3}\s*$',text[k],re.S):
                category='rooms'; reason='Room name and three-digit number in text view'
            elif profile.get('drawingRegion') in rec['regions']:
                paths=geometry[k]
                # Swing arc evidence; preserve the complete source element, not just the arc.
                swing=False
                for drawing in paths:
                    items=drawing['items']
                    if 7<=len(items)<=12 and all(it[0]=='l' for it in items):
                        a,b=items[0][1],items[-1][2]; dx,dy=abs(a.x-b.x),abs(a.y-b.y)
                        if 15<dx<45 and 15<dy<45 and abs(dx-dy)<.8: swing=True
                rects=[drawing['rect'] for drawing in paths]
                bounds=fitz.Rect(min(r.x0 for r in rects),min(r.y0 for r in rects),max(r.x1 for r in rects),max(r.y1 for r in rects)) if rects else fitz.Rect()
                short,long=sorted([bounds.width,bounds.height])
                if swing: category='doors'; reason='Quarter-swing geometry candidate'
                elif rec['maxwidth']>=profile.get('wallStrokeMin',1.2) or rec['gray']:
                    category='walls'; reason='Heavy stroke or gray wall-fill candidate'
                elif .3<short<12 and 18<long<110:
                    category='windows'; reason='Narrow frame candidate; may include sliding doors or other elements'
            assignments[k]=category
            records.append({'sourceElement':k,'layer':category,'reason':reason,'status':'UNVERIFIED' if category!='other' else 'UNCLASSIFIED','text':text[k]})
        layered,original_count,layered_count=apply_layers(reader,index,{k:('measuring' if v!='other' else 'other') for k,v in assignments.items()},{'measuring':'Measuring','other':'Not needed for measuring'},['measuring'])
        # Hide interactive annotations on the filtered copy; original-page retains them.
        filtered=fitz.open(stream=layered,filetype='pdf')
        for annotation in list(filtered[0].annots() or []): annotation.set_flags(annotation.flags|2)
        filtered.save(folder/'layers.pdf')
        assert filtered[0].rect==fp.rect
        filtered[0].get_pixmap(matrix=fitz.Matrix(.75,.75)).save(folder/'layers.png')
        status='CLASSIFICATION_REVIEW_REQUIRED'
    else:
        status='UNSUPPORTED_REQUIRES_OCR_OR_LAYER_ADAPTER'; original_count=layered_count=0
    artifacts={p.name:digest(p.read_bytes()) for p in folder.iterdir() if p.is_file() and p.name!='layer-manifest.json'}
    manifest={'identity':identity,'cacheKey':key,'brainCaptureStatus':'CAPTURED_NOT_SEMANTICALLY_REVIEWED','layerStatus':status,'scaleStatus':'NOT_CHECKED','takeoffAllowed':False,'defaultVisibleLayers':['measuring'],'measuringCategories':['walls','windows','doors','rooms'],'roomLabelsKeptTogether':True,'counts':{k:sum(v==k for v in assignments.values()) for k in LAYERS},'elements':records,'sourceOperations':original_count,'layeredOperations':layered_count,'artifactSha256':artifacts,'elapsedSeconds':round(time.monotonic()-started,3),'limitations':['Candidate rules are profile-specific, not validated semantic classification.','Window rule may include sliding doors; missing candidates require review.','Full-page capture is not OCR or complete visual interpretation.','Production queue integration is not installed.']}
    write_json(marker,manifest)
    return {'cacheHit':False,'folder':str(folder),'manifest':manifest}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--page',type=int,required=True);p.add_argument('--profile',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=run(a.source,a.page,json.loads(a.profile.read_text()),a.output)
    print(json.dumps({k:v for k,v in result.items() if k!='manifest'}|{k:result['manifest'][k] for k in ['layerStatus','counts','elapsedSeconds','takeoffAllowed']},indent=2))
