import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { loadArtifact, verifyArtifactFiles } from './artifact.mjs';
import { verifySignedPath } from './auth.mjs';
import { verifyControlRequest } from './control-auth.mjs';
import { renderManifest } from './manifest.mjs';
import { MediaGrantRegistry, MEDIA_GRANT_ID_PATTERN } from './media-grants.mjs';
import { Metrics } from './metrics.mjs';

function send(response, status, body = '', headers = {}) {
  response.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function tokenFrom(url) {
  const expiresAt = Number(url.searchParams.get('exp'));
  return { expiresAt, signature: url.searchParams.get('sig') };
}

export function parseAllowedOrigins(value) {
  const origins = new Set();
  for (const item of String(value ?? '').split(',')) {
    const candidate = item.trim();
    if (!candidate) continue;
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
      throw new Error('BEACON_STREAM_ALLOWED_ORIGINS contains an invalid origin');
    }
    origins.add(parsed.origin);
  }
  if (origins.size === 0) {
    throw new Error('BEACON_STREAM_ALLOWED_ORIGINS must contain at least one origin');
  }
  return origins;
}

function crossOriginHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function authorized({ request, url, secret }) {
  return verifySignedPath({
    secret,
    // HEAD is an HTTP metadata view of the same signed GET resource. Browsers
    // may probe media before their first GET, so validate it against GET rather
    // than requiring a second signature that the manifest cannot carry.
    method: request.method === 'HEAD' ? 'GET' : request.method,
    pathname: url.pathname,
    ...tokenFrom(url),
  });
}

function mediaGrantFrom(url) {
  return {
    id: url.searchParams.get('grantId') ?? '',
    token: url.searchParams.get('grant') ?? '',
  };
}

function authorizedMedia({ request, url, secret, mediaGrants }) {
  const grant = mediaGrantFrom(url);
  if (grant.id || grant.token) return mediaGrants.authorize(grant);
  return authorized({ request, url, secret });
}

async function readBoundedBody(request, maximumBytes = 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function routeName(pathname) {
  if (pathname === '/healthz') return 'health';
  if (pathname.startsWith('/internal/v1/listener/media-grants/')) return 'grant_control';
  if (pathname.endsWith('/live.m3u8')) return 'manifest';
  if (pathname.includes('/segments/')) return 'segment';
  return 'unknown';
}

function mediaContentType(file) {
  if (file.endsWith('.mp4')) return 'video/mp4';
  if (file.endsWith('.m4s')) return 'video/iso.segment';
  return 'application/octet-stream';
}

export function createPublicHandler({ artifactRoot, metadata, publicOrigin, signingSecret, allowedOrigins = new Set(), metrics = new Metrics(), now = () => Date.now(), mediaGrants = new MediaGrantRegistry({ now }) }) {
  const manifestPath = `/v1/hls/${metadata.artifactId}/live.m3u8`;
  const segmentPrefix = `/v1/hls/${metadata.artifactId}/segments/`;

  return async (request, response) => {
    const startedAt = now();
    const url = new URL(request.url, 'http://listener.invalid');
    const route = routeName(url.pathname);
    let status = 500;
    let bytes = 0;
    const cors = crossOriginHeaders(request, allowedOrigins);
    const respond = (responseStatus, body = '', headers = {}) => (
      send(response, responseStatus, body, { ...cors, ...headers })
    );
    try {
      const controlPrefix = '/internal/v1/listener/media-grants/';
      if (request.method === 'PUT' && url.pathname.startsWith(controlPrefix)) {
        const grantId = url.pathname.slice(controlPrefix.length);
        const body = await readBoundedBody(request);
        if (!MEDIA_GRANT_ID_PATTERN.test(grantId)
          || !verifyControlRequest({
            secret: signingSecret,
            method: 'PUT',
            pathname: url.pathname,
            timestamp: request.headers['x-beacon-control-timestamp'],
            signature: request.headers['x-beacon-control-signature'],
            body,
            nowMs: now(),
          })) {
          status = 403;
          respond(status, 'forbidden\n', { 'Cache-Control': 'no-store' });
          return;
        }
        let payload;
        try { payload = JSON.parse(body.toString('utf8')); } catch { payload = null; }
        const result = payload && mediaGrants.upsert({
          id: grantId,
          tokenSha256: payload.tokenSha256,
          expiresAtMs: payload.expiresAtMs,
        });
        if (!result?.ok) {
          status = result?.reason === 'capacity' ? 503 : result?.reason === 'conflict' ? 409 : 400;
          respond(status, status === 503 ? 'unavailable\n' : 'invalid grant\n', { 'Cache-Control': 'no-store' });
          return;
        }
        status = 204;
        respond(status, '', { 'Cache-Control': 'no-store' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        status = 405;
        respond(status, 'method not allowed\n', { Allow: 'GET, HEAD' });
        return;
      }
      if (url.pathname === '/healthz') {
        status = 200;
        respond(status, 'ok\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return;
      }
      if (url.pathname === manifestPath) {
        if (!authorizedMedia({ request, url, secret: signingSecret, mediaGrants })) {
          status = 403;
          respond(status, 'forbidden\n', { 'Cache-Control': 'no-store' });
          return;
        }
        const grant = mediaGrantFrom(url);
        const manifest = renderManifest({
          metadata,
          origin: publicOrigin,
          secret: signingSecret,
          nowMs: now(),
          // A segment grant is derived from this manifest grant and must never
          // remain usable after the upstream Listener lease horizon.
          authorizationExpiresAtSeconds: tokenFrom(url).expiresAt,
          mediaAuthorizationQuery: grant.id ? { grantId: grant.id, grant: grant.token } : null,
        });
        status = 200;
        bytes = request.method === 'HEAD' ? 0 : Buffer.byteLength(manifest);
        respond(status, request.method === 'HEAD' ? '' : manifest, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'private, no-store',
        });
        return;
      }
      if (url.pathname.startsWith(segmentPrefix)) {
        if (!authorizedMedia({ request, url, secret: signingSecret, mediaGrants })) {
          status = 403;
          respond(status, 'forbidden\n', { 'Cache-Control': 'no-store' });
          return;
        }
        const file = decodeURIComponent(url.pathname.slice(segmentPrefix.length));
        if (!metadata.segmentByFile.has(file)) {
          status = 404;
          respond(status, 'not found\n', { 'Cache-Control': 'no-store' });
          return;
        }
        const segmentPath = path.resolve(artifactRoot, 'segments', file);
        const segmentsRoot = path.resolve(artifactRoot, 'segments');
        if (!segmentPath.startsWith(`${segmentsRoot}${path.sep}`)) {
          status = 404;
          respond(status, 'not found\n', { 'Cache-Control': 'no-store' });
          return;
        }
        const segment = await fs.readFile(segmentPath);
        status = 200;
        bytes = request.method === 'HEAD' ? 0 : segment.byteLength;
        respond(status, request.method === 'HEAD' ? '' : segment, {
          'Content-Type': mediaContentType(file),
          'Cache-Control': 'private, no-store',
          'Content-Length': String(segment.byteLength),
        });
        return;
      }
      status = 404;
      respond(status, 'not found\n', { 'Cache-Control': 'no-store' });
    } catch (error) {
      // Do not expose filesystem paths, credentials or signed URLs.
      status = error instanceof Error && error.message === 'body_too_large' ? 413 : 500;
      if (!response.headersSent) respond(status, status === 413 ? 'payload too large\n' : 'internal server error\n', { 'Cache-Control': 'no-store' });
    } finally {
      metrics.observe({ route, status, bytes, durationMs: Math.max(0, now() - startedAt) });
    }
  };
}

export function createInternalHandler({ metadata, metrics }) {
  return (request, response) => {
    const url = new URL(request.url, 'http://internal.invalid');
    if (request.method !== 'GET') return send(response, 405, 'method not allowed\n', { Allow: 'GET' });
    if (url.pathname === '/readyz') {
      return send(response, 200, `${JSON.stringify({ status: 'ready', artifactId: metadata.artifactId, epochUtc: metadata.timing.epochUtc })}\n`, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      });
    }
    if (url.pathname === '/metrics') {
      return send(response, 200, metrics.render(), {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store',
      });
    }
    return send(response, 404, 'not found\n', { 'Cache-Control': 'no-store' });
  };
}

export async function startFromEnvironment(environment = process.env) {
  const mediaRoot = environment.BEACON_STREAM_MEDIA_ROOT;
  const artifactId = environment.BEACON_STREAM_ARTIFACT_ID;
  const signingSecret = environment.BEACON_STREAM_SIGNING_SECRET;
  const publicOrigin = environment.BEACON_STREAM_PUBLIC_ORIGIN;
  const allowedOriginsValue = environment.BEACON_STREAM_ALLOWED_ORIGINS;
  if (!mediaRoot || !artifactId || !signingSecret || !publicOrigin || !allowedOriginsValue) {
    throw new Error('BEACON_STREAM_MEDIA_ROOT, BEACON_STREAM_ARTIFACT_ID, BEACON_STREAM_SIGNING_SECRET, BEACON_STREAM_PUBLIC_ORIGIN and BEACON_STREAM_ALLOWED_ORIGINS are required');
  }
  const allowedOrigins = parseAllowedOrigins(allowedOriginsValue);
  const { root: artifactRoot, metadata } = await loadArtifact({ mediaRoot, artifactId });
  await verifyArtifactFiles({ root: artifactRoot, metadata });
  const metrics = new Metrics();
  const publicServer = http.createServer(createPublicHandler({ artifactRoot, metadata, publicOrigin, signingSecret, allowedOrigins, metrics }));
  const internalServer = http.createServer(createInternalHandler({ metadata, metrics }));
  const publicPort = Number(environment.BEACON_STREAM_PORT ?? 8080);
  const internalPort = Number(environment.BEACON_STREAM_METRICS_PORT ?? 9090);
  const internalHost = environment.BEACON_STREAM_METRICS_BIND_HOST ?? '127.0.0.1';
  await Promise.all([
    new Promise((resolve) => publicServer.listen(publicPort, '0.0.0.0', resolve)),
    new Promise((resolve) => internalServer.listen(internalPort, internalHost, resolve)),
  ]);
  return { publicServer, internalServer, metadata };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startFromEnvironment().then(({ metadata }) => {
    // This deliberately includes only non-sensitive deployment state.
    console.log(`beacon-stream ready artifact=${metadata.artifactId}`);
  }).catch(() => {
    // Validation details can include a mounted path. Keep startup logs non-sensitive.
    console.error('beacon-stream failed startup validation');
    process.exitCode = 1;
  });
}
