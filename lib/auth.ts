/**
 * Single-user auth stub.
 *
 * The schema is multi-tenant-ready: every model carries `userId` and every
 * query scopes by the id returned here. To add real auth later (e.g. Auth.js),
 * replace this function's body with a session lookup — no schema or call-site
 * changes required.
 */
const LOCAL_USER_ID = "local-user";

export async function getUserId(): Promise<string> {
  return LOCAL_USER_ID;
}
