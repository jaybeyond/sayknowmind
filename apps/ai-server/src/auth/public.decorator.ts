import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or whole controller) as publicly accessible, exempting it from
 * the global SignatureGuard. Use sparingly — auth is deny-by-default (the guard
 * is registered as an APP_GUARD), so only genuinely public endpoints (e.g.
 * health probes) should opt out.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
