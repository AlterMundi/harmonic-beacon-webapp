import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

/** Real-browser component boundary fixture: no database, credentials or LiveKit.
 * Only Next routing and operational API panels are substituted. The actual
 * locale control/provider and persistent cockpit render in parent + iframe.
 */
export async function navigationBrowser(): Promise<{ origin: string; close: () => Promise<void> }> {
    const result = await build({
        entryPoints: [resolve('e2e/fixtures/navigation-browser-app.tsx')], bundle: true,
        write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'browser-boundaries', setup(builder) {
            builder.onResolve({ filter: /^next\/(navigation|link|script)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
            builder.onResolve({ filter: /\/(SessionLifecycleControl|SpotlightConsole|TapestryArrange|AdmissionConsole|SessionContributionsStaff|OpsTapestry|OpsHealthClient)$/ }, ({ path }) => ({ path, namespace: 'panel' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path.endsWith('script') ? 'export default function Script(){ return null; }' : path.endsWith('link')
                ? 'export default "a";'
                : `export const usePathname=()=>location.pathname; export const useRouter=()=>({refresh:()=>{window.__refreshes=(window.__refreshes||0)+1},push:(url)=>location.assign(url),replace:(url)=>location.replace(url)});` }));
            builder.onLoad({ filter: /.*/, namespace: 'panel' }, () => ({ loader: 'js', contents: 'export default function Panel(){return null}' }));
        } }],
    });
    const script = result.outputFiles[0].text;
    const pinnedNavigation = await readFile(resolve('public/assets/hb-global-nav.js'), 'utf8');
    const server: Server = createServer((req, res) => {
        if (req.url === '/assets/hb-global-nav.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(pinnedNavigation); return; }
        if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); return; }
        res.setHeader('Content-Type', 'text/html');
        if (req.url?.startsWith('/away')) { res.end('<a href="/ops/events/event-1">Enter event</a><h1>Away</h1>'); return; }
        res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Continuity fixture</title><div id="root"></div><script src="/fixture.js"></script></html>');
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((done, reject) => server.close(error => error ? reject(error) : done())) };
}
