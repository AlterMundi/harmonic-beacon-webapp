import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveStaffSession } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { trustedLiveRequestOrigin } from '@/lib/account-rp';
import { EventEditorError, saveEvent } from '@/lib/event-editor';

export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => NextResponse.json(body, {status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request: NextRequest) {
    const staff = await resolveStaffSession(request);
    if (!staff) return response({error:'Iniciá sesión como equipo.'},401);
    if (!hasStaffCapability(staff.role,'administer_system')) return response({error:'Sin permiso.'},403);
    const [events,facilitators] = await Promise.all([
        prisma.scheduledSession.findMany({orderBy:{scheduledAt:'desc'},take:200}),
        prisma.user.findMany({where:{disabledAt:null,role:{in:['FACILITATOR','FACILITATOR_OP']}},select:{id:true,name:true},orderBy:{name:'asc'}}),
    ]);
    return response({events,facilitators});
}
async function write(request: NextRequest, update: boolean) {
    try {
        if (request.headers.get('origin') !== trustedLiveRequestOrigin(request)) return response({error:'Origen inválido.'},403);
        const staff = await resolveStaffSession(request);
        if (!staff) return response({error:'Iniciá sesión como equipo.'},401);
        if (!hasStaffCapability(staff.role,'administer_system')) return response({error:'Sin permiso.'},403);
        const raw = await request.text();
        if (raw.length > 12000) return response({error:'Contenido demasiado largo.'},413);
        let body;
        try { body = JSON.parse(raw); } catch { return response({error:'Datos inválidos.'},400); }
        if (update && (!body || typeof body.id !== 'string')) return response({error:'Falta el evento.'},400);
        return response({event:await saveEvent(staff,body,update?body.id:undefined)});
    } catch(error) {
        if (error instanceof EventEditorError) return response({error:error.message},error.status);
        console.error('[event-editor] operation failed');
        return response({error:'No pudimos guardar. Recargá para comprobar el estado antes de reintentar.'},503);
    }
}
export const POST = (request:NextRequest) => write(request,false);
export const PUT = (request:NextRequest) => write(request,true);
