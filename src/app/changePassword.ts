import type { SupabaseClient } from '@supabase/supabase-js';

export async function changeOwnPassword(client: SupabaseClient, password: string, confirmation: string) {
  if (password.length < 8) throw new Error('Use at least 8 characters for your new password.');
  if (password !== confirmation) throw new Error('The new passwords do not match.');
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Your session has expired. Sign in again, then change your password.');
  // Supabase updates only the authenticated user's password; no admin key or user ID is accepted.
  const result = await client.auth.updateUser({ password });
  if (result.error) throw new Error(result.error.message);
  if (!result.data.user) throw new Error('The password change was not confirmed. Please try again.');
}
