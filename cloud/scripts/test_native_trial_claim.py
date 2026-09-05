import sqlite3,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1];db=sqlite3.connect(':memory:')
db.executescript((root/'schema/0018_holding_brain_scan.sql').read_text());db.executescript((root/'schema/0023_native_page_scan_trials.sql').read_text())
db.execute('ALTER TABLE holding_scan_items ADD COLUMN source_path TEXT');db.execute('ALTER TABLE holding_scan_items ADD COLUMN asset_role TEXT')
for n in range(9): db.execute("INSERT INTO holding_scan_items(id,source_file_id,entry_index,original_path,source_path,size_bytes,asset_role,updated_at) VALUES(?,1,?,'tile','page.pdf',1,'DETAIL_TILE','now')",[str(n),n])
s=(root/'src/holding-brain-scan.js').read_text();q=re.search(r'prepare\(`(INSERT INTO native_page_scan_trials.*?)`\)',s,re.S)[1]
args=['trial',1,'page.pdf','now',1,'page.pdf'];db.execute(q,args)
assert db.execute('SELECT COUNT(*) FROM native_page_scan_trials').fetchone()[0]==1
# Duplicate claim and a page with any previous attempt cannot be claimed.
db.execute(q,['again',1,'page.pdf','now',1,'page.pdf']);assert db.execute('SELECT COUNT(*) FROM native_page_scan_trials').fetchone()[0]==1
db.execute('DELETE FROM native_page_scan_trials');db.execute("UPDATE holding_scan_items SET attempts=1 WHERE id='0'");db.execute(q,args);assert db.execute('SELECT COUNT(*) FROM native_page_scan_trials').fetchone()[0]==0
print('Native trial claim: only unstarted complete tile inventories; duplicate and previously attempted page protected')
