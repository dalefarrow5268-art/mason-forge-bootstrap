"""Lossless, disk-backed Holding preparation. No credentials or file content in logs."""
import hashlib, json, os, pathlib, shutil, stat, tempfile, zipfile
import fitz
LIMIT = 20 * 1024**2
MAX_EXPANDED = 20 * 1024**3

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def safe(name):
    return bool(name) and len(name)<1100 and not name.startswith('/') and '\\' not in name and ':' not in name and not any(ord(c)<32 for c in name) and all(p not in ('', '.', '..') for p in name.split('/'))

def prepare(source, name, output, manifest_path, progress=lambda m: None):
    manifest={'version':1,'sourceName':name,'sourceSha256':sha(source),'files':[], 'pagesTotal':0,'unitsDone':0,'scaleVerified':False}
    expanded=0
    with tempfile.TemporaryDirectory() as td, zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,allowZip64=True) as target:
        def write(path,arc):
            info=zipfile.ZipInfo(arc,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            with open(path,'rb') as src,target.open(info,'w',force_zip64=True) as dst:shutil.copyfileobj(src,dst,1024*1024)
        def add_file(path, original, depth=0):
            nonlocal expanded
            if depth>8: raise ValueError('Nested ZIP depth exceeds 8')
            if not safe(original): raise ValueError('Unsafe archive path')
            if original.lower().endswith('.zip'):
                with zipfile.ZipFile(path) as archive:
                    seen=set()
                    for entry in archive.infolist():
                        if entry.is_dir(): continue
                        if not safe(entry.filename) or entry.filename in seen or entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr>>16):
                            raise ValueError('Unsafe, duplicate, encrypted or linked archive entry')
                        seen.add(entry.filename); expanded+=entry.file_size
                        if expanded>MAX_EXPANDED or len(seen)>50000: raise ValueError('Archive resource budget exceeded')
                        local=pathlib.Path(td)/('entry-'+str(len(manifest['files']))+'-'+str(depth))
                        # Unique temp file; never use archive paths as local paths.
                        fd, temp_name=tempfile.mkstemp(dir=td);os.close(fd);local=pathlib.Path(temp_name)
                        with archive.open(entry) as src, open(local,'wb') as dst: shutil.copyfileobj(src,dst,1024*1024)
                        if local.stat().st_size!=entry.file_size: raise ValueError('Archive size mismatch')
                        add_file(local,original+'/'+entry.filename,depth+1);local.unlink()
                return
            row={'originalPath':original,'sha256':sha(path),'sizeBytes':pathlib.Path(path).stat().st_size,'outputs':[]}
            prefix=f"{len(manifest['files'])+1:05d}/"+original
            if original.lower().endswith('.pdf'):
                with fitz.open(path) as doc:
                    if doc.needs_pass or doc.page_count==0: raise ValueError('Encrypted or empty PDF')
                    row['pages']=doc.page_count;manifest['pagesTotal']+=doc.page_count
                    for n in range(doc.page_count):
                        with fitz.open(path) as page_source:
                            page=page_source[n]
                            out=pathlib.Path(td)/'page.pdf'
                            with fitz.open() as single:
                                single.insert_pdf(page_source,from_page=n,to_page=n,links=True,annots=True)
                                single.save(out,garbage=4,deflate=True,no_new_id=True)
                                if out.stat().st_size>LIMIT:
                                    single[0].clean_contents()
                                    out.unlink()
                                    single.save(out,garbage=4,deflate=True,no_new_id=True)
                            if out.stat().st_size>LIMIT: raise ValueError('Individual PDF page exceeds 20 MiB; preserved original requires review')
                            with fitz.open(out) as check:
                                q=check[0]
                                if q.rect!=page.rect or q.mediabox!=page.mediabox or q.cropbox!=page.cropbox or q.rotation!=page.rotation:
                                    raise ValueError('PDF page geometry changed')
                                # Compare rendered content including annotations; no downsampling in saved PDF.
                                a=page.get_pixmap(matrix=fitz.Matrix(.25,.25),alpha=False)
                                b=q.get_pixmap(matrix=fitz.Matrix(.25,.25),alpha=False)
                                if a.samples!=b.samples: raise ValueError(f'PDF page appearance changed: {original}, page {n+1}')
                            arc=prefix+f'/page-{n+1:05d}.pdf'
                            write(out,arc)
                            row['outputs'].append({'path':arc,'originalPage':n+1,'sha256':sha(out),'sizeBytes':out.stat().st_size,'mediaBox':list(page.mediabox),'cropBox':list(page.cropbox),'rotation':page.rotation,'scaleVerified':False,'textBlocks':page.get_text('blocks'),'links':page.get_links()})
                            manifest['unitsDone']+=1;progress(manifest)
            else:
                if row['sizeBytes']>LIMIT: raise ValueError('Non-PDF exceeds review size; original requires review')
                write(path,prefix);row['outputs'].append({'path':prefix,'sha256':row['sha256'],'sizeBytes':row['sizeBytes']})
                manifest['unitsDone']+=1;progress(manifest)
            manifest['files'].append(row)
        add_file(source,name)
    if not manifest['files']: raise ValueError('No project files in upload')
    with zipfile.ZipFile(output) as verify:
        expected=[o for f in manifest['files'] for o in f['outputs']]
        if verify.namelist()!=[o['path'] for o in expected]: raise ValueError('Prepared inventory mismatch')
        for o in expected:
            with verify.open(o['path']) as f:
                h=hashlib.sha256()
                for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
                if h.hexdigest()!=o['sha256']:raise ValueError('Prepared checksum mismatch')
    manifest['preparedSha256']=sha(output)
    pathlib.Path(manifest_path).write_text(json.dumps(manifest,indent=2,default=str))
    return manifest
