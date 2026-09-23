// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import EventEditor from '../EventEditor';
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
const response=(data:unknown)=>({ok:true,json:async()=>data});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('creates with an explicit zone and keeps a visible saved confirmation',async()=>{
    const fetch=vi.fn().mockResolvedValue(response({events:[],facilitators:[{id:'80000000-0000-4000-8000-000000000002',name:'Facilitator'}]}));
    vi.stubGlobal('fetch',fetch);
    render(<EventEditor locale="es"/>);
    await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText('Crear evento'));
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Encuentro sintético'}});
    fireEvent.change(screen.getByLabelText('Fecha y hora en esa zona'),{target:{value:'2099-09-23T18:00'}});
    fetch.mockResolvedValueOnce(response({event:{isPublished:false}}));
    fireEvent.click(screen.getByText('Guardar cambios'));
    await screen.findByText('Guardado. Oculto de la agenda.');
    const call=fetch.mock.calls.find(([,options])=>options?.method==='POST');
    expect(call).toBeDefined();
    expect(JSON.parse(call![1].body)).toMatchObject({scheduledAt:'2099-09-23T21:00:00.000Z',publicAccess:true,isPublished:false});
});
it('duplicates without history, publication or inherited date',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({facilitators:[],events:[{id:'old',title:'Previous',description:null,scheduledAt:'2026-09-23T21:00:00Z',eventTimeZone:'America/Argentina/Buenos_Aires',language:'SPANISH',facilitatorId:'owner',publicAccess:true,isPublished:true,checkoutUrl:null,status:'ENDED',updatedAt:'2026-09-23T21:00:00Z',isTest:false}]})));
    render(<EventEditor locale="en"/>);
    fireEvent.click(await screen.findByText('Duplicate'));
    expect(screen.getByLabelText('Title')).toHaveValue('Previous');
    expect(screen.getByLabelText('Date and time in that zone')).toHaveValue('');
    expect(screen.getByLabelText('Published: visible in the schedule')).not.toBeChecked();
    expect(screen.queryByText('Cancel event')).toBeNull();
});
