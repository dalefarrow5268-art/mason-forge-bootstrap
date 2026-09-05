import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dashboardRequest } from '../src/dashboard-auth.js';
const token = 'a'.repeat(64);
const env = { MASON_API_TOKEN: 'existing-token', MASON_DASHBOARD_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') };
for (const path of ['/api/connector/bootstrap','/api/projects/2/files','/api/continuity/system/mason-forge']) {
 const request = new Request('https://test.invalid'+path,{headers:{authorization:'Bearer '+token}});
 assert.equal((await dashboardRequest(request,env)).headers.get('authorization'),'Bearer existing-token');
 assert.equal(request.headers.get('authorization'),'Bearer '+token);
}
for (const [method,path,value] of [['POST','/api/connector/bootstrap',token],['GET','/mcp',token],['GET','/api/admin',token],['GET','/api/connector/bootstrap','b'.repeat(64)],['GET','/api/connector/bootstrap','']]) {
 const request = new Request('https://test.invalid'+path,{method,headers:{authorization:'Bearer '+value}});
 assert.equal(await dashboardRequest(request,env),request);
}
console.log('PASS: dedicated dashboard credential is restricted to existing GET routes; writes and invalid credentials are rejected.');
