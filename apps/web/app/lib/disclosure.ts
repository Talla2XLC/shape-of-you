/**
 * Returns the next state of a reversible disclosure control.
 *
 * @param expanded - Whether the controlled content is currently visible.
 * @returns The inverse state used by the control's next render.
 */
export function nextDisclosureState(expanded: boolean): boolean {
  return !expanded;
}
