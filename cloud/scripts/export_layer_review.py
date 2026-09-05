"""Export the approved Bradenton source and measuring-layer PDFs for visual review."""
import json, os, pathlib
from run_holding import query, r2

def main():
    output=pathlib.Path(os.environ['OUTPUT_DIR']);output.mkdir(parents=True,exist_ok=True)
    jobs=query("""SELECT l.id,l.status,l.manifest_key,source.r2_key source_key,layer.r2_key layer_key
      FROM plan_layer_jobs l JOIN project_files source ON source.id=l.plan_file_id
      JOIN project_files layer ON layer.id=l.layered_file_id
      WHERE l.id IN ('plan-layers-3000','plan-layers-3002','plan-layers-3012')
      ORDER BY l.id""")
    if len(jobs)!=3 or any(x['status'] not in ('LAYER_REVIEW_REQUIRED','READY_FOR_TAKEOFF') for x in jobs):
        raise RuntimeError('Bradenton layer packages are not available for review export')
    summary=[]
    for job in jobs:
        stem=job['id'];source=output/f'{stem}-source.pdf';layer=output/f'{stem}-layers.pdf';manifest=output/f'{stem}-manifest.json'
        r2('get',job['source_key'],source);r2('get',job['layer_key'],layer);r2('get',job['manifest_key'],manifest)
        summary.append({'id':stem,'source':source.name,'layers':layer.name,'manifest':manifest.name})
    (output/'review-index.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary))

if __name__=='__main__':main()
