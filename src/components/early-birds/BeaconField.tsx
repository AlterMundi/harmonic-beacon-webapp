import type { ListenerPresentationPhase } from './listener-presentation';

const POINTS = [
    ['12%', '32%'], ['21%', '58%'], ['31%', '24%'], ['41%', '67%'],
    ['52%', '19%'], ['61%', '49%'], ['72%', '28%'], ['83%', '61%'],
    ['90%', '38%'], ['34%', '82%'], ['68%', '78%'], ['48%', '43%'],
] as const;

export default function BeaconField({ phase }: { phase: ListenerPresentationPhase }) {
    return (
        <div className="listener-field" data-phase={phase} aria-hidden="true">
            <div className="listener-field__aurora" />
            <div className="listener-field__orbit listener-field__orbit--outer" />
            <div className="listener-field__orbit listener-field__orbit--inner" />
            <div className="listener-field__core">
                <span className="listener-field__spark">&#10022;</span>
            </div>
            <div className="listener-field__horizon" />
            {POINTS.map(([left, top], index) => (
                <span
                    key={`${left}-${top}`}
                    className="listener-field__point"
                    style={{ left, top, '--point-delay': `${index * -0.37}s` } as React.CSSProperties}
                />
            ))}
        </div>
    );
}
