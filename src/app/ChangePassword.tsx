"use client";

import { useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { changeOwnPassword } from './changePassword';
import styles from './ChangePassword.module.css';

export default function ChangePassword({ client }: { client: SupabaseClient }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function clear() {
    setPassword('');
    setConfirmation('');
    setError('');
    setSuccess(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await changeOwnPassword(client, password, confirmation);
      setPassword('');
      setConfirmation('');
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change your password. Please try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <>
    <button type="button" className="signout-button" onClick={() => { clear(); dialog.current?.showModal(); }}>Change Password</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="change-password-title"
      onCancel={event => { if (inFlight.current) event.preventDefault(); }} onClose={clear}>
      <h2 id="change-password-title">Change your password</h2>
      {success ? <>
        <p role="status">Your password has been changed. Use your new password the next time you sign in.</p>
        <button type="button" className={styles.primary} onClick={() => dialog.current?.close()}>Done</button>
      </> : <form onSubmit={submit}>
        <p>Choose your own password to replace the temporary one, or update your existing password.</p>
        <label htmlFor="hub-new-password">New password</label>
        <input id="hub-new-password" type="password" autoComplete="new-password" minLength={8} required
          autoFocus disabled={saving} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="hub-password-help" />
        <small id="hub-password-help">Use at least 8 characters.</small>
        <label htmlFor="hub-confirm-password">Confirm new password</label>
        <input id="hub-confirm-password" type="password" autoComplete="new-password" minLength={8} required
          disabled={saving} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" disabled={saving} className={styles.primary}>{saving ? 'Saving…' : 'Save New Password'}</button>
        </div>
      </form>}
    </dialog>
  </>;
}
