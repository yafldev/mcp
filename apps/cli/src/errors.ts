/** A usage mistake — unknown subcommand or a missing required argument. Maps to exit code 2. */
export class UsageError extends Error {}

/** No stored credential and no YAFL_API_KEY env override. Maps to exit code 3. */
export class AuthError extends Error {}
