#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { connect } from 'node:net';
import process from 'node:process';

function parseArgs(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error('Usage: livekit-tls-proxy.mjs --cert PATH --key PATH --listen-port PORT --upstream-port PORT');
        }
        values.set(name, value);
    }
    const port = (name) => {
        const value = Number(values.get(name));
        if (!Number.isInteger(value) || value < 1024 || value > 65535) {
            throw new Error(`${name} must be an unprivileged TCP port`);
        }
        return value;
    };
    const cert = values.get('--cert');
    const key = values.get('--key');
    if (!cert || !key || values.size !== 4) {
        throw new Error('Exactly --cert, --key, --listen-port and --upstream-port are required');
    }
    return { cert, key, listenPort: port('--listen-port'), upstreamPort: port('--upstream-port') };
}

export async function startLoopbackTlsProxy(options) {
    const tls = {
        cert: await readFile(options.cert),
        key: await readFile(options.key),
    };
    const sockets = new Set();
    const track = (socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        return socket;
    };
    const server = createServer(tls, (incoming, response) => {
        const outgoing = request({
            host: '127.0.0.1',
            port: options.upstreamPort,
            method: incoming.method,
            path: incoming.url,
            headers: incoming.headers,
        }, (upstream) => {
            response.writeHead(upstream.statusCode ?? 502, upstream.headers);
            upstream.pipe(response);
        });
        outgoing.on('socket', track);
        outgoing.on('error', () => {
            if (!response.headersSent) response.writeHead(502);
            response.end();
        });
        response.once('close', () => outgoing.destroy());
        incoming.pipe(outgoing);
    });
    server.on('upgrade', (incoming, socket, head) => {
        const upstream = track(connect(options.upstreamPort, '127.0.0.1', () => {
            upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n`);
            for (const [name, value] of Object.entries(incoming.headers)) {
                if (Array.isArray(value)) {
                    for (const item of value) upstream.write(`${name}: ${item}\r\n`);
                } else if (value !== undefined) {
                    upstream.write(`${name}: ${value}\r\n`);
                }
            }
            upstream.write('\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
        }));
        upstream.once('error', () => socket.destroy());
        socket.once('error', () => upstream.destroy());
        socket.once('close', () => upstream.destroy());
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.listenPort, '127.0.0.1', resolve);
    });
    let closing;
    return {
        close: () => closing ??= new Promise((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
            server.closeAllConnections();
        }),
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const proxy = await startLoopbackTlsProxy(options);
    console.log(JSON.stringify({
        status: 'ready',
        listen: `wss://127.0.0.1:${options.listenPort}`,
        upstream: `ws://127.0.0.1:${options.upstreamPort}`,
    }));
    const shutdown = () => void proxy.close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
