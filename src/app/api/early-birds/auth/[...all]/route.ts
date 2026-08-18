/** Legacy Listener OAuth/magic-link authority is intentionally gone. */
function unavailable(_request: Request): Response {
    void _request;
    return Response.json({ error: 'not_found' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

export const GET = unavailable;
export const POST = unavailable;
