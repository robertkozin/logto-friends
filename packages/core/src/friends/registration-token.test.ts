import { SignInMode } from '@logto/schemas';
import { SignJWT } from 'jose';
import type { Provider } from 'oidc-provider';

import type Queries from '#src/tenants/Queries.js';

import { applyRegistrationToken, getRegistrationData } from './registration-token.js';

const { jest } = import.meta;

const clientId = 'some-app';
const secret = 'a-client-secret-of-reasonable-length';

const sign = async ({
  key = secret,
  issuer = clientId,
  audience = 'logto-friends-registration',
  expiresIn = '30m',
  issuedAt,
  claims = { inviteId: 'invite-42', tier: 2 },
}: Partial<Record<'key' | 'issuer' | 'audience' | 'expiresIn', string>> & {
  issuedAt?: number;
  claims?: Record<string, unknown>;
} = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(key));

type SecretRow = { value: string; expiresAt?: number };

const createQueries = (secrets: SecretRow[] = [{ value: secret }]) =>
  ({
    applicationSecrets: {
      getSecretsByApplicationId: jest.fn(async () => secrets),
    },
  }) as unknown as Queries;

const createProvider = (params: Record<string, unknown>) =>
  ({
    interactionDetails: jest.fn(async () => ({ params })),
  }) as unknown as Provider;

// Each call gets a fresh context object, so the per-request cache doesn't leak between cases.
const createContext = (): Parameters<typeof getRegistrationData>[0] =>
  ({ req: {}, res: {}, console }) as unknown as Parameters<typeof getRegistrationData>[0];

const getData = async (params: Record<string, unknown>, queries = createQueries()) =>
  getRegistrationData(createContext(), createProvider(params), queries);

describe('getRegistrationData()', () => {
  it('returns the custom claims of a valid token', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign() })
    ).resolves.toEqual({ inviteId: 'invite-42', tier: 2 });
  });

  it('leaves out the JWT registered claims', async () => {
    const data = await getData({
      client_id: clientId,
      registration_token: await sign({ claims: { sub: 'x', jti: 'y', nbf: 0, note: 'kept' } }),
    });

    expect(data).toEqual({ note: 'kept' });
  });

  it('accepts a token with no custom claims', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign({ claims: {} }) })
    ).resolves.toEqual({});
  });

  it('accepts any unexpired secret of the app', async () => {
    const queries = createQueries([
      { value: 'old-secret', expiresAt: Date.now() + 60_000 },
      { value: secret },
    ]);

    await expect(
      getData({ client_id: clientId, registration_token: await sign() }, queries)
    ).resolves.toBeDefined();
  });

  it('ignores interactions without a token', async () => {
    await expect(getData({ client_id: clientId })).resolves.toBeUndefined();
  });

  it('rejects apps without a client secret', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign() }, createQueries([]))
    ).resolves.toBeUndefined();
  });

  it('rejects a token signed with another secret', async () => {
    await expect(
      getData({
        client_id: clientId,
        registration_token: await sign({ key: 'wrong-secret-value' }),
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a token signed with an expired secret', async () => {
    const queries = createQueries([{ value: secret, expiresAt: Date.now() - 1 }]);

    await expect(
      getData({ client_id: clientId, registration_token: await sign() }, queries)
    ).resolves.toBeUndefined();
  });

  it('rejects a token issued by another client', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign({ issuer: 'other-app' }) })
    ).resolves.toBeUndefined();
  });

  it('rejects a token with the wrong audience', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign({ audience: 'something' }) })
    ).resolves.toBeUndefined();
  });

  it('rejects an expired token', async () => {
    await expect(
      getData({ client_id: clientId, registration_token: await sign({ expiresIn: '-1m' }) })
    ).resolves.toBeUndefined();
  });

  it('rejects a token issued more than an hour ago, whatever its `exp`', async () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 60 * 60;

    await expect(
      getData({ client_id: clientId, registration_token: await sign({ issuedAt: twoHoursAgo }) })
    ).resolves.toBeUndefined();
  });
});

describe('applyRegistrationToken()', () => {
  const signInOnly = { signInMode: SignInMode.SignIn };

  it('opens registration with a valid token', async () => {
    await expect(
      applyRegistrationToken(
        signInOnly,
        createContext(),
        createProvider({ client_id: clientId, registration_token: await sign() }),
        createQueries()
      )
    ).resolves.toEqual({ signInMode: SignInMode.SignInAndRegister });
  });

  it('keeps sign-in only without a token', async () => {
    await expect(
      applyRegistrationToken(signInOnly, createContext(), createProvider({}), createQueries())
    ).resolves.toEqual(signInOnly);
  });

  it('leaves other sign-in modes alone', async () => {
    const register = { signInMode: SignInMode.Register };

    await expect(
      applyRegistrationToken(register, createContext(), createProvider({}), createQueries())
    ).resolves.toBe(register);
  });
});
