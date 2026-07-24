export type ProductEventName =
  | "onboarding_started" | "onboarding_completed"
  | "goal_created" | "first_action_created"
  | "action_started" | "action_paused" | "action_completed" | "action_timer_finished"
  | "daily_summary_completed"
  | "coach_opened" | "advice_applied"
  | "team_created" | "team_joined" | "team_invited"
  | "share_generated" | "share_saved" | "member_interest";

type SafeValue = string | number | boolean;
type EventSink = (name: ProductEventName, properties: Record<string, SafeValue>) => void;

let sink: EventSink | null = null;

/** 正式统计渠道接入前保持无副作用；事件属性不得包含用户正文或身份信息。 */
export function registerProductEventSink(next: EventSink | null): void { sink = next; }

export function recordProductEvent(name: ProductEventName, properties: Record<string, SafeValue> = {}): void {
  if (!sink) return;
  const safeProperties = Object.keys(properties).reduce<Record<string, SafeValue>>((result, key) => {
    const value = properties[key];
    if (["string", "number", "boolean"].includes(typeof value)) result[key] = value;
    return result;
  }, {});
  sink(name, safeProperties);
}
