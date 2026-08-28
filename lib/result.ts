/** Discriminated union returned by every server action — never throw across the boundary. */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

export function err<T = never>(error: string): ActionResult<T> {
  return { success: false, error };
}
