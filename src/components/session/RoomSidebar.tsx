'use client';

import { useId, useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import SessionContributions from './SessionContributions';
import SessionAliasEditor from '@/components/brand/SessionAliasEditor';

export type RoomPerson = {
    identity: string;
    name: string;
    local: boolean;
    publishing: boolean;
    microphone: boolean;
    speaking: boolean;
};

export default function RoomSidebar({ sessionId, people, staff = false, canEditName = false }: {
    sessionId: string; people: RoomPerson[]; staff?: boolean; canEditName?: boolean;
}) {
    const { locale } = useLocale();
    const es = locale === 'es';
    const prefix = useId();
    const [panel, setPanel] = useState<'chat' | 'people'>('chat');
    const [search, setSearch] = useState('');
    const filtered = people.filter(person => person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <aside className="hb-room-sidebar" aria-label={es ? 'Conversación y participantes' : 'Conversation and participants'}>
        <div className="hb-room-tabs" role="tablist" aria-label={es ? 'Panel de la sala' : 'Room panel'}>
            {(['chat', 'people'] as const).map((key, index) => <button key={key} type="button" role="tab"
                id={`${prefix}-${key}`} aria-controls={`${prefix}-${key}-panel`} aria-selected={panel === key}
                tabIndex={panel === key ? 0 : -1} onClick={() => setPanel(key)} onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'people' : index === 0 ? 'people' : 'chat';
                    setPanel(next); document.getElementById(`${prefix}-${next}`)?.focus();
                }}>
                {key === 'chat' ? 'Chat' : <>{es ? 'Participantes' : 'Participants'} <span>{people.length}</span></>}
            </button>)}
        </div>
        <div role="tabpanel" id={`${prefix}-chat-panel`} aria-labelledby={`${prefix}-chat`} hidden={panel !== 'chat'}>
            <SessionContributions sessionId={sessionId} staff={staff} panelActive={panel === 'chat'} />
        </div>
        <section role="tabpanel" id={`${prefix}-people-panel`} aria-labelledby={`${prefix}-people`} hidden={panel !== 'people'} className="hb-room-people">
            {canEditName && <div className="mb-5"><SessionAliasEditor sessionId={sessionId} presentation="room" /></div>}
            <label htmlFor={`${prefix}-search`}>{es ? 'Buscar participante' : 'Find a participant'}</label>
            <input id={`${prefix}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={es ? 'Nombre en la sala' : 'Room name'} />
            {people.length === 0 ? <p role="status">{es ? 'La lista aparecerá al conectar la sala.' : 'The list appears when the room connects.'}</p> : <ul>
                {filtered.map(person => <li key={person.identity}>
                    <span className="hb-person-avatar" aria-hidden="true">{person.name.slice(0, 1).toLocaleUpperCase()}</span>
                    <div><strong>{person.name}{person.local ? (es ? ' (vos)' : ' (you)') : ''}</strong>
                        <span>{person.speaking ? (es ? 'Hablando' : 'Speaking') : person.publishing ? (es ? 'En escena' : 'On stage') : (es ? 'Escuchando' : 'Listening')}</span>
                    </div>
                    {person.publishing && <span aria-label={person.microphone ? (es ? 'Micrófono encendido' : 'Microphone on') : (es ? 'Micrófono apagado' : 'Microphone off')} className={`hb-person-mic ${person.microphone ? 'is-on' : ''}`}>{person.microphone ? '●' : '—'}</span>}
                </li>)}
                {filtered.length === 0 && <li>{es ? 'No encontramos ese nombre.' : 'No matching names.'}</li>}
            </ul>}
        </section>
    </aside>;
}
