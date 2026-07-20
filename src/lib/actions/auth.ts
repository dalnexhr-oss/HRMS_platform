'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/queries';
import { homeForRole } from '@/lib/auth';

export interface SignInState {
  error?: string;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!isSupabaseConfigured()) {
    return {
      error:
        'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) to enable sign-in.',
    };
  }
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Signed in, but no session was returned. Try again.' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  // Surface a lookup failure rather than guessing a role and routing them wrong.
  if (profileError) {
    return { error: `Signed in, but your profile could not be loaded: ${profileError.message}` };
  }

  // A missing profile must never route to the staff portal. handle_new_user()
  // creates one using the profiles.role default, which is now 'employee'
  // (migration 0008); if the row is somehow absent we still land on the
  // employee area, never /today. redirect() throws to interrupt — last statement.
  redirect(homeForRole(profile?.role ?? 'employee'));
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/login');
}
