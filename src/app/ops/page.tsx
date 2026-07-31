import { redirect } from 'next/navigation';

/** Stable entry point for old staff links that stopped at the ops root. */
export default function OpsPage() {
    redirect('/ops/events');
}
