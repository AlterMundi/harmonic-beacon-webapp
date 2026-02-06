export type { Role } from './auth-config';
export { auth } from '@/auth';

export function isAdmin(role: string): boolean {
    return role === 'ADMIN';
}

export function isAdminOrProvider(role: string): boolean {
    return role === 'ADMIN' || role === 'PROVIDER';
}
