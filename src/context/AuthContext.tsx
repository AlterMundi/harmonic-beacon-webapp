"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type User = {
    id: string;
    email?: string;
    user_metadata?: {
        display_name?: string;
        avatar_url?: string;
        full_name?: string;
    };
};

type Session = {
    user: User;
    access_token: string;
};

type AuthContextType = {
    signIn: (email: string, password: string) => Promise<{ error: string | null }>;
    signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
    signInWithGoogle: () => Promise<{ error: string | null }>;
    signOut: () => Promise<void>;
    user: User | null;
    session: Session | null;
    isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signInWithGoogle: async () => ({ error: null }),
    signOut: async () => { },
    user: null,
    session: null,
    isLoading: true,
});

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Initialize - check for existing session
    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data }) => {
            const currentSession = data?.session as Session | null;
            setSession(currentSession);
            setUser(currentSession?.user ?? null);
            setIsLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
            setSession(currentSession);
            setUser(currentSession?.user ?? null);
            setIsLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                return { error: error.message };
            }
            return { error: null };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred';
            return { error: message };
        }
    };

    const signUp = async (email: string, password: string, displayName: string): Promise<{ error: string | null }> => {
        try {
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        display_name: displayName,
                    },
                },
            });

            if (error) {
                return { error: error.message };
            }
            return { error: null };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred';
            return { error: message };
        }
    };

    const signInWithGoogle = async (): Promise<{ error: string | null }> => {
        try {
            // Use the current origin for redirect - this runs client-side only
            const redirectUrl = `${window.location.origin}/auth/callback`;

            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: redirectUrl,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
                    },
                },
            });

            if (error) {
                return { error: error.message };
            }
            return { error: null };
        } catch (err: unknown) {
            console.error('Google Sign-In error:', err);
            const message = err instanceof Error ? err.message : 'An unexpected error occurred';
            return { error: message };
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider
            value={{
                signIn,
                signUp,
                signInWithGoogle,
                signOut,
                user,
                session,
                isLoading,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
