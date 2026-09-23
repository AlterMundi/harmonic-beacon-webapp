import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { StaffPrincipal } from '@/lib/ops-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';

export const EVENT_TIME_ZONES = ['America/Argentina/Buenos_Aires', 'America/Costa_Rica', 'UTC'] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class EventEditorError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function eventEditorFields(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EventEditorError(400, 'Datos inválidos.');
    const input = value as Record<string, unknown>;
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const scheduledAt = typeof input.scheduledAt === 'string' ? new Date(input.scheduledAt) : new Date(NaN);
    if (title.length < 3 || title.length > 160 || description.length > 4000 || /[\u0000-\u001f]/.test(title)) throw new EventEditorError(400, 'Revisá el título y la descripción.');
    if (!Number.isFinite(scheduledAt.getTime()) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(input.scheduledAt))) throw new EventEditorError(400, 'El horario debe incluir zona horaria.');
    if (!['SPANISH', 'ENGLISH'].includes(String(input.language))) throw new EventEditorError(400, 'Elegí el idioma.');
    if (!(EVENT_TIME_ZONES as readonly string[]).includes(String(input.eventTimeZone))) throw new EventEditorError(400, 'Elegí una zona horaria válida.');
    if (!UUID.test(String(input.facilitatorId))) throw new EventEditorError(400, 'Elegí un facilitador.');
    if (typeof input.publicAccess !== 'boolean' || typeof input.isPublished !== 'boolean') throw new EventEditorError(400, 'Revisá acceso y publicación.');
    let checkoutUrl: string | null = null;
    if (input.checkoutUrl) {
        try {
            const url = new URL(String(input.checkoutUrl));
            if (url.protocol !== 'https:' || url.username || url.password || !['tickets.harmonicbeacon.com', 'www.tickettailor.com', 'tickettailor.com'].includes(url.hostname)) throw Error();
            checkoutUrl = url.href;
        } catch { throw new EventEditorError(400, 'Usá un enlace HTTPS de Ticket Tailor.'); }
    }
    if (!input.publicAccess && input.isPublished && !checkoutUrl) throw new EventEditorError(400, 'Un evento con entrada requiere enlace de compra.');
    return {title, description: description || null, scheduledAt, language: input.language as 'SPANISH' | 'ENGLISH',
        eventTimeZone: String(input.eventTimeZone), facilitatorId: String(input.facilitatorId),
        publicAccess: input.publicAccess, isPublished: input.isPublished, checkoutUrl: input.publicAccess ? null : checkoutUrl};
}

export async function saveEvent(actor: StaffPrincipal, value: unknown, eventId?: string) {
    if (!hasStaffCapability(actor.role, 'administer_system')) throw new EventEditorError(403, 'No tenés permiso para administrar eventos.');
    const fields = eventEditorFields(value);
    const input = value as Record<string, unknown>;
    const id = eventId || String(input.id || randomUUID());
    if (!UUID.test(id)) throw new EventEditorError(400, 'Identificador inválido.');
    return prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event-editor:${id}`}, 0))`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM scheduled_sessions WHERE id::text=${id} FOR UPDATE`);
        const existing = await tx.scheduledSession.findUnique({where:{id}});
        if (eventId && !existing) throw new EventEditorError(404, 'No encontramos el evento.');
        if (existing) {
            if (!eventId) {
                const same = Object.entries(fields).every(([key, field]) => {
                    const stored = existing[key as keyof typeof existing];
                    return field instanceof Date ? stored instanceof Date && stored.getTime() === field.getTime() : stored === field;
                });
                if (same) return existing;
                throw new EventEditorError(409, 'Ese identificador ya se usó. Recargá la página.');
            }
            if (existing.status !== 'SCHEDULED') throw new EventEditorError(409, 'Sólo se editan eventos que todavía no comenzaron.');
            if (existing.updatedAt.toISOString() !== input.updatedAt) throw new EventEditorError(409, 'El evento cambió. Recargá antes de guardar.');
            // Changing identity/admission after tickets exist would strand access.
            if (existing.publicAccess !== fields.publicAccess || existing.facilitatorId !== fields.facilitatorId) {
                const tickets = await tx.ticketEntitlement.count({where:{scheduledSessionId:id}});
                if (tickets) throw new EventEditorError(409, 'Ya hay accesos emitidos: conservá el tipo de acceso y facilitador.');
            }
        }
        const facilitator = await tx.user.findFirst({where:{id:fields.facilitatorId,disabledAt:null,role:{in:['FACILITATOR','FACILITATOR_OP']}}});
        if (!facilitator) throw new EventEditorError(400, 'El facilitador seleccionado no está disponible.');
        if (!existing && fields.scheduledAt.getTime() < Date.now()) throw new EventEditorError(400, 'Elegí una fecha futura para el nuevo evento.');
        const event = existing
            ? await tx.scheduledSession.update({where:{id},data:fields})
            : await tx.scheduledSession.create({data:{...fields,id,roomName:`event-${id}`,paidMode:true,isTest:false,status:'SCHEDULED'}});
        await tx.auditLog.create({data:{actorUserId:actor.id,actorRole:actor.role,targetType:'scheduled_session',targetId:id,action:existing?'event.updated':'event.created',metadata:{eventId:id,isPublished:fields.isPublished,publicAccess:fields.publicAccess}}});
        return event;
    });
}
