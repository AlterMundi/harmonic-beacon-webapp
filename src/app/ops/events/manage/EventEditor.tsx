'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Event = {id:string;title:string;description:string|null;scheduledAt:string;eventTimeZone:string;language:string;facilitatorId:string;publicAccess:boolean;isPublished:boolean;checkoutUrl:string|null;status:string;updatedAt:string;isTest:boolean};
type Facilitator = {id:string;name:string};
const offsets:Record<string,number> = {'America/Argentina/Buenos_Aires':-3,'America/Costa_Rica':-6,UTC:0};
const empty = () => ({id:crypto.randomUUID(),title:'',description:'',date:'',eventTimeZone:'America/Argentina/Buenos_Aires',language:'SPANISH',facilitatorId:'',publicAccess:true,isPublished:false,checkoutUrl:'',updatedAt:''});
const inputClass = 'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-deep)] p-3 text-[var(--paper)] focus-visible:outline-2 focus-visible:outline-[var(--gold)]';

export default function EventEditor({locale}:{locale:'es'|'en'}) {
    const en = locale==='en';
    const say = (es:string,english:string) => en?english:es;
    const [events,setEvents] = useState<Event[]>([]);
    const [facilitators,setFacilitators] = useState<Facilitator[]>([]);
    const [form,setForm] = useState<ReturnType<typeof empty>|null>(null);
    const [editing,setEditing] = useState(false);
    const [busy,setBusy] = useState(false);
    const [notice,setNotice] = useState('');
    const load = useCallback(async (signal?:AbortSignal) => {
        const response = await fetch('/api/ops/events',{signal,cache:'no-store'});
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        setEvents(data.events); setFacilitators(data.facilitators);
    },[]);
    useEffect(() => { const controller=new AbortController(); load(controller.signal).catch(error=>{if(!controller.signal.aborted)setNotice(error.message);}); return()=>controller.abort(); },[load]);
    const start = (event?:Event,duplicate=false) => {
        const next=empty();
        if(event){
            const zone=event.eventTimeZone in offsets?event.eventTimeZone:next.eventTimeZone;
            Object.assign(next,event,{id:duplicate?next.id:event.id,description:event.description||'',checkoutUrl:event.checkoutUrl||'',eventTimeZone:zone,
                date:duplicate?'':new Date(new Date(event.scheduledAt).getTime()+offsets[zone]*3600000).toISOString().slice(0,16),
                isPublished:duplicate?false:event.isPublished,updatedAt:duplicate?'':event.updatedAt});
        }
        else next.facilitatorId=facilitators[0]?.id||'';
        setEditing(Boolean(event&&!duplicate)); setForm(next); setNotice('');
    };
    const save = async (event:React.FormEvent) => {
        event.preventDefault(); if(!form||busy)return;
        setBusy(true);setNotice('');
        try {
            const scheduledAt=new Date(new Date(form.date+'Z').getTime()-offsets[form.eventTimeZone]*3600000).toISOString();
            const response=await fetch('/api/ops/events',{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,scheduledAt})});
            const data=await response.json(); if(!response.ok)throw Error(data.error);
            setForm(null); await load();
            setNotice(say('Guardado. ','Saved. ')+(data.event.isPublished?say('Publicado en la agenda. La sala todavía no se abre.','Published in the schedule. The room has not been opened.'):say('Oculto de la agenda.','Hidden from the schedule.')));
        }catch(error){setNotice(error instanceof Error?error.message:say('No se pudo guardar.','Could not save.'));}
        finally{setBusy(false);}
    };
    const cancel = async (event:Event) => {
        if(!window.confirm(say(`¿Cancelar «${event.title}»? Se conserva el historial.`,`Cancel “${event.title}”? History is preserved.`)))return;
        setBusy(true);
        try{
            const response=await fetch(`/api/ops/sessions/${event.id}/lifecycle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'CANCELLED',reason:'Cancelled from event administration'})});
            const data=await response.json();if(!response.ok)throw Error(data.message||data.error);
            await load();setNotice(say('Evento cancelado.','Event cancelled.'));
        }catch(error){setNotice(error instanceof Error?error.message:'Error');}finally{setBusy(false);}
    };
    const field = (key:keyof ReturnType<typeof empty>,value:string|boolean) => setForm(current=>current?{...current,[key]:value}:current);
    return <section className="mx-auto max-w-5xl space-y-6 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-subtle)] pb-6">
            <div><Link href="/ops/events" className="text-sm text-[var(--gold)]">← {say('Operación','Operations')}</Link><h1 className="mt-3 font-serif text-3xl">{say('Administrar eventos','Manage events')}</h1><p className="mt-2 text-sm text-[var(--text-secondary)]">{say('Prepará el encuentro. Publicalo cuando esté listo.','Prepare the gathering. Publish it when ready.')}</p></div>
            <button disabled={busy} className="rounded-lg bg-[var(--gold)] px-5 py-3 text-black disabled:opacity-50" onClick={()=>start()}>{say('Crear evento','Create event')}</button>
        </header>
        {notice&&<p role="status" className="rounded-lg border border-[var(--gold)] p-4">{notice}</p>}
        {form&&<form onSubmit={save} className="space-y-5 rounded-xl border border-[var(--border-subtle)] p-5">
            <h2 className="font-serif text-2xl">{editing?say('Editar evento','Edit event'):say('Nuevo evento','New event')}</h2>
            <label className="block">{say('Título','Title')}<input required minLength={3} maxLength={160} className={inputClass} value={form.title} onChange={e=>field('title',e.target.value)} /></label>
            <label className="block">{say('Descripción','Description')}<textarea rows={3} maxLength={4000} className={inputClass} value={form.description} onChange={e=>field('description',e.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
                <label>{say('Zona horaria','Time zone')}<select className={inputClass} value={form.eventTimeZone} onChange={e=>field('eventTimeZone',e.target.value)}><option value="America/Argentina/Buenos_Aires">Argentina · UTC−3</option><option value="America/Costa_Rica">Costa Rica · UTC−6</option><option value="UTC">UTC</option></select></label>
                <label>{say('Fecha y hora en esa zona','Date and time in that zone')}<input type="datetime-local" required className={inputClass} value={form.date} onChange={e=>field('date',e.target.value)} /></label>
                <label>{say('Idioma','Language')}<select className={inputClass} value={form.language} onChange={e=>field('language',e.target.value)}><option value="SPANISH">Español</option><option value="ENGLISH">English</option></select></label>
                <label>{say('Facilitador','Facilitator')}<select required className={inputClass} value={form.facilitatorId} onChange={e=>field('facilitatorId',e.target.value)}><option value="">{say('Seleccionar','Select')}</option>{facilitators.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            </div>
            <label className="flex gap-3"><input type="checkbox" checked={form.publicAccess} onChange={e=>field('publicAccess',e.target.checked)} />{say('Entrada gratuita con Cuenta Beacon','Free entry with Beacon Account')}</label>
            {!form.publicAccess&&<label className="block">{say('Enlace de compra de Ticket Tailor','Ticket Tailor checkout link')}<input type="url" className={inputClass} value={form.checkoutUrl} onChange={e=>field('checkoutUrl',e.target.value)} /><small>{say('El enlace no configura por sí solo pagos ni entrega de accesos.','The link alone does not configure payments or access provisioning.')}</small></label>}
            <label className="flex gap-3"><input type="checkbox" checked={form.isPublished} onChange={e=>field('isPublished',e.target.checked)} />{say('Publicado: visible en la agenda','Published: visible in the schedule')}</label>
            <p className="text-sm text-[var(--text-muted)]">{say('Publicar no abre la sala. Los accesos ya emitidos se conservan al ocultar.','Publishing does not open the room. Hiding preserves previously issued access.')}</p>
            <div className="flex gap-4"><button disabled={busy} className="rounded-lg bg-[var(--gold)] px-5 py-3 text-black disabled:opacity-50">{busy?say('Guardando…','Saving…'):say('Guardar cambios','Save changes')}</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>{say('Cerrar','Close')}</button></div>
        </form>}
        <ul className="divide-y divide-[var(--border-subtle)]">{events.map(event=><li key={event.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div><h2 className="font-serif text-xl">{event.title}</h2><p className="text-sm text-[var(--text-secondary)]">{new Intl.DateTimeFormat(en?'en':'es',{dateStyle:'medium',timeStyle:'short',timeZone:event.eventTimeZone}).format(new Date(event.scheduledAt))} · {event.eventTimeZone}</p><p className="text-xs">{event.status} · {event.isPublished?say('Publicado','Published'):say('Oculto','Hidden')}{event.isTest?' · TEST':''}</p></div>
            <div className="flex flex-wrap gap-4 text-sm text-[var(--gold)]"><button disabled={busy} onClick={()=>start(event,true)}>{say('Duplicar','Duplicate')}</button>{event.status==='SCHEDULED'&&<><button disabled={busy} onClick={()=>start(event)}>{say('Editar','Edit')}</button><button disabled={busy} onClick={()=>cancel(event)}>{say('Cancelar evento','Cancel event')}</button></>}<Link href={`/ops/events/${event.id}`}>{say('Operar','Operate')}</Link></div>
        </li>)}</ul>
        {!events.length&&<p>{say('Todavía no hay eventos para mostrar.','No events to display yet.')}</p>}
    </section>;
}
