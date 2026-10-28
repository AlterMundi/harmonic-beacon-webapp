'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Room navigation belongs to the room. Account/site/operations navigation
 * returns on the other routes, without remounting the persistent media tree. */
export function RoomSiteChrome({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const inRoom = /^\/session\/[^/]+\/?$/.test(pathname) ||
        /^\/ops\/(?:events|session)\/[^/]+\/?$/.test(pathname) &&
        !/^\/ops\/events\/manage\/?$/.test(pathname);
    return inRoom ? null : children;
}
