import { redirect } from 'next/navigation';

/** Compatibility for crew bookmarks created before the unified event hub. */
export default async function LegacyOpsSessionPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    redirect(`/ops/events/${encodeURIComponent(id)}`);
}
