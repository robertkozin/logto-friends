import { fullSignInExperienceGuard } from '@logto/schemas';
import type { Provider } from 'oidc-provider';
import { z } from 'zod';

import { applyRegistrationToken } from '#src/friends/registration-token.js';
import koaGuard from '#src/middleware/koa-guard.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

import { type AnonymousRouter } from '../types.js';

export default function experienceRoutes<T extends AnonymousRouter>(
  router: T,
  { signInExperiences: { getFullSignInExperience } }: Libraries,
  provider: Provider,
  queries: Queries
) {
  router.get(
    '/.well-known/experience',
    koaGuard({
      query: z.object({ organizationId: z.string(), appId: z.string() }).partial(),
      response: fullSignInExperienceGuard,
      status: 200,
    }),
    async (ctx, next) => {
      const { organizationId, appId } = ctx.guard.query;
      // Fork (logto-friends): open registration for interactions with a registration token.
      ctx.body = await applyRegistrationToken(
        await getFullSignInExperience({ locale: ctx.locale, organizationId, appId }),
        ctx,
        provider,
        queries
      );

      return next();
    }
  );
}
