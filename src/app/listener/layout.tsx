import ConsumerWithdrawalLink from '@/components/early-birds/ConsumerWithdrawalLink';
import { listenerWithdrawalPublicConfiguration } from '@/lib/listener/consumer-withdrawal';
import EarlyBirdLayout from '../early-birds/layout';

export default function ListenerLayout({ children }: { children: React.ReactNode }) {
    const withdrawalAvailable = listenerWithdrawalPublicConfiguration() !== null;
    return (
        <EarlyBirdLayout>
            {children}
            {withdrawalAvailable ? <div className="listener-consumer-request-links" aria-label="Consumer service actions">
                <ConsumerWithdrawalLink />
                <ConsumerWithdrawalLink kind="SERVICE_CANCELLATION" />
            </div> : null}
        </EarlyBirdLayout>
    );
}
