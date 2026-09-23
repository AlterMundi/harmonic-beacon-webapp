import { beforeEach, describe, expect, it, vi } from 'vitest';
const tx=vi.hoisted(()=>({$queryRaw:vi.fn(),$executeRaw:vi.fn(),scheduledSession:{findUnique:vi.fn(),create:vi.fn(),update:vi.fn()},ticketEntitlement:{count:vi.fn()},user:{findFirst:vi.fn()},auditLog:{create:vi.fn()}}));
vi.mock('@/lib/db',()=>({prisma:{$transaction:async(fn:(value:typeof tx)=>unknown)=>fn(tx)}}));
import { eventEditorFields, saveEvent } from '../event-editor';
const actor={id:'staff',email:'synthetic@example.invalid',name:'Operator',role:'ADMIN' as const};
const fields={id:'80000000-0000-4000-8000-000000000001',title:'Synthetic gathering',description:'',scheduledAt:'2099-09-23T21:00:00Z',eventTimeZone:'America/Argentina/Buenos_Aires',language:'SPANISH',facilitatorId:'80000000-0000-4000-8000-000000000002',publicAccess:true,isPublished:false,checkoutUrl:''};
describe('event editor',()=>{
    beforeEach(()=>{vi.clearAllMocks();tx.scheduledSession.findUnique.mockResolvedValue(null);tx.user.findFirst.mockResolvedValue({id:fields.facilitatorId});tx.ticketEntitlement.count.mockResolvedValue(0);tx.scheduledSession.create.mockImplementation(async({data})=>data);tx.scheduledSession.update.mockImplementation(async({data})=>data);});
    it('creates a hidden free event without inherited attendee state',async()=>{
        const result=await saveEvent(actor,fields);
        expect(result).toMatchObject({isPublished:false,publicAccess:true,paidMode:true,isTest:false,status:'SCHEDULED',roomName:`event-${fields.id}`});
        expect(tx.auditLog.create).toHaveBeenCalledOnce();
    });
    it.each(['FACILITATOR','OPERATOR'] as const)('denies editing to %s',async role=>{
        await expect(saveEvent({...actor,role},fields)).rejects.toMatchObject({status:403});
        expect(tx.scheduledSession.create).not.toHaveBeenCalled();
    });
    it.each([{title:'x'},{scheduledAt:'2026-09-23T18:00'},{eventTimeZone:'unknown'},{facilitatorId:'bad'},{language:'xx'},{publicAccess:'true'},{isPublished:null},{checkoutUrl:'https://evil.invalid/'},{checkoutUrl:'javascript:alert(1)'},{publicAccess:false,isPublished:true,checkoutUrl:''}])('rejects invalid input %j',patch=>{
        expect(()=>eventEditorFields({...fields,...patch})).toThrow();
    });
    it('requires future dates only for newly created events',async()=>{
        await expect(saveEvent(actor,{...fields,scheduledAt:'2000-01-01T00:00:00Z'})).rejects.toMatchObject({status:400});
    });
    it('rejects a disabled or non-facilitator owner',async()=>{
        tx.user.findFirst.mockResolvedValue(null);
        await expect(saveEvent(actor,fields)).rejects.toMatchObject({status:400});
    });
    it('replays the same create without a second insert or audit',async()=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),id:fields.id});
        await saveEvent(actor,fields);
        expect(tx.scheduledSession.create).not.toHaveBeenCalled();expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
    it('does not treat a different payload as an idempotent create',async()=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),title:'different'});
        await expect(saveEvent(actor,fields)).rejects.toMatchObject({status:409});
    });
    it.each(['LIVE','ENDED','CANCELLED'])('does not edit an event in %s',async status=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),status,updatedAt:new Date()});
        await expect(saveEvent(actor,fields,fields.id)).rejects.toMatchObject({status:409});
    });
    it('rejects stale updates',async()=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),status:'SCHEDULED',updatedAt:new Date('2026-01-01Z')});
        await expect(saveEvent(actor,fields,fields.id)).rejects.toMatchObject({status:409});
    });
    it('preserves issued access when asked to change free to paid',async()=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),status:'SCHEDULED',updatedAt:new Date('2026-01-01Z')});
        tx.ticketEntitlement.count.mockResolvedValue(1);
        await expect(saveEvent(actor,{...fields,publicAccess:false,updatedAt:'2026-01-01T00:00:00.000Z'},fields.id)).rejects.toMatchObject({status:409});
    });
    it('allows publication without starting the session or mutating tickets',async()=>{
        tx.scheduledSession.findUnique.mockResolvedValue({...eventEditorFields(fields),status:'SCHEDULED',updatedAt:new Date('2026-01-01Z')});
        await saveEvent(actor,{...fields,isPublished:true,updatedAt:'2026-01-01T00:00:00.000Z'},fields.id);
        expect(tx.scheduledSession.update).toHaveBeenCalledWith({where:{id:fields.id},data:expect.objectContaining({isPublished:true})});
        expect(tx.scheduledSession.update.mock.calls[0][0].data).not.toHaveProperty('status');
    });
});
