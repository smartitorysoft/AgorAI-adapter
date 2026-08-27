import { SetMetadata } from '@nestjs/common'

export const SKIP_SIGNATURE = 'agorai:skip-signature'

/**
 * Marks a route as reachable without a signature.
 *
 * Only two routes qualify: the manifest (which the platform must read *before*
 * a shared secret has been agreed, and which contains no store data) and the
 * liveness probe (which a load balancer calls and which touches no store).
 */
export const SkipSignature = () => SetMetadata(SKIP_SIGNATURE, true)
