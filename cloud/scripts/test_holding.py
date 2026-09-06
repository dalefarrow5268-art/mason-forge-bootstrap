import pathlib,tempfile,zipfile,unittest
import fitz
import tomllib
from prepare_holding import prepare,sha
from native_capture import capture_page,write_capture
from scan_highres import render_retry,tile_clip
class HoldingTests(unittest.TestCase):
 def test_runner_release_gate_follows_wrangler_configuration(self):
  root=pathlib.Path(__file__).resolve().parents[1]
  expected=tomllib.loads((root/'wrangler.toml').read_text())['vars']['RELEASE_ID']
  runner=(root/'scripts'/'run_holding.py').read_text()
  self.assertIn("EXPECTED_RELEASE=CONFIG['vars']['RELEASE_ID']",runner)
  self.assertIn("x.get('text')==EXPECTED_RELEASE",runner)
  self.assertNotIn("x.get('text')=='2026-09-05-holding-detail-tiles-v2'",runner)
  self.assertEqual(expected,'2026-09-06-phase-one-brain-source-reuse')

 def test_high_resolution_retry_preserves_package_and_exact_region(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td);page=d/'page.pdf'
   with fitz.open() as doc:
    p=doc.new_page(width=612,height=792)
    p.insert_text((20,760),'WALDORF ASTORIA  LXR  CONRAD  CANOPY  SIGNIA HILTON  HILTON',fontsize=5)
    doc.save(page)
   prepared=d/'prepared.zip'
   with zipfile.ZipFile(prepared,'w',compression=zipfile.ZIP_DEFLATED) as archive:archive.write(page,'plans/page-00001.pdf')
   before=sha(prepared);out=d/'retry.png'
   result=render_retry(prepared,'plans/page-00001.pdf','plans/page-00001.pdf.brain-scan/tile-r3-c1.jpg',out)
   self.assertEqual(sha(prepared),before);self.assertEqual(result['preparedSha256'],before)
   self.assertGreaterEqual(result['width'],1100);self.assertGreater(result['renderDpi'],300)
   with fitz.open(page) as doc:self.assertEqual(result['clip'],list(tile_clip(doc[0].rect,'x.brain-scan/tile-r3-c1.jpg')))
   self.assertLess(out.stat().st_size,20*1024**2)

 def test_all_pages_and_originals(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td);pdf=d/'plan.pdf'
   with fitz.open() as doc:
    for n in range(3):
     p=doc.new_page(width=1200,height=800);p.insert_text((100,100),f'Sheet A{n} dimension 10 ft');p.draw_line((100,200),(1000,200));p.set_rotation(90 if n==1 else 0)
    doc.save(pdf)
   source=d/'source.zip'
   with zipfile.ZipFile(source,'w') as z:z.write(pdf,'plans/set.pdf');z.writestr('notes.txt','Original note')
   before=sha(source);m=prepare(source,'source.zip',d/'out.zip',d/'manifest.json')
   self.assertEqual(sha(source),before);self.assertEqual(m['pagesTotal'],3);self.assertEqual(m['unitsDone'],4);self.assertEqual(m['scanUnitsTotal'],4)
   self.assertEqual([x['originalPage'] for x in m['files'][0]['outputs']],[1,2,3]);self.assertTrue(all(len(x['scanAssets'])==0 for x in m['files'][0]['outputs']));self.assertTrue(all(x['nativeCapture']['captureStatus']=='CAPTURED_NOT_SEMANTICALLY_REVIEWED' for x in m['files'][0]['outputs']));self.assertFalse(m['scaleVerified'])
   prepare(source,'source.zip',d/'retry.zip',d/'retry.json')
   self.assertEqual(sha(d/'out.zip'),sha(d/'retry.zip'))
 def test_reject_unsafe(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td)
   with zipfile.ZipFile(d/'x.zip','w') as z:z.writestr('../escape.txt','bad')
   with self.assertRaises(ValueError):prepare(d/'x.zip','x.zip',d/'o.zip',d/'m.json')
 def test_native_capture_keeps_coordinates_and_fails_closed(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td);pdf=d/'native.pdf'
   with fitz.open() as doc:
    page=doc.new_page(width=1000,height=700);page.insert_text((80,90),'ROOM 101  12 FT 8 IN');page.draw_rect((50,50,950,650));doc.save(pdf)
   source_sha=sha(pdf)
   with fitz.open(pdf) as doc:record=capture_page(doc[0],source_sha,'plans/A2.1.pdf',0)
   self.assertEqual(record['captureStatus'],'CAPTURED_NOT_SEMANTICALLY_REVIEWED')
   self.assertEqual(record['source']['sha256'],source_sha)
   self.assertEqual(record['page']['rect'],[0.0,0.0,1000.0,700.0])
   self.assertGreater(record['signals']['wordCount'],0)
   self.assertGreater(record['signals']['drawingCount'],0)
   self.assertEqual(record['schemaVersion'],2)
   self.assertNotIn('drawings',record['evidence'])
   self.assertEqual(record['evidence']['drawingDigest']['count'],record['signals']['drawingCount'])
   self.assertEqual(record['evidence']['drawingDigest']['authoritativeGeometry'],'PRESERVED_SOURCE_PDF')
   self.assertEqual(len(record['evidence']['drawingDigest']['canonicalSha256']),64)
   self.assertFalse(record['signals']['semanticReviewComplete'])
   self.assertFalse(record['signals']['scaleVerified'])
   self.assertFalse(record['signals']['quantitiesVerified'])
 def test_dense_vector_capture_is_bounded_without_losing_source_authority(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td);pdf=d/'dense.pdf';capture=d/'capture.json'
   with fitz.open() as doc:
    page=doc.new_page(width=1000,height=700)
    for n in range(2500):
     x=n%1000;y=(n//1000)*10
     page.draw_line((x,y),(x+1,y+1))
    doc.save(pdf)
   with fitz.open(pdf) as doc:record=capture_page(doc[0],sha(pdf),'plans/dense.pdf',0)
   meta=write_capture(record,capture)
   self.assertGreater(record['signals']['drawingCount'],1000)
   self.assertLess(meta['sizeBytes'],20*1024**2)
   self.assertEqual(record['evidence']['drawingDigest']['count'],record['signals']['drawingCount'])
   self.assertNotIn('drawings',record['evidence'])
 def test_nested_and_empty(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td)
   with zipfile.ZipFile(d/'inner.zip','w') as z:z.writestr('a.txt','test')
   with zipfile.ZipFile(d/'x.zip','w') as z:z.write(d/'inner.zip','inner.zip')
   m=prepare(d/'x.zip','x.zip',d/'o.zip',d/'m.json');self.assertEqual(m['unitsDone'],1)
   with zipfile.ZipFile(d/'empty.zip','w'):pass
   with self.assertRaises(ValueError):prepare(d/'empty.zip','empty.zip',d/'e.zip',d/'e.json')
if __name__=='__main__':unittest.main()
