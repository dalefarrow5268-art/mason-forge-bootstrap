// Dedicated read-only dashboard credential. Only its SHA-256 verifier is stored here.
export async function dashboardRequest(request, env) {
  if (request.method !== 'GET' || !env.MASON_API_TOKEN || !/^[a-f0-9]{64}$/.test(env.MASON_DASHBOARD_TOKEN_SHA256 || '')) return request;
  const path = new URL(request.url).pathname;
  const allowed = ['/health', '/api/connector/bootstrap', '/api/continuity'].includes(path)
    || /^\/api\/continuity\/[^/]+\/[^/]+$/.test(path)
    || /^\/api\/projects\/\d+\/(status|files|file-reconciliation|tasks|outputs|findings|evidence|rfis|contacts|continuity)$/.test(path)
    || /^\/api\/projects\/\d+\/files\/\d+(\/source)?$/.test(path);
  if (!allowed) return request;
  const header = request.headers.get('authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/.test(header)) return request;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header.slice(7)));
  const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= hash.charCodeAt(i) ^ env.MASON_DASHBOARD_TOKEN_SHA256.charCodeAt(i);
  if (difference) return request;
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${env.MASON_API_TOKEN}`);
  return new Request(request, { headers });
}
