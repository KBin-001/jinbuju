import { readManualStore, writeManualStore } from "./manualStore";
import { addDays, formatDate, getTodayBusinessDate } from "../utils/date";
import { SparkCheckin, SparkStatus } from "../types/spark";

function previousDate(value: string): string {
  return formatDate(addDays(new Date(`${value}T00:00:00`), -1));
}

function normalizeCheckins(checkins: SparkCheckin[]): SparkCheckin[] {
  const byDate = new Map<string, SparkCheckin>();
  checkins.forEach((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.businessDate)) return;
    const existing = byDate.get(item.businessDate);
    if (!existing || item.checkedAt < existing.checkedAt) byDate.set(item.businessDate, item);
  });
  return Array.from(byDate.values()).sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

export function getSparkStatus(today = getTodayBusinessDate()): SparkStatus {
  const checkins = normalizeCheckins(readManualStore().sparkCheckins || []);
  const dates = new Set(checkins.map((item) => item.businessDate));
  const checkedInToday = dates.has(today);
  let currentStreak = 0;

  if (checkedInToday) {
    let cursor = today;
    while (dates.has(cursor)) {
      currentStreak += 1;
      cursor = previousDate(cursor);
    }
  }

  return { checkedInToday, currentStreak, totalCheckins: dates.size };
}

export function checkInSpark(today = getTodayBusinessDate()): SparkStatus {
  const store = readManualStore();
  const checkins = normalizeCheckins(store.sparkCheckins || []);
  if (!checkins.some((item) => item.businessDate === today)) {
    checkins.push({ businessDate: today, checkedAt: new Date().toISOString() });
    store.sparkCheckins = checkins.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    writeManualStore(store);
  }
  return getSparkStatus(today);
}
