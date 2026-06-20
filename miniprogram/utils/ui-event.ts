export interface UiComponentEvent<T = unknown> {
  detail?: T | { value?: T };
  currentTarget?: {
    dataset?: Record<string, unknown>;
  };
}

export function getUiEventValue<T>(event: UiComponentEvent<T>): T | undefined {
  const detail = event.detail;
  if (
    detail !== null &&
    typeof detail === "object" &&
    !Array.isArray(detail) &&
    "value" in detail
  ) {
    return (detail as { value?: T }).value;
  }
  return detail as T | undefined;
}

export function getUiEventString(event: UiComponentEvent<unknown>): string {
  const value = getUiEventValue(event);
  return value === undefined || value === null ? "" : String(value);
}
