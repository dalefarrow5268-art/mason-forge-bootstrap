import sqlite3,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1];db=sqlite3.connect(':memory:')
db.executescript((root/'schema/0022_plan_layer_handoff.sql').read_text())
db.executescript('''CREATE TABLE phase_one_items(id TEXT,job_id TEXT,original_path TEXT,status TEXT,category TEXT,output_file_id INT);
CREATE TABLE phase_one_jobs(id TEXT,source_file_id INT);
CREATE TABLE holding_preparations(source_file_id INT,prepared_file_id INT,status TEXT);
CREATE TABLE project_files(id INT,archived_at TEXT);
CREATE TABLE holding_scan_items(source_file_id INT,source_path TEXT,original_path TEXT,brain_key TEXT,status TEXT);
INSERT INTO phase_one_jobs VALUES('job',1);
INSERT INTO holding_preparations VALUES(1,2,'COMPLETE');
INSERT INTO project_files VALUES(3,NULL);
INSERT INTO phase_one_items VALUES('item','job','A.pdf','SORTED','Plans',3);
INSERT INTO holding_scan_items VALUES(1,'A.pdf','tile1','brain1','COMPLETE');
INSERT INTO holding_scan_items VALUES(1,'A.pdf','tile2','brain2','RUNNING');''')
sql=re.search(r'prepare\(`(.*?)`\)',(root/'src/plan-layer-handoff.js').read_text(),re.S)[1]
def queue():db.execute(sql,['now'])
queue();assert db.execute('SELECT COUNT(*) FROM plan_layer_jobs').fetchone()[0]==0
db.execute("UPDATE holding_scan_items SET status='COMPLETE'");queue();queue()
assert db.execute('SELECT COUNT(*) FROM plan_layer_jobs').fetchone()[0]==1
assert db.execute('SELECT brain_keys_json FROM plan_layer_jobs').fetchone()[0]=='["brain1","brain2"]'
print('Queue: partial page blocked, complete page routed, repeat deduplicated')

# Streaming page gate: nine completed tiles release while another page is incomplete.
db.execute('ALTER TABLE holding_scan_items ADD COLUMN category TEXT')
db.execute('ALTER TABLE holding_scan_items ADD COLUMN asset_role TEXT')
db.execute('ALTER TABLE holding_scan_items ADD COLUMN entry_index INTEGER')
db.execute('DELETE FROM holding_scan_items');db.execute('DELETE FROM plan_layer_jobs')
db.execute("UPDATE holding_preparations SET status='SCANNING'")
for n in range(9):
    db.execute('INSERT INTO holding_scan_items VALUES(?,?,?,?,?,?,?,?)',(1,'A.pdf',f'tile{n}',f'brain{n}','COMPLETE','Plans','DETAIL_TILE',n))
db.execute('INSERT INTO holding_scan_items VALUES(?,?,?,?,?,?,?,?)',(1,'B.pdf','tile0','brainB','RUNNING','Plans','DETAIL_TILE',10))
stream=re.search(r'completedPlanPagesSql=`(.*?)`;', (root/'src/holding-brain-scan.js').read_text(),re.S)[1]
assert [r[2] for r in db.execute(stream)]==['A.pdf']
db.execute("UPDATE holding_scan_items SET status='NEEDS_REVIEW' WHERE source_path='A.pdf' AND entry_index=8")
assert list(db.execute(stream))==[]
db.execute("DELETE FROM holding_scan_items WHERE source_path='A.pdf' AND entry_index=8")
assert list(db.execute(stream))==[]
print('Streaming: complete sheet released during batch scan; failed/missing tile blocks sheet')
