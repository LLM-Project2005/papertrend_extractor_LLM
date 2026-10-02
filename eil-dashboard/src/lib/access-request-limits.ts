/** Limits of the access-request form, shared by the form and the server (no zod here: the form is on a public page). */

/** Requests are deleted this long after they were made, whatever their state. */
export const ACCESS_REQUEST_RETENTION_DAYS = 180;
export const ACCESS_REQUEST_NAME_MAX = 120;
export const ACCESS_REQUEST_AFFILIATION_MAX = 200;
export const ACCESS_REQUEST_USE_MIN = 10;
export const ACCESS_REQUEST_USE_MAX = 1000;
/** How long the code sent in answer to a request lasts. */
export const ACCESS_REQUEST_INVITE_DAYS = 14;
