import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyDatabaseAtStartup } from '../../../src/dios/cloud/startup.js';

afterEach(() => vi.useRealTimers());

describe('Cloud database startup readiness', () => {
  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOENT', '57P03'])(
    'waits for temporary %s and reruns the complete verification', async code => {
      vi.useFakeTimers();
      const verifyRuntimeRole = vi.fn().mockRejectedValueOnce(Object.assign(new Error('temporary'), {code})).mockResolvedValue(undefined);
      const ready = verifyDatabaseAtStartup({verifyRuntimeRole});
      let completed = false;
      void ready.then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(4999);
      expect(completed).toBe(false);
      expect(verifyRuntimeRole).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await ready;
      expect(completed).toBe(true);
      expect(verifyRuntimeRole).toHaveBeenCalledTimes(2);
    });

  it.each(['Connection terminated due to connection timeout', 'timeout exceeded when trying to connect'])(
    'retries the pg-pool connection timeout: %s', async message => {
      vi.useFakeTimers();
      const verifyRuntimeRole = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue(undefined);
      const ready = verifyDatabaseAtStartup({verifyRuntimeRole});
      await vi.advanceTimersByTimeAsync(5000);
      await ready;
      expect(verifyRuntimeRole).toHaveBeenCalledTimes(2);
    });

  it.each(['28P01', '42501', '42P01', '57014', 'ENOTFOUND', 'CERT_HAS_EXPIRED', 'DIOS_UNSAFE_DATABASE_ROLE', 'DIOS_DATABASE_TENANT_NOT_BOUND', 'DIOS_RLS_NOT_READY'])(
    'immediately rejects non-transient %s', async code => {
      vi.useFakeTimers();
      const error = Object.assign(new Error(code), {code});
      const verifyRuntimeRole = vi.fn().mockRejectedValue(error);
      await expect(verifyDatabaseAtStartup({verifyRuntimeRole})).rejects.toBe(error);
      expect(verifyRuntimeRole).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

  it('stops after 19 attempts without masking the failure', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('unavailable'), {code: 'ECONNREFUSED'});
    const verifyRuntimeRole = vi.fn().mockRejectedValue(error);
    const outcome = verifyDatabaseAtStartup({verifyRuntimeRole}).catch(e => e);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await outcome).toBe(error);
    expect(verifyRuntimeRole).toHaveBeenCalledTimes(19);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a successful verification', async () => {
    vi.useFakeTimers();
    const verifyRuntimeRole = vi.fn().mockResolvedValue(undefined);
    await verifyDatabaseAtStartup({verifyRuntimeRole});
    expect(verifyRuntimeRole).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
