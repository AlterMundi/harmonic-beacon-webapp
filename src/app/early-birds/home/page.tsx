import { redirect } from 'next/navigation';

import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdHomePage() {
    redirect(LISTENER_NAMESPACE.canonical.home);
}
