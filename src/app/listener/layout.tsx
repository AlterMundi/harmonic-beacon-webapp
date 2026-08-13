import ConsumerWithdrawalLink from '@/components/early-birds/ConsumerWithdrawalLink';
import EarlyBirdLayout from '../early-birds/layout';

export default function ListenerLayout({ children }: { children: React.ReactNode }) {
    return (
        <EarlyBirdLayout>
            <ConsumerWithdrawalLink />
            {children}
        </EarlyBirdLayout>
    );
}
