const HEX64 = /^[a-f0-9]{64}$/;

export function parseInternalSubjects(value) {
    return new Set(String(value ?? '')
        .split(',')
        .map(subject => subject.trim())
        .filter(subject => HEX64.test(subject)));
}

export function classifyLinkedTraffic(accountSubject, eventTrafficClass, internalSubjects) {
    if (eventTrafficClass === 'synthetic' || eventTrafficClass === 'test') return eventTrafficClass;
    return internalSubjects.has(accountSubject) ? 'internal' : 'real';
}
