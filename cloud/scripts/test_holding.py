import pathlib,tempfile,zipfile,unittest
import fitz
import tomllib
from prepare_holding import prepare,sha
class HoldingTests(unittest.TestCase):
 def test_runner_release_gate_follows_wrangler_configuration(self):
  root=pathlib.Path(__file__).resolve().parents[1]
  expected=tomllib.loads((root/'wrangler.toml').read_text())['vars']['RELEASE_ID']
  runner=(root/'scripts'/'run_holding.py').read_text()
  self.assertIn("EXPECTED_RELEASE=CONFIG['vars']['RELEASE_ID']",runner)
  self.assertIn("x.get('text')==EXPECTED_RELEASE",runner)
  self.assertNotIn("x.get('text')=='2026-09-05-holding-detail-tiles-v2'",runner)
  self.assertEqual(expected,'2026-09-05-brain-lobe-routing-v1')

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
   self.assertEqual(sha(source),before);self.assertEqual(m['pagesTotal'],3);self.assertEqual(m['unitsDone'],4);self.assertEqual(m['scanUnitsTotal'],28)
   self.assertEqual([x['originalPage'] for x in m['files'][0]['outputs']],[1,2,3]);self.assertTrue(all(len(x['scanAssets'])==9 for x in m['files'][0]['outputs']));self.assertFalse(m['scaleVerified'])
   prepare(source,'source.zip',d/'retry.zip',d/'retry.json')
   self.assertEqual(sha(d/'out.zip'),sha(d/'retry.zip'))
 def test_reject_unsafe(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td)
   with zipfile.ZipFile(d/'x.zip','w') as z:z.writestr('../escape.txt','bad')
   with self.assertRaises(ValueError):prepare(d/'x.zip','x.zip',d/'o.zip',d/'m.json')
 def test_nested_and_empty(self):
  with tempfile.TemporaryDirectory() as td:
   d=pathlib.Path(td)
   with zipfile.ZipFile(d/'inner.zip','w') as z:z.writestr('a.txt','test')
   with zipfile.ZipFile(d/'x.zip','w') as z:z.write(d/'inner.zip','inner.zip')
   m=prepare(d/'x.zip','x.zip',d/'o.zip',d/'m.json');self.assertEqual(m['unitsDone'],1)
   with zipfile.ZipFile(d/'empty.zip','w'):pass
   with self.assertRaises(ValueError):prepare(d/'empty.zip','empty.zip',d/'e.zip',d/'e.json')
if __name__=='__main__':unittest.main()
