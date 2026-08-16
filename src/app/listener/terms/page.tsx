import ListenerLegal from '@/components/early-birds/ListenerLegal';
import { listenerWithdrawalPublicConfiguration } from '@/lib/listener/consumer-withdrawal';

export const dynamic = 'force-dynamic';

export default function ListenerTermsPage() {
    return <ListenerLegal withdrawalAvailable={listenerWithdrawalPublicConfiguration() !== null} />;
}
