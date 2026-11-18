/**
 * Fork-owned (logto-friends): token-gated registration.
 *
 * Registration stays off globally (sign-in mode `SignIn`). Any OIDC client with a client secret can
 * open it for one sign-in by adding a `registration_token` parameter to the authorization request:
 * an HS256 JWT signed with one of its own client secrets, issued by itself (`iss` = its client ID).
 * The token's non-registered claims are stored on the new user as `customData.registrationData`.
 *
 * See FRIENDS.md for the token format.
 */
import { SignInMode, type JsonObject } from '@logto/schemas';
import { trySafe } from '@silverhand/essentials';
import { jwtVerify, type JWTPayload } from 'jose';
import type { Context } from 'koa';
import type { Provider } from 'oidc-provider';

import type Queries from '#src/tenants/Queries.js';
import { getConsoleLogFromContext } from '#src/utils/console.js';

/** The authorization request parameter carrying the registration token. */
export const registrationTokenParam = 'registration_token';
/** The user `customData` key holding the token's claims. */
export const registrationDataCustomDataKey = 'registrationData';
/**
 * The required `aud` claim. It keeps other JWTs signed with a client secret (such as
 * `client_secret_jwt` assertions) from being usable as registration tokens.
 */
const registrationTokenAudience = 'logto-friends-registration';
/** Upper bound on token age, whatever `exp` the issuer sets. */
const maxTokenAge = '1h';
/** JWT registered claims (RFC 7519), left out of the stored registration data. */
const registeredClaims = new Set(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']);

/** The token's claims other than the JWT registered ones. */
type RegistrationData = JsonObject;

type TokenContext = Pick<Context, 'req' | 'res'>;

const verifyWithSecrets = async (
  token: string,
  clientId: string,
  secrets: string[]
): Promise<JWTPayload | undefined> => {
  for (const secret of secrets) {
    // eslint-disable-next-line no-await-in-loop -- try each secret in turn; usually there is one
    const result = await trySafe(async () =>
      jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ['HS256'],
        issuer: clientId,
        audience: registrationTokenAudience,
        requiredClaims: ['exp', 'iat'],
        maxTokenAge,
      })
    );

    if (result) {
      return result.payload;
    }
  }
};

/**
 * Verify a registration token issued by the given client. Returns the reason as a string when the
 * token is not usable.
 */
const verifyRegistrationToken = async (
  queries: Queries,
  token: string,
  clientId: string
): Promise<RegistrationData | string> => {
  const now = Date.now();
  const allSecrets = await queries.applicationSecrets.getSecretsByApplicationId(clientId);
  const secrets = allSecrets
    .filter(({ expiresAt }) => (expiresAt ?? Number.POSITIVE_INFINITY) > now)
    .map(({ value }) => value);

  if (secrets.length === 0) {
    return `application ${clientId} has no active client secret`;
  }

  const payload = await verifyWithSecrets(token, clientId, secrets);

  if (!payload) {
    return 'invalid, expired or wrongly signed token';
  }

  // eslint-disable-next-line no-restricted-syntax -- a verified JWT payload is parsed JSON
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !registeredClaims.has(key))
  ) as JsonObject;
};

/** Per-request cache, so the guards and the user creation in one request agree. */
const requestCache = new WeakMap<TokenContext, Promise<RegistrationData | undefined>>();

const readTokenFromInteraction = async (
  ctx: TokenContext,
  provider: Provider,
  queries: Queries
): Promise<RegistrationData | undefined> => {
  const details = await trySafe(provider.interactionDetails(ctx.req, ctx.res));
  const token: unknown = details?.params[registrationTokenParam];
  const clientId: unknown = details?.params.client_id;

  if (typeof token !== 'string' || !token || typeof clientId !== 'string') {
    return;
  }

  const result = await verifyRegistrationToken(queries, token, clientId);

  if (typeof result === 'string') {
    getConsoleLogFromContext(ctx).warn(`[friends] registration token rejected: ${result}`);
    return;
  }

  return result;
};

/**
 * The registration data from a valid registration token attached to the current OIDC interaction,
 * or `undefined` if there is none.
 */
export const getRegistrationData = async (
  ctx: TokenContext,
  provider: Provider,
  queries: Queries
): Promise<RegistrationData | undefined> => {
  const cached = requestCache.get(ctx);

  if (cached) {
    return cached;
  }

  const promise = readTokenFromInteraction(ctx, provider, queries);
  requestCache.set(ctx, promise);

  return promise;
};

/**
 * Report registration as enabled to the sign-in page while the current interaction carries a valid
 * registration token, so the stock registration UI (including social sign-up) shows up.
 */
export const applyRegistrationToken = async <T extends { signInMode: SignInMode }>(
  signInExperience: T,
  ctx: TokenContext,
  provider: Provider,
  queries: Queries
): Promise<T> => {
  if (signInExperience.signInMode !== SignInMode.SignIn) {
    return signInExperience;
  }

  const registrationData = await getRegistrationData(ctx, provider, queries);

  return registrationData
    ? { ...signInExperience, signInMode: SignInMode.SignInAndRegister }
    : signInExperience;
};
