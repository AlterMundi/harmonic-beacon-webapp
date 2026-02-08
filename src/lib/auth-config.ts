import type { NextAuthConfig } from 'next-auth';
import Zitadel from 'next-auth/providers/zitadel';

export type Role = 'ADMIN' | 'PROVIDER' | 'USER';

declare module 'next-auth' {
    interface Session {
        user: {
            id: string;
            email: string;
            name?: string | null;
            image?: string | null;
            role: Role;
        };
    }
    interface User {
        role?: Role;
    }
}

declare module '@auth/core/jwt' {
    interface JWT {
        role: Role;
        sub: string;
        email?: string;
        name?: string;
        picture?: string;
    }
}

export const authConfig: NextAuthConfig = {
    providers: [
        Zitadel({
            clientId: process.env.AUTH_ZITADEL_ID!,
            clientSecret: 'pkce',
            issuer: process.env.AUTH_ZITADEL_ISSUER!,
            authorization: {
                params: {
                    scope: 'openid email profile urn:zitadel:iam:org:project:roles',
                },
            },
            async profile(profile, tokens) {
                let userinfo: Record<string, unknown> = {};
                try {
                    const res = await fetch(
                        `${process.env.AUTH_ZITADEL_ISSUER}/oidc/v1/userinfo`,
                        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
                    );
                    if (res.ok) userinfo = await res.json();
                } catch {
                    // Silent fail - use profile data
                }

                return {
                    id: profile.sub,
                    email: (userinfo.email as string) || '',
                    name: (userinfo.name as string) || (userinfo.email as string) || '',
                    image: (userinfo.picture as string) || null,
                };
            },
        }),
    ],
    callbacks: {
        jwt({ token, account, profile, user }) {
            if (account && user) {
                token.sub = user.id || '';
                token.email = user.email || '';
                token.name = user.name || '';
                token.picture = user.image || '';

                const rolesClaim = 'urn:zitadel:iam:org:project:roles';
                const roles = (profile as Record<string, unknown>)?.[rolesClaim] as Record<string, unknown> | undefined;

                let role: Role = 'USER';
                if (roles) {
                    if ('ADMIN' in roles) role = 'ADMIN';
                    else if ('PROVIDER' in roles || 'certified_provider' in roles) role = 'PROVIDER';
                }
                token.role = role;
            }
            return token;
        },
        async signIn({ user, account, profile }) {
            // Sync user to database on every sign in
            if (account?.provider === 'zitadel' && user.id && user.email) {
                try {
                    const db = await import('@/lib/db');
                    const PrismaEnums = await import('@prisma/client');

                    // Map auth role to Prisma enum
                    const rolesClaim = 'urn:zitadel:iam:org:project:roles';
                    const roles = (profile as Record<string, unknown>)?.[rolesClaim] as Record<string, unknown> | undefined;

                    type UserRoleType = 'LISTENER' | 'PROVIDER' | 'ADMIN';
                    let dbRole: UserRoleType = 'LISTENER';
                    if (roles) {
                        if ('ADMIN' in roles) dbRole = 'ADMIN';
                        else if ('PROVIDER' in roles || 'certified_provider' in roles) dbRole = 'PROVIDER';
                    }

                    await db.prisma.user.upsert({
                        where: { zitadelId: user.id },
                        update: {
                            email: user.email,
                            name: user.name || null,
                            avatarUrl: user.image || null,
                            role: dbRole,
                        },
                        create: {
                            zitadelId: user.id,
                            email: user.email,
                            name: user.name || null,
                            avatarUrl: user.image || null,
                            role: dbRole,
                        },
                    });
                } catch (error) {
                    console.error('Failed to sync user to database:', error);
                    // Don't block sign in if DB sync fails
                }
            }
            return true;
        },
        session({ session, token }) {
            if (session.user) {
                session.user.id = token.sub;
                session.user.email = token.email || '';
                session.user.name = token.name || null;
                session.user.image = token.picture || null;
                session.user.role = token.role;
            }
            return session;
        },
    },
    pages: {
        signIn: '/login',
    },
    session: {
        strategy: 'jwt',
        maxAge: 7 * 24 * 60 * 60, // 7 days
    },
    trustHost: true,
};
