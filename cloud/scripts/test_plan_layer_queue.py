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
