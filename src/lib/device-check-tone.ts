/** A quiet, local 650 ms PCM test tone; contains no captured media. */
export function deviceCheckTone(): Blob {
    const rate = 16_000;
    const count = rate * 0.65;
    const bytes = new ArrayBuffer(44 + count * 2);
    const view = new DataView(bytes);
    const text = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
    text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i += 1) {
        const t = i / rate;
        const envelope = Math.min(1, t / 0.03, (0.65 - t) / 0.06);
        view.setInt16(44 + i * 2, Math.round(0.16 * 32767 * envelope * Math.sin(2 * Math.PI * (t < 0.32 ? 440 : 660) * t)), true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
}
